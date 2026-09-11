/* 大名家の家臣団
   データの根拠と限界は取得ツール（D:\work\SamuraiRetainers）の docs/data-notes.md、画面の操作は usage.md に置く。
   ここでは実装上の判断だけをコメントに残す。
   当主・年表・身分区分は家ごとに違うので、DATA.houses から引く。 */

const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/* 氏名は「姓 名」で持つが、記事名や infobox の父・子の欄は空白なしで書かれる。
   人物の照合と検索は、空白を落としてから行う。 */
const nosp = s => String(s == null ? '' : s).replace(/\s+/g, '');

/* ---------- 家 ----------
   当主列・年表・紋・身分区分は家ごとに違うので、定義（DATA.houses）から引く。
   当主の家督年と生没年、当主同士の親子関係は infobox から辿れない
   （当主は家臣ではないので people に入らない）ため、取得ツールが定義として書き出す。

   人物は house でどの家の家中かが分かる。1人が複数の家に仕えた場合は
   家ごとに1件あるので、家を切り替えるときに絞り直す。 */
const HOUSES = DATA.houses;
const RANK_PALETTE = ['#2f4f7f', '#6b4a2f', '#7a2e2e', '#3f6b45', '#5b4a8a', '#7a7266'];

let house, P, LORDS, YEARS, LORD_TITLES, EXTRA, ALL;
let RANK_COLOR = {}, RANK_ORDER = {}, BY = {}, BYID = {}, KIN_PAR = {}, KIN_KID = {};

/* 家を切り替える。家に依存するものは全てここで作り直す */
function setHouse(key) {
  house = HOUSES.find(h => h.key === key) || HOUSES[0];
  P = DATA.people.filter(p => p.house === house.key);
  LORDS = house.lords;
  YEARS = house.years;
  LORD_TITLES = LORDS.map(l => l.t);

  /* 身分区分の色と序列。区分は家ごとに違うので、定義の並び順に割り当てる */
  RANK_COLOR = {};
  RANK_ORDER = {};
  house.ranks.forEach((r, i) => {
    RANK_COLOR[r] = RANK_PALETTE[i % RANK_PALETTE.length];
    RANK_ORDER[r] = i;
  });

  /* 当主の擬似ノード。当主は people に無い（家臣として収集していない）ので、
     全体ツリーと家系表示で親子の骨格を描くために家の定義から作る */
  EXTRA = LORDS.filter(l => !P.some(p => p.t === l.t)).map((l, i) => ({
    id: -1 - i, t: l.t, n: l.n || l.t, house: house.key,
    u: 'https://ja.wikipedia.org/wiki/' + encodeURIComponent(l.t),
    b: l.b, d: l.d, br: '', dr: '',
    lords: [], gens: [], clans: [house.lordClan], clan: house.lordClan,
    rank: house.ranks[0], rankWhy: '当主', rankSure: 1, rankTitle: '', kuni: null, t24: false,
    crest: house.crest ? { type: house.crest, name: '', clan: house.lordClan, rep: false } : null,
    father: l.father ? [l.father] : [], children: [], parent: null, _lord: true,
  }));

  ALL = P.concat(EXTRA);
  BY = {}; BYID = {};
  ALL.forEach(p => { BY[p.t] = p; BYID[p.id] = p; });
  buildKin();

  // ヘッダの紋と題も選ばれた家のものにする
  const hc = document.getElementById('houseCrest');
  if (hc) hc.querySelector('use').setAttribute('href', '#m-' + (house.crest || 'generic'));
  const ht = document.getElementById('houseTitle');
  if (ht) ht.textContent = house.name + '家臣団';
  document.title = house.name + '家臣団';

  year = 0;
  closed.clear();
}

/* ---------- 並び順 ----------
   特筆される家臣（武田家なら二十四将）→ 身分区分の序列 → 官位の等級 → 生年 → 名前。
   官位は自由記述で受領名・自称を含むため、四等官の段階までの粗い目安にとどめる
   （精度については docs/data-notes.md）。 */
