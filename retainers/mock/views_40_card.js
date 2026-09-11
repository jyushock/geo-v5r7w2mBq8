/* 家系図 / 家紋カード / 一覧表 */

/* ========== 10. 家系図 ========== */
view({
  id: 'lineage', title: '家系図（父子関係のツリー）',
  desc: 'これは本物のツリーになる唯一の関係です。infobox の「父母」「子」から親子リンクだけを取り出して森を作りました。主従のツリーは作れませんが、血統のツリーは作れます。武田家中を「家の集まり」として見る視点です。',
  tags: ['<span class="tag good">構造が本当に木</span>', '<span class="tag good">家の継承が見える</span>', '<span class="tag bad">主従関係は写らない</span>', '<span class="tag bad">記事のある人しか繋がらない</span>'],
  render(el){
    const kids = {}, hasParent = {};
    P.forEach(p => {
      p.father.forEach(f => { (kids[f] = kids[f] || []).push(p.t); hasParent[p.t] = 1; });
      p.children.forEach(c => { (kids[p.t] = kids[p.t] || []).push(c); hasParent[c] = 1; });
    });
    Object.keys(kids).forEach(k => kids[k] = [...new Set(kids[k])]);
    const roots = P.filter(p => !hasParent[p.t] && kids[p.t]);
    const size = t => 1 + (kids[t] || []).reduce((a, c) => a + size(c), 0);
    const trees = roots.map(r => ({ root: r, n: size(r.t) })).filter(t => t.n >= 3).sort((a, b) => b.n - a.n);

    const NW = 92, NH = 58;
    function layout(t, depth, x0, out){
      const cs = (kids[t] || []).filter(c => BY_T[c]);
      let w = 0, cx;
      if (!cs.length){ w = NW; cx = x0 + NW / 2; }
      else {
        let x = x0;
        cs.forEach(c => { const r = layout(c, depth + 1, x, out); x += r.w; w += r.w; });
        cx = (out.find(o => o.t === cs[0]).x + out.find(o => o.t === cs[cs.length - 1]).x) / 2;
      }
      out.push({ t, x: cx, y: 30 + depth * NH, depth });
      return { w: Math.max(w, NW), cx };
    }
    let s = '', offX = 0, offY = 0, rowH = 0, W = 1220;
    trees.slice(0, 26).forEach(tr => {
      const out = [];
      const r = layout(tr.root.t, 0, 0, out);
      const w = Math.max(r.w, NW) + 26;
      const h = (Math.max(...out.map(o => o.depth)) + 1) * NH + 40;
      if (offX + w > W){ offX = 0; offY += rowH + 22; rowH = 0; }
      s += '<g transform="translate(' + offX + ',' + offY + ')">';
      s += '<rect x="0" y="0" width="' + w + '" height="' + h + '" fill="#faf7ee" stroke="#e7dfcc" rx="7"/>';
      const pos = {}; out.forEach(o => pos[o.t] = o);
      out.forEach(o => (kids[o.t] || []).forEach(c => {
        if (!pos[c]) return;
        const a = pos[o.t], b = pos[c];
        s += '<path class="link" d="M' + (a.x + 13) + ' ' + (a.y + 8) + ' C' + (a.x + 13) + ' ' + (a.y + 34) + ',' + (b.x + 13) + ' ' + (b.y - 24) + ',' + (b.x + 13) + ' ' + (b.y - 2) + '"/>';
      }));
      out.forEach(o => {
        const p = BY_T[o.t];
        if (!p){
          s += '<text x="' + (o.x + 13) + '" y="' + (o.y + 4) + '" text-anchor="middle" font-size="10" fill="#b8ad99">' + esc(o.t) + '</text>';
          return;
        }
        s += '<g ' + pAttr(p) + ' style="cursor:pointer">' +
          '<circle cx="' + (o.x + 13) + '" cy="' + (o.y - 8) + '" r="4" fill="' + color(mainFam(p)) + '"/>' +
          '<text class="node-label" x="' + (o.x + 13) + '" y="' + (o.y + 8) + '" text-anchor="middle" font-size="10.5">' + esc(p.n) + '</text>' +
          '<text x="' + (o.x + 13) + '" y="' + (o.y + 20) + '" text-anchor="middle" font-size="8.5" fill="#8a8378">' + (p.b || '?') + '–' + (p.d || '?') + '</text></g>';
      });
      s += '</g>';
      offX += w + 16; rowH = Math.max(rowH, h);
    });
    const H = offY + rowH + 30;
    el.innerHTML = '<div class="panel"><div class="bar"><span>3人以上つながる系統のみ表示（' +
      trees.length + ' 系統中、上位26系統）。データ内に記事のある人物だけを辺で結んでいます。</span></div>' +
      '<div class="body">' + svgOpen(W + 20, H) + s + '</svg></div>' +
      '<div class="hint">親子リンクを持つ人物は ' + P.filter(p => p.father.length || p.children.length).length +
      ' 名。残りは infobox の父母・子欄が空欄か、リンク先の記事が今回の収集対象外です。</div></div>';
  }
});

