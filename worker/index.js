/*
 * お気に入り・表示設定・地図位置の同期API
 *
 * 設計と決定の経緯は SYNC_MANUAL.md にある。ここでの要点だけ再掲する。
 *   ・ログイン画面を作らない。最初の保存が起きたときに無記名のキーを発行し、
 *     HttpOnly Cookie に入れる（/api/enroll）
 *   ・端末を足すのは「QRを表示している間だけ有効な引き継ぎ券」（/api/handover → /api/join）
 *   ・保存は states テーブル。device_id が空文字なら全端末で共有、そうでなければその端末専用
 *
 * ルーティングは Workers の静的アセットが先に効く。ファイルに当たらないURLだけが
 * ここへ来るので、/api/ 以外は ASSETS へ渡し直している（404ページも向こうの担当）。
 *
 * CPU の上限は無料枠で 10ms/呼び出し。パスワードのような重いハッシュを避け、
 * 128ビットの乱数を SHA-256 で1回だけ照合する作りにしてあるのはこのため。
 */

const COOKIE_NAME = '__Host-sid';
const SESSION_MAX_AGE = 31536000;          // 1年。アクセスのたびに打ち直して延ばす
const HANDOVER_MAX_MS = 10 * 60 * 1000;    // QRの出しっぱなし対策。通常は閉じた時点で消す
const LAST_SEEN_MIN_MS = 10 * 60 * 1000;   // 端末一覧の「最終アクセス」を書き直す間隔
const SHARED = '';                          // states.device_id の共有を表す値
// 手入力コードの文字集合。0/O/1/I/L のような読み違えやすい字を外した32文字 = 1文字5ビット
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/* ── 小道具 ───────────────────────────────────────────────── */

function json(data, status = 200, headers = {}) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json;charset=utf-8', 'cache-control': 'no-store', ...headers },
    });
}

