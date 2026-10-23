---
title: Use as a nix source
order: 3
---

# Use as a nix source

```nix
# flake.nix
inputs.fargone-nur.url = "git+https://nur.fargone.sh/git/fargone-nur.git";
nixpkgs.overlays = [ inputs.fargone-nur.overlays.default ];
```

```sh
nix run git+https://nur.fargone.sh/git/fargone-nur.git#<name>
nix build .#<name>          # inside a checkout
```

Anonymous fetch also works over `git://nur.fargone.sh/fargone-nur` (port 9418).
Add `inputs.nur.nixosModules.default` to deploy the web UI itself; see
[Deployment](#/docs/deployment).
