/* ══ 食べログの店名・駅・ジャンル・部門 ═══════════════════════════════
   data.js の name は「店名 - 駅（ジャンル）」の3点セット（食べログ店舗ページの h1 由来）。
   実データ7,077件すべてがこの形であることを全件検査で確認済み（2026-08-01、例外0件）。
   data.js は変えず、表示のたびにここで分解する（地図のラベルだけは JS を通せないので、
   同じ切り出しを SHOP_LABEL_FIELD の式でやる）。合致しない名前が来たら店名だけとして扱う。

   部門（category）は「ラーメン（東京）」のように地域が付く。括弧内は北海道・東京・
   神奈川・愛知・大阪・香川・東日本・西日本の8種しか現れない（全71種で確認）ので、
   括弧を落とせば35種の部門になる。バッジとジャンル絞り込みはこの35種を使う。 */
const SHOP_NAME_RE = /^(.+?)\s+-\s+(.+?)（([^（）]+)）\s*$/;
function shopParts(p) {
    const m = SHOP_NAME_RE.exec(((p && p.name) || '').trim());
    return m ? { shop: m[1], station: m[2], genre: m[3] }
             : { shop: (p && p.name) || '', station: '', genre: '' };
}
/* 名前を出す場所は、どこでも店名だけにする（情報シートのタイトルと同じ）。
   name をそのまま出すと平均26.6字・67%が20字超で、1行の置き場所では末尾が切れて
   店名まで読めなくなるため。駅とジャンルは情報シートの項目で読める。 */
function shopDisplayName(p) { return shopParts(p).shop || (p && p.name) || ''; }
/* 検索・周辺検索・都道府県一覧が持つ item 用。label（name 全体）は書き換えず、
   出すときだけ店名にする。照合に使う _normLabel は label から作られているので、
   駅名やジャンルで引ける検索の当たり方はそのまま残る。 */
function itemDisplayName(item) {
    return item.type === 'shop' ? shopDisplayName(item.properties) : item.label;
}
/* 地図のラベル用。JSの正規表現は使えないので、最初の " - " までを切り出す式にする。
   店名の側に " - " を含む店は0件（全7,077件で確認済み）。分解できない名前が来たら
   name をそのまま出す（shopParts が店名だけとして扱うのと同じ振る舞い）。 */
const SHOP_LABEL_FIELD = ['let', 'i', ['index-of', ' - ', ['get', 'name']],
    ['case', ['>', ['var', 'i'], 0], ['slice', ['get', 'name'], 0, ['var', 'i']], ['get', 'name']]];
function shopGenreBase(category) {
    return String(category || '').replace(/（[^（）]*）\s*$/, '').trim();
}
/* 部門バッジの色。35部門を内容で10グループに束ね、グループごとに1色にする
   （種別色のオレンジ1色だと白文字が読みにくく、部門も見分けられなかったため）。
   彩度・明度は城の形態バッジ（f-*）と同じ帯に揃えてある。 */
const SHOP_GENRE_CLASS = {
    'ラーメン': 'g-men', 'うどん': 'g-men', 'そば': 'g-men',
    '焼肉': 'g-niku', '焼き鳥': 'g-niku', '鳥料理': 'g-niku',
    'ステーキ・鉄板焼き': 'g-niku', 'とんかつ': 'g-niku', 'すき焼き・しゃぶしゃぶ': 'g-niku',
    '寿司': 'g-gyokai', 'うなぎ': 'g-gyokai', '天ぷら': 'g-gyokai', '日本料理': 'g-gyokai',
    '中国料理': 'g-chuka', '餃子': 'g-chuka', 'アジア・エスニック': 'g-chuka', 'カレー': 'g-chuka',
    'フレンチ': 'g-yoshoku', 'イタリアン': 'g-yoshoku', 'スペイン料理': 'g-yoshoku',
    '洋食': 'g-yoshoku', 'ピザ': 'g-yoshoku', 'ハンバーガー': 'g-yoshoku',
    'お好み焼き': 'g-keishoku', '食堂': 'g-keishoku',
    'スイーツ': 'g-kanmi', '和菓子・甘味処': 'g-kanmi', 'パン': 'g-kanmi', 'アイス・ジェラート': 'g-kanmi',
    'バー': 'g-sake', '居酒屋': 'g-sake', '立ち飲み': 'g-sake',
    'カフェ': 'g-kissa', '喫茶': 'g-kissa',
    '創作料理・イノベーティブ': 'g-sonota',
};
/* ジャンル選択の並び順。バッジの色分けと同じ10グループで束ねて出す
   （色でまとまって見えるものが、並びでも隣り合うようにするため）。
   SHOP_GENRE_CLASS の全35部門がこの中に漏れなく入る。 */