const OFFICE_GRADE = [[/守|大輔|頭|大夫|卿/, 1], [/介|少輔|助|亮/, 2], [/佐|丞|允|尉|進/, 3], [/目|属|志/, 4]];
function officeGrade(t) {
  if (!t) return 9;                       // 記載なしは最後
  let v = 8;                              // 記載はあるが四等官に落とせないものは、その手前
  for (const [re, n] of OFFICE_GRADE) if (re.test(t)) v = Math.min(v, n);
  return v;
}
function cmp(a, b) {
  return (a.t24 ? 0 : 1) - (b.t24 ? 0 : 1)
    || (RANK_ORDER[a.rank] ?? 99) - (RANK_ORDER[b.rank] ?? 99)
    || officeGrade(a.rankTitle) - officeGrade(b.rankTitle)
    || (a.b || 9999) - (b.b || 9999)
    || a.n.localeCompare(b.n, 'ja');
}

/* ---------- 血縁 ----------
   father / children は、養父・養子と娘の婿を除いた実の親子だけが入っている
   （選別は取得ツールの Wikitext.KinLinks、養子縁組の突き合わせは RetainersBuilder）。
   ここではさらに、この一覧の中に同名の人物がいるものだけを結ぶ（家中以外は落ちる）。
   つながる範囲が限られることは docs/data-notes.md に計測結果を置いた。 */
function buildKin() {
  KIN_PAR = {}; KIN_KID = {};
  const byName = {};
  ALL.forEach(p => { const k = nosp(p.n); (byName[k] = byName[k] || []).push(p); });
  const res = n => BY[n] || (byName[nosp(n)] && byName[nosp(n)].length === 1 ? byName[nosp(n)][0] : null);
  const link = (par, chi) => {
    if (!par || !chi || par.t === chi.t) return;
    (KIN_PAR[chi.t] = KIN_PAR[chi.t] || []).push(par.t);
    (KIN_KID[par.t] = KIN_KID[par.t] || []).push(chi.t);
  };
  ALL.forEach(p => {
    (p.father || []).forEach(n => link(res(n), p));
    (p.children || []).forEach(n => link(p, res(n)));
  });
  [KIN_PAR, KIN_KID].forEach(M => Object.keys(M).forEach(k => M[k] = [...new Set(M[k])]));
}
const kinKids = t => (KIN_KID[t] || []).map(x => BY[x]).filter(Boolean).sort(cmp);
const kinPars = t => (KIN_PAR[t] || []).map(x => BY[x]).filter(Boolean);

/* ---------- 主従 ----------
   親→子。年を指定したときは、その年の当主に仕えた記載のある者を当主の直下に付け替える
   （山県昌景は信玄・勝頼の両方に仕えたので、1573年を選べば勝頼の下に来る）。
   年を指定しないときの parent は、最初に仕えた代の当主（収集時に決めている）。 */
let KIDS = {};
function buildKids(y) {
  const L = y ? lordAt(y) : null;
  const K = {};
  P.forEach(p => {
    // その年の当主本人は根なので、家臣として置かない（勝頼は信玄の家臣でもあるため）
    if (L && p.t === L.t) return;
    let par = p.parent;
    if (L && isDirect(p)) {
      // その年の当主に仕えた記載があれば当主直下へ。
      // 無い場合、「対象外も薄く残す」なら当主直下に薄く置き、そうでなければ出さない
      par = p.lords.some(l => l.t === L.t) ? L.t : (dimMode ? L.t : null);
    }
    if (par && par !== p.t) (K[par] = K[par] || []).push(p);
  });
  Object.values(K).forEach(a => a.sort(cmp));
  return K;
}

let year = 0, view = 'lords', useGrp = true, dimMode = true, query = '';
const closed = new Set();

/* その年の当主。家督を継いだ年（from）が過ぎた当主のうち、最も新しい人。
   最初の当主は家督開始年が分からないことがあるので、既定にする。 */
