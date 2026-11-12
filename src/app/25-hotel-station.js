    /* ══ ホテル検索の最寄り駅 ══════════════════════════════════════════
       最寄り駅は HeartRails Express の getStations（x=経度, y=緯度）で引く。
       以前は Overpass だけで引いていたが、2026-11-03 に実測すると駅の問い合わせが
       33〜43秒、重複駅名の県名を引く is_in がさらに 35秒かかり、間に容量超過の 502 が
       挟まっていた（mail.ru・private.coffee のミラーも 504 で同じく遅い）。
       HeartRails は同じ地点で 0.4秒で返り、県名も一緒に返る。
       2026-11-03 に確かめた HeartRails の返し方：
       ・近い順に3駅を、路線ごとに1件ずつ返す（同じ駅が路線の数だけ並ぶ）。distance は "770m" の形
       ・およそ10kmより先の駅は返さない（銚子沖で 9.55km は返り 11km は0件）。設定の範囲が
         それより広く、0件だったときだけ Overpass で引き直す（山奥・離島のまれな場合）
       ・ケーブルカーとモノレールも含む。ケーブルカーは路線名で除く（高尾登山電鉄線・
         御岳登山鉄道は名前に出ないがケーブルカー。箱根登山鉄道線は普通の鉄道なので残す）。
         モノレールは除かない。Overpass の問い合わせは station=monorail を除いていたが、
         那覇で引くとゆいレールの美栄橋が返っており、実際には除けていなかった。
         除くと那覇では近い3駅がみな外れて Overpass 頼みになり、38秒かかって同じ駅が返った
       無料で使う条件としてアプリ内にクレジットを出す決まりなので、設定のホテルの項目に置いている。 */
    const HEARTRAILS_URL = 'https://express.heartrails.com/api/json';
    const HEARTRAILS_MAX_M = 10000;   // これより先は返さない（上の実測）
    const HEARTRAILS_ABORT_MS = 10000;
    const NON_STATION_LINE_RE = /鋼索|ケーブル|高尾登山電鉄|御岳登山鉄道/;

    async function heartrailsStations(params) {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), HEARTRAILS_ABORT_MS);
        try {
            const res = await fetch(`${HEARTRAILS_URL}?method=getStations&${params}`, { signal: ctl.signal });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const j = await res.json();
            if (!j.response || j.response.error) throw new Error((j.response && j.response.error) || 'no response');
            return j.response.station || [];
        } finally {
            clearTimeout(timer);
        }
    }

    /* 起点から radius(m) 以内で一番近い駅。{ name, prefecture }。圏内に無ければ null。
       Overpass で引き直したときは prefecture が無く、駅の座標 lat/lng を付けて返す。 */
    async function findNearestStation(lat, lng, radius, onRetry) {
        let raw = null;
        try {
            raw = await heartrailsStations(`x=${lng}&y=${lat}`);
        } catch (e) { /* 止まっているときは Overpass で引く */ }
        const list = raw && raw.filter(s => !NON_STATION_LINE_RE.test(s.line || ''));
        if (list && list.length > 0) {
            const s = list[0];   // 近い順に来る
            return parseInt(s.distance, 10) <= radius ? { name: s.name, prefecture: s.prefecture } : null;
        }
        /* HeartRails が0件で、範囲が HeartRails の届く距離に収まっているなら本当に圏内に駅が無い。
           近い3駅がどれもケーブルカーで除いた結果の0件は、その先の駅が
           HeartRails からは見えないので Overpass に回す */
        if (raw && raw.length === 0 && radius <= HEARTRAILS_MAX_M) return null;

        const stationQuery = `[out:json][timeout:${OVERPASS_TIMEOUT_S}];node["railway"="station"]["station"!="cable_car"]["station"!="funicular"]["station"!="monorail"](around:${radius},${lat},${lng});out body;`;
        const data = await overpassQuery(stationQuery, onRetry);   // 失敗は呼び出し元で知らせる
        if (!data.elements || data.elements.length === 0) return null;
        const nearest = data.elements
            .map(el => ({ ...el, dist: calcDist(lat, lng, el.lat, el.lon) }))
            .sort((a, b) => a.dist - b.dist)[0];
        const name = (nearest.tags['name:ja'] || nearest.tags.name || '').replace(/駅$/, '');
        return { name, prefecture: null, lat: nearest.lat, lng: nearest.lon };
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
        // 投げ直している間は黙って待たせない（数秒×2回分の間が空くため）
        const onRetry = n => { labelEl.textContent = `再検索中… (${n}/${OVERPASS_TRIES})`; };

        const newTab = window.open('about:blank', '_blank');
        const center = getSearchCenter();
        const lat = center.lat;
        const lng = center.lng;
        // 駅探しの範囲も設定の「ホテル検索範囲」に合わせる
        const hotelRadius = storeGet('hotelRadius') || '10000';
        let station;
        try {
            station = await findNearestStation(lat, lng, Number(hotelRadius), onRetry);
        } catch (e) {
            newTab.close();
            restore();
            return alert(`駅の情報を取得できませんでした（${overpassFailText(e)}）。\n地図データの提供元が混み合っています。少し時間をおいてもう一度お試しください。`);
        }
        // ここまで来ていれば応答は正常。null は本当に圏内に駅が無いとき
        if (!station) {
            newTab.close();
            restore();
            return alert(`近くに駅が見つかりませんでした（${hotelRadius / 1000}km圏内）`);
        }
        let stationName = station.name;

        /* 他県にも同じ駅名があるときだけ県名を足す。Overpass で引き直したときは県名が無いので、
           同名の駅を HeartRails で引いて一番近いものの県を使う。ここは付けられれば良いだけなので、
           失敗しても駅名だけで先へ進む。 */
        if (stationName && duplicateStationNames.has(stationName)) {
            let prefName = station.prefecture;
            if (!prefName) {
                try {
                    const same = await heartrailsStations(`name=${encodeURIComponent(stationName)}`);
                    const near = same
                        .map(s => ({ ...s, dist: calcDist(station.lat, station.lng, Number(s.y), Number(s.x)) }))
                        .sort((a, b) => a.dist - b.dist)[0];
                    if (near) prefName = near.prefecture;
                } catch (e) { /* 県名は付かなくても検索そのものはできる */ }
            }
            if (prefName) stationName = `${stationName} (${prefName})`;
        }
        restore();
        if (!stationName) { newTab.close(); return alert('駅名が取得できませんでした'); }
        const dp_ymd = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }).replace(/-/g, '');
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
            return window.open(nearbyGmapUrl(nearbyState.cats), '_blank');
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
            return `<div class="nearby-item" ${actionAttrs('nearbyJumpToItem', Number(i))}>
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
                rows.length.toLocaleString()}件）<button class="pref-more" data-on-click="showMoreNearbyItems"
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

    // 時間別パネルをPCのマウスでも横に送れるようにする。
    // 帯はスクロールバーを隠しており、縦ホイールもマウスドラッグも既定では横スクロールにならないため、
    // 縦ホイール→横送り、左ボタンドラッグ→横送りを足す。タッチ・ペンと横ホイール（トラックパッド）は既定動作に任せる。
    (function enableHourlyMouseScroll() {
        const panel = document.getElementById('weather-hourly-panel');
        if (!panel) return;
        const stripOf = (t) => (t instanceof Element) ? t.closest('.weather-hourly-strip') : null;
        panel.addEventListener('wheel', (e) => {
            const strip = stripOf(e.target);
            if (!strip || e.ctrlKey) return;
            if (Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
            const max = strip.scrollWidth - strip.clientWidth;
            if (max <= 0) return;
            const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? strip.clientWidth : 1;
            const d = e.deltaY * unit;
            // 端まで送り切ったら縦スクロールに譲る
            if ((d < 0 && strip.scrollLeft <= 0) || (d > 0 && strip.scrollLeft >= max - 1)) return;
            e.preventDefault();
            strip.scrollLeft += d;
        }, { passive: false });
        let drag = null;
        panel.addEventListener('pointerdown', (e) => {
            if (e.pointerType !== 'mouse' || e.button !== 0) return;
            const strip = stripOf(e.target);
            if (!strip || strip.scrollWidth <= strip.clientWidth) return;
            drag = { strip, id: e.pointerId, x: e.clientX, left: strip.scrollLeft, moved: false };
        });
        panel.addEventListener('pointermove', (e) => {
            if (!drag || e.pointerId !== drag.id) return;
            const dx = e.clientX - drag.x;
            if (!drag.moved) {
                if (Math.abs(dx) < 4) return;
                drag.moved = true;
                try { panel.setPointerCapture(e.pointerId); } catch (_) {}
                drag.strip.classList.add('dragging');
            }
            e.preventDefault();
            drag.strip.scrollLeft = drag.left - dx;
        });
        const endDrag = (e) => {
            if (!drag || e.pointerId !== drag.id) return;
            drag.strip.classList.remove('dragging');
            drag = null;
        };
        panel.addEventListener('pointerup', endDrag);
        panel.addEventListener('pointercancel', endDrag);
        // 水滴画像のネイティブドラッグが始まるとポインタイベントが途切れるため止める
        panel.addEventListener('dragstart', (e) => e.preventDefault());
    })();

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
            // 1時間毎データ無し（気象庁フォールバック等でカードは非ボタン化済み）→ 選択を解除して閉じる
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
            // 降水量合計（1時間毎パネルと同じ書式・色ルール）
            const hasPrecip = (d.precip !== null && d.precip !== undefined && !isNaN(d.precip));
            const precipNum = hasPrecip ? (d.precip >= 10 ? Math.round(d.precip) : Math.round(d.precip * 10) / 10) : null;
            const precipColor = hasPrecip && d.precip >= 1 ? popColor(100) : '';
            // 降水量が3桁(100mm以上)の時は水滴アイコンを省略して幅を確保（カード幅は最大86px固定のため）
            const showDrop = hasPop && !(hasPrecip && d.precip >= 100);
            const popRow = `<div class="weather-pop-row">${showDrop ? `<img class="weather-pop-drop" src="${dropSvg(pc)}" alt="">` : ''}<span class="weather-pop-num" style="color:${pc}">${hasPop ? `<span style="font-weight:${pop >= 50 ? '700' : '600'}">${pop}</span><span>%</span>` : '--'}</span>${hasPrecip ? `<span class="weather-precip-num" style="${precipColor ? 'color:' + precipColor : ''}"><span style="font-size:${d.precip >= 1 ? '10px' : '9px'};font-weight:${d.precip >= 1 ? '700' : '400'}">${precipNum}</span><span>mm</span></span>` : ''}</div>`;
            // 1時間毎データがある日だけ開閉ボタンにする（気象庁フォールバック時は日毎のみ）
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
            <button type="button" class="weather-day-card${activeClass}" ${actionAttrs('toggleWeatherHourly', Number(i))} aria-pressed="${selectedWeatherDayIndex === i ? 'true' : 'false'}" aria-label="${lbl}の1時間ごとの天気を表示">${inner}</button>`;
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
    //   過半数条件は1時間スロット（1コマ）でも降水を拾うため。それ以外は晴/曇を多数決。
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
    //   集約窓は1時間毎パネルに表示するスロットと同一（今日 = 現在の時〜23時／
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
            // 日毎バッジの集約窓 = パネルに表示する1時間スロットが覆う時間帯
            //（今日 = 現在スロット以降／明日・明後日 = 終日）
            let win;
            if (di === 0) {
                win = idx.filter(i => { const hh = parseInt(times[i].slice(11, 13), 10); return hh >= nowH && hh <= 23; });
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
                return di === 0 ? hh >= nowH : true;
            });
            hourlyByDay.push(hourlyIdx.map(i => {
                const slotHour = parseInt(times[i].slice(11, 13), 10);
                const slotIdx = idx.filter(j => {
                    const hh = parseInt(times[j].slice(11, 13), 10);
                    return hh === slotHour;
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
                // 気温はその時の値（1時間スロットは1コマなので窓内の最高値＝その時の値）
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

