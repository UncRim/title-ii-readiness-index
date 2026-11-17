/**
 * Turns the aggregate numbers into plain sentences, group summaries and a short list of next steps.
 * Pure functions, no React, so they can be tested on their own.
 */
import type { AggregateOutput, ReachRow, RuleRow, StratumRow } from "@/lib/readiness/types";
import { EFFORT_LABEL, guideFor, impactLabel, type Effort } from "@/lib/readiness/rule-guide";
import { chiSquareAcrossGroups, formatP } from "@/lib/readiness/stats";

export const GROUP_ORDER = ["public_4yr", "public_2yr", "city_town", "county"];

export const STRATUM_LABEL: Record<string, string> = {
  public_4yr: "Public 4-year colleges",
  public_2yr: "Public 2-year colleges",
  city_town: "Cities and towns",
  county: "Counties",
};

export function stratumLabel(key: string): string {
  return STRATUM_LABEL[key] ?? key;
}

/** Short label used in the table of unreachable sites. */
export const CAUSE_LABEL: Record<string, string> = {
  dns: "domain not found",
  tls: "certificate or secure-connection problem",
  timeout: "timed out",
  connection: "connection refused or dropped",
  script_blocked: "test script blocked",
  other: "other",
};

/** One-line explanation of each cause, for people who don't know the terms. */
export const CAUSE_EXPLAINED: Record<string, string> = {
  dns: "The web address in the public list doesn't lead to a live site.",
  tls: "The site's security certificate was invalid or expired. The scanner never bypasses these.",
  timeout: "The site didn't answer in time, even after one retry.",
  connection: "The site refused or dropped the connection.",
  script_blocked: "The page blocked the test from running.",
  other: "The site could not be loaded for another reason.",
};

const FAILING_MEASURE_PREFIX = "% with at least one detected WCAG 2.1 A/AA failure";

function orderGroups(keys: string[]): string[] {
  return [...keys].sort((a, b) => {
    const ia = GROUP_ORDER.indexOf(a);
    const ib = GROUP_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
  });
}

function pct(n: number): string {
  return `${Math.round(n)}%`;
}

/** "about 7 in 10", with sensible wording at both ends. */
export function inTen(percent: number): string {
  if (percent < 5) return "very few";
  if (percent >= 95) return "nearly all";
  return `about ${Math.round(percent / 10)} in 10`;
}

export type GroupSummary = {
  stratum: string;
  label: string;
  sampled: number;
  tested: number;
  /** Share of tested sites with at least one failure, or null if nothing was tested. */
  failingPct: number | null;
  /** Number of tested sites with at least one failure, or null if nothing was tested. */
  failingCount: number | null;
  low: number | null;
  high: number | null;
  /** Range if every untested site had passed (low) or failed (high). */
  boundLow: number | null;
  boundHigh: number | null;
  medianProblems: number | null;
  sentence: string;
  caution: string | null;
};

export type ProblemSummary = {
  rule: string;
  title: string;
  why: string;
  fix: string;
  owner: string;
  effort: Effort;
  effortLabel: string;
  impact: string;
  impactLabel: string;
  wcag: string;
  /** False when the rule has no hand-written note. */
  known: boolean;
  /** Highest share of tested pages in any group. */
  maxShare: number;
  /** "31% to 58% of tested pages, depending on the group" */
  rangeText: string;
  byGroup: { label: string; share: number | null }[];
};

export type ReachSummary = {
  sampled: number;
  tested: number;
  untested: number;
  untestedPct: number;
  sentence: string;
  causes: { key: string; label: string; explained: string; count: number }[];
  errorPages: number;
  robots: number;
  unexpected: number;
};

export type Narrative = {
  headline: string;
  bullets: string[];
  groups: GroupSummary[];
  problems: ProblemSummary[];
  quickWins: ProblemSummary[];
  reach: ReachSummary;
  /** True when at least one site was tested. */
  hasData: boolean;
};

function findRow(strata: StratumRow[], stratum: string, startsWith: string): StratumRow | undefined {
  return strata.find((r) => r.stratum === stratum && r.measure.startsWith(startsWith));
}

