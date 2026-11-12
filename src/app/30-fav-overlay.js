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
    /* 「薄く出す」枠のピン。元のソースからは外してあり（favHiddenKeys）、ここで全種別の
       ピンより下に薄く描き直す。前面の重ね描きとは別のソース・別のレイヤーの組で、
       タップの受け口も別にする（FAV_CLICK_LAYERS に入れると、上に重なった普通のピンより先に拾ってしまう）。 */
    const FAV_DIM_OPACITY = 0.35;
    const FAV_DIM_LAYERS = [];
    let favDimFeatures = [];

    function buildFavOverlayData() {
        favOverlayItems = [];
        favDimFeatures = [];
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
                /* 薄く出す枠に入っているものは、前面の重ね描きには出さず、薄いピンの側へ回す。
                   色は元のピンと同じ（種別の色）で、枠のバッジは付けない。 */
                if (favHiddenKeys.has(key)) {
                    favDimFeatures.push({
                        type: 'Feature',
                        geometry: { type: 'Point', coordinates: [c[0], c[1]] },
                        properties: {
                            _i: favOverlayItems.push(item) - 1,
                            _shape: pin.shape, _icon: pin.icon, _iconSize: pin.size,
                            _color: objRingColor(item.type, item.properties || {}),
                        },
                    });
                    continue;
                }
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
        refreshFavHiddenSources();
        if (typeof map === 'undefined' || !map || !map.getSource) return;
        const src = map.getSource('fav-objects');
        if (!src) return;
        src.setData(buildFavOverlayData());
        const dim = map.getSource('fav-dim-objects');
        if (dim) dim.setData({ type: 'FeatureCollection', features: favDimFeatures });
    }
    /* お気に入りは全種別のピンより前面に描いているので、そこを踏んだタップは前面側に任せる。
       これが無いと後ろに隠れているピンのハンドラも動き、シートと履歴が二重になる。 */
    function favOverlayHit(point) {
        const layers = FAV_CLICK_LAYERS.filter(id => map.getLayer(id));
        return layers.length > 0 && map.queryRenderedFeatures(point, { layers }).length > 0;
    }

    /* 薄く出す枠のピン。o.dimBeforeId（種別ごとのピンの最下段のレイヤー）の前に差し込み、
       全種別のピンと影より下に描く。影は付けない。
       濃さはレイヤーごとにしか掛けられないので、地と図柄にそれぞれ FAV_DIM_OPACITY を掛ける
       （図柄の白は薄い地の上に重なるため、ピン全体をまとめて薄くしたときより少し白く見える）。 */
    function addFavDimLayers(o) {
        map.addSource('fav-dim-objects', { type: 'geojson', data: EMPTY_FC });
        const before = map.getLayer(o.dimBeforeId) ? o.dimBeforeId : undefined;
        const add = (layer) => {
            map.addLayer(layer, before);
            FAV_MAP_LAYERS.push(layer.id);
            FAV_DIM_LAYERS.push(layer.id);
            objClickLayers.push(layer.id);   // 薄いピンを押したときに、地図の空きタップとしてシートを閉じない
        };
        const isShape = s => ['==', ['get', '_shape'], s];
        const overlap = { 'icon-allow-overlap': true, 'icon-ignore-placement': true };
        const op = FAV_DIM_OPACITY;
        add({ id: 'fav-dim-bg', type: 'circle', source: 'fav-dim-objects', filter: isShape('circle'),
              paint: { 'circle-color': ['get', '_color'], 'circle-radius': o.circleR, 'circle-opacity': op } });
        add({ id: 'fav-dim-plate', type: 'symbol', source: 'fav-dim-objects', filter: isShape('michi'),
              layout: { 'icon-image': 'michi-plate-icon', 'icon-size': o.michiSize, ...overlap },
              paint: { 'icon-color': ['get', '_color'], 'icon-opacity': op } });
        add({ id: 'fav-dim-card', type: 'symbol', source: 'fav-dim-objects', filter: isShape('card'),
              layout: { 'icon-image': 'mhcard-icon', 'icon-size': 1.0, ...overlap },
              paint: { 'icon-color': o.cardFaceColor, 'icon-opacity': op } });
        add({ id: 'fav-dim-icon', type: 'symbol', source: 'fav-dim-objects', filter: ['!=', ['get', '_shape'], 'card'],
              layout: { 'icon-image': ['get', '_icon'], 'icon-size': ['get', '_iconSize'], ...overlap },
              paint: { 'icon-color': '#FFFFFF', 'icon-opacity': op } });
        add({ id: 'fav-dim-cardbadge', type: 'symbol', source: 'fav-dim-objects', filter: isShape('card'),
              layout: { 'icon-image': 'manhole-icon', 'icon-size': o.cardBadgeSize, ...overlap },
              paint: { 'icon-color': '#FFFFFF', 'icon-opacity': op } });
        /* タップ。薄いピンは最背面なので、上に普通のピンやお気に入りの重ね描きが重なっていれば
           そちらのハンドラに任せる。薄いピンのレイヤーどうしの二重発火は元のイベントの印で止める。 */
        FAV_DIM_LAYERS.forEach(id => {
            map.on('click', id, e => {
                if (objLongPressJustFired()) return;
                if (!e.features || !e.features.length) return;
                if (e.originalEvent) {
                    if (e.originalEvent._favDimHandled) return;
                    e.originalEvent._favDimHandled = true;
                }
                const upper = objClickLayers.filter(l => !FAV_DIM_LAYERS.includes(l) && map.getLayer(l));
                if (upper.length && map.queryRenderedFeatures(e.point, { layers: upper }).length) return;
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
    }

    function addFavOverlayLayers(o) {
        addFavDimLayers(o);
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
                if (objLongPressJustFired()) return;   // 長押しでコピーした指を離したときのクリック
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

