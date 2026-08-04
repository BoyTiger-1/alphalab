/* AlphaLab modules H: Competition Command Center.
   Turns a starting amount of capital into a regime-aware, multi-asset target portfolio
   (real tickers + exact share counts) and a daily rebalancing briefing that says what to
   buy or sell today. It is built on the same regime model, optimizers, advisor and decision
   engine the rest of AlphaLab uses, so the plan is defensible number-by-number. It never
   trades on its own: nothing changes until you press Build. */
'use strict';

// pick the first instrument in a preference list that actually exists in this build, so a
// plan still works before newly added ETFs have been downloaded (EFA<-VEA, EEM<-VWO, SHY<-BIL)
UI.pickSym = list => list.find(s => AL.getSeries(s));

// strategic bucket weights per risk profile: equity / bonds / real assets / crypto / cash,
// plus a rough annualized vol target used only for the expected-risk readout
UI.RISK_PROFILES = {
  conservative: { label: 'Conservative', blurb: 'capital preservation first', eq: 0.35, bond: 0.45, real: 0.12, crypto: 0.01, cash: 0.07, vt: 0.07 },
  balanced: { label: 'Balanced', blurb: 'growth with a real safety sleeve', eq: 0.55, bond: 0.25, real: 0.12, crypto: 0.03, cash: 0.05, vt: 0.10 },
  aggressive: { label: 'Aggressive', blurb: 'maximize growth, accept bigger swings', eq: 0.72, bond: 0.08, real: 0.12, crypto: 0.06, cash: 0.02, vt: 0.14 },
};

// bars per year inferred from a date list: the target mixes daily ETFs and weekly single
// stocks, so the aligned cadence is whatever survives the intersection (usually weekly)
UI.periodsPerYear = function (dates) {
  if (!dates || dates.length < 3) return 252;
  const gaps = [];
  for (let i = 1; i < dates.length; i++) gaps.push((Date.parse(dates[i]) - Date.parse(dates[i - 1])) / 864e5);
  gaps.sort((a, b) => a - b);
  const med = gaps[gaps.length >> 1];
  return med <= 1.6 ? 252 : med <= 10 ? 52 : med <= 45 ? 12 : 1;
};

// A price-only trend read that works for ANY instrument: single stocks, index/sector ETFs, bond
// funds, gold, broad commodities and crypto. The fundamental Decision engine only covers single
// stocks that have SEC filings and analyst coverage, so without this the whole ETF/bond/gold/
// crypto side of the plan showed a blank call. This fills every one of those cells honestly. It
// is explicitly a trend read on the real price history (long-trend + moving-average posture +
// momentum), not a fundamental verdict, so the UI labels it as such and never conflates the two.
UI.trendSignal = function (sym) {
  const s = AL.getSeries(sym);
  if (!s || !s.values || s.values.length < 40) return null;
  const v = s.values, n = v.length, last = v[n - 1];
  const ma50 = Q.mean(v.slice(-50));
  const ma200 = Q.mean(v.slice(Math.max(0, n - 200)));
  const back = Math.min(63, n - 1);                       // ~3 trading months, or as far back as we have
  const mom = v[n - 1 - back] ? last / v[n - 1 - back] - 1 : 0;
  let score = 0;                                          // three simple, real conditions vote -1 / +1
  score += last > ma200 ? 1 : -1;                         // above or below the long-term trend
  score += ma50 > ma200 ? 1 : -1;                         // golden-cross vs death-cross posture
  score += mom > 0.02 ? 1 : mom < -0.02 ? -1 : 0;         // positive or negative 3-month momentum
  const call = score >= 2 ? 'BUY' : score <= -2 ? 'SELL' : 'HOLD';
  return { call, score, mom, aboveTrend: last > ma200,
    reason: `price ${last >= ma200 ? 'above' : 'below'} its long-term trend, 3-month move ${(mom * 100).toFixed(1)}%` };
};

// A signal for EVERY holding: the fundamental Decision engine where it has real coverage (single
// stocks), otherwise the universal price-trend read above. Returns { call, kind } so nothing is blank.
UI.instrumentCall = function (sym) {
  const ser = AL.getSeries(sym);
  // only real single companies carry company fundamentals; index ETFs, bonds, gold and crypto do
  // not, so they always get the price-trend read even when a data vendor happens to list a
  // fund-level ratio for the ticker. This keeps the Call column honest and matches the legend.
  if (ser && ser.cls === 'Equity') {
    try { const d = UI.decision(sym); if (d && d.coverage > 0) return { call: d.call, kind: 'fundamental' }; } catch (e) { }
  }
  const tr = UI.trendSignal(sym);
  return tr ? { call: tr.call, kind: 'trend' } : { call: null, kind: null };
};

// Render a coloured Call badge. A covered stock shows the Decision engine's BUY / SELL / HOLD verdict;
// a fund, bond, gold or crypto sleeve has no company fundamentals, so it shows its price-trend
// direction as Uptrend / Downtrend / Flat instead of a trade word that would clash with a plan that
// deliberately holds it as a hedge.
UI.callBadge = function (call, kind) {
  if (!call) return '<span class="note">-</span>';
  const trend = kind === 'trend';
  const label = trend ? (call === 'BUY' ? 'Uptrend' : call === 'SELL' ? 'Downtrend' : 'Flat') : call;
  const cls = call === 'BUY' ? 'ok' : call === 'SELL' ? 'bad' : 'warn';
  const tip = trend ? 'price-trend read: funds, bonds, gold and crypto carry no company fundamentals to score'
    : 'fundamental Buy / Sell / Hold verdict from the Decision engine';
  return `<span class="badge ${cls}" title="${tip}">${label}</span>`;
};

/* Build a full multi-asset target allocation. Pure-ish: reads the data layer + advisor but
   mutates nothing. Returns tickers, weights, dollars and share counts plus the reasoning. */
