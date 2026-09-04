    /* ══ 色の定義 ══════════════════════════════════════════════
       同じ #4285F4 が意味の違う3つの用途で使われていたので、意味ごとに分けてある。
       値は3つとも同じだが、片方の色を変えるときにもう片方を巻き込まないよう、
       同じ値でも統合しないこと。

         --ui-blue          現在地・ナビ・GoogleMapボタン・距離・スピナー（CSSの :root）
         UI_BLUE            上と同じもののJS側。CSS変数から読むので定義は1箇所のまま
         CASTLE_MEIJO_COLOR 100名城のピン・クラスタ・選択リング・バッジ
         typeConfig.place   検索結果の「地名」（国土地理院の住所検索の候補）

       100名城の色は以前 objRingColor・地図のmatch式・getItemColor の3箇所に
       直書きされていた。ここに集約して二重管理をやめる。 */
    const UI_BLUE = getComputedStyle(document.documentElement)
        .getPropertyValue('--ui-blue').trim() || '#4285F4';
    const CASTLE_MEIJO_COLOR = '#4285F4';        // 日本100名城
    const CASTLE_ZOKU_MEIJO_COLOR = '#EA4335';   // 続日本100名城

    /* ══ 保存の入口 ══════════════════════════════════════════════
       お気に入り・表示設定・地図位置の保存を1か所に通す。書く側は必ずここを通し、
       localStorage を直に触らないこと。サーバー同期を足すときに直すのがここだけで済む。

       読みは localStorage を直接見る。起動時（下の savedState / savedSettings）は
       同期的に値が要るので、サーバーの応答を待つ形にはできない。
       サーバー側は「控え」で、起動後に届いた分を後から反映する（SYNC_MANUAL.md §4.1）。

       STORE_KEYS はバックアップの書き出し・読み込みが回す一覧でもある。
       保存キーを増やしたらここに足すこと。 */
    const STORE_KEYS = ['favorites', 'settingsState', 'mapState', 'mapTileSource',
                        'hotelRadius', 'hotelSort', 'travelMode', 'nearbyTypeFilterOff'];
    function storeGet(key) {
        try { return localStorage.getItem(key); } catch { return null; }
    }
    function storeGetJson(key) {
        try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
    }
    function storeSet(key, value) {
        try { localStorage.setItem(key, value); }
        catch (e) { console.warn('[store]', key, e); return; }
        syncPush(key);
    }
    function storeSetJson(key, obj) { storeSet(key, JSON.stringify(obj)); }
    /* ══ サーバー同期 ══════════════════════════════════════════════
       設計は SYNC_MANUAL.md。要点だけ再掲する。
         ・ログイン画面は無い。最初にお気に入りか表示設定を保存した時点で、サーバーが
           無記名のキーを発行して HttpOnly Cookie に入れる（/api/enroll）
         ・localStorage が正。画面は今までどおり即座に立ち上がり、送受信は裏で回す
         ・サーバー上のキーは5つ。favorites / settingsState / prefs は全端末で共有し、
           mapState と mapTileSource は端末ごと（端末によって意味が違うため）
         ・送信には rev（サーバー側の更新回数）を添える。食い違えば取り込んでから送り直す

       競合したときにどちらを採るか:
         favorites … 項目ごとの at で新しいほうを採って混ぜる（墓標があるので削除も伝わる）
         それ以外  … この端末の値を採る。ユーザーがいま操作した端末だから */
    const SYNC_PREFS_KEYS = ['hotelRadius', 'hotelSort', 'travelMode', 'nearbyTypeFilterOff'];
    /* 端末ごとに持つキー。scope:'device' で送るので、他の端末には出ない。
         mapState      … PWA再起動時の復元用。共有すると、PCで見ていた位置に
                         スマホの起動位置が引っ張られる
         mapTileSource … 端末によって向き不向きが違う（回線の速さも描画の重さも端末ごとに違う）。
                         共有していると、PCで配信元を変えた瞬間にスマホまで巻き込まれる
       どちらもサーバーには保存する。ただし device_id 付きなので、他の端末には配られない。 */
    const SYNC_DEVICE_KEYS = ['mapState', 'mapTileSource'];
    const SYNC_META_KEY = 'syncMeta';        // 同期の覚え書き。バックアップの対象には入れない
    const SYNC_KEEPALIVE_MAX = 60000;        // pagehide で送るときの本文の上限（ブラウザ側の制限）

    function syncMeta() {
        try { return JSON.parse(localStorage.getItem(SYNC_META_KEY)) || {}; } catch { return {}; }
    }
    function syncMetaSet(patch) {
        const m = Object.assign(syncMeta(), patch);
        try { localStorage.setItem(SYNC_META_KEY, JSON.stringify(m)); } catch {}
        return m;
    }
    function syncOn() { return syncMeta().on === true; }
    /* 「一度は同期していたが、今は止まっている」印。次の3つで立つ。
         ・他の端末から外された／保存領域ごと消された（APIが401を返した）
         ・この端末の同期をやめた
         ・保存領域を削除した
       これが無いと、止まった直後にお気に入りを1つ付けただけで syncEnroll が走り、
       別の保存領域が黙って作り直される。利用者からは同期が止まったように見えるのに、
       裏では新しい無記名の領域に溜まり続けることになる（SYNC_MANUAL.md §5.9）。
       もう一度共有するには「端末を追加」か、他の端末のQRから参加する。 */
    function syncStopped() { return syncMeta().stopped === true; }
    function syncRev(k) { return Number((syncMeta().rev || {})[k]) || 0; }
    function syncSetRev(k, v) { const rev = syncMeta().rev || {}; rev[k] = Number(v) || 0; syncMetaSet({ rev }); }

    function syncServerKey(key) {
        if (key === 'favorites' || key === 'settingsState') return key;
        if (SYNC_DEVICE_KEYS.includes(key)) return key;
        return SYNC_PREFS_KEYS.includes(key) ? 'prefs' : null;
    }
    function syncValueOf(sk) {
        if (sk !== 'prefs') return storeGet(sk);
        const o = {};
        SYNC_PREFS_KEYS.forEach(k => { const v = storeGet(k); if (v != null) o[k] = v; });
        return JSON.stringify(o);
    }
    // サーバー→ローカル。ここでは localStorage に直接書く（書いた分を送り返さないため）
    function syncApplyValue(sk, value) {
        if (typeof value !== 'string') return false;
        try {
            if (sk === 'prefs') {
                const o = JSON.parse(value);
                if (!o || typeof o !== 'object') return false;
                SYNC_PREFS_KEYS.forEach(k => { if (typeof o[k] === 'string') localStorage.setItem(k, o[k]); });
                return true;
            }
            localStorage.setItem(sk, value);
            return true;
        } catch (e) { console.warn('[sync]', sk, e); return false; }
    }

    function syncFetch(path, options) {
        const opt = Object.assign({ credentials: 'same-origin' }, options || {});
        // CSRF よけの独自ヘッダ。他サイトから付けるには事前確認が要り、こちらは許可していない
        opt.headers = Object.assign({ 'x-sync': '1' }, opt.headers || {});
        if (opt.body) opt.headers['content-type'] = 'application/json';
        return fetch('./api/' + path, opt);
    }

    let syncDirty = new Set(), syncTimer = null, syncTimerAt = 0, syncBusy = false;

    function syncPush(key) {
        const sk = syncServerKey(key);
        if (!sk) return;
        if (!syncOn()) {
            // 一度止めた（外された）端末では、勝手に別の保存領域を作り直さない
            if (syncStopped()) return;
            /* まだ保存領域が無いときは、お気に入りか表示設定を触った場合だけ作る。
               地図を動かしただけの訪問者にまで行を作らないため（SYNC_MANUAL.md §6）。 */
            if (sk !== 'favorites' && sk !== 'settingsState') return;
        }
        syncDirty.add(sk);
        // 地図位置は動かすたびに保存されるので、送るのは30秒に1回と画面を離れるとき
        syncSchedule(sk === 'mapState' ? 30000 : 2000);
    }
    function syncSchedule(delay) {
        const at = Date.now() + delay;
        if (syncTimer && syncTimerAt <= at) return;
        clearTimeout(syncTimer);
        syncTimerAt = at;
        syncTimer = setTimeout(() => { syncTimer = null; syncFlush(); }, delay);
    }
    function syncFlushNow(keepalive) {
        if (syncTimer) { clearTimeout(syncTimer); syncTimer = null; }
        syncFlush(keepalive);
    }

    async function syncEnroll() {
        const res = await syncFetch('enroll', { method: 'POST', body: '{}' });
        if (!res.ok) return false;
        syncMetaSet({ on: true, stopped: false, rev: {} });
        syncUpdateUi();
        return true;
    }

    /* 同期が止まったときの後始末。手元のお気に入りと設定は消さない
       （消せるのはサーバー側だけで、渡したものは取り消せない・SYNC_MANUAL.md §5.5）。
       notify を付けるのは401で気付いたときだけ。自分で止めた場合は操作側が知らせる。 */
    function syncMarkStopped(notify) {
        const already = !syncOn() && syncStopped();
        syncMetaSet({ on: false, stopped: true, rev: {} });
        syncDirty.clear();                     // 送れないものを抱え続けない
        syncUpdateUi();
        if (notify && !already) {
            showToast('この端末は同期から外れました。ここでの保存は、この端末だけに残ります');
        }
    }

    async function syncFlush(keepalive) {
        if (syncBusy || !syncDirty.size) return;
        if (navigator.onLine === false) return;         // 溜めたまま online を待つ
        syncBusy = true;
        const keys = [...syncDirty];
        /* 送れなかったぶんを抱えたまま止まらないよう、間を置いて自分でもう一度試す。
           これが無いと、一度の通信失敗のあとは次に何かを保存するまで送信が再開せず、
           その端末の変更が他の端末に出ないままになる。
           登録（/api/enroll）に失敗したときだけは繰り返さない（1時間5回までのため）。 */
        let retryDelay = 0;
        try {
            // 止めた端末では作り直さない（syncPush でも止めているが、溜まっていた分の保険）
            if (!syncOn() && syncStopped()) { syncDirty.clear(); return; }
            if (!syncOn() && !(await syncEnroll())) return;
            syncDirty.clear();
            const items = keys.map(sk => ({
                key: sk, value: syncValueOf(sk), baseRev: syncRev(sk),
                scope: SYNC_DEVICE_KEYS.includes(sk) ? 'device' : 'shared',
            })).filter(it => typeof it.value === 'string');
            if (!items.length) return;
            const body = JSON.stringify({ items });
            const opt = { method: 'PUT', body };
            if (keepalive && body.length < SYNC_KEEPALIVE_MAX) opt.keepalive = true;
            const res = await syncFetch('state', opt);
            if (res.status === 401) { syncMarkStopped(true); return; }   // 端末が外された
            if (!res.ok) { keys.forEach(k => syncDirty.add(k)); retryDelay = 15000; return; }
            const data = await res.json();
            for (const [sk, r] of Object.entries(data.results || {})) {
                if (!r) continue;
                if (r.conflict) {
                    if (sk === 'favorites' && typeof r.value === 'string') favMergeFromServer(r.value);
                    syncSetRev(sk, r.rev);
                    syncDirty.add(sk);                   // 取り込んだ内容で送り直す
                } else if (r.rev) {
                    syncSetRev(sk, r.rev);
                }
            }
            syncUpdateUi();
            if (syncDirty.size) syncSchedule(1500);
        } catch (e) {
            keys.forEach(k => syncDirty.add(k));         // 通信できなかった分は次に回す
            retryDelay = 15000;
            console.warn('[sync]', e);
        } finally {
            syncBusy = false;
            if (retryDelay && syncDirty.size) syncSchedule(retryDelay);
        }
    }

    /* 取り込みのきっかけ。保存領域が無い端末では通信そのものを行わない。

       `load` だけを見ていると、他の端末の変更が「更新ボタンを押したとき」しか届かない。
       スマホのPWAはアイコンを叩いても既存の画面が復帰するだけで `load` は発火せず、
       bfcache から戻った場合も同じ（MDN に明記）。そこで次の2つを入口にする。
         pageshow           … 通常の読み込みに加え、bfcache と凍結からの復帰も拾う
         visibilitychange   … アプリ切り替え・画面ロック解除からの復帰を拾う
       復帰のたびに投げないよう、前回の取り込みから30秒は間を空ける。 */
    const SYNC_RESUME_MIN_MS = 30000;
    let syncLastPull = 0;

    function syncPullIfDue(fresh) {
        if (!syncOn()) { syncUpdateUi(); return; }
        if (!fresh && Date.now() - syncLastPull < SYNC_RESUME_MIN_MS) return;
        return syncPull({ reload: !!fresh });
    }

    async function syncPull(opts) {
        /* 読み直しをかけるのは、ページを読み込んだ直後の1回だけ。復帰のときに走らせると、
           操作している最中に画面が作り直される。復帰時は値だけ受け取り、
           表示設定と prefs が効くのは次に起動したときからにする（お気に入りは即時反映）。 */
        const allowReload = !opts || opts.reload !== false;
        if (!syncOn()) { syncUpdateUi(); return; }
        syncLastPull = Date.now();
        try {
            const res = await syncFetch('state', { method: 'GET' });
            if (res.status === 401) { syncMarkStopped(true); return; }   // 端末が外された
            if (!res.ok) return;
            const data = await res.json();
            syncApplyKeys(data.keys, allowReload);
        } catch (e) { console.warn('[sync]', e); }
    }

    /* サーバーから受け取った分をローカルへ反映する。GET の応答と、参加（join）の応答の
       どちらもこの形で返るので、取り込みは1か所にまとめてある。 */
    function syncApplyKeys(keys, allowReload) {
        let reloadShared = false, reloadDevice = false;
        for (const [sk, r] of Object.entries(keys || {})) {
            const rev = Number(r.rev) || 0;
            if (rev <= syncRev(sk)) continue;
            /* 混ぜ終えたあと、こちらにしか無いものが残っていたら送り返す。
               取り込むと rev がサーバーに揃うので、ここで送信予約を立てておかないと、
               その項目は二度と送られず、この端末だけのものになったまま残る。 */
            if (sk === 'favorites') {
                const ahead = favMergeFromServer(r.value);
                syncSetRev(sk, rev);
                if (ahead) { syncDirty.add('favorites'); syncSchedule(2000); }
            }
            else if (syncApplyValue(sk, r.value)) {
                syncSetRev(sk, rev);
                // 地図位置は起動後に動かすと操作の邪魔になるので、効くのは次回起動から
                if (sk === 'settingsState' || sk === 'prefs') reloadShared = true;
                /* 地図タイルは端末ごとなので、ここへ届くのは同じ端末の別の画面
                   （ホーム画面のアプリとブラウザのタブ。Cookie が同じなので同じ端末になる）で
                   変えたときだけ。起動直後なら読み直して揃えるが、知らせは出さない。
                   変えたのは他の端末ではないため、下のトーストの文面が合わない。 */
                else if (sk === 'mapTileSource') reloadDevice = true;
            }
        }
        syncUpdateUi();
        const reload = reloadShared || reloadDevice;
        /* 表示設定は画面の広い範囲に効くので、読み込み直後の1回だけ読み直して揃える
           （繰り返さないよう、このタブでは1回に制限する）。
           復帰したときは画面を作り直さず、受け取ったことだけ知らせて次の起動に委ねる。 */
        if (reload && allowReload && !sessionStorage.getItem('syncReloaded')) {
            sessionStorage.setItem('syncReloaded', '1');
            location.reload();
        } else if (reloadShared && !allowReload) {
            showToast('他の端末で表示設定が変わりました。次に開き直したときに反映されます');
        }
        return reload;
    }

    /* サーバーのお気に入りを項目ごとに混ぜる。at が新しいほうを採る。
       mk が空の項目（墓標）も同じ扱いなので、他の端末で外した印は復活しない。
       枠の名前は時刻を持たないため、食い違ったらサーバー側（＝後から書かれたほう）を採る。

       返す値は「混ぜ終えたあと、こちらにしか無いもの・こちらのほうが新しいものが
       残っているか」。呼び出し側はこれを見て送り返しを予約する（形が壊れていたら false）。 */
    function favMergeFromServer(text) {
        let remote = null;
        try { remote = JSON.parse(text); } catch { return false; }
        if (!remote || typeof remote !== 'object') return false;
        const rItems = (remote.items && typeof remote.items === 'object') ? remote.items : {};
        favMergeItems(rItems);
        if (remote.names && typeof remote.names === 'object') {
            FAV_SLOTS.forEach(n => {
                if (typeof remote.names[n] === 'string') favStore.names[n] = remote.names[n];
            });
        }
        favWriteStore();          // ここでは localStorage に書くだけ（送るかは呼び出し側が決める）
        favRefreshAll();
        for (const [k, v] of Object.entries(favStore.items)) {
            const rv = rItems[k];
            if (!rv || (Number(rv.at) || 0) < (Number(v.at) || 0)) return true;
        }
        return false;
    }
    function favRefreshAll() {
        try {
            refreshFavOverlay();
            updateFavNameCounts();
            updateFavEntry();
            renderFavNameList();
        } catch (e) { console.warn('[fav]', e); }
    }

    /* ══ 同期の画面（設定の区画・端末を追加・端末の管理） ══════════════ */
    const SYNC_QR_LIB = 'https://unpkg.com/qrcode-generator@1.4.4/qrcode.js';
    let syncQrLoaded = false;
    const syncAdd = { short: '', expiresAt: 0, tick: 0, poll: 0, seen: 0 };
    let syncSelfId = '';

    /* 状態は3つある。「まだ一度も同期していない」と「一度は同期していたが止まっている」を
       同じ文言にすると、後者で「お気に入りを付ければ自動で始まります」と案内することになり、
       実際には始まらない（syncStopped のコメント）ので、分けて出す。 */
    function syncUpdateUi() {
        const el = document.getElementById('sync-state');
        if (!el) return;
        const on = syncOn();
        const stopped = !on && syncStopped();
        const head = on ? 'この端末は同期しています'
                        : stopped ? '同期は止まっています' : 'この端末だけで保存しています';
        const note = on ? '「端末を追加」で、他の端末も同じ内容にできます'
                        : stopped ? '保存はこの端末だけに残ります。もう一度共有するには「端末を追加」か、他の端末のQRから参加してください'
                                  : 'お気に入りか表示設定を変えた時点で、自動で同期を始めます';
        el.innerHTML = `<span class="sync-dot${on ? '' : ' off'}"></span>`
            + `<span class="sync-txt">${head}<small>${note}</small></span>`;
    }

    // 「2分前」「3時間前」「8月20日」。端末一覧と参加の通知で使う
    function syncWhen(ms) {
        const d = Date.now() - Number(ms || 0);
        if (d < 60000) return 'たった今';
        if (d < 3600000) return `${Math.floor(d / 60000)}分前`;
        if (d < 86400000) return `${Math.floor(d / 3600000)}時間前`;
        const t = new Date(Number(ms));
        return `${t.getMonth() + 1}月${t.getDate()}日`;
    }

    function showSyncView(id) {
        setPanelLifted(true);
        document.getElementById('nearby-main-view').style.display = 'none';
        document.getElementById('nearby-settings-view').classList.remove('open');
        document.getElementById(id).classList.add('open');
    }

    /* 端末を追加。引き継ぎ券が有効なのはこの画面を開いている間だけで、
       閉じたときに DELETE で消す（押し忘れてもサーバー側で最大10分）。 */
    async function openSyncAddView() {
        /* 外れた端末からここを押すと、元の共有に戻るのではなく新しい保存領域が作られる
           （サーバーは無記名で、外れた端末から元の領域を指す手がかりが無い）。
           押した人にはそう見えないので、始める前に断っておく。 */
        if (!syncOn() && syncStopped()
            && !confirm('この端末は同期から外れています。\n\nここから始めるのは新しい共有で、'
                + '外れる前の内容には戻りません。\nこの端末に今あるお気に入りと設定を持ち込んで、'
                + '新しく共有を始めます。\n\n元の共有に戻すには、そちらの端末でQRを出して'
                + 'この端末に読ませてください。\n\n進めますか？')) return;
        showSyncView('nearby-sync-add-view');
        document.getElementById('sync-qr').innerHTML = '';
        document.getElementById('sync-code').textContent = '····';
        document.getElementById('sync-joined').innerHTML = '';
        document.getElementById('sync-timer').textContent = '';
        syncAdd.seen = 0;
        try {
            if (!syncOn() && !(await syncEnroll())) { showToast('同期を始められませんでした'); return; }
            const res = await syncFetch('handover', { method: 'POST' });
            if (!res.ok) { showToast('コードを作れませんでした'); return; }
            const data = await res.json();
            syncAdd.short = data.short;
            syncAdd.expiresAt = Number(data.expiresAt) || 0;
            document.getElementById('sync-code').textContent = data.short;
            const base = location.origin + location.pathname.replace(/[^/]*$/, '');
            await syncRenderQr(base + '#join=' + data.code);
            syncAddTick();
            syncAdd.tick = setInterval(syncAddTick, 1000);
            syncPollJoined();
            syncAdd.poll = setInterval(syncPollJoined, 4000);
        } catch (e) {
            console.warn('[sync]', e);
            showToast('コードを作れませんでした');
        }
    }
    async function syncRenderQr(url) {
        if (!syncQrLoaded) { await loadScriptOnce(SYNC_QR_LIB); syncQrLoaded = true; }
        const qr = qrcode(0, 'M');
        qr.addData(url);
        qr.make();
        document.getElementById('sync-qr').innerHTML =
            qr.createSvgTag({ cellSize: 2, margin: 0, scalable: true, alt: 'QRコード' });
    }
    function syncAddTick() {
        const el = document.getElementById('sync-timer');
        if (!el) return;
        const left = Math.max(0, syncAdd.expiresAt - Date.now());
        const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
        el.textContent = left > 0
            ? `● この画面を閉じると無効になります（残り ${m}:${String(s).padStart(2, '0')}）`
            : '● 期限が切れました。開き直してください';
    }
    async function syncPollJoined() {
        try {
            const res = await syncFetch('devices', { method: 'GET' });
            if (!res.ok) return;
            const data = await res.json();
            syncSelfId = data.self || '';
            const others = (data.devices || []).filter(d => d.id !== data.self);
            const el = document.getElementById('sync-joined');
            if (!el) return;
            el.innerHTML = others.length
                ? others.map(d => `<div class="dev-row"><span style="color:#2E7D32;font-weight:700;">✓</span>`
                    + `<span class="dev-n">${attrEscape(d.name)}</span>`
                    + `<span class="fxp-rt">${syncWhen(d.createdAt)}</span></div>`).join('')
                : '<p class="fxp-note">まだありません。追加する端末でQRを読んでください</p>';
            if (others.length > syncAdd.seen && syncAdd.seen > 0) showToast('端末が参加しました');
            syncAdd.seen = others.length;
        } catch (e) { /* 一時的な失敗は次の周期で拾う */ }
    }
    /* 「端末を追加」から離れるときの後始末。引き継ぎ券が有効なのはこの画面を開いている
       間だけなので、離れたら消す（押し忘れてもサーバー側で最大10分）。
       画面を畳んで設定へ戻る場合も、メニューごと閉じる場合も、通るのはここ。 */
    function stopSyncAdd() {
        if (!syncAdd.tick && !syncAdd.poll) return;
        clearInterval(syncAdd.tick); clearInterval(syncAdd.poll);
        syncAdd.tick = syncAdd.poll = 0;
        syncFetch('handover', { method: 'DELETE' }).catch(() => { /* 期限切れに任せる */ });
    }
    function closeSyncAddView() {
        stopSyncAdd();
        document.getElementById('nearby-sync-add-view').classList.remove('open');
        openSettingsView();
    }
    /* メニューを閉じたときの後始末。同期の2ビューはビューを畳まずに離れられるため、
       畳み直すのは開き直したとき（openNearbyPanel）で、他のビューと同じ扱いにする。
       これが無いと、次にメニューを開いたときメインビューと同期のビューが同時に出る。 */
    function resetSyncViews() {
        stopSyncAdd();
        document.getElementById('nearby-sync-add-view').classList.remove('open');
        document.getElementById('nearby-sync-devices-view').classList.remove('open');
    }

    // 受け取る側。手入力のコードで参加する
    function syncJoinByCode() {
        const el = document.getElementById('sync-join-input');
        const code = (el.value || '').trim();
        if (code.length < 8) { showToast('コードを入れてください'); return; }
        el.value = '';
        syncJoin(code);
    }
    // QRから開いたとき。コードはフラグメントなのでサーバーには送られない。履歴からも消す
    function syncJoinFromUrl() {
        const m = /[#&]join=([A-Za-z0-9_-]+)/.exec(location.hash || '');
        if (!m) return;
        const code = m[1];
        history.replaceState(null, '', location.pathname + location.search);
        syncJoin(code);
    }
    async function syncJoin(code) {
        const hasLocal = !!storeGet('favorites');
        if (!confirm('この端末を追加します。\n\nお気に入りと表示設定が、もう一方の端末と共有されます。\n'
            + (hasLocal ? 'この端末に今あるお気に入りは、共有側と混ぜて残します。\n' : '')
            + '地図の表示位置と地図タイルは、端末ごとに別々のままです。\n\n進めますか？')) return;
        try {
            const res = await syncFetch('join', { method: 'POST', body: JSON.stringify({ code }) });
            if (res.status === 404) { showToast('このコードは使えません。追加する側の画面を開き直してください'); return; }
            if (!res.ok) { showToast('参加できませんでした'); return; }
            const data = await res.json().catch(() => ({}));
            syncMetaSet({ on: true, stopped: false, rev: {} });
            /* 共有分は参加の応答に載って返るので、ここで GET を投げ直さない */
            syncApplyKeys(data.keys, false);       // お気に入りはここで混ざる
            syncDirty.add('favorites');            // 混ざった結果を送り返す
            await syncFlush();
            showToast('この端末を追加しました。画面を読み直します');
            setTimeout(() => location.reload(), 900);
        } catch (e) {
            console.warn('[sync]', e);
            showToast('参加できませんでした');
        }
    }

    /* 端末の管理 */
    async function openSyncDevicesView() {
        showSyncView('nearby-sync-devices-view');
        const list = document.getElementById('sync-dev-list');
        if (!syncOn()) {
            document.getElementById('sync-dev-sec').textContent = '共有している端末';
            list.innerHTML = syncStopped()
                ? '<p class="fxp-note">この端末は同期から外れています。'
                    + 'お気に入りと設定はこの端末に残ったままで、これ以降は別々に育ちます。<br>'
                    + 'もう一度共有するには「端末を追加」を押すか、他の端末のQRから参加してください</p>'
                : '<p class="fxp-note">この端末はまだ同期していません。'
                    + '「端末を追加」を押すか、お気に入りを付けると始まります</p>';
            return;
        }
        list.innerHTML = '<p class="fxp-note">読み込み中です…</p>';
        try {
            const res = await syncFetch('devices', { method: 'GET' });
            if (res.status === 401) { syncMarkStopped(true); openSyncDevicesView(); return; }
            if (!res.ok) { list.innerHTML = '<p class="fxp-note">読み込めませんでした</p>'; return; }
            const data = await res.json();
            syncSelfId = data.self || '';
            renderSyncDevices(data.devices || []);
        } catch (e) {
            list.innerHTML = '<p class="fxp-note">読み込めませんでした（通信できていません）</p>';
        }
    }
    /* onclick に渡すのは id だけにする。id は乱数（A-Za-z0-9_-）なので引用符が入らない。
       名前は attrEscape が ' を素通しするため、属性の中に埋めない。 */
    let syncDevicesCache = [];
    function renderSyncDevices(devices) {
        syncDevicesCache = devices;
        document.getElementById('sync-dev-sec').textContent = `共有している端末（${devices.length}台）`;
        document.getElementById('sync-dev-list').innerHTML = devices.map(d => {
            const self = d.id === syncSelfId;
            return `<div class="dev-row"><span class="dev-n">${attrEscape(d.name)}`
                + (self ? '<span class="dev-self">この端末</span>' : '')
                + `<small>${syncWhen(d.createdAt)}から ・ 最終 ${syncWhen(d.lastSeenAt)}</small></span>`
                + (self ? '' : `<button class="dev-x" onclick="syncRemoveDevice(&quot;${attrEscape(d.id)}&quot;)">外す</button>`)
                + '</div>';
        }).join('');
    }
    async function syncRemoveDevice(id) {
        const found = syncDevicesCache.find(d => d.id === id);
        const name = found ? found.name : 'この端末';
        if (!confirm(`「${name}」を外しますか？\n\nこの端末との同期が止まります。\n`
            + 'その端末に今あるお気に入りは消えません。手元に残ったまま、これ以降は別々に育ちます。')) return;
        try {
            const res = await syncFetch('devices/' + encodeURIComponent(id), { method: 'DELETE' });
            if (!res.ok) { showToast('外せませんでした'); return; }
            showToast(`${name} を外しました`);
            openSyncDevicesView();
        } catch (e) { showToast('外せませんでした'); }
    }
    async function syncLeaveThisDevice() {
        if (!syncOn()) { showToast('この端末は同期していません'); return; }
        if (!confirm('この端末の同期をやめます。\n\n他の端末はそのまま共有を続けます。\n'
            + 'この端末のお気に入りと設定は、手元に残ったままです。\n\nよろしいですか？')) return;
        try {
            const res = await syncFetch('devices/' + encodeURIComponent(syncSelfId || 'self'), { method: 'DELETE' });
            if (!res.ok) { showToast('やめられませんでした'); return; }
        } catch (e) { showToast('やめられませんでした'); return; }
        syncMarkStopped(false);        // 知らせるのはこの下の1行に任せる
        showToast('この端末の同期をやめました');
        openSyncDevicesView();
    }
    async function syncDeleteAccount() {
        if (!syncOn()) { showToast('この端末は同期していません'); return; }
        if (!confirm('サーバー上の共有内容と、全端末の結び付きを削除します。\n\n'
            + '各端末に残っているお気に入りは消えません。\nこの操作は取り消せません。\n\n削除しますか？')) return;
        try {
            const res = await syncFetch('account', { method: 'DELETE' });
            if (!res.ok) { showToast('削除できませんでした'); return; }
        } catch (e) { showToast('削除できませんでした'); return; }
        syncMarkStopped(false);        // 知らせるのはこの下の1行に任せる
        showToast('保存領域を削除しました');
        openSyncDevicesView();
    }
    function closeSyncDevicesView() {
        document.getElementById('nearby-sync-devices-view').classList.remove('open');
        openSettingsView();
    }

    window.addEventListener('pagehide', () => syncFlushNow(true));
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') syncFlushNow(true);
        else syncPullIfDue(false);          // 背面から戻ったとき
    });
    window.addEventListener('online', () => { if (syncDirty.size) syncSchedule(500); });
    window.addEventListener('pageshow', (e) => {
        if (e.persisted) { syncPullIfDue(false); return; }   // bfcache・凍結からの復帰
        syncJoinFromUrl();                                    // 通常の読み込み
        syncPullIfDue(true);
    });

    /* ══ バックアップ（書き出し／読み込み） ══════════════════════════
       STORE_KEYS をまとめて1つのJSONにする。サーバーもログインも通らない経路で、
       端末が変わったときの持ち運びと、消えたときの備えを兼ねる（SYNC_MANUAL.md §5.10）。
       読み込みは「置き換え」で、統合はしない。混ぜると、どちらの削除が生きるのかを
       決める材料が無いため（時刻を持っているのはお気に入りだけ）。 */
    const BACKUP_FORMAT = 'geopenguin-backup';
    function backupFilename() {
        const d = new Date(), p = n => String(n).padStart(2, '0');
        return `カスタムマップ設定-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.json`;
    }
    function backupExport() {
        const data = {};
        STORE_KEYS.forEach(k => { const v = storeGet(k); if (v != null) data[k] = v; });
        const text = JSON.stringify({ format: BACKUP_FORMAT, v: 1, at: new Date().toISOString(), data }, null, 1);
        const name = backupFilename();
        const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        // iOS のホーム画面起動では保存が黙って何も起きないことがある（書き出しビューと同じ事情）
        showToast(isIosStandalonePwa()
            ? `${name} を保存しました。何も起きないときは通常のブラウザで開いて試してください`
            : `${name} を保存しました`);
    }
    function backupImport(input) {
        const file = input.files && input.files[0];
        input.value = '';                     // 同じファイルを続けて選べるようにする
        if (!file) return;
        const reader = new FileReader();
        reader.onerror = () => showToast('ファイルを読めませんでした');
        reader.onload = () => {
            let obj = null;
            try { obj = JSON.parse(String(reader.result)); } catch { obj = null; }
            if (!obj || obj.format !== BACKUP_FORMAT || !obj.data || typeof obj.data !== 'object') {
                showToast('このファイルは読み込めません');
                return;
            }
            const keys = STORE_KEYS.filter(k => typeof obj.data[k] === 'string');
            if (!keys.length) { showToast('中身が空でした'); return; }
            const when = String(obj.at || '').slice(0, 10);
            if (!confirm(`いまのお気に入りと表示設定を、このファイルの内容に置き換えます。\n`
                + `${when ? when + ' に書き出したもの・' : ''}${keys.length}項目\n\nよろしいですか？`)) return;
            keys.forEach(k => storeSet(k, obj.data[k]));
            showToast('読み込みました。画面を読み直します');
            setTimeout(() => location.reload(), 900);
        };
        reader.readAsText(file);
    }

    // ── 天気ウィジェット（スクリプト先頭で初期化）──────────────────
    // WMOコード → スタンプアイコンのファイル名（weather-icons/stamp/＜名前＞.png）
    var WMO_ICON = {
        0:'clear-day', 1:'partly-cloudy-day', 2:'cloudy', 3:'overcast-day',
        45:'fog', 48:'fog',
        51:'drizzle', 53:'drizzle', 55:'drizzle', 56:'drizzle', 57:'drizzle',
        61:'rain', 63:'rain', 65:'rain', 66:'rain', 67:'rain',
        71:'snow', 73:'snow', 75:'snow', 77:'snow',
        80:'partly-cloudy-day-rain', 81:'partly-cloudy-day-rain', 82:'partly-cloudy-day-rain',
        85:'partly-cloudy-day-snow', 86:'partly-cloudy-day-snow',
        95:'thunderstorms-day-rain', 96:'thunderstorms-day-rain', 99:'thunderstorms-day-rain',
    };
    // アイコン名 → 天気別カラー（CSS maskのbackground-colorに使用）
    var WMO_COLOR = {
        'clear-day':'#FB8C00', 'partly-cloudy-day':'#F59E0B', 'cloudy':'#607D8B', 'overcast-day':'#546E7A',
        'fog':'#78909C', 'drizzle':'#0288D1', 'rain':'#1976D2', 'partly-cloudy-day-rain':'#1E88E5',
        'snow':'#0097A7', 'partly-cloudy-day-snow':'#26A69A', 'thunderstorms-day-rain':'#5E35B1',
    };
    var weatherCache = null;
    var weatherCacheTime = 0;
    var weatherCacheLat = null;
    var weatherCacheLng = null;
    var selectedWeatherDayIndex = null;
    var WEATHER_CACHE_TTL = 10 * 60 * 1000;

    // ── 大容量データの非同期ローダ ─────────────────────────────────
    // data/castle/michi/manhole/pokemon/mhcard はここで動的に読み込む。
    // 各データ到着時に対応する地図ソースを埋め、検索インデックスを再構築する。
    // 表示中レイヤーを優先し、残りは背景で逐次取得（全件検索を維持）。
    const EMPTY_FC = { type: 'FeatureCollection', features: [] };
    const FAMOUS_GENRES = new Set(['日本100名城', '続日本100名城']);
    const loadedData = Object.create(null); // key -> FeatureCollection

    function loadScriptOnce(src) {
        return new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = src; s.async = true;
            s.onload = () => resolve();
            s.onerror = () => reject(new Error('load failed: ' + src));
            document.head.appendChild(s);
        });
    }

    function setSourceData(id, fc) {
        const src = map.getSource(id);
        if (src) src.setData(fc);
    }

    /* 食べログの部門・ポケふたは、レイヤーの visibility では出し入れできない。
       どちらもソースの中の一部（部門／source:'pokefuta'）だけを消す話で、
       shops と manholes は cluster:true のためクラスタの件数がソース側で決まるからで、
       レイヤーに filter を掛けても丸の中の数字は絞る前のままになる。
       そこで、表示設定を反映した features をソースへ入れ直す。
       件数は食べログ7,077・マンホール1,267・ポケふた482で、入れ直しは一瞬で済む。 */
    function shopFeaturesForMap() {
        const fc = loadedData.shops;
        if (!fc) return EMPTY_FC;
        if (!genreOff.size) return fc;   // 絞っていないときは元の配列をそのまま渡す
        return { type: 'FeatureCollection',
                 features: fc.features.filter(f => genreVisible(shopGenreBase(f.properties.category))) };
    }
    function manholeFeaturesForMap() {
        // 蓋とポケふたは1つのソースに同居している。ポケふたは source:'pokefuta' で見分ける
        const mh = (filterState.manhole !== false && loadedData.manhole) ? loadedData.manhole.features : [];
        const pk = (filterState.pokefuta !== false && loadedData.pokefuta)
            ? loadedData.pokefuta.features.map(f => ({ ...f, properties: { ...f.properties, source: 'pokefuta' } })) : [];
        return { type: 'FeatureCollection', features: [...mh, ...pk] };
    }
    function refreshShopSource()    { setSourceData('shops',    shopFeaturesForMap()); }
    function refreshManholeSource() { setSourceData('manholes', manholeFeaturesForMap()); }

    // 各データ到着時にソースへ反映（manholeは2データの合成、castleは2分割）
    function applyDataset(key) {
        if (key === 'michi')  setSourceData('michi',   loadedData.michi);
        if (key === 'shops')  refreshShopSource();
        if (key === 'mhcard') setSourceData('mhcards', loadedData.mhcard);
        if (key === 'castle' && loadedData.castle) {
            const feats = loadedData.castle.features;
            setSourceData('castles-famous', { type: 'FeatureCollection', features: feats.filter(f => FAMOUS_GENRES.has(f.properties.genre)) });
            setSourceData('castles',        { type: 'FeatureCollection', features: feats.filter(f => !FAMOUS_GENRES.has(f.properties.genre)) });
            lordIndex = null;        // 城データが入れ替わったら城主索引は作り直す
            updateLordsEntry();
            remainsIndex = null;     // 遺構索引も同じ理由で作り直す
            remainsGroups = null;
            updateRemainsEntry();
        }
        if (key === 'manhole' || key === 'pokefuta') refreshManholeSource();
        buildSearchIndex(); // 到着済みデータで全件検索を再構築
        refreshFavOverlay();     // お気に入りの重ね描きは searchIndex から作るので、揃えて作り直す
        prefIndex = null;   // 都道府県索引は searchIndex から組むので作り直させる
        objGenreCounts = null;   // 部門の件数も searchIndex から数えるので数え直させる
        updatePrefEntry();
        // 設定を開いたまま食べログが届いたときのために、開いていれば描き直す
        if (document.getElementById('nearby-settings-view').classList.contains('open')) renderObjFilterUI();
        // 書き出しを開いたまま残りのデータが届くことがある。件数と可否を出し直す
        renderFavExport();
    }

    // 表示中レイヤーを優先して逐次ロード（パースのジャンクを抑えるため直列）
    function startDataLoading() {
        // 並びは種別の共通順（食べログ→ポケふた→マンホール→カード配布→道の駅→城）。
        // 下の sort は安定なので、表示中グループ・非表示グループそれぞれの中では
        // この順のまま読む。地図のピンの重なり順（configs）とは別物で揃える必要はない
        const specs = [
            { key: 'shops',    src: 'data.js',    get: () => shopData,          vis: filterState.shop    !== false },
            { key: 'pokefuta', src: 'pokemon.js', get: () => pokefutaGeoJSON,   vis: filterState.pokefuta !== false },
            { key: 'manhole',  src: 'manhole.js', get: () => manholeGeoJSON,    vis: filterState.manhole !== false },
            { key: 'mhcard',   src: 'mhcard.js',  get: () => mhcardGeoJSON,     vis: filterState.mhcard  !== false },
            { key: 'michi',    src: 'michi.js',   get: () => michiNoEkiGeoJSON, vis: filterState.michi   !== false },
            { key: 'castle',   src: 'castle.js',  get: () => castleData,        vis: filterState.castle  !== false },
        ];
        specs.sort((a, b) => (b.vis ? 1 : 0) - (a.vis ? 1 : 0)); // 表示中を先頭へ
        let chain = Promise.resolve();
        specs.forEach(spec => {
            chain = chain.then(() => loadScriptOnce(spec.src)
                .then(() => { loadedData[spec.key] = spec.get(); applyDataset(spec.key); })
                .catch(e => console.warn('[data]', spec.src, e)));
        });
    }

    const savedState = storeGetJson('mapState');

    const savedSettings = storeGetJson('settingsState');

    /* 地図タイル。どちらの選択肢もベクタータイルで、違うのはスキーマだけ。
         openfreemap : OpenFreeMap Liberty（OpenMapTiles スキーマ）
         osm         : OSM公式ベクター（Shortbread v1 スキーマ ＋ VersaTiles Colorful）
       2026-09-01 に osm をラスター（tile.openstreetmap.org/{z}/{x}/{y}.png）から差し替えた。
       拡大時のボヤケを無くし、両方の選択肢をベクターで揃えるため。
       スキーマが違うとレイヤーIDも属性名も一致しない（rank と class は Shortbread に
       無い）ので、style.load の調整は isOsmVector で丸ごと分岐する。

       osm のスタイルJSONを配信元から直接読んではならない。
       vector.openstreetmap.org の /styles/ 配下（style.json・グリフ・スプライト）は
       CORS が localhost と www.openstreetmap.org にしか開いておらず、本番オリジンには
       Access-Control-Allow-Origin が返らずブロックされる（2026-09-02 に実測）。
       localhost では通ってしまうため、ローカル配信での確認だけでは気付けない。
       そこで style.json とスプライトを osm-shortbread/ に取り込み、グリフは CORS が
       * の OpenFreeMap に振ってある（生成手順は GetTabelog の README を参照）。
       タイル本体（*.mvt）だけは ACAO が * なので配信元から直接読む。 */
    const mapTileSource = storeGet('mapTileSource') || 'openfreemap';
    const isOsmVector   = mapTileSource === 'osm';
    const mapStyle = isOsmVector
        ? './osm-shortbread/style.json'
        : 'https://tiles.openfreemap.org/styles/liberty';
    const map = new maplibregl.Map({
        container: 'map',
        style: mapStyle,
        center:  savedState ? [savedState.lng, savedState.lat] : [139.76, 35.68],
        zoom:    savedState ? savedState.zoom    : 11,
        bearing: savedState ? savedState.bearing : 0,
        pitch:   savedState ? savedState.pitch   : 0,
        attributionControl: false
    });
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

    /* スプライトに無いアイコンの肩代わり。Liberty のスプライト264個に対し、
       実際に配信される POI の class のうち26種（日本の z14 9枚で4,748件、うち名前あり
       2,405件。最多は office の2,027件）にアイコンが無い。放っておくと文字だけが並び、
       コンソールに Image "office" could not be loaded が種類ごとに出る。
       maplibre 6.0.0 の setMissingStyleImageResolver で、欠けたぶんに共通の点を入れる。
       ノイズになる種別（車止め・門・駐輪場など）はそもそも tuneLibertyStyle 側の
       excludedPoiClasses で落としてあるので、ここへ来るのは office・atm・
       スポーツ施設・フェリー乗り場のような、出したいが絵の無いものだけ。 */
    function genericPoiIcon() {
        const px = 16, canvas = document.createElement('canvas');
        canvas.width = canvas.height = px;
        const g = canvas.getContext('2d');
        g.beginPath(); g.arc(px / 2, px / 2, 5, 0, Math.PI * 2);
        g.fillStyle = '#FFFFFF'; g.fill();          // 白フチ（背景に埋もれないように）
        g.beginPath(); g.arc(px / 2, px / 2, 3.5, 0, Math.PI * 2);
        g.fillStyle = '#8A8A8A'; g.fill();          // 本体はラベルの文字色に寄せた灰
        return g.getImageData(0, 0, px, px);
    }
    if (map.setMissingStyleImageResolver) {
        map.setMissingStyleImageResolver((id) => {
            if (!id || map.hasImage(id)) return;
            // pixelRatio 2 なので画面上は 8x8。既存のPOIアイコン(15x15前後)より控えめに出る
            map.addImage(id, genericPoiIcon(), { pixelRatio: 2 });
        });
    }

    // ダブルタップズームをアニメーション付きに統一（iOS対応）
    // デフォルトのdoubleClickZoomを無効化し、touchend自前検出＋dblclickの両方でeaseTo
    map.doubleClickZoom.disable();
    let lastTapTime = 0;
    let lastTapLngLat = null;
    map.getCanvas().addEventListener('touchend', (e) => {
        if (e.touches.length !== 0) return;
        if (e.changedTouches.length !== 1) return;
        const now = Date.now();
        const dt = now - lastTapTime;
        if (dt < 300 && dt > 30 && lastTapLngLat) {
            e.preventDefault();
            map.easeTo({
                zoom: map.getZoom() + 1,
                center: lastTapLngLat,
                duration: 300,
                essential: true
            });
            lastTapTime = 0;
            lastTapLngLat = null;
        } else {
            lastTapTime = now;
            const touch = e.changedTouches[0];
            lastTapLngLat = map.unproject([touch.clientX, touch.clientY]);
        }
    }, { passive: false });
    // Android・PC向けにdblclickも対応
    map.on('dblclick', (e) => {
        e.preventDefault();
        map.easeTo({
            zoom: map.getZoom() + 1,
            center: e.lngLat,
            duration: 300,
            essential: true
        });
    });

    // --- 移動履歴（戻る/進む） ---
    const HIST_MAX = 50;
    const mapHistory = [];
    let histIndex = -1;
    let histPending = null;    // プログラム移動の直後のmoveendで記録するラベル
    let histNavActive = false; // 履歴ジャンプによる移動中はmoveendで記録しない
    let histNavTimer = null;

    // moveend不発（同一地点への移動等）で残った古いpendingを次のmoveendに誤適用しないよう時刻を持つ
    // extra: 記録時に一緒に残す情報（ピン選択の objType / objProps）。省略時は従来どおり
    // dest: 移動先 { coords:[lng,lat], zoom }。記録する座標は地図の中心ではなくこれを使う。
    //   easeTo の途中で別の easeTo（情報シートの寄せ直し等）が始まると、maplibre は
    //   中断した側の moveend を「その瞬間の中心」で発火する（3.6.2 の _stop → _afterEase で確認）。
    //   中心から拾うと、そこで積まれたエントリが移動の途中の座標になり、履歴から戻ったとき
    //   何も無い場所に選択リングが出る。移動先は呼び出し側が分かっているので渡してもらう。
    function histSetPending(label, cause, extra, dest) {
        histPending = { label, cause, extra: extra || null, dest: dest || null, t: Date.now() };
    }

    function histPush(info) {
        const c = map.getCenter();
        const entry = Object.assign({ lng: c.lng, lat: c.lat, zoom: map.getZoom(), time: Date.now() }, info);
        // 直前エントリと同じ操作・同じラベル・ほぼ同位置なら上書き（連打による重複防止）
        const cur = mapHistory[histIndex];
        if (cur && cur.cause === entry.cause && cur.label === entry.label) {
            const p1 = map.project([cur.lng, cur.lat]);
            const p2 = map.project([entry.lng, entry.lat]);
            if (Math.hypot(p1.x - p2.x, p1.y - p2.y) < 40) {
                Object.assign(cur, entry);
                updateHistButtons();
                return;
            }
        }
        mapHistory.splice(histIndex + 1); // 進む側の履歴は破棄
        mapHistory.push(entry);
        if (mapHistory.length > HIST_MAX) mapHistory.shift();
        histIndex = mapHistory.length - 1;
        updateHistButtons();
    }

    // ピンタップ時：直前エントリとほぼ同位置ならラベルを引き継いで上書き、離れていれば新規追加
    function histRecordPin(label, coords, objType, objProps) {
        const cur = mapHistory[histIndex];
        if (cur) {
            const p1 = map.project([cur.lng, cur.lat]);
            const p2 = map.project(coords);
            if (Math.hypot(p1.x - p2.x, p1.y - p2.y) < 40) {
                // zoom も更新する。上書き元のズームを残すと、この履歴に戻ったとき
                // タップした時ではなく以前のズームに戻ってしまう。
                Object.assign(cur, { label, cause: 'pin', lng: coords[0], lat: coords[1], zoom: map.getZoom(), time: Date.now(), objType, objProps });
                delete cur.addr; // ピン名で表示するため取得済み住所を破棄
                return;
            }
        }
        histPush({ label, cause: 'pin', lng: coords[0], lat: coords[1], objType, objProps });
    }

    // 手動移動：直前エントリから画面短辺の40%以上動いたら記録（現在地追従中は記録しない）
    function histCheckManualMove() {
        if (trackingMode > 0) return;
        const cur = mapHistory[histIndex];
        if (!cur) return;
        const c = map.getCenter();
        const p1 = map.project([cur.lng, cur.lat]);
        const p2 = map.project([c.lng, c.lat]);
        if (Math.hypot(p1.x - p2.x, p1.y - p2.y) < Math.min(window.innerWidth, window.innerHeight) * 0.4) return;
        // 15秒以内に続く手動移動は直近エントリを更新（細かい移動での履歴増殖を防ぐ）
        if (cur.cause === 'move' && Date.now() - cur.time < 15000 && histIndex === mapHistory.length - 1) {
            Object.assign(cur, { lng: c.lng, lat: c.lat, zoom: map.getZoom(), time: Date.now() });
            delete cur.addr; // 位置が変わったので取得済み住所を無効化
            return;
        }
        histPush({ label: '地図移動', cause: 'move' });
    }

    function onHistMoveEnd(ev) {
        // 情報シートを開いたときの寄せ直し（adjustMapForSheet）は利用者の移動操作ではないので
        // 履歴に残さない。ここで弾かないと、シートが大きいときに寄せ量が
        // histCheckManualMove のしきい値を超え、「地図移動」が積まれて進む側の履歴が消える。
        if (ev && ev.histIgnore) return;
        if (histNavActive) {
            histNavActive = false;
            clearTimeout(histNavTimer);
            updateHistButtons();
            return;
        }
        if (histPending) {
            const p = histPending;
            histPending = null;
            if (Date.now() - p.t < 3000) {
                const info = Object.assign({ label: p.label, cause: p.cause }, p.extra || {});
                if (p.dest) {
                    info.lng = p.dest.coords[0];
                    info.lat = p.dest.coords[1];
                    if (p.dest.zoom != null) info.zoom = p.dest.zoom;
                }
                histPush(info);
                return;
            }
        }
        histCheckManualMove();
    }

    // ボタン自体は「前後どちらにも移動先が無い」時だけ無効化。
    // タップ動作（戻る）はhistIndex<=0の時にhistGoTo側でno-opになるだけで、
    // 「進むだけ可能」な状態でも長押しで履歴を開けるようにする。
    function updateHistButtons() {
        document.getElementById('hist-nav-btn').disabled = mapHistory.length <= 1;
    }

    let histSheetHandler = null;   // 履歴移動の完了後に情報シートを開くための moveend ハンドラ

    function histGoTo(idx) {
        if (idx < 0 || idx >= mapHistory.length || idx === histIndex) return;
        closeHistList();
        if (trackingMode > 0) { trackingMode = 0; stopRafLoop(); updateGeolocateButton(); }
        const e = mapHistory[idx];
        histIndex = idx;
        histPending = null;
        histNavActive = true;
        clearTimeout(histNavTimer);
        histNavTimer = setTimeout(() => { histNavActive = false; }, 1500); // moveend不発時の保険
        updateHistButtons();

        // 連続で履歴移動したとき、前回の予約が残って別地点のシートが開かないようにする
        if (histSheetHandler) { map.off('moveend', histSheetHandler); histSheetHandler = null; }
        closeObjSheet();   // 移動先と無関係なシートを残さない

        // オブジェクトの履歴に戻るときは、タップした時と同じ状態（情報シート＋選択リング）へ戻す。
        // 移動の完了後に開くのは、openObjSheet 内の adjustMapForSheet がシート高さぶん
        // 寄せ直すため。寄せ直しはズームを変えないので、下で合わせる e.zoom が保たれる。
        // 登録を easeTo より先に行うのは、既に目的地にいる等で moveend が
        // easeTo の呼び出し中に同期発火しても取りこぼさないようにするため。
        if (e.cause === 'pin' && e.objType && e.objProps) {
            const handler = () => {
                map.off('moveend', handler);
                if (histSheetHandler === handler) histSheetHandler = null;
                openObjSheet(e.objType, e.label, e.objProps, e.lng, e.lat);
            };
            histSheetHandler = handler;
            map.on('moveend', handler);
        }
        map.easeTo({ center: [e.lng, e.lat], zoom: e.zoom, bearing: 0, pitch: 0, duration: 550, essential: true });
    }

    const HIST_CAUSES = { init: '開始地点', search: '検索', pin: 'ピン選択', geo: '現在地', move: '地図移動' };

    // init/search/move用の線画アイコン（丸背景＋白線で種別色ピン(hist-ico-type)と統一）
    const HIST_ICON_SVG = {
        // 丸背景(直径28px)に載るため、viewBox中心からの最遠距離(ストローク込み)が
        // 丸半径の88%になるよう座標を揃えてある。外接矩形ではなく最遠距離で揃えるのは、
        // 円の中では縁までの余白が見た目を決めるため。init は元から87.9%で調整不要。
        search: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="10.11" cy="10.11" r="5.67"/><line x1="14.12" y1="14.12" x2="19.55" y2="19.55"/></svg>',
        move:   '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1.07" x2="12" y2="22.93"/><line x1="1.07" y1="12" x2="22.93" y2="12"/><polyline points="7.63 5.44 12 1.07 16.37 5.44"/><polyline points="7.63 18.56 12 22.93 16.37 18.56"/><polyline points="5.44 7.63 1.07 12 5.44 16.37"/><polyline points="18.56 7.63 22.93 12 18.56 16.37"/></svg>',
        init:   '<svg viewBox="0 0 24 24" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="#fff"><line x1="6" y1="3" x2="6" y2="21" stroke-width="2"/><path d="M6 4 L18 4 L14 8 L18 12 L6 12 Z"/></svg>',
    };
    const HIST_ICON_COLOR = { search: UI_BLUE, move: '#F4B400', init: '#00796B' };
    // geo（現在地）は地図長押しピン設置（search-pin-icon）と同じマーカーSVGを流用
    const HIST_GEO_PIN_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 36"><path d="M14 0C7.4 0 2 5.4 2 12c0 8.4 12 24 12 24s12-15.6 12-24C26 5.4 20.6 0 14 0z" fill="#F44336"/><circle cx="14" cy="12" r="5" fill="white" opacity="0.9"/></svg>';

    // ピン選択エントリはオブジェクト種別ごとのアイコン（検索結果ドロップダウンと同じ画像）を優先表示
    function histIconHtml(e) {
        const cfg = e.cause === 'pin' && e.objType ? typeConfig[e.objType] : null;
        if (!cfg) {
            if (e.cause === 'geo') return `<div class="hist-ico-cause" style="background:#fce8e6;"><img src="data:image/svg+xml;utf8,${encodeURIComponent(HIST_GEO_PIN_SVG)}"></div>`;
            const svg = HIST_ICON_SVG[e.cause];
            if (svg) return `<div class="hist-ico-cause" style="background:${HIST_ICON_COLOR[e.cause]}">${svg}</div>`;
            return `<span class="hist-ico">📍</span>`;
        }
        if (e.objType === 'mhcard') {
            return `<div class="hist-ico-mhcard"><img class="hist-ico-mhcard-main" src="mhcard.png"><img class="hist-ico-mhcard-overlay" src="manhole.png"></div>`;
        }
        const color = getItemColor({ type: e.objType, properties: e.objProps || {} });
        return `<div class="hist-ico-type${objIconSquareClass(e.objType)}" style="background:${color}">${cfg.img ? `<img src="${cfg.img}"${cfg.img === 'manhole.png' ? '' : ' class="icon-full"'}>` : cfg.icon}</div>`;
    }

    function histTimeAgo(t) {
        const s = (Date.now() - t) / 1000;
        if (s < 60) return 'たった今';
        if (s < 3600) return `${Math.floor(s / 60)}分前`;
        if (s < 86400) return `${Math.floor(s / 3600)}時間前`;
        return `${Math.floor(s / 86400)}日前`;
    }

    function histEscape(s) {
        return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    }

    // 現在地点を境に、上＝戻れる場所（直近優先）／下＝進める場所（direct順）を1つのリストに統合表示
    function openHistList() {
        if (mapHistory.length <= 1) return;
        const BEFORE = 6, AFTER = 4;
        const start = Math.max(0, histIndex - BEFORE);
        const end = Math.min(mapHistory.length - 1, histIndex + AFTER);
        const visible = [];
        for (let idx = end; idx >= start; idx--) visible.push({ e: mapHistory[idx], idx });

        const pop = document.getElementById('hist-list-popup');
        pop.innerHTML = `<div class="hist-hdr">移動履歴</div>` + visible.map(({ e, idx }) => {
            const isCur = idx === histIndex;
            const cls = isCur ? ' hist-cur' : (idx > histIndex ? ' hist-future' : '');
            const curTag = isCur ? ' <span class="hist-cur-tag">● 現在地点</span>' : '';
            return `<div class="hist-item${cls}" data-idx="${idx}">${histIconHtml(e)}<div class="hist-txt"><div class="hist-name">${histEscape(e.addr || e.label)}${curTag}</div><div class="hist-meta">${histTimeAgo(e.time)}・${HIST_CAUSES[e.cause] || ''}</div></div></div>`;
        }).join('');
        pop.style.display = 'block';
        histFetchAddrs(visible.map(v => v.e));
    }

    // 「地図移動」エントリの住所をリスト表示時に遅延取得してキャッシュ
    // Nominatim利用規約（最大1リクエスト/秒）に合わせて逐次・間隔付きで取得する
    let histAddrFetching = false;
    async function histFetchAddrs(entries) {
        if (histAddrFetching) return;
        const targets = entries.filter(e => e.cause === 'move' && !e.addr);
        if (!targets.length) return;
        histAddrFetching = true;
        try {
            for (let i = 0; i < targets.length; i++) {
                const e = targets[i];
                const t0 = Date.now();
                const addr = await fetchPlaceName(e.lat, e.lng);
                if (addr && !e.addr) {
                    e.addr = addr;
                    // ポップアップが開いたままならその行だけ書き換える
                    const idx = mapHistory.indexOf(e);
                    const pop = document.getElementById('hist-list-popup');
                    if (pop.style.display === 'block' && idx >= 0) {
                        const nameEl = pop.querySelector(`.hist-item[data-idx="${idx}"] .hist-name`);
                        if (nameEl) nameEl.textContent = addr;
                    }
                }
                if (i < targets.length - 1) {
                    await new Promise(r => setTimeout(r, Math.max(0, 1000 - (Date.now() - t0))));
                }
            }
        } finally {
            histAddrFetching = false;
        }
    }

    function closeHistList() {
        document.getElementById('hist-list-popup').style.display = 'none';
    }

    // 中央ボタン：タップでひとつ前に戻る、長押し(500ms)で移動履歴リスト
    function setupHistButton(btnId) {
        const btn = document.getElementById(btnId);
        let timer = null;
        btn.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            if (btn.disabled) return;
            timer = setTimeout(() => { timer = null; openHistList(); }, 500);
        });
        btn.addEventListener('pointerup', () => {
            if (timer) { clearTimeout(timer); timer = null; histGoTo(histIndex - 1); }
        });
        const cancelPress = () => { clearTimeout(timer); timer = null; };
        btn.addEventListener('pointerleave', cancelPress);
        btn.addEventListener('pointercancel', cancelPress);
        btn.addEventListener('contextmenu', (e) => e.preventDefault());
    }
    setupHistButton('hist-nav-btn');

    document.getElementById('hist-list-popup').addEventListener('click', (e) => {
        const row = e.target.closest('.hist-item');
        if (row) histGoTo(Number(row.dataset.idx));
    });
    // リスト外タップで閉じる（中央ボタン上のタップは長押し直後のclickを無視するため除外）
    document.addEventListener('click', (e) => {
        if (e.target.closest('#hist-list-popup') || e.target.closest('#hist-nav-btn')) return;
        closeHistList();
    });

    // 検索ピン
    let searchPinLngLat = null;

    function placeSearchPin(lngLat, label = null, options = {}) {
        const showMapPin = options.showMapPin !== false;
        searchPinLngLat = lngLat;
        refreshWeatherIfPanelOpen(); // 基準点が変わったらパネル表示中の天気も更新
        const src = map.getSource('search-pin-source');
        if (src) {
            src.setData(showMapPin
                ? { type: 'Feature', geometry: { type: 'Point', coordinates: [lngLat.lng, lngLat.lat] }, properties: {} }
                : { type: 'FeatureCollection', features: [] });
        }
        if (showMapPin && map.getLayer('search-pin-layer')) map.moveLayer('search-pin-layer');
        if (showMapPin && !label) animatePinPulse(lngLat);
        const origin = document.getElementById('nearby-search-origin');
        if (showMapPin && origin && !label) { origin.classList.remove('flash'); void origin.offsetWidth; origin.classList.add('flash'); }
        const labelEl = document.getElementById('nearby-search-origin-label');
        if (labelEl) labelEl.textContent = label || '検索地点';
        setSearchOriginText('取得中...', true);
        const capLng = lngLat.lng, capLat = lngLat.lat;
        fetchPlaceName(capLat, capLng).then(name => {
            if (searchPinLngLat && searchPinLngLat.lng === capLng && searchPinLngLat.lat === capLat)
                setSearchOriginText(name || '周辺', true);
        });
    }

    let progressRaf = null;
    function startProgressRing(lngLat) {
        const src = map.getSource('pin-progress-source');
        if (!src) return;
        src.setData({ type: 'Feature', geometry: { type: 'Point', coordinates: [lngLat.lng, lngLat.lat] }, properties: {} });
        const start = performance.now();
        function frame(t) {
            const p = Math.min((t - start) / 500, 1);
            map.setPaintProperty('pin-progress-layer', 'circle-radius',         p * 32);
            map.setPaintProperty('pin-progress-layer', 'circle-stroke-opacity', p * 0.9);
            if (p < 1) progressRaf = requestAnimationFrame(frame);
            else progressRaf = null;
        }
        progressRaf = requestAnimationFrame(frame);
    }
    function stopProgressRing() {
        if (progressRaf) { cancelAnimationFrame(progressRaf); progressRaf = null; }
        const src = map.getSource('pin-progress-source');
        if (src) src.setData({ type: 'FeatureCollection', features: [] });
        if (map.getLayer('pin-progress-layer')) {
            map.setPaintProperty('pin-progress-layer', 'circle-radius', 0);
            map.setPaintProperty('pin-progress-layer', 'circle-stroke-opacity', 0);
        }
    }

    let pulseRaf = null;
    function animatePinPulse(lngLat) {
        const pulseSrc = map.getSource('pin-pulse-source');
        if (!pulseSrc) return;
        if (pulseRaf) { cancelAnimationFrame(pulseRaf); pulseRaf = null; }
        map.setPaintProperty('pin-pulse-layer', 'circle-radius', 0);
        map.setPaintProperty('pin-pulse-layer', 'circle-opacity', 0);
        pulseSrc.setData({ type: 'Feature', geometry: { type: 'Point', coordinates: [lngLat.lng, lngLat.lat] }, properties: {} });
        const start = performance.now();
        const duration = 1000;
        function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
        function frame(t) {
            const p = Math.min((t - start) / duration, 1);
            const e = easeOut(p);
            map.setPaintProperty('pin-pulse-layer', 'circle-radius',  5.6 + e * (112 - 5.6));
            map.setPaintProperty('pin-pulse-layer', 'circle-opacity', (1 - p) * 0.4);
            if (p < 1) pulseRaf = requestAnimationFrame(frame);
            else { pulseRaf = null; pulseSrc.setData({ type: 'FeatureCollection', features: [] }); }
        }
        pulseRaf = requestAnimationFrame(frame);
    }

    function removeSearchPin() {
        searchPinLngLat = null;
        const src = map.getSource('search-pin-source');
        if (src) src.setData({ type: 'FeatureCollection', features: [] });
        const labelEl = document.getElementById('nearby-search-origin-label');
        if (labelEl) labelEl.textContent = '検索地点';
        setSearchOriginText('地図中心', false);
    }

    function getSearchCenter() { return searchPinLngLat || map.getCenter(); }

    /* ══ 一覧へ戻るときの地図の戻し ═══════════════════════════════════
       一覧からオブジェクトへ飛ぶと地図はその位置へ寄る。検索ピンが無いときの起点は
       地図の中心（getSearchCenter）なので、寄ったままにすると戻り導線で一覧へ帰った後に
       開いた一覧が、寄った先を起点にして別の並びで出る（戻る前に見ていた一覧と中身が
       食い違う）。飛ぶ直前の地図を控えておき、戻り導線から帰るときだけ元へ戻す。
       戻す移動は利用者の移動操作ではないので、移動履歴には記録しない（histIgnore）。
       動かすのは easeTo ではなく jumpTo。戻した直後に一覧を描き直すが、起点帯
       （renderDistOrigin）の「今の地図中心にする」は今の地図中心と起点のずれで出し分けて
       いるため、動いている途中の中心で描くと押しても何も起きないボタンが残る。
       このとき地図は開いていく一覧のパネルでほぼ隠れているので、瞬時に戻して支障が無い。 */
    let listReturnCamera = null;
    function saveListReturnCamera() {
        const c = map.getCenter();
        listReturnCamera = { center: [c.lng, c.lat], zoom: map.getZoom(),
                             bearing: map.getBearing(), pitch: map.getPitch() };
    }
    function restoreListReturnCamera() {
        if (!listReturnCamera) return;
        const cam = listReturnCamera;
        listReturnCamera = null;
        map.jumpTo(cam, { histIgnore: true });
    }

    /* ══ 近い順の起点の表示 ═══════════════════════════════════════════
       県ページと城主詳細の距離は getSearchCenter() を起点に測っている。
       起点は開くたびに取り直すので普段は地図の中心と同じだが、次の2つの場面では
       ずれるので、どこからの距離なのかを画面に出す。
        ・検索ピンが立っている間は、起点は地図の中心ではなくピンの位置になる
        ・一覧からオブジェクトを開いて戻ったとき（restoreView）は起点を据え置く。
          戻り導線から帰るときは地図も飛ぶ前へ戻す（restoreListReturnCamera）ので
          普段は一致するが、そこから地図を動かせば起点だけが前のところに残る
       控えているのは緯度経度だけなので、地名は逆ジオコーディングで取る。
       同じ地点を何度も問い合わせないよう originNames に控える
       （undefined=未着手 / null=問い合わせ中 / 文字列=結果。'' は取得できなかった）。 */
    const ICON_ORIGIN_CROSS = '<svg width="13" height="13" viewBox="0 0 44 44" style="display:block;flex-shrink:0">'
        + `<circle cx="22" cy="22" r="9" fill="none" stroke="${UI_BLUE}" stroke-width="4"/>`
        + `<circle cx="22" cy="22" r="3" fill="${UI_BLUE}"/>`
        + `<line x1="22" y1="1" x2="22" y2="10" stroke="${UI_BLUE}" stroke-width="4" stroke-linecap="round"/>`
        + `<line x1="22" y1="34" x2="22" y2="43" stroke="${UI_BLUE}" stroke-width="4" stroke-linecap="round"/>`
        + `<line x1="1" y1="22" x2="10" y2="22" stroke="${UI_BLUE}" stroke-width="4" stroke-linecap="round"/>`
        + `<line x1="34" y1="22" x2="43" y2="22" stroke="${UI_BLUE}" stroke-width="4" stroke-linecap="round"/></svg>`;
    const ICON_ORIGIN_PIN = '<svg width="10" height="13" viewBox="0 0 28 36" style="display:block;flex-shrink:0">'
        + '<path d="M14 0C7.4 0 2 5.4 2 12c0 8.4 12 24 12 24s12-15.6 12-24C26 5.4 20.6 0 14 0z" fill="#F44336"/>'
        + '<circle cx="14" cy="12" r="5" fill="white" opacity="0.9"/></svg>';
    const originNames = new Map();
    /* 逆ジオコーディングの取得そのものの重複よけ。周辺検索の「検索地点」と近い順の起点は
       同じ地点を指すことが多く、そのままだと同じ座標へ2回問い合わせることになる
       （originNames は表示の状態を持つ入れ物で、届く前の相乗りには使えない）。 */
    const originFetches = new Map();
    function fetchPlaceNameCached(lat, lng) {
        const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
        if (!originFetches.has(key)) originFetches.set(key, fetchPlaceName(lat, lng));
        return originFetches.get(key);
    }
    /* 起点を出す画面。state は prefState / lordsState の宣言より前に
       この定義を書けるよう、関数越しに引く。redraw は起点を取り直したときの並べ直し。
       noReset を立てた画面には取り直しの導線を出さない。周辺検索の起点は100km圏を切り出した
       中心そのもので、動かすことは並べ直しではなく検索のやり直しになるため（execNearbySearch）。 */
    const DORG_VIEWS = {
        pref: { el: 'pref-origin', state: () => prefState,  redraw: () => renderPrefItems() },
        lord: { el: 'lord-origin', state: () => lordsState, redraw: () => renderLordCastles() },
        remains: { el: 'remains-origin', state: () => remainsState, redraw: () => renderRemainsCastles() },
        nearby: { el: 'nearby-origin', state: () => nearbyState, noReset: true },
        fav: { el: 'fav-origin', state: () => favState, redraw: () => renderFavItems() },
    };

    function renderDistOrigin(kind) {
        const v = DORG_VIEWS[kind];
        const el = document.getElementById(v.el);
        if (!el) return;
        const state = v.state();
        const c = state.center;
        if (!c) { el.innerHTML = ''; return; }
        const key = `${c.lat.toFixed(4)},${c.lng.toFixed(4)}`;
        if (!originNames.has(key)) {
            originNames.set(key, null);
            // 届いたら描き直す。そのとき state.center から引き直すので、
            // 待っている間に別の県や城主へ移っていても取り違えない
            fetchPlaceNameCached(c.lat, c.lng).then(n => {
                originNames.set(key, n || '');
                renderDistOrigin(kind);
            });
        }
        const cached = originNames.get(key);
        const fallback = state.centerPinned ? '検索地点' : '地図中心';
        const name = cached === null ? '取得中…' : (cached || fallback);
        /* 取り直しの導線は、今 getSearchCenter() が指す先と起点がずれているときだけ出す。
           普段は開くたびに取り直していて一致するので、押しても何も起きないボタンは置かない。 */
        const now = getSearchCenter();
        const stale = !v.noReset
            && (Math.abs(now.lat - c.lat) > 1e-6 || Math.abs(now.lng - c.lng) > 1e-6);
        el.innerHTML = (state.centerPinned ? ICON_ORIGIN_PIN : ICON_ORIGIN_CROSS)
            + `<b>${attrEscape(name)}</b>`
            + (stale ? `<button onclick="resetDistOrigin('${kind}')">${
                searchPinLngLat ? '検索ピンにする' : '今の地図中心にする'}</button>` : '');
    }

    // 起点を今の getSearchCenter() に合わせ直し、その場で並べ直す
    function resetDistOrigin(kind) {
        const state = DORG_VIEWS[kind].state();
        const c = getSearchCenter();
        state.center = { lat: c.lat, lng: c.lng };
        state.centerPinned = !!searchPinLngLat;
        renderDistOrigin(kind);
        DORG_VIEWS[kind].redraw();
    }

    const ICON_PIN_INFO = `<svg width="18" height="24" viewBox="0 0 28 36" style="display:block;transform:translate(2px,2px)"><path d="M14 0C7.4 0 2 5.4 2 12c0 8.4 12 24 12 24s12-15.6 12-24C26 5.4 20.6 0 14 0z" fill="#F44336"/><circle cx="14" cy="12" r="5" fill="white" opacity="0.9"/></svg>`;
    const ICON_CROSSHAIR_INFO = `<svg width="20" height="20" viewBox="0 0 44 44" style="display:block"><circle cx="22" cy="22" r="9" fill="none" stroke="${UI_BLUE}" stroke-width="3"/><circle cx="22" cy="22" r="3" fill="${UI_BLUE}"/><line x1="22" y1="2" x2="22" y2="11" stroke="${UI_BLUE}" stroke-width="3" stroke-linecap="round"/><line x1="22" y1="33" x2="22" y2="42" stroke="${UI_BLUE}" stroke-width="3" stroke-linecap="round"/><line x1="2" y1="22" x2="11" y2="22" stroke="${UI_BLUE}" stroke-width="3" stroke-linecap="round"/><line x1="33" y1="22" x2="42" y2="22" stroke="${UI_BLUE}" stroke-width="3" stroke-linecap="round"/></svg>`;
    function setSearchOriginText(text, pinned) {
        const icon = document.getElementById('nearby-search-origin-icon');
        const textEl = document.getElementById('nearby-search-origin-text');
        const originEl = document.getElementById('nearby-search-origin');
        if (icon) icon.innerHTML = pinned ? ICON_PIN_INFO : ICON_CROSSHAIR_INFO;
        if (textEl) textEl.textContent = text;
        if (originEl) originEl.classList.remove('expanded');
    }
    document.getElementById('nearby-search-origin').addEventListener('click', () => {
        document.getElementById('nearby-search-origin').classList.toggle('expanded');
    });
    async function fetchPlaceName(lat, lng) {
        try {
            const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=18&accept-language=ja`);
            const data = await res.json();
            const a = data.address || {};
            const state   = a.state || a.province || a.region || PREF_CODES[a['ISO3166-2-lvl4']] || '';
            const city    = a.city || a.county || a.town || a.village || '';
            const suburb  = a.suburb || a.neighbourhood || a.city_district || '';
            const quarter = a.quarter || '';
            const houseNo = a.house_number || '';
            return [state, city, suburb, quarter, houseNo].filter(Boolean).join(' ');
        } catch { return ''; }
    }

    let longPressActivated = false;
    map.on('click', (e) => {
        if (longPressActivated) { longPressActivated = false; return; }
        if (searchPinLngLat && map.getLayer('search-pin-layer')) {
            const hit = map.queryRenderedFeatures(e.point, { layers: ['search-pin-layer'] });
            if (hit.length > 0) { removeSearchPin(); return; }
        }
    });

    // 長押しでピン設置
    let longPressTimer = null;
    let longPressLngLat = null;
    let longPressPoint = null;
    function startLongPress(lngLat, point) {
        longPressLngLat = lngLat;
        longPressPoint = point;
        longPressTimer = setTimeout(() => {
            longPressTimer = null;
            if (map.queryRenderedFeatures(longPressPoint).some(f => f.properties?.cluster)) return;
            longPressActivated = true;
            placeSearchPin(longPressLngLat);
        }, 500);
    }
    function cancelLongPress() {
        if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
    }
    map.on('touchstart',  (e) => { if (e.originalEvent.touches.length === 1) startLongPress(e.lngLat, e.point); });
    map.on('touchend',    cancelLongPress);
    map.on('touchmove',   cancelLongPress);
    map.on('mousedown',   (e) => { if (e.originalEvent.button === 0) startLongPress(e.lngLat, e.point); });
    map.on('mouseup',     cancelLongPress);
    map.on('dragstart',   cancelLongPress);

    // 現在地関連の変数
    let currentMarker = null;
    let currentLocation = null;
    let trackingMode = 0; // 0:オフ, 1:追従, 2:追従+ヘディング
    let preTrackingMode = 0; // ドラッグ前のモード保存用

    let hadFirstFix = false;
    let isZooming = false;
    let deviceHeading = 0;
    let smoothedHeading = null;

    // ボタンのSVGアイコン
    const iconLocate = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/></svg>`;
    const iconNav = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/></svg>`;

    // iOS向けに向き取得の権限をリクエスト
    function requestDeviceOrientation() {
        const startListening = () => {
            // absolute版を優先的に試みる
            if ('ondeviceorientationabsolute' in window) {
                window.addEventListener('deviceorientationabsolute', handleOrientation, true);
            } else {
                window.addEventListener('deviceorientation', handleOrientation, true);
            }
        };

        if (typeof DeviceOrientationEvent !== 'undefined' &&
            typeof DeviceOrientationEvent.requestPermission === 'function') {
            // iOS
            DeviceOrientationEvent.requestPermission()
                .then(state => { if (state === 'granted') startListening(); })
                .catch(console.error);
        } else {
            startListening();
        }
    }

// --- スムージング用変数 ---
let currentSmoothedHeading = null;
const smoothingFactor = 0.03; // センサー入力の平滑化（小さいほど滑らか）

// 角度の差分を-180〜180の範囲で計算するヘルパー（最短距離で回転させるため）
function getShortestAngleDiff(current, target) {
    let diff = target - current;
    while (diff < -180) diff += 360;
    while (diff > 180) diff -= 360;
    return diff;
}

// handleOrientation: 信頼できるabsolute系イベントのみ使用
// absolute=falseのdeviceorientationは端末起動時基準のため180度ずれが起きるので無視
function handleOrientation(event) {
    let rawHeading = null;

    if (event.webkitCompassHeading !== undefined) {
        // iOS: webkitCompassHeading は真北基準で信頼性が高い
        rawHeading = event.webkitCompassHeading;

    } else if (event.type === 'deviceorientationabsolute' && event.alpha !== null) {
        // Android: absolute版は地磁気北基準なので信頼できる
        rawHeading = (360 - event.alpha) % 360;

    } else if (event.type === 'deviceorientation' && event.absolute === true && event.alpha !== null) {
        // absolute=trueのdeviceorientationも同等
        rawHeading = (360 - event.alpha) % 360;

    } else {
        // absolute=false のdeviceorientationは信頼できないため無視
        return;
    }

    // 画面の向き（縦・横）を補正
    let screenAngle = 0;
    if (window.screen && window.screen.orientation) {
        screenAngle = window.screen.orientation.angle;
    } else if (typeof window.orientation === 'number') {
        screenAngle = window.orientation;
    }

    const targetHeading = (rawHeading + screenAngle + 360) % 360;

    if (currentSmoothedHeading === null) {
        currentSmoothedHeading = targetHeading;
    } else {
        const diff = getShortestAngleDiff(currentSmoothedHeading, targetHeading);
        // 差分が0.1度以下なら完全に収束させて微小振動を止める
        if (Math.abs(diff) < 0.1) {
            currentSmoothedHeading = targetHeading;
        } else {
            currentSmoothedHeading = (currentSmoothedHeading + diff * smoothingFactor + 360) % 360;
        }
    }

    deviceHeading = currentSmoothedHeading;
    // 扇アイコンの更新はrAFループに一本化（ここでは行わない）
}

// --- rAFループで地図bearingをなめらかに追従（震え防止） ---
const BEARING_THRESHOLD     = 2.0;
const BEARING_LERP          = 0.04;
const POSITION_LERP         = 0.02;
const BEARING_SET_THRESHOLD = 0.3;   // ④ 実際にsetBearingを呼ぶ閾値（センサーノイズ0.1〜0.2度を除外）
const POS_CONVERGE          = 0.000005; // ③ 位置補間の収束打ち切り閾値（約0.5m）
let rafBearing  = null;
let rafLng      = null;
let rafLat      = null;
let rafId       = null; // ループID（nullなら停止中）
let prevSetBearing = null;
let prevSetLng     = null;
let prevSetLat     = null;
let prevSetPitch   = null; // ② pitch変化チェック用

function startRafLoop() {
    if (rafId !== null) return;
    rafId = requestAnimationFrame(bearingRafLoop);
}

function stopRafLoop() {
    if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
    }
    rafBearing = null;
    rafLng     = null;
    rafLat     = null;
    prevSetBearing = null;
    prevSetLng     = null;
    prevSetLat     = null;
    prevSetPitch   = null; // ② リセット
}

// --- 城写真取得（攻城団→城郭放浪記→Wikipedia フォールバック、キャッシュ付き） ---
const castleImgCache = {};

// 画像URLが実在するかを<img>読み込みの成否で判定する（Promise化）。
// 城郭放浪記(hb.pei.jp)はAccess-Control-Allow-Originを返さないため、
// 攻城団のようなfetch()+blob()方式は使えない(CORSエラーで常に失敗する。実測確認済み)。
// <img>の読み込みはCORS不要で、成功時はそのURLがHTTPキャッシュに乗るため
// (ETag/Last-Modifiedのみでmax-ageは無いが、ブラウザの既定動作でキャッシュされる)、
// 後で同じURLをポップアップに挿入する際に再利用される。
function checkImageLoads(url, timeoutMs = 8000) {
    return new Promise((resolve) => {
        const img = new Image();
        let done = false;
        const finish = (ok) => { if (!done) { done = true; resolve(ok); } };
        img.onload = () => finish(true);
        img.onerror = () => finish(false);
        img.src = url;
        setTimeout(() => finish(false), timeoutMs);
    });
}

// 攻城団: URLから城IDを抽出してパノラマ画像URLを構築
// HEADでの事前存在確認は廃止し、画像GET自体を存在確認に使う
// (攻城団へのリクエストを成功時2回→1回に削減。GETした画像は
//  Cache-Control: max-age=7日でHTTPキャッシュされ、表示時に再利用される)。
// 存在判定はfetchのステータスで行う。<img>のonerrorは使えない:
// このサーバは404応答の本文にもJPEG(エラー画像)を返し、Chromeは
// その場合loadイベントを発火するため誤って表示してしまう(実測確認済み)。
// CORSはAccess-Control-Allow-Origin:*を確認済み。
async function castleImgFromKojodan(kojodanUrl) {
    if (!kojodanUrl) return null;
    const m = kojodanUrl.match(/kojodan\.jp\/castle\/(\d+)/);
    if (!m) return null;
    const imgUrl = `https://kojodan.com/pic/panorama/${m[1]}.jpg`;
    try {
        const res = await fetch(imgUrl);
        if (res.ok) {
            await res.blob(); // ダウンロードを完了させHTTPキャッシュに乗せる
            return imgUrl;
        }
    } catch (_) {}
    return null;
}

// 城郭放浪記: 個別ページURL(shiroHbUrl)配下の indexb.jpg が写真ページの規約的な命名
// (実測確認済み。城郭放浪記は個人運営サイトのため、タップ時1回のみのアクセスに留める)
async function castleImgFromShiroHb(shiroHbUrl) {
    if (!shiroHbUrl) return null;
    const imgUrl = `${shiroHbUrl}indexb.jpg`;
    return (await checkImageLoads(imgUrl)) ? imgUrl : null;
}

// Wikipedia: ja.wikipedia.org の pageimages API（CORS許可: origin=*）
// 公式ドキュメント: https://www.mediawiki.org/wiki/Extension:PageImages
// size はサムネイルの最大幅。シート表示は400、拡大表示は CASTLE_ZOOM_THUMB を使う。
async function castleImgFromWikipedia(castleName, size) {
    try {
        const apiUrl = `https://ja.wikipedia.org/w/api.php?action=query&prop=pageimages&piprop=thumbnail&pithumbsize=${size}&titles=${encodeURIComponent(castleName)}&format=json&origin=*`;
        const res = await fetch(apiUrl);
        const data = await res.json();
        const page = Object.values(data.query.pages)[0];
        if (page && page.thumbnail && page.thumbnail.source) return page.thumbnail.source;
    } catch (_) {}
    return null;
}

async function fetchCastleImage(castleName, kojodanUrl, shiroHbUrl) {
    const cacheKey = castleName;
    if (castleImgCache[cacheKey] !== undefined) return castleImgCache[cacheKey];
    // 先に見つかった時点で打ち切る（攻城団・城郭放浪記へのアクセスを増やさないため）
    let url = await castleImgFromKojodan(kojodanUrl);
    if (!url) url = await castleImgFromShiroHb(shiroHbUrl);
    if (!url) url = await castleImgFromWikipedia(castleName, 400);
    castleImgCache[cacheKey] = url;   // どこからも取得できなければ null
    return url;
}

// 拡大表示用に、シート表示では打ち切っていた残りの取得元も調べて配列にする。
// 写真を拡大したときだけ呼ぶので、通常の閲覧でアクセスが増えることはない。
// Wikipediaはシート用の400pxではなく拡大に耐える幅で取り直す
// (pithumbsize=1200 で 1200×800 が返ることを実測確認済み。原寸は4200×2800)。
const CASTLE_ZOOM_THUMB = 1200;
const castleImgAllCache = {};
async function fetchCastleImagesAll(castleName, kojodanUrl, shiroHbUrl) {
    if (castleImgAllCache[castleName]) return castleImgAllCache[castleName];
    const [ko, sh, wp] = await Promise.all([
        castleImgFromKojodan(kojodanUrl),
        castleImgFromShiroHb(shiroHbUrl),
        castleImgFromWikipedia(castleName, CASTLE_ZOOM_THUMB),
    ]);
    const list = [];
    if (ko) list.push({ url: ko, label: '攻城団' });
    if (sh) list.push({ url: sh, label: '城郭放浪記' });
    if (wp) list.push({ url: wp, label: 'Wikipedia' });
    castleImgAllCache[castleName] = list;
    return list;
}

// --- Wikipedia記事の存在確認（キャッシュ付き） ---
// name単独だとWikipediaの正式タイトルと不一致で誤って「記事なし」判定になるケースがあるため
// （例:「上之国館」はmissingだが、aliases由来の「上之国勝山館跡」はリダイレクトで実在記事「勝山館」に解決）、
// name + aliasesを候補としてtitlesに一括指定し、redirects=1でリダイレクトも解決した上で判定する。
//
// 名前だけでは同名の無関係な記事（例: 茨城の館山城 vs 千葉の館山城）にヒットしうるため、
// prop=coordinatesで記事側の座標も取得し、城のcastle.js側座標(lat/lng)と突き合わせる
// (2026-07-24追加。閾値5kmはGetTabelog側の別名同定処理と同じ基準に合わせた)。
// 座標が近い候補があれば最優先で採用する。座標情報がない記事（Infoboxに座標テンプレート
// が無いケース）は判定不能なので、ボタンを消さない方針（誤って開かれるより出ないことを
// 避ける、というユーザー判断）によりフォールバック候補として保持し、座標一致が
// 無ければ採用する。座標はあるが閾値を超えて離れている記事は明確に無関係と判断し除外する。
//
// 【重要】候補(pages)はcandidatesの順序ではなく、APIレスポンスのpages連想配列のキー(pageid)
// 順に返ってくる。JSではObject.values()で整数キーは数値昇順に自動ソートされるため、
// 例えば千葉の佐貫城(aliases:「亀城」「亀ヶ城」)では、aliasesが全く無関係な記事
// （亀城→中国の「亀城市」、亀ヶ城→福島の「猪苗代城」）にリダイレクトされてしまっており、
// かつそれらの記事にも座標情報が無いため、pageid最小の「猪苗代城」が本来の「佐貫城」より
// 先にフォールバック採用され、無関係なページに遷移する実害を確認した(2026-07-24)。
// candidates配列の順序（castleName自身を最優先、aliasesは補完）通りに評価するよう、
// redirectsマッピングでcandidateごとの解決先ページを個別に引いてから順序を組み直す。
const wikiExistsCache = {};
const WIKI_COORD_MATCH_THRESHOLD_KM = 5;

async function resolveWikipediaTitle(castleName, aliases, lat, lng) {
    // 座標を判定に使うため、キャッシュキーにも座標を含める。座標なしで同名の城が
    // 複数箇所にある場合（例:「堀城」）、名前だけをキーにすると片方の判定結果が
    // 無関係な別の場所の同名城にも誤って適用されてしまうため。
    const cacheKey = (typeof lat === 'number' && typeof lng === 'number')
        ? `${castleName}:${lat.toFixed(4)}:${lng.toFixed(4)}` : castleName;
    if (wikiExistsCache[cacheKey] !== undefined) return wikiExistsCache[cacheKey];
    try {
        const candidates = [castleName, ...(Array.isArray(aliases) ? aliases : [])].slice(0, 10);
        // prop=pageprops&ppprop=disambiguation: 別名が曖昧さ回避ページ（例:「朝倉城」は
        // 兵庫・高知の同名城への入口ページで、それ自体は特定の城の記事ではない）に
        // ヒットするケースを除外するため(2026-07-24追加、実データ確認: 保々西城→朝倉城)。
        // 曖昧さ回避ページは記事本文がなく座標情報も持たないため、座標なしフォールバック
        // 採用ロジックに紛れ込むと無関係なページへ誤誘導してしまう。
        const apiUrl = `https://ja.wikipedia.org/w/api.php?action=query&format=json&redirects=1&prop=coordinates|pageprops&ppprop=disambiguation&titles=${encodeURIComponent(candidates.join('|'))}&origin=*`;
        const res = await fetch(apiUrl);
        const data = await res.json();

        // candidate(元の表記) → 実際に解決されたページタイトル、のマッピングを作る
        const redirectMap = {};
        (data.query.redirects || []).forEach(r => { redirectMap[r.from] = r.to; });
        const pagesByTitle = {};
        Object.values(data.query.pages || {}).forEach(pg => {
            const isDisambiguation = pg.pageprops && pg.pageprops.disambiguation !== undefined;
            if (pg.pageid !== undefined && pg.missing === undefined && !isDisambiguation) pagesByTitle[pg.title] = pg;
        });

        // candidatesの順序（castleName最優先）通りに解決済みページを並べ直す（重複除去）
        const orderedPages = [];
        const seenPageIds = new Set();
        for (const cand of candidates) {
            const resolvedTitle = redirectMap[cand] || cand;
            const pg = pagesByTitle[resolvedTitle];
            if (pg && !seenPageIds.has(pg.pageid)) { orderedPages.push(pg); seenPageIds.add(pg.pageid); }
        }

        let result = null;
        const hasCoord = typeof lat === 'number' && typeof lng === 'number';
        if (hasCoord) {
            let fallback = null;
            for (const pg of orderedPages) {
                const pc = pg.coordinates && pg.coordinates[0];
                if (pc) {
                    const d = calcDist(lat, lng, pc.lat, pc.lon);
                    if (d <= WIKI_COORD_MATCH_THRESHOLD_KM) { result = pg.title; break; }
                    // 座標があるが閾値超え: 無関係と判断し不採用（何もしない）
                } else if (fallback === null) {
                    fallback = pg.title; // 座標なし: 判定不能なのでフォールバック候補として保持
                }
            }
            if (result === null) result = fallback;
        } else {
            // 呼び出し側で座標が渡せない場合は従来通り名前一致のみで判定
            result = orderedPages.length > 0 ? orderedPages[0].title : null;
        }

        wikiExistsCache[cacheKey] = result;
        return result;
    } catch (_) {
        // 判定不能時はボタンを消さない（安全側）。キャッシュもしない（次回再試行させる）
        return castleName;
    }
}

// 城シートの情報源セット行（Wikipedia・攻城団・城郭放浪記）を非同期で確定させる。
// 攻城団・城郭放浪記はHTML生成時点でp.url/p.shiroHbUrlの有無から確定済み（暫定レイアウト済み）だが、
// Wikipediaは記事存在確認が非同期のため、確定後にセット行全体をbuildSourceButtons()で再構築する。
async function injectWikiButtonState(castleName, aliases, kojodanUrl, shirohbUrl, lat, lng) {
    const slot = document.querySelector('#obj-sheet-body .os-source-row');
    if (!slot) return;
    const resolvedTitle = await resolveWikipediaTitle(castleName, osParseAliases(aliases), lat, lng);
    const wikiHref = resolvedTitle ? `https://ja.wikipedia.org/wiki/${encodeURIComponent(resolvedTitle)}` : '';
    // 取得完了までに別のオブジェクトへ切り替わっていたら書き換えない
    const cur = document.querySelector('#obj-sheet-body .os-source-row');
    if (cur !== slot) return;
    slot.innerHTML = buildSourceButtons(wikiHref, kojodanUrl, shirohbUrl);
    // ボタン数の増減で高さが変わるため選択ピンの見え方を補正し直す
    adjustMapForSheet();
}

// --- 城の形態（城郭放浪記データ由来）表示 ---
// 形態名(21種類、実データで確認済み)をCSSクラスに対応させる。
// 「不明」という値がそのまま入っているケースがあるため、その場合はバッジ自体を出さない。
const FORM_BADGE_CLASS = {
    '山城': 'f-yamajiro', '丘城': 'f-okajiro', '平城': 'f-hirajiro', '居館': 'f-kyokan',
    '平山城': 'f-hirayama', '陣屋': 'f-jinya', '陣所': 'f-jinsho', '代官所': 'f-daikansho',
    '台場': 'f-daiba', '番所': 'f-bansho', '崖端城': 'f-gakebata', '水軍城': 'f-suigun',
    '環濠': 'f-kango', '台城': 'f-daijiro', '海城': 'f-umijiro', '寺社': 'f-jisha',
    '防塁': 'f-boruei', '関所': 'f-sekisho', '水城': 'f-mizujiro', '烽火台': 'f-houkadai',
    '官衙': 'f-kanga',
};

// 形態バッジ（城名の左に配置。タイトル行用に少し大きいフォントサイズを使う）
function popupFormBadgeHtml(form) {
    if (!form || form === '不明') return '';
    const cls = FORM_BADGE_CLASS[form] || '';
    return `<span class="popup-form-badge popup-form-badge-title ${cls}">${form}</span>`;
}

// 100名城・続100名城のバッジ。色は地図のピン・検索結果のアイコンと同じものを使う
// （getItemColor が genre から決めるので、色の定義がここで二重にならない）
const CASTLE_GENRE_LABEL = { '日本100名城': '100名城', '続日本100名城': '続100名城' };
function castleGenreBadgeHtml(p) {
    const label = CASTLE_GENRE_LABEL[p.genre];
    if (!label) return '';
    return `<span class="os-genrebadge" style="background:${getItemColor({ type: 'castle', properties: p })}">${label}</span>`;
}

/* ══ 食べログの店名・駅・ジャンル・部門 ═══════════════════════════════
   data.js の name は「店名 - 駅（ジャンル）」の3点セット（食べログ店舗ページの h1 由来）。
   実データ7,077件すべてがこの形であることを全件検査で確認済み（2026-08-01、例外0件）。
   data.js は変えず、表示のたびにここで分解する（地図のラベルだけは JS を通せないので、
   同じ切り出しを SHOP_LABEL_FIELD の式でやる）。合致しない名前が来たら店名だけとして扱う。

   部門（category）は「ラーメン（東京）」のように地域が付く。括弧内は北海道・東京・
   神奈川・愛知・大阪・香川・東日本・西日本の8種しか現れない（全71種で確認）ので、
   括弧を落とせば35種の部門になる。バッジとジャンル絞り込みはこの35種を使う。 */
const SHOP_NAME_RE = /^(.+?)\s+-\s+(.+?)（([^（）]+)）\s*$/;
function shopParts(p) {
    const m = SHOP_NAME_RE.exec(((p && p.name) || '').trim());
    return m ? { shop: m[1], station: m[2], genre: m[3] }
             : { shop: (p && p.name) || '', station: '', genre: '' };
}
/* 名前を出す場所は、どこでも店名だけにする（情報シートのタイトルと同じ）。
   name をそのまま出すと平均26.6字・67%が20字超で、1行の置き場所では末尾が切れて
   店名まで読めなくなるため。駅とジャンルは情報シートの項目で読める。 */
function shopDisplayName(p) { return shopParts(p).shop || (p && p.name) || ''; }
/* 検索・周辺検索・都道府県一覧が持つ item 用。label（name 全体）は書き換えず、
   出すときだけ店名にする。照合に使う _normLabel は label から作られているので、
   駅名やジャンルで引ける検索の当たり方はそのまま残る。 */
function itemDisplayName(item) {
    return item.type === 'shop' ? shopDisplayName(item.properties) : item.label;
}
/* 地図のラベル用。JSの正規表現は使えないので、最初の " - " までを切り出す式にする。
   店名の側に " - " を含む店は0件（全7,077件で確認済み）。分解できない名前が来たら
   name をそのまま出す（shopParts が店名だけとして扱うのと同じ振る舞い）。 */
const SHOP_LABEL_FIELD = ['let', 'i', ['index-of', ' - ', ['get', 'name']],
    ['case', ['>', ['var', 'i'], 0], ['slice', ['get', 'name'], 0, ['var', 'i']], ['get', 'name']]];
function shopGenreBase(category) {
    return String(category || '').replace(/（[^（）]*）\s*$/, '').trim();
}
/* 部門バッジの色。35部門を内容で10グループに束ね、グループごとに1色にする
   （種別色のオレンジ1色だと白文字が読みにくく、部門も見分けられなかったため）。
   彩度・明度は城の形態バッジ（f-*）と同じ帯に揃えてある。 */
const SHOP_GENRE_CLASS = {
    'ラーメン': 'g-men', 'うどん': 'g-men', 'そば': 'g-men',
    '焼肉': 'g-niku', '焼き鳥': 'g-niku', '鳥料理': 'g-niku',
    'ステーキ・鉄板焼き': 'g-niku', 'とんかつ': 'g-niku', 'すき焼き・しゃぶしゃぶ': 'g-niku',
    '寿司': 'g-gyokai', 'うなぎ': 'g-gyokai', '天ぷら': 'g-gyokai', '日本料理': 'g-gyokai',
    '中国料理': 'g-chuka', '餃子': 'g-chuka', 'アジア・エスニック': 'g-chuka', 'カレー': 'g-chuka',
    'フレンチ': 'g-yoshoku', 'イタリアン': 'g-yoshoku', 'スペイン料理': 'g-yoshoku',
    '洋食': 'g-yoshoku', 'ピザ': 'g-yoshoku', 'ハンバーガー': 'g-yoshoku',
    'お好み焼き': 'g-keishoku', '食堂': 'g-keishoku',
    'スイーツ': 'g-kanmi', '和菓子・甘味処': 'g-kanmi', 'パン': 'g-kanmi', 'アイス・ジェラート': 'g-kanmi',
    'バー': 'g-sake', '居酒屋': 'g-sake', '立ち飲み': 'g-sake',
    'カフェ': 'g-kissa', '喫茶': 'g-kissa',
    '創作料理・イノベーティブ': 'g-sonota',
};
/* ジャンル選択の並び順。バッジの色分けと同じ10グループで束ねて出す
   （色でまとまって見えるものが、並びでも隣り合うようにするため）。
   SHOP_GENRE_CLASS の全35部門がこの中に漏れなく入る。 */
const SHOP_GENRE_GROUPS = [
    ['麺', ['ラーメン', 'うどん', 'そば']],
    ['肉', ['焼肉', '焼き鳥', '鳥料理', 'ステーキ・鉄板焼き', 'とんかつ', 'すき焼き・しゃぶしゃぶ']],
    ['魚介・和食', ['寿司', 'うなぎ', '天ぷら', '日本料理']],
    ['中華・アジア', ['中国料理', '餃子', 'アジア・エスニック', 'カレー']],
    ['洋食', ['フレンチ', 'イタリアン', 'スペイン料理', '洋食', 'ピザ', 'ハンバーガー']],
    ['軽食・粉もの', ['お好み焼き', '食堂']],
    ['甘味・パン', ['スイーツ', '和菓子・甘味処', 'パン', 'アイス・ジェラート']],
    ['酒', ['バー', '居酒屋', '立ち飲み']],
    ['喫茶', ['カフェ', '喫茶']],
    ['その他', ['創作料理・イノベーティブ']],
];
/* 部門バッジ。sizeClass に置き場所ごとの寸法クラスを渡す
   （情報シート=os-genrebadge / 一覧=pref-badge / 検索結果=sr-genre）。色はグループのクラスが持つ。 */
function shopGenreBadgeHtml(p, sizeClass) {
    const g = shopGenreBase(p && p.category);
    if (!g) return '';
    return `<span class="${sizeClass} shop-genre ${SHOP_GENRE_CLASS[g] || 'g-sonota'}">${attrEscape(g)}</span>`;
}
/* ══ 食べログの受賞歴 ═══════════════════════════════════════════
   awards は data.js が持つ受賞歴（年の降順）。1件が { y:年, t:部門タグ, g:部門名 }。
   百名店は部門ごとに発表年が違い、選から外れる年もあるので年は飛ぶ。
   部門が変わる店（例: カレー TOKYO → アジア・エスニック TOKYO）もあるため、
   現在の部門（category）と違う年だけ部門名を添えて見分けられるようにする。
   別名と同じく、MapLibre の feature.properties 経由ではJSON文字列で届く。 */
function osParseAwards(awards) {
    if (typeof awards === 'string') {
        try { awards = JSON.parse(awards); } catch { awards = null; }
    }
    return Array.isArray(awards) ? awards : [];
}
function shopAwardsHtml(p) {
    const list = osParseAwards(p && p.awards);
    if (!list.length) return '';
    const now = shopGenreBase(p && p.category);
    const chips = list.map((a, i) => {
        const g = shopGenreBase(a && a.g);
        const other = g && g !== now;
        const cls = other ? 'aw-y aw-other' : (i === 0 ? 'aw-y aw-now' : 'aw-y');
        return `<span class="${cls}">${attrEscape(a.y)}${other ? ' ' + attrEscape(g) : ''}</span>`;
    }).join('');
    return `<span class="aw-chips">${chips}</span>`;
}
/* 評点。タイトル行の右端に置く（項目行にすると1行増えるため）。
   口コミ数は3桁区切りにする。評点が無い店（取得できなかった店）は出さない。 */
function shopRatingHtml(p) {
    if (!p || !p.rating) return '';
    const n = Number(p.ratingCount);
    const cnt = Number.isFinite(n) && n > 0 ? `<span class="rt-n">(${n.toLocaleString('ja-JP')})</span>` : '';
    return `<span class="os-rating"><span class="rt-star">★</span>`
         + `<span class="rt-v">${attrEscape(p.rating)}</span>${cnt}</span>`;
}

// 予算。食べログは「店側申告」と「口コミ集計」を昼夜それぞれ持っており、
// data.js にも4通りそのまま入っている（budgetDinner / budgetLunch / …Rvw）。
//
// 口コミ集計を優先する。店側申告は据え置かれがちで、実際に払った額を集計した
// 口コミ側のほうが実勢に近いため。
//
// 【昼夜それぞれで独立に選ぶ】
// 「口コミ集計をひとまとまりで優先し、無ければ店側申告」にすると、
// 口コミ集計に夜しか無く店側申告には昼夜ある店で、昼が消える
// （実測: 焼肉ホルモン 新井屋 渋谷。口コミは夜のみ、申告は夜￥6,000～￥7,999・
//   昼￥2,000～￥2,999）。昼夜は別の情報なので、枠ごとに口コミ→申告の順で選ぶ。
// 有る枠だけを昼→夜の順に並べる（片方しか無い店が多い）。
// 枠ごとに出どころが混ざりうるため、出どころの注記は付けない。
//
// 【priceRange への逃げ道】
// 2026-08-12 より前の data.js は、ld+json の priceRange（夜の値しか持たない）を
// 単一の予算として持っていた。取得に失敗して据え置きになった店には今も残るので、
// 4通りが1つも無いときだけこれを出す。
function shopBudgetHtml(p) {
    if (!p) return '';
    const seg = (cls, label, v) => v
        ? `<span class="os-bseg"><span class="os-bt ${cls}">${label}</span>${attrEscape(v)}</span>`
        : '';

    const shown = seg('os-bt-l', '昼', p.budgetLunchRvw  || p.budgetLunch)
                + seg('os-bt-d', '夜', p.budgetDinnerRvw || p.budgetDinner);

    return shown || (p.priceRange ? attrEscape(p.priceRange) : '');
}

// 標高／比高（バッジとは別行、住所の上に表示）。
// 他の行と同じラベルチップを使い、1行に2項目を並べる（比高が無い城は標高だけになる）。
function popupFormMetaHtml(elevationM, relativeHeightM) {
    const elev = (elevationM !== undefined && elevationM !== null) ? osKvHtml('標高', `${elevationM}m`) : null;
    const rel = (relativeHeightM !== undefined && relativeHeightM !== null) ? osKvHtml('比高', `${relativeHeightM}m`) : null;
    return [elev, rel].filter(Boolean).join(' ');
}

// 遺構・城主は、原典（城郭放浪記）が「なし」「不明」と明記しているケースが多い
// （遺構が付く18,000件のうち2,743件、城主11,776件のうち2,441件）。castle.js には
// その記載どおり保持しているが、読み手にとって情報量が無いのでシートには行ごと出さない。
// 「破壊」「消滅」はWikipediaが遺構の現存しない城に使う表記（castle.js側でも同じ扱い）
const CASTLE_UNKNOWN_ATTRS = new Set(['なし', '無し', '無', '不明', '不詳', '－', '-', '―', 'ー',
                                      '破壊', '消滅']);
// ラベルは他のメタ行と同じチップで書く
function castleAttrLine(label, value) {
    if (!value) return '';
    const v = String(value).trim();
    if (!v || CASTLE_UNKNOWN_ATTRS.has(v)) return '';
    return osKv(label, v);
}

// 情報源ボタン（Wikipedia・攻城団・城郭放浪記）。セット行に並べ、
// 非表示のものがあれば残ったボタンが flex:1 で自動的に幅を広げる（空欄は作らない）。
function buildSourceButtons(wikiHref, kojodanUrl, shirohbUrl) {
    const items = [];
    if (wikiHref)    items.push(`<a href="${wikiHref}" target="_blank" class="btn btn-wiki">Wikipedia</a>`);
    if (kojodanUrl)  items.push(`<a href="${kojodanUrl}" target="_blank" class="btn btn-kojodan">攻城団</a>`);
    if (shirohbUrl)  items.push(`<a href="${shirohbUrl}" target="_blank" class="btn btn-shirohb">城郭放浪記</a>`);
    return items.join('');
}

// iOSのホーム画面PWA(navigator.standalone)では、攻城団ボタン(target=_blank)の外部遷移が
// Safari相当のUA(Version/26.5.2)で開かれ、攻城団側のUAフィルターに弾かれる(実測503)。
// 攻城団はこのバージョンをピンポイントで遮断しており(隣の26.4/26.6は通る)、こちらでは直せない。
// 対処: iOS PWA時のみ、攻城団リンクをChromeを直接起動するURLスキーム(googlechromes://)に
// 差し替える。ChromeはCriOSのUAを送るため攻城団に通る(実測200)。UA偽装ではなく、
// 攻城団が許可しているChromeで開くだけ。他サイト・他ブラウザ・他OSには影響しない。
// この制限を課しているのは攻城団のみのため、対象は攻城団リンクに限定する。
function isIosStandalonePwa() {
    return window.navigator.standalone === true;
}

function showToast(message) {
    let toast = document.getElementById('app-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'app-toast';
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => toast.classList.remove('show'), 4000);
}

/* 文字列をクリップボードへ入れる。
   navigator.clipboard は生えていても書き込みが拒まれること（安全なコンテキストでない、
   ユーザー操作の文脈から外れている）があるので、失敗したら旧APIの execCommand へ落とす。
   どちらの経路もユーザー操作（タップ・クリック）の中から呼ばれることが前提。 */
async function copyToClipboard(text) {
    if (!text) return false;
    if (navigator.clipboard) {
        try { await navigator.clipboard.writeText(text); return true; } catch {}
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;';
    document.body.appendChild(ta);
    ta.focus();
    ta.setSelectionRange(0, ta.value.length);   // iOSは select() だけでは選択範囲が入らないことがある
    let ok = false;
    try { ok = document.execCommand('copy'); } catch {}
    ta.remove();
    return ok;
}

document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a.btn-kojodan');
    if (!a || !isIosStandalonePwa()) return; // 通常ブラウザ/Android/PCは従来のtarget=_blankのまま
    const href = a.getAttribute('href') || '';
    if (!/^https?:\/\//i.test(href)) return;
    e.preventDefault();

    const chromeUrl = href.replace(/^https?:\/\//i, 'googlechromes://');
    let launched = false;
    const onLeave = () => { launched = true; cleanup(); };
    const onVis = () => { if (document.hidden) onLeave(); };
    function cleanup() {
        document.removeEventListener('visibilitychange', onVis);
        window.removeEventListener('pagehide', onLeave);
        window.removeEventListener('blur', onLeave);
    }
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', onLeave);
    window.addEventListener('blur', onLeave);

    // スキームを起動。Chromeがあれば即アプリ切替でページがバックグラウンド化する。
    window.location.href = chromeUrl;

    // 一定時間たっても前面のまま=Chrome未起動=未インストールとみなして通知する。
    setTimeout(() => {
        cleanup();
        if (!launched && !document.hidden) {
            showToast('攻城団の閲覧にはChromeが必要です。App StoreでChromeを入れてください。');
        }
    }, 2000);
});

// 城のGoogleMap検索クエリ：同名城の誤ヒット防止に市区町村までの住所を付与
// 丁目以下まで含めるとPOIカード直行になりにくいため市区町村で切る（実測確認済み）
// 切り出せない書式は住所全体、住所なしは城名のみにフォールバック
function castleGmapQuery(name, address) {
    if (!address) return name;
    const m = address.match(/^(北海道|東京都|京都府|大阪府|[一-龠々]{2,3}県)(.+?[市区町村郡])/);
    return `${name},${m ? m[1] + m[2] : address}`;
}

// --- マンホールカード（蓋ピン ⇔ 配布場所レコードの紐付け） ---
// 旧「カード詳細」シートは廃止し、その情報は情報シート本体に統合した。
let cardJoinIndex = null;   // カードコード → 配布場所featureの配列（遅延構築）
let lidJoinIndex = null;    // カードコード → 蓋feature（遅延構築。実データでは1カードにつき蓋は1件）

// カードコード正規化: "13-100-P001" / "01-100-A-01" → "13-100-P-1"
// 先頭の "S-"（東京都の特別版2件）と、枝番のないコード（20-452-A / 23-234A）も受ける。
function cardCodeKey(s) {
    const t = String(s == null ? '' : s).replace(/^S-/i, '');
    let m = t.match(/^(\d{2})-(\d{3})-?([A-Z])-?0*(\d+)/i);
    if (m) return `${m[1]}-${m[2]}-${m[3].toUpperCase()}-${parseInt(m[4], 10)}`;
    m = t.match(/^(\d{2})-(\d{3})-?([A-Z])$/i);   // 枝番なしは1枚目とみなす
    return m ? `${m[1]}-${m[2]}-${m[3].toUpperCase()}-1` : null;
}

// 配布場所レコードが名乗るカードコード。次の2通りを両方登録して、どちらでも引けるようにする。
//   cardId … 公式ページの市町村セルの括弧内ID（「富山市 (F001)」→ F001）。蓋側のIDと同じ体系で
//            確実だが、括弧内IDは全行にあるわけではない（公式1,311行中809行）。
//   画像URL … ファイル名から取る従来の方法。命名の揺れが大きく（13-100-A1-01 / 13-100-C101 /
//            13-100-D01 が全部別体系）単独では24件を取り逃すが、cardIdが無い行でも取れる。
function cardKeysOfCardRecord(p) {
    const keys = [];
    const url = (p && p.cardImgUrl) || '';
    const pm = url.match(/\/mhc\/(\d{2})-(\d{3})/);
    if (pm && p && p.cardId) keys.push(cardCodeKey(`${pm[1]}-${pm[2]}-${p.cardId}`));
    const m = url.match(/\/mhc\/([\w-]+?)(?:\.\w+)?$/i);   // 拡張子は .jpg 以外や無しもある
    if (m) keys.push(cardCodeKey(m[1]));
    return keys.filter((k, i) => k && keys.indexOf(k) === i);
}
function cardKeyOfCardRecord(p) {
    return cardKeysOfCardRecord(p)[0] || null;
}

// 蓋のcardId → 配布場所featureの一覧。
// 同じカードを複数箇所で配る例が147キーある（2箇所=143 / 3箇所=4。季節・曜日で窓口が変わるものが大半）
// ため、propertiesではなくfeatureの配列で返す（行き先の座標が要るため）。
function ensureCardJoinIndex() {
    if (cardJoinIndex) return true;
    const fc = loadedData.mhcard;
    if (!fc) return false;   // 配布場所データ未読込（読込後に再タップで解決）
    cardJoinIndex = {};
    fc.features.forEach(f => {
        cardKeysOfCardRecord(f.properties).forEach(k => {
            const list = (cardJoinIndex[k] = cardJoinIndex[k] || []);
            if (!list.includes(f)) list.push(f);
        });
    });
    return true;
}
function findCardFeaturesByKey(key) {
    if (!key || !ensureCardJoinIndex()) return [];
    return cardJoinIndex[key] || [];
}

// 相手が見つからない蓋のための後継カード探し。
// 改版されたカードは公式一覧から旧版の行ごと消える（小樽市A001→A002など）。
// 同じ自治体・同じ記号で枝番だけ違うカードが残っていれば、それが後継にあたる。
function findSuccessorCards(cardId) {
    const self = cardCodeKey(cardId);
    if (!self || !ensureCardJoinIndex()) return [];
    const prefix = self.replace(/-\d+$/, '-');   // 13-100-A-1 → 13-100-A-
    const out = [];
    Object.keys(cardJoinIndex).forEach(k => {
        if (k === self || !k.startsWith(prefix)) return;
        cardJoinIndex[k].forEach(f => { if (!out.includes(f)) out.push(f); });
    });
    return out;
}
function findCardFeaturesByCardId(cardId) {
    return findCardFeaturesByKey(cardCodeKey(cardId));
}

// シート表示に使う配布場所は先頭の1件（複数あっても住所・時間の欄は1件ぶんしか出さない）
function findCardByCardId(cardId) {
    const fs = findCardFeaturesByCardId(cardId);
    return fs.length ? fs[0].properties : null;
}

// カードコード → 対応する蓋feature（配布場所1,426件中1,365件で引ける）
function findLidFeatureByKey(key) {
    if (!key) return null;
    if (!lidJoinIndex) {
        const fc = loadedData.manhole;
        if (!fc) return null; // 蓋データ未読込（読込後に再タップで解決）
        lidJoinIndex = {};
        fc.features.forEach(f => {
            const k = cardCodeKey(f.properties.cardId);
            if (k && !lidJoinIndex[k]) lidJoinIndex[k] = f;
        });
    }
    return lidJoinIndex[key] || null;
}

// 配布場所レコードから、シート表示に必要な派生情報を作る。
// muni: 自治体名（"札幌市（A001）" → "札幌市"）／ id: 括弧内のカードID（1,426件中864件のみ）
// gkpUrl: GKP公式一覧の該当行へのリンク（旧カード詳細シートと同じ生成規則）
function mhcardInfo(p) {
    const muniRaw = p.municipality || '';
    const muni = muniRaw.replace(/[（(].*$/, '').trim();
    const idm = muniRaw.match(/[（(]\s*([A-Za-z0-9]+)\s*[）)]/);
    const prefM = (p.cardImgUrl || '').match(/\/mhc\/(\d{2})-/);
    const gkpPref = (!prefM || prefM[1] === '00') ? 'zenkoku' : prefM[1];
    return {
        muni,
        id: idm ? idm[1] : '',
        round: p.round || '',
        gkpUrl: `https://www.gk-p.jp/mhcard/?pref=${gkpPref}`
              + (muni ? `#:~:text=${encodeURIComponent(muni)}` : '#mhcard_result'),
    };
}

// --- 蓋 ⇄ カード配布場所の行き来 ---------------------------------------
/* 蓋のシートから「そのカードをもらえる配布場所」へ、配布場所のシートから「そのカードのデザイン蓋」へ移る。
   移動後はピンをタップしたときと同じ状態にする（地図を寄せる → 情報シート＋選択リング → 履歴に記録）。
   飛び先の種別を表示していない（設定でOFF）ときはボタンを出さない。検索・周辺検索が
   OFFの種別を候補から外すのと同じ扱いで、表示していない種別へは連れて行かない。
   onclickに渡すのは正規化済みのカードコード（英数字とハイフンのみ）で、URLや施設名は埋め込まない。
   移動先だけを中央に置くのではなく、移動元も画面に残して線で結ぶ。どこから来たのかと
   2点の距離感が分かるようにするため。地図を引く範囲と解除の条件は openObjSheet 側にある。 */
function mhJumpTo(type, feature) {
    if (!feature) return;
    const from = objSheetLngLat ? objSheetLngLat.slice() : null;   // 今シートを開いている側が移動元
    const c = feature.geometry.coordinates.slice();
    const p = feature.properties;
    const label = p.name || p.locationName || '地点';
    // 地図は openObjSheet → adjustMapForSheet が両方の入る位置まで動かす
    openObjSheet(type, label, p, c[0], c[1], from);
    histRecordPin(label, c, type, p);
}
function mhJumpToCard(key, idx) {
    mhJumpTo('mhcard', findCardFeaturesByKey(key)[idx || 0]);
}
function mhJumpToLid(key) {
    mhJumpTo('manhole', findLidFeatureByKey(key));
}
// 配布場所が複数のときの候補リストの開閉。高さが変わるので地図を寄せ直す
function mhTogglePicker() {
    const pick = document.querySelector('#obj-sheet-body .os-pick');
    if (!pick) return;
    pick.hidden = !pick.hidden;
    adjustMapForSheet();
}

// 蓋シートの「配布場所」ボタンと、複数のときに開く候補リストを作る。
// 候補には蓋からの距離を出す（季節・曜日で分かれた同名の窓口を見分ける手がかりになる）。
function mhCardJumpHtml(cardFeatures, key, lng, lat, label) {
    if (cardFeatures.length === 1) {
        // 配布が終わったカードの行き先は配布場所ではない（問合せ先か市町村の代表点）。
        // 「配布場所」と書くと押した先と食い違うので、状態をそのまま文言にする。
        const single = label || (cardFeatures[0].properties.discontinued ? '配布終了' : '配布場所');
        return { btn: `<button class="btn btn-to-card" onclick="mhJumpToCard('${key}',0)">${single}</button>`, pick: '' };
    }
    const items = cardFeatures.map((f, i) => {
        const q = f.properties;
        const d = calcDist(lat, lng, f.geometry.coordinates[1], f.geometry.coordinates[0]);
        const ds = d < 1 ? `${Math.round(d * 1000)}m` : `${d.toFixed(1)}km`;
        return `<button class="os-pick-it" onclick="mhJumpToCard('${key}',${i})">`
             + `<span class="os-pick-nm">${q.locationName || q.name || '配布場所'}`
             + `<span class="os-pick-sub">${q.address || ''}</span></span>`
             + `<span class="os-pick-d">${ds}</span></button>`;
    }).join('');
    return {
        btn: `<button class="btn btn-to-card" onclick="mhTogglePicker()">配布場所（${cardFeatures.length}件）</button>`,
        pick: `<div class="os-pick" hidden><div class="os-pick-hd">配布場所を選ぶ</div>${items}</div>`,
    };
}

// ══════════════════════════════════════════════════════════════
//  オブジェクト情報シート（下から出る）
//  全タイプ共通の3行構成:
//    行A  GoogleMap ＋ 種別固有の単発リンク（アクセス／公式ページ／食べログ）
//    行B  セット行（城=Wikipedia/攻城団/城郭放浪記、道の駅=michieki.jp/施設HP/関連HP、
//                  マンホール系=在庫状況/GKP公式一覧）。非表示があれば残りが自動で広がり、
//                  0個なら行ごと出さない。
//    行C  固定セット（ここへ行く(Google)／ここへ行く(Yahoo)／この周辺を検索）
//  各行は flex で等分するため、個数が変わっても空きセルが出ない。
//
//  写真の横のテキスト（.os-meta）は、全種別で osKv() のラベルチップに統一している。
//  使うラベルは次のとおり:
//    城          別名／標高／比高／遺構／城主／住所
//    マンホール蓋 設置／配布場所／住所／時間／発行（配布終了なら 配布／問合せ／発行、
//                 後継カードしか無いときは 配布／後継）
//    カード      住所／時間／発行（配布終了なら 配布／問合せ／発行）
//    ポケふた・食べログ  住所
//    道の駅      路線／住所／時間（路線は michi.js の全1,234件が空なので実際は出ない）
//  蓋だけ「設置」を使うのは、蓋自身の住所とカード配布場所の住所を続けて出すため。
//  同じ「住所」チップが2つ並ぶと、どちらが蓋の位置か読み取れなくなる。
// ══════════════════════════════════════════════════════════════

// テキスト1行（2行を超える分は省略。タップで全文表示）
// cls: 行ごとの追加クラス（受賞歴の行だけ中央揃えにするなど）
function osLine(html, cls) {
    return html ? `<div class="os-line os-clamp${cls ? ' ' + cls : ''}">${html}</div>` : '';
}
// ラベルチップ＋値。値が空なら行ごと出さない。
// 全種別のメタ行をこの形に統一しているので、新しい項目もこれで足すこと。
function osKvHtml(label, value) {
    return `<span class="os-k">${label}</span>${value}`;
}
function osKv(label, value, cls) {
    return value ? osLine(osKvHtml(label, value), cls) : '';
}
// 写真枠。urlが空なら枠ごと出さない。variant で枠の形を切り替える:
//   ''(既定) 128×128にcover      … ポケふた(750×750)のような正方形向け
//   'full'   幅128・高さは比率なり … マンホールカード(縦長)を切らずに全体表示
//   'wide'   171×128にcover       … 城(横長ソース)の左右の欠けを減らす
function osPhotoHtml(url, variant) {
    return url ? `<div class="os-photo${variant ? ' os-photo-' + variant : ''}">`
               + `<img src="${url}" onerror="this.parentElement.style.display='none'"></div>` : '';
}
function osRow(btns) {
    const items = btns.filter(Boolean);
    return items.length ? `<div class="os-brow">${items.join('')}</div>` : '';
}
function osBtn(href, cls, text) {
    return href ? `<a href="${href}" target="_blank" class="btn ${cls}">${text}</a>` : '';
}
// 別名はMapLibreのfeature.properties経由だとJSON文字列化されて届くため、その場合はパースする
// （検索結果側は生JSONをそのまま渡すので配列で届く）
function osParseAliases(aliases) {
    if (typeof aliases === 'string') {
        try { aliases = JSON.parse(aliases); } catch { aliases = null; }
    }
    return Array.isArray(aliases) ? aliases : [];
}

// 「ここへ行く」の移動手段。設定画面で選んだ既定値を両サービスに適用する。
//   Google … 旧形式URLの dirflg。4種すべて意図どおりに開くことを実測で確認
//             (w=徒歩25分/1.8km、d=車10分/1.9km、r=バス18分/210円、b=自転車9分/1.8km)
//   Yahoo  … 公式URL仕様どおり train / car / walk の3種のみ。/route/bicycle は経路画面に
//             ならず地図が出るだけなので、自転車を選んだときは徒歩で代替する
const TRAVEL_MODES = {
    walk:    { label: '徒歩',         gmap: 'w', yahoo: 'walk'  },
    car:     { label: '自動車',       gmap: 'd', yahoo: 'car'   },
    transit: { label: '公共交通機関', gmap: 'r', yahoo: 'train' },
    bicycle: { label: '自転車',       gmap: 'b', yahoo: 'walk'  },
};
const TRAVEL_MODE_DEFAULT = 'transit';
function travelMode() {
    const v = storeGet('travelMode');
    return TRAVEL_MODES[v] ? v : TRAVEL_MODE_DEFAULT;
}

// Yahoo!地図の経路URL。移動手段は設定画面の既定値に従う。
// from/to には表示用の名前を、fromLat/fromLon・toLat/toLon には実際の座標を渡す。
// 実測で確かめた前提:
//   ・from を省くとYahooはスタート地点が空のまま開く（現在地は自動で入らない）
//   ・緯度経度を併せて渡すと from/to の文字列は表示ラベルにしかならない。存在しない名前
//     （「ほげほげ架空城跡」）でも座標どおりの経路が出たので、名前の解決失敗で行き先が
//     ずれる心配はない
//   ・ただし文字列「現在地」だけは特別扱いで、fromLat/fromLon を無視してYahoo側の位置情報を
//     使う。位置情報が未許可だとエラーになるため、出発地のラベルは「現在位置」にする
//   ・名前を渡さず座標文字列にした場合も同じ経路になる（表示が座標のままになるだけ）
function yahooRouteUrl(fromLat, fromLng, toLat, toLng, toName) {
    const dest = toName || `${toLat},${toLng}`;
    const q = [`to=${encodeURIComponent(dest)}`, `toLat=${toLat}`, `toLon=${toLng}`];
    if (fromLat != null) {
        q.unshift(`from=${encodeURIComponent('現在位置')}`, `fromLat=${fromLat}`, `fromLon=${fromLng}`);
    }
    return `https://map.yahoo.co.jp/route/${TRAVEL_MODES[travelMode()].yahoo}?${q.join('&')}`;
}

// 検索ボックスの虫眼鏡(#search-icon)と同じ絵柄。stroke=currentColor なので、
// 置き場所の文字色をそのまま拾う（.btn は color:white のため白抜きになる）
const ICON_SEARCH_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9.5" cy="9.5" r="7.5"/><line x1="14.8" y1="14.8" x2="22" y2="22"/></svg>';

// 経路の2ボタンの左端に置く公式ロゴ。公式配布物を48pxに縮めただけで、色も形も変えていない。
// 表示は16pxなので、3xの端末でも足りる寸法。取得元:
//   Google Maps … https://www.google.com/images/branding/product/2x/maps_96dp.png
//   Yahoo!      … https://s.yimg.jp/c/icon/s/bsc/2.0/favicon.ico
//                 （map.yahoo.co.jp が <link rel="icon"> で参照している共通アイコン）
// 外部URLのまま参照しないのは、経路ボタンは全種別のシートに必ず出るため、
// 他社ドメインの応答に表示が引きずられないようにするため。
const NAV_LOGO_GMAPS = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAALBklEQVR42tVZa5BdVZX+1tr7nHNv337kQTokIRkIKWQ6RIVOfJV6Oxlxxil1atTboDwswaqUaBRqRC1Fb99S+aE4o2P5ICqDSiH2YYjWOEoNFOnLEMFAQ4YhTSZALGFgik5M0q/7OGfvtfxxu2OSfqbTxHH/7NNn7+9b61vfWWtfwoItJfSCsRcEQFAiOeFxURkA59GHck+XB5Hi/8VSJfSqmfT3otqlNx5sWbLtUCuKT4UnPy70qhkndVqLTuvtghrE5AFgybZDrVFGt7DqX6v6i1RpOREWqSqDMESgl5zi8aVNmV3ntLX13XcjDU4Qibsbe5xBAjr+Huk5NxxaJRYfg+oHKMiuITZQ8YA4QDwUADFDyCIThDi3JYSR5KAAd2nqv7bz802/Q1EZPdD5yOrUU1gsMkAKkK648dAnJKAnOWz+DLFZo/VhkepRp8mI17Qq6hOFT1TSmrAb86vCmjPpmFeVZUEYbuOAn9hy89jHUCIBkc5HUnRq2Iv8xVJJVt7w66yYdT/izKL3aX0I6p0DYEA05X4KxZqWJrSGFk4VpKogeGJrbSYDV6vdXT08es2vv7psBEXlSQawMASUUARhJTKr97/8C2SXbPaV388InAA4VazIZbAsGzbAn2gACqgPci02rdUe8bXaO8qlRUMN3c1NTjxXloUCOCyRfPA3/3rnSG75ZqkcSolgZwO/NBNMDR4AiAjENhkbSYNM5g0mDONCL7gQg/9YZwtAQAoFE8fkn+/a+IXvvfS1v9t64DvpsG0JFASGTAu+JbRYkcvATwX+BB4cJGMjaZBretvB/aM9cTf5Qu/cgzvj6i0UTHccy+CWzosDNrtFBU1+lG9vfx8V11wPBZCROjyZYxt6FY2M8WvbmsBEUCig00ttQk8gFjZGbSXqvLdETxYKauJ4ZoudlWWho0MBqABfzho2KUiP2ja65uUYtz/zKbS5EYyYHKw2zvEqPgwiWtvebqNcszXZnLXZZks2JFX1M+VBxYNtZIeX/fhmAOjogJ5WBsaj71/c0nlJE5tHU9VjpB0ZLHbD2Jddi+vOL+GpplehNR0SblrMq0J5uTXgXyXePUOGE1J6NRG93UTZ5WltVAg0OXDkQa4VtaV3S/3sfyHyiy55tPvOPdAig0rTupKdMfqDg9T4J7qi2Ro+nKZu4nCrHkdsK86vPY943zbcsPYm/8CyS80KjH1/9aK2z8afoIPH7/XmLw8vi+rVm4Oo+cNp/SQS5EG+FUnrf6J61g8ljNpsOly7AsCefF8flwGZVwYUoJ4i6KMPbXw8a8xrKk6E6ETZeTKIfFWiIMc9q6/95ld/cO3HCcBbi3pCcMolcgCw5ebRf7ZRbltaHREiZsCDJAefeRaj53weSqmYKGJfc//Vv++iS9BTUtD0UpqWgBbBVIK8+LbONVbpfwxRxiuUTn6HVEIJWZcffXpR18Bruu/vlY6OvVoqlSZ1o4UB0GBHH5nodf/NJrzQu4qQRqzmKEZX3wQNXgYkozBK6qVqnF6w+6od/4tikVGaWkbTF/FAgQAg6/ncLJuMkynAs0IqVtrWDSN75bO30laT9l73LSpNdViJZLADVC5tdur0NhNaEIyAPCor/gkSvgRoFiAheFEOTdazngsAhfUDNG8XEqNnBUwgqJwUeWjCMIsTI+98DtHqZJfCE7rK0+q1fQAKKIHkNz51gGS42v4duNwekG8G4CekK2wZSrRs3h+yvvECFq/RlMITAoxqy2XPkW+raf1AWCHMbHsNWySlcGQUiUV96U85absP5NuASXZPYEshAAzuHTz1DHS1tzc8k7g2ZY0kBrl3/47M2iEJYMm0+XZVEOLp62pgPQgKopGVK/3S3aie9WNPvuVY5CdZiNMqALSvb9f5S0j0cCqN7mpC91qxyG5+EZlNB6FjgSCjkBTvIoJi7fR7HjiylUHQ+pL73llduR0k0ZQ9BgEsTqGqh+ffC3XECgChwQs1LwkTMVhVKxbRxQfRdOmL0IoBWI0fg5qQrtVf4C9oI1J9DIFqY2iYaBJ6ezvC/q3b0zfeesuFyTl3Xunqv1fSwEyhOgUzaeLrovwCAMR7O+Zho42Q62OdncGaNh7IBLSuMkYSrBnj1g/tA1gbdUCAKiTIgn2qj5vUv4vejpeOP2Di9J/9bPXKW9yme+vGbtCaF9BUAVTh0LIkft95zBfF3fH8eiECVAsFs7G/PwXrrshZNYvr0nLZs6BAAc/H6BOB0wrEhHSJD8zD7gF7nd6PVVoEK4CR+3PL9QFc+yuc/1DFRBu05qYBD6iScGBURHbF3bHP78zb0x8pE/NTZz3lug8wL6lDE25k4HjCPE6CaY1pwrdStU+7t5g91fuDR5tpbOAO3fD9h9yK80ytLiCa4Vxl8UJgigGg/WC7nk47TarAM7QtXPXdO55qeu3Q+ekwK/H0xBUQKNRaGLIMmAS/HDoP1x95vW/jhAjEOm1DrWIiS77m9uOCszb0d253M7URc8mAog/mAnyzHm048nWQIRBklogwEUzdkSJJpH+43X/uaKe2sjMzgZ8Ynjk0BNZb+jduT/M9eXPaA40qCD0gnIvQrTaPmQytdzV4AqbdXEAIyeEF34yrj2zGEY0QwUNmOE5Vvc1Y4+ruySqbTQN7O9xsjdycaoAIivUg+hBqSnQdFGCC6jRfXQXBQDCqAT459EYMShaZWcA3kLCqAgJsG+iOk8L6AZoN/NyH+m547YUJ/8o96Cv6DdMKC5n8+dQJGyfBTcObsMctQSul8LOAV1UXNIfWV93Xn7j8ngcLvQUzm32e8rXKeJvAaIZNQ7MraKLOdAye6I9S8iBElOIfR1+L71b+EkupBjdLjFTU21xgfNXtrjC/ZT3g40Isc4n+Kd3MEUFRgNLfou6dv9wnOMIBWKRx0AT4u6vrsL1yIRZTfVbwgAoHhn0ihznhywe64yTe26FzBX/KV4tEEFWY7N/gWU31A8QgthCnpBGleDg5G18avRjNlELn4A8gFrJEWnNX7746/m2+mLfTDS4LdjdKBK87YYNL/b2+in+wOTIZcv63rg2fHn4DCIBpXKTMJklvc4H1FXdT/1U7/j2/M2/LpbI7Y9fruhOWNsPpfeZHSXN4VeGFvHtO2mwz5lK0cLY5tG6sfk//5fe8N78zb8ubyx7AGbidPjYwwBd6CwY5v3Xb/73uiQPBUpvTxM/BccRExvpqsh9srkGxyOWu+YE/LQJEUCAGvQnV20fWXZHz9TEJLGZUj0LJkqpojRJ3WX93PDRXv1/4DACIu+GLO/M2/eAPnnZ1f72JjFGCnzH6mcBI4j716JU/35Pfmbdz9ftX5iem8TWuYdf5k/f83DaH73YjiScmM6lVaAqMqyQP9r9/Rz5fzNtyaf7SWZAMHLu06usSKEjUfcTX/GEOmU6SkpIhklTqRPjocXPuaf9SabAgDMqaR94+8vH/GDr771+V2KboHZI4ofG+X0UlaI6Mrybf6H//jjtOpVU4IxkAgHJP2aNY5NDaW/1o/XkOjcH4bMCW2Y2lR8MQX4GCZppx/2QEQNB8Vx8/0h1XQbjNRBaqEAW8yQYEkbsefu+OwUJc4FP92p4ZAgDKXV0NYGzucpU0JYIBKfu6UyH94UKZxoK70KSBgKCdP3nPIyaym1QUkvp9a415ddwdy0IU7iuWAQDI9zXGQAV+yRnLpilgUvzb+A2DWejzFpxAua8sACh1epsbqe93o/X9mppvQ0Hjz/58VkdvIezoLYT4s1zHDwT6CtTa+PoDpQeBfCLTGQgAAAAASUVORK5CYII=';
const NAV_LOGO_YAHOO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAGaElEQVR42u2YbYic1RXHf+feZ3ajMaJismKakFQU8SUvTuwqpBnThhKioigjWF+QForaDxYtFErb7aZV2sRarNAPDf0QkpbWIagIRiS+jBpMk52dxGySKgZttNbYYEg3ZrMzz72nH+6dfWbj7Ca72YDCHHhY9pnn3nvO//zP24W2tKUtbWlLW77CIkohmZqtyl7AtyGduAfyzwEzgTrgwms1ILb1EhVAQEz8Lj66Wqg8p2Cm2hOBJbNUKLkTf0tAu8F0gSU8EM73Y24XHu9AjoMOA58PUfusxZcGijI5tUvaAEIop3E/C0Wg5CUogSiLLgUuBvO18JeLQJaBLAGfBrQBxEek9wIPgRwF/gdu8EM6D89l29CZoIhyRQdMuxHc+8KunV+gUOtFi2aC/TOYmwPS2ACAKHAM3HeF6vMnbqQj63uM0OuVJfcA3wAdCvTUFCQJ1EOzZeJBPYiAJiDTQfcK/X9UrskDr4AMAwPAqzV4toNz9gnlNMnc/KnAUQnKVP6rXHefJ91kMDeA94ABVZBzwPxJWfwtqL4T3uMk0x/YG4Fxc8HeDToDEhtwcJGezSab+BBDUQ4C90doloGZAf5cMMtBlyf4X8DRPUp+k4wVNEI5PUZ+bge62WKvyDyhLiiTbgFZBZV0tPLN++TPBjcPmA3JHIfvssidIFcFb5CL9u8E2QH+n2DegXSPsOsDJZ8D/Sskt4OrMypQLVD/g4zNvZBNhll4ZQfJFpCLggeQAKE1NdI1nfT/pGHwyfm8cDbYbWEvSUCPAz0wvF4YONgCgEuArUBXRjl1YA34fuDbZsz8Cl4h6WTXHvB3B+4L2UbOdSAPK4uKQjlVirYFCBKCEJSFiyB5IyQLk4AOHKb2HaGyRhg4qGCUfE4pJAqxuMpCsF3RW414EVCf4h8TKkfMuEUCUqVoherL4B6JQeyzdGos2CeUay8TSk4zIqPhQBH21pT8Usg9A2Z+eO3+BsmKC9j9RlA8KCdU6kI5FYje1JuiJtJEDANuc0L1mZAsTup2BAoWys6z+ClD8sOmzOTDhn4b1FcIb3+eKR4MVa69C/xTYM+H1IFZDX2PCrjxit5aFkx/mNx+g3Rl1BUfaCfdQt9AtOYkpRq0we8bGXzE414OyBMzk3dgrgP7++CBgg30y+eU/GrwG4Py/hDoXULfagI9WyofAeBHJEsNdDXqVQOsFJ6MyouANxNpO17kvWFD/T7Q/cF4dZkR9ntwzfdDPOQvBDaC+Xlgld8HrBKqf2/QbOx2o2Bji3BrFnPqInX272fwiWBkj9CUfDkFT/inKVph90egD4Iea6qDEin1uLL4NuBpsHdETLeDXSX07VCwAn7stItA2SmFaSDXx9BoFDhAf3057x6CohF6/YQMALiDkgsps/KSQx8Da7NKpApyLphNIMtjv/QmyC3CPz4I63Djn1CwQdMj3cDXmwqdAf8aXLKhhx4DpRHvmQm3r5RTBbFUfgPp5kBlbS6tsRP0u8AUhR2fBORPXicysd8EOyP0YmJA66A/FUrulzEuJ21AkKIJaOqvmloqbaKTAf+7oPypIN9I8OU0VG+WZg2kFdB1QvWt8E3vqNgxk+8SEUiGRjre0YnLgxnUie3f2GMu0B1SrnSA+/cQ/LaRnk9cNGkDghvHy2J+goNNT2PdCsidF/M+oGvPpnIget1PmQEjA92kfmslvdGrpgr1DSBDkG4DWRc8WWoJxmkO9CpTZUCGbmUrsFW5+iFIzhIqxzTLo0zaA3GaMbFpswEtn47DsI7wzdG4rse0igmNIHzCVV3KgunZBrsPC9WPx1N+Qh6QkWG4RGP4V3R+7Od9vATQrGMk5vRKvUGR1olAUAqJZ3ANmLyy5FngBdCdUBkaT/kxR8rWHujugqGZsQO9ACiAPgBmVtOcQFPL+yLwJnAcOJTCkU+pHZjN7v7GB41+SOleAOl2MJ0jLRbpvUJ1w2l5YHRnWf8ZdP4AnIEkyWqWNre7Tc4yK0FWZgclXIxsDTm+YAmFTcMZ9R9DRyfUfBxW/gVmS8xOAr2TM0BGDoAwVIsHaiPtOmqz2eALabRpdkCjsa+Hf2fpCWf8BeqfeVhhkMuP49efRfU/oQj2plNEoaKF7TmYBwxP8q5nTq3V5VTTCJkDzYN8LFQOnIlLMs7M3c/p1qMvlzGiE2BGW9rSlra0pS1fafk/HU2lF10shBoAAAAASUVORK5CYII=';

// data-*属性に地名を入れるための最小限のエスケープ（施設名に " や & が入り得る）
function attrEscape(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildSheetHtml(type, label, p, lng, lat) {
    const navUrl      = `https://www.google.com/maps?daddr=${lat},${lng}&dirflg=${TRAVEL_MODES[travelMode()].gmap}`;
    const coordGmapUrl = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
    // Yahooの経路画面に出す行き先の名前（[配布]などの装飾が付く title ではなく素の名前を使う）
    const destName = p.name || p.pokemon || p.locationName || label || '';
    // 周辺検索の「検索地点」に出す名前。ここは人が読む見出しなので、食べログは
    // 経路の行き先名（destName）と違って店名だけにする
    const originName = type === 'shop' ? (shopDisplayName(p) || label) : label;
    // 行C: 全タイプ共通・常に3個
    // Yahooだけリンクでなくボタンなのは、出発地(現在地)を押された時点で読むため（委譲側に理由）
    const rowC = osRow([
        `<a href="${navUrl}" target="_blank" class="btn btn-nav"><span class="nav-ico"><img src="${NAV_LOGO_GMAPS}" alt="Google Maps"></span><span class="nav-cap">ここへ行く</span></a>`,
        `<button class="btn btn-nav-yahoo" data-lat="${lat}" data-lng="${lng}" data-name="${attrEscape(destName)}"><span class="nav-ico"><img src="${NAV_LOGO_YAHOO}" alt="Yahoo!"></span><span class="nav-cap">ここへ行く</span></button>`,
        `<button class="btn btn-nearby-search" onclick='searchNearby(${lng},${lat},${JSON.stringify(originName)})'>${ICON_SEARCH_SVG}この周辺を検索</button>`,
    ]);
    const isPokefuta = type === 'pokefuta' || (type === 'manhole' && p.source === 'pokefuta');
    // pick は配布場所が複数のカードで行Bの下に出す候補リスト（他の種別では空）
    // badgeAbove はタイトルの上に独立した行で出すバッジ（食べログの部門）。
    // 城やカードのように名前の左に置くと、店名が長い食べログでは名前が押し出されるため
    // titleTail はタイトル行の右端に寄せる要素（食べログの評点）。名前の折り返しに影響しない
    // copyName はタイトル長押しでコピーする素の名前。title に付く [近接あり]・[配布] のような
    // 表示上の注記まで貼り付けたくないので、それらが付く種別だけ別に持つ（既定は title と同じ）
    let badges = '', badgeAbove = '', title = '', titleTail = '', photo = '', lines = '', rowA = '', rowB = '', pick = '', copyName = '';

    if (isPokefuta) {
        title = p.pokemon || label;
        photo = osPhotoHtml(p.image_url_full
            || (p.cardId ? `https://ekikaramanhole.whitebeach.org/ext/pokefuta/image/main/${String(p.cardId).padStart(3,'0')}.jpg` : ''));
        lines = osKv('住所', p.address);
        rowA = osRow([osBtn(coordGmapUrl, 'btn-gmap', 'GoogleMap'), osBtn(p.detail_url, 'btn-pokefuta', '公式ページ')]);

    } else if (type === 'manhole' || type === 'mhcard') {
        // 蓋は配布場所レコードを紐付けて参照する（蓋の住所と配布場所の住所は別物）
        const cardKey = type === 'mhcard' ? cardKeyOfCardRecord(p) : cardCodeKey(p.cardId);
        const cardFeatures = type === 'mhcard' ? [] : findCardFeaturesByKey(cardKey);
        const card = type === 'mhcard' ? p : (cardFeatures.length ? cardFeatures[0].properties : null);
        const info = card ? mhcardInfo(card) : null;
        if (info) {
            // 食べログと同じく、バッジはタイトルの上の行に置く（名前が長いと押し出されるため）
            const b = (info.id ? `<span class="os-cdbadge">${info.id}</span>` : '')
                    + (info.round ? `<span class="os-cdbadge os-cdround">${info.round}</span>` : '');
            badgeAbove = b ? `<div class="os-badge-row">${b}</div>` : '';
        }
        // 配布が終わったカードは公式一覧に「配布終了」の行として残っている（全国で6件）。
        // 配布場所が無いので、そのぶんの行は出さずに終了した旨を出す。
        const ended = !!(card && card.discontinued);
        // 相手が見つからない蓋のうち、改版で旧版の行ごと消えたものは後継カードを案内する
        const successors = (type === 'manhole' && !card) ? findSuccessorCards(p.cardId) : [];
        if (type === 'mhcard') {
            const head = ended ? '<span class="os-ended">[配布終了]</span>' : '[配布]';
            // 配布終了レコードは locationName が「配布終了」なので、見出しに二度出さない
            const who = [info && info.muni, ended ? '' : p.locationName].filter(Boolean).join(' ');
            title = `${p.coordOffset ? '[複]' : ''}${head} ${who || p.name || label}`;
            copyName = who || p.name || label;
            photo = osPhotoHtml(p.cardImgUrl, 'full');   // カードは縦長なので切らずに全体を見せる
            lines = ended
                ? osKv('問合せ', p.contactInfo) + osKv('発行', p.issueDate)
                : osKv('住所', p.address) + osKv('時間', p.hours) + osKv('発行', p.issueDate);
        } else {
            title = p.name || label;
            // 同じカードの画像でも、配布場所レコード側(gk-p.jp)は516×720、cardIdから
            // 組み立てる ekikaramanhole 側は232×320（実測）。写真タップの拡大表示で
            // 引き伸ばさずに済むよう、紐付いていれば大きい方を使う。
            // 紐付かない蓋と、配布場所データ未読込のときは従来のURLにする。
            const cardImgUrl = (card && card.cardImgUrl)
                || (p.cardId ? `https://ekikaramanhole.whitebeach.org/ext/manholecard/image/getimage.cgi?file=card/${p.cardId}.jpg` : '');
            photo = osPhotoHtml(cardImgUrl, 'full');   // カードは縦長なので切らずに全体を見せる
            // 蓋自身の住所と、紐付いたカード配布場所の住所を続けて出すため、
            // 同じ「住所」チップが2つ並ばないよう蓋側は「設置」と呼び分ける。
            let cardLines = '';
            if (card && ended) {
                cardLines = osKv('配布', '配布終了') + osKv('問合せ', card.contactInfo) + osKv('発行', card.issueDate);
            } else if (card) {
                cardLines = osKv('配布場所', card.locationName) + osKv('住所', card.address)
                          + osKv('時間', card.hours) + osKv('発行', card.issueDate);
            } else if (successors.length) {
                // 公式一覧から旧版の行ごと消えているので、発行日すら残っていない。
                // 同じ自治体の後継カードが今どこで配られているかだけを出す。
                const s = successors[0].properties;
                cardLines = osKv('配布', `このカードの配布情報は公式一覧にありません（後継カードあり）`)
                          + osKv('後継', [mhcardInfo(s).id, s.locationName].filter(Boolean).join(' '));
            }
            lines = osKv('設置', p.address) + cardLines;
        }
        rowA = osRow([osBtn(coordGmapUrl, 'btn-gmap', 'GoogleMap')]);
        // 行B: 旧「カード詳細」シートの外部リンク2つ（在庫状況は url がある場合のみ＝1,246/1,426件）に
        //      3つ目として相手側への行き来ボタンを足す。飛び先の種別がOFFのときは出さない。
        let jumpBtn = '';
        if (type === 'mhcard') {
            if (filterState.manhole !== false && findLidFeatureByKey(cardKey)) {
                jumpBtn = `<button class="btn btn-to-lid" onclick="mhJumpToLid('${cardKey}')">マンホールへ</button>`;
            }
        } else if (filterState.mhcard !== false && cardFeatures.length) {
            const j = mhCardJumpHtml(cardFeatures, cardKey, lng, lat);
            jumpBtn = j.btn;
            pick = j.pick;
        } else if (filterState.mhcard !== false && successors.length) {
            // 直接の相手はいないが後継カードがある場合は、そちらの配布場所へ行けるようにする
            const j = mhCardJumpHtml(successors, cardKeyOfCardRecord(successors[0].properties), lng, lat, '後継の配布場所');
            jumpBtn = j.btn;
            pick = j.pick;
        }
        rowB = osRow([info ? osBtn(card.url, 'btn-cd-stock', '在庫状況') : '',
                      info ? osBtn(info.gkpUrl, 'btn-cd-gkp', 'GKP公式一覧') : '',
                      jumpBtn]);

    } else if (type === 'michi') {
        title = p.name || label;
        // road は michi.js の全1,234件が空文字なので、実際にはこの行は出ない（残しておく）
        lines = osKv('路線', p.road) + osKv('住所', p.address) + osKv('時間', p.businessHours);
        rowA = osRow([
            osBtn(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(title)}`, 'btn-gmap', 'GoogleMap'),
            osBtn(p.url, 'btn-michi-web', '公式ページ'),
        ]);
        rowB = osRow([osBtn(p.michiEkiUrl, 'btn-michi-eki', 'michieki.jp'),
                      osBtn(p.homepage, 'btn-michi-hp', '施設HP'),
                      osBtn(p.homepage2, 'btn-michi-hp', '関連HP')]);

    } else if (type === 'castle') {
        const name = p.name || label;
        // 近接する別の城と座標が重なるため表示位置をずらしたエントリには目印を付ける
        // （マンホールカード配布場所のcoordOffsetと同じ仕組み。実際の座標は元の位置から数m~十数mずれている）
        title = p.coordOffset ? `[近接あり] ${name}` : name;
        copyName = name;
        badges = popupFormBadgeHtml(p.shiroHbForm) + castleGenreBadgeHtml(p);
        const aliases = osParseAliases(p.aliases);
        lines = osKv('別名', aliases.length ? aliases.join('、') : '')
              + osLine(popupFormMetaHtml(p.shiroHbElevationM, p.shiroHbRelativeHeightM))
              + castleAttrLine('遺構', p.remains)
              + castleAttrLine('城主', p.lords)
              + osKv('住所', p.address);
        // 写真は非同期取得のため枠だけ先に置き、injectCastleImage で差し込む
        photo = `<div class="os-castle-photo"></div>`;
        rowA = osRow([
            osBtn(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(castleGmapQuery(name, p.address))}`, 'btn-gmap', 'GoogleMap'),
            osBtn(`https://www.google.com/search?q=${encodeURIComponent(name + ' アクセス')}`, 'btn-access', 'アクセス'),
        ]);
        // Wikipediaは記事存在確認が非同期のため初期表示には含めず、injectWikiButtonStateで
        // セット行ごと buildSourceButtons() で再構築する（攻城団・城郭放浪記は同期的に確定済み）
        rowB = `<div class="os-brow os-source-row">${buildSourceButtons('', p.url, p.shiroHbUrl)}</div>`;

    } else {   // shop（食べログ）
        // タイトルは店名だけにし、駅とジャンルは項目へ移す（name をそのまま出すと
        // 「店名 - 駅（ジャンル）」で店名が省略されるため）。
        // ジャンル=店自身のジャンル（つけ麺）、100名店=賞の部門（ラーメン（東京））で別物。
        const sp = shopParts(p);
        title = sp.shop || label;
        titleTail = shopRatingHtml(p);
        const genreBadge = shopGenreBadgeHtml(p, 'os-genrebadge');
        badgeAbove = genreBadge ? `<div class="os-badge-row">${genreBadge}</div>` : '';
        // ジャンルは店舗ページの ld+json（servesCuisine。「ラーメン、餃子、にんにく料理」の
        // ように複数）を優先する。取れていない店は従来どおり name から切り出した1つを出す。
        lines = osKv('ジャンル', p.cuisine || sp.genre)
              + osKv('100名店', p.category)
              + osKv('受賞歴', shopAwardsHtml(p), 'os-line-aw')
              + osKv('予算', shopBudgetHtml(p))
              + osKv('最寄り', sp.station)
              + osKv('住所', p.address);
        // GoogleMap検索は従来どおり name 全体（店名＋駅＋ジャンル）で引く。
        // タイトルが店名だけになったからといって店名だけで引くと、同名店の多い
        // チェーン・支店で別の店に当たるため。
        rowA = osRow([
            osBtn(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name || label)}`, 'btn-gmap', 'GoogleMap'),
            osBtn(p.url, 'btn-tabelog', '食べログ'),
        ]);
    }

    const media = photo ? `<div class="os-row">${photo}<div class="os-meta">${lines}</div></div>` : lines;
    return `${badgeAbove}<div class="os-title">${badges}<span class="os-name" data-copy="${attrEscape(copyName || title)}">${title}</span>${titleTail}</div>${media}${rowA}${rowB}${pick}${rowC}`;
}

// 城シートに写真を非同期で挿入する
async function injectCastleImage(castleName, kojodanUrl, shiroHbUrl) {
    const slotAtStart = document.querySelector('#obj-sheet-body .os-castle-photo');
    const imgUrl = await fetchCastleImage(castleName, kojodanUrl, shiroHbUrl);
    if (!imgUrl) return;
    const slot = document.querySelector('#obj-sheet-body .os-castle-photo');
    // 取得完了までに別のオブジェクトへ切り替わっていたら、その城の写真を差し込まない
    if (!slot || slot !== slotAtStart) return;
    slot.outerHTML = osPhotoHtml(imgUrl, 'wide');   // 城の取得元は横長なので4:3枠にする
    // 画像ロードで高さが変わるため、確定した時点で選択ピンの見え方を補正し直す
    const img = document.querySelector('#obj-sheet-body .os-photo img');
    if (img) img.addEventListener('load', adjustMapForSheet, { once: true });
    applyClampMarkers();
    adjustMapForSheet();
}

// ── シートの開閉と、選択中オブジェクトが隠れないための地図調整 ─────────
let objSheetLngLat = null;   // 現在シートを開いているオブジェクトの座標
let objSheetCtx = null;      // 写真ビューアが「何の写真か」を出すための対象情報
let objSheetPair = null;     // 蓋⇄配布場所を行き来してきたときの[移動元, 移動先]。通常のタップではnull
// ペア表示のときに地図を引く範囲。
// 下限14は「ここまで引いても2点が入らないならペア表示をあきらめる」境目。clusterMaxZoom:13 の
// ため、これより引くとピンがクラスタに畳まれて消えることによる。割った場合は移動先だけへ寄せる。
// 上限17は近すぎる組で寄りすぎないための頭打ちで、周囲の街並みが読み取れる限度。
// 実データ1,223組では26.2%が上限に当たり、18.2%が下限を割ってペア表示を見送る（実測）。
const MH_PAIR_MIN_ZOOM = 14;
const MH_PAIR_MAX_ZOOM = 17;

// 実際に2行を超えて省略されている行にのみ▼マークを付ける
function applyClampMarkers() {
    document.querySelectorAll('#obj-sheet-body .os-clamp').forEach(el => {
        el.classList.toggle('clampable', el.scrollHeight > el.clientHeight + 1);
    });
}

// 選択中のオブジェクトがシートに隠れないよう、シート高さの半分だけ上にずらして
// 「シートより上に残っている領域」の中央にピンが来るように地図を動かす。
// 可視領域の中心 = (H - シート高)/2、地図コンテナの中心 = H/2 なので、
// easeTo の offset に [0, -シート高/2] を渡せばその位置に着地する。
function adjustMapForSheet() {
    if (!objSheetLngLat) return;
    const sheet = document.getElementById('obj-sheet');
    const h = sheet.getBoundingClientRect().height;
    if (!h) return;
    const mapH = map.getContainer().getBoundingClientRect().height;
    // シートは下部バーの上に載るので、画面下から隠れる高さはシート自身より base ぶん高い
    const covered = h + sheetBaseBottom(sheet);
    // 蓋⇄配布場所を行き来した直後は、相手も画面に入るところまで引く。
    // 収める先はシートに隠れない範囲。padding の bottom にシートの実測高さを渡して、
    // その上の帯に2点が入る倍率を cameraForBounds に出させる。
    // シートが高いときに padding が地図を食い潰さないよう、可視域は最低160px残す。
    if (objSheetPair) {
        const [a, b] = objSheetPair;
        const padBottom = Math.min(Math.round(covered) + 20, Math.max(0, mapH - 160));
        const cam = map.cameraForBounds(
            [[Math.min(a[0], b[0]), Math.min(a[1], b[1])], [Math.max(a[0], b[0]), Math.max(a[1], b[1])]],
            { padding: { top: 60, bottom: padBottom, left: 40, right: 40 } });
        // 2点が入る倍率が下限を割るときは、引かずに移動先だけへ寄せる（下の通常処理へ流す）。
        // 無理に下限で止めると、2点の中間を中心にしたまま寄ることになり、
        // 移動先まで画面の外へ出てしまう（8.6km離れた組で実測：移動先が画面右外1077px）。
        if (cam && cam.zoom >= MH_PAIR_MIN_ZOOM) {
            map.easeTo({ center: cam.center, zoom: Math.min(MH_PAIR_MAX_ZOOM, cam.zoom),
                         bearing: 0, pitch: 0, duration: 550, essential: true }, { histIgnore: true });
            return;
        }
    }
    // シートが画面の大半を占める場合でもピンが上端外へ飛ばないよう、ずらし量を制限する
    const dy = Math.min(covered / 2, Math.max(0, (mapH - 80) / 2));
    const opts = { center: objSheetLngLat, offset: [0, -dy], duration: 400, essential: true };
    // ここへ来た objSheetPair は「行き来したが2点は入らなかった」場合。移動先だけへ寄せるが、
    // 引いたままだとクラスタに畳まれて着いた先が分からないので、判別できる倍率までは寄せる。
    if (objSheetPair) opts.zoom = Math.max(map.getZoom(), MH_PAIR_MIN_ZOOM);
    // histIgnore: この移動はシート表示の副作用なので、移動履歴には記録しない
    map.easeTo(opts, { histIgnore: true });
}

// pairFrom: 蓋⇄配布場所を行き来してきたときの移動元の座標。渡すと両方にリングを出して線で結び、
//           地図も両方が入るところまで引く。通常のピンタップでは渡さないので、そこで解除される。
function openObjSheet(type, label, p, lng, lat, pairFrom) {
    const body = document.getElementById('obj-sheet-body');
    body.innerHTML = buildSheetHtml(type, label, p, lng, lat);
    body.scrollTop = 0;
    const sheet = document.getElementById('obj-sheet');
    sheet.style.transition = '';
    sheet.style.bottom = `${sheetBaseBottom(sheet)}px`;
    objSheetLngLat = [lng, lat];
    objSheetCtx = { type, label, p };
    objSheetPair = pairFrom ? [pairFrom.slice(), [lng, lat]] : null;
    setSelectedObjects(objSheetPair || [[lng, lat]], objRingColor(type, p));
    applyClampMarkers();
    // お気に入りの色ラインと★は、開いた対象ごとに引き直す
    closeFavPalette();
    updateSheetFav();
    // 写真は読み込み完了で高さが確定する（カード系は比率なりに伸びる）ため、その時点で寄せ直す
    body.querySelectorAll('img').forEach(img => {
        if (!img.complete) img.addEventListener('load', adjustMapForSheet, { once: true });
    });
    if (type === 'castle') {
        injectCastleImage(p.name || label, p.url, p.shiroHbUrl);
        injectWikiButtonState(p.name || label, p.aliases, p.url, p.shiroHbUrl, lat, lng);
    }
    // レイアウト確定後の実寸で地図を寄せる
    requestAnimationFrame(adjustMapForSheet);
}

function closeObjSheet() {
    const sheet = document.getElementById('obj-sheet');
    sheet.style.transition = '';
    sheet.style.bottom = '-100%';
    objSheetLngLat = null;
    objSheetCtx = null;
    objSheetPair = null;
    closePhotoViewer();   // シートが閉じたら写真ビューアも残さない
    closeFavPalette();    // お気に入りのパレットも残さない
    updateSheetFav();     // 色ラインを消し、★を隠す
    clearSelectedObject();
}

// ══ 写真の全画面ビューア ═══════════════════════════════════════════
/* 情報帯・ピンチズーム／パン・出典切替を1つにまとめたもの。
   3つとも1本指ドラッグを使うため、次の取り決めで衝突を避ける。
     ・等倍のとき  … 横ドラッグで出典切替、下ドラッグで閉じる（上ドラッグは何もしない）
     ・拡大中のとき … ドラッグはパン。出典切替も下スワイプ閉じも無効
     ・ピンチは2本指なのでどちらとも衝突しない
   下スワイプ閉じは等倍限定にしている。拡大中はドラッグがパンなので、下へパンする操作と
   区別できないため。
   拡大に入った瞬間に情報帯とドットを畳む（写真を遮らないため）。ただし畳んだ後も
   1本指タップで出せる。閉じるボタンは情報帯の中にあるので、拡大中に出せないと
   閉じられなくなるため。等倍に戻した瞬間は自動で出す。
   出典を切り替えたときは倍率とパン位置をリセットする。これをしないと
   横長パノラマの倍率が縦長の写真に持ち越されて破綻する。
   閉じるのは情報帯の「閉じる」ボタン。「どこでもタップで閉じる」はダブルタップ拡大・
   パン・UIトグルと競合するため採らない。 */
const PV_SLOP = 8;            // 縦横どちらに倒れたかを判定する移動量(px)
const PV_SWITCH_DIST = 50;    // 出典を切り替える横移動量(px)
// 下スワイプで閉じる判定。ゆっくり引くときは距離、素早く払うときは速さで決める。
// 距離だけだと、軽く払ったときは指が離れる位置が浅く、閉じたつもりで閉じない。
// 速さは「押してから離すまでの平均」で見る。直近の移動量から求める方式は、
// 速く払った直後に指を止めてから離すと古い速さが残って誤って閉じるうえ、
// 逆に一瞬で払うと標本が1つも取れずに速さ0になる（実測で確認）。
// 平均ならどちらも起きない（止めていた時間が分母に入って自然に遅くなる）。
const PV_CLOSE_DIST = 45;     // ゆっくり引いて閉じる移動量(px)
const PV_FLICK_SPEED = 0.25;  // 距離が足りなくても閉じる下向きの平均速さ(px/ms)
const PV_MAX_SCALE = 6;
let pvSources = [];           // [{url, label}]
let pvIdx = 0, pvScale = 1, pvX = 0, pvY = 0, pvUI = true, pvZoomed = false;
let pvPtr = new Map(), pvPinchDist = 0, pvPinchStart = 1, pvPanFrom = null, pvAxis = null, pvDragDX = 0;

function isPhotoViewerOpen() {
    return document.getElementById('photo-viewer').classList.contains('open');
}

// 下スワイプ中の手応え。引くほど黒背景を透かし、下に地図が見えることで
// 「閉じる方向の操作だ」と分かるようにする。
function pvSetDismissProgress(dy, animate) {
    const bd = document.getElementById('pv-backdrop');
    if (!bd) return;
    bd.style.transition = animate ? 'opacity 0.22s ease' : '';
    bd.style.opacity = String(Math.max(0.4, 1 - dy / 400));
}

function openPhotoViewer(sources, startUrl) {
    pvSources = sources.filter(s => s && s.url);
    if (!pvSources.length) return;
    const at = pvSources.findIndex(s => s.url === startUrl);
    pvIdx = at >= 0 ? at : 0;
    pvScale = 1; pvX = 0; pvY = 0; pvUI = true; pvZoomed = false;
    pvPtr.clear(); pvPanFrom = null; pvAxis = null; pvDragDX = 0;

    document.getElementById('pv-track').innerHTML = pvSources.map(s =>
        `<div class="pv-pane"><div class="pv-inner"><img src="${s.url}" alt=""></div></div>`).join('');
    document.getElementById('pv-dots').innerHTML =
        pvSources.length > 1 ? pvSources.map(() => '<i></i>').join('') : '';
    const v = document.getElementById('photo-viewer');
    v.classList.add('open');
    v.setAttribute('aria-hidden', 'false');
    pvSetDismissProgress(0);   // 前回スワイプ途中で閉じた場合の透過を戻す
    pvRender();
    pvSyncInfoHeight();
}

// 情報帯の実高さを写真側の余白(--pv-info-h)へ渡す。
// 帯の高さは名前や住所の行数で変わるため固定値では足りない／余りすぎる。
// 閉じている間(display:none)は測っても0なので、開いた後にだけ呼ぶ。
function pvSyncInfoHeight() {
    const info = document.getElementById('pv-info');
    const h = info.offsetHeight;
    if (h > 0) document.getElementById('photo-viewer').style.setProperty('--pv-info-h', h + 'px');
}

function closePhotoViewer() {
    const v = document.getElementById('photo-viewer');
    if (!v.classList.contains('open')) return;
    v.classList.remove('open');
    v.setAttribute('aria-hidden', 'true');
    document.getElementById('pv-track').innerHTML = '';   // 画像デコードを抱えたままにしない
    pvSources = [];
    pvPtr.clear();
    pvY = 0; pvAxis = null; pvPanFrom = null;
    pvSetDismissProgress(0);
}

function pvRender(animate) {
    const track = document.getElementById('pv-track');
    track.style.transition = animate ? 'transform 0.26s ease' : '';
    track.style.transform = `translateX(calc(${-pvIdx * 100}% + ${pvDragDX}px))`;
    const inner = track.children[pvIdx] && track.children[pvIdx].querySelector('.pv-inner');
    if (inner) {
        inner.style.transition = animate ? 'transform 0.22s ease' : '';
        inner.style.transform = `translate(${pvX}px, ${pvY}px) scale(${pvScale})`;
    }
    // 表示していないペインの倍率は常に戻しておく（切替時に持ち越さない）
    [...track.children].forEach((pane, i) => {
        if (i === pvIdx) return;
        const el = pane.querySelector('.pv-inner');
        if (el) { el.style.transition = ''; el.style.transform = ''; }
    });
    [...document.getElementById('pv-dots').children]
        .forEach((d, i) => d.classList.toggle('on', i === pvIdx));

    const src = pvSources[pvIdx] || {};
    const ctx = objSheetCtx || {};
    document.getElementById('pv-title').textContent = ctx.label || '';
    // 「何の写真か」と「どの取得元か」を1か所にまとめる
    const sub = [(ctx.p && ctx.p.address) || '', src.label || ''].filter(Boolean).join('　/　');
    document.getElementById('pv-sub').textContent = sub;

    // 拡大に入った瞬間だけUIを畳み、等倍に戻った瞬間だけ出す。
    // 拡大中も「隠れたまま固定」にはしない（閉じるボタンが情報帯の中にあるため、
    // 拡大したまま閉じられなくなってしまう）。畳んだ後でもタップで出せる。
    const zoomed = pvScale > 1.02;
    if (zoomed !== pvZoomed) { pvZoomed = zoomed; pvUI = !zoomed; }

    document.getElementById('pv-info').classList.toggle('pv-hidden', !pvUI);
    document.getElementById('pv-dots').classList.toggle('pv-hidden', !pvUI || pvSources.length <= 1);
}

function isObjSheetOpen() {
    return objSheetLngLat !== null;
}

// ══ 下から出るドロワー共通：下方向スワイプで閉じる ══════════════════════
/* GoogleMap のドロワーと同じく、ハンドル部だけでなくシート本文からも下スワイプで閉じる。
   本文起点のときは、内側のスクロール領域が最上部(scrollTop<=0)のときだけドラッグを開始し、
   途中までスクロール済みなら通常のスクロールを優先する。

   入力経路を2本に分ける:
     タッチ … Touch Events。ドラッグ確定後の touchmove を preventDefault して、
              ブラウザのスクロール／オーバースクロールに主導権を渡さない（passive:false 必須）。
     マウス … Pointer Events を pointerType==='mouse' に限定。ドラッグ確定後に
              setPointerCapture し、起点要素が再描画で外れても pointermove/up が届くようにする。
   pointerType で振り分けることで、1操作が両経路で二重処理されるのを防ぐ。

   タップとの区別は移動量 SWIPE_SLOP で行い、ドラッグが成立した場合は直後の click を
   キャプチャ段階で握りつぶす（カテゴリ項目やリンクの誤発火防止）。
   抑止フラグは次のジェスチャ開始(down)で必ず落とすため、時間で解除する必要がなく、
   無関係な後続タップを巻き込まない。 */
/* 感度の調整はこの2定数だけで行う。
   SWIPE_SLOP を下げるとドラッグ開始が早くなるが、本文最上部での軽い引き下げを
   スクロールと誤認しにくくなる代わりに、意図しないドラッグ開始が増える。
   SWIPE_CLOSE_DIST を下げると少ないスワイプ量で閉じる。 */
const SWIPE_SLOP = 8;         // タップ／スクロールとドラッグを分ける移動量(px)
const SWIPE_CLOSE_DIST = 30;  // 下に振り切ったと判定する移動量(px)

/* 開いているときの bottom。下部バーの上に載せるシートだけ 0 でない（CSS の --sheet-base）。
   引きずり位置と復帰位置をここから決めるので、ベースを変えるときは CSS だけ直せばよい。 */
function sheetBaseBottom(el) {
    return parseFloat(getComputedStyle(el).getPropertyValue('--sheet-base')) || 0;
}

function enableSheetSwipeClose(panel, headerEl, onClose, blockSelector) {
    const baseBottom = sheetBaseBottom(panel);
    let startX = 0, startY = 0;
    let armed = false, dragging = false, swallowClick = false;
    let capturePointerId = null;   // マウス経路のみ。ドラッグ確定時に捕捉するため保持する

    // 起点要素から見た、パネル内側の直近のスクロール可能な祖先
    function scrollerAt(target) {
        let el = (target instanceof Element) ? target : null;
        while (el && el !== panel && panel.contains(el)) {
            const ov = getComputedStyle(el).overflowY;
            if ((ov === 'auto' || ov === 'scroll') && el.scrollHeight > el.clientHeight + 1) return el;
            el = el.parentElement;
        }
        return null;
    }

    function down(target, x, y, pointerId) {
        armed = false;
        dragging = false;
        swallowClick = false;   // 前ジェスチャの抑止を持ち越さない
        capturePointerId = (pointerId === undefined) ? null : pointerId;
        if (!(target instanceof Element)) return;
        if (blockSelector && target.closest(blockSelector)) return;
        startX = x;
        startY = y;
        const sc = (headerEl && headerEl.contains(target)) ? null : scrollerAt(target);
        armed = !sc || sc.scrollTop <= 0;
    }

    // 戻り値: ドラッグ中なら true（呼び出し側でブラウザ既定動作を止める）
    function move(x, y) {
        if (!armed) return false;
        const dy = y - startY;
        if (!dragging) {
            if (dy <= SWIPE_SLOP) {
                // 上・横に先に振れた操作はスクロール／横スワイプとみなし、以後拾わない
                if (dy < -SWIPE_SLOP || Math.abs(x - startX) > SWIPE_SLOP) armed = false;
                return false;
            }
            dragging = true;
            // 捕捉はドラッグが確定してから行う。pointerdown 時点で捕捉すると
            // 以後の click のターゲットが panel に差し替わり、シート内のボタンや
            // リンクが一切反応しなくなる（CDPの実マウス入力で確認済み）。
            if (capturePointerId !== null) {
                try { panel.setPointerCapture(capturePointerId); } catch (_) {}
            }
            panel.style.transition = 'none';
        }
        panel.style.bottom = `${baseBottom - (dy - SWIPE_SLOP)}px`;
        return true;
    }

    function restore() {
        panel.style.transition = '';
        panel.style.bottom = `${baseBottom}px`;
    }

    function up(y) {
        if (!armed) return;
        const wasDragging = dragging;
        const dy = y - startY;
        armed = false;
        dragging = false;
        if (!wasDragging) return;
        if (dy > SWIPE_CLOSE_DIST) onClose(); else restore();
        swallowClick = true;   // touchend / pointerup 直後に来る click を1回だけ捨てる
    }

    function cancel() {
        if (dragging) restore();
        armed = false;
        dragging = false;
    }

    panel.addEventListener('click', (e) => {
        if (!swallowClick) return;
        swallowClick = false;
        e.stopPropagation();
        e.preventDefault();
    }, true);

    panel.addEventListener('touchstart', (e) => {
        if (e.touches.length !== 1) { cancel(); return; }
        down(e.target, e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });
    panel.addEventListener('touchmove', (e) => {
        if (e.touches.length !== 1) { cancel(); return; }
        if (move(e.touches[0].clientX, e.touches[0].clientY)) e.preventDefault();
    }, { passive: false });
    panel.addEventListener('touchend', (e) => up(e.changedTouches[0].clientY), { passive: true });
    panel.addEventListener('touchcancel', cancel, { passive: true });

    panel.addEventListener('pointerdown', (e) => {
        if (e.pointerType !== 'mouse') return;
        down(e.target, e.clientX, e.clientY, e.pointerId);
    });
    panel.addEventListener('pointermove', (e) => {
        if (e.pointerType === 'mouse') move(e.clientX, e.clientY);
    });
    panel.addEventListener('pointerup', (e) => {
        if (e.pointerType === 'mouse') up(e.clientY);
    });
    panel.addEventListener('pointercancel', (e) => {
        if (e.pointerType === 'mouse') cancel();
    });
}

/* シート内の縦スクロール領域は、スクロール不能な間だけ touch-action を none にする。

   overscroll-behavior: contain は「スクロール可能なオーバーフローを持たないコンテナには
   効かない」部分実装（Safari 16+ / Chrome 63-143）。そのため内容が短くスクロール不要な
   状態では防波堤が無くなり、本文起点の下スワイプがドキュメントまで波及する。iOSでは
   ビューポートごとバウンスし、背後の地図が下にずれて上端に隙間が出る。
   スクロール不能なら pan-y を許す理由がないので、none にしてブラウザ側で塞ぐ。

   touchmove の preventDefault を SWIPE_SLOP 到達前に前倒しする手もあるが、
   W3C Touch Events はキャンセルされたタッチに続くマウスイベント／click を
   発火させないと規定しており、指のわずかなブレでシート内のボタンが
   反応しなくなるため採らない。 */
function watchScrollerTouchAction(selector) {
    document.querySelectorAll(selector).forEach(sc => {
        let queued = false;
        const apply = () => {
            queued = false;
            sc.style.touchAction = (sc.scrollHeight > sc.clientHeight + 1) ? 'pan-y' : 'none';
        };
        // 内容の差し替えでまとめて発火するため、1フレームに1回へ間引く
        const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(apply); } };
        apply();
        new ResizeObserver(schedule).observe(sc);
        new MutationObserver(schedule).observe(sc, { childList: true, subtree: true });
    });
}

// オブジェクトのクリック対象レイヤーID（レイヤー生成時に詰める）
const objClickLayers = [];

// ── 選択リング（②二重リング）。ピンと同じ種別色で、ピンの外側に2重の輪を出す ──
// ピンは直径28px（フチ無し）なので、内リングφ46/外リングφ62なら重ならない。
// 色は「地図上のピンと同じ色」に合わせる。
// mhcard だけは typeConfig の #1565C0（検索結果や履歴のアイコン背景用）を使うと
// 地図上のピン（カードの面は MHCARD_FACE_COLOR の #B87333）と食い違うため、
// ピンの見た目に合わせてマンホール系の #B87333 を使う。
const OBJ_TYPE_COLOR = {
    castle: '#8A8A8A', michi: '#0B499D', shop: '#FFAA00',   /* 色は食べログのアイコンの地色 */
    manhole: '#B87333', mhcard: '#B87333', pokefuta: '#FBBC04',
};
function objRingColor(type, p) {
    if (type === 'castle') {
        if (p.genre === '日本100名城') return CASTLE_MEIJO_COLOR;
        if (p.genre === '続日本100名城') return CASTLE_ZOKU_MEIJO_COLOR;
    }
    if (type === 'manhole' && p.source === 'pokefuta') return OBJ_TYPE_COLOR.pokefuta;
    return OBJ_TYPE_COLOR[type] || '#546E7A';
}
function setSelectedObject(coords, color) {
    setSelectedObjects([coords], color);
}
// 蓋⇄配布場所をボタンで行き来したときは、移動元と移動先の両方にリングを出し、間を線で結ぶ。
// リングのレイヤーは circle なので、ソースに2点入れるだけで両方に描かれる。
// 線は消し方をリングと揃えたいので、同じ関数で出し入れする。
function setSelectedObjects(coordsList, color) {
    const src = map.getSource('selected-object-source');
    if (!src) return;
    src.setData({
        type: 'FeatureCollection',
        features: coordsList.map(c => ({ type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties: {} })),
    });
    map.setPaintProperty('selected-ring-inner', 'circle-stroke-color', color);
    map.setPaintProperty('selected-ring-outer', 'circle-stroke-color', color);
    const link = map.getSource('selected-link-source');
    if (link) {
        link.setData(coordsList.length >= 2
            ? { type: 'Feature', geometry: { type: 'LineString', coordinates: coordsList.slice(0, 2) }, properties: {} }
            : { type: 'FeatureCollection', features: [] });
        if (map.getLayer('selected-link')) map.setPaintProperty('selected-link', 'line-color', color);
    }
}
function clearSelectedObject() {
    const src = map.getSource('selected-object-source');
    if (src) src.setData({ type: 'FeatureCollection', features: [] });
    const link = map.getSource('selected-link-source');
    if (link) link.setData({ type: 'FeatureCollection', features: [] });
}

function bearingRafLoop() {
    if (trackingMode > 0 && !isZooming && currentLocation) {
        // ── 位置補間 ──
        if (rafLng === null) { rafLng = currentLocation.lng; rafLat = currentLocation.lat; }
        const dLng = currentLocation.lng - rafLng;
        const dLat = currentLocation.lat - rafLat;
        // 約3m以下の差は無視して打ち切る（GPS誤差による震え防止）
        const posThreshold = 0.00003;
        if (Math.abs(dLng) > posThreshold || Math.abs(dLat) > posThreshold) {
            // ③ 補間後の値がPOS_CONVERGE以下なら完全に一致させて収束打ち切り（保険）
            const newLng = rafLng + dLng * POSITION_LERP;
            const newLat = rafLat + dLat * POSITION_LERP;
            rafLng = Math.abs(currentLocation.lng - newLng) < POS_CONVERGE ? currentLocation.lng : newLng;
            rafLat = Math.abs(currentLocation.lat - newLat) < POS_CONVERGE ? currentLocation.lat : newLat;
        }

        if (trackingMode === 2) {
            // ── bearing補間 ──
            if (rafBearing === null) { rafBearing = deviceHeading; }
            const diff = getShortestAngleDiff(rafBearing, deviceHeading);
            if (Math.abs(diff) < 0.1) {
                // 収束判定：0.1度以下なら完全に一致させて止める
                rafBearing = deviceHeading;
            } else if (Math.abs(diff) >= BEARING_THRESHOLD) {
                rafBearing = (rafBearing + diff * BEARING_LERP + 360) % 360;
            }
            // ① ② ④ カメラ更新を jumpTo で一括化・各変化チェックを適用
            const bearingChanged = prevSetBearing === null || Math.abs(getShortestAngleDiff(prevSetBearing, rafBearing)) >= BEARING_SET_THRESHOLD; // ④
            const posChanged     = prevSetLng === null || Math.abs(rafLng - prevSetLng) > 0.000001 || Math.abs(rafLat - prevSetLat) > 0.000001;
            const pitchChanged   = prevSetPitch !== 70; // ②
            if (posChanged || bearingChanged || pitchChanged) {
                // ① setCenter / setBearing / setPitch を jumpTo で1回にまとめる
                const cameraUpdate = {};
                if (posChanged)     { cameraUpdate.center  = [rafLng, rafLat]; prevSetLng = rafLng; prevSetLat = rafLat; }
                if (bearingChanged) { cameraUpdate.bearing = rafBearing;        prevSetBearing = rafBearing; }
                if (pitchChanged)   { cameraUpdate.pitch   = 70;                prevSetPitch = 70; } // ②
                map.jumpTo(cameraUpdate);
            }
            // カメラ更新後にマーカーを更新（1フレームずれ防止）
            // モード2は地図自体が向きを追従しているためアイコンは0固定
            if (currentMarker) {
                currentMarker.setLngLat([rafLng, rafLat]);
                currentMarker.getElement().style.setProperty('--heading', '0deg');
            }
        } else {
            // trackingMode === 1: 位置追従＋扇エフェクト
            map.setCenter([rafLng, rafLat]);
            if (currentMarker) {
                currentMarker.setLngLat([rafLng, rafLat]);
                if (deviceHeading !== null) {
                    const relativeHeading = getShortestAngleDiff(map.getBearing() || 0, deviceHeading);
                    currentMarker.getElement().style.setProperty('--heading', `${relativeHeading}deg`);
                }
            }
        }
    }

    rafId = requestAnimationFrame(bearingRafLoop);
}

// --- 1. 地図ドラッグ（移動）開始時の処理を修正 ---
map.on('dragstart', () => {
    if (trackingMode > 0) {
        const wasMode2 = trackingMode === 2;
        preTrackingMode = trackingMode;
        trackingMode = 0;
        stopRafLoop();
        updateGeolocateButton();
        if (!wasMode2) {
            map.easeTo({ bearing: 0, pitch: 0, duration: 350, essential: true });
        }
    }
});

map.getCanvas().addEventListener('touchstart', () => {
    if (trackingMode > 0) {
        const wasMode2 = trackingMode === 2;
        preTrackingMode = trackingMode;
        trackingMode = 0;
        stopRafLoop();
        updateGeolocateButton();
        if (!wasMode2) {
            map.easeTo({ bearing: 0, pitch: 0, duration: 350, essential: true });
        }
    }
}, { passive: true });

// --- 2. ズーム終了時の処理 ---
map.on('zoomstart', () => { isZooming = true; });
map.on('zoomend', () => { isZooming = false; });

    // ボタンの見た目を更新


    function updateGeolocateButton() {
        const btn = document.getElementById('geolocate-btn');
        const btn2 = document.getElementById('nearby-geolocate-btn');
        if (!btn) return;
        const markerEl = currentMarker ? currentMarker.getElement() : null;

        if (trackingMode === 0) {
            btn.classList.remove('geolocate-active');
            btn.innerHTML = iconLocate;
            if (btn2) { btn2.classList.remove('geolocate-active'); btn2.innerHTML = iconLocate; }
            if (markerEl) {
                markerEl.classList.remove('tracking');
                markerEl.classList.remove('heading-active');
                markerEl.classList.remove('nav-mode');
            }
        } else if (trackingMode === 1) {
            btn.classList.add('geolocate-active');
            btn.innerHTML = iconLocate;
            if (btn2) { btn2.classList.add('geolocate-active'); btn2.innerHTML = iconLocate; }
            if (markerEl) {
                markerEl.classList.add('tracking');
                markerEl.classList.add('heading-active');
                markerEl.classList.remove('nav-mode');
            }
        } else { // mode 2
            btn.classList.add('geolocate-active');
            btn.innerHTML = iconNav;
            if (btn2) { btn2.classList.add('geolocate-active'); btn2.innerHTML = iconNav; }
            if (markerEl) {
                markerEl.classList.add('tracking');
                markerEl.classList.remove('heading-active');
                markerEl.classList.add('nav-mode');
            }
        }
    }

    // スタイル調整：日本語化・駅強調・POI整理・水域色
    const ownLayerPrefixes = ['shops-', 'castles-', 'michi-', 'manholes-', 'mhcards-'];
    /* Liberty では駅もバス停も poi_transit の1枚に同居している。駅だけ衝突回避を
       外したいので、駅用のレイヤーを複製して元の1枚はバス停専用にする（下記 tuneLibertyStyle）。 */
    const busLayerId     = 'poi_transit';
    const stationLayerId = 'poi_transit_station';
    /* poi_r系から落とす class。値は実タイル（日本の z14 9枚・POI 42,487件）を
       復号して確認したもので、仕様書ではなく配信されている中身に合わせている。
       以前ここにあった car_dealer / car_rental / car_wash / car_repair / motorcycle /
       charging_station は OpenMapTiles の class に存在せず、6つとも空振りだった。
       カーディーラーと整備工場は class='car'（subclass が car / car_repair / car_parts）。 */
    const excludedPoiClasses = [
        // 車まわり
        'parking', 'fuel', 'car',
        // 駅・バス停は poi_transit 側と重複する
        'railway', 'bus',
        /* 地図の道具立て。アイコンがスプライトに無いうえ、名前もほとんど付かない
           （実タイルで bollard 1,117件は名前0件、cycle_barrier 67件も0件）。 */
        'entrance', 'telephone', 'bollard', 'gate', 'cycle_barrier', 'lift_gate', 'stile',
        'toll_booth', 'bicycle_parking', 'motorcycle_parking', 'recycling', 'brownfield',
        'reservoir', 'basin',
    ];
    const stationSubclasses = ['station', 'halt', 'subway', 'tram_stop', 'light_rail', 'stop', 'stop_position', 'platform', 'monorail', 'funicular', 'bus_station', 'bus_stop'];

    /* ===== OSM公式ベクター（Shortbread v1 ＋ VersaTiles Colorful）用 =====
       Liberty と共通するレイヤーIDは1つも無い。対応は Shortbread 仕様書と
       スタイルJSONの実物で突き合わせ済み。
         poi_transit         → symbol-transit-*（駅は種別ごとに分割。バス停も独立レイヤー）
         poi_r1/r7/r20       → source-layer 'pois' の poi-amenity ほか9レイヤー
         transportation_name → source-layer 'street_labels'
       Shortbread に rank と class は無い。POI の種別は class ではなく
       amenity / shop / leisure / tourism / man_made / historic / emergency /
       highway / office の9属性に分かれて入る。 */
    const sbStationLayerIds = ['symbol-transit-station', 'symbol-transit-subway',
                               'symbol-transit-lightrail', 'symbol-transit-tram',
                               'symbol-transit-airport', 'symbol-transit-airfield'];
    const sbBusLayerIds     = ['symbol-transit-bus'];
    /* pois から落とす種別。Liberty 側の excludedPoiClasses と役割は同じだが、
       スキーマが違うので中身は揃わない。ここに要るのは車まわりの5つだけ。
       parking・entrance は pois に入らない（parking は sites レイヤーのポリゴンで
       ラベルを持たない）。Liberty 側で落としている車止め・門などの道具立てが
       Shortbread の pois に入るかは未確認で、ここでは触っていない。
       railway・bus は pois ではなく public_transport 側なので、ここには要らない。

       判定は仕様書ではなく実タイルで行うこと。Shortbread 1.0 の仕様書に
       amenity=fuel の記載は無いが、配信タイルには入っている（日本の9タイルで34件）。
       leisure=park・leisure=playground も仕様書では land レイヤー扱いだが pois にも入る。
       2026-09-02 に実タイルを復号して確認した。 */
    const sbExcludedPois = [['shop', 'car'], ['amenity', 'car_rental'],
                            ['amenity', 'car_wash'], ['amenity', 'telephone'],
                            ['amenity', 'fuel']];
    /* 水域・緑地の塗り替え対象。Liberty と同じく id の部分一致で拾うと、
       陸地色で描かれている water-dam-area・water-pier-area まで水色になり、
       site-parking・site-bicycleparking（駐車場）が緑になるので、名指しで指定する。 */
    const sbWaterFillIds = ['water-ocean', 'water-area', 'water-area-river', 'water-area-small'];
    const sbGreenFillIds = ['land-park', 'land-garden', 'land-grass', 'land-forest',
                            'land-vegetation', 'land-leisure'];
    /* 鉄道。:outline（縁取り）と -service（側線）は太らせず、本線だけ強調する。 */
    const sbRailLayerIds = ['transport-rail', 'tunnel-transport-rail', 'bridge-transport-rail',
                            'transport-lightrail', 'tunnel-transport-lightrail', 'bridge-transport-lightrail',
                            'transport-monorail', 'tunnel-transport-monorail', 'bridge-transport-monorail'];

    map.once('style.load', () => {
        const allLayers = map.getStyle().layers;
        if (!allLayers) return;
        if (isOsmVector) tuneShortbreadStyle(allLayers);
        else             tuneLibertyStyle(allLayers);
    });

    /* OpenFreeMap Liberty（OpenMapTiles スキーマ）用の調整。 */
    function tuneLibertyStyle(allLayers) {
        /* symbol-sort-key（小さいほど前に出す）
             駅              : rank そのまま（実データで rank=1 が最上位）
             バス停          : rank + 1000（駅より必ず後ろ）
             一般POI・地名   : 100
             シールド・道路名 : 200 */

        /* 駅とバス停を別レイヤーに分ける。Liberty の poi_transit は駅・バス停・空港が
           同居する1枚で、ここに text-allow-overlap を付けると駅だけでなくバス停まで
           衝突回避から外れ、バス停の名前が束になって重なる（z17 東京駅で30件が
           重なるのを実測）。駅は必ず出したいので、同じ定義を駅専用に複製して
           そちらにだけ allow-overlap を付け、元の poi_transit はバス停専用にする。 */
        const transitBase = allLayers.find(l => l.id === busLayerId);
        if (transitBase && !map.getLayer(stationLayerId)) {
            const clone = JSON.parse(JSON.stringify(transitBase));
            clone.id = stationLayerId;
            try { map.addLayer(clone); } catch (e) { console.warn('[style] 駅レイヤーの複製', e); }
        }

        /* 駅・空港。allow-overlap は true（重なっても必ず描く）だが ignore-placement は
           false のままにして、バス停や一般POIが避ける相手としては残す。 */
        function tuneTransitStation() {
            const id = stationLayerId;
            if (!map.getLayer(id)) return;
            const isRail = ['==', ['get', 'class'], 'railway'];
            try {
                map.setFilter(id, ['all', ['has', 'name'],
                    ['match', ['get', 'class'], ['railway', 'airport'], true, false]]);
                map.setLayoutProperty(id, 'text-field', ['coalesce', ['get', 'name:ja'], ['get', 'name']]);
                map.setLayoutProperty(id, 'symbol-sort-key', ['get', 'rank']);
                map.setLayoutProperty(id, 'text-allow-overlap', true);
                map.setLayoutProperty(id, 'icon-allow-overlap', true);
                map.setLayoutProperty(id, 'text-ignore-placement', false);
                map.setLayoutProperty(id, 'icon-ignore-placement', false);
                map.setLayoutProperty(id, 'text-anchor', 'top');
                map.setLayoutProperty(id, 'text-offset', [0, 0.9]);
                map.setLayoutProperty(id, 'icon-size', 1.0);
                map.setLayoutProperty(id, 'text-size', 12);
                map.setLayoutProperty(id, 'visibility', 'visible');
                map.setLayerZoomRange(id, 1, 24);
                map.setPaintProperty(id, 'text-color', ['case', isRail, '#0D47A1', '#444444']);
                map.setPaintProperty(id, 'text-halo-color', '#FFFFFF');
                map.setPaintProperty(id, 'text-halo-width', 2.5);
                map.setPaintProperty(id, 'text-opacity', 1);
                map.setPaintProperty(id, 'icon-opacity', 1);
            } catch (e) { console.warn('[style] 駅', e); }
        }

        // バス停。衝突回避は既定のまま（重ならない）。z13→14 でフェードインする。
        function tuneTransitBus() {
            const id = busLayerId;
            if (!map.getLayer(id)) return;
            /* 以前は ['case', バス停か, ['interpolate', ['linear'], ['zoom'], …], 1] と
               書いていたため、「zoom 式は step / interpolate の最上位でしか使えない」で
               MapLibre に丸ごと弾かれ、フェードは一度も効いていなかった。
               レイヤーがバス停専用になったので素直な zoom 補間で書ける。 */
            const fade = ['interpolate', ['linear'], ['zoom'], 13, 0, 14, 1];
            try {
                map.setFilter(id, ['all', ['has', 'name'], ['==', ['get', 'class'], 'bus']]);
                map.setLayoutProperty(id, 'text-field', ['coalesce', ['get', 'name:ja'], ['get', 'name']]);
                map.setLayoutProperty(id, 'symbol-sort-key', ['+', ['get', 'rank'], 1000]);
                map.setLayoutProperty(id, 'text-anchor', 'left');
                map.setLayoutProperty(id, 'text-offset', [0.9, 0]);
                map.setLayoutProperty(id, 'icon-size', 0.8);
                map.setLayoutProperty(id, 'text-size', 11);
                map.setLayoutProperty(id, 'visibility', 'visible');
                map.setLayerZoomRange(id, 1, 24);
                map.setPaintProperty(id, 'text-color', '#2E7D32');
                map.setPaintProperty(id, 'text-halo-color', '#FFFFFF');
                map.setPaintProperty(id, 'text-halo-width', 1.0);
                map.setPaintProperty(id, 'text-opacity', fade);
                map.setPaintProperty(id, 'icon-opacity', fade);
            } catch (e) { console.warn('[style] バス停', e); }
        }

        tuneTransitStation();
        tuneTransitBus();

        // 鉄道は本線とハッチ（枕木）で別レイヤーになっている
        const railLayers = [
            'tunnel_major_rail', 'road_major_rail', 'bridge_major_rail',
            'tunnel_transit_rail', 'road_transit_rail', 'bridge_transit_rail'
        ];
        const railHatchLayers = railLayers.map(id => id + '_hatching');

        allLayers.forEach(layer => {
            const isShield = layer.id.includes('shield');
            const isTransName = layer['source-layer'] === 'transportation_name';
            if (isShield || isTransName) {
                // 国道シールド・道路名は最背面（駅より必ず背面）
                try {
                    map.setLayoutProperty(layer.id, 'symbol-sort-key', 200);
                    map.setLayoutProperty(layer.id, 'text-ignore-placement', false);
                    map.setLayoutProperty(layer.id, 'icon-ignore-placement', false);
                    /* シールドの3枚は ['<=', ['get','ref_length'], 6] で数値比較していて、
                       ref_length を持たない地物（東京駅周辺の transportation_name 854件中
                       611件）を評価するたびに「Expected value to be of type number, but
                       found null instead」が出る。null との比較は false になるので描画結果は
                       変わらない。all は短絡評価なので has を前に置いて警告だけ止める。 */
                    if (isShield) {
                        const f = map.getFilter(layer.id);
                        if (f) map.setFilter(layer.id, ['all', ['has', 'ref_length'], f]);
                    }
                } catch (e) {}
                return;
            }
            if (ownLayerPrefixes.some(p => layer.id.startsWith(p))) return;
            if (layer.id === busLayerId || layer.id === stationLayerId) return;   // 上で設定済み
            try {
                if (layer.type === 'symbol' && layer.layout && layer.layout['text-field']) {
                    map.setLayoutProperty(layer.id, 'text-field', ['coalesce', ['get', 'name:ja'], ['get', 'name']]);
                    // 一般POI・地名は駅より背面
                    map.setLayoutProperty(layer.id, 'symbol-sort-key', 100);
                    map.setLayoutProperty(layer.id, 'text-ignore-placement', false);
                    map.setLayoutProperty(layer.id, 'icon-ignore-placement', false);
                    // poi_r系から不要POIを除外（値は実タイルで確認。excludedPoiClasses の定義を参照）
                    if (['poi_r1', 'poi_r7', 'poi_r20'].includes(layer.id)) {
                        const existingFilter = map.getFilter(layer.id) || ['all'];
                        map.setFilter(layer.id, ['all',
                            existingFilter,
                            ['!', ['in', ['get', 'class'], ['literal', excludedPoiClasses]]]
                        ]);
                    }
                }
                if (layer.type === 'fill') {
                    const lid = layer.id.toLowerCase();
                    if (lid.includes('water')) {
                        map.setPaintProperty(layer.id, 'fill-color', '#AAD3DF');
                    } else if (['park', 'green', 'grass', 'forest', 'wood'].some(w => lid.includes(w))) {
                        /* 緑地。以前は grass が語のリストから漏れていて landcover_grass だけ
                           元の色 rgba(176,213,154) のまま残り、濃さも park 0.7 / wood 0.4 /
                           grass 0.3 と三者三様だった。色と濃さを揃える。 */
                        map.setPaintProperty(layer.id, 'fill-color', '#C8FACC');
                        map.setPaintProperty(layer.id, 'fill-opacity', 0.6);
                    }
                }
                /* 鉄道の強調。本線だけ青くすると、枕木のハッチが灰色のまま
                   z15で3px→z20で8px と太っていき、拡大するほど灰色が勝ってしまう。
                   ハッチも同じ青にする。本線の幅は 0.7 固定をやめ、引いたときの
                   見え方（0.7）を保ったまま寄ると太るようにした（固定のままだと z20 で
                   元スタイルの 2px より細くなる）。 */
                if (railLayers.includes(layer.id)) {
                    map.setPaintProperty(layer.id, 'line-color', '#1565C0');
                    map.setPaintProperty(layer.id, 'line-width',
                        ['interpolate', ['exponential', 1.4], ['zoom'], 11, 0.7, 14, 0.7, 15, 1, 20, 2.5]);
                    map.setPaintProperty(layer.id, 'line-opacity', 0.9);
                    map.setLayerZoomRange(layer.id, 1, 24);
                }
                if (railHatchLayers.includes(layer.id)) {
                    map.setPaintProperty(layer.id, 'line-color', '#1565C0');
                    map.setPaintProperty(layer.id, 'line-opacity', 0.9);
                    map.setLayerZoomRange(layer.id, 1, 24);
                }
            } catch (e) {}
        });
    }

    /* OSM公式ベクター（Shortbread ＋ Colorful）用の調整。
       symbol-sort-key の意味付けは Liberty 側と揃える（0:駅 / 100:一般POI・地名 /
       200:道路名・シールド）。Liberty では駅の序列に rank を使っていたが、
       Shortbread に rank は無いので固定値にする。
       text-field は書き換えない。Colorful の POI はアイコンのみでラベルを持たず、
       住所レイヤーは {housenumber}、シールドは {ref} を出しているため、
       name で上書きすると表示が壊れる。日本国内は name がそのまま日本語なので、
       Liberty 側のような name:ja へのフォールバックも要らない。
       なお配信されるタイルには name_ja / name_en / name_zh など多言語の名前が入っている
       （Shortbread 仕様書は name・name_en・name_de しか挙げていないが、OSM の配信は
       それより多い。2026-09-02 に実タイルを復号して確認。日本の9タイル12,058件のうち
       name が67%、name_ja が21%）。多言語表示をやるならこの項目を使う。 */
    function tuneShortbreadStyle(allLayers) {
        /* スプライトは style.json に書けない。MapLibre 3.6.2 の normalizeSpriteURL が
           `scheme://host` 形式の絶対URLしか受け付けず（正規表現 /^(\w+):\/\/.../）、
           相対パスやルート絶対パスだと Unable to parse URL で落ちてスタイルが完成しない。
           配信オリジンは localhost と本番で変わるので JSON に直書きもできない。
           そこで style.json からは sprite を外し、ここで location 基準の絶対URLにして足す。 */
        try {
            if (!map.getSprite().some(s => s.id === 'basics')) {
                map.addSprite('basics', new URL('osm-shortbread/sprites/sprites', location.href).href);
            }
        } catch (e) { console.warn('[sprite]', e); }

        const stationColor = '#0D47A1';
        const busColor     = '#2E7D32';
        const busFade      = ['interpolate', ['linear'], ['zoom'], 13, 0, 14, 1];
        const notExcludedPoi = ['!', ['any'].concat(sbExcludedPois.map(([k, v]) => ['==', ['get', k], v]))];
        allLayers.forEach(layer => {
            if (ownLayerPrefixes.some(p => layer.id.startsWith(p))) return;
            try {
                // 国道シールド・道路名は最背面（駅より必ず背面）
                if (layer.id.includes('shield') || layer['source-layer'] === 'street_labels') {
                    map.setLayoutProperty(layer.id, 'symbol-sort-key', 200);
                    map.setLayoutProperty(layer.id, 'text-ignore-placement', false);
                    map.setLayoutProperty(layer.id, 'icon-ignore-placement', false);
                    return;
                }
                // 駅：常に最前面、青字。アイコンはSDFなので icon-color で色が乗る
                if (sbStationLayerIds.includes(layer.id)) {
                    map.setLayoutProperty(layer.id, 'symbol-sort-key', 0);
                    map.setLayoutProperty(layer.id, 'text-allow-overlap', true);
                    map.setLayoutProperty(layer.id, 'icon-allow-overlap', true);
                    map.setLayoutProperty(layer.id, 'text-ignore-placement', true);
                    map.setLayoutProperty(layer.id, 'icon-ignore-placement', true);
                    map.setLayoutProperty(layer.id, 'text-size', 12);
                    map.setLayerZoomRange(layer.id, 1, 24);
                    map.setPaintProperty(layer.id, 'text-color', stationColor);
                    map.setPaintProperty(layer.id, 'icon-color', stationColor);
                    map.setPaintProperty(layer.id, 'text-halo-color', '#FFFFFF');
                    map.setPaintProperty(layer.id, 'text-halo-width', 2.5);
                    map.setPaintProperty(layer.id, 'icon-opacity', 1);
                    return;
                }
                /* バス停：駅より必ず後退させ、z13→14でフェードインさせる。
                   Shortbread の bus_stop は z14 以上にしか入らないので実質 z14 から出る。 */
                if (sbBusLayerIds.includes(layer.id)) {
                    map.setLayoutProperty(layer.id, 'symbol-sort-key', 1000);
                    map.setLayoutProperty(layer.id, 'text-size', 11);
                    map.setLayoutProperty(layer.id, 'text-anchor', 'left');
                    map.setLayoutProperty(layer.id, 'text-offset', [0.9, 0]);
                    map.setLayerZoomRange(layer.id, 1, 24);
                    map.setPaintProperty(layer.id, 'text-color', busColor);
                    map.setPaintProperty(layer.id, 'icon-color', busColor);
                    map.setPaintProperty(layer.id, 'text-halo-color', '#FFFFFF');
                    map.setPaintProperty(layer.id, 'text-halo-width', 1.0);
                    map.setPaintProperty(layer.id, 'text-opacity', busFade);
                    map.setPaintProperty(layer.id, 'icon-opacity', busFade);
                    return;
                }
                // 一般POI：不要な種別を落とす（既存フィルターは残して AND で足す）
                if (layer['source-layer'] === 'pois') {
                    const existingFilter = map.getFilter(layer.id);
                    map.setFilter(layer.id, existingFilter
                        ? ['all', existingFilter, notExcludedPoi]
                        : notExcludedPoi);
                }
                // 駅以外の全シンボル（一般POI・地名）は駅より背面
                if (layer.type === 'symbol') {
                    map.setLayoutProperty(layer.id, 'symbol-sort-key', 100);
                    map.setLayoutProperty(layer.id, 'text-ignore-placement', false);
                    map.setLayoutProperty(layer.id, 'icon-ignore-placement', false);
                }
                if (layer.type === 'fill') {
                    if (sbWaterFillIds.includes(layer.id))      map.setPaintProperty(layer.id, 'fill-color', '#AAD3DF');
                    else if (sbGreenFillIds.includes(layer.id)) map.setPaintProperty(layer.id, 'fill-color', '#C8FACC');
                }
                // 鉄道線路の強調表示
                if (sbRailLayerIds.includes(layer.id)) {
                    map.setPaintProperty(layer.id, 'line-color', '#1565C0');
                    map.setPaintProperty(layer.id, 'line-width', 0.7);
                    map.setPaintProperty(layer.id, 'line-opacity', 0.9);
                    map.setLayerZoomRange(layer.id, 1, 24);
                }
            } catch (e) {}
        });
    }

    map.on('load', () => {
        // 検索ピン（GLレイヤー）
        const pinSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="52" viewBox="0 0 28 36"><path d="M14 0C7.4 0 2 5.4 2 12c0 8.4 12 24 12 24s12-15.6 12-24C26 5.4 20.6 0 14 0z" fill="#F44336"/><circle cx="14" cy="12" r="5" fill="white" opacity="0.9"/></svg>`;
        const pinImg = new Image(40, 52);
        pinImg.onload = () => { if (!map.hasImage('search-pin-icon')) map.addImage('search-pin-icon', pinImg, { pixelRatio: 2 }); };
        pinImg.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(pinSvg);
        map.addSource('search-pin-source',    { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addSource('pin-pulse-source',     { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addSource('pin-progress-source',  { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({ id: 'pin-pulse-layer', type: 'circle', source: 'pin-pulse-source', paint: { 'circle-radius': 0, 'circle-radius-transition': { duration: 0 }, 'circle-color': 'rgba(244,67,54,1)', 'circle-opacity': 0, 'circle-opacity-transition': { duration: 0 } } });
        map.addLayer({ id: 'pin-progress-layer', type: 'circle', source: 'pin-progress-source', paint: { 'circle-radius': 0, 'circle-color': 'rgba(244,67,54,0.1)', 'circle-opacity': 1, 'circle-stroke-width': 3, 'circle-stroke-color': 'rgba(244,67,54,0.85)', 'circle-stroke-opacity': 0 } });
        map.addLayer({ id: 'search-pin-layer',   type: 'symbol', source: 'search-pin-source',   layout: { 'icon-image': 'search-pin-icon', 'icon-size': 1, 'icon-anchor': 'bottom', 'icon-allow-overlap': true, 'icon-ignore-placement': true } });
        // 選択中オブジェクトの二重リング。オブジェクトのピンレイヤーはこの後に追加されるため、
        // ここで先に足しておけば常にピンの下に描かれ、リングがピンを隠さない。
        // 寸法: ピン直径28（フチ無し。外側にぼかし影が半径21まで薄く伸びる）に対し
        //       内リングφ46(線3)／外リングφ62(線2)。影の裾とリングは接するが重ならない。
        // 蓋⇄配布場所を行き来したときに2つのリングを結ぶ線。リングより先に足してその下に敷く。
        map.addSource('selected-link-source', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({ id: 'selected-link', type: 'line', source: 'selected-link-source',
            layout: { 'line-cap': 'round' },
            paint: { 'line-color': '#546E7A', 'line-width': 2.5, 'line-opacity': 0.75, 'line-dasharray': [2, 1.6] } });
        map.addSource('selected-object-source', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({ id: 'selected-ring-outer', type: 'circle', source: 'selected-object-source', paint: { 'circle-radius': 31, 'circle-opacity': 0, 'circle-stroke-width': 2, 'circle-stroke-color': '#546E7A', 'circle-stroke-opacity': 0.45 } });
        map.addLayer({ id: 'selected-ring-inner', type: 'circle', source: 'selected-object-source', paint: { 'circle-radius': 23, 'circle-opacity': 0, 'circle-stroke-width': 3, 'circle-stroke-color': '#546E7A' } });
        map.on('mouseenter', 'search-pin-layer', () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', 'search-pin-layer', () => { map.getCanvas().style.cursor = ''; });

        // 地図状態の保存（PWA再起動時の復元用）
        function saveMapState() {
            const c = map.getCenter();
            storeSetJson('mapState', {
                lng:     c.lng,
                lat:     c.lat,
                zoom:    map.getZoom(),
                bearing: map.getBearing(),
                pitch:   map.getPitch()
            });
        }
        map.on('moveend', saveMapState);
        map.on('zoomend', saveMapState);

        // 移動履歴：記録開始と初期エントリ
        map.on('moveend', onHistMoveEnd);
        map.on('movestart', closeHistList);
        histPush({ label: '開始地点', cause: 'init' });

        // 現在地ボタンのクリック処理
        document.getElementById('geolocate-btn').addEventListener('click', () => {
            removeSearchPin();
            if (currentLocation) {
                setSearchOriginText('取得中...', false);
                fetchPlaceName(currentLocation.lat, currentLocation.lng).then(name => {
                    if (!searchPinLngLat) setSearchOriginText(name || '現在地', false);
                });
            }
            // 追従解除後（preTrackingMode保持中）にボタンを押した場合 → モード復帰して現在地へ
            if (trackingMode === 0 && preTrackingMode > 0) {
                const mode = preTrackingMode;
                preTrackingMode = 0;
                trackingMode = mode;
                if (mode === 2) requestDeviceOrientation();
                if (currentLocation) {
                    histSetPending('現在地', 'geo', null,
                                   { coords: [currentLocation.lng, currentLocation.lat], zoom: map.getZoom() });
                    map.easeTo({
                        center: [currentLocation.lng, currentLocation.lat],
                        zoom: map.getZoom(),
                        bearing: mode === 2 ? deviceHeading : 0,
                        pitch:   mode === 2 ? 70 : 0,
                        duration: 700,
                        essential: true
                    });
                    map.once('moveend', startRafLoop);
                    map.once('moveend', refreshWeatherIfPanelOpen);
                }
                updateGeolocateButton();
                return;
            }

            trackingMode = (trackingMode + 1) % 3;
            if (trackingMode === 2) {
                requestDeviceOrientation();
            }

            if (trackingMode > 0 && currentLocation) {
                histSetPending('現在地', 'geo', null,
                               { coords: [currentLocation.lng, currentLocation.lat], zoom: map.getZoom() });
                map.easeTo({
                    center: [currentLocation.lng, currentLocation.lat],
                    zoom: map.getZoom(),
                    bearing: trackingMode === 2 ? deviceHeading : 0,
                    pitch: trackingMode === 2 ? 70 : 0,
                    duration: 700,
                    essential: true
                });
                map.once('moveend', startRafLoop);
                // 現在地へ移動完了後、基準点(=ピン解除で地図中心)の天気へ更新
                map.once('moveend', refreshWeatherIfPanelOpen);
            } else if (trackingMode === 0) {
                stopRafLoop();
                map.easeTo({ bearing: 0, pitch: 0, duration: 500, essential: true });
                // ピン解除済みなので現在の地図中心の天気へ更新
                refreshWeatherIfPanelOpen();
            } else {
                // 位置未取得などで地図移動が起きない場合も、ピン解除を天気へ反映
                refreshWeatherIfPanelOpen();
            }
            updateGeolocateButton();
        });

        // ズームボタンのクリック処理
        // ズームボタン長押し連続ズーム
        function setupLongPressZoom(btnId, delta) {
            const btn = document.getElementById(btnId);
            let intervalId = null;
            let timeoutId = null;
            const doZoom = () => map.easeTo({ zoom: map.getZoom() + delta, duration: 120, essential: true });
            const start = () => {
                doZoom();
                timeoutId = setTimeout(() => {
                    intervalId = setInterval(doZoom, 120);
                }, 200);
            };
            const stop = () => {
                clearTimeout(timeoutId);
                clearInterval(intervalId);
                intervalId = null;
                timeoutId = null;
            };
            btn.addEventListener('pointerdown', (e) => { e.preventDefault(); start(); });
            btn.addEventListener('pointerup', stop);
            btn.addEventListener('pointerleave', stop);
            btn.addEventListener('pointercancel', stop);
        }
        setupLongPressZoom('zoom-in-btn', 0.5);
        setupLongPressZoom('zoom-out-btn', -0.5);
        document.getElementById('north-reset-btn').addEventListener('click', () => {
            map.easeTo({ bearing: 0, pitch: 0, duration: 300, essential: true });
        });


        // watchPositionで常時位置監視（地図ロード後に開始）
        if (navigator.geolocation) {
            navigator.geolocation.watchPosition((pos) => {
                const lng = pos.coords.longitude;
                const lat = pos.coords.latitude;
                const accuracy = pos.coords.accuracy; // 水平誤差半径（メートル）

                // GPS信頼性フィルタ：精度が低い場合は位置更新を無視
                // ただし currentLocation がまだない初回は精度に関わらず受け入れる
                const GPS_ACCURACY_THRESHOLD = 50; // 50m以上の誤差は無視
                if (currentLocation && accuracy > GPS_ACCURACY_THRESHOLD) return;

                const isFirst = !currentLocation;
                currentLocation = { lat, lng };

                if (!currentMarker) {
                    const el = document.createElement('div');
                    el.className = 'current-location-dot';
                    currentMarker = new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map);
                }

                // 追従モードONかつ初回位置取得時→アニメーションで現在地へ移動
                if (isFirst && trackingMode > 0) {
                    histSetPending('現在地', 'geo', null,
                                   { coords: [lng, lat], zoom: Math.max(map.getZoom(), 15) });
                    map.easeTo({
                        center: [lng, lat],
                        zoom: Math.max(map.getZoom(), 15),
                        bearing: trackingMode === 2 ? (deviceHeading || 0) : 0,
                        pitch: trackingMode === 2 ? 70 : 0,
                        duration: 800,
                        essential: true
                    });
                    map.once('moveend', startRafLoop);
                }
                // マーカー位置の更新はrAFループの補間済み座標で行うため
                // ここではsetLngLatしない
            }, (err) => {
                console.warn('[GPS] エラー:', err.code, err.message);
                alert('現在地が取得できませんでした。');
            }, { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 });
        } else {
            alert('お使いのブラウザは現在地取得に対応していません。');
        }

        /* maplibre-gl 6系の loadImage はコールバックを取らず Promise を返す。
           画像は解決値そのものではなく .data に入る（GetResourceResponse<T> = { data: T, ... }）。
           読めなかった画像は握りつぶして先へ進めるのは従来どおり。 */
        const loadSDF = (url, id) => map.loadImage(url)
            .then(res => { if (res && res.data) map.addImage(id, res.data, { sdf: true }); })
            .catch(() => {});
        // マンホールカードの素材だけは実寸の2倍で描いてあるので pixelRatio 2 で読む
        const loadSDF2x = (url, id) => map.loadImage(url)
            .then(res => { if (res && res.data) map.addImage(id, res.data, { sdf: true, pixelRatio: 2 }); })
            .catch(() => {});
        /* 影の素材だけは SDF ではない。ぼかしを画像に焼いてあり、色も黒で固定なので
           icon-color は効かず、濃さは icon-opacity で決める。これも実寸の2倍で描いてある。 */
        const loadPlain2x = (url, id) => map.loadImage(url)
            .then(res => { if (res && res.data) map.addImage(id, res.data, { pixelRatio: 2 }); })
            .catch(() => {});

        Promise.all([
            loadSDF('tabe.png',    'tabe-icon'),
            loadSDF('castle.png',  'castle-icon'),
            loadSDF('michi.png',   'michi-icon'),
            loadSDF('michi-plate.png', 'michi-plate-icon'),
            loadSDF('manhole.png', 'manhole-icon'),
            /* マンホールカードも他と同じSDF。白フチをやめたので外形（mhcard.png のアルファ）を
               そのまま銅色で塗る1枚だけになり、面を重ねる mhcard-face.png は使わない
               （原画は残してある）。画像が56x72/56x56なので pixelRatio 2 は従来どおり
               （表示は28x36 / 28x28）。HTML側の一覧は img として mhcard.png をそのまま使う。 */
            loadSDF2x('mhcard.png',              'mhcard-icon'),
            loadSDF2x('mhcard-cluster.png',      'mhcard-cluster-icon'),
            /* 角丸四角・カードの影。丸ピンは circle-blur でぼかせるが、道の駅とカードは
               symbol（画像）なのでぼかせない。ぼかし済みの黒い形を別画像で持ち、下に敷く。 */
            loadPlain2x('michi-plate-shadow.png',    'michi-plate-shadow-icon'),
            loadPlain2x('michi-cluster-shadow.png',  'michi-cluster-shadow-icon'),
            loadPlain2x('mhcard-shadow.png',         'mhcard-shadow-icon'),
            loadPlain2x('mhcard-cluster-shadow.png', 'mhcard-cluster-shadow-icon')
        ]).then(() => {
            // オブジェクト種別アイコンの円直径/表示サイズ。CSS変数 --obj-icon-circle / --obj-icon-inner と同じ値（画像ネイティブ幅64pxに対する比率をicon-sizeに使用）
            const OBJ_ICON_CIRCLE_PX = 28;
            const OBJ_ICON_INNER_PX = 25;
            const OBJ_ICON_NATIVE_PX = 64;
            // 道の駅の板。正方形は同じ寸法だと丸より大きく見えるので、本体を丸の28pxより小さくする。
            // CSS変数 --obj-icon-square と同じ値。フチが無いのでこれがそのまま外径。
            const MICHI_PLATE_PX = 26;
            // 道の駅のクラスタ。丸のクラスタ（φ40）に対し、ピンと同じ比率（26/28）で縮めた値
            const MICHI_CLUSTER_PX = 37;
            // カードの面の色。mhcard.png / mhcard-cluster.png の銅色部分の実測値と同じ
            const MHCARD_FACE_COLOR = '#B87333';
            // マンホールカードに重ねるバッジ。CSS変数 --mhcard-badge と同じ値（カード幅28pxの80%）
            const MHCARD_W_PX = 28;
            const MHCARD_BADGE_PX = MHCARD_W_PX * 0.8;
            /* ピンの影。白フチをやめた代わりに、ぼかした黒をピンの下に敷いて地図から浮かせる。
               丸・角丸四角・カードで濃さと広がりを揃えるため、落ち方を1つに決めてある。
                 形の SHADOW_PEAK_IN_PX 内側 … 最大の濃さ
                 形の SHADOW_ZERO_OUT_PX 外側 … 0（間は smoothstep）
               丸は circle-blur で作る。circle シェーダは
                 smoothstep(0.0, -blur, r/半径 - 1)
               なので「半径*(1-blur) で最大、半径で0」。ここから半径と blur を逆算する。
               道の駅とカードは symbol でぼかせないため、同じ落ち方を焼いた影PNGを敷く。
               影PNGを作り直すときも同じ条件（内2px→外6px）で焼くこと。ずれると
               四角だけ影が強い/弱い状態に戻る。 */
            const PIN_SHADOW_OPACITY  = 0.13;   // circle-opacity / icon-opacity は仕様上 0〜1
            const PIN_SHADOW_OFFSET   = [0, 2];   // 下へ2px
            const SHADOW_PEAK_IN_PX   = 2;
            const SHADOW_ZERO_OUT_PX  = 6;
            const shadowCircleOf = (shapeR) => {
                const r = shapeR + SHADOW_ZERO_OUT_PX;
                return { r, blur: (SHADOW_PEAK_IN_PX + SHADOW_ZERO_OUT_PX) / r };
            };
            const PIN_SHAPE_R     = OBJ_ICON_CIRCLE_PX / 2;   // 丸ピン φ28 → 半径14
            const CLUSTER_SHAPE_R = 20;                       // 丸クラスタの半径
            // データは後から非同期に届くため、ソースは空で生成し setData で埋める
            const configs = [
                { id: 'michi',           color: '#0B499D', icon: 'michi-icon',    type: 'michi',   clusterColor: '#0B499D' },
                { id: 'shops',           color: '#FFAA00', icon: 'tabe-icon',     type: 'shop',    clusterColor: '#FFAA00' },
                { id: 'manholes',        color: '#B87333', icon: 'manhole-icon',  type: 'manhole', clusterColor: '#B87333' },
                /* mhcard はピンもクラスタもカードの絵（-icon / -cluster）で描くので、
                   丸を塗る color / clusterColor は使わない。持たせると「変えても反映されない」
                   設定になるため置かない。検索結果や履歴のアイコン色は typeConfig 側で持つ。 */
                { id: 'mhcards',                           icon: 'mhcard-icon',   type: 'mhcard' },
                { id: 'castles',         color: '#8A8A8A', icon: 'castle-icon',   type: 'castle',  clusterColor: '#8A8A8A' },
                { id: 'castles-famous',  color: '#8A8A8A', icon: 'castle-icon',   type: 'castle',  clusterColor: '#8A8A8A', noCluster: true },
            ];

            // 地図の空きタップで情報シートを閉じる判定に使う、オブジェクトのクリック対象レイヤー一覧
            objClickLayers.length = 0;

            /* filterState から初期visibility を決定（保存済み設定を反映）。
               manholes は蓋とポケふたが同居するソースなので、どちらかが表示中なら
               レイヤーは出す（中身の出し入れは manholeFeaturesForMap 側）。 */
            const initVisOf = (conf) => {
                const filterKey = conf.type === 'castle' ? 'castle'
                    : conf.type === 'manhole' ? 'manhole'
                    : conf.type === 'mhcard'  ? 'mhcard'
                    : conf.type === 'michi'   ? 'michi'
                    : conf.type === 'shop'    ? 'shop'
                    : null;
                return (filterKey === null || objLayerVisible(filterKey)) ? 'visible' : 'none';
            };

            /* ソースと影だけを先に一周して作る。影は必ず全種別のピンより下に居なければならず、
               種別ごとに「影→ピン」の順で足すと、後の種別の影が前の種別のピンに乗って黒く曇る。
               影は衝突判定に載せない（ラベルを押し出さないため）。 */
            configs.forEach(conf => {
                const initVis = initVisOf(conf);
                /* ずらす向きは画面基準（-translate-anchor: viewport）。既定の map のままだと
                   コンパスで地図を回したときに影だけ一緒に回り、光源が動いて見える。 */
                const shadowPaintSymbol = {
                    'icon-opacity': PIN_SHADOW_OPACITY,
                    'icon-translate': PIN_SHADOW_OFFSET, 'icon-translate-anchor': 'viewport',
                };
                const shadowPaintCircle = (shapeR) => {
                    const s = shadowCircleOf(shapeR);
                    return {
                        'circle-radius': s.r, 'circle-color': '#000000', 'circle-blur': s.blur,
                        'circle-opacity': PIN_SHADOW_OPACITY,
                        'circle-translate': PIN_SHADOW_OFFSET, 'circle-translate-anchor': 'viewport',
                    };
                };
                const shadowLayout = (image, size) => ({
                    'icon-image': image, 'icon-size': size,
                    'icon-allow-overlap': true, 'icon-ignore-placement': true, 'visibility': initVis,
                });

                map.addSource(conf.id, conf.noCluster
                    ? { type: 'geojson', data: EMPTY_FC }
                    : { type: 'geojson', data: EMPTY_FC, cluster: true, clusterMaxZoom: 13, clusterRadius: 50 }
                );

                // クラスタの影
                if (conf.type === 'mhcard') {
                    map.addLayer({ id: `${conf.id}-cluster-shadow`, type: 'symbol', source: conf.id, filter: ['has', 'point_count'], layout: shadowLayout('mhcard-cluster-shadow-icon', 1.0), paint: shadowPaintSymbol });
                } else if (conf.type === 'michi') {
                    map.addLayer({ id: `${conf.id}-cluster-shadow`, type: 'symbol', source: conf.id, filter: ['has', 'point_count'], layout: shadowLayout('michi-cluster-shadow-icon', 1.0), paint: shadowPaintSymbol });
                } else {
                    map.addLayer({ id: `${conf.id}-cluster-shadow`, type: 'circle', source: conf.id, filter: ['has', 'point_count'], paint: shadowPaintCircle(CLUSTER_SHAPE_R), layout: { 'visibility': initVis } });
                }
                // ピンの影
                if (conf.type === 'mhcard') {
                    map.addLayer({ id: `${conf.id}-shadow`, type: 'symbol', source: conf.id, filter: ['!', ['has', 'point_count']], layout: shadowLayout('mhcard-shadow-icon', 1.0), paint: shadowPaintSymbol });
                } else if (conf.type === 'michi') {
                    map.addLayer({ id: `${conf.id}-shadow`, type: 'symbol', source: conf.id, filter: ['!', ['has', 'point_count']], layout: shadowLayout('michi-plate-shadow-icon', 1.0), paint: shadowPaintSymbol });
                } else {
                    map.addLayer({ id: `${conf.id}-shadow`, type: 'circle', source: conf.id, filter: ['!', ['has', 'point_count']], paint: shadowPaintCircle(PIN_SHAPE_R), layout: { 'visibility': initVis } });
                }
            });

            configs.forEach(conf => {
                const initVis = initVisOf(conf);
                if (conf.type === 'mhcard') {
                    /* カードのクラスタはカードの外形1枚を銅色で塗るだけ。白フチをやめたので、
                       面を重ねる -cluster-face は無い。
                       上に乗る件数テキストが衝突判定で消えないよう、板は判定から外す */
                    map.addLayer({ id: `${conf.id}-cluster`, type: 'symbol', source: conf.id, filter: ['has', 'point_count'], layout: { 'icon-image': 'mhcard-cluster-icon', 'icon-size': 1.5, 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'visibility': initVis }, paint: { 'icon-color': MHCARD_FACE_COLOR } });
                } else if (conf.type === 'michi') {
                    /* 道の駅のクラスタもピンと同じ角丸四角。ピンと同様に、正方形は丸と同じ寸法だと
                       大きく見えるので、丸のクラスタ（φ40）より小さい37pxにする。
                       上に重なる件数テキストが押し出されないよう衝突判定からは外す。 */
                    map.addLayer({ id: `${conf.id}-cluster`, type: 'symbol', source: conf.id, filter: ['has', 'point_count'], layout: { 'icon-image': 'michi-plate-icon', 'icon-size': MICHI_CLUSTER_PX / OBJ_ICON_NATIVE_PX, 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'visibility': initVis }, paint: { 'icon-color': conf.clusterColor } });
                } else {
                    map.addLayer({ id: `${conf.id}-cluster`, type: 'circle', source: conf.id, filter: ['has', 'point_count'], paint: { 'circle-color': conf.clusterColor, 'circle-radius': 20 }, layout: { 'visibility': initVis } });
                }
                map.addLayer({ id: `${conf.id}-cluster-count`, type: 'symbol', source: conf.id, filter: ['has', 'point_count'], layout: { 'text-field': '{point_count_abbreviated}', 'text-size': 12, 'text-font': ['Noto Sans Bold'], 'visibility': initVis }, paint: { 'text-color': '#FFFFFF' } });
                if (conf.type === 'michi') {
                    /* 道の駅だけは丸ではなく道の駅紋章そのままの角丸四角。板(michi-plate-icon)も
                       図柄(michi-icon)もSDFで、色は icon-color から与える点は他の種別と同じ。
                       白フチはやめたので板は1枚だけ。地図からの分離は下に敷いた影が受け持つ。 */
                    /* 板は icon-ignore-placement で衝突判定から外す。他の種別では板にあたる
                       部分が circle レイヤー（衝突判定を持たない）なので、外さないと道の駅だけ
                       ラベルが板に押されて消える。判定に載るのは従来どおり -icon の1枚だけ。 */
                    map.addLayer({ id: `${conf.id}-bg`, type: 'symbol', source: conf.id, filter: ['!', ['has', 'point_count']], layout: { 'icon-image': 'michi-plate-icon', 'icon-size': MICHI_PLATE_PX / OBJ_ICON_NATIVE_PX, 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'visibility': initVis }, paint: { 'icon-color': conf.color } });
                } else if (conf.type !== 'mhcard') {
                    map.addLayer({ id: `${conf.id}-bg`, type: 'circle', source: conf.id, filter: ['!', ['has', 'point_count']], paint: { 'circle-color': conf.type === 'castle' ? ['match', ['get', 'genre'], '日本100名城', CASTLE_MEIJO_COLOR, '続日本100名城', CASTLE_ZOKU_MEIJO_COLOR, OBJ_TYPE_COLOR.castle] : conf.type === 'manhole' ? ['match', ['get', 'source'], 'pokefuta', '#FBBC04', '#B87333'] : conf.color, 'circle-radius': OBJ_ICON_CIRCLE_PX / 2 }, layout: { ...(conf.type === 'castle' ? { 'circle-sort-key': ['match', ['get', 'genre'], '日本100名城', 3, '続日本100名城', 2, 1] } : {}), 'visibility': initVis } });
                }
                /* 図柄。mhcard だけは「図柄」ではなくカードの外形そのもので、白フチをやめたため
                   銅色で塗る（他の種別の -bg にあたる役目）。タップ判定もこのレイヤーが持つ。 */
                map.addLayer({ id: `${conf.id}-icon`, type: 'symbol', source: conf.id, filter: ['!', ['has', 'point_count']], layout: { 'icon-image': conf.icon, 'icon-size': conf.type === 'mhcard' ? 1.0 : conf.type === 'manhole' ? OBJ_ICON_INNER_PX / OBJ_ICON_NATIVE_PX : conf.type === 'michi' ? MICHI_PLATE_PX / OBJ_ICON_NATIVE_PX : OBJ_ICON_CIRCLE_PX / OBJ_ICON_NATIVE_PX, 'icon-allow-overlap': true, ...(conf.type === 'castle' ? { 'symbol-sort-key': ['match', ['get', 'genre'], '日本100名城', 3, '続日本100名城', 2, 1] } : {}), 'visibility': initVis }, paint: { 'icon-color': conf.type === 'mhcard' ? MHCARD_FACE_COLOR : '#FFFFFF' } });
                if (conf.type === 'mhcard') {
                    // 銅色のカードの上にマンホールのバッジを重ねる
                    map.addLayer({ id: `${conf.id}-icon-overlay`, type: 'symbol', source: conf.id, filter: ['!', ['has', 'point_count']], layout: { 'icon-image': 'manhole-icon', 'icon-size': MHCARD_BADGE_PX / OBJ_ICON_NATIVE_PX, 'icon-allow-overlap': true, 'visibility': initVis }, paint: { 'icon-color': '#FFFFFF' } });
                }

                // テキストラベルレイヤー（マンホール・mhcard以外）
                if (conf.type !== 'manhole' && conf.type !== 'mhcard') {
                    // 食べログだけは name が複合のため、店名だけを切り出す式を使う
                    const labelField = conf.type === 'shop' ? SHOP_LABEL_FIELD
                        : ['get', conf.type === 'pokefuta' ? 'pokemon' : 'name'];
                    // pokefutaはlabelStateの対象外のため非表示固定、それ以外はlabelStateから取得
                    const labelVis = conf.type === 'pokefuta' ? 'none'
                        : (labelState[conf.type] !== false ? 'visible' : 'none');
                    map.addLayer({
                        id: `${conf.id}-label`,
                        type: 'symbol',
                        source: conf.id,
                        filter: ['!', ['has', 'point_count']],
                        layout: {
                            'text-field': labelField,
                            'text-size': 10,
                            'text-font': ['Noto Sans Regular'],
                            'text-anchor': 'top',
                            'text-offset': [0, 1.2],
                            'text-allow-overlap': false,
                            'text-max-width': 6,
                            'visibility': labelVis,
                        },
                        paint: {
                            'text-color': '#222222',
                            'text-halo-color': '#FFFFFF',
                            'text-halo-width': 1.5,
                        }
                    });
                }

                map.on('click', `${conf.id}-cluster`, (e) => {
                    const features = map.queryRenderedFeatures(e.point, { layers: [`${conf.id}-cluster`] });
                    if (!features.length) return;
                    // 6系の getClusterExpansionZoom も Promise を返す（コールバックは受け取らない）
                    map.getSource(conf.id).getClusterExpansionZoom(features[0].properties.cluster_id)
                        .then(zoom => map.easeTo({ center: features[0].geometry.coordinates, zoom: zoom + 1, duration: 450, essential: true }))
                        .catch(() => {});
                });

                const clickLayer = conf.type === 'mhcard' ? `${conf.id}-icon` : `${conf.id}-bg`;
                // クラスタは対象外。クラスタをタップしたときはズームインしつつシートを閉じる
                objClickLayers.push(clickLayer);
                map.on('click', clickLayer, (e) => {
                    // お気に入りを重ね描きしている位置は、前面のハンドラに任せる（二重に開かない）
                    if (favOverlayHit(e.point)) return;
                    if (trackingMode > 0) {
                        trackingMode = 0;
                        stopRafLoop();
                        updateGeolocateButton();
                    }
                    if (!e.features || !e.features.length) return;
                    const p = e.features[0].properties;
                    // タイルに載せ直された座標が返るので、元のデータの座標へ寄せる
                    const c = favSnapCoords(conf.type, p, e.features[0].geometry.coordinates.slice());
                    while (Math.abs(e.lngLat.lng - c[0]) > 180) { c[0] += e.lngLat.lng > c[0] ? 360 : -360; }
                    openObjSheet(conf.type, p.name || '', p, c[0], c[1]);
                    const histType = (conf.type === 'manhole' && p.source === 'pokefuta') ? 'pokefuta' : conf.type;
                    const histLabel = conf.type === 'shop' ? shopDisplayName(p) : (p.name || p.pokemon || '地点');
                    histRecordPin(histLabel || '地点', c, histType, p);
                });

                const hover = (l, cur) => { map.on('mouseenter', l, () => map.getCanvas().style.cursor = cur); map.on('mouseleave', l, () => map.getCanvas().style.cursor = ''); };
                hover(clickLayer, 'pointer');
                hover(`${conf.id}-cluster`, 'pointer');
            });

            /* お気に入りの重ね描き。全種別のピンより上に置くので、configs を回し終えた
               ここで足す。寸法と影の値は上のピンと同じものを渡し、二重に持たない。 */
            addFavOverlayLayers({
                circleR: PIN_SHAPE_R,
                shadowCircle: shadowCircleOf(PIN_SHAPE_R),
                shadowOpacity: PIN_SHADOW_OPACITY,
                shadowOffset: PIN_SHADOW_OFFSET,
                michiSize: MICHI_PLATE_PX / OBJ_ICON_NATIVE_PX,
                cardBadgeSize: MHCARD_BADGE_PX / OBJ_ICON_NATIVE_PX,
                cardFaceColor: MHCARD_FACE_COLOR,
            });

            // オブジェクト以外（地図の空き）をタップしたら情報シートを閉じる。
            // レイヤー個別のclickハンドラとこのハンドラは両方発火するため、
            // queryRenderedFeaturesでオブジェクトを踏んでいないことを確認してから閉じる。
            map.on('click', (e) => {
                if (!isObjSheetOpen()) return;
                const layers = objClickLayers.filter(id => map.getLayer(id));
                if (layers.length && map.queryRenderedFeatures(e.point, { layers }).length) return;
                closeObjSheet();
            });

            // 空ソース・レイヤー生成が済んだので、大容量データの非同期読込を開始
            // （表示中レイヤー優先 → 背景で残りを取得し、到着ごとに setData ＋検索再構築）
            startDataLoading();
        });
    });

    // Yahoo「ここへ行く」＝現在地から目的地までの経路を開く。
    // シートのHTMLは openObjSheet が開いた瞬間に一度だけ組み立てるため、出発地をURLに
    // 焼き込むと「測位前に開いた」「開いたまま移動した」場合に古い位置のまま残る。
    // そのため押された時点で currentLocation を読む。
    document.getElementById('obj-sheet-body').addEventListener('click', (e) => {
        const btn = e.target.closest('.btn-nav-yahoo');
        if (!btn) return;
        const toLat = btn.dataset.lat;
        const toLng = btn.dataset.lng;
        const toName = btn.dataset.name || '';
        if (currentLocation) {
            window.open(yahooRouteUrl(currentLocation.lat, currentLocation.lng, toLat, toLng, toName), '_blank');
            return;
        }
        // 未測位（許可ダイアログ未応答・初回測位待ち・測位失敗）の場合はここで改めて要求する。
        // 未許可ならこの getCurrentPosition で許可ダイアログが出る。
        // 取得完了はユーザー操作の外になり window.open が抑止され得るので、先にタブを確保しておく
        const tab = window.open('about:blank', '_blank');
        if (!tab) return;
        const openWithoutOrigin = () => {
            tab.location.href = yahooRouteUrl(null, null, toLat, toLng, toName);   // 目的地だけ渡す（出発地はYahoo側で指定できる）
            showToast('現在地が取得できませんでした。出発地はYahoo!地図で指定してください');
        };
        if (!navigator.geolocation) return openWithoutOrigin();
        navigator.geolocation.getCurrentPosition(
            (pos) => { tab.location.href = yahooRouteUrl(pos.coords.latitude, pos.coords.longitude, toLat, toLng, toName); },
            openWithoutOrigin,
            { enableHighAccuracy: true, timeout: 10000 }
        );
    });

    // 情報シートの省略行トグル（タップで省略 ↔ 全文）。高さが変わるので地図も寄せ直す。
    document.getElementById('obj-sheet-body').addEventListener('click', e => {
        const el = e.target.closest('.os-clamp.clampable');
        if (!el) return;
        el.classList.toggle('expanded');
        adjustMapForSheet();
    });

    /* 情報シートのタイトルを長押しでコピーする（GoogleMapで地名を長押しするのと同じ操作）。
       コピーするのは data-copy に入れた素の名前だけで、左のバッジ（城の形態・ジャンル・
       カード番号）も、右の評点も、[近接あり]・[配布] のような表示上の注記も入れない。
       書き込みを「指を離した時」にしているのは、クリップボードへの書き込みがユーザー操作の
       中からでないと拒まれるためで、離した瞬間なら確実にその中に入る。長押し判定の
       setTimeout の中でも通るかは未確認（通らないブラウザがあり得る側に倒してある）。
       500ms 経った時点では色を変えて合図するだけにして、離した瞬間にコピーする。 */
    (() => {
        const body = document.getElementById('obj-sheet-body');
        let timer = null, ready = null, touched = false;
        const disarm = () => {
            if (timer) { clearTimeout(timer); timer = null; }
            if (ready) { ready.classList.remove('os-name-copying'); ready = null; }
        };
        const arm = (el) => {
            disarm();
            timer = setTimeout(() => {
                timer = null;
                ready = el;
                el.classList.add('os-name-copying');
            }, 500);
        };
        const fire = async () => {
            const el = ready;
            disarm();
            if (!el) return;
            const text = el.dataset.copy || el.textContent.trim();
            const ok = await copyToClipboard(text);
            showToast(ok ? `「${text}」をコピーしました` : 'コピーできませんでした');
        };
        body.addEventListener('touchstart', e => {
            const el = e.target.closest('.os-name');
            if (el) arm(el);
        }, { passive: true });
        body.addEventListener('touchmove', disarm, { passive: true });   // スクロールに転じたら取り消す
        body.addEventListener('touchcancel', disarm);
        body.addEventListener('touchend', () => {
            touched = true;                                   // 直後に合成される mouse で二度動かさない
            setTimeout(() => { touched = false; }, 600);
            fire();
        });
        body.addEventListener('mousedown', e => {
            const el = e.target.closest('.os-name');
            if (el && e.button === 0 && !touched) arm(el);
        });
        body.addEventListener('mouseup', e => { if (e.button === 0 && !touched) fire(); });
        body.addEventListener('mouseleave', disarm);
        body.addEventListener('contextmenu', e => { if (e.target.closest('.os-name')) e.preventDefault(); });
    })();

    // 情報シートを下スワイプで閉じる（3ドロワー共通の実装）
    enableSheetSwipeClose(
        document.getElementById('obj-sheet'),
        document.getElementById('obj-sheet-header'),
        closeObjSheet
    );

    // 情報シートの写真タップで全画面ビューアを開く。
    // 城の写真は injectCastleImage で後から差し込まれるので、委譲で拾う。
    document.getElementById('obj-sheet-body').addEventListener('click', async (e) => {
        const img = e.target.closest('.os-photo img');
        if (!img) return;
        const ctx = objSheetCtx || {};
        // 城だけは取得元が複数ある。拡大したときに残りも取りに行き、左右スワイプで見比べられる。
        if (ctx.type === 'castle' && ctx.p) {
            const name = ctx.p.name || ctx.label || '';
            const cached = castleImgAllCache[name];
            if (cached) { openPhotoViewer(cached, img.src); return; }
            openPhotoViewer([{ url: img.src, label: '' }], img.src);   // まず表示中の1枚で開く
            const all = await fetchCastleImagesAll(name, ctx.p.url, ctx.p.shiroHbUrl);
            // 取得を待つ間に閉じられていたら差し替えない
            if (all.length && isPhotoViewerOpen()) openPhotoViewer(all, img.src);
            return;
        }
        openPhotoViewer([{ url: img.src, label: '' }], img.src);
    });

    // 情報帯の高さが変わったら写真側の余白も追従させる（出典切替での住所・出典名の行数変化、
    // 端末回転による折り返しの変化）。pvRender はドラッグ中に毎フレーム走るので、
    // そこで offsetHeight を読むと強制レイアウトが挟まる。監視側に任せる。
    if (window.ResizeObserver) {
        new ResizeObserver(pvSyncInfoHeight).observe(document.getElementById('pv-info'));
    }

    // ── 写真ビューアの操作（案G: 等倍=出典切替 / 拡大中=パン / 2本指=ピンチ） ──
    (function () {
        const viewer = document.getElementById('photo-viewer');
        // 情報帯（閉じるボタンを含む）の上で始まった操作はジェスチャとして扱わない
        const isUiTarget = (t) => t.closest('#pv-info');

        viewer.addEventListener('pointerdown', (e) => {
            if (isUiTarget(e.target)) return;
            pvPtr.set(e.pointerId, { x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t0: e.timeStamp });
            try { viewer.setPointerCapture(e.pointerId); } catch (_) {}
            if (pvPtr.size === 2) {
                const [a, b] = [...pvPtr.values()];
                pvPinchDist = Math.hypot(a.x - b.x, a.y - b.y);
                pvPinchStart = pvScale;
                pvAxis = 'pinch';
            } else if (pvPtr.size === 1) {
                pvAxis = null;   // 縦横どちらに倒れたかは最初の移動で決める
                pvPanFrom = { x: e.clientX - pvX, y: e.clientY - pvY };
            }
        });

        viewer.addEventListener('pointermove', (e) => {
            const p = pvPtr.get(e.pointerId);
            if (!p) return;
            p.x = e.clientX; p.y = e.clientY;
            if (pvPtr.size === 2) {
                const [a, b] = [...pvPtr.values()];
                const d = Math.hypot(a.x - b.x, a.y - b.y);
                pvScale = Math.min(PV_MAX_SCALE, Math.max(1, pvPinchStart * (d / (pvPinchDist || 1))));
                if (pvScale <= 1.001) { pvX = 0; pvY = 0; }
                pvRender();
                return;
            }
            const dx = e.clientX - p.x0, dy = e.clientY - p.y0;
            if (pvScale > 1.02) {
                pvX = e.clientX - pvPanFrom.x;
                pvY = e.clientY - pvPanFrom.y;
                pvRender();
            } else {
                if (!pvAxis && (Math.abs(dx) > PV_SLOP || Math.abs(dy) > PV_SLOP)) {
                    pvAxis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
                }
                if (pvAxis === 'x' && pvSources.length > 1) { pvDragDX = dx; pvRender(); }
                // 下スワイプは指に追従させ、どこまで引けば閉じるかを見せる（上方向は動かさない）
                if (pvAxis === 'y') { pvY = Math.max(0, dy); pvSetDismissProgress(pvY); pvRender(); }
            }
        });

        const endPointer = (e) => {
            const p = pvPtr.get(e.pointerId);
            if (!p) return;
            const dx = e.clientX - p.x0, dy = e.clientY - p.y0;
            pvPtr.delete(e.pointerId);
            if (pvPtr.size > 0) return;

            if (pvAxis === 'x') {
                if (dx < -PV_SWITCH_DIST && pvIdx < pvSources.length - 1) { pvIdx++; pvScale = 1; pvX = 0; pvY = 0; }
                else if (dx > PV_SWITCH_DIST && pvIdx > 0) { pvIdx--; pvScale = 1; pvX = 0; pvY = 0; }
                pvDragDX = 0; pvAxis = null; pvPanFrom = null;
                pvRender(true);
                return;
            }
            if (pvAxis === 'y') {
                pvAxis = null; pvPanFrom = null;
                const speed = dy / Math.max(1, e.timeStamp - p.t0);
                if (dy > PV_CLOSE_DIST || (dy > PV_SLOP && speed > PV_FLICK_SPEED)) return closePhotoViewer();
                pvY = 0;                       // 届かなければ元の位置へ戻す
                pvSetDismissProgress(0, true);
                pvRender(true);
                return;
            }
            if (pvAxis === 'pinch') { pvAxis = null; pvPanFrom = null; pvRender(); return; }
            // 動いていなければタップ扱い → UIの表示/非表示をトグル
            if (Math.abs(dx) < 6 && Math.abs(dy) < 6) pvUI = !pvUI;
            pvAxis = null; pvPanFrom = null;
            pvRender();
        };
        viewer.addEventListener('pointerup', endPointer);
        viewer.addEventListener('pointercancel', endPointer);

        // ダブルタップで2.5倍 ⇄ 等倍
        let lastTap = 0;
        viewer.addEventListener('click', (e) => {
            if (isUiTarget(e.target)) return;
            const now = Date.now();
            if (now - lastTap < 320) {
                if (pvScale > 1) { pvScale = 1; pvX = 0; pvY = 0; } else { pvScale = 2.5; }
                pvRender(true);
            }
            lastTap = now;
        });

        // PCでの確認用。実機はピンチを使う
        viewer.addEventListener('wheel', (e) => {
            e.preventDefault();
            pvScale = Math.min(PV_MAX_SCALE, Math.max(1, pvScale * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
            if (pvScale <= 1.001) { pvX = 0; pvY = 0; }
            pvRender();
        }, { passive: false });
    })();

    // PCでの確認用に Esc でも閉じられるようにする（実機は×ボタン）
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isPhotoViewerOpen()) closePhotoViewer();
    });

    // ══════════════════════════════════════════════════════════════
    //  検索機能
    // ══════════════════════════════════════════════════════════════
    // カタカナ→ひらがな変換。NFKCで全角/半角（英数字・半角カナ）を先に統一してから適用する
    function toHiragana(str) {
        return str.replace(/[ァ-ヶ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));
    }
    function normalizeForSearch(str) {
        if (!str) return '';
        return toHiragana(str.normalize('NFKC')).toLowerCase();
    }
    // 完全一致=100 / 前方一致=80 / 部分一致=50 / 不一致=0（text・qは正規化済み前提）
    function matchScore(text, q) {
        if (!text || !q) return 0;
        if (text === q) return 100;
        if (text.startsWith(q)) return 80;
        if (text.includes(q)) return 50;
        return 0;
    }

    /* 食べログの照合は name 全体（店名＋駅＋ジャンル）に掛かるので、店名に無い語でも当たる。
       名前は店名だけを出すようにしたため、当たった語が画面のどこにも出ない結果が生まれる
       （例: 「担々麺」で出る創作麺工房 鳴龍は、店名にもバッジ「ラーメン」にも担々麺が無い）。
       そこで店名で当たっていないときだけ、当たった側を住所の行に添える。
       別名で当たったときに「（別名: ◯◯）」を出しているのと同じ扱い。
       q は照合と同じ normalizeForSearch を通した文字列を渡すこと。 */
    function shopMatchedPart(p, q) {
        if (!q) return null;
        const sp = shopParts(p);
        if (normalizeForSearch(sp.shop).includes(q)) return null;
        if (sp.station && normalizeForSearch(sp.station).includes(q)) return `駅: ${sp.station}`;
        if (sp.genre && normalizeForSearch(sp.genre).includes(q)) return `ジャンル: ${sp.genre}`;
        return null;
    }
    // 住所の行に前置きする括弧書き。当たり方が分かるものが無ければ空文字
    function matchNoteHtml(alias, part) {
        if (alias) return `（別名: ${attrEscape(alias)}）`;
        return part ? `（${attrEscape(part)}）` : '';
    }

    let searchIndex = [];
    let favSnapIndex = null;      // 元の座標へ寄せるための索引（下の favSnapCoords が作る）
    function buildSearchIndex() {
        searchIndex = [];
        favSnapIndex = null;      // 元の座標へ寄せるための索引も作り直させる
        // loadedData に到着済みのデータのみ対象（未読込分は届き次第この関数が再実行される）
        const sources = [
            { type: 'pokefuta', data: loadedData.pokefuta, labelKey: 'pokemon', subKey: 'address' },
            { type: 'manhole',  data: loadedData.manhole,  labelKey: 'name',    subKey: 'address' },
            { type: 'mhcard',   data: loadedData.mhcard,   labelKey: 'name',    subKey: 'address' },
            { type: 'castle',   data: loadedData.castle,   labelKey: 'name',    subKey: 'address' },
            { type: 'michi',    data: loadedData.michi,    labelKey: 'name',    subKey: 'address' },
            { type: 'shop',     data: loadedData.shops,    labelKey: 'name',    subKey: 'address' }
        ];
        sources.forEach(s => {
            if (s.data && s.data.features) s.data.features.forEach(f => {
                const label = f.properties[s.labelKey] || '';
                const sub = s.sub || f.properties[s.subKey] || '';
                searchIndex.push({
                    type: s.type, label, sub, coords: f.geometry.coordinates, properties: f.properties,
                    _normLabel: normalizeForSearch(label), _normSub: normalizeForSearch(sub)
                });
            });
        });
    }

    /* 地図のピンをタップして返る座標を、元のデータの座標へ寄せる。

       MapLibre は GeoJSON ソースも内部でタイル（1タイル4096分割）に載せ直すため、
       クリックの `e.features[0].geometry.coordinates` は元の値と一致しない。
       実測（2026-08-20、maplibre-gl 3.6.2）では 139.76543,35.68123 の1点が
         z=14 … 139.765430 / z=11 … 139.765427 / z=8 … 139.765491
       で返り、z=8 では4桁に丸めた値が 139.7654 から 139.7655 へ動いた。

       お気に入りのキーは座標を4桁（約11m）に丸めて作るので、丸めが1つ動くと
       別のキーになる。すると印は付いたのに、地図のバッジにも一覧にも出ない
       （どちらも searchIndex の正しい座標から引くため）。シートだけは同じずれた
       座標から同じキーを作り直すので、そこにだけ付いて見える。
       再起動しても出てこないため、外れたようにしか見えない。

       そこで、タップした地物に対応する searchIndex の要素を名前で引き当て、
       いちばん近いものの座標に差し替える。名前が重なる城（「松本城」は5件ある）でも、
       離れた同名は距離で落ちる。引き当てられなければ触らない。 */
    function favSnapNameKey(type, p) {
        p = p || {};
        // ポケふたは地図では type='manhole'＋source='pokefuta' で来る（favKeyOf と同じ扱い）
        const t = (type === 'manhole' && p.source === 'pokefuta') ? 'pokefuta' : type;
        return `${t} ${p.name || p.pokemon || ''}`;
    }
    function favSnapCoords(type, p, c) {
        if (!Array.isArray(c) || !searchIndex.length) return c;
        if (!favSnapIndex) {
            favSnapIndex = new Map();
            for (const item of searchIndex) {
                const k = favSnapNameKey(item.type, item.properties);
                const a = favSnapIndex.get(k);
                if (a) a.push(item); else favSnapIndex.set(k, [item]);
            }
        }
        const list = favSnapIndex.get(favSnapNameKey(type, p));
        if (!list) return c;
        let best = null, bestD = Infinity;
        for (const it of list) {
            const ic = it.coords || [];
            const d = Math.abs(ic[0] - c[0]) + Math.abs(ic[1] - c[1]);
            if (d < bestD) { bestD = d; best = ic; }
        }
        // 0.005度（約500m）より遠いものは別物とみなす。タイルのずれはこれより十分小さい
        return (best && bestD < 0.005) ? [best[0], best[1]] : c;
    }

    const typeConfig = {
        pokefuta: { color: '#FBBC04', img: 'manhole.png', label: 'ポケふた' },
        manhole:  { color: '#B87333', img: 'manhole.png', label: 'マンホール' },
        mhcard:   { color: '#1565C0', img: 'manhole.png', label: 'マンホールカード配布' },
        castle:   { color: '#8A8A8A', img: 'castle.png',  label: 'お城' },
        michi:    { color: '#0B499D', img: 'michi.png',   label: '道の駅' },   /* 色は道の駅紋章の地色 */
        shop:     { color: '#FFAA00', img: 'tabe.png',    label: '食べログ' },   /* 色は食べログのアイコンの地色 */
        place:    { color: '#4285F4', icon: '📍',        label: '地名' },
    };
    /* 道の駅のアイコン背景だけは丸ではなく角丸四角にする（地図のピンと形を合わせる） */
    function objIconSquareClass(type) {
        return type === 'michi' ? ' obj-ic-sq' : '';
    }
    function getItemColor(item) {
        if (item.type === 'castle') {
            const genre = item.properties && item.properties.genre;
            if (genre === '日本100名城') return CASTLE_MEIJO_COLOR;
            if (genre === '続日本100名城') return CASTLE_ZOKU_MEIJO_COLOR;
        }
        return (typeConfig[item.type] || {}).color || '#1a1a1a';
    }

    /* いま地図に出ているものか。種別のOFF（設定のオブジェクト表示）と、食べログだけにある
       部門のOFF（同じ設定を長押しして選ぶ）の両方を見る。検索・周辺検索・着地ズームの
       近傍探索が同じものを対象にするよう、判定はここ1か所に置く。 */
    const OBJ_FILTER_KEY = {
        shop: 'shop', castle: 'castle', michi: 'michi',
        manhole: 'manhole', pokefuta: 'pokefuta', mhcard: 'mhcard'
    };
    function objShownOnMap(item) {
        const filterKey = OBJ_FILTER_KEY[item.type];
        if (filterKey && filterState[filterKey] === false) return false;
        return item.type !== 'shop' || genreVisible(shopGenreBase((item.properties || {}).category));
    }

    function searchLocal(query) {
        const q = normalizeForSearch(query);
        // 一致度（完全一致>前方一致>部分一致、alias一致は減点）を優先し、同スコア内は
        // 周辺検索・天気と同じ基準点からの距離が近い順に並べて上位100件を返す
        const center = getSearchCenter();
        const matched = [];
        for (const item of searchIndex) {
            if (!objShownOnMap(item)) continue;
            const labelScore = matchScore(item._normLabel, q);
            const subScore = matchScore(item._normSub, q);
            if (labelScore > 0 || subScore > 0) {
                // 店名で当たっていないときだけ、駅・ジャンルのどちらで当たったかを持たせる
                matched.push({ ...item, _matchedAlias: null,
                    _matchedPart: item.type === 'shop' ? shopMatchedPart(item.properties, q) : null,
                    _score: Math.max(labelScore, subScore * 0.5) });
                continue;
            }
            const aliases = item.properties && item.properties.aliases;
            if (Array.isArray(aliases)) {
                let bestScore = 0, bestAlias = null;
                for (const a of aliases) {
                    const s = matchScore(normalizeForSearch(a), q);
                    if (s > bestScore) { bestScore = s; bestAlias = a; }
                }
                if (bestAlias) matched.push({ ...item, _matchedAlias: bestAlias, _score: bestScore * 0.6 });
            }
        }
        return matched.map(item => ({
            ...item,
            _dist: (item.coords && item.coords.length >= 2)
                ? calcDist(center.lat, center.lng, item.coords[1], item.coords[0])
                : Infinity
        })).sort((a, b) => (b._score - a._score) || (a._dist - b._dist)).slice(0, 100);
    }
    
    let geocodeTimer = null, searchRequestId = 0;
    // muni.js辞書: addressCode → "都道府県市区町村"
    let muniDict = {};
    fetch('https://maps.gsi.go.jp/js/muni.js')
        .then(r => r.text())
        .then(js => {
            const re = /MUNI_ARRAY\["(\d+)"\]\s*=\s*'(\d+),([^,]+),\d+,([^']+)'/g;
            let m;
            while ((m = re.exec(js)) !== null) {
                const pref = m[3].trim().replace(/[\s　]/g, '');
                const city = m[4].trim().replace(/[\s　]/g, '');
                muniDict[m[1]] = `${pref}${city}`;
            }
        })
        .catch(() => {});

    async function searchGeocode(query) {
        try {
            const scoreResult = (title, q) => { if(title===q)return 100; if(title.startsWith(q))return 80; if(title.includes('駅')&&q.includes('駅'))return 60; if(title.startsWith(q.replace(/駅$/,'')))return 40; return 10; };
            const res = await fetch(`https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(query)}`);
            const data = await res.json();
            const center = getSearchCenter(); // 基準点（周辺検索・天気と同じ）
            return data.map(f => {
                const title = f.properties.title;
                const code  = f.properties.addressCode || '';

                let label, sub;
                if (code) {
                    // addressCodeがある場合: labelはtitle、subは都道府県＋市区町村
                    const prefCity = muniDict[code] || muniDict[String(parseInt(code, 10))] || '';
                    label = title;
                    sub   = prefCity;
                } else {
                    // addressCodeが空の場合: titleに都道府県が含まれている
                    label = title;
                    sub   = title;
                }

                // labelとsubが同じ場合はsubを空に
                if (label === sub) sub = '';

                const c = f.geometry.coordinates;
                const _dist = (c && c.length >= 2) ? calcDist(center.lat, center.lng, c[1], c[0]) : Infinity;
                return { type: 'place', label, sub, coords: c, properties: {}, _dist };
            }).sort((a, b) => a._dist - b._dist).slice(0, 24);
        } catch { return []; }
    }

    function renderResults(localItems, placeItems) {
        const inner = document.getElementById('search-results-inner');
        inner.innerHTML = '';
        if (localItems.length === 0 && placeItems.length === 0) {
            inner.innerHTML = '<div style="padding:14px;text-align:center;color:#999;font-size:13px;grid-column:1/-1;">候補が見つかりません</div>';
        } else {
            const makeItem = (item, col) => {
                const cfg = typeConfig[item.type];
                const isMhcard = item.type === 'mhcard';
                const div = document.createElement('div');
                div.className = 'search-result-item';
                const iconPart = isMhcard
                    ? `<div style="position:relative;width:var(--mhcard-w);height:var(--mhcard-h);flex-shrink:0;background:#e2ddd4;border-radius:6px;"><img src="mhcard.png" style="width:100%;height:100%;display:block;"><img src="manhole.png" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:var(--mhcard-badge);height:var(--mhcard-badge);filter:brightness(0) invert(1);pointer-events:none;"></div>`
                    : `<div class="search-result-icon${objIconSquareClass(item.type)}" style="background:${getItemColor(item)}">${cfg.img ? `<img src="${cfg.img}"${cfg.img === 'manhole.png' ? '' : ' class="icon-full"'}>` : cfg.icon}</div>`;
                const subText = `${matchNoteHtml(item._matchedAlias, item._matchedPart)}${item.sub}`;
                // 食べログの部門バッジ。結果は2列で幅が狭いため、店名の行ではなく
                // 住所の行の先頭に小さく置く（店名を押し出さないため）
                const badge = item.type === 'shop' ? shopGenreBadgeHtml(item.properties, 'sr-genre') : '';
                // お気に入りの色帯。周辺検索・都道府県・城主・遺構・お気に入り一覧と同じ出しかた
                // （左padding 10px の中に帯5px＋空き5pxで収まるので、印の有無で中身の位置は動かない）
                div.innerHTML = `${favStripeHtml(item.type, item.properties, item.coords)}${iconPart}<div class="search-result-text"><div class="search-result-name">${itemDisplayName(item)}</div><div class="search-result-sub">${badge}${subText}</div></div>`;
                // 飛んだ先から戻れるよう、この結果一覧そのもの（両列とワード）を持たせて渡す
                div.addEventListener('click', () => searchJumpToItem(item, localItems, placeItems));
                col.appendChild(div);
            };
            const leftCol = document.createElement('div'); leftCol.className = 'search-col';
            const rightCol = document.createElement('div'); rightCol.className = 'search-col';
            if(localItems.length>0) { leftCol.innerHTML='<div class="search-section-header">スポット</div>'; localItems.forEach(item => makeItem(item, leftCol)); }
            if(placeItems.length>0) { rightCol.innerHTML='<div class="search-section-header">地名・場所</div>'; placeItems.forEach(item => makeItem(item, rightCol)); }
            inner.append(leftCol, rightCol);
        }
        // 新しい結果は必ず先頭から見せる。innerHTML を空にしてから作り直しても
        // スクロール位置は保持される（Chromium実測: 500px スクロール後に再構築しても 500px のまま）ため、
        // 明示的に戻さないと「別のワードで検索したのに途中から表示される」状態になる。
        inner.scrollTop = 0;
        document.getElementById('search-results').style.display = 'block';
    }

    /* ══ 一覧・検索結果からオブジェクトへ飛ぶときの着地ズーム ══════════════
       飛び先ごとに「対象を判別できる中でいちばん引いた倍率」を出す。以前は
       Math.max(いまの倍率, 16) だったが、これは16以上のときは今の倍率を保つ式なので、
       上限（maplibre-gl 3.6.2 の既定 maxZoom=22）まで寄せた状態から飛ぶと z22 のまま
       着地し、周りに何も無い画面になっていた。今の倍率は見ずに、飛び先の混み具合だけで決める。

       物差しは「最近傍のオブジェクトとの間がアイコン径 LAND_SEP_PX 開くこと」で、
       これは16を決めたときと同じ基準。地図に出ていない種別・部門（objShownOnMap）は
       数えない。周辺検索や県一覧がOFFのものを候補から外すのと同じ扱いで、
       消している種別のせいで必要以上に寄らないようにする。

       下限14は clusterMaxZoom:13 の外側。これより引くとピンがクラスタに畳まれ、
       選択リングを出しても対象が見えない。
       上限16は「z17以上まで寄せると周囲の街並みが読み取れなくなる」ため据え置き。

       実データ35,323件（2026-08-20 実測）では、必要な倍率の中央値は12.46で、
       89.2%が16より引ける（クランプ後の中央値は下限のz14＝従来より2段引ける）。
       残り10.8%は16でも28px開かないが、そこは上限で止めて重なりを許す。
       走査は全件を素直に舐めて1回0.372ms（35,323件・Chrome 148で実測）。
       easeTo の550msに対して無視できるので、索引は持たない。 */
    const LAND_ZOOM_MIN = 14;
    const LAND_ZOOM_MAX = 16;
    const LAND_SEP_PX   = 28;          // オブジェクト種別アイコンの円直径（--obj-icon-circle と同じ）
    const M_PER_PX_Z0   = 156543.03392; // z0 の1px当たりのメートル（赤道。40075016.686/256）

    function landingZoom(lng, lat) {
        const DEG = Math.PI / 180, R = 6378137;
        const k = Math.cos(lat * DEG);
        let best = Infinity;
        for (const item of searchIndex) {
            const c = item.coords;
            if (!c || c.length < 2) continue;
            // 同じ座標のものは自分自身か、寄っても離れない重なりなので数えない
            if (c[0] === lng && c[1] === lat) continue;
            // 平面近似の距離の2乗。比較にしか使わないので平方根は最後に1回だけ取る。
            // 表示の判定（正規表現を通る）は最近傍を更新する候補にだけ掛けて、全件には掛けない
            const dx = (c[0] - lng) * DEG * k * R, dy = (c[1] - lat) * DEG * R;
            const d2 = dx * dx + dy * dy;
            if (d2 < best && objShownOnMap(item)) best = d2;
        }
        if (!isFinite(best)) return LAND_ZOOM_MIN;   // 周りに1件も無ければいちばん引く
        const z = Math.log2(LAND_SEP_PX * M_PER_PX_Z0 * k / Math.sqrt(best));
        return Math.min(LAND_ZOOM_MAX, Math.max(LAND_ZOOM_MIN, z));
    }

    function onResultClick(item) {
        if (trackingMode > 0) {
            trackingMode = 0;
            stopRafLoop();
            updateGeolocateButton();
        }
        clearSearch();
        // オブジェクトを選んだときは、対象を判別できる中でいちばん引いた倍率へ着地する（landingZoom）。
        // 地名(place)は市区町村・町名の指し示しで、寄せる相手になる1点が無いので対象外にする。
        const zoom = item.type !== 'place'
            ? landingZoom(item.coords[0], item.coords[1])
            : map.getZoom();
        histSetPending(itemDisplayName(item), 'search', null, { coords: item.coords, zoom });
        map.easeTo({ center: item.coords, zoom, bearing: 0, pitch: 0, duration: 550, essential: true });
        if (item.type !== 'place') {
            setTimeout(() => showSheetForItem(item), 300);
        }
    }

    function showSheetForItem(item) {
        const c = item.coords.slice();
        // openObjSheet 内の adjustMapForSheet が、シート高さぶん上に寄せ直す
        openObjSheet(item.type, item.label, item.properties, c[0], c[1]);
    }

    /* ══ 検索結果からオブジェクトへ飛ぶ ═════════════════════════════════
       周辺検索（nearbyJumpToItem）・都道府県（prefJumpToItem）と同じ扱いにして、
       離れる前に一覧の位置を控え、情報シートに戻り導線を挿す。

       違うのは戻したときの一覧の作りかた。他の一覧は開き直す関数に任せられるが、
       検索結果は onResultClick が入力欄を空にして（clearSearch）閉じてしまうため、
       同じ並びを取り戻すには検索をやり直すことになる。それだと
        ・地名・場所は国土地理院へ問い合わせ直しになる（戻るだけで通信が要る）
        ・スポットの並びは getSearchCenter() からの距離で決まるので、
          飛んだ先で測り直すと戻る前と別の並びになる
       ので、描いた結果そのもの（両列の配列とワード）を控えておいて描き直す。

       地名・場所（place）は情報シートが開かない（onResultClick）ので、
       戻り導線を挿す先が無く、この導線は付かない。 */
    let searchReturn = null;
    function searchJumpToItem(item, localItems, placeItems) {
        if (item.type !== 'place') {
            searchReturn = {
                q: document.getElementById('search-input').value,
                scrollTop: document.getElementById('search-results-inner').scrollTop,
                local: localItems, places: placeItems,
            };
            saveListReturnCamera();
        }
        onResultClick(item);
        // onResultClick は 300ms 後に情報シートを開くので、その後に戻り導線を挿す
        if (item.type !== 'place') setTimeout(injectSearchBackLink, 400);
    }

    // 検索結果から来たときだけ、情報シートの先頭に戻り導線を挿す（周辺検索結果と同じ扱い）。
    // 別のピンをタップするとシート本文ごと作り直されるので、自然に消える。
    function injectSearchBackLink() {
        if (!searchReturn) return;
        const body = document.getElementById('obj-sheet-body');
        if (!body || body.querySelector('.os-lords-back')) return;
        const div = document.createElement('div');
        div.className = 'os-lords-back';
        const q = searchReturn.q.trim();
        div.textContent = q ? `↩ 「${q}」の検索結果に戻る` : '↩ 検索結果に戻る';
        div.onclick = () => { closeObjSheet(); restoreListReturnCamera(); reopenSearchResults(); };
        body.insertBefore(div, body.firstChild);
    }

    /* 飛ぶ前の検索結果（ワード・並び・スクロール位置）のまま戻す。
       入力欄にワードを書き戻すのは、消えたままだと×ボタンが出ず、
       そこから絞り直す（打ち足す）こともできなくなるため。
       スクロール位置は renderResults が末尾で先頭に戻すので、その後に指定する。 */
    function reopenSearchResults() {
        const s = searchReturn;
        if (!s) return;
        document.getElementById('search-input').value = s.q;
        document.getElementById('search-clear').style.display = s.q.trim() ? 'block' : 'none';
        renderResults(s.local, s.places);
        document.getElementById('search-results-inner').scrollTop = s.scrollTop;
    }

    function clearSearch() {
        const input = document.getElementById('search-input');
        input.value = '';
        input.dispatchEvent(new Event('input'));
    }

    function tryParsePlusCode(q) {
        try {
            if (!q.includes('+')) return null;
            const OLC = '23456789CFGHJMPQRVWX0';
            const re = new RegExp('([' + OLC + ']{2,8})\\+([' + OLC + ']{2,})', 'i');
            const m = q.trim().match(re);
            if (!m) return null;
            const plc = (m[1] + '+' + m[2]).toUpperCase();
            const olc = new OpenLocationCode();
            // フルコード
            try {
                if (olc.isFull(plc)) {
                    const area = olc.decode(plc);
                    return { lat: area.latitudeCenter, lng: area.longitudeCenter };
                }
            } catch (e) {}
            // ショートコード（地図中心を参照位置として解決）
            try {
                if (olc.isShort(plc)) {
                    const center = map.getCenter();
                    const full = olc.recoverNearest(plc, center.lat, center.lng);
                    const area = olc.decode(full);
                    return { lat: area.latitudeCenter, lng: area.longitudeCenter };
                }
            } catch (e) {}
            return null;
        } catch (e) { return null; }
    }

    function tryParseCoords(q) {
        const s = q.trim().replace(/^\(|\)$/g, '').trim();
        const m = s.match(/^(-?\d+\.?\d*)\s*[,\s]+\s*(-?\d+\.?\d*)$/);
        if (!m) return null;
        const a = parseFloat(m[1]), b = parseFloat(m[2]);
        if (a >= -90 && a <= 90 && b >= -180 && b <= 180) return { lat: a, lng: b };
        return null;
    }

    function tryParseDMS(q) {
        try {
            // 例: 35°39'30.9"N 139°44'43.6"E または N35°39'30.9" E139°44'43.6"
            const re = /([NSns]?)\s*(\d+)[°]\s*(\d+)[′']\s*(\d+(?:\.\d+)?)[″"]?\s*([NSns]?)\s*[,\s]+\s*([EWew]?)\s*(\d+)[°]\s*(\d+)[′']\s*(\d+(?:\.\d+)?)[″"]?\s*([EWew]?)/;
            const m = q.match(re);
            if (!m) return null;
            const hem1 = (m[1] || m[5]).toUpperCase();
            const hem2 = (m[6] || m[10]).toUpperCase();
            if (!['N','S',''].includes(hem1) || !['E','W',''].includes(hem2)) return null;
            const lat = (parseFloat(m[2]) + parseFloat(m[3])/60 + parseFloat(m[4])/3600) * (hem1 === 'S' ? -1 : 1);
            const lng = (parseFloat(m[7]) + parseFloat(m[8])/60 + parseFloat(m[9])/3600) * (hem2 === 'W' ? -1 : 1);
            if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
            return { lat, lng };
        } catch (e) { return null; }
    }

    // IME変換確定前（未確定文字列）で毎打鍵検索が走らないようにするガード。
    // compositionend後にinputイベントが発火しない/isComposing判定のタイミングが前後する
    // ブラウザ・IME実装があるため、inputイベントのみに頼らずcompositionend自体からも
    // 同じ処理を実行し、変換確定後に検索が更新されないケースを防ぐ。
    let isComposing = false;
    function runSearchInput(inputEl) {
        const q = inputEl.value.trim();
        document.getElementById('search-clear').style.display = q ? 'block' : 'none';
        document.getElementById('search-results').style.display = q ? 'block' : 'none';
        // 新しい結果が出るまでの300ms（ジオコーディングのデバウンス）は前のワードの結果が
        // 残ったまま見えるので、ここでも先頭に戻す。親を display:none にしても
        // スクロール位置は保持される（Chromium実測）ため、非表示側でも戻しておく。
        document.getElementById('search-results-inner').scrollTop = 0;
        document.getElementById('search-spinner').style.display = 'none';
        if (!q) return;

        const coords = tryParseCoords(q) || tryParsePlusCode(q) || tryParseDMS(q);
        if (coords) {
            if (trackingMode > 0) { trackingMode = 0; stopRafLoop(); updateGeolocateButton(); }
            // 飛び先にオブジェクトは無いが、その座標の周りに何があるかが見える倍率にしたいので
            // 一覧・検索結果と同じ物差しを当てる（入力座標を起点に最近傍を引く）
            const zoom = landingZoom(coords.lng, coords.lat);
            histSetPending(`${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`, 'search', null,
                           { coords: [coords.lng, coords.lat], zoom });
            map.easeTo({ center: [coords.lng, coords.lat], zoom, duration: 500 });
            clearSearch();
            return;
        }

        const local = searchLocal(q);
        const reqId = ++searchRequestId;
        clearTimeout(geocodeTimer);
        document.getElementById('search-spinner').style.display = 'inline-block';
        geocodeTimer = setTimeout(async () => {
            const places = await searchGeocode(q);
            if (reqId === searchRequestId) {
                document.getElementById('search-spinner').style.display = 'none';
                renderResults(local, places);
            }
        }, 300);
    }
    document.getElementById('search-input').addEventListener('compositionstart', () => { isComposing = true; });
    document.getElementById('search-input').addEventListener('compositionend', (e) => {
        isComposing = false;
        runSearchInput(e.target);
    });
    document.getElementById('search-input').addEventListener('input', (e) => {
        if (isComposing) return;
        runSearchInput(e.target);
    });
    // 検索ボックスにフォーカスが戻ったとき、ワードが残っていれば結果を再表示
    document.getElementById('search-input').addEventListener('focus', async (e) => {
        closeObjSheet();   // 検索を始める時点で、タップで開いた情報シートは用済みなので閉じる
        const q = e.target.value.trim();
        if (!q) return;
        document.getElementById('search-clear').style.display = 'block';
        const local = searchLocal(q);
        const reqId = ++searchRequestId;
        clearTimeout(geocodeTimer);
        document.getElementById('search-spinner').style.display = 'inline-block';
        geocodeTimer = setTimeout(async () => {
            const places = await searchGeocode(q);
            if (reqId === searchRequestId) {
                document.getElementById('search-spinner').style.display = 'none';
                renderResults(local, places);
            }
        }, 300);
    });
    document.getElementById('search-clear').addEventListener('click', (e) => {
        e.preventDefault();
        clearSearch();
        document.getElementById('search-input').focus();
    });
    document.getElementById('map').addEventListener('click', () => {
        document.getElementById('search-results').style.display = 'none';
        closeNearby();
    });

    function calcDist(lat1, lng1, lat2, lng2) {
        const R = 6371, dLat = (lat2-lat1)*Math.PI/180, dLng = (lng2-lng1)*Math.PI/180;
        const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    }

    const gmapKeywords = { supermarket: 'スーパー', transit: '駅 OR バス停', restaurant: 'レストラン', coffee: 'カフェ', statue: '像', takeout: 'テイクアウト', museum: 'ミュージアム OR 歴史館 OR 資料館', ramen: 'ラーメン', udon: 'うどん', soba: 'そば', sightseeing: '観光スポット', sushi: '寿司 OR 回転寿司', drugstore: '薬局 OR ドラッグストア', hundredyen: '100円ショップ' };
    /* 周辺検索の状態。center は近い順の起点で、検索した時点で固定する（execNearbySearch）。
       q は結果一覧の絞り込み語、shown は一覧に描いてある件数（NEARBY_ITEM_CHUNK ずつ継ぎ足す）。 */
    let nearbyState = { cats: [], center: null, centerPinned: false, q: '', shown: 0, rows: [] };
    setSearchOriginText('地図中心', false);
    let nearbyAllResults = [];
    let nearbyTypeFilter = new Set();
    // 集計帯に出す種別。圏内に1件も無い種別も0件で並べる（何が無いのかも見えるようにする）ので、
    // 中身はいつも PREF_TYPES と同じ6種になる。設定で表示を外している種別もそのまま並べる
    let nearbyResultTypes = [];
    let nearbyResultScrollTop = 0; // 結果からオブジェクトを開く直前の一覧のスクロール位置

    // タイプフィルターのOFF状態をlocalStorageへ永続化
    function loadNearbyFilterOff() {
        try { return new Set(storeGetJson('nearbyTypeFilterOff') || []); } catch { return new Set(); }
    }
    function saveNearbyFilterOff() {
        // 集計帯に出していない種別の保存済みOFF状態は維持する
        const off = loadNearbyFilterOff();
        nearbyResultTypes.forEach(t => { if (nearbyTypeFilter.has(t)) off.delete(t); else off.add(t); });
        storeSetJson('nearbyTypeFilterOff', [...off]);
    }
    /* オブジェクトの表示設定。キーの並びは種別の共通順
       （食べログ→ポケふた→マンホール→カード配布→道の駅→城）に合わせてある。
       これは地図だけの設定ではなく、検索・周辺検索・都道府県から探す・城主から探すの
       すべてが見る土台で、外した種別はどこにも出さない。 */
    const filterState = Object.assign(
        { shop: true, pokefuta: true, manhole: true, mhcard: false, michi: true, castle: true },
        savedSettings ? savedSettings.filter : {}
    );
    const labelState = Object.assign(
        { shop: true, michi: true, castle: true },
        savedSettings ? savedSettings.label : {}
    );

    /* 食べログは部門（35種）でも出し入れできる。覚えるのは外した部門だけで、
       全部入りの一覧は持たない。データが後から届いて部門が増えたとき、
       知らない部門を勝手に消さずに既定ONで足すため。 */
    const genreOff = new Set(
        savedSettings && Array.isArray(savedSettings.genreOff) ? savedSettings.genreOff : []
    );
    // 部門が表示中か。部門を持たない食べログ（category 空）は部門で消さない
    function genreVisible(g) { return !g || !genreOff.has(g); }

    let showOriginState = savedSettings ? (savedSettings.showOrigin === true) : false;

    function saveSettings() {
        storeSetJson('settingsState', {
            filter: filterState,
            label:  labelState,
            genreOff: [...genreOff],
            showOrigin: showOriginState
        });
    }

    function applyShowOrigin() {
        const el = document.getElementById('nearby-search-origin');
        const footer = document.getElementById('nearby-panel-footer');
        if (el) el.style.display = showOriginState ? '' : 'none';
        if (footer) footer.style.justifyContent = showOriginState ? '' : 'flex-end';
    }

    function onShowOriginChange(checkbox) {
        showOriginState = checkbox.checked;
        applyShowOrigin();
        saveSettings();
    }

    function onTileSourceChange(value) {
        storeSet('mapTileSource', value);
        location.reload();
    }

    document.getElementById('tile-source-select').value = storeGet('mapTileSource') || 'openfreemap';
    document.getElementById('hotel-radius-select').value = storeGet('hotelRadius') || '10000';
    document.getElementById('hotel-sort-select').value = storeGet('hotelSort') || '2';
    document.getElementById('travel-mode-select').value = travelMode();

    function onHotelRadiusChange(value) {
        storeSet('hotelRadius', value);
    }

    function onHotelSortChange(value) {
        storeSet('hotelSort', value);
    }

    function onTravelModeChange(value) {
        storeSet('travelMode', value);
        // 情報シートを開いたまま設定を変えた場合に備える。Yahooはボタン押下時にURLを組むので
        // 影響を受けないが、Google側はhrefを埋め込んでいるため開いているシートだけ貼り替える。
        const a = document.querySelector('#obj-sheet-body .btn-nav');
        if (a && objSheetLngLat) {
            const [lng, lat] = objSheetLngLat;
            a.href = `https://www.google.com/maps?daddr=${lat},${lng}&dirflg=${TRAVEL_MODES[travelMode()].gmap}`;
        }
    }

    /* ══ オブジェクト表示（設定の土台） ══════════════════════════════════
       種別ごとの地図ソースと、その種別を出し入れする設定キーの対応。
       manholes だけは蓋とポケふたの2種別が同居していて、どちらかが表示中なら
       レイヤーは出したままにする（中身は manholeFeaturesForMap が絞る）。 */
    const OBJ_FILTER_SOURCES = {
        shop:   ['shops'],
        manhole: ['manholes'], pokefuta: ['manholes'],
        mhcard: ['mhcards'],
        michi:  ['michi'],
        castle: ['castles-famous', 'castles'],
    };
    function objLayerVisible(id) {
        if (id === 'manhole' || id === 'pokefuta') {
            return filterState.manhole !== false || filterState.pokefuta !== false;
        }
        return filterState[id] !== false;
    }
    /* レイヤーの visibility を種別の設定に合わせる。
       ラベル（-label）だけは「テキスト表示」の設定も通す。種別をONに戻したときに
       消しているはずのラベルまで復活させないため。 */
    function applyObjLayerVis(id) {
        const vis = objLayerVisible(id) ? 'visible' : 'none';
        const labelId = (id === 'manhole' || id === 'pokefuta') ? null
            : (id === 'mhcard' ? null : id);
        const labelVis = (vis === 'visible' && labelId && labelState[labelId] !== false) ? 'visible' : 'none';
        (OBJ_FILTER_SOURCES[id] || []).forEach(sourceId => {
            [`${sourceId}-cluster-shadow`, `${sourceId}-cluster`, `${sourceId}-cluster-count`,
             `${sourceId}-shadow`, `${sourceId}-bg`,
             `${sourceId}-icon`, `${sourceId}-icon-overlay`].forEach(l => {
                if (map.getLayer(l)) map.setLayoutProperty(l, 'visibility', vis);
            });
            const l = `${sourceId}-label`;
            if (map.getLayer(l)) map.setLayoutProperty(l, 'visibility', labelVis);
        });
    }

    /* 種別の出し入れ。地図・検索・周辺検索は filterState を直接見るので、
       ここで作り直すのは地図のソースと、設定画面の見た目だけでよい。
       都道府県索引は表示中の種別だけで組むので、次に開くときに組み直させる。 */
    function toggleObjFilter(id) {
        filterState[id] = filterState[id] === false;
        if (id === 'manhole' || id === 'pokefuta') refreshManholeSource();
        applyObjLayerVis(id);
        // 城を非表示にしたら「城主から探す」「遺構から探す」も出さない
        if (id === 'castle') { updateLordsEntry(); updateRemainsEntry(); }
        // 県ページの種別の選択にも反映する（設定が土台で、そちらはその中の一時的な絞り込み）
        if (prefState.types) PREF_TYPES.filter(t => t.filter === id).forEach(t => {
            if (filterState[id] === false) prefState.types.delete(t.type);
            else prefState.types.add(t.type);
        });
        prefIndex = null;
        renderObjFilterUI();
        refreshFavOverlay();   // 消した種別はお気に入りの重ね描きからも外す
        saveSettings();
    }

    /* 食べログの部門の出し入れ。地図はソースを入れ直し、一覧側は次に組むときに反映される。
       県ページ側の選択（prefState.genres）にも、外した部門を残さない。 */
    function toggleObjGenre(g) {
        if (genreOff.has(g)) genreOff.delete(g); else genreOff.add(g);
        refreshShopSource();
        if (prefState.genres) {
            if (genreOff.has(g)) prefState.genres.delete(g); else prefState.genres.add(g);
        }
        prefIndex = null;
        renderObjGenreLine();
        refreshFavOverlay();   // 消した部門はお気に入りの重ね描きからも外す
        saveSettings();
    }

    /* 設定画面に並べる種別。順は種別の共通順。アイコンは一覧・集計帯と同じものを使う。
       6列に並べると1列53.8pxしかないので、カード配布だけは折り返す位置を決め打ちする
       （成り行きに任せると「マンホールカ／ード配布」のような切れ方になるため）。 */
    const OBJ_FILTER_ITEMS = [
        { id: 'shop',     type: 'shop',     label: '食べログ' },
        { id: 'pokefuta', type: 'pokefuta', label: 'ポケふた' },
        { id: 'manhole',  type: 'manhole',  label: 'マンホール' },
        { id: 'mhcard',   type: 'mhcard',   label: 'マンホール<br>カード配布' },
        { id: 'michi',    type: 'michi',    label: '道の駅' },
        { id: 'castle',   type: 'castle',   label: 'お城' },
    ];
    function renderObjFilterList() {
        const el = document.getElementById('obj-filter-list');
        if (!el) return;
        el.innerHTML = OBJ_FILTER_ITEMS.map(o => `
            <div class="objf-item${filterState[o.id] === false ? ' off' : ''}" data-t="${o.id}">
                <span class="objf-ic">${prefTypeIconHtml(o.type)}</span>
                <span class="objf-n">${o.label}</span></div>`).join('');
        // タップは表示のON/OFF。2段目のジャンル行を持つのは食べログだけなので、長押しもそこだけ
        el.querySelectorAll('.objf-item').forEach(row =>
            bindTypeToggle(row, () => toggleObjFilter(row.dataset.t),
                row.dataset.t === 'shop' ? () => {
                    if (filterState.shop === false) return;     // 非表示のときは開かない
                    objGenreOpen = !objGenreOpen;
                    renderObjGenreLine();
                } : null));
    }

    /* 食べログのジャンル行。県ページのもの（renderPrefGenreLine）と同じ見た目で、
       対象がその県ではなく全国になる。件数は読み込み済みの食べログ全件から数える。 */
    let objGenreOpen = false;
    let objGenreCounts = null;   // buildSearchIndex のたびに捨てる
    function shopGenreCountsAll() {
        if (objGenreCounts) return objGenreCounts;
        const m = new Map();
        for (const it of searchIndex) {
            if (it.type !== 'shop') continue;
            const g = shopGenreBase((it.properties || {}).category);
            if (g) m.set(g, (m.get(g) || 0) + 1);
        }
        // 並びは県ページと同じく多い順。行の中はさらに10グループの区分で束ねる
        objGenreCounts = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja'));
        return objGenreCounts;
    }
    function renderObjGenreLine() {
        const el = document.getElementById('obj-genre-line');
        if (!el) return;
        if (!objGenreOpen || filterState.shop === false) { el.innerHTML = ''; return; }
        const list = shopGenreCountsAll();
        if (!list.length) {
            el.innerHTML = `<div class="pref-gline"><div class="pref-gline-h">食べログを読み込み中…</div></div>`;
            return;
        }
        const cnt = Object.fromEntries(list);
        const on = list.filter(([g]) => genreVisible(g));
        const groups = SHOP_GENRE_GROUPS.map(([gname, members]) => {
            const has = members.filter(c => cnt[c] !== undefined);
            if (!has.length) return '';
            return `<div class="pref-ggrp"><div class="pref-ggname">${gname}</div><div class="pref-gchips">${
                has.map(c => `<button class="ptg ${genreVisible(c) ? 'on shop-genre ' + (SHOP_GENRE_CLASS[c] || 'g-sonota') : ''}"
                    onclick="toggleObjGenre('${attrEscape(c)}')">${attrEscape(c)}<span class="ptg-n">${cnt[c]}</span></button>`).join('')
            }</div></div>`;
        }).join('');
        el.innerHTML = `<div class="pref-gline">
            <div class="pref-gline-h">食べログのジャンル <b>${on.length}/${list.length}</b>・${
                on.reduce((s, e) => s + e[1], 0).toLocaleString()}件</div>${groups}</div>`;
    }
    function renderObjFilterUI() {
        renderObjFilterList();
        renderObjGenreLine();
    }

    function onLabelChange(el) {
        const id = el.id.replace('check-label-', '');
        labelState[id] = el.checked;
        // 種別ごと消しているときは、ラベルをONに戻してもピンだけ文字が出ることはない
        const val = (el.checked && filterState[id] !== false) ? 'visible' : 'none';
        const sourceIds = id === 'castle'
            ? ['castles-famous', 'castles']
            : [{ shop: 'shops', michi: 'michi' }[id]];
        sourceIds.forEach(sourceId => {
            if (map.getLayer(`${sourceId}-label`)) map.setLayoutProperty(`${sourceId}-label`, 'visibility', val);
        });
        saveSettings();
    }

    function searchNearby(lng, lat, name = null) {
        event.stopPropagation();
        closeObjSheet();   // 周辺検索パネルと情報シートは同じ下部領域を使うため重ねない
        placeSearchPin({ lng, lat }, name || null, { showMapPin: false });
        openNearbyPanel();
    }

    function toggleNearby() {
        const panel = document.getElementById('nearby-panel');
        panel.classList.contains('open') ? closeNearby() : openNearbyPanel();
    }
    function openNearbyPanel() {
        closeObjSheet();   // 同じ下部領域を使うため、情報シートが開いていれば閉じる
        Object.keys(labelState).forEach(id => { const el=document.getElementById(`check-label-${id}`); if(el) el.checked=labelState[id]; });
        document.getElementById('nearby-list').innerHTML = '';
        // 検索地点の行は開くたびに畳んだ状態から始める。展開（expanded）を解除しているのは
        // setSearchOriginText だけで、検索ピンがある間はそこを通らないため、
        // 展開したまま閉じると次に開いても2行のままになる
        document.getElementById('nearby-search-origin').classList.remove('expanded');
        if (!searchPinLngLat) {
            const labelEl = document.getElementById('nearby-search-origin-label');
            if (labelEl) labelEl.textContent = '検索地点';
            setSearchOriginText('取得中...', false);
            const center = map.getCenter();
            // 近い順の起点帯と同じ地点を指すことが多いので、問い合わせは共用する
            fetchPlaceNameCached(center.lat, center.lng).then(name => {
                if (!searchPinLngLat) setSearchOriginText(name || '地図中心', false);
            });
        }
        // メインビューに戻す（フッターがあるので下部バーの位置まで下ろす）
        setPanelLifted(false);
        document.getElementById('nearby-main-view').style.display = '';
        document.getElementById('nearby-settings-view').classList.remove('open');
        document.getElementById('nearby-lords-view').classList.remove('open');
        document.getElementById('nearby-lord-detail-view').classList.remove('open');
        document.getElementById('nearby-pref-view').classList.remove('open');
        document.getElementById('nearby-pref-detail-view').classList.remove('open');
        document.getElementById('nearby-remains-view').classList.remove('open');
        document.getElementById('nearby-remains-group-view').classList.remove('open');
        document.getElementById('nearby-remains-detail-view').classList.remove('open');
        document.getElementById('nearby-fav-view').classList.remove('open');
        document.getElementById('nearby-fav-export-view').classList.remove('open');
        resetSyncViews();
        prefState.pref = null;
        updateLordsEntry();
        updatePrefEntry();
        updateRemainsEntry();
        updateFavEntry();
        document.getElementById('nearby-panel').classList.add('open');
        document.getElementById('nearby-overlay').classList.add('open');
        document.getElementById('bottom-bar').classList.add('panel-open');
        applyShowOrigin();
        fetchWeather();
    }
    function openSettingsView() {
        setPanelLifted(true);
        renderObjFilterUI();
        renderFavNameList();
        Object.keys(labelState).forEach(id => { const el=document.getElementById(`check-label-${id}`); if(el) el.checked=labelState[id]; });
        const originChk = document.getElementById('check-show-origin');
        if (originChk) originChk.checked = showOriginState;
        syncUpdateUi();
        document.getElementById('nearby-main-view').style.display = 'none';
        document.getElementById('nearby-settings-view').classList.add('open');
    }
    function closeSettingsView() {
        setPanelLifted(false);
        document.getElementById('nearby-main-view').style.display = '';
        document.getElementById('nearby-settings-view').classList.remove('open');
    }

    // ══ 城主から探す ═══════════════════════════════════════════════════
    /* castle.js の properties.lords（攻城団・城郭放浪記・Wikipediaの城主欄を統合した値）を
       人物・氏族ごとにまとめ、そこから城へ飛ぶ一覧。索引は castle.js が届いた後に
       初回オープンで組む（表示用の別データファイルは持たない。castle.js に既に入っている
       情報なので、二重に配ると更新のたびに食い違うため）。
       分割・正規化の規則は資料生成スクリプト gen_castle_lords.py と同じにしてある。 */

    // 城主欄の区切り。読点のほか、実データに出る半角読点・「･」・継承の「→」・空白も区切る
    const LORD_SPLIT_RE = /[、,，･→\s;；]+/;
    // 実体のない値。castle.js には原典どおり残っているが、一覧には出さない
    const LORD_SKIP = new Set(['不明', '不詳', 'なし', '無し']);
    // 城郭放浪記のアクセス解説文が城主欄に混入している4城分（castle.js側のデータ不良）。
    // 元データが直れば空振りするだけなので、直った後もこのままで害はない。
    const LORD_NOISE = new Set([
        '潮山の西側を通る県道209号線沿いに道標があり',
        'それに従って山へ入って行くと茶畑の間を通って城址近くまで車で行くことができる。',
        '西側から泰仙寺橋へ続く道の北側に土手下を走る道があり',
        'そこに案内板がある。',
        '関澤神社脇から登る。',
    ]);
    const LORDS_CHUNK = 60;              // 一覧の追加描画単位（11,000名超を一度に積まない）
    let lordIndex = null;                // [{ n, kind, idx:[城のfeature番号], v:[原表記], _n }]
    // center は城一覧の近い順の起点で、城主を開いた時点で固定する（openLordDetail を参照）。
    // listScrollTop / listShown は城主一覧、castleScrollTop は城一覧の、離れる前の位置。
    // castleRows / castleShown は城一覧の中身と描いてある件数（「さらに表示」で継ぎ足す）
    let lordsState = { q: '', type: 'all', sort: 'dist', filtered: [], shown: 0, lord: null,
                       center: null, listScrollTop: 0, listShown: 0, castleScrollTop: 0,
                       castleRows: [], castleShown: 0 };

    // 集計キーを作る。末尾の括弧注記（石高・別称）と推量記号を落とす。
    // 先頭の括弧注記は個人名のときだけ落とす（氏族名から落とすと「（大給）松平氏」が
    // 「松平氏」に吸われて分家の区別が消えるため）。語中の括弧は人名の一部なので触らない。
    /* 個人／組織の判定。組織には氏族（「〜氏」）も含める。
       城主欄には人物のほかに幕府・藩・一揆・寺社なども入るため、人名と衝突しない語尾
       だけを組織の目印にする（実データ全件で確認）。
       「家」「衆」「坊」「国」「村」「方」は前田利家・松平容衆・杉谷善住坊・本多忠国・
       三浦義村・板垣信方のように人名と衝突するので使わない。
       琉球の「〜按司」は人物の称号なので個人のままにする。 */
    const LORD_ORG_RE = /(氏|幕府|藩|朝廷|皇室|公儀|一族|一門|党|水軍|軍|勢|寺|院|社|法人|財団)$/;
    function lordKind(name) {
        return (name.includes('一揆') || LORD_ORG_RE.test(name)) ? 'org' : 'person';
    }

    function normalizeLordName(raw) {
        let t = raw.trim().replace(/^[?？。]+/, '').replace(/[?？。]+$/, '').trim();
        t = t.replace(/\(/g, '（').replace(/\)/g, '）');
        t = t.replace(/（[^（）]*）$/, '').trim();
        const m = t.match(/^（[^（）]*）(.+)$/);
        if (m && !m[1].endsWith('氏')) t = m[1].trim();
        return t;
    }

    function buildLordIndex() {
        const feats = (loadedData.castle && loadedData.castle.features) || [];
        const byName = new Map();
        feats.forEach((f, i) => {
            const p = f.properties || {};
            if (!p.lords) return;
            const seen = new Set();
            p.lords.split(LORD_SPLIT_RE).forEach(tok => {
                tok = tok.trim();
                if (!tok || LORD_NOISE.has(tok)) return;
                const key = normalizeLordName(tok);
                if (!key || LORD_SKIP.has(key) || LORD_NOISE.has(key)) return;
                let e = byName.get(key);
                if (!e) {
                    e = { n: key, kind: lordKind(key), idx: [], v: [], _n: normalizeForSearch(key) };
                    byName.set(key, e);
                }
                if (tok !== key && !e.v.includes(tok)) e.v.push(tok);
                if (!seen.has(key)) { e.idx.push(i); seen.add(key); }   // 同じ城で同じキーは1回
            });
        });
        lordIndex = [...byName.values()];
        // 「〜家」は家名（森家）と人名（前田利家）が混在するため語尾だけでは分けられない。
        // 語幹＋「氏」が別項目として実在するものだけを家名とみなして組織に寄せる
        // （実データでは29件が該当し、人名は1件も混ざらないことを確認済み）
        lordIndex.forEach(e => {
            if (e.kind === 'person' && e.n.endsWith('家') && byName.has(e.n.slice(0, -1) + '氏')) e.kind = 'org';
        });
        lordIndex.sort((a, b) => (b.idx.length - a.idx.length) || a.n.localeCompare(b.n, 'ja'));
        lordIndex.forEach((e, i) => { e.id = i; });
    }

    /* メニューの入口ボタンの状態。城レイヤーを表示していないときは出さない
       （検索・周辺検索が非表示の種別を候補から外すのと同じ扱い）。
       消すのは城のデータしか辿らない2本（城主・遺構）だけで、「一覧から検索」の枠ごとは消さない。
       枠ごと消すと、城と関係のない都道府県とお気に入りまで一緒に消えるため。 */
    function updateLordsEntry() {
        const btn = document.getElementById('lords-entry-btn');
        const rbtn = document.getElementById('remains-entry-btn');
        if (!btn) return;
        const hide = filterState.castle === false;
        btn.style.display = hide ? 'none' : '';
        if (rbtn) rbtn.style.display = hide ? 'none' : '';
        // 読み込みが済むまでは押せない。件数などの補足は出さない（2列に並べると折り返すため）
        btn.disabled = !loadedData.castle;
    }

    // メインビューへ戻すのは openNearbyPanel 側（メニューを開き直したとき）
    /* パネルの位置。フッター（検索地点・現在地・閉じる）を持つのはメインビューだけで、
       それが下部バーの代わりを務める。フッターの無いビューでは下部バーを見せたいので、
       パネルをバーの上に載せる（載せた状態を lifted と呼ぶ）。 */
    function setPanelLifted(on) {
        document.getElementById('nearby-panel').classList.toggle('lifted', on);
    }

    function showLordsView(which) {
        setPanelLifted(true);
        document.getElementById('nearby-main-view').style.display = 'none';
        document.getElementById('nearby-settings-view').classList.remove('open');
        document.getElementById('nearby-lords-view').classList.toggle('open', which === 'list');
        document.getElementById('nearby-lord-detail-view').classList.toggle('open', which === 'detail');
    }

    // lordId を渡すと、その城主の城一覧を直接開く（情報シートからの戻り導線で使う）
    function openLordsView(lordId, restoreView) {
        if (!loadedData.castle) return;
        if (!lordIndex) { buildLordIndex(); updateLordsEntry(); }
        if (lordId != null && lordIndex[lordId]) { openLordDetail(lordId, restoreView); return; }
        showLordsView('list');
        applyLordsFilter();
    }
    function backToLordsList() {
        // 城主を開く前の位置へ戻す（描いてある行数も揃えてから位置を指定する）
        lordsState.restoreListScroll = lordsState.listScrollTop || 0;
        lordsState.restoreShown = lordsState.listShown || 0;
        showLordsView('list');
        applyLordsFilter();
    }

    // 絞り込みは打ち終わりから描く（debounceListFilter。他の一覧の絞り込み欄と同じ扱い）
    function onLordsSearchInput(v) { lordsState.q = v; debounceListFilter('lords', applyLordsFilter); }
    function setLordsType(t) {
        lordsState.type = t;
        document.querySelectorAll('#nearby-lords-view .lords-chip[data-lt]').forEach(b => {
            b.setAttribute('aria-pressed', String(b.dataset.lt === t));
        });
        applyLordsFilter();
    }
    /* 照合するのは城主名（集計キーと、その表記ゆれ）だけにする。
       以前は城名・都道府県でも引けるようにしていたが、人物・氏族を探す画面で
       城側の語に当たると意図しない城主が並ぶため、城名は対象から外した。
       城名で城を探す導線は、メイン検索と「都道府県から探す」が受け持つ。 */
    function applyLordsFilter() {
        const q = normalizeForSearch(lordsState.q.trim());
        lordsState.filtered = lordIndex.filter(l => {
            if (lordsState.type !== 'all' && lordsState.type !== l.kind) return false;
            if (!q) return true;
            if (l._n.includes(q)) return true;
            return l.v.some(v => normalizeForSearch(v).includes(q));
        });
        // 戻ってきたときだけ、離れる前の描画量と位置に復元する（絞り込みが同じなら並びも同じ）
        const restoreTop = lordsState.restoreListScroll || 0;
        const restoreShown = lordsState.restoreShown || 0;
        lordsState.restoreListScroll = 0;
        lordsState.restoreShown = 0;
        const list = document.getElementById('lords-list');
        list.innerHTML = '';
        list.scrollTop = 0;
        lordsState.shown = 0;
        if (lordsState.filtered.length === 0) {
            list.innerHTML = '<div class="lords-note">該当する城主がいません</div>';
            return;
        }
        renderLordsChunk();
        while (lordsState.shown < restoreShown && lordsState.shown < lordsState.filtered.length) {
            renderLordsChunk();
        }
        if (restoreTop) list.scrollTop = restoreTop;
    }

    function renderLordsChunk() {
        const list = document.getElementById('lords-list');
        const part = lordsState.filtered.slice(lordsState.shown, lordsState.shown + LORDS_CHUNK);
        const feats = loadedData.castle.features;
        list.insertAdjacentHTML('beforeend', part.map(l => {
            // 副見出しは表記ゆれがあればそれを、無ければ城名を並べる（どの城の城主か分かるように）
            const sub = l.v.length
                ? '表記: ' + l.v.join(' / ')
                : l.idx.slice(0, 3).map(i => (feats[i].properties.name || '')).join('・')
                  + (l.idx.length > 3 ? ' ほか' : '');
            // 行にアイコンは置かない（人／組は「人」「組」の一文字を丸で囲んでいただけで、
            // 絵ではなく文字だったため。人／組の区別は絞り込みチップで付けられる）
            return `<div class="lord-row" onclick="openLordDetail(${l.id})">
                <div class="lord-main">
                    <div class="lord-name">${attrEscape(l.n)}</div>
                    <div class="lord-sub">${attrEscape(sub)}</div>
                </div>
                <div class="lord-num">${l.idx.length}城</div>
                <div class="lord-chev">›</div>
            </div>`;
        }).join(''));
        lordsState.shown += part.length;
    }

    // 末尾付近までスクロールしたら続きを描画
    document.getElementById('lords-list').addEventListener('scroll', function () {
        if (lordsState.shown >= lordsState.filtered.length) return;
        if (this.scrollTop + this.clientHeight > this.scrollHeight - 400) renderLordsChunk();
    });

    /* restoreView は openPrefDetail と同じ意味で、城を開く前の一覧の状態
       （近い順の起点・スクロール位置）を保つ。戻り導線から立てて呼ぶ。 */
    function openLordDetail(id, restoreView) {
        const l = lordIndex[id];
        if (!l) return;
        if (!restoreView) {
            // 一覧から開いたときだけ、城主一覧に戻るための位置を控える
            lordsState.listScrollTop = document.getElementById('lords-list').scrollTop;
            lordsState.listShown = lordsState.shown;
        }
        if (!restoreView || !lordsState.center) {
            const c = getSearchCenter();
            lordsState.center = { lat: c.lat, lng: c.lng };
            // 起点が検索ピンだったのか地図の中心だったのかは、控えた時点でしか分からない
            lordsState.centerPinned = !!searchPinLngLat;
        }
        lordsState.restoreCastleScroll = restoreView ? (lordsState.castleScrollTop || 0) : 0;
        lordsState.lord = l;
        document.getElementById('lord-detail-title').textContent = `${l.n}（${l.idx.length}城）`;
        // 別の城主を開いたら絞り込みは持ち越さない（前の語のまま0件になるのを防ぐ）
        lordsState.castleQ = '';
        document.getElementById('lord-castle-search').value = '';
        setSearchClearVisible('lord-castle-search', '');
        const vEl = document.getElementById('lord-detail-variants');
        vEl.textContent = l.v.length ? '表記: ' + l.v.join(' / ') : '';
        vEl.style.display = l.v.length ? '' : 'none';
        renderDistOrigin('lord');
        showLordsView('detail');
        // 戻ってきたときは継ぎ足した分もそのまま（スクロール位置を戻す先が変わらないように）
        renderLordCastles(restoreView);
    }

    function setLordCastleSort(sort) {
        lordsState.sort = sort;
        document.querySelectorAll('#nearby-lord-detail-view .lords-chip').forEach((b, i) => {
            b.setAttribute('aria-pressed', String((i === 0) === (sort === 'dist')));
        });
        renderLordCastles();
    }

    // 入力があるときだけクリアボタンを出す（メイン画面の #search-clear と同じ振る舞い）
    function setSearchClearVisible(inputId, v) {
        const el = document.getElementById(inputId);
        if (el && el.parentElement) el.parentElement.classList.toggle('has-text', !!v);
    }

    /* ══ 一覧を描くときの共通の小物（都道府県・城主・遺構で使う） ═══════════════

       並べ替えの文字列比較。localeCompare は呼ぶたびに照合器を作るため、数万件を
       並べると比較のたびにその費用がかかる。1つ作って使い回すと同じ結果で速い
       （2026-08-26 実測: 全国33,868件の種別順で 303ms → 並べ替えキーの事前計算と
        合わせて 73ms）。 */
    const LIST_COLLATOR = new Intl.Collator('ja');

    /* 一覧の絞り込み欄。1打鍵ごとに一覧を作り直すと、行数が多い画面では入力が詰まる
       （2026-08-26 実測: 遺構「曲輪」12,418城の一覧で1打鍵あたり2.3秒）。
       打ち終わりから 150ms 待ってから描く。クリアボタンの出し入れは待たせない。 */
    const listFilterTimers = {};
    function debounceListFilter(key, fn) {
        clearTimeout(listFilterTimers[key]);
        listFilterTimers[key] = setTimeout(fn, 150);
    }

    /* 一覧の末尾に出す件数の行。打ち切っているときは「さらに表示」を添える。
       都道府県・城主・遺構の3か所で同じものを使う（onMore は継ぎ足す関数の呼び出し文）。 */
    function listFootHtml(shown, total, onMore, chunk) {
        if (shown >= total) return `<div class="lords-note">全${total.toLocaleString()}件</div>`;
        return `<div class="lords-note">${shown.toLocaleString()}件を表示中（全${
            total.toLocaleString()}件）<button class="pref-more" onclick="${onMore}"
            >さらに${Math.min(chunk, total - shown).toLocaleString()}件</button></div>`;
    }

    /* 一覧に続きを継ぎ足す。末尾の件数の行を外し、増えたぶんの行だけを足して、
       件数の行を付け直す。作り直しではないので、いま出ている行と指の位置は動かない
       （2026-08-26 実測: 全国の一覧を3,000件まで継ぎ足すと、作り直しでは1回あたり
        472→827→876ms と伸びるのに対し、継ぎ足しは行数によらず一定）。 */
    function appendListRows(listId, html, shown, total, onMore, chunk) {
        const list = document.getElementById(listId);
        const foot = list.querySelector(':scope > .lords-note');
        if (foot) foot.remove();
        list.insertAdjacentHTML('beforeend', html + listFootHtml(shown, total, onMore, chunk));
    }

    // 城一覧の絞り込み。城主一覧の検索と同じく normalizeForSearch で照合する
    function onLordCastleSearchInput(v) {
        lordsState.castleQ = v;
        setSearchClearVisible('lord-castle-search', v);
        debounceListFilter('lordCastle', renderLordCastles);
    }
    function clearLordCastleSearch() {
        const el = document.getElementById('lord-castle-search');
        el.value = '';
        onLordCastleSearchInput('');
        el.focus();
    }

    /* 城一覧（城主・遺構）を一度に描く件数の上限。県ページ（PREF_ITEM_CHUNK）と同じ 1,000件。
       打ち切りが無かったころは、遺構「曲輪」の12,418城を一度に積んでいて、開くまでに
       2.3秒かかっていた（2026-08-26 実測。うち DOM の組み立て0.7秒・配置1.2秒）。
       1,000件なら約170msで、続きは末尾の「さらに表示」で継ぎ足せる。 */
    const CASTLE_LIST_CHUNK = 1000;

    /* 城一覧の行。城主（renderLordCastles）と遺構（renderRemainsCastles）で同じ作りなので、
       行を作るところだけ切り出して継ぎ足しからも呼べるようにする。
       jump は行をタップしたときに呼ぶ関数名で、呼ぶ側が渡す（飛んだ後の戻り導線が違うため）。 */
    function castleRowsHtml(rows, from, to, jump) {
        let out = '';
        for (let i = from; i < to; i++) {
            const r = rows[i];
            const p = r.f.properties;
            const color = getItemColor({ type: 'castle', properties: p });
            const distStr = r.dist < 1 ? `${Math.round(r.dist * 1000)}m` : `${r.dist.toFixed(1)}km`;
            /* 副見出しは他の一覧（周辺検索・都道府県から探す・お気に入り・検索結果）と揃えて住所そのもの。
               住所を持たない城（実測12件）だけ都道府県に落とす。
               100名城の印はバッジ側に出るので、ここには入れない（同じ語が2つ並ばないように） */
            out += `<div class="nearby-item" onclick="${jump}(${r.i})">
                ${favStripeHtml('castle', p, r.f.geometry.coordinates)}
                <div class="nearby-item-icon" style="background:${color}"><img src="castle.png" class="icon-full"></div>
                <div class="nearby-item-text">
                    <div class="nearby-item-name">${attrEscape(p.coordOffset ? '[近接あり] ' + p.name : p.name)}</div>
                    <div class="nearby-item-sub">${attrEscape(p.address || r.pref)}</div>
                </div>
                ${prefBadgesHtml({ type: 'castle', properties: p })}
                <div class="nearby-item-dist">${distStr}</div>
            </div>`;
        }
        return out;
    }

    /* keepShown を立てて呼ぶと、継ぎ足した分（lordsState.castleShown）を保つ。
       城を開いて戻ってきたときがこれに当たる（絞り込みや並べ替えでは先頭から見せ直す）。 */
    function renderLordCastles(keepShown) {
        const l = lordsState.lord;
        if (!l) return;
        if (!keepShown) lordsState.castleShown = CASTLE_LIST_CHUNK;
        const feats = loadedData.castle.features;
        // 起点は城主を開いた時点で固定（城を開くと地図が動くので、戻ったときに並びが変わらないように）
        const center = lordsState.center || getSearchCenter();
        const q = normalizeForSearch((lordsState.castleQ || '').trim());
        const rows = l.idx.map(i => {
            const f = feats[i];
            const c = f.geometry.coordinates;
            // 都道府県は prefOfProps で取る（prefecture を持たない城でも住所から決まる）。
            // 副見出しと都道府県順の並びの両方で使うので、ここで一度だけ求める
            return { i, f, pref: prefOfProps(f.properties) || '',
                     dist: calcDist(center.lat, center.lng, c[1], c[0]) };
        }).filter(r => {
            if (!q) return true;
            const p = r.f.properties;
            return normalizeForSearch(`${p.name || ''} ${r.pref} ${p.address || ''}`).includes(q);
        });
        /* 選んだ基準をそのまま第一キーにする。近い順は距離だけで並べ、100名城で束ねない
           （束ねると「いま近いのはどれか」が分からなくなり、近い順にした意味が消えるため）。
           都道府県順は県が先で、格付けは同じ県の中での並びに使う。 */
        const rank = r => castleGenreRank(r.f.properties);
        if (lordsState.sort === 'dist') rows.sort((a, b) => a.dist - b.dist);
        else rows.sort((a, b) => (PREF_ORDER[a.pref] ?? 99) - (PREF_ORDER[b.pref] ?? 99)
                                 || rank(a) - rank(b)
                                 || LIST_COLLATOR.compare(a.f.properties.name, b.f.properties.name));
        lordsState.castleRows = rows;          // 継ぎ足し（showMoreLordCastles）で使い回す
        const list = document.getElementById('lord-castle-list');
        if (rows.length === 0) {
            list.innerHTML = '<div class="lords-note">該当する城がありません</div>';
            return;
        }
        const shown = Math.min(rows.length, lordsState.castleShown || CASTLE_LIST_CHUNK);
        lordsState.castleShown = shown;
        list.innerHTML = castleRowsHtml(rows, 0, shown, 'lordsJumpToCastle')
            + listFootHtml(shown, rows.length, 'showMoreLordCastles()', CASTLE_LIST_CHUNK);
        // 通常は先頭から。城を開いて戻ってきたときだけ、開く前の位置へ戻す
        list.scrollTop = lordsState.restoreCastleScroll || 0;
        lordsState.restoreCastleScroll = 0;
    }

    /* 「さらに表示」。いま出ている続きから見えるよう、スクロール位置は動かさない。 */
    function showMoreLordCastles() {
        const rows = lordsState.castleRows || [];
        const from = lordsState.castleShown || CASTLE_LIST_CHUNK;
        const to = Math.min(rows.length, from + CASTLE_LIST_CHUNK);
        if (to <= from) return;
        lordsState.castleShown = to;
        appendListRows('lord-castle-list', castleRowsHtml(rows, from, to, 'lordsJumpToCastle'),
                       to, rows.length, 'showMoreLordCastles()', CASTLE_LIST_CHUNK);
    }

    // 都道府県順の並び（pref_codes.js の JP-01…JP-47 の順をそのまま使う）
    const PREF_ORDER = (() => {
        const o = {};
        Object.values(typeof PREF_CODES !== 'undefined' ? PREF_CODES : {}).forEach((name, i) => { o[name] = i; });
        return o;
    })();

    /* 一覧から城へ飛ぶ。検索結果タップ（onResultClick）と同じ扱いにする＝
       対象を判別できる倍率まで寄せ、情報シートを開き、選択リングを出し、履歴にはピン選択として残す。
       履歴の種別アイコンを城にするため、cause は 'pin' で objType/objProps も一緒に記録する。 */
    function lordsJumpToCastle(featIdx) {
        const f = loadedData.castle.features[featIdx];
        if (!f) return;
        const c = f.geometry.coordinates.slice();
        const p = f.properties;
        const label = p.name || '城';
        const lordId = lordsState.lord ? lordsState.lord.id : null;
        // 戻り導線で開く前の位置へ戻せるよう、離れる前に控える（一覧の位置と地図）
        lordsState.castleScrollTop = document.getElementById('lord-castle-list').scrollTop;
        saveListReturnCamera();
        closeNearby();
        if (trackingMode > 0) {
            trackingMode = 0;
            stopRafLoop();
            updateGeolocateButton();
        }
        const zoom = landingZoom(c[0], c[1]);
        histSetPending(label, 'pin', { objType: 'castle', objProps: p }, { coords: c, zoom });
        map.easeTo({ center: c, zoom, bearing: 0, pitch: 0, duration: 550, essential: true });
        setTimeout(() => {
            openObjSheet('castle', label, p, c[0], c[1]);
            injectLordsBackLink(lordId);
        }, 300);
    }

    // 一覧から来たときだけ、情報シートの先頭に戻り導線を挿す。
    // 別のピンをタップするとシート本文ごと作り直されるので、自然に消える。
    function injectLordsBackLink(lordId) {
        if (lordId == null || !lordIndex || !lordIndex[lordId]) return;
        const body = document.getElementById('obj-sheet-body');
        if (!body) return;
        const div = document.createElement('div');
        div.className = 'os-lords-back';
        div.textContent = `↩ 「${lordIndex[lordId].n}」の城一覧に戻る`;
        // 開く前の一覧の状態（近い順の起点・スクロール位置）と地図のまま戻す
        div.onclick = () => { closeObjSheet(); restoreListReturnCamera(); openNearbyPanel(); openLordsView(lordId, true); };
        body.insertBefore(div, body.firstChild);
    }

    // ══ 都道府県から探す ═══════════════════════════════════════════════
    /* 全オブジェクト種別を都道府県で束ねた一覧。城主から探すと同じ枠組みで、
       索引は表示中のデータから毎回組む（別データファイルは持たない）。

       都道府県の決め方: properties.prefecture があればそれを使い、無ければ address の
       先頭が都道府県名かを見る。どちらも取れない場合だけ address 中に1つだけ現れる
       都道府県名を拾う。prefecture を持つのは城・道の駅・ポケふた・カード配布だけで、
       マンホールと食べログは address からしか取れない（2026-07-31 時点で
       この手順により全34,934件が振り分けられることを実データで確認済み）。 */
    const PREF_NAMES = Object.values(typeof PREF_CODES !== 'undefined' ? PREF_CODES : {});
    // 8地方区分。並び順は PREF_CODES（JP-01…JP-47）に従う
    const PREF_REGIONS = [
        ['北海道', ['北海道']],
        ['東北', ['青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県']],
        ['関東', ['茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県']],
        ['中部', ['新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県', '静岡県', '愛知県']],
        ['近畿', ['三重県', '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県']],
        ['中国', ['鳥取県', '島根県', '岡山県', '広島県', '山口県']],
        ['四国', ['徳島県', '香川県', '愛媛県', '高知県']],
        ['九州・沖縄', ['福岡県', '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県']],
    ];
    /* 一覧の先頭に置く全国の行。索引では47県と同じ1つの県として扱い（prefIndex['全国']）、
       県ページも同じ画面をそのまま使う。県名と衝突しないので、県の並びに混ざる心配はない。 */
    const PREF_ALL = '全国';
    // 種別チップの並び。表示設定（filterState）と対応させる
    const PREF_TYPES = [
        { type: 'shop',     label: '食べログ',   filter: 'shop'    },
        { type: 'pokefuta', label: 'ポケふた',   filter: 'pokefuta' },
        { type: 'manhole',  label: 'マンホール', filter: 'manhole' },
        { type: 'mhcard',   label: 'マンホールカード配布', filter: 'mhcard'  },
        { type: 'michi',    label: '道の駅',     filter: 'michi'   },
        { type: 'castle',   label: 'お城',       filter: 'castle'  },
    ];
    let prefIndex = null;       // { 県名: { 種別: [searchIndexの要素] } }
    let prefShopGenreAll = [];  // 全国の食べログ部門（多い順）。ジャンル選択の初期値に使う
    // 一度でも選択肢に出した部門。データが後から届いて部門が増えたとき、
    // 「まだ見せていない部門」だけを既定ONに足すために使う（外した部門は外れたまま）
    const prefGenreSeen = new Set();
    // sort の既定は種別順（図鑑的な使い方を想定し、近い順の優先度は下げる）
    // genres は食べログだけが持つ2段目の絞り込み。types と同じく県をまたいで保つ。
    // genreOpen の既定は閉じた状態。食べログの長押しで開く
    // center は近い順の起点。県ページを開いた時点で固定する（下の openPrefDetail を参照）
    let prefState = { types: null, genres: null, genreOpen: false, pref: null, sort: 'type', center: null };

    function prefOfProps(p) {
        if (p.prefecture) return p.prefecture;
        const ad = p.address || '';
        for (const n of PREF_NAMES) if (ad.startsWith(n)) return n;
        const hits = PREF_NAMES.filter(n => ad.includes(n));
        return hits.length === 1 ? hits[0] : null;
    }

    /* 索引を組む。検索と同じ searchIndex を使うので、到着済みのデータだけが対象になる
       （データが後から届いたら buildSearchIndex 経由で作り直される）。
       設定で消している食べログの部門はここで落とす。設定は全体の土台なので、
       県ページの件数にも一覧にも、その部門は最初から無いものとして扱う。 */
    function buildPrefIndex() {
        prefIndex = {};
        prefIndex[PREF_ALL] = {};
        PREF_NAMES.forEach(n => { prefIndex[n] = {}; });
        const visible = new Set(prefVisibleTypes());
        const genres = new Map();
        for (const item of searchIndex) {
            if (!visible.has(item.type)) continue;   // 設定で消している種別は索引に入れない
            if (item.type === 'shop') {
                const g = shopGenreBase((item.properties || {}).category);
                if (!genreVisible(g)) continue;
                if (g) genres.set(g, (genres.get(g) || 0) + 1);
            }
            /* 全国には県が取れなかったものも入れる（全国は総数であってほしいため）。
               2026-08-10 時点の実データでは全34,934件すべてに県が付くので、
               全国の件数は47県の合計と一致する。県が取れないものが出た場合だけ、
               全国の方が多くなり、その分は全国の一覧からしか辿れない。 */
            (prefIndex[PREF_ALL][item.type] = prefIndex[PREF_ALL][item.type] || []).push(item);
            const n = prefOfProps(item.properties || {});
            if (!n || !prefIndex[n]) continue;
            (prefIndex[n][item.type] = prefIndex[n][item.type] || []).push(item);
        }
        // 部門は全国で35種。多い順に持っておき、県ごとの一覧はこの順で出す
        prefShopGenreAll = [...genres.entries()]
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja')).map(e => e[0]);
    }

    /* その県にある食べログの部門と件数（多い順）。県ごとに持っている部門が違う
       （東京都35種・青森県11種）ので、選択肢はその県にあるものだけ出す。 */
    function prefShopGenresOf(name) {
        const list = (prefIndex[name] || {}).shop || [];
        const m = new Map();
        for (const it of list) {
            const g = shopGenreBase((it.properties || {}).category);
            if (g) m.set(g, (m.get(g) || 0) + 1);
        }
        return prefShopGenreAll.filter(g => m.has(g)).map(g => [g, m.get(g)]);
    }
    // その要素がジャンル絞り込みを通るか（食べログ以外は常に通る）
    function prefGenrePass(item) {
        if (item.type !== 'shop' || !prefState.genres) return true;
        const g = shopGenreBase((item.properties || {}).category);
        return !g || prefState.genres.has(g);
    }

    /// 表示設定（設定画面のオブジェクト表示）で表示中の種別だけを返す
    function prefVisibleTypes() {
        return PREF_TYPES.filter(t => filterState[t.filter] !== false).map(t => t.type);
    }

    function updatePrefEntry() {
        const btn = document.getElementById('pref-entry-btn');
        if (!btn) return;
        // 索引は開いたときに組む。ここでは押せるかどうかだけ決める
        btn.disabled = searchIndex.length === 0;
    }

    function showPrefView(which) {
        setPanelLifted(true);
        document.getElementById('nearby-main-view').style.display = 'none';
        document.getElementById('nearby-settings-view').classList.remove('open');
        document.getElementById('nearby-pref-view').classList.toggle('open', which === 'list');
        document.getElementById('nearby-pref-detail-view').classList.toggle('open', which === 'detail');
    }

    function openPrefView(prefName, restoreView) {
        if (searchIndex.length === 0) return;
        buildPrefIndex();
        // 表示中の種別を既定の選択にする（地図で消している種別は最初から出さない）
        if (!prefState.types) prefState.types = new Set(prefVisibleTypes());
        // 部門は「全部選択」から始める（食べログを開いた瞬間に何も出ないのを避ける）。
        // 索引を組み直すたびに新しい部門が増えている場合があるので、既存の選択に足す
        if (!prefState.genres) prefState.genres = new Set(prefShopGenreAll);
        else prefShopGenreAll.forEach(g => { if (!prefGenreSeen.has(g)) prefState.genres.add(g); });
        prefShopGenreAll.forEach(g => prefGenreSeen.add(g));
        if (prefName && prefIndex[prefName]) { openPrefDetail(prefName, restoreView); return; }
        showPrefView('list');
        renderPrefList();
    }
    function backToPrefList() {
        // 県を開く前の位置へ戻す
        prefState.restoreListScroll = prefState.listScrollTop || 0;
        showPrefView('list');
        renderPrefList();
    }

    /* ══ 集計帯の操作（県ページ側） ══════════════════════════════
       集計帯の種別アイコンは、タップでその種別の先頭へ飛び、長押し（500ms・地図の長押しと
       同じ間合い）で表示・非表示が切り替わる。外した種別はグレーに落とす。
       食べログだけは長押しでジャンル行が開き、表示・非表示はそのジャンル行の「全解除」で行う。
       都道府県一覧には絞り込みを置かない（47県の一覧では合計件数の方が見たいものだという判断）。
       選択内容は県をまたいで保ち、全解除の制限は設けない（全部外せば一覧は空になる）。 */

    /* 集計帯に出す種別＝その県に1件以上ある表示中の種別。
       絞り込み中かどうかもこの並びを基準に決める（0件の種別は押せないので数に入れない）。 */
    function prefSumTypes(name) {
        const visible = prefVisibleTypes();
        const g = prefIndex[name] || {};
        return PREF_TYPES.filter(t => visible.includes(t.type) && (g[t.type] || []).length).map(t => t.type);
    }

    /* 集計帯でグレーに落とす種別。表示を外しているものに加えて、食べログは部門を
       すべて外したときも落とす。全7,077件のどれにも部門が入っているので（データで確認済み）、
       部門を全部外すと一覧から食べログが1件も出なくなり、種別を外したのと同じ状態になる。 */
    function prefSumOff(t) {
        if (!prefState.types.has(t)) return true;
        if (t !== 'shop') return false;
        const list = prefShopGenresOf(prefState.pref);
        return list.length > 0 && !list.some(([g]) => prefState.genres.has(g));
    }

    function renderPrefSum() {
        const name = prefState.pref;
        if (!name) return;
        const g = prefIndex[name] || {};
        const items = prefSumTypes(name).map(t => `
            <div class="pref-sum-item ${prefSumOff(t) ? 'off' : ''}" data-t="${t}">
                ${prefTypeIconHtml(t)}<div class="pref-sum-v">${g[t].length.toLocaleString()}</div></div>`);
        const el = document.getElementById('pref-detail-sum');
        el.innerHTML = `<div class="pref-sum-line">${items.join('')}</div>`;
        el.querySelectorAll('.pref-sum-item').forEach(bindPrefSumItem);
    }

    /* 種別アイコンのタップと長押しの割り当て。長押しは onLongPress を渡した要素だけで働く。
       割り当てる中身は置き場所ごとに違うので、呼ぶ側が決める（設定のオブジェクト表示＝
       renderObjFilterList と、県ページの集計帯＝bindPrefSumItem の2か所で使う）。
       タッチのあとに合成されるマウスイベントで二重に反応しないよう、直後の mouse は捨てる。 */
    let lpTimer = null, lpFired = false, lpTouched = false;
    function bindTypeToggle(el, onTap, onLongPress) {
        const start = () => {
            lpFired = false;
            if (!onLongPress) return;
            lpTimer = setTimeout(() => { lpTimer = null; lpFired = true; onLongPress(); }, 500);
        };
        const cancel = () => { if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; } };
        const end = () => { cancel(); if (lpFired) { lpFired = false; return; } onTap(); };
        el.addEventListener('touchstart', start, { passive: true });
        el.addEventListener('touchmove', cancel, { passive: true });
        el.addEventListener('touchend', () => { lpTouched = true; setTimeout(() => { lpTouched = false; }, 600); end(); });
        el.addEventListener('mousedown', e => { if (e.button === 0 && !lpTouched) start(); });
        el.addEventListener('mouseup', e => { if (e.button === 0 && !lpTouched) end(); });
        el.addEventListener('mouseleave', cancel);
        el.addEventListener('contextmenu', e => e.preventDefault());   // 長押しのメニューを出さない
    }
    /* 県ページの集計帯。タップはその種別の先頭へ飛ぶ操作にする。東京都は2,496件あって
       先頭の食べログだけで2,084行あり、いちばん下のお城まで指で送ると2,312行かかるため。
       表示のON/OFF は長押しへ移す。
       食べログだけは長押しでジャンル行が開き、表示のON/OFF はそのジャンル行の
       「全解除」（部門を全部外す＝一覧から1件も出なくなる）で行う。 */
    function bindPrefSumItem(el) {
        const t = el.dataset.t;
        bindTypeToggle(el, () => prefJumpToType(t), t === 'shop' ? () => {
            if (!prefState.types.has('shop')) return;   // 非表示のときは開かない
            prefState.genreOpen = !prefState.genreOpen;
            renderPrefGenreLine();
        } : () => togglePrefType(t));
    }

    /* 集計帯のタップで、その種別の最初の行へ飛ぶ。種別順ならその種別の先頭、名前順・近い順なら
       一覧で最初に出てくるその種別の行（近い順ならいちばん近いもの）になる。どの並びでも
       意味が通るので、種別順のときだけの操作にはしていない。
       2,000行を超えて動くのでなめらかスクロールは使わず、一気に飛ばして着いた行を光らせる。 */
    function prefJumpToType(t) {
        const list = document.getElementById('pref-item-list');
        const i = (prefState.typeHead || {})[t];
        if (!list || i === undefined) return;   // 絞り込みで1件も残っていない種別
        // 上限で打ち切った先にある種別は、その行が入るところまで継ぎ足してから飛ぶ
        if (i >= (prefState.shown || 0)) appendPrefItems(Math.ceil((i + 1) / PREF_ITEM_CHUNK) * PREF_ITEM_CHUNK);
        const el = list.children[i];
        if (!el) return;
        list.scrollTop += el.getBoundingClientRect().top - list.getBoundingClientRect().top;
        el.classList.remove('pref-jumped');
        void el.offsetWidth;                    // 同じ行へ続けて飛んでも光らせ直す
        el.classList.add('pref-jumped');
    }

    /* 食べログのジャンル行。バッジと同じ10グループの区分で並べ、選択中のチップは
       バッジと同じ色にする。食べログを非表示にしている間は出さない。 */
    function renderPrefGenreLine() {
        const el = document.getElementById('pref-genre-line');
        const list = prefShopGenresOf(prefState.pref);
        if (!prefState.genreOpen || !prefState.types.has('shop') || !list.length) { el.innerHTML = ''; return; }
        const cnt = Object.fromEntries(list);
        const on = list.filter(([g]) => prefState.genres.has(g));
        const groups = SHOP_GENRE_GROUPS.map(([gname, members]) => {
            const has = members.filter(c => cnt[c] !== undefined);
            if (!has.length) return '';
            return `<div class="pref-ggrp"><div class="pref-ggname">${gname}</div><div class="pref-gchips">${
                has.map(c => `<button class="ptg ${prefState.genres.has(c) ? 'on shop-genre ' + (SHOP_GENRE_CLASS[c] || 'g-sonota') : ''}"
                    onclick="togglePrefGenre('${attrEscape(c)}')">${attrEscape(c)}<span class="ptg-n">${cnt[c]}</span></button>`).join('')
            }</div></div>`;
        }).join('');
        el.innerHTML = `<div class="pref-gline">
            <div class="pref-gline-h"><span>食べログのジャンル <b>${on.length}/${list.length}</b>・${
                on.reduce((s, e) => s + e[1], 0).toLocaleString()}件</span>
                <button class="ptg-all" onclick="togglePrefGenreAll()">${
                    on.length === list.length ? '全解除' : '全選択'}</button></div>${groups}</div>`;
    }

    /* ジャンル行の「全解除／全選択」。全部選んでいるときは全解除、それ以外は全選択に戻す
       （周辺検索結果の種別チップ＝toggleAllNearbyTypeFilter と同じ言い回しにする）。
       全解除は、この県の食べログをまとめて消す操作でもある。集計帯の食べログを長押しして
       全解除すれば、表示を外したのと同じ状態になり、集計帯もグレーに落ちる（prefSumOff）。
       触るのはその県にある部門だけ。県ごとに持っている部門が違う（東京都35種・青森県11種）ので、
       他の県にしか無い部門の選択まで巻き込まない。 */
    function togglePrefGenreAll() {
        const list = prefShopGenresOf(prefState.pref);
        const allOn = list.every(([g]) => prefState.genres.has(g));
        list.forEach(([g]) => { if (allOn) prefState.genres.delete(g); else prefState.genres.add(g); });
        renderPrefFilterUI();
        renderPrefItems();
    }

    /* 絞り込み中だけ出す帯。何をどれだけ絞っているかと、戻す操作をここにまとめる。 */
    function renderPrefResetBar() {
        const el = document.getElementById('pref-reset-bar');
        const types = prefSumTypes(prefState.pref);
        const onTypes = types.filter(t => prefState.types.has(t));
        const genres = prefShopGenresOf(prefState.pref);
        const onGenres = genres.filter(([g]) => prefState.genres.has(g));
        const typeFiltered = onTypes.length !== types.length;
        const genreFiltered = prefState.types.has('shop') && genres.length && onGenres.length !== genres.length;
        if (!typeFiltered && !genreFiltered) { el.innerHTML = ''; return; }
        const parts = [];
        if (typeFiltered) parts.push(`${onTypes.length}/${types.length}種別`);
        if (genreFiltered) parts.push(`ジャンル${onGenres.length}/${genres.length}`);
        el.innerHTML = `<div class="pref-rstbar">${parts.join('・')}を表示中
            <button onclick="resetPrefFilter()">すべて表示</button></div>`;
    }

    /* 種別と部門の選択を既定（どちらもすべて選択）に戻す。
       絞り込み欄の語は別の操作なので消さない。 */
    function resetPrefFilter() {
        prefState.types = new Set(prefVisibleTypes());
        prefState.genres = new Set(prefShopGenreAll);
        renderPrefFilterUI();
        renderPrefItems();
    }
    // 集計帯・ジャンル行・絞り込み帯はいつも同じ状態から作るので、まとめて描き直す
    function renderPrefFilterUI() {
        renderPrefSum();
        renderPrefGenreLine();
        renderPrefResetBar();
    }
    function togglePrefGenre(g) {
        if (prefState.genres.has(g)) prefState.genres.delete(g); else prefState.genres.add(g);
        renderPrefGenreLine();
        renderPrefResetBar();
        renderPrefItems();
    }
    function togglePrefType(t) {
        if (prefState.types.has(t)) prefState.types.delete(t); else prefState.types.add(t);
        renderPrefFilterUI();
        renderPrefItems();
    }

    /* 一覧に出すのは種別ごとの内訳だけ。合計は県ページ側にあるので、行にも地方見出しにも置かない。
       数える対象は種別の選択に関わらず「地図で表示中の種別」（種別の絞り込みは県ページ側）。

       数字の欄はその種別の47都道府県での最大件数の文字数で固定し、アイコンが全行で
       同じ位置に来るようにする（県どうしを縦に見比べられる）。
       幅を ch で取るのは、フォントが変わっても桁数どおりの幅になるため。
       全国の行はこの固定幅の対象にしない。全国の件数を最大に含めると6種別で合わせて
       9ch 広がり（例：マンホールは最大の県が99件・全国が1,267件）、
       375px で県名と「›」が押し出されるため、全国の行だけ桁なりの幅で出す。 */
    function prefCntWidths(types) {
        const w = {};
        for (const t of types) {
            w[t] = Math.max(1, ...PREF_NAMES.map(
                n => ((prefIndex[n] || {})[t] || []).length.toLocaleString().length));
        }
        return w;
    }

    /* 一覧の1行。全国も県も同じ作りにする（開く先も同じ県ページ）。
       違うのは件数の欄の幅だけで、w を渡すと種別ごとの固定幅、省くと桁なりの幅になる。 */
    function prefRowHtml(name, types, w) {
        const g = prefIndex[name] || {};
        const cnt = types.map(t => {
            const v = (g[t] || []).length;
            return `<span class="pref-cnt-cell">${prefTypeIconHtml(t)}<span
                class="pref-cnt-n${v ? '' : ' zero'}"${w ? ` style="width:${w[t]}ch"` : ''}
                >${v.toLocaleString()}</span></span>`;
        }).join('');
        return `<div class="pref-row${name === PREF_ALL ? ' pref-row-all' : ''}" onclick="openPrefDetail('${name}')">
            <div class="lord-main"><div class="lord-name">${name}</div></div>
            <div class="pref-cnt-line">${cnt}</div>
            <div class="lord-chev">›</div>
        </div>`;
    }

    function renderPrefList() {
        const types = prefVisibleTypes();
        const w = prefCntWidths(types);
        // 先頭は全国。8地方と同じ形の見出しを付けて、地方と同じ並びの中に置く
        const out = [`<div class="reg-head">${PREF_ALL}</div>`, prefRowHtml(PREF_ALL, types, null)];
        for (const [region, members] of PREF_REGIONS) {
            out.push(`<div class="reg-head">${region}</div>`);
            for (const n of members) out.push(prefRowHtml(n, types, w));
        }
        const list = document.getElementById('pref-list');
        list.innerHTML = out.length ? out.join('')
            : '<div class="lords-note">該当する都道府県がありません</div>';
        fitPrefAllRow();
        // 通常は先頭から。県ページから戻ってきたときだけ、開く前の位置へ戻す
        list.scrollTop = prefState.restoreListScroll || 0;
        prefState.restoreListScroll = 0;
    }

    /* 全国の行の収まりを実測で確かめる。件数の桁が県より9ch多く、間隔を詰めても
       375px（iPhone SE3。スクロールバー13pxを引いて362px）での余りは30px弱なので、
       フォントの幅が想定より広い端末では「›」が画面の外へ出る。はみ出していたら
       この行の数字だけを0.5pxずつ縮めて収める（アイコンと県の行には触らない）。
       画面が狭い端末（320px幅）でも同じ仕組みで収まる。 */
    function fitPrefAllRow() {
        const row = document.querySelector('#pref-list .pref-row-all');
        if (!row) return;
        const line = row.querySelector('.pref-cnt-line');
        line.style.fontSize = '';
        for (let size = 11; size > 8.5 && row.scrollWidth > row.clientWidth; size -= 0.5) {
            line.style.fontSize = (size - 0.5) + 'px';
        }
    }

    /* restoreView を立てて呼ぶと、オブジェクトを開く前の一覧の状態に戻す。
       ・近い順の起点を取り直さない。getSearchCenter() は検索ピンが無ければ地図の中心を
         返すので、一覧からオブジェクトを開くと地図がそこへ寄って起点が変わってしまう。
       ・スクロール位置も開く前の場所へ戻す（prefJumpToItem が控えておいた値）。
       戻り導線からはこれを立てて呼ぶ。 */
    function openPrefDetail(name, restoreView) {
        if (!prefIndex || !prefIndex[name]) return;
        prefState.pref = name;
        // 47県の一覧から開いたときだけ、そこへ戻るための位置を控える
        if (!restoreView) prefState.listScrollTop = document.getElementById('pref-list').scrollTop;
        if (!restoreView || !prefState.center) {
            const c = getSearchCenter();
            prefState.center = { lat: c.lat, lng: c.lng };
            // 起点が検索ピンだったのか地図の中心だったのかは、控えた時点でしか分からない
            prefState.centerPinned = !!searchPinLngLat;
        }
        prefState.restoreScroll = restoreView ? (prefState.scrollTop || 0) : 0;
        document.getElementById('pref-detail-title').textContent = name;
        // 別の県を開いたら絞り込みの語は持ち越さない（種別・部門の選択は保つ）
        prefState.q = '';
        document.getElementById('pref-item-search').value = '';
        setSearchClearVisible('pref-item-search', '');
        // 集計帯・ジャンル行・絞り込み帯はその県の内訳から作り直す
        renderPrefFilterUI();
        renderDistOrigin('pref');
        showPrefView('detail');
        // 戻ってきたときは継ぎ足した分もそのまま（スクロール位置を戻す先が変わらないように）
        renderPrefItems(restoreView);
    }

    function setPrefSort(sort) {
        prefState.sort = sort;
        document.querySelectorAll('#nearby-pref-detail-view .lords-chip[data-ps]').forEach(b => {
            b.setAttribute('aria-pressed', String(b.dataset.ps === sort));
        });
        renderPrefItems();
    }

    /* 種別アイコン。周辺検索結果（renderNearbyList）と同じ作りにする。
       マンホールカードだけはカード画像に蓋バッジを重ねた専用の見た目。
       props を渡すと色を objRingColor に決めさせる（地図のピンと同じく
       100名城は青・続100名城は赤になる）。集計帯のように種別の代表として
       出すときは props を省いて種別の基本色にする。 */
    function prefTypeIconHtml(type, props) {
        if (type === 'mhcard') {
            // 角丸は --mhcard-radius で上書きできる。カード画像の四隅が透明なので、
            // 小さく出す場所（都道府県一覧の内訳）で 6px のままだと丸くなりすぎる
            return `<div style="position:relative;width:var(--mhcard-w);height:var(--mhcard-h);flex-shrink:0;background:#e2ddd4;border-radius:var(--mhcard-radius,6px);"><img src="mhcard.png" style="width:100%;height:100%;display:block;"><img src="manhole.png" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:var(--mhcard-badge);height:var(--mhcard-badge);filter:brightness(0) invert(1);pointer-events:none;"></div>`;
        }
        const cfg = typeConfig[type] || {};
        const color = props ? objRingColor(type, props) : (OBJ_TYPE_COLOR[type] || cfg.color || '#546E7A');
        return `<div class="nearby-item-icon${objIconSquareClass(type)}" style="background:${color}">${cfg.img
            ? `<img src="${cfg.img}"${cfg.img === 'manhole.png' ? '' : ' class="icon-full"'}>` : (cfg.icon || '')}</div>`;
    }

    /* 行に出すバッジ。情報シートで出しているものと同じ内容にする。
       城は 100名城/続100名城 と形態、カード配布はカードIDと弾、蓋はカードID、
       食べログは部門。県ページの一覧と周辺検索結果（renderNearbyList）の両方で使う。 */
    function prefBadgesHtml(item) {
        const p = item.properties || {};
        const b = [];
        if (item.type === 'castle') {
            const label = CASTLE_GENRE_LABEL[p.genre];
            if (label) b.push(`<span class="pref-badge" style="background:${getItemColor(item)}">${label}</span>`);
            // 形態は情報シートと同じ色分け（FORM_BADGE_CLASS）をそのまま使う
            if (p.shiroHbForm && p.shiroHbForm !== '不明') {
                b.push(`<span class="pref-badge popup-form-badge ${FORM_BADGE_CLASS[p.shiroHbForm] || ''}">${attrEscape(p.shiroHbForm)}</span>`);
            }
        } else if (item.type === 'mhcard') {
            const info = mhcardInfo(p);
            if (info && info.id) b.push(`<span class="pref-badge card">${attrEscape(info.id)}</span>`);
            if (info && info.round) b.push(`<span class="pref-badge round">${attrEscape(info.round)}</span>`);
        } else if (item.type === 'manhole' && p.cardId) {
            b.push(`<span class="pref-badge card">${attrEscape(p.cardId)}</span>`);
        } else if (item.type === 'shop') {
            // 部門バッジ。同じ画面のジャンル絞り込みと同じ語彙になる
            const badge = shopGenreBadgeHtml(p, 'pref-badge');
            if (badge) b.push(badge);
        }
        return b.length ? `<div class="pref-badges">${b.join('')}</div>` : '';
    }

    /* 城は 100名城 → 続100名城 → その他 の順に寄せる。地図のピンが circle-sort-key で
       使っている優先度（100名城3 / 続2 / その他1）と同じ考え方。 */
    function castleGenreRank(p) {
        if (p.genre === '日本100名城') return 0;
        if (p.genre === '続日本100名城') return 1;
        return 2;
    }

    /* 食べログは部門でまとめる。並びはバッジと同じ10グループの区分（SHOP_GENRE_GROUPS）の順で、
       同じ画面のジャンル行に出るチップの並びと一致させてある。
       区分に無い部門と食べログ以外の種別は同じ値になるので、種別順の中では影響しない。 */
    const SHOP_GENRE_ORDER = (() => {
        const m = new Map();
        SHOP_GENRE_GROUPS.forEach(([, members]) => members.forEach(c => m.set(c, m.size)));
        return m;
    })();
    function shopGenreRank(p) {
        const r = SHOP_GENRE_ORDER.get(shopGenreBase(p && p.category));
        return r === undefined ? SHOP_GENRE_ORDER.size : r;
    }

    // 一覧の絞り込み。照合は searchIndex が持つ正規化済みの名前・住所を使う
    // （毎入力で2,000件超を正規化し直さずに済む）
    function onPrefSearchInput(v) {
        prefState.q = v;
        setSearchClearVisible('pref-item-search', v);
        debounceListFilter('prefItem', renderPrefItems);
    }
    function clearPrefSearch() {
        const el = document.getElementById('pref-item-search');
        el.value = '';
        onPrefSearchInput('');
        el.focus();
    }

    /* 一度に描く件数の上限。全国（34,934件）を一度に描くと重く、実測で
       東京都2,496件の6.9倍かかった（同じ端末・同じブラウザで884ms→6.1秒、
       DOMノード307,398。2026-08-10）。上限は、これまで問題なく使えていた
       東京都2,496件より軽い1,000件に置く。続きは末尾の「さらに表示」で継ぎ足す
       ので、打ち切っても辿れなくなるものは無い。 */
    const PREF_ITEM_CHUNK = 1000;

    /* 一覧の行。継ぎ足し（showMorePrefItems）からも呼べるよう、範囲を指定して作る。
       onclick に渡すのは rows の通し番号なので、継ぎ足した行でも先頭から数えた番号になる。 */
    function prefRowsHtml(rows, from, to) {
        let out = '';
        for (let i = from; i < to; i++) {
            const r = rows[i];
            const item = r.item;
            const distStr = r.dist < 1 ? `${Math.round(r.dist * 1000)}m` : `${r.dist.toFixed(1)}km`;
            out += `<div class="nearby-item" onclick="prefJumpToItem(${i})">
                ${favStripeHtml(item.type, item.properties, item.coords)}
                ${prefTypeIconHtml(item.type, item.properties || {})}
                <div class="nearby-item-text">
                    <div class="nearby-item-name">${attrEscape(itemDisplayName(item))}</div>
                    <div class="nearby-item-sub">${matchNoteHtml(null, r.part)}${attrEscape(item.sub || '')}</div>
                </div>
                ${prefBadgesHtml(item)}
                <div class="nearby-item-dist">${distStr}</div>
            </div>`;
        }
        return out;
    }

    /* keepShown を立てて呼ぶと、継ぎ足した分（prefState.shown）を保つ。
       オブジェクトから戻ったときの描き直しがこれに当たる（「さらに表示」は
       作り直さずに続きを足す＝showMorePrefItems）。
       絞り込みや並べ替えで一覧の中身が変わるときは、先頭1,000件から見せ直す。 */
    function renderPrefItems(keepShown) {
        const name = prefState.pref;
        if (!name) return;
        if (!keepShown) prefState.shown = PREF_ITEM_CHUNK;
        const types = [...prefState.types];
        const center = prefState.center || getSearchCenter();   // 起点は県ページを開いた時点で固定
        const q = normalizeForSearch((prefState.q || '').trim());
        let rows = [];
        for (const t of types) {
            for (const item of (prefIndex[name][t] || [])) {
                if (!prefGenrePass(item)) continue;   // 食べログの部門で絞る（2段目）
                if (q && !(item._normLabel || '').includes(q)
                      && !(item._normSub || '').includes(q)) continue;
                const c = item.coords;
                // 絞り込み中は、検索結果と同じく「店名以外のどこで当たったか」を添える
                rows.push({ item, dist: calcDist(center.lat, center.lng, c[1], c[0]),
                            part: (q && item.type === 'shop') ? shopMatchedPart(item.properties, q) : null });
            }
        }
        /* 並べる基準は行に出している名前と同じにする（食べログは店名）。
           name 全体で並べると、画面では見えない駅名やジャンルで順番が決まってしまうため。
           比較のたびに名前を組み立て直すと数万件では効いてくるので、並べ替えに使う値は
           先に1度だけ求めて行に持たせる（2026-08-26 実測: 全国33,868件の種別順で
           303ms → 73ms。文字列の比較を LIST_COLLATOR にした分も含む）。 */
        if (prefState.sort === 'dist') {
            // 近い順は種別も城の格付けも見ず、距離だけで並べる
            rows.sort((a, b) => a.dist - b.dist);
        } else if (prefState.sort === 'type') {
            // 種別でまとめたうえで、城は 100名城 → 続100名城 → その他、食べログは部門の順に寄せる
            const order = {};
            PREF_TYPES.forEach((t, i) => { order[t.type] = i; });
            for (const r of rows) {
                const p = r.item.properties || {};
                r.kType = order[r.item.type];
                r.kCastle = castleGenreRank(p);
                r.kGenre = shopGenreRank(p);
                r.kName = itemDisplayName(r.item);
            }
            rows.sort((a, b) => a.kType - b.kType || a.kCastle - b.kCastle || a.kGenre - b.kGenre
                                || LIST_COLLATOR.compare(a.kName, b.kName));
        } else {
            // 名前順は種別も城の格付けも見ず、名前だけで並べる
            for (const r of rows) r.kName = itemDisplayName(r.item);
            rows.sort((a, b) => LIST_COLLATOR.compare(a.kName, b.kName));
        }
        // 種別ごとの最初の行。集計帯のタップ（prefJumpToType）で飛ぶ先に使う。
        // 並べ替えと絞り込みの結果から取るので、一覧を作り直すたびに取り直す
        prefState.typeHead = {};
        rows.forEach((r, i) => {
            if (prefState.typeHead[r.item.type] === undefined) prefState.typeHead[r.item.type] = i;
        });
        const list = document.getElementById('pref-item-list');
        if (rows.length === 0) {
            list.innerHTML = `<div class="lords-note">${
                q ? '該当する項目がありません' : '表示する種別が選ばれていません'}</div>`;
            return;
        }
        /* 上限までを描く。上限は種別で分けずに先頭から数える（種別ごとの枠にすると、
           並べ替えが名前順・近い順のときに枠の意味が無くなるため）。集計帯のタップで
           上限の先にある種別へ飛ぶときは、そこまで継ぎ足してから飛ぶ（prefJumpToType）。 */
        const shown = Math.min(rows.length, prefState.shown || PREF_ITEM_CHUNK);
        prefState.shown = shown;
        prefState.rows = rows;
        // 末尾は、打ち切っているときだけ「さらに表示」を添えた件数の行になる
        list.innerHTML = prefRowsHtml(rows, 0, shown)
            + listFootHtml(shown, rows.length, 'showMorePrefItems()', PREF_ITEM_CHUNK);
        // 通常は先頭から。オブジェクトを開いて戻ってきたときだけ、開く前の位置へ戻す
        // （全件を入れ終えてから指定しないと、スクロールできる高さが足りずに切り詰められる）
        list.scrollTop = prefState.restoreScroll || 0;
        prefState.restoreScroll = 0;
    }

    /* 「さらに表示」。一覧を作り直さず、増えたぶんの行だけを足す（appendListRows）。
       いま出ている行はそのまま残るので、指の位置も動かない。 */
    function showMorePrefItems() {
        appendPrefItems((prefState.shown || PREF_ITEM_CHUNK) + PREF_ITEM_CHUNK);
    }

    // 指定の件数まで一覧を継ぎ足す。「さらに表示」と、集計帯から上限の先へ飛ぶときに使う
    function appendPrefItems(target) {
        const rows = prefState.rows || [];
        const from = prefState.shown || PREF_ITEM_CHUNK;
        const to = Math.min(rows.length, target);
        if (to <= from) return;
        prefState.shown = to;
        appendListRows('pref-item-list', prefRowsHtml(rows, from, to),
                       to, rows.length, 'showMorePrefItems()', PREF_ITEM_CHUNK);
    }

    /* 一覧からオブジェクトへ飛ぶ。検索結果タップ（onResultClick）と同じ扱いにして、
       寄せ方・情報シート・履歴の記録を揃える。 */
    function prefJumpToItem(i) {
        const r = (prefState.rows || [])[i];
        if (!r) return;
        const back = prefState.pref;
        // 戻り導線で開く前の位置へ戻せるよう、離れる前に控える（一覧の位置と地図）
        prefState.scrollTop = document.getElementById('pref-item-list').scrollTop;
        saveListReturnCamera();
        closeNearby();
        onResultClick(r.item);
        // onResultClick は 300ms 後に情報シートを開くので、その後に戻り導線を挿す
        setTimeout(() => injectPrefBackLink(back), 400);
    }

    // 一覧から来たときだけ、情報シートの先頭に戻り導線を挿す（城主から探すと同じ扱い）。
    // 別のピンをタップするとシート本文ごと作り直されるので、自然に消える。
    function injectPrefBackLink(prefName) {
        if (!prefName) return;
        const body = document.getElementById('obj-sheet-body');
        if (!body || body.querySelector('.os-lords-back')) return;
        const div = document.createElement('div');
        div.className = 'os-lords-back';
        div.textContent = `↩ 「${prefName}」の一覧に戻る`;
        // 開く前の一覧の状態（近い順の起点・スクロール位置）と地図のまま戻す
        div.onclick = () => { closeObjSheet(); restoreListReturnCamera(); openNearbyPanel(); openPrefView(prefName, true); };
        body.insertBefore(div, body.firstChild);
    }

    /* ══ 遺構から探す（第7〜9ビュー） ═══════════════════════════════
       castle.js の properties.remains は読点区切りの列挙で、全件で757種・延べ42,012件。
       城数順に並べただけのフラット一覧では、292種に散らばる建造物（624城）が
       下に沈んで探せないため、13グループに寄せて2階層で辿らせる。

       ・分類は語の一部で機械的に決める（先に書いた規則が勝つ）。どれにも当たらない
         「その他」は14種18城まで落ちている（2026-08-21 実データで確認）
       ・括弧の対応が取れていないトークン（原典の括弧内の読点で分断されたもの。
         「四稜星堡外郭（土塁」等44種46件）は語の断片なので、規則に掛けず「その他」に落とす
       ・「なし」「不明」「埋没」等は遺構名ではないので一覧に出さない。
         情報シート（castleAttrLine）が同じ理由でこれらの行を出していないのに揃える */
    const REMAIN_GROUP_DEFS = [
        ['none',    '遺構なし・状態', '#B0BEC5', /^(なし|無し|不明|-|あり|等|ほか|伝)$|埋没|消失|消滅|未発見|一部残存|未調査|残存しない/],
        ['sign',    '碑・案内板',     '#9E9D24', /碑|説明板|説明版|案内板|標柱|案内/],
        ['koguchi', '虎口・出入口',   '#EF6C00', /虎口|枡形|桝形|馬出|大手|搦手|搦め手|城戸|木戸|武者走|武者隠|登城路|小口|構口|一騎駆|抜け穴/],
        ['bldg',    '建造物',         '#AD1457', /天守|天主|櫓|門|御殿|殿|書院|茶室|蔵|塀|長屋|番所|母屋|主屋|本館|藩校|建物|屋敷|居館|館|厩|馬屋|会所|玄関|時鐘|鐘楼|本殿|祠|社|寺|堂|トイレ|小屋|兵糧|陣屋|陣|台所|倉庫|米倉|正倉|火薬庫|望楼|角楼|閣|楼|築地|邸|部屋|御役所|隠居所|謁見所|舞台|亭|扉|階段|薬園/],
        ['ishi',    '石垣・石造物',   '#546E7A', /石垣|石積|石塁|石段|石列|列石|石橋|礎石|石組|石切|城壁|防塁|眼鏡橋|石/],
        ['hori',    '堀',             '#1565C0', /堀|濠|壕|溝|掘|運河|水路|用水|舟入|舟隠|堰堤/],
        ['dorui',   '土塁・切岸',     '#8D6E63', /土塁|土居|土橋|切岸|犬走|土壇|土堤|段切|段差|版築|盛土|塁段|逆茂木|人工傾斜地|削崖|畝形阻塞/],
        ['kuruwa',  '曲輪・区画',     '#6D4C41', /曲輪|郭|削平|平坦面|平場|城山|馬場|総構|丸|台$|の台|城址公園|城跡|砦/],
        ['mizu',    '井戸・水利',     '#00838F', /井戸|水門|池|貯水|暗渠|水の手|水ノ手|水場|庭園|泉|噴水|清水|馬洗/],
        ['gunji',   '砲台・物見',     '#4527A0', /砲|堡|胸壁|狼煙|烽火|のろし|ノロシ|狼火|物見|見張|台場|矢穴|乱穴|旗立|軍道|武者溜/],
        ['hakkutsu','発掘遺構',       '#2E7D32', /柱穴|ピット|ピッ卜|土坑|竪穴|鍛冶|住居|掘立|遺構|官衙|政庁|坑道|貝塚|柵列|柱列|竈|炊き釜|焚き口|火吹き穴/],
        ['haka',    '墓・供養塔',     '#5D4037', /墓|塚|供養塔|宝筐印塔|首切り/],
        ['other',   'その他',         '#78909C', /./],
    ];
    const REMAIN_GROUP = {};
    REMAIN_GROUP_DEFS.forEach(([id, name, color]) => { REMAIN_GROUP[id] = { id, name, color }; });
    /* 分類一覧の並び。城数順ではなく、情報シートの「遺構」行に出る順に揃える。
       シートは原典の remains をそのまま出しており（castleAttrLine）、その並びは
       「天守、櫓、石垣、曲輪、虎口、土塁、堀、井戸」のような建物から地形へ降りる順で
       ほぼ一貫している。同じ城に両方を持つ城で先に書かれた方を全ペア数えて決めた
       （2026-08-21 に castle.js の全18,000件超で集計）。分類同士の勝敗は
       建造物11勝・石垣10勝・曲輪8勝…と綺麗に並び、城内での相対位置の中央値で
       並べても碑・案内板を除いて同じ順になる。
       ・碑・案内板だけは2つの方法で位置が割れる（勝敗では土塁の次、相対位置では曲輪の次）。
         71城しかなく、虎口には必ず負ける一方で曲輪に59%勝つという不整合な出方をするため、
         勝敗の方を採った
       ・砲台・物見／発掘遺構／墓・供養塔は互いに併記される城が1つも無く、
         この3つの間の順は決められない。城数順で置いている
       未知のIDが増えたときは末尾に回し、そこだけ従来どおり城数順で並べる。 */
    const REMAIN_GROUP_ORDER = ['bldg', 'ishi', 'kuruwa', 'koguchi', 'dorui', 'sign',
                                'hori', 'mizu', 'gunji', 'hakkutsu', 'haka', 'other'];
    // グループの記号。種別アイコンと同じ28pxの丸に白抜きで置く
    const REMAIN_GROUP_ICON = {
        kuruwa: '<rect x="2" y="5" width="20" height="14" rx="2" fill="none" stroke="#fff" stroke-width="2.4"/><path d="M8 5v14" stroke="#fff" stroke-width="2.4"/>',
        hori: '<path d="M2 5v6l5 8h10l5-8V5" fill="none" stroke="#fff" stroke-width="2.4" stroke-linejoin="round"/>',
        dorui: '<path d="M2 19L8 7l4 6 4-8 6 14z" fill="#fff"/>',
        ishi: '<g fill="#fff"><rect x="2" y="5" width="9" height="6" rx="1"/><rect x="13" y="5" width="9" height="6" rx="1"/><rect x="2" y="13" width="12" height="6" rx="1"/><rect x="16" y="13" width="6" height="6" rx="1"/></g>',
        bldg: '<path d="M12 3l9 5H3z" fill="#fff"/><rect x="5" y="9" width="14" height="11" fill="#fff"/>',
        koguchi: '<path d="M4 20V6h7M20 20V6h-7" fill="none" stroke="#fff" stroke-width="2.6"/>',
        mizu: '<path d="M12 3s6 7 6 11a6 6 0 01-12 0c0-4 6-11 6-11z" fill="#fff"/>',
        gunji: '<path d="M3 17l14-8 3 4-14 8z" fill="#fff"/><circle cx="19" cy="7" r="3" fill="#fff"/>',
        hakkutsu: '<path d="M3 20l8-8M9 6l9 9-3 3-9-9z" stroke="#fff" stroke-width="2.4" fill="none"/>',
        haka: '<path d="M7 21V9a5 5 0 0110 0v12z" fill="#fff"/>',
        sign: '<rect x="3" y="4" width="18" height="10" rx="2" fill="#fff"/><path d="M12 14v7" stroke="#fff" stroke-width="2.4"/>',
        none: '<circle cx="12" cy="12" r="8" fill="none" stroke="#fff" stroke-width="2.4"/><path d="M7 17L17 7" stroke="#fff" stroke-width="2.4"/>',
        other: '<circle cx="6" cy="12" r="2.2" fill="#fff"/><circle cx="12" cy="12" r="2.2" fill="#fff"/><circle cx="18" cy="12" r="2.2" fill="#fff"/>',
    };

    /* 分類の中の中分類。1つの分類の中で語が多すぎて一覧が読めないものだけに置く。
       建造物は292種が624城に散らばっていて、城数順に並べただけでは
       「門」も「天守」も同じ濃さで延々と続くため、見出しで束ねる。
       見出し自体もタップでき、その中分類を持つ城の一覧に行ける（門287城・櫓181城）。
       他の分類は語数が少ない（次に多い曲輪・区画で77種）ので置いていない。
       （数値は 2026-08-21 に castle.js の全件で計り直した） */
    const REMAIN_SUBGROUPS = {
        bldg: [
            ['門',             /門/],
            ['櫓',             /櫓/],
            ['天守',           /天守|天主/],
            ['御殿・書院',     /御殿|殿|書院|茶室|亭|閣|楼|舞台|玄関|部屋|隠居所|謁見所/],
            ['蔵・長屋・番所', /蔵|長屋|番所|倉庫|米倉|正倉|火薬庫|台所|厩|馬屋|小屋/],
            ['塀・築地',       /塀|築地/],
            ['寺社・祠',       /寺|社|堂|祠|本殿|鐘楼|時鐘/],
            ['屋敷・居館',     /屋敷|居館|館|陣屋|陣|邸|本館|主屋|母屋|藩校|会所|御役所|薬園|建物/],
            ['その他の建物',   /./],
        ],
    };
    /* 中分類の表示順。分類一覧と同じ理由で、情報シートに出る順に揃える。
       上の REMAIN_SUBGROUPS の並びは語をどの中分類に落とすかの規則そのもの
       （先に書いた方が勝つ。「櫓門」が門に入るのはこの順序による）なので触らず、
       表示順だけここに分けて持つ。
       この順は 2026-08-21 に castle.js の全件で数えた。中分類同士が同じ城に並ぶ31組は
       31組とも一方向100%で、順が割れる組は1つも無い（天守と櫓が並ぶ33城は33城とも
       天守が先、門と御殿・書院が並ぶ30城は30城とも門が先）。 */
    const REMAIN_SUBGROUP_ORDER = {
        bldg: ['天守', '櫓', '門', '御殿・書院', '蔵・長屋・番所',
               '塀・築地', '屋敷・居館', '寺社・祠', 'その他の建物'],
    };

    let remainsIndex = null;    // [{ n, g, id, idx:[城のfeature番号], _n }]（「なし」系は除く）
    let remainsGroups = null;   // [{ id, name, color, toks:[remainsIndex の要素], castles:Set }]
    // center は城一覧の近い順の起点で、遺構を開いた時点で固定する（openLordDetail と同じ扱い）
    // castleRows / castleShown は城一覧の中身と描いてある件数（城主と同じく「さらに表示」で継ぎ足す）
    let remainsState = { q: '', tokQ: '', castleQ: '', mode: 'group', sort: 'dist',
                         group: null, sub: null, target: null, center: null, centerPinned: false,
                         listScrollTop: 0, tokScrollTop: 0, subScrollTop: 0, castleScrollTop: 0,
                         restoreListScroll: 0, restoreTokScroll: 0, restoreCastleScroll: 0,
                         castleRows: [], castleShown: 0 };

    function remainGroupOf(tok) {
        // 「なし」「埋没」等の状態語は括弧の対応より先に見る。「埋没（堀」のように
        // 割れた断片であっても状態語であることに変わりはなく、一覧に出す語ではないため
        if (REMAIN_GROUP_DEFS[0][3].test(tok)) return 'none';
        // 括弧が閉じていない＝原典の括弧内で分断された語の断片。規則に掛けず「その他」に落とす
        const open = (tok.match(/[（(]/g) || []).length;
        const close = (tok.match(/[）)]/g) || []).length;
        if (open !== close) return 'other';
        for (const [id, , , re] of REMAIN_GROUP_DEFS) if (re.test(tok)) return id;
        return 'other';
    }

    function buildRemainsIndex() {
        const feats = (loadedData.castle && loadedData.castle.features) || [];
        const byTok = new Map();
        feats.forEach((f, i) => {
            const r = (f.properties || {}).remains;
            if (!r) return;
            const seen = new Set();
            r.split(/[、,]/).forEach(tok => {
                tok = tok.trim();
                if (!tok || seen.has(tok)) return;
                seen.add(tok);                       // 同じ城で同じ語は1回だけ数える
                let e = byTok.get(tok);
                if (!e) {
                    e = { n: tok, g: remainGroupOf(tok), idx: [], _n: normalizeForSearch(tok) };
                    byTok.set(tok, e);
                }
                e.idx.push(i);
            });
        });
        remainsIndex = [...byTok.values()].filter(e => e.g !== 'none')
            .sort((a, b) => b.idx.length - a.idx.length || a.n.localeCompare(b.n, 'ja'));
        remainsIndex.forEach((e, i) => { e.id = i; });

        const byGroup = new Map();
        remainsIndex.forEach(e => {
            let g = byGroup.get(e.g);
            if (!g) {
                const d = REMAIN_GROUP[e.g];
                g = { id: d.id, name: d.name, color: d.color, toks: [], castles: new Set() };
                byGroup.set(e.g, g);
            }
            g.toks.push(e);
            e.idx.forEach(i => g.castles.add(i));
        });
        // 中分類を持つ分類は、その中で語を束ねておく（見出しもタップできるようにするため城数も数える）
        byGroup.forEach(g => {
            const defs = REMAIN_SUBGROUPS[g.id];
            if (!defs) return;
            const bySub = new Map();
            g.toks.forEach(e => {
                const name = (defs.find(([, re]) => re.test(e.n)) || defs[defs.length - 1])[0];
                let s = bySub.get(name);
                if (!s) { s = { name, toks: [], castles: new Set() }; bySub.set(name, s); }
                s.toks.push(e);
                e.idx.forEach(i => s.castles.add(i));
            });
            const sOrder = REMAIN_SUBGROUP_ORDER[g.id] || [];
            const sRank = s => { const i = sOrder.indexOf(s.name);
                                 return i < 0 ? sOrder.length : i; };
            g.subs = [...bySub.values()].sort((a, b) => sRank(a) - sRank(b)
                                                        || b.castles.size - a.castles.size
                                                        || a.name.localeCompare(b.name, 'ja'));
        });
        // 情報シートに出る順（REMAIN_GROUP_ORDER）。載っていないIDは末尾に回して城数順
        const gRank = g => { const i = REMAIN_GROUP_ORDER.indexOf(g.id);
                             return i < 0 ? REMAIN_GROUP_ORDER.length : i; };
        remainsGroups = [...byGroup.values()].sort((a, b) => gRank(a) - gRank(b)
                                                    || b.castles.size - a.castles.size
                                                    || a.name.localeCompare(b.name, 'ja'));
    }

    // 入口ボタンの状態。城レイヤーを非表示にしたときにこのボタンを隠すのは
    // updateLordsEntry（城主と一緒に扱う）なので、ここは押せるかどうかだけ決める
    function updateRemainsEntry() {
        const btn = document.getElementById('remains-entry-btn');
        if (btn) btn.disabled = !loadedData.castle;
    }

    function showRemainsView(which) {
        setPanelLifted(true);
        document.getElementById('nearby-main-view').style.display = 'none';
        document.getElementById('nearby-settings-view').classList.remove('open');
        document.getElementById('nearby-remains-view').classList.toggle('open', which === 'list');
        document.getElementById('nearby-remains-group-view').classList.toggle('open', which === 'group');
        document.getElementById('nearby-remains-detail-view').classList.toggle('open', which === 'detail');
    }

    /* target を渡すと、その遺構（または分類）の城一覧を直接開く（情報シートからの戻り導線で使う）。
       target は openRemainsDetail と同じ形式の文字列（'t:<遺構名>' / 'g:<分類ID>'）。 */
    function openRemainsView(target, restoreView) {
        if (!loadedData.castle) return;
        if (!remainsIndex) { buildRemainsIndex(); updateRemainsEntry(); }
        if (target) {
            const [kind, key] = [target.slice(0, 1), target.slice(2)];
            if (kind === 'g') remainsState.group = remainsGroups.find(g => g.id === key) || null;
            else remainsState.group = null;
            openRemainsDetail(target, restoreView);
            return;
        }
        showRemainsView('list');
        renderRemainsList();
    }

    function setRemainsMode(mode) {
        remainsState.mode = mode;
        document.querySelectorAll('#nearby-remains-view .lords-chip[data-rm]').forEach(b => {
            b.setAttribute('aria-pressed', String(b.dataset.rm === mode));
        });
        document.getElementById('remains-list').scrollTop = 0;
        renderRemainsList();
    }
    function onRemainsSearchInput(v) {
        remainsState.q = v;
        setSearchClearVisible('remains-search', v);
        debounceListFilter('remains', renderRemainsList);
    }
    function clearRemainsSearch() {
        const el = document.getElementById('remains-search');
        el.value = ''; onRemainsSearchInput(''); el.focus();
    }

    // 遺構名は属性に持たせて渡す（onclick の文字列に埋めると、名前に引用符が入ったときに壊れる）
    function remainsRowHtml(e, withGroup) {
        return `<div class="rt-row" data-t="t:${attrEscape(e.n)}" onclick="openRemainsDetail(this.dataset.t)">
            <span class="rt-dot" style="background:${REMAIN_GROUP[e.g].color}"></span>
            <div class="rt-name">${attrEscape(e.n)}</div>
            ${withGroup ? `<div class="rt-g">${REMAIN_GROUP[e.g].name}</div>` : ''}
            <div class="rt-num">${e.idx.length.toLocaleString()}城</div>
            <div class="lord-chev">›</div></div>`;
    }

    function renderRemainsList() {
        const list = document.getElementById('remains-list');
        const q = normalizeForSearch(remainsState.q.trim());
        let html;
        if (remainsState.mode === 'group') {
            // 絞り込みの語は分類名だけでなく中身の遺構名でも当てる（「天守」で建造物が残るように）
            const rows = remainsGroups.filter(g => !q || normalizeForSearch(g.name).includes(q)
                                                   || g.toks.some(t => t._n.includes(q)));
            html = rows.map(g => `<div class="lord-row" onclick="openRemainsGroup('${g.id}')">
                <div class="rg-ic" style="background:${g.color}"><svg viewBox="0 0 24 24">${REMAIN_GROUP_ICON[g.id]}</svg></div>
                <div class="lord-main">
                    <div class="lord-name">${attrEscape(g.name)}</div>
                    <div class="lord-sub">${attrEscape(g.toks.slice(0, 4).map(t => t.n).join('、'))} ほか${g.toks.length}種</div>
                </div>
                <div class="lord-num">${g.castles.size.toLocaleString()}城</div>
                <div class="lord-chev">›</div></div>`).join('');
            if (rows.length) html += `<div class="lords-note">全${remainsGroups.length}分類</div>`;
        } else {
            const rows = remainsIndex.filter(e => !q || e._n.includes(q));
            html = rows.map(e => remainsRowHtml(e, true)).join('');
            if (rows.length) html += `<div class="lords-note">全${remainsIndex.length.toLocaleString()}種</div>`;
        }
        list.innerHTML = html || '<div class="lords-note">該当する遺構がありません</div>';
        // 通常は先頭から。分類ページから戻ってきたときだけ、開く前の位置へ戻す
        list.scrollTop = remainsState.restoreListScroll || 0;
        remainsState.restoreListScroll = 0;
    }

    /* 分類の内訳（第8ビュー）。中分類を持つ分類（建造物）では中分類の一覧を出し、
       持たない分類では遺構をそのまま並べる。中分類の中身（小分類）も同じビューを
       使い回す（remainsState.sub が入っているかどうかで切り替える）。
       restoreView を立てて呼ぶと、離れる前のスクロール位置に戻す。 */
    function openRemainsGroup(gid, restoreView) {
        const g = remainsGroups.find(x => x.id === gid);
        if (!g) return;
        // 分類一覧から開いたときだけ、そこへ戻るための位置を控える
        if (!restoreView) remainsState.listScrollTop = document.getElementById('remains-list').scrollTop;
        remainsState.group = g;
        remainsState.sub = null;
        remainsState.restoreTokScroll = restoreView ? (remainsState.tokScrollTop || 0) : 0;
        openRemainsBreakdown(g.name, g.castles.size, restoreView, `g:${g.id}`);
    }

    /* 中分類の中身（小分類）。中分類の行の「内訳」ボタンから降りる。 */
    function openRemainsSub(subName, restoreView) {
        const g = remainsState.group;
        const s = g && g.subs && g.subs.find(x => x.name === subName);
        if (!s) return;
        // 中分類一覧から降りたときだけ、そこへ戻るための位置を控える
        if (!restoreView) remainsState.tokScrollTop = document.getElementById('remains-tok-list').scrollTop;
        remainsState.sub = s;
        remainsState.restoreTokScroll = restoreView ? (remainsState.subScrollTop || 0) : 0;
        openRemainsBreakdown(s.name, s.castles.size, restoreView, `s:${g.id}:${s.name}`);
    }

    // 第8ビューの共通部分（見出し・まとめて見る行・絞り込みの初期化）
    function openRemainsBreakdown(title, castleCount, restoreView, target) {
        document.getElementById('remains-group-title').textContent = title;
        const all = document.getElementById('remains-group-all');
        all.dataset.t = target;
        all.textContent = `＋ 「${title}」の城をまとめて見る（${castleCount.toLocaleString()}城）`;
        // 別の分類を開いたら絞り込みの語は持ち越さない（前の語のまま0件になるのを防ぐ）。
        // 戻ってきたときは離れる前の状態に戻すので触らない
        if (!restoreView) {
            remainsState.tokQ = '';
            document.getElementById('remains-tok-search').value = '';
            setSearchClearVisible('remains-tok-search', '');
        }
        showRemainsView('group');
        renderRemainsTokList();
    }
    function backToRemainsList() {
        remainsState.restoreListScroll = remainsState.listScrollTop || 0;
        showRemainsView('list');
        renderRemainsList();
    }
    // 第8ビューの戻る。小分類を開いていれば中分類の一覧へ、そうでなければ分類一覧へ
    function backFromRemainsBreakdown() {
        if (remainsState.sub) { openRemainsGroup(remainsState.group.id, true); return; }
        backToRemainsList();
    }
    function onRemainsTokSearchInput(v) {
        remainsState.tokQ = v;
        setSearchClearVisible('remains-tok-search', v);
        renderRemainsTokList();
    }
    function clearRemainsTokSearch() {
        const el = document.getElementById('remains-tok-search');
        el.value = ''; onRemainsTokSearchInput(''); el.focus();
    }
    function renderRemainsTokList() {
        const g = remainsState.group;
        if (!g) return;
        const q = normalizeForSearch(remainsState.tokQ.trim());
        const list = document.getElementById('remains-tok-list');
        let html, hit, total;
        if (g.subs && !remainsState.sub) {
            /* 中分類の一覧。行を押すとその中分類の城一覧、右端の「内訳」で小分類へ降りる。
               閲覧の中心は中分類（門286城・櫓181城）なので、いちばん使う操作を主タップに当てる。
               絞り込みの語は中分類名だけでなく中身の遺構名でも当てる（「移築門」で門が残るように） */
            const rows = g.subs.filter(s => !q || normalizeForSearch(s.name).includes(q)
                                            || s.toks.some(e => e._n.includes(q)));
            hit = rows.length; total = `全${g.subs.length}分類`;
            html = rows.map(s => `<div class="lord-row" data-t="s:${attrEscape(s.name)}" onclick="openRemainsDetail(this.dataset.t)">
                <div class="lord-main">
                    <div class="lord-name">${attrEscape(s.name)}</div>
                    <div class="lord-sub">${attrEscape(s.toks.slice(0, 3).map(e => e.n).join('、'))} ほか${s.toks.length}種</div>
                </div>
                <div class="lord-num">${s.castles.size.toLocaleString()}城</div>
                <button class="rt-drill" data-s="${attrEscape(s.name)}"
                        onclick="event.stopPropagation(); openRemainsSub(this.dataset.s)">内訳${s.toks.length}種
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                </button></div>`).join('');
        } else {
            // 遺構（小分類）の一覧。中分類を持たない分類の内訳と、中分類の中身の両方で使う
            const src = remainsState.sub ? remainsState.sub.toks : g.toks;
            const rows = src.filter(e => !q || e._n.includes(q));
            hit = rows.length; total = `全${src.length.toLocaleString()}種`;
            html = rows.map(e => remainsRowHtml(e, false)).join('');
        }
        list.innerHTML = hit
            ? html + `<div class="lords-note">${total}</div>`
            : '<div class="lords-note">該当する遺構がありません</div>';
        list.scrollTop = remainsState.restoreTokScroll || 0;
        remainsState.restoreTokScroll = 0;
    }

    /* 城一覧。target は 't:<遺構名>'（その遺構を持つ城）か 'g'（今開いている分類の城をまとめて）。
       restoreView は openLordDetail と同じ意味で、城を開く前の一覧の状態
       （近い順の起点・スクロール位置）を保つ。 */
    function openRemainsDetail(target, restoreView) {
        let name, idx;
        // 第8ビューのどちらを見ていたか（中分類の一覧か、小分類の一覧か）は
        // remainsState.sub を書き換える前にしか分からないので先に控える
        const leftSubList = !!remainsState.sub;
        if (target === 'g' || target.startsWith('g:')) {
            const g = target === 'g' ? remainsState.group
                                     : remainsGroups.find(x => x.id === target.slice(2));
            if (!g) return;
            remainsState.group = g;
            remainsState.target = `g:${g.id}`;
            name = `${g.name}（まとめて）`;
            idx = [...g.castles];
        } else if (target.startsWith('s:')) {
            // 中分類の見出しから。今開いている分類の中を探す（戻り導線からは分類IDも一緒に来る）
            const p = target.slice(2).split(':');
            const g = p.length > 1 ? remainsGroups.find(x => x.id === p[0]) : remainsState.group;
            const subName = p.length > 1 ? p[1] : p[0];
            const s = g && g.subs && g.subs.find(x => x.name === subName);
            if (!s) return;
            remainsState.group = g;
            // 中分類の行から来たなら戻り先は中分類の一覧。小分類の一覧の「まとめて見る」から
            // 来たならそこへ帰したいので、そのときだけ sub を残す
            if (!leftSubList) remainsState.sub = null;
            remainsState.target = `s:${g.id}:${s.name}`;
            name = s.name;
            idx = [...s.castles];
        } else {
            const key = target.slice(2);
            const e = remainsIndex.find(x => x.n === key);
            if (!e) return;
            remainsState.target = `t:${e.n}`;
            // 個別の遺構は、戻り導線からも属する分類の内訳へ帰れるようにしておく。
            // 中分類を持つ分類なら、その遺構が属する中分類まで特定して戻り先にする
            if (!remainsState.group || remainsState.group.id !== e.g) {
                remainsState.group = remainsGroups.find(g => g.id === e.g) || null;
                remainsState.sub = null;
            }
            const g = remainsState.group;
            if (g && g.subs) remainsState.sub = g.subs.find(s => s.toks.includes(e)) || null;
            name = e.n;
            idx = e.idx;
        }
        if (!restoreView) {
            // 一覧から開いたときだけ、どの一覧から来たかと、そこへ戻るための位置を控える
            if (document.getElementById('nearby-remains-group-view').classList.contains('open')) {
                const top = document.getElementById('remains-tok-list').scrollTop;
                if (leftSubList) remainsState.subScrollTop = top;
                else remainsState.tokScrollTop = top;
                remainsState.from = 'breakdown';
            } else if (document.getElementById('nearby-remains-view').classList.contains('open')) {
                remainsState.listScrollTop = document.getElementById('remains-list').scrollTop;
                // チップ「個別」のフラット一覧から直接開いた場合。戻り先はそこにする
                remainsState.from = 'list';
            }
        }
        if (!restoreView || !remainsState.center) {
            const c = getSearchCenter();
            remainsState.center = { lat: c.lat, lng: c.lng };
            // 起点が検索ピンだったのか地図の中心だったのかは、控えた時点でしか分からない
            remainsState.centerPinned = !!searchPinLngLat;
        }
        remainsState.restoreCastleScroll = restoreView ? (remainsState.castleScrollTop || 0) : 0;
        remainsState.castleIdx = idx;
        // 別の遺構を開いたら絞り込みは持ち越さない
        remainsState.castleQ = '';
        document.getElementById('remains-castle-search').value = '';
        setSearchClearVisible('remains-castle-search', '');
        document.getElementById('remains-detail-title').textContent = `${name}（${idx.length.toLocaleString()}城）`;
        renderDistOrigin('remains');
        showRemainsView('detail');
        // 戻ってきたときは継ぎ足した分もそのまま（スクロール位置を戻す先が変わらないように）
        renderRemainsCastles(restoreView);
    }
    // 城一覧の戻る。開く前に見ていた一覧（分類一覧／中分類の一覧／小分類の一覧）へ帰す
    function backToRemainsGroup() {
        if (remainsState.from === 'list') { backToRemainsList(); return; }
        if (remainsState.sub) { openRemainsSub(remainsState.sub.name, true); return; }
        if (remainsState.group) { openRemainsGroup(remainsState.group.id, true); return; }
        backToRemainsList();
    }
    function setRemainsSort(sort) {
        remainsState.sort = sort;
        document.querySelectorAll('#nearby-remains-detail-view .lords-chip[data-rs]').forEach(b => {
            b.setAttribute('aria-pressed', String(b.dataset.rs === sort));
        });
        renderRemainsCastles();
    }
    function onRemainsCastleSearchInput(v) {
        remainsState.castleQ = v;
        setSearchClearVisible('remains-castle-search', v);
        debounceListFilter('remainsCastle', renderRemainsCastles);
    }
    function clearRemainsCastleSearch() {
        const el = document.getElementById('remains-castle-search');
        el.value = ''; onRemainsCastleSearchInput(''); el.focus();
    }

    /* keepShown を立てて呼ぶと、継ぎ足した分（remainsState.castleShown）を保つ。
       城主の城一覧（renderLordCastles）と同じ扱い。 */
    function renderRemainsCastles(keepShown) {
        if (!keepShown) remainsState.castleShown = CASTLE_LIST_CHUNK;
        const feats = (loadedData.castle && loadedData.castle.features) || [];
        const center = remainsState.center || getSearchCenter();
        const q = normalizeForSearch(remainsState.castleQ.trim());
        const rows = (remainsState.castleIdx || []).map(i => {
            const f = feats[i];
            const c = f.geometry.coordinates;
            // 城主詳細と同じく、都道府県は prefOfProps で取る
            return { i, f, pref: prefOfProps(f.properties) || '',
                     dist: calcDist(center.lat, center.lng, c[1], c[0]) };
        }).filter(r => {
            if (!q) return true;
            const p = r.f.properties;
            return normalizeForSearch(`${p.name || ''} ${r.pref} ${p.address || ''}`).includes(q);
        });
        // 城主詳細と同じ並び。近い順は距離だけ、都道府県順は県が先で格付けは県の中での並び
        const rank = r => castleGenreRank(r.f.properties);
        if (remainsState.sort === 'dist') rows.sort((a, b) => a.dist - b.dist);
        else rows.sort((a, b) => (PREF_ORDER[a.pref] ?? 99) - (PREF_ORDER[b.pref] ?? 99)
                                 || rank(a) - rank(b)
                                 || LIST_COLLATOR.compare(a.f.properties.name, b.f.properties.name));
        remainsState.castleRows = rows;        // 継ぎ足し（showMoreRemainsCastles）で使い回す
        const list = document.getElementById('remains-castle-list');
        if (rows.length === 0) {
            list.innerHTML = '<div class="lords-note">該当する城がありません</div>';
            return;
        }
        // 行の作りは城主の城一覧と同じ（castleRowsHtml）。副見出しは住所そのもの
        const shown = Math.min(rows.length, remainsState.castleShown || CASTLE_LIST_CHUNK);
        remainsState.castleShown = shown;
        list.innerHTML = castleRowsHtml(rows, 0, shown, 'remainsJumpToCastle')
            + listFootHtml(shown, rows.length, 'showMoreRemainsCastles()', CASTLE_LIST_CHUNK);
        // 通常は先頭から。城を開いて戻ってきたときだけ、開く前の位置へ戻す
        list.scrollTop = remainsState.restoreCastleScroll || 0;
        remainsState.restoreCastleScroll = 0;
    }

    /* 「さらに表示」。いま出ている続きから見えるよう、スクロール位置は動かさない。 */
    function showMoreRemainsCastles() {
        const rows = remainsState.castleRows || [];
        const from = remainsState.castleShown || CASTLE_LIST_CHUNK;
        const to = Math.min(rows.length, from + CASTLE_LIST_CHUNK);
        if (to <= from) return;
        remainsState.castleShown = to;
        appendListRows('remains-castle-list', castleRowsHtml(rows, from, to, 'remainsJumpToCastle'),
                       to, rows.length, 'showMoreRemainsCastles()', CASTLE_LIST_CHUNK);
    }

    // 一覧から城へ飛ぶ。城主一覧（lordsJumpToCastle）と同じ扱いにする
    function remainsJumpToCastle(featIdx) {
        const f = loadedData.castle.features[featIdx];
        if (!f) return;
        const c = f.geometry.coordinates.slice();
        const p = f.properties;
        const label = p.name || '城';
        const back = remainsState.target;
        // 戻り導線で開く前の位置へ戻せるよう、離れる前に控える（一覧の位置と地図）
        remainsState.castleScrollTop = document.getElementById('remains-castle-list').scrollTop;
        saveListReturnCamera();
        closeNearby();
        if (trackingMode > 0) {
            trackingMode = 0;
            stopRafLoop();
            updateGeolocateButton();
        }
        const zoom = landingZoom(c[0], c[1]);
        histSetPending(label, 'pin', { objType: 'castle', objProps: p }, { coords: c, zoom });
        map.easeTo({ center: c, zoom, bearing: 0, pitch: 0, duration: 550, essential: true });
        setTimeout(() => {
            openObjSheet('castle', label, p, c[0], c[1]);
            injectRemainsBackLink(back);
        }, 300);
    }

    // 一覧から来たときだけ、情報シートの先頭に戻り導線を挿す（城主・都道府県と同じ扱い）
    function injectRemainsBackLink(target) {
        if (!target) return;
        const body = document.getElementById('obj-sheet-body');
        if (!body || body.querySelector('.os-lords-back')) return;
        // 'g:<分類ID>' は分類名、's:<分類ID>:<中分類名>' は中分類名、't:<遺構名>' はそのまま
        const g = target.startsWith('g:') ? remainsGroups.find(x => x.id === target.slice(2)) : null;
        const name = g ? g.name
                       : target.startsWith('s:') ? target.slice(2).split(':')[1]
                       : target.slice(2);
        const div = document.createElement('div');
        div.className = 'os-lords-back';
        div.textContent = `↩ 「${name}」の城一覧に戻る`;
        // 開く前の一覧の状態（近い順の起点・スクロール位置）と地図のまま戻す
        div.onclick = () => { closeObjSheet(); restoreListReturnCamera(); openNearbyPanel(); openRemainsView(target, true); };
        body.insertBefore(div, body.firstChild);
    }

    function selectNearbyCat(el) {
        nearbyState.cats = [el.dataset.cat];
        execNearbySearch();
    }
    async function execHotelSearch() {
        const item = document.getElementById('hotel-cat-item');
        const iconEl = item.querySelector('.nearby-cat-icon');
        const labelEl = item.querySelector('.nearby-cat-label');
        item.style.pointerEvents = 'none';
        const savedIconHtml = iconEl.innerHTML;
        iconEl.textContent = '⏳';
        labelEl.textContent = '検索中…';

        const restore = () => {
            iconEl.innerHTML = savedIconHtml; labelEl.textContent = 'ホテル';
            item.style.pointerEvents = '';
        };

        const newTab = window.open('about:blank', '_blank');
        const center = getSearchCenter();
        const lat = center.lat;
        const lng = center.lng;
        const stationQuery = `[out:json][timeout:10];node["railway"="station"]["station"!="cable_car"]["station"!="funicular"]["station"!="monorail"](around:10000,${lat},${lng});out body;`;
        let stationName;
        try {
            const res = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: stationQuery });
            const data = await res.json();
            if (!data.elements || data.elements.length === 0) { restore(); return alert('近くに駅が見つかりませんでした（10km圏内）'); }
            const nearest = data.elements
                .map(el => ({ ...el, dist: (el.lat - lat) ** 2 + (el.lon - lng) ** 2 }))
                .sort((a, b) => a.dist - b.dist)[0];
            stationName = (nearest.tags['name:ja'] || nearest.tags.name || '').replace(/駅$/, '');

            if (duplicateStationNames.has(stationName)) {
                const prefQuery = `[out:json][timeout:10];is_in(${nearest.lat},${nearest.lon})->.a;area.a["admin_level"="4"]["name"];out tags;`;
                const prefRes = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: prefQuery });
                const prefData = await prefRes.json();
                const prefName = prefData.elements && prefData.elements[0] ? prefData.elements[0].tags.name : null;
                if (prefName) stationName = `${stationName} (${prefName})`;
            }
        } catch (e) {
            newTab.close();
            restore();
            return alert('駅情報の取得に失敗しました');
        }
        restore();
        if (!stationName) { newTab.close(); return alert('駅名が取得できませんでした'); }
        const dp_ymd = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }).replace(/-/g, '');
        const hotelRadius = storeGet('hotelRadius') || '10000';
        const hotelSort = storeGet('hotelSort') || '2';
        const url = `https://www.tour.ne.jp/j_hotel/list/?landmark=${encodeURIComponent(stationName)}&refpage=form#adult=1&dp_ymd=${dp_ymd}&dsp_sort=${hotelSort}&hotel_type=3,6,7,8,11,12,13,15&radius=${hotelRadius}&roomtype=1,2,3,5,7,8,10,11`;
        newTab.location.href = url;
    }
    function execNearbySearch() {
        if (nearbyState.cats.length === 0) return alert('カテゴリが選択されていません');
        if (nearbyState.cats.includes('hotel')) return execHotelSearch();

        const center = getSearchCenter();
        const searchLat = center.lat;
        const searchLng = center.lng;
        
        if (!nearbyState.cats.includes('spot')) {
            const keyword = nearbyState.cats.map(c => gmapKeywords[c]).filter(Boolean).join(' OR ');
            const zoom = Math.round(map.getZoom());
            return window.open(`https://www.google.com/maps/search/${encodeURIComponent(keyword)}/@${searchLat},${searchLng},${zoom}z`, '_blank');
        }

        const RADIUS = 100;
        nearbyAllResults = searchIndex
            .filter(objShownOnMap)     // 種別・部門のOFFは検索と同じ扱い
            .map(item => ({...item, dist: calcDist(searchLat, searchLng, item.coords[1], item.coords[0])}))
            .filter(item => item.dist <= RADIUS)
            .sort((a, b) => a.dist - b.dist);

        /* 近い順の起点は検索した時点で固定する。地図を動かしても取り直さない
           （取り直すと100km圏の切り出しごと変わり、並べ直しでは済まなくなるため）。
           検索ピンだったのか地図の中心だったのかも、控えた時点でしか分からないのでここで持つ。 */
        nearbyState.center = { lat: searchLat, lng: searchLng };
        nearbyState.centerPinned = !!searchPinLngLat;

        /* 集計帯に出す種別。圏内に1件も無い種別も0件で並べるので、いつも PREF_TYPES と同じ6種。
           保存済みのOFFはそのまま効かせる（全部OFFのまま保存されていれば一覧は空になる）。 */
        nearbyResultTypes = PREF_TYPES.map(t => t.type);
        const savedOff = loadNearbyFilterOff();
        nearbyTypeFilter = new Set(nearbyResultTypes.filter(t => !savedOff.has(t)));

        // 絞り込みの語は検索のたびに空へ戻す（県ページが別の県を開いたときと同じ扱い）
        nearbyState.q = '';
        document.getElementById('nearby-item-search').value = '';
        setSearchClearVisible('nearby-item-search', '');

        closeNearby();
        // どこからの距離なのかは起点帯（renderDistOrigin）が出すので、ここは距離の条件だけ
        document.getElementById('nearby-result-title').textContent = `${RADIUS}km以内`;
        renderNearbySum();
        renderDistOrigin('nearby');
        nearbyResultScrollTop = 0;
        renderNearbyList();
        document.getElementById('nearby-result-panel').style.bottom = '52px';   /* 下部バーの上（--sheet-base と同値） */
        document.getElementById('nearby-result-overlay').style.display = 'block';
    }

    /* 集計帯。県ページ（renderPrefSum）と同じ作りにするが、3点だけ扱いが違う。
       ・圏内に1件も無い種別も0件で並べる（数字だけ淡くする＝.pref-sum-v.zero）。
         何が無いのかも見えるようにするためで、種別が1〜2種の県ばかりだと帯が
         間延びするのも防げる（.pref-sum-line は space-between）
       ・タップがそのまま表示・非表示。県ページはタップで種別の先頭へ飛ぶが、それは
         東京都2,496件のような長い一覧のための操作で、常に近い順のここでは飛び先に意味が無い
       ・食べログの長押し（ジャンル行）は割り当てない。部門の絞り込みは設定側だけ */
    function renderNearbySum() {
        const cnt = {};
        for (const it of nearbyAllResults) cnt[it.type] = (cnt[it.type] || 0) + 1;
        const el = document.getElementById('nearby-sum');
        el.innerHTML = `<div class="pref-sum-line">` + nearbyResultTypes.map(t => {
            const n = cnt[t] || 0;
            return `<div class="pref-sum-item${nearbyTypeFilter.has(t) ? '' : ' off'}" data-t="${t}">`
                 + `${prefTypeIconHtml(t)}<div class="pref-sum-v${n ? '' : ' zero'}">${n.toLocaleString()}</div></div>`;
        }).join('') + `</div>`;
        // 長押しは渡さない（bindTypeToggle はタッチとマウスの二重反応よけのために通す）
        el.querySelectorAll('.pref-sum-item').forEach(item =>
            bindTypeToggle(item, () => toggleNearbyTypeFilter(item.dataset.t)));
        updateNearbyAllBtn();
    }

    function toggleNearbyTypeFilter(type) {
        if (nearbyTypeFilter.has(type)) {
            nearbyTypeFilter.delete(type);
        } else {
            nearbyTypeFilter.add(type);
        }
        saveNearbyFilterOff();
        renderNearbySum();
        renderNearbyList();
    }

    // 全選択/全解除ボタン：全ONなら「全解除」、それ以外は「全選択」として動作
    function updateNearbyAllBtn() {
        const allOn = nearbyResultTypes.every(t => nearbyTypeFilter.has(t));
        document.getElementById('nearby-filter-all-btn').textContent = allOn ? '全解除' : '全選択';
    }

    function toggleAllNearbyTypeFilter() {
        const allOn = nearbyResultTypes.every(t => nearbyTypeFilter.has(t));
        nearbyTypeFilter = allOn ? new Set() : new Set(nearbyResultTypes);
        saveNearbyFilterOff();
        renderNearbySum();
        renderNearbyList();
    }

    // 一覧の絞り込み。照合は searchIndex が持つ正規化済みの名前・住所を使う（県ページと同じ）
    function onNearbySearchInput(v) {
        nearbyState.q = v;
        setSearchClearVisible('nearby-item-search', v);
        renderNearbyList();
    }
    function clearNearbySearch() {
        const el = document.getElementById('nearby-item-search');
        el.value = '';
        onNearbySearchInput('');
        el.focus();
    }

    /* 一度に描く件数の上限。県ページ（PREF_ITEM_CHUNK＝1,000件）より小さく取る。
       県ページは県を選んでから開く画面で、一覧が出るまでの間が1つ挟まっているのに対し、
       周辺検索はカテゴリを押した指の先で結果が開くため、待ちがそのまま重さとして出る。

       東京駅起点・100km圏の実データ5,334件で、同じ端末・同じページで3回ずつ測ると、
       一覧を描く時間は 300件で約32ms（31/30/36）、1,000件で約107ms（127/91/104）。
       押してから一覧が出るまでは 300件で40〜70ms（53/72/51/39）で、そのうち
       絞り込みと並べ替えは13ms。残りはほぼ一覧を描く時間なので、ここを削るのが効く。
       続きは末尾の「さらに表示」で継ぎ足すので、打ち切っても辿れなくなるものは無い。 */
    const NEARBY_ITEM_CHUNK = 300;

    /* 一覧。行の作りは県ページ（renderPrefItems）に合わせる。並べ替えは近い順だけなので、
       距離は検索した時点で確定済みの item.dist をそのまま使い、測り直さない。
       keepShown を立てて呼ぶと継ぎ足した分（nearbyState.shown）を保つ。「さらに表示」と、
       オブジェクトから戻ったときの描き直しがこれに当たる。 */
    function renderNearbyList(keepShown) {
        const list = document.getElementById('nearby-list');
        if (!keepShown) nearbyState.shown = NEARBY_ITEM_CHUNK;
        const q = normalizeForSearch((nearbyState.q || '').trim());
        const rows = [];
        for (const item of nearbyAllResults) {
            if (!nearbyTypeFilter.has(item.type)) continue;
            if (q && !(item._normLabel || '').includes(q)
                  && !(item._normSub || '').includes(q)) continue;
            // 絞り込み中は、検索結果と同じく「店名以外のどこで当たったか」を添える
            rows.push({ item, part: (q && item.type === 'shop') ? shopMatchedPart(item.properties, q) : null });
        }
        nearbyState.rows = rows;
        if (rows.length === 0) {
            list.innerHTML = `<div class="lords-note">${
                q ? '該当する項目がありません' : '表示する種別が選ばれていません'}</div>`;
            return;
        }
        const shown = Math.min(rows.length, nearbyState.shown || NEARBY_ITEM_CHUNK);
        nearbyState.shown = shown;
        list.innerHTML = rows.slice(0, shown).map((r, i) => {
            const item = r.item;
            const distStr = item.dist < 1 ? `${Math.round(item.dist * 1000)}m` : `${item.dist.toFixed(1)}km`;
            return `<div class="nearby-item" onclick="nearbyJumpToItem(${i})">
                ${favStripeHtml(item.type, item.properties, item.coords)}
                ${prefTypeIconHtml(item.type, item.properties || {})}
                <div class="nearby-item-text">
                    <div class="nearby-item-name">${attrEscape(itemDisplayName(item))}</div>
                    <div class="nearby-item-sub">${matchNoteHtml(null, r.part)}${attrEscape(item.sub || '')}</div>
                </div>
                ${prefBadgesHtml(item)}
                <div class="nearby-item-dist">${distStr}</div>
            </div>`;
        }).join('');
        // 末尾。打ち切っているときは、いま出ている件数と全件数を並べて「さらに表示」を添える
        list.insertAdjacentHTML('beforeend', shown < rows.length
            ? `<div class="lords-note">${shown.toLocaleString()}件を表示中（全${
                rows.length.toLocaleString()}件）<button class="pref-more" onclick="showMoreNearbyItems()"
                >さらに${Math.min(NEARBY_ITEM_CHUNK, rows.length - shown).toLocaleString()}件</button></div>`
            : `<div class="lords-note">全${rows.length.toLocaleString()}件</div>`);
        // 通常は先頭から。オブジェクトを開いて戻ったときと「さらに表示」のときだけ、控えた位置へ
        // （全件を入れ終えてから指定しないと、スクロールできる高さが足りずに切り詰められる）
        list.scrollTop = nearbyResultScrollTop || 0;
        nearbyResultScrollTop = 0;
    }

    /* 「さらに表示」。いま出ている続きから見えるよう、スクロール位置は動かさない。 */
    function showMoreNearbyItems() {
        nearbyResultScrollTop = document.getElementById('nearby-list').scrollTop;
        nearbyState.shown = (nearbyState.shown || NEARBY_ITEM_CHUNK) + NEARBY_ITEM_CHUNK;
        renderNearbyList(true);
    }

    /* 結果一覧からオブジェクトへ飛ぶ。県ページ（prefJumpToItem）と同じ扱いにして、
       離れる前に一覧の位置を控え、情報シートに戻り導線を挿す。 */
    function nearbyJumpToItem(i) {
        const r = (nearbyState.rows || [])[i];
        if (!r) return;
        nearbyResultScrollTop = document.getElementById('nearby-list').scrollTop;
        saveListReturnCamera();
        closeNearbyResult();
        onResultClick(r.item);
        // onResultClick は 300ms 後に情報シートを開くので、その後に戻り導線を挿す
        setTimeout(injectNearbyBackLink, 400);
    }

    // 周辺検索結果から来たときだけ、情報シートの先頭に戻り導線を挿す（都道府県から探すと同じ扱い）。
    // 別のピンをタップするとシート本文ごと作り直されるので、自然に消える。
    function injectNearbyBackLink() {
        const body = document.getElementById('obj-sheet-body');
        if (!body || body.querySelector('.os-lords-back')) return;
        const div = document.createElement('div');
        div.className = 'os-lords-back';
        div.textContent = '↩ 周辺検索結果へ戻る';
        div.onclick = () => { closeObjSheet(); restoreListReturnCamera(); reopenNearbyResult(); };
        body.insertBefore(div, body.firstChild);
    }

    /* 開く前の一覧の状態（継ぎ足した分・スクロール位置）のまま戻す。距離は検索した時点の
       起点で確定済みなので取り直さない（取り直すと、オブジェクトへ寄った先の地図中心が
       起点になって並びが変わる）。起点帯も同じ理由でそのまま。
       一覧のDOMは openNearbyPanel が空にすることがあるため、描き直してから位置を戻す
       （位置を戻すのは renderNearbyList の末尾）。 */
    function reopenNearbyResult() {
        if (!nearbyAllResults.length) return;
        renderNearbyList(true);
        document.getElementById('nearby-result-panel').style.bottom = '52px';
        document.getElementById('nearby-result-overlay').style.display = 'block';
    }

    function closeNearbyResult() {
        const panel = document.getElementById('nearby-result-panel');
        panel.style.transition = '';
        panel.style.bottom = '-100%';
        document.getElementById('nearby-result-overlay').style.display = 'none';
    }

    // 周辺検索結果パネルを下スワイプで閉じる（3ドロワー共通の実装）
    enableSheetSwipeClose(
        document.getElementById('nearby-result-panel'),
        document.getElementById('nearby-result-header'),
        closeNearbyResult
    );
    function closeNearby() {
        const panel = document.getElementById('nearby-panel');
        panel.style.transition = '';
        panel.style.bottom = '';
        panel.classList.remove('open');
        document.getElementById('nearby-overlay').classList.remove('open');
        document.getElementById('bottom-bar').classList.remove('panel-open');
        nearbyState.cats = [];
        closeWeatherHourlyPanel();
    }

    // メニュー／周辺検索パネルを下スワイプで閉じる（3ドロワー共通の実装）
    // 天気ウィジェットと時間別パネルは横スクロール操作を優先するため、スワイプ起点から除外する
    enableSheetSwipeClose(
        document.getElementById('nearby-panel'),
        document.getElementById('nearby-panel-header'),
        closeNearby,
        '#weather-widget, #weather-hourly-panel'
    );

    // 3ドロワーの縦スクロール領域をまとめて監視する（内容の増減でスクロール可否が変わるため）
    watchScrollerTouchAction('#nearby-panel-scroll, #settings-scroll, .lords-scroll, #nearby-list, #obj-sheet-body');

    // レイヤー一時非表示ボタンの処理
    const toggleLayersBtn = document.getElementById('toggle-layers-btn');
    const layerIdPrefixes = ['michi', 'shops', 'manholes', 'mhcards', 'castles', 'castles-famous'];
    const targetLayerIds = layerIdPrefixes.flatMap(prefix => [
        `${prefix}-cluster-shadow`,
        `${prefix}-cluster`,
        `${prefix}-cluster-count`,
        `${prefix}-shadow`,
        `${prefix}-bg`,
        `${prefix}-icon`,
        `${prefix}-icon-overlay`,
        `${prefix}-label`
    ]);

    let originalVisibilities = new Map();

    const hideOwnLayers = () => {
        originalVisibilities.clear();
        /* お気に入りの重ね描きも一緒に消す（残ると「スポットを消したのに何か出ている」状態になる）。
           そのレイヤーIDは地図の読み込み後に決まるので、押された時点で足す。 */
        for (const layerId of targetLayerIds.concat(FAV_MAP_LAYERS)) {
            if (map.getLayer(layerId)) {
                const currentVisibility = map.getLayoutProperty(layerId, 'visibility') || 'visible';
                originalVisibilities.set(layerId, currentVisibility);
                if (currentVisibility === 'visible') {
                    map.setLayoutProperty(layerId, 'visibility', 'none');
                }
            }
        }
    };

    const restoreOwnLayers = () => {
        if (originalVisibilities.size === 0) return;
        for (const [layerId, visibility] of originalVisibilities.entries()) {
            if (map.getLayer(layerId)) {
                map.setLayoutProperty(layerId, 'visibility', visibility);
            }
        }
        originalVisibilities.clear();
    };

    toggleLayersBtn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        toggleLayersBtn.setPointerCapture(e.pointerId);
        toggleLayersBtn.classList.add('pressed');
        hideOwnLayers();
    });
    const onPointerRelease = () => {
        toggleLayersBtn.classList.remove('pressed');
        requestAnimationFrame(restoreOwnLayers);
    };
    ['pointerup', 'pointercancel'].forEach(event => {
        toggleLayersBtn.addEventListener(event, onPointerRelease);
    });


    function weatherModelFromDays(days) {
        return { days: days || [], hourlyByDay: [[], [], []], dayDates: jstDates3() };
    }
    function closeWeatherHourlyPanel() {
        selectedWeatherDayIndex = null;
        if (weatherCache) renderWeatherDays(weatherCache);
    }
    function toggleWeatherHourly(dayIndex) {
        selectedWeatherDayIndex = (selectedWeatherDayIndex === dayIndex) ? null : dayIndex;
        if (weatherCache) renderWeatherDays(weatherCache);
    }
    function renderWeatherHourly(model) {
        const panel = document.getElementById('weather-hourly-panel');
        if (!panel) return;
        const days = model.days || [];
        const hourlyByDay = model.hourlyByDay || [[], [], []];
        if (selectedWeatherDayIndex == null || !days[selectedWeatherDayIndex]) {
            panel.classList.remove('open');
            panel.innerHTML = '';
            return;
        }
        const slots = hourlyByDay[selectedWeatherDayIndex] || [];
        if (!slots.length) {
            // 3時間毎データ無し（気象庁フォールバック等でカードは非ボタン化済み）→ 選択を解除して閉じる
            selectedWeatherDayIndex = null;
            panel.classList.remove('open');
            panel.innerHTML = '';
            return;
        }
        const popColor = (p) => p >= 70 ? '#0D47A1' : p >= 50 ? '#1976D2' : p >= 30 ? '#42A5F5' : '#9aa6b2';
        const dropSvg = (c) => 'data:image/svg+xml;utf8,' + encodeURIComponent(
            "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path fill='" + c + "' d='M12 2.5C12 2.5 5 11 5 15.5a7 7 0 0 0 14 0C19 11 12 2.5 12 2.5z'/></svg>");
        panel.classList.add('open');
        panel.innerHTML = `
            <div class="weather-hourly-strip">
                ${slots.map(slot => {
                    const col = WMO_COLOR[slot.icon] || '#607D8B';
                    const url = `weather-icons/stamp/${slot.icon}.png`;
                    const temp = (slot.temp !== null && slot.temp !== undefined && !isNaN(slot.temp)) ? Math.round(slot.temp) + '°' : '--';
                    const popRaw = (slot.pop !== null && slot.pop !== undefined && !isNaN(slot.pop)) ? slot.pop : slot.dayPop;
                    const hasPop = (popRaw !== null && popRaw !== undefined && !isNaN(popRaw));
                    const pop = hasPop ? Math.round(popRaw) : null;
                    const pc = hasPop ? popColor(pop) : '#bbb';
                    const hasPrecip = (slot.precip !== null && slot.precip !== undefined && !isNaN(slot.precip));
                    const precipNum = hasPrecip ? (slot.precip >= 10 ? Math.round(slot.precip) : Math.round(slot.precip * 10) / 10) : null;
                    const precipColor = hasPrecip && slot.precip >= 1 ? popColor(100) : '';
                    return `
                    <div class="weather-hourly-card">
                        <div class="weather-hourly-time">${slot.label}</div>
                        <div class="weather-hourly-main">
                            <span class="weather-emoji" style="-webkit-mask-image:url('${url}');mask-image:url('${url}');background-color:${col}"></span>
                            <div class="weather-hourly-temp">${temp}</div>
                        </div>
                        <div class="weather-pop-row">${hasPop ? `<img class="weather-pop-drop" src="${dropSvg(pc)}" alt="">` : ''}<span class="weather-pop-num" style="color:${pc}">${hasPop ? `<span style="font-weight:${pop >= 50 ? '700' : '600'}">${pop}</span><span>%</span>` : '--'}</span>${hasPrecip ? `<span class="weather-precip-num" style="${precipColor ? 'color:' + precipColor : ''}"><span style="font-size:${slot.precip >= 1 ? '10px' : '9px'};font-weight:${slot.precip >= 1 ? '700' : '400'}">${precipNum}</span><span>mm</span></span>` : ''}</div>
                    </div>`;
                }).join('')}
            </div>`;
    }
    // 正規化した3日分 [{icon, hi, lo}] を描画
    function renderWeatherDays(model) {
        const widget = document.getElementById('weather-widget');
        if (!widget) return;
        if (Array.isArray(model)) model = weatherModelFromDays(model);
        const days = model.days || [];
        const labels = ['今日', '明日', '明後日'];
        // 最高気温の文字色: 30度以下=赤 / 31〜34度=濃い赤 / 35度以上=紫
        const hiTempColor = (t) => t >= 35 ? '#7B1FA2' : t >= 31 ? '#B71C1C' : '#E53935';
        // 降水確率の文字色: 〜30%=灰寄り / 30〜50%=水色 / 50〜70%=青 / 70%〜=濃青
        const popColor = (p) => p >= 70 ? '#0D47A1' : p >= 50 ? '#1976D2' : p >= 30 ? '#42A5F5' : '#9aa6b2';
        const dropSvg = (c) => 'data:image/svg+xml;utf8,' + encodeURIComponent(
            "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path fill='" + c + "' d='M12 2.5C12 2.5 5 11 5 15.5a7 7 0 0 0 14 0C19 11 12 2.5 12 2.5z'/></svg>");
        widget.innerHTML = labels.map((lbl, i) => {
            const d = days[i] || { icon: 'cloudy', hi: null, lo: null, pop: null };
            const ic = d.icon || 'cloudy';
            const col = WMO_COLOR[ic] || '#607D8B';
            const url = `weather-icons/stamp/${ic}.png`;
            const hasHi = (d.hi !== null && d.hi !== undefined && !isNaN(d.hi));
            const hasLo = (d.lo !== null && d.lo !== undefined && !isNaN(d.lo));
            const hi = hasHi ? Math.round(d.hi) : null;
            const lo = hasLo ? Math.round(d.lo) : null;
            const hiCol = hasHi ? hiTempColor(hi) : '#e05000';
            const hasPop = (d.pop !== null && d.pop !== undefined && !isNaN(d.pop));
            const pop = hasPop ? Math.round(d.pop) : null;
            const pc = hasPop ? popColor(pop) : '#bbb';
            // 降水量合計（3時間毎パネルと同じ書式・色ルール）
            const hasPrecip = (d.precip !== null && d.precip !== undefined && !isNaN(d.precip));
            const precipNum = hasPrecip ? (d.precip >= 10 ? Math.round(d.precip) : Math.round(d.precip * 10) / 10) : null;
            const precipColor = hasPrecip && d.precip >= 1 ? popColor(100) : '';
            // 降水量が3桁(100mm以上)の時は水滴アイコンを省略して幅を確保（カード幅は最大86px固定のため）
            const showDrop = hasPop && !(hasPrecip && d.precip >= 100);
            const popRow = `<div class="weather-pop-row">${showDrop ? `<img class="weather-pop-drop" src="${dropSvg(pc)}" alt="">` : ''}<span class="weather-pop-num" style="color:${pc}">${hasPop ? `<span style="font-weight:${pop >= 50 ? '700' : '600'}">${pop}</span><span>%</span>` : '--'}</span>${hasPrecip ? `<span class="weather-precip-num" style="${precipColor ? 'color:' + precipColor : ''}"><span style="font-size:${d.precip >= 1 ? '10px' : '9px'};font-weight:${d.precip >= 1 ? '700' : '400'}">${precipNum}</span><span>mm</span></span>` : ''}</div>`;
            // 3時間毎データがある日だけ開閉ボタンにする（気象庁フォールバック時は日毎のみ）
            const canOpen = !!(model.hourlyByDay && model.hourlyByDay[i] && model.hourlyByDay[i].length);
            const activeClass = canOpen && selectedWeatherDayIndex === i ? ' weather-day-active' : '';
            const inner = `
                <div class="weather-day-label">${lbl}</div>
                <div class="weather-icon-temp">
                    <span class="weather-emoji" style="-webkit-mask-image:url('${url}');mask-image:url('${url}');background-color:${col}"></span>
                    <div class="weather-temp-col">
                        <span class="weather-temp-hi" style="color:${hiCol}">${hasHi ? hi + '°' : '--'}</span>
                        <span class="weather-temp-lo">${hasLo ? lo + '°' : '--'}</span>
                    </div>
                </div>
                ${popRow}`;
            if (!canOpen) return `<div class="weather-day-card">${inner}</div>`;
            return `
            <button type="button" class="weather-day-card${activeClass}" onclick="toggleWeatherHourly(${i})" aria-pressed="${selectedWeatherDayIndex === i ? 'true' : 'false'}" aria-label="${lbl}の3時間ごとの天気を表示">${inner}</button>`;
        }).join('');
        renderWeatherHourly(model);
    }

    // 現在時刻（JST）の「時」
    function jstHourNow() {
        const now = new Date();
        const jst = new Date(now.getTime() + now.getTimezoneOffset() * 60000 + 9 * 3600000);
        return jst.getHours();
    }
    // 時間別カテゴリ（晴/曇/雨/雪/雷）— JMA定義: 雲量8割まで晴れ(=コード0,1,2), 3とfogは曇
    function wmoCategory(c) {
        if (c === 95 || c === 96 || c === 99) return 'thunder';
        if (c === 71 || c === 73 || c === 75 || c === 77 || c === 85 || c === 86) return 'snow';
        if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82)) return 'rain';
        if (c === 3 || c === 45 || c === 48) return 'cloud';
        return 'sun'; // 0,1,2
    }
    // 時間別配列 [{code,pop}] → 単一の代表アイコン名（案A: 1日1アイコン）
    // ルール: 雨/雪/雷は弱くても優先表示（降水確率≥30% か 降水コマ≥3 か 過半数が降水）。
    //   過半数条件は3時間スロット（3コマ）でも降水を拾うため。それ以外は晴/曇を多数決。
    function pickWeatherIcon(hours) {
        if (!hours.length) return 'cloudy';
        const cats = hours.map(x => wmoCategory(x.code));
        const cnt = (k) => cats.filter(x => x === k).length;
        const rainN = cnt('rain'), snowN = cnt('snow'), thunN = cnt('thunder');
        const precipN = rainN + snowN + thunN, sunN = cnt('sun'), cloudN = cnt('cloud');
        const maxPop = hours.reduce((m, x) => Math.max(m, x.pop || 0), 0);
        if (precipN > 0 && (maxPop >= 30 || precipN >= 3 || precipN * 2 >= hours.length)) {
            const kind = (thunN >= rainN && thunN >= snowN) ? 'thunder' : (snowN > rainN ? 'snow' : 'rain');
            const sunnyMix = sunN >= precipN; // 晴れ主体に一時的な降水
            if (kind === 'thunder') return 'thunderstorms-day-rain';
            if (kind === 'snow') return sunnyMix ? 'partly-cloudy-day-snow' : 'snow';
            return sunnyMix ? 'partly-cloudy-day-rain' : 'rain';
        }
        if (sunN >= cloudN) {
            const code2 = hours.filter(x => x.code === 2).length; // 晴れ時々曇が多めなら partly
            return (code2 > sunN * 0.5) ? 'partly-cloudy-day' : 'clear-day';
        }
        const fog = hours.filter(x => x.code === 45 || x.code === 48).length;
        return (fog > cloudN * 0.5) ? 'fog' : 'overcast-day';
    }
    // Open-Meteo 応答（hourly+daily, models=jma_seamless,best_match）→ 正規化3日
    // 天気アイコン: 時間別 weather_code(jma_seamless) を日ごとに集約。
    //   集約窓は3時間毎パネルに表示するスロットと同一（今日 = 現在の3時間スロット〜23時／
    //   明日・明後日 = 終日）。窓を揃えることで日毎バッジとパネルの矛盾を防ぐ。
    // 降水確率: 同じ窓で best_match の時間別 precipitation_probability の最大。
    // 気温: 日次の最高/最低（jma_seamless優先）。
    function openMeteoToWeatherModel(data) {
        const h = data.hourly || {}, dy = data.daily || {};
        const times = h.time || [];
        const wcJma = h.weather_code_jma_seamless || [];
        const wcBest = h.weather_code_best_match || [];
        const wcBase = h.weather_code || [];
        const ppJma = h.precipitation_probability_jma_seamless || [];
        const ppBest = h.precipitation_probability_best_match || [];
        const ppBase = h.precipitation_probability || [];
        const precJma = h.precipitation_jma_seamless || [];
        const precBest = h.precipitation_best_match || [];
        const precBase = h.precipitation || [];
        const precSum = dy.precipitation_sum_jma_seamless || dy.precipitation_sum_best_match || dy.precipitation_sum || [];
        const thJma = h.temperature_2m_jma_seamless || [];
        const thBest = h.temperature_2m_best_match || [];
        const thBase = h.temperature_2m || [];
        const tmax = dy.temperature_2m_max_jma_seamless || dy.temperature_2m_max_best_match || dy.temperature_2m_max || [];
        const tmin = dy.temperature_2m_min_jma_seamless || dy.temperature_2m_min_best_match || dy.temperature_2m_min || [];
        const dailyDates = dy.time || [];
        const nowH = jstHourNow();
        const current3hStart = Math.floor(nowH / 3) * 3;
        const pickFirstValue = (i, ...arrays) => {
            for (const arr of arrays) {
                if (!arr || i >= arr.length) continue;
                const v = arr[i];
                if (v !== null && v !== undefined && v !== '') return v;
            }
            return null;
        };
        // hourly index を日付ごとにまとめる（先頭3日）
        const byDate = {}, order = [];
        times.forEach((t, i) => { const d = t.slice(0, 10); if (!byDate[d]) { byDate[d] = []; order.push(d); } byDate[d].push(i); });
        const dayDates = order.slice(0, 3);
        const days = [];
        const hourlyByDay = [];
        dayDates.forEach((d, di) => {
            const idx = byDate[d];
            // 日毎バッジの集約窓 = パネルに表示する3時間スロットが覆う時間帯
            //（今日 = 現在スロット以降／明日・明後日 = 終日）
            let win;
            if (di === 0) {
                win = idx.filter(i => { const hh = parseInt(times[i].slice(11, 13), 10); return hh >= current3hStart && hh <= 23; });
                if (!win.length) win = idx.slice(-1); // 夜遅く等で残りが無ければ最後の時間
            } else {
                win = idx;
            }
            const hours = win.map(i => ({
                code: pickFirstValue(i, wcJma, wcBest, wcBase),
                pop: (pickFirstValue(i, ppJma, ppBest, ppBase) != null ? pickFirstValue(i, ppJma, ppBest, ppBase) : 0)
            }));
            const pop = hours.length ? hours.reduce((m, x) => Math.max(m, x.pop || 0), 0) : null;
            const precVals = win.map(i => pickFirstValue(i, precJma, precBest, precBase)).filter(v => v != null && !isNaN(v));
            let precip = precVals.length ? precVals.reduce((s, v) => s + v, 0) : null;
            if ((precip == null || (di > 0 && precVals.length < win.length)) && precSum[di] != null && !isNaN(precSum[di])) {
                precip = precSum[di];
            }
            let ti = dailyDates.indexOf(d); if (ti < 0) ti = di;
            // 気温: 今日のみ「現在時刻〜23時」の時間別から最高/最低（過ぎた時間を除外）。
            //       明日・明後日は日次の最高/最低（早朝の最低も含む真の値）。
            let hi, lo;
            if (di === 0) {
                const temps = win.map(i => pickFirstValue(i, thJma, thBest, thBase)).filter(v => v != null && !isNaN(v));
                hi = temps.length ? Math.max.apply(null, temps) : (tmax[ti] != null ? tmax[ti] : null);
                lo = temps.length ? Math.min.apply(null, temps) : (tmin[ti] != null ? tmin[ti] : null);
            } else {
                hi = (tmax[ti] != null ? tmax[ti] : null);
                lo = (tmin[ti] != null ? tmin[ti] : null);
            }
            days.push({ icon: pickWeatherIcon(hours), hi: hi, lo: lo, pop: pop, precip: precip });
            const hourlyIdx = idx.filter(i => {
                const hh = parseInt(times[i].slice(11, 13), 10);
                if (hh % 3 !== 0) return false;
                return di === 0 ? hh >= current3hStart : true;
            });
            hourlyByDay.push(hourlyIdx.map(i => {
                const slotHour = parseInt(times[i].slice(11, 13), 10);
                const slotIdx = idx.filter(j => {
                    const hh = parseInt(times[j].slice(11, 13), 10);
                    return hh >= slotHour && hh < slotHour + 3;
                });
                const slotHours = slotIdx.map(j => {
                    const slotPop = pickFirstValue(j, ppJma, ppBest, ppBase);
                    return {
                        code: pickFirstValue(j, wcJma, wcBest, wcBase),
                        pop: (slotPop != null && !isNaN(slotPop)) ? slotPop : 0
                    };
                });
                const popWindow = slotIdx
                    .map(j => pickFirstValue(j, ppJma, ppBest, ppBase))
                    .filter(v => v != null && !isNaN(v));
                const popAtHour = popWindow.length ? Math.max.apply(null, popWindow) : null;
                const precipWindow = slotIdx
                    .map(j => pickFirstValue(j, precJma, precBest, precBase))
                    .filter(v => v != null && !isNaN(v));
                const precipAtSlot = precipWindow.length ? precipWindow.reduce((s, v) => s + v, 0) : null;
                // 気温はスロット3時間窓内の最高値
                //（瞬間値だと日毎バッジの最高気温が全スロットより高く見えるため）
                const tempWindow = slotIdx
                    .map(j => pickFirstValue(j, thJma, thBest, thBase))
                    .filter(v => v != null && !isNaN(v));
                const tempAtSlot = tempWindow.length ? Math.max.apply(null, tempWindow) : null;
                const icon = pickWeatherIcon(slotHours);
                return {
                    label: String(slotHour),
                    icon: icon || 'cloudy',
                    temp: tempAtSlot,
                    pop: (popAtHour != null && !isNaN(popAtHour)) ? popAtHour : null,
                    precip: (precipAtSlot != null && !isNaN(precipAtSlot)) ? precipAtSlot : null,
                    dayPop: pop
                };
            }));
        });
        return { days: days, hourlyByDay: hourlyByDay, dayDates: dayDates };
    }

    // ── 気象庁(JMA)予報 ─────────────────────────────────────────────
    // 都道府県コード → 予報区(office)コード。複数officeの道県は緯度経度で最寄りを選択（代表点は近似）
    var JMA_MULTI_OFFICE = {
        '01': [['011000',45.41,141.67],['012000',43.77,142.36],['013000',43.90,144.10],['014030',42.92,143.20],['014100',42.98,144.38],['015000',42.51,141.30],['016000',43.06,141.35],['017000',41.77,140.73]],
        '46': [['460040',28.38,129.49],['460100',31.60,130.56]],
        '47': [['471000',26.21,127.68],['472000',25.83,131.23],['473000',24.80,125.28],['474000',24.34,124.16]],
    };
    // area.json（市区町村→細分区→予報区の階層）を1回だけ取得してキャッシュ
    var jmaAreaCache = null;
    async function getJmaArea() {
        if (jmaAreaCache !== null) return jmaAreaCache;
        try { jmaAreaCache = await (await fetch('https://www.jma.go.jp/bosai/common/const/area.json')).json(); }
        catch (e) { jmaAreaCache = false; }
        return jmaAreaCache;
    }
    // 緯度経度 → { office:予報区コード, class10:一次細分区コード }（国外はnull）
    async function latLngToJmaArea(lat, lng) {
        const res = await fetch(`https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?lat=${lat}&lon=${lng}`);
        const j = await res.json();
        const muni = j && j.results && j.results.muniCd;
        if (!muni) return null; // 日本国外など
        const m5 = String(muni).padStart(5, '0');
        // ① area.json階層で 市区町村→class10(一次細分区)→office を正確に特定
        const area = await getJmaArea();
        if (area && area.class20s && area.class15s && area.class10s) {
            let c20 = null;
            // 政令市の区はGSIが区コード、area.jsonは市コードのことがある。区番号の桁数が市で異なるため、
            // 「そのまま → 下1桁を0 → 下2桁を0」の順に、実在するclass20へ最初にヒットしたものを採用する
            const cands = [m5, m5.slice(0, 4) + '0', m5.slice(0, 3) + '00'];
            for (const cand of cands) {
                for (const k in area.class20s) { if (k.slice(0, 5) === cand) { c20 = k; break; } }
                if (c20) break;
            }
            if (c20) {
                const c15 = area.class20s[c20].parent;
                const c10 = c15 && area.class15s[c15] ? area.class15s[c15].parent : null;
                const office = c10 && area.class10s[c10] ? area.class10s[c10].parent : null;
                if (c10 && office) return { office, class10: c10 };
            }
        }
        // ② フォールバック: 都道府県→office（複数区は座標で最寄り）, class10なし（先頭区域を使用）
        const pref = m5.slice(0, 2);
        const multi = JMA_MULTI_OFFICE[pref];
        let office = pref + '0000';
        if (multi) { let bd = Infinity; for (const [code, clat, clng] of multi) { const dd = (clat - lat) ** 2 + (clng - lng) ** 2; if (dd < bd) { bd = dd; office = code; } } }
        return { office, class10: null };
    }
    // 気象庁の天気文＋コードから自前アイコン名へ
    function jmaIcon(text, code) {
        const t = text || '';
        const has = s => t.indexOf(s) >= 0;
        const sun = has('晴');
        if (has('雷')) return 'thunderstorms-day-rain';
        if (has('雪')) return sun ? 'partly-cloudy-day-snow' : 'snow';
        if (has('雨')) return sun ? 'partly-cloudy-day-rain' : 'rain';
        if (has('霧')) return 'fog';
        if (has('くもり') || has('曇')) return sun ? 'cloudy' : 'overcast-day';
        if (sun) return 'clear-day';
        const c = parseInt(code, 10); // フォールバック: コード先頭桁
        if (c >= 400) return 'snow';
        if (c >= 300) return 'rain';
        if (c >= 200) return 'overcast-day';
        if (c >= 100) return 'clear-day';
        return 'cloudy';
    }
    // 今日/明日/明後日の日付（JST, YYYY-MM-DD）
    function jstDates3() {
        const now = new Date();
        const jst = new Date(now.getTime() + now.getTimezoneOffset() * 60000 + 9 * 3600000);
        const out = [];
        for (let i = 0; i < 3; i++) {
            const d = new Date(jst.getTime() + i * 86400000);
            out.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'));
        }
        return out;
    }
    async function fetchJmaDays(office, class10) {
        const data = await (await fetch(`https://www.jma.go.jp/bosai/forecast/data/forecast/${office}.json`)).json();
        // 天気（短期 ts0）: 基準点の一次細分区(class10)に一致する区域を選択。無ければ先頭
        const ts0 = data[0].timeSeries[0];
        let wIdx = 0;
        if (class10) { const i = ts0.areas.findIndex(a => a.area && a.area.code === class10); if (i >= 0) wIdx = i; }
        const a0 = ts0.areas[wIdx];
        const wByDate = {};
        ts0.timeDefines.forEach((td, i) => { wByDate[td.slice(0, 10)] = { code: a0.weatherCodes[i], text: a0.weathers ? a0.weathers[i] : '' }; });
        // 気温（短期 ts2 ＋ 週間 wk1 を日付ごとに集約し min/max）
        const tByDate = {};
        const push = (date, v) => { if (v === '' || v == null) return; const n = parseFloat(v); if (!isNaN(n)) (tByDate[date] = tByDate[date] || []).push(n); };
        const ts2 = data[0].timeSeries[2];
        // 気温地点: 天気区域と並びが一致する県は同index、合わなければ先頭
        const tArea = (ts2 && ts2.areas) ? (ts2.areas.length === ts0.areas.length ? ts2.areas[wIdx] : ts2.areas[0]) : null;
        if (tArea && tArea.temps) ts2.timeDefines.forEach((td, i) => push(td.slice(0, 10), tArea.temps[i]));
        const wk1 = data[1] && data[1].timeSeries[1];
        if (wk1 && wk1.areas[0]) { const wa = wk1.areas[0]; wk1.timeDefines.forEach((td, i) => { push(td.slice(0, 10), wa.tempsMax && wa.tempsMax[i]); push(td.slice(0, 10), wa.tempsMin && wa.tempsMin[i]); }); }
        // 降水確率（① その日の最大）: ts1(6時間毎, 天気と同じ区域) → 日毎max。ts0に無い明後日等は週間popsで補完
        const popByDate = {};
        const ts1 = data[0].timeSeries[1];
        if (ts1 && ts1.areas) {
            const pArea = ts1.areas.length === ts0.areas.length ? ts1.areas[wIdx] : ts1.areas[0];
            if (pArea && pArea.pops) ts1.timeDefines.forEach((td, i) => {
                const v = pArea.pops[i]; if (v === '' || v == null) return;
                const n = parseInt(v, 10); if (isNaN(n)) return;
                const dt = td.slice(0, 10);
                popByDate[dt] = (popByDate[dt] == null) ? n : Math.max(popByDate[dt], n);
            });
        }
        const wkp = data[1] && data[1].timeSeries[0];
        if (wkp && wkp.areas) {
            let pa = class10 ? wkp.areas.find(a => a.area && a.area.code === class10) : null;
            if (!pa) pa = wkp.areas[0];
            if (pa && pa.pops) wkp.timeDefines.forEach((td, i) => {
                const dt = td.slice(0, 10);
                if (popByDate[dt] != null) return; // ts0優先
                const v = pa.pops[i]; if (v === '' || v == null) return;
                const n = parseInt(v, 10); if (!isNaN(n)) popByDate[dt] = n;
            });
        }
        return jstDates3().map(dt => {
            const w = wByDate[dt] || { code: '200', text: 'くもり' };
            const ts = tByDate[dt] || [];
            const hi = ts.length ? Math.max(...ts) : null;
            const lo = ts.length ? Math.min(...ts) : null;
            return { icon: jmaIcon(w.text, w.code), hi, lo, pop: (popByDate[dt] != null ? popByDate[dt] : null) };
        });
    }

    // 周辺パネルが開いている時だけ天気を再取得（基準点が変わった時に呼ぶ）
    function refreshWeatherIfPanelOpen() {
        const panel = document.getElementById('nearby-panel');
        if (panel && panel.classList.contains('open')) fetchWeather();
    }

    async function fetchWeather() {
        const now = Date.now();
        const lngLat = getSearchCenter();
        // 約1km粒度に丸める（地図の微小な移動で再フェッチしないように。気象モデルの格子より十分細かい）
        const lat = lngLat.lat.toFixed(2);
        const lng = lngLat.lng.toFixed(2);
        if (weatherCache && now - weatherCacheTime < WEATHER_CACHE_TTL
            && weatherCacheLat === lat && weatherCacheLng === lng) {
            renderWeatherDays(weatherCache); return;
        }
        let days = null;
        // ① Open-Meteo（座標粒度）: 天気=時間別weather_code(jma_seamless)を日ごとに集約,
        //    降水確率=時間別(best_match。jma_seamlessは全時間nullを返すため実質未使用),
        //    気温=日次最高/最低(jma_seamless)
        try {
            const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&hourly=weather_code,precipitation_probability,precipitation,temperature_2m&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&models=jma_seamless,best_match&timezone=Asia%2FTokyo&forecast_days=3`;
            const data = await (await fetch(url)).json();
            days = openMeteoToWeatherModel(data);
        } catch (e) { console.warn('[weather:openmeteo]', e); }
        // ② フォールバック: 気象庁公式予報（Open-Meteo失敗時）
        if (!days) {
            try {
                const area = await latLngToJmaArea(lngLat.lat, lngLat.lng);
                if (area && area.office) days = weatherModelFromDays(await fetchJmaDays(area.office, area.class10));
            } catch (e) { console.warn('[weather:jma]', e); }
        }
        if (!days) return;
        weatherCache = days; weatherCacheTime = now; weatherCacheLat = lat; weatherCacheLng = lng;
        renderWeatherDays(days);
    }

    /* ══ お気に入り ═══════════════════════════════════════════════════════
       枠は4つ。枠に固定の意味は持たせず、名前は設定でユーザーが付ける
       （初期値は枠1の「お気に入り」だけで、残り3枠は空。名前を入れた枠だけを使う）。
       1つのオブジェクトを複数の枠に入れられる。
       見せかたは3か所で、案は mock/fav-badge-preview.html で比べて決めてある。
         地図   … ピンの右上に15pxのバッジ（案1・4色）。マークしたものは全種別のピンより
                  前面に出し、枠どうしは番号の小さい方を前にする
         一覧   … 行の左端に5pxの色帯（案1）。複数の枠に入っていれば縦に等分する
         シート … 上端の縁の色ライン（案ii）
       登録は情報シートの★→パレット（案B）と、お気に入り一覧の行の長押し。
       保存は localStorage の 'favorites' 1本で、キーの選びかたは
       mock/fav-list-preview.html の「5. 保存の形」に全データの実測値が残っている。
       サーバーへ移すときは loadFavStore / saveFavStore の中身だけを差し替える。 */
    const FAV_SLOTS = [1, 2, 3, 4];
    // 色は CSS の :root（--fav1〜4）が持ち主。地図のピンはCSSを通らないのでここで読んでおく
    // （--ui-blue を UI_BLUE に写しているのと同じ扱い）
    const FAV_COLORS = (() => {
        const cs = getComputedStyle(document.documentElement);
        const fallback = { 1: '#E91E63', 2: '#7B1FA2', 3: '#00897B', 4: '#7CB342' };
        const o = {};
        FAV_SLOTS.forEach(n => { o[n] = cs.getPropertyValue(`--fav${n}`).trim() || fallback[n]; });
        return o;
    })();
    // #7CB342 だけ白文字のコントラストが 2.50 しか出ないので、その上に載せる文字は黒にする
    const FAV_FG = { 1: '#fff', 2: '#fff', 3: '#fff', 4: '#212121' };
    const FAV_NAME_MAX = 6;        // 理由は .favname-row のコメント（一覧のチップが2段に収まる上限）
    const FAV_STORE_KEY = 'favorites';
    const FAV_TYPE_FILTER = { shop: 'shop', pokefuta: 'pokefuta', manhole: 'manhole',
                              mhcard: 'mhcard', michi: 'michi', castle: 'castle' };

    /* オブジェクトを1つに定めるキー。実データを数えて種別ごとに選んである（2026-08-19）。
         食べログ 7,369件 … url が欠落0・重複0
         道の駅   1,234件 … 公式の駅ID が欠落0・重複0
         ポケふた   482件 … 公式の連番 が欠落0・重複0
         マンホール 1,267件 … cardCodeKey(cardId) が欠落0・重複0
         カード配布 1,455件 … cardId は欠落562・残りも44種（A001だけで324件）なので使えない。
                              名前＠座標4桁なら衝突0
         お城   23,516件 … url は欠落19,037（81%）。「松本城」だけで5件あり名前単独も不可。
                            名前＠座標4桁なら衝突0
       座標を4桁（約11m）に丸めるのは、データ更新で末尾が1桁動いただけで
       別のオブジェクトになってしまうのを避けるため。
       castle.js を作り直して座標が11m以上動いた城は、マークが外れる（残る弱点）。 */
    function favCoordKey(lng, lat) {
        return `${Number(lng).toFixed(4)},${Number(lat).toFixed(4)}`;
    }
    function favKeyOf(type, p, lng, lat) {
        p = p || {};
        if (lng == null || lat == null || !isFinite(lng) || !isFinite(lat)) return null;
        const nameKey = `${p.name || ''}@${favCoordKey(lng, lat)}`;
        // ポケふたは地図から開くと type='manhole'＋source='pokefuta'、一覧から開くと
        // type='pokefuta' で来る。どちらでも同じキーになるようにする
        if (type === 'pokefuta' || (type === 'manhole' && p.source === 'pokefuta')) {
            return p.id != null && p.id !== '' ? `pokefuta:${p.id}` : `pokefuta:${nameKey}`;
        }
        if (type === 'shop')   return p.url ? `shop:${p.url}` : `shop:${nameKey}`;
        if (type === 'michi')  return p.id != null && p.id !== '' ? `michi:${p.id}` : `michi:${nameKey}`;
        if (type === 'manhole') { const k = cardCodeKey(p.cardId); return k ? `manhole:${k}` : `manhole:${nameKey}`; }
        if (type === 'mhcard') return `mhcard:${nameKey}`;
        if (type === 'castle') return `castle:${nameKey}`;
        return null;   // 地名（place）など、データを持たないものは対象外
    }

    /* 外した項目は消さずに mk が空の記録（墓標）として残す。
       消してしまうと、しばらくオフラインだった端末が古い一覧を送ってきたときに、
       他の端末で外したはずの印が復活する（SYNC_MANUAL.md §4.4）。
       見るほうは全て mk の中身で判断しているので、空の項目が混ざっても表示は変わらない。
       ずっと残すと際限なく増えるため、外してから半年たった墓標は読み込み時に捨てる。 */
    const FAV_TOMB_KEEP_MS = 180 * 24 * 60 * 60 * 1000;
    function favNormalizeMk(mk) {
        return [...new Set((Array.isArray(mk) ? mk : [])
            .map(Number).filter(n => FAV_SLOTS.includes(n)))].sort((a, b) => a - b);
    }
    /* 項目ごとに at の新しいほうを採って favStore へ重ねる。混ぜかたはサーバーから
       受け取るとき（favMergeFromServer）と、同じ端末の別の画面が書いた分を取り込むとき
       （favAbsorbStored）で同じにしてある。 */
    function favMergeItems(items) {
        for (const [k, v] of Object.entries(items || {})) {
            const at = Number(v && v.at) || 0;
            const cur = favStore.items[k];
            if (cur && (Number(cur.at) || 0) >= at) continue;
            favStore.items[k] = { mk: favNormalizeMk(v && v.mk), at };
        }
    }
    function loadFavStore() {
        let raw = storeGetJson(FAV_STORE_KEY);
        // 初期値は枠1だけ名前を入れておく（残り3枠は空＝使わない）
        const names = { 1: 'お気に入り', 2: '', 3: '', 4: '' };
        const items = {};
        if (raw && typeof raw === 'object') {
            if (raw.names && typeof raw.names === 'object') {
                FAV_SLOTS.forEach(n => { if (typeof raw.names[n] === 'string') names[n] = raw.names[n]; });
            }
            if (raw.items && typeof raw.items === 'object') {
                const tombLimit = Date.now() - FAV_TOMB_KEEP_MS;
                for (const [k, v] of Object.entries(raw.items)) {
                    const mk = favNormalizeMk(v && v.mk);
                    const at = Number(v && v.at) || 0;
                    if (mk.length) items[k] = { mk, at };
                    else if (at > tombLimit) items[k] = { mk: [], at };   // 墓標
                }
            }
        }
        return { v: 1, names, items };
    }
    let favStore = loadFavStore();
    /* 書く直前に、いま localStorage にある内容を取り込む。
       favStore は開いた時点の内容をメモリに持ち続けるのに対し、localStorage は
       同じ端末の別の画面と共有される。ホーム画面のアプリと、QRから開いたブラウザのタブが
       両方生きているのが普通なので、取り込まずに書くと、古いほうの画面が保存した瞬間に
       新しいほうで付けたお気に入りが丸ごと消える（再起動すると外れて見える症状になる）。
       枠の名前だけは時刻を持たず、いま入力している画面を正とするため取り込まない。 */
    function favAbsorbStored() {
        const disk = storeGetJson(FAV_STORE_KEY);
        if (disk && typeof disk === 'object' && disk.items && typeof disk.items === 'object') {
            favMergeItems(disk.items);
        }
    }
    // localStorage にだけ書く（サーバーへ送り返すかは呼び出し側が決める）
    function favWriteStore() {
        favAbsorbStored();
        try { localStorage.setItem(FAV_STORE_KEY, JSON.stringify(favStore)); }
        catch (e) { console.warn('[store]', FAV_STORE_KEY, e); }
    }
    function saveFavStore() {
        favAbsorbStored();
        storeSetJson(FAV_STORE_KEY, favStore);
    }
    function favNameOf(n) { return (favStore.names[n] || '').trim(); }
    // 名前が入っている枠だけが使える。空にした枠は出さないが、登録した分は消さない
    function favActiveSlots() { return FAV_SLOTS.filter(n => favNameOf(n) !== ''); }
    function favMarksOf(key) { const it = key ? favStore.items[key] : null; return it ? it.mk : []; }
    function favActiveMarksOf(key) {
        const a = favActiveSlots();
        return favMarksOf(key).filter(n => a.includes(n));
    }
    function favCountOf(n) {
        let c = 0;
        for (const k in favStore.items) if (favStore.items[k].mk.includes(n)) c++;
        return c;
    }

    /* 付け外し。at は最後に触った時刻で、お気に入り一覧の「追加順」がこれを見る。 */
    function favToggleMark(key, n) {
        if (!key || !FAV_SLOTS.includes(n)) return;
        const cur = new Set(favMarksOf(key));
        if (cur.has(n)) cur.delete(n); else cur.add(n);
        // 外したときも記録を残す（mk が空＝墓標。理由は loadFavStore のコメント）
        favStore.items[key] = { mk: [...cur].sort((a, b) => a - b), at: Date.now() };
        saveFavStore();
        refreshFavOverlay();
        updateSheetFav();
        updateFavNameCounts();
        updateFavEntry();
        const view = document.getElementById('nearby-fav-view');
        if (view && view.classList.contains('open')) {
            // 開いたまま外したときは、その行が消えて詰まる。スクロール位置は保つ
            favState.restoreScroll = document.getElementById('fav-item-list').scrollTop;
            renderFavKindChips();
            renderFavItems(true);
        }
    }

    /* まとめて外す。1件ずつ favToggleMark を呼ぶと、そのたびに localStorage への
       書き込みと一覧の作り直しが走る（1,000件選ぶと1,000回）ので、
       記録を全部書き換えてから保存と描き直しを1回だけ行う。
       外すのは渡した枠だけで、名前を空にした枠に入っている分は触らない
       （「空にした枠は出さないが、登録した分は消さない」という決まりに揃える）。
       外した項目を消さずに mk が空の記録（墓標）として残すのは favToggleMark と同じ。 */
    function favUnmarkKeys(keys, slots) {
        const at = Date.now();
        let n = 0;
        for (const key of new Set(keys)) {
            const cur = favMarksOf(key);
            const next = cur.filter(x => !slots.includes(x));
            if (next.length === cur.length) continue;
            favStore.items[key] = { mk: next, at };
            n++;
        }
        if (!n) return 0;
        saveFavStore();
        refreshFavOverlay();
        updateSheetFav();
        updateFavNameCounts();
        updateFavEntry();
        return n;
    }

    // 一覧の行の左端に立てる色帯。付いている枠の数だけ縦に等分する
    function favStripeHtml(type, p, coords) {
        const c = coords || [];
        const marks = favActiveMarksOf(favKeyOf(type, p, c[0], c[1]));
        if (!marks.length) return '';
        return `<span class="fav-stripe">${marks.map(n =>
            `<span style="background:${FAV_COLORS[n]}"></span>`).join('')}</span>`;
    }

    /* ══ 設定の「お気に入りの名前」 ══════════════════════════════════════ */
    function renderFavNameList() {
        const el = document.getElementById('fav-name-list');
        if (!el) return;
        el.innerHTML = FAV_SLOTS.map(n => `
            <div class="favname-row">
                <span class="favname-sw" style="background:${FAV_COLORS[n]};color:${FAV_FG[n]}">${n}</span>
                <input class="favname-in" type="text" maxlength="${FAV_NAME_MAX}"
                       value="${attrEscape(favNameOf(n))}" placeholder="お気に入り${n}（空欄なら使わない）"
                       oninput="onFavNameInput(${n}, this)">
                <span class="favname-cnt" data-fav-cnt="${n}">${favCountOf(n)}件</span>
            </div>`).join('');
    }
    function updateFavNameCounts() {
        document.querySelectorAll('[data-fav-cnt]').forEach(el => {
            el.textContent = `${favCountOf(Number(el.dataset.favCnt))}件`;
        });
    }
    function onFavNameInput(n, el) {
        // maxlength はUTF-16の長さなので、絵文字を1文字として数え直す
        const v = [...el.value].slice(0, FAV_NAME_MAX).join('');
        if (el.value !== v) el.value = v;
        favStore.names[n] = v.trim();
        saveFavStore();
        refreshFavOverlay();
        updateSheetFav();
        updateFavEntry();
        closeFavPalette();
    }

    /* ══ 情報シートのライン と ★→パレット ═══════════════════════════════ */
    function objSheetFavKey() {
        if (!objSheetCtx || !objSheetLngLat) return null;
        return favKeyOf(objSheetCtx.type, objSheetCtx.p, objSheetLngLat[0], objSheetLngLat[1]);
    }
    function updateSheetFav() {
        const sheet = document.getElementById('obj-sheet');
        const line = document.getElementById('obj-sheet-favline');
        const btn = document.getElementById('obj-fav-btn');
        if (!sheet || !line || !btn) return;
        const key = objSheetFavKey();
        const marks = favActiveMarksOf(key);
        sheet.classList.toggle('has-fav', marks.length > 0);
        line.innerHTML = marks.map(n => `<span style="background:${FAV_COLORS[n]}"></span>`).join('');
        // 使える枠が1つも無いとき（名前が全部空）と、キーを作れない対象では★を出さない
        btn.style.display = (key && favActiveSlots().length) ? '' : 'none';
        btn.style.color = marks.length ? FAV_COLORS[marks[0]] : '';
    }

    let favPopEl = null;
    let favPopClosedAt = 0;
    function onFavPaletteOutside(e) {
        if (favPopEl && !favPopEl.contains(e.target)) closeFavPalette();
    }
    function closeFavPalette() {
        if (!favPopEl) return;
        favPopEl.remove();
        favPopEl = null;
        favPopClosedAt = Date.now();
        document.removeEventListener('pointerdown', onFavPaletteOutside, true);
    }
    function renderFavPalette() {
        if (!favPopEl) return;
        const key = favPopEl.dataset.key;
        const marks = favActiveMarksOf(key);
        const slots = favActiveSlots();
        favPopEl.innerHTML = slots.length
            ? slots.map(n => `<button data-fav-n="${n}"><i style="background:${FAV_COLORS[n]}"></i>${
                attrEscape(favNameOf(n))}${marks.includes(n) ? '<span class="fav-ck">✓</span>' : ''}</button>`).join('')
            : `<div class="fav-pop-note">設定の「お気に入りの名前」に名前を入れると使えます</div>`;
    }
    /* パレットはアンカー（★の位置、または一覧の行）の下に出す。
       下に入り切らないときは上へ返す（シートは画面の下半分に出るため、通常は上に返る）。 */
    function openFavPalette(anchor, key) {
        closeFavPalette();
        if (!key || !anchor) return;
        const pop = document.createElement('div');
        pop.className = 'fav-pop';
        pop.dataset.key = key;
        favPopEl = pop;
        renderFavPalette();
        document.body.appendChild(pop);
        const r = anchor.getBoundingClientRect();
        const w = pop.offsetWidth, h = pop.offsetHeight;
        const left = Math.min(Math.max(6, r.right - w), window.innerWidth - w - 6);
        const below = r.bottom + 4;
        const top = (below + h > window.innerHeight - 6) ? Math.max(6, r.top - h - 4) : below;
        pop.style.left = `${Math.round(left)}px`;
        pop.style.top = `${Math.round(top)}px`;
        pop.addEventListener('click', e => {
            const b = e.target.closest('button[data-fav-n]');
            if (!b) return;
            favToggleMark(pop.dataset.key, Number(b.dataset.favN));
            renderFavPalette();   // 続けて別の枠も触れるよう、開いたままにする
        });
        // 開いた指の pointerdown で即閉じないよう、次のタスクから外側判定を始める
        setTimeout(() => document.addEventListener('pointerdown', onFavPaletteOutside, true), 0);
    }
    function onSheetFavBtn(e) {
        e.stopPropagation();
        if (favPopEl) { closeFavPalette(); return; }
        /* 開いているときに★を押すと、外側判定（pointerdown）が先に閉じてから
           この click が来る。そのまま開くと閉じられなくなるので、閉じた直後は開かない。 */
        if (Date.now() - favPopClosedAt < 300) return;
        openFavPalette(e.currentTarget, objSheetFavKey());
    }

    /* ══ お気に入り一覧ビュー ════════════════════════════════════════════ */
    let favState = { q: '', kind: 'all', sort: 'at', rows: [], center: null, centerPinned: false,
                     scrollTop: 0, restoreScroll: 0,
                     selecting: false, sel: new Set() };   // 選択モードと、選んだ行のキー

    function updateFavEntry() {
        const btn = document.getElementById('fav-entry-btn');
        if (!btn) return;
        btn.disabled = favActiveSlots().length === 0;   // 登録先が1つも無ければ押せない
    }
    function showFavView() {
        setPanelLifted(true);
        document.getElementById('nearby-main-view').style.display = 'none';
        document.getElementById('nearby-settings-view').classList.remove('open');
        document.getElementById('nearby-fav-view').classList.add('open');
    }
    function closeFavView() {
        setPanelLifted(false);
        favState.selecting = false;      // 開き直したときに選んだ状態を持ち越さない
        favState.sel.clear();
        renderFavSelBar();
        document.getElementById('nearby-fav-view').classList.remove('open');
        document.getElementById('nearby-main-view').style.display = '';
    }
    function openFavView(restoreView) {
        if (!favActiveSlots().length) return;
        favState.selecting = false;
        favState.sel.clear();
        // 近い順の起点は開いた時点で固定する（県ページ・城主一覧と同じ扱い）
        if (!restoreView || !favState.center) {
            const c = getSearchCenter();
            favState.center = { lat: c.lat, lng: c.lng };
            favState.centerPinned = !!searchPinLngLat;
        }
        if (!restoreView) {
            favState.q = '';
            const input = document.getElementById('fav-item-search');
            if (input) input.value = '';
            setSearchClearVisible('fav-item-search', '');
        }
        // 名前を消した枠が選ばれたままにならないようにする
        if (favState.kind !== 'all' && !favActiveSlots().includes(Number(favState.kind))) favState.kind = 'all';
        favState.restoreScroll = restoreView ? (favState.scrollTop || 0) : 0;
        showFavView();
        renderFavKindChips();
        renderDistOrigin('fav');
        renderFavItems(restoreView);
    }

    /* 一覧に出す行。searchIndex（到着済みデータ）から、マークが付いていて表示中のものを拾う。
       設定で消した種別・食べログの部門はここでも出さない（設定が土台という決まりに揃える）。 */
    function favCollect(ignoreObjFilter) {
        const rows = [];
        const active = favActiveSlots();
        if (!active.length || !Object.keys(favStore.items).length) return rows;
        const center = favState.center || getSearchCenter();
        for (const item of searchIndex) {
            // 書き出しだけは設定を素通りできる。登録した地点が黙って落ちるのを避けるため
            if (!ignoreObjFilter) {
                const fk = FAV_TYPE_FILTER[item.type];
                if (fk && filterState[fk] === false) continue;
                if (item.type === 'shop' && !genreVisible(shopGenreBase((item.properties || {}).category))) continue;
            }
            const c = item.coords || [];
            const key = favKeyOf(item.type, item.properties, c[0], c[1]);
            const rec = key ? favStore.items[key] : null;
            if (!rec) continue;
            const mk = rec.mk.filter(n => active.includes(n));
            if (!mk.length) continue;
            rows.push({ item, key, mk, at: rec.at || 0,
                        dist: calcDist(center.lat, center.lng, c[1], c[0]) });
        }
        return rows;
    }
    function favDateText(at) {
        if (!at) return '';
        const d = new Date(at);
        return `${d.getMonth() + 1}/${d.getDate()}`;
    }
    function renderFavKindChips() {
        const el = document.getElementById('fav-kind-chips');
        if (!el) return;
        const rows = favCollect();
        el.innerHTML = `<button class="lords-chip" data-fk="all" aria-pressed="${
                favState.kind === 'all'}" onclick="setFavKind('all')">すべて ${rows.length}</button>`
            + favActiveSlots().map(n => `<button class="lords-chip fav-kind" data-fk="${n}"
                aria-pressed="${String(favState.kind) === String(n)}" onclick="setFavKind(${n})"
                ><span class="fav-dot" style="background:${FAV_COLORS[n]}"></span>${
                attrEscape(favNameOf(n))} ${rows.filter(r => r.mk.includes(n)).length}</button>`).join('');
    }
    function setFavKind(k) { favState.kind = k; renderFavKindChips(); renderFavItems(); }
    function setFavSort(s) {
        favState.sort = s;
        document.querySelectorAll('#nearby-fav-view .lords-chip[data-fs]').forEach(b => {
            b.setAttribute('aria-pressed', String(b.dataset.fs === s));
        });
        renderFavItems();
    }
    function onFavSearchInput(v) {
        favState.q = v;
        setSearchClearVisible('fav-item-search', v);
        renderFavItems();
    }
    function clearFavSearch() {
        const el = document.getElementById('fav-item-search');
        el.value = '';
        onFavSearchInput('');
        el.focus();
    }
    /* 一覧の行のタップと長押し。指が動いたらタップとして扱わない。
       設定の種別や県ページの集計帯で使っている bindTypeToggle は、送らない帯の上に置く前提で
       移動を見ていないため、縦に送る一覧でそのまま使うと、送っただけで飛んでしまう。 */
    function bindFavRow(el, onTap, onLongPress) {
        let timer = null, fired = false, moved = false, touched = false, sx = 0, sy = 0;
        const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
        const start = (x, y) => {
            fired = false; moved = false; sx = x; sy = y;
            timer = setTimeout(() => { timer = null; fired = true; onLongPress(); }, 500);
        };
        const move = (x, y) => {
            if (Math.abs(x - sx) > 8 || Math.abs(y - sy) > 8) { moved = true; cancel(); }
        };
        const end = () => { cancel(); if (fired || moved) { fired = false; return; } onTap(); };
        el.addEventListener('touchstart', e => { const t = e.touches[0]; start(t.clientX, t.clientY); }, { passive: true });
        el.addEventListener('touchmove', e => { const t = e.touches[0]; move(t.clientX, t.clientY); }, { passive: true });
        el.addEventListener('touchcancel', () => { cancel(); moved = true; });
        // タッチのあとに合成されるマウスイベントで二重に反応しないよう、直後の mouse は捨てる
        el.addEventListener('touchend', () => { touched = true; setTimeout(() => { touched = false; }, 600); end(); });
        el.addEventListener('mousedown', e => { if (e.button === 0 && !touched) start(e.clientX, e.clientY); });
        el.addEventListener('mousemove', e => { if (timer) move(e.clientX, e.clientY); });
        el.addEventListener('mouseup', e => { if (e.button === 0 && !touched) end(); });
        el.addEventListener('mouseleave', cancel);
        el.addEventListener('contextmenu', e => e.preventDefault());   // 長押しのメニューを出さない
    }
    /* 枠のチップと検索語の絞り込み。一覧と書き出しが同じ結果になるよう1か所に置く
       （書き出しは「いま見えている一覧をそのまま出す」という約束で作ってある）。 */
    function favApplyChipFilter(rows) {
        const q = normalizeForSearch((favState.q || '').trim());
        if (favState.kind !== 'all') rows = rows.filter(r => r.mk.includes(Number(favState.kind)));
        if (q) rows = rows.filter(r => (r.item._normLabel || '').includes(q)
                                    || (r.item._normSub || '').includes(q));
        return rows;
    }
    /* 並べ替えチップの選択で並べる。一覧と書き出しが同じ順序になるよう1か所に置く
       （書き出しは「いま見えている一覧をそのまま出す」という約束で作ってある）。
       「オブジェクト表示」を素通りさせた行も dist / at を持っているので、
       書き出し専用に増えた行だけ順序から外れることはない。 */
    const FAV_SORT_LABEL = { at: '追加順', dist: '近い順', type: '種別順', name: '名前順' };
    function favSortRows(rows) {
        const byName = (a, b) => itemDisplayName(a.item).localeCompare(itemDisplayName(b.item), 'ja');
        if (favState.sort === 'dist') rows.sort((a, b) => a.dist - b.dist);
        else if (favState.sort === 'name') rows.sort(byName);
        else if (favState.sort === 'type') {
            const order = PREF_TYPES.map(t => t.type);
            rows.sort((a, b) => order.indexOf(a.item.type) - order.indexOf(b.item.type)
                || castleGenreRank(a.item.properties || {}) - castleGenreRank(b.item.properties || {})
                || byName(a, b));
        } else rows.sort((a, b) => b.at - a.at || byName(a, b));   // 追加順は新しいものが上
        return rows;
    }
    /* ══ 選択モード（まとめて外す） ══════════════════════════════════════
       1件ずつなら情報シートの★と行の長押しで足りるが、旅程を1つ終えたあとの
       後始末のように、まとまった件数を外す手立てが無かったので足した。
       外す相手は「いま見えている一覧」に揃える（書き出しと同じ約束）。
         ・枠のチップが「すべて」なら、選んだ項目を名前の入っている枠すべてから外す
         ・枠のチップで1つ選んでいるなら、その枠からだけ外す（他の枠の分は残る）
         ・設定の「オブジェクト表示」で消している種別は一覧に出ないので、対象にもならない
       一括解除は専用のボタンを増やさず、「すべて選択」→「解除」の2手で行う。
       取り消せない操作の確認は、同期の端末外しと同じ confirm。 */
    function toggleFavSelectMode() { setFavSelectMode(!favState.selecting); }
    function setFavSelectMode(on) {
        favState.selecting = !!on;
        favState.sel.clear();
        closeFavPalette();
        const list = document.getElementById('fav-item-list');
        favState.restoreScroll = list ? list.scrollTop : 0;   // 入る・出るで一覧は動かさない
        renderFavItems(true);
    }
    // 外す枠。チップが「すべて」なら名前の入っている枠すべて
    function favUnmarkSlots() {
        return favState.kind === 'all' ? favActiveSlots() : [Number(favState.kind)];
    }
    function favUnmarkWhere() {
        const slots = favUnmarkSlots();
        return slots.length === 1 ? `「${favNameOf(slots[0])}」` : 'すべての枠';
    }
    function renderFavSelBar() {
        const view = document.getElementById('nearby-fav-view');
        if (!view) return;
        view.classList.toggle('selecting', favState.selecting);
        const btn = document.getElementById('fav-select-btn');
        if (btn) btn.classList.toggle('on', favState.selecting);
        // 書き出しは一覧の絞り込みが対象で、選んだ分ではない。取り違えないよう選択中は隠す
        const exp = document.getElementById('fav-export-btn');
        if (exp) exp.style.display = favState.selecting ? 'none' : '';
        const title = document.getElementById('fav-head-title');
        if (title) title.textContent = favState.selecting ? `${favState.sel.size}件を選択` : 'お気に入り';
        const rows = favState.rows || [];
        const allOn = rows.length > 0 && rows.every(r => favState.sel.has(r.key));
        const all = document.getElementById('fav-selall-btn');
        if (all) { all.textContent = allOn ? '選択を解除' : 'すべて選択'; all.disabled = rows.length === 0; }
        const del = document.getElementById('fav-seldel-btn');
        if (del) {
            del.disabled = favState.sel.size === 0;
            del.textContent = favState.sel.size
                ? `${favState.sel.size}件を${favUnmarkWhere()}から外す` : '解除';
        }
    }
    function favToggleSel(i) {
        const r = (favState.rows || [])[i];
        if (!r) return;
        const on = !favState.sel.has(r.key);
        if (on) favState.sel.add(r.key); else favState.sel.delete(r.key);
        /* 同じキーの行が2つ出ることは無い想定だが（キーの衝突は実測0）、
           出たときに片方だけ塗り残さないよう、キーで引いて塗り直す */
        document.querySelectorAll('#fav-item-list .nearby-item[data-fav-i]').forEach(el => {
            const r2 = favState.rows[Number(el.dataset.favI)];
            if (r2 && r2.key === r.key) el.classList.toggle('fav-on', on);
        });
        renderFavSelBar();
    }
    function favSelectAllToggle() {
        const rows = favState.rows || [];
        const allOn = rows.length > 0 && rows.every(r => favState.sel.has(r.key));
        favState.sel = new Set(allOn ? [] : rows.map(r => r.key));
        favState.restoreScroll = document.getElementById('fav-item-list').scrollTop;
        renderFavItems(true);
    }
    function favUnmarkSelected() {
        const keys = [...favState.sel];
        if (!keys.length) return;
        if (!confirm(`選んだ${keys.length}件を${favUnmarkWhere()}から外します。\n\n`
            + '地図・一覧・情報シートの印が消えます。戻すには1件ずつ付け直すことになります。')) return;
        const n = favUnmarkKeys(keys, favUnmarkSlots());
        renderFavKindChips();                 // 件数が減った分をチップに出す（一覧は触らない）
        setFavSelectMode(false);              // 選択モードを出るところで一覧を描き直す
        showToast(`${n.toLocaleString()}件のお気に入りを外しました`);
    }

    function renderFavItems(keepScroll) {
        const list = document.getElementById('fav-item-list');
        if (!list) return;
        const q = normalizeForSearch((favState.q || '').trim());
        const rows = favSortRows(favApplyChipFilter(favCollect()));
        favState.rows = rows;
        // 選ぶのは「いま見えている行」だけ。絞り込みや解除で消えた行の選択は残さない
        if (favState.sel.size) {
            const visible = new Set(rows.map(r => r.key));
            favState.sel.forEach(k => { if (!visible.has(k)) favState.sel.delete(k); });
        }
        if (!rows.length) {
            list.innerHTML = (q || favState.kind !== 'all')
                ? '<div class="lords-note">該当する項目がありません</div>'
                : `<div class="fav-empty"><b>★</b>まだ登録がありません。<br>
                    ピンや一覧から開いた情報シートの★を押すと、ここに集まります。</div>`;
            renderFavSelBar();
            return;
        }
        list.innerHTML = rows.map((r, i) => {
            const item = r.item;
            const distStr = r.dist < 1 ? `${Math.round(r.dist * 1000)}m` : `${r.dist.toFixed(1)}km`;
            const on = favState.selecting && favState.sel.has(r.key);
            return `<div class="nearby-item${on ? ' fav-on' : ''}" data-fav-i="${i}">
                ${favStripeHtml(item.type, item.properties, item.coords)}
                ${prefTypeIconHtml(item.type, item.properties || {})}
                <div class="nearby-item-text">
                    <div class="nearby-item-name">${attrEscape(itemDisplayName(item))}</div>
                    <div class="nearby-item-sub">${attrEscape(item.sub || '')}</div>
                </div>
                ${prefBadgesHtml(item)}
                ${favState.sort === 'at' ? `<div class="fav-added">${favDateText(r.at)}</div>`
                                         : `<div class="nearby-item-dist">${distStr}</div>`}
                ${favState.selecting ? '<span class="fav-selck">✓</span>' : ''}
            </div>`;
        }).join('') + `<div class="lords-note">全${rows.length.toLocaleString()}件<br>
            ${favState.selecting ? '行をタップで選び、下のボタンでまとめて外します'
                                 : '行を長押しすると、この場で付け替え・取り消しができます'}</div>`;
        list.querySelectorAll('.nearby-item[data-fav-i]').forEach(el => {
            const i = Number(el.dataset.favI);
            if (favState.selecting) {
                // 選択中はタップで選ぶ。長押しも同じ扱いにして、押し続けても何も起きない状態にしない
                bindFavRow(el, () => favToggleSel(i), () => favToggleSel(i));
            } else {
                bindFavRow(el, () => favJumpToItem(i), () => {
                    const r = favState.rows[i];
                    if (r) openFavPalette(el, r.key);
                });
            }
        });
        renderFavSelBar();
        // 全件を入れ終えてから位置を指定する（先に指定すると高さが足りずに切り詰められる）
        list.scrollTop = keepScroll ? (favState.restoreScroll || 0) : 0;
        favState.restoreScroll = 0;
    }
    /* 一覧からオブジェクトへ飛ぶ。県ページ（prefJumpToItem）と同じ順序に揃える。 */
    function favJumpToItem(i) {
        const r = (favState.rows || [])[i];
        if (!r) return;
        favState.scrollTop = document.getElementById('fav-item-list').scrollTop;
        saveListReturnCamera();
        closeNearby();
        onResultClick(r.item);
        setTimeout(injectFavBackLink, 400);   // onResultClick は300ms後にシートを開く
    }
    function injectFavBackLink() {
        const body = document.getElementById('obj-sheet-body');
        if (!body || body.querySelector('.os-lords-back')) return;
        const div = document.createElement('div');
        div.className = 'os-lords-back';
        div.textContent = '↩ 「お気に入り」の一覧に戻る';
        div.onclick = () => { closeObjSheet(); restoreListReturnCamera(); openNearbyPanel(); openFavView(true); };
        body.insertBefore(div, body.firstChild);
    }

    /* ══ お気に入りの書き出し ═════════════════════════════════════════════
       TravelPlan の入力ファイル仕様（sample/input-format.md 版1.5）の TSV を作る。
       仕様が必須とするのは name / lat / lng の3列だけで、任意列は address / note / id。
       address は版1.4（2026-08-25）で正式な任意列になった。住所はこの列だけに入れ、
       note へは混ぜない（§3.2。理由は favExportNote に書いた）。
       版1.1 で role / stay / day / priority が削除された（「ファイルはその場所の属性だけを
       持ち、旅程の都合はアプリ上で操作する」という設計原則が入ったため）ので、
       出発地・滞在時間・優先度はここでは一切作らない。
       形式は TSV だけにしてある。仕様は CSV と JSON も受けるが、選ばせる意味が無い。 */
    let favExportState = { allTypes: true, extraCols: true };

    // 6つのデータファイルは直列で届く。全部揃う前に出すと、その種別の登録が黙って落ちる
    const FAV_EXPORT_DATA_KEYS = ['shops', 'pokefuta', 'manhole', 'mhcard', 'michi', 'castle'];
    function favExportDataReady() {
        return FAV_EXPORT_DATA_KEYS.every(k => loadedData[k]);
    }

    /* 出す行。一覧の絞り込み（枠・検索語）はそのまま効かせ、
       設定の「オブジェクト表示」だけトグルで素通りできる。 */
    function favExportRows() {
        const seen = new Set();
        const rows = [];
        for (const r of favApplyChipFilter(favCollect(favExportState.allTypes))) {
            // id は仕様上ファイル内で一意（重複は読み込みエラーになる）。実データでは
            // 全35,323件で重複0を確認しているが、データ更新で崩れても壊さないよう畳んでおく
            if (seen.has(r.key)) continue;
            seen.add(r.key);
            rows.push(r);
        }
        // 一覧の並べ替えチップと同じ順序で出す（近い順で見ていたら近い順のまま出る）
        return favSortRows(rows);
    }

    /* TSV は1セルにタブと改行を置けない（仕様 §2 の制約）。
       実データでは全35,323件で混入0を確認済みだが、データ更新で入ってきても
       行がずれないよう空白へ潰しておく。 */
    function favTsvCell(s) {
        return String(s == null ? '' : s).replace(/[\t\r\n]+/g, ' ').trim();
    }
    /* note 列。種別の呼び名（「お城」「マンホール蓋」）だけを入れる。
       住所は address 列（favExportAddress）へ出すので、ここへは混ぜない。仕様 §3.2 が
       「住所を note に混ぜて出力しないでください。note は自由記述で、アプリは中身を
       住所として解釈しません」と定めている。混ぜると受け側は note をそのまま出すため、
       TravelPlan の計画表の2列目が「お城 / 千葉県千葉市中央区亥鼻一丁目」になる。
       address 列が入る前は住所の置き場が note しか無かったので足していた。
       e2c441c で列を足したとき、この足し込みを外し忘れていた。 */
    function favExportNote(item) {
        return (typeConfig[item.type] || {}).label || '';
    }
    /* address 列。情報シートの住所の行（buildSheetHtml の osKv('住所', …)）に出るものと
       同じ文字列を入れる。properties.address をそのまま出せば揃うが、2種別だけ違う。
         マンホール蓋 … シートで「住所」と呼んでいるのは紐付いたカード配布場所の住所で、
                        蓋自身の住所は「設置」の行にある（同じチップが2つ並ぶのを避けた呼び分け）。
                        入れるのは蓋自身の address。実測1,257件すべてで配布場所とは別の場所を
                        指しており（距離の中央値586m・最大22.4km）、カード側を入れると
                        同じ行の lat/lng と食い違う。
         配布終了のカード … シートに住所の行が出ない（配布場所が無いため問合せ先と発行日だけ）。
                        address には「恵庭市 (B001)」のように市町村＋カードIDが入っていて
                        住所ではないので、6件とも空にする。 */
    function favExportAddress(item) {
        const p = item.properties || {};
        if (item.type === 'mhcard' && p.discontinued) return '';
        return p.address || '';
    }
    function favExportTsv(rows) {
        const extra = favExportState.extraCols;
        const head = extra ? ['name', 'lat', 'lng', 'address', 'note', 'id'] : ['name', 'lat', 'lng'];
        const lines = [head.join('\t')];
        for (const r of rows) {
            const c = r.item.coords || [];
            // 座標は仕様 §4.3 の推奨（小数5桁＝約1.1m）に揃える。生の桁数はまちまちで、
            // 食べログのように14桁あるものは仕様が「不要」としている
            const cells = [favTsvCell(itemDisplayName(r.item)),
                           Number(c[1]).toFixed(5), Number(c[0]).toFixed(5)];
            if (extra) cells.push(favTsvCell(favExportAddress(r.item)),
                                  favTsvCell(favExportNote(r.item)), favTsvCell(r.key));
            lines.push(cells.join('\t'));
        }
        return lines.join('\n') + '\n';
    }

    /* ファイル名は枠の名前だけにする（日付は付けない）。仕様 §1.1 が
       「リストを資産として蓄積し、旅程はその都度アプリ上で組む」と定めたので、
       同じリストは同じ名前で上書きしていくほうが噛み合う。 */
    function favExportFilename() {
        const base = favState.kind === 'all'
            ? 'お気に入り' : (favNameOf(Number(favState.kind)) || 'お気に入り');
        return (base.replace(/[\\/:*?"<>|]/g, '').trim() || 'お気に入り') + '.tsv';
    }

    function showFavExportView() {
        setPanelLifted(true);
        document.getElementById('nearby-main-view').style.display = 'none';
        document.getElementById('nearby-fav-view').classList.remove('open');
        document.getElementById('nearby-fav-export-view').classList.add('open');
    }
    function openFavExportView() {
        // 戻ったときに同じ位置へ返す（一覧の行から飛ぶときと同じ扱い）
        const list = document.getElementById('fav-item-list');
        if (list) favState.scrollTop = list.scrollTop;
        showFavExportView();
        renderFavExport();
    }
    function closeFavExportView() {
        document.getElementById('nearby-fav-export-view').classList.remove('open');
        // 書き出しを開いている間に枠の名前を全部消すと、戻る先が無くなる
        if (!favActiveSlots().length) {
            setPanelLifted(false);
            document.getElementById('nearby-main-view').style.display = '';
            return;
        }
        openFavView(true);
    }
    function toggleFavExportAllTypes() {
        favExportState.allTypes = !favExportState.allTypes;
        renderFavExport();
    }
    function toggleFavExportExtra() {
        favExportState.extraCols = !favExportState.extraCols;
        renderFavExport();
    }

    function renderFavExport() {
        const view = document.getElementById('nearby-fav-export-view');
        if (!view || !view.classList.contains('open')) return;
        const scope = document.getElementById('fxp-scope');
        const n = favState.kind === 'all' ? null : Number(favState.kind);
        const rows = favExportRows();
        const ready = favExportDataReady();
        scope.innerHTML = n
            ? `<span class="fxp-dot" style="background:${FAV_COLORS[n]}"></span>${attrEscape(favNameOf(n))}`
            : 'すべての枠';
        scope.innerHTML += `<span class="fxp-rt">${rows.length.toLocaleString()}件</span>`;
        for (const [id, on] of [['fxp-sw-alltypes', favExportState.allTypes],
                                ['fxp-sw-extra', favExportState.extraCols]]) {
            const sw = document.getElementById(id);
            sw.classList.toggle('on', on);
            sw.setAttribute('aria-checked', String(on));
        }
        document.getElementById('fxp-filename').innerHTML =
            `${attrEscape(favExportFilename())}<span class="fxp-rt">TSV</span>`;
        const q = (favState.q || '').trim();
        document.getElementById('fxp-count').innerHTML = !ready
            ? 'データを読み込み中です。<br>全部そろってから書き出してください'
            : `${rows.length.toLocaleString()}行（ヘッダ行を除く）・${
                favExportState.extraCols ? 6 : 3}列・${
                FAV_SORT_LABEL[favState.sort] || '追加順'}${
                q ? `<br>「${attrEscape(q)}」で絞り込んだ結果です` : ''}`;
        const off = !ready || !rows.length;
        document.getElementById('fxp-save').disabled = off;
        document.getElementById('fxp-copy').disabled = off;
    }

    function favExportSave() {
        const rows = favExportRows();
        if (!rows.length || !favExportDataReady()) return;
        const name = favExportFilename();
        const blob = new Blob([favExportTsv(rows)],
            { type: 'text/tab-separated-values;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        /* iOS はホーム画面から起動した状態（standalone）だと、この保存が黙って
           何も起こさないことがある。そのときのために、すぐ下のコピーを案内しておく。 */
        showToast(isIosStandalonePwa()
            ? `${name} を保存しました。何も起きないときは「本文をコピー」を使ってください`
            : `${name} を保存しました`);
    }

    async function favExportCopy() {
        const rows = favExportRows();
        if (!rows.length || !favExportDataReady()) return;
        const ok = await copyToClipboard(favExportTsv(rows));
        showToast(ok ? `${rows.length.toLocaleString()}件をコピーしました`
                     : 'コピーできませんでした');
    }

    /* ══ 地図の重ね描き ═══════════════════════════════════════════════════
       マークしたオブジェクトを専用ソースへ写し、全種別のピンより上のレイヤーで描き直す。
       「最前面」も「枠1がいちばん上」もレイヤーの前後でしか決められない
       （1つのレイヤーの中の sort-key では種別をまたいだ前後が決まらない）ので、
       枠ごとにレイヤーの組を分け、番号の大きい枠から順に足してある。
       重ね描きなので元のピンはそのまま下に残る。クラスタに畳まれる倍率でも
       マークしたものだけは individual に出る（下のピンはクラスタの中にいる）。 */
    const FAV_PIN = {
        /* 寸法は地図のピン（OBJ_ICON_CIRCLE_PX 等）と同じ値。あちらは map.on('load') の
           中にあって外から読めないため、同じ値をここにも置く。変えるときは両方直すこと。 */
        shop:     { shape: 'circle', icon: 'tabe-icon',    size: 28 / 64 },
        castle:   { shape: 'circle', icon: 'castle-icon',  size: 28 / 64 },
        manhole:  { shape: 'circle', icon: 'manhole-icon', size: 25 / 64 },
        pokefuta: { shape: 'circle', icon: 'manhole-icon', size: 25 / 64 },
        michi:    { shape: 'michi',  icon: 'michi-icon',   size: 26 / 64 },
        mhcard:   { shape: 'card',   icon: 'mhcard-icon',  size: 1.0 },
    };
    let favOverlayItems = [];      // 重ね描きに出している要素（タップされたら添字で引く）
    const FAV_MAP_LAYERS = [];     // 作ったレイヤーID（スポット一時非表示が読む）
    const FAV_CLICK_LAYERS = [];   // そのうちタップ対象になるもの

    function buildFavOverlayData() {
        favOverlayItems = [];
        const feats = [];
        const active = favActiveSlots();
        if (active.length && Object.keys(favStore.items).length && searchIndex.length) {
            for (const item of searchIndex) {
                const pin = FAV_PIN[item.type];
                if (!pin) continue;
                const fk = FAV_TYPE_FILTER[item.type];
                if (fk && filterState[fk] === false) continue;
                if (item.type === 'shop' && !genreVisible(shopGenreBase((item.properties || {}).category))) continue;
                const c = item.coords || [];
                const key = favKeyOf(item.type, item.properties, c[0], c[1]);
                const rec = key ? favStore.items[key] : null;
                if (!rec) continue;
                const mk = rec.mk.filter(n => active.includes(n));
                if (!mk.length) continue;
                /* 属性に入れられるのは数値と文字列だけ（配列や入れ子は setData で
                   文字列になり、城の aliases のような値が壊れる）。シートに渡す properties は
                   favOverlayItems 側の元の要素から取る。 */
                feats.push({
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [c[0], c[1]] },
                    properties: {
                        _i: favOverlayItems.push(item) - 1,
                        _shape: pin.shape, _icon: pin.icon, _iconSize: pin.size,
                        _color: objRingColor(item.type, item.properties || {}),
                        _mk: mk[0],                       // 前後と印の色は番号の小さい枠に合わせる
                        _mkColor: FAV_COLORS[mk[0]],
                    },
                });
            }
        }
        return { type: 'FeatureCollection', features: feats };
    }
    function refreshFavOverlay() {
        if (typeof map === 'undefined' || !map || !map.getSource) return;
        const src = map.getSource('fav-objects');
        if (!src) return;
        src.setData(buildFavOverlayData());
    }
    /* お気に入りは全種別のピンより前面に描いているので、そこを踏んだタップは前面側に任せる。
       これが無いと後ろに隠れているピンのハンドラも動き、シートと履歴が二重になる。 */
    function favOverlayHit(point) {
        const layers = FAV_CLICK_LAYERS.filter(id => map.getLayer(id));
        return layers.length > 0 && map.queryRenderedFeatures(point, { layers }).length > 0;
    }

    function addFavOverlayLayers(o) {
        map.addSource('fav-objects', { type: 'geojson', data: EMPTY_FC });
        const add = (layer, clickable) => {
            map.addLayer(layer);
            FAV_MAP_LAYERS.push(layer.id);
            if (clickable) { FAV_CLICK_LAYERS.push(layer.id); objClickLayers.push(layer.id); }
        };
        const isShape = s => ['==', ['get', '_shape'], s];
        const overlap = { 'icon-allow-overlap': true, 'icon-ignore-placement': true };
        const shadowPaintSymbol = { 'icon-opacity': o.shadowOpacity,
            'icon-translate': o.shadowOffset, 'icon-translate-anchor': 'viewport' };
        /* 影は枠に関係なくまとめて最下段に置く。枠ごとに分けると、上の枠の影が
           下の枠のピンに乗って曇る（元のピンの影が2段構えで足されるのと同じ理由）。 */
        add({ id: 'fav-shadow-circle', type: 'circle', source: 'fav-objects', filter: isShape('circle'),
              paint: { 'circle-radius': o.shadowCircle.r, 'circle-color': '#000000',
                       'circle-blur': o.shadowCircle.blur, 'circle-opacity': o.shadowOpacity,
                       'circle-translate': o.shadowOffset, 'circle-translate-anchor': 'viewport' } });
        add({ id: 'fav-shadow-michi', type: 'symbol', source: 'fav-objects', filter: isShape('michi'),
              layout: { 'icon-image': 'michi-plate-shadow-icon', 'icon-size': 1.0, ...overlap },
              paint: shadowPaintSymbol });
        add({ id: 'fav-shadow-card', type: 'symbol', source: 'fav-objects', filter: isShape('card'),
              layout: { 'icon-image': 'mhcard-shadow-icon', 'icon-size': 1.0, ...overlap },
              paint: shadowPaintSymbol });
        // ピン本体。枠4→1の順に足して、番号の小さい枠を上にする
        [4, 3, 2, 1].forEach(n => {
            const mine = ['==', ['get', '_mk'], n];
            add({ id: `fav-bg-${n}`, type: 'circle', source: 'fav-objects',
                  filter: ['all', mine, isShape('circle')],
                  paint: { 'circle-color': ['get', '_color'], 'circle-radius': o.circleR } }, true);
            add({ id: `fav-plate-${n}`, type: 'symbol', source: 'fav-objects',
                  filter: ['all', mine, isShape('michi')],
                  layout: { 'icon-image': 'michi-plate-icon', 'icon-size': o.michiSize, ...overlap },
                  paint: { 'icon-color': ['get', '_color'] } }, true);
            add({ id: `fav-card-${n}`, type: 'symbol', source: 'fav-objects',
                  filter: ['all', mine, isShape('card')],
                  layout: { 'icon-image': 'mhcard-icon', 'icon-size': 1.0, ...overlap },
                  paint: { 'icon-color': o.cardFaceColor } }, true);
            // 図柄（白）。カードだけは図柄ではなくカードの外形そのものなので、蓋のバッジを重ねる
            add({ id: `fav-icon-${n}`, type: 'symbol', source: 'fav-objects',
                  filter: ['all', mine, ['!=', ['get', '_shape'], 'card']],
                  layout: { 'icon-image': ['get', '_icon'], 'icon-size': ['get', '_iconSize'], ...overlap },
                  paint: { 'icon-color': '#FFFFFF' } });
            add({ id: `fav-cardbadge-${n}`, type: 'symbol', source: 'fav-objects',
                  filter: ['all', mine, isShape('card')],
                  layout: { 'icon-image': 'manhole-icon', 'icon-size': o.cardBadgeSize, ...overlap },
                  paint: { 'icon-color': '#FFFFFF' } });
        });
        /* 印（15pxのバッジ）は全部の枠より上にまとめて置く。小さいので、
           隣のピンに少しでも隠れると読めなくなるため。ずらす向きは画面基準にして、
           コンパスで地図を回しても右上のままにする（影と同じ扱い）。
           外形が種別で違うので、右上の位置だけ形ごとに分ける。 */
        const badge = (id, shape, translate) => add({ id, type: 'circle', source: 'fav-objects',
            filter: isShape(shape),
            layout: { 'circle-sort-key': ['-', 5, ['get', '_mk']] },
            // 外径15px（色の面12px＋白フチ1.5px）。モックで比べたときと同じ寸法
            paint: { 'circle-radius': 6, 'circle-color': ['get', '_mkColor'],
                     'circle-stroke-width': 1.5, 'circle-stroke-color': '#FFFFFF',
                     'circle-translate': translate, 'circle-translate-anchor': 'viewport' } });
        /* ずらす量は、モックの「外形の右上角に、外へ5pxはみ出して置く」と同じ位置。
           外形の半分＋5px−バッジの半径7.5px で出している。 */
        badge('fav-badge-circle', 'circle', [11.5, -11.5]);   // φ28 の丸（14+5-7.5）
        badge('fav-badge-michi', 'michi', [10.5, -10.5]);     // 26px 角丸四角（13+5-7.5）
        badge('fav-badge-card', 'card', [11.5, -15.5]);       // 28×36 のカード（横14 / 縦18）
        /* タップの受け口。マークしたピンどうしが重なると複数のレイヤーが同じタップを拾うので、
           最初に拾ったものが元のイベントに印を付け、残りは降りる。
           登録の順を逆（枠1→枠4）にしてあるのは、前面に居る枠から先に拾わせるため。 */
        [...FAV_CLICK_LAYERS].reverse().forEach(id => {
            map.on('click', id, e => {
                if (!e.features || !e.features.length) return;
                if (e.originalEvent) {
                    if (e.originalEvent._favHandled) return;
                    e.originalEvent._favHandled = true;
                }
                const item = favOverlayItems[e.features[0].properties._i];
                if (!item) return;
                if (trackingMode > 0) { trackingMode = 0; stopRafLoop(); updateGeolocateButton(); }
                const c = item.coords.slice();
                while (Math.abs(e.lngLat.lng - c[0]) > 180) { c[0] += e.lngLat.lng > c[0] ? 360 : -360; }
                openObjSheet(item.type, item.label, item.properties, c[0], c[1]);
                histRecordPin(itemDisplayName(item) || '地点', c, item.type, item.properties);
            });
            map.on('mouseenter', id, () => map.getCanvas().style.cursor = 'pointer');
            map.on('mouseleave', id, () => map.getCanvas().style.cursor = '');
        });
        refreshFavOverlay();
    }

