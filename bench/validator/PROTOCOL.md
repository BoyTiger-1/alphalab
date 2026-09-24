# Validating the validator: preregistered protocol

Version 1.0, frozen 2026-09-24, before the main run.
Branch `research/validate-the-validator` of https://github.com/BoyTiger-1/alphalab.
The protocol, the harness (`run.js`) and the analysis (`analyze.js`) are frozen together in one commit. Its SHA is sent to the reviewer before the main run. None of the three files changes after that commit. Any change goes into `DEVIATIONS.md` as a separate, dated commit with a reason.

## 1. Question

Can AlphaLab's validation gauntlet tell a deliberately overfit strategy from a control that saw no selection pressure? The question is not whether it scores plausible strategies well. "Misses overfit strategies" is an acceptable, reportable outcome. The detector is not tuned at any point.

## 2. The detector under test

The detector is `S.validate(entry, opts)` in `app/strategies.js`, used unmodified at the frozen commit. Its verdict is VALIDATED only when all five conditions hold:

| Check | Condition |
|---|---|
| Out-of-sample | Sharpe on the last 30% of the backtest > 0.3 |
| Full period | Sharpe > 0.5 |
| Significance | Probabilistic Sharpe Ratio (PSR, not deflated for the number of trials) > 0.85 |
| Cost stress | Sharpe at 3x the base cost > 0 |
| Parameter perturbation | median Sharpe over each numeric parameter > 2 nudged to x0.8 and x1.2 (rounded) > 0.3 x full Sharpe |

Otherwise the verdict is MARGINAL when OOS Sharpe > 0 and full Sharpe > 0.3, and REJECTED otherwise. All Sharpe ratios use `Q.perf`: annualized over 252 days, excess of a fixed 2% rate. The backtests lag the signal one day and charge a one-way cost per unit of turnover.

Two properties of the code as written. Both are recorded here, before the run, and neither will be changed:

- The per-year consistency figure (`posYears`) is computed but does not enter the verdict, although the UI describes five checks that include sub-period consistency.
- PSR is computed on the single strategy handed in. The gauntlet has no way to know how many strategies were tried before it.

## 3. Strategy generators

The data is real daily closes from the bundle at the frozen commit (`data/bundle.js`, git blob `83a19b73`). The assets are SPY, QQQ, IWM, TLT and GLD. Each replicate is assigned an asset in round-robin order.

### Arm A: placebo, true edge known to be zero (primary)

The placebo signal is an SMA crossover computed on a seeded Gaussian random walk, not on the asset. The strategy is +1 when fast SMA > slow SMA and -1 otherwise, traded long/short on the asset's real returns through the normal backtester.

- The signal is independent of the asset, so its expected edge is zero by construction.
- The seed is a string parameter, so the gauntlet's perturbation step moves only `fast` and `slow`, the same as for a real SMA rule.
- Turnover and holding periods resemble those of a real trend rule.

Window grid G1: fast ~ U{3..100}, slow ~ U{fast+5..400}. Every candidate has its own walk seed.

- **Overfit case:** draw K candidates, backtest each on the selection window, and submit the one with the highest Sharpe to the gauntlet. K is 20 or 200.
- **Clean control:** K = 1. One draw is submitted without looking at any result.

### Arm B: real rule families, unknown edge (secondary, exploratory)

Four families from the platform's engine library, run long-only on the same five assets:

| Family | Canonical control (fixed in advance) | Overfit search space |
|---|---|---|
| smaCross | fast 50, slow 200 | fast U{3..100}, slow U{fast+5..400} |
| donchian | n 55 | n U{5..250} |
| rsiRev | n 2, lo 10, hi 90 | n U{2..30}, lo U{5..45}, hi U{55..95} |
| tsMom | n 252, skip 21 | n U{20..300}, skip U{0..30} |

- **Overfit case:** the best of K = 200 random draws on the selection window, with 5 seeds for each (family, asset, mode) cell.
- **Canonical control:** one per (family, asset).

The true edge here is unknown, so the sealed holdout is the only ground truth.

## 4. Data splits and selection modes

| Segment | Dates | Used by |
|---|---|---|
| Research window | 2006-01-01 to 2021-12-31 | selection and the gauntlet |
| Sealed holdout | 2022-01-03 to 2026-08-10 | final evaluation only |

The harness truncates every series (prices, VIX, the SPY benchmark) at the relevant end date before any engine reads it. It raises an error if a backtest's last date ever exceeds its window (MC3).

Two ways an overfit strategy can reach the gauntlet:

- **M1, honest split.** Selection uses only 2006-01-01 through 2017-03-15, which is 70% of the research window's trading days. The gauntlet's own OOS segment (the last 30% of its trimmed backtest) always starts after that date, so the gauntlet's OOS check sees untouched data. This is the gauntlet used as designed.
- **M2, full window.** Selection uses the whole research window, including the stretch the gauntlet later treats as OOS. This is the realistic misuse: a researcher who iterates on full-history backtests. Only the non-OOS checks can catch it.

Controls (K = 1) have no selection step, so one set of 200 controls serves both modes.

## 5. Costs and multiple-testing pressure

- **Costs:** the base cost is 5 bps one-way per unit of turnover (the platform default), for both selection and the gauntlet. The gauntlet's stress test applies 3x the base cost. The robustness check S1 reruns the primary endpoint at base costs of 0 and 10 bps.
- **Multiple-testing pressure:** the number of trials per selected strategy, K in {1, 20, 200}. K = 200 is the primary level. K = 20 gives the dose-response. The gauntlet is never told K.

