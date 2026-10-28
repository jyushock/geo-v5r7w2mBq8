/* コンパスの向きに追従する地図の回転の検証（node tests/heading-smoother-sim.js）
   app.js の HEADING_SMOOTHER_BEGIN〜END をそのまま読み込み、実機に近いセンサーの揺れを乗せた向きを流して、
   地図に出る向き（モード2の地図の回転）を旧方式と比べる。
   ・センサー: 白色の揺れ（iOS 相当 1度、Android 相当 3度）＋ゆっくりしたずれ、届く頻度 20/60/100Hz（間隔に±20%のゆらぎ）
   ・動き: 静止、ゆっくり回す、さっと向きを変える、0/360度をまたぐ、歩きながらの揺れ、磁気の乱れ
   ・画面: 60Hz と 120Hz */
'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const m = src.match(/\/\* HEADING_SMOOTHER_BEGIN[\s\S]*?\/\* HEADING_SMOOTHER_END \*\//);
if (!m) { console.error('app.js に HEADING_SMOOTHER_BEGIN〜END が見つからない'); process.exit(2); }
const createHeadingSmoother = new Function(m[0] + '\nreturn createHeadingSmoother;')();

const diff = (a, b) => { let d = (b - a) % 360; if (d > 180) d -= 360; if (d < -180) d += 360; return d; };
const norm = (a) => ((a % 360) + 360) % 360;
function rng(seed) {
    let a = seed >>> 0;
    const u = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const n = () => { let s = 0; for (let i = 0; i < 12; i++) s += u(); return s - 6; };
    return { u, n };
}

/* センサーの値を作る。truth(t) は真の向き（度、展開済みでよい） */
function makeSamples(truth, end, R, o) {
    const out = []; let t = 0.05, drift = 0;
    while (t < end) {
        const dt = 1 / o.hz * (0.8 + 0.4 * R.u());
        drift = drift * Math.exp(-dt / 30) + R.n() * o.drift * Math.sqrt(1 - Math.exp(-2 * dt / 30));
        let v = truth(t) + drift + R.n() * o.noise;
        if (o.spikes && (t % o.spikes.every) > o.spikes.at && (t % o.spikes.every) < o.spikes.at + o.spikes.dur) v += o.spikes.deg;
        out.push([t, norm(v), drift]);
        t += dt;
    }
    return out;
}

/* 旧方式（変更前の app.js：handleOrientation の1回ごとの平滑化＋rAF の毎フレームの平滑化・2度の不感帯・0.3度未満は地図を回さない） */
function runOld(samples, hz, end) {
    let cur = null, raf = null, set = null, k = 0; const out = [];
    for (let f = 0, t = 0; t <= end; t = ++f / hz) {
        while (k < samples.length && samples[k][0] <= t) {
            const v = samples[k++][1];
            if (cur === null) cur = v;
            else { const d = diff(cur, v); cur = Math.abs(d) < 0.1 ? v : norm(cur + d * 0.03); }
        }
        if (cur === null) continue;
        if (raf === null) raf = cur;
        const d = diff(raf, cur);
        if (Math.abs(d) < 0.1) raf = cur; else if (Math.abs(d) >= 2) raf = norm(raf + d * 0.04);
        if (set === null || Math.abs(diff(set, raf)) >= 0.3) set = raf;
        out.push([t, set]);
    }
    return out;
}
function runNew(samples, hz, end) {
    const hs = createHeadingSmoother(); let k = 0; const out = [];
    for (let f = 0, t = 0; t <= end; t = ++f / hz) {
        while (k < samples.length && samples[k][0] <= t) { const s = samples[k++]; hs.addSample(s[1], s[0] * 1000); }
        const b = hs.sample(t * 1000);
        if (b !== null) out.push([t, b]);
    }
    return out;
}

