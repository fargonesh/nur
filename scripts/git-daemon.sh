#!/usr/bin/env bash
# Anonymous fetch daemon for ./repos. Pushes go through SSH only.
set -euo pipefail
root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
mkdir -p "$root/repos"
exec git daemon --reuseaddr --verbose --base-path="$root/repos" --export-all --port=9418
