<#
.SYNOPSIS
    Registra Luxy en el Programador de tareas de Windows.

.DESCRIPTION
    El autoarranque NO se activa durante la instalacion: solo cuando ejecutas
    este script explicitamente.

    Valores por defecto seguros:
      * arranca al iniciar sesion (no requiere permisos de administrador)
      * solo con alimentacion de corriente
      * no arranca una segunda instancia si ya hay una

.PARAMETER Trigger
    Logon   : al iniciar sesion (por defecto, no necesita administrador)
    Startup : al arrancar Windows (necesita ejecutar como administrador)

.PARAMETER OnBattery
    Permite que Luxy tambien arranque y siga con bateria.
    Por defecto NO, para no vaciar la bateria del portatil.

.PARAMETER TaskName
    Nombre de la tarea. Por defecto "Luxy".

.EXAMPLE
    .\scripts\install-autostart.ps1
    Arranca al iniciar sesion, solo con corriente.

.EXAMPLE
    .\scripts\install-autostart.ps1 -OnBattery
    Arranca al iniciar sesion, tambien con bateria.

.EXAMPLE
    .\scripts\install-autostart.ps1 -Trigger Startup
    Arranca con Windows. Requiere una consola de administrador.
#>
[CmdletBinding()]
param(
    [ValidateSet('Logon', 'Startup')]
    [string]$Trigger = 'Logon',

    [switch]$OnBattery,

    [string]$TaskName = 'Luxy'
)

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir

Write-Host ''
Write-Host '  Autoarranque de Luxy' -ForegroundColor Cyan
Write-Host '  --------------------' -ForegroundColor Cyan
Write-Host ''

# --- Comprobaciones previas -------------------------------------------------
$configPath = Join-Path $env:APPDATA 'Luxy\config.json'
if (-not (Test-Path $configPath)) {
    Write-Host '  Esta maquina no esta configurada todavia.' -ForegroundColor Red
    Write-Host '  Ejecuta primero: npm run setup:machine'
    Write-Host ''
    exit 1
}

$agentEntry = Join-Path $repoRoot 'apps\agent\dist\index.js'
if (-not (Test-Path $agentEntry)) {
    Write-Host '  Luxy no esta compilado. Ejecuta: npm run build' -ForegroundColor Red
    Write-Host ''
    exit 1
}

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
    Write-Host '  No se encuentra node en el PATH.' -ForegroundColor Red
    Write-Host ''
    exit 1
}
$nodePath = $nodeCommand.Source

$isAdmin = ([Security.Principal.WindowsPrincipal] `
    [Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if ($Trigger -eq 'Startup' -and -not $isAdmin) {
    Write-Host '  El arranque con Windows necesita una consola de administrador.' -ForegroundColor Red
    Write-Host '  Abre PowerShell como administrador, o usa -Trigger Logon.'
    Write-Host ''
    exit 1
}

# --- Definicion de la tarea -------------------------------------------------
$action = New-ScheduledTaskAction `
    -Execute $nodePath `
    -Argument "`"$agentEntry`"" `
    -WorkingDirectory $repoRoot

if ($Trigger -eq 'Startup') {
    $taskTrigger = New-ScheduledTaskTrigger -AtStartup
    $principal = New-ScheduledTaskPrincipal `
        -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Limited
} else {
    $taskTrigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
    $principal = New-ScheduledTaskPrincipal `
        -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
}

# valores por defecto conservadores
$settingsArgs = @{
    AllowStartIfOnBatteries    = [bool]$OnBattery
    DontStopIfGoingOnBatteries = [bool]$OnBattery
    StartWhenAvailable         = $true
    # Luxy es un proceso de larga duracion: no debe matarse por tiempo
    ExecutionTimeLimit         = [TimeSpan]::Zero
    # si ya hay una instancia, no se lanza otra
    MultipleInstances          = 'IgnoreNew'
    RestartCount               = 3
    RestartInterval            = (New-TimeSpan -Minutes 5)
}
$settings = New-ScheduledTaskSettingsSet @settingsArgs

# --- Registro ---------------------------------------------------------------
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "  Ya existe una tarea llamada '$TaskName'. Se reemplaza." -ForegroundColor Yellow
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $taskTrigger `
    -Principal $principal `
    -Settings $settings `
    -Description 'Luxy - agente personal controlado desde Telegram' | Out-Null

Write-Host "  Tarea '$TaskName' registrada." -ForegroundColor Green
Write-Host ''
Write-Host "    Disparador:  $(if ($Trigger -eq 'Startup') { 'al arrancar Windows' } else { 'al iniciar sesion' })"
Write-Host "    Con bateria: $(if ($OnBattery) { 'si' } else { 'no (solo con corriente)' })"
Write-Host "    Ejecuta:     $nodePath `"$agentEntry`""
Write-Host ''
Write-Host '  Para arrancarla ahora mismo:'
Write-Host "    Start-ScheduledTask -TaskName $TaskName" -ForegroundColor Cyan
Write-Host ''
Write-Host '  Para quitarla:'
Write-Host '    .\scripts\uninstall-autostart.ps1' -ForegroundColor Cyan
Write-Host ''
