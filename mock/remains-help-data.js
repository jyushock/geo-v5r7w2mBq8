/* 遺構ヘルプのカードの中身（図・説明・件数）。
   remains-help-preview.html（ヘルプ本体のモック）と remains-help-entry-preview.html（組み込み案のモック）の両方が読む。
   SECTIONS は分野 → 観点 → カードの3階層。fig は SVG（天守の種類だけ表）の文字列。 */
/* ══ 図を組み立てる小物 ══════════════════════════════════════ */
const svg = inner => `<svg viewBox="0 0 320 180">${inner}</svg>`;
const bgSky = '<rect class="sky" width="320" height="180"/>';
const bgPlan = '<rect class="outside" width="320" height="180"/>';
const bgPaper = '<rect width="320" height="180" fill="#FBFAF6"/>';
const t = (x, y, s, c = 'lbl') => `<text class="${c} m" x="${x}" y="${y}">${s}</text>`;
const tl = (x, y, s, c = 'lbl') => `<text class="${c}" x="${x}" y="${y}">${s}</text>`;
const ld = (x1, y1, x2, y2) => `<path class="ld" d="M${x1} ${y1}L${x2} ${y2}"/>`;
const p = (d, c = '', st = '') => `<path class="${c}" d="${d}"${st ? ` style="${st}"` : ''}/>`;
const r = (x, y, w, h, c = '', rx = 0, st = '') =>
    `<rect class="${c}" x="${x}" y="${y}" width="${w}" height="${h}"${rx ? ` rx="${rx}"` : ''}${st ? ` style="${st}"` : ''}/>`;
const cap = s => tl(8, 16, s, 'cap');
const ground = (y = 150) => r(0, y, 320, 180 - y, 'field');
const HILL = 'M8 172 C70 150 112 40 160 38 C208 40 250 150 312 172Z';
const BLOB = 'M20 150 C10 90 60 20 160 18 C265 16 310 80 300 140 C292 172 60 178 20 150Z';
const CONTOUR = 'M48 138 C40 96 78 42 160 40 C246 38 282 86 276 130 C270 156 78 162 48 138Z';

// 白壁の胴（窓つき）
function body(x, y, w, h) {
    let s = r(x, y, w, h, 'plaster');
    if (h >= 14) {
        const n = Math.max(1, Math.round(w / 24));
        for (let k = 0; k < n; k++)
            s += `<rect x="${(x + (k + .5) * w / n - 3).toFixed(1)}" y="${(y + h * .35).toFixed(1)}" width="6" height="5" fill="#607D8B"/>`;
    }
    return s;
}
// 軒に反りのある屋根。yb=軒先、w=軒の幅、h=高さ、top=上端の幅
const roof = (cx, yb, w, h, top) =>
    `<path class="roof" d="M${cx - w / 2} ${yb} Q${cx} ${yb - 6} ${cx + w / 2} ${yb} L${cx + top / 2} ${yb - h} H${cx - top / 2}Z"/>`;
// 重ねた建物。tiers は下から [幅, 高さ]
function tower(cx, baseY, tiers, topH = 18) {
    let bodies = '', roofs = '', y = baseY;
    tiers.forEach(([w, h], i) => {
        const top = y - h, last = i === tiers.length - 1;
        bodies += body(cx - w / 2, top, w, h);
        const rh = last ? topH : 11, topW = last ? Math.max(8, w * .22) : w - 8;
        roofs += roof(cx, top + 5, w + 20, rh, topW);
        y = top + 5 - rh + 3;
    });
    return bodies + roofs;
}
// 石垣の台（台形）
function base(cx, yb, wb, wt, h) {
    let s = `<path class="stone" d="M${cx - wb / 2} ${yb} L${cx - wt / 2} ${yb - h} H${cx + wt / 2} L${cx + wb / 2} ${yb}Z"/>`;
    for (let k = 1; k < 3; k++) {
        const yy = yb - h * k / 3, hw = wb / 2 - (wb - wt) / 2 * k / 3;
        s += `<path d="M${cx - hw + 3} ${yy}H${cx + hw - 3}" stroke="#90A4AE" stroke-width="1"/>`;
    }
    return s;
}

/* 石の積み方の模様（乱数は種固定） */
let CLIP = 0;
function rng(seed) { return () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296; }
const polyS = (pts, fill) =>
    `<polygon points="${pts.map(q => q[0].toFixed(1) + ',' + q[1].toFixed(1)).join(' ')}" fill="${fill}" stroke="#6F7C83" stroke-width=".6"/>`;
function shade(rn) { const s = Math.round(168 + rn() * 34); return `rgb(${s - 6},${s + 2},${s + 8})`; }
function stones(x0, y0, w, h, kind, seed) {
    const rn = rng(seed), id = 'cp' + (++CLIP);
    let out = '';
    if (['nozura', 'uchi', 'kiri', 'nuno'].includes(kind)) {
        let y = y0, row = 0;
        while (y < y0 + h - 0.5) {
            let rh = kind === 'kiri' ? 16 : kind === 'nuno' ? 20 : kind === 'uchi' ? 15 + rn() * 6 : 12 + rn() * 14;
            if (y + rh > y0 + h - 4) rh = y0 + h - y;
            let x = x0 - (kind === 'kiri' ? (row % 2) * 14 : rn() * 12);
            while (x < x0 + w) {
                const sw = kind === 'kiri' ? 28 : kind === 'nuno' ? 26 + rn() * 18 : kind === 'uchi' ? 18 + rn() * 16 : 12 + rn() * 22;
                const xa = x, xb = x + sw, f = shade(rn);
                if (kind === 'nozura') {
                    const cx = (xa + xb) / 2, cy = y + rh / 2, rx = (xb - xa) / 2 - 1.6, ry = rh / 2 - 1.6, pts = [];
                    for (let k = 0; k < 8; k++) {
                        const a = k / 8 * Math.PI * 2 + (rn() - .5) * .5, s = .82 + rn() * .22;
                        pts.push([cx + Math.cos(a) * rx * s * 1.08, cy + Math.sin(a) * ry * s * 1.08]);
                    }
                    out += polyS(pts, f);
                } else {
                    const gap = kind === 'kiri' ? .7 : 1.3, j = (kind === 'kiri' || kind === 'nuno') ? .3 : 1.2;
                    const J = () => (rn() * 2 - 1) * j;
                    out += polyS([[xa + gap + J(), y + gap + J()], [xb - gap + J(), y + gap + J()],
                                  [xb - gap + J(), y + rh - gap + J()], [xa + gap + J(), y + rh - gap + J()]], f);
                }
                x += sw;
            }
            y += rh; row++;
        }
    } else if (kind === 'ran') {
        const u = 9, cols = Math.ceil(w / u) + 1, rows = Math.ceil(h / u) + 1, occ = [];
        for (let i = 0; i < rows; i++) occ.push(new Array(cols).fill(false));
        for (let i = 0; i < rows; i++) for (let jx = 0; jx < cols; jx++) {
            if (occ[i][jx]) continue;
            let sw = 2 + Math.floor(rn() * 4), sh = 1 + Math.floor(rn() * 3), k = 0;
            while (k < sw && jx + k < cols && !occ[i][jx + k]) k++;
            sw = Math.max(1, k); sh = Math.min(sh, rows - i);
            for (let a = 0; a < sh; a++) for (let b = 0; b < sw; b++) occ[i + a][jx + b] = true;
            const xa = x0 + jx * u, ya = y0 + i * u, J = () => (rn() * 2 - 1) * .6;
            out += polyS([[xa + 1.2 + J(), ya + 1.2 + J()], [xa + sw * u - 1.2 + J(), ya + 1.2 + J()],
                          [xa + sw * u - 1.2 + J(), ya + sh * u - 1.2 + J()], [xa + 1.2 + J(), ya + sh * u - 1.2 + J()]], shade(rn));
        }
    } else if (kind === 'tani') {
        const s = 13;
        for (let row = 0; row * s < h + 2 * s; row++) {
            const cy = y0 + row * s, off = (row % 2) * s;
            for (let cx = x0 - s + off; cx < x0 + w + s; cx += 2 * s) {
                const d = s - 1.2;
                out += polyS([[cx, cy - d], [cx + d, cy], [cx, cy + d], [cx - d, cy]], shade(rn));
            }
        }
    } else if (kind === 'kikko') {
        const R = 12, hw = Math.sqrt(3) * R / 2;
        for (let row = 0; row * 1.5 * R < h + 2 * R; row++) {
            const cy = y0 + row * 1.5 * R, off = (row % 2) * hw;
            for (let cx = x0 - hw + off; cx < x0 + w + hw; cx += 2 * hw) {
                const pts = [];
                for (let k = 0; k < 6; k++) { const a = Math.PI / 6 + k * Math.PI / 3; pts.push([cx + Math.cos(a) * (R - 1.3), cy + Math.sin(a) * (R - 1.3)]); }
                out += polyS(pts, shade(rn));
            }
        }
    }
    return `<clipPath id="${id}"><rect x="${x0}" y="${y0}" width="${w}" height="${h}"/></clipPath>`
         + `<rect x="${x0}" y="${y0}" width="${w}" height="${h}" fill="#6F7C83"/><g clip-path="url(#${id})">${out}</g>`;
}
const stoneFig = (kind, seed, c) => svg(bgSky + ground(158) + stones(20, 26, 280, 132, kind, seed) + cap(c));

