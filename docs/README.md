# fargone-nur

Alternative nixpkgs overlay + SSH-pushable git server + web browser. Assumes you
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
cd fargone-nur && <edit pkgs/...> && git remote set-url --push origin git+ssh://USER@HOST/path/repos/fargone-nur.git && git push origin main
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
# anonymous fetch: git://<host>:9418/fargone-nur (pushes are SSH only)
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
| `DATA_DIR` | ./data | JSON storage for SSH keys |
| `OAUTH_ORIGIN` | https://fargone.sh | OAuth provider used by the API to validate bearer tokens |
| `OAUTH_CLIENT_ID` | unset | OAuth client ID used by the server token proxy |
| `OAUTH_CLIENT_SECRET` | unset | Server-only OAuth client secret; never expose as `VITE_*` |
| `VITE_OAUTH_ORIGIN` | https://fargone.sh | OAuth provider used by the browser login |
| `VITE_OAUTH_CLIENT_ID` | unset | Public OAuth client ID for the browser login |
| `VITE_GIT_URL` | same-origin `/git` | clone/push URL shown in UI |
| `VITE_SITE_ORIGIN` | `location.origin` | display origin in UI |
