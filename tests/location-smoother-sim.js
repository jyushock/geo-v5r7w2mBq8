/* 現在地のなめらかさの検証（node tests/location-smoother-sim.js）
   app.js の LOCATION_SMOOTHER_BEGIN〜END をそのまま読み込み、実機の GPS に近い誤差を乗せた
   測位を流して、地図に出る現在地（追従中は地図の中心）の動きを旧方式と比べる。
   ・誤差: ゆっくりさまよう相関誤差＋細かい白色誤差＋たまのマルチパス（20〜60m 飛び）
     相関誤差は既定で2次（なめらかに動く。実際の GPS のずれは衛星配置・反射の変化でゆっくり動く）。
     1次（向きが細かく変わる）は、追従するだけで速さが大きく揺れる厳しい条件として別シナリオで確かめる
   ・測位間隔: 1秒前後のゆらぎ、0.5〜3秒の不規則、途絶あり
   ・端末の速度・進行方向: 両方あり／速度のみ／なし（ブラウザや場所で返らないことがある）
   ・画面: 60Hz と 120Hz
   各シナリオを複数の乱数で回し、平均と最悪値を出す。目標を満たさないと終了コード1。 */
'use strict';
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const m = src.match(/\/\* LOCATION_SMOOTHER_BEGIN[\s\S]*?\/\* LOCATION_SMOOTHER_END \*\//);
if (!m) { console.error('app.js に LOCATION_SMOOTHER_BEGIN〜END が見つからない'); process.exit(2); }
const createLocationSmoother = new Function(m[0] + '\nreturn createLocationSmoother;')();

const LAT0 = 35.681, LNG0 = 139.767, M_PER_DEG = 111320;
const MX = M_PER_DEG * Math.cos(LAT0 * Math.PI / 180);
const toLL = (x, y) => ({ lat: LAT0 + y / M_PER_DEG, lng: LNG0 + x / MX });
const toXY = (ll) => [(ll.lng - LNG0) * MX, (ll.lat - LAT0) * M_PER_DEG];

function rng(seed) {  // mulberry32
    let a = seed >>> 0;
    const u = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const n = () => { let s = 0; for (let i = 0; i < 12; i++) s += u(); return s - 6; };
    return { u, n };
}

/* ── 真の動き：区間 [秒数, 速さ m/s, 進行方向°, 角速度°/s] をつなぐ ── */
function makeTruth(segs, amax) {  // amax: 加減速の上限（m/s²）。人も車も一瞬では止まれない
    const pts = []; let x = 0, y = 0, hd = segs[0][2], t = 0, sp = 0;
    const DT = 0.01;
    for (const [dur, target, h0, turn] of segs) {
        if (h0 !== null) hd = h0;
        for (let s = 0; s < dur; s += DT) {
            sp = target > sp ? Math.min(target, sp + amax * DT) : Math.max(target, sp - amax * DT);
            pts.push({ t, x, y, sp, hd });
            hd += (turn || 0) * DT;
            x += sp * Math.sin(hd * Math.PI / 180) * DT;
            y += sp * Math.cos(hd * Math.PI / 180) * DT;
            t += DT;
        }
    }
    pts.push({ t, x, y, sp: 0, hd });
    return { end: t, at: (ts) => pts[Math.min(Math.max(Math.round(ts / DT), 0), pts.length - 1)] };
}

/* ── 測位の生成 ── */
function makeFixes(truth, R, opt) {
    const fixes = []; let t = 0.3;
    // 相関誤差を 0.1 秒刻みで作っておく（1次: Gauss-Markov、2次: それをもう一度ならしたもの。どちらも標準偏差 opt.gm）
    const GDT = 0.1, gm = [];
    {
        const a = Math.exp(-GDT / opt.gmTau), b = Math.sqrt(1 - a * a) * opt.gm;
        let gx = R.n() * opt.gm, gy = R.n() * opt.gm, hx = gx, hy = gy;
        for (let k = 0; k * GDT <= truth.end + 5; k++) {
            gx = gx * a + R.n() * b; gy = gy * a + R.n() * b;
            hx = hx * a + gx * (1 - a); hy = hy * a + gy * (1 - a);
            gm.push(opt.gmOrder === 1 ? [gx, gy] : [hx * Math.SQRT2, hy * Math.SQRT2]);
        }
    }
    while (t < truth.end) {
        const [gx, gy] = gm[Math.round(t / GDT)];
        const tr = truth.at(t);
        let ex = gx + R.n() * opt.white, ey = gy + R.n() * opt.white;
        let acc = Math.max(3, Math.sqrt(opt.gm ** 2 + opt.white ** 2) * 1.5 * (0.8 + 0.4 * R.u()));
        if (R.u() < opt.spike) { const ang = R.u() * 2 * Math.PI, d = 20 + 40 * R.u(); ex += d * Math.cos(ang); ey += d * Math.sin(ang); }
        const dropped = opt.drop && t > opt.drop[0] && t < opt.drop[1];
        if (!dropped) {
            let speed = null, heading = null;
            if (opt.vel !== 'none') {
                speed = tr.sp < 0.3 ? Math.abs(R.n() * 0.15) : Math.max(0, tr.sp + R.n() * 0.2);
                if (opt.vel === 'full' && tr.sp >= 0.5) heading = (tr.hd + R.n() * 8 + 360) % 360;
            }
            const ll = toLL(tr.x + ex, tr.y + ey);
            fixes.push({ arrive: t, fix: { timestamp: 1.7e12 + Math.round(t * 1000), coords: { latitude: ll.lat, longitude: ll.lng, accuracy: acc, speed, heading } } });
            if (opt.dup && R.u() < opt.dup) fixes.push({ arrive: t + 0.2, fix: fixes[fixes.length - 1].fix });  // 同じ測位の再送
        }
        t += opt.irregular ? 0.5 + 2.5 * R.u() : 0.85 + 0.3 * R.u();
    }
    return fixes;
}

/* ── 旧方式（変更前の app.js の bearingRafLoop の位置補間を忠実に移したもの） ── */
function runOld(fixes, hz, end) {
    let cur = null, rLng = null, rLat = null, k = 0; const out = [];
    for (let f = 0, t = 0; t <= end; t = ++f / hz) {
        while (k < fixes.length && fixes[k].arrive <= t) {
            const c = fixes[k++].fix.coords;
            if (cur && c.accuracy > 50) continue;
            cur = { lng: c.longitude, lat: c.latitude };
        }
        if (cur) {
            if (rLng === null) { rLng = cur.lng; rLat = cur.lat; }
            const dLng = cur.lng - rLng, dLat = cur.lat - rLat;
            if (Math.abs(dLng) > 0.00003 || Math.abs(dLat) > 0.00003) {
                const nLng = rLng + dLng * 0.02, nLat = rLat + dLat * 0.02;
                rLng = Math.abs(cur.lng - nLng) < 0.000005 ? cur.lng : nLng;
                rLat = Math.abs(cur.lat - nLat) < 0.000005 ? cur.lat : nLat;
            }
            out.push([t, ...toXY({ lng: rLng, lat: rLat })]);
        }
    }
    return out;
}

/* ── 新方式（app.js の createLocationSmoother） ── */
function runNew(fixes, hz, end) {
    const sm = createLocationSmoother(); let k = 0; const out = [];
    for (let f = 0, t = 0; t <= end; t = ++f / hz) {
        while (k < fixes.length && fixes[k].arrive <= t) { const e = fixes[k++]; sm.addFix(e.fix, e.arrive * 1000); }
        const p = sm.sample(t * 1000);
        if (p) out.push([t, ...toXY(p)]);
    }
    return out;
}

/* ── 評価 ── */
function evaluate(track, truth, drop) {
    const at = (t) => {  // 表示位置を時刻 t で線形補間（フレームレートに依らない評価のため）
        let lo = 0, hi = track.length - 1;
        if (t <= track[0][0]) return track[0].slice(1);
        while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (track[mid][0] <= t) lo = mid; else hi = mid; }
        const a = track[lo], b = track[hi], u = (t - a[0]) / ((b[0] - a[0]) || 1);
        return [a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
    };
    const STEP = 0.05, t0 = track[0][0] + 5;  // 最初の5秒（収束待ち）は除く
    let errSum = 0, errN = 0, errs = [], restPath = 0, restTime = 0, stall = 0, movingTime = 0;
    let accMax = 0; const accs = []; const speedRatio = [];
    let restWin = []; let restRange = 0; let jitter = 0, jWin = [];
    for (let t = t0; t + 2 * STEP <= truth.end; t += STEP) {
        const p0 = at(t), p1 = at(t + STEP), p2 = at(t + 2 * STEP), tr = truth.at(t);
        const e = Math.hypot(p0[0] - tr.x, p0[1] - tr.y); errSum += e * e; errN++; errs.push(e);
        const v1 = [(p1[0] - p0[0]) / STEP, (p1[1] - p0[1]) / STEP], v2 = [(p2[0] - p1[0]) / STEP, (p2[1] - p1[1]) / STEP];
        const sp = Math.hypot(v1[0], v1[1]);
        const ac = Math.hypot(v2[0] - v1[0], v2[1] - v1[1]) / STEP; accs.push(ac); accMax = Math.max(accMax, ac);
        const still = truth.at(t - 3).sp === 0 && tr.sp === 0 && truth.at(t + 2 * STEP).sp === 0;  // 止まって3秒以上
        if (still) {
            restPath += sp * STEP; restTime += STEP;
            restWin.push([t, p0]); while (restWin[0][0] < t - 10) restWin.shift();
            // ブレ：1秒間の道のりから、その1秒の始点→終点の距離を引いたもの（往復した分）。一方向にゆっくり動くだけなら0
            jWin.push([t, p0, sp * STEP]); while (jWin[0][0] < t - 1) jWin.shift();
            if (jWin.length > 1 && Math.abs(t - Math.round(t)) < STEP / 2) {
                const L = jWin.reduce((a, w) => a + w[2], 0) - jWin[jWin.length - 1][2];
                jitter += Math.max(0, L - Math.hypot(jWin[jWin.length - 1][1][0] - jWin[0][1][0], jWin[jWin.length - 1][1][1] - jWin[0][1][1]));
            }
            const xs = restWin.map(w => w[1][0]), ys = restWin.map(w => w[1][1]);
            restRange = Math.max(restRange, Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)));
        } else { restWin = []; jWin = []; }
        const steady = tr.sp > 0 && truth.at(t - 3).sp === tr.sp && truth.at(t + 1).sp === tr.sp;  // 一定速度で3秒以上
        if (steady && !(drop && t > drop[0] && t < drop[1] + 2)) { movingTime += STEP; speedRatio.push(sp / tr.sp); if (sp < 0.3 * tr.sp) stall += STEP; }
    }
    accs.sort((a, b) => a - b); errs.sort((a, b) => a - b);
    const mean = (a) => a.reduce((s, v) => s + v, 0) / (a.length || 1);
    const sr = speedRatio, srMean = mean(sr);
    return {
        rms: Math.sqrt(errSum / errN), p95: errs[Math.floor(errs.length * 0.95)],
        restJitter: restTime ? jitter / restTime : null,            // 静止中のブレ（往復した道のり m/s）
        restSpeed: restTime ? restPath / restTime : null,           // 静止中に点が動く速さ（m/s）。ゆっくりした移しも含む
        restRange: restTime ? restRange : null,                     // 静止中、10秒間に点が動く範囲（m）
        speedCv: sr.length ? Math.sqrt(mean(sr.map(v => (v - srMean) ** 2))) / srMean : null,  // 等速移動中の表示速度のばらつき
        stall: movingTime ? stall / movingTime : null,              // 等速移動中に点がほぼ止まっている時間の割合
        acc95: accs[Math.floor(accs.length * 0.95)], accMax         // 表示の加速度（m/s²）。大きいほどカクつく
    };
}
function maxDiff(a, b, end) {  // 60Hz と 120Hz の表示の食い違い（同じ時刻で比べる）
    let d = 0, j = 0;
    for (const [t, x, y] of a) { while (j < b.length - 1 && b[j][0] < t - 1e-9) j++; if (Math.abs(b[j][0] - t) < 1e-6) d = Math.max(d, Math.hypot(b[j][1] - x, b[j][2] - y)); }
    return d;
}

