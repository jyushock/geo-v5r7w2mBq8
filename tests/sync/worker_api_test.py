#!/usr/bin/env python3
"""同期 API（worker/index.js）のシナリオテスト。

このPCには Node も wrangler も無いので、Worker のコードを Chromium（Playwright）の中で
ES モジュールとしてそのまま読み込み、env.DB に「Python の sqlite3 へ橋渡しする D1 もどき」を渡して呼ぶ。
D1 は SQLite なので、テーブルは SYNC_MANUAL.md の §7.2 の CREATE 文をそのまま使う。

D1 もどきの呼び出しは毎回 await を挟む（本物の D1 と同じく非同期）。そのため Promise.all で
同時に送った要求は、DB の読み書きの合間で交互に進む。同時保存の取りこぼしはこれで再現できる。

    python tests/sync/worker_api_test.py

必要なもの: pip install playwright && python -m playwright install chromium
"""
import json
import re
import sqlite3
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
ORIGIN = 'http://127.0.0.1:9'   # 実際には通信しない（page.route で全部返す）。127.0.0.1 は安全なコンテキストで crypto.subtle が使える


def schema_sql():
    md = (ROOT / 'SYNC_MANUAL.md').read_text(encoding='utf-8')
    sec = md.split('### 7.2 テーブル', 1)[1]
    m = re.search(r'```sql\n(.*?)```', sec, re.S)
    assert m, 'SYNC_MANUAL.md §7.2 に sql のブロックが無い'
    return m.group(1)


class FakeD1:
    def __init__(self):
        self.db = sqlite3.connect(':memory:')
        self.db.row_factory = sqlite3.Row
        self.db.executescript(schema_sql())

    def _exec(self, sql, params):
        cur = self.db.execute(sql, params)
        rows = [dict(r) for r in cur.fetchall()] if cur.description else []
        return rows, cur.rowcount if cur.rowcount >= 0 else 0

    def call(self, op, sql, params):
        rows, changes = self._exec(sql, params)
        self.db.commit()
        if op == 'first':
            return rows[0] if rows else None
        return {'success': True, 'results': rows, 'meta': {'changes': changes}}

    def batch(self, stmts):
        out = []
        try:
            for sql, params in stmts:
                rows, changes = self._exec(sql, params)
                out.append({'success': True, 'results': rows, 'meta': {'changes': changes}})
            self.db.commit()
        except Exception:
            self.db.rollback()
            raise
        return out


