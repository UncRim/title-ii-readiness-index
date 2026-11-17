import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getJob } from "@/lib/readiness/jobs";
import type { ReadinessJob, ScanResult } from "@/lib/readiness/types";

/**
 * Two downloads:
 * - default: every field, including site names and addresses. For your own checking only.
 * - ?public=1: names, addresses and error text removed, safe to publish with the report.
 */
function toPublicRecord(r: ScanResult, seed: number) {
  const id = createHash("sha256").update(`${seed}:${r.site_id}`).digest("hex").slice(0, 12);
  return {
    id,
    stratum: r.stratum,
    state: r.state,
    status: r.status,
    failure_kind: r.failure_kind,
    http_status: r.http_status,
    scanned_on: r.scanned_at.slice(0, 10),
    scanner_version: r.scanner_version,
    axe_version: r.axe_version,
    attempts: r.attempts?.map((a) => ({ outcome: a.outcome, http_status: a.http_status })),
    violations: r.violations,
    incomplete: r.incomplete,
    h1_count: r.h1_count,
    heading_count: r.heading_count,
    heading_skips: r.heading_skips,
    link_count: r.link_count,
    vague_links: r.vague_links,
    has_lang: r.has_lang,
    reading_grade: r.reading_grade,
  };
}

function publicMeta(job: ReadinessJob) {
  return {
    id: job.id,
    params: {
      perStratum: job.params.perStratum,
      seed: job.params.seed,
      delayMs: job.params.delayMs,
    },
    summary: job.aggregate?.summaryLine,
    note:
      "Site names, addresses and error text are removed. Ids are one-way hashes of the site id and the seed.",
  };
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const job = getJob(id);
  if (!job || job.phase !== "done" || !job.results) {
    return NextResponse.json(
      { error: "Results not ready or job not found." },
      { status: 404 },
    );
  }
  const wantsPublic = req.nextUrl.searchParams.get("public") === "1";
  if (wantsPublic) {
    return NextResponse.json(
      {
        meta: publicMeta(job),
        reach: job.aggregate?.reach,
        results: job.results.map((r) => toPublicRecord(r, job.params.seed)),
      },
      {
        headers: {
          "Content-Disposition": `attachment; filename="readiness-results-public-${id}.json"`,
        },
      },
    );
  }
  return NextResponse.json(
    {
      meta: {
        id: job.id,
        params: job.params,
        summary: job.aggregate?.summaryLine,
        warning: "This file contains site names and addresses. Do not publish it.",
      },
      reach: job.aggregate?.reach,
      results: job.results,
    },
    {
      headers: {
        "Content-Disposition": `attachment; filename="readiness-results-${id}.json"`,
      },
    },
  );
}
