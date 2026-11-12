/* HEADING_SMOOTHER_BEGIN ― tests/heading-smoother-sim.js がこの範囲を切り出して検証する。DOM・地図に依存させないこと */
/* コンパスの向きを、地図の回転に使えるなめらかな値にする
   センサーの向きは、止まっていても±1〜3度揺れ、60Hz 前後（端末により20〜100Hz）で不規則に届く。
   iOS の Google マップのように「持っているだけなら地図は止まって見え、向きを変えればすぐ・行き過ぎずに
   付いてくる」ために、2段でならす。
   (1) 追従: 一次の遅れ（目標との差の一定割合ずつ寄る）。差が小さいほど時定数を長く（センサーの揺れを拾わない）、
       大きいほど短く（本当に向きを変えたら素早く）する。大きな差が persistMs 続くまでは短くしない
       （一瞬の磁気の乱れに付いていかない）。不感帯は設けない（あると「止まる→急に回る」を繰り返す）
   (2) 仕上げ: 臨界減衰のばね（強さ一定）で (1) を追う。回転の速さが途切れず、なめらかに加速・減速する
   どちらも応答が負にならない（行き過ぎない）ならし方なので、向きを変え終えたところで地図が戻ることはない。
   値は 0/360 度をまたいでも連続になるよう展開して扱う。計算は 4ms 刻みの決まった時刻で進めるので、
   60Hz と 120Hz の画面、センサーの届く頻度に左右されない。 */
function createHeadingSmoother(options) {
    const o = Object.assign({
        preTauMs:  150,   // 届いた値を軽くならす時定数（届く頻度の違いと細かい揺れをならす）
        tauRest:   15000, // 静かなとき、差が errRest 度以下での (1) の時定数（ms）。地図はほぼ止まって見える
        tauMid:    300,   // 静かなとき、差が errSmall 度での時定数
        tauTurn:   100,   // 向きを変えている最中の時定数（差が小さくなっても、追いつくまではこの速さで寄せる）
        tauFast:   40,    // 差が errLarge 度以上で向きを変えている最中の時定数
        errRest:   2,
        errSmall:  6,
        errLarge:  25,
        persistMs: 500,   // 差が errSmall を超えてこれだけ続いたら「向きを変えている」とみなす（一瞬の乱れは除く）
        settleMs:  400,   // 差が errSmall を下回ってから「静か」に戻るまでの時定数
        turnRate:  8,     // センサーの値がこの速さ（度/s）以上で同じ向きに rateHoldMs 回り続けたら「向きを変えている」とみなす
        rateHoldMs: 300,  // （歩くときの手の揺れは0.3秒ほどで向きが入れ替わるので、これで除ける）
        rateTauMs: 300,   // その速さを測るときのならしの時定数
        omega:     15,    // (2) のばねの強さ（rad/s）。大きいほど (1) に素早く付く
        stepMs:    4,
        idleMs:    1000   // これより長く計算していなければ、最新の値へそのまま合わせる（画面に出ていない間）
    }, options || {});
    const diff = (a, b) => { let d = (b - a) % 360; if (d > 180) d -= 360; if (d < -180) d += 360; return d; };
    const ss = (a, b, x) => { const u = Math.min(Math.max((x - a) / (b - a), 0), 1); return u * u * (3 - 2 * u); };
    const lerpLog = (a, b, u) => a * Math.pow(b / a, u);
    let rawLast = null, rawUnw = 0;      // 届いた値（展開済み）
    let target = 0, pre = 0, mid = 0;    // 最新の値、軽くならした値、(1) の値
    let ang = 0, vel = 0, t0 = null;     // 表示の向き（度）と角速度（度/s）、計算済みの時刻
    let persist = 0;                     // 大きな差が続いている度合い（0〜1）
    let turning = 0;                     // 向きを変えている度合い（0〜1）。静かになると settleMs でゆっくり0へ
    let rate = 0, rateHeld = 0;          // センサーの値が回る速さ（度/s、ならしたもの）と、それが同じ向きに続いた時間（ms、符号付き）
    const queue = [];                    // まだ反映していない値 [時刻, 展開済みの値]

    function step(h) {
        const ms = h * 1000, prev = pre;
        pre += (target - pre) * (1 - Math.exp(-ms / o.preTauMs));
        rate += ((pre - prev) / h - rate) * (1 - Math.exp(-ms / o.rateTauMs));
        const e = Math.abs(pre - mid);
        persist = e > o.errSmall ? Math.min(persist + ms / o.persistMs, 1) : 0;
        const dir = Math.abs(rate) >= o.turnRate ? Math.sign(rate) : 0;
        rateHeld = dir === 0 ? 0 : Math.sign(rateHeld) === dir ? rateHeld + dir * ms : dir * ms;
        turning = persist >= 1 || Math.abs(rateHeld) >= o.rateHoldMs ? 1 : turning * Math.exp(-ms / o.settleMs);
        const quiet = e <= o.errSmall
            ? lerpLog(o.tauRest, o.tauMid, ss(o.errRest, o.errSmall, e))
            : o.tauMid;
        const active = lerpLog(o.tauTurn, o.tauFast, ss(o.errSmall, o.errLarge, e));
        const tau = lerpLog(quiet, active, turning);
        mid += (pre - mid) * (1 - Math.exp(-ms / tau));
        vel += (o.omega * o.omega * (mid - ang) - 2 * o.omega * vel) * h;
        ang += vel * h;
    }
    function reset(v, now) { target = pre = mid = ang = v; vel = 0; persist = 0; turning = 1; rate = 0; rateHeld = 0; t0 = now; }  // 最初の値は揺れを含むので、しばらく素早く寄せてから静かにする
    function advance(now) {
        if (t0 === null) return;
        if (now - t0 > o.idleMs) {       // しばらく計算していなかった → 最新の値へ合わせる
            while (queue.length) target = queue.shift()[1];
            reset(target, now);
            return;
        }
        const h = o.stepMs;
        while (t0 + h <= now) {
            while (queue.length && queue[0][0] <= t0) target = queue.shift()[1];
            step(h / 1000);
            t0 += h;
        }
    }
    return {
        // 向き（度、真北から時計回り）を1つ取り込む。now は表示側の時計（performance.now）
        addSample(deg, now) {
            rawUnw = rawLast === null ? deg : rawUnw + diff(rawLast, deg);
            rawLast = deg;
            if (t0 === null) { reset(rawUnw, now); return; }
            advance(now);
            queue.push([now, rawUnw]);
        },
        // 時刻 now の表示の向き（0〜360度）。まだ値が無ければ null
        sample(now) {
            if (t0 === null) return null;
            advance(now);
            const a = ang + vel * Math.max(now - t0, 0) / 1000;
            return ((a % 360) + 360) % 360;
        }
    };
}
/* HEADING_SMOOTHER_END */

