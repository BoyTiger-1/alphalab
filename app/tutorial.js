/* Interactive guided tutorial: a spotlight tour that drives the real app,
   opening real modules and pointing at real controls, one step at a time.
   Not a video, not static text: it navigates AlphaLab for you. */
'use strict';
(function () {
  const TOUR = [
    { module: null, title: 'Welcome to the full tour',
      body: 'This walks you through every page in AlphaLab using the real app, not a slideshow. It follows the left menu top to bottom, grouped the way the app is: the market overview, the advisory tools, the autonomous research engines, the quant toolkit, the firm simulator, and your portfolio. About two dozen stops. Leave any time with Skip, and reopen this from the guide. Press Next to begin.',
      spot: null },

    // ---- Research OS ----
    { module: 'dashboard', title: 'Command Center', group: 'The market at a glance',
      body: 'Home base. The tiles are live prices, the panel on the left reads the current market regime (calm or stressed, from a hidden Markov model on real S&P returns), and the rest shows the yield curve, sector momentum, cross-asset correlations, and volatility. Drag any panel by its handle to rearrange; your layout is saved.',
      spot: '#dash-tiles' },
    { module: 'markets', title: 'Markets', group: 'The market at a glance',
      body: 'A screener over every instrument in the platform: 4,400+ stocks plus ETFs, futures, FX, crypto, and macro series, each with real return, volatility, Sharpe, and drawdown stats. Type here to search by ticker, name, or sector. Click any row to open its chart.',
      spot: '#mkt-q', wait: 300 },
    { module: 'datahub', title: 'Data Hub', group: 'The market at a glance',
      body: 'Every dataset in one place, with a data-quality audit. You can also drop your own CSV here, any file with a date column and a price column, and it is cleaned, validated, and becomes a first-class instrument usable across every module.',
      spot: '#dz', wait: 300 },

    // ---- Advisory ----
    { module: 'decision', title: 'Buy / Sell Decision', group: 'Should I buy this?',
      body: 'The fastest way to judge one stock. Type any ticker and it fuses eight technical factors, real fundamentals, Wall Street analyst targets, earnings surprises, news headlines, and investor posts into a single BUY, HOLD, or SELL, with a bull case and a bear case. Everything is a real number you can cite.',
      spot: '#dc-body', wait: 450 },
    { module: 'decision', title: 'Reading the factor bars', group: 'Should I buy this?',
      body: 'Each bar is a real input scored from bearish on the left to bullish on the right: technicals, analyst upside, quality, growth, valuation, sentiment. A missing bar just means that data was not available for the name. This is the reasoning laid bare, not a black box.',
      spot: '#dc-pillars', wait: 400 },
    { module: 'advisor', title: 'Stock Advisor', group: 'Should I buy this?',
      body: 'Ranks every listed US stock, over 4,400 names, on twelve factors and sorts them best first. Use the sector filter and search to narrow it, and read the starter basket on the right, which caps two names per sector so you stay diversified. Click any row for the full reasoning.',
      spot: '#ad-body', wait: 500 },
    { module: 'screener', title: 'Screener', group: 'Should I buy this?',
      body: 'Filter thousands of stocks by real fundamentals: cheap and profitable value names, high growth, quality compounders, dividend payers, growth at a reasonable price, or analyst upside. Pick a preset and click any result to open its full decision.',
      spot: '.controls', wait: 300 },
    { module: 'peers', title: 'Peer Comparison', group: 'Should I buy this?',
      body: 'Line a stock up against its closest sector rivals on valuation and quality. The best value in each row is highlighted, so you can see at a glance whether a stock is genuinely cheap or just cheap-looking. This is exactly how analysts sanity-check a valuation.',
      spot: '#pr-body', wait: 400 },
    { module: 'sentiment', title: 'Sentiment & News', group: 'Should I buy this?',
      body: 'Real alternative data per stock: worldwide news tone and coverage volume from GDELT, investor sentiment from StockTwits, and public attention from Wikipedia pageviews. Refresh live from your browser any time. Extreme crowd bullishness is often a contrarian warning, not a green light.',
      spot: '#sn-tone', wait: 450 },

    // ---- Autonomous Research ----
    { module: 'researcher', title: 'AI Researcher', group: 'Autonomous research',
      body: 'An agent that invents trading hypotheses, backtests them on real history, runs each through a five-stage validation gauntlet, and files every result, including the failures, into a knowledge base so it never repeats a dead end. Press this button to set it running and watch the live feed.',
      spot: '#res-toggle', wait: 350 },
    { module: 'strategies', title: 'Strategy Lab', group: 'Autonomous research',
      body: '118 institutional strategies across trend, momentum, pairs arbitrage, volatility, factor investing, macro, seasonality, crypto, and machine learning. Open any one to backtest it with honest costs, run the validation gauntlet, and generate a research report. Click a row to dive in.',
      spot: '#st-tbl', wait: 350 },
    { module: 'ensemble', title: 'Ensemble Engine', group: 'Autonomous research',
      body: 'Makes strategies compete over the recent past, scores them on Sharpe, regime fit, and confidence, then blends the top uncorrelated winners into one portfolio at inverse-volatility weights. Press Run to hold the competition.',
      spot: '#lb-run', wait: 300 },
    { module: 'alpha', title: 'Alpha Factory', group: 'Autonomous research',
      body: 'Machine-generates candidate trading signals from a transformation grammar, then gauntlets each on information coefficient, out-of-sample stability, decay, and redundancy. Only survivors join the factor library. Press the scan button to generate a fresh batch.',
      spot: '#af-scan', wait: 300 },
    { module: 'mllab', title: 'ML Lab', group: 'Autonomous research',
      body: 'Trains machine-learning price models, ridge, logistic, gradient-boosted trees, k-nearest-neighbors, and a neural net, entirely in your browser, always walk-forward so predictions are honestly out-of-sample. It reports information coefficient, hit rate, and feature importance. Pick a target and model, then train.',
      spot: '#ml-run', wait: 300 },

    // ---- Quant Toolkit ----
    { module: 'structure', title: 'Market Structure', group: 'Quant toolkit',
      body: 'A PCA map of the whole index with clustering: it shows which stocks actually trade together regardless of their official sector. Tight clumps move as a block; outliers are the genuine diversifiers. Press Map the market to build it.',
      spot: '#ms-run', wait: 300 },
    { module: 'composer', title: 'Strategy Composer', group: 'Quant toolkit',
      body: 'Build your own strategy from dropdowns, no code. Pick an instrument and a signal engine, set the parameters, and it runs the exact same validation pipeline the built-in library uses. Compose, test, reject, iterate.',
      spot: '.controls', wait: 300 },
    { module: 'seasonality', title: 'Seasonality', group: 'Quant toolkit',
      body: 'Average returns by calendar month and weekday across the full history, with t-statistics. A pattern is only worth trading when it clears the significance bar AND has an economic story. This tool separates the real effects from the noise.',
      spot: '#se-mo', wait: 350 },
    { module: 'drawdowns', title: 'Drawdown Analyzer', group: 'Quant toolkit',
      body: 'Every major decline in a stock has happened: how deep it went, how long the fall took, and how long recovery took. Recovery time is the number investors underestimate most. This is the pain schedule you sign up for when you own something.',
      spot: '#dd-uw', wait: 400 },

    // ---- Portfolio & Risk ----
    { module: 'portfolio', title: 'Portfolio Builder', group: 'Build and protect',
      body: 'Pick a set of assets and choose an optimizer: equal risk contribution, hierarchical risk parity, minimum variance, maximum Sharpe, Kelly, or Black-Litterman. It shows the optimal weights, risk contributions, an efficient frontier, and a ten-year backtest.',
      spot: '.controls', wait: 350 },
    { module: 'holdings', title: 'My Holdings', group: 'Build and protect',
      body: 'Tracks your positions at real closing prices with profit and loss, factor betas, and concentration. Press Competition mode for $100,000 of virtual cash for contests like Wharton. The AI review flags concentration and regime risk, and Strategy report writes a full document you can print.',
      spot: '.section-title', wait: 350 },
    { module: 'risk', title: 'Risk Lab', group: 'Build and protect',
      body: 'Replays your exact portfolio through real crashes, 2008, COVID, the dot-com bust, Black Monday, and shows the dollar loss you would have taken, plus a Monte Carlo of one-year outcomes and a value-at-risk ladder. If a number scares you, diversify more.',
      spot: '.section-title', wait: 400 },

    // ---- Firm ----
    { module: 'firm', title: 'Firm Simulator', group: 'Run a fund',
      body: 'The capstone. Manage a fund through a hidden three-year window of real history, advancing week by week, while three AI analysts, macro, quant, and risk, debate your allocations and real crises hit on schedule. You collect fees, keep investors from redeeming, and get graded at the end.',
      spot: '.section-title', wait: 400 },

    // ---- Knowledge ----
    { module: 'reports', title: 'Reports', group: 'Knowledge',
      body: 'Every research report and strategy document you generate lands here, and you can print any of them to PDF for a competition submission or a class assignment.',
      spot: '.section-title', wait: 300 },
    { module: 'knowledge', title: 'Knowledge Base', group: 'Knowledge',
      body: 'The platform’s institutional memory: every validated finding and every dead end the researcher has filed, searchable, so your research compounds instead of looping.',
      spot: '.tiles', wait: 300 },

    { module: 'guide', title: 'You are ready', group: 'Finish',
      body: 'That is the whole platform. The written guide here defines every number in plain English, has a competition playbook, and shows how to defend your picks to judges. Press Finish, then start with the Buy / Sell Decision on a stock you are curious about.',
      spot: null, wait: 400 },
  ];

  let idx = 0;
  let overlay, spotEl, card;

  function build() {
    overlay = document.createElement('div');
    overlay.id = 'tour-overlay';
    overlay.innerHTML = `
      <div id="tour-spot"></div>
      <div id="tour-card">
        <div id="tour-step"></div>
        <div id="tour-title"></div>
        <div id="tour-body"></div>
        <div id="tour-nav">
          <button class="btn small" id="tour-skip">Skip tour</button>
          <span style="flex:1"></span>
          <button class="btn small" id="tour-prev">Back</button>
          <button class="btn primary small" id="tour-next">Next</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    spotEl = overlay.querySelector('#tour-spot');
    card = overlay.querySelector('#tour-card');
    overlay.querySelector('#tour-skip').addEventListener('click', end);
    overlay.querySelector('#tour-prev').addEventListener('click', () => go(idx - 1));
    overlay.querySelector('#tour-next').addEventListener('click', () => idx >= TOUR.length - 1 ? end() : go(idx + 1));
    document.addEventListener('keydown', keyNav);
  }
  function keyNav(e) {
    if (!overlay) return;
    if (e.key === 'Escape') end();
    if (e.key === 'ArrowRight') idx >= TOUR.length - 1 ? end() : go(idx + 1);
    if (e.key === 'ArrowLeft') go(idx - 1);
  }

  function go(i) {
    idx = Math.max(0, Math.min(TOUR.length - 1, i));
    const step = TOUR[idx];
    // open the target module in the real app first
    if (step.module && (!UI.currentTab() || UI.currentTab().module !== step.module)) {
      UI.focusModule(step.module);
    }
    setTimeout(() => paint(step), step.wait || 60);
  }

  function paint(step) {
    if (!overlay) return;
    overlay.querySelector('#tour-step').textContent = `Step ${idx + 1} of ${TOUR.length}${step.group ? ' · ' + step.group : ''}`;
    overlay.querySelector('#tour-title').textContent = step.title;
    overlay.querySelector('#tour-body').textContent = step.body;
    overlay.querySelector('#tour-prev').style.visibility = idx === 0 ? 'hidden' : 'visible';
    overlay.querySelector('#tour-next').textContent = idx >= TOUR.length - 1 ? 'Finish' : 'Next';
    // position the spotlight over the target element, or center the card if none
    const target = step.spot ? document.querySelector(step.spot) : null;
    if (target) {
      const r = target.getBoundingClientRect();
      const pad = 6;
      spotEl.style.display = 'block';
      spotEl.style.left = (r.left - pad) + 'px';
      spotEl.style.top = (r.top - pad) + 'px';
      spotEl.style.width = (r.width + pad * 2) + 'px';
      spotEl.style.height = (Math.min(r.height, window.innerHeight - r.top - 20) + pad * 2) + 'px';
      // place the card near the spot but on-screen
      const below = r.bottom + 220 < window.innerHeight;
      card.style.left = Math.min(Math.max(r.left, 20), window.innerWidth - 440) + 'px';
      card.style.top = (below ? r.bottom + 14 : Math.max(r.top - 210, 20)) + 'px';
      card.style.transform = 'none';
    } else {
      spotEl.style.display = 'none';
      card.style.left = '50%';
      card.style.top = '50%';
      card.style.transform = 'translate(-50%, -50%)';
    }
  }

  function end() {
    document.removeEventListener('keydown', keyNav);
    if (overlay) overlay.remove();
    overlay = null;
    AL.store.set('tour_done', true);
  }

  UI.startTour = function () {
    if (overlay) return;
    build();
    idx = 0;
    go(0);
  };
})();
