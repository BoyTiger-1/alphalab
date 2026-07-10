/* AlphaLab chart library: canvas-based financial charts with crosshair tooltips.
   Palette validated (dataviz six-checks) against surface #151a21. */
'use strict';
const C = window.C = {};

C.SERIES = ['#3987e5', '#199e70', '#c98500', '#008300', '#9085e9', '#e66767', '#d55181', '#d95926'];
C.UP = '#199e70'; C.DN = '#e66767';
C.INK = '#e8eaed'; C.INK2 = '#9aa3ad'; C.MUTED = '#6b7480';
C.GRID = '#232a33'; C.AXIS = '#38414d'; C.SURF = '#151a21';
C.SEQ = ['#0d366b', '#104281', '#184f95', '#1c5cab', '#256abf', '#2a78d6', '#3987e5', '#5598e7', '#6da7ec', '#86b6ef'];

let TIP = null;
function tip() {
  if (!TIP) { TIP = document.createElement('div'); TIP.className = 'chart-tip'; document.body.appendChild(TIP); }
  return TIP;
}
C.hideTip = () => { if (TIP) TIP.style.display = 'none'; };

function setupCanvas(el) {
  el.innerHTML = '';
  const cv = document.createElement('canvas');
  el.appendChild(cv);
  const dpr = window.devicePixelRatio || 1;
  const W = el.clientWidth || 600, H = el.clientHeight || 240;
  cv.width = W * dpr; cv.height = H * dpr;
  cv.style.width = W + 'px'; cv.style.height = H + 'px';
  const ctx = cv.getContext('2d');
  ctx.scale(dpr, dpr);
  return { cv, ctx, W, H };
}

function niceTicks(lo, hi, n = 5) {
  if (!isFinite(lo) || !isFinite(hi) || lo === hi) { hi = lo + 1; }
  const span = hi - lo;
  const step0 = span / n;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => span / s <= n + 1) || mag * 10;
  const t0 = Math.ceil(lo / step) * step;
  const out = [];
  for (let t = t0; t <= hi + 1e-12; t += step) out.push(+t.toPrecision(12));
  return out;
}

function fmtVal(v, opts = {}) {
  if (v == null || !isFinite(v)) return '-';
  if (opts.pct) return (v * 100).toFixed(Math.abs(v) < 0.005 ? 2 : 1) + '%';
  if (Math.abs(v) >= 1e6) return AL.fmt.usd(v).replace('$', opts.usd ? '$' : '');
  return AL.fmt.px(v);
}

function dateTicks(dates, maxTicks) {
  const n = dates.length;
  const idxs = [];
  const step = Math.max(1, Math.floor(n / maxTicks));
  for (let i = 0; i < n; i += step) idxs.push(i);
  const span = n > 1 ? (Date.parse(dates[n - 1]) - Date.parse(dates[0])) / 864e5 : 0;
  const lab = d => span > 365 * 3 ? d.slice(0, 4) : span > 90 ? d.slice(0, 7) : d.slice(5);
  return idxs.map(i => ({ i, label: lab(dates[i]) }));
}

/* ---------- multi-series line/area chart ----------
   series: [{name, dates, values, color, width, dash, fill}]  (values may contain NaN)
   opts: {log, pct, zeroLine, legend(bool default auto), yFmt, hLines:[{y,label,color}], regions} */
