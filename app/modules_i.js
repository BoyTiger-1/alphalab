/* AlphaLab modules, part I: ML Model Zoo (ported open-source models, live training studio, model race,
   ML twins), Quant Studio (GARCH, HMM regimes, pairs + Kalman, factor attribution, options lab,
   overfitting lab, correlation network, fractional differencing) and the Competition Desk
   (Wharton Global High School Investment Competition workflow). All on the bundled real data. */
'use strict';
(function () {
const f = AL.fmt, Z = ML.zoo;
const $ = id => document.getElementById(id);
const alive = node => node && document.body.contains(node);

/* ---------- shared helpers ---------- */
// inverse standard normal CDF (Acklam), used by the Deflated Sharpe Ratio
const invNorm = p => {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  if (p <= 0) return -Infinity; if (p >= 1) return Infinity;
  if (p < pl) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > 1 - pl) { const q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  const q = p - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
};
const npdf = x => Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI);
const Phi = x => Q.normCdf(x);
const moments = a => {
  const n = a.length, m = Q.mean(a); let s2 = 0, s3 = 0, s4 = 0;
  for (const v of a) { const d = v - m; s2 += d * d; s3 += d * d * d; s4 += d * d * d * d; }
  const v = s2 / n; return { mean: m, sd: Math.sqrt(v), skew: v ? s3 / n / v ** 1.5 : 0, kurt: v ? s4 / n / (v * v) : 3 };
};
const sharpeOf = a => { const s = Q.std(a); return s ? Q.mean(a) / s * Math.sqrt(252) : 0; };

function canvasIn(el) {
  el.innerHTML = '';
  const cv = document.createElement('canvas'); el.appendChild(cv);
  const dpr = window.devicePixelRatio || 1, W = el.clientWidth || 600, H = el.clientHeight || 240;
  cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
  const ctx = cv.getContext('2d'); ctx.scale(dpr, dpr);
  return { cv, ctx, W, H };
}
const nice = (lo, hi, n = 5) => {
  if (!isFinite(lo) || !isFinite(hi) || lo === hi) hi = lo + 1;
  const step0 = (hi - lo) / n, mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => (hi - lo) / s <= n + 1) || mag * 10;
  const out = []; for (let t = Math.ceil(lo / step) * step; t <= hi + 1e-12; t += step) out.push(+t.toPrecision(12));
  return out;
};
/* numeric-x line plot: series [{name, values, color, width, dash, fill}], xs numeric */
function xyPlot(el, xs, series, o = {}) {
  if (!el) return;
  const { cv, ctx, W, H } = canvasIn(el);
  const padL = 8, padR = 56, padT = 10, padB = 22;
  let lo = Infinity, hi = -Infinity;
  for (const s of series) for (const v of s.values) if (isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  for (const h of o.hLines || []) { lo = Math.min(lo, h.y); hi = Math.max(hi, h.y); }
  if (o.zero) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  if (!isFinite(lo)) return;
  if (lo === hi) { lo -= 1; hi += 1; }
  const pd = (hi - lo) * 0.07; lo -= pd; hi += pd;
  const x0 = xs[0], x1 = xs[xs.length - 1];
  const X = x => padL + (W - padL - padR) * ((x - x0) / ((x1 - x0) || 1));
  const Y = v => padT + (H - padT - padB) * (1 - (v - lo) / (hi - lo));
  const yf = o.yFmt || (v => o.pct ? (v * 100).toFixed(Math.abs(hi - lo) < 0.05 ? 1 : 0) + '%' : AL.fmt.n(v, Math.abs(hi - lo) < 5 ? 2 : 0));
  const xf = o.xFmt || (v => AL.fmt.n(v, 0));
  ctx.font = '10px Consolas, monospace'; ctx.strokeStyle = C.GRID; ctx.fillStyle = C.MUTED; ctx.lineWidth = 1;
  for (const t of nice(lo, hi, 5)) { const y = Math.round(Y(t)) + 0.5; ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke(); ctx.fillText(yf(t), W - padR + 5, y + 3); }
  ctx.textAlign = 'center';
  for (const t of nice(x0, x1, Math.max(3, Math.floor(W / 90)))) if (t >= x0 && t <= x1) ctx.fillText(xf(t), X(t), H - 7);
  ctx.textAlign = 'left';
  for (const v of o.vLines || []) { ctx.strokeStyle = v.color || C.AXIS; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(X(v.x), padT); ctx.lineTo(X(v.x), H - padB); ctx.stroke(); ctx.setLineDash([]); if (v.label) { ctx.fillStyle = v.color || C.INK2; ctx.fillText(v.label, X(v.x) + 4, padT + 10); } }
  for (const h of o.hLines || []) { ctx.strokeStyle = h.color || C.AXIS; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(padL, Y(h.y)); ctx.lineTo(W - padR, Y(h.y)); ctx.stroke(); ctx.setLineDash([]); if (h.label) { ctx.fillStyle = h.color || C.INK2; ctx.fillText(h.label, padL + 4, Y(h.y) - 4); } }
  series.forEach((s, si) => {
    const col = s.color || C.SERIES[si % C.SERIES.length];
    const path = () => { ctx.beginPath(); let st = false; s.values.forEach((v, i) => { if (!isFinite(v)) { st = false; return; } st ? ctx.lineTo(X(xs[i]), Y(v)) : ctx.moveTo(X(xs[i]), Y(v)); st = true; }); };
    if (s.fill) { path(); ctx.lineTo(X(xs[xs.length - 1]), Y(Math.max(lo, 0))); ctx.lineTo(X(xs[0]), Y(Math.max(lo, 0))); ctx.closePath(); ctx.fillStyle = col + '22'; ctx.fill(); }
    path(); ctx.strokeStyle = col; ctx.lineWidth = s.width || 1.6; if (s.dash) ctx.setLineDash(s.dash); ctx.stroke(); ctx.setLineDash([]);
  });
  if (series.length > 1 && o.legend !== false) {
    let lx = padL + 6; ctx.font = '10px system-ui, sans-serif';
    series.forEach((s, si) => { if (!s.name) return; ctx.fillStyle = s.color || C.SERIES[si % C.SERIES.length]; ctx.fillRect(lx, padT + 2, 10, 3); ctx.fillStyle = C.INK2; ctx.fillText(s.name, lx + 14, padT + 7); lx += ctx.measureText(s.name).width + 28; });
  }
  cv.addEventListener('mousemove', ev => {
    const r = cv.getBoundingClientRect(), mx = ev.clientX - r.left;
    let bi = 0, bd = Infinity; xs.forEach((x, i) => { const d = Math.abs(X(x) - mx); if (d < bd) { bd = d; bi = i; } });
    let t = document.querySelector('.chart-tip'); if (!t) { t = document.createElement('div'); t.className = 'chart-tip'; document.body.appendChild(t); }
    t.innerHTML = `<div class="tip-row" style="color:var(--muted)">${AL.fmt.esc(o.xLabel || 'x')} ${xf(xs[bi])}</div>` + series.map((s, si) => `<div class="tip-row"><span style="color:${s.color || C.SERIES[si % C.SERIES.length]}">${AL.fmt.esc(s.name || '')}</span><b>${isFinite(s.values[bi]) ? yf(s.values[bi]) : '-'}</b></div>`).join('');
    t.style.display = 'block'; t.style.left = Math.min(ev.clientX + 14, window.innerWidth - t.offsetWidth - 8) + 'px'; t.style.top = (ev.clientY + 14) + 'px';
  });
  cv.addEventListener('mouseleave', C.hideTip);
}
/* animated semicircle gauge 0..100 */
function gauge(el, value, label) {
  if (!el) return;
  const { ctx, W, H } = canvasIn(el);
  const cx = W / 2, cy = H * 0.86, R = Math.min(W / 2 - 14, H * 0.78);
  const colFor = v => v >= 75 ? C.UP : v >= 50 ? '#c98500' : C.DN;
  const target = Math.max(0, Math.min(100, value || 0));
  const reduce = window.FX && FX.reduced;
  const t0 = performance.now(), dur = reduce ? 1 : 1100;
  const draw = now => {
    const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3), v = target * e;
    ctx.clearRect(0, 0, W, H);
    ctx.lineCap = 'round'; ctx.lineWidth = 14;
    ctx.strokeStyle = C.GRID; ctx.beginPath(); ctx.arc(cx, cy, R, Math.PI, 2 * Math.PI); ctx.stroke();
    for (const [a, b, c] of [[0, 50, '#e6676733'], [50, 75, '#c9850033'], [75, 100, '#199e7033']]) { ctx.strokeStyle = c; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(cx, cy, R + 12, Math.PI + Math.PI * a / 100, Math.PI + Math.PI * b / 100); ctx.stroke(); }
    ctx.lineWidth = 14; ctx.strokeStyle = colFor(v); ctx.beginPath(); ctx.arc(cx, cy, R, Math.PI, Math.PI + Math.PI * v / 100); ctx.stroke();
    const ang = Math.PI + Math.PI * v / 100;
    ctx.strokeStyle = C.INK; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(ang) * (R - 22), cy + Math.sin(ang) * (R - 22)); ctx.stroke();
    ctx.fillStyle = C.INK; ctx.beginPath(); ctx.arc(cx, cy, 5, 0, 7); ctx.fill();
    ctx.textAlign = 'center'; ctx.font = '600 26px Consolas, monospace'; ctx.fillStyle = colFor(v); ctx.fillText(Math.round(v), cx, cy - R * 0.35);
    ctx.font = '10px system-ui, sans-serif'; ctx.fillStyle = C.INK2; ctx.fillText(label || '', cx, cy - R * 0.35 + 16); ctx.textAlign = 'left';
    if (k < 1) requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
}
/* sub-tab strip inside a module */
function subtabs(el, tabs, active, onPick) {
  el.innerHTML = `<div class="subtabs">${tabs.map(([id, label]) => `<button class="subtab ${id === active ? 'on' : ''}" data-st="${id}">${label}</button>`).join('')}</div><div class="subtab-body"></div>`;
  el.querySelectorAll('.subtab').forEach(b => b.addEventListener('click', () => {
    el.querySelectorAll('.subtab').forEach(x => x.classList.toggle('on', x === b));
    const body = el.querySelector('.subtab-body');
    onPick(b.dataset.st, body);
    if (window.FX) { body.classList.remove('fx-enter'); void body.offsetWidth; body.classList.add('fx-enter'); FX.choreograph(body); }
  }));
  onPick(active, el.querySelector('.subtab-body'));
}
const spinner = (msg) => `<div class="fx-loading"><span class="spin"></span><span>${msg}</span></div>`;
const skeleton = (h = 220) => `<div class="skeleton" style="height:${h}px"></div>`;
const toast = (m, k) => window.FX ? FX.toast(m, k) : null;
const symSelect = (id, syms, cur) => `<select class="inp" id="${id}">${syms.filter(s => AL.getSeries(s)).map(s => `<option ${s === cur ? 'selected' : ''}>${s}</option>`).join('')}</select>`;
UI.xyPlot = xyPlot; UI.gauge = gauge;

/* =========================================================
   MODULE: ML Model Zoo
   ========================================================= */
const SRC_STRAT = { lstm: 'S119', gru: 'S120', alstm: 'S121', transformer: 'S122', rf: 'S123', extratrees: 'S124', gbdt: 'S125', alpha158: 'S125', elasticnet: 'S126', svm: 'S127', nb: 'S128', dqn: 'S129', hmm: 'S130', kalman: 'S131', garch: 'S132', olmar: 'S133', meta: 'S134' };
const SRC_KIND = { lstm: 'Deep sequence', gru: 'Deep sequence', alstm: 'Deep sequence + attention', transformer: 'Self-attention', gbdt: 'Gradient boosting', alpha158: 'Feature library', rf: 'Bagged trees', extratrees: 'Randomized trees', elasticnet: 'Regularized linear', nb: 'Probabilistic', svm: 'Max-margin', dqn: 'Reinforcement learning', autograd: 'Engine', hmm: 'Latent state', kalman: 'State space', garch: 'Volatility', olmar: 'Online portfolio', meta: 'Labeling + CV', metrics: 'Evaluation' };

UI.def('mlzoo', 'ML Model Zoo', '◈', 'Quant Lab', function (el, state, tab) {
  const MC = window.ALPHALAB_MLCACHE;
  el.innerHTML = `<div class="section-title">ML Model Zoo <span class="badge dim">${ML.SOURCES.length} open-source ports · ${Object.keys(ML.models).length} models</span>
      ${MC ? `<span class="badge ok" title="walk-forward predictions prebuilt by the nightly data job">prebuilt cache ${AL.fmt.esc(MC.asof)}</span>` : ''}</div>
    <p class="note" style="max-width:980px;margin-bottom:10px">Every model here is a from-scratch JavaScript port of an open-source reference implementation (repo and license on each card). They all train walk-forward on real history: expanding window, refit on a schedule, a purge gap equal to the label horizon, so no prediction ever sees its own future.</p>
    <div id="zoo-tabs"></div>`;
  subtabs($('zoo-tabs'), [['cards', 'Model cards'], ['studio', 'Training studio'], ['race', 'Model race'], ['twins', 'ML twins']], state.view || 'cards', (v, body) => {
    state.view = v; C.hideTip();
    ({ cards: zooCards, studio: zooStudio, race: zooRace, twins: zooTwins })[v](body, state, tab);
  });
});

function zooCards(body) {
  body.innerHTML = `<div class="cards">${ML.SOURCES.map((s, i) => {
    const sid = SRC_STRAT[s.id];
    return `<div class="mcard" style="--i:${i}">
      <div class="mc-top"><span class="mc-kind">${SRC_KIND[s.id] || 'Model'}</span><span class="badge dim">${AL.fmt.esc(s.license)}</span></div>
      <div class="mc-name">${AL.fmt.esc(s.model)}</div>
      <a class="mc-repo" href="https://github.com/${s.repo.split(';')[0].trim()}" target="_blank" rel="noopener">github.com/${AL.fmt.esc(s.repo)}</a>
      ${s.file ? `<div class="mc-file">${AL.fmt.esc(s.file)}</div>` : ''}
      ${s.paper ? `<div class="mc-paper">${AL.fmt.esc(s.paper)}</div>` : ''}
      <div class="mc-act">
        ${sid && S.byId[sid] ? `<button class="btn small primary" data-sid="${sid}">Backtest ${sid}</button>` : ''}
        ${['lstm', 'gru', 'alstm', 'transformer'].includes(s.id) ? `<button class="btn small" data-train="${s.id}">Train live</button>` : ''}
      </div></div>`;
  }).join('')}</div>
  ${UI.panel('Which ported model powers each strategy family', `<table class="tbl"><thead><tr><th>Strategy category</th><th>ML twin model</th><th class="r">Strategies</th></tr></thead><tbody>${
    Object.entries(Z.CATEGORY_MODEL).map(([c, m]) => `<tr><td class="t">${AL.fmt.esc(c)}</td><td>${AL.fmt.esc(ML.models[m] ? ML.models[m].name : m)}</td><td class="r">${S.registry.filter(e => e.cat === c).length}</td></tr>`).join('')
  }</tbody></table><div class="note" style="padding:8px 10px">Open any strategy and press <b>Train ML twin</b> to meta-label it with its family's model (Lopez de Prado triple-barrier labels, purged and embargoed walk-forward).</div>`, { nopad: true })}`;
  body.querySelectorAll('[data-sid]').forEach(b => b.addEventListener('click', () => UI.openTab('stratDetail', { sid: b.dataset.sid, forceNew: true }, S.byId[b.dataset.sid].name)));
  body.querySelectorAll('[data-train]').forEach(b => b.addEventListener('click', () => {
    const t = UI.currentTab(); t.state.view = 'studio'; t.state.net = b.dataset.train; UI.renderActive();
  }));
}

