#!/usr/bin/env python3
"""配信物の静的検査。

Cloudflare Workers の静的アセットは wrangler.toml の [assets] directory = "./" で
リポジトリをまるごと配り、.assetsignore に書いたものだけを外す。ここでは

  1. 画面が読むファイルが、すべて配信物に残っているか（外しすぎの検出）
  2. 出してはいけないもの（.git・道具・資料・モック・作業記録）が外れているか（外し忘れの検出）

を確かめる。.assetsignore を書き換えたときと、画面が読むファイルを足したときに走らせる。

    python tests/deploy/check_deploy.py

配信物は「git が管理しているファイル」から .assetsignore に当たるものを除いたもの。
Cloudflare のビルドは git の作業ツリーをそのまま配るので、.git/ 以下も候補に加えて調べる。
.assetsignore の書式は .gitignore と同じ（Cloudflare の文書）なので、当たり判定は git 自身に任せる。
"""
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
IGNORE_FILE = ROOT / '.assetsignore'

# Cloudflare のビルドで作業ツリーに必ずある .git/ の代表。どれか1つでも配られたら失敗にする
GIT_SAMPLES = ['.git/HEAD', '.git/config', '.git/index', '.git/logs/HEAD', '.git/FETCH_HEAD',
               '.git/objects/ab/cdef0123456789', '.git/refs/heads/master']


def git(*args, cwd=ROOT, stdin=None, ok=(0,)):
    r = subprocess.run(['git', *args], cwd=cwd, input=stdin, capture_output=True)
    if r.returncode not in ok:
        raise RuntimeError(f'git {args[0]} が失敗: {r.stderr.decode("utf-8", "replace")}')
    return r.stdout


def tracked_files():
    return [p for p in git('ls-files', '-z').decode('utf-8').split('\0') if p]


def ignored_by_assetsignore(paths):
    """paths のうち .assetsignore に当たるものの集合。
    リポジトリの .gitignore を混ぜないよう、空の一時リポジトリで .assetsignore だけを除外規則にして判定する。"""
    with tempfile.TemporaryDirectory() as tmp:
        git('init', '-q', tmp, cwd=tmp)
        out = git('-c', f'core.excludesFile={IGNORE_FILE.as_posix()}',
                  'check-ignore', '--no-index', '-v', '-n', '-z', '--stdin',
                  cwd=tmp, stdin='\0'.join(paths).encode('utf-8'),
                  ok=(0, 1))   # 1 は「1件も当たらなかった」
    f = out.decode('utf-8').split('\0')
    hit = set()
    # -v -n -z の出力は「規則のファイル, 行番号, 規則, パス」の4つ組。当たらなかったものは規則のファイルが空
    for i in range(0, len(f) - 3, 4):
        src, _line, pattern, path = f[i:i + 4]
        if src and not pattern.startswith('!'):
            hit.add(path)
    return hit


def deployed_files():
    files = tracked_files()
    return set(files) - ignored_by_assetsignore(files)


# ── 出してはいけないもの ─────────────────────────────────────

def must_not_deploy(path):
    """配ってはいけないなら理由を返す。"""
    top = path.split('/', 1)[0]
    if top in ('.git', '.githooks', 'src', 'tools', 'mock', 'tests', 'sample', 'worker', 'remains-help-3d', '.claude', '__pycache__'):
        return f'{top}/ は画面が読まない'
    if path.startswith('retainers/mock/'):
        return 'retainers/mock/ は画面が読まない'
    name = path.rsplit('/', 1)[-1]
    if name in ('.gitignore', '.gitattributes', '.assetsignore', 'wrangler.toml'):
        return '設定ファイル'
    if name.endswith(('.py', '.md')):
        return 'スクリプト・資料'
    if name.endswith('_log.txt') or '.bak_' in name:
        return '作業記録・控え'
    if name.startswith('FreeSample-Vectorizer-io-'):
        return '素材の元ファイル'
    if path in ('retainers/app.js', 'retainers/style.css', 'retainers/template.html'):
        return 'retainers/index.html へ組み込む前の部品'
    return None


# ── 画面が読むもの ───────────────────────────────────────────

# 引用符やかっこで囲まれた相対パス。テンプレートの ${...} を含むものは下で個別に展開する
REF_RE = re.compile(r'''["'`(]((?:\./)?[A-Za-z0-9_\-./@]+\.(?:js|mjs|css|json|png|jpe?g|gif|svg|webp|html|ico))(?:\?[^"'`)\s]*)?["'`)]''')

# 画面のソースにパスの形で書かれているが、このサイトのファイルではないもの
NOT_SITE_FILES = {
    'maplibre-gl.mjs', 'maplibre-gl.css',   # unpkg から読む
}

# 参照を拾うファイル（画面として配るもの）
SCAN = ['index.html', 'app.js', 'sw.js', 'manifest.json', 'remains-help.js', 'retainers/index.html']


def resolve(base_file, ref):
    ref = ref[2:] if ref.startswith('./') else ref
    if ref.startswith('/'):
        return ref[1:]
    base_dir = base_file.rsplit('/', 1)[0] + '/' if '/' in base_file else ''
    parts = []
    for seg in (base_dir + ref).split('/'):
        if seg == '..':
            parts.pop()
        elif seg and seg != '.':
            parts.append(seg)
    return '/'.join(parts)


def read(path):
    return (ROOT / path).read_text(encoding='utf-8-sig', errors='replace')