/* ══ 図 ══════════════════════════════════════════════════════ */
// 同心の曲輪（本丸／二の丸／三の丸）。hl に入れたものを強調
function nestFig(hl, c) {
    const k = n => hl.includes(n) ? 'hl' : 'flat2';
    return svg(bgPlan + r(20, 14, 280, 156, k('san'), 6) + r(46, 34, 228, 116, 'water', 4) + r(58, 44, 204, 96, k('ni'), 4)
        + r(88, 62, 144, 60, 'water', 3) + r(100, 72, 120, 40, k('hon'), 3)
        + t(160, 97, '本丸') + t(160, 57, '二の丸', hl.includes('ni') ? 'lbl' : 'lbl-s') + t(160, 28, '三の丸', hl.includes('san') ? 'lbl' : 'lbl-s')
        + (c ? tl(24, 178, c, 'cap') : ''));
}
function houiFig() {
    return svg(bgPlan + r(116, 62, 88, 56, 'flat', 3) + t(160, 95, '本丸')
        + r(30, 62, 72, 56, 'hl', 3) + t(66, 95, '西の丸') + r(218, 62, 72, 56, 'hl', 3) + t(254, 95, '東の丸')
        + r(116, 8, 88, 44, 'hl', 3) + t(160, 35, '北の丸') + r(116, 128, 88, 44, 'hl', 3) + t(160, 155, '南の丸')
        + `<path d="M298 44 L298 18" stroke="#455A64" stroke-width="1.5" marker-end="url(#arG)"/>` + t(298, 56, '北', 'lbl-s'));
}
function obiFig() {
    return svg(bgPaper + p(BLOB, 'slope') + p(CONTOUR, 'contour') + r(86, 44, 148, 86, 'hl', 38) + r(108, 60, 104, 54, 'flat', 22)
        + t(160, 92, '主な曲輪') + ld(262, 38, 226, 54) + tl(246, 34, '帯曲輪') + cap('上から見た図'));
}
function koshiFig() {
    return svg(bgSky + p('M0 180 V168 L22 160 L72 92 H100 L122 50 H198 L222 94 H252 L306 164 L320 170 V180Z', 'earth')
        + p('M122 50 H198', 'grass') + p('M72 92 H100 M222 94 H252', 'grass-hl')
        + t(160, 42, '主な曲輪') + t(80, 84, '腰曲輪') + t(240, 86, '腰曲輪') + cap('断面図（山城）'));
}
function sakuheiFig() {
    return svg(bgSky + p('M96 76 Q160 44 224 76Z', '', 'fill:url(#hatch)')
        + p('M0 180 V150 L60 100 L96 76 H224 L260 100 L320 150 V180Z', 'earth') + p('M96 76 H224', 'grass-hl')
        + p('M60 100 Q160 20 260 100', 'ghost') + t(160, 104, '削平地', 'lbl-w') + t(160, 44, '削る前の地形', 'lbl-s') + cap('断面図'));
}
function demaruFig() {
    return svg(bgPlan + r(18, 24, 186, 132, 'water', 8) + r(30, 36, 162, 108, 'flat2', 6) + r(62, 60, 98, 60, 'flat', 4)
        + t(111, 95, '本丸') + t(111, 52, '城の本体', 'lbl-s')
        + r(226, 58, 84, 64, 'water', 8) + r(236, 68, 64, 44, 'hl', 4) + t(268, 95, '出丸') + tl(222, 142, '離れて独立', 'lbl-s'));
}
function suteFig() {
    return svg(bgPaper + p(BLOB, 'slope') + r(104, 26, 112, 44, 'flat', 14) + t(160, 53, '主郭')
        + r(122, 98, 76, 30, 'hl', 10) + t(160, 118, '捨曲輪')
        + p('M160 72 L160 95', 'shoot') + p('M160 130 L160 162', 'shoot')
        + p('M96 170 L128 138', 'enemy') + p('M226 170 L194 138', 'enemy')
        + tl(204, 118, '打って出る', 'lbl-s') + cap('上から見た図'));
}
function renkakuFig() {
    return svg(bgPaper + p('M10 118 C10 66 100 58 160 60 C220 58 310 66 310 118 C310 152 10 152 10 118Z', 'slope')
        + r(22, 82, 80, 40, 'flat2', 10) + t(62, 107, '三の丸', 'lbl-s')
        + r(106, 86, 10, 32, 'moat') + r(120, 80, 80, 44, 'flat2', 10) + t(160, 107, '二の丸', 'lbl-s')
        + r(204, 86, 10, 32, 'moat') + r(218, 78, 84, 48, 'hl', 10) + t(260, 107, '本丸')
        + tl(24, 168, '尾根の上に曲輪を一列に連ねる', 'lbl-s') + cap('上から見た図'));
}
function teikakuFig() {
    return svg(bgPlan + r(0, 0, 320, 30, 'water') + t(160, 20, '川・海・山など（背後）', 'lbl-s')
        + r(24, 30, 272, 142, 'flat2') + r(52, 30, 216, 118, 'water') + r(64, 30, 192, 106, 'flat2')
        + r(94, 30, 132, 76, 'water') + r(106, 30, 108, 64, 'hl') + t(160, 68, '本丸')
        + t(160, 124, '二の丸', 'lbl-s') + t(160, 164, '三の丸', 'lbl-s'));
}
function kaikakuFig() {
    return svg(bgSky + p('M0 180 V150 H80 V120 H160 V90 H240 V60 H320 V180Z', 'earth')
        + p('M0 150 H80 M80 120 H160 M160 90 H240', 'grass') + p('M240 60 H320', 'grass-hl')
        + t(40, 142, '三の丸') + t(120, 112, '二の丸') + t(200, 82, '曲輪') + t(280, 52, '本丸') + cap('断面図'));
}
function ritchiFig() {
    const castle = (cx, y) => base(cx, y, 34, 26, 8) + tower(cx, y - 8, [[20, 10], [12, 8]], 10);
    return svg(bgSky + ground(150)
        + p('M4 150 L52 48 L100 150Z', 'slope') + castle(52, 56)
        + p('M112 150 Q160 92 208 150Z', 'slope') + castle(160, 128)
        + castle(265, 150)
        + t(52, 168, '山城') + t(160, 168, '平山城') + t(265, 168, '平城'));
}
function sectionFig(earthD, grassD, label, labelXY, c) {
    return svg(bgSky + p(earthD, 'earth') + p(grassD, 'grass') + t(labelXY[0], labelXY[1], label, 'lbl-s') + cap(c || '断面図'));
}
function karaboriFig() {
    return svg(bgSky + p('M0 70 H120 L140 150 H180 L200 70 H320 V180 H0Z', 'earth') + p('M0 70 H120 M200 70 H320', 'grass')
        + t(60, 60, '曲輪') + t(260, 60, '城外', 'lbl-s') + t(160, 120, '空堀') + cap('断面図'));
}
function mizuboriFig() {
    return svg(bgSky + p('M0 70 H110 L130 150 H190 L210 70 H320 V180 H0Z', 'earth')
        + p('M115.5 92 L130 150 H190 L204.5 92Z', 'water') + p('M0 70 H110 M210 70 H320', 'grass')
        + t(55, 60, '曲輪') + t(265, 60, '城外', 'lbl-s') + t(160, 128, '水堀', 'lbl-w') + cap('断面図'));
}
function horikiriFig() {
    return svg(bgSky + p('M0 150 L60 104 L96 72 H136 L150 128 H170 L184 72 H232 L320 116 V180 H0Z', 'earth')
        + p('M96 72 H136 M184 72 H232', 'grass') + t(116, 62, '曲輪') + t(272, 140, '尾根の続き', 'lbl-w')
        + t(160, 114, '堀切') + p('M304 98 L198 64', 'enemy') + cap('尾根を横から見た図'));
}
function trench(d) { return p(d, 'trench-o') + p(d, 'trench-i'); }
function tateboriFig() {
    return svg(bgSky + p(HILL, 'slope') + '<ellipse class="flat" cx="160" cy="44" rx="30" ry="8"/>'
        + trench('M146 54 C140 90 130 130 118 168') + trench('M174 54 C180 90 190 130 202 168')
        + '<g fill="#E53935"><circle cx="178" cy="82" r="3"/><circle cx="182" cy="100" r="3"/><circle cx="187" cy="119" r="3"/><circle cx="193" cy="138" r="3"/></g>'
        + p('M198 46 L214 96', 'shoot') + p('M40 132 L110 132', 'enemy')
        + t(160, 28, '曲輪') + ld(100, 152, 120, 156) + tl(72, 152, '竪堀')
        + ld(226, 138, 200, 138) + tl(230, 141, '堀に沿って並ぶ敵', 'lbl-s') + cap('斜面を正面から見た図'));
}
function uneFig() {
    let tr = '';
    for (let i = 0; i < 6; i++) tr += trench(`M${124 + i * 14.4} 78 L${72 + i * 35} 166`);
    return svg(bgSky + p(HILL, 'slope') + '<ellipse class="flat" cx="160" cy="44" rx="30" ry="8"/>' + tr
        + p('M18 150 L70 150', 'enemy') + p('M175 160 L168 98', 'enemy') + p('M180 50 L172 86', 'shoot')
        + t(160, 28, '曲輪') + ld(52, 114, 96, 118) + tl(20, 114, '竪堀')
        + ld(246, 126, 219, 140) + tl(248, 126, '畝（土塁）', 'lbl-s') + cap('斜面を正面から見た図'));
}
function hoshaFig() {
    let tr = '';
    for (let k = 0; k < 12; k++) {
        const a = k / 12 * Math.PI * 2 + .13;
        tr += trench(`M${(160 + Math.cos(a) * 84).toFixed(1)} ${(90 + Math.sin(a) * 50).toFixed(1)} L${(160 + Math.cos(a) * 136).toFixed(1)} ${(90 + Math.sin(a) * 76).toFixed(1)}`);
    }
    return svg(bgPaper + '<ellipse class="slope" cx="160" cy="90" rx="150" ry="86"/>' + tr
        + r(84, 48, 152, 84, '', 40, 'fill:none;stroke:#A1887F;stroke-width:12') + r(84, 48, 152, 84, '', 40, 'fill:none;stroke:#6D5246;stroke-width:2.5')
        + r(106, 64, 108, 52, 'flat', 22) + t(160, 95, '曲輪') + ld(272, 16, 226, 50) + tl(276, 16, '横堀', 'lbl-s')
        + ld(60, 164, 74, 152) + tl(8, 176, '放射状の竪堀', 'lbl-s') + cap('上から見た図'));
}
function yokoboriFig() {
    return svg(bgPaper + p(BLOB, 'slope') + p('M40 142 C30 96 70 34 160 32 C252 30 292 84 286 134 C280 164 70 170 40 142Z', 'contour')
        + r(76, 38, 168, 96, '', 44, 'fill:none;stroke:#A1887F;stroke-width:13') + r(76, 38, 168, 96, '', 44, 'fill:none;stroke:#6D5246;stroke-width:2.5')
        + trench('M160 141 L158 170') + r(100, 58, 120, 56, 'flat', 24) + t(160, 90, '曲輪')
        + ld(268, 30, 234, 46) + tl(272, 30, '横堀') + tl(176, 170, '竪堀', 'lbl-s') + cap('上から見た図'));
}
function uchisotoFig() {
    return svg(bgPlan + r(10, 8, 300, 164, '', 6, 'fill:none;stroke:#9ACBEA;stroke-width:12')
        + r(52, 36, 216, 108, '', 5, 'fill:none;stroke:#9ACBEA;stroke-width:10')
        + r(96, 62, 128, 56, '', 4, 'fill:none;stroke:#9ACBEA;stroke-width:9')
        + r(104, 70, 112, 40, 'flat', 3) + t(160, 95, '本丸')
        + t(160, 12, '外堀', 'lbl-s') + t(160, 40, '中堀', 'lbl-s') + t(160, 65, '内堀', 'lbl-s') + tl(18, 178, '平地の城', 'cap'));
}
function sougamaeFig() {
    let town = '';
    for (let i = 0; i < 5; i++) for (let j = 0; j < 4; j++) town += r(172 + i * 24, 48 + j * 24, 18, 18, '', 1, 'fill:#D7CCC8');
    return svg(bgPlan + p('M20 40 Q60 10 160 14 Q270 10 302 50 Q316 110 290 160 Q200 176 110 170 Q30 166 16 120Z', '', 'fill:#F4EEDF;stroke:#9ACBEA;stroke-width:9')
        + p('M31 44 Q66 22 160 25 Q262 22 290 56 Q302 110 280 150 Q200 164 112 159 Q42 156 28 118Z', '', 'fill:none;stroke:#A98B68;stroke-width:3')
        + r(58, 56, 90, 64, 'water', 3) + r(66, 64, 74, 48, 'flat2', 3) + r(84, 74, 38, 28, 'flat', 2) + t(103, 92, '城', 'lbl')
        + town + t(220, 150, '城下町', 'lbl-s') + t(160, 40, '総構（外周の堀・土塁）', 'lbl-s'));
}
function kataFig(earthD, grassD, label) { return sectionFig(earthD, grassD, label, [160, 46]); }
function shojiFig(regular) {
    let ridges = '';
    if (regular) {
        for (let x = 20; x < 320; x += 40) ridges += r(x, 52, 8, 76, '', 0, 'fill:#CDB08A');
    } else {
        ridges += r(0, 86, 320, 8, '', 0, 'fill:#CDB08A');
        [30, 110, 200, 270].forEach(x => { ridges += r(x, 52, 8, 34, '', 0, 'fill:#CDB08A'); });
        [70, 150, 240].forEach(x => { ridges += r(x, 94, 8, 34, '', 0, 'fill:#CDB08A'); });
    }
    return svg(bgPlan + r(0, 0, 320, 52, 'field') + r(0, 52, 320, 76, 'moat') + ridges
        + tl(16, 32, '曲輪') + tl(16, 160, '城外', 'lbl-s')
        + ld(214, 150, 204, 126) + tl(218, 158, regular ? '一定間隔の障子（畝）' : '障子（堀障子）', 'lbl-s') + cap('上から見た図'));
}
function maruUmaFig(focus) {
    return svg(bgPlan + r(0, 0, 320, 50, 'field') + r(0, 50, 150, 10, 'wall') + r(170, 50, 150, 10, 'wall')
        + r(0, 60, 320, 26, 'moat') + r(150, 60, 20, 26, '', 0, 'fill:#CDB08A')
        + `<path d="M84 86 A76 74 0 0 0 236 86" fill="none" stroke="${focus === 'moat' ? '#8A6F55' : '#B39B7C'}" stroke-width="18"/>`
        + p('M104 86 A56 52 0 0 0 216 86Z', 'flat2')
        + '<path d="M109.2 108 A56 52 0 0 0 210.8 108" fill="none" stroke="#A98B68" stroke-width="10"/>'
        + t(160, 30, '曲輪') + t(160, 78, '堀', 'lbl-w') + t(160, 122, '丸馬出', focus === 'uma' ? 'lbl' : 'lbl-s')
        + ld(252, 158, 222, 146) + tl(254, 162, '三日月堀', focus === 'moat' ? 'lbl' : 'lbl-s'));
}
function kakuUmaFig() {
    return svg(bgPlan + r(0, 0, 320, 46, 'field') + r(0, 46, 150, 10, 'wall') + r(170, 46, 150, 10, 'wall')
        + r(0, 56, 320, 30, 'moat') + r(150, 56, 20, 30, '', 0, 'fill:#CDB08A')
        + '<path d="M86 86 V160 H234 V86" fill="none" stroke="#B39B7C" stroke-width="18"/>'
        + r(104, 86, 112, 62, 'flat2') + '<path d="M104 104 V148 H216 V104" fill="none" stroke="#A98B68" stroke-width="10"/>'
        + t(160, 30, '曲輪') + t(160, 76, '堀', 'lbl-w') + t(160, 125, '角馬出'));
}

