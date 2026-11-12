    // ══ 都道府県から探す ═══════════════════════════════════════════════
    /* 全オブジェクト種別を都道府県で束ねた一覧。城主から探すと同じ枠組みで、
       索引は表示中のデータから毎回組む（別データファイルは持たない）。

       都道府県の決め方: properties.prefecture があればそれを使い、無ければ address の
       先頭が都道府県名かを見る。どちらも取れない場合だけ address 中に1つだけ現れる
       都道府県名を拾う。prefecture を持つのは城・道の駅・ポケふた・カード配布だけで、
       マンホールと食べログは address からしか取れない（2026-07-31 時点で
       この手順により全34,934件が振り分けられることを実データで確認済み）。 */
    const PREF_NAMES = Object.values(typeof PREF_CODES !== 'undefined' ? PREF_CODES : {});
    /* 地方の分け方は総務省統計局「平成9年就業構造基本調査 地域区分」
       （https://www.stat.go.jp/data/shugyou/1997/3-1.html）に従い、九州から沖縄だけを独立させる。
       地方の並びは同ページの順、地方内の県の並びは PREF_CODES（JP-01…JP-47）の順 */
    const PREF_REGIONS = [
        ['北海道', ['北海道']],
        ['東北', ['青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県']],
        ['南関東', ['埼玉県', '千葉県', '東京都', '神奈川県']],
        ['北関東・甲信', ['茨城県', '栃木県', '群馬県', '山梨県', '長野県']],
        ['北陸', ['新潟県', '富山県', '石川県', '福井県']],
        ['東海', ['岐阜県', '静岡県', '愛知県', '三重県']],
        ['近畿', ['滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県']],
        ['中国', ['鳥取県', '島根県', '岡山県', '広島県', '山口県']],
        ['四国', ['徳島県', '香川県', '愛媛県', '高知県']],
        ['九州', ['福岡県', '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県']],
        ['沖縄', ['沖縄県']],
    ];
    /* 一覧の先頭に置く全国の行。索引では47県と同じ1つの県として扱い（prefIndex['全国']）、
       県ページも同じ画面をそのまま使う。県名と衝突しないので、県の並びに混ざる心配はない。 */
    const PREF_ALL = '全国';
    // 種別チップの並び。表示設定（filterState）と対応させる
    const PREF_TYPES = [
        { type: 'shop',     label: '食べログ',   filter: 'shop'    },
        { type: 'pokefuta', label: 'ポケふた',   filter: 'pokefuta' },
        { type: 'manhole',  label: 'マンホール', filter: 'manhole' },
        { type: 'mhcard',   label: 'マンホールカード配布', filter: 'mhcard'  },
        { type: 'michi',    label: '道の駅',     filter: 'michi'   },
        { type: 'castle',   label: 'お城',       filter: 'castle'  },
    ];
    let prefIndex = null;       // { 県名: { 種別: [searchIndexの要素] } }
    let prefShopGenreAll = [];  // 全国の食べログ部門（多い順）。ジャンル選択の初期値に使う
    // 一度でも選択肢に出した部門。データが後から届いて部門が増えたとき、
    // 「まだ見せていない部門」だけを既定ONに足すために使う（外した部門は外れたまま）
    const prefGenreSeen = new Set();
    // sort の既定は種別順（図鑑的な使い方を想定し、近い順の優先度は下げる）
    // genres は食べログだけが持つ2段目の絞り込み。types と同じく県をまたいで保つ。
    // genreOpen の既定は閉じた状態。食べログの長押しで開く
    // center は近い順の起点。県ページを開いた時点で固定する（下の openPrefDetail を参照）
    let prefState = { types: null, genres: null, genreOpen: false, pref: null, sort: 'type', center: null };

    function prefOfProps(p) {
        if (p.prefecture) return p.prefecture;
        const ad = p.address || '';
        for (const n of PREF_NAMES) if (ad.startsWith(n)) return n;
        const hits = PREF_NAMES.filter(n => ad.includes(n));
        return hits.length === 1 ? hits[0] : null;
    }

    /* 索引を組む。検索と同じ searchIndex を使うので、到着済みのデータだけが対象になる
       （データが後から届いたら buildSearchIndex 経由で作り直される）。
       設定で消している食べログの部門はここで落とす。設定は全体の土台なので、
       県ページの件数にも一覧にも、その部門は最初から無いものとして扱う。 */
    function buildPrefIndex() {
        prefIndex = {};
        prefIndex[PREF_ALL] = {};
        PREF_NAMES.forEach(n => { prefIndex[n] = {}; });
        const visible = new Set(prefVisibleTypes());
        const genres = new Map();
        for (const item of searchIndex) {
            if (!visible.has(item.type)) continue;   // 設定で消している種別は索引に入れない
            if (item.type === 'shop') {
                const g = shopGenreBase((item.properties || {}).category);
                if (!genreVisible(g)) continue;
                if (g) genres.set(g, (genres.get(g) || 0) + 1);
            }
            /* 全国には県が取れなかったものも入れる（全国は総数であってほしいため）。
               2026-08-10 時点の実データでは全34,934件すべてに県が付くので、
               全国の件数は47県の合計と一致する。県が取れないものが出た場合だけ、
               全国の方が多くなり、その分は全国の一覧からしか辿れない。 */
            (prefIndex[PREF_ALL][item.type] = prefIndex[PREF_ALL][item.type] || []).push(item);
            const n = prefOfProps(item.properties || {});
            if (!n || !prefIndex[n]) continue;
            (prefIndex[n][item.type] = prefIndex[n][item.type] || []).push(item);
        }
        // 部門は全国で35種。多い順に持っておき、県ごとの一覧はこの順で出す
        prefShopGenreAll = [...genres.entries()]
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja')).map(e => e[0]);
    }

    /* その県にある食べログの部門と件数（多い順）。県ごとに持っている部門が違う
       （東京都35種・青森県11種）ので、選択肢はその県にあるものだけ出す。 */
    function prefShopGenresOf(name) {
        const list = (prefIndex[name] || {}).shop || [];
        const m = new Map();
        for (const it of list) {
            const g = shopGenreBase((it.properties || {}).category);
            if (g) m.set(g, (m.get(g) || 0) + 1);
        }
        return prefShopGenreAll.filter(g => m.has(g)).map(g => [g, m.get(g)]);
    }
    // その要素がジャンル絞り込みを通るか（食べログ以外は常に通る）
    function prefGenrePass(item) {
        if (item.type !== 'shop' || !prefState.genres) return true;
        const g = shopGenreBase((item.properties || {}).category);
        return !g || prefState.genres.has(g);
    }

    /// 表示設定（設定画面のオブジェクト表示）で表示中の種別だけを返す
    function prefVisibleTypes() {
        return PREF_TYPES.filter(t => filterState[t.filter] !== false).map(t => t.type);
    }

    function updatePrefEntry() {
        const btn = document.getElementById('pref-entry-btn');
        if (!btn) return;
        // 索引は開いたときに組む。ここでは押せるかどうかだけ決める
        btn.disabled = searchIndex.length === 0;
    }

    function showPrefView(which) {
        setPanelLifted(true);
        document.getElementById('nearby-main-view').style.display = 'none';
        document.getElementById('nearby-settings-view').classList.remove('open');
        document.getElementById('nearby-pref-view').classList.toggle('open', which === 'list');
        document.getElementById('nearby-pref-detail-view').classList.toggle('open', which === 'detail');
    }

    function openPrefView(prefName, restoreView) {
        if (searchIndex.length === 0) return;
        buildPrefIndex();
        // 表示中の種別を既定の選択にする（地図で消している種別は最初から出さない）
        if (!prefState.types) prefState.types = new Set(prefVisibleTypes());
        // 部門は「全部選択」から始める（食べログを開いた瞬間に何も出ないのを避ける）。
        // 索引を組み直すたびに新しい部門が増えている場合があるので、既存の選択に足す
        if (!prefState.genres) prefState.genres = new Set(prefShopGenreAll);
        else prefShopGenreAll.forEach(g => { if (!prefGenreSeen.has(g)) prefState.genres.add(g); });
        prefShopGenreAll.forEach(g => prefGenreSeen.add(g));
        if (prefName && prefIndex[prefName]) { openPrefDetail(prefName, restoreView); return; }
        showPrefView('list');
        renderPrefList();
    }
    function backToPrefList() {
        // 県を開く前の位置へ戻す
        prefState.restoreListScroll = prefState.listScrollTop || 0;
        showPrefView('list');
        renderPrefList();
    }

    /* ══ 集計帯の操作（県ページ側） ══════════════════════════════
       集計帯の種別アイコンは、タップでその種別の先頭へ飛び、長押し（500ms・地図の長押しと
       同じ間合い）で表示・非表示が切り替わる。外した種別はグレーに落とす。
       食べログだけは長押しでジャンル行が開き、表示・非表示はそのジャンル行の「全解除」で行う。
       都道府県一覧には絞り込みを置かない（47県の一覧では合計件数の方が見たいものだという判断）。
       選択内容は県をまたいで保ち、全解除の制限は設けない（全部外せば一覧は空になる）。 */

    /* 集計帯に出す種別＝その県に1件以上ある表示中の種別。
       絞り込み中かどうかもこの並びを基準に決める（0件の種別は押せないので数に入れない）。 */
    function prefSumTypes(name) {
        const visible = prefVisibleTypes();
        const g = prefIndex[name] || {};
        return PREF_TYPES.filter(t => visible.includes(t.type) && (g[t.type] || []).length).map(t => t.type);
    }

    /* 集計帯でグレーに落とす種別。表示を外しているものに加えて、食べログは部門を
       すべて外したときも落とす。全7,077件のどれにも部門が入っているので（データで確認済み）、
       部門を全部外すと一覧から食べログが1件も出なくなり、種別を外したのと同じ状態になる。 */
    function prefSumOff(t) {
        if (!prefState.types.has(t)) return true;
        if (t !== 'shop') return false;
        const list = prefShopGenresOf(prefState.pref);
        return list.length > 0 && !list.some(([g]) => prefState.genres.has(g));
    }

    function renderPrefSum() {
        const name = prefState.pref;
        if (!name) return;
        const g = prefIndex[name] || {};
        const items = prefSumTypes(name).map(t => `
            <div class="pref-sum-item ${prefSumOff(t) ? 'off' : ''}" data-t="${t}">
                ${prefTypeIconHtml(t)}<div class="pref-sum-v">${g[t].length.toLocaleString()}</div></div>`);
        const el = document.getElementById('pref-detail-sum');
        el.innerHTML = `<div class="pref-sum-line">${items.join('')}</div>`;
        el.querySelectorAll('.pref-sum-item').forEach(bindPrefSumItem);
    }

    /* 種別アイコンのタップと長押しの割り当て。長押しは onLongPress を渡した要素だけで働く。
       割り当てる中身は置き場所ごとに違うので、呼ぶ側が決める（設定のオブジェクト表示＝
       renderObjFilterList と、県ページの集計帯＝bindPrefSumItem の2か所で使う）。
       タッチのあとに合成されるマウスイベントで二重に反応しないよう、直後の mouse は捨てる。 */
    let lpTimer = null, lpFired = false, lpTouched = false;
    function bindTypeToggle(el, onTap, onLongPress) {
        const start = () => {
            lpFired = false;
            if (!onLongPress) return;
            lpTimer = setTimeout(() => { lpTimer = null; lpFired = true; onLongPress(); }, 500);
        };
        const cancel = () => { if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; } };
        const end = () => { cancel(); if (lpFired) { lpFired = false; return; } onTap(); };
        el.addEventListener('touchstart', start, { passive: true });
        el.addEventListener('touchmove', cancel, { passive: true });
        el.addEventListener('touchend', () => { lpTouched = true; setTimeout(() => { lpTouched = false; }, 600); end(); });
        el.addEventListener('mousedown', e => { if (e.button === 0 && !lpTouched) start(); });
        el.addEventListener('mouseup', e => { if (e.button === 0 && !lpTouched) end(); });
        el.addEventListener('mouseleave', cancel);
        el.addEventListener('contextmenu', e => e.preventDefault());   // 長押しのメニューを出さない
    }
    /* 県ページの集計帯。タップはその種別の先頭へ飛ぶ操作にする。東京都は2,496件あって
       先頭の食べログだけで2,084行あり、いちばん下のお城まで指で送ると2,312行かかるため。
       表示のON/OFF は長押しへ移す。
       食べログだけは長押しでジャンル行が開き、表示のON/OFF はそのジャンル行の
       「全解除」（部門を全部外す＝一覧から1件も出なくなる）で行う。 */
    function bindPrefSumItem(el) {
        const t = el.dataset.t;
        bindTypeToggle(el, () => prefJumpToType(t), t === 'shop' ? () => {
            if (!prefState.types.has('shop')) return;   // 非表示のときは開かない
            prefState.genreOpen = !prefState.genreOpen;
            renderPrefGenreLine();
        } : () => togglePrefType(t));
    }

    /* 集計帯のタップで、その種別の最初の行へ飛ぶ。種別順ならその種別の先頭、名前順・近い順なら
       一覧で最初に出てくるその種別の行（近い順ならいちばん近いもの）になる。どの並びでも
       意味が通るので、種別順のときだけの操作にはしていない。
       2,000行を超えて動くのでなめらかスクロールは使わず、一気に飛ばして着いた行を光らせる。 */
    function prefJumpToType(t) {
        const list = document.getElementById('pref-item-list');
        const i = (prefState.typeHead || {})[t];
        if (!list || i === undefined) return;   // 絞り込みで1件も残っていない種別
        // 上限で打ち切った先にある種別は、その行が入るところまで継ぎ足してから飛ぶ
        if (i >= (prefState.shown || 0)) appendPrefItems(Math.ceil((i + 1) / PREF_ITEM_CHUNK) * PREF_ITEM_CHUNK);
        const el = list.children[i];
        if (!el) return;
        list.scrollTop += el.getBoundingClientRect().top - list.getBoundingClientRect().top;
        el.classList.remove('pref-jumped');
        void el.offsetWidth;                    // 同じ行へ続けて飛んでも光らせ直す
        el.classList.add('pref-jumped');
    }

    /* 食べログのジャンル行。バッジと同じ10グループの区分で並べ、選択中のチップは
       バッジと同じ色にする。食べログを非表示にしている間は出さない。 */
    function renderPrefGenreLine() {
        const el = document.getElementById('pref-genre-line');
        const list = prefShopGenresOf(prefState.pref);
        if (!prefState.genreOpen || !prefState.types.has('shop') || !list.length) { el.innerHTML = ''; return; }
        const cnt = Object.fromEntries(list);
        const on = list.filter(([g]) => prefState.genres.has(g));
        const groups = SHOP_GENRE_GROUPS.map(([gname, members]) => {
            const has = members.filter(c => cnt[c] !== undefined);
            if (!has.length) return '';
            return `<div class="pref-ggrp"><div class="pref-ggname">${gname}</div><div class="pref-gchips">${
                has.map(c => `<button class="ptg ${prefState.genres.has(c) ? 'on shop-genre ' + (SHOP_GENRE_CLASS[c] || 'g-sonota') : ''}"
                    onclick="togglePrefGenre('${attrEscape(c)}')">${attrEscape(c)}<span class="ptg-n">${cnt[c]}</span></button>`).join('')
            }</div></div>`;
        }).join('');
        el.innerHTML = `<div class="pref-gline">
            <div class="pref-gline-h"><span>食べログのジャンル <b>${on.length}/${list.length}</b>・${
                on.reduce((s, e) => s + e[1], 0).toLocaleString()}件</span>
                <button class="ptg-all" onclick="togglePrefGenreAll()">${
                    on.length === list.length ? '全解除' : '全選択'}</button></div>${groups}</div>`;
    }

    /* ジャンル行の「全解除／全選択」。全部選んでいるときは全解除、それ以外は全選択に戻す
       （周辺検索結果の種別チップ＝toggleAllNearbyTypeFilter と同じ言い回しにする）。
       全解除は、この県の食べログをまとめて消す操作でもある。集計帯の食べログを長押しして
       全解除すれば、表示を外したのと同じ状態になり、集計帯もグレーに落ちる（prefSumOff）。
       触るのはその県にある部門だけ。県ごとに持っている部門が違う（東京都35種・青森県11種）ので、
       他の県にしか無い部門の選択まで巻き込まない。 */
    function togglePrefGenreAll() {
        const list = prefShopGenresOf(prefState.pref);
        const allOn = list.every(([g]) => prefState.genres.has(g));
        list.forEach(([g]) => { if (allOn) prefState.genres.delete(g); else prefState.genres.add(g); });
        renderPrefFilterUI();
        renderPrefItems();
    }

    /* 絞り込み中だけ出す帯。何をどれだけ絞っているかと、戻す操作をここにまとめる。 */
    function renderPrefResetBar() {
        const el = document.getElementById('pref-reset-bar');
        const types = prefSumTypes(prefState.pref);
        const onTypes = types.filter(t => prefState.types.has(t));
        const genres = prefShopGenresOf(prefState.pref);
        const onGenres = genres.filter(([g]) => prefState.genres.has(g));
        const typeFiltered = onTypes.length !== types.length;
        const genreFiltered = prefState.types.has('shop') && genres.length && onGenres.length !== genres.length;
        if (!typeFiltered && !genreFiltered) { el.innerHTML = ''; return; }
        const parts = [];
        if (typeFiltered) parts.push(`${onTypes.length}/${types.length}種別`);
        if (genreFiltered) parts.push(`ジャンル${onGenres.length}/${genres.length}`);
        el.innerHTML = `<div class="pref-rstbar">${parts.join('・')}を表示中
            <button onclick="resetPrefFilter()">すべて表示</button></div>`;
    }

    /* 種別と部門の選択を既定（どちらもすべて選択）に戻す。
       絞り込み欄の語は別の操作なので消さない。 */
    function resetPrefFilter() {
        prefState.types = new Set(prefVisibleTypes());
        prefState.genres = new Set(prefShopGenreAll);
        renderPrefFilterUI();
        renderPrefItems();
    }
    // 集計帯・ジャンル行・絞り込み帯はいつも同じ状態から作るので、まとめて描き直す
    function renderPrefFilterUI() {
        renderPrefSum();
        renderPrefGenreLine();
        renderPrefResetBar();
    }
    function togglePrefGenre(g) {
        if (prefState.genres.has(g)) prefState.genres.delete(g); else prefState.genres.add(g);
        renderPrefGenreLine();
        renderPrefResetBar();
        renderPrefItems();
    }
    function togglePrefType(t) {
        if (prefState.types.has(t)) prefState.types.delete(t); else prefState.types.add(t);
        renderPrefFilterUI();
        renderPrefItems();
    }

    /* 一覧に出すのは種別ごとの内訳だけ。合計は県ページ側にあるので、行にも地方見出しにも置かない。
       数える対象は種別の選択に関わらず「地図で表示中の種別」（種別の絞り込みは県ページ側）。

       数字の欄はその種別の47都道府県での最大件数の文字数で固定し、アイコンが全行で
       同じ位置に来るようにする（県どうしを縦に見比べられる）。
       幅を ch で取るのは、フォントが変わっても桁数どおりの幅になるため。
       全国の行はこの固定幅の対象にしない。全国の件数を最大に含めると6種別で合わせて
       9ch 広がり（例：マンホールは最大の県が99件・全国が1,267件）、
       375px で県名と「›」が押し出されるため、全国の行だけ桁なりの幅で出す。 */
    function prefCntWidths(types) {
        const w = {};
        for (const t of types) {
            w[t] = Math.max(1, ...PREF_NAMES.map(
                n => ((prefIndex[n] || {})[t] || []).length.toLocaleString().length));
        }
        return w;
    }

    /* 一覧の1行。全国も県も同じ作りにする（開く先も同じ県ページ）。
       違うのは件数の欄の幅だけで、w を渡すと種別ごとの固定幅、省くと桁なりの幅になる。 */
    function prefRowHtml(name, types, w) {
        const g = prefIndex[name] || {};
        const cnt = types.map(t => {
            const v = (g[t] || []).length;
            return `<span class="pref-cnt-cell">${prefTypeIconHtml(t)}<span
                class="pref-cnt-n${v ? '' : ' zero'}"${w ? ` style="width:${w[t]}ch"` : ''}
                >${v.toLocaleString()}</span></span>`;
        }).join('');
        return `<div class="pref-row${name === PREF_ALL ? ' pref-row-all' : ''}" onclick="openPrefDetail('${name}')">
            <div class="lord-main"><div class="lord-name">${name}</div></div>
            <div class="pref-cnt-line">${cnt}</div>
            <div class="lord-chev">›</div>
        </div>`;
    }

    function renderPrefList() {
        const types = prefVisibleTypes();
        const w = prefCntWidths(types);
        // 先頭は全国。地方と同じ形の見出しを付けて、地方と同じ並びの中に置く
        const out = [`<div class="reg-head">${PREF_ALL}</div>`, prefRowHtml(PREF_ALL, types, null)];
        for (const [region, members] of PREF_REGIONS) {
            out.push(`<div class="reg-head">${region}</div>`);
            for (const n of members) out.push(prefRowHtml(n, types, w));
        }
        const list = document.getElementById('pref-list');
        list.innerHTML = out.length ? out.join('')
            : '<div class="lords-note">該当する都道府県がありません</div>';
        fitPrefAllRow();
        // 通常は先頭から。県ページから戻ってきたときだけ、開く前の位置へ戻す
        list.scrollTop = prefState.restoreListScroll || 0;
        prefState.restoreListScroll = 0;
    }

    /* 全国の行の収まりを実測で確かめる。件数の桁が県より9ch多く、間隔を詰めても
       375px（iPhone SE3。スクロールバー13pxを引いて362px）での余りは30px弱なので、
       フォントの幅が想定より広い端末では「›」が画面の外へ出る。はみ出していたら
       この行の数字だけを0.5pxずつ縮めて収める（アイコンと県の行には触らない）。
       画面が狭い端末（320px幅）でも同じ仕組みで収まる。 */
    function fitPrefAllRow() {
        const row = document.querySelector('#pref-list .pref-row-all');
        if (!row) return;
        const line = row.querySelector('.pref-cnt-line');
        line.style.fontSize = '';
        for (let size = 11; size > 8.5 && row.scrollWidth > row.clientWidth; size -= 0.5) {
            line.style.fontSize = (size - 0.5) + 'px';
        }
    }

    /* restoreView を立てて呼ぶと、オブジェクトを開く前の一覧の状態に戻す。
       ・近い順の起点を取り直さない。getSearchCenter() は検索ピンが無ければ地図の中心を
         返すので、一覧からオブジェクトを開くと地図がそこへ寄って起点が変わってしまう。
       ・スクロール位置も開く前の場所へ戻す（prefJumpToItem が控えておいた値）。
       戻り導線からはこれを立てて呼ぶ。 */
    function openPrefDetail(name, restoreView) {
        if (!prefIndex || !prefIndex[name]) return;
        prefState.pref = name;
        // 47県の一覧から開いたときだけ、そこへ戻るための位置を控える
        if (!restoreView) prefState.listScrollTop = document.getElementById('pref-list').scrollTop;
        if (!restoreView || !prefState.center) {
            const c = getSearchCenter();
            prefState.center = { lat: c.lat, lng: c.lng };
            // 起点が検索ピンだったのか地図の中心だったのかは、控えた時点でしか分からない
            prefState.centerPinned = !!searchPinLngLat;
        }
        prefState.restoreScroll = restoreView ? (prefState.scrollTop || 0) : 0;
        document.getElementById('pref-detail-title').textContent = name;
        // 別の県を開いたら絞り込みの語は持ち越さない（種別・部門の選択は保つ）
        prefState.q = '';
        document.getElementById('pref-item-search').value = '';
        setSearchClearVisible('pref-item-search', '');
        // 集計帯・ジャンル行・絞り込み帯はその県の内訳から作り直す
        renderPrefFilterUI();
        renderDistOrigin('pref');
        showPrefView('detail');
        // 戻ってきたときは継ぎ足した分もそのまま（スクロール位置を戻す先が変わらないように）
        renderPrefItems(restoreView);
    }

    function setPrefSort(sort) {
        prefState.sort = sort;
        document.querySelectorAll('#nearby-pref-detail-view .lords-chip[data-ps]').forEach(b => {
            b.setAttribute('aria-pressed', String(b.dataset.ps === sort));
        });
        renderPrefItems();
    }

    /* 種別アイコン。周辺検索結果（renderNearbyList）と同じ作りにする。
       マンホールカードだけはカード画像に蓋バッジを重ねた専用の見た目。
       props を渡すと色を objRingColor に決めさせる（地図のピンと同じく
       100名城は青・続100名城は赤になる）。集計帯のように種別の代表として
       出すときは props を省いて種別の基本色にする。 */
    function prefTypeIconHtml(type, props) {
        if (type === 'mhcard') {
            // 角丸は --mhcard-radius で上書きできる。カード画像の四隅が透明なので、
            // 小さく出す場所（都道府県一覧の内訳）で 6px のままだと丸くなりすぎる
            return `<div style="position:relative;width:var(--mhcard-w);height:var(--mhcard-h);flex-shrink:0;background:#e2ddd4;border-radius:var(--mhcard-radius,6px);"><img src="mhcard.png" style="width:100%;height:100%;display:block;"><img src="manhole.png" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:var(--mhcard-badge);height:var(--mhcard-badge);filter:brightness(0) invert(1);pointer-events:none;"></div>`;
        }
        const cfg = typeConfig[type] || {};
        const color = props ? objRingColor(type, props) : (OBJ_TYPE_COLOR[type] || cfg.color || '#546E7A');
        return `<div class="nearby-item-icon${objIconSquareClass(type)}" style="background:${color}">${cfg.img
            ? `<img src="${cfg.img}"${cfg.img === 'manhole.png' ? '' : ' class="icon-full"'}>` : (cfg.icon || '')}</div>`;
    }

    /* 行に出すバッジ。情報シートで出しているものと同じ内容にする。
       城は 100名城/続100名城 と形態、カード配布はカードIDと弾、蓋はカードID、
       食べログは部門。県ページの一覧と周辺検索結果（renderNearbyList）の両方で使う。 */
    function prefBadgesHtml(item) {
        const p = item.properties || {};
        const b = [];
        if (item.type === 'castle') {
            const label = CASTLE_GENRE_LABEL[p.genre];
            if (label) b.push(`<span class="pref-badge" style="background:${getItemColor(item)}">${label}</span>`);
            // 形態は情報シートと同じ色分け（FORM_BADGE_CLASS）をそのまま使う
            if (p.shiroHbForm && p.shiroHbForm !== '不明') {
                b.push(`<span class="pref-badge popup-form-badge ${FORM_BADGE_CLASS[p.shiroHbForm] || ''}">${attrEscape(p.shiroHbForm)}</span>`);
            }
        } else if (item.type === 'mhcard') {
            const info = mhcardInfo(p);
            if (info && info.id) b.push(`<span class="pref-badge card">${attrEscape(info.id)}</span>`);
            if (info && info.round) b.push(`<span class="pref-badge round">${attrEscape(info.round)}</span>`);
        } else if (item.type === 'manhole' && p.cardId) {
            b.push(`<span class="pref-badge card">${attrEscape(p.cardId)}</span>`);
        } else if (item.type === 'shop') {
            // 部門バッジ。同じ画面のジャンル絞り込みと同じ語彙になる
            const badge = shopGenreBadgeHtml(p, 'pref-badge');
            if (badge) b.push(badge);
        }
        return b.length ? `<div class="pref-badges">${b.join('')}</div>` : '';
    }

    /* 城は 100名城 → 続100名城 → その他 の順に寄せる。地図のピンが circle-sort-key で
       使っている優先度（100名城3 / 続2 / その他1）と同じ考え方。 */
    function castleGenreRank(p) {
        if (p.genre === '日本100名城') return 0;
        if (p.genre === '続日本100名城') return 1;
        return 2;
    }

    /* 食べログは部門でまとめる。並びはバッジと同じ10グループの区分（SHOP_GENRE_GROUPS）の順で、
       同じ画面のジャンル行に出るチップの並びと一致させてある。
       区分に無い部門と食べログ以外の種別は同じ値になるので、種別順の中では影響しない。 */
    const SHOP_GENRE_ORDER = (() => {
        const m = new Map();
        SHOP_GENRE_GROUPS.forEach(([, members]) => members.forEach(c => m.set(c, m.size)));
        return m;
    })();
    function shopGenreRank(p) {
        const r = SHOP_GENRE_ORDER.get(shopGenreBase(p && p.category));
        return r === undefined ? SHOP_GENRE_ORDER.size : r;
    }

    // 一覧の絞り込み。照合は searchIndex が持つ正規化済みの名前・住所を使う
    // （毎入力で2,000件超を正規化し直さずに済む）
    function onPrefSearchInput(v) {
        prefState.q = v;
        setSearchClearVisible('pref-item-search', v);
        debounceListFilter('prefItem', renderPrefItems);
    }
    function clearPrefSearch() {
        const el = document.getElementById('pref-item-search');
        el.value = '';
        onPrefSearchInput('');
        el.focus();
    }

    /* 一度に描く件数の上限。全国（34,934件）を一度に描くと重く、実測で
       東京都2,496件の6.9倍かかった（同じ端末・同じブラウザで884ms→6.1秒、
       DOMノード307,398。2026-08-10）。上限は、これまで問題なく使えていた
       東京都2,496件より軽い1,000件に置く。続きは末尾の「さらに表示」で継ぎ足す
       ので、打ち切っても辿れなくなるものは無い。 */
    const PREF_ITEM_CHUNK = 1000;

    /* 一覧の行。継ぎ足し（showMorePrefItems）からも呼べるよう、範囲を指定して作る。
       onclick に渡すのは rows の通し番号なので、継ぎ足した行でも先頭から数えた番号になる。 */
    function prefRowsHtml(rows, from, to) {
        let out = '';
        for (let i = from; i < to; i++) {
            const r = rows[i];
            const item = r.item;
            const distStr = r.dist < 1 ? `${Math.round(r.dist * 1000)}m` : `${r.dist.toFixed(1)}km`;
            out += `<div class="nearby-item" onclick="prefJumpToItem(${i})">
                ${favStripeHtml(item.type, item.properties, item.coords)}
                ${prefTypeIconHtml(item.type, item.properties || {})}
                <div class="nearby-item-text">
                    <div class="nearby-item-name">${attrEscape(itemDisplayName(item))}</div>
                    <div class="nearby-item-sub">${matchNoteHtml(null, r.part)}${attrEscape(item.sub || '')}</div>
                </div>
                ${prefBadgesHtml(item)}
                <div class="nearby-item-dist">${distStr}</div>
            </div>`;
        }
        return out;
    }

    /* keepShown を立てて呼ぶと、継ぎ足した分（prefState.shown）を保つ。
       オブジェクトから戻ったときの描き直しがこれに当たる（「さらに表示」は
       作り直さずに続きを足す＝showMorePrefItems）。
       絞り込みや並べ替えで一覧の中身が変わるときは、先頭1,000件から見せ直す。 */
    function renderPrefItems(keepShown) {
        const name = prefState.pref;
        if (!name) return;
        if (!keepShown) prefState.shown = PREF_ITEM_CHUNK;
        const types = [...prefState.types];
        const center = prefState.center || getSearchCenter();   // 起点は県ページを開いた時点で固定
        const q = normalizeForSearch((prefState.q || '').trim());
        let rows = [];
        for (const t of types) {
            for (const item of (prefIndex[name][t] || [])) {
                if (!prefGenrePass(item)) continue;   // 食べログの部門で絞る（2段目）
                if (q && !(item._normLabel || '').includes(q)
                      && !(item._normSub || '').includes(q)) continue;
                const c = item.coords;
                // 絞り込み中は、検索結果と同じく「店名以外のどこで当たったか」を添える
                rows.push({ item, dist: calcDist(center.lat, center.lng, c[1], c[0]),
                            part: (q && item.type === 'shop') ? shopMatchedPart(item.properties, q) : null });
            }
        }
        /* 並べる基準は行に出している名前と同じにする（食べログは店名）。
           name 全体で並べると、画面では見えない駅名やジャンルで順番が決まってしまうため。
           比較のたびに名前を組み立て直すと数万件では効いてくるので、並べ替えに使う値は
           先に1度だけ求めて行に持たせる（2026-08-26 実測: 全国33,868件の種別順で
           303ms → 73ms。文字列の比較を LIST_COLLATOR にした分も含む）。 */
        if (prefState.sort === 'dist') {
            // 近い順は種別も城の格付けも見ず、距離だけで並べる
            rows.sort((a, b) => a.dist - b.dist);
        } else if (prefState.sort === 'type') {
            // 種別でまとめたうえで、城は 100名城 → 続100名城 → その他、食べログは部門の順に寄せる
            const order = {};
            PREF_TYPES.forEach((t, i) => { order[t.type] = i; });
            for (const r of rows) {
                const p = r.item.properties || {};
                r.kType = order[r.item.type];
                r.kCastle = castleGenreRank(p);
                r.kGenre = shopGenreRank(p);
                r.kName = itemDisplayName(r.item);
            }
            rows.sort((a, b) => a.kType - b.kType || a.kCastle - b.kCastle || a.kGenre - b.kGenre
                                || LIST_COLLATOR.compare(a.kName, b.kName));
        } else {
            // 名前順は種別も城の格付けも見ず、名前だけで並べる
            for (const r of rows) r.kName = itemDisplayName(r.item);
            rows.sort((a, b) => LIST_COLLATOR.compare(a.kName, b.kName));
        }
        // 種別ごとの最初の行。集計帯のタップ（prefJumpToType）で飛ぶ先に使う。
        // 並べ替えと絞り込みの結果から取るので、一覧を作り直すたびに取り直す
        prefState.typeHead = {};
        rows.forEach((r, i) => {
            if (prefState.typeHead[r.item.type] === undefined) prefState.typeHead[r.item.type] = i;
        });
        const list = document.getElementById('pref-item-list');
        if (rows.length === 0) {
            list.innerHTML = `<div class="lords-note">${
                q ? '該当する項目がありません' : '表示する種別が選ばれていません'}</div>`;
            return;
        }
        /* 上限までを描く。上限は種別で分けずに先頭から数える（種別ごとの枠にすると、
           並べ替えが名前順・近い順のときに枠の意味が無くなるため）。集計帯のタップで
           上限の先にある種別へ飛ぶときは、そこまで継ぎ足してから飛ぶ（prefJumpToType）。 */
        const shown = Math.min(rows.length, prefState.shown || PREF_ITEM_CHUNK);
        prefState.shown = shown;
        prefState.rows = rows;
        // 末尾は、打ち切っているときだけ「さらに表示」を添えた件数の行になる
        list.innerHTML = prefRowsHtml(rows, 0, shown)
            + listFootHtml(shown, rows.length, 'showMorePrefItems()', PREF_ITEM_CHUNK);
        // 通常は先頭から。オブジェクトを開いて戻ってきたときだけ、開く前の位置へ戻す
        // （全件を入れ終えてから指定しないと、スクロールできる高さが足りずに切り詰められる）
        list.scrollTop = prefState.restoreScroll || 0;
        prefState.restoreScroll = 0;
    }

    /* 「さらに表示」。一覧を作り直さず、増えたぶんの行だけを足す（appendListRows）。
       いま出ている行はそのまま残るので、指の位置も動かない。 */
    function showMorePrefItems() {
        appendPrefItems((prefState.shown || PREF_ITEM_CHUNK) + PREF_ITEM_CHUNK);
    }

    // 指定の件数まで一覧を継ぎ足す。「さらに表示」と、集計帯から上限の先へ飛ぶときに使う
    function appendPrefItems(target) {
        const rows = prefState.rows || [];
        const from = prefState.shown || PREF_ITEM_CHUNK;
        const to = Math.min(rows.length, target);
        if (to <= from) return;
        prefState.shown = to;
        appendListRows('pref-item-list', prefRowsHtml(rows, from, to),
                       to, rows.length, 'showMorePrefItems()', PREF_ITEM_CHUNK);
    }

    /* 一覧からオブジェクトへ飛ぶ。検索結果タップ（onResultClick）と同じ扱いにして、
       寄せ方・情報シート・履歴の記録を揃える。 */
    function prefJumpToItem(i) {
        const r = (prefState.rows || [])[i];
        if (!r) return;
        const back = prefState.pref;
        // 戻り導線で開く前の位置へ戻せるよう、離れる前に控える（一覧の位置と地図）
        prefState.scrollTop = document.getElementById('pref-item-list').scrollTop;
        saveListReturnCamera();
        closeNearby();
        onResultClick(r.item);
        // onResultClick は 300ms 後に情報シートを開くので、その後に戻り導線を挿す
        setTimeout(() => injectPrefBackLink(back), 400);
    }

    // 一覧から来たときだけ、情報シートの先頭に戻り導線を挿す（城主から探すと同じ扱い）。
    // 別のピンをタップするとシート本文ごと作り直されるので、自然に消える。
    function injectPrefBackLink(prefName) {
        if (!prefName) return;
        const body = document.getElementById('obj-sheet-body');
        if (!body || body.querySelector('.os-lords-back')) return;
        const div = document.createElement('div');
        div.className = 'os-lords-back';
        div.textContent = `↩ 「${prefName}」の一覧に戻る`;
        // 開く前の一覧の状態（近い順の起点・スクロール位置）と地図のまま戻す
        div.onclick = () => { closeObjSheet(); restoreListReturnCamera(); openNearbyPanel(); openPrefView(prefName, true); };
        body.insertBefore(div, body.firstChild);
    }

