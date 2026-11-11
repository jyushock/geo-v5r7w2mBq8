#!/usr/bin/env python3
"""配信物だけで画面が動くかを確かめるシナリオテスト。

check_deploy.py と同じ規則で「配信物」を一時フォルダへ書き出し、そこだけをローカルで配信して、
Chromium（Playwright）で主な画面を順に開く。各シナリオで

  ・自オリジンへの要求が 4xx/5xx になっていないか、通信に失敗していないか（配信物の欠け）
  ・ページの例外（pageerror）が出ていないか

を見る。外部（地図タイル・天気・unpkg など）の失敗は配信物と関係ないので数えない。

    python tests/deploy/scenario_test.py            # 画面なしで実行
    python tests/deploy/scenario_test.py --headed   # 画面を出して実行

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
        既知の例: unpkg の open-location-code（2015年の 1.0.3 が最新）は末尾の
        `exports.OpenLocationCode = …` がブラウザで ReferenceError になる。その手前で
        OpenLocationCode は定義済みなので、Plus Code の解析は動く。"""
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


SCENARIOS = [
    ('地図と全データの読み込み', scenario_map),
    ('遺構の見かた', scenario_remains_help),
    ('家臣団', scenario_retainers),
    ('Service Worker のプリキャッシュ', scenario_service_worker_precache),
]


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    ap = argparse.ArgumentParser()
    ap.add_argument('--headed', action='store_true')
    args = ap.parse_args()

    with tempfile.TemporaryDirectory() as tmp:
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
            server.shutdown()
            server.server_close()

    print('OK' if not failed else f'NG {failed} 件のシナリオ')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
