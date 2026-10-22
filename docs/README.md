# fargone-nur

Alternative nixpkgs overlay + pushable git server + web browser. Assumes you
know nix flakes and git; no hand-holding below.

## Run

```sh
devenv up        # git daemon :9418, web+git server :3001, vite dev :5173
# or: node web/server.js            (serves web/dist + /api + /git)
# or: npm --prefix web run dev      (vite only, proxies /api + /git to :3001)
```

## Push and see it

```sh
git clone http://<host>:3001/git/fargone-nur.git
cd fargone-nur && <edit pkgs/...> && git push origin main
# browse: http://<host>:3001/#/repos — commits, authors, files update instantly
```

New repo: `./scripts/new-repo.sh <name>` — it appears in the UI with zero config.

## Use as a nix source

```nix
# flake.nix
inputs.fargone-nur.url = "git+http://<host>:3001/git/fargone-nur.git";
nixpkgs.overlays = [ inputs.fargone-nur.overlays.default ];
```

```sh
nix run git+http://<host>:3001/git/fargone-nur.git#hello-fargone
# anonymous git:// : git://<host>:9418/fargone-nur (enable --enable=receive-pack already on)
```

## Add a package

Copy `pkgs/hello-fargone/` to `pkgs/<name>/`, edit `pname`/`meta`, commit, push.
It shows up in `/#/` search and `nix build .#<name>` with no registration step.

## Env

| var | default | meaning |
|---|---|---|
| `PORT` | 3001 | web+git server port |
| `REPOS_DIR` | ./repos | bare repos served |
| `SITE_ORIGIN` | request host | canonical origin in flake refs (set to `https://nix.fargone.sh` in prod) |
| `GIT_ALLOW_ANON_PUSH` | 1 | anonymous push over HTTP; set 0 + auth proxy publicly |
| `VITE_GIT_URL` | same-origin `/git` | clone/push URL shown in UI |
| `VITE_SITE_ORIGIN` | `location.origin` | display origin in UI |
