#!/usr/bin/env python3
"""配信物だけで画面が動くかを確かめるシナリオテスト。

check_deploy.py と同じ規則で「配信物」を一時フォルダへ書き出し、そこだけをローカルで配信して、
Chromium（Playwright）で主な画面を順に開く。各シナリオで

  ・自オリジンへの要求が 4xx/5xx になっていないか、通信に失敗していないか（配信物の欠け）
  ・ページの例外（pageerror）が出ていないか

を見る。外部（地図タイル・天気・unpkg など）の失敗は配信物と関係ないので数えない。

    python tests/deploy/scenario_test.py            # 画面なしで実行
    python tests/deploy/scenario_test.py --headed   # 画面を出して実行
    python tests/deploy/scenario_test.py --base https://geopenguin.minimal7.workers.dev   # デプロイ後の本番を確かめる

必要なもの: pip install playwright && python -m playwright install chromium
Service Worker は止めて実行する（前回の保存分で欠けが隠れないように）。
"""
import argparse
import functools
import http.server
import shutil
import sys
import tempfile
import threading
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from check_deploy import ROOT, deployed_files  # noqa: E402

from playwright.sync_api import sync_playwright  # noqa: E402

# 地図の点のデータ。全部が読み込まれるまで待つ（app.js の specs と同じ並び）
DATASETS = ['shopData', 'pokefutaGeoJSON', 'manholeGeoJSON', 'mhcardGeoJSON', 'michiNoEkiGeoJSON', 'castleData']


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def build_site(dest):
    files = deployed_files()
    for rel in files:
        out = dest / rel
        out.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / rel, out)
    return len(files)


class Watch:
    """自オリジンの失敗とページの例外を、シナリオごとに集める。"""

    def __init__(self, origin):
        self.origin = origin
        self.problems = []
        self.notes = []

    def attach(self, page):
        page.on('pageerror', self._on_pageerror)
        page.on('response', self._on_response)
        page.on('requestfailed', self._on_failed)

    def _own(self, url):
        return url.startswith(self.origin)

    def _on_pageerror(self, e):
        """例外の発生元が外部のスクリプトなら、配信物と関係ないので参考として出すだけにする。
        （以前は unpkg の open-location-code が毎回 exports で例外を投げていた。vendor/ に直して取り込んだ）"""
        frames = [ln.strip() for ln in (e.stack or '').splitlines()[1:] if ln.strip().startswith('at ')]
        if frames and 'http' in frames[0] and self.origin not in frames[0]:
            self.notes.append(f'外部スクリプトの例外（数えない）: {e.message} {frames[0]}')
        else:
            self.problems.append(f'pageerror: {e.message} {frames[0] if frames else ""}')

    def _on_response(self, r):
        if self._own(r.url) and r.status >= 400:
            self.problems.append(f'HTTP {r.status}: {r.url[len(self.origin):]}')

    def _on_failed(self, req):
        # 画面を閉じたときに打ち切られた要求（net::ERR_ABORTED）は欠けではない
        if self._own(req.url) and 'ERR_ABORTED' not in (req.failure or ''):
            self.problems.append(f'通信失敗 {req.failure}: {req.url[len(self.origin):]}')

    def take(self):
        p, self.problems = self.problems, []
        n, self.notes = self.notes, []
        return p, n


def scenario_map(page, base):
    """地図の画面を開き、6種類の点のデータと地図のスタイルが読み込まれるまで待つ。"""
    page.goto(base + '/index.html')
    cond = ' && '.join(f"typeof {name} !== 'undefined'" for name in DATASETS)
    page.wait_for_function(cond, timeout=120_000)
    page.wait_for_load_state('networkidle', timeout=60_000)


