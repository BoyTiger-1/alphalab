/* modules D: the beginner guide, stock advisor, sentiment desk, and welcome overlay */
'use strict';

// pull the alt-data bundle if the build shipped one (news/social/attention)
AL.alt = () => (window.ALPHALAB_ALT && window.ALPHALAB_ALT.tickers) || {};
AL.altMeta = () => window.ALPHALAB_ALT || null;

// distill the raw alt feeds for one ticker into a few usable signals
UI.altSignals = function (sym) {
  const a = AL.alt()[sym];
  if (!a) return null;
  const out = { sym };
  if (a.st && (a.st.bull + a.st.bear) >= 5) {
    out.bullRatio = a.st.bull / (a.st.bull + a.st.bear);   // share of tagged messages that are bullish
    out.watchers = a.st.watchers;
  }
  if (a.newsTone && a.newsTone.v.length > 20) {
    const v = a.newsTone.v;
    out.tone = Q.mean(v.slice(-14));                        // avg news tone, last 2 weeks
    out.toneTrend = out.tone - Q.mean(v.slice(0, -14));     // vs the earlier window
  }
  if (a.newsVol && a.newsVol.v.length > 20) {
    const v = a.newsVol.v;
    const base = Q.mean(v.slice(0, -7)) || 1;
    out.newsSpike = Q.mean(v.slice(-7)) / base - 1;         // is coverage picking up?
  }
  if (a.wiki && a.wiki.v.length > 30) {
    const v = a.wiki.v;
    out.attention = Q.mean(v.slice(-7)) / (Q.mean(v) || 1) - 1;  // wiki views last week vs 4-month norm
  }
  return out;
};

/* ---- multi-factor stock scoring used by the Advisor ---- */
UI.advisorUniverse = () => AL.catalog().filter(x => x.cls === 'Equity').map(x => x.sym);

UI.scoreStocks = function () {
  const syms = UI.advisorUniverse();
  const regime = Q.marketRegime();
  const spyR = AL.returns('SPY');
  const spyMap = new Map(spyR.dates.map((d, i) => [d, spyR.values[i]]));
  const rows = [];
  for (const sym of syms) {
    const s = AL.getSeries(sym);
    const px = s.values, n = px.length;
    if (n < 800) continue;
    const rets = [];
    for (let i = n - 756; i < n; i++) rets.push(px[i] / px[i - 1] - 1);
    const r252 = rets.slice(-252), r63 = rets.slice(-63);
    // the raw factor inputs, all straight off real price history
    const mom = px[n - 11] / px[n - 137] - 1;                          // 6-month momentum, 2-week skip
    const sma200 = Q.sma(px.slice(-260), 200);
    const trend = px[n - 1] / sma200[sma200.length - 1] - 1;           // distance above/below 200-day average
    const vol = Q.std(r63) * Math.sqrt(252);
    const sharpe = Q.std(r252) ? (Q.mean(r252) * 252 - 0.02) / (Q.std(r252) * Math.sqrt(252)) : 0;
    // how often did it finish a month green over the last 3 years
    let posM = 0, mTot = 0;
    for (let m = 0; m + 21 <= rets.length; m += 21) { mTot++; if (Q.sum(rets.slice(m, m + 21)) > 0) posM++; }
    const consistency = mTot ? posM / mTot : 0.5;
    const ddHigh = px[n - 1] / Math.max(...px.slice(-252)) - 1;        // pullback from 52-week high
    const dts = s.dates.slice(-252);
    const spv = dts.map(d => spyMap.get(d) ?? 0);
    const beta = Q.linreg(spv, r252).b;
    const alt = UI.altSignals(sym);
    rows.push({ sym, name: s.name, mom, trend, vol, sharpe, consistency, ddHigh, beta, alt, rets, last: px[n - 1] });
  }
  // z-score every factor across the universe so they're comparable
  const z = (key, invert) => {
    const vals = rows.map(r => r[key]);
    const m = Q.mean(vals), sd = Q.std(vals) || 1;
    rows.forEach(r => r['z_' + key] = (invert ? -1 : 1) * (r[key] - m) / sd);
  };
  z('mom'); z('trend'); z('sharpe'); z('vol', true); z('consistency');
  // regime fit: reward beta in risk-on tape, punish it when the regime turns defensive
  rows.forEach(r => r.z_regime = (regime.pCalm > 0.5 ? 0.5 : -1.2) * ((r.beta - 1)));
  // sentiment composite from whatever alt feeds this name has
  rows.forEach(r => {
    const a = r.alt;
    if (!a) { r.z_sent = 0; r.hasSent = false; return; }
    const parts = [];
    if (a.bullRatio != null) parts.push((a.bullRatio - 0.5) * 4);      // 0.5 is neutral crowd
    if (a.toneTrend != null) parts.push(Math.max(-1.5, Math.min(1.5, a.toneTrend)));
    if (a.attention != null && a.attention > 0.25) parts.push(Math.sign(r.mom) * Math.min(a.attention, 1)); // attention spikes amplify the trend
    r.z_sent = parts.length ? Q.mean(parts) : 0;
    r.hasSent = parts.length > 0;
  });
  // weighted composite; weights sum to 1
  const W = { z_mom: 0.20, z_trend: 0.16, z_sharpe: 0.16, z_vol: 0.12, z_consistency: 0.10, z_regime: 0.11, z_sent: 0.15 };
  rows.forEach(r => {
    r.score = Object.entries(W).reduce((s2, [k, w]) => s2 + w * (r[k] || 0), 0);
    // confidence: probabilistic sharpe on the last year of returns, blended with data coverage
    r.conf = Q.psr(r.rets.slice(-252)) * (r.hasSent ? 1 : 0.92);
  });
  rows.sort((a, b) => b.score - a.score);
  return { rows, regime, weights: W };
};

