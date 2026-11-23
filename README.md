# Token Launch Radar v14

A token launch radar for make.fun's `token-radar-01` bounty: what a
protocol's token would be worth if its record stayed as it is, and what a
reader should do to farm it before it issues one. It does not predict
whether or when a token is issued.

## The model

C0 ensemble, fitted at runtime from the sealed snapshot — never hardcoded:

`log(implied / TVL) = TVL-bucket curve + category residual + growth slope
+ age slope + log token odds`

- Fit set: the 92 clean traded protocols (market cap above zero, no
  wrapped / bridge / exchange / versioned product).
- Validation (recomputed on every run, `lib/model.ts` `validate`):
  leave-one-out median error 1.455 in log terms (4.28x), 39.1% within 3x;
  walk-forward 1.475 (4.37x), 37.1% within 3x. v12's model E on the same
  harness: LOO 1.535 (4.64x), walk-forward 1.662 (5.28x). C0 wins both.
- Every row carries a 90% interval from its category's residual spread.
  Farm verdicts: FARM ≥ $3/hour, THIN ≥ $1/hour, LEAN below — FARM is
  gated on the interval's low end at $2/hour as well. Every verdict is
  costed at $/hour — the number beside each row is the expected value
  per hour of work. The board is FARM 66 / THIN 123 / LEAN 9 (v13's
  $1/hour low-end gate gave FARM 100).

See `dashboard/00-model-validation.md` for the full validation, the
rejected variants, and the farm-economics assumptions.

## The board

198 rows: every rankable pre-token protocol in the snapshot. 144 wrapped,
bridged, exchange or versioned products are excluded from the ranked board;
the 24 largest traded protocols are shown separately on the Live tab at
their market values. The watchlist's 40 protocols are all covered.

## The page

- Sortable column headers, chain / verdict / watchlist filters, search.
- Pins + tray, compare dialog (up to 3 pinned protocols).
- Command palette (Ctrl+K): jump to a protocol, switch tabs, export CSV.
- Live token tab, model sandbox (move β, γ and the farmer-pool % and the
  board re-ranks live — it never changes the submitted board).
- CSV export of the filtered board.
- Detail view per protocol: model terms, 90% interval, farm plan with
  $/hour.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit>/input/snapshot.json
```

Node 22, standard library only, no network. `main.ts` reads the snapshot,
writes `board.json`, `data.js`, copies `dashboard/` and `screenshots/`,
and writes `dossier.json` with the vendored `vendor/makefun-board.ts`.

## Files

- `main.ts` — the entrypoint: snapshot in, board + dashboard + dossier out.
- `lib/model.ts` — the C0 fit, the farm plan, the board, the validation.
- `dashboard/` — `index.html`, `app.css`, `app.js`,
  `00-model-validation.md`.
- `screenshots/` — board, detail view, filtered view (1440×800).
- `vendor/makefun-board.ts` — make.fun's dossier library (vendored).
