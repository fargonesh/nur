---
title: Publish a package
order: 2
---

# Publish a package

One repo is one package: a repo named `floras-package` is the package
`floras-package`. Names must match `[A-Za-z0-9][A-Za-z0-9_-]{0,63}` (no dots —
`#a.b` would parse as a nested flake attribute) and are unique registry-wide.

## Create the repo

Sign in, open **Repositories**, and use the publish form — or push to the name
you want after asking an operator. Either way the name is validated and the
repo starts empty with pushes over SSH only.

## Push and see it

Sign in at https://nur.fargone.sh, add your public key under Settings, then:

```sh
git clone https://nur.fargone.sh/git/floras-package.git
cd floras-package
# write default.nix + flake.nix (see Write a package)
git remote set-url --push origin ssh://nur@nur.fargone.sh/var/lib/nur/repos/floras-package.git
git push origin main
```

Every push runs the repo's `post-receive` hook, which queues a build (see How
builds work). Browse the result at https://nur.fargone.sh/#/repos — commits,
files, package options and build status are read live on each request.

## Branches

Packages render at the branch you browse: viewing `?rev=dev` turns the install
target into `git+https://…/floras-package.git?ref=dev#floras-package`. Exact
commits pin with `?rev=<sha>`. Every pushed branch head gets built; the
aggregate registry (see Install packages) pins each repo at its built head.
