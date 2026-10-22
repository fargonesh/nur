#!/usr/bin/env bash
# Usage: ./scripts/new-repo.sh <name>  — creates pushable bare repo served by git daemon + ssh
# ponytail: no auth/ACL layer, add gitolite/forgejo when untrusted pushers arrive
set -euo pipefail
name="${1:?usage: $0 <name>}"
root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
dir="$root/repos/$name.git"
git init --bare -b main "$dir"
touch "$dir/git-daemon-export-ok"
git -C "$dir" config http.receivepack true
echo "created $dir"
echo "push:   git remote add origin git://localhost:9418/$name ; git push origin main   (anon demo)"
echo "push:   git remote add origin $dir                                              (local)"
echo "push:   git remote add origin git+ssh://\$USER@\$HOST$dir                       (ssh, needs sshd)"
echo "nix:    git+file://$dir  |  git://localhost:9418/$name"
