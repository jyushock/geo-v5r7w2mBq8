/* 遺構の見かたの立体図の定義。名前（英字）が画像のファイル名になり、remains-help.js のカードの f3 と対応する。
   1枚の図を複数のカードで使ってよい（例：本丸・二の丸・三の丸・輪郭式は rinkaku を使う）。
   使える書き方は render.js を参照。x が左右、z が奥行き（0 が手前）、y が高さ。 */

// 台形の断面。d=中心からの距離、bh=底の半幅、th=上の半幅
const trap = (d, bh, th, top, bot) => d <= bh ? bot : d >= th ? top : lerp(bot, top, (d - bh) / (th - bh));
// 長方形 [x0,z0,x1,z1] の内側なら縁までの距離（正）、外側なら負
const inR = (x, z, r) => Math.min(x - r[0], r[2] - x, z - r[1], r[3] - z);
// 長方形の外への距離（中なら0）
const outR = (x, z, r) => Math.hypot(Math.max(r[0] - x, 0, x - r[2]), Math.max(r[1] - z, 0, z - r[3]));
// 内側の区画と外側の区画に挟まれた堀。壁は wall 単位で立ち上がる
const ringH = (x, z, inner, iy, outer, oy, bot, wall = 1.5) => {
    const d1 = outR(x, z, inner), d2 = inR(x, z, outer);
    return Math.max(d1 >= wall ? bot : lerp(iy, bot, d1 / wall), d2 >= wall ? bot : lerp(oy, bot, d2 / wall));
};
// 折れ線の断面（[x, 高さ] の並び）
const polyline = (arr, x) => {
    x = clamp(x, arr[0][0], arr[arr.length - 1][0]);
    for (let i = 1; i < arr.length; i++) if (x <= arr[i][0]) return lerp(arr[i - 1][1], arr[i][1], (x - arr[i - 1][0]) / (arr[i][0] - arr[i - 1][0]));
    return arr[arr.length - 1][1];
};
const slopeZ = z => 34 * clamp((z - 6) / 76, 0, 1);      // 手前が低く奥が高い斜面
const KOSHI = [[0, 3], [11, 5], [36, 22], [50, 22], [61, 32.5], [99, 32.5], [111, 21.5], [126, 21.5], [153, 4], [160, 2.5]];
const HON = [50, 37, 110, 63], M2 = [43, 32, 117, 68], NI = [30, 23, 130, 77], M1 = [21, 15, 139, 85], SAN = [8, 5, 152, 95];
const MORTAR_H = (h, run) => Math.hypot(h, run);          // 傾いた石垣の面の縦の長さ
// 平地の城の区画。rects は [[x0,z0,x1,z1], 高さ] の並び。区画の縁から wall 単位で bot へ落ちる
const platH = (x, z, rects, bot, wall = 1.5) => {
    let best = bot;
    for (const [r, y] of rects) {
        const d = outR(x, z, r);
        if (d === 0) return y;
        if (d < wall) best = Math.max(best, lerp(y, bot, d / wall));
    }
    return best;
};
// 堀の範囲（rects のどれかの内側）。縁から wall 単位で地面の高さへ戻る
const moatBot = (x, z, rects, bot, ground, wall = 1.5) => {
    let d = -Infinity;
    for (const r of rects) d = Math.max(d, inR(x, z, r));
    return d > wall ? bot : d > 0 ? lerp(ground, bot, d / wall) : ground;
};

