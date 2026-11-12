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
        centerAboveNearbyPanel(lng, lat);
    }
    /* 周辺検索を始めたオブジェクトを、周辺パネルに隠れない範囲の中央へ寄せる。
       パネルは画面下端から立ち上がるので、考え方は adjustMapForSheet と同じ
       （パネルの高さの半分だけ上にずらす）。パネルが画面の大半を占めても
       上端の外へ飛ばないよう、ずらし量は同じく制限する。
       高さは開く途中（bottom の transition 中）でも中身なりに決まっているので、すぐ測れる。
       この移動は検索を始めた副作用なので、移動履歴には記録しない。 */
    function centerAboveNearbyPanel(lng, lat) {
        const h = document.getElementById('nearby-panel').getBoundingClientRect().height;
        const mapH = map.getContainer().getBoundingClientRect().height;
        const dy = Math.min(h / 2, Math.max(0, (mapH - 80) / 2));
        map.easeTo({ center: [lng, lat], offset: [0, -dy], duration: 400, essential: true }, { histIgnore: true });
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
        // 家臣団ビューは後から足したもの。デプロイ直後に古い index.html と組み合わさっても落ちないよう、無ければ飛ばす
        const retainersView = document.getElementById('nearby-retainers-view');
        if (retainersView) retainersView.classList.remove('open');
        // 遺構の見かたビューも後から足したもの。家臣団と同じく、無ければ飛ばす
        const remainsHelpView = document.getElementById('nearby-remains-help-view');
        if (remainsHelpView) remainsHelpView.classList.remove('open');
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
        syncSearchProxy();
        fetchWeather();
    }
    /* メインビューのフッター左は下部バーの検索ボックスの代わり。入力中のワードを写しておく
       （古い index.html と組み合わさったときは要素が無いので何もしない） */
    function syncSearchProxy() {
        const el = document.getElementById('nearby-search-proxy-text');
        if (el) el.textContent = document.getElementById('search-input').value;
    }
    /* メニューを閉じて検索ボックスに入力できる状態にする。focus はタップの処理の中で
       同期的に呼ぶ（iOS は利用者の操作の外で focus してもキーボードを出さないため） */
    function focusSearchFromMenu() {
        closeNearby();
        document.getElementById('search-input').focus();
    }
    /* メニューの外側のタップ。フッターの無いビュー（一覧・城主・設定）では下部バーが見えているが
       透明な覆いの下にあるので、検索ボックスの上で押されたときはメニューを閉じて入力へ移る */
    function onNearbyOverlayClick(e) {
        const r = document.getElementById('search-box').getBoundingClientRect();
        const onSearchBox = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
        if (onSearchBox) focusSearchFromMenu();
        else closeNearby();
    }
    function openSettingsView() {
        setPanelLifted(true);
        renderObjFilterUI();
        renderFavNameList();
        Object.keys(labelState).forEach(id => { const el=document.getElementById(`check-label-${id}`); if(el) el.checked=labelState[id]; });
        const originChk = document.getElementById('check-show-origin');
        if (originChk) originChk.checked = showOriginState;
        syncUpdateUi();
        syncRefreshDeviceCount();
        document.getElementById('nearby-main-view').style.display = 'none';
        document.getElementById('nearby-settings-view').classList.add('open');
    }
    function closeSettingsView() {
        setPanelLifted(false);
        document.getElementById('nearby-main-view').style.display = '';
        document.getElementById('nearby-settings-view').classList.remove('open');
    }

