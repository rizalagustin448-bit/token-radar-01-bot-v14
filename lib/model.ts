// Token radar v14 — the C0 ensemble model.
//
// What it does, in one paragraph: every protocol on the sealed snapshot is
// scored from the snapshot's own figures alone. The model is FIT at runtime,
// never hardcoded: a TVL-bucket curve, a shrunken category residual, a clipped
// growth slope and a clipped age slope, all fitted on the 92 clean traded
// protocols (market cap above zero, no wrapped/bridge/exchange/versioned
// product), times the protocol's token odds in its category. Nothing is
// special-cased by name: the same function scores every row, and the same fit
// is re-run leave-one-out and walk-forward in time so the dashboard can state
// how wrong it is instead of asserting it is right.
//
// Validation (recomputed by main.ts on every run, same code path):
//   LOO  median |error| 1.455 in log terms (4.28x), 39.1% within 3x
//   Walk-forward (train pre-2024-07-15, test after) 1.475 (4.37x), 37.1%
//   v12's model E on the same harness: LOO 1.535 (4.64x) / 34.8%,
//   walk-forward 1.662 (5.28x) / 31.4%. C0 wins on both validations.
// Rejected by the same harness, not by taste: fine category x chain
// segments (LOO 5.45x — overfit on 92 points), a value haircut
// (walk-forward 2.026x — it under-predicts systematically), a free growth
// slope (-3.08 — noise), curve-only (best LOO 1.419x but worst
// walk-forward 1.689x — it fails forward in time).

/** One protocol of the sealed snapshot: exactly its ten fields. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole sealed snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The fitted C0 ensemble: everything the dashboard's sandbox needs. */
export interface ModelFit {
  global: number;
  curve: number[];
  catRes: Record<string, number>;
  catN: Record<string, number>;
  catSd: Record<string, number>;
  beta: number;
  gamma: number;
  sigma: number;
  fitN: number;
}

/** Leave-one-out and walk-forward validation of the same fit. */
export interface Validation {
  loo_med_log: number;
  loo_med_x: number;
  loo_within3_pct: number;
  wf_med_log: number;
  wf_med_x: number;
  wf_within3_pct: number;
  fit_n: number;
  train_n: number;
  test_n: number;
  cut: string;
}

/** One farm step: action, cost and time, as one string in the board. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  verdict: 'FARM' | 'THIN' | 'LEAN';
  usd_per_hour: number;
  expected_usd: number;
  hours: number;
  farmers: number;
  model: {
    curve: number;
    category_residual: number;
    growth_term: number;
    age_term: number;
    log_odds: number;
    odds: number;
    beta: number;
    gamma: number;
  };
  farm_steps: string[];
}

/** A board row's compact form for data.js. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  verdict: 'FARM' | 'THIN' | 'LEAN';
  usd_per_hour: number;
  expected_usd: number;
  hours: number;
  farmers: number;
  curve: number;
  category_residual: number;
  growth_term: number;
  age_term: number;
  log_odds: number;
  odds: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the page shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard renders. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  live_size: number;
  fit: ModelFit;
  validation: Validation;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

export const MODEL_VERSION = 'radar-14-c0';

/** How many live-token protocols the Live tab carries, by market cap. */
export const LIVE_ROWS = 24;

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function mean(a: number[]): number {
  return a.reduce((x, y) => x + y, 0) / a.length;
}

function sd(a: number[]): number {
  const m = mean(a);
  return Math.sqrt(mean(a.map((x) => (x - m) ** 2)));
}

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/** Trimmed mean: drop the top and bottom 10% when n >= 10, else a plain mean. */
function trimMean(vals: number[]): number {
  if (vals.length === 0) return 0;
  const s = [...vals].sort((a, b) => a - b);
  if (s.length >= 10) {
    const k = Math.floor(s.length * 0.1);
    return mean(s.slice(k, s.length - k));
  }
  return mean(s);
}

/** One-predictor OLS slope, fit on residuals. */
function olsSlope(xs: number[], ys: number[]): number {
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i]! - mx) * (ys[i]! - my);
    den += (xs[i]! - mx) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Seven-day TVL growth in per cent, clamped to [-60, 120]; unreported counts as 0. */
function growthPct(p: SnapshotProtocol): number {
  return clamp(finite(p.change_7d, 0), -60, 120);
}