UI.buildAllocation = function (capital, profileKey, nStocks, opts) {
  const f = AL.fmt;
  const regime = Q.marketRegime();
  const P = UI.RISK_PROFILES[profileKey] || UI.RISK_PROFILES.balanced;
  nStocks = nStocks || 5;
  opts = opts || {};
  const inverted = regime.curve != null && regime.curve < 0;   // recession-warning yield curve

  // --- 1. bucket weights, tilted by the detected regime -------------------------------
  let eq = P.eq, bond = P.bond, real = P.real, crypto = P.crypto, cash = P.cash;
  const tilt = [];
  if (regime.tone === 'good') { eq *= 1.12; cash *= 0.5; tilt.push('risk-on regime: leaning into equities, trimming cash'); }
  else if (regime.tone === 'bad') { eq *= 0.68; bond *= 1.30; real *= 1.20; cash *= 1.7; tilt.push('risk-off regime: cutting equity, adding bonds, gold and cash'); }
  else { eq *= 0.93; bond *= 1.10; real *= 1.12; cash *= 1.1; tilt.push('mixed regime: a modest defensive lean'); }
  if (inverted) { bond *= 1.15; real *= 1.10; eq *= 0.95; tilt.push(`inverted yield curve (${f.n(regime.curve, 2)}%): extra long-duration and gold as a recession hedge`); }
  // renormalize the five buckets back to 100%
  let bsum = eq + bond + real + crypto + cash;
  eq /= bsum; bond /= bsum; real /= bsum; crypto /= bsum; cash /= bsum;
  const buckets = { Equity: eq, Bonds: bond, 'Real assets': real, Crypto: crypto, Cash: cash };

  // --- 2. instruments inside each bucket ----------------------------------------------
  const defensive = regime.tone === 'bad' || regime.tone === 'warn';
  const holdings = [];
  const add = (sym, bucket, role, w) => {
    if (w <= 0) return;
    const ser = AL.getSeries(sym);
    if (!ser) return;
    const price = ser.values[ser.values.length - 1];
    if (!(price > 0)) return;
    holdings.push({ sym, name: ser.name, cls: ser.cls, bucket, role, weight: w, price });
  };

  // 2a. equities: core index + hand-picked leaders + growth + international + dividend
  // regime shifts the intra-equity mix toward dividends/min-vol when defensive
  const eqMix = defensive
    ? { core: 0.34, stocks: 0.14, growth: 0.08, intl: 0.16, em: 0.08, div: 0.20 }
    : { core: 0.30, stocks: 0.24, growth: 0.16, intl: 0.16, em: 0.10, div: 0.04 };
  // Optional caller lever (the bot uses this): push single-stock conviction to a bigger share of the
  // equity bucket, shrinking the index sub-sleeves proportionally to make room, so the book leans into
  // real stock picks instead of sitting mostly in index ETFs. The bond and real-asset HEDGE sleeves are
  // untouched, so raising this trades index beta for single-name alpha, not hedges for risk. Website
  // callers omit opts and keep the original mix.
  if (opts.stockShare > 0) {
    const want = Math.min(0.85, opts.stockShare);
    const restKeys = ['core', 'growth', 'intl', 'em', 'div'];
    const restSum = restKeys.reduce((s, k) => s + eqMix[k], 0) || 1;
    const scale = (1 - want) / restSum;
    restKeys.forEach(k => { eqMix[k] *= scale; });
    eqMix.stocks = want;
  }
  const coreIdx = UI.pickSym(['SPY', 'VTI']);
  const growthIdx = UI.pickSym(['QQQ']);
  const intlIdx = UI.pickSym(['VEA', 'EFA']);
  const emIdx = UI.pickSym(['VWO', 'EEM']);
  const divIdx = UI.pickSym(['SCHD', 'USMV', 'QUAL']);
  if (coreIdx) add(coreIdx, 'Equity', 'core US market index', eq * eqMix.core);
  if (growthIdx) add(growthIdx, 'Equity', 'US large-cap growth', eq * eqMix.growth);
  if (intlIdx) add(intlIdx, 'Equity', 'international developed markets', eq * eqMix.intl);
  if (emIdx) add(emIdx, 'Equity', 'emerging markets', eq * eqMix.em);
  if (divIdx) add(divIdx, 'Equity', 'dividend / low-volatility equity', eq * eqMix.div);
  // individual leaders: top advisor names, one per sector, not rated SELL, large enough to defend
  const picks = UI.topStockPicks(nStocks);
  if (picks.length) {
    const per = eq * eqMix.stocks / picks.length;
    picks.forEach(p => add(p.sym, 'Equity', `single-stock leader (${p.sector})`, per));
  } else if (coreIdx) {
    // no stock data: fold that slice back into the core index so the equity bucket still fills
    const h = holdings.find(x => x.sym === coreIdx);
    if (h) h.weight += eq * eqMix.stocks;
  }

  // 2b. bonds: duration + credit, tilted to long Treasuries when defensive / inverted
  const bMix = (defensive || inverted)
    ? { tlt: 0.42, ief: 0.24, lqd: 0.14, emb: 0.06, tip: 0.14 }
    : { tlt: 0.24, ief: 0.28, lqd: 0.22, emb: 0.12, tip: 0.14 };
  add(UI.pickSym(['TLT']), 'Bonds', 'long-term US Treasuries', bond * bMix.tlt);
  add(UI.pickSym(['IEF', 'BND']), 'Bonds', 'intermediate US Treasuries', bond * bMix.ief);
  add(UI.pickSym(['LQD']), 'Bonds', 'investment-grade corporates', bond * bMix.lqd);
  add(UI.pickSym(['EMB']), 'Bonds', 'emerging-market sovereign bonds', bond * bMix.emb);
  add(UI.pickSym(['TIP']), 'Bonds', 'inflation-protected Treasuries', bond * bMix.tip);

  // 2c. real assets: gold-heavy when defensive
  const rMix = defensive ? { gld: 0.62, dbc: 0.20, vnq: 0.18 } : { gld: 0.45, dbc: 0.28, vnq: 0.27 };
  add(UI.pickSym(['GLD']), 'Real assets', 'gold', real * rMix.gld);
  add(UI.pickSym(['DBC', 'DBA']), 'Real assets', 'broad commodities', real * rMix.dbc);
  add(UI.pickSym(['VNQ']), 'Real assets', 'real estate (REITs)', real * rMix.vnq);

  // 2d. crypto sleeve
  add(UI.pickSym(['BTC-USD']), 'Crypto', 'bitcoin', crypto * 0.70);
  add(UI.pickSym(['ETH-USD']), 'Crypto', 'ethereum', crypto * 0.30);

  // some slots may have been skipped (missing instruments); renormalize invested weight so the
  // book plus the cash sleeve sums to exactly 100% of capital
  const invested = Q.sum(holdings.map(h => h.weight));
  const targetInvested = 1 - cash;
  if (invested > 0) holdings.forEach(h => h.weight *= targetInvested / invested);

  // --- 3. dollars, shares, and the decision-engine call for single names --------------
  let deployed = 0;
  holdings.forEach(h => {
    const dollars = capital * h.weight;
    // fractional units for crypto, whole shares for everything else
    h.shares = h.cls === 'Crypto' ? Math.floor(dollars / h.price * 1e4) / 1e4 : Math.floor(dollars / h.price);
    h.dollars = h.shares * h.price;
    deployed += h.dollars;
    // give every position a signal, not just single stocks: fundamental where we have coverage,
    // a price-trend read for the ETF / bond / gold / crypto sleeves so no row is left blank
    const c = UI.instrumentCall(h.sym);
    h.call = c.call; h.callKind = c.kind;
  });
  holdings.sort((a, b) => b.dollars - a.dollars);
  const cashDollars = capital - deployed;

  // --- 4. expected risk from the real return history of the blended target -------------
  // AL.align collapses a mix of daily ETFs and weekly single stocks onto the sparser (weekly)
  // grid, so we cannot assume 252 bars/year: infer the cadence from the aligned dates and
  // annualize / size the Monte Carlo horizon off that, or the vol and the "1 year" range lie.
  let expVol = null, mc = null;
  const invHoldings = holdings.filter(h => h.shares > 0);
  if (invHoldings.length >= 2) {
    const al = AL.align(invHoldings.map(h => h.sym), 'ret');
    if (al && al.syms.length >= 2 && al.dates.length > 30) {
      const wBySym = {}; invHoldings.forEach(h => wBySym[h.sym] = h.dollars / capital);
      const w = al.syms.map(s => wBySym[s] || 0);
      const ws = Q.sum(w) || 1; const wn = w.map(x => x / ws);
      // realized per-period return of the constant-mix target over its common history
      const blended = al.dates.map((_, t) => al.syms.reduce((s2, sym, i) => s2 + wn[i] * (al.cols[sym][t] || 0), 0));
      const ppy = UI.periodsPerYear(al.dates);
      expVol = Q.std(blended) * Math.sqrt(ppy);
      // one forward year, block-bootstrapped from the full common history so real drawdowns
      // (2018, 2020, 2022) show up in the draws. We DELIBERATELY do not project the last
      // decade's unusually strong drift forward: strip the in-sample mean and recenter each
      // draw onto the current risk-free rate, keeping the historical dispersion. Left raw, the
      // bootstrap's own drift put even the 5th-percentile year in positive territory, which
      // would read as "you can't lose" - a false promise. Centered on cash it asks the honest
      // question: what does this book's risk look like above a T-bill?
      const rfSer = AL.getSeries('DGS3MO') || AL.getSeries('^IRX');
      const rfAnn = rfSer ? rfSer.values[rfSer.values.length - 1] / 100 : 0.04;   // 3-month T-bill, percent -> decimal
      const drift = Q.mean(blended);
      const recentered = blended.map(r => r - drift + rfAnn / ppy);
      const paths = Q.monteCarlo(recentered, ppy, 2000, 42, ppy >= 200 ? 20 : 8);
      const term = paths.map(p => p[p.length - 1] - 1).sort((a, b) => a - b);
      mc = { median: Q.quantile(term, 0.5), p05: Q.quantile(term, 0.05), p95: Q.quantile(term, 0.95),
        pLoss: term.filter(x => x < 0).length / term.length, rf: rfAnn };
    }
  }

  return {
    capital, profileKey, profile: P, regime, buckets, tilt, holdings, cashDollars,
    cashPct: cashDollars / capital, expVol, mc, asof: AL.asof, inverted,
    ts: new Date().toISOString().slice(0, 16).replace('T', ' '), regimeLabel: regime.label,
  };
};

