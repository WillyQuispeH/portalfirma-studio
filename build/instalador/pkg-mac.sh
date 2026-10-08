#!/bin/bash
# Instalador para Mac (.pkg) con el asistente de macOS: Bienvenida → Términos y condiciones (Acepto) →
# Destino → Instalar → Resumen. Se arma en Linux con xar y mkbom (bomutils).
# Uso: pkg-mac.sh VERSION "ruta/PortalFirma Studio.app" salida.pkg
set -eo pipefail
V="$1"; APP="$2"; OUT="$3"
D="$(cd "$(dirname "$0")" && pwd)"; T="${PKG_TOOLS:-/home/claude/scratch/pkgtools}"
XAR="$T/inst/bin/xar"; MKBOM="$T/bomutils/build/bin/mkbom"
ID="cl.portalfirma.studio.pkg"
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
python3 "$D/generar.py" "$V" >/dev/null

# 1. Contenido: la app en /Applications (dueño root:admin)
mkdir -p "$W/root/Applications" "$W/flat/base.pkg" "$W/flat/Resources/es.lproj" "$W/scripts"
cp -a "$APP" "$W/root/Applications/"
NF=$(find "$W/root" | wc -l); KB=$(du -sk "$W/root" | cut -f1)
python3 "$D/cpio_odc.py" "$W/root" "$W/flat/base.pkg/Payload"
"$MKBOM" -u 0 -g 80 "$W/root" "$W/flat/base.pkg/Bom"

# 2. Scripts: cierra la app y borra la versión anterior completa (evita archivos sobrantes dentro del paquete)
cat > "$W/scripts/preinstall" <<'SH'
#!/bin/sh
pkill -x "PortalFirma Studio" 2>/dev/null; pkill -x "Portalfirma" 2>/dev/null; sleep 1
rm -rf "/Applications/PortalFirma Studio.app" "/Applications/Portalfirma.app"
exit 0
SH
cat > "$W/scripts/postinstall" <<'SH'
#!/bin/sh
xattr -dr com.apple.quarantine "/Applications/PortalFirma Studio.app" 2>/dev/null
exit 0
SH
chmod 755 "$W/scripts/"*
python3 "$D/cpio_odc.py" "$W/scripts" "$W/flat/base.pkg/Scripts"

cat > "$W/flat/base.pkg/PackageInfo" <<XML
<?xml version="1.0" encoding="utf-8"?>
<pkg-info format-version="2" identifier="$ID" version="$V" install-location="/" auth="root" overwrite-permissions="true">
  <payload installKBytes="$KB" numberOfFiles="$NF"/>
  <scripts><preinstall file="./preinstall"/><postinstall file="./postinstall"/></scripts>
</pkg-info>
XML

# 3. Asistente: textos, términos y fondo (en Resources y en es.lproj)
for f in welcome.html license.html conclusion.html background.png background@2x.png; do
  cp "$D/gen/$f" "$W/flat/Resources/"; cp "$D/gen/$f" "$W/flat/Resources/es.lproj/"
done
cat > "$W/flat/Distribution" <<XML
<?xml version="1.0" encoding="utf-8"?>
<installer-gui-script minSpecVersion="2">
  <title>PortalFirma Studio $V</title>
  <organization>cl.portalfirma</organization>
  <welcome file="welcome.html" mime-type="text/html"/>
  <license file="license.html" mime-type="text/html"/>
  <conclusion file="conclusion.html" mime-type="text/html"/>
  <background file="background.png" alignment="bottomleft" scaling="none" mime-type="image/png"/>
  <background-darkAqua file="background.png" alignment="bottomleft" scaling="none" mime-type="image/png"/>
  <options customize="never" require-scripts="false" hostArchitectures="x86_64,arm64" rootVolumeOnly="true"/>
  <domains enable_anywhere="false" enable_currentUserHome="false" enable_localSystem="true"/>
  <volume-check><allowed-os-versions><os-version min="10.15"/></allowed-os-versions></volume-check>
  <choices-outline><line choice="default"><line choice="$ID"/></line></choices-outline>
  <choice id="default" title="PortalFirma Studio"/>
  <choice id="$ID" visible="false" title="PortalFirma Studio"><pkg-ref id="$ID"/></choice>
  <pkg-ref id="$ID" version="$V" onConclusion="none" installKBytes="$KB">#base.pkg</pkg-ref>
</installer-gui-script>
XML

# 4. Paquete plano (xar)
rm -f "$OUT"
( cd "$W/flat" && "$XAR" --compression none -cf "$OUT" Distribution Resources base.pkg )
ls -la "$OUT"
