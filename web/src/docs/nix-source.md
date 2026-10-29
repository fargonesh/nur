---
title: Install packages
order: 3
---

# Install packages

Two paths, same store paths. Binaries vs source is decided purely by whether
your Nix is configured to use the cache — not by which URL you install from.

## The fast path: aggregate overlay + cache

One flake merges every hosted package into a single overlay:

```nix
# flake.nix
inputs.nur-registry.url = "git+https://nur.fargone.sh/git/registry.git";
nixpkgs.overlays = [ inputs.nur-registry.overlays.default ];
```

```sh
nix run .#floras-package
```

The registry flake carries `nixConfig` pointing at the binary cache, so with
`accept-flake-config = true` (or the flags below) you download instead of
compiling. Without cache config the same references compile from source —
nothing is ever binary-only.

## The source path: per-repo flakes

Any hosted repo is its own flake:

```nix
inputs.floras-package.url = "git+https://nur.fargone.sh/git/floras-package.git";
```

```sh
nix run git+https://nur.fargone.sh/git/floras-package.git#floras-package
nix run 'git+https://nur.fargone.sh/git/floras-package.git?ref=dev#floras-package'
nix run 'git+https://nur.fargone.sh/git/floras-package.git?rev=<sha>#floras-package'
```

Add the cache and these become downloads too:

```sh
nix run --extra-substituters https://nur.fargone.sh/attic/packages \
  --extra-trusted-public-keys '<key from the Install dialog>' \
  git+https://nur.fargone.sh/git/floras-package.git#floras-package
```

Persist it in `~/.config/nix/nix.conf`:

```
extra-substituters = https://nur.fargone.sh/attic/packages https://cache.nixos.org
extra-trusted-public-keys = <nur key> cache.nixos.org-1:6NCHdD59X431o0gWypbMrAURkbJ16ZPMQFGspcDShjY=
```

Anonymous fetch also works over `git://nur.fargone.sh/<repo>` (port 9418).
