/** One row from frame/sample CSV and scan input. */
export type SiteRow = {
  site_id: string;
  stratum: string;
  name: string;
  state: string;
  url: string;
  source: string;
};

/** Axe violation slim shape (matches scan.js). */
export type ViolationSlim = {
  id: string;
  impact: string;
  tags: string[];
  nodes: number;
};

/**
 * What happened to a site.
 * - ok: the home page loaded and was tested.
 * - robots_disallowed: robots.txt asks crawlers not to visit; skipped on purpose.
 * - unreachable: no working home page after the fallbacks (see failure_kind).
 * - http_error: the server answered 4xx/5xx (often a block or error page); not tested.
 * - error: something unexpected went wrong while testing.
 */
export type ScanStatus =
  | "ok"
  | "robots_disallowed"
  | "unreachable"
  | "http_error"
  | "error";

/** Why a site could not be loaded or tested. "tls" covers certificate and secure-connection problems. */
export type FailureKind =
  | "dns"
  | "tls"
  | "timeout"
  | "connection"
  | "script_blocked"
  | "other";

/** One try at loading a site, kept so the final status can be traced. */
export type Attempt = {
  url: string;
  outcome: "loaded" | "robots_disallowed" | FailureKind | "http_error";
  http_status?: number | null;
};

/** Single site scan result. */
export type ScanResult = SiteRow & {
  status: ScanStatus;
  scanned_at: string;
  /** Version of this scanner's code that produced the record. */
  scanner_version?: string;
  http_status?: number | null;
  final_url?: string;
  error?: string;
  failure_kind?: FailureKind;
  attempts?: Attempt[];
  violations?: ViolationSlim[];
  incomplete?: ViolationSlim[];
  axe_version?: string;
  h1_count?: number;
  heading_count?: number;
  heading_skips?: number;
  link_count?: number;
  vague_links?: number;
  has_lang?: boolean;
  reading_grade?: number | null;
};

export type JobPhase =
  | "queued"
  | "sampling"
  | "scanning"
  | "aggregating"
  | "done"
  | "error";

export type LogEntry = {
  at: string;
  message: string;
  kind: "info" | "success" | "warn" | "error";
};

/** What the scan tested against, so every summary can say so. */
export const WCAG_STANDARD_LABEL = "WCAG 2.1 Level A and AA";

export type EngineInfo = {
  /** Most common scanner version across the records (normally the only one). */
  scanner_version: string | null;
  axe_version: string | null;
  /** True when records came from more than one scanner or axe-core version. */
  mixed_versions: boolean;
  standard: string;
};

export type AggregateOutput = {
  summaryLine: string;
  engine?: EngineInfo;
  /** How many sampled sites could be tested, and why the rest could not. */
  reach: ReachRow[];
  strata: StratumRow[];
  topRules: RuleRow[];
};

export type ReachRow = {
  stratum: string;
  sampled: number;
  scanned: number;
  robots_disallowed: number;
  http_error: number;
  unreachable: number;
  /** Counts of unreachable sites by cause. */
  unreachable_by_cause: Record<string, number>;
  error: number;
};

export type StratumRow = {
  stratum: string;
  measure: string;
  pages: number | null;
  count?: number | null;
  value?: number | null;
  ci95_low?: number | null;
  ci95_high?: number | null;
};

export type RuleRow = {
  rule: string;
  wcag_sc: string;
  impact: string;
  pages: number;
  /** Share of all scanned pages. Used only to rank rules; compare groups with by_stratum. */
  percent_of_pages: number | null;
  /** Share of each group's scanned pages that fail this rule. */
  by_stratum: Record<string, number | null>;
};

export type ReadinessJob = {
  id: string;
  phase: JobPhase;
  createdAt: number;
  /** Progress for current phase (scanning: index/total). */
  progress: { current: number; total: number; label: string };
  log: LogEntry[];
  error?: string;
  sample?: SiteRow[];
  /** Only populated when done (for export); can be large. */
  results?: ScanResult[];
  aggregate?: AggregateOutput;
  params: JobParams;
};

export type JobParams = {
  perStratum: number;
  seed: number;
  delayMs: number;
  contactUrl: string;
};
