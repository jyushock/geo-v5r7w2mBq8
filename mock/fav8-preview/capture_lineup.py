"""5〜8枠の色の案を、既存の4色と横一列に並べて実アプリの地図で描く。
列＝枠1〜8、行＝ピンの種類。並べたピンは地図上の実物ではなく、お気に入りの重ね描きのソースに
並べ用の点を入れて描かせたもの（描画は実アプリのレイヤーそのまま）。"""
import threading, functools, http.server, socketserver, json, sys, os, re
from playwright.sync_api import sync_playwright
ROOT, OUT = sys.argv[1], sys.argv[2]
HERE = os.path.dirname(os.path.abspath(__file__))
SETUP = re.search(r"SETUP = '''(.*?)'''", open(os.path.join(HERE, 'capture8.py'), encoding='utf-8').read(), re.S).group(1)
SETS = json.load(open(os.path.join(HERE, 'color_sets.json'), encoding='utf-8'))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Q, directory=ROOT))
port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
LINEUP = '''([cols, top]) => {
  [5,6,7,8].forEach((n, i) => { FAV_COLORS[n] = cols[i]; });
  const pick = (t, f) => searchIndex.find(x => x.type === t && (!f || f(x)));
  const ring = it => objRingColor(it.type, it.properties || {});
  const castles = searchIndex.filter(x => x.type === 'castle');
  const byColor = {};
  for (const c of castles) { const k = ring(c); if (!byColor[k]) byColor[k] = c; }
  const rows = [...Object.values(byColor).slice(0, 3), pick('shop'), pick('pokefuta'), pick('manhole'), pick('michi'), pick('mhcard')];
  const feats = [];
  rows.forEach((it, r) => {
    const pin = FAV_PIN[it.type];
    for (let n = 1; n <= 8; n++) {
      const ll = map.unproject([22 + (n - 1) * 45, top + 22 + r * 46]);
      feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [ll.lng, ll.lat] },
        properties: { _i: 0, _shape: pin.shape, _icon: pin.icon, _iconSize: pin.size, _color: ring(it), _mk: n, _mkColor: FAV_COLORS[n] } });
    }
  });
  map.getSource('fav-objects').setData({ type: 'FeatureCollection', features: feats });
  return rows.map(it => it.type + ' ' + ring(it));
}'''
info = {}
try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={'width': 375, 'height': 667}, device_scale_factor=2)
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(f'http://127.0.0.1:{port}/index.html')
        pg.wait_for_function('typeof searchIndex !== "undefined" && searchIndex.length > 30000 && map && map.getLayer("fav-bg-1")', timeout=90000)
        first = SETS[0]['colors']
        pg.evaluate(SETUP, [{str(n): c for n, c in zip([5, 6, 7, 8], first)}, {str(n): '#FFFFFF' for n in [5, 6, 7, 8]}])
        # ピンの少ない場所（農地）へ寄せ、元のピンが並びに重ならないようにする
        pg.evaluate("map.jumpTo({ center: [%s, %s], zoom: 14.5 })" % (sys.argv[3] if len(sys.argv) > 3 else '143.30', sys.argv[4] if len(sys.argv) > 4 else '42.92'))
        pg.wait_for_timeout(4000)
        # 地図の上に浮いているボタン類を隠す（並びに重なるため）。地図そのものは残す
        pg.evaluate('''() => { const cv = map.getCanvasContainer();
            for (const e of document.querySelectorAll('body *')) {
                if (e.contains(cv) || cv.contains(e)) continue;
                const p = getComputedStyle(e).position;
                if (p === 'fixed' || p === 'absolute') e.style.visibility = 'hidden';
            } }''')
        TOP = 120
        for s in SETS:
            info[s['id']] = pg.evaluate(LINEUP, [s['colors'], TOP])
            pg.wait_for_timeout(1200)
            pg.mouse.move(370, 660)
            pg.screenshot(path=f"{OUT}/lineup-{s['id']}.png", clip={'x': 0, 'y': TOP, 'width': 375, 'height': 8 * 46 + 4})
        print(json.dumps(info, ensure_ascii=False)); print('pageerror', errs)
        b.close()
finally:
    srv.shutdown(); srv.server_close()
