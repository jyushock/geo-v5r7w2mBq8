// --- 城写真取得（攻城団→城郭放浪記→Wikipedia フォールバック、キャッシュ付き） ---
const castleImgCache = {};

// 画像URLが実在するかを<img>読み込みの成否で判定する（Promise化）。
// 城郭放浪記(hb.pei.jp)はAccess-Control-Allow-Originを返さないため、
// 攻城団のようなfetch()+blob()方式は使えない(CORSエラーで常に失敗する。実測確認済み)。
// <img>の読み込みはCORS不要で、成功時はそのURLがHTTPキャッシュに乗るため
// (ETag/Last-Modifiedのみでmax-ageは無いが、ブラウザの既定動作でキャッシュされる)、
// 後で同じURLをポップアップに挿入する際に再利用される。
function checkImageLoads(url, timeoutMs = 8000) {
    return new Promise((resolve) => {
        const img = new Image();
        let done = false;
        const finish = (ok) => { if (!done) { done = true; resolve(ok); } };
        img.onload = () => finish(true);
        img.onerror = () => finish(false);
        img.src = url;
        setTimeout(() => finish(false), timeoutMs);
    });
}

// 攻城団: URLから城IDを抽出してパノラマ画像URLを構築
// HEADでの事前存在確認は廃止し、画像GET自体を存在確認に使う
// (攻城団へのリクエストを成功時2回→1回に削減。GETした画像は
//  Cache-Control: max-age=7日でHTTPキャッシュされ、表示時に再利用される)。
// 存在判定はfetchのステータスで行う。<img>のonerrorは使えない:
// このサーバは404応答の本文にもJPEG(エラー画像)を返し、Chromeは
// その場合loadイベントを発火するため誤って表示してしまう(実測確認済み)。
// CORSはAccess-Control-Allow-Origin:*を確認済み。
async function castleImgFromKojodan(kojodanUrl) {
    if (!kojodanUrl) return null;
    const m = kojodanUrl.match(/kojodan\.jp\/castle\/(\d+)/);
    if (!m) return null;
    const imgUrl = `https://kojodan.com/pic/panorama/${m[1]}.jpg`;
    try {
        const res = await fetch(imgUrl);
        if (res.ok) {
            await res.blob(); // ダウンロードを完了させHTTPキャッシュに乗せる
            return imgUrl;
        }
    } catch (_) {}
    return null;
}

// 城郭放浪記: 個別ページURL(shiroHbUrl)配下の indexb.jpg が写真ページの規約的な命名
// (実測確認済み。城郭放浪記は個人運営サイトのため、タップ時1回のみのアクセスに留める)
async function castleImgFromShiroHb(shiroHbUrl) {
    if (!shiroHbUrl) return null;
    const imgUrl = `${shiroHbUrl}indexb.jpg`;
    return (await checkImageLoads(imgUrl)) ? imgUrl : null;
}

// Wikipedia: ja.wikipedia.org の pageimages API（CORS許可: origin=*）
// 公式ドキュメント: https://www.mediawiki.org/wiki/Extension:PageImages
// size はサムネイルの最大幅。シート表示は400、拡大表示は CASTLE_ZOOM_THUMB を使う。
async function castleImgFromWikipedia(castleName, size) {
    try {
        const apiUrl = `https://ja.wikipedia.org/w/api.php?action=query&prop=pageimages&piprop=thumbnail&pithumbsize=${size}&titles=${encodeURIComponent(castleName)}&format=json&origin=*`;
        const res = await fetch(apiUrl);
        const data = await res.json();
        const page = Object.values(data.query.pages)[0];
        if (page && page.thumbnail && page.thumbnail.source) return page.thumbnail.source;
    } catch (_) {}
    return null;
}

async function fetchCastleImage(castleName, kojodanUrl, shiroHbUrl) {
    const cacheKey = castleName;
    if (castleImgCache[cacheKey] !== undefined) return castleImgCache[cacheKey];
    // 先に見つかった時点で打ち切る（攻城団・城郭放浪記へのアクセスを増やさないため）
    let url = await castleImgFromKojodan(kojodanUrl);
    if (!url) url = await castleImgFromShiroHb(shiroHbUrl);
    if (!url) url = await castleImgFromWikipedia(castleName, 400);
    castleImgCache[cacheKey] = url;   // どこからも取得できなければ null
    return url;
}

