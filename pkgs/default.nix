# Add a package: create pkgs/<name>/default.nix and it appears automatically.
# Packages may depend on each other (e.g. loft-serve takes loft).
{ pkgs }:

let
  lib = pkgs.lib;
  dirs = builtins.attrNames (lib.filterAttrs (_: v: v == "directory") (builtins.readDir ./.));
  packages = lib.genAttrs dirs (name: lib.callPackageWith (pkgs // packages) ./${name} { });
in
packages
