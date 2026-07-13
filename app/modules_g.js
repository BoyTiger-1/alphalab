/* modules G: the Buy/Sell Decision engine (deep dive on one stock), the
   fundamental screener, and peer comparison. Fuses real price action,
   fundamentals, analyst targets, earnings, news tone, and social posts
   into a single BUY / HOLD / SELL call with a bull and bear case. */
'use strict';

/* ---- fundamental scoring, shared by the Advisor and the decision engine ----
   Each pillar returns a score in roughly [-1, 1] plus the human-readable drivers.
   Everything is real: nulls when a stock lacks a data point, never invented. */
UI.fundamentalScore = function (sym) {
  const fd = AL.fund(sym);
  if (!fd) return null;
  const out = { sym, fd, pillars: {}, bull: [], bear: [], data: {} };
  const f = AL.fmt;
  // peer medians within the same sector, computed once and cached
  const med = UI._sectorMedians();
  const peers = med[fd.sector] || med._all;
  const pctl = (val, key, invert) => {
    // where does this stock sit vs sector peers on this metric (0..1)
    if (val == null || !peers || !peers[key] || !peers[key].length) return null;
    const arr = peers[key];
    let below = 0;
    for (const x of arr) if (x < val) below++;
    let p = below / arr.length;
    return invert ? 1 - p : p;
  };

  // VALUATION: cheaper than sector peers scores positive (mild contrarian tilt)
  {
    const parts = [];
    const pe = pctl(fd.pe, 'pe', true), peg = pctl(fd.peg, 'peg', true), pb = pctl(fd.pb, 'pb', true), ps = pctl(fd.ps, 'ps', true);
    [pe, peg, pb, ps].forEach(x => { if (x != null) parts.push((x - 0.5) * 2); });
    if (parts.length) {
      out.pillars.value = Q.mean(parts);
      if (fd.pe != null && pe > 0.7) out.bull.push(`cheaper than most ${fd.sector} peers (P/E ${f.n(fd.pe, 1)})`);
      if (fd.peg != null && fd.peg > 0 && fd.peg < 1.2) out.bull.push(`reasonable growth-adjusted valuation (PEG ${f.n(fd.peg, 2)})`);
      if (fd.pe != null && pe < 0.25) out.bear.push(`expensive versus ${fd.sector} peers (P/E ${f.n(fd.pe, 1)})`);
    }
  }
  // QUALITY: fat margins, high returns on capital, low leverage
  {
    const parts = [];
    if (fd.pm != null) parts.push(clamp((fd.pm - 0.08) / 0.15));
    if (fd.roe != null) parts.push(clamp((fd.roe - 0.10) / 0.20));
    if (fd.gm != null) parts.push(clamp((fd.gm - 0.30) / 0.30));
    if (fd.de != null) parts.push(clamp((80 - fd.de) / 120));
    if (parts.length) {
      out.pillars.quality = clamp(Q.mean(parts));
      if (fd.pm != null && fd.pm > 0.15) out.bull.push(`strong profitability (${f.pct(fd.pm, 0)} net margin)`);
      if (fd.roe != null && fd.roe > 0.20) out.bull.push(`excellent returns on equity (${f.pct(fd.roe, 0)})`);
      if (fd.de != null && fd.de > 200) out.bear.push(`heavy debt load (debt/equity ${f.n(fd.de, 0)})`);
      if (fd.pm != null && fd.pm < 0) out.bear.push(`unprofitable on a net basis (${f.pct(fd.pm, 0)} margin)`);
    }
  }
  // GROWTH: revenue and earnings expansion
  {
    const parts = [];
    if (fd.revG != null) parts.push(clamp(fd.revG / 0.25));
    if (fd.earnG != null) parts.push(clamp(fd.earnG / 0.30));
    if (parts.length) {
      out.pillars.growth = clamp(Q.mean(parts));
      if (fd.revG != null && fd.revG > 0.15) out.bull.push(`fast revenue growth (${f.pct(fd.revG, 0)} year over year)`);
      if (fd.earnG != null && fd.earnG > 0.20) out.bull.push(`earnings growing ${f.pct(fd.earnG, 0)}`);
      if (fd.revG != null && fd.revG < 0) out.bear.push(`revenue is shrinking (${f.pct(fd.revG, 0)})`);
      if (fd.earnG != null && fd.earnG < -0.1) out.bear.push(`earnings are falling (${f.pct(fd.earnG, 0)})`);
    }
  }
  // ANALYST: upside to mean target, consensus rating, earnings surprises
  {
    const parts = [];
    const px = fd.price || (AL.getSeries(sym) ? AL.getSeries(sym).values.slice(-1)[0] : null);
    let upside = null;
    if (fd.tgtMean && px) { upside = fd.tgtMean / px - 1; parts.push(clamp(upside / 0.25)); out.data.upside = upside; }
    if (fd.recMean) parts.push(clamp((3 - fd.recMean) / 1.5));   // 1 strong buy .. 5 strong sell
    if (fd.eps && fd.eps.length) {
      const beats = fd.eps.filter(e => e.sur != null && e.sur > 0).length;
      parts.push((beats / fd.eps.length - 0.5) * 1.2);
      out.data.beats = `${beats}/${fd.eps.length}`;
    }
    if (parts.length) {
      out.pillars.analyst = clamp(Q.mean(parts));
      if (upside != null && upside > 0.15) out.bull.push(`${f.pct(upside, 0)} upside to the average analyst target (${fd.nAnalyst || '?'} analysts)`);
      if (upside != null && upside < -0.05) out.bear.push(`trading above the average analyst target (${f.pct(-upside, 0)} downside)`);
      if (fd.recKey && /buy/i.test(fd.recKey)) out.bull.push(`analyst consensus is ${fd.recKey.replace('_', ' ')}`);
      if (fd.recKey && /sell|underperform/i.test(fd.recKey)) out.bear.push(`analyst consensus leans ${fd.recKey.replace('_', ' ')}`);
    }
  }
  return out;
};
function clamp(x) { return Math.max(-1, Math.min(1, x)); }

