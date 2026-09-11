/* グラフ系：相関ネットワーク / 主君遷移サンキー / 同心円 */

/* ========== 7. 相関ネットワーク ========== */
view({
  id: 'network', title: '相関ネットワーク（主君を核にした引力配置）',
  desc: 'データの素の形に一番近い表現です。主君を核として置き、その主君に仕えた人物をぶら下げます。二人の主君に仕えた者は自然と二つの核の中間に落ちるので、武田と徳川の両方に名を連ねた層が帯状に浮かび上がります。ツリーでは切り捨てるしかない情報が、そのまま位置に出ます。',
  tags: ['<span class="tag good">複数主君が位置に出る</span>', '<span class="tag good">勢力の重なりが見える</span>', '<span class="tag bad">正確な読み取りには不向き</span>'],
  render(el){
    const cnt = {};
    P.forEach(p => p.lords.forEach(l => cnt[l.t] = (cnt[l.t] || 0) + 1));
    const hubs = Object.keys(cnt).filter(k => cnt[k] >= 6).sort((a, b) => cnt[b] - cnt[a]);
    const W = 1180, H = 820, cx = W / 2, cy = H / 2;
    // 核は家ごとにまとめて円周配置
    const byFam = {};
    hubs.forEach(h => { const f = famOfLord(h); (byFam[f] = byFam[f] || []).push(h); });
    const famKeys = Object.keys(byFam).sort((a, b) => byFam[b].length - byFam[a].length);
    const pos = {};
    let ai = 0, tot = hubs.length;
    famKeys.forEach(f => {
      byFam[f].forEach(h => {
        const ang = (ai / tot) * Math.PI * 2 - Math.PI / 2;
        const rad = f === 'takeda' ? 130 : 330;
        pos[h] = { x: cx + Math.cos(ang) * rad, y: cy + Math.sin(ang) * rad * .82, f: f };
        ai++;
      });
    });
    // 武田三代は中央寄りに手で固定
    if (pos['武田信玄']) { pos['武田信玄'].x = cx; pos['武田信玄'].y = cy - 30; }
    if (pos['武田勝頼']) { pos['武田勝頼'].x = cx - 100; pos['武田勝頼'].y = cy + 90; }
    if (pos['武田信虎']) { pos['武田信虎'].x = cx + 100; pos['武田信虎'].y = cy + 90; }

    const nodes = P.map(p => {
      const hs = p.lords.filter(l => pos[l.t]);
      let x = cx, y = cy;
      if (hs.length) {
        x = hs.reduce((a, l) => a + pos[l.t].x, 0) / hs.length;
        y = hs.reduce((a, l) => a + pos[l.t].y, 0) / hs.length;
      }
      const jitter = 60;
      return { p, x: x + (Math.random() - .5) * jitter, y: y + (Math.random() - .5) * jitter, hs };
    });
    // 反発でほぐす
    for (let it = 0; it < 60; it++){
      for (let i = 0; i < nodes.length; i++){
        for (let j = i + 1; j < nodes.length; j++){
          const a = nodes[i], b = nodes[j];
          let dx = b.x - a.x, dy = b.y - a.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 190 && d2 > 0.01){
            const d = Math.sqrt(d2), f = (14 - d) / d * .5;
            dx *= f; dy *= f;
            a.x -= dx; a.y -= dy; b.x += dx; b.y += dy;
          }
        }
      }
      // 核へ引き戻す
      nodes.forEach(n => {
        if (!n.hs.length) return;
        const tx = n.hs.reduce((a, l) => a + pos[l.t].x, 0) / n.hs.length;
        const ty = n.hs.reduce((a, l) => a + pos[l.t].y, 0) / n.hs.length;
        n.x += (tx - n.x) * .06; n.y += (ty - n.y) * .06;
      });
    }
    let s = svgOpen(W, H);
    nodes.forEach(n => n.hs.forEach(l => {
      s += '<line x1="' + n.x.toFixed(1) + '" y1="' + n.y.toFixed(1) + '" x2="' + pos[l.t].x.toFixed(1) + '" y2="' + pos[l.t].y.toFixed(1) +
        '" stroke="' + color(l.f) + '" stroke-opacity=".13" stroke-width="1"/>';
    }));
    nodes.forEach(n => {
      s += '<circle ' + pAttr(n.p) + ' style="cursor:pointer" cx="' + n.x.toFixed(1) + '" cy="' + n.y.toFixed(1) +
        '" r="4" fill="' + color(mainFam(n.p)) + '" fill-opacity=".9" stroke="#fffdf8" stroke-width=".8"/>';
    });
    hubs.forEach(h => {
      const q = pos[h], r = 9 + Math.sqrt(cnt[h]) * 1.9;
      s += crestSvg(q.f, q.x - r - 13, q.y - r - 30, (r + 13) * 2, .95);
      s += '<circle cx="' + q.x + '" cy="' + q.y + '" r="' + r + '" fill="#fffdf8" stroke="' + color(q.f) + '" stroke-width="2.5"/>' +
        '<text x="' + q.x + '" y="' + (q.y + 4) + '" text-anchor="middle" font-size="10.5" fill="' + color(q.f) + '">' + cnt[h] + '</text>' +
        '<text x="' + q.x + '" y="' + (q.y + r + 15) + '" text-anchor="middle" font-size="11.5" fill="#2b2622">' + esc(h) + '</text>';
    });
    s += '</svg>';
    el.innerHTML = '<div class="panel"><div class="bar"><span>核＝6名以上に仕えられた主君（' + hubs.length + '名）。円の数字は家臣の人数。点は個人で、仕えた主君の中間に落ちます。</span></div>' +
      '<div class="body" style="text-align:center">' + s + '</div>' + legend(famRanking().slice(0, 8).map(f => f.key)) + '</div>';
  }
});
function famOfLord(t){
  for (const f of DATA.families) if (t.startsWith(f.name)) return f.key;
  return null;
}