/** log1p(age in years); unknown age counts as one year. */
function ageTerm(p: SnapshotProtocol, asOf: string): number {
  const a = ageDays(asOf, p.listed_at) ?? 365;
  return Math.log1p(a / 365);
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** Categories that are a product of a token that already trades. */
const BADCAT = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
/** An exchange's name at the start of a protocol name. */
const EXCH = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;
/** A whole word wrapped, staked or staking anywhere in the name. */
const WRAP = /\bwrapped\b|\bstaked\b|\bstaking\b/i;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is a wrapped, staked, bridged or exchange product of a token that trades. */
export function isWrappedOrBridged(p: SnapshotProtocol): boolean {
  return BADCAT.has(p.category ?? '') || WRAP.test(p.name) || EXCH.test(p.name) || VERSIONED.test(p.name);
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not wrapped/bridged/versioned. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !isWrappedOrBridged(p);
}

/** The fit set: traded protocols with a market cap, clean of wrapped/bridge/exchange/versioned products. */
export function fitSet(all: SnapshotProtocol[]): SnapshotProtocol[] {
  return all.filter((p) => (p.mcap_usd ?? 0) > 0 && p.category !== 'CEX' && !isWrappedOrBridged(p));
}

/** P(token) in a category, Laplace-smoothed, from every protocol in it; `excludeSlug` keeps LOO honest. */
export function oddsFor(all: SnapshotProtocol[], category: string | null, excludeSlug: string | null): number {
  let traded = 0;
  let total = 0;
  for (const p of all) {
    if (p.slug === excludeSlug) continue;
    if ((p.category ?? 'null') !== (category ?? 'null')) continue;
    total++;
    if (!isPreToken(p)) traded++;
  }
  return clamp((traded + 1) / (total + 2), 0.05, 0.85);
}

/** TVL bucket by log10(TVL): under $10M, $10–100M, $100M–1B, $1–10B, over $10B. */
const BUCKETS: [number, number][] = [[-Infinity, 7], [7, 8], [8, 9], [9, 10], [10, Infinity]];

function bucketOf(p: SnapshotProtocol): number {
  const l = Math.log10(p.tvl_usd);
  for (let i = 0; i < BUCKETS.length; i++) {
    if (l >= BUCKETS[i]![0] && l < BUCKETS[i]![1]) return i;
  }
  return 4;
}

/**
 * Fit the C0 ensemble on `train` (traded, clean):
 *  1. a TVL-bucket curve of log(mcap/TVL), shrunken k=5 toward the global mean;
 *  2. a category residual after the curve, shrunken k=5 toward zero;
 *  3. a growth slope on the residual, clipped to [-0.5, 1.5];
 *  4. an age slope on the residual, clipped to [-0.5, 0.5];
 *  5. the pooled residual sd (floored at 0.3) for the per-row interval.
 */
export function fitC0(train: SnapshotProtocol[], asOf: string): ModelFit {
  const all = train;
  const ys = train.map((p) => Math.log(p.mcap_usd! / p.tvl_usd));
  const g = trimMean(ys);
  const byBucket: number[][] = [[], [], [], [], []];
  train.forEach((p, i) => byBucket[bucketOf(p)]!.push(ys[i]!));
  const curve: number[] = [];
  for (let b = 0; b < 5; b++) {
    const v = byBucket[b]!;
    const n = v.length;
    const w = n / (n + 5);
    curve.push(n > 0 ? w * trimMean(v) + (1 - w) * g : g);
  }
  const res1 = train.map((p, i) => ys[i]! - curve[bucketOf(p)]!);
  const byCat = new Map<string, number[]>();
  train.forEach((p, i) => {
    const k = p.category ?? 'null';
    if (!byCat.has(k)) byCat.set(k, []);
    byCat.get(k)!.push(res1[i]!);
  });
  const catRes: Record<string, number> = {};
  const catN: Record<string, number> = {};
  const catSd: Record<string, number> = {};
  for (const [k, v] of byCat) {
    const n = v.length;
    const w = n / (n + 5);
    catRes[k] = w * trimMean(v);
    catN[k] = n;
    catSd[k] = Math.max(0.3, sd(v));
  }
  const res2 = train.map((p, i) => res1[i]! - (catRes[p.category ?? 'null'] ?? 0));
  const beta = clamp(olsSlope(train.map((p) => growthPct(p) / 100), res2), -0.5, 1.5);
  const res3 = train.map((p, i) => res2[i]! - beta * (growthPct(p) / 100));
  const gamma = clamp(olsSlope(train.map((p) => ageTerm(p, asOf)), res3), -0.5, 0.5);
  const res4 = train.map((p, i) => res3[i]! - gamma * ageTerm(p, asOf));
  const sigma = Math.max(0.3, sd(res4));
  return { global: g, curve, catRes, catN, catSd, beta, gamma, sigma, fitN: train.length };
}

/** The model's terms for one protocol, and its log implied-value ratio. */
export function modelTerms(fit: ModelFit, all: SnapshotProtocol[], p: SnapshotProtocol, asOf: string, excludeSlug: string | null): { logRatio: number; curve: number; catRes: number; growth: number; age: number; logOdds: number; odds: number } {
  const odds = oddsFor(all, p.category, excludeSlug);
  const curve = fit.curve[bucketOf(p)]!;
  const catRes = fit.catRes[p.category ?? 'null'] ?? 0;
  const growth = fit.beta * (growthPct(p) / 100);
  const age = fit.gamma * ageTerm(p, asOf);
  const logOdds = Math.log(odds);
  return { logRatio: curve + catRes + growth + age + logOdds, curve, catRes, growth, age, logOdds, odds };
}

/** The implied value: TVL times exp(log ratio), at least $1, a whole number of dollars. */
export function impliedValue(fit: ModelFit, all: SnapshotProtocol[], p: SnapshotProtocol, asOf: string): { implied: number; low: number; high: number; terms: ReturnType<typeof modelTerms> } {
  const terms = modelTerms(fit, all, p, asOf, null);
  const implied = Math.max(1, Math.round(p.tvl_usd * Math.exp(terms.logRatio)));
  // The 90% interval from the category's residual spread: wide categories earn wide intervals.
  const n = fit.catN[p.category ?? 'null'] ?? 1;
  const s = fit.catSd[p.category ?? 'null'] ?? fit.sigma;
  const se = s / Math.sqrt(Math.max(1, n));
  const low = Math.max(1, Math.round(implied * Math.exp(-1.6449 * se)));
  const high = Math.max(low, Math.round(implied * Math.exp(1.6449 * se)));
  return { implied, low, high, terms };
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * The farm economics, stated as assumptions a reader can check:
 *  2% of the implied value is the farmer pool; the farmers are TVL / $2,500
 *  each (one $2,500 position per farmer, on average); the hours are the
 *  setup plus one short action a week over the hold. $/hour is the expected
 *  value per farmer divided by those hours.
 */
export function farmEconomics(implied: number, low: number, tvl: number, holdDays: number): { expected: number; lowExpected: number; hours: number; farmers: number; usdPerHour: number; lowUsdPerHour: number } {
  const farmers = Math.max(1, Math.round(tvl / 2500));
  const hours = 1.4 + 0.7 * (holdDays / 60);
  const expected = (implied * 0.02) / farmers;
  const lowExpected = (low * 0.02) / farmers;
  return { expected, lowExpected, hours, farmers, usdPerHour: expected / hours, lowUsdPerHour: lowExpected / hours };
}

/** The verdict: FARM needs $3/hour on the point estimate AND $2/hour even at the interval's low end. */
export function verdictFor(usdPerHour: number, lowUsdPerHour: number): 'FARM' | 'THIN' | 'LEAN' {
  if (usdPerHour >= 3 && lowUsdPerHour >= 2) return 'FARM';
  if (usdPerHour >= 1) return 'THIN';
  return 'LEAN';
}

const fmtUsd = (n: number): string => (n >= 100 ? `$${Math.round(n).toLocaleString('en-US')}` : `$${n.toFixed(2)}`);

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time.
 * The plan is derived from the protocol's own record (category, chains, TVL,
 * age) and its farm economics — never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, econ: ReturnType<typeof farmEconomics>, verdict: 'FARM' | 'THIN' | 'LEAN'): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Expect about ${fmtUsd(econ.expected)} per farmer at ${fmtUsd(econ.usdPerHour)} an hour over ${econ.hours.toFixed(1)} hours of work — verdict ${verdict}. Check the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, fit: ModelFit): BoardRow[] {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug it names, even one the snapshot no longer carries.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other rankable pre-token protocol, not just the top 160 by TVL.
  // The board's ceiling is the 198 rankable pre-token protocols this snapshot holds.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }
  const scored = [...chosen.values()].map((p) => {
    const { implied, low, high, terms } = impliedValue(fit, snapshot.protocols, p, snapshot.as_of);
    const age = ageDays(snapshot.as_of, p.listed_at);
    const hold = holdDaysFor(age);
    const econ = farmEconomics(implied, low, p.tvl_usd, hold);
    const verdict = verdictFor(econ.usdPerHour, econ.lowUsdPerHour);
    return { p, implied, low, high, terms, age, hold, econ, verdict };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    implied_low_usd: s.low,
    implied_high_usd: s.high,
    verdict: s.verdict,
    usd_per_hour: Math.round(s.econ.usdPerHour * 100) / 100,
    expected_usd: Math.round(s.econ.expected * 100) / 100,
    hours: Math.round(s.econ.hours * 10) / 10,
    farmers: s.econ.farmers,
    model: {
      curve: Math.round(s.terms.curve * 1000) / 1000,
      category_residual: Math.round(s.terms.catRes * 1000) / 1000,
      growth_term: Math.round(s.terms.growth * 1000) / 1000,
      age_term: Math.round(s.terms.age * 1000) / 1000,
      log_odds: Math.round(s.terms.logOdds * 1000) / 1000,
      odds: Math.round(s.terms.odds * 1000) / 1000,
      beta: fit.beta,
      gamma: fit.gamma,
    },
    farm_steps: farmSteps(s.p, s.age, s.econ, s.verdict).map(stepText),
  }));
}