C.line = function (el, series, opts = {}) {
  if (!el || !series.length) return;
  const { ctx, W, H, cv } = setupCanvas(el);
  const padL = 8, padR = 54, padT = 10, padB = 20;
  // align on union? assume same date axis for all (caller aligns), use first series dates
  const dates = series[0].dates;
  const n = dates.length;
  if (!n) return;
  let lo = Infinity, hi = -Infinity;
  for (const s of series)
    for (const v of s.values) if (v != null && isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
  if (opts.zeroLine) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  if (lo === hi) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.06; lo -= pad; hi += pad;
  const tf = opts.log ? Math.log : (x) => x;
  const tlo = opts.log ? Math.log(Math.max(lo, 1e-9)) : lo, thi = opts.log ? Math.log(hi) : hi;
  const X = i => padL + (W - padL - padR) * (n === 1 ? 0.5 : i / (n - 1));
  const Y = v => padT + (H - padT - padB) * (1 - (tf(Math.max(v, opts.log ? 1e-9 : -Infinity)) - tlo) / (thi - tlo));
  // grid + y labels
  ctx.font = '10px Consolas, monospace';
  ctx.fillStyle = C.MUTED; ctx.strokeStyle = C.GRID; ctx.lineWidth = 1;
  const yticks = opts.log
    ? niceTicks(lo, hi, 5).filter(t => t > 0)
    : niceTicks(lo, hi, 5);
  for (const t of yticks) {
    const y = Math.round(Y(t)) + 0.5;
    if (y < padT || y > H - padB) continue;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
    ctx.fillText(fmtVal(t, opts), W - padR + 5, y + 3);
  }
  // x labels
  ctx.textAlign = 'center';
  for (const t of dateTicks(dates, Math.floor(W / 80))) ctx.fillText(t.label, X(t.i), H - 6);
  ctx.textAlign = 'left';
  // zero line
  if (opts.zeroLine && lo < 0 && hi > 0) {
    ctx.strokeStyle = C.AXIS; ctx.beginPath();
    const y = Math.round(Y(0)) + 0.5;
    ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
  }
  for (const h of opts.hLines || []) {
    ctx.strokeStyle = h.color || C.AXIS; ctx.setLineDash([4, 4]);
    const y = Math.round(Y(h.y)) + 0.5;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
    ctx.setLineDash([]);
    if (h.label) { ctx.fillStyle = h.color || C.MUTED; ctx.fillText(h.label, padL + 4, y - 4); }
  }
  // shaded regions [{from,to,color}] as date-index ranges
  for (const rg of opts.regions || []) {
    ctx.fillStyle = rg.color;
    ctx.fillRect(X(rg.from), padT, X(rg.to) - X(rg.from), H - padT - padB);
  }
  // series
  series.forEach((s, si) => {
    const col = s.color || C.SERIES[si % C.SERIES.length];
    if (s.fill) {
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < n; i++) {
        const v = s.values[i];
        if (v == null || !isFinite(v)) continue;
        if (!started) { ctx.moveTo(X(i), Y(v)); started = true; } else ctx.lineTo(X(i), Y(v));
      }
      const y0 = opts.zeroLine ? Y(0) : H - padB;
      ctx.lineTo(X(n - 1), y0); ctx.lineTo(X(0), y0); ctx.closePath();
      ctx.fillStyle = col + '26'; ctx.fill();
    }
    ctx.strokeStyle = col; ctx.lineWidth = s.width || 1.6;
    if (s.dash) ctx.setLineDash(s.dash);
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < n; i++) {
      const v = s.values[i];
      if (v == null || !isFinite(v)) { started = false; continue; }
      if (!started) { ctx.moveTo(X(i), Y(v)); started = true; } else ctx.lineTo(X(i), Y(v));
    }
    ctx.stroke(); ctx.setLineDash([]);
  });
  // direct labels at line ends (≤4 series)
  if (series.length >= 2 && series.length <= 4 && opts.directLabels !== false) {
    ctx.font = '10px Consolas, monospace';
    const used = [];
    series.forEach((s, si) => {
      let vi = s.values.length - 1;
      while (vi >= 0 && (s.values[vi] == null || !isFinite(s.values[vi]))) vi--;
      if (vi < 0) return;
      let y = Y(s.values[vi]) + 3;
      while (used.some(u => Math.abs(u - y) < 11)) y += 11;
      used.push(y);
      ctx.fillStyle = s.color || C.SERIES[si % C.SERIES.length];
      ctx.fillText(s.name, W - padR + 5, Math.min(Math.max(y, padT + 8), H - padB) - 8 + 8);
    });
  }
  // legend (top row) for ≥2 series
  if (series.length >= 2 && opts.legend !== false) {
    let lx = padL + 2;
    ctx.font = '10px system-ui, sans-serif';
    series.forEach((s, si) => {
      const col = s.color || C.SERIES[si % C.SERIES.length];
      ctx.fillStyle = col; ctx.fillRect(lx, padT - 4, 8, 3);
      ctx.fillStyle = C.INK2; ctx.fillText(s.name, lx + 11, padT + 1);
      lx += 15 + ctx.measureText(s.name).width + 10;
    });
  }
  attachCrosshair(cv, el, { dates, series, X, Y, padL, padR, padT, padB, W, H, opts });
};

