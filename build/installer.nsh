; Página de bienvenida (asistente con licencia, carpeta de instalación, progreso y fin con «Abrir PortalFirma Studio»)
!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Bienvenido al instalador de PortalFirma Studio ${VERSION}"
  !define MUI_WELCOMEPAGE_TEXT "Este asistente instalará PortalFirma Studio en tu computador.$\r$\n$\r$\nCon PortalFirma Studio puedes crear, editar y preparar documentos PDF, Word, Excel e imágenes; enviarlos a firmar con firma simple o avanzada, y gestionar firmas presenciales ante notario.$\r$\n$\r$\nSi tienes una versión anterior, se reemplazará. Tus documentos, plantillas y configuración se conservan.$\r$\n$\r$\nCierra PortalFirma Studio si está abierto y presiona Siguiente para continuar."
  !insertmacro MUI_PAGE_WELCOME
!macroend
; Registra PortalFirma Studio en "Abrir con" (PDF, Word, Excel e imágenes) sin cambiar el programa predeterminado.
!macro PFAssoc EXT
  WriteRegStr SHCTX "Software\Classes\${EXT}\OpenWithProgids" "PortalFirmaStudio.Documento" ""
  WriteRegStr SHCTX "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" "${EXT}" ""
!macroend
!macro PFUnassoc EXT
  DeleteRegValue SHCTX "Software\Classes\${EXT}\OpenWithProgids" "PortalFirmaStudio.Documento"
!macroend
!macro customInstall
  WriteRegStr SHCTX "Software\Classes\PortalFirmaStudio.Documento" "" "Documento para PortalFirma Studio"
  WriteRegStr SHCTX "Software\Classes\PortalFirmaStudio.Documento\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHCTX "Software\Classes\PortalFirmaStudio.Documento\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
  !insertmacro PFAssoc ".pdf"
  !insertmacro PFAssoc ".docx"
  !insertmacro PFAssoc ".xlsx"
  !insertmacro PFAssoc ".xls"
  !insertmacro PFAssoc ".csv"
  !insertmacro PFAssoc ".png"
  !insertmacro PFAssoc ".jpg"
  !insertmacro PFAssoc ".jpeg"
  WriteRegStr SHCTX "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
  ; versión anterior "Portalfirma"
  DeleteRegKey SHCTX "Software\Classes\Portalfirma.Documento"
  DeleteRegValue SHCTX "Software\Classes\.pdf\OpenWithProgids" "Portalfirma.Documento"
  DeleteRegValue SHCTX "Software\Classes\.docx\OpenWithProgids" "Portalfirma.Documento"
!macroend
!macro customUnInstall
  DeleteRegKey SHCTX "Software\Classes\PortalFirmaStudio.Documento"
  !insertmacro PFUnassoc ".pdf"
  !insertmacro PFUnassoc ".docx"
  !insertmacro PFUnassoc ".xlsx"
  !insertmacro PFUnassoc ".xls"
  !insertmacro PFUnassoc ".csv"
  !insertmacro PFUnassoc ".png"
  !insertmacro PFUnassoc ".jpg"
  !insertmacro PFUnassoc ".jpeg"
  DeleteRegKey SHCTX "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}"
!macroend