/* 門 */
function sideWalls() {
    return r(0, 104, 80, 46, 'plaster') + p('M0 104 H82 L76 96 H0Z', 'roof') + r(240, 104, 80, 46, 'plaster') + p('M238 104 H320 V96 H244Z', 'roof');
}
function kabukiFig() {
    return svg(bgSky + ground() + p('M0 128 H116 M204 128 H320', '', 'stroke:#8D6E63;stroke-width:3')
        + r(118, 62, 10, 88, 'wood') + r(192, 62, 10, 88, 'wood') + r(104, 62, 112, 10, 'wood')
        + ld(236, 67, 218, 67) + tl(240, 71, '冠木（横木）') + ld(90, 104, 116, 104) + t(70, 108, '鏡柱') + cap('正面から見た図'));
}
function yakuiFig() {
    return svg(bgSky + ground() + r(134, 70, 12, 80, 'wood') + r(197, 86, 7, 64, 'wood') + r(134, 86, 70, 6, 'wood')
        + p('M96 82 L170 40 L244 82 L236 86 L170 50 L104 86Z', 'roof')
        + t(140, 168, '鏡柱（前）') + t(210, 168, '控柱（後ろ）') + ld(262, 46, 234, 64) + t(270, 40, '大きな屋根') + cap('横から見た図'));
}
function koraiFig() {
    return svg(bgSky + ground() + sideWalls()
        + roof(100, 98, 40, 12, 20) + roof(220, 98, 40, 12, 20)
        + r(122, 72, 10, 78, 'wood') + r(188, 72, 10, 78, 'wood') + r(116, 72, 88, 8, 'wood')
        + r(132, 86, 28, 64, 'door') + r(160, 86, 28, 64, 'door') + roof(160, 76, 104, 16, 70)
        + ld(250, 56, 206, 68) + t(262, 52, '小さな屋根', 'lbl-s') + ld(62, 74, 94, 90) + t(48, 70, '控柱の屋根', 'lbl-s')
        + cap('正面から見た図'));
}
function muneFig() {
    return svg(bgSky + ground() + r(154, 70, 12, 80, 'wood') + p('M104 76 L160 46 L216 76 L208 80 L160 56 L112 80Z', 'roof')
        + r(214, 96, 7, 54, 'ghost') + t(160, 168, '本柱') + t(250, 122, '控柱は無い', 'lbl-s') + cap('横から見た図'));
}
function yaguramonFig() {
    return svg(bgSky + ground() + r(0, 96, 118, 54, 'stone') + r(202, 96, 118, 54, 'stone')
        + r(118, 96, 84, 8, 'wood') + r(126, 104, 34, 46, 'door') + r(160, 104, 34, 46, 'door')
        + body(70, 66, 180, 30) + roof(160, 71, 204, 18, 150)
        + ld(282, 60, 252, 70) + t(292, 56, '櫓') + t(58, 128, '石垣') + ld(240, 126, 196, 126) + tl(244, 130, '門') + cap('正面から見た図'));
}
function nagayaFig() {
    const lattice = x => r(x, 110, 40, 14, '', 0, 'fill:#EDE7DA;stroke:#8D6E63') + p(`M${x + 8} 110V124M${x + 16} 110V124M${x + 24} 110V124M${x + 32} 110V124`, '', 'stroke:#8D6E63');
    return svg(bgSky + ground() + r(16, 92, 288, 58, 'plaster') + roof(160, 97, 304, 22, 250)
        + r(132, 104, 44, 46, 'door') + p('M154 104V150', '', 'stroke:#5D4037') + r(178, 120, 14, 30, 'door')
        + lattice(40) + lattice(240)
        + ld(60, 70, 60, 88) + t(60, 66, '門番などの部屋', 'lbl-s') + ld(260, 70, 260, 88) + t(260, 66, '家来の部屋', 'lbl-s')
        + t(154, 168, '大扉', 'lbl-s') + t(206, 168, '潜戸', 'lbl-s') + cap('正面から見た図'));
}
function uzumiFig() {
    return svg(bgSky + ground() + r(0, 70, 320, 80, 'stone') + p('M0 96H320M0 122H320', '', 'stroke:#90A4AE')
        + r(0, 50, 320, 20, 'plaster') + p('M0 52 H320 V44 H0Z', 'roof')
        + r(138, 104, 44, 46, '', 0, 'fill:#3E2723') + r(142, 108, 36, 42, 'door')
        + t(60, 64, '土塀', 'lbl-s') + t(60, 114, '石垣') + ld(232, 128, 184, 128) + tl(236, 132, '埋門') + cap('正面から見た図'));
}
function masuFig(soto, labels) {
    const [g1, g2] = labels;
    if (soto) {
        return svg(bgPlan + r(0, 0, 320, 62, 'field') + r(122, 74, 76, 74, '', 0, 'fill:#F6F0E2')
            + r(0, 62, 160, 12, 'wall') + r(190, 62, 130, 12, 'wall')
            + r(110, 74, 12, 46, 'wall') + r(110, 140, 12, 20, 'wall') + r(110, 148, 100, 12, 'wall') + r(198, 74, 12, 86, 'wall')
            + r(110, 116, 12, 4, 'gate') + r(110, 140, 12, 4, 'gate') + r(157, 62, 4, 12, 'gate') + r(189, 62, 4, 12, 'gate')
            + p('M150 50 L150 84', 'shoot') + p('M204 98 L182 110', 'shoot') + p('M116 84 L138 96', 'shoot')
            + p('M20 130 L172 130 L172 36', 'enemy')
            + t(90, 114, g1, 'lbl-s') + tl(198, 56, g2, 'lbl-s') + t(146, 120, '枡形') + tl(40, 40, '曲輪') + tl(20, 166, '城外', 'lbl-s')
            + cap('上から見た図'));
    }
    return svg(bgPlan + r(0, 0, 320, 110, 'field') + r(118, 38, 90, 72, '', 0, 'fill:#F6F0E2')
        + r(0, 110, 130, 12, 'wall') + r(160, 110, 160, 12, 'wall')
        + r(106, 26, 12, 84, 'wall') + r(106, 26, 114, 12, 'wall') + r(208, 26, 12, 50, 'wall') + r(208, 100, 12, 10, 'wall')
        + r(128, 110, 4, 12, 'gate') + r(158, 110, 4, 12, 'gate') + r(208, 74, 12, 4, 'gate') + r(208, 100, 12, 4, 'gate')
        + p('M112 60 L136 72', 'shoot') + p('M194 34 L194 58', 'shoot')
        + p('M145 170 L145 88 L280 88', 'enemy')
        + t(163, 62, '枡形') + tl(240, 50, '曲輪') + tl(20, 160, '城外', 'lbl-s') + tl(168, 140, g1, 'lbl-s') + tl(226, 72, g2, 'lbl-s')
        + cap('上から見た図'));
}
function oteFig(which) {
    const o = which === 'ote';
    return svg(bgPlan + r(40, 22, 240, 136, 'water', 8) + r(54, 36, 212, 108, 'flat2', 6) + r(118, 66, 84, 48, 'flat', 4) + t(160, 95, '本丸')
        + r(150, 144, 20, 14, '', 0, 'fill:#CDB08A') + r(146, 140, 28, 8, '', 0, `fill:${o ? '#C77700' : '#3E2723'}`)
        + r(150, 22, 20, 14, '', 0, 'fill:#CDB08A') + r(146, 32, 28, 8, '', 0, `fill:${o ? '#3E2723' : '#C77700'}`)
        + t(160, 174, '大手（正面口）の門', o ? 'lbl' : 'lbl-s') + t(160, 14, '搦手（裏口）の門', o ? 'lbl-s' : 'lbl'));
}
function ikuFig() {
    return svg(bgSky + ground() + base(60, 150, 70, 54, 18) + tower(60, 132, [[40, 14], [26, 10]], 12)
        + p('M104 112 Q160 70 208 108', 'route')
        + p('M212 96 L230 72 H300 L318 96Z', 'roof') + r(222, 96, 88, 54, 'plaster')
        + r(236, 104, 6, 46, 'wood') + r(266, 104, 6, 46, 'wood') + roof(254, 108, 52, 12, 30)
        + t(60, 168, '城') + t(266, 168, '寺など') + t(158, 76, '移築', 'lbl-s') + cap('城から移された門'));
}

