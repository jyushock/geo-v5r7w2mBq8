    /* ══ 家臣団ビュー ════════════════════════════════════════════════════
       中身は retainers/index.html（家臣団の表示側。取得ツールは D:\work\SamuraiRetainers）を iframe で出す。
       地図のページを離れずにメニューの中で開くので、閉じても地図・検索・メニューの状態は残る
       （別ページに移ると、戻ったときに castle.js などを読み直し、ホーム画面アプリでは戻る手段も無い）。
       iframe は初めて開いたときに作り、閉じても消さない。データ（data.js 5.8MB）を開くたびに
       読み直さないためで、選んだ家・年・検索語も次に開いたときにそのまま残る。 */
    /* 'retainers/index.html' ではなくフォルダで指す。本番（Cloudflare Workers の静的配信）は
       /retainers/index.html を /retainers/ へ 307 で転送し、sw.js は転送先の URL で保存するため、
       index.html で指すとオフライン時に保存分が見つからない（2026-09-12 に本番で確認） */
    const RETAINERS_URL = 'retainers/';
    function showRetainersView() {
        setPanelLifted(true);
        document.getElementById('nearby-main-view').style.display = 'none';
        document.getElementById('nearby-settings-view').classList.remove('open');
        document.getElementById('nearby-retainers-view').classList.add('open');
    }
    function openRetainersView() {
        const wrap = document.getElementById('retainers-frame-wrap');
        if (!wrap) return;
        if (!wrap.querySelector('iframe')) {
            const frame = document.createElement('iframe');
            frame.src = RETAINERS_URL;
            frame.title = '家臣団';
            wrap.appendChild(frame);
        }
        showRetainersView();
    }
    function closeRetainersView() {
        setPanelLifted(false);
        document.getElementById('nearby-retainers-view').classList.remove('open');
        document.getElementById('nearby-main-view').style.display = '';
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
