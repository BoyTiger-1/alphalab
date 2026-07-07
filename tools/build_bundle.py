"""Builds the compact AlphaLab data bundle (v2, integer-scaled) from raw downloads.

Output: data/bundle.js  ->  window.ALPHALAB_DATA = {...}

Layout:
  cal      : shared US trading calendar (YYYY-MM-DD, from SPY, 2000+)
  series   : {sym: {n, cls, f: first idx, s: scale, c: [int prices*10^s]}}
             ^GSPC also has pre: {d:[dates], s, c} (daily 1985+, weekly before)
  ohlc     : {sym: {f, s, c: [ints], o/h/l: [bp offsets vs close], v: [vol $M]}}
  fred     : daily series aligned to cal: {id: {n, a:1, f, s, c}}
             low-freq series: {id: {n, d:[dates], v:[values]}}
  crypto   : {sym: {n, d0, s, c, (o/h/l bp + v for majors)}}
"""
import json
import os
import datetime as dt

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw")
OUT = os.path.join(ROOT, "data")

from download_data_meta import YAHOO_CLS, OHLC_SET  # noqa: E402

MIN_DATE = "2000-01-01"
OHLC_FROM = "2018-01-01"
DROP_FRED = {"VIXCLS", "DCOILWTICO"}       # redundant with ^VIX / CL=F
# FRED series that are (business-)daily -> align to trading calendar
FRED_DAILY = {"DGS3MO", "DGS2", "DGS5", "DGS10", "DGS30", "T10Y2Y", "T10Y3M",
              "BAMLH0A0HYM2", "BAMLC0A0CM", "DTWEXBGS"}


def scale_for(vals):
    m = max(abs(v) for v in vals if v is not None)
    if m >= 10000: return 1
    if m >= 100: return 2
    if m >= 1: return 4
    return 6


def enc(vals, s):
    k = 10 ** s
    return [None if v is None else int(round(v * k)) for v in vals]


def load_yahoo(sym):
    safe = sym.replace("^", "_").replace("=", "_").replace("/", "_")
    path = os.path.join(RAW, f"yahoo_{safe}.json")
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as f:
        j = json.load(f)
    res = j["chart"]["result"][0]
    ts = res.get("timestamp")
    if not ts:
        return None
    q = res["indicators"]["quote"][0]
    adj = res["indicators"].get("adjclose", [{}])[0].get("adjclose") or q["close"]
    epoch = dt.datetime(1970, 1, 1)
    dates = [(epoch + dt.timedelta(seconds=t - 5 * 3600)).strftime("%Y-%m-%d") for t in ts]
    rows = {}
    for i, d in enumerate(dates):
        c = adj[i]
        if c is None or c <= 0:
            continue
        rows[d] = {"c": c, "o": q["open"][i], "h": q["high"][i], "l": q["low"][i],
                   "rc": q["close"][i], "v": q["volume"][i]}
    return rows