function attachCrosshair(cv, el, g) {
  const overlay = document.createElement('canvas');
  const dpr = window.devicePixelRatio || 1;
  overlay.width = g.W * dpr; overlay.height = g.H * dpr;
  overlay.style.cssText = `position:absolute;left:0;top:0;width:${g.W}px;height:${g.H}px;`;
  el.style.position = 'relative';
  el.appendChild(overlay);
  const octx = overlay.getContext('2d'); octx.scale(dpr, dpr);
  overlay.addEventListener('mousemove', (ev) => {
    const r = overlay.getBoundingClientRect();
    const mx = ev.clientX - r.left;
    const n = g.dates.length;
    const fr = (mx - g.padL) / (g.W - g.padL - g.padR);
    const i = Math.max(0, Math.min(n - 1, Math.round(fr * (n - 1))));
    octx.clearRect(0, 0, g.W, g.H);
    octx.strokeStyle = '#4a5568'; octx.setLineDash([3, 3]);
    const x = g.X(i);
    octx.beginPath(); octx.moveTo(x, g.padT); octx.lineTo(x, g.H - g.padB); octx.stroke();
    octx.setLineDash([]);
    let html = `<div class="tip-date">${g.dates[i]}</div>`;
    g.series.forEach((s, si) => {
      const v = s.values[i];
      if (v == null || !isFinite(v)) return;
      const col = s.color || C.SERIES[si % C.SERIES.length];
      octx.fillStyle = col;
      octx.beginPath(); octx.arc(x, g.Y(v), 3.5, 0, 7); octx.fill();
      octx.strokeStyle = C.SURF; octx.lineWidth = 2; octx.stroke();
      html += `<div class="tip-row"><span class="sw" style="background:${col}"></span>${AL.fmt.esc(s.name)}<b>${fmtVal(v, g.opts)}</b></div>`;
    });
    const t = tip();
    t.innerHTML = html;
    t.style.display = 'block';
    const tw = t.offsetWidth;
    t.style.left = Math.min(ev.clientX + 14, window.innerWidth - tw - 8) + 'px';
    t.style.top = (ev.clientY + 14) + 'px';
  });
  overlay.addEventListener('mouseleave', () => { octx.clearRect(0, 0, g.W, g.H); C.hideTip(); });
}

