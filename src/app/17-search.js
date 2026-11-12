    // ══════════════════════════════════════════════════════════════
    //  検索機能
    // ══════════════════════════════════════════════════════════════
    // カタカナ→ひらがな変換。NFKCで全角/半角（英数字・半角カナ）を先に統一してから適用する
    function toHiragana(str) {
        return str.replace(/[ァ-ヶ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));
    }
    function normalizeForSearch(str) {
        if (!str) return '';
        return toHiragana(str.normalize('NFKC')).toLowerCase();
    }
    // 完全一致=100 / 含む=50 / 不一致=0（text・qは正規化済み前提）
    // 前方一致を部分一致より上にしない。上にすると、すぐ近くの店でも語が名前の途中にあるだけで
    // 前方一致した遠くの店の下に沈む（郡山駅から「パン」で、0.9kmの大友パン店が、
    // 「パン◯◯」で始まる190km以上先の24件より下の25番目になっていた）
    function matchScore(text, q) {
        if (!text || !q) return 0;
        if (text === q) return 100;
        if (text.includes(q)) return 50;
        return 0;
    }

    /* 食べログの照合は name 全体（店名＋駅＋ジャンル）に掛かるので、店名に無い語でも当たる。
       名前は店名だけを出すようにしたため、当たった語が画面のどこにも出ない結果が生まれる
       （例: 「担々麺」で出る創作麺工房 鳴龍は、店名にもバッジ「ラーメン」にも担々麺が無い）。
       そこで店名で当たっていないときだけ、当たった側を住所の行に添える。
       別名で当たったときに「（別名: ◯◯）」を出しているのと同じ扱い。
       q は照合と同じ normalizeForSearch を通した文字列を渡すこと。 */
    function shopMatchedPart(p, q) {
        if (!q) return null;
        const sp = shopParts(p);
        if (normalizeForSearch(sp.shop).includes(q)) return null;
        if (sp.station && normalizeForSearch(sp.station).includes(q)) return `駅: ${sp.station}`;
        if (sp.genre && normalizeForSearch(sp.genre).includes(q)) return `ジャンル: ${sp.genre}`;
        return null;
    }
    // 住所の行に前置きする括弧書き。当たり方が分かるものが無ければ空文字
    function matchNoteHtml(alias, part) {
        if (alias) return `（別名: ${attrEscape(alias)}）`;
        return part ? `（${attrEscape(part)}）` : '';
    }

    let searchIndex = [];
    let favSnapIndex = null;      // 元の座標へ寄せるための索引（下の favSnapCoords が作る）
    /* 種別ごとの索引の控え。データは届くたびにこの関数が呼ばれるので（6回）、以前は毎回
       全種別を作り直していた（2026-11-12 に実測、合計でこのPCで127ms・CPU 4倍遅くで612ms）。
       届いたデータの分だけ作り、並びは下の sources の順のまま（検索結果の順を変えない）。
       元のデータ（loadedData の各値）が別のものに替わったら、その種別だけ作り直す */
    const searchIndexParts = new Map();   // type → { data, items }
    function buildSearchIndex() {
        searchIndex = [];
        favSnapIndex = null;      // 元の座標へ寄せるための索引も作り直させる
        // loadedData に到着済みのデータのみ対象（未読込分は届き次第この関数が再実行される）
        const sources = [
            { type: 'pokefuta', data: loadedData.pokefuta, labelKey: 'pokemon', subKey: 'address' },
            { type: 'manhole',  data: loadedData.manhole,  labelKey: 'name',    subKey: 'address' },
            { type: 'mhcard',   data: loadedData.mhcard,   labelKey: 'name',    subKey: 'address' },
            { type: 'castle',   data: loadedData.castle,   labelKey: 'name',    subKey: 'address' },
            { type: 'michi',    data: loadedData.michi,    labelKey: 'name',    subKey: 'address' },
            { type: 'shop',     data: loadedData.shops,    labelKey: 'name',    subKey: 'address' }
        ];
        sources.forEach(s => {
            if (!s.data || !s.data.features) return;
            let part = searchIndexParts.get(s.type);
            if (!part || part.data !== s.data) {
                const items = [];
                s.data.features.forEach(f => {
                    const label = f.properties[s.labelKey] || '';
                    const sub = s.sub || f.properties[s.subKey] || '';
                    items.push({
                        type: s.type, label, sub, coords: f.geometry.coordinates, properties: f.properties,
                        _normLabel: normalizeForSearch(label), _normSub: normalizeForSearch(sub)
                    });
                });
                part = { data: s.data, items };
                searchIndexParts.set(s.type, part);
            }
            for (const item of part.items) searchIndex.push(item);
        });
    }

    /* 地図のピンをタップして返る座標を、元のデータの座標へ寄せる。

       MapLibre は GeoJSON ソースも内部でタイル（1タイル4096分割）に載せ直すため、
       クリックの `e.features[0].geometry.coordinates` は元の値と一致しない。
       実測（2026-08-20、maplibre-gl 3.6.2）では 139.76543,35.68123 の1点が
         z=14 … 139.765430 / z=11 … 139.765427 / z=8 … 139.765491
       で返り、z=8 では4桁に丸めた値が 139.7654 から 139.7655 へ動いた。

       お気に入りのキーは座標を4桁（約11m）に丸めて作るので、丸めが1つ動くと
       別のキーになる。すると印は付いたのに、地図のバッジにも一覧にも出ない
       （どちらも searchIndex の正しい座標から引くため）。シートだけは同じずれた
       座標から同じキーを作り直すので、そこにだけ付いて見える。
       再起動しても出てこないため、外れたようにしか見えない。

       そこで、タップした地物に対応する searchIndex の要素を名前で引き当て、
       いちばん近いものの座標に差し替える。名前が重なる城（「松本城」は5件ある）でも、
       離れた同名は距離で落ちる。引き当てられなければ触らない。 */
    function favSnapNameKey(type, p) {
        p = p || {};
        // ポケふたは地図では type='manhole'＋source='pokefuta' で来る（favKeyOf と同じ扱い）
        const t = (type === 'manhole' && p.source === 'pokefuta') ? 'pokefuta' : type;
        return `${t}\0${p.name || p.pokemon || ''}`;
    }
    function favSnapCoords(type, p, c) {
        if (!Array.isArray(c) || !searchIndex.length) return c;
        if (!favSnapIndex) {
            favSnapIndex = new Map();
            for (const item of searchIndex) {
                const k = favSnapNameKey(item.type, item.properties);
                const a = favSnapIndex.get(k);
                if (a) a.push(item); else favSnapIndex.set(k, [item]);
            }
        }
        const list = favSnapIndex.get(favSnapNameKey(type, p));
        if (!list) return c;
        let best = null, bestD = Infinity;
        for (const it of list) {
            const ic = it.coords || [];
            const d = Math.abs(ic[0] - c[0]) + Math.abs(ic[1] - c[1]);
            if (d < bestD) { bestD = d; best = ic; }
        }
        // 0.005度（約500m）より遠いものは別物とみなす。タイルのずれはこれより十分小さい
        return (best && bestD < 0.005) ? [best[0], best[1]] : c;
    }

    const typeConfig = {
        pokefuta: { color: '#FBBC04', img: 'manhole.png', label: 'ポケふた' },
        manhole:  { color: '#B87333', img: 'manhole.png', label: 'マンホール' },
        mhcard:   { color: '#1565C0', img: 'manhole.png', label: 'マンホールカード配布' },
        castle:   { color: '#8A8A8A', img: 'castle.png',  label: 'お城' },
        michi:    { color: '#0B499D', img: 'michi.png',   label: '道の駅' },   /* 色は道の駅紋章の地色 */
        shop:     { color: '#FFAA00', img: 'tabe.png',    label: '食べログ' },   /* 色は食べログのアイコンの地色 */
        place:    { color: '#4285F4', icon: '📍',        label: '地名' },
    };
    /* 地名(place)のうち駅だけは、📍の青丸ではなく濃い灰の角丸四角＋電車の線画にする
       （駅名標を思わせる形。mock/station-icon-preview.html の案C）。
       判定は searchGeocode が地理院の応答から付ける _station で、通信は増えない */
    const STATION_ICON_COLOR = '#455A64';
    const STATION_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><rect x="5.5" y="3" width="13" height="14" rx="3"/><line x1="5.5" y1="10.5" x2="18.5" y2="10.5"/><line x1="9" y1="13.8" x2="9.01" y2="13.8"/><line x1="15" y1="13.8" x2="15.01" y2="13.8"/><line x1="9" y1="17" x2="7" y2="21"/><line x1="15" y1="17" x2="17" y2="21"/></svg>';
    /* 道の駅のアイコン背景だけは丸ではなく角丸四角にする（地図のピンと形を合わせる） */
    function objIconSquareClass(type) {
        return type === 'michi' ? ' obj-ic-sq' : '';
    }
    function getItemColor(item) {
        if (item.type === 'castle') {
            const genre = item.properties && item.properties.genre;
            if (genre === '日本100名城') return CASTLE_MEIJO_COLOR;
            if (genre === '続日本100名城') return CASTLE_ZOKU_MEIJO_COLOR;
        }
        return (typeConfig[item.type] || {}).color || '#1a1a1a';
    }

    /* いま地図に出ているものか。種別のOFF（設定のオブジェクト表示）と、食べログだけにある
       部門のOFF（同じ設定を長押しして選ぶ）の両方を見る。検索・周辺検索・着地ズームの
       近傍探索が同じものを対象にするよう、判定はここ1か所に置く。 */
    const OBJ_FILTER_KEY = {
        shop: 'shop', castle: 'castle', michi: 'michi',
        manhole: 'manhole', pokefuta: 'pokefuta', mhcard: 'mhcard'
    };
    function objShownOnMap(item) {
        const filterKey = OBJ_FILTER_KEY[item.type];
        if (filterKey && filterState[filterKey] === false) return false;
        return item.type !== 'shop' || genreVisible(shopGenreBase((item.properties || {}).category));
    }

    function searchLocal(query) {
        const q = normalizeForSearch(query);
        // 一致度（完全一致>含む>住所で一致）を優先し、同スコア内は
        // 周辺検索・天気と同じ基準点からの距離が近い順に並べて上位100件を返す。
        // 別名で当たったものは名前で当たったものと同じ点にする。減点すると、すぐ近くの城でも
        // 名前が一致した遠くの城の下に沈む（八王子市から「根小屋」で、別名「根小屋城」の
        // 戸吹城 6km が、名前に根小屋を含む73〜505kmの10件より下の11番目になっていた）
        const center = getSearchCenter();
        const matched = [];
        for (const item of searchIndex) {
            if (!objShownOnMap(item)) continue;
            const labelScore = matchScore(item._normLabel, q);
            const subScore = matchScore(item._normSub, q);
            if (labelScore > 0 || subScore > 0) {
                // 店名で当たっていないときだけ、駅・ジャンルのどちらで当たったかを持たせる
                matched.push({ ...item, _matchedAlias: null,
                    _matchedPart: item.type === 'shop' ? shopMatchedPart(item.properties, q) : null,
                    _score: Math.max(labelScore, subScore * 0.5) });
                continue;
            }
            const aliases = item.properties && item.properties.aliases;
            if (Array.isArray(aliases)) {
                let bestScore = 0, bestAlias = null;
                for (const a of aliases) {
                    const s = matchScore(normalizeForSearch(a), q);
                    if (s > bestScore) { bestScore = s; bestAlias = a; }
                }
                if (bestAlias) matched.push({ ...item, _matchedAlias: bestAlias, _score: bestScore });
            }
        }
        return matched.map(item => ({
            ...item,
            _dist: (item.coords && item.coords.length >= 2)
                ? calcDist(center.lat, center.lng, item.coords[1], item.coords[0])
                : Infinity
        })).sort((a, b) => (b._score - a._score) || (a._dist - b._dist)).slice(0, 100);
    }
    
    let geocodeTimer = null, searchRequestId = 0;
    // muni.js辞書: addressCode → "都道府県市区町村"
    let muniDict = {};
    fetch('https://maps.gsi.go.jp/js/muni.js')
        .then(r => r.text())
        .then(js => {
            const re = /MUNI_ARRAY\["(\d+)"\]\s*=\s*'(\d+),([^,]+),\d+,([^']+)'/g;
            let m;
            while ((m = re.exec(js)) !== null) {
                const pref = m[3].trim().replace(/[\s　]/g, '');
                const city = m[4].trim().replace(/[\s　]/g, '');
                muniDict[m[1]] = `${pref}${city}`;
            }
        })
        .catch(() => {});

    async function searchGeocode(query) {
        try {
            const res = await fetch(`https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(query)}`);
            const data = await res.json();
            const center = getSearchCenter(); // 基準点（周辺検索・天気と同じ）
            /* 「所沢」と入れたら所沢駅を先頭に出す。地理院は語に「駅」を付けなくても駅を返すが、
               近い順だけで24件に絞ると駅が落ちる（東京駅から「大宮」で大宮駅は43位）。
               「入力語＋駅」ちょうど→名前に入力語を含む他の駅→その他、の順にし、各段の中は近い順。
               問い合わせに「駅」を足すと「パン駅」が0件になるなど駅以外が消えるので、並べ方だけで行う。
               「駅で終わる」だけで一段にすると、東京駅から「新宿」で新宿御苑前駅が新宿駅より上に来る。
               「新宿駅」と駅まで入れたときは、それ自体をちょうどの名前にする（東新宿駅を上にしない） */
            const qn = normalizeForSearch(query);
            const exactStation = qn.endsWith('駅') ? qn : qn + '駅';
            const placeRank = (label) => {
                const ln = normalizeForSearch(label);
                if (ln === exactStation) return 0;
                if (ln.endsWith('駅') && ln.includes(qn)) return 1;
                return 2;
            };
            return data.map(f => {
                const title = f.properties.title;
                const code  = f.properties.addressCode || '';

                let label, sub;
                if (code) {
                    // addressCodeがある場合: labelはtitle、subは都道府県＋市区町村
                    const prefCity = muniDict[code] || muniDict[String(parseInt(code, 10))] || '';
                    label = title;
                    sub   = prefCity;
                } else {
                    // addressCodeが空の場合: titleに都道府県が含まれている
                    label = title;
                    sub   = title;
                }

                // labelとsubが同じ場合はsubを空に
                if (label === sub) sub = '';

                const c = f.geometry.coordinates;
                const _dist = (c && c.length >= 2) ? calcDist(center.lat, center.lng, c[1], c[0]) : Infinity;
                /* 駅か。dataSource 1（地名・施設）で名前が「駅」で終わるもの。
                   住所（dataSource 5）にも「郡山駅」のような駅で終わる字があるので、名前だけでは見ない */
                const _station = f.properties.dataSource === '1' && label.endsWith('駅');
                return { type: 'place', label, sub, coords: c, properties: {}, _dist, _rank: placeRank(label), _station };
            }).sort((a, b) => (a._rank - b._rank) || (a._dist - b._dist)).slice(0, 24);
        } catch { return []; }
    }

    function renderResults(localItems, placeItems) {
        const inner = document.getElementById('search-results-inner');
        inner.innerHTML = '';
        if (localItems.length === 0 && placeItems.length === 0) {
            inner.innerHTML = '<div style="padding:14px;text-align:center;color:#999;font-size:13px;grid-column:1/-1;">候補が見つかりません</div>';
        } else {
            const makeItem = (item, col) => {
                const cfg = typeConfig[item.type];
                const isMhcard = item.type === 'mhcard';
                const div = document.createElement('div');
                div.className = 'search-result-item';
                const iconPart = isMhcard
                    ? `<div style="position:relative;width:var(--mhcard-w);height:var(--mhcard-h);flex-shrink:0;background:#e2ddd4;border-radius:6px;"><img src="mhcard.png" style="width:100%;height:100%;display:block;"><img src="manhole.png" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:var(--mhcard-badge);height:var(--mhcard-badge);filter:brightness(0) invert(1);pointer-events:none;"></div>`
                    : item._station
                    ? `<div class="search-result-icon sr-station" style="background:${STATION_ICON_COLOR}">${STATION_ICON_SVG}</div>`
                    : `<div class="search-result-icon${objIconSquareClass(item.type)}" style="background:${getItemColor(item)}">${cfg.img ? `<img src="${cfg.img}"${cfg.img === 'manhole.png' ? '' : ' class="icon-full"'}>` : cfg.icon}</div>`;
                const subText = `${matchNoteHtml(item._matchedAlias, item._matchedPart)}${item.sub}`;
                // 食べログの部門バッジ。結果は2列で幅が狭いため、店名の行ではなく
                // 住所の行の先頭に小さく置く（店名を押し出さないため）
                const badge = item.type === 'shop' ? shopGenreBadgeHtml(item.properties, 'sr-genre') : '';
                // お気に入りの色帯。周辺検索・都道府県・城主・遺構・お気に入り一覧と同じ出しかた
                // （左padding 10px の中に帯5px＋空き5pxで収まるので、印の有無で中身の位置は動かない）
                div.innerHTML = `${favStripeHtml(item.type, item.properties, item.coords)}${iconPart}<div class="search-result-text"><div class="search-result-name">${itemDisplayName(item)}</div><div class="search-result-sub">${badge}${subText}</div></div>`;
                // 飛んだ先から戻れるよう、この結果一覧そのもの（両列とワード）を持たせて渡す
                div.addEventListener('click', () => searchJumpToItem(item, localItems, placeItems));
                col.appendChild(div);
            };
            const leftCol = document.createElement('div'); leftCol.className = 'search-col';
            const rightCol = document.createElement('div'); rightCol.className = 'search-col';
            if(localItems.length>0) { leftCol.innerHTML='<div class="search-section-header">スポット</div>'; localItems.forEach(item => makeItem(item, leftCol)); }
            if(placeItems.length>0) { rightCol.innerHTML='<div class="search-section-header">地名・場所</div>'; placeItems.forEach(item => makeItem(item, rightCol)); }
            inner.append(leftCol, rightCol);
        }
        // 列は毎回作り直すので、新しい結果はどちらの列も先頭から出る
        // （スクロールするのは外枠ではなく各列 .search-col）
        document.getElementById('search-results').style.display = 'block';
    }

    // 検索結果の各列のスクロール位置。列ごとに独立してスクロールするので [スポット列, 地名列] で持つ
    function searchColScrolls() {
        return [...document.querySelectorAll('#search-results-inner .search-col')].map(c => c.scrollTop);
    }
    function setSearchColScrolls(tops) {
        document.querySelectorAll('#search-results-inner .search-col').forEach((c, i) => { c.scrollTop = tops[i] || 0; });
    }