/* ========== 11. 家紋カード ========== */
view({
  id: 'cards', title: '家紋カード（一覧・検索）',
  desc: '図解をあきらめて検索性に振った形。実際にこの種のアプリを使うとき、いちばん出番が多いのはたぶんこれです。家紋を大きく置けるので一覧としての見栄えもよく、絞り込みと組み合わせれば「勝頼期に徳川へ移った者」のような問いにその場で答えられます。',
  tags: ['<span class="tag good">検索・絞り込みが効く</span>', '<span class="tag good">家紋を大きく出せる</span>', '<span class="tag bad">関係が見えない</span>'],
  render(el){
    const fams = famRanking();
    el.innerHTML = '<div class="panel"><div class="bar">' +
      '<input type="search" id="cd-q" placeholder="名前・氏族・主君で検索" size="24">' +
      '<label>仕えた家<select id="cd-f"><option value="">すべて</option>' +
      fams.map(f => '<option value="' + f.key + '">' + esc(famName(f.key)) + '（' + f.n + '）</option>').join('') + '</select></label>' +
      '<label>代<select id="cd-g"><option value="">すべて</option>' +
      DATA.takeda3.map(g => '<option value="' + esc(g) + '">' + esc(GEN[g]) + '</option>').join('') + '</select></label>' +
      '<span id="cd-n"></span></div><div class="body"><div class="cards" id="cd-l"></div></div></div>';
    const q = el.querySelector('#cd-q'), fs = el.querySelector('#cd-f'), gs = el.querySelector('#cd-g');
    const draw = () => {
      const t = nosp(q.value), f = fs.value, g = gs.value;
      const list = P.filter(p => {
        if (f && !p.fams.includes(f)) return false;
        if (g && !p.gens.includes(g)) return false;
        if (t && !(nosp(p.n).includes(t) || nosp(p.t).includes(t) || (p.clans || []).some(c => nosp(c).includes(t)) ||
                   p.lords.some(l => nosp(l.l).includes(t) || nosp(l.t).includes(t)) || nosp(p.alias).includes(t))) return false;
        return true;
      });
      el.querySelector('#cd-n').textContent = list.length + ' 名';
      el.querySelector('#cd-l').innerHTML = list.map(p => {
        const mf = mainFam(p);
        return '<div class="card">' +
          '<svg class="cr" style="color:' + color(mf) + '"><use href="' + crestId(mf) + '"/></svg>' +
          '<div class="nm"><a href="' + esc(p.u) + '" target="_blank" rel="noopener">' + esc(p.n) + '</a></div>' +
          '<div class="yr">' + (p.b || '?') + '–' + (p.d || '?') + (p.bu || p.du ? ' <span style="opacity:.6">推定含む</span>' : '') + '</div>' +
          '<div class="yr">' + esc((p.clans || []).join('→') || '氏族記載なし') + '</div>' +
          '<div class="ld">' + p.lords.map(l => '<span class="chip" style="color:' + color(l.f) + '">' + esc(l.l) + '</span>').join('') + '</div>' +
          '</div>';
      }).join('');
    };
    q.oninput = draw; fs.onchange = draw; gs.onchange = draw;
    draw();
  }
});

