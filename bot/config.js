'use strict';
// All the knobs for the autonomous paper bot live here so you never have to touch the trading logic
// to retune it. Every value is a plain number or string, and the bot reads them once at startup.
// None of these are secrets. Your Alpaca keys are NOT here, they come from environment variables
// (GitHub Actions secrets), so this file is safe to commit and read in the public repo.

module.exports = {
  // The money the bot pretends to manage. Set your Alpaca paper account to start at this same amount
  // (reset the paper account to 2000, then regenerate the keys) so the account and the bot agree.
  // The bot targets weights against the account's live equity, so if you start at 2000 the whole
  // account is the 2000 sleeve and P&L reads straight off Alpaca.
  STARTING_BALANCE: 2000,

  // Which of AlphaLab's risk profiles drives the target book: 'conservative', 'balanced', or
  // 'aggressive'. Balanced is a real multi-asset mix (stocks, bonds, gold) that the regime detector
  // tilts on its own, which is the sane default for an unattended bot.
  RISK_PROFILE: 'balanced',

  // How many single-stock leaders the advisor is allowed to add on top of the index sleeves. These are
  // the names re-ranked by the full six-engine conviction, one per sector (so this is capped by how many
  // sectors have a genuine buy). Raised so the book actually carries real stock picks, not just ETFs.
  N_STOCKS: 10,

  // How big a slice of the EQUITY bucket goes to those single-stock conviction picks (the rest of the
  // equity bucket is index ETFs: core, growth, international, emerging, dividend). The stock default is
  // only ~0.24, which is why an unattended run looked "all ETFs". We lean it up so the six-engine stock
  // alpha actually drives the book. The bond and real-asset HEDGE sleeves are untouched by this, so it
  // trades index beta for single-name alpha, it does not remove hedges. 0 keeps the original mix.
  SINGLE_STOCK_SHARE: 0.55,

  // Per-account risk MODES for the competition. Each account is traded under one mode, and a mode is
  // just a set of overrides on the knobs in this file, so the paper accounts run different strategies
  // and race each other on real P&L. 'hedged' is the diversified full-conviction book with the bond and
  // gold hedge sleeve. 'risk' takes real risk: the aggressive profile (light on bonds and gold), only a
  // handful of names, and almost the whole equity bucket in single-stock conviction, so it is
  // concentrated single-name bets, not safe ETFs. Add your own modes here freely.
  MODES: {
    hedged: {},   // base config unchanged: full conviction, diversified, hedge sleeve intact
    risk: {
      RISK_PROFILE: 'aggressive',   // eq 0.72 / bond 0.08 / real 0.12: much lighter on the safe sleeve
      N_STOCKS: 5,                  // few, concentrated single-name bets
      SINGLE_STOCK_SHARE: 0.85,     // the equity bucket is almost all single-stock conviction
    },
  },

  // Which mode each account trades. Index 1 = ALPACA_KEY_ID, 2 = ALPACA_KEY_ID_2, and so on. Anything
  // not listed defaults to 'hedged'. Set ALPACA_MODE_<n> in the environment to override an assignment
  // without editing this file (e.g. ALPACA_MODE_2=hedged to race two identical books instead).
  ACCOUNT_MODES: { 1: 'hedged', 2: 'risk' },

  // Risk rails. RAW MODE: the conviction dampers are OFF, so each account holds exactly what the six
  // engines decide, at full size, deployed immediately. Any rail below re-arms the moment you set it
  // back to a positive number; 0 means that rail is disabled. What stays on are the mechanical guards
  // that only stop broken behavior, never the AI's decisions: a closed market, a garbage quote, and a
  // sub-dollar order. Those are not safeguards on conviction, they just keep the bot from erroring out.
  MAX_POSITION_PCT: 1.0,    // 1.0 = no artificial cap; the engine's own target weight sizes each name
  MAX_DAILY_LOSS_PCT: 0,    // 0 = no daily-loss kill switch; a bad day is not auto-flattened
  REBALANCE_THRESHOLD: 0.015, // trade a name once it has drifted more than 1.5% of the book off target.
                            // Kept small so the ~2.8% single-stock picks can actually be opened, and so the
                            // bot does not churn cents every run. This is execution hygiene, not a limiter.
  MIN_TRADE_USD: 8,         // never send an order smaller than this; fractional orders make small lots fine

  // Intraday trading. The daily target book is the destination; these decide how the bot works toward
  // it through the session, so it behaves like a trader on the desk and not a once-a-day rebalancer.
  //
  // It runs every 15 minutes while the market is open (the cron in .github/workflows/trade.yml). On
  // each run it does not slam the full gap to target in one order. It works a slice of the remaining
  // distance, which paces entries and exits across the day the way a real execution desk does.
  PARTICIPATION: 1.0,       // RAW MODE: 1.0 = trade the full remaining gap to target each run, so the
                            // engine's decision is deployed immediately instead of eased in over the day.
                            // Lower it (e.g. 0.34) to pace entries across the session like a desk again.

  // Live risk management on open positions, checked every run against Alpaca's own P&L numbers.
  // RAW MODE: both are 0 (off), so a position is never auto-cut or auto-trimmed against the engines.
  // The book only changes when the engines' own target changes. Set a positive number to re-arm either.
  STOP_LOSS_PCT: 0,         // 0 = off. e.g. 0.08 would cut a position once it is down 8% from its entry
  TAKE_PROFIT_PCT: 0,       // 0 = off. e.g. 0.18 would trim a position once it is up 18% from its entry

  // Buy weakness. When the bot is adding to a name that is red on the day it leans in a little harder,
  // and when the name is already extended up it eases off. This tilts each slice by live intraday move.
  DIP_TILT: 8,              // strength of the tilt; 0 turns it off. slice multiplier is clamped to 0.5..1.5
  USE_LIVE_QUOTES: true,    // pull live quotes (Finnhub) and feed them into the engine so the whole target
                            // book, regime, conviction and sizing, recomputes on the live market every run.
                            // Also drives the dip tilt on names we do not hold yet. If the feed is down the
                            // bot degrades to the last snapshot close and Alpaca's own day-change numbers.

  // Learning. The bot learns from its own decisions by reading its real fill history from Alpaca,
  // scoring how much each name has actually made or lost on closed trades, and sizing a little harder
  // into the winners and softer into the losers. Nothing is stored; it is recomputed every run.
  LEARN_ENABLED: true,
  LEARN_STRENGTH: 0.30,     // how far realized P&L can move a name's buy size (before the bounds below)
  LEARN_MIN: 0.60,          // most a chronic loser can be scaled down to
  LEARN_MAX: 1.40,          // most a proven winner can be scaled up to

  // Crypto is off in this version. Alpaca can trade crypto, but the symbols and the 24/7 hours need
  // their own handling, so the bot skips the crypto sleeve for now and leaves that weight in cash.
  ENABLE_CRYPTO: false,

  // Paper endpoint. Leave this alone. Pointing it at the live URL would trade real money, which is
  // exactly what we are not doing.
  ALPACA_BASE_URL: process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets',
};
