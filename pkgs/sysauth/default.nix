# sysauth: minimal GTK4 / Layer Shell Polkit authentication agent popup.
# Source: https://github.com/System64fumo/sysauth (pinned rev below).
# NOTE: the install wrapper below intentionally differs from the bare-metal
# flake (which embeds a literal `$out`): it uses makeWrapper so the store
# path resolves at install time.
{
  lib,
  stdenv,
  fetchFromGitHub,
  makeWrapper,
  git,
  gcc,
  cmake,
  pkg-config,
  gtkmm4,
  gtk4-layer-shell,
  polkit,
}:

stdenv.mkDerivation {
  pname = "sysauth";
  version = "0.1.0";

  src = fetchFromGitHub {
    owner = "System64fumo";
    repo = "sysauth";
    rev = "901c2a28394f406bfbc86e6e72ace876c763d196";
    hash = "sha256-IBKOIgAmu97M7JG4o5UxjtUu1SocVCKubv8/EP5CJOg=";
  };

  buildInputs = [
    git
    gcc
    cmake
    pkg-config
    gtkmm4.dev
    gtk4-layer-shell.dev
    polkit
  ];
  nativeBuildInputs = [ makeWrapper ];

  configurePhase = "true";
  buildPhase = "make";
  installPhase = ''
    mkdir -p $out/bin $out/lib
    cp build/sysauth $out/bin/.sysauth-real
    cp src/libsysauth.so $out/lib/libsysauth.so
    makeWrapper $out/bin/.sysauth-real $out/bin/sysauth \
      --prefix LD_LIBRARY_PATH : "$out/lib"
  '';

  meta = with lib; {
    description = "Minimal GTK4 / Layer Shell Polkit authentication agent popup";
    homepage = "https://github.com/System64fumo/sysauth";
    license = licenses.gpl3Only;
    platforms = platforms.linux;
    mainProgram = "sysauth";
  };
}