/* 櫓・天守 */
function jusoFig() {
    return svg(bgSky + ground()
        + base(55, 150, 84, 64, 20) + tower(55, 130, [[48, 20]])
        + base(160, 150, 84, 64, 20) + tower(160, 130, [[52, 20], [38, 14]])
        + base(265, 150, 84, 64, 20) + tower(265, 130, [[56, 20], [44, 14], [32, 12]])
        + t(55, 168, '平櫓') + t(160, 168, '二重櫓') + t(265, 168, '三重櫓'));
}
function sumiFig() {
    return svg(bgPlan + r(40, 24, 240, 132, 'flat2') + r(40, 24, 240, 132, '', 0, 'fill:none;stroke:#A98B68;stroke-width:6')
        + r(28, 12, 24, 24, 'hl') + r(268, 12, 24, 24, 'hl') + r(28, 144, 24, 24, 'hl') + r(268, 144, 24, 24, 'hl')
        + t(160, 94, '曲輪') + t(84, 52, '隅櫓', 'lbl-s') + t(232, 140, '巽（辰巳）櫓', 'lbl-s')
        + `<path d="M308 70 L308 44" stroke="#455A64" stroke-width="1.5" marker-end="url(#arG)"/>` + t(308, 82, '北', 'lbl-s')
        + ld(250, 146, 266, 152) + tl(222, 178, '東南の隅', 'cap'));
}
function tamonFig() {
    return svg(bgSky + ground() + r(0, 112, 320, 38, 'stone')
        + body(40, 88, 240, 24) + roof(160, 93, 254, 14, 226)
        + tower(30, 112, [[44, 24], [30, 14]]) + tower(290, 112, [[44, 24], [30, 14]])
        + t(160, 58, '多聞櫓（長屋状の櫓）') + t(160, 136, '石垣') + cap('正面から見た図'));
}
function watariFig() {
    return svg(bgSky + ground() + r(95, 122, 130, 28, 'stone') + body(100, 100, 120, 22) + roof(160, 105, 128, 12, 112)
        + base(60, 150, 90, 70, 28) + tower(60, 122, [[56, 22], [40, 16]])
        + base(260, 150, 90, 70, 28) + tower(260, 122, [[56, 22], [40, 16]])
        + t(160, 86, '渡櫓') + t(60, 40, '櫓', 'lbl-s') + t(260, 40, '櫓', 'lbl-s') + cap('正面から見た図'));
}
function jubakoFig() {
    return svg(bgSky + ground() + '<g opacity=".45">' + base(85, 150, 90, 70, 20) + tower(85, 130, [[60, 22], [40, 16]]) + '</g>'
        + base(235, 150, 90, 70, 20) + tower(235, 130, [[60, 22], [60, 20]])
        + t(85, 168, 'ふつうの二重櫓', 'lbl-s') + t(235, 168, '重箱櫓') + cap('正面から見た図'));
}
function monomiFig() {
    return svg(bgSky + p('M200 150 Q262 96 320 124 V150Z', 'slope') + ground()
        + base(90, 150, 90, 70, 20) + tower(90, 130, [[56, 22], [40, 16], [28, 12]])
        + p('M106 74 L300 112', 'ghost') + p('M106 74 L300 70', 'ghost') + t(240, 64, '周りを見張る', 'lbl-s') + cap('正面から見た図'));
}
function taikoFig() {
    return svg(bgSky + ground() + base(120, 150, 100, 80, 20)
        + body(88, 106, 64, 24) + roof(120, 111, 84, 11, 56)
        + r(98, 82, 4, 26, 'wood') + r(138, 82, 4, 26, 'wood')
        + '<ellipse cx="120" cy="96" rx="11" ry="9" fill="#8D6E63" stroke="#5D4037"/>' + roof(120, 86, 70, 18, 16)
        + p('M154 86 Q164 95 154 104 M162 80 Q176 95 162 110 M170 74 Q188 95 170 116', '', 'fill:none;stroke:#546E7A;stroke-width:1.5')
        + t(250, 98, '音で時や合図を知らせる', 'lbl-s') + cap('正面から見た図'));
}
function tsukimiFig() {
    return svg(bgSky + '<circle cx="262" cy="38" r="14" fill="#FFE082"/>' + ground() + base(120, 150, 110, 90, 20)
        + body(80, 106, 80, 24) + roof(120, 111, 100, 11, 72)
        + r(86, 80, 4, 28, 'wood') + r(118, 80, 4, 28, 'wood') + r(150, 80, 4, 28, 'wood')
        + p('M86 100 H154', '', 'stroke:#6D4C41;stroke-width:2') + roof(120, 86, 90, 16, 20)
        + ld(186, 92, 158, 94) + tl(190, 96, '大きく開いた造り', 'lbl-s') + cap('正面から見た図'));
}
function idoYaguraFig() {
    return svg(bgSky + r(0, 150, 320, 30, '', 0, 'fill:#CDB08A') + p('M0 150 H320', 'grass')
        + r(90, 86, 140, 64, 'plaster') + r(100, 96, 120, 54, '', 0, 'fill:#EDE7DA') + roof(160, 91, 160, 20, 110)
        + r(148, 150, 24, 30, '', 0, 'fill:#4E3B31') + r(148, 168, 24, 12, 'water')
        + r(138, 136, 10, 14, 'stone') + r(172, 136, 10, 14, 'stone')
        + ld(236, 170, 176, 164) + tl(240, 174, '井戸', 'lbl-w') + t(160, 56, '櫓の中に井戸', 'lbl-s') + cap('断面図'));
}
function yaguradaiFig() {
    return svg(bgSky + ground() + base(85, 150, 130, 106, 38) + tower(85, 112, [[82, 24], [50, 16]])
        + base(235, 150, 130, 106, 38)
        + p('M194 112 V88 H276 V112 M210 88 V66 H260 V88', 'ghost')
        + t(85, 137, '櫓台') + t(235, 137, '櫓台') + t(235, 56, '建物が失われ、台だけ残る', 'lbl-s'));
}
function tenshudaiFig() {
    return svg(bgSky + ground() + base(160, 150, 152, 112, 46) + tower(160, 104, [[80, 24], [60, 18], [40, 16]])
        + ld(248, 62, 206, 62) + tl(252, 66, '天守') + ld(246, 128, 228, 128) + tl(250, 132, '天守台') + cap('正面から見た図'));
}
function boroFig() {
    return svg(bgSky + ground() + base(160, 150, 160, 136, 20)
        + body(100, 104, 120, 26) + body(104, 84, 112, 22)
        + roof(160, 108, 140, 8, 124) + p('M80 88 Q160 80 240 88 L214 64 H106Z', 'roof')
        + p('M136 74 L160 52 L184 74Z', '', 'fill:#FAFAF7;stroke:#56656D;stroke-width:1.5')
        + body(140, 44, 40, 20) + roof(160, 49, 64, 18, 14)
        + ld(246, 50, 184, 54) + tl(250, 52, '望楼') + ld(256, 80, 226, 78) + tl(258, 84, '入母屋の屋根', 'lbl-s') + cap('正面から見た図'));
}
function tosoFig() {
    return svg(bgSky + ground() + base(160, 150, 150, 120, 20) + tower(160, 130, [[110, 22], [92, 20], [74, 18], [56, 16], [40, 14]])
        + t(160, 168, '上の階ほど順に小さくなる', 'lbl-s') + cap('正面から見た図'));
}
function dokuritsuFig() {
    return svg(bgSky + ground() + base(160, 150, 120, 100, 20) + tower(160, 130, [[80, 22], [62, 18], [46, 16]])
        + t(160, 168, '天守だけが建つ', 'lbl-s'));
}
function fukugoFig() {
    return svg(bgSky + ground() + base(234, 150, 76, 66, 18) + body(208, 112, 52, 20) + roof(234, 117, 66, 14, 22)
        + base(140, 150, 120, 100, 20) + tower(140, 130, [[80, 22], [62, 18], [46, 16]])
        + t(140, 44, '天守') + t(238, 96, '付櫓'));
}
function renketsuFig() {
    return svg(bgSky + ground() + r(140, 126, 90, 24, 'stone') + body(144, 106, 82, 20) + roof(185, 111, 90, 10, 76)
        + base(90, 150, 110, 90, 20) + tower(90, 130, [[70, 22], [54, 18], [40, 14]])
        + base(262, 150, 80, 64, 16) + tower(262, 134, [[48, 18], [34, 14]])
        + t(90, 44, '天守') + t(262, 82, '小天守') + t(185, 96, '渡櫓など', 'lbl-s'));
}
function renritsuFig() {
    return svg(bgPlan + r(30, 12, 260, 156, 'flat2') + r(88, 46, 150, 92, '', 0, 'fill:none;stroke:#78909C;stroke-width:10')
        + r(56, 18, 64, 56, '', 0, 'fill:#56656D') + r(212, 26, 44, 38, '', 0, 'fill:#78909C')
        + r(212, 120, 44, 38, '', 0, 'fill:#78909C') + r(66, 120, 44, 38, '', 0, 'fill:#78909C')
        + t(88, 50, '天守', 'lbl-w') + t(234, 49, '小天守', 'lbl-w') + t(234, 143, '小天守', 'lbl-w') + t(88, 143, '小天守', 'lbl-w')
        + t(163, 95, '渡櫓などで輪につなぐ', 'lbl-s') + tl(36, 178, '上から見た図', 'cap'));
}

