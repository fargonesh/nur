---
title: Use as a nix source
order: 3
---

# Use as a nix source

```nix
# flake.nix
inputs.fargone-nur.url = "git+http://<host>:3001/git/fargone-nur.git";
```

```sh
nix run git+http://<host>:3001/git/fargone-nur.git#hello-fargone
```