# 遅延読み込み（loading="lazy"）の画像は、表示域に入ってから読み始める。
# networkidle は「まだ読み始めていない」状態でも成り立つので使わず、読み終えた画像が出るまで待つ。
IMG_STATE_JS = """sel => {
    const imgs = [...document.querySelectorAll(sel)];
    return {
        shown: imgs.filter(i => i.complete && i.naturalWidth > 0).length,
        broken: imgs.filter(i => i.complete && i.naturalWidth === 0 && i.getAttribute('src'))
                    .map(i => i.getAttribute('src')),
    };
}"""


def wait_images(target, sel, label):
    """target（page か frame）で sel の画像が1枚以上表示されるまで待ち、表示できない画像を返す。"""
    try:
        target.wait_for_function(f'(({IMG_STATE_JS})({sel!r})).shown > 0', timeout=30_000)
    except Exception:
        pass
    st = target.evaluate(IMG_STATE_JS, sel)
    problems = [f'{label}を表示できない: {s}' for s in st['broken']]
    if st['shown'] == 0:
        problems.append(f'{label}が1枚も表示されていない')
    return problems


def scenario_remains_help(page, base):
    """遺構の見かた（図解）を開き、見えている立体図の画像が表示できるか。"""
    page.evaluate('openRemainsHelp()')
    problems = wait_images(page, 'img[src*="remains-help/"]', '立体図')
    page.evaluate('closeRemainsHelp()')
    return problems


def scenario_retainers(page, base):
    """メニューの家臣団（retainers/ を iframe で開く。app.js の RETAINERS_URL）を開き、家紋の画像が表示できるか。"""
    page.evaluate('openRetainersView()')
    frame = None
    for _ in range(100):
        frame = next((f for f in page.frames if '/retainers/' in f.url), None)
        if frame:
            break
        page.wait_for_timeout(100)
    if not frame:
        return ['家臣団の iframe が開かない']
    frame.wait_for_load_state('load', timeout=30_000)
    return wait_images(frame, 'img', '家臣団の画像')


def scenario_sheet_nearby_search(page, base):
    """店の情報シートの「この周辺を検索」を押すと、その店を検索地点にして周辺パネルが開くか。
    店名に ' を含む店（data.js に 110件ある。例: Fisherman's）と含まない店の両方で確かめる。
    以前は onclick='…' の中に店名をそのまま入れていたため、' で属性が切れて押しても何も起きなかった。"""
    problems = []
    for want_quote in (False, True):
        info = page.evaluate("""wantQuote => {
            const f = shopData.features.find(f => {
                const n = shopDisplayName(f.properties);
                return n && n.includes("'") === wantQuote && !n.includes('"');
            });
            if (!f) return null;
            const [lng, lat] = f.geometry.coordinates;
            openObjSheet('shop', f.properties.name || '', f.properties, lng, lat);
            return shopDisplayName(f.properties);
        }""", want_quote)
        label = '店名に \' を含む店' if want_quote else '店名に \' を含まない店'
        if info is None:
            problems.append(f'{label}が data.js に見つからない')
            continue
        btn = page.locator('.btn-nearby-search').first
        btn.click(timeout=10_000)
        try:
            page.wait_for_function("""name => (document.getElementById('nearby-search-origin')?.textContent || '').includes(name)""",
                                   arg=info, timeout=10_000)
        except Exception:
            got = page.evaluate("document.getElementById('nearby-search-origin')?.textContent")
            problems.append(f'{label}（{info}）: 周辺検索の検索地点に店名が出ない（出ているのは {got!r}）')
        page.evaluate("typeof closeNearbyPanel === 'function' && closeNearbyPanel()")
    return problems


