'use strict';
// The autonomous bot. GitHub Actions calls this every 15 minutes while the US market is open, so it
// trades through the whole session in the cloud with your computer off. One run does exactly this, for
// every account you have configured: read the account, decide whether it is safe to trade, ask
// AlphaLab's engines for the target book, then let the intraday strategy work the account toward it.
//
// Each account is traded under a risk MODE (see config.js): account 1 runs 'hedged' (the diversified
// full-conviction book), account 2 runs 'risk' (concentrated, aggressive, mostly single stocks), so the
// two paper accounts compete live on the same brain. Assignments live in config.ACCOUNT_MODES and can
// be overridden per account with ALPACA_MODE_<n>.
//
// It never holds your keys in code. They arrive as environment variables (GitHub Actions secrets):
//   ALPACA_KEY_ID,   ALPACA_SECRET_KEY     (account 1, required)
//   ALPACA_KEY_ID_2, ALPACA_SECRET_KEY_2   (account 2, optional; _3 .. _9 also work)
// A failure on one account never stops another. Set DRY_RUN=1 to compute and print without sending.

const Alpaca = require('./alpaca');
const engine = require('./engine');
const strategy = require('./strategy');
const quotes = require('./quotes');
const learn = require('./learn');
const cfg = require('./config');

const DRY = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
const money = n => '$' + Number(n).toFixed(2);
const pct = n => (n * 100).toFixed(2) + '%';

// Flush one account's human-readable lines to the GitHub Actions run summary. The lines were already
// streamed to the console live; this just gives each account its own block in the summary panel.
function flush(log) {
  const fs = require('fs');
  if (process.env.GITHUB_STEP_SUMMARY) {
    try { fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, log.join('\n') + '\n\n'); } catch (e) { }
  }
}

// Every account the bot should trade, read from the environment. Account 1 is the original pair; add
// ALPACA_KEY_ID_2 / ALPACA_SECRET_KEY_2 (and _3 .. _9) as secrets to trade more paper accounts on the
// same brain. Accounts with no keys are simply skipped, so one pair still behaves exactly as before.
function accounts() {
  const list = [];
  const push = (index, keyId, secret) => { if (keyId && secret) list.push({ index, label: 'account ' + index, keyId, secret }); };
  push(1, process.env.ALPACA_KEY_ID, process.env.ALPACA_SECRET_KEY);
  for (let i = 2; i <= 9; i++) push(i, process.env['ALPACA_KEY_ID_' + i], process.env['ALPACA_SECRET_KEY_' + i]);
  return list;
}

// The effective config for one account: the base config with its risk mode's overrides applied on top.
// ALPACA_MODE_<n> in the environment wins over config.ACCOUNT_MODES so an assignment can change without
// a code edit. Unknown modes fall back to the base config, never crash.
function configFor(index) {
  const name = process.env['ALPACA_MODE_' + index] || (cfg.ACCOUNT_MODES && cfg.ACCOUNT_MODES[index]) || 'hedged';
  const overrides = (cfg.MODES && cfg.MODES[name]) || {};
  return { mode: name, c: Object.assign({}, cfg, overrides) };
}

// One full pass over ONE account: read it, decide, and (unless DRY) place the orders. Everything it
// prints goes into this account's own `log` so the accounts never bleed into each other's summary.
async function tradeAccount(creds) {
  const { mode, c } = configFor(creds.index);
  const log = [];
  const say = line => { log.push(line); console.log(line); };
  const alpaca = new Alpaca(creds.keyId, creds.secret, c.ALPACA_BASE_URL);
  const opts = { stockShare: c.SINGLE_STOCK_SHARE };

  // --- 1. account health. If Alpaca has flagged the account, we do nothing at all. ---------------
  const acct = await alpaca.account();
  say(`# AlphaLab paper bot - ${creds.label} [${mode} mode]${DRY ? ' (DRY RUN)' : ''}`);
  if (acct.trading_blocked || acct.account_blocked || acct.status !== 'ACTIVE') {
    say(`account not tradable (status ${acct.status}, trading_blocked ${acct.trading_blocked}). stopping.`);
    return flush(log);
  }
  const nav = parseFloat(acct.equity);
  const lastEq = parseFloat(acct.last_equity) || nav;
  const dayPnl = lastEq > 0 ? nav / lastEq - 1 : 0;
  const incePnl = nav - c.STARTING_BALANCE;

  say(`equity ${money(nav)} | cash ${money(acct.cash)} | today ${dayPnl >= 0 ? '+' : ''}${pct(dayPnl)} | since start ${incePnl >= 0 ? '+' : ''}${money(incePnl)}`);

  // --- 2. daily-loss kill switch. Disabled when MAX_DAILY_LOSS_PCT is 0 (raw mode). --------------
  const positionsRaw = await alpaca.positions();
  if (c.MAX_DAILY_LOSS_PCT > 0 && dayPnl <= -c.MAX_DAILY_LOSS_PCT && positionsRaw.length) {
    say(`DAILY LOSS LIMIT HIT (${pct(dayPnl)} <= -${pct(c.MAX_DAILY_LOSS_PCT)}). Flattening everything and standing down for the day.`);
    if (!DRY) { try { await alpaca.closeAll(); say('closed all positions.'); } catch (e) { say('closeAll failed: ' + e.message); } }
    else say('(dry run: would closeAll)');
    return flush(log);
  }

  // --- 3. is the market open? Fractional market orders only fill during regular hours. -----------
  const clock = await alpaca.clock();
  if (!clock.is_open && !DRY) {
    say(`market is closed (next open ${clock.next_open}). nothing to do.`);
    return flush(log);
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
  const snap = engine.getTarget(nav, c.RISK_PROFILE, c.N_STOCKS, null, opts);
  const universe = Array.from(new Set([...snap.holdings.map(h => h.sym), ...Object.keys(held)]));
  let quoteMap = {};
  if (c.USE_LIVE_QUOTES) { try { quoteMap = await quotes.liveQuotes(universe); } catch (e) { } }
  const livePrices = quotes.pricesOf(quoteMap);
  const moves = quotes.movesOf(quoteMap);
  const target = Object.keys(livePrices).length
    ? engine.getTarget(nav, c.RISK_PROFILE, c.N_STOCKS, livePrices, opts)
    : snap;

  const targetD = strategy.targetDollars(target.holdings, nav, c);
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
  const { actions, holds } = strategy.plan({ nav, held, targetD, moves, bias, cfg: c });
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

  return flush(log);
}

async function main() {
  const list = accounts();
  if (!list.length) throw new Error('missing Alpaca API keys (set ALPACA_KEY_ID and ALPACA_SECRET_KEY)');
  if (list.length > 1) console.log(`trading ${list.length} accounts on the same brain\n`);
  let failures = 0;
  for (const creds of list) {
    try {
      await tradeAccount(creds);
    } catch (e) {
      failures++;
      console.error(`${creds.label} failed: ` + (e.stack || e.message));
      flush([`# AlphaLab paper bot - ${creds.label}`, 'run failed: ' + e.message]);
    }
  }
  if (failures) process.exit(1);   // surface a red run if any account errored, after trying them all
}

main().catch(e => { console.error('bot failed: ' + (e.stack || e.message)); process.exit(1); });
