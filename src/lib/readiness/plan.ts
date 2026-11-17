/**
 * Works out, from the two uploaded files, exactly which sites a run would scan and how long it
 * should take. It uses the same frame builder and the same seeded sampler as the server, so the
 * counts shown before a run match what the run does.
 */
import { estimateSeconds } from "@/lib/readiness/eta";
import { GROUP_ORDER } from "@/lib/readiness/narrative";
import {
  buildFrame,
  buildStratifiedSample,
  parseCollegesCsv,
  parseDotGovCsv,
} from "@/lib/readiness/sample";
import type { SiteRow } from "@/lib/readiness/types";

export type RunPlan = {
  /** How many sites each group has in the uploaded files. */
  frameByGroup: Record<string, number>;
  /** How many of those the run would scan. */
  sampleByGroup: Record<string, number>;
  /** Groups with fewer sites than were asked for. */
  shortGroups: { stratum: string; asked: number; available: number }[];
  sites: number;
  seconds: number;
};

export type ReadResult = { ok: true; frame: SiteRow[] } | { ok: false; error: string };

function why(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Reads both files and builds the list of sites. Says which file is wrong when one is. */
export function readFrame(ipedsCsv: string, dotgovCsv: string): ReadResult {
  let colleges: SiteRow[];
  try {
    colleges = parseCollegesCsv(ipedsCsv);
  } catch (e) {
    return {
      ok: false,
      error: `The first file doesn't look like the IPEDS directory file (for example HD2024.csv). ${why(e)}`,
    };
  }
  let governments: SiteRow[];
  try {
    governments = parseDotGovCsv(dotgovCsv);
  } catch (e) {
    return {
      ok: false,
      error: `The second file doesn't look like CISA's current-full.csv. ${why(e)}`,
    };
  }
  if (!colleges.length) {
    return {
      ok: false,
      error:
        "No active public 2-year or 4-year colleges with a website were found in the first file. Check that it is the IPEDS directory (HD) file for a recent year.",
    };
  }
  if (!governments.length) {
    return {
      ok: false,
      error:
        "No city, town or county websites were found in the second file. Check that it is CISA's current-full.csv.",
    };
  }
  return { ok: true, frame: buildFrame(ipedsCsv, dotgovCsv) };
}

function countByGroup(rows: SiteRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[r.stratum] = (out[r.stratum] ?? 0) + 1;
  return out;
}

export function planRun(frame: SiteRow[], perStratum: number, seed: number, delaySec: number): RunPlan {
  const asked = Math.min(500, Math.max(1, Math.floor(perStratum) || 1));
  const sample = buildStratifiedSample(frame, asked, Math.floor(seed) || 2026);
  const frameByGroup = countByGroup(frame);
  const sampleByGroup = countByGroup(sample);
  const shortGroups = GROUP_ORDER.filter((g) => (frameByGroup[g] ?? 0) < asked).map((g) => ({
    stratum: g,
    asked,
    available: frameByGroup[g] ?? 0,
  }));
  return {
    frameByGroup,
    sampleByGroup,
    shortGroups,
    sites: sample.length,
    seconds: estimateSeconds(sample.length, delaySec),
  };
}
