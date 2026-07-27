@ECHO OFF
REM ---------------------------------------------------------------------------
REM Luxy - arranque por doble clic.
REM Mantiene la ventana abierta si ocurre un error fatal, para que se pueda leer.
REM ---------------------------------------------------------------------------
SETLOCAL

TITLE Luxy

REM la raiz del proyecto es la carpeta padre de este script
SET "SCRIPT_DIR=%~dp0"
PUSHD "%SCRIPT_DIR%.." || (
    ECHO No se pudo acceder a la carpeta del proyecto.
    PAUSE
    EXIT /B 1
)

ECHO.
ECHO   Luxy
ECHO   ----
ECHO.

REM --- Node -------------------------------------------------------------------
WHERE node >NUL 2>&1
IF ERRORLEVEL 1 (
    ECHO   Node.js no esta instalado o no esta en el PATH.
    ECHO   Instalalo desde https://nodejs.org ^(version 20 o superior^).
    ECHO.
    POPD
    PAUSE
    EXIT /B 1
)

REM --- Dependencias -----------------------------------------------------------
IF NOT EXIST "node_modules" (
    ECHO   Faltan las dependencias. Instalandolas...
    CALL npm install
    IF ERRORLEVEL 1 (
        ECHO.
        ECHO   npm install fallo.
        ECHO.
        POPD
        PAUSE
        EXIT /B 1
    )
)

REM --- Compilacion ------------------------------------------------------------
IF NOT EXIST "apps\agent\dist\index.js" (
    ECHO   Compilando...
    CALL npm run build
    IF ERRORLEVEL 1 (
        ECHO.
        ECHO   La compilacion fallo.
        ECHO.
        POPD
        PAUSE
        EXIT /B 1
    )
)

REM --- Configuracion ----------------------------------------------------------
IF NOT EXIST "%APPDATA%\Luxy\config.json" (
    ECHO.
    ECHO   Esta maquina todavia no esta configurada.
    ECHO   No existe: %APPDATA%\Luxy\config.json
    ECHO.
    ECHO   Ejecuta primero en una terminal:
    ECHO     npm run setup:machine
    ECHO.
    POPD
    PAUSE
    EXIT /B 1
)

REM --- Arranque ---------------------------------------------------------------
ECHO   Arrancando Luxy. Pulsa Ctrl+C para detenerlo.
ECHO.
node "apps\agent\dist\index.js"
SET "EXIT_CODE=%ERRORLEVEL%"

POPD

IF NOT "%EXIT_CODE%"=="0" (
    ECHO.
    ECHO   Luxy termino con codigo %EXIT_CODE%
    ECHO   Revisa los logs en: %LOCALAPPDATA%\Luxy\logs
    ECHO.
    PAUSE
)

ENDLOCAL
EXIT /B %EXIT_CODE%
