/**
 * Time estimates for a scan. Pure functions so they can be tested.
 *
 * Before a run starts we only have a rule of thumb: the delay between sites plus the average
 * time a site takes to load and test. The first full run (400 sites, 5 second delay) took about
 * 1 hour 45 minutes, which works out to roughly 11 seconds of load-and-test time per site.
 * Once a few sites have been scanned we switch to the pace actually measured in this run.
 */

export const AVG_SCAN_SECONDS = 11;

/** Groups in a full sample: public 4-year, public 2-year, cities and towns, counties. */
export const GROUP_COUNT = 4;

export function sitesInRun(perStratum: number, groups = GROUP_COUNT): number {
  if (!Number.isFinite(perStratum) || perStratum < 1) return 0;
  return Math.floor(perStratum) * groups;
}

export function clampDelay(delaySec: number): number {
  if (!Number.isFinite(delaySec)) return 5;
  return Math.min(30, Math.max(0, delaySec));
}

/** Rough total time for a run before it starts. */
export function estimateSeconds(sites: number, delaySec: number): number {
  return Math.max(0, sites) * (clampDelay(delaySec) + AVG_SCAN_SECONDS);
}

/** "about 1 h 45 min", "about 12 min", "under a minute". */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "unknown";
  if (seconds < 60) return "under a minute";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `about ${minutes} min`;
  // Over an hour, round to 5 minutes so the figure doesn't flicker.
  const rounded = Math.round(minutes / 5) * 5;
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  return m === 0 ? `about ${h} h` : `about ${h} h ${m} min`;
}

/** Clock time like "11:05 PM" in the reader's locale. */
export function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export type Pace = {
  /** When we first saw the scan running (ms since epoch). */
  startedAtMs: number;
  /** Sites already done at that moment. */
  startCurrent: number;
};

export type TimeLeft = {
  seconds: number;
  /** "measured" once enough sites are done to use this run's own pace. */
  basis: "measured" | "estimate";
};

/** Sites that must finish before the measured pace is trusted. */
export const MIN_SITES_FOR_PACE = 3;

export function timeLeft(args: {
  current: number;
  total: number;
  nowMs: number;
  pace: Pace | null;
  delaySec: number;
}): TimeLeft {
  const remaining = Math.max(0, args.total - args.current);
  const done = args.pace ? args.current - args.pace.startCurrent : 0;
  if (args.pace && done >= MIN_SITES_FOR_PACE) {
    const perSite = (args.nowMs - args.pace.startedAtMs) / 1000 / done;
    return { seconds: remaining * perSite, basis: "measured" };
  }
  return { seconds: remaining * (clampDelay(args.delaySec) + AVG_SCAN_SECONDS), basis: "estimate" };
}

export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${s % 60} s`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}