/* ---------- candlestick chart ---------- */
C.candles = function (el, data, opts = {}) {
  // data: {dates, o, h, l, c, v}; opts.overlays: [{name, values, color}]
  const { ctx, W, H, cv } = setupCanvas(el);
  const padL = 8, padR = 54, padT = 10, padB = 20;
  const volH = opts.volume === false ? 0 : Math.floor((H - padT - padB) * 0.16);
  const n = data.dates.length;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < n; i++) { if (data.l[i] < lo) lo = data.l[i]; if (data.h[i] > hi) hi = data.h[i]; }
  for (const ov of opts.overlays || [])
    for (const v of ov.values) if (isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const pad = (hi - lo) * 0.05; lo -= pad; hi += pad;
  const plotB = H - padB - volH;
  const X = i => padL + (W - padL - padR) * ((i + 0.5) / n);
  const Y = v => padT + (plotB - padT) * (1 - (v - lo) / (hi - lo));
  ctx.font = '10px Consolas, monospace';
  ctx.fillStyle = C.MUTED; ctx.strokeStyle = C.GRID;
  for (const t of niceTicks(lo, hi, 5)) {
    const y = Math.round(Y(t)) + 0.5;
    if (y < padT || y > plotB) continue;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
    ctx.fillText(fmtVal(t), W - padR + 5, y + 3);
  }
  ctx.textAlign = 'center';
  for (const t of dateTicks(data.dates, Math.floor(W / 80))) ctx.fillText(t.label, X(t.i), H - 6);
  ctx.textAlign = 'left';
  const bw = Math.max(1, Math.min(9, (W - padL - padR) / n * 0.7));
  // volume
  if (volH) {
    const vmax = Math.max(...data.v);
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = (data.c[i] >= data.o[i] ? C.UP : C.DN) + '55';
      const vh = vmax ? data.v[i] / vmax * volH : 0;
      ctx.fillRect(X(i) - bw / 2, H - padB - vh, bw, vh);
    }
  }
  for (let i = 0; i < n; i++) {
    const up = data.c[i] >= data.o[i];
    const col = up ? C.UP : C.DN;
    ctx.strokeStyle = col; ctx.fillStyle = col;
    const x = X(i);
    ctx.beginPath(); ctx.moveTo(x, Y(data.h[i])); ctx.lineTo(x, Y(data.l[i])); ctx.stroke();
    const y1 = Y(Math.max(data.o[i], data.c[i])), y2 = Y(Math.min(data.o[i], data.c[i]));
    ctx.fillRect(x - bw / 2, y1, bw, Math.max(y2 - y1, 1));
  }
  (opts.overlays || []).forEach((ov, oi) => {
    ctx.strokeStyle = ov.color || C.SERIES[(oi + 2) % 8];
    ctx.lineWidth = 1.3;
    ctx.beginPath(); let st = false;
    for (let i = 0; i < n; i++) {
      const v = ov.values[i];
      if (!isFinite(v)) { st = false; continue; }
      if (!st) { ctx.moveTo(X(i), Y(v)); st = true; } else ctx.lineTo(X(i), Y(v));
    }
    ctx.stroke();
  });
  // legend for overlays
  if ((opts.overlays || []).length) {
    let lx = padL + 2; ctx.font = '10px system-ui, sans-serif';
    for (let oi = 0; oi < opts.overlays.length; oi++) {
      const ov = opts.overlays[oi];
      const col = ov.color || C.SERIES[(oi + 2) % 8];
      ctx.fillStyle = col; ctx.fillRect(lx, padT - 4, 8, 3);
      ctx.fillStyle = C.INK2; ctx.fillText(ov.name, lx + 11, padT + 1);
      lx += 15 + ctx.measureText(ov.name).width + 10;
    }
  }
  // hover: OHLC tooltip
  const overlay = document.createElement('canvas');
  const dpr = window.devicePixelRatio || 1;
  overlay.width = W * dpr; overlay.height = H * dpr;
  overlay.style.cssText = `position:absolute;left:0;top:0;width:${W}px;height:${H}px;`;
  el.style.position = 'relative'; el.appendChild(overlay);
  const octx = overlay.getContext('2d'); octx.scale(dpr, dpr);
  overlay.addEventListener('mousemove', (ev) => {
    const r = overlay.getBoundingClientRect();
    const fr = (ev.clientX - r.left - padL) / (W - padL - padR);
    const i = Math.max(0, Math.min(n - 1, Math.floor(fr * n)));
    octx.clearRect(0, 0, W, H);
    octx.strokeStyle = '#4a5568'; octx.setLineDash([3, 3]);
    octx.beginPath(); octx.moveTo(X(i), padT); octx.lineTo(X(i), plotB); octx.stroke();
    const chg = i ? data.c[i] / data.c[i - 1] - 1 : 0;
    const t = tip();
    t.innerHTML = `<div class="tip-date">${data.dates[i]}</div>
      <div class="tip-row">O<b>${AL.fmt.px(data.o[i])}</b></div><div class="tip-row">H<b>${AL.fmt.px(data.h[i])}</b></div>
      <div class="tip-row">L<b>${AL.fmt.px(data.l[i])}</b></div><div class="tip-row">C<b>${AL.fmt.px(data.c[i])}</b></div>
      <div class="tip-row">Δ<b class="${chg >= 0 ? 'up' : 'dn'}">${AL.fmt.spct(chg)}</b></div>
      ${data.v ? `<div class="tip-row">Vol<b>${AL.fmt.n(data.v[i], 1)}M</b></div>` : ''}`;
    t.style.display = 'block';
    t.style.left = Math.min(ev.clientX + 14, window.innerWidth - t.offsetWidth - 8) + 'px';
    t.style.top = (ev.clientY + 14) + 'px';
  });
  overlay.addEventListener('mouseleave', () => { octx.clearRect(0, 0, W, H); C.hideTip(); });
};

