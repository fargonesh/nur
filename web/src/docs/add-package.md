---
title: Write a package
order: 4
---

# Write a package

A repo becomes a package when its root declares it: a root `default.nix` (or
`package.nix`) with a `pname` equal to the repo name, or a `flake.nix` with a
package output literally named after the repo. The UI reads that file at the
browsed rev and lists every option it understands in the package details:
`version`, `description`, `longDescription`, `license(s)`, `homepage`,
`changelog`, `downloadPage`, `mainProgram`, `maintainers`, `platforms`,
`broken`, `unfree`, plus the source file, branch and commit it was read from.

```nix
# floras-package/default.nix
{ lib, stdenv }:

stdenv.mkDerivation {
  pname = "floras-package"; # must equal the repo name
  version = "0.1.0";
  src = ./.;
  installPhase = ''
    mkdir -p $out/bin
    cp floras-package $out/bin/
  '';
  meta = {
    description = "what this package does";
    longDescription = ''
      Longer text shown in the package details.
    '';
    homepage = "https://example.com";
    changelog = "https://example.com/releases";
    mainProgram = "floras-package";
    license = lib.licenses.mit; # or [ lib.licenses.mit ... ], or "unfree"
    maintainers = [ "you" ]; # handles or "Name <mail>" strings
    platforms = lib.platforms.unix; # or [ "x86_64-linux" ... ]
  };
}
```

```nix
# floras-package/flake.nix (needed for binary-cache builds)
{
  description = "floras-package";
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "aarch64-darwin" ];
      forAll = nixpkgs.lib.genAttrs systems;
    in
    {
      packages = forAll (system: {
        "floras-package" = nixpkgs.legacyPackages.${system}.callPackage ./default.nix { };
        default = self.packages.${system}."floras-package";
      });
    };
}
```

Only flake outputs get built into the cache; a `default.nix` without a
`flake.nix` is still browsable and installable from source. A repo with
neither is listed as a repo with zero packages.

## Legacy sub-packages

A repo can still host several packages under `pkgs/<name>/default.nix` (the
original layout). They install as
`git+https://nur.fargone.sh/git/<repo>.git#<name>` and share the registry with
root packages, so a sub-package name must not collide with any other package
name — collisions are flagged invalid in the registry until renamed.
