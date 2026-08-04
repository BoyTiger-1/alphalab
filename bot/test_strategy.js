'use strict';
// Unit test for the pure intraday planner. No broker, no keys, no network: it feeds strategy.plan a
// hand-built account and checks it makes the right call in each case. Run: node bot/test_strategy.js

const { plan, shortDollars } = require('./strategy');

// Fixed config for the test so it stays deterministic no matter how the live config.js is tuned.
const cfg = {
  PARTICIPATION: 0.34,
  REBALANCE_THRESHOLD: 0.03,   // minTrade = max(2000*0.03, 15) = 60
  MIN_TRADE_USD: 15,
  DIP_TILT: 8,
  STOP_LOSS_PCT: 0.08,
  TAKE_PROFIT_PCT: 0.18,
  MAX_POSITION_PCT: 0.30,
};

let failures = 0;
function check(name, cond) {
  if (cond) console.log(`  ok   ${name}`);
  else { console.log(`  FAIL ${name}`); failures++; }
}
const near = (a, b) => Math.abs(a - b) < 0.01;

const nav = 2000;   // minTrade = max(2000*0.03, 15) = 60

// One account that exercises every branch of the planner at once.
const held = {
  STOPME: { qty: 1, marketValue: 100,  price: 100,  plpc: -0.09, changeToday: 0 }, // down past stop, even though on target
  OUT:    { qty: 1, marketValue: 80,   price: 80,   plpc: 0.01,  changeToday: 0 }, // no longer in target
  WIN:    { qty: 1, marketValue: 300,  price: 300,  plpc: 0.20,  changeToday: 0 }, // big winner, overweight
  HOLD:   { qty: 1, marketValue: 980,  price: 980,  plpc: 0.00,  changeToday: 0 }, // within the threshold
  FLOOR:  { qty: 1, marketValue: 1000, price: 1000, plpc: 0.00,  changeToday: 0 }, // small gap, tests the min-lot floor
};
const targetD = {
  STOPME: 100, WIN: 100, HOLD: 1000, FLOOR: 1100,
  NEW: 1000, DIP: 1000, EXT: 1000, WINNER: 1000, LOSER: 1000,
  // OUT deliberately absent -> should be exited
};
const moves = { DIP: -0.05, EXT: 0.10 };            // DIP is red on the day, EXT is extended up
const bias = { WINNER: 1.40, LOSER: 0.60 };         // learned from realized P&L: proven winner vs loser

const { actions, holds } = plan({ nav, held, targetD, moves, bias, cfg });
const by = {};
for (const a of actions) by[a.sym] = a;

console.log('intraday planner');
check('stop-loss closes the loser even when on target', by.STOPME && by.STOPME.side === 'SELL' && by.STOPME.kind === 'close');
check('name that left the book is exited',              by.OUT && by.OUT.side === 'SELL' && by.OUT.kind === 'close');
check('overweight winner is trimmed to target ($200)',  by.WIN && by.WIN.kind === 'trim' && near(by.WIN.dollars, 200));
check('fresh name is scaled in by participation ($340)',by.NEW && by.NEW.side === 'BUY' && near(by.NEW.dollars, 340));
check('dip name gets a bigger slice ($476 > $340)',     by.DIP && by.DIP.side === 'BUY' && near(by.DIP.dollars, 476));
check('extended name gets a smaller slice ($170 < $340)',by.EXT && by.EXT.side === 'BUY' && near(by.EXT.dollars, 170));
check('small gap still moves at least one min lot ($60)',by.FLOOR && by.FLOOR.side === 'BUY' && near(by.FLOOR.dollars, 60));
check('learned winner is sized up (x1.40 -> $476)',     by.WINNER && by.WINNER.side === 'BUY' && near(by.WINNER.dollars, 476));
check('learned loser is sized down (x0.60 -> $204)',    by.LOSER && by.LOSER.side === 'BUY' && near(by.LOSER.dollars, 204));
check('within-threshold name is left alone',            !by.HOLD && holds.includes('HOLD'));
check('no phantom order for the exited name in buys',   !(by.OUT && by.OUT.side === 'BUY'));

// --- the short side: signed targets (negative = short) exercise the long/short branches -------------
// Alpaca reports a short as a NEGATIVE qty and market_value, which is exactly what the planner keys off.
const sHeld = {
  SADD:   { qty: -1,  marketValue: -100,  price: 100, plpc: 0, changeToday: 0 }, // small short, want bigger
  SCOVER: { qty: -10, marketValue: -1000, price: 100, plpc: 0, changeToday: 0 }, // big short, want smaller
  SEXIT:  { qty: -2,  marketValue: -200,  price: 100, plpc: 0, changeToday: 0 }, // short no longer wanted
  FLIP_LS:{ qty: 1,   marketValue: 300,   price: 300, plpc: 0, changeToday: 0 }, // held long, now a short target
  FLIP_SL:{ qty: -3,  marketValue: -300,  price: 100, plpc: 0, changeToday: 0 }, // held short, now a long target
};
const sTarget = {
  SNEW: -1000,     // no position -> open a short
  SADD: -1000,     // add to the short
  SCOVER: -100,    // cover most of the short
  FLIP_LS: -500,   // was long, now short -> close the long first
  FLIP_SL: 500,    // was short, now long -> cover the short first
  // SEXIT deliberately absent -> should be covered to flat
};
const s = plan({ nav, held: sHeld, targetD: sTarget, moves: {}, bias: {}, cfg });
const sby = {};
for (const a of s.actions) sby[a.sym] = a;

console.log('\nlong/short planner');
check('fresh short is opened by participation ($340)',      sby.SNEW && sby.SNEW.side === 'SELL' && sby.SNEW.kind === 'short' && near(sby.SNEW.dollars, 340));
check('existing short is added to (short kind)',            sby.SADD && sby.SADD.side === 'SELL' && sby.SADD.kind === 'short' && near(sby.SADD.dollars, 306));
check('oversized short is covered (buy kind cover)',        sby.SCOVER && sby.SCOVER.side === 'BUY' && sby.SCOVER.kind === 'cover' && near(sby.SCOVER.dollars, 306));
check('short that left the book is closed to flat',         sby.SEXIT && sby.SEXIT.side === 'BUY' && sby.SEXIT.kind === 'close');
check('long flipping to short is closed first, not shorted',sby.FLIP_LS && sby.FLIP_LS.side === 'SELL' && sby.FLIP_LS.kind === 'close');
check('short flipping to long is covered first, not bought',sby.FLIP_SL && sby.FLIP_SL.side === 'BUY' && sby.FLIP_SL.kind === 'close');
check('no dip-tilt or learning bias leaks onto shorts',     near(sby.SNEW.dollars, 340));   // moves/bias must not touch a short slice

// shortDollars: the sleeve is split evenly into negative targets, and is off unless enabled + sized.
const scfg = { SHORT_ENABLED: true, SHORT_SLEEVE: 0.20, N_SHORTS: 4 };
const sd = shortDollars([{ sym: 'A', price: 10 }, { sym: 'B', price: 20 }], 2000, scfg);
check('shortDollars splits the sleeve into negatives (-200 each)', near(sd.A, -200) && near(sd.B, -200));
check('shortDollars is empty when disabled',                Object.keys(shortDollars([{ sym: 'A', price: 10 }], 2000, { SHORT_ENABLED: false, SHORT_SLEEVE: 0.2 })).length === 0);
check('shortDollars is empty with a zero sleeve',           Object.keys(shortDollars([{ sym: 'A', price: 10 }], 2000, { SHORT_ENABLED: true, SHORT_SLEEVE: 0 })).length === 0);

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