def main():
    meta = json.load(open(os.path.join(RAW, "_names.json"), encoding="utf-8"))
    yahoo_names, fred_names, cb_names = meta["yahoo"], meta["fred"], meta["coinbase"]

    spy = load_yahoo("SPY")
    cal = sorted(d for d in spy if d >= MIN_DATE)
    idx = {d: i for i, d in enumerate(cal)}

    series, ohlc = {}, {}
    for sym, name in yahoo_names.items():
        rows = load_yahoo(sym)
        if not rows:
            print(f"skip {sym}: no data")
            continue
        dates = [d for d in cal if d in rows]
        if len(dates) < 100:
            print(f"skip {sym}: only {len(dates)} rows in calendar")
            continue
        first = idx[dates[0]]
        closes, last = [], None
        for i in range(first, len(cal)):
            r = rows.get(cal[i])
            if r:
                last = r["c"]
            closes.append(last)
        s = scale_for(closes)
        entry = {"n": name, "cls": YAHOO_CLS[sym], "f": first, "s": s, "c": enc(closes, s)}
        if sym == "^GSPC":   # long history tail for crisis replay (Black Monday, dot-com)
            pre_dates = sorted(d for d in rows if d < MIN_DATE)
            keep, prev_week = [], None
            for d in pre_dates:
                if d >= "1985-01-01":
                    keep.append(d)
                else:
                    wk = dt.date.fromisoformat(d).isocalendar()[:2]
                    if wk != prev_week:
                        keep.append(d); prev_week = wk
            pv = [rows[d]["c"] for d in keep]
            ps = scale_for(pv)
            entry["pre"] = {"d": keep, "s": ps, "c": enc(pv, ps)}
        series[sym] = entry

        if sym in OHLC_SET:
            odates = [d for d in dates if d >= OHLC_FROM]
            if not odates:
                continue
            of = idx[odates[0]]
            oc, oo, oh, ol, ov = [], [], [], [], []
            lastr = None
            for i in range(of, len(cal)):
                r = rows.get(cal[i])
                if r and r["rc"]:
                    lastr = r
                rc = lastr["rc"]
                oc.append(rc)
                for arr, k in ((oo, "o"), (oh, "h"), (ol, "l")):
                    val = lastr[k]
                    arr.append(0 if val is None else int(round((val / rc - 1) * 1e4)))
                ov.append(round((lastr["v"] or 0) / 1e6, 1))
            osc = scale_for(oc)
            ohlc[sym] = {"f": of, "s": osc, "c": enc(oc, osc), "o": oo, "h": oh, "l": ol, "v": ov}

    fred = {}
    for sid, name in fred_names.items():
        if sid in DROP_FRED:
            continue
        path = os.path.join(RAW, f"fred_{sid}.csv")
        if not os.path.exists(path):
            continue
        d_, v_ = [], []
        for line in open(path, encoding="utf-8").read().strip().split("\n")[1:]:
            date, val = line.split(",")
            if val in ("", "."):
                continue
            d_.append(date); v_.append(float(val))
        if sid in FRED_DAILY:
            m = dict(zip(d_, v_))
            firsts = [d for d in cal if d in m]
            if not firsts:
                continue
            f0 = idx[firsts[0]]
            vals, last = [], None
            for i in range(f0, len(cal)):
                if cal[i] in m:
                    last = m[cal[i]]
                vals.append(last)
            s = scale_for(vals)
            fred[sid] = {"n": name, "a": 1, "f": f0, "s": s, "c": enc(vals, s)}
        else:
            keep = [i for i, d in enumerate(d_) if d >= "1960-01-01"]
            fred[sid] = {"n": name, "d": [d_[i] for i in keep],
                         "v": [round(v_[i], 2) for i in keep]}

    crypto = {}
    for pid, name in cb_names.items():
        path = os.path.join(RAW, f"cb_{pid}.json")
        if not os.path.exists(path):
            continue
        candles = json.load(open(path, encoding="utf-8"))
        seen = {}
        for t, lo, hi, op, cl, vol in candles:
            seen[t] = (lo, hi, op, cl, vol)
        ts = sorted(seen)
        day = 86400
        d0 = (dt.datetime(1970, 1, 1) + dt.timedelta(seconds=ts[0])).strftime("%Y-%m-%d")
        n_days = (ts[-1] - ts[0]) // day + 1
        c, o, h, l, v = [], [], [], [], []
        last = None
        for i in range(n_days):
            t = ts[0] + i * day
            if t in seen:
                last = seen[t]
            lo, hi, op, cl, vol = last
            c.append(cl)
            o.append(int(round((op / cl - 1) * 1e4)))
            h.append(int(round((hi / cl - 1) * 1e4)))
            l.append(int(round((lo / cl - 1) * 1e4)))
            v.append(round(vol * cl / 1e6, 1))
        s = scale_for(c)
        entry = {"n": name, "d0": d0, "s": s, "c": enc(c, s)}
        if pid in ("BTC-USD", "ETH-USD", "SOL-USD"):
            entry.update({"o": o, "h": h, "l": l, "v": v})
        crypto[pid] = entry

    bundle = {"cal": cal, "series": series, "ohlc": ohlc, "fred": fred,
              "crypto": crypto, "asof": cal[-1],
              "built": dt.datetime.now().strftime("%Y-%m-%d %H:%M"),
              "sources": {"equities": "Yahoo Finance (adjusted daily closes, full history)",
                          "macro": "FRED — Federal Reserve Bank of St. Louis",
                          "crypto": "Coinbase Exchange (daily candles)"}}
    js = "window.ALPHALAB_DATA=" + json.dumps(bundle, separators=(",", ":")) + ";"
    with open(os.path.join(OUT, "bundle.js"), "w", encoding="utf-8") as f:
        f.write(js)
    print(f"bundle.js: {len(js)/1e6:.2f} MB | {len(series)} series, {len(ohlc)} ohlc, "
          f"{len(fred)} fred, {len(crypto)} crypto | cal {cal[0]}..{cal[-1]} ({len(cal)} days)")


if __name__ == "__main__":
    main()