/* 評価。track は [時刻, 向き]、地図の向きの変化を展開して見る */
function evaluate(track, truth, sc, smp) {
    // センサーのゆっくりしたずれ（どんな方法でも本当の回転と見分けられない）を時刻から引けるようにする
    const driftAt = (t) => { let lo = 0, hi = smp.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (smp[m][0] <= t) lo = m; else hi = m; } return smp[lo][2]; };
    const un = []; let acc = track[0][1];
    for (let i = 0; i < track.length; i++) { if (i) acc += diff(track[i - 1][1], track[i][1]); un.push([track[i][0], acc]); }
    const r = {};
    const inWin = (t, w) => w && t >= w[0] && t <= w[1];
    // 静止中のブレ：1秒ごとの道のり − 始点と終点の差（往復した分）を1秒あたりで
    if (sc.still) {
        let jit = 0, n = 0, lo = Infinity, hi = -Infinity, ranges = [], wst = null;
        for (let i = 1; i < un.length; i++) {
            const t = un[i][0]; if (!inWin(t, sc.still)) continue;
            const v = un[i][1] - driftAt(t);
            lo = Math.min(lo, v); hi = Math.max(hi, v);
        }
        for (let s = sc.still[0]; s + 1 <= sc.still[1]; s += 1) {
            const seg = un.filter(p => p[0] >= s && p[0] <= s + 1);
            let L = 0; for (let i = 1; i < seg.length; i++) L += Math.abs(seg[i][1] - seg[i - 1][1]);
            jit += L - Math.abs(seg[seg.length - 1][1] - seg[0][1]); n++;
        }
        r.jitter = jit / n;      // 度/秒
        r.range = hi - lo;       // 静止区間で地図が回った範囲（度）。センサーのゆっくりしたずれの分は除く
    }
    // 向きを変えた後に、真の向きの±3度に収まって以後出ないまでの時間と、行き過ぎ
    if (sc.turnEnd !== undefined) {
        const fin = truth(sc.turnEnd + 3), dir = Math.sign(truth(sc.turnEnd) - truth(0)) || 1;
        let settle = null, over = 0;
        for (let i = 0; i < un.length; i++) {
            const t = un[i][0]; if (t < sc.turnEnd) continue;
            const e = diff(norm(fin), norm(un[i][1]));
            over = Math.max(over, e * dir);
            if (Math.abs(e) > 3) settle = null; else if (settle === null) settle = t;
        }
        r.settle = settle === null ? 99 : settle - sc.turnEnd;
        r.overshoot = Math.max(over, 0);
    }
    // 一定の速さで回している間：遅れ（度）、止まって見えるフレームの割合、1フレームの回転の最大/平均
    if (sc.rot) {
        let lag = 0, n = 0, zero = 0, steps = [];
        for (let i = 1; i < un.length; i++) {
            const t = un[i][0]; if (!inWin(t, sc.rot)) continue;
            lag += Math.abs(diff(norm(un[i][1]), norm(truth(t)))); n++;
            const d = Math.abs(un[i][1] - un[i - 1][1]); steps.push(d); if (d < 1e-6) zero++;
        }
        const mean = steps.reduce((a, b) => a + b, 0) / steps.length;
        r.lag = lag / n; r.frozen = zero / n; r.stepRatio = Math.max(...steps) / mean;
    }
    // 歩行中の揺れ・磁気の乱れ：地図の向きが真の向きから外れた大きさ
    if (sc.wobble) {
        let mx = 0, s2 = 0, n = 0;
        for (const [t, a] of un) if (inWin(t, sc.wobble)) { const e = diff(norm(truth(t)), norm(a)); mx = Math.max(mx, Math.abs(e)); s2 += e * e; n++; }
        r.wobRms = Math.sqrt(s2 / n); r.wobMax = mx;
    }
    // 1フレームの回転の最大（0/360度またぎで一周しないか）
    let maxStep = 0; for (let i = 1; i < un.length; i++) maxStep = Math.max(maxStep, Math.abs(un[i][1] - un[i - 1][1]) / (un[i][0] - un[i - 1][0]));
    r.maxRate = maxStep;  // 度/秒
    return r;
}
function maxDiff(a, b) {
    let d = 0, j = 0;
    for (const [t, v] of a) { while (j < b.length - 1 && b[j][0] < t - 1e-9) j++; if (Math.abs(b[j][0] - t) < 1e-6) d = Math.max(d, Math.abs(diff(b[j][1], v))); }
    return d;
}

const ease = (u) => u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u);
const IOS = { hz: 60, noise: 1, drift: 0.5 }, AND = { hz: 60, noise: 3, drift: 1 };
const SCEN = [
    ['静止 iOS相当（揺れ1度）', 30, () => 40, IOS, { still: [3, 30] }],
    ['静止 Android相当（揺れ3度）', 30, () => 40, AND, { still: [3, 30] }],
    ['静止 センサー20Hz（揺れ3度）', 30, () => 40, { ...AND, hz: 20 }, { still: [3, 30] }],
    ['静止 センサー100Hz（揺れ3度）', 30, () => 40, { ...AND, hz: 100 }, { still: [3, 30] }],
    ['ゆっくり回す 15度/秒', 16, (t) => 40 + 15 * Math.min(Math.max(t - 3, 0), 8), AND, { rot: [4, 11], turnEnd: 11, still: [14, 16] }],
    ['さっと向きを変える 90度/0.5秒', 10, (t) => 40 + 90 * ease((t - 3) / 0.5), AND, { turnEnd: 3.5, still: [6.5, 10] }],
    ['0/360度をまたぐ 30度/秒', 10, (t) => 340 + 30 * Math.min(Math.max(t - 2, 0), 1.5), AND, { turnEnd: 3.5, still: [6.5, 10] }],
    ['歩きながら（±4度・1.8Hzの揺れ）', 20, (t) => 40 + 4 * Math.sin(2 * Math.PI * 1.8 * t), AND, { wobble: [3, 20] }],
    ['磁気の乱れ（30度・0.3秒を5秒ごと）', 20, () => 40, { ...AND, spikes: { every: 5, at: 2, dur: 0.3, deg: 30 } }, { wobble: [3, 20] }]
];
/* 目標（画面の角は回転の中心から約460px。1度 ≒ 8px） */
const GOAL = {
    jitter: 0.1,     // 静止中のブレ 0.1度/秒未満（角で約0.8px/秒）。最悪値
    // 静止中に地図が回る範囲（センサーのゆっくりしたずれの分を除く）は旧方式以下（平均）。
    // ずれに少し遅れて付いていく分と、最初の値の揺れが残る分があり、旧方式（2度の不感帯）でも0.75〜2.3度になるため
    settle: 0.8,     // 向きを変え終えてから±3度に収まるまで 0.8秒以内（平均）
    overshoot: 2,    // 行き過ぎ 2度未満（最悪）
    lag: 8,          // 15度/秒で回している間の遅れ 8度未満（約0.5秒）
    frozen: 0.01,    // 回している間に止まって見えるフレーム 1%未満
    stepRatio: 3,    // 1フレームの回転の最大が平均の3倍未満（段付きにならない）
    hzDiff: 0.05     // 60Hz と 120Hz の差 0.05度未満
};

