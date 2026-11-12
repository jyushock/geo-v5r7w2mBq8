    /* ══ 同期の画面（設定の区画・端末を追加・端末の管理） ══════════════ */
    const SYNC_QR_LIB = 'https://unpkg.com/qrcode-generator@1.4.4/qrcode.js';
    let syncQrLoaded = false;
    const syncAdd = { short: '', expiresAt: 0, tick: 0, poll: 0, seen: 0 };
    let syncSelfId = '';

    /* 状態は3つある。「まだ一度も同期していない」と「一度は同期していたが止まっている」を
       同じ文言にすると、後者で「お気に入りを付ければ自動で始まります」と案内することになり、
       実際には始まらない（syncStopped のコメント）ので、分けて出す。 */
    /* 同期中の端末が、共有の中で何台目か。null は未取得。
       「同期しています」だけだと、自動で始まった1台きりの保存領域（別のブラウザで
       表示設定を触っただけで作られる）でも同じ文言になり、他の端末と中身が違うのに
       揃っているように見える。設定を開いたときに台数を取り、1台なら言い分ける。 */
    let syncDeviceCount = null;
    async function syncRefreshDeviceCount() {
        if (!syncOn()) { syncDeviceCount = null; return; }
        try {
            const res = await syncFetch('devices', { method: 'GET' });
            if (res.status === 401) { syncMarkStopped(true); return; }
            if (!res.ok) return;
            const data = await res.json();
            syncDeviceCount = (data.devices || []).length;
            syncUpdateUi();
        } catch (e) { /* 通信できなければ台数なしの文言のまま */ }
    }

    function syncUpdateUi() {
        const el = document.getElementById('sync-state');
        if (!el) return;
        const on = syncOn();
        const stopped = !on && syncStopped();
        const alone = on && syncDeviceCount === 1;
        const head = alone ? '他の端末とはまだ共有していません'
                   : on ? 'この端末は同期しています'
                        : stopped ? '同期は止まっています' : 'この端末だけで保存しています';
        const note = alone ? 'サーバーに控えはありますが、つながっている端末はこの1台だけです。'
                             + '他の端末と同じ内容にするには、その端末で「端末を追加」を押し、出たQRかコードをこの端末で読んでください'
                   : on ? (syncDeviceCount > 1 ? `${syncDeviceCount}台で共有しています。` : '')
                          + '「端末を追加」で、他の端末も同じ内容にできます'
                        : stopped ? '保存はこの端末だけに残ります。もう一度共有するには「端末を追加」か、他の端末のQRから参加してください'
                                  : 'お気に入りか表示設定を変えた時点で、自動で同期を始めます';
        el.innerHTML = `<span class="sync-dot${on && !alone ? '' : ' off'}"></span>`
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
            + '地図の表示位置・地図タイル・メニューの検索地点は、端末ごとに別々のままです。\n\n進めますか？')) return;
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
       名前は onclick の JS 文字列に入れると ' で切れる（attrEscape の &#39; も JS に渡る前に ' へ戻る）ので埋めない。 */
    let syncDevicesCache = [];
    function renderSyncDevices(devices) {
        syncDevicesCache = devices;
        syncDeviceCount = devices.length;
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