const SHOP_GENRE_GROUPS = [
    ['麺', ['ラーメン', 'うどん', 'そば']],
    ['肉', ['焼肉', '焼き鳥', '鳥料理', 'ステーキ・鉄板焼き', 'とんかつ', 'すき焼き・しゃぶしゃぶ']],
    ['魚介・和食', ['寿司', 'うなぎ', '天ぷら', '日本料理']],
    ['中華・アジア', ['中国料理', '餃子', 'アジア・エスニック', 'カレー']],
    ['洋食', ['フレンチ', 'イタリアン', 'スペイン料理', '洋食', 'ピザ', 'ハンバーガー']],
    ['軽食・粉もの', ['お好み焼き', '食堂']],
    ['甘味・パン', ['スイーツ', '和菓子・甘味処', 'パン', 'アイス・ジェラート']],
    ['酒', ['バー', '居酒屋', '立ち飲み']],
    ['喫茶', ['カフェ', '喫茶']],
    ['その他', ['創作料理・イノベーティブ']],
];
/* 部門バッジ。sizeClass に置き場所ごとの寸法クラスを渡す
   （情報シート=os-genrebadge / 一覧=pref-badge / 検索結果=sr-genre）。色はグループのクラスが持つ。 */
function shopGenreBadgeHtml(p, sizeClass) {
    const g = shopGenreBase(p && p.category);
    if (!g) return '';
    return `<span class="${sizeClass} shop-genre ${SHOP_GENRE_CLASS[g] || 'g-sonota'}">${attrEscape(g)}</span>`;
}
/* ══ 食べログの受賞歴 ═══════════════════════════════════════════
   awards は data.js が持つ受賞歴（年の降順）。1件が { y:年, t:部門タグ, g:部門名 }。
   百名店は部門ごとに発表年が違い、選から外れる年もあるので年は飛ぶ。
   部門が変わる店（例: カレー TOKYO → アジア・エスニック TOKYO）もあるため、
   現在の部門（category）と違う年だけ部門名を添えて見分けられるようにする。
   別名と同じく、MapLibre の feature.properties 経由ではJSON文字列で届く。 */
function osParseAwards(awards) {
    if (typeof awards === 'string') {
        try { awards = JSON.parse(awards); } catch { awards = null; }
    }
    return Array.isArray(awards) ? awards : [];
}
function shopAwardsHtml(p) {
    const list = osParseAwards(p && p.awards);
    if (!list.length) return '';
    const now = shopGenreBase(p && p.category);
    const chips = list.map((a, i) => {
        const g = shopGenreBase(a && a.g);
        const other = g && g !== now;
        const cls = other ? 'aw-y aw-other' : (i === 0 ? 'aw-y aw-now' : 'aw-y');
        return `<span class="${cls}">${attrEscape(a.y)}${other ? ' ' + attrEscape(g) : ''}</span>`;
    }).join('');
    return `<span class="aw-chips">${chips}</span>`;
}
/* 評点。タイトル行の右端に置く（項目行にすると1行増えるため）。
   口コミ数は3桁区切りにする。評点が無い店（取得できなかった店）は出さない。 */
function shopRatingHtml(p) {
    if (!p || !p.rating) return '';
    const n = Number(p.ratingCount);
    const cnt = Number.isFinite(n) && n > 0 ? `<span class="rt-n">(${n.toLocaleString('ja-JP')})</span>` : '';
    return `<span class="os-rating"><span class="rt-star">★</span>`
         + `<span class="rt-v">${attrEscape(p.rating)}</span>${cnt}</span>`;
}

