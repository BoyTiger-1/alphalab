'use strict';
// The autonomous bot. GitHub Actions calls this every 15 minutes while the US market is open, so it
// trades through the whole session in the cloud with your computer off. One run does exactly this:
// read the account, decide whether it is safe to trade, ask AlphaLab's engines for the daily target
// book, then let the intraday strategy work the account toward that target a slice at a time.
//
// It never holds your keys in code. They arrive as environment variables (GitHub Actions secrets):
//   ALPACA_KEY_ID, ALPACA_SECRET_KEY
// Set DRY_RUN=1 to compute and print everything without sending a single order.

const Alpaca = require('./alpaca');
const engine = require('./engine');
const strategy = require('./strategy');
const quotes = require('./quotes');
const learn = require('./learn');
const cfg = require('./config');

const DRY = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
const money = n => '$' + Number(n).toFixed(2);
const pct = n => (n * 100).toFixed(2) + '%';

// collect human-readable lines for both the console and the GitHub Actions run summary
const log = [];
function say(line) { log.push(line); console.log(line); }

async function main() {
  const alpaca = new Alpaca(process.env.ALPACA_KEY_ID, process.env.ALPACA_SECRET_KEY, cfg.ALPACA_BASE_URL);

  // --- 1. account health. If Alpaca has flagged the account, we do nothing at all. ---------------
  const acct = await alpaca.account();
  if (acct.trading_blocked || acct.account_blocked || acct.status !== 'ACTIVE') {
    say(`account not tradable (status ${acct.status}, trading_blocked ${acct.trading_blocked}). stopping.`);
    return finish();
  }
  const nav = parseFloat(acct.equity);
  const lastEq = parseFloat(acct.last_equity) || nav;
  const dayPnl = lastEq > 0 ? nav / lastEq - 1 : 0;
  const incePnl = nav - cfg.STARTING_BALANCE;

  say(`# AlphaLab paper bot ${DRY ? '(DRY RUN)' : ''}`);
  say(`equity ${money(nav)} | cash ${money(acct.cash)} | today ${dayPnl >= 0 ? '+' : ''}${pct(dayPnl)} | since start ${incePnl >= 0 ? '+' : ''}${money(incePnl)}`);

  // --- 2. daily-loss kill switch. This runs before anything else that could add risk. ------------
  const positionsRaw = await alpaca.positions();
  if (dayPnl <= -cfg.MAX_DAILY_LOSS_PCT && positionsRaw.length) {
    say(`DAILY LOSS LIMIT HIT (${pct(dayPnl)} <= -${pct(cfg.MAX_DAILY_LOSS_PCT)}). Flattening everything and standing down for the day.`);
    if (!DRY) { try { await alpaca.closeAll(); say('closed all positions.'); } catch (e) { say('closeAll failed: ' + e.message); } }
    else say('(dry run: would closeAll)');
    return finish();
  }

  // --- 3. is the market open? Fractional market orders only fill during regular hours. -----------
  const clock = await alpaca.clock();
  if (!clock.is_open && !DRY) {
    say(`market is closed (next open ${clock.next_open}). nothing to do.`);
    return finish();
  }

  // index current positions by symbol, carrying the live P&L numbers the strategy needs
  const held = {};
  for (const p of positionsRaw) {
    held[p.symbol] = {
      qty: parseFloat(p.qty),
      marketValue: parseFloat(p.market_value),
      price: parseFloat(p.current_price),
      plpc: parseFloat(p.unrealized_plpc),      // gain/loss since entry, as a fraction
      changeToday: parseFloat(p.change_today),  // today's move vs prev close, as a fraction
      fractionable: p.asset_class !== 'crypto',
    };
  }

  // --- 4. live quotes, then the target book recomputed on those live prices -----------------------
  // A quick snapshot pass first, only to learn which names are in play, then live quotes for them plus
  // whatever we hold, then the real pass that recomputes the whole book (regime, conviction, sizing)
  // on the current market. If the quote feed is down we simply keep the snapshot pass.
  const snap = engine.getTarget(nav, cfg.RISK_PROFILE, cfg.N_STOCKS);
  const universe = Array.from(new Set([...snap.holdings.map(h => h.sym), ...Object.keys(held)]));
  let quoteMap = {};
  if (cfg.USE_LIVE_QUOTES) { try { quoteMap = await quotes.liveQuotes(universe); } catch (e) { } }
  const livePrices = quotes.pricesOf(quoteMap);
  const moves = quotes.movesOf(quoteMap);
  const target = Object.keys(livePrices).length
    ? engine.getTarget(nav, cfg.RISK_PROFILE, cfg.N_STOCKS, livePrices)
    : snap;

  const targetD = strategy.targetDollars(target.holdings, nav, cfg);
  const priceOf = {};
  for (const h of target.holdings) priceOf[h.sym] = h.price;
  for (const s in livePrices) priceOf[s] = livePrices[s];
  for (const s in held) if (held[s].price > 0) priceOf[s] = held[s].price;   // Alpaca's current price wins
  const deployD = Object.values(targetD).reduce((a, b) => a + b, 0);
  say(`\ntarget: ${Object.keys(targetD).length} tradable lines, regime ${target.regimeLabel || 'n/a'}, deploying ${money(deployD)} of ${money(nav)} (${pct(deployD / nav)}), rest cash`);
  say(`live: ${Object.keys(livePrices).length}/${universe.length} quotes, ${target.liveInjected || 0} fed into the engine`);

  // --- 5. learn from past trades: bias sizing toward names that have actually paid off ------------
  let bias = {}, learnNotes = [];
  try { const L = await learn.learn(alpaca, nav); bias = L.bias; learnNotes = L.notes; } catch (e) { }
  if (learnNotes.length) {
    const top = learnNotes.slice(0, 4).map(n => `${n.sym} ${n.realized >= 0 ? '+' : ''}${money(n.realized)} -> x${n.bias.toFixed(2)}`).join(', ');
    say(`learning from ${learnNotes.length} name(s): ${top}`);
  }

  // --- 6. plan the run: stops, exits, take-profits, and a learning-weighted paced slice ----------
  const { actions, holds } = strategy.plan({ nav, held, targetD, moves, bias, cfg });
  const sells = actions.filter(a => a.side === 'SELL');
  const buys = actions.filter(a => a.side === 'BUY');

  // --- 7. execute. Sells first so their proceeds fund the buys, then buys. -----------------------
  // Every order is wrapped so one rejection (not fractionable, not tradable, wash trade, etc.) never
  // stops the rest of the run.
  const done = [];
  const assetCache = {};
  const isFractionable = async sym => {
    if (sym in assetCache) return assetCache[sym];
    try { const a = await alpaca.asset(sym); assetCache[sym] = { tradable: a.tradable, fractionable: a.fractionable }; }
    catch (e) { assetCache[sym] = { tradable: false, fractionable: false, err: e.message }; }
    return assetCache[sym];
  };

  for (const s of sells) {
    const pos = held[s.sym];
    if (s.kind === 'close' || !pos) {
      if (DRY) { done.push(`SELL ALL ${s.sym} (${s.reason})`); continue; }
      try { await alpaca.closePosition(s.sym); done.push(`SELL ALL ${s.sym} (${s.reason})`); }
      catch (e) { done.push(`skip close ${s.sym}: ${e.message}`); }
      continue;
    }
    // partial trim (take-profit or rebalance down): sell a share count for the dollar amount
    const a = await isFractionable(s.sym);
    let qty = s.dollars / pos.price;
    qty = Math.min(qty, pos.qty);
    if (!a.fractionable) qty = Math.floor(qty);
    else qty = Math.floor(qty * 1e6) / 1e6;   // trim precision so we never try to sell more than we own
    if (!(qty > 0)) { done.push(`skip trim ${s.sym}: qty rounds to 0`); continue; }
    if (qty >= pos.qty * 0.999) {   // if we would dump almost all of it, close it cleanly instead
      if (DRY) { done.push(`SELL ALL ${s.sym} (${s.reason}, ~full)`); continue; }
      try { await alpaca.closePosition(s.sym); done.push(`SELL ALL ${s.sym} (${s.reason}, ~full)`); }
      catch (e) { done.push(`skip ${s.sym}: ${e.message}`); }
      continue;
    }
    if (DRY) { done.push(`SELL ${s.sym} ${qty} (~${money(s.dollars)}, ${s.reason})`); continue; }
    try { await alpaca.submitOrder({ symbol: s.sym, side: 'sell', qty }); done.push(`SELL ${s.sym} ${qty} (~${money(s.dollars)}, ${s.reason})`); }
    catch (e) { done.push(`skip sell ${s.sym}: ${e.message}`); }
  }

  for (const b of buys) {
    const a = await isFractionable(b.sym);
    if (!a.tradable) { done.push(`skip buy ${b.sym}: not tradable on Alpaca`); continue; }
    if (a.fractionable) {
      if (DRY) { done.push(`BUY ${b.sym} ${money(b.dollars)} (${b.reason})`); continue; }
      try { await alpaca.submitOrder({ symbol: b.sym, side: 'buy', notional: b.dollars }); done.push(`BUY ${b.sym} ${money(b.dollars)} (${b.reason})`); }
      catch (e) { done.push(`skip buy ${b.sym}: ${e.message}`); }
    } else {
      // no fractional support: fall back to as many whole shares as the dollar slice allows
      const px = priceOf[b.sym];
      const qty = px > 0 ? Math.floor(b.dollars / px) : 0;
      if (!(qty > 0)) { done.push(`skip buy ${b.sym}: ${money(b.dollars)} < 1 share`); continue; }
      if (DRY) { done.push(`BUY ${b.sym} ${qty} shares (~${money(qty * px)}, ${b.reason})`); continue; }
      try { await alpaca.submitOrder({ symbol: b.sym, side: 'buy', qty }); done.push(`BUY ${b.sym} ${qty} shares (~${money(qty * px)}, ${b.reason})`); }
      catch (e) { done.push(`skip buy ${b.sym}: ${e.message}`); }
    }
  }

  // --- 8. report ---------------------------------------------------------------------------------
  say(`\n## orders ${DRY ? '(intended, none sent)' : 'sent'}`);
  if (!done.length) say('none this run. every name is within its rebalance slice of target.');
  else done.forEach(d => say('- ' + d));
  say(`\nat target, left alone: ${holds.join(', ') || 'none'}`);

  return finish();
}

function finish() {
  const fs = require('fs');
  if (process.env.GITHUB_STEP_SUMMARY) {
    try { fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, log.join('\n') + '\n'); } catch (e) { }
  }
}

main().catch(e => {
  console.error('bot failed: ' + (e.stack || e.message));
  // still flush whatever we logged to the run summary before exiting non-zero
  finish();
  process.exit(1);
});
