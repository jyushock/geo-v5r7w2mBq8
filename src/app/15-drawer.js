// ══ 下から出るドロワー共通：下方向スワイプで閉じる ══════════════════════
/* GoogleMap のドロワーと同じく、ハンドル部だけでなくシート本文からも下スワイプで閉じる。
   本文起点のときは、内側のスクロール領域が最上部(scrollTop<=0)のときだけドラッグを開始し、
   途中までスクロール済みなら通常のスクロールを優先する。

   入力経路を2本に分ける:
     タッチ … Touch Events。ドラッグ確定後の touchmove を preventDefault して、
              ブラウザのスクロール／オーバースクロールに主導権を渡さない（passive:false 必須）。
     マウス … Pointer Events を pointerType==='mouse' に限定。ドラッグ確定後に
              setPointerCapture し、起点要素が再描画で外れても pointermove/up が届くようにする。
   pointerType で振り分けることで、1操作が両経路で二重処理されるのを防ぐ。

   タップとの区別は移動量 SWIPE_SLOP で行い、ドラッグが成立した場合は直後の click を
   キャプチャ段階で握りつぶす（カテゴリ項目やリンクの誤発火防止）。
   抑止フラグは次のジェスチャ開始(down)で必ず落とすため、時間で解除する必要がなく、
   無関係な後続タップを巻き込まない。 */
/* 感度の調整はこの2定数だけで行う。
   SWIPE_SLOP を下げるとドラッグ開始が早くなるが、本文最上部での軽い引き下げを
   スクロールと誤認しにくくなる代わりに、意図しないドラッグ開始が増える。
   SWIPE_CLOSE_DIST を下げると少ないスワイプ量で閉じる。 */
const SWIPE_SLOP = 8;         // タップ／スクロールとドラッグを分ける移動量(px)
const SWIPE_CLOSE_DIST = 30;  // 下に振り切ったと判定する移動量(px)

/* 開いているときの bottom。下部バーの上に載せるシートだけ 0 でない（CSS の --sheet-base）。
   引きずり位置と復帰位置をここから決めるので、ベースを変えるときは CSS だけ直せばよい。 */
function sheetBaseBottom(el) {
    return parseFloat(getComputedStyle(el).getPropertyValue('--sheet-base')) || 0;
}

