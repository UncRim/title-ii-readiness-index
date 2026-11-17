"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  RiArrowRightLine,
  RiCheckboxCircleLine,
  RiExternalLinkLine,
  RiShieldCheckLine,
} from "@remixicon/react";

import { Button, ButtonLink } from "@/components/base/buttons/button";
import { Divider } from "@/components/base/divider/divider";
import { Input } from "@/components/base/input/input";
import { ProgressBar } from "@/components/base/progress/progress";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@/components/base/segmented-control/segmented-control";
import type { AudienceLevel } from "@/lib/readiness/copy";
import { bodyByLevel, titleByLevel } from "@/lib/readiness/copy";
import { parseGovAllowlistEnv, validateContactUrl } from "@/lib/readiness/contact-url";
import { AVG_SCAN_SECONDS, clampDelay, formatDuration } from "@/lib/readiness/eta";
import { GROUP_ORDER, stratumLabel } from "@/lib/readiness/narrative";
import { planRun, readFrame } from "@/lib/readiness/plan";
import type { JobPhase, LogEntry, ReadinessJob, SiteRow } from "@/lib/readiness/types";
import { cx } from "@/utils/cx";
import { useJobTiming } from "./use-job-timing";

type JobSnapshot = Omit<ReadinessJob, "results">;

