# -*- coding: utf-8 -*-
"""表示用データを表現モック用に整形し、template.html に埋め込む。

入力は1つ上のフォルダの data.js だけ。これは取得ツール（D:\\work\\SamuraiRetainers）が
書き出す成果物で、中身は data/retainers.json と同じ。氏名は既に「姓 名」に分かれている。

以前は sources/wikipedia/ を直接読み、氏名の切れ目の判定まで自分で持っていたが、
それは取得側の仕事で、同じ判定が取得ツール（tool/Core/NameSplitter.cs）にもあった。
表示側は取得側の成果物だけを読む。

家名・家紋名は ja.wikipedia の各氏族記事 infobox「家紋」フィールドで確認したもののみ載せる。
確認できなかった家は crest を null にして汎用マークで描く。
"""
import json, os, re, collections

MOCK = os.path.dirname(os.path.abspath(__file__))          # このファイルが置かれている retainers/mock/
ROOT = os.path.dirname(MOCK)                               # 地図リポジトリの retainers/

# 氏族記事 infobox の家紋フィールドで確認済みの家（2026-08-28 取得）
FAMILIES = [
    # key, 表示名, 紋の呼称(確認済みのみ), 色, Wikipedia記事
    ("takeda",    "武田",   "割菱（武田菱）", "#2f4f7f", "武田氏"),
    ("tokugawa",  "徳川",   "三つ葉葵",       "#3f6b45", "徳川氏"),
    ("hojo",      "北条",   "三つ鱗",         "#8c3b3b", "後北条氏"),
    ("uesugi",    "上杉",   "上杉笹",         "#5b4a8a", "上杉氏"),
    ("oda",       "織田",   "織田瓜",         "#b07a28", "織田氏"),
    ("imagawa",   "今川",   "今川赤鳥",       "#2f7f7a", "今川氏"),
    ("suwa",      "諏訪",   "梶の葉",         "#6f7f2f", "諏訪氏"),
    ("sanada",    "真田",   "六文銭",         "#8a5a2f", "真田氏"),
    ("anayama",   "穴山",   "三つ花菱",       "#4a6f8a", "穴山氏"),
    ("kiso",      "木曾",   "笹竜胆",         "#556b3f", "木曾氏"),
    ("toyotomi",  "豊臣",   None,             "#a8862f", "豊臣氏"),
    ("ogasawara", "小笠原", None,             "#7a6a5a", "小笠原氏"),
    ("murakami",  "村上",   None,             "#6a5a7a", "村上氏"),
    ("hashiba",   "羽柴",   None,             "#a8862f", "豊臣氏"),
    ("nagao",     "長尾",   None,             "#4a5a6a", "長尾氏"),
    ("asakura",   "朝倉",   None,             "#7a5a4a", "朝倉氏"),
    ("oyamada",   "小山田", None,             "#5a6a4a", "小山田氏"),
]
FAM_BY_PREFIX = [(f[1], f[0]) for f in FAMILIES]
# 前方一致は長い姓を先に判定する（小山田 が 小笠原 より先など）
FAM_BY_PREFIX.sort(key=lambda x: -len(x[0]))

TAKEDA3 = ["武田信虎", "武田信玄", "武田勝頼"]

# 出典が取れた年（武田勝頼の記事本文および三代の infobox）
LORD_SPANS = [
    {"title": "武田信虎", "birth": 1494, "death": 1574, "ruleFrom": None, "ruleTo": 1541,
     "note": "家督開始年は未確認。1541年に信玄へ（追放）"},
    {"title": "武田信玄", "birth": 1521, "death": 1573, "ruleFrom": 1541, "ruleTo": 1573,
     "note": "天文10年(1541)家督相続 / 元亀4年(1573)死去"},
    {"title": "武田勝頼", "birth": 1546, "death": 1582, "ruleFrom": 1573, "ruleTo": 1582,
     "note": "元亀4年(1573)家督相続 / 天正10年(1582)武田氏滅亡"},
]


def family_of(lord_title):
    for name, key in FAM_BY_PREFIX:
        if lord_title.startswith(name):
            return key
    return None