// The two stock tiers label sectors differently (S&P uses GICS, the total-market bundle uses a
// NASDAQ-ish scheme), so the same real sector shows up under two names. Fold the synonyms to one
// key so the "one per sector" rule below actually diversifies instead of double-counting tech or
// financials. Grab-bag buckets return '' so they never block a legitimate pick.
UI.SECTOR_ALIASES = {
  'Information Technology': 'Technology',
  'Finance': 'Financials',
  'Basic Materials': 'Materials',
  'Telecommunications': 'Communication Services',
  'Unknown': '', 'Miscellaneous': '',
};
UI.canonSector = s => (s == null ? '' : (UI.SECTOR_ALIASES[s] !== undefined ? UI.SECTOR_ALIASES[s] : s));

/* Top single-stock leaders for the equity sleeve, chosen for the greatest absolute decision, not by
   any one engine. Start from the advisor's best large-caps, then re-rank that shortlist by the full
   six-engine conviction (Decision, ML, Advisor, peer valuation, Sentiment, seasonality), drop anything
   the decision engine rejects or the ensemble nets negative on, and keep one name per sector. So the
   book only opens positions where several independent engines agree, and each pick is defensible. */
UI.topStockPicks = function (n) {
  let scored;
  try { scored = UI.scoreStocks(); } catch (e) { return []; }
  if (!scored || !scored.rows) return [];
  // advisor-ranked shortlist of real, liquid, genuine-buy candidates; capped so the ensemble (which
  // fits an ML model per name) only runs on a bounded set. The cap is generous vs the ~5 we keep.
  const shortlist = scored.rows.filter(r => UI.isLargeCap(r) && r.score >= 0.15).slice(0, 40);
  const ranked = [];
  for (const r of shortlist) {
    let call = null;
    try { call = UI.decision(r.sym).call; } catch (e) { }
    if (call === 'SELL') continue;            // never open a position the decision engine rejects
    let sc = null;
    try { sc = UI.symConviction(r.sym, scored); } catch (e) { }
    const conv = sc ? sc.conviction : (r.score || 0);   // fall back to the advisor score if fusion is unavailable
    if (conv <= 0) continue;                  // the fuller picture has to be net-positive to call it a leader
    ranked.push({ r, conv });
  }
  ranked.sort((a, b) => b.conv - a.conv);     // greatest absolute conviction first
  const out = [], seenSector = {};
  for (const { r } of ranked) {
    if (out.length >= n) break;
    const sec = UI.canonSector(r.sector);
    if (sec && seenSector[sec]) continue;     // one per sector (synonym-folded)
    if (sec) seenSector[sec] = true;
    out.push(r);
  }
  return out;
};

// "large and liquid" for advisor rows. S&P 500 constituents carry no market-cap field (only the
// extended tier-2 bundle does, in $millions), so membership is the reliable large-cap gate and,
// crucially, keeps the mega-caps in play; a cap filter alone would drop every S&P name to null.
UI.isLargeCap = function (r) {
  const sp = AL.sp500();
  return (sp && sp.cols[r.sym]) || (r.mc && r.mc > 5000);   // S&P member, or a > $5B extended name
};

// The ML lab's own forward view, folded into the ensemble as one more voter. It fits a ridge
// regression on the full 15-feature history (momentum, volatility, RSI, drawdown, VIX, yield-curve
// state and more) and reads off the model's projected ~1-week return under the latest market
// conditions. Genuinely out of sample: the model is trained on everything up to the most recent
// week, then asked about that week, so the number is the model's real read and not a curve-fit to
// today. Gated to single stocks with enough history because thin-history names produce wild,
// untrustworthy fits, and cached per symbol so a briefing never refits the same name twice.
UI._mlCache = UI._mlCache || {};
UI.mlForecast = function (sym) {
  if (sym in UI._mlCache) return UI._mlCache[sym];
  let out = null;
  try {
    const ser = AL.getSeries(sym);
    if (ser && ser.cls === 'Equity' && typeof ML !== 'undefined' && ML.makeFeatures) {
      const F = ML.makeFeatures(sym, 5);
      if (F && F.X.length >= 400) {                        // enough history for a stable fit; skip thin names
        const hold = 5;                                    // hold out the most recent week to predict out of sample
        const Xtr = F.X.slice(0, F.X.length - hold), ytr = F.y.slice(0, F.y.length - hold);
        const Xte = F.X.slice(F.X.length - hold);
        // standardize on the training block only, so the held-out week never leaks into the scaling
        const k = Xtr[0].length, mu = new Array(k).fill(0), sd = new Array(k).fill(0);
        for (let j = 0; j < k; j++) { const col = Xtr.map(r => r[j]); mu[j] = Q.mean(col); sd[j] = Q.std(col) || 1; }
        const std = r => r.map((v, j) => (v - mu[j]) / sd[j]);
        const fit = ML.models.ridge.fit(Xtr.map(std), ytr, { lambda: 3 });
        const pred = Q.mean(fit.predict(Xte.map(std)));    // smoothed projected 5-day forward return
        if (isFinite(pred)) out = { pred, z: Math.max(-1, Math.min(1, pred / 0.015)) };  // ~1.5% weekly edge is a full vote
      }
    }
  } catch (e) { }
  UI._mlCache[sym] = out;
  return out;
};

