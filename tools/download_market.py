"""Total US market universe (VTI-style): every listed common stock above a small
size floor, from the Nasdaq screener list, with 3 years of weekly closes each.
The S&P 500 names keep their deeper 10y bundle; this covers the rest.

  data/market.js -> window.ALPHALAB_MKT =
    {asof, wcal, cols: {SYM: {n, sec, mc, f, s, c}}}
"""
import json
import os
import re
import time
import urllib.request
import urllib.parse
import datetime as dt

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw", "market")
os.makedirs(RAW, exist_ok=True)
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Accept": "application/json"}
MIN_CAP = 50e6          # $50M floor: below this, quotes get too gappy to trust
YEARS = "3y"


def fetch(url, timeout=40):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8")


def listing():
    cache = os.path.join(RAW, "_list.json")
    if os.path.exists(cache):
        return json.load(open(cache, encoding="utf-8"))
    j = json.loads(fetch("https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=10000&offset=0&download=true"))
    rows = j["data"]["rows"]
    out = []
    for r in rows:
        sym = r["symbol"].strip()
        # plain common stock tickers only: no units, warrants, preferreds, test issues
        if not re.fullmatch(r"[A-Z]{1,5}", sym):
            continue
        try:
            mc = float(r["marketCap"] or 0)
        except ValueError:
            mc = 0
        if mc < MIN_CAP:
            continue
        name = re.sub(r"\s+(Common Stock|Class [A-Z]( Common Stock)?|Ordinary Shares?).*$", "", r["name"]).strip()
        out.append({"sym": sym, "name": name[:40], "sector": (r.get("sector") or "Unknown")[:24], "mc": mc})
    # biggest first so the most important names land even if a pass gets cut short
    out.sort(key=lambda x: -x["mc"])
    json.dump(out, open(cache, "w", encoding="utf-8"))
    print(f"listing: {len(out)} common stocks over ${MIN_CAP/1e6:.0f}M")
    return out


def weekly(sym):
    cache = os.path.join(RAW, f"{sym}.json")
    if os.path.exists(cache):
        return json.load(open(cache, encoding="utf-8"))
    url = (f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(sym)}"
           f"?range={YEARS}&interval=1wk")
    for attempt in range(2):
        try:
            j = json.loads(fetch(url, timeout=25))
            res = j["chart"]["result"][0]
            ts = res.get("timestamp")
            if not ts:
                json.dump({}, open(cache, "w"))
                return {}
            adj = res["indicators"].get("adjclose", [{}])[0].get("adjclose") \
                or res["indicators"]["quote"][0]["close"]
            epoch = dt.datetime(1970, 1, 1)
            rows = {}
            for i, t in enumerate(ts):
                d = (epoch + dt.timedelta(seconds=t)).strftime("%Y-%m-%d")
                if adj[i] and adj[i] > 0:
                    rows[d] = adj[i]
            json.dump(rows, open(cache, "w", encoding="utf-8"))
            return rows
        except urllib.error.HTTPError as e:
            if e.code == 404:      # delisted or bad symbol: cache the miss, move on
                json.dump({}, open(cache, "w"))
                return {}
            if attempt == 1:
                return None
            time.sleep(4)
        except Exception:
            if attempt == 1:
                return None
            time.sleep(4)


def scale_for(m):
    if m >= 10000: return 1
    if m >= 100: return 2
    return 4


def main():
    cons = listing()
    # skip anything the deep S&P bundle already carries
    sp_syms = set()
    sp_path = os.path.join(ROOT, "data", "sp500.js")
    if os.path.exists(sp_path):
        src = open(sp_path, encoding="utf-8").read()
        sp_syms = set(json.loads(src[src.index("=") + 1:].rstrip(";"))["cols"].keys())
    spy = weekly("SPY")
    wcal = sorted(spy.keys())
    idx = {d: i for i, d in enumerate(wcal)}
    cols = {}
    done = miss = 0
    for i, c in enumerate(cons):
        if c["sym"] in sp_syms or c["sym"] == "SPY":
            continue
        rows = weekly(c["sym"])
        time.sleep(0.22)
        if not rows:
            miss += 1
            continue
        dates = [d for d in wcal if d in rows]
        if len(dates) < 60:
            continue
        f = idx[dates[0]]
        vals, last = [], None
        for k in range(f, len(wcal)):
            if wcal[k] in rows:
                last = rows[wcal[k]]
            vals.append(last)
        s = scale_for(max(vals))
        k10 = 10 ** s
        cols[c["sym"]] = {"n": c["name"], "sec": c["sector"], "mc": round(c["mc"] / 1e6),
                          "f": f, "s": s, "c": [int(round(v * k10)) for v in vals]}
        done += 1
        if done % 200 == 0:
            print(f"{done} encoded ({i + 1}/{len(cons)} scanned)", flush=True)
    bundle = {"asof": wcal[-1], "wcal": wcal, "cols": cols}
    js = "window.ALPHALAB_MKT=" + json.dumps(bundle, separators=(",", ":")) + ";"
    open(os.path.join(ROOT, "data", "market.js"), "w", encoding="utf-8").write(js)
    print(f"market.js: {len(js)/1e6:.2f} MB, {len(cols)} tickers ({miss} fetch misses), {len(wcal)} weeks")


if __name__ == "__main__":
    main()
