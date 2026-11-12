    // ── 天気ウィジェット（スクリプト先頭で初期化）──────────────────
    // WMOコード → スタンプアイコンのファイル名（weather-icons/stamp/＜名前＞.png）
    var WMO_ICON = {
        0:'clear-day', 1:'partly-cloudy-day', 2:'cloudy', 3:'overcast-day',
        45:'fog', 48:'fog',
        51:'drizzle', 53:'drizzle', 55:'drizzle', 56:'drizzle', 57:'drizzle',
        61:'rain', 63:'rain', 65:'rain', 66:'rain', 67:'rain',
        71:'snow', 73:'snow', 75:'snow', 77:'snow',
        80:'partly-cloudy-day-rain', 81:'partly-cloudy-day-rain', 82:'partly-cloudy-day-rain',
        85:'partly-cloudy-day-snow', 86:'partly-cloudy-day-snow',
        95:'thunderstorms-day-rain', 96:'thunderstorms-day-rain', 99:'thunderstorms-day-rain',
    };
    // アイコン名 → 天気別カラー（CSS maskのbackground-colorに使用）
    var WMO_COLOR = {
        'clear-day':'#FB8C00', 'partly-cloudy-day':'#F59E0B', 'cloudy':'#607D8B', 'overcast-day':'#546E7A',
        'fog':'#78909C', 'drizzle':'#0288D1', 'rain':'#1976D2', 'partly-cloudy-day-rain':'#1E88E5',
        'snow':'#0097A7', 'partly-cloudy-day-snow':'#26A69A', 'thunderstorms-day-rain':'#5E35B1',
    };
    var weatherCache = null;
    var weatherCacheTime = 0;
    var weatherCacheLat = null;
    var weatherCacheLng = null;
    var selectedWeatherDayIndex = null;
    var WEATHER_CACHE_TTL = 10 * 60 * 1000;

    // ── 大容量データの非同期ローダ ─────────────────────────────────
    // data/castle/michi/manhole/pokemon/mhcard はここで動的に読み込む。
    // 各データ到着時に対応する地図ソースを埋め、検索インデックスを再構築する。
    // 表示中レイヤーを優先し、残りは背景で逐次取得（全件検索を維持）。
    const EMPTY_FC = { type: 'FeatureCollection', features: [] };
    const FAMOUS_GENRES = new Set(['日本100名城', '続日本100名城']);
    const loadedData = Object.create(null); // key -> FeatureCollection
    // お気に入りの「薄く出す」枠に入っているキー（中身は favComputeHiddenKeys）。
    // 元のソースから外し、最背面の薄いピン（fav-dim-objects）で描き直す。
    // 地図のソースを埋める関数が読むので、データの到着より前に在るようここで宣言する
    var favHiddenKeys = new Set();

    function loadScriptOnce(src) {
        return new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = src; s.async = true;
            s.onload = () => resolve();
            s.onerror = () => reject(new Error('load failed: ' + src));
            document.head.appendChild(s);
        });
    }

    function setSourceData(id, fc) {
        const src = map.getSource(id);
        if (src) src.setData(fc);
    }

    /* 食べログの部門・ポケふたは、レイヤーの visibility では出し入れできない。
       どちらもソースの中の一部（部門／source:'pokefuta'）だけを消す話で、
       shops と manholes は cluster:true のためクラスタの件数がソース側で決まるからで、
       レイヤーに filter を掛けても丸の中の数字は絞る前のままになる。
       そこで、表示設定を反映した features をソースへ入れ直す。
       件数は食べログ7,077・マンホール1,267・ポケふた482で、入れ直しは一瞬で済む。 */
    function shopFeaturesForMap() {
        const fc = loadedData.shops;
        if (!fc) return EMPTY_FC;
        if (!genreOff.size && !favHiddenKeys.size) return fc;   // 絞っていないときは元の配列をそのまま渡す
        return { type: 'FeatureCollection',
                 features: fc.features.filter(f => genreVisible(shopGenreBase(f.properties.category))
                                                   && !favHiddenOnMap('shop', f)) };
    }
    function manholeFeaturesForMap() {
        // 蓋とポケふたは1つのソースに同居している。ポケふたは source:'pokefuta' で見分ける
        const mh = (filterState.manhole !== false && loadedData.manhole)
            ? favVisibleFeatures('manhole', loadedData.manhole.features) : [];
        const pk = (filterState.pokefuta !== false && loadedData.pokefuta)
            ? favVisibleFeatures('pokefuta', loadedData.pokefuta.features)
                .map(f => ({ ...f, properties: { ...f.properties, source: 'pokefuta' } })) : [];
        return { type: 'FeatureCollection', features: [...mh, ...pk] };
    }
    function refreshShopSource()    { setSourceData('shops',    shopFeaturesForMap()); }
    function refreshManholeSource() { setSourceData('manholes', manholeFeaturesForMap()); }
    function refreshMichiSource() {
        if (loadedData.michi) setSourceData('michi', favVisibleFc('michi', loadedData.michi));
    }
    function refreshMhcardSource() {
        if (loadedData.mhcard) setSourceData('mhcards', favVisibleFc('mhcard', loadedData.mhcard));
    }
    function refreshCastleSources() {
        if (!loadedData.castle) return;
        const feats = favVisibleFeatures('castle', loadedData.castle.features);
        setSourceData('castles-famous', { type: 'FeatureCollection', features: feats.filter(f => FAMOUS_GENRES.has(f.properties.genre)) });
        setSourceData('castles',        { type: 'FeatureCollection', features: feats.filter(f => !FAMOUS_GENRES.has(f.properties.genre)) });
    }

    // 各データ到着時にソースへ反映（manholeは2データの合成、castleは2分割）
    function applyDataset(key) {
        if (key === 'michi')  refreshMichiSource();
        if (key === 'shops')  refreshShopSource();
        if (key === 'mhcard') refreshMhcardSource();
        if (key === 'castle' && loadedData.castle) {
            refreshCastleSources();
            lordIndex = null;        // 城データが入れ替わったら城主索引は作り直す
            updateLordsEntry();
            remainsIndex = null;     // 遺構索引も同じ理由で作り直す
            remainsGroups = null;
            updateRemainsEntry();
        }
        if (key === 'manhole' || key === 'pokefuta') refreshManholeSource();
        buildSearchIndex(); // 到着済みデータで全件検索を再構築
        refreshFavOverlay();     // お気に入りの重ね描きは searchIndex から作るので、揃えて作り直す
        prefIndex = null;   // 都道府県索引は searchIndex から組むので作り直させる
        objGenreCounts = null;   // 部門の件数も searchIndex から数えるので数え直させる
        updatePrefEntry();
        // 設定を開いたまま食べログが届いたときのために、開いていれば描き直す
        if (document.getElementById('nearby-settings-view').classList.contains('open')) renderObjFilterUI();
        // 書き出しを開いたまま残りのデータが届くことがある。件数と可否を出し直す
        renderFavExport();
    }

    // 表示中レイヤーを優先して逐次ロード（パースのジャンクを抑えるため直列）
    function startDataLoading() {
        // 並びは種別の共通順（食べログ→ポケふた→マンホール→カード配布→道の駅→城）。
        // 下の sort は安定なので、表示中グループ・非表示グループそれぞれの中では
        // この順のまま読む。地図のピンの重なり順（configs）とは別物で揃える必要はない
        const specs = [
            { key: 'shops',    src: 'data.js',    get: () => shopData,          vis: filterState.shop    !== false },
            { key: 'pokefuta', src: 'pokemon.js', get: () => pokefutaGeoJSON,   vis: filterState.pokefuta !== false },
            { key: 'manhole',  src: 'manhole.js', get: () => manholeGeoJSON,    vis: filterState.manhole !== false },
            { key: 'mhcard',   src: 'mhcard.js',  get: () => mhcardGeoJSON,     vis: filterState.mhcard  !== false },
            { key: 'michi',    src: 'michi.js',   get: () => michiNoEkiGeoJSON, vis: filterState.michi   !== false },
            { key: 'castle',   src: 'castle.js',  get: () => castleData,        vis: filterState.castle  !== false },
        ];
        specs.sort((a, b) => (b.vis ? 1 : 0) - (a.vis ? 1 : 0)); // 表示中を先頭へ
        let chain = Promise.resolve();
        specs.forEach(spec => {
            chain = chain.then(() => loadScriptOnce(spec.src)
                .then(() => { loadedData[spec.key] = spec.get(); applyDataset(spec.key); })
                .catch(e => console.warn('[data]', spec.src, e)));
        });
    }

    const savedState = storeGetJson('mapState');

    const savedSettings = storeGetJson('settingsState');

