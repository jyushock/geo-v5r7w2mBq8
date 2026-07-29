# castle.js の城主（lords）を人物・氏族ごとにまとめ、castle-lords.html を生成する。
# 使い方: python gen_castle_lords.py
import json, re, collections, os

BASE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(BASE, 'castle.js')
OUT = os.path.join(BASE, 'castle-lords.html')

# 城主欄の区切り。読点のほかに半角読点・中黒（半角）・継承の矢印・空白も区切りとして扱う。
SPLIT = re.compile(r'[、,，･→\s;；]+')

# 実体のない値。castle.js には原典どおり残っているが、集計対象からは外す。
SKIP_VALUES = {'不明', '不詳', 'なし', '無し'}

# 城郭放浪記のアクセス解説文が城主欄に混入している既知の4件（castle.js 側のデータ不良）。
# 除外対象を明示しておき、元データが直ったら空振りするだけで済むようにする。
NOISE_VALUES = {
    '潮山の西側を通る県道209号線沿いに道標があり',
    'それに従って山へ入って行くと茶畑の間を通って城址近くまで車で行くことができる。',
    '西側から泰仙寺橋へ続く道の北側に土手下を走る道があり',
    'そこに案内板がある。',
    '関澤神社脇から登る。',
}


def normalize(raw):
    """集計キーを作る。末尾の括弧注記（石高・別称）と推量記号を落とす。
    先頭の括弧注記（分家名・役職）は個人名のときだけ落とす。氏族名から落とすと
    『（大給）松平氏』が『松平氏』に吸われて分家の区別が消えるため。
    『武田（蠣崎）信廣』のような語中の括弧は人名の一部なので触らない。"""
    t = raw.strip().strip('?？。')
    t = t.replace('(', '（').replace(')', '）')
    t = re.sub(r'（[^（）]*）$', '', t).strip()
    m = re.match(r'^（[^（）]*）(.+)$', t)
    if m and not m.group(1).endswith('氏'):
        t = m.group(1).strip()
    return t


def main():
    src = open(SRC, encoding='utf-8').read()
    src = re.sub(r'^\s*const\s+castleData\s*=\s*', '', src).rstrip().rstrip(';')
    data = json.loads(src)
    feats = data['features']

    castles = []          # [name, prefecture, url, genre]
    lord_castles = collections.defaultdict(list)   # key -> [castle index]
    variants = collections.defaultdict(set)        # key -> {原文表記}
    n_with_lords = 0
    n_unknown_only = 0

    for ft in feats:
        p = ft['properties']
        raw_lords = p.get('lords')
        if not raw_lords:
            continue
        n_with_lords += 1
        idx = len(castles)
        keys = []
        for raw in SPLIT.split(raw_lords):
            raw = raw.strip()
            if not raw or raw in NOISE_VALUES:
                continue
            key = normalize(raw)
            if not key or key in SKIP_VALUES or key in NOISE_VALUES:
                continue
            if key not in keys:
                keys.append(key)
            variants[key].add(raw)
        if not keys:
            n_unknown_only += 1
            continue
        castles.append([p.get('name', ''), p.get('prefecture', ''), p.get('url', ''), p.get('genre', '')])
        for key in keys:
            lord_castles[key].append(idx)

    lords = []
    for key, idxs in lord_castles.items():
        vs = sorted(v for v in variants[key] if v != key)
        lords.append({
            'n': key,
            'c': 1 if key.endswith('氏') else 0,   # 1=氏族名 0=個人名
            'k': idxs,
            'v': vs,
        })
    # 城数の多い順、同数なら名前順
    lords.sort(key=lambda x: (-len(x['k']), x['n']))

    stats = {
        'features': len(feats),
        'withLords': n_with_lords,
        'unknownOnly': n_unknown_only,
        'castles': len(castles),
        'lords': len(lords),
        'clans': sum(1 for x in lords if x['c']),
        'persons': sum(1 for x in lords if not x['c']),
        'multi': sum(1 for x in lords if len(x['k']) >= 2),
        'pairs': sum(len(x['k']) for x in lords),
    }
    print(stats)

    payload = json.dumps({'castles': castles, 'lords': lords, 'stats': stats},
                         ensure_ascii=False, separators=(',', ':'))
    html = TEMPLATE.replace('/*__DATA__*/', payload)
    open(OUT, 'w', encoding='utf-8', newline='\n').write(html)
    print('wrote', OUT, os.path.getsize(OUT), 'bytes')


