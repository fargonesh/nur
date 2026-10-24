# initx: CLI scaffolding utility for initializing new projects from templates.
# Source: https://github.com/tascord/initx (pinned rev below).
{
  lib,
  rustPlatform,
  fetchFromGitHub,
}:

let
  fetch = fetchFromGitHub {
    owner = "tascord";
    repo = "initx";
    rev = "8b8fc946a110b90a84916148cc5dfbe2750d7094";
    hash = "sha256-fIyD2UkHArvi5ezr4670wtNsaMa0cQ5t1csb7raelFg=";
  };
in
rustPlatform.buildRustPackage {
  pname = "initx";
  version = "1.0";

  src = fetch;
  cargoLock.lockFile = "${fetch}/Cargo.lock";

  meta = with lib; {
    description = "CLI scaffolding utility for initializing new software projects from templates";
    homepage = "https://github.com/tascord/initx";
    license = licenses.mit;
    mainProgram = "initx";
  };
}