// 向きのならし。地図の回転（モード2）と扇（モード1）は、どちらもここから毎フレーム読む
const headingSmoother = createHeadingSmoother();

// 角度の差分を-180〜180の範囲で計算するヘルパー（最短距離で回転させるため）
function getShortestAngleDiff(current, target) {
    let diff = target - current;
    while (diff < -180) diff += 360;
    while (diff > 180) diff -= 360;
    return diff;
}

// handleOrientation: 信頼できるabsolute系イベントのみ使用
// absolute=falseのdeviceorientationは端末起動時基準のため180度ずれが起きるので無視
function handleOrientation(event) {
    let rawHeading = null;

    if (event.webkitCompassHeading !== undefined) {
        // iOS: webkitCompassHeading は真北基準で信頼性が高い
        rawHeading = event.webkitCompassHeading;

    } else if (event.type === 'deviceorientationabsolute' && event.alpha !== null) {
        // Android: absolute版は地磁気北基準なので信頼できる
        rawHeading = (360 - event.alpha) % 360;

    } else if (event.type === 'deviceorientation' && event.absolute === true && event.alpha !== null) {
        // absolute=trueのdeviceorientationも同等
        rawHeading = (360 - event.alpha) % 360;

    } else {
        // absolute=false のdeviceorientationは信頼できないため無視
        return;
    }

    // 画面の向き（縦・横）を補正
    let screenAngle = 0;
    if (window.screen && window.screen.orientation) {
        screenAngle = window.screen.orientation.angle;
    } else if (typeof window.orientation === 'number') {
        screenAngle = window.orientation;
    }

    const targetHeading = (rawHeading + screenAngle + 360) % 360;
    // ならしは createHeadingSmoother に任せる（イベントの届く頻度に左右されないよう、届いた時刻を添える）
    const now = performance.now();
    headingSmoother.addSample(targetHeading, now);
    deviceHeading = headingSmoother.sample(now);
    // 地図の回転と扇アイコンの更新はrAFループに一本化（ここでは行わない）
}