def needed_files():
    """画面が読むファイルの集合と、それぞれの出所。"""
    need = {}

    def add(path, why):
        need.setdefault(path, why)

    for f in SCAN:
        text = read(f)
        for m in REF_RE.finditer(text):
            ref = m.group(1)
            if ref.rsplit('/', 1)[-1] in NOT_SITE_FILES or ref.startswith('//'):
                continue
            add(resolve(f, ref), f)

    # 天気のスタンプ（app.js: weather-icons/stamp/${名前}.png）
    m = re.search(r'var WMO_ICON = \{(.*?)\};', read('app.js'), re.S)
    assert m, 'app.js に WMO_ICON が見つからない'
    for name in set(re.findall(r"'([a-z-]+)'", m.group(1))):
        add(f'weather-icons/stamp/{name}.png', 'app.js WMO_ICON')

    # 遺構の見かたの立体図（remains-help.js: remains-help/${f3}.webp）
    f3 = set(re.findall(r"\bf3:\s*'([a-z0-9_-]+)'", read('remains-help.js')))
    assert f3, 'remains-help.js に f3 が見つからない'
    for name in f3:
        add(f'remains-help/{name}.webp', 'remains-help.js f3')

    # 家臣団の家紋（retainers/data.js が crests/ を指す）
    for ref in set(re.findall(r'crests/[A-Za-z0-9_.-]+', read('retainers/data.js'))):
        add(f'retainers/{ref}', 'retainers/data.js')

    # OSM のスプライト（app.js: addSprite('basics', '.../osm-shortbread/sprites/sprites')）
    for suf in ('.json', '.png', '@2x.json', '@2x.png'):
        add(f'osm-shortbread/sprites/sprites{suf}', 'app.js addSprite')

    return need


def main():
    sys.stdout.reconfigure(encoding='utf-8')   # Windows のパイプ先で cp932 にならないように
    deployed = deployed_files()
    errors = []

    need = needed_files()
    tracked = set(tracked_files())
    for path, why in sorted(need.items()):
        if path not in deployed:
            state = ('.assetsignore で外されている' if path in tracked
                     else 'git に追加されていない（配信は git の中身から作られる）' if (ROOT / path).exists()
                     else 'リポジトリに無い')
            errors.append(f'[外しすぎ] {path}（{why} が読む）: {state}')

    # 画面のソースに制御文字を直に書かない（ヌル文字が1つあるだけで grep などがファイルをバイナリ扱いする）。
    # 必要なら \0 のようにエスケープで書く
    for f in SCAN:
        for ln, line in enumerate((ROOT / f).read_bytes().split(b'\n'), 1):
            bad = [c for c in line if c < 0x20 and c not in (0x09, 0x0D)]
            if bad:
                errors.append(f'[制御文字] {f}:{ln}: {bytes(bad)!r} をエスケープで書く')

    # app.js は src/app/ の部品から tools/build_app_js.py が作る。部品だけ直して組み立てていない、
    # または app.js を直接直した、のどちらでも配る app.js と部品が食い違う
    sys.path.insert(0, str(ROOT / 'tools'))
    import build_app_js
    if (ROOT / 'app.js').read_bytes() != build_app_js.build():
        errors.append('[組み立て] app.js が src/app/ の部品と食い違う。部品を直して python tools/build_app_js.py を走らせる'
                      '（app.js を直接直したなら、その変更を部品へ移す）')

    # index.html と app.js を一緒に変えたら sw.js の VERSION も上げる（sw.js の冒頭の説明。
    # 上げないとデプロイ後の最初の1回が「新しい HTML＋古い app.js」で動く。2026-09-11 に一覧が閉じられなくなった）。
    # まだコミットしていない変更（作業ツリーと索引）を HEAD と比べて見る
    changed = set(git('diff', '--name-only', 'HEAD').decode('utf-8').split())
    if {'index.html', 'app.js'} <= changed:
        ver_re = re.compile(rb"const VERSION = '([^']+)'")
        old = ver_re.search(git('show', 'HEAD:sw.js'))
        new = ver_re.search((ROOT / 'sw.js').read_bytes())
        if old and new and old.group(1) == new.group(1):
            errors.append(f"[SW] index.html と app.js を一緒に変えているのに sw.js の VERSION が '{new.group(1).decode()}' のまま")

    # iOS のホーム画面のアイコンは PNG（Apple の資料）。180×180 を指していること
    m = re.search(r'<link rel="apple-touch-icon"[^>]*href="([^"]+)"', read('index.html'))
    icon = m and resolve('index.html', m.group(1))
    if not icon or not icon.endswith('.png') or not (ROOT / icon).exists():
        errors.append(f'[アイコン] apple-touch-icon が PNG を指していない: {icon}')
    else:
        head = (ROOT / icon).read_bytes()[:24]
        size = (int.from_bytes(head[16:20], 'big'), int.from_bytes(head[20:24], 'big'))
        if head[:8] != b'\x89PNG\r\n\x1a\n' or size != (180, 180):
            errors.append(f'[アイコン] {icon} が 180×180 の PNG でない: {size}')

    git_hit = ignored_by_assetsignore(GIT_SAMPLES)
    for p in GIT_SAMPLES:
        if p not in git_hit:
            errors.append(f'[外し忘れ] {p}: .git/ は配ってはいけない')
    for p in sorted(deployed):
        why = must_not_deploy(p)
        if why:
            errors.append(f'[外し忘れ] {p}: {why}')

    print(f'配信物 {len(deployed)} 件 / 画面が読むファイル {len(need)} 件を確認')
    if errors:
        print(f'NG {len(errors)} 件')
        for e in errors:
            print('  ' + e)
        return 1
    print('OK')
    return 0


if __name__ == '__main__':
    sys.exit(main())
