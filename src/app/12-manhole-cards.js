// --- マンホールカード（蓋ピン ⇔ 配布場所レコードの紐付け） ---
// 旧「カード詳細」シートは廃止し、その情報は情報シート本体に統合した。
let cardJoinIndex = null;   // カードコード → 配布場所featureの配列（遅延構築）
let lidJoinIndex = null;    // カードコード → 蓋feature（遅延構築。実データでは1カードにつき蓋は1件）

// カードコード正規化: "13-100-P001" / "01-100-A-01" → "13-100-P-1"
// 先頭の "S-"（東京都の特別版2件）と、枝番のないコード（20-452-A / 23-234A）も受ける。
function cardCodeKey(s) {
    const t = String(s == null ? '' : s).replace(/^S-/i, '');
    let m = t.match(/^(\d{2})-(\d{3})-?([A-Z])-?0*(\d+)/i);
    if (m) return `${m[1]}-${m[2]}-${m[3].toUpperCase()}-${parseInt(m[4], 10)}`;
    m = t.match(/^(\d{2})-(\d{3})-?([A-Z])$/i);   // 枝番なしは1枚目とみなす
    return m ? `${m[1]}-${m[2]}-${m[3].toUpperCase()}-1` : null;
}

// 配布場所レコードが名乗るカードコード。次の2通りを両方登録して、どちらでも引けるようにする。
//   cardId … 公式ページの市町村セルの括弧内ID（「富山市 (F001)」→ F001）。蓋側のIDと同じ体系で
//            確実だが、括弧内IDは全行にあるわけではない（公式1,311行中809行）。
//   画像URL … ファイル名から取る従来の方法。命名の揺れが大きく（13-100-A1-01 / 13-100-C101 /
//            13-100-D01 が全部別体系）単独では24件を取り逃すが、cardIdが無い行でも取れる。
function cardKeysOfCardRecord(p) {
    const keys = [];
    const url = (p && p.cardImgUrl) || '';
    const pm = url.match(/\/mhc\/(\d{2})-(\d{3})/);
    if (pm && p && p.cardId) keys.push(cardCodeKey(`${pm[1]}-${pm[2]}-${p.cardId}`));
    const m = url.match(/\/mhc\/([\w-]+?)(?:\.\w+)?$/i);   // 拡張子は .jpg 以外や無しもある
    if (m) keys.push(cardCodeKey(m[1]));
    return keys.filter((k, i) => k && keys.indexOf(k) === i);
}
function cardKeyOfCardRecord(p) {
    return cardKeysOfCardRecord(p)[0] || null;
}

// 蓋のcardId → 配布場所featureの一覧。
// 同じカードを複数箇所で配る例が147キーある（2箇所=143 / 3箇所=4。季節・曜日で窓口が変わるものが大半）
// ため、propertiesではなくfeatureの配列で返す（行き先の座標が要るため）。
function ensureCardJoinIndex() {
    if (cardJoinIndex) return true;
    const fc = loadedData.mhcard;
    if (!fc) return false;   // 配布場所データ未読込（読込後に再タップで解決）
    cardJoinIndex = {};
    fc.features.forEach(f => {
        cardKeysOfCardRecord(f.properties).forEach(k => {
            const list = (cardJoinIndex[k] = cardJoinIndex[k] || []);
            if (!list.includes(f)) list.push(f);
        });
    });
    return true;
}
function findCardFeaturesByKey(key) {
    if (!key || !ensureCardJoinIndex()) return [];
    return cardJoinIndex[key] || [];
}

// 相手が見つからない蓋のための後継カード探し。
// 改版されたカードは公式一覧から旧版の行ごと消える（小樽市A001→A002など）。
// 同じ自治体・同じ記号で枝番だけ違うカードが残っていれば、それが後継にあたる。
function findSuccessorCards(cardId) {
    const self = cardCodeKey(cardId);
    if (!self || !ensureCardJoinIndex()) return [];
    const prefix = self.replace(/-\d+$/, '-');   // 13-100-A-1 → 13-100-A-
    const out = [];
    Object.keys(cardJoinIndex).forEach(k => {
        if (k === self || !k.startsWith(prefix)) return;
        cardJoinIndex[k].forEach(f => { if (!out.includes(f)) out.push(f); });
    });
    return out;
}
function findCardFeaturesByCardId(cardId) {
    return findCardFeaturesByKey(cardCodeKey(cardId));
}

// シート表示に使う配布場所は先頭の1件（複数あっても住所・時間の欄は1件ぶんしか出さない）
function findCardByCardId(cardId) {
    const fs = findCardFeaturesByCardId(cardId);
    return fs.length ? fs[0].properties : null;
}

// カードコード → 対応する蓋feature（配布場所1,426件中1,365件で引ける）
function findLidFeatureByKey(key) {
    if (!key) return null;
    if (!lidJoinIndex) {
        const fc = loadedData.manhole;
        if (!fc) return null; // 蓋データ未読込（読込後に再タップで解決）
        lidJoinIndex = {};
        fc.features.forEach(f => {
            const k = cardCodeKey(f.properties.cardId);
            if (k && !lidJoinIndex[k]) lidJoinIndex[k] = f;
        });
    }
    return lidJoinIndex[key] || null;
}

