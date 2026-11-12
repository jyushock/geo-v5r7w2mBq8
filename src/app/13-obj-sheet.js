// ══════════════════════════════════════════════════════════════
//  オブジェクト情報シート（下から出る）
//  全タイプ共通の3行構成:
//    行A  GoogleMap ＋ 種別固有の単発リンク（アクセス／公式ページ／食べログ）
//    行B  セット行（城=Wikipedia/攻城団/城郭放浪記、道の駅=michieki.jp/施設HP/関連HP、
//                  マンホール系=在庫状況/GKP公式一覧）。非表示があれば残りが自動で広がり、
//                  0個なら行ごと出さない。
//    行C  固定セット（ここへ行く(Google)／ここへ行く(Yahoo)／この周辺を検索）
//  各行は flex で等分するため、個数が変わっても空きセルが出ない。
//
//  写真の横のテキスト（.os-meta）は、全種別で osKv() のラベルチップに統一している。
//  使うラベルは次のとおり:
//    城          別名／標高／比高／遺構／城主／住所
//    マンホール蓋 設置／配布場所／住所／時間／発行（配布終了なら 配布／問合せ／発行、
//                 後継カードしか無いときは 配布／後継）
//    カード      住所／時間／発行（配布終了なら 配布／問合せ／発行）
//    ポケふた・食べログ  住所
//    道の駅      路線／住所／時間（路線は michi.js の全1,234件が空なので実際は出ない）
//  蓋だけ「設置」を使うのは、蓋自身の住所とカード配布場所の住所を続けて出すため。
//  同じ「住所」チップが2つ並ぶと、どちらが蓋の位置か読み取れなくなる。
// ══════════════════════════════════════════════════════════════

// テキスト1行（2行を超える分は省略。タップで全文表示）
// cls: 行ごとの追加クラス（受賞歴の行だけ中央揃えにするなど）
function osLine(html, cls) {
    return html ? `<div class="os-line os-clamp${cls ? ' ' + cls : ''}">${html}</div>` : '';
}
// ラベルチップ＋値。値が空なら行ごと出さない。
// 全種別のメタ行をこの形に統一しているので、新しい項目もこれで足すこと。
function osKvHtml(label, value) {
    return `<span class="os-k">${label}</span>${value}`;
}
function osKv(label, value, cls) {
    return value ? osLine(osKvHtml(label, value), cls) : '';
}
// 写真枠。urlが空なら枠ごと出さない。variant で枠の形を切り替える:
//   ''(既定) 128×128にcover      … ポケふた(750×750)のような正方形向け
//   'full'   幅128・高さは比率なり … マンホールカード(縦長)を切らずに全体表示
//   'wide'   171×128にcover       … 城(横長ソース)の左右の欠けを減らす
function osPhotoHtml(url, variant) {
    return url ? `<div class="os-photo${variant ? ' os-photo-' + variant : ''}">`
               + `<img src="${url}" onerror="this.parentElement.style.display='none'"></div>` : '';
}
function osRow(btns) {
    const items = btns.filter(Boolean);
    return items.length ? `<div class="os-brow">${items.join('')}</div>` : '';
}
function osBtn(href, cls, text) {
    return href ? `<a href="${href}" target="_blank" class="btn ${cls}">${text}</a>` : '';
}
// 別名はMapLibreのfeature.properties経由だとJSON文字列化されて届くため、その場合はパースする
// （検索結果側は生JSONをそのまま渡すので配列で届く）
function osParseAliases(aliases) {
    if (typeof aliases === 'string') {
        try { aliases = JSON.parse(aliases); } catch { aliases = null; }
    }
    return Array.isArray(aliases) ? aliases : [];
}

// 「ここへ行く」の移動手段。設定画面で選んだ既定値を両サービスに適用する。
//   Google … 旧形式URLの dirflg。4種すべて意図どおりに開くことを実測で確認
//             (w=徒歩25分/1.8km、d=車10分/1.9km、r=バス18分/210円、b=自転車9分/1.8km)
//   Yahoo  … 公式URL仕様どおり train / car / walk の3種のみ。/route/bicycle は経路画面に
//             ならず地図が出るだけなので、自転車を選んだときは徒歩で代替する
const TRAVEL_MODES = {
    walk:    { label: '徒歩',         gmap: 'w', yahoo: 'walk'  },
    car:     { label: '自動車',       gmap: 'd', yahoo: 'car'   },
    transit: { label: '公共交通機関', gmap: 'r', yahoo: 'train' },
    bicycle: { label: '自転車',       gmap: 'b', yahoo: 'walk'  },
};
const TRAVEL_MODE_DEFAULT = 'transit';
function travelMode() {
    const v = storeGet('travelMode');
    return TRAVEL_MODES[v] ? v : TRAVEL_MODE_DEFAULT;
}