// sector medians for percentile scoring, cached across the session
UI._sectorMediansCache = null;
UI._sectorMedians = function () {
  if (UI._sectorMediansCache) return UI._sectorMediansCache;
  const fm = AL.fundMeta();
  const out = { _all: {} };
  if (!fm) { UI._sectorMediansCache = out; return out; }
  const keys = ['pe', 'peg', 'pb', 'ps'];
  for (const [sym, fd] of Object.entries(fm.tickers)) {
    const bucket = fd.sector || 'Unknown';
    for (const b of [bucket, '_all']) {
      out[b] = out[b] || {};
      for (const k of keys) { if (fd[k] != null && fd[k] > 0) (out[b][k] = out[b][k] || []).push(fd[k]); }
    }
  }
  UI._sectorMediansCache = out;
  return out;
};

/* combined decision: blend the technical 8-factor score with the fundamental
   pillars and live sentiment into one call */
UI.decision = function (sym) {
  const fscore = UI.fundamentalScore(sym);
  // technical score reuses the Advisor engine's per-stock row (cached after first run)
  let tech = null;
  try {
    const res = UI.scoreStocks();
    tech = res.bySym[sym];
  } catch (e) { /* advisor universe may not include this exact symbol */ }
  const regime = Q.marketRegime();
  const pillars = {};
  if (tech) pillars.technical = clamp(tech.score);            // already ~z-scored and weighted
  if (fscore) Object.assign(pillars, fscore.pillars);
  // sentiment pillar from alt-data
  const alt = UI.altSignals ? UI.altSignals(sym) : null;
  if (alt) {
    const parts = [];
    if (alt.bullRatio != null) parts.push((alt.bullRatio - 0.5) * 3);
    if (alt.toneTrend != null) parts.push(Math.max(-1.5, Math.min(1.5, alt.toneTrend)));
    if (parts.length) pillars.sentiment = clamp(Q.mean(parts));
  }
  // weights: technical and analyst carry the most, then value/quality/growth/sentiment
  const W = { technical: 0.28, analyst: 0.20, quality: 0.14, growth: 0.14, value: 0.14, sentiment: 0.10 };
  let num = 0, den = 0;
  for (const [k, w] of Object.entries(W)) if (pillars[k] != null) { num += w * pillars[k]; den += w; }
  const overall = den ? num / den : 0;
  const call = overall > 0.22 ? 'BUY' : overall < -0.22 ? 'SELL' : 'HOLD';
  return { sym, overall, call, pillars, weights: W, fscore, tech, regime, coverage: den };
};

