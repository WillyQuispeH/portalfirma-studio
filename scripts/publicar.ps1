# Publica una versión nueva para Windows y Mac.
#   yarn publicar              -> 1.0.0-beta.N siguiente (beta)
#   yarn publicar 1.0.0        -> una versión exacta (por ejemplo, la estable)
# Sube la versión en package.json, hace commit y etiqueta vX, y empuja a GitHub.
# GitHub Actions (.github/workflows/release.yml) compila en Windows y Mac y publica la release;
# las apps instaladas se actualizan solas desde ahí.
param([string]$Version)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
function Run { & $args[0] $args[1..($args.Count - 1)]; if ($LASTEXITCODE) { throw "Falló: $($args -join ' ')" } }

if (git status --porcelain) { throw 'Hay cambios sin commit. Haz commit antes de publicar.' }
if ((git rev-parse --abbrev-ref HEAD) -ne 'main') { throw 'Publica desde la rama main.' }
Run git pull --ff-only

if ($Version) { Run yarn version --new-version $Version --no-git-tag-version }
else { Run yarn version --prerelease --preid beta --no-git-tag-version }
$v = (Get-Content package.json -Raw | ConvertFrom-Json).version

Run git commit -am "Versión $v"
Run git tag -a "v$v" -m "PortalFirma Studio $v"
Run git push --follow-tags

Write-Host ''
Write-Host "Versión $v enviada. GitHub está compilando Windows y Mac (unos 10-15 minutos):" -ForegroundColor Green
Write-Host '  Progreso: https://github.com/WillyQuispeH/portalfirma-studio/actions'
Write-Host '  Release:  https://github.com/WillyQuispeH/portalfirma-studio/releases'
