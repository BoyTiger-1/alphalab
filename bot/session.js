'use strict';
// Tells the workflow where we are in the trading day, from Alpaca's own market clock, so the supervisor
// loop knows when to start trading, when to stop, and whether to hand off to a fresh job. Prints one
// line: "<state> <seconds>", where state is 'open' (seconds until the close) or 'closed' (seconds until
// the next open). Holidays and early closes come straight from Alpaca, so nothing here hard-codes hours.
// On any error it prints "error 0" and the workflow treats that as closed, so it never loops blind.

const Alpaca = require('./alpaca');
const cfg = require('./config');

(async () => {
  try {
    const clock = await new Alpaca(process.env.ALPACA_KEY_ID, process.env.ALPACA_SECRET_KEY, cfg.ALPACA_BASE_URL).clock();
    const now = Date.parse(clock.timestamp);
    const secs = t => Math.max(0, Math.round((Date.parse(t) - now) / 1000));
    console.log(clock.is_open ? `open ${secs(clock.next_close)}` : `closed ${secs(clock.next_open)}`);
  } catch (e) {
    console.log('error 0');
  }
})();