function zooStudio(body, state, tab) {
  const net = state.net || 'alstm', sym = state.sym || 'SPY';
  body.innerHTML = `<div class="controls">
      <label class="lbl">network</label><select class="inp" id="st-net">${['lstm', 'gru', 'alstm', 'transformer'].map(n => `<option value="${n}" ${n === net ? 'selected' : ''}>${ML.models[n].name}</option>`).join('')}</select>
      <label class="lbl">asset</label>${symSelect('st-sym', ['SPY', 'QQQ', 'IWM', 'GLD', 'TLT', 'BTC-USD', 'ETH-USD', 'NVDA', 'AAPL'], sym)}
      <label class="lbl">epochs</label><input class="inp" id="st-ep" style="width:52px" value="${state.epochs || 12}">
      <label class="lbl">hidden</label><input class="inp" id="st-h" style="width:52px" value="${state.hidden || (net === 'transformer' ? 16 : 12)}">
      <button class="btn primary" id="st-go">Train</button><button class="btn" id="st-stop" disabled>Stop</button>
      <span class="note" id="st-status">Predicts the 5-day forward return from the last 20 days of 7 features. Last 252 days held out, 5-day purge.</span></div>
    <div class="progress" style="margin-bottom:10px"><div id="st-bar" style="width:0%"></div></div>
    <div class="metrics" id="st-m" style="margin-bottom:12px"></div>
    <div class="grid g2">
      ${UI.panel('Loss curve <span class="badge dim">train vs held-out, normalized MSE</span>', '<div class="chart h260 fx-static" id="st-loss"></div>')}
      ${UI.panel('<span id="st-att-title">Attention map</span>', '<div class="chart h260 fx-static" id="st-att"></div>')}
    </div>
    <div class="grid g2">
      ${UI.panel('Held-out predictions vs realized 5-day return', '<div class="chart h240 fx-static" id="st-sc"></div>')}
      ${UI.panel('Architecture', '<div id="st-arch"></div>')}
    </div>`;
  let run = null;
  const arch = n => ({
    lstm: 'Input 7 features x 20 steps -> LSTM(h) (input, forget, output gates + cell) -> last hidden -> linear -> 5d return. Port of qlib pytorch_lstm.py.',
    gru: 'Input 7 x 20 -> GRU(h) (update + reset gates) -> last hidden -> linear. Port of qlib pytorch_gru.py.',
    alstm: 'Input 7 x 20 -> tanh projection -> GRU(h) -> temporal attention softmax over the 20 steps -> concat(last hidden, attended context) -> linear. Port of qlib pytorch_alstm.py. The heatmap shows which past days the model looks at.',
    transformer: 'Input 7 x 20 -> linear embed + sinusoidal positions -> 2-head self-attention -> add & LayerNorm -> feed-forward -> add & LayerNorm -> last token -> linear. Port of qlib pytorch_transformer.py. The heatmaps show each head\'s attention (query day vs key day).',
  })[n];
  const go = () => {
    const nn = $('st-net').value, sy = $('st-sym').value, E = Math.max(1, Math.min(60, +$('st-ep').value || 12)), Hh = Math.max(4, Math.min(32, +$('st-h').value || 12));
    Object.assign(state, { net: nn, sym: sy, epochs: E, hidden: Hh });
    $('st-arch').innerHTML = `<p class="note" style="line-height:1.6">${arch(nn)}</p>`;
    $('st-status').textContent = 'building sequence features...';
    $('st-loss').innerHTML = skeleton(240); $('st-att').innerHTML = skeleton(240); $('st-sc').innerHTML = skeleton(220);
    setTimeout(() => {
      const feat = Z.seqFeatures(sy, 5, '2005-01-01', 20);
      const n = feat.X.length, hold = 252, cut = n - hold - 5;
      if (cut < 400) { $('st-status').textContent = 'not enough history for ' + sy; return; }
      const Xtr = feat.X.slice(0, cut), ytr = feat.y.slice(0, cut), Xva = feat.X.slice(n - hold), yva = feat.y.slice(n - hold), dva = feat.dates.slice(n - hold);
      const tr = Z.seqTrainer(nn, Xtr, ytr, { T: 20, hidden: Hh, trainCap: 1500, seed: 7 });
      const vy = Q.std(ytr) ** 2 || 1;
      const trainL = [], valL = [], ics = [];
      let ep = 0, stop = false, t0 = performance.now();
      run = { stop: () => { stop = true; } };
      $('st-stop').disabled = false; $('st-go').disabled = true;
      const stepOne = () => {
        if (!alive(body) || stop || ep >= E) {
          if (alive(body)) { $('st-stop').disabled = true; $('st-go').disabled = false; $('st-status').textContent = `done: ${ep} epochs in ${((performance.now() - t0) / 1000).toFixed(1)}s`; toast(`${ML.models[nn].name} trained on ${sy}: held-out IC ${f.n(ics[ics.length - 1], 3)}`, 'ok'); }
          return;
        }
        trainL.push(tr.step()); ep++;
        const pv = tr.predict(Xva);
        valL.push(Q.mean(pv.map((p, i) => (p - yva[i]) ** 2)) / vy);
        const ic = Q.spearman ? Q.spearman(pv, yva) : Q.corr(pv, yva); ics.push(ic);
        const hit = Q.mean(pv.map((p, i) => Math.sign(p) === Math.sign(yva[i]) ? 1 : 0));
        $('st-bar').style.width = (ep / E * 100) + '%';
        $('st-status').textContent = `epoch ${ep}/${E}`;
        $('st-m').innerHTML = UI.metric('Epoch', ep + ' / ' + E) + UI.metric('Train loss', f.n(trainL[ep - 1], 4)) + UI.metric('Held-out loss', f.n(valL[ep - 1], 4), valL[ep - 1] < 1 ? 'up' : 'dn')
          + UI.metric('Held-out rank IC', f.n(ic, 3), f.cls(ic)) + UI.metric('Direction hit rate', f.pct(hit), hit > 0.5 ? 'up' : 'dn') + UI.metric('Parameters', tr.nParams.toLocaleString());
        const xs = trainL.map((_, i) => i + 1);
        xyPlot($('st-loss'), xs, [{ name: 'train', values: trainL, color: C.SERIES[0], width: 2 }, { name: 'held-out', values: valL, color: C.SERIES[2], width: 2 }], { xLabel: 'epoch', hLines: [{ y: 1, label: 'predict-the-mean baseline', color: C.MUTED }] });
        C.scatter($('st-sc'), pv.map((p, i) => ({ x: p, y: yva[i], color: Math.sign(p) === Math.sign(yva[i]) ? C.UP + 'cc' : C.DN + 'aa', size: 2.5, label: dva[i] })), { pctX: true, pctY: true });
        const B = 24, insp = tr.inspect(Xva.slice(-B)), T = insp.T;
        const lab = Array.from({ length: T }, (_, t) => 't-' + (T - 1 - t));
        if (nn === 'alstm' && insp.att) {
          $('st-att-title').textContent = 'ALSTM temporal attention, last 24 held-out days';
          const M = Array.from({ length: B }, (_, b) => insp.att.slice(b * T, b * T + T));
          const mx = Math.max(...insp.att);
          C.heatmap($('st-att'), M, dva.slice(-B).map(d => d.slice(5)), lab, { lo: 0, hi: mx, mid: 0, fmt: v => (v * 100).toFixed(0), padL: 44 });
        } else if (nn === 'transformer' && insp.P) {
          $('st-att-title').textContent = 'Transformer self-attention, head 1 | head 2 (avg of last 24 days)';
          const heads = 2, P = insp.P, M = [];
          for (let t = 0; t < T; t++) { const row = []; for (let h = 0; h < heads; h++) for (let u = 0; u < T; u++) { let s = 0; for (let b = 0; b < B; b++) s += P[((b * heads + h) * T + t) * T + u]; row.push(s / B); } M.push(row); }
          const mx = Math.max(...M.flat());
          C.heatmap($('st-att'), M, lab, [...lab, ...lab], { lo: 0, hi: mx, mid: 0, fmt: v => '', padL: 36 });
        } else {
          $('st-att-title').textContent = 'Recurrent state: held-out prediction path';
          xyPlot($('st-att'), pv.map((_, i) => i), [{ name: 'prediction', values: pv, color: C.SERIES[4], width: 1.5 }, { name: 'realized', values: yva, color: C.MUTED, width: 1 }], { pct: true, zero: true, xLabel: 'day', xFmt: v => dva[Math.round(v)] ? dva[Math.round(v)].slice(2, 7) : '' });
        }
        setTimeout(stepOne, 16);
      };
      stepOne();
    }, 30);
  };
  $('st-go').addEventListener('click', go);
  $('st-stop').addEventListener('click', () => run && run.stop());
  $('st-arch').innerHTML = `<p class="note" style="line-height:1.6">${arch(net)}</p>`;
  $('st-loss').innerHTML = '<div class="empty">Press Train to watch the network learn epoch by epoch.</div>';
  $('st-att').innerHTML = '<div class="empty">Attention weights appear here for ALSTM and Transformer.</div>';
  $('st-sc').innerHTML = '<div class="empty">Held-out scatter appears after the first epoch.</div>';
  if (state.autostart) { state.autostart = false; go(); }
}

function zooRace(body, state) {
  const ids = S.registry.filter(e => e.cat === 'Open-Source ML' && e.status === 'ok').map(e => e.id);
  const saved = AL.store.get('mlrace', null);
  const fresh = saved && saved.asof === AL.asof ? saved : null;
  body.innerHTML = `<div class="controls"><button class="btn primary" id="rc-go">Run the race (${ids.length} models)</button>
      <span class="note" id="rc-st">${fresh ? 'Last run on data as-of ' + fresh.asof + '.' : 'Every ported model, walk-forward on real data, net of costs. Prebuilt predictions make this fast; missing days train in your browser.'}</span></div>
    <div class="progress" style="margin-bottom:10px"><div id="rc-bar" style="width:0%"></div></div>
    <div class="grid g2">${UI.panel('Sharpe ratio race <span class="badge dim">vs buy-and-hold benchmark</span>', '<div class="chart fx-static" id="rc-chart" style="height:420px"></div>')}
      ${UI.panel('Risk vs return', '<div class="chart fx-static" id="rc-sc" style="height:420px"></div>')}</div>
    <div id="rc-tbl"></div>`;
  const paint = rows => {
    const items = rows.map(r => ({ label: r.id + ' ' + r.model, value: r.sharpe, color: r.sharpe > r.bench ? C.UP : r.sharpe > 0 ? C.SERIES[0] : C.DN }));
    if (rows.length) items.push({ label: 'benchmark (avg)', value: Q.mean(rows.map(r => r.bench)), color: C.MUTED });
    C.bars($('rc-chart'), items, { horizontal: true, sorted: true });
    if (rows.length > 1) C.scatter($('rc-sc'), rows.map(r => ({ x: r.vol, y: r.cagr, label: r.id, color: r.sharpe > r.bench ? C.UP : C.SERIES[0], size: 5 })), { pctX: true, pctY: true });
    $('rc-tbl').innerHTML = UI.panel('Leaderboard', `<table class="tbl"><thead><tr><th>#</th><th>ID</th><th>Strategy</th><th>Model</th><th class="r">Sharpe</th><th class="r">Bench SR</th><th class="r">CAGR</th><th class="r">Max DD</th><th class="r">IC</th><th class="r">Time</th></tr></thead><tbody>${
      rows.slice().sort((a, b) => b.sharpe - a.sharpe).map((r, i) => `<tr data-sid="${r.id}" style="cursor:pointer"><td>${i + 1}</td><td>${r.id}</td><td class="t">${AL.fmt.esc(r.name)}</td><td>${AL.fmt.esc(r.model)}</td>
        <td class="r ${r.sharpe > r.bench ? 'up' : ''}">${f.n(r.sharpe)}</td><td class="r">${f.n(r.bench)}</td><td class="r ${f.cls(r.cagr)}">${f.spct(r.cagr)}</td><td class="r dn">${f.pct(r.maxDD)}</td><td class="r">${r.ic != null ? f.n(r.ic, 3) : '-'}</td><td class="r">${r.cached ? '<span class="badge ok">cached</span>' : (r.ms / 1000).toFixed(1) + 's'}</td></tr>`).join('')
    }</tbody></table>`, { nopad: true });
    $('rc-tbl').querySelectorAll('tr[data-sid]').forEach(tr => tr.addEventListener('click', () => UI.openTab('stratDetail', { sid: tr.dataset.sid, forceNew: true }, S.byId[tr.dataset.sid].name)));
  };
  if (fresh) paint(fresh.rows); else { $('rc-chart').innerHTML = '<div class="empty">Press Run to race every model.</div>'; $('rc-sc').innerHTML = ''; }
  $('rc-go').addEventListener('click', () => {
    const rows = []; let i = 0; $('rc-go').disabled = true;
    const next = () => {
      if (!alive(body)) return;
      if (i >= ids.length) { AL.store.set('mlrace', { asof: AL.asof, rows }); $('rc-go').disabled = false; $('rc-st').textContent = `Done. ${rows.filter(r => r.sharpe > r.bench).length} of ${rows.length} models beat their benchmark Sharpe on this data.`; toast('Model race finished', 'ok'); return; }
      const e = S.byId[ids[i]]; $('rc-st').textContent = `training ${e.id} ${e.name}...`;
      setTimeout(() => {
        const t0 = performance.now();
        try {
          const r = S.run(e, {});
          if (r && r.stats) rows.push({ id: e.id, name: e.name, model: e.def.model || e.def.engine || e.def.kind, sharpe: r.stats.sharpe, bench: r.bstats ? r.bstats.sharpe : NaN, cagr: r.stats.cagr, vol: r.stats.vol, maxDD: r.stats.maxDD, ic: r.mlDiag ? r.mlDiag.ic : null, cached: !!(r.wf && r.wf.cached), ms: performance.now() - t0 });
        } catch (err) { console.error(err); }
        i++; $('rc-bar').style.width = (i / ids.length * 100) + '%';
        paint(rows); next();
      }, 20);
    };
    next();
  });
}

