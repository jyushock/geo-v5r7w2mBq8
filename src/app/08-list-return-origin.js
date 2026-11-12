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
    /* 検索地点の左の絵（ピン／地図中心）を押すと Googleマップで開く。住所ではなく座標で開く
       （ピンがあればピン、無ければ地図の中心）。window.open ではなく <a target="_blank"> にするのは、
       iPhone で Googleマップのアプリから戻ったときに空のタブを残さないため
       （setupIosNearbyGmapLinks と同じ理由）。地点は押すたびに変わるので、押した瞬間に href を差し替える。 */
    document.getElementById('nearby-search-origin-icon').addEventListener('click', (e) => {
        e.stopPropagation();   // 行の住所の開閉は起こさない
        const c = getSearchCenter();
        e.currentTarget.href = `https://www.google.com/maps/search/?api=1&query=${c.lat.toFixed(6)},${c.lng.toFixed(6)}`;
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
        if (objLongPressJustFired()) return;
        if (searchPinLngLat && map.getLayer('search-pin-layer')) {
            const hit = map.queryRenderedFeatures(e.point, { layers: ['search-pin-layer'] });
            if (hit.length > 0) { removeSearchPin(); return; }
        }
    });

    /* 長押し。空いた地図なら検索ピンを置き、オブジェクトの上なら地点をコピーする
       （別アプリの地点登録へ貼る JSON。objPointJson を参照）。
       オブジェクトの上に検索ピンを置く操作は、情報シートの「この周辺を検索」が
       そのオブジェクトを検索地点にするので要らない。
       コピーは指を離した瞬間に行う。クリップボードへの書き込みはユーザー操作の中からでないと
       拒まれるため（情報シートのタイトル長押しと同じ作り）。500ms の時点では震わせて合図するだけ。 */
    let longPressTimer = null;
    let longPressLngLat = null;
    let longPressPoint = null;
    let longPressObj = null;       // 500ms 経ってコピーを待っているオブジェクト
    function startLongPress(lngLat, point) {
        longPressLngLat = lngLat;
        longPressPoint = point;
        longPressObj = null;
        longPressTimer = setTimeout(() => {
            longPressTimer = null;
            if (map.queryRenderedFeatures(longPressPoint).some(f => f.properties?.cluster)) return;
            const obj = objAtPoint ? objAtPoint(longPressPoint) : null;
            if (obj) {
                longPressObj = obj;
                if (navigator.vibrate) navigator.vibrate(15);
                return;
            }
            longPressActivated = true;
            placeSearchPin(longPressLngLat);
        }, 500);
    }
    function cancelLongPress() {
        if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
        longPressObj = null;       // 地図を動かしたらコピーも取り消す
    }
    async function endLongPress() {
        const obj = longPressObj;
        cancelLongPress();
        if (!obj) return;
        objLongPressAt = Date.now();
        const name = objPlainName(obj.type, obj.label, obj.p);
        const ok = await copyToClipboard(objPointJson(obj.type, obj.label, obj.p, obj.lng, obj.lat));
        showToast(ok ? `「${name}」の地点をコピーしました` : 'コピーできませんでした');
    }
    map.on('touchstart',  (e) => { if (e.originalEvent.touches.length === 1) startLongPress(e.lngLat, e.point); });
    map.on('touchend',    endLongPress);
    map.on('touchmove',   cancelLongPress);
    map.on('mousedown',   (e) => { if (e.originalEvent.button === 0) startLongPress(e.lngLat, e.point); });
    map.on('mouseup',     endLongPress);
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