const FIGS = {
  // ══ 堀 ══
  karabori: { title: '空堀', W: 160, D: 100, step: 2, yaw: -0.25, pitch: 0.68,
    h: x => trap(Math.abs(x - 80), 10, 21, 24, 3),
    top: x => x < 59 ? 'grass' : x > 101 ? 'field' : 'earth',
    labels: [{ x: 30, z: 50, s: '曲輪' }, { x: 132, z: 50, s: '城外', c: 's' }, { x: 80, z: 56, s: '空堀' }] },

  mizubori: { title: '水堀', W: 160, D: 100, step: 2, yaw: -0.25, pitch: 0.68,
    h: x => trap(Math.abs(x - 80), 12, 23, 24, 2),
    water: x => Math.abs(x - 80) < 23 ? 13 : null,
    top: x => x < 57 ? 'grass' : x > 103 ? 'field' : 'earth',
    labels: [{ x: 30, z: 50, s: '曲輪' }, { x: 132, z: 50, s: '城外', c: 's' }, { x: 80, z: 56, dy: 1, s: '水堀' }] },

  yagen: { title: '薬研堀', W: 160, D: 100, step: 2, yaw: -0.25, pitch: 0.62,
    h: x => trap(Math.abs(x - 80), 0, 24, 24, 2),
    top: x => x < 56 ? 'grass' : x > 104 ? 'field' : 'earth',
    labels: [{ x: 28, z: 50, s: '曲輪' }, { x: 134, z: 50, s: '城外', c: 's' }, { x: 80, z: 60, dy: 3, s: '薬研堀' },
             { x: 80, z: 0, y: -2, s: '底がV字', c: 's' }] },

  horikiri: { title: '堀切', W: 160, D: 100, step: 1.2, yaw: -0.6, pitch: 0.6, smooth: true,
    h: (x, z) => {
        const crest = x < 25 ? 30 - (25 - x) * 0.8 : x <= 100 ? 30 : 30 - (x - 100) * 0.22;
        const fh = 5 + 8 * sstep((x - 20) / 8) * sstep((80 - x) / 8);
        const hh = Math.max(0, crest - Math.pow(Math.max(0, Math.abs(z - 50) - fh) * 0.6, 1.25));
        return Math.min(hh, 11 + Math.max(0, Math.abs(x - 90) - 3) * 2.4);
    },
    top: (x, z) => x > 26 && x < 74 && Math.abs(z - 50) < 12 ? 'grass' : 'field',
    lines: [{ k: 'enemy', pts: [[156, 50], [102, 50]], dy: 2 }],
    labels: [{ x: 50, z: 50, s: '曲輪' }, { x: 90, z: 50, dy: 1, s: '堀切' }, { x: 135, z: 50, dy: 4, s: '尾根の続き', c: 's', oy: -10 }] },

  tatebori: { title: '竪堀', W: 160, D: 100, step: 1.6, yaw: -0.3, pitch: 0.55, cap: '斜面を斜め上から見た図',
    h: (x, z) => {
        let hh = slopeZ(z); const zt = sstep((z - 12) / 8) * sstep((80 - z) / 4);
        for (const c of [62, 98]) { const d = Math.abs(x - c); if (d < 6) hh -= 6 * (1 - (d / 6) ** 2) * zt; }
        return hh;
    },
    top: (x, z) => z >= 82 ? 'grass' : 'field',
    dots: [{ c: '#E53935', pts: [[98, 26], [98, 38], [98, 50], [98, 62]] }],
    lines: [{ k: 'enemy', pts: [[6, 40], [52, 40]], dy: 2 }, { k: 'shoot', pts: [[108, 88], [102, 68]], dy: 3 }],
    labels: [{ x: 80, z: 92, s: '曲輪' }, { x: 62, z: 30, dy: 0, s: '竪堀', ox: -30, oy: 12 },
             { x: 98, z: 44, dy: 1, s: '堀に沿って並ぶ敵', c: 's', ox: 58, oy: 6 }] },

  unejo: { title: '畝状竪堀群', W: 160, D: 100, step: 1.2, yaw: -0.3, pitch: 0.55, smooth: true, cap: '斜面を斜め上から見た図',
    h: (x, z) => {
        const zt = sstep((z - 12) / 8) * sstep((80 - z) / 4), gt = sstep((x - 26) / 4) * sstep((134 - x) / 4);
        const u = (x - 35) / 18, du = Math.abs(u - Math.round(u));
        const prof = du < .36 ? -6 * (1 - (du / .36) ** 2) : 1.5 * sstep((du - .36) / .1);
        return slopeZ(z) + prof * zt * gt;
    },
    top: (x, z) => z >= 82 ? 'grass' : 'field',
    lines: [{ k: 'enemy', pts: [[4, 34], [22, 34]], dy: 2 }, { k: 'enemy', pts: [[71, 16], [71, 60]], dy: 1.2 },
            { k: 'shoot', pts: [[71, 90], [71, 70]], dy: 3 }],
    labels: [{ x: 118, z: 93, s: '曲輪' }, { x: 35, z: 36, dy: 0, s: '竪堀', ox: -20, oy: 16 },
             { x: 116, z: 30, dy: 1, s: '畝（土塁）', c: 's', ox: 40, oy: 10 }] },

  yokobori: { title: '横堀', W: 160, D: 112, step: 1.2, yaw: -0.35, pitch: 0.62, smooth: true,
    h: (x, z) => {
        const r = Math.hypot((x - 80) / 74, (z - 56) / 48);
        let hh = r <= .3 ? 32 : 32 * Math.pow(1 - clamp((r - .3) / .72, 0, 1), 1.5);
        const dr = Math.abs(r - .5); if (dr < .09) hh -= 6.5 * (1 - (dr / .09) ** 2);
        const dx = Math.abs(x - 80);
        if (z < 56 && r > .5 && dx < 5) hh -= 4 * (1 - (dx / 5) ** 2) * sstep((r - .52) / .06) * sstep((.98 - r) / .1);
        return hh;
    },
    top: (x, z) => Math.hypot((x - 80) / 74, (z - 56) / 48) < .3 ? 'grass' : 'field',
    labels: [{ x: 80, z: 56, s: '曲輪' }, { x: 117, z: 56, dy: 0, s: '横堀', ox: 30, oy: -18 },
             { x: 80, z: 22, dy: 0, s: '竪堀', c: 's', ox: -36, oy: 6 }] },

  shoji: { title: '障子堀', W: 120, D: 100, step: 1.25, yaw: -0.5, pitch: 0.75,
    h: (x, z) => {
        let hh = trap(Math.abs(x - 60), 16, 25, 24, 3);
        if (Math.abs(x - 60) < 20) {
            const rg = d => d < 1.2 ? 17 : d < 3.7 ? lerp(17, 3, (d - 1.2) / 2.5) : 0;
            let r = rg(Math.abs(x - 60));
            for (const zz of [16, 46, 76]) if (x <= 61) r = Math.max(r, rg(Math.abs(z - zz)));
            for (const zz of [31, 61, 91]) if (x >= 59) r = Math.max(r, rg(Math.abs(z - zz)));
            hh = Math.max(hh, r);
        }
        return hh;
    },
    top: (x, z, h) => x < 35 ? 'grass' : x > 85 ? 'field' : h > 9 ? 'hl' : 'earth',
    labels: [{ x: 16, z: 50, s: '曲輪' }, { x: 104, z: 50, s: '城外', c: 's' },
             { x: 50, z: 46, dy: 1, s: '障子（堀障子）', ox: -8, oy: -30 }] },

  // ══ 曲輪 ══
  rinkaku: { title: '輪郭式（本丸・二の丸・三の丸）', W: 160, D: 100, step: 1.25, yaw: -0.4, pitch: 0.85,
    h: (x, z) => {
        if (inR(x, z, HON) >= 0) return 22;
        if (inR(x, z, M2) > 0) return ringH(x, z, HON, 22, M2, 18, 5);
        if (inR(x, z, NI) >= 0) return 18;
        if (inR(x, z, M1) > 0) return ringH(x, z, NI, 18, M1, 14, 3);
        if (inR(x, z, SAN) >= 0) return 14;
        const d = outR(x, z, SAN); return d < 1.5 ? lerp(14, 10, d / 1.5) : 10;
    },
    water: (x, z) => inR(x, z, M2) > 0 && inR(x, z, HON) < 0 ? 10 : inR(x, z, M1) > 0 && inR(x, z, NI) < 0 ? 8 : null,
    top: (x, z) => inR(x, z, SAN) < 0 ? 'field' : 'grass',
    steep: () => 'stone',
    labels: [{ x: 80, z: 50, s: '本丸' }, { x: 112, z: 27.5, dy: 1.5, s: '二の丸', c: 's' }, { x: 118, z: 10, dy: 1.5, s: '三の丸', c: 's' },
             { x: 134.5, z: 50, dy: .5, s: '堀', ox: 20, oy: -14 }] },

  koshi: { title: '腰曲輪', W: 160, D: 90, step: 1.6, yaw: -0.5, pitch: 0.55, smooth: true, cap: '山を斜め上から見た図（手前の切り口は断面）',
    h: (x, z) => polyline(KOSHI, x + 2.5 * Math.sin(z / 13)),
    top: (x, z) => {
        const u = x + 2.5 * Math.sin(z / 13);
        return (u >= 36 && u <= 50) || (u >= 111 && u <= 126) ? 'hl' : u > 61 && u < 99 ? 'grass' : 'field';
    },
    labels: [{ x: 80, z: 50, s: '主な曲輪' }, { x: 43, z: 50, s: '腰曲輪' }, { x: 118, z: 50, s: '腰曲輪' }] },

  // ══ 土塁・切岸 ══
  kirigishi: { title: '切岸', W: 160, D: 80, step: 1.6, yaw: -0.5, pitch: 0.5,
    h: x => x <= 58 ? 36 : x <= 72 ? lerp(36, 8, (x - 58) / 14) : lerp(8, 3, (x - 72) / 88),
    top: x => x < 58 ? 'grass' : 'field',
    fills: [{ c: 'rgba(144,164,174,.20)', pts: [[58, 0, 36], [160, 0, 12], [160, 80, 12], [58, 80, 36]] },
            { c: 'rgba(120,144,156,.30)', pts: [[58, 0, 36], [160, 0, 12], [160, 0, 3], [72, 0, 8]] }],
    lines: [{ k: 'ghost', pts: [[58, 0, 36], [160, 0, 12]] }, { k: 'ghost', pts: [[58, 80, 36], [160, 80, 12]] },
            { k: 'enemy', pts: [[154, 40], [82, 40]], dy: 2 }],
    labels: [{ x: 28, z: 40, s: '曲輪' }, { x: 66, z: 40, dy: 1, s: '切岸' }, { x: 125, z: 40, y: 25, s: '削る前の斜面', c: 's' }] },

  dorui: { title: '土塁の各部', W: 160, D: 70, step: 1.6, yaw: -0.45, pitch: 0.42, base: -4,
    h: x => 10 + 24 * (x < 45 ? 0 : x < 70 ? (x - 45) / 25 : x <= 100 ? 1 : x < 125 ? (125 - x) / 25 : 0),
    top: () => 'grass',
    lines: [{ k: 'dim', pts: [[45, 0, 5], [125, 0, 5]] }, { k: 'dim', pts: [[45, 0, 3], [45, 0, 7]] }, { k: 'dim', pts: [[125, 0, 3], [125, 0, 7]] }],
    dots: [{ c: '#C77700', pts: [[70, 0, 34], [100, 0, 34], [125, 0, 10]] }],
    labels: [{ x: 85, z: 35, s: '馬踏（褶）' }, { x: 56, z: 0, y: 22, s: '内法（城内側）', c: 's', ox: -46, oy: -6 },
             { x: 113, z: 0, y: 22, s: '外法（城外側）', c: 's', ox: 52, oy: -2 },
             { x: 100, z: 0, y: 34, s: '法肩', c: 's', ox: 14, oy: -20 }, { x: 125, z: 0, y: 10, s: '法尻', c: 's', ox: 26, oy: 12 },
             { x: 85, z: 0, y: 0.5, s: '敷（底辺）', c: 's' }, { x: 18, z: 40, s: '城内', c: 's' }, { x: 148, z: 40, s: '城外', c: 's' }] },

  dobashi: { title: '土橋', W: 160, D: 100, step: 1.6, yaw: -1.0, pitch: 0.6,
    h: (x, z) => {
        let hh = trap(Math.abs(z - 50), 8, 16, 24, 4); const cw = Math.abs(x - 80);
        if (Math.abs(z - 50) < 17) { if (cw < 7) hh = Math.max(hh, 23); else if (cw < 11) hh = Math.max(hh, lerp(23, 4, (cw - 7) / 4)); }
        const dzb = Math.abs(z - 72); if (dzb < 5) hh += 6 * (1 - (dzb / 5) ** 2) * sstep((cw - 9) / 3);
        return hh;
    },
    top: (x, z) => z > 66 ? 'grass' : z < 34 ? 'field' : Math.abs(x - 80) < 7 ? 'sand' : 'earth',
    lines: [{ k: 'route', pts: [[80, 4], [80, 92]], dy: 2 }],
    labels: [{ x: 30, z: 88, s: '曲輪' }, { x: 118, z: 72, dy: 2, s: '土塁', c: 's' }, { x: 30, z: 50, dy: 1, s: '堀' },
             { x: 80, z: 50, dy: 2, s: '土橋', ox: 30, oy: -14 }, { x: 125, z: 14, s: '城外', c: 's' }] },

  // ══ 虎口 ══
  uchimasu: { title: '内枡形', W: 160, D: 90, step: 2, yaw: -0.45, pitch: 0.8, base: 2,
    h: () => 10,
    top: (x, z) => z < 29 ? 'field' : x > 59 && x < 104 && z > 35 && z < 71 ? 'sand' : 'grass',
    boxes: [[0, 29, 65, 35, 10, 20, 'wall'], [80, 29, 160, 35, 10, 20, 'wall'], [53, 35, 59, 71, 10, 20, 'wall'],
            [53, 71, 110, 77, 10, 20, 'wall'], [104, 52, 110, 71, 10, 20, 'wall'], [104, 35, 110, 40, 10, 20, 'wall'],
            [65, 28, 67, 36, 10, 24, 'dark'], [78, 28, 80, 36, 10, 24, 'dark'], [103, 40, 111, 42, 10, 24, 'dark'], [103, 50, 111, 52, 10, 24, 'dark']],
    lines: [{ k: 'enemy', pts: [[72.5, 3], [72.5, 46], [150, 46]], dy: 1.5 },
            { k: 'shoot', pts: [[56, 62, 21], [68, 55, 11.5]] }, { k: 'shoot', pts: [[97, 74, 21], [92, 62, 11.5]] }],
    labels: [{ x: 86, z: 62, dy: 1, s: '枡形' }, { x: 135, z: 78, s: '曲輪' }, { x: 22, z: 12, s: '城外', c: 's' },
             { x: 72.5, z: 32, y: 24, s: '第一の門', c: 's', ox: -40, oy: 18 }, { x: 107, z: 46, y: 25, s: '第二の門', c: 's', ox: 30, oy: -10 }] },

  // ══ 櫓・天守 ══
  juso: { title: '平櫓・二重櫓・三重櫓', W: 170, D: 60, step: 4, yaw: -0.4, pitch: 0.32, h: () => 0, top: () => 'field', cap: '斜め前から見た図',
    build: A => {
        [[32, [[24, 16, 10]]], [85, [[26, 18, 10], [19, 13, 7]]], [138, [[28, 20, 10], [22, 15, 7], [16, 11, 6]]]].forEach(([cx, tiers]) => {
            A.base(cx, 30, 44, 32, 34, 24, 0, 10); A.tower(cx, 30, 10, tiers);
        });
    },
    labels: [{ x: 32, z: 8, y: 0, s: '平櫓' }, { x: 85, z: 8, y: 0, s: '二重櫓' }, { x: 138, z: 8, y: 0, s: '三重櫓' }] },

  toso: { title: '層塔型', W: 110, D: 80, step: 4, yaw: -0.45, pitch: 0.3, h: () => 0, top: () => 'field', cap: '斜め前から見た図',
    build: A => { A.base(55, 40, 72, 56, 58, 44, 0, 12); A.tower(55, 40, 12, [[48, 36, 11], [41, 30, 9], [34, 25, 8], [27, 20, 7], [20, 15, 7]], 9); },
    labels: [{ x: 55, z: 5, y: 0, s: '上の階ほど順に小さくなる', c: 's', oy: 16 }] },

  // ══ 門 ══
  yaguramon: { title: '櫓門', W: 160, D: 60, step: 4, yaw: -0.45, pitch: 0.34, h: () => 0, top: () => 'field', cap: '斜め前から見た図',
    build: A => {
        // 奥の部品から順に作る（扉 → 石垣 → 櫓 → 屋根）
        A.box(80, 31, 98, 32, 0, 17, 'door'); A.box(62, 31, 80, 32, 0, 17, 'door');
        A.box(60, 30, 100, 34, 17, 22, 'wood');
        const R = A.prism([[100, 0, 17], [160, 0, 17], [160, 0, 42], [100, 0, 42]], [[100, 22, 22], [160, 22, 22], [160, 22, 42], [100, 22, 42]], 'mortar', 'grass');
        const L = A.prism([[0, 0, 17], [60, 0, 17], [60, 0, 42], [0, 0, 42]], [[0, 22, 22], [60, 22, 22], [60, 22, 42], [0, 22, 42]], 'mortar', 'grass');
        A.stones(L[0], 60, MORTAR_H(22, 5), 11); A.stones(R[0], 60, MORTAR_H(22, 5), 12); A.stones(R[3], 22, 22, 14);
        const body = A.box(38, 24, 122, 40, 22, 34, 'plaster');
        A.windows(body[0], 7); A.windows(body[1], 2); A.windows(body[3], 2);
        A.hip(80, 32, 94, 26, 33, 10, 30, .01);
    },
    labels: [{ x: 110, z: 24, y: 30, s: '櫓', ox: 34, oy: -26 }, { x: 22, z: 19, y: 10, s: '石垣' }, { x: 88, z: 31, y: 8, s: '門', ox: 40, oy: 22 }] },

  korai: { title: '高麗門', W: 120, D: 70, step: 4, yaw: Math.PI + 0.6, pitch: 0.5, h: () => 0, top: () => 'field', cap: '内側（控柱の側）から斜めに見た図',
    build: A => {
        // 内側の左奥から見るので、遠い部品（右の土塀・外側の扉）から順に作る
        A.box(80, 28, 120, 32, 0, 11, 'plaster'); A.gable(100, 30, 42, 8, 11, 3, 'x');
        A.box(46, 29.5, 60, 30.5, 0, 21, 'door'); A.box(60, 29.5, 74, 30.5, 0, 21, 'door');
        A.box(74, 28, 78, 32, 0, 26, 'wood'); A.box(42, 28, 46, 32, 0, 26, 'wood');
        A.box(40, 28.5, 80, 31.5, 22, 25, 'wood');
        A.gable(60, 30, 48, 12, 25, 5, 'x');
        A.box(0, 28, 40, 32, 0, 11, 'plaster'); A.gable(20, 30, 42, 8, 11, 3, 'x');
        A.box(75, 32, 77, 44, 12, 14, 'wood'); A.box(43, 32, 45, 44, 12, 14, 'wood');
        A.box(74.5, 44, 77.5, 47, 0, 17, 'wood'); A.box(42.5, 44, 45.5, 47, 0, 17, 'wood');
        A.gable(76, 40, 10, 16, 17, 3.5, 'z'); A.gable(44, 40, 10, 16, 17, 3.5, 'z');
    },
    labels: [{ x: 60, z: 30, y: 29, s: '小さな屋根', c: 's', ox: 56, oy: -8 }, { x: 76, z: 45.5, y: 6, s: '控柱', c: 's', ox: -40, oy: 14 },
             { x: 44, z: 40, y: 20, s: '控柱の屋根', c: 's', ox: 44, oy: -18 }, { x: 76, z: 30, y: 20, s: '鏡柱', c: 's', ox: -44, oy: -18 }] },

  // ══ 石垣 ══
  nozura: { title: '野面積み', W: 140, D: 70, step: 4, yaw: -0.35, pitch: 0.3, h: () => 0, top: () => 'field', cap: '石垣を斜め前から見た図',
    build: A => {
        const s = A.prism([[0, 0, 16], [140, 0, 16], [140, 0, 70], [0, 0, 70]], [[0, 38, 28], [140, 38, 28], [140, 38, 70], [0, 38, 70]], 'mortar', 'grass');
        A.stones(s[0], 140, MORTAR_H(38, 12), 7); A.stones(s[3], 54, 38, 8);
    },
    labels: [{ x: 70, z: 50, y: 38, s: '曲輪' }] },

  // ══ 塀・建物 ══
  hazama: { title: '土塀と狭間', W: 140, D: 60, step: 4, yaw: -0.35, pitch: 0.3, h: () => 0, top: () => 'field', cap: '土塀を斜め外から見た図',
    build: A => {
        const st = A.prism([[0, 0, 18], [140, 0, 18], [140, 0, 40], [0, 0, 40]], [[0, 14, 22], [140, 14, 22], [140, 14, 40], [0, 14, 40]], 'mortar', 'grass');
        A.stones(st[0], 140, MORTAR_H(14, 4), 21); A.stones(st[3], 22, 14, 22);
        const w = A.box(0, 26, 140, 31, 14, 30, 'plaster');
        A.gable(70, 28.5, 142, 11, 30, 4, 'x');
        const D = hexRgb('#37474F'), Wu = 140, Hu = 16;
        const rect = (x, hw, y0, y1) => ({ uv: [[(x - hw) / Wu, y0 / Hu], [(x + hw) / Wu, y0 / Hu], [(x + hw) / Wu, y1 / Hu], [(x - hw) / Wu, y1 / Hu]], rgb: D });
        const circ = (x, r) => ({ uv: Array.from({ length: 12 }, (_, k) => [(x + Math.cos(k / 12 * Math.PI * 2) * r) / Wu, (8 + Math.sin(k / 12 * Math.PI * 2) * r) / Hu]), rgb: D });
        A.decal(w[0], [rect(17, .7, 4, 12), rect(70, .7, 4, 12), circ(42, 1.7),
                       { uv: [[90.2 / Wu, 6.2 / Hu], [94.2 / Wu, 6.2 / Hu], [92.2 / Wu, 9.8 / Hu]], rgb: D }, rect(115, 1.5, 6.5, 9.5)]);
    },
    labels: [{ x: 17, z: 26, y: 26, s: '矢狭間（縦長）', c: 's', ox: 8, oy: -26 }, { x: 92, z: 26, y: 24, s: '鉄砲狭間（丸・三角・四角）', c: 's', oy: -30 },
             { x: 70, z: 20, y: 7, s: '石垣', c: 's' }] },

  // ══ 井戸・水利 ══
  ido: { title: '井戸', W: 100, D: 60, step: 1, yaw: -0.3, pitch: 0.5, smooth: true, groupsByDepth: true,
    h: (x, z) => { const r = Math.hypot(x - 50, z); return r < 5.5 ? -34 : r < 6.5 ? lerp(-34, 0, r - 5.5) : 0; },
    water: (x, z) => Math.hypot(x - 50, z) < 5.5 ? -24 : null,
    top: () => 'grass', steep: (x, z) => Math.hypot(x - 50, z) < 8 ? 'stone' : 'earth',
    build: A => {
        // 井戸枠。手前半分は切り口で切れているので、奥の半円だけ
        const N = 12, at = (r, a, y) => [50 + Math.cos(a) * r, y, Math.sin(a) * r];
        for (let k = 0; k < N; k++) {
            const a0 = k / N * Math.PI, a1 = (k + 1) / N * Math.PI;
            A.prism([at(6.5, a0, 0), at(8.8, a0, 0), at(8.8, a1, 0), at(6.5, a1, 0)], [at(6.5, a0, 4), at(8.8, a0, 4), at(8.8, a1, 4), at(6.5, a1, 4)], 'stone');
        }
    },
    labels: [{ x: 22, z: 40, s: '曲輪' }, { x: 57, z: 6, y: 3.5, s: '井戸', ox: 34, oy: -16 }, { x: 50, z: 0, y: -29, s: '水', c: 's', ox: 34 }] },

  // ══ 曲輪（置かれた位置・形・縄張り） ══
  houi: { title: '東西南北の丸', W: 160, D: 100, step: 1.25, yaw: -0.4, pitch: 0.85,
    h: (x, z) => platH(x, z, HOUI, houiBot(x, z)),
    water: (x, z) => inR(x, z, HOUI_OUT) > 0 && platH(x, z, HOUI, houiBot(x, z)) < 9.5 ? 11 : null,
    top: (x, z) => inR(x, z, HOUI_OUT) < 0 ? 'field' : 'grass',
    steep: () => 'stone',
    lines: [{ k: 'move', pts: [[150, 16, 12], [150, 84, 12]] }],
    labels: [{ x: 80, z: 50, dy: 1, s: '本丸' }, { x: 80, z: 80, dy: 1, s: '北の丸', c: 's' }, { x: 80, z: 20, dy: 1, s: '南の丸', c: 's' },
             { x: 126, z: 50, dy: 1, s: '東の丸', c: 's' }, { x: 34, z: 50, dy: 1, s: '西の丸', c: 's' },
             { x: 150, z: 88, y: 12, s: '北', c: 's' }] },

  obi: { title: '帯曲輪', W: 160, D: 112, step: 1.2, yaw: -0.4, pitch: 0.6, smooth: true,
    h: (x, z) => {
        const r = Math.hypot((x - 80) / 72, (z - 56) / 46);
        if (r < .34) return 32;
        if (r < .40) return lerp(32, 24, (r - .34) / .06);
        if (r < .56) return 24;
        return 24 * Math.pow(1 - clamp((r - .56) / .44, 0, 1), 1.4);
    },
    top: (x, z) => { const r = Math.hypot((x - 80) / 72, (z - 56) / 46); return r < .34 ? 'grass' : r < .58 ? 'hl' : 'field'; },
    labels: [{ x: 80, z: 56, s: '主な曲輪' }, { x: 116, z: 56, dy: 0, s: '帯曲輪', ox: 28, oy: -18 }] },

  sakuhei: { title: '削平地', W: 160, D: 110, step: 1.3, yaw: -0.4, pitch: 0.55, smooth: true,
    h: (x, z) => Math.min(46 * (1 - clamp(Math.hypot((x - 80) / 46, (z - 58) / 30), 0, 1)), 26),
    top: (x, z) => Math.hypot((x - 80) / 46, (z - 58) / 30) < .44 ? 'hl' : 'field',
    // 削る前の山を、薄い色の面で重ねる
    fills: Array.from({ length: 16 }, (_, k) => {
        const p = t => [80 + Math.cos(t) * 20, 58 + Math.sin(t) * 13, 26];
        return { c: 'rgba(120,144,156,.25)', pts: [[80, 58, 46], p(k / 16 * Math.PI * 2), p((k + 1) / 16 * Math.PI * 2)] };
    }),
    lines: [{ k: 'ghost', pts: [[80, 58, 46], [100, 58, 26]] }, { k: 'ghost', pts: [[80, 58, 46], [60, 58, 26]] }],
    labels: [{ x: 80, z: 58, dy: 1, s: '削平地' }, { x: 80, z: 58, y: 42, s: '削る前の山', c: 's', ox: 54, oy: -4 }] },

  demaru: { title: '出丸', W: 176, D: 110, step: 1.35, yaw: -0.4, pitch: 0.82,
    h: (x, z) => platH(x, z, DEMARU, moatBot(x, z, DEMARU_MOAT, 4, 8)),
    water: (x, z) => platH(x, z, DEMARU, moatBot(x, z, DEMARU_MOAT, 4, 8)) < 6.5 ? 7 : null,
    top: (x, z, h) => h > 12 ? 'grass' : 'field',
    steep: () => 'stone',
    lines: [{ k: 'route', pts: [[100, 56, 15], [124, 56, 14]] }],
    labels: [{ x: 60, z: 56, dy: 1, s: '本丸' }, { x: 60, z: 30, dy: 1, s: '城の本体', c: 's' }, { x: 139, z: 56, dy: 1, s: '出丸' },
             { x: 139, z: 22, y: 8, s: '離れて独立している', c: 's' }] },

  sute: { title: '捨曲輪', W: 160, D: 112, step: 1.2, yaw: -0.35, pitch: 0.55, smooth: true,
    h: (x, z) => {
        const r = Math.hypot((x - 80) / 70, (z - 66) / 44);
        let hh = r < .32 ? 30 : 30 * Math.pow(1 - clamp((r - .32) / .68, 0, 1), 1.3);
        const d = outR(x, z, SUTE);
        if (d < 2) hh = Math.max(hh, lerp(13, 6, d / 2));
        return hh;
    },
    top: (x, z) => outR(x, z, SUTE) === 0 ? 'hl' : Math.hypot((x - 80) / 70, (z - 66) / 44) < .32 ? 'grass' : 'field',
    lines: [{ k: 'move', pts: [[80, 52], [80, 40]], dy: 2 }, { k: 'enemy', pts: [[26, 6], [58, 22]], dy: 2 }, { k: 'enemy', pts: [[134, 6], [102, 22]], dy: 2 }],
    labels: [{ x: 80, z: 70, s: '主郭' }, { x: 80, z: 32, dy: 1, s: '捨曲輪' }, { x: 104, z: 44, dy: 2, s: '打って出る', c: 's', ox: 44, oy: 2 }] },

  kakuuma: { title: '馬出（角馬出）', W: 160, D: 100, step: 1.25, yaw: -0.4, pitch: 0.8,
    h: (x, z) => {
        if (z >= 64.5) return platH(x, z, KUMA_BACK, 4);
        const b = Math.abs(x - 80);
        if (z >= 46) return b < 7 ? 17 : b < 10 ? lerp(17, 4, (b - 7) / 3) : 4;
        // 馬出の左右は堀を掘らずに残し、城外へ下りる出入口にする
        if (z > 34 && x > 44 && x <= 57.5) return lerp(8, 16, clamp((x - 46) / 10, 0, 1));
        if (z > 34 && x >= 102.5 && x < 116) return lerp(16, 8, clamp((x - 104) / 10, 0, 1));
        const d = outR(x, z, KUMA_UMA);
        if (d < 1.5) return lerp(16, 4, d / 1.5);
        return moatBot(x, z, KUMA_MOAT, 4, 8);
    },
    top: (x, z, h) => z > 34 && z < 46 && ((x > 44 && x < 58) || (x > 102 && x < 116)) ? 'sand'
        : h > 15 ? (z >= 64.5 ? 'grass' : outR(x, z, KUMA_UMA) === 0 ? 'hl' : 'sand') : h < 6 ? 'earth' : 'field',
    lines: [{ k: 'move', pts: [[80, 88], [80, 36]], dy: 2 }, { k: 'move', pts: [[76, 40], [52, 40], [38, 40]], dy: 2 },
            { k: 'move', pts: [[84, 40], [108, 40], [122, 40]], dy: 2 }],
    labels: [{ x: 28, z: 84, s: '曲輪' }, { x: 30, z: 56, dy: 1, s: '堀' }, { x: 80, z: 26, dy: 1, s: '角馬出' },
             { x: 80, z: 56, dy: 2, s: '土橋', c: 's', ox: 34, oy: -12 }, { x: 140, z: 6, s: '城外', c: 's' },
             { x: 51, z: 40, dy: 2, s: '出入口', c: 's', ox: -30, oy: 18 }, { x: 109, z: 40, dy: 2, s: '出入口', c: 's', ox: 34, oy: -18 }] },

  maruuma: { title: '丸馬出・三日月堀', W: 160, D: 100, step: 1.2, yaw: -0.4, pitch: 0.8,
    h: (x, z) => {
        if (z >= 64.5) return platH(x, z, KUMA_BACK, 4);
        const b = Math.abs(x - 80);
        if (z >= 48) return b < 7 ? 17 : b < 10 ? lerp(17, 4, (b - 7) / 3) : 4;
        const r = Math.hypot(x - 80, (z - 48) * 1.15);
        if (r < 24) return 16;
        // 三日月堀の両端は掘らずに残し、馬出の左右から城外へ下りる出入口にする
        if (z > 38 && r < 40.5) return lerp(16, 8, clamp((r - 24) / 16, 0, 1));
        if (r < 26.5) return lerp(16, 4, (r - 24) / 2.5);
        if (r < 38) return 4;
        if (r < 40.5) return lerp(4, 8, (r - 38) / 2.5);
        return 8;
    },
    top: (x, z, h) => {
        const r = Math.hypot(x - 80, (z - 48) * 1.15);
        if (z > 38 && z < 48 && r >= 24 && r < 40.5) return 'sand';
        return h > 15 ? (z >= 64.5 ? 'grass' : r < 24 ? 'hl' : 'sand') : h < 6 ? 'earth' : 'field';
    },
    lines: [{ k: 'move', pts: [[80, 88], [80, 36]], dy: 2 }, { k: 'move', pts: [[76, 42], [56, 43], [42, 44]], dy: 2 },
            { k: 'move', pts: [[84, 42], [104, 43], [118, 44]], dy: 2 }],
    labels: [{ x: 26, z: 84, s: '曲輪' }, { x: 80, z: 30, dy: 1, s: '丸馬出' }, { x: 80, z: 12, dy: 1, s: '三日月堀' },
             { x: 80, z: 56, dy: 2, s: '土橋', c: 's', ox: 36, oy: -10 },
             { x: 49, z: 44, dy: 2, s: '出入口', c: 's', ox: -30, oy: 18 }, { x: 111, z: 44, dy: 2, s: '出入口', c: 's', ox: 30, oy: 18 }] },

  renkaku: { title: '連郭式', W: 176, D: 96, step: 1.3, yaw: -0.55, pitch: 0.6, smooth: true,
    h: (x, z) => {
        const crest = polyline(RENKAKU, x);
        const fh = 5 + 7 * sstep((x - 12) / 10) * sstep((166 - x) / 10);
        const hh = Math.max(0, crest - Math.pow(Math.max(0, Math.abs(z - 48) - fh) * 0.62, 1.25));
        const cut = Math.min(12 + Math.max(0, Math.abs(x - 62) - 3) * 2.4, 12 + Math.max(0, Math.abs(x - 113) - 3) * 2.4);
        return Math.min(hh, cut);
    },
    top: (x, z) => Math.abs(z - 48) < 12 && ((x > 26 && x < 52) || (x > 70 && x < 104) || (x > 122 && x < 156)) ? 'grass' : 'field',
    labels: [{ x: 39, z: 48, dy: 1, s: '三の丸', c: 's' }, { x: 87, z: 48, dy: 1, s: '二の丸', c: 's' }, { x: 139, z: 48, dy: 1, s: '本丸' },
             { x: 62, z: 62, dy: 1, s: '堀切', c: 's' }, { x: 113, z: 62, dy: 1, s: '堀切', c: 's' }] },

  teikaku: { title: '梯郭式', W: 160, D: 112, step: 1.25, yaw: -0.4, pitch: 0.85,
    h: (x, z) => z > 96 ? 2 : platH(x, z, TEIKAKU, 10),
    water: (x, z) => z > 94 ? 8 : null,
    top: (x, z, h) => h > 11 ? 'grass' : 'field',
    steep: () => 'stone',
    labels: [{ x: 120, z: 78, dy: 1, s: '本丸' }, { x: 75, z: 52, dy: 1, s: '二の丸', c: 's' }, { x: 40, z: 28, dy: 1, s: '三の丸', c: 's' },
             { x: 60, z: 104, y: 8, s: '川・海・山など（背後）', c: 's' }] },

  kaikaku: { title: '階郭式', W: 170, D: 96, step: 1.3, yaw: -0.45, pitch: 0.55, smooth: true,
    h: (x, z) => Math.max(0, polyline(KAIKAKU, x) - Math.pow(Math.max(0, Math.abs(z - 48) - 20) * .6, 1.3)),
    top: (x, z) => Math.abs(z - 48) < 24 ? 'grass' : 'field',
    labels: [{ x: 26, z: 48, dy: 1, s: '三の丸', c: 's' }, { x: 60, z: 48, dy: 1, s: '二の丸', c: 's' },
             { x: 98, z: 48, dy: 1, s: '曲輪', c: 's' }, { x: 140, z: 48, dy: 1, s: '本丸' }] },

  ritchi: { title: '山城・平山城・平城', W: 210, D: 90, step: 1.6, yaw: -0.3, pitch: 0.35, smooth: true,
    h: (x, z) => {
        const bump = (cx, cz, rx, rz, hgt) => {
            const r = Math.hypot((x - cx) / rx, (z - cz) / rz);
            return r >= 1 ? 0 : hgt * Math.pow(Math.cos(r * Math.PI / 2), 1.3);
        };
        return Math.max(Math.min(bump(40, 50, 38, 30, 52), 40), Math.min(bump(112, 50, 34, 26, 24), 17), 0);
    },
    top: () => 'field',
    build: A => {
        A.base(40, 50, 26, 20, 20, 15, 40, 6); A.tower(40, 50, 46, [[14, 10, 7]], 6);
        A.base(112, 50, 26, 20, 20, 15, 17, 6); A.tower(112, 50, 23, [[14, 10, 7]], 6);
        A.base(180, 50, 30, 24, 24, 18, 0, 7); A.tower(180, 50, 7, [[16, 12, 8], [11, 8, 6]], 7);
    },
    labels: [{ x: 40, z: 8, y: 0, s: '山城' }, { x: 112, z: 8, y: 0, s: '平山城' }, { x: 180, z: 8, y: 0, s: '平城' }] },

  // ══ 門 ══
  kabuki: { title: '冠木門', W: 120, D: 60, step: 4, yaw: -0.45, pitch: 0.32, h: () => 0, top: () => 'field', cap: '斜め前から見た図',
    build: A => {
        A.box(76, 28, 120, 32, 0, 12, 'plaster'); A.gable(98, 30, 46, 8, 12, 3, 'x');
        A.box(0, 28, 44, 32, 0, 12, 'plaster'); A.gable(22, 30, 46, 8, 12, 3, 'x');
        A.box(46, 27, 52, 33, 0, 26, 'wood'); A.box(68, 27, 74, 33, 0, 26, 'wood');
        A.box(42, 28, 78, 32, 21, 25, 'wood');
    },
    labels: [{ x: 60, z: 28, y: 23, s: '冠木（横木）', c: 's', ox: 44, oy: -14 }, { x: 49, z: 27, y: 12, s: '鏡柱', c: 's', ox: -34, oy: 8 }] },

  yakui: { title: '薬医門', W: 120, D: 76, step: 4, yaw: -0.6, pitch: 0.4, h: () => 0, top: () => 'field', cap: '斜め前から見た図',
    build: A => {
        A.box(78, 30, 120, 34, 0, 12, 'plaster'); A.gable(99, 32, 44, 8, 12, 3, 'x');
        A.box(0, 30, 42, 34, 0, 12, 'plaster'); A.gable(21, 32, 44, 8, 12, 3, 'x');
        A.box(44, 46, 49, 51, 0, 20, 'wood'); A.box(71, 46, 76, 51, 0, 20, 'wood');
        A.box(46, 31, 60, 33, 0, 21, 'door'); A.box(60, 31, 74, 33, 0, 21, 'door');
        A.box(44, 29, 50, 35, 0, 26, 'wood'); A.box(70, 29, 76, 35, 0, 26, 'wood');
        A.box(42, 30, 78, 34, 22, 25, 'wood');
        A.gable(60, 38, 56, 34, 26.5, 9, 'x');
    },
    labels: [{ x: 47, z: 29, y: 10, s: '鏡柱（前）', c: 's', ox: -40, oy: 8 }, { x: 73, z: 48, y: 8, s: '控柱（後ろ）', c: 's', ox: 44, oy: 10 },
             { x: 60, z: 38, y: 35, s: '大きな屋根', c: 's', ox: 44, oy: -8 }] },

  munemon: { title: '棟門', W: 120, D: 60, step: 4, yaw: -0.5, pitch: 0.38, h: () => 0, top: () => 'field', cap: '斜め前から見た図',
    build: A => {
        A.box(70, 28, 120, 33, 0, 14, 'plaster'); A.gable(95, 30.5, 52, 10, 14, 3.5, 'x');
        A.box(0, 28, 50, 33, 0, 14, 'plaster'); A.gable(25, 30.5, 52, 10, 14, 3.5, 'x');
        A.box(54, 30, 60, 32, 0, 19, 'door'); A.box(60, 30, 66, 32, 0, 19, 'door');
        A.box(52, 28, 58, 34, 0, 24, 'wood'); A.box(62, 28, 68, 34, 0, 24, 'wood');
        A.gable(60, 31, 30, 16, 24, 6, 'x');
    },
    lines: [{ k: 'ghost', pts: [[66, 44, 0], [66, 44, 16]] }],
    labels: [{ x: 55, z: 28, y: 10, s: '本柱', c: 's', ox: -34, oy: 8 }, { x: 66, z: 44, y: 16, s: '控柱は無い', c: 's', ox: 46, oy: -6 }] },

  nagaya: { title: '長屋門', W: 180, D: 60, step: 4, yaw: -0.4, pitch: 0.34, h: () => 0, top: () => 'field', cap: '斜め前から見た図',
    build: A => {
        const b = A.box(10, 26, 170, 40, 0, 20, 'plaster');
        A.rects(b[0], [[.16, .28, .3, .66], [.7, .28, .84, .66]], '#EDE7DA');
        A.rects(b[0], [[.4, 0, .6, .8]], '#8D6E63');
        A.rects(b[0], [[.63, 0, .68, .58]], '#8D6E63');
        A.hip(90, 33, 174, 26, 19, 10, 120, 8);
    },
    labels: [{ x: 47, z: 26, y: 14, s: '門番などの部屋', c: 's', oy: -24 }, { x: 140, z: 26, y: 14, s: '家来の部屋', c: 's', oy: -24 },
             { x: 90, z: 26, y: 3, s: '大扉', c: 's', ox: -18, oy: 18 }, { x: 115, z: 26, y: 3, s: '潜戸', c: 's', ox: 32, oy: 14 }] },

  uzumi: { title: '埋門', W: 150, D: 60, step: 4, yaw: -0.4, pitch: 0.32, h: () => 0, top: () => 'field', cap: '斜め前から見た図',
    build: A => {
        A.box(62, 34, 88, 35, 0, 15, 'door');
        const R = A.prism([[88, 0, 20], [150, 0, 20], [150, 0, 46], [88, 0, 46]], [[88, 22, 25], [150, 22, 25], [150, 22, 46], [88, 22, 46]], 'mortar', 'grass');
        const L = A.prism([[0, 0, 20], [62, 0, 20], [62, 0, 46], [0, 0, 46]], [[0, 22, 25], [62, 22, 25], [62, 22, 46], [0, 22, 46]], 'mortar', 'grass');
        A.stones(L[0], 62, MORTAR_H(22, 5), 41); A.stones(R[0], 62, MORTAR_H(22, 5), 42); A.stones(R[3], 26, 22, 43);
        const M = A.box(62, 22, 88, 46, 15, 22, 'mortar', 'grass'); A.stones(M[0], 26, 7, 44);
        A.box(0, 28, 150, 33, 22, 32, 'plaster');
        A.gable(75, 30.5, 152, 11, 32, 4, 'x');
    },
    labels: [{ x: 75, z: 34, y: 8, s: '埋門', ox: 42, oy: 20 }, { x: 22, z: 20, y: 10, s: '石垣', c: 's' },
             { x: 120, z: 28, y: 27, s: '土塀', c: 's', ox: 40, oy: -14 }] },

  masugatamon: { title: '枡形門', W: 176, D: 116, step: 4, yaw: -0.4, pitch: 0.62,
    h: () => 10, top: (x, z) => z < 30 ? 'field' : z > 74 ? 'grass' : x > 66 && x < 110 ? 'sand' : 'grass', cap: '斜め上から見た図',
    build: A => {
        // 外側（手前）の高麗門 → 枡形 → 内側の櫓門 の順に奥へ
        A.box(0, 30, 74, 36, 10, 22, 'wall'); A.box(102, 30, 176, 36, 10, 22, 'wall');
        A.box(74, 29, 78, 37, 10, 26, 'wood'); A.box(98, 29, 102, 37, 10, 26, 'wood');
        A.gable(88, 33, 34, 14, 26, 5, 'x');
        A.box(60, 36, 66, 74, 10, 22, 'wall'); A.box(110, 36, 116, 74, 10, 22, 'wall');
        const L = A.box(20, 74, 74, 86, 10, 24, 'mortar', 'grass'); A.stones(L[0], 54, 14, 51);
        const R = A.box(102, 74, 156, 86, 10, 24, 'mortar', 'grass'); A.stones(R[0], 54, 14, 52);
        A.box(74, 78, 102, 82, 10, 24, 'door');
        const body = A.box(34, 72, 142, 88, 24, 34, 'plaster'); A.windows(body[0], 8);
        A.hip(88, 80, 118, 26, 33, 9, 40, .01);
    },
    labels: [{ x: 88, z: 33, y: 30, s: '高麗門', c: 's', ox: -48, oy: 12 }, { x: 88, z: 80, y: 37, s: '櫓門', ox: 40, oy: -22 },
             { x: 88, z: 56, y: 10, dy: 1, s: '枡形' }, { x: 150, z: 104, y: 10, dy: 1, s: '曲輪', c: 's' }, { x: 26, z: 14, y: 10, dy: 1, s: '城外', c: 's' }] },

  ote: { title: '大手門・搦手門', W: 170, D: 124, step: 1.6, yaw: -0.35, pitch: 0.78,
    h: (x, z) => {
        if (Math.abs(x - 86) < 7 && outR(x, z, OTE_PLAT[0][0]) > 0 && inR(x, z, OTE_MOAT[0]) > 0) return 16.5;
        return platH(x, z, OTE_PLAT, moatBot(x, z, OTE_MOAT, 4, 8));
    },
    water: (x, z) => {
        if (Math.abs(x - 86) < 7 && outR(x, z, OTE_PLAT[0][0]) > 0 && inR(x, z, OTE_MOAT[0]) > 0) return null;
        return platH(x, z, OTE_PLAT, moatBot(x, z, OTE_MOAT, 4, 8)) < 6.5 ? 7 : null;
    },
    top: (x, z, h) => h >= 17.5 ? 'grass' : h > 12 ? 'sand' : 'field',
    steep: () => 'stone',
    build: A => {
        A.box(76, 84, 96, 88, 18, 28, 'wood'); A.gable(86, 86, 26, 12, 28, 4, 'x');
        const L = A.box(58, 30, 74, 40, 18, 26, 'mortar', 'grass'); A.stones(L[0], 16, 10, 61);
        const R = A.box(98, 30, 114, 40, 18, 26, 'mortar', 'grass'); A.stones(R[0], 16, 10, 62);
        A.box(74, 33, 98, 37, 18, 25, 'door');
        const body = A.box(54, 29, 118, 41, 26, 34, 'plaster'); A.windows(body[0], 5);
        A.hip(86, 35, 72, 20, 33, 8, 24, .01);
    },
    labels: [{ x: 86, z: 29, y: 40, s: '大手（正面口）の門', ox: -96, oy: 34 }, { x: 86, z: 86, y: 32, s: '搦手（裏口）の門', c: 's', ox: 92, oy: -16 },
             { x: 62, z: 84, dy: 1, s: '本丸' }] },

  ichiku: { title: '移築門', W: 200, D: 76, step: 4, yaw: -0.4, pitch: 0.34, h: () => 0, top: () => 'field', cap: '城から移された門',
    build: A => {
        const S = A.prism([[0, 0, 26], [70, 0, 26], [70, 0, 52], [0, 0, 52]], [[0, 24, 31], [70, 24, 31], [70, 24, 52], [0, 24, 52]], 'mortar', 'grass');
        A.stones(S[0], 70, MORTAR_H(24, 5), 71); A.stones(S[3], 26, 24, 72);
        A.box(150, 26, 200, 44, 0, 20, 'plaster'); A.hip(175, 35, 56, 26, 19, 9, 24, .01);
        A.box(121, 30, 129, 32, 0, 19, 'door'); A.box(129, 30, 137, 32, 0, 19, 'door');
        A.box(116, 28, 121, 34, 0, 24, 'wood'); A.box(137, 28, 142, 34, 0, 24, 'wood');
        A.gable(129, 31, 34, 16, 24, 6, 'x');
    },
    lines: [{ k: 'move', pts: [[74, 40, 32], [110, 40, 32]] }],
    labels: [{ x: 30, z: 26, y: 12, s: '城' }, { x: 175, z: 26, y: 14, s: '寺など', c: 's', oy: -22 },
             { x: 92, z: 40, y: 36, s: '移築', c: 's' }, { x: 129, z: 28, y: 8, s: '移された門', c: 's', ox: -38, oy: 16 }] },

  // ══ 櫓 ══
  tamon: { title: '多聞櫓', W: 200, D: 64, step: 4, yaw: -0.4, pitch: 0.32, h: () => 0, top: () => 'field', cap: '斜め前から見た図',
    build: A => {
        const S = A.prism([[0, 0, 20], [200, 0, 20], [200, 0, 48], [0, 0, 48]], [[0, 16, 24], [200, 16, 24], [200, 16, 48], [0, 16, 48]], 'mortar', 'grass');
        A.stones(S[0], 200, MORTAR_H(16, 4), 81); A.stones(S[3], 28, 16, 82);
        const b = A.box(26, 26, 174, 40, 16, 27, 'plaster'); A.windows(b[0], 12); A.windows(b[3], 1);
        A.hip(100, 33, 156, 22, 26, 8, 110, 6);
        A.tower(14, 33, 16, [[22, 16, 9], [15, 11, 7]], 7);
        A.tower(186, 33, 16, [[22, 16, 9], [15, 11, 7]], 7);
    },
    labels: [{ x: 100, z: 26, y: 24, s: '多聞櫓（長屋状の櫓）', ox: 0, oy: -26 }, { x: 60, z: 20, y: 7, s: '石垣', c: 's' }] },

  jubako: { title: '重箱櫓', W: 170, D: 60, step: 4, yaw: -0.4, pitch: 0.32, h: () => 0, top: () => 'field', cap: '斜め前から見た図',
    build: A => {
        A.base(45, 30, 44, 32, 34, 24, 0, 10); A.tower(45, 30, 10, [[26, 18, 10], [19, 13, 8]]);
        A.base(125, 30, 44, 32, 34, 24, 0, 10); A.tower(125, 30, 10, [[26, 18, 10], [26, 18, 9]]);
    },
    labels: [{ x: 45, z: 8, y: 0, s: 'ふつうの二重櫓', c: 's' }, { x: 125, z: 8, y: 0, s: '重箱櫓' }] },

  sumi: { title: '隅櫓', W: 176, D: 124, step: 4, yaw: -0.4, pitch: 0.7,
    h: (x, z) => platH(x, z, SUMI, 6), top: (x, z, h) => h > 8 ? 'grass' : 'field', steep: () => 'stone',
    build: A => {
        [[36, 96], [140, 96], [36, 34], [140, 34]].forEach(([cx, cz]) => {
            A.base(cx, cz, 30, 30, 24, 24, 12, 7); A.tower(cx, cz, 19, [[18, 18, 9]], 7);
        });
    },
    lines: [{ k: 'move', pts: [[166, 30, 13], [166, 104, 13]] }],
    labels: [{ x: 88, z: 64, dy: 1, s: '曲輪' }, { x: 36, z: 96, y: 38, s: '隅櫓', c: 's', ox: -34, oy: -8 },
             { x: 140, z: 34, y: 38, s: '巽（辰巳）櫓', c: 's', ox: 26, oy: 18 }, { x: 166, z: 110, y: 13, s: '北', c: 's' }] },

  watari: { title: '渡櫓', W: 190, D: 64, step: 4, yaw: -0.4, pitch: 0.32, h: () => 0, top: () => 'field', cap: '斜め前から見た図',
    build: A => {
        const S = A.prism([[60, 0, 24], [130, 0, 24], [130, 0, 46], [60, 0, 46]], [[60, 14, 27], [130, 14, 27], [130, 14, 46], [60, 14, 46]], 'mortar', 'grass');
        A.stones(S[0], 70, MORTAR_H(14, 3), 83);
        const b = A.box(66, 29, 124, 41, 14, 24, 'plaster'); A.windows(b[0], 5);
        A.hip(95, 35, 66, 20, 23, 7, 40, 5);
        A.base(38, 34, 46, 34, 36, 26, 0, 11); A.tower(38, 34, 11, [[28, 20, 10], [20, 14, 8]]);
        A.base(152, 34, 46, 34, 36, 26, 0, 11); A.tower(152, 34, 11, [[28, 20, 10], [20, 14, 8]]);
    },
    labels: [{ x: 95, z: 29, y: 22, s: '渡櫓', oy: -28 }, { x: 38, z: 34, y: 40, s: '櫓', c: 's', ox: -30, oy: -6 },
             { x: 152, z: 34, y: 40, s: '櫓', c: 's', ox: 30, oy: -6 }] },

  monomi: { title: '物見櫓', W: 190, D: 90, step: 2, yaw: -0.3, pitch: 0.34, smooth: true,
    h: (x, z) => {
        const r = Math.hypot((x - 160) / 44, (z - 50) / 34);
        return r >= 1 ? 0 : 26 * Math.pow(Math.cos(r * Math.PI / 2), 1.3);
    },
    top: () => 'field',
    build: A => { A.base(44, 46, 44, 34, 34, 26, 0, 11); A.tower(44, 46, 11, [[28, 20, 10], [21, 15, 8], [15, 11, 7]], 8); },
    lines: [{ k: 'sight', pts: [[56, 46, 52], [130, 46, 30]] }, { k: 'sight', pts: [[56, 40, 52], [120, 20, 12]] }],
    labels: [{ x: 44, z: 20, y: 0, s: '物見櫓' }, { x: 110, z: 46, y: 44, s: '周りを見張る', c: 's' }] },

  taiko: { title: '太鼓櫓', W: 130, D: 70, step: 4, yaw: -0.4, pitch: 0.3, h: () => 0, top: () => 'field', cap: '斜め前から見た図',
    build: A => {
        A.base(65, 36, 52, 40, 42, 32, 0, 12); A.tower(65, 36, 12, [[34, 24, 11]], 0.01);
        // 上の階は開いていて、中の太鼓が見える
        A.box(50, 30, 54, 42, 27, 39, 'wood'); A.box(76, 30, 80, 42, 27, 39, 'wood');
        A.cylZ(65, 33, 32, 40, 6, 'wood', 'tile');
        A.hip(65, 36, 46, 34, 38, 9, 16, .01);
    },
    lines: [{ k: 'ghost', pts: [[84, 33, 36], [92, 33, 38]] }, { k: 'ghost', pts: [[86, 33, 30], [96, 33, 31]] },
            { k: 'ghost', pts: [[84, 33, 24], [92, 33, 22]] }],
    labels: [{ x: 65, z: 32, y: 33, s: '太鼓', c: 's', ox: -44, oy: 4 }, { x: 96, z: 33, y: 31, s: '音で時や合図を知らせる', c: 's', ox: 10, oy: -16 }] },

  tsukimi: { title: '月見櫓', W: 130, D: 70, step: 4, yaw: -0.4, pitch: 0.3, h: () => 0, top: () => 'field', cap: '斜め前から見た図', skyTop: 62,
    build: A => {
        A.base(60, 36, 54, 42, 44, 34, 0, 12); A.tower(60, 36, 12, [[36, 26, 11]], 0.01);
        A.box(41, 29, 81, 43, 27, 28, 'wood');
        [[42, 30], [42, 42], [78, 30], [78, 42]].forEach(([x0, z0]) => A.box(x0, z0, x0 + 3, z0 + 3, 28, 37, 'wood'));
        A.hip(60, 36, 50, 38, 36.5, 9, 18, .01);
    },
    dots: [{ c: '#FFE082', r: 11, noStroke: true, pts: [[112, 50, 54]] }],
    labels: [{ x: 60, z: 29, y: 33, s: '大きく開いた造り', c: 's', ox: -44, oy: -6 }, { x: 112, z: 50, y: 54, s: '月', c: 's', ox: 0, oy: -20 }] },

  idoyagura: { title: '井戸櫓', W: 110, D: 66, step: 1, yaw: -0.3, pitch: 0.45, smooth: true, groupsByDepth: true,
    h: (x, z) => { const r = Math.hypot(x - 55, z); return r < 5 ? -26 : r < 6 ? lerp(-26, 0, r - 5) : 0; },
    water: (x, z) => Math.hypot(x - 55, z) < 5 ? -18 : null,
    top: () => 'grass', steep: (x, z) => Math.hypot(x - 55, z) < 8 ? 'stone' : 'earth',
    build: A => {
        const N = 10, at = (r, a, y) => [55 + Math.cos(a) * r, y, Math.sin(a) * r];
        for (let k = 0; k < N; k++) {
            const a0 = k / N * Math.PI, a1 = (k + 1) / N * Math.PI;
            A.prism([at(6, a0, 0), at(8, a0, 0), at(8, a1, 0), at(6, a1, 0)], [at(6, a0, 3.5), at(8, a0, 3.5), at(8, a1, 3.5), at(6, a1, 3.5)], 'stone');
        }
        // 前の壁は描かず、中の井戸が見えるようにする
        const wall = pts => A.face(pts, 'plaster', [55, 10, 16], false);
        wall([[30, 0, 22], [80, 0, 22], [80, 20, 22], [30, 20, 22]]);      // 奥の壁
        wall([[30, 0, 0], [30, 0, 22], [30, 20, 22], [30, 20, 0]]);        // 左の壁
        wall([[80, 0, 22], [80, 0, 0], [80, 20, 0], [80, 20, 22]]);        // 右の壁
        A.hip(55, 11, 58, 30, 20, 8, 20, .01);
    },
    labels: [{ x: 55, z: 22, y: 24, s: '櫓の中に井戸', ox: -70, oy: 14 }, { x: 55, z: 0, y: -20, s: '井戸', c: 's', ox: 40, oy: 4 }] },

  yaguradai: { title: '櫓台', W: 170, D: 64, step: 4, yaw: -0.4, pitch: 0.32, h: () => 0, top: () => 'field', cap: '斜め前から見た図',
    build: A => {
        A.base(44, 32, 52, 40, 40, 30, 0, 14); A.tower(44, 32, 14, [[30, 22, 11], [22, 16, 8]]);
        A.base(126, 32, 52, 40, 40, 30, 0, 14);
    },
    lines: [{ k: 'ghost', pts: [[111, 32, 14], [111, 32, 25], [141, 32, 25], [141, 32, 14]] },
            { k: 'ghost', pts: [[117, 32, 25], [117, 32, 33], [135, 32, 33], [135, 32, 25]] }],
    labels: [{ x: 44, z: 12, y: 0, s: '櫓台', c: 's' }, { x: 126, z: 12, y: 0, s: '櫓台' },
             { x: 126, z: 32, y: 34, s: '建物が失われ、台だけ残る', c: 's', oy: -16 }] },

  // ══ 天守 ══
  tenshudai: { title: '天守台', W: 130, D: 96, step: 4, yaw: -0.42, pitch: 0.32, h: () => 0, top: () => 'field', cap: '斜め前から見た図',
    build: A => { A.base(65, 48, 82, 64, 66, 50, 0, 16); A.tower(65, 48, 16, [[50, 38, 12], [38, 28, 9], [27, 20, 8]], 9); },
    labels: [{ x: 65, z: 16, y: 8, s: '天守台', ox: -46, oy: 10 }, { x: 65, z: 48, y: 58, s: '天守', c: 's', ox: 46, oy: -6 }] },

  boro: { title: '望楼型', W: 130, D: 90, step: 4, yaw: -0.42, pitch: 0.3, h: () => 0, top: () => 'field', cap: '斜め前から見た図',
    build: A => {
        A.base(62, 45, 76, 58, 62, 46, 0, 14);
        const b = A.box(34, 27, 90, 63, 14, 28, 'plaster'); A.windows(b[0], 5); A.windows(b[3], 3);
        A.irimoya(62, 45, 64, 44, 27, 13);
        const t = A.box(52, 37, 72, 53, 36, 46, 'plaster'); A.windows(t[0], 2); A.windows(t[3], 1);
        A.hip(62, 45, 28, 24, 45, 8, 10, .01);
    },
    labels: [{ x: 62, z: 37, y: 46, s: '望楼', ox: 46, oy: -10 }, { x: 62, z: 27, y: 33, s: '入母屋の屋根', c: 's', ox: -50, oy: -2 }] },

  dokuritsu: { title: '独立式', W: 120, D: 90, step: 4, yaw: -0.42, pitch: 0.3, h: () => 0, top: () => 'field', cap: '斜め前から見た図',
    build: A => { A.base(60, 45, 68, 54, 54, 42, 0, 12); A.tower(60, 45, 12, [[42, 32, 11], [32, 24, 9], [23, 17, 8]], 9); },
    labels: [{ x: 60, z: 12, y: 0, s: '天守だけが建つ', c: 's' }] },

  fukugo: { title: '複合式', W: 160, D: 90, step: 4, yaw: -0.42, pitch: 0.3, h: () => 0, top: () => 'field', cap: '斜め前から見た図',
    build: A => {
        A.base(56, 45, 68, 54, 54, 42, 0, 12); A.tower(56, 45, 12, [[42, 32, 11], [32, 24, 9], [23, 17, 8]], 9);
        A.base(105, 48, 42, 40, 34, 32, 0, 10); A.tower(105, 48, 10, [[26, 24, 10]], 7);
    },
    labels: [{ x: 56, z: 45, y: 56, s: '天守', ox: -44, oy: -6 }, { x: 105, z: 32, y: 26, s: '付櫓', ox: 40, oy: 6 }] },

  renketsu: { title: '連結式', W: 190, D: 90, step: 4, yaw: -0.42, pitch: 0.3, h: () => 0, top: () => 'field', cap: '斜め前から見た図',
    build: A => {
        const S = A.prism([[70, 0, 34], [126, 0, 34], [126, 0, 62], [70, 0, 62]], [[70, 12, 37], [126, 12, 37], [126, 12, 62], [70, 12, 62]], 'mortar', 'grass');
        A.stones(S[0], 56, MORTAR_H(12, 3), 91);
        const b = A.box(74, 40, 122, 56, 12, 22, 'plaster'); A.windows(b[0], 4);
        A.hip(98, 48, 56, 24, 21, 7, 32, 4);
        A.base(46, 45, 62, 50, 50, 40, 0, 12); A.tower(46, 45, 12, [[38, 30, 11], [29, 22, 9], [21, 16, 8]], 9);
        A.base(150, 46, 48, 42, 38, 34, 0, 11); A.tower(150, 46, 11, [[30, 26, 10], [22, 18, 8]], 8);
    },
    labels: [{ x: 46, z: 45, y: 56, s: '天守', ox: -40, oy: -8 }, { x: 150, z: 46, y: 44, s: '小天守', ox: 40, oy: -8 },
             { x: 98, z: 40, y: 20, s: '渡櫓など', c: 's', oy: 22 }] },

  renritsu: { title: '連立式', W: 170, D: 130, step: 4, yaw: -0.42, pitch: 0.62, h: () => 0, top: () => 'field', cap: '斜め上から見た図',
    build: A => {
        // 渡櫓で輪につなぐ（奥から手前へ）
        [[[40, 88, 130, 100]], [[40, 34, 130, 46]], [[34, 40, 46, 94]], [[124, 40, 136, 94]]].forEach(([r]) => {
            const b = A.box(r[0], r[1], r[2], r[3], 0, 14, 'plaster');
            A.hip((r[0] + r[2]) / 2, (r[1] + r[3]) / 2, r[2] - r[0] + 8, r[3] - r[1] + 8, 13, 6, Math.max(8, r[2] - r[0] - 10), Math.max(4, r[3] - r[1] - 8), 1);
        });
        A.base(46, 94, 44, 40, 36, 32, 0, 11); A.tower(46, 94, 11, [[28, 24, 10], [20, 17, 8]], 8);
        A.base(124, 94, 44, 40, 36, 32, 0, 11); A.tower(124, 94, 11, [[28, 24, 10], [20, 17, 8]], 8);
        A.base(124, 40, 44, 40, 36, 32, 0, 11); A.tower(124, 40, 11, [[28, 24, 10], [20, 17, 8]], 8);
        A.base(46, 40, 56, 50, 46, 40, 0, 13); A.tower(46, 40, 13, [[38, 32, 11], [28, 24, 9], [20, 17, 8]], 9);
    },
    labels: [{ x: 46, z: 40, y: 58, s: '天守', ox: -38, oy: -8 }, { x: 124, z: 40, y: 42, s: '小天守', c: 's', ox: 38, oy: -8 },
             { x: 85, z: 70, y: 0, dy: 1, s: '渡櫓などで輪につなぐ', c: 's' }] },

  // ══ 石垣（積み方は、同じ形の石垣に模様を変えて貼る） ══
  uchikomi: { title: '打込接', W: 140, D: 70, step: 4, yaw: -0.35, pitch: 0.3, h: () => 0, top: () => 'field', cap: '石垣を斜め前から見た図',
    build: A => {
        const s = A.prism([[0, 0, 16], [140, 0, 16], [140, 0, 70], [0, 0, 70]], [[0, 38, 28], [140, 38, 28], [140, 38, 70], [0, 38, 70]], 'mortar', 'grass');
        A.stones(s[0], 140, MORTAR_H(38, 12), 101, 'uchi'); A.stones(s[3], 54, 38, 102, 'uchi');
    },
    labels: [{ x: 70, z: 50, y: 38, s: '曲輪' }, { x: 70, z: 16, y: 10, s: '角や面をたたいて平らにした石', c: 's' }] },

  kirikomi: { title: '切込接', W: 140, D: 70, step: 4, yaw: -0.35, pitch: 0.3, h: () => 0, top: () => 'field', cap: '石垣を斜め前から見た図',
    build: A => {
        const s = A.prism([[0, 0, 16], [140, 0, 16], [140, 0, 70], [0, 0, 70]], [[0, 38, 28], [140, 38, 28], [140, 38, 70], [0, 38, 70]], 'mortar', 'grass');
        A.stones(s[0], 140, MORTAR_H(38, 12), 103, 'kiri'); A.stones(s[3], 54, 38, 104, 'kiri');
    },
    labels: [{ x: 70, z: 50, y: 38, s: '曲輪' }, { x: 70, z: 16, y: 10, s: '方形に整えて密着させる', c: 's' }] },

  nuno: { title: '布積み', W: 140, D: 70, step: 4, yaw: -0.35, pitch: 0.3, h: () => 0, top: () => 'field', cap: '石垣を斜め前から見た図',
    build: A => {
        const s = A.prism([[0, 0, 16], [140, 0, 16], [140, 0, 70], [0, 0, 70]], [[0, 38, 28], [140, 38, 28], [140, 38, 70], [0, 38, 70]], 'mortar', 'grass');
        A.stones(s[0], 140, MORTAR_H(38, 12), 105, 'nuno'); A.stones(s[3], 54, 38, 106, 'nuno');
    },
    labels: [{ x: 70, z: 50, y: 38, s: '曲輪' }, { x: 70, z: 16, y: 10, s: '横の目地が一直線に通る', c: 's' }] },

  ran: { title: '乱積み', W: 140, D: 70, step: 4, yaw: -0.35, pitch: 0.3, h: () => 0, top: () => 'field', cap: '石垣を斜め前から見た図',
    build: A => {
        const s = A.prism([[0, 0, 16], [140, 0, 16], [140, 0, 70], [0, 0, 70]], [[0, 38, 28], [140, 38, 28], [140, 38, 70], [0, 38, 70]], 'mortar', 'grass');
        A.stones(s[0], 140, MORTAR_H(38, 12), 107, 'ran'); A.stones(s[3], 54, 38, 108, 'ran');
    },
    labels: [{ x: 70, z: 50, y: 38, s: '曲輪' }, { x: 70, z: 16, y: 10, s: '大きさの違う石を組み合わせる', c: 's' }] },

  tani: { title: '谷積み', W: 140, D: 70, step: 4, yaw: -0.35, pitch: 0.3, h: () => 0, top: () => 'field', cap: '石垣を斜め前から見た図',
    build: A => {
        const s = A.prism([[0, 0, 16], [140, 0, 16], [140, 0, 70], [0, 0, 70]], [[0, 38, 28], [140, 38, 28], [140, 38, 70], [0, 38, 70]], 'mortar', 'grass');
        A.stones(s[0], 140, MORTAR_H(38, 12), 109, 'tani'); A.stones(s[3], 54, 38, 110, 'tani');
    },
    labels: [{ x: 70, z: 50, y: 38, s: '曲輪' }, { x: 70, z: 16, y: 10, s: '石の隅を立てて積む', c: 's' }] },

  kikko: { title: '亀甲積み', W: 140, D: 70, step: 4, yaw: -0.35, pitch: 0.3, h: () => 0, top: () => 'field', cap: '石垣を斜め前から見た図',
    build: A => {
        const s = A.prism([[0, 0, 16], [140, 0, 16], [140, 0, 70], [0, 0, 70]], [[0, 38, 28], [140, 38, 28], [140, 38, 70], [0, 38, 70]], 'mortar', 'grass');
        A.stones(s[0], 140, MORTAR_H(38, 12), 111, 'kikko'); A.stones(s[3], 54, 38, 112, 'kikko');
    },
    labels: [{ x: 70, z: 50, y: 38, s: '曲輪' }, { x: 70, z: 16, y: 10, s: '六角形に加工した石', c: 's' }] },

  sangi: { title: '算木積み', W: 150, D: 90, step: 4, yaw: -0.5, pitch: 0.3, h: () => 0, top: () => 'field', cap: '石垣の角を斜め前から見た図',
    build: A => {
        const s = A.prism([[24, 0, 20], [150, 0, 20], [150, 0, 84], [24, 0, 84]], [[34, 40, 30], [150, 40, 30], [150, 40, 84], [34, 40, 84]], 'mortar', 'grass');
        A.stones(s[0], 126, MORTAR_H(40, 10), 113, 'uchi'); A.stones(s[3], 64, MORTAR_H(40, 10), 114, 'uchi');
        // 角の隅石。段ごとに、長い面と短い面を入れ替える
        const front = [], side = [];
        for (let k = 0; k < 8; k++) {
            const v0 = k / 8 + .012, v1 = (k + 1) / 8 - .012, lng = k % 2 === 0;
            front.push([.004, v0, lng ? .17 : .075, v1]);
            side.push([lng ? .91 : .8, v0, .996, v1]);
        }
        A.rects(s[0], front, '#C3CCD1'); A.rects(s[3], side, '#C3CCD1');
    },
    labels: [{ x: 110, z: 20, y: 12, s: '算木積み' }, { x: 30, z: 26, y: 30, s: '隅石を長短互い違いに積む', c: 's', ox: -6, oy: -30 }] },

  nobori: { title: '登り石垣', W: 190, D: 120, step: 2, yaw: -0.3, pitch: 0.45, smooth: true,
    h: (x, z) => {
        const r = Math.hypot((x - 120) / 82, (z - 80) / 58);
        let hh = z < 22 ? -5 : r >= 1 ? 0 : 42 * Math.pow(Math.cos(r * Math.PI / 2), 1.2);
        return hh + noboriRidge(x, z);
    },
    water: (x, z) => z < 22 ? 0 : null,
    top: (x, z, h) => noboriRidge(x, z) > 1 ? 'stone' : h > 36 ? 'grass' : 'field',
    steep: (x, z) => noboriRidge(x, z) > 1 ? 'stone' : 'earth',
    labels: [{ x: 120, z: 80, dy: 2, s: '本丸' }, { x: 103, z: 50, dy: 3, s: '登り石垣', ox: -40, oy: 6 },
             { x: 40, z: 10, y: 0, s: '港', c: 's' }] },

  koshimaki: { title: '腰巻石垣・鉢巻石垣', W: 170, D: 80, step: 1.6, yaw: -0.45, pitch: 0.42,
    h: x => 6 + 20 * Math.max(bankProfile(Math.abs(x - 45)), bankProfile(Math.abs(x - 120))),
    top: () => 'grass',
    steep: (x, z, h) => x < 82 ? (h < 14 ? 'stone' : 'earth') : (h > 19 ? 'stone' : 'earth'),
    labels: [{ x: 45, z: 56, dy: 1, s: '土塁', c: 's' }, { x: 120, z: 64, dy: 1, s: '土塁', c: 's' },
             { x: 45, z: 0, y: 10, s: '腰巻石垣（下を石垣にする）', c: 's', ox: -20, oy: 20 },
             { x: 120, z: 0, y: 23, s: '鉢巻石垣（上を石垣にする）', c: 's', ox: 30, oy: -16 }] },

  // ══ 虎口 ══
  hira: { title: '平虎口', W: 160, D: 96, step: 2, yaw: -0.4, pitch: 0.78, base: 2,
    h: () => 10, top: (x, z) => z < 44 ? 'field' : 'grass',
    boxes: [[0, 44, 66, 52, 10, 20, 'wall'], [94, 44, 160, 52, 10, 20, 'wall']],
    lines: [{ k: 'enemy', pts: [[80, 6], [80, 72]], dy: 1.5 }],
    labels: [{ x: 30, z: 76, dy: 1, s: '曲輪' }, { x: 24, z: 16, dy: 1, s: '城外', c: 's' },
             { x: 80, z: 48, y: 21, s: '開口部', c: 's', ox: 46, oy: -12 }] },

  saka: { title: '坂虎口', W: 160, D: 110, step: 1.6, yaw: -0.4, pitch: 0.5, smooth: true,
    h: (x, z) => {
        const ramp = Math.abs(x - 80) < 13 ? 4 + 22 * clamp((z - 20) / 54, 0, 1) : 0;
        return Math.max(4 + 22 * clamp((z - 58) / 16, 0, 1), ramp);
    },
    top: (x, z) => z > 74 ? 'grass' : Math.abs(x - 80) < 13 && z > 20 ? 'sand' : 'field',
    build: A => {
        A.box(64, 74, 68, 78, 26, 40, 'wood'); A.box(92, 74, 96, 78, 26, 40, 'wood');
        A.gable(80, 76, 38, 14, 40, 6, 'x');
    },
    lines: [{ k: 'enemy', pts: [[80, 14], [80, 66]], dy: 2 }],
    labels: [{ x: 40, z: 92, dy: 1, s: '曲輪' }, { x: 80, z: 40, dy: 2, s: '急な坂', ox: 44, oy: 6 },
             { x: 80, z: 76, y: 44, s: '虎口', c: 's', oy: -16 }] },

  kuichigai: { title: '喰違虎口', W: 170, D: 116, step: 2, yaw: -0.4, pitch: 0.78, base: 2,
    h: () => 10, top: (x, z) => z < 48 ? 'field' : 'grass',
    boxes: [[0, 48, 104, 56, 10, 20, 'wall'], [66, 72, 170, 80, 10, 20, 'wall']],
    lines: [{ k: 'enemy', pts: [[40, 8], [40, 64], [130, 64], [130, 104]], dy: 1.5 }],
    labels: [{ x: 26, z: 100, dy: 1, s: '曲輪' }, { x: 24, z: 16, dy: 1, s: '城外', c: 's' },
             { x: 60, z: 52, y: 21, s: '食い違いに置く', c: 's', ox: -46, oy: 26 }] },

  ichimonji: { title: '一文字虎口', W: 170, D: 116, step: 2, yaw: -0.4, pitch: 0.78, base: 2,
    h: () => 10, top: (x, z) => z < 60 ? 'field' : 'grass',
    boxes: [[0, 60, 66, 68, 10, 20, 'wall'], [104, 60, 170, 68, 10, 20, 'wall'], [56, 32, 114, 40, 10, 19, 'wall']],
    lines: [{ k: 'enemy', pts: [[36, 8], [36, 48], [85, 48], [85, 90]], dy: 1.5 }],
    labels: [{ x: 26, z: 96, dy: 1, s: '曲輪' }, { x: 26, z: 16, dy: 1, s: '城外', c: 's' },
             { x: 85, z: 36, y: 20, s: '一文字の防塁', c: 's', ox: 44, oy: -14 }] },

  sotomasu: { title: '外枡形', W: 170, D: 116, step: 2, yaw: -0.4, pitch: 0.8, base: 2,
    h: () => 10,
    top: (x, z) => z > 66 ? 'grass' : x > 62 && x < 110 && z > 30 && z < 66 ? 'sand' : 'field',
    boxes: [[0, 66, 66, 74, 10, 20, 'wall'], [106, 66, 170, 74, 10, 20, 'wall'],
            [54, 30, 62, 74, 10, 20, 'wall'], [110, 30, 118, 74, 10, 20, 'wall'], [54, 30, 118, 38, 10, 20, 'wall'],
            [65, 65, 67, 75, 10, 24, 'dark'], [105, 65, 107, 75, 10, 24, 'dark'],
            [52, 46, 64, 48, 10, 24, 'dark'], [52, 58, 64, 60, 10, 24, 'dark']],
    lines: [{ k: 'enemy', pts: [[20, 54], [58, 54], [86, 54], [86, 96]], dy: 1.5 }],
    labels: [{ x: 30, z: 104, dy: 1, s: '曲輪' }, { x: 144, z: 20, dy: 1, s: '城外', c: 's' }, { x: 86, z: 52, dy: 1, s: '枡形' },
             { x: 86, z: 70, y: 25, s: '門', c: 's', ox: 46, oy: -12 }, { x: 58, z: 52, y: 25, s: '門', c: 's', ox: -54, oy: 16 }] },

  // ══ 堀（断面の形・平地の城・山城） ══
  katayagen: { title: '片薬研堀', W: 160, D: 100, step: 2, yaw: -0.25, pitch: 0.62,
    h: x => polyline(KATAYAGEN, x),
    top: x => x < 66 ? 'grass' : x > 106 ? 'field' : 'earth',
    labels: [{ x: 28, z: 50, s: '曲輪' }, { x: 134, z: 50, s: '城外', c: 's' }, { x: 84, z: 58, dy: 3, s: '片薬研堀' },
             { x: 80, z: 0, y: -2, s: '「レ」の字（片側が切り立つ）', c: 's' }] },

  hakobori: { title: '箱堀', W: 160, D: 100, step: 2, yaw: -0.25, pitch: 0.62,
    h: x => polyline(HAKOBORI, x),
    top: x => x < 58 ? 'grass' : x > 102 ? 'field' : 'earth',
    labels: [{ x: 28, z: 50, s: '曲輪' }, { x: 134, z: 50, s: '城外', c: 's' }, { x: 80, z: 58, dy: 2, s: '箱堀' },
             { x: 80, z: 0, y: -2, s: '底が平ら（箱形）', c: 's' }] },

  kenuki: { title: '毛抜堀', W: 160, D: 100, step: 2, yaw: -0.25, pitch: 0.62,
    h: x => { const d = Math.abs(x - 80); return d >= 24 ? 24 : 3 + 21 * (d / 24) ** 2; },
    top: x => Math.abs(x - 80) >= 24 ? (x < 80 ? 'grass' : 'field') : 'earth',
    labels: [{ x: 28, z: 50, s: '曲輪' }, { x: 134, z: 50, s: '城外', c: 's' }, { x: 80, z: 58, dy: 2, s: '毛抜堀' },
             { x: 80, z: 0, y: -2, s: 'U字', c: 's' }] },

  unebori: { title: '畝堀', W: 120, D: 100, step: 1.25, yaw: -0.5, pitch: 0.75,
    h: (x, z) => {
        let hh = trap(Math.abs(x - 60), 16, 25, 24, 3);
        if (Math.abs(x - 60) < 18) {
            const d = Math.abs(((z - 8) % 22) - 11);       // 一定の間隔で並ぶ畝
            const rg = d < 1.4 ? 17 : d < 4 ? lerp(17, 3, (d - 1.4) / 2.6) : 0;
            hh = Math.max(hh, rg);
        }
        return hh;
    },
    top: (x, z, h) => x < 35 ? 'grass' : x > 85 ? 'field' : h > 9 ? 'hl' : 'earth',
    labels: [{ x: 16, z: 50, s: '曲輪' }, { x: 104, z: 50, s: '城外', c: 's' },
             { x: 60, z: 41, dy: 1, s: '一定の間隔で並ぶ畝', ox: 0, oy: -30 }] },

  hosha: { title: '放射状竪堀', W: 170, D: 120, step: 1.2, yaw: -0.35, pitch: 0.62, smooth: true,
    h: (x, z) => {
        const dx = (x - 85) / 78, dz = (z - 60) / 52, r = Math.hypot(dx, dz);
        let hh = r <= .3 ? 32 : 32 * Math.pow(1 - clamp((r - .3) / .72, 0, 1), 1.5);
        const dr = Math.abs(r - .46); if (dr < .07) hh -= 6 * (1 - (dr / .07) ** 2);
        if (r > .5) {
            const a = Math.atan2(dz, dx), da = Math.abs(a - Math.round(a / (Math.PI / 6)) * (Math.PI / 6));
            if (da < .13) hh -= 5 * (1 - (da / .13) ** 2) * sstep((r - .52) / .08) * sstep((1 - r) / .12);
        }
        return hh;
    },
    top: (x, z) => Math.hypot((x - 85) / 78, (z - 60) / 52) < .3 ? 'grass' : 'field',
    labels: [{ x: 85, z: 60, s: '曲輪' }, { x: 121, z: 60, dy: 0, s: '横堀', c: 's', ox: 34, oy: -16 },
             { x: 85, z: 14, dy: 0, s: '放射状の竪堀', ox: -14, oy: 20 }] },

  uchisoto: { title: '内堀・中堀・外堀', W: 176, D: 116, step: 1.3, yaw: -0.4, pitch: 0.85,
    h: (x, z) => {
        if (inR(x, z, US[0]) >= 0) return 20;
        if (inR(x, z, US[1]) > 0) return ringH(x, z, US[0], 20, US[1], 16, 4);
        if (inR(x, z, US[2]) >= 0) return 16;
        if (inR(x, z, US[3]) > 0) return ringH(x, z, US[2], 16, US[3], 13, 3);
        if (inR(x, z, US[4]) >= 0) return 13;
        if (inR(x, z, US[5]) > 0) return ringH(x, z, US[4], 13, US[5], 10, 2);
        return 10;
    },
    water: (x, z) => inR(x, z, US[1]) > 0 && inR(x, z, US[0]) < 0 ? 9
        : inR(x, z, US[3]) > 0 && inR(x, z, US[2]) < 0 ? 7
        : inR(x, z, US[5]) > 0 && inR(x, z, US[4]) < 0 ? 5 : null,
    top: (x, z) => inR(x, z, US[5]) < 0 ? 'field' : 'grass',
    steep: () => 'stone',
    labels: [{ x: 88, z: 58, dy: 1, s: '本丸' }, { x: 110, z: 41, dy: 1, s: '内堀', c: 's' },
             { x: 124, z: 22, dy: 1, s: '中堀', c: 's' }, { x: 140, z: 6, dy: 1, s: '外堀', c: 's' }] },

  sougamae: { title: '総構・総堀', W: 190, D: 130, step: 1.4, yaw: -0.4, pitch: 0.85,
    h: (x, z) => {
        if (inR(x, z, SG[0]) >= 0) return 18;
        if (inR(x, z, SG[1]) > 0) return ringH(x, z, SG[0], 18, SG[1], 12, 4);
        if (inR(x, z, SG[2]) >= 0) return 12;
        if (inR(x, z, SG[3]) > 0) return ringH(x, z, SG[2], 12, SG[3], 9, 3);
        return 9;
    },
    water: (x, z) => inR(x, z, SG[1]) > 0 && inR(x, z, SG[0]) < 0 ? 8
        : inR(x, z, SG[3]) > 0 && inR(x, z, SG[2]) < 0 ? 6 : null,
    top: (x, z, h) => h > 16 ? 'grass' : h > 11 ? 'sand' : 'field',
    build: A => {
        // 城下町の家並み
        for (let i = 0; i < 6; i++) for (let j = 0; j < 4; j++) {
            const x0 = 86 + i * 16, z0 = 26 + j * 16;
            A.box(x0, z0, x0 + 10, z0 + 10, 12, 17, 'town', 'tile');
        }
    },
    labels: [{ x: 52, z: 74, dy: 1, s: '城' }, { x: 130, z: 92, dy: 1, s: '城下町', c: 's' },
             { x: 95, z: 6, dy: 1, s: '総構（外周の堀・土塁）', c: 's' }] },

  // ══ 土塁 ══
  kakiage: { title: '土塁（掻揚土塁）', W: 170, D: 90, step: 1.25, yaw: -0.2, pitch: 0.72,
    h: x => polyline(KAKIAGE, x),
    top: (x, z, h) => x > 66 && x < 118 ? 'earth' : x >= 118 ? 'field' : 'grass',
    lines: [{ k: 'move', pts: [[98, 56, 5], [90, 56, 22], [78, 56, 32], [66, 56, 34]] }],
    labels: [{ x: 22, z: 45, s: '曲輪（城内）' }, { x: 60, z: 30, dy: 2, s: '土塁' },
             { x: 98, z: 24, dy: 1, s: '堀' }, { x: 146, z: 45, s: '城外', c: 's' },
             { x: 88, z: 56, y: 25, s: '掘った土を盛る', c: 's', ox: 56, oy: -20 }] },

  musha: { title: '武者走・犬走', W: 170, D: 80, step: 1.6, yaw: -0.45, pitch: 0.42,
    h: x => 6 + 20 * mushaProfile(Math.abs(x - 85)),
    top: () => 'grass',
    build: A => { A.box(100, 0, 104, 80, 26, 34, 'plaster'); A.gable(102, 40, 9, 82, 34, 3, 'z'); },
    labels: [{ x: 76, z: 40, dy: 1, s: '武者走（城内側）', c: 's', ox: -30, oy: -10 },
             { x: 108, z: 24, dy: 1, s: '犬走（城外側）', c: 's', ox: 54, oy: 20 },
             { x: 102, z: 0, y: 34, s: '塀', c: 's', ox: 26, oy: -26 },
             { x: 18, z: 40, s: '城内', c: 's' }, { x: 152, z: 40, s: '城外', c: 's' }] },

  // ══ 塀・建物 ══
  ishiotoshi: { title: '石落とし', W: 150, D: 96, step: 4, yaw: -0.4, pitch: 0.3, h: () => 0, top: () => 'field', cap: '斜め前から見た図',
    build: A => {
        const S = A.prism([[20, 0, 24], [150, 0, 24], [150, 0, 86], [20, 0, 86]], [[28, 30, 32], [150, 30, 32], [150, 30, 86], [28, 30, 86]], 'mortar', 'grass');
        A.stones(S[0], 130, MORTAR_H(30, 8), 121); A.stones(S[3], 62, MORTAR_H(30, 8), 122);
        const b = A.box(34, 36, 140, 78, 30, 44, 'plaster'); A.windows(b[0], 6); A.windows(b[3], 2);
        const o = A.box(44, 22, 68, 38, 32, 43, 'plaster');
        A.rects(o[0], [[.1, .03, .9, .16]], '#37474F');
        A.hip(87, 57, 118, 52, 43, 11, 44, 10);
        A.hip(56, 28, 30, 18, 42.5, 4, 16, 6);        // 石落としの小屋根
    },
    lines: [{ k: 'shoot', pts: [[56, 24, 32], [56, 18, 4]] }],
    dots: [{ c: '#E53935', pts: [[54, 16, 1], [64, 12, 1]] }],
    labels: [{ x: 56, z: 28, y: 38, s: '石落とし', ox: -44, oy: -6 }, { x: 110, z: 24, y: 14, s: '石垣', c: 's' }] },

  tsuiji: { title: '築地塀', W: 150, D: 60, step: 4, yaw: -0.45, pitch: 0.3, h: () => 0, top: () => 'field', cap: '斜め前から見た図',
    build: A => {
        const st = A.box(0, 26, 150, 34, 0, 8, 'mortar', 'stone'); A.stones(st[0], 150, 8, 131);
        const w = A.box(4, 27, 146, 33, 8, 30, 'tile');
        const layers = Array.from({ length: 8 }, (_, k) => [0, k / 8 + .012, 1, (k + 1) / 8 - .012]);
        A.rects(w[0], layers, '#C9A77C'); A.rects(w[3], layers, '#BE9C71');
        A.gable(75, 30, 152, 12, 30, 4, 'x');
    },
    labels: [{ x: 75, z: 27, y: 20, s: 'つき固めた土の層（版築）', c: 's', oy: -26 },
             { x: 36, z: 26, y: 4, s: '石垣の基礎', c: 's', oy: 18 }] },

  goten: { title: '御殿', W: 190, D: 116, step: 4, yaw: -0.4, pitch: 0.34, h: () => 0, top: () => 'field', cap: '斜め前から見た図',
    build: A => {
        const b1 = A.box(16, 30, 96, 80, 0, 18, 'plaster'); A.windows(b1[0], 6); A.windows(b1[3], 4);
        A.irimoya(56, 55, 92, 62, 17, 17);
        const b2 = A.box(108, 44, 178, 92, 0, 16, 'plaster'); A.windows(b2[0], 5); A.windows(b2[3], 4);
        A.irimoya(143, 68, 82, 60, 15, 15);
    },
    labels: [{ x: 56, z: 30, y: 6, s: '表御殿（政務）', oy: 22 }, { x: 143, z: 44, y: 6, s: '奥御殿（暮らし）', oy: 22 }] },

  soseki: { title: '礎石建物・掘立柱建物', W: 150, D: 60, step: 3, yaw: -0.3, pitch: 0.42, base: -10,
    h: () => 10, top: () => 'grass',
    build: A => {
        A.cyl(45, 5, 10, 13.5, 8.5, 'stone', 12);
        A.box(41, 1, 49, 9, 13.5, 46, 'wood');
        A.box(101, 1, 109, 9, 10, 46, 'wood');
    },
    // 地面に埋まっている部分は、手前の切り口に重ねて描く
    fills: [{ c: 'rgba(84,58,40,.92)', pts: [[101, -0.2, -4], [109, -0.2, -4], [109, -0.2, 10], [101, -0.2, 10]] }],
    lines: [{ k: 'ghost', pts: [[101, -0.2, -4], [109, -0.2, -4], [109, -0.2, 10]] }],
    labels: [{ x: 45, z: 5, y: 48, s: '礎石建物', oy: -12 }, { x: 105, z: 5, y: 48, s: '掘立柱建物', oy: -12 },
             { x: 45, z: 5, y: 12, s: '石の上に柱を立てる', c: 's', ox: -34, oy: 22 },
             { x: 105, z: 0, y: 2, s: '柱を地面に埋める', c: 's', ox: 44, oy: 10 }] },

  // ══ 井戸・水利 ══
  mizunote: { title: '水の手曲輪', W: 170, D: 120, step: 1.3, yaw: -0.4, pitch: 0.62, smooth: true,
    h: (x, z) => {
        const r = Math.hypot((x - 92) / 74, (z - 74) / 50);
        let hh = r < .3 ? 30 : 30 * Math.pow(1 - clamp((r - .3) / .7, 0, 1), 1.3);
        const d = outR(x, z, MIZU_K);
        if (d < 2) hh = Math.max(hh, lerp(14, 6, d / 2));
        if (Math.hypot(x - 52, (z - 34) * 1.2) < 12) hh = Math.min(hh, 8);
        return hh;
    },
    water: (x, z) => Math.hypot(x - 52, (z - 34) * 1.2) < 12 ? 11 : null,
    top: (x, z, h) => outR(x, z, MIZU_K) === 0 ? 'hl' : h > 26 ? 'grass' : 'field',
    labels: [{ x: 104, z: 80, s: '主郭' }, { x: 52, z: 50, dy: 1, s: '水の手曲輪' },
             { x: 52, z: 34, y: 11, s: '貯水池', c: 's', ox: 42, oy: 8 }] },

  // ══ 狼煙・物見 ══
  noroshi: { title: '狼煙台', W: 200, D: 110, step: 2, yaw: -0.25, pitch: 0.4, smooth: true, skyTop: 92,
    h: (x, z) => {
        const b = (cx, cz, rx, rz, hgt) => {
            const r = Math.hypot((x - cx) / rx, (z - cz) / rz);
            return r >= 1 ? 0 : hgt * Math.pow(Math.cos(r * Math.PI / 2), 1.2);
        };
        return Math.max(Math.min(b(48, 60, 44, 34, 40), 32), Math.min(b(150, 66, 40, 30, 26), 20), 0);
    },
    top: (x, z, h) => h > 18 ? 'grass' : 'field',
    build: A => { A.cyl(48, 60, 32, 36, 7, 'stone', 10); A.cyl(150, 66, 20, 23, 5, 'stone', 10); },
    lines: [{ k: 'smoke', pts: [[48, 60, 38], [43, 60, 48], [53, 60, 58], [46, 60, 70], [51, 60, 84]], w: 6 },
            { k: 'smoke', pts: [[150, 66, 25], [146, 66, 33], [152, 66, 41], [148, 66, 51]], w: 4 },
            { k: 'ghost', pts: [[60, 60, 76], [138, 66, 54]] }],
    dots: [{ c: '#FF7043', r: 4, pts: [[48, 60, 37]] }, { c: '#FF7043', r: 3, pts: [[150, 66, 24]] }],
    labels: [{ x: 48, z: 60, y: 34, s: '狼煙台', ox: -42, oy: 10 }, { x: 150, z: 66, y: 22, s: '次の狼煙台', c: 's', ox: 40, oy: 14 },
             { x: 99, z: 63, y: 70, s: '煙で知らせを伝える', c: 's' }] },
};