function zooTwins(body) {
  const MC = window.ALPHALAB_MLCACHE, tw = MC && MC.twins ? MC.twins : null;
  if (!tw || !Object.keys(tw).length) {
    body.innerHTML = `<div class="info-box">No prebuilt twin scores in this build. Open any strategy and press <b>Train ML twin</b> to score it live in your browser, or run <code>node tools/build_mlcache.js</code> to prebuild all of them.</div>`;
    return;
  }
  const rows = Object.entries(tw).map(([id, t]) => ({ id, ...t, name: S.byId[id] ? S.byId[id].name : id, cat: S.byId[id] ? S.byId[id].cat : '', gain: t.twin - t.base })).filter(r => isFinite(r.base) && isFinite(r.twin));
  rows.sort((a, b) => b.gain - a.gain);
  const better = rows.filter(r => r.gain > 0).length, ddBetter = rows.filter(r => r.twinDD > r.baseDD).length;
  body.innerHTML = `<div class="metrics" style="margin-bottom:12px">${UI.metric('Strategies twinned', rows.length)}${UI.metric('Twin raised Sharpe', better + ' / ' + rows.length, better > rows.length / 2 ? 'up' : '')}${UI.metric('Twin cut max drawdown', ddBetter + ' / ' + rows.length, 'up')}${UI.metric('Median AUC', f.n(Q.quantile(rows.map(r => r.auc).filter(isFinite), 0.5), 3))}${UI.metric('Cache as-of', AL.fmt.esc(MC.asof))}</div>
    <div class="grid g2">${UI.panel('Base Sharpe vs twin Sharpe <span class="badge dim">above the diagonal = the twin helped</span>', '<div class="chart" id="tw-sc" style="height:360px"></div>')}
      ${UI.panel('Biggest improvements', '<div class="chart" id="tw-bars" style="height:360px"></div>')}</div>
    ${UI.panel('Every ML twin <span class="badge dim">meta-labeling overlay, walk-forward, out-of-sample</span>', `<div style="max-height:520px;overflow:auto"><table class="tbl"><thead><tr><th>ID</th><th>Strategy</th><th>Category</th><th>Twin model</th><th class="r">Base SR</th><th class="r">Twin SR</th><th class="r">Base DD</th><th class="r">Twin DD</th><th class="r">AUC</th><th class="r">Precision</th><th class="r">Size today</th><th>Top features</th></tr></thead><tbody>${
      rows.map(r => `<tr data-sid="${r.id}" style="cursor:pointer"><td>${r.id}</td><td class="t">${AL.fmt.esc(r.name)}</td><td>${AL.fmt.esc(r.cat)}</td><td>${AL.fmt.esc(r.model)}</td><td class="r">${f.n(r.base)}</td><td class="r ${r.gain > 0 ? 'up' : 'dn'}">${f.n(r.twin)}</td><td class="r dn">${f.pct(r.baseDD)}</td><td class="r dn">${f.pct(r.twinDD)}</td><td class="r">${f.n(r.auc, 3)}</td><td class="r">${f.pct(r.prec)}</td><td class="r">${f.pct(r.size)}</td><td class="note">${(r.top || []).join(', ')}</td></tr>`).join('')
    }</tbody></table></div>`, { nopad: true })}`;
  const lo = Math.min(...rows.map(r => Math.min(r.base, r.twin)));
  C.scatter($('tw-sc'), rows.map(r => ({ x: r.base, y: r.twin, label: r.id, color: r.gain > 0 ? C.UP : C.DN, size: 4 })).concat([{ x: lo, y: lo, color: C.MUTED, size: 1 }]), {});
  C.bars($('tw-bars'), rows.slice(0, 14).map(r => ({ label: r.id + ' ' + r.model, value: r.gain })), { horizontal: true });
  body.querySelectorAll('tr[data-sid]').forEach(tr => tr.addEventListener('click', () => S.byId[tr.dataset.sid] && UI.openTab('stratDetail', { sid: tr.dataset.sid, forceNew: true }, S.byId[tr.dataset.sid].name)));
}

/* ML twin panel, mounted by the strategy detail page */
UI.twinPanel = function (host, entry, base) {
  if (!host || !base || !base.rets || (entry.def && entry.def.kind === 'meta')) { if (host) host.innerHTML = ''; return; }
  const def = Z.twinModelFor(entry), MC = window.ALPHALAB_MLCACHE, pre = MC && MC.twins && MC.twins[entry.id];
  const models = ['logistic', 'rf', 'extratrees', 'gbdt', 'elasticnet', 'nb', 'svm', 'lstm', 'gru', 'alstm', 'transformer'].filter(m => ML.models[m]);
  host.innerHTML = UI.panel(`ML twin <span class="badge dim">meta-labeling: should this signal be trusted today?</span>`, `
    <div class="controls"><label class="lbl">model</label><select class="inp" id="tw-model">${models.map(m => `<option value="${m}" ${m === def ? 'selected' : ''}>${ML.models[m].name}</option>`).join('')}</select>
      <label class="lbl">sizing</label><select class="inp" id="tw-size"><option value="bet">calibrated bet size</option><option value="filter">on/off filter</option></select>
      <button class="btn primary" id="tw-go">Train ML twin</button>
      <span class="note">${pre ? `Prebuilt: ${AL.fmt.esc(pre.model)} twin Sharpe ${f.n(pre.twin)} vs base ${f.n(pre.base)}, AUC ${f.n(pre.auc, 3)}.` : `Default model for ${AL.fmt.esc(entry.cat)}: ${AL.fmt.esc(ML.models[def] ? ML.models[def].name : def)}.`}</span></div>
    <div id="tw-body"><p class="note" style="line-height:1.6">The twin labels every day the strategy is active with a triple barrier (take profit / stop at 2 sigma, 10-day timeout), learns from 16 context features (strategy momentum and drawdown, SPY trend and vol, VIX, curve, credit, HMM regime, GARCH ratio) whether the signal tends to work in the current context, and scales position size by its causally calibrated confidence. Purged walk-forward with a 5-day embargo.</p></div>`);
  const run = () => {
    const m = $('tw-model').value, sz = $('tw-size').value;
    $('tw-body').innerHTML = spinner(`Training ${ML.models[m].name} twin walk-forward on ${base.rets.length.toLocaleString()} days...`);
    $('tw-go').disabled = true;
    setTimeout(() => {
      let tw;
      try { tw = Z.metaOverlay(base, m, { sizing: sz }); } catch (e) { console.error(e); tw = { ok: false, reason: e.message }; }
      if (!alive(host)) return;
      $('tw-go').disabled = false;
      if (!tw.ok) { $('tw-body').innerHTML = `<div class="warn-box">ML twin unavailable: ${AL.fmt.esc(tw.reason || 'not enough active days')}</div>`; return; }
      const b = tw.baseStats, t = tw.stats;
      $('tw-body').innerHTML = `<div class="metrics" style="margin-bottom:10px">
          ${UI.metric('Sharpe base -> twin', f.n(b.sharpe) + ' -> ' + f.n(t.sharpe), t.sharpe > b.sharpe ? 'up' : 'dn')}
          ${UI.metric('Max DD base -> twin', f.pct(b.maxDD) + ' -> ' + f.pct(t.maxDD), t.maxDD > b.maxDD ? 'up' : 'dn')}
          ${UI.metric('CAGR base -> twin', f.spct(b.cagr) + ' -> ' + f.spct(t.cagr))}
          ${UI.metric('AUC (OOS)', f.n(tw.auc, 3), tw.auc > 0.52 ? 'up' : '')}${UI.metric('Precision', f.pct(tw.precision))}${UI.metric('Base win rate', f.pct(tw.baseRate))}
          ${UI.metric('OOS labels', tw.nOOS.toLocaleString())}${UI.metric('Refits', tw.nFits)}${UI.metric('Size today', f.pct(tw.size[tw.size.length - 1]))}</div>
        <div class="grid g2">${UI.panel('Equity: base vs ML twin', '<div class="chart h260" id="tw-eq"></div>', { nopad: true })}${UI.panel('Twin position size (confidence)', '<div class="chart h260" id="tw-sz"></div>', { nopad: true })}</div>
        ${tw.importance && tw.importance.length ? UI.panel('What the twin looks at <span class="badge dim">feature importance</span>', '<div class="chart" id="tw-imp" style="height:240px"></div>') : ''}
        <div class="note" style="margin-top:6px">${tw.cachedRows ? tw.cachedRows.toLocaleString() + ' rows resumed from the prebuilt cache. ' : ''}${(tw.ms / 1000).toFixed(1)}s.</div>`;
      C.line($('tw-eq'), [{ name: 'ML twin', dates: tw.dates, values: tw.equity.slice(1), color: C.SERIES[4], width: 2 }, { name: 'base', dates: tw.dates, values: tw.baseEquity.slice(1), color: C.MUTED }], { log: true });
      C.line($('tw-sz'), [{ name: 'size', dates: tw.dates, values: tw.size, color: C.SERIES[2], fill: true }], { pct: true });
      if ($('tw-imp')) C.bars($('tw-imp'), tw.importance.slice(0, 12).map(x => ({ label: x.feature, value: x.value ?? x.imp ?? x.importance ?? 0 })), { horizontal: true, sorted: true });
      toast(`ML twin on ${entry.id}: Sharpe ${f.n(b.sharpe)} -> ${f.n(t.sharpe)}`, t.sharpe > b.sharpe ? 'ok' : 'info');
    }, 40);
  };
  $('tw-go').addEventListener('click', run);
};

/* =========================================================
   MODULE: Quant Studio
   ========================================================= */
UI.def('quantstudio', 'Quant Studio', '∑', 'Quant Lab', function (el, state) {
  el.innerHTML = `<div class="section-title">Quant Studio <span class="badge dim">8 labs · real data</span></div><div id="qs-tabs"></div>`;
  subtabs($('qs-tabs'), [['garch', 'GARCH vol'], ['hmm', 'HMM regimes'], ['pairs', 'Pairs + Kalman'], ['factors', 'Factor attribution'], ['options', 'Options lab'], ['overfit', 'Overfitting lab'], ['network', 'Correlation network'], ['ffd', 'Fractional diff']],
    state.view || 'garch', (v, body) => { state.view = v; C.hideTip(); LABS[v](body, state); });
});
const RISKY = ['SPY', 'QQQ', 'IWM', 'EFA', 'EEM', 'TLT', 'GLD', 'HYG', 'XLE', 'XLK', 'XLF', 'NVDA', 'AAPL', 'MSFT', 'BTC-USD', 'ETH-USD', 'CL=F', 'EURUSD=X'];
const LABS = {};

LABS.garch = function (body, state) {
  body.innerHTML = `<div class="controls"><label class="lbl">asset</label>${symSelect('g-sym', RISKY, state.gsym || 'SPY')}<span class="note">GARCH(1,1) by maximum likelihood (port of bashtage/arch), fit on the last 10 years of daily returns.</span></div>
    <div class="metrics" id="g-m" style="margin-bottom:12px">${skeleton(56)}</div>
    <div class="grid g2">${UI.panel('Conditional vs realized volatility (annualized)', '<div class="chart h300" id="g-vol"></div>', { nopad: true })}${UI.panel('Volatility forecast term structure', '<div class="chart h300" id="g-fc"></div>')}</div>
    ${UI.panel('Standardized residuals (should look like unit-variance noise if the model fits)', '<div class="chart h220" id="g-res"></div>')}`;
  const draw = () => {
    const sym = $('g-sym').value; state.gsym = sym;
    const R = AL.returns(sym); const rets = R.values.slice(-2520), dates = R.dates.slice(-2520);
    const g = Z.garch(rets);
    const ann = Math.sqrt(AL.freq(AL.getSeries(sym)) === 52 ? 52 : (sym.endsWith('-USD') ? 365 : 252));
    const rv = Q.rollStd(rets, 21);
    $('g-m').innerHTML = UI.metric('omega', g.omega.toExponential(2)) + UI.metric('alpha (shock)', f.n(g.alpha, 3)) + UI.metric('beta (memory)', f.n(g.beta, 3)) + UI.metric('Persistence', f.n(g.persistence, 3))
      + UI.metric('Half-life', f.n(g.halfLife, 1) + 'd') + UI.metric('Long-run vol', f.pct(g.longRunVol * ann / Math.sqrt(252))) + UI.metric('Tomorrow vol (ann.)', f.pct(g.nextSigma * ann), g.nextSigma * Math.sqrt(252) > g.longRunVol ? 'dn' : 'up') + UI.metric('Realized 21d', f.pct(rv[rv.length - 1] * ann));
    const k = 756, series = [{ name: 'GARCH sigma', dates: dates.slice(-k), values: g.sigma.slice(-k).map(s => s * ann), color: C.SERIES[0], width: 1.8 }, { name: 'realized 21d', dates: dates.slice(-k), values: rv.slice(-k).map(s => s * ann), color: C.SERIES[2] }];
    if (sym === 'SPY' && AL.getSeries('^VIX')) { const vx = AL.getSeries('^VIX'), m = new Map(vx.dates.map((d, i) => [d, vx.values[i] / 100])); series.push({ name: 'VIX (implied)', dates: dates.slice(-k), values: dates.slice(-k).map(d => m.get(d) ?? NaN), color: C.SERIES[5], dash: [4, 3] }); }
    C.line($('g-vol'), series, { pct: true });
    const fc = g.forecast(126).map(s => s * ann), xs = fc.map((_, i) => i + 1);
    xyPlot($('g-fc'), xs, [{ name: 'forecast', values: fc, color: C.SERIES[4], width: 2, fill: true }], { pct: true, xLabel: 'days ahead', hLines: [{ y: g.longRunVol * ann / Math.sqrt(252), label: 'long-run', color: C.MUTED }] });
    const z = rets.slice(-756).map((r, i) => (r - Q.mean(rets)) / g.sigma[g.sigma.length - 756 + i]);
    C.histogram($('g-res'), z, { bins: 50 });
  };
  $('g-sym').addEventListener('change', draw); setTimeout(draw, 20);
};

LABS.hmm = function (body, state) {
  body.innerHTML = `<div class="controls"><label class="lbl">asset</label>${symSelect('h-sym', RISKY, state.hsym || 'SPY')}<label class="lbl">states</label><select class="inp" id="h-k"><option>2</option><option selected>3</option><option>4</option></select><span class="note">Gaussian HMM on (return, log realized vol), Baum-Welch (port of hmmlearn). Causal: yearly refits on an expanding window, forward-filtered probabilities only.</span></div>
    <div id="h-now" style="margin-bottom:12px">${skeleton(60)}</div>
    ${UI.panel('Price with regime shading <span class="badge dim">green calm · amber transition · red stress</span>', '<div class="chart h300" id="h-px"></div>', { nopad: true })}
    <div class="grid g3">${UI.panel('P(stress) over time', '<div class="chart h220" id="h-ps"></div>')}${UI.panel('Transition matrix', '<div class="chart h220" id="h-A"></div>')}${UI.panel('State statistics', '<div id="h-st"></div>')}</div>`;
  const draw = () => {
    const sym = $('h-sym').value, K = +$('h-k').value; state.hsym = sym;
    $('h-px').innerHTML = spinner('fitting HMM...');
    setTimeout(() => {
      const R = AL.returns(sym), h = Z.hmmCausal(R.values, K, { minTrain: 750, refit: 252 });
      const n = R.values.length, k = Math.min(n, 2520), s0 = n - k;
      const px = AL.getSeries(sym), pm = new Map(px.dates.map((d, i) => [d, px.values[i]]));
      const dates = R.dates.slice(s0), probs = h.probs.slice(s0);
      const st = probs.map(p => p ? p.indexOf(Math.max(...p)) : -1);
      const cols = K === 2 ? ['#199e7026', '#e6676738'] : K === 3 ? ['#199e7026', '#c9850030', '#e6676738'] : ['#199e7026', '#3987e526', '#c9850030', '#e6676738'];
      const regions = []; let a = 0;
      for (let i = 1; i <= st.length; i++) if (i === st.length || st[i] !== st[a]) { if (st[a] >= 0) regions.push({ from: a, to: i - 1, color: cols[st[a]] }); a = i; }
      C.line($('h-px'), [{ name: sym, dates, values: dates.map(d => pm.get(d)), color: C.INK, width: 1.4 }], { log: true, regions });
      C.line($('h-ps'), [{ name: 'P(stress)', dates, values: probs.map(p => p ? p[K - 1] : NaN), color: C.DN, fill: true }], { pct: true });
      const M = h.model;
      C.heatmap($('h-A'), M.A, M.A.map((_, i) => 'from ' + i), M.A.map((_, i) => 'to ' + i), { lo: 0, hi: 1, mid: 0, fmt: v => (v * 100).toFixed(1) });
      const names = K === 2 ? ['calm', 'stress'] : K === 3 ? ['calm', 'transition', 'stress'] : ['calm', 'normal', 'transition', 'stress'];
      const ann = sym.endsWith('-USD') ? 365 : 252;
      $('h-st').innerHTML = `<table class="tbl"><thead><tr><th>State</th><th class="r">Mean ret (ann.)</th><th class="r">Vol (ann.)</th><th class="r">Exp. duration</th><th class="r">Time in state</th></tr></thead><tbody>${
        names.map((nm, i) => { const r = R.values.filter((_, t) => h.probs[t] && h.probs[t].indexOf(Math.max(...h.probs[t])) === i); return `<tr><td class="t"><span class="dot" style="background:${cols[i].slice(0, 7)}"></span>${nm}</td><td class="r ${f.cls(Q.mean(r))}">${r.length ? f.spct(Q.mean(r) * ann) : '-'}</td><td class="r">${r.length ? f.pct(Q.std(r) * Math.sqrt(ann)) : '-'}</td><td class="r">${f.n(1 / (1 - M.A[i][i]), 0)}d</td><td class="r">${f.pct(r.length / h.probs.filter(Boolean).length)}</td></tr>`; }).join('')}</tbody></table>`;
      const last = h.probs[h.probs.length - 1] || [];
      const cur = last.indexOf(Math.max(...last));
      $('h-now').innerHTML = `<div class="regime-strip">${names.map((nm, i) => `<div class="rs-cell ${i === cur ? 'on' : ''}" style="--c:${cols[i].slice(0, 7)}"><div class="rs-name">${nm}</div><div class="rs-p">${f.pct(last[i])}</div><div class="rs-bar"><span style="width:${(last[i] || 0) * 100}%"></span></div></div>`).join('')}</div>`;
    }, 30);
  };
  $('h-sym').addEventListener('change', draw); $('h-k').addEventListener('change', draw); draw();
};

