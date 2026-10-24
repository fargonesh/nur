# bldhnd CLI client.
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
  pname = "bldhnd";
  version = "0.1.0";

  inherit src;
  cargoLock.lockFile = "${src}/Cargo.lock";

  buildInputs = [
    pkg-config
    openssl
  ];
  cargoBuildFlags = [
    "-p"
    "bldhnd"
  ];
  doCheck = false;

  meta = with lib; {
    description = "Complete Soulseek CLI client";
    homepage = "https://github.com/tascord/bldhnd";
    mainProgram = "bldhnd";
  };
}