/* ---------- horizontal / vertical bars ---------- */
C.bars = function (el, items, opts = {}) {
  // items: [{label, value, color?}]  opts: {horizontal, pct, sorted}
  const { ctx, W, H, cv } = setupCanvas(el);
  if (opts.sorted) items = items.slice().sort((a, b) => b.value - a.value);
  const n = items.length;
  if (!n) return;
  const vals = items.map(i => i.value);
  let lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
  if (lo === hi) hi = lo + 1;
  ctx.font = '10px Consolas, monospace';
  if (opts.horizontal) {
    const padL = Math.min(120, Math.max(...items.map(i => ctx.measureText(i.label).width)) + 12);
    const padR = 52, padT = 6, padB = 6;
    const bh = Math.min(20, (H - padT - padB) / n - 2);
    const X = v => padL + (W - padL - padR) * ((v - lo) / (hi - lo));
    const x0 = X(0);
    items.forEach((it, i) => {
      const y = padT + (H - padT - padB) * (i / n) + 1;
      const col = it.color || (it.value >= 0 ? C.SERIES[0] : C.SERIES[5]);
      ctx.fillStyle = col;
      const x1 = X(it.value);
      roundRectBar(ctx, Math.min(x0, x1), y, Math.abs(x1 - x0), bh, it.value >= 0);
      ctx.fillStyle = C.INK2;
      ctx.fillText(it.label, 4, y + bh / 2 + 3);
      ctx.fillStyle = C.INK;
      ctx.fillText(opts.pct ? AL.fmt.spct(it.value) : AL.fmt.n(it.value), Math.max(x0, x1) + 5, y + bh / 2 + 3);
    });
    ctx.strokeStyle = C.AXIS;
    ctx.beginPath(); ctx.moveTo(Math.round(x0) + 0.5, padT); ctx.lineTo(Math.round(x0) + 0.5, H - padB); ctx.stroke();
  } else {
    const padL = 8, padR = 46, padT = 8, padB = 20;
    const Y = v => padT + (H - padT - padB) * (1 - (v - lo) / (hi - lo));
    const y0 = Y(0);
    ctx.fillStyle = C.MUTED; ctx.strokeStyle = C.GRID;
    for (const t of niceTicks(lo, hi, 4)) {
      const y = Math.round(Y(t)) + 0.5;
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
      ctx.fillText(opts.pct ? (t * 100).toFixed(0) + '%' : AL.fmt.n(t, 1), W - padR + 4, y + 3);
    }
    const bw = Math.max(2, (W - padL - padR) / n * 0.72);
    items.forEach((it, i) => {
      const x = padL + (W - padL - padR) * ((i + 0.5) / n) - bw / 2;
      const col = it.color || (it.value >= 0 ? C.SERIES[0] : C.SERIES[5]);
      ctx.fillStyle = col;
      const y1 = Y(it.value);
      roundRectBar(ctx, x, Math.min(y0, y1), bw, Math.max(Math.abs(y1 - y0), 1), it.value >= 0, true);
    });
    ctx.fillStyle = C.MUTED; ctx.textAlign = 'center';
    const step = Math.ceil(n / Math.floor(W / 60));
    items.forEach((it, i) => { if (i % step === 0) ctx.fillText(it.label, padL + (W - padL - padR) * ((i + 0.5) / n), H - 6); });
    ctx.textAlign = 'left';
  }
  // hover
  cv.addEventListener('mousemove', ev => {
    const r = cv.getBoundingClientRect();
    let i;
    if (opts.horizontal) i = Math.floor((ev.clientY - r.top - 6) / ((H - 12) / n));
    else i = Math.floor((ev.clientX - r.left - 8) / ((W - 54) / n));
    if (i < 0 || i >= n) { C.hideTip(); return; }
    const t = tip();
    t.innerHTML = `<div class="tip-row">${AL.fmt.esc(items[i].label)}<b>${opts.pct ? AL.fmt.spct(items[i].value) : AL.fmt.n(items[i].value)}</b></div>`;
    t.style.display = 'block';
    t.style.left = Math.min(ev.clientX + 14, window.innerWidth - t.offsetWidth - 8) + 'px';
    t.style.top = (ev.clientY + 14) + 'px';
  });
  cv.addEventListener('mouseleave', C.hideTip);
};
function roundRectBar(ctx, x, y, w, h, positive, vertical) {
  const r = Math.min(3, w / 2, h / 2);
  ctx.beginPath();
  if (vertical === true) {
    if (positive) { ctx.roundRect(x, y, w, h, [r, r, 0, 0]); } else { ctx.roundRect(x, y, w, h, [0, 0, r, r]); }
  } else {
    if (positive) { ctx.roundRect(x, y, w, h, [0, r, r, 0]); } else { ctx.roundRect(x, y, w, h, [r, 0, 0, r]); }
  }
  ctx.fill();
}

