/* modules F: the Investment Firm Simulator. You run a fund through a hidden
   window of REAL market history: allocate capital across validated strategies
   and stocks, react to events that actually happened (masked so you cannot
   cheat), argue with three AI analysts, collect fees, survive redemptions.
   At the end the simulator reveals which era you just managed through. */
'use strict';
const FIRM = window.FIRM = {};

// strategies a fund can deploy as sleeves: fast, non-ML, all real-data
FIRM.DEPLOYABLE = ['S001', 'S004', 'S007', 'S013', 'S018', 'S019', 'S020', 'S025', 'S026', 'S031',
  'S035', 'S038', 'S041', 'S045', 'S052', 'S053', 'S055', 'S058', 'S068', 'S069', 'S078', 'S101', 'S102', 'S104', 'S105'];
FIRM.STOCKS = ['SPY', 'QQQ', 'IWM', 'EFA', 'EEM', 'TLT', 'IEF', 'LQD', 'HYG', 'GLD', 'SLV', 'USO', 'VNQ',
  'XLK', 'XLF', 'XLE', 'XLV', 'XLP', 'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'JPM', 'XOM', 'UNH', 'WMT', 'KO', 'CAT', 'BTC-USD'];

FIRM.state = () => AL.store.get('firm', null);
FIRM.save = f => AL.store.set('firm', f);
FIRM._runCache = new Map();

// date->daily return map for any sleeve, built once and cached
FIRM.retMap = function (sleeve) {
  const key = sleeve.kind + ':' + (sleeve.id || sleeve.sym);
  if (FIRM._runCache.has(key)) return FIRM._runCache.get(key);
  let m = new Map();
  if (sleeve.kind === 'strategy') {
    const r = S.run(S.byId[sleeve.id]);
    r.dates.forEach((d, i) => m.set(d, r.rets[i]));
  } else if (sleeve.kind === 'stock') {
    const r = AL.returns(sleeve.sym);
    r.dates.forEach((d, i) => m.set(d, r.values[i]));
  }
  FIRM._runCache.set(key, m);
  return m;
};

FIRM.newFund = function (name, aum) {
  // hidden 3y replay window: needs strategy warmup before it and 756 days inside
  const rand = AL.rng(Date.now() % 1e9);
  const lo = AL.cal.findIndex(d => d >= '2006-01-01');
  const hi = AL.cal.length - 760;
  const startIdx = lo + Math.floor(rand() * (hi - lo));
  const f = {
    name: name || 'Untitled Capital', created: AL.asof, startIdx, week: 0,
    aum: aum || 25e6, aum0: aum || 25e6, nav: 1, hwm: 1,
    sleeves: [{ kind: 'cash', w: 1 }],
    navHist: [{ week: 0, nav: 1, spy: 1 }],
    events: [], chat: [], feesEarned: 0, netFlows: 0, forcedDerisk: false, done: false,
  };
  FIRM.say(f, 'system', `${f.name} is live with ${AL.fmt.usd(f.aum)} in committed capital. The market window is a real 3-year stretch of history; you will learn which one at the end. Allocate capital and advance time.`);
  FIRM.say(f, 'Nadia (macro)', 'Before we deploy a dollar I want everyone reading the same tape: check the event feed after every advance. I care about rates, vol and credit, in that order.');
  FIRM.say(f, 'Marcus (quant)', 'The validated strategy sleeves are on the shelf. My prior: diversified sleeves beat hero stock picks over three years. Prove me wrong.');
  FIRM.say(f, 'Priya (risk)', 'House rules: I flag drawdowns past 10%, I get loud past 15%, and past 25% I will force us to de-risk. Investors redeem when we embarrass them.');
  FIRM.save(f);
  return f;
};

FIRM.say = (f, who, msg) => { f.chat.push({ week: f.week, who, msg }); if (f.chat.length > 250) f.chat.shift(); };

// window helpers: sim week w covers 5 real trading days
FIRM.weekDates = (f, w) => AL.cal.slice(f.startIdx + (w - 1) * 5, f.startIdx + w * 5);
FIRM.maskWeek = w => `Y${Math.floor((w - 1) / 52) + 1} W${String(((w - 1) % 52) + 1).padStart(2, '0')}`;

// macro series value on/before a real date (used by the event engine + analysts)
FIRM.macroAt = function (id, date) {
  const s = AL.getSeries(id);
  if (!s) return null;
  let lo = 0, hi = s.dates.length - 1, ans = null;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (s.dates[mid] <= date) { ans = s.values[mid]; lo = mid + 1; } else hi = mid - 1; }
  return ans;
};

