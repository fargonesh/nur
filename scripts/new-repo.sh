#!/usr/bin/env bash
# Usage: ./scripts/new-repo.sh <name>  — creates pushable bare repo served by git daemon + ssh
# ponytail: no auth/ACL layer, add gitolite/forgejo when untrusted pushers arrive
set -euo pipefail
name="${1:?usage: $0 <name>}"
root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
dir="$root/repos/$name.git"
git init --bare -b main "$dir"
touch "$dir/git-daemon-export-ok"
git -C "$dir" config http.receivepack false
echo "created $dir"
echo "push:   git remote set-url --push origin ssh://nur@nur.fargone.sh/var/lib/nur/repos/$name.git"
echo "push:   git remote add origin $dir                                   (local)"
echo "browse: https://nur.fargone.sh/#/r/$name"
echo "clone:  https://nur.fargone.sh/git/$name.git"
echo "fetch:  git://nur.fargone.sh/$name                                   (anonymous)"
echo "nix:    git+https://nur.fargone.sh/git/$name.git  |  git+file://$dir"
