@echo off
setlocal

cd /d "%~dp0"
title Luxy - desplegar Gateway

set "WRANGLER=%~dp0node_modules\.bin\wrangler.cmd"
set "WRANGLER_TEMPLATE=%~dp0apps\gateway\wrangler.toml.example"
set "WRANGLER_CONFIG=%~dp0apps\gateway\.wrangler-manual.toml"
set "DRY_RUN_DIR=%~dp0apps\gateway\.wrangler\manual-dry-run"

if not exist "%WRANGLER%" (
    echo.
    echo   No se encontro Wrangler en este worktree.
    echo   Ejecuta primero npm install desde esta carpeta.
    pause
    exit /b 1
)

if not exist "%WRANGLER_TEMPLATE%" (
    echo.
    echo   No se encontro la configuracion segura del Gateway:
    echo   %WRANGLER_TEMPLATE%
    pause
    exit /b 1
)

echo.
echo   Preparando el Gateway de Luxy desde:
echo   %CD%
echo.
echo   No se aplicaran migraciones ni se modificaran secretos.
echo.

call npm.cmd run build --workspace @luxy/shared
if errorlevel 1 goto :failed

call npm.cmd run build --workspace @luxy/gateway
if errorlevel 1 goto :failed

copy /y "%WRANGLER_TEMPLATE%" "%WRANGLER_CONFIG%" >nul
if errorlevel 1 goto :failed

echo.
echo   Comprobando el paquete sin desplegar...
call "%WRANGLER%" deploy --config "%WRANGLER_CONFIG%" --dry-run --outdir "%DRY_RUN_DIR%"
if errorlevel 1 goto :failed

if /i "%~1"=="check" (
    del /q "%WRANGLER_CONFIG%" >nul 2>nul
    echo.
    echo   Comprobacion terminada. No se ha desplegado nada.
    exit /b 0
)

echo.
echo   ATENCION: el siguiente paso actualiza el Worker luxy-gateway.
echo   Conserva las variables y secretos remotos y no ejecuta migraciones.
echo.
set /p "CONFIRMACION=Escribe DESPLEGAR para continuar: "
if /i not "%CONFIRMACION%"=="DESPLEGAR" (
    del /q "%WRANGLER_CONFIG%" >nul 2>nul
    echo.
    echo   Despliegue cancelado. No se ha cambiado el Gateway.
    pause
    exit /b 2
)

echo.
call "%WRANGLER%" deploy --config "%WRANGLER_CONFIG%" --keep-vars
if errorlevel 1 goto :failed

del /q "%WRANGLER_CONFIG%" >nul 2>nul

echo.
echo   Gateway desplegado correctamente.
echo   Luxy deberia reconectar por si solo en unos segundos.
pause
exit /b 0

:failed
del /q "%WRANGLER_CONFIG%" >nul 2>nul
echo.
echo   La operacion fallo. No ejecutes pruebas hasta revisar el mensaje anterior.
if /i not "%~1"=="check" pause
exit /b 1
