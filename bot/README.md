# AlphaLab autonomous paper bot

This trades a paper (fake money) portfolio by itself, in the cloud, with your computer off. It uses
your real AlphaLab engines as the brain and Alpaca's paper account as the hands. No human clicks are
needed once it is set up.

## How it works

```
about once a minute, all session:
  live quotes  ->  AlphaLab engines recompute on live prices  ->  learning from past trades  ->  Alpaca paper
   Finnhub          six-engine target book, live regime            realized P&L per name         executes + P&L
```

Every run does the full loop on fresh data, roughly once a minute the whole session:

1. Reads your Alpaca paper account (equity, cash, positions, live P&L per name).
2. Checks two safety gates: the market must be open, and you must not be past the daily loss limit.
3. Pulls live quotes and **feeds them into AlphaLab's engines**, so the entire target book, the regime
   read, the six-engine conviction, and the position sizing, recomputes on the current market, not on
   yesterday's close. A sharp move intraday can flip the regime and reshape the book on the next run.
4. **Learns from its own trades**: it reads its real fill history from Alpaca, scores how much each name
   has actually made or lost on closed trades, and sizes a little harder into the winners and softer
   into the losers. Nothing is stored; it is recomputed from the broker's record every run.
5. Runs the intraday strategy, in order:
   - **Stop-loss**: any position down more than the stop from its entry is cut in full, first.
   - **Exit**: anything no longer in the target book is closed.
   - **Take-profit**: a position up past the take-profit that is now overweight is trimmed to target.
   - **Work the gap**: the rest of the distance to target is traded a slice at a time, leaning harder
     into names that are red on the day, easing off extended ones, and weighted by what it has learned.
6. Sends the orders (sells first to fund the buys) and writes a plain-English summary to the Actions run.

Because it runs about once a minute on live prices and only works a slice of each gap per run, the bot
behaves like a trader on the desk all day, not a once-a-day rebalancer. The portfolio lives on Alpaca,
so there is nothing to save between runs. Watch it any time on the dashboard or in each run summary.

## Honest limits

- This is paper money. It proves the strategy without risking a cent. Do not point it at a live
  account without understanding that automated bots lose real money in real ways.
- No strategy is guaranteed to make money. AlphaLab's engines are strong decision support, not a
  crystal ball. Backtests flatter; live markets are harsher.
- Fundamental inputs (company financials, news) refresh when you refresh AlphaLab's data. Everything
  price-driven, the regime, momentum, conviction, sizing, and all the risk management, recomputes live
  every run. So the book breathes with the market all day off real prices.
- GitHub's scheduler starts each supervisor best-effort and can be late, and the loop trades about once
  a minute rather than on every tick. That is by design: the strategy paces into its targets over many
  runs, so exact timing does not matter and a missed minute is picked up by the next one.
- Use a dedicated paper account for the bot. It treats the whole account as its own and will sell
  anything you hand-buy that is not in its target.

## One-time setup

### 1. Create the Alpaca paper account

1. Go to alpaca.markets and pick **Trading API** (the one for individual and algorithmic traders).
2. Sign up and log in. If the signup asks your age and you are under 18, have a parent create the
   free account. It is paper trading, so there is no money, no card, and no funding involved.
3. In the dashboard, switch the account toggle to **Paper Trading** (make sure it does not say Live).
4. Reset the paper account to a **$2000** starting balance so it matches the bot. On the paper
   trading view, use the reset control and enter 2000 as the starting balance.
5. Generate new API keys for the paper account (you must regenerate after a reset, the old keys stop
   working). Copy the **API Key ID** and the **Secret Key**. The secret is shown once, so grab it now.

If the dashboard will not let you set 2000, tell me the amount it forces and I will match the bot to
it. The bot trades against whatever the account's real equity is either way.

### 2. Give the keys to GitHub (never paste them in the code)

1. In this repo on GitHub: **Settings -> Secrets and variables -> Actions**.
2. Click **New repository secret** and add these two, one at a time:
   - Name `ALPACA_KEY_ID`, value = your paper API key id
   - Name `ALPACA_SECRET_KEY`, value = your paper secret key
3. That is it. The keys are now encrypted and only the bot can read them at run time. They never
   appear in the code, the logs, or the public repo.

### 3. Turn it on and test it safely

1. Open the **Actions** tab. If Actions are off, enable them. Find the **AlphaLab paper bot** workflow.
2. Click **Run workflow**, set **Dry run** to true, and run it. A dry run computes and logs every
   order it would place without sending any. Read the run summary to confirm the target book looks
   right.
3. When you are happy, let the schedule take over, or run it again with dry run false to trade for
   real (paper) immediately. From then on it runs itself about once a minute during market hours, with
   a fresh supervisor taking over roughly every 15 minutes so it keeps going all session.

## Watching it

- **Alpaca dashboard**: your live positions, orders, and P&L, just like a real brokerage view.
- **GitHub Actions**: click any run to read what the bot saw and did, in plain English.

## Tuning

All the knobs are in `bot/config.js`, commented. The ones you are most likely to touch:

- `STARTING_BALANCE` - keep this equal to your Alpaca paper starting balance.
- `RISK_PROFILE` - `conservative`, `balanced`, or `aggressive`.
- `MAX_POSITION_PCT` - hard cap on any single position (default 30%).
- `MAX_DAILY_LOSS_PCT` - if the account drops this much in a day, the bot flattens and stops (default 8%).
- `REBALANCE_THRESHOLD` - how far a name must drift before it is worth a trade (default 1.5%). Kept low
  so the small single-stock conviction picks on a $2000 book can actually be opened.

Intraday behavior:

- `PARTICIPATION` - fraction of the remaining gap to target the bot trades each run (default 0.34).
  Higher fills faster and trades harder; lower spreads entries over more of the day.
- `STOP_LOSS_PCT` - cut a position once it is down this much from entry (default 8%).
- `TAKE_PROFIT_PCT` - trim a winner back to target once it is up this much from entry (default 18%).
- `DIP_TILT` - how hard to lean into names that are red on the day (default 8, set 0 to turn it off).
- `USE_LIVE_QUOTES` - feed live prices into the engine so the whole book recomputes live (default on).

Learning:

- `LEARN_ENABLED` - learn from realized P&L on past trades and bias sizing accordingly (default on).
- `LEARN_STRENGTH` - how far a name's track record can move its buy size before the bounds (default 0.30).
- `LEARN_MIN` / `LEARN_MAX` - the floor and ceiling on that bias (default 0.60 to 1.40).

## Running it locally

See the target book the brain wants, with no broker and no keys:

```
node bot/engine.js
```

Check the intraday strategy logic (pure, no broker and no keys):

```
node bot/test_strategy.js
```

Do a full dry run against your account from your own machine (needs your keys in the shell):

PowerShell
```
$env:ALPACA_KEY_ID="your_id"; $env:ALPACA_SECRET_KEY="your_secret"; $env:DRY_RUN="1"; node bot/run.js
```

Bash
```
ALPACA_KEY_ID=your_id ALPACA_SECRET_KEY=your_secret DRY_RUN=1 node bot/run.js
```

## Stopping it

Open the **Actions** tab, select the **AlphaLab paper bot** workflow, and disable it. To flatten the
book too, hit the reset on the Alpaca paper account.
