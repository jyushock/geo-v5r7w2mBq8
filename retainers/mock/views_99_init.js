/* タブ構築と遅延描画 */
(function(){
  const m = DATA.meta;
  document.getElementById('meta').innerHTML =
    '対象：<b>' + m.count + '名</b>（infobox「主君」に各家の当主が記載された人物）　' +
    '出典：日本語版ウィキペディア　取得：<b>' + esc(m.generatedAt.slice(0, 10)) + '</b>　' +
    '表現案 <b>' + VIEWS.length + '種</b>';
  document.getElementById('footmeta').innerHTML =
    '　収集条件：infobox「主君」に各家の当主を挙げる人物と、その家臣（主従を3段まで）。' +
    '　各人物のリビジョンIDは data/retainers.json の revid に入っています。';

  const main = document.getElementById('main'), tabs = document.getElementById('tabs');
  const warn = document.createElement('div');
  warn.className = 'warn';
  warn.innerHTML = '<b>データの前提</b>　主従関係は Wikipedia の infobox「主君」欄のみを機械的に読んだものです。' +
    '記事が無い家臣は載らず、寄親寄子の階層・仕えた年・移籍年はデータとして存在しません。' +
    '生没年は ' + P.filter(p => p.b && p.d).length + ' 名のみ両方そろっています。人数の多寡を史実の勢力比として読まないでください。';
  main.appendChild(warn);

  const secs = [];
  VIEWS.forEach((v, i) => {
    const b = document.createElement('button');
    b.innerHTML = '<span class="num">' + (i + 1) + '</span>' + esc(v.title.replace(/（.*$/, ''));
    b.onclick = () => show(i);
    tabs.appendChild(b);

    const sec = document.createElement('section');
    sec.className = 'view';
    sec.innerHTML = '<div class="vhead"><div><h2>' + esc(v.title) + '</h2><p>' + v.desc + '</p></div>' +
      '<div class="tags">' + (v.tags || []).join('') + '</div></div><div class="host"></div>';
    main.appendChild(sec);
    secs.push({ sec, v, done: false });
  });

  function show(i){
    tabs.querySelectorAll('button').forEach((b, j) => b.classList.toggle('on', i === j));
    secs.forEach((s, j) => s.sec.classList.toggle('on', i === j));
    const s = secs[i];
    if (!s.done){
      s.done = true;
      const host = s.sec.querySelector('.host');
      try { s.v.render(host); }
      catch (err){ host.innerHTML = '<div class="warn">描画に失敗しました：' + esc(err.message) + '</div>'; console.error(err); }
    }
    location.hash = s.v.id;
  }
  const want = VIEWS.findIndex(v => v.id === location.hash.slice(1));
  show(want >= 0 ? want : 0);
})();
