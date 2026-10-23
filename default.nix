# Legacy NUR entrypoint: nix-build -A <name> / nix-env -f . -iA <name>
{ pkgs ? import <nixpkgs> { } }:

import ./pkgs { inherit pkgs; }