const KATAYAGEN = [[0, 24], [68, 24], [70, 2], [104, 24], [160, 24]];
const HAKOBORI = [[0, 24], [60, 24], [70, 3], [92, 3], [102, 24], [160, 24]];
const US = [[68, 46, 108, 70], [58, 36, 118, 80], [44, 26, 132, 90], [34, 18, 142, 98], [20, 10, 156, 106], [8, 2, 168, 114]];
const SG = [[26, 54, 78, 96], [16, 44, 88, 106], [58, 16, 178, 116], [44, 4, 186, 126]];
const MIZU_K = [28, 14, 80, 56];
const KAKIAGE = [[0, 14], [44, 14], [56, 30], [64, 30], [88, 2], [106, 2], [114, 14], [170, 14]];
const mushaProfile = d => d <= 25 ? 1 : d >= 55 ? 0 : (55 - d) / 30;

// 登り石垣の帯（山頂から港へ下る2本）。0 より大きければ石垣の上
const noboriRidge = (x, z) => {
    if (z <= 22 || z >= 80) return 0;
    const t = (80 - z) / 58;
    for (const cx of [lerp(120, 86, t), lerp(120, 154, t)]) {
        const d = Math.abs(x - cx);
        if (d < 3.5) return 3.5 * (1 - d / 3.5);
    }
    return 0;
};
// 土塁の断面（中心からの距離 d）。1 が天端、0 が地面
const bankProfile = d => d <= 9 ? 1 : d >= 24 ? 0 : (24 - d) / 15;

