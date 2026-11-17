"use client";

import { useEffect, useRef, useState } from "react";

import {
  formatClock,
  formatDuration,
  formatElapsed,
  timeLeft,
  type Pace,
} from "@/lib/readiness/eta";
import type { ReadinessJob } from "@/lib/readiness/types";

type Snapshot = Pick<ReadinessJob, "id" | "phase" | "progress" | "createdAt" | "params">;

export type JobTiming = {
  elapsed: string;
  /** "about 1 h 5 min" or null when it is not worth showing. */
  left: string | null;
  /** "11:05 PM" or null. */
  finishAt: string | null;
  /** True until enough sites are done to use this run's own pace. */
  isEstimate: boolean;
};

/**
 * Elapsed time, time left and expected finish for a running job.
 * Measures pace from the moment this page first sees the scan running, so it also works
 * if the page is opened part-way through.
 */
export function useJobTiming(job: Snapshot | null): JobTiming | null {
  const pace = useRef<{ id: string; pace: Pace } | null>(null);
  // The clock is read only in an effect, never while rendering. Reading it during render would
  // be frozen into the prerendered page (Next.js refuses to build that).
  const [now, setNow] = useState<number | null>(null);
  const active = !!job && job.phase !== "done" && job.phase !== "error";

  useEffect(() => {
    setNow(Date.now());
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);

  useEffect(() => {
    if (job && job.phase === "scanning" && pace.current?.id !== job.id) {
      pace.current = { id: job.id, pace: { startedAtMs: Date.now(), startCurrent: job.progress.current } };
    }
  }, [job]);

  if (!job || now === null) return null;
  const elapsed = formatElapsed(now - job.createdAt);
  if (!active || job.phase !== "scanning" || !job.progress.total) {
    return { elapsed, left: null, finishAt: null, isEstimate: true };
  }
  const t = timeLeft({
    current: job.progress.current,
    total: job.progress.total,
    nowMs: now,
    pace: pace.current?.id === job.id ? pace.current.pace : null,
    delaySec: job.params.delayMs / 1000,
  });
  return {
    elapsed,
    left: formatDuration(t.seconds),
    finishAt: formatClock(now + t.seconds * 1000),
    isEstimate: t.basis === "estimate",
  };
}