FIRM.advance = function (f, weeks) {
  const spyMap = FIRM.retMap({ kind: 'stock', sym: 'SPY' });
  for (let k = 0; k < weeks && !f.done; k++) {
    f.week++;
    const dates = FIRM.weekDates(f, f.week);
    if (dates.length < 5) { FIRM.finish(f); break; }
    // portfolio and benchmark compound through the week's real days
    let pr = 1, br = 1;
    for (const d of dates) {
      let r = 0;
      for (const sl of f.sleeves) {
        if (sl.kind === 'cash') r += sl.w * (0.03 / 252);        // cash earns ~3%
        else r += sl.w * (FIRM.retMap(sl).get(d) ?? 0);
      }
      pr *= 1 + r;
      br *= 1 + (spyMap.get(d) ?? 0);
    }
    // management fee accrues weekly (2%/yr), straight to firm revenue
    const mgmt = f.aum * 0.02 / 52;
    f.feesEarned += mgmt;
    f.nav *= pr * (1 - 0.02 / 52);
    f.aum *= pr * (1 - 0.02 / 52);
    const spyLast = f.navHist[f.navHist.length - 1].spy;
    f.navHist.push({ week: f.week, nav: f.nav, spy: spyLast * br });
    FIRM.events(f, dates, pr - 1, br - 1);
    // quarterly: performance fees, investor flows, analyst reviews
    if (f.week % 13 === 0) FIRM.quarter(f);
    // risk officer enforcement
    const dd = f.nav / Math.max(...f.navHist.map(h => h.nav)) - 1;
    if (dd < -0.25 && !f.forcedDerisk) {
      f.forcedDerisk = true;
      f.sleeves = f.sleeves.map(sl => ({ ...sl, w: sl.kind === 'cash' ? sl.w + 0.5 * (1 - sl.w) : sl.w * 0.5 }));
      FIRM.norm(f);
      FIRM.say(f, 'Priya (risk)', `Drawdown has breached 25%. I have cut every position by half and moved the proceeds to cash. This is not a debate; it is how we survive to trade next year.`);
    }
    if (f.week >= 156) { FIRM.finish(f); break; }
  }
  FIRM.save(f);
};

FIRM.norm = function (f) {
  // weights always sum to 1 with cash absorbing the remainder
  let cash = f.sleeves.find(s => s.kind === 'cash');
  if (!cash) { cash = { kind: 'cash', w: 0 }; f.sleeves.push(cash); }
  const inv = Q.sum(f.sleeves.filter(s => s.kind !== 'cash').map(s => Math.max(s.w, 0)));
  f.sleeves.forEach(s => { if (s.kind !== 'cash') s.w = Math.max(s.w, 0); });
  cash.w = Math.max(1 - inv, -0.5);      // mild leverage allowed, priya will complain
};

