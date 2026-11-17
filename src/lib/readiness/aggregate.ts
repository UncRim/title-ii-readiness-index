import {
  WCAG_STANDARD_LABEL,
  type AggregateOutput,
  type EngineInfo,
  type ReachRow,
  type RuleRow,
  type ScanResult,
  type StratumRow,
} from "@/lib/readiness/types";

function wilson(k: number, n: number, z = 1.96): [number | null, number | null] {
  if (n === 0) return [null, null];
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h =
    (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.round(100 * (c - h) * 10) / 10, Math.round(100 * (c + h) * 10) / 10];
}

function scFromTags(tags: string[]): string {
  const out = new Set<string>();
  for (const t of tags) {
    const m = /^wcag(\d)(\d)(\d+)$/.exec(t);
    if (m) out.add(`${m[1]}.${m[2]}.${m[3]}`);
  }
  return [...out].sort().join(", ");
}

function pctRow(
  label: string,
  k: number,
  n: number,
): Omit<StratumRow, "stratum"> {
  const [lo, hi] = wilson(k, n);
  return {
    measure: label,
    pages: n,
    count: k,
    value: n ? Math.round((100 * k) / n * 10) / 10 : null,
    ci95_low: lo,
    ci95_high: hi,
  };
}

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** For each group: how many sampled sites were tested, and why the others were not. */
function reachTable(rows: ScanResult[]): ReachRow[] {
  const groups = [...new Set(rows.map((r) => r.stratum))].sort();
  return groups.map((stratum) => {
    const rs = rows.filter((r) => r.stratum === stratum);
    const unreachable = rs.filter((r) => r.status === "unreachable");
    const by_cause: Record<string, number> = {};
    for (const r of unreachable) {
      const k = r.failure_kind ?? "other";
      by_cause[k] = (by_cause[k] ?? 0) + 1;
    }
    const n = (st: ScanResult["status"]) => rs.filter((r) => r.status === st).length;
    return {
      stratum,
      sampled: rs.length,
      scanned: n("ok"),
      robots_disallowed: n("robots_disallowed"),
      http_error: n("http_error"),
      unreachable: unreachable.length,
      unreachable_by_cause: by_cause,
      error: n("error"),
    };
  });
}

export function aggregateResults(rows: ScanResult[]): AggregateOutput {
  const statusCount: Record<string, number> = {};
  for (const r of rows) {
    statusCount[r.status] = (statusCount[r.status] ?? 0) + 1;
  }
  const ok = rows.filter((r) => r.status === "ok");

  const reach = reachTable(rows);

  const byStratum = new Map<string, ScanResult[]>();
  for (const r of ok) {
    const list = byStratum.get(r.stratum) ?? [];
    list.push(r);
    byStratum.set(r.stratum, list);
  }
  // No pooled "all" group: the groups have equal sample sizes but very different populations,
  // so averaging them would not describe the country. Report each group on its own.

  const rulePages = new Map<string, Set<string>>();
  const ruleMeta = new Map<string, [string, string]>();
  for (const r of ok) {
    for (const v of r.violations ?? []) {
      if (!rulePages.has(v.id)) rulePages.set(v.id, new Set());
      rulePages.get(v.id)!.add(r.site_id);
      ruleMeta.set(v.id, [v.impact, scFromTags(v.tags)]);
    }
  }

  const strataRows: StratumRow[] = [];
  const strataSorted = [...byStratum.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  );
  for (const [s, rs] of strataSorted) {
    const n = rs.length;
    const measures: [string, number][] = [
      ["% with at least one detected WCAG 2.1 A/AA failure", rs.filter((r) => (r.violations?.length ?? 0) > 0).length],
      ["% missing page language", rs.filter((r) => !r.has_lang).length],
      ["% with a skipped heading level", rs.filter((r) => (r.heading_skips ?? 0) > 0).length],
      ["% without exactly one H1", rs.filter((r) => r.h1_count !== 1).length],
      ["% with a vague link such as click here", rs.filter((r) => (r.vague_links ?? 0) > 0).length],
    ];
    for (const [label, k] of measures) {
      strataRows.push({ stratum: s, ...pctRow(label, k, n) });
    }
    const grades = rs
      .map((r) => r.reading_grade)
      .filter((g): g is number => g != null && !Number.isNaN(g));
    const fails = rs.map((r) => r.violations?.length ?? 0);
    const nodes = rs.map((r) =>
      (r.violations ?? []).reduce((s, v) => s + v.nodes, 0),
    );
    strataRows.push({
      stratum: s,
      measure: "Median failing rules per page",
      pages: n,
      value: median(fails),
    });
    strataRows.push({
      stratum: s,
      measure: "Median failing elements per page",
      pages: n,
      value: median(nodes),
    });
    strataRows.push({
      stratum: s,
      measure: "Median reading grade (advisory, AAA)",
      pages: grades.length,
      value: median(grades),
    });
  }

  const nAll = ok.length;
  const topRules: RuleRow[] = [...rulePages.entries()]
    .map(([rid, pages]) => {
      const meta = ruleMeta.get(rid)!;
      const by_stratum: Record<string, number | null> = {};
      for (const [stratum, rs] of byStratum) {
        const k = rs.filter((r) => pages.has(r.site_id)).length;
        by_stratum[stratum] = rs.length ? Math.round((1000 * k) / rs.length) / 10 : null;
      }
      return {
        rule: rid,
        wcag_sc: meta[1],
        impact: meta[0],
        pages: pages.size,
        percent_of_pages: nAll
          ? Math.round((100 * pages.size) / nAll * 10) / 10
          : null,
        by_stratum,
      };
    })
    .sort((a, b) => b.pages - a.pages)
    .slice(0, 15);

  const summaryLine =
    `Sampled ${rows.length} sites: ${statusCount.ok ?? 0} tested, ` +
    `${statusCount.unreachable ?? 0} unreachable, ` +
    `${statusCount.http_error ?? 0} returned an error or block page, ` +
    `${statusCount.robots_disallowed ?? 0} skipped because robots.txt asks crawlers not to visit, ` +
    `${statusCount.error ?? 0} failed unexpectedly.`;

  const mostCommon = (vals: (string | undefined)[]) => {
    const counts = new Map<string, number>();
    for (const v of vals) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
    let best: string | null = null;
    for (const [v, c] of counts) if (best === null || c > (counts.get(best) ?? 0)) best = v;
    return { best, distinct: counts.size };
  };
  const sv = mostCommon(rows.map((r) => r.scanner_version));
  const av = mostCommon(rows.map((r) => r.axe_version));
  const engine: EngineInfo = {
    scanner_version: sv.best,
    axe_version: av.best,
    mixed_versions: sv.distinct > 1 || av.distinct > 1,
    standard: WCAG_STANDARD_LABEL,
  };

  return { summaryLine, engine, reach, strata: strataRows, topRules };
}
