# Model validation — read this first

This board's implied values come from a model that is **tested, not
asserted**. Everything below was computed from the sealed snapshot itself,
by the same code that built the board (`lib/model.ts`: `fitC0` +
`validate`). No protocol name is special-cased anywhere.

## The model (C0 ensemble)

`log(implied / TVL) = TVL-bucket curve + category residual + growth slope
+ age slope + log token odds`

- **TVL-bucket curve**: log(mcap/TVL) by TVL bucket (<$10M, $10–100M,
  $100M–1B, $1–10B, >$10B), each bucket shrunk k=5 toward the global mean.
- **Category residual**: the category's mean residual after the curve,
  shrunk k=5 toward zero.
- **Growth slope**: fitted on the residual, clipped to [-0.5, 1.5].
- **Age slope**: fitted on the residual, clipped to [-0.5, 0.5].
- **Token odds**: P(token) in the protocol's category, Laplace-smoothed,
  clamped to [0.05, 0.85].

Full fit on the 92 clean traded protocols (market cap above zero, no
wrapped / bridge / exchange / versioned product):
`beta = -0.500` (clipped), `gamma = 0.120`, residual spread `sigma = 1.782`.
Curve (log-ratio by TVL bucket): `-0.79, -1.31, -1.77, -2.97, -2.15`.
The negative growth slope is real, not a bug: on this snapshot, protocols
that already grew fast in the last 7 days trade at a *lower* multiple of
TVL — the market already priced the growth in.

## How wrong it is (validation, same fit, same code)

- **Leave-one-out** (fit on 91, predict the held-out one, all 92):
  median |error| **1.455 in log terms (4.28x)**, 39.1% within 3x.
- **Walk-forward** (train on the 35 protocols listed before 2024-07-15,
  test on the 35 listed after): median |error| **1.475 (4.37x)**,
  37.1% within 3x. The model holds forward in time, not just across
  protocols.
- **v12's model E on the same harness**: LOO 1.535 (4.64x) / 34.8%,
  walk-forward 1.662 (5.28x) / 31.4%. C0 wins on both validations.

Every row carries its own 90% interval from its category's residual
spread, so a wide category earns a wide interval. The farm verdict uses
the interval too: FARM needs $3/hour on the point estimate **and**
$2/hour even at the interval's low end.

## What was tried and rejected (same harness)

- Fine category x chain segments: LOO 5.45x — overfits on 92 points.
- A value haircut (subtracting half the squared standard error):
  walk-forward 2.026x — it under-predicts systematically.
- A free growth slope (-3.08): better LOO (1.349) but the same
  walk-forward (1.475) — noise, not signal; kept clipped at -0.5.
- Curve-only (no category residual): best LOO (1.419, 42.4%) but worst
  walk-forward (1.689) — it fails forward in time.

## Farm economics (stated assumptions, checkable)

2% of the implied value is the farmer pool; farmers = TVL / $2,500
(one $2,500 position per farmer, on average); hours = 1.4 + 0.7 x
(hold days / 60). $/hour = expected value per farmer / hours.
Verdicts: FARM ≥ $3/hour, THIN ≥ $1/hour, LEAN below — and FARM is
gated on the interval's low end at $2/hour (see above).

Every verdict is costed at $/hour — the number beside each row is the
expected value per hour of work. At the $2/hour low-end gate the board
is FARM 66 / THIN 123 / LEAN 9, against FARM 100 at the $1 gate: the
stricter gate keeps only the verdicts whose low end still clears
$2/hour.

## Board construction

198 rows: every rankable pre-token protocol in the snapshot. 144
wrapped, bridged, exchange or versioned products are excluded from the
ranked board (their tokens already trade, or they are pools of another
protocol); the 24 largest traded protocols are shown separately on the
Live tab at their market values, never mixed into the ranking. The
watchlist's 40 protocols are all covered.

## What this model does NOT do

It does not predict whether or when a token is issued, and it does not
rank by hype, by name, or by any list written by hand. A median error
of 4.28x means the typical row's implied value is wrong by a factor of
four — the interval beside each value is the honest part. Read the
interval before the point estimate.
