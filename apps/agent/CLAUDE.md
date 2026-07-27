# apps/agent — reglas específicas

Ejecutor local. Es la pieza que **de verdad toca el disco y lanza procesos**, y
por tanto donde un error tiene consecuencias reales.

## Reglas innegociables

1. **Solo conexiones salientes.** El agente nunca abre un puerto accesible desde
   la red. La única excepción es la interfaz local, atada a `127.0.0.1` y
   deshabilitada por defecto.
2. **Los comandos se ejecutan con `spawn`**, ejecutable y argumentos separados.
   **Nunca `exec`. Nunca `shell: true`.**
3. **Las rutas se validan siempre.** Absolutas, sin `..`, dentro del worktree, y
   comprobando enlaces simbólicos con `realpath`.
4. **Las tareas de edición van en un worktree.** La carpeta del usuario no se
   toca jamás.
5. **La cancelación mata el árbol completo** de procesos
   (`taskkill /PID <pid> /T /F`). Matar solo al padre deja huérfanos.
6. **Nunca se envía el entorno completo a un modelo** ni a un proceso hijo.

## Windows: shims `.cmd`

`npm`, `claude`, `codex` y `flutter` son shims `.cmd`/`.bat`. Node **rechaza**
lanzarlos con `spawn` cuando `shell` es false (devuelve `EINVAL`), y no podemos
activar shell.

`resolve-executable.ts` lo resuelve:

1. Si hay un `.exe` real, se usa directamente.
2. Si el `.cmd` apunta a un `.exe`, se extrae y se lanza ese.
3. Si apunta a un `.js`, se lanza `node <ese.js>`.
4. Si es un `.bat` no desreferenciable (`flutter.bat`), se pasa por
   `cmd.exe /d /s /c` **y se validan todos los argumentos**, rechazando
   `" & | < > ^ % !` y saltos de línea.

El paso 4 es una excepción documentada. Solo la alcanzan comandos de la lista
blanca de `config.json`, **nunca** texto de Telegram. Si tocas esto, mantén
`assertSafeForCmd`.

## Detección de capacidades

**Antes de usar un flag de un CLI, comprueba que esa versión lo admite.**

```ts
const help = await readHelp('claude', ['--help']);
const caps = parseClaudeCapabilities(help);
if (caps.streamJson) { /* solo entonces */ }
```

No copies flags de otra versión ni de la documentación. Si detectas una
incompatibilidad: adapta el código, documenta la versión y **no elimines** el
soporte de otras versiones sin necesidad.

Versiones detectadas durante el desarrollo: Claude Code 2.1.183, Codex 0.141.0.

## Ubicaciones locales

```
%APPDATA%\Luxy\config.json        configuracion (contiene el token: es secreto)
%LOCALAPPDATA%\Luxy\logs          logs rotativos
%LOCALAPPDATA%\Luxy\worktrees     worktrees de git
%LOCALAPPDATA%\Luxy\state         eventos pendientes de enviar
```

Usa siempre los helpers de `paths.ts`. No construyas estas rutas a mano.

## Resiliencia

- Todo lo que sale a red va con backoff exponencial y jitter.
- Los eventos se encolan en disco (`EventQueue`) y se reenvían al recuperar la
  conexión. Son idempotentes por `(job_id, sequence)`.
- El resultado final se reintenta hasta 10 veces.
- Un corte de red **no** cancela el trabajo en curso.
- `Ctrl+C` hace apagado limpio: aborta el trabajo conservando cambios y vacía
  la cola de eventos.

## Proveedores

Todos implementan `ProviderExecution`: `detect()` y `run()`.

- `run()` **no lanza** por fallo del proveedor: devuelve `ok: false` con
  `errorMessage` legible. Solo los errores de programación propagan.
- El progreso se emite con `onEvent`, no con `console.log`.
- El timeout y el `AbortSignal` vienen en la petición; hay que respetarlos.

## Ejecución de pruebas

Solo comandos que estén **a la vez**:
1. declarados en `config.json` del proyecto, y
2. en `ALLOWED_TEST_EXECUTABLES`.

Esa lista **no** incluye `curl`, `wget`, `bash`, `powershell`, `cmd` ni `git`.
Si añades un ejecutable, justifica por qué es seguro y añade su test.

## Probar los cambios

```powershell
npm run build
npm test
npm run demo     # trabajo completo con un proveedor simulado
```

`npm run demo` no consume ninguna API. Úsalo para validar cambios en el flujo
de worktrees, pruebas o diffs.

Las pruebas de `agent.test.ts` **sí** lanzan `git` y `node` de verdad, en
carpetas temporales. Es intencionado: ahí es donde aparecen los fallos de
Windows.
