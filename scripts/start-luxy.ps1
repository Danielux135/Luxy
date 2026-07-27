<#
.SYNOPSIS
    Arranca Luxy en este ordenador.

.DESCRIPTION
    Comprueba Node, las dependencias y la configuracion antes de arrancar.
    Si algo falta, lo explica en vez de fallar con un error opaco.

.EXAMPLE
    .\scripts\start-luxy.ps1
#>
[CmdletBinding()]
param(
    # No reconstruye el proyecto antes de arrancar (arranque mas rapido)
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'

# la raiz del proyecto es la carpeta padre de scripts\
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir
Set-Location $repoRoot

Write-Host ''
Write-Host '  Luxy' -ForegroundColor Cyan
Write-Host '  ----' -ForegroundColor Cyan
Write-Host ''

# --- Node -------------------------------------------------------------------
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Host '  Node.js no esta instalado o no esta en el PATH.' -ForegroundColor Red
    Write-Host '  Instalalo desde https://nodejs.org (version 20 o superior).'
    Write-Host ''
    exit 1
}

$nodeVersion = (& node --version).TrimStart('v')
$nodeMajor = [int]($nodeVersion.Split('.')[0])
if ($nodeMajor -lt 20) {
    Write-Host "  Node $nodeVersion es demasiado antiguo. Luxy necesita la version 20 o superior." -ForegroundColor Red
    Write-Host ''
    exit 1
}
Write-Host "  Node: v$nodeVersion"

# --- Dependencias -----------------------------------------------------------
if (-not (Test-Path (Join-Path $repoRoot 'node_modules'))) {
    Write-Host '  Faltan las dependencias. Instalandolas...' -ForegroundColor Yellow
    & npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host '  npm install fallo.' -ForegroundColor Red
        Write-Host ''
        exit 1
    }
}

# --- Compilacion ------------------------------------------------------------
$agentEntry = Join-Path $repoRoot 'apps\agent\dist\index.js'
if (-not $SkipBuild -or -not (Test-Path $agentEntry)) {
    Write-Host '  Compilando...'
    & npm run build
    if ($LASTEXITCODE -ne 0) {
        Write-Host '  La compilacion fallo.' -ForegroundColor Red
        Write-Host ''
        exit 1
    }
}

# --- Configuracion ----------------------------------------------------------
$configPath = Join-Path $env:APPDATA 'Luxy\config.json'
if (-not (Test-Path $configPath)) {
    Write-Host ''
    Write-Host '  Esta maquina todavia no esta configurada.' -ForegroundColor Yellow
    Write-Host "  No existe: $configPath"
    Write-Host ''
    Write-Host '  Ejecuta primero:'
    Write-Host '    npm run setup:machine' -ForegroundColor Cyan
    Write-Host ''
    exit 1
}
Write-Host "  Configuracion: $configPath"
Write-Host ''

# --- Arranque ---------------------------------------------------------------
& node $agentEntry
$exitCode = $LASTEXITCODE

if ($exitCode -ne 0) {
    Write-Host ''
    Write-Host "  Luxy termino con codigo $exitCode" -ForegroundColor Red
    Write-Host "  Revisa los logs en: $env:LOCALAPPDATA\Luxy\logs"
    Write-Host ''
}

exit $exitCode
