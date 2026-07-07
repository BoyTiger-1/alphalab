"""Shared metadata: asset-class map and OHLC candle subset. Also writes data/raw/_names.json."""
import json
import os

ETF = "ETF"; EQ = "Equity"; IDX = "Index"; FX = "FX"; FUT = "Futures"

YAHOO_CLS = {
    "SPY": ETF, "QQQ": ETF, "IWM": ETF, "DIA": ETF, "EFA": ETF, "EEM": ETF,
    "VTV": ETF, "VUG": ETF, "MTUM": ETF, "QUAL": ETF, "USMV": ETF,
    "TLT": ETF, "IEF": ETF, "SHY": ETF, "LQD": ETF, "HYG": ETF, "TIP": ETF,
    "GLD": ETF, "SLV": ETF, "USO": ETF, "DBC": ETF, "VNQ": ETF,
    "XLF": ETF, "XLK": ETF, "XLE": ETF, "XLV": ETF, "XLY": ETF, "XLP": ETF,
    "XLI": ETF, "XLU": ETF, "XLB": ETF,
    "AAPL": EQ, "MSFT": EQ, "NVDA": EQ, "AMZN": EQ, "GOOGL": EQ, "META": EQ,
    "TSLA": EQ, "JPM": EQ, "BAC": EQ, "XOM": EQ, "CVX": EQ, "JNJ": EQ,
    "UNH": EQ, "PG": EQ, "KO": EQ, "WMT": EQ, "V": EQ, "MA": EQ, "HD": EQ,
    "DIS": EQ, "NFLX": EQ, "AMD": EQ, "INTC": EQ, "CAT": EQ, "BA": EQ,
    "GE": EQ, "BRK-B": EQ,
    "^GSPC": IDX, "^NDX": IDX, "^DJI": IDX, "^RUT": IDX, "^VIX": IDX,
    "EURUSD=X": FX, "GBPUSD=X": FX, "USDJPY=X": FX, "AUDUSD=X": FX,
    "^TNX": IDX, "^FVX": IDX, "^TYX": IDX, "^IRX": IDX,
    "GC=F": FUT, "CL=F": FUT, "SI=F": FUT, "NG=F": FUT, "HG=F": FUT, "ZW=F": FUT,
}

OHLC_SET = {"SPY", "QQQ", "IWM", "^GSPC", "AAPL", "MSFT", "NVDA", "TSLA",
            "GLD", "TLT", "CL=F", "GC=F", "EURUSD=X", "^VIX"}


def write_names():
    from download_data import YAHOO, FRED, COINBASE
    raw = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "raw")
    os.makedirs(raw, exist_ok=True)
    with open(os.path.join(raw, "_names.json"), "w", encoding="utf-8") as f:
        json.dump({"yahoo": YAHOO, "fred": FRED, "coinbase": COINBASE}, f, indent=1)
    print("wrote _names.json")


if __name__ == "__main__":
    write_names()
