# NixForge Electron desktop utility for managing NixOS builds and flake configs.
# Source: https://github.com/tascord/nixforge (pinned rev below).
{
  lib,
  buildNpmPackage,
  fetchFromGitHub,
  python3,
  pkg-config,
  makeWrapper,
  electron,
}:

buildNpmPackage {
  pname = "nixforge";
  version = "0.0.0";

  src = lib.cleanSourceWith {
    src = fetchFromGitHub {
      owner = "tascord";
      repo = "nixforge";
      rev = "e07a2ae6b40103f56c68bec072beb5d0c29b9e9a";
      hash = "sha256-T9C6cZEyVXnAzYK0VLSt+QSis1cGdJOnM+LKyKL/l8I=";
    };
    filter =
      name: type:
      let
        baseName = baseNameOf name;
      in
      !(
        type == "directory"
        && (
          baseName == "node_modules"
          || baseName == ".git"
          || baseName == ".devenv"
          || baseName == ".direnv"
          || baseName == "dist"
          || baseName == "dist-electron"
        )
      )
      && !(baseName == "result");
  };

  npmDepsHash = "sha256-4rDJlmj8scC/U1uAVhvItxeaxJdQcLknu0fnnhfl8aY=";

  nativeBuildInputs = [
    python3
    pkg-config
    makeWrapper
  ];

  ELECTRON_SKIP_BINARY_DOWNLOAD = "1";

  buildPhase = ''
    npm exec vite build
    npm exec tsc
  '';

  installPhase = ''
    mkdir -p $out/lib/nixforge
    cp -r . $out/lib/nixforge

    mkdir -p $out/bin
    makeWrapper ${electron}/bin/electron $out/bin/nixforge \
      --add-flags "$out/lib/nixforge/dist-electron/main.js" \
      --set ELECTRON_OVERRIDE_DIST_PATH "${electron}/bin"

    mkdir -p $out/share/applications
    cp nixforge.desktop $out/share/applications/
  '';

  meta = with lib; {
    description = "Graphical Electron desktop utility for managing NixOS builds and flake configurations";
    homepage = "https://github.com/tascord/nixforge";
    mainProgram = "nixforge";
  };
}
