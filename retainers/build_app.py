# -*- coding: utf-8 -*-
"""画面ファイル index.html を組み立てる。

  template.html + app.js + style.css → index.html

index.html は data.js を <script src> で読む。data.js は取得ツール
（D:\\work\\SamuraiRetainers）が appsettings.json の OutputDir でここへ直接書き出すので、
このスクリプトはデータを扱わない。2026-09-12 に取得側と表示側をリポジトリで分けたとき、
data.js を作る処理を取得ツールへ移した（GetTabelog が castle.js を書くのと同じ形）。

**データを index.html に埋め込まない。** 家が101家・7千件になるとデータだけで
5.5MB を超え、表示のプログラムを1行直すたびに巨大なファイルが作り直される。
表示のロジックとデータは別のファイルに分ける。

読み込みに fetch を使わないのは、file:// で開いたときに CORS で弾かれるため。
script なら同じ制限を受けず、ダブルクリックで開いても動く。
"""
import os

HERE = os.path.dirname(os.path.abspath(__file__))         # 地図リポジトリの retainers/

tpl = open(os.path.join(HERE, "template.html"), encoding="utf-8").read()
js = open(os.path.join(HERE, "app.js"), encoding="utf-8").read()
css = open(os.path.join(HERE, "style.css"), encoding="utf-8").read()

for ph in ("/*__APP__*/", "/*__CSS__*/"):
    if ph not in tpl:
        raise SystemExit("template.html に %s がありません" % ph)
if 'src="data.js"' not in tpl:
    raise SystemExit("template.html が data.js を読み込んでいません")

html = tpl.replace("/*__APP__*/", js).replace("/*__CSS__*/", css)
dst = os.path.join(HERE, "index.html")
open(dst, "w", encoding="utf-8").write(html)
print("wrote %s %s bytes" % (dst, format(os.path.getsize(dst), ",")))

if not os.path.exists(os.path.join(HERE, "data.js")):
    print("注意: data.js がありません。SamuraiRetainers の取得ツールで「表示用データを作る」を実行してください。")