/* ---------- histogram ---------- */
C.histogram = function (el, values, opts = {}) {
  const vals = values.filter(isFinite);
  const bins = opts.bins || 40;
  const lo = Q.quantile(vals, 0.001), hi = Q.quantile(vals, 0.999);
  const counts = new Array(bins).fill(0);
  for (const v of vals) {
    const b = Math.floor((v - lo) / (hi - lo) * bins);
    if (b >= 0 && b < bins) counts[b]++;
  }
  const items = counts.map((c, i) => {
    const x = lo + (i + 0.5) / bins * (hi - lo);
    return { label: opts.pct ? (x * 100).toFixed(1) + '%' : x.toFixed(3), value: c, color: x < 0 ? C.SERIES[5] : C.SERIES[0] };
  });
  C.bars(el, items, {});
};

/* ---------- heatmap (matrix, diverging) ---------- */
C.heatmap = function (el, matrix, rowLabels, colLabels, opts = {}) {
  const { ctx, W, H, cv } = setupCanvas(el);
  const padL = opts.padL || 52, padT = 20, padR = 6, padB = 6;
  const nr = matrix.length, nc = matrix[0].length;
  const cw = (W - padL - padR) / nc, ch = (H - padT - padB) / nr;
  const lo = opts.lo ?? -1, hi = opts.hi ?? 1;
  const mid = opts.mid ?? 0;
  // diverging blue↔red ramp around a neutral dark midpoint
  const lerp = (a, b, t) => Math.round(a + (b - a) * t);
  const NEUT = [40, 46, 55], BLUE = [57, 135, 229], RED = [230, 103, 103];
  const colFor = v => {
    if (v == null || !isFinite(v)) return '#20262e';
    const t = Math.min(Math.abs(v >= mid ? (v - mid) / (hi - mid || 1) : (v - mid) / (mid - lo || 1)), 1);
    const P = v >= mid ? BLUE : RED;
    return `rgb(${lerp(NEUT[0], P[0], t)},${lerp(NEUT[1], P[1], t)},${lerp(NEUT[2], P[2], t)})`;
  };
  ctx.font = '9px Consolas, monospace';
  for (let i = 0; i < nr; i++) {
    for (let j = 0; j < nc; j++) {
      const v = matrix[i][j];
      ctx.fillStyle = colFor(v);
      ctx.fillRect(padL + j * cw + 1, padT + i * ch + 1, cw - 2, ch - 2);
      if (cw > 30 && ch > 13 && v != null && isFinite(v)) {
        ctx.fillStyle = Math.abs((v - mid) / (hi - mid || 1)) > 0.55 ? '#fff' : C.INK2;
        ctx.textAlign = 'center';
        ctx.fillText(opts.fmt ? opts.fmt(v) : v.toFixed(2), padL + (j + 0.5) * cw, padT + (i + 0.5) * ch + 3);
      }
    }
    ctx.fillStyle = C.INK2; ctx.textAlign = 'right';
    ctx.fillText(String(rowLabels[i]).slice(0, 8), padL - 4, padT + (i + 0.5) * ch + 3);
  }
  ctx.textAlign = 'center'; ctx.fillStyle = C.INK2;
  for (let j = 0; j < nc; j++) ctx.fillText(String(colLabels[j]).slice(0, 7), padL + (j + 0.5) * cw, 13);
  ctx.textAlign = 'left';
  cv.addEventListener('mousemove', ev => {
    const r = cv.getBoundingClientRect();
    const j = Math.floor((ev.clientX - r.left - padL) / cw), i = Math.floor((ev.clientY - r.top - padT) / ch);
    if (i < 0 || i >= nr || j < 0 || j >= nc) { C.hideTip(); return; }
    const t = tip();
    const v = matrix[i][j];
    t.innerHTML = `<div class="tip-row">${AL.fmt.esc(rowLabels[i])} × ${AL.fmt.esc(colLabels[j])}<b>${v == null ? '-' : (opts.fmt ? opts.fmt(v) : v.toFixed(3))}</b></div>`;
    t.style.display = 'block';
    t.style.left = Math.min(ev.clientX + 14, window.innerWidth - t.offsetWidth - 8) + 'px';
    t.style.top = (ev.clientY + 14) + 'px';
  });
  cv.addEventListener('mouseleave', C.hideTip);
};

