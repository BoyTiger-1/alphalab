/* AlphaLab Explain: plain-English meaning for every number on screen.
   A glossary of every metric, column, tile and chart title the app shows. Each term gets a dotted
   underline and a hover card with what it is, how to read it, and a verdict on the value on screen.
   Explain mode (on by default, toggle in the top bar) also writes a one-line reading under each number
   and opens a short "what this page tells you" guide at the top of every module. */
'use strict';
(function () {
const EX = window.EX = {};

/* ---------- value parsing and grading helpers ---------- */
function nums(txt) {
  const s = String(txt || '').replace(/[−–]/g, '-').replace(/,/g, '');
  const m = s.match(/[+\-]?\d*\.?\d+/g);
  return m ? m.map(Number).filter(isFinite) : [];
}
function pick(txt, label) {
  const n = nums(txt); if (!n.length) return null;
  return /->|→/.test(label || '') || /->|→/.test(txt || '') ? n[n.length - 1] : n[0];
}
const G = (tone, text) => ({ tone, text });
// bands: [[upper, tone, text], ...] checked in order on value v
const band = (list) => v => { for (const [hi, tone, text] of list) if (v < hi) return G(tone, text); return null; };

/* ---------- the glossary ---------- */
// t: display name, w: what it is, r: how to read it, g: optional grader on the parsed number
const GL = [
  // performance
  { re: /^(cagr|cagr 3y|cagr\*|blend cagr|cagr base -> twin|twin cagr|base cagr|mean ret \(ann\.\)|ret(urn)?( \(ann\.\))?)$/,
    t: 'CAGR (compound annual growth rate)', w: 'The average yearly return if the investment had grown at a steady rate. 10% means $100 turned into $110 per year on average, with gains compounding.',
    r: 'Compare it to the S&P 500, which has returned roughly 10% a year over the long run. A high CAGR with a huge drawdown is not a free lunch.',
    g: band([[0, 'bad', 'Lost money per year on average'], [4, 'warn', 'Below cash-like returns in most years'], [8, 'ok', 'Modest, below the stock market average'], [14, 'good', 'Strong, around or above the stock market'], [1e9, 'good', 'Very strong. Check it is not from one lucky stretch']]) },
  { re: /^(sharpe|sharpe\*|sr|sr full|sr 3y|sharpe 1y|base sr|twin sr|bench sr|blend sharpe.*|sharpe base -> twin|best sharpe.*|best in-sample|in-sample sharpe.*|out-of-sample sharpe.*|benchmark sharpe.*|sharpe @ 3× costs|param-perturbation median sr|sharpe ratio)$/,
    t: 'Sharpe ratio', w: 'Return earned per unit of risk taken. It is the yearly return above cash, divided by how much the returns swing around (volatility).',
    r: 'Below 0 lost to cash. 0.3 to 0.5 is typical for the stock market. Above 1 is very good. Above 2 over many years is rare and usually a sign to double-check the test.',
    g: band([[0, 'bad', 'Did worse than just holding cash'], [0.3, 'warn', 'Weak reward for the risk taken'], [0.6, 'ok', 'About what the stock market pays'], [1, 'good', 'Good, better than the market'], [2, 'good', 'Excellent risk-adjusted return'], [1e9, 'warn', 'Unusually high, check for overfitting']]) },
  { re: /^sortino$/, t: 'Sortino ratio', w: 'Like Sharpe, but it only counts the bad swings (losses) as risk. Upside jumps are not penalized.',
    r: 'Read it like Sharpe. It is usually higher than Sharpe. A big gap between them means the ups are bigger than the downs.',
    g: band([[0, 'bad', 'Lost to cash after counting downside'], [0.5, 'warn', 'Weak'], [1, 'ok', 'Decent'], [1e9, 'good', 'Strong return for the downside risk']]) },
  { re: /^calmar$/, t: 'Calmar ratio', w: 'Yearly return divided by the worst peak-to-bottom loss. It asks: how much did you earn for the worst pain you had to sit through?',
    r: 'Above 0.5 is decent, above 1 is very good. The S&P 500 is usually around 0.2 to 0.3.',
    g: band([[0, 'bad', 'Negative return'], [0.25, 'warn', 'Deep losses relative to the gain'], [0.6, 'ok', 'Reasonable'], [1e9, 'good', 'Earns a lot relative to its worst loss']]) },
  { re: /^omega$/, t: 'Omega ratio', w: 'Total size of all gains divided by total size of all losses (day by day).',
    r: 'Above 1 means gains outweigh losses. 1.1 or more is solid for a daily series.',
    g: band([[1, 'bad', 'Losses outweigh gains'], [1.05, 'ok', 'Gains slightly outweigh losses'], [1e9, 'good', 'Gains clearly outweigh losses']]) },
  { re: /^(volatility|vol|vol \(ann\.\)|vol 1y|blend vol|est\. annual volatility|long-run vol|realized 21d|tomorrow vol \(ann\.\)|idiosyncratic vol|realized vol.*|ann\. vol.*|est\. vol.*|rolling 63d annualized vol)$/,
    t: 'Volatility', w: 'How much the price swings, scaled to a year. 20% means a typical year lands within about 20% above or below its average.',
    r: 'Bonds run around 5%, the S&P 500 about 15 to 20%, single stocks 25 to 50%, bitcoin 60% or more. Higher volatility means a bumpier ride, not necessarily a worse investment.',
    g: band([[8, 'good', 'Calm, bond-like swings'], [18, 'ok', 'Similar to the overall stock market'], [30, 'warn', 'Bumpier than the market'], [1e9, 'bad', 'Very large swings, size it small']]) },
  { re: /^(max drawdown|max dd|maxdd|maxdd\*|maxdd 1y|blend maxdd|base dd|twin dd|max dd base -> twin|drawdown|depth|worst point|projected trough|trough)$/,
    t: 'Maximum drawdown', w: 'The biggest drop from a high point to a later low point. -30% means at the worst moment you were down 30% from your best value.',
    r: 'The S&P 500 fell about 55% in 2008 and 34% in 2020. A -50% loss needs a +100% gain to recover. Most people cannot stomach more than -20% to -25%.',
    g: v => { v = Math.abs(v); return v < 10 ? G('good', 'Shallow, easy to hold through') : v < 20 ? G('ok', 'Moderate, a normal correction') : v < 35 ? G('warn', 'Deep, feels like a bear market') : G('bad', 'Severe, needs a huge gain to recover'); } },
  { re: /^(var 95.*|value-at-risk|\d+-day var.*)$/, t: 'Value at Risk (95%, 1 day)', w: 'On 19 out of 20 days, the daily loss should be smaller than this. It is the loss on a "bad but normal" day.',
    r: 'It says nothing about the worst days, which can be much larger. Look at CVaR for that.',
    g: v => { v = Math.abs(v); return v < 1 ? G('good', 'Small daily risk') : v < 2 ? G('ok', 'Typical for a stock portfolio') : v < 3.5 ? G('warn', 'Large daily swings') : G('bad', 'Very large daily swings'); } },
  { re: /^(cvar 95.*|expected shortfall|\d+-day cvar.*)$/, t: 'CVaR (expected shortfall)', w: 'The average loss on the worst 5% of days. It answers: when things go badly, how bad on average?',
    r: 'Always bigger than VaR. If it is much bigger, the strategy has fat-tail crash risk.',
    g: v => { v = Math.abs(v); return v < 1.5 ? G('good', 'Contained bad days') : v < 3 ? G('ok', 'Normal for stocks') : G('warn', 'Bad days hit hard'); } },
  { re: /^(hit rate|directional hit rate|direction hit rate|win rate|base win rate|positive years)$/, t: 'Hit rate', w: 'The share of periods (days, trades or predictions) that were winners.',
    r: 'Stocks are up on about 53% of days. A hit rate near 50% can still make money if wins are bigger than losses. For a prediction model, anything reliably above 52% is useful.',
    g: band([[48, 'warn', 'Loses more often than it wins'], [52, 'ok', 'About a coin flip'], [58, 'good', 'Wins more often than it loses'], [1e9, 'good', 'Wins most of the time']]) },
  { re: /^skew$/, t: 'Skewness', w: 'Whether the big surprises tend to be gains (positive skew) or losses (negative skew).',
    r: 'Negative skew means small steady gains with occasional big crashes, the pattern of selling insurance. Positive skew means many small losses and occasional big wins, like trend following.',
    g: band([[-0.5, 'warn', 'Crash-prone: big surprises are losses'], [0.5, 'ok', 'Roughly balanced surprises'], [1e9, 'good', 'Big surprises tend to be gains']]) },
  { re: /^kurtosis$/, t: 'Kurtosis (tail fatness)', w: 'How often extreme days happen compared with a normal bell curve. A normal curve scores 0 here (excess kurtosis).',
    r: 'Stock returns typically score 3 to 10: extreme days happen far more often than textbooks assume. Higher means more surprise risk.',
    g: band([[1, 'good', 'Close to bell-curve behavior'], [6, 'ok', 'Typical fat tails for markets'], [1e9, 'warn', 'Very fat tails, extreme days are common']]) },
  // market relation
  { re: /^(beta|portfolio beta.*|mkt|market beta|rolling 126-day market beta)$/, t: 'Beta', w: 'How much this moves when the overall market moves. Beta 1.2 means a 1% market move tends to come with a 1.2% move here.',
    r: '1 moves with the market, below 1 is defensive, above 1 is aggressive, near 0 is unrelated, negative moves the opposite way.',
    g: band([[-0.2, 'ok', 'Tends to move against the market'], [0.3, 'good', 'Mostly independent of the market'], [0.8, 'ok', 'Defensive, moves less than the market'], [1.2, 'ok', 'Moves roughly with the market'], [1e9, 'warn', 'Amplifies market moves']]) },
  { re: /^(jensen.*|alpha \(ann\.\)|alpha|jensen's α)$/, t: "Alpha (Jensen's)", w: 'The return left over after accounting for the market exposure (beta). It is the part of the return that came from skill or a real edge.',
    r: 'Positive is good, but check the t-stat: small alphas are often noise.',
    g: band([[-1, 'bad', 'Underperforms after adjusting for market risk'], [1, 'ok', 'About zero, no clear edge'], [1e9, 'good', 'Beats the market after adjusting for risk']]) },
  { re: /^(alpha t-stat|t-stat|t|z)$/, t: 't-statistic', w: 'How many standard errors away from zero the estimate is. It measures how confident we can be the effect is real and not luck.',
    r: 'Above 2 (or below -2) is the usual bar for "probably real". Above 3 is strong. Between -2 and 2 could easily be noise.',
    g: v => Math.abs(v) >= 3 ? G('good', 'Strong statistical evidence') : Math.abs(v) >= 2 ? G('ok', 'Probably real, not certain') : G('warn', 'Could easily be luck') },
  { re: /^(info ratio|information ratio)$/, t: 'Information ratio', w: 'Extra return over the benchmark divided by how much you deviate from it. It is the Sharpe ratio of beating the benchmark.',
    r: 'Above 0.5 is good for an active manager, above 1 is exceptional.',
    g: band([[0, 'bad', 'Trails the benchmark'], [0.3, 'ok', 'Small edge'], [0.7, 'good', 'Good active skill'], [1e9, 'good', 'Exceptional']]) },
  { re: /^treynor$/, t: 'Treynor ratio', w: 'Return above cash per unit of market risk (beta) instead of total risk.', r: 'Higher is better. Useful for comparing funds that are one piece of a bigger portfolio.' },
  { re: /^(tracking err|tracking error)$/, t: 'Tracking error', w: 'How far returns drift from the benchmark each year. Low means it behaves like an index fund.',
    r: 'Under 3% is index-like, 3 to 8% is typical active management, above 10% is a very different bet from the index.',
    g: band([[3, 'ok', 'Behaves close to the benchmark'], [8, 'ok', 'Typical active manager'], [1e9, 'warn', 'Very different from the benchmark']]) },
  { re: /^(r squared|r2|r²)$/, t: 'R squared', w: 'The share of the ups and downs explained by the factors or model (0 to 1, or 0 to 100%).',
    r: 'Near 1 means the factors explain almost everything. Near 0 means the return is mostly its own story.',
    g: v => { if (v > 1) v /= 100; return v > 0.7 ? G('ok', 'Mostly explained by the factors') : v > 0.3 ? G('ok', 'Partly explained') : G('ok', 'Mostly its own behavior'); } },
  // validation, stats, overfitting
  { re: /^(psr.*|probabilistic sharpe ratio|statistical confidence.*)$/, t: 'Probabilistic Sharpe Ratio (PSR)', w: 'The probability that the true Sharpe ratio is above zero, given how long the track record is and how odd the returns look.',
    r: 'Above 95% is strong evidence of a real edge. Below 80% the track record is too short or too noisy to trust.',
    g: v => { if (v <= 1) v *= 100; return v >= 95 ? G('good', 'Strong evidence it is real') : v >= 80 ? G('ok', 'Likely real, not proven') : G('warn', 'Not enough evidence yet'); } },
  { re: /^deflated sharpe$/, t: 'Deflated Sharpe Ratio (DSR)', w: 'Like PSR, but it also penalizes you for trying many strategies and keeping the best one. More tries means more luck in the winner.',
    r: 'Above 95% survives the multiple-testing penalty. Below 50% the best result is probably luck.',
    g: v => { if (v <= 1) v *= 100; return v >= 95 ? G('good', 'Survives the multiple-testing penalty') : v >= 50 ? G('warn', 'Might be luck') : G('bad', 'Probably luck from trying many ideas'); } },
  { re: /^pbo$/, t: 'Probability of Backtest Overfitting (PBO)', w: 'How often the strategy that looked best in the past did worse than average in the next period. Estimated by splitting history many ways (CSCV).',
    r: 'Below 20% is healthy. Above 50% means picking the best backtest is worse than picking at random.',
    g: v => { if (v <= 1) v *= 100; return v < 20 ? G('good', 'Selection process looks sound') : v < 50 ? G('warn', 'Some overfitting') : G('bad', 'Heavily overfit'); } },
  { re: /^expected max sr from luck$/, t: 'Expected best Sharpe from luck', w: 'If every strategy you tried had zero real skill, this is the Sharpe the best one would still show by chance.',
    r: 'Your best strategy needs to beat this number clearly before it means anything.' },
  { re: /^(trials|specifications explored)$/, t: 'Trials', w: 'How many versions were tested. More tries means a higher chance the best one is a fluke.', r: 'Always report it. Judges and reviewers discount results found after many tries.' },
  { re: /^(oos|oos ic|out-of-sample.*|held-out.*)$/, t: 'Out-of-sample (OOS)', w: 'Results on data the model never saw while being built. It is the honest test.',
    r: 'If out-of-sample is much worse than in-sample, the strategy was fitted to noise.' },
  { re: /^(ic|rank ic.*|held-out rank ic|median ic)$/, t: 'Information coefficient (IC)', w: 'The rank correlation between what a signal predicted and what actually happened next. It runs from -1 to +1.',
    r: 'In finance, 0.02 to 0.05 is already useful and 0.1 is excellent. Anything consistently above 0 across many periods is valuable.',
    g: band([[0, 'bad', 'Predictions point the wrong way'], [0.02, 'ok', 'Very weak signal'], [0.06, 'good', 'Useful signal for finance'], [1e9, 'good', 'Strong signal, verify it is not leaking']]) },
  { re: /^(auc|auc \(oos\)|median auc)$/, t: 'AUC', w: 'How well a model ranks winners above losers. 0.5 is a coin flip, 1.0 is perfect.',
    r: 'In markets, 0.52 to 0.55 is typical of a real but small edge. Above 0.6 on daily data is suspicious.',
    g: band([[0.5, 'bad', 'Worse than a coin flip'], [0.52, 'ok', 'Near coin flip'], [0.6, 'good', 'Small real edge'], [1e9, 'warn', 'Unusually high, check for leakage']]) },
  { re: /^precision$/, t: 'Precision', w: 'When the model said "go", how often it was right.', r: 'Compare it with the base win rate: precision must beat that to add value.' },
  { re: /^(accuracy|acc)$/, t: 'Accuracy', w: 'Share of all predictions that were correct.', r: 'Misleading when one outcome is common. Compare with the base rate.' },
  { re: /^(train loss|held-out loss|loss)$/, t: 'Loss', w: 'The error the model is trying to shrink while training. Lower is better.',
    r: 'If training loss keeps falling but held-out loss rises, the model is memorizing instead of learning.' },
  { re: /^(epoch|refits|walk-forward refits|refit cadence)$/, t: 'Training rounds', w: 'An epoch is one full pass over the training data. A refit retrains the model on newer data as time moves forward.', r: 'Refitting as you go keeps the test honest: the model only uses data available at that time.' },
  { re: /^(oos labels|oos predictions|predictions scored|obs|days|trading days)$/, t: 'Sample size', w: 'How many data points the result is based on.', r: 'More is more reliable. Under about 250 daily points (one year) results are very noisy.' },
  { re: /^(size today|twin position size.*)$/, t: 'Position size today', w: 'How much of the normal position the ML twin would hold today, from 0 (skip) to 1 (full size).', r: 'The twin shrinks the bet when it thinks the signal is likely to fail.' },
  { re: /^(twin raised sharpe|twin cut max drawdown|strategies twinned)$/, t: 'ML twin results', w: 'Counts of strategies where the ML twin improved the result.', r: 'Twins more often cut drawdowns than raise Sharpe. That is useful for risk control.' },
  // regime and macro
  { re: /^(vix|vix \(cboe\))$/, t: 'VIX (fear index)', w: 'The volatility the options market expects for the S&P 500 over the next month, in yearly terms.',
    r: 'Under 15 is calm, 15 to 25 normal, 25 to 35 stressed, above 35 panic (2008 peaked near 80, 2020 near 82).',
    g: band([[15, 'good', 'Calm markets'], [25, 'ok', 'Normal'], [35, 'warn', 'Stressed'], [1e9, 'bad', 'Panic']]) },
  { re: /^(hy credit spread.*|hy spread|hy oas)$/, t: 'High-yield credit spread', w: 'Extra interest risky companies pay to borrow compared with the government. It rises when lenders get nervous.',
    r: 'Under 3.5% is relaxed, 3.5 to 5% normal, above 6% signals stress, above 8% recession fear.',
    g: band([[3.5, 'good', 'Lenders are relaxed'], [5, 'ok', 'Normal'], [7, 'warn', 'Credit stress building'], [1e9, 'bad', 'Recession-level fear']]) },
  { re: /^(10y.2y curve|10y-2y curve|curve|yield curve)$/, t: '10Y minus 2Y yield curve', w: 'The 10-year Treasury rate minus the 2-year rate.',
    r: 'Normally positive. Negative (inverted) has come before most US recessions, usually 6 to 24 months ahead.',
    g: band([[0, 'warn', 'Inverted: an old recession warning sign'], [0.5, 'ok', 'Flat'], [1e9, 'good', 'Normal, upward sloping']]) },
  { re: /^(regime|regime now|regime fit|state|market regime)$/, t: 'Market regime', w: 'A label for the current market environment (for example calm uptrend or high-stress), based on trend, volatility, VIX and credit.',
    r: 'Strategies behave differently by regime. Momentum likes calm trends. Defensive assets shine in stress.' },
  { re: /^(persistence|time in state|exp\. duration)$/, t: 'Regime persistence', w: 'How likely the market is to stay in the same regime tomorrow, or how long a regime usually lasts.', r: 'High persistence means regimes are sticky, so today’s regime is a useful guide for the next weeks.' },
  { re: /^(half-life|spread half-life)$/, t: 'Half-life', w: 'How many days it typically takes for a gap to close halfway. Used for pairs and mean reversion.',
    r: 'Under 30 days is tradable. Above 100 days the gap can stay open longer than you can wait.',
    g: band([[5, 'ok', 'Very fast, costs may eat the edge'], [30, 'good', 'Tradable speed'], [100, 'warn', 'Slow'], [1e9, 'bad', 'Too slow to trade']]) },
  { re: /^(adf t|engle-granger adf|adf)$/, t: 'ADF test statistic', w: 'A test of whether a series keeps snapping back to its average (stationary) or wanders off (random walk).',
    r: 'More negative is stronger. Below about -2.9 there is decent evidence it snaps back, below -3.4 strong evidence.',
    g: v => v < -3.4 ? G('good', 'Strong evidence it mean-reverts') : v < -2.9 ? G('ok', 'Some evidence it mean-reverts') : G('warn', 'Behaves like a random walk') },
  { re: /^(hedge|hedge ratio|kalman beta)$/, t: 'Hedge ratio', w: 'How many units of the second asset to short for each unit of the first, so the pair is balanced.', r: 'The Kalman filter updates it every day as the relationship drifts.' },
  // options
  { re: /^delta$/, t: 'Delta', w: 'How much the option value changes for a $1 move in the stock. Also a rough probability the option finishes in the money.', r: '0.5 is at the money. Near 1 behaves like owning the stock, near 0 barely reacts.' },
  { re: /^gamma$/, t: 'Gamma', w: 'How fast delta changes as the stock moves.', r: 'High gamma means the position’s risk changes quickly. It is highest near the strike close to expiry.' },
  { re: /^theta.*$/, t: 'Theta', w: 'Value gained or lost each day just from time passing.', r: 'Option buyers usually pay theta (negative). Sellers collect it (positive).' },
  { re: /^vega.*$/, t: 'Vega', w: 'Value change for each 1 point change in volatility.', r: 'Long options gain when volatility rises. Short options lose.' },
  { re: /^rho.*$/, t: 'Rho', w: 'Value change for a 1 percentage point change in interest rates.', r: 'Usually small unless the option is long-dated.' },
  { re: /^(spot|strike|net premium|break-even|p\(profit at expiry\)|p\(spot.*|1-sigma range at expiry)$/, t: 'Option terms', w: 'Spot is today’s price. Strike is the price where the option starts paying. Premium is what you pay (or collect). Break-even is where the trade stops losing money at expiry.',
    r: 'P(profit) comes from a lognormal model at the chosen volatility. It is an estimate, not a promise.' },
  // portfolio and holdings
  { re: /^(weight|weight %|target %|target)$/, t: 'Weight', w: 'The share of the portfolio in this position.', r: 'Keep any single stock under about 10% unless you have a strong reason. Diversification is the only free lunch.' },
  { re: /^(p&l|p\/l|p&l %|unrealized p&l|projected p&l)$/, t: 'Profit and loss (P&L)', w: 'How much money the position made or lost. Unrealized means you still hold it, so it is on paper.',
    g: v => v > 0 ? G('good', 'In profit') : v < 0 ? G('bad', 'At a loss') : G('ok', 'Flat') },
  { re: /^(mkt value|market value|total book|book value|aum|capital deployed)$/, t: 'Market value', w: 'What the holdings are worth at the latest closing prices.' },
  { re: /^(cash|cash held|gross \/ cash)$/, t: 'Cash', w: 'Money not invested. It earns roughly the Treasury bill rate.', r: 'Some cash gives flexibility, too much drags returns in rising markets.' },
  { re: /^(concentration \(hhi\)|hhi)$/, t: 'Concentration (HHI)', w: 'Sum of squared weights. 1 means everything in one position. With N equal positions it equals 1/N.',
    r: 'Below 0.1 is well diversified (like 10+ equal positions). Above 0.25 is concentrated.',
    g: v => { if (v > 1) v /= 100; return v < 0.1 ? G('good', 'Well diversified') : v < 0.25 ? G('ok', 'Moderately concentrated') : G('warn', 'Concentrated in a few names'); } },
  { re: /^(positions|holding|holdings)$/, t: 'Positions', w: 'The investments currently held.' },
  { re: /^(nav.*|fund nav)$/, t: 'NAV (net asset value)', w: 'The value of the fund per unit, starting at 1.000. 1.25 means up 25% since launch.' },
  { re: /^drift from plan$/, t: 'Drift from plan', w: 'How far current weights have moved from the target weights because some positions grew faster than others.', r: 'Rebalance when drift gets above about 5%.' },
  { re: /^(risk contribution|contrib)$/, t: 'Risk contribution', w: 'How much of the total portfolio swing each position causes. A small position in a wild stock can still dominate risk.' },
  { re: /^(correlation.*|ret corr|max ρ lib|corr)$/, t: 'Correlation', w: 'How closely two things move together, from -1 (opposite) through 0 (unrelated) to +1 (in lockstep).',
    r: 'Mixing assets with low correlation cuts risk without cutting return. Correlations tend to jump toward 1 in crashes.',
    g: band([[-0.2, 'good', 'Moves opposite, a natural hedge'], [0.3, 'good', 'Mostly unrelated, good diversifier'], [0.7, 'ok', 'Moves somewhat together'], [1e9, 'warn', 'Moves almost in lockstep']]) },
  // stock fundamentals and sentiment
  { re: /^(p\/e|pe|p\/e ratio|trailing p\/e|forward p\/e)$/, t: 'Price to earnings (P/E)', w: 'Share price divided by yearly profit per share. It is how many years of current profit you pay for.',
    r: 'The S&P 500 usually trades at 15 to 25. High P/E means the market expects fast growth. Negative means the company loses money.',
    g: v => v <= 0 ? G('warn', 'Not profitable') : v < 12 ? G('good', 'Cheap, or the market expects trouble') : v < 25 ? G('ok', 'Around market average') : v < 45 ? G('warn', 'Expensive, priced for growth') : G('bad', 'Very expensive') },
  { re: /^(peg|peg ratio)$/, t: 'PEG ratio', w: 'P/E divided by the expected earnings growth rate. It adjusts the price tag for growth.', r: 'Around 1 is fair. Below 1 can be cheap for its growth, above 2 is pricey.',
    g: v => v <= 0 ? G('warn', 'Not meaningful (no growth or losses)') : v < 1 ? G('good', 'Cheap for its growth') : v < 2 ? G('ok', 'Fair') : G('warn', 'Expensive for its growth') },
  { re: /^(roe|return on equity)$/, t: 'Return on equity (ROE)', w: 'Yearly profit divided by shareholders’ money in the company. It shows how well management turns capital into profit.',
    r: 'Above 15% is strong. Very high ROE can come from heavy debt, so check leverage.', g: band([[0, 'bad', 'Losing money'], [8, 'warn', 'Weak'], [15, 'ok', 'Decent'], [1e9, 'good', 'Strong profitability']]) },
  { re: /^(net margin|margin|gross margin|operating margin)$/, t: 'Net profit margin', w: 'Cents of profit kept from each dollar of sales.', r: 'Software can run 20 to 40%, grocers 1 to 3%. Compare within the same industry.',
    g: band([[0, 'bad', 'Losing money'], [5, 'warn', 'Thin margins'], [15, 'ok', 'Healthy'], [1e9, 'good', 'Very profitable']]) },
  { re: /^(rev growth|revenue growth|earnings growth)$/, t: 'Revenue growth', w: 'How much sales grew compared with a year ago.', g: band([[0, 'bad', 'Sales shrinking'], [5, 'ok', 'Slow growth'], [15, 'good', 'Solid growth'], [1e9, 'good', 'Fast growth']]) },
  { re: /^(div yld|dividend yield)$/, t: 'Dividend yield', w: 'Yearly dividends as a percent of the share price.', r: 'The S&P 500 yields about 1.5%. Very high yields (above 7%) can signal a dividend cut is coming.' },
  { re: /^(mom 6m|momentum|1m|1d|ytd|1m δ|trailing 1m return|today)$/, t: 'Recent return', w: 'Price change over the period shown (1 day, 1 month, 6 months, year to date).',
    r: 'Momentum research finds that 6 to 12 month winners tend to keep winning for a while. Very short moves (days) often partly reverse.' },
  { re: /^(sent|sentiment|crowd lean|news tone.*|bullish tagged.*|bearish tagged.*)$/, t: 'Sentiment', w: 'How positive or negative news and social posts are about this name, from -1 (very negative) to +1 (very positive).',
    r: 'Extreme crowd optimism often comes before weak returns. Treat it as context, not a signal on its own.' },
  { re: /^(attention.*|watchlist followers|coverage)$/, t: 'Attention', w: 'How much people are looking at this name (Wikipedia pageviews, followers, news count) compared with normal.', r: 'Spikes in attention often come with big moves and higher volatility.' },
  { re: /^(analyst|analysts covering|consensus|price target.*|implied from current|upside)$/, t: 'Analyst view', w: 'Wall Street analysts’ average rating and 12-month price target.', r: 'Targets are often too optimistic on average. The spread between low and high targets shows how uncertain they are.' },
  { re: /^surprise$/, t: 'Earnings surprise', w: 'How much actual profit beat or missed what analysts expected.', r: 'Companies that beat tend to drift up for weeks afterward (post-earnings drift).',
    g: v => v > 0 ? G('good', 'Beat expectations') : v < 0 ? G('bad', 'Missed expectations') : G('ok', 'In line') },
  { re: /^(score|conf|confidence|consist\.|consistency)$/, t: 'Score', w: 'An AlphaLab composite: many signals combined into one number so names can be ranked.', r: 'It ranks, it does not predict a price. Always read the reasons behind it.' },
  { re: /^(verdict|status|signal|action|side)$/, t: 'Verdict', w: 'The conclusion AlphaLab reached from the checks. VALIDATED passed every test, MARGINAL passed most, REJECTED failed at least one.', r: 'A verdict is only as good as its tests: read which checks passed.' },
  { re: /^(cost|costs)$/, t: 'Trading cost', w: 'Commissions plus the bid-ask spread and market impact paid when trading.', r: 'Strategies that trade a lot can see their whole edge eaten by costs.' },
  { re: /^(crisis return|worst realized day in window)$/, t: 'Crisis return', w: 'How this did during a historical market crash window.', g: v => v >= 0 ? G('good', 'Held up or gained in the crisis') : v > -15 ? G('ok', 'Lost less than a typical crash') : G('bad', 'Hit hard in the crisis') },
  { re: /^(fall \(days\)|recovery \(days\)|total underwater)$/, t: 'Drawdown timing', w: 'Fall is how many days it took to hit bottom. Recovery is how many days to get back to the old high. Underwater is the whole time spent below the high.', r: 'Long recoveries test patience more than deep drops do.' },
  { re: /^(peak|now|last|last close|price)$/, t: 'Price', w: 'The latest closing price, or the high point before a drop.' },
  { re: /^(features|top features)$/, t: 'Features', w: 'The inputs a model looks at, such as past returns, volatility, or distance from a moving average.' },
  { re: /^(sleeve|role|bucket|category|class|strategy category|sector|universe)$/, t: 'Group', w: 'Which bucket this belongs to: asset class, sector, or strategy family.' },
  { re: /^(coverage \(actual data\)|history used|stale px.*|>6 outliers)$/, t: 'Data quality', w: 'How much real data backs the number, and whether prices look stale or have extreme jumps that may be errors.' },
  { re: /^turnover$/, t: 'Turnover', w: 'How much of the portfolio is traded, per year. 200% means the whole portfolio is replaced about twice a year.', r: 'Higher turnover means higher trading costs and taxes. Under 100% a year is low for an active strategy.' },
  { re: /^market cap$/, t: 'Market capitalization', w: 'The total value of all the company’s shares: share price times shares outstanding.', r: 'Above $200B is mega cap, $10B to $200B large, $2B to $10B mid, below $2B small. Smaller companies are usually more volatile.' },
  { re: /^price \/ book$/, t: 'Price to book', w: 'Share price divided by the accounting value of the company’s net assets per share.', r: 'Below 1 means you pay less than the balance sheet says it is worth. Asset-light tech firms often trade far above 5.' },
  { re: /^price \/ sales$/, t: 'Price to sales', w: 'Company value divided by a year of revenue. Useful when a company has no profits yet.', r: 'Under 2 is cheap for most industries. Above 10 needs very fast growth to justify.' },
  { re: /^debt \/ equity$/, t: 'Debt to equity', w: 'How much the company has borrowed compared with shareholders’ money.', r: 'Under 1 is conservative. Above 2 means heavy borrowing, which hurts when rates rise or sales fall.',
    g: v => { if (v > 20) v /= 100; return v < 0.5 ? G('good', 'Little debt') : v < 1.5 ? G('ok', 'Moderate debt') : G('warn', 'Heavily indebted'); } },
  { re: /^(estimate|actual)$/, t: 'Earnings estimate vs actual', w: 'Estimate is what analysts expected the company to earn per share. Actual is what it reported.', r: 'Beating the estimate usually moves the stock up, missing moves it down.' },
  { re: /^spy vs 200d sma$/, t: 'S&P 500 vs its 200-day average', w: 'How far the S&P 500 is above or below its average price over the last 200 trading days (about 10 months).',
    r: 'Above the average is the classic sign of a long-term uptrend. Below it, bear markets become more likely.', g: v => v >= 0 ? G('good', 'Market in a long-term uptrend') : G('warn', 'Market below its long-term trend') },
  { re: /^next-quarter range.*$/, t: 'Next-quarter range', w: 'A range of possible returns over the next 3 months, made by resampling this stock’s real past quarters.', r: 'It is the spread of outcomes history suggests, not a forecast.' },
  { re: /^(qty|shares|\$ amount)$/, t: 'Position size', w: 'How many shares, or how many dollars, are in the position.' },
  { re: /^basis$/, t: 'Cost basis', w: 'The average price you paid per share. Profit or loss is measured against it.' },
  { re: /^trend$/, t: 'Trend', w: 'Whether the price is above (up) or below (down) its moving averages.', r: 'Trends tend to persist for months, which is why momentum strategies work.' },
  { re: /^(\$ impact|portfolio impact|parallel shift.*)$/, t: 'Scenario impact', w: 'Estimated gain or loss on the current portfolio if the scenario happened.',
    g: v => v >= 0 ? G('good', 'Gains in this scenario') : G('warn', 'Loses in this scenario') },
  { re: /^(experiments filed|validated findings|dead ends recorded|factors in library)$/, t: 'Research counts', w: 'How much research the AI researcher has done: ideas tested, ideas that passed, and ideas that failed and were recorded so they are not repeated.' },
  { re: /^(firm revenue.*)$/, t: 'Fee revenue', w: 'Management fee (2% of assets a year) plus performance fee (20% of gains above the previous high).' },
  { re: /^(protect \/ add)$/, t: 'Protect or add', w: 'Whether the risk engine suggests trimming risk (protect) or has room to add.' },
  { re: /^(parameters)$/, t: 'Parameters', w: 'The settings of the strategy or model, such as the lookback window.', r: 'Fewer parameters means less room to overfit.' },
  { re: /^(gross exposure)$/, t: 'Gross exposure', w: 'Longs plus shorts as a share of capital. 150% means 1.5 dollars of positions per dollar of capital.' },
  { re: /^(1y vs cash.*)$/, t: 'Chance of beating cash', w: 'The share of simulated one-year paths (resampled from real history) where the portfolio beat Treasury bills.' },
];
// chart and panel titles
const CHARTS = [
  [/rolling .*vol/i, 'Rolling volatility', 'Volatility measured over a moving window. Spikes line up with market stress. Low and steady means a calmer asset.'],
  [/rolling .*beta/i, 'Rolling beta', 'How strongly this has moved with the market over time. A rising line means it is behaving more like the market.'],
  [/candles|^\W*price\b|indices & rates/i, 'Price chart', 'Each candle is one day: the body runs from open to close, the thin wick shows the high and low. Green closed up, red closed down.'],
  [/optimal weights|target portfolio|starter basket/i, 'Portfolio weights', 'How much of the money goes into each asset. The optimizer picks weights to balance return against risk.'],
  [/risk contribution/i, 'Risk contribution', 'How much of the total portfolio swing each position causes. A small position in a volatile stock can dominate risk.'],
  [/portfolio statistics|window statistics|performance metrics/i, 'Summary statistics', 'The headline numbers for this period. Hover any label for what it means and whether the value is good.'],
  [/decision factors/i, 'Decision factors', 'Each bar is one piece of evidence scored from -1 (bearish) to +1 (bullish). Longer green bars push toward buy, red toward sell.'],
  [/bull case|bear case|what would change/i, 'The argument', 'The strongest case for and against the stock. A good decision can answer the other side.'],
  [/fundamentals|earnings surprises|consensus/i, 'Company fundamentals', 'The business behind the stock: valuation, profitability, growth and what analysts expect. Hover each number for its meaning.'],
  [/significance by month|seasonality/i, 'Statistical significance', 'Bars beyond +2 or -2 are strong enough to be unlikely from luck. Most calendar patterns stay inside that band.'],
  [/data quality|dataset catalog|connected sources/i, 'Data sources', 'Where each series comes from and whether it passed quality checks (gaps, stale prices, extreme jumps).'],
  [/experiment|research log|findings|institutional memory|factor library|factor inspector|scan results/i, 'Research record', 'Every idea tested, what it scored and whether it survived. Failures are kept so they are not tried again.'],
  [/equity( curve)?|nav vs|portfolio vs benchmarks|fund nav|backtest|price,|indexed/i, 'Growth chart', 'Shows how $1 (or the price) grew over time. Steeper up is better. Flat or falling stretches are periods the strategy struggled.'],
  [/underwater|drawdown/i, 'Drawdown chart', 'Shows how far below its previous high the value was at each moment. 0 means at a new high. Deep and long dips are the painful periods.'],
  [/rolling.*sharpe|sharpe by calendar/i, 'Rolling Sharpe', 'Sharpe ratio measured over a moving window. It shows whether the edge is steady or came from one lucky stretch.'],
  [/monthly returns|average return by month|weekday/i, 'Calendar returns', 'Return for each month or weekday. Green is positive, red negative. Look for consistency, not one big month.'],
  [/correlation|network|coherence/i, 'Correlation view', 'Shows which assets move together. Bright or connected means they move together. Mixing unconnected assets lowers risk.'],
  [/distribution|histogram|residuals|logit/i, 'Distribution', 'How often each size of outcome happened. A wide spread means big swings. A long left tail means crash risk.'],
  [/yield curve/i, 'Yield curve', 'Interest rates for lending to the US government for different lengths of time. Normally longer loans pay more. An inverted curve has preceded most recessions.'],
  [/volatility|vix/i, 'Volatility chart', 'How much prices swing. Spikes line up with market stress.'],
  [/regime|p\(stress\)|state statistics|transition/i, 'Market regimes', 'A statistical model (hidden Markov) sorts history into calm and stressed states. Transition numbers are the chance of moving from one state to another.'],
  [/efficient frontier|risk vs return|factor map/i, 'Risk versus return', 'Each dot is an option. Up means more return, right means more risk. The best choices sit at the top-left edge.'],
  [/monte carlo|probability view/i, 'Simulation', 'Many possible futures made by resampling real past returns. The spread shows the range of outcomes, not a forecast of one.'],
  [/value-at-risk|var ladder|rate shock|crisis replay|scenario/i, 'Stress test', 'What the portfolio would lose in bad but plausible events, based on real history.'],
  [/factor (betas|loadings)|attribution|exposure/i, 'Factor exposures', 'Which broad forces (market, size, value, momentum, quality, low volatility) drive the returns, and how strongly.'],
  [/quintile|predicted vs realized|held-out predictions/i, 'Prediction check', 'Splits predictions into five buckets from most bearish to most bullish. A useful model shows returns rising from bucket 1 to 5.'],
  [/feature importance|what the twin looks at/i, 'Feature importance', 'Which inputs the model relies on most. It shows how much accuracy drops when each input is scrambled.'],
  [/loss curve/i, 'Training curve', 'Model error as it trains. Both lines should fall. If the held-out line rises while training falls, the model is memorizing.'],
  [/payoff|position delta/i, 'Option payoff', 'Profit or loss at different stock prices. The kink points are the strikes. The flat parts are where your loss or gain is capped.'],
  [/spread z-score|pair/i, 'Pairs spread', 'The gap between two related assets in standard deviations. Far above 0 bets on it shrinking, far below bets on it widening back.'],
  [/ffd/i, 'Fractional differencing', 'Removes the trend from a price series while keeping as much memory as possible, so models can learn from it.'],
  [/sector momentum|top movers|sector mix|asset-class mix/i, 'Market breadth', 'Which sectors or assets are leading and lagging right now.'],
  [/sentiment|news|attention|posts/i, 'Sentiment and attention', 'What news and investors are saying and how much they are talking. Useful context, weak signal on its own.'],
  [/validation gauntlet|out-of-sample skill|in-sample vs out-of-sample/i, 'Validation', 'Tests the strategy must pass before it is trusted: out-of-sample, higher costs, different parameters, and statistical significance.'],
];
EX.GLOSSARY = GL;

const norm = s => String(s || '').replace(/\s+/g, ' ').replace(/[−]/g, '-').replace(/\s*[?ⓘ]\s*$/, '').trim().toLowerCase();
const cache = new Map();
EX.lookup = function (label) {
  const k = norm(label); if (!k || k.length > 60) return null;
  if (cache.has(k)) return cache.get(k);
  let hit = GL.find(g => g.re.test(k)) || null;
  if (!hit) { const k2 = k.replace(/\s*\(.*\)\s*$/, '').trim(); if (k2 !== k) hit = GL.find(g => g.re.test(k2)) || null; }
  cache.set(k, hit); return hit;
};
EX.chartFor = function (title) {
  const k = String(title || ''); for (const [re, t, w] of CHARTS) if (re.test(k)) return { t, w };
  return null;
};
EX.grade = function (entry, valueText, label) {
  if (!entry || !entry.g) return null;
  if (/^[—\-–]$|n\/a|^$/.test(String(valueText).trim())) return null;
  const v = pick(valueText, label); if (v == null) return null;
  try { return entry.g(v, valueText); } catch (e) { return null; }
};

/* ---------- page guides ---------- */
const PAGES = {
  dashboard: ['A snapshot of the whole market today.', 'Tiles show key prices and their 1-day change. The regime monitor says whether markets are calm or stressed. The yield curve and credit spread are early warning signs for the economy. Click any tile to open its chart.'],
  markets: ['Every instrument in the dataset with its real historical statistics.', 'Click a column to sort. Sharpe tells you return per unit of risk, Max DD the worst drop. Click a row to chart it.'],
  chart: ['Price history for one instrument with its performance statistics.', 'Pick a window at the top. The numbers below describe that window only. Hover on the chart for exact values.'],
  datahub: ['Where the data comes from and how clean it is.', 'Every series lists its source, date range and quality checks. You can upload your own CSV and it becomes a normal instrument.'],
  researcher: ['An automated researcher that invents trading ideas and tests them.', 'Each experiment is a hypothesis run through the validation gauntlet. Validated findings are kept. Failures are recorded so they are not retried.'],
  strategies: ['The library of trading strategies, each tested on real history.', 'Sharpe and CAGR describe the past. The verdict tells you whether it passed out-of-sample, cost and robustness tests. Open one to see the full report.'],
  stratDetail: ['The full report for one strategy.', 'Start with the growth chart and drawdown, then the validation gauntlet. A strategy is only interesting if it passes out-of-sample and still works at higher costs. The ML twin at the bottom shows whether a machine-learning filter improves it.'],
  ensemble: ['Combines several strategies into one blended portfolio.', 'Blending strategies that do not move together lowers risk. Compare the blend Sharpe and drawdown with the single strategies.'],
  alpha: ['Automatically generated trading signals, filtered by how well they predicted.', 'IC measures prediction quality. Only signals with a steady positive IC across time survive.'],
  mllab: ['Machine-learning models trained to predict future returns, tested honestly.', 'Every prediction is made with only past data (walk-forward). Look at the out-of-sample IC and the quintile chart: a real model shows returns rising from the lowest to the highest bucket.'],
  portfolio: ['Builds an optimized portfolio from assets you choose.', 'Each method (risk parity, minimum variance and others) balances risk differently. The frontier chart shows the best return available for each level of risk.'],
  holdings: ['Your own portfolio valued at real closing prices.', 'P&L is your profit or loss. Beta shows how much you move with the market. Concentration (HHI) warns when a few names dominate.'],
  risk: ['What could go wrong with your portfolio.', 'Crisis replays apply real historical crashes to your current holdings. VaR is a bad-but-normal day. Monte Carlo shows the range of possible next years.'],
  reports: ['Every report generated so far.', 'Open one to read or print it.'],
  knowledge: ['Everything AlphaLab has learned, searchable.', 'Findings are validated results. Dead ends are ideas that failed, kept so nobody repeats them.'],
  advisor: ['Ranks stocks using seven factors and explains why.', 'Each pick comes with the factor evidence and a suggested weight. It ranks, it does not predict prices. The decision is yours.'],
  sentiment: ['What news and investors are saying about a stock.', 'Tone runs from negative to positive. Attention shows how much people are talking compared with normal. Big spikes often come with big moves.'],
  structure: ['A map of which stocks trade together.', 'Stocks close together on the map move alike. Colors are clusters found by the computer, often matching sectors.'],
  composer: ['Build your own strategy without code.', 'Pick a signal and rules from the dropdowns. It runs through the same validation tests as every built-in strategy.'],
  seasonality: ['Do certain months or weekdays tend to be better?', 'The t-stat tells you whether a pattern is strong enough to be real. Above 2 is the usual bar. Most calendar effects are not.'],
  drawdowns: ['Every major decline in history for one instrument.', 'Depth is how far it fell, Fall how long it took to bottom, Recovery how long to get back. Long recoveries are the real test of patience.'],
  firm: ['Run a fund through a hidden stretch of real history.', 'Allocate capital, advance week by week, and react to real events with the dates hidden. Fees and investor flows depend on your results.'],
  decision: ['One-screen buy, hold or sell verdict for a stock.', 'Each factor bar runs from -1 (bearish) to +1 (bullish). The verdict combines them. Read the bull and bear cases before acting.'],
  screener: ['Filter thousands of stocks by fundamentals.', 'P/E and PEG measure price, ROE and margin measure quality, growth measures momentum in the business. Combine filters to narrow the list.'],
  peers: ['Compare a stock with its closest rivals.', 'A stock that is cheaper than peers with similar quality may be undervalued. One that is pricier needs faster growth to justify it.'],
  command: ['Your competition command center.', 'Shows the best ideas where most engines agree, plus your portfolio against the competition rules.'],
  mlzoo: ['Every open-source machine-learning model built into AlphaLab.', 'Cards show where each model came from. Studio trains one live. Race compares them on real data. Twins shows whether an ML filter improves each strategy.'],
  quantstudio: ['Professional quant tools in one place.', 'GARCH forecasts volatility, HMM finds market regimes, Pairs finds assets that move together, Factors explains returns, Options prices contracts, Overfitting tests if results are luck.'],
  compdesk: ['Everything for the Wharton investment competition.', 'Countdown to each deadline, build your investment policy statement, score your portfolio against the client, log trades, and practice judge questions.'],
  guide: ['The plain-English manual.', 'Start here if you are new. Every term is explained and every module is mapped.'],
};
EX.PAGES = PAGES;

/* ---------- state ---------- */
const KEY = 'explain_mode';
EX.on = () => { try { const v = AL.store.get(KEY, null); return v == null ? true : !!v; } catch (e) { return true; } };
function setOn(v) { AL.store.set(KEY, !!v); document.body.classList.toggle('ex-on', !!v); const b = document.getElementById('ex-toggle'); if (b) b.classList.toggle('on', !!v); annotate(document.getElementById('workspace'), true); }

/* ---------- annotate DOM ---------- */
function valueNodeFor(labelEl, kind) {
  if (kind === 'metric') return labelEl.parentElement.querySelector('.m-value');
  if (kind === 'tile') return labelEl.closest('.tile').querySelector('.t-value');
  if (kind === 'kv') return labelEl.parentElement.querySelector('.v');
  return null;
}
function finalText(node) { return node ? (node.dataset.fxt || node.textContent) : ''; }
function addLine(labelEl, kind, entry) {
  const host = kind === 'metric' ? labelEl.parentElement : kind === 'tile' ? labelEl.closest('.tile') : labelEl.parentElement;
  if (!host || host.querySelector(':scope > .ex-line')) return;
  const vn = valueNodeFor(labelEl, kind);
  const gr = EX.grade(entry, finalText(vn), labelEl.textContent);
  const line = document.createElement('div');
  line.className = 'ex-line' + (gr ? ' ' + gr.tone : '');
  line.textContent = gr ? gr.text : shortWhat(entry);
  if (kind === 'kv') { host.classList.add('ex-kv'); }
  host.appendChild(line);
}
function shortWhat(e) { const s = e.w.split(/(?<=\.)\s/)[0]; return s.length > 90 ? s.slice(0, 88) + '...' : s; }

const SEL = [
  ['.metric > .m-label', 'metric'],
  ['.tile .t-label > span:first-child', 'tile'],
  ['.kv > .k', 'kv'],
  ['table th', 'th'],
  ['label.lbl', 'lbl'],
];
function annotate(root, refresh) {
  if (!root) return;
  if (refresh) root.querySelectorAll('.ex-line').forEach(n => n.remove());
  const on = EX.on();
  for (const [sel, kind] of SEL) root.querySelectorAll(sel).forEach(el => {
    let entry;
    if (el.dataset.ex == null) {
      entry = EX.lookup(el.textContent);
      el.dataset.ex = entry ? GL.indexOf(entry) : '-1';
      if (entry) { el.classList.add('ex-term'); el.dataset.exKind = kind; }
    } else entry = GL[+el.dataset.ex];
    if (entry && on && (kind === 'metric' || kind === 'kv' || kind === 'tile')) addLine(el, kind, entry);
  });
  root.querySelectorAll('.panel-head').forEach(h => {
    if (h.dataset.ex != null) return;
    const title = [...h.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join(' ').trim() || h.textContent.trim();
    const c = EX.chartFor(title); h.dataset.ex = c ? '1' : '0';
    if (!c) return;
    const i = document.createElement('span'); i.className = 'ex-i'; i.textContent = '?'; i.dataset.chart = c.t + '\u0001' + c.w;
    const right = h.querySelector('.right'); right ? h.insertBefore(i, right) : h.appendChild(i);
  });
}
EX.annotate = annotate;

/* ---------- page guide banner ---------- */
function pageGuide(ws) {
  const tab = UI.currentTab && UI.currentTab(); if (!tab || !ws) return;
  const p = PAGES[tab.module]; if (!p) return;
  const old = ws.querySelector(':scope > .ex-page'); if (old) old.remove();
  const closed = AL.store.get('ex_page_closed', {});
  const open = EX.on() && !closed[tab.module];
  const d = document.createElement('details'); d.className = 'ex-page'; if (open) d.open = true;
  d.innerHTML = `<summary><span class="ex-page-ico">i</span><b></b><span class="ex-page-hint">What this page tells you</span></summary><p></p><div class="ex-page-tip">Hover any <span class="ex-demo">underlined</span> label or the <span class="ex-i static">?</span> on a chart for a plain-English explanation.</div>`;
  d.querySelector('b').textContent = p[0];
  d.querySelector('p').textContent = p[1];
  d.addEventListener('toggle', () => { const c = AL.store.get('ex_page_closed', {}); c[tab.module] = !d.open; AL.store.set('ex_page_closed', c); });
  ws.insertBefore(d, ws.firstChild);
}

/* ---------- hover card ---------- */
let pop, hideT, showT;
function ensurePop() {
  if (pop) return pop;
  pop = document.createElement('div'); pop.id = 'ex-pop';
  pop.addEventListener('mouseenter', () => clearTimeout(hideT));
  pop.addEventListener('mouseleave', hide);
  document.body.appendChild(pop); return pop;
}
function hide() { clearTimeout(showT); hideT = setTimeout(() => pop && pop.classList.remove('show'), 120); }
function place(target) {
  const r = target.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight;
  let x = Math.min(Math.max(8, r.left), innerWidth - pw - 8), y = r.bottom + 8;
  if (y + ph > innerHeight - 8) y = Math.max(8, r.top - ph - 8);
  pop.style.left = x + 'px'; pop.style.top = y + 'px';
}
function columnValue(th, cell) {
  if (!cell) return null;
  return cell.textContent;
}
function showFor(target, cell) {
  ensurePop();
  let html = '';
  if (target.dataset.chart) {
    const [t, w] = target.dataset.chart.split('\u0001');
    html = `<div class="ex-t">${esc(t)}</div><div class="ex-w">${esc(w)}</div>`;
  } else {
    const e = GL[+target.dataset.ex]; if (!e) return;
    const kind = target.dataset.exKind;
    const vt = kind === 'th' ? columnValue(target, cell) : finalText(valueNodeFor(target, kind));
    const gr = vt != null ? EX.grade(e, vt, target.textContent) : null;
    html = `<div class="ex-t">${esc(e.t)}</div><div class="ex-w">${esc(e.w)}</div>` +
      (e.r ? `<div class="ex-r"><span>How to read it</span>${esc(e.r)}</div>` : '') +
      (gr ? `<div class="ex-v ${gr.tone}"><i></i><span>This value${vt ? ' (' + esc(String(vt).trim().slice(0, 24)) + ')' : ''}:</span> <b>${esc(gr.text)}</b></div>` : '');
  }
  pop.innerHTML = html;
  pop.classList.add('show'); place(target);
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function wireHover(ws) {
  ws.addEventListener('mouseover', ev => {
    const t = ev.target.closest('.ex-term, .ex-i');
    if (t) { clearTimeout(hideT); clearTimeout(showT); showT = setTimeout(() => showFor(t), 220); return; }
    // hovering a table cell explains its column with that cell's value
    const td = ev.target.closest('td');
    if (td && td.parentElement && td.closest('table')) {
      const table = td.closest('table'), idx = [...td.parentElement.children].indexOf(td);
      const hr = table.tHead && table.tHead.rows[0] || table.rows[0]; const th = hr && hr !== td.parentElement ? hr.cells[idx] : null;
      if (th && th.classList.contains('ex-term') && GL[+th.dataset.ex] && GL[+th.dataset.ex].g && EX.on()) {
        clearTimeout(hideT); clearTimeout(showT);
        showT = setTimeout(() => { showFor(th, td); place(td); }, 450); return;
      }
    }
  });
  ws.addEventListener('mouseout', ev => { if (ev.target.closest('.ex-term, .ex-i, td')) hide(); });
  ws.addEventListener('scroll', () => pop && pop.classList.remove('show'), true);
}

/* ---------- top bar toggle ---------- */
function toggleButton() {
  if (document.getElementById('ex-toggle')) return;
  const b = document.createElement('button');
  b.id = 'ex-toggle'; b.className = 'ex-toggle' + (EX.on() ? ' on' : '');
  b.title = 'Explain mode: plain-English meaning under every number, and a guide at the top of each page';
  b.innerHTML = '<span class="ex-sw"><i></i></span>Explain';
  b.addEventListener('click', () => { setOn(!EX.on()); pageGuide(document.getElementById('workspace')); FX && FX.toast && FX.toast(EX.on() ? 'Explain mode on. Every number now has a plain-English reading.' : 'Explain mode off. Hover any underlined label for its meaning.', 'info', { ms: 3200 }); });
  const asof = document.getElementById('asof');
  asof && asof.parentElement.insertBefore(b, asof);
}

/* ---------- wire in ---------- */
const boot0 = UI.boot;
UI.boot = function () {
  boot0.apply(this, arguments);
  document.body.classList.toggle('ex-on', EX.on());
  toggleButton();
  const ws = document.getElementById('workspace');
  wireHover(ws);
  let q = false;
  const skip = n => { const e = n.nodeType === 1 ? n : n.parentElement; return e && e.closest && e.closest('.m-value, .t-value, .ex-line, .ch-clock, #ex-pop'); };
  const mo = new MutationObserver(recs => { if (q || recs.every(r => skip(r.target))) return; q = true; requestAnimationFrame(() => { q = false; annotate(ws); }); });
  mo.observe(ws, { childList: true, subtree: true });
  pageGuide(ws); annotate(ws);
  // lines depend on final values; re-grade once count-up animations settle
  setTimeout(() => annotate(ws, true), 900);
};
const render0 = UI.renderActive;
let lastMod = null;
UI.renderActive = function () {
  render0.apply(this, arguments);
  const ws = document.getElementById('workspace'), tab = UI.currentTab();
  if (pop) pop.classList.remove('show');
  pageGuide(ws); annotate(ws);
  const m = tab && tab.module;
  if (m !== lastMod) { lastMod = m; setTimeout(() => annotate(ws, true), 900); }
};
UI.explain = EX;
})();
