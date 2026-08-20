@echo off
setlocal

cd /d "%~dp0"
title Luxy - reconstruir e iniciar

call "%~dp0rebuild-luxy.bat" no-pause
if errorlevel 1 (
    pause
    exit /b 1
)

call "%~dp0start-luxy.bat"
exit /b %ERRORLEVEL%