/* ── シナリオ ── */
const BASE = { amax: 1.0, gmOrder: 2, gm: 3, gmTau: 20, white: 2, spike: 0.02, vel: 'full', irregular: false, drop: null, dup: 0.1 };
const SCEN = [
    ['静止60秒', [[60, 0, 0, 0]], {}],
    ['静止60秒・速度なし', [[60, 0, 0, 0]], { vel: 'none' }],
    ['静止60秒・誤差大(屋内想定)', [[60, 0, 0, 0]], { gm: 8, white: 5, spike: 0.05 }],
    ['歩行 直進', [[5, 0, 0, 0], [50, 1.4, 0, 0], [5, 0, 0, 0]], {}],
    ['歩行 直進・速度なし', [[5, 0, 0, 0], [50, 1.4, 0, 0], [5, 0, 0, 0]], { vel: 'none' }],
    ['歩行 直進・速度のみ', [[5, 0, 0, 0], [50, 1.4, 0, 0], [5, 0, 0, 0]], { vel: 'speedOnly' }],
    ['歩行 角を曲がる→信号待ち→再開', [[5, 0, 0, 0], [20, 1.4, 0, 0], [4, 1.4, null, 22.5], [15, 1.4, null, 0], [20, 0, null, 0], [20, 1.4, null, 0]], {}],
    ['歩行 測位間隔0.5〜3秒の不規則', [[5, 0, 0, 0], [50, 1.4, 45, 0], [5, 0, null, 0]], { irregular: true }],
    ['歩行 8秒途絶', [[5, 0, 0, 0], [50, 1.4, 90, 0], [5, 0, null, 0]], { drop: [25, 33] }],  // 途絶中は点を約3秒で止める設計なので「止まって見える」は途絶区間を除いて数える
    ['歩行 相関誤差が細かく揺れる(1次)', [[5, 0, 0, 0], [50, 1.4, 0, 0], [10, 0, null, 0]], { gmOrder: 1 }],
    ['静止 相関誤差が細かく揺れる(1次)', [[60, 0, 0, 0]], { gmOrder: 1 }],
    ['歩行 マルチパス多発(10%)', [[5, 0, 0, 0], [50, 1.4, 0, 0], [5, 0, null, 0]], { spike: 0.1 }],
    ['自転車 5m/s カーブ', [[5, 0, 0, 0], [20, 5, 0, 0], [10, 5, null, 9], [20, 5, null, 0], [10, 0, null, 0]], { amax: 1.5 }],
    ['車 15m/s 発進・カーブ・停止', [[5, 0, 0, 0], [3, 5, 0, 0], [30, 15, null, 0], [8, 15, null, 11], [20, 15, null, 0], [3, 5, null, 0], [10, 0, null, 0]], { amax: 2.5 }],
    ['車 15m/s・速度なし', [[5, 0, 0, 0], [40, 15, 30, 0], [15, 0, null, 0]], { vel: 'none', amax: 2.5 }]
];
/* 目標（地図ズーム18で1px≒0.25m。これを下回れば目で追えない程度） */
const GOAL = {
    restJitter: 0.02,  // 静止中のブレ（往復）2cm/s 未満（約0.1px/秒）。最悪値で判定
    restSpeed: 0.12,   // 静止中の点の動き（ゆっくりした移しを含む）平均 0.12m/s 未満（約0.5px/秒）
    speedCv:   0.25,   // 等速移動中の速さのばらつき 25% 未満
    stall:     0.02,   // 等速移動中に止まって見える時間 2% 未満
    hzDiff:    0.01    // 60Hz と 120Hz の差 1cm 未満
};

