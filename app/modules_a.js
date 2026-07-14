/* AlphaLab UI shell: tabs, rail, command palette, ticker tape + core modules
   (dashboard, markets, chart workspace, data hub). */
'use strict';
const UI = window.UI = { tabs: [], active: null, seq: 0 };

/* ---------- module registry ---------- */
UI.MODULES = {};
UI.HIDDEN = new Set(['stratDetail', 'reportView', 'chart']);
UI.def = (id, name, ico, group, render) => { UI.MODULES[id] = { id, name, ico, group, render }; };

/* ---------- tab management ---------- */
UI.openTab = function (module, state = {}, title) {
  const m = UI.MODULES[module];
  if (!m) return;
  // reuse a same-module tab without pinned state
  const existing = UI.tabs.find(t => t.module === module && !state.forceNew && !t.state.pinned && JSON.stringify(t.state) === JSON.stringify(state));
  if (existing) { UI.switchTab(existing.id); return; }
  const tab = { id: 't' + (++UI.seq), module, state, title: title || m.name };
  UI.tabs.push(tab);
  UI.switchTab(tab.id);
};
UI.focusModule = function (module, state = {}, title) {
  const existing = UI.tabs.find(t => t.module === module);
  if (existing && !state.forceNew) {
    existing.state = { ...existing.state, ...state };
    if (title) existing.title = title;
    UI.switchTab(existing.id);
  } else UI.openTab(module, state, title);
};
UI.switchTab = function (id) {
  UI.active = id;
  UI.renderTabs();
  UI.renderActive();
};
UI.closeTab = function (id) {
  const i = UI.tabs.findIndex(t => t.id === id);
  if (i < 0) return;
  UI.tabs.splice(i, 1);
  if (UI.active === id) UI.active = UI.tabs.length ? UI.tabs[Math.max(0, i - 1)].id : null;
  UI.renderTabs();
  UI.renderActive();
};
UI.currentTab = () => UI.tabs.find(t => t.id === UI.active);

UI.renderTabs = function () {
  const el = document.getElementById('tabstrip');
  el.innerHTML = UI.tabs.map(t => {
    const m = UI.MODULES[t.module];
    return `<div class="tab ${t.id === UI.active ? 'active' : ''}" data-tab="${t.id}">
      <span>${m.ico}</span><span>${AL.fmt.esc(t.title)}</span><span class="x" data-close="${t.id}">×</span></div>`;
  }).join('') + `<div class="tab-new" title="New workspace tab (dashboard)">+</div>`;
  el.querySelectorAll('.tab').forEach(tb => tb.addEventListener('click', e => {
    if (e.target.dataset.close) { UI.closeTab(e.target.dataset.close); e.stopPropagation(); return; }
    UI.switchTab(tb.dataset.tab);
  }));
  el.querySelector('.tab-new').addEventListener('click', () => UI.openTab('dashboard', { forceNew: true }));
};
UI.renderActive = function () {
  const ws = document.getElementById('workspace');
  C.hideTip();
  const tab = UI.currentTab();
  document.querySelectorAll('.rail-item').forEach(r => r.classList.toggle('active', tab && r.dataset.mod === tab.module));
  if (!tab) { ws.innerHTML = '<div class="empty">No workspace open, press <b>Ctrl+K</b> or pick a module from the rail.</div>'; return; }
  ws.innerHTML = '';
  try { UI.MODULES[tab.module].render(ws, tab.state, tab); }
  catch (e) { console.error(e); ws.innerHTML = `<div class="empty">Module error: ${AL.fmt.esc(e.message)}</div>`; }
};

/* re-render helper that survives async work landing on a stale tab */
UI.stillActive = tab => UI.currentTab() === tab;

/* ---------- shell boot ---------- */
UI.boot = function () {
  AL.boot();
  document.getElementById('app').style.display = '';
  // rail
  const groups = {};
  for (const m of Object.values(UI.MODULES)) if (!UI.HIDDEN.has(m.id)) (groups[m.group] = groups[m.group] || []).push(m);
  // guide first so newcomers see it before anything intimidating
  const groupOrder = ['Start Here', 'Research OS', 'Advisory', 'Autonomous Research', 'Quant Toolkit', 'Firm', 'Portfolio & Risk', 'Knowledge'];
  const ordered = groupOrder.filter(g => groups[g]).map(g => [g, groups[g]])
    .concat(Object.entries(groups).filter(([g]) => !groupOrder.includes(g)));
  document.getElementById('rail').innerHTML = ordered.map(([g, mods]) =>
    `<div class="rail-group"><div class="rail-head">${g}</div>` +
    mods.map(m => `<div class="rail-item" data-mod="${m.id}"><span class="ico">${m.ico}</span>${m.name}</div>`).join('') + '</div>').join('');
  document.querySelectorAll('.rail-item').forEach(r => r.addEventListener('click', () => UI.focusModule(r.dataset.mod)));
  // topbar info
  document.getElementById('asof').innerHTML = `DATA AS-OF <b>${AL.asof}</b>`;
  setInterval(() => { document.getElementById('clock').textContent = new Date().toTimeString().slice(0, 8); }, 1000);
  UI.buildTape();
  UI.initPalette();
  UI.initCmd();
  AL.bus.on('res:update', () => {
    const led = document.getElementById('res-led');
    const st = document.getElementById('res-stat');
    if (RS.state.running) { led.className = 'led on'; st.textContent = RS.state.current ? RS.state.current.id + ' running' : 'researcher active'; }
    else { led.className = 'led idle'; st.textContent = 'researcher idle'; }
    const t = UI.currentTab();
    if (t && (t.module === 'researcher') && !RS.state.current) UI.renderActive();
  });
  // deep link: #module or #chart=SYM
  const hash = (location.hash || '').slice(1);
  if (hash.startsWith('chart=')) UI.openTab('chart', { sym: hash.slice(6).toUpperCase() });
  else if (hash.startsWith('strat=')) UI.openTab('stratDetail', { sid: hash.slice(6).toUpperCase() });
  else if (UI.MODULES[hash]) UI.openTab(hash);
  else UI.openTab('dashboard');
  if (hash === 'tour') { setTimeout(() => UI.startTour(), 300); return; }   // shareable tour link
  if (UI.showWelcome) UI.showWelcome();   // first-visit onboarding, defined in modules_d
  // fun: greet in feed
  RS.pushLog(`AlphaLab research OS online. ${Object.keys(AL.D.series).length + Object.keys(AL.D.crypto).length} instruments, ${Object.keys(AL.D.fred).length} macro series loaded (as-of ${AL.asof}).`, 'sys');
};

