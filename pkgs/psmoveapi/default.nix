# PS Move API: cross-platform library for 6DoF tracking of the PS Move controller.
# Source: https://github.com/thp/psmoveapi (pinned rev below).
{
  lib,
  stdenv,
  fetchFromGitHub,
  cmake,
  pkg-config,
  opencv,
  libv4l,
  bluez,
  dbus,
  systemd,
  libusb1,
  libusb-compat-0_1,
  hidapi,
  glm,
  SDL2,
}:

stdenv.mkDerivation {
  pname = "psmoveapi";
  version = "4.0.12-unstable-2026-01-27";

  src = fetchFromGitHub {
    owner = "thp";
    repo = "psmoveapi";
    # No release since 4.0.12 (2020); pin master for OpenCV 4 support
    # and PSMOVEAPI_VENDORING=OFF (uses nixpkgs hidapi+glm, no submodules).
    rev = "256b6299e6076fe7b113e7277ed67016903f067a";
    hash = "sha256-Fcg56kPtEgecdq1844QZWdRWEK6kQLjTnrMNGxYUqTM=";
  };

  nativeBuildInputs = [
    cmake
    pkg-config
  ];

  buildInputs = [
    opencv
    libv4l
    bluez
    dbus
    systemd # libudev
    libusb1
    libusb-compat-0_1 # sixpair
    hidapi
    glm
    SDL2 # test_navcon example
  ];

  cmakeFlags = [
    # Upstream sets no install RPATH; point the binaries at their own lib dir.
    "-DCMAKE_INSTALL_RPATH=${placeholder "out"}/lib"
    # Upstream defaults to lib64; lib keeps RPATH valid (no lib64->lib move).
    "-DPSMOVEAPI_LIB_DEST=lib"
    (lib.cmakeBool "PSMOVEAPI_VENDORING" false)
    (lib.cmakeBool "PSMOVE_BUILD_TRACKER" true)
    (lib.cmakeBool "PSMOVE_USE_PS3EYE_DRIVER" false)
    (lib.cmakeBool "PSMOVE_BUILD_TESTS" false)
  ];

  # Install udev rules under the store prefix instead of /etc.
  postPatch = ''
    substituteInPlace src/CMakeLists.txt \
      --replace-quiet "DESTINATION /etc/udev/rules.d" "DESTINATION lib/udev/rules.d"
  '';

  meta = with lib; {
    description = "Cross-platform library for 6DoF tracking of the PS Move Motion Controller";
    homepage = "https://github.com/thp/psmoveapi";
    license = licenses.bsd2;
    platforms = platforms.linux;
    mainProgram = "psmove";
  };
}
