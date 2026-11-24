# AI remediation benchmark

This folder is a small, repeatable test set for comparing AI tools that claim to fix WCAG 2.1 AA issues in HTML.

**Status:** the benchmark has not been run yet. There are no scored tool outputs in `outputs/` for this release. The emails that point here say the same thing.

## What is here

| File | Role |
| --- | --- |
| `make_cases.py` | Builds `cases/` from a clean public-service page with known defects injected |
| `cases/` | Generated after you run `make_cases.py` (`clean.html`, `caseNN.html`, `manifest.json`) |
| `prompt.txt` | Exact prompt to paste into each AI tool, with the case HTML after it |
| `score.js` | Scores each tool's returned HTML with Playwright + axe-core |
| `outputs/<tool>/` | Where you save each tool's fixed `caseNN.html` files |

## Dependencies

`score.js` needs `axe-core` and `playwright` from this repo's root `package.json`. After clone:

```bash
npm install
npx playwright install chromium
```

## How to run (when you are ready)

```bash
# 1. Build the test set
python3 bench/make_cases.py --cases 20 --per-case 3 --seed 2026

# 2. For each AI tool, in a fresh chat: paste prompt.txt, then the case HTML.
#    Save the tool's HTML-only reply as:
#      bench/outputs/<tool-name>/caseNN.html
#    Record tool name, model, and date in:
#      bench/outputs/<tool-name>/README.txt

# 3. Score
node bench/score.js
```

## How scoring treats axe "incomplete"

axe sometimes returns a rule as **incomplete** (needs review) instead of a clear violation. This scorer does **not** count those as fixed.

For each injected defect on a fixed page:

- still a **violation** → not fixed  
- only **incomplete** → counted separately (`still_incomplete` / `defects_still_incomplete`)  
- in neither list → fixed  

A case is "fully fixed" only when every injected defect is gone from both violations and incomplete, and the page did not gain new violation rule ids.