/* =========================================================
   MODULE: Buy/Sell Decision (deep dive on one stock)
   ========================================================= */
UI.def('decision', 'Buy / Sell Decision', '⚖', 'Advisory', function (el, state, tab) {
  const sym = (state.sym || 'AAPL').toUpperCase();
  tab.title = sym + ' Decision';
  const ser = AL.getSeries(sym);
  el.innerHTML = `
    <div class="section-title">Buy / Sell Decision Engine
      <span style="flex:1"></span>
      <input class="inp" id="dc-sym" placeholder="ticker" value="${sym}" style="width:110px;text-transform:uppercase">
      <button class="btn primary" id="dc-go">Analyze</button></div>
    <div class="info-box" style="margin-bottom:12px">One screen, every angle, on real data: price action and the eight technical factors, real fundamentals (valuation, growth, margins, balance sheet), Wall Street analyst price targets and the buy/hold/sell split, earnings-surprise history, live news headlines, and real investor posts. The engine fuses them into a single call with a bull case and a bear case. It is a research view, not advice, and it never trades for you.</div>
    <div id="dc-body">${ser ? '<div class="empty">Analyzing...</div>' : `<div class="empty">Unknown ticker ${AL.fmt.esc(sym)}.</div>`}</div>`;
  const go = () => {
    const s = document.getElementById('dc-sym').value.trim().toUpperCase();
    if (!s) return;
    state.sym = s;
    UI.renderActive();
  };
  document.getElementById('dc-go').addEventListener('click', go);
  document.getElementById('dc-sym').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  if (!ser) return;
  setTimeout(() => { try { render(); } catch (e) { console.error(e); document.getElementById('dc-body').innerHTML = `<div class="empty">Analysis error: ${AL.fmt.esc(e.message)}</div>`; } }, 20);

  function render() {
    const f = AL.fmt;
    const d = UI.decision(sym);
    const fd = AL.fund(sym);
    const nf = AL.newsFor(sym);
    const px = fd && fd.price ? fd.price : ser.values[ser.values.length - 1];
    const callColor = d.call === 'BUY' ? 'ok' : d.call === 'SELL' ? 'bad' : 'warn';
    const pillarRows = Object.entries(d.weights).filter(([k]) => d.pillars[k] != null).map(([k, w]) =>
      ({ label: k[0].toUpperCase() + k.slice(1), value: d.pillars[k] }));
    // build the body
    document.getElementById('dc-body').innerHTML = `
      <div class="grid g23">
        <div style="display:flex;flex-direction:column;gap:12px;min-width:0">
          <div class="panel"><div class="panel-body" style="display:flex;align-items:center;gap:20px;flex-wrap:wrap">
            <div><div style="font-size:22px;font-weight:700">${sym}</div><div class="note">${f.esc((fd && fd.sector) || ser.sector || ser.cls)}${fd && fd.industry ? ' · ' + f.esc(fd.industry) : ''}</div></div>
            <div><div class="note">Price</div><div style="font-size:20px" class="num">${f.px(px)}</div></div>
            ${d.fscore && d.fscore.data.upside != null ? `<div><div class="note">Analyst target</div><div style="font-size:20px" class="num ${f.cls(d.fscore.data.upside)}">${f.px(fd.tgtMean)} <span style="font-size:12px">(${f.spct(d.fscore.data.upside, 0)})</span></div></div>` : ''}
            <div style="margin-left:auto;text-align:center">
              <div class="badge ${callColor}" style="font-size:20px;padding:8px 20px">${d.call}</div>
              <div class="note" style="margin-top:4px">composite ${f.n(d.overall, 2)}</div></div>
          </div></div>
          ${UI.panel('Decision factors (each -1 bearish to +1 bullish)', '<div class="chart" style="height:200px" id="dc-pillars"></div><div class="note" style="margin-top:6px">Weights: technical 28%, analyst 20%, quality/growth/value 14% each, sentiment 10%. Bars are the real inputs; missing bars mean that data was not available for this name.</div>')}
          <div class="grid g2">
            <div class="panel"><div class="panel-head" style="color:var(--up)">Bull case</div><div class="panel-body">${d.fscore && d.fscore.bull.length ? d.fscore.bull.map(b => `<div class="kv"><span class="k" style="color:var(--up)">+</span><span class="v" style="font-family:var(--sans);text-align:left;flex:1;margin-left:8px">${f.esc(b)}</span></div>`).join('') : '<div class="note">No standout positives in the fundamental data.</div>'}${d.tech && d.tech.z_mom > 0.5 ? `<div class="kv"><span class="k" style="color:var(--up)">+</span><span class="v" style="font-family:var(--sans);text-align:left;flex:1;margin-left:8px">positive price momentum and trend</span></div>` : ''}</div></div>
            <div class="panel"><div class="panel-head" style="color:var(--dn)">Bear case</div><div class="panel-body">${d.fscore && d.fscore.bear.length ? d.fscore.bear.map(b => `<div class="kv"><span class="k" style="color:var(--dn)">-</span><span class="v" style="font-family:var(--sans);text-align:left;flex:1;margin-left:8px">${f.esc(b)}</span></div>`).join('') : '<div class="note">No major red flags in the fundamental data.</div>'}${d.tech && d.tech.vol > 0.5 ? `<div class="kv"><span class="k" style="color:var(--dn)">-</span><span class="v" style="font-family:var(--sans);text-align:left;flex:1;margin-left:8px">elevated volatility (${f.pct(d.tech.vol, 0)} annualized), expect swings</span></div>` : ''}</div></div>
          </div>
          ${UI.panel('Price, 2 years', '<div class="chart h240" id="dc-px"></div>', { nopad: true })}
          ${fd ? UI.panel('Fundamentals <span class="badge ok">real, Yahoo Finance</span>', fundTable(fd, px, f)) : UI.panel('Fundamentals', '<div class="note">No fundamental data bundled for this ticker. The S&P 500 and large-cap names have full coverage.</div>')}
          ${fd && fd.eps && fd.eps.length ? UI.panel('Earnings surprises (last 4 quarters)', epsTable(fd.eps, f)) : ''}
        </div>
        <div style="display:flex;flex-direction:column;gap:12px;min-width:0">
          ${fd && fd.rec ? UI.panel('Wall Street consensus', analystPanel(fd, px, f)) : ''}
          ${UI.panel('News headlines <span class="badge ' + (nf && nf.news ? 'ok' : 'dim') + '">' + (nf && nf.news ? 'real, GDELT' : 'live fetch') + '</span>', `<div id="dc-news">${newsList(nf, f)}</div><button class="btn small" id="dc-news-live" style="margin-top:8px">Fetch latest headlines</button>`)}
          ${UI.panel('Investor posts <span class="badge ' + (nf && nf.posts ? 'ok' : 'dim') + '">' + (nf && nf.posts ? 'real, StockTwits' : 'none bundled') + '</span>', `<div id="dc-posts">${postList(nf, f)}</div>`)}
          ${UI.panel('What would change this call', changeNote(d, fd, px, f))}
          <div class="panel"><div class="panel-body" style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn primary small" id="dc-buy">Add to My Holdings</button>
            <button class="btn small" onclick="UI.openTab('chart',{sym:'${sym}',forceNew:true},'${sym} Chart')">Full chart</button>
            <button class="btn small" onclick="UI.focusModule('peers',{sym:'${sym}'})">Compare peers</button>
            ${AL.alt()[sym] ? `<button class="btn small" onclick="UI.focusModule('sentiment',{sym:'${sym}'})">Sentiment</button>` : ''}
          </div></div>
        </div>
      </div>
      <div class="warn-box" style="margin-top:12px">This is a quantitative research view built from real historical, fundamental, and sentiment data. It is not a prediction or personalized investment advice, and AlphaLab never executes trades. Analyst targets and estimates are third-party opinions, not facts.</div>`;
    C.bars(document.getElementById('dc-pillars'), pillarRows, { horizontal: true });
    const w = AL.window(ser, ser.dates[Math.max(0, ser.dates.length - (ser.weekly ? 104 : 504))]);
    C.line(document.getElementById('dc-px'), [{ name: sym, dates: w.dates, values: w.values, color: C.SERIES[0], fill: true }], {});
    document.getElementById('dc-buy').addEventListener('click', () => {
      const qty = parseFloat(prompt(`Quantity of ${sym} to add (price ${f.px(px)}):`));
      if (!isFinite(qty) || qty <= 0) return;
      const pf = AL.store.get('holdings', UI.DEMO_BOOK); pf.push({ sym, qty, costBasis: px });
      const cash = AL.store.get('cash', null); if (cash != null) AL.store.set('cash', cash - qty * px);
      AL.store.set('holdings', pf); alert(`${qty} ${sym} added.`);
    });
    const liveBtn = document.getElementById('dc-news-live');
    if (liveBtn) liveBtn.addEventListener('click', () => fetchLiveNews(sym, fd, f));
  }

  function fundTable(fd, px, f) {
    const row = (k, v) => v == null || v === '' ? '' : `<div class="kv"><span class="k">${k}</span><span class="v">${v}</span></div>`;
    return row('Market cap', fd.mktCap ? f.usd(fd.mktCap) : null) +
      row('Trailing P/E', fd.pe != null ? f.n(fd.pe, 1) : null) +
      row('Forward P/E', fd.fpe != null ? f.n(fd.fpe, 1) : null) +
      row('PEG ratio', fd.peg != null ? f.n(fd.peg, 2) : null) +
      row('Price / book', fd.pb != null ? f.n(fd.pb, 1) : null) +
      row('Price / sales', fd.ps != null ? f.n(fd.ps, 1) : null) +
      row('Revenue growth (YoY)', fd.revG != null ? f.spct(fd.revG, 0) : null) +
      row('Earnings growth', fd.earnG != null ? f.spct(fd.earnG, 0) : null) +
      row('Gross margin', fd.gm != null ? f.pct(fd.gm, 0) : null) +
      row('Net margin', fd.pm != null ? f.pct(fd.pm, 0) : null) +
      row('Return on equity', fd.roe != null ? f.pct(fd.roe, 0) : null) +
      row('Debt / equity', fd.de != null ? f.n(fd.de, 0) : null) +
      row('Dividend yield', fd.divY != null ? f.pct(fd.divY, 2) : null) +
      row('Beta', fd.beta != null ? f.n(fd.beta, 2) : null);
  }
  function epsTable(eps, f) {
    return `<table class="tbl"><thead><tr><th>Quarter</th><th class="r">Estimate</th><th class="r">Actual</th><th class="r">Surprise</th></tr></thead><tbody>` +
      eps.map(e => `<tr><td>${f.esc(e.q || '')}</td><td class="r">${e.est != null ? f.n(e.est, 2) : '-'}</td><td class="r">${e.act != null ? f.n(e.act, 2) : '-'}</td><td class="r ${f.cls(e.sur)}">${e.sur != null ? f.spct(e.sur, 0) : '-'}</td></tr>`).join('') + '</tbody></table>';
  }
  function analystPanel(fd, px, f) {
    const [sb, b, h, s, ss] = fd.rec;
    const tot = sb + b + h + s + ss || 1;
    const bar = (label, n, color) => `<div style="display:flex;align-items:center;gap:6px;margin:2px 0"><span style="width:70px;font-size:11px;color:var(--muted)">${label}</span><div style="flex:1;background:var(--surf2);border-radius:3px;height:14px;overflow:hidden"><div style="width:${n / tot * 100}%;height:100%;background:${color}"></div></div><span class="num" style="width:24px;text-align:right">${n}</span></div>`;
    return `<div class="kv"><span class="k">Consensus</span><span class="v"><span class="badge ${/buy/i.test(fd.recKey || '') ? 'ok' : /sell/i.test(fd.recKey || '') ? 'bad' : 'warn'}">${(fd.recKey || 'n/a').replace('_', ' ').toUpperCase()}</span></span></div>
      <div class="kv"><span class="k">Analysts covering</span><span class="v">${fd.nAnalyst || '-'}</span></div>
      <div style="margin:8px 0">${bar('Strong buy', sb, '#0ca30c')}${bar('Buy', b, '#199e70')}${bar('Hold', h, '#fab219')}${bar('Sell', s, '#e66767')}${bar('Strong sell', ss, '#d03b3b')}</div>
      <div class="kv"><span class="k">Price target (low / mean / high)</span><span class="v">${f.px(fd.tgtLow)} / ${f.px(fd.tgtMean)} / ${f.px(fd.tgtHigh)}</span></div>
      ${fd.tgtMean && px ? `<div class="kv"><span class="k">Implied from current</span><span class="v ${f.cls(fd.tgtMean / px - 1)}">${f.spct(fd.tgtMean / px - 1, 0)}</span></div>` : ''}`;
  }
  function newsList(nf, f) {
    if (!nf || !nf.news || !nf.news.length) return '<div class="note">No bundled headlines for this ticker. Press the button to fetch the latest live, or check the Sentiment desk for coverage tone.</div>';
    return nf.news.map(a => `<div style="padding:5px 0;border-bottom:1px solid var(--line)"><div style="font-size:12px;line-height:1.4">${a.u ? `<a href="${f.esc(a.u)}" target="_blank" rel="noopener" style="color:var(--ink)">${f.esc(a.t)}</a>` : f.esc(a.t)}</div><div class="note">${f.esc(a.dom || '')} · ${a.d ? a.d.slice(0, 4) + '-' + a.d.slice(4, 6) + '-' + a.d.slice(6, 8) : ''}</div></div>`).join('');
  }
  function postList(nf, f) {
    if (!nf || !nf.posts || !nf.posts.length) return '<div class="note">No investor posts bundled for this ticker.</div>';
    return nf.posts.map(p => `<div style="padding:5px 0;border-bottom:1px solid var(--line)">
      <div style="font-size:12px;line-height:1.4">${f.esc(p.b)}</div>
      <div class="note">@${f.esc(p.u)}${p.f ? ' · ' + (p.f > 1000 ? (p.f / 1000).toFixed(1) + 'k' : p.f) + ' followers' : ''}${p.s ? ` · <span class="${p.s === 'Bullish' ? 'up' : 'dn'}">${p.s}</span>` : ''}</div></div>`).join('');
  }
  function changeNote(d, fd, px, f) {
    const items = [];
    if (d.call === 'BUY') items.push('A break below the 200-day trend, a negative earnings surprise, or the price closing the gap to the analyst target would weaken this call.');
    else if (d.call === 'SELL') items.push('A reclaim of the 200-day average, an earnings beat, or a fresh round of analyst upgrades would flip this toward neutral.');
    else items.push('This is a balanced setup. A decisive move in momentum, a valuation re-rating, or a shift in analyst sentiment would tip it.');
    if (fd && fd.tgtMean && px && fd.tgtMean > px) items.push(`Analysts see fair value near ${f.px(fd.tgtMean)}; watch how price behaves as it approaches that level.`);
    items.push('Set your own exit rule now: a price stop, a factor-deterioration trigger, or a regime change. Deciding before you buy beats deciding in a panic.');
    return items.map(i => `<div class="note" style="margin-bottom:6px;line-height:1.5">${f.esc(i)}</div>`).join('');
  }
  async function fetchLiveNews(sym, fd, f) {
    const box = document.getElementById('dc-news');
    box.innerHTML = '<div class="note">Fetching live from GDELT...</div>';
    try {
      const name = fd && fd.sector ? (AL.getSeries(sym) ? AL.getSeries(sym).name.split(' ').slice(0, 2).join(' ') : sym) : sym;
      const q = encodeURIComponent(`"${name}"`);
      const r = await fetch(`https://api.gdeltproject.org/api/v2/doc/doc?query=${q}&mode=artlist&maxrecords=8&timespan=2weeks&format=json&sort=datedesc`);
      const j = await r.json();
      const arts = (j.articles || []).slice(0, 6).map(a => ({ t: a.title, d: (a.seendate || '').slice(0, 8), dom: a.domain, u: a.url }));
      box.innerHTML = arts.length ? newsList({ news: arts }, f) : '<div class="note">No fresh articles found right now. Try again shortly.</div>';
    } catch (e) {
      box.innerHTML = '<div class="note">Live fetch was blocked (offline or rate limited). The bundled snapshot is the fallback.</div>';
    }
  }
});

