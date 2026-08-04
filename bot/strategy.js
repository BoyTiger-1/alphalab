'use strict';
// The intraday brain of the bot, written as pure functions so it can be tested without a broker, keys,
// or a network. run.js gathers the live account state and hands it here; this decides what to trade.
//
// The idea: AlphaLab's six engines give a daily TARGET book (where the money should end up). This layer
// decides how to trade toward that target through the session, like an execution desk works an order
// rather than dumping it all at once. The book is two-sided, like a real quant desk:
//
//   LONG  targets are positive dollars  (own the strongest names + the index/bond/gold hedge sleeves)
//   SHORT targets are negative dollars  (short the weakest names; the shorts hedge the longs)
//
// For every symbol the planner compares the SIGNED target dollars to the SIGNED position value (Alpaca
// reports a short as a negative market value) and works the gap:
//
//   1. Stop-loss   - any LONG down more than STOP_LOSS_PCT from entry is cut in full, first (off in raw).
//   2. Exit        - anything no longer in the target book is closed to flat (long or short).
//   3. Flip guard  - if we hold one side but now want the other, close to flat first; open next run.
//   4. Take-profit - a LONG up more than TAKE_PROFIT_PCT that is now overweight is trimmed (off in raw).
//   5. Work the gap - the rest of the distance to the signed target is traded a slice at a time, which
//                     opens/adds a long (buy), trims a long (sell), opens/adds a short (sell short), or
//                     covers a short (buy). Buys lean harder into names red on the day and ease off
//                     extended ones, and are sized by what past trades in that name actually earned.
//
// Because only a slice of each gap trades per run, entries and exits spread across the whole day.

const round2 = n => Math.round(n * 100) / 100;

// Turn the engine's LONG target book into target dollars per tradable symbol, with the hard
// single-position cap applied and crypto dropped unless it is enabled. Shared by run.js and the tests.
function targetDollars(holdings, nav, cfg) {
  const out = {};
  for (const h of holdings) {
    if (h.cls === 'Crypto' && !cfg.ENABLE_CRYPTO) continue;   // equities and ETFs only, this version
    const capped = Math.min(h.weight * nav, cfg.MAX_POSITION_PCT * nav);
    out[h.sym] = round2(capped);
  }
  return out;
}

// Turn the engine's SHORT book into NEGATIVE target dollars per symbol: the short sleeve (a fraction of
// NAV) split evenly across the short names. Off (returns {}) unless SHORT_ENABLED and a positive sleeve.
// Names already present as a long target are the caller's responsibility to keep out; here we only size.
function shortDollars(shorts, nav, cfg) {
  const out = {};
  if (!cfg.SHORT_ENABLED || !(cfg.SHORT_SLEEVE > 0) || !shorts || !shorts.length) return out;
  const per = round2((cfg.SHORT_SLEEVE * nav) / shorts.length);
  for (const s of shorts) if (s && s.sym && s.price > 0) out[s.sym] = -per;
  return out;
}