// 拡大表示用に、シート表示では打ち切っていた残りの取得元も調べて配列にする。
// 写真を拡大したときだけ呼ぶので、通常の閲覧でアクセスが増えることはない。
// Wikipediaはシート用の400pxではなく拡大に耐える幅で取り直す
// (pithumbsize=1200 で 1200×800 が返ることを実測確認済み。原寸は4200×2800)。
const CASTLE_ZOOM_THUMB = 1200;
const castleImgAllCache = {};
async function fetchCastleImagesAll(castleName, kojodanUrl, shiroHbUrl) {
    if (castleImgAllCache[castleName]) return castleImgAllCache[castleName];
    const [ko, sh, wp] = await Promise.all([
        castleImgFromKojodan(kojodanUrl),
        castleImgFromShiroHb(shiroHbUrl),
        castleImgFromWikipedia(castleName, CASTLE_ZOOM_THUMB),
    ]);
    const list = [];
    if (ko) list.push({ url: ko, label: '攻城団' });
    if (sh) list.push({ url: sh, label: '城郭放浪記' });
    if (wp) list.push({ url: wp, label: 'Wikipedia' });
    castleImgAllCache[castleName] = list;
    return list;
}

// --- Wikipedia記事の存在確認（キャッシュ付き） ---
// name単独だとWikipediaの正式タイトルと不一致で誤って「記事なし」判定になるケースがあるため
// （例:「上之国館」はmissingだが、aliases由来の「上之国勝山館跡」はリダイレクトで実在記事「勝山館」に解決）、
// name + aliasesを候補としてtitlesに一括指定し、redirects=1でリダイレクトも解決した上で判定する。
//
// 名前だけでは同名の無関係な記事（例: 茨城の館山城 vs 千葉の館山城）にヒットしうるため、
// prop=coordinatesで記事側の座標も取得し、城のcastle.js側座標(lat/lng)と突き合わせる
// (2026-07-24追加。閾値5kmはGetTabelog側の別名同定処理と同じ基準に合わせた)。
// 座標が近い候補があれば最優先で採用する。座標情報がない記事（Infoboxに座標テンプレート
// が無いケース）は判定不能なので、ボタンを消さない方針（誤って開かれるより出ないことを
// 避ける、というユーザー判断）によりフォールバック候補として保持し、座標一致が
// 無ければ採用する。座標はあるが閾値を超えて離れている記事は明確に無関係と判断し除外する。
//
// 【重要】候補(pages)はcandidatesの順序ではなく、APIレスポンスのpages連想配列のキー(pageid)
// 順に返ってくる。JSではObject.values()で整数キーは数値昇順に自動ソートされるため、
// 例えば千葉の佐貫城(aliases:「亀城」「亀ヶ城」)では、aliasesが全く無関係な記事
// （亀城→中国の「亀城市」、亀ヶ城→福島の「猪苗代城」）にリダイレクトされてしまっており、
// かつそれらの記事にも座標情報が無いため、pageid最小の「猪苗代城」が本来の「佐貫城」より
// 先にフォールバック採用され、無関係なページに遷移する実害を確認した(2026-07-24)。
// candidates配列の順序（castleName自身を最優先、aliasesは補完）通りに評価するよう、
// redirectsマッピングでcandidateごとの解決先ページを個別に引いてから順序を組み直す。
const wikiExistsCache = {};
const WIKI_COORD_MATCH_THRESHOLD_KM = 5;