function lordAt(y) {
  if (!y) return null;
  let cur = LORDS[0];
  for (const l of LORDS) if (l.from != null && y >= l.from) cur = l;
  return cur;
}
const isDirect = p => p.lords.some(l => LORD_TITLES.includes(l.t));
const isKin = () => view === 'kin';
const isFlat = () => view === 'whole';
/* 家全体は代でも主従でも分けない一枚の一覧なので、入れ子を持たせない */
const childrenOf = p => isKin() ? kinKids(p.t) : isFlat() ? [] : (KIDS[p.t] || []);

function aliveAt(p, y) {
  if (p.b && p.d) return p.b <= y && y <= p.d;
  if (p.b) return p.b <= y ? null : false;
  if (p.d) return p.d >= y ? null : false;
  return null;
}
/* その年に家中にいたか。陪臣は主人が家中にいたかで判断する */
let memo = new Map();
function inHouse(p, y) {
  if (!y) return { on: true, est: false };
  if (p._lord) { const a = aliveAt(p, y); return { on: a !== false, est: a === null }; }
  const k = p.id;
  if (memo.has(k)) return memo.get(k);
  const r = { on: false, est: false };
  memo.set(k, r);
  const L = lordAt(y);
  let served;
  if (isKin()) {
    served = true;                        // 家系表示では主従で絞らず、在世だけで判断する
  } else if (isDirect(p)) {
    served = p.lords.some(l => l.t === L.t);
  } else {
    const par = p.parent && BY[p.parent];
    served = par ? inHouse(par, y).on : false;
  }
  const a = aliveAt(p, y);
  r.on = served && a !== false;
  r.est = r.on && a === null;
  return r;
}
const hit = p => !query || nosp(p.n).includes(query) || nosp(p.t).includes(query) ||
  (p.clans || []).some(c => nosp(c).includes(query)) ||
  p.lords.some(l => nosp(l.l).includes(query) || nosp(l.t).includes(query)) ||
  nosp(p.kuni).includes(query) || nosp(p.alias).includes(query) || nosp(p.rank).includes(query);

/* level 0=その家の紋 / 1=紋が引けない（汎用マーク） / 2=一族の代表紋（個々の家の紋ではない）
   紋の名前は分かっても図案を用意していない場合（crest.type が無い）は、
   汎用マークになるので 1 として薄く出す。濃く出すと、その家の紋を
   描けているように見えてしまうため。 */
const monLevel = p => !p.crest || !p.crest.type ? 1 : (p.crest.rep ? 2 : 0);
function mon(type, color, size, level) {
  const op = level === 1 ? ';opacity:.22' : level === 2 ? ';opacity:.45' : '';
  return '<svg class="mon" style="width:' + size + 'px;height:' + size + 'px;color:' + color + op +
    '"><use href="#m-' + (type || 'generic') + '"/></svg>';
}

/* 表示判定：自分か子孫のどれかが対象なら出す */
let showCache = new Map();
function visible(p) {
  if (showCache.has(p.id)) return showCache.get(p.id);
  let v = inHouse(p, year).on && hit(p);
  showCache.set(p.id, v);
  if (!v) {
    for (const c of childrenOf(p)) if (visible(c)) { v = true; break; }
    showCache.set(p.id, v);
  }
  return v;
}
function countTree(p, seen) {
  seen = seen || new Set();
  if (seen.has(p.t)) return 0;      // 万一の循環を止める
  seen.add(p.t);
  let n = inHouse(p, year).on && hit(p) ? 1 : 0;
  childrenOf(p).forEach(c => n += countTree(c, seen));
  return n;
}