/* ========== 8. 主君遷移サンキー ========== */
view({
  id: 'sankey', title: '主君遷移サンキー（武田の家臣はどこへ流れたか）',
  desc: '左が最後に仕えた武田当主、右が武田を離れたあとに仕えた家。1582年の滅亡で家臣団がどこへ吸収されたかという、家臣団の「出口」を見る表現です。人の流れを主題にすると、ツリーより遥かに語れる図になります。',
  tags: ['<span class="tag good">滅亡後の流出が主題になる</span>', '<span class="tag good">量の比較が正確</span>', '<span class="tag bad">個人が消える</span>'],
  render(el){
    const links = {}, leftN = {}, rightN = {};
    P.forEach(p => {
      const g = lastGen(p); if (!g) return;
      const f = afterFam(p) || '__stay__';
      const k = g + '|' + f;
      links[k] = (links[k] || 0) + 1;
      leftN[g] = (leftN[g] || 0) + 1;
      rightN[f] = (rightN[f] || 0) + 1;
    });
    const lefts = DATA.takeda3.filter(g => leftN[g]);
    const rights = Object.keys(rightN).sort((a, b) => rightN[b] - rightN[a]);
    const W = 1080, H = 640, xL = 210, xR = 780, top = 40, unit = (H - top - 60) / P.length;
    let s = svgOpen(W, H);
    const lY = {}, rY = {};
    let y = top;
    lefts.forEach(g => { lY[g] = { y0: y, cur: y }; y += leftN[g] * unit + 16; });
    y = top;
    rights.forEach(f => { rY[f] = { y0: y, cur: y }; y += rightN[f] * unit + 12; });
    lefts.forEach(g => rights.forEach(f => {
      const n = links[g + '|' + f]; if (!n) return;
      const h = n * unit, a = lY[g], b = rY[f];
      const col = f === '__stay__' ? GEN_COLOR[g] : color(f);
      s += '<path d="M' + xL + ' ' + a.cur + ' C' + (xL + 190) + ' ' + a.cur + ',' + (xR - 190) + ' ' + b.cur + ',' + xR + ' ' + b.cur +
        ' L' + xR + ' ' + (b.cur + h) + ' C' + (xR - 190) + ' ' + (b.cur + h) + ',' + (xL + 190) + ' ' + (a.cur + h) + ',' + xL + ' ' + (a.cur + h) + 'Z" ' +
        'fill="' + col + '" fill-opacity=".3" stroke="' + col + '" stroke-opacity=".25"><title>' + esc(GEN[g]) + ' → ' +
        (f === '__stay__' ? '武田家中のまま' : esc(famName(f))) + '：' + n + '名</title></path>';
      a.cur += h; b.cur += h;
    }));
    lefts.forEach(g => {
      const a = lY[g], h = leftN[g] * unit;
      s += '<rect x="' + (xL - 13) + '" y="' + a.y0 + '" width="13" height="' + h + '" fill="' + GEN_COLOR[g] + '"/>' +
        '<text x="' + (xL - 22) + '" y="' + (a.y0 + h / 2 - 3) + '" text-anchor="end" font-size="13" fill="#2b2622">' + esc(GEN[g]) + '</text>' +
        '<text x="' + (xL - 22) + '" y="' + (a.y0 + h / 2 + 13) + '" text-anchor="end" font-size="11" fill="#6b6055">' + leftN[g] + '名</text>';
      s += crestSvg('takeda', xL - 96, a.y0 + h / 2 - 20, 40, .5);
    });
    rights.forEach(f => {
      const b = rY[f], h = rightN[f] * unit, stay = f === '__stay__';
      s += '<rect x="' + xR + '" y="' + b.y0 + '" width="13" height="' + h + '" fill="' + (stay ? '#8a8378' : color(f)) + '"/>';
      if (!stay) s += crestSvg(f, xR + 20, b.y0 + h / 2 - 13, 26);
      s += '<text x="' + (xR + (stay ? 20 : 52)) + '" y="' + (b.y0 + h / 2 + 4) + '" font-size="12" fill="#2b2622">' +
        (stay ? '武田家中のまま' : esc(famName(f)) + '家') + ' <tspan fill="#8a8378" font-size="10.5">' + rightN[f] + '</tspan></text>';
    });
    s += '</svg>';
    el.innerHTML = '<div class="panel"><div class="bar"><span>左＝infobox の記載順で最後に来る武田当主／右＝そのあとに名前が挙がる家（無い場合は「武田家中のまま」）</span></div>' +
      '<div class="body" style="text-align:center">' + s + '</div>' +
      '<div class="hint">infobox の主君は記載順であり、必ずしも厳密な時系列とは限りません。移籍年もデータに無いため、この図は「順序」に基づく近似です。</div></div>';
  }
});

