#!/usr/bin/env python3
"""Scan pkgs/*/default.nix for pname/version/description, write web/public/packages.json. Stdlib only."""
import json, re, sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent
pkgs = root / "pkgs"
out = root / "web" / "public" / "packages.json"
out.parent.mkdir(parents=True, exist_ok=True)

items = []
for d in sorted(p for p in pkgs.iterdir() if p.is_dir()):
    f = d / "default.nix"
    if not f.exists():
        continue
    src = f.read_text()
    m = lambda k, default="": (re.search(rf'\b{k}\s*=\s*"([^"]+)"', src) or [None, default])[1]
    # writeShellScriptBin "name" form
    bin_m = re.search(r'writeShellScriptBin\s+"([^"]+)"', src)
    items.append({
        "name": d.name,
        "bin": bin_m.group(1) if bin_m else d.name,
        "description": m("description", ""),
        "homepage": m("homepage", ""),
        "license": (re.search(r'licenses\.([\w-]+)', src) or [None, ""])[1],
        "flake": f"git+file://{root}#{d.name}",
        "overlay": d.name,
    })

out.write_text(json.dumps(items, indent=2) + "\n")
print(f"wrote {out} ({len(items)} packages)")
