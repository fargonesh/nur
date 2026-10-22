# Legacy NUR entrypoint: nix-build -A hello-fargone / nix-env -f . -iA hello-fargone
{ pkgs ? import <nixpkgs> { } }:

import ./pkgs { inherit pkgs; }