## 6. Primary metric and numerical decision rule

**Primary metric:** the false-validation rate (FVR). This is the share of Arm A overfit strategies (K = 200) that receive VALIDATED, computed separately for M1 and M2 with R = 200 each. In Arm A every VALIDATED is false by construction.

The rule for each mode, with x validated out of n = 200, p = x/n, and a Wilson 95% interval:

| Outcome | Condition |
|---|---|
| DETECTS | upper bound of the Wilson interval <= 10% (in practice x <= 11 of 200) |
| MISSES | p > 10% |
| INCONCLUSIVE | otherwise |

Operating characteristics at n = 200 (exact binomial):

| True FVR | P(DETECTS) | P(MISSES) |
|---|---|---|
| 3% | 0.98 | 0.00 |
| 5% | 0.70 | 0.00 |
| 10% | 0.02 | 0.44 |
| 15% | 0.00 | 0.98 |

A detector whose true FVR is near the 10% bar will usually come out INCONCLUSIVE, which is intended.

Headline:

- **"Gauntlet reliably rejects overfit strategies"** only if both M1 and M2 are DETECTS, and the decision is unchanged in every robustness check (section 8).
- **"Does not reliably reject overfit strategies"** if either mode is MISSES or INCONCLUSIVE. The report names the mode and the checks that let the strategies through.

Reported alongside, with no decision attached:

- FVR at K = 1 and K = 20.
- The inflation FVR(K=200) minus FVR(K=1), with a Newcombe 95% interval.
- The share of records failing each of the five checks.
- The non-REJECTED rate.
- Mean selection, OOS and holdout Sharpe for each cell.

Arm B, exploratory with no pass/fail:

- VALIDATED rate for overfit versus canonical strategies.
- Mean holdout Sharpe for VALIDATED versus non-VALIDATED strategies.
- Spearman correlation between the gauntlet's OOS Sharpe and the holdout Sharpe.

## 7. Manipulation checks (validity of the benchmark itself)

The benchmark is declared INVALID, and no conclusion about the gauntlet is drawn, if any of these fails:

- **MC1.** The mean sealed-holdout Sharpe of the Arm A K = 200 strategies is <= 0.20. Anything higher means the placebo is leaking information.
- **MC2.** In every M1 record, the gauntlet's OOS start date is later than the selection end date.
- **MC3.** No truncation error is raised during the run.
- **MC4.** In both modes, the mean full-window Sharpe of K = 200 selections is above that of the K = 1 controls. This confirms selection pressure was actually applied.
- Every record has a gauntlet result.

## 8. Stability and perturbation checks

Parameter perturbation inside the detector is part of the gauntlet (section 2). The benchmark's own conclusion is then re-derived under five preregistered variants. Each uses Arm A, K = 200, both modes, R = 100 and fresh seeds:

| Variant | Change |
|---|---|
| S1a | base cost 0 bps |
| S1b | base cost 10 bps |
| S2 | alternative window grid G2: fast U{2..50}, slow U{fast+2..200} |
| S3 | alternative master seed |
| S4 | research window starts 2010-01-01 instead of 2006-01-01 |

All variants are reported whatever they show. The decision rule is not re-tuned per variant.

## 9. Seeds, reproduction and retained outputs

Seeds:

- Master seed string: `FQ-VV-2026-09-24`, and `FQ-VV-2026-09-24-alt` for S3.
- Every replicate's generator is keyed by `master|arm|variant|K|mode|rep` (FNV-1a hash into mulberry32).
- Every placebo walk is keyed by that string plus the trial index.
- The full key is stored in each record.

Frozen inputs, as git blobs at the frozen commit:

| File | Blob |
|---|---|
| `data/bundle.js` | `83a19b73` |
| `app/strategies.js` | `dbadbf5f` |
| `app/quant.js` | `bcf2cdaf` |
| `app/core.js` | `3b919e02` |

Runtime: Node v24.14.1.

Reproduce:

```
git checkout <frozen commit>
node bench/validator/run.js --out bench/validator/results/main
node bench/validator/analyze.js bench/validator/results/main
```

Retained outputs, committed unedited in a separate commit after the run:

- `records.jsonl`: one line per gauntlet run, with the full seed key, chosen parameters, every trial's selection Sharpe, every gauntlet field including each perturbed Sharpe, and holdout statistics.
- `manifest.json`: config, git SHA, Node version, SHA-256 of every loaded file, and timing.
- `summary.json` and the console report.

**Execution check done before freezing.** A dry run (`--dry`) was used only to confirm that the harness executes and truncates correctly. It used a disjoint seed (`DRY-not-for-analysis`), 2 replicates, K <= 5 and one Arm B cell. It printed record counts and dates only. The analysis output was discarded without being read, and no rates or verdicts were inspected.

## 10. Known limitations of v1

- Arm A tests one overfitting mechanism: selection on noise across a parameterized family. It does not test look-ahead bugs, survivorship, or data-snooping across many assets.
- Five liquid ETFs. One period split. One sealed holdout of about 4.6 years, so Arm B holdout comparisons are noisy.
- The detector's thresholds are absolute Sharpe levels with a fixed 2% rate, so results partly reflect that design choice. That choice is part of what is under test.