const drawn = new Set();
function nodeHtml(p, color) {
  if (drawn.has(p.t)) return '';    // 同じ人物を二度描かない（循環対策）
  drawn.add(p.t);
  const kids = childrenOf(p);
  const st = inHouse(p, year);
  const on = st.on && hit(p);
  if (!on && !visible(p) && !dimMode) return '';
  const open = !closed.has(p.t);
  const fa = kinPars(p.t);
  const meta = [(p.clans || []).join('→'), p.rankTitle,
    (!isKin() && fa.length ? '父：' + fa.map(x => x.n).join('・') : '')].filter(Boolean).join('　');
  let h = '<li class="node">' +
    /* 行は Wikipedia へのリンクそのもの。地図の城シートの Wikipedia ボタンと同じ
       <a target="_blank"> で開く（window.open(url, '_blank', 'noopener') だと
       iPhone で記事から戻るときに空のページを挟んだため、2026-09-12 に揃えた） */
    '<a class="row' + (on ? '' : ' dim') + (on && st.est ? ' est' : '') + '" href="' + esc(p.u) +
      '" target="_blank" data-id="' + p.id + '">' +
    '<span class="tw' + (kids.length ? ' has' : '') + '" data-tw="' + esc(p.t) + '">' +
      (kids.length ? (open ? '−' : '+') : '') + '</span>' +
    mon(p.crest ? p.crest.type : null, color, 21, monLevel(p)) +
    '<span class="nm">' + esc(p.n) + '</span>' +
    (p.t24 && house.featuredShort ? '<span class="t24">' + esc(house.featuredShort) + '</span>' : '') +
    (p.kuni ? '<span class="kn">' + esc(p.kuni) + '</span>' : '') +
    '<span class="yr">' + (p.b || '?') + '–' + (p.d || '?') + '</span>' +
    '<span class="meta">' + esc(meta) + '</span>' +
    (kids.length ? '<span class="yr">' + (isKin() ? '子' : '配下') + kids.length + '</span>' : '') +
    '</a>';
  if (kids.length && open) {
    const inner = kids.map(c => nodeHtml(c, color)).join('');
    if (inner) h += '<ul class="kids">' + inner + '</ul>';
  }
  return h + '</li>';
}

/* 当主直下を、身分区分でまとめる／2列に流す（当主別の表示で使う） */
function bodyHtml(L, direct) {
  let h = '<div class="lordbody">';
  if (useGrp) {
    house.ranks.forEach(rank => {
      const list = direct.filter(p => p.rank === rank);
      if (!list.length) return;
      const cnt = list.reduce((a, c) => a + countTree(c), 0);
      if (!cnt && !dimMode) return;
      const gk = 'G:' + L.t + ':' + rank;
      const open = !closed.has(gk);
      const col = RANK_COLOR[rank];
      h += '<section class="grp"><h3 data-tw="' + esc(gk) + '" style="color:' + col + '">' +
        (open ? '▾' : '▸') + ' ' + esc(rank) + '<span class="n">' + cnt + '名</span></h3>';
      if (open) {
        const inner = list.map(p => nodeHtml(p, col)).join('');
        h += '<div class="body">' + (inner ? '<ul class="kids">' + inner + '</ul>'
          : '<div class="empty">この年に該当者なし</div>') + '</div>';
      }
      h += '</section>';
    });
  } else {
    const half = Math.ceil(direct.length / 2);
    h += [direct.slice(0, half), direct.slice(half)].map(part =>
      '<section class="grp"><div class="body"><ul class="kids">' +
      part.map(p => nodeHtml(p, RANK_COLOR[p.rank] || '#7a7266')).join('') +
      '</ul></div></section>').join('');
  }
  return h + '</div>';
}

function lordHead(L, direct) {
  const n = direct.reduce((a, c) => a + countTree(c), 0);
  return '<div class="lordhead">' +
    '<svg class="mon"><use href="#m-' + (house.crest || 'generic') + '"/></svg>' +
    '<div><div class="nm">' + esc(L.n || L.t) + '</div>' +
    '<div class="sub">' + L.b + '–' + L.d + '　' + esc(L.note) + '</div></div>' +
    '<div class="cnt">家中 ' + n + '名' + (year ? '' : ' / 記載のある家臣 ' + direct.length + '家') + '</div></div>';
}

/* 家全体：当主を意識しない、家中全員のフラットな一覧。
   当主別が「どの代に仕えたか」で3つに割り、主従で入れ子にするのに対し、
   こちらは代でも主従でも分けず、並び順だけで通しに並べる。
   誰に仕えたかは行に出さず、ツールチップの「主君」で見る。 */
