/* 時間軸系：年表ガント / 氏族スイムレーン / 主従マトリクス */

const Y0 = 1440, Y1 = 1660;
const TW = 1080;
const xOf = y => (y - Y0) / (Y1 - Y0) * TW;
function yearAxis(w, h, top){
  let s = '<g class="axis">';
  for (let y = 1450; y <= 1650; y += 25){
    const x = xOf(y);
    s += '<line class="gridline" x1="' + x + '" y1="' + top + '" x2="' + x + '" y2="' + h + '"/>' +
         '<text x="' + x + '" y="' + (top - 6) + '" text-anchor="middle">' + y + '</text>';
  }
  return s + '</g>';
}
function rules(h, top){
  let s = '';
  DATA.lordSpans.forEach(l => {
    if (l.ruleFrom) {
      const x = xOf(l.ruleFrom);
      s += '<line class="rule" x1="' + x + '" y1="' + top + '" x2="' + x + '" y2="' + h + '"/>' +
        '<text class="rule-label" x="' + (x + 4) + '" y="' + (top + 11) + '">' + l.ruleFrom + ' ' + esc(l.title.replace('武田', '')) + '家督</text>';
    }
  });
  const x = xOf(1582);
  s += '<line class="rule" x1="' + x + '" y1="' + top + '" x2="' + x + '" y2="' + h + '" stroke="#8c3b3b"/>' +
    '<text class="rule-label" x="' + (x + 4) + '" y="' + (top + 24) + '" fill="#8c3b3b">1582 武田氏滅亡</text>';
  return s;
}

/* ========== 4. 年表（生没年ガント） ========== */
view({
  id: 'timeline', title: '年表（生没年ガント・主君で色分け）',
  desc: 'いちばん情報量が落ちない形です。横帯が一人の生涯、色は武田滅亡後に仕えた家。1541年・1573年の家督交代と1582年の滅亡を縦線で入れてあります。ただし infobox に生年が無い人が多く、両方そろうのは全体の一部だけです。',
  tags: ['<span class="tag good">年代を主軸にできる</span>', '<span class="tag good">世代交代と移籍が見える</span>', '<span class="tag bad">生没年の欠損が多い</span>'],
  render(el){
    const list = P.filter(p => p.b && p.d).sort((a, b) => a.b - b.b);
    const rowH = 13, top = 74, L = 120, H = top + list.length * rowH + 30, W = L + TW + 210;
    const draw = (year) => {
      let s = svgOpen(W, H);
      s += '<g transform="translate(' + L + ',0)">' + yearAxis(TW, H - 10, top) + rules(H - 10, top);
      // 武田三代の在位帯
      DATA.lordSpans.forEach((l, i) => {
        const a = l.ruleFrom || 1507, b = l.ruleTo;
        s += '<rect x="' + xOf(a) + '" y="' + (28 + i * 0) + '" width="' + (xOf(b) - xOf(a)) + '" height="16" ' +
          'fill="' + GEN_COLOR[l.title] + '" fill-opacity=".22" stroke="' + GEN_COLOR[l.title] + '" stroke-opacity=".5"/>' +
          '<text x="' + (xOf(a) + 6) + '" y="' + 40 + '" font-size="10.5" fill="' + GEN_COLOR[l.title] + '">' + esc(l.title) +
          (l.ruleFrom ? '' : '（開始年未確認）') + '</text>';
      });
      list.forEach((p, i) => {
        const y = top + 8 + i * rowH, x = xOf(p.b), w = Math.max(2, xOf(p.d) - xOf(p.b));
        const on = !year || aliveAt(p, year);
        s += '<g ' + pAttr(p) + ' style="cursor:pointer;opacity:' + (on ? 1 : .18) + '">' +
          '<rect x="' + x + '" y="' + (y - 4.5) + '" width="' + w + '" height="9" rx="2" fill="' + color(mainFam(p)) + '" fill-opacity=".82"/>' +
          '<text class="node-label" x="' + (x + w + 6) + '" y="' + (y + 3.5) + '" font-size="10">' + esc(p.n) + '</text>' +
          '<text x="' + (-L + 4) + '" y="' + (y + 3.5) + '" font-size="9.5" fill="#8a8378">' + esc((p.clan || '').slice(0, 7)) + '</text>' +
          '</g>';
      });
      if (year){
        const x = xOf(year);
        s += '<line x1="' + x + '" y1="' + (top - 16) + '" x2="' + x + '" y2="' + (H - 10) + '" stroke="#7a2e2e" stroke-width="1.5"/>' +
          '<rect x="' + (x - 24) + '" y="' + (top - 32) + '" width="48" height="16" rx="3" fill="#7a2e2e"/>' +
          '<text x="' + x + '" y="' + (top - 20) + '" text-anchor="middle" font-size="11" fill="#fff">' + year + '</text>';
      }
      s += '</g></svg>';
      el.querySelector('.body').innerHTML = s;
    };
    el.innerHTML = '<div class="panel"><div class="bar">' +
      '<label><input type="checkbox" id="tl-on"> 特定の年で絞る</label>' +
      '<input id="tl-y" type="range" min="1500" max="1620" value="1570" disabled>' +
      '<span id="tl-lb">全期間（生没年がそろう ' + list.length + ' 名 / 全 ' + P.length + ' 名）</span></div>' +
      '<div class="body"></div>' + legend(famRanking().slice(0, 7).map(f => f.key)) +
      '<div class="hint">帯の色＝武田家を離れたあとに仕えた家（離れていない人は武田の色）。生没年のどちらかが欠けている ' + (P.length - list.length) + ' 名はこの表現に載せられません。</div></div>';
    const cb = el.querySelector('#tl-on'), rg = el.querySelector('#tl-y'), lb = el.querySelector('#tl-lb');
    const upd = () => {
      rg.disabled = !cb.checked;
      const y = cb.checked ? +rg.value : 0;
      lb.textContent = y ? (y + '年に生存：' + list.filter(p => aliveAt(p, y)).length + ' 名') :
        ('全期間（生没年がそろう ' + list.length + ' 名 / 全 ' + P.length + ' 名）');
      draw(y);
    };
    cb.onchange = upd; rg.oninput = upd;
    draw(0);
  }
});