// --- 現在地の表示位置と地図カメラを rAF でなめらかに追従させる ---
/* 位置の推定と、毎フレームの表示位置の計算は createLocationSmoother（下）にまとめてある。
   ここでは、その表示位置へマーカーを置き、追従中は地図カメラも合わせる。
   表示位置は時刻だけで決まるので、60Hz の端末と 120Hz の端末で動きが変わらない。 */
let rafLng       = null;  // 表示中の現在地
let rafLat       = null;
let rafId        = null;  // ループID（nullなら停止中）
let cameraFollow = false; // true の間だけ地図カメラを表示位置へ追従させる
let prevSetBearing = null;
let prevSetLng     = null;
let prevSetLat     = null;
let prevSetPitch   = null;

/* LOCATION_SMOOTHER_BEGIN ― tests/location-smoother-sim.js がこの範囲を切り出して検証する。DOM・地図に依存させないこと */
/* 現在地の推定と表示位置の計算
   GPS の位置は、止まっていても数m揺れ、動いていても約1秒ごとに（ときに不規則に）しか届かない。
   iOS の Google マップのように「止まっていれば点は動かず、動いていれば測位の合間も一定の速さで
   進み続け、予測がずれたら速度を急に変えずに寄せる」ために、2段に分けて扱う。
   (1) 推定: 位置と速度を状態に持つカルマンフィルタ（東西・南北の各軸）。
       ・測位の精度（accuracy）で重み付けする。精度の悪い位置ほど効かない
       ・端末が速度・進行方向を返すときは、それも観測として使い、速度の変化から加減速も見て予測に入れる
       ・想定より大きく外れた位置が来たら「動き出した/曲がった」とみなし、想定加速度を上げて追いつく
       ・単発で大きく外れた位置（マルチパス等）は捨てる。2回続けて同じ所に出たら本物として、
         同じ向きに続けて外れたら加減速として受け入れる
   (2) 表示: 推定位置から推定速度で先へ進めた位置を、時刻の関数として出す（測位の合間も止まらない）。
       ・新しい測位で推定が変わったときの差は、位置も速度も連続になる3次曲線で寄せる（カクつかない）
       ・止まっていると判断したら点を固定し、推定が精度に見合う以上に離れたときだけゆっくり移す
       ・測位が途絶えたら、予定の間隔（端末が速度と進行方向を返して動いていたなら8秒）を過ぎたところから
         なめらかに減速して止まる
   検証は tests/location-smoother-sim.js、結果は tests/location-smoother-report.md。
   時刻だけで位置が決まるので、60Hz と 120Hz の端末で動きが変わらない。 */
