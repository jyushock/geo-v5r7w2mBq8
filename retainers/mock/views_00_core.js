/* 共通基盤：ビュー登録、スケール、家紋、ツールチップ */
const VIEWS = [];
const view = o => VIEWS.push(o);

const P = DATA.people;
const FAM = {};
DATA.families.forEach(f => FAM[f.key] = f);
const BY_T = {}; P.forEach(p => BY_T[p.t] = p);
const CREST_DEFINED = new Set(['takeda','tokugawa','hojo','uesugi','oda','imagawa','suwa','sanada','anayama','kiso']);

const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
// 氏名は「姓 名」で持ち、記事名は空白なし。検索は空白を落としてから照合する
const nosp = s => String(s == null ? '' : s).replace(/\s+/g, '');
const crestId = k => '#cr-' + (CREST_DEFINED.has(k) ? k : 'generic');
const famName = k => (FAM[k] && FAM[k].name) || 'その他';
const color = k => (FAM[k] && FAM[k].color) || '#8a8378';

/* 武田三代のどこに仕えたか */
const GEN = {'武田信虎':'信虎期','武田信玄':'信玄期','武田勝頼':'勝頼期'};
const GEN_COLOR = {'武田信虎':'#7a6a9a','武田信玄':'#2f4f7f','武田勝頼':'#a8622f'};
/* 武田以外で最後に仕えた家＝武田滅亡後の行き先の代理指標 */
function afterFam(p){
  for (let i = p.lords.length - 1; i >= 0; i--){
    const f = p.lords[i].f;
    if (f && f !== 'takeda') return f;
  }
  return null;
}
function mainFam(p){ return afterFam(p) || 'takeda'; }
function lastGen(p){ return p.gens.length ? p.gens[p.gens.length - 1] : null; }
function lifeSpan(p){ return (p.b && p.d) ? [p.b, p.d] : null; }
/* 指定年に生存していたか（生没年が両方ある人のみ判定可能） */
function aliveAt(p, y){ return p.b && p.d && p.b <= y && y <= p.d; }

function tipHtml(p){
  const yr = (p.b || '?') + '–' + (p.d || '?');
  const lords = p.lords.map(l => l.l).join('→') || '（記載なし）';
  return '<b>' + esc(p.n) + '</b>　<span class="sm">' + yr + '</span><br>' +
    '<span class="sm">主君：' + esc(lords) + '</span><br>' +
    '<span class="sm">氏族：' + esc(p.clans.join('→') || '（記載なし）') + '</span>' +
    (p.rank ? '<br><span class="sm">官位：' + esc(p.rank) + '</span>' : '') +
    '<br><span class="sm">クリックでWikipedia</span>';
}
/* 人物要素に共通で付ける属性 */
function pAttr(p){
  return 'class="pnode" data-id="' + p.id + '" data-url="' + esc(p.u) + '"';
}

/* ---- ツールチップ / クリック（イベント委譲） ---- */
const tip = document.getElementById('tip');
document.addEventListener('mouseover', e => {
  const t = e.target.closest('[data-id]');
  if (!t) return;
  const p = P[+t.dataset.id];
  if (!p) return;
  tip.innerHTML = tipHtml(p);
  tip.style.opacity = 1;
});
document.addEventListener('mousemove', e => {
  if (tip.style.opacity != 1) return;
  const w = tip.offsetWidth, h = tip.offsetHeight;
  let x = e.clientX + 14, y = e.clientY + 16;
  if (x + w > innerWidth - 8) x = e.clientX - w - 14;
  if (y + h > innerHeight - 8) y = e.clientY - h - 16;
  tip.style.left = x + 'px'; tip.style.top = y + 'px';
});
document.addEventListener('mouseout', e => {
  if (e.target.closest('[data-id]')) tip.style.opacity = 0;
});
document.addEventListener('click', e => {
  const t = e.target.closest('[data-url]');
  if (!t) return;
  window.open(t.dataset.url, '_blank', 'noopener');
});

/* ---- SVGヘルパ ---- */
function svgOpen(w, h, cls){ return '<svg class="canvas ' + (cls||'') + '" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">'; }
function crestSvg(k, x, y, size, opacity){
  return '<svg x="' + x + '" y="' + y + '" width="' + size + '" height="' + size + '" viewBox="0 0 100 100" ' +
    'style="color:' + color(k) + ';opacity:' + (opacity == null ? 1 : opacity) + '"><use href="' + crestId(k) + '"/></svg>';
}
function legend(keys, extra){
  let h = '<div class="legend">';
  keys.forEach(k => {
    h += '<div class="it"><svg class="cr" style="color:' + color(k) + '"><use href="' + crestId(k) + '"/></svg>' +
         '<span class="sw" style="background:' + color(k) + '"></span>' + esc(famName(k)) +
         (FAM[k] && FAM[k].crest ? '（' + esc(FAM[k].crest) + '）' : '') + '</div>';
  });
  if (extra) h += '<div class="it">' + extra + '</div>';
  return h + '</div>';
}
/* 家別の人数（多い順） */
function famRanking(){
  const c = {};
  P.forEach(p => (p.fams || []).forEach(f => c[f] = (c[f] || 0) + 1));
  return Object.keys(c).sort((a, b) => c[b] - c[a]).map(k => ({ key: k, n: c[k] }));
}
/* 氏族別グループ（人数降順） */
function clanGroups(){
  const g = {};
  P.forEach(p => { const k = p.clan || '（氏族記載なし）'; (g[k] = g[k] || []).push(p); });
  return Object.keys(g).sort((a, b) => g[b].length - g[a].length || a.localeCompare(b, 'ja'))
    .map(k => ({ clan: k, people: g[k].slice().sort((x, y) => (x.b || 9999) - (y.b || 9999)) }));
}