/* =========================================================
   MODULE: Fundamental Screener
   ========================================================= */
UI.def('screener', 'Screener', '▦', 'Advisory', function (el, state, tab) {
  const fm = AL.fundMeta();
  const presets = {
    value: { name: 'Cheap and profitable (value)', test: fd => fd.pe != null && fd.pe > 0 && fd.pe < 18 && fd.pm != null && fd.pm > 0.08, sort: fd => fd.pe },
    growth: { name: 'High growth', test: fd => fd.revG != null && fd.revG > 0.20 && fd.pm != null && fd.pm > 0, sort: fd => -(fd.revG || 0) },
    quality: { name: 'Quality compounders', test: fd => fd.roe != null && fd.roe > 0.20 && fd.de != null && fd.de < 100 && fd.pm > 0.12, sort: fd => -(fd.roe || 0) },
    dividend: { name: 'Dividend payers', test: fd => fd.divY != null && fd.divY > 0.025 && fd.pm > 0.05, sort: fd => -(fd.divY || 0) },
    analyst: { name: 'Analyst upside', test: (fd, sym) => { const px = fd.price; return fd.tgtMean && px && fd.tgtMean / px - 1 > 0.15 && /buy/i.test(fd.recKey || ''); }, sort: fd => -(fd.tgtMean / (fd.price || 1)) },
    garp: { name: 'Growth at a reasonable price (GARP)', test: fd => fd.peg != null && fd.peg > 0 && fd.peg < 1.3 && fd.revG > 0.08, sort: fd => fd.peg },
  };
  const preset = state.preset || 'value';
  el.innerHTML = `
    <div class="section-title">Fundamental Screener <span class="badge ${fm ? 'ok' : 'dim'}">${fm ? Object.keys(fm.tickers).length + ' stocks with fundamentals' : 'no fundamentals bundled'}</span></div>
    <div class="info-box" style="margin-bottom:12px">Filter the universe by real fundamentals: valuation, growth, profitability, balance sheet, dividends, and analyst upside. Pick a preset screen or read the logic and adapt your own thinking. Click any result to open its full buy/sell decision.</div>
    <div class="controls">${Object.entries(presets).map(([k, v]) => `<span class="chip ${k === preset ? 'on' : ''}" data-p="${k}">${v.name}</span>`).join('')}</div>
    <div id="sc-body"></div>`;
  el.querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => { state.preset = c.dataset.p; UI.renderActive(); }));
  if (!fm) { document.getElementById('sc-body').innerHTML = '<div class="empty">Fundamentals bundle not present in this build.</div>'; return; }
  const p = presets[preset];
  const hits = Object.entries(fm.tickers).filter(([sym, fd]) => { try { return p.test(fd, sym); } catch (e) { return false; } })
    .sort((a, b) => (p.sort(a[1]) || 0) - (p.sort(b[1]) || 0)).slice(0, 60);
  const f = AL.fmt;
  document.getElementById('sc-body').innerHTML = `<div class="note" style="margin-bottom:8px">${hits.length} matches for "${p.name}"</div>
    <div class="panel"><div class="panel-body nopad" style="max-height:calc(100vh - 260px);overflow:auto">
    <table class="tbl"><thead><tr><th>Ticker</th><th>Sector</th><th class="r">Price</th><th class="r">P/E</th><th class="r">PEG</th><th class="r">Rev growth</th><th class="r">Net margin</th><th class="r">ROE</th><th class="r">Div yld</th><th class="r">Analyst</th></tr></thead><tbody>` +
    hits.map(([sym, fd]) => `<tr data-sym="${sym}"><td class="sym">${sym}</td><td class="t" style="font-size:11px">${f.esc((fd.sector || '').slice(0, 16))}</td>
      <td class="r">${fd.price ? f.px(fd.price) : '-'}</td><td class="r">${fd.pe != null ? f.n(fd.pe, 1) : '-'}</td><td class="r">${fd.peg != null ? f.n(fd.peg, 2) : '-'}</td>
      <td class="r ${f.cls(fd.revG)}">${fd.revG != null ? f.spct(fd.revG, 0) : '-'}</td><td class="r">${fd.pm != null ? f.pct(fd.pm, 0) : '-'}</td>
      <td class="r">${fd.roe != null ? f.pct(fd.roe, 0) : '-'}</td><td class="r">${fd.divY != null ? f.pct(fd.divY, 1) : '-'}</td>
      <td class="r">${fd.recKey ? `<span class="badge ${/buy/i.test(fd.recKey) ? 'ok' : /sell/i.test(fd.recKey) ? 'bad' : 'warn'}" style="font-size:9px">${fd.recKey.replace('_', ' ')}</span>` : '-'}</td></tr>`).join('') +
    '</tbody></table></div></div>';
  el.querySelectorAll('tr[data-sym]').forEach(tr => tr.addEventListener('click', () => UI.focusModule('decision', { sym: tr.dataset.sym })));
});

