/* =========================================================
   STRATEGY REGISTRY, each entry is an independent research module.
   status 'ok' = runnable on bundled real data; 'data' = requires an external
   dataset the user must connect (module documents what and why).
   ========================================================= */
'use strict';
(function () {
const R = [];
let _sid = 0;
function reg(cat, name, def, desc, o = {}) {
  R.push({ id: 'S' + String(++_sid).padStart(3, '0'), cat, name, def, desc,
    bench: o.bench || (def && def.kind === 'single' ? def.sym : 'SPY'),
    cost: o.cost ?? 5, from: o.from, status: 'ok', tags: o.tags || [] });
}
function regData(cat, name, desc, needs) {
  R.push({ id: 'S' + String(++_sid).padStart(3, '0'), cat, name, def: null, desc,
    status: 'data', needs, tags: [] });
}
const single = (sym, engine, params, extra) => ({ kind: 'single', sym, engine, params, ...extra });
const pair = (a, b, engine, params) => ({ kind: 'pair', syms: [a, b], engine, params });
const xs = (universe, engine, params) => ({ kind: 'xs', universe, engine, params });

/* ---- Trend Following (12) ---- */
reg('Trend Following', 'Golden Cross, S&P 500', single('SPY', 'smaCross', { fast: 50, slow: 200 }),
  'Classic 50/200-day moving average crossover on SPY. Long when the 50d SMA is above the 200d SMA, flat otherwise. The canonical trend filter used by CTAs since the 1970s.');
reg('Trend Following', 'Fast Trend, Nasdaq 100', single('QQQ', 'smaCross', { fast: 20, slow: 100 }),
  'Faster 20/100 SMA crossover on QQQ, capturing intermediate tech trends at higher turnover.');
reg('Trend Following', 'EMA Ribbon, Small Caps', single('IWM', 'emaCross', { fast: 21, slow: 84 }),
  'Exponential 21/84 crossover on the Russell 2000, weighting recent prices more heavily.');
reg('Trend Following', 'Donchian Breakout, Gold', single('GLD', 'donchian', { n: 55 }),
  '55-day Donchian channel breakout on gold, the Turtle Traders entry rule applied to GLD.');
reg('Trend Following', 'Donchian Breakout, Crude Oil', single('CL=F', 'donchian', { n: 40, short: true }, { volTarget: 0.15 }),
  'Long/short 40-day channel breakout on front-month WTI futures with 15% vol targeting.', { bench: 'CL=F', cost: 8 });
reg('Trend Following', 'Managed Futures, Multi-Asset Trend', xs(['SPY', 'EFA', 'EEM', 'TLT', 'IEF', 'GLD', 'DBC', 'VNQ', 'HYG'], 'trendPortfolio', { sma: 126, reb: 21 }),
  'Inverse-vol weighted portfolio of every liquid asset trading above its 6-month average, a long-only replication of the managed-futures trend premium.', { cost: 4 });
reg('Trend Following', 'Bond Trend, 20Y Treasuries', single('TLT', 'smaCross', { fast: 30, slow: 150 }),
  'Duration timing: hold long-bond exposure only when TLT trends higher (30/150 SMA).');
reg('Trend Following', 'FX Trend, EUR/USD', single('EURUSD=X', 'smaCross', { fast: 25, slow: 125, short: true }),
  'Long/short trend on EUR/USD as a dollar-cycle trade (25/125 SMA, symmetric).', { bench: 'EURUSD=X', cost: 2 });
reg('Trend Following', 'Copper Trend, Global Growth', single('HG=F', 'emaCross', { fast: 20, slow: 90, short: true }, { volTarget: 0.15 }),
  'Dr. Copper as a global growth trade: symmetric EMA trend on copper futures, vol-targeted.', { bench: 'HG=F', cost: 8 });
reg('Trend Following', 'NatGas Momentum Rider', single('NG=F', 'donchian', { n: 30, short: true }, { volTarget: 0.12 }),
  'Channel breakout on natural gas, one of the trendiest and most volatile commodity markets. Tight vol target to survive 10%+ daily moves.', { bench: 'NG=F', cost: 10 });
reg('Trend Following', '52-Week High, Apple', single('AAPL', 'high52w', { tol: 0.02 }),
  'Hold AAPL while within 2% of its 52-week high; exit on 15% retracement. Exploits the anchoring bias documented by George & Hwang (2004).');
reg('Trend Following', 'Trend + VIX Filter, S&P 500', single('SPY', 'regimeFiltered', { sma: 200, vixMax: 28 }),
  'SPY above its 200d SMA AND VIX below 28. Combines price trend with the real options-implied fear gauge.');

/* ---- Momentum (12) ---- */
reg('Momentum', 'Time-Series Momentum 12-1, S&P', single('SPY', 'tsMom', { n: 252, skip: 21 }),
  'Moskowitz-Ooi-Pedersen time-series momentum: long if the trailing 12-month return (skipping the last month) is positive.');
reg('Momentum', 'TS Momentum, Gold', single('GLD', 'tsMom', { n: 189, skip: 21 }),
  '9-month time-series momentum on gold with 1-month skip.');
reg('Momentum', 'TS Momentum, EM Equities', single('EEM', 'tsMom', { n: 252, skip: 21 }),
  '12-1 momentum on emerging markets, where the momentum premium has historically been strongest.');
reg('Momentum', 'Cross-Sectional Momentum, Mega Caps', xs(['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'JPM', 'XOM', 'UNH', 'V', 'WMT', 'HD', 'PG', 'KO', 'CVX', 'CAT', 'DIS', 'NFLX'], 'momentum', { n: 189, skip: 21, topN: 5, reb: 21 }),
  'Jegadeesh-Titman relative momentum: each month, hold the 5 strongest mega-caps by 9-month return (1-month skip). Equal weighted.', { cost: 6 });
reg('Momentum', 'Momentum Long/Short, Mega Caps', xs(['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'JPM', 'XOM', 'UNH', 'V', 'WMT', 'HD', 'PG', 'KO', 'CVX', 'CAT', 'DIS', 'NFLX'], 'momentum', { n: 189, skip: 21, topN: 4, reb: 21, shortBottom: true }),
  'Market-neutral version: long top 4 / short bottom 4 by momentum. Isolates the momentum factor from market beta.', { cost: 8 });
reg('Momentum', 'Sector Rotation, Top 3', xs(['XLK', 'XLF', 'XLE', 'XLV', 'XLY', 'XLP', 'XLI', 'XLU', 'XLB'], 'momentum', { n: 126, skip: 5, topN: 3, reb: 21 }),
  'Each month, rotate into the 3 strongest S&P sectors by 6-month return. A staple of tactical asset allocation.', { cost: 4 });
reg('Momentum', 'Dual Momentum (GEM)', xs(['SPY', 'EFA', 'SHY'], 'dualMomentum', {}),
  "Antonacci's Global Equities Momentum: hold US or international equities (whichever is stronger) when either has positive 12-month momentum, else retreat to short-term Treasuries.", { cost: 3 });
reg('Momentum', 'Asset-Class Momentum, Top 3 of 8', xs(['SPY', 'EFA', 'EEM', 'TLT', 'GLD', 'DBC', 'VNQ', 'HYG'], 'momentum', { n: 126, skip: 21, topN: 3, reb: 21 }),
  'Rotate monthly into the 3 strongest of 8 major asset classes, equity, bonds, gold, commodities, real estate, credit.', { cost: 4 });
reg('Momentum', 'ETF Style Momentum, Growth/Value', pair('VUG', 'VTV', 'ratioRV', { n: 126, momentum: true }),
  'Long the winning style, short the loser, based on 6-month growth/value ratio momentum. Dollar-neutral style rotation.', { cost: 4 });
reg('Momentum', '52-Week High, Microsoft', single('MSFT', 'high52w', { tol: 0.03 }),
  '52-week-high anchoring effect on MSFT with a 3% proximity band.');
reg('Momentum', 'Momentum Factor ETF Overlay', pair('MTUM', 'SPY', 'ratioRV', { n: 126, momentum: true }),
  'Long MTUM / short SPY when the momentum factor itself is trending, momentum-of-momentum, dollar-neutral.', { from: '2014-06-01', cost: 4 });
reg('Momentum', 'Semis Momentum, Concentrated Tech', xs(['NVDA', 'AMD', 'INTC', 'MSFT', 'AAPL', 'GOOGL'], 'momentum', { n: 126, skip: 10, topN: 2, reb: 21 }),
  'Concentrated tech momentum: top 2 of 6 semiconductor/big-tech names by 6-month return.', { cost: 6 });

/* ---- Mean Reversion (10) ---- */
reg('Mean Reversion', 'Z-Score Reversion, S&P 500', single('SPY', 'meanRevZ', { n: 21, entry: 2, exit: 0.3 }),
  'Buy SPY when price falls 2σ below its 21-day mean, exit at the mean. Short-horizon equity index reversion.');
reg('Mean Reversion', 'RSI(2), S&P 500', single('SPY', 'rsiRev', { n: 2, lo: 10, hi: 90 }),
  "Larry Connors' RSI(2): buy extreme short-term oversold readings on the index, exit on strength. High hit-rate, small edges.", { cost: 3 });
reg('Mean Reversion', 'RSI(14) Swing, Nasdaq', single('QQQ', 'rsiRev', { n: 14, lo: 30, hi: 70 }),
  'Classic 14-day RSI swing entries on QQQ.');
reg('Mean Reversion', 'Bollinger Reversion, Dow', single('DIA', 'bollinger', { n: 20, k: 2 }),
  'Buy 2σ Bollinger band touches on DIA, exit at the middle band.');
reg('Mean Reversion', 'Weekly Reversal, Russell 2000', single('IWM', 'weeklyReversal', { n: 5, thr: 0.03 }),
  'Buy after a −3% week in small caps. Short-term reversal premium (Lehmann 1990).');
reg('Mean Reversion', 'Cross-Sectional Reversal, Sectors', xs(['XLK', 'XLF', 'XLE', 'XLV', 'XLY', 'XLP', 'XLI', 'XLU', 'XLB'], 'reversal', { n: 10, topN: 3, reb: 10 }),
  'Every two weeks, buy the 3 sectors most beaten-down over the prior 10 days.', { cost: 6 });
reg('Mean Reversion', 'VIX Spike Contrarian', single('SPY', 'vixSpike', { n: 63, k: 2 }),
  'Buy equities when VIX spikes 2σ above its 3-month norm, monetizing panic. Uses real CBOE VIX data.');
reg('Mean Reversion', 'Oil Overshoot Fade', single('USO', 'meanRevZ', { n: 42, entry: 2.2, exit: 0.4 }),
  'Fade 2σ+ dislocations in crude oil over a 2-month window.', { cost: 8 });
reg('Mean Reversion', 'Bond Reversion, TLT', single('TLT', 'bollinger', { n: 30, k: 2.2 }),
  'Buy panic selloffs in long Treasuries at 2.2σ Bollinger extremes.');
reg('Mean Reversion', 'Silver Stretch, SLV', single('SLV', 'meanRevZ', { n: 30, entry: 2.5, exit: 0.5 }),
  'Deep reversion entries on silver, one of the most mean-reverting precious metals at short horizons.', { cost: 7 });

/* ---- Statistical Arbitrage & Pairs (10) ---- */
reg('Stat Arb / Pairs', 'Pairs: Visa / Mastercard', pair('V', 'MA', 'pairsZ', { win: 126, entry: 2, exit: 0.5 }),
  'Duopoly pair with near-identical business models. Rolling-hedge log-spread z-score, ±2σ entries. Engle-Granger diagnostics computed live.', { from: '2009-01-01', cost: 6 });
reg('Stat Arb / Pairs', 'Pairs: JPMorgan / Bank of America', pair('JPM', 'BAC', 'pairsZ', { win: 126, entry: 2, exit: 0.5 }),
  'Money-center bank pair trading on rolling cointegration spread.', { cost: 6 });
reg('Stat Arb / Pairs', 'Pairs: Exxon / Chevron', pair('XOM', 'CVX', 'pairsZ', { win: 126, entry: 2, exit: 0.4 }),
  'Integrated-oil supermajor pair; both driven by the same crude curve.', { cost: 6 });
reg('Stat Arb / Pairs', 'Pairs: Gold / Silver', pair('GLD', 'SLV', 'pairsZ', { win: 189, entry: 2.2, exit: 0.5 }),
  'Precious-metals ratio trade on the gold/silver spread, one of the oldest relative-value trades in existence.', { cost: 5 });
reg('Stat Arb / Pairs', 'Pairs: Home Depot / Walmart', pair('HD', 'WMT', 'pairsZ', { win: 126, entry: 2.2, exit: 0.5 }),
  'Big-box retail pair spanning discretionary/staples exposure.', { cost: 6 });
reg('Stat Arb / Pairs', 'Pairs: Coca-Cola / P&G', pair('KO', 'PG', 'pairsZ', { win: 189, entry: 2.2, exit: 0.5 }),
  'Defensive staples pair: two low-beta dividend compounders with stable cointegration.', { cost: 6 });
reg('Stat Arb / Pairs', 'ETF Arb: SPY vs DIA', pair('SPY', 'DIA', 'pairsZ', { win: 63, entry: 1.8, exit: 0.3 }),
  'Index-overlap arbitrage: SPY and DIA share mega-cap constituents; spread deviations mean-revert fast.', { cost: 3 });
reg('Stat Arb / Pairs', 'ETF Arb: QQQ vs XLK', pair('QQQ', 'XLK', 'pairsZ', { win: 63, entry: 1.8, exit: 0.3 }),
  'Tech-overlap arbitrage between Nasdaq-100 and Tech SPDR.', { cost: 3 });
reg('Stat Arb / Pairs', 'Treasury Curve Spread: TLT vs IEF', pair('TLT', 'IEF', 'pairsZ', { win: 126, entry: 2, exit: 0.4 }),
  'Duration-spread trade on the long end of the Treasury curve (20Y vs 7-10Y).', { cost: 3 });
reg('Stat Arb / Pairs', 'Developed vs Emerging: EFA/EEM', pair('EFA', 'EEM', 'pairsZ', { win: 189, entry: 2, exit: 0.5 }),
  'Regional equity convergence trade between developed ex-US and emerging markets.', { cost: 5 });

/* ---- Relative Value (7) ---- */
reg('Relative Value', 'Size Spread: Small vs Large', pair('IWM', 'SPY', 'ratioRV', { n: 126, entry: 1.8 }),
  'Fade extremes in the small/large ratio, the size factor mean-reverts at multi-month horizons.', { cost: 4 });
reg('Relative Value', 'Credit RV: High Yield vs IG', pair('HYG', 'LQD', 'ratioRV', { n: 126, entry: 1.8 }),
  'Credit-quality spread trade: fade dislocations between junk and investment-grade bond ETFs.', { cost: 4 });
reg('Relative Value', 'Gold/Silver Ratio Momentum', pair('GLD', 'SLV', 'ratioRV', { n: 126, momentum: true }),
  'Precious-metals ratio momentum: ride persistent trends in the gold/silver ratio rather than fading them.', { cost: 5 });
reg('Relative Value', 'Energy RV: Crude vs Energy Equity', pair('USO', 'XLE', 'ratioRV', { n: 126, entry: 2 }),
  'Commodity-vs-equity convergence: energy stocks and spot crude share a common driver but diverge on equity beta.', { cost: 6 });
reg('Relative Value', 'Defensives vs Cyclicals', pair('XLP', 'XLY', 'ratioRV', { n: 126, momentum: true }),
  'Staples/discretionary ratio momentum, a classic risk-appetite barometer traded directly.', { cost: 4 });
reg('Relative Value', 'REITs vs Bonds', pair('VNQ', 'TLT', 'ratioRV', { n: 126, entry: 2 }),
  'Rate-sensitive RV between real estate and long Treasuries.', { cost: 4 });
reg('Relative Value', 'Metals Cross: Gold vs Copper', pair('GC=F', 'HG=F', 'ratioRV', { n: 126, momentum: true }),
  'Gold/copper ratio momentum, a fear-vs-growth trade in the metals complex.', { cost: 8 });

/* ---- Volatility (8) ---- */
reg('Volatility', 'Vol Targeting, S&P 500', single('SPY', 'volTargetHold', { n: 20, target: 0.12, maxLev: 1.5 }),
  'Constant 12% volatility exposure to SPY: leverage low-vol regimes, cut high-vol ones. Exploits the leverage-effect asymmetry.');
reg('Volatility', 'Vol Breakout, Nasdaq', single('QQQ', 'volBreakout', { n: 20, k: 2 }),
  'Enter on 2σ single-day range expansions in QQQ; positions decay unless confirmed.');
reg('Volatility', 'VIX Regime Timing', single('SPY', 'vixRegime', { n: 63 }),
  'Long equities only when VIX sits below its 3-month average, a term-structure/contango proxy using real CBOE data.');
reg('Volatility', 'Volatility Risk Premium Harvest', single('SPY', 'vrpHarvest', {}),
  'Scale SPY exposure by the spread between implied vol (VIX) and 21-day realized vol, harvesting the variance risk premium without options. Proxy for systematic short-vol overlays.');
reg('Volatility', 'Vol-Managed Momentum', single('QQQ', 'tsMom', { n: 252, skip: 21 }, { volTarget: 0.15 }),
  'Barroso-Santa-Clara vol-managed momentum: 12-1 momentum signal with position size scaled to 15% target vol.');
reg('Volatility', 'Crash Protection Switch', single('SPY', 'regimeFiltered', { sma: 200, vixMax: 35 }),
  'A protective-put replication: full equity exposure in calm uptrends, flat in stress, the payoff profile institutions buy puts to achieve, implemented via timing.');
reg('Volatility', 'Gold Vol Targeting', single('GLD', 'volTargetHold', { n: 20, target: 0.1, maxLev: 1.4 }),
  'Constant-vol gold exposure, stabilizes a notoriously regime-y asset.');
reg('Volatility', 'HMM Regime Switch, S&P 500', single('SPY', 'hmmSwitch', {}),
  'Two-state Gaussian hidden Markov model refit quarterly on trailing 3y of returns; exposure scales with the calm-state probability. Full EM estimation runs in-browser.');

/* ---- Factor Investing (8) ---- */
reg('Factor Investing', 'Momentum Factor, MTUM Tilt', single('MTUM', 'smaCross', { fast: 50, slow: 200 }),
  'Trend-filtered exposure to the iShares momentum factor ETF.', { from: '2014-06-01' });
reg('Factor Investing', 'Quality Factor, QUAL Tilt', single('QUAL', 'smaCross', { fast: 50, slow: 200 }),
  'Trend-filtered exposure to the quality factor (high ROE, stable earnings, low leverage).', { from: '2015-01-01' });
reg('Factor Investing', 'Min-Vol Anomaly, USMV', single('USMV', 'tsMom', { n: 252, skip: 21 }),
  'The low-volatility anomaly: defensive stocks earn near-market returns at lower risk. Momentum-timed USMV.', { from: '2013-01-01' });
reg('Factor Investing', 'Value vs Growth Spread', pair('VTV', 'VUG', 'ratioRV', { n: 189, entry: 2 }),
  'Dollar-neutral value-minus-growth (HML proxy) traded on z-score extremes of the style ratio.', { cost: 4 });
reg('Factor Investing', 'Size Factor, SMB Proxy', pair('IWM', 'SPY', 'ratioRV', { n: 189, momentum: true }),
  'Small-minus-big traded with ratio momentum instead of buy-and-hold.', { cost: 4 });
reg('Factor Investing', 'Quality vs Market L/S', pair('QUAL', 'SPY', 'ratioRV', { n: 126, momentum: true }),
  'Long quality / short market when the quality factor trends, defensive factor timing.', { from: '2015-01-01', cost: 4 });
reg('Factor Investing', 'Multi-Factor Blend (ERC)', xs(['MTUM', 'QUAL', 'USMV', 'VTV'], 'riskParity', { method: 'erc', reb: 21 }),
  'Equal-risk-contribution blend of momentum, quality, min-vol and value factor ETFs, rebalanced monthly.', { from: '2015-01-01', cost: 3 });
reg('Factor Investing', 'Style Factor Rotation', xs(['MTUM', 'QUAL', 'USMV', 'VTV', 'VUG'], 'momentum', { n: 126, skip: 21, topN: 2, reb: 21 }),
  'Rotate into the 2 strongest style factors by 6-month return.', { from: '2015-01-01', cost: 4 });

/* ---- Macro & Regime (10) ---- */
reg('Macro / Regime', 'Yield-Curve Recession Guard', single('SPY', 'thresholdSignal', { level: 0, below: false }, { macro: 'T10Y2Y' }),
  'Hold equities only while the 10Y-2Y Treasury spread is positive. Inversions have preceded every US recession since 1976. Uses real FRED data.');
reg('Macro / Regime', 'Credit-Spread Risk Switch', single('SPY', 'thresholdSignal', { level: 5, below: true }, { macro: 'BAMLH0A0HYM2' }),
  'Risk-on only when the ICE BofA High-Yield OAS is under 5%. Credit leads equity in every deleveraging cycle.');
reg('Macro / Regime', 'Fed Cycle Rider', single('SPY', 'macroSignal', { n: 126, invert: true }, { macro: 'FEDFUNDS' }),
  "Long equities when the Fed Funds rate's 6-month trend is flat or falling, don't fight the Fed, measured on the actual policy rate.");
reg('Macro / Regime', 'Inflation Regime, Gold', single('GLD', 'macroSignal', { n: 252 }, { macro: 'CPIAUCSL' }),
  'Hold gold when trailing CPI momentum is positive (rising-inflation regimes).');
reg('Macro / Regime', 'Unemployment Momentum Filter', single('SPY', 'macroSignal', { n: 126, invert: true }, { macro: 'UNRATE' }),
  'A Sahm-rule cousin: exit equities when the unemployment rate is trending up over 6 months.');
reg('Macro / Regime', 'Dollar Regime, EM Timing', single('EEM', 'macroSignal', { n: 126, invert: true }, { macro: 'DTWEXBGS' }),
  'Emerging markets only when the trade-weighted dollar is weakening, the tightest macro linkage in EM investing.');
reg('Macro / Regime', 'Falling-Yield Duration Trade', single('TLT', 'macroSignal', { n: 126, invert: true }, { macro: 'DGS10' }),
  'Hold long duration when the 10-year yield itself is trending down.');
reg('Macro / Regime', 'Jobless-Claims Momentum', single('SPY', 'macroSignal', { n: 126, invert: true }, { macro: 'ICSA' }),
  'Weekly initial claims trending down → labor market healthy → risk-on. One of the timeliest official macro series.');
reg('Macro / Regime', 'Housing Cycle, Early Cyclicals', single('XLB', 'macroSignal', { n: 252 }, { macro: 'PERMIT' }),
  'Materials exposure gated on building-permits momentum, the classic early-cycle indicator.');
reg('Macro / Regime', 'Consumer Sentiment Contrarian', single('SPY', 'macroSignal', { n: 63, invert: true, thr: -0.15 }, { macro: 'UMCSENT' }),
  'Buy when Michigan sentiment has collapsed >15% in 3 months, extreme pessimism is a reliable long signal (contrarian).');

/* ---- Carry & Seasonality (7) ---- */
reg('Carry / Seasonality', 'Bond Carry, Curve Slope', single('TLT', 'thresholdSignal', { level: 0.5, below: false }, { macro: 'T10Y2Y' }),
  'Hold long bonds when the curve is steep (10Y-2Y > 0.5%): positive carry and roll-down.');
reg('Carry / Seasonality', 'Turn-of-Month Effect', single('SPY', 'seasonal', { type: 'turnOfMonth' }),
  'Hold SPY only over the last 3 and first 2 trading days of each month, the window that has historically captured most of the equity premium (pension flows).', { cost: 3 });
reg('Carry / Seasonality', 'Sell in May, Halloween Effect', single('SPY', 'seasonal', { type: 'sellInMay' }),
  'Long November–April, flat May–October. Documented across 100+ years and 37 countries (Bouman & Jacobsen).');
reg('Carry / Seasonality', 'Santa Claus Rally', single('SPY', 'seasonal', { type: 'santa' }),
  'Mid-December through the first days of January.');
reg('Carry / Seasonality', 'NatGas Winter Seasonality', single('NG=F', 'seasonal', { type: 'months', months: [8, 9, 10] }),
  'Long natural gas Aug–Oct ahead of winter heating demand, a physical-storage seasonal.', { bench: 'NG=F', cost: 10 });
reg('Carry / Seasonality', 'Gold Festival Seasonality', single('GLD', 'seasonal', { type: 'months', months: [8, 9, 12, 1] }),
  'Gold demand seasonality around Indian wedding season and Chinese New Year.');
reg('Carry / Seasonality', 'HY Credit Carry Filter', single('HYG', 'thresholdSignal', { level: 6.5, below: true }, { macro: 'BAMLH0A0HYM2' }),
  'Collect high-yield carry only while spreads are tight and stable (<6.5%); step aside in credit stress.');

/* ---- Crypto (8) ---- */
reg('Crypto', 'BTC Trend, 20/100 Cross', single('BTC-USD', 'smaCross', { fast: 20, slow: 100 }),
  'Moving-average trend on Bitcoin using real Coinbase daily data. Crypto trends are strong but drawdowns brutal, trend filters historically avoided the worst.', { bench: 'BTC-USD', cost: 10 });
reg('Crypto', 'BTC TS Momentum 90d', single('BTC-USD', 'tsMom', { n: 90, skip: 7 }),
  '90-day time-series momentum on BTC with a 1-week skip.', { bench: 'BTC-USD', cost: 10 });
reg('Crypto', 'ETH Donchian Breakout', single('ETH-USD', 'donchian', { n: 40 }),
  '40-day channel breakout on Ethereum.', { bench: 'ETH-USD', cost: 12 });
reg('Crypto', 'BTC Vol Targeting', single('BTC-USD', 'volTargetHold', { n: 20, target: 0.25, maxLev: 1 }),
  'Cap BTC exposure at 25% annualized vol, turns an 80-vol asset into an allocatable sleeve.', { bench: 'BTC-USD', cost: 10 });
reg('Crypto', 'BTC Mean Reversion, Deep Dips', single('BTC-USD', 'meanRevZ', { n: 30, entry: 2.5, exit: 0.5 }),
  'Buy 2.5σ dislocations below the 30-day mean. Only deep panics qualify.', { bench: 'BTC-USD', cost: 10 });
reg('Crypto', 'ETH/BTC Ratio Momentum', pair('ETH-USD', 'BTC-USD', 'ratioRV', { n: 90, momentum: true }),
  'Rotate between the two majors on ETH/BTC ratio momentum, the crypto risk-appetite barometer.', { bench: 'BTC-USD', cost: 12 });
reg('Crypto', 'Crypto XS Momentum, Top 2 of 6', xs(['BTC-USD', 'ETH-USD', 'SOL-USD', 'LTC-USD', 'ADA-USD', 'LINK-USD'], 'momentum', { n: 90, skip: 7, topN: 2, reb: 14 }),
  'Biweekly rotation into the 2 strongest majors by 90-day return.', { bench: 'BTC-USD', cost: 15, from: '2021-06-01' });
reg('Crypto', 'BTC HMM Regime Switch', single('BTC-USD', 'hmmSwitch', {}),
  'Hidden Markov regime model on BTC returns; exposure follows the calm-state probability.', { bench: 'BTC-USD', cost: 10 });

/* ---- Machine Learning (8, executed by the ML lab) ---- */
reg('Machine Learning', 'Ridge Momentum Ensemble, SPY', { kind: 'ml', model: 'ridge', sym: 'SPY', horizon: 5 },
  'Walk-forward ridge regression on 14 engineered features (momentum, reversal, vol, VIX, curve) predicting 5-day SPY returns. Refit quarterly; position = clipped prediction score.');
reg('Machine Learning', 'Logistic Direction Classifier, QQQ', { kind: 'ml', model: 'logistic', sym: 'QQQ', horizon: 5 },
  'Logistic classifier on the same feature set predicting up/down weeks for QQQ; exposure = 2·P(up)−1, walk-forward.');
reg('Machine Learning', 'Gradient-Boosted Stumps, SPY', { kind: 'ml', model: 'gbm', sym: 'SPY', horizon: 10 },
  'Gradient boosting with depth-1 trees (60 rounds) on nonlinear feature interactions, predicting 2-week returns. Fully trained in-browser, walk-forward.');
reg('Machine Learning', 'k-NN Pattern Matcher, SPY', { kind: 'ml', model: 'knn', sym: 'SPY', horizon: 5 },
  'Nearest-neighbor search over normalized feature vectors: trade the average forward return of the 25 most similar historical episodes.');
reg('Machine Learning', 'Neural Net (MLP), SPY', { kind: 'ml', model: 'mlp', sym: 'SPY', horizon: 10 },
  'Single-hidden-layer neural network (12 tanh units) trained by SGD, walk-forward, predicting 2-week returns. The honest baseline every deep model must beat.');
reg('Machine Learning', 'Ridge, Gold Macro Model', { kind: 'ml', model: 'ridge', sym: 'GLD', horizon: 10 },
  'Ridge regression for gold using momentum, dollar, rate and vol features.');
reg('Machine Learning', 'GBM, Bitcoin', { kind: 'ml', model: 'gbm', sym: 'BTC-USD', horizon: 7 },
  'Boosted stumps on BTC with crypto-specific features (drawdown state, weekend effect, vol regime).', { bench: 'BTC-USD', cost: 10 });
reg('Machine Learning', 'Model Ensemble Vote, SPY', { kind: 'ml', model: 'ensemble', sym: 'SPY', horizon: 5 },
  'Equal-weight vote of ridge, logistic, GBM and k-NN predictions; position scales with agreement.');

/* ---- Portfolio Construction (6) ---- */
reg('Allocation', 'Classic 60/40', xs(['SPY', 'TLT'], 'fixedMix', { mix: [0.6, 0.4] }),
  'The institutional benchmark: 60% equities, 40% long Treasuries, monthly rebalanced.', { cost: 1 });
reg('Allocation', 'Permanent Portfolio', xs(['SPY', 'TLT', 'GLD', 'SHY'], 'fixedMix', { mix: [0.25, 0.25, 0.25, 0.25] }),
  "Harry Browne's four-season allocation: equal parts stocks, long bonds, gold, cash.", { cost: 1 });
reg('Allocation', 'All-Weather (Dalio-style)', xs(['SPY', 'TLT', 'IEF', 'GLD', 'DBC'], 'fixedMix', { mix: [0.30, 0.40, 0.15, 0.075, 0.075] }),
  'Risk-balanced strategic mix inspired by Bridgewater All-Weather: 30/40/15/7.5/7.5 across stocks, long bonds, intermediates, gold, commodities.', { cost: 1 });
reg('Allocation', 'Equal Risk Contribution, 6 Assets', xs(['SPY', 'EFA', 'TLT', 'GLD', 'DBC', 'VNQ'], 'riskParity', { method: 'erc' }),
  'Each asset contributes equally to portfolio variance; weights re-estimated monthly from trailing 1y covariance.', { cost: 2 });
reg('Allocation', 'Hierarchical Risk Parity, 8 Assets', xs(['SPY', 'EFA', 'EEM', 'TLT', 'IEF', 'GLD', 'DBC', 'VNQ'], 'riskParity', { method: 'hrp' }),
  "López de Prado's HRP: correlation-distance clustering plus recursive bisection, no matrix inversion, robust to estimation error.", { cost: 2 });
reg('Allocation', 'Minimum Variance, Multi-Asset', xs(['SPY', 'EFA', 'TLT', 'IEF', 'GLD', 'VNQ'], 'riskParity', { method: 'minvar' }),
  'Long-only minimum-variance portfolio via projected gradient descent on the trailing covariance matrix.', { cost: 2 });

/* ---- Event-Driven & Alternative Data (12, require external datasets) ---- */
regData('Event-Driven', 'Merger Arbitrage', 'Systematically capture deal spreads between announced acquisition prices and market prices, sized by completion probability. Requires a live M&A deal feed (announcement dates, terms, spread history), upload a deals CSV (ticker, announce_date, offer_price, outcome) via the Data Hub to activate.', 'M&A deal feed');
regData('Event-Driven', 'Post-Earnings Announcement Drift', 'Long stocks with large positive earnings surprises for 60 days post-announcement (PEAD, Bernard & Thomas 1989). Requires an earnings calendar with consensus estimates and actuals, upload an earnings CSV (ticker, date, eps_est, eps_actual) to activate.', 'Earnings surprise history');
regData('Event-Driven', 'ADR Arbitrage', 'Trade price gaps between ADRs and their home-market ordinary shares, FX-adjusted. Requires dual-listed pairs with home-market prices in local currency.', 'Home-market price feed');
regData('Event-Driven', 'Index Rebalance Flow', 'Buy additions / sell deletions ahead of S&P and Russell index reconstitution flows. Requires index change announcements.', 'Index event feed');
regData('Event-Driven', 'Insider Transaction Momentum', 'Follow clustered open-market insider buys (Form 4 filings). Upload SEC Form 4 extracts (ticker, date, insider_role, shares, price) to activate, the module scores cluster intensity and backtests 90-day forward returns.', 'SEC Form 4 data');
regData('Alt Data / NLP', 'SEC 10-K Sentiment Delta', 'Score year-over-year language changes in 10-K risk factors (Loughran-McDonald dictionaries); short filers with rising negativity. Requires EDGAR filing texts.', 'EDGAR filing corpus');
regData('Alt Data / NLP', 'News Sentiment Momentum', 'Aggregate ticker-level news sentiment into daily scores and trade 5-day continuation. Requires a news API feed with timestamps and tickers.', 'News feed with sentiment');
regData('Alt Data / NLP', 'Social Sentiment Reversal', 'Fade extreme retail social-media sentiment spikes (contrarian). Requires social volume + sentiment per ticker (e.g. exported Reddit/X datasets).', 'Social sentiment dataset');
regData('Alt Data / NLP', 'Google Trends Nowcasting', 'Nowcast consumer-facing revenue from search interest; trade earnings-quarter positioning. Upload Google Trends CSV exports per brand/ticker to activate.', 'Google Trends exports');
regData('Alt Data / NLP', 'Satellite Imagery, Retail Traffic', 'Parking-lot car counts as a same-quarter revenue signal for big-box retailers. Requires a satellite/geolocation vendor dataset.', 'Satellite imagery feed');
regData('Options', 'Gamma Scalping / Delta-Neutral', 'Continuously re-hedge a long-options book to monetize realized vs implied vol gaps. Requires an options chain with greeks (strike-level quotes); the bundled dataset covers index-level implied vol (VIX) only, the VRP Harvest module implements the closest index-level proxy.', 'Options chain data');
regData('Options', 'VIX Term-Structure Carry', 'Short front-month VIX futures in contango, long in backwardation. Requires the VIX futures curve (VX1–VX8 settlements); the bundled VIX spot supports only the regime-proxy variants implemented above.', 'VIX futures curve');

S.registry = R;
S.categories = [...new Set(R.map(r => r.cat))];
S.byId = Object.fromEntries(R.map(r => [r.id, r]));
})();
