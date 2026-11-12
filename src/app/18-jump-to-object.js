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
                scrollTops: searchColScrolls(),
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
       スクロール位置は列ごとに控えてあるので、renderResults で列を作り直した後に両列へ書き戻す。 */
    function reopenSearchResults() {
        const s = searchReturn;
        if (!s) return;
        document.getElementById('search-input').value = s.q;
        document.getElementById('search-clear').style.display = s.q.trim() ? 'block' : 'none';
        renderResults(s.local, s.places);
        setSearchColScrolls(s.scrollTops);
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
        // 残ったまま見えるので、ここでも両列を先頭に戻す。親を display:none にしても
        // スクロール位置は保持される（Chromium実測）ため、非表示側でも戻しておく。
        setSearchColScrolls([]);
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

    /* メニューに検索地点の行を出すか。端末ごとのキー（SYNC_DEVICE_KEYS）で、他の端末には配らない。
       2026-10-08 までは settingsState.showOrigin に入れていて全端末で共有されていた。
       この端末で独立したキーをまだ持っていなければ、そのとき手元にある古い値を1度だけ移す。 */
    if (storeGet('showOrigin') == null && savedSettings && savedSettings.showOrigin === true) {
        storeSet('showOrigin', '1');
    }
    let showOriginState = storeGet('showOrigin') === '1';

    function saveSettings() {
        storeSetJson('settingsState', {
            filter: filterState,
            label:  labelState,
            genreOff: [...genreOff]
        });
    }

    function applyShowOrigin() {
        const el = document.getElementById('nearby-search-origin');
        if (el) el.style.display = showOriginState ? '' : 'none';
    }

    function onShowOriginChange(checkbox) {
        showOriginState = checkbox.checked;
        applyShowOrigin();
        storeSet('showOrigin', showOriginState ? '1' : '0');
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
            a.href = googleRouteUrl(lat, lng);
        }
    }