/* =========================================================
   MODULE: Peer Comparison
   ========================================================= */
UI.def('peers', 'Peer Comparison', '⊞', 'Advisory', function (el, state, tab) {
  const sym = (state.sym || 'AAPL').toUpperCase();
  const fm = AL.fundMeta();
  const fd = AL.fund(sym);
  el.innerHTML = `
    <div class="section-title">Peer Comparison
      <span style="flex:1"></span>
      <input class="inp" id="pr-sym" value="${sym}" style="width:110px;text-transform:uppercase"><button class="btn primary" id="pr-go">Compare</button></div>
    <div id="pr-body">${fd ? '' : `<div class="empty">No fundamentals for ${AL.fmt.esc(sym)}. Try a large-cap ticker.</div>`}</div>`;
  const go = () => { state.sym = document.getElementById('pr-sym').value.trim().toUpperCase(); UI.renderActive(); };
  document.getElementById('pr-go').addEventListener('click', go);
  document.getElementById('pr-sym').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  if (!fd || !fm) return;
  const f = AL.fmt;
  // peers = same sector, closest by market cap, up to 10
  const peers = Object.entries(fm.tickers).filter(([s, x]) => x.sector === fd.sector && x.mktCap)
    .sort((a, b) => Math.abs((a[1].mktCap || 0) - (fd.mktCap || 0)) - Math.abs((b[1].mktCap || 0) - (fd.mktCap || 0)))
    .slice(0, 10).map(([s]) => s);
  if (!peers.includes(sym)) peers.unshift(sym);
  const metrics = [['P/E', 'pe', 1, false], ['Fwd P/E', 'fpe', 1, false], ['PEG', 'peg', 2, false], ['P/B', 'pb', 1, false],
    ['Rev growth', 'revG', 0, true], ['Net margin', 'pm', 0, true], ['ROE', 'roe', 0, true], ['Div yield', 'divY', 2, true]];
  document.getElementById('pr-body').innerHTML = `
    <div class="note" style="margin-bottom:8px">${sym} versus ${peers.length - 1} closest ${f.esc(fd.sector)} peers by market cap. Green marks the best value in each row.</div>
    <div class="panel"><div class="panel-body nopad" style="overflow:auto">
    <table class="tbl"><thead><tr><th>Metric</th>${peers.map(s => `<th class="r ${s === sym ? 'sym' : ''}">${s}</th>`).join('')}</tr></thead><tbody>
    ${metrics.map(([label, key, dp, higherBetter]) => {
      const vals = peers.map(s => AL.fund(s) ? AL.fund(s)[key] : null);
      const valid = vals.filter(v => v != null && isFinite(v));
      const best = valid.length ? (higherBetter ? Math.max(...valid) : Math.min(...valid.filter(v => v > 0))) : null;
      return `<tr><td class="t">${label}</td>${peers.map((s, i) => {
        const v = vals[i];
        const isBest = v != null && v === best;
        const disp = v == null ? '-' : (key === 'revG' || key === 'pm' || key === 'roe' || key === 'divY') ? f.pct(v, dp) : f.n(v, dp);
        return `<td class="r ${isBest ? 'up' : ''}" style="${isBest ? 'font-weight:700' : ''}">${disp}</td>`;
      }).join('')}</tr>`;
    }).join('')}
    <tr><td class="t">Decision</td>${peers.map(s => { const dc = UI.decision(s); return `<td class="r"><span class="badge ${dc.call === 'BUY' ? 'ok' : dc.call === 'SELL' ? 'bad' : 'warn'}" style="font-size:9px">${dc.call}</span></td>`; }).join('')}</tr>
    </tbody></table></div></div>
    <div class="note" style="margin-top:8px">Click a ticker header idea: open its full decision from the Screener or Advisor. Peer valuation context is exactly how analysts sanity-check whether a stock is cheap or expensive.</div>`;
});
