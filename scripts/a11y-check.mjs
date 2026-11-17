/**
 * Run axe-core against a running dev/prod URL (defaults to http://127.0.0.1:3000).
 * Usage: in another terminal `npm run dev`, then:
 *   node scripts/a11y-check.mjs
 *   A11Y_URL=http://127.0.0.1:3001 node scripts/a11y-check.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const axePath = join(root, "node_modules", "axe-core", "axe.min.js");
const axeSource = readFileSync(axePath, "utf8");

const url = process.env.A11Y_URL || "http://127.0.0.1:3000";

const browser = await chromium.launch();
const page = await browser.newPage();
try {
  await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
  await page.addScriptTag({ content: axeSource });
  const results = await page.evaluate(async () => {
    // eslint-disable-next-line no-undef
    return await window.axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
    });
  });
  const violations = results.violations || [];
  if (violations.length) {
    console.error(`\naxe: ${violations.length} WCAG 2.1 A/AA violation(s) on ${url}\n`);
    for (const v of violations) {
      console.error(`  [${v.impact}] ${v.id}: ${v.help} (${v.nodes?.length ?? 0} nodes)`);
      for (const n of v.nodes?.slice(0, 8) ?? []) {
        const tgt = Array.isArray(n.target) ? n.target.join(" > ") : String(n.target);
        console.error(`    → ${tgt}`);
        if (n.html) console.error(`      ${String(n.html).slice(0, 200)}`);
      }
      if ((v.nodes?.length ?? 0) > 8) console.error(`    … (${v.nodes.length - 8} more)`);
    }
    process.exitCode = 1;
  } else {
    console.log(`axe: no WCAG 2.1 A/AA violations on ${url}`);
  }
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
}
