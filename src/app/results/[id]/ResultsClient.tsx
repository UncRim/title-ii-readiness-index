"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { RiArrowLeftLine, RiDownloadLine, RiExternalLinkLine } from "@remixicon/react";

import { ButtonLink } from "@/components/base/buttons/button";
import { ProgressBar } from "@/components/base/progress/progress";
import {
  buildNarrative,
  CAUSE_LABEL,
  stepsForSharing,
  stepsForSiteOwners,
  stratumLabel,
  type GroupSummary,
  type ProblemSummary,
  type Step,
} from "@/lib/readiness/narrative";
import type { ReadinessJob } from "@/lib/readiness/types";
import { cx } from "@/utils/cx";
import { useJobTiming } from "@/app/use-job-timing";

type JobSnapshot = Omit<ReadinessJob, "results">;
type LoadState =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "ready"; job: JobSnapshot };

export function ResultsClient({ id }: { id: string }) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function load() {
      try {
        const res = await fetch(`/api/readiness/jobs/${encodeURIComponent(id)}`);
        if (stop) return;
        if (res.status === 404) {
          setState({ kind: "missing" });
          return;
        }
        if (!res.ok) throw new Error(String(res.status));
        const job = (await res.json()) as JobSnapshot;
        setState({ kind: "ready", job });
        if (job.phase !== "done" && job.phase !== "error") {
          timer = setTimeout(() => void load(), 3000);
        }
      } catch {
        if (!stop) timer = setTimeout(() => void load(), 5000);
      }
    }

    void load();
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
  }, [id]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 py-10 sm:px-6 lg:px-10">
      <nav aria-label="Page">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-body-medium text-text-brand-default underline-offset-2 hover:underline"
        >
          <RiArrowLeftLine className="size-4" aria-hidden />
          Run another scan
        </Link>
      </nav>

      {state.kind === "loading" && (
        <p className="text-body-regular text-text-secondary" role="status">
          Loading results…
        </p>
      )}

      {state.kind === "missing" && <Missing />}

      {state.kind === "ready" && <JobView id={id} job={state.job} />}
    </div>
  );
}

function Missing() {
  return (
    <section aria-labelledby="missing-heading" className="flex flex-col gap-3">
      <h1 id="missing-heading" className="text-title-display-3-medium text-text-primary">
        We can't find this run
      </h1>
      <p className="max-w-2xl text-body-regular text-text-secondary">
        Runs are kept in memory, so they disappear when the server restarts. If you downloaded the
        public data file earlier, you still have the numbers. Otherwise, start a new scan.
      </p>
    </section>
  );
}

function JobView({ id, job }: { id: string; job: JobSnapshot }) {
  if (job.phase === "error") {
    return (
      <section aria-labelledby="error-heading" className="flex flex-col gap-3">
        <h1 id="error-heading" className="text-title-display-3-medium text-text-primary">
          This scan stopped with an error
        </h1>
        <p className="text-body-medium text-status-rose-text" role="alert">
          {job.error ?? "Unknown error."}
        </p>
        <p className="text-body-regular text-text-secondary">
          Go back, check the two files and the READINESS_CONTACT_URL setting, and start again.
        </p>
      </section>
    );
  }

  if (job.phase !== "done" || !job.aggregate) {
    return <RunningView job={job} />;
  }

  return <FinishedResults id={id} job={job} />;
}

