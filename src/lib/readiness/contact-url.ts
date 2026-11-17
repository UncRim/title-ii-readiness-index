/**
 * Validates the public project / opt-out page URL used in the crawler User-Agent.
 * - Required; must be absolute http(s).
 * - Hostnames ending in .gov (and bare "gov") are blocked unless listed in allowGovHosts
 *   (from READINESS_ALLOWED_GOV_CONTACT_HOSTS on the server).
 */

export type ContactUrlValid = { ok: true; href: string; hostname: string };
export type ContactUrlInvalid = { ok: false; error: string };
export type ContactUrlResult = ContactUrlValid | ContactUrlInvalid;

function normalizeGovAllowlist(entries: string[]): Set<string> {
  const set = new Set<string>();
  for (const entry of entries) {
    const h = entry.trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0];
    if (h) set.add(h);
  }
  return set;
}

function isGovHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === "gov" || h.endsWith(".gov");
}

/**
 * @param raw — user-submitted string
 * @param allowGovHosts — hostnames (no scheme) permitted when using .gov, e.g. from env
 */
export function validateContactUrl(
  raw: string,
  allowGovHosts: string[] = [],
): ContactUrlResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {
      ok: false,
      error:
        "No project page address was given. Enter a public page that explains the scan and how to opt out in the Project page address field, or set READINESS_CONTACT_URL in .env.local and restart the server. The address goes in the scanner's user-agent so site owners can find out who is visiting.",
    };
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return {
      ok: false,
      error:
        "Contact URL must be a full URL starting with https:// (or http:// for local testing only).",
    };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "Contact URL must use http or https." };
  }

  const hostname = url.hostname.toLowerCase();
  if (!hostname) {
    return { ok: false, error: "Contact URL is missing a hostname." };
  }

  // Block loopback and obvious placeholders for production contact strings
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1"
  ) {
    return {
      ok: false,
      error:
        "Use a publicly reachable contact URL (not localhost). For local scans, deploy a short public page or use a staging URL you control.",
    };
  }

  const allowed = normalizeGovAllowlist(allowGovHosts);
  if (isGovHostname(hostname) && !allowed.has(hostname)) {
    return {
      ok: false,
      error:
        "A .gov URL can imply the scan is run by that government domain. Use a project URL you own (for example your organization’s site or a documented project page). " +
        "If you must use an agency .gov page your team controls, add its hostname to READINESS_ALLOWED_GOV_CONTACT_HOSTS on the server.",
    };
  }

  // Normalize trailing slash for display/consistency
  const href = url.href.replace(/\/$/, "") || url.href;
  return { ok: true, href, hostname };
}

export function parseGovAllowlistEnv(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw.split(/[,;\s]+/).filter(Boolean);
}
