---
name: abrir-luxy
description: Abre Luxy Studio (la aplicación de escritorio) en este ordenador, reconstruyéndola antes si hace falta. Úsala cuando se pida abrir, arrancar, lanzar, iniciar o ver Luxy, o comprobar un cambio en la aplicación real y no solo en las pruebas. También cubre el modo desarrollo con recarga en caliente para trabajar en la interfaz.
---

# Abrir Luxy

Luxy Studio es una aplicación de Electron. No hay servidor que levantar ni
puerto que abrir: se lanza el binario de Electron apuntando a `apps/desktop`.

## Antes de nada: ¿ya está abierta?

**Esto no es opcional.** Dos instancias comparten `%APPDATA%\Luxy\config.json`,
el almacén de secretos cifrado y los archivos de la bóveda en
`%LOCALAPPDATA%`. Abrir una segunda mientras la primera trabaja puede dejar la
configuración a medias o pisar un archivo de conversación.

```bash
powershell.exe -NoProfile -Command "Get-Process electron -ErrorAction SilentlyContinue | Where-Object MainWindowTitle -eq 'Luxy' | Select-Object Id,MainWindowTitle"
```

- **Devuelve algo** → ya está abierta. **No la arranques otra vez.** Dilo, con
  su PID, y pregunta si quiere que la traiga al frente o que la cierre y la
  vuelva a abrir con los cambios nuevos.
- **No devuelve nada** → sigue.

Para traerla al frente sin reiniciarla:

```bash
powershell.exe -NoProfile -Command "$p = Get-Process electron | Where-Object MainWindowTitle -eq 'Luxy' | Select-Object -First 1; if ($p) { (New-Object -ComObject WScript.Shell).AppActivate($p.Id) }"
```

Para cerrarla, **cierra la ventana**; sólo mata el proceso si no responde, y
avisa antes: con la bóveda abierta hay contenido descifrado en memoria y una
conversación puede estar a mitad de turno.

## Comprobaciones antes de lanzar

Las dos fallan igual de feo si se saltan: la ventana no aparece y no hay error.

```bash
ls node_modules/electron/dist/electron.exe && ls apps/desktop/out/main/index.js
```

| Qué falta | Qué hacer |
| --- | --- |
| `node_modules` | `npm install` (es un clon recién hecho; ver `docs/ARRANQUE-ORDENADOR-NUEVO.md`) |
| `apps/desktop/out/main/index.js` | reconstruir, abajo |

## Reconstruir, y sólo lo que haga falta

`npm run build` construye los cuatro paquetes y tarda. Elige por lo que se ha
tocado:

| Se cambió | Comando |
| --- | --- |
| sólo `apps/desktop` (interfaz, main, preload) | `npm run desktop:build` |
| `packages/shared`, `apps/agent` o varios | `npm run build` |
| nada desde la última vez | no reconstruyas |

`apps/desktop` importa el **`dist` compilado** de `@luxy/agent` y
`@luxy/shared`, no sus fuentes. Si tocaste uno de esos dos y sólo reconstruyes
Desktop, la aplicación arranca con el código viejo y el síntoma es que «el
cambio no ha hecho nada».

## Lanzarla

```bash
powershell.exe -NoProfile -Command '$exe = (Resolve-Path "node_modules/electron/dist/electron.exe").Path; $r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = ([char]34 + $exe + [char]34 + " apps/desktop"); CurrentDirectory = (Get-Location).Path }; "Create: " + $r.ReturnValue + ", PID " + $r.ProcessId'
```

Desde la raíz del repositorio: las rutas se resuelven a partir de ella. Tiene
que devolver `Create: 0`. Después comprueba con la primera orden de esta skill
que la ventana existe.

Lánzala **fuera del árbol de procesos de Claude**, con `Win32_Process.Create`,
que la crea colgando de `WmiPrvSE`. Las otras dos formas la han cerrado con
Daniel dentro:

- **Como tarea de la consola (`run_in_background`):** tiene un tope de tiempo
  y al cumplirse mata a sus hijos. El 05/10 cerró Luxy a los 30 minutos
  exactos, con la bóveda abierta.
- **Con `Start-Process`:** se libra del tope, pero el proceso sigue dentro del
  *job* de Windows de la app de Claude. El 13/10 a las 17:47 la app de Claude
  se colgó, Windows la cerró y Luxy cayó con ella, sin pasar por `lock()`.
  Comprobado con `IsProcessInJob`: lanzada así da `True`; un proceso creado
  con `Win32_Process.Create` da `False`.

El entorno tampoco se hereda: el proceso nace con el del usuario, así que
`ELECTRON_RUN_AS_NODE` no puede colarse. Si la ventana no aparece, mira que
no esté puesta como variable de usuario: con ella, Electron arranca como Node.

**Pendiente de ver con Luxy:** el 13/10 la orden se probó con un proceso
inofensivo, no con la aplicación, porque Daniel la tenía abierta. Si al usarla
la ventana no sale, vuelve a `Start-Process` y apúntalo aquí.

El equivalente que usa Daniel a mano es `start-luxy.bat` en la raíz, y
`rebuild-and-start-luxy.bat` para reconstruir y abrir de una vez. Hacen lo
mismo; desde aquí es preferible el binario directo, porque los `.bat` esperan
con `pause` y se quedan colgados.

## Trabajar en la interfaz: modo desarrollo

Para iterar sobre `Vault.tsx`, `Config.tsx` o cualquier pantalla, con recarga en
caliente y sin reconstruir a cada cambio:

```bash
npm run desktop:dev
```

Compila primero `@luxy/agent` y arranca `electron-vite dev`. También hay que
lanzarlo en segundo plano. No lo uses a la vez que la versión construida: son
dos instancias sobre los mismos archivos, que es justo lo que evita la primera
comprobación de arriba.

## Qué esperar al abrirla, y qué no es un fallo

- **La bóveda arranca cerrada.** La pestaña Privado pide la contraseña; sin ella
  no hay conversaciones ni personajes. Es lo correcto, no un error.
- **El agente puede no estar en marcha.** Se arranca desde la pantalla de
  Inicio. Sin él no hay proveedores y Studio lo dice.
- **Si es un ordenador sin configurar**, la primera pantalla es la de puesta en
  marcha. `%APPDATA%\Luxy\config.json` no está en el repositorio a propósito.

## Si no aparece la ventana

| Síntoma | Causa probable |
| --- | --- |
| el proceso arranca y muere enseguida | falta `out/main/index.js` o está a medio construir: reconstruye |
| arranca y no hay ventana | `ELECTRON_RUN_AS_NODE` puesta en el entorno |
| «no se encontró Electron» | falta `npm install` |
| la ventana sale en blanco | falló la construcción del renderer: mira la salida de `npm run desktop:build` |

Los registros de la aplicación están en `%APPDATA%\Luxy\logs`. Pasan por
`redact()`, así que se pueden leer y pegar sin exponer claves.

## Lo que esta skill no hace

No despliega el gateway, no aplica migraciones y no arranca el agente: eso son
acciones del usuario y están cubiertas por `LOCAL-ACTIONS.md` y
`deploy-gateway.bat`.
