"""AlphaLab data downloader.

Pulls real historical market data from free public sources:
  - Yahoo Finance v8 chart API (equities, ETFs, indices, FX, futures)
  - FRED fredgraph CSV (rates, macro, VIX, credit spreads)
  - Coinbase Exchange public candles API (crypto)

Raw responses are cached under data/raw/ so re-runs are incremental.
"""
import json
import os
import sys
import time
import urllib.request
import urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw")
os.makedirs(RAW, exist_ok=True)

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}

YAHOO = {
    # Broad market / style ETFs
    "SPY": "SPDR S&P 500 ETF", "QQQ": "Invesco Nasdaq-100 ETF", "IWM": "iShares Russell 2000 ETF",
    "DIA": "SPDR Dow Jones ETF", "EFA": "iShares MSCI EAFE ETF", "EEM": "iShares MSCI EM ETF",
    "VTV": "Vanguard Value ETF", "VUG": "Vanguard Growth ETF", "MTUM": "iShares Momentum Factor ETF",
    "QUAL": "iShares Quality Factor ETF", "USMV": "iShares Min Vol Factor ETF",
    # Fixed income
    "TLT": "iShares 20+Y Treasury ETF", "IEF": "iShares 7-10Y Treasury ETF", "SHY": "iShares 1-3Y Treasury ETF",
    "LQD": "iShares IG Corporate ETF", "HYG": "iShares High Yield ETF", "TIP": "iShares TIPS ETF",
    # Commodities / real assets
    "GLD": "SPDR Gold Shares", "SLV": "iShares Silver Trust", "USO": "United States Oil Fund",
    "DBC": "Invesco DB Commodity ETF", "VNQ": "Vanguard Real Estate ETF",
    # Sector SPDRs
    "XLF": "Financials SPDR", "XLK": "Technology SPDR", "XLE": "Energy SPDR", "XLV": "Health Care SPDR",
    "XLY": "Cons Discretionary SPDR", "XLP": "Cons Staples SPDR", "XLI": "Industrials SPDR",
    "XLU": "Utilities SPDR", "XLB": "Materials SPDR",
    # Mega-cap equities
    "AAPL": "Apple Inc", "MSFT": "Microsoft Corp", "NVDA": "NVIDIA Corp", "AMZN": "Amazon.com Inc",
    "GOOGL": "Alphabet Inc", "META": "Meta Platforms Inc", "TSLA": "Tesla Inc", "JPM": "JPMorgan Chase",
    "BAC": "Bank of America", "XOM": "Exxon Mobil", "CVX": "Chevron Corp", "JNJ": "Johnson & Johnson",
    "UNH": "UnitedHealth Group", "PG": "Procter & Gamble", "KO": "Coca-Cola Co", "WMT": "Walmart Inc",
    "V": "Visa Inc", "MA": "Mastercard Inc", "HD": "Home Depot", "DIS": "Walt Disney Co",
    "NFLX": "Netflix Inc", "AMD": "Advanced Micro Devices", "INTC": "Intel Corp", "CAT": "Caterpillar Inc",
    "BA": "Boeing Co", "GE": "GE Aerospace", "BRK-B": "Berkshire Hathaway B",
    # Indices
    "^GSPC": "S&P 500 Index", "^NDX": "Nasdaq-100 Index", "^DJI": "Dow Jones Industrial Avg",
    "^RUT": "Russell 2000 Index", "^VIX": "CBOE Volatility Index",
    # FX
    "EURUSD=X": "EUR/USD", "GBPUSD=X": "GBP/USD", "USDJPY=X": "USD/JPY", "AUDUSD=X": "AUD/USD",
    # Futures (continuous front month)
    "^TNX": "10-Year Treasury Yield Index", "^FVX": "5-Year Treasury Yield Index",
    "^TYX": "30-Year Treasury Yield Index", "^IRX": "13-Week T-Bill Yield Index",
    "GC=F": "Gold Futures", "CL=F": "WTI Crude Futures", "SI=F": "Silver Futures",
    "NG=F": "Natural Gas Futures", "HG=F": "Copper Futures", "ZW=F": "Wheat Futures",
}

