/**
 * Checks that the pre-run plan is built from the uploaded files and matches what the server samples.
 * Run with: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { planRun, readFrame } from "@/lib/readiness/plan";
import { buildFrame, buildStratifiedSample } from "@/lib/readiness/sample";
import { formatDuration } from "@/lib/readiness/eta";

const IPEDS_HEADER = "UNITID,INSTNM,STABBR,WEBADDR,CONTROL,ICLEVEL,CYACTIVE";
const CISA_HEADER = "Domain name,Domain type,Organization name,Suborganization name,State";

function ipeds(n4: number, n2: number): string {
  const rows: string[] = [];
  for (let i = 0; i < n4; i++) rows.push(`${1000 + i},State University ${i},TX,www.univ${i}.edu,1,1,1`);
  for (let i = 0; i < n2; i++) rows.push(`${5000 + i},Community College ${i},TX,www.cc${i}.edu,1,2,1`);
  rows.push("9001,Private College,TX,www.private.edu,2,1,1"); // private: excluded
  rows.push("9002,Closed College,TX,www.closed.edu,1,1,0"); // not active: excluded
  rows.push("9003,No Website College,TX,,1,1,1"); // no website: excluded
  return [IPEDS_HEADER, ...rows].join("\n");
}

function cisa(cities: number, counties: number): string {
  const rows: string[] = [];
  for (let i = 0; i < cities; i++) rows.push(`town${i}.gov,City,City of Town${i},,TX`);
  for (let i = 0; i < counties; i++) rows.push(`county${i}.gov,County,Place${i} County,,TX`);
  rows.push("police.town0.gov,City,Town0 Police Department,,TX"); // sub-unit: excluded
  return [CISA_HEADER, ...rows].join("\n");
}

test("the plan counts what the uploaded files contain and nothing else", () => {
  const r = readFrame(ipeds(120, 50), cisa(150, 30));
  assert.ok(r.ok);
  const plan = planRun(r.frame, 100, 2026, 5);
  assert.deepEqual(plan.frameByGroup, { public_4yr: 120, public_2yr: 50, city_town: 150, county: 30 });
  assert.deepEqual(plan.sampleByGroup, { public_4yr: 100, public_2yr: 50, city_town: 100, county: 30 });
  assert.equal(plan.sites, 280);
  assert.deepEqual(plan.shortGroups.map((g) => g.stratum), ["public_2yr", "county"]);
});

test("the time comes from the sites in the files, not a fixed number", () => {
  const small = readFrame(ipeds(120, 50), cisa(150, 30));
  const full = readFrame(ipeds(200, 200), cisa(200, 200));
  assert.ok(small.ok && full.ok);
  const a = planRun(small.frame, 100, 2026, 5);
  const b = planRun(full.frame, 100, 2026, 5);
  assert.equal(a.seconds, 280 * 16);
  assert.equal(formatDuration(a.seconds), "about 1 h 15 min");
  assert.equal(b.seconds, 400 * 16);
  assert.ok(b.seconds > a.seconds);
});

test("a longer pause makes the plan longer", () => {
  const r = readFrame(ipeds(200, 200), cisa(200, 200));
  assert.ok(r.ok);
  assert.ok(planRun(r.frame, 100, 2026, 10).seconds > planRun(r.frame, 100, 2026, 5).seconds);
});

test("the plan samples exactly what the server would", () => {
  const files = [ipeds(120, 50), cisa(150, 30)] as const;
  const r = readFrame(...files);
  assert.ok(r.ok);
  const fromPlan = planRun(r.frame, 40, 7, 5);
  const server = buildStratifiedSample(buildFrame(...files), 40, 7);
  assert.equal(fromPlan.sites, server.length);
});

test("the two files in the wrong boxes are caught, and the message says which file", () => {
  const swapped = readFrame(cisa(10, 10), ipeds(10, 10));
  assert.ok(!swapped.ok);
  assert.match(swapped.error, /first file doesn't look like the IPEDS directory/);
  const wrongSecond = readFrame(ipeds(10, 10), ipeds(10, 10));
  assert.ok(!wrongSecond.ok);
  assert.match(wrongSecond.error, /second file doesn't look like CISA/);
});

test("a file with the right columns but no usable rows is caught too", () => {
  const empty = readFrame(IPEDS_HEADER, cisa(5, 5));
  assert.ok(!empty.ok);
  assert.match(empty.error, /No active public/);
});

test("the first row of each file is not skipped", () => {
  const r = readFrame(ipeds(3, 2), cisa(3, 2));
  assert.ok(r.ok);
  const ids = new Set(r.frame.map((s) => s.site_id));
  assert.ok(ids.has("ipeds-1000"), "first college row is missing");
  assert.ok(ids.has("ipeds-5000"), "first community college row is missing");
  assert.ok(ids.has("gov-town0.gov"), "first city row is missing");
  assert.ok(ids.has("gov-county0.gov"), "first county row is missing");
});
