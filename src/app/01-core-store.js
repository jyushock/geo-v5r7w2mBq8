    /* ══ 色の定義 ══════════════════════════════════════════════
       同じ #4285F4 が意味の違う3つの用途で使われていたので、意味ごとに分けてある。
       値は3つとも同じだが、片方の色を変えるときにもう片方を巻き込まないよう、
       同じ値でも統合しないこと。

         --ui-blue          現在地・ナビ・GoogleMapボタン・距離・スピナー（CSSの :root）
         UI_BLUE            上と同じもののJS側。CSS変数から読むので定義は1箇所のまま
         CASTLE_MEIJO_COLOR 100名城のピン・クラスタ・選択リング・バッジ
         typeConfig.place   検索結果の「地名」（国土地理院の住所検索の候補）

       100名城の色は以前 objRingColor・地図のmatch式・getItemColor の3箇所に
       直書きされていた。ここに集約して二重管理をやめる。 */
    const UI_BLUE = getComputedStyle(document.documentElement)
        .getPropertyValue('--ui-blue').trim() || '#4285F4';
    const CASTLE_MEIJO_COLOR = '#4285F4';        // 日本100名城
    const CASTLE_ZOKU_MEIJO_COLOR = '#EA4335';   // 続日本100名城

    /* ══ 保存の入口 ══════════════════════════════════════════════
       お気に入り・表示設定・地図位置の保存を1か所に通す。書く側は必ずここを通し、
       localStorage を直に触らないこと。サーバー同期を足すときに直すのがここだけで済む。

       読みは localStorage を直接見る。起動時（下の savedState / savedSettings）は
       同期的に値が要るので、サーバーの応答を待つ形にはできない。
       サーバー側は「控え」で、起動後に届いた分を後から反映する（SYNC_MANUAL.md §4.1）。

       STORE_KEYS はバックアップの書き出し・読み込みが回す一覧でもある。
       保存キーを増やしたらここに足すこと。 */
    const STORE_KEYS = ['favorites', 'settingsState', 'mapState', 'mapTileSource', 'showOrigin',
                        'hotelRadius', 'hotelSort', 'travelMode', 'nearbyTypeFilterOff'];
    function storeGet(key) {
        try { return localStorage.getItem(key); } catch { return null; }
    }
    function storeGetJson(key) {
        try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
    }
    function storeSet(key, value) {
        try { localStorage.setItem(key, value); }
        catch (e) { console.warn('[store]', key, e); return; }
        syncPush(key);
    }
    function storeSetJson(key, obj) { storeSet(key, JSON.stringify(obj)); }

    /* 押したとき・入力したときに呼ぶ関数を、HTML の属性で書く（onclick="…" の代わり）。
       呼ぶのは index.html の振り分け役（data-on-click / data-on-input / data-on-change を見る）。
       引数は値の型で渡し方を決める：数は data-pass="num"、文字列は data-pass="arg"、無ければ引数なし。
       onclick="fn('…')" のように JS の文字列を属性に入れると、値の ' や " で属性か文字列が切れる
       （店名の ' で周辺検索が動かなかった）。属性の値として持たせれば attrEscape だけで済む。 */
    function actionAttrs(name, arg) {
        if (arg === undefined) return `data-on-click="${name}"`;
        const pass = typeof arg === 'number' ? 'num' : 'arg';
        return `data-on-click="${name}" data-pass="${pass}" data-arg="${attrEscape(String(arg))}"`;
    }
