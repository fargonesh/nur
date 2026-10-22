#!/usr/bin/env bash
# Anonymous fetch + push daemon for ./repos (demo/LAN). For untrusted nets use ssh only.
# ponytail: --enable=receive-pack allows anon push, drop it when ssh push is enough
set -euo pipefail
root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
mkdir -p "$root/repos"
exec git daemon --reuseaddr --verbose --base-path="$root/repos" --export-all --enable=receive-pack --port=9418
