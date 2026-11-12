    /* ══ 選択モード（まとめて外す） ══════════════════════════════════════
       1件ずつなら情報シートの★と行の長押しで足りるが、旅程を1つ終えたあとの
       後始末のように、まとまった件数を外す手立てが無かったので足した。
       外す相手は「いま見えている一覧」に揃える（書き出しと同じ約束）。
         ・枠のチップが「すべて」なら、選んだ項目を名前の入っている枠すべてから外す
         ・枠のチップで1つ選んでいるなら、その枠からだけ外す（他の枠の分は残る）
         ・設定の「オブジェクト表示」で消している種別は一覧に出ないので、対象にもならない
       一括解除は専用のボタンを増やさず、「すべて選択」→「解除」の2手で行う。
       取り消せない操作の確認は、同期の端末外しと同じ confirm。 */
    function toggleFavSelectMode() { setFavSelectMode(!favState.selecting); }
    function setFavSelectMode(on) {
        favState.selecting = !!on;
        favState.sel.clear();
        closeFavPalette();
        const list = document.getElementById('fav-item-list');
        favState.restoreScroll = list ? list.scrollTop : 0;   // 入る・出るで一覧は動かさない
        renderFavItems(true);
    }
    // 外す枠。チップが「すべて」なら名前の入っている枠すべて
    function favUnmarkSlots() {
        return favState.kind === 'all' ? favActiveSlots() : [Number(favState.kind)];
    }
    function favUnmarkWhere() {
        const slots = favUnmarkSlots();
        return slots.length === 1 ? `「${favNameOf(slots[0])}」` : 'すべての枠';
    }
    function renderFavSelBar() {
        const view = document.getElementById('nearby-fav-view');
        if (!view) return;
        view.classList.toggle('selecting', favState.selecting);
        const btn = document.getElementById('fav-select-btn');
        if (btn) btn.classList.toggle('on', favState.selecting);
        // 書き出しは一覧の絞り込みが対象で、選んだ分ではない。取り違えないよう選択中は隠す
        const exp = document.getElementById('fav-export-btn');
        if (exp) exp.style.display = favState.selecting ? 'none' : '';
        const title = document.getElementById('fav-head-title');
        if (title) title.textContent = favState.selecting ? `${favState.sel.size}件を選択` : 'お気に入り';
        const rows = favState.rows || [];
        const allOn = rows.length > 0 && rows.every(r => favState.sel.has(r.key));
        const all = document.getElementById('fav-selall-btn');
        if (all) { all.textContent = allOn ? '選択を解除' : 'すべて選択'; all.disabled = rows.length === 0; }
        const del = document.getElementById('fav-seldel-btn');
        if (del) {
            del.disabled = favState.sel.size === 0;
            del.textContent = favState.sel.size
                ? `${favState.sel.size}件を${favUnmarkWhere()}から外す` : '解除';
        }
    }
    function favToggleSel(i) {
        const r = (favState.rows || [])[i];
        if (!r) return;
        const on = !favState.sel.has(r.key);
        if (on) favState.sel.add(r.key); else favState.sel.delete(r.key);
        /* 同じキーの行が2つ出ることは無い想定だが（キーの衝突は実測0）、
           出たときに片方だけ塗り残さないよう、キーで引いて塗り直す */
        document.querySelectorAll('#fav-item-list .nearby-item[data-fav-i]').forEach(el => {
            const r2 = favState.rows[Number(el.dataset.favI)];
            if (r2 && r2.key === r.key) el.classList.toggle('fav-on', on);
        });
        renderFavSelBar();
    }
    function favSelectAllToggle() {
        const rows = favState.rows || [];
        const allOn = rows.length > 0 && rows.every(r => favState.sel.has(r.key));
        favState.sel = new Set(allOn ? [] : rows.map(r => r.key));
        favState.restoreScroll = document.getElementById('fav-item-list').scrollTop;
        renderFavItems(true);
    }
    function favUnmarkSelected() {
        const keys = [...favState.sel];
        if (!keys.length) return;
        if (!confirm(`選んだ${keys.length}件を${favUnmarkWhere()}から外します。\n\n`
            + '地図・一覧・情報シートの印が消えます。戻すには1件ずつ付け直すことになります。')) return;
        const n = favUnmarkKeys(keys, favUnmarkSlots());
        renderFavKindChips();                 // 件数が減った分をチップに出す（一覧は触らない）
        setFavSelectMode(false);              // 選択モードを出るところで一覧を描き直す
        showToast(`${n.toLocaleString()}件のお気に入りを外しました`);
    }

    function renderFavItems(keepScroll) {
        const list = document.getElementById('fav-item-list');
        if (!list) return;
        const q = normalizeForSearch((favState.q || '').trim());
        const rows = favSortRows(favApplyChipFilter(favCollect()));
        favState.rows = rows;
        // 選ぶのは「いま見えている行」だけ。絞り込みや解除で消えた行の選択は残さない
        if (favState.sel.size) {
            const visible = new Set(rows.map(r => r.key));
            favState.sel.forEach(k => { if (!visible.has(k)) favState.sel.delete(k); });
        }
        if (!rows.length) {
            list.innerHTML = (q || favState.kind !== 'all')
                ? '<div class="lords-note">該当する項目がありません</div>'
                : `<div class="fav-empty"><b>★</b>まだ登録がありません。<br>
                    ピンや一覧から開いた情報シートの★を押すと、ここに集まります。</div>`;
            renderFavSelBar();
            return;
        }
        list.innerHTML = rows.map((r, i) => {
            const item = r.item;
            const distStr = r.dist < 1 ? `${Math.round(r.dist * 1000)}m` : `${r.dist.toFixed(1)}km`;
            const on = favState.selecting && favState.sel.has(r.key);
            return `<div class="nearby-item${on ? ' fav-on' : ''}" data-fav-i="${i}">
                ${favStripeHtml(item.type, item.properties, item.coords)}
                ${prefTypeIconHtml(item.type, item.properties || {})}
                <div class="nearby-item-text">
                    <div class="nearby-item-name">${attrEscape(itemDisplayName(item))}</div>
                    <div class="nearby-item-sub">${attrEscape(item.sub || '')}</div>
                </div>
                ${prefBadgesHtml(item)}
                ${favState.sort === 'at' ? `<div class="fav-added">${favDateText(r.at)}</div>`
                                         : `<div class="nearby-item-dist">${distStr}</div>`}
                ${favState.selecting ? '<span class="fav-selck">✓</span>' : ''}
            </div>`;
        }).join('') + `<div class="lords-note">全${rows.length.toLocaleString()}件<br>
            ${favState.selecting ? '行をタップで選び、下のボタンでまとめて外します'
                                 : '行を長押しすると、この場で付け替え・取り消しができます'}</div>`;
        list.querySelectorAll('.nearby-item[data-fav-i]').forEach(el => {
            const i = Number(el.dataset.favI);
            if (favState.selecting) {
                // 選択中はタップで選ぶ。長押しも同じ扱いにして、押し続けても何も起きない状態にしない
                bindFavRow(el, () => favToggleSel(i), () => favToggleSel(i));
            } else {
                bindFavRow(el, () => favJumpToItem(i), () => {
                    const r = favState.rows[i];
                    if (r) openFavPalette(el, r.key);
                });
            }
        });
        renderFavSelBar();
        // 全件を入れ終えてから位置を指定する（先に指定すると高さが足りずに切り詰められる）
        list.scrollTop = keepScroll ? (favState.restoreScroll || 0) : 0;
        favState.restoreScroll = 0;
    }
    /* 一覧からオブジェクトへ飛ぶ。県ページ（prefJumpToItem）と同じ順序に揃える。 */
    function favJumpToItem(i) {
        const r = (favState.rows || [])[i];
        if (!r) return;
        favState.scrollTop = document.getElementById('fav-item-list').scrollTop;
        saveListReturnCamera();
        closeNearby();
        onResultClick(r.item);
        setTimeout(injectFavBackLink, 400);   // onResultClick は300ms後にシートを開く
    }
    function injectFavBackLink() {
        const body = document.getElementById('obj-sheet-body');
        if (!body || body.querySelector('.os-lords-back')) return;
        const div = document.createElement('div');
        div.className = 'os-lords-back';
        div.textContent = '↩ 「お気に入り」の一覧に戻る';
        div.onclick = () => { closeObjSheet(); restoreListReturnCamera(); openNearbyPanel(); openFavView(true); };
        body.insertBefore(div, body.firstChild);
    }

    /* ══ お気に入りの書き出し ═════════════════════════════════════════════
       TravelPlan の入力ファイル仕様（sample/input-format.md 版1.5）の TSV を作る。
       仕様が必須とするのは name / lat / lng の3列だけで、任意列は address / note / id。
       address は版1.4（2026-08-25）で正式な任意列になった。住所はこの列だけに入れ、
       note へは混ぜない（§3.2。理由は favExportNote に書いた）。
       版1.1 で role / stay / day / priority が削除された（「ファイルはその場所の属性だけを
       持ち、旅程の都合はアプリ上で操作する」という設計原則が入ったため）ので、
       出発地・滞在時間・優先度はここでは一切作らない。
       形式は TSV だけにしてある。仕様は CSV と JSON も受けるが、選ばせる意味が無い。 */
    let favExportState = { allTypes: true, extraCols: true };

    // 6つのデータファイルは直列で届く。全部揃う前に出すと、その種別の登録が黙って落ちる
    const FAV_EXPORT_DATA_KEYS = ['shops', 'pokefuta', 'manhole', 'mhcard', 'michi', 'castle'];
    function favExportDataReady() {
        return FAV_EXPORT_DATA_KEYS.every(k => loadedData[k]);
    }

    /* 出す行。一覧の絞り込み（枠・検索語）はそのまま効かせ、
       設定の「オブジェクト表示」だけトグルで素通りできる。 */
    function favExportRows() {
        const seen = new Set();
        const rows = [];
        for (const r of favApplyChipFilter(favCollect(favExportState.allTypes))) {
            // id は仕様上ファイル内で一意（重複は読み込みエラーになる）。実データでは
            // 全35,323件で重複0を確認しているが、データ更新で崩れても壊さないよう畳んでおく
            if (seen.has(r.key)) continue;
            seen.add(r.key);
            rows.push(r);
        }
        // 一覧の並べ替えチップと同じ順序で出す（近い順で見ていたら近い順のまま出る）
        return favSortRows(rows);
    }

    /* TSV は1セルにタブと改行を置けない（仕様 §2 の制約）。
       実データでは全35,323件で混入0を確認済みだが、データ更新で入ってきても
       行がずれないよう空白へ潰しておく。 */
    function favTsvCell(s) {
        return String(s == null ? '' : s).replace(/[\t\r\n]+/g, ' ').trim();
    }
    /* note 列。種別の呼び名（「お城」「マンホール蓋」）だけを入れる。
       住所は address 列（favExportAddress）へ出すので、ここへは混ぜない。仕様 §3.2 が
       「住所を note に混ぜて出力しないでください。note は自由記述で、アプリは中身を
       住所として解釈しません」と定めている。混ぜると受け側は note をそのまま出すため、
       TravelPlan の計画表の2列目が「お城 / 千葉県千葉市中央区亥鼻一丁目」になる。
       address 列が入る前は住所の置き場が note しか無かったので足していた。
       e2c441c で列を足したとき、この足し込みを外し忘れていた。 */
    function favExportNote(item) {
        return (typeConfig[item.type] || {}).label || '';
    }
    /* address 列。情報シートの住所の行（buildSheetHtml の osKv('住所', …)）に出るものと
       同じ文字列を入れる。properties.address をそのまま出せば揃うが、2種別だけ違う。
         マンホール蓋 … シートで「住所」と呼んでいるのは紐付いたカード配布場所の住所で、
                        蓋自身の住所は「設置」の行にある（同じチップが2つ並ぶのを避けた呼び分け）。
                        入れるのは蓋自身の address。実測1,257件すべてで配布場所とは別の場所を
                        指しており（距離の中央値586m・最大22.4km）、カード側を入れると
                        同じ行の lat/lng と食い違う。
         配布終了のカード … シートに住所の行が出ない（配布場所が無いため問合せ先と発行日だけ）。
                        address には「恵庭市 (B001)」のように市町村＋カードIDが入っていて
                        住所ではないので、6件とも空にする。 */
    function favExportAddress(item) {
        const p = item.properties || {};
        if (item.type === 'mhcard' && p.discontinued) return '';
        return p.address || '';
    }
    function favExportTsv(rows) {
        const extra = favExportState.extraCols;
        const head = extra ? ['name', 'lat', 'lng', 'address', 'note', 'id'] : ['name', 'lat', 'lng'];
        const lines = [head.join('\t')];
        for (const r of rows) {
            const c = r.item.coords || [];
            // 座標は仕様 §4.3 の推奨（小数5桁＝約1.1m）に揃える。生の桁数はまちまちで、
            // 食べログのように14桁あるものは仕様が「不要」としている
            const cells = [favTsvCell(itemDisplayName(r.item)),
                           Number(c[1]).toFixed(5), Number(c[0]).toFixed(5)];
            if (extra) cells.push(favTsvCell(favExportAddress(r.item)),
                                  favTsvCell(favExportNote(r.item)), favTsvCell(r.key));
            lines.push(cells.join('\t'));
        }
        return lines.join('\n') + '\n';
    }

    /* ファイル名は枠の名前だけにする（日付は付けない）。仕様 §1.1 が
       「リストを資産として蓄積し、旅程はその都度アプリ上で組む」と定めたので、
       同じリストは同じ名前で上書きしていくほうが噛み合う。 */
    function favExportFilename() {
        const base = favState.kind === 'all'
            ? 'お気に入り' : (favNameOf(Number(favState.kind)) || 'お気に入り');
        return (base.replace(/[\\/:*?"<>|]/g, '').trim() || 'お気に入り') + '.tsv';
    }

    function showFavExportView() {
        setPanelLifted(true);
        document.getElementById('nearby-main-view').style.display = 'none';
        document.getElementById('nearby-fav-view').classList.remove('open');
        document.getElementById('nearby-fav-export-view').classList.add('open');
    }
    function openFavExportView() {
        // 戻ったときに同じ位置へ返す（一覧の行から飛ぶときと同じ扱い）
        const list = document.getElementById('fav-item-list');
        if (list) favState.scrollTop = list.scrollTop;
        showFavExportView();
        renderFavExport();
    }
    function closeFavExportView() {
        document.getElementById('nearby-fav-export-view').classList.remove('open');
        // 書き出しを開いている間に枠の名前を全部消すと、戻る先が無くなる
        if (!favActiveSlots().length) {
            setPanelLifted(false);
            document.getElementById('nearby-main-view').style.display = '';
            return;
        }
        openFavView(true);
    }
    function toggleFavExportAllTypes() {
        favExportState.allTypes = !favExportState.allTypes;
        renderFavExport();
    }
    function toggleFavExportExtra() {
        favExportState.extraCols = !favExportState.extraCols;
        renderFavExport();
    }

    function renderFavExport() {
        const view = document.getElementById('nearby-fav-export-view');
        if (!view || !view.classList.contains('open')) return;
        const scope = document.getElementById('fxp-scope');
        const n = favState.kind === 'all' ? null : Number(favState.kind);
        const rows = favExportRows();
        const ready = favExportDataReady();
        scope.innerHTML = n
            ? `<span class="fxp-dot" style="background:${FAV_COLORS[n]}"></span>${attrEscape(favNameOf(n))}`
            : 'すべての枠';
        scope.innerHTML += `<span class="fxp-rt">${rows.length.toLocaleString()}件</span>`;
        for (const [id, on] of [['fxp-sw-alltypes', favExportState.allTypes],
                                ['fxp-sw-extra', favExportState.extraCols]]) {
            const sw = document.getElementById(id);
            sw.classList.toggle('on', on);
            sw.setAttribute('aria-checked', String(on));
        }
        document.getElementById('fxp-filename').innerHTML =
            `${attrEscape(favExportFilename())}<span class="fxp-rt">TSV</span>`;
        const q = (favState.q || '').trim();
        document.getElementById('fxp-count').innerHTML = !ready
            ? 'データを読み込み中です。<br>全部そろってから書き出してください'
            : `${rows.length.toLocaleString()}行（ヘッダ行を除く）・${
                favExportState.extraCols ? 6 : 3}列・${
                FAV_SORT_LABEL[favState.sort] || '追加順'}${
                q ? `<br>「${attrEscape(q)}」で絞り込んだ結果です` : ''}`;
        const off = !ready || !rows.length;
        document.getElementById('fxp-save').disabled = off;
        document.getElementById('fxp-copy').disabled = off;
    }

    function favExportSave() {
        const rows = favExportRows();
        if (!rows.length || !favExportDataReady()) return;
        const name = favExportFilename();
        const blob = new Blob([favExportTsv(rows)],
            { type: 'text/tab-separated-values;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        /* iOS はホーム画面から起動した状態（standalone）だと、この保存が黙って
           何も起こさないことがある。そのときのために、すぐ下のコピーを案内しておく。 */
        showToast(isIosStandalonePwa()
            ? `${name} を保存しました。何も起きないときは「本文をコピー」を使ってください`
            : `${name} を保存しました`);
    }

    async function favExportCopy() {
        const rows = favExportRows();
        if (!rows.length || !favExportDataReady()) return;
        const ok = await copyToClipboard(favExportTsv(rows));
        showToast(ok ? `${rows.length.toLocaleString()}件をコピーしました`
                     : 'コピーできませんでした');
    }

