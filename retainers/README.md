# retainers（家臣団の画面）

戦国大名家の家臣団を一覧で見る画面です。地図のメニュー「一覧から検索 → 家臣団」から、
メニューの中の iframe で開きます（地図の `app.js` の `openRetainersView`）。

データを作る取得ツールは別のリポジトリ `D:\work\SamuraiRetainers` にあります。
GetTabelog（取得）とこのリポジトリ（表示）の関係と同じ形です（2026-09-12 に分けました）。

| ファイル | 中身 | 作るもの | 配信 |
|---|---|---|---|
| `index.html` | 表示のプログラム（`template.html` + `app.js` + `style.css`） | `build_app.py` | する |
| `data.js` | データだけ（`const DATA = …;`） | 取得ツール（`appsettings.json` の `OutputDir`） | する |
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

家紋の図案の型（`crest.type`）を増やすときは、取得ツールの `tool/Mergers/RetainersBuilder.cs` の
`CrestTypes` と、ここの `template.html` の SVG シンボル（`#m-<type>`）の両方を直します。
定義の無い型を指すと何も描かれません。
