{
  description = "fargone-nur NUR — alternative nixpkgs overlay";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { self, nixpkgs }:
    let
      inherit (nixpkgs) lib;

      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      forAll = lib.genAttrs systems;

      # Public OAuth client (registered at https://fargone.sh) used by the
      # browser login. The id is public by design; the matching secret lives in
      # .env and is only ever read by the server-side token proxy.
      oauthClientId = "fg_d238a73623a99a895614dc54";

      # --- web app: vite build (static UI) + the stdlib-only node server ---
      nurWeb =
        pkgs:
        pkgs.buildNpmPackage {
          pname = "nur-web";
          version = "0.1.0";
          src = lib.cleanSourceWith {
            src = lib.cleanSource ./web;
            filter = path: type:
              let
                base = lib.baseNameOf (toString path);
              in
              base != "node_modules"
              && base != "dist"
              && base != "result";
          };
          npmDepsHash = "sha256-pn4Try7f1b5L2Ky7vv+mYsT2GmrfwqAYAasCUqNTDGQ=";

          nativeBuildInputs = [ pkgs.git ];

          # Baked into the bundle by vite (public values only).
          VITE_OAUTH_CLIENT_ID = oauthClientId;
          VITE_OAUTH_ORIGIN = "https://fargone.sh";

          # The node server is stdlib-only; nothing from node_modules ships.
          installPhase = ''
            runHook preInstall

            mkdir -p $out/share/nur-web
            cp -r dist $out/share/nur-web/dist
            cp server.js $out/share/nur-web/server.js

            mkdir -p $out/bin
            cat > $out/bin/nur-web <<EOF
            #!/bin/sh
            exec ${pkgs.nodejs}/bin/node $out/share/nur-web/server.js "\$@"
            EOF
            chmod +x $out/bin/nur-web

            runHook postInstall
          '';
        };
    in
    {
      packages = forAll (
        system:
        (import ./pkgs {
          pkgs = nixpkgs.legacyPackages.${system};
        })
        // {
          nur-web = nurWeb nixpkgs.legacyPackages.${system};
        }
      );

      overlays.default = import ./overlay.nix;

      # Usage as a nix source:
      #   git+https://nur.fargone.sh/git/fargone-nur.git
      #   git://nur.fargone.sh/fargone-nur                       (anonymous, port 9418)
      #   ssh://nur@nur.fargone.sh/var/lib/nur/repos/fargone-nur.git   (push)
    } // {
      nixosModules.default =
        { config, lib, pkgs, ... }:
        let
          cfg = config.services.nur;

          dataDir = cfg.dataDir;
          reposDir = "${dataDir}/repos";
          dataSubDir = "${dataDir}/data";

          # Bare repos are cloned from the working copy in the config repo and
          # fast-forwarded into the served copies by nur-sync.
          seedScript = pkgs.writeShellScript "nur-seed" ''
            set -euo pipefail
            repos=${lib.escapeShellArg reposDir}
            src=${lib.escapeShellArg cfg.sourceRepo}
            install -d -o nur -g nur -m 0750 "$repos"

            if [ ! -d "$repos/fargone-nur.git" ]; then
              if [ -d "$src/.git" ]; then
                ${pkgs.git}/bin/git -c safe.directory='*' clone --bare --quiet "$src" "$repos/fargone-nur.git"
              else
                ${pkgs.git}/bin/git init --bare --quiet -b main "$repos/fargone-nur.git"
              fi
              ${pkgs.git}/bin/git -C "$repos/fargone-nur.git" config http.receivepack false
              touch "$repos/fargone-nur.git/git-daemon-export-ok"
            fi

            chown -R nur:nur "$repos"
          '';

          # Fast-forward the served bare repos from the working copy. Non
          # fast-forward updates are refused so SSH pushes are never clobbered.
          syncScript = pkgs.writeShellScript "nur-sync" ''
            set -uo pipefail
            repos=${lib.escapeShellArg reposDir}
            src=${lib.escapeShellArg cfg.sourceRepo}

            [ -d "$src/.git" ] || exit 0
            for dir in "$repos"/*.git; do
              [ -d "$dir" ] || continue
              ${pkgs.git}/bin/git -c safe.directory='*' --git-dir="$dir" fetch --quiet --prune --no-tags "$src" \
                "refs/heads/*:refs/heads/*" || echo "nur-sync: $dir not fast-forwardable, skipping" >&2
            done
          '';

          # Registered SSH keys (web UI) become the nur user's authorized_keys.
          keysScript = pkgs.writeShellScript "nur-keys" ''
            set -euo pipefail
            src=${lib.escapeShellArg "${dataSubDir}/ssh-keys.json"}
            out=${lib.escapeShellArg "${dataDir}/.ssh/authorized_keys"}

            install -d -o nur -g nur -m 0700 "${dataDir}/.ssh"
            tmp=$(mktemp)
            if [ -r "$src" ]; then
              ${pkgs.jq}/bin/jq -r '.[] | "\(.type) \(.key)"' "$src" > "$tmp" || true
            fi
            install -o nur -g nur -m 0600 "$tmp" "$out"
            rm -f "$tmp"
          '';
        in
        {
          options.services.nur = {
            enable = lib.mkEnableOption "fargone-nur (NUR web UI + git server)";

            domain = lib.mkOption {
              type = lib.types.str;
              default = "nur.fargone.sh";
              description = "Public domain the web app is served at";
            };

            acmeHost = lib.mkOption {
              type = lib.types.str;
              default = "fargone.sh";
              description = "Name of the security.acme.certs entry providing the certificate";
            };

            host = lib.mkOption {
              type = lib.types.str;
              default = "127.0.0.1";
              description = "Host the web+git server binds to";
            };

            port = lib.mkOption {
              type = lib.types.port;
              default = 9011;
              description = "Port the web+git server listens on";
            };

            dataDir = lib.mkOption {
              type = lib.types.path;
              default = "/var/lib/nur";
              description = "State directory holding the bare repos and the API data";
            };

            sourceRepo = lib.mkOption {
              type = lib.types.path;
              default = "/nixos-config/services/nur";
              description = "Working copy the served bare repos are seeded and synced from";
            };

            oauthOrigin = lib.mkOption {
              type = lib.types.str;
              default = "https://fargone.sh";
              description = "Fargone OAuth provider base URL";
            };

            oauthClientId = lib.mkOption {
              type = lib.types.str;
              default = oauthClientId;
              description = "Public OAuth client id used by the browser login";
            };

            envFile = lib.mkOption {
              type = lib.types.nullOr lib.types.path;
              default =
                if builtins.pathExists (self.outPath + "/.env") then self.outPath + "/.env" else null;
              description = "Environment file with the OAuth client secret";
            };

            gitDaemon = {
              enable = lib.mkOption {
                type = lib.types.bool;
                default = true;
                description = "Serve the bare repos over the anonymous git:// protocol";
              };

              port = lib.mkOption {
                type = lib.types.port;
                default = 9418;
                description = "Port the git daemon listens on";
              };
            };

            package = lib.mkOption {
              type = lib.types.package;
              default = self.packages.${pkgs.stdenv.hostPlatform.system}.nur-web;
              description = "The web+git server package to use";
            };
          };

          config = lib.mkIf cfg.enable {
            users.users.nur = {
              isSystemUser = true;
              group = "nur";
              home = dataDir;
              shell = pkgs.bash;
              description = "fargone-nur git server";
            };
            users.groups.nur = { };

            systemd.services.nur-web = {
              description = "fargone-nur web + git server";
              wantedBy = [ "multi-user.target" ];
              after = [ "network.target" "nur-seed.service" ];
              requires = [ "nur-seed.service" ];

              environment = {
                PORT = toString cfg.port;
                REPOS_DIR = reposDir;
                DATA_DIR = dataSubDir;
                SITE_ORIGIN = "https://${cfg.domain}";
                OAUTH_ORIGIN = cfg.oauthOrigin;
                OAUTH_CLIENT_ID = cfg.oauthClientId;
              };

              path = [
                pkgs.coreutils
                pkgs.git
              ];

              serviceConfig = {
                ExecStart = "${cfg.package}/bin/nur-web";
                EnvironmentFile = lib.mkIf (cfg.envFile != null) "-${cfg.envFile}";
                WorkingDirectory = dataDir;
                User = "nur";
                Group = "nur";
                Restart = "always";
                RestartSec = "5s";
                StateDirectory = "nur";
                StateDirectoryMode = "0750";
                CapabilityBoundingSet = "";
                ProtectSystem = "strict";
                ProtectHome = true;
                PrivateTmp = true;
                NoNewPrivileges = true;
              };
            };

            systemd.services.nur-seed = {
              description = "fargone-nur seed the served bare repos";
              wantedBy = [ "multi-user.target" ];
              before = [ "nur-web.service" ];
              path = [
                pkgs.coreutils
                pkgs.git
              ];
              serviceConfig = {
                Type = "oneshot";
                RemainAfterExit = true;
                ExecStart = seedScript;
              };
            };

            systemd.services.nur-sync = {
              description = "fargone-nur fast-forward the served repos from the working copy";
              wantedBy = [ "multi-user.target" ];
              path = [
                pkgs.coreutils
                pkgs.git
              ];
              serviceConfig = {
                Type = "oneshot";
                ExecStart = syncScript;
              };
            };

            systemd.timers.nur-sync = {
              description = "Periodically sync the served repos";
              wantedBy = [ "timers.target" ];
              timerConfig = {
                OnBootSec = "5min";
                OnUnitActiveSec = "15min";
                Persistent = true;
              };
            };

            systemd.services.nur-keys = {
              description = "fargone-nur regenerate authorized_keys from registered SSH keys";
              wantedBy = [ "multi-user.target" ];
              before = [ "nur-web.service" ];
              path = [
                pkgs.coreutils
                pkgs.jq
              ];
              serviceConfig = {
                Type = "oneshot";
                ExecStart = keysScript;
              };
            };

            systemd.paths.nur-keys = {
              description = "fargone-nur watch the registered SSH keys";
              wantedBy = [ "multi-user.target" ];
              pathConfig = {
                PathChanged = "${dataSubDir}/ssh-keys.json";
                Unit = "nur-keys.service";
              };
            };

            systemd.services.nur-git-daemon = lib.mkIf cfg.gitDaemon.enable {
              description = "fargone-nur anonymous git daemon";
              wantedBy = [ "multi-user.target" ];
              after = [ "network.target" "nur-seed.service" ];
              serviceConfig = {
                ExecStart = "${pkgs.git}/bin/git daemon --reuseaddr --verbose --base-path=${reposDir} --export-all --port=${toString cfg.gitDaemon.port}";
                User = "nur";
                Group = "nur";
                Restart = "always";
                RestartSec = "5s";
                StateDirectory = "nur";
                StateDirectoryMode = "0750";
                CapabilityBoundingSet = "";
                ProtectSystem = "strict";
                ProtectHome = true;
                PrivateTmp = true;
                NoNewPrivileges = true;
              };
            };

            networking.firewall.allowedTCPPorts = lib.mkIf cfg.gitDaemon.enable [
              cfg.gitDaemon.port
            ];

            services.nginx.virtualHosts."${cfg.domain}" = {
              useACMEHost = cfg.acmeHost;
              forceSSL = true;
              locations."/" = {
                proxyPass = "http://${cfg.host}:${toString cfg.port}";
                proxyWebsockets = true;
                extraConfig = ''
                  # git http-backend streams packfiles; don't buffer them.
                  proxy_request_buffering off;
                  client_max_body_size 100m;
                '';
              };
            };
          };
        };
    };
}
