# Flesh networking/protocol library.
# Source: https://github.com/tascord/flesh (pinned rev below).
{
  lib,
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
  pname = "flesh";
  version = "alpha";

  src = "${fetch}/crates/flesh";
  cargoLock.lockFile = "${fetch}/crates/flesh/Cargo.lock";

  postInstall = ''
    cp -r $src/statuses.csv $out
  '';
  nativeBuildInputs = [ rustfmt ];

  meta = with lib; {
    description = "Flora's LowRes Extensible Super Highway networking/protocol library";
    homepage = "https://github.com/tascord/flesh";
    license = licenses.mit;
  };
}
