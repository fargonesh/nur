# Add a package: copy pkgs/hello-fargone/ to pkgs/<name>/ and it appears automatically.
{ pkgs }:

let
  lib = pkgs.lib;
  dirs = builtins.attrNames (lib.filterAttrs (_: v: v == "directory") (builtins.readDir ./.));
in
lib.genAttrs dirs (name: pkgs.callPackage ./${name} { })