// 配布場所レコードから、シート表示に必要な派生情報を作る。
// muni: 自治体名（"札幌市（A001）" → "札幌市"）／ id: 括弧内のカードID（1,426件中864件のみ）
// gkpUrl: GKP公式一覧の該当行へのリンク（旧カード詳細シートと同じ生成規則）
function mhcardInfo(p) {
    const muniRaw = p.municipality || '';
    const muni = muniRaw.replace(/[（(].*$/, '').trim();
    const idm = muniRaw.match(/[（(]\s*([A-Za-z0-9]+)\s*[）)]/);
    const prefM = (p.cardImgUrl || '').match(/\/mhc\/(\d{2})-/);
    const gkpPref = (!prefM || prefM[1] === '00') ? 'zenkoku' : prefM[1];
    return {
        muni,
        id: idm ? idm[1] : '',
        round: p.round || '',
        gkpUrl: `https://www.gk-p.jp/mhcard/?pref=${gkpPref}`
              + (muni ? `#:~:text=${encodeURIComponent(muni)}` : '#mhcard_result'),
    };
}

// --- 蓋 ⇄ カード配布場所の行き来 ---------------------------------------
/* 蓋のシートから「そのカードをもらえる配布場所」へ、配布場所のシートから「そのカードのデザイン蓋」へ移る。
   移動後はピンをタップしたときと同じ状態にする（地図を寄せる → 情報シート＋選択リング → 履歴に記録）。
   飛び先の種別を表示していない（設定でOFF）ときはボタンを出さない。検索・周辺検索が
   OFFの種別を候補から外すのと同じ扱いで、表示していない種別へは連れて行かない。
   ボタンに持たせるのは正規化済みのカードコード（data-key）と候補の番号（data-i）だけで、URLや施設名は埋め込まない。
   移動先だけを中央に置くのではなく、移動元も画面に残して線で結ぶ。どこから来たのかと
   2点の距離感が分かるようにするため。地図を引く範囲と解除の条件は openObjSheet 側にある。 */
function mhJumpTo(type, feature) {
    if (!feature) return;
    const from = objSheetLngLat ? objSheetLngLat.slice() : null;   // 今シートを開いている側が移動元
    const c = feature.geometry.coordinates.slice();
    const p = feature.properties;
    const label = p.name || p.locationName || '地点';
    // 地図は openObjSheet → adjustMapForSheet が両方の入る位置まで動かす
    openObjSheet(type, label, p, c[0], c[1], from);
    histRecordPin(label, c, type, p);
}
function mhJumpToCard(key, idx) {
    mhJumpTo('mhcard', findCardFeaturesByKey(key)[idx || 0]);
}
function mhJumpToLid(key) {
    mhJumpTo('manhole', findLidFeatureByKey(key));
}
// 配布場所が複数のときの候補リストの開閉。高さが変わるので地図を寄せ直す
function mhTogglePicker() {
    const pick = document.querySelector('#obj-sheet-body .os-pick');
    if (!pick) return;
    pick.hidden = !pick.hidden;
    adjustMapForSheet();
}

// 蓋シートの「配布場所」ボタンと、複数のときに開く候補リストを作る。
// 候補には蓋からの距離を出す（季節・曜日で分かれた同名の窓口を見分ける手がかりになる）。
function mhCardJumpHtml(cardFeatures, key, lng, lat, label) {
    if (cardFeatures.length === 1) {
        // 配布が終わったカードの行き先は配布場所ではない（問合せ先か市町村の代表点）。
        // 「配布場所」と書くと押した先と食い違うので、状態をそのまま文言にする。
        const single = label || (cardFeatures[0].properties.discontinued ? '配布終了' : '配布場所');
        return { btn: `<button class="btn btn-to-card" data-on-click="mhJumpToCard" data-key="${attrEscape(key)}" data-i="0">${single}</button>`, pick: '' };
    }
    const items = cardFeatures.map((f, i) => {
        const q = f.properties;
        const d = calcDist(lat, lng, f.geometry.coordinates[1], f.geometry.coordinates[0]);
        const ds = d < 1 ? `${Math.round(d * 1000)}m` : `${d.toFixed(1)}km`;
        return `<button class="os-pick-it" data-on-click="mhJumpToCard" data-key="${attrEscape(key)}" data-i="${i}">`
             + `<span class="os-pick-nm">${q.locationName || q.name || '配布場所'}`
             + `<span class="os-pick-sub">${q.address || ''}</span></span>`
             + `<span class="os-pick-d">${ds}</span></button>`;
    }).join('');
    return {
        btn: `<button class="btn btn-to-card" data-on-click="mhTogglePicker">配布場所（${cardFeatures.length}件）</button>`,
        pick: `<div class="os-pick" hidden><div class="os-pick-hd">配布場所を選ぶ</div>${items}</div>`,
    };
}