async function resolveWikipediaTitle(castleName, aliases, lat, lng) {
    // 座標を判定に使うため、キャッシュキーにも座標を含める。座標なしで同名の城が
    // 複数箇所にある場合（例:「堀城」）、名前だけをキーにすると片方の判定結果が
    // 無関係な別の場所の同名城にも誤って適用されてしまうため。
    const cacheKey = (typeof lat === 'number' && typeof lng === 'number')
        ? `${castleName}:${lat.toFixed(4)}:${lng.toFixed(4)}` : castleName;
    if (wikiExistsCache[cacheKey] !== undefined) return wikiExistsCache[cacheKey];
    try {
        const candidates = [castleName, ...(Array.isArray(aliases) ? aliases : [])].slice(0, 10);
        // prop=pageprops&ppprop=disambiguation: 別名が曖昧さ回避ページ（例:「朝倉城」は
        // 兵庫・高知の同名城への入口ページで、それ自体は特定の城の記事ではない）に
        // ヒットするケースを除外するため(2026-07-24追加、実データ確認: 保々西城→朝倉城)。
        // 曖昧さ回避ページは記事本文がなく座標情報も持たないため、座標なしフォールバック
        // 採用ロジックに紛れ込むと無関係なページへ誤誘導してしまう。
        const apiUrl = `https://ja.wikipedia.org/w/api.php?action=query&format=json&redirects=1&prop=coordinates|pageprops&ppprop=disambiguation&titles=${encodeURIComponent(candidates.join('|'))}&origin=*`;
        const res = await fetch(apiUrl);
        const data = await res.json();

        // candidate(元の表記) → 実際に解決されたページタイトル、のマッピングを作る
        const redirectMap = {};
        (data.query.redirects || []).forEach(r => { redirectMap[r.from] = r.to; });
        const pagesByTitle = {};
        Object.values(data.query.pages || {}).forEach(pg => {
            const isDisambiguation = pg.pageprops && pg.pageprops.disambiguation !== undefined;
            if (pg.pageid !== undefined && pg.missing === undefined && !isDisambiguation) pagesByTitle[pg.title] = pg;
        });

        // candidatesの順序（castleName最優先）通りに解決済みページを並べ直す（重複除去）
        const orderedPages = [];
        const seenPageIds = new Set();
        for (const cand of candidates) {
            const resolvedTitle = redirectMap[cand] || cand;
            const pg = pagesByTitle[resolvedTitle];
            if (pg && !seenPageIds.has(pg.pageid)) { orderedPages.push(pg); seenPageIds.add(pg.pageid); }
        }

        let result = null;
        const hasCoord = typeof lat === 'number' && typeof lng === 'number';
        if (hasCoord) {
            let fallback = null;
            for (const pg of orderedPages) {
                const pc = pg.coordinates && pg.coordinates[0];
                if (pc) {
                    const d = calcDist(lat, lng, pc.lat, pc.lon);
                    if (d <= WIKI_COORD_MATCH_THRESHOLD_KM) { result = pg.title; break; }
                    // 座標があるが閾値超え: 無関係と判断し不採用（何もしない）
                } else if (fallback === null) {
                    fallback = pg.title; // 座標なし: 判定不能なのでフォールバック候補として保持
                }
            }
            if (result === null) {
                // 座標の合う記事が無いときだけ、「城名 (」で始まる記事も探す。
                // 例: 北九州の若松城は「若松城」が会津の記事、別名「中島城」が座標の無い
                // 「中島城 (尾張国)」への転送で、正しい「若松城 (筑前国)」は城名にも別名にも
                // 一致しないため候補に入らず、尾張の記事に飛んでいた(2026-11-12)。
                // 括弧付きの記事は座標が閾値内のときだけ採用し、座標の無いものは使わない
                // （同名の他地方の城へ誤誘導する危険を増やさないため）。
                // この問い合わせが失敗したときは1回目の結果を返し、キャッシュしない
                // （次にシートを開いたときに2回目からやり直させるため）。
                let suffixed;
                try {
                    suffixed = await findSuffixedWikipediaTitle(castleName, lat, lng);
                } catch (_) {
                    return fallback;
                }
                result = suffixed || fallback;
            }
        } else {
            // 呼び出し側で座標が渡せない場合は従来通り名前一致のみで判定
            result = orderedPages.length > 0 ? orderedPages[0].title : null;
        }

        wikiExistsCache[cacheKey] = result;
        return result;
    } catch (_) {
        // 判定不能時はボタンを消さない（安全側）。キャッシュもしない（次回再試行させる）
        return castleName;
    }
}