// A relative-value voter built from the same peer set the Peer Comparison tab uses: same sector,
// closest by market cap. It asks the one question every analyst asks first, is this name cheap or
// expensive versus the companies it actually competes with. Cheaper than the peer median on forward
// earnings is a mild bullish tilt, richer is a mild bearish one. Growth and quality are scored
// elsewhere in the Decision engine, so this axis stays pure valuation and carries a modest weight.
UI.peerValue = function (sym) {
  try {
    const fd = AL.fund(sym), fm = AL.fundMeta();
    if (!fd || !fm || !fd.sector) return null;
    const key = fd.fpe > 0 ? 'fpe' : fd.pe > 0 ? 'pe' : null;   // forward P/E preferred, trailing as fallback
    if (!key) return null;
    const mine = fd[key];
    if (!(mine > 0)) return null;
    const peerVals = Object.entries(fm.tickers)
      .filter(([s, x]) => s !== sym && x.sector === fd.sector && x.mktCap)
      .sort((a, b) => Math.abs((a[1].mktCap || 0) - (fd.mktCap || 0)) - Math.abs((b[1].mktCap || 0) - (fd.mktCap || 0)))
      .slice(0, 12)
      .map(([s]) => { const p = AL.fund(s); return p ? p[key] : null; })
      .filter(v => v != null && isFinite(v) && v > 0);
    if (peerVals.length < 4) return null;                        // too few comparables to trust the read
    const sorted = peerVals.slice().sort((a, b) => a - b);
    const med = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
    if (!(med > 0)) return null;
    const z = Math.max(-1, Math.min(1, med / mine - 1));         // cheaper than peers -> positive (bullish)
    const label = key === 'fpe' ? 'forward P/E' : 'P/E';
    const rel = z > 0.05 ? 'cheaper than' : z < -0.05 ? 'richer than' : 'in line with';
    const why = `Peer value: ${label} ${AL.fmt.n(mine, 1)} vs ${AL.fmt.n(med, 1)} sector median, ${rel} its ${peerVals.length} closest peers`;
    return { z, why, mine, med, key };
  } catch (e) { return null; }
};

// The Seasonality Explorer's read on the current calendar month, folded in as the lightest voter.
// Some names carry a real, economically grounded monthly pattern (tax flows, heating demand, earnings
// seasons). This only votes when the current month clears the same |t| > 2 significance bar the
// Seasonality tab uses; otherwise it stays silent so calendar noise never sways a call. Gated to
// single stocks and to names with several years of history, and weighted least of any engine.
UI.seasonalEdge = function (sym) {
  try {
    const ser = AL.getSeries(sym);
    if (!ser || ser.cls !== 'Equity') return null;              // structural sleeves get a trend read, not a stock bet
    const r = AL.returns(sym);
    if (!r || !r.dates || r.dates.length < 500) return null;    // need several years to trust a monthly average
    const mo = new Date().getMonth();                           // the month you are actually trading in, not the stale data date
    const bucket = [];
    r.dates.forEach((d, i) => { if (new Date(d + 'T12:00:00Z').getUTCMonth() === mo) bucket.push(r.values[i]); });
    if (bucket.length < 40) return null;
    const t = Q.tstat(bucket);
    if (!isFinite(t) || Math.abs(t) < 2) return null;           // not significant this month: stay out of the vote
    const avg = Q.mean(bucket) * 21;                            // full-month average return, not daily
    const z = Math.max(-1, Math.min(1, avg / 0.04));            // a 4% seasonal edge is a full vote
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const why = `Seasonality: ${months[mo]} has averaged ${avg >= 0 ? '+' : ''}${(avg * 100).toFixed(1)}% here (t=${t.toFixed(1)})`;
    return { z, why, t, avg, month: mo };
  } catch (e) { return null; }
};

// Fuse every engine's read on ONE symbol into a single signed conviction plus plain-English reasons.
// This is the heart of the "use all the other tabs" briefing. Six independent engines each vote on
// the same [-1, +1] scale: the fundamental Decision engine, the ML lab's forward-return model, the
// Advisor's cross-sectional factor score, a peer-relative valuation check, the alt-data Sentiment
// desk, and a calendar-seasonality tilt. Conviction is their WEIGHTED average, so the richer, more
// reliable engines pull harder while a lone weak voter cannot carry a call. Honest by construction:
// a name only earns a strong number when several independent engines point the same way. Returns
// null for instruments no engine covers (index ETFs, bonds, gold, crypto): those are structural
// sleeves, sized by the plan and read for trend, not single-stock bets.
UI.symConviction = function (sym, scored) {
  let dec = null; try { dec = UI.decision(sym); } catch (e) { }
  const srow = scored && scored.bySym ? scored.bySym[sym] : null;
  const score = srow ? srow.score : null;
  let alt = null; try { alt = UI.altSignals ? UI.altSignals(sym) : null; } catch (e) { }
  const ml = UI.mlForecast(sym);
  const peer = UI.peerValue(sym);
  const seas = UI.seasonalEdge(sym);
  // each engine: [signed vote in [-1,1], weight, plain-English sentence]. Weights reflect how much
  // signal each engine really carries: the Decision engine (which itself fuses technicals, analysts,
  // quality, growth, value and sentiment) leads; seasonality, a mere calendar tilt, trails.
  const votes = [];
  if (dec && dec.coverage > 0)
    votes.push([Math.max(-1, Math.min(1, dec.overall / 0.4)), 1.00, `Decision engine: ${dec.call} (${dec.overall >= 0 ? '+' : ''}${dec.overall.toFixed(2)})`]);
  if (ml)
    votes.push([ml.z, 0.80, `ML model projects ${ml.pred >= 0 ? '+' : ''}${(ml.pred * 100).toFixed(1)}% over the next week`]);
  if (score != null)
    votes.push([Math.max(-1, Math.min(1, score / 0.6)), 0.70, `Advisor factor score ${score >= 0 ? '+' : ''}${score.toFixed(2)}`]);
  if (peer)
    votes.push([peer.z, 0.60, peer.why]);
  if (alt) {
    const parts = [];
    if (alt.bullRatio != null) parts.push((alt.bullRatio - 0.5) * 2);
    if (alt.toneTrend != null) parts.push(Math.max(-1, Math.min(1, alt.toneTrend)));
    if (parts.length) {
      const bits = [];
      if (alt.bullRatio != null) bits.push(`${Math.round(alt.bullRatio * 100)}% of social chatter bullish`);
      if (alt.toneTrend != null) bits.push(alt.toneTrend > 0.05 ? 'news tone improving' : alt.toneTrend < -0.05 ? 'news tone worsening' : 'news tone flat');
      if (alt.newsSpike != null && alt.newsSpike > 0.6) bits.push('news coverage spiking');
      votes.push([Math.max(-1, Math.min(1, Q.mean(parts))), 0.50, 'Sentiment: ' + bits.join(', ')]);
    }
  }
  if (seas)
    votes.push([seas.z, 0.35, seas.why]);
  if (!votes.length) return null;
  const axes = votes.map(v => v[0]);
  const wsum = votes.reduce((s, v) => s + v[1], 0);
  const conviction = votes.reduce((s, v) => s + v[0] * v[1], 0) / wsum;   // weighted mean stays in [-1, 1]
  const why = votes.map(v => v[2]);
  // how many engines actually agree with the net call, for an honest "5 of 6 engines agree" line
  const agree = axes.filter(a => a !== 0 && Math.sign(a) === Math.sign(conviction)).length;
  return { sym, dec, score, alt, ml, peer, seas, conviction, agree, nEngines: votes.length, why };
};