def main():
    data_path = os.path.join(ROOT, "data.js")
    if not os.path.exists(data_path):
        raise SystemExit(
            "%s がありません。SamuraiRetainers の取得ツールで「表示用データを作る」を実行してください。" % data_path)
    # data.js は「const DATA = {…};」。宣言と末尾の ; を外して JSON として読む
    text = open(data_path, encoding="utf-8").read()
    start = text.index("const DATA = ") + len("const DATA = ")
    src = json.loads(text[start:].rstrip().rstrip(";"))
    people = src["people"]
    by_title = {p["t"]: p for p in people}

    out = []
    for i, p in enumerate(people):
        # 主君がどの家の人かは、主君の名前から引く（表示の色分けに使う）
        lords = [{"t": l["t"], "l": l["l"], "f": family_of(l["t"])} for l in p["lords"]]
        fams, seen = [], set()
        for l in lords:
            if l["f"] and l["f"] not in seen:
                seen.add(l["f"]); fams.append(l["f"])
        rec = {
            "id": i, "t": p["t"], "n": p["n"],
            "u": p["u"], "b": p["b"], "d": p["d"],
            "bu": p["bu"], "du": p["du"],
            "br": p["br"], "dr": p["dr"],
            "lords": lords, "fams": fams, "gens": p["gens"],
            "clan": (p["clans"][0] if p["clans"] else None),
            "clans": p["clans"],
            "father": [f for f in p["father"] if f in by_title],
            "children": [c for c in p["children"] if c in by_title],
            "alias": p["alias"],
            "rank": p["rankTitle"],
        }
        out.append(rec)

    fams = [{"key": k, "name": n, "crest": c, "color": col, "article": a}
            for k, n, c, col, a in FAMILIES]

    payload = {
        "meta": {
            "generatedAt": src["meta"]["generatedAt"],
            "source": src["meta"]["source"],
            "license": src["meta"]["license"],
            "count": len(out),
        },
        "families": fams,
        "lordSpans": LORD_SPANS,
        "takeda3": TAKEDA3,
        "people": out,
    }

    tpl_path = os.path.join(MOCK, "template.html")
    tpl = open(tpl_path, encoding="utf-8").read()
    # データは別ファイルに出す。表示のプログラムに内包しない
    if 'src="data.js"' not in tpl:
        raise SystemExit("template.html が data.js を読み込んでいません")
    data_js = os.path.join(MOCK, "data.js")
    with open(data_js, "w", encoding="utf-8") as f:
        f.write("/* モックが読むデータ。../data.js から作る。手で編集しない。 */\n")
        f.write("const DATA = ")
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")
    html = tpl

    # ビュー実装は分割ファイルを結合して埋め込む
    parts = []
    for fn in sorted(os.listdir(MOCK)):
        if re.fullmatch(r"views_\w+\.js", fn):
            parts.append("/* ==== %s ==== */\n" % fn +
                         open(os.path.join(MOCK, fn), encoding="utf-8").read())
    if "/*__VIEWS__*/" not in html:
        raise SystemExit("template.html に /*__VIEWS__*/ がありません")
    html = html.replace("/*__VIEWS__*/", "\n".join(parts))
    print("views files:", len(parts))
    dst = os.path.join(MOCK, "representations.html")
    open(dst, "w", encoding="utf-8").write(html)
    print("wrote: %s %s bytes" % (data_js, format(os.path.getsize(data_js), ",")))

    # 検算表示
    print("people:", len(out))
    print("生没年そろい:", sum(1 for p in out if p["b"] and p["d"]))
    print("父リンクあり(データ内):", sum(1 for p in out if p["father"]))
    print("子リンクあり(データ内):", sum(1 for p in out if p["children"]))
    c = collections.Counter()
    for p in out:
        for f in p["fams"]: c[f] += 1
    print("家別 仕えた人数:", dict(c.most_common()))
    print("wrote:", dst, os.path.getsize(dst), "bytes")


if __name__ == "__main__":
    main()