// 「城名 (」で始まる記事（例:「若松城 (筑前国)」）のうち、座標が閾値内の最も近いものの
// タイトルを返す。見つからなければnull。通信やAPIの失敗は例外のまま呼び出し側へ返す。
// 転送ページ(gapfilterredir=nonredirects)と曖昧さ回避ページは除く。
async function findSuffixedWikipediaTitle(castleName, lat, lng) {
    const apiUrl = `https://ja.wikipedia.org/w/api.php?action=query&format=json&generator=allpages&gapnamespace=0&gapfilterredir=nonredirects&gaplimit=50&gapprefix=${encodeURIComponent(castleName + ' (')}&prop=coordinates|pageprops&ppprop=disambiguation&origin=*`;
    const res = await fetch(apiUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error.info || 'Wikipedia API error');
    let best = null, bestDist = Infinity;
    Object.values((data.query && data.query.pages) || {}).forEach(pg => {
        if (pg.pageprops && pg.pageprops.disambiguation !== undefined) return;
        const pc = pg.coordinates && pg.coordinates[0];
        if (!pc) return;
        const d = calcDist(lat, lng, pc.lat, pc.lon);
        if (d <= WIKI_COORD_MATCH_THRESHOLD_KM && d < bestDist) { best = pg.title; bestDist = d; }
    });
    return best;
}

// 城シートの情報源セット行（Wikipedia・攻城団・城郭放浪記）を非同期で確定させる。
// 攻城団・城郭放浪記はHTML生成時点でp.url/p.shiroHbUrlの有無から確定済み（暫定レイアウト済み）だが、
// Wikipediaは記事存在確認が非同期のため、確定後にセット行全体をbuildSourceButtons()で再構築する。
async function injectWikiButtonState(castleName, aliases, kojodanUrl, shirohbUrl, lat, lng) {
    const slot = document.querySelector('#obj-sheet-body .os-source-row');
    if (!slot) return;
    const resolvedTitle = await resolveWikipediaTitle(castleName, osParseAliases(aliases), lat, lng);
    const wikiHref = resolvedTitle ? `https://ja.wikipedia.org/wiki/${encodeURIComponent(resolvedTitle)}` : '';
    // 取得完了までに別のオブジェクトへ切り替わっていたら書き換えない
    const cur = document.querySelector('#obj-sheet-body .os-source-row');
    if (cur !== slot) return;
    slot.innerHTML = buildSourceButtons(wikiHref, kojodanUrl, shirohbUrl);
    // ボタン数の増減で高さが変わるため選択ピンの見え方を補正し直す
    adjustMapForSheet();
}

// --- 城の形態（城郭放浪記データ由来）表示 ---
// 形態名(21種類、実データで確認済み)をCSSクラスに対応させる。
// 「不明」という値がそのまま入っているケースがあるため、その場合はバッジ自体を出さない。
const FORM_BADGE_CLASS = {
    '山城': 'f-yamajiro', '丘城': 'f-okajiro', '平城': 'f-hirajiro', '居館': 'f-kyokan',
    '平山城': 'f-hirayama', '陣屋': 'f-jinya', '陣所': 'f-jinsho', '代官所': 'f-daikansho',
    '台場': 'f-daiba', '番所': 'f-bansho', '崖端城': 'f-gakebata', '水軍城': 'f-suigun',
    '環濠': 'f-kango', '台城': 'f-daijiro', '海城': 'f-umijiro', '寺社': 'f-jisha',
    '防塁': 'f-boruei', '関所': 'f-sekisho', '水城': 'f-mizujiro', '烽火台': 'f-houkadai',
    '官衙': 'f-kanga',
};

// 形態バッジ（城名の左に配置。タイトル行用に少し大きいフォントサイズを使う）
function popupFormBadgeHtml(form) {
    if (!form || form === '不明') return '';
    const cls = FORM_BADGE_CLASS[form] || '';
    return `<span class="popup-form-badge popup-form-badge-title ${cls}">${form}</span>`;
}

// 100名城・続100名城のバッジ。色は地図のピン・検索結果のアイコンと同じものを使う
// （getItemColor が genre から決めるので、色の定義がここで二重にならない）
const CASTLE_GENRE_LABEL = { '日本100名城': '100名城', '続日本100名城': '続100名城' };
function castleGenreBadgeHtml(p) {
    const label = CASTLE_GENRE_LABEL[p.genre];
    if (!label) return '';
    return `<span class="os-genrebadge" style="background:${getItemColor({ type: 'castle', properties: p })}">${label}</span>`;
}

