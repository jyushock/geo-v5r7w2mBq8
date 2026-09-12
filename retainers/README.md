# retainers（家臣団の画面）

戦国大名家の家臣団を一覧で見る画面です。地図のメニュー「一覧から検索 → 家臣団」から、
メニューの中の iframe で開きます（地図の `app.js` の `openRetainersView`）。

データを作る取得ツールは別のリポジトリ `D:\work\SamuraiRetainers` にあります。
GetTabelog（取得）とこのリポジトリ（表示）の関係と同じ形です（2026-09-12 に分けました）。

| ファイル | 中身 | 作るもの | 配信 |
|---|---|---|---|
| `index.html` | 表示のプログラム（`template.html` + `app.js` + `style.css`） | `build_app.py` | する |
| `data.js` | データだけ（`const DATA = …;`） | 取得ツール（`appsettings.json` の `OutputDir`） | する |
| `crests/` | 家紋の画像（touken-world.jp と Wikimedia の画像そのまま）。`data.js` が `crests/…` で指す | 取得ツール（同上。使わなくなった画像は取得ツールが消す） | する |
| `template.html` `app.js` `style.css` | `index.html` の材料 | 手で編集 | しない |
| `build_app.py` | `index.html` の組み立て | | しない |
| `mock/` | 表現方法の検討用モック。`build_mock.py` が `data.js` から作る | | しない |
| `usage.md` / `README.md` | 画面の使い方 / このファイル | | しない |

配信しないものは、地図リポジトリの `.assetsignore` に1つずつ書いています。
このフォルダにファイルを足したら、配信するかを決めて、しないならそちらにも足してください。

## 画面を直したとき

```bash
python retainers/build_app.py
```

`data.js` は取得ツールが書くので、ここでは作りません。

## データの根拠と限界

`D:\work\SamuraiRetainers\docs\data-notes.md` にあります。

## 家紋

家紋は元サイトの画像をそのまま出します（`crest.img`・`houses[].crestImg` が `crests/…` を指す）。
画像が無い人だけ、`template.html` の汎用マーク（`#m-generic`）を薄く出します。

以前は紋の名前から型を決め、型ごとに手で描いた SVG を出していましたが、実物と形が大きく違い
（武田菱が正方形で外枠付きになっていた）、型が別々の紋をまとめるので紋ごとの違いも出せなかったため、
2026-09-12 にやめました。**家紋の図案を手で描いて足さないでください。**