function createLocationSmoother(options) {
    const o = Object.assign({
        accelBase:    0.3,   // 等速・静止時に想定する加速度（m/s²）。小さいほど揺れを抑える
        accelMax:     6,     // 動き出し・曲がり角で引き上げる上限
        minAccuracy:  3,     // 端末が返す精度がこれより良くても、この値として扱う（m）
        outlierNis:   14,    // これを超えて外れた位置は単発なら捨てる（2自由度のχ²で約99.9%）
        blendMs:      2000,  // 推定の位置の変化を表示へ寄せるのにかける時間（移動中）
        velBlendMs:   700,   // 推定の速度の変化を表示へ寄せるのにかける時間（長いとブレーキ時に行き過ぎる）
        stillBlendMs: 2500,  // 静止中に点を移すときにかける時間（下限）
        stillGlide:   0.3,   // 静止中に点を移すときの速さの上限の目安（m/s）
        fadeMs:       1000,  // 測位が途絶えたときに減速して止まるまでの時定数
        speedRScale:  2,     // 端末の速度があるときに位置の誤差分散を何倍とみなすか
        stillMove:    4,     // 静止中、推定がこの距離（と精度の stillMoveAcc 倍の大きい方）より離れたら点を移す（m）
        stillMoveAcc: 0.6,
        jumpMeters:   200,   // これより大きく推定が動いたら、寄せずに一気に移す
        rebaseMeters: 5000   // 平面近似の原点からこれだけ離れたら原点を移す
    }, options || {});
    const M_PER_DEG = 111320;
    let lat0 = null, lng0 = null, mx = 0;  // 平面近似の原点と、経度1度あたりのm
    let x = 0, y = 0, vx = 0, vy = 0;     // 推定状態（m, m/s）
    let Px, Py;                           // 各軸の共分散 [pp, pv, vv]
    let lastTs = null;                    // 最後に受け入れた測位の時刻（端末の測位時刻, ms）
    let accel = o.accelBase;
    let pending = null;                   // 単発の外れ値の候補 {x, y, ts}
    let interval = 1000;                  // 測位間隔の移動平均（ms）
    let still = null, stillRun = 0;       // 静止中の表示位置 {x, y} と、静止と判断した測位の連続数
    let moveRun = 0;                      // 静止中に「動いた」と判断した測位の連続数
    let lastBig = null;                   // 前回の測位が想定より大きく外れていたときの、そのずれ [東, 北]
    let lastSp = null, alongAcc = 0;      // 前回の端末の速度と、そこから求めた進行方向の加減速（m/s²）
    let dirKnown = false;                 // 直近の測位で、端末が速度と進行方向の両方を返し、動いていたか
    let anchor = null;                    // 表示の起点 {x, y, vx, vy, t}（t は表示側の時計）
    let corr = null;                      // 表示の寄せ {dx, dy, dvx, dvy, t, T}

    function toXY(la, ln) { return [(ln - lng0) * mx, (la - lat0) * M_PER_DEG]; }
    function toLatLng(px, py) { return { lat: lat0 + py / M_PER_DEG, lng: lng0 + px / mx }; }
    function setOrigin(la, ln) { lat0 = la; lng0 = ln; mx = M_PER_DEG * Math.cos(la * Math.PI / 180); }

    function predictAxis(P, dt, a) {
        const q = a * a, dt2 = dt * dt;
        return [
            P[0] + 2 * dt * P[1] + dt2 * P[2] + q * dt2 * dt2 / 4,
            P[1] + dt * P[2] + q * dt2 * dt / 2,
            P[2] + q * dt2
        ];
    }
    // 位置の観測で1軸を更新する。戻り値は [p, v, P]
    function updatePos(p, v, P, z, R) {
        const S = P[0] + R, k0 = P[0] / S, k1 = P[1] / S, e = z - p;
        return [p + k0 * e, v + k1 * e, [(1 - k0) * P[0], (1 - k0) * P[1], P[2] - k1 * P[1]]];
    }
    // 速度の観測で1軸を更新する
    function updateVel(p, v, P, z, R) {
        const S = P[2] + R, k0 = P[1] / S, k1 = P[2] / S, e = z - v;
        return [p + k0 * e, v + k1 * e, [P[0] - k0 * P[1], (1 - k1) * P[1], (1 - k1) * P[2]]];
    }
    // vel: 端末の速度から分かる初速 [東, 北]。knownSpeed: 端末が速度を返している（静止なら0と分かっている）
    function init(px, py, acc, vel, knownSpeed) {
        x = px; y = py; vx = vel ? vel[0] : 0; vy = vel ? vel[1] : 0;
        const vv = knownSpeed ? 0.25 : 9;
        Px = [acc * acc, 0, vv]; Py = [acc * acc, 0, vv];
        accel = o.accelBase; pending = null; still = null; stillRun = 0; moveRun = 0; alongAcc = 0;
    }
    // 表示に使う速度。推定の不確かさに比べて小さい速度は0へ縮める（測り始めや速度の無い端末で、
    // 揺れを速度と取り違えて点が流れていかないように）。はっきり動いていればほぼそのまま
    function shownVel() {
        const v2 = vx * vx + vy * vy, pv = (Px[2] + Py[2]) / 2;
        const k = v2 * v2 / (v2 * v2 + pv * pv + 1e-12);  // 速度が不確かさの数倍あれば ほぼ1、同程度以下なら急に0へ
        return [vx * k, vy * k];
    }
    // 最後に受け入れた測位からこの時間までは等速で進める（外れ値を1回捨てても減速しないよう、間隔の2.5倍）。
    // 端末が速度と進行方向を返して動いていたなら、測位が途絶えても（トンネル・ビルの谷間）8秒までは進め続ける
    function holdMs() { return dirKnown ? 8000 : Math.min(Math.max(interval * 2.5, 2000), 4000); }

    // 表示側の時刻 now における表示位置と表示速度（m, m/s）。まだ測位が無ければ null
    function displayState(now) {
        if (!anchor) return null;
        const dt = Math.max(now - anchor.t, 0) / 1000, hold = holdMs() / 1000, fade = o.fadeMs / 1000;
        // 進行方向に沿って、hold までは加減速 a を含めて進め（減速なら速さ0で止める）、
        // その先は fade の時定数で減速して止まる（どこでも速度は連続）
        const v0 = Math.hypot(anchor.vx, anchor.vy), a = anchor.a;
        const t1 = Math.min(dt, hold), tStop = a < 0 ? v0 / -a : Infinity, te = Math.min(t1, tStop);
        let dist = v0 * te + a * te * te / 2, sv = a < 0 && t1 >= tStop ? 0 : v0 + a * t1;
        if (dt > hold) { const e = Math.exp(-(dt - hold) / fade); dist += sv * fade * (1 - e); sv *= e; }
        const ux = v0 > 0 ? anchor.vx / v0 : 0, uy = v0 > 0 ? anchor.vy / v0 : 0;
        let px = anchor.x + ux * dist, py = anchor.y + uy * dist;
        let pvx = ux * sv, pvy = uy * sv;
        if (corr) {
            // 3次エルミート曲線で寄せる。位置の差 dx は T かけて、速度の差 dv は Tv（≦T）かけて0にする。
            // どちらも始点で値と傾きが元の表示と一致し、終点で0になるので、位置も速度も途切れない
            // （速度の差を長い T で寄せると、その間ずっと流れ続けてしまうので Tv は短く切る）
            const el = now - corr.t;
            const u = el / corr.T, uv = el / corr.Tv;
            if (u < 1) {
                const T = corr.T / 1000, u2 = u * u, u3 = u2 * u;
                const a = 2 * u3 - 3 * u2 + 1, da = (6 * u2 - 6 * u) / T;
                px += corr.dx * a; py += corr.dy * a;
                pvx += corr.dx * da; pvy += corr.dy * da;
            }
            if (uv < 1) {
                const Tv = corr.Tv / 1000, u2 = uv * uv, u3 = u2 * uv;
                const b = (u3 - 2 * u2 + uv) * Tv, db = 3 * u2 - 4 * uv + 1;
                px += corr.dvx * b; py += corr.dvy * b;
                pvx += corr.dvx * db; pvy += corr.dvy * db;
            }
        }
        return { x: px, y: py, vx: pvx, vy: pvy };
    }

    // 表示の起点を今の推定（静止中なら静止位置）へ移し、それまでの表示との差を寄せる
    // slow: 溜まったずれを急に取り戻さないよう、ゆっくり寄せる（静止から動き出した直後と、端末の速度が無いとき）
    function reanchor(now, prev, snap, slow) {
        const [svx, svy] = shownVel();
        const a = Math.abs(alongAcc) >= 0.5 ? alongAcc : 0;
        anchor = still ? { x: still.x, y: still.y, vx: 0, vy: 0, a: 0, t: now } : { x, y, vx: svx, vy: svy, a, t: now };
        corr = null;
        if (prev && !snap && Math.hypot(prev.x - anchor.x, prev.y - anchor.y) <= o.jumpMeters) {
            // 静止中に点を移すときは、ゆっくり（最大でも約 stillGlide m/s）動かす
            // slow のときは、寄せる速さが自分の速さ（最低 1.5m/s）を超えないよう、ずれが大きいほど時間をかける
            // （3次曲線の速さの最大は ずれ×1.5/T）。どちらも離れたまま長く引きずらないよう上限を設ける
            const d = Math.hypot(prev.x - anchor.x, prev.y - anchor.y);
            const T = still ? Math.min(Math.max(o.stillBlendMs, 1500 * d / o.stillGlide), 12000)
                    : slow ? Math.min(Math.max(o.blendMs, 1500 * d / Math.max(1.5, Math.hypot(anchor.vx, anchor.vy))), 4000)
                    : o.blendMs;
            corr = { dx: prev.x - anchor.x, dy: prev.y - anchor.y, dvx: prev.vx - anchor.vx, dvy: prev.vy - anchor.vy,
                     t: now, T, Tv: Math.min(T, o.velBlendMs) };
        }
    }

    // 原点から遠ざかったら原点を移す（平面近似の誤差を抑える）。表示の起点や静止位置も移し替える
    function rebaseIfFar() {
        if (Math.hypot(x, y) <= o.rebaseMeters) return;
        const conv = (px, py) => { const ll = toLatLng(px, py); return ll; };
        const eLL = conv(x, y);
        const aLL = anchor ? conv(anchor.x, anchor.y) : null;
        const sLL = still ? conv(still.x, still.y) : null;
        const pLL = pending ? conv(pending.x, pending.y) : null;
        setOrigin(eLL.lat, eLL.lng);
        x = 0; y = 0;
        if (aLL) [anchor.x, anchor.y] = toXY(aLL.lat, aLL.lng);
        if (sLL) [still.x, still.y] = toXY(sLL.lat, sLL.lng);
        if (pLL) [pending.x, pending.y] = toXY(pLL.lat, pLL.lng);
    }

    // 測位を1件取り込む。fix は Geolocation の Position と同じ形、now は表示側の時計（performance.now）
    function addFix(fix, now) {
        const c = fix.coords;
        const acc = Math.max(c.accuracy || 0, o.minAccuracy);
        const ts = fix.timestamp;
        // 端末の速度（m/s）と進行方向（真北から時計回りの度）。無効なら null
        const sp = (typeof c.speed === 'number' && isFinite(c.speed) && c.speed >= 0) ? c.speed : null;
        const hd = (typeof c.heading === 'number' && isFinite(c.heading)) ? c.heading : null;
        const velOf = (s, h) => [s * Math.sin(h * Math.PI / 180), s * Math.cos(h * Math.PI / 180)];

        if (lat0 === null) {
            setOrigin(c.latitude, c.longitude);
            init(0, 0, acc, sp !== null && hd !== null && sp >= 0.5 ? velOf(sp, hd) : null, sp !== null && (sp < 0.3 || hd !== null));
            lastTs = ts;
            reanchor(now, null, true);
            return { accepted: true, jumped: true };
        }
        // 同じ測位の再送や時刻の逆行は捨てる（捨てた外れ値の再送も、2回目の外れ値と数えないよう捨てる）
        if (!(ts > lastTs) || (pending && !(ts > pending.ts))) return { accepted: false };

        rebaseIfFar();
        const prev = displayState(now);
        const dt = Math.min((ts - lastTs) / 1000, 60);
        const [zx, zy] = toXY(c.latitude, c.longitude);
        // GPS の誤差は前後の測位で似た向きに出る（独立でない）ので、1回の位置が持つ情報は見かけより少ない。
        // 端末の速度で動きが分かるときは、位置の重みを下げて速度に任せる（位置のずれに振られて速さが揺れないよう）
        const R = acc * acc * (sp !== null ? o.speedRScale : 1);

        let Pxp = predictAxis(Px, dt, accel), Pyp = predictAxis(Py, dt, accel);
        // 予測。端末の速度の変化から加減速が分かっていれば、進行方向にそれを含める（減速なら速さ0で止める）。
        // 等速と仮定すると、ブレーキ中に予測が先へ行き過ぎ、測った速度で引き戻されて位置まで後ろへずれる
        let xp, yp, pvx0 = vx, pvy0 = vy;
        {
            const v0 = Math.hypot(vx, vy), a = Math.abs(alongAcc) >= 0.5 && v0 > 0.3 ? alongAcc : 0;
            const te = a < 0 ? Math.min(dt, v0 / -a) : dt, d = v0 * te + a * te * te / 2;
            const ux = v0 > 0 ? vx / v0 : 0, uy = v0 > 0 ? vy / v0 : 0, v1 = Math.max(v0 + a * dt, 0);
            xp = x + ux * d; yp = y + uy * d; pvx0 = ux * v1; pvy0 = uy * v1;
        }
        // 外れ具合は端末の精度そのもので測る（重みを下げた R で測ると、マルチパスの飛びを見逃す）
        const R0 = acc * acc;
        let nis = (zx - xp) ** 2 / (Pxp[0] + R0) + (zy - yp) ** 2 / (Pyp[0] + R0);

        // 前回も同じ向きに大きくずれていたなら、外れ値ではなく加減速・旋回（予測の方が外れている）とみなして受け入れる。
        // マルチパスの飛びは向きがばらばらで続かないが、ブレーキ中は毎回「予測より手前」に出る
        const maneuver = lastBig && (zx - xp) * lastBig[0] + (zy - yp) * lastBig[1] > 0;
        if (nis > o.outlierNis && !maneuver) {
            // 単発の外れ値は捨てる。ただし前回の外れ値と同じ所なら本物（瞬間移動・トンネル明け等）として受け入れ直す
            // 「同じ所」は、2回の間にありうる移動（端末の速度、無ければ推定速度＋3m/s）と精度の範囲内
            const vmax = sp !== null ? sp + 3 : Math.hypot(vx, vy) + 3;
            const near = pending && Math.hypot(zx - pending.x, zy - pending.y) <= 2 * acc + vmax * Math.min((ts - pending.ts) / 1000, 10);
            if (!near) {
                pending = { x: zx, y: zy, ts };
                return { accepted: false };
            }
            const jump = Math.hypot(zx - x, zy - y);
            init(zx, zy, acc, sp !== null && hd !== null && sp >= 0.5 ? velOf(sp, hd) : null, sp !== null && (sp < 0.3 || hd !== null));
            lastTs = ts;
            reanchor(now, prev, jump > o.jumpMeters);
            return { accepted: true, jumped: jump > o.jumpMeters };
        }
        pending = null;

        // 想定より外れている（2自由度で期待値2、95%点が約6）→ 動き出し・曲がり角とみなして想定加速度を上げ、予測からやり直す
        if (nis > 6) {
            // 2回続けて同じ向きにずれたら、本当に加減速・旋回している。ずれを説明できる大きさ（ずれ = a·dt²/2）まで
            // 一気に上げる（少しずつ上げると、止まった車に追いつくまで数秒かかる）。単発なら控えめに上げる（マルチパスに振られないよう）
            const ix = zx - xp, iy = zy - yp;  // （予測からのずれ）
            const same = lastBig && ix * lastBig[0] + iy * lastBig[1] > 0;
            const need = 2 * Math.hypot(ix, iy) / Math.max(dt * dt, 0.25);
            accel = Math.min(same ? Math.max(accel * 2.5, need * 0.5) : accel * 1.5, o.accelMax);
            lastBig = [ix, iy];
            Pxp = predictAxis(Px, dt, accel); Pyp = predictAxis(Py, dt, accel);
        } else {
            accel = Math.max(accel * 0.8, o.accelBase);
            lastBig = null;
        }

        let r = updatePos(xp, pvx0, Pxp, zx, R); xp = r[0]; let nvx = r[1]; Pxp = r[2];
        r = updatePos(yp, pvy0, Pyp, zy, R); yp = r[0]; let nvy = r[1]; Pyp = r[2];

        // 速度の観測。位置が大きく外れているとき（端末の速度が追いついていない）は使わない
        if (sp !== null && nis <= 6) {
            let vz = null;
            if (sp < 0.3) vz = [0, 0];
            else if (hd !== null) vz = velOf(sp, hd);
            else {
                // 進行方向が無いときは、推定速度の向きに端末の速さを当てはめる（向きが定まらないうちは使わない）
                const n = Math.hypot(nvx, nvy);
                if (n > 0.3) vz = [nvx / n * sp, nvy / n * sp];
            }
            if (vz) {
                const Rv = (0.4 + 0.1 * sp) ** 2;
                r = updateVel(xp, nvx, Pxp, vz[0], Rv); xp = r[0]; nvx = r[1]; Pxp = r[2];
                r = updateVel(yp, nvy, Pyp, vz[1], Rv); yp = r[0]; nvy = r[1]; Pyp = r[2];
            }
        }
        x = xp; y = yp; vx = nvx; vy = nvy; Px = Pxp; Py = Pyp;
        // 端末の速度の変化から進行方向の加減速を求める（ブレーキ・発進で表示が行き過ぎたり遅れたりしないよう、先読みに使う）。
        // 速度の揺れを拾わないよう、2回分をならし、小さいものは0とみなす
        if (sp !== null && lastSp !== null && dt > 0) {
            alongAcc = alongAcc * 0.5 + Math.max(Math.min((sp - lastSp) / dt, 4), -6) * 0.5;
        } else alongAcc = 0;
        lastSp = sp;
        dirKnown = sp !== null && hd !== null && sp >= 0.5;
        interval = interval * 0.8 + Math.min(ts - lastTs, 5000) * 0.2;
        lastTs = ts;

        // 静止の判定（ヒステリシス付き）。端末の速度があればそれで、無ければ推定速度で決める
        const v = Math.hypot(...shownVel());
        const dev = still ? Math.hypot(x - still.x, y - still.y) : 0;
        const stillEv = sp !== null ? sp < 0.3 : v < 0.3;
        // 速度が無い端末では、推定速度に加えて静止位置から実際に離れていることも条件にする（揺れで抜けないように）
        const moveEv  = sp !== null ? sp >= 0.5 : (v >= 0.6 && dev > Math.max(2, 0.5 * acc));
        if (still) {
            // 端末の速度がはっきり出ていれば（1m/s 以上）1回で、そうでなければ2回続けて「動いた」と出たら動き出したとみなす
            // （止まっていても端末の速度が一瞬 0.5m/s 程度出ることがあり、それで点が動かないように）
            moveRun = moveEv || dev > Math.max(8, 2 * acc) ? moveRun + 1 : 0;
            if (moveRun >= (sp !== null && sp >= 1 ? 1 : 2)) {
                still = null; stillRun = 0; moveRun = 0;  // 動き出した
                reanchor(now, prev, false, true);
            } else if (dev > Math.max(o.stillMove, o.stillMoveAcc * acc)) {
                still = { x, y };                    // 推定が精度に見合う以上に離れたので、点をゆっくり移す
                reanchor(now, prev, false, sp === null);
            }
            // それ以外は点を動かさない（表示の起点はそのまま）
        } else {
            stillRun = stillEv ? stillRun + 1 : 0;
            // 端末が速度0と言っていれば1回で、速度が無い端末では推定で2回続けて静止とみなす
            if (stillRun >= (sp !== null ? 1 : 2)) {
                // 止まったら、点は今表示している所で止める（推定がまだ落ち着いていないので、
                // 推定位置へ戻すと止まった後に点が行ったり来たりする）。推定から離れすぎていれば推定位置へ
                still = prev && Math.hypot(prev.x - x, prev.y - y) <= Math.max(4, 0.8 * acc) ? { x: prev.x, y: prev.y } : { x, y };
            }
            reanchor(now, prev, false, sp === null);
        }
        return { accepted: true, jumped: false };
    }

    return {
        addFix,
        // 表示位置 {lat, lng}。まだ測位が無ければ null
        sample(now) { const p = displayState(now); return p ? toLatLng(p.x, p.y) : null; },
        // 推定位置（表示の寄せや先読みを含まない）
        estimate() { return lat0 === null ? null : toLatLng(x, y); },
        // 表示位置が now の時点でまだ動いているか（rAF ループを止めてよいかの判断用）
        isMoving(now) {
            if (!anchor) return false;
            if (corr && now - corr.t < Math.max(corr.T, corr.Tv)) return true;
            if (Math.hypot(anchor.vx, anchor.vy) < 0.01 && !anchor.a) return false;
            return now - anchor.t < holdMs() + 6 * o.fadeMs;
        }
    };
}
/* LOCATION_SMOOTHER_END */

const locSmoother = createLocationSmoother();

function ensureRafLoop() {
    if (rafId !== null) return;
    rafId = requestAnimationFrame(locationRafLoop);
}

// 地図カメラの追従を始める（追従モードがオフのまま呼ばれたら何もしない。
// 現在地への easeTo 中にドラッグで追従を解除した場合、moveend から遅れて呼ばれるため）
function startRafLoop() {
    if (trackingMode === 0) return;
    cameraFollow = true;
    ensureRafLoop();
}

// 地図カメラの追従をやめる。マーカーはループ側が、表示位置が止まるまで動かし続ける
function stopRafLoop() {
    cameraFollow = false;
    prevSetBearing = null;
    prevSetLng     = null;
    prevSetLat     = null;
    prevSetPitch   = null;
}