// plain-english reasoning for one scored stock, built from its strongest and weakest factors
UI.stockThesis = function (r, regime) {
  const f = AL.fmt;
  const good = [], bad = [];
  const say = (cond, g, b) => (cond ? good : bad).push(cond ? g : b);
  if (r.z_mom > 0.3) good.push(`strong 6-month momentum (${f.spct(r.mom)})`);
  else if (r.z_mom < -0.3) bad.push(`weak 6-month momentum (${f.spct(r.mom)})`);
  if (r.trend > 0.02) good.push(`trading ${f.pct(r.trend, 1)} above its 200-day average (established uptrend)`);
  else if (r.trend < -0.02) bad.push(`trading ${f.pct(-r.trend, 1)} below its 200-day average (downtrend)`);
  if (r.z_sharpe > 0.3) good.push(`top-tier risk-adjusted returns this year (Sharpe ${f.n(r.sharpe)})`);
  if (r.z_vol > 0.4) good.push(`calmer than most peers (${f.pct(r.vol, 0)} annualized volatility)`);
  else if (r.z_vol < -0.6) bad.push(`high volatility (${f.pct(r.vol, 0)} annualized), expect large swings`);
  if (r.consistency > 0.62) good.push(`finished ${f.pct(r.consistency, 0)} of recent months positive`);
  if (r.alt) {
    if (r.alt.bullRatio != null && r.alt.bullRatio > 0.65) good.push(`investor chatter on StockTwits runs ${f.pct(r.alt.bullRatio, 0)} bullish`);
    if (r.alt.bullRatio != null && r.alt.bullRatio < 0.35) bad.push(`social sentiment is bearish (only ${f.pct(r.alt.bullRatio, 0)} bullish messages)`);
    if (r.alt.toneTrend != null && r.alt.toneTrend > 0.3) good.push(`worldwide news tone has been improving over the last two weeks`);
    if (r.alt.toneTrend != null && r.alt.toneTrend < -0.3) bad.push(`news tone has been deteriorating recently`);
    if (r.alt.attention != null && r.alt.attention > 0.4) good.push(`public attention is spiking (Wikipedia views ${f.pct(r.alt.attention, 0)} above normal)`);
  }
  if (regime.pCalm <= 0.5 && r.beta > 1.2) bad.push(`beta of ${f.n(r.beta)} is risky in the current stressed regime`);
  const gtxt = good.length ? 'Why it ranks here: ' + good.slice(0, 4).join('; ') + '.' : '';
  const btxt = bad.length ? ' Watch out for: ' + bad.slice(0, 3).join('; ') + '.' : ' No major red flags in the factor set.';
  return gtxt + btxt;
};

/* =========================================================
   MODULE: Stock Advisor
   ========================================================= */