/* ========== 5. 氏族スイムレーン ========== */
view({
  id: 'lanes', title: '氏族スイムレーン（横帯 × 年代）',
  desc: '氏族ごとに一本の帯を割り当て、その中に所属人物の生涯を並べたもの。どの家がいつ興り、いつ記録が途切れるかという「家の寿命」が見えます。人物単位ではなく家単位で見たいときの形です。',
  tags: ['<span class="tag good">家の盛衰が見える</span>', '<span class="tag good">密度で規模が分かる</span>', '<span class="tag bad">個人の識別は弱い</span>'],
  render(el){
    const groups = clanGroups().filter(g => g.people.some(p => p.b && p.d));
    const draw = (topN) => {
      const gs = groups.slice(0, topN);
      const laneH = 34, top = 46, L = 108, H = top + gs.length * laneH + 24, W = L + TW + 30;
      let s = svgOpen(W, H) + '<g transform="translate(' + L + ',0)">' + yearAxis(TW, H - 8, top) + rules(H - 8, top);
      gs.forEach((g, i) => {
        const y = top + i * laneH + laneH / 2;
        s += '<rect x="0" y="' + (y - laneH / 2 + 3) + '" width="' + TW + '" height="' + (laneH - 6) + '" fill="' + (i % 2 ? '#faf7ee' : '#f4efe2') + '"/>';
        s += '<text x="-8" y="' + (y + 4) + '" text-anchor="end" font-size="11.5" fill="#2b2622">' + esc(g.clan) + '</text>';
        s += '<text x="-8" y="' + (y + 15) + '" text-anchor="end" font-size="9.5" fill="#8a8378">' + g.people.length + '名</text>';
        const rows = [];
        g.people.filter(p => p.b && p.d).forEach(p => {
          let r = 0;
          while (rows[r] != null && rows[r] > xOf(p.b) - 4) r++;
          rows[r] = xOf(p.d) + 40;
          const yy = y - 8 + (r % 3) * 8;
          s += '<g ' + pAttr(p) + ' style="cursor:pointer">' +
            '<rect x="' + xOf(p.b) + '" y="' + yy + '" width="' + Math.max(2, xOf(p.d) - xOf(p.b)) + '" height="6" rx="2" fill="' + color(mainFam(p)) + '" fill-opacity=".8"/>' +
            '<text class="node-label" x="' + (xOf(p.d) + 4) + '" y="' + (yy + 6) + '" font-size="8.5">' + esc(p.n) + '</text></g>';
        });
      });
      s += '</g></svg>';
      el.querySelector('.body').innerHTML = s;
    };
    el.innerHTML = '<div class="panel"><div class="bar">' +
      '<label>表示する氏族数<input id="ln-r" type="range" min="5" max="' + Math.min(45, groups.length) + '" value="18"></label>' +
      '<span>帯の中は重ならないよう3段に折り返しています</span></div><div class="body"></div>' +
      legend(famRanking().slice(0, 6).map(f => f.key)) + '</div>';
    const r = el.querySelector('#ln-r'); r.oninput = () => draw(+r.value);
    draw(18);
  }
});

