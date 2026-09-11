/* ツリー系：階層ツリー / 放射ツリー / サンバースト */

/* ========== 1. 階層ツリー（縦） ========== */
view({
  id: 'tree', title: '階層ツリー（大名 → 氏族 → 人物）',
  desc: '一番素直な形。ただし Wikipedia には寄親寄子（誰が誰の配下か）のデータが無いため、中間層は氏族で代用しています。「信玄の下に山県、その下に足軽大将」という本来見たい階層は、人手で入れない限り作れません。',
  tags: ['<span class="tag good">直感的</span>', '<span class="tag good">全員を列挙できる</span>', '<span class="tag bad">中間階層が作れない</span>', '<span class="tag bad">複数主君・移籍を表せない</span>'],
  render(el){
    const groups = clanGroups();
    const open = new Set(groups.slice(0, 8).map(g => g.clan));
    const draw = () => {
      const rowH = 17, x0 = 34, x1 = 150, x2 = 300;
      let y = 30, rows = [], links = [];
      groups.forEach(g => {
        const isOpen = open.has(g.clan);
        const yTop = y;
        rows.push({ type: 'clan', clan: g.clan, n: g.people.length, y, open: isOpen });
        y += rowH + 4;
        if (isOpen) {
          g.people.forEach(p => { rows.push({ type: 'p', p, y }); links.push([yTop, y]); y += rowH; });
          y += 6;
        }
      });
      const H = y + 20, W = 1180;
      let s = svgOpen(W, H);
      // 根
      s += '<line class="link" x1="' + x0 + '" y1="30" x2="' + x0 + '" y2="' + (H - 30) + '" stroke-width="1.5"/>';
      s += crestSvg('takeda', x0 - 15, 4, 30);
      rows.forEach(r => {
        if (r.type === 'clan') {
          s += '<path class="link" d="M' + x0 + ' ' + r.y + ' C' + (x0 + 40) + ' ' + r.y + ',' + (x1 - 40) + ' ' + r.y + ',' + x1 + ' ' + r.y + '"/>';
          s += '<g class="clanrow" data-clan="' + esc(r.clan) + '" style="cursor:pointer">' +
            '<rect x="' + (x1 - 6) + '" y="' + (r.y - 11) + '" width="230" height="19" fill="#f2ece0" rx="4"/>' +
            '<text x="' + x1 + '" y="' + (r.y + 3) + '" font-size="12" fill="#2b2622">' +
            (r.open ? '▾ ' : '▸ ') + esc(r.clan) + ' <tspan fill="#6b6055" font-size="10.5">' + r.n + '名</tspan></text></g>';
        } else {
          const p = r.p, f = mainFam(p);
          s += '<path class="link" d="M' + x1 + ' ' + r.y + ' C' + (x1 + 50) + ' ' + r.y + ',' + (x2 - 50) + ' ' + r.y + ',' + x2 + ' ' + r.y + '" stroke="#e0d7c2"/>';
          s += '<g ' + pAttr(p) + ' style="cursor:pointer">' +
            '<circle cx="' + x2 + '" cy="' + r.y + '" r="3.5" fill="' + color(f) + '"/>' +
            '<text class="node-label" x="' + (x2 + 10) + '" y="' + (r.y + 4) + '">' + esc(p.n) + '</text>' +
            '<text x="' + (x2 + 130) + '" y="' + (r.y + 4) + '" font-size="10.5" fill="#6b6055">' +
            (p.b || '?') + '–' + (p.d || '?') + '</text>' +
            '<text x="' + (x2 + 220) + '" y="' + (r.y + 4) + '" font-size="10.5" fill="#8a8378">' +
            esc(p.lords.map(l => l.l).join('→').slice(0, 46)) + '</text></g>';
        }
      });
      s += '</svg>';
      el.querySelector('.body').innerHTML = s;
    };
    el.innerHTML = '<div class="panel"><div class="bar">' +
      '<button id="tr-all" style="font-family:inherit;font-size:12px;padding:3px 10px;border:1px solid var(--line2);border-radius:5px;background:#fff;cursor:pointer">すべて展開</button>' +
      '<button id="tr-none" style="font-family:inherit;font-size:12px;padding:3px 10px;border:1px solid var(--line2);border-radius:5px;background:#fff;cursor:pointer">すべて畳む</button>' +
      '<span>氏族名をクリックで開閉。人名クリックで Wikipedia。</span></div>' +
      '<div class="body"></div>' + legend(famRanking().slice(0, 6).map(f => f.key)) + '</div>';
    draw();
    el.addEventListener('click', e => {
      const c = e.target.closest('.clanrow');
      if (c) { const k = c.dataset.clan; open.has(k) ? open.delete(k) : open.add(k); draw(); }
    });
    el.querySelector('#tr-all').onclick = () => { groups.forEach(g => open.add(g.clan)); draw(); };
    el.querySelector('#tr-none').onclick = () => { open.clear(); draw(); };
  }
});

