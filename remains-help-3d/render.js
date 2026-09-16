/* 遺構の見かたの立体図を描く。build.py が index.html を開き、ここで描いた canvas を remains-help/*.webp に書き出す。
   地図の画面はこのファイルを読まない（画像を表示するだけ）。

   地形は高さの格子で持ち、各マスを面にして、面の向きで明るさを変え、奥から順に塗る。
   格子の外周4辺には土の切り口（断面）を立てる。建物・壁・石垣は f.build で部品を足す。
   座標は x が左右、z が奥行き（0 が手前）、y が高さ。yaw は左右の回転（負で左手前から見る）、pitch は見下ろす角度。 */
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const hexRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const PAL = { grass: '#A5C47F', field: '#CBD9A9', earth: '#C7A274', hl: '#EFC27A', water: '#7DB8E0', stone: '#AEB9BF',
              sand: '#E8D9B8', wall: '#B59670', soil: '#C2A37B', topsoil: '#8A6B4B', dark: '#4E342E',
              plaster: '#F5F3EE', roof: '#56656D', wood: '#6D4C41', door: '#8D6E63', mortar: '#6F7C83',
              tile: '#8A6F55', town: '#D7CCC8', gold: '#C9A227' };
const rng = seed => () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const RGB = Object.fromEntries(Object.entries(PAL).map(([k, v]) => [k, hexRgb(v)]));
const LIGHT = (() => { const v = [-0.5, 0.9, -0.55], l = Math.hypot(...v); return v.map(x => x / l); })();
const shadeCss = (rgb, n) => {
    const k = 0.6 + 0.48 * Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]);
    return `rgb(${rgb.map(c => Math.min(255, Math.round(c * k))).join(',')})`;
};
const mixRgb = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

