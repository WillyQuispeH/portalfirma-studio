#!/bin/bash
# Entrega por un canal limitado a 30 MB: parte el .exe y el .pkg en trozos de 19 MB y agrega «Armar instalador»
# (Windows .bat y Mac .app) que une, verifica SHA-256 y abre el instalador. Uso: entrega.sh VERSION SALIDA
set -eo pipefail
V="$1"; OUT="$2"; P="$(cd "$(dirname "$0")/../.." && pwd)"; D="$P/dist"; TPL="${MAC_TPL:-/home/claude/scratch/join0360/Armar instalador 0.36.0.app}"
EXE="Instalar PortalFirma Studio $V.exe"; PKG="Instalar PortalFirma Studio $V.pkg"
rm -rf "$OUT"; mkdir -p "$OUT/Mac" "$OUT/Windows"
split -b 19922944 -d -a 1 "$D/$EXE" "$OUT/Windows/$EXE.part"; split -b 19922944 -d -a 1 "$D/$PKG" "$OUT/Mac/$PKG.part"
HE=$(sha256sum "$D/$EXE" | cut -d' ' -f1); HP=$(sha256sum "$D/$PKG" | cut -d' ' -f1); NE=$(ls "$OUT/Windows" | wc -l); NP=$(ls "$OUT/Mac" | wc -l)
python3 - "$OUT/Windows/Armar instalador $V.bat" "$V" "$EXE" "$NE" "$HE" <<'PY'
import sys
p,V,EXE,N,H=sys.argv[1:]; N=int(N); J='+'.join(f'"{EXE}.part{i}"' for i in range(N))
s=f'''@echo off
setlocal
title Armar instalador de PortalFirma Studio {V}
cd /d "%~dp0"
echo.
echo  PortalFirma Studio {V} para Windows (64 bits)
echo  ----------------------------------------------
echo  El instalador viene en {N} partes. Este archivo las une y abre el instalador.
for /L %%i in (0,1,{N-1}) do if not exist "{EXE}.part%%i" (
  echo  Falta el archivo {EXE}.part%%i
  echo  Deja las {N} partes en la misma carpeta que este archivo.
  pause
  exit /b 1
)
set "OUT=%~dp0{EXE}"
copy /b {J} "%OUT%" >nul 2>&1
if errorlevel 1 set "OUT=%TEMP%\\{EXE}"
if not exist "%OUT%" copy /b {J} "%OUT%" >nul
if errorlevel 1 (
  echo  No se pudieron unir las partes.
  pause
  exit /b 1
)
echo  Verificando el instalador...
set "HASH="
for /f "skip=1 delims=" %%h in ('certutil -hashfile "%OUT%" SHA256 ^| findstr /v /c:"CertUtil"') do if not defined HASH set "HASH=%%h"
set "HASH=%HASH: =%"
if /i not "%HASH%"=="{H}" (
  echo  El instalador quedo danado. Vuelve a copiar todas las partes.
  del "%OUT%" >nul 2>&1
  pause
  exit /b 1
)
echo  Listo: "{EXE}" quedo en esta carpeta. Abriendo el instalador...
start "" "%OUT%"
exit /b 0
'''
open(p,'w',newline='\r\n').write(s)
PY
W="$(mktemp -d)"; APPN="Armar instalador $V.app"; cp -r "$TPL" "$W/$APPN"
OLD=$(basename "$TPL" .app | sed 's/Armar instalador //')
sed -i "s/$OLD/$V/g" "$W/$APPN/Contents/Info.plist" "$W/$APPN/Contents/MacOS/instalar"
sed -i "s/^VERSION=\"$V\"; N=[0-9]*; SHA=\"[0-9a-f]*\"/VERSION=\"$V\"; N=$NP; SHA=\"$HP\"/" "$W/$APPN/Contents/MacOS/instalar"
grep -q "SHA=\"$HP\"" "$W/$APPN/Contents/MacOS/instalar"
( cd "$W" && zip -qry "$OUT/Mac/Armar instalador $V.zip" "$APPN" ); rm -rf "$W"
cp "$P/README.md" "$OUT/LEEME.md"; ls -R "$OUT"