type FrameState =
  | { kind: "idle" }
  | { kind: "reading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; sites: SiteRow[] };

function phaseLabel(phase: JobPhase): string {
  switch (phase) {
    case "queued":
      return "Queued";
    case "sampling":
      return "Building the sample";
    case "scanning":
      return "Scanning sites";
    case "aggregating":
      return "Adding up the results";
    case "done":
      return "Finished";
    case "error":
      return "Stopped with an error";
    default:
      return phase;
  }
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function ReadinessPortalClient() {
  const [audience, setAudience] = useState<AudienceLevel>("new");
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<JobSnapshot | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(true);
  const [perStratum, setPerStratum] = useState(100);
  const [seed, setSeed] = useState(2026);
  const [delaySec, setDelaySec] = useState(5);
  const [files, setFiles] = useState<{ ipeds: File | null; dotgov: File | null }>({
    ipeds: null,
    dotgov: null,
  });
  const [frame, setFrame] = useState<FrameState>({ kind: "idle" });
  const errorRef = useRef<HTMLParagraphElement>(null);

  const running = !!job && job.phase !== "done" && job.phase !== "error";
  const timing = useJobTiming(job);

  const poll = useCallback(async () => {
    if (!jobId) return;
    const res = await fetch(`/api/readiness/jobs/${jobId}`);
    if (!res.ok) return;
    const data = (await res.json()) as JobSnapshot;
    setJob(data);
  }, [jobId]);

  useEffect(() => {
    if (!jobId) return;
    void poll();
    const t = setInterval(() => void poll(), 1500);
    return () => clearInterval(t);
  }, [jobId, poll]);

  // When a scan starts, bring the progress panel into view and move keyboard focus to it.
  useEffect(() => {
    if (!jobId) return;
    window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
    document.getElementById("progress-heading")?.focus({ preventScroll: true });
  }, [jobId]);

  // If the scan fails, reopen the settings so the fix is one click away.
  useEffect(() => {
    if (job?.phase === "error") setFormOpen(true);
  }, [job?.phase]);

  // Move focus to a form error so keyboard and screen reader users hear it.
  useEffect(() => {
    if (formError) errorRef.current?.focus();
  }, [formError]);

  const progressPercent = useMemo(() => {
    if (!job) return 0;
    const { current, total } = job.progress;
    if (!total) return 0;
    return Math.min(100, Math.round((100 * current) / total));
  }, [job]);

  // A short message for screen readers, only when it changes meaningfully (every 10%).
  const announcement = useMemo(() => {
    if (!job) return "";
    if (job.phase === "done") return "The scan is finished. Your results are ready.";
    if (job.phase === "error") return "The scan stopped with an error.";
    if (job.phase === "scanning") {
      return `Scanning sites, ${Math.floor(progressPercent / 10) * 10} percent complete.`;
    }
    return `${phaseLabel(job.phase)}.`;
  }, [job, progressPercent]);

  // Read both files in the browser as soon as both are chosen, so the page can say how many sites
  // the run will visit and how long that should take.
  useEffect(() => {
    const { ipeds, dotgov } = files;
    if (!ipeds || !dotgov) {
      setFrame({ kind: "idle" });
      return;
    }
    let cancelled = false;
    setFrame({ kind: "reading" });
    (async () => {
      try {
        const [a, b] = await Promise.all([ipeds.text(), dotgov.text()]);
        if (cancelled) return;
        const r = readFrame(a, b);
        setFrame(r.ok ? { kind: "ready", sites: r.frame } : { kind: "error", message: r.error });
      } catch (err) {
        if (!cancelled) {
          setFrame({ kind: "error", message: `The files could not be read. ${err instanceof Error ? err.message : ""}` });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [files]);

  const plan = useMemo(
    () => (frame.kind === "ready" ? planRun(frame.sites, perStratum, seed, delaySec) : null),
    [frame, perStratum, seed, delaySec],
  );

  function onFormChange(e: React.FormEvent<HTMLFormElement>) {
    const fd = new FormData(e.currentTarget);
    const p = Number(fd.get("perStratum"));
    const sd = Number(fd.get("seed"));
    const d = Number(fd.get("delaySec"));
    if (Number.isFinite(p)) setPerStratum(Math.min(500, Math.max(0, Math.floor(p))));
    if (Number.isFinite(sd)) setSeed(Math.floor(sd));
    if (Number.isFinite(d)) setDelaySec(clampDelay(d));
    const a = fd.get("ipeds");
    const b = fd.get("dotgov");
    const next = {
      ipeds: a instanceof File && a.size > 0 ? a : null,
      dotgov: b instanceof File && b.size > 0 ? b : null,
    };
    setFiles((cur) => (cur.ipeds === next.ipeds && cur.dotgov === next.dotgov ? cur : next));
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    const fd = new FormData(e.currentTarget);
    const ipeds = fd.get("ipeds");
    const dotgov = fd.get("dotgov");
    if (!(ipeds instanceof File) || !(dotgov instanceof File)) {
      setFormError("Choose both CSV files.");
      return;
    }
    if (ipeds.size === 0 || dotgov.size === 0) {
      setFormError("Both files must be selected.");
      return;
    }
    // Check the project page address here so mistakes show up before anything is uploaded.
    // A blank field is allowed because the server can use READINESS_CONTACT_URL instead.
    const contactStr = String(fd.get("contactUrl") ?? "").trim();
    if (contactStr) {
      const contactCheck = validateContactUrl(
        contactStr,
        parseGovAllowlistEnv(process.env.NEXT_PUBLIC_READINESS_ALLOWED_GOV_CONTACT_HOSTS),
      );
      if (!contactCheck.ok) {
        setFormError(contactCheck.error);
        return;
      }
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/readiness/jobs", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setFormError(data.error ?? "Request failed");
        return;
      }
      setJob(null);
      setJobId(data.id as string);
      setFormOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  const formBody = (
    <form
      onSubmit={onSubmit}
      onChange={onFormChange}
      className="flex flex-col gap-5 rounded-2xl border border-border-button-default bg-background-secondary-default p-5 md:p-6"
    >
      <div className="grid gap-5 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <label htmlFor="ipeds" className="text-body-medium text-text-primary">
            IPEDS directory CSV <span className="text-text-secondary">(required)</span>
          </label>
          <input
            id="ipeds"
            name="ipeds"
            type="file"
            accept=".csv,text/csv"
            required
            aria-describedby="ipeds-help"
            className={cx(
              "block w-full cursor-pointer rounded-xl border border-border-button-default bg-background-primary-default px-3 py-2",
              "text-body-regular text-text-primary file:me-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-background-secondary-default file:px-3 file:py-1.5 file:text-body-medium",
            )}
          />
          <p id="ipeds-help" className="text-caption-1-regular text-text-secondary">
            The college directory file from IPEDS, for example HD2024.csv.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="dotgov" className="text-body-medium text-text-primary">
            CISA current-full.csv <span className="text-text-secondary">(required)</span>
          </label>
          <input
            id="dotgov"
            name="dotgov"
            type="file"
            accept=".csv,text/csv"
            required
            aria-describedby="dotgov-help"
            className={cx(
              "block w-full cursor-pointer rounded-xl border border-border-button-default bg-background-primary-default px-3 py-2",
              "text-body-regular text-text-primary file:me-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-background-secondary-default file:px-3 file:py-1.5 file:text-body-medium",
            )}
          />
          <p id="dotgov-help" className="text-caption-1-regular text-text-secondary">
            The list of .gov domains published by CISA.
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="flex flex-col gap-1">
          <Input name="perStratum" label="Sites per group" type="number" defaultValue="100" />
          <p className="text-caption-1-regular text-text-secondary">
            1 to 500. The default is 100 per group, 400 in all.
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <Input name="seed" label="Random seed" type="number" defaultValue="2026" />
          <p className="text-caption-1-regular text-text-secondary">
            The same seed picks the same sample again.
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <Input name="delaySec" label="Pause between sites (seconds)" type="number" defaultValue="5" />
          <p className="text-caption-1-regular text-text-secondary">
            0 to 30. A pause keeps the scan polite.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <Input
          name="contactUrl"
          label="Project page address (sent to every site you scan)"
          type="url"
          placeholder="https://yourdomain.org/your-study-page"
        />
        <p className="text-caption-1-regular text-text-secondary">
          Required. A public page you control that explains the scan and how to opt out. Site owners
          see this address in their server logs. It can't be localhost, and{" "}
          <code className="font-mono text-caption-1-regular">.gov</code> addresses are blocked unless
          allowed on the server. To avoid typing it each time, set READINESS_CONTACT_URL in .env.local
          and leave this blank.
        </p>
      </div>

      <RunPlanPanel frame={frame} plan={plan} perStratum={perStratum} delaySec={delaySec} />

      {formError && (
        <p
          ref={errorRef}
          tabIndex={-1}
          id="form-error"
          className="rounded-lg border border-status-rose-text px-3 py-2 text-body-medium text-status-rose-text focus:outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring"
          role="alert"
        >
          {formError}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          variant="primary"
          disabled={submitting || running || frame.kind === "reading" || frame.kind === "error"}
        >
          {submitting ? "Starting…" : running ? "A scan is running" : "Start run"}
        </Button>
        {running && (
          <span className="text-caption-1-regular text-text-secondary">
            Only one scan runs at a time, so the pace stays polite for the sites being visited.
          </span>
        )}
      </div>
    </form>
  );

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-10 px-4 py-10 sm:px-6 lg:px-10">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(260px,340px)] lg:items-start lg:gap-12">
        <div className="flex min-w-0 flex-col gap-10">
          <header className="flex items-start gap-3">
            <span className="mt-0.5 flex size-11 items-center justify-center rounded-2xl bg-background-secondary-default">
              <RiShieldCheckLine className="size-6 text-foreground-icon-primary" aria-hidden />
            </span>
            <div>
              <h1 className="text-title-display-3-medium text-text-primary">Run a readiness scan</h1>
              <p className="mt-1 max-w-2xl text-body-regular text-text-secondary">
                Upload the two public lists, start the scan and watch it work. When it finishes you get a
                separate results page that explains what was found and what to do about it. Nothing here
                ranks or names individual institutions.
              </p>
            </div>
          </header>

          {jobId && (
            <section
              aria-labelledby="progress-heading"
              aria-busy={running}
              className="flex flex-col gap-4 rounded-2xl border border-border-button-default bg-background-secondary-default p-5 md:p-6"
            >
              <h2
                id="progress-heading"
                tabIndex={-1}
                className="text-title-h5-medium text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring"
              >
                Live progress
              </h2>
              <p className="sr-only" role="status">
                {announcement}
              </p>

              {!job ? (
                <p className="text-body-regular text-text-secondary">Connecting to the scan…</p>
              ) : (
                <>
                  <div className="flex flex-col gap-1">
                    <p className="text-body-medium text-text-primary">
                      {phaseLabel(job.phase)}
                      {job.phase === "scanning" && job.progress.total
                        ? `: ${job.progress.current} of ${job.progress.total} sites (${progressPercent}%)`
                        : null}
                    </p>
                    {running && timing && (
                      <p className="text-body-regular text-text-secondary">
                        Running for {timing.elapsed}.
                        {timing.left && timing.finishAt ? (
                          <>
                            {" "}
                            Time left: {timing.left}
                            {timing.isEstimate ? " (early estimate)" : ""}. Expected to finish around{" "}
                            {timing.finishAt}.
                          </>
                        ) : job.phase === "scanning" ? null : (
                          " The time left appears once scanning starts."
                        )}
                      </p>
                    )}
                  </div>
                  <ProgressBar
                    label="Overall progress"
                    size="lg"
                    value={job.phase === "done" ? 100 : progressPercent}
                    isIndeterminate={
                      job.phase === "queued" || job.phase === "sampling" || job.phase === "aggregating"
                    }
                  />

                  {job.error && (
                    <div className="flex flex-col gap-2" role="alert">
                      <p className="text-body-medium text-status-rose-text">{job.error}</p>
                      <p className="text-body-regular text-text-secondary">
                        Fix this, then open Scan settings below and start again.
                      </p>
                    </div>
                  )}

                  {job.phase === "done" && (
                    <div className="flex flex-col gap-3 rounded-xl border border-border-button-default bg-background-primary-default p-4">
                      <div className="flex items-start gap-3">
                        <RiCheckboxCircleLine
                          className="mt-0.5 size-6 shrink-0 text-status-lime-text"
                          aria-hidden
                        />
                        <div>
                          <p className="text-body-medium text-text-primary">The scan is finished.</p>
                          <p className="mt-1 text-body-regular text-text-secondary">
                            The results page has a plain summary, the most common problems with typical
                            fixes, which sites could not be tested, suggested next steps and the
                            downloads.
                          </p>
                        </div>
                      </div>
                      <div>
                        <ButtonLink variant="primary" leadingIcon={RiArrowRightLine} href={`/results/${jobId}`}>
                          View results
                        </ButtonLink>
                      </div>
                      <p className="text-caption-1-regular text-text-secondary">
                        Runs are kept in memory only. If you restart the server this link stops working,
                        so download the public data first.
                      </p>
                    </div>
                  )}

                  {running && (
                    <p className="text-caption-1-regular text-text-secondary">
                      Keep the server running. If you close this tab, the results will be at{" "}
                      <bdi className="font-mono">/results/{jobId}</bdi> when the scan finishes.
                    </p>
                  )}

                  <ActivityLog entries={job.log} />
                </>
              )}
            </section>
          )}

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 rounded-2xl border border-border-button-default bg-background-secondary-default p-4 md:flex-row md:items-center md:justify-between">
              <p className="text-body-medium text-text-primary">How much do you want to read?</p>
              <SegmentedControl
                className="[&_button]:text-text-primary"
                aria-label="Explanation depth"
                selectedKeys={[audience]}
                onSelectionChange={(keys) => {
                  const k = [...keys][0];
                  if (k === "new" || k === "familiar" || k === "expert") {
                    setAudience(k);
                  }
                }}
              >
                <SegmentedControlItem id="new">New here</SegmentedControlItem>
                <SegmentedControlItem id="familiar">Familiar</SegmentedControlItem>
                <SegmentedControlItem id="expert">Expert</SegmentedControlItem>
              </SegmentedControl>
            </div>

            <section
              aria-labelledby="explain-heading"
              className="rounded-2xl border border-border-button-default bg-background-primary-default p-5 shadow-xs"
            >
              <h2 id="explain-heading" className="text-title-h6-medium text-text-primary">
                {titleByLevel[audience]}
              </h2>
              <p className="mt-2 text-body-regular text-text-secondary">{bodyByLevel[audience]}</p>
            </section>
          </div>

          <Divider />

          <section aria-labelledby="setup-heading" className="flex flex-col gap-6">
            <div>
              <h2 id="setup-heading" className="text-title-h5-medium text-text-primary">
                Scan settings
              </h2>
              <p className="mt-1 text-body-regular text-text-secondary">
                Use the same sources as the toolkit: the IPEDS directory file (for example HD2024.csv) and{" "}
                <a
                  href="https://github.com/cisagov/dotgov-data/blob/main/current-full.csv"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-body-medium text-text-brand-default underline-offset-2 hover:underline"
                >
                  CISA current-full.csv
                  <RiExternalLinkLine
                    className="ms-1 inline size-4 align-text-bottom text-foreground-icon-secondary"
                    aria-hidden
                  />
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
                .
              </p>
            </div>

            {jobId ? (
              <details
                open={formOpen}
                onToggle={(e) => setFormOpen((e.currentTarget as HTMLDetailsElement).open)}
                className="flex flex-col gap-4"
              >
                <summary className="cursor-pointer text-body-medium text-text-primary">
                  {formOpen ? "Hide settings" : "Show settings to start another scan"}
                </summary>
                <div className="mt-4">{formBody}</div>
              </details>
            ) : (
              formBody
            )}
          </section>
        </div>

        <aside
          aria-labelledby="sidebar-ref-heading"
          className="flex flex-col gap-5 rounded-2xl border border-border-button-default bg-background-secondary-default p-6 lg:sticky lg:top-8"
        >
          <h2 id="sidebar-ref-heading" className="text-title-h6-medium text-text-primary">
            Quick reference
          </h2>
          <ul className="list-disc space-y-3 ps-5 text-body-regular text-text-primary">
            <li>
              Publish a short page that describes the scan, purpose, and how to opt out, then enter its
              address in the project page field. The scanner includes it in every request it makes.
            </li>
            <li>
              Uses IPEDS HD + CISA current-full; one home page per site; respects robots.txt; pause
              between requests.
            </li>
            <li>Output is aggregate only: no institutional rankings in the UI.</li>
          </ul>
          <p className="text-caption-1-regular text-text-secondary">
            Switch <strong className="font-medium">New here</strong> /{" "}
            <strong className="font-medium">Familiar</strong> /{" "}
            <strong className="font-medium">Expert</strong> to change the depth of the explanation card.
          </p>
        </aside>
      </div>
    </div>
  );
}

function ActivityLog({ entries }: { entries: LogEntry[] }) {
  // Newest first, so what is happening now is always at the top without scrolling.
  const latest = useMemo(() => entries.slice(-40).reverse(), [entries]);
  return (
    <div className="flex flex-col gap-2">
      <h3 id="log-heading" className="text-body-medium text-text-primary">
        What the scanner is doing
        <span className="ms-2 text-caption-1-regular text-text-secondary">newest first</span>
      </h3>
      {/* aria-live is off on purpose: a line every few seconds would drown out a screen reader.
          The progress heading and the status message above carry the important changes.
          tabIndex lets keyboard users scroll the box. */}
      <div
        role="log"
        aria-live="off"
        aria-labelledby="log-heading"
        tabIndex={0}
        className="max-h-64 overflow-y-auto rounded-xl border border-border-button-default bg-background-primary-default p-3 font-mono text-caption-1-regular text-text-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring"
      >
        {latest.map((e, i) => (
          <div key={`${e.at}-${i}`} className="border-b border-border-button-02 py-1 last:border-0">
            <span className="text-text-secondary">
              {new Date(e.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" })}
            </span>{" "}
            <span
              className={cx(
                e.kind === "error" && "text-status-rose-text",
                e.kind === "warn" && "text-status-orange-text",
                e.kind === "success" && "text-status-lime-text",
              )}
            >
              {e.message}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function RunPlanPanel({
  frame,
  plan,
  perStratum,
  delaySec,
}: {
  frame: FrameState;
  plan: ReturnType<typeof planRun> | null;
  perStratum: number;
  delaySec: number;
}) {
  const box =
    "rounded-xl border border-border-button-default bg-background-primary-default p-4";

  if (frame.kind === "idle") {
    return (
      <div className={box}>
        <p className="text-body-medium text-text-primary">Expected time</p>
        <p className="mt-1 text-body-regular text-text-secondary">
          Choose both files and this will show how many sites the scan will visit and how long that
          should take.
        </p>
      </div>
    );
  }
  if (frame.kind === "reading") {
    return (
      <div className={box} role="status">
        <p className="text-body-medium text-text-primary">Reading your files…</p>
      </div>
    );
  }
  if (frame.kind === "error") {
    return (
      <div className={cx(box, "border-status-rose-text")} role="alert">
        <p className="text-body-medium text-status-rose-text">Check your files</p>
        <p className="mt-1 text-body-regular text-text-primary">{frame.message}</p>
      </div>
    );
  }
  if (!plan || plan.sites === 0) {
    return (
      <div className={box}>
        <p className="text-body-medium text-text-primary">Expected time</p>
        <p className="mt-1 text-body-regular text-text-secondary">Set the number of sites per group to see it.</p>
      </div>
    );
  }

  const groups = GROUP_ORDER.filter((g) => plan.frameByGroup[g] != null);
  return (
    <div className={box}>
      <p className="text-body-medium text-text-primary" role="status">
        This scan will visit {plan.sites.toLocaleString("en-US")} sites and should take{" "}
        {formatDuration(plan.seconds)}.
      </p>
      <ul className="mt-3 grid gap-x-6 gap-y-1 text-body-regular text-text-primary sm:grid-cols-2">
        {groups.map((g) => (
          <li key={g}>
            <span className="font-medium tabular-nums">{(plan.sampleByGroup[g] ?? 0).toLocaleString("en-US")}</span>{" "}
            {stratumLabel(g).toLowerCase()}
            <span className="text-text-secondary">
              {" "}
              of {(plan.frameByGroup[g] ?? 0).toLocaleString("en-US")} in your file
            </span>
          </li>
        ))}
      </ul>
      {plan.shortGroups.length > 0 && (
        <p className="mt-3 text-body-regular text-status-orange-text">
          {plan.shortGroups
            .map((g) => `${stratumLabel(g.stratum)} has only ${g.available} sites, fewer than the ${g.asked} asked for`)
            .join(". ")}
          . That group will use all of them.
        </p>
      )}
      <p className="mt-3 text-caption-1-regular text-text-secondary">
        How this is worked out: {plan.sites.toLocaleString("en-US")} sites × ({delaySec} second pause + about{" "}
        {AVG_SCAN_SECONDS} seconds to load and test a page). The {AVG_SCAN_SECONDS} seconds is the average
        from the first full run, so treat the total as a guide. Once the scan is running, the time left
        uses its real speed. These counts use the same sampling as the scan itself
        ({perStratum} per group).
      </p>
    </div>
  );
}
