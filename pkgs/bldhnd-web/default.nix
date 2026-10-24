# bldhnd-web: Next.js operator dashboard (talks to bh-service's HTTP API).
# Source: https://github.com/tascord/bldhnd (pinned rev below).
{
  lib,
  buildNpmPackage,
  fetchFromGitHub,
  nodejs,
  runtimeShell,
}:

let
  src = fetchFromGitHub {
    owner = "tascord";
    repo = "bldhnd";
    rev = "c0cd737dec9985a4cb9f55fa3b4f1251701fba5d";
    hash = "sha256-mP7dwHt1XJ8yULpS+qOJIW3lqJblINI2PBireAzXosc=";
  };
in
buildNpmPackage {
  pname = "bldhnd-web";
  version = "0.1.0";

  src = "${src}/web";
  npmDepsHash = "sha256-VkAMomItROeLjrly41fwQfl/ftjKqjBQtDXMsjQUdM8=";
  makeCacheWritable = true;

  installPhase = ''
    runHook preInstall
    mkdir -p $out/share/bldhnd-web $out/bin
    # Whole standalone tree, including its minimal node_modules.
    cp -r .next/standalone/. $out/share/bldhnd-web/
    mkdir -p $out/share/bldhnd-web/.next
    cp -r .next/static/. $out/share/bldhnd-web/.next/static/
    cp -r public/. $out/share/bldhnd-web/public/
    cat > $out/bin/bldhnd-web <<EOF
    #!${runtimeShell}
    cd $out/share/bldhnd-web
    exec ${lib.getExe nodejs} ./server.js "\$@"
    EOF
    chmod +x $out/bin/bldhnd-web
    runHook postInstall
  '';

  meta = with lib; {
    description = "Next.js operator dashboard for bldhnd";
    homepage = "https://github.com/tascord/bldhnd";
    mainProgram = "bldhnd-web";
  };
}