// event engine: everything derived from what actually happened inside the window
FIRM.events = function (f, dates, pRet, bRet) {
  const push = (kind, msg) => { f.events.push({ week: f.week, kind, msg }); if (f.events.length > 120) f.events.shift(); };
  const last = dates[dates.length - 1];
  if (bRet < -0.05) push('bad', `Markets rout: the index dropped ${AL.fmt.pct(-bRet, 1)} this week. Desks are cutting risk.`);
  else if (bRet > 0.045) push('good', `Powerful rally: the index gained ${AL.fmt.pct(bRet, 1)} this week.`);
  const vix = FIRM.macroAt('^VIX', last), vixPrev = FIRM.macroAt('^VIX', dates[0]);
  if (vix > 35 && vixPrev <= 35) push('bad', `Fear gauge spikes above ${Math.round(vix)}: option markets are pricing panic.`);
  const curve = FIRM.macroAt('T10Y2Y', last), curvePrev = FIRM.macroAt('T10Y2Y', dates[0]);
  if (curve != null && curvePrev != null && curve < 0 && curvePrev >= 0) push('warn', 'The yield curve just inverted. Historically a recession warning with a long fuse.');
  if (curve != null && curvePrev != null && curve > 0 && curvePrev <= 0) push('good', 'The yield curve un-inverted, steepening back to positive.');
  const ff = FIRM.macroAt('FEDFUNDS', last), ffPrev = FIRM.macroAt('FEDFUNDS', AL.cal[Math.max(f.startIdx + (f.week - 5) * 5, 0)]);
  if (ff != null && ffPrev != null) {
    if (ff - ffPrev >= 0.25) push('warn', `Central bank tightening: policy rate up ${AL.fmt.n(ff - ffPrev, 2)}pp over the last month.`);
    if (ff - ffPrev <= -0.25) push('good', `Central bank easing: policy rate cut ${AL.fmt.n(ffPrev - ff, 2)}pp over the last month.`);
  }
  if (f.week % 4 === 0) {
    const cpi = FIRM.macroAt('CPIAUCSL', last), cpiOld = FIRM.macroAt('CPIAUCSL', AL.cal[Math.max(f.startIdx + f.week * 5 - 260, 0)]);
    if (cpi && cpiOld) {
      const yoy = cpi / cpiOld - 1;
      push(yoy > 0.045 ? 'warn' : 'info', `Inflation print: consumer prices running ${AL.fmt.pct(yoy, 1)} year over year.`);
    }
  }
  // single-name shocks among the megacaps, like earnings surprises
  for (const sym of ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'META']) {
    const m = FIRM.retMap({ kind: 'stock', sym });
    for (const d of dates) {
      const r = m.get(d);
      if (r != null && Math.abs(r) > 0.08) {
        push(r > 0 ? 'good' : 'bad', `${sym} moved ${AL.fmt.spct(r)} in a single session on company news.`);
        break;
      }
    }
  }
};

FIRM.quarter = function (f) {
  // performance fee above high-water mark
  if (f.nav > f.hwm) {
    const perf = (f.nav - f.hwm) / f.hwm * f.aum * 0.20;
    f.feesEarned += perf;
    f.hwm = f.nav;
    FIRM.say(f, 'system', `Quarter closed above the high-water mark. Performance fees crystallized: ${AL.fmt.usd(perf)}.`);
  }
  // investor flows react to the trailing quarter vs the index
  const h = f.navHist;
  const q0 = h[Math.max(h.length - 14, 0)];
  const fundQ = f.nav / q0.nav - 1, spyQ = h[h.length - 1].spy / q0.spy - 1;
  let flow = 0;
  if (fundQ - spyQ > 0.02) flow = 0.08;
  else if (fundQ - spyQ < -0.04 || fundQ < -0.12) flow = -0.10;
  if (flow) {
    const amt = f.aum * flow;
    f.aum += amt; f.netFlows += amt;
    FIRM.say(f, 'system', flow > 0
      ? `Strong quarter (${AL.fmt.spct(fundQ)} vs index ${AL.fmt.spct(spyQ)}). New subscriptions: ${AL.fmt.usd(amt)}.`
      : `Weak quarter (${AL.fmt.spct(fundQ)} vs index ${AL.fmt.spct(spyQ)}). Redemptions: ${AL.fmt.usd(-amt)}.`);
  }
  FIRM.analystReview(f);
};

