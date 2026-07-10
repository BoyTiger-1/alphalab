"""Second pass for altdata: refetch whatever 429'd in the first run, slowly.
Wikipedia gets 2.5s spacing, GDELT gets 20s. Merges into the existing altdata.js."""
import json
import time
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from download_altdata import NAMES, wiki, gdelt, OUT  # reuse the fetchers

path = os.path.join(OUT, "altdata.js")
src = open(path, encoding="utf-8").read()
bundle = json.loads(src[src.index("=") + 1:].rstrip(";"))
t = bundle["tickers"]

def save():
    # write after every success so a killed run keeps its progress
    js = "window.ALPHALAB_ALT=" + json.dumps(bundle, separators=(",", ":")) + ";"
    open(path, "w", encoding="utf-8").write(js)

# wikipedia first, it recovers fast
for sym, (art, q, st) in NAMES.items():
    if "wiki" in t.get(sym, {}):
        continue
    w = wiki(art)
    if w:
        t.setdefault(sym, {})["wiki"] = w
        save()
    print(f"wiki {sym}: {'ok' if w else 'still failing'}")
    time.sleep(2.5)

# gdelt needs long gaps after a 429 streak
for sym, (art, q, st) in NAMES.items():
    entry = t.setdefault(sym, {})
    if "newsTone" not in entry:
        tone = gdelt(q, "timelinetone")
        if tone:
            entry["newsTone"] = tone
            save()
        print(f"tone {sym}: {'ok' if tone else 'no'}")
        time.sleep(20)
    if "newsVol" not in entry:
        vol = gdelt(q, "timelinevol")
        if vol:
            entry["newsVol"] = vol
            save()
        print(f"vol {sym}: {'ok' if vol else 'no'}")
        time.sleep(20)

save()
wk = sum(1 for e in t.values() if "wiki" in e)
tn = sum(1 for e in t.values() if "newsTone" in e)
vl = sum(1 for e in t.values() if "newsVol" in e)
print(f"final: wiki {wk}/{len(t)}, tone {tn}/{len(t)}, vol {vl}/{len(t)}, {len(js)//1024} KB")
