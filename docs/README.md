# fargone-nur

An alternative nixpkgs overlay (NUR) with a web browser and an SSH-pushable git
server. Live at **https://nur.fargone.sh**.

## Live

| what | url |
|---|---|
| browse packages + repos | https://nur.fargone.sh |
| docs (in the app) | https://nur.fargone.sh/#/docs |
| clone (http) | https://nur.fargone.sh/git/fargone-nur.git |
| anonymous fetch | `git://nur.fargone.sh/fargone-nur` (port 9418) |
| push (ssh only) | `ssh://nur@nur.fargone.sh/var/lib/nur/repos/fargone-nur.git` |

## Push and see it

Pushes are SSH only. Sign in with a Fargone account, add your public key under
Settings, then:

```sh
git clone https://nur.fargone.sh/git/fargone-nur.git
cd fargone-nur
# edit pkgs/<name>/...
git remote set-url --push origin ssh://nur@nur.fargone.sh/var/lib/nur/repos/fargone-nur.git
git push origin main
```

The UI updates on the next request; `nur-sync` also fast-forwards the served
bare repo from the deployment working copy every 15 minutes and refuses
non-fast-forward updates, so pushes are never clobbered.

## Use as a nix source

```nix
# flake.nix
inputs.fargone-nur.url = "git+https://nur.fargone.sh/git/fargone-nur.git";
nixpkgs.overlays = [ inputs.fargone-nur.overlays.default ];
```

```sh
nix run git+https://nur.fargone.sh/git/fargone-nur.git#<name>
# legacy: nix-build -A <name> / nix-env -f . -iA <name>
```

## Add a package

```sh
mkdir -p pkgs/<name>
$EDITOR pkgs/<name>/default.nix   # { lib, stdenv, ... }: stdenv.mkDerivation { pname = "<name>"; ... }
```

`pkgs/default.nix` auto-discovers every directory under `pkgs/`, so a new
`default.nix` shows up in the UI search and as `nix build .#<name>` with no
registration step. Commit and push.

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

The module runs the web+git server, a seeder/syncer for the bare repos, the SSH
key materialiser and an anonymous git daemon, opens port 9418 and fronts the app
with nginx on the ACME host. State lives in `/var/lib/nur` (`repos/` for the
served bare repos, `data/` for registered SSH keys), writable only by the `nur`
user. See `web/src/docs/deployment.md` for all options.

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
flake.nix           packages, overlay, nixosModules.default
overlay.nix         overlay entry
pkgs/<name>/        auto-discovered packages
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
| `OAUTH_ORIGIN` | https://fargone.sh | OAuth provider used by the server to validate tokens |
| `OAUTH_CLIENT_ID` | unset | OAuth client id used by the server token proxy |
| `OAUTH_CLIENT_SECRET` | unset | Server-only OAuth secret; never expose as `VITE_*` |
| `VITE_OAUTH_ORIGIN` | https://fargone.sh | OAuth provider used by the browser login |
| `VITE_OAUTH_CLIENT_ID` | unset | Public OAuth client id for the browser login |
| `VITE_GIT_URL` | same-origin `/git` | clone/push URL shown in the UI |
| `VITE_SITE_ORIGIN` | `location.origin` | display origin in the UI |