// 予算。食べログは「店側申告」と「口コミ集計」を昼夜それぞれ持っており、
// data.js にも4通りそのまま入っている（budgetDinner / budgetLunch / …Rvw）。
//
// 口コミ集計を優先する。店側申告は据え置かれがちで、実際に払った額を集計した
// 口コミ側のほうが実勢に近いため。
//
// 【昼夜それぞれで独立に選ぶ】
// 「口コミ集計をひとまとまりで優先し、無ければ店側申告」にすると、
// 口コミ集計に夜しか無く店側申告には昼夜ある店で、昼が消える
// （実測: 焼肉ホルモン 新井屋 渋谷。口コミは夜のみ、申告は夜￥6,000～￥7,999・
//   昼￥2,000～￥2,999）。昼夜は別の情報なので、枠ごとに口コミ→申告の順で選ぶ。
// 有る枠だけを昼→夜の順に並べる（片方しか無い店が多い）。
// 枠ごとに出どころが混ざりうるため、出どころの注記は付けない。
//
// 【priceRange への逃げ道】
// 2026-08-12 より前の data.js は、ld+json の priceRange（夜の値しか持たない）を
// 単一の予算として持っていた。取得に失敗して据え置きになった店には今も残るので、
// 4通りが1つも無いときだけこれを出す。
function shopBudgetHtml(p) {
    if (!p) return '';
    const seg = (cls, label, v) => v
        ? `<span class="os-bseg"><span class="os-bt ${cls}">${label}</span>${attrEscape(v)}</span>`
        : '';

    const shown = seg('os-bt-l', '昼', p.budgetLunchRvw  || p.budgetLunch)
                + seg('os-bt-d', '夜', p.budgetDinnerRvw || p.budgetDinner);

    return shown || (p.priceRange ? attrEscape(p.priceRange) : '');
}

// 標高／比高（バッジとは別行、住所の上に表示）。
// 他の行と同じラベルチップを使い、1行に2項目を並べる（比高が無い城は標高だけになる）。
function popupFormMetaHtml(elevationM, relativeHeightM) {
    const elev = (elevationM !== undefined && elevationM !== null) ? osKvHtml('標高', `${elevationM}m`) : null;
    const rel = (relativeHeightM !== undefined && relativeHeightM !== null) ? osKvHtml('比高', `${relativeHeightM}m`) : null;
    return [elev, rel].filter(Boolean).join(' ');
}

// 遺構・城主は、原典（城郭放浪記）が「なし」「不明」と明記しているケースが多い
// （遺構が付く18,000件のうち2,743件、城主11,776件のうち2,441件）。castle.js には
// その記載どおり保持しているが、読み手にとって情報量が無いのでシートには行ごと出さない。
// 「破壊」「消滅」はWikipediaが遺構の現存しない城に使う表記（castle.js側でも同じ扱い）
const CASTLE_UNKNOWN_ATTRS = new Set(['なし', '無し', '無', '不明', '不詳', '－', '-', '―', 'ー',
                                      '破壊', '消滅']);
// ラベルは他のメタ行と同じチップで書く
function castleAttrLine(label, value) {
    if (!value) return '';
    const v = String(value).trim();
    if (!v || CASTLE_UNKNOWN_ATTRS.has(v)) return '';
    return osKv(label, v);
}

/* ══ 遺構の語 → 遺構の見かた（図解）の行き先 ══════════════════════════════
   情報シートの遺構の語を押すと、その語の図解を1枚重ねる（openRemainsHelpPop）。
   語は原典の表記のままで種類が多い（castle.js 全件で757種）ので、語の一部で行き先を決める。
   先に書いた規則が勝つ（「堀切」を「堀」より、「天守台」を「天守」より先に置く）。
   行き先は図解のカード名か「§分野名」（曲輪・堀のような総称。分野の説明と種類の一覧を出す）。
   null は行き先なし（図解に無い語。先に外しておかないと後ろの総称に拾われる）。
   行き先はすべて remains-help.js の SECTIONS にあるカード名・分野名と一致させること。 */
