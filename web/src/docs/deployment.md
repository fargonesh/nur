---
title: Deploy the registry
order: 7
---

# Deploy the registry

https://nur.fargone.sh is this flake's `services.nur` module, enabled on the
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

Defaults cover the rest: Attic on port 8080 under `/attic`, five builders at
4 GB / 2 CPUs each with a 30-minute per-package timeout, git daemon on 9418.

## Units

| unit | role |
|---|---|
| `nur-web` | Node server: UI, `/api`, `/git` (binds `127.0.0.1:9011`) |
| `nur-seed` / `nur-sync` + timer | seed + fast-forward the `fargone-nur` mirror (user repos only change via SSH) |
| `nur-repos` | dirs, `post-receive` hooks, receivepack-off, `registry.git` skeleton (every boot) |
| `nur-keys` + `.path` | rewrites `~nur/.ssh/authorized_keys` from `data/ssh-keys.json` with the forced command |
| `nur-git-daemon` | anonymous `git://` fetch on port 9418 |
| `nur-attic` / `nur-attic-init` / `nur-attic-ready` | binary cache server, offline credentials, bucket bootstrap + public key |
| `docker-nur-builder-{1..5}` | build workers (see How builds work) |
| `nur-registry-gen` + `.path` | rebuilds the aggregate flake whenever build results land |

nginx serves the ACME host, proxies `/` to the app and `/attic/*` to Attic
(prefix-stripped), disables request buffering for packfile uploads and allows
4 GB bodies on the cache path. Port 9418 is opened in the firewall only when
`gitDaemon.enable` is set.

## Options

| option | default | meaning |
|---|---|---|
| `domain` | `nur.fargone.sh` | public hostname |
| `acmeHost` | `fargone.sh` | `security.acme.certs` entry for TLS |
| `host` / `port` | `127.0.0.1` / `9011` | address the server binds |
| `dataDir` | `/var/lib/nur` | repos + data + build spool (writable only by `nur`, except results) |
| `sourceRepo` | `/nixos-config/services/nur` | working copy seeded/synced from |
| `oauthOrigin` / `oauthClientId` | `https://fargone.sh` / `fg_…54` | provider + public client |
| `envFile` | flake's `.env` if present | server env (OAuth secret) |
| `gitDaemon.enable` / `.port` | `true` / `9418` | anonymous git daemon |
| `cache.enable` / `.port` / `.bucket` / `.retention` | `true` / `8080` / `packages` / `3 months` | Attic server |
| `builders.enable` / `.count` / `.memory` / `.cpus` / `.buildTimeout` | `true` / `5` / `4g` / `2` / `1800` | docker workers |
| `package` | `self.packages.${system}.nur-web` | server package |

Secrets live in `/var/lib/attic` (`jwt-secret`, `worker-token.env`, both 600)
and are generated on first boot — rotate by deleting them and restarting
`nur-attic-init` + `nur-attic`. The cache public key is published at
`/api/cache` and needs no protection. Scale builders with
`services.nur.builders.count`; an operator kill-switch is
`systemctl stop 'docker-nur-builder-*'`.

Redeploy after changing this repo:

```sh
nix flake lock --update-input nur && sudo nixos-rebuild switch --flake .#imflopet
```