UI.buildTape = function () {
  const syms = ['SPY', 'QQQ', 'IWM', '^VIX', 'TLT', 'GLD', 'CL=F', 'EURUSD=X', 'BTC-USD', 'ETH-USD', 'NVDA', 'AAPL', 'MSFT', 'HYG', 'EEM', '^TNX'];
  const html = syms.map(s => {
    const lc = AL.lastClose(s);
    if (!lc) return '';
    const name = s.replace('=X', '').replace('=F', '').replace('^', '');
    return `<span class="tk">${name} <b>${AL.fmt.px(lc.last)}</b> <span class="${lc.chg >= 0 ? 'up' : 'dn'}">${AL.fmt.spct(lc.chg)}</span></span>`;
  }).join('');
  document.getElementById('tape').innerHTML = html + html;
};

/* ---------- command palette + terminal ---------- */
UI.commands = [
  { cmd: 'GO <module>', desc: 'Open module: DASH, MARKETS, DATA, AI, ALPHA, STRAT, ML, PORT, HOLD, RISK, REPORTS, KB', fn: a => UI.goCmd(a) },
  { cmd: 'CHART <sym>', desc: 'Open chart workspace, e.g. CHART NVDA', fn: a => a[0] && UI.openTab('chart', { sym: a[0].toUpperCase(), forceNew: true }, a[0].toUpperCase() + ' Chart') },
  { cmd: 'COMPARE <a> <b> …', desc: 'Indexed comparison chart of up to 4 symbols', fn: a => a.length >= 2 && UI.openTab('chart', { sym: a[0].toUpperCase(), compare: a.slice(1, 4).map(x => x.toUpperCase()), forceNew: true }, 'Compare') },
  { cmd: 'BT <strategy-id>', desc: 'Run backtest, e.g. BT S001', fn: a => a[0] && S.byId[a[0].toUpperCase()] && UI.openTab('stratDetail', { sid: a[0].toUpperCase(), forceNew: true }, S.byId[a[0].toUpperCase()].name) },
  { cmd: 'RESEARCH START', desc: 'Engage the autonomous AI researcher', fn: () => { RS.startAuto(); UI.focusModule('researcher'); } },
  { cmd: 'RESEARCH STOP', desc: 'Pause the autonomous researcher', fn: () => RS.stopAuto() },
  { cmd: 'FACTOR SCAN', desc: 'Generate & test 25 candidate alpha factors', fn: () => UI.focusModule('alpha', { autoscan: true }) },
  { cmd: 'STRESS <scenario>', desc: 'Risk lab crisis replay: 2008, COVID, DOTCOM, 1987, 2022', fn: a => UI.focusModule('risk', { scenario: (a[0] || '2008').toUpperCase() }) },
  { cmd: 'REGIME', desc: 'Show current detected market regime', fn: () => UI.focusModule('dashboard') },
  { cmd: 'DECIDE <sym>', desc: 'Full buy / sell / hold decision on a stock', fn: a => UI.focusModule('decision', a[0] ? { sym: a[0].toUpperCase() } : {}) },
  { cmd: 'SCREEN', desc: 'Fundamental screener (value, growth, quality, dividends)', fn: () => UI.focusModule('screener') },
  { cmd: 'PEERS <sym>', desc: 'Compare a stock to its sector peers on fundamentals', fn: a => UI.focusModule('peers', a[0] ? { sym: a[0].toUpperCase() } : {}) },
  { cmd: 'TOUR', desc: 'Start the interactive guided tutorial', fn: () => UI.startTour() },
  { cmd: 'ADVISE', desc: 'Open the Stock Advisor (multi-factor recommendations)', fn: () => UI.focusModule('advisor') },
  { cmd: 'SENTIMENT <sym>', desc: 'News tone, social sentiment & attention for a ticker', fn: a => UI.focusModule('sentiment', a[0] ? { sym: a[0].toUpperCase() } : {}) },
  { cmd: 'GUIDE', desc: 'Open the plain-English how-to guide', fn: () => UI.focusModule('guide') },
  { cmd: 'COMP', desc: 'Set up competition mode ($100K virtual cash)', fn: () => UI.focusModule('holdings', { wharton: true }) },
  { cmd: 'HELP', desc: 'List terminal commands', fn: () => UI.openPalette('') },
];
UI.goCmd = function (a) {
  const map = { DASH: 'dashboard', MARKETS: 'markets', DATA: 'datahub', AI: 'researcher', ALPHA: 'alpha', STRAT: 'strategies', ML: 'mllab', PORT: 'portfolio', HOLD: 'holdings', RISK: 'risk', REPORTS: 'reports', KB: 'knowledge', ENSEMBLE: 'ensemble', FIRM: 'firm', STRUCT: 'structure', COMPOSE: 'composer', SEASON: 'seasonality', DD: 'drawdowns', GUIDE: 'guide', DECIDE: 'decision', SCREEN: 'screener', PEERS: 'peers' };
  const m = map[(a[0] || '').toUpperCase()];
  if (m) UI.focusModule(m);
};
UI.execCommand = function (text) {
  const parts = text.trim().split(/\s+/);
  if (!parts[0]) return false;
  const verb = parts[0].toUpperCase();
  const args = parts.slice(1);
  // direct symbol shortcut: typing a known symbol charts it
  const symTry = text.trim().toUpperCase();
  if (AL.getSeries(symTry) && !['GO', 'HELP'].includes(verb)) { UI.openTab('chart', { sym: symTry, forceNew: true }, symTry + ' Chart'); return true; }
  const c = UI.commands.find(c => c.cmd.split(' ')[0] === verb) ||
    (verb === 'RESEARCH' && UI.commands.find(c => c.cmd.startsWith('RESEARCH ' + (args[0] || '').toUpperCase())));
  if (verb === 'RESEARCH') { (args[0] || '').toUpperCase() === 'STOP' ? RS.stopAuto() : (RS.startAuto(), UI.focusModule('researcher')); return true; }
  if (c) { c.fn(args); return true; }
  return false;
};
UI.initCmd = function () {
  const inp = document.getElementById('cmd');
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      if (UI.execCommand(inp.value)) inp.value = '';
      else { inp.value = ''; UI.openPalette(''); }
    }
  });
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); UI.openPalette(''); }
    if (e.key === 'Escape') UI.closePalette();
  });
};
UI.openPalette = function (seed) {
  const pal = document.getElementById('palette');
  pal.classList.add('open');
  const inp = document.getElementById('palette-input');
  inp.value = seed || '';
  UI.renderPalette('');
  inp.focus();
};
UI.closePalette = () => document.getElementById('palette').classList.remove('open');
UI.renderPalette = function (q) {
  const list = document.getElementById('palette-list');
  const qq = q.trim().toUpperCase();
  let items = [];
  // commands
  items = UI.commands.filter(c => !qq || c.cmd.toUpperCase().includes(qq) || c.desc.toUpperCase().includes(qq))
    .map(c => ({ label: c.cmd, desc: c.desc, run: () => { const parts = qq.split(/\s+/); c.fn(parts.slice(1)); } }));
  // symbols
  if (qq.length >= 1) {
    const cat = AL.catalog().filter(x => x.sym.toUpperCase().includes(qq) || x.name.toUpperCase().includes(qq)).slice(0, 8);
    items = items.concat(cat.map(x => ({ label: x.sym, desc: `${x.name}, chart (${x.cls}, ${x.src})`, run: () => UI.openTab('chart', { sym: x.sym, forceNew: true }, x.sym + ' Chart') })));
    const strats = S.registry.filter(s => s.name.toUpperCase().includes(qq) || s.id === qq).slice(0, 6);
    items = items.concat(strats.map(s => ({ label: s.id, desc: `${s.name}, open strategy module`, run: () => UI.openTab('stratDetail', { sid: s.id, forceNew: true }, s.name) })));
  }
  items = items.slice(0, 14);
  list.innerHTML = items.map((it, i) => `<div class="pal-item ${i === 0 ? 'sel' : ''}" data-i="${i}"><span class="pi-cmd">${AL.fmt.esc(it.label)}</span><span class="pi-desc">${AL.fmt.esc(it.desc)}</span></div>`).join('') || '<div class="empty">No matches</div>';
  list.querySelectorAll('.pal-item').forEach(el => el.addEventListener('click', () => { items[+el.dataset.i].run(); UI.closePalette(); }));
  UI._palItems = items;
};
UI.initPalette = function () {
  const inp = document.getElementById('palette-input');
  inp.addEventListener('input', () => UI.renderPalette(inp.value));
  inp.addEventListener('keydown', e => {
    const items = UI._palItems || [];
    const list = document.getElementById('palette-list');
    let sel = [...list.querySelectorAll('.pal-item')].findIndex(x => x.classList.contains('sel'));
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      sel = Math.max(0, Math.min(items.length - 1, sel + (e.key === 'ArrowDown' ? 1 : -1)));
      list.querySelectorAll('.pal-item').forEach((x, i) => x.classList.toggle('sel', i === sel));
    } else if (e.key === 'Enter') {
      if (UI.execCommand(inp.value)) { UI.closePalette(); return; }
      if (items[Math.max(sel, 0)]) { items[Math.max(sel, 0)].run(); UI.closePalette(); }
    }
  });
  document.getElementById('palette').addEventListener('click', e => { if (e.target.id === 'palette') UI.closePalette(); });
};

