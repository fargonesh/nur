# Loft programming language (compiler/interpreter + LSP).
# Source: https://github.com/fargonesh/loft (pinned rev below).
{
  lib,
  rustPlatform,
  fetchFromGitHub,
  pkg-config,
  openssl,
}:

rustPlatform.buildRustPackage rec {
  pname = "loft";
  version = "0.1.0";

  src = fetchFromGitHub {
    owner = "fargonesh";
    repo = "loft";
    rev = "d2fb4d95eeec1970c2fd2069072725b4c7971161";
    hash = "sha256-bnHuqYoITUDOHP6tgE454L818mhyF3Ap4WJkdfU1+9M=";
  };
  cargoLock.lockFile = "${src}/Cargo.lock";

  nativeBuildInputs = [ pkg-config ];
  buildInputs = [ openssl ];
  cargoBuildFlags = [
    "--bin"
    "loft"
    "--bin"
    "loft-lsp"
  ];

  postInstall = ''
    mkdir -p $out/share/loft
    $out/bin/loft stdlib-doc --output $out/share/loft/stdlib-docs || true
  '';

  meta = with lib; {
    description = "A cozy, interpreted programming language";
    homepage = "https://github.com/fargonesh/loft";
    license = licenses.mit;
    mainProgram = "loft";
  };
}
