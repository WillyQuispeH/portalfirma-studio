#!/bin/bash
# Uso: release.sh VERSION   (compila Mac x64 + Windows x64 y empaqueta en out<V>)
set -e
V="$1"; T="${V//./}"; P=/home/claude/portalfirma-desktop; S=/home/claude/scratch; RC=$S/apple-codesign-0.29.0-x86_64-unknown-linux-musl/rcodesign
cd $P
[ -n "$SKIPBUILD" ] || rm -rf dist/mac dist/*.exe dist/*.blockmap dist/win-unpacked
[ -n "$SKIPBUILD" ] || npx electron-builder --mac dir --x64 > /tmp/claude-0/b-mac.log 2>&1
[ -n "$SKIPBUILD" ] || npx electron-builder --win nsis --x64 > /tmp/claude-0/b-win.log 2>&1
APPD="dist/mac/PortalFirma Studio.app"
[ -n "$SKIPBUILD" ] || $RC sign "$APPD" > /tmp/claude-0/sign.log 2>&1
OUT=$S/out$T; rm -rf $OUT; mkdir -p $OUT/Mac $OUT/Windows
( cd dist/mac && tar -cf - "PortalFirma Studio.app" | xz -6 -T0 > $S/PortalFirma-Studio-$V.tar.xz )
split -b 19922944 -d -a 1 $S/PortalFirma-Studio-$V.tar.xz "$OUT/Mac/PortalFirma-Studio-$V.part"
INST=$S/inst$T; rm -rf $INST; cp -r "$S/inst103" $INST
mv "$INST/Instalar PortalFirma Studio 0.10.3.app" "$INST/Instalar PortalFirma Studio $V.app"
sed -i "s/0\.10\.3/$V/g" "$INST/Instalar PortalFirma Studio $V.app/Contents/MacOS/instalar" "$INST/Instalar PortalFirma Studio $V.app/Contents/Info.plist"
true
( cd $INST && zip -qry "$OUT/Mac/Instalar PortalFirma Studio $V.zip" "Instalar PortalFirma Studio $V.app" )
EXE="PortalFirma-Studio-Setup-$V-x64.exe"
split -b 19922944 -d -a 1 "dist/$EXE" "$OUT/Windows/$EXE.part"
N=$(ls $OUT/Windows | wc -l); H=$(sha256sum "dist/$EXE" | cut -d' ' -f1)
JOIN=$(for i in $(seq 0 $((N-1))); do printf '"%s.part%d"+' "$EXE" $i; done); JOIN=${JOIN%+}
sed -e "s/0\.10\.3/$V/g" -e "s/01a5a4c56177c7c9a661f61343848c71b985ecf3864407d9eff9b445a16007e7/$H/" -e "s/(0,1,4)/(0,1,$((N-1)))/" -e "s/las 5 partes/las $N partes/g" $S/out103/Windows/*.bat > "$OUT/Windows/Instalar PortalFirma Studio $V.bat.tmp"
python3 - "$OUT/Windows/Instalar PortalFirma Studio $V.bat.tmp" "$JOIN" <<'PY'
import sys,re
p,j=sys.argv[1],sys.argv[2]; s=open(p).read()
s=re.sub(r'copy /b \S.*? "%OUT%"', lambda m: 'copy /b '+j+' "%OUT%"', s)
open(p[:-4],'w',newline='\r\n').write(s.replace('\r\n','\n'))
PY
rm "$OUT/Windows/Instalar PortalFirma Studio $V.bat.tmp"
cp $P/README.md $OUT/LEEME.md
ls -la $OUT/Mac $OUT/Windows
