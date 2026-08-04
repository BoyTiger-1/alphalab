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

  // How many single-stock leaders the advisor is allowed to add on top of the index sleeves. These
  // are the names re-ranked by the full six-engine conviction, one per sector.
  N_STOCKS: 5,

  // Risk rails. These are hard limits the bot will not cross, no matter what the engines say.
  MAX_POSITION_PCT: 0.30,   // never let a single position exceed 30% of the book
  MAX_DAILY_LOSS_PCT: 0.08, // if the account is down more than 8% on the day, flatten everything and stop
  REBALANCE_THRESHOLD: 0.015, // trade a name once it has drifted more than 1.5% of the book off target.
                            // On a small $2000 book this has to stay low, or the single-stock conviction
                            // picks (~2.8% each) sit below the threshold and can never be opened at all.
  MIN_TRADE_USD: 8,         // never send an order smaller than this; fractional orders make small lots fine

  // Intraday trading. The daily target book is the destination; these decide how the bot works toward
  // it through the session, so it behaves like a trader on the desk and not a once-a-day rebalancer.
  //
  // It runs every 15 minutes while the market is open (the cron in .github/workflows/trade.yml). On
  // each run it does not slam the full gap to target in one order. It works a slice of the remaining
  // distance, which paces entries and exits across the day the way a real execution desk does.
  PARTICIPATION: 0.34,      // fraction of the remaining gap to target to trade on each run (0..1)

  // Live risk management on open positions, checked every run against Alpaca's own P&L numbers.
  STOP_LOSS_PCT: 0.08,      // cut a position entirely once it is down this much from its entry price
  TAKE_PROFIT_PCT: 0.18,    // once a position is up this much from entry, trim it back toward its target

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
