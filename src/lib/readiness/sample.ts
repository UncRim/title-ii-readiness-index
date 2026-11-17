import type { SiteRow } from "@/lib/readiness/types";
import { parseCsv, stripBom } from "@/lib/readiness/csv-parse";

const SUBUNIT_WORDS =
  /police|sheriff|marshal|fire|library|court|clerk|attorney|treasurer|assessor|utilit|water|sewer|airport|housing|transit|parks|recreation|museum|election|health|jail|probation|coroner|recorder|auditor|emergency|911|tourism|visitor|school|schools|development authority|chamber|appraiser|tax collector|register of|surveyor|extension|engineer|information technology|veterans|animal/i;

const GOVERNMENT_NAME: Record<string, RegExp> = {
  City: /\b(city|town|township|village|borough|commissioners of)\b/i,
  County: /\b(county|parish|borough)\b/i,
};

function colKey(row: Record<string, string>, name: string): string {
  for (const k of Object.keys(row)) {
    if (k.trim().toUpperCase() === name.toUpperCase()) return k;
  }
  throw new Error(
    `Column ${name} not found. First columns: ${Object.keys(row).slice(0, 12).join(", ")}`,
  );
}

function field(row: Record<string, string>, name: string): string {
  return row[colKey(row, name)] ?? "";
}

function normUrl(u: string): string | null {
  u = String(u).trim();
  if (!u || u.toLowerCase() === "nan") return null;
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  return u.replace(/\/+$/, "") + "/";
}

function domainScore(domain: string, org: string): number {
  const words = [...org.toLowerCase().matchAll(/[a-z]+/g)]
    .map((m) => m[0])
    .filter(
      (w) =>
        w.length > 3 &&
        !["city", "town", "county", "village", "township", "borough", "parish"].includes(w),
    );
  const d = domain.toLowerCase();
  return words.reduce((s, w) => s + (d.includes(w) ? 1 : 0), 0);
}

// parseCsv already uses the first line as the header, so every row it returns is a data row.
export function parseCollegesCsv(text: string): SiteRow[] {
  const rows = parseCsv(stripBom(text));
  if (!rows.length) return [];
  const header = rows[0];
  const c: Record<string, string> = {};
  for (const name of ["UNITID", "INSTNM", "STABBR", "WEBADDR", "CONTROL", "ICLEVEL", "CYACTIVE"]) {
    c[name] = colKey(header, name);
  }
  const out: SiteRow[] = [];
  for (const r of rows) {
    if (r[c.CONTROL] !== "1" || r[c.CYACTIVE] !== "1") continue;
    if (!["1", "2"].includes(r[c.ICLEVEL])) continue;
    const url = normUrl(r[c.WEBADDR]);
    if (!url) continue;
    out.push({
      site_id: "ipeds-" + r[c.UNITID],
      stratum: r[c.ICLEVEL] === "1" ? "public_4yr" : "public_2yr",
      name: r[c.INSTNM],
      state: r[c.STABBR],
      url,
      source: "IPEDS HD",
    });
  }
  return out;
}

export function parseDotGovCsv(text: string): SiteRow[] {
  const rows = parseCsv(stripBom(text));
  if (!rows.length) return [];
  type Row = Record<string, string>;
  const filtered: Row[] = [];
  for (const r of rows) {
    const dtype = field(r, "Domain type");
    if (dtype !== "City" && dtype !== "County") continue;
    const orgName = field(r, "Organization name").trim();
    const sub = field(r, "Suborganization name").trim();
    const re = GOVERNMENT_NAME[dtype];
    if (!re?.test(orgName)) continue;
    if (SUBUNIT_WORDS.test(orgName)) continue;
    if (sub !== "") continue;
    filtered.push(r);
  }

  const scored = filtered.map((r) => {
    const domain = field(r, "Domain name");
    const org = field(r, "Organization name");
    return {
      r,
      score: domainScore(domain, org),
      len: domain.length,
      orgKey: org.toLowerCase().trim(),
      state: field(r, "State"),
    };
  });
  scored.sort((a, b) => b.score - a.score || a.len - b.len);

  const seen = new Set<string>();
  const dedup: Row[] = [];
  for (const s of scored) {
    const key = s.orgKey + "|" + s.state;
    if (seen.has(key)) continue;
    seen.add(key);
    dedup.push(s.r);
  }

  const out: SiteRow[] = [];
  for (const r of dedup) {
    const domain = field(r, "Domain name").trim();
    const url = normUrl(domain);
    if (!url) continue;
    const dtype = field(r, "Domain type");
    out.push({
      site_id: "gov-" + domain.toLowerCase(),
      stratum: dtype === "City" ? "city_town" : "county",
      name: field(r, "Organization name"),
      state: field(r, "State"),
      url,
      source: "CISA .gov list",
    });
  }
  return out;
}

/** Fisher-Yates shuffle with seeded RNG (mulberry32). */
function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildStratifiedSample(
  frame: SiteRow[],
  perStratum: number,
  seed: number,
): SiteRow[] {
  const rng = mulberry32(seed >>> 0);
  const byStratum = new Map<string, SiteRow[]>();
  for (const row of frame) {
    const list = byStratum.get(row.stratum) ?? [];
    list.push(row);
    byStratum.set(row.stratum, list);
  }
  const parts: SiteRow[] = [];
  for (const [, sites] of byStratum) {
    const idx = sites.map((_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    for (let k = 0; k < perStratum && k < idx.length; k++) {
      parts.push(sites[idx[k]]);
    }
  }
  parts.sort((a, b) => a.stratum.localeCompare(b.stratum) || a.site_id.localeCompare(b.site_id));
  return parts;
}

export function buildFrame(ipedsCsv: string, dotgovCsv: string): SiteRow[] {
  const colleges = parseCollegesCsv(ipedsCsv);
  const gov = parseDotGovCsv(dotgovCsv);
  const merged = [...colleges, ...gov];
  const byUrl = new Map<string, SiteRow>();
  for (const row of merged) {
    if (!byUrl.has(row.url)) byUrl.set(row.url, row);
  }
  return [...byUrl.values()];
}
