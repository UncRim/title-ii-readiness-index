# Title II Readiness Index — scanner and portal

A small research tool that measures how ready U.S. public colleges and local governments are for the web accessibility rule in ADA Title II (WCAG 2.1 Level AA), and publishes the results as open, aggregate data.

It is **not** a tool you point at your own website. One person (the project maintainer) runs it on a random sample of public sites, and everyone else reads the published report and data. Skip to [What you get](#what-you-get) if you only want to know what the output looks like.

---

## What it does, in one minute

1. **Builds a list** of public sites from two public files: the federal college directory (IPEDS) and the federal list of `.gov` domains (CISA).
2. **Draws a random sample**: 100 sites from each of four groups (public 4-year colleges, public 2-year colleges, cities and towns, counties). The same random seed always gives the same sample, so anyone can reproduce it.
3. **Visits the home page of each sampled site once**, politely, and runs an automated accessibility test (axe-core, WCAG 2.1 A and AA rules). It also records a few simple content checks: page language, heading order, vague link text such as "click here", and reading grade level.
4. **Reports the results as group-level numbers** with 95% confidence intervals, plus a table showing how many sites could not be tested and why.

Everything about a single named site stays in a private file. The public data has site names, web addresses and error messages removed.

## Who uses it, and how

| Who | What they do |
| --- | --- |
| **Maintainer** | Runs the portal on their own computer, uploads the two input files, waits for the scan, downloads the results. |
| **Accessibility coordinators, CIOs, college and city staff** | Read the published report to see where their sector stands and which problems are most common. They do not run anything. |
| **Researchers, journalists, advocates** | Download the public data file and the method notes. They can re-run the scan with the same seed to check the numbers. |

## What you get

When a scan finishes, the portal opens a separate **results page** (`/results/<job id>`) written for people who are not accessibility specialists:

- **The short version**: one sentence on how the groups did, plus a few plain bullets.
- **How each group did**: for each of the four groups, the share of tested home pages with at least one failure, a plain-language range, and how far the figure could move if the sites that couldn't be tested had all passed or all failed. There is deliberately **no single combined number**, because the groups are equal-sized samples of very different populations.
- **What we found most often**: the most common problems in everyday words, each with why it matters, the usual fix, who usually makes it, and whether it is often a quick fix. The technical rule name and WCAG number sit under "Technical details".
- **Sites we couldn't test**: how many, and why (address not found, certificate problem, timed out, and so on). Read this before quoting any rate. A site that could not be tested is not counted as passing or failing.
- **What you can do next**: steps for someone who runs a public site, and steps for someone sharing the results. The first list is partly filled in from the run itself, for example by naming the quick fixes that turned up.
- **The full numbers**: every table, folded away, for readers who want them.
- **Two downloads** (see [Outputs](#outputs)).

The page can be opened while a scan is still running. It shows progress and fills in when the scan finishes.

## Quick start

You need Node.js 18 or newer.

```bash
cd readiness-portal
npm install
npx playwright install chromium
npm run dev
```

Open <http://localhost:3000>, then:

1. **Download the two input files**
   - IPEDS institutional directory, e.g. `HD2024.csv`, from the National Center for Education Statistics (IPEDS data center; it is the "HD" directory file for the latest year).
   - CISA `.gov` domain list, `current-full.csv`, from the CISA `.gov` data repository.
2. **Upload both files** in the portal.
3. **Check the plan.** As soon as both files are chosen, the page reads them in your browser and shows how many sites the scan will visit in each group and how long it should take. The time is worked out from those counts and your pause setting, so it changes with your files and settings. It also catches the wrong file in the wrong box. With the default settings (100 per group, 5 seconds between sites) a full run is 400 sites and takes about 1 hour 45 minutes. If a group has fewer sites than you asked for, it says so.
4. **Enter your project page address** (see below).
5. **Start the scan.** The page jumps to the live progress panel at the top, shows how many sites are done, how long it has been running, the time left and the expected finish time, and a log of what the scanner is doing. The settings fold away while it runs, and only one scan can run at a time. When it says the scan is finished, choose **View results**.

The time left is a rough guess for the first few sites and then uses the scan's real speed, so it gets more accurate as it goes. The "expected time" before you start assumes about 11 seconds to load and test each page, which is the average from the first full run.

Jobs are kept in memory only. If you restart the server, the job is gone, so download your results before closing it.

### If the scan stops with "browser isn't installed"

The scanner drives a real browser. If Playwright's Chromium hasn't been downloaded, the scanner uses Google Chrome when it is installed. If neither is found, the scan stops and says so. Fix it with:

```bash
npx playwright install chromium
```

then restart the server. If you start the server from Cursor, run both commands in Cursor's own terminal, because Cursor keeps its browsers in a separate folder. The activity log's first lines say which browser is being used.

### The project page address (required)

Every request the scanner makes identifies itself as `TitleIIReadinessIndex` and includes a link to a page you control. This is for the owners of the sites being visited, not for people reading the results: if someone sees an unfamiliar visitor in their server logs, the link tells them who is behind it, why, and how to opt out. It is separate from the results page.

Type it into the **Project page address** field on the run page. The page should say who runs the study, what it measures, and how to opt out. The portal refuses to start a scan without one.

- It must be a real public address, not `localhost`.
- `.gov` addresses are rejected unless you explicitly allow them, so a scan is never made to look like it comes from a government agency.

To avoid typing it every time, put it in a `.env.local` file in the project folder and leave the field blank. Restart the server after changing the file.

```
READINESS_CONTACT_URL=https://your-project-page
```

| Setting | What it does |
| --- | --- |
| `READINESS_CONTACT_URL` | Used when the field is left blank. |
| `READINESS_ALLOWED_GOV_CONTACT_HOSTS` | Hostnames allowed to use a `.gov` project page, only if you control that page. |
| `NEXT_PUBLIC_READINESS_ALLOWED_GOV_CONTACT_HOSTS` | The same list, so the form's own check matches the server. |

## How sites are chosen

- **Colleges:** public (government-controlled), currently active, 4-year or 2-year institutions in the IPEDS directory that list a website.
- **Cities, towns and counties:** `.gov` domains of type City or County in the CISA list, keeping the main government's site. Police, library, utility, school and similar sub-unit sites are excluded, and one site is kept per government.
- **Sample:** a seeded shuffle within each group, then the first 100. The same files, the same seed and the same version of the tool give the same sample, so record all three when you publish.

The list is a **frame**, not a census. Governments that do not use a `.gov` domain are not in it, and the CISA list reflects domains registered when you download it. Say which file versions you used whenever you publish numbers.

## Being a polite visitor

- One home page per site. No crawling, no logging in, no forms.
- A pause between sites (5 seconds by default; the form allows 0 to 30).
- `robots.txt` is read first. If it asks `TitleIIReadinessIndex` (or all crawlers) not to visit, the site is skipped and counted as "robots disallowed".
- Certificate errors are reported, never bypassed.
- Anyone can opt out through your project page, and you should remove their site from future runs.

## What each result means

| Status | Meaning | In the rates? |
| --- | --- | --- |
| **Tested** | Page loaded and was checked. | Yes |
| **Robots disallowed** | `robots.txt` asked not to be visited. | No |
| **Error page** | Site answered with an HTTP error (403, 404, and so on) or a block page. | No |
| **Unreachable** | Could not connect. The reason is recorded: name does not exist (`dns`), certificate problem (`tls`), too slow (`timeout`), connection refused (`connection`), or the page blocked the test script (`script_blocked`). | No |
| **Failed unexpectedly** | Something went wrong in the scanner itself. | No |

Before giving up, the scanner tries the same address with and without `www.`, waits and retries once after a timeout, and falls back to plain `http://` only if the secure port refuses the connection. It never downgrades or skips a certificate error.

## Outputs

- **Public data (names removed)** — de-identified per-site records (site IDs are one-way hashed with the seed; names, addresses and error text are removed), plus the group tables. This is the file to publish.
- **Full JSON (private)** — includes site names and addresses. Keep it for your own checking. Do not publish it.

Every record carries the scanner version and the axe-core version, so results from different versions are never mixed without anyone noticing. Report the "run settings" line (sites per group, seed, delay) with any figures you share.

## What this tests, and what it doesn't

### The standard

The scanner tests against **WCAG 2.1, Levels A and AA**. That is the standard the U.S. Department of Justice named in its 2024 rule for state and local government websites (28 CFR part 35, subpart H). It is not WCAG 2.2, and not Level AAA. A site can meet the rule's standard without meeting WCAG 2.2, so testing against 2.2 would measure sites against something the rule does not require.

### The engine

The scanner does not decide what counts as a failure. It runs [axe-core](https://github.com/dequelabs/axe-core), an open-source accessibility engine maintained by Deque Systems, and keeps only the rules axe-core tags as WCAG 2.0 or 2.1, Level A or AA (`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`). WCAG 2.1 includes all of 2.0, which is why both appear. In axe-core 4.14.0 that is 69 of its 105 rules.

Left out on purpose:

- **Level AAA rules.** The rule does not require AAA.
- **Best-practice rules** (30 in 4.14.0). They are useful advice, but not WCAG requirements.
- **WCAG 2.2 rules.** axe-core 4.14.0 has one (target size).
- **Experimental rules.** axe-core keeps these off unless asked, and so does the scanner.

Every record stores the scanner version and the axe-core version. A different axe-core version can give different results on the same page, so compare runs only when the versions match. The results page says if a run mixes versions.

### What "a failure" means here

axe-core reports a **violation** only when it is confident. When it cannot decide (for example, text over a background image, or a video whose captions it cannot see), it reports the item as **needs review**. The scanner records both, but only violations count toward the failure rates. This makes the rates conservative. Tools that report more aggressively, such as WAVE (used by the WebAIM Million), give higher figures on the same pages.

The rates count **failing rules**, not WCAG success criteria. Several axe rules can map to one criterion, and many criteria have no automated rule at all.

### What automated testing cannot see

Automated checks cover only part of WCAG. They cannot tell whether:

- alt text actually describes the image
- the keyboard order makes sense, or focus is ever trapped
- a video has accurate captions or audio description
- error messages and instructions are understandable
- content works when zoomed, reflowed or read aloud

So a page with **no violations** has "no automated failures detected". It is not "accessible", "WCAG compliant" or "ADA compliant". Please don't describe it that way, and don't describe this tool's output that way.

### What one scan sees

- **The home page only.** No other pages, PDFs, forms, videos or apps.
- **One page load, in one state.** A desktop-sized window (1280 × 900), as the page first loads. Menus are not opened, cookie banners are not dismissed, and mobile layouts are not tested.
- **One day.** Sites change. A single run is a snapshot.

### Extra checks that are not WCAG

The scanner also records page language, heading order, vague link text ("click here", "read more") and a reading-grade score. These are signals of usability, not WCAG failures, and they do not count toward the failure rates. The reading-grade formula is rough on home pages, which are mostly menus and short labels.

### Comparing groups

The results page compares groups with a chi-square test across all groups and reports the p-value. It does not judge a gap by whether two 95% ranges overlap: ranges can overlap and the difference still be real. Equal-sized samples of very different populations should not be pooled into one national figure, and the tool does not report one.

### "Compliance" is a legal question

The rule has exceptions (for example, some archived content, preexisting documents and third-party content) that a scan cannot see. Whether a public entity complies is a legal question that depends on its whole site and its circumstances. This tool measures something narrower: how many home pages have failures that software can detect.

## What the numbers can and cannot tell you

**They can say:** among the sites that could be tested, roughly what share had at least one automated WCAG 2.1 A/AA failure on their home page, and which failures are most common.

**They cannot say:**
- Whether a site is "compliant" or "legally compliant". Automated tools find only part of the problems; passing the automated test does not mean a site is accessible.
- Anything about pages other than the home page, PDFs, videos, or mobile apps.
- Anything about sites that were not tested. Those are shown separately, and the range of possible values if they were all passes or all failures is a better guide than guessing.
- Whether a site is getting better. One run is a snapshot; the index is meant to be repeated.

Home-page results are a screening measure, not an audit.

## Tests

```bash
npm test
```

Four sets of checks. The plan tests check that the counts and expected time come from the uploaded files and match what the server samples. The time-estimate tests check the "time left" arithmetic. The scanner tests start small local servers that behave like the sites that failed in the first run (bad certificate, missing name, 403 page, content security policy, slow site, `robots.txt` that says no) and check the scanner reports each correctly. The results-page tests check that the plain-language summary says what the numbers say: ranges, the test of whether groups differ, untested-site bounds, and the empty-run case. Set `CHROME_PATH` to use an existing Chrome instead of Playwright's Chromium. The tests need `openssl` installed.

They check the scanner's logic. They do not replace a live run; before publishing, run a small live scan (for example, 10 sites per group) and read the "which sites could be tested" table.

## Under the hood

Next.js 16, React 19, BoardUI components, Playwright (Chromium), `axe-core`, `robots-parser`, `papaparse`.

```
src/lib/readiness/
  sample.ts      builds the frame and the seeded sample
  scan.ts        loads a page, retries, runs axe and content checks
  aggregate.ts   rates, confidence intervals, reach table, top rules
  narrative.ts   turns the numbers into plain sentences and next steps
  eta.ts         time arithmetic: expected time, time left
  plan.ts        reads the uploaded files and works out the sample and expected time
  rule-guide.ts  plain-language notes for the common axe rules
  stats.ts       chi-square test used to compare groups
  run-pipeline.ts, jobs.ts   run a job and keep its progress
src/app/page.tsx                 the run page (upload, options, progress)
src/app/results/[id]/            the results page
src/app/api/readiness/jobs/      start a job, poll it, export results
tests/scan.test.ts, tests/narrative.test.ts, tests/eta.test.ts, tests/plan.test.ts
```

API, for scripting:

- `POST /api/readiness/jobs` — multipart: `ipeds`, `dotgov` (files), `perStratum`, `seed`, `delaySec`, `contactUrl` (or leave it out and set `READINESS_CONTACT_URL`).
- `GET /api/readiness/jobs/:id` — status and progress log.
- `GET /api/readiness/jobs/:id/export` — full JSON (private). Add `?public=1` for the de-identified version.

Accessibility self-check of the portal itself: run `npm run dev`, then `npm run a11y:check` (axe against the portal's own home page).

## Deploying

Run it only on a machine where Playwright's Chromium is installed. Jobs live in memory and disappear on restart. It is built to run on one person's computer, not as a public service.

## How to cite

> Dandi, D. *Title II Readiness Index: scanner and data, cycle 1.* November 16, 2026.

## Roadmap

- Repeat the index each cycle, with the same method and seed policy.
- A "your own site" check: paste a URL and get the same plain-language page for that one site.
- An AI remediation benchmark: how often AI-suggested fixes resolve automated failures without breaking the page. The harness lives in [`bench/`](./bench/); it has **not been run yet** (no scored tool outputs in this release).
- A fix-first guide for the most common failures.

These are planned, not part of this release. The benchmark folder is checked in so others can inspect the method; results will come later.

## Licence

Copyright (c) 2026 Denelsen Dandi.

- Code: MIT License (see LICENSE).
- Report, published data and documentation: Creative Commons Attribution 4.0
  International (CC BY 4.0), https://creativecommons.org/licenses/by/4.0/
- src/components/ contains BoardUI interface components, which keep their own
  licence terms.
