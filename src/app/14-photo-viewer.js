// ══ 写真の全画面ビューア ═══════════════════════════════════════════
/* 情報帯・ピンチズーム／パン・出典切替を1つにまとめたもの。
   3つとも1本指ドラッグを使うため、次の取り決めで衝突を避ける。
     ・等倍のとき  … 横ドラッグで出典切替、下ドラッグで閉じる（上ドラッグは何もしない）
     ・拡大中のとき … ドラッグはパン。出典切替も下スワイプ閉じも無効
     ・ピンチは2本指なのでどちらとも衝突しない
   下スワイプ閉じは等倍限定にしている。拡大中はドラッグがパンなので、下へパンする操作と
   区別できないため。
   拡大に入った瞬間に情報帯とドットを畳む（写真を遮らないため）。ただし畳んだ後も
   1本指タップで出せる。閉じるボタンは情報帯の中にあるので、拡大中に出せないと
   閉じられなくなるため。等倍に戻した瞬間は自動で出す。
   出典を切り替えたときは倍率とパン位置をリセットする。これをしないと
   横長パノラマの倍率が縦長の写真に持ち越されて破綻する。
   閉じるのは情報帯の「閉じる」ボタン。「どこでもタップで閉じる」はダブルタップ拡大・
   パン・UIトグルと競合するため採らない。 */
const PV_SLOP = 8;            // 縦横どちらに倒れたかを判定する移動量(px)
const PV_SWITCH_DIST = 50;    // 出典を切り替える横移動量(px)
// 下スワイプで閉じる判定。ゆっくり引くときは距離、素早く払うときは速さで決める。
// 距離だけだと、軽く払ったときは指が離れる位置が浅く、閉じたつもりで閉じない。
// 速さは「押してから離すまでの平均」で見る。直近の移動量から求める方式は、
// 速く払った直後に指を止めてから離すと古い速さが残って誤って閉じるうえ、
// 逆に一瞬で払うと標本が1つも取れずに速さ0になる（実測で確認）。
// 平均ならどちらも起きない（止めていた時間が分母に入って自然に遅くなる）。
const PV_CLOSE_DIST = 45;     // ゆっくり引いて閉じる移動量(px)
const PV_FLICK_SPEED = 0.25;  // 距離が足りなくても閉じる下向きの平均速さ(px/ms)
const PV_MAX_SCALE = 6;
let pvSources = [];           // [{url, label}]
let pvIdx = 0, pvScale = 1, pvX = 0, pvY = 0, pvUI = true, pvZoomed = false;
let pvPtr = new Map(), pvPinchDist = 0, pvPinchStart = 1, pvPanFrom = null, pvAxis = null, pvDragDX = 0;

function isPhotoViewerOpen() {
    return document.getElementById('photo-viewer').classList.contains('open');
}

// 下スワイプ中の手応え。引くほど黒背景を透かし、下に地図が見えることで
// 「閉じる方向の操作だ」と分かるようにする。
function pvSetDismissProgress(dy, animate) {
    const bd = document.getElementById('pv-backdrop');
    if (!bd) return;
    bd.style.transition = animate ? 'opacity 0.22s ease' : '';
    bd.style.opacity = String(Math.max(0.4, 1 - dy / 400));
}

function openPhotoViewer(sources, startUrl) {
    pvSources = sources.filter(s => s && s.url);
    if (!pvSources.length) return;
    const at = pvSources.findIndex(s => s.url === startUrl);
    pvIdx = at >= 0 ? at : 0;
    pvScale = 1; pvX = 0; pvY = 0; pvUI = true; pvZoomed = false;
    pvPtr.clear(); pvPanFrom = null; pvAxis = null; pvDragDX = 0;

    document.getElementById('pv-track').innerHTML = pvSources.map(s =>
        `<div class="pv-pane"><div class="pv-inner"><img src="${s.url}" alt=""></div></div>`).join('');
    document.getElementById('pv-dots').innerHTML =
        pvSources.length > 1 ? pvSources.map(() => '<i></i>').join('') : '';
    const v = document.getElementById('photo-viewer');
    v.classList.add('open');
    v.setAttribute('aria-hidden', 'false');
    pvSetDismissProgress(0);   // 前回スワイプ途中で閉じた場合の透過を戻す
    pvRender();
    pvSyncInfoHeight();
}

// 情報帯の実高さを写真側の余白(--pv-info-h)へ渡す。
// 帯の高さは名前や住所の行数で変わるため固定値では足りない／余りすぎる。
// 閉じている間(display:none)は測っても0なので、開いた後にだけ呼ぶ。
function pvSyncInfoHeight() {
    const info = document.getElementById('pv-info');
    const h = info.offsetHeight;
    if (h > 0) document.getElementById('photo-viewer').style.setProperty('--pv-info-h', h + 'px');
}

function closePhotoViewer() {
    const v = document.getElementById('photo-viewer');
    if (!v.classList.contains('open')) return;
    v.classList.remove('open');
    v.setAttribute('aria-hidden', 'true');
    document.getElementById('pv-track').innerHTML = '';   // 画像デコードを抱えたままにしない
    pvSources = [];
    pvPtr.clear();
    pvY = 0; pvAxis = null; pvPanFrom = null;
    pvSetDismissProgress(0);
}

function pvRender(animate) {
    const track = document.getElementById('pv-track');
    track.style.transition = animate ? 'transform 0.26s ease' : '';
    track.style.transform = `translateX(calc(${-pvIdx * 100}% + ${pvDragDX}px))`;
    const inner = track.children[pvIdx] && track.children[pvIdx].querySelector('.pv-inner');
    if (inner) {
        inner.style.transition = animate ? 'transform 0.22s ease' : '';
        inner.style.transform = `translate(${pvX}px, ${pvY}px) scale(${pvScale})`;
    }
    // 表示していないペインの倍率は常に戻しておく（切替時に持ち越さない）
    [...track.children].forEach((pane, i) => {
        if (i === pvIdx) return;
        const el = pane.querySelector('.pv-inner');
        if (el) { el.style.transition = ''; el.style.transform = ''; }
    });
    [...document.getElementById('pv-dots').children]
        .forEach((d, i) => d.classList.toggle('on', i === pvIdx));

    const src = pvSources[pvIdx] || {};
    const ctx = objSheetCtx || {};
    document.getElementById('pv-title').textContent = ctx.label || '';
    // 「何の写真か」と「どの取得元か」を1か所にまとめる
    const sub = [(ctx.p && ctx.p.address) || '', src.label || ''].filter(Boolean).join('　/　');
    document.getElementById('pv-sub').textContent = sub;

    // 拡大に入った瞬間だけUIを畳み、等倍に戻った瞬間だけ出す。
    // 拡大中も「隠れたまま固定」にはしない（閉じるボタンが情報帯の中にあるため、
    // 拡大したまま閉じられなくなってしまう）。畳んだ後でもタップで出せる。
    const zoomed = pvScale > 1.02;
    if (zoomed !== pvZoomed) { pvZoomed = zoomed; pvUI = !zoomed; }

    document.getElementById('pv-info').classList.toggle('pv-hidden', !pvUI);
    document.getElementById('pv-dots').classList.toggle('pv-hidden', !pvUI || pvSources.length <= 1);
}

function isObjSheetOpen() {
    return objSheetLngLat !== null;
}