# ページ側。Worker が使う Request / Response を、ブラウザの制限（Cookie・Set-Cookie を落とす）を受けない形に差し替える
HARNESS_JS = r"""
class FakeHeaders {
    constructor(init) { this.m = new Map(Object.entries(init || {}).map(([k, v]) => [k.toLowerCase(), String(v)])); }
    get(k) { return this.m.has(k.toLowerCase()) ? this.m.get(k.toLowerCase()) : null; }
}
window.Response = class {
    constructor(body, init = {}) { this.body = body; this.status = init.status ?? 200; this.headers = new FakeHeaders(init.headers); }
};
class Stmt {
    constructor(sql, params = []) { this.sql = sql; this.params = params; }
    bind(...p) { return new Stmt(this.sql, p); }
    first() { return window.pyDb('first', this.sql, this.params); }
    all()   { return window.pyDb('all',   this.sql, this.params); }
    run()   { return window.pyDb('run',   this.sql, this.params); }
}
const env = { DB: { prepare: (sql) => new Stmt(sql), batch: (ss) => window.pyDbBatch(ss.map(s => [s.sql, s.params])) } };
const worker = (await import('/worker/index.js')).default;

// 端末ごとの Cookie を持って API を呼ぶ小道具
window.client = (cookie = null) => ({
    cookie,
    async call(method, path, body, headers = {}) {
        const h = { 'x-sync': '1', 'user-agent': 'Mozilla/5.0 (iPhone) Safari/1', ...headers };
        if (this.cookie) h.cookie = this.cookie;
        const req = {
            url: location.origin + path, method, headers: new FakeHeaders(h),
            json: async () => (body === undefined ? Promise.reject(new Error('no body')) : JSON.parse(JSON.stringify(body))),
        };
        const res = await worker.fetch(req, env);
        const sc = res.headers.get('set-cookie');
        if (sc) this.cookie = /Max-Age=0/.test(sc) ? null : sc.split(';')[0];
        return { status: res.status, data: JSON.parse(res.body) };
    },
});
window.harnessReady = true;
"""


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    d1 = FakeD1()
    results = []

    def check(name, cond, detail=''):
        results.append((name, bool(cond), detail))

    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page()
        page.expose_function('pyDb', lambda op, sql, params: d1.call(op, sql, params))
        page.expose_function('pyDbBatch', lambda stmts: d1.batch(stmts))

        worker_src = (ROOT / 'worker' / 'index.js').read_text(encoding='utf-8')

        def route(r):
            path = r.request.url[len(ORIGIN):]
            if path == '/worker/index.js':
                r.fulfill(body=worker_src, content_type='text/javascript')
            else:
                r.fulfill(body='<!doctype html><meta charset="utf-8"><title>t</title>', content_type='text/html')
        page.route(ORIGIN + '/**', route)
        page.goto(ORIGIN + '/')
        page.add_script_tag(content=HARNESS_JS, type='module')
        page.wait_for_function('window.harnessReady === true')

        def run(js):
            return page.evaluate(f'async () => {{ {js} }}')

        # ── 1. CSRF: 独自ヘッダが無ければ断る
        r = run("const c = client(); return await c.call('POST', '/api/enroll', {}, {'x-sync': '0'});")
        check('x-sync が無い要求は 403', r['status'] == 403, r)

        # ── 2. 登録 → 空の状態
        r = run("""window.A = client();
            const e = await A.call('POST', '/api/enroll', {});
            const g = await A.call('GET', '/api/state');
            return { e, g, cookie: !!A.cookie };""")
        check('enroll で Cookie が発行される', r['e']['status'] == 200 and r['cookie'], r['e'])
        check('登録直後の状態は空', r['g']['status'] == 200 and r['g']['data']['keys'] == {}, r['g'])

        # ── 3. 新規保存・古い rev の競合・更新
        r = run("""const p1 = await A.call('PUT', '/api/state', {items: [{key: 'favorites', value: '[1]', baseRev: 0}]});
            const p2 = await A.call('PUT', '/api/state', {items: [{key: 'favorites', value: '[2]', baseRev: 0}]});
            const p3 = await A.call('PUT', '/api/state', {items: [{key: 'favorites', value: '[3]', baseRev: 1}]});
            const p4 = await A.call('PUT', '/api/state', {items: [{key: 'favorites', value: '[4]', baseRev: 5}]});
            const g = await A.call('GET', '/api/state');
            return { p1, p2, p3, p4, g };""")
        check('新規保存は rev 1', r['p1']['data']['results']['favorites'] == {'rev': 1}, r['p1'])
        check('同じ baseRev 0 の2回目は競合（サーバー値を添える）',
              r['p2']['data']['results']['favorites'] == {'conflict': True, 'rev': 1, 'value': '[1]'}, r['p2'])
        check('baseRev 1 からの更新は rev 2', r['p3']['data']['results']['favorites'] == {'rev': 2}, r['p3'])
        check('先の rev を名乗る更新も競合', r['p4']['data']['results']['favorites'].get('conflict') is True, r['p4'])
        check('保存した値が読める', r['g']['data']['keys']['favorites'] == {'value': '[3]', 'rev': 2, 'device': False}, r['g'])

        # ── 4. 同時保存（既存のキー）: 同じ baseRev の PUT を同時に2件。通るのは1件だけで、値はその1件のもの
        r = run("""const B = client(A.cookie);
            const [x, y] = await Promise.all([
                A.call('PUT', '/api/state', {items: [{key: 'favorites', value: '"A"', baseRev: 2}]}),
                B.call('PUT', '/api/state', {items: [{key: 'favorites', value: '"B"', baseRev: 2}]}),
            ]);
            const g = await A.call('GET', '/api/state');
            return { x: x.data.results.favorites, y: y.data.results.favorites, now: g.data.keys.favorites };""")
        ok = [v for v in (r['x'], r['y']) if 'rev' in v and not v.get('conflict')]
        win = '"A"' if 'conflict' not in r['x'] else '"B"'
        check('同時保存（既存キー）で通るのは1件だけ', len(ok) == 1, r)
        check('同時保存（既存キー）の結果は通った側の値', len(ok) == 1 and r['now'] == {'value': win, 'rev': 3, 'device': False}, r)

        # ── 5. 同時保存（新しいキー）: baseRev 0 を同時に2件
        r = run("""const B = client(A.cookie);
            const [x, y] = await Promise.all([
                A.call('PUT', '/api/state', {items: [{key: 'prefs', value: '"A"', baseRev: 0}]}),
                B.call('PUT', '/api/state', {items: [{key: 'prefs', value: '"B"', baseRev: 0}]}),
            ]);
            const g = await A.call('GET', '/api/state');
            return { x: x.data.results.prefs, y: y.data.results.prefs, now: g.data.keys.prefs };""")
        ok = [v for v in (r['x'], r['y']) if 'rev' in v and not v.get('conflict')]
        win = '"A"' if 'conflict' not in r['x'] else '"B"'
        check('同時保存（新規キー）で通るのは1件だけ', len(ok) == 1, r)
        check('同時保存（新規キー）の結果は通った側の値', len(ok) == 1 and r['now'] == {'value': win, 'rev': 1, 'device': False}, r)

        # ── 6. 端末専用の保存は共有と別
        r = run("""const p = await A.call('PUT', '/api/state', {items: [{key: 'mapState', value: '"a"', baseRev: 0, scope: 'device'}]});
            const g = await A.call('GET', '/api/state');
            return { p: p.data.results.mapState, k: g.data.keys.mapState };""")
        check('端末専用の保存', r['p'] == {'rev': 1} and r['k'] == {'value': '"a"', 'rev': 1, 'device': True}, r)

        # ── 7. 不正な項目
        r = run("""const p = await A.call('PUT', '/api/state', {items: [{key: '', value: 'x'}, {key: 'k', value: 1}]});
            const q = await A.call('PUT', '/api/state', {});
            return { p: p.data.results, q: q.status };""")
        check('キーが空・値が文字列でない項目は bad_item', r['p'].get('', {}).get('error') == 'bad_item'
              and r['p'].get('k', {}).get('error') == 'bad_item', r)
        check('items が無い PUT は 400', r['q'] == 400, r)

        # ── 8. 引き継ぎ → 参加した端末は共有分だけを受け取る
        r = run("""const h = await A.call('POST', '/api/handover');
            window.C = client();
            const j = await C.call('POST', '/api/join', {code: h.data.short.toLowerCase()});
            const bad = await client().call('POST', '/api/join', {code: 'ZZZZ-ZZZZ'});
            return { h: h.status, j: j.status, keys: j.data.keys, bad: bad.status, cookie: !!C.cookie };""")
        check('手入力コード（小文字でも）で参加できる', r['j'] == 200 and r['cookie'], r)
        check('参加した端末に共有分が届き、他端末専用の分は届かない',
              set(r['keys']) == {'favorites', 'prefs'}, r['keys'])
        check('違うコードでは参加できない', r['bad'] == 404, r)

        # ── 9. 端末一覧・外す・アカウント削除
        r = run("""const d = await A.call('GET', '/api/devices');
            const cId = d.data.devices.find(x => x.id !== d.data.self).id;
            const del = await A.call('DELETE', '/api/devices/' + cId);
            const after = await C.call('GET', '/api/state');
            const acc = await A.call('DELETE', '/api/account');
            const gone = await client(acc.status === 200 ? null : A.cookie).call('GET', '/api/state');
            return { n: d.data.devices.length, del: del.status, after: after.status, acc: acc.status, aCookie: A.cookie, gone: gone.status };""")
        check('端末一覧に2台', r['n'] == 2, r)
        check('外した端末は 401 になる', r['del'] == 200 and r['after'] == 401, r)
        check('アカウント削除で Cookie が消える', r['acc'] == 200 and r['aCookie'] is None, r)
        rows = d1.db.execute('SELECT (SELECT COUNT(*) FROM states) + (SELECT COUNT(*) FROM devices) + (SELECT COUNT(*) FROM users)').fetchone()[0]
        check('アカウント削除で行が残らない', rows == 0, rows)

        browser.close()

    failed = [x for x in results if not x[1]]
    for name, ok, detail in results:
        print(f'[{"OK" if ok else "NG"}] {name}' + ('' if ok else f'\n    {json.dumps(detail, ensure_ascii=False)[:400]}'))
    print('OK' if not failed else f'NG {len(failed)} 件')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
