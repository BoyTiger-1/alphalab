'use strict';
// A tiny, dependency-free client for Alpaca's paper Trading API. Node 18+ ships a global fetch, so
// there is nothing to install. Every call carries the two auth headers, and any non-2xx response is
// turned into a thrown Error that includes Alpaca's X-Request-ID, which is the id their support asks
// for when something goes wrong. Keys come in through the constructor from environment variables and
// are never logged.

class Alpaca {
  constructor(keyId, secretKey, baseUrl) {
    if (!keyId || !secretKey) throw new Error('missing Alpaca API keys (set ALPACA_KEY_ID and ALPACA_SECRET_KEY)');
    this.base = (baseUrl || 'https://paper-api.alpaca.markets').replace(/\/+$/, '');
    this.headers = {
      'APCA-API-KEY-ID': keyId,
      'APCA-API-SECRET-KEY': secretKey,
      'Content-Type': 'application/json',
    };
  }

  // one place for every request so error handling and the request-id capture are consistent
  async _req(method, path, body) {
    const res = await fetch(this.base + path, {
      method,
      headers: this.headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const reqId = res.headers.get('x-request-id') || '';
    const text = await res.text();
    let data = null;
    if (text) { try { data = JSON.parse(text); } catch (e) { data = text; } }
    if (!res.ok) {
      const msg = (data && data.message) ? data.message : (typeof data === 'string' ? data : res.statusText);
      const err = new Error(`Alpaca ${method} ${path} -> ${res.status} ${msg} [req ${reqId}]`);
      err.status = res.status;
      err.requestId = reqId;
      throw err;
    }
    return data;
  }

  // account equity, cash, and the previous close equity we use for the daily-loss check
  account() { return this._req('GET', '/v2/account'); }

  // whether the US equity market is open right now, so we never fire market orders into a closed book
  clock() { return this._req('GET', '/v2/clock'); }

  // every open position, with market_value and unrealized_pl already computed by Alpaca
  positions() { return this._req('GET', '/v2/positions'); }

  // one page of fill activities (order executions), oldest first. The learning layer reads these to
  // reconstruct how each name has actually done, so the bot can learn from its own closed trades.
  fills(pageToken) {
    const q = 'activity_types=FILL&direction=asc&page_size=100' + (pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : '');
    return this._req('GET', `/v2/account/activities?${q}`);
  }

  // asset metadata, mainly so we know if a symbol is tradable and can be bought in fractional dollars
  asset(symbol) { return this._req('GET', `/v2/assets/${encodeURIComponent(symbol)}`); }

  // submit an order. Pass either { notional } for a fractional dollar buy or { qty } for share count.
  // Everything here is a plain market/day order, which is all the bot needs and all that fractional
  // orders are allowed to be.
  submitOrder(o) {
    const body = { symbol: o.symbol, side: o.side, type: 'market', time_in_force: 'day' };
    if (o.notional != null) body.notional = String(o.notional);
    else body.qty = String(o.qty);
    if (o.clientOrderId) body.client_order_id = o.clientOrderId;
    return this._req('POST', '/v2/orders', body);
  }

  // fully close one position at market. Cleaner than computing an exact sell qty when we want out.
  closePosition(symbol) { return this._req('DELETE', `/v2/positions/${encodeURIComponent(symbol)}`); }

  // the kill switch: liquidate the whole book and cancel any resting orders in one call
  closeAll() { return this._req('DELETE', '/v2/positions?cancel_orders=true'); }
}

module.exports = Alpaca;
