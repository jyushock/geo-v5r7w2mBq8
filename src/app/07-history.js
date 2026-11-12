    // --- 移動履歴（戻る/進む） ---
    const HIST_MAX = 50;
    const mapHistory = [];
    let histIndex = -1;
    let histPending = null;    // プログラム移動の直後のmoveendで記録するラベル
    let histNavActive = false; // 履歴ジャンプによる移動中はmoveendで記録しない
    let histNavTimer = null;

    // moveend不発（同一地点への移動等）で残った古いpendingを次のmoveendに誤適用しないよう時刻を持つ
    // extra: 記録時に一緒に残す情報（ピン選択の objType / objProps）。省略時は従来どおり
    // dest: 移動先 { coords:[lng,lat], zoom }。記録する座標は地図の中心ではなくこれを使う。
    //   easeTo の途中で別の easeTo（情報シートの寄せ直し等）が始まると、maplibre は
    //   中断した側の moveend を「その瞬間の中心」で発火する（3.6.2 の _stop → _afterEase で確認）。
    //   中心から拾うと、そこで積まれたエントリが移動の途中の座標になり、履歴から戻ったとき
    //   何も無い場所に選択リングが出る。移動先は呼び出し側が分かっているので渡してもらう。
    function histSetPending(label, cause, extra, dest) {
        histPending = { label, cause, extra: extra || null, dest: dest || null, t: Date.now() };
    }

    function histPush(info) {
        const c = map.getCenter();
        const entry = Object.assign({ lng: c.lng, lat: c.lat, zoom: map.getZoom(), time: Date.now() }, info);
        // 直前エントリと同じ操作・同じラベル・ほぼ同位置なら上書き（連打による重複防止）
        const cur = mapHistory[histIndex];
        if (cur && cur.cause === entry.cause && cur.label === entry.label) {
            const p1 = map.project([cur.lng, cur.lat]);
            const p2 = map.project([entry.lng, entry.lat]);
            if (Math.hypot(p1.x - p2.x, p1.y - p2.y) < 40) {
                Object.assign(cur, entry);
                updateHistButtons();
                return;
            }
        }
        mapHistory.splice(histIndex + 1); // 進む側の履歴は破棄
        mapHistory.push(entry);
        if (mapHistory.length > HIST_MAX) mapHistory.shift();
        histIndex = mapHistory.length - 1;
        updateHistButtons();
    }

    // ピンタップ時：直前エントリとほぼ同位置ならラベルを引き継いで上書き、離れていれば新規追加
    function histRecordPin(label, coords, objType, objProps) {
        const cur = mapHistory[histIndex];
        if (cur) {
            const p1 = map.project([cur.lng, cur.lat]);
            const p2 = map.project(coords);
            if (Math.hypot(p1.x - p2.x, p1.y - p2.y) < 40) {
                // zoom も更新する。上書き元のズームを残すと、この履歴に戻ったとき
                // タップした時ではなく以前のズームに戻ってしまう。
                Object.assign(cur, { label, cause: 'pin', lng: coords[0], lat: coords[1], zoom: map.getZoom(), time: Date.now(), objType, objProps });
                delete cur.addr; // ピン名で表示するため取得済み住所を破棄
                return;
            }
        }
        histPush({ label, cause: 'pin', lng: coords[0], lat: coords[1], objType, objProps });
    }

    // 手動移動：直前エントリから画面短辺の40%以上動いたら記録（現在地追従中は記録しない）
    function histCheckManualMove() {
        if (trackingMode > 0) return;
        const cur = mapHistory[histIndex];
        if (!cur) return;
        const c = map.getCenter();
        const p1 = map.project([cur.lng, cur.lat]);
        const p2 = map.project([c.lng, c.lat]);
        if (Math.hypot(p1.x - p2.x, p1.y - p2.y) < Math.min(window.innerWidth, window.innerHeight) * 0.4) return;
        // 15秒以内に続く手動移動は直近エントリを更新（細かい移動での履歴増殖を防ぐ）
        if (cur.cause === 'move' && Date.now() - cur.time < 15000 && histIndex === mapHistory.length - 1) {
            Object.assign(cur, { lng: c.lng, lat: c.lat, zoom: map.getZoom(), time: Date.now() });
            delete cur.addr; // 位置が変わったので取得済み住所を無効化
            return;
        }
        histPush({ label: '地図移動', cause: 'move' });
    }

    function onHistMoveEnd(ev) {
        // 情報シートを開いたときの寄せ直し（adjustMapForSheet）は利用者の移動操作ではないので
        // 履歴に残さない。ここで弾かないと、シートが大きいときに寄せ量が
        // histCheckManualMove のしきい値を超え、「地図移動」が積まれて進む側の履歴が消える。
        if (ev && ev.histIgnore) return;
        if (histNavActive) {
            histNavActive = false;
            clearTimeout(histNavTimer);
            updateHistButtons();
            return;
        }
        if (histPending) {
            const p = histPending;
            histPending = null;
            if (Date.now() - p.t < 3000) {
                const info = Object.assign({ label: p.label, cause: p.cause }, p.extra || {});
                if (p.dest) {
                    info.lng = p.dest.coords[0];
                    info.lat = p.dest.coords[1];
                    if (p.dest.zoom != null) info.zoom = p.dest.zoom;
                }
                histPush(info);
                return;
            }
        }
        histCheckManualMove();
    }

    // ボタン自体は「前後どちらにも移動先が無い」時だけ無効化。
    // タップ動作（戻る）はhistIndex<=0の時にhistGoTo側でno-opになるだけで、
    // 「進むだけ可能」な状態でも長押しで履歴を開けるようにする。
    function updateHistButtons() {
        document.getElementById('hist-nav-btn').disabled = mapHistory.length <= 1;
    }

    let histSheetHandler = null;   // 履歴移動の完了後に情報シートを開くための moveend ハンドラ

    function histGoTo(idx) {
        if (idx < 0 || idx >= mapHistory.length || idx === histIndex) return;
        closeHistList();
        if (trackingMode > 0) { trackingMode = 0; stopRafLoop(); updateGeolocateButton(); }
        const e = mapHistory[idx];
        histIndex = idx;
        histPending = null;
        histNavActive = true;
        clearTimeout(histNavTimer);
        histNavTimer = setTimeout(() => { histNavActive = false; }, 1500); // moveend不発時の保険
        updateHistButtons();

        // 連続で履歴移動したとき、前回の予約が残って別地点のシートが開かないようにする
        if (histSheetHandler) { map.off('moveend', histSheetHandler); histSheetHandler = null; }
        closeObjSheet();   // 移動先と無関係なシートを残さない

        // オブジェクトの履歴に戻るときは、タップした時と同じ状態（情報シート＋選択リング）へ戻す。
        // 移動の完了後に開くのは、openObjSheet 内の adjustMapForSheet がシート高さぶん
        // 寄せ直すため。寄せ直しはズームを変えないので、下で合わせる e.zoom が保たれる。
        // 登録を easeTo より先に行うのは、既に目的地にいる等で moveend が
        // easeTo の呼び出し中に同期発火しても取りこぼさないようにするため。
        if (e.cause === 'pin' && e.objType && e.objProps) {
            const handler = () => {
                map.off('moveend', handler);
                if (histSheetHandler === handler) histSheetHandler = null;
                openObjSheet(e.objType, e.label, e.objProps, e.lng, e.lat);
            };
            histSheetHandler = handler;
            map.on('moveend', handler);
        }
        map.easeTo({ center: [e.lng, e.lat], zoom: e.zoom, bearing: 0, pitch: 0, duration: 550, essential: true });
    }

    const HIST_CAUSES = { init: '開始地点', search: '検索', pin: 'ピン選択', geo: '現在地', move: '地図移動' };

    // init/search/move用の線画アイコン（丸背景＋白線で種別色ピン(hist-ico-type)と統一）
    const HIST_ICON_SVG = {
        // 丸背景(直径28px)に載るため、viewBox中心からの最遠距離(ストローク込み)が
        // 丸半径の88%になるよう座標を揃えてある。外接矩形ではなく最遠距離で揃えるのは、
        // 円の中では縁までの余白が見た目を決めるため。init は元から87.9%で調整不要。
        search: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="10.11" cy="10.11" r="5.67"/><line x1="14.12" y1="14.12" x2="19.55" y2="19.55"/></svg>',
        move:   '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1.07" x2="12" y2="22.93"/><line x1="1.07" y1="12" x2="22.93" y2="12"/><polyline points="7.63 5.44 12 1.07 16.37 5.44"/><polyline points="7.63 18.56 12 22.93 16.37 18.56"/><polyline points="5.44 7.63 1.07 12 5.44 16.37"/><polyline points="18.56 7.63 22.93 12 18.56 16.37"/></svg>',
        init:   '<svg viewBox="0 0 24 24" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="#fff"><line x1="6" y1="3" x2="6" y2="21" stroke-width="2"/><path d="M6 4 L18 4 L14 8 L18 12 L6 12 Z"/></svg>',
    };
    const HIST_ICON_COLOR = { search: UI_BLUE, move: '#F4B400', init: '#00796B' };
    // geo（現在地）は地図長押しピン設置（search-pin-icon）と同じマーカーSVGを流用
    const HIST_GEO_PIN_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 36"><path d="M14 0C7.4 0 2 5.4 2 12c0 8.4 12 24 12 24s12-15.6 12-24C26 5.4 20.6 0 14 0z" fill="#F44336"/><circle cx="14" cy="12" r="5" fill="white" opacity="0.9"/></svg>';

    // ピン選択エントリはオブジェクト種別ごとのアイコン（検索結果ドロップダウンと同じ画像）を優先表示
    function histIconHtml(e) {
        const cfg = e.cause === 'pin' && e.objType ? typeConfig[e.objType] : null;
        if (!cfg) {
            if (e.cause === 'geo') return `<div class="hist-ico-cause" style="background:#fce8e6;"><img src="data:image/svg+xml;utf8,${encodeURIComponent(HIST_GEO_PIN_SVG)}"></div>`;
            const svg = HIST_ICON_SVG[e.cause];
            if (svg) return `<div class="hist-ico-cause" style="background:${HIST_ICON_COLOR[e.cause]}">${svg}</div>`;
            return `<span class="hist-ico">📍</span>`;
        }
        if (e.objType === 'mhcard') {
            return `<div class="hist-ico-mhcard"><img class="hist-ico-mhcard-main" src="mhcard.png"><img class="hist-ico-mhcard-overlay" src="manhole.png"></div>`;
        }
        const color = getItemColor({ type: e.objType, properties: e.objProps || {} });
        return `<div class="hist-ico-type${objIconSquareClass(e.objType)}" style="background:${color}">${cfg.img ? `<img src="${cfg.img}"${cfg.img === 'manhole.png' ? '' : ' class="icon-full"'}>` : cfg.icon}</div>`;
    }

    function histTimeAgo(t) {
        const s = (Date.now() - t) / 1000;
        if (s < 60) return 'たった今';
        if (s < 3600) return `${Math.floor(s / 60)}分前`;
        if (s < 86400) return `${Math.floor(s / 3600)}時間前`;
        return `${Math.floor(s / 86400)}日前`;
    }

    function histEscape(s) {
        return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    }

    // 現在地点を境に、上＝戻れる場所（直近優先）／下＝進める場所（direct順）を1つのリストに統合表示
    function openHistList() {
        if (mapHistory.length <= 1) return;
        const BEFORE = 6, AFTER = 4;
        const start = Math.max(0, histIndex - BEFORE);
        const end = Math.min(mapHistory.length - 1, histIndex + AFTER);
        const visible = [];
        for (let idx = end; idx >= start; idx--) visible.push({ e: mapHistory[idx], idx });

        const pop = document.getElementById('hist-list-popup');
        pop.innerHTML = `<div class="hist-hdr">移動履歴</div>` + visible.map(({ e, idx }) => {
            const isCur = idx === histIndex;
            const cls = isCur ? ' hist-cur' : (idx > histIndex ? ' hist-future' : '');
            const curTag = isCur ? ' <span class="hist-cur-tag">● 現在地点</span>' : '';
            return `<div class="hist-item${cls}" data-idx="${idx}">${histIconHtml(e)}<div class="hist-txt"><div class="hist-name">${histEscape(e.addr || e.label)}${curTag}</div><div class="hist-meta">${histTimeAgo(e.time)}・${HIST_CAUSES[e.cause] || ''}</div></div></div>`;
        }).join('');
        pop.style.display = 'block';
        histFetchAddrs(visible.map(v => v.e));
    }

    // 「地図移動」エントリの住所をリスト表示時に遅延取得してキャッシュ
    // Nominatim利用規約（最大1リクエスト/秒）に合わせて逐次・間隔付きで取得する
    let histAddrFetching = false;
    async function histFetchAddrs(entries) {
        if (histAddrFetching) return;
        const targets = entries.filter(e => e.cause === 'move' && !e.addr);
        if (!targets.length) return;
        histAddrFetching = true;
        try {
            for (let i = 0; i < targets.length; i++) {
                const e = targets[i];
                const t0 = Date.now();
                const addr = await fetchPlaceName(e.lat, e.lng);
                if (addr && !e.addr) {
                    e.addr = addr;
                    // ポップアップが開いたままならその行だけ書き換える
                    const idx = mapHistory.indexOf(e);
                    const pop = document.getElementById('hist-list-popup');
                    if (pop.style.display === 'block' && idx >= 0) {
                        const nameEl = pop.querySelector(`.hist-item[data-idx="${idx}"] .hist-name`);
                        if (nameEl) nameEl.textContent = addr;
                    }
                }
                if (i < targets.length - 1) {
                    await new Promise(r => setTimeout(r, Math.max(0, 1000 - (Date.now() - t0))));
                }
            }
        } finally {
            histAddrFetching = false;
        }
    }

    function closeHistList() {
        document.getElementById('hist-list-popup').style.display = 'none';
    }

    // 中央ボタン：タップでひとつ前に戻る、長押し(500ms)で移動履歴リスト
    function setupHistButton(btnId) {
        const btn = document.getElementById(btnId);
        let timer = null;
        btn.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            if (btn.disabled) return;
            timer = setTimeout(() => { timer = null; openHistList(); }, 500);
        });
        btn.addEventListener('pointerup', () => {
            if (timer) { clearTimeout(timer); timer = null; histGoTo(histIndex - 1); }
        });
        const cancelPress = () => { clearTimeout(timer); timer = null; };
        btn.addEventListener('pointerleave', cancelPress);
        btn.addEventListener('pointercancel', cancelPress);
        btn.addEventListener('contextmenu', (e) => e.preventDefault());
    }
    setupHistButton('hist-nav-btn');

    document.getElementById('hist-list-popup').addEventListener('click', (e) => {
        const row = e.target.closest('.hist-item');
        if (row) histGoTo(Number(row.dataset.idx));
    });
    // リスト外タップで閉じる（中央ボタン上のタップは長押し直後のclickを無視するため除外）
    document.addEventListener('click', (e) => {
        if (e.target.closest('#hist-list-popup') || e.target.closest('#hist-nav-btn')) return;
        closeHistList();
    });

    // 検索ピン
    let searchPinLngLat = null;

    function placeSearchPin(lngLat, label = null, options = {}) {
        const showMapPin = options.showMapPin !== false;
        searchPinLngLat = lngLat;
        refreshWeatherIfPanelOpen(); // 基準点が変わったらパネル表示中の天気も更新
        const src = map.getSource('search-pin-source');
        if (src) {
            src.setData(showMapPin
                ? { type: 'Feature', geometry: { type: 'Point', coordinates: [lngLat.lng, lngLat.lat] }, properties: {} }
                : { type: 'FeatureCollection', features: [] });
        }
        if (showMapPin && map.getLayer('search-pin-layer')) map.moveLayer('search-pin-layer');
        if (showMapPin && !label) animatePinPulse(lngLat);
        const origin = document.getElementById('nearby-search-origin');
        if (showMapPin && origin && !label) { origin.classList.remove('flash'); void origin.offsetWidth; origin.classList.add('flash'); }
        const labelEl = document.getElementById('nearby-search-origin-label');
        if (labelEl) labelEl.textContent = label || '検索地点';
        setSearchOriginText('取得中...', true);
        const capLng = lngLat.lng, capLat = lngLat.lat;
        fetchPlaceName(capLat, capLng).then(name => {
            if (searchPinLngLat && searchPinLngLat.lng === capLng && searchPinLngLat.lat === capLat)
                setSearchOriginText(name || '周辺', true);
        });
    }

    let progressRaf = null;
    function startProgressRing(lngLat) {
        const src = map.getSource('pin-progress-source');
        if (!src) return;
        src.setData({ type: 'Feature', geometry: { type: 'Point', coordinates: [lngLat.lng, lngLat.lat] }, properties: {} });
        const start = performance.now();
        function frame(t) {
            const p = Math.min((t - start) / 500, 1);
            map.setPaintProperty('pin-progress-layer', 'circle-radius',         p * 32);
            map.setPaintProperty('pin-progress-layer', 'circle-stroke-opacity', p * 0.9);
            if (p < 1) progressRaf = requestAnimationFrame(frame);
            else progressRaf = null;
        }
        progressRaf = requestAnimationFrame(frame);
    }
    function stopProgressRing() {
        if (progressRaf) { cancelAnimationFrame(progressRaf); progressRaf = null; }
        const src = map.getSource('pin-progress-source');
        if (src) src.setData({ type: 'FeatureCollection', features: [] });
        if (map.getLayer('pin-progress-layer')) {
            map.setPaintProperty('pin-progress-layer', 'circle-radius', 0);
            map.setPaintProperty('pin-progress-layer', 'circle-stroke-opacity', 0);
        }
    }

    let pulseRaf = null;
    function animatePinPulse(lngLat) {
        const pulseSrc = map.getSource('pin-pulse-source');
        if (!pulseSrc) return;
        if (pulseRaf) { cancelAnimationFrame(pulseRaf); pulseRaf = null; }
        map.setPaintProperty('pin-pulse-layer', 'circle-radius', 0);
        map.setPaintProperty('pin-pulse-layer', 'circle-opacity', 0);
        pulseSrc.setData({ type: 'Feature', geometry: { type: 'Point', coordinates: [lngLat.lng, lngLat.lat] }, properties: {} });
        const start = performance.now();
        const duration = 1000;
        function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
        function frame(t) {
            const p = Math.min((t - start) / duration, 1);
            const e = easeOut(p);
            map.setPaintProperty('pin-pulse-layer', 'circle-radius',  5.6 + e * (112 - 5.6));
            map.setPaintProperty('pin-pulse-layer', 'circle-opacity', (1 - p) * 0.4);
            if (p < 1) pulseRaf = requestAnimationFrame(frame);
            else { pulseRaf = null; pulseSrc.setData({ type: 'FeatureCollection', features: [] }); }
        }
        pulseRaf = requestAnimationFrame(frame);
    }

    function removeSearchPin() {
        searchPinLngLat = null;
        const src = map.getSource('search-pin-source');
        if (src) src.setData({ type: 'FeatureCollection', features: [] });
        const labelEl = document.getElementById('nearby-search-origin-label');
        if (labelEl) labelEl.textContent = '検索地点';
        setSearchOriginText('地図中心', false);
    }

    function getSearchCenter() { return searchPinLngLat || map.getCenter(); }