// the three analysts read real numbers and take genuinely different angles
FIRM.analystReview = function (f) {
  const last = FIRM.weekDates(f, f.week).slice(-1)[0];
  const vix = FIRM.macroAt('^VIX', last);
  const curve = FIRM.macroAt('T10Y2Y', last);
  const hy = FIRM.macroAt('BAMLH0A0HYM2', last);
  const fmt = AL.fmt;
  FIRM.say(f, 'Nadia (macro)', `Quarterly read: vol gauge at ${fmt.n(vix, 0)}, curve at ${fmt.n(curve, 2)}pp, junk spreads ${hy ? fmt.n(hy, 1) + 'pp' : 'n/a'}. ` +
    (vix > 28 || (hy && hy > 6) ? 'This is a stress tape. I want ballast: duration, gold, or plain cash.'
      : curve != null && curve < 0 ? 'Calm surface but the curve is inverted; late-cycle. I would not add beta here.'
        : 'Constructive backdrop. Carry and momentum sleeves should earn their keep.'));
  // marcus ranks sleeve performance over the trailing quarter
  const perf = f.sleeves.filter(s => s.kind !== 'cash').map(sl => {
    const m = FIRM.retMap(sl);
    let r = 1;
    for (let w = Math.max(f.week - 12, 1); w <= f.week; w++)
      for (const d of FIRM.weekDates(f, w)) r *= 1 + (m.get(d) ?? 0);
    return { sl, q: r - 1 };
  }).sort((a, b) => b.q - a.q);
  if (perf.length) {
    const best = perf[0], worst = perf[perf.length - 1];
    const nm = sl => sl.kind === 'strategy' ? S.byId[sl.id].name : sl.sym;
    FIRM.say(f, 'Marcus (quant)', `Sleeve scoreboard this quarter: best ${nm(best.sl)} at ${fmt.spct(best.q)}, worst ${nm(worst.sl)} at ${fmt.spct(worst.q)}. ` +
      (worst.q < -0.1 ? 'One quarter is noise; three is a signal. Put the laggard on watch, not on the block.' : 'Dispersion is healthy; the diversification is doing its job.'));
  } else {
    FIRM.say(f, 'Marcus (quant)', 'We are sitting in cash. Cash is a position, but it is not a strategy.');
  }
  const dd = f.nav / Math.max(...f.navHist.map(h2 => h2.nav)) - 1;
  const rets = f.navHist.slice(-26).map((h2, i, a) => i ? h2.nav / a[i - 1].nav - 1 : 0).slice(1);
  const var95 = rets.length > 10 ? Q.quantile(rets, 0.05) : null;
  FIRM.say(f, 'Priya (risk)', `Book check: drawdown ${fmt.pct(dd, 1)}, weekly VaR(95) ${var95 != null ? fmt.pct(var95, 1) : 'n/a'}, gross exposure ${fmt.pct(Q.sum(f.sleeves.filter(s => s.kind !== 'cash').map(s => Math.abs(s.w))), 0)}. ` +
    (dd < -0.15 ? 'We are past my comfort line. Cut something you love; that is how you know it is enough.'
      : dd < -0.08 ? 'Manageable, but stop adding risk until we make a new high.' : 'Within limits. Carry on.'));
};

// analysts vote on a proposed allocation before it goes live
FIRM.debate = function (f, proposed) {
  const nm = sl => sl.kind === 'cash' ? 'Cash' : sl.kind === 'strategy' ? S.byId[sl.id].name : sl.sym;
  const gross = Q.sum(proposed.filter(s => s.kind !== 'cash').map(s => Math.abs(s.w)));
  const maxW = Math.max(...proposed.filter(s => s.kind !== 'cash').map(s => s.w), 0);
  const nStrat = proposed.filter(s => s.kind === 'strategy').length;
  const nStock = proposed.filter(s => s.kind === 'stock').length;
  const last = FIRM.weekDates(f, Math.max(f.week, 1)).slice(-1)[0] || AL.cal[f.startIdx];
  const vix = FIRM.macroAt('^VIX', last);
  const out = [];
  out.push({
    who: 'Nadia (macro)',
    ok: !(vix > 30 && gross > 0.9),
    msg: vix > 30 && gross > 0.9 ? `Vol gauge is at ${Math.round(vix)} and you want ${AL.fmt.pct(gross, 0)} gross? In this tape I would hold 20-30% cash.`
      : gross < 0.4 ? 'Underinvested for my taste, but cash never blew anyone up. Approved.'
        : 'Sizing looks sane for the current macro backdrop. Approved.',
  });
  out.push({
    who: 'Marcus (quant)',
    ok: nStrat >= 1 || nStock <= 3,
    msg: nStrat === 0 && nStock > 3 ? 'All single names and zero systematic sleeves? That is stock-picking, not a fund. Add at least one validated strategy.'
      : nStrat >= 3 ? 'Good sleeve mix; check their pairwise correlation in the Ensemble Engine if you have not.' : 'Acceptable. I would still diversify the engine types: one trend, one carry, one defensive.',
  });
  out.push({
    who: 'Priya (risk)',
    ok: gross <= 1.2 && maxW <= 0.35,
    msg: gross > 1.2 ? `Gross exposure ${AL.fmt.pct(gross, 0)} means leverage. I veto anything past 120%.`
      : maxW > 0.35 ? `${AL.fmt.pct(maxW, 0)} in a single position is concentration risk. Keep any one line under 35%.`
        : 'Position sizes and gross exposure are inside the mandate. Approved.',
  });
  return out;
};