/* Compare the live book to a saved target and produce concrete, dated orders, then rank the best
   moves by fusing all six per-name engines (Decision, ML forecast, Advisor, peer valuation,
   Sentiment, seasonality) plus the regime model and a concentration check. It surfaces where the
   most engines agree; it does not promise profit. */
UI.dailyBriefing = function (target) {
  const f = AL.fmt;
  const book = AL.store.get('holdings', UI.DEMO_BOOK);
  const cash = AL.store.get('cash', null);
  // value the current book at the freshest price we have (live tick when available, else last close)
  const rows = book.map(h => { const s = AL.getSeries(h.sym); if (!s) return null; const px = AL.livePx(h.sym); return { sym: h.sym, name: s.name, mv: h.qty * px, price: px }; }).filter(Boolean);
  const bookMV = Q.sum(rows.map(r => r.mv));
  const capital = target.capital || (bookMV + (cash || 0)) || 100000;
  const curW = {}; rows.forEach(r => curW[r.sym] = r.mv / (capital || 1));
  const tgtW = {}; target.holdings.forEach(h => tgtW[h.sym] = h.dollars / (capital || 1));
  const syms = Array.from(new Set([...Object.keys(curW), ...Object.keys(tgtW)]));
  // only surface a trade when the drift is material: over-trading bleeds edge in a contest
  const minDollar = Math.max(capital * 0.02, 500);

  // score the whole universe once (session-cached), then memoize the per-name fusion so a symbol
  // that is both an order and a holding is only run through the engines a single time
  let scored = null; try { scored = UI.scoreStocks(); } catch (e) { }
  const sigCache = {};
  const sig = sym => (sym in sigCache) ? sigCache[sym] : (sigCache[sym] = UI.symConviction(sym, scored));

  // 1. drift-driven rebalance orders, now annotated with each name's fused signal
  const orders = [];
  syms.forEach(sym => {
    const ser = AL.getSeries(sym); if (!ser) return;
    const price = AL.livePx(sym);   // price the order at the current market, not yesterday's close
    const drift = (tgtW[sym] || 0) - (curW[sym] || 0);
    const dollars = drift * capital;
    if (Math.abs(dollars) < minDollar) return;
    const shares = ser.cls === 'Crypto' ? Math.round(dollars / price * 1e4) / 1e4 : Math.round(dollars / price);
    if (!shares) return;
    const th = target.holdings.find(h => h.sym === sym);
    const s = sig(sym);
    // a signal on every order line: fundamental decision call where covered, else the price-trend read
    const ic = (s && s.dec && s.dec.coverage > 0 && ser.cls === 'Equity') ? { call: s.dec.call, kind: 'fundamental' } : UI.instrumentCall(sym);
    orders.push({ sym, side: dollars > 0 ? 'BUY' : 'SELL', shares: Math.abs(shares), dollars: Math.abs(dollars), price,
      role: th ? th.role : 'not in target, exit', name: ser.name,
      call: ic.call, callKind: ic.kind, conviction: s ? s.conviction : null });
  });
  orders.sort((a, b) => b.dollars - a.dollars);
  const maxDrift = syms.reduce((m, s2) => Math.max(m, Math.abs((tgtW[s2] || 0) - (curW[s2] || 0))), 0);

  // 2. PROTECT: holdings the engines have turned against. This leads the briefing because not
  // losing money is worth as much as making it, and these are the highest-conviction defensive
  // moves. Fires only on names an engine actually covers, so index/bond sleeves never flag here.
  const protect = [];
  rows.forEach(r => {
    const s = sig(r.sym); if (!s) return;
    const isSell = s.dec && s.dec.call === 'SELL';
    if (isSell || s.conviction < -0.30) {
      protect.push({ sym: r.sym, name: r.name, weight: r.mv / (bookMV || 1), mv: r.mv,
        conviction: s.conviction, agree: s.agree, nEngines: s.nEngines, why: s.why,
        action: isSell ? 'SELL' : 'TRIM' });
    }
  });
  protect.sort((a, b) => a.conviction - b.conviction);   // most negative (strongest sell) first

  // 3. OPPORTUNITIES: strong-conviction names you do not own yet, where several engines agree.
  // Scan the advisor's best large-caps, then keep only those the fusion also rates highly and the
  // decision engine does not reject. Ranked by conviction so the top ideas surface first.
  const opportunities = [];
  if (scored) {
    scored.rows.filter(r => UI.isLargeCap(r) && r.score > 0.35 && !curW[r.sym]).slice(0, 12).forEach(r => {
      const s = sig(r.sym);
      if (s && s.conviction > 0.30 && !(s.dec && s.dec.call === 'SELL')) {
        opportunities.push({ sym: r.sym, name: r.name, sector: r.sector,
          conviction: s.conviction, agree: s.agree, nEngines: s.nEngines, why: s.why });
      }
    });
    opportunities.sort((a, b) => b.conviction - a.conviction);
  }
  const topOpportunities = opportunities.slice(0, 4);

  // 4. concentration risk: any single position that has grown past a quarter of the live book.
  // The core index ETF can legitimately sit near 20%, so 25% is the honest "too big to ignore" line.
  const risks = [];
  rows.forEach(r => { const w = r.mv / (bookMV || 1); if (w > 0.25) risks.push({ sym: r.sym, name: r.name, weight: w }); });
  risks.sort((a, b) => b.weight - a.weight);

  const regimeNow = Q.marketRegime();
  return { orders, maxDrift, capital, bookMV, cash, regimeNow, regimeChanged: regimeNow.label !== target.regimeLabel,
    protect, opportunities: topOpportunities, risks, onTarget: maxDrift < 0.03 };
};

/* =========================================================
   MODULE: Command Center
   ========================================================= */
