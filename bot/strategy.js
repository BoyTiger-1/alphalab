'use strict';
// The intraday brain of the bot, written as pure functions so it can be tested without a broker, keys,
// or a network. run.js gathers the live account state and hands it here; this decides what to trade.
//
// The idea: AlphaLab's six engines give a daily TARGET book (where the money should end up). This layer
// decides how to trade toward that target through the session, like an execution desk works an order
// rather than dumping it all at once:
//
//   1. Stop-loss   - any position down more than STOP_LOSS_PCT from its entry is cut in full, first.
//   2. Exit        - anything no longer in the target book is closed.
//   3. Take-profit - a position up more than TAKE_PROFIT_PCT that is now overweight is trimmed to target.
//   4. Work the gap - the rest of the distance to target is traded a slice at a time (PARTICIPATION),
//                     leaning harder into names that are red on the day and easing off extended ones.
//
// Because only a slice of each gap trades per run, entries and exits spread across the whole day.

const round2 = n => Math.round(n * 100) / 100;

// Turn the engine's target book into target dollars per tradable symbol, with the hard single-position
// cap applied and crypto dropped unless it is enabled. Shared by run.js and the tests.
function targetDollars(holdings, nav, cfg) {
  const out = {};
  for (const h of holdings) {
    if (h.cls === 'Crypto' && !cfg.ENABLE_CRYPTO) continue;   // equities and ETFs only, this version
    const capped = Math.min(h.weight * nav, cfg.MAX_POSITION_PCT * nav);
    out[h.sym] = round2(capped);
  }
  return out;
}

// Decide the orders for one run. Inputs are all plain data:
//   nav      - account equity in dollars
//   held     - map sym -> { qty, marketValue, price, plpc, changeToday } (plpc/changeToday are fractions)
//   targetD  - map sym -> target dollars (from targetDollars above)
//   moves    - map sym -> live intraday fractional move vs prev close (optional; from quotes.js)
//   bias     - map sym -> learning multiplier on buy size (optional; from learn.js, default 1.0)
//   cfg      - config
// Returns { actions, holds } where each action is { sym, side, kind, dollars, reason }.
function plan({ nav, held, targetD, moves, bias, cfg }) {
  held = held || {};
  moves = moves || {};
  bias = bias || {};
  const minTrade = Math.max(nav * cfg.REBALANCE_THRESHOLD, cfg.MIN_TRADE_USD);
  const actions = [];
  const holds = [];
  const syms = Array.from(new Set([...Object.keys(targetD), ...Object.keys(held)]));

  for (const sym of syms) {
    const td = targetD[sym] || 0;
    const pos = held[sym];
    const cd = pos ? pos.marketValue : 0;

    // 1. stop-loss: a real loss from our entry gets cut in full, before anything else can add risk.
    if (cfg.STOP_LOSS_PCT > 0 && pos && pos.plpc != null && pos.plpc <= -cfg.STOP_LOSS_PCT) {
      actions.push({ sym, side: 'SELL', kind: 'close', reason: `stop-loss ${(pos.plpc * 100).toFixed(1)}%` });
      continue;
    }

    // 2. exit: the engine no longer wants this name, so close it out.
    if (td <= 0 && pos) { actions.push({ sym, side: 'SELL', kind: 'close', reason: 'left the target book' }); continue; }
    if (td <= 0 && !pos) continue;   // not held, not wanted

    // 3. take-profit: a big winner that is now overweight gets trimmed back to its target weight.
    if (cfg.TAKE_PROFIT_PCT > 0 && pos && pos.plpc != null && pos.plpc >= cfg.TAKE_PROFIT_PCT && cd > td) {
      const trim = round2(cd - td);
      if (trim >= minTrade) {
        actions.push({ sym, side: 'SELL', kind: 'trim', dollars: trim, reason: `take-profit +${(pos.plpc * 100).toFixed(1)}%` });
        continue;
      }
    }

    const gap = round2(td - cd);
    if (Math.abs(gap) < minTrade) { holds.push(sym); continue; }

    // 4. work a slice of the remaining gap, so the move spreads over several runs across the day.
    let slice = gap * cfg.PARTICIPATION;

    if (gap > 0) {
      // buy weakness: when adding, lean harder into a name that is down on the day and ease off one
      // that is already extended up. Uses the live quote if we have it, else the position's day change.
      if (cfg.DIP_TILT > 0) {
        const mv = moves[sym] != null ? moves[sym] : (pos && pos.changeToday != null ? pos.changeToday : null);
        if (mv != null) {
          let mult = 1 - cfg.DIP_TILT * mv;             // mv < 0 (red) -> mult > 1 -> bigger slice
          mult = Math.max(0.5, Math.min(1.5, mult));    // never more than 1.5x or less than 0.5x
          slice *= mult;
        }
      }
      // learning: size a little harder into names that have actually made money, softer into losers.
      if (bias[sym] != null) slice *= bias[sym];
    }

    // always move at least one real lot so we make progress, but never overshoot the gap itself.
    if (Math.abs(slice) < minTrade) slice = Math.sign(gap) * minTrade;
    if (Math.abs(slice) > Math.abs(gap)) slice = gap;
    slice = round2(slice);

    if (slice > 0) actions.push({ sym, side: 'BUY', kind: 'buy', dollars: slice, reason: 'scale-in toward target' });
    else if (slice < 0) actions.push({ sym, side: 'SELL', kind: 'trim', dollars: -slice, reason: 'rebalance down' });
  }

  return { actions, holds };
}

module.exports = { targetDollars, plan, round2 };
