    /* ══ バックアップ（書き出し／読み込み） ══════════════════════════
       サーバーもログインも通らない経路で、端末が変わったときの持ち運びと、
       消えたときの備えを兼ねる（SYNC_MANUAL.md §5.10）。
       書き出しも読み込みも「お気に入りの枠1つ」か「表示設定」のどれか1つを選んで行う
       （2026-09-27 に、4つの枠と表示設定をまとめて置き換える作りから改めた）。
         お気に入り … 1ファイル＝枠1つ。読み込みは選んだ枠へ「追加だけ」で、
                      すでに入っているものは外さない。他の枠・枠の名前・「薄く出す」は触らない。
                      読み込み先はファイルの枠番号に縛られず、読み込むときに選ぶ（最初は未選択）
         表示設定   … favorites 以外の STORE_KEYS。読み込みは置き換えで、画面を読み直す
       読み込めるのは次の3つ。先頭が { なら JSON、それ以外は TSV として読む。
         v2（この形式）                    … 中身は1つ
         v1（2026-09-27 より前の書き出し） … 4つの枠と表示設定が入っている。どれを読むかを選ぶ
         TSV（お気に入り一覧の書き出し）   … id 列をお気に入りのキーとして読む
       いまのデータに無いキーは足さない。地図にも一覧にも出ず、外す手段も無い記録が残るため。 */
    const BACKUP_FORMAT = 'geopenguin-backup';
    const BACKUP_SETTINGS_KEYS = STORE_KEYS.filter(k => k !== 'favorites');
    function backupDateText() {
        const d = new Date(), p = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
    }
    function backupSlotLabel(n) { return favNameOf(n) || `枠${n}（名前なし）`; }
    function backupChip(label, pressed, disabled, onclick, color) {
        return `<button class="lords-chip fav-kind" aria-pressed="${pressed}"${disabled ? ' disabled' : ''}
            onclick="${onclick}">${color ? `<span class="fav-dot" style="background:${color}"></span>` : ''}${
            attrEscape(label)}</button>`;
    }

    // ── 書き出し ──
    let backupExportSel = null;   // 1〜4 か 'settings'
    function backupOpenExport() {
        backupImportCancel();
        backupExportSel = null;
        renderBackupExport();
        const box = document.getElementById('backup-export-box');
        box.style.display = '';
        box.scrollIntoView({ block: 'end' });   // 下端の保存・読み込むボタンまで見せる
    }
    function backupExportCancel() {
        backupExportSel = null;
        document.getElementById('backup-export-box').style.display = 'none';
    }
    function setBackupExportSel(v) { backupExportSel = v; renderBackupExport(); }
    function renderBackupExport() {
        const sel = backupExportSel;
        // 空の枠は出すものが無いので選べない。名前を空にした枠でも、中身があれば出せる。
        // 表示設定も、一度も保存していなければ出すものが無い
        document.getElementById('backup-export-targets').innerHTML =
            FAV_SLOTS.map(n => {
                const c = favCountOf(n);
                return backupChip(`${backupSlotLabel(n)} ${c.toLocaleString()}`, sel === n, !c,
                                  `setBackupExportSel(${n})`, FAV_COLORS[n]);
            }).join('')
            + backupChip('表示設定', sel === 'settings', !BACKUP_SETTINGS_KEYS.some(k => storeGet(k) != null),
                         `setBackupExportSel('settings')`);
        document.getElementById('backup-export-sum').innerHTML = !sel ? '書き出す対象を選んでください'
            : sel === 'settings' ? '表示設定（オブジェクト表示・地図タイルなど）を書き出します'
            : `「${attrEscape(backupSlotLabel(sel))}」の ${favCountOf(sel).toLocaleString()}件を書き出します`;
        document.getElementById('backup-export-go').disabled = !sel;
    }
    function backupExportRun() {
        const sel = backupExportSel;
        if (!sel) return;
        let body, label;
        if (sel === 'settings') {
            const data = {};
            BACKUP_SETTINGS_KEYS.forEach(k => { const v = storeGet(k); if (v != null) data[k] = v; });
            body = { kind: 'settings', data };
            label = '表示設定';
        } else {
            const items = {};
            for (const [k, v] of Object.entries(favStore.items)) if (v.mk.includes(sel)) items[k] = v.at || 0;
            body = { kind: 'fav', slot: sel, name: favNameOf(sel), items };
            label = favNameOf(sel) || `枠${sel}`;
        }
        const text = JSON.stringify(Object.assign(
            { format: BACKUP_FORMAT, v: 2, at: new Date().toISOString() }, body), null, 1);
        const name = `カスタムマップ-${label.replace(/[\\/:*?"<>|]/g, '').trim() || 'お気に入り'}-${backupDateText()}.json`;
        const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        backupExportCancel();
        // iOS のホーム画面起動では保存が黙って何も起きないことがある（書き出しビューと同じ事情）
        showToast(isIosStandalonePwa()
            ? `${name} を保存しました。何も起きないときは通常のブラウザで開いて試してください`
            : `${name} を保存しました`);
    }

    // ── 読み込み ──
    /* backupImportState.sources は選べる中身の並び。
         { kind: 'fav', label, color, keys, missing, noId } … お気に入り（枠1つ分）
         { kind: 'settings', label, data }                  … 表示設定 */
    let backupImportState = null;
    function backupImport(input) {
        const file = input.files && input.files[0];
        input.value = '';                     // 同じファイルを続けて選べるようにする
        if (!file) return;
        const reader = new FileReader();
        reader.onerror = () => showToast('ファイルを読めませんでした');
        reader.onload = () => {
            const sources = backupParse(String(reader.result).replace(/^\uFEFF/, ''));
            if (!sources) { showToast('このファイルは読み込めません'); return; }
            if (!sources.length) { showToast('中身が空でした'); return; }
            if (sources.some(s => s.kind === 'fav')) {
                // 6種別が揃う前に照合すると、まだ届いていない種別の行が「地図に無い」で落ちる
                if (!favExportDataReady()) {
                    showToast('データを読み込み中です。少し待ってからもう一度選んでください');
                    return;
                }
                const known = favKnownKeys();
                for (const s of sources) {
                    if (s.kind !== 'fav') continue;
                    const all = s.keys;
                    s.keys = all.filter(k => known.has(k));
                    s.missing = all.length - s.keys.length;
                }
            }
            backupExportCancel();
            backupImportState = { fileName: file.name, sources,
                                  src: sources.length === 1 ? sources[0] : null, slot: 0 };
            renderBackupImport();
            const box = document.getElementById('backup-import-box');
            box.style.display = '';
            box.scrollIntoView({ block: 'end' });   // 下端の保存・読み込むボタンまで見せる
        };
        reader.readAsText(file);
    }
    function backupPickSettings(src) {
        const data = {};
        BACKUP_SETTINGS_KEYS.forEach(k => { if (typeof src[k] === 'string') data[k] = src[k]; });
        return data;
    }
    // 読めない形なら null、読めたが中身が無ければ空配列
    function backupParse(text) {
        if (!text.trimStart().startsWith('{')) {
            const t = favImportParseTsv(text);
            if (!t) return null;
            return t.keys.length ? [{ kind: 'fav', label: 'TSV の地点', keys: t.keys, noId: t.noId }] : [];
        }
        let obj = null;
        try { obj = JSON.parse(text); } catch { obj = null; }
        if (!obj || obj.format !== BACKUP_FORMAT) return null;
        if (obj.v === 2) {
            if (obj.kind === 'fav' && obj.items && typeof obj.items === 'object') {
                const n = Number(obj.slot);
                const keys = Object.keys(obj.items);
                return keys.length ? [{ kind: 'fav', label: String(obj.name || '').trim() || `枠${n}`,
                                        color: FAV_COLORS[n], keys }] : [];
            }
            if (obj.kind === 'settings' && obj.data && typeof obj.data === 'object') {
                const data = backupPickSettings(obj.data);
                return Object.keys(data).length ? [{ kind: 'settings', label: '表示設定', data }] : [];
            }
            return null;
        }
        // v1: 4つの枠と表示設定がまとめて入っている
        if (!obj.data || typeof obj.data !== 'object') return null;
        const out = [];
        let fav = null;
        try { fav = JSON.parse(obj.data.favorites || 'null'); } catch { fav = null; }
        if (fav && fav.items && typeof fav.items === 'object') {
            FAV_SLOTS.forEach(n => {
                const keys = Object.keys(fav.items)
                    .filter(k => favNormalizeMk(fav.items[k] && fav.items[k].mk).includes(n));
                const nm = fav.names && typeof fav.names[n] === 'string' ? fav.names[n].trim() : '';
                if (keys.length) out.push({ kind: 'fav', label: nm || `枠${n}`, color: FAV_COLORS[n], keys });
            });
        }
        const data = backupPickSettings(obj.data);
        if (Object.keys(data).length) out.push({ kind: 'settings', label: '表示設定', data });
        return out;
    }
    function favImportParseTsv(text) {
        const lines = text.split(/\r\n|\r|\n/).filter(l => l.trim() !== '');
        if (!lines.length) return null;
        const idCol = lines[0].split('\t').map(s => s.trim().toLowerCase()).indexOf('id');
        if (idCol < 0) return null;
        const keys = [], seen = new Set();
        let noId = 0;
        for (const l of lines.slice(1)) {
            const id = (l.split('\t')[idCol] || '').trim();
            if (!id) { noId++; continue; }
            if (seen.has(id)) continue;
            seen.add(id);
            keys.push(id);
        }
        return { keys, noId };
    }
    function favKnownKeys() {
        const set = new Set();
        for (const item of searchIndex) {
            const c = item.coords || [];
            const k = favKeyOf(item.type, item.properties, c[0], c[1]);
            if (k) set.add(k);
        }
        return set;
    }
    function renderBackupImport() {
        const st = backupImportState;
        if (!st) return;
        const src = st.src;
        document.getElementById('backup-import-file').textContent = st.fileName;
        document.getElementById('backup-import-sources').innerHTML = st.sources.map((s, i) =>
            backupChip(s.kind === 'fav' ? `${s.label} ${s.keys.length.toLocaleString()}` : s.label,
                       src === s, false, `setBackupImportSrc(${i})`, s.color)).join('');
        const isFav = !!src && src.kind === 'fav';
        document.getElementById('backup-import-target-row').style.display = isFav ? '' : 'none';
        // 名前が空の枠は選べない（使わない枠の扱い。足しても一覧と地図に出ない）
        if (isFav) {
            document.getElementById('backup-import-targets').innerHTML = FAV_SLOTS.map(n =>
                backupChip(backupSlotLabel(n), st.slot === n, !favNameOf(n),
                           `setBackupImportSlot(${n})`, FAV_COLORS[n])).join('');
        }
        const lines = [];
        if (!src) {
            lines.push('ファイルの中から読み込むものを選んでください');
        } else if (!isFav) {
            lines.push('いまの表示設定を、このファイルの内容に置き換えます。お気に入りは変わりません',
                       '読み込むと画面を読み直します');
        } else {
            if (st.slot) {
                const have = src.keys.filter(k => favMarksOf(k).includes(st.slot)).length;
                lines.push(`「${attrEscape(favNameOf(st.slot))}」に ${(src.keys.length - have).toLocaleString()}件を追加します`
                    + (have ? `（${have.toLocaleString()}件はすでに入っています）` : ''));
            } else {
                lines.push('読み込み先の枠を選んでください');
            }
            if (src.missing) lines.push(`いまの地図に無い ${src.missing.toLocaleString()}件は飛ばします`);
            if (src.noId) lines.push(`id が空の ${src.noId.toLocaleString()}行は飛ばします`);
            lines.push('他の枠と表示設定は変わりません');
        }
        document.getElementById('backup-import-sum').innerHTML = lines.join('<br>');
        const go = document.getElementById('backup-import-go');
        go.disabled = !src || (isFav && !st.slot);
        go.textContent = isFav || !src ? '読み込む' : '置き換える';
    }
    function setBackupImportSrc(i) {
        const st = backupImportState;
        if (!st || !st.sources[i]) return;
        st.src = st.sources[i];
        renderBackupImport();
    }
    function setBackupImportSlot(n) {
        if (!backupImportState || !favNameOf(n)) return;
        backupImportState.slot = n;
        renderBackupImport();
    }
    function backupImportCancel() {
        backupImportState = null;
        document.getElementById('backup-import-box').style.display = 'none';
    }
    /* お気に入りは favUnmarkKeys と同じく、記録を全部書き換えてから保存と描き直しを1回だけ行う。
       先に同じ端末の別の画面が書いた分を取り込んでおく（取り込む前の印に足すと、そちらで付けた印を消してしまう）。
       足した項目の at は読み込んだ時刻にする。同期で他の端末と混ぜるときに新しいほうとして採られるように。 */
    function backupImportRun() {
        const st = backupImportState;
        if (!st || !st.src) return;
        const src = st.src;
        if (src.kind === 'settings') {
            if (!confirm('いまの表示設定を、このファイルの内容に置き換えます。\nお気に入りは変わりません。\n\nよろしいですか？')) return;
            Object.entries(src.data).forEach(([k, v]) => storeSet(k, v));
            backupImportCancel();
            showToast('読み込みました。画面を読み直します');
            setTimeout(() => location.reload(), 900);
            return;
        }
        const slot = st.slot;
        if (!FAV_SLOTS.includes(slot) || !favNameOf(slot)) return;
        favAbsorbStored();
        const at = Date.now();
        let n = 0;
        for (const key of src.keys) {
            const cur = favMarksOf(key);
            if (cur.includes(slot)) continue;
            favStore.items[key] = { mk: [...cur, slot].sort((a, b) => a - b), at };
            n++;
        }
        const name = favNameOf(slot);
        backupImportCancel();
        if (!n) { showToast(`「${name}」に足すものはありませんでした`); return; }
        saveFavStore();
        favRefreshAll();
        updateSheetFav();
        showToast(`「${name}」に ${n.toLocaleString()}件を追加しました`);
    }