/* 石垣 */
function sangiFig() {
    let s = r(20, 28, 140, 122, '', 0, 'fill:#AEB9BF') + r(160, 28, 140, 122, '', 0, 'fill:#8E9AA0');
    for (let i = 0; i < 8; i++) {
        const y = 150 - (i + 1) * 15;
        if (i % 2 === 0) s += r(100, y, 60, 15, '', 0, 'fill:#C9D1D6;stroke:#6F7C83') + r(160, y, 26, 15, '', 0, 'fill:#9FAAB0;stroke:#6F7C83');
        else s += r(134, y, 26, 15, '', 0, 'fill:#C9D1D6;stroke:#6F7C83') + r(160, y, 60, 15, '', 0, 'fill:#9FAAB0;stroke:#6F7C83');
    }
    return svg(bgSky + ground() + s + p('M160 28 V150', '', 'stroke:#455A64;stroke-width:1.5')
        + t(60, 90, '石垣の面', 'lbl-s') + t(260, 90, '石垣の面', 'lbl-w')
        + t(160, 168, '隅の石の長辺と短辺を互い違いに積む', 'lbl-s') + cap('石垣の角（隅）を見た図'));
}
function noboriFig() {
    return svg(bgSky + p('M0 170 C80 160 120 40 190 36 C250 36 290 120 320 130 V180 H0Z', 'slope') + r(0, 168, 90, 12, 'water')
        + r(160, 26, 60, 12, 'flat', 4) + t(190, 20, '本丸')
        + p('M170 40 C150 80 110 130 60 166', '', 'fill:none;stroke:#78909C;stroke-width:6')
        + p('M210 40 C230 80 262 118 300 140', '', 'fill:none;stroke:#78909C;stroke-width:6')
        + p('M20 120 L88 118', 'enemy') + ld(104, 100, 124, 110) + tl(46, 98, '登り石垣') + tl(8, 164, '港', 'lbl-s') + cap('山を横から見た図'));
}
function koshimakiFig() {
    return svg(bgSky + p('M0 90 H154 C166 90 170 50 180 50 H196 L214 104 L224 150 H296 L308 96 H320 V180 H0Z', 'earth')
        + p('M214 104 L224 150 H206 L200 104Z', 'stone') + p('M202 118H218M204 134H221', '', 'stroke:#90A4AE')
        + p('M217.5 120 L224 150 H296 L302.7 120Z', 'water') + p('M0 90 H154 M180 50 H196', 'grass')
        + t(80, 80, '曲輪') + t(186, 80, '土塁', 'lbl-w') + ld(244, 106, 216, 116) + tl(246, 104, '石垣（下部）', 'lbl-s') + cap('断面図'));
}
function hachimakiFig() {
    return svg(bgSky + p('M0 100 H140 L176 44 H206 L212 88 L236 150 H296 L308 100 H320 V180 H0Z', 'earth')
        + p('M206 44 L212 88 H196 L194 44Z', 'stone') + p('M195 58H208M195 74H210', '', 'stroke:#90A4AE')
        + p('M225.9 124 L236 150 H296 L302.2 124Z', 'water') + p('M0 100 H140', 'grass')
        + r(192, 30, 14, 14, 'plaster') + p('M189 32 H209 V26 H189Z', 'roof')
        + t(70, 90, '曲輪') + t(180, 82, '土塁', 'lbl-w') + ld(248, 62, 212, 66) + tl(250, 64, '石垣（上部）', 'lbl-s')
        + ld(236, 30, 210, 34) + tl(238, 32, '塀', 'lbl-s') + cap('断面図'));
}

/* 虎口 */
function hiraFig() {
    return svg(bgPlan + r(0, 0, 320, 90, 'field') + r(0, 90, 130, 16, 'wall') + r(190, 90, 130, 16, 'wall')
        + p('M160 170 L160 40', 'enemy') + tl(20, 40, '曲輪') + tl(20, 150, '城外', 'lbl-s')
        + ld(236, 76, 192, 94) + tl(240, 72, '開口部', 'lbl-s') + cap('上から見た図'));
}
function sakaFig() {
    return svg(bgSky + p('M0 50 H150 L300 150 H320 V180 H0Z', 'earth') + p('M0 50 H150', 'grass')
        + r(134, 28, 4, 22, 'wood') + r(148, 28, 4, 22, 'wood') + roof(143, 32, 30, 8, 16)
        + p('M296 140 L186 70', 'enemy') + t(236, 146, '急な坂', 'lbl-w') + t(60, 40, '曲輪') + t(110, 24, '虎口', 'lbl-s') + cap('断面図'));
}
function kuichigaiFig() {
    return svg(bgPlan + r(0, 0, 320, 60, 'field') + r(0, 60, 210, 16, 'wall') + r(110, 100, 210, 16, 'wall')
        + p('M60 170 L60 88 L260 88 L260 30', 'enemy') + p('M180 44 L180 80', 'shoot')
        + tl(16, 40, '曲輪') + tl(16, 150, '城外', 'lbl-s') + cap('上から見た図'));
}
function ichimonjiFig() {
    return svg(bgPlan + r(0, 0, 320, 70, 'field') + r(0, 70, 140, 14, 'wall') + r(180, 70, 140, 14, 'wall')
        + r(120, 112, 80, 12, 'wall') + p('M60 166 L60 98 L160 98 L160 40', 'enemy')
        + ld(230, 118, 202, 118) + tl(234, 122, '一文字の防塁', 'lbl-s') + tl(16, 40, '曲輪') + tl(16, 160, '城外', 'lbl-s') + cap('上から見た図'));
}

/* 土塁・切岸・土橋 */
function doruiPartsFig() {
    return svg(bgSky + p('M0 130 H90 L140 60 H200 L250 130 H320 V180 H0Z', 'earth') + p('M0 130 H90 M140 60 H200 M250 130 H320', 'grass')
        + '<circle cx="140" cy="60" r="3" fill="#C77700"/><circle cx="200" cy="60" r="3" fill="#C77700"/><circle cx="250" cy="130" r="3" fill="#C77700"/>'
        + t(170, 52, '馬踏（褶）') + ld(88, 90, 116, 94) + tl(20, 90, '内法（城内側）', 'lbl-s') + tl(238, 98, '外法（城外側）', 'lbl-s')
        + ld(214, 46, 202, 58) + tl(216, 46, '法肩', 'lbl-s') + tl(262, 124, '法尻', 'lbl-s')
        + p('M90 150 H250', '', 'stroke:#fff;stroke-width:1.2') + p('M90 145 V155 M250 145 V155', '', 'stroke:#fff;stroke-width:1.2')
        + t(170, 166, '敷（底辺）', 'lbl-w') + cap('断面図'));
}
function mushaFig() {
    return svg(bgSky + p('M0 130 H80 L130 60 H230 L270 130 H320 V180 H0Z', 'earth') + p('M0 130 H80 M270 130 H320', 'grass')
        + p('M130 60 H204', 'grass-hl') + p('M214 60 H230', '', 'fill:none;stroke:#1E88E5;stroke-width:4')
        + r(204, 36, 10, 24, 'plaster') + p('M200 38 H218 V32 H200Z', 'roof')
        + t(167, 80, '武者走（城内側）', 'lbl-w') + ld(250, 48, 224, 58) + tl(252, 48, '犬走（城外側）', 'lbl-s')
        + t(190, 28, '塀', 'lbl-s') + tl(20, 120, '城内', 'lbl-s') + tl(284, 120, '城外', 'lbl-s') + cap('断面図'));
}
function kirigishiFig() {
    return svg(bgSky + p('M120 60 L320 140 L320 160 L150 150Z', '', 'fill:url(#hatch)')
        + p('M0 60 H120 L150 150 L320 160 V180 H0Z', 'earth') + p('M0 60 H120', 'grass')
        + p('M120 60 L320 140', '', 'fill:none;stroke:#A1887F;stroke-width:1.5;stroke-dasharray:5 4')
        + t(55, 50, '曲輪') + t(100, 112, '切岸', 'lbl-w')
        + '<text class="lbl-s" x="214" y="92" transform="rotate(21.8 214 92)">削る前の斜面</text>'
        + p('M300 150 L172 142', 'enemy') + cap('断面図'));
}
function dobashiFig() {
    return svg(bgPlan + r(0, 0, 320, 48, 'field') + r(0, 48, 145, 16, 'wall') + r(175, 48, 145, 16, 'wall')
        + r(0, 64, 320, 56, 'moat') + r(145, 64, 30, 56, '', 0, 'fill:#CDB08A') + p('M145 64 V120 M175 64 V120', '', 'stroke:#8D6E63;stroke-width:1.2')
        + p('M160 170 L160 28', 'route') + tl(20, 32, '曲輪') + '<text class="lbl-w" x="20" y="60" style="font-size:10px">土塁</text>'
        + tl(60, 97, '堀', 'lbl-w') + '<path d="M204 92 L180 92" stroke="#fff" stroke-width="1"/>' + tl(208, 96, '土橋', 'lbl-w') + tl(20, 150, '城外', 'lbl-s'));
}

/* 塀・建物 */
function hazamaFig() {
    return svg(bgSky + ground() + r(0, 120, 320, 30, 'stone') + r(0, 78, 320, 42, 'plaster') + p('M0 80 H320 V68 H0Z', 'roof')
        + r(40, 88, 6, 20, '', 0, 'fill:#37474F') + r(148, 88, 6, 20, '', 0, 'fill:#37474F')
        + '<circle cx="96" cy="98" r="5" fill="#37474F"/>' + p('M205 92 L212 104 H198Z', '', 'fill:#37474F') + r(254, 92, 11, 11, '', 0, 'fill:#37474F')
        + ld(43, 44, 43, 86) + t(43, 40, '矢狭間（縦長）', 'lbl-s')
        + ld(226, 44, 98, 90) + ld(226, 44, 205, 90) + ld(226, 44, 259, 90) + t(226, 40, '鉄砲狭間（丸・三角・四角）', 'lbl-s')
        + t(160, 138, '石垣', 'lbl-s') + cap('土塀を外から見た図'));
}
function ishiotoshiFig() {
    return svg(bgSky + ground() + r(60, 90, 140, 60, 'stone') + p('M60 110H200M60 130H200', '', 'stroke:#90A4AE')
        + body(52, 54, 150, 36) + r(196, 62, 26, 32, 'plaster') + p('M198 94 H220', '', 'stroke:#37474F;stroke-width:3')
        + roof(137, 59, 186, 16, 150) + p('M210 98 L210 142', 'shoot')
        + '<g fill="#E53935"><circle cx="226" cy="146" r="3"/><circle cx="238" cy="144" r="3"/></g>'
        + ld(252, 80, 224, 84) + tl(254, 82, '石落とし') + t(130, 124, '石垣') + cap('正面から見た図（模式）'));
}
function tsuijiFig() {
    let layers = '';
    for (let y = 80; y < 126; y += 8) layers += `M0 ${y}H320`;
    return svg(bgSky + ground() + r(0, 126, 320, 24, 'stone') + r(0, 70, 320, 56, '', 0, 'fill:#C9A77C')
        + p(layers, '', 'stroke:#B08E64;stroke-width:1') + p('M0 72 H320 V60 H0Z', 'roof')
        + t(160, 102, 'つき固めた土の層（版築）', 'lbl-w') + t(160, 142, '石垣の基礎', 'lbl-s') + cap('正面から見た図'));
}
function gotenFig() {
    return svg(bgSky + ground() + r(20, 104, 150, 46, 'plaster') + roof(95, 109, 166, 26, 90)
        + r(190, 112, 110, 38, 'plaster') + roof(245, 117, 124, 22, 70)
        + t(95, 168, '表御殿（政務）') + t(245, 168, '奥御殿（暮らし）') + cap('正面から見た図'));
}
function sosekiFig() {
    return svg(bgSky + r(0, 110, 320, 70, '', 0, 'fill:#CDB08A') + p('M0 110 H320', 'grass')
        + r(72, 30, 16, 78, 'wood') + '<ellipse class="stone" cx="80" cy="112" rx="26" ry="8"/>'
        + r(222, 110, 36, 42, '', 0, 'fill:#A1887F') + r(232, 30, 16, 118, 'wood')
        + p('M160 20 V176', 'ghost') + t(80, 22, '礎石建物') + t(240, 22, '掘立柱建物')
        + t(80, 146, '石の上に柱を立てる', 'lbl-w') + t(240, 168, '柱を地面に埋める', 'lbl-w') + cap('断面図'));
}

