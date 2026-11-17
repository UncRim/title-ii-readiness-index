/**
 * Checks the scanner against small local servers that behave like the sites that failed in cycle 1:
 * a bad certificate, a name that does not exist, a 403 page, a content security policy,
 * a slow site, and a robots.txt that says no. Run with: npm test
 * (Set RESULTS_JSON to a results file to also check how real error messages are classified.)
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import https from "node:https";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { chromium, type Browser } from "playwright";
import { classifyFailure, hostVariants, scanOne, SCANNER_VERSION } from "@/lib/readiness/scan";
import { aggregateResults } from "@/lib/readiness/aggregate";
import type { ScanResult, SiteRow } from "@/lib/readiness/types";

const FAST = { navTimeoutMs: 1500, retryTimeoutMs: 1500, retryPauseMs: 200, settleMs: 200 };
const PAGE =
  '<!doctype html><html lang="en"><head><title>Test</title></head><body><main><h1>Hello</h1><img src="x.png"></main></body></html>';

// A throwaway self-signed certificate, made fresh for each run, to stand in for a site with a bad certificate.
function makeCert(): { key: Buffer; cert: Buffer } {
  const dir = mkdtempSync(join(tmpdir(), "readiness-cert-"));
  execFileSync(
    "openssl",
    ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(dir, "key.pem"), "-out", join(dir, "cert.pem"), "-days", "2", "-subj", "/CN=localhost"],
    { stdio: "ignore" },
  );
  return { key: readFileSync(join(dir, "key.pem")), cert: readFileSync(join(dir, "cert.pem")) };
}

const servers: Array<http.Server | https.Server> = [];
let browser: Browser;
const ports: Record<string, number> = {};

function listen(name: string, srv: http.Server | https.Server, port = 0): Promise<void> {
  servers.push(srv);
  return new Promise((resolve, reject) => {
    srv.once("error", reject);
    srv.listen(port, "127.0.0.1", () => {
      ports[name] = (srv.address() as AddressInfo).port;
      resolve();
    });
  });
}

const site = (id: string, url: string): SiteRow => ({
  site_id: id,
  stratum: "county",
  name: id,
  state: "TX",
  url,
  source: "test",
});

before(async () => {
  await listen("ok", http.createServer((req, res) => {
    if (req.url === "/robots.txt") { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": "text/html" }); res.end(PAGE);
  }));
  await listen("forbidden", http.createServer((req, res) => {
    if (req.url === "/robots.txt") { res.writeHead(404); return res.end(); }
    res.writeHead(403, { "content-type": "text/html" }); res.end("<html><body>Access denied</body></html>");
  }));
  await listen("csp", http.createServer((req, res) => {
    if (req.url === "/robots.txt") { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": "text/html", "content-security-policy": "script-src 'self'" });
    res.end(PAGE);
  }));
  await listen("robots", http.createServer((req, res) => {
    if (req.url === "/robots.txt") { res.writeHead(200, { "content-type": "text/plain" }); return res.end("User-agent: *\nDisallow: /\n"); }
    res.writeHead(200, { "content-type": "text/html" }); res.end(PAGE);
  }));
  let flaky = 0;
  await listen("flaky", http.createServer((req, res) => {
    if (req.url === "/robots.txt") { res.writeHead(404); return res.end(); }
    if (flaky++ === 0) return; // first page request hangs until the client gives up
    res.writeHead(200, { "content-type": "text/html" }); res.end(PAGE);
  }));
  await listen("hang", http.createServer((req, res) => {
    if (req.url === "/robots.txt") { res.writeHead(404); return res.end(); }
  }));
  await listen("tls", https.createServer(
    makeCert(),
    (_req, res) => { res.writeHead(200); res.end(PAGE); },
  ));
  browser = await chromium.launch({
    // Set CHROME_PATH to use a Chrome you already have; otherwise Playwright's own Chromium is used.
    executablePath: process.env.CHROME_PATH || undefined,
    args: [
      "--no-sandbox", "--no-proxy-server",
      "--host-resolver-rules=MAP nodns.test ~NOTFOUND, MAP www.nodns.test ~NOTFOUND, MAP wwwonly.test ~NOTFOUND, MAP www.wwwonly.test 127.0.0.1, MAP httponly.test 127.0.0.1",
    ],
  });
});

after(async () => {
  await browser?.close();
  for (const s of servers) s.close();
});

test("classifyFailure matches the real errors from the November 6 run", () => {
  const file = process.env.RESULTS_JSON;
  if (!file) return;
  const rows = (JSON.parse(readFileSync(file, "utf8")) as { results: Array<{ status: string; error?: string }> }).results;
  const counts: Record<string, number> = {};
  for (const r of rows.filter((x) => x.status === "error")) {
    const k = classifyFailure(r.error ?? "");
    counts[k] = (counts[k] ?? 0) + 1;
  }
  console.log("real-run error causes:", counts);
  assert.deepEqual(counts, { dns: 24, tls: 14, timeout: 7, connection: 3, script_blocked: 1 });
});

test("hostVariants adds or removes www, and leaves IP addresses alone", () => {
  assert.deepEqual(hostVariants("https://example.gov/"), ["https://example.gov/", "https://www.example.gov/"]);
  assert.deepEqual(hostVariants("https://www.example.gov/"), ["https://www.example.gov/", "https://example.gov/"]);
  assert.deepEqual(hostVariants("http://127.0.0.1:3000/"), ["http://127.0.0.1:3000/"]);
});

test("a normal page is tested and the record carries both versions", async () => {
  const r = await scanOne(browser, site("ok", `http://127.0.0.1:${ports.ok}/`), "https://example.org/study", FAST);
  assert.equal(r.status, "ok");
  assert.equal(r.scanner_version, SCANNER_VERSION);
  assert.equal(r.axe_version, "4.14.0");
  assert.ok(r.violations?.some((v) => v.id === "image-alt"));
  assert.equal(r.attempts?.[0]?.outcome, "loaded");
  assert.equal(r.has_lang, true);
});

test("a 403 page is recorded as http_error and not tested", async () => {
  const r = await scanOne(browser, site("forbidden", `http://127.0.0.1:${ports.forbidden}/`), "https://example.org/study", FAST);
  assert.equal(r.status, "http_error");
  assert.equal(r.http_status, 403);
  assert.equal(r.violations, undefined);
  assert.equal(r.attempts?.at(-1)?.outcome, "http_error");
});

test("a content security policy blocks the old injection but not the new one", async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${ports.csp}/`);
  await assert.rejects(() => page.addScriptTag({ content: "window.x = 1" }), /violates|Content Security Policy/i);
  await ctx.close();
  const r = await scanOne(browser, site("csp", `http://127.0.0.1:${ports.csp}/`), "https://example.org/study", FAST);
  assert.equal(r.status, "ok");
  assert.ok(r.violations?.some((v) => v.id === "image-alt"));
});

test("a certificate error is reported as tls and never bypassed", async () => {
  const r = await scanOne(browser, site("tls", `https://127.0.0.1:${ports.tls}/`), "https://example.org/study", FAST);
  assert.equal(r.status, "unreachable");
  assert.equal(r.failure_kind, "tls");
  assert.equal(r.violations, undefined);
});

test("a name that does not resolve is tried with and without www, then reported as dns", async () => {
  const r = await scanOne(browser, site("nodns", "http://nodns.test:8099/"), "https://example.org/study", FAST);
  assert.equal(r.status, "unreachable");
  assert.equal(r.failure_kind, "dns");
  assert.deepEqual(r.attempts?.map((a) => a.url), ["http://nodns.test:8099/", "http://www.nodns.test:8099/"]);
});

test("when only the www name exists, the www name is scanned", async () => {
  const r = await scanOne(browser, site("wwwonly", `http://wwwonly.test:${ports.ok}/`), "https://example.org/study", FAST);
  assert.equal(r.status, "ok");
  assert.match(r.final_url ?? "", /^http:\/\/www\.wwwonly\.test/);
  assert.deepEqual(r.attempts?.map((a) => a.outcome), ["dns", "loaded"]);
});

test("robots.txt that disallows the crawler is respected", async () => {
  const r = await scanOne(browser, site("robots", `http://127.0.0.1:${ports.robots}/`), "https://example.org/study", FAST);
  assert.equal(r.status, "robots_disallowed");
  assert.equal(r.violations, undefined);
});

test("one timeout is retried and the page is then scanned", async () => {
  const r = await scanOne(browser, site("flaky", `http://127.0.0.1:${ports.flaky}/`), "https://example.org/study", FAST);
  assert.equal(r.status, "ok");
  assert.deepEqual(r.attempts?.map((a) => a.outcome), ["timeout", "loaded"]);
});

test("a site that never answers is reported as timeout after one retry", async () => {
  const r = await scanOne(browser, site("hang", `http://127.0.0.1:${ports.hang}/`), "https://example.org/study", FAST);
  assert.equal(r.status, "unreachable");
  assert.equal(r.failure_kind, "timeout");
  assert.equal(r.attempts?.length, 2);
});

test("plain http is tried only after the secure port refuses the connection", async (t) => {
  const srv = http.createServer((req, res) => {
    if (req.url === "/robots.txt") { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": "text/html" }); res.end(PAGE);
  });
  try {
    await listen("port80", srv, 80);
  } catch {
    t.skip("cannot bind port 80 here");
    return;
  }
  const r = await scanOne(browser, site("httponly", "https://httponly.test/"), "https://example.org/study", FAST);
  assert.equal(r.status, "ok");
  assert.equal(r.attempts?.at(-1)?.url, "http://httponly.test/");
});

test("aggregation counts why sites were not tested and has no pooled group", () => {
  const mk = (id: string, stratum: string, status: ScanResult["status"], extra: Partial<ScanResult> = {}): ScanResult => ({
    ...site(id, "https://x.gov/"),
    stratum,
    status,
    scanned_at: "2026-11-06T00:00:00Z",
    ...extra,
  });
  const ok = (id: string, stratum: string, bad: boolean) =>
    mk(id, stratum, "ok", {
      violations: bad ? [{ id: "color-contrast", impact: "serious", tags: ["wcag2aa", "wcag143"], nodes: 2 }] : [],
      incomplete: [], h1_count: 1, heading_count: 3, heading_skips: 0, link_count: 10, vague_links: 0, has_lang: true, reading_grade: 12,
    });
  const agg = aggregateResults([
    ok("a", "county", true), ok("b", "county", false), ok("c", "city_town", true),
    mk("d", "county", "unreachable", { failure_kind: "dns" }),
    mk("e", "county", "http_error", { http_status: 403 }),
    mk("f", "city_town", "robots_disallowed"),
  ]);
  const county = agg.reach.find((r) => r.stratum === "county")!;
  assert.deepEqual(
    { sampled: county.sampled, scanned: county.scanned, unreachable: county.unreachable, http_error: county.http_error, cause: county.unreachable_by_cause },
    { sampled: 4, scanned: 2, unreachable: 1, http_error: 1, cause: { dns: 1 } },
  );
  assert.ok(!agg.strata.some((s) => s.stratum === "all"));
  const failRow = agg.strata.find((s) => s.stratum === "county" && s.measure.startsWith("% with at least one"))!;
  assert.equal(failRow.pages, 2);
  assert.equal(failRow.value, 50);
  assert.equal(agg.topRules[0]!.by_stratum.county, 50);
  assert.equal(agg.topRules[0]!.by_stratum.city_town, 100);
  console.log(agg.summaryLine);
});

test("a missing Playwright browser is recognised, other launch errors are not", async () => {
  const { isMissingBrowserError, MISSING_BROWSER_MESSAGE } = await import("@/lib/readiness/scan");
  const real =
    "browserType.launch: Executable doesn't exist at /tmp/x/chrome-headless-shell\n Looks like Playwright was just installed or updated. Please run the following command to download new browsers: npx playwright install";
  assert.equal(isMissingBrowserError(new Error(real)), true);
  assert.equal(isMissingBrowserError(new Error("Target page, context or browser has been closed")), false);
  assert.match(MISSING_BROWSER_MESSAGE, /npx playwright install chromium/);
});