function flatHtml() {
  const on = p => inHouse(p, year).on && hit(p);
  const list = P.filter(p => dimMode || on(p)).sort(cmp);
  const n = P.filter(on).length;
  let h = '<div class="lordblock"><div class="lordhead">' +
    '<svg class="mon"><use href="#m-' + (house.crest || 'generic') + '"/></svg>' +
    '<div><div class="nm">' + esc(house.name) + '　全体</div>' +
    '<div class="sub">当主で分けず、家中の全員を通しで並べています</div></div>' +
    '<div class="cnt">' + (year ? 'この年の家中 ' : '') + n + '名</div></div>' +
    '<div class="lordbody">';
  const section = (title, col, part) => {
    if (!part.length) return '';
    if (!title) {
      const inner = part.map(p => nodeHtml(p, col)).join('');
      return inner ? '<section class="grp"><div class="body"><ul class="kids">' + inner + '</ul></div></section>' : '';
    }
    const gk = 'F:' + title;
    const open = !closed.has(gk);
    let x = '<section class="grp"><h3 data-tw="' + esc(gk) + '" style="color:' + col + '">' +
      (open ? '▾' : '▸') + ' ' + esc(title) + '<span class="n">' + part.filter(on).length + '名</span></h3>';
    if (open) {
      const inner = part.map(p => nodeHtml(p, col)).join('');
      x += '<div class="body">' + (inner ? '<ul class="kids">' + inner + '</ul>'
        : '<div class="empty">この年に該当者なし</div>') + '</div>';
    }
    return x + '</section>';
  };
  if (useGrp) {
    house.ranks.forEach(rank => h += section(rank, RANK_COLOR[rank], list.filter(p => p.rank === rank)));
  } else {
    const half = Math.ceil(list.length / 2);
    h += section('', '#7a7266', list.slice(0, half)) + section('', '#7a7266', list.slice(half));
  }
  return h + '</div></div>';
}

/* 血縁の森。親が特定できない者を根とし、2名以上つながる木だけをツリーで見せる */
function kinHtml() {
  const roots = ALL.filter(p => !kinPars(p.t).length).sort(cmp);
  const trees = [], alone = [];
  roots.forEach(p => (kinKids(p.t).length ? trees : alone).push(p));
  let h = '<div class="lordblock"><div class="lordhead">' +
    '<svg class="mon"><use href="#m-' + (house.crest || 'generic') + '"/></svg>' +
    '<div><div class="nm">' + esc(house.name) + '　家系</div>' +
    '<div class="sub">infobox の父・子のうち実の親子だけを、家中で相手を特定できた分だけ結んでいます</div></div>' +
    '<div class="cnt">' + trees.length + '系統 / 単独 ' + alone.length + '名</div></div>' +
    '<div class="lordbody">';
  trees.forEach(p => {
    const col = RANK_COLOR[p.rank] || '#7a7266';
    const inner = nodeHtml(p, col);
    if (inner) h += '<section class="grp"><div class="body"><ul class="kids">' + inner + '</ul></div></section>';
  });
  h += '</div>';
  const shown = alone.filter(p => inHouse(p, year).on && hit(p));
  if (shown.length) h += '<div class="note">血縁の相手を家中で特定できない人物が ' + shown.length +
    '名います。父・子の欄が空か、相手がこの一覧に入っていないか、養子縁組だけの関係です' +
    '（docs/data-notes.md）。</div>';
  return h + '</div>';
}

