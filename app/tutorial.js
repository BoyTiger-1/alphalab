/* Interactive guided tutorial: a spotlight tour that drives the real app,
   opening real modules and pointing at real controls, one step at a time.
   Not a video, not static text: it navigates AlphaLab for you. */
'use strict';
(function () {
  const TOUR = [
    { module: null, title: 'Welcome to AlphaLab', group: 'Getting started',
      body: 'This tour drives the real app for you and explains not just what each page does, but why it matters and how to read the numbers on it. It follows the left menu top to bottom. It is long on purpose, about thirty short stops, because it teaches the whole workflow. Use Back and Next to move, Skip to leave, and reopen it any time from the guide or with the TOUR command. Press Next.',
      spot: null },
    { module: null, title: 'First idea: everything here is real', group: 'Getting started',
      body: 'AlphaLab is not a toy with made-up numbers. It carries 26 years of real daily prices, weekly history for every one of the roughly 4,400 US stocks, real company fundamentals for about 900 large-caps, real Wall Street analyst targets, real news headlines, and real investor posts. When it says a stock is up 17% or that analysts see 20% upside, those are facts pulled from the market, not guesses. That is what makes the research trustworthy.',
      spot: null },
    { module: null, title: 'Second idea: it advises, it never trades', group: 'Getting started',
      body: 'AlphaLab gives you research: rankings, scores, and BUY / HOLD / SELL calls with the reasoning spelled out. It never places a trade and never touches real money. Think of it as an analyst that shows all of its work so you can agree or disagree. Every strong claim is a number you can point to, which is exactly what wins a competition or convinces a teacher.',
      spot: null },

    // ---- Research OS ----
    { module: 'dashboard', title: 'Command Center', group: 'The market at a glance',
      body: 'Home base. The tiles across the top are live prices for the big benchmarks. The panel on the left reads the current market regime, calm or stressed, using a statistical model on real S&P 500 returns. Below and to the right are the yield curve, sector momentum, cross-asset correlations, and the volatility gauge. In short, this one screen tells you what kind of market you are in today.',
      spot: '#dash-tiles' },
    { module: 'dashboard', title: 'What "regime" means and why it matters', group: 'The market at a glance',
      body: 'A regime is the market\'s mood. In a calm, rising market, aggressive stocks tend to do well; in a stressed, falling market, defensive stocks and cash protect you. AlphaLab detects the regime from real data and uses it throughout: the Advisor and the Decision engine tilt their scoring toward aggressive or defensive names depending on what this panel says. Glance here first, before you make any decision.',
      spot: '.panel', wait: 200 },
    { module: 'markets', title: 'Markets', group: 'The market at a glance',
      body: 'A searchable table of every instrument on the platform: 4,400+ stocks plus ETFs, futures, currencies, crypto, and economic series. Each row shows real one-day, one-month, and year-to-date returns, plus volatility, Sharpe ratio, and worst drawdown. Type in this box to find anything by ticker, company name, or sector. Click any row to open its full chart. This is your directory to the whole universe.',
      spot: '#mkt-q', wait: 300 },
    { module: 'datahub', title: 'Data Hub', group: 'The market at a glance',
      body: 'Every dataset in one place, with a one-click data-quality audit that checks for stale prices and outliers. You can also bring your own data: drop a CSV here with a date column and a price column, and AlphaLab cleans it, validates it, and turns it into a first-class instrument you can chart, backtest, and add to a portfolio like any other. Useful if your competition hands you a custom dataset.',
      spot: '#dz', wait: 300 },

    // ---- Advisory: the core "should I buy this?" flow ----
    { module: 'decision', title: 'The Buy / Sell Decision engine', group: 'Should I buy this stock?',
      body: 'This is the single most useful page for a beginner and the heart of the platform. Type any ticker in the box at the top and press Analyze, and AlphaLab pulls together six kinds of real evidence about that one stock and boils it down to a single call. The next few steps walk through each piece so you know exactly what you are looking at. We are on Apple by default.',
      spot: '#dc-body', wait: 450 },
    { module: 'decision', title: 'The call and the composite score', group: 'Should I buy this stock?',
      body: 'Top right is the verdict: BUY, HOLD, or SELL, with a composite score from about -1 (very bearish) to +1 (very bullish). Above roughly +0.22 it reads BUY, below -0.22 SELL, and in between HOLD. Next to it sits the current price and, when available, the average analyst price target with the percentage upside or downside. The call is a starting point for your own judgment, not an order.',
      spot: '#dc-body', wait: 200 },
    { module: 'decision', title: 'The factor bars: the reasoning', group: 'Should I buy this stock?',
      body: 'These bars are the six ingredients behind the call, each scored from bearish on the left to bullish on the right. Technical is the price-trend read (weighted most, 28%), Analyst is Wall Street\'s view (20%), then Quality, Growth, and Value (14% each) come from the company\'s financials, and Sentiment (10%) from news and social. A missing bar means that data was not available. This is the whole logic, in the open.',
      spot: '#dc-pillars', wait: 300 },
    { module: 'decision', title: 'The fundamentals: is the business healthy?', group: 'Should I buy this stock?',
      body: 'Real company financials from Yahoo Finance. P/E is price divided by earnings, how many dollars you pay per dollar of profit; lower is cheaper. Revenue growth shows if sales are rising. Net margin is the share of sales kept as profit. Return on equity measures how well the company turns shareholder money into profit. Debt/equity flags leverage. Together these tell you whether you are buying a strong, growing business or a shaky one.',
      spot: '#dc-fund', wait: 300 },
    { module: 'decision', title: 'The analysts: what the pros think', group: 'Should I buy this stock?',
      body: 'This panel shows the real Wall Street consensus: how many analysts rate the stock strong buy, buy, hold, sell, or strong sell, and their low, average, and high price targets. The implied upside is how far the average target sits above today\'s price. Analysts are often too optimistic, so treat this as one input, but a wide gap between price and target, plus a buy consensus, is a genuine positive.',
      spot: '#dc-analyst', wait: 300 },
    { module: 'decision', title: 'News and investor posts', group: 'Should I buy this stock?',
      body: 'Real headlines from GDELT and real posts from StockTwits, the actual words people are saying about this stock right now. Press "Fetch latest headlines" to pull fresh news live. One caution the app repeats: when the crowd is euphorically bullish, that is often a contrarian warning, not a green light. Sentiment is the lightest-weighted factor for exactly this reason. Scroll the decision page to see the bull case, bear case, and earnings history too.',
      spot: '#dc-news', wait: 300 },
    { module: 'advisor', title: 'Stock Advisor: rank the whole market', group: 'Should I buy this stock?',
      body: 'The Decision engine judges one stock; the Advisor judges all 4,400 at once. It scores every listed US stock on twelve factors, the same six pillars you just saw plus finer technical measures, and sorts them best first. Use the sector filter and search to narrow the list. On the right is a ready-made starter basket that caps two names per sector so you stay diversified. Click any row for its full reasoning.',
      spot: '#ad-body', wait: 550 },
    { module: 'screener', title: 'Screener: find a specific kind of stock', group: 'Should I buy this stock?',
      body: 'When you have a style in mind, the Screener filters the universe by real fundamentals. The presets across the top are real investing strategies: value (cheap and profitable), high growth, quality compounders, dividend payers, GARP (growth at a reasonable price), and analyst upside. Pick one and you get a ranked table; click any result to open its full decision. This is how professionals build a shortlist.',
      spot: '.controls', wait: 300 },
    { module: 'peers', title: 'Peer Comparison: cheap or expensive?', group: 'Should I buy this stock?',
      body: 'A single P/E means little on its own; what matters is how a stock compares to its rivals. This lines a stock up against its closest sector peers on valuation and quality, and highlights the best value in each row. If your stock is the most expensive in every row, it had better be growing faster to justify it. This is the sanity check that stops you overpaying.',
      spot: '#pr-body', wait: 400 },
    { module: 'sentiment', title: 'Sentiment & News desk', group: 'Should I buy this stock?',
      body: 'A deeper dive on the alternative data: worldwide news tone over time (above zero is positive coverage), how much the news is talking about the stock, the bull-versus-bear split of investor posts, and public attention from Wikipedia pageviews. Rising attention plus rising tone can precede a move; a euphoric crowd often precedes a pullback. Use "Refresh live" to pull the newest data straight from your browser.',
      spot: '#sn-tone', wait: 450 },

    // ---- Autonomous Research ----
    { module: 'researcher', title: 'AI Researcher', group: 'Autonomous research',
      body: 'This is where AlphaLab acts like a tireless quant team. Press this button and it starts inventing trading ideas, testing each one on real history, and grading it through a strict five-stage checklist. Every result, success or failure, is filed away so it never wastes time re-testing a dead idea. Let it run in the background and watch the live feed fill with experiments and verdicts.',
      spot: '#res-toggle', wait: 350 },
    { module: 'strategies', title: 'Strategy Lab', group: 'Autonomous research',
      body: '118 real, named investing strategies you can run yourself: moving-average trends, momentum, pairs trades, volatility plays, value and quality factors, macro timing, seasonal patterns, crypto, and machine learning. Click any one to backtest it on real history with realistic trading costs, then read its full report. This is a library of the actual techniques hedge funds use.',
      spot: '#st-tbl', wait: 350 },
    { module: 'strategies', title: 'How to trust a backtest: the gauntlet', group: 'Autonomous research',
      body: 'A key lesson: any strategy can look brilliant on the past if you tune it enough. So every strategy here faces a five-check gauntlet, does it still work on data it never saw, does it survive triple trading costs, is it stable when you nudge its settings, is it positive in most years, is it statistically significant. A VALIDATED verdict passed all five. Most get REJECTED, and that honesty is the point: it stops you trusting a mirage.',
      spot: '.controls', wait: 200 },
    { module: 'ensemble', title: 'Ensemble Engine', group: 'Autonomous research',
      body: 'One strategy is fragile; a blend of unrelated ones is robust. This runs a competition among strategies over the recent past, scores each on return, risk, and fit with the current regime, then combines the top uncorrelated winners into one portfolio, sizing them so each contributes similar risk. Press Run to hold the competition and see the blended result.',
      spot: '#lb-run', wait: 300 },
    { module: 'alpha', title: 'Alpha Factory', group: 'Autonomous research',
      body: 'A "factor" is any signal that might predict returns, like momentum or cheapness. This engine machine-generates thousands of candidate factors and puts each through statistical tests, does it actually correlate with future returns, does it hold up out of sample, is it just a copy of a factor we already have. Only survivors join the library. Press the scan button to watch it hunt.',
      spot: '#af-scan', wait: 300 },
    { module: 'mllab', title: 'ML Lab', group: 'Autonomous research',
      body: 'Trains real machine-learning models, ridge regression, gradient-boosted trees, k-nearest-neighbors, a neural net, right in your browser to predict returns. Crucially it trains "walk-forward," only ever learning from the past to predict the future, so the results are honest. It reports information coefficient (predictive skill; even 0.05 is genuinely useful) and feature importance. Pick a target and model, then train.',
      spot: '#ml-run', wait: 300 },

    // ---- Quant Toolkit ----
    { module: 'structure', title: 'Market Structure', group: 'Quant toolkit',
      body: 'A map of the market that shows which stocks actually move together, using a technique called PCA plus clustering on real returns. Tight clumps trade as a block, so owning several of them is not real diversification. The outliers, stocks that move on their own, are the genuine diversifiers. Press Map the market to build it. This is how you avoid a portfolio that only looks diversified.',
      spot: '#ms-run', wait: 300 },
    { module: 'composer', title: 'Strategy Composer', group: 'Quant toolkit',
      body: 'Want to build your own strategy without writing code? Pick an instrument and a signal engine from the dropdowns, set the parameters, and AlphaLab runs it through the exact same backtest and five-check gauntlet the built-in strategies use. Compose an idea, test it honestly, see it get validated or rejected, and iterate. This is real quant research with training wheels.',
      spot: '.controls', wait: 300 },
    { module: 'seasonality', title: 'Seasonality', group: 'Quant toolkit',
      body: 'Do stocks really do better in some months? This shows average returns by calendar month and weekday across the full history, with a t-statistic that tells you whether a pattern is real or just luck. The rule of thumb: only trust a pattern when the t-stat clears about 2 and it has a sensible story behind it. A great tool for spotting, and debunking, seasonal myths.',
      spot: '#se-mo', wait: 350 },
    { module: 'drawdowns', title: 'Drawdown Analyzer', group: 'Quant toolkit',
      body: 'A "drawdown" is a drop from a peak. This lists every major decline a stock has suffered: how deep, how long the fall lasted, and, most importantly, how long it took to recover the old high. Recovery time is what investors underestimate most; some stocks took years. Look here before you buy, because this red chart is the pain you are signing up to hold through.',
      spot: '#dd-uw', wait: 400 },

    // ---- Portfolio & Risk ----
    { module: 'portfolio', title: 'Portfolio Builder', group: 'Build and protect your portfolio',
      body: 'Owning good stocks is half the job; sizing them well is the other half. Pick a set of assets and an optimizer, equal risk contribution, risk parity, minimum variance, maximum Sharpe, Kelly, or Black-Litterman, and AlphaLab computes the ideal weights, shows how much risk each asset contributes, plots the efficient frontier, and backtests the mix over ten years. This is the math professionals use to combine holdings.',
      spot: '.controls', wait: 350 },
    { module: 'holdings', title: 'My Holdings', group: 'Build and protect your portfolio',
      body: 'Your actual portfolio, valued at real closing prices, with profit and loss, factor betas, and a concentration score. Press Competition mode to start with $100,000 of virtual cash and full buy/sell accounting, made for contests like Wharton. The AI review reads your book and flags concentration and regime risk in plain English, and Strategy report writes a full, printable investment document.',
      spot: '.section-title', wait: 350 },
    { module: 'risk', title: 'Risk Lab', group: 'Build and protect your portfolio',
      body: 'The reality check. This replays your exact portfolio through real historical crashes, 2008, COVID, the dot-com bust, Black Monday 1987, and shows the dollar loss you would have taken. It also runs a Monte Carlo of thousands of possible next years and a value-at-risk ladder (the "on a bad day you could lose this much" number). If a scenario scares you, that is the signal to diversify before it happens for real.',
      spot: '.section-title', wait: 400 },

    // ---- Firm ----
    { module: 'firm', title: 'Firm Simulator', group: 'Run your own fund',
      body: 'The capstone that ties everything together. You manage a real fund through a hidden three-year slice of actual market history, advancing week by week, never told which years you are in. Real crashes and rallies hit on schedule, and three AI analysts, a macro strategist, a quant, and a risk officer, debate your allocations and push back. You collect fees, try to keep investors from redeeming, and get a letter grade at the end. It is the whole platform as a game.',
      spot: '.section-title', wait: 400 },

    // ---- Knowledge ----
    { module: 'reports', title: 'Reports', group: 'Your research library',
      body: 'Every research report and strategy document you generate is saved here, and you can print any of them to a clean PDF, ready for a competition submission, a class assignment, or your own records. Institutional-quality writeups with a click.',
      spot: '.section-title', wait: 300 },
    { module: 'knowledge', title: 'Knowledge Base', group: 'Your research library',
      body: 'The platform\'s long-term memory. Every validated finding and every rejected dead end from the AI Researcher is stored here and searchable, so your research compounds over time instead of going in circles. Over many sessions this becomes a genuine, personal record of what works and what does not.',
      spot: '.tiles', wait: 300 },

    { module: 'guide', title: 'You are ready, here is what to do next', group: 'Finish',
      body: 'That is the entire platform. This written guide defines every number in plain English, has a step-by-step competition playbook, and shows exactly how to defend your picks to judges. A good first session: open Buy / Sell Decision on a stock you like, read its call and reasoning, check a couple of peers, then start a Competition-mode portfolio and stress test it in the Risk Lab. Press Finish and dive in.',
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

  UI.startTour = function (startStep) {
    if (overlay) return;
    build();
    idx = 0;
    go(startStep && startStep > 0 && startStep < TOUR.length ? startStep : 0);
  };
})();
