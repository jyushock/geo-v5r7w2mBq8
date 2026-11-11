# -*- coding: utf-8 -*-
"""castle.js の各城に指定文化財（culturalAsset）を付ける。

経緯・判断・照合結果は CULTURAL_ASSET.md にまとめてある。ここには手順だけを書く。

入力（GetTabelog の中間キャッシュ。取得済みのものを使い、ここでは取得しない）
  castle_kojodan_detail.js : 攻城団の個別ページの「指定文化財」
  castle_shirohb.js        : 城郭放浪記の「文化財指定」
出力
  castle.js を上書きする。既存の culturalAsset を全部消してから付け直すので、何度流しても同じ結果になる。
  書き換えるのは culturalAsset の行だけで、ほかの行や書式には触れない。

使い方
  python -I gen_cultural_asset.py [キャッシュのフォルダ]
  （省略時は D:/work/GetTabelog/bin/Release/net8.0-windows7.0）
"""
import json
import re
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
CASTLE_JS = HERE / 'castle.js'
CACHE_DIR = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('D:/work/GetTabelog/bin/Release/net8.0-windows7.0')

# 城郭放浪記が「指定なし」を表す値。表示しない。
NONE_VALUES = {'なし/不明', 'なし', '不明'}

# 攻城団と城郭放浪記で指定区分が食い違った城を、公的な資料で照合して決めた値（2026-11-11）。
# 根拠の資料は CULTURAL_ASSET.md の「照合結果」に城ごとに書いてある。キーは (都道府県, castle.js の name)。
OVERRIDES = {
    # 国指定文化財等データベースで国の史跡と確認（城郭放浪記が正しかった）
    ('福島県', '白川城'): '国指定史跡',
    ('岐阜県', '岐阜城'): '国指定史跡',
    # 現在は出水市指定史跡「城山（亀ヶ城・花見ヶ城）」。2026-06-19 に文化審議会が国史跡「出水城跡」へ答申したが、
    # 2026-11-11 時点で官報告示を確認できず、国指定文化財等データベースにも無い。告示を確認したら「国指定史跡」に直す
    ('鹿児島県', '出水城'): '市指定史跡（2026年6月19日に国指定史跡へ答申）',
    # 攻城団の値は合併前の旧町村による指定。合併後の各市の現行の指定文化財一覧で、市指定として載っていることを確認した
    ('静岡県', '蒲原城'): '市指定史跡',
    ('秋田県', '根城館'): '市指定史跡',
    ('岐阜県', '向牧戸城'): '市指定史跡',
    ('静岡県', '勝坂城'): '市指定史跡',
    ('滋賀県', '滝川城'): '市指定史跡',
    ('鹿児島県', '松山城'): '市指定史跡',
    # 攻城団は国の重要文化財だけ、城郭放浪記は市指定史跡だけ。新発田市の指定文化財一覧で両方を確認
    ('新潟県', '新発田城'): '国指定重要文化財（表門、二の丸隅櫓）、市指定史跡',
}


def load_features(path):
    text = path.read_text(encoding='utf-8')
    return json.loads(text[text.index('{'):text.rindex('}') + 1])['features']


def normalize(value):
    """攻城団の「国史跡」型を、城郭放浪記の「国指定史跡」型にそろえる。"""
    v = re.sub(r'\s+', ' ', value).strip()
    v = re.sub(r'、\s+', '、', v)
    v = re.sub(r'\s+、', '、', v)
    v = re.sub(r'(^|[、\s（(])(国|県|都|道|府|市|町|村)史跡', r'\1\2指定史跡', v)
    v = re.sub(r'国の(重要文化財|名勝|天然記念物)', r'国指定\1', v)
    v = v.replace('国の登録有形文化財', '国登録有形文化財')
    return v


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    kojodan = {f['properties']['kojodanUrl']: f['properties'].get('culturalAsset')
               for f in load_features(CACHE_DIR / 'castle_kojodan_detail.js')}
    shirohb = {f['properties']['shiroHbUrl']: f['properties'].get('culturalAsset')
               for f in load_features(CACHE_DIR / 'castle_shirohb.js') if f['properties'].get('shiroHbUrl')}

    # 既存の culturalAsset を消してから付け直す
    text = CASTLE_JS.read_text(encoding='utf-8')
    text = re.sub(r'\n *"culturalAsset": "[^"\n]*",(?=\n)', '', text)
    features = load_features_from_text(text)

    values, source = [], Counter()
    used_overrides = set()
    for f in features:
        p = f['properties']
        key = (p.get('prefecture'), p.get('name'))
        k = kojodan.get(p['url']) if p.get('url') else None
        h = shirohb.get(p['shiroHbUrl']) if p.get('shiroHbUrl') else None
        if key in OVERRIDES and (k or h):
            values.append(OVERRIDES[key]); source['照合で決めた値'] += 1; used_overrides.add(key)
        elif k and k not in NONE_VALUES:
            values.append(normalize(k)); source['攻城団'] += 1
        elif h and h not in NONE_VALUES:
            values.append(normalize(h)); source['城郭放浪記'] += 1
        else:
            values.append(None)
    missing = set(OVERRIDES) - used_overrides
    if missing:
        raise SystemExit(f'OVERRIDES の城が castle.js で見つからない（名前が変わった可能性）: {missing}')

    # "properties": { の出現順は features の順と同じ。その直後の行に差し込む
    starts = [m.end() for m in re.finditer(r'"properties": \{\n', text)]
    assert len(starts) == len(features), (len(starts), len(features))
    out, last = [], 0
    for pos, v in zip(starts, values):
        out.append(text[last:pos]); last = pos
        if v:
            indent = re.match(r' *', text[pos:]).group(0)
            out.append(f'{indent}"culturalAsset": {json.dumps(v, ensure_ascii=False)},\n')
    out.append(text[last:])
    new_text = ''.join(out)

    check = load_features_from_text(new_text)
    assert sum(1 for f in check if f['properties'].get('culturalAsset')) == sum(1 for v in values if v)
    CASTLE_JS.write_text(new_text, encoding='utf-8', newline='')
    print(dict(source), '計', sum(source.values()))


def load_features_from_text(text):
    return json.loads(text[text.index('{'):text.rindex('}') + 1])['features']


if __name__ == '__main__':
    main()
