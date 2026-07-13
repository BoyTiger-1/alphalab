"""Real news headlines (GDELT article list) and real social post bodies
(StockTwits messages) for the most-watched tickers. Feeds the news reel and
the social panel in the buy/sell decision engine.

Output: data/newsfeed.js -> window.ALPHALAB_NEWS = {asof, tickers: {SYM: {news:[...], posts:[...]}}}
"""
import json
import os
import time
import urllib.request
import urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data")
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36"

# the names people actually look up, plus a few ETFs and crypto
WATCHED = {
    "AAPL": '"Apple Inc"', "MSFT": '"Microsoft"', "NVDA": '"Nvidia"', "AMZN": '"Amazon.com"',
    "GOOGL": '"Google"', "META": '"Meta Platforms"', "TSLA": '"Tesla Inc"', "JPM": '"JPMorgan"',
    "BAC": '"Bank of America"', "XOM": '"Exxon"', "CVX": '"Chevron"', "JNJ": '"Johnson and Johnson"',
    "UNH": '"UnitedHealth"', "PG": '"Procter Gamble"', "KO": '"Coca-Cola"', "WMT": '"Walmart"',
    "V": '"Visa Inc"', "MA": '"Mastercard"', "HD": '"Home Depot"', "DIS": '"Walt Disney"',
    "NFLX": '"Netflix"', "AMD": '"AMD"', "INTC": '"Intel"', "CAT": '"Caterpillar"', "BA": '"Boeing"',
    "GE": '"GE Aerospace"', "CRM": '"Salesforce"', "ORCL": '"Oracle"', "ADBE": '"Adobe"',
    "PFE": '"Pfizer"', "KO": '"Coca-Cola"', "PEP": '"PepsiCo"', "COST": '"Costco"', "MCD": '"McDonald"',
    "NKE": '"Nike"', "SBUX": '"Starbucks"', "GS": '"Goldman Sachs"', "MS": '"Morgan Stanley"',
    "WFC": '"Wells Fargo"', "T": '"AT&T"', "VZ": '"Verizon"', "F": '"Ford Motor"', "GM": '"General Motors"',
    "PLTR": '"Palantir"', "COIN": '"Coinbase"', "UBER": '"Uber"', "ABNB": '"Airbnb"',
    "SPY": '"S&P 500"', "QQQ": '"Nasdaq 100"', "BTC-USD": '"Bitcoin"', "ETH-USD": '"Ethereum"',
}
STOCKTWITS = {**{s: s for s in WATCHED}, "BTC-USD": "BTC.X", "ETH-USD": "ETH.X"}


def get(url, timeout=40):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read().decode("utf-8", "replace")
    except Exception as e:
        print(f"  fail {url[:70]}: {e}")
        return None


def gdelt_news(query):
    q = urllib.parse.quote(query)
    txt = get(f"https://api.gdeltproject.org/api/v2/doc/doc?query={q}"
              f"&mode=artlist&maxrecords=8&timespan=2weeks&format=json&sort=datedesc", timeout=50)
    if not txt or not txt.strip().startswith("{"):
        return None
    try:
        arts = json.loads(txt).get("articles", [])
        seen, out = set(), []
        for a in arts:
            t = a.get("title", "").strip()
            if not t or t in seen:
                continue
            seen.add(t)
            out.append({"t": t[:140], "d": a.get("seendate", "")[:8], "dom": a.get("domain", ""),
                        "u": a.get("url", ""), "tone": a.get("tone")})
        return out[:6] or None
    except Exception:
        return None


def stocktwits_posts(sym):
    txt = get(f"https://api.stocktwits.com/api/2/streams/symbol/{sym}.json", timeout=25)
    if not txt:
        return None
    try:
        msgs = json.loads(txt).get("messages", [])
        out = []
        for m in msgs[:12]:
            body = (m.get("body") or "").strip()
            if len(body) < 12:
                continue
            s = (m.get("entities") or {}).get("sentiment") or {}
            out.append({"b": body[:220], "s": s.get("basic"),
                        "u": m.get("user", {}).get("username", ""),
                        "f": m.get("user", {}).get("followers", 0),
                        "t": (m.get("created_at") or "")[:10]})
        return out[:8] or None
    except Exception:
        return None


def main():
    out = {}
    # stocktwits first (fast, reliable), then gdelt (rate limited, slow)
    for sym in WATCHED:
        posts = stocktwits_posts(STOCKTWITS.get(sym, sym))
        out.setdefault(sym, {})
        if posts:
            out[sym]["posts"] = posts
        print(f"{sym}: posts={'ok' if posts else 'no'}", flush=True)
        time.sleep(0.4)
    for sym, q in WATCHED.items():
        news = gdelt_news(q)
        if news:
            out.setdefault(sym, {})["news"] = news
        print(f"{sym}: news={'ok' if news else 'no'}", flush=True)
        time.sleep(5.5)
    bundle = {"asof": time.strftime("%Y-%m-%d"), "tickers": out,
              "source": "GDELT article list (real headlines) + StockTwits (real investor posts)"}
    js = "window.ALPHALAB_NEWS=" + json.dumps(bundle, separators=(",", ":")) + ";"
    open(os.path.join(OUT, "newsfeed.js"), "w", encoding="utf-8").write(js)
    n = sum(1 for v in out.values() if v)
    print(f"newsfeed.js: {len(js)//1024} KB, {n} tickers, "
          f"{sum(1 for v in out.values() if v.get('news'))} with news, "
          f"{sum(1 for v in out.values() if v.get('posts'))} with posts")


if __name__ == "__main__":
    main()