/* ========== 2. 放射ツリー ========== */
view({
  id: 'radial', title: '放射ツリー（円形デンドログラム）',
  desc: '同じ階層構造を円に巻いたもの。縦に間延びしないので全体を一画面に収めやすく、氏族の規模差が扇の幅で分かります。人数が多いと外周のラベルが詰まるので、表示する氏族数を絞る前提の表現です。',
  tags: ['<span class="tag good">一画面に収まる</span>', '<span class="tag good">規模比較しやすい</span>', '<span class="tag bad">ラベルが詰まる</span>'],
  render(el){
    const groups = clanGroups();
    const draw = (topN) => {
      const gs = groups.slice(0, topN);
      const total = gs.reduce((a, g) => a + g.people.length, 0);
      const S = 940, cx = S / 2, cy = S / 2, R1 = 150, R2 = 300;
      let a = -Math.PI / 2, s = svgOpen(S, S);
      const pad = 0.004;
      gs.forEach((g, gi) => {
        const span = (Math.PI * 2) * (g.people.length / total);
        const aMid = a + span / 2;
        const gx = cx + Math.cos(aMid) * R1, gy = cy + Math.sin(aMid) * R1;
        s += '<path class="link" d="M' + cx + ' ' + cy + ' Q' + (cx + Math.cos(aMid) * R1 * .5) + ' ' + (cy + Math.sin(aMid) * R1 * .5) + ',' + gx + ' ' + gy + '" stroke-width="1.2"/>';
        let pa = a + pad;
        const pStep = (span - pad * 2) / Math.max(1, g.people.length);
        g.people.forEach((p, i) => {
          const ang = pa + pStep * (i + .5);
          const px = cx + Math.cos(ang) * R2, py = cy + Math.sin(ang) * R2;
          s += '<path class="link" d="M' + gx + ' ' + gy + ' Q' + (cx + Math.cos(ang) * (R1 + 40)) + ' ' + (cy + Math.sin(ang) * (R1 + 40)) + ',' + px + ' ' + py + '" stroke="#e0d7c2"/>';
          const deg = ang * 180 / Math.PI, flip = (deg > 90 || deg < -90);
          s += '<g ' + pAttr(p) + ' style="cursor:pointer">' +
            '<circle cx="' + px + '" cy="' + py + '" r="3" fill="' + color(mainFam(p)) + '"/>' +
            '<text class="node-label" font-size="9.5" transform="translate(' + px + ',' + py + ') rotate(' + (flip ? deg + 180 : deg) + ')" ' +
            'x="' + (flip ? -8 : 8) + '" y="3" text-anchor="' + (flip ? 'end' : 'start') + '">' + esc(p.n) + '</text></g>';
        });
        const dMid = aMid * 180 / Math.PI, fl = (dMid > 90 || dMid < -90);
        s += '<circle cx="' + gx + '" cy="' + gy + '" r="4.5" fill="#6b6055"/>' +
          '<text font-size="11.5" fill="#2b2622" transform="translate(' + gx + ',' + gy + ') rotate(' + (fl ? dMid + 180 : dMid) + ')" ' +
          'x="' + (fl ? -9 : 9) + '" y="4" text-anchor="' + (fl ? 'end' : 'start') + '">' + esc(g.clan) + '</text>';
        a += span;
      });
      s += crestSvg('takeda', cx - 34, cy - 34, 68);
      s += '</svg>';
      el.querySelector('.body').innerHTML = s;
      el.querySelector('#rd-n').textContent = topN + '氏族 / ' + total + '名';
    };
    el.innerHTML = '<div class="panel"><div class="bar">' +
      '<label>表示する氏族数（人数の多い順）<input id="rd-r" type="range" min="4" max="' + Math.min(40, groups.length) + '" value="14"></label>' +
      '<span id="rd-n"></span></div><div class="body" style="text-align:center"></div></div>';
    const r = el.querySelector('#rd-r');
    r.oninput = () => draw(+r.value);
    draw(14);
  }
});

