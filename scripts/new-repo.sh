#!/usr/bin/env bash
# Usage: ./scripts/new-repo.sh <name> [--bare] — creates a package repo served by git daemon + ssh.
# The repo name IS the package name, so it must be unique and flake-fragment safe.
# Without --bare, scaffolds a root default.nix + flake.nix exposing <name>.
# ponytail: no auth/ACL layer, add gitolite/forgejo when untrusted pushers arrive
set -euo pipefail
name="${1:?usage: $0 <name> [--bare]}"
if [[ ! "$name" =~ ^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$ ]]; then
  echo "error: invalid package name ${name}: use [A-Za-z0-9_-], max 64 chars, no dots" >&2
  echo "dots would parse as nested flake attributes (#a.b means a.b, not \"a.b\")" >&2
  exit 1
fi
root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
dir="$root/repos/$name.git"
if [ -e "$dir" ]; then
  echo "error: $dir already exists — package names must be unique" >&2
  exit 1
fi
git init --bare -b main "$dir"
touch "$dir/git-daemon-export-ok"
git -C "$dir" config http.receivepack false
if [ "${2:-}" = "--bare" ]; then
  echo "created $dir (empty)"
  exit 0
fi
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
git clone -q "$dir" "$tmp/work"
cat > "$tmp/work/default.nix" <<EOF
{ lib, stdenv }:

stdenv.mkDerivation {
  pname = "$name";
  version = "0.1.0";
  src = ./.;
  installPhase = ''
    mkdir -p \$out/bin
    echo '#!/bin/sh' > \$out/bin/$name
    echo 'echo $name' >> \$out/bin/$name
    chmod +x \$out/bin/$name
  '';
  meta = {
    description = "$name";
    mainProgram = "$name";
    license = lib.licenses.mit;
    platforms = lib.platforms.unix;
  };
}
EOF
cat > "$tmp/work/flake.nix" <<EOF
{
  description = "$name";
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forAll = nixpkgs.lib.genAttrs systems;
    in
    {
      packages = forAll (system: {
        "$name" = nixpkgs.legacyPackages.\${system}.callPackage ./default.nix { };
        default = self.packages.\${system}."$name";
      });
    };
}
EOF
cat > "$tmp/work/README.md" <<EOF
# $name
EOF
if command -v nix >/dev/null 2>&1; then
  # Pin nixpkgs so every builder and installer resolves identical inputs
  # (identical inputs = identical store paths = cache hits).
  (cd "$tmp/work" && nix flake lock) || echo "warning: nix flake lock failed, continuing unlocked" >&2
fi
git -C "$tmp/work" -c user.name=nur -c user.email=nur@localhost add -A
git -C "$tmp/work" -c user.name=nur -c user.email=nur@localhost commit -qm init
git -C "$tmp/work" push -q origin main
echo "created $dir with scaffolded package $name"
echo "push:   git remote set-url --push origin ssh://nur@nur.fargone.sh/var/lib/nur/repos/$name.git"
echo "push:   git remote add origin $dir                                   (local)"
echo "browse: https://nur.fargone.sh/#/r/$name"
echo "clone:  https://nur.fargone.sh/git/$name.git"
echo "fetch:  git://nur.fargone.sh/$name                                   (anonymous)"
echo "nix:    git+https://nur.fargone.sh/git/$name.git#$name  |  git+file://$dir#$name"
