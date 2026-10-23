---
title: Add a package
order: 4
---

# Add a package

```sh
mkdir -p pkgs/<name>
$EDITOR pkgs/<name>/default.nix
```

```nix
# pkgs/<name>/default.nix
{ lib, stdenv }:

stdenv.mkDerivation {
  pname = "<name>";
  version = "0.1.0";
  src = ./.;
  installPhase = ''
    mkdir -p $out/bin
    cp <name> $out/bin/    # or wherever the build output lands
  '';
  meta = {
    description = "<name>";
    license = lib.licenses.mit;
    platforms = lib.platforms.unix;
  };
}
```

`pkgs/default.nix` auto-discovers every directory under `pkgs/` and calls it
with `pkgs.callPackage`, so a new `default.nix` shows up in the UI search and as
`nix build .#<name>` with no registration step. Commit and push.