function enableSheetSwipeClose(panel, headerEl, onClose, blockSelector) {
    const baseBottom = sheetBaseBottom(panel);
    let startX = 0, startY = 0;
    let armed = false, dragging = false, swallowClick = false;
    let capturePointerId = null;   // マウス経路のみ。ドラッグ確定時に捕捉するため保持する

    // 起点要素から見た、パネル内側の直近のスクロール可能な祖先
    function scrollerAt(target) {
        let el = (target instanceof Element) ? target : null;
        while (el && el !== panel && panel.contains(el)) {
            const ov = getComputedStyle(el).overflowY;
            if ((ov === 'auto' || ov === 'scroll') && el.scrollHeight > el.clientHeight + 1) return el;
            el = el.parentElement;
        }
        return null;
    }

    function down(target, x, y, pointerId) {
        armed = false;
        dragging = false;
        swallowClick = false;   // 前ジェスチャの抑止を持ち越さない
        capturePointerId = (pointerId === undefined) ? null : pointerId;
        if (!(target instanceof Element)) return;
        if (blockSelector && target.closest(blockSelector)) return;
        startX = x;
        startY = y;
        const sc = (headerEl && headerEl.contains(target)) ? null : scrollerAt(target);
        armed = !sc || sc.scrollTop <= 0;
    }

    // 戻り値: ドラッグ中なら true（呼び出し側でブラウザ既定動作を止める）
    function move(x, y) {
        if (!armed) return false;
        const dy = y - startY;
        if (!dragging) {
            if (dy <= SWIPE_SLOP) {
                // 上・横に先に振れた操作はスクロール／横スワイプとみなし、以後拾わない
                if (dy < -SWIPE_SLOP || Math.abs(x - startX) > SWIPE_SLOP) armed = false;
                return false;
            }
            dragging = true;
            // 捕捉はドラッグが確定してから行う。pointerdown 時点で捕捉すると
            // 以後の click のターゲットが panel に差し替わり、シート内のボタンや
            // リンクが一切反応しなくなる（CDPの実マウス入力で確認済み）。
            if (capturePointerId !== null) {
                try { panel.setPointerCapture(capturePointerId); } catch (_) {}
            }
            panel.style.transition = 'none';
        }
        panel.style.bottom = `${baseBottom - (dy - SWIPE_SLOP)}px`;
        return true;
    }

    function restore() {
        panel.style.transition = '';
        panel.style.bottom = `${baseBottom}px`;
    }

    function up(y) {
        if (!armed) return;
        const wasDragging = dragging;
        const dy = y - startY;
        armed = false;
        dragging = false;
        if (!wasDragging) return;
        if (dy > SWIPE_CLOSE_DIST) onClose(); else restore();
        swallowClick = true;   // touchend / pointerup 直後に来る click を1回だけ捨てる
    }

    function cancel() {
        if (dragging) restore();
        armed = false;
        dragging = false;
    }

    panel.addEventListener('click', (e) => {
        if (!swallowClick) return;
        swallowClick = false;
        e.stopPropagation();
        e.preventDefault();
    }, true);

    panel.addEventListener('touchstart', (e) => {
        if (e.touches.length !== 1) { cancel(); return; }
        down(e.target, e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });
    panel.addEventListener('touchmove', (e) => {
        if (e.touches.length !== 1) { cancel(); return; }
        if (move(e.touches[0].clientX, e.touches[0].clientY)) e.preventDefault();
    }, { passive: false });
    panel.addEventListener('touchend', (e) => up(e.changedTouches[0].clientY), { passive: true });
    panel.addEventListener('touchcancel', cancel, { passive: true });

    panel.addEventListener('pointerdown', (e) => {
        if (e.pointerType !== 'mouse') return;
        down(e.target, e.clientX, e.clientY, e.pointerId);
    });
    panel.addEventListener('pointermove', (e) => {
        if (e.pointerType === 'mouse') move(e.clientX, e.clientY);
    });
    panel.addEventListener('pointerup', (e) => {
        if (e.pointerType === 'mouse') up(e.clientY);
    });
    panel.addEventListener('pointercancel', (e) => {
        if (e.pointerType === 'mouse') cancel();
    });
}

/* シート内の縦スクロール領域は、スクロール不能な間だけ touch-action を none にする。

   overscroll-behavior: contain は「スクロール可能なオーバーフローを持たないコンテナには
   効かない」部分実装（Safari 16+ / Chrome 63-143）。そのため内容が短くスクロール不要な
   状態では防波堤が無くなり、本文起点の下スワイプがドキュメントまで波及する。iOSでは
   ビューポートごとバウンスし、背後の地図が下にずれて上端に隙間が出る。
   スクロール不能なら pan-y を許す理由がないので、none にしてブラウザ側で塞ぐ。

   touchmove の preventDefault を SWIPE_SLOP 到達前に前倒しする手もあるが、
   W3C Touch Events はキャンセルされたタッチに続くマウスイベント／click を
   発火させないと規定しており、指のわずかなブレでシート内のボタンが
   反応しなくなるため採らない。 */
function watchScrollerTouchAction(selector) {
    document.querySelectorAll(selector).forEach(sc => {
        let queued = false;
        const apply = () => {
            queued = false;
            sc.style.touchAction = (sc.scrollHeight > sc.clientHeight + 1) ? 'pan-y' : 'none';
        };
        // 内容の差し替えでまとめて発火するため、1フレームに1回へ間引く
        const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(apply); } };
        apply();
        new ResizeObserver(schedule).observe(sc);
        new MutationObserver(schedule).observe(sc, { childList: true, subtree: true });
    });
}

