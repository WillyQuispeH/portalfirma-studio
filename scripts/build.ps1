# Compila PortalFirma Studio para Windows.
#   yarn instalador   -> solo genera dist\PortalFirma-Studio-Setup-X.exe
#   yarn instalar     -> genera el instalador, lo instala en este equipo y abre la app
#   yarn publicar     -> sube la versión (beta.N), compila y publica en GitHub Releases;
#                        las apps instaladas se actualizan solas. Requiere $env:GH_TOKEN.
param([switch]$Instalar, [switch]$Publicar)
$ErrorActionPreference = 'Stop'
$raiz = Split-Path $PSScriptRoot -Parent
Set-Location $raiz
function Paso($t) { Write-Host "-> $t" -ForegroundColor Cyan }
function Run { & $args[0] $args[1..($args.Count - 1)]; if ($LASTEXITCODE) { throw "Falló: $($args -join ' ')" } }

if ($Publicar) {
  if (-not $env:GH_TOKEN) { throw 'Falta GH_TOKEN. Crea un token en https://github.com/settings/tokens (permiso "repo") y ejecuta: $env:GH_TOKEN="ghp_..."' }
  if (git status --porcelain) { throw 'Hay cambios sin commit. Haz commit antes de publicar.' }
}
if (-not (Test-Path node_modules)) { Paso 'Instalando dependencias...'; Run yarn install }

foreach ($c in 'build\ia\clave.bin', 'build\google\oauth.json', 'build\portalfirma\api.json') {
  if (-not (Test-Path $c)) { Write-Host "   Aviso: falta $c (ver CREDENCIALES.md). Esa función no andará en el instalador." -ForegroundColor Yellow }
}

if ($Publicar) {
  Paso 'Subiendo número de versión...'
  Run yarn version --prerelease --preid beta --no-git-tag-version
  $v = (Get-Content package.json -Raw | ConvertFrom-Json).version
  Run git commit -am "Versión $v"
  Run git tag "v$v"
}
$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
Write-Host "== PortalFirma Studio $version ==" -ForegroundColor Green

Paso 'Generando recursos del instalador...'
python -c "import PIL" 2>$null
if ($LASTEXITCODE) { Run python -m pip install --quiet pillow }
Run python build/instalador/generar.py $version

# electron-builder extrae winCodeSign con enlaces simbólicos de Mac, que Windows no permite sin
# "Modo de desarrollador". Lo dejamos extraído en su caché (los dos archivos de Mac no hacen falta).
$wcs = Join-Path $env:LOCALAPPDATA 'electron-builder\Cache\winCodeSign\winCodeSign-2.6.0'
if (-not (Test-Path "$wcs\rcedit-x64.exe")) {
  Paso 'Preparando winCodeSign (solo la primera vez)...'
  New-Item -ItemType Directory -Force (Split-Path $wcs) | Out-Null
  $7z = "$wcs.7z"
  Invoke-WebRequest 'https://github.com/electron-userland/electron-builder-binaries/releases/download/winCodeSign-2.6.0/winCodeSign-2.6.0.7z' -OutFile $7z -UseBasicParsing
  & "$raiz\node_modules\7zip-bin\win\x64\7za.exe" x -y -bd "-o$wcs" $7z | Out-Null
  Remove-Item $7z
  if (-not (Test-Path "$wcs\rcedit-x64.exe")) { throw 'No se pudo preparar winCodeSign' }
}

Paso 'Compilando instalador...'
if (Test-Path dist) { Remove-Item dist -Recurse -Force }
$pub = if ($Publicar) { 'always' } else { 'never' }
Run yarn electron-builder --win nsis --x64 --publish $pub

$exe = Get-Item "dist\PortalFirma-Studio-Setup-$version.exe"
Write-Host "   Instalador: $($exe.FullName)" -ForegroundColor Green

if ($Publicar) {
  Paso 'Subiendo commit y etiqueta a GitHub...'
  Run git push --follow-tags
  Write-Host "Publicada v$version en https://github.com/WillyQuispeH/portalfirma-studio/releases" -ForegroundColor Green
}

if ($Instalar) {
  Paso 'Cerrando la app si está abierta...'
  Get-Process 'PortalFirma Studio' -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep -Seconds 1
  Paso 'Instalando (silencioso)...'
  Start-Process -FilePath $exe.FullName -ArgumentList '/S' -Wait
  # por usuario (instalación nueva) o en Program Files (si ya había una instalación para todos)
  $app = @("$env:LOCALAPPDATA\Programs\portalfirma-studio", "$env:ProgramFiles\PortalFirma Studio") |
    ForEach-Object { Join-Path $_ 'PortalFirma Studio.exe' } | Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($app) { Paso "Abriendo $app"; Start-Process $app }
  else { Write-Host 'Instalado, pero no encontré la app. Búscala en el menú Inicio.' -ForegroundColor Yellow }
}