UI.def('command', 'Competition Center', '◎', 'Start Here', function (el, state, tab) {
  const f = AL.fmt;
  const saved = AL.store.get('command_cfg', { capital: 100000, profile: 'balanced' });
  const cashMode = AL.store.get('cash', null);
  const liveBook = AL.store.get('holdings', UI.DEMO_BOOK);
  // in competition mode the capital IS the live book value, so the plan sizes to real cash
  let liveValue = null;
  if (cashMode != null) {
    const mv = Q.sum(liveBook.map(h => { const s = AL.getSeries(h.sym); return s ? h.qty * AL.livePx(h.sym) : 0; }));
    liveValue = mv + cashMode;
  }
  const capital = state.capital != null ? state.capital : (liveValue != null ? liveValue : saved.capital);
  const profile = state.profile || saved.profile;

  el.innerHTML = `
    <div class="section-title">Competition Command Center
      <span class="badge dim">real data as-of ${AL.asof}</span>
      ${cashMode != null ? '<span class="badge info">COMPETITION MODE</span>' : ''}
    </div>
    <div class="info-box" style="margin-bottom:12px">Set your starting amount, pick a risk level, and Competition Center builds a full <b>multi-asset battle plan</b>: US and international stocks, bonds, commodities, gold, real estate and crypto, with the exact number of shares to buy. Then the <b>daily briefing</b> tells you what to trade to stay on plan. Everything is computed from real prices and the same engines as the rest of AlphaLab. It never trades for you.</div>
    <details class="playbook" style="margin-bottom:12px">
      <summary>How to run your competition month, step by step</summary>
      <ol style="margin:8px 0 0;padding-left:18px;line-height:1.85">
        <li><b>Day one, set up.</b> Enter your starting capital and pick a risk level above, press Build my plan, review the target portfolio, then press Start competition book and build. Place those exact trades in your real contest account and open My Holdings to track them.</li>
        <li><b>Every trading day, about five minutes.</b> Come back here, switch to Daily briefing, read the action plan, place any orders it lists, and check whether the regime banner says it changed.</li>
        <li><b>Once a week, twenty to thirty minutes.</b> Press Build my plan again so the tilt matches the latest regime, then check Stock Advisor and Buy / Sell Decision on your names, skim Sentiment and News for your holdings, and open Risk Lab so no single position gets too large.</li>
        <li><b>Before you present.</b> Open Reports and Write the strategy report to document your process, and use Peer Comparison plus the Decision engine bull and bear cases to defend every pick to the judges.</li>
        <li><b>Rules first.</b> Check your contest rules for which assets are allowed. If it is US stocks only, skip the crypto, international and commodity ETFs and lean the plan toward the single stocks and bonds.</li>
      </ol>
    </details>
    <div class="controls" style="margin-bottom:6px">
      <label class="lbl">starting capital</label>
      <input class="inp" id="cc-cap" type="number" min="1000" step="1000" value="${Math.round(capital)}" title="${cashMode != null ? 'defaults to your live book value, but you can change it to re-plan for any amount' : 'your starting amount'}" style="width:130px">
      <label class="lbl">risk level</label>
      ${Object.entries(UI.RISK_PROFILES).map(([k, p]) => `<span class="chip ${k === profile ? 'on' : ''}" data-prof="${k}" title="${f.esc(p.blurb)}">${p.label}</span>`).join('')}
      <button class="btn primary" id="cc-build">Build my plan</button>
      ${cashMode != null ? '<span class="note">defaults to your live book value; change it to re-plan for a different amount</span>' : ''}
    </div>
    <div class="controls" style="margin-bottom:12px">
      <span class="chip ${state.view !== 'daily' ? 'on' : ''}" data-view="plan">Target plan</span>
      <span class="chip ${state.view === 'daily' ? 'on' : ''}" data-view="daily">Daily briefing</span>
      <span class="note" id="cc-sub"></span>
    </div>
    <div id="cc-body"></div>`;

  // (re)build the target from whatever the controls currently say, then show the plan. Shared by
  // the risk chips and the Build button so both give instant, obvious feedback: earlier the chips
  // only flipped a variable and left the highlight and the plan unchanged, which read as "broken".
  function buildFromControls() {
    const cap = Math.max(1000, parseFloat(document.getElementById('cc-cap').value) || 100000);
    const prof = state.profile || profile;
    state.capital = cap;
    const t = UI.buildAllocation(cap, prof, 5);
    AL.store.set('command_target', t);
    AL.store.set('command_cfg', { capital: cap, profile: prof });
    state.view = 'plan';
    el.querySelectorAll('.chip[data-view]').forEach(x => x.classList.toggle('on', x.dataset.view === 'plan'));
    render();
  }
  el.querySelectorAll('.chip[data-prof]').forEach(c => c.addEventListener('click', () => {
    state.profile = c.dataset.prof;
    el.querySelectorAll('.chip[data-prof]').forEach(x => x.classList.toggle('on', x.dataset.prof === state.profile));  // move the highlight now
    buildFromControls();   // and re-plan immediately so the new risk level is visible at once
  }));
  el.querySelectorAll('.chip[data-view]').forEach(c => c.addEventListener('click', () => { state.view = c.dataset.view; el.querySelectorAll('.chip[data-view]').forEach(x => x.classList.toggle('on', x.dataset.view === state.view)); render(); }));
  document.getElementById('cc-build').addEventListener('click', buildFromControls);
  // typing a new amount and pressing Enter (or leaving the field) re-plans too
  document.getElementById('cc-cap').addEventListener('keydown', e => { if (e.key === 'Enter') buildFromControls(); });

  function render() {
    const body = document.getElementById('cc-body');
    const sub = document.getElementById('cc-sub');
    let target = AL.store.get('command_target', null);
    // first visit: auto-build a plan so there is never an empty screen
    if (!target) { target = UI.buildAllocation(capital, profile, 5); AL.store.set('command_target', target); }
    if ((state.view || 'plan') === 'daily') { sub.textContent = 'what to trade today to reach your plan'; renderDaily(body, target); }
    else { sub.textContent = `built ${target.ts} · regime at build: ${target.regimeLabel}`; renderPlan(body, target); }
  }

  function renderPlan(body, t) {
    const bucketRows = Object.entries(t.buckets).filter(([, w]) => w > 0.001).map(([k, w]) => ({ label: k, value: w }));
    const rp = t.profile;
    body.innerHTML = `
      <div class="tiles" style="margin-bottom:12px">
        <div class="tile"><div class="t-label">Regime now</div><div class="t-value ${t.regime.tone === 'good' ? 'up' : t.regime.tone === 'bad' ? 'dn' : ''}" style="font-size:15px">${t.regime.label}</div><div class="t-delta note">VIX ${f.n(t.regime.vix, 1)} · ${rp.label}</div></div>
        <div class="tile"><div class="t-label">Capital deployed</div><div class="t-value">${f.usd(t.capital - t.cashDollars)}</div><div class="t-delta note">${f.pct(1 - t.cashPct, 0)} invested</div></div>
        <div class="tile"><div class="t-label">Cash held</div><div class="t-value">${f.usd(t.cashDollars)}</div><div class="t-delta note">${f.pct(t.cashPct, 0)} dry powder</div></div>
        <div class="tile"><div class="t-label">Positions</div><div class="t-value">${t.holdings.filter(h => h.shares > 0).length}</div></div>
        <div class="tile"><div class="t-label">Est. annual volatility</div><div class="t-value">${t.expVol != null ? f.pct(t.expVol, 0) : '-'}</div><div class="t-delta note">target ~${f.pct(rp.vt, 0)}</div></div>
        ${t.mc ? `<div class="tile"><div class="t-label">1y vs cash (2k sims)</div><div class="t-value ${t.mc.median >= 0 ? 'up' : 'dn'}">${f.spct(t.mc.median)}</div><div class="t-delta note">worst 5%: ${f.spct(t.mc.p05)} · P(loss) ${f.pct(t.mc.pLoss, 0)}</div></div>` : ''}
      </div>
      <div class="note" style="margin-bottom:12px">Why this mix: ${t.tilt.join('; ')}.</div>
      <div class="grid g23">
        <div style="min-width:0">${UI.panel('Your target portfolio', `<table class="tbl"><thead><tr><th>Ticker</th><th>What it is</th><th>Bucket</th><th class="r">Target %</th><th class="r">$ Amount</th><th class="r">Buy</th><th class="r">Price</th><th class="r">Call</th></tr></thead><tbody>` +
          t.holdings.filter(h => h.shares > 0).map(h => `<tr>
            <td class="sym">${h.sym}</td><td class="t">${f.esc(h.role)}</td><td class="t" style="font-size:10px;color:var(--muted)">${h.bucket}</td>
            <td class="r">${f.pct(h.dollars / t.capital, 1)}</td><td class="r">${f.usd(h.dollars)}</td>
            <td class="r"><b>${h.cls === 'Crypto' ? h.shares : h.shares + ' sh'}</b></td><td class="r">${f.px(h.price)}</td>
            <td class="r">${UI.callBadge(h.call, h.callKind)}</td></tr>`).join('') +
          `<tr style="border-top:2px solid var(--line)"><td class="sym">CASH</td><td class="t">uninvested, held as dry powder</td><td></td><td class="r">${f.pct(t.cashPct, 1)}</td><td class="r">${f.usd(t.cashDollars)}</td><td class="r">-</td><td class="r">-</td><td class="r">-</td></tr>` +
          '</tbody></table><div class="note" style="padding:8px 12px 2px">Call = the Buy / Sell / Hold Decision engine verdict for single stocks. Funds, bonds, gold and crypto instead show a price-trend read (Uptrend / Downtrend / Flat), since they have no company fundamentals to score.</div>', { nopad: true })}</div>
        <div style="display:flex;flex-direction:column;gap:12px;min-width:0">
          ${UI.panel('Asset-class mix', '<div class="chart" style="height:190px" id="cc-buckets"></div>')}
          ${UI.panel('Put this plan to work', `
            <div class="note" style="margin-bottom:8px">One click sizes every position to real share counts at ${AL.asof} closes${cashMode != null ? ' and books it against your competition cash' : ''}.</div>
            <button class="btn primary" id="cc-apply" style="width:100%;margin-bottom:6px">${cashMode != null ? 'Build this in my competition book' : 'Start $' + f.n(t.capital / 1000, 0) + 'K competition book & build'}</button>
            <button class="btn" id="cc-report" style="width:100%">Write the strategy report</button>`)}
        </div>
      </div>
      <div class="warn-box" style="margin-top:12px">This is research on real historical data, not a guarantee or personalized financial advice. No tool can guarantee a competition win. The 1-year projection block-bootstraps real return history but is deliberately centered on the risk-free rate, not the past decade's unusually strong returns, so it shows this book's risk above cash rather than a promised gain, and a real chance of loss. AlphaLab never places trades, you do, and you can change any position. Verify contest rules before trading (some cap asset types, shorting or leverage).</div>`;
    C.bars(document.getElementById('cc-buckets'), bucketRows, { horizontal: true, pct: true, sorted: true });
    document.getElementById('cc-apply').addEventListener('click', () => applyPlan(t));
    document.getElementById('cc-report').addEventListener('click', () => writeReport(t));
  }

  function renderDaily(body, t) {
    const b = UI.dailyBriefing(t);
    const dateline = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    // strength label from |conviction|; the number is the average across the engines that voted
    const convLevel = c => { const a = Math.abs(c || 0); return a >= 0.55 ? 'High' : a >= 0.32 ? 'Medium' : 'Low'; };
    const agreeLine = m => `${m.agree} of ${m.nEngines} engine${m.nEngines > 1 ? 's' : ''} agree`;
    // one reasoned row in the "best moves" feed
    const moveRow = (m, badgeClass, actionText) => `
      <div style="display:flex;gap:10px;align-items:flex-start;padding:9px 0;border-top:1px solid var(--line)">
        <span class="badge ${badgeClass}" style="margin-top:1px;min-width:52px;text-align:center">${actionText}</span>
        <div style="min-width:0;flex:1">
          <div><span class="sym">${m.sym}</span> <span class="note">${f.esc(m.name || '')}</span></div>
          <div class="note" style="margin-top:2px;line-height:1.6">${m.why.join(' &middot; ')}</div>
        </div>
        <div style="text-align:right;white-space:nowrap"><span class="chip ${m.conviction >= 0 ? 'on' : ''}">${convLevel(m.conviction)} conviction</span><div class="note" style="margin-top:2px">${agreeLine(m)}</div></div>
      </div>`;

    // ranked best-moves feed: defend first (SELL/TRIM), then the strongest new ideas (BUY)
    const bestRows = b.protect.map(m => moveRow(m, m.action === 'SELL' ? 'bad' : 'warn', m.action))
      .concat(b.opportunities.map(m => moveRow(m, 'ok', 'BUY')));
    const bestPanel = UI.panel('Best moves today, where the most engines agree',
      bestRows.length
        ? `<div class="note" style="margin-bottom:2px">Each move fuses six engines on a shared scale: the Buy / Sell Decision engine, the ML forward-return model, the Stock Advisor factor score, a peer-relative valuation check, the Sentiment desk and a calendar-seasonality tilt, weighted by how much signal each carries. Higher conviction means more of them point the same way. Conviction is not certainty, so open the Decision engine on any name before you act.</div>${bestRows.join('')}`
        : '<div class="empty">No single-name signal is strong enough to flag today. Follow the rebalance orders below to stay on plan and check back tomorrow.</div>');

    // narrative action plan that stitches the synthesis together
    const plan = [];
    if (b.regimeChanged) plan.push(`Regime shifted to <b>${b.regimeNow.label}</b> since you built this plan (was ${t.regimeLabel}). Rebuild the plan to re-tilt your buckets.`);
    if (b.protect.length) plan.push(`Protect capital first: ${b.protect.map(p => `<b>${p.sym}</b> (${p.action.toLowerCase()})`).join(', ')}. The engines have turned against ${b.protect.length > 1 ? 'these' : 'this'}.`);
    if (b.onTarget && !b.orders.length) plan.push('Your book is on target. Hold, no rebalancing trades needed today.');
    else if (b.orders.length) plan.push(`Place the ${b.orders.length} rebalance order${b.orders.length > 1 ? 's' : ''} below to steer toward your plan (drift at the extreme is ${f.pct(b.maxDrift, 1)}).`);
    if (b.opportunities.length) plan.push(`Highest-conviction ideas not in your book: ${b.opportunities.map(a => `<b>${a.sym}</b>`).join(', ')}. Confirm each in the Decision engine before adding.`);
    if (b.risks.length) plan.push(`Concentration watch: ${b.risks.map(r => `<b>${r.sym}</b> is ${f.pct(r.weight, 0)} of the book`).join('; ')}. A single position this large drives most of your risk, consider trimming it into the plan.`);
    plan.push('Re-open this briefing each trading day; it recomputes on live prices during market hours, the latest close otherwise, and after every data refresh.');

    body.innerHTML = `
      <div class="tiles" style="margin-bottom:12px">
        <div class="tile"><div class="t-label">Today</div><div class="t-value" style="font-size:14px">${dateline}</div><div class="t-delta note">close of ${AL.asof}</div></div>
        <div class="tile"><div class="t-label">Book value</div><div class="t-value">${f.usd(b.bookMV + (b.cash || 0))}</div><div class="t-delta note">${b.cash != null ? f.usd(b.cash) + ' cash' : 'tracking only'}</div></div>
        <div class="tile"><div class="t-label">Drift from plan</div><div class="t-value ${b.onTarget ? 'up' : 'dn'}">${f.pct(b.maxDrift, 1)}</div><div class="t-delta note">${b.onTarget ? 'on target' : 'rebalance'}</div></div>
        <div class="tile"><div class="t-label">Protect / add</div><div class="t-value">${b.protect.length} / ${b.opportunities.length}</div><div class="t-delta note">high-conviction moves</div></div>
        <div class="tile"><div class="t-label">Regime</div><div class="t-value" style="font-size:14px">${b.regimeNow.label}</div>${b.regimeChanged ? '<div class="t-delta dn">changed</div>' : ''}</div>
      </div>
      ${bestPanel}
      <div style="margin-top:12px">${UI.panel('Today\'s action plan', `<ol style="margin:0;padding-left:18px;line-height:1.9">${plan.map(p => `<li>${p}</li>`).join('')}</ol>`)}</div>
      <div style="margin-top:12px">${UI.panel(`Rebalance orders ${cashMode != null ? '<span class="badge dim">one click books them all</span>' : ''}`, b.orders.length ? `<table class="tbl"><thead><tr><th>Action</th><th>Ticker</th><th>What it is</th><th class="r">Shares</th><th class="r">~$</th><th class="r">Price</th><th class="r">Signal</th></tr></thead><tbody>` +
        b.orders.map(o => `<tr><td><span class="badge ${o.side === 'BUY' ? 'ok' : 'bad'}">${o.side}</span></td><td class="sym">${o.sym}</td><td class="t">${f.esc(o.role)}</td><td class="r"><b>${o.shares}</b></td><td class="r">${f.usd(o.dollars)}</td><td class="r">${f.px(o.price)}</td><td class="r">${UI.callBadge(o.call, o.callKind)}</td></tr>`).join('') +
        `</tbody></table>${cashMode != null ? '<button class="btn primary" id="cc-exec" style="margin-top:10px">Execute all orders in my book</button>' : '<div class="note" style="margin-top:8px">Turn on competition mode (My Holdings) to book these with one click.</div>'}` : '<div class="empty">No trades needed, your book matches the plan.</div>', { nopad: b.orders.length > 0 })}</div>
      <div class="warn-box" style="margin-top:12px">This briefing fuses every engine in AlphaLab, but conviction is not a promise. No tool can guarantee you gain the most money or win the contest. Orders compare your saved plan to your live book and nothing executes until you press the button. Research, not advice, and verify contest rules before trading.</div>`;
    const ex = document.getElementById('cc-exec');
    if (ex) ex.addEventListener('click', () => execOrders(b, t));
  }

  // apply the whole target: replace the book with the exact share counts, book the cash
  function applyPlan(t) {
    const start = cashMode != null ? 'This replaces your current competition holdings with the target portfolio and re-books your cash.'
      : `This starts competition mode with ${f.usd(t.capital)} of virtual cash and buys the target portfolio.`;
    if (!confirm(start + ' Continue?')) return;
    const book = t.holdings.filter(h => h.shares > 0).map(h => ({ sym: h.sym, qty: h.shares, costBasis: h.price }));
    AL.store.set('holdings', book);
    AL.store.set('cash', t.cashDollars);
    UI.toast ? UI.toast('Portfolio built. Open My Holdings to see it live.') : alert('Portfolio built. Open My Holdings to see it live.');
    render();
  }
  // execute just today's incremental orders against the live book
  function execOrders(b, t) {
    if (!confirm(`Book ${b.orders.length} order(s) against your competition cash?`)) return;
    const book = AL.store.get('holdings', []).map(h => ({ ...h }));
    let cash = AL.store.get('cash', 0);
    b.orders.forEach(o => {
      const sign = o.side === 'BUY' ? 1 : -1;
      const existing = book.find(h => h.sym === o.sym);
      const px = o.price;
      cash -= sign * o.shares * px;
      if (existing) {
        const newQty = existing.qty + sign * o.shares;
        if (newQty <= 1e-6) book.splice(book.indexOf(existing), 1);
        else { if (sign > 0) existing.costBasis = (existing.costBasis * existing.qty + o.shares * px) / newQty; existing.qty = newQty; }
      } else if (sign > 0) book.push({ sym: o.sym, qty: o.shares, costBasis: px });
    });
    AL.store.set('holdings', book); AL.store.set('cash', cash);
    alert('Orders booked. Open My Holdings to review.');
    render();
  }
  // hand the plan to the existing strategy-report writer
  function writeReport(t) {
    const rows = t.holdings.filter(h => h.shares > 0).map(h => ({ sym: h.sym, qty: h.shares, costBasis: h.price, name: h.name, cls: h.cls, mv: h.dollars, last: h.price, pnl: 0, pnlPct: 0 }));
    const totMV = Q.sum(rows.map(r => r.mv));
    const al = AL.align(rows.map(r => r.sym), 'ret');
    const wts = rows.map(r => r.mv / totMV);
    const prets = al.dates.map((_, i) => rows.reduce((s, r, j) => s + wts[j] * (al.cols[r.sym] ? al.cols[r.sym][i] : 0), 0));
    const spyM = new Map(AL.returns('SPY').dates.map((d, i) => [d, AL.returns('SPY').values[i]]));
    const beta = Q.linreg(al.dates.slice(-252).map(d => spyM.get(d) ?? 0), prets.slice(-252)).b;
    const rep = UI.buildPortfolioReport(rows, totMV, t.cashDollars, prets, al.dates.slice(-504), beta);
    rep.title = 'Competition Strategy Report';
    const reports = AL.store.get('reports', []); reports.push(rep); AL.store.set('reports', reports);
    UI.openTab('reportView', { idx: reports.length - 1, forceNew: true }, 'Strategy Report');
  }

  render();
});