// オブジェクトのクリック対象レイヤーID（レイヤー生成時に詰める）
const objClickLayers = [];
/* 地図上の点にあるオブジェクトを { type, label, p, lng, lat } で返す（無ければ null）。
   ピンの当たり判定に使う favOverlayHit・favSnapCoords はレイヤーを作る側の関数の中に
   あり、地図の長押しの側からは見えないので、レイヤーを作る側がここへ入れる。 */
let objAtPoint = null;
// オブジェクトの長押しでコピーした時刻。指を離した直後に来るクリックでシートを開かないために見る
let objLongPressAt = 0;
const OBJ_LONG_PRESS_CLICK_MS = 500;
function objLongPressJustFired() { return Date.now() - objLongPressAt < OBJ_LONG_PRESS_CLICK_MS; }

/* 情報シートのタイトルに出す素の名前。[近接あり]・[配布] のような表示上の注記は付けない。
   タイトルの長押しと地図のオブジェクトの長押しは、どちらもこの名前をコピーする。 */
function objPlainName(type, label, p) {
    p = p || {};
    if (type === 'pokefuta' || (type === 'manhole' && p.source === 'pokefuta')) return p.pokemon || label;
    if (type === 'mhcard') {
        const info = mhcardInfo(p);
        const who = [info && info.muni, p.discontinued ? '' : p.locationName].filter(Boolean).join(' ');
        return who || p.name || label;
    }
    if (type === 'manhole' || type === 'michi' || type === 'castle') return p.name || label;
    return shopParts(p).shop || label;   // buildSheetHtml と同じく、残りは食べログとして扱う
}

/* 別アプリ（TravelPlan）の地点登録へ貼るための JSON。
   kind は TravelPlan の仕様（docs/input-format.md §3.2）が 城 / 観光 / 食事 の3つしか
   受け付けないので、城と食べログ以外（道の駅・マンホール・カード・ポケふた）は観光にする。
   座標はお気に入りの書き出し（favExportTsv）と同じく小数5桁（約1.1m）に揃える。 */
const OBJ_POINT_KIND = { castle: '城', shop: '食事' };
function objPointJson(type, label, p, lng, lat) {
    return JSON.stringify({
        name: objPlainName(type, label, p),
        lat: Number(Number(lat).toFixed(5)),
        lng: Number(Number(lng).toFixed(5)),
        kind: OBJ_POINT_KIND[type] || '観光',
    });
}

// ── 選択リング（②二重リング）。ピンと同じ種別色で、ピンの外側に2重の輪を出す ──
// ピンは直径28px（フチ無し）なので、内リングφ46/外リングφ62なら重ならない。
// 色は「地図上のピンと同じ色」に合わせる。
// mhcard だけは typeConfig の #1565C0（検索結果や履歴のアイコン背景用）を使うと
// 地図上のピン（カードの面は MHCARD_FACE_COLOR の #B87333）と食い違うため、
// ピンの見た目に合わせてマンホール系の #B87333 を使う。
const OBJ_TYPE_COLOR = {
    castle: '#8A8A8A', michi: '#0B499D', shop: '#FFAA00',   /* 色は食べログのアイコンの地色 */
    manhole: '#B87333', mhcard: '#B87333', pokefuta: '#FBBC04',
};
function objRingColor(type, p) {
    if (type === 'castle') {
        if (p.genre === '日本100名城') return CASTLE_MEIJO_COLOR;
        if (p.genre === '続日本100名城') return CASTLE_ZOKU_MEIJO_COLOR;
    }
    if (type === 'manhole' && p.source === 'pokefuta') return OBJ_TYPE_COLOR.pokefuta;
    return OBJ_TYPE_COLOR[type] || '#546E7A';
}
function setSelectedObject(coords, color) {
    setSelectedObjects([coords], color);
}
// 蓋⇄配布場所をボタンで行き来したときは、移動元と移動先の両方にリングを出し、間を線で結ぶ。
// リングのレイヤーは circle なので、ソースに2点入れるだけで両方に描かれる。
// 線は消し方をリングと揃えたいので、同じ関数で出し入れする。
function setSelectedObjects(coordsList, color) {
    const src = map.getSource('selected-object-source');
    if (!src) return;
    src.setData({
        type: 'FeatureCollection',
        features: coordsList.map(c => ({ type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties: {} })),
    });
    map.setPaintProperty('selected-ring-inner', 'circle-stroke-color', color);
    map.setPaintProperty('selected-ring-outer', 'circle-stroke-color', color);
    const link = map.getSource('selected-link-source');
    if (link) {
        link.setData(coordsList.length >= 2
            ? { type: 'Feature', geometry: { type: 'LineString', coordinates: coordsList.slice(0, 2) }, properties: {} }
            : { type: 'FeatureCollection', features: [] });
        if (map.getLayer('selected-link')) map.setPaintProperty('selected-link', 'line-color', color);
    }
}
function clearSelectedObject() {
    const src = map.getSource('selected-object-source');
    if (src) src.setData({ type: 'FeatureCollection', features: [] });
    const link = map.getSource('selected-link-source');
    if (link) link.setData({ type: 'FeatureCollection', features: [] });
}