const REMAINS_HELP_RULES = [
    ['竪土塁', null], ['水門', null],
    // 堀
    ['畝状竪堀', '畝状竪堀群'], ['連続竪堀', '畝状竪堀群'], ['放射状竪堀', '放射状竪堀'],
    ['堀切', '堀切'], ['竪堀', '竪堀'], ['横堀', '横堀'], ['空堀', '空堀'], ['水堀', '水堀'],
    ['障子堀', '障子堀'], ['畝堀', '畝堀'], ['三日月堀', '三日月堀'],
    ['内堀', '内堀・中堀・外堀'], ['外堀', '内堀・中堀・外堀'], ['内濠', '内堀・中堀・外堀'], ['外濠', '内堀・中堀・外堀'],
    ['総構', '総構・総堀'],
    // 井戸・水利（「本丸井戸」を本丸へ送らないよう曲輪より先）
    ['水の手', '水の手曲輪'], ['水ノ手', '水の手曲輪'], ['井戸', '井戸'],
    // 曲輪
    ['帯曲輪', '帯曲輪'], ['腰曲輪', '腰曲輪'], ['削平', '削平地'], ['平場', '削平地'], ['出丸', '出丸'], ['出曲輪', '出丸'],
    ['本丸', '本丸'], ['本曲輪', '本丸'], ['主曲輪', '本丸'],
    ['二の丸', '二の丸・三の丸'], ['二ノ丸', '二の丸・三の丸'], ['二之丸', '二の丸・三の丸'], ['二の曲輪', '二の丸・三の丸'],
    ['二ノ曲輪', '二の丸・三の丸'], ['三の丸', '二の丸・三の丸'], ['三の曲輪', '二の丸・三の丸'],
    ['北の丸', '東西南北の丸'], ['東曲輪', '東西南北の丸'], ['西の曲輪', '東西南北の丸'], ['南曲輪', '東西南北の丸'],
    // 虎口の種類
    ['丸馬出', '丸馬出'], ['角馬出', '角馬出'], ['外枡形', '外枡形'], ['内枡形', '内枡形'],
    // 門（「移築門（大手門）」は移築門へ。「大手門」「搦手門」は総称の「虎口」より先）
    ['移築門', '移築門'], ['門（移築', '移築門'],
    ['枡形門', '枡形門'], ['冠木門', '冠木門'], ['薬医門', '薬医門'], ['高麗門', '高麗門'], ['棟門', '棟門'], ['櫓門', '櫓門'],
    ['長屋門', '長屋門'], ['埋門', '埋門'], ['大手門', '大手門'], ['搦手門', '搦手門'],
    ['馬出', '§虎口'], ['枡形', '§虎口'], ['桝形', '§虎口'], ['虎口', '§虎口'],
    // 天守・櫓
    ['天守台', '天守台'], ['天主台', '天守台'], ['現存天守', '天守の種類'], ['木造復元天守', '天守の種類'],
    ['外観復元天守', '天守の種類'], ['復興天守', '天守の種類'], ['模擬天守', '天守の種類'], ['小天守', '連結式'],
    ['櫓台', '櫓台'], ['多聞櫓', '多聞櫓'], ['渡櫓', '渡櫓'], ['続櫓', '渡櫓'], ['隅櫓', '隅櫓'], ['巽櫓', '隅櫓'],
    ['辰巳櫓', '隅櫓'], ['乾櫓', '隅櫓'], ['物見櫓', '物見櫓'], ['太鼓櫓', '太鼓櫓'], ['月見櫓', '月見櫓'],
    ['櫓', '§櫓'], ['天守', '§天守'],
    // 石垣
    ['登石垣', '登り石垣'], ['登り石垣', '登り石垣'], ['腰巻土塁', '土塁の各部'], ['腰巻', '腰巻石垣'], ['鉢巻', '鉢巻石垣'],
    ['石垣', '§石垣'], ['石積', '§石垣'], ['石塁', '§石垣'],
    // 土塁・塀・建物・狼煙
    ['武者走', '武者走・犬走'], ['犬走', '武者走・犬走'], ['切岸', '切岸'], ['土橋', '土橋'], ['土塁', '土塁'],
    ['土塀', '土塀と狭間'], ['築地', '築地塀'], ['御殿', '御殿'],
    ['礎石', '礎石建物・掘立柱建物'], ['掘立柱', '礎石建物・掘立柱建物'], ['柱穴', '礎石建物・掘立柱建物'],
    ['狼煙', '狼煙台'], ['烽火', '狼煙台'], ['狼火', '狼煙台'], ['のろし', '狼煙台'], ['ノロシ', '狼煙台'],
    // 総称
    ['曲輪', '§曲輪'], ['堀', '§堀'], ['濠', '§堀'], ['門', '§門'],
];
function remainsHelpDest(tok) {
    // 「なし」「埋没」などの状態語と、原典の括弧の中で割れた語の断片には付けない
    // （遺構から探すの分類 remainGroupOf と同じ判定）
    if (REMAIN_GROUP_DEFS[0][3].test(tok)) return null;
    if ((tok.match(/[（(]/g) || []).length !== (tok.match(/[）)]/g) || []).length) return null;
    for (const [key, dest] of REMAINS_HELP_RULES) if (tok.includes(key)) return dest;
    return null;
}
// 情報シートの遺構の行。行き先のある語だけを押せる語にし、区切りの読点はそのまま残す
function castleRemainsLine(value) {
    if (!value) return '';
    const v = String(value).trim();
    if (!v || CASTLE_UNKNOWN_ATTRS.has(v)) return '';
    const html = v.split(/([、,])/).map(part => {
        if (part === '、' || part === ',') return part;
        const tok = part.trim();
        const dest = tok ? remainsHelpDest(tok) : null;
        return dest ? `<span class="rh-w" data-rh="${attrEscape(dest)}">${attrEscape(part)}</span>` : attrEscape(part);
    }).join('');
    return osKv('遺構', html);
}

