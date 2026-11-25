// Score AI remediation outputs against the test set.
//
// Put each tool's fixed pages in bench/outputs/<tool-name>/caseNN.html, then run:
//   node bench/score.js
//
// For each tool it reports: injected defects fixed, cases fully fixed, new problems
// introduced (counted per failing element, not per rule), injected defects left as
// axe "incomplete", missing or gutted outputs, how much of the page's visible text was
// preserved, and a per-defect breakdown.
//
// Scoring rules (decided before any results exist):
//  1. A missing output file counts as every defect not fixed. It is never skipped.
//  2. An output whose visible text overlaps the clean page by less than MIN_SIMILARITY
//     is "gutted" and counts as failed: deleting the page is not a fix.
//  3. A defect only seen in axe's "incomplete" list is reported separately and is not
//     counted as fixed.
//  4. A "new problem" is a failing element (rule + element identity) that was not
//     failing on the input page. A fix that replaces one failing element with another
//     failing element of the same rule counts as one fixed defect and one new problem.
//  5. An image alt text that is generic ("image", "photo", a file name) or empty on the
//     content image is counted as an image-alt failure, because axe accepts any alt text.

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const axeSource = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

const DIR = __dirname;
const CASES = path.join(DIR, "cases");
const OUTPUTS = path.join(DIR, "outputs");
const MIN_SIMILARITY = 0.5;
const VAGUE = ["click here", "here", "read more", "more", "learn more", "link", "this page", "click", "more info", "details"];
const GENERIC_ALT = ["image", "img", "photo", "picture", "pic", "graphic", "icon", "thumbnail", "placeholder", "untitled", "image of", "photo of", "picture of"];

async function analyze(page, html) {
  await page.setContent(html, { waitUntil: "domcontentloaded" });
  await page.addScriptTag({ content: axeSource });
  return page.evaluate(async ({ vague, genericAlt }) => {
    // Identity of an element: tag plus stable attributes, so a fix that only changes
    // alt text, labels or colours leaves the same element identity. Headings are
    // identified by their text, because a fix may change the level.
    const KEYS = ["id", "name", "src", "href", "for", "type", "class"];
    const sig = (el) => {
      const heading = /^h[1-6]$/i.test(el.tagName);
      return (heading ? "h" : el.tagName.toLowerCase()) + "|" + KEYS.map((k) => el.getAttribute(k) || "").join("|") +
        "|" + (heading ? (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 60) : "");
    };
    const nodes = {}; // rule -> list of element signatures
    const add = (rule, el) => { (nodes[rule] = nodes[rule] || []).push(sig(el)); };

    const r = await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } });
    for (const v of r.violations) {
      for (const n of v.nodes) {
        let el = null;
        try { el = document.querySelector(n.target[0]); } catch (e) { /* fall through */ }
        if (el) add(v.id, el); else (nodes[v.id] = nodes[v.id] || []).push("unlocated|" + n.html);
      }
    }
    const incomplete = [...new Set((r.incomplete || []).map((v) => v.id))];

    // Custom checks that axe does not make.
    const hs = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")];
    for (let i = 1; i < hs.length; i++) if (+hs[i].tagName[1] > +hs[i - 1].tagName[1] + 1) add("heading_skip", hs[i]);
    for (const a of document.querySelectorAll("a[href]")) if (vague.includes((a.innerText || "").trim().toLowerCase())) add("vague_link", a);
    for (const t of document.querySelectorAll("table")) if (!t.querySelector("th")) add("table_headers", t);
    // axe accepts any non-empty alt, so check for generic alt text and for an empty alt
    // on the content image (the crew photo).
    for (const img of document.querySelectorAll("img[alt]")) {
      const alt = img.getAttribute("alt").trim().toLowerCase();
      const generic = alt && (genericAlt.includes(alt) || /\.(jpe?g|png|gif|svg|webp)$/.test(alt) || /^(img|dsc|image)[-_ ]?\d+$/.test(alt));
      const emptyOnContent = !alt && /crew/i.test(img.getAttribute("src") || "") && !img.closest("a");
      if (generic || emptyOnContent) add("image-alt", img);
    }
    const words = (document.body.innerText || "").toLowerCase().match(/[a-z0-9]+/g) || [];
    return { nodes, incomplete, words, axeVersion: window.axe.version };
  }, { vague: VAGUE, genericAlt: GENERIC_ALT });
}

function jaccard(a, b) {
  const A = new Set(a), B = new Set(b);
  const inter = [...A].filter((x) => B.has(x)).length;
  return A.size + B.size - inter === 0 ? 1 : inter / (A.size + B.size - inter);
}

// Failing elements in `after` that were not failing in `before`, for one rule.
function novel(afterSigs, beforeSigs) {
  const pool = [...beforeSigs];
  let n = 0;
  for (const s of afterSigs) {
    const i = pool.indexOf(s);
    if (i >= 0) pool.splice(i, 1); else n++;
  }
  return n;
}
// Failing elements in `after` that were already failing in `before`.
const carried = (afterSigs, beforeSigs) => afterSigs.length - novel(afterSigs, beforeSigs);

