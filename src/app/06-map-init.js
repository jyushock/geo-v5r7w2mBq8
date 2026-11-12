    /* 地図タイル。どちらの選択肢もベクタータイルで、違うのはスキーマだけ。
         openfreemap : OpenFreeMap Liberty（OpenMapTiles スキーマ）
         osm         : OSM公式ベクター（Shortbread v1 スキーマ ＋ VersaTiles Colorful）
       2026-09-01 に osm をラスター（tile.openstreetmap.org/{z}/{x}/{y}.png）から差し替えた。
       拡大時のボヤケを無くし、両方の選択肢をベクターで揃えるため。
       スキーマが違うとレイヤーIDも属性名も一致しない（rank と class は Shortbread に
       無い）ので、style.load の調整は isOsmVector で丸ごと分岐する。

       osm のスタイルJSONを配信元から直接読んではならない。
       vector.openstreetmap.org の /styles/ 配下（style.json・グリフ・スプライト）は
       CORS が localhost と www.openstreetmap.org にしか開いておらず、本番オリジンには
       Access-Control-Allow-Origin が返らずブロックされる（2026-09-02 に実測）。
       localhost では通ってしまうため、ローカル配信での確認だけでは気付けない。
       そこで style.json とスプライトを osm-shortbread/ に取り込み、グリフは CORS が
       * の OpenFreeMap に振ってある（生成手順は GetTabelog の README を参照）。
       タイル本体（*.mvt）だけは ACAO が * なので配信元から直接読む。 */
    const mapTileSource = storeGet('mapTileSource') || 'openfreemap';
    const isOsmVector   = mapTileSource === 'osm';
    const mapStyle = isOsmVector
        ? './osm-shortbread/style.json'
        : 'https://tiles.openfreemap.org/styles/liberty';
    const map = new maplibregl.Map({
        container: 'map',
        style: mapStyle,
        center:  savedState ? [savedState.lng, savedState.lat] : [139.76, 35.68],
        zoom:    savedState ? savedState.zoom    : 11,
        bearing: savedState ? savedState.bearing : 0,
        pitch:   savedState ? savedState.pitch   : 0,
        attributionControl: false
    });
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

    /* スプライトに無いアイコンの肩代わり。Liberty のスプライト264個に対し、
       実際に配信される POI の class のうち26種（日本の z14 9枚で4,748件、うち名前あり
       2,405件。最多は office の2,027件）にアイコンが無い。放っておくと文字だけが並び、
       コンソールに Image "office" could not be loaded が種類ごとに出る。
       maplibre 6.0.0 の setMissingStyleImageResolver で、欠けたぶんに共通の点を入れる。
       ノイズになる種別（車止め・門・駐輪場など）はそもそも tuneLibertyStyle 側の
       excludedPoiClasses で落としてあるので、ここへ来るのは office・atm・
       スポーツ施設・フェリー乗り場のような、出したいが絵の無いものだけ。 */
    function genericPoiIcon() {
        const px = 16, canvas = document.createElement('canvas');
        canvas.width = canvas.height = px;
        const g = canvas.getContext('2d');
        g.beginPath(); g.arc(px / 2, px / 2, 5, 0, Math.PI * 2);
        g.fillStyle = '#FFFFFF'; g.fill();          // 白フチ（背景に埋もれないように）
        g.beginPath(); g.arc(px / 2, px / 2, 3.5, 0, Math.PI * 2);
        g.fillStyle = '#8A8A8A'; g.fill();          // 本体はラベルの文字色に寄せた灰
        return g.getImageData(0, 0, px, px);
    }
    if (map.setMissingStyleImageResolver) {
        map.setMissingStyleImageResolver((id) => {
            if (!id || map.hasImage(id)) return;
            // pixelRatio 2 なので画面上は 8x8。既存のPOIアイコン(15x15前後)より控えめに出る
            map.addImage(id, genericPoiIcon(), { pixelRatio: 2 });
        });
    }

    // ダブルタップズームをアニメーション付きに統一（iOS対応）
    // デフォルトのdoubleClickZoomを無効化し、touchend自前検出＋dblclickの両方でeaseTo
    map.doubleClickZoom.disable();
    let lastTapTime = 0;
    let lastTapLngLat = null;
    map.getCanvas().addEventListener('touchend', (e) => {
        if (e.touches.length !== 0) return;
        if (e.changedTouches.length !== 1) return;
        const now = Date.now();
        const dt = now - lastTapTime;
        if (dt < 300 && dt > 30 && lastTapLngLat) {
            e.preventDefault();
            map.easeTo({
                zoom: map.getZoom() + 1,
                center: lastTapLngLat,
                duration: 300,
                essential: true
            });
            lastTapTime = 0;
            lastTapLngLat = null;
        } else {
            lastTapTime = now;
            const touch = e.changedTouches[0];
            lastTapLngLat = map.unproject([touch.clientX, touch.clientY]);
        }
    }, { passive: false });
    // Android・PC向けにdblclickも対応
    map.on('dblclick', (e) => {
        e.preventDefault();
        map.easeTo({
            zoom: map.getZoom() + 1,
            center: e.lngLat,
            duration: 300,
            essential: true
        });
    });

