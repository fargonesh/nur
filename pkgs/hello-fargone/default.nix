# Template package. Copy this dir to pkgs/<name>/, edit pname/version/meta, done.
{
  lib,
  writeShellScriptBin,
}:

writeShellScriptBin "hello-fargone" ''
  echo "hello from fargone-nur NUR"
''
// {
  meta = with lib; {
    description = "Example package for fargone-nur NUR";
    homepage = "git://localhost:9418/fargone-nur";
    license = licenses.mit;
    platforms = platforms.all;
  };
}
