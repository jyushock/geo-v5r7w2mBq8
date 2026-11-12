    // ══ 城主から探す ═══════════════════════════════════════════════════
    /* castle.js の properties.lords（攻城団・城郭放浪記・Wikipediaの城主欄を統合した値）を
       人物・氏族ごとにまとめ、そこから城へ飛ぶ一覧。索引は castle.js が届いた後に
       初回オープンで組む（表示用の別データファイルは持たない。castle.js に既に入っている
       情報なので、二重に配ると更新のたびに食い違うため）。
       分割・正規化の規則は資料生成スクリプト tools/gen_castle_lords.py と同じにしてある。 */

    // 城主欄の区切り。読点のほか、実データに出る半角読点・「･」・継承の「→」・空白も区切る
    const LORD_SPLIT_RE = /[、,，･→\s;；]+/;
    // 実体のない値。castle.js には原典どおり残っているが、一覧には出さない
    const LORD_SKIP = new Set(['不明', '不詳', 'なし', '無し']);
    // 城郭放浪記のアクセス解説文が城主欄に混入している4城分（castle.js側のデータ不良）。
    // 元データが直れば空振りするだけなので、直った後もこのままで害はない。
    const LORD_NOISE = new Set([
        '潮山の西側を通る県道209号線沿いに道標があり',
        'それに従って山へ入って行くと茶畑の間を通って城址近くまで車で行くことができる。',
        '西側から泰仙寺橋へ続く道の北側に土手下を走る道があり',
        'そこに案内板がある。',
        '関澤神社脇から登る。',
    ]);
    const LORDS_CHUNK = 60;              // 一覧の追加描画単位（11,000名超を一度に積まない）
    let lordIndex = null;                // [{ n, kind, idx:[城のfeature番号], v:[原表記], _n }]
    // center は城一覧の近い順の起点で、城主を開いた時点で固定する（openLordDetail を参照）。
    // listScrollTop / listShown は城主一覧、castleScrollTop は城一覧の、離れる前の位置。
    // castleRows / castleShown は城一覧の中身と描いてある件数（「さらに表示」で継ぎ足す）
    let lordsState = { q: '', type: 'all', sort: 'dist', filtered: [], shown: 0, lord: null,
                       center: null, listScrollTop: 0, listShown: 0, castleScrollTop: 0,
                       castleRows: [], castleShown: 0 };

    // 集計キーを作る。末尾の括弧注記（石高・別称）と推量記号を落とす。
    // 先頭の括弧注記は個人名のときだけ落とす（氏族名から落とすと「（大給）松平氏」が
    // 「松平氏」に吸われて分家の区別が消えるため）。語中の括弧は人名の一部なので触らない。
    /* 個人／組織の判定。組織には氏族（「〜氏」）も含める。
       城主欄には人物のほかに幕府・藩・一揆・寺社なども入るため、人名と衝突しない語尾
       だけを組織の目印にする（実データ全件で確認）。
       「家」「衆」「坊」「国」「村」「方」は前田利家・松平容衆・杉谷善住坊・本多忠国・
       三浦義村・板垣信方のように人名と衝突するので使わない。
       琉球の「〜按司」は人物の称号なので個人のままにする。 */
    const LORD_ORG_RE = /(氏|幕府|藩|朝廷|皇室|公儀|一族|一門|党|水軍|軍|勢|寺|院|社|法人|財団)$/;
    function lordKind(name) {
        return (name.includes('一揆') || LORD_ORG_RE.test(name)) ? 'org' : 'person';
    }

    function normalizeLordName(raw) {
        let t = raw.trim().replace(/^[?？。]+/, '').replace(/[?？。]+$/, '').trim();
        t = t.replace(/\(/g, '（').replace(/\)/g, '）');
        t = t.replace(/（[^（）]*）$/, '').trim();
        const m = t.match(/^（[^（）]*）(.+)$/);
        if (m && !m[1].endsWith('氏')) t = m[1].trim();
        return t;
    }

    function buildLordIndex() {
        const feats = (loadedData.castle && loadedData.castle.features) || [];
        const byName = new Map();
        feats.forEach((f, i) => {
            const p = f.properties || {};
            if (!p.lords) return;
            const seen = new Set();
            p.lords.split(LORD_SPLIT_RE).forEach(tok => {
                tok = tok.trim();
                if (!tok || LORD_NOISE.has(tok)) return;
                const key = normalizeLordName(tok);
                if (!key || LORD_SKIP.has(key) || LORD_NOISE.has(key)) return;
                let e = byName.get(key);
                if (!e) {
                    e = { n: key, kind: lordKind(key), idx: [], v: [], _n: normalizeForSearch(key) };
                    byName.set(key, e);
                }
                if (tok !== key && !e.v.includes(tok)) e.v.push(tok);
                if (!seen.has(key)) { e.idx.push(i); seen.add(key); }   // 同じ城で同じキーは1回
            });
        });
        lordIndex = [...byName.values()];
        // 「〜家」は家名（森家）と人名（前田利家）が混在するため語尾だけでは分けられない。
        // 語幹＋「氏」が別項目として実在するものだけを家名とみなして組織に寄せる
        // （実データでは29件が該当し、人名は1件も混ざらないことを確認済み）
        lordIndex.forEach(e => {
            if (e.kind === 'person' && e.n.endsWith('家') && byName.has(e.n.slice(0, -1) + '氏')) e.kind = 'org';
        });
        lordIndex.sort((a, b) => (b.idx.length - a.idx.length) || a.n.localeCompare(b.n, 'ja'));
        lordIndex.forEach((e, i) => { e.id = i; });
    }

    /* メニューの入口ボタンの状態。城レイヤーを表示していないときは出さない
       （検索・周辺検索が非表示の種別を候補から外すのと同じ扱い）。
       消すのは城のデータしか辿らない2本（城主・遺構）だけで、「一覧から検索」の枠ごとは消さない。
       枠ごと消すと、城と関係のない都道府県とお気に入りまで一緒に消えるため。 */
    function updateLordsEntry() {
        const btn = document.getElementById('lords-entry-btn');
        const rbtn = document.getElementById('remains-entry-btn');
        if (!btn) return;
        const hide = filterState.castle === false;
        btn.style.display = hide ? 'none' : '';
        if (rbtn) rbtn.style.display = hide ? 'none' : '';
        // 読み込みが済むまでは押せない。件数などの補足は出さない（2列に並べると折り返すため）
        btn.disabled = !loadedData.castle;
    }

    // メインビューへ戻すのは openNearbyPanel 側（メニューを開き直したとき）
    /* パネルの位置。フッター（検索ボックス・現在地・閉じる）を持つのはメインビューだけで、
       それが下部バーの代わりを務める。フッターの無いビューでは下部バーを見せたいので、
       パネルをバーの上に載せる（載せた状態を lifted と呼ぶ）。 */
    function setPanelLifted(on) {
        document.getElementById('nearby-panel').classList.toggle('lifted', on);
    }

    function showLordsView(which) {
        setPanelLifted(true);
        document.getElementById('nearby-main-view').style.display = 'none';
        document.getElementById('nearby-settings-view').classList.remove('open');
        document.getElementById('nearby-lords-view').classList.toggle('open', which === 'list');
        document.getElementById('nearby-lord-detail-view').classList.toggle('open', which === 'detail');
    }

    // lordId を渡すと、その城主の城一覧を直接開く（情報シートからの戻り導線で使う）
    function openLordsView(lordId, restoreView) {
        if (!loadedData.castle) return;
        if (!lordIndex) { buildLordIndex(); updateLordsEntry(); }
        if (lordId != null && lordIndex[lordId]) { openLordDetail(lordId, restoreView); return; }
        showLordsView('list');
        applyLordsFilter();
    }
    function backToLordsList() {
        // 城主を開く前の位置へ戻す（描いてある行数も揃えてから位置を指定する）
        lordsState.restoreListScroll = lordsState.listScrollTop || 0;
        lordsState.restoreShown = lordsState.listShown || 0;
        showLordsView('list');
        applyLordsFilter();
    }

    // 絞り込みは打ち終わりから描く（debounceListFilter。他の一覧の絞り込み欄と同じ扱い）
    function onLordsSearchInput(v) { lordsState.q = v; debounceListFilter('lords', applyLordsFilter); }
    function setLordsType(t) {
        lordsState.type = t;
        document.querySelectorAll('#nearby-lords-view .lords-chip[data-lt]').forEach(b => {
            b.setAttribute('aria-pressed', String(b.dataset.lt === t));
        });
        applyLordsFilter();
    }
    /* 照合するのは城主名（集計キーと、その表記ゆれ）だけにする。
       以前は城名・都道府県でも引けるようにしていたが、人物・氏族を探す画面で
       城側の語に当たると意図しない城主が並ぶため、城名は対象から外した。
       城名で城を探す導線は、メイン検索と「都道府県から探す」が受け持つ。 */
    function applyLordsFilter() {
        const q = normalizeForSearch(lordsState.q.trim());
        lordsState.filtered = lordIndex.filter(l => {
            if (lordsState.type !== 'all' && lordsState.type !== l.kind) return false;
            if (!q) return true;
            if (l._n.includes(q)) return true;
            return l.v.some(v => normalizeForSearch(v).includes(q));
        });
        // 戻ってきたときだけ、離れる前の描画量と位置に復元する（絞り込みが同じなら並びも同じ）
        const restoreTop = lordsState.restoreListScroll || 0;
        const restoreShown = lordsState.restoreShown || 0;
        lordsState.restoreListScroll = 0;
        lordsState.restoreShown = 0;
        const list = document.getElementById('lords-list');
        list.innerHTML = '';
        list.scrollTop = 0;
        lordsState.shown = 0;
        if (lordsState.filtered.length === 0) {
            list.innerHTML = '<div class="lords-note">該当する城主がいません</div>';
            return;
        }
        renderLordsChunk();
        while (lordsState.shown < restoreShown && lordsState.shown < lordsState.filtered.length) {
            renderLordsChunk();
        }
        if (restoreTop) list.scrollTop = restoreTop;
    }

    function renderLordsChunk() {
        const list = document.getElementById('lords-list');
        const part = lordsState.filtered.slice(lordsState.shown, lordsState.shown + LORDS_CHUNK);
        const feats = loadedData.castle.features;
        list.insertAdjacentHTML('beforeend', part.map(l => {
            // 副見出しは表記ゆれがあればそれを、無ければ城名を並べる（どの城の城主か分かるように）
            const sub = l.v.length
                ? '表記: ' + l.v.join(' / ')
                : l.idx.slice(0, 3).map(i => (feats[i].properties.name || '')).join('・')
                  + (l.idx.length > 3 ? ' ほか' : '');
            // 行にアイコンは置かない（人／組は「人」「組」の一文字を丸で囲んでいただけで、
            // 絵ではなく文字だったため。人／組の区別は絞り込みチップで付けられる）
            return `<div class="lord-row" ${actionAttrs('openLordDetail', Number(l.id))}>
                <div class="lord-main">
                    <div class="lord-name">${attrEscape(l.n)}</div>
                    <div class="lord-sub">${attrEscape(sub)}</div>
                </div>
                <div class="lord-num">${l.idx.length}城</div>
                <div class="lord-chev">›</div>
            </div>`;
        }).join(''));
        lordsState.shown += part.length;
    }

    // 末尾付近までスクロールしたら続きを描画
    document.getElementById('lords-list').addEventListener('scroll', function () {
        if (lordsState.shown >= lordsState.filtered.length) return;
        if (this.scrollTop + this.clientHeight > this.scrollHeight - 400) renderLordsChunk();
    });

    /* restoreView は openPrefDetail と同じ意味で、城を開く前の一覧の状態
       （近い順の起点・スクロール位置）を保つ。戻り導線から立てて呼ぶ。 */
    function openLordDetail(id, restoreView) {
        const l = lordIndex[id];
        if (!l) return;
        if (!restoreView) {
            // 一覧から開いたときだけ、城主一覧に戻るための位置を控える
            lordsState.listScrollTop = document.getElementById('lords-list').scrollTop;
            lordsState.listShown = lordsState.shown;
        }
        if (!restoreView || !lordsState.center) {
            const c = getSearchCenter();
            lordsState.center = { lat: c.lat, lng: c.lng };
            // 起点が検索ピンだったのか地図の中心だったのかは、控えた時点でしか分からない
            lordsState.centerPinned = !!searchPinLngLat;
        }
        lordsState.restoreCastleScroll = restoreView ? (lordsState.castleScrollTop || 0) : 0;
        lordsState.lord = l;
        document.getElementById('lord-detail-title').textContent = `${l.n}（${l.idx.length}城）`;
        // 別の城主を開いたら絞り込みは持ち越さない（前の語のまま0件になるのを防ぐ）
        lordsState.castleQ = '';
        document.getElementById('lord-castle-search').value = '';
        setSearchClearVisible('lord-castle-search', '');
        const vEl = document.getElementById('lord-detail-variants');
        vEl.textContent = l.v.length ? '表記: ' + l.v.join(' / ') : '';
        vEl.style.display = l.v.length ? '' : 'none';
        renderDistOrigin('lord');
        showLordsView('detail');
        // 戻ってきたときは継ぎ足した分もそのまま（スクロール位置を戻す先が変わらないように）
        renderLordCastles(restoreView);
    }

    function setLordCastleSort(sort) {
        lordsState.sort = sort;
        document.querySelectorAll('#nearby-lord-detail-view .lords-chip').forEach((b, i) => {
            b.setAttribute('aria-pressed', String((i === 0) === (sort === 'dist')));
        });
        renderLordCastles();
    }

    // 入力があるときだけクリアボタンを出す（メイン画面の #search-clear と同じ振る舞い）
    function setSearchClearVisible(inputId, v) {
        const el = document.getElementById(inputId);
        if (el && el.parentElement) el.parentElement.classList.toggle('has-text', !!v);
    }