function buildSolid(f) {
    const nx = Math.round(f.W / f.step), nz = Math.round(f.D / f.step), sx = f.W / nx, sz = f.D / nz, NX = nx + 1;
    const P = [], G = [], S = [];
    let lo = Infinity, hi = -Infinity;
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
        const x = i * sx, z = j * sz, g = f.h(x, z), w = f.water ? f.water(x, z) : null, s = w != null && w > g ? w : g;
        G.push(g); S.push(s); P.push(x, s, z);
        lo = Math.min(lo, g); hi = Math.max(hi, s);
    }
    const base = f.base != null ? f.base : Math.floor(lo) - 8;
    const polys = [];
    const top = f.top || (() => 'grass'), steep = f.steep || (() => 'earth');
    const V3 = i => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
    const faceNormal = (i0, i1, i2) => {
        const p0 = V3(i0), p1 = V3(i1), p2 = V3(i2);
        const u = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], w = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
        let n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
        if (n[1] < 0) n = n.map(v => -v);
        const l = Math.hypot(n[0], n[1], n[2]) || 1; return n.map(v => v / l);
    };
    // smooth の図（自然の地形）は、点ごとの傾きをならした向きで色と明るさを決める。
    // 面ごとの向きのままだと、斜面の境目で隣り合う三角の色が交互に切り替わり、歯のようなギザギザになる
    let VN = null;
    if (f.smooth) {
        VN = [];
        const hs = (i, j) => S[clamp(j, 0, nz) * NX + clamp(i, 0, nx)];
        for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
            const n = [-(hs(i + 1, j) - hs(i - 1, j)) / ((Math.min(i + 1, nx) - Math.max(i - 1, 0)) * sx), 1,
                       -(hs(i, j + 1) - hs(i, j - 1)) / ((Math.min(j + 1, nz) - Math.max(j - 1, 0)) * sz)];
            const l = Math.hypot(n[0], n[1], n[2]); VN.push(n.map(v => v / l));
        }
    }
    const smoothN = ids => {
        const s = [0, 0, 0]; ids.forEach(id => { s[0] += VN[id][0]; s[1] += VN[id][1]; s[2] += VN[id][2]; });
        const l = Math.hypot(s[0], s[1], s[2]); return s.map(v => v / l);
    };
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
        const a = j * NX + i, b = a + 1, c = a + NX + 1, d = a + NX;
        const cx = (i + .5) * sx, cz = (j + .5) * sz, sc = (S[a] + S[b] + S[c] + S[d]) / 4;
        // 色の種類（草地・土など）は角の点ごとに決めて平均する。マスの中心だけで決めると、斜めの境目がマスの段々になる
        const colOf = (n, ids) => {
            if (ids.every(id => S[id] > G[id] + .01)) return shadeCss(RGB.water, n);
            const rt = [0, 0, 0], rs = [0, 0, 0];
            ids.forEach(id => {
                const x = P[id * 3], z = P[id * 3 + 2], t1 = RGB[top(x, z, G[id])], s1 = RGB[steep(x, z, G[id])];
                for (let m = 0; m < 3; m++) { rt[m] += t1[m] / ids.length; rs[m] += s1[m] / ids.length; }
            });
            return shadeCss(mixRgb(rs, rt, sstep((n[1] - .62) / .26)), n);
        };
        if (Math.abs(S[a] + S[c] - S[b] - S[d]) < .02) {
            const n = VN ? smoothN([a, b, c, d]) : faceNormal(a, b, c);
            polys.push({ v: [a, b, c, d], col: colOf(n, [a, b, c, d]), n, ax: cx, ay: sc, az: cz, cull: false });
        } else {
            // 平らでない四角は、画面上でねじれて余計な所まで塗らないよう三角2枚に分ける
            for (const t of [[a, b, c], [a, c, d]]) {
                const n = VN ? smoothN(t) : faceNormal(t[0], t[1], t[2]), q = t.map(V3);
                polys.push({ v: t, col: colOf(n, t), n, cull: false,
                    ax: (q[0][0] + q[1][0] + q[2][0]) / 3, ay: (q[0][1] + q[1][1] + q[2][1]) / 3, az: (q[0][2] + q[1][2] + q[2][2]) / 3 });
            }
        }
    }
    // 向きのある面（切り口・箱）。奥行きの基準は面の中心、高さは面の上端
    const quad = (pts, rgb, n) => {
        const i0 = P.length / 3; pts.forEach(p => P.push(p[0], p[1], p[2]));
        polys.push({ v: [i0, i0 + 1, i0 + 2, i0 + 3], col: shadeCss(rgb, n), n, cull: true,
            ax: (pts[0][0] + pts[2][0]) / 2, ay: Math.max(pts[0][1], pts[1][1], pts[2][1], pts[3][1]), az: (pts[0][2] + pts[2][2]) / 2 });
    };
    const edge = (list, n) => {
        for (let k = 0; k + 1 < list.length; k++) {
            const [x0, z0, g0, s0] = list[k], [x1, z1, g1, s1] = list[k + 1];
            const b0 = Math.min(1.4, (g0 - base) * .3), b1 = Math.min(1.4, (g1 - base) * .3);
            quad([[x0, base, z0], [x1, base, z1], [x1, g1 - b1, z1], [x0, g0 - b0, z0]], RGB.soil, n);
            quad([[x0, g0 - b0, z0], [x1, g1 - b1, z1], [x1, g1, z1], [x0, g0, z0]], RGB.topsoil, n);
            if (s0 > g0 + .01 || s1 > g1 + .01) quad([[x0, g0, z0], [x1, g1, z1], [x1, s1, z1], [x0, s0, z0]], RGB.water, n);
        }
    };
    const row = j => Array.from({ length: NX }, (_, i) => [i * sx, j * sz, G[j * NX + i], S[j * NX + i]]);
    const col = i => Array.from({ length: nz + 1 }, (_, j) => [i * sx, j * sz, G[j * NX + i], S[j * NX + i]]);
    edge(row(0), [0, 0, -1]); edge(row(nz), [0, 0, 1]); edge(col(0), [-1, 0, 0]); edge(col(nx), [1, 0, 0]);
    // 箱は4単位ごとに刻む（長い面の奥行きの基準が遠くへずれて、塗る順番が狂わないように）
    const chop = (a, b) => { const m = Math.max(1, Math.ceil((b - a) / 4)); return Array.from({ length: m + 1 }, (_, i) => a + (b - a) * i / m); };
    const boxFrom = polys.length;
    (f.boxes || []).forEach(([x0, z0, x1, z1, y0, y1, key]) => {
        const c = RGB[key], xs = chop(x0, x1), zs = chop(z0, z1);
        for (let i = 0; i + 1 < xs.length; i++) {
            for (let j = 0; j + 1 < zs.length; j++) quad([[xs[i], y1, zs[j]], [xs[i + 1], y1, zs[j]], [xs[i + 1], y1, zs[j + 1]], [xs[i], y1, zs[j + 1]]], c, [0, 1, 0]);
            quad([[xs[i], y0, z0], [xs[i + 1], y0, z0], [xs[i + 1], y1, z0], [xs[i], y1, z0]], c, [0, 0, -1]);
            quad([[xs[i + 1], y0, z1], [xs[i], y0, z1], [xs[i], y1, z1], [xs[i + 1], y1, z1]], c, [0, 0, 1]);
        }
        for (let j = 0; j + 1 < zs.length; j++) {
            quad([[x0, y0, zs[j + 1]], [x0, y0, zs[j]], [x0, y1, zs[j]], [x0, y1, zs[j + 1]]], c, [-1, 0, 0]);
            quad([[x1, y0, zs[j]], [x1, y0, zs[j + 1]], [x1, y1, zs[j + 1]], [x1, y1, zs[j]]], c, [1, 0, 0]);
        }
        hi = Math.max(hi, y1);
    });
    for (let q = boxFrom; q < polys.length; q++) polys[q].layer = 1;
    // ── 建物・塀・石垣など（f.build）。面は外向きの向きを持ち、見えない向きの面は描かない。
    //    窓・扉・狭間・石の模様は、その面に貼り付けて面を塗った直後に塗る（面と塗る順番がずれないように）
    const newell = pts => {
        let a = 0, b = 0, c = 0;
        for (let i = 0; i < pts.length; i++) {
            const p = pts[i], q = pts[(i + 1) % pts.length];
            a += (p[1] - q[1]) * (p[2] + q[2]); b += (p[2] - q[2]) * (p[0] + q[0]); c += (p[0] - q[0]) * (p[1] + q[1]);
        }
        const l = Math.hypot(a, b, c); return l < 1e-9 ? null : [a / l, b / l, c / l];
    };
    // 部品（prism・屋根）ごとに番号を振る。建物は部品を作った順に塗り、部品の中の面だけを奥行きで並べる
    // （壁のような大きな面は中心の奥行きが屋根の端より手前に出て、面ごとに並べると屋根の上に壁が出るため）
    let curGrp = 0;
    // twoSided: 屋根。軒を反らせた厚みのない面なので、低い角度からは裏側が見える。裏は暗い色で塗る
    const addFace = (pts, rgb, inside, twoSided) => {
        let n = newell(pts); if (!n) return null;
        const c = [0, 1, 2].map(k => pts.reduce((s, p) => s + p[k], 0) / pts.length);
        if ((c[0] - inside[0]) * n[0] + (c[1] - inside[1]) * n[1] + (c[2] - inside[2]) * n[2] < 0) n = n.map(v => -v);
        const i0 = P.length / 3;
        pts.forEach(p => { P.push(p[0], p[1], p[2]); if (p[1] > hi) hi = p[1]; });
        const pl = { v: pts.map((_, m) => i0 + m), col: shadeCss(rgb, n), n, cull: !twoSided, layer: 1, grp: curGrp, ax: c[0], ay: c[1], az: c[2] };
        if (twoSided) pl.colBack = 'rgb(52,62,68)';
        polys.push(pl); return pl;
    };
    const A = {
        ring: (cx, cz, w, d, y) => [[cx - w / 2, y, cz - d / 2], [cx + w / 2, y, cz - d / 2], [cx + w / 2, y, cz + d / 2], [cx - w / 2, y, cz + d / 2]],
        // 部品を1つ始める。複数の面を1つの部品として並べたいときに使う
        group() { curGrp++; },
        face(pts, key, inside, twoSided) { const pl = addFace(pts, RGB[key] || key, inside, twoSided); if (pl && pts.length === 4) pl.corners = pts; return pl; },
        // 底と上の輪郭（同じ点数）をつないだ立体。返り値は側面（0 が手前、1 が右、2 が奥、3 が左）
        prism(bot, top, key, topKey, capBottom) {
            curGrp++;
            const all = bot.concat(top), inside = [0, 1, 2].map(k => all.reduce((s, p) => s + p[k], 0) / all.length), sides = [];
            for (let i = 0; i < bot.length; i++) {
                const j = (i + 1) % bot.length, c = [bot[i], bot[j], top[j], top[i]], pl = addFace(c, RGB[key], inside);
                if (pl) pl.corners = c;
                sides.push(pl);
            }
            const tp = addFace(top, RGB[topKey || key], inside);
            if (tp && top.length === 4) tp.corners = top;
            if (capBottom) addFace(bot, RGB[key], inside);
            sides.top = tp;
            return sides;
        },
        box(x0, z0, x1, z1, y0, y1, key, topKey) {
            const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
            return A.prism(A.ring(cx, cz, x1 - x0, z1 - z0, y0), A.ring(cx, cz, x1 - x0, z1 - z0, y1), key, topKey);
        },
        // 縦の円柱（N 角柱）
        cyl(cx, cz, y0, y1, r, key, N = 12, topKey) {
            const ring = y => Array.from({ length: N }, (_, k) => [cx + Math.cos(k / N * Math.PI * 2) * r, y, cz + Math.sin(k / N * Math.PI * 2) * r]);
            return A.prism(ring(y0), ring(y1), key, topKey);
        },
        // 奥行き方向（z）に寝かせた円柱。太鼓など
        cylZ(cx, cy, z0, z1, r, key, capKey, N = 14) {
            const ring = z => Array.from({ length: N }, (_, k) => [cx + Math.cos(k / N * Math.PI * 2) * r, cy + Math.sin(k / N * Math.PI * 2) * r, z]);
            return A.prism(ring(z1), ring(z0), key, capKey, true);
        },
        // 石垣の台（下が広く上が狭い）
        base(cx, cz, bw, bd, tw, td, y0, h, kind = 'nozura') {
            const sides = A.prism(A.ring(cx, cz, bw, bd, y0), A.ring(cx, cz, tw, td, y0 + h), 'mortar', 'stone');
            sides.forEach((s, k) => A.stones(s, k % 2 ? bd : bw, Math.hypot(h, (bw - tw) / 2), 31 + k + Math.round(cx), kind));
            return sides;
        },
        // 寄棟の屋根。軒の四隅を lift だけ反り上げる。tw・td は上端の大きさ（td をほぼ0にすると棟になる）
        hip(cx, cz, w, d, ye, h, tw, td, lift = 1.2, key = 'roof') {
            curGrp++;
            const N = 6, inside = [cx, ye + h * .35, cz], e = A.ring(cx, cz, w, d, ye), t = A.ring(cx, cz, tw, td, ye + h);
            for (let i = 0; i < 4; i++) {
                const j = (i + 1) % 4;
                const E = s => [lerp(e[i][0], e[j][0], s), ye + lift * (2 * s - 1) ** 2, lerp(e[i][2], e[j][2], s)];
                const T = s => [lerp(t[i][0], t[j][0], s), ye + h, lerp(t[i][2], t[j][2], s)];
                for (let k = 0; k < N; k++) addFace([E(k / N), E((k + 1) / N), T((k + 1) / N), T(k / N)], RGB[key], inside, true);
            }
            if (tw > .5 && td > .5) addFace(t, RGB[key], inside, true);
        },
        // 切妻の屋根。axis は棟の向き。endKey を渡すと妻（三角の面）をその色にする
        gable(cx, cz, w, d, ye, h, axis, endKey) {
            curGrp++;
            const inside = [cx, ye + h * .3, cz], yr = ye + h, x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
            const slopes = axis === 'x'
                ? [[[x0, ye, z0], [x1, ye, z0], [x1, yr, cz], [x0, yr, cz]], [[x1, ye, z1], [x0, ye, z1], [x0, yr, cz], [x1, yr, cz]]]
                : [[[x0, ye, z0], [x0, ye, z1], [cx, yr, z1], [cx, yr, z0]], [[x1, ye, z1], [x1, ye, z0], [cx, yr, z0], [cx, yr, z1]]];
            const ends = axis === 'x'
                ? [[[x0, ye, z0], [x0, yr, cz], [x0, ye, z1]], [[x1, ye, z0], [x1, yr, cz], [x1, ye, z1]]]
                : [[[x0, ye, z0], [cx, yr, z0], [x1, ye, z0]], [[x0, ye, z1], [cx, yr, z1], [x1, ye, z1]]];
            slopes.forEach(fc => addFace(fc, RGB.roof, inside, true));
            ends.forEach(fc => addFace(fc, RGB[endKey || 'roof'], inside, !endKey));
        },
        // 入母屋の屋根。下は寄棟、上に切妻を載せる（棟は x 向き）
        irimoya(cx, cz, w, d, ye, h, lift = 1.2) {
            const h1 = h * .45, tw = w * .62, td = d * .34;
            A.hip(cx, cz, w, d, ye, h1, tw, td, lift);
            A.gable(cx, cz, tw, td, ye + h1, h - h1, 'x', 'plaster');
        },
        // 面に貼る模様。uv は面の左下(0,0)〜右上(1,1)
        decal(pl, shapes) {
            if (!pl || !pl.corners) return;
            const [BL, BR, TR, TL] = pl.corners, n = pl.n;
            pl.dec = pl.dec || [];
            shapes.forEach(sh => {
                const i0 = P.length / 3;
                sh.uv.forEach(([u, v]) => { for (let k = 0; k < 3; k++) P.push(lerp(lerp(BL[k], BR[k], u), lerp(TL[k], TR[k], u), v) + n[k] * .06); });
                pl.dec.push({ v: sh.uv.map((_, m) => i0 + m), col: shadeCss(sh.rgb, n), stroke: sh.stroke ? shadeCss(hexRgb(sh.stroke), n) : null });
            });
        },
        // 面に長方形を貼る（u0..u1, v0..v1）
        rects(pl, list, hex) {
            A.decal(pl, list.map(([u0, v0, u1, v1, h2]) => ({ uv: [[u0, v0], [u1, v0], [u1, v1], [u0, v1]], rgb: hexRgb(h2 || hex) })));
        },
        windows(pl, count, v0 = .38, v1 = .66) {
            const w = .12 / count;
            A.decal(pl, Array.from({ length: count }, (_, i) => {
                const u = (i + .5) / count; return { uv: [[u - w, v0], [u + w, v0], [u + w, v1], [u - w, v1]], rgb: hexRgb('#607D8B') };
            }));
        },
        // 石垣の石。Wu・Hu は面の幅と高さ（単位）。kind は積み方
        stones(pl, Wu, Hu, seed, kind = 'nozura') {
            const rn = rng(seed), shapes = [];
            const shade = () => { const g = Math.round(168 + rn() * 34); return [g - 6, g + 2, g + 8]; };
            const put = pts => shapes.push({ uv: pts.map(([x, y]) => [clamp(x / Wu, 0, 1), clamp(y / Hu, 0, 1)]), rgb: shade(), stroke: '#5E6A70' });
            if (kind === 'nozura') {
                for (let y = 0; y < Hu - .3;) {
                    let rh = 2.2 + rn() * 2.6; if (y + rh > Hu - .8) rh = Hu - y;
                    for (let x = -rn() * 2; x < Wu;) {
                        const sw = 2.2 + rn() * 4, cx = x + sw / 2, cy = y + rh / 2, rx = sw / 2 - .25, ry = rh / 2 - .25, pts = [];
                        for (let k = 0; k < 8; k++) {
                            const a = k / 8 * Math.PI * 2 + (rn() - .5) * .5, s = .85 + rn() * .2;
                            pts.push([cx + Math.cos(a) * rx * s * 1.05, cy + Math.sin(a) * ry * s * 1.05]);
                        }
                        put(pts); x += sw;
                    }
                    y += rh;
                }
            } else if (kind === 'uchi' || kind === 'kiri' || kind === 'nuno') {
                // 打込接：角をたたいた不ぞろいの四角。切込接：同じ大きさの四角を半分ずつずらす。布積み：横の目地が通る
                for (let y = 0, row = 0; y < Hu - .3; row++) {
                    let rh = kind === 'kiri' ? 2.4 : kind === 'nuno' ? 3 : 2.2 + rn() * 1.2; if (y + rh > Hu - .6) rh = Hu - y;
                    for (let x = kind === 'kiri' ? -(row % 2) * 2.2 : -rn() * 2; x < Wu;) {
                        const sw = kind === 'kiri' ? 4.4 : kind === 'nuno' ? 4 + rn() * 2.6 : 2.8 + rn() * 2.6;
                        const g = kind === 'kiri' ? .12 : .22, j = kind === 'uchi' ? .22 : .05, J = () => (rn() * 2 - 1) * j;
                        put([[x + g + J(), y + g + J()], [x + sw - g + J(), y + g + J()], [x + sw - g + J(), y + rh - g + J()], [x + g + J(), y + rh - g + J()]]);
                        x += sw;
                    }
                    y += rh;
                }
            } else if (kind === 'ran') {
                // 乱積み：大きさと向きの違う石を組み合わせる（格子を大小の四角で埋める）
                const u = 1.4, cols = Math.ceil(Wu / u) + 1, rows = Math.ceil(Hu / u) + 1, occ = rows && Array.from({ length: rows }, () => new Array(cols).fill(false));
                for (let i = 0; i < rows; i++) for (let jx = 0; jx < cols; jx++) {
                    if (occ[i][jx]) continue;
                    let w = 2 + Math.floor(rn() * 3), h = 1 + Math.floor(rn() * 3), k = 0;
                    while (k < w && jx + k < cols && !occ[i][jx + k]) k++;
                    w = Math.max(1, k); h = Math.min(h, rows - i);
                    for (let a = 0; a < h; a++) for (let c2 = 0; c2 < w; c2++) occ[i + a][jx + c2] = true;
                    const x0 = jx * u, y0 = i * u;
                    put([[x0 + .15, y0 + .15], [x0 + w * u - .15, y0 + .15], [x0 + w * u - .15, y0 + h * u - .15], [x0 + .15, y0 + h * u - .15]]);
                }
            } else if (kind === 'tani') {
                // 谷積み：石の隅を立てて斜めに積む
                const s = 2;
                for (let row = 0; row * s < Hu + 2 * s; row++) {
                    const cy = row * s, off = (row % 2) * s;
                    for (let cx = -s + off; cx < Wu + s; cx += 2 * s) put([[cx, cy - s + .2], [cx + s - .2, cy], [cx, cy + s - .2], [cx - s + .2, cy]]);
                }
            } else if (kind === 'kikko') {
                // 亀甲積み：六角形の石
                const R = 1.9, hw = Math.sqrt(3) * R / 2;
                for (let row = 0; row * 1.5 * R < Hu + 2 * R; row++) {
                    const cy = row * 1.5 * R, off = (row % 2) * hw;
                    for (let cx = -hw + off; cx < Wu + hw; cx += 2 * hw) put(Array.from({ length: 6 }, (_, k) => {
                        const a = Math.PI / 6 + k * Math.PI / 3; return [cx + Math.cos(a) * (R - .2), cy + Math.sin(a) * (R - .2)];
                    }));
                }
            }
            A.decal(pl, shapes);
        },
        // 重ねた建物。tiers は下から [幅, 奥行き, 高さ]
        tower(cx, cz, y, tiers, topH = 8, lastRoof = 'hip') {
            tiers.forEach(([w, d, h], i) => {
                const last = i === tiers.length - 1, sides = A.box(cx - w / 2, cz - d / 2, cx + w / 2, cz + d / 2, y, y + h, 'plaster');
                if (h >= 6) sides.forEach((s, k) => A.windows(s, Math.max(1, Math.round((k % 2 ? d : w) / 10))));
                const ye = y + h - 2, rh = last ? topH : 5;
                if (last && lastRoof === 'irimoya') A.irimoya(cx, cz, w + 8, d + 8, ye, rh + 3);
                else A.hip(cx, cz, w + 8, d + 8, ye, rh, last ? w * .35 : w - 4, last ? .01 : d - 4);
                y = ye + rh;
            });
            return y;
        },
    };
    if (f.build) f.build(A);
    return { P: new Float32Array(P), polys, base, hi, nx, nz, sx, sz, S };
}