/* ---------- helpers ---------- */
UI.panel = function (title, bodyHtml, opts = {}) {
  return `<div class="panel ${opts.cls || ''}" ${opts.attrs || ''}>
    <div class="panel-head">${opts.drag ? '<span class="drag">⠿</span>' : ''}${title}${opts.right ? `<span class="right">${opts.right}</span>` : ''}</div>
    <div class="panel-body ${opts.nopad ? 'nopad' : ''}">${bodyHtml}</div></div>`;
};
UI.metric = (label, value, cls = '') => `<div class="metric"><div class="m-label">${label}</div><div class="m-value ${cls}">${value}</div></div>`;
UI.metricsFor = function (s, extra = {}) {
  const f = AL.fmt;
  let h = '';
  h += UI.metric('CAGR', f.spct(s.cagr), f.cls(s.cagr));
  h += UI.metric('Volatility', f.pct(s.vol));
  h += UI.metric('Sharpe', f.n(s.sharpe), f.cls(s.sharpe));
  h += UI.metric('Sortino', f.n(s.sortino), f.cls(s.sortino));
  h += UI.metric('Calmar', f.n(s.calmar));
  h += UI.metric('Omega', f.n(s.omega));
  h += UI.metric('Max Drawdown', f.pct(s.maxDD), 'dn');
  h += UI.metric('VaR 95 (1d)', f.pct(s.var95), 'dn');
  h += UI.metric('CVaR 95 (1d)', f.pct(s.cvar95), 'dn');
  h += UI.metric('Hit Rate', f.pct(s.hit));
  h += UI.metric('Skew', f.n(s.skew));
  h += UI.metric('Kurtosis', f.n(s.kurt));
  if (s.beta != null) {
    h += UI.metric('Beta', f.n(s.beta));
    h += UI.metric("Jensen's α", f.spct(s.alpha), f.cls(s.alpha));
    h += UI.metric('Info Ratio', f.n(s.ir), f.cls(s.ir));
    h += UI.metric('Treynor', f.n(s.treynor));
    h += UI.metric('Tracking Err', f.pct(s.te));
  }
  for (const [k, v] of Object.entries(extra)) h += UI.metric(k, v);
  return `<div class="metrics">${h}</div>`;
};
UI.sortTable = function (tableEl) {
  tableEl.querySelectorAll('th').forEach((th, ci) => th.addEventListener('click', () => {
    const tb = tableEl.querySelector('tbody');
    const rows = [...tb.rows];
    const dir = th.dataset.dir === 'a' ? -1 : 1;
    th.dataset.dir = dir === 1 ? 'a' : 'd';
    rows.sort((r1, r2) => {
      const a = r1.cells[ci].dataset.v ?? r1.cells[ci].textContent;
      const b = r2.cells[ci].dataset.v ?? r2.cells[ci].textContent;
      const na = parseFloat(a), nb = parseFloat(b);
      return (isFinite(na) && isFinite(nb) ? na - nb : String(a).localeCompare(String(b))) * dir;
    });
    rows.forEach(r => tb.appendChild(r));
  }));
};