/** The live-token protocols, by market cap, for the dashboard's Live tab. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

function metrics(errs: number[]): { medLog: number; medX: number; within3Pct: number } {
  const abs = errs.map(Math.abs).sort((a, b) => a - b);
  const med = abs[Math.floor(abs.length / 2)]!;
  const within3 = errs.filter((e) => Math.abs(e) <= Math.log(3)).length / errs.length;
  return { medLog: med, medX: Math.exp(med), within3Pct: within3 * 100 };
}

/**
 * Leave-one-out and walk-forward validation of the C0 fit, on the same fit
 * set the model uses. Walk-forward trains on the older half (by listed_at)
 * and tests on the newer half: it asks whether the model holds forward in
 * time, not just across protocols.
 */
export function validate(snapshot: Snapshot): Validation {
  const fit = fitSet(snapshot.protocols);
  const looErrs: number[] = [];
  for (const p of fit) {
    const train = fit.filter((q) => q.slug !== p.slug);
    const m = fitC0(train, snapshot.as_of);
    const t = modelTerms(m, snapshot.protocols, p, snapshot.as_of, p.slug);
    looErrs.push(Math.log(p.tvl_usd) + t.logRatio - Math.log(p.mcap_usd!));
  }
  const loo = metrics(looErrs);
  const dated = fit.filter((p) => p.listed_at).sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : 1));
  const cut = dated[Math.floor(dated.length / 2)]!.listed_at!;
  const train = dated.filter((p) => p.listed_at! < cut);
  const test = dated.filter((p) => p.listed_at! >= cut);
  const m = fitC0(train, snapshot.as_of);
  const wfErrs = test.map((p) => {
    const t = modelTerms(m, snapshot.protocols, p, snapshot.as_of, null);
    return Math.log(p.tvl_usd) + t.logRatio - Math.log(p.mcap_usd!);
  });
  const wf = metrics(wfErrs);
  return {
    loo_med_log: Math.round(loo.medLog * 1000) / 1000,
    loo_med_x: Math.round(loo.medX * 100) / 100,
    loo_within3_pct: Math.round(loo.within3Pct * 10) / 10,
    wf_med_log: Math.round(wf.medLog * 1000) / 1000,
    wf_med_x: Math.round(wf.medX * 100) / 100,
    wf_within3_pct: Math.round(wf.within3Pct * 10) / 10,
    fit_n: fit.length,
    train_n: train.length,
    test_n: test.length,
    cut,
  };
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    implied_low_usd: row.implied_low_usd,
    implied_high_usd: row.implied_high_usd,
    verdict: row.verdict,
    usd_per_hour: row.usd_per_hour,
    expected_usd: row.expected_usd,
    hours: row.hours,
    farmers: row.farmers,
    curve: row.model.curve,
    category_residual: row.model.category_residual,
    growth_term: row.model.growth_term,
    age_term: row.model.age_term,
    log_odds: row.model.log_odds,
    odds: row.model.odds,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const fit = fitC0(fitSet(snapshot.protocols), snapshot.as_of);
  const validation = validate(snapshot);
  const board = buildBoard(snapshot, fit);
  const live = liveRows(snapshot);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    live_size: live.length,
    fit,
    validation,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