function locationRafLoop(ts) {
    // ── 表示位置（createLocationSmoother が時刻から計算する） ──
    let moved = false;
    const shown = locSmoother.sample(ts);
    if (shown && (shown.lng !== rafLng || shown.lat !== rafLat)) {
        rafLng = shown.lng; rafLat = shown.lat;
        moved = true;
    }

    // ── 向き（createHeadingSmoother が時刻から計算する。センサーの値がまだ無ければ従来どおり deviceHeading） ──
    const heading = headingSmoother.sample(ts) ?? deviceHeading;
    const following = cameraFollow && trackingMode > 0 && !isZooming && rafLng !== null;
    if (following && trackingMode === 2) {
        // カメラ更新を jumpTo で1回にまとめる。位置も向きも少しでも変われば反映する
        // （閾値を設けると、歩行速度やゆっくり向きを変えたときに数フレームに1回しか動かず段付きになる）
        const bearingChanged = heading !== prevSetBearing;
        const posChanged     = rafLng !== prevSetLng || rafLat !== prevSetLat;
        const pitchChanged   = prevSetPitch !== 70;
        if (posChanged || bearingChanged || pitchChanged) {
            const cameraUpdate = {};
            if (posChanged)     { cameraUpdate.center  = [rafLng, rafLat]; prevSetLng = rafLng; prevSetLat = rafLat; }
            if (bearingChanged) { cameraUpdate.bearing = heading;           prevSetBearing = heading; }
            if (pitchChanged)   { cameraUpdate.pitch   = 70;                prevSetPitch = 70; }
            map.jumpTo(cameraUpdate);
        }
    } else if (following) {
        // trackingMode === 1: 位置追従のみ。止まっているときは地図を触らない
        if (rafLng !== prevSetLng || rafLat !== prevSetLat) {
            map.setCenter([rafLng, rafLat]);
            prevSetLng = rafLng; prevSetLat = rafLat;
        }
    }

    // カメラ更新後にマーカーを更新（1フレームずれ防止）。追従オフでもマーカーは動かす
    if (currentMarker && rafLng !== null) {
        if (moved) currentMarker.setLngLat([rafLng, rafLat]);
        if (trackingMode === 2) {
            // モード2は地図自体が向きを追従しているためアイコンは0固定
            currentMarker.getElement().style.setProperty('--heading', '0deg');
        } else if (trackingMode === 1 && heading !== null) {
            const relativeHeading = getShortestAngleDiff(map.getBearing() || 0, heading);
            currentMarker.getElement().style.setProperty('--heading', `${relativeHeading}deg`);
        }
    }

    // 追従中か、表示位置が動いている間だけループを続ける
    rafId = (cameraFollow || locSmoother.isMoving(ts)) ? requestAnimationFrame(locationRafLoop) : null;
}

