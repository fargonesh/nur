# loft-serve: Loft registry, docs, and web service runner.
# Source: https://github.com/fargonesh/loft (pinned rev below).
{
  lib,
  writeShellScriptBin,
  fetchFromGitHub,
  bash,
  coreutils,
  nodejs,
  git,
  pkg-config,
  wasm-pack,
  openssl,
  rustc,
  cargo,
  stdenv,
  gcc,
  binutils,
  loft,
}:

let
  src = fetchFromGitHub {
    owner = "fargonesh";
    repo = "loft";
    rev = "d2fb4d95eeec1970c2fd2069072725b4c7971161";
    hash = "sha256-bnHuqYoITUDOHP6tgE454L818mhyF3Ap4WJkdfU1+9M=";
  };
  runtimeDeps = [
    bash
    coreutils
    nodejs # bundles npm + npx
    git
    pkg-config
    wasm-pack
    openssl
    rustc
    cargo
    stdenv.cc
    gcc
    binutils
  ];
in
writeShellScriptBin "loft-serve" ''
  export PATH="${lib.makeBinPath runtimeDeps}:${loft}/bin:$PATH"
  export LOFT_BIN="${loft}/bin/loft"
  export SHELL="${bash}/bin/bash"
  export CC="cc"

  export PKG_CONFIG_PATH="${openssl.dev}/lib/pkgconfig"
  export OPENSSL_DIR="${openssl.dev}"
  export OPENSSL_LIB_DIR="${openssl.out}/lib"
  export OPENSSL_INCLUDE_DIR="${openssl.dev}/include"

  # Fallback to defaults if env vars aren't set (useful for nix run)
  export GITHUB_CLIENT_ID="''${GITHUB_CLIENT_ID:-}"
  export GITHUB_CLIENT_SECRET="''${GITHUB_CLIENT_SECRET:-}"
  export PUBLIC_URL="''${PUBLIC_URL:-http://localhost:5050}"
  export FRONTEND_URL="''${FRONTEND_URL:-http://localhost:9916}"
  export STORAGE_DIR="''${STORAGE_DIR:-./storage}"
  export JWT_SECRET="''${JWT_SECRET:-dev-secret-only}"
  export BIND_ADDR="''${BIND_ADDR:-127.0.0.1:5050}"

  WORKDIR="''${LOFT_WORKDIR:-/tmp/loft-run}"
  mkdir -p "$WORKDIR"
  cp -af ${src}/. "$WORKDIR/"
  chmod -R u+w "$WORKDIR"
  cd "$WORKDIR"

  if [ -d "src/wasm" ]; then
    (cd src/wasm && wasm-pack build --target web --out-dir ../../www/src/wasm) || echo "WASM build failed"
  fi

  ${loft}/bin/loft stdlib-doc --output www/public/docs/stdlib || echo "Docs failed"

  if [ -d "book/src" ]; then
      mkdir -p www/public/docs
      cp -r book/src/. www/public/docs/
  fi

  (cd registry && cargo run) &
  (cd www && npm install --ignore-scripts && npx vite --host 127.0.0.1 --port 9916 --cors --strictPort --config vite.config.js) &
  wait
''
  // {
    meta = with lib; {
      description = "Loft registry, docs, and web service runner";
      homepage = "https://github.com/fargonesh/loft";
      license = licenses.mit;
      mainProgram = "loft-serve";
    };
  }