// Yahoo!地図の経路URL。移動手段は設定画面の既定値に従う。
// from/to には表示用の名前を、fromLat/fromLon・toLat/toLon には実際の座標を渡す。
// 実測で確かめた前提:
//   ・from を省くとYahooはスタート地点が空のまま開く（現在地は自動で入らない）
//   ・緯度経度を併せて渡すと from/to の文字列は表示ラベルにしかならない。存在しない名前
//     （「ほげほげ架空城跡」）でも座標どおりの経路が出たので、名前の解決失敗で行き先が
//     ずれる心配はない
//   ・ただし文字列「現在地」だけは特別扱いで、fromLat/fromLon を無視してYahoo側の位置情報を
//     使う。位置情報が未許可だとエラーになるため、出発地のラベルは「現在位置」にする
//   ・名前を渡さず座標文字列にした場合も同じ経路になる（表示が座標のままになるだけ）
//   ・出発地のラベルは、検索ピンから出るときは「検索地点」にする（fromName）
function yahooRouteUrl(fromLat, fromLng, toLat, toLng, toName, fromName = '現在位置') {
    const dest = toName || `${toLat},${toLng}`;
    const q = [`to=${encodeURIComponent(dest)}`, `toLat=${toLat}`, `toLon=${toLng}`];
    if (fromLat != null) {
        q.unshift(`from=${encodeURIComponent(fromName)}`, `fromLat=${fromLat}`, `fromLon=${fromLng}`);
    }
    return `https://map.yahoo.co.jp/route/${TRAVEL_MODES[travelMode()].yahoo}?${q.join('&')}`;
}

// Googleマップの経路URL。出発地(saddr)を省くとGoogle側が現在地から引く。
// 検索ピンがあるときはピンを出発地にする（routeOrigin）。
function googleRouteUrl(toLat, toLng) {
    const from = routeOrigin();
    const q = [`daddr=${toLat},${toLng}`, `dirflg=${TRAVEL_MODES[travelMode()].gmap}`];
    if (from) q.unshift(`saddr=${from.lat},${from.lng}`);
    return `https://www.google.com/maps?${q.join('&')}`;
}

// 「ここへ行く」の出発地。検索ピンが立っていればピン、無ければ null（＝現在地）。
// 周辺検索の起点（getSearchCenter）と同じく searchPinLngLat を見るので、
// 長押しのピンも、オブジェクトの「この周辺を検索」で置いた見えないピンも出発地になる。
// ピンが無いときに地図中心へ倒さないのは周辺検索と違うところで、経路の出発地は現在地のまま。
function routeOrigin() {
    return searchPinLngLat;
}

// 検索ボックスの虫眼鏡(#search-icon)と同じ絵柄。stroke=currentColor なので、
// 置き場所の文字色をそのまま拾う（.btn は color:white のため白抜きになる）
const ICON_SEARCH_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9.5" cy="9.5" r="7.5"/><line x1="14.8" y1="14.8" x2="22" y2="22"/></svg>';

// 経路の2ボタンの左端に置く公式ロゴ。公式配布物を48pxに縮めただけで、色も形も変えていない。
// 表示は16pxなので、3xの端末でも足りる寸法。取得元:
//   Google Maps … https://www.google.com/images/branding/product/2x/maps_96dp.png
//   Yahoo!      … https://s.yimg.jp/c/icon/s/bsc/2.0/favicon.ico
//                 （map.yahoo.co.jp が <link rel="icon"> で参照している共通アイコン）
// 外部URLのまま参照しないのは、経路ボタンは全種別のシートに必ず出るため、
// 他社ドメインの応答に表示が引きずられないようにするため。
const NAV_LOGO_GMAPS = 'data:image/png;base64,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';
const NAV_LOGO_YAHOO = 'data:image/png;base64,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';

