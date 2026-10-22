# Template package. Copy this dir to pkgs/<name>/, edit pname/version/meta, done.
{
  lib,
  writeShellScriptBin,
}:

writeShellScriptBin "hello-nur" ''
  echo "hello from nixpkgs-ext NUR"
''
// {
  meta = with lib; {
    description = "Example package for nixpkgs-ext NUR";
    homepage = "git://localhost:9418/nixpkgs-ext";
    license = licenses.mit;
    platforms = platforms.all;
  };
}