// 情報源ボタン（Wikipedia・攻城団・城郭放浪記）。セット行に並べ、
// 非表示のものがあれば残ったボタンが flex:1 で自動的に幅を広げる（空欄は作らない）。
function buildSourceButtons(wikiHref, kojodanUrl, shirohbUrl) {
    const items = [];
    if (wikiHref)    items.push(`<a href="${wikiHref}" target="_blank" class="btn btn-wiki">Wikipedia</a>`);
    if (kojodanUrl)  items.push(`<a href="${kojodanUrl}" target="_blank" class="btn btn-kojodan">攻城団</a>`);
    if (shirohbUrl)  items.push(`<a href="${shirohbUrl}" target="_blank" class="btn btn-shirohb">城郭放浪記</a>`);
    return items.join('');
}

// iOSのホーム画面起動(navigator.standalone)かどうか。書き出しの案内文の出し分けに使う。
// 以前はここで攻城団リンクだけをChrome(googlechromes://)に差し替えていた。iOS PWAが送る
// SafariのUA(Version/26.5.2)が攻城団で503になり、ChromeのCriOS UAなら通ったため。
// 2026-09-22に同じUAで再測定したところ200が返り、遮断は解けていた(Cloudflare側の一時的な
// ルールだったとみられる)。iOSのChromeは拡張が使えず広告を止める手段が無いのに対し、
// Safariはコンテンツブロッカーが効くため、差し替えをやめて他の情報源ボタンと同じ
// target=_blank(端末の既定ブラウザ)に戻した。
function isIosStandalonePwa() {
    return window.navigator.standalone === true;
}

function showToast(message) {
    let toast = document.getElementById('app-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'app-toast';
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => toast.classList.remove('show'), 4000);
}

/* 文字列をクリップボードへ入れる。
   navigator.clipboard は生えていても書き込みが拒まれること（安全なコンテキストでない、
   ユーザー操作の文脈から外れている）があるので、失敗したら旧APIの execCommand へ落とす。
   どちらの経路もユーザー操作（タップ・クリック）の中から呼ばれることが前提。 */
async function copyToClipboard(text) {
    if (!text) return false;
    if (navigator.clipboard) {
        try { await navigator.clipboard.writeText(text); return true; } catch {}
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;';
    document.body.appendChild(ta);
    ta.focus();
    ta.setSelectionRange(0, ta.value.length);   // iOSは select() だけでは選択範囲が入らないことがある
    let ok = false;
    try { ok = document.execCommand('copy'); } catch {}
    ta.remove();
    return ok;
}

// 城のGoogleMap検索クエリ：同名城の誤ヒット防止に市区町村までの住所を付与
// 丁目以下まで含めるとPOIカード直行になりにくいため市区町村で切る（実測確認済み）
// 切り出せない書式は住所全体、住所なしは城名のみにフォールバック
function castleGmapQuery(name, address) {
    if (!address) return name;
    const m = address.match(/^(北海道|東京都|京都府|大阪府|[一-龠々]{2,3}県)(.+?[市区町村郡])/);
    return `${name},${m ? m[1] + m[2] : address}`;
}