def scenario_accessible_names(page, base):
    """地図の画面の操作要素（ボタン・リンク・入力）に、読み上げに使う名前があるか。
    絵だけのボタンは aria-label か title を付ける（aria-label は見た目を変えない）。"""
    unnamed = page.evaluate("""() => [...document.querySelectorAll(
            'button, [role=button], a[href], input:not([type=hidden]), select, textarea')]
        .filter(e => {
            const own = (e.getAttribute('aria-label') || e.getAttribute('title') || e.getAttribute('aria-labelledby')
                         || e.textContent || e.getAttribute('placeholder') || '').trim();
            const alt = [...e.querySelectorAll('img[alt], svg[aria-label]')]
                .map(i => (i.getAttribute('alt') || i.getAttribute('aria-label') || '').trim()).join('');
            const label = (e.id && document.querySelector(`label[for="${CSS.escape(e.id)}"]`)) || e.closest('label');
            return !own && !alt && !label;
        })
        .map(e => e.id ? '#' + e.id : e.outerHTML.slice(0, 80))""")
    return [f'名前の無い操作要素: {u}' for u in unnamed]


def scenario_plus_code(page, base):
    """Plus Code の解析（vendor/openlocationcode.js）。東京駅の座標を符号化して戻せるか。"""
    r = page.evaluate("""() => {
        if (typeof OpenLocationCode !== 'function') return null;
        const olc = new OpenLocationCode();
        const code = olc.encode(35.681236, 139.767125);
        const a = olc.decode(code);
        const short = olc.shorten(code, 35.68, 139.77);
        const full = olc.recoverNearest(short, 35.68, 139.77);
        return { code, lat: a.latitudeCenter, lng: a.longitudeCenter, full };
    }""")
    if r is None:
        return ['OpenLocationCode が定義されていない']
    problems = []
    if abs(r['lat'] - 35.681236) > 2e-4 or abs(r['lng'] - 139.767125) > 2e-4:
        problems.append(f'Plus Code の往復で座標がずれる: {r}')
    if r['full'] != r['code']:
        problems.append(f'短いコードから元に戻らない: {r}')
    return problems


def scenario_service_worker_precache(page, base):
    """sw.js のプリキャッシュ（install で cache.addAll）に挙げたファイルが全部取れるか。"""
    urls = page.evaluate("""async () => {
        const t = await (await fetch('sw.js')).text();
        const m = t.match(/const PRECACHE = \\[([^\\]]*)\\]/);
        return m ? [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]) : null;
    }""")
    if not urls:
        return ['sw.js から PRECACHE を読み取れない']
    problems = []
    for u in urls:
        st = page.evaluate('async u => (await fetch(u, {cache: "no-store"})).status', u)
        if st != 200:
            problems.append(f'プリキャッシュ {u}: HTTP {st}')
    return problems


def scenario_search_index(page, base):
    """全件検索の索引（app.js の searchIndex）。データが届くたびに届いた分だけ足す形にしたので、
    全データが揃ったあとの索引が、全種別をその場で作り直したものと中身も並びも同じかを見る。"""
    r = page.evaluate("""() => {
        const sources = [
            ['pokefuta', loadedData.pokefuta, 'pokemon'], ['manhole', loadedData.manhole, 'name'],
            ['mhcard', loadedData.mhcard, 'name'], ['castle', loadedData.castle, 'name'],
            ['michi', loadedData.michi, 'name'], ['shop', loadedData.shops, 'name'],
        ];
        const fresh = [];
        for (const [type, d, labelKey] of sources) {
            if (!d || !d.features) return { missing: type };
            for (const f of d.features) {
                const label = f.properties[labelKey] || '', sub = f.properties.address || '';
                fresh.push([type, label, sub, f.geometry.coordinates.join(','),
                            normalizeForSearch(label), normalizeForSearch(sub), f.properties]);
            }
        }
        const bad = [];
        if (searchIndex.length !== fresh.length) bad.push(`件数 ${searchIndex.length} / 作り直すと ${fresh.length}`);
        for (let i = 0; i < Math.min(searchIndex.length, fresh.length) && bad.length < 5; i++) {
            const a = searchIndex[i], b = fresh[i];
            const got = [a.type, a.label, a.sub, a.coords.join(','), a._normLabel, a._normSub, a.properties];
            if (got.some((v, k) => v !== b[k])) bad.push(`${i} 件目: ${a.type} ${a.label} / 作り直すと ${b[0]} ${b[1]}`);
        }
        return { bad, n: fresh.length };
    }""")
    if r.get('missing'):
        return [f'{r["missing"]} のデータが届いていない']
    return r['bad']


