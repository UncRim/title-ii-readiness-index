/**
 * Checks the plain-language summary built from the aggregate numbers.
 * Run with: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildNarrative, inTen, stepsForSiteOwners } from "@/lib/readiness/narrative";
import { guideFor } from "@/lib/readiness/rule-guide";
import { chiSquareAcrossGroups, formatP } from "@/lib/readiness/stats";
import type { AggregateOutput } from "@/lib/readiness/types";

const FAIL = "% with at least one detected WCAG 2.1 A/AA failure";

function agg(overrides: Partial<AggregateOutput> = {}): AggregateOutput {
  return {
    summaryLine: "",
    reach: [
      { stratum: "county", sampled: 100, scanned: 80, robots_disallowed: 2, http_error: 3, unreachable: 15, unreachable_by_cause: { dns: 10, tls: 5 }, error: 0 },
      { stratum: "public_4yr", sampled: 100, scanned: 95, robots_disallowed: 0, http_error: 1, unreachable: 4, unreachable_by_cause: { dns: 4 }, error: 0 },
    ],
    strata: [
      { stratum: "county", measure: FAIL, pages: 80, count: 64, value: 80, ci95_low: 70, ci95_high: 87 },
      { stratum: "county", measure: "Median failing rules per page", pages: 80, value: 3 },
      { stratum: "public_4yr", measure: FAIL, pages: 95, count: 57, value: 60, ci95_low: 52, ci95_high: 72 },
      { stratum: "public_4yr", measure: "Median failing rules per page", pages: 95, value: 2 },
    ],
    topRules: [
      { rule: "color-contrast", wcag_sc: "1.4.3", impact: "serious", pages: 90, percent_of_pages: 51, by_stratum: { county: 62.5, public_4yr: 40 } },
      { rule: "html-has-lang", wcag_sc: "3.1.1", impact: "serious", pages: 20, percent_of_pages: 11, by_stratum: { county: 10, public_4yr: 12 } },
      { rule: "some-new-rule", wcag_sc: "", impact: "moderate", pages: 5, percent_of_pages: 3, by_stratum: { county: 3, public_4yr: 3 } },
    ],
    ...overrides,
  };
}

test("inTen reads naturally at both ends", () => {
  assert.equal(inTen(69), "about 7 in 10");
  assert.equal(inTen(2), "very few");
  assert.equal(inTen(97), "nearly all");
});

test("headline gives the range across groups and groups come out in a fixed order", () => {
  const n = buildNarrative(agg());
  assert.match(n.headline, /Between 60% and 80%/);
  assert.deepEqual(n.groups.map((g) => g.stratum), ["public_4yr", "county"]);
  assert.match(n.groups[0].sentence, /95 of 100 sites could be tested/);
  assert.match(n.groups[0].sentence, /probably between 52% and 72%/);
});

test("untested sites widen the range: all untested pass gives the low end, all fail the high end", () => {
  const county = buildNarrative(agg()).groups.find((g) => g.stratum === "county")!;
  assert.equal(county.boundLow, 64);
  assert.equal(county.boundHigh, 84);
});

test("the gap between groups is judged by a test across all groups, not by whether ranges overlap", () => {
  // Fixture: 57 of 95 vs 64 of 80 (60% vs 80%). The ranges overlap, yet the test finds a real gap.
  const firm = buildNarrative(agg());
  assert.match(firm.bullets[0], /unlikely to be chance alone \(p = 0\.004\)/);
  // Make the two groups close: 57 of 95 vs 52 of 80 (60% vs 65%).
  const close = agg();
  close.strata = close.strata.map((r) =>
    r.stratum === "county" && r.measure === FAIL ? { ...r, count: 52, value: 65 } : r,
  );
  assert.match(buildNarrative(close).bullets[0], /not statistically firm: a test across all groups gives p = 0\.\d\d/);
});

test("the chi-square p-value matches the cycle 1 report", () => {
  const r = chiSquareAcrossGroups([
    { failing: 53, tested: 96 },
    { failing: 69, tested: 98 },
    { failing: 54, tested: 81 },
    { failing: 57, tested: 78 },
  ])!;
  assert.equal(r.df, 3);
  assert.equal(Math.round(r.statistic * 100) / 100, 7.59);
  assert.equal(formatP(r.p), "p = 0.06");
  assert.ok(r.p > 0.05 && r.p < 0.056);
});

test("every one of the ten most common rules has a plain-language note", () => {
  for (const id of ["color-contrast", "link-name", "label-content-name-mismatch", "frame-title", "image-alt", "button-name", "aria-hidden-focus", "list", "meta-viewport", "nested-interactive"]) {
    assert.equal(guideFor(id).known, true, id);
  }
});

test("problems use the hand-written note when there is one and a safe fallback when there isn't", () => {
  const n = buildNarrative(agg());
  assert.equal(n.problems[0].title, "Text is hard to read against its background");
  assert.match(n.problems[0].rangeText, /40% to 63% of tested pages/);
  assert.equal(n.problems[2].known, false);
  assert.equal(n.problems[2].title, "Some new rule");
  assert.equal(guideFor("html-has-lang").effort, "quick");
  assert.deepEqual(n.quickWins.map((p) => p.rule), ["html-has-lang"]);
});

test("the next steps name the quick wins from this run", () => {
  const steps = stepsForSiteOwners(buildNarrative(agg()));
  assert.match(steps[1].body, /page language isn't set/);
});

test("the untested sentence adds up and lists the causes", () => {
  const { reach } = buildNarrative(agg());
  assert.equal(reach.sampled, 200);
  assert.equal(reach.tested, 175);
  assert.equal(reach.untested, 25);
  assert.match(reach.sentence, /19 could not be reached/);
  assert.match(reach.sentence, /4 returned an error or block page/);
  assert.match(reach.sentence, /2 asked crawlers not to visit/);
  assert.deepEqual(reach.causes.map((c) => [c.key, c.count]), [["dns", 14], ["tls", 5]]);
});

test("a run where nothing could be tested says so instead of printing empty rates", () => {
  const n = buildNarrative(
    agg({
      reach: [{ stratum: "county", sampled: 100, scanned: 0, robots_disallowed: 0, http_error: 0, unreachable: 100, unreachable_by_cause: { dns: 100 }, error: 0 }],
      strata: [],
      topRules: [],
    }),
  );
  assert.equal(n.hasData, false);
  assert.match(n.headline, /No sites could be tested/);
  assert.match(n.groups[0].sentence, /None of the 100 sampled sites/);
});

test("a small tested group carries a caution", () => {
  const a = agg();
  a.reach[1] = { ...a.reach[1], scanned: 12 };
  a.strata = a.strata.map((r) => (r.stratum === "public_4yr" && r.measure === FAIL ? { ...r, pages: 12, count: 7, value: 58.3 } : r));
  const g = buildNarrative(a).groups.find((x) => x.stratum === "public_4yr")!;
  assert.match(g.caution ?? "", /small number/);
});
