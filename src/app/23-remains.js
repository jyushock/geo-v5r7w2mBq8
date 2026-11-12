    /* ══ 遺構から探す（第7〜9ビュー） ═══════════════════════════════
       castle.js の properties.remains は読点区切りの列挙で、全件で757種・延べ42,012件。
       城数順に並べただけのフラット一覧では、292種に散らばる建造物（624城）が
       下に沈んで探せないため、13グループに寄せて2階層で辿らせる。

       ・分類は語の一部で機械的に決める（先に書いた規則が勝つ）。どれにも当たらない
         「その他」は14種18城まで落ちている（2026-08-21 実データで確認）
       ・括弧の対応が取れていないトークン（原典の括弧内の読点で分断されたもの。
         「四稜星堡外郭（土塁」等44種46件）は語の断片なので、規則に掛けず「その他」に落とす
       ・「なし」「不明」「埋没」等は遺構名ではないので一覧に出さない。
         情報シート（castleAttrLine）が同じ理由でこれらの行を出していないのに揃える */
    const REMAIN_GROUP_DEFS = [
        ['none',    '遺構なし・状態', '#B0BEC5', /^(なし|無し|不明|-|あり|等|ほか|伝)$|埋没|消失|消滅|未発見|一部残存|未調査|残存しない/],
        ['sign',    '碑・案内板',     '#9E9D24', /碑|説明板|説明版|案内板|標柱|案内/],
        ['koguchi', '虎口・出入口',   '#EF6C00', /虎口|枡形|桝形|馬出|大手|搦手|搦め手|城戸|木戸|武者走|武者隠|登城路|小口|構口|一騎駆|抜け穴/],
        ['bldg',    '建造物',         '#AD1457', /天守|天主|櫓|門|御殿|殿|書院|茶室|蔵|塀|長屋|番所|母屋|主屋|本館|藩校|建物|屋敷|居館|館|厩|馬屋|会所|玄関|時鐘|鐘楼|本殿|祠|社|寺|堂|トイレ|小屋|兵糧|陣屋|陣|台所|倉庫|米倉|正倉|火薬庫|望楼|角楼|閣|楼|築地|邸|部屋|御役所|隠居所|謁見所|舞台|亭|扉|階段|薬園/],
        ['ishi',    '石垣・石造物',   '#546E7A', /石垣|石積|石塁|石段|石列|列石|石橋|礎石|石組|石切|城壁|防塁|眼鏡橋|石/],
        ['hori',    '堀',             '#1565C0', /堀|濠|壕|溝|掘|運河|水路|用水|舟入|舟隠|堰堤/],
        ['dorui',   '土塁・切岸',     '#8D6E63', /土塁|土居|土橋|切岸|犬走|土壇|土堤|段切|段差|版築|盛土|塁段|逆茂木|人工傾斜地|削崖|畝形阻塞/],
        ['kuruwa',  '曲輪・区画',     '#6D4C41', /曲輪|郭|削平|平坦面|平場|城山|馬場|総構|丸|台$|の台|城址公園|城跡|砦/],
        ['mizu',    '井戸・水利',     '#00838F', /井戸|水門|池|貯水|暗渠|水の手|水ノ手|水場|庭園|泉|噴水|清水|馬洗/],
        ['gunji',   '砲台・物見',     '#4527A0', /砲|堡|胸壁|狼煙|烽火|のろし|ノロシ|狼火|物見|見張|台場|矢穴|乱穴|旗立|軍道|武者溜/],
        ['hakkutsu','発掘遺構',       '#2E7D32', /柱穴|ピット|ピッ卜|土坑|竪穴|鍛冶|住居|掘立|遺構|官衙|政庁|坑道|貝塚|柵列|柱列|竈|炊き釜|焚き口|火吹き穴/],
        ['haka',    '墓・供養塔',     '#5D4037', /墓|塚|供養塔|宝筐印塔|首切り/],
        ['other',   'その他',         '#78909C', /./],
    ];
    const REMAIN_GROUP = {};
    REMAIN_GROUP_DEFS.forEach(([id, name, color]) => { REMAIN_GROUP[id] = { id, name, color }; });
    /* 分類一覧の並び。城数順ではなく、情報シートの「遺構」行に出る順に揃える。
       シートは原典の remains をそのまま出しており（castleAttrLine）、その並びは
       「天守、櫓、石垣、曲輪、虎口、土塁、堀、井戸」のような建物から地形へ降りる順で
       ほぼ一貫している。同じ城に両方を持つ城で先に書かれた方を全ペア数えて決めた
       （2026-08-21 に castle.js の全18,000件超で集計）。分類同士の勝敗は
       建造物11勝・石垣10勝・曲輪8勝…と綺麗に並び、城内での相対位置の中央値で
       並べても碑・案内板を除いて同じ順になる。
       ・碑・案内板だけは2つの方法で位置が割れる（勝敗では土塁の次、相対位置では曲輪の次）。
         71城しかなく、虎口には必ず負ける一方で曲輪に59%勝つという不整合な出方をするため、
         勝敗の方を採った
       ・砲台・物見／発掘遺構／墓・供養塔は互いに併記される城が1つも無く、
         この3つの間の順は決められない。城数順で置いている
       未知のIDが増えたときは末尾に回し、そこだけ従来どおり城数順で並べる。 */
    const REMAIN_GROUP_ORDER = ['bldg', 'ishi', 'kuruwa', 'koguchi', 'dorui', 'sign',
                                'hori', 'mizu', 'gunji', 'hakkutsu', 'haka', 'other'];
    // グループの記号。種別アイコンと同じ28pxの丸に白抜きで置く
    const REMAIN_GROUP_ICON = {
        kuruwa: '<rect x="2" y="5" width="20" height="14" rx="2" fill="none" stroke="#fff" stroke-width="2.4"/><path d="M8 5v14" stroke="#fff" stroke-width="2.4"/>',
        hori: '<path d="M2 5v6l5 8h10l5-8V5" fill="none" stroke="#fff" stroke-width="2.4" stroke-linejoin="round"/>',
        dorui: '<path d="M2 19L8 7l4 6 4-8 6 14z" fill="#fff"/>',
        ishi: '<g fill="#fff"><rect x="2" y="5" width="9" height="6" rx="1"/><rect x="13" y="5" width="9" height="6" rx="1"/><rect x="2" y="13" width="12" height="6" rx="1"/><rect x="16" y="13" width="6" height="6" rx="1"/></g>',
        bldg: '<path d="M12 3l9 5H3z" fill="#fff"/><rect x="5" y="9" width="14" height="11" fill="#fff"/>',
        koguchi: '<path d="M4 20V6h7M20 20V6h-7" fill="none" stroke="#fff" stroke-width="2.6"/>',
        mizu: '<path d="M12 3s6 7 6 11a6 6 0 01-12 0c0-4 6-11 6-11z" fill="#fff"/>',
        gunji: '<path d="M3 17l14-8 3 4-14 8z" fill="#fff"/><circle cx="19" cy="7" r="3" fill="#fff"/>',
        hakkutsu: '<path d="M3 20l8-8M9 6l9 9-3 3-9-9z" stroke="#fff" stroke-width="2.4" fill="none"/>',
        haka: '<path d="M7 21V9a5 5 0 0110 0v12z" fill="#fff"/>',
        sign: '<rect x="3" y="4" width="18" height="10" rx="2" fill="#fff"/><path d="M12 14v7" stroke="#fff" stroke-width="2.4"/>',
        none: '<circle cx="12" cy="12" r="8" fill="none" stroke="#fff" stroke-width="2.4"/><path d="M7 17L17 7" stroke="#fff" stroke-width="2.4"/>',
        other: '<circle cx="6" cy="12" r="2.2" fill="#fff"/><circle cx="12" cy="12" r="2.2" fill="#fff"/><circle cx="18" cy="12" r="2.2" fill="#fff"/>',
    };

    /* 分類の中の中分類。1つの分類の中で語が多すぎて一覧が読めないものだけに置く。
       建造物は292種が624城に散らばっていて、城数順に並べただけでは
       「門」も「天守」も同じ濃さで延々と続くため、見出しで束ねる。
       見出し自体もタップでき、その中分類を持つ城の一覧に行ける（門287城・櫓181城）。
       他の分類は語数が少ない（次に多い曲輪・区画で77種）ので置いていない。
       （数値は 2026-08-21 に castle.js の全件で計り直した） */
    const REMAIN_SUBGROUPS = {
        bldg: [
            ['門',             /門/],
            ['櫓',             /櫓/],
            ['天守',           /天守|天主/],
            ['御殿・書院',     /御殿|殿|書院|茶室|亭|閣|楼|舞台|玄関|部屋|隠居所|謁見所/],
            ['蔵・長屋・番所', /蔵|長屋|番所|倉庫|米倉|正倉|火薬庫|台所|厩|馬屋|小屋/],
            ['塀・築地',       /塀|築地/],
            ['寺社・祠',       /寺|社|堂|祠|本殿|鐘楼|時鐘/],
            ['屋敷・居館',     /屋敷|居館|館|陣屋|陣|邸|本館|主屋|母屋|藩校|会所|御役所|薬園|建物/],
            ['その他の建物',   /./],
        ],
    };
    /* 中分類の表示順。分類一覧と同じ理由で、情報シートに出る順に揃える。
       上の REMAIN_SUBGROUPS の並びは語をどの中分類に落とすかの規則そのもの
       （先に書いた方が勝つ。「櫓門」が門に入るのはこの順序による）なので触らず、
       表示順だけここに分けて持つ。
       この順は 2026-08-21 に castle.js の全件で数えた。中分類同士が同じ城に並ぶ31組は
       31組とも一方向100%で、順が割れる組は1つも無い（天守と櫓が並ぶ33城は33城とも
       天守が先、門と御殿・書院が並ぶ30城は30城とも門が先）。 */
    const REMAIN_SUBGROUP_ORDER = {
        bldg: ['天守', '櫓', '門', '御殿・書院', '蔵・長屋・番所',
               '塀・築地', '屋敷・居館', '寺社・祠', 'その他の建物'],
    };

    let remainsIndex = null;    // [{ n, g, id, idx:[城のfeature番号], _n }]（「なし」系は除く）
    let remainsGroups = null;   // [{ id, name, color, toks:[remainsIndex の要素], castles:Set }]
    // center は城一覧の近い順の起点で、遺構を開いた時点で固定する（openLordDetail と同じ扱い）
    // castleRows / castleShown は城一覧の中身と描いてある件数（城主と同じく「さらに表示」で継ぎ足す）
    let remainsState = { q: '', tokQ: '', castleQ: '', mode: 'group', sort: 'dist',
                         group: null, sub: null, target: null, center: null, centerPinned: false,
                         listScrollTop: 0, tokScrollTop: 0, subScrollTop: 0, castleScrollTop: 0,
                         restoreListScroll: 0, restoreTokScroll: 0, restoreCastleScroll: 0,
                         castleRows: [], castleShown: 0 };

    function remainGroupOf(tok) {
        // 「なし」「埋没」等の状態語は括弧の対応より先に見る。「埋没（堀」のように
        // 割れた断片であっても状態語であることに変わりはなく、一覧に出す語ではないため
        if (REMAIN_GROUP_DEFS[0][3].test(tok)) return 'none';
        // 括弧が閉じていない＝原典の括弧内で分断された語の断片。規則に掛けず「その他」に落とす
        const open = (tok.match(/[（(]/g) || []).length;
        const close = (tok.match(/[）)]/g) || []).length;
        if (open !== close) return 'other';
        for (const [id, , , re] of REMAIN_GROUP_DEFS) if (re.test(tok)) return id;
        return 'other';
    }

    function buildRemainsIndex() {
        const feats = (loadedData.castle && loadedData.castle.features) || [];
        const byTok = new Map();
        feats.forEach((f, i) => {
            const r = (f.properties || {}).remains;
            if (!r) return;
            const seen = new Set();
            r.split(/[、,]/).forEach(tok => {
                tok = tok.trim();
                if (!tok || seen.has(tok)) return;
                seen.add(tok);                       // 同じ城で同じ語は1回だけ数える
                let e = byTok.get(tok);
                if (!e) {
                    e = { n: tok, g: remainGroupOf(tok), idx: [], _n: normalizeForSearch(tok) };
                    byTok.set(tok, e);
                }
                e.idx.push(i);
            });
        });
        remainsIndex = [...byTok.values()].filter(e => e.g !== 'none')
            .sort((a, b) => b.idx.length - a.idx.length || a.n.localeCompare(b.n, 'ja'));
        remainsIndex.forEach((e, i) => { e.id = i; });

        const byGroup = new Map();
        remainsIndex.forEach(e => {
            let g = byGroup.get(e.g);
            if (!g) {
                const d = REMAIN_GROUP[e.g];
                g = { id: d.id, name: d.name, color: d.color, toks: [], castles: new Set() };
                byGroup.set(e.g, g);
            }
            g.toks.push(e);
            e.idx.forEach(i => g.castles.add(i));
        });
        // 中分類を持つ分類は、その中で語を束ねておく（見出しもタップできるようにするため城数も数える）
        byGroup.forEach(g => {
            const defs = REMAIN_SUBGROUPS[g.id];
            if (!defs) return;
            const bySub = new Map();
            g.toks.forEach(e => {
                const name = (defs.find(([, re]) => re.test(e.n)) || defs[defs.length - 1])[0];
                let s = bySub.get(name);
                if (!s) { s = { name, toks: [], castles: new Set() }; bySub.set(name, s); }
                s.toks.push(e);
                e.idx.forEach(i => s.castles.add(i));
            });
            const sOrder = REMAIN_SUBGROUP_ORDER[g.id] || [];
            const sRank = s => { const i = sOrder.indexOf(s.name);
                                 return i < 0 ? sOrder.length : i; };
            g.subs = [...bySub.values()].sort((a, b) => sRank(a) - sRank(b)
                                                        || b.castles.size - a.castles.size
                                                        || a.name.localeCompare(b.name, 'ja'));
        });
        // 情報シートに出る順（REMAIN_GROUP_ORDER）。載っていないIDは末尾に回して城数順
        const gRank = g => { const i = REMAIN_GROUP_ORDER.indexOf(g.id);
                             return i < 0 ? REMAIN_GROUP_ORDER.length : i; };
        remainsGroups = [...byGroup.values()].sort((a, b) => gRank(a) - gRank(b)
                                                    || b.castles.size - a.castles.size
                                                    || a.name.localeCompare(b.name, 'ja'));
    }

    // 入口ボタンの状態。城レイヤーを非表示にしたときにこのボタンを隠すのは
    // updateLordsEntry（城主と一緒に扱う）なので、ここは押せるかどうかだけ決める
    function updateRemainsEntry() {
        const btn = document.getElementById('remains-entry-btn');
        if (btn) btn.disabled = !loadedData.castle;
    }

    function showRemainsView(which) {
        setPanelLifted(true);
        document.getElementById('nearby-main-view').style.display = 'none';
        document.getElementById('nearby-settings-view').classList.remove('open');
        document.getElementById('nearby-remains-view').classList.toggle('open', which === 'list');
        document.getElementById('nearby-remains-group-view').classList.toggle('open', which === 'group');
        document.getElementById('nearby-remains-detail-view').classList.toggle('open', which === 'detail');
        const helpView = document.getElementById('nearby-remains-help-view');
        if (helpView) helpView.classList.remove('open');
    }

    /* target を渡すと、その遺構（または分類）の城一覧を直接開く（情報シートからの戻り導線で使う）。
       target は openRemainsDetail と同じ形式の文字列（'t:<遺構名>' / 'g:<分類ID>'）。 */
    function openRemainsView(target, restoreView) {
        if (!loadedData.castle) return;
        if (!remainsIndex) { buildRemainsIndex(); updateRemainsEntry(); }
        if (target) {
            const [kind, key] = [target.slice(0, 1), target.slice(2)];
            if (kind === 'g') remainsState.group = remainsGroups.find(g => g.id === key) || null;
            else remainsState.group = null;
            openRemainsDetail(target, restoreView);
            return;
        }
        showRemainsView('list');
        renderRemainsList();
    }

    function setRemainsMode(mode) {
        remainsState.mode = mode;
        document.querySelectorAll('#nearby-remains-view .lords-chip[data-rm]').forEach(b => {
            b.setAttribute('aria-pressed', String(b.dataset.rm === mode));
        });
        document.getElementById('remains-list').scrollTop = 0;
        renderRemainsList();
    }
    function onRemainsSearchInput(v) {
        remainsState.q = v;
        setSearchClearVisible('remains-search', v);
        debounceListFilter('remains', renderRemainsList);
    }
    function clearRemainsSearch() {
        const el = document.getElementById('remains-search');
        el.value = ''; onRemainsSearchInput(''); el.focus();
    }

    // 遺構名は属性に持たせて渡す（onclick の文字列に埋めると、名前に引用符が入ったときに壊れる）
    function remainsRowHtml(e, withGroup) {
        return `<div class="rt-row" data-t="t:${attrEscape(e.n)}" onclick="openRemainsDetail(this.dataset.t)">
            <span class="rt-dot" style="background:${REMAIN_GROUP[e.g].color}"></span>
            <div class="rt-name">${attrEscape(e.n)}</div>
            ${withGroup ? `<div class="rt-g">${REMAIN_GROUP[e.g].name}</div>` : ''}
            <div class="rt-num">${e.idx.length.toLocaleString()}城</div>
            <div class="lord-chev">›</div></div>`;
    }

    function renderRemainsList() {
        const list = document.getElementById('remains-list');
        const q = normalizeForSearch(remainsState.q.trim());
        let html;
        if (remainsState.mode === 'group') {
            // 絞り込みの語は分類名だけでなく中身の遺構名でも当てる（「天守」で建造物が残るように）
            const rows = remainsGroups.filter(g => !q || normalizeForSearch(g.name).includes(q)
                                                   || g.toks.some(t => t._n.includes(q)));
            html = rows.map(g => `<div class="lord-row" onclick="openRemainsGroup('${g.id}')">
                <div class="rg-ic" style="background:${g.color}"><svg viewBox="0 0 24 24">${REMAIN_GROUP_ICON[g.id]}</svg></div>
                <div class="lord-main">
                    <div class="lord-name">${attrEscape(g.name)}</div>
                    <div class="lord-sub">${attrEscape(g.toks.slice(0, 4).map(t => t.n).join('、'))} ほか${g.toks.length}種</div>
                </div>
                <div class="lord-num">${g.castles.size.toLocaleString()}城</div>
                <div class="lord-chev">›</div></div>`).join('');
            if (rows.length) html += `<div class="lords-note">全${remainsGroups.length}分類</div>`;
        } else {
            const rows = remainsIndex.filter(e => !q || e._n.includes(q));
            html = rows.map(e => remainsRowHtml(e, true)).join('');
            if (rows.length) html += `<div class="lords-note">全${remainsIndex.length.toLocaleString()}種</div>`;
        }
        list.innerHTML = html || '<div class="lords-note">該当する遺構がありません</div>';
        // 通常は先頭から。分類ページから戻ってきたときだけ、開く前の位置へ戻す
        list.scrollTop = remainsState.restoreListScroll || 0;
        remainsState.restoreListScroll = 0;
    }

    /* 分類の内訳（第8ビュー）。中分類を持つ分類（建造物）では中分類の一覧を出し、
       持たない分類では遺構をそのまま並べる。中分類の中身（小分類）も同じビューを
       使い回す（remainsState.sub が入っているかどうかで切り替える）。
       restoreView を立てて呼ぶと、離れる前のスクロール位置に戻す。 */
    function openRemainsGroup(gid, restoreView) {
        const g = remainsGroups.find(x => x.id === gid);
        if (!g) return;
        // 分類一覧から開いたときだけ、そこへ戻るための位置を控える
        if (!restoreView) remainsState.listScrollTop = document.getElementById('remains-list').scrollTop;
        remainsState.group = g;
        remainsState.sub = null;
        remainsState.restoreTokScroll = restoreView ? (remainsState.tokScrollTop || 0) : 0;
        openRemainsBreakdown(g.name, g.castles.size, restoreView, `g:${g.id}`);
    }

    /* 中分類の中身（小分類）。中分類の行の「内訳」ボタンから降りる。 */
    function openRemainsSub(subName, restoreView) {
        const g = remainsState.group;
        const s = g && g.subs && g.subs.find(x => x.name === subName);
        if (!s) return;
        // 中分類一覧から降りたときだけ、そこへ戻るための位置を控える
        if (!restoreView) remainsState.tokScrollTop = document.getElementById('remains-tok-list').scrollTop;
        remainsState.sub = s;
        remainsState.restoreTokScroll = restoreView ? (remainsState.subScrollTop || 0) : 0;
        openRemainsBreakdown(s.name, s.castles.size, restoreView, `s:${g.id}:${s.name}`);
    }

    // 第8ビューの共通部分（見出し・まとめて見る行・絞り込みの初期化）
    function openRemainsBreakdown(title, castleCount, restoreView, target) {
        document.getElementById('remains-group-title').textContent = title;
        const all = document.getElementById('remains-group-all');
        all.dataset.t = target;
        all.textContent = `＋ 「${title}」の城をまとめて見る（${castleCount.toLocaleString()}城）`;
        // 別の分類を開いたら絞り込みの語は持ち越さない（前の語のまま0件になるのを防ぐ）。
        // 戻ってきたときは離れる前の状態に戻すので触らない
        if (!restoreView) {
            remainsState.tokQ = '';
            document.getElementById('remains-tok-search').value = '';
            setSearchClearVisible('remains-tok-search', '');
        }
        showRemainsView('group');
        renderRemainsTokList();
    }
    function backToRemainsList() {
        remainsState.restoreListScroll = remainsState.listScrollTop || 0;
        showRemainsView('list');
        renderRemainsList();
    }
    // 第8ビューの戻る。小分類を開いていれば中分類の一覧へ、そうでなければ分類一覧へ
    function backFromRemainsBreakdown() {
        if (remainsState.sub) { openRemainsGroup(remainsState.group.id, true); return; }
        backToRemainsList();
    }
    function onRemainsTokSearchInput(v) {
        remainsState.tokQ = v;
        setSearchClearVisible('remains-tok-search', v);
        renderRemainsTokList();
    }
    function clearRemainsTokSearch() {
        const el = document.getElementById('remains-tok-search');
        el.value = ''; onRemainsTokSearchInput(''); el.focus();
    }
    function renderRemainsTokList() {
        const g = remainsState.group;
        if (!g) return;
        const q = normalizeForSearch(remainsState.tokQ.trim());
        const list = document.getElementById('remains-tok-list');
        let html, hit, total;
        if (g.subs && !remainsState.sub) {
            /* 中分類の一覧。行を押すとその中分類の城一覧、右端の「内訳」で小分類へ降りる。
               閲覧の中心は中分類（門286城・櫓181城）なので、いちばん使う操作を主タップに当てる。
               絞り込みの語は中分類名だけでなく中身の遺構名でも当てる（「移築門」で門が残るように） */
            const rows = g.subs.filter(s => !q || normalizeForSearch(s.name).includes(q)
                                            || s.toks.some(e => e._n.includes(q)));
            hit = rows.length; total = `全${g.subs.length}分類`;
            html = rows.map(s => `<div class="lord-row" data-t="s:${attrEscape(s.name)}" onclick="openRemainsDetail(this.dataset.t)">
                <div class="lord-main">
                    <div class="lord-name">${attrEscape(s.name)}</div>
                    <div class="lord-sub">${attrEscape(s.toks.slice(0, 3).map(e => e.n).join('、'))} ほか${s.toks.length}種</div>
                </div>
                <div class="lord-num">${s.castles.size.toLocaleString()}城</div>
                <button class="rt-drill" data-s="${attrEscape(s.name)}"
                        onclick="event.stopPropagation(); openRemainsSub(this.dataset.s)">内訳${s.toks.length}種
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                </button></div>`).join('');
        } else {
            // 遺構（小分類）の一覧。中分類を持たない分類の内訳と、中分類の中身の両方で使う
            const src = remainsState.sub ? remainsState.sub.toks : g.toks;
            const rows = src.filter(e => !q || e._n.includes(q));
            hit = rows.length; total = `全${src.length.toLocaleString()}種`;
            html = rows.map(e => remainsRowHtml(e, false)).join('');
        }
        list.innerHTML = hit
            ? html + `<div class="lords-note">${total}</div>`
            : '<div class="lords-note">該当する遺構がありません</div>';
        list.scrollTop = remainsState.restoreTokScroll || 0;
        remainsState.restoreTokScroll = 0;
    }

    /* 城一覧。target は 't:<遺構名>'（その遺構を持つ城）か 'g'（今開いている分類の城をまとめて）。
       restoreView は openLordDetail と同じ意味で、城を開く前の一覧の状態
       （近い順の起点・スクロール位置）を保つ。 */
    function openRemainsDetail(target, restoreView) {
        let name, idx;
        // 第8ビューのどちらを見ていたか（中分類の一覧か、小分類の一覧か）は
        // remainsState.sub を書き換える前にしか分からないので先に控える
        const leftSubList = !!remainsState.sub;
        if (target === 'g' || target.startsWith('g:')) {
            const g = target === 'g' ? remainsState.group
                                     : remainsGroups.find(x => x.id === target.slice(2));
            if (!g) return;
            remainsState.group = g;
            remainsState.target = `g:${g.id}`;
            name = `${g.name}（まとめて）`;
            idx = [...g.castles];
        } else if (target.startsWith('s:')) {
            // 中分類の見出しから。今開いている分類の中を探す（戻り導線からは分類IDも一緒に来る）
            const p = target.slice(2).split(':');
            const g = p.length > 1 ? remainsGroups.find(x => x.id === p[0]) : remainsState.group;
            const subName = p.length > 1 ? p[1] : p[0];
            const s = g && g.subs && g.subs.find(x => x.name === subName);
            if (!s) return;
            remainsState.group = g;
            // 中分類の行から来たなら戻り先は中分類の一覧。小分類の一覧の「まとめて見る」から
            // 来たならそこへ帰したいので、そのときだけ sub を残す
            if (!leftSubList) remainsState.sub = null;
            remainsState.target = `s:${g.id}:${s.name}`;
            name = s.name;
            idx = [...s.castles];
        } else {
            const key = target.slice(2);
            const e = remainsIndex.find(x => x.n === key);
            if (!e) return;
            remainsState.target = `t:${e.n}`;
            // 個別の遺構は、戻り導線からも属する分類の内訳へ帰れるようにしておく。
            // 中分類を持つ分類なら、その遺構が属する中分類まで特定して戻り先にする
            if (!remainsState.group || remainsState.group.id !== e.g) {
                remainsState.group = remainsGroups.find(g => g.id === e.g) || null;
                remainsState.sub = null;
            }
            const g = remainsState.group;
            if (g && g.subs) remainsState.sub = g.subs.find(s => s.toks.includes(e)) || null;
            name = e.n;
            idx = e.idx;
        }
        if (!restoreView) {
            // 一覧から開いたときだけ、どの一覧から来たかと、そこへ戻るための位置を控える
            if (document.getElementById('nearby-remains-group-view').classList.contains('open')) {
                const top = document.getElementById('remains-tok-list').scrollTop;
                if (leftSubList) remainsState.subScrollTop = top;
                else remainsState.tokScrollTop = top;
                remainsState.from = 'breakdown';
            } else if (document.getElementById('nearby-remains-view').classList.contains('open')) {
                remainsState.listScrollTop = document.getElementById('remains-list').scrollTop;
                // チップ「個別」のフラット一覧から直接開いた場合。戻り先はそこにする
                remainsState.from = 'list';
            }
        }
        if (!restoreView || !remainsState.center) {
            const c = getSearchCenter();
            remainsState.center = { lat: c.lat, lng: c.lng };
            // 起点が検索ピンだったのか地図の中心だったのかは、控えた時点でしか分からない
            remainsState.centerPinned = !!searchPinLngLat;
        }
        remainsState.restoreCastleScroll = restoreView ? (remainsState.castleScrollTop || 0) : 0;
        remainsState.castleIdx = idx;
        // 別の遺構を開いたら絞り込みは持ち越さない
        remainsState.castleQ = '';
        document.getElementById('remains-castle-search').value = '';
        setSearchClearVisible('remains-castle-search', '');
        document.getElementById('remains-detail-title').textContent = `${name}（${idx.length.toLocaleString()}城）`;
        renderDistOrigin('remains');
        showRemainsView('detail');
        // 戻ってきたときは継ぎ足した分もそのまま（スクロール位置を戻す先が変わらないように）
        renderRemainsCastles(restoreView);
    }
    // 城一覧の戻る。開く前に見ていた一覧（分類一覧／中分類の一覧／小分類の一覧）へ帰す
    function backToRemainsGroup() {
        if (remainsState.from === 'list') { backToRemainsList(); return; }
        if (remainsState.sub) { openRemainsSub(remainsState.sub.name, true); return; }
        if (remainsState.group) { openRemainsGroup(remainsState.group.id, true); return; }
        backToRemainsList();
    }
    function setRemainsSort(sort) {
        remainsState.sort = sort;
        document.querySelectorAll('#nearby-remains-detail-view .lords-chip[data-rs]').forEach(b => {
            b.setAttribute('aria-pressed', String(b.dataset.rs === sort));
        });
        renderRemainsCastles();
    }
    function onRemainsCastleSearchInput(v) {
        remainsState.castleQ = v;
        setSearchClearVisible('remains-castle-search', v);
        debounceListFilter('remainsCastle', renderRemainsCastles);
    }
    function clearRemainsCastleSearch() {
        const el = document.getElementById('remains-castle-search');
        el.value = ''; onRemainsCastleSearchInput(''); el.focus();
    }

    /* keepShown を立てて呼ぶと、継ぎ足した分（remainsState.castleShown）を保つ。
       城主の城一覧（renderLordCastles）と同じ扱い。 */
    function renderRemainsCastles(keepShown) {
        if (!keepShown) remainsState.castleShown = CASTLE_LIST_CHUNK;
        const feats = (loadedData.castle && loadedData.castle.features) || [];
        const center = remainsState.center || getSearchCenter();
        const q = normalizeForSearch(remainsState.castleQ.trim());
        const rows = (remainsState.castleIdx || []).map(i => {
            const f = feats[i];
            const c = f.geometry.coordinates;
            // 城主詳細と同じく、都道府県は prefOfProps で取る
            return { i, f, pref: prefOfProps(f.properties) || '',
                     dist: calcDist(center.lat, center.lng, c[1], c[0]) };
        }).filter(r => {
            if (!q) return true;
            const p = r.f.properties;
            return normalizeForSearch(`${p.name || ''} ${r.pref} ${p.address || ''}`).includes(q);
        });
        // 城主詳細と同じ並び。近い順は距離だけ、都道府県順は県が先で格付けは県の中での並び
        const rank = r => castleGenreRank(r.f.properties);
        if (remainsState.sort === 'dist') rows.sort((a, b) => a.dist - b.dist);
        else rows.sort((a, b) => (PREF_ORDER[a.pref] ?? 99) - (PREF_ORDER[b.pref] ?? 99)
                                 || rank(a) - rank(b)
                                 || LIST_COLLATOR.compare(a.f.properties.name, b.f.properties.name));
        remainsState.castleRows = rows;        // 継ぎ足し（showMoreRemainsCastles）で使い回す
        const list = document.getElementById('remains-castle-list');
        if (rows.length === 0) {
            list.innerHTML = '<div class="lords-note">該当する城がありません</div>';
            return;
        }
        // 行の作りは城主の城一覧と同じ（castleRowsHtml）。副見出しは住所そのもの
        const shown = Math.min(rows.length, remainsState.castleShown || CASTLE_LIST_CHUNK);
        remainsState.castleShown = shown;
        list.innerHTML = castleRowsHtml(rows, 0, shown, 'remainsJumpToCastle')
            + listFootHtml(shown, rows.length, 'showMoreRemainsCastles()', CASTLE_LIST_CHUNK);
        // 通常は先頭から。城を開いて戻ってきたときだけ、開く前の位置へ戻す
        list.scrollTop = remainsState.restoreCastleScroll || 0;
        remainsState.restoreCastleScroll = 0;
    }

    /* 「さらに表示」。いま出ている続きから見えるよう、スクロール位置は動かさない。 */
    function showMoreRemainsCastles() {
        const rows = remainsState.castleRows || [];
        const from = remainsState.castleShown || CASTLE_LIST_CHUNK;
        const to = Math.min(rows.length, from + CASTLE_LIST_CHUNK);
        if (to <= from) return;
        remainsState.castleShown = to;
        appendListRows('remains-castle-list', castleRowsHtml(rows, from, to, 'remainsJumpToCastle'),
                       to, rows.length, 'showMoreRemainsCastles()', CASTLE_LIST_CHUNK);
    }

    // 一覧から城へ飛ぶ。城主一覧（lordsJumpToCastle）と同じ扱いにする
    function remainsJumpToCastle(featIdx) {
        const f = loadedData.castle.features[featIdx];
        if (!f) return;
        const c = f.geometry.coordinates.slice();
        const p = f.properties;
        const label = p.name || '城';
        const back = remainsState.target;
        // 戻り導線で開く前の位置へ戻せるよう、離れる前に控える（一覧の位置と地図）
        remainsState.castleScrollTop = document.getElementById('remains-castle-list').scrollTop;
        saveListReturnCamera();
        closeNearby();
        if (trackingMode > 0) {
            trackingMode = 0;
            stopRafLoop();
            updateGeolocateButton();
        }
        const zoom = landingZoom(c[0], c[1]);
        histSetPending(label, 'pin', { objType: 'castle', objProps: p }, { coords: c, zoom });
        map.easeTo({ center: c, zoom, bearing: 0, pitch: 0, duration: 550, essential: true });
        setTimeout(() => {
            openObjSheet('castle', label, p, c[0], c[1]);
            injectRemainsBackLink(back);
        }, 300);
    }

    // 一覧から来たときだけ、情報シートの先頭に戻り導線を挿す（城主・都道府県と同じ扱い）
    function injectRemainsBackLink(target) {
        if (!target) return;
        const body = document.getElementById('obj-sheet-body');
        if (!body || body.querySelector('.os-lords-back')) return;
        // 'g:<分類ID>' は分類名、's:<分類ID>:<中分類名>' は中分類名、't:<遺構名>' はそのまま
        const g = target.startsWith('g:') ? remainsGroups.find(x => x.id === target.slice(2)) : null;
        const name = g ? g.name
                       : target.startsWith('s:') ? target.slice(2).split(':')[1]
                       : target.slice(2);
        const div = document.createElement('div');
        div.className = 'os-lords-back';
        div.textContent = `↩ 「${name}」の城一覧に戻る`;
        // 開く前の一覧の状態（近い順の起点・スクロール位置）と地図のまま戻す
        div.onclick = () => { closeObjSheet(); restoreListReturnCamera(); openNearbyPanel(); openRemainsView(target, true); };
        body.insertBefore(div, body.firstChild);
    }

