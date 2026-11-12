"""地図の本体 app.js を、src/app/ の部品をつないで作る。

    python tools/build_app_js.py

部品はファイル名の順（01-… → 30-…）に、そのままつなぐ。中身には手を加えない。
配るのは今までどおり1つの app.js。部品を別々の <script> で読ませないのは、defer のスクリプトを
順に実行する合間に別のタスク（地図の読み込みやデータ取得の続き）が走り得て（HTML 仕様 13.2.7
"Spin the event loop until the first script … is ready"）、後ろの部品の関数がまだ無い状態で
前の部品の処理が呼ぶと止まるため。

app.js を直接直さないこと。部品を直してからこのスクリプトを走らせる。
組み立て忘れは tests/deploy/check_deploy.py（コミット前のフック）が止める。
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / 'src' / 'app'
OUT = ROOT / 'app.js'

HEADER = ('/* このファイルは tools/build_app_js.py が src/app/ の部品をつないで作る。直接編集しない。\r\n'
          '   部品を直したら python tools/build_app_js.py を走らせる。 */\r\n').encode('utf-8')


def parts():
    files = sorted(SRC.glob('*.js'))
    if not files:
        raise SystemExit(f'{SRC} に部品がない')
    return files


def build():
    return HEADER + b''.join(f.read_bytes() for f in parts())


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    data = build()
    OUT.write_bytes(data)
    print(f'{OUT.name} を {len(parts())} 個の部品から作った（{len(data):,} バイト）')


if __name__ == '__main__':
    main()
