    /* ══ 設定の「お気に入りの名前」 ══════════════════════════════════════ */
    function renderFavNameList() {
        const el = document.getElementById('fav-name-list');
        if (!el) return;
        el.innerHTML = FAV_SLOTS.map(n => `
            <div class="favname-row">
                <span class="favname-sw" style="background:${FAV_COLORS[n]};color:${FAV_FG[n]}">${n}</span>
                <input class="favname-in" type="text" maxlength="${FAV_NAME_MAX}"
                       value="${attrEscape(favNameOf(n))}" placeholder="枠${n}（空欄なら使わない）"
                       oninput="onFavNameInput(${n}, this)">
                <span class="favname-cnt" data-fav-cnt="${n}">${favCountOf(n)}件</span>
                <button class="favname-eye" type="button" data-fav-eye="${n}"
                        onclick="onFavHiddenToggle(${n})"></button>
            </div>`).join('');
        updateFavEyes();
    }
    /* 地図に普通に出す／薄く出すの切り替え。目の絵はいつも開いた目で、薄く出す枠は
       目そのものを地図のピンと同じ濃さ（FAV_DIM_OPACITY）にする（見た目は index.html の .favname-eye）。
       案は mock/fav-dim-setting-preview.html の案A。切り替えてもトーストは出さない。
       名前が空の枠は使わない扱いなので押せなくする（押しても何も変わらないため）。 */
    const FAV_EYE = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
    function updateFavEyes() {
        document.querySelectorAll('[data-fav-eye]').forEach(el => {
            const n = Number(el.dataset.favEye);
            const dim = favStore.hidden[n] === true;
            if (!el.innerHTML) el.innerHTML = FAV_EYE;
            el.setAttribute('aria-pressed', dim ? 'true' : 'false');
            el.disabled = favNameOf(n) === '';
            el.title = dim ? '地図に薄く出しています（押すと普通に出す）' : '地図に普通に出しています（押すと薄く出す）';
        });
    }
    function onFavHiddenToggle(n) {
        if (!FAV_SLOTS.includes(n) || favNameOf(n) === '') return;
        favStore.hidden[n] = favStore.hidden[n] !== true;
        saveFavStore();
        refreshFavOverlay();      // 地図のピンの入れ替えもここから（refreshFavHiddenSources）
        updateFavEyes();
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
        updateFavEyes();          // 名前を空にした枠は目を押せなくする
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
                attrEscape(favNameOf(n))}${marks.includes(n) ? '<span class="fav-ck"><svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M2.5 7.5l3 3 6-7" fill="none" stroke="#2E7D32" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>' : ''}</button>`).join('')
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