/* ========== 3. サンバースト ========== */
view({
  id: 'sunburst', title: 'サンバースト（代 → 氏族 → 人物）',
  desc: '中心が武田家、内側の環が「最後に仕えた当主の代」、外側が氏族、いちばん外が個人。角度が人数に比例するので、勝頼期に家臣団が誰に引き継がれたかの構成比が一目で出ます。個人名は入りきらないのでホバー前提です。',
  tags: ['<span class="tag good">構成比が見える</span>', '<span class="tag good">世代の断層が見える</span>', '<span class="tag bad">個人名が読めない</span>'],
  render(el){
    const gens = DATA.takeda3.slice();
    const byGen = {}; gens.forEach(g => byGen[g] = []);
    P.forEach(p => { const g = lastGen(p); if (g) byGen[g].push(p); });
    const S = 900, cx = S / 2, cy = S / 2;
    const R = [70, 150, 250, 330];
    const arc = (r0, r1, a0, a1) => {
      const p = (r, a) => [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
      const big = (a1 - a0) > Math.PI ? 1 : 0;
      const [x0, y0] = p(r0, a0), [x1, y1] = p(r1, a0), [x2, y2] = p(r1, a1), [x3, y3] = p(r0, a1);
      return 'M' + x0 + ' ' + y0 + 'L' + x1 + ' ' + y1 + 'A' + r1 + ' ' + r1 + ' 0 ' + big + ' 1 ' + x2 + ' ' + y2 +
        'L' + x3 + ' ' + y3 + 'A' + r0 + ' ' + r0 + ' 0 ' + big + ' 0 ' + x0 + ' ' + y0 + 'Z';
    };
    const total = P.length;
    let a = -Math.PI / 2, s = svgOpen(S, S);
    gens.forEach(g => {
      const list = byGen[g]; if (!list.length) return;
      const span = Math.PI * 2 * list.length / total, a0 = a, a1 = a + span;
      s += '<path d="' + arc(R[0], R[1], a0, a1) + '" fill="' + GEN_COLOR[g] + '" fill-opacity=".85" stroke="#fffdf8" stroke-width="1.5"/>';
      const am = (a0 + a1) / 2;
      s += '<text x="' + (cx + Math.cos(am) * 110) + '" y="' + (cy + Math.sin(am) * 110 + 4) + '" text-anchor="middle" font-size="12" fill="#fff">' +
        esc(GEN[g]) + ' ' + list.length + '</text>';
      // 氏族
      const cg = {}; list.forEach(p => { const k = p.clan || '記載なし'; (cg[k] = cg[k] || []).push(p); });
      const keys = Object.keys(cg).sort((x, y) => cg[y].length - cg[x].length);
      let ca = a0;
      keys.forEach((k, i) => {
        const cs = span * cg[k].length / list.length;
        s += '<path d="' + arc(R[1], R[2], ca, ca + cs) + '" fill="' + GEN_COLOR[g] + '" fill-opacity="' + (0.5 - (i % 5) * 0.06) + '" stroke="#fffdf8" stroke-width=".8"/>';
        if (cs > 0.09) {
          const m = ca + cs / 2, deg = m * 180 / Math.PI, fl = (deg > 90 || deg < -90);
          s += '<text font-size="10" fill="#2b2622" transform="translate(' + (cx + Math.cos(m) * 200) + ',' + (cy + Math.sin(m) * 200) + ') rotate(' + (fl ? deg + 180 : deg) + ')" text-anchor="middle" y="3">' + esc(k) + '</text>';
        }
        let pa2 = ca;
        const st = cs / cg[k].length;
        cg[k].forEach(p => {
          s += '<path ' + pAttr(p) + ' style="cursor:pointer" d="' + arc(R[2], R[3], pa2, pa2 + st) + '" fill="' + color(mainFam(p)) + '" fill-opacity=".8" stroke="#fffdf8" stroke-width=".5"/>';
          pa2 += st;
        });
        ca += cs;
      });
      a = a1;
    });
    s += crestSvg('takeda', cx - 46, cy - 46, 92);
    s += '</svg>';
    el.innerHTML = '<div class="panel"><div class="bar"><span>内側の環＝最後に仕えた当主の代／外側＝氏族／最外周＝個人（色は武田滅亡後に仕えた家）</span></div>' +
      '<div class="body" style="text-align:center">' + s + '</div>' +
      legend(famRanking().slice(0, 7).map(f => f.key)) + '</div>';
  }
});
