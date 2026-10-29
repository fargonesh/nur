# fargone-nur

An alternative nixpkgs overlay (NUR) with a web browser, an SSH-pushable git
server, per-push binary builds and a binary cache. Live at
**https://nur.fargone.sh**.

## Live

| what | url |
|---|---|
| browse packages + repos | https://nur.fargone.sh |
| docs (in the app) | https://nur.fargone.sh/#/docs |
| clone (http) | https://nur.fargone.sh/git/fargone-nur.git |
| anonymous fetch | `git://nur.fargone.sh/fargone-nur` (port 9418) |
| push (ssh only) | `ssh://nur@nur.fargone.sh/var/lib/nur/repos/fargone-nur.git` |
| binary cache | `https://nur.fargone.sh/attic` (bucket `packages`) |
| aggregate overlay | `git+https://nur.fargone.sh/git/registry.git` |

## Publish and install

One repo is one package: `floras-package.git` is installable as
`git+https://nur.fargone.sh/git/floras-package.git#floras-package`. Sign in,
create the repo under Repositories, push over SSH — the `post-receive` hook
queues a build, five docker workers compile every flake output into Attic, and
the aggregate `registry.git` flake pins it for the shared overlay.

```sh
git clone https://nur.fargone.sh/git/floras-package.git
cd floras-package   # write default.nix + flake.nix, see web/src/docs/write-a-package.md
git remote set-url --push origin ssh://nur@nur.fargone.sh/var/lib/nur/repos/floras-package.git
git push origin main
```

```nix
# fast path: overlay + cache
inputs.nur-registry.url = "git+https://nur.fargone.sh/git/registry.git";
nixpkgs.overlays = [ inputs.nur-registry.overlays.default ];
```

```sh
# with the cache configured you download instead of compiling
nix run --extra-substituters https://nur.fargone.sh/attic \
  --extra-trusted-public-keys '<key from the Install dialog>' \
  git+https://nur.fargone.sh/git/floras-package.git#floras-package
```

## Add a package

```sh
./scripts/new-repo.sh floras-package   # validates the name, scaffolds default.nix + flake.nix
```

Names must match `[A-Za-z0-9][A-Za-z0-9_-]{0,63}` and are unique registry-wide;
the UI reads the package options (`version`, `description`, `license`,
`homepage`, `maintainers`, …) straight out of the root nix file. See
`web/src/docs/write-a-package.md` for the full model, including branches
(`?ref=`/`?rev=`) and legacy `pkgs/<name>/` sub-packages.

## Deploy

The live site is the `services.nur` module from this flake, enabled on the
`imflopet` host in the `nixos-config` repo:

```nix
{
  inputs.nur.url = "git+https://nur.fargone.sh/git/fargone-nur.git";

  imports = [ inputs.nur.nixosModules.default ];
  services.nur = {
    enable = true;
    domain = "nur.fargone.sh";
    acmeHost = "fargone.sh";          # wildcard cert provided elsewhere
    port = 9011;
    envFile = "/run/secrets/nur.env"; # SITE_ORIGIN, OAUTH_*, ...
  };
}
```

The module runs the web+git server, the seeder/syncer, the SSH key
materialiser, an anonymous git daemon, a local Attic cache, five docker build
workers and the registry generator; nginx fronts the app and `/attic` behind
the ACME host. State lives in `/var/lib/nur` (`repos/`, `data/`, `builds/`) and
`/var/lib/attic`. See `web/src/docs/deploy-the-registry.md` for all options.

## Run locally

```sh
devenv up                        # git daemon :9418, server :3001, vite :5173
node web/server.js               # serve web/dist + /api + /git on :3001
npm --prefix web run dev         # vite only, proxies /api + /git to :3001
nix build .#nur-web              # production bundle + server
```

New repo (local): `./scripts/new-repo.sh <name>` — it appears in the UI with
zero config.

## Layout

```
flake.nix           flake: packages, overlay, nixosModules.default
overlay.nix         overlay entry
pkgs/<name>/        auto-discovered legacy packages
web/                vite UI + stdlib-only node server (server.js)
web/src/docs/*.md   in-app docs (rendered at #/docs)
scripts/            dev helpers (git daemon, new repo)
devenv.nix          dev shell + processes
```

## Env

Production values are set by the module (or an `envFile`); these are the
defaults used when running `node web/server.js` directly.

| var | default | meaning |
|---|---|---|
| `PORT` | 3001 | web+git server port (module: 9011) |
| `REPOS_DIR` | ./repos | bare repos served |
| `SITE_ORIGIN` | request host | canonical origin in flake refs (`https://nur.fargone.sh` live) |
| `DATA_DIR` | ./data | JSON storage for SSH keys |
| `BUILD_QUEUE_DIR` / `BUILD_RESULTS_DIR` | `../builds/{queue,results}` | builder spool (module: `/var/lib/nur/builds/…`) |
| `HOOK_RUNNER` | unset | `post-receive` enqueue script installed in new repos |
| `CACHE_ENDPOINT` / `CACHE_BUCKET` / `CACHE_PUBLIC_KEY_FILE` | unset | cache advertised at `/api/cache` |
| `OAUTH_ORIGIN` | https://fargone.sh | OAuth provider used by the server to validate tokens |
| `OAUTH_CLIENT_ID` | unset | OAuth client id used by the server token proxy |
| `OAUTH_CLIENT_SECRET` | unset | Server-only OAuth secret; never expose as `VITE_*` |
| `VITE_OAUTH_ORIGIN` | https://fargone.sh | OAuth provider used by the browser login |
| `VITE_OAUTH_CLIENT_ID` | unset | Public OAuth client id for the browser login |
| `VITE_GIT_URL` | same-origin `/git` | clone/push URL shown in the UI |
| `VITE_SITE_ORIGIN` | `location.origin` | display origin in the UI |
