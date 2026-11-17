import type { ReadinessJob } from "@/lib/readiness/types";

const store = new Map<string, ReadinessJob>();

export function createJob(job: ReadinessJob): void {
  store.set(job.id, job);
}

export function getJob(id: string): ReadinessJob | undefined {
  return store.get(id);
}

export function updateJob(
  id: string,
  patch: Partial<ReadinessJob> | ((j: ReadinessJob) => ReadinessJob),
): ReadinessJob | undefined {
  const cur = store.get(id);
  if (!cur) return undefined;
  const next = typeof patch === "function" ? patch(cur) : { ...cur, ...patch };
  store.set(id, next);
  return next;
}
