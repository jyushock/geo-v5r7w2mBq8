import threading, functools, http.server, socketserver, json, sys, os
from playwright.sync_api import sync_playwright
ROOT, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Q, directory=ROOT))
port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
NEW = {5: '#880E4F', 6: '#00BCD4', 7: '#33691E', 8: '#212121'}
FG = {5: '#fff', 6: '#212121', 7: '#fff', 8: '#fff'}
SETUP = '''([NEW, FGS]) => {
  // 試作: 枠を8つに広げる（モックの撮影用。アプリのコードは変えていない）
  [5,6,7,8].forEach(n => { FAV_SLOTS.push(n); FAV_COLORS[n] = NEW[n]; FAV_FG[n] = FGS[n]; });
  const st = map.getStyle().layers;
  for (const n of [5,6,7,8]) {
    for (const base of ['fav-bg','fav-plate','fav-card','fav-icon','fav-cardbadge']) {
      const src = st.find(l => l.id === base + '-1');
      const L = JSON.parse(JSON.stringify(src));
      L.id = base + '-' + n; L.filter[1][2] = n;
      map.addLayer(L, 'fav-bg-' + (n - 1));
    }
  }
  const names = ['お気に入り','行きたい','行った','あいうえおか','温泉','グルメ','旅程A','保留'];
  names.forEach((s, i) => favStore.names[i + 1] = s);
  favStore.items = {};
  saveFavStore();
  // 城が密集している場所を探し、近い8城に1枠ずつ付ける
  const cs = searchIndex.filter(x => x.type === 'castle');
  const d = (a, b) => Math.hypot((a.coords[0]-b.coords[0])*Math.cos(a.coords[1]*Math.PI/180), a.coords[1]-b.coords[1]) * 111;
  let best = null;
  for (const c of cs.slice(0, 4000)) {
    const near = cs.filter(o => d(c, o) < 0.9 && d(c, o) > 0.12);
    if (near.length >= 7 && (!best || near.length > best.n)) best = { c, n: near.length, near };
  }
  const pick = [best.c, ...best.near.sort((a,b)=>d(best.c,a)-d(best.c,b)).slice(0, 7)];
  const key = it => favKeyOf(it.type, it.properties, it.coords[0], it.coords[1]);
  pick.forEach((it, i) => favToggleMark(key(it), i + 1));
  // 一覧の色帯用: 1枠・3枠・8枠に入った店
  const shops = searchIndex.filter(x => x.type === 'shop').slice(0, 3);
  [[2], [1,5,7], [1,2,3,4,5,6,7,8]].forEach((slots, i) => slots.forEach(n => favToggleMark(key(shops[i]), n)));
  const lng = pick.map(p => p.coords[0]), lat = pick.map(p => p.coords[1]);
  map.fitBounds([[Math.min(...lng), Math.min(...lat)], [Math.max(...lng), Math.max(...lat)]], { padding: 70, duration: 0 });
  return { center: best.c.label, names: pick.map(p => p.label), shop8: shops[2].label };
}'''
try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={'width': 375, 'height': 667}, device_scale_factor=2)
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(f'http://127.0.0.1:{port}/index.html')
        pg.wait_for_function('typeof searchIndex !== "undefined" && searchIndex.length > 30000 && map && map.getLayer("fav-bg-1")', timeout=90000)
        info = pg.evaluate(SETUP, [{str(k): v for k, v in NEW.items()}, {str(k): v for k, v in FG.items()}])
        pg.evaluate('favStore.hidden[8] = true; saveFavStore(); refreshFavOverlay()')
        pg.wait_for_timeout(4000)
        pg.mouse.move(370, 660); pg.screenshot(path=f'{OUT}/map8.png')
        # 一覧（現行の作りのまま8枠にした場合）
        pg.evaluate('openNearbyPanel()'); pg.wait_for_timeout(500)
        pg.evaluate('openFavView()'); pg.wait_for_timeout(600)
        info['chips'] = pg.evaluate('(() => { const r = document.getElementById("fav-kind-chips").getBoundingClientRect(); const l = document.getElementById("fav-item-list").getBoundingClientRect(); return {chipsH: r.height, listTop: l.top, listH: l.height}; })()')
        pg.mouse.move(370, 660); pg.screenshot(path=f'{OUT}/list8-now.png')
        # 情報シート（8枠すべてに入った店）
        pg.evaluate('closeNearby()'); pg.wait_for_timeout(400)
        pg.evaluate('''() => { const it = searchIndex.filter(x => x.type === 'shop')[2];
            openObjSheet(it.type, it.label, it.properties, it.coords[0], it.coords[1]); }''')
        pg.wait_for_timeout(1500)
        pg.mouse.move(370, 660); pg.screenshot(path=f'{OUT}/sheet8.png')

        R = '(sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; }'
        pg.evaluate('closeObjSheet()'); pg.wait_for_timeout(400)
        pg.evaluate('''() => { const it = searchIndex.filter(x => x.type === 'shop')[1];
            openObjSheet(it.type, it.label, it.properties, it.coords[0], it.coords[1]); }''')
        pg.wait_for_timeout(1500)
        pg.click('#obj-fav-btn'); pg.wait_for_timeout(400)
        info['pal1'] = {'star': pg.evaluate(R, '#obj-fav-btn'), 'pop': pg.evaluate(R, '.fav-pop'), 'sheet': pg.evaluate(R, '#obj-sheet')}
        pg.mouse.move(370, 660); pg.screenshot(path=f'{OUT}/palette8-1col.png')
        pg.evaluate('closeFavPalette()'); pg.wait_for_timeout(400)
        pg.add_style_tag(content='.fav-pop{display:grid!important;grid-template-columns:1fr 1fr;column-gap:2px}')
        pg.click('#obj-fav-btn'); pg.wait_for_timeout(400)
        info['pal2'] = {'pop': pg.evaluate(R, '.fav-pop'), 'btn': pg.evaluate(R, '.fav-pop button')}
        pg.mouse.move(370, 660); pg.screenshot(path=f'{OUT}/palette8-2col.png')
        pg.evaluate('closeFavPalette(); closeObjSheet(); openNearbyPanel()'); pg.wait_for_timeout(500)
        pg.evaluate('openSettingsView()'); pg.wait_for_timeout(600)
        pg.evaluate('document.getElementById("fav-name-list").previousElementSibling.scrollIntoView()'); pg.wait_for_timeout(300)
        info['settings'] = {'list': pg.evaluate(R, '#fav-name-list'), 'row': pg.evaluate(R, '.favname-row'), 'label': pg.evaluate(R, '#fav-name-list')}
        pg.mouse.move(370, 660); pg.screenshot(path=f'{OUT}/settings8-now.png')

        # ── 案: 設定はボタン1つ ──
        pg.evaluate("""() => {
          const dots = favActiveSlots().map(n => `<i style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${FAV_COLORS[n]}"></i>`).join('');
          document.getElementById('fav-name-list').outerHTML = `<div style="display:flex;gap:8px;padding:2px 16px 8px;">
            <button class="fxp-btn sub" style="flex:1;height:38px;font-size:13px;justify-content:space-between;padding:0 14px;">
              <span style="display:flex;gap:4px;align-items:center">${dots}</span><span>名前と表示を編集 ›</span></button></div>`;
        }""")
        pg.wait_for_timeout(300)
        pg.mouse.move(370, 660); pg.screenshot(path=f'{OUT}/settings8-button.png')
        # ── 案: 押した先の編集ビュー ──
        pg.evaluate("""() => {
          const v = document.getElementById('nearby-settings-view');
          v.querySelector('.lords-head-title, .nearby-settings-title, h3') ;
          const head = v.firstElementChild;
          [...v.querySelectorAll('*')].forEach(e => { if (e.textContent.trim() === '設定' && e.children.length === 0) e.textContent = 'お気に入りの枠'; });
          const body = head.nextElementSibling;
          [...body.children].forEach(c => c.style.display = 'none');
          const lab = document.createElement('div'); lab.className = 'nearby-section-label'; lab.textContent = 'お気に入りの名前';
          const list = document.createElement('div'); list.id = 'fav-name-list'; list.style.paddingBottom = '3px';
          body.prepend(list); body.prepend(lab); body.scrollTop = 0;
          renderFavNameList();
          setPanelLifted(true); v.style.height = 'calc(100svh - 104px)';
        }""")
        pg.wait_for_timeout(300)
        info['editview'] = {'list': pg.evaluate(R, '#fav-name-list')}
        pg.mouse.move(370, 660); pg.screenshot(path=f'{OUT}/settings8-edit.png')
        # ── 案: 一覧の一段目（枠の一覧） ──
        pg.evaluate('closeNearby()'); pg.wait_for_timeout(300)
        pg.reload(); pg.wait_for_function('typeof searchIndex !== "undefined" && searchIndex.length > 30000 && map && map.getLayer("fav-bg-1")', timeout=90000)
        pg.evaluate("""([NEW, FGS]) => { [5,6,7,8].forEach(n => { FAV_SLOTS.push(n); FAV_COLORS[n] = NEW[n]; FAV_FG[n] = FGS[n]; });
            favStore = loadFavStore(); }""", [{str(k): v for k, v in NEW.items()}, {str(k): v for k, v in FG.items()}])
        pg.evaluate('openNearbyPanel()'); pg.wait_for_timeout(400)
        pg.evaluate('openFavView()'); pg.wait_for_timeout(500)
        pg.evaluate(r"""() => {
          const v = document.getElementById('nearby-fav-view');
          v.querySelector('.lords-filter').style.display = 'none';
          document.getElementById('fav-origin').style.display = 'none';
          document.getElementById('fav-select-btn').style.display = 'none';
          document.getElementById('fav-export-btn').style.display = 'none';
          const star = '<svg width="16" height="16" viewBox="0 0 24 24" fill="#fff"><path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3 6.1 20.6l1.3-6.6-4.9-4.6 6.6-.8z"/></svg>';
          const chev = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#bbb" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>';
          const rows = favCollect();
          const row = (color, name, cnt, sub) => `<div class="nearby-item">
              <div class="nearby-item-icon" style="background:${color}">${star}</div>
              <div class="nearby-item-text"><div class="nearby-item-name">${name}</div>${sub ? `<div class="nearby-item-sub">${sub}</div>` : ''}</div>
              <div class="fav-added" style="font-size:12px;color:#999">${cnt}件</div>${chev}</div>`;
          document.getElementById('fav-item-list').innerHTML = row('#90A4AE', 'すべて', rows.length)
            + favActiveSlots().map(n => row(FAV_COLORS[n], favNameOf(n), rows.filter(r => r.mk.includes(n)).length,
                favStore.hidden[n] ? '地図に薄く出しています' : '')).join('');
        }""")
        pg.wait_for_timeout(300)
        info['stage1'] = {'list': pg.evaluate(R, '#fav-item-list'), 'row': pg.evaluate(R, '#fav-item-list .nearby-item'),
                          'last': pg.evaluate("(() => { const r = [...document.querySelectorAll('#fav-item-list .nearby-item')].pop().getBoundingClientRect(); return [r.y, r.height]; })()")}
        pg.mouse.move(370, 660); pg.screenshot(path=f'{OUT}/list8-stage1.png')
        # ── 案: 一覧の二段目（「温泉」を開いたところ） ──
        pg.evaluate('closeNearby()'); pg.wait_for_timeout(300)
        pg.evaluate('openNearbyPanel()'); pg.wait_for_timeout(400)
        pg.evaluate("openFavView(); favState.kind = 5; renderFavItems();")
        pg.wait_for_timeout(500)
        pg.evaluate("""() => {
          document.getElementById('nearby-fav-view').querySelector('.lords-filter').style.display = '';
          document.getElementById('fav-origin').style.display = '';
          document.getElementById('fav-select-btn').style.display = '';
          document.getElementById('fav-export-btn').style.display = '';
          document.getElementById('fav-kind-chips').style.display = 'none';
          document.getElementById('fav-head-title').innerHTML = `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${FAV_COLORS[5]};margin-right:6px;vertical-align:0"></span>${favNameOf(5)}`;
        }""")
        pg.wait_for_timeout(300)
        info['stage2'] = {'list': pg.evaluate(R, '#fav-item-list'), 'filter': pg.evaluate(R, '#nearby-fav-view .lords-filter')}
        pg.mouse.move(370, 660); pg.screenshot(path=f'{OUT}/list8-stage2.png')
        print(json.dumps(info, ensure_ascii=False, indent=1)); print('pageerror', errs)
        b.close()
finally:
    srv.shutdown(); srv.server_close()
