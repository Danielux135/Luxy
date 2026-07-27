<#
.SYNOPSIS
    Configura Luxy en este ordenador.

.DESCRIPTION
    Comprueba los requisitos y lanza el asistente interactivo, que pregunta
    el nombre de la maquina, la URL del gateway, los proyectos y sus rutas.

    Las rutas locales se guardan en %APPDATA%\Luxy\config.json,
    NUNCA en el repositorio.

.EXAMPLE
    .\scripts\setup-machine.ps1
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir
Set-Location $repoRoot

Write-Host ''
Write-Host '  Configuracion de Luxy' -ForegroundColor Cyan
Write-Host '  =====================' -ForegroundColor Cyan
Write-Host ''

# --- Requisitos -------------------------------------------------------------
Write-Host '  Comprobando requisitos...'
Write-Host ''

$missing = @()

function Test-Tool {
    param([string]$Name, [string]$VersionArg = '--version', [switch]$Required)

    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if (-not $command) {
        Write-Host ("    {0,-10} no encontrado" -f $Name) -ForegroundColor Yellow
        return $false
    }
    try {
        $version = (& $Name $VersionArg 2>&1 | Select-Object -First 1)
        Write-Host ("    {0,-10} {1}" -f $Name, $version) -ForegroundColor Green
        return $true
    } catch {
        Write-Host ("    {0,-10} presente pero no responde" -f $Name) -ForegroundColor Yellow
        return $false
    }
}

if (-not (Test-Tool -Name 'node')) { $missing += 'node' }
if (-not (Test-Tool -Name 'npm'))  { $missing += 'npm' }
if (-not (Test-Tool -Name 'git'))  { $missing += 'git' }

# estos son opcionales: Luxy funciona sin ellos, con menos proveedores
$hasClaude = Test-Tool -Name 'claude'
$hasCodex  = Test-Tool -Name 'codex'
$null      = Test-Tool -Name 'flutter'

Write-Host ''

if ($missing.Count -gt 0) {
    Write-Host "  Faltan requisitos obligatorios: $($missing -join ', ')" -ForegroundColor Red
    Write-Host '  Node.js: https://nodejs.org'
    Write-Host '  Git:     https://git-scm.com/download/win'
    Write-Host ''
    exit 1
}

if (-not $hasClaude) {
    Write-Host '  Aviso: Claude Code no esta instalado.' -ForegroundColor Yellow
    Write-Host '    npm install -g @anthropic-ai/claude-code'
    Write-Host '    claude    (para iniciar sesion con tu suscripcion)'
    Write-Host ''
}
if (-not $hasCodex) {
    Write-Host '  Aviso: Codex CLI no esta instalado.' -ForegroundColor Yellow
    Write-Host '    npm install -g @openai/codex'
    Write-Host '    codex     (para iniciar sesion con tu cuenta de ChatGPT)'
    Write-Host ''
}

# --- Dependencias y compilacion ---------------------------------------------
if (-not (Test-Path (Join-Path $repoRoot 'node_modules'))) {
    Write-Host '  Instalando dependencias...'
    & npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host '  npm install fallo.' -ForegroundColor Red
        exit 1
    }
    Write-Host ''
}

Write-Host '  Compilando...'
& npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host '  La compilacion fallo.' -ForegroundColor Red
    exit 1
}
Write-Host ''

# --- Claves de las APIs http ------------------------------------------------
$providersEnv = Join-Path $repoRoot '.env.providers'
if (-not (Test-Path $providersEnv)) {
    Write-Host '  No existe .env.providers (claves de DeepSeek, GLM y Qwen).' -ForegroundColor Yellow
    Write-Host '  Es opcional: Claude Code y Codex no lo necesitan.'
    Write-Host '  Para usarlo:  Copy-Item .env.providers.example .env.providers'
    Write-Host ''
}

# --- Asistente --------------------------------------------------------------
& node (Join-Path $repoRoot 'apps\agent\dist\setup\wizard.js')
exit $LASTEXITCODE