/* =========================================================
   MODULE: Dashboard (drag-and-drop panel grid)
   ========================================================= */
UI.def('dashboard', 'Command Center', '◧', 'Research OS', function (el, state, tab) {
  const order = AL.store.get('dash_order', ['regime', 'spx', 'tiles2', 'curve', 'sectors', 'corr', 'vix', 'movers', 'feed']);
  el.innerHTML = `
    <div class="tiles" id="dash-tiles" style="margin-bottom:12px"></div>
    <div class="grid g2" id="dash-grid"></div>`;
  // top tiles
  const tiles = ['SPY', 'QQQ', 'IWM', 'TLT', 'GLD', '^VIX', 'BTC-USD', 'EURUSD=X'];
  const tl = document.getElementById('dash-tiles');
  tl.innerHTML = tiles.map((s, i) => {
    const lc = AL.lastClose(s);
    const ser = AL.getSeries(s);
    return `<div class="tile" data-sym="${s}">
      <div class="t-label"><span>${s.replace('=X', '').replace('^', '')}</span><span>${ser.cls}</span></div>
      <div class="t-value">${AL.fmt.px(lc.last)}</div>
      <div class="t-delta ${lc.chg >= 0 ? 'up' : 'dn'}">${AL.fmt.spct(lc.chg)} 1D</div>
      <div class="t-spark" id="spark-${i}"></div></div>`;
  }).join('');
  tiles.forEach((s, i) => {
    const ser = AL.getSeries(s);
    C.spark(document.getElementById('spark-' + i), ser.values.slice(-126));
  });
  tl.querySelectorAll('.tile').forEach(t => t.addEventListener('click', () => UI.openTab('chart', { sym: t.dataset.sym, forceNew: true }, t.dataset.sym + ' Chart')));

  const panels = {
    regime: () => {
      const r = Q.marketRegime();
      const f = AL.fmt;
      const tone = r.tone === 'good' ? 'ok' : r.tone === 'warn' ? 'warn' : 'bad';
      return UI.panel('Market Regime Monitor <span class="badge dim">HMM + macro composite</span>', `
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
          <span class="badge ${tone}" style="font-size:13px;padding:5px 12px">${r.label}</span>
          <span class="note">P(calm state) = ${f.pct(r.pCalm)} · 2-state Gaussian HMM on SPY, EM-fit on trailing 4y</span>
        </div>
        <div class="kv"><span class="k">SPY vs 200d SMA</span><span class="v ${r.trend > 0 ? 'up' : 'dn'}">${r.trend > 0 ? 'ABOVE (uptrend)' : 'BELOW (downtrend)'}</span></div>
        <div class="kv"><span class="k">Realized vol (20d / 1y)</span><span class="v">${f.pct(r.vol20)} / ${f.pct(r.vol252)}</span></div>
        <div class="kv"><span class="k">VIX (CBOE)</span><span class="v">${f.n(r.vix, 1)}</span></div>
        <div class="kv"><span class="k">10Y−2Y curve</span><span class="v ${r.curve >= 0 ? 'up' : 'dn'}">${f.n(r.curve, 2)}%</span></div>
        <div class="kv"><span class="k">HY credit spread (OAS)</span><span class="v">${r.hySpread != null ? f.n(r.hySpread, 2) + '%' : '-'}</span></div>
        <div class="note" style="margin-top:8px">Strategy engines consume this regime state when the ensemble allocator scores methodologies.</div>`, { drag: true, attrs: 'data-pid="regime" draggable="true"' });
    },
    spx: () => UI.panel('S&P 500, 2Y Daily Candles <span class="badge dim">real OHLC · Yahoo</span>', '<div class="chart h300" id="dash-spx"></div>', { drag: true, attrs: 'data-pid="spx" draggable="true"', nopad: true }),
    tiles2: () => {
      const rows = [['^GSPC', '^NDX', '^DJI', '^RUT'], ['DGS2', 'DGS10', 'DGS30', 'T10Y2Y']];
      let h = '<table class="tbl"><thead><tr><th>Series</th><th class="r">Last</th><th class="r">1M Δ</th><th class="r">YTD</th></tr></thead><tbody>';
      for (const s of rows.flat()) {
        const ser = AL.getSeries(s);
        if (!ser) continue;
        const v = ser.values, n = v.length;
        const isYield = s.startsWith('DGS') || s.startsWith('T10');
        const m1 = n > 21 ? (isYield ? v[n - 1] - v[n - 22] : v[n - 1] / v[n - 22] - 1) : null;
        const y0 = ser.dates.findIndex(d => d >= AL.asof.slice(0, 4) + '-01-01');
        const ytd = y0 > 0 ? (isYield ? v[n - 1] - v[y0] : v[n - 1] / v[y0] - 1) : null;
        h += `<tr data-sym="${s}"><td class="t">${AL.fmt.esc(ser.name)}</td><td class="r">${AL.fmt.px(v[n - 1])}${isYield ? '%' : ''}</td>
          <td class="r ${m1 >= 0 ? 'up' : 'dn'}">${isYield ? (m1 >= 0 ? '+' : '') + AL.fmt.n(m1, 2) + 'pp' : AL.fmt.spct(m1)}</td>
          <td class="r ${ytd >= 0 ? 'up' : 'dn'}">${isYield ? (ytd >= 0 ? '+' : '') + AL.fmt.n(ytd, 2) + 'pp' : AL.fmt.spct(ytd)}</td></tr>`;
      }
      return UI.panel('Indices & Rates', h + '</tbody></table>', { drag: true, attrs: 'data-pid="tiles2" draggable="true"', nopad: true });
    },
    curve: () => UI.panel('US Treasury Yield Curve <span class="badge dim">FRED</span>', '<div class="chart h220" id="dash-curve"></div>', { drag: true, attrs: 'data-pid="curve" draggable="true"' }),
    sectors: () => UI.panel('Sector Momentum, trailing 1M return', '<div class="chart h260" id="dash-sectors"></div>', { drag: true, attrs: 'data-pid="sectors" draggable="true"' }),
    corr: () => UI.panel('Cross-Asset Correlation (63d, daily returns)', '<div class="chart h260" id="dash-corr"></div>', { drag: true, attrs: 'data-pid="corr" draggable="true"' }),
    vix: () => UI.panel('Volatility Complex, VIX vs Realized', '<div class="chart h220" id="dash-vix"></div>', { drag: true, attrs: 'data-pid="vix" draggable="true"' }),
    movers: () => {
      const uni = AL.LIQUID;
      const rows = uni.map(s => { const lc = AL.lastClose(s); return { s, chg: lc.chg }; }).sort((a, b) => b.chg - a.chg);
      const pick = rows.slice(0, 5).concat(rows.slice(-5));
      return UI.panel('Top Movers, Liquid Universe (1D)', '<table class="tbl"><tbody>' +
        pick.map(r => `<tr data-sym="${r.s}"><td class="sym">${r.s}</td><td class="t">${AL.fmt.esc(AL.getSeries(r.s).name)}</td><td class="r ${r.chg >= 0 ? 'up' : 'dn'}">${AL.fmt.spct(r.chg)}</td></tr>`).join('') + '</tbody></table>', { drag: true, attrs: 'data-pid="movers" draggable="true"', nopad: true });
    },
    feed: () => UI.panel('AI Researcher, Live Activity <span id="dash-res-badge"></span>', `<div class="feed" id="dash-feed" style="max-height:220px;overflow-y:auto"></div>
      <div style="margin-top:8px;display:flex;gap:8px"><button class="btn primary small" id="dash-res-toggle"></button>
      <button class="btn small" onclick="UI.focusModule('researcher')">Open Research Desk →</button></div>`, { drag: true, attrs: 'data-pid="feed" draggable="true"' }),
  };
  const grid = document.getElementById('dash-grid');
  grid.innerHTML = order.filter(p => panels[p]).map(p => panels[p]()).join('');

  // charts
  const oh = AL.ohlc('^GSPC');
  const cut = Math.max(0, oh.dates.length - 504);
  const win = { dates: oh.dates.slice(cut), o: oh.o.slice(cut), h: oh.h.slice(cut), l: oh.l.slice(cut), c: oh.c.slice(cut), v: oh.v.slice(cut) };
  const sma50full = Q.sma(oh.c, 50).slice(cut), sma200full = Q.sma(oh.c, 200).slice(cut);
  C.candles(document.getElementById('dash-spx'), win, { overlays: [{ name: 'SMA 50', values: sma50full, color: C.SERIES[2] }, { name: 'SMA 200', values: sma200full, color: C.SERIES[4] }] });

  // yield curve: latest + 1y ago + 5y ago (better than time chart for shape)
  const tenors = [['DGS3MO', 0.25], ['DGS2', 2], ['DGS5', 5], ['DGS10', 10], ['DGS30', 30]];
  const curveSeries = [];
  for (const [lbl, ago] of [['Today', 0], ['1Y ago', 252], ['5Y ago', 1260]]) {
    const pts = tenors.map(([id]) => { const s = AL.getSeries(id); return s ? s.values[Math.max(s.values.length - 1 - ago, 0)] : null; });
    curveSeries.push({ name: lbl, dates: tenors.map(t => t[1] + 'y'), values: pts });
  }
  C.line(document.getElementById('dash-curve'), [
    { ...curveSeries[0], color: C.SERIES[0], width: 2 },
    { ...curveSeries[1], color: C.SERIES[2], dash: [4, 3] },
    { ...curveSeries[2], color: C.MUTED, dash: [2, 3] }], { directLabels: false });

  // sectors momentum grouped bars: use 1M returns sorted
  const sect = AL.SECTORS.map(s => {
    const ser = AL.getSeries(s); const v = ser.values, n = v.length;
    return { label: s, value: v[n - 1] / v[n - 22] - 1 };
  });
  C.bars(document.getElementById('dash-sectors'), sect, { horizontal: true, pct: true, sorted: true });

  // correlation heatmap
  const csyms = ['SPY', 'EFA', 'EEM', 'TLT', 'HYG', 'GLD', 'USO', 'VNQ', 'BTC-USD'];
  const al = AL.align(csyms, 'ret');
  const M = Q.corrMatrix(al.cols, al.syms, 63);
  C.heatmap(document.getElementById('dash-corr'), M, al.syms, al.syms, { lo: -1, hi: 1 });

  // vix vs realized
  const vix = AL.getSeries('^VIX');
  const spyR = AL.returns('SPY');
  const rv = Q.rollStd(spyR.values, 21).map(x => x * Math.sqrt(252) * 100);
  const vmap = new Map(vix.dates.map((d, i) => [d, vix.values[i]]));
  const dts = spyR.dates.slice(-504);
  const vvals = dts.map(d => vmap.get(d) ?? null);
  C.line(document.getElementById('dash-vix'), [
    { name: 'VIX (implied)', dates: dts, values: vvals, color: C.SERIES[2] },
    { name: 'Realized 21d', dates: dts, values: rv.slice(-504), color: C.SERIES[0] }]);

  // researcher feed
  UI.renderFeed(document.getElementById('dash-feed'));
  const tg = document.getElementById('dash-res-toggle');
  const setTg = () => { tg.textContent = RS.state.running ? '⏸ Pause Researcher' : '▶ Start Autonomous Research'; };
  setTg();
  tg.addEventListener('click', () => { RS.state.running ? RS.stopAuto() : RS.startAuto(); setTg(); });
  AL.bus.on('res:log', () => { const f = document.getElementById('dash-feed'); if (f) UI.renderFeed(f); });

  grid.querySelectorAll('tr[data-sym]').forEach(r => r.addEventListener('click', () => UI.openTab('chart', { sym: r.dataset.sym, forceNew: true }, r.dataset.sym + ' Chart')));

  // drag & drop reorder
  let dragging = null;
  grid.querySelectorAll('.panel[draggable]').forEach(p => {
    p.addEventListener('dragstart', () => { dragging = p; });
    p.addEventListener('dragover', e => { e.preventDefault(); p.classList.add('drag-over'); });
    p.addEventListener('dragleave', () => p.classList.remove('drag-over'));
    p.addEventListener('drop', e => {
      e.preventDefault(); p.classList.remove('drag-over');
      if (!dragging || dragging === p) return;
      const ids = [...grid.children].map(c => c.dataset.pid);
      const from = ids.indexOf(dragging.dataset.pid), to = ids.indexOf(p.dataset.pid);
      ids.splice(to, 0, ids.splice(from, 1)[0]);
      AL.store.set('dash_order', ids);
      UI.renderActive();
    });
  });
});
UI.renderFeed = function (el) {
  el.innerHTML = RS.log.slice(-60).map(l => `<div class="fl ${l.kind}"><span class="ft">${l.t}</span><span class="fm">${AL.fmt.esc(l.msg)}</span></div>`).join('') || '<div class="empty">Researcher idle, press Start.</div>';
  el.scrollTop = el.scrollHeight;
};