/* 井戸・水利・狼煙 */
function idoFig() {
    return svg(bgSky + r(0, 70, 320, 110, '', 0, 'fill:#CDB08A') + p('M0 70 H320', 'grass')
        + r(146, 70, 28, 96, '', 0, 'fill:#4E3B31') + r(146, 138, 28, 28, 'water')
        + r(140, 56, 6, 110, 'stone') + r(174, 56, 6, 110, 'stone') + r(134, 54, 16, 16, 'stone', 2) + r(170, 54, 16, 16, 'stone', 2)
        + tl(40, 60, '曲輪') + ld(214, 50, 188, 58) + tl(218, 50, '井戸') + cap('断面図'));
}
function mizunoteFig() {
    return svg(bgPaper + p(BLOB, 'slope') + r(120, 24, 80, 40, 'flat', 12) + t(160, 49, '主郭')
        + r(40, 110, 96, 52, 'hl', 10) + r(46, 116, 84, 40, '', 8, 'fill:none;stroke:#A98B68;stroke-width:4')
        + '<ellipse class="water" cx="88" cy="136" rx="26" ry="11"/>' + r(118, 106, 12, 12, 'roof')
        + p('M150 66 Q134 88 116 106', 'route') + t(88, 102, '水の手曲輪')
        + ld(174, 142, 116, 138) + tl(178, 146, '貯水池と土塁', 'lbl-s') + ld(152, 112, 132, 112) + tl(156, 116, '櫓', 'lbl-s') + cap('上から見た図'));
}
function noroshiFig() {
    const smoke = (x, y, s) => p(`M${x} ${y} C${x - 10 * s} ${y - 14 * s} ${x + 10 * s} ${y - 24 * s} ${x} ${y - 38 * s} C${x - 8 * s} ${y - 50 * s} ${x + 8 * s} ${y - 60 * s} ${x + 2 * s} ${y - 72 * s}`, '', `fill:none;stroke:#90A4AE;stroke-width:${6 * s};stroke-linecap:round;opacity:.85`);
    return svg(bgSky + p('M0 180 V150 Q60 60 150 160 V180Z', 'slope') + p('M190 180 Q256 110 320 146 V180Z', 'slope')
        + p('M56 96 L62 84 L68 96Z', '', 'fill:#FF7043') + smoke(62, 84, 1)
        + p('M254 124 L258 116 L262 124Z', '', 'fill:#FF7043') + smoke(258, 116, .6)
        + p('M78 34 L244 80', 'ghost') + t(160, 44, '煙で知らせを伝える', 'lbl-s')
        + t(62, 128, '狼煙台') + t(258, 168, '次の狼煙台', 'lbl-s'));
}

/* ══ カードの中身 ════════════════════════════════════════════════ */
const KINDS_TABLE = `<table class="kinds">
    <tr><td>現存天守</td><td>江戸時代以前から残っている天守</td><td class="n">12城</td></tr>
    <tr><td>木造復元天守</td><td>記録に基づき、当時の材料・工法で忠実に建て直したもの</td><td class="n">5城</td></tr>
    <tr><td>外観復元天守</td><td>鉄筋コンクリートなどで外観だけを昔の姿にしたもの</td><td class="n">9城</td></tr>
    <tr><td>復興天守</td><td>天守は確かにあったが、推定や改変を含むもの</td><td class="n">14城</td></tr>
    <tr><td>模擬天守</td><td>もともと天守が無い、または有無が不明な城に建てたもの</td><td class="n">55城</td></tr></table>`;
const NONE = 'この地図の遺構欄には出てこない語';