FRED = {
    "DGS3MO": "3-Month Treasury Yield", "DGS2": "2-Year Treasury Yield", "DGS5": "5-Year Treasury Yield",
    "DGS10": "10-Year Treasury Yield", "DGS30": "30-Year Treasury Yield",
    "T10Y2Y": "10Y-2Y Yield Spread", "T10Y3M": "10Y-3M Yield Spread",
    "FEDFUNDS": "Effective Fed Funds Rate", "CPIAUCSL": "CPI (All Urban)", "UNRATE": "Unemployment Rate",
    "PAYEMS": "Nonfarm Payrolls", "UMCSENT": "U. Michigan Consumer Sentiment", "INDPRO": "Industrial Production",
    "M2SL": "M2 Money Supply", "GDPC1": "Real GDP", "VIXCLS": "VIX Close (CBOE)",
    "BAMLH0A0HYM2": "US High Yield OAS", "BAMLC0A0CM": "US IG Corporate OAS",
    "DTWEXBGS": "Trade-Weighted USD Index", "HOUST": "Housing Starts", "ICSA": "Initial Jobless Claims",
    "RSAFS": "Retail Sales", "PERMIT": "Building Permits", "DCOILWTICO": "WTI Spot Price",
}

COINBASE = {
    "BTC-USD": "Bitcoin", "ETH-USD": "Ethereum", "SOL-USD": "Solana", "LTC-USD": "Litecoin",
    "ADA-USD": "Cardano", "LINK-USD": "Chainlink", "AVAX-USD": "Avalanche", "DOGE-USD": "Dogecoin",
}


def fetch(url, retries=3):
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read().decode("utf-8")
        except Exception as e:
            if i == retries - 1:
                print(f"  FAILED {url}: {e}")
                return None
            time.sleep(2 * (i + 1))


def fetch_curl(url, retries=3):
    """Some hosts (FRED) drop Python's TLS client; curl works."""
    import subprocess
    for i in range(retries):
        try:
            p = subprocess.run(["curl", "-s", "--max-time", "40", "-A", "curl/8.0", url],
                               capture_output=True, timeout=60)
            if p.returncode == 0 and p.stdout:
                return p.stdout.decode("utf-8")
        except Exception:
            pass
        time.sleep(2 * (i + 1))
    print(f"  FAILED (curl) {url}")
    return None


def dl_yahoo():
    for sym in YAHOO:
        safe = sym.replace("^", "_").replace("=", "_").replace("/", "_")
        path = os.path.join(RAW, f"yahoo_{safe}.json")
        if os.path.exists(path):
            print(f"yahoo {sym}: cached")
            continue
        url = (f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(sym)}"
               f"?period1=0&period2=9999999999&interval=1d&events=div%2Csplit")
        txt = fetch(url)
        if txt:
            with open(path, "w", encoding="utf-8") as f:
                f.write(txt)
            print(f"yahoo {sym}: ok ({len(txt)//1024} KB)")
        time.sleep(0.5)


def dl_fred():
    for sid in FRED:
        path = os.path.join(RAW, f"fred_{sid}.csv")
        if os.path.exists(path):
            print(f"fred {sid}: cached")
            continue
        txt = fetch_curl(f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={sid}")
        if txt and txt.startswith("observation_date"):
            with open(path, "w", encoding="utf-8") as f:
                f.write(txt)
            print(f"fred {sid}: ok ({len(txt)//1024} KB)")
        else:
            print(f"fred {sid}: BAD RESPONSE")
        time.sleep(0.4)


def dl_coinbase():
    day = 86400
    for pid in COINBASE:
        path = os.path.join(RAW, f"cb_{pid}.json")
        if os.path.exists(path):
            print(f"coinbase {pid}: cached")
            continue
        candles = []
        end = int(time.time())
        # paginate backwards, 300 daily candles per request
        while True:
            start = end - 300 * day
            url = (f"https://api.exchange.coinbase.com/products/{pid}/candles"
                   f"?granularity={day}&start={start}&end={end}")
            txt = fetch(url)
            if not txt:
                break
            batch = json.loads(txt)
            if not isinstance(batch, list) or not batch:
                break
            candles.extend(batch)
            end = min(c[0] for c in batch) - day
            time.sleep(0.35)
            if len(batch) < 5:
                break
        if candles:
            candles.sort(key=lambda c: c[0])
            with open(path, "w", encoding="utf-8") as f:
                json.dump(candles, f)
            print(f"coinbase {pid}: ok ({len(candles)} candles)")


if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else "all"
    if which in ("all", "yahoo"):
        dl_yahoo()
    if which in ("all", "fred"):
        dl_fred()
    if which in ("all", "coinbase"):
        dl_coinbase()
    print("done")
