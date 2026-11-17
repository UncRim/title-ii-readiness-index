/**
 * Checks the time estimates shown while a scan runs. Run with: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  estimateSeconds,
  formatDuration,
  formatElapsed,
  sitesInRun,
  timeLeft,
} from "@/lib/readiness/eta";

test("a default run is about an hour and three quarters, matching the first real run", () => {
  const secs = estimateSeconds(sitesInRun(100), 5);
  assert.equal(sitesInRun(100), 400);
  assert.equal(formatDuration(secs), "about 1 h 45 min");
});

test("bad input does not produce nonsense", () => {
  assert.equal(sitesInRun(0), 0);
  assert.equal(sitesInRun(Number.NaN), 0);
  assert.equal(estimateSeconds(10, Number.NaN), 10 * (5 + 11));
  assert.equal(estimateSeconds(10, 999), 10 * (30 + 11));
  assert.equal(formatDuration(Number.NaN), "unknown");
});

test("durations read naturally at each scale", () => {
  assert.equal(formatDuration(20), "under a minute");
  assert.equal(formatDuration(12 * 60), "about 12 min");
  assert.equal(formatDuration(2 * 3600), "about 2 h");
  assert.equal(formatDuration(3600 + 17 * 60), "about 1 h 15 min");
});

test("before enough sites are done the estimate uses the rule of thumb", () => {
  const t = timeLeft({ current: 1, total: 400, nowMs: 5_000, pace: { startedAtMs: 0, startCurrent: 0 }, delaySec: 5 });
  assert.equal(t.basis, "estimate");
  assert.equal(t.seconds, 399 * 16);
});

test("after a few sites the measured pace takes over", () => {
  // 10 sites in 100 seconds = 10 s each, 90 left.
  const t = timeLeft({ current: 10, total: 100, nowMs: 100_000, pace: { startedAtMs: 0, startCurrent: 0 }, delaySec: 5 });
  assert.equal(t.basis, "measured");
  assert.equal(t.seconds, 900);
});

test("the pace ignores sites that were already done when the page was opened", () => {
  // Page opened at 50 of 100 done; 5 more in 50 seconds = 10 s each; 45 left.
  const t = timeLeft({ current: 55, total: 100, nowMs: 50_000, pace: { startedAtMs: 0, startCurrent: 50 }, delaySec: 5 });
  assert.equal(t.basis, "measured");
  assert.equal(t.seconds, 450);
});

test("nothing left means zero, never negative", () => {
  const t = timeLeft({ current: 400, total: 400, nowMs: 1, pace: null, delaySec: 5 });
  assert.equal(t.seconds, 0);
});

test("elapsed time reads naturally", () => {
  assert.equal(formatElapsed(42_000), "42 s");
  assert.equal(formatElapsed(125_000), "2 min 5 s");
  assert.equal(formatElapsed(3_900_000), "1 h 5 min");
});
