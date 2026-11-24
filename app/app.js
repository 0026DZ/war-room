(function () {
  'use strict';
  // Categories, ranks and refresh interval come from the user's config (state.cfg).
  var CATS = [], CAT = {}, RANKS = [], PER = 3, IMGS = [], timer = null, catKey = '';
  function catOf(id) { return CAT[id] || CATS[CATS.length - 1] || { id: id, label: String(id).toUpperCase(), color: '#9aa3af' }; }
  function cstyle(id) { return ' style="--c:' + catOf(id).color + '"'; }
  var PROMPT = 'Turn the tasks we just discussed into CSV. Output only the CSV, no commentary.\n' +
    'Header must be exactly: title,category,due,time,priority,repeat,notes\n' +
    '- category: one of {CATS}\n' +
    '- due: YYYY-MM-DD, or empty if there is no date\n' +
    '- time: 24-hour HH:MM, or empty\n' +
    '- priority: high / medium / low\n' +
    '- repeat: daily / weekdays / weekly / monthly, or empty for a one-off\n' +
    '- wrap any field that contains a comma in double quotes';

  var S = null, I = null, A = null, filter = 'all', tab = 'geo', loading = false, pathSel = 0;
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function addDays(n) { var d = new Date(); d.setDate(d.getDate() + n); return iso(d); }
  var DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  function fmtDay(s) { var d = new Date(s + 'T00:00:00'); return DOW[d.getDay()] + ' ' + pad(d.getMonth() + 1) + '/' + pad(d.getDate()); }
  function sortT(a, b) {
    return (a.due || '9999').localeCompare(b.due || '9999') || (a.time || '99').localeCompare(b.time || '99') ||
      (b.pri === 'high') - (a.pri === 'high');
  }
  function fmtPx(v) { return v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: v >= 10000 ? 0 : 2 }) : v.toFixed(2); }
  function pct(v) { return (v >= 0 ? '+' : '') + v.toFixed(2) + '%'; }
  function ago(ts) { if (!ts) return ''; var m = Math.max(0, Math.round((Date.now() - ts) / 60000)); return m < 60 ? m + 'm' : m < 1440 ? Math.round(m / 60) + 'h' : Math.round(m / 1440) + 'd'; }

  var toastT = null;
  function toast(msg) { var t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('on'); }, 2400); }

  function taskLi(t) {
    var late = !t.done && t.due && t.due < S.today;
    var when = t.due ? (t.due === S.today ? 'TODAY' : fmtDay(t.due)) + (t.time ? ' ' + t.time : '') : '';
    return '<li class="task' + (t.done ? ' done' : '') + '"' + cstyle(t.cat) + '>' +
      '<input class="check" type="checkbox" id="c-' + t.id + '" data-act="toggle" data-id="' + t.id + '"' + (t.done ? ' checked' : '') + '>' +
      '<div class="tmain"><span class="ttitle" data-rename="' + t.id + '" title="Double-click to rename">' + esc(t.title) + '</span><div class="meta">' +
      '<span class="cat">' + esc(catOf(t.cat).label) + '</span>' +
      (when ? '<span class="' + (late ? 'late' : '') + '">' + (late ? 'OVERDUE ' : '') + when + '</span>' : '') +
      (t.pri === 'high' ? '<span class="hi">PRIORITY</span>' : '') +
      (t.repeat ? '<span>↻ ' + t.repeat.toUpperCase() + '</span>' : '') +
      (t.done ? '<span>+' + (t.xp || 0) + ' XP</span>' : '') +
      (t.notes ? '<span>' + esc(t.notes) + '</span>' : '') +
      '</div></div><div class="acts">' +
      (t.done ? '' : '<button type="button" data-act="bump" data-id="' + t.id + '" title="Move to tomorrow">+1D</button>') +
      '<button type="button" data-act="del" data-id="' + t.id + '" aria-label="Delete ' + esc(t.title) + '">DEL</button></div></li>';
  }

  function renderTasks() {
    var all = S.tasks, lv = S.lv;
    var todayAll = all.filter(function (t) { return t.due && t.due <= S.today && (!t.done || t.doneOn === S.today || t.due === S.today); });
    var doneToday = todayAll.filter(function (t) { return t.done; }).length;
    var week = '';
    for (var i = 6; i >= 0; i--) week += '<i class="' + (S.days[addDays(-i)] > 0 ? 'on' : '') + '" title="' + addDays(-i) + '"></i>';
    $('operator').innerHTML =
      stageImg(lv.tier, 'thumb') +
      '<div><div class="rank">' + lv.rank + ' <span>' + lv.grade + '</span><em>LV ' + pad(lv.level) + ' · VIEW PATH ›</em></div><div class="xp"><i style="width:' + Math.round(lv.into / lv.need * 100) + '%"></i></div>' +
      '<div class="xpn">' + lv.into + ' / ' + lv.need + ' XP to level ' + pad(lv.level + 1) + ' · ' + S.xp + ' total</div></div>' +
      '<div><div class="stats"><div class="stat"><b>' + doneToday + '/' + todayAll.length + '</b><small>TODAY</small></div>' +
      '<div class="stat"><b>' + S.streak + '</b><small>DAY STREAK</small></div></div><div class="week">' + week + '</div></div>';

    var h = '<button type="button" class="chip" data-f="all" aria-pressed="' + (filter === 'all') + '">ALL <b>' + all.filter(function (t) { return !t.done; }).length + '</b></button>';
    CATS.forEach(function (c) {
      h += '<button type="button" class="chip" data-f="' + c.id + '" aria-pressed="' + (filter === c.id) + '"' + cstyle(c.id) + '><i class="dot"></i>' + esc(c.label) +
        ' <b>' + all.filter(function (t) { return !t.done && catOf(t.cat).id === c.id; }).length + '</b></button>';
    });
    $('chips').innerHTML = h;

    var vis = all.filter(function (t) { return filter === 'all' || catOf(t.cat).id === filter; });
    var tl = vis.filter(function (t) { return todayAll.indexOf(t) >= 0; }).sort(function (a, b) { return (a.done - b.done) || sortT(a, b); });
    var later = vis.filter(function (t) { return !t.done && t.due > S.today; }).sort(sortT);
    var none = vis.filter(function (t) { return !t.done && !t.due; });
    var doneN = all.filter(function (t) { return t.done; }).length;
    h = '<div class="grp"><span>TODAY · ' + fmtDay(S.today) + '</span><span>' + tl.filter(function (t) { return !t.done; }).length + ' OPEN</span></div>' +
      (tl.length ? '<ul class="list">' + tl.map(taskLi).join('') + '</ul>' : '<div class="empty">Nothing scheduled today.</div>');
    h += '<div class="grp"><span>UPCOMING</span><span>' + later.length + '</span></div>' +
      (later.length ? '<ul class="list">' + later.map(taskLi).join('') + '</ul>' : '<div class="empty">Clear.</div>');
    if (none.length) h += '<div class="grp"><span>UNSCHEDULED</span><span>' + none.length + '</span></div><ul class="list">' + none.map(taskLi).join('') + '</ul>';
    if (doneN) h += '<div class="foot"><button type="button" class="key" data-act="archive">ARCHIVE ' + doneN + ' COMPLETED</button></div>';
    $('queue').innerHTML = h;

    var segs = document.querySelectorAll('.seg button');
    for (var k = 0; k < segs.length; k++) segs[k].setAttribute('aria-pressed', String(segs[k].dataset.lang === S.lang));
    $('mode').textContent = S.desktop ? 'WINDOW MODE' : 'DESKTOP MODE';
    $('hide').hidden = !S.desktop;

    var last = S.log && S.log[0];
    $('intake').innerHTML = '<div class="eyebrow"><span>INTAKE</span><b>' + (A && A.ok ? 'AGENT API 127.0.0.1:' + A.port : 'CSV') + '</b></div>' +
      '<div class="drop"><span>Drop a CSV on this window, or save it into the inbox folder.</span>' +
      '<div><button type="button" class="key" data-do="pick">CHOOSE FILE</button><button type="button" class="key" data-do="inbox">OPEN INBOX</button>' +
      '<button type="button" class="key" data-do="prompt">COPY AI PROMPT</button><button type="button" class="key" data-do="agent">COPY AGENT SETUP</button>' +
      '<button type="button" class="key" data-do="export">EXPORT CSV</button><button type="button" class="key" data-do="config">SETTINGS FILE</button></div></div>' +
      (S.cfgError ? '<div class="log late">' + esc(S.cfgError) + '</div>' : '') +
      '<div class="path">' + esc(S.inbox || '') + '</div>' +
      (last ? '<div class="log">Last intake · ' + esc(last.msg) + ' · ' + ago(last.at) + ' ago</div>' : '');
    if (!$('path').hidden) renderPath();
  }

  // Hourly candlesticks over the past week, drawn to one price scale (low..high of the week).
  function candles(cs, lo, hi) {
    var W = 300, H = 84;
    if (!cs || !cs.length) return '<svg class="candles" viewBox="0 0 ' + W + ' ' + H + '" aria-hidden="true"></svg>';
    var span = (hi - lo) || 1, step = W / cs.length, bw = Math.max(0.8, step * 0.62), out = '';
    var y = function (v) { return (3 + (hi - v) / span * (H - 6)).toFixed(1); };
    for (var g = 1; g < 4; g++) out += '<line x1="0" x2="' + W + '" y1="' + (H * g / 4) + '" y2="' + (H * g / 4) + '" stroke="var(--line)" stroke-width="1"/>';
    for (var i = 0; i < cs.length; i++) {
      var c = cs[i], up = c[3] >= c[0], col = up ? 'var(--up)' : 'var(--down)', cx = (i + 0.5) * step;
      var top = +y(Math.max(c[0], c[3])), bot = +y(Math.min(c[0], c[3]));
      out += '<line x1="' + cx.toFixed(1) + '" x2="' + cx.toFixed(1) + '" y1="' + y(c[1]) + '" y2="' + y(c[2]) + '" stroke="' + col + '" stroke-width="1" vector-effect="non-scaling-stroke"/>' +
        '<rect x="' + (cx - bw / 2).toFixed(1) + '" y="' + top + '" width="' + bw.toFixed(1) + '" height="' + Math.max(0.8, bot - top).toFixed(1) + '" fill="' + col + '"/>';
    }
    return '<svg class="candles" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true">' + out + '</svg>';
  }

  function renderIntel() {
    var ms = I ? I.markets : [{ label: '···' }, { label: '···' }, { label: '···' }];
    $('markets').innerHTML = ms.map(function (m) {
      var body;
      if (!I) body = '<div class="pxrow"><span class="px dim">······</span><span class="chg dim">loading</span></div>' + candles() + '<div class="sub"><span>&nbsp;</span></div>';
      else if (!m.ok) body = '<div class="pxrow"><span class="px dim">—</span><span class="chg dim">no data</span></div>' + candles() + '<div class="sub"><span>Source unreachable</span></div>';
      else {
        var up = m.chg >= 0, has = m.candles && m.candles.length;
        body = '<div class="pxrow"><span class="px">' + fmtPx(m.price) + '</span><span class="chg ' + (up ? 'up' : 'down') + '">' + (up ? '▲ ' : '▼ ') + pct(m.chg) + ' 1D</span></div>' +
          candles(m.candles, m.lo, m.hi) +
          '<div class="sub">' + (has ? '<span>H ' + fmtPx(m.hi) + ' · L ' + fmtPx(m.lo) + '</span><span class="' + (m.wk >= 0 ? 'up' : 'down') + '">' + pct(m.wk) + ' 1W</span>' : '<span>Chart unavailable</span>') + '</div>';
      }
      return '<div class="tile"><div class="eyebrow"><span>' + m.label + '</span><b>' + esc(m.sub || '') + (I && m.ok && m.candles.length ? ' · 1W/1H' : '') + '</b></div>' + body + '</div>';
    }).join('');
    renderTape();
    renderBias();

    var topics = I ? I.news : [];
    if (topics.length && !topics.some(function (t) { return t.id === tab; })) tab = topics[0].id;
    var cur = topics.filter(function (t) { return t.id === tab; })[0];
    var h = '<div class="eyebrow"><span>INTEL FEED</span><div class="tabs" role="tablist">';
    topics.forEach(function (t) { h += '<button type="button" role="tab" data-tab="' + t.id + '" aria-selected="' + (t.id === tab) + '">' + esc(t.label) + '</button>'; });
    h += '</div></div>';
    h += '<form class="kw" id="kwf"><input type="text" id="kw" placeholder="Track a keyword, e.g. Taiwan Strait, Fed rate cut, 美伊谈判" aria-label="New keyword to track" maxlength="80">' +
      '<button type="submit" class="key">+ TRACK</button>' + (cur && cur.custom ? '<button type="button" class="key" data-untrack="' + cur.id + '">REMOVE THIS TAB</button>' : '') + '</form>';
    if (!I) h += '<div class="empty">Connecting…</div>';
    else if (!cur || !cur.ok) h += '<div class="empty">Feed unreachable. Check the connection, then press REFRESH.</div>';
    else if (!cur.items.length) h += '<div class="empty">No headlines for this keyword in the last 48 hours.</div>';
    else h += '<ul class="news">' + cur.items.map(function (n) {
      return '<li><button type="button" data-url="' + esc(n.link) + '"><time>' + ago(n.ts) + '</time><span><span class="h">' + esc(n.title) + '</span><span class="s">' + esc(n.source).toUpperCase() + '</span></span></button></li>';
    }).join('') + '</ul>';
    var typed = $('kw') ? $('kw').value : '', focused = document.activeElement && document.activeElement.id === 'kw';
    $('intel').innerHTML = h;
    if (typed) $('kw').value = typed;
    if (focused) $('kw').focus();
    $('sync').textContent = loading ? 'SYNCING' : I ? 'SYNCED ' + new Date(I.at).toTimeString().slice(0, 5) + ' · EVERY ' + (S ? S.cfg.refreshMinutes : 60) + 'M' : '';
  }

  function renderBias() {
    $('bias').hidden = !(S && S.cfg.bias);
    if ($('bias').hidden) return;
    if (!I) { $('bias').innerHTML = '<div class="brow"><span class="blab">NASDAQ BIAS</span><span class="dim">loading</span></div>'; return; }
    var s = I.sentiment || { bias: 'NEUTRAL' }, cls = s.bias === 'BULLISH' ? 'up' : s.bias === 'BEARISH' ? 'down' : '';
    var h = '<div class="brow"><span class="blab">NASDAQ BIAS</span><b class="bias ' + cls + '">' + s.bias + '</b>';
    h += I.poly ? '<button type="button" class="bitem" data-url="' + esc(I.poly.url) + '" title="Open on Polymarket"><i>POLYMARKET · NDX ' + I.poly.day + '</i><b>' + Math.round(I.poly.up) + '% UP</b><b class="dim">' + Math.round(100 - I.poly.up) + '% DOWN</b></button>'
      : '<span class="bitem"><i>POLYMARKET</i><b class="dim">no open NDX market</b></span>';
    if (I.vix) h += '<span class="bitem"><i>VIX</i><b>' + I.vix.price.toFixed(2) + '</b><b>' + s.mood + '</b><b class="' + (I.vix.chg >= 0 ? 'down' : 'up') + '">' + pct(I.vix.chg) + '</b></span>';
    h += '</div>';
    if (I.hot && I.hot.length) {
      h += '<div class="brow"><span class="blab">HOT SECTORS · 5D</span>' + I.hot.map(function (x) {
        return '<span class="bitem"><i>' + esc(x.label) + '</i><b class="' + (x.chg5 >= 0 ? 'up' : 'down') + '">' + pct(x.chg5) + '</b></span>';
      }).join('') + (I.cold ? '<span class="bitem"><i>WEAKEST · ' + esc(I.cold.label) + '</i><b class="' + (I.cold.chg5 >= 0 ? 'up' : 'down') + '">' + pct(I.cold.chg5) + '</b></span>' : '') + '</div>';
    }
    $('bias').innerHTML = h;
  }

  // Scrolling tape. Rebuilt only when new data arrives, so switching tabs does not restart the scroll.
  var tapeAt = 0;
  function renderTape() {
    if (!I || I.at === tapeAt) return;
    tapeAt = I.at;
    var rows = I.tape || [];
    if (!rows.length) { $('tape').innerHTML = ''; return; }
    var run = (I.hot || []).map(function (x) {
      return '<span><i class="hot">HOT · ' + esc(x.label) + '</i><b class="' + (x.chg5 >= 0 ? 'up' : 'down') + '">' + pct(x.chg5) + ' 5D</b></span>';
    }).join('') + rows.map(function (m) {
      return '<span><i>' + esc(m.label) + '</i><b>' + fmtPx(m.price) + '</b><b class="' + (m.chg >= 0 ? 'up' : 'down') + '">' + (m.chg >= 0 ? '▲' : '▼') + ' ' + pct(m.chg) + '</b></span>';
    }).join('');
    // Two identical runs side by side; the track slides left by exactly one run, then loops.
    $('tape').innerHTML = '<div class="track" style="animation-duration:' + (rows.length + 3) * 3 + 's"><div class="run">' + run + '</div><div class="run" aria-hidden="true">' + run + '</div></div>';
  }

  function loadIntel(force) {
    loading = true; renderIntel();
    window.desk.intel(force).then(function (r) { I = r; }).catch(function () { }).then(function () { loading = false; renderIntel(); });
  }

  function renderPath() {
    var lv = S.lv;
    if (pathSel > lv.tier) pathSel = lv.tier;
    var h = '<div class="phead"><div class="rank">THE PATH <span>' + lv.rank + ' ' + lv.grade + '</span><em>LV ' + pad(lv.level) + ' · ' + S.xp + ' XP</em></div>' +
      '<button type="button" class="key" data-do="pathdir">ADD YOUR IMAGES</button><button type="button" class="key" data-do="back">‹ BACK (ESC)</button></div>' +
      '<div class="hero">' + stageImg(pathSel, 'big') + '<div class="cap">STAGE ' + pad(pathSel + 1) + ' · ' + RANKS[pathSel] + (pathSel === lv.tier ? ' · CURRENT' : '') + '</div></div><div class="stages">';
    for (var i = 0; i < RANKS.length; i++) {
      var open = i <= lv.tier, need = PER * i + 1;
      h += '<button type="button" class="stage ' + (open ? 'open' : 'locked') + (i === pathSel ? ' sel' : '') + '" ' + (open ? 'data-stage="' + i + '"' : 'disabled') + '>' +
        stageImg(i, 'sm') + (open ? '' : '<span class="lock">LOCKED</span>') +
        '<span class="lab"><b>' + pad(i + 1) + ' ' + esc(RANKS[i]) + '</b><span>LV ' + pad(need) + '</span></span></button>';
    }
    $('path').innerHTML = h + '</div>' + (IMGS.some(Boolean) ? '' : '<div class="log">No images yet. Put stage-1.jpg … stage-' + RANKS.length + '.jpg (or .png) in ' + esc(S.pathDir || '') + '</div>');
    $('path').querySelector('.stages').style.gridTemplateColumns = 'repeat(' + RANKS.length + ',minmax(0,1fr))';
  }
  // A stage picture: the user's own image if they added one, otherwise a numbered placeholder.
  function stageImg(i, cls) {
    return IMGS[i] ? '<img class="' + cls + '" src="' + IMGS[i] + '" alt="Stage ' + (i + 1) + '">' : '<span class="ph ' + cls + '">' + pad(i + 1) + '</span>';
  }
  function loadImages() { window.desk.pathImages().then(function (a) { IMGS = a || []; if (S) renderTasks(); }); }
  function useConfig(c) {
    CATS = c.categories; CAT = {}; CATS.forEach(function (x) { CAT[x.id] = x; });
    RANKS = c.ranks.map(function (r) { return String(r).toUpperCase(); }); PER = c.levelsPerStage;
    var key = JSON.stringify(CATS);
    if (key !== catKey) { catKey = key; $('n-cat').innerHTML = CATS.map(function (x) { return '<option value="' + esc(x.id) + '">' + esc(x.label) + '</option>'; }).join(''); }
    if (filter !== 'all' && !CAT[filter]) filter = 'all';
    var ms = c.refreshMinutes * 60000;
    if (!timer || timer.ms !== ms) { if (timer) clearInterval(timer.id); timer = { ms: ms, id: setInterval(function () { loadIntel(true); }, ms) }; }
  }
  function openPath(on) { $('path').hidden = !on; if (on) { pathSel = S.lv.tier; renderPath(); } }

  function apply(s, before) {
    var first = !S;
    S = s; useConfig(s.cfg); renderTasks();
    if (!first && before && JSON.stringify(before.cfg) !== JSON.stringify(s.cfg)) { loadImages(); loadIntel(true); toast('SETTINGS RELOADED'); }
    if (before && s.xp > before.xp) {
      toast(s.lv.tier > before.lv.tier ? 'NEW STAGE UNLOCKED · ' + s.lv.rank : s.lv.level > before.lv.level ? 'LEVEL ' + pad(s.lv.level) + ' · ' + s.lv.rank + ' ' + s.lv.grade : '+' + (s.xp - before.xp) + ' XP');
    }
    if (s.result) toast(s.result.added ? s.result.added + ' TASKS IMPORTED' + (s.result.skipped ? ' · ' + s.result.skipped + ' SKIPPED' : '') : 'NOTHING IMPORTED · CHECK THE HEADER ROW');
  }
  function act(type, payload) { var before = S; return window.desk.act(type, payload).then(function (s) { apply(s, before); }); }

  function copy(text, label) {
    var ok = function () { toast(label + ' COPIED'); };
    var fallback = function () {
      var ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); ok(); } catch (e) { toast('COPY FAILED'); }
      ta.remove();
    };
    try { navigator.clipboard.writeText(text).then(ok, fallback); } catch (e) { fallback(); }
  }
  function agentSetup() {
    if (!A || !A.ok) return 'War Room agent API is not running (port ' + (A ? A.port : '') + ' may be in use). Agents can still write CSV files into: ' + S.inbox;
    var base = 'http://127.0.0.1:' + A.port;
    return 'War Room task API (local only). Send header  Authorization: Bearer ' + A.token + '\n' +
      'GET  ' + base + '/tasks                 list tasks, level and XP\n' +
      'POST ' + base + '/tasks                 JSON task or array: {"title","category","due","time","priority","repeat","notes"}\n' +
      'POST ' + base + '/import                body = CSV text with header title,category,due,time,priority,repeat,notes\n' +
      'POST ' + base + '/tasks/{id}/done       mark a task complete\n' +
      'DELETE ' + base + '/tasks/{id}          remove a task\n' +
      'category: ' + CATS.map(function (c) { return c.id; }).join('|') + '. due: YYYY-MM-DD. time: HH:MM. priority: high|medium|low. repeat: daily|weekdays|weekly|monthly.\n' +
      'No HTTP access? Write a CSV file with the same header into: ' + S.inbox;
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.id === 'operator') openPath(true);
    else if (b.dataset.stage) { pathSel = +b.dataset.stage; renderPath(); }
    else if (b.dataset.f) { filter = b.dataset.f; renderTasks(); }
    else if (b.dataset.tab) { tab = b.dataset.tab; renderIntel(); }
    else if (b.dataset.url) window.desk.open(b.dataset.url);
    else if (b.dataset.untrack) act('topicDel', { id: b.dataset.untrack }).then(function () { tab = 'geo'; loadIntel(true); });
    else if (b.dataset.lang) act('lang', { lang: b.dataset.lang }).then(function () { I = null; loadIntel(true); });
    else if (b.id === 'refresh') loadIntel(true);
    else if (b.id === 'mode') window.desk.mode();
    else if (b.id === 'hide') window.desk.hide();
    else if (b.id === 'quit') window.desk.quit();
    else if (b.dataset.do === 'back') openPath(false);
    else if (b.dataset.do === 'inbox') window.desk.openDir('inbox');
    else if (b.dataset.do === 'pathdir') window.desk.openDir('path');
    else if (b.dataset.do === 'config') window.desk.openDir('config');
    else if (b.dataset.do === 'export') window.desk.exportCsv().then(function (ok) { if (ok) toast('TASKS EXPORTED'); });
    else if (b.dataset.do === 'prompt') copy(PROMPT.replace('{CATS}', CATS.map(function (c) { return c.id; }).join(' / ')), 'PROMPT');
    else if (b.dataset.do === 'agent') copy(agentSetup(), 'AGENT SETUP');
    else if (b.dataset.do === 'pick') { var before = S; window.desk.pick().then(function (s) { apply(s, before); }); }
    else if (b.dataset.act) act(b.dataset.act, { id: b.dataset.id });
  });
  // Double-click a title to rename it in place. Enter saves, Escape cancels.
  document.addEventListener('dblclick', function (e) {
    var el = e.target.closest('[data-rename]'); if (!el || el.isContentEditable) return;
    var id = el.dataset.rename, old = el.textContent;
    el.contentEditable = 'plaintext-only'; el.focus();
    var finish = function (save) {
      el.removeEventListener('blur', onBlur); el.removeEventListener('keydown', onKey);
      var v = el.textContent.trim();
      if (save && v && v !== old) act('rename', { id: id, title: v }); else { el.textContent = old; el.contentEditable = 'false'; }
    };
    var onBlur = function () { finish(true); };
    var onKey = function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); finish(true); } else if (ev.key === 'Escape') { ev.stopPropagation(); finish(false); } };
    el.addEventListener('blur', onBlur); el.addEventListener('keydown', onKey);
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('path').hidden) openPath(false); });
  document.addEventListener('change', function (e) { if (e.target.dataset.act === 'toggle') act('toggle', { id: e.target.dataset.id }); });
  document.addEventListener('submit', function (e) {
    e.preventDefault();
    if (e.target.id === 'addf') {
      var title = $('n-title').value.trim(); if (!title) return;
      act('add', { title: title, cat: $('n-cat').value, due: $('n-due').value, time: $('n-time').value, pri: $('n-pri').value, repeat: $('n-rep').value }).then(function () { $('n-title').value = ''; $('n-title').focus(); });
    } else if (e.target.id === 'kwf') {
      var q = $('kw').value.trim(); if (!q) return;
      $('kw').value = '';
      var n = S.topics.length;
      act('topicAdd', { q: q }).then(function () {
        if (S.topics.length === n) return toast(n >= 8 ? 'LIMIT IS 8 KEYWORDS · REMOVE ONE FIRST' : 'ALREADY TRACKED');
        tab = S.topics[S.topics.length - 1].id; loadIntel(true);
      });
    }
  });
  window.addEventListener('dragover', function (e) { e.preventDefault(); document.body.classList.add('over'); });
  window.addEventListener('dragleave', function (e) { if (!e.relatedTarget) document.body.classList.remove('over'); });
  window.addEventListener('drop', function (e) {
    e.preventDefault(); document.body.classList.remove('over');
    var files = e.dataTransfer ? e.dataTransfer.files : [];
    Array.prototype.forEach.call(files, function (f) {
      var r = new FileReader();
      r.onload = function () { act('import', { text: String(r.result), name: f.name }); };
      r.onerror = function () { toast('COULD NOT READ ' + f.name); };
      r.readAsText(f);
    });
  });

  function tick() {
    var d = new Date();
    $('ck-local').textContent = d.toTimeString().slice(0, 8);
    $('ck-utc').textContent = d.toISOString().slice(11, 19);
    $('date').textContent = iso(d) + ' ' + DOW[d.getDay()];
    if (S && S.today !== iso(d)) window.desk.state().then(function (s) { apply(s); }); // day rolled over
  }

  $('n-due').value = iso(new Date());
  window.desk.onState(function (s) { var before = S; apply(s, before); });
  window.desk.state().then(function (s) {
    apply(s); loadIntel(false); loadImages();
    window.desk.agent().then(function (a) { A = a; renderTasks(); });
  });
  renderIntel(); tick();
  setInterval(tick, 1000);
})();