/* =========================================================
   MODULE: Markets (instrument browser)
   ========================================================= */
UI.def('markets', 'Markets', '𝄜', 'Research OS', function (el, state) {
  const classes = ['All', 'ETF', 'Equity', 'Index', 'FX', 'Futures', 'Crypto', 'Macro', 'Custom'];
  const cls = state.cls || 'All';
  el.innerHTML = `
    <div class="controls">${classes.map(c => `<span class="chip ${c === cls ? 'on' : ''}" data-c="${c}">${c}</span>`).join('')}
      <span class="note" id="mkt-cap"></span>
      <span style="flex:1"></span><input class="inp" id="mkt-q" placeholder="search 4,500+ instruments…" value="${state.q || ''}"></div>
    <div class="panel"><div class="panel-body nopad" style="max-height:calc(100vh - 190px)">
    <table class="tbl" id="mkt-tbl"><thead><tr>
      <th>Symbol</th><th>Name</th><th>Class</th><th class="r">Last</th><th class="r">1D</th><th class="r">1M</th><th class="r">YTD</th><th class="r">Vol 1Y</th><th class="r">Sharpe 1Y</th><th class="r">MaxDD 1Y</th><th class="r">Obs</th>
    </tr></thead><tbody id="mkt-body"></tbody></table></div></div>`;
  const render = () => {
    const q = (document.getElementById('mkt-q').value || '').toUpperCase();
    const all = AL.catalog().filter(x => (cls === 'All' ? x.cls !== 'Macro' : x.cls === cls))
      .filter(x => !q || x.sym.toUpperCase().includes(q) || x.name.toUpperCase().includes(q) || (x.sector || '').toUpperCase().includes(q));
    // the full-market catalog is ~4,500 rows; cap the DOM and let search narrow it
    const items = all.slice(0, 600);
    const capNote = document.getElementById('mkt-cap');
    if (capNote) capNote.textContent = all.length > items.length ? `showing ${items.length} of ${all.length.toLocaleString()} instruments, type to search the rest` : `${all.length.toLocaleString()} instruments`;
    const body = document.getElementById('mkt-body');
    body.innerHTML = items.map(x => {
      const ser = AL.getSeries(x.sym);
      const v = ser.values, n = v.length;
      const isMacro = x.cls === 'Macro';
      // weekly-universe rows use weekly bars, so windows and annualization scale down
      const isW = !!ser.weekly;
      const b1m = isW ? 4 : 22, b1y = isW ? 52 : 252, ann = isW ? 52 : 252;
      const d1 = v[n - 1] / v[n - 2] - 1;
      const m1 = n > b1m ? v[n - 1] / v[n - b1m] - 1 : null;
      const y0 = ser.dates.findIndex(d => d >= AL.asof.slice(0, 4) + '-01-01');
      const ytd = y0 > 0 ? v[n - 1] / v[y0] - 1 : null;
      let vol = null, sh = null, dd = null;
      if (!isMacro && n > b1y + 8) {
        const r = [];
        for (let i = n - b1y; i < n; i++) r.push(v[i] / v[i - 1] - 1);
        vol = Q.std(r) * Math.sqrt(ann);
        sh = vol ? (Q.mean(r) * ann - 0.02) / vol : null;
        dd = Math.min(...Q.drawdownSeries(Q.equity(r)));
      }
      const f = AL.fmt;
      return `<tr data-sym="${x.sym}"><td class="sym">${x.sym}</td><td class="t">${f.esc(x.name)}${x.sector ? ` <span style="color:var(--muted);font-size:10px">${f.esc(x.sector)}</span>` : ''}</td><td class="t">${x.cls}${isW ? ' (W)' : ''}</td>
        <td class="r" data-v="${v[n - 1]}">${f.px(v[n - 1])}</td>
        <td class="r ${f.cls(d1)}" data-v="${d1}">${isMacro ? '-' : f.spct(d1) + (isW ? ' w' : '')}</td>
        <td class="r ${f.cls(m1)}" data-v="${m1}">${isMacro ? '-' : f.spct(m1)}</td>
        <td class="r ${f.cls(ytd)}" data-v="${ytd}">${isMacro ? '-' : f.spct(ytd)}</td>
        <td class="r" data-v="${vol}">${vol ? f.pct(vol, 1) : '-'}</td>
        <td class="r ${f.cls(sh)}" data-v="${sh}">${sh != null ? f.n(sh) : '-'}</td>
        <td class="r dn" data-v="${dd}">${dd != null ? f.pct(dd, 1) : '-'}</td>
        <td class="r" data-v="${x.n}">${x.n.toLocaleString()}</td></tr>`;
    }).join('');
    body.querySelectorAll('tr').forEach(r => r.addEventListener('click', () => UI.openTab('chart', { sym: r.dataset.sym, forceNew: true }, r.dataset.sym + ' Chart')));
  };
  render();
  UI.sortTable(document.getElementById('mkt-tbl'));
  el.querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => { state.cls = c.dataset.c; UI.renderActive(); }));
  document.getElementById('mkt-q').addEventListener('input', AL.debounce(render, 200));
});