const SEEDS = +(process.argv[2] || 20);
let failed = 0; const rows = [];
for (const [name, end, truth, sens, sc] of SCEN) {
    const ag = { old: [], neu: [] }; let hzO = 0, hzN = 0;
    for (let s = 1; s <= SEEDS; s++) {
        const R = rng(s * 104729 + name.length);
        const smp = makeSamples(truth, end, R, sens);
        const o60 = runOld(smp, 60, end), n60 = runNew(smp, 60, end), o120 = runOld(smp, 120, end), n120 = runNew(smp, 120, end);
        if (n60.some(p => !isFinite(p[1]))) { console.error(name, 'NaN'); failed++; }
        ag.old.push(evaluate(o60, truth, sc, smp)); ag.neu.push(evaluate(n60, truth, sc, smp));
        hzO = Math.max(hzO, maxDiff(o60, o120)); hzN = Math.max(hzN, maxDiff(n60, n120));
    }
    const sum = (arr) => { const r = {}; for (const k of Object.keys(arr[0])) { const v = arr.map(a => a[k]); r[k] = { mean: v.reduce((a, b) => a + b, 0) / v.length, max: Math.max(...v) }; } return r; };
    const so = sum(ag.old), sn = sum(ag.neu), fails = [];
    if (sn.jitter && sn.jitter.max > GOAL.jitter) fails.push('静止中のブレ');
    if (sn.range && sn.range.mean > so.range.mean * 1.05) fails.push('静止中の回転が旧方式より大きい');
    if (sn.settle && sn.settle.mean > GOAL.settle) fails.push('収まるまでの時間');
    if (sn.overshoot && sn.overshoot.max > GOAL.overshoot) fails.push('行き過ぎ');
    if (sn.lag && sn.lag.mean > GOAL.lag) fails.push('遅れ');
    if (sn.frozen && sn.frozen.max > GOAL.frozen) fails.push('止まって見える');
    if (sn.stepRatio && sn.stepRatio.mean > GOAL.stepRatio) fails.push('段付き');
    if (hzN > GOAL.hzDiff) fails.push('60/120Hz差');
    if (sn.wobRms && sn.wobRms.mean > so.wobRms.mean * 1.05) fails.push('揺れが旧方式より大きい');
    failed += fails.length;
    rows.push({ name, so, sn, hzO, hzN, fails });
}
const f = (v, d = 2) => v === undefined ? '-' : v.toFixed(d);
const c = (r, k, d = 2, w = 'mean') => r.so[k] ? `${f(r.so[k][w], d)} → ${f(r.sn[k][w], d)}` : '-';
console.log(`乱数 ${SEEDS} 通りの平均（[]内は新方式の最悪値）。旧 → 新\n`);
console.log('| シナリオ | 静止中のブレ 度/s | 静止中の回転（ずれ除く） 度 | 収まるまで s | 行き過ぎ 度 | 回転中の遅れ 度 | 止まって見える | 段付き（最大/平均） | 揺れ RMS 度 | 揺れ 最大 度 | 60/120Hz差 度 | 判定 |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of rows) {
    const mx = (k, d = 2) => r.sn[k] ? ` [${f(r.sn[k].max, d)}]` : '';
    console.log(`| ${r.name} | ${c(r, 'jitter', 3)}${mx('jitter', 3)} | ${c(r, 'range')} | ${c(r, 'settle')} | ${c(r, 'overshoot')}${mx('overshoot')} | ${c(r, 'lag')} | ${c(r, 'frozen', 3)}${mx('frozen', 3)} | ${c(r, 'stepRatio', 1)} | ${c(r, 'wobRms')} | ${c(r, 'wobMax')} | ${f(r.hzO, 3)} → ${f(r.hzN, 4)} | ${r.fails.length ? 'NG: ' + r.fails.join('、') : 'OK'} |`);
}
console.log(failed ? `\n目標未達 ${failed} 件` : '\nすべて目標を満たした');
process.exit(failed ? 1 : 0);
