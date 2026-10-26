#!/usr/bin/env python3
"""Builds dist/bazaar-pop-theme.zip with the production upload layout
(sections/, home-sections/, style.css, script.js, schema.json, product-data-schema.json at the zip root).
CLI-only preview files (config.json, theme-data.json) are excluded, per the EasyOrders docs."""
import pathlib, zipfile
root = pathlib.Path(__file__).resolve().parent.parent
theme = root / "theme"
out = root / "dist" / "bazaar-pop-theme.zip"
out.parent.mkdir(exist_ok=True)
EXCLUDE = {"config.json", "theme-data.json"}
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for f in sorted(theme.rglob("*")):
        if f.is_file() and not (f.parent == theme and f.name in EXCLUDE):
            z.write(f, f.relative_to(theme).as_posix())
print(out, out.stat().st_size, "bytes")
