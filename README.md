# AlphaLab — Autonomous Quantitative Research OS

**A Bloomberg-terminal-style quant research platform that runs entirely in your browser, on real market data. One HTML file. No server, no API keys, no install.**

<p>
  <a href="https://boytiger-1.github.io/alphalab/"><b>▶ Launch AlphaLab</b></a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#terminal-commands">Terminal commands</a> ·
  <a href="#the-modules">Modules</a> ·
  <a href="#strategy-catalog">Strategy catalog</a> ·
  <a href="#rebuilding-with-fresh-data">Refresh data</a> ·
  <a href="#faq--troubleshooting">FAQ</a>
</p>

![Command Center](docs/screenshots/command-center.png)

## What it is

AlphaLab does the work of a quantitative research team in a single self-contained page:

- **118 strategy research modules** — trend, momentum, stat-arb pairs, relative value, volatility, factor investing, macro/regime, seasonality, crypto, machine learning, portfolio allocation — each independently configurable and backtestable
- **An autonomous AI researcher** that generates hypotheses, backtests them, validates them through a 5-stage statistical gauntlet, and files every result (including failures) into a persistent knowledge base so it never repeats a dead end
- **An alpha discovery engine** that composes candidate factors from a transformation grammar and admits only those that survive IC testing, out-of-sample checks, and redundancy filters
- **An ML lab** (ridge, logistic, gradient-boosted stumps, k-NN, MLP) trained walk-forward in-browser in seconds
- **Portfolio optimizers** — Equal Risk Contribution, Hierarchical Risk Parity, minimum variance, max Sharpe, half-Kelly, Black-Litterman — with efficient frontiers and 10-year backtests
- **A risk laboratory** — crisis replay on *actual* historical windows (2008, COVID, 2022, dot-com, Black Monday 1987), Monte Carlo on your real book, VaR/CVaR ladders, empirical rate-shock betas
- **Institutional report generation** — every strategy produces a methodology-to-conclusion research report, exportable to PDF

**All of it computes live on real data**: 78 instruments with daily history back to 2000 (S&P 500 back to 1970) from Yahoo Finance, 22 macro/rates series from FRED, and 8 crypto pairs from Coinbase, bundled into the file as an offline snapshot. The as-of date is always shown in the top bar.

## Quick start

1. **Open https://boytiger-1.github.io/alphalab/** (or download [`dist/alphalab.html`](dist/alphalab.html) and double-click it — it works offline).
2. **Press `Ctrl+K`** and type `CHART NVDA`. Then try `STRESS 2008`.
3. On the dashboard, click **▶ Start Autonomous Research** and watch the researcher work through hypotheses in the live feed.
4. Open **Strategy Lab** → click any strategy → **Run backtest + gauntlet** → **Generate research report**.
5. Open **My Holdings**, replace the demo positions with yours (**+ Add position**), then run the **AI portfolio review** and visit **Risk Lab** to stress-test your actual book.

Everything you do — experiments, holdings, reports, dashboard layout, factor library — persists in your browser's localStorage. Nothing ever leaves your machine.

## Terminal commands

Press `Ctrl+K` anywhere, or type into the amber command box in the top bar.

| Command | What it does |
|---|---|
| `CHART <sym>` | Open a chart workspace — candles/line, log scale, drawdown, rolling vol & beta, return distribution. Any bundled symbol works: `CHART BTC-USD`, `CHART ^VIX`, `CHART CL=F` |
| `COMPARE <a> <b> [c] [d]` | Indexed comparison chart (100 = window start) |
| `BT <id>` | Open a strategy's backtest workbench, e.g. `BT S001` |
| `RESEARCH START` / `RESEARCH STOP` | Engage / pause the autonomous researcher |
| `FACTOR SCAN` | Generate and gauntlet-test 25 candidate alpha factors |
| `STRESS <scenario>` | Crisis replay: `2008`, `COVID`, `2022`, `DOTCOM`, `1987` |
| `GO <module>` | Jump to a module: `DASH`, `MARKETS`, `DATA`, `AI`, `ALPHA`, `STRAT`, `ML`, `PORT`, `HOLD`, `RISK`, `REPORTS`, `KB` |
| *(any symbol)* | Typing a known symbol charts it directly |

