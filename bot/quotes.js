'use strict';
// Live intraday quotes. Two jobs: give the engine current prices so the whole target book recomputes
// on live data every run, and give the strategy each name's move on the day so it can lean into
// weakness. This is best-effort: if the feed is slow or down, the caller falls back to Alpaca's own
// per-position numbers and the last snapshot close, and keeps trading. Nothing here can block a run.
//
// Source is Finnhub, the same free real-time US quote feed the AlphaLab website uses. The key is a
// public, free, no-billing key (the same one baked into the site), so the bot works with zero setup.
// Override it with a FINNHUB_KEY environment variable to spend your own quota instead.

const PUBLIC_KEY = 'd9oe0qpr01qoqrd7g0cgd9oe0qpr01qoqrd7g0d0';

// Fetch a live quote for each symbol. Returns a map sym -> { price, chg } where price is the current
// trade and chg is the fractional move vs the previous close (e.g. -0.021 = down 2.1% on the day).
// Symbols the feed does not cover are simply omitted. Never throws.
async function liveQuotes(symbols, opts = {}) {
  const out = {};
  if (!symbols || !symbols.length) return out;
  const key = process.env.FINNHUB_KEY || opts.key || PUBLIC_KEY;

  await Promise.all(symbols.map(async sym => {
    try {
      const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${key}`;
      const res = await fetch(url);
      if (!res.ok) return;
      const q = await res.json();
      // c = current price, pc = previous close. Both must be real for the quote to mean anything.
      if (q && q.c > 0 && q.pc > 0) out[sym] = { price: q.c, chg: q.c / q.pc - 1 };
    } catch (e) { /* one bad symbol never sinks the batch */ }
  }));

  return out;
}

// Convenience splits for the two consumers.
const pricesOf = quotes => { const m = {}; for (const s in quotes) m[s] = quotes[s].price; return m; };
const movesOf = quotes => { const m = {}; for (const s in quotes) m[s] = quotes[s].chg; return m; };

module.exports = { liveQuotes, pricesOf, movesOf };
