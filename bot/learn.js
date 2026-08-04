'use strict';
// The learning layer. The bot learns from its own decisions the honest way: it reads its actual fill
// history from Alpaca, works out how much real money each name has made or lost on the trades it has
// already closed, and then leans a little harder into the names that have paid off while easing off
// the ones that have not. This is outcome weighting on real, realized profit and loss, recomputed from
// the broker's own record every run. It is not a black box, and it stores nothing: Alpaca is the memory,
// so there is no state file to keep in sync and nothing to get stale.

const cfg = require('./config');

// Read the whole fill history (paged) and fold it into realized profit and loss per symbol with FIFO
// cost basis: each sell is matched against the oldest open buy lots. Only long trades are modeled, since
// the bot never shorts. Returns { realized, bias, notes }. Never throws; on any failure it just returns
// a neutral result so the bot keeps trading with no learning bias rather than stalling.
async function learn(alpaca, nav) {
  const empty = { realized: {}, bias: {}, notes: [] };
  if (!cfg.LEARN_ENABLED) return empty;

  let fills = [];
  try {
    let token = null;
    for (let page = 0; page < 25; page++) {   // cap at ~2500 fills, far more than a small bot makes
      const batch = await alpaca.fills(token);
      if (!Array.isArray(batch) || !batch.length) break;
      fills = fills.concat(batch);
      if (batch.length < 100) break;
      token = batch[batch.length - 1].id;
    }
  } catch (e) { return empty; }

  // FIFO realized P&L per symbol.
  const lots = {};       // sym -> [ { qty, price } ], open buy lots, oldest first
  const realized = {};   // sym -> realized dollars
  for (const f of fills) {
    const sym = f.symbol; if (!sym) continue;
    const qty = Math.abs(parseFloat(f.qty));
    const price = parseFloat(f.price);
    if (!(qty > 0) || !(price > 0)) continue;
    const side = (f.side || '').toLowerCase();
    if (side === 'buy') {
      (lots[sym] = lots[sym] || []).push({ qty, price });
    } else if (side === 'sell' || side === 'sell_short') {
      let remaining = qty;
      const q = lots[sym] || [];
      while (remaining > 1e-9 && q.length) {
        const lot = q[0];
        const take = Math.min(remaining, lot.qty);
        realized[sym] = (realized[sym] || 0) + take * (price - lot.price);   // profit on the matched shares
        lot.qty -= take; remaining -= take;
        if (lot.qty <= 1e-9) q.shift();
      }
      // a sell with no matching lot should not happen for a long-only bot, so it is simply ignored
    }
  }

  // Map realized P&L to a gentle, bounded sizing bias. One "unit" of conviction is 2% of the account,
  // and tanh squashes it so a single lucky or unlucky trade cannot swing the bias far. A name up a unit
  // gets scaled up toward LEARN_MAX, a name down a unit toward LEARN_MIN, everything else near 1.0.
  const unit = Math.max(nav * 0.02, 1);
  const bias = {}, notes = [];
  for (const sym in realized) {
    const r = realized[sym] / unit;
    const b = Math.max(cfg.LEARN_MIN, Math.min(cfg.LEARN_MAX, 1 + cfg.LEARN_STRENGTH * Math.tanh(r)));
    bias[sym] = b;
    if (Math.abs(b - 1) >= 0.03) notes.push({ sym, realized: realized[sym], bias: b });
  }
  notes.sort((a, b) => Math.abs(b.realized) - Math.abs(a.realized));
  return { realized, bias, notes };
}

module.exports = { learn };
