/* Token Launch Radar v14 — static page, no network, no framework.
   Reads window.RADAR (written by main.ts from the sealed snapshot). */
(function () {
  'use strict';
  var R = window.RADAR;
  if (!R) { document.getElementById('meta').textContent = 'No data: data.js is missing.'; return; }
  var rows = R.rows, live = R.live, fit = R.fit, val = R.validation;
  var watchSet = new Set(R.watchlist || []);
  var pinned = new Set();
  var sortKey = 'rank', sortDir = 1;

  function $(id) { return document.getElementById(id); }
  function money(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function moneyFull(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
  function pct(v) { return v === null || v === undefined ? '—' : (v >= 0 ? '+' : '') + v.toFixed(1) + '%'; }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  /* Header + validation strip (model tested, not asserted). */
  $('meta').textContent = 'Snapshot ' + R.as_of + ' · ' + R.board_size + ' pre-token protocols ranked · ' +
    R.watchlist_size + ' on the watchlist · model ' + R.model_version;
  $('stripText').textContent = 'Leave-one-out median error ' + val.loo_med_log + ' in log terms (' +
    val.loo_med_x + 'x, ' + val.loo_within3_pct + '% within 3x); walk-forward ' + val.wf_med_log +
    ' (' + val.wf_med_x + 'x, ' + val.wf_within3_pct + '% within 3x) on ' + val.fit_n +
    ' traded protocols. Fitted growth slope ' + fit.beta + ', age slope ' + fit.gamma.toFixed(2) +
    ', residual spread ' + fit.sigma.toFixed(2) + '. Every row below carries its own 90% interval.' +
    ' Every verdict is costed at $/hour.';
  $('foot').textContent = 'Source: ' + R.source + '. Implied values are this entry\u2019s own claim from the snapshot\u2019s figures, never a promise a token is issued. Farm economics assume a 2% farmer pool and TVL / $2,500 farmers.';

  /* Chain filter options. */
  var chains = {};
  rows.forEach(function (r) { r.chains.forEach(function (c) { chains[c] = 1; }); });
  Object.keys(chains).sort().forEach(function (c) {
    var o = document.createElement('option'); o.value = c; o.textContent = c; $('chainFilter').appendChild(o);
  });

  function filtered() {
    var q = $('q').value.trim().toLowerCase();
    var ch = $('chainFilter').value, vd = $('verdictFilter').value, wo = $('watchOnly').checked;
    return rows.filter(function (r) {
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.indexOf(q) < 0) return false;
      if (ch && r.chains.indexOf(ch) < 0) return false;
      if (vd && r.verdict !== vd) return false;
      if (wo && !watchSet.has(r.slug)) return false;
      return true;
    });
  }

  function sortRows(list) {
    var k = sortKey, d = sortDir;
    return list.slice().sort(function (a, b) {
      var x = a[k], y = b[k];
      if (x === null || x === undefined) x = '';
      if (y === null || y === undefined) y = '';
      var c = (typeof x === 'number' && typeof y === 'number') ? x - y : String(x).localeCompare(String(y));
      return c * d;
    });
  }

  function shortChains(chains) {
    if (chains.length <= 2) return chains.join(', ');
    return chains.slice(0, 2).join(', ') + ' +' + (chains.length - 2);
  }

  function renderBoard() {
    var list = sortRows(filtered());
    $('count').textContent = list.length + ' of ' + rows.length + ' rows';
    var tb = $('rows'); tb.innerHTML = '';
    list.forEach(function (r) {
      var tr = document.createElement('tr');
      if (pinned.has(r.slug)) tr.className = 'pinned-row';
      tr.dataset.slug = r.slug;
      var chg = r.change_7d === null ? '—' : pct(r.change_7d);
      var chgCls = r.change_7d === null ? '' : (r.change_7d >= 0 ? 'pos' : 'neg');
      tr.innerHTML = '<td class="num">' + r.rank + '</td>' +
        '<td><strong>' + esc(r.name) + '</strong>' + (watchSet.has(r.slug) ? ' <span class="badge watch">WATCH</span>' : '') + '<br><span class="mono" style="color:var(--muted)">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td>' + esc(shortChains(r.chains) || '—') + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num ' + chgCls + '">' + chg + '</td>' +
        '<td class="num" title="90% interval ' + moneyFull(r.implied_low_usd) + ' – ' + moneyFull(r.implied_high_usd) + '">' + money(r.implied_value_usd) + '</td>' +
        '<td class="num">$' + r.usd_per_hour.toFixed(2) + '</td>' +
        '<td><span class="badge ' + r.verdict + '">' + r.verdict + '</span></td>' +
        '<td><button type="button" class="pin-btn' + (pinned.has(r.slug) ? ' on' : '') + '" data-pin="' + esc(r.slug) + '" title="Pin to tray">' + (pinned.has(r.slug) ? '★' : '☆') + '</button></td>';
      tr.addEventListener('click', function (e) {
        if (e.target.closest('[data-pin]')) return;
        openDetail(r.slug);
      });
      tb.appendChild(tr);
    });
    renderTray();
  }

  function renderTray() {
    var tray = $('tray');
    if (pinned.size === 0) { tray.hidden = true; return; }
    tray.hidden = false;
    var box = $('trayItems'); box.innerHTML = '';
    pinned.forEach(function (slug) {
      var r = rows.find(function (x) { return x.slug === slug; });
      if (!r) return;
      var s = document.createElement('span');
      s.className = 'chip'; s.textContent = '#' + r.rank + ' ' + r.name;
      s.addEventListener('click', function () { openDetail(slug); });
      box.appendChild(s);
    });
    var cmp = document.getElementById('trayCompare');
    if (!cmp) {
      cmp = document.createElement('button');
      cmp.id = 'trayCompare'; cmp.type = 'button'; cmp.textContent = 'Compare';
      cmp.addEventListener('click', openCompare);
      tray.appendChild(cmp);
    }
    cmp.disabled = pinned.size < 2;
    cmp.textContent = 'Compare (' + pinned.size + ')';
  }
  $('trayClear').addEventListener('click', function () { pinned.clear(); renderBoard(); });

  document.querySelectorAll('#board th[data-sort]').forEach(function (th) {
    th.addEventListener('click', function () {
      var k = th.dataset.sort;
      if (sortKey === k) sortDir = -sortDir;
      else { sortKey = k; sortDir = (k === 'rank') ? 1 : -1; }
      document.querySelectorAll('#board th').forEach(function (h) { h.classList.remove('sorted-asc', 'sorted-desc'); });
      th.classList.add(sortDir === 1 ? 'sorted-asc' : 'sorted-desc');
      renderBoard();
    });
  });

  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-pin]');
    if (!b) return;
    e.stopPropagation();
    var slug = b.dataset.pin;
    if (pinned.has(slug)) pinned.delete(slug); else pinned.add(slug);
    renderBoard();
  });
  ['q', 'chainFilter', 'verdictFilter', 'watchOnly'].forEach(function (id) {
    $(id).addEventListener('input', renderBoard);
  });

  /* Detail view. */
  function openDetail(slug) {
    var r = rows.find(function (x) { return x.slug === slug; });
    if (!r) return;
    var steps = r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    $('detailBody').innerHTML =
      '<h2>#' + r.rank + ' ' + esc(r.name) + '</h2>' +
      '<p>' + esc(r.category || 'Uncategorized') + ' · ' + esc(r.chains.join(', ') || 'no chain listed') +
      (watchSet.has(r.slug) ? ' · <span class="badge watch">WATCHLIST</span>' : '') + '</p>' +
      '<dl class="kv">' +
      '<dt>Implied value</dt><dd>' + moneyFull(r.implied_value_usd) + '</dd>' +
      '<dt>90% interval</dt><dd>' + moneyFull(r.implied_low_usd) + ' – ' + moneyFull(r.implied_high_usd) + '</dd>' +
      '<dt>TVL</dt><dd>' + moneyFull(r.tvl_usd) + '</dd>' +
      '<dt>7-day growth</dt><dd>' + pct(r.change_7d) + '</dd>' +
      '<dt>Age</dt><dd>' + (r.age_days === null ? 'unknown' : r.age_days + ' days') + '</dd>' +
      '<dt>Token odds</dt><dd>' + (r.odds * 100).toFixed(0) + '% of protocols in this category record a token</dd>' +
      '<dt>Farm verdict</dt><dd>' + r.verdict + ' — about $' + r.usd_per_hour.toFixed(2) + '/hour, $' + r.expected_usd.toFixed(2) +
      ' expected per farmer over ' + r.hours + ' hours (' + r.farmers.toLocaleString('en-US') + ' farmers at TVL / $2,500)</dd>' +
      '</dl>' +
      '<p class="terms">Model terms (log ratio): curve <code>' + r.curve.toFixed(2) + '</code> + category <code>' +
      r.category_residual.toFixed(2) + '</code> + growth <code>' + r.growth_term.toFixed(2) + '</code> + age <code>' +
      r.age_term.toFixed(2) + '</code> + log odds <code>' + r.log_odds.toFixed(2) + '</code>. Fitted on ' +
      val.fit_n + ' traded protocols; leave-one-out median error ' + val.loo_med_x + 'x.</p>' +
      '<h3>Farm plan</h3><ol class="steps">' + steps + '</ol>';
    var d = $('detail');
    if (typeof d.showModal === 'function') d.showModal();
    history.replaceState(null, '', '#detail=' + slug);
  }
  $('detailClose').addEventListener('click', function () { $('detail').close(); history.replaceState(null, '', '#'); });
  $('detail').addEventListener('close', function () { if (location.hash.indexOf('#detail=') === 0) history.replaceState(null, '', '#'); });

  /* Compare dialog (pinned rows, up to 3). */
  function openCompare() {
    var sel = rows.filter(function (r) { return pinned.has(r.slug); }).slice(0, 3);
    if (sel.length < 2) return;
    var fields = [
      ['Rank', function (r) { return '#' + r.rank; }],
      ['Implied value', function (r) { return moneyFull(r.implied_value_usd); }],
      ['90% interval', function (r) { return money(r.implied_low_usd) + ' – ' + money(r.implied_high_usd); }],
      ['TVL', function (r) { return moneyFull(r.tvl_usd); }],
      ['7-day growth', function (r) { return pct(r.change_7d); }],
      ['$/hour', function (r) { return '$' + r.usd_per_hour.toFixed(2); }],
      ['Verdict', function (r) { return r.verdict; }],
      ['Chains', function (r) { return esc(r.chains.join(', ')); }]
    ];
    var h = '<div class="compare-grid"><span class="h"></span>' + sel.map(function (r) { return '<strong>' + esc(r.name) + '</strong>'; }).join('') +
      fields.map(function (f) {
        return '<span class="h">' + f[0] + '</span>' + sel.map(function (r) { return '<span class="v">' + f[1](r) + '</span>'; }).join('');
      }).join('') + '</div>';
    $('compareBody').innerHTML = h;
    $('compareDlg').showModal();
  }
  $('compareClose').addEventListener('click', function () { $('compareDlg').close(); });

  /* Live tab. */
  (function () {
    var tb = $('liveRows'); tb.innerHTML = '';
    live.forEach(function (p) {
      var tr = document.createElement('tr');
      tr.innerHTML = '<td><strong>' + esc(p.name) + '</strong></td><td>' + esc(p.category || '—') + '</td><td>' +
        esc(shortChains(p.chains) || '—') + '</td><td class="num">' + money(p.tvl_usd) + '</td><td class="num">' +
        money(p.mcap_usd || 0) + '</td><td class="num">' + pct(p.change_7d) + '</td>';
      tb.appendChild(tr);
    });
  })();

  /* Tabs. */
  document.querySelectorAll('.tab').forEach(function (t) {
    t.addEventListener('click', function () { switchTab(t.dataset.tab); });
  });
  function switchTab(name) {
    document.querySelectorAll('.tab').forEach(function (t) { t.classList.toggle('active', t.dataset.tab === name); });
    $('boardPane').hidden = name !== 'board';
    $('livePane').hidden = name !== 'live';
    $('sandboxPane').hidden = name !== 'sandbox';
    if (name === 'sandbox') renderSandbox();
  }

  /* Model sandbox: re-rank live from the fitted params. */
  function sandboxImplied(r, beta, gamma, poolPct) {
    var g = clampNum(r.change_7d === null ? 0 : r.change_7d, -60, 120) / 100;
    var age = Math.log1p((r.age_days === null ? 365 : r.age_days) / 365);
    var logRatio = r.curve + r.category_residual + beta * g + gamma * age + r.log_odds;
    var implied = Math.max(1, Math.round(r.tvl_usd * Math.exp(logRatio)));
    var farmers = Math.max(1, Math.round(r.tvl_usd / 2500));
    var hours = 1.4 + 0.7 * (60 / 60);
    var usdHr = ((implied * poolPct / 100) / farmers) / hours;
    return { implied: implied, usdHr: usdHr, verdict: usdHr >= 3 ? 'FARM' : (usdHr >= 1 ? 'THIN' : 'LEAN') };
  }
  function clampNum(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }
  function renderSandbox() {
    var beta = parseFloat($('beta').value), gamma = parseFloat($('gamma').value), pool = parseFloat($('pool').value);
    $('betaOut').textContent = beta.toFixed(2) + ' (fitted ' + fit.beta + ')';
    $('gammaOut').textContent = gamma.toFixed(2) + ' (fitted ' + fit.gamma + ')';
    $('poolOut').textContent = pool.toFixed(1) + '% (submitted 2%)';
    var scored = rows.map(function (r) {
      var s = sandboxImplied(r, beta, gamma, pool);
      return { r: r, implied: s.implied, usdHr: s.usdHr, verdict: s.verdict };
    }).sort(function (a, b) { return b.implied - a.implied; });
    var moved = 0;
    scored.forEach(function (s, i) { if (s.r.rank !== i + 1) moved++; });
    $('sandboxNote').textContent = 'Top 20 under these settings. ' + moved + ' of ' + rows.length +
      ' rows change rank vs the submitted board.';
    var tb = $('sandboxRows'); tb.innerHTML = '';
    scored.slice(0, 20).forEach(function (s, i) {
      var tr = document.createElement('tr');
      tr.innerHTML = '<td class="num">' + (i + 1) + ' <span style="color:var(--muted)">(was #' + s.r.rank + ')</span></td>' +
        '<td><strong>' + esc(s.r.name) + '</strong></td><td class="num">' + money(s.implied) + '</td>' +
        '<td class="num">$' + s.usdHr.toFixed(2) + '</td><td><span class="badge ' + s.verdict + '">' + s.verdict + '</span></td>';
      tb.appendChild(tr);
    });
  }
  ['beta', 'gamma', 'pool'].forEach(function (id) { $(id).addEventListener('input', renderSandbox); });
  $('sandboxReset').addEventListener('click', function () {
    $('beta').value = fit.beta; $('gamma').value = fit.gamma; $('pool').value = 2; renderSandbox();
  });

  /* CSV export. */
  function exportCsv() {
    var head = 'rank,slug,name,category,chains,tvl_usd,change_7d,implied_value_usd,implied_low_usd,implied_high_usd,usd_per_hour,verdict\n';
    var lines = filtered().map(function (r) {
      var cells = [r.rank, r.slug, r.name, r.category || '', r.chains.join(';'), r.tvl_usd,
        r.change_7d === null ? '' : r.change_7d, r.implied_value_usd, r.implied_low_usd, r.implied_high_usd,
        r.usd_per_hour, r.verdict];
      return cells.map(function (c) { var s = String(c); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(',');
    });
    var blob = new Blob([head + lines.join('\n') + '\n'], { type: 'text/csv' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'token-radar-board.csv'; a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }
  $('csvBtn').addEventListener('click', exportCsv);

  /* Command palette. */
  var paletteIdx = 0, paletteItems = [];
  function openPalette() {
    $('palette').showModal();
    $('paletteInput').value = '';
    paletteFilter('');
    $('paletteInput').focus();
  }
  function paletteFilter(q) {
    q = q.trim().toLowerCase();
    var cmds = [
      { label: 'Go to Live tokens tab', run: function () { switchTab('live'); } },
      { label: 'Go to Model sandbox', run: function () { switchTab('sandbox'); } },
      { label: 'Go to Board', run: function () { switchTab('board'); } },
      { label: 'Export board as CSV', run: exportCsv },
      { label: 'Compare pinned rows', run: openCompare },
      { label: 'Clear pinned rows', run: function () { pinned.clear(); renderBoard(); } }
    ];
    var items = [];
    if (q) {
      cmds.forEach(function (c) { if (c.label.toLowerCase().indexOf(q) >= 0) items.push(c); });
      rows.forEach(function (r) {
        if (items.length >= 12) return;
        if (r.name.toLowerCase().indexOf(q) >= 0 || r.slug.indexOf(q) >= 0) {
          items.push({ label: '#' + r.rank + ' ' + r.name + ' — ' + money(r.implied_value_usd), run: (function (slug) { return function () { openDetail(slug); }; })(r.slug) });
        }
      });
    } else {
      items = cmds.slice();
    }
    paletteItems = items; paletteIdx = 0;
    var ul = $('paletteList'); ul.innerHTML = '';
    items.forEach(function (it, i) {
      var li = document.createElement('li');
      li.textContent = it.label;
      if (i === 0) li.className = 'sel';
      li.addEventListener('click', function () { $('palette').close(); it.run(); });
      ul.appendChild(li);
    });
  }
  $('paletteBtn').addEventListener('click', openPalette);
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }
    if (e.key === 'Escape' && $('palette').open) $('palette').close();
  });
  $('paletteInput').addEventListener('input', function () { paletteFilter($('paletteInput').value); });
  $('paletteInput').addEventListener('keydown', function (e) {
    var items = $('paletteList').children;
    if (e.key === 'ArrowDown' && paletteIdx < items.length - 1) { paletteIdx++; }
    else if (e.key === 'ArrowUp' && paletteIdx > 0) { paletteIdx--; }
    else if (e.key === 'Enter' && paletteItems[paletteIdx]) { var it = paletteItems[paletteIdx]; $('palette').close(); it.run(); return; }
    else return;
    e.preventDefault();
    for (var i = 0; i < items.length; i++) items[i].classList.toggle('sel', i === paletteIdx);
  });

  /* Hash routing (also drives the three screenshots). */
  (function () {
    var h = location.hash;
    if (h.indexOf('#detail=') === 0) { openDetail(h.slice(8)); return; }
    if (h.indexOf('#tab=') === 0) { switchTab(h.slice(5)); return; }
    if (h.indexOf('#filter=') === 0) {
      var f = h.slice(8);
      if (f.indexOf('chain:') === 0) $('chainFilter').value = decodeURIComponent(f.slice(6));
      if (f.indexOf('verdict:') === 0) $('verdictFilter').value = f.slice(8);
      renderBoard();
    }
  })();

  renderBoard();
})();
