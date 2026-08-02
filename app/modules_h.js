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

/* Build a full multi-asset target allocation. Pure-ish: reads the data layer + advisor but
   mutates nothing. Returns tickers, weights, dollars and share counts plus the reasoning. */
UI.buildAllocation = function (capital, profileKey, nStocks) {
  const f = AL.fmt;
  const regime = Q.marketRegime();
  const P = UI.RISK_PROFILES[profileKey] || UI.RISK_PROFILES.balanced;
  nStocks = nStocks || 5;
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
    if (h.cls === 'Equity') { try { h.call = UI.decision(h.sym).call; } catch (e) { h.call = null; } }
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

/* Top single-stock leaders for the equity sleeve: highest advisor score, one per sector,
   not rated SELL by the decision engine, large enough to be competition-defensible. */
UI.topStockPicks = function (n) {
  let scored;
  try { scored = UI.scoreStocks(); } catch (e) { return []; }
  if (!scored || !scored.rows) return [];
  const out = [], seenSector = {};
  for (const r of scored.rows) {
    if (out.length >= n) break;
    if (!UI.isLargeCap(r)) continue;          // real, liquid, competition-defensible names only
    if (r.score < 0.15) continue;             // must be a genuine buy candidate
    const sec = UI.canonSector(r.sector);
    if (sec && seenSector[sec]) continue;     // one per sector (synonym-folded)
    let call = null;
    try { call = UI.decision(r.sym).call; } catch (e) { }
    if (call === 'SELL') continue;            // never open a position the decision engine rejects
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

/* Compare the live book to a saved target and produce concrete, dated orders. */
UI.dailyBriefing = function (target) {
  const f = AL.fmt;
  const book = AL.store.get('holdings', UI.DEMO_BOOK);
  const cash = AL.store.get('cash', null);
  const rows = book.map(h => { const s = AL.getSeries(h.sym); return s ? { sym: h.sym, mv: h.qty * s.values[s.values.length - 1], price: s.values[s.values.length - 1] } : null; }).filter(Boolean);
  const bookMV = Q.sum(rows.map(r => r.mv));
  const capital = target.capital || (bookMV + (cash || 0)) || 100000;
  const curW = {}; rows.forEach(r => curW[r.sym] = r.mv / (capital || 1));
  const tgtW = {}; target.holdings.forEach(h => tgtW[h.sym] = h.dollars / (capital || 1));
  const syms = Array.from(new Set([...Object.keys(curW), ...Object.keys(tgtW)]));
  // only surface a trade when the drift is material: over-trading bleeds edge in a contest
  const minDollar = Math.max(capital * 0.02, 500);
  const orders = [];
  syms.forEach(sym => {
    const ser = AL.getSeries(sym); if (!ser) return;
    const price = ser.values[ser.values.length - 1];
    const drift = (tgtW[sym] || 0) - (curW[sym] || 0);
    const dollars = drift * capital;
    if (Math.abs(dollars) < minDollar) return;
    const shares = ser.cls === 'Crypto' ? Math.round(dollars / price * 1e4) / 1e4 : Math.round(dollars / price);
    if (!shares) return;
    const th = target.holdings.find(h => h.sym === sym);
    orders.push({ sym, side: dollars > 0 ? 'BUY' : 'SELL', shares: Math.abs(shares), dollars: Math.abs(dollars), price,
      role: th ? th.role : 'not in target — exit', name: ser.name });
  });
  orders.sort((a, b) => b.dollars - a.dollars);
  const maxDrift = syms.reduce((m, s) => Math.max(m, Math.abs((tgtW[s] || 0) - (curW[s] || 0))), 0);
  // watch list: holdings the advisor has soured on, and strong buys you do not yet own
  let scored = null; try { scored = UI.scoreStocks(); } catch (e) { }
  const trim = [], adders = [];
  if (scored) {
    rows.forEach(r => { const s = scored.bySym[r.sym]; if (s && s.score < -0.25) trim.push(s); });
    scored.rows.filter(r => UI.isLargeCap(r) && r.score > 0.4 && !curW[r.sym]).slice(0, 4).forEach(r => adders.push(r));
  }
  const regimeNow = Q.marketRegime();
  return { orders, maxDrift, capital, bookMV, cash, regimeNow, regimeChanged: regimeNow.label !== target.regimeLabel,
    trim, adders, onTarget: maxDrift < 0.03 };
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
    const mv = Q.sum(liveBook.map(h => { const s = AL.getSeries(h.sym); return s ? h.qty * s.values[s.values.length - 1] : 0; }));
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
    <div class="controls" style="margin-bottom:6px">
      <label class="lbl">starting capital</label>
      <input class="inp" id="cc-cap" type="number" min="1000" step="1000" value="${Math.round(capital)}" ${cashMode != null ? 'disabled title="using your live competition book value"' : ''} style="width:130px">
      <label class="lbl">risk level</label>
      ${Object.entries(UI.RISK_PROFILES).map(([k, p]) => `<span class="chip ${k === profile ? 'on' : ''}" data-prof="${k}">${p.label}</span>`).join('')}
      <button class="btn primary" id="cc-build">Build my plan</button>
    </div>
    <div class="controls" style="margin-bottom:12px">
      <span class="chip ${state.view !== 'daily' ? 'on' : ''}" data-view="plan">Target plan</span>
      <span class="chip ${state.view === 'daily' ? 'on' : ''}" data-view="daily">Daily briefing</span>
      <span class="note" id="cc-sub"></span>
    </div>
    <div id="cc-body"></div>`;

  el.querySelectorAll('.chip[data-prof]').forEach(c => c.addEventListener('click', () => { state.profile = c.dataset.prof; render(); }));
  el.querySelectorAll('.chip[data-view]').forEach(c => c.addEventListener('click', () => { state.view = c.dataset.view; el.querySelectorAll('.chip[data-view]').forEach(x => x.classList.toggle('on', x.dataset.view === state.view)); render(); }));
  document.getElementById('cc-build').addEventListener('click', () => {
    const cap = Math.max(1000, parseFloat(document.getElementById('cc-cap').value) || 100000);
    state.capital = cashMode != null ? capital : cap;
    const t = UI.buildAllocation(state.capital, state.profile || profile, 5);
    AL.store.set('command_target', t);
    AL.store.set('command_cfg', { capital: state.capital, profile: state.profile || profile });
    state.view = 'plan';
    el.querySelectorAll('.chip[data-view]').forEach(x => x.classList.toggle('on', x.dataset.view === 'plan'));
    render();
  });

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
            <td class="r">${h.call ? `<span class="badge ${h.call === 'BUY' ? 'ok' : h.call === 'SELL' ? 'bad' : 'warn'}">${h.call}</span>` : '<span class="note">-</span>'}</td></tr>`).join('') +
          `<tr style="border-top:2px solid var(--line)"><td class="sym">CASH</td><td class="t">uninvested, held as dry powder</td><td></td><td class="r">${f.pct(t.cashPct, 1)}</td><td class="r">${f.usd(t.cashDollars)}</td><td class="r">-</td><td class="r">-</td><td class="r">-</td></tr>` +
          '</tbody></table>', { nopad: true })}</div>
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
    const plan = [];
    if (b.regimeChanged) plan.push(`Regime shifted to <b>${b.regimeNow.label}</b> since you built this plan (was ${t.regimeLabel}). Rebuild the plan to re-tilt your buckets.`);
    if (b.onTarget && !b.orders.length) plan.push('Your book is on target. Hold, no trades needed today.');
    else if (b.orders.length) plan.push(`Place ${b.orders.length} order${b.orders.length > 1 ? 's' : ''} below to steer toward your plan (drift at the extreme is ${f.pct(b.maxDrift, 1)}).`);
    b.trim.forEach(s => plan.push(`Reconsider <b>${s.sym}</b>: the advisor score has fallen to ${f.n(s.score)}. Consider trimming or exiting.`));
    if (b.adders.length) plan.push(`Fresh strong-buy candidates not in your book: ${b.adders.map(a => a.sym).join(', ')}. Check them in the Decision engine before adding.`);
    plan.push('Re-open this briefing each trading day; it recomputes on the latest close and after every data refresh.');
    body.innerHTML = `
      <div class="tiles" style="margin-bottom:12px">
        <div class="tile"><div class="t-label">Today</div><div class="t-value" style="font-size:14px">${dateline}</div><div class="t-delta note">close of ${AL.asof}</div></div>
        <div class="tile"><div class="t-label">Book value</div><div class="t-value">${f.usd(b.bookMV + (b.cash || 0))}</div><div class="t-delta note">${b.cash != null ? f.usd(b.cash) + ' cash' : 'tracking only'}</div></div>
        <div class="tile"><div class="t-label">Drift from plan</div><div class="t-value ${b.onTarget ? 'up' : 'dn'}">${f.pct(b.maxDrift, 1)}</div><div class="t-delta note">${b.onTarget ? 'on target' : 'rebalance'}</div></div>
        <div class="tile"><div class="t-label">Orders today</div><div class="t-value">${b.orders.length}</div></div>
        <div class="tile"><div class="t-label">Regime</div><div class="t-value" style="font-size:14px">${b.regimeNow.label}</div>${b.regimeChanged ? '<div class="t-delta dn">changed</div>' : ''}</div>
      </div>
      ${UI.panel('Today\'s action plan', `<ol style="margin:0;padding-left:18px;line-height:1.9">${plan.map(p => `<li>${p}</li>`).join('')}</ol>`)}
      <div style="margin-top:12px">${UI.panel(`Orders to place ${cashMode != null ? '<span class="badge dim">one click books them all</span>' : ''}`, b.orders.length ? `<table class="tbl"><thead><tr><th>Action</th><th>Ticker</th><th>What it is</th><th class="r">Shares</th><th class="r">~$</th><th class="r">Price</th></tr></thead><tbody>` +
        b.orders.map(o => `<tr><td><span class="badge ${o.side === 'BUY' ? 'ok' : 'bad'}">${o.side}</span></td><td class="sym">${o.sym}</td><td class="t">${f.esc(o.role)}</td><td class="r"><b>${o.shares}</b></td><td class="r">${f.usd(o.dollars)}</td><td class="r">${f.px(o.price)}</td></tr>`).join('') +
        `</tbody></table>${cashMode != null ? '<button class="btn primary" id="cc-exec" style="margin-top:10px">Execute all orders in my book</button>' : '<div class="note" style="margin-top:8px">Turn on competition mode (My Holdings) to book these with one click.</div>'}` : '<div class="empty">No trades needed, your book matches the plan.</div>', { nopad: b.orders.length > 0 })}</div>
      <div class="warn-box" style="margin-top:12px">Orders are suggestions from your saved plan versus your live book. Nothing executes until you press the button. Research, not advice.</div>`;
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