function RunningView({ job }: { job: JobSnapshot }) {
  const timing = useJobTiming(job);
  const pctDone = job.progress.total
    ? Math.min(100, Math.round((100 * job.progress.current) / job.progress.total))
    : 0;
  return (
    <section aria-labelledby="running-heading" aria-busy="true" className="flex flex-col gap-4">
      <h1 id="running-heading" className="text-title-display-3-medium text-text-primary">
        This scan is still running
      </h1>
      <p className="max-w-2xl text-body-regular text-text-secondary">
        {job.phase === "scanning" && job.progress.total
          ? `${job.progress.current} of ${job.progress.total} sites checked (${pctDone}%).`
          : "Getting ready."}{" "}
        {timing?.left && timing.finishAt
          ? `Time left: ${timing.left}${timing.isEstimate ? " (early estimate)" : ""}. Expected to finish around ${timing.finishAt}. `
          : ""}
        This page updates by itself and shows the results when the scan finishes.
      </p>
      <p className="sr-only" role="status">
        {job.phase === "scanning"
          ? `Scanning, ${Math.floor(pctDone / 10) * 10} percent complete.`
          : "Getting ready."}
      </p>
      <ProgressBar
        label="Scan progress"
        size="lg"
        value={pctDone}
        isIndeterminate={job.phase !== "scanning"}
      />
    </section>
  );
}