/* 図が使う区画などの決まった値（上の h から呼ぶので、ここで宣言してよい） */
const HOUI_OUT = [6, 2, 154, 98];
const HOUI = [[[60, 38, 100, 62], 20], [[60, 70, 100, 94], 17], [[60, 6, 100, 30], 17], [[106, 38, 146, 62], 17], [[14, 38, 54, 62], 17]];
const houiBot = (x, z) => { const d = inR(x, z, HOUI_OUT); return d > 1.5 ? 5 : d > 0 ? lerp(9, 5, d / 1.5) : 9; };
const DEMARU = [[[20, 25, 100, 85], 16], [[122, 40, 156, 72], 14]];
const DEMARU_MOAT = [[12, 17, 108, 93], [114, 32, 164, 80]];
const SUTE = [58, 16, 102, 56];
const KUMA_BACK = [[[0, 64.5, 160, 100], 18]];
const KUMA_UMA = [56, 22, 104, 46];
const KUMA_MOAT = [[46, 12, 114, 46]];
const RENKAKU = [[0, 6], [20, 22], [26, 22], [52, 22], [70, 26], [104, 26], [122, 30], [156, 30], [172, 6], [176, 4]];
const TEIKAKU = [[[92, 62, 148, 94], 28], [[56, 40, 148, 94], 22], [[16, 16, 148, 94], 16]];
const KAIKAKU = [[0, 6], [14, 10], [36, 10], [44, 18], [74, 18], [82, 26], [112, 26], [120, 34], [158, 34], [170, 26]];
const SUMI = [[[20, 20, 156, 110], 12]];
const OTE_PLAT = [[[36, 34, 136, 90], 18]];
const OTE_MOAT = [[24, 22, 148, 102]];