// Decide the orders for one run. Inputs are all plain data:
//   nav      - account equity in dollars
//   held     - map sym -> { qty, marketValue, price, plpc, changeToday } (short qty/marketValue are < 0)
//   targetD  - map sym -> SIGNED target dollars (>0 long, <0 short, 0/absent = flat)
//   moves    - map sym -> live intraday fractional move vs prev close (optional; from quotes.js)
//   bias     - map sym -> learning multiplier on buy size (optional; from learn.js, default 1.0)
//   cfg      - config
// Returns { actions, holds } where each action is { sym, side, kind, dollars, reason }. kind is one of
// close (exit to flat), trim (reduce long), buy (open/add long), short (open/add short), cover (reduce
// short). run.js routes each kind to the right Alpaca call.
function plan({ nav, held, targetD, moves, bias, cfg }) {
  held = held || {};
  moves = moves || {};
  bias = bias || {};
  const minTrade = Math.max(nav * cfg.REBALANCE_THRESHOLD, cfg.MIN_TRADE_USD);
  const actions = [];
  const holds = [];
  const syms = Array.from(new Set([...Object.keys(targetD), ...Object.keys(held)]));

  for (const sym of syms) {
    const td = targetD[sym] || 0;              // signed target dollars
    const pos = held[sym];
    const cd = pos ? pos.marketValue : 0;      // signed current dollars (short is negative)

    // 1. stop-loss on LONGS: a real loss from our entry gets cut in full, before anything adds risk.
    if (cfg.STOP_LOSS_PCT > 0 && pos && cd > 0 && pos.plpc != null && pos.plpc <= -cfg.STOP_LOSS_PCT) {
      actions.push({ sym, side: 'SELL', kind: 'close', reason: `stop-loss ${(pos.plpc * 100).toFixed(1)}%` });
      continue;
    }

    // 2. exit: the engine no longer wants this name at all, so close it out (works long or short).
    if (td === 0 && pos) { actions.push({ sym, side: cd < 0 ? 'BUY' : 'SELL', kind: 'close', reason: 'left the target book' }); continue; }
    if (td === 0 && !pos) continue;   // not held, not wanted

    // 3. flip guard: if we hold one side but the engine now wants the other, we cannot cross zero in one
    //    fractional order, so close to flat this run and open the new side on a later run (~1 min away).
    if (cd !== 0 && Math.sign(td) !== Math.sign(cd)) {
      actions.push({ sym, side: cd < 0 ? 'BUY' : 'SELL', kind: 'close', reason: cd < 0 ? 'flip short to long: cover first' : 'flip long to short: close first' });
      continue;
    }

    // 4. take-profit on LONGS: a big winner that is now overweight gets trimmed back toward target.
    if (cfg.TAKE_PROFIT_PCT > 0 && pos && cd > 0 && td > 0 && pos.plpc != null && pos.plpc >= cfg.TAKE_PROFIT_PCT && cd > td) {
      const trim = round2(cd - td);
      if (trim >= minTrade) {
        actions.push({ sym, side: 'SELL', kind: 'trim', dollars: trim, reason: `take-profit +${(pos.plpc * 100).toFixed(1)}%` });
        continue;
      }
    }

    // 5. work a slice of the remaining gap to the signed target, so moves spread over several runs.
    const gap = round2(td - cd);   // >0 need to buy (add long / cover short); <0 need to sell (add short / trim long)
    if (Math.abs(gap) < minTrade) { holds.push(sym); continue; }

    let slice = gap * cfg.PARTICIPATION;

    // buy weakness + learning only apply when OPENING or ADDING a long (gap up into a long target).
    if (gap > 0 && td > 0) {
      if (cfg.DIP_TILT > 0) {
        const mv = moves[sym] != null ? moves[sym] : (pos && pos.changeToday != null ? pos.changeToday : null);
        if (mv != null) {
          let mult = 1 - cfg.DIP_TILT * mv;             // mv < 0 (red) -> mult > 1 -> bigger slice
          mult = Math.max(0.5, Math.min(1.5, mult));    // never more than 1.5x or less than 0.5x
          slice *= mult;
        }
      }
      if (bias[sym] != null) slice *= bias[sym];
    }

    // always move at least one real lot so we make progress, but never overshoot the gap itself.
    if (Math.abs(slice) < minTrade) slice = Math.sign(gap) * minTrade;
    if (Math.abs(slice) > Math.abs(gap)) slice = gap;
    slice = round2(slice);

    if (slice > 0) {
      // buying: covering a short back toward a smaller short, or opening/adding a long
      if (cd < 0) actions.push({ sym, side: 'BUY', kind: 'cover', dollars: slice, reason: 'cover short toward target' });
      else actions.push({ sym, side: 'BUY', kind: 'buy', dollars: slice, reason: 'scale-in toward target' });
    } else if (slice < 0) {
      // selling: opening/adding a short (target is short), or trimming a long back to target
      if (td < 0) actions.push({ sym, side: 'SELL', kind: 'short', dollars: -slice, reason: 'short the weakest names' });
      else actions.push({ sym, side: 'SELL', kind: 'trim', dollars: -slice, reason: 'rebalance down' });
    }
  }

  return { actions, holds };
}

module.exports = { targetDollars, shortDollars, plan, round2 };