const SECTIONS = [
  { id: 'kuruwa', name: '曲輪', color: '#6D4C41',
    lead: '土塁・石垣・堀などで区切った、城の中の平らな区画です。置かれた位置、形、役割によって呼び名が変わり、城全体での並べ方（縄張り）にも型があります。遺構欄の「曲輪」は12,418城に記録されています。',
    subs: [
      { name: '位置による呼び名', cards: [
        { t: '本丸', fig: nestFig(['hon']), txt: '城の中枢になる曲輪です。本丸御殿のような住まい兼政務の場を持ち、戦のときは最後の守りの場になります。', rec: '「本丸」を含む語 64城（本丸跡など）' },
        { t: '二の丸・三の丸', fig: nestFig(['ni', 'san']), txt: '本丸の次につながる曲輪が二の丸、そのさらに次につながる曲輪が三の丸です。本丸の役目を二の丸や三の丸に移した城もありました。', rec: '二の丸 29城・二の曲輪 8城・三の丸 12城' },
        { t: '東西南北の丸', fig: houiFig(), txt: '方位によって、東の丸・西の丸・南の丸・北の丸などと呼ぶ曲輪もあります。', rec: '北の丸 1城・東曲輪 1城・西の曲輪 1城・南曲輪 1城' },
      ]},
      { name: '形による呼び名', cards: [
        { t: '帯曲輪', y: 'おびぐるわ', fig: obiFig(), txt: '主な曲輪の外周に配置される、細長い小さな曲輪です。一段低く掘り下げて築いたり、二重に築いたりしたものもありました。', rec: '帯曲輪 17城' },
        { t: '腰曲輪', y: 'こしぐるわ', fig: koshiFig(), txt: '山の斜面に築いた、幅の狭い曲輪です。山地を生かした防御のための区画です。', rec: '腰曲輪 25城' },
        { t: '削平地', fig: sakuheiFig(), txt: '山などを削って平らにした所です。曲輪は、軍事や政治の目的でこうした削平や盛土を行って造った平らな空間です。', rec: '削平地 12城・削平面 3城・平場 1城' },
      ]},
      { name: '役割による呼び名', cards: [
        { t: '出丸', y: 'でまる', fig: demaruFig(), txt: '城の守りが弱い所を補ったり、物見をしたりするために造った補助的な曲輪で、本体から離れて独立して置かれます。', rec: '出丸 13城・出曲輪 3城' },
        { t: '捨曲輪', y: 'すてぐるわ', fig: suteFig(), txt: '主郭の前などに築き、戦うときは主郭から打って出るために使い、守りに回ったときは捨てるつもりで造った曲輪です。', rec: NONE },
        { t: '馬出', y: 'うまだし', fig: kakuUmaFig(), txt: '虎口の前に置く小さな曲輪です。形の違い（角馬出・丸馬出）は「虎口」の項にあります。', rec: '馬出 32城' },
      ]},
      { name: '縄張り（曲輪の並べ方）の型', cards: [
        { t: '輪郭式', y: 'りんかくしき', fig: nestFig([], '上から見た図'), txt: '本丸を二の丸が囲み、二の丸を三の丸が囲む縄張りです。四方の守りが等しく厚くなる一方、曲輪を囲んでいくので城が大きくなります。例：山形城・松本城・大坂城。', rec: NONE },
        { t: '連郭式', y: 'れんかくしき', fig: renkakuFig(), txt: '本丸と二の丸などを並べて置く縄張りで、尾根の上などに独立した曲輪を連ねます。奥行きは深くなりますが、本丸の脇や背後が露出しやすくなります。例：備中松山城・伊予松山城・盛岡城。', rec: NONE },
        { t: '梯郭式', y: 'ていかくしき', fig: teikakuFig(), txt: '本丸を城の片隅に置き、その2方向か3方向を他の曲輪で囲む縄張りです。山や海・川を背後にして、本丸をそちらに寄せます。例：岡山城。', rec: NONE },
        { t: '階郭式', y: 'かいかくしき', fig: kaikakuFig(), txt: '曲輪を階段のように並べる縄張りで、戦国時代の山城や江戸時代初期の平山城に見られます。例：姫路城・丸亀城・熊本城。', rec: NONE },
        { t: '山城・平山城・平城', y: 'やまじろ・ひらやまじろ・ひらじろ', fig: ritchiFig(), txt: '山に築いた山城、平地に臨む丘に築いた平山城、平地そのものに築いた平城に分けられます。ただし区別ははっきりしたものではありません。例：竹田城・伊予松山城・松本城。', rec: NONE },
      ]},
    ]},

  { id: 'hori', name: '堀', color: '#1565C0',
    lead: '敵の侵入を妨げるために掘った溝です。水の有無、掘る場所と向き、断面の形、堀底の造りによって呼び名が分かれます。遺構欄の「堀」は8,951城に記録されています。',
    subs: [
      { name: '水の有無', cards: [
        { t: '空堀', y: 'からぼり', fig: karaboriFig(), txt: '水の無い堀です。曲輪の周りや前の土を掘って、外と行き来できないように断ち切ります。', rec: '空堀 1,041城' },
        { t: '水堀', y: 'みずぼり', fig: mizuboriFig(), txt: '水を引き入れた堀です。平地の城に多く見られ、運河や排水にも使われました。', rec: '水堀 93城' },
      ]},
      { name: '掘る場所と向き（山城）', cards: [
        { t: '堀切', y: 'ほりきり', fig: horikiriFig(), txt: '尾根や続いている丘を遮って止めるために掘った空堀です。等高線に直角になるように掘られ、主に山城で使われました。', rec: '堀切 2,629城（うち二重堀切 5・大堀切 6・連続堀切 2）' },
        { t: '竪堀', y: 'たてぼり', fig: tateboriFig(), txt: '攻め寄せた敵が斜面を横へ移動するのを防ぐ堀で、等高線に直角に掘られます。堀に沿って一列に並んだ敵を弓矢で射やすく、戦国時代後期には鉄砲の導入で効果が増しました。', rec: '竪堀 947城' },
        { t: '畝状竪堀群', y: 'うねじょうたてぼりぐん', fig: uneFig(), txt: '竪堀を1本だけでなく連続していくつも並べ、堀と土塁（畝）が交互に連なるようにしたものです。敵の横移動を止めて進む道を堀の底だけに絞り、そこを狙って攻撃します。境目の城で、敵の進撃路に面する側に多く築かれたとされています。', rec: '畝状竪堀群 686城・連続竪堀 8城' },
        { t: '放射状竪堀', fig: hoshaFig(), txt: '曲輪を囲む横堀や腰曲輪から、間隔を空けて放射状に並べた多数の竪堀です。', rec: '1城（「竪堀（含放射状竪堀）」）' },
        { t: '横堀', y: 'よこぼり', fig: yokoboriFig(), txt: '曲輪の守りを固めるため、曲輪を廻るように設けた堀で、等高線と平行になるように掘られます。', rec: '横堀 618城' },
      ]},
      { name: '平地の城での位置', cards: [
        { t: '内堀・中堀・外堀', y: 'うちぼり・なかぼり・そとぼり', fig: uchisotoFig(), txt: '平地の城で、内側の堀を内堀、外側の堀を外堀、その中間の堀を中堀と呼びます。', rec: '内堀 3城・外堀 3城・外濠 2城・内濠 1城' },
        { t: '総構・総堀', y: 'そうがまえ', fig: sougamaeFig(), txt: '城だけでなく城下町一帯も含めて、外周を堀や石垣・土塁で囲い込んだ構えを総構といい、その堀を総堀（惣堀）と呼びます。例：小田原城・大坂城・江戸城。', rec: '総構 2城' },
      ]},
      { name: '断面の形', cards: [
        { t: '薬研堀', fig: kataFig('M0 60 H90 L160 160 L230 60 H320 V180 H0Z', 'M0 60 H90 M230 60 H320', '底がV字'), txt: '底がV字形に尖った断面の堀です。両側とも急な斜面になったものは諸薬研堀と呼びます。', rec: NONE },
        { t: '片薬研堀', fig: kataFig('M0 60 H110 V160 L230 60 H320 V180 H0Z', 'M0 60 H110 M230 60 H320', '「レ」の字（片側が切り立つ）'), txt: '薬研堀の片側を切り立たせた、「レ」の字形の断面の堀です。', rec: NONE },
        { t: '箱堀', fig: kataFig('M0 60 H96 L112 150 H208 L224 60 H320 V180 H0Z', 'M0 60 H96 M224 60 H320', '底が平ら（箱形）'), txt: '底が平らな、箱形の断面の堀です。水堀に多く使われました。', rec: NONE },
        { t: '毛抜堀', fig: kataFig('M0 60 H96 C100 180 220 180 224 60 H320 V180 H0Z', 'M0 60 H96 M224 60 H320', 'U字'), txt: 'U字形の断面の堀です。水堀に多く使われました。', rec: NONE },
      ]},
      { name: '堀底の造り・形', cards: [
        { t: '障子堀', y: 'しょうじぼり', fig: shojiFig(false), txt: '堀底に、堀を仕切る土塁状の障害物（障子・堀障子）を設けた堀です。障子は堀を掘ったときの掘り残しで、造る手間が少なくて済みます。後北条氏の山中城が知られますが、各地に見られます。', rec: '障子堀 8城' },
        { t: '畝堀', y: 'うねぼり', fig: shojiFig(true), txt: 'ほぼ一定の間隔で、土塁状の障子が連続して並ぶ堀です。', rec: '畝堀 4城' },
        { t: '三日月堀', y: 'みかづきぼり', fig: maruUmaFig('moat'), txt: '丸馬出の前に設けた、三日月形の堀です。武田氏が築いた城に多く見られます。', rec: '三日月堀 3城' },
      ]},
    ]},

  { id: 'mon', name: '門', color: '#AD1457',
    lead: '城の出入口に建てた門です。柱と屋根の組み方で種類が分かれ、置かれた場所や残り方でも呼び名が変わります。遺構欄の「門」は156城、「門」を含む語は306城に記録されています。',
    subs: [
      { name: '柱と屋根の組み方', cards: [
        { t: '冠木門', y: 'かぶきもん', fig: kabukiFig(), txt: '2本の鏡柱に冠木（横木）を渡しただけの簡素な門です。守りにはあまり役立たないため、主に仕切りとして使われました。', rec: '冠木門 3城' },
        { t: '薬医門', y: 'やくいもん', fig: yakuiFig(), txt: '前の鏡柱と後ろの控柱で、大きな屋根を支える門です。寺の山門にもよく見られる形式です。', rec: '薬医門 2城' },
        { t: '高麗門', y: 'こうらいもん', fig: koraiFig(), txt: '文禄・慶長の役の後に広まった門です。屋根が小さく、後ろの控柱にもそれぞれ屋根が付きます。', rec: NONE },
        { t: '棟門', y: 'むなもん', fig: muneFig(), txt: '2本の本柱の上に切妻屋根を架けた門です。控柱を設けず、脇の築地塀に支えられて立つ面が強いため不安定で、残っている例は少なくなっています。', rec: NONE },
        { t: '櫓門', y: 'やぐらもん', fig: yaguramonFig(), txt: '上に櫓を載せた門で、「二階門」ともいいます。櫓門から続く多聞櫓は続櫓と呼ばれます。', rec: '櫓門 6城' },
        { t: '長屋門', y: 'ながやもん', fig: nagayaFig(), txt: '門の両側に門番の部屋や仲間（ちゅうげん）部屋を置いた、長屋と一体の門です。近世の大名の城郭・陣屋・武家屋敷の門として生まれ、中央の両開きの大扉と脇の潜戸を備えるものがほとんどです。', rec: '長屋門 10城' },
        { t: '埋門', y: 'うずみもん', fig: uzumiFig(), txt: '石垣や土塀の下を、穴を開けるように抜いて造った門です。石垣を狭く切った間に門を建てて上に土塀を通す形と、石垣に穴を開けて通路にする形があり、裏口や非常口に使われました。', rec: NONE },
      ]},
      { name: '組み合わせ', cards: [
        { t: '枡形門', y: 'ますがたもん', fig: masuFig(true, ['門①', '門②']), txt: '高麗門と櫓門などを組み合わせて、守りを固めた門です。四角い枡形を挟んで門を二重に構えます。', rec: '枡形門 3城' },
      ]},
      { name: '置かれた場所', cards: [
        { t: '大手門', y: 'おおてもん', fig: oteFig('ote'), txt: '城の正面口（大手虎口）に構えた、守りの固い門です。追手門とも書きます。', rec: '大手門 23城（大手門跡などを含む）' },
        { t: '搦手門', y: 'からめてもん', fig: oteFig('kara'), txt: '城の裏口（搦手口）の門です。', rec: '搦手門 5城' },
      ]},
      { name: '残り方', cards: [
        { t: '移築門', fig: ikuFig(), txt: '城が廃された後、寺や個人の家などへ移されて残っている門です。遺構欄では「移築門（西法寺）」のように移築先が添えられていることがあります。', rec: '移築門 59城' },
      ]},
    ]},

  { id: 'yagura', name: '櫓', color: '#C2185B',
    lead: '櫓は、防御や物見のために城内に建てた建物です。屋根の重なりの数、置く場所、形、使い道によって呼び名が分かれます。遺構欄の「櫓台」は97城、「櫓」は46城に記録されています。',
    subs: [
      { name: '屋根の重なり・形', cards: [
        { t: '平櫓・二重櫓・三重櫓', fig: jusoFig(), txt: '屋根が1重のものを平櫓、2重のものを二重櫓、3重のものを三重櫓と呼びます。中の階数は、屋根の数と一致しないこともあります。', rec: NONE },
        { t: '多聞櫓', y: 'たもんやぐら', fig: tamonFig(), txt: '「多聞（多門）」は長屋のような建物のことで、長屋の形をした細長い櫓を指します。', rec: '多聞櫓 1城' },
        { t: '重箱櫓', y: 'じゅうばこやぐら', fig: jubakoFig(), txt: '1階と2階の広さがほぼ同じ、総二階造りの二重櫓です。', rec: NONE },
      ]},
      { name: '置く場所', cards: [
        { t: '隅櫓', y: 'すみやぐら', fig: sumiFig(), txt: '曲輪の隅に置く櫓です。方位にちなむ名が付くことが多く、東南（辰巳）に置いた櫓を巽櫓（辰巳櫓）と呼ぶのがその例です。', rec: '隅櫓 2城・巽櫓/辰巳櫓 3城・乾櫓 1城' },
        { t: '渡櫓', y: 'わたりやぐら', fig: watariFig(), txt: '櫓と櫓の間をつなぐように建てた櫓です。天守の連結式・連立式でも、天守と小天守を渡櫓などでつなぎます。', rec: '渡櫓 1城・続櫓 1城' },
      ]},
      { name: '使い道', cards: [
        { t: '物見櫓', y: 'ものみやぐら', fig: monomiFig(), txt: '周りを見張り、ものを観察するための櫓です。', rec: '物見櫓 5城' },
        { t: '太鼓櫓', y: 'たいこやぐら', fig: taikoFig(), txt: '城内の見晴らしのよい場所に建て、太鼓などの音で時を知らせたり、戦いの合図をしたりした櫓です。鐘を置くものは鐘櫓と呼ばれます。', rec: '太鼓櫓 4城' },
        { t: '月見櫓', y: 'つきみやぐら', fig: tsukimiFig(), txt: '月見のための櫓です。ほかの櫓より開放的な造りで、開口部がとても大きいことが多くなっています。', rec: '月見櫓 1城' },
        { t: '井戸櫓', y: 'いどやぐら', fig: idoYaguraFig(), txt: '中に井戸を持つ櫓です。', rec: NONE },
      ]},
      { name: '土台', cards: [
        { t: '櫓台', unv: true, fig: yaguradaiFig(), txt: '櫓の土台になる高まりです。建物が無くなっても、台だけ残っていることがあります。', rec: '櫓台 112城（櫓台跡などを含む）' },
      ]},
    ]},

  { id: 'tenshu', name: '天守', color: '#880E4F',
    lead: '戦国時代以降の城に建てられた、城の象徴となる建物です。見た目の形、ほかの櫓とのつなぎ方、建てられた経緯によって分けて呼びます。',
    subs: [
      { name: '土台', cards: [
        { t: '天守台', y: 'てんしゅだい', fig: tenshudaiFig(), txt: '天守を載せる、土塁や石垣で築いた高台です。内側を空洞にして、穴蔵という地下の階を造ることもあります。', rec: '天守台 48城（天守台跡などを含む）' },
      ]},
      { name: '見た目の形', cards: [
        { t: '望楼型', y: 'ぼうろうがた', fig: boroFig(), txt: '入母屋造りの櫓の上に、小さな望楼を載せたような形の天守です。', rec: NONE },
        { t: '層塔型', y: 'そうとうがた', fig: tosoFig(), txt: '寺の五重塔のように、上から下まで形に統一感のある天守です。上の階へ行くにつれて、広さが小さくなっていきます。', rec: NONE },
      ]},
      { name: 'ほかの建物とのつなぎ方', cards: [
        { t: '独立式', fig: dokuritsuFig(), txt: '天守が単独で建っている形式です。', rec: NONE },
        { t: '複合式', fig: fukugoFig(), txt: '天守に付櫓（主となる櫓に付属する櫓）を直接つないだ形式です。', rec: NONE },
        { t: '連結式', fig: renketsuFig(), txt: '天守から渡り廊下や多聞櫓を渡して、小天守（小さめの多重櫓）や櫓とつないだ形式です。', rec: '小天守 1城' },
        { t: '連立式', fig: renritsuFig(), txt: '複数の小天守や櫓と天守を、渡櫓などで輪のようにつないだ形式です。', rec: NONE },
      ]},
      { name: '建てられた経緯', cards: [
        { t: '天守の種類', fig: KINDS_TABLE, txt: '遺構欄には、天守がこの呼び名で記録されています。昔から残っているか、史料にどこまで基づいて建てたかによる区分です。', rec: '件数は上の表のとおり' },
      ]},
    ]},

  { id: 'ishigaki', name: '石垣', color: '#546E7A',
    lead: '石を積み上げて造った壁で、「石積み」「石塁」とも呼ばれます。石の加工の度合い、目地（継ぎ目）の通し方、角の積み方、土塁との組み合わせで呼び名が分かれます。遺構欄の「石垣」は1,698城、「石積」は410城、「石塁」は105城に記録されています。',
    subs: [
      { name: '石の加工の度合い', cards: [
        { t: '野面積み', y: 'のづらづみ', fig: stoneFig('nozura', 7, '正面から見た図'), txt: '自然の石や粗く割っただけの石を、加工せずにそのまま積む方法です。見た目は雑な感じになります。', rec: NONE },
        { t: '打込接', y: 'うちこみはぎ', fig: stoneFig('uchi', 11, '正面から見た図'), txt: '表に出る石の角や面をたたいて平らにし、石どうしの隙間を減らして積む方法です。', rec: NONE },
        { t: '切込接', y: 'きりこみはぎ', fig: stoneFig('kiri', 3, '正面から見た図'), txt: '方形に整えた石を密着させ、ブロックのように積む方法です。見た目は非常に整然とします。', rec: NONE },
      ]},
      { name: '目地の通し方', cards: [
        { t: '布積み', y: 'ぬのづみ', fig: stoneFig('nuno', 5, '正面から見た図'), txt: '方形に整えた比較的大きな石を、横の目地が一直線に通るように積む方法です。整層積みともいいます。', rec: '1城（「石垣（布積くずし積）」）' },
        { t: '乱積み', y: 'らんづみ', fig: stoneFig('ran', 9, '正面から見た図'), txt: '大きさの違う自然石や加工した平石を、さまざまな向きに組み合わせて積む方法です。乱層積みともいいます。', rec: NONE },
        { t: '谷積み', y: 'たにづみ', fig: stoneFig('tani', 2, '正面から見た図'), txt: '平たい石の隅を立てて積む方法です。落し積みともいいます。', rec: NONE },
        { t: '亀甲積み', y: 'きっこうづみ', fig: stoneFig('kikko', 4, '正面から見た図'), txt: '石を六角形に加工して積む、切込接の一種です。', rec: NONE },
      ]},
      { name: '角と配置', cards: [
        { t: '算木積み', y: 'さんぎづみ', fig: sangiFig(), txt: '石垣の角（出角）で、直方体の石の長辺と短辺を交互に組み合わせて強度を増す積み方です。角には補強のため大きな隅石が使われます。', rec: NONE },
        { t: '登り石垣', y: 'のぼりいしがき', fig: noboriFig(), txt: '豊臣秀吉の朝鮮出兵のとき、倭城で山頂の本丸と港を結ぶ山腹の両側に築いた石垣で、山腹からの敵の侵入を防ぎます。竪石垣ともいい、国内では伊予松山城・彦根城などに残ります。', rec: '登石垣 4城' },
      ]},
      { name: '土塁との組み合わせ', cards: [
        { t: '腰巻石垣', y: 'こしまきいしがき', fig: koshimakiFig(), txt: '土塁の下の部分を低い石垣で補強したものです。水堀や雨で土塁が崩れるのを防ぎます。', rec: '「腰巻土塁」1城' },
        { t: '鉢巻石垣', y: 'はちまきいしがき', fig: hachimakiFig(), txt: '土塁の上の部分を石垣で補強したものです。土塁の上部を固め、塀や櫓を支えます。上下とも石垣にした例が彦根城や江戸城に見られます。', rec: NONE },
      ]},
    ]},

  { id: 'koguchi', name: '虎口', color: '#EF6C00',
    lead: '曲輪の出入口です。攻め手が迫る要所なので、まっすぐ入れないようにする工夫がいくつもあります。遺構欄の「虎口」は782城に記録されています。',
    subs: [
      { name: '出入口の開け方', cards: [
        { t: '平虎口', y: 'ひらこぐち', fig: hiraFig(), txt: '堀や土塁で囲んだ曲輪の正面に、そのまま開けた最も基本的な出入口です。大軍に攻められると城側が不利になります。', rec: NONE },
        { t: '坂虎口', y: 'さかこぐち', fig: sakaFig(), txt: '虎口の前を急な坂にして、攻め寄せる敵の勢いを削ぐ造りです。特に山城で使われました。', rec: NONE },
        { t: '喰違虎口', y: 'くいちがいこぐち', fig: kuichigaiFig(), txt: '土塁や石垣を平行ではなく食い違いに置き、出入口を側面に開けたものです。敵はS字やZ字に進むしかなく、横からの攻撃も受けやすくなります。', rec: NONE },
        { t: '一文字虎口', y: 'いちもんじこぐち', fig: ichimonjiFig(), txt: '虎口の外側に、芎（かざし）と呼ぶ一文字形（一直線）の防塁を築いたものです。', rec: NONE },
      ]},
      { name: '枡形（四角い空間を設ける）', cards: [
        { t: '内枡形', y: 'うちますがた', fig: masuFig(false, ['第一の門', '第二の門']), txt: '曲輪の虎口の内側に小さな四角い空間を造り、第二の門を築いたものです。入り込んだ敵は枡形の中で周りから攻撃を浴びます。', rec: '枡形虎口 28城・枡形 8城' },
        { t: '外枡形', y: 'そとますがた', fig: masuFig(true, ['門', '門']), txt: '曲輪の虎口の外に、地続きの小さな四角い空間を張り出させたものです。', rec: '外枡形 1城' },
      ]},
      { name: '馬出（虎口の前の小さな曲輪）', cards: [
        { t: '角馬出', y: 'かくうまだし', fig: kakuUmaFig(), txt: '堀に面した虎口の外側に、土塁や石垣を積んで出入りできる所を残し、周りに堀を掘った小さな曲輪（馬出）のうち、四角いものです。後北条氏の勢力圏に多く分布します。', rec: NONE },
        { t: '丸馬出', y: 'まるうまだし', fig: maruUmaFig('uma'), txt: '馬出のうち、円い形のものです。武田氏の勢力圏とほぼ重なって分布し、前に三日月堀を伴います。', rec: '丸馬出 3城' },
      ]},
    ]},

  { id: 'dorui', name: '土塁・切岸', color: '#8D6E63',
    lead: '土を盛って築いた堤防状の壁（土塁）と、斜面を削った崖（切岸）です。土塁には部位ごとに名前があります。遺構欄の「土塁」は8,388城に記録されています。',
    subs: [
      { name: '土塁の部位', cards: [
        { t: '土塁の各部', y: 'どるい', fig: doruiPartsFig(), txt: '上の平らな所を褶（ひらみ）または馬踏（まぶみ）、底辺を敷（しき）、斜面を法（のり）といいます。城内側の法が内法、城外側が外法で、法と褶の境を法肩、法と敷の境を法尻と呼びます。', rec: '土塁 8,407城' },
        { t: '武者走・犬走', y: 'むしゃばしり・いぬばしり', fig: mushaFig(), txt: '土塁の上に塀や柵を設けたとき、城内側にできる通路を武者走、城外側にできる通路を犬走と呼びます。武者走は兵士の通路になりました。', rec: '武者走 5城・犬走 10城' },
      ]},
      { name: '崖と通路', cards: [
        { t: '切岸', y: 'きりぎし', fig: kirigishiFig(), txt: '斜面を削って人工的に急な崖にしたもので、斜面の下から攻め寄せる敵を防ぎます。鎌倉時代から戦国時代の城、特に山城で広く使われました。', rec: '切岸 125城' },
        { t: '土橋', y: 'どばし', fig: dobashiFig(), txt: '堀を巡らせるときに、出入りの通路として細い土手の形に残した部分です。取り外せる木橋に対して土橋は取り外しが難しく、場所によって使い分けられました。', rec: '土橋 175城' },
      ]},
    ]},

  { id: 'bldg', name: '塀・建物', color: '#6A1B9A',
    lead: '城の塀の仕掛けや、御殿・建物の跡も遺構として記録されています。',
    subs: [
      { name: '塀と防御の仕掛け', cards: [
        { t: '土塀と狭間', y: 'どべい・さま', fig: hazamaFig(), txt: '城の塀や櫓の壁には、弓矢や鉄砲で攻撃するための穴（狭間）を開けました。弓矢用は縦長の長方形、鉄砲用は円形・三角形・正方形です。土塀の壁の中には、弾を防ぐため小石や瓦礫を詰めました。', rec: '土塀 17城' },
        { t: '石落とし', y: 'いしおとし', fig: ishiotoshiFig(), txt: '狭間とともに備えた防御の仕掛けで、下方向の死角を減らすために設けました。', rec: NONE },
        { t: '築地塀', y: 'ついじべい', fig: tsuijiFig(), txt: '泥土をつき固めて造った塀で、単に築地ともいいます。石垣の基礎に柱を立てて木枠で挟み、練り土を入れて棒でつき固め（版築）、上に屋根を載せます。', rec: '築地 4城' },
      ]},
      { name: '建物と跡', cards: [
        { t: '御殿', y: 'ごてん', fig: gotenFig(), txt: '城主と家族が暮らす奥御殿と、政務を行う表御殿からなる建物です。本丸などに置かれました。', rec: '御殿 22城' },
        { t: '礎石建物・掘立柱建物', y: 'そせき・ほったてばしら', fig: sosekiFig(), txt: '礎石は建物の柱を支える石で、石の上に柱を立てた建物を礎石建物といいます。柱を直接地面に埋めて立てたものは掘立柱建物です。', rec: '礎石 36城・掘立柱 13城・柱穴 13城' },
      ]},
    ]},

  { id: 'mizu', name: '井戸・水利', color: '#00838F',
    lead: '城で水を確保するための施設です。',
    subs: [
      { name: '水の確保', cards: [
        { t: '井戸', y: 'いど', fig: idoFig(), txt: '城の中で水を得るために掘った井戸です。建物が残っていない城でも、井戸や井戸の跡が遺構として記録されていることがあります。', rec: '井戸 917城（井戸跡などを含む）' },
        { t: '水の手曲輪', y: 'みずのてくるわ', fig: mizunoteFig(), txt: '水を確保するために設けた曲輪で、井戸曲輪ともいいます。井戸や川から水を得られない城では貯水池を造り、周りに土塁を巡らせ、櫓などを設けて守っていたと考えられています。', rec: '水の手 2城・水ノ手 1城' },
      ]},
    ]},

  { id: 'noroshi', name: '狼煙・物見', color: '#4527A0',
    lead: '遠くへ知らせを伝えたり、見張ったりするための場所です。',
    subs: [
      { name: '知らせる', cards: [
        { t: '狼煙台', y: 'のろしだい', fig: noroshiFig(), txt: '物を焼いて煙を上げ、離れた所へ知らせを伝えるための場所です。戦国大名は狼煙を通信に使い、敵の人数に応じて上げる数を変える決まりもありました。', rec: '狼煙 10城・烽火 4城・狼火/のろし/ノロシ 各1城' },
      ]},
    ]},
];

