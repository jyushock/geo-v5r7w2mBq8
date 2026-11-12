    /* ══ 遺構の見かた（図解） ═══════════════════════════════════════
       入口は2つ（mock/remains-help-entry-preview.html の案1・案5）。
         ①「遺構から探す」の見出しの「？」→ 遺構の見かたビュー。全90枚を分野 → 観点の順に縦に並べ、
           上の分野チップで飛ぶ（見せ方A）
         ② 情報シートの遺構の語 → その語の1枚をシートの上に重ねる（openRemainsHelpPop、見せ方E）
       図とカードの中身は remains-help.js に分けてあり、どちらかを初めて開いたときに読み込む。
       本体に入れないのは、図解を開かない利用者にまで毎回読ませないため。 */
    const REMAINS_HELP_URL = 'remains-help.js';
    const REMAINS_HELP_FAIL = '<div class="lords-note">図解を読み込めませんでした。通信できる状態でもう一度開いてください</div>';
    let remainsHelpLoading = null;
    let remainsHelpBuilt = false;
    let remainsHelpQ = '';
    let remainsHelpScrollRaf = 0;
    function ensureRemainsHelp() {
        if (window.REMAINS_HELP) return Promise.resolve(window.REMAINS_HELP);
        if (!remainsHelpLoading) {
            remainsHelpLoading = new Promise((resolve, reject) => {
                const s = document.createElement('script');
                s.src = REMAINS_HELP_URL;
                s.onload = () => window.REMAINS_HELP ? resolve(window.REMAINS_HELP) : reject(new Error('remains-help: empty'));
                // 失敗（オフラインで未取得など）は覚えておかず、次に押したときに読み直す
                s.onerror = () => { remainsHelpLoading = null; s.remove(); reject(new Error('remains-help: load')); };
                document.head.appendChild(s);
            });
        }
        return remainsHelpLoading;
    }
    // 行き先（カード名か「§分野名」）から、カードと分野を引く
    function remainsHelpFind(dest) {
        const sections = window.REMAINS_HELP.SECTIONS;
        if (dest.startsWith('§')) {
            const sec = sections.find(s => s.name === dest.slice(1));
            return sec ? { sec } : null;
        }
        for (const sec of sections) for (const sub of sec.subs) for (const card of sub.cards) {
            if (card.t === dest) return { card, sec };
        }
        return null;
    }
    // カード1枚。城数（モックの灰色の行）は castle.js の更新で古くなるので出さない
    function remainsHelpCardHtml(c, sec, searchable) {
        const q = searchable ? ` data-q="${attrEscape(normalizeForSearch(`${c.t} ${c.y || ''}`))}"` : '';
        return `<article class="rh-card" style="--g:${sec.color}"${q}><div class="rh-fig">${c.fig}</div><div class="rh-body">`
             + `<div class="rh-ttl"><b>${c.t}</b>${c.y ? `<span class="rh-yomi">${c.y}</span>` : ''}`
             + `${c.unv ? '<span class="rh-unv">出典未確認</span>' : ''}</div><p class="rh-txt">${c.txt}</p></div></article>`;
    }

    function openRemainsHelp() {
        const view = document.getElementById('nearby-remains-help-view');
        if (!view) return;
        setPanelLifted(true);
        document.getElementById('nearby-main-view').style.display = 'none';
        document.getElementById('nearby-remains-view').classList.remove('open');
        document.getElementById('nearby-remains-group-view').classList.remove('open');
        document.getElementById('nearby-remains-detail-view').classList.remove('open');
        view.classList.add('open');
        const list = document.getElementById('remains-help-list');
        // 開くたびに先頭（曲輪）から、絞り込みなしで見せる（遺構から探すの一覧と同じ扱い）
        if (remainsHelpBuilt) {
            const input = document.getElementById('remains-help-search');
            if (remainsHelpQ) { input.value = ''; onRemainsHelpSearchInput(''); }
            list.scrollTop = 0;
            syncRemainsHelpChips();
            return;
        }
        list.innerHTML = '<div class="lords-note">読み込み中…</div>';
        ensureRemainsHelp().then(buildRemainsHelpView).catch(() => { list.innerHTML = REMAINS_HELP_FAIL; });
    }
    // 戻る。「遺構から探す」の一覧は描いたまま残っているので、スクロール位置もそのまま戻る
    function closeRemainsHelp() {
        showRemainsView('list');
    }
    // 中身は初めて開いたときに1回だけ描く（90枚の図を開くたびに作り直さない）。絞り込みは表示の出し入れで行う
    function buildRemainsHelpView() {
        const sections = window.REMAINS_HELP.SECTIONS;
        document.getElementById('remains-help-chips').innerHTML = sections.map((s, i) =>
            `<button class="rh-chip" data-i="${i}" style="--g:${s.color}" aria-pressed="${i === 0}" onclick="jumpRemainsHelpSection(${i})">${s.name}</button>`).join('');
        const list = document.getElementById('remains-help-list');
        list.innerHTML = sections.map((s, i) => {
            const n = s.subs.reduce((a, sub) => a + sub.cards.length, 0);
            return `<section class="rh-sec" data-i="${i}" style="--g:${s.color}">`
                 + `<div class="rh-sec-h">${s.name}<small>${n}種類</small></div><p class="rh-lead">${s.lead}</p>`
                 + s.subs.map(sub => `<div class="rh-sub"><div class="rh-subh">${sub.name}</div><div class="rh-cards">`
                     + sub.cards.map(c => remainsHelpCardHtml(c, s, true)).join('') + '</div></div>').join('')
                 + '</section>';
        }).join('') + '<div class="lords-note" id="remains-help-empty" hidden>該当する遺構がありません</div>';
        list.addEventListener('scroll', onRemainsHelpScroll, { passive: true });
        remainsHelpBuilt = true;
        applyRemainsHelpFilter();
    }
    function onRemainsHelpSearchInput(v) {
        remainsHelpQ = v;
        setSearchClearVisible('remains-help-search', v);
        if (remainsHelpBuilt) applyRemainsHelpFilter();
    }
    function clearRemainsHelpSearch() {
        const el = document.getElementById('remains-help-search');
        el.value = ''; onRemainsHelpSearchInput(''); el.focus();
    }
    // 名前と読みで絞る。当たったカードの無い観点・分野は見出しごと隠し、その分野のチップは押せなくする
    function applyRemainsHelpFilter() {
        const q = normalizeForSearch(remainsHelpQ.trim());
        const list = document.getElementById('remains-help-list');
        let any = false;
        list.querySelectorAll('.rh-sec').forEach(sec => {
            let secHit = false;
            sec.querySelectorAll('.rh-sub').forEach(sub => {
                let subHit = false;
                sub.querySelectorAll('.rh-card').forEach(card => {
                    const hit = !q || card.dataset.q.includes(q);
                    card.hidden = !hit;
                    subHit = subHit || hit;
                });
                sub.hidden = !subHit;
                secHit = secHit || subHit;
            });
            sec.hidden = !secHit;
            any = any || secHit;
            const chip = document.querySelector(`#remains-help-chips .rh-chip[data-i="${sec.dataset.i}"]`);
            if (chip) chip.disabled = !secHit;
        });
        list.classList.toggle('filtering', !!q);
        document.getElementById('remains-help-empty').hidden = any;
        list.scrollTop = 0;
        syncRemainsHelpChips();
    }
    function jumpRemainsHelpSection(i) {
        const list = document.getElementById('remains-help-list');
        const sec = list.querySelector(`.rh-sec[data-i="${i}"]`);
        if (!sec || sec.hidden) return;
        list.scrollTop += sec.getBoundingClientRect().top - list.getBoundingClientRect().top;
        setRemainsHelpChip(i);
    }
    // 送った位置の分野にチップを合わせる（1フレームに1回だけ計る）
    function onRemainsHelpScroll() {
        if (remainsHelpScrollRaf) return;
        remainsHelpScrollRaf = requestAnimationFrame(() => { remainsHelpScrollRaf = 0; syncRemainsHelpChips(); });
    }
    function syncRemainsHelpChips() {
        const list = document.getElementById('remains-help-list');
        const top = list.getBoundingClientRect().top;
        const secs = [...list.querySelectorAll('.rh-sec')].filter(s => !s.hidden);
        let cur = secs[0];
        secs.forEach(s => { if (s.getBoundingClientRect().top - top <= 8) cur = s; });
        if (cur) setRemainsHelpChip(+cur.dataset.i);
    }
    function setRemainsHelpChip(i) {
        const wrap = document.getElementById('remains-help-chips');
        let on = null;
        wrap.querySelectorAll('.rh-chip').forEach(b => {
            const pressed = +b.dataset.i === i;
            b.setAttribute('aria-pressed', String(pressed));
            if (pressed) on = b;
        });
        // 押されているチップが見えるよう、チップの行だけを横に送る
        if (!on) return;
        const wr = wrap.getBoundingClientRect(), br = on.getBoundingClientRect();
        if (br.left < wr.left + 12) wrap.scrollLeft -= wr.left + 12 - br.left;
        else if (br.right > wr.right - 12) wrap.scrollLeft += br.right - (wr.right - 12);
    }

    /* 情報シートの語から出す1枚。要素は初めて出すときに作る。
       総称（§分野）は、分野の説明と種類のボタンを出し、種類を押すとその1枚に替える */
    function openRemainsHelpPop(dest, word) {
        let pop = document.getElementById('rh-pop');
        const created = !pop;
        if (!pop) {
            const dim = document.createElement('div');
            dim.id = 'rh-pop-dim';
            dim.onclick = closeRemainsHelpPop;
            pop = document.createElement('div');
            pop.id = 'rh-pop';
            pop.setAttribute('role', 'dialog');
            pop.innerHTML = '<div class="rh-pop-head"><div class="rh-pop-title" id="rh-pop-title"></div>'
                          + '<button class="rh-pop-x" onclick="closeRemainsHelpPop()" title="閉じる">×</button></div>'
                          + '<div class="rh-pop-body" id="rh-pop-body"></div>';
            document.body.append(dim, pop);
        }
        // 古い index.html（この CSS が無い）と組み合わさったときは出さない。CSS の無い箱は画面の上端に
        // 「×」だけの帯として出てしまうので、作った要素ごと外す（Playwright で再現して確認）
        if (getComputedStyle(pop).position !== 'fixed') {
            pop.remove();
            document.getElementById('rh-pop-dim').remove();
            return;
        }
        if (created) {
            // メニュー・情報シートと同じく下スワイプで閉じる。見出しはブラウザの縦スクロールに渡さず、
            // 本文はスクロール不要な間だけ touch-action を none にして、下スワイプが画面ごと動かないようにする
            const head = pop.querySelector('.rh-pop-head');
            head.style.touchAction = 'none';
            enableSheetSwipeClose(pop, head, closeRemainsHelpPop);
            watchScrollerTouchAction('#rh-pop-body');
        }
        document.getElementById('rh-pop-title').textContent = word;
        const body = document.getElementById('rh-pop-body');
        body.innerHTML = '<div class="lords-note">読み込み中…</div>';
        pop.classList.add('open');
        document.getElementById('rh-pop-dim').classList.add('open');
        ensureRemainsHelp().then(() => renderRemainsHelpPop(dest)).catch(() => { body.innerHTML = REMAINS_HELP_FAIL; });
    }
    function renderRemainsHelpPop(dest, backSec) {
        const body = document.getElementById('rh-pop-body');
        if (!body) return;
        const hit = remainsHelpFind(dest);
        if (!hit) {
            body.innerHTML = '<div class="lords-note">この語の図解はありません</div>';
        } else if (hit.card) {
            const back = backSec
                ? `<button class="rh-back" data-d="§${attrEscape(backSec)}" onclick="renderRemainsHelpPop(this.dataset.d)">‹ 「${backSec}」の種類に戻る</button>`
                : '';
            body.innerHTML = back + remainsHelpCardHtml(hit.card, hit.sec, false);
        } else {
            const s = hit.sec;
            body.innerHTML = `<div style="--g:${s.color}"><div class="rh-sec-h">${s.name}</div><p class="rh-lead">${s.lead}</p>`
                + s.subs.map(sub => `<div class="rh-subh">${sub.name}</div><div class="rh-kinds">`
                    + sub.cards.map(c => `<button class="rh-kind" data-t="${attrEscape(c.t)}" data-s="${attrEscape(s.name)}"`
                        + ` onclick="renderRemainsHelpPop(this.dataset.t, this.dataset.s)">${c.t}</button>`).join('')
                    + '</div>').join('') + '</div>';
        }
        body.scrollTop = 0;
    }
    function closeRemainsHelpPop() {
        const pop = document.getElementById('rh-pop');
        if (!pop) return;
        pop.classList.remove('open');
        // 下スワイプで引いた位置を残さない（次に開いたとき CSS の位置 bottom:0 に出す）
        pop.style.bottom = '';
        pop.style.transition = '';
        document.getElementById('rh-pop-dim').classList.remove('open');
    }

    function selectNearbyCat(el) {
        nearbyState.cats = [el.dataset.cat];
        execNearbySearch();
    }
    function nearbyGmapUrl(cats) {
        const center = getSearchCenter();
        const keyword = cats.map(c => gmapKeywords[c]).filter(Boolean).join(' OR ');
        const zoom = Math.round(map.getZoom());
        return `https://www.google.com/maps/search/${encodeURIComponent(keyword)}/@${center.lat},${center.lng},${zoom}z`;
    }
    /* iPhone・iPad では、Googleマップへ飛ぶカテゴリを window.open で開くと、Safari に新しいタブが
       できてから中身だけが Googleマップのアプリへ渡り、アプリから戻ると空のタブが表示される
       （2026-10-03 に実機で確認）。ポップアップの「GoogleMap」ボタン（<a target="_blank">）では
       起きないため、iOS だけはカテゴリの上に同じ種類のリンクを重ね、指で押したリンクとして開く。
       URL は地図の中心とズームで変わるので、押した瞬間に href を差し替える（リンクの遷移は
       click の処理が終わってから href を読むので、差し替えた先へ飛ぶ）。
       Android は window.open のままで問題が無いため、iOS 以外には何も足さない。 */
    (function setupIosNearbyGmapLinks() {
        const isIos = /iP(hone|od|ad)/.test(navigator.userAgent)
            || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);   // iPadOS は Mac の UA を名乗る
        if (!isIos) return;
        document.querySelectorAll('.nearby-cat-item').forEach(item => {
            const cat = item.dataset.cat;
            if (!gmapKeywords[cat]) return;   // スポット・ホテルは Googleマップへ飛ばないので今のまま
            const a = document.createElement('a');
            a.href = 'https://www.google.com/maps';
            a.target = '_blank';
            a.setAttribute('aria-label', item.textContent.trim());
            a.style.cssText = 'position:absolute; inset:0;';
            a.addEventListener('click', () => {
                nearbyState.cats = [cat];
                a.href = nearbyGmapUrl(nearbyState.cats);
            });
            // window.open を走らせない。リンクが覆えない透明の枠線（2px）を押したときも同じ
            item.removeAttribute('onclick');
            item.style.position = 'relative';
            item.appendChild(a);
        });
    })();
    /* Overpass 本家は IP ごとに同時2スロットしか無く（/api/status の "Rate limit: 2"）、
       空いていないと HTTP 429、実行が長すぎると HTTP 504 を返す。どちらも本文は
       JSON ではなく XHTML（Error: runtime error: ... rate_limited ／ ... timed out）で、
       2026-09-09 に実際に叩いて両方とも再現した。以前はここで res.ok を見ずに
       res.json() へ渡していたため、この XHTML が SyntaxError になって catch に落ち、
       近くに駅があっても「駅情報の取得に失敗しました」で終わっていた。
       429 のあとに /api/status を見ると枠は戻っているので、間を空けて投げ直す
       （手で2〜3回やり直すと通っていたのはこれ）。remark 付きの応答は今回は
       再現していないが、返り得る形なので同じく失敗として扱う。 */
    const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
    const OVERPASS_TIMEOUT_S = 20;             // クエリに書くサーバー側の実行時間の上限
    /* こちらから切る上限。timeout は実行時間だけの制限で、混んでいるときの順番待ちは
       含まれない（2026-09-09 に timeout:10 のクエリが 16.7 秒かかって 453 件返っている）。
       待ち時間も込みでこれだけ待って駄目なら切る、という値なので長めに取る。 */
    const OVERPASS_ABORT_MS = 45000;
    const OVERPASS_WAIT_MS = [1200, 3000];     // 失敗のたびに待つ時間。要素数＋1回まで投げる
    const OVERPASS_TRIES = OVERPASS_WAIT_MS.length + 1;

    async function overpassQuery(query, onRetry) {
        let lastErr = null;
        for (let i = 0; i < OVERPASS_TRIES; i++) {
            if (i > 0) {
                if (onRetry) onRetry(i + 1);
                await new Promise(r => setTimeout(r, OVERPASS_WAIT_MS[i - 1]));
            }
            const ctl = new AbortController();
            const timer = setTimeout(() => ctl.abort(), OVERPASS_ABORT_MS);
            try {
                const res = await fetch(OVERPASS_URL, { method: 'POST', body: query, signal: ctl.signal });
                if (!res.ok) { lastErr = new Error(`HTTP ${res.status}`); continue; }
                const data = await res.json();
                if (data.remark) { lastErr = new Error(data.remark); continue; }
                return data;
            } catch (e) {
                lastErr = e;
            } finally {
                clearTimeout(timer);
            }
        }
        throw lastErr || new Error('unknown');
    }

    /* alert に出す短い理由。次に失敗したときどこで転んだのかが分かる程度に留める。 */
    function overpassFailText(e) {
        const m = (e && e.message) || '';
        if (e && e.name === 'AbortError') return `${OVERPASS_ABORT_MS / 1000}秒待っても応答なし`;
        if (m === 'HTTP 429' || /rate_limited/.test(m)) return '同時利用の上限';
        if (m === 'HTTP 504' || /timed out/.test(m)) return '提供元が時間切れ';
        if (/^HTTP /.test(m)) return m;
        return '通信エラー';
    }