async function sha256hex(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function randomToken(bytes = 16) {
    const a = new Uint8Array(bytes);
    crypto.getRandomValues(a);
    return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// 手入力用の8文字（40ビット）。有効なのはQRを開いている数分だけなので、この長さで足りる
function shortCode() {
    const a = new Uint8Array(8);
    crypto.getRandomValues(a);
    const s = [...a].map(n => CODE_ALPHABET[n % 32]).join('');
    return `${s.slice(0, 4)}-${s.slice(4)}`;
}
function normalizeShort(s) {
    return String(s || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
}

function cookieValue(request, name) {
    const raw = request.headers.get('cookie') || '';
    for (const part of raw.split(';')) {
        const i = part.indexOf('=');
        if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
    }
    return null;
}

/* Domain を付けない（ホスト限定）。workers.dev は Public Suffix List にあるため、
   Domain にアカウントのサブドメインを書くと同一アカウントの他のWorkerと共有されてしまう。
   __Host- 接頭辞は Secure と Path=/ を要求し Domain を禁じるので、それをブラウザ側で担保できる。 */
function sessionCookie(token) {
    return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE}`;
}

const now = () => Date.now();

/* 手加減つきの回数制限。アイソレートごとのメモリなので厳密ではないが、
   総当りは128ビット（QR）と40ビット×数分（手入力）で成り立たないため、これで足りる。 */
const hits = new Map();
function tooManyRequests(key, limit, windowMs) {
    const t = now();
    const rec = hits.get(key);
    if (!rec || t - rec.start > windowMs) { hits.set(key, { start: t, n: 1 }); return false; }
    rec.n++;
    return rec.n > limit;
}
const clientKey = (request) => request.headers.get('cf-connecting-ip') || 'unknown';

/* ── 認証 ─────────────────────────────────────────────────── */

async function currentDevice(env, request) {
    const token = cookieValue(request, COOKIE_NAME);
    if (!token) return null;
    const hash = await sha256hex(token);
    const row = await env.DB.prepare(
        'SELECT id, user_id, name, ua, mode, created_at, last_seen_at FROM devices WHERE token_hash = ?'
    ).bind(hash).first();
    if (!row) return null;
    if (now() - Number(row.last_seen_at) > LAST_SEEN_MIN_MS) {
        await env.DB.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?').bind(now(), row.id).run();
    }
    return row;
}

// User-Agent から端末名を組み立てる。当てられなければ空にして、あとで本人に付けさせる
function deviceNameFromUa(ua) {
    const s = String(ua || '');
    const os = /iPhone/.test(s) ? 'iPhone' : /iPad/.test(s) ? 'iPad' : /Android/.test(s) ? 'Android'
             : /Macintosh/.test(s) ? 'Mac' : /Windows/.test(s) ? 'Windows' : '';
    const br = /Edg\//.test(s) ? 'Edge' : /OPR\//.test(s) ? 'Opera' : /Firefox\//.test(s) ? 'Firefox'
             : /Chrome\//.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : '';
    return [os, br].filter(Boolean).join(' / ');
}

async function createDevice(env, userId, ua, name) {
    const token = randomToken(16);
    const id = randomToken(8);
    const t = now();
    await env.DB.prepare(
        `INSERT INTO devices (id, user_id, token_hash, name, ua, mode, created_at, last_seen_at, expires_at)
         VALUES (?, ?, ?, ?, ?, 'rw', ?, ?, NULL)`
    ).bind(id, userId, await sha256hex(token), String(name || deviceNameFromUa(ua) || '端末').slice(0, 40),
           String(ua || '').slice(0, 200), t, t).run();
    return { id, token };
}

/* ── 各API ────────────────────────────────────────────────── */

// 最初の保存が起きたときだけ呼ばれる。ページを開いただけでは行を作らない
async function apiEnroll(env, request) {
    if (tooManyRequests('enroll:' + clientKey(request), 5, 60 * 60 * 1000)) {
        return json({ error: 'too_many' }, 429);
    }
    const body = await request.json().catch(() => ({}));
    const userId = randomToken(8);
    await env.DB.prepare('INSERT INTO users (id, created_at) VALUES (?, ?)').bind(userId, now()).run();
    const dev = await createDevice(env, userId, request.headers.get('user-agent'), body.name);
    return json({ ok: true, device: dev.id }, 200, { 'set-cookie': sessionCookie(dev.token) });
}

async function apiGetState(env, device) {
    const rs = await env.DB.prepare(
        'SELECT device_id, key, value, rev FROM states WHERE user_id = ? AND (device_id = ? OR device_id = ?)'
    ).bind(device.user_id, SHARED, device.id).all();
    const keys = {};
    for (const r of rs.results || []) keys[r.key] = { value: r.value, rev: Number(r.rev), device: r.device_id !== SHARED };
    return json({ ok: true, keys, device: { id: device.id, name: device.name } });
}

/* 送られたキーだけを保存する。baseRev がサーバーの rev と食い違えば 409 相当を返し、
   その場のサーバー値を添える（呼び出し側が取り込んでから送り直す）。 */
async function apiPutState(env, device, request) {
    const body = await request.json().catch(() => null);
    const items = body && Array.isArray(body.items) ? body.items.slice(0, 8) : null;
    if (!items) return json({ error: 'bad_request' }, 400);

    const results = {};
    for (const it of items) {
        const key = String(it.key || '');
        if (!key || typeof it.value !== 'string' || it.value.length > 1000000) {
            results[key] = { error: 'bad_item' };
            continue;
        }
        const scope = it.scope === 'device' ? device.id : SHARED;
        const cur = await env.DB.prepare(
            'SELECT value, rev FROM states WHERE user_id = ? AND device_id = ? AND key = ?'
        ).bind(device.user_id, scope, key).first();
        const curRev = cur ? Number(cur.rev) : 0;
        if (Number(it.baseRev || 0) !== curRev) {
            results[key] = { conflict: true, rev: curRev, value: cur ? cur.value : null };
            continue;
        }
        const rev = curRev + 1;
        await env.DB.prepare(
            `INSERT INTO states (user_id, device_id, key, value, rev, updated_at) VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(user_id, device_id, key) DO UPDATE SET value = excluded.value,
                 rev = excluded.rev, updated_at = excluded.updated_at`
        ).bind(device.user_id, scope, key, it.value, rev, now()).run();
        results[key] = { rev };
    }
    return json({ ok: true, results });
}

// 引き継ぎ券。QRを開いたときに1組（QR用の長いコードと手入力用の8文字）を作る
async function apiHandoverCreate(env, device) {
    await env.DB.prepare('DELETE FROM handovers WHERE user_id = ? OR expires_at < ?')
        .bind(device.user_id, now()).run();
    const code = randomToken(16);
    const short = shortCode();
    const t = now(), exp = t + HANDOVER_MAX_MS;
    await env.DB.batch([
        env.DB.prepare('INSERT INTO handovers (code_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
            .bind(await sha256hex(code), device.user_id, t, exp),
        env.DB.prepare('INSERT INTO handovers (code_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
            .bind(await sha256hex(normalizeShort(short)), device.user_id, t, exp),
    ]);
    return json({ ok: true, code, short, expiresAt: exp });
}

async function apiHandoverDelete(env, device) {
    await env.DB.prepare('DELETE FROM handovers WHERE user_id = ?').bind(device.user_id).run();
    return json({ ok: true });
}

/* 券を使って端末を1台足す。券は消さない（QRを表示している間は何台でも入れるため）。
   無効にするのは apiHandoverDelete と期限切れの2つだけ。 */
async function apiJoin(env, request) {
    if (tooManyRequests('join:' + clientKey(request), 20, 10 * 60 * 1000)) {
        return json({ error: 'too_many' }, 429);
    }
    const body = await request.json().catch(() => ({}));
    const raw = String(body.code || '');
    const hash = await sha256hex(raw.includes('-') || raw.length <= 9 ? normalizeShort(raw) : raw);
    const row = await env.DB.prepare(
        'SELECT user_id, expires_at FROM handovers WHERE code_hash = ?'
    ).bind(hash).first();
    if (!row || Number(row.expires_at) < now()) return json({ error: 'invalid_code' }, 404);
    const dev = await createDevice(env, row.user_id, request.headers.get('user-agent'), body.name);
    return json({ ok: true, device: dev.id }, 200, { 'set-cookie': sessionCookie(dev.token) });
}

async function apiDevices(env, device) {
    const rs = await env.DB.prepare(
        'SELECT id, name, created_at, last_seen_at FROM devices WHERE user_id = ? ORDER BY created_at'
    ).bind(device.user_id).all();
    return json({
        ok: true,
        self: device.id,
        devices: (rs.results || []).map(r => ({
            id: r.id, name: r.name, createdAt: Number(r.created_at), lastSeenAt: Number(r.last_seen_at),
        })),
    });
}

/* 端末を外す。自分自身も外せる（「この端末の同期をやめる」）。
   その端末専用に持っていた地図位置も一緒に消す。共有分は他の端末のものなので残す。 */
async function apiDeviceDelete(env, device, targetId) {
    const target = await env.DB.prepare('SELECT id FROM devices WHERE id = ? AND user_id = ?')
        .bind(targetId, device.user_id).first();
    if (!target) return json({ error: 'not_found' }, 404);
    await env.DB.batch([
        env.DB.prepare('DELETE FROM states WHERE user_id = ? AND device_id = ?').bind(device.user_id, targetId),
        env.DB.prepare('DELETE FROM devices WHERE id = ? AND user_id = ?').bind(targetId, device.user_id),
    ]);
    const self = targetId === device.id;
    return json({ ok: true, self }, 200,
        self ? { 'set-cookie': `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0` } : {});
}

// 保存領域そのものを消す。各端末の localStorage には手が届かないので、消えるのはサーバー側だけ
async function apiAccountDelete(env, device) {
    const u = device.user_id;
    await env.DB.batch([
        env.DB.prepare('DELETE FROM states WHERE user_id = ?').bind(u),
        env.DB.prepare('DELETE FROM handovers WHERE user_id = ?').bind(u),
        env.DB.prepare('DELETE FROM devices WHERE user_id = ?').bind(u),
        env.DB.prepare('DELETE FROM users WHERE id = ?').bind(u),
    ]);
    return json({ ok: true }, 200,
        { 'set-cookie': `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0` });
}

/* ── 入口 ─────────────────────────────────────────────────── */

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
        if (!env.DB) return json({ error: 'no_database' }, 503);

        /* CSRF: 独自ヘッダを必須にする。他サイトからこれを付けて送るには CORS の事前確認が要り、
           こちらは許可しない。Cookie 側も SameSite=Lax を明示してある（POST等には付かない）。 */
        if (request.headers.get('x-sync') !== '1') return json({ error: 'forbidden' }, 403);

        const path = url.pathname.slice(5);        // 'api/' の後ろ
        const method = request.method;

        try {
            if (path === 'enroll' && method === 'POST') return await apiEnroll(env, request);
            if (path === 'join'   && method === 'POST') return await apiJoin(env, request);

            const device = await currentDevice(env, request);
            if (!device) return json({ error: 'no_session' }, 401);

            if (path === 'state' && method === 'GET')    return await apiGetState(env, device);
            if (path === 'state' && method === 'PUT')    return await apiPutState(env, device, request);
            if (path === 'handover' && method === 'POST')   return await apiHandoverCreate(env, device);
            if (path === 'handover' && method === 'DELETE') return await apiHandoverDelete(env, device);
            if (path === 'devices' && method === 'GET')  return await apiDevices(env, device);
            if (path.startsWith('devices/') && method === 'DELETE') {
                return await apiDeviceDelete(env, device, path.slice('devices/'.length));
            }
            if (path === 'account' && method === 'DELETE') return await apiAccountDelete(env, device);
            return json({ error: 'not_found' }, 404);
        } catch (e) {
            console.error('[api]', path, e && e.message);
            return json({ error: 'server_error' }, 500);
        }
    },
};
