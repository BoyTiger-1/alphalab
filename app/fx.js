/* AlphaLab FX: motion and freshness layer. Page transitions, staggered panel entry, count-up numbers,
   chart draw-in, live tick flashes, toasts, splash, and the freshness machinery: data-age badge,
   stale-result invalidation when the data snapshot changes, and version polling that offers a reload
   when a newer nightly build is deployed. Everything respects prefers-reduced-motion. */
'use strict';
(function () {
const FX = window.FX = {};
const mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
FX.reduced = mq.matches;

/* ---------- toasts ---------- */
FX.toast = function (msg, kind = 'info', o = {}) {
  let host = document.getElementById('toasts');
  if (!host) { host = document.createElement('div'); host.id = 'toasts'; document.body.appendChild(host); }
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.innerHTML = `<span class="toast-dot"></span><span class="toast-msg"></span>${o.action ? '<button class="btn small primary toast-act"></button>' : ''}<span class="toast-x">×</span>`;
  t.querySelector('.toast-msg').textContent = msg;
  if (o.action) { const b = t.querySelector('.toast-act'); b.textContent = o.action.label; b.addEventListener('click', () => { o.action.fn(); close(); }); }
  const close = () => { t.classList.add('out'); setTimeout(() => t.remove(), 260); };
  t.querySelector('.toast-x').addEventListener('click', close);
  host.appendChild(t);
  while (host.children.length > 4) host.firstChild.remove();
  if (!o.sticky) setTimeout(close, o.ms || 4200);
  return { close };
};

/* ---------- count-up for numeric metrics ---------- */
const NUM = /^([^\d\-+]*)([+\-]?)([\d,]*\.?\d+)(.*)$/;
function countUp(node, dur = 650) {
  if (FX.reduced || node.dataset.fxc) return;
  const txt = node.textContent.trim();
  if (txt.length > 18 || node.children.length) return;
  const m = txt.match(NUM); if (!m) return;
  const target = parseFloat(m[3].replace(/,/g, '')); if (!isFinite(target) || target === 0) return;
  const dec = (m[3].split('.')[1] || '').length, commas = m[3].includes(',');
  node.dataset.fxc = '1';
  const t0 = performance.now();
  const fmt = v => { let s = v.toFixed(dec); if (commas) s = Number(s).toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec }); return m[1] + m[2] + s + m[4]; };
  const step = now => {
    if (!node.isConnected) return;
    const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
    node.textContent = fmt(target * e);
    if (k < 1) requestAnimationFrame(step); else node.textContent = txt;
  };
  requestAnimationFrame(step);
}
FX.countUp = countUp;

/* ---------- entry choreography for a freshly rendered workspace ---------- */
function choreograph(root) {
  if (FX.reduced || !root) return;
  let i = 0;
  root.querySelectorAll('.panel, .tile, .metric, .mcard, .kpi, .cards > *').forEach(n => {
    if (n.closest('.fx-noanim')) return;
    n.style.setProperty('--i', Math.min(i++, 14));
    n.classList.add('fx-in');
  });
  setTimeout(() => root.querySelectorAll('.m-value, .t-value').forEach(n => countUp(n)), 60);
}
FX.choreograph = choreograph;
// numbers that appear after async work (metrics filled later) also count up
const mo = typeof MutationObserver !== 'undefined' ? new MutationObserver(recs => {
  if (FX.reduced || FX._quiet) return;
  for (const r of recs) for (const n of r.addedNodes) {
    if (n.nodeType !== 1) continue;
    if (n.classList && (n.classList.contains('metric'))) { const v = n.querySelector('.m-value'); if (v) countUp(v, 500); }
    else if (n.querySelectorAll && r.target.classList && r.target.classList.contains('metrics')) n.querySelectorAll('.m-value').forEach(v => countUp(v, 500));
  }
}) : null;

/* ---------- live ticks: flash tiles in place instead of rebuilding ---------- */
const lastPx = {};
function paintTicks() {
  document.querySelectorAll('.tile[data-sym]').forEach(t => {
    const s = t.dataset.sym, lc = AL.lastClose(s); if (!lc) return;
    const v = t.querySelector('.t-value'), d = t.querySelector('.t-delta');
    const prev = lastPx[s]; lastPx[s] = lc.last;
    if (v) v.textContent = AL.fmt.px(lc.last);
    if (d) { d.textContent = AL.fmt.spct(lc.chg) + ' 1D'; d.className = 't-delta ' + (lc.chg >= 0 ? 'up' : 'dn'); }
    if (prev != null && prev !== lc.last && !FX.reduced) {
      t.classList.remove('tick-up', 'tick-dn'); void t.offsetWidth;
      t.classList.add(lc.last > prev ? 'tick-up' : 'tick-dn');
    }
  });
}