/* ---------- scatter ---------- */
C.scatter = function (el, pts, opts = {}) {
  // pts: [{x, y, label, color, size}]
  const { ctx, W, H, cv } = setupCanvas(el);
  const padL = 42, padR = 12, padT = 10, padB = 24;
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  let xlo = Math.min(...xs), xhi = Math.max(...xs), ylo = Math.min(...ys), yhi = Math.max(...ys);
  const xp = (xhi - xlo) * 0.08 || 1, yp = (yhi - ylo) * 0.08 || 1;
  xlo -= xp; xhi += xp; ylo -= yp; yhi += yp;
  const X = v => padL + (W - padL - padR) * ((v - xlo) / (xhi - xlo));
  const Y = v => padT + (H - padT - padB) * (1 - (v - ylo) / (yhi - ylo));
  ctx.font = '10px Consolas, monospace'; ctx.fillStyle = C.MUTED; ctx.strokeStyle = C.GRID;
  for (const t of niceTicks(ylo, yhi, 5)) {
    const y = Math.round(Y(t)) + 0.5;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
    ctx.fillText(opts.pctY ? (t * 100).toFixed(0) + '%' : AL.fmt.n(t, 2), 2, y + 3);
  }
  ctx.textAlign = 'center';
  for (const t of niceTicks(xlo, xhi, 6)) ctx.fillText(opts.pctX ? (t * 100).toFixed(0) + '%' : AL.fmt.n(t, 2), X(t), H - 8);
  ctx.textAlign = 'left';
  for (const p of pts) {
    ctx.fillStyle = p.color || C.SERIES[0];
    ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), p.size || 4, 0, 7); ctx.fill();
    ctx.strokeStyle = C.SURF; ctx.lineWidth = 1.5; ctx.stroke();
    if (p.label && pts.length <= 30) { ctx.fillStyle = C.INK2; ctx.font = '9px Consolas'; ctx.fillText(p.label, X(p.x) + 6, Y(p.y) + 3); }
  }
  cv.addEventListener('mousemove', ev => {
    const r = cv.getBoundingClientRect();
    const mx = ev.clientX - r.left, my = ev.clientY - r.top;
    let best = null, bd = 12;
    for (const p of pts) { const d = Math.hypot(X(p.x) - mx, Y(p.y) - my); if (d < bd) { bd = d; best = p; } }
    if (!best) { C.hideTip(); return; }
    const t = tip();
    t.innerHTML = `<div class="tip-row">${AL.fmt.esc(best.label || '')}<b>${opts.pctX ? AL.fmt.pct(best.x) : AL.fmt.n(best.x)} , ${opts.pctY ? AL.fmt.pct(best.y) : AL.fmt.n(best.y)}</b></div>`;
    t.style.display = 'block';
    t.style.left = Math.min(ev.clientX + 14, window.innerWidth - t.offsetWidth - 8) + 'px';
    t.style.top = (ev.clientY + 14) + 'px';
  });
  cv.addEventListener('mouseleave', C.hideTip);
};

