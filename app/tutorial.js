/* Interactive guided tutorial: a spotlight tour that drives the real app,
   opening real modules and pointing at real controls, one step at a time.
   Not a video, not static text: it navigates AlphaLab for you. */
'use strict';
(function () {
  const TOUR = [
    { module: null, title: 'Welcome to the tour',
      body: 'This walks you through AlphaLab end to end using the real app, not a slideshow. Each step opens a real screen and points at what matters. You can leave any time with Skip, and reopen this from the guide. Press Next to begin.',
      spot: null },
    { module: 'dashboard', title: '1. The Command Center',
      body: 'This is home. The tiles are live prices, the panel on the left reads the current market regime (calm or stressed, detected by a hidden Markov model on real S&P returns), and the rest shows the yield curve, sector momentum, and cross-asset correlations. Everything here is real market data.',
      spot: '#dash-tiles' },
    { module: 'decision', title: '2. Should I buy this stock?',
      body: 'The Buy / Sell Decision engine is the fastest way to judge one stock. Type any ticker and it fuses eight technical factors, real fundamentals, Wall Street analyst targets, earnings surprises, news, and investor posts into a single BUY, HOLD, or SELL, with a bull case and a bear case. Try changing the ticker at the top.',
      spot: '#dc-body', wait: 400 },
    { module: 'decision', title: '3. Read the factor bars',
      body: 'Each bar is a real input scored from bearish (left) to bullish (right): technicals, analyst upside, quality, growth, valuation, sentiment. A missing bar just means that data was not available for the name. This is the reasoning, not a black box, so you can defend the call.',
      spot: '#dc-pillars', wait: 400 },
    { module: 'advisor', title: '4. Rank the whole market',
      body: 'The Stock Advisor scores every listed US stock, over 4,400 names, on the same factors and ranks them. Use the sector filter and search to narrow it, and read the starter basket on the right, which caps two names per sector so you stay diversified. Click any row for the full reasoning.',
      spot: '#ad-body', wait: 500 },
    { module: 'screener', title: '5. Screen by fundamentals',
      body: 'Looking for something specific? The Screener filters by real fundamentals: cheap and profitable value names, high growth, quality compounders, dividend payers, analyst upside. Pick a preset and click any result to open its decision.',
      spot: '.controls', wait: 300 },
    { module: 'holdings', title: '6. Build your portfolio',
      body: 'My Holdings tracks your positions at real closing prices with profit and loss, factor betas, and concentration. Press Competition mode to start with $100,000 of virtual cash for contests like Wharton. The AI review flags concentration and regime risk, and Strategy report writes a full document you can print.',
      spot: '.section-title', wait: 400 },
    { module: 'risk', title: '7. Stress test before you commit',
      body: 'The Risk Lab replays your exact portfolio through real crashes: 2008, COVID, the dot-com bust, Black Monday. It shows the dollar loss you would have taken, plus a Monte Carlo of one-year outcomes and a value-at-risk ladder. If a number scares you, diversify more.',
      spot: '.section-title', wait: 400 },
    { module: 'firm', title: '8. Run your own fund',
      body: 'The Firm Simulator is the capstone: manage a fund through a hidden three-year window of real history, advancing week by week, while three AI analysts (macro, quant, risk) debate your allocations and real crises hit on schedule. You collect fees, keep investors from redeeming, and get graded at the end.',
      spot: '.section-title', wait: 400 },
    { module: 'guide', title: '9. Everything is explained',
      body: 'The guide defines every number on the site in plain English, has a competition playbook, and shows how to defend your picks to judges. You are ready. Press Finish, then start with the Buy / Sell Decision on a stock you are curious about.',
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
    overlay.querySelector('#tour-step').textContent = `Step ${idx + 1} of ${TOUR.length}`;
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
