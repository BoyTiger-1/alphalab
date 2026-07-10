"""Alt-data downloader: real news / social / attention data for the sentiment stack.

Three free sources, no keys:
  Wikipedia pageviews  -> daily public attention per company (last ~120 days)
  GDELT DOC 2.0        -> worldwide news tone + volume timelines (rate limit: 1 req / 5s)
  StockTwits           -> investor social sentiment (bullish/bearish message mix + watchers)

Writes data/altdata.js -> window.ALPHALAB_ALT
"""
import json
import os
import time
import datetime as dt
import urllib.request
import urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data")
UA = {"User-Agent": "AlphaLab-research/1.0 (educational; github.com/BoyTiger-1/alphalab)"}

# ticker -> (wikipedia article, gdelt news query, stocktwits symbol)
NAMES = {
    "AAPL": ("Apple_Inc.", '"Apple" stock', "AAPL"),
    "MSFT": ("Microsoft", '"Microsoft"', "MSFT"),
    "NVDA": ("Nvidia", '"Nvidia"', "NVDA"),
    "AMZN": ("Amazon_(company)", '"Amazon"', "AMZN"),
    "GOOGL": ("Google", '"Google"', "GOOGL"),
    "META": ("Meta_Platforms", '"Meta" "Facebook"', "META"),
    "TSLA": ("Tesla,_Inc.", '"Tesla"', "TSLA"),
    "JPM": ("JPMorgan_Chase", '"JPMorgan"', "JPM"),
    "BAC": ("Bank_of_America", '"Bank of America"', "BAC"),
    "XOM": ("ExxonMobil", '"Exxon"', "XOM"),
    "CVX": ("Chevron_Corporation", '"Chevron"', "CVX"),
    "JNJ": ("Johnson_%26_Johnson", '"Johnson and Johnson"', "JNJ"),
    "UNH": ("UnitedHealth_Group", '"UnitedHealth"', "UNH"),
    "PG": ("Procter_%26_Gamble", '"Procter"', "PG"),
    "KO": ("The_Coca-Cola_Company", '"Coca-Cola"', "KO"),
    "WMT": ("Walmart", '"Walmart"', "WMT"),
    "V": ("Visa_Inc.", '"Visa" payments', "V"),
    "MA": ("Mastercard", '"Mastercard"', "MA"),
    "HD": ("Home_Depot", '"Home Depot"', "HD"),
    "DIS": ("The_Walt_Disney_Company", '"Disney"', "DIS"),
    "NFLX": ("Netflix", '"Netflix"', "NFLX"),
    "AMD": ("AMD", '"AMD" chips', "AMD"),
    "INTC": ("Intel", '"Intel"', "INTC"),
    "CAT": ("Caterpillar_Inc.", '"Caterpillar"', "CAT"),
    "BA": ("Boeing", '"Boeing"', "BA"),
    "GE": ("GE_Aerospace", '"GE Aerospace"', "GE"),
    "BRK-B": ("Berkshire_Hathaway", '"Berkshire Hathaway"', "BRK.B"),
    "SPY": ("S%26P_500", '"S&P 500"', "SPY"),
    "QQQ": ("Nasdaq-100", '"Nasdaq"', "QQQ"),
    "BTC-USD": ("Bitcoin", '"Bitcoin"', "BTC.X"),
    "ETH-USD": ("Ethereum", '"Ethereum"', "ETH.X"),
}


def get(url, timeout=40):
    try:
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read().decode("utf-8", "replace")
    except Exception as e:
        print(f"  fail {url[:80]}: {e}")
        return None


def wiki(article):
    # daily user pageviews, last ~120 days
    end = dt.date.today()
    start = end - dt.timedelta(days=120)
    url = (f"https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/"
           f"all-access/user/{article}/daily/{start:%Y%m%d}00/{end:%Y%m%d}00")
    txt = get(url)
    if not txt:
        return None
    try:
        items = json.loads(txt).get("items", [])
        if not items:
            return None
        d0 = items[0]["timestamp"][:8]
        d0 = f"{d0[:4]}-{d0[4:6]}-{d0[6:8]}"
        return {"d0": d0, "v": [it["views"] for it in items]}
    except Exception:
        return None


def gdelt(query, mode):
    # tone or volume timeline over the last 2 months, worldwide news coverage
    q = urllib.parse.quote(query)
    url = (f"https://api.gdeltproject.org/api/v2/doc/doc?query={q}"
           f"&mode={mode}&timespan=2months&format=json")
    txt = get(url, timeout=60)
    if not txt or not txt.startswith("{"):
        return None
    try:
        tl = json.loads(txt)["timeline"][0]["data"]
        return {"d": [p["date"][:8] for p in tl], "v": [round(p["value"], 2) for p in tl]}
    except Exception:
        return None


def stocktwits(sym):
    txt = get(f"https://api.stocktwits.com/api/2/streams/symbol/{sym}.json")
    if not txt:
        return None
    try:
        j = json.loads(txt)
        msgs = j.get("messages", [])
        bull = bear = 0
        for m in msgs:
            s = (m.get("entities") or {}).get("sentiment") or {}
            if s.get("basic") == "Bullish":
                bull += 1
            elif s.get("basic") == "Bearish":
                bear += 1
        return {"bull": bull, "bear": bear, "msgs": len(msgs),
                "watchers": j.get("symbol", {}).get("watchlist_count")}
    except Exception:
        return None


def main():
    out = {}
    # fast passes first so a GDELT stall doesn't cost the cheap data
    for t, (art, q, st) in NAMES.items():
        entry = {}
        w = wiki(art)
        if w:
            entry["wiki"] = w
        s = stocktwits(st)
        if s:
            entry["st"] = s
        out[t] = entry
        print(f"{t}: wiki={'ok' if w else 'no'} st={'ok' if s else 'no'}")
        time.sleep(0.4)
    # GDELT is rate limited to one request per 5 seconds, so this part is slow
    for t, (art, q, st) in NAMES.items():
        tone = gdelt(q, "timelinetone")
        time.sleep(5.5)
        vol = gdelt(q, "timelinevol")
        time.sleep(5.5)
        if tone:
            out[t]["newsTone"] = tone
        if vol:
            out[t]["newsVol"] = vol
        print(f"{t}: tone={'ok' if tone else 'no'} vol={'ok' if vol else 'no'}")

    bundle = {
        "asof": dt.date.today().isoformat(),
        "tickers": out,
        "sources": {
            "wiki": "Wikipedia pageviews API (public attention, daily)",
            "news": "GDELT 2.0 DOC API (worldwide news tone and volume, 2 months)",
            "social": "StockTwits public API (investor message sentiment + watchers)",
        },
    }
    js = "window.ALPHALAB_ALT=" + json.dumps(bundle, separators=(",", ":")) + ";"
    with open(os.path.join(OUT, "altdata.js"), "w", encoding="utf-8") as f:
        f.write(js)
    n_ok = sum(1 for e in out.values() if e)
    print(f"altdata.js: {len(js)//1024} KB, {n_ok}/{len(NAMES)} tickers")


if __name__ == "__main__":
    main()