function summariseGroups(agg: AggregateOutput): GroupSummary[] {
  const keys = orderGroups(agg.reach.map((r) => r.stratum));
  return keys.map((stratum) => {
    const reach = agg.reach.find((r) => r.stratum === stratum) as ReachRow;
    const label = stratumLabel(stratum);
    const failing = findRow(agg.strata, stratum, FAILING_MEASURE_PREFIX);
    const medianRow = findRow(agg.strata, stratum, "Median failing rules per page");
    const tested = reach.scanned;
    const sampled = reach.sampled;

    if (!tested || failing?.value == null) {
      return {
        stratum,
        label,
        sampled,
        tested,
        failingPct: null,
        failingCount: null,
        low: null,
        high: null,
        boundLow: null,
        boundHigh: null,
        medianProblems: null,
        sentence: `None of the ${sampled} sampled sites could be tested, so there is no rate for this group.`,
        caution: null,
      };
    }

    const value = failing.value;
    const lo = failing.ci95_low ?? value;
    const hi = failing.ci95_high ?? value;
    const failingCount = failing.count ?? Math.round((value / 100) * tested);
    const untested = Math.max(0, sampled - tested);
    const boundLow = sampled ? (100 * failingCount) / sampled : null;
    const boundHigh = sampled ? (100 * (failingCount + untested)) / sampled : null;

    return {
      stratum,
      label,
      sampled,
      tested,
      failingPct: value,
      failingCount,
      low: lo,
      high: hi,
      boundLow,
      boundHigh,
      medianProblems: medianRow?.value ?? null,
      sentence:
        `${tested} of ${sampled} sites could be tested. ${capitalise(inTen(value))} of those (${pct(value)}) had at least one ` +
        `failure that an automated check can find. With a sample this size, the real figure is probably between ${pct(lo)} and ${pct(hi)}.`,
      caution:
        tested < 30
          ? "Only a small number of sites could be tested here, so treat this figure with extra care."
          : null,
    };
  });
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function rangeText(shares: number[]): string {
  if (!shares.length) return "not found on tested pages";
  const lo = Math.min(...shares);
  const hi = Math.max(...shares);
  if (Math.round(lo) === Math.round(hi)) return `${pct(hi)} of tested pages`;
  return `${pct(lo)} to ${pct(hi)} of tested pages, depending on the group`;
}

function summariseProblem(rule: RuleRow, groupKeys: string[]): ProblemSummary {
  const g = guideFor(rule.rule);
  const byGroup = groupKeys.map((k) => ({
    label: stratumLabel(k),
    share: rule.by_stratum[k] ?? null,
  }));
  const shares = byGroup.map((b) => b.share).filter((s): s is number => s != null);
  return {
    rule: rule.rule,
    title: g.title,
    why: g.why,
    fix: g.fix,
    owner: g.owner,
    effort: g.effort,
    effortLabel: EFFORT_LABEL[g.effort],
    impact: rule.impact,
    impactLabel: impactLabel(rule.impact),
    wcag: rule.wcag_sc,
    known: g.known,
    maxShare: shares.length ? Math.max(...shares) : 0,
    rangeText: rangeText(shares),
    byGroup,
  };
}

function summariseReach(agg: AggregateOutput): ReachSummary {
  const sampled = agg.reach.reduce((s, r) => s + r.sampled, 0);
  const tested = agg.reach.reduce((s, r) => s + r.scanned, 0);
  const untested = sampled - tested;
  const causeTotals: Record<string, number> = {};
  for (const r of agg.reach) {
    for (const [k, v] of Object.entries(r.unreachable_by_cause)) {
      causeTotals[k] = (causeTotals[k] ?? 0) + v;
    }
  }
  const causes = Object.entries(causeTotals)
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => ({
      key,
      count,
      label: CAUSE_LABEL[key] ?? key,
      explained: CAUSE_EXPLAINED[key] ?? CAUSE_EXPLAINED.other,
    }));
  const errorPages = agg.reach.reduce((s, r) => s + r.http_error, 0);
  const robots = agg.reach.reduce((s, r) => s + r.robots_disallowed, 0);
  const unexpected = agg.reach.reduce((s, r) => s + r.error, 0);
  const unreachable = causes.reduce((s, c) => s + c.count, 0);

  const parts: string[] = [];
  if (unreachable) parts.push(`${unreachable} could not be reached`);
  if (errorPages) parts.push(`${errorPages} returned an error or block page`);
  if (robots) parts.push(`${robots} asked crawlers not to visit`);
  if (unexpected) parts.push(`${unexpected} failed unexpectedly`);

  const sentence = !sampled
    ? "No sites were sampled."
    : untested === 0
      ? `All ${sampled} sampled sites could be tested.`
      : `${tested} of ${sampled} sampled sites could be tested. Of the other ${untested}: ${parts.join(", ")}.`;

  return {
    sampled,
    tested,
    untested,
    untestedPct: sampled ? (100 * untested) / sampled : 0,
    sentence,
    causes,
    errorPages,
    robots,
    unexpected,
  };
}