Deep links also work: `…/alphalab.html#risk`, `#strat=S035`, `#chart=GLD`.

## The modules

| Module | What you do there |
|---|---|
| **Command Center** | Market overview: regime monitor (2-state Gaussian HMM fit live on S&P returns), real yield curve, sector momentum, cross-asset correlations, VIX vs realized vol. Drag panels (⠿) to customize; layout persists |
| **Markets** | Sortable screener of every instrument with real 1D/1M/YTD returns, vol, Sharpe, max drawdown |
| **Data Hub** | Dataset catalog, data-quality audit, and **CSV upload** — any date+value CSV is cleaned, validated, and becomes a first-class instrument in every module |
| **AI Researcher** | The autonomous loop: live pipeline stages, searchable experiment database, per-experiment metrics |
| **Strategy Lab** | The 118-module library. Open → edit parameters → backtest → validation gauntlet → research report |
| **Ensemble Engine** | Runs a 24-strategy competition on the trailing 3 years, scores Sharpe / regime fit / confidence, and builds an inverse-vol blend of uncorrelated winners |
| **Alpha Factory** | Factor generation grammar (~450 unique specs) + IC gauntlet + persistent factor library with redundancy filtering |
| **ML Lab** | Walk-forward model training with IC, hit rate, quintile analysis, permutation feature importance |
| **Portfolio Builder** | Asset selection → 7 optimizers → weights, risk contributions, efficient frontier, 10y backtest |
| **My Holdings** | Your real positions valued at real closes: P&L, factor betas, concentration (HHI), benchmark comparison, tax-loss-harvest candidates, AI review with statistical justification |
| **Risk Lab** | Crisis replay, 2,000-path block-bootstrap Monte Carlo, VaR ladder, rate-shock sensitivities, custom macro scenarios |
| **Reports** | All generated research documents; print to PDF |
| **Knowledge Base** | Institutional memory: every validated finding and every dead end, searchable, with verdicts grouped by market regime |

![Strategy workbench](docs/screenshots/strategy-workbench.png)

## How validation works (read this before trusting a backtest)

