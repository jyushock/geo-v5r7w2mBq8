    /* ══ サーバー同期 ══════════════════════════════════════════════
       設計は SYNC_MANUAL.md。要点だけ再掲する。
         ・ログイン画面は無い。最初にお気に入りか表示設定を保存した時点で、サーバーが
           無記名のキーを発行して HttpOnly Cookie に入れる（/api/enroll）
         ・localStorage が正。画面は今までどおり即座に立ち上がり、送受信は裏で回す
         ・サーバー上のキーは6つ。favorites / settingsState / prefs は全端末で共有し、
           mapState・mapTileSource・showOrigin は端末ごと（端末によって意味が違うため）
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
         showOrigin    … メニューに検索地点の行を出すか。画面の広さで要否が変わるので、
                         PCで出したらスマホの狭いメニューにも行が増える、ということにしない
       どれもサーバーには保存する。ただし device_id 付きなので、他の端末には配られない。 */
    const SYNC_DEVICE_KEYS = ['mapState', 'mapTileSource', 'showOrigin'];
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
        syncDeviceCount = 1;                   // 登録で作られるのは、この端末だけの新しい保存領域
        syncUpdateUi();
        return true;
    }

    /* 同期が止まったときの後始末。手元のお気に入りと設定は消さない
       （消せるのはサーバー側だけで、渡したものは取り消せない・SYNC_MANUAL.md §5.5）。
       notify を付けるのは401で気付いたときだけ。自分で止めた場合は操作側が知らせる。 */
    function syncMarkStopped(notify) {
        const already = !syncOn() && syncStopped();
        syncMetaSet({ on: false, stopped: true, rev: {} });
        syncDeviceCount = null;
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
                else if (sk === 'mapTileSource' || sk === 'showOrigin') reloadDevice = true;
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
        // 「薄く出す」（保存名は hidden）も名前と同じく時刻を持たないので、サーバー側を採る
        if (remote.hidden && typeof remote.hidden === 'object') {
            FAV_SLOTS.forEach(n => { favStore.hidden[n] = remote.hidden[n] === true; });
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