const SEEDS = +(process.argv[2] || 20);
const fmt = (v, d = 2) => v === null || v === undefined ? '  -  ' : v.toFixed(d);
let failed = 0;
const rows = [];
for (const [name, segs, o] of SCEN) {
    const opt = Object.assign({}, BASE, o);
    const agg = { old: [], neu: [] }; let hzOld = 0, hzNew = 0;
    for (let s = 1; s <= SEEDS; s++) {
        const R = rng(s * 7919 + name.length);
        const truth = makeTruth(segs, opt.amax);
        const fixes = makeFixes(truth, R, opt);
        const o60 = runOld(fixes, 60, truth.end), n60 = runNew(fixes, 60, truth.end);
        const o120 = runOld(fixes, 120, truth.end), n120 = runNew(fixes, 120, truth.end);
        if (n60.some(r => !isFinite(r[1]) || !isFinite(r[2]))) { console.error(name, 'NaN'); failed++; }
        agg.old.push(evaluate(o60, truth, opt.drop)); agg.neu.push(evaluate(n60, truth, opt.drop));
        hzOld = Math.max(hzOld, maxDiff(o60, o120)); hzNew = Math.max(hzNew, maxDiff(n60, n120));
    }
    const sum = (arr) => {
        const keys = Object.keys(arr[0]); const r = {};
        for (const k of keys) { const v = arr.map(a => a[k]).filter(v => v !== null); r[k] = v.length ? { mean: v.reduce((a, b) => a + b, 0) / v.length, max: Math.max(...v) } : null; }
        return r;
    };
    const so = sum(agg.old), sn = sum(agg.neu);
    const fails = [];
    if (sn.restJitter && sn.restJitter.max > GOAL.restJitter) fails.push('静止中のブレ');
    if (sn.restSpeed && sn.restSpeed.mean > GOAL.restSpeed) fails.push('静止中の動き');
    if (sn.speedCv && sn.speedCv.mean > GOAL.speedCv) fails.push('速さのばらつき');
    if (sn.stall && sn.stall.max > GOAL.stall) fails.push('止まって見える');
    if (hzNew > GOAL.hzDiff) fails.push('60/120Hz差');
    if (sn.rms.mean > so.rms.mean * 1.05) fails.push('誤差が旧方式より大きい');
    failed += fails.length;
    rows.push({ name, so, sn, hzOld, hzNew, fails });
}

