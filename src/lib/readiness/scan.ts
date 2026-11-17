import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Browser, BrowserContext, Page, Response } from "playwright";
import { chromium } from "playwright";
import robotsParser from "robots-parser";
import type {
  Attempt,
  FailureKind,
  ScanResult,
  SiteRow,
} from "@/lib/readiness/types";

/** Bump when scanning behavior changes, so every record says which code made it. */
export const SCANNER_VERSION = "0.2.0";

const UA_TOKEN = "TitleIIReadinessIndex";
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const VAGUE = [
  "click here",
  "here",
  "read more",
  "more",
  "learn more",
  "link",
  "this page",
  "click",
  "more info",
  "details",
];

/** Timing and retry settings. Tests override them; production uses the defaults. */
export type ScanOptions = {
  /** First attempt to load a page. */
  navTimeoutMs: number;
  /** The single patient retry after a timeout or dropped connection. */
  retryTimeoutMs: number;
  /** Pause before that retry. */
  retryPauseMs: number;
  /** Wait after the page loads so scripts can settle. */
  settleMs: number;
};

const DEFAULT_OPTIONS: ScanOptions = {
  navTimeoutMs: 45_000,
  retryTimeoutMs: 60_000,
  retryPauseMs: 10_000,
  settleMs: 2_500,
};

let axeVersionCache: string | null = null;
export function getAxeVersion(): string {
  if (!axeVersionCache) {
    const path = join(process.cwd(), "node_modules", "axe-core", "package.json");
    axeVersionCache = (JSON.parse(readFileSync(path, "utf8")) as { version: string }).version;
  }
  return axeVersionCache;
}

let axeSourceCache: string | null = null;
function getAxeSource(): string {
  if (!axeSourceCache) {
    const path = join(process.cwd(), "node_modules", "axe-core", "axe.min.js");
    axeSourceCache = readFileSync(path, "utf8");
  }
  return axeSourceCache;
}

function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const m = w
    .replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "")
    .replace(/^y/, "")
    .match(/[aeiouy]{1,2}/g);
  return Math.max(1, m ? m.length : 1);
}

function fkGrade(text: string): number | null {
  const sentences = Math.max(1, (text.match(/[.!?]+(\s|$)/g) || []).length);
  const words = text.split(/\s+/).filter((w) => /[a-z]/i.test(w));
  if (words.length < 100) return null;
  const syl = words.reduce((s, w) => s + syllables(w), 0);
  return +(
    0.39 * (words.length / sentences) +
    11.8 * (syl / words.length) -
    15.59
  ).toFixed(1);
}

async function contentChecks(
  page: import("playwright").Page,
  vague: string[],
): Promise<{
  h1_count: number;
  heading_count: number;
  heading_skips: number;
  link_count: number;
  vague_links: number;
  has_lang: boolean;
  text: string;
}> {
  return page.evaluate((vagueList) => {
    const hs = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].map(
      (h) => +h.tagName[1],
    );
    let skips = 0;
    for (let i = 1; i < hs.length; i++) if (hs[i]! > hs[i - 1]! + 1) skips++;
    const links = [...document.querySelectorAll("a[href]")];
    const lower = new Set(vagueList.map((v) => v.toLowerCase()));
    const vagueLinks = links.filter((a) => {
      const el = a as HTMLElement;
      const t = (el.innerText || el.getAttribute("aria-label") || "").trim().toLowerCase();
      return lower.has(t);
    }).length;
    const main = document.querySelector("main") || document.body;
    return {
      h1_count: hs.filter((h) => h === 1).length,
      heading_count: hs.length,
      heading_skips: skips,
      link_count: links.length,
      vague_links: vagueLinks,
      has_lang: !!document.documentElement.getAttribute("lang"),
      text: (main?.innerText || "").slice(0, 20000),
    };
  }, vague);
}

async function allowedByRobots(
  context: BrowserContext,
  url: string,
): Promise<boolean> {
  const origin = new URL(url).origin;
  try {
    const res = await context.request.get(origin + "/robots.txt", {
      timeout: 15000,
    });
    if (!res.ok()) return true;
    const body = await res.text();
    return robotsParser(origin + "/robots.txt", body).isAllowed(url, UA_TOKEN) !== false;
  } catch {
    return true;
  }
}