/* ---------- data freshness ---------- */
const STALE_KEYS = ['leaderboard', 'strat_scores', 'mlrace'];
function invalidateOnNewData() {
  const seen = AL.store.get('data_asof', null);
  if (seen === AL.asof) return false;
  // results computed on an older snapshot would make the app look frozen: drop them, keep user inputs
  const had = STALE_KEYS.filter(k => AL.store.get(k, null) != null);
  STALE_KEYS.forEach(k => AL.store.del(k));
  AL.store.set('data_asof', AL.asof);
  if (seen && had.length) setTimeout(() => FX.toast(`New market data (${AL.asof}). Cached leaderboards were cleared and will recompute on fresh prices.`, 'ok', { ms: 6500 }), 1200);
  return true;
}
function bizDaysBetween(a, b) {
  let n = 0; const d = new Date(a + 'T12:00:00Z'), e = new Date(b + 'T12:00:00Z');
  while (d < e) { d.setUTCDate(d.getUTCDate() + 1); const w = d.getUTCDay(); if (w && w < 6) n++; }
  return n;
}
function paintAge() {
  const el = document.getElementById('asof'); if (!el || !AL.asof) return;
  const today = new Date().toISOString().slice(0, 10);
  const lag = bizDaysBetween(AL.asof, today);
  const cls = lag <= 1 ? 'fresh' : lag <= 3 ? 'aging' : 'stale';
  let b = document.getElementById('age-badge');
  if (!b) { b = document.createElement('span'); b.id = 'age-badge'; el.insertAdjacentElement('afterend', b); }
  b.className = 'age-badge ' + cls;
  b.textContent = lag <= 0 ? 'today' : lag === 1 ? '1 trading day old' : lag + ' trading days old';
  b.title = cls === 'fresh' ? 'Prices are from the latest close. The nightly job refreshes after every US session.'
    : 'This page is showing an older snapshot. Reload to pick up the latest nightly build.';
}
/* version polling: the nightly job writes version.json next to the page */
let offered = false;
async function checkVersion() {
  if (offered || !/^https?:/.test(location.protocol) || typeof fetch !== 'function') return;
  const B = window.ALPHALAB_BUILD || {};
  try {
    const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) return;
    const v = await r.json();
    const newer = (v.asof && B.asof && v.asof > B.asof) || (v.built && B.built && v.built > B.built && v.asof !== B.asof);
    if (newer) {
      offered = true;
      FX.toast(`Fresh data is available (${v.asof}). Reload to update every chart and result.`, 'ok', { sticky: true, action: { label: 'Reload', fn: () => location.reload() } });
      const b = document.getElementById('age-badge'); if (b) { b.className = 'age-badge stale'; b.textContent = 'update ready'; b.style.cursor = 'pointer'; b.onclick = () => location.reload(); }
    }
  } catch (e) { /* offline or file:// */ }
}

/* ---------- splash ---------- */
function hideSplash() {
  const s = document.getElementById('splash'); if (!s) return;
  s.classList.add('gone'); setTimeout(() => s.remove(), FX.reduced ? 0 : 650);
}

/* ---------- ambient background ---------- */
function ambient() {
  if (document.getElementById('ambient')) return;
  const a = document.createElement('div'); a.id = 'ambient'; a.innerHTML = '<i></i><i></i><i></i>';
  document.body.insertBefore(a, document.body.firstChild);
}

/* ---------- wire into the shell ---------- */
const boot0 = UI.boot;
UI.boot = function () {
  invalidateOnNewData();
  boot0.apply(this, arguments);
  document.body.classList.add('fx-ready');
  if (FX.reduced) document.body.classList.add('fx-reduced');
  ambient(); paintAge(); hideSplash();
  const ws = document.getElementById('workspace');
  if (mo && ws) mo.observe(ws, { childList: true, subtree: true });
  choreograph(ws);
  paintTicks();
  AL.bus.on('live:update', () => { paintTicks(); paintAge(); });
  setInterval(() => { if (!document.hidden) { checkVersion(); paintAge(); } }, 5 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { checkVersion(); paintAge(); } });
  setTimeout(checkVersion, 4000);
  mq.addEventListener && mq.addEventListener('change', e => { FX.reduced = e.matches; document.body.classList.toggle('fx-reduced', e.matches); });
};

let lastKey = null;
const render0 = UI.renderActive;
UI.renderActive = function () {
  const tab = UI.currentTab();
  const key = tab ? tab.id + ':' + (tab.state && tab.state.view || '') : null;
  const fresh = key !== lastKey; lastKey = key;
  const ws = document.getElementById('workspace');
  // a same-tab repaint (live tick on holdings) must not replay the entrance animation
  FX._quiet = !fresh;
  render0.apply(this, arguments);
  FX._quiet = false;
  if (!ws || !fresh || FX.reduced) return;
  ws.classList.remove('fx-enter'); void ws.offsetWidth; ws.classList.add('fx-enter');
  ws.scrollTop = 0;
  choreograph(ws);
};

// tab strip: subtle slide for the active marker
const tabs0 = UI.renderTabs;
UI.renderTabs = function () { tabs0.apply(this, arguments); const a = document.querySelector('#tabstrip .tab.active'); if (a && !FX.reduced) { a.classList.add('fx-pop'); } };

UI.toast = FX.toast;
})();