/* =========================================================
   MODULE: Chart workspace
   ========================================================= */
UI.def('chart', 'Chart', '▲', 'Research OS', function (el, state, tab) {
  const sym = state.sym || 'SPY';
  const ser = AL.getSeries(sym);
  if (!ser) { el.innerHTML = `<div class="empty">Unknown symbol ${AL.fmt.esc(sym)}</div>`; return; }
  tab.title = sym + ' Chart';
  const range = state.range || '2Y';
  const mode = state.mode || (AL.ohlc(sym) ? 'candles' : 'line');
  const isW = !!ser.weekly;   // extended-universe symbols carry weekly bars
  const ranges = isW
    ? { '6M': 26, '1Y': 52, '2Y': 104, '5Y': 260, '10Y': 520, MAX: 1e9 }
    : { '6M': 126, '1Y': 252, '2Y': 504, '5Y': 1260, '10Y': 2520, MAX: 1e9 };
  const lc = AL.lastClose(sym);
  const compare = state.compare || [];
  el.innerHTML = `
    <div class="controls">
      <span style="font-size:16px;font-weight:650">${sym} <span style="color:var(--muted);font-weight:400;font-size:12px">${AL.fmt.esc(ser.name)} · ${ser.cls} · ${ser.src}</span></span>
      <span class="num" style="font-size:16px">${AL.fmt.px(lc.last)}</span>
      <span class="num ${lc.chg >= 0 ? 'up' : 'dn'}">${AL.fmt.spct(lc.chg)}</span>
      <span style="flex:1"></span>
      ${Object.keys(ranges).map(r => `<span class="chip ${r === range ? 'on' : ''}" data-r="${r}">${r}</span>`).join('')}
      ${AL.ohlc(sym) ? `<span class="chip ${mode === 'candles' ? 'on' : ''}" data-m="candles">Candles</span>` : ''}
      <span class="chip ${mode === 'line' ? 'on' : ''}" data-m="line">Line</span>
      <span class="chip ${state.log ? 'on' : ''}" data-log="1">Log</span>
      <input class="inp" id="cmp-add" placeholder="+ compare…" style="width:110px">
    </div>
    <div class="grid" style="grid-template-columns:1fr">
      ${UI.panel(compare.length ? 'Indexed comparison (100 = window start)' : 'Price', '<div class="chart h340" id="ch-main"></div>', { nopad: true })}
      <div class="grid g3">
        ${UI.panel('Drawdown', '<div class="chart h180" id="ch-dd"></div>')}
        ${UI.panel(`Rolling ${AL.getSeries(sym).weekly ? '13w' : '63d'} annualized vol`, '<div class="chart h180" id="ch-vol"></div>')}
        ${UI.panel('Daily return distribution', '<div class="chart h180" id="ch-hist"></div>')}
      </div>
      <div class="grid g2">
        ${UI.panel(`Rolling ${AL.getSeries(sym).weekly ? '26w' : '126d'} beta vs SPY`, '<div class="chart h180" id="ch-beta"></div>')}
        ${UI.panel('Window statistics', '<div id="ch-stats"></div>')}
      </div>
    </div>`;
  const n = ranges[range];
  const w = { dates: ser.dates.slice(-n), values: ser.values.slice(-n) };
  const main = document.getElementById('ch-main');
  if (compare.length) {
    const all = [sym, ...compare];
    const al = AL.align(all, 'px');
    const dts = al.dates.slice(-n);
    const series = all.filter(s => al.cols[s]).map((s, i) => {
      const vals = al.cols[s].slice(-n);
      const base = vals.find(v => v != null);
      return { name: s, dates: dts, values: vals.map(v => v / base * 100), color: C.SERIES[i] };
    });
    C.line(main, series, { log: state.log });
  } else if (mode === 'candles' && AL.ohlc(sym)) {
    const oh = AL.ohlc(sym);
    const cut = Math.max(0, oh.dates.length - n);
    const sub = { dates: oh.dates.slice(cut), o: oh.o.slice(cut), h: oh.h.slice(cut), l: oh.l.slice(cut), c: oh.c.slice(cut), v: oh.v.slice(cut) };
    C.candles(main, sub, { overlays: [{ name: 'SMA 50', values: Q.sma(oh.c, 50).slice(cut), color: C.SERIES[2] }, { name: 'SMA 200', values: Q.sma(oh.c, 200).slice(cut), color: C.SERIES[4] }] });
  } else {
    C.line(main, [{ name: sym, dates: w.dates, values: w.values, color: C.SERIES[0], fill: true }], { log: state.log });
  }
  const rets = [];
  for (let i = 1; i < w.values.length; i++) rets.push(w.values[i] / w.values[i - 1] - 1);
  const ann = isW ? 52 : 252;
  C.line(document.getElementById('ch-dd'), [{ name: 'DD', dates: w.dates, values: Q.drawdownSeries(w.values), color: C.DN, fill: true }], { pct: true, zeroLine: true });
  C.line(document.getElementById('ch-vol'), [{ name: 'vol', dates: w.dates.slice(1), values: Q.rollStd(rets, isW ? 13 : 63).map(x => x * Math.sqrt(ann)), color: C.SERIES[2] }], { pct: true });
  C.histogram(document.getElementById('ch-hist'), rets, { pct: true });
  // beta needs the benchmark on the same bar grid; resample SPY weekly for weekly symbols
  let svals;
  if (isW) {
    const wv = AL.weeklyValues('SPY');
    const wmap = new Map(AL.sp500().wcal.map((d, i) => [d, wv[i]]));
    svals = w.dates.slice(1).map((d, i) => { const a = wmap.get(d), b = wmap.get(w.dates[i]); return a && b ? a / b - 1 : 0; });
  } else {
    const spy = AL.returns('SPY');
    const smap = new Map(spy.dates.map((d, i) => [d, spy.values[i]]));
    svals = w.dates.slice(1).map(d => smap.get(d) ?? 0);
  }
  C.line(document.getElementById('ch-beta'), [{ name: 'β', dates: w.dates.slice(1), values: Q.rollBeta(rets, svals, isW ? 26 : 126), color: C.SERIES[4] }], { zeroLine: true });
  const p = Q.perf(rets, { ann });
  document.getElementById('ch-stats').innerHTML = p ? UI.metricsFor(p) : '<div class="empty">Window too short</div>';
  el.querySelectorAll('.chip[data-r]').forEach(c => c.addEventListener('click', () => { state.range = c.dataset.r; UI.renderActive(); }));
  el.querySelectorAll('.chip[data-m]').forEach(c => c.addEventListener('click', () => { state.mode = c.dataset.m; UI.renderActive(); }));
  el.querySelector('.chip[data-log]').addEventListener('click', () => { state.log = !state.log; state.mode = 'line'; UI.renderActive(); });
  document.getElementById('cmp-add').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const s2 = e.target.value.trim().toUpperCase();
      if (AL.getSeries(s2)) { state.compare = [...compare, s2].slice(0, 3); state.mode = 'line'; UI.renderActive(); }
    }
  });
});

