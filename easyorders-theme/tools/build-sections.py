#!/usr/bin/env python3
"""Expand {% comment %}@include NAME{% endcomment %} markers in tools/src-sections/*.liquid
using tools/partials/NAME.liquid and write the result to theme/sections/.
EasyOrders has no documented include/render tag, so shared markup is inlined at build time."""
import pathlib, re, sys
root = pathlib.Path(__file__).resolve().parent
src = root / "src-sections"
out = root.parent / "theme" / "sections"
pat = re.compile(r"\{%-?\s*comment\s*-?%\}@include ([a-z0-9-]+)\{%-?\s*endcomment\s*-?%\}")
def expand(text, depth=0):
    if depth > 3:
        sys.exit("include depth exceeded")
    return pat.sub(lambda m: expand((root / "partials" / f"{m.group(1)}.liquid").read_text(encoding="utf-8").rstrip("\n"), depth + 1), text)
def build(source, target, label):
    body = expand(source.read_text(encoding="utf-8"))
    header = "{% comment %} GENERATED from tools/" + label + " by tools/build-sections.py - edit the source, not this file. {% endcomment %}\n"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(header + body, encoding="utf-8")
    print("built", label)

for f in sorted(src.glob("*.liquid")):
    build(f, out / f.name, "src-sections/" + f.name)
home_src = root / "src-home"
home_out = root.parent / "theme" / "home-sections"
for f in sorted(home_src.glob("*.liquid")):
    build(f, home_out / f.stem / "template.liquid", "src-home/" + f.name)