Every backtest applies a **1-day signal lag** (decide on tonight's close, trade tomorrow) and **linear transaction costs** per unit of turnover. A strategy is marked **VALIDATED** only if it passes *all five* gauntlet checks:

1. **Out-of-sample consistency** — positive Sharpe on the final 30% of history it was never tuned on
2. **Probabilistic Sharpe Ratio > 85%** — the skew/kurtosis-adjusted probability that true Sharpe exceeds zero (Bailey & López de Prado)
3. **Cost stress** — still profitable at 3× assumed transaction costs
4. **Parameter stability** — median Sharpe across ±20% parameter perturbations stays meaningful
5. **Sub-period consistency** — positive Sharpe in most calendar years

Most strategies get **REJECTED**. That's the platform working as intended — e.g. the Visa/Mastercard pairs module finds genuine cointegration (Engle-Granger ADF ≈ −4.3) yet still fails net of costs, which is the honest answer.

![Risk Lab — 2008 crisis replay](docs/screenshots/risk-lab.png)

## Strategy catalog

| Category | Count | Examples |
|---|---|---|
| Trend Following | 12 | Golden Cross, Donchian breakouts (gold, crude, natgas), multi-asset managed futures, FX trend |
| Momentum | 12 | 12-1 time-series momentum, Jegadeesh-Titman cross-sectional, dual momentum (GEM), sector rotation |
| Mean Reversion | 10 | RSI(2), Bollinger reversion, VIX-spike contrarian, weekly reversal |
| Stat Arb / Pairs | 10 | V/MA, JPM/BAC, XOM/CVX, gold/silver — with live Engle-Granger cointegration diagnostics |
| Relative Value | 7 | Small/large spread, HY/IG credit RV, defensives vs cyclicals |
| Volatility | 8 | Vol targeting, variance-risk-premium harvest, HMM regime switching |
| Factor Investing | 8 | Momentum/quality/min-vol tilts, value-growth spread, multi-factor ERC blend |
| Macro / Regime | 10 | Yield-curve recession guard, credit-spread switch, Fed cycle, dollar regime for EM |
| Carry / Seasonality | 7 | Turn-of-month, Halloween effect, natgas winter seasonal, bond carry |
| Crypto | 8 | BTC trend/momentum/vol-targeting, ETH/BTC ratio, cross-sectional crypto momentum |
| Machine Learning | 8 | Ridge, logistic, boosted stumps, k-NN, MLP, ensemble vote — all walk-forward |
| Allocation | 6 | 60/40, Permanent Portfolio, All-Weather, ERC, HRP, min-variance |
| Event-Driven & Alt-Data | 12 | Merger arb, PEAD, insider momentum, satellite imagery… **documented but deliberately inactive** — they need external datasets that can't be honestly simulated; connect one via the Data Hub to activate |

![ML Lab](docs/screenshots/ml-lab.png)

## Rebuilding with fresh data

The bundled snapshot is static (its date is in the top bar). A GitHub Action ([refresh-data.yml](.github/workflows/refresh-data.yml)) refreshes it on weekday mornings and redeploys the site automatically — or run it locally:

```bash
python tools/download_data.py        # Yahoo + FRED + Coinbase → data/raw/  (stdlib + curl only)
python tools/download_data_meta.py   # instrument metadata
python tools/build_bundle.py         # → data/bundle.js  (integer-scaled, ~4.3 MB)
python tools/assemble.py             # → dist/alphalab.html  (the whole app, one file)
node tools/smoke.js                  # 24-check test suite against the real bundle
```

## Architecture

```
app/
  core.js        data access layer, CSV ingestion, persistence, formatting
  quant.js       stats, performance analytics (Sharpe/Sortino/VaR/CVaR/PSR…),
                 backtester, HMM regime model, optimizers (ERC/HRP/BL/frontier), Monte Carlo
  charts.js      canvas chart library (candles, lines, heatmaps, fans) with crosshair tooltips
  strategies.js  signal engines + backtest runner + validation gauntlet
  registry.js    the 118 strategy definitions
  factors.js     alpha discovery grammar + IC gauntlet + factor library
  ml.js          in-browser models, walk-forward engine, permutation importance
  researcher.js  autonomous hypothesis loop + research database + report builder
  modules_*.js   the 15 UI workspaces
data/bundle.js   the real-data snapshot (one shared trading calendar, integer-scaled prices)
tools/           downloader · bundler · assembler · smoke tests
```

No frameworks, no dependencies, no network calls at runtime. The assembler concatenates everything into `dist/alphalab.html`.

## FAQ / troubleshooting

**Is the data real?** Yes — every price, yield, and macro print is downloaded history from Yahoo Finance, FRED, and Coinbase. Nothing is simulated. The trade-off: it's a snapshot, not a live feed (see the as-of date in the top bar).

**Why did my strategy get REJECTED?** Because it failed at least one gauntlet check — usually out-of-sample decay or cost stress. Open the Validation Gauntlet panel on the strategy page to see exactly which one. This is a feature.

**Where is my work saved?** In your browser's localStorage, keyed per site origin. Clearing site data wipes the knowledge base (there's also a "Wipe knowledge base" button in the Knowledge Base module).

**The page is slow to load the first time.** It's a 4.6 MB file (26 years × 108 series of data). After the first visit it's cached.

**Can it trade for me?** No, by design. AlphaLab produces research with confidence intervals; execution decisions stay with you.

**A backtest number looks too good.** Suspect it. Check turnover (costs scale with it), the OOS column, and the PSR. If it still looks too good, open an issue — leakage bugs are the most valuable ones to report.

## Disclaimer

Research software for educational and analytical use. Backtests are historical estimates subject to sampling error, survivorship effects, and cost-model simplification. Nothing here is investment advice.

## License

[MIT](LICENSE)