export function FinishedResults({ id, job }: { id: string; job: JobSnapshot }) {
  const aggregate = job.aggregate!;
  const n = useMemo(() => buildNarrative(aggregate), [aggregate]);
  const owners = useMemo(() => stepsForSiteOwners(n), [n]);
  const sharing = useMemo(() => stepsForSharing(), []);
  const ruleGroups = Object.keys(aggregate.topRules[0]?.by_stratum ?? {}).sort();
  const date = new Date(job.createdAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <>
      <header className="flex flex-col gap-3">
        <h1 className="text-title-display-3-medium text-text-primary">Scan results</h1>
        <p className="text-caption-1-regular text-text-secondary">
          Run on {date}. {job.params.perStratum} sites per group, seed {job.params.seed},{" "}
          {job.params.delayMs / 1000} seconds between sites. Home pages only.
        </p>
        <p className="text-body-regular text-text-secondary">
          Tested with axe-core{aggregate.engine?.axe_version ? ` ${aggregate.engine.axe_version}` : ""}{" "}
          against its {aggregate.engine?.standard ?? "WCAG 2.1 Level A and AA"} rules, the standard named
          in the Title II web rule. Automated checks find only part of the barriers people meet, so a page
          with no failures here is not necessarily accessible.
          {aggregate.engine?.mixed_versions
            ? " This run mixes records from more than one scanner or axe-core version."
            : ""}
        </p>
      </header>

      <section
        aria-labelledby="short-heading"
        className="flex flex-col gap-4 rounded-2xl border border-border-button-default bg-background-secondary-default p-5 md:p-6"
      >
        <h2 id="short-heading" className="text-title-h6-medium text-text-secondary">
          The short version
        </h2>
        <p className="text-title-h5-medium text-text-primary">{n.headline}</p>
        {n.bullets.length > 0 && (
          <ul className="list-disc space-y-2 ps-5 text-body-regular text-text-primary">
            {n.bullets.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-2 pt-1">
          <ButtonLink
            variant="secondary"
            size="small"
            leadingIcon={RiDownloadLine}
            href={`/api/readiness/jobs/${id}/export?public=1`}
          >
            Download public data (names removed)
          </ButtonLink>
          <ButtonLink
            variant="secondary"
            size="small"
            leadingIcon={RiDownloadLine}
            href={`/api/readiness/jobs/${id}/export`}
          >
            Download full JSON (private)
          </ButtonLink>
        </div>
      </section>

      {n.hasData && (
        <section aria-labelledby="groups-heading" className="flex flex-col gap-4">
          <div>
            <h2 id="groups-heading" className="text-title-h5-medium text-text-primary">
              How each group did
            </h2>
            <p className="mt-1 text-body-regular text-text-secondary">
              Each figure is the share of tested home pages with at least one failure that an
              automated check can find. A lower number is better.
            </p>
          </div>
          <ul className="grid gap-4 sm:grid-cols-2">
            {n.groups.map((g) => (
              <li key={g.stratum}>
                <GroupCard g={g} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {n.problems.length > 0 && (
        <section aria-labelledby="problems-heading" className="flex flex-col gap-4">
          <div>
            <h2 id="problems-heading" className="text-title-h5-medium text-text-primary">
              What we found most often
            </h2>
            <p className="mt-1 text-body-regular text-text-secondary">
              In order of how many tested pages had the problem. For each one: why it matters, the
              usual fix, and who usually makes it.
            </p>
          </div>
          <ol className="flex flex-col gap-4">
            {n.problems.map((p, i) => (
              <li key={p.rule}>
                <ProblemCard p={p} rank={i + 1} />
              </li>
            ))}
          </ol>
        </section>
      )}

      <section aria-labelledby="untested-heading" className="flex flex-col gap-4">
        <div>
          <h2 id="untested-heading" className="text-title-h5-medium text-text-primary">
            Sites we couldn't test
          </h2>
          <p className="mt-1 text-body-regular text-text-secondary">{n.reach.sentence}</p>
        </div>
        {n.reach.causes.length > 0 && (
          <ul className="flex flex-col gap-2">
            {n.reach.causes.map((c) => (
              <li key={c.key} className="text-body-regular text-text-primary">
                <span className="font-medium tabular-nums">{c.count}</span> {c.label}.{" "}
                <span className="text-text-secondary">{c.explained}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-body-regular text-text-secondary">
          A site that couldn't be tested is not counted as passing or failing. Each group card above
          shows how far the rate could move if all of them had passed, or all had failed.
        </p>
      </section>

      <section aria-labelledby="next-heading" className="flex flex-col gap-6">
        <div>
          <h2 id="next-heading" className="text-title-h5-medium text-text-primary">
            What you can do next
          </h2>
          <p className="mt-1 text-body-regular text-text-secondary">
            These are the usual next moves, not a compliance checklist. Passing an automated check
            doesn't mean a site is accessible, and failing one doesn't mean it is illegal.
          </p>
        </div>
        <div className="grid gap-6 md:grid-cols-2 md:items-start">
          <StepList heading="If you run a public website" steps={owners} />
          <StepList heading="If you are sharing these results" steps={sharing} />
        </div>
      </section>

      <section
        aria-labelledby="limits-heading"
        className="flex flex-col gap-2 rounded-2xl border border-border-button-default p-5"
      >
        <h2 id="limits-heading" className="text-title-h6-medium text-text-primary">
          What these results can and can't tell you
        </h2>
        <p className="text-body-regular text-text-secondary">
          They show how a random sample of public college and local government home pages did on
          one automated test of WCAG 2.1 Level A and AA. They don't cover other pages, PDFs, videos
          or apps, and automated tools find only part of the barriers people meet. The sample
          describes groups, not individual sites, and no site is named here.
        </p>
      </section>

      <section aria-labelledby="numbers-heading" className="flex flex-col gap-3">
        <h2 id="numbers-heading" className="text-title-h5-medium text-text-primary">
          The full numbers
        </h2>
        <Details summary="Which sites could be tested, by group">
          <ReachTable aggregate={aggregate} />
        </Details>
        <Details summary="Every measure, by group">
          <div className="overflow-x-auto rounded-xl border border-border-button-default">
            <table className="w-full min-w-[640px] text-left text-body-regular text-text-primary">
              <thead className="bg-background-secondary-default text-caption-1-semibold uppercase tracking-wide text-text-secondary">
                <tr>
                  <th scope="col" className="px-3 py-2">Group</th>
                  <th scope="col" className="px-3 py-2">Measure</th>
                  <th scope="col" className="px-3 py-2">Value</th>
                </tr>
              </thead>
              <tbody>
                {aggregate.strata.map((row, i) => (
                  <tr key={`${row.stratum}-${row.measure}-${i}`} className="border-t border-border-button-02">
                    <th scope="row" className="px-3 py-2 text-start text-caption-1-medium text-text-secondary">
                      {stratumLabel(row.stratum)}
                    </th>
                    <td className="px-3 py-2">{row.measure}</td>
                    <td className="px-3 py-2 tabular-nums">
                      {row.value != null
                        ? row.measure.startsWith("%")
                          ? `${row.value}%`
                          : row.value
                        : "—"}
                      {row.ci95_low != null && row.ci95_high != null && (
                        <span className="ms-1 text-caption-1-regular text-text-tertiary">
                          (95% range {row.ci95_low}–{row.ci95_high}%)
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Details>
        <Details summary="Most common failing rules, with technical names">
          <div className="overflow-x-auto rounded-xl border border-border-button-default">
            <table className="w-full min-w-[560px] text-left text-body-regular">
              <thead className="bg-background-secondary-default text-caption-1-semibold uppercase tracking-wide text-text-secondary">
                <tr>
                  <th scope="col" className="px-3 py-2">Rule</th>
                  <th scope="col" className="px-3 py-2">WCAG</th>
                  {ruleGroups.map((g) => (
                    <th key={g} scope="col" className="px-3 py-2">{stratumLabel(g)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {aggregate.topRules.map((r) => (
                  <tr key={r.rule} className="border-t border-border-button-02">
                    <th scope="row" className="px-3 py-2 text-start font-mono text-caption-1-medium">{r.rule}</th>
                    <td className="px-3 py-2 text-caption-1-regular text-text-secondary">{r.wcag_sc || "—"}</td>
                    {ruleGroups.map((g) => (
                      <td key={g} className="px-3 py-2 tabular-nums">
                        {r.by_stratum[g] != null ? `${r.by_stratum[g]}%` : "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Details>
      </section>
    </>
  );
}

function GroupCard({ g }: { g: GroupSummary }) {
  const value = g.failingPct;
  return (
    <div className="flex h-full flex-col gap-3 rounded-2xl border border-border-button-default bg-background-primary-default p-5">
      <h3 className="text-title-h6-medium text-text-primary">{g.label}</h3>
      {value != null ? (
        <>
          <p className="text-title-display-3-medium tabular-nums text-text-primary">
            {Math.round(value)}%
            <span className="ms-2 text-body-regular text-text-secondary">had a failure</span>
          </p>
          <div aria-hidden className="h-2 w-full overflow-hidden rounded-full bg-background-secondary-default">
            <div className="h-full rounded-full bg-button-primary" style={{ width: `${Math.min(100, value)}%` }} />
          </div>
        </>
      ) : null}
      <p className="text-body-regular text-text-secondary">{g.sentence}</p>
      {g.medianProblems != null && (
        <p className="text-body-regular text-text-secondary">
          A typical tested page had {g.medianProblems} failing {g.medianProblems === 1 ? "rule" : "rules"}.
        </p>
      )}
      {g.boundLow != null && g.boundHigh != null && g.tested < g.sampled && (
        <p className="text-caption-1-regular text-text-tertiary">
          If every untested site had passed, the rate would be {Math.round(g.boundLow)}%. If every
          one had failed, {Math.round(g.boundHigh)}%.
        </p>
      )}
      {g.caution && <p className="text-caption-1-medium text-status-orange-text">{g.caution}</p>}
    </div>
  );
}

function ProblemCard({ p, rank }: { p: ProblemSummary; rank: number }) {
  return (
    <article className="flex flex-col gap-3 rounded-2xl border border-border-button-default bg-background-primary-default p-5">
      <header className="flex flex-col gap-2">
        <h3 className="text-title-h6-medium text-text-primary">
          <span className="me-2 tabular-nums text-text-tertiary">{rank}.</span>
          {p.title}
        </h3>
        <div className="flex flex-wrap gap-2">
          <Chip>Found on {p.rangeText}</Chip>
          <Chip>{p.impactLabel}</Chip>
          <Chip>{p.effortLabel}</Chip>
        </div>
      </header>
      <dl className="grid gap-3 text-body-regular sm:grid-cols-[8rem_1fr]">
        <dt className="text-text-tertiary">Why it matters</dt>
        <dd className="text-text-primary">{p.why}</dd>
        <dt className="text-text-tertiary">The usual fix</dt>
        <dd className="text-text-primary">{p.fix}</dd>
        <dt className="text-text-tertiary">Who usually fixes it</dt>
        <dd className="text-text-primary">{p.owner}</dd>
      </dl>
      <Details summary="Technical details" small>
        <ul className="flex flex-col gap-1 text-caption-1-regular text-text-secondary">
          <li>
            Rule: <span className="font-mono">{p.rule}</span>
            {p.wcag ? `, WCAG ${p.wcag}` : null}
          </li>
          {p.byGroup.map((b) => (
            <li key={b.label}>
              {b.label}: {b.share != null ? `${b.share}% of tested pages` : "no data"}
            </li>
          ))}
          {!p.known && (
            <li>No plain-language note is written for this rule yet. Search its name for the tool's own guidance.</li>
          )}
        </ul>
      </Details>
    </article>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-border-button-default px-2.5 py-0.5 text-caption-1-medium text-text-secondary">
      {children}
    </span>
  );
}

function StepList({ heading, steps }: { heading: string; steps: Step[] }) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-title-h6-medium text-text-primary">{heading}</h3>
      <ol className="flex flex-col gap-4">
        {steps.map((s, i) => (
          <li key={s.title} className="flex gap-3">
            <span
              aria-hidden
              className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-background-secondary-default text-caption-1-semibold text-text-primary"
            >
              {i + 1}
            </span>
            <div className="flex flex-col gap-1">
              <p className="text-body-medium text-text-primary">{s.title}</p>
              <p className="text-body-regular text-text-secondary">{s.body}</p>
              {s.link && (
                <a
                  href={s.link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center text-body-medium text-text-brand-default underline-offset-2 hover:underline"
                >
                  {s.link.label}
                  <RiExternalLinkLine className="ms-1 size-4 text-foreground-icon-secondary" aria-hidden />
                </a>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Details({
  summary,
  children,
  small,
}: {
  summary: string;
  children: ReactNode;
  small?: boolean;
}) {
  return (
    <details className="rounded-xl border border-border-button-default bg-background-primary-default px-4 py-3">
      <summary
        className={cx(
          "cursor-pointer text-text-primary",
          small ? "text-caption-1-medium" : "text-body-medium",
        )}
      >
        {summary}
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

function ReachTable({ aggregate }: { aggregate: NonNullable<JobSnapshot["aggregate"]> }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border-button-default">
      <table className="w-full min-w-[640px] text-left text-body-regular text-text-primary">
        <thead className="bg-background-secondary-default text-caption-1-semibold uppercase tracking-wide text-text-secondary">
          <tr>
            <th scope="col" className="px-3 py-2">Group</th>
            <th scope="col" className="px-3 py-2">Sampled</th>
            <th scope="col" className="px-3 py-2">Tested</th>
            <th scope="col" className="px-3 py-2">Unreachable (cause)</th>
            <th scope="col" className="px-3 py-2">Error or block page</th>
            <th scope="col" className="px-3 py-2">Skipped (robots.txt)</th>
          </tr>
        </thead>
        <tbody>
          {aggregate.reach.map((r) => (
            <tr key={r.stratum} className="border-t border-border-button-02">
              <th scope="row" className="px-3 py-2 text-start text-caption-1-medium text-text-secondary">
                {stratumLabel(r.stratum)}
              </th>
              <td className="px-3 py-2 tabular-nums">{r.sampled}</td>
              <td className="px-3 py-2 tabular-nums">{r.scanned}</td>
              <td className="px-3 py-2 tabular-nums">
                {r.unreachable}
                {r.unreachable > 0 && (
                  <span className="ms-1 text-caption-1-regular text-text-tertiary">
                    (
                    {Object.entries(r.unreachable_by_cause)
                      .map(([k, v]) => `${v} ${CAUSE_LABEL[k] ?? k}`)
                      .join(", ")}
                    )
                  </span>
                )}
              </td>
              <td className="px-3 py-2 tabular-nums">{r.http_error + r.error}</td>
              <td className="px-3 py-2 tabular-nums">{r.robots_disallowed}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