const PAIRS = [['XOM', 'CVX'], ['KO', 'PG'], ['V', 'MA'], ['JPM', 'BAC'], ['MSFT', 'AAPL'], ['GOOGL', 'META'], ['GLD', 'SLV'], ['GLD', 'GDX'], ['QQQ', 'XLK'], ['HD', 'WMT'], ['XLE', 'CL=F'], ['SPY', 'QQQ'], ['TLT', 'IEF'], ['HYG', 'LQD'], ['EFA', 'EEM'], ['XLU', 'XLP'], ['BTC-USD', 'ETH-USD'], ['UNH', 'XLV'], ['NVDA', 'AMD'], ['WMT', 'COST'], ['GS', 'MS'], ['CAT', 'DE'], ['XLF', 'JPM'], ['PFE', 'MRK']];
LABS.pairs = function (body, state) {
  const avail = PAIRS.filter(([a, b]) => AL.getSeries(a) && AL.getSeries(b));
  body.innerHTML = `<div class="note" style="margin-bottom:8px">Engle-Granger cointegration scan on 3 years of log prices, then a Kalman filter (port of pykalman, Chan's dynamic hedge) tracks the hedge ratio day by day. Click a pair.</div>
    <div class="grid g2">${UI.panel('Pair scanner <span class="badge dim">sorted by ADF t-stat, more negative = stronger</span>', '<div id="p-tbl">' + skeleton(300) + '</div>', { nopad: true })}
      <div>${UI.panel('<span id="p-title">Kalman hedge ratio</span>', '<div class="chart h220" id="p-beta"></div>', { nopad: true })}${UI.panel('Spread z-score (innovation / its sd)', '<div class="chart h220" id="p-z"></div>', { nopad: true })}<div id="p-sig"></div></div></div>`;
  setTimeout(() => {
    const rows = avail.map(([a, b]) => {
      const al = AL.align([a, b]); if (!al || al.dates.length < 300) return null;
      const la = al.cols[a].slice(-756).map(Math.log), lb = al.cols[b].slice(-756).map(Math.log);
      const c = Q.coint(la, lb);
      const ra = la.slice(1).map((v, i) => v - la[i]), rb = lb.slice(1).map((v, i) => v - lb[i]);
      return { a, b, adf: c.adf, hl: c.halflife, hedge: c.hedge, coint: c.cointegrated, corr: Q.corr(ra, rb) };
    }).filter(Boolean).sort((x, y) => x.adf - y.adf);
    $('p-tbl').innerHTML = `<table class="tbl"><thead><tr><th>Pair</th><th class="r">ADF t</th><th class="r">Half-life</th><th class="r">Hedge</th><th class="r">Ret corr</th><th></th></tr></thead><tbody>${
      rows.map(r => `<tr data-a="${r.a}" data-b="${r.b}" style="cursor:pointer"><td class="t">${r.a} / ${r.b}</td><td class="r ${r.coint ? 'up' : ''}">${f.n(r.adf)}</td><td class="r">${isFinite(r.hl) ? f.n(r.hl, 0) + 'd' : 'inf'}</td><td class="r">${f.n(r.hedge, 2)}</td><td class="r">${f.n(r.corr, 2)}</td><td>${r.coint ? '<span class="badge ok">coint 5%</span>' : ''}</td></tr>`).join('')}</tbody></table>`;
    const pick = (a, b) => {
      $('p-tbl').querySelectorAll('tr[data-a]').forEach(tr => tr.classList.toggle('sel', tr.dataset.a === a && tr.dataset.b === b));
      state.pair = [a, b];
      const al = AL.align([a, b]); const n = Math.min(al.dates.length, 1512);
      const x = al.cols[a].slice(-n).map(Math.log), y = al.cols[b].slice(-n).map(Math.log), d = al.dates.slice(-n);
      const k = Z.kalmanHedge(x, y);
      const z = k.e.map((e, i) => i < 20 ? NaN : e / k.sqrtQ[i]);
      $('p-title').textContent = `Kalman hedge ratio: ${b} = beta x ${a} + alpha`;
      C.line($('p-beta'), [{ name: 'beta', dates: d.slice(20), values: k.beta.slice(20), color: C.SERIES[0], width: 1.8 }]);
      C.line($('p-z'), [{ name: 'z', dates: d.slice(20), values: z.slice(20), color: C.SERIES[4] }], { zeroLine: true, hLines: [{ y: 1, label: '+1', color: C.DN }, { y: -1, label: '-1', color: C.UP }] });
      const zl = z[z.length - 1];
      $('p-sig').innerHTML = `<div class="info-box">Today z = <b>${f.n(zl)}</b>, hedge ratio ${f.n(k.beta[k.beta.length - 1], 3)}. ${zl > 1 ? `Spread rich: short ${b}, long ${f.n(k.beta[k.beta.length - 1], 2)}x ${a}.` : zl < -1 ? `Spread cheap: long ${b}, short ${f.n(k.beta[k.beta.length - 1], 2)}x ${a}.` : 'Inside the band: no trade.'} ${S.byId.S131 && a === 'XOM' ? '<a href="#" id="p-bt">Backtest S131</a>' : ''}</div>`;
      const bt = $('p-bt'); if (bt) bt.addEventListener('click', e => { e.preventDefault(); UI.openTab('stratDetail', { sid: 'S131', forceNew: true }, S.byId.S131.name); });
    };
    $('p-tbl').querySelectorAll('tr[data-a]').forEach(tr => tr.addEventListener('click', () => pick(tr.dataset.a, tr.dataset.b)));
    const p0 = state.pair || (rows[0] && [rows[0].a, rows[0].b]); if (p0) pick(p0[0], p0[1]);
  }, 30);
};

/* multivariate OLS with standard errors */
function ols(X, y) {
  const n = X.length, k = X[0].length;
  const XtX = Array.from({ length: k }, () => new Array(k).fill(0)), Xty = new Array(k).fill(0);
  for (let i = 0; i < n; i++) for (let a = 0; a < k; a++) { Xty[a] += X[i][a] * y[i]; for (let b = 0; b < k; b++) XtX[a][b] += X[i][a] * X[i][b]; }
  const inv = XtX.map((r, i) => [...r, ...r.map((_, j) => i === j ? 1 : 0)]);
  for (let c = 0; c < k; c++) {
    let p = c; for (let r = c + 1; r < k; r++) if (Math.abs(inv[r][c]) > Math.abs(inv[p][c])) p = r;
    [inv[c], inv[p]] = [inv[p], inv[c]];
    const d = inv[c][c] || 1e-12; for (let j = 0; j < 2 * k; j++) inv[c][j] /= d;
    for (let r = 0; r < k; r++) if (r !== c) { const m = inv[r][c]; for (let j = 0; j < 2 * k; j++) inv[r][j] -= m * inv[c][j]; }
  }
  const Ai = inv.map(r => r.slice(k));
  const beta = Ai.map(r => r.reduce((s, v, j) => s + v * Xty[j], 0));
  let sse = 0, sst = 0; const my = Q.mean(y);
  for (let i = 0; i < n; i++) { const e = y[i] - X[i].reduce((s, v, j) => s + v * beta[j], 0); sse += e * e; sst += (y[i] - my) ** 2; }
  const s2 = sse / (n - k);
  return { beta, se: Ai.map((r, i) => Math.sqrt(Math.max(0, r[i] * s2))), r2: 1 - sse / sst, resVol: Math.sqrt(s2) };
}
LABS.factors = function (body, state) {
  const FAC = [['MKT', 'SPY', null], ['SIZE', 'IWM', 'SPY'], ['VALUE', 'VTV', 'VUG'], ['MOM', 'MTUM', 'SPY'], ['QUALITY', 'QUAL', 'SPY'], ['LOWVOL', 'USMV', 'SPY']].filter(([, a, b]) => AL.getSeries(a) && (!b || AL.getSeries(b)));
  const tgts = ['NVDA', 'AAPL', 'MSFT', 'QQQ', 'IWM', 'XLE', 'XLF', 'ARKK', 'TSLA', 'AMZN', 'JPM', 'BRK-B', 'GLD', 'TLT'].filter(s => AL.getSeries(s));
  body.innerHTML = `<div class="controls"><label class="lbl">explain</label><select class="inp" id="fa-t"><optgroup label="Assets">${tgts.map(s => `<option value="sym:${s}" ${state.fat === 'sym:' + s ? 'selected' : ''}>${s}</option>`).join('')}</optgroup>
      <optgroup label="Your portfolio"><option value="book" ${state.fat === 'book' ? 'selected' : ''}>Holdings book</option></optgroup>
      <optgroup label="Strategies">${S.registry.filter(e => e.status === 'ok' && ['single', 'xs', 'pair'].includes(e.def.kind)).slice(0, 60).map(e => `<option value="strat:${e.id}" ${state.fat === 'strat:' + e.id ? 'selected' : ''}>${e.id} ${AL.fmt.esc(e.name.slice(0, 34))}</option>`).join('')}</optgroup></select>
      <label class="lbl">window</label><select class="inp" id="fa-w"><option value="252">1y</option><option value="756" selected>3y</option><option value="1260">5y</option></select>
      <span class="note">Style factors from ETF long-short proxies: SIZE = IWM - SPY, VALUE = VTV - VUG, MOM = MTUM - SPY, QUALITY = QUAL - SPY, LOWVOL = USMV - SPY.</span></div>
    <div class="metrics" id="fa-m" style="margin-bottom:12px">${skeleton(56)}</div>
    <div class="grid g2">${UI.panel('Factor loadings (beta) with 95% intervals', '<div class="chart" id="fa-b" style="height:260px"></div>')}${UI.panel('Return attribution (annualized contribution)', '<div class="chart" id="fa-c" style="height:260px"></div>')}</div>
    ${UI.panel('Rolling 126-day market beta', '<div class="chart h220" id="fa-roll"></div>', { nopad: true })}`;
  const draw = () => {
    const tv = $('fa-t').value, W = +$('fa-w').value; state.fat = tv;
    const syms = [...new Set(FAC.flatMap(([, a, b]) => b ? [a, b] : [a]))];
    const al = AL.align(syms, 'ret'); const dm = new Map(al.dates.map((d, i) => [d, i]));
    let tDates, tRets, label;
    if (tv.startsWith('sym:')) { const R = AL.returns(tv.slice(4)); tDates = R.dates; tRets = R.values; label = tv.slice(4); }
    else if (tv === 'book') {
      const book = AL.store.get('holdings', UI.DEMO_BOOK || []);
      const val = book.map(h => (AL.livePx(h.sym) || (AL.lastClose(h.sym) || {}).last || 0) * h.qty), tot = val.reduce((a, b) => a + b, 0) || 1;
      const ba = AL.align(book.map(h => h.sym).filter(s => AL.getSeries(s)), 'ret');
      if (!ba) { $('fa-m').innerHTML = '<div class="empty">No holdings to explain.</div>'; return; }
      tDates = ba.dates; tRets = ba.dates.map((_, i) => book.reduce((s, h, j) => s + (ba.cols[h.sym] ? ba.cols[h.sym][i] * val[j] / tot : 0), 0)); label = 'holdings book';
    } else { const r = S.run(S.byId[tv.slice(6)], {}); tDates = r.dates; tRets = r.rets; label = tv.slice(6); }
    const X = [], y = [], dts = [];
    for (let i = 0; i < tDates.length; i++) { const j = dm.get(tDates[i]); if (j == null || !isFinite(tRets[i])) continue; X.push([1, ...FAC.map(([, a, b]) => b ? al.cols[a][j] - al.cols[b][j] : al.cols[a][j])]); y.push(tRets[i]); dts.push(tDates[i]); }
    const Xw = X.slice(-W), yw = y.slice(-W);
    if (Xw.length < 60) { $('fa-m').innerHTML = '<div class="empty">Not enough overlapping history.</div>'; return; }
    const r = ols(Xw, yw);
    const alphaAnn = r.beta[0] * 252, tA = r.beta[0] / r.se[0];
    $('fa-m').innerHTML = UI.metric('Target', AL.fmt.esc(label)) + UI.metric('Alpha (ann.)', f.spct(alphaAnn), f.cls(alphaAnn)) + UI.metric('Alpha t-stat', f.n(tA), Math.abs(tA) > 2 ? 'up' : '') + UI.metric('R squared', f.pct(r.r2)) + UI.metric('Idiosyncratic vol', f.pct(r.resVol * Math.sqrt(252))) + UI.metric('Days', Xw.length);
    const items = FAC.map(([nm], i) => ({ label: `${nm} (t ${f.n(r.beta[i + 1] / r.se[i + 1], 1)})`, value: r.beta[i + 1], color: Math.abs(r.beta[i + 1] / r.se[i + 1]) > 2 ? (r.beta[i + 1] > 0 ? C.SERIES[0] : C.SERIES[5]) : C.MUTED }));
    C.bars($('fa-b'), items, { horizontal: true });
    const contrib = FAC.map(([nm], i) => ({ label: nm, value: r.beta[i + 1] * Q.mean(Xw.map(x => x[i + 1])) * 252 }));
    contrib.push({ label: 'alpha', value: alphaAnn, color: C.SERIES[4] });
    C.bars($('fa-c'), contrib, { horizontal: true, pct: true });
    const rb = []; for (let i = 0; i < y.length; i++) { if (i < 126) { rb.push(NaN); continue; } const xs = X.slice(i - 126, i).map(x => x[1]), ys = y.slice(i - 126, i); rb.push(Q.linreg(xs, ys).b); }
    C.line($('fa-roll'), [{ name: 'beta to SPY', dates: dts.slice(-W), values: rb.slice(-W), color: C.SERIES[2], width: 1.8 }], { hLines: [{ y: 1, label: 'beta 1', color: C.MUTED }] });
  };
  $('fa-t').addEventListener('change', draw); $('fa-w').addEventListener('change', draw); setTimeout(draw, 20);
};