UI.def('advisor', 'Stock Advisor', '✦', 'Advisory', function (el, state, tab) {
  el.innerHTML = `
    <div class="section-title">Stock Advisor, multi-factor recommendations
      <span class="badge dim">price factors + news + social + attention</span>
      <span style="flex:1"></span><button class="btn primary" id="ad-run">Score the universe</button></div>
    <div class="info-box" style="margin-bottom:12px">Every stock in the universe is scored on seven ingredients: 6-month momentum, 200-day trend, 1-year risk-adjusted return, volatility, monthly consistency, fit with the current market regime, and a sentiment composite built from real GDELT news tone, StockTwits investor chatter, and Wikipedia attention data. Scores are relative rankings from historical data, not guarantees. AlphaLab recommends and explains; you decide.</div>
    <div id="ad-body"><div class="empty">Press "Score the universe" to rank all stocks.</div></div>`;
  const run = () => {
    document.getElementById('ad-body').innerHTML = '<div class="empty">Scoring on real history...</div>';
    setTimeout(() => {
      const res = UI.scoreStocks();
      state._res = res;
      render(res);
    }, 30);
  };
  const render = (res) => {
    const f = AL.fmt;
    const { rows, regime } = res;
    const top = rows.slice(0, 8);
    // suggested weights: inverse-vol across the top picks, capped at 18% each
    const iv = top.map(r => 1 / (r.vol || 0.2));
    const tot = Q.sum(iv);
    top.forEach((r, i) => r.sugW = Math.min(iv[i] / tot, 0.18));
    const wTot = Q.sum(top.map(r => r.sugW));
    top.forEach(r => r.sugW /= wTot);
    document.getElementById('ad-body').innerHTML = `
      <div class="note" style="margin-bottom:8px">Regime at scoring: <b>${regime.label}</b>. ${regime.pCalm > 0.5 ? 'Risk-on tape, momentum and beta get a small boost.' : 'Stressed tape, the model favors low-beta defensive names.'}</div>
      <div class="grid g23">
        <div class="panel"><div class="panel-body nopad" style="max-height:calc(100vh - 300px);overflow:auto">
          <table class="tbl" id="ad-tbl"><thead><tr><th>#</th><th>Stock</th><th class="r">Score</th><th class="r">Mom 6M</th><th class="r">vs 200d</th><th class="r">Sharpe 1Y</th><th class="r">Vol</th><th class="r">Sentiment</th><th class="r">Confidence</th></tr></thead><tbody>
          ${rows.map((r, i) => `<tr data-i="${i}"><td>${i + 1}</td><td class="t"><span class="sym">${r.sym}</span> ${f.esc(r.name.slice(0, 20))}</td>
            <td class="r"><b class="${f.cls(r.score)}">${f.n(r.score)}</b></td>
            <td class="r ${f.cls(r.mom)}">${f.spct(r.mom)}</td><td class="r ${f.cls(r.trend)}">${f.spct(r.trend)}</td>
            <td class="r">${f.n(r.sharpe)}</td><td class="r">${f.pct(r.vol, 0)}</td>
            <td class="r ${r.hasSent ? f.cls(r.z_sent) : ''}">${r.hasSent ? f.n(r.z_sent) : 'n/a'}</td>
            <td class="r">${f.pct(r.conf, 0)}</td></tr>`).join('')}
          </tbody></table></div></div>
        <div style="display:flex;flex-direction:column;gap:12px;min-width:0">
          <div class="panel"><div class="panel-head">Suggested starter basket (top 8, inverse-volatility)</div><div class="panel-body">
            ${top.map(r => `<div class="kv"><span class="k"><span class="sym">${r.sym}</span> ${f.esc(r.name.slice(0, 18))}</span><span class="v">${f.pct(r.sugW, 1)}</span></div>`).join('')}
            <div class="note" style="margin-top:8px">Weights cap any single name near 18% so one stock cannot sink the book. Use My Holdings to enter these with your budget, then stress test in Risk Lab.</div></div></div>
          <div class="panel"><div class="panel-head">Pick detail</div><div class="panel-body" id="ad-detail"><div class="empty">Click any stock for the full reasoning.</div></div></div>
        </div>
      </div>`;
    document.querySelectorAll('#ad-tbl tr[data-i]').forEach(tr => tr.addEventListener('click', () => detail(rows[+tr.dataset.i], regime)));
    detail(rows[0], regime);
  };
  const detail = (r, regime) => {
    const f = AL.fmt;
    // real forward-return range: block bootstrap the stock's own last 3y of daily returns out 63 days
    const paths = Q.monteCarlo(r.rets, 63, 800, 7, 5).map(p => p[p.length - 1] - 1);
    const lo = Q.quantile(paths, 0.05), mid = Q.quantile(paths, 0.5), hi = Q.quantile(paths, 0.95);
    // does it actually diversify the current book?
    let fit = '';
    const pf = AL.store.get('holdings', UI.DEMO_BOOK);
    if (pf.length && !pf.some(h => h.sym === r.sym)) {
      try {
        const al = AL.align([r.sym, ...pf.map(h => h.sym)], 'ret');
        const mine = al.dates.map((_, t) => pf.reduce((s2, h) => s2 + (al.cols[h.sym] ? al.cols[h.sym][t] : 0), 0) / pf.length);
        const c = Q.corr(al.cols[r.sym].slice(-252), mine.slice(-252));
        fit = `<div class="kv"><span class="k">Correlation to your current book (1y)</span><span class="v">${f.n(c)}</span></div>
          <div class="note">${c < 0.5 ? 'Low correlation, adding this genuinely diversifies you.' : 'High correlation, this mostly doubles down on what you already own.'}</div>`;
      } catch (e) { /* symbol alignment can fail on short histories */ }
    }
    document.getElementById('ad-detail').innerHTML = `
      <div style="font-weight:650;font-size:14px;margin-bottom:4px">${r.sym} · ${f.esc(r.name)} <span class="badge ${r.score > 0.2 ? 'ok' : r.score > -0.2 ? 'warn' : 'bad'}">score ${f.n(r.score)}</span></div>
      <div class="note" style="margin-bottom:8px;line-height:1.6">${UI.stockThesis(r, regime)}</div>
      <div class="chart" style="height:130px" id="ad-fac"></div>
      <div class="kv"><span class="k">Next-quarter range (bootstrap of its real history)</span><span class="v">${f.spct(lo)} to ${f.spct(hi)} (median ${f.spct(mid)})</span></div>
      <div class="kv"><span class="k">Statistical confidence (PSR, 1y)</span><span class="v">${f.pct(r.conf, 0)}</span></div>
      <div class="kv"><span class="k">Last close</span><span class="v">${f.px(r.last)}</span></div>
      ${fit}
      <div style="display:flex;gap:8px;margin-top:10px">
        <button class="btn small primary" id="ad-buy">Add to My Holdings</button>
        <button class="btn small" onclick="UI.openTab('chart',{sym:'${r.sym}',forceNew:true},'${r.sym} Chart')">Chart</button>
        <button class="btn small" onclick="UI.focusModule('sentiment',{sym:'${r.sym}'})">Sentiment</button>
      </div>
      <div class="warn-box" style="margin-top:10px">This is a ranked research view of real historical and sentiment data. It is not a prediction or individual investment advice.</div>`;
    C.bars(document.getElementById('ad-fac'), [
      { label: 'Momentum', value: r.z_mom }, { label: 'Trend', value: r.z_trend },
      { label: 'Sharpe', value: r.z_sharpe }, { label: 'Low vol', value: r.z_vol },
      { label: 'Consistency', value: r.z_consistency }, { label: 'Regime fit', value: r.z_regime },
      { label: 'Sentiment', value: r.z_sent }], { horizontal: true });
    document.getElementById('ad-buy').addEventListener('click', () => {
      const qty = parseFloat(prompt(`Quantity of ${r.sym} to add (last close ${f.px(r.last)}):`));
      if (!isFinite(qty) || qty <= 0) return;
      const pf2 = AL.store.get('holdings', UI.DEMO_BOOK);
      pf2.push({ sym: r.sym, qty, costBasis: r.last });
      // if a cash balance exists (wharton mode), pay for the shares out of it
      const cash = AL.store.get('cash', null);
      if (cash != null) AL.store.set('cash', cash - qty * r.last);
      AL.store.set('holdings', pf2);
      alert(`${qty} ${r.sym} added at ${f.px(r.last)}. Open My Holdings to review.`);
    });
  };
  document.getElementById('ad-run').addEventListener('click', run);
  if (state._res) render(state._res); else run();
});

