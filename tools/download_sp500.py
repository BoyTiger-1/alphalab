"""Full S&P 500 universe downloader.

Grabs the current constituent list (with GICS sectors) from Wikipedia, then
10 years of weekly adjusted closes for every ticker from Yahoo. Output is a
compact bundle keyed to a shared weekly calendar:

  data/sp500.js -> window.ALPHALAB_SP500 =
    {asof, wcal: [dates], cols: {SYM: {n: name, sec: sector, f: first idx, s: scale, c: [ints]}}}
"""
import json
import os
import re
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw", "sp500")
os.makedirs(RAW, exist_ok=True)
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}


def fetch(url, timeout=30):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8")


def constituents():
    cache = os.path.join(RAW, "_list.json")
    if os.path.exists(cache):
        return json.load(open(cache, encoding="utf-8"))
    html = fetch("https://en.wikipedia.org/wiki/List_of_S%26P_500_companies")
    # each row: exchange-quote link (ticker), company wikilink (name), then the GICS sector cell
    rows = re.findall(
        r'class="external text"[^>]*>([A-Z][A-Z0-9.]{0,6})</a></td>\s*'
        r'<td[^>]*><a[^>]*title="([^"]+)"[^>]*>[^<]*</a></td><td[^>]*>([^<]+)</td>', html)
    out = [{"sym": s.replace(".", "-"), "name": n, "sector": sec.strip()} for s, n, sec in rows]
    # the changes table at the bottom matches the same pattern; the constituent table comes first
    seen, dedup = set(), []
    for r in out:
        if r["sym"] not in seen:
            seen.add(r["sym"])
            dedup.append(r)
    json.dump(dedup, open(cache, "w", encoding="utf-8"))
    print(f"constituent list: {len(dedup)} tickers")
    return dedup


def weekly(sym):
    cache = os.path.join(RAW, f"{sym}.json")
    if os.path.exists(cache):
        return json.load(open(cache, encoding="utf-8"))
    url = (f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(sym)}"
           f"?range=10y&interval=1wk")
    for attempt in range(3):
        try:
            j = json.loads(fetch(url))
            res = j["chart"]["result"][0]
            ts = res.get("timestamp")
            if not ts:
                return None
            adj = res["indicators"].get("adjclose", [{}])[0].get("adjclose") \
                or res["indicators"]["quote"][0]["close"]
            import datetime as dt
            epoch = dt.datetime(1970, 1, 1)
            rows = {}
            for i, t in enumerate(ts):
                d = (epoch + dt.timedelta(seconds=t)).strftime("%Y-%m-%d")
                if adj[i] and adj[i] > 0:
                    rows[d] = adj[i]
            json.dump(rows, open(cache, "w", encoding="utf-8"))
            return rows
        except Exception as e:
            if attempt == 2:
                print(f"  {sym}: FAILED {e}")
                return None
            time.sleep(3)


def scale_for(m):
    if m >= 10000: return 1
    if m >= 100: return 2
    return 4


def main():
    cons = constituents()
    spy = weekly("SPY")
    wcal = sorted(spy.keys())
    idx = {d: i for i, d in enumerate(wcal)}
    cols = {}
    for i, c in enumerate(cons):
        rows = weekly(c["sym"])
        time.sleep(0.30)
        if not rows:
            continue
        dates = [d for d in wcal if d in rows]
        if len(dates) < 60:      # need at least ~14 months to score factors
            print(f"  skip {c['sym']}: only {len(dates)} weeks")
            continue
        f = idx[dates[0]]
        vals, last = [], None
        for k in range(f, len(wcal)):
            if wcal[k] in rows:
                last = rows[wcal[k]]
            vals.append(last)
        s = scale_for(max(vals))
        k10 = 10 ** s
        cols[c["sym"]] = {"n": c["name"], "sec": c["sector"], "f": f, "s": s,
                          "c": [int(round(v * k10)) for v in vals]}
        if (i + 1) % 50 == 0:
            print(f"{i + 1}/{len(cons)} downloaded")
    bundle = {"asof": wcal[-1], "wcal": wcal, "cols": cols}
    js = "window.ALPHALAB_SP500=" + json.dumps(bundle, separators=(",", ":")) + ";"
    open(os.path.join(ROOT, "data", "sp500.js"), "w", encoding="utf-8").write(js)
    print(f"sp500.js: {len(js)/1e6:.2f} MB, {len(cols)} tickers, {len(wcal)} weeks")


if __name__ == "__main__":
    main()
