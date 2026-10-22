# Legacy NUR entrypoint: nix-build -A hello-nur / nix-env -f . -iA hello-nur
{ pkgs ? import <nixpkgs> { } }:

import ./pkgs { inherit pkgs; }