FIRM.finish = function (f) {
  f.done = true;
  const h = f.navHist;
  const weeks = h.length - 1;
  const rets = h.map((x, i, a) => i ? x.nav / a[i - 1].nav - 1 : 0).slice(1);
  const bench = h.map((x, i, a) => i ? x.spy / a[i - 1].spy - 1 : 0).slice(1);
  const p = Q.perf(rets, { ann: 52, bench });
  const dd = Math.min(...Q.drawdownSeries(h.map(x => x.nav)));
  const alpha = (f.nav - 1) - (h[h.length - 1].spy - 1);
  let score = 0;
  score += alpha > 0.1 ? 3 : alpha > 0 ? 2 : alpha > -0.1 ? 1 : 0;
  score += p && p.sharpe > 1 ? 3 : p && p.sharpe > 0.5 ? 2 : p && p.sharpe > 0 ? 1 : 0;
  score += dd > -0.15 ? 2 : dd > -0.25 ? 1 : 0;
  score += f.netFlows > 0 ? 1 : 0;
  f.grade = score >= 8 ? 'A' : score >= 6 ? 'B' : score >= 4 ? 'C' : score >= 2 ? 'D' : 'F';
  f.reveal = `${AL.cal[f.startIdx]} to ${AL.cal[Math.min(f.startIdx + f.week * 5, AL.cal.length - 1)]}`;
  FIRM.say(f, 'system', `Simulation complete. The window you just managed through was ${f.reveal}. Final grade: ${f.grade}. Fund ${AL.fmt.spct(f.nav - 1)} vs index ${AL.fmt.spct(h[h.length - 1].spy - 1)}; Sharpe ${p ? AL.fmt.n(p.sharpe) : 'n/a'}; max drawdown ${AL.fmt.pct(dd, 1)}; fees earned ${AL.fmt.usd(f.feesEarned)}; net investor flows ${AL.fmt.usd(f.netFlows)}.`);
  FIRM.save(f);
};

