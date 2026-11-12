    /* ══ お気に入り ═══════════════════════════════════════════════════════
       枠は4つ。枠に固定の意味は持たせず、名前は設定でユーザーが付ける
       （初期値は枠1の「お気に入り」だけで、残り3枠は空。名前を入れた枠だけを使う）。
       1つのオブジェクトを複数の枠に入れられる。
       見せかたは3か所で、案は mock/fav-badge-preview.html で比べて決めてある。
         地図   … ピンの右上に15pxのバッジ（案1・4色）。マークしたものは全種別のピンより
                  前面に出し、枠どうしは番号の小さい方を前にする
         一覧   … 行の左端に5pxの色帯（案1）。複数の枠に入っていれば縦に等分する
         シート … 上端の縁の色ライン（案ii）
       登録は情報シートの★→パレット（案B）と、お気に入り一覧の行の長押し。
       保存は localStorage の 'favorites' 1本で、キーの選びかたは
       mock/fav-list-preview.html の「5. 保存の形」に全データの実測値が残っている。
       サーバーへ移すときは loadFavStore / saveFavStore の中身だけを差し替える。 */
    const FAV_SLOTS = [1, 2, 3, 4];
    // 色は CSS の :root（--fav1〜4）が持ち主。地図のピンはCSSを通らないのでここで読んでおく
    // （--ui-blue を UI_BLUE に写しているのと同じ扱い）
    const FAV_COLORS = (() => {
        const cs = getComputedStyle(document.documentElement);
        const fallback = { 1: '#E91E63', 2: '#7B1FA2', 3: '#00897B', 4: '#7CB342' };
        const o = {};
        FAV_SLOTS.forEach(n => { o[n] = cs.getPropertyValue(`--fav${n}`).trim() || fallback[n]; });
        return o;
    })();
    // #7CB342 だけ白文字のコントラストが 2.50 しか出ないので、その上に載せる文字は黒にする
    const FAV_FG = { 1: '#fff', 2: '#fff', 3: '#fff', 4: '#212121' };
    const FAV_NAME_MAX = 6;        // 理由は .favname-row のコメント（一覧のチップが2段に収まる上限）
    const FAV_STORE_KEY = 'favorites';
    const FAV_TYPE_FILTER = { shop: 'shop', pokefuta: 'pokefuta', manhole: 'manhole',
                              mhcard: 'mhcard', michi: 'michi', castle: 'castle' };

    /* オブジェクトを1つに定めるキー。実データを数えて種別ごとに選んである（2026-08-19）。
         食べログ 7,369件 … url が欠落0・重複0
         道の駅   1,234件 … 公式の駅ID が欠落0・重複0
         ポケふた   482件 … 公式の連番 が欠落0・重複0
         マンホール 1,267件 … cardCodeKey(cardId) が欠落0・重複0
         カード配布 1,455件 … cardId は欠落562・残りも44種（A001だけで324件）なので使えない。
                              名前＠座標4桁なら衝突0
         お城   23,516件 … url は欠落19,037（81%）。「松本城」だけで5件あり名前単独も不可。
                            名前＠座標4桁なら衝突0
       座標を4桁（約11m）に丸めるのは、データ更新で末尾が1桁動いただけで
       別のオブジェクトになってしまうのを避けるため。
       castle.js を作り直して座標が11m以上動いた城は、マークが外れる（残る弱点）。 */
    function favCoordKey(lng, lat) {
        return `${Number(lng).toFixed(4)},${Number(lat).toFixed(4)}`;
    }
    function favKeyOf(type, p, lng, lat) {
        p = p || {};
        if (lng == null || lat == null || !isFinite(lng) || !isFinite(lat)) return null;
        const nameKey = `${p.name || ''}@${favCoordKey(lng, lat)}`;
        // ポケふたは地図から開くと type='manhole'＋source='pokefuta'、一覧から開くと
        // type='pokefuta' で来る。どちらでも同じキーになるようにする
        if (type === 'pokefuta' || (type === 'manhole' && p.source === 'pokefuta')) {
            return p.id != null && p.id !== '' ? `pokefuta:${p.id}` : `pokefuta:${nameKey}`;
        }
        if (type === 'shop')   return p.url ? `shop:${p.url}` : `shop:${nameKey}`;
        if (type === 'michi')  return p.id != null && p.id !== '' ? `michi:${p.id}` : `michi:${nameKey}`;
        if (type === 'manhole') { const k = cardCodeKey(p.cardId); return k ? `manhole:${k}` : `manhole:${nameKey}`; }
        if (type === 'mhcard') return `mhcard:${nameKey}`;
        if (type === 'castle') return `castle:${nameKey}`;
        return null;   // 地名（place）など、データを持たないものは対象外
    }

    /* 外した項目は消さずに mk が空の記録（墓標）として残す。
       消してしまうと、しばらくオフラインだった端末が古い一覧を送ってきたときに、
       他の端末で外したはずの印が復活する（SYNC_MANUAL.md §4.4）。
       見るほうは全て mk の中身で判断しているので、空の項目が混ざっても表示は変わらない。
       ずっと残すと際限なく増えるため、外してから半年たった墓標は読み込み時に捨てる。 */
    const FAV_TOMB_KEEP_MS = 180 * 24 * 60 * 60 * 1000;
    function favNormalizeMk(mk) {
        return [...new Set((Array.isArray(mk) ? mk : [])
            .map(Number).filter(n => FAV_SLOTS.includes(n)))].sort((a, b) => a - b);
    }
    /* 項目ごとに at の新しいほうを採って favStore へ重ねる。混ぜかたはサーバーから
       受け取るとき（favMergeFromServer）と、同じ端末の別の画面が書いた分を取り込むとき
       （favAbsorbStored）で同じにしてある。 */
    function favMergeItems(items) {
        for (const [k, v] of Object.entries(items || {})) {
            const at = Number(v && v.at) || 0;
            const cur = favStore.items[k];
            if (cur && (Number(cur.at) || 0) >= at) continue;
            favStore.items[k] = { mk: favNormalizeMk(v && v.mk), at };
        }
    }
    function loadFavStore() {
        let raw = storeGetJson(FAV_STORE_KEY);
        // 初期値は枠1だけ名前を入れておく（残り3枠は空＝使わない）
        const names = { 1: 'お気に入り', 2: '', 3: '', 4: '' };
        const hidden = { 1: false, 2: false, 3: false, 4: false };
        const items = {};
        if (raw && typeof raw === 'object') {
            if (raw.names && typeof raw.names === 'object') {
                FAV_SLOTS.forEach(n => { if (typeof raw.names[n] === 'string') names[n] = raw.names[n]; });
            }
            if (raw.hidden && typeof raw.hidden === 'object') {
                FAV_SLOTS.forEach(n => { hidden[n] = raw.hidden[n] === true; });
            }
            if (raw.items && typeof raw.items === 'object') {
                const tombLimit = Date.now() - FAV_TOMB_KEEP_MS;
                for (const [k, v] of Object.entries(raw.items)) {
                    const mk = favNormalizeMk(v && v.mk);
                    const at = Number(v && v.at) || 0;
                    if (mk.length) items[k] = { mk, at };
                    else if (at > tombLimit) items[k] = { mk: [], at };   // 墓標
                }
            }
        }
        return { v: 1, names, hidden, items };
    }
    let favStore = loadFavStore();
    favHiddenKeys = favComputeHiddenKeys();
    /* 書く直前に、いま localStorage にある内容を取り込む。
       favStore は開いた時点の内容をメモリに持ち続けるのに対し、localStorage は
       同じ端末の別の画面と共有される。ホーム画面のアプリと、QRから開いたブラウザのタブが
       両方生きているのが普通なので、取り込まずに書くと、古いほうの画面が保存した瞬間に
       新しいほうで付けたお気に入りが丸ごと消える（再起動すると外れて見える症状になる）。
       枠の名前と「薄く出す」だけは時刻を持たず、いま操作している画面を正とするため取り込まない。 */
    function favAbsorbStored() {
        const disk = storeGetJson(FAV_STORE_KEY);
        if (disk && typeof disk === 'object' && disk.items && typeof disk.items === 'object') {
            favMergeItems(disk.items);
        }
    }
    // localStorage にだけ書く（サーバーへ送り返すかは呼び出し側が決める）
    function favWriteStore() {
        favAbsorbStored();
        try { localStorage.setItem(FAV_STORE_KEY, JSON.stringify(favStore)); }
        catch (e) { console.warn('[store]', FAV_STORE_KEY, e); }
    }
    function saveFavStore() {
        favAbsorbStored();
        storeSetJson(FAV_STORE_KEY, favStore);
    }
    function favNameOf(n) { return (favStore.names[n] || '').trim(); }
    // 名前が入っている枠だけが使える。空にした枠は出さないが、登録した分は消さない
    function favActiveSlots() { return FAV_SLOTS.filter(n => favNameOf(n) !== ''); }
    function favMarksOf(key) { const it = key ? favStore.items[key] : null; return it ? it.mk : []; }
    function favActiveMarksOf(key) {
        const a = favActiveSlots();
        return favMarksOf(key).filter(n => a.includes(n));
    }
    /* 「薄く出す」枠（保存名は hidden。2026-09-27 に「地図に出さない」から改めた）。
       名前が入っている枠だけが効く（空にした枠は使わない扱いなので、
       印が残っていても地図のピンは今までどおり出す）。 */
    function favHiddenSlots() { return favActiveSlots().filter(n => favStore.hidden[n] === true); }

    /* 地図に薄く出すオブジェクトのキー。薄く出す枠に1つでも入っていれば、
       他の枠（普通に出す枠）に入っていても薄くする。
       元のソース（クラスタを含む）からは外し、buildFavOverlayData が薄いピンの側へ回す。
       一覧・検索・シートには今までどおり出す。 */
    function favComputeHiddenKeys() {
        const hs = favHiddenSlots();
        const set = new Set();
        if (!hs.length) return set;
        for (const [k, v] of Object.entries(favStore.items)) {
            if (v.mk.some(n => hs.includes(n))) set.add(k);
        }
        return set;
    }
    function favHiddenOnMap(type, f) {
        if (!favHiddenKeys.size) return false;
        const c = f.geometry && f.geometry.coordinates || [];
        return favHiddenKeys.has(favKeyOf(type, f.properties, c[0], c[1]));
    }
    function favVisibleFeatures(type, feats) {
        return favHiddenKeys.size ? feats.filter(f => !favHiddenOnMap(type, f)) : feats;
    }
    function favVisibleFc(type, fc) {
        return favHiddenKeys.size ? { type: 'FeatureCollection', features: favVisibleFeatures(type, fc.features) } : fc;
    }
    /* 地図のソースを入れ直すのは、隠すキーの集まりが変わったときだけにする。
       印を付け外すたびに城23,516件を回し直すと重いため。 */
    function refreshFavHiddenSources() {
        const next = favComputeHiddenKeys();
        if (next.size === favHiddenKeys.size && [...next].every(k => favHiddenKeys.has(k))) return;
        favHiddenKeys = next;
        if (typeof map === 'undefined' || !map || !map.getSource) return;
        refreshShopSource();
        refreshManholeSource();
        refreshMichiSource();
        refreshMhcardSource();
        refreshCastleSources();
    }

    function favCountOf(n) {
        let c = 0;
        for (const k in favStore.items) if (favStore.items[k].mk.includes(n)) c++;
        return c;
    }

    /* 付け外し。at は最後に触った時刻で、お気に入り一覧の「追加順」がこれを見る。 */
    function favToggleMark(key, n) {
        if (!key || !FAV_SLOTS.includes(n)) return;
        const cur = new Set(favMarksOf(key));
        if (cur.has(n)) cur.delete(n); else cur.add(n);
        // 外したときも記録を残す（mk が空＝墓標。理由は loadFavStore のコメント）
        favStore.items[key] = { mk: [...cur].sort((a, b) => a - b), at: Date.now() };
        saveFavStore();
        refreshFavOverlay();
        updateSheetFav();
        updateFavNameCounts();
        updateFavEntry();
        const view = document.getElementById('nearby-fav-view');
        if (view && view.classList.contains('open')) {
            // 開いたまま外したときは、その行が消えて詰まる。スクロール位置は保つ
            favState.restoreScroll = document.getElementById('fav-item-list').scrollTop;
            renderFavKindChips();
            renderFavItems(true);
        }
    }

    /* まとめて外す。1件ずつ favToggleMark を呼ぶと、そのたびに localStorage への
       書き込みと一覧の作り直しが走る（1,000件選ぶと1,000回）ので、
       記録を全部書き換えてから保存と描き直しを1回だけ行う。
       外すのは渡した枠だけで、名前を空にした枠に入っている分は触らない
       （「空にした枠は出さないが、登録した分は消さない」という決まりに揃える）。
       外した項目を消さずに mk が空の記録（墓標）として残すのは favToggleMark と同じ。 */
    function favUnmarkKeys(keys, slots) {
        const at = Date.now();
        let n = 0;
        for (const key of new Set(keys)) {
            const cur = favMarksOf(key);
            const next = cur.filter(x => !slots.includes(x));
            if (next.length === cur.length) continue;
            favStore.items[key] = { mk: next, at };
            n++;
        }
        if (!n) return 0;
        saveFavStore();
        refreshFavOverlay();
        updateSheetFav();
        updateFavNameCounts();
        updateFavEntry();
        return n;
    }

    // 一覧の行の左端に立てる色帯。付いている枠の数だけ縦に等分する
    function favStripeHtml(type, p, coords) {
        const c = coords || [];
        const marks = favActiveMarksOf(favKeyOf(type, p, c[0], c[1]));
        if (!marks.length) return '';
        return `<span class="fav-stripe">${marks.map(n =>
            `<span style="background:${FAV_COLORS[n]}"></span>`).join('')}</span>`;
    }

