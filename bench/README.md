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

## How scoring works

These rules are fixed before any tool has been run, so they cannot be tuned to a result.

- **Missing output = failed.** If a tool returns no file for a case, every defect in that case counts as not fixed. Nothing is skipped.
- **Gutted output = failed.** If an output keeps less than half of the clean page's visible words (Jaccard overlap below 0.5), it counts as failed. Deleting the page is not a fix. The threshold is `MIN_SIMILARITY` in `score.js`.
- **Axe "incomplete" is not fixed.** A defect that only shows up as incomplete (needs review) is reported separately as `still_incomplete`. A case is "fully fixed" only if no injected defect is left in either list and no new problem appeared.
- **New problems are counted per element, not per rule.** An element is identified by its tag and stable attributes (id, name, src, href, for, type, class; headings by their text). A failing element that was not failing on the input page is a new problem, even if its rule was already failing elsewhere. A fix that swaps one failing element for another failing element of the same rule counts as one fixed defect and one new problem.
- **Generic alt text is a failure.** Axe accepts any non-empty alt. The scorer also counts generic alt text ("image", "photo", a file name) and an empty alt on the content photo as `image-alt` failures.
- **Defects are planted evenly.** `make_cases.py` picks the least-used defects first, so each defect appears 5 or 6 times in 60 slots. Results are reported per defect in `outputs/<tool>_by_defect.csv`, because overall rates hide that some defects are easier than others.
- **Versions are recorded.** `outputs/summary.json` stores the axe-core, Playwright and Chromium versions and the similarity threshold used. Install with `npm ci` so the lockfile versions are used, and report them with any results.

Planted defects use a synthetic page. They give a known answer key (which axe-only scans of real pages lack), but they are less realistic than real pages. Treat results as a small comparison, not a ranking of tools.

## Output files

- `outputs/<tool>_detail.csv`: one row per case (status, defects fixed, still present, incomplete, new problems, text overlap).
- `outputs/<tool>_by_defect.csv`: fixed rate per defect type.
- `outputs/summary.json`: the summary table, per-defect counts and the versions above.