/* ========== 6. 主従マトリクス ========== */
view({
  id: 'matrix', title: '主従マトリクス（人物 × 主君）',
  desc: '「誰が誰に仕えたか」を格子で全部見せる形。ツリーが表せない複数主君・移籍を、欠落なく表現できるのが強みです。行を並べ替えると、武田三代だけに仕えた層と、他家を渡り歩いた層がはっきり分かれます。',
  tags: ['<span class="tag good">複数主君を落とさない</span>', '<span class="tag good">移籍の型が見える</span>', '<span class="tag bad">絵として地味</span>'],
  render(el){
    const cnt = {};
    P.forEach(p => p.lords.forEach(l => cnt[l.t] = (cnt[l.t] || 0) + 1));
    const cols = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a]).slice(0, 22);
    const colIx = {}; cols.forEach((c, i) => colIx[c] = i);
    const draw = (mode) => {
      let list = P.slice();
      if (mode === 'count') list.sort((a, b) => b.lords.length - a.lords.length || (a.b || 9999) - (b.b || 9999));
      else if (mode === 'birth') list.sort((a, b) => (a.b || 9999) - (b.b || 9999));
      else list.sort((a, b) => {
        const k = p => cols.map(c => p.lords.some(l => l.t === c) ? '1' : '0').join('');
        return k(b).localeCompare(k(a));
      });
      const cw = 26, rh = 12, L = 132, top = 128;
      const H = top + list.length * rh + 20, W = L + cols.length * cw + 260;
      let s = svgOpen(W, H);
      cols.forEach((c, i) => {
        const x = L + i * cw + cw / 2;
        s += '<text transform="translate(' + x + ',' + (top - 8) + ') rotate(-58)" font-size="10.5" fill="#2b2622">' + esc(c) + ' <tspan fill="#8a8378">' + cnt[c] + '</tspan></text>';
        s += '<rect x="' + (L + i * cw) + '" y="' + top + '" width="' + cw + '" height="' + (list.length * rh) + '" fill="' + (i % 2 ? '#faf7ee' : '#fffdf8') + '"/>';
      });
      list.forEach((p, r) => {
        const y = top + r * rh;
        s += '<g ' + pAttr(p) + ' style="cursor:pointer">' +
          '<rect x="0" y="' + y + '" width="' + W + '" height="' + rh + '" fill="transparent"/>' +
          '<text class="node-label" x="' + (L - 6) + '" y="' + (y + 9) + '" text-anchor="end" font-size="9.5">' + esc(p.n) + '</text>';
        p.lords.forEach((l, li) => {
          if (colIx[l.t] == null) return;
          const x = L + colIx[l.t] * cw;
          s += '<rect x="' + (x + 3) + '" y="' + (y + 2) + '" width="' + (cw - 6) + '" height="' + (rh - 4) + '" rx="2" fill="' + color(l.f) + '" fill-opacity=".85"/>' +
            '<text x="' + (x + cw / 2) + '" y="' + (y + 9) + '" text-anchor="middle" font-size="7.5" fill="#fff">' + (li + 1) + '</text>';
        });
        const rest = p.lords.filter(l => colIx[l.t] == null).map(l => l.l).join('、');
        if (rest) s += '<text x="' + (L + cols.length * cw + 8) + '" y="' + (y + 9) + '" font-size="9" fill="#8a8378">他：' + esc(rest.slice(0, 40)) + '</text>';
        s += '</g>';
      });
      s += '</svg>';
      el.querySelector('.body').innerHTML = s;
    };
    el.innerHTML = '<div class="panel"><div class="bar"><label>行の並び' +
      '<select id="mx-s"><option value="pattern">仕えた組み合わせ順</option><option value="count">主君の数が多い順</option><option value="birth">生年順</option></select></label>' +
      '<span>セル内の数字は「何人目の主君か」（infobox の記載順）</span></div><div class="body"></div>' +
      '<div class="hint">列は登場回数の多い主君 22 名。それ以外の主君は各行の右端にテキストで出しています。</div></div>';
    el.querySelector('#mx-s').onchange = e => draw(e.target.value);
    draw('pattern');
  }
});
