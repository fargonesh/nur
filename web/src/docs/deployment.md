---
title: Deployment
order: 6
---

# Deployment

https://nur.fargone.sh is this flake's `services.nur` module, enabled on the
`imflopet` host in the `nixos-config` repo.

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

## Units

| unit | role |
|---|---|
| `nur-web` | Node server: UI, `/api`, `/git` (binds `127.0.0.1:9011`) |
| `nur-seed` | clones the working copy into `/var/lib/nur/repos` on first boot |
| `nur-sync` + timer | fast-forwards served repos every 15 min; never rewinds |
| `nur-keys` + `.path` | rewrites `~nur/.ssh/authorized_keys` from `data/ssh-keys.json` |
| `nur-git-daemon` | anonymous `git://` fetch on port 9418 |

nginx serves the ACME host, proxies to `127.0.0.1:9011`, disables request
buffering for packfile uploads and allows 100 MB bodies. Port 9418 is opened in
the firewall only when `gitDaemon.enable` is set.

## Options

| option | default | meaning |
|---|---|---|
| `domain` | `nur.fargone.sh` | public hostname |
| `acmeHost` | `fargone.sh` | `security.acme.certs` entry for TLS |
| `host` | `127.0.0.1` | address the server binds |
| `port` | `9011` | server port |
| `dataDir` | `/var/lib/nur` | repos + data state |
| `sourceRepo` | `/nixos-config/services/nur` | working copy seeded/synced from |
| `oauthOrigin` | `https://fargone.sh` | provider base URL |
| `oauthClientId` | `fg_d238a73623a99a895614dc54` | public client id |
| `envFile` | flake's `.env` if present | server env (OAuth secret) |
| `gitDaemon.enable` | `true` | run the anonymous git daemon |
| `gitDaemon.port` | `9418` | git daemon port |
| `package` | `self.packages.${system}.nur-web` | server package |

Redeploy after changing this repo:

```sh
nix flake lock --update-input nur && sudo nixos-rebuild switch --flake .#imflopet
```
