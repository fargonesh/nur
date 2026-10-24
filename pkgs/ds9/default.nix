# SAOImage DS9: astronomical imaging and data visualization application.
# Source: https://github.com/tascord/SAOImageDS9 (pinned rev below).
{
  lib,
  stdenv,
  fetchFromGitHub,
  autoconf,
  automake,
  perl,
  which,
  zip,
  tcl,
  libxml2,
  libxslt,
  zlib,
  libx11,
  libxt,
  libxft,
  libxext,
  libsm,
  libice,
  xorgproto,
}:

let
  deps = [
    autoconf
    automake
    perl # required by OpenSSL's ./config
    which # used by unix/configure to locate xml2-config and xslt-config
    zip
    tcl # provides tclsh for build scripts
    libxml2 # provides xml2-config
    libxslt # provides xslt-config
    zlib
    libx11
    libxt
    libxft
    libxext
    libsm
    libice
    xorgproto
  ];
in
stdenv.mkDerivation {
  pname = "ds9";
  version = "8.7";

  src = fetchFromGitHub {
    owner = "tascord";
    repo = "SAOImageDS9";
    rev = "c39a3acffca7f01496ca0c7deee9a0c9b1372a9b";
    hash = "sha256-BoF4U9yyBhbd0dagFyPyiuQuxmfDh+wqYQ0kYn9S5Y4=";
  };

  nativeBuildInputs = deps;
  buildInputs = deps;

  configurePhase = ''
    runHook preConfigure
    ./unix/configure
    runHook postConfigure
  '';

  buildPhase = ''
    runHook preBuild
    make
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    mkdir -p $out/bin
    cp bin/ds9 $out/bin/
    # install xpa tools if present
    for f in bin/xpa*; do
      [ -f "$f" ] && cp "$f" $out/bin/
    done
    runHook postInstall
  '';

  meta = with lib; {
    description = "Astronomical imaging and data visualization application";
    longDescription = ''
      SAOImage DS9 is an astronomical imaging and data visualization application.
      DS9 supports FITS images and binary tables, multiple frame buffers, region
      manipulation, and numerous scale algorithms and colormaps.
    '';
    homepage = "https://sites.google.com/cfa.harvard.edu/saoimageds9";
    license = licenses.lgpl21Plus;
    platforms = [
      "x86_64-linux"
      "aarch64-linux"
    ];
    mainProgram = "ds9";
  };
}