def scenario_actions(page, base):
    """押したときの振り分け（index.html の data-on-click など）。画面に出ている要素の名前がすべて呼べる関数か。
    押した要素の上で処理が走ること（外側の処理より先・data-stop で外側を止める）も見る。"""
    r = page.evaluate("""() => {
        const bad = [];
        for (const type of ['click', 'input', 'change']) {
            for (const el of document.querySelectorAll(`[data-on-${type}]`)) {
                const n = el.getAttribute(`data-on-${type}`);
                if (!(window.ACTIONS && ACTIONS[n]) && typeof window[n] !== 'function') bad.push(`${type}: ${n}`);
            }
        }
        // 外側にクリック処理がある要素の中で押す。内側（data-on-click）が先に走り、data-stop なら外側は走らない
        const order = [];
        window.__probeInner = () => order.push('inner');
        const outer = document.createElement('div');
        outer.addEventListener('click', () => order.push('outer'));
        outer.innerHTML = '<button data-on-click="__probeInner"></button><button data-on-click="__probeInner" data-stop></button>';
        document.body.appendChild(outer);
        outer.children[0].click();
        const first = order.join(',');
        order.length = 0;
        outer.children[1].click();
        const second = order.join(',');
        outer.remove(); delete window.__probeInner;
        return { bad: [...new Set(bad)], first, second };
    }""")
    problems = [f'呼べない名前: {b}' for b in r['bad']]
    if r['first'] != 'inner,outer':
        problems.append(f'押した要素より外側の処理が先に走る（順番 {r["first"]}）')
    if r['second'] != 'inner':
        problems.append(f'data-stop で外側の処理が止まらない（順番 {r["second"]}）')
    return problems


