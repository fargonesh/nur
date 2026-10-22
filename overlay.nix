# Usage in your flake.nix:
#   nixpkgs.overlays = [ inputs.fargone-nur.overlays.default ];
# or legacy: pkgs = import <nixpkgs> { overlays = [ (import /path/to/fargone-nur/overlay.nix) ]; };
final: prev: import ./pkgs { pkgs = prev; }