/* data-*属性や本文に地名を入れるためのエスケープ（施設名に " や & や ' が入り得る）。
   ' も変えるので、'…' で囲んだ属性にも入れられる。ただし属性の中に書いた JS の文字列へ入れるのは不可：
   属性の値はブラウザが元の文字へ戻してから JS に渡すので、&#39; は ' に戻って文字列を切る。
   押したときに渡す値は data-* に入れる（actionAttrs と index.html の振り分け役）。 */
function attrEscape(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
        .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildSheetHtml(type, label, p, lng, lat) {
    const navUrl      = googleRouteUrl(lat, lng);
    const coordGmapUrl = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
    // Yahooの経路画面に出す行き先の名前（[配布]などの装飾が付く title ではなく素の名前を使う）
    const destName = p.name || p.pokemon || p.locationName || label || '';
    // 周辺検索の「検索地点」に出す名前。ここは人が読む見出しなので、食べログは
    // 経路の行き先名（destName）と違って店名だけにする
    const originName = type === 'shop' ? (shopDisplayName(p) || label) : label;
    // 行C: 全タイプ共通・常に3個
    // 経路の2つはどちらも <a target="_blank">。出発地(現在地・検索ピン)は押された時点で読んで
    // href を差し替える（委譲側に理由）
    const rowC = osRow([
        `<a href="${navUrl}" target="_blank" class="btn btn-nav" data-lat="${lat}" data-lng="${lng}"><span class="nav-ico"><img src="${NAV_LOGO_GMAPS}" alt="Google Maps"></span><span class="nav-cap">ここへ行く</span></a>`,
        `<a href="${yahooRouteUrl(null, null, lat, lng, destName)}" target="_blank" class="btn btn-nav-yahoo" data-lat="${lat}" data-lng="${lng}" data-name="${attrEscape(destName)}"><span class="nav-ico"><img src="${NAV_LOGO_YAHOO}" alt="Yahoo!"></span><span class="nav-cap">ここへ行く</span></a>`,
        /* 店名は data-name で渡す（index.html の ACTIONS.searchNearby が読む）。以前 onclick='…' の中に
           JSON.stringify で直接入れていたときは、店名の ' （data.js に 110件。Fisherman's など）で属性が切れ、
           押しても何も起きなかった */
        `<button class="btn btn-nearby-search" data-lng="${lng}" data-lat="${lat}" data-name="${attrEscape(originName)}" data-on-click="searchNearby">${ICON_SEARCH_SVG}この周辺を検索</button>`,
    ]);
    const isPokefuta = type === 'pokefuta' || (type === 'manhole' && p.source === 'pokefuta');
    // pick は配布場所が複数のカードで行Bの下に出す候補リスト（他の種別では空）
    // badgeAbove はタイトルの上に独立した行で出すバッジ（食べログの部門）。
    // 城やカードのように名前の左に置くと、店名が長い食べログでは名前が押し出されるため
    // titleTail はタイトル行の右端に寄せる要素（食べログの評点）。名前の折り返しに影響しない
    // タイトル長押しでコピーする素の名前は objPlainName が決める（地図のオブジェクトの長押しと共用）
    let badges = '', badgeAbove = '', title = '', titleTail = '', photo = '', lines = '', rowA = '', rowB = '', pick = '';

    if (isPokefuta) {
        title = p.pokemon || label;
        photo = osPhotoHtml(p.image_url_full
            || (p.cardId ? `https://ekikaramanhole.whitebeach.org/ext/pokefuta/image/main/${String(p.cardId).padStart(3,'0')}.jpg` : ''));
        lines = osKv('住所', p.address);
        rowA = osRow([osBtn(coordGmapUrl, 'btn-gmap', 'GoogleMap'), osBtn(p.detail_url, 'btn-pokefuta', '公式ページ')]);

    } else if (type === 'manhole' || type === 'mhcard') {
        // 蓋は配布場所レコードを紐付けて参照する（蓋の住所と配布場所の住所は別物）
        const cardKey = type === 'mhcard' ? cardKeyOfCardRecord(p) : cardCodeKey(p.cardId);
        const cardFeatures = type === 'mhcard' ? [] : findCardFeaturesByKey(cardKey);
        const card = type === 'mhcard' ? p : (cardFeatures.length ? cardFeatures[0].properties : null);
        const info = card ? mhcardInfo(card) : null;
        if (info) {
            // 食べログと同じく、バッジはタイトルの上の行に置く（名前が長いと押し出されるため）
            const b = (info.id ? `<span class="os-cdbadge">${info.id}</span>` : '')
                    + (info.round ? `<span class="os-cdbadge os-cdround">${info.round}</span>` : '');
            badgeAbove = b ? `<div class="os-badge-row">${b}</div>` : '';
        }
        // 配布が終わったカードは公式一覧に「配布終了」の行として残っている（全国で6件）。
        // 配布場所が無いので、そのぶんの行は出さずに終了した旨を出す。
        const ended = !!(card && card.discontinued);
        // 相手が見つからない蓋のうち、改版で旧版の行ごと消えたものは後継カードを案内する
        const successors = (type === 'manhole' && !card) ? findSuccessorCards(p.cardId) : [];
        if (type === 'mhcard') {
            const head = ended ? '<span class="os-ended">[配布終了]</span>' : '[配布]';
            // 配布終了レコードは locationName が「配布終了」なので、見出しに二度出さない
            const who = [info && info.muni, ended ? '' : p.locationName].filter(Boolean).join(' ');
            title = `${p.coordOffset ? '[複]' : ''}${head} ${who || p.name || label}`;
            photo = osPhotoHtml(p.cardImgUrl, 'full');   // カードは縦長なので切らずに全体を見せる
            lines = ended
                ? osKv('問合せ', p.contactInfo) + osKv('発行', p.issueDate)
                : osKv('住所', p.address) + osKv('時間', p.hours) + osKv('発行', p.issueDate);
        } else {
            title = p.name || label;
            // 同じカードの画像でも、配布場所レコード側(gk-p.jp)は516×720、cardIdから
            // 組み立てる ekikaramanhole 側は232×320（実測）。写真タップの拡大表示で
            // 引き伸ばさずに済むよう、紐付いていれば大きい方を使う。
            // 紐付かない蓋と、配布場所データ未読込のときは従来のURLにする。
            const cardImgUrl = (card && card.cardImgUrl)
                || (p.cardId ? `https://ekikaramanhole.whitebeach.org/ext/manholecard/image/getimage.cgi?file=card/${p.cardId}.jpg` : '');
            photo = osPhotoHtml(cardImgUrl, 'full');   // カードは縦長なので切らずに全体を見せる
            // 蓋自身の住所と、紐付いたカード配布場所の住所を続けて出すため、
            // 同じ「住所」チップが2つ並ばないよう蓋側は「設置」と呼び分ける。
            let cardLines = '';
            if (card && ended) {
                cardLines = osKv('配布', '配布終了') + osKv('問合せ', card.contactInfo) + osKv('発行', card.issueDate);
            } else if (card) {
                cardLines = osKv('配布場所', card.locationName) + osKv('住所', card.address)
                          + osKv('時間', card.hours) + osKv('発行', card.issueDate);
            } else if (successors.length) {
                // 公式一覧から旧版の行ごと消えているので、発行日すら残っていない。
                // 同じ自治体の後継カードが今どこで配られているかだけを出す。
                const s = successors[0].properties;
                cardLines = osKv('配布', `このカードの配布情報は公式一覧にありません（後継カードあり）`)
                          + osKv('後継', [mhcardInfo(s).id, s.locationName].filter(Boolean).join(' '));
            }
            lines = osKv('設置', p.address) + cardLines;
        }
        rowA = osRow([osBtn(coordGmapUrl, 'btn-gmap', 'GoogleMap')]);
        // 行B: 旧「カード詳細」シートの外部リンク2つ（在庫状況は url がある場合のみ＝1,246/1,426件）に
        //      3つ目として相手側への行き来ボタンを足す。飛び先の種別がOFFのときは出さない。
        let jumpBtn = '';
        if (type === 'mhcard') {
            if (filterState.manhole !== false && findLidFeatureByKey(cardKey)) {
                jumpBtn = `<button class="btn btn-to-lid" ${actionAttrs('mhJumpToLid', String(cardKey))}>マンホールへ</button>`;
            }
        } else if (filterState.mhcard !== false && cardFeatures.length) {
            const j = mhCardJumpHtml(cardFeatures, cardKey, lng, lat);
            jumpBtn = j.btn;
            pick = j.pick;
        } else if (filterState.mhcard !== false && successors.length) {
            // 直接の相手はいないが後継カードがある場合は、そちらの配布場所へ行けるようにする
            const j = mhCardJumpHtml(successors, cardKeyOfCardRecord(successors[0].properties), lng, lat, '後継の配布場所');
            jumpBtn = j.btn;
            pick = j.pick;
        }
        rowB = osRow([info ? osBtn(card.url, 'btn-cd-stock', '在庫状況') : '',
                      info ? osBtn(info.gkpUrl, 'btn-cd-gkp', 'GKP公式一覧') : '',
                      jumpBtn]);

    } else if (type === 'michi') {
        title = p.name || label;
        // road は michi.js の全1,234件が空文字なので、実際にはこの行は出ない（残しておく）
        lines = osKv('路線', p.road) + osKv('住所', p.address) + osKv('時間', p.businessHours);
        rowA = osRow([
            osBtn(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(title)}`, 'btn-gmap', 'GoogleMap'),
            osBtn(p.url, 'btn-michi-web', '公式ページ'),
        ]);
        rowB = osRow([osBtn(p.michiEkiUrl, 'btn-michi-eki', 'michieki.jp'),
                      osBtn(p.homepage, 'btn-michi-hp', '施設HP'),
                      osBtn(p.homepage2, 'btn-michi-hp', '関連HP')]);

    } else if (type === 'castle') {
        const name = p.name || label;
        // 近接する別の城と座標が重なるため表示位置をずらしたエントリには目印を付ける
        // （マンホールカード配布場所のcoordOffsetと同じ仕組み。実際の座標は元の位置から数m~十数mずれている）
        title = p.coordOffset ? `[近接あり] ${name}` : name;
        badges = popupFormBadgeHtml(p.shiroHbForm) + castleGenreBadgeHtml(p);
        const aliases = osParseAliases(p.aliases);
        lines = osKv('別名', aliases.length ? aliases.join('、') : '')
              + osLine(popupFormMetaHtml(p.shiroHbElevationM, p.shiroHbRelativeHeightM))
              + castleAttrLine('指定文化財', p.culturalAsset)
              + castleRemainsLine(p.remains)
              + castleAttrLine('城主', p.lords)
              + osKv('住所', p.address);
        // 写真は非同期取得のため枠だけ先に置き、injectCastleImage で差し込む
        photo = `<div class="os-castle-photo"></div>`;
        rowA = osRow([
            osBtn(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(castleGmapQuery(name, p.address))}`, 'btn-gmap', 'GoogleMap'),
            osBtn(`https://www.google.com/search?q=${encodeURIComponent(name + ' アクセス')}`, 'btn-access', 'アクセス'),
        ]);
        // Wikipediaは記事存在確認が非同期のため初期表示には含めず、injectWikiButtonStateで
        // セット行ごと buildSourceButtons() で再構築する（攻城団・城郭放浪記は同期的に確定済み）
        rowB = `<div class="os-brow os-source-row">${buildSourceButtons('', p.url, p.shiroHbUrl)}</div>`;

    } else {   // shop（食べログ）
        // タイトルは店名だけにし、駅とジャンルは項目へ移す（name をそのまま出すと
        // 「店名 - 駅（ジャンル）」で店名が省略されるため）。
        // ジャンル=店自身のジャンル（つけ麺）、100名店=賞の部門（ラーメン（東京））で別物。
        const sp = shopParts(p);
        title = sp.shop || label;
        titleTail = shopRatingHtml(p);
        const genreBadge = shopGenreBadgeHtml(p, 'os-genrebadge');
        badgeAbove = genreBadge ? `<div class="os-badge-row">${genreBadge}</div>` : '';
        // ジャンルは店舗ページの ld+json（servesCuisine。「ラーメン、餃子、にんにく料理」の
        // ように複数）を優先する。取れていない店は従来どおり name から切り出した1つを出す。
        lines = osKv('ジャンル', p.cuisine || sp.genre)
              + osKv('100名店', p.category)
              + osKv('受賞歴', shopAwardsHtml(p), 'os-line-aw')
              + osKv('予算', shopBudgetHtml(p))
              + osKv('最寄り', sp.station)
              + osKv('住所', p.address);
        // GoogleMap検索は従来どおり name 全体（店名＋駅＋ジャンル）で引く。
        // タイトルが店名だけになったからといって店名だけで引くと、同名店の多い
        // チェーン・支店で別の店に当たるため。
        rowA = osRow([
            osBtn(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name || label)}`, 'btn-gmap', 'GoogleMap'),
            osBtn(p.url, 'btn-tabelog', '食べログ'),
        ]);
    }

    const media = photo ? `<div class="os-row">${photo}<div class="os-meta">${lines}</div></div>` : lines;
    return `${badgeAbove}<div class="os-title">${badges}<span class="os-name" data-copy="${attrEscape(objPlainName(type, label, p) || title)}">${title}</span>${titleTail}</div>${media}${rowA}${rowB}${pick}${rowC}`;
}

// 城シートに写真を非同期で挿入する
async function injectCastleImage(castleName, kojodanUrl, shiroHbUrl) {
    const slotAtStart = document.querySelector('#obj-sheet-body .os-castle-photo');
    const imgUrl = await fetchCastleImage(castleName, kojodanUrl, shiroHbUrl);
    if (!imgUrl) return;
    const slot = document.querySelector('#obj-sheet-body .os-castle-photo');
    // 取得完了までに別のオブジェクトへ切り替わっていたら、その城の写真を差し込まない
    if (!slot || slot !== slotAtStart) return;
    slot.outerHTML = osPhotoHtml(imgUrl, 'wide');   // 城の取得元は横長なので4:3枠にする
    // 画像ロードで高さが変わるため、確定した時点で選択ピンの見え方を補正し直す
    const img = document.querySelector('#obj-sheet-body .os-photo img');
    if (img) img.addEventListener('load', adjustMapForSheet, { once: true });
    applyClampMarkers();
    adjustMapForSheet();
}

// ── シートの開閉と、選択中オブジェクトが隠れないための地図調整 ─────────
let objSheetLngLat = null;   // 現在シートを開いているオブジェクトの座標
let objSheetCtx = null;      // 写真ビューアが「何の写真か」を出すための対象情報
let objSheetPair = null;     // 蓋⇄配布場所を行き来してきたときの[移動元, 移動先]。通常のタップではnull
// ペア表示のときに地図を引く範囲。
// 下限14は「ここまで引いても2点が入らないならペア表示をあきらめる」境目。clusterMaxZoom:13 の
// ため、これより引くとピンがクラスタに畳まれて消えることによる。割った場合は移動先だけへ寄せる。
// 上限17は近すぎる組で寄りすぎないための頭打ちで、周囲の街並みが読み取れる限度。
// 実データ1,223組では26.2%が上限に当たり、18.2%が下限を割ってペア表示を見送る（実測）。
const MH_PAIR_MIN_ZOOM = 14;
const MH_PAIR_MAX_ZOOM = 17;

// 実際に2行を超えて省略されている行にのみ▼マークを付ける
function applyClampMarkers() {
    document.querySelectorAll('#obj-sheet-body .os-clamp').forEach(el => {
        el.classList.toggle('clampable', el.scrollHeight > el.clientHeight + 1);
    });
}

// 選択中のオブジェクトがシートに隠れないよう、シート高さの半分だけ上にずらして
// 「シートより上に残っている領域」の中央にピンが来るように地図を動かす。
// 可視領域の中心 = (H - シート高)/2、地図コンテナの中心 = H/2 なので、
// easeTo の offset に [0, -シート高/2] を渡せばその位置に着地する。
function adjustMapForSheet() {
    if (!objSheetLngLat) return;
    const sheet = document.getElementById('obj-sheet');
    const h = sheet.getBoundingClientRect().height;
    if (!h) return;
    const mapH = map.getContainer().getBoundingClientRect().height;
    // シートは下部バーの上に載るので、画面下から隠れる高さはシート自身より base ぶん高い
    const covered = h + sheetBaseBottom(sheet);
    // 蓋⇄配布場所を行き来した直後は、相手も画面に入るところまで引く。
    // 収める先はシートに隠れない範囲。padding の bottom にシートの実測高さを渡して、
    // その上の帯に2点が入る倍率を cameraForBounds に出させる。
    // シートが高いときに padding が地図を食い潰さないよう、可視域は最低160px残す。
    if (objSheetPair) {
        const [a, b] = objSheetPair;
        const padBottom = Math.min(Math.round(covered) + 20, Math.max(0, mapH - 160));
        const cam = map.cameraForBounds(
            [[Math.min(a[0], b[0]), Math.min(a[1], b[1])], [Math.max(a[0], b[0]), Math.max(a[1], b[1])]],
            { padding: { top: 60, bottom: padBottom, left: 40, right: 40 } });
        // 2点が入る倍率が下限を割るときは、引かずに移動先だけへ寄せる（下の通常処理へ流す）。
        // 無理に下限で止めると、2点の中間を中心にしたまま寄ることになり、
        // 移動先まで画面の外へ出てしまう（8.6km離れた組で実測：移動先が画面右外1077px）。
        if (cam && cam.zoom >= MH_PAIR_MIN_ZOOM) {
            map.easeTo({ center: cam.center, zoom: Math.min(MH_PAIR_MAX_ZOOM, cam.zoom),
                         bearing: 0, pitch: 0, duration: 550, essential: true }, { histIgnore: true });
            return;
        }
    }
    // シートが画面の大半を占める場合でもピンが上端外へ飛ばないよう、ずらし量を制限する
    const dy = Math.min(covered / 2, Math.max(0, (mapH - 80) / 2));
    const opts = { center: objSheetLngLat, offset: [0, -dy], duration: 400, essential: true };
    // ここへ来た objSheetPair は「行き来したが2点は入らなかった」場合。移動先だけへ寄せるが、
    // 引いたままだとクラスタに畳まれて着いた先が分からないので、判別できる倍率までは寄せる。
    if (objSheetPair) opts.zoom = Math.max(map.getZoom(), MH_PAIR_MIN_ZOOM);
    // histIgnore: この移動はシート表示の副作用なので、移動履歴には記録しない
    map.easeTo(opts, { histIgnore: true });
}

// pairFrom: 蓋⇄配布場所を行き来してきたときの移動元の座標。渡すと両方にリングを出して線で結び、
//           地図も両方が入るところまで引く。通常のピンタップでは渡さないので、そこで解除される。
function openObjSheet(type, label, p, lng, lat, pairFrom) {
    const body = document.getElementById('obj-sheet-body');
    body.innerHTML = buildSheetHtml(type, label, p, lng, lat);
    body.scrollTop = 0;
    const sheet = document.getElementById('obj-sheet');
    sheet.style.transition = '';
    sheet.style.bottom = `${sheetBaseBottom(sheet)}px`;
    objSheetLngLat = [lng, lat];
    objSheetCtx = { type, label, p };
    objSheetPair = pairFrom ? [pairFrom.slice(), [lng, lat]] : null;
    setSelectedObjects(objSheetPair || [[lng, lat]], objRingColor(type, p));
    applyClampMarkers();
    // お気に入りの色ラインと★は、開いた対象ごとに引き直す
    closeFavPalette();
    updateSheetFav();
    // 写真は読み込み完了で高さが確定する（カード系は比率なりに伸びる）ため、その時点で寄せ直す
    body.querySelectorAll('img').forEach(img => {
        if (!img.complete) img.addEventListener('load', adjustMapForSheet, { once: true });
    });
    if (type === 'castle') {
        injectCastleImage(p.name || label, p.url, p.shiroHbUrl);
        injectWikiButtonState(p.name || label, p.aliases, p.url, p.shiroHbUrl, lat, lng);
    }
    // レイアウト確定後の実寸で地図を寄せる
    requestAnimationFrame(adjustMapForSheet);
}

function closeObjSheet() {
    const sheet = document.getElementById('obj-sheet');
    sheet.style.transition = '';
    sheet.style.bottom = '-100%';
    objSheetLngLat = null;
    objSheetCtx = null;
    objSheetPair = null;
    closePhotoViewer();   // シートが閉じたら写真ビューアも残さない
    closeFavPalette();    // お気に入りのパレットも残さない
    closeRemainsHelpPop(); // 遺構の語から出した図解も残さない
    updateSheetFav();     // 色ラインを消し、★を隠す
    clearSelectedObject();
}