/** Turn a browser error message into a short, countable cause. */
export function classifyFailure(message: string): FailureKind {
  if (/ERR_NAME_NOT_RESOLVED|ERR_NAME_RESOLUTION_FAILED|ENOTFOUND/i.test(message)) return "dns";
  if (/ERR_CERT_|ERR_SSL_|SSL_ERROR|certificate/i.test(message)) return "tls";
  if (/Timeout \d+ms exceeded|ERR_TIMED_OUT/i.test(message)) return "timeout";
  if (
    /ERR_CONNECTION_|ERR_EMPTY_RESPONSE|ERR_ADDRESS_UNREACHABLE|ERR_NETWORK|ERR_INTERNET_DISCONNECTED|ERR_TUNNEL_|ERR_PROXY_|ECONN/i.test(
      message,
    )
  )
    return "connection";
  if (/axe-core could not be injected|Content Security Policy|violates/i.test(message))
    return "script_blocked";
  return "other";
}

/** Which cause to report when different tries failed for different reasons. */
const FAILURE_PRIORITY: FailureKind[] = [
  "tls",
  "timeout",
  "connection",
  "script_blocked",
  "other",
  "dns",
];
function mostInformative(kinds: FailureKind[]): FailureKind {
  for (const k of FAILURE_PRIORITY) if (kinds.includes(k)) return k;
  return "other";
}

/** The listed address, then the same address with "www." added or removed. */
export function hostVariants(raw: string): string[] {
  const u = new URL(raw);
  const out = [u.href];
  const host = u.hostname;
  const isName = /[a-z]/i.test(host) && host.includes(".") && host !== "localhost";
  if (isName) {
    const alt = new URL(u.href);
    alt.hostname = host.startsWith("www.") ? host.slice(4) : `www.${host}`;
    out.push(alt.href);
  }
  return out;
}

function toHttp(raw: string): string {
  const u = new URL(raw);
  u.protocol = "http:";
  return u.href;
}

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

type GotoResult =
  | { ok: true; resp: Response | null }
  | { ok: false; failure: FailureKind; message: string };

async function tryGoto(page: Page, url: string, timeout: number): Promise<GotoResult> {
  try {
    const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout });
    return { ok: true, resp };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, failure: classifyFailure(message), message };
  }
}

type LoadOutcome =
  | { kind: "loaded"; page: Page; resp: Response | null }
  | { kind: "robots" }
  | { kind: "unreachable"; failure: FailureKind; message: string };

/**
 * Find a working home page for a site.
 * Order: the listed address, then the www/non-www twin. If a secure connection was refused or
 * dropped, plain http is tried last. Certificate and TLS problems are never bypassed or
 * downgraded: a visitor would see a browser warning, and that is reported as its own cause.
 * One patient retry is made after a timeout or dropped connection on the first address.
 */
async function loadHome(
  context: BrowserContext,
  startUrl: string,
  o: ScanOptions,
  attempts: Attempt[],
): Promise<LoadOutcome> {
  let queue = hostVariants(startUrl);
  const tried = new Set<string>();
  const failures: FailureKind[] = [];
  let lastMessage = "";
  let httpAdded = false;

  for (let i = 0; i < queue.length; i++) {
    const url = queue[i]!;
    if (tried.has(url)) continue;
    tried.add(url);

    if (!(await allowedByRobots(context, url))) {
      attempts.push({ url, outcome: "robots_disallowed" });
      return { kind: "robots" };
    }

    // A fresh page for every try: after a failed navigation Chromium leaves the old page on an
    // error screen, and reusing it makes the next navigation fail with a confusing error.
    let page = await context.newPage();
    let r = await tryGoto(page, url, o.navTimeoutMs);
    if (!r.ok && i === 0 && (r.failure === "timeout" || r.failure === "connection")) {
      attempts.push({ url, outcome: r.failure });
      await page.close().catch(() => undefined);
      await sleep(o.retryPauseMs);
      page = await context.newPage();
      r = await tryGoto(page, url, o.retryTimeoutMs);
    }
    if (r.ok) {
      attempts.push({ url, outcome: "loaded", http_status: r.resp?.status() ?? null });
      return { kind: "loaded", page, resp: r.resp };
    }
    await page.close().catch(() => undefined);
    attempts.push({ url, outcome: r.failure });
    failures.push(r.failure);
    lastMessage = r.message;

    if (i === queue.length - 1 && !httpAdded && failures.includes("connection")) {
      httpAdded = true;
      queue = queue.concat(queue.filter((u) => u.startsWith("https:")).map(toHttp));
    }
  }
  return { kind: "unreachable", failure: mostInformative(failures), message: lastMessage };
}

/**
 * Put axe-core on the page. Some sites send a content security policy that blocks injected
 * inline scripts; evaluating the source through the browser's debugging channel is not
 * subject to that policy, so it is the fallback.
 */
async function injectAxe(page: Page): Promise<void> {
  const source = getAxeSource();
  try {
    await page.addScriptTag({ content: source });
  } catch {
    await page.evaluate(source);
  }
  const ready = await page.evaluate(
    () => typeof (window as unknown as { axe?: unknown }).axe !== "undefined",
  );
  if (!ready) throw new Error("axe-core could not be injected into the page");
}

