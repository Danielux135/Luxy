# Luxy Desktop

Aplicación de escritorio para Windows. Es el flujo normal de uso: abres `Luxy.exe`,
se queda en la bandeja y Telegram le manda trabajo.

La CLI (`npm start`) sigue existiendo como herramienta avanzada y de recuperación.

## Instalación

Dos artefactos, generados con `npm run desktop:package`:

| Archivo | Cuándo usarlo |
|---|---|
| `Luxy Setup 0.1.0.exe` | instalación normal |
| `Luxy-portable-0.1.0.exe` | probar sin instalar |

**Usa el instalador si quieres notificaciones.** Windows solo entrega notificaciones
toast a aplicaciones que tienen un acceso directo en el Menú Inicio con su
AppUserModelID. El portable no lo crea, así que los avisos de «trabajo terminado»
no aparecerán.

El instalador es por usuario: no pide permisos de administrador. Al desinstalar
**no** se borra `%APPDATA%\Luxy`, donde viven tu configuración y tus secretos
cifrados.

## Arquitectura

Tres procesos:

```
┌─────────────────────────────────────────────┐
│ proceso principal (Electron)                │
│  ventana · bandeja · IPC · secrets.enc      │
└───────────┬─────────────────────┬───────────┘
            │ contextBridge       │ utilityProcess
            ▼                     ▼
   ┌─────────────────┐   ┌──────────────────────┐
   │ renderer (React)│   │ agente (Node)        │
   │ sandbox: true   │   │ LuxyAgent + worktrees│
   └─────────────────┘   └──────────────────────┘
```

**El agente corre en su propio proceso**, no dentro del principal. Cuatro razones:

1. `resolve-executable` necesita un `node.exe` real para lanzar los shims `.cmd`
   de Claude Code y Codex. Dentro de Electron, `process.execPath` es `Luxy.exe`.
2. El agente hace `appendFileSync` y `spawnSync` en su ruta caliente; en el
   proceso principal congelarían la interfaz.
3. Una excepción del agente no puede llevarse por delante la ventana ni la bandeja.
4. Reiniciar el agente es matar y volver a lanzar, mucho más simple que resetear
   estado interno.

No es un proceso de PowerShell: es `utilityProcess.fork()`, Node lanzado y
controlado directamente desde el proceso principal, sin consola.

## Ciclo de vida

- **Cerrar la ventana la oculta.** Luxy sigue en la bandeja.
- **Solo «Salir completamente»** termina el agente y Electron.
- **Una sola instancia.** Abrir Luxy dos veces trae al frente la que ya está: dos
  agentes de la misma máquina se pisarían los worktrees.
- Con `--hidden` arranca solo en la bandeja (es lo que usa el inicio con Windows).

Menú de la bandeja: abrir, estado, trabajo activo, iniciar/detener/reiniciar
agente, abrir carpeta de registros y salir.

## Seguridad de la ventana

| Ajuste | Valor |
|---|---|
| `contextIsolation` | `true` |
| `nodeIntegration` | `false` |
| `sandbox` | `true` |
| CSP `script-src` | `'self'`, sin `unsafe-inline` en producción |
| `will-navigate` | bloqueado fuera de la propia interfaz |
| `setWindowOpenHandler` | `deny`; los enlaces abren en el navegador del sistema |
| permisos del navegador | denegados en bloque |

**El preload no expone `ipcRenderer` crudo.** Solo verbos concretos: `getStatus`,
`startAgent`, `pickFolder`… Nunca algo como `exec(comando)`.

**El preload no puede cargar módulos.** Con `sandbox: true` se ejecuta como
JavaScript plano. Por eso las constantes de canal viven en `src/shared/channels.ts`,
sin dependencias, separadas de los esquemas zod de `ipc.ts`. Si alguien vuelve a
juntarlos, el preload falla entero, `window.luxy` queda indefinido y la ventana
sale en blanco.

## Qué ve React

**Nunca un secreto.** El renderer recibe `secrets.configured`, que es un mapa de
nombre → booleano. Los campos de clave muestran puntos; para cambiar una clave se
introduce una nueva.

El `machineToken` se elimina de la configuración antes de enviarla, y `ConfigStore.save()`
lo borra otra vez aunque quien llame se olvide.

## Eventos en tiempo real

No hay polling agresivo. El estado inicial se pide una vez y a partir de ahí manda
el flujo de eventos IPC (`agent.started`, `job.claimed`, `job.tool.requested`,
`approval.pending`…).

`onAgentEvent` **devuelve la función de baja**. Sin ella se acumularían listeners
al navegar entre vistas.

## Desarrollo

```powershell
npm run desktop:dev      # compila el agente y abre Electron con recarga
npm run desktop:build    # solo compila
npm run desktop:package  # genera instalador y portable
npm run desktop:test     # tests del escritorio
```

**Si al lanzar Electron a mano aparece `does not provide an export named 'BrowserWindow'`
o `app` llega `undefined`**, comprueba `ELECTRON_RUN_AS_NODE` en tu entorno. VS Code
y otros hosts la exportan, y con ella `electron.exe` se comporta como Node puro:
`require('electron')` devuelve la ruta del binario en vez de la API. No es un
problema del bundle.