const g = (r, k, f = 'mean', d = 2) => r[k] ? fmt(r[k][f], d) : '  -  ';
console.log(`乱数 ${SEEDS} 通りの平均（[]内は最悪値）。旧 → 新\n`);
console.log('| シナリオ | 誤差RMS m | 静止中のブレ m/s | 静止中の動き m/s | 静止10秒の動く範囲 m | 速さのばらつき | 止まって見える割合 | 加速度p95 m/s² | 60/120Hz差 m | 判定 |');
console.log('|---|---|---|---|---|---|---|---|---|---|');
for (const r of rows) {
    const c = (k, f = 'mean', d = 2) => `${g(r.so, k, f, d)} → ${g(r.sn, k, f, d)}`;
    console.log(`| ${r.name} | ${c('rms')} [${g(r.sn, 'rms', 'max')}] | ${c('restJitter', 'mean', 3)} [${g(r.sn, 'restJitter', 'max', 3)}] | ${c('restSpeed', 'mean', 3)} [${g(r.sn, 'restSpeed', 'max', 3)}] | ${c('restRange')} | ${c('speedCv')} | ${c('stall', 'mean', 3)} [${g(r.sn, 'stall', 'max', 3)}] | ${c('acc95')} | ${fmt(r.hzOld, 3)} → ${fmt(r.hzNew, 4)} | ${r.fails.length ? 'NG: ' + r.fails.join('、') : 'OK'} |`);
}
console.log(failed ? `\n目標未達 ${failed} 件` : '\nすべて目標を満たした');
process.exit(failed ? 1 : 0);
