"""遺構の見かたの立体図を remains-help/<名前>.webp に書き出す。

    python remains-help-3d/build.py                  全部の図を書き出す
    python remains-help-3d/build.py karabori ido     指定した図だけ書き出す
    python remains-help-3d/build.py --preview DIR    書き出さずに、確認用の PNG（702×394px）を DIR に置く
    python remains-help-3d/build.py --check          カードと図の対応だけ確かめる

index.html を file:// で開き、render.js と figs.js で描いた canvas を画像にする（Playwright の Chromium を使う）。
"""
import base64
import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "remains-help"
PX = 960          # 書き出す横幅（縦は 540）。カードの図は 351px で、端末の画素の倍率 2〜3 倍と、PC の 480px 表示の 2 倍に足りる幅
QUALITY = 0.85


def main():
    args = sys.argv[1:]
    preview = None
    if "--preview" in args:
        i = args.index("--preview")
        preview = Path(args[i + 1])
        del args[i:i + 2]
    check_only = "--check" in args
    ids = [a for a in args if not a.startswith("--")]

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto((HERE / "index.html").as_uri() + "?none=1")
        page.wait_for_function("typeof FIGS !== 'undefined'")
        check = page.evaluate("cardsByFig()")

        def show(label, names):
            if not names:
                print(f"{label}: なし")
            else:
                head = "、".join(names[:10])
                print(f"{label}: {len(names)}件 {head}{' …' if len(names) > 10 else ''}")

        show("図の無いカード", check["missing"])
        show("figs.js に無い図の名前", check["unknown"])
        show("どのカードも使っていない図", check["unused"])
        if not check_only:
            if preview:
                preview.mkdir(parents=True, exist_ok=True)
                res = page.evaluate("([ids]) => exportFigs(ids, 'image/png', 1, 702)", [ids])
            else:
                OUT.mkdir(exist_ok=True)
                res = page.evaluate("([ids, q, px]) => exportFigs(ids, 'image/webp', q, px)", [ids, QUALITY, PX])
            total = 0
            for r in res:
                if "error" in r:
                    print(r["id"], r["error"])
                    continue
                head, b64 = r["data"].split(",", 1)
                data = base64.b64decode(b64)
                if preview:
                    path = preview / f"{r['id']}.png"
                else:
                    if "image/webp" not in head:
                        raise SystemExit("WebP で書き出せなかった: " + head)
                    path = OUT / f"{r['id']}.webp"
                path.write_bytes(data)
                total += len(data)
                print(f"{r['id']:<14} {r['w']}x{r['h']} {len(data):>7} bytes  面 {r['faces']:>6}  {r['ms']} ms")
            print(f"{len(res)} 枚 / 合計 {total} bytes")
        if errors:
            print("ページのエラー:", errors)
            sys.exit(1)
        browser.close()


if __name__ == "__main__":
    main()