function render() {
  memo = new Map(); showCache = new Map(); drawn.clear();
  KIDS = buildKids(isKin() ? 0 : year);
  const L = lordAt(year);

  document.getElementById('years').innerHTML =
    '<span class="lb">年</span>' +
    YEARS.map(v => '<button data-y="' + v.y + '"' + (v.y === year ? ' class="on"' : '') + '>' +
      esc(v.lb) + (v.ev ? '<span class="ev">' + esc(v.ev) + '</span>' : '') + '</button>').join('') +
    '<span class="legend">' +
    (year
      ? '<span><i class="sw-sure">山県昌景</i> この年に在世</span>' +
        '<span><i class="sw-est">山県昌景</i> 在世は未確認</span>' +
        '<span><i class="sw-dim">山県昌景</i> この年の家中ではない</span>'
      : '<span>年を選ぶと、その年の当主と家中に絞り込みます</span>') +
    '</span>';

  let html = '', total = 0, est = 0;
  const pool = isKin() ? ALL : P;
  pool.forEach(p => { const s = inHouse(p, year); if (s.on && hit(p)) { total++; if (s.est) est++; } });

  if (isKin()) {
    html = kinHtml();
  } else if (view === 'whole') {
    html = flatHtml();
  } else {
    (L ? [L] : LORDS).forEach(L2 => {
      const direct = KIDS[L2.t] || [];
      html += '<div class="lordblock">' + lordHead(L2, direct) + bodyHtml(L2, direct) + '</div>';
    });
  }
  document.getElementById('tree').innerHTML = html;

  document.getElementById('stat').innerHTML =
    (year ? '<b>' + year + '年</b> <b>' + total + '名</b>' + (est ? '（推定 ' + est + '）' : '')
          : '全 <b>' + P.length + '名</b>');
}