/* ---------- Monte Carlo fan chart ---------- */
C.fan = function (el, bands, dates, opts = {}) {
  // bands: [q5, q25, q50, q75, q95] arrays
  const series = [];
  const fill = (a, b, col) => ({ upper: a, lower: b, col });
  const { ctx, W, H } = setupCanvas(el);
  const padL = 8, padR = 54, padT = 10, padB = 20;
  const all = bands.flat();
  let lo = Math.min(...all), hi = Math.max(...all);
  const p = (hi - lo) * 0.05; lo -= p; hi += p;
  const n = bands[0].length;
  const X = i => padL + (W - padL - padR) * (i / (n - 1));
  const Y = v => padT + (H - padT - padB) * (1 - (v - lo) / (hi - lo));
  ctx.font = '10px Consolas, monospace'; ctx.fillStyle = C.MUTED; ctx.strokeStyle = C.GRID;
  for (const t of niceTicks(lo, hi, 5)) {
    const y = Math.round(Y(t)) + 0.5;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
    ctx.fillText(AL.fmt.n(t, 2), W - padR + 5, y + 3);
  }
  const drawBand = (u, l, col) => {
    ctx.beginPath();
    for (let i = 0; i < n; i++) i ? ctx.lineTo(X(i), Y(u[i])) : ctx.moveTo(X(0), Y(u[0]));
    for (let i = n - 1; i >= 0; i--) ctx.lineTo(X(i), Y(l[i]));
    ctx.closePath(); ctx.fillStyle = col; ctx.fill();
  };
  drawBand(bands[4], bands[0], '#3987e51a');
  drawBand(bands[3], bands[1], '#3987e52e');
  ctx.strokeStyle = C.SERIES[0]; ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < n; i++) i ? ctx.lineTo(X(i), Y(bands[2][i])) : ctx.moveTo(X(0), Y(bands[2][0]));
  ctx.stroke();
  if (opts.hline != null) {
    ctx.strokeStyle = C.AXIS; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(padL, Y(opts.hline)); ctx.lineTo(W - padR, Y(opts.hline)); ctx.stroke();
    ctx.setLineDash([]);
  }
  // labels on right
  ctx.font = '9px Consolas, monospace';
  const labs = ['5%', '25%', 'median', '75%', '95%'];
  [0, 2, 4].forEach(bi => {
    ctx.fillStyle = bi === 2 ? C.SERIES[0] : C.INK2;
    ctx.fillText(labs[bi] + ' ' + AL.fmt.n(bands[bi][n - 1], 2), W - padR + 4, Y(bands[bi][n - 1]) + 3);
  });
  if (dates) {
    ctx.fillStyle = C.MUTED; ctx.textAlign = 'center';
    for (const t of dateTicks(dates, Math.floor(W / 90))) ctx.fillText(t.label, X(t.i), H - 6);
    ctx.textAlign = 'left';
  }
};

/* ---------- sparkline ---------- */
C.spark = function (el, values, opts = {}) {
  const { ctx, W, H } = setupCanvas(el);
  const vals = values.filter(isFinite);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (lo === hi) { lo -= 1; hi += 1; }
  const n = values.length;
  const X = i => 1 + (W - 2) * (i / (n - 1));
  const Y = v => 2 + (H - 4) * (1 - (v - lo) / (hi - lo));
  const up = values[n - 1] >= values[0];
  const col = opts.color || (up ? C.UP : C.DN);
  ctx.beginPath();
  for (let i = 0; i < n; i++) isFinite(values[i]) && (i ? ctx.lineTo(X(i), Y(values[i])) : ctx.moveTo(X(0), Y(values[0])));
  ctx.lineTo(X(n - 1), H); ctx.lineTo(X(0), H); ctx.closePath();
  ctx.fillStyle = col + '22'; ctx.fill();
  ctx.strokeStyle = col; ctx.lineWidth = 1.3;
  ctx.beginPath();
  for (let i = 0; i < n; i++) isFinite(values[i]) && (i ? ctx.lineTo(X(i), Y(values[i])) : ctx.moveTo(X(0), Y(values[0])));
  ctx.stroke();
};

/* monthly returns heatmap helper */
C.monthlyHeatmap = function (el, dates, rets) {
  const byYM = new Map();
  for (let i = 0; i < dates.length; i++) {
    const ym = dates[i].slice(0, 7);
    byYM.set(ym, (byYM.get(ym) ?? 0) + Math.log(1 + rets[i]));
  }
  const years = [...new Set([...byYM.keys()].map(k => k.slice(0, 4)))].sort().slice(-12);
  const matrix = years.map(y => Array.from({ length: 12 }, (_, m) => {
    const k = y + '-' + String(m + 1).padStart(2, '0');
    return byYM.has(k) ? Math.exp(byYM.get(k)) - 1 : null;
  }));
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  C.heatmap(el, matrix, years, months, { lo: -0.1, hi: 0.1, fmt: v => (v * 100).toFixed(1), padL: 38 });
};