const LINE_STYLE = { enemy: ['#E53935', 2.2, [6, 4], 1], shoot: ['#1E88E5', 2, [], 1], route: ['#455A64', 2, [6, 4], 1],
                     ghost: ['#78909C', 1.3, [4, 3], 0], dim: ['#FFFFFF', 1.3, [], 0], sight: ['#78909C', 1.2, [3, 3], 1],
                     smoke: ['rgba(144,164,174,.75)', 5, [], 0], move: ['#455A64', 2, [6, 4], 1] };

// 点の書き方は [x, z] か [x, z, y]。y を省くと地面の高さ＋dy。
// opt: { W, H, dpr }。書き出しでは CSS 上の大きさ（W×H）と画素の倍率を渡す。省くと canvas の表示幅に合わせる
function drawSolid(cv, f, opt = {}) {
    const t0 = performance.now();
    const g = buildSolid(f);
    const W = opt.W || cv.clientWidth || 351, H = opt.H || Math.round(W * 180 / 320), dpr = opt.dpr || Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.height = H + 'px';
    const ctx = cv.getContext('2d'); ctx.setTransform(cv.width / W, 0, 0, cv.height / H, 0, 0);
    const cy = Math.cos(f.yaw), sy = Math.sin(f.yaw), cp = Math.cos(f.pitch), sp = Math.sin(f.pitch);
    const X0 = f.W / 2, Z0 = f.D / 2, Y0 = (g.base + g.hi) / 2;
    const rx = (x, z) => (x - X0) * cy + (z - Z0) * sy, rz = (x, z) => -(x - X0) * sy + (z - Z0) * cy;
    const P = g.P, n = P.length / 3, U = new Float32Array(n), V = new Float32Array(n);
    let umin = Infinity, umax = -Infinity, vmin = Infinity, vmax = -Infinity;
    for (let i = 0, q = 0; i < n; i++, q += 3) {
        const u = rx(P[q], P[q + 2]), v = (P[q + 1] - Y0) * cp + rz(P[q], P[q + 2]) * sp;
        U[i] = u; V[i] = v;
        if (u < umin) umin = u; if (u > umax) umax = u; if (v < vmin) vmin = v; if (v > vmax) vmax = v;
    }
    // 空に描く物（煙など）が上にはみ出さないよう、図が指定した高さまでを枠に入れる
    if (f.skyTop != null) {
        for (const [x, z] of [[0, 0], [f.W, 0], [0, f.D], [f.W, f.D]]) vmax = Math.max(vmax, (f.skyTop - Y0) * cp + rz(x, z) * sp);
    }
    const pad = 16, k = Math.min((W - 2 * pad) / (umax - umin), (H - 2 * pad - 6) / (vmax - vmin));
    const ox = W / 2 - k * (umin + umax) / 2, oy = H / 2 + 3 + k * (vmin + vmax) / 2;
    const proj = (x, y, z) => [ox + rx(x, z) * k, oy - ((y - Y0) * cp + rz(x, z) * sp) * k];
    const vis = g.polys.filter(p => !p.cull || p.n[1] * sp - (-p.n[0] * sy + p.n[2] * cy) * cp > 1e-4);
    vis.forEach(p => { p.d = rz(p.ax, p.az) * cp - (p.ay - Y0) * sp; });
    // 地形（layer 0）を先に全部塗り、地面の上に建つ物（layer 1）を後から塗る。
    // 大きな地面のマスは奥行きの基準が手前に出て、建物の根元を上から塗りつぶすため
    // 建物は部品を作った順（groupsByDepth の図は部品ごとの平均の奥行きで奥から）
    const gd = {};
    if (f.groupsByDepth) {
        const cnt = {};
        vis.forEach(p => { if (p.layer) { gd[p.grp] = (gd[p.grp] || 0) + p.d; cnt[p.grp] = (cnt[p.grp] || 0) + 1; } });
        for (const g2 in gd) gd[g2] /= cnt[g2];
    }
    const gkey = p => f.groupsByDepth ? -gd[p.grp || 0] : (p.grp || 0);
    vis.sort((a, b) => (a.layer || 0) - (b.layer || 0) || (a.layer ? gkey(a) - gkey(b) : 0) || b.d - a.d);

    ctx.fillStyle = '#EEF4F8'; ctx.fillRect(0, 0, W, H);
    ctx.lineWidth = .6; ctx.lineJoin = 'round';
    // 画面上でほぼ重なる頂点（0.05px 未満）は1点にまとめてから塗る。
    // 屋根の棟の端のように2点が 0.007px しか離れていない経路は、Chromium の canvas で塗りが欠けた（再現で確認）
    const tracePath = idx => {
        let lx = NaN, ly = NaN, fx = NaN, fy = NaN, cnt = 0;
        ctx.beginPath();
        for (const i of idx) {
            const x = ox + U[i] * k, y = oy - V[i] * k;
            if (cnt && Math.abs(x - lx) < .05 && Math.abs(y - ly) < .05) continue;
            if (cnt > 1 && Math.abs(x - fx) < .05 && Math.abs(y - fy) < .05) continue;
            if (cnt) ctx.lineTo(x, y); else { ctx.moveTo(x, y); fx = x; fy = y; }
            lx = x; ly = y; cnt++;
        }
        return cnt;
    };
    for (const p of vis) {
        if (tracePath(p.v) < 3) continue;
        const back = p.colBack && !(p.n[1] * sp - (-p.n[0] * sy + p.n[2] * cy) * cp > 1e-4);
        ctx.closePath(); ctx.fillStyle = ctx.strokeStyle = back ? p.colBack : p.col; ctx.fill(); ctx.stroke();
        if (p.dec) {
            for (const dc of p.dec) {
                if (tracePath(dc.v) < 3) continue;
                ctx.closePath(); ctx.fillStyle = dc.col; ctx.fill();
                ctx.strokeStyle = dc.stroke || dc.col; ctx.lineWidth = dc.stroke ? .5 : .3; ctx.stroke();
            }
            ctx.lineWidth = .6;
        }
    }

    const NX = g.nx + 1;
    const surf = (x, z) => {
        const fi = clamp(x / g.sx, 0, g.nx - 1e-6), fj = clamp(z / g.sz, 0, g.nz - 1e-6), i = Math.floor(fi), j = Math.floor(fj), tx = fi - i, tz = fj - j;
        return lerp(lerp(g.S[j * NX + i], g.S[j * NX + i + 1], tx), lerp(g.S[(j + 1) * NX + i], g.S[(j + 1) * NX + i + 1], tx), tz);
    };
    (f.fills || []).forEach(fl => {
        ctx.beginPath();
        fl.pts.forEach((p, m) => { const [a, b] = proj(p[0], p[2], p[1]); m ? ctx.lineTo(a, b) : ctx.moveTo(a, b); });
        ctx.closePath(); ctx.fillStyle = fl.c; ctx.fill();
    });
    (f.lines || []).forEach(ln => {
        const [colr, lw, dash, arrow] = LINE_STYLE[ln.k], dy = ln.dy != null ? ln.dy : 1.5, pts = [];
        for (let m = 0; m + 1 < ln.pts.length; m++) {
            const a = ln.pts[m], b = ln.pts[m + 1], steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 1.5));
            for (let s = m ? 1 : 0; s <= steps; s++) {
                const t = s / steps, x = lerp(a[0], b[0], t), z = lerp(a[1], b[1], t);
                pts.push(proj(x, a.length > 2 && b.length > 2 ? lerp(a[2], b[2], t) : surf(x, z) + dy, z));
            }
        }
        ctx.save(); ctx.strokeStyle = colr; ctx.lineWidth = ln.w || lw; ctx.setLineDash(dash); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.beginPath(); pts.forEach((p, m) => m ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.stroke(); ctx.restore();
        if (arrow) {
            const p1 = pts[pts.length - 1], p0 = pts[Math.max(0, pts.length - 4)], an = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
            ctx.beginPath();
            ctx.moveTo(p1[0] + Math.cos(an) * 3, p1[1] + Math.sin(an) * 3);
            ctx.lineTo(p1[0] + Math.cos(an + 2.6) * 8, p1[1] + Math.sin(an + 2.6) * 8);
            ctx.lineTo(p1[0] + Math.cos(an - 2.6) * 8, p1[1] + Math.sin(an - 2.6) * 8);
            ctx.closePath(); ctx.fillStyle = colr; ctx.fill();
        }
    });
    (f.dots || []).forEach(dt => dt.pts.forEach(p => {
        const [a, b] = proj(p[0], p.length > 2 ? p[2] : surf(p[0], p[1]) + 1.2, p[1]);
        ctx.beginPath(); ctx.arc(a, b, dt.r || 3, 0, Math.PI * 2); ctx.fillStyle = dt.c; ctx.fill();
        if (!dt.noStroke) { ctx.lineWidth = 1; ctx.strokeStyle = '#fff'; ctx.stroke(); }
    }));
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    (f.labels || []).forEach(lb => {
        const [a, b] = proj(lb.x, lb.y != null ? lb.y : surf(lb.x, lb.z) + (lb.dy != null ? lb.dy : 2), lb.z);
        const tx = a + (lb.ox || 0), ty = b + (lb.oy || 0);
        if (lb.ox || lb.oy) {
            ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(tx, ty); ctx.strokeStyle = '#546E7A'; ctx.lineWidth = 1; ctx.stroke();
            ctx.beginPath(); ctx.arc(a, b, 1.8, 0, Math.PI * 2); ctx.fillStyle = '#546E7A'; ctx.fill();
        }
        ctx.font = lb.c === 's' ? '10px sans-serif' : 'bold 11.5px sans-serif';
        ctx.lineWidth = 3.2; ctx.strokeStyle = 'rgba(255,255,255,.95)'; ctx.strokeText(lb.s, tx, ty);
        ctx.fillStyle = lb.c === 's' ? '#455A64' : '#263238'; ctx.fillText(lb.s, tx, ty);
    });
    ctx.textAlign = 'left'; ctx.font = '9.5px sans-serif'; ctx.fillStyle = '#90A4AE';
    ctx.fillText(f.cap || '斜め上から見た図（手前の切り口は断面）', 8, 11);
    return { faces: vis.length, ms: performance.now() - t0 };
}