/* ---------- 操作 ---------- */
function setView(v) {
  view = v;
  document.querySelectorAll('#view button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  // 家系は血縁でつなぐため、身分区分のまとめは効かない。
  // 消すと右寄せのツール列が縮んで左側のボタンが動くので、場所は残して無効にする
  const w = document.getElementById('grpw');
  w.classList.toggle('off', isKin());
  w.title = isKin() ? '家系は血縁でつなぐため、身分区分のまとめは使えません' : '';
  document.getElementById('grp').disabled = isKin();
  render();
}
document.getElementById('view').addEventListener('click', e => {
  const b = e.target.closest('button[data-v]'); if (!b) return;
  setView(b.dataset.v);
});
document.getElementById('years').addEventListener('click', e => {
  const b = e.target.closest('button[data-y]'); if (!b) return;
  year = +b.dataset.y; render();
});
document.getElementById('tree').addEventListener('click', e => {
  const tw = e.target.closest('[data-tw]');
  if (tw) {
    e.preventDefault();             // 開閉ボタンは行（リンク）の中にあるので、記事へ飛ばさない
    const k = tw.dataset.tw;
    closed.has(k) ? closed.delete(k) : closed.add(k);
    render(); return;
  }
  // 行のタップは <a target="_blank"> の既定の動作で記事を開く
});
document.getElementById('q').addEventListener('input', e => { query = nosp(e.target.value); render(); });
document.getElementById('grp').addEventListener('change', e => { useGrp = e.target.checked; render(); });
document.getElementById('dim').addEventListener('change', e => { dimMode = e.target.checked; render(); });
/* 家の切り替え。当主列・年表・紋・身分区分は、選ばれた家の定義から引く。
   家臣の多い順に並べる（人数が0の家は選んでも何も出ないので後ろへ） */
const houseSel = document.getElementById('house');
const HOUSE_SIZE = {};
DATA.people.forEach(p => HOUSE_SIZE[p.house] = (HOUSE_SIZE[p.house] || 0) + 1);
houseSel.innerHTML = HOUSES.slice()
  .sort((a, b) => (HOUSE_SIZE[b.key] || 0) - (HOUSE_SIZE[a.key] || 0) || a.name.localeCompare(b.name, 'ja'))
  .map(h => '<option value="' + h.key + '">' + esc(h.name) +
       '（' + (HOUSE_SIZE[h.key] || 0) + '名）</option>').join('');
houseSel.disabled = HOUSES.length < 2;
houseSel.addEventListener('change', e => {
  setHouse(e.target.value);
  setView(view);
  // 別の家の一覧になるので、前の家で読んでいた位置を引き継がず先頭から見せる
  scrollTo(0, 0);
});

/* ツールチップはマウスのときだけ出す。スマートフォンのタップでも mouseover → mousemove → … → click が届き、
   mouseout は別の要素をタップするまで来ない（Apple の Safari Web Content Guide「Handling Events」）。
   そのため記事から戻っても出たまま残り、位置も画面外にはみ出していた（2026-09-12、iPhone SE3）。
   pointer イベントなら pointerType でマウスとタップを見分けられる */
const tip = document.getElementById('tip');
const byMouse = e => e.pointerType === 'mouse';
document.addEventListener('pointerover', e => {
  if (!byMouse(e)) return;
  const row = e.target.closest('.row'); if (!row) return;
  const p = BYID[row.dataset.id];
  const kids = childrenOf(p);
  const fa = kinPars(p.t), ch = kinKids(p.t);
  const s = year ? inHouse(p, year) : null;
  tip.innerHTML = '<b>' + esc(p.n) + '</b>' + (p.t24 && house.featured ? ' <span class="w">' + esc(house.featured) + '</span>' : '') +
    '<br><span class="s">生没：' + esc(p.br || (p.b ? p.b + '–' + (p.d || '?') : '記載なし')) +
      (p.br ? ' ／ ' + esc(p.dr || '記載なし') : '') + '</span>' +
    '<br><span class="s">主君：' + esc(p.lords.map(l => l.l).join('→') || '記載なし') + '</span>' +
    (fa.length ? '<br><span class="s">父：' + esc(fa.map(x => x.n).join('・')) + '</span>' : '') +
    (ch.length ? '<br><span class="s">子：' + esc(ch.map(x => x.n).join('、')) + '</span>' : '') +
    (!isKin() && p.parent ? '<br><span class="s">この画面での主人：' + esc((BY[p.parent] || {}).n || p.parent) + '</span>' : '') +
    (!isKin() && kids.length ? '<br><span class="s">配下：' + esc(kids.map(k => k.n).join('、')) + '</span>' : '') +
    '<br><span class="s">氏族：' + esc((p.clans || []).join('→') || '記載なし') + (p.kuni ? '／' + esc(p.kuni) + '国' : '') + '</span>' +
    (p.rankTitle ? '<br><span class="s">官位：' + esc(p.rankTitle) + '</span>' : '') +
    '<br><span class="s">区分：' + esc(p.rank) + (p.rankWhy ? '（' + esc(p.rankWhy) + '）' : '') +
      (p.rankSure ? '' : ' <span class="w">推定</span>') + '</span>' +
    (p.crest ? '<br><span class="s">家紋：' + esc(p.crest.name || p.crest.type || '名称なし') +
      '（' + esc(p.crest.clan) + (p.crest.rep ? ' の代表紋' : ' の紋') + '）' +
      (p.crest.type ? '' : ' <span class="w">図案なし</span>') + '</span>' : '') +
    (s && s.est ? '<br><span class="w">この年の在世は確認できません</span>' : '') +
    '<br><span class="s">クリックで Wikipedia</span>';
  tip.style.opacity = 1;
});
document.addEventListener('pointermove', e => {
  if (!byMouse(e) || tip.style.opacity != 1) return;
  let x = e.clientX + 15, y = e.clientY + 17;
  if (x + tip.offsetWidth > innerWidth - 8) x = e.clientX - tip.offsetWidth - 15;
  if (y + tip.offsetHeight > innerHeight - 8) y = e.clientY - tip.offsetHeight - 17;
  tip.style.left = x + 'px'; tip.style.top = y + 'px';
});
document.addEventListener('pointerout', e => { if (byMouse(e) && e.target.closest('.row')) tip.style.opacity = 0; });

/* ---------- 先頭へ戻るボタン ----------
   スクロールしている間だけ出し、止まってから2秒で消す（2026-09-12 に決定）。
   止まってすぐに消さないのは、スマートフォンでは慣性スクロール中の最初のタップが
   スクロールを止めるだけで押せないため、止まったあとに押す猶予を残す。
   先頭に着いたら待たずに消す（そこで押しても動かないため）。 */
const toTop = document.getElementById('toTop');
let toTopTimer = 0;
addEventListener('scroll', () => {
  clearTimeout(toTopTimer);
  if (scrollY <= 0) { toTop.classList.remove('show'); return; }
  toTop.classList.add('show');
  toTopTimer = setTimeout(() => toTop.classList.remove('show'), 2000);
}, { passive: true });
toTop.addEventListener('click', () => scrollTo({ top: 0, behavior: 'smooth' }));

setHouse(houseSel.value || HOUSES[0].key);
setView('lords');