export async function scanOne(
  browser: Browser,
  site: SiteRow,
  contactUrl: string,
  options: Partial<ScanOptions> = {},
): Promise<ScanResult> {
  const o: ScanOptions = { ...DEFAULT_OPTIONS, ...options };
  const userAgent = `Mozilla/5.0 (compatible; ${UA_TOKEN}/${SCANNER_VERSION}; +${contactUrl})`;
  const context = await browser.newContext({
    userAgent,
    viewport: { width: 1280, height: 900 },
  });
  const started = new Date().toISOString();
  const base = {
    ...site,
    scanned_at: started,
    scanner_version: SCANNER_VERSION,
    axe_version: getAxeVersion(),
  };
  const attempts: Attempt[] = [];
  try {
    const nav = await loadHome(context, site.url, o, attempts);
    if (nav.kind === "robots") {
      return { ...base, status: "robots_disallowed", attempts };
    }
    if (nav.kind === "unreachable") {
      return {
        ...base,
        status: "unreachable",
        failure_kind: nav.failure,
        error: nav.message.slice(0, 300),
        attempts,
      };
    }

    const page = nav.page;
    const httpStatus = nav.resp ? nav.resp.status() : null;
    if (httpStatus !== null && httpStatus >= 400) {
      // A 403 or 404 page is usually a block or error page, so testing it would measure the
      // wrong thing. Record it and leave it out of the failure rates.
      attempts[attempts.length - 1] = {
        ...attempts[attempts.length - 1]!,
        outcome: "http_error",
      };
      return {
        ...base,
        status: "http_error",
        http_status: httpStatus,
        final_url: page.url(),
        attempts,
      };
    }

    await page.waitForTimeout(o.settleMs);
    await injectAxe(page);
    const axe = await page.evaluate(async (tags: string[]) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const axeRun = (window as any).axe.run as (
        ctx: Document,
        opts: {
          runOnly: { type: string; values: string[] };
          resultTypes: string[];
        },
      ) => Promise<{
        violations: Array<{ id: string; impact: string; tags: string[]; nodes: unknown[] }>;
        incomplete: Array<{ id: string; impact: string; tags: string[]; nodes: unknown[] }>;
        testEngine: { version: string };
      }>;
      const r = await axeRun(document, {
        runOnly: { type: "tag", values: tags },
        resultTypes: ["violations", "incomplete"],
      });
      const slim = (
        list: Array<{ id: string; impact: string; tags: string[]; nodes: unknown[] }>,
      ) =>
        list.map((v) => ({
          id: v.id,
          impact: v.impact,
          tags: v.tags.filter((t: string) => /^wcag\d/.test(t)),
          nodes: v.nodes.length,
        }));
      return {
        violations: slim(r.violations),
        incomplete: slim(r.incomplete),
        axe_version: r.testEngine.version,
      };
    }, WCAG_TAGS);
    const c = await contentChecks(page, VAGUE);
    const grade = fkGrade(c.text);
    const { text, ...restC } = c;
    void text;
    return {
      ...base,
      status: "ok",
      http_status: httpStatus,
      final_url: page.url(),
      attempts,
      ...axe,
      ...restC,
      reading_grade: grade,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ...base,
      status: "error",
      failure_kind: classifyFailure(msg),
      error: msg.slice(0, 300),
      attempts,
    };
  } finally {
    await context.close();
  }
}

export const MISSING_BROWSER_MESSAGE =
  "The scanner's browser isn't installed. In Terminal, in the project folder, run: " +
  "npx playwright install chromium. Then restart the server. " +
  "If you start the server from Cursor, run both commands in Cursor's own terminal, " +
  "because Cursor keeps its browsers in a separate folder. " +
  "(Google Chrome would also work, but none was found on this computer.)";

/** True when Playwright could not find its browser, as opposed to a crash or a bad option. */
export function isMissingBrowserError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /Executable doesn't exist|playwright install/i.test(msg);
}

/**
 * Starts the browser. Uses Playwright's own Chromium; if that has not been downloaded,
 * falls back to Google Chrome when it is installed. The label says which one was used.
 */
export async function launchBrowserWithLabel(): Promise<{ browser: Browser; label: string }> {
  try {
    const browser = await chromium.launch();
    return { browser, label: `Chromium ${browser.version()}` };
  } catch (first) {
    if (!isMissingBrowserError(first)) throw first;
    try {
      const browser = await chromium.launch({ channel: "chrome" });
      return { browser, label: `Google Chrome ${browser.version()} (installed on this computer)` };
    } catch {
      throw new Error(MISSING_BROWSER_MESSAGE);
    }
  }
}

export async function launchBrowser(): Promise<Browser> {
  return (await launchBrowserWithLabel()).browser;
}