/* Black-Scholes-Merton with continuous yield q */
const BS = {
  d1: (S, K, T, r, v, q) => (Math.log(S / K) + (r - q + v * v / 2) * T) / (v * Math.sqrt(T)),
  price(type, S, K, T, r, v, q = 0) {
    if (T <= 0) return Math.max(0, type === 'call' ? S - K : K - S);
    const d1 = BS.d1(S, K, T, r, v, q), d2 = d1 - v * Math.sqrt(T);
    return type === 'call' ? S * Math.exp(-q * T) * Phi(d1) - K * Math.exp(-r * T) * Phi(d2) : K * Math.exp(-r * T) * Phi(-d2) - S * Math.exp(-q * T) * Phi(-d1);
  },
  greeks(type, S, K, T, r, v, q = 0) {
    T = Math.max(T, 1e-6);
    const d1 = BS.d1(S, K, T, r, v, q), d2 = d1 - v * Math.sqrt(T), eq = Math.exp(-q * T), er = Math.exp(-r * T);
    const call = type === 'call';
    return {
      delta: call ? eq * Phi(d1) : eq * (Phi(d1) - 1),
      gamma: eq * npdf(d1) / (S * v * Math.sqrt(T)),
      vega: S * eq * npdf(d1) * Math.sqrt(T) / 100,
      theta: (-S * eq * npdf(d1) * v / (2 * Math.sqrt(T)) + (call ? -1 : 1) * r * K * er * Phi(call ? d2 : -d2) + (call ? 1 : -1) * q * S * eq * Phi(call ? d1 : -d1)) / 365,
      rho: (call ? 1 : -1) * K * T * er * Phi(call ? d2 : -d2) / 100,
    };
  },
};
UI.BS = BS;
LABS.options = function (body, state) {
  const sym = state.osym || 'SPY';
  const rf = (() => { const s = AL.getSeries('DGS3MO'); return s ? s.values[s.values.length - 1] / 100 : 0.04; })();
  body.innerHTML = `<div class="controls"><label class="lbl">underlying</label>${symSelect('o-sym', ['SPY', 'QQQ', 'IWM', 'NVDA', 'AAPL', 'MSFT', 'TSLA', 'GLD', 'TLT', 'BTC-USD'], sym)}
      <label class="lbl">structure</label><select class="inp" id="o-st">${['long call', 'long put', 'covered call', 'protective put', 'straddle', 'strangle', 'bull call spread', 'bear put spread', 'iron condor', 'collar'].map(s => `<option ${s === (state.ost || 'long call') ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <label class="lbl">days</label><input class="inp" id="o-T" style="width:52px" value="${state.oT || 30}">
      <label class="lbl">vol %</label><input class="inp" id="o-v" style="width:56px" value="">
      <label class="lbl">width %</label><input class="inp" id="o-w" style="width:48px" value="${state.ow || 5}">
      <span class="note">r = ${f.pct(rf)} (3M T-bill, FRED). Default vol = GARCH forecast over the option life.</span></div>
    <div class="metrics" id="o-m" style="margin-bottom:12px"></div>
    <div class="grid g2">${UI.panel('Payoff at expiry vs value today', '<div class="chart h300" id="o-pay"></div>')}${UI.panel('Position delta across spot and time', '<div class="chart h300" id="o-surf"></div>')}</div>
    <div class="grid g2">${UI.panel('Legs', '<div id="o-legs"></div>', { nopad: true })}${UI.panel('Probability view (lognormal at the chosen vol)', '<div id="o-prob"></div>')}</div>`;
  const legsFor = (st, S, w) => {
    const K = p => Math.round(S * (1 + p) * 100) / 100;
    return ({
      'long call': [['call', K(0), 1]], 'long put': [['put', K(0), 1]], 'covered call': [['stock', 0, 1], ['call', K(w), -1]], 'protective put': [['stock', 0, 1], ['put', K(-w), 1]],
      'straddle': [['call', K(0), 1], ['put', K(0), 1]], 'strangle': [['call', K(w), 1], ['put', K(-w), 1]], 'bull call spread': [['call', K(0), 1], ['call', K(w), -1]],
      'bear put spread': [['put', K(0), 1], ['put', K(-w), -1]], 'iron condor': [['put', K(-2 * w), 1], ['put', K(-w), -1], ['call', K(w), -1], ['call', K(2 * w), 1]], 'collar': [['stock', 0, 1], ['put', K(-w), 1], ['call', K(w), -1]],
    })[st];
  };
  let garchVol = null;
  const draw = () => {
    const s = $('o-sym').value; if (s !== state.osym) garchVol = null;
    state.osym = s; state.ost = $('o-st').value; state.oT = +$('o-T').value || 30; state.ow = +$('o-w').value || 5;
    const S0 = AL.livePx(s) || AL.lastClose(s).last, T = state.oT / 365, w = state.ow / 100, q = 0;
    const ann = s.endsWith('-USD') ? 365 : 252;
    if (garchVol == null) { const g = Z.garch(AL.returns(s).values.slice(-2520)); const fc = g.forecast(Math.max(1, Math.round(state.oT * ann / 365))); garchVol = Math.sqrt(Q.mean(fc.map(x => x * x)) * ann); $('o-v').value = (garchVol * 100).toFixed(1); }
    const v = (+$('o-v').value || garchVol * 100) / 100;
    const legs = legsFor(state.ost, S0, w);
    const val = (Sx, Tx) => legs.reduce((a, [t, K, n]) => a + n * (t === 'stock' ? Sx : BS.price(t, Sx, K, Tx, rf, v, q)), 0);
    const cost = val(S0, T);
    const G = legs.reduce((a, [t, K, n]) => { if (t === 'stock') { a.delta += n; return a; } const g = BS.greeks(t, S0, K, T, rf, v, q); for (const k in g) a[k] += n * g[k]; return a; }, { delta: 0, gamma: 0, vega: 0, theta: 0, rho: 0 });
    const xs = Array.from({ length: 121 }, (_, i) => S0 * (0.7 + 0.6 * i / 120));
    const expiry = xs.map(x => val(x, 0) - cost), today = xs.map(x => val(x, T) - cost), mid = xs.map(x => val(x, T / 2) - cost);
    const bes = []; for (let i = 1; i < xs.length; i++) if (Math.sign(expiry[i]) !== Math.sign(expiry[i - 1]) && expiry[i] !== 0) bes.push(xs[i - 1] + (xs[i] - xs[i - 1]) * (-expiry[i - 1]) / (expiry[i] - expiry[i - 1]));
    $('o-m').innerHTML = UI.metric('Spot', AL.fmt.px(S0)) + UI.metric('Net premium', (cost >= 0 ? 'pay ' : 'receive ') + AL.fmt.px(Math.abs(cost))) + UI.metric('Delta', f.n(G.delta, 3)) + UI.metric('Gamma', f.n(G.gamma, 4)) + UI.metric('Vega / 1 vol pt', f.n(G.vega, 3)) + UI.metric('Theta / day', f.n(G.theta, 3), G.theta < 0 ? 'dn' : 'up') + UI.metric('Rho / 1%', f.n(G.rho, 3)) + UI.metric('Break-even', bes.map(b => AL.fmt.px(b)).join(' / ') || '-');
    xyPlot($('o-pay'), xs, [{ name: 'at expiry', values: expiry, color: C.SERIES[0], width: 2 }, { name: 'halfway', values: mid, color: C.SERIES[4], dash: [4, 3] }, { name: 'today', values: today, color: C.SERIES[2] }], { zero: true, xLabel: 'spot', xFmt: v => AL.fmt.px(v), yFmt: v => AL.fmt.n(v, Math.abs(cost) < 20 ? 1 : 0), vLines: [{ x: S0, label: 'spot', color: C.MUTED }] });
    const Ks = Array.from({ length: 11 }, (_, i) => S0 * (0.85 + 0.03 * i)), days = [state.oT, Math.round(state.oT * 0.75), Math.round(state.oT / 2), Math.round(state.oT / 4), 1];
    const M = Ks.map(sx => days.map(d => legs.reduce((a, [t, K, n]) => a + n * (t === 'stock' ? 1 : BS.greeks(t, sx, K, d / 365, rf, v, q).delta), 0))).reverse();
    C.heatmap($('o-surf'), M, Ks.slice().reverse().map(x => AL.fmt.px(x)), days.map(d => d + 'd left'), { lo: -1, hi: 1, fmt: v => v.toFixed(2), padL: 60 });
    $('o-legs').innerHTML = `<table class="tbl"><thead><tr><th>Leg</th><th class="r">Strike</th><th class="r">Qty</th><th class="r">Price</th><th class="r">Delta</th></tr></thead><tbody>${legs.map(([t, K, n]) => `<tr><td class="t">${t}</td><td class="r">${t === 'stock' ? '-' : AL.fmt.px(K)}</td><td class="r ${n > 0 ? 'up' : 'dn'}">${n > 0 ? '+' : ''}${n}</td><td class="r">${t === 'stock' ? AL.fmt.px(S0) : AL.fmt.px(BS.price(t, S0, K, T, rf, v, q))}</td><td class="r">${t === 'stock' ? '1.000' : f.n(BS.greeks(t, S0, K, T, rf, v, q).delta, 3)}</td></tr>`).join('')}</tbody></table>`;
    const pAbove = x => 1 - Phi((Math.log(x / S0) - (rf - v * v / 2) * T) / (v * Math.sqrt(T)));
    let pp = 0; for (let i = 0; i < 400; i++) { const z = invNorm((i + 0.5) / 400), sx = S0 * Math.exp((rf - v * v / 2) * T + v * Math.sqrt(T) * z); if (val(sx, 0) - cost > 0) pp++; }
    $('o-prob').innerHTML = `<div class="kv"><span class="k">P(profit at expiry)</span><span class="v">${f.pct(pp / 400)}</span></div>
      <div class="kv"><span class="k">1-sigma range at expiry</span><span class="v">${AL.fmt.px(S0 * Math.exp(-v * Math.sqrt(T)))} to ${AL.fmt.px(S0 * Math.exp(v * Math.sqrt(T)))}</span></div>
      <div class="kv"><span class="k">P(spot above +${state.ow}%)</span><span class="v">${f.pct(pAbove(S0 * (1 + w)))}</span></div>
      <div class="kv"><span class="k">P(spot below -${state.ow}%)</span><span class="v">${f.pct(1 - pAbove(S0 * (1 - w)))}</span></div>
      <div class="note" style="margin-top:8px">Prices are model values from Black-Scholes-Merton at the chosen vol, not market quotes. Check the approved-securities list before assuming options are tradable in your competition account.</div>`;
  };
  ['o-sym', 'o-st'].forEach(id => $(id).addEventListener('change', draw));
  ['o-T', 'o-v', 'o-w'].forEach(id => $(id).addEventListener('change', draw));
  setTimeout(draw, 20);
};

LABS.overfit = function (body, state) {
  body.innerHTML = `<div class="info-box" style="margin-bottom:10px">If you test many strategies and keep the best, its Sharpe is biased upward. This lab measures that bias on the strategies in this app: the <b>Deflated Sharpe Ratio</b> (Bailey and Lopez de Prado, 2014) corrects the winner's Sharpe for the number of trials and fat tails, and <b>PBO via CSCV</b> (combinatorially symmetric cross-validation) estimates the probability that the in-sample winner is below median out of sample.</div>
    <div class="controls"><label class="lbl">trials</label><select class="inp" id="of-n"><option value="20">20 strategies</option><option value="40" selected>40 strategies</option><option value="80">80 strategies</option><option value="999">all classic strategies</option></select>
      <label class="lbl">window</label><select class="inp" id="of-w"><option value="1260">5y</option><option value="2520" selected>10y</option></select>
      <button class="btn primary" id="of-go">Run</button><span class="note" id="of-st"></span></div>
    <div class="progress" style="margin-bottom:10px"><div id="of-bar" style="width:0%"></div></div>
    <div class="metrics" id="of-m" style="margin-bottom:12px"></div>
    <div class="grid g2">${UI.panel('CSCV logit distribution <span class="badge dim">mass left of 0 = overfit</span>', '<div class="chart h260" id="of-h"></div>')}${UI.panel('In-sample vs out-of-sample Sharpe of the IS winner (each split)', '<div class="chart h260" id="of-sc"></div>')}</div>
    ${UI.panel('Sharpe of every trial', '<div class="chart" id="of-all" style="height:280px"></div>')}`;
  $('of-go').addEventListener('click', () => {
    const N = +$('of-n').value, W = +$('of-w').value;
    const pool = S.registry.filter(e => e.status === 'ok' && !['ml', 'meta'].includes(e.def.kind) && e.cat !== 'Crypto').slice(0, N);
    const spy = AL.returns('SPY'), cal = spy.dates.slice(-W), cm = new Map(cal.map((d, i) => [d, i]));
    const cols = [], names = []; let i = 0; $('of-go').disabled = true;
    const next = () => {
      if (!alive(body)) return;
      if (i >= pool.length) { $('of-go').disabled = false; finish(); return; }
      const e = pool[i]; $('of-st').textContent = `backtesting ${e.id} (${i + 1}/${pool.length})`;
      setTimeout(() => {
        try { const r = S.run(e, {}); if (r && r.rets) { const col = new Array(cal.length).fill(0); r.dates.forEach((d, k) => { const j = cm.get(d); if (j != null && isFinite(r.rets[k])) col[j] = r.rets[k]; }); if (col.filter(x => x !== 0).length > cal.length * 0.5) { cols.push(col); names.push(e.id); } } } catch (err) { }
        i++; $('of-bar').style.width = (i / pool.length * 100) + '%'; next();
      }, 5);
    };
    const finish = () => {
      const Nn = cols.length, T = cal.length;
      if (Nn < 4) { $('of-st').textContent = 'not enough strategies with history'; return; }
      const srs = cols.map(sharpeOf), best = srs.indexOf(Math.max(...srs));
      const srP = srs.map(s => s / Math.sqrt(252)), V = Q.std(srP) ** 2, g = 0.5772156649;
      const SR0 = Math.sqrt(V) * ((1 - g) * invNorm(1 - 1 / Nn) + g * invNorm(1 - 1 / (Nn * Math.E)));
      const mo = moments(cols[best]), sr = srP[best];
      const dsr = Phi((sr - SR0) * Math.sqrt(T - 1) / Math.sqrt(Math.max(1e-9, 1 - mo.skew * sr + (mo.kurt - 1) / 4 * sr * sr)));
      const psr = Phi(sr * Math.sqrt(T - 1) / Math.sqrt(Math.max(1e-9, 1 - mo.skew * sr + (mo.kurt - 1) / 4 * sr * sr)));
      // CSCV with 10 blocks -> 252 splits
      const Sb = 10, L = Math.floor(T / Sb);
      const st = cols.map(c => Array.from({ length: Sb }, (_, b) => { let s = 0, s2 = 0; for (let t = b * L; t < (b + 1) * L; t++) { s += c[t]; s2 += c[t] * c[t]; } return [s, s2]; }));
      const srFrom = (sb, mask) => { let s = 0, s2 = 0, n = 0; for (let b = 0; b < Sb; b++) if (mask[b]) { s += sb[b][0]; s2 += sb[b][1]; n += L; } const m = s / n, v = s2 / n - m * m; return v > 0 ? m / Math.sqrt(v) * Math.sqrt(252) : 0; };
      const logits = [], pts = [];
      const combos = []; (function rec(start, pick) { if (pick.length === Sb / 2) { combos.push(pick.slice()); return; } for (let b = start; b < Sb; b++) { pick.push(b); rec(b + 1, pick); pick.pop(); } })(0, []);
      for (const cb of combos) {
        const mask = Array.from({ length: Sb }, (_, b) => cb.includes(b)), inv = mask.map(x => !x);
        const is = st.map(sb => srFrom(sb, mask)), oos = st.map(sb => srFrom(sb, inv));
        const w = is.indexOf(Math.max(...is));
        const rank = oos.filter(x => x < oos[w]).length + 1, om = rank / (Nn + 1);
        logits.push(Math.log(om / (1 - om))); pts.push({ x: is[w], y: oos[w], color: oos[w] < Q.quantile(oos, 0.5) ? C.DN + 'aa' : C.UP + 'aa', size: 3, label: names[w] });
      }
      const pbo = logits.filter(l => l <= 0).length / logits.length;
      $('of-st').textContent = `${Nn} strategies x ${T} days, ${combos.length} CSCV splits`;
      $('of-m').innerHTML = UI.metric('Trials', Nn) + UI.metric('Best in-sample', names[best]) + UI.metric('Best Sharpe (raw)', f.n(srs[best]), 'up') + UI.metric('Expected max SR from luck', f.n(SR0 * Math.sqrt(252))) + UI.metric('PSR (SR > 0)', f.pct(psr)) + UI.metric('Deflated Sharpe', f.pct(dsr), dsr > 0.95 ? 'up' : 'dn') + UI.metric('PBO', f.pct(pbo), pbo < 0.3 ? 'up' : pbo < 0.5 ? '' : 'dn') + UI.metric('Verdict', dsr > 0.95 && pbo < 0.5 ? 'survives' : 'likely luck', dsr > 0.95 && pbo < 0.5 ? 'up' : 'dn');
      C.histogram($('of-h'), logits, { bins: 24 });
      C.scatter($('of-sc'), pts, {});
      C.bars($('of-all'), names.map((n, k) => ({ label: n, value: srs[k], color: k === best ? C.SERIES[2] : srs[k] > SR0 * Math.sqrt(252) ? C.SERIES[0] : C.MUTED })), { sorted: true });
      toast(`Overfitting lab: DSR ${f.pct(dsr)}, PBO ${f.pct(pbo)}`, 'info');
    };
    next();
  });
};

LABS.network = function (body, state) {
  const syms = ['SPY', 'QQQ', 'IWM', 'EFA', 'EEM', 'TLT', 'IEF', 'SHY', 'TIP', 'LQD', 'HYG', 'GLD', 'SLV', 'DBC', 'VNQ', 'XLE', 'XLF', 'XLK', 'XLV', 'XLU', 'XLP', 'XLY', 'XLI', 'BTC-USD', 'ETH-USD', 'CL=F', 'EURUSD=X', 'NVDA', 'AAPL', 'JPM'].filter(s => AL.getSeries(s));
  const cls = s => /TLT|IEF|SHY|TIP|LQD|HYG/.test(s) ? 1 : /GLD|SLV|DBC|CL=F/.test(s) ? 2 : /-USD/.test(s) ? 3 : /EURUSD/.test(s) ? 4 : /^XL/.test(s) ? 5 : 0;
  const palette = [C.SERIES[0], C.SERIES[2], '#e8a33d', C.SERIES[4], C.SERIES[6], C.SERIES[1]];
  body.innerHTML = `<div class="controls"><label class="lbl">lookback</label><select class="inp" id="n-lb"><option value="63">3 months</option><option value="126" selected>6 months</option><option value="252">1 year</option></select>
      <label class="lbl">edge |rho| &gt;</label><select class="inp" id="n-th"><option>0.4</option><option selected>0.6</option><option>0.75</option></select>
      <span class="note">Nodes pull together when returns co-move. Solid lines are the minimum spanning tree (Mantegna 1999); blue = positive, red = negative correlation.</span>
      <span class="legend">${['equity', 'rates / credit', 'commodities', 'crypto', 'FX', 'sectors'].map((n, i) => `<span><i style="background:${palette[i]}"></i>${n}</span>`).join('')}</span></div>
    <div class="panel"><div class="panel-body nopad"><div id="n-cv" style="height:540px;position:relative"></div></div></div>`;
  const draw = () => {
    const lb = +$('n-lb').value, th = +$('n-th').value;
    const al = AL.align(syms, 'ret'), k = syms.length;
    const M = Q.corrMatrix(al.cols, syms, lb);
    const edges = []; for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) edges.push({ i, j, r: M[i][j], d: Math.sqrt(2 * (1 - M[i][j])) });
    const par = syms.map((_, i) => i), find = x => par[x] === x ? x : (par[x] = find(par[x]));
    const mst = new Set(); edges.slice().sort((a, b) => a.d - b.d).forEach(e => { const a = find(e.i), b = find(e.j); if (a !== b) { par[a] = b; mst.add(e); } });
    const show = edges.filter(e => mst.has(e) || Math.abs(e.r) > th);
    const host = $('n-cv'); const { cv, ctx, W, H } = canvasIn(host); host.classList.add('fx-static');
    const rnd = AL.rng(3);
    const P = syms.map((s, i) => ({ x: W / 2 + Math.cos(i / k * 6.283) * W * 0.3, y: H / 2 + Math.sin(i / k * 6.283) * H * 0.35, vx: 0, vy: 0 }));
    let frame = 0, hover = -1;
    const tick = () => {
      if (!alive(host)) return;
      const cool = Math.max(0.05, 1 - frame / 260);
      for (let a = 0; a < k; a++) for (let b = a + 1; b < k; b++) { const dx = P[b].x - P[a].x, dy = P[b].y - P[a].y, d2 = dx * dx + dy * dy + 0.01, fr = 2400 / d2, d = Math.sqrt(d2); P[a].vx -= fr * dx / d; P[a].vy -= fr * dy / d; P[b].vx += fr * dx / d; P[b].vy += fr * dy / d; }
      for (const e of show) { const a = P[e.i], b = P[e.j], dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy) + 0.01, L = 60 + 140 * (1 - Math.max(0, e.r)), fs = (d - L) * 0.02 * (mst.has(e) ? 1.4 : 0.6) * (e.r > 0 ? 1 : 0.3); a.vx += fs * dx / d; a.vy += fs * dy / d; b.vx -= fs * dx / d; b.vy -= fs * dy / d; }
      for (const p of P) { p.vx += (W / 2 - p.x) * 0.002; p.vy += (H / 2 - p.y) * 0.002; p.x += p.vx * cool * 0.5; p.y += p.vy * cool * 0.5; p.vx *= 0.6; p.vy *= 0.6; p.x = Math.max(30, Math.min(W - 30, p.x)); p.y = Math.max(24, Math.min(H - 24, p.y)); }
      ctx.clearRect(0, 0, W, H);
      for (const e of show) {
        const on = hover < 0 || e.i === hover || e.j === hover;
        ctx.strokeStyle = (e.r >= 0 ? '#3987e5' : '#e66767') + (on ? (mst.has(e) ? 'cc' : '55') : '14');
        ctx.lineWidth = mst.has(e) ? 1 + 3 * Math.abs(e.r) : 1; ctx.setLineDash(mst.has(e) ? [] : [3, 4]);
        ctx.beginPath(); ctx.moveTo(P[e.i].x, P[e.i].y); ctx.lineTo(P[e.j].x, P[e.j].y); ctx.stroke(); ctx.setLineDash([]);
        if (on && hover >= 0) { ctx.fillStyle = C.INK2; ctx.font = '9px Consolas'; ctx.fillText(e.r.toFixed(2), (P[e.i].x + P[e.j].x) / 2, (P[e.i].y + P[e.j].y) / 2); }
      }
      P.forEach((p, i) => {
        const deg = show.filter(e => e.i === i || e.j === i).length, rr = 6 + Math.min(10, deg * 1.3);
        ctx.fillStyle = palette[cls(syms[i])] + (hover < 0 || hover === i ? '' : '55');
        ctx.beginPath(); ctx.arc(p.x, p.y, rr, 0, 7); ctx.fill(); ctx.strokeStyle = C.SURF; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = hover < 0 || hover === i ? C.INK : C.MUTED; ctx.font = '600 10px system-ui, sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(syms[i].replace('=X', '').replace('=F', '').replace('-USD', ''), p.x, p.y - rr - 4); ctx.textAlign = 'left';
      });
      frame++;
      if (frame < 320 || hover >= 0) requestAnimationFrame(tick);
    };
    cv.addEventListener('mousemove', ev => {
      const r = cv.getBoundingClientRect(), mx = ev.clientX - r.left, my = ev.clientY - r.top;
      let h = -1; P.forEach((p, i) => { if (Math.hypot(p.x - mx, p.y - my) < 14) h = i; });
      if (h !== hover) { const was = hover; hover = h; if (was < 0 && frame >= 320) requestAnimationFrame(tick); }
    });
    cv.addEventListener('mouseleave', () => { hover = -1; });
    requestAnimationFrame(tick);
  };
  $('n-lb').addEventListener('change', draw); $('n-th').addEventListener('change', draw); setTimeout(draw, 20);
};

LABS.ffd = function (body, state) {
  body.innerHTML = `<div class="controls"><label class="lbl">asset</label>${symSelect('d-sym', RISKY, state.dsym || 'SPY')}<label class="lbl">d</label><input type="range" id="d-d" min="0" max="1" step="0.05" value="${state.dd ?? 0.4}" style="width:180px"><b id="d-dv" class="num"></b>
      <span class="note">Fractional differencing (Lopez de Prado, AFML ch. 5): the smallest d that makes log price stationary keeps the most memory. Returns (d = 1) are stationary but forget everything.</span></div>
    <div class="grid g2">${UI.panel('ADF t-stat and memory kept, by d', '<div class="chart h260" id="d-tab"></div>')}${UI.panel('FFD weights', '<div class="chart h260" id="d-w"></div>')}</div>
    ${UI.panel('<span id="d-title">Fractionally differenced series</span>', '<div class="chart h260" id="d-ser"></div>', { nopad: true })}`;
  let cache = null;
  const draw = () => {
    const sym = $('d-sym').value, d = +$('d-d').value; state.dsym = sym; state.dd = d; $('d-dv').textContent = d.toFixed(2);
    const px = AL.getSeries(sym), lp = px.values.slice(-3000).map(Math.log), dates = px.dates.slice(-3000);
    if (!cache || cache.sym !== sym) cache = { sym, mf: Z.minFFD(lp) };
    const t = cache.mf.table;
    xyPlot($('d-tab'), t.map(r => r.d), [{ name: 'ADF t-stat', values: t.map(r => r.adf), color: C.SERIES[0], width: 2 }, { name: 'corr with log price x10', values: t.map(r => r.corr * 10), color: C.SERIES[2], width: 2 }], { xLabel: 'd', xFmt: v => v.toFixed(1), hLines: [{ y: -2.86, label: '5% critical', color: C.DN }], vLines: [{ x: cache.mf.d, label: 'd* = ' + cache.mf.d, color: C.UP }] });
    const w = Z.ffdWeights(d, 1e-4, 120);
    C.bars($('d-w'), w.slice(0, 40).map((v, i) => ({ label: 'k' + i, value: v, color: v >= 0 ? C.SERIES[0] : C.SERIES[5] })), {});
    const fd = Z.fracDiff(lp, d);
    const adf = Q.adf(fd.values.filter(isFinite));
    $('d-title').innerHTML = `FFD(${d.toFixed(2)}) of log ${sym}: ADF ${f.n(adf.t)} ${adf.t < -2.86 ? '<span class="badge ok">stationary</span>' : '<span class="badge warn">not stationary</span>'}`;
    C.line($('d-ser'), [{ name: 'FFD', dates, values: fd.values, color: C.SERIES[4], width: 1.3 }]);
  };
  $('d-sym').addEventListener('change', draw); $('d-d').addEventListener('input', AL.debounce ? AL.debounce(draw, 60) : draw); setTimeout(draw, 20);
};

/* =========================================================
   MODULE: Competition Desk (Wharton Global High School Investment Competition)
   ========================================================= */
const COMP = {
  name: 'Wharton Global High School Investment Competition 2026-2027',
  site: 'https://globalyouth.wharton.upenn.edu/competitions/investment-competition/',
  milestones: [
    { d: '2026-09-15T09:00:00-04:00', label: 'Case materials released', short: 'Materials' },
    { d: '2026-09-15T09:00:00-04:00', end: '2026-09-25T16:00:00-04:00', label: 'Practice trading period', short: 'Practice' },
    { d: '2026-09-28T09:30:00-04:00', label: 'Official trading opens in WInS', short: 'Trading opens' },
    { d: '2026-10-10T16:00:00-04:00', label: 'First trade must be placed (4:00 pm ET)', short: 'First trade due', key: true },
    { d: '2026-12-05T16:00:00-05:00', label: 'Trading period ends', short: 'Trading ends' },
  ],
};
const ipsDefault = { client: '', objective: 'balanced growth', risk: 3, horizon: 'long-term (5+ years)', liquidity: 'low', income: false, esg: '', maxPos: 15, minPos: 10, maxSector: 35, cashMin: 3, target: 7, maxDD: 20, notes: '' };
const RISK_TGT = { 1: { vol: 0.06, beta: [0.1, 0.4], eq: [15, 35] }, 2: { vol: 0.09, beta: [0.3, 0.7], eq: [30, 55] }, 3: { vol: 0.13, beta: [0.6, 1.0], eq: [50, 75] }, 4: { vol: 0.17, beta: [0.8, 1.2], eq: [70, 90] }, 5: { vol: 0.22, beta: [1.0, 1.5], eq: [85, 100] } };
const BOND = /^(TLT|IEF|SHY|TIP|LQD|HYG|AGG|BND|GOVT|VGSH|VGIT|BIL|SGOV|MUB|EMB)$/;
const CASHLIKE = /^(BIL|SGOV|SHV)$/;

function bookStats() {
  const book = AL.store.get('holdings', UI.DEMO_BOOK || []).filter(h => AL.getSeries(h.sym));
  const cash = AL.store.get('cash', null) || 0;
  const px = s => AL.livePx(s) || (AL.lastClose(s) || {}).last || 0;
  const vals = book.map(h => px(h.sym) * h.qty), inv = vals.reduce((a, b) => a + b, 0), tot = inv + cash;
  if (!book.length || !tot) return { book, n: 0, tot, cash };
  const w = vals.map(v => v / tot);
  const al = AL.align([...new Set([...book.map(h => h.sym), 'SPY'])], 'ret');
  const L = Math.min(252, al.dates.length);
  const pr = al.dates.slice(-L).map((_, i) => book.reduce((s, h, j) => s + w[j] * al.cols[h.sym][al.dates.length - L + i], 0));
  const spy = al.cols.SPY.slice(-L);
  const beta = Q.linreg(spy, pr).b, vol = Q.std(pr) * Math.sqrt(252);
  let eq = 1, pk = 1, mdd = 0; for (const r of pr) { eq *= 1 + r; pk = Math.max(pk, eq); mdd = Math.min(mdd, eq / pk - 1); }
  const sect = {}; book.forEach((h, j) => { const fu = AL.fund(h.sym); const sc = BOND.test(h.sym) ? 'Fixed income' : (fu && fu.sector) || (h.sym.endsWith('-USD') ? 'Crypto' : 'ETF / other'); sect[sc] = (sect[sc] || 0) + w[j]; });
  const bondW = book.reduce((s, h, j) => s + (BOND.test(h.sym) && !CASHLIKE.test(h.sym) ? w[j] : 0), 0), cashW = cash / tot + book.reduce((s, h, j) => s + (CASHLIKE.test(h.sym) ? w[j] : 0), 0);
  return { book, n: book.length, tot, cash, w, beta, vol, mdd, sharpe: sharpeOf(pr), cagr: eq - 1, maxW: Math.max(...w), maxSym: book[w.indexOf(Math.max(...w))].sym, sect, eqW: 1 - bondW - cashW, bondW, cashW, pr, dates: al.dates.slice(-L) };
}
function alignScore(ips, bs) {
  const rt = RISK_TGT[ips.risk] || RISK_TGT[3];
  const band = (x, lo, hi, soft) => x >= lo && x <= hi ? 100 : Math.max(0, 100 - Math.min(Math.abs(x - lo), Math.abs(x - hi)) / soft * 100);
  const maxSect = Math.max(0, ...Object.entries(bs.sect || {}).filter(([k]) => k !== 'Fixed income').map(([, v]) => v));
  const checks = [
    ['Volatility vs risk tolerance', band(bs.vol, 0, rt.vol * 1.15, rt.vol * 0.6), `${f.pct(bs.vol)} realized vs ${f.pct(rt.vol)} target`],
    ['Market beta in band', band(bs.beta, rt.beta[0], rt.beta[1], 0.4), `beta ${f.n(bs.beta)} vs ${rt.beta[0]}-${rt.beta[1]}`],
    ['Equity allocation in band', band(bs.eqW * 100, rt.eq[0], rt.eq[1], 25), `${f.pct(bs.eqW)} vs ${rt.eq[0]}-${rt.eq[1]}%`],
    ['Largest position under cap', band(bs.maxW * 100, 0, ips.maxPos, 10), `${bs.maxSym} ${f.pct(bs.maxW)} vs ${ips.maxPos}% cap`],
    ['Sector concentration', band(maxSect * 100, 0, ips.maxSector, 20), `largest sector ${f.pct(maxSect)} vs ${ips.maxSector}%`],
    ['Diversification (positions)', band(bs.n, ips.minPos, 40, 6), `${bs.n} positions, minimum ${ips.minPos}`],
    ['Cash buffer for liquidity', band(bs.cashW * 100, ips.cashMin, 25, 6), `${f.pct(bs.cashW)} vs ${ips.cashMin}% minimum`],
    ['Drawdown within tolerance', band(-bs.mdd * 100, 0, ips.maxDD, 12), `1y max DD ${f.pct(bs.mdd)} vs ${ips.maxDD}%`],
  ];
  if (ips.esg) { const ex = ips.esg.toUpperCase().split(/[\s,]+/).filter(Boolean); const hit = bs.book.filter(h => ex.includes(h.sym) || ex.some(x => ((AL.fund(h.sym) || {}).sector || '').toUpperCase().includes(x))); checks.push(['Exclusions respected', hit.length ? 0 : 100, hit.length ? 'holds excluded: ' + hit.map(h => h.sym).join(', ') : 'no excluded names held']); }
  return { checks, score: Q.mean(checks.map(c => c[1])) };
}

UI.def('compdesk', 'Competition Desk', '◎', 'Start Here', function (el, state) {
  el.innerHTML = `<div class="section-title">Competition Desk <span class="badge dim">Wharton Global High School Investment Competition</span><span style="flex:1"></span><a class="btn small" href="${COMP.site}" target="_blank" rel="noopener">Official site</a></div>
    <div id="cd-tabs"></div>`;
  subtabs($('cd-tabs'), [['clock', 'Countdown'], ['ips', 'Client IPS'], ['score', 'Alignment score'], ['journal', 'Trade journal'], ['judges', 'Judge prep'], ['brief', 'Strategy brief']], state.view || 'clock', (v, body) => { state.view = v; C.hideTip(); DESK[v](body, state); });
});
const DESK = {};
DESK.clock = function (body) {
  const ms = COMP.milestones, now = Date.now();
  const t0 = Date.parse(ms[0].d), t1 = Date.parse(ms[ms.length - 1].d);
  const next = ms.find(m => Date.parse(m.d) > now) || null;
  body.innerHTML = `<div class="count-hero">
      <div class="ch-label">${next ? AL.fmt.esc(next.label) : 'Trading period complete'}</div>
      <div class="ch-clock" id="cd-clock"></div>
      <div class="ch-sub">${next ? new Date(next.d).toLocaleString(undefined, { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }) : ''}</div></div>
    <div class="panel"><div class="panel-body"><div class="timeline" id="cd-tl">
      <div class="tl-track"><div class="tl-fill" style="width:${Math.max(0, Math.min(100, (now - t0) / (t1 - t0) * 100))}%"></div></div>
      ${ms.map(m => { const p = (Date.parse(m.d) - t0) / (t1 - t0) * 100; const done = Date.parse(m.end || m.d) < now; return `<div class="tl-pt ${done ? 'done' : ''} ${m.key ? 'key' : ''}" style="left:${p}%"><span class="tl-dot"></span><span class="tl-lab">${AL.fmt.esc(m.short)}<br><small>${m.d.slice(5, 10)}</small></span></div>`; }).join('')}
      <div class="tl-now" style="left:${Math.max(0, Math.min(100, (now - t0) / (t1 - t0) * 100))}%"><span>today</span></div>
    </div></div></div>
    <div class="grid g2">
      ${UI.panel('Key dates', `<table class="tbl">${ms.map(m => `<tr><td class="t">${AL.fmt.esc(m.label)}</td><td class="r">${m.d.slice(0, 10)}${m.end ? ' to ' + m.end.slice(0, 10) : ''}</td><td class="r">${Date.parse(m.end || m.d) < now ? '<span class="badge ok">done</span>' : '<span class="badge dim">upcoming</span>'}</td></tr>`).join('')}</table>`, { nopad: true })}
      ${UI.panel('How this app maps to the competition', `<div class="kv"><span class="k">Where trades happen</span><span class="v" style="font-family:var(--sans)">WInS (Wharton Investment Simulator)</span></div>
        <div class="kv"><span class="k">What judges weigh</span><span class="v" style="font-family:var(--sans)">fit to the client objective, research, communication</span></div>
        <div class="kv"><span class="k">Team</span><span class="v" style="font-family:var(--sans)">4 to 6 students, one teacher advisor</span></div>
        <div class="note" style="margin-top:10px;line-height:1.6">AlphaLab is your research desk: build the IPS from the client case here, test ideas on real data, keep the trade journal, then place orders yourself in WInS using only securities on the competition's approved list. Numbers here are research estimates, not WInS account values. Dates above are from the official site; check it for changes.</div>`)}
    </div>
    <div class="grid g4" id="cd-quick">
      ${[['ips', 'Write the client IPS', 'Objective, risk, horizon, constraints'], ['score', 'Check alignment', 'Does the book fit the client?'], ['journal', 'Log a trade', 'Thesis, sizing and exit for every order'], ['brief', 'Print the strategy brief', 'One-page defense for the judges']].map(([v, a, b]) => `<div class="tile quick" data-v="${v}"><div class="t-label"><span>${a}</span></div><div class="note" style="margin-top:6px">${b}</div></div>`).join('')}
    </div>`;
  body.querySelectorAll('.tile.quick').forEach(t => t.addEventListener('click', () => { const tb = UI.currentTab(); tb.state.view = t.dataset.v; UI.renderActive(); }));
  const clock = $('cd-clock');
  const tick = () => {
    if (!alive(clock)) { clearInterval(iv); return; }
    if (!next) { clock.textContent = 'done'; return; }
    let s = Math.max(0, Math.floor((Date.parse(next.d) - Date.now()) / 1000));
    const dd = Math.floor(s / 86400); s -= dd * 86400; const hh = Math.floor(s / 3600); s -= hh * 3600; const mm = Math.floor(s / 60); s -= mm * 60;
    clock.innerHTML = [[dd, 'days'], [hh, 'hrs'], [mm, 'min'], [s, 'sec']].map(([v, l]) => `<span class="cc"><b>${String(v).padStart(2, '0')}</b><i>${l}</i></span>`).join('');
  };
  const iv = setInterval(tick, 1000); tick();
};
DESK.ips = function (body) {
  const ips = { ...ipsDefault, ...AL.store.get('comp_ips', {}) };
  const fld = (k, label, input) => `<label class="ips-f"><span>${label}</span>${input}</label>`;
  const txt = (k, ph = '') => `<input class="inp" data-k="${k}" value="${AL.fmt.esc(String(ips[k] ?? ''))}" placeholder="${ph}">`;
  const num = (k, w = 70) => `<input class="inp" type="number" data-k="${k}" value="${ips[k]}" style="width:${w}px">`;
  const sel = (k, opts) => `<select class="inp" data-k="${k}">${opts.map(o => `<option ${String(o) === String(ips[k]) ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
  body.innerHTML = `<div class="grid g2">
    ${UI.panel('Investment Policy Statement builder', `<div class="ips-grid">
      ${fld('client', 'Client (from the case)', txt('client', 'e.g. a family saving for college'))}
      ${fld('objective', 'Primary objective', sel('objective', ['capital preservation', 'income', 'balanced growth', 'growth', 'aggressive growth']))}
      ${fld('risk', 'Risk tolerance (1 low to 5 high)', sel('risk', [1, 2, 3, 4, 5]))}
      ${fld('horizon', 'Time horizon', sel('horizon', ['short-term (under 1 year)', 'medium-term (1 to 5 years)', 'long-term (5+ years)']))}
      ${fld('liquidity', 'Liquidity needs', sel('liquidity', ['low', 'moderate', 'high']))}
      ${fld('target', 'Return target (% per year)', num('target'))}
      ${fld('maxDD', 'Max tolerable drawdown (%)', num('maxDD'))}
      ${fld('maxPos', 'Max single position (%)', num('maxPos'))}
      ${fld('maxSector', 'Max single sector (%)', num('maxSector'))}
      ${fld('minPos', 'Minimum number of positions', num('minPos'))}
      ${fld('cashMin', 'Minimum cash (%)', num('cashMin'))}
      ${fld('esg', 'Exclusions (tickers or sectors)', txt('esg', 'e.g. Energy, TSLA'))}
      <label class="ips-f" style="grid-column:1/-1"><span>Other constraints and notes</span><textarea class="inp" data-k="notes" rows="3">${AL.fmt.esc(ips.notes)}</textarea></label>
    </div><div class="controls" style="margin-top:10px"><button class="btn primary" id="ips-save">Save IPS</button><span class="note">Saved in this browser only.</span></div>`)}
    ${UI.panel('Your IPS, written out', '<div id="ips-doc" class="ips-doc"></div>')}</div>`;
  const read = () => { body.querySelectorAll('[data-k]').forEach(i => { const k = i.dataset.k; ips[k] = i.type === 'number' || k === 'risk' ? +i.value : i.value; }); return ips; };
  const paint = () => {
    const p = read(), rt = RISK_TGT[p.risk];
    $('ips-doc').innerHTML = `<h4>Investment Policy Statement${p.client ? ': ' + AL.fmt.esc(p.client) : ''}</h4>
      <p><b>Objective.</b> ${AL.fmt.esc(p.objective[0].toUpperCase() + p.objective.slice(1))}, targeting about ${p.target}% a year over a ${AL.fmt.esc(p.horizon)} horizon.</p>
      <p><b>Risk.</b> Tolerance ${p.risk} of 5. We aim for portfolio volatility near ${f.pct(rt.vol)}, market beta between ${rt.beta[0]} and ${rt.beta[1]}, and a drawdown no worse than ${p.maxDD}%.</p>
      <p><b>Allocation policy.</b> Equities ${rt.eq[0]} to ${rt.eq[1]}% of assets, the balance in bonds and cash. At least ${p.cashMin}% cash for ${AL.fmt.esc(p.liquidity)} liquidity needs.</p>
      <p><b>Diversification.</b> At least ${p.minPos} positions, no single position above ${p.maxPos}%, no sector above ${p.maxSector}%.</p>
      ${p.esg ? `<p><b>Exclusions.</b> ${AL.fmt.esc(p.esg)}.</p>` : ''}
      ${p.notes ? `<p><b>Other.</b> ${AL.fmt.esc(p.notes)}</p>` : ''}
      <p><b>Process.</b> Ideas are tested on real market history with walk-forward validation, costs and overfitting checks before capital is committed. Every trade is logged with a thesis and an exit rule, and the book is rebalanced when it drifts outside these bands.</p>`;
  };
  body.querySelectorAll('[data-k]').forEach(i => i.addEventListener('input', paint));
  $('ips-save').addEventListener('click', () => { AL.store.set('comp_ips', read()); toast('IPS saved', 'ok'); });
  paint();
};
DESK.score = function (body) {
  const ips = { ...ipsDefault, ...AL.store.get('comp_ips', {}) };
  const bs = bookStats();
  if (!bs.n) { body.innerHTML = `<div class="info-box">No holdings yet. Add positions in <a href="#" onclick="UI.focusModule('holdings');return false">Holdings</a> (or build a plan in the Competition Center) and this scorecard grades them against your IPS.</div>`; return; }
  const sc = alignScore(ips, bs);
  body.innerHTML = `<div class="grid g13">
      ${UI.panel('Client alignment score', `<div class="chart" id="sc-g" style="height:210px"></div><div class="note" style="text-align:center">${sc.score >= 75 ? 'Well aligned with the client IPS.' : sc.score >= 50 ? 'Partly aligned: fix the red checks before the judges see it.' : 'Misaligned: the book does not match the client.'}</div>`)}
      ${UI.panel('Checks against your IPS <span class="badge dim">risk ' + ips.risk + ' / 5 · ' + AL.fmt.esc(ips.objective) + '</span>', `<div class="checks">${sc.checks.map(([n, s, d], i) => `<div class="chk" style="--i:${i}"><div class="chk-top"><span>${n}</span><b class="${s >= 75 ? 'up' : s >= 50 ? '' : 'dn'}">${Math.round(s)}</b></div><div class="chk-bar"><span style="--w:${s}%;background:${s >= 75 ? 'var(--up)' : s >= 50 ? 'var(--warn)' : 'var(--dn)'}"></span></div><div class="note">${d}</div></div>`).join('')}</div>`)}</div>
    <div class="grid g2">${UI.panel('Book: last 12 months (constant weights)', '<div class="chart h240" id="sc-eq"></div>', { nopad: true })}${UI.panel('Sector mix', '<div class="chart h240" id="sc-sec"></div>')}</div>`;
  gauge($('sc-g'), sc.score, 'alignment / 100');
  let e = 1; C.line($('sc-eq'), [{ name: 'book', dates: bs.dates, values: bs.pr.map(r => (e *= 1 + r)), color: C.SERIES[0], width: 2, fill: true }]);
  C.bars($('sc-sec'), Object.entries(bs.sect).map(([k, v]) => ({ label: k, value: v })), { horizontal: true, pct: true, sorted: true });
};
DESK.journal = function (body) {
  const J = AL.store.get('comp_journal', []);
  const today = new Date().toISOString().slice(0, 10);
  body.innerHTML = `${UI.panel('Log a trade', `<div class="ips-grid j-grid">
      <label class="ips-f"><span>Date</span><input class="inp" id="j-d" type="date" value="${today}"></label>
      <label class="ips-f"><span>Ticker</span><input class="inp" id="j-s" placeholder="e.g. MSFT"></label>
      <label class="ips-f"><span>Side</span><select class="inp" id="j-side"><option>buy</option><option>sell</option><option>short</option><option>cover</option></select></label>
      <label class="ips-f"><span>Shares</span><input class="inp" id="j-q" type="number"></label>
      <label class="ips-f"><span>Price</span><input class="inp" id="j-p" type="number" step="0.01"></label>
      <label class="ips-f"><span>IPS link</span><select class="inp" id="j-o"><option>core growth</option><option>diversifier</option><option>income</option><option>hedge / risk reduction</option><option>rebalance</option><option>tactical idea</option></select></label>
      <label class="ips-f" style="grid-column:1/-1"><span>Thesis (why this, why now, what the data says)</span><textarea class="inp" id="j-t" rows="2"></textarea></label>
      <label class="ips-f" style="grid-column:1/-1"><span>Exit plan (target, stop, or what would change your mind)</span><input class="inp" id="j-x"></label></div>
      <div class="controls" style="margin-top:8px"><button class="btn primary" id="j-add">Add to journal</button><button class="btn" id="j-fill">Fill price from last close</button><button class="btn" id="j-csv">Export CSV</button><span class="note">${J.length} entries</span></div>`)}
    ${UI.panel('Journal', J.length ? `<table class="tbl"><thead><tr><th>Date</th><th>Ticker</th><th>Side</th><th class="r">Shares</th><th class="r">Price</th><th class="r">Now</th><th class="r">P/L</th><th>IPS link</th><th>Thesis</th><th>Exit plan</th><th></th></tr></thead><tbody>${J.map((j, i) => {
      const now = AL.getSeries(j.sym) ? (AL.livePx(j.sym) || AL.lastClose(j.sym).last) : null; const sgn = j.side === 'buy' || j.side === 'cover' ? 1 : -1; const pl = now && j.price ? sgn * (now / j.price - 1) : null;
      return `<tr><td>${j.date}</td><td><b>${AL.fmt.esc(j.sym)}</b></td><td>${j.side}</td><td class="r">${j.qty}</td><td class="r">${AL.fmt.px(j.price)}</td><td class="r">${now ? AL.fmt.px(now) : '-'}</td><td class="r ${f.cls(pl)}">${pl != null ? f.spct(pl) : '-'}</td><td>${AL.fmt.esc(j.obj)}</td><td class="note" style="max-width:280px">${AL.fmt.esc(j.thesis)}</td><td class="note">${AL.fmt.esc(j.exit)}</td><td><span class="x" data-del="${i}" style="cursor:pointer;color:var(--muted)">x</span></td></tr>`;
    }).join('')}</tbody></table>` : '<div class="empty">No trades logged yet. Judges ask why you made each trade; write it down when you make it.</div>', { nopad: true })}`;
  $('j-fill').addEventListener('click', () => { const s = $('j-s').value.trim().toUpperCase(); if (AL.getSeries(s)) $('j-p').value = (AL.livePx(s) || AL.lastClose(s).last).toFixed(2); });
  $('j-add').addEventListener('click', () => {
    const e = { date: $('j-d').value, sym: $('j-s').value.trim().toUpperCase(), side: $('j-side').value, qty: +$('j-q').value, price: +$('j-p').value, obj: $('j-o').value, thesis: $('j-t').value.trim(), exit: $('j-x').value.trim() };
    if (!e.sym || !e.qty) { toast('Ticker and shares are required', 'warn'); return; }
    if (!e.thesis) { toast('Add a thesis: it is what the judges will ask about', 'warn'); return; }
    J.unshift(e); AL.store.set('comp_journal', J); toast('Trade logged', 'ok'); DESK.journal(body);
  });
  body.querySelectorAll('[data-del]').forEach(x => x.addEventListener('click', () => { J.splice(+x.dataset.del, 1); AL.store.set('comp_journal', J); DESK.journal(body); }));
  $('j-csv').addEventListener('click', () => {
    const q = s => '"' + String(s ?? '').replace(/"/g, '""') + '"';
    const csv = ['date,ticker,side,shares,price,ips_link,thesis,exit_plan', ...J.map(j => [j.date, j.sym, j.side, j.qty, j.price, q(j.obj), q(j.thesis), q(j.exit)].join(','))].join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'trade_journal.csv'; a.click();
  });
};
DESK.judges = function (body) {
  const ips = { ...ipsDefault, ...AL.store.get('comp_ips', {}) }, bs = bookStats(), rg = Q.marketRegime(), J = AL.store.get('comp_journal', []);
  const sc = bs.n ? alignScore(ips, bs) : null;
  const QS = [
    ['How does your portfolio serve your client\'s objective?', 'Start from the client, not the stocks. Name the objective, the horizon and the risk level, then show how the allocation follows from them.', bs.n ? `Objective: ${ips.objective}; risk ${ips.risk}/5. Book: ${bs.n} positions, ${f.pct(bs.eqW)} equity, ${f.pct(bs.bondW)} bonds, ${f.pct(bs.cashW)} cash; realized vol ${f.pct(bs.vol)}, beta ${f.n(bs.beta)}. Alignment score ${Math.round(sc.score)}/100.` : 'Add holdings to generate your numbers.'],
    ['Why did you choose these particular securities?', 'For each core holding: the role it plays (growth, income, diversifier, hedge), the evidence, and what would make you sell.', J.length ? `${J.length} trades logged with a thesis. Most recent: ${J[0].sym} (${J[0].side}): ${J[0].thesis.slice(0, 140)}` : 'Log trades in the journal so each one has a written thesis.'],
    ['How do you manage risk?', 'Position caps, sector caps, diversification across asset classes, a cash buffer, stop or review rules. Quote your drawdown and volatility numbers.', bs.n ? `Largest position ${bs.maxSym} at ${f.pct(bs.maxW)} (cap ${ips.maxPos}%). 1-year max drawdown ${f.pct(bs.mdd)} vs tolerance ${ips.maxDD}%.` : ''],
    ['What is the market environment and how did it shape your decisions?', 'Summarize the regime in one sentence, then connect it to one allocation choice.', `Model regime today: ${rg.label}. SPY ${rg.trend > 0 ? 'above' : 'below'} its 200-day average, VIX ${f.n(rg.vix, 1)}, 10Y minus 2Y curve ${f.n(rg.curve, 2)}%.`],
    ['How do you know your strategy is not just luck or overfitting?', 'Out-of-sample testing, transaction costs, parameter robustness and a deflated Sharpe that accounts for how many ideas you tried.', 'Use Quant Studio > Overfitting lab for the Deflated Sharpe and PBO, and quote the out-of-sample Sharpe from the strategy page.'],
    ['What would make you change the portfolio?', 'Name concrete triggers: a regime change, a position hitting its cap, a thesis breaking, a client need changing.', ''],
    ['What did you learn, and what would you do differently?', 'Judges reward reflection. Pick one mistake and the process fix you made.', ''],
    ['How did your team divide the work?', 'Roles (research, risk, trading, writing), how you decided, how you checked each other.', ''],
  ];
  body.innerHTML = `<div class="note" style="margin-bottom:10px">Judging weighs how well the portfolio fits the client, plus the quality of your research and communication. Practice these out loud. Click a question to reveal coaching and your own numbers.</div>
    <div class="qa">${QS.map(([q, g, d], i) => `<div class="qa-item" style="--i:${i}"><div class="qa-q"><span class="qa-n">${i + 1}</span>${AL.fmt.esc(q)}<span class="caret">▸</span></div><div class="qa-a"><p><b>What a strong answer covers:</b> ${AL.fmt.esc(g)}</p>${d ? `<p class="qa-d"><b>Your data:</b> ${AL.fmt.esc(d)}</p>` : ''}</div></div>`).join('')}</div>`;
  body.querySelectorAll('.qa-q').forEach(q => q.addEventListener('click', () => q.parentElement.classList.toggle('open')));
};
DESK.brief = function (body) {
  const ips = { ...ipsDefault, ...AL.store.get('comp_ips', {}) }, bs = bookStats(), J = AL.store.get('comp_journal', []), rg = Q.marketRegime();
  const sc = bs.n ? alignScore(ips, bs) : null, rt = RISK_TGT[ips.risk];
  const scores = AL.store.get('strat_scores', {});
  const tested = Object.entries(scores).filter(([id]) => S.byId[id]).sort((a, b) => b[1].sharpe - a[1].sharpe).slice(0, 5);
  const html = `<div class="brief">
    <h2>Portfolio strategy brief</h2><div class="b-sub">${AL.fmt.esc(ips.client || 'Client')} · data as-of ${AL.asof} · prepared with AlphaLab</div>
    <h3>1. Client and objective</h3><p>${AL.fmt.esc(ips.objective[0].toUpperCase() + ips.objective.slice(1))}; risk tolerance ${ips.risk} of 5; ${AL.fmt.esc(ips.horizon)} horizon; ${AL.fmt.esc(ips.liquidity)} liquidity needs. Return target about ${ips.target}% a year with drawdowns kept under ${ips.maxDD}%.</p>
    <h3>2. Policy</h3><p>Equities ${rt.eq[0]} to ${rt.eq[1]}%; volatility near ${f.pct(rt.vol)}; beta ${rt.beta[0]} to ${rt.beta[1]}; at least ${ips.minPos} positions; single position at most ${ips.maxPos}%; sector at most ${ips.maxSector}%; cash at least ${ips.cashMin}%.${ips.esg ? ' Exclusions: ' + AL.fmt.esc(ips.esg) + '.' : ''}</p>
    <h3>3. Portfolio</h3>${bs.n ? `<table><tr><th>Ticker</th><th>Weight</th><th>Role</th></tr>${bs.book.map((h, j) => ({ h, w: bs.w[j] })).sort((a, b) => b.w - a.w).map(({ h, w }) => `<tr><td>${h.sym}</td><td>${f.pct(w)}</td><td>${BOND.test(h.sym) ? 'income / ballast' : h.sym.endsWith('-USD') ? 'satellite' : w > 0.08 ? 'core' : 'satellite'}</td></tr>`).join('')}</table>
      <p>Realized volatility ${f.pct(bs.vol)}, beta ${f.n(bs.beta)}, 1-year max drawdown ${f.pct(bs.mdd)}. Client alignment score <b>${Math.round(sc.score)}/100</b>.</p>` : '<p>No holdings entered yet.</p>'}
    <h3>4. Market view</h3><p>Regime: ${AL.fmt.esc(rg.label)}. SPY is ${rg.trend > 0 ? 'above' : 'below'} its 200-day average; VIX ${f.n(rg.vix, 1)}; yield curve (10Y minus 2Y) ${f.n(rg.curve, 2)}%${rg.hySpread != null ? '; high-yield spread ' + f.n(rg.hySpread, 2) + '%' : ''}.</p>
    <h3>5. Research process</h3><p>Every idea is backtested on real history, net of transaction costs, with a one-day signal lag, walk-forward machine learning (purged, so no look-ahead), out-of-sample splits and a Deflated Sharpe check for the number of ideas tried.${tested.length ? ' Strategies tested: ' + tested.map(([id, s]) => `${id} ${S.byId[id].name} (Sharpe ${f.n(s.sharpe)})`).join('; ') + '.' : ''}</p>
    <h3>6. Risk management</h3><p>Position and sector caps, diversification across asset classes, a standing cash buffer, and written exit rules for every trade. We review the book against this policy weekly and rebalance when it drifts outside the bands.</p>
    ${J.length ? `<h3>7. Recent decisions</h3><table><tr><th>Date</th><th>Trade</th><th>Thesis</th></tr>${J.slice(0, 6).map(j => `<tr><td>${j.date}</td><td>${j.side} ${j.qty} ${AL.fmt.esc(j.sym)}</td><td>${AL.fmt.esc(j.thesis)}</td></tr>`).join('')}</table>` : ''}
  </div>`;
  body.innerHTML = `<div class="controls"><button class="btn primary" id="br-print">Print or save as PDF</button><span class="note">Edit the IPS and journal tabs to change this brief.</span></div><div class="panel"><div class="panel-body">${html}</div></div>`;
  $('br-print').addEventListener('click', () => {
    const w = window.open('', '_blank'); if (!w) { toast('Allow pop-ups to print the brief', 'warn'); return; }
    w.document.write(`<!doctype html><html><head><title>Strategy brief</title><style>body{font:13px/1.55 Georgia,serif;color:#111;max-width:760px;margin:32px auto;padding:0 20px}h2{margin:0 0 2px;font-family:system-ui}h3{font-family:system-ui;font-size:13px;text-transform:uppercase;letter-spacing:1px;margin:18px 0 4px;color:#333;border-bottom:1px solid #ddd;padding-bottom:3px}.b-sub{color:#666;font-size:12px}table{border-collapse:collapse;width:100%;font-size:12px;margin:6px 0}td,th{border-bottom:1px solid #eee;padding:3px 6px;text-align:left}</style></head><body>${html}<script>setTimeout(()=>print(),200)<\/script></body></html>`);
    w.document.close();
  });
};

/* ---------- navigation + terminal commands ---------- */
const addNav = (g, id, after) => { const sec = UI.NAV.find(s => s.g === g); if (!sec || sec.mods.includes(id)) return; const i = after ? sec.mods.indexOf(after) : -1; i >= 0 ? sec.mods.splice(i + 1, 0, id) : sec.mods.push(id); };
addNav('Start Here', 'compdesk', 'guide');
addNav('Quant Lab', 'mlzoo', 'mllab');
addNav('Quant Lab', 'quantstudio', 'structure');
UI.commands.push(
  { cmd: 'ZOO', desc: 'ML Model Zoo: open-source model cards, live training, model race, ML twins', fn: () => UI.focusModule('mlzoo') },
  { cmd: 'TRAIN <lstm|gru|alstm|transformer>', desc: 'Train a deep network live on real data and watch the loss and attention', fn: a => UI.focusModule('mlzoo', { view: 'studio', net: (a[0] || 'alstm').toLowerCase(), autostart: true }) },
  { cmd: 'RACE', desc: 'Race every ported ML model walk-forward', fn: () => UI.focusModule('mlzoo', { view: 'race' }) },
  { cmd: 'TWIN <strategy-id>', desc: 'ML twin (meta-labeling) for a strategy', fn: a => a[0] && S.byId[a[0].toUpperCase()] ? UI.openTab('stratDetail', { sid: a[0].toUpperCase(), forceNew: true }, S.byId[a[0].toUpperCase()].name) : UI.focusModule('mlzoo', { view: 'twins' }) },
  { cmd: 'GARCH <sym>', desc: 'GARCH(1,1) volatility model and forecast', fn: a => UI.focusModule('quantstudio', { view: 'garch', gsym: (a[0] || 'SPY').toUpperCase() }) },
  { cmd: 'HMM <sym>', desc: 'Hidden Markov regime model with shaded chart', fn: a => UI.focusModule('quantstudio', { view: 'hmm', hsym: (a[0] || 'SPY').toUpperCase() }) },
  { cmd: 'PAIRS', desc: 'Cointegration scanner with Kalman hedge ratios', fn: () => UI.focusModule('quantstudio', { view: 'pairs' }) },
  { cmd: 'FACTORS <sym>', desc: 'Style-factor attribution (market, size, value, momentum, quality, low vol)', fn: a => UI.focusModule('quantstudio', { view: 'factors', fat: a[0] ? 'sym:' + a[0].toUpperCase() : undefined }) },
  { cmd: 'OPTIONS <sym>', desc: 'Black-Scholes options lab with Greeks and payoff diagrams', fn: a => UI.focusModule('quantstudio', { view: 'options', osym: (a[0] || 'SPY').toUpperCase() }) },
  { cmd: 'OVERFIT', desc: 'Deflated Sharpe Ratio and probability of backtest overfitting', fn: () => UI.focusModule('quantstudio', { view: 'overfit' }) },
  { cmd: 'NETWORK', desc: 'Animated cross-asset correlation network (minimum spanning tree)', fn: () => UI.focusModule('quantstudio', { view: 'network' }) },
  { cmd: 'FFD <sym>', desc: 'Fractional differencing explorer', fn: a => UI.focusModule('quantstudio', { view: 'ffd', dsym: (a[0] || 'SPY').toUpperCase() }) },
  { cmd: 'DESK', desc: 'Competition Desk: countdown, client IPS, alignment score, journal, judge prep', fn: () => UI.focusModule('compdesk') },
  { cmd: 'IPS', desc: 'Build the client Investment Policy Statement', fn: () => UI.focusModule('compdesk', { view: 'ips' }) },
  { cmd: 'JOURNAL', desc: 'Competition trade journal', fn: () => UI.focusModule('compdesk', { view: 'journal' }) },
  { cmd: 'BRIEF', desc: 'Printable one-page strategy brief for the judges', fn: () => UI.focusModule('compdesk', { view: 'brief' }) },
);
const goMap = { ZOO: 'mlzoo', MLZOO: 'mlzoo', QS: 'quantstudio', QUANT: 'quantstudio', STUDIO: 'quantstudio', DESK: 'compdesk', COMPDESK: 'compdesk', WHARTON: 'compdesk' };
const goPrev = UI.goCmd;
UI.goCmd = function (a) { const m = goMap[(a[0] || '').toUpperCase()]; if (m) UI.focusModule(m); else goPrev(a); };
})();