def scenario_ios_nearby_categories(page, base):
    """iPhone では、周辺検索のカテゴリ（Googleマップへ飛ぶもの）をリンクで覆い、押したときの window.open を外す
    （24-remains-help.js の setupIosNearbyGmapLinks 相当）。外し忘れると、リンクと window.open の両方が開く。"""
    ctx = page.context.browser.new_context(
        viewport={'width': 390, 'height': 844}, service_workers='block',
        user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1')
    try:
        p = ctx.new_page()
        p.goto(base + '/index.html')
        p.wait_for_function("document.querySelector('.nearby-cat-item > a')", timeout=60_000)
        r = p.evaluate("""() => {
            const opened = [];
            window.open = (u) => { opened.push(u); return null; };
            const linked = [...document.querySelectorAll('.nearby-cat-item')].filter(i => i.querySelector(':scope > a'));
            const left = linked.filter(i => i.hasAttribute('data-on-click') || i.hasAttribute('onclick')).map(i => i.dataset.cat);
            linked[0].click();   // 枠線（リンクの外）を押したのと同じ
            return { n: linked.length, left, opened: opened.length };
        }""")
    finally:
        ctx.close()
    problems = []
    if not r['n']:
        problems.append('リンクで覆われたカテゴリが無い')
    if r['left']:
        problems.append(f'押したときの処理が残っている: {r["left"]}')
    if r['opened']:
        problems.append(f'カテゴリの枠を押すと window.open が {r["opened"]} 回呼ばれる')
    return problems


def scenario_manifest_icons(page, base):
    """manifest のアイコンが取れ、maskable 用は絵が安全領域（中心から半径 40% の円。W3C Web App Manifest）に収まるか。
    暗い画素（線と地図のピン）の中心からの最遠距離を測る。"""
    r = page.evaluate("""async () => {
        const man = await (await fetch('manifest.json', {cache: 'no-store'})).json();
        const out = [];
        for (const ic of man.icons || []) {
            const res = await fetch(ic.src, {cache: 'no-store'});
            const item = { src: ic.src, purpose: ic.purpose || 'any', status: res.status, radius: null };
            if (res.ok && (ic.purpose || '').split(' ').includes('maskable')) {
                const img = new Image();
                img.src = URL.createObjectURL(await res.blob());
                await img.decode();
                const N = 512, c = document.createElement('canvas'); c.width = c.height = N;
                const g = c.getContext('2d'); g.drawImage(img, 0, 0, N, N);
                const d = g.getImageData(0, 0, N, N).data; let m = 0;
                for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
                    const i = (y * N + x) * 4;
                    if (d[i] < 120 && d[i + 1] < 120) m = Math.max(m, Math.hypot(x + 0.5 - N / 2, y + 0.5 - N / 2));
                }
                item.radius = m / N;
            }
            out.push(item);
        }
        return out;
    }""")
    problems = []
    if not any(i['purpose'].split().count('maskable') for i in r):
        problems.append('manifest に maskable のアイコンが無い')
    for i in r:
        if i['status'] != 200:
            problems.append(f"アイコン {i['src']}: HTTP {i['status']}")
        elif i['radius'] is not None and i['radius'] > 0.40:
            problems.append(f"maskable の {i['src']} が安全領域をはみ出す（半径 {i['radius'] * 100:.1f}%）")
    return problems


SCENARIOS = [
    ('地図と全データの読み込み', scenario_map),
    ('全件検索の索引', scenario_search_index),
    ('操作要素の名前', scenario_accessible_names),
    ('店のシートから周辺検索', scenario_sheet_nearby_search),
    ('Plus Code の解析', scenario_plus_code),
    ('遺構の見かた', scenario_remains_help),
    ('家臣団', scenario_retainers),
    ('Service Worker のプリキャッシュ', scenario_service_worker_precache),
    ('ホーム画面のアイコン', scenario_manifest_icons),
    ('押したときの振り分け', scenario_actions),
    ('iPhone の周辺検索のカテゴリ', scenario_ios_nearby_categories),
]


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    ap = argparse.ArgumentParser()
    ap.add_argument('--headed', action='store_true')
    ap.add_argument('--base', help='ローカルで配信せず、この URL（本番など）に対して走らせる')
    args = ap.parse_args()

    with tempfile.TemporaryDirectory() as tmp:
        server = None
        if args.base:
            base = args.base.rstrip('/')
            print(f'{base} に対して実行する')
        else:
            site = Path(tmp)
            n = build_site(site)
            print(f'配信物 {n} 件を一時フォルダに書き出した')
            handler = functools.partial(QuietHandler, directory=str(site))
            server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
            threading.Thread(target=server.serve_forever, daemon=True).start()
            base = f'http://127.0.0.1:{server.server_address[1]}'

        failed = 0
        try:
            with sync_playwright() as pw:
                browser = pw.chromium.launch(headless=not args.headed)
                ctx = browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True,
                                          has_touch=True, service_workers='block', locale='ja-JP')
                page = ctx.new_page()
                watch = Watch(base)
                watch.attach(page)
                for name, fn in SCENARIOS:
                    try:
                        extra = fn(page, base) or []
                    except Exception as e:  # 待ちの時間切れなど
                        extra = [f'{type(e).__name__}: {str(e).splitlines()[0]}']
                    seen, notes = watch.take()
                    problems = extra + seen
                    print(f'[{"OK" if not problems else "NG"}] {name}')
                    for p in problems:
                        print(f'    {p}')
                    for n in notes:
                        print(f'    参考: {n}')
                    failed += bool(problems)
                browser.close()
        finally:
            if server:
                server.shutdown()
                server.server_close()

    print('OK' if not failed else f'NG {failed} 件のシナリオ')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
