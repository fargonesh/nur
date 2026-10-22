{
  description = "nixpkgs-ext NUR — alternative nixpkgs overlay";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      forAll = nixpkgs.lib.genAttrs systems;
    in
    {
      packages = forAll (
        system:
        import ./pkgs {
          pkgs = nixpkgs.legacyPackages.${system};
        }
      );

      overlays.default = import ./overlay.nix;

      # nix flake check entrypoint; keep lazy: one system is enough to typecheck
      # Usage as a nix source:
      #   git+file:///home/flora/Projects/nixpkgs-ext
      #   git://localhost:9418/nixpkgs-ext          (git daemon, see scripts/)
      #   git+ssh://user@host/path/repos/nixpkgs-ext.git
    };
}
