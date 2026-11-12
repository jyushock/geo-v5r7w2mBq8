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

