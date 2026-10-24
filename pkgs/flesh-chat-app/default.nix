# Flesh chat example app (Vite + Rust).
# Source: https://github.com/tascord/flesh (pinned rev below).
{
  lib,
  nodejs,
  rustPlatform,
  rustfmt,
  fetchFromGitHub,
}:

let
  fetch = fetchFromGitHub {
    owner = "tascord";
    repo = "flesh";
    rev = "7144576962c875929090e507e31604c0e1a0515b";
    hash = "sha256-LeTCnC4ZBKHiHqDrgqABH0Fd1T/9lEJHjPWuGOvKRXM=";
  };
in
rustPlatform.buildRustPackage {
  pname = "demo";
  version = "alpha";

  src = fetch;
  buildAndTestSubdir = "./examples/chat-vite";
  cargoLock.lockFile = "${fetch}/Cargo.lock";

  nativeBuildInputs = [
    nodejs
    rustfmt
  ];

  meta = with lib; {
    description = "Flesh chat example app (Vite + Rust)";
    homepage = "https://github.com/tascord/flesh";
    license = licenses.mit;
    mainProgram = "demo";
  };
}
