/**
 * Small statistics helpers for the results summary. Pure functions, no dependencies.
 */

/** Natural log of the gamma function (Lanczos approximation). */
function lnGamma(z: number): number {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
  const zz = z - 1;
  let x = c[0];
  for (let i = 1; i < g + 2; i++) x += c[i] / (zz + i);
  const t = zz + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (zz + 0.5) * Math.log(t) - t + Math.log(x);
}

/** Regularized upper incomplete gamma Q(a, x), by series or continued fraction. */
function gammaQ(a: number, x: number): number {
  if (x <= 0) return 1;
  if (x < a + 1) {
    let sum = 1 / a;
    let term = sum;
    for (let n = 1; n < 500; n++) {
      term *= x / (a + n);
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 1e-14) break;
    }
    return 1 - sum * Math.exp(-x + a * Math.log(x) - lnGamma(a));
  }
  let b = x + 1 - a;
  let c = 1e300;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c;
    if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  return Math.exp(-x + a * Math.log(x) - lnGamma(a)) * h;
}

/** Probability that a chi-square variable with `df` degrees of freedom exceeds `x`. */
export function chiSquareP(x: number, df: number): number {
  return gammaQ(df / 2, x / 2);
}

export type GroupCount = { failing: number; tested: number };

export type ChiSquareResult = {
  statistic: number;
  df: number;
  p: number;
  /** False when some expected cell count is under 5, so the test is not reliable. */
  reliable: boolean;
};

/**
 * Chi-square test of whether the failure rate differs across groups (a k x 2 table of
 * failing vs not failing). Returns null when fewer than two groups have tested sites.
 */
export function chiSquareAcrossGroups(groups: GroupCount[]): ChiSquareResult | null {
  const g = groups.filter((x) => x.tested > 0);
  if (g.length < 2) return null;
  const n = g.reduce((s, x) => s + x.tested, 0);
  const k = g.reduce((s, x) => s + x.failing, 0);
  if (k === 0 || k === n) return { statistic: 0, df: g.length - 1, p: 1, reliable: true };
  let stat = 0;
  let reliable = true;
  for (const x of g) {
    const expFail = (x.tested * k) / n;
    const expPass = (x.tested * (n - k)) / n;
    if (expFail < 5 || expPass < 5) reliable = false;
    stat += (x.failing - expFail) ** 2 / expFail + (x.tested - x.failing - expPass) ** 2 / expPass;
  }
  const df = g.length - 1;
  return { statistic: stat, df, p: chiSquareP(stat, df), reliable };
}

/** "p = 0.06", "p < 0.001". */
export function formatP(p: number): string {
  if (p < 0.001) return "p < 0.001";
  return `p = ${p < 0.01 ? p.toFixed(3) : p.toFixed(2)}`;
}