/* =========================================================
   MODULE: Sentiment & News desk
   ========================================================= */
UI.def('sentiment', 'Sentiment & News', '◍', 'Advisory', function (el, state, tab) {
  const alt = AL.alt();
  const syms = Object.keys(alt);
  if (!syms.length) {
    el.innerHTML = '<div class="empty">No alt-data bundle in this build. Run tools/download_altdata.py and reassemble.</div>';
    return;
  }
  // default to a name that has the full feed set so first impressions are complete
  const best = syms.find(s => alt[s].newsTone && alt[s].wiki && alt[s].st) || syms[0];
  const sym = state.sym && alt[state.sym] ? state.sym : best;
  const meta = AL.altMeta();
  el.innerHTML = `
    <div class="section-title">Sentiment and News Intelligence
      <span class="badge ok">REAL ALT-DATA</span>
      <span class="note">snapshot ${meta.asof}</span>
      <span style="flex:1"></span>
      <select class="inp" id="sn-sym">${syms.map(s => `<option ${s === sym ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <button class="btn" id="sn-live">Refresh live</button></div>
    <div class="info-box" style="margin-bottom:12px">Three real feeds per name: worldwide news tone and coverage volume from GDELT (which indexes online news, including broadcast transcripts), investor message sentiment from StockTwits, and public attention from Wikipedia pageviews. "Refresh live" re-pulls Wikipedia and GDELT straight from your browser when you are online; the bundled snapshot is the fallback.</div>
    <div class="grid g2" style="margin-bottom:12px">
      ${UI.panel('Worldwide news tone (GDELT, 2 months) <span class="badge dim">above 0 = positive coverage</span>', '<div class="chart h220" id="sn-tone"></div>')}
      ${UI.panel('News coverage volume (share of all monitored articles)', '<div class="chart h220" id="sn-vol"></div>')}
    </div>
    <div class="grid g2">
      ${UI.panel('Public attention (Wikipedia daily pageviews, 4 months)', '<div class="chart h220" id="sn-wiki"></div>')}
      ${UI.panel('Investor social sentiment (StockTwits)', '<div id="sn-social"></div>')}
    </div>`;
  const draw = (a) => {
    if (a.newsTone) {
      const dts = a.newsTone.d.map(d => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`);
      C.line(document.getElementById('sn-tone'), [{ name: 'tone', dates: dts, values: a.newsTone.v, color: C.SERIES[0], fill: true }], { zeroLine: true });
    } else document.getElementById('sn-tone').innerHTML = '<div class="empty">No news tone data for this name.</div>';
    if (a.newsVol) {
      const dts = a.newsVol.d.map(d => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`);
      C.line(document.getElementById('sn-vol'), [{ name: 'volume', dates: dts, values: a.newsVol.v, color: C.SERIES[2], fill: true }]);
    } else document.getElementById('sn-vol').innerHTML = '<div class="empty">No volume data.</div>';
    if (a.wiki) {
      const dts = AL.dateRange(a.wiki.d0, a.wiki.v.length);
      C.line(document.getElementById('sn-wiki'), [
        { name: 'daily views', dates: dts, values: a.wiki.v, color: C.SERIES[4], fill: true },
        { name: '7d avg', dates: dts, values: Q.sma(a.wiki.v, 7), color: C.SERIES[2], width: 2 }]);
    } else document.getElementById('sn-wiki').innerHTML = '<div class="empty">No attention data.</div>';
    const st = a.st, f = AL.fmt;
    const sig = UI.altSignals(sym) || {};
    document.getElementById('sn-social').innerHTML = st ? `
      <div class="kv"><span class="k">Bullish tagged messages (last 30)</span><span class="v up">${st.bull}</span></div>
      <div class="kv"><span class="k">Bearish tagged messages</span><span class="v dn">${st.bear}</span></div>
      <div class="kv"><span class="k">Crowd lean</span><span class="v">${st.bull + st.bear ? f.pct(st.bull / (st.bull + st.bear), 0) + ' bullish' : 'not enough tagged messages'}</span></div>
      <div class="kv"><span class="k">Watchlist followers</span><span class="v">${st.watchers ? st.watchers.toLocaleString() : 'n/a'}</span></div>
      ${sig.toneTrend != null ? `<div class="kv"><span class="k">News tone trend (2wk vs prior)</span><span class="v ${f.cls(sig.toneTrend)}">${sig.toneTrend >= 0 ? 'improving' : 'deteriorating'} (${f.n(sig.toneTrend)})</span></div>` : ''}
      ${sig.attention != null ? `<div class="kv"><span class="k">Attention vs 4-month norm</span><span class="v ${f.cls(sig.attention)}">${f.spct(sig.attention)}</span></div>` : ''}
      <div class="note" style="margin-top:8px">Extreme crowd bullishness is often a contrarian warning rather than a green light. The Advisor uses these numbers as one ingredient of seven, never alone.</div>` : '<div class="empty">No StockTwits data bundled for this name.</div>';
  };
  draw(alt[sym]);
  document.getElementById('sn-sym').addEventListener('change', e => { state.sym = e.target.value; UI.renderActive(); });
  // live refresh straight from the browser; works on the hosted site, fails soft elsewhere
  document.getElementById('sn-live').addEventListener('click', async () => {
    const btn = document.getElementById('sn-live');
    btn.textContent = 'Fetching...'; btn.disabled = true;
    const a = { ...alt[sym] };
    let got = 0;
    try {
      const wikiArticle = { AMZN: 'Amazon_(company)', AAPL: 'Apple_Inc.', TSLA: 'Tesla,_Inc.', NVDA: 'Nvidia', 'BTC-USD': 'Bitcoin' }[sym];
      const art = wikiArticle || (AL.getSeries(sym) ? AL.getSeries(sym).name.split(' ')[0] : sym);
      const end = new Date(), start = new Date(Date.now() - 120 * 864e5);
      const fmt = d => d.toISOString().slice(0, 10).replace(/-/g, '') + '00';
      const wr = await fetch(`https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/${encodeURIComponent(art)}/daily/${fmt(start)}/${fmt(end)}`);
      if (wr.ok) {
        const items = (await wr.json()).items || [];
        if (items.length) {
          const d0 = items[0].timestamp.slice(0, 8);
          a.wiki = { d0: `${d0.slice(0, 4)}-${d0.slice(4, 6)}-${d0.slice(6, 8)}`, v: items.map(x => x.views) };
          got++;
        }
      }
      const q = encodeURIComponent(`"${AL.getSeries(sym) ? AL.getSeries(sym).name.split(' ')[0] : sym}"`);
      const gr = await fetch(`https://api.gdeltproject.org/api/v2/doc/doc?query=${q}&mode=timelinetone&timespan=2months&format=json`);
      if (gr.ok) {
        const j = await gr.json();
        if (j.timeline) {
          a.newsTone = { d: j.timeline[0].data.map(p => p.date.slice(0, 8)), v: j.timeline[0].data.map(p => +p.value.toFixed(2)) };
          got++;
        }
      }
    } catch (e) { /* offline or CSP-blocked, keep the snapshot */ }
    btn.textContent = got ? `Refreshed (${got} feeds live)` : 'Live fetch blocked, using snapshot';
    btn.disabled = false;
    draw(a);
  });
});

