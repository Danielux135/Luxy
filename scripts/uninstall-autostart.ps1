<#
.SYNOPSIS
    Quita el autoarranque de Luxy del Programador de tareas de Windows.

.DESCRIPTION
    Solo elimina la tarea programada. No borra la configuracion, ni los logs,
    ni los worktrees, ni ningun cambio de codigo.

.PARAMETER TaskName
    Nombre de la tarea. Por defecto "Luxy".

.EXAMPLE
    .\scripts\uninstall-autostart.ps1
#>
[CmdletBinding()]
param(
    [string]$TaskName = 'Luxy'
)

$ErrorActionPreference = 'Stop'

Write-Host ''
Write-Host '  Quitando el autoarranque de Luxy' -ForegroundColor Cyan
Write-Host ''

$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $existing) {
    Write-Host "  No existe ninguna tarea llamada '$TaskName'. No hay nada que quitar."
    Write-Host ''
    exit 0
}

# si esta corriendo se detiene antes de borrarla
if ($existing.State -eq 'Running') {
    Write-Host '  La tarea esta en ejecucion. Deteniendola...'
    Stop-ScheduledTask -TaskName $TaskName
}

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false

Write-Host "  Tarea '$TaskName' eliminada." -ForegroundColor Green
Write-Host ''
Write-Host '  Tu configuracion, logs y worktrees NO se han tocado:'
Write-Host "    Configuracion: $env:APPDATA\Luxy\config.json"
Write-Host "    Logs:          $env:LOCALAPPDATA\Luxy\logs"
Write-Host "    Worktrees:     $env:LOCALAPPDATA\Luxy\worktrees"
Write-Host ''
Write-Host '  Puedes seguir arrancando Luxy a mano con:'
Write-Host '    .\scripts\start-luxy.ps1' -ForegroundColor Cyan
Write-Host ''
