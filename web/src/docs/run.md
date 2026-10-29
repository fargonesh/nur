---
title: Run it locally
order: 1
---

# Run it locally

The live instance is at **https://nur.fargone.sh**. It serves the built UI, the
JSON API, smart-HTTP git and these docs; `nur-seed` mirrors this repo into
`/var/lib/nur/repos` on boot and `nur-sync` fast-forwards it every 15 minutes.

## Local dev

```sh
devenv up        # git daemon :9418, web+git server :3001, vite :5173
# or: node web/server.js            (serves web/dist + /api + /git)
# or: npm --prefix web run dev      (vite only, proxies /api + /git to :3001)
```

`devenv up` needs nothing but git and nodejs. A local package repo:
`./scripts/new-repo.sh <name>` validates the name and scaffolds a root
`default.nix` + `flake.nix` — it appears in the UI with zero config.

## Production build

```sh
nix build .#nur-web
# result/bin/nur-web with REPOS_DIR, DATA_DIR, PORT, SITE_ORIGIN, OAUTH_* set
```
