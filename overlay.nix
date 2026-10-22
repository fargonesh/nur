# Usage in your flake.nix:
#   nixpkgs.overlays = [ inputs.nixpkgs-ext.overlays.default ];
# or legacy: pkgs = import <nixpkgs> { overlays = [ (import /path/to/nixpkgs-ext/overlay.nix) ]; };
final: prev: import ./pkgs { pkgs = prev; }