/* ========== 12. 一覧表 ========== */
view({
  id: 'table', title: '一覧表（並べ替え可能）',
  desc: '比較のために置いた基準線です。図より速く、図より正確で、コピーもできます。凝った可視化を作るときは、これに勝てているかを毎回確かめる価値があります。',
  tags: ['<span class="tag good">正確・高速</span>', '<span class="tag good">全項目を出せる</span>', '<span class="tag bad">全体像は掴めない</span>'],
  render(el){
    let sortKey = 'b', asc = true;
    el.innerHTML = '<div class="panel"><div class="bar"><span>見出しクリックで並べ替え。行クリックで Wikipedia。</span></div>' +
      '<div class="body" id="tb-b"></div></div>';
    const cols = [['n', '名前'], ['b', '生年'], ['d', '没年'], ['clan', '氏族'], ['lords', '主君（記載順）'], ['rank', '官位']];
    const draw = () => {
      const list = P.slice().sort((a, b) => {
        const va = sortKey === 'lords' ? a.lords.length : (a[sortKey] == null ? (asc ? 9e9 : -9e9) : a[sortKey]);
        const vb = sortKey === 'lords' ? b.lords.length : (b[sortKey] == null ? (asc ? 9e9 : -9e9) : b[sortKey]);
        const r = typeof va === 'string' ? String(va).localeCompare(String(vb), 'ja') : va - vb;
        return asc ? r : -r;
      });
      el.querySelector('#tb-b').innerHTML =
        '<table style="width:100%;border-collapse:collapse;font-size:12.5px">' +
        '<thead><tr>' + cols.map(c => '<th data-k="' + c[0] + '" style="position:sticky;top:0;background:#f4efe2;text-align:left;padding:6px 9px;border-bottom:1px solid var(--line2);cursor:pointer;white-space:nowrap">' +
          esc(c[1]) + (sortKey === c[0] ? (asc ? ' ▲' : ' ▼') : '') + '</th>').join('') + '</tr></thead><tbody>' +
        list.map(p => '<tr ' + pAttr(p) + ' style="cursor:pointer">' +
          '<td style="padding:4px 9px;border-bottom:1px solid #efe9db"><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:' + color(mainFam(p)) + ';margin-right:6px"></span>' + esc(p.n) + '</td>' +
          '<td style="padding:4px 9px;border-bottom:1px solid #efe9db;font-variant-numeric:tabular-nums">' + (p.b || '') + (p.bu ? '?' : '') + '</td>' +
          '<td style="padding:4px 9px;border-bottom:1px solid #efe9db;font-variant-numeric:tabular-nums">' + (p.d || '') + (p.du ? '?' : '') + '</td>' +
          '<td style="padding:4px 9px;border-bottom:1px solid #efe9db">' + esc((p.clans || []).join('→')) + '</td>' +
          '<td style="padding:4px 9px;border-bottom:1px solid #efe9db">' + p.lords.map(l => '<span style="color:' + color(l.f) + '">' + esc(l.l) + '</span>').join('→') + '</td>' +
          '<td style="padding:4px 9px;border-bottom:1px solid #efe9db;color:#6b6055">' + esc((p.rank || '').slice(0, 22)) + '</td></tr>').join('') +
        '</tbody></table>';
    };
    el.addEventListener('click', e => {
      const th = e.target.closest('th[data-k]');
      if (!th) return;
      const k = th.dataset.k;
      if (k === sortKey) asc = !asc; else { sortKey = k; asc = true; }
      draw();
    });
    draw();
  }
});
