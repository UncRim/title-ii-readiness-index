import type { LogEntry, ReadinessJob, ScanResult } from "@/lib/readiness/types";
import { aggregateResults } from "@/lib/readiness/aggregate";
import { getJob, updateJob } from "@/lib/readiness/jobs";
import { buildFrame, buildStratifiedSample } from "@/lib/readiness/sample";
import { launchBrowserWithLabel, scanOne } from "@/lib/readiness/scan";

function pushLog(job: ReadinessJob, message: string, kind: LogEntry["kind"]): void {
  job.log.push({
    at: new Date().toISOString(),
    message,
    kind,
  });
}

export async function runReadinessJob(
  jobId: string,
  ipedsCsv: string,
  dotgovCsv: string,
): Promise<void> {
  const cur = getJob(jobId);
  if (!cur) return;

  try {
    updateJob(jobId, (j) => {
      j.phase = "sampling";
      j.progress = { current: 0, total: 1, label: "Building frame and sample" };
      pushLog(j, "Reading IPEDS and CISA lists…", "info");
      return j;
    });

    let frame;
    try {
      frame = buildFrame(ipedsCsv, dotgovCsv);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      updateJob(jobId, (j) => {
        j.phase = "error";
        j.error = `Sampling failed: ${msg}`;
        pushLog(j, j.error!, "error");
        return j;
      });
      return;
    }

    const sample = buildStratifiedSample(
      frame,
      cur.params.perStratum,
      cur.params.seed,
    );

    const counts = sample.reduce<Record<string, number>>((acc, r) => {
      acc[r.stratum] = (acc[r.stratum] ?? 0) + 1;
      return acc;
    }, {});

    updateJob(jobId, (j) => {
      j.sample = sample;
      pushLog(
        j,
        `Sample ready: ${sample.length} sites (strata: ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(", ")}).`,
        "success",
      );
      j.phase = "scanning";
      j.progress = {
        current: 0,
        total: sample.length,
        label: "Scanning home pages",
      };
      return j;
    });

    const { browser, label: browserLabel } = await launchBrowserWithLabel();
    updateJob(jobId, (j) => {
      pushLog(j, `Browser ready: ${browserLabel}.`, "info");
      return j;
    });
    const results: ScanResult[] = [];

    try {
      for (let i = 0; i < sample.length; i++) {
        const site = sample[i]!;
        const r = await scanOne(browser, site, cur.params.contactUrl);
        results.push(r);

        const line =
          r.status === "ok"
            ? `${i + 1}/${sample.length} tested — axe rules with issues: ${r.violations?.length ?? 0}`
            : `${i + 1}/${sample.length} ${r.status.replace("_", " ")}${r.failure_kind ? ` (${r.failure_kind})` : ""}${r.http_status ? ` HTTP ${r.http_status}` : ""}`;

        updateJob(jobId, (j) => {
          j.progress = {
            current: i + 1,
            total: sample.length,
            label: "Scanning home pages",
          };
          pushLog(j, line, r.status === "ok" ? "info" : "warn");
          return j;
        });

        if (i < sample.length - 1 && cur.params.delayMs > 0) {
          await new Promise((res) => setTimeout(res, cur.params.delayMs));
        }
      }
    } finally {
      await browser.close();
    }

    updateJob(jobId, (j) => {
      j.phase = "aggregating";
      j.progress = { current: 1, total: 1, label: "Computing aggregate tables" };
      pushLog(j, "Scan pass complete. Aggregating results (no institution names in tables)…", "info");
      return j;
    });

    const aggregate = aggregateResults(results);

    updateJob(jobId, (j) => {
      j.phase = "done";
      j.results = results;
      j.aggregate = aggregate;
      j.progress = { current: sample.length, total: sample.length, label: "Complete" };
      pushLog(j, aggregate.summaryLine, "success");
      return j;
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    updateJob(jobId, (j) => {
      j.phase = "error";
      j.error = msg;
      pushLog(j, msg, "error");
      return j;
    });
  }
}
