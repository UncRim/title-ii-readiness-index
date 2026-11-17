/** Plain-language copy keyed by audience level. */
export type AudienceLevel = "new" | "familiar" | "expert";

export const titleByLevel: Record<AudienceLevel, string> = {
  new: "What this tool does",
  familiar: "How the study runs",
  expert: "Methods alignment",
};

export const bodyByLevel: Record<AudienceLevel, string> = {
  new:
    "You upload two public lists: colleges (IPEDS directory CSV) and governments (CISA’s current-full.csv). " +
    "The tool picks a random sample from four groups (two college types, cities/towns, counties), then opens each home page once, " +
    "checks robots.txt, and runs an automated accessibility check. You see progress and a summary—never a ranked list of institutions.",
  familiar:
    "Stratified random sample: per-stratum N with a fixed seed for reproducibility. " +
    "One page per site, domcontentloaded + short settle, axe WCAG 2.1 A/AA tags, plus heading/link heuristics and advisory reading grade. " +
    "Respects robots.txt for our crawler token; polite delay between requests.",
  expert:
    "Mirrors the Title II Readiness toolkit: buildFrame → stratified sample (Mulberry32 on seed) → Playwright chromium + axe-core runOnly wcag2a/2aa/21a/21aa, " +
    "violations slimmed to id/impact/wcag tags/nodes; content checks: lang, H1 count, heading level skips, vague link list; FK grade on main text when word count allows. " +
    "Aggregation: Wilson 95% CIs on proportions; medians for rule counts, node counts, grade; rule prevalence across pages—no named institutions in outputs.",
};
