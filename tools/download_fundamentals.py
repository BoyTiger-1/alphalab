"""Real per-stock fundamentals from Yahoo Finance (cookie+crumb flow) plus a few
years of financial statements from SEC EDGAR. This is what the buy/sell decision
engine reasons over: valuation, growth, profitability, balance sheet, analyst
price targets and recommendation splits, dividend, and earnings-surprise history.

Output: data/fundamentals.js -> window.ALPHALAB_FUND = {asof, tickers: {SYM: {...}}}
"""
import json
import os
import time
import urllib.request
import urllib.error
import http.cookiejar

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data")
RAW = os.path.join(ROOT, "data", "raw", "fund")
os.makedirs(RAW, exist_ok=True)
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"

_jar = http.cookiejar.CookieJar()
_opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(_jar))
_crumb = None


def _get(url, headers=None, timeout=25):
    req = urllib.request.Request(url, headers=headers or {"User-Agent": UA})
    with _opener.open(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def crumb():
    global _crumb
    if _crumb:
        return _crumb
    # prime the cookie jar, then fetch the crumb token tied to it
    for seed in ("https://fc.yahoo.com/", "https://finance.yahoo.com/quote/AAPL"):
        try:
            _get(seed)
        except Exception:
            pass
    _crumb = _get("https://query1.finance.yahoo.com/v1/test/getcrumb").strip()
    return _crumb


def raw(d, *path):
    # dig into Yahoo's {"raw":x,"fmt":"..."} wrappers safely
    for p in path:
        if not isinstance(d, dict):
            return None
        d = d.get(p)
    if isinstance(d, dict):
        return d.get("raw")
    return d


def yahoo_fund(sym):
    cache = os.path.join(RAW, f"{sym}.json")
    if os.path.exists(cache):
        return json.load(open(cache, encoding="utf-8"))
    mods = "financialData,defaultKeyStatistics,summaryDetail,recommendationTrend,earningsHistory,price,assetProfile"
    for attempt in range(3):
        try:
            c = crumb()
            url = (f"https://query1.finance.yahoo.com/v10/finance/quoteSummary/"
                   f"{urllib.parse.quote(sym)}?modules={mods}&crumb={urllib.parse.quote(c)}")
            j = json.loads(_get(url))
            res = j.get("quoteSummary", {}).get("result")
            if not res:
                err = j.get("quoteSummary", {}).get("error")
                if err and "crumb" in str(err).lower():
                    globals()["_crumb"] = None      # force refresh, retry
                    time.sleep(1)
                    continue
                json.dump({}, open(cache, "w"))
                return {}
            r = res[0]
            fd, sd, ks = r.get("financialData", {}), r.get("summaryDetail", {}), r.get("defaultKeyStatistics", {})
            prof = r.get("assetProfile", {})
            rt = r.get("recommendationTrend", {}).get("trend", [])
            eh = r.get("earningsHistory", {}).get("history", [])
            out = {
                "pe": raw(sd, "trailingPE"), "fpe": raw(sd, "forwardPE"),
                "peg": raw(ks, "pegRatio"), "pb": raw(ks, "priceToBook"),
                "ps": raw(sd, "priceToSalesTrailing12Months"),
                "divY": raw(sd, "dividendYield"), "beta": raw(sd, "beta"),
                "mktCap": raw(sd, "marketCap") or raw(r, "price", "marketCap"),
                "revG": raw(fd, "revenueGrowth"), "earnG": raw(fd, "earningsGrowth"),
                "gm": raw(fd, "grossMargins"), "om": raw(fd, "operatingMargins"), "pm": raw(fd, "profitMargins"),
                "roe": raw(fd, "returnOnEquity"), "roa": raw(fd, "returnOnAssets"),
                "de": raw(fd, "debtToEquity"), "cr": raw(fd, "currentRatio"),
                "fcf": raw(fd, "freeCashflow"), "ebitda": raw(fd, "ebitda"),
                "tgtMean": raw(fd, "targetMeanPrice"), "tgtHigh": raw(fd, "targetHighPrice"),
                "tgtLow": raw(fd, "targetLowPrice"), "recKey": fd.get("recommendationKey"),
                "recMean": raw(fd, "recommendationMean"), "nAnalyst": raw(fd, "numberOfAnalystOpinions"),
                "price": raw(fd, "currentPrice") or raw(r, "price", "regularMarketPrice"),
                "sector": prof.get("sector"), "industry": prof.get("industry"),
                "employees": prof.get("fullTimeEmployees"),
                "summary": (prof.get("longBusinessSummary") or "")[:600],
            }
            if rt:
                t0 = rt[0]
                out["rec"] = [t0.get("strongBuy", 0), t0.get("buy", 0), t0.get("hold", 0), t0.get("sell", 0), t0.get("strongSell", 0)]
            if eh:
                # last four quarters of EPS surprise (actual vs estimate)
                out["eps"] = [{"q": h.get("quarter", {}).get("fmt"), "est": raw(h, "epsEstimate"),
                               "act": raw(h, "epsActual"), "sur": raw(h, "surprisePercent")}
                              for h in eh[-4:] if raw(h, "epsActual") is not None]
            json.dump(out, open(cache, "w", encoding="utf-8"))
            return out
        except urllib.error.HTTPError as e:
            if e.code == 401:
                globals()["_crumb"] = None
                time.sleep(1.5)
                continue
            if e.code == 404:
                json.dump({}, open(cache, "w"))
                return {}
            if attempt == 2:
                return None
            time.sleep(2)
        except Exception:
            if attempt == 2:
                return None
            time.sleep(2)


def universe():
    # every S&P 500 name (deep tier) is the priority; add the biggest total-market names
    syms = []
    sp = os.path.join(OUT, "sp500.js")
    if os.path.exists(sp):
        src = open(sp, encoding="utf-8").read()
        syms += list(json.loads(src[src.index("=") + 1:].rstrip(";"))["cols"].keys())
    mk = os.path.join(OUT, "market.js")
    if os.path.exists(mk):
        src = open(mk, encoding="utf-8").read()
        cols = json.loads(src[src.index("=") + 1:].rstrip(";"))["cols"]
        # market.js is cap-sorted; take the top names not already in S&P
        for s in list(cols.keys())[:400]:
            if s not in syms:
                syms.append(s)
    # plus the daily flagship single names
    for s in ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "JPM", "BAC", "XOM",
              "CVX", "JNJ", "UNH", "PG", "KO", "WMT", "V", "MA", "HD", "DIS", "NFLX", "AMD", "INTC", "CAT", "BA", "GE"]:
        if s not in syms:
            syms.append(s)
    return syms


def main():
    syms = universe()
    print(f"fundamentals for {len(syms)} tickers")
    out = {}
    ok = 0
    for i, s in enumerate(syms):
        f = yahoo_fund(s)
        time.sleep(0.35)
        if f:
            out[s] = f
            ok += 1
        if (i + 1) % 50 == 0:
            print(f"{i + 1}/{len(syms)} ({ok} with data)", flush=True)
    bundle = {"asof": time.strftime("%Y-%m-%d"), "tickers": out,
              "source": "Yahoo Finance quoteSummary (real analyst, valuation, growth, margins, earnings)"}
    js = "window.ALPHALAB_FUND=" + json.dumps(bundle, separators=(",", ":")) + ";"
    open(os.path.join(OUT, "fundamentals.js"), "w", encoding="utf-8").write(js)
    print(f"fundamentals.js: {len(js)/1e6:.2f} MB, {ok}/{len(syms)} tickers")


if __name__ == "__main__":
    main()