(async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(CASES, "manifest.json"), "utf8"));
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const clean = await analyze(page, fs.readFileSync(path.join(CASES, "clean.html"), "utf8"));
  const cleanRules = Object.keys(clean.nodes);
  if (cleanRules.length) console.warn("Warning: clean page has detected issues:", cleanRules);
  if (clean.incomplete.length) console.warn("Warning: clean page has incomplete axe checks:", clean.incomplete);
  const versions = { axe_core: clean.axeVersion, playwright: require("playwright/package.json").version, chromium: browser.version(), min_text_similarity: MIN_SIMILARITY };

  const tools = fs.existsSync(OUTPUTS) ? fs.readdirSync(OUTPUTS).filter((d) => fs.statSync(path.join(OUTPUTS, d)).isDirectory()) : [];
  if (!tools.length) console.log("No outputs yet. Put fixed pages in bench/outputs/<tool>/caseNN.html");
  const summary = [];
  for (const tool of tools) {
    let injected = 0, fixed = 0, fullyFixed = 0, newIssues = 0, incompleteLeft = 0, missing = 0, gutted = 0, scored = 0, simSum = 0;
    const detail = [];
    const byDefect = {};
    const bump = (d, k) => { byDefect[d] = byDefect[d] || { injected: 0, fixed: 0, still_present: 0, still_incomplete: 0 }; byDefect[d][k]++; };
    const names = Object.keys(manifest.cases);
    for (const name of names) {
      const defects = manifest.cases[name];
      const f = path.join(OUTPUTS, tool, name);
      injected += defects.length;
      defects.forEach((d) => bump(d.defect, "injected"));
      if (!fs.existsSync(f)) {
        missing++;
        defects.forEach((d) => bump(d.defect, "still_present"));
        detail.push({ case: name, status: "missing", injected: defects.map((d) => d.defect).join(" "), fixed: "", still_present: defects.map((d) => d.defect).join(" "), still_incomplete: "", new_problems: 0, new_problem_rules: "", text_similarity: "" });
        continue;
      }
      scored++;
      const before = await analyze(page, fs.readFileSync(path.join(CASES, name), "utf8"));
      const after = await analyze(page, fs.readFileSync(f, "utf8"));
      const sim = jaccard(clean.words, after.words);
      simSum += sim;
      if (sim < MIN_SIMILARITY) {
        gutted++;
        defects.forEach((d) => bump(d.defect, "still_present"));
        detail.push({ case: name, status: "gutted", injected: defects.map((d) => d.defect).join(" "), fixed: "", still_present: defects.map((d) => d.defect).join(" "), still_incomplete: "", new_problems: 0, new_problem_rules: "", text_similarity: sim.toFixed(2) });
        continue;
      }
      const left = [], incomplete = [], ok = [];
      for (const d of defects) {
        const a = after.nodes[d.rule] || [], b = before.nodes[d.rule] || [];
        if (carried(a, b) > 0) { left.push(d); bump(d.defect, "still_present"); }
        else if (after.incomplete.includes(d.rule)) { incomplete.push(d); bump(d.defect, "still_incomplete"); }
        else { ok.push(d); bump(d.defect, "fixed"); }
      }
      let newCount = 0;
      const newRules = [];
      for (const rule of Object.keys(after.nodes)) {
        const n = novel(after.nodes[rule], before.nodes[rule] || []);
        if (n) { newCount += n; newRules.push(`${rule}x${n}`); }
      }
      fixed += ok.length;
      incompleteLeft += incomplete.length;
      newIssues += newCount;
      if (!left.length && !incomplete.length && !newCount) fullyFixed++;
      detail.push({
        case: name,
        status: "scored",
        injected: defects.map((d) => d.defect).join(" "),
        fixed: ok.map((d) => d.defect).join(" "),
        still_present: left.map((d) => d.defect).join(" "),
        still_incomplete: incomplete.map((d) => d.defect).join(" "),
        new_problems: newCount,
        new_problem_rules: newRules.join(" "),
        text_similarity: sim.toFixed(2),
      });
    }
    const row = {
      tool,
      cases: names.length,
      outputs_missing: missing,
      outputs_gutted: gutted,
      injected_defects: injected,
      defects_fixed_pct: +(100 * fixed / injected).toFixed(1),
      cases_fully_fixed: fullyFixed,
      defects_still_incomplete: incompleteLeft,
      new_problems_introduced: newIssues,
      mean_text_similarity: scored ? +(simSum / scored).toFixed(2) : null,
    };
    summary.push({ ...row, by_defect: byDefect });
    const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
    fs.writeFileSync(path.join(OUTPUTS, `${tool}_detail.csv`), [Object.keys(detail[0]).join(","), ...detail.map((d) => Object.values(d).map(q).join(","))].join("\n"));
    const rows = Object.entries(byDefect).sort().map(([d, v]) => [d, v.injected, v.fixed, v.still_present, v.still_incomplete, +(100 * v.fixed / v.injected).toFixed(1)]);
    fs.writeFileSync(path.join(OUTPUTS, `${tool}_by_defect.csv`), ["defect,injected,fixed,still_present,still_incomplete,fixed_pct", ...rows.map((r) => r.join(","))].join("\n"));
  }
  await browser.close();
  if (summary.length) {
    console.table(summary.map(({ by_defect, ...r }) => r));
    fs.writeFileSync(path.join(OUTPUTS, "summary.json"), JSON.stringify({ versions, results: summary }, null, 2));
    console.log("Versions:", JSON.stringify(versions));
  }
})();