/* ---------- the desk UI ---------- */
UI.def('firm', 'Firm Simulator', '◈', 'Firm', function (el, state, tab) {
  const f = FIRM.state();
  const fmt = AL.fmt;
  if (!f) {
    el.innerHTML = `
      <div class="section-title">Investment Firm Simulator</div>
      <div class="info-box" style="margin-bottom:12px">Run your own fund through a hidden three-year window of REAL market history. Deploy validated strategies and stocks as sleeves, size them, and advance time week by week. Real crashes, rate cycles, inflation prints and single-stock shocks arrive exactly as they did in history (dates masked so you cannot look up the answers). Three AI analysts, a macro strategist, a quant, and a risk officer, read the same real data and argue with you. Collect management and performance fees, keep investors from redeeming, and find out at the end which era you survived.</div>
      <div class="panel" style="max-width:520px"><div class="panel-head">Found your firm</div><div class="panel-body">
        <div class="controls" style="margin-bottom:10px"><label class="lbl">fund name</label><input class="inp" id="fm-name" style="width:220px" placeholder="e.g. Blackwatch Capital"></div>
        <div class="controls" style="margin-bottom:10px"><label class="lbl">starting AUM</label><select class="inp" id="fm-aum"><option value="10000000">$10M (emerging)</option><option value="25000000" selected>$25M (established)</option><option value="100000000">$100M (institutional)</option></select></div>
        <button class="btn primary" id="fm-launch">Launch fund</button>
        <div class="note" style="margin-top:10px">Fee structure: 2% management, 20% performance above high-water mark. Risk mandate: max 120% gross, 35% per position; a 25% drawdown triggers forced de-risking.</div>
      </div></div>`;
    document.getElementById('fm-launch').addEventListener('click', () => {
      FIRM.newFund(document.getElementById('fm-name').value.trim(), +document.getElementById('fm-aum').value);
      UI.renderActive();
    });
    return;
  }
  tab.title = f.name.slice(0, 20);
  const dd = f.nav / Math.max(...f.navHist.map(h => h.nav)) - 1;
  const inv = f.sleeves.filter(s => s.kind !== 'cash');
  const cashW = (f.sleeves.find(s => s.kind === 'cash') || { w: 0 }).w;
  el.innerHTML = `
    <div class="section-title">${fmt.esc(f.name)}
      <span class="badge dim">${FIRM.maskWeek(Math.max(f.week, 1))} of Y3</span>
      ${f.done ? `<span class="badge ${f.grade === 'A' || f.grade === 'B' ? 'ok' : f.grade === 'C' ? 'warn' : 'bad'}">FINAL GRADE ${f.grade}</span><span class="badge info">window: ${f.reveal}</span>` : ''}
      <span style="flex:1"></span>
      ${f.done ? '' : `<button class="btn primary" id="fm-w1">Advance 1 week</button>
      <button class="btn" id="fm-w4">1 month</button>
      <button class="btn" id="fm-w13">1 quarter</button>`}
      <button class="btn danger small" id="fm-reset">Dissolve fund</button></div>
    <div class="tiles" style="margin-bottom:12px">
      <div class="tile"><div class="t-label">NAV (start = 1.000)</div><div class="t-value ${fmt.cls(f.nav - 1)}">${fmt.n(f.nav, 3)}</div><div class="t-delta ${fmt.cls(f.nav - 1)}">${fmt.spct(f.nav - 1)} since launch</div></div>
      <div class="tile"><div class="t-label">AUM</div><div class="t-value">${fmt.usd(f.aum)}</div><div class="t-delta note">net flows ${fmt.usd(f.netFlows)}</div></div>
      <div class="tile"><div class="t-label">Firm revenue (fees)</div><div class="t-value up">${fmt.usd(f.feesEarned)}</div><div class="t-delta note">2 and 20 structure</div></div>
      <div class="tile"><div class="t-label">Drawdown</div><div class="t-value ${dd < -0.15 ? 'dn' : ''}">${fmt.pct(dd, 1)}</div><div class="t-delta note">forced de-risk at -25%</div></div>
      <div class="tile"><div class="t-label">Gross / Cash</div><div class="t-value">${fmt.pct(Q.sum(inv.map(s => Math.abs(s.w))), 0)}</div><div class="t-delta note">cash ${fmt.pct(cashW, 0)}</div></div>
    </div>
    <div class="grid g23" style="margin-bottom:12px">
      ${UI.panel('Fund NAV vs index <span class="badge dim">dates masked until the end</span>', '<div class="chart h280" id="fm-nav"></div>', { nopad: true })}
      ${UI.panel('Event wire <span class="badge dim">real history, masked dates</span>', `<div class="feed" id="fm-events" style="max-height:280px;overflow-y:auto">${f.events.slice(-40).reverse().map(e => `<div class="fl ${e.kind}"><span class="ft">${FIRM.maskWeek(e.week)}</span><span class="fm">${fmt.esc(e.msg)}</span></div>`).join('') || '<div class="empty">Advance time to see the tape.</div>'}</div>`)}
    </div>
    <div class="grid g2">
      <div class="panel"><div class="panel-head">Capital allocation ${f.done ? '(final)' : '(edit weights, then propose)'}</div><div class="panel-body">
        <table class="tbl"><thead><tr><th>Sleeve</th><th>Type</th><th class="r">Weight %</th><th></th></tr></thead><tbody id="fm-sleeves">
          ${f.sleeves.map((sl, i) => `<tr><td class="t">${sl.kind === 'cash' ? 'Cash (3% yield)' : sl.kind === 'strategy' ? fmt.esc(S.byId[sl.id].name) : `<span class="sym">${sl.sym}</span> ${fmt.esc((AL.getSeries(sl.sym) || {}).name || '')}`}</td>
            <td class="t">${sl.kind}</td>
            <td class="r">${sl.kind === 'cash' ? fmt.pct(sl.w, 1) : `<input class="inp" style="width:64px" data-slw="${i}" value="${(sl.w * 100).toFixed(1)}" ${f.done ? 'disabled' : ''}>`}</td>
            <td class="r">${sl.kind === 'cash' || f.done ? '' : `<span class="x" data-sldel="${i}" style="cursor:pointer;color:var(--muted)">✕</span>`}</td></tr>`).join('')}
        </tbody></table>
        ${f.done ? '' : `<div class="controls" style="margin-top:10px">
          <select class="inp" id="fm-add-strat"><option value="">+ strategy sleeve…</option>${FIRM.DEPLOYABLE.filter(id => S.byId[id]).map(id => `<option value="${id}">${fmt.esc(S.byId[id].name)}</option>`).join('')}</select>
          <select class="inp" id="fm-add-stock"><option value="">+ stock/ETF…</option>${FIRM.STOCKS.map(s => `<option>${s}</option>`).join('')}</select>
          <button class="btn primary small" id="fm-propose">Propose to committee</button></div>
        <div id="fm-debate"></div>`}
      </div></div>
      ${UI.panel('Investment committee', `<div class="feed" id="fm-chat" style="max-height:420px;overflow-y:auto">${f.chat.slice(-60).map(c => `<div class="fl ${c.who.startsWith('Priya') ? 'warn' : c.who.startsWith('Nadia') ? 'hypo' : c.who === 'system' ? 'sys' : ''}"><span class="ft">${FIRM.maskWeek(Math.max(c.week, 1))}</span><span class="fm"><b>${fmt.esc(c.who)}:</b> ${fmt.esc(c.msg)}</span></div>`).join('')}</div>`)}
    </div>`;
  // nav chart with masked week axis
  const weeks = f.navHist.map(h => FIRM.maskWeek(Math.max(h.week, 1)));
  C.line(document.getElementById('fm-nav'), [
    { name: f.name.slice(0, 18), dates: weeks, values: f.navHist.map(h => h.nav), color: C.SERIES[0], width: 2 },
    { name: 'Index (SPY)', dates: weeks, values: f.navHist.map(h => h.spy), color: C.MUTED }]);
  const chat = document.getElementById('fm-chat');
  if (chat) chat.scrollTop = chat.scrollHeight;
  // controls
  const adv = w => { FIRM.advance(f, w); UI.renderActive(); };
  if (!f.done) {
    document.getElementById('fm-w1').addEventListener('click', () => adv(1));
    document.getElementById('fm-w4').addEventListener('click', () => adv(4));
    document.getElementById('fm-w13').addEventListener('click', () => adv(13));
    document.getElementById('fm-add-strat').addEventListener('change', e => {
      if (!e.target.value) return;
      f.sleeves.push({ kind: 'strategy', id: e.target.value, w: 0.1 });
      FIRM.norm(f); FIRM.save(f); UI.renderActive();
    });
    document.getElementById('fm-add-stock').addEventListener('change', e => {
      if (!e.target.value) return;
      f.sleeves.push({ kind: 'stock', sym: e.target.value, w: 0.1 });
      FIRM.norm(f); FIRM.save(f); UI.renderActive();
    });
    el.querySelectorAll('[data-sldel]').forEach(x => x.addEventListener('click', () => {
      f.sleeves.splice(+x.dataset.sldel, 1); FIRM.norm(f); FIRM.save(f); UI.renderActive();
    }));
    document.getElementById('fm-propose').addEventListener('click', () => {
      const proposed = f.sleeves.map((sl, i) => {
        const inp = el.querySelector(`[data-slw="${i}"]`);
        return { ...sl, w: inp ? (parseFloat(inp.value) || 0) / 100 : sl.w };
      });
      const votes = FIRM.debate(f, proposed);
      document.getElementById('fm-debate').innerHTML = votes.map(v =>
        `<div style="margin-top:8px"><span class="badge ${v.ok ? 'ok' : 'bad'}">${v.ok ? 'APPROVE' : 'OBJECT'}</span> <b style="font-size:12px">${fmt.esc(v.who)}</b><div class="note" style="margin-top:2px">${fmt.esc(v.msg)}</div></div>`).join('') +
        `<div style="margin-top:10px"><button class="btn primary small" id="fm-apply">Apply allocation${votes.some(v => !v.ok) ? ' (override objections)' : ''}</button></div>`;
      document.getElementById('fm-apply').addEventListener('click', () => {
        f.sleeves = proposed;
        FIRM.norm(f);
        if (votes.some(v => !v.ok)) FIRM.say(f, 'Priya (risk)', 'Noting for the record: the PM overrode committee objections. It is your name on the fund.');
        else FIRM.say(f, 'system', 'Allocation approved by the committee and applied.');
        FIRM.save(f); UI.renderActive();
      });
    });
  }
  document.getElementById('fm-reset').addEventListener('click', () => {
    if (confirm('Dissolve the fund and delete its history?')) { AL.store.del('firm'); FIRM._runCache.clear(); UI.renderActive(); }
  });
});
