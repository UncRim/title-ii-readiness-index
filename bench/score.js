// Score AI remediation outputs against the test set.
//
// Put each tool's fixed pages in bench/outputs/<tool-name>/caseNN.html, then run:
//   node bench/score.js
// For each tool it reports: injected defects fixed, cases fully fixed, new problems
// introduced, injected defects left as axe "incomplete", and how much of the page's
// visible text was preserved.
//
// Incomplete results are counted separately. A defect that only appears in axe's
// incomplete list is not treated as fixed.

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const axeSource = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

const DIR = __dirname;
const CASES = path.join(DIR, "cases");
const OUTPUTS = path.join(DIR, "outputs");
const VAGUE = ["click here", "here", "read more", "more", "learn more", "link", "this page", "click", "more info", "details"];

async function analyze(page, html) {
  await page.setContent(html, { waitUntil: "domcontentloaded" });
  await page.addScriptTag({ content: axeSource });
  return page.evaluate(async (vague) => {
    const r = await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } });
    const found = new Set(r.violations.map((v) => v.id));
    const incomplete = new Set((r.incomplete || []).map((v) => v.id));
    const hs = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].map((h) => +h.tagName[1]);
    for (let i = 1; i < hs.length; i++) if (hs[i] > hs[i - 1] + 1) found.add("heading_skip");
    if ([...document.querySelectorAll("a[href]")].some((a) => vague.includes((a.innerText || "").trim().toLowerCase()))) found.add("vague_link");
    if ([...document.querySelectorAll("table")].some((t) => !t.querySelector("th"))) found.add("table_headers");
    const words = (document.body.innerText || "").toLowerCase().match(/[a-z0-9]+/g) || [];
    return { rules: [...found], incomplete: [...incomplete], words };
  }, VAGUE);
}

function jaccard(a, b) {
  const A = new Set(a), B = new Set(b);
  const inter = [...A].filter((x) => B.has(x)).length;
  return A.size + B.size - inter === 0 ? 1 : inter / (A.size + B.size - inter);
}

(async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(CASES, "manifest.json"), "utf8"));
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const clean = await analyze(page, fs.readFileSync(path.join(CASES, "clean.html"), "utf8"));
  if (clean.rules.length) console.warn("Warning: clean page has detected issues:", clean.rules);
  if (clean.incomplete.length) console.warn("Warning: clean page has incomplete axe checks:", clean.incomplete);

  const tools = fs.existsSync(OUTPUTS) ? fs.readdirSync(OUTPUTS).filter((d) => fs.statSync(path.join(OUTPUTS, d)).isDirectory()) : [];
  if (!tools.length) console.log("No outputs yet. Put fixed pages in bench/outputs/<tool>/caseNN.html");
  const summary = [];
  for (const tool of tools) {
    let injected = 0, fixed = 0, fullyFixed = 0, newIssues = 0, incompleteLeft = 0, cases = 0, simSum = 0;
    const detail = [];
    for (const [name, defects] of Object.entries(manifest.cases)) {
      const f = path.join(OUTPUTS, tool, name);
      if (!fs.existsSync(f)) continue;
      cases++;
      const before = await analyze(page, fs.readFileSync(path.join(CASES, name), "utf8"));
      const after = await analyze(page, fs.readFileSync(f, "utf8"));
      const left = defects.filter((d) => after.rules.includes(d.rule));
      const incomplete = defects.filter((d) => !after.rules.includes(d.rule) && after.incomplete.includes(d.rule));
      const introduced = after.rules.filter((r) => !before.rules.includes(r));
      const sim = jaccard(clean.words, after.words);
      injected += defects.length;
      fixed += defects.length - left.length - incomplete.length;
      incompleteLeft += incomplete.length;
      newIssues += introduced.length;
      if (!left.length && !incomplete.length && !introduced.length) fullyFixed++;
      simSum += sim;
      detail.push({
        case: name,
        injected: defects.map((d) => d.defect).join(" "),
        still_present: left.map((d) => d.defect).join(" "),
        still_incomplete: incomplete.map((d) => d.defect).join(" "),
        introduced: introduced.join(" "),
        text_similarity: sim.toFixed(2),
      });
    }
    if (!cases) continue;
    const row = {
      tool,
      cases,
      injected_defects: injected,
      defects_fixed_pct: +(100 * fixed / injected).toFixed(1),
      cases_fully_fixed: fullyFixed,
      defects_still_incomplete: incompleteLeft,
      new_issues_introduced: newIssues,
      mean_text_similarity: +(simSum / cases).toFixed(2),
    };
    summary.push(row);
    const csv = [Object.keys(detail[0]).join(","), ...detail.map((d) => Object.values(d).map((v) => `"${v}"`).join(","))].join("\n");
    fs.writeFileSync(path.join(OUTPUTS, `${tool}_detail.csv`), csv);
  }
  await browser.close();
  if (summary.length) {
    console.table(summary);
    fs.writeFileSync(path.join(OUTPUTS, "summary.json"), JSON.stringify(summary, null, 2));
  }
})();