/* =========================================================
   MODULE: Data Hub
   ========================================================= */
UI.def('datahub', 'Data Hub', '⛁', 'Research OS', function (el, state) {
  const cat = AL.catalog();
  const bySrc = {};
  for (const x of cat) (bySrc[x.src] = bySrc[x.src] || []).push(x);
  el.innerHTML = `
    <div class="section-title">Data Hub <span class="badge ok">ALL REAL DATA</span><span class="note">bundled snapshot as-of ${AL.asof} · built ${AL.D.built}</span></div>
    <div class="grid g13">
      <div style="display:flex;flex-direction:column;gap:12px">
        ${UI.panel('Connected sources', Object.entries(AL.D.sources).map(([k, v]) => `<div class="kv"><span class="k">${k}</span><span class="v" style="font-family:var(--sans);font-size:11px">${v}</span></div>`).join('') +
          `<div class="kv"><span class="k">instruments</span><span class="v">${cat.filter(c => c.cls !== 'Macro').length}</span></div>
           <div class="kv"><span class="k">macro series</span><span class="v">${cat.filter(c => c.cls === 'Macro').length}</span></div>
           <div class="kv"><span class="k">trading days</span><span class="v">${AL.cal.length.toLocaleString()}</span></div>
           <div class="note" style="margin-top:8px">This build ships a full offline snapshot of real market history so every backtest, factor test and stress test runs on actual data. Re-run <span class="num">tools/download_data.py</span> to refresh the snapshot.</div>`)}
        ${UI.panel('Upload custom dataset <span class="badge data">CSV</span>', `
          <div class="dropzone" id="dz">Drop a CSV here or click to browse.<br><span style="font-size:10px">Needs a date column + a price/value column. Data is cleaned, validated,<br>deduplicated and registered into the research environment.</span></div>
          <input type="file" id="dz-file" accept=".csv,text/csv" style="display:none">
          <div id="dz-out" style="margin-top:8px"></div>`)}
        ${UI.panel('Data quality audit', `<div id="dq"></div><button class="btn small" id="dq-run" style="margin-top:8px">Run audit on liquid universe</button>`)}
      </div>
      ${UI.panel('Dataset catalog', `<div style="max-height:calc(100vh - 200px);overflow:auto"><table class="tbl" id="dh-tbl"><thead><tr><th>ID</th><th>Name</th><th>Class</th><th>Source</th><th class="r">From</th><th class="r">Obs</th></tr></thead><tbody>` +
        cat.map(x => `<tr data-sym="${x.sym}"><td class="sym">${x.sym}</td><td class="t">${AL.fmt.esc(x.name)}</td><td class="t">${x.cls}</td><td class="t">${x.src}</td><td class="r">${x.from}</td><td class="r">${x.n.toLocaleString()}</td></tr>`).join('') +
        '</tbody></table></div>', { nopad: true })}
    </div>`;
  document.querySelectorAll('#dh-tbl tbody tr').forEach(r => r.addEventListener('click', () => UI.openTab('chart', { sym: r.dataset.sym, forceNew: true }, r.dataset.sym + ' Chart')));
  UI.sortTable(document.getElementById('dh-tbl'));
  // upload
  const dz = document.getElementById('dz'), fi = document.getElementById('dz-file');
  dz.addEventListener('click', () => fi.click());
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('hover'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('hover'));
  dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('hover'); if (e.dataTransfer.files[0]) UI.ingestCSV(e.dataTransfer.files[0]); });
  fi.addEventListener('change', () => fi.files[0] && UI.ingestCSV(fi.files[0]));
  // audit
  document.getElementById('dq-run').addEventListener('click', () => {
    const out = [];
    for (const s of AL.LIQUID.slice(0, 20)) {
      const ser = AL.getSeries(s);
      const r = AL.returns(s).values;
      const stale = ser.values.slice(-500).filter((v, i, a) => i && v === a[i - 1]).length;
      const outliers = r.filter(x => Math.abs(x) > 6 * Q.std(r.slice(-1000))).length;
      out.push({ s, stale, outliers, gaps: 0 });
    }
    document.getElementById('dq').innerHTML = `<table class="tbl"><thead><tr><th>Sym</th><th class="r">Stale px (2y)</th><th class="r">|z|>6 outliers</th><th class="r">Status</th></tr></thead><tbody>` +
      out.map(o => `<tr><td class="sym">${o.s}</td><td class="r">${o.stale}</td><td class="r">${o.outliers}</td><td class="r">${o.stale < 25 && o.outliers < 30 ? '<span class="badge ok">CLEAN</span>' : '<span class="badge warn">REVIEW</span>'}</td></tr>`).join('') + '</tbody></table>';
  });
});
UI.ingestCSV = function (file) {
  const out = document.getElementById('dz-out');
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = AL.parseCSV(reader.result);
      const base = file.name.replace(/\.[^.]+$/, '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) || 'CUSTOM';
      const sym = AL.registerCustom(base, file.name, parsed);
      out.innerHTML = `<div class="info-box">Registered <b>${sym}</b>: ${parsed.dates.length} rows (${parsed.dates[0]} → ${parsed.dates[parsed.dates.length - 1]}), value column “${parsed.valueCol}”, ${parsed.cleaned} rows cleaned/deduped. Available across all modules.</div>`;
      RS.pushLog(`Custom dataset ${sym} ingested: ${parsed.dates.length} rows, ${parsed.cleaned} cleaned.`, 'sys');
    } catch (e) {
      out.innerHTML = `<div class="warn-box">Ingestion failed: ${AL.fmt.esc(e.message)}</div>`;
    }
  };
  reader.readAsText(file);
};
