"""Assembles the single-file AlphaLab app: app/* + data/bundle.js -> dist/alphalab.html"""
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.join(ROOT, "app")
DIST = os.path.join(ROOT, "dist")
os.makedirs(DIST, exist_ok=True)

PARTS = {
    "/*__CSS__*/": os.path.join(APP, "styles.css"),
    "/*__DATA__*/": os.path.join(ROOT, "data", "bundle.js"),
    "/*__ALTDATA__*/": os.path.join(ROOT, "data", "altdata.js"),
    "/*__CORE__*/": os.path.join(APP, "core.js"),
    "/*__QUANT__*/": os.path.join(APP, "quant.js"),
    "/*__CHARTS__*/": os.path.join(APP, "charts.js"),
    "/*__FACTORS__*/": os.path.join(APP, "factors.js"),
    "/*__ML__*/": os.path.join(APP, "ml.js"),
    "/*__STRATEGIES__*/": os.path.join(APP, "strategies.js"),
    "/*__REGISTRY__*/": os.path.join(APP, "registry.js"),
    "/*__RESEARCHER__*/": os.path.join(APP, "researcher.js"),
    "/*__MODULES_A__*/": os.path.join(APP, "modules_a.js"),
    "/*__MODULES_B__*/": os.path.join(APP, "modules_b.js"),
    "/*__MODULES_C__*/": os.path.join(APP, "modules_c.js"),
    "/*__MODULES_D__*/": os.path.join(APP, "modules_d.js"),
    "/*__MODULES_E__*/": os.path.join(APP, "modules_e.js"),
    "/*__MODULES_F__*/": os.path.join(APP, "modules_f.js"),
    "/*__MODULES_G__*/": os.path.join(APP, "modules_g.js"),
    "/*__TUTORIAL__*/": os.path.join(APP, "tutorial.js"),
    "/*__SP500__*/": os.path.join(ROOT, "data", "sp500.js"),
    "/*__MARKET__*/": os.path.join(ROOT, "data", "market.js"),
    "/*__FUND__*/": os.path.join(ROOT, "data", "fundamentals.js"),
    "/*__NEWS__*/": os.path.join(ROOT, "data", "newsfeed.js"),
}
# data bundles that may be absent in a minimal build
OPTIONAL = {"/*__ALTDATA__*/", "/*__SP500__*/", "/*__MARKET__*/", "/*__FUND__*/", "/*__NEWS__*/"}

html = open(os.path.join(APP, "index.html"), encoding="utf-8").read()
for marker, path in PARTS.items():
    if marker in OPTIONAL and not os.path.exists(path):
        html = html.replace(marker, f"/* optional bundle missing: {os.path.basename(path)} */")
        continue
    src = open(path, encoding="utf-8").read()
    if "</script" in src.lower():
        raise SystemExit(f"refusing: {path} contains </script>")
    html = html.replace(marker, src)

out = os.path.join(DIST, "alphalab.html")
open(out, "w", encoding="utf-8").write(html)
print(f"{out}: {len(html)/1e6:.2f} MB")
