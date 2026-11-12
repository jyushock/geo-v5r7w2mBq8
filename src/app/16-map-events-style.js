// --- 1. 地図ドラッグ（移動）開始時の処理を修正 ---
map.on('dragstart', () => {
    if (trackingMode > 0) {
        const wasMode2 = trackingMode === 2;
        preTrackingMode = trackingMode;
        trackingMode = 0;
        stopRafLoop();
        updateGeolocateButton();
        if (!wasMode2) {
            map.easeTo({ bearing: 0, pitch: 0, duration: 350, essential: true });
        }
    }
});

map.getCanvas().addEventListener('touchstart', () => {
    if (trackingMode > 0) {
        const wasMode2 = trackingMode === 2;
        preTrackingMode = trackingMode;
        trackingMode = 0;
        stopRafLoop();
        updateGeolocateButton();
        if (!wasMode2) {
            map.easeTo({ bearing: 0, pitch: 0, duration: 350, essential: true });
        }
    }
}, { passive: true });

// --- 2. ズーム終了時の処理 ---
map.on('zoomstart', () => { isZooming = true; });
map.on('zoomend', () => { isZooming = false; });

    // ボタンの見た目を更新


    function updateGeolocateButton() {
        const btn = document.getElementById('geolocate-btn');
        const btn2 = document.getElementById('nearby-geolocate-btn');
        if (!btn) return;
        const markerEl = currentMarker ? currentMarker.getElement() : null;

        if (trackingMode === 0) {
            btn.classList.remove('geolocate-active');
            btn.innerHTML = iconLocate;
            if (btn2) { btn2.classList.remove('geolocate-active'); btn2.innerHTML = iconLocate; }
            if (markerEl) {
                markerEl.classList.remove('tracking');
                markerEl.classList.remove('heading-active');
                markerEl.classList.remove('nav-mode');
            }
        } else if (trackingMode === 1) {
            btn.classList.add('geolocate-active');
            btn.innerHTML = iconLocate;
            if (btn2) { btn2.classList.add('geolocate-active'); btn2.innerHTML = iconLocate; }
            if (markerEl) {
                markerEl.classList.add('tracking');
                markerEl.classList.add('heading-active');
                markerEl.classList.remove('nav-mode');
            }
        } else { // mode 2
            btn.classList.add('geolocate-active');
            btn.innerHTML = iconNav;
            if (btn2) { btn2.classList.add('geolocate-active'); btn2.innerHTML = iconNav; }
            if (markerEl) {
                markerEl.classList.add('tracking');
                markerEl.classList.remove('heading-active');
                markerEl.classList.add('nav-mode');
            }
        }
    }

    // スタイル調整：日本語化・駅強調・POI整理・水域色
    const ownLayerPrefixes = ['shops-', 'castles-', 'michi-', 'manholes-', 'mhcards-'];
    /* Liberty では駅もバス停も poi_transit の1枚に同居している。駅だけ衝突回避を
       外したいので、駅用のレイヤーを複製して元の1枚はバス停専用にする（下記 tuneLibertyStyle）。 */
    const busLayerId     = 'poi_transit';
    const stationLayerId = 'poi_transit_station';
    /* poi_r系から落とす class。値は実タイル（日本の z14 9枚・POI 42,487件）を
       復号して確認したもので、仕様書ではなく配信されている中身に合わせている。
       以前ここにあった car_dealer / car_rental / car_wash / car_repair / motorcycle /
       charging_station は OpenMapTiles の class に存在せず、6つとも空振りだった。
       カーディーラーと整備工場は class='car'（subclass が car / car_repair / car_parts）。 */
    const excludedPoiClasses = [
        // 車まわり
        'parking', 'fuel', 'car',
        // 駅・バス停は poi_transit 側と重複する
        'railway', 'bus',
        /* 地図の道具立て。アイコンがスプライトに無いうえ、名前もほとんど付かない
           （実タイルで bollard 1,117件は名前0件、cycle_barrier 67件も0件）。 */
        'entrance', 'telephone', 'bollard', 'gate', 'cycle_barrier', 'lift_gate', 'stile',
        'toll_booth', 'bicycle_parking', 'motorcycle_parking', 'recycling', 'brownfield',
        'reservoir', 'basin',
    ];
    const stationSubclasses = ['station', 'halt', 'subway', 'tram_stop', 'light_rail', 'stop', 'stop_position', 'platform', 'monorail', 'funicular', 'bus_station', 'bus_stop'];

    /* ===== OSM公式ベクター（Shortbread v1 ＋ VersaTiles Colorful）用 =====
       Liberty と共通するレイヤーIDは1つも無い。対応は Shortbread 仕様書と
       スタイルJSONの実物で突き合わせ済み。
         poi_transit         → symbol-transit-*（駅は種別ごとに分割。バス停も独立レイヤー）
         poi_r1/r7/r20       → source-layer 'pois' の poi-amenity ほか9レイヤー
         transportation_name → source-layer 'street_labels'
       Shortbread に rank と class は無い。POI の種別は class ではなく
       amenity / shop / leisure / tourism / man_made / historic / emergency /
       highway / office の9属性に分かれて入る。 */
    const sbStationLayerIds = ['symbol-transit-station', 'symbol-transit-subway',
                               'symbol-transit-lightrail', 'symbol-transit-tram',
                               'symbol-transit-airport', 'symbol-transit-airfield'];
    const sbBusLayerIds     = ['symbol-transit-bus'];
    /* pois から落とす種別。Liberty 側の excludedPoiClasses と役割は同じだが、
       スキーマが違うので中身は揃わない。ここに要るのは車まわりの5つだけ。
       parking・entrance は pois に入らない（parking は sites レイヤーのポリゴンで
       ラベルを持たない）。Liberty 側で落としている車止め・門などの道具立てが
       Shortbread の pois に入るかは未確認で、ここでは触っていない。
       railway・bus は pois ではなく public_transport 側なので、ここには要らない。

       判定は仕様書ではなく実タイルで行うこと。Shortbread 1.0 の仕様書に
       amenity=fuel の記載は無いが、配信タイルには入っている（日本の9タイルで34件）。
       leisure=park・leisure=playground も仕様書では land レイヤー扱いだが pois にも入る。
       2026-09-02 に実タイルを復号して確認した。 */
    const sbExcludedPois = [['shop', 'car'], ['amenity', 'car_rental'],
                            ['amenity', 'car_wash'], ['amenity', 'telephone'],
                            ['amenity', 'fuel']];
    /* 水域・緑地の塗り替え対象。Liberty と同じく id の部分一致で拾うと、
       陸地色で描かれている water-dam-area・water-pier-area まで水色になり、
       site-parking・site-bicycleparking（駐車場）が緑になるので、名指しで指定する。 */
    const sbWaterFillIds = ['water-ocean', 'water-area', 'water-area-river', 'water-area-small'];
    const sbGreenFillIds = ['land-park', 'land-garden', 'land-grass', 'land-forest',
                            'land-vegetation', 'land-leisure'];
    /* 鉄道。:outline（縁取り）と -service（側線）は太らせず、本線だけ強調する。 */
    const sbRailLayerIds = ['transport-rail', 'tunnel-transport-rail', 'bridge-transport-rail',
                            'transport-lightrail', 'tunnel-transport-lightrail', 'bridge-transport-lightrail',
                            'transport-monorail', 'tunnel-transport-monorail', 'bridge-transport-monorail'];

    map.once('style.load', () => {
        const allLayers = map.getStyle().layers;
        if (!allLayers) return;
        if (isOsmVector) tuneShortbreadStyle(allLayers);
        else             tuneLibertyStyle(allLayers);
    });

    /* OpenFreeMap Liberty（OpenMapTiles スキーマ）用の調整。 */
    function tuneLibertyStyle(allLayers) {
        /* symbol-sort-key（小さいほど前に出す）
             駅              : rank そのまま（実データで rank=1 が最上位）
             バス停          : rank + 1000（駅より必ず後ろ）
             一般POI・地名   : 100
             シールド・道路名 : 200 */

        /* 駅とバス停を別レイヤーに分ける。Liberty の poi_transit は駅・バス停・空港が
           同居する1枚で、ここに text-allow-overlap を付けると駅だけでなくバス停まで
           衝突回避から外れ、バス停の名前が束になって重なる（z17 東京駅で30件が
           重なるのを実測）。駅は必ず出したいので、同じ定義を駅専用に複製して
           そちらにだけ allow-overlap を付け、元の poi_transit はバス停専用にする。 */
        const transitBase = allLayers.find(l => l.id === busLayerId);
        if (transitBase && !map.getLayer(stationLayerId)) {
            const clone = JSON.parse(JSON.stringify(transitBase));
            clone.id = stationLayerId;
            try { map.addLayer(clone); } catch (e) { console.warn('[style] 駅レイヤーの複製', e); }
        }

        /* 駅・空港。allow-overlap は true（重なっても必ず描く）だが ignore-placement は
           false のままにして、バス停や一般POIが避ける相手としては残す。 */
        function tuneTransitStation() {
            const id = stationLayerId;
            if (!map.getLayer(id)) return;
            const isRail = ['==', ['get', 'class'], 'railway'];
            try {
                map.setFilter(id, ['all', ['has', 'name'],
                    ['match', ['get', 'class'], ['railway', 'airport'], true, false]]);
                map.setLayoutProperty(id, 'text-field', ['coalesce', ['get', 'name:ja'], ['get', 'name']]);
                map.setLayoutProperty(id, 'symbol-sort-key', ['get', 'rank']);
                /* Liberty の poi_transit は text-font が ['Noto Sans Italic'] で、駅名も
                   バス停名も斜体になる。Shortbread 側は42レイヤーとも Regular なので、
                   配信元を切り替えると字体が変わっていた。立体に揃える。 */
                map.setLayoutProperty(id, 'text-font', ['Noto Sans Regular']);
                map.setLayoutProperty(id, 'text-allow-overlap', true);
                map.setLayoutProperty(id, 'icon-allow-overlap', true);
                map.setLayoutProperty(id, 'text-ignore-placement', false);
                map.setLayoutProperty(id, 'icon-ignore-placement', false);
                map.setLayoutProperty(id, 'text-anchor', 'top');
                map.setLayoutProperty(id, 'text-offset', [0, 0.9]);
                map.setLayoutProperty(id, 'icon-size', 1.0);
                map.setLayoutProperty(id, 'text-size', 12);
                map.setLayoutProperty(id, 'visibility', 'visible');
                map.setLayerZoomRange(id, 1, 24);
                map.setPaintProperty(id, 'text-color', ['case', isRail, '#0D47A1', '#444444']);
                map.setPaintProperty(id, 'text-halo-color', '#FFFFFF');
                map.setPaintProperty(id, 'text-halo-width', 2.5);
                map.setPaintProperty(id, 'text-opacity', 1);
                map.setPaintProperty(id, 'icon-opacity', 1);
            } catch (e) { console.warn('[style] 駅', e); }
        }

        // バス停。衝突回避は既定のまま（重ならない）。z13→14 でフェードインする。
        function tuneTransitBus() {
            const id = busLayerId;
            if (!map.getLayer(id)) return;
            /* 以前は ['case', バス停か, ['interpolate', ['linear'], ['zoom'], …], 1] と
               書いていたため、「zoom 式は step / interpolate の最上位でしか使えない」で
               MapLibre に丸ごと弾かれ、フェードは一度も効いていなかった。
               レイヤーがバス停専用になったので素直な zoom 補間で書ける。 */
            const fade = ['interpolate', ['linear'], ['zoom'], 13, 0, 14, 1];
            try {
                map.setFilter(id, ['all', ['has', 'name'], ['==', ['get', 'class'], 'bus']]);
                map.setLayoutProperty(id, 'text-field', ['coalesce', ['get', 'name:ja'], ['get', 'name']]);
                map.setLayoutProperty(id, 'symbol-sort-key', ['+', ['get', 'rank'], 1000]);
                map.setLayoutProperty(id, 'text-font', ['Noto Sans Regular']);
                map.setLayoutProperty(id, 'text-anchor', 'left');
                map.setLayoutProperty(id, 'text-offset', [0.9, 0]);
                map.setLayoutProperty(id, 'icon-size', 0.8);
                map.setLayoutProperty(id, 'text-size', 11);
                map.setLayoutProperty(id, 'visibility', 'visible');
                map.setLayerZoomRange(id, 1, 24);
                map.setPaintProperty(id, 'text-color', '#2E7D32');
                map.setPaintProperty(id, 'text-halo-color', '#FFFFFF');
                map.setPaintProperty(id, 'text-halo-width', 1.0);
                map.setPaintProperty(id, 'text-opacity', fade);
                map.setPaintProperty(id, 'icon-opacity', fade);
            } catch (e) { console.warn('[style] バス停', e); }
        }

        tuneTransitStation();
        tuneTransitBus();

        // 鉄道は本線とハッチ（枕木）で別レイヤーになっている
        const railLayers = [
            'tunnel_major_rail', 'road_major_rail', 'bridge_major_rail',
            'tunnel_transit_rail', 'road_transit_rail', 'bridge_transit_rail'
        ];
        const railHatchLayers = railLayers.map(id => id + '_hatching');

        allLayers.forEach(layer => {
            const isShield = layer.id.includes('shield');
            const isTransName = layer['source-layer'] === 'transportation_name';
            if (isShield || isTransName) {
                // 国道シールド・道路名は最背面（駅より必ず背面）
                try {
                    map.setLayoutProperty(layer.id, 'symbol-sort-key', 200);
                    map.setLayoutProperty(layer.id, 'text-ignore-placement', false);
                    map.setLayoutProperty(layer.id, 'icon-ignore-placement', false);
                    /* シールドの3枚は ['<=', ['get','ref_length'], 6] で数値比較していて、
                       ref_length を持たない地物（東京駅周辺の transportation_name 854件中
                       611件）を評価するたびに「Expected value to be of type number, but
                       found null instead」が出る。null との比較は false になるので描画結果は
                       変わらない。all は短絡評価なので has を前に置いて警告だけ止める。 */
                    if (isShield) {
                        const f = map.getFilter(layer.id);
                        if (f) map.setFilter(layer.id, ['all', ['has', 'ref_length'], f]);
                    }
                } catch (e) {}
                return;
            }
            if (ownLayerPrefixes.some(p => layer.id.startsWith(p))) return;
            if (layer.id === busLayerId || layer.id === stationLayerId) return;   // 上で設定済み
            try {
                if (layer.type === 'symbol' && layer.layout && layer.layout['text-field']) {
                    map.setLayoutProperty(layer.id, 'text-field', ['coalesce', ['get', 'name:ja'], ['get', 'name']]);
                    // 一般POI・地名は駅より背面
                    map.setLayoutProperty(layer.id, 'symbol-sort-key', 100);
                    map.setLayoutProperty(layer.id, 'text-ignore-placement', false);
                    map.setLayoutProperty(layer.id, 'icon-ignore-placement', false);
                    // poi_r系から不要POIを除外（値は実タイルで確認。excludedPoiClasses の定義を参照）
                    if (['poi_r1', 'poi_r7', 'poi_r20'].includes(layer.id)) {
                        // 一般POIも Liberty は Italic 指定。駅・バス停と同じ立体に揃える
                        map.setLayoutProperty(layer.id, 'text-font', ['Noto Sans Regular']);
                        const existingFilter = map.getFilter(layer.id) || ['all'];
                        map.setFilter(layer.id, ['all',
                            existingFilter,
                            ['!', ['in', ['get', 'class'], ['literal', excludedPoiClasses]]]
                        ]);
                    }
                }
                if (layer.type === 'fill') {
                    const lid = layer.id.toLowerCase();
                    if (lid.includes('water')) {
                        map.setPaintProperty(layer.id, 'fill-color', '#AAD3DF');
                    } else if (['park', 'green', 'grass', 'forest', 'wood'].some(w => lid.includes(w))) {
                        /* 緑地。以前は grass が語のリストから漏れていて landcover_grass だけ
                           元の色 rgba(176,213,154) のまま残り、濃さも park 0.7 / wood 0.4 /
                           grass 0.3 と三者三様だった。色と濃さを揃える。 */
                        map.setPaintProperty(layer.id, 'fill-color', '#C8FACC');
                        map.setPaintProperty(layer.id, 'fill-opacity', 0.6);
                    }
                }
                /* 鉄道の強調。本線だけ青くすると、枕木のハッチが灰色のまま
                   z15で3px→z20で8px と太っていき、拡大するほど灰色が勝ってしまう。
                   ハッチも同じ青にする。本線の幅は 0.7 固定をやめ、引いたときの
                   見え方（0.7）を保ったまま寄ると太るようにした（固定のままだと z20 で
                   元スタイルの 2px より細くなる）。 */
                if (railLayers.includes(layer.id)) {
                    map.setPaintProperty(layer.id, 'line-color', '#1565C0');
                    map.setPaintProperty(layer.id, 'line-width',
                        ['interpolate', ['exponential', 1.4], ['zoom'], 11, 0.7, 14, 0.7, 15, 1, 20, 2.5]);
                    map.setPaintProperty(layer.id, 'line-opacity', 0.9);
                    map.setLayerZoomRange(layer.id, 1, 24);
                }
                if (railHatchLayers.includes(layer.id)) {
                    map.setPaintProperty(layer.id, 'line-color', '#1565C0');
                    map.setPaintProperty(layer.id, 'line-opacity', 0.9);
                    map.setLayerZoomRange(layer.id, 1, 24);
                }
            } catch (e) {}
        });
    }

    /* OSM公式ベクター（Shortbread ＋ Colorful）用の調整。
       symbol-sort-key の意味付けは Liberty 側と揃える（0:駅 / 100:一般POI・地名 /
       200:道路名・シールド）。Liberty では駅の序列に rank を使っていたが、
       Shortbread に rank は無いので固定値にする。
       text-field は書き換えない。Colorful の POI はアイコンのみでラベルを持たず、
       住所レイヤーは {housenumber}、シールドは {ref} を出しているため、
       name で上書きすると表示が壊れる。日本国内は name がそのまま日本語なので、
       Liberty 側のような name:ja へのフォールバックも要らない。
       なお配信されるタイルには name_ja / name_en / name_zh など多言語の名前が入っている
       （Shortbread 仕様書は name・name_en・name_de しか挙げていないが、OSM の配信は
       それより多い。2026-09-02 に実タイルを復号して確認。日本の9タイル12,058件のうち
       name が67%、name_ja が21%）。多言語表示をやるならこの項目を使う。 */
    function tuneShortbreadStyle(allLayers) {
        /* スプライトは style.json に書けない。MapLibre 3.6.2 の normalizeSpriteURL が
           `scheme://host` 形式の絶対URLしか受け付けず（正規表現 /^(\w+):\/\/.../）、
           相対パスやルート絶対パスだと Unable to parse URL で落ちてスタイルが完成しない。
           配信オリジンは localhost と本番で変わるので JSON に直書きもできない。
           そこで style.json からは sprite を外し、ここで location 基準の絶対URLにして足す。 */
        try {
            if (!map.getSprite().some(s => s.id === 'basics')) {
                map.addSprite('basics', new URL('osm-shortbread/sprites/sprites', location.href).href);
            }
        } catch (e) { console.warn('[sprite]', e); }

        const stationColor = '#0D47A1';
        const busColor     = '#2E7D32';
        const busFade      = ['interpolate', ['linear'], ['zoom'], 13, 0, 14, 1];
        const notExcludedPoi = ['!', ['any'].concat(sbExcludedPois.map(([k, v]) => ['==', ['get', k], v]))];
        allLayers.forEach(layer => {
            if (ownLayerPrefixes.some(p => layer.id.startsWith(p))) return;
            try {
                // 国道シールド・道路名は最背面（駅より必ず背面）
                if (layer.id.includes('shield') || layer['source-layer'] === 'street_labels') {
                    map.setLayoutProperty(layer.id, 'symbol-sort-key', 200);
                    map.setLayoutProperty(layer.id, 'text-ignore-placement', false);
                    map.setLayoutProperty(layer.id, 'icon-ignore-placement', false);
                    return;
                }
                // 駅：常に最前面、青字。アイコンはSDFなので icon-color で色が乗る
                if (sbStationLayerIds.includes(layer.id)) {
                    map.setLayoutProperty(layer.id, 'symbol-sort-key', 0);
                    map.setLayoutProperty(layer.id, 'text-allow-overlap', true);
                    map.setLayoutProperty(layer.id, 'icon-allow-overlap', true);
                    map.setLayoutProperty(layer.id, 'text-ignore-placement', true);
                    map.setLayoutProperty(layer.id, 'icon-ignore-placement', true);
                    map.setLayoutProperty(layer.id, 'text-size', 12);
                    map.setLayerZoomRange(layer.id, 1, 24);
                    map.setPaintProperty(layer.id, 'text-color', stationColor);
                    map.setPaintProperty(layer.id, 'icon-color', stationColor);
                    map.setPaintProperty(layer.id, 'text-halo-color', '#FFFFFF');
                    map.setPaintProperty(layer.id, 'text-halo-width', 2.5);
                    map.setPaintProperty(layer.id, 'icon-opacity', 1);
                    return;
                }
                /* バス停：駅より必ず後退させ、z13→14でフェードインさせる。
                   Shortbread の bus_stop は z14 以上にしか入らないので実質 z14 から出る。 */
                if (sbBusLayerIds.includes(layer.id)) {
                    map.setLayoutProperty(layer.id, 'symbol-sort-key', 1000);
                    map.setLayoutProperty(layer.id, 'text-size', 11);
                    map.setLayoutProperty(layer.id, 'text-anchor', 'left');
                    map.setLayoutProperty(layer.id, 'text-offset', [0.9, 0]);
                    map.setLayerZoomRange(layer.id, 1, 24);
                    map.setPaintProperty(layer.id, 'text-color', busColor);
                    map.setPaintProperty(layer.id, 'icon-color', busColor);
                    map.setPaintProperty(layer.id, 'text-halo-color', '#FFFFFF');
                    map.setPaintProperty(layer.id, 'text-halo-width', 1.0);
                    map.setPaintProperty(layer.id, 'text-opacity', busFade);
                    map.setPaintProperty(layer.id, 'icon-opacity', busFade);
                    return;
                }
                // 一般POI：不要な種別を落とす（既存フィルターは残して AND で足す）
                if (layer['source-layer'] === 'pois') {
                    const existingFilter = map.getFilter(layer.id);
                    map.setFilter(layer.id, existingFilter
                        ? ['all', existingFilter, notExcludedPoi]
                        : notExcludedPoi);
                }
                // 駅以外の全シンボル（一般POI・地名）は駅より背面
                if (layer.type === 'symbol') {
                    map.setLayoutProperty(layer.id, 'symbol-sort-key', 100);
                    map.setLayoutProperty(layer.id, 'text-ignore-placement', false);
                    map.setLayoutProperty(layer.id, 'icon-ignore-placement', false);
                }
                if (layer.type === 'fill') {
                    if (sbWaterFillIds.includes(layer.id))      map.setPaintProperty(layer.id, 'fill-color', '#AAD3DF');
                    else if (sbGreenFillIds.includes(layer.id)) map.setPaintProperty(layer.id, 'fill-color', '#C8FACC');
                }
                // 鉄道線路の強調表示
                if (sbRailLayerIds.includes(layer.id)) {
                    map.setPaintProperty(layer.id, 'line-color', '#1565C0');
                    map.setPaintProperty(layer.id, 'line-width', 0.7);
                    map.setPaintProperty(layer.id, 'line-opacity', 0.9);
                    map.setLayerZoomRange(layer.id, 1, 24);
                }
            } catch (e) {}
        });
    }

    map.on('load', () => {
        // 検索ピン（GLレイヤー）
        const pinSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="52" viewBox="0 0 28 36"><path d="M14 0C7.4 0 2 5.4 2 12c0 8.4 12 24 12 24s12-15.6 12-24C26 5.4 20.6 0 14 0z" fill="#F44336"/><circle cx="14" cy="12" r="5" fill="white" opacity="0.9"/></svg>`;
        const pinImg = new Image(40, 52);
        pinImg.onload = () => { if (!map.hasImage('search-pin-icon')) map.addImage('search-pin-icon', pinImg, { pixelRatio: 2 }); };
        pinImg.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(pinSvg);
        map.addSource('search-pin-source',    { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addSource('pin-pulse-source',     { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addSource('pin-progress-source',  { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({ id: 'pin-pulse-layer', type: 'circle', source: 'pin-pulse-source', paint: { 'circle-radius': 0, 'circle-radius-transition': { duration: 0 }, 'circle-color': 'rgba(244,67,54,1)', 'circle-opacity': 0, 'circle-opacity-transition': { duration: 0 } } });
        map.addLayer({ id: 'pin-progress-layer', type: 'circle', source: 'pin-progress-source', paint: { 'circle-radius': 0, 'circle-color': 'rgba(244,67,54,0.1)', 'circle-opacity': 1, 'circle-stroke-width': 3, 'circle-stroke-color': 'rgba(244,67,54,0.85)', 'circle-stroke-opacity': 0 } });
        map.addLayer({ id: 'search-pin-layer',   type: 'symbol', source: 'search-pin-source',   layout: { 'icon-image': 'search-pin-icon', 'icon-size': 1, 'icon-anchor': 'bottom', 'icon-allow-overlap': true, 'icon-ignore-placement': true } });
        // 選択中オブジェクトの二重リング。オブジェクトのピンレイヤーはこの後に追加されるため、
        // ここで先に足しておけば常にピンの下に描かれ、リングがピンを隠さない。
        // 寸法: ピン直径28（フチ無し。外側にぼかし影が半径21まで薄く伸びる）に対し
        //       内リングφ46(線3)／外リングφ62(線2)。影の裾とリングは接するが重ならない。
        // 蓋⇄配布場所を行き来したときに2つのリングを結ぶ線。リングより先に足してその下に敷く。
        map.addSource('selected-link-source', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({ id: 'selected-link', type: 'line', source: 'selected-link-source',
            layout: { 'line-cap': 'round' },
            paint: { 'line-color': '#546E7A', 'line-width': 2.5, 'line-opacity': 0.75, 'line-dasharray': [2, 1.6] } });
        map.addSource('selected-object-source', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({ id: 'selected-ring-outer', type: 'circle', source: 'selected-object-source', paint: { 'circle-radius': 31, 'circle-opacity': 0, 'circle-stroke-width': 2, 'circle-stroke-color': '#546E7A', 'circle-stroke-opacity': 0.45 } });
        map.addLayer({ id: 'selected-ring-inner', type: 'circle', source: 'selected-object-source', paint: { 'circle-radius': 23, 'circle-opacity': 0, 'circle-stroke-width': 3, 'circle-stroke-color': '#546E7A' } });
        map.on('mouseenter', 'search-pin-layer', () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', 'search-pin-layer', () => { map.getCanvas().style.cursor = ''; });

        // 地図状態の保存（PWA再起動時の復元用）
        function saveMapState() {
            const c = map.getCenter();
            storeSetJson('mapState', {
                lng:     c.lng,
                lat:     c.lat,
                zoom:    map.getZoom(),
                bearing: map.getBearing(),
                pitch:   map.getPitch()
            });
        }
        map.on('moveend', saveMapState);
        map.on('zoomend', saveMapState);

        // 移動履歴：記録開始と初期エントリ
        map.on('moveend', onHistMoveEnd);
        map.on('movestart', closeHistList);
        histPush({ label: '開始地点', cause: 'init' });

        // 現在地ボタンのクリック処理
        document.getElementById('geolocate-btn').addEventListener('click', () => {
            removeSearchPin();
            if (currentLocation) {
                setSearchOriginText('取得中...', false);
                fetchPlaceName(currentLocation.lat, currentLocation.lng).then(name => {
                    if (!searchPinLngLat) setSearchOriginText(name || '現在地', false);
                });
            }
            // 追従解除後（preTrackingMode保持中）にボタンを押した場合 → モード復帰して現在地へ
            if (trackingMode === 0 && preTrackingMode > 0) {
                const mode = preTrackingMode;
                preTrackingMode = 0;
                trackingMode = mode;
                if (mode === 2) requestDeviceOrientation();
                if (currentLocation) {
                    histSetPending('現在地', 'geo', null,
                                   { coords: [currentLocation.lng, currentLocation.lat], zoom: map.getZoom() });
                    map.easeTo({
                        center: [currentLocation.lng, currentLocation.lat],
                        zoom: map.getZoom(),
                        bearing: mode === 2 ? deviceHeading : 0,
                        pitch:   mode === 2 ? 70 : 0,
                        duration: 700,
                        essential: true
                    });
                    map.once('moveend', startRafLoop);
                    map.once('moveend', refreshWeatherIfPanelOpen);
                }
                updateGeolocateButton();
                return;
            }

            trackingMode = (trackingMode + 1) % 3;
            if (trackingMode === 2) {
                requestDeviceOrientation();
            }

            if (trackingMode > 0 && currentLocation) {
                histSetPending('現在地', 'geo', null,
                               { coords: [currentLocation.lng, currentLocation.lat], zoom: map.getZoom() });
                map.easeTo({
                    center: [currentLocation.lng, currentLocation.lat],
                    zoom: map.getZoom(),
                    bearing: trackingMode === 2 ? deviceHeading : 0,
                    pitch: trackingMode === 2 ? 70 : 0,
                    duration: 700,
                    essential: true
                });
                map.once('moveend', startRafLoop);
                // 現在地へ移動完了後、基準点(=ピン解除で地図中心)の天気へ更新
                map.once('moveend', refreshWeatherIfPanelOpen);
            } else if (trackingMode === 0) {
                stopRafLoop();
                map.easeTo({ bearing: 0, pitch: 0, duration: 500, essential: true });
                // ピン解除済みなので現在の地図中心の天気へ更新
                refreshWeatherIfPanelOpen();
            } else {
                // 位置未取得などで地図移動が起きない場合も、ピン解除を天気へ反映
                refreshWeatherIfPanelOpen();
            }
            updateGeolocateButton();
        });

        // ズームボタンのクリック処理
        // ズームボタン長押し連続ズーム
        function setupLongPressZoom(btnId, delta) {
            const btn = document.getElementById(btnId);
            let intervalId = null;
            let timeoutId = null;
            const doZoom = () => map.easeTo({ zoom: map.getZoom() + delta, duration: 120, essential: true });
            const start = () => {
                doZoom();
                timeoutId = setTimeout(() => {
                    intervalId = setInterval(doZoom, 120);
                }, 200);
            };
            const stop = () => {
                clearTimeout(timeoutId);
                clearInterval(intervalId);
                intervalId = null;
                timeoutId = null;
            };
            btn.addEventListener('pointerdown', (e) => { e.preventDefault(); start(); });
            btn.addEventListener('pointerup', stop);
            btn.addEventListener('pointerleave', stop);
            btn.addEventListener('pointercancel', stop);
        }
        setupLongPressZoom('zoom-in-btn', 0.5);
        setupLongPressZoom('zoom-out-btn', -0.5);
        document.getElementById('north-reset-btn').addEventListener('click', () => {
            map.easeTo({ bearing: 0, pitch: 0, duration: 300, essential: true });
        });


        // watchPositionで常時位置監視（地図ロード後に開始）
        if (navigator.geolocation) {
            navigator.geolocation.watchPosition((pos) => {
                const accuracy = pos.coords.accuracy; // 水平誤差半径（メートル）

                // GPS信頼性フィルタ：精度が低い場合は位置更新を無視
                // ただし currentLocation がまだない初回は精度に関わらず受け入れる
                const GPS_ACCURACY_THRESHOLD = 50; // 50m以上の誤差は無視
                if (currentLocation && accuracy > GPS_ACCURACY_THRESHOLD) return;

                // 推定に取り込む。同じ測位の再送（maximumAge）や単発の外れ値は捨てられる（createLocationSmoother 参照）
                const r = locSmoother.addFix(pos, performance.now());
                if (!r.accepted) return;

                const isFirst = !currentLocation;
                // 静止時の揺れや外れ値を除いた推定位置を現在地として扱う
                const f = locSmoother.estimate();
                currentLocation = { lat: f.lat, lng: f.lng };

                if (!currentMarker) {
                    const el = document.createElement('div');
                    el.className = 'current-location-dot';
                    // 既定ではマーカーが整数ピクセルに丸められ、ゆっくり動くと1pxずつ段付きになるので外す
                    currentMarker = new maplibregl.Marker({ element: el, subpixelPositioning: true })
                        .setLngLat([f.lng, f.lat]).addTo(map);
                }
                // マーカーは rAF ループで、createLocationSmoother が計算する表示位置へ毎フレーム置く
                ensureRafLoop();

                // 追従モードONかつ初回位置取得時→アニメーションで現在地へ移動
                if (isFirst && trackingMode > 0) {
                    histSetPending('現在地', 'geo', null,
                                   { coords: [f.lng, f.lat], zoom: Math.max(map.getZoom(), 15) });
                    map.easeTo({
                        center: [f.lng, f.lat],
                        zoom: Math.max(map.getZoom(), 15),
                        bearing: trackingMode === 2 ? (deviceHeading || 0) : 0,
                        pitch: trackingMode === 2 ? 70 : 0,
                        duration: 800,
                        essential: true
                    });
                    map.once('moveend', startRafLoop);
                }
            }, (err) => {
                console.warn('[GPS] エラー:', err.code, err.message);
                alert('現在地が取得できませんでした。');
            }, { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 });
        } else {
            alert('お使いのブラウザは現在地取得に対応していません。');
        }

        /* maplibre-gl 6系の loadImage はコールバックを取らず Promise を返す。
           画像は解決値そのものではなく .data に入る（GetResourceResponse<T> = { data: T, ... }）。
           読めなかった画像は握りつぶして先へ進めるのは従来どおり。 */
        const loadSDF = (url, id) => map.loadImage(url)
            .then(res => { if (res && res.data) map.addImage(id, res.data, { sdf: true }); })
            .catch(() => {});
        // マンホールカードの素材だけは実寸の2倍で描いてあるので pixelRatio 2 で読む
        const loadSDF2x = (url, id) => map.loadImage(url)
            .then(res => { if (res && res.data) map.addImage(id, res.data, { sdf: true, pixelRatio: 2 }); })
            .catch(() => {});
        /* 影の素材だけは SDF ではない。ぼかしを画像に焼いてあり、色も黒で固定なので
           icon-color は効かず、濃さは icon-opacity で決める。これも実寸の2倍で描いてある。 */
        const loadPlain2x = (url, id) => map.loadImage(url)
            .then(res => { if (res && res.data) map.addImage(id, res.data, { pixelRatio: 2 }); })
            .catch(() => {});

        Promise.all([
            loadSDF('tabe.png',    'tabe-icon'),
            loadSDF('castle.png',  'castle-icon'),
            loadSDF('michi.png',   'michi-icon'),
            loadSDF('michi-plate.png', 'michi-plate-icon'),
            loadSDF('manhole.png', 'manhole-icon'),
            /* マンホールカードも他と同じSDF。白フチをやめたので外形（mhcard.png のアルファ）を
               そのまま銅色で塗る1枚だけになり、面を重ねる mhcard-face.png は使わない
               （原画は残してある）。画像が56x72/56x56なので pixelRatio 2 は従来どおり
               （表示は28x36 / 28x28）。HTML側の一覧は img として mhcard.png をそのまま使う。 */
            loadSDF2x('mhcard.png',              'mhcard-icon'),
            loadSDF2x('mhcard-cluster.png',      'mhcard-cluster-icon'),
            /* 角丸四角・カードの影。丸ピンは circle-blur でぼかせるが、道の駅とカードは
               symbol（画像）なのでぼかせない。ぼかし済みの黒い形を別画像で持ち、下に敷く。 */
            loadPlain2x('michi-plate-shadow.png',    'michi-plate-shadow-icon'),
            loadPlain2x('michi-cluster-shadow.png',  'michi-cluster-shadow-icon'),
            loadPlain2x('mhcard-shadow.png',         'mhcard-shadow-icon'),
            loadPlain2x('mhcard-cluster-shadow.png', 'mhcard-cluster-shadow-icon')
        ]).then(() => {
            // オブジェクト種別アイコンの円直径/表示サイズ。CSS変数 --obj-icon-circle / --obj-icon-inner と同じ値（画像ネイティブ幅64pxに対する比率をicon-sizeに使用）
            const OBJ_ICON_CIRCLE_PX = 28;
            const OBJ_ICON_INNER_PX = 25;
            const OBJ_ICON_NATIVE_PX = 64;
            // 道の駅の板。正方形は同じ寸法だと丸より大きく見えるので、本体を丸の28pxより小さくする。
            // CSS変数 --obj-icon-square と同じ値。フチが無いのでこれがそのまま外径。
            const MICHI_PLATE_PX = 26;
            // 道の駅のクラスタ。丸のクラスタ（φ40）に対し、ピンと同じ比率（26/28）で縮めた値
            const MICHI_CLUSTER_PX = 37;
            // カードの面の色。mhcard.png / mhcard-cluster.png の銅色部分の実測値と同じ
            const MHCARD_FACE_COLOR = '#B87333';
            // マンホールカードに重ねるバッジ。CSS変数 --mhcard-badge と同じ値（カード幅28pxの80%）
            const MHCARD_W_PX = 28;
            const MHCARD_BADGE_PX = MHCARD_W_PX * 0.8;
            /* ピンの影。白フチをやめた代わりに、ぼかした黒をピンの下に敷いて地図から浮かせる。
               丸・角丸四角・カードで濃さと広がりを揃えるため、落ち方を1つに決めてある。
                 形の SHADOW_PEAK_IN_PX 内側 … 最大の濃さ
                 形の SHADOW_ZERO_OUT_PX 外側 … 0（間は smoothstep）
               丸は circle-blur で作る。circle シェーダは
                 smoothstep(0.0, -blur, r/半径 - 1)
               なので「半径*(1-blur) で最大、半径で0」。ここから半径と blur を逆算する。
               道の駅とカードは symbol でぼかせないため、同じ落ち方を焼いた影PNGを敷く。
               影PNGを作り直すときも同じ条件（内2px→外6px）で焼くこと。ずれると
               四角だけ影が強い/弱い状態に戻る。 */
            const PIN_SHADOW_OPACITY  = 0.13;   // circle-opacity / icon-opacity は仕様上 0〜1
            const PIN_SHADOW_OFFSET   = [0, 2];   // 下へ2px
            const SHADOW_PEAK_IN_PX   = 2;
            const SHADOW_ZERO_OUT_PX  = 6;
            const shadowCircleOf = (shapeR) => {
                const r = shapeR + SHADOW_ZERO_OUT_PX;
                return { r, blur: (SHADOW_PEAK_IN_PX + SHADOW_ZERO_OUT_PX) / r };
            };
            const PIN_SHAPE_R     = OBJ_ICON_CIRCLE_PX / 2;   // 丸ピン φ28 → 半径14
            const CLUSTER_SHAPE_R = 20;                       // 丸クラスタの半径
            // データは後から非同期に届くため、ソースは空で生成し setData で埋める
            const configs = [
                { id: 'michi',           color: '#0B499D', icon: 'michi-icon',    type: 'michi',   clusterColor: '#0B499D' },
                { id: 'shops',           color: '#FFAA00', icon: 'tabe-icon',     type: 'shop',    clusterColor: '#FFAA00' },
                { id: 'manholes',        color: '#B87333', icon: 'manhole-icon',  type: 'manhole', clusterColor: '#B87333' },
                /* mhcard はピンもクラスタもカードの絵（-icon / -cluster）で描くので、
                   丸を塗る color / clusterColor は使わない。持たせると「変えても反映されない」
                   設定になるため置かない。検索結果や履歴のアイコン色は typeConfig 側で持つ。 */
                { id: 'mhcards',                           icon: 'mhcard-icon',   type: 'mhcard' },
                { id: 'castles',         color: '#8A8A8A', icon: 'castle-icon',   type: 'castle',  clusterColor: '#8A8A8A' },
                { id: 'castles-famous',  color: '#8A8A8A', icon: 'castle-icon',   type: 'castle',  clusterColor: '#8A8A8A', noCluster: true },
            ];

            // 地図の空きタップで情報シートを閉じる判定に使う、オブジェクトのクリック対象レイヤー一覧
            objClickLayers.length = 0;
            // そのうち種別ごとのピンのレイヤー → 種別（地図の長押しで地点をコピーするときに引く）
            const objPinLayerType = {};

            /* filterState から初期visibility を決定（保存済み設定を反映）。
               manholes は蓋とポケふたが同居するソースなので、どちらかが表示中なら
               レイヤーは出す（中身の出し入れは manholeFeaturesForMap 側）。 */
            const initVisOf = (conf) => {
                const filterKey = conf.type === 'castle' ? 'castle'
                    : conf.type === 'manhole' ? 'manhole'
                    : conf.type === 'mhcard'  ? 'mhcard'
                    : conf.type === 'michi'   ? 'michi'
                    : conf.type === 'shop'    ? 'shop'
                    : null;
                return (filterKey === null || objLayerVisible(filterKey)) ? 'visible' : 'none';
            };

            /* ソースと影だけを先に一周して作る。影は必ず全種別のピンより下に居なければならず、
               種別ごとに「影→ピン」の順で足すと、後の種別の影が前の種別のピンに乗って黒く曇る。
               影は衝突判定に載せない（ラベルを押し出さないため）。 */
            configs.forEach(conf => {
                const initVis = initVisOf(conf);
                /* ずらす向きは画面基準（-translate-anchor: viewport）。既定の map のままだと
                   コンパスで地図を回したときに影だけ一緒に回り、光源が動いて見える。 */
                const shadowPaintSymbol = {
                    'icon-opacity': PIN_SHADOW_OPACITY,
                    'icon-translate': PIN_SHADOW_OFFSET, 'icon-translate-anchor': 'viewport',
                };
                const shadowPaintCircle = (shapeR) => {
                    const s = shadowCircleOf(shapeR);
                    return {
                        'circle-radius': s.r, 'circle-color': '#000000', 'circle-blur': s.blur,
                        'circle-opacity': PIN_SHADOW_OPACITY,
                        'circle-translate': PIN_SHADOW_OFFSET, 'circle-translate-anchor': 'viewport',
                    };
                };
                const shadowLayout = (image, size) => ({
                    'icon-image': image, 'icon-size': size,
                    'icon-allow-overlap': true, 'icon-ignore-placement': true, 'visibility': initVis,
                });

                map.addSource(conf.id, conf.noCluster
                    ? { type: 'geojson', data: EMPTY_FC }
                    : { type: 'geojson', data: EMPTY_FC, cluster: true, clusterMaxZoom: 13, clusterRadius: 50 }
                );

                // クラスタの影
                if (conf.type === 'mhcard') {
                    map.addLayer({ id: `${conf.id}-cluster-shadow`, type: 'symbol', source: conf.id, filter: ['has', 'point_count'], layout: shadowLayout('mhcard-cluster-shadow-icon', 1.0), paint: shadowPaintSymbol });
                } else if (conf.type === 'michi') {
                    map.addLayer({ id: `${conf.id}-cluster-shadow`, type: 'symbol', source: conf.id, filter: ['has', 'point_count'], layout: shadowLayout('michi-cluster-shadow-icon', 1.0), paint: shadowPaintSymbol });
                } else {
                    map.addLayer({ id: `${conf.id}-cluster-shadow`, type: 'circle', source: conf.id, filter: ['has', 'point_count'], paint: shadowPaintCircle(CLUSTER_SHAPE_R), layout: { 'visibility': initVis } });
                }
                // ピンの影
                if (conf.type === 'mhcard') {
                    map.addLayer({ id: `${conf.id}-shadow`, type: 'symbol', source: conf.id, filter: ['!', ['has', 'point_count']], layout: shadowLayout('mhcard-shadow-icon', 1.0), paint: shadowPaintSymbol });
                } else if (conf.type === 'michi') {
                    map.addLayer({ id: `${conf.id}-shadow`, type: 'symbol', source: conf.id, filter: ['!', ['has', 'point_count']], layout: shadowLayout('michi-plate-shadow-icon', 1.0), paint: shadowPaintSymbol });
                } else {
                    map.addLayer({ id: `${conf.id}-shadow`, type: 'circle', source: conf.id, filter: ['!', ['has', 'point_count']], paint: shadowPaintCircle(PIN_SHAPE_R), layout: { 'visibility': initVis } });
                }
            });

            configs.forEach(conf => {
                const initVis = initVisOf(conf);
                if (conf.type === 'mhcard') {
                    /* カードのクラスタはカードの外形1枚を銅色で塗るだけ。白フチをやめたので、
                       面を重ねる -cluster-face は無い。
                       上に乗る件数テキストが衝突判定で消えないよう、板は判定から外す */
                    map.addLayer({ id: `${conf.id}-cluster`, type: 'symbol', source: conf.id, filter: ['has', 'point_count'], layout: { 'icon-image': 'mhcard-cluster-icon', 'icon-size': 1.5, 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'visibility': initVis }, paint: { 'icon-color': MHCARD_FACE_COLOR } });
                } else if (conf.type === 'michi') {
                    /* 道の駅のクラスタもピンと同じ角丸四角。ピンと同様に、正方形は丸と同じ寸法だと
                       大きく見えるので、丸のクラスタ（φ40）より小さい37pxにする。
                       上に重なる件数テキストが押し出されないよう衝突判定からは外す。 */
                    map.addLayer({ id: `${conf.id}-cluster`, type: 'symbol', source: conf.id, filter: ['has', 'point_count'], layout: { 'icon-image': 'michi-plate-icon', 'icon-size': MICHI_CLUSTER_PX / OBJ_ICON_NATIVE_PX, 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'visibility': initVis }, paint: { 'icon-color': conf.clusterColor } });
                } else {
                    map.addLayer({ id: `${conf.id}-cluster`, type: 'circle', source: conf.id, filter: ['has', 'point_count'], paint: { 'circle-color': conf.clusterColor, 'circle-radius': 20 }, layout: { 'visibility': initVis } });
                }
                map.addLayer({ id: `${conf.id}-cluster-count`, type: 'symbol', source: conf.id, filter: ['has', 'point_count'], layout: { 'text-field': '{point_count_abbreviated}', 'text-size': 12, 'text-font': ['Noto Sans Bold'], 'visibility': initVis }, paint: { 'text-color': '#FFFFFF' } });
                if (conf.type === 'michi') {
                    /* 道の駅だけは丸ではなく道の駅紋章そのままの角丸四角。板(michi-plate-icon)も
                       図柄(michi-icon)もSDFで、色は icon-color から与える点は他の種別と同じ。
                       白フチはやめたので板は1枚だけ。地図からの分離は下に敷いた影が受け持つ。 */
                    /* 板は icon-ignore-placement で衝突判定から外す。他の種別では板にあたる
                       部分が circle レイヤー（衝突判定を持たない）なので、外さないと道の駅だけ
                       ラベルが板に押されて消える。判定に載るのは従来どおり -icon の1枚だけ。 */
                    map.addLayer({ id: `${conf.id}-bg`, type: 'symbol', source: conf.id, filter: ['!', ['has', 'point_count']], layout: { 'icon-image': 'michi-plate-icon', 'icon-size': MICHI_PLATE_PX / OBJ_ICON_NATIVE_PX, 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'visibility': initVis }, paint: { 'icon-color': conf.color } });
                } else if (conf.type !== 'mhcard') {
                    map.addLayer({ id: `${conf.id}-bg`, type: 'circle', source: conf.id, filter: ['!', ['has', 'point_count']], paint: { 'circle-color': conf.type === 'castle' ? ['match', ['get', 'genre'], '日本100名城', CASTLE_MEIJO_COLOR, '続日本100名城', CASTLE_ZOKU_MEIJO_COLOR, OBJ_TYPE_COLOR.castle] : conf.type === 'manhole' ? ['match', ['get', 'source'], 'pokefuta', '#FBBC04', '#B87333'] : conf.color, 'circle-radius': OBJ_ICON_CIRCLE_PX / 2 }, layout: { ...(conf.type === 'castle' ? { 'circle-sort-key': ['match', ['get', 'genre'], '日本100名城', 3, '続日本100名城', 2, 1] } : {}), 'visibility': initVis } });
                }
                /* 図柄。mhcard だけは「図柄」ではなくカードの外形そのもので、白フチをやめたため
                   銅色で塗る（他の種別の -bg にあたる役目）。タップ判定もこのレイヤーが持つ。 */
                map.addLayer({ id: `${conf.id}-icon`, type: 'symbol', source: conf.id, filter: ['!', ['has', 'point_count']], layout: { 'icon-image': conf.icon, 'icon-size': conf.type === 'mhcard' ? 1.0 : conf.type === 'manhole' ? OBJ_ICON_INNER_PX / OBJ_ICON_NATIVE_PX : conf.type === 'michi' ? MICHI_PLATE_PX / OBJ_ICON_NATIVE_PX : OBJ_ICON_CIRCLE_PX / OBJ_ICON_NATIVE_PX, 'icon-allow-overlap': true, ...(conf.type === 'castle' ? { 'symbol-sort-key': ['match', ['get', 'genre'], '日本100名城', 3, '続日本100名城', 2, 1] } : {}), 'visibility': initVis }, paint: { 'icon-color': conf.type === 'mhcard' ? MHCARD_FACE_COLOR : '#FFFFFF' } });
                if (conf.type === 'mhcard') {
                    // 銅色のカードの上にマンホールのバッジを重ねる
                    map.addLayer({ id: `${conf.id}-icon-overlay`, type: 'symbol', source: conf.id, filter: ['!', ['has', 'point_count']], layout: { 'icon-image': 'manhole-icon', 'icon-size': MHCARD_BADGE_PX / OBJ_ICON_NATIVE_PX, 'icon-allow-overlap': true, 'visibility': initVis }, paint: { 'icon-color': '#FFFFFF' } });
                }

                // テキストラベルレイヤー（マンホール・mhcard以外）
                if (conf.type !== 'manhole' && conf.type !== 'mhcard') {
                    // 食べログだけは name が複合のため、店名だけを切り出す式を使う
                    const labelField = conf.type === 'shop' ? SHOP_LABEL_FIELD
                        : ['get', conf.type === 'pokefuta' ? 'pokemon' : 'name'];
                    // pokefutaはlabelStateの対象外のため非表示固定、それ以外はlabelStateから取得
                    const labelVis = conf.type === 'pokefuta' ? 'none'
                        : (labelState[conf.type] !== false ? 'visible' : 'none');
                    map.addLayer({
                        id: `${conf.id}-label`,
                        type: 'symbol',
                        source: conf.id,
                        filter: ['!', ['has', 'point_count']],
                        layout: {
                            'text-field': labelField,
                            'text-size': 10,
                            'text-font': ['Noto Sans Regular'],
                            'text-anchor': 'top',
                            'text-offset': [0, 1.2],
                            'text-allow-overlap': false,
                            'text-max-width': 6,
                            'visibility': labelVis,
                        },
                        paint: {
                            'text-color': '#222222',
                            'text-halo-color': '#FFFFFF',
                            'text-halo-width': 1.5,
                        }
                    });
                }

                map.on('click', `${conf.id}-cluster`, (e) => {
                    const features = map.queryRenderedFeatures(e.point, { layers: [`${conf.id}-cluster`] });
                    if (!features.length) return;
                    // 6系の getClusterExpansionZoom も Promise を返す（コールバックは受け取らない）
                    map.getSource(conf.id).getClusterExpansionZoom(features[0].properties.cluster_id)
                        .then(zoom => map.easeTo({ center: features[0].geometry.coordinates, zoom: zoom + 1, duration: 450, essential: true }))
                        .catch(() => {});
                });

                const clickLayer = conf.type === 'mhcard' ? `${conf.id}-icon` : `${conf.id}-bg`;
                // クラスタは対象外。クラスタをタップしたときはズームインしつつシートを閉じる
                objClickLayers.push(clickLayer);
                objPinLayerType[clickLayer] = conf.type;
                map.on('click', clickLayer, (e) => {
                    if (objLongPressJustFired()) return;   // 長押しでコピーした指を離したときのクリック
                    // お気に入りを重ね描きしている位置は、前面のハンドラに任せる（二重に開かない）
                    if (favOverlayHit(e.point)) return;
                    if (trackingMode > 0) {
                        trackingMode = 0;
                        stopRafLoop();
                        updateGeolocateButton();
                    }
                    if (!e.features || !e.features.length) return;
                    const p = e.features[0].properties;
                    // タイルに載せ直された座標が返るので、元のデータの座標へ寄せる
                    const c = favSnapCoords(conf.type, p, e.features[0].geometry.coordinates.slice());
                    while (Math.abs(e.lngLat.lng - c[0]) > 180) { c[0] += e.lngLat.lng > c[0] ? 360 : -360; }
                    openObjSheet(conf.type, p.name || '', p, c[0], c[1]);
                    const histType = (conf.type === 'manhole' && p.source === 'pokefuta') ? 'pokefuta' : conf.type;
                    const histLabel = conf.type === 'shop' ? shopDisplayName(p) : (p.name || p.pokemon || '地点');
                    histRecordPin(histLabel || '地点', c, histType, p);
                });

                const hover = (l, cur) => { map.on('mouseenter', l, () => map.getCanvas().style.cursor = cur); map.on('mouseleave', l, () => map.getCanvas().style.cursor = ''); };
                hover(clickLayer, 'pointer');
                hover(`${conf.id}-cluster`, 'pointer');
            });

            /* お気に入りの重ね描き。全種別のピンより上に置くので、configs を回し終えた
               ここで足す。寸法と影の値は上のピンと同じものを渡し、二重に持たない。 */
            addFavOverlayLayers({
                circleR: PIN_SHAPE_R,
                shadowCircle: shadowCircleOf(PIN_SHAPE_R),
                shadowOpacity: PIN_SHADOW_OPACITY,
                shadowOffset: PIN_SHADOW_OFFSET,
                michiSize: MICHI_PLATE_PX / OBJ_ICON_NATIVE_PX,
                cardBadgeSize: MHCARD_BADGE_PX / OBJ_ICON_NATIVE_PX,
                cardFaceColor: MHCARD_FACE_COLOR,
                dimBeforeId: `${configs[0].id}-cluster-shadow`,   // 薄いピンは全種別のピンと影より下
            });

            /* 地図の長押しで地点をコピーするときの当たり判定（objAtPoint の説明を参照）。
               タップと同じく、前面にあるお気に入りの重ね描きを先に見て、次に種別ごとのピンを見る。
               座標もタップと同じく元データの座標へ寄せる（情報シートに出る座標と揃える）。 */
            objAtPoint = (point) => {
                const favLayers = FAV_CLICK_LAYERS.filter(id => map.getLayer(id));
                const fav = favLayers.length ? map.queryRenderedFeatures(point, { layers: favLayers }) : [];
                const item = fav.length ? favOverlayItems[fav[0].properties._i] : null;
                if (item) return { type: item.type, label: item.label, p: item.properties,
                                   lng: item.coords[0], lat: item.coords[1] };
                const layers = Object.keys(objPinLayerType).filter(id => map.getLayer(id));
                const hit = layers.length ? map.queryRenderedFeatures(point, { layers }) : [];
                if (!hit.length) {
                    // 最後に、最背面の薄いピン（薄く出す枠）を見る
                    const dimLayers = FAV_DIM_LAYERS.filter(id => map.getLayer(id));
                    const dim = dimLayers.length ? map.queryRenderedFeatures(point, { layers: dimLayers }) : [];
                    const it = dim.length ? favOverlayItems[dim[0].properties._i] : null;
                    return it ? { type: it.type, label: it.label, p: it.properties,
                                  lng: it.coords[0], lat: it.coords[1] } : null;
                }
                const type = objPinLayerType[hit[0].layer.id];
                const p = hit[0].properties;
                const c = favSnapCoords(type, p, hit[0].geometry.coordinates.slice());
                return { type, label: p.name || '', p, lng: c[0], lat: c[1] };
            };

            // オブジェクト以外（地図の空き）をタップしたら情報シートを閉じる。
            // レイヤー個別のclickハンドラとこのハンドラは両方発火するため、
            // queryRenderedFeaturesでオブジェクトを踏んでいないことを確認してから閉じる。
            map.on('click', (e) => {
                if (objLongPressJustFired()) return;
                if (!isObjSheetOpen()) return;
                const layers = objClickLayers.filter(id => map.getLayer(id));
                if (layers.length && map.queryRenderedFeatures(e.point, { layers }).length) return;
                closeObjSheet();
            });

            // 空ソース・レイヤー生成が済んだので、大容量データの非同期読込を開始
            // （表示中レイヤー優先 → 背景で残りを取得し、到着ごとに setData ＋検索再構築）
            startDataLoading();
        });
    });

    // Yahoo「ここへ行く」＝現在地（検索ピンがあればピン）から目的地までの経路を開く。
    // シートのHTMLは openObjSheet が開いた瞬間に一度だけ組み立てるため、出発地をURLに
    // 焼き込むと「測位前に開いた」「開いたまま移動した」場合に古い位置のまま残る。
    // そのため押された時点で currentLocation を読む。
    // 検索ピンが立っていれば、現在地ではなくピンを出発地にする（routeOrigin）。
    // ピンもシートを開いたまま立て直せる（地図の長押し）・消せる（現在地ボタン）ので、
    // Google側の href も押された時点で組み直す（リンクの遷移は click の処理の後に href を読む）。
    // Yahoo側も同じくリンクにして href を差し替える。以前は <button> から window.open で開いていたが、
    // iPhone では Safari に新しいタブができてから中身だけが Yahoo!マップのアプリへ渡り、アプリから
    // 戻ると空のページが挟まっていた（setupIosNearbyGmapLinks と同じ現象。<a target="_blank"> では起きない）。
    document.getElementById('obj-sheet-body').addEventListener('click', (e) => {
        const gmap = e.target.closest('.btn-nav');
        if (gmap) { gmap.href = googleRouteUrl(gmap.dataset.lat, gmap.dataset.lng); return; }
        const btn = e.target.closest('.btn-nav-yahoo');
        if (!btn) return;
        const toLat = btn.dataset.lat;
        const toLng = btn.dataset.lng;
        const toName = btn.dataset.name || '';
        const pin = routeOrigin();
        if (pin) {
            btn.href = yahooRouteUrl(pin.lat, pin.lng, toLat, toLng, toName, '検索地点');
            return;
        }
        if (currentLocation) {
            btn.href = yahooRouteUrl(currentLocation.lat, currentLocation.lng, toLat, toLng, toName);
            return;
        }
        // 未測位（許可ダイアログ未応答・初回測位待ち・測位失敗）の場合はここで改めて要求する。
        // 未許可ならこの getCurrentPosition で許可ダイアログが出る。
        // 取得を待ってから出発地入りで開くには、リンクの遷移を止めて先にタブを確保するしかない
        // （取得完了はユーザー操作の外になり window.open が抑止され得るため）。このときだけは
        // iPhone で戻ったときに空のページが挟まり得るが、出発地を入れて開くことを優先する。
        e.preventDefault();
        const tab = window.open('about:blank', '_blank');
        if (!tab) return;
        const openWithoutOrigin = () => {
            tab.location.href = yahooRouteUrl(null, null, toLat, toLng, toName);   // 目的地だけ渡す（出発地はYahoo側で指定できる）
            showToast('現在地が取得できませんでした。出発地はYahoo!地図で指定してください');
        };
        if (!navigator.geolocation) return openWithoutOrigin();
        navigator.geolocation.getCurrentPosition(
            (pos) => { tab.location.href = yahooRouteUrl(pos.coords.latitude, pos.coords.longitude, toLat, toLng, toName); },
            openWithoutOrigin,
            { enableHighAccuracy: true, timeout: 10000 }
        );
    });

    // 情報シートの省略行トグル（タップで省略 ↔ 全文）。高さが変わるので地図も寄せ直す。
    document.getElementById('obj-sheet-body').addEventListener('click', e => {
        // 遺構の語は図解を出す。省略された行の中にあっても、省略 ↔ 全文の切り替えには回さない
        const word = e.target.closest('.rh-w');
        if (word) { openRemainsHelpPop(word.dataset.rh, word.textContent.trim()); return; }
        const el = e.target.closest('.os-clamp.clampable');
        if (!el) return;
        el.classList.toggle('expanded');
        adjustMapForSheet();
    });

    /* 情報シートのタイトルを長押しでコピーする（GoogleMapで地名を長押しするのと同じ操作）。
       コピーするのは data-copy に入れた素の名前だけで、左のバッジ（城の形態・ジャンル・
       カード番号）も、右の評点も、[近接あり]・[配布] のような表示上の注記も入れない。
       書き込みを「指を離した時」にしているのは、クリップボードへの書き込みがユーザー操作の
       中からでないと拒まれるためで、離した瞬間なら確実にその中に入る。長押し判定の
       setTimeout の中でも通るかは未確認（通らないブラウザがあり得る側に倒してある）。
       500ms 経った時点では色を変えて合図するだけにして、離した瞬間にコピーする。 */
    (() => {
        const body = document.getElementById('obj-sheet-body');
        let timer = null, ready = null, touched = false;
        const disarm = () => {
            if (timer) { clearTimeout(timer); timer = null; }
            if (ready) { ready.classList.remove('os-name-copying'); ready = null; }
        };
        const arm = (el) => {
            disarm();
            timer = setTimeout(() => {
                timer = null;
                ready = el;
                el.classList.add('os-name-copying');
            }, 500);
        };
        const fire = async () => {
            const el = ready;
            disarm();
            if (!el) return;
            const text = el.dataset.copy || el.textContent.trim();
            const ok = await copyToClipboard(text);
            showToast(ok ? `「${text}」をコピーしました` : 'コピーできませんでした');
        };
        body.addEventListener('touchstart', e => {
            const el = e.target.closest('.os-name');
            if (el) arm(el);
        }, { passive: true });
        body.addEventListener('touchmove', disarm, { passive: true });   // スクロールに転じたら取り消す
        body.addEventListener('touchcancel', disarm);
        body.addEventListener('touchend', () => {
            touched = true;                                   // 直後に合成される mouse で二度動かさない
            setTimeout(() => { touched = false; }, 600);
            fire();
        });
        body.addEventListener('mousedown', e => {
            const el = e.target.closest('.os-name');
            if (el && e.button === 0 && !touched) arm(el);
        });
        body.addEventListener('mouseup', e => { if (e.button === 0 && !touched) fire(); });
        body.addEventListener('mouseleave', disarm);
        body.addEventListener('contextmenu', e => { if (e.target.closest('.os-name')) e.preventDefault(); });
    })();

    // 情報シートを下スワイプで閉じる（3ドロワー共通の実装）
    enableSheetSwipeClose(
        document.getElementById('obj-sheet'),
        document.getElementById('obj-sheet-header'),
        closeObjSheet
    );

    // 情報シートの写真タップで全画面ビューアを開く。
    // 城の写真は injectCastleImage で後から差し込まれるので、委譲で拾う。
    document.getElementById('obj-sheet-body').addEventListener('click', async (e) => {
        const img = e.target.closest('.os-photo img');
        if (!img) return;
        const ctx = objSheetCtx || {};
        // 城だけは取得元が複数ある。拡大したときに残りも取りに行き、左右スワイプで見比べられる。
        if (ctx.type === 'castle' && ctx.p) {
            const name = ctx.p.name || ctx.label || '';
            const cached = castleImgAllCache[name];
            if (cached) { openPhotoViewer(cached, img.src); return; }
            openPhotoViewer([{ url: img.src, label: '' }], img.src);   // まず表示中の1枚で開く
            const all = await fetchCastleImagesAll(name, ctx.p.url, ctx.p.shiroHbUrl);
            // 取得を待つ間に閉じられていたら差し替えない
            if (all.length && isPhotoViewerOpen()) openPhotoViewer(all, img.src);
            return;
        }
        openPhotoViewer([{ url: img.src, label: '' }], img.src);
    });

    // 情報帯の高さが変わったら写真側の余白も追従させる（出典切替での住所・出典名の行数変化、
    // 端末回転による折り返しの変化）。pvRender はドラッグ中に毎フレーム走るので、
    // そこで offsetHeight を読むと強制レイアウトが挟まる。監視側に任せる。
    if (window.ResizeObserver) {
        new ResizeObserver(pvSyncInfoHeight).observe(document.getElementById('pv-info'));
    }

    // ── 写真ビューアの操作（案G: 等倍=出典切替 / 拡大中=パン / 2本指=ピンチ） ──
    (function () {
        const viewer = document.getElementById('photo-viewer');
        // 情報帯（閉じるボタンを含む）の上で始まった操作はジェスチャとして扱わない
        const isUiTarget = (t) => t.closest('#pv-info');

        viewer.addEventListener('pointerdown', (e) => {
            if (isUiTarget(e.target)) return;
            pvPtr.set(e.pointerId, { x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t0: e.timeStamp });
            try { viewer.setPointerCapture(e.pointerId); } catch (_) {}
            if (pvPtr.size === 2) {
                const [a, b] = [...pvPtr.values()];
                pvPinchDist = Math.hypot(a.x - b.x, a.y - b.y);
                pvPinchStart = pvScale;
                pvAxis = 'pinch';
            } else if (pvPtr.size === 1) {
                pvAxis = null;   // 縦横どちらに倒れたかは最初の移動で決める
                pvPanFrom = { x: e.clientX - pvX, y: e.clientY - pvY };
            }
        });

        viewer.addEventListener('pointermove', (e) => {
            const p = pvPtr.get(e.pointerId);
            if (!p) return;
            p.x = e.clientX; p.y = e.clientY;
            if (pvPtr.size === 2) {
                const [a, b] = [...pvPtr.values()];
                const d = Math.hypot(a.x - b.x, a.y - b.y);
                pvScale = Math.min(PV_MAX_SCALE, Math.max(1, pvPinchStart * (d / (pvPinchDist || 1))));
                if (pvScale <= 1.001) { pvX = 0; pvY = 0; }
                pvRender();
                return;
            }
            const dx = e.clientX - p.x0, dy = e.clientY - p.y0;
            if (pvScale > 1.02) {
                pvX = e.clientX - pvPanFrom.x;
                pvY = e.clientY - pvPanFrom.y;
                pvRender();
            } else {
                if (!pvAxis && (Math.abs(dx) > PV_SLOP || Math.abs(dy) > PV_SLOP)) {
                    pvAxis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
                }
                if (pvAxis === 'x' && pvSources.length > 1) { pvDragDX = dx; pvRender(); }
                // 下スワイプは指に追従させ、どこまで引けば閉じるかを見せる（上方向は動かさない）
                if (pvAxis === 'y') { pvY = Math.max(0, dy); pvSetDismissProgress(pvY); pvRender(); }
            }
        });

        const endPointer = (e) => {
            const p = pvPtr.get(e.pointerId);
            if (!p) return;
            const dx = e.clientX - p.x0, dy = e.clientY - p.y0;
            pvPtr.delete(e.pointerId);
            if (pvPtr.size > 0) return;

            if (pvAxis === 'x') {
                if (dx < -PV_SWITCH_DIST && pvIdx < pvSources.length - 1) { pvIdx++; pvScale = 1; pvX = 0; pvY = 0; }
                else if (dx > PV_SWITCH_DIST && pvIdx > 0) { pvIdx--; pvScale = 1; pvX = 0; pvY = 0; }
                pvDragDX = 0; pvAxis = null; pvPanFrom = null;
                pvRender(true);
                return;
            }
            if (pvAxis === 'y') {
                pvAxis = null; pvPanFrom = null;
                const speed = dy / Math.max(1, e.timeStamp - p.t0);
                if (dy > PV_CLOSE_DIST || (dy > PV_SLOP && speed > PV_FLICK_SPEED)) return closePhotoViewer();
                pvY = 0;                       // 届かなければ元の位置へ戻す
                pvSetDismissProgress(0, true);
                pvRender(true);
                return;
            }
            if (pvAxis === 'pinch') { pvAxis = null; pvPanFrom = null; pvRender(); return; }
            // 動いていなければタップ扱い → UIの表示/非表示をトグル
            if (Math.abs(dx) < 6 && Math.abs(dy) < 6) pvUI = !pvUI;
            pvAxis = null; pvPanFrom = null;
            pvRender();
        };
        viewer.addEventListener('pointerup', endPointer);
        viewer.addEventListener('pointercancel', endPointer);

        // ダブルタップで2.5倍 ⇄ 等倍
        let lastTap = 0;
        viewer.addEventListener('click', (e) => {
            if (isUiTarget(e.target)) return;
            const now = Date.now();
            if (now - lastTap < 320) {
                if (pvScale > 1) { pvScale = 1; pvX = 0; pvY = 0; } else { pvScale = 2.5; }
                pvRender(true);
            }
            lastTap = now;
        });

        // PCでの確認用。実機はピンチを使う
        viewer.addEventListener('wheel', (e) => {
            e.preventDefault();
            pvScale = Math.min(PV_MAX_SCALE, Math.max(1, pvScale * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
            if (pvScale <= 1.001) { pvX = 0; pvY = 0; }
            pvRender();
        }, { passive: false });
    })();

    // PCでの確認用に Esc でも閉じられるようにする（実機は×ボタン）
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isPhotoViewerOpen()) closePhotoViewer();
    });

