@echo off
setlocal

cd /d "%~dp0"
title Luxy

set "ELECTRON_RUN_AS_NODE="
set "APP_DIR=%~dp0apps\desktop"
set "ELECTRON_EXE=%~dp0node_modules\electron\dist\electron.exe"

if not exist "%ELECTRON_EXE%" set "ELECTRON_EXE=%USERPROFILE%\Desktop\Luxy\node_modules\electron\dist\electron.exe"

if not exist "%ELECTRON_EXE%" (
    echo.
    echo   No se encontro Electron.
    echo   Ejecuta primero rebuild-luxy.bat.
    pause
    exit /b 1
)

if not exist "%APP_DIR%\out\main\index.js" (
    echo.
    echo   Falta la reconstruccion de Desktop.
    echo   Ejecuta primero rebuild-luxy.bat.
    pause
    exit /b 1
)

echo.
echo   Iniciando Luxy desde:
echo   %APP_DIR%
echo.

start "Luxy" "%ELECTRON_EXE%" "%APP_DIR%"
exit /b 0
