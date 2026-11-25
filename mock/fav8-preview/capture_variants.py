import threading, functools, http.server, socketserver, json, sys, os, re
from playwright.sync_api import sync_playwright
ROOT, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
SETUP = re.search(r"SETUP = '''(.*?)'''", open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'capture8.py'), encoding='utf-8').read(), re.S).group(1)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Q, directory=ROOT))
port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
FAV4 = ['#E91E63', '#7B1FA2', '#00897B', '#7CB342']
VARIANTS = {
  'v1': {'colors': ['#880E4F', '#00BCD4', '#33691E', '#212121'], 'style': 'fill'},
  'v2': {'colors': ['#BA68C8', '#29B6F6', '#2E7D32', '#827717'], 'style': 'fill'},
  'v3': {'colors': ['#9575CD', '#29B6F6', '#4DB6AC', '#2E7D32'], 'style': 'fill'},
  'v4': {'colors': FAV4, 'style': 'ring'},
  'v5': {'colors': ['#880E4F', '#00BCD4', '#33691E', '#212121'], 'style': 'num'},
}
FG = {'#E91E63': '#FFFFFF', '#7B1FA2': '#FFFFFF', '#00897B': '#FFFFFF', '#7CB342': '#212121',
      '#880E4F': '#FFFFFF', '#00BCD4': '#212121', '#33691E': '#FFFFFF', '#212121': '#FFFFFF',
      '#BA68C8': '#212121', '#29B6F6': '#212121', '#2E7D32': '#FFFFFF', '#827717': '#FFFFFF', '#9575CD': '#212121', '#4DB6AC': '#212121'}
APPLY = '''([cols, style, fg]) => {
  [5,6,7,8].forEach((n, i) => { FAV_COLORS[n] = cols[i]; });
  const ids = ['fav-badge-circle', 'fav-badge-michi', 'fav-badge-card'];
  const ring = ['>', ['get', '_mk'], 4];
  for (const id of ids) {
    if (style === 'ring') {
      map.setPaintProperty(id, 'circle-color', ['case', ring, '#FFFFFF', ['get', '_mkColor']]);
      map.setPaintProperty(id, 'circle-stroke-color', ['case', ring, ['get', '_mkColor'], '#FFFFFF']);
      map.setPaintProperty(id, 'circle-stroke-width', ['case', ring, 3, 1.5]);
      map.setPaintProperty(id, 'circle-radius', ['case', ring, 4.5, 6]);
    }
  }
  if (style === 'num') {
    const font = map.getStyle().layers.map(l => l.layout && l.layout['text-font']).find(Boolean);
    map.addLayer({ id: 'fav-badge-num', type: 'symbol', source: 'fav-objects', filter: ['==', ['get', '_shape'], 'circle'],
      layout: { 'text-field': ['to-string', ['get', '_mk']], 'text-size': 9, 'text-font': font,
                'text-allow-overlap': true, 'text-ignore-placement': true },
      paint: { 'text-color': ['match', ['get', '_mkColor'], ...Object.entries(fg).flat(), '#FFFFFF'],
               'text-translate': [11.5, -11.5], 'text-translate-anchor': 'viewport' } });
  }
  refreshFavOverlay();
}'''
try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        for k, v in VARIANTS.items():
            pg = b.new_page(viewport={'width': 375, 'height': 667}, device_scale_factor=2)
            errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
            pg.goto(f'http://127.0.0.1:{port}/index.html')
            pg.wait_for_function('typeof searchIndex !== "undefined" && searchIndex.length > 30000 && map && map.getLayer("fav-bg-1")', timeout=90000)
            pg.evaluate(SETUP, [{str(n): c for n, c in zip([5, 6, 7, 8], v['colors'])}, {str(n): FG[c] for n, c in zip([5, 6, 7, 8], v['colors'])}])
            pg.evaluate(APPLY, [v['colors'], v['style'], FG])
            pg.wait_for_timeout(4000)
            pg.mouse.move(370, 660)
            pg.screenshot(path=f'{OUT}/badge-{k}.png', clip={'x': 0, 'y': 160, 'width': 375, 'height': 330})
            print(k, errs)
            pg.close()
        b.close()
finally:
    srv.shutdown(); srv.server_close()
