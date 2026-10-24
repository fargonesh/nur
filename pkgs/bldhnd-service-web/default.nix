# bh-service-web: service layer with the HTTP API compiled in (web dashboard backend).
# Source: https://github.com/tascord/bldhnd (pinned rev below).
{
  lib,
  rustPlatform,
  fetchFromGitHub,
  pkg-config,
  openssl,
}:

let
  src = fetchFromGitHub {
    owner = "tascord";
    repo = "bldhnd";
    rev = "c0cd737dec9985a4cb9f55fa3b4f1251701fba5d";
    hash = "sha256-mP7dwHt1XJ8yULpS+qOJIW3lqJblINI2PBireAzXosc=";
  };
in
rustPlatform.buildRustPackage {
  pname = "bh-service-web";
  version = "0.1.0";

  inherit src;
  cargoLock.lockFile = "${src}/Cargo.lock";

  buildInputs = [
    pkg-config
    openssl
  ];
  cargoBuildFlags = [
    "-p"
    "bh-service"
    "--features"
    "bh-service/web"
  ];
  doCheck = false;

  meta = with lib; {
    description = "Service layer with compiled-in HTTP API for web dashboard";
    homepage = "https://github.com/tascord/bldhnd";
    mainProgram = "bh-service";
  };
}