/* ── 堀に架けた土橋 ──────────────────────────────────────
   上から見た平城の図は、区画を堀で囲むだけだと、どこからも出入りできない図になる。
   図の高さ・水・色の式を包み、土橋の範囲だけ地面を残す。
   r は範囲、y は両端の高さ（ax の向きに高さを変える。低い区画から高い区画へ上る） */
const bridgeAt = (x, z, list) => {
    for (const b of list) {
        if (inR(x, z, b.r) < 0) continue;
        const t = b.ax === 'x' ? (x - b.r[0]) / (b.r[2] - b.r[0]) : (z - b.r[1]) / (b.r[3] - b.r[1]);
        return lerp(b.y[0], b.y[1], t);
    }
    return null;
};
const addBridges = (id, list) => {
    const f = FIGS[id], h0 = f.h, w0 = f.water, t0 = f.top || (() => 'grass');
    f.h = (x, z) => { const b = bridgeAt(x, z, list), v = h0(x, z); return b == null ? v : Math.max(v, b); };
    if (w0) f.water = (x, z) => bridgeAt(x, z, list) != null ? null : w0(x, z);
    f.top = (x, z, h) => { const b = bridgeAt(x, z, list); return b != null && h0(x, z) < b - .5 ? 'sand' : t0(x, z, h); };
};
addBridges('rinkaku', [{ r: [74, 14.5, 86, 23.5], y: [14, 18], ax: 'z' }, { r: [74, 31.5, 86, 37.5], y: [18, 22], ax: 'z' }]);
addBridges('houi', [{ r: [74, 0, 86, 6.5], y: [9, 17], ax: 'z' }, { r: [74, 29.5, 86, 38.5], y: [17, 20], ax: 'z' },
                    { r: [74, 61.5, 86, 70.5], y: [20, 17], ax: 'z' }, { r: [53.5, 44, 60.5, 56], y: [17, 20], ax: 'x' },
                    { r: [99.5, 44, 106.5, 56], y: [20, 17], ax: 'x' }]);
addBridges('uchisoto', [{ r: [82, 0, 94, 10.5], y: [10, 13], ax: 'z' }, { r: [82, 17.5, 94, 26.5], y: [13, 16], ax: 'z' },
                        { r: [82, 35.5, 94, 46.5], y: [16, 20], ax: 'z' }]);
addBridges('demaru', [{ r: [54, 16, 66, 25.5], y: [8, 16], ax: 'z' }, { r: [99.5, 50, 122.5, 62], y: [16, 14], ax: 'x' }]);
addBridges('sougamae', [{ r: [77.5, 70, 88.5, 80], y: [18, 12], ax: 'x' }, { r: [120, 0, 132, 16.5], y: [9, 12], ax: 'z' }]);