/* ========== 9. 同心円（仕えた代の数） ========== */
view({
  id: 'orbit', title: '同心円（何代にわたって仕えたか）',
  desc: '中心が武田家。内側の環ほど長く武田に仕えた人で、環は「仕えた当主が三代／二代／一代」を表します。譜代の厚みと、勝頼の代だけに現れる新参の層が、中心からの距離として出ます。家紋を中心に据える構図なので、一枚絵としての見栄えは一番です。',
  tags: ['<span class="tag good">家紋を主役にできる</span>', '<span class="tag good">譜代／新参が分かる</span>', '<span class="tag bad">位置の意味を説明しないと伝わらない</span>'],
  render(el){
    const S = 900, cx = S / 2, cy = S / 2;
    const ring = { 3: 150, 2: 250, 1: 345 };
    const buckets = { 3: [], 2: [], 1: [] };
    P.forEach(p => buckets[Math.min(3, Math.max(1, p.gens.length))].push(p));
    Object.keys(buckets).forEach(k => buckets[k].sort((a, b) =>
      (a.clan || 'んん').localeCompare(b.clan || 'んん', 'ja') || (a.b || 9999) - (b.b || 9999)));
    let s = svgOpen(S, S);
    [1, 2, 3].forEach(k => {
      s += '<circle cx="' + cx + '" cy="' + cy + '" r="' + ring[k] + '" fill="none" stroke="#e0d7c2" stroke-dasharray="3 4"/>';
    });
    [3, 2, 1].forEach(k => {
      const list = buckets[k], R = ring[k];
      list.forEach((p, i) => {
        const ang = (i / list.length) * Math.PI * 2 - Math.PI / 2;
        const x = cx + Math.cos(ang) * R, y = cy + Math.sin(ang) * R;
        s += '<line x1="' + cx + '" y1="' + cy + '" x2="' + x.toFixed(1) + '" y2="' + y.toFixed(1) + '" stroke="' + color(mainFam(p)) + '" stroke-opacity=".1"/>';
        s += '<circle ' + pAttr(p) + ' style="cursor:pointer" cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + (k === 3 ? 5.5 : k === 2 ? 4.5 : 3.5) + '" fill="' + color(mainFam(p)) + '" stroke="#fffdf8"/>';
        if (k === 3){
          const deg = ang * 180 / Math.PI, fl = (deg > 90 || deg < -90);
          s += '<text class="node-label" font-size="9" transform="translate(' + x.toFixed(1) + ',' + y.toFixed(1) + ') rotate(' + (fl ? deg + 180 : deg) + ')" x="' + (fl ? -8 : 8) + '" y="3" text-anchor="' + (fl ? 'end' : 'start') + '" data-id="' + p.id + '" data-url="' + esc(p.u) + '">' + esc(p.n) + '</text>';
        }
      });
      s += '<text x="' + (cx + 6) + '" y="' + (cy - R + 14) + '" font-size="11" fill="#8a8378">' + k + '代に仕えた ' + list.length + '名</text>';
    });
    s += crestSvg('takeda', cx - 52, cy - 52, 104);
    s += '</svg>';
    el.innerHTML = '<div class="panel"><div class="bar"><span>環＝仕えた武田当主の代数（信虎・信玄・勝頼のうち何人）。三代に仕えた層だけ名前を出しています。</span></div>' +
      '<div class="body" style="text-align:center">' + s + '</div>' + legend(famRanking().slice(0, 6).map(f => f.key)) + '</div>';
  }
});