export function buildNarrative(agg: AggregateOutput, maxProblems = 8): Narrative {
  const groups = summariseGroups(agg);
  const withData = groups.filter((g) => g.failingPct != null);
  const groupKeys = groups.map((g) => g.stratum);
  const problems = agg.topRules.slice(0, maxProblems).map((r) => summariseProblem(r, groupKeys));
  const quickWins = problems.filter((p) => p.effort === "quick").slice(0, 3);
  const reach = summariseReach(agg);
  const hasData = reach.tested > 0;

  let headline: string;
  if (!hasData) {
    headline =
      "No sites could be tested in this run, so there are no rates to report. The section on untested sites explains why.";
  } else if (withData.length === 1) {
    const g = withData[0];
    headline = `${pct(g.failingPct as number)} of the ${g.label.toLowerCase()} we could test had at least one accessibility failure on their home page that an automated check can find.`;
  } else {
    const values = withData.map((g) => g.failingPct as number);
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    headline =
      Math.round(lo) === Math.round(hi)
        ? `${pct(hi)} of the home pages we could test had at least one accessibility failure that an automated check can find.`
        : `Between ${pct(lo)} and ${pct(hi)} of the home pages we could test had at least one accessibility failure that an automated check can find, depending on the group.`;
  }

  const bullets: string[] = [];
  if (withData.length >= 2) {
    const sorted = [...withData].sort((a, b) => (b.failingPct as number) - (a.failingPct as number));
    const top = sorted[0];
    const bottom = sorted[sorted.length - 1];
    const test = chiSquareAcrossGroups(
      withData.map((g) => ({ failing: g.failingCount as number, tested: g.tested })),
    );
    const names = `${top.label} had the highest rate and ${bottom.label.toLowerCase()} the lowest`;
    let sentence: string;
    if (!test || !test.reliable) {
      sentence = `${names}. Too few sites were tested in some groups to say whether the gap is more than chance.`;
    } else if (test.p < 0.05) {
      sentence = `${names}. A test across all groups says a gap this large is unlikely to be chance alone (${formatP(test.p)}).`;
    } else {
      sentence = `${names}, but at this sample size the gap is not statistically firm: a test across all groups gives ${formatP(test.p)}, above the usual 0.05 cut-off.`;
    }
    bullets.push(sentence);
  }
  if (problems[0]) {
    bullets.push(
      `The most common problem was "${problems[0].title.toLowerCase()}", found on ${problems[0].rangeText}.`,
    );
  }
  if (quickWins.length) {
    const names = quickWins.slice(0, 2).map((p) => `"${p.title.toLowerCase()}"`);
    bullets.push(
      `${quickWins.length === 1 ? "One of the common problems is" : `${quickWins.length} of the common problems are`} often a quick fix, such as ${names.join(" and ")}.`,
    );
  }
  if (reach.untested > 0) {
    bullets.push(
      `${reach.untested} of ${reach.sampled} sampled sites (${pct(reach.untestedPct)}) could not be tested. These figures describe the tested sites only.`,
    );
  }

  return { headline, bullets, groups, problems, quickWins, reach, hasData };
}

export type Step = {
  title: string;
  body: string;
  link?: { href: string; label: string };
};

export const ADA_FIRST_STEPS_URL = "https://www.ada.gov/resources/web-rule-first-steps/";

/** Steps for someone who runs a public website. */
export function stepsForSiteOwners(n: Narrative): Step[] {
  const quick = n.quickWins.length
    ? `In this run, the likeliest quick wins were ${joinList(n.quickWins.map((p) => p.title.toLowerCase()))}. ` +
      "Each is usually a template or setting change that fixes every page at once."
    : "Look first for problems that come from the site's template or theme, because one change there fixes every page.";

  return [
    {
      title: "Check the pages people use most",
      body: "Run a free check on your home page, search page, forms, payment pages and meeting or agenda pages. Lighthouse (built into Chrome), WAVE and axe DevTools are free, and they report the kinds of problems listed above.",
    },
    {
      title: "Fix the quick ones first",
      body: quick,
    },
    {
      title: "Try it by hand",
      body: "Automated checks find only part of what is wrong. Put the mouse aside and move through the page with Tab, Shift+Tab and Enter. Zoom the page to 200%. Then listen to it with a screen reader for ten minutes.",
    },
    {
      title: "Look past the home page",
      body: "PDFs, online forms, videos, calendars and tools from outside vendors are not covered by a home-page scan. Ask vendors for their accessibility reports and ask them to fix what they find.",
    },
    {
      title: "Give people a way to tell you",
      body: "Publish a short accessibility statement with a name or an address people can write to, and decide who answers and how fast.",
    },
    {
      title: "Write a plan with owners and dates",
      body: "List what needs fixing, who does it and when. Which compliance date applies to you depends on the type and size of your organization, and the Department of Justice changed the dates in 2026, so read the official guide.",
      link: { href: ADA_FIRST_STEPS_URL, label: "ADA.gov: first steps for state and local governments" },
    },
    {
      title: "Check any fix an AI tool suggests",
      body: "AI tools can draft fixes such as alt text or form labels. Test each one: run the check again and try the page by keyboard. A fix can pass an automated check and still be wrong for the person using it.",
    },
  ];
}

/** Steps for someone using or publishing this scan's results. */
export function stepsForSharing(): Step[] {
  return [
    {
      title: "Share the public data, not the private file",
      body: "The public download has site names, addresses and error messages removed. The full file names every site. Keep it for your own checking.",
    },
    {
      title: "Say what was and wasn't measured",
      body: "These results cover the home page of each sampled site and only what automated checks can detect. They don't show that a site is compliant or non-compliant.",
    },
    {
      title: "Don't rank or name institutions",
      body: "The sample is built to describe groups of sites, not to judge individual ones. If a site owner asks, point them to the project page and the opt-out route.",
    },
    {
      title: "Run it again later",
      body: "One run is a snapshot. Running the same method again with the same seed shows whether the numbers move.",
    },
  ];
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
