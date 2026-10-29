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

          # Fast-forward the seeded fargone-nur mirror from the working copy. Non
          # fast-forward updates are refused so SSH pushes are never clobbered.
          # User repos are never synced — they only change via SSH push.
          syncScript = pkgs.writeShellScript "nur-sync" ''
            set -uo pipefail
            repos=${lib.escapeShellArg reposDir}
            src=${lib.escapeShellArg cfg.sourceRepo}

            [ -d "$src/.git" ] || exit 0
            dir="$repos/fargone-nur.git"
            [ -d "$dir" ] || exit 0
            ${pkgs.git}/bin/git -c safe.directory='*' --git-dir="$dir" fetch --quiet --prune --no-tags "$src" \
              "refs/heads/*:refs/heads/*" || echo "nur-sync: not fast-forwardable, skipping" >&2
          '';

          # Registered SSH keys (web UI) become the nur user's authorized_keys.
          keysScript = pkgs.writeShellScript "nur-keys" ''
            set -euo pipefail
            src=${lib.escapeShellArg "${dataSubDir}/ssh-keys.json"}
            out=${lib.escapeShellArg "${dataDir}/.ssh/authorized_keys"}

            install -d -o nur -g nur -m 0700 "${dataDir}/.ssh"
            tmp=$(mktemp)
            if [ -r "$src" ]; then
              ${pkgs.jq}/bin/jq -r '.[] | "command=\"${gitShell}\",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty \(.type) \(.key)"' "$src" > "$tmp" || true
            fi
            install -o nur -g nur -m 0600 "$tmp" "$out"
            rm -f "$tmp"
          '';

          # Forced command for SSH: only git upload-pack/receive-pack against
          # repos/*.git. Everything else (including shells) is denied.
          gitShell = pkgs.writeShellScript "nur-git-shell" ''
            repos=${lib.escapeShellArg reposDir}
            cmd="''${SSH_ORIGINAL_COMMAND:-}"
            fail() { echo "nur: $1" >&2; exit 1; }
            case "$cmd" in
              "git-upload-pack '"*"'")
                tool=git-upload-pack
                ;;
              "git-receive-pack '"*"'")
                tool=git-receive-pack
                ;;
              *)
                fail "only git upload-pack/receive-pack allowed"
                ;;
            esac
            arg="''${cmd#* }"
            case "$arg" in
              \'*\')
                path=''${arg#\'}
                path=''${path%\'}
                ;;
              *)
                fail "bad path quoting"
                ;;
            esac
            case "$path" in
              *\'*|*\\*|*..*) fail "bad path" ;;
            esac
            case "$path" in
              "$repos"/*.git) ;;
              *) fail "outside $repos" ;;
            esac
            [ -d "$path" ] || fail "no such repo"
            exec "$tool" "$path"
          '';

          buildsDir = "${dataDir}/builds";
          queueDir = "${buildsDir}/queue";
          resultsDir = "${buildsDir}/results";
          claimedDir = "${buildsDir}/claimed";

          # Runs inside each bare repo's post-receive hook (as nur). Enqueues
          # a build job; the docker workers pick it up. Never builds here.
          onPush = pkgs.writeShellScript "nur-on-push" ''
            queue=${lib.escapeShellArg queueDir}
            repo="''${1:?repo}"
            [ "$repo" = registry ] && exit 0
            ${pkgs.coreutils}/bin/mkdir -p "$queue"
            while IFS= read -r line; do
              # shellcheck disable=SC2086
              set -- $line
              old="''${1:-}"; new="''${2:-}"; ref="''${3:-}"
              case "$ref" in
                refs/heads/*) branch="''${ref#refs/heads/}" ;;
                *) continue ;;
              esac
              case "$new" in
                0000000000000000000000000000000000000000) continue ;;
              esac
              case "$branch" in
                "" | *[^A-Za-z0-9._/-]*) continue ;;
              esac
              id="$(${pkgs.coreutils}/bin/date +%s%N)-$$"
              tmp="$queue/.$id.json.tmp"
              ${pkgs.coreutils}/bin/printf '{"repo":"%s","branch":"%s","rev":"%s","pushed_at":%s}\n' \
                "$repo" "$branch" "$new" "$(${pkgs.coreutils}/bin/date +%s)" >"$tmp"
              ${pkgs.coreutils}/bin/mv "$tmp" "$queue/$id.json"
            done
          '';

          # Idempotent repo maintenance: dirs, hook wrappers, receivepack off,
          # registry skeleton. Runs as root every boot before nur-web.
          ensureReposScript = pkgs.writeShellScript "nur-repos" ''
            set -euo pipefail
            repos=${lib.escapeShellArg reposDir}
            queue=${lib.escapeShellArg queueDir}
            results=${lib.escapeShellArg resultsDir}
            claimed=${lib.escapeShellArg claimedDir}
            runner=${lib.escapeShellArg onPush}

            install -d -o nur -g nur -m 0750 "$repos" "$queue"
            install -d -o root -g root -m 0755 "$results" "$claimed"
            if [ ! -d "$repos/registry.git" ]; then
              ${pkgs.git}/bin/git -c safe.directory='*' init --bare --quiet -b main "$repos/registry.git"
            fi
            for d in "$repos"/*.git; do
              [ -d "$d" ] || continue
              name=$(basename "$d" .git)
              case "$name" in
                *\'* | *\\*) echo "nur-repos: skipping odd name $d" >&2; continue ;;
              esac
              ${pkgs.git}/bin/git -c safe.directory='*' -C "$d" config http.receivepack false
              ${pkgs.coreutils}/bin/printf '#!/bin/sh\nexec %s %s\n' "$runner" "'$name'" >"$d/hooks/post-receive"
              ${pkgs.coreutils}/bin/chmod +x "$d/hooks/post-receive"
            done
            chown -R nur:nur "$repos" "$queue"
          '';

          atticStateDir = "/var/lib/attic";
          atticServerToml = "${atticStateDir}/server.toml";

          # Offline setup: server.toml with an embedded JWT secret + worker token.
          # Rewrites server.toml on drift (port/endpoint/retention), preserving
          # the secret; a fresh secret invalidates the worker token, which is
          # then re-minted.
          atticInitScript = pkgs.writeShellScript "nur-attic-init" ''
            set -euo pipefail
            state=${lib.escapeShellArg atticStateDir}
            umask 077
            # StateDirectoryMode applies at creation only; enforce each boot so
            # the nur server can read the published cache key.
            ${pkgs.coreutils}/bin/chmod 0755 "$state"
            old=$(${pkgs.gnugrep}/bin/grep -oE '^token-hs256-secret-base64 = "[^"]+"' "$state/server.toml" 2>/dev/null | ${pkgs.coreutils}/bin/cut -d'"' -f2 || true)
            if [ -n "$old" ]; then
              secret="$old"
            else
              secret=$(${pkgs.openssl}/bin/openssl rand -base64 48)
              ${pkgs.coreutils}/bin/rm -f "$state/worker-token.env"
            fi
            ${pkgs.coreutils}/bin/cat >"$state/server.toml" <<EOF
            listen = "0.0.0.0:${toString cfg.cache.port}"
            api-endpoint = "https://${cfg.domain}/attic/"
            database = { url = "sqlite:///$state/server.db?mode=rwc" }
            storage = { type = "local", path = "$state/storage" }
            chunking = { nar-size-threshold = 65536, min-size = 16384, avg-size = 65536, max-size = 4194304 }
            compression = { type = "zstd" }
            garbage-collection = { interval = "12 hours", default-retention-period = "${cfg.cache.retention}" }
            [jwt.signing]
            token-hs256-secret-base64 = "$secret"
            EOF
            ${pkgs.coreutils}/bin/chmod 600 "$state/server.toml"
            if [ ! -s "$state/worker-token.env" ]; then
              token=$(${pkgs.attic-server}/bin/atticadm -f "$state/server.toml" make-token \
                --sub nur-builder --validity 2y \
                --pull "${cfg.cache.bucket}" --push "${cfg.cache.bucket}" | ${pkgs.coreutils}/bin/tail -n 1)
              ${pkgs.coreutils}/bin/printf 'ATTIC_TOKEN=%s\n' "$token" >"$state/worker-token.env"
              ${pkgs.coreutils}/bin/chmod 600 "$state/worker-token.env"
            fi
          '';

          # Online setup: wait for atticd, create the bucket with a bootstrap
          # push (caches auto-create on first authorized push), save the public key.
          atticReadyScript = pkgs.writeShellScript "nur-attic-ready" ''
            set -euo pipefail
            state=${lib.escapeShellArg atticStateDir}
            port=${toString cfg.cache.port}
            bucket=${lib.escapeShellArg cfg.cache.bucket}
            for _ in $(${pkgs.coreutils}/bin/seq 1 60); do
              ${pkgs.curl}/bin/curl -sf "http://127.0.0.1:$port/" >/dev/null 2>&1 && break
              ${pkgs.coreutils}/bin/sleep 2
            done
            ${pkgs.curl}/bin/curl -sf "http://127.0.0.1:$port/" >/dev/null
            export HOME="$(${pkgs.coreutils}/bin/mktemp -d)"
        admin=$(${pkgs.attic-server}/bin/atticadm -f "$state/server.toml" make-token \
          --sub nur-ready --validity 1h \
          --pull "*" --push "*" --delete "*" --create-cache "*" \
          --configure-cache "*" --configure-cache-retention "*" --destroy-cache "*" | ${pkgs.coreutils}/bin/tail -n 1)
            ${pkgs.attic-client}/bin/attic login local "http://127.0.0.1:$port" "$admin"
            ${pkgs.attic-client}/bin/attic cache create "$bucket" 2>/dev/null || true
            f="$(${pkgs.coreutils}/bin/mktemp)"
            ${pkgs.coreutils}/bin/printf 'nur-attic-bootstrap\n' >"$f"
            p=$(${pkgs.nix}/bin/nix store add-file --name nur-attic-bootstrap "$f")
            ${pkgs.attic-client}/bin/attic push "$bucket" "$p"
            info=$(${pkgs.attic-client}/bin/attic cache info "$bucket" 2>&1 || true)
            key=$(${pkgs.coreutils}/bin/printf '%s\n' "$info" | ${pkgs.gnugrep}/bin/grep -oE '[a-zA-Z0-9_.-]+(-[0-9]+)?:[A-Za-z0-9+/=]+' | ${pkgs.coreutils}/bin/head -n 1 || true)
            [ -n "$key" ] || { echo "nur-attic-ready: no public key in: $info" >&2; exit 1; }
            ${pkgs.coreutils}/bin/install -m 0644 /dev/null "$state/cache-public-key"
            ${pkgs.coreutils}/bin/printf '%s\n' "$key" >"$state/cache-public-key"
          '';

          # Rebuilds the aggregate registry flake (all hosted packages, one
          # overlay, cache nixConfig) and pushes it to registry.git.
          registryGenScript = pkgs.writeShellScript "nur-registry-gen" ''
            set -euo pipefail
            repos=${lib.escapeShellArg reposDir}
            work=${lib.escapeShellArg "${dataDir}/registry-work"}
            api="http://127.0.0.1:${toString cfg.port}/api"
            domain=${lib.escapeShellArg cfg.domain}
            pubkey_file=${lib.escapeShellArg "${atticStateDir}/cache-public-key"}

            [ -d "$work/.git" ] || ${pkgs.git}/bin/git clone --quiet "file://$repos/registry.git" "$work"
            cd "$work"
            valid_repos=$(${pkgs.curl}/bin/curl -sf "$api/packages" | \
              ${pkgs.jq}/bin/jq -r '[.[] | select(.valid != false) | .repo] | unique | .[]')
            {
              ${pkgs.coreutils}/bin/cat <<'EOF'
            {
              description = "nur registry — every hosted package";
              inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
            EOF
              for r in $valid_repos; do
                sha=$(${pkgs.git}/bin/git --git-dir="$repos/$r.git" rev-parse HEAD 2>/dev/null) || continue
                ${pkgs.coreutils}/bin/printf '  inputs."%s".url = "git+https://%s/git/%s.git?rev=%s";\n' \
                  "$r" "$domain" "$r" "$sha"
              done
              ${pkgs.coreutils}/bin/cat <<'EOF'
              outputs = { self, nixpkgs, ... } @ inputs:
                let
                  lib = nixpkgs.lib;
                  systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
                  forAll = lib.genAttrs systems;
                  names = builtins.attrNames (builtins.removeAttrs inputs [ "self" "nixpkgs" ]);
                  # First repo alphabetically wins on duplicate package names (matches /api/packages).
                  mergeFor = system: lib.foldr (n: acc: (inputs.''${n}.packages.''${system} or { }) // acc) { } names;
                in
                {
                  packages = forAll mergeFor;
                  overlays.default = final: prev: mergeFor prev.system;
            EOF
              ${pkgs.coreutils}/bin/printf '      nixConfig = {\n        extra-substituters = [ "https://%s/attic/%s" ];\n' "$domain" "${cfg.cache.bucket}"
              if [ -s "$pubkey_file" ]; then
                ${pkgs.coreutils}/bin/printf '        extra-trusted-public-keys = [ "%s" ];\n' "$(${pkgs.coreutils}/bin/cat "$pubkey_file")"
              fi
              ${pkgs.coreutils}/bin/cat <<'EOF'
              };
                };
            }
            EOF
            } >flake.nix
            ${pkgs.git}/bin/git add -A
            ${pkgs.nix}/bin/nix flake lock
            ${pkgs.git}/bin/git add -A
            if ! ${pkgs.git}/bin/git diff --cached --quiet; then
              ${pkgs.git}/bin/git -c user.name=registry -c user.email=registry@localhost commit -qm registry
              ${pkgs.git}/bin/git push --quiet origin main
            fi
          '';

          # One-shot package build worker, baked into the docker image.
          # Polls the queue spool, builds flake outputs, pushes to Attic.
          workerScript = pkgs.writeShellScriptBin "nur-build-worker" ''
            set -uo pipefail
            SPOOL="''${SPOOL:-/spool}"
            REPOS="''${REPOS:-/repos}"
            BUCKET="''${BUCKET:-packages}"
            TIMEOUT="''${BUILD_TIMEOUT:-1800}"
            NAME="''${WORKER_NAME:-worker}"
            log() { echo "[builder $NAME] $*" >&2; }
            PATH=/bin
            [ -n "''${ATTIC_TOKEN:-}" ] || { log "ATTIC_TOKEN unset"; exit 1; }
            ${pkgs.attic-client}/bin/attic login local "$ATTIC_ENDPOINT" "$ATTIC_TOKEN"
            PUBKEY="$(${pkgs.coreutils}/bin/cat "$PUBKEY_FILE")"
            SYS="$(${pkgs.nix}/bin/nix eval --impure --expr 'builtins.currentSystem' --raw)"
            EXTRA=(--extra-substituters "$ATTIC_ENDPOINT" --extra-trusted-public-keys "$PUBKEY")
            log "up (system $SYS, bucket $BUCKET)"

            result_json() {
              # $1=id $2=repo $3=branch $4=rev $5=status $6=error $7=packages-json $8=started
              ${pkgs.jq}/bin/jq -c -n \
                --arg repo "$2" --arg branch "$3" --arg rev "$4" --arg status "$5" \
                --arg error "$6" --argjson packages "$7" --argjson started "$8" \
                --argjson finished "$(${pkgs.coreutils}/bin/date +%s)" \
                '{repo:$repo,branch:$branch,rev:$rev,status:$status,error:$error,packages:$packages,started_at:$started,finished_at:$finished}'
            }
            save_result() {
              # $1=id $2=json [$3=status $4=repo $5=branch for latest-* refresh]
              tmp="$SPOOL/results/.$1.json.tmp"
              ${pkgs.coreutils}/bin/printf '%s' "$2" >"$tmp"
              ${pkgs.coreutils}/bin/mv "$tmp" "$SPOOL/results/$1.json"
              if [ "''${3:-}" = ok ] && [ -n "''${4:-}" ] && [ -n "''${5:-}" ]; then
                ${pkgs.coreutils}/bin/cp "$SPOOL/results/$1.json" "$SPOOL/results/latest-$4-$5.json"
              fi
              (cd "$SPOOL/results" && ${pkgs.coreutils}/bin/ls -t *.json 2>/dev/null | ${pkgs.coreutils}/bin/tail -n +401 | ${pkgs.findutils}/bin/xargs -r ${pkgs.coreutils}/bin/rm -f --) || true
            }

            handle() {
              job="$1"; id="$2"
              started="$(${pkgs.coreutils}/bin/date +%s)"
              repo=$(${pkgs.jq}/bin/jq -r .repo "$job")
              branch=$(${pkgs.jq}/bin/jq -r .branch "$job")
              rev=$(${pkgs.jq}/bin/jq -r .rev "$job")
              case "$repo" in
                "" | *[^A-Za-z0-9_-]* | registry)
                  save_result "$id" "$(result_json "$id" "$repo" "$branch" "$rev" skipped "bad repo" '{}' "$started")"
                  return
                  ;;
              esac
              # Coalesce: a newer queued job for the same repo+branch wins.
              for f in "$SPOOL"/queue/*.json; do
                [ -e "$f" ] && [ "$f" != "$job" ] || continue
                if [ "$f" -nt "$job" ] && \
                   [ "$(${pkgs.jq}/bin/jq -r .repo "$f")" = "$repo" ] && \
                   [ "$(${pkgs.jq}/bin/jq -r .branch "$f")" = "$branch" ]; then
                  log "$repo/$branch: superseded by newer job, skipping"
                  save_result "$id" "$(result_json "$id" "$repo" "$branch" "$rev" skipped "superseded" '{}' "$started")"
                  return
                fi
              done
              work=$(${pkgs.coreutils}/bin/mktemp -d)
              if ! ${pkgs.coreutils}/bin/timeout 120 ${pkgs.git}/bin/git clone -q --branch "$branch" "file://$REPOS/$repo.git" "$work" 2>"$work.clone.log"; then
                save_result "$id" "$(result_json "$id" "$repo" "$branch" "$rev" failed "clone failed: $(${pkgs.coreutils}/bin/head -c 500 "$work.clone.log")" '{}' "$started")"
                ${pkgs.coreutils}/bin/rm -rf "$work"
                return
              fi
              actual=$(${pkgs.git}/bin/git -C "$work" rev-parse HEAD)
              if [ ! -f "$work/flake.nix" ]; then
                save_result "$id" "$(result_json "$id" "$repo" "$branch" "$actual" skipped "no flake.nix" '{}' "$started")"
                ${pkgs.coreutils}/bin/rm -rf "$work"
                return
              fi
              attrs=$(${pkgs.nix}/bin/nix flake show --json "path:$work" 2>/dev/null | \
                ${pkgs.jq}/bin/jq -r --arg sys "$SYS" '.packages[$sys] // {} | keys[]' | \
                ${pkgs.gnugrep}/bin/grep -E '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$' || true)
              if [ -z "$attrs" ]; then
                save_result "$id" "$(result_json "$id" "$repo" "$branch" "$actual" skipped "no packages for $SYS" '{}' "$started")"
                ${pkgs.coreutils}/bin/rm -rf "$work"
                return
              fi
              pkgs_json='{}'
              overall=ok
              for attr in $attrs; do
                logf=$(${pkgs.coreutils}/bin/mktemp)
                start=$(${pkgs.coreutils}/bin/date +%s)
                log "building $repo#$attr"
                if ${pkgs.coreutils}/bin/timeout "$TIMEOUT" ${pkgs.nix}/bin/nix build \
                    --print-out-paths --no-link "''${EXTRA[@]}" "path:$work#$attr" \
                    >"$logf.paths" 2>"$logf.log"; then
                  # shellcheck disable=SC2207
                  paths=($(${pkgs.coreutils}/bin/cat "$logf.paths"))
                  if [ "''${#paths[@]}" -gt 0 ] && \
                     ${pkgs.attic-client}/bin/attic push "$BUCKET" "''${paths[@]}" >>"$logf.log" 2>&1; then
                    st=ok
                  else
                    st=push-failed; overall=failed
                  fi
                else
                  rc=$?
                  if [ "$rc" -eq 124 ]; then st=timeout; else st=failed; fi
                  overall=failed
                  paths=()
                fi
                dur=$(($(${pkgs.coreutils}/bin/date +%s) - start))
                tail=$(${pkgs.coreutils}/bin/tail -c 20000 "$logf.log")
                pkgs_json=$(${pkgs.jq}/bin/jq -c -n \
                  --argjson pkgs "$pkgs_json" --arg n "$attr" --arg s "$st" --argjson d "$dur" \
                  --arg l "$tail" --argjson p "$(${pkgs.coreutils}/bin/printf '%s\n' "''${paths[@]}" | ${pkgs.jq}/bin/jq -R . | ${pkgs.jq}/bin/jq -s -c .)" \
                  '$pkgs + {($n): {status:$s,duration_s:$d,paths:$p,log_tail:$l}}')
                ${pkgs.coreutils}/bin/rm -f "$logf" "$logf.paths" "$logf.log"
              done
              save_result "$id" "$(result_json "$id" "$repo" "$branch" "$actual" "$overall" "" "$pkgs_json" "$started")" "$overall" "$repo" "$branch"
              ${pkgs.coreutils}/bin/rm -rf "$work"
              log "$repo/$branch: $overall"
            }

            ${pkgs.findutils}/bin/find "$SPOOL/claimed" -mindepth 1 -maxdepth 1 -mmin +120 -exec ${pkgs.coreutils}/bin/rm -rf {} + 2>/dev/null || true
            while true; do
              job=""; id=""
              for f in "$SPOOL"/queue/*.json; do
                [ -e "$f" ] || continue
                id=$(${pkgs.coreutils}/bin/basename "$f" .json)
                if ${pkgs.coreutils}/bin/mkdir "$SPOOL/claimed/$id" 2>/dev/null; then job="$f"; break; fi
              done
              if [ -z "$job" ]; then ${pkgs.coreutils}/bin/sleep 10; continue; fi
              handle "$job" "$id" || true
              ${pkgs.coreutils}/bin/rm -f "$job"
              ${pkgs.coreutils}/bin/rm -rf "$SPOOL/claimed/$id"
            done
          '';

          builderImage = pkgs.dockerTools.buildImage {
            name = "nur-builder";
            tag = "latest";
            copyToRoot = pkgs.buildEnv {
              name = "nur-builder-root";
              paths = [
                workerScript
                pkgs.bash
                pkgs.coreutils
                pkgs.findutils
                pkgs.git
                pkgs.gnugrep
                pkgs.gnused
                pkgs.jq
                pkgs.nix
                pkgs.attic-client
                pkgs.cacert
                pkgs.gnutar
                pkgs.gzip
              ];
              pathsToLink = [ "/bin" ];
            };
            config = {
              WorkingDir = "/work";
              Env = [
                "PATH=/bin"
                "SSL_CERT_FILE=/etc/ssl/certs/ca-bundle.crt"
                "HOME=/root"
              ];
              Cmd = [ "/bin/nur-build-worker" ];
            };
              extraCommands = ''
              mkdir -p root work spool repos etc/nix etc/ssl/certs tmp
              chmod 1777 tmp
              cat > etc/nix/nix.conf <<EOF
              experimental-features = nix-command flakes
              sandbox = false
              build-users-group =
              substituters = https://cache.nixos.org
              trusted-public-keys = cache.nixos.org-1:6NCHdD59X431o0gWypbMrAURkbJ16ZPMQFGspcDShjY=
              EOF
              ln -s ${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt etc/ssl/certs/ca-bundle.crt
              '';
          };
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

            cache = {
              enable = lib.mkOption {
                type = lib.types.bool;
                default = true;
                description = "Run a local Attic binary cache and expose it at /attic";
              };

              port = lib.mkOption {
                type = lib.types.port;
                default = 8483;
                description = "Port the Attic server listens on (localhost + container bridge only; 8080 is taken by stalwart)";
              };

              bucket = lib.mkOption {
                type = lib.types.str;
                default = "packages";
                description = "Attic bucket builders push to";
              };

              retention = lib.mkOption {
                type = lib.types.str;
                default = "3 months";
                description = "Attic garbage-collection retention period";
              };
            };

            builders = {
              enable = lib.mkOption {
                type = lib.types.bool;
                default = true;
                description = "Run Docker builder workers that compile packages into the cache";
              };

              count = lib.mkOption {
                type = lib.types.ints.positive;
                default = 5;
                description = "How many builder containers run (max concurrent builds)";
              };

              memory = lib.mkOption {
                type = lib.types.str;
                default = "4g";
                description = "Docker --memory limit per builder";
              };

              cpus = lib.mkOption {
                type = lib.types.str;
                default = "2";
                description = "Docker --cpus limit per builder";
              };

              buildTimeout = lib.mkOption {
                type = lib.types.ints.positive;
                default = 1800;
                description = "Seconds before a single package build is killed";
              };
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
              after = [ "network.target" "nur-seed.service" "nur-repos.service" ];
              requires = [ "nur-seed.service" "nur-repos.service" ];

              environment = {
                PORT = toString cfg.port;
                REPOS_DIR = reposDir;
                DATA_DIR = dataSubDir;
                SITE_ORIGIN = "https://${cfg.domain}";
                OAUTH_ORIGIN = cfg.oauthOrigin;
                OAUTH_CLIENT_ID = cfg.oauthClientId;
                BUILD_QUEUE_DIR = queueDir;
                BUILD_RESULTS_DIR = resultsDir;
                HOOK_RUNNER = onPush;
                CACHE_ENDPOINT = "https://${cfg.domain}/attic";
                CACHE_BUCKET = cfg.cache.bucket;
                CACHE_PUBLIC_KEY_FILE = "${atticStateDir}/cache-public-key";
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

            # Builders reach Attic over the docker bridge; the host firewall
            # otherwise drops container -> host traffic.
            networking.firewall.interfaces."docker0".allowedTCPPorts = lib.mkIf (cfg.cache.enable && cfg.builders.enable) [
              cfg.cache.port
            ];

            users.users.attic = lib.mkIf (cfg.cache.enable || cfg.builders.enable) {
              isSystemUser = true;
              group = "attic";
              home = atticStateDir;
              description = "fargone-nur binary cache";
            };
            users.groups.attic = lib.mkIf (cfg.cache.enable || cfg.builders.enable) { };

            # Attic binary cache.
            systemd.services.nur-attic-init = lib.mkIf cfg.cache.enable {
              description = "fargone-nur attic credentials (offline)";
              wantedBy = [ "multi-user.target" ];
              before = [ "nur-attic.service" ];
              path = [ pkgs.coreutils pkgs.openssl pkgs.attic-server ];
              serviceConfig = {
                Type = "oneshot";
                RemainAfterExit = true;
                User = "attic";
                Group = "attic";
                StateDirectory = "attic";
                # World-readable so the nur web server can publish the cache key.
                StateDirectoryMode = "0755";
                ExecStart = atticInitScript;
              };
            };

            systemd.services.nur-attic = lib.mkIf cfg.cache.enable {
              description = "fargone-nur attic binary cache server";
              wantedBy = [ "multi-user.target" ];
              after = [ "network.target" "nur-attic-init.service" ];
              requires = [ "nur-attic-init.service" ];
              path = [ pkgs.coreutils ];
              unitConfig.ConditionPathExists = atticServerToml;
              serviceConfig = {
                ExecStart = "${pkgs.attic-server}/bin/atticd -f ${atticServerToml}";
                User = "attic";
                Group = "attic";
                Restart = "always";
                RestartSec = "5s";
                StateDirectory = "attic";
                # World-readable so the nur web server can publish the cache key.
                StateDirectoryMode = "0755";
                CapabilityBoundingSet = "";
                ProtectSystem = "strict";
                ProtectHome = true;
                PrivateTmp = true;
                NoNewPrivileges = true;
              };
            };

            systemd.services.nur-attic-ready = lib.mkIf cfg.cache.enable {
              description = "fargone-nur attic bootstrap (bucket + public key)";
              wantedBy = [ "multi-user.target" ];
              after = [ "nur-attic.service" ];
              path = [
                pkgs.coreutils
                pkgs.curl
                pkgs.gnugrep
                pkgs.nix
                pkgs.attic-server
                pkgs.attic-client
              ];
              serviceConfig = {
                Type = "oneshot";
                RemainAfterExit = true;
                User = "attic";
                Group = "attic";
                StateDirectory = "attic";
                # World-readable so the nur web server can publish the cache key.
                StateDirectoryMode = "0755";
                ExecStart = atticReadyScript;
                Restart = "on-failure";
                RestartSec = "15s";
              };
            };

            # Repo maintenance: dirs, hook wrappers, registry skeleton.
            systemd.services.nur-repos = {
              description = "fargone-nur ensure repos, hooks and build spool";
              wantedBy = [ "multi-user.target" ];
              after = [ "nur-seed.service" ];
              before = [ "nur-web.service" ];
              path = [ pkgs.coreutils pkgs.git ];
              serviceConfig = {
                Type = "oneshot";
                ExecStart = ensureReposScript;
              };
            };

            # Aggregate registry flake, rebuilt whenever build results land.
            systemd.services.nur-registry-gen = {
              description = "fargone-nur rebuild the aggregate registry flake";
              path = [ pkgs.coreutils pkgs.git pkgs.jq pkgs.curl pkgs.nix ];
              serviceConfig = {
                Type = "oneshot";
                User = "nur";
                Group = "nur";
                ExecStart = registryGenScript;
              };
            };

            systemd.paths.nur-registry = {
              description = "fargone-nur watch build results for registry rebuilds";
              wantedBy = [ "multi-user.target" ];
              pathConfig = {
                PathChanged = resultsDir;
                Unit = "nur-registry-gen.service";
              };
            };

            # Docker builder workers.
            virtualisation.oci-containers.backend = lib.mkIf cfg.builders.enable "docker";
            virtualisation.oci-containers.containers = lib.mkIf cfg.builders.enable (
              lib.listToAttrs (map
                (i: {
                  name = "nur-builder-${toString i}";
                  value = {
                    image = "nur-builder:latest";
                    imageFile = builderImage;
                    environment = {
                      SPOOL = "/spool";
                      REPOS = "/repos";
                      BUCKET = cfg.cache.bucket;
                      BUILD_TIMEOUT = toString cfg.builders.buildTimeout;
                      WORKER_NAME = "builder-${toString i}";
                      ATTIC_ENDPOINT = "http://host.containers.internal:${toString cfg.cache.port}";
                      PUBKEY_FILE = "/attic-public-key";
                    };
                    environmentFiles = [ "${atticStateDir}/worker-token.env" ];
                    volumes = [
                      "${buildsDir}:/spool:rw"
                      "${reposDir}:/repos:ro"
                      "${atticStateDir}/cache-public-key:/attic-public-key:ro"
                    ];
                    extraOptions = [
                      "--memory=${cfg.builders.memory}"
                      "--cpus=${cfg.builders.cpus}"
                      "--pids-limit=1024"
                      "--add-host=host.containers.internal:host-gateway"
                    ];
                  };
                })
                (lib.range 1 cfg.builders.count))
            );

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
              locations."~ ^/attic(/.*)$" = lib.mkIf cfg.cache.enable {
                proxyPass = "http://127.0.0.1:${toString cfg.cache.port}$1";
                extraConfig = ''
                  proxy_request_buffering off;
                  client_max_body_size 4g;
                '';
              };
            };
          };
        };
    };
}
