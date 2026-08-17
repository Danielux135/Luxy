@echo off
setlocal

cd /d "%~dp0"
title Luxy - reconstruir

echo.
echo   Reconstruyendo Luxy desde esta carpeta...
echo   %CD%
echo.

call npm.cmd run build
if errorlevel 1 (
    echo.
    echo   La reconstruccion fallo. Luxy no se ha iniciado.
    if /i not "%~1"=="no-pause" pause
    exit /b 1
)

echo.
echo   Reconstruccion completada correctamente.
if /i not "%~1"=="no-pause" pause
exit /b 0