TEMPLATE = r'''<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>城主別 城一覧 - castle.js</title>
<style>
  :root{
    --bg:#f6f4ef; --panel:#fffdf8; --line:#ddd6c8; --fg:#2c2823; --sub:#7a7165;
    --accent:#8a5a2b; --accent-bg:#efe3d4; --chip:#f2ede3; --shadow:0 1px 2px rgba(60,45,25,.07);
  }
  @media (prefers-color-scheme:dark){
    :root{
      --bg:#1a1815; --panel:#232019; --line:#3b352c; --fg:#e9e3d8; --sub:#a79c8c;
      --accent:#d9a86a; --accent-bg:#3a2f21; --chip:#2c2822; --shadow:none;
    }
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--fg);
    font-family:"Yu Gothic UI","Hiragino Kaku Gothic ProN","Noto Sans JP",system-ui,sans-serif;
    font-size:15px;line-height:1.6;}
  header{position:sticky;top:0;z-index:10;background:var(--panel);border-bottom:1px solid var(--line);
    padding:12px 16px 10px;box-shadow:var(--shadow)}
  h1{margin:0 0 4px;font-size:19px;letter-spacing:.02em}
  .stats{color:var(--sub);font-size:12.5px;margin-bottom:10px}
  .stats b{color:var(--fg);font-weight:600}
  .controls{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
  input[type=search]{flex:1 1 220px;min-width:180px;padding:7px 10px;border:1px solid var(--line);
    border-radius:8px;background:var(--bg);color:var(--fg);font-size:14px;font-family:inherit}
  .seg{display:flex;border:1px solid var(--line);border-radius:8px;overflow:hidden}
  .seg button{border:0;background:var(--panel);color:var(--sub);padding:7px 11px;font-size:13px;
    cursor:pointer;font-family:inherit;border-right:1px solid var(--line)}
  .seg button:last-child{border-right:0}
  .seg button[aria-pressed=true]{background:var(--accent-bg);color:var(--accent);font-weight:600}
  main{padding:14px 16px 40px;max-width:1180px;margin:0 auto}
  .hit{color:var(--sub);font-size:12.5px;margin:0 0 10px}
  .list{display:grid;gap:10px;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));align-items:start}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:10px 12px 11px;
    box-shadow:var(--shadow)}
  .lord{display:flex;align-items:baseline;gap:7px;flex-wrap:wrap;margin-bottom:6px}
  .lord .nm{font-size:16px;font-weight:700;letter-spacing:.01em}
  .tag{font-size:11px;padding:1px 6px;border-radius:99px;border:1px solid var(--line);color:var(--sub)}
  .tag.clan{background:var(--accent-bg);color:var(--accent);border-color:transparent}
  .num{margin-left:auto;font-size:12.5px;color:var(--sub);white-space:nowrap}
  .num b{color:var(--accent);font-size:15px}
  .alias{font-size:11.5px;color:var(--sub);margin:-2px 0 6px}
  .castles{display:flex;flex-wrap:wrap;gap:5px}
  .c{display:inline-flex;align-items:baseline;gap:4px;background:var(--chip);border:1px solid transparent;
    border-radius:7px;padding:2px 7px;font-size:13px;text-decoration:none;color:var(--fg)}
  a.c:hover{border-color:var(--accent);color:var(--accent)}
  .c .pf{font-size:11px;color:var(--sub)}
  .c .g{font-size:10.5px;color:var(--accent)}
  mark{background:var(--accent-bg);color:var(--accent);border-radius:3px;padding:0 1px}
  .more{display:block;margin:16px auto 0;padding:9px 20px;border:1px solid var(--line);border-radius:8px;
    background:var(--panel);color:var(--fg);font-size:14px;cursor:pointer;font-family:inherit}
  footer{max-width:1180px;margin:0 auto;padding:0 16px 40px;color:var(--sub);font-size:12px;line-height:1.8}
  footer h2{font-size:13px;color:var(--fg);margin:18px 0 4px}
  footer ul{margin:0;padding-left:1.2em}
</style>
</head>
<body>
<header>
  <h1>城主別 城一覧</h1>
  <div class="stats" id="stats"></div>
  <div class="controls">
    <input type="search" id="q" placeholder="城主名・城名・都道府県で絞り込み" autocomplete="off">
    <div class="seg" id="type">
      <button data-v="all" aria-pressed="true">すべて</button>
      <button data-v="clan" aria-pressed="false">氏族</button>
      <button data-v="person" aria-pressed="false">個人</button>
    </div>
    <div class="seg" id="min">
      <button data-v="2" aria-pressed="true">2城以上</button>
      <button data-v="3" aria-pressed="false">3城以上</button>
      <button data-v="1" aria-pressed="false">1城も表示</button>
    </div>
    <div class="seg" id="sort">
      <button data-v="count" aria-pressed="true">城数順</button>
      <button data-v="name" aria-pressed="false">名前順</button>
    </div>
  </div>
</header>
<main>
  <p class="hit" id="hit"></p>
  <div class="list" id="list"></div>
  <button class="more" id="more" hidden>さらに表示</button>
</main>
<footer>
  <h2>この資料について</h2>
  <ul>
    <li>出典: <code>castle.js</code> の <code>properties.lords</code>（攻城団・城郭放浪記・Wikipediaの城主欄を統合した値）。</li>
    <li>城主欄は「、」区切りの並びなので、読点・半角読点・「･」・継承の「→」・空白で分割して1人（1氏族）ずつに切り出している。</li>
    <li>末尾の括弧注記（石高・別称。例「小笠原氏（6万石）」「北畠氏（浪岡氏）」）と推量記号「?」は集計キーから外し、元の表記はカード内に併記した。語中の括弧（例「武田（蠣崎）信廣」）は人名の一部として残す。</li>
    <li>先頭の括弧注記は個人名のときだけ外す（「（久松）松平定勝」→「松平定勝」）。氏族名では分家の区別が消えるため残す（「（大給）松平氏」は「松平氏」と別項目）。</li>
    <li>「不明」「不詳」は集計から除外。表記ゆれ（例「南部光信」と「大浦光信」）の名寄せは行っていないため、同一人物が別項目に分かれている場合がある。</li>
    <li>「氏」で終わる項目を氏族、それ以外を個人として分類している（機械判定のため「江戸幕府」「皇室」等は個人側に入る）。</li>
    <li>城郭放浪記のアクセス解説文が城主欄に混入していた4城分（朝日山城(駿河国)・鷹尾城(筑後国)・倉田城・板西城）は、その文だけ除外した。</li>
    <li>城名のリンク先は攻城団の個別ページ（URLのある城のみ）。</li>
  </ul>
</footer>
<script>
const DATA = /*__DATA__*/;
const {castles, lords, stats} = DATA;
const el = id => document.getElementById(id);
const esc = s => s.replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const GENRE = {'日本100名城':'100', '続日本100名城':'続100'};

el('stats').innerHTML =
  `城主データのある城 <b>${stats.castles.toLocaleString()}</b> 件（全 ${stats.features.toLocaleString()} 件中） / ` +
  `城主 <b>${stats.lords.toLocaleString()}</b> 名（氏族 ${stats.clans.toLocaleString()}・個人 ${stats.persons.toLocaleString()}） / ` +
  `2城以上を持つ城主 <b>${stats.multi.toLocaleString()}</b> 名 / 城主と城の組 ${stats.pairs.toLocaleString()} 件`;

const state = {q:'', type:'all', min:2, sort:'count', shown:0};
const CHUNK = 120;
let filtered = lords;

const byName = [...lords].sort((a,b) => a.n.localeCompare(b.n,'ja'));

function matches(l, q){
  if (l.n.includes(q)) return true;
  if (l.v.some(v => v.includes(q))) return true;
  return l.k.some(i => castles[i][0].includes(q) || castles[i][1].includes(q));
}

function apply(){
  const q = state.q.trim();
  const base = state.sort === 'name' ? byName : lords;
  filtered = base.filter(l =>
    l.k.length >= state.min &&
    (state.type === 'all' || (state.type === 'clan') === !!l.c) &&
    (!q || matches(l, q)));
  el('hit').textContent = `${filtered.length.toLocaleString()} 名を表示`;
  el('list').innerHTML = '';
  state.shown = 0;
  render();
}

function hl(s, q){
  const e = esc(s);
  if (!q) return e;
  const i = s.indexOf(q);
  return i < 0 ? e : esc(s.slice(0,i)) + '<mark>' + esc(q) + '</mark>' + esc(s.slice(i+q.length));
}

function render(){
  const q = state.q.trim();
  const part = filtered.slice(state.shown, state.shown + CHUNK);
  const html = part.map(l => {
    const cs = l.k.map(i => {
      const [nm, pf, url, gr] = castles[i];
      const tag = GENRE[gr] ? `<span class="g">${GENRE[gr]}</span>` : '';
      const inner = `${hl(nm,q)}<span class="pf">${hl(pf,q)}</span>${tag}`;
      return url ? `<a class="c" href="${esc(url)}" target="_blank" rel="noopener">${inner}</a>`
                 : `<span class="c">${inner}</span>`;
    }).join('');
    const alias = l.v.length ? `<div class="alias">表記: ${l.v.map(v => esc(v)).join(' / ')}</div>` : '';
    return `<div class="card">
      <div class="lord"><span class="nm">${hl(l.n,q)}</span>
        <span class="tag ${l.c ? 'clan':''}">${l.c ? '氏族':'個人'}</span>
        <span class="num"><b>${l.k.length}</b> 城</span></div>
      ${alias}<div class="castles">${cs}</div></div>`;
  }).join('');
  el('list').insertAdjacentHTML('beforeend', html);
  state.shown += part.length;
  el('more').hidden = state.shown >= filtered.length;
  el('more').textContent = `さらに表示（残り ${(filtered.length - state.shown).toLocaleString()} 名）`;
}

let timer;
el('q').addEventListener('input', e => {
  clearTimeout(timer);
  timer = setTimeout(() => { state.q = e.target.value; apply(); }, 180);
});
for (const id of ['type','min','sort']){
  el(id).addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    [...el(id).children].forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    state[id] = id === 'min' ? Number(b.dataset.v) : b.dataset.v;
    apply();
  });
}
el('more').addEventListener('click', render);
apply();
</script>
</body>
</html>
'''

if __name__ == '__main__':
    main()
