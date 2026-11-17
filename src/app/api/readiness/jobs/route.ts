import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import {
  parseGovAllowlistEnv,
  validateContactUrl,
} from "@/lib/readiness/contact-url";
import { createJob } from "@/lib/readiness/jobs";
import { runReadinessJob } from "@/lib/readiness/run-pipeline";
import type { ReadinessJob } from "@/lib/readiness/types";

const MAX_CSV_BYTES = 30 * 1024 * 1024;

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const ipeds = form.get("ipeds");
    const dotgov = form.get("dotgov");

    if (!(ipeds instanceof File) || !(dotgov instanceof File)) {
      return NextResponse.json(
        { error: "Upload both CSV files: ipeds (HD*.csv) and dotgov (current-full.csv)." },
        { status: 400 },
      );
    }
    if (ipeds.size === 0 || dotgov.size === 0) {
      return NextResponse.json(
        { error: "Both files must be non-empty." },
        { status: 400 },
      );
    }
    if (ipeds.size > MAX_CSV_BYTES || dotgov.size > MAX_CSV_BYTES) {
      return NextResponse.json(
        { error: "Each file must be under 30 MB." },
        { status: 400 },
      );
    }

    const perStratum = Math.min(
      500,
      Math.max(1, Number(form.get("perStratum") ?? 100) || 100),
    );
    const seed = Math.floor(Number(form.get("seed") ?? 2026) || 2026);
    const delaySec = Math.min(
      30,
      Math.max(0, Number(form.get("delaySec") ?? 5) || 5),
    );
    const contactRaw = String(form.get("contactUrl") ?? "").trim();
    const envDefault = process.env.READINESS_CONTACT_URL?.trim() ?? "";
    const contactCandidate = contactRaw || envDefault;

    const allowGov = parseGovAllowlistEnv(
      process.env.READINESS_ALLOWED_GOV_CONTACT_HOSTS,
    );
    const contactCheck = validateContactUrl(contactCandidate, allowGov);
    if (!contactCheck.ok) {
      return NextResponse.json({ error: contactCheck.error }, { status: 400 });
    }
    const contactUrl = contactCheck.href;

    const id = randomUUID();
    const job: ReadinessJob = {
      id,
      phase: "queued",
      createdAt: Date.now(),
      progress: { current: 0, total: 0, label: "Queued" },
      log: [
        {
          at: new Date().toISOString(),
          message: "Job queued. Starting sampling…",
          kind: "info",
        },
      ],
      params: {
        perStratum,
        seed,
        delayMs: Math.round(delaySec * 1000),
        contactUrl,
      },
    };
    createJob(job);

    const ipedsText = await ipeds.text();
    const dotgovText = await dotgov.text();

    void runReadinessJob(id, ipedsText, dotgovText).catch((e) => {
      console.error("runReadinessJob", id, e);
    });

    return NextResponse.json({ id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