/* =========================================================
   MODULE: Guide (plain-english manual for people new to all of this)
   ========================================================= */
UI.def('guide', 'How To Use This', '?', 'Start Here', function (el, state) {
  const g = (h, body) => `<div class="panel" style="margin-bottom:12px"><div class="panel-head">${h}</div><div class="panel-body"><div class="note" style="font-size:12.5px;line-height:1.75;color:var(--ink2)">${body}</div></div></div>`;
  el.innerHTML = `
    <div class="section-title">The Complete Guide</div>
    <div class="grid g2">
    <div>
    ${g('What is AlphaLab, in one paragraph', `AlphaLab is a research terminal for stocks and other markets. It holds 26 years of real price history plus real news, social, and attention data, and it lets you test ideas against that history before you risk money on them. Think of it as a flight simulator for investing: you can try a strategy, crash it safely, and read exactly why it crashed. It never touches real money and never places trades.`)}
    ${g('Never invested before? Do these five things', `
      <b>1. Look at a stock.</b> Press Ctrl+K, type a ticker like AMZN, hit Enter. The chart shows its real price history. The red "drawdown" chart below shows every painful drop it has ever had. That is what owning it feels like.<br><br>
      <b>2. Get recommendations.</b> Open <b>Stock Advisor</b> in the left menu. It ranks every stock using seven factors (explained below) and hands you a suggested starter basket with weights. Click any stock to read the reasoning in plain English.<br><br>
      <b>3. Build your portfolio.</b> Open <b>My Holdings</b>, press Wharton mode to start with $100,000 of virtual cash, and add positions. The Advisor's "Add to My Holdings" button does this for you and deducts the cash.<br><br>
      <b>4. Stress test it.</b> Open <b>Risk Lab</b>. It replays your exact portfolio through the 2008 crisis, the COVID crash, and Black Monday 1987 using real data, and shows the dollar loss you would have taken. If that number scares you, diversify more.<br><br>
      <b>5. Get the report.</b> In My Holdings, press "Strategy report". You get a written investment strategy document (great for competition submissions) that explains your allocation, risks, and reasoning.`)}
    ${g('Playbook: Wharton Global Investment Competition', `
      The competition gives your team about $100,000 of virtual money and judges you on your <b>strategy and reasoning</b>, not just returns. AlphaLab maps to that directly:<br><br>
      <b>Step 1.</b> My Holdings, press <b>Wharton mode ($100K)</b>. You now have a clean cash balance.<br>
      <b>Step 2.</b> Stock Advisor, press Score the universe. Read the top names and their theses. Check each pick's Sentiment tab so you can cite news tone and investor sentiment in your writeup.<br>
      <b>Step 3.</b> Add 8 to 12 positions. Keep any single stock under about 15% and mix sectors; judges reward diversification discipline.<br>
      <b>Step 4.</b> Risk Lab: run the 2008 and COVID replays and the Monte Carlo. Write the worst-case numbers into your strategy document; showing you measured downside is exactly what wins.<br>
      <b>Step 5.</b> My Holdings, <b>Strategy report</b>, then Print to PDF. It gives you allocation, rationale per holding, risk analysis, and benchmarks in institutional format. Edit in your own team voice before submitting; judges can tell copy-paste.<br>
      <b>Step 6.</b> Rebalance as the competition runs. Re-run the Advisor weekly; the AI review flags concentration drift and regime changes.`)}
    ${g('What the seven Advisor factors mean', `
      <b>Momentum:</b> how much the stock rose over 6 months. Winners tend to keep winning for a while.<br>
      <b>Trend:</b> is the price above its 200-day average? Above = healthy uptrend.<br>
      <b>Sharpe:</b> return earned per unit of risk taken. Higher is better; 1+ is very good.<br>
      <b>Low volatility:</b> calmer stocks compound more reliably than wild ones.<br>
      <b>Consistency:</b> what share of recent months were positive.<br>
      <b>Regime fit:</b> the platform detects whether the whole market is calm or stressed and favors aggressive names in calm tapes, defensive ones in stress.<br>
      <b>Sentiment:</b> real news tone (GDELT), investor chatter (StockTwits), and public attention (Wikipedia views), combined.`)}
    </div>
    <div>
    ${g('Dictionary: every number on this site', `
      <b>CAGR:</b> average yearly growth rate. 10% CAGR doubles money in about 7 years.<br>
      <b>Volatility:</b> how much the value swings. 15% is normal for stocks, 60%+ is crypto territory.<br>
      <b>Sharpe ratio:</b> the single most-used quality score in finance. Return divided by risk. Below 0 = losing, 0.5 = decent, 1+ = strong, 2+ = suspicious, check for errors.<br>
      <b>Max drawdown:</b> the worst peak-to-bottom fall. A -50% drawdown needs a +100% gain to recover.<br>
      <b>Beta:</b> sensitivity to the market. Beta 1 moves with the S&P 500, beta 2 moves twice as hard, beta 0 ignores it.<br>
      <b>VaR (Value at Risk):</b> "on 95% of days you will not lose more than this."<br>
      <b>CVaR:</b> when you do breach VaR, this is the average size of that bad day.<br>
      <b>Backtest:</b> replaying a rule on history to see what it would have done. Good backtests charge trading costs and never peek at the future; AlphaLab does both.<br>
      <b>Out-of-sample:</b> testing on data the strategy was never tuned on. The only evidence that matters.<br>
      <b>IC (information coefficient):</b> correlation between a signal and what actually happened next. 0.05 is genuinely useful; 0.3 is a bug.<br>
      <b>Turnover:</b> how much trading a strategy does. High turnover = costs eat the edge.`)}
    ${g('What each module is for', `
      <b>Command Center:</b> the market at a glance, plus the current regime.<br>
      <b>Markets:</b> a screener of every instrument with real stats.<br>
      <b>Data Hub:</b> see every dataset, upload your own CSVs.<br>
      <b>AI Researcher:</b> an autonomous agent that invents and tests trading hypotheses around the clock and remembers every failure.<br>
      <b>Strategy Lab:</b> 118 classic strategies you can run and tweak on real history.<br>
      <b>Ensemble Engine:</b> makes strategies compete, then blends the uncorrelated winners.<br>
      <b>Alpha Factory:</b> machine-generates candidate trading signals and keeps only the survivors.<br>
      <b>ML Lab:</b> trains machine-learning price models in your browser, honestly walk-forward.<br>
      <b>Stock Advisor:</b> ranks stocks on seven factors and explains each pick.<br>
      <b>Sentiment & News:</b> real news tone, social sentiment, and attention data per stock.<br>
      <b>Portfolio Builder:</b> professional weighting math (risk parity, minimum variance, and friends).<br>
      <b>My Holdings:</b> your portfolio: profit and loss, risk, AI review, strategy reports.<br>
      <b>Risk Lab:</b> crash simulations on your actual book.<br>
      <b>Reports / Knowledge Base:</b> everything written down and searchable.`)}
    ${g('Reading a verdict without getting fooled', `When a strategy or factor says <b>VALIDATED</b>, it passed five separate honesty checks (works on unseen data, survives triple costs, stable to parameter changes, consistent across years, statistically significant). <b>REJECTED</b> means the edge is not real once costs and statistics are applied, which is the outcome for most ideas, and knowing that is the value. If a number ever looks amazing, distrust it first: check the out-of-sample column and the turnover before you believe anything.`)}
    ${g('Terminal cheat sheet', `<span class="num">CHART AMZN</span> · chart anything<br><span class="num">COMPARE SPY QQQ GLD</span> · overlay up to 4<br><span class="num">BT S001</span> · run a strategy by id<br><span class="num">STRESS 2008</span> · crisis replay (2008, COVID, 2022, DOTCOM, 1987)<br><span class="num">RESEARCH START</span> · wake the AI researcher<br><span class="num">FACTOR SCAN</span> · hunt for new signals<br><span class="num">GO HOLD</span> · jump to any module<br>Press <span class="num">Ctrl+K</span> anywhere for the command palette.`)}
    </div></div>`;
});

