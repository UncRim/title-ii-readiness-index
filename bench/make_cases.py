"""Generate the AI remediation test set: copies of a clean public-service page,
each with known accessibility defects injected. The manifest records which defects
each case contains, so score.js can check what an AI tool actually fixed.

Defects are picked so that every defect type is planted about equally often
(the counts differ by at most one), so per-defect results are comparable.

Usage: python3 make_cases.py --cases 20 --per-case 3 --seed 2026
"""
import argparse
import json
import os
import random

BASE = """<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Riverbend Water Services</title>
<style>body{font-family:Arial,sans-serif;color:#1a1a1a;background:#fff;max-width:760px;margin:auto;padding:16px}
a{color:#0b4f9c}.note{color:#444}</style></head>
<body>
<header><p><a href="/">City of Riverbend</a></p>
<nav aria-label="Main"><ul><li><a href="/services">All services</a></li><li><a href="/contact">Contact the city</a></li></ul></nav></header>
<main>
<h1>Water services</h1>
<p>Riverbend Water Services delivers drinking water to about 40,000 homes and businesses. You can start or stop service, pay a bill, or report a leak online at any time.</p>
<img src="crew.jpg" alt="A city crew repairing a water main on Elm Street" width="320" height="200">
<h2>Pay your bill</h2>
<p>Bills are due on the 15th of each month. Late payments add a fee of five dollars. <a href="/pay">Pay your water bill online</a>.</p>
<h2>Report a leak</h2>
<form action="/leak" method="post">
<label for="addr">Street address of the leak</label>
<input id="addr" name="addr" type="text" autocomplete="street-address">
<label for="type">Type of leak</label>
<select id="type" name="type"><option>Street</option><option>Hydrant</option><option>Meter</option></select>
<button type="submit">Send report</button>
</form>
<h2>Office hours</h2>
<table><caption>Customer service hours</caption>
<tr><th scope="col">Day</th><th scope="col">Hours</th></tr>
<tr><td>Monday to Friday</td><td>8 a.m. to 5 p.m.</td></tr>
<tr><td>Saturday</td><td>9 a.m. to noon</td></tr></table>
<h3>Holiday closures</h3>
<p class="note">Offices close on federal holidays. <a href="/holidays">See the holiday schedule</a>.</p>
<iframe src="/map.html" title="Map of service offices" width="320" height="200"></iframe>
</main>
<footer><p>City of Riverbend, 100 Main Street.</p></footer>
</body></html>
"""

# Each defect: (id, the rule that detects it, original text, replacement text)
DEFECTS = [
    ("missing_alt", "image-alt", ' alt="A city crew repairing a water main on Elm Street"', ""),
    ("vague_link", "vague_link", ">Pay your water bill online</a>", ">Click here</a>"),
    ("empty_link", "link-name", '<a href="/holidays">See the holiday schedule</a>', '<a href="/holidays"><img src="cal.png" alt=""></a>'),
    ("missing_lang", "html-has-lang", '<html lang="en">', "<html>"),
    ("low_contrast", "color-contrast", ".note{color:#444}", ".note{color:#bbb}"),
    ("unlabeled_input", "label", '<label for="addr">Street address of the leak</label>\n', ""),
    ("unlabeled_select", "select-name", '<label for="type">Type of leak</label>\n', ""),
    ("button_no_name", "button-name", '<button type="submit">Send report</button>', '<button type="submit"><span class="icon"></span></button>'),
    ("table_no_headers", "table_headers", '<tr><th scope="col">Day</th><th scope="col">Hours</th></tr>', "<tr><td><b>Day</b></td><td><b>Hours</b></td></tr>"),
    ("heading_skip", "heading_skip", "<h3>Holiday closures</h3>", "<h5>Holiday closures</h5>"),
    ("frame_no_title", "frame-title", ' title="Map of service offices"', ""),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cases", type=int, default=20)
    ap.add_argument("--per-case", type=int, default=3)
    ap.add_argument("--seed", type=int, default=2026)
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "cases"))
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    rng = random.Random(a.seed)
    manifest = {"base": "clean.html", "cases": {}}
    usage = {d[0]: 0 for d in DEFECTS}  # how often each defect has been planted so far
    with open(os.path.join(a.out, "clean.html"), "w") as f:
        f.write(BASE)
    for i in range(1, a.cases + 1):
        html = BASE
        # Least-used defects first; ties broken at random. Picks are distinct within a case.
        picked = sorted(DEFECTS, key=lambda d: (usage[d[0]], rng.random()))[: a.per_case]
        for d in picked:
            usage[d[0]] += 1
        for _, _, old, new in picked:
            assert old in html, old
            html = html.replace(old, new, 1)
        name = f"case{i:02d}.html"
        with open(os.path.join(a.out, name), "w") as f:
            f.write(html)
        manifest["cases"][name] = [{"defect": d, "rule": r} for d, r, _, _ in picked]
    with open(os.path.join(a.out, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2)
    manifest["defect_counts"] = usage
    with open(os.path.join(a.out, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"Wrote {a.cases} cases to {a.out}")
    print("Defects planted:", ", ".join(f"{k}={v}" for k, v in sorted(usage.items())))


if __name__ == "__main__":
    main()
