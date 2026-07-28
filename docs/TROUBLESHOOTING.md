# Problemas frecuentes

## La ventana de Luxy sale en blanco

Casi siempre es un fallo del preload: si falla, `window.luxy` queda indefinido y
React revienta al arrancar.

Abre `%LOCALAPPDATA%\Luxy\logs\luxy.log` y, si estás en desarrollo, lanza Electron
con `--enable-logging=stderr` para ver la consola del renderer.

Causa conocida: **el preload no puede importar módulos**. Con `sandbox: true` se
ejecuta como JavaScript plano, así que un `import` de zod lo rompe entero con
`module not found`. Las constantes de canal viven en `src/shared/channels.ts`
precisamente para eso; no las muevas a `ipc.ts`.

## `does not provide an export named 'BrowserWindow'` o `app` es `undefined`

Comprueba `ELECTRON_RUN_AS_NODE` en tu entorno:

```powershell
$env:ELECTRON_RUN_AS_NODE
```

VS Code y otros hosts la exportan. Con ella, `electron.exe` se comporta como Node
puro y `require('electron')` devuelve la **ruta del binario**, no la API. No es un
problema del empaquetado. Lánzalo desde una terminal limpia.

## Claude Code o Codex no aparecen como disponibles

1. Comprueba que estén autenticados: `claude --version` y `codex --version` en una
   terminal tuya.
2. Comprueba que estén habilitados en `config.json` (`providers.claude.enabled`).
3. Mira el log: la detección escribe una línea por herramienta al arrancar.

Si funcionan en tu terminal pero no en Luxy, es probable que sea la resolución de
`node`. Luxy relanza los shims `.cmd` con un `node.exe` real, no con `Luxy.exe`.
Puedes forzarlo:

```powershell
$env:LUXY_NODE_PATH = 'C:\Program Files\nodejs\node.exe'
```

## La CLI dice que falta el token de máquina

Luxy Desktop mueve el `machineToken` de `config.json` a `secrets.enc`, cifrado con
tu cuenta de Windows. **La CLI es Node puro y no puede descifrarlo.**

Para usar la CLI como herramienta de recuperación, pásale el token por entorno:

```powershell
$env:LUXY_MACHINE_TOKEN = '...'
npm start
```

O vuelve a registrar la máquina desde el asistente de Desktop, que escribe ambos.

## «Este equipo no puede cifrar secretos»

`safeStorage` no está disponible para tu cuenta. Luxy **no guarda claves sin
cifrar**: un archivo llamado `secrets.enc` con texto plano dentro sería peor que no
tenerlo.

Suele pasar en sesiones sin perfil de usuario completo (algunos escritorios
remotos, cuentas de servicio). Inicia sesión de forma normal.

## «No se pudieron descifrar los secretos guardados»

`secrets.enc` se cifró con **otra cuenta de Windows**. DPAPI ata el cifrado al
usuario. Borra el archivo y vuelve a introducir las claves:

```powershell
Remove-Item "$env:APPDATA\Luxy\secrets.enc"
```

## Un modelo no responde

**`glm-5.2` y `MiniMax-M3` son lentos, no están caídos.** Tardan entre 2 y 4
minutos por turno. Si tu cliente corta antes, parecen muertos.

**`kat-coder-pro-v2.5` devuelve HTTP 400 en menos de un segundo** con «user is not
allowed to access». Eso no es lentitud: tu cuenta no tiene ese modelo. Revisa tu
plan con el proveedor.

`/transcribe` **no funciona todavía**: el endpoint existe pero el proveedor
devuelve 404. Está documentado como no verificado.

## «No se ejecutan las comprobaciones porque han cambiado archivos…»

No es un error: es la protección funcionando. El modelo modificó un archivo que
decide *qué* se ejecuta (`package.json`, `Makefile`, `vitest.config.ts`…), y
lanzar `npm test` habría ejecutado código suyo.

Revisa el diff. Si el cambio es correcto, lanza las pruebas tú.

## «Esa aprobación ya se usó»

Las aprobaciones valen una vez, para que reenviar un mensaje no repita un push.
Pide una nueva desde Telegram o desde Desktop.

## El push se rechaza

Dos condiciones independientes, y las dos son obligatorias:

1. `allowPush: true` en ese proyecto (por defecto es `false`)
2. la segunda confirmación explícita

El motivo exacto está en `%LOCALAPPDATA%\Luxy\logs\approvals.log`.

## El agente no arranca desde Desktop

Si el log dice «no se encuentra el proceso del agente», falta compilar:

```powershell
npm run build --workspace @luxy/agent
```

En el empaquetado va como recurso en `resources/agent/`, **fuera del `.asar`**:
`utilityProcess.fork()` necesita un archivo real en disco.

## Dónde está todo

| Qué | Dónde |
|---|---|
| Configuración | `%APPDATA%\Luxy\config.json` |
| Secretos cifrados | `%APPDATA%\Luxy\secrets.enc` |
| Registros | `%LOCALAPPDATA%\Luxy\logs\luxy.log` |
| Auditoría de aprobaciones | `%LOCALAPPDATA%\Luxy\logs\approvals.log` |
| Worktrees | `%LOCALAPPDATA%\Luxy\worktrees\` |

Los worktrees **no se borran solos**. Si ocupan demasiado, revisa que no queden
cambios sin guardar y bórralos a mano.