// first-visit welcome so nobody lands on the terminal cold
UI.showWelcome = function () {
  if (AL.store.get('seen_welcome', false)) return;
  const ov = document.createElement('div');
  // same look as the palette overlay but its own element, so ids stay unique
  ov.style.cssText = 'position:fixed;inset:0;background:#05070acc;z-index:1001;display:flex;align-items:flex-start;justify-content:center;padding-top:16vh';
  ov.innerHTML = `<div style="width:560px;max-width:92vw;background:#10141a;border:1px solid var(--line2);border-radius:10px;box-shadow:0 24px 80px #000c;padding:26px 30px">
    <div style="font-size:19px;font-weight:650;margin-bottom:8px">Welcome to AlphaLab</div>
    <div class="note" style="font-size:13px;line-height:1.7;margin-bottom:14px">A research terminal for markets, built on 26 years of real data. You do not need any finance background: the guide explains every screen and every number in plain English, and there is a step-by-step playbook for the Wharton Investment Competition.</div>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <button class="btn primary" id="w-guide">Open the guide</button>
      <button class="btn" id="w-wharton">Wharton competition setup</button>
      <button class="btn" id="w-skip">Just explore</button>
    </div></div>`;
  document.body.appendChild(ov);
  const close = () => { AL.store.set('seen_welcome', true); ov.remove(); };
  ov.querySelector('#w-guide').addEventListener('click', () => { close(); UI.focusModule('guide'); });
  ov.querySelector('#w-wharton').addEventListener('click', () => { close(); UI.focusModule('holdings', { wharton: true }); });
  ov.querySelector('#w-skip').addEventListener('click', close);
};
