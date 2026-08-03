# CLAUDE.md — contexto de trabajo en Luxy

Instrucciones para agentes que trabajen en este repositorio. Es un complemento
del `README.md`, no un resumen: aquí solo hay lo que hace falta para **cambiar
código** sin romper el diseño.

## Qué es Luxy

Agente personal con Luxy Studio como interfaz principal en Windows. Studio crea
y sigue trabajos reales; Telegram queda como canal secundario para órdenes
rápidas y avisos. El agente ejecuta en el PC o portátil elegido usando Claude
Code, Codex CLI o APIs HTTP configurables.

## Arquitectura del monorepo

```
packages/shared/   tipos, esquemas Zod y logica PURA (sin E/S)
apps/gateway/      Cloudflare Worker: unica pieza publica
apps/agent/        ejecutor local (Node en Windows)
apps/desktop/      Studio Windows (Electron/React, IPC y secretos cifrados)
supabase/migrations/  SQL acumulativo
scripts/           PowerShell para Windows
docs/              documentacion
```

**Regla estructural:** `packages/shared` no importa `node:*` ni tipos de
Workers. Lo consumen los dos lados. Si una función necesita disco o red, va en
`apps/agent` o `apps/gateway`, no en shared.

### Responsabilidades

| Paquete   | Hace                                                                                                      | No hace                        |
| --------- | --------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `shared`  | parser de comandos, router automático, selección de máquina, redacción, validación de rutas, esquemas Zod | E/S, red, disco                |
| `gateway` | autorización, cola, API de Studio, webhook y mensajes de Telegram                                         | ejecutar código local          |
| `agent`   | worktrees, spawn, proveedores, pruebas, cola de eventos                                                   | hablar con Supabase o Telegram |
| `desktop` | crear/seguir trabajos, configuración, aprobaciones y estado local                                         | exponer tokens al renderer     |

El agente **nunca** habla con Supabase ni con Telegram directamente. Solo con el
gateway, y solo saliente.

Las decisiones de Studio también pasan por el gateway: aplicar crea un commit
en la rama aislada y descartar elimina el worktree. Ambas exigen confirmación;
ninguna mezcla la rama principal ni hace `push`.

## Flujo

```
Studio/Telegram → Cloudflare Worker → Supabase → (polling) → agente local → CLI/API → Studio/Telegram
```

## Comandos

```powershell
npm install
npm run build        # tsc -b en todos los paquetes
npm run lint         # eslint
npm run typecheck    # tsc -b tsconfig.build.json
npm test             # vitest
npm run check        # lint + typecheck + test + build
npm run demo         # trabajo completo con mocks, sin consumir APIs
npm run setup:machine
```

Para probar el Worker sin desplegar: `cd apps/gateway && npm run dry-run`.

## Convenciones

**TypeScript**

- `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax` activos.
- ESM con extensión `.js` en los imports relativos (`./paths.js`), aunque el
  archivo sea `.ts`. Es obligatorio con `NodeNext`.
- `import type` para lo que solo se usa como tipo.
- Nada de `any` fuera de los mocks de tests.

**Nombres**

- Código, tipos e identificadores en inglés.
- Comentarios, mensajes al usuario, documentación y commits en **español**.
- Los comentarios explican **por qué**, no **qué**.

**Errores y logs**

- Clases de error propias por dominio (`GitError`, `ConfigError`, `AuthError`,
  `ProcessError`, `GatewayError`).
- Los mensajes que ve el usuario explican **qué hacer**, no vuelcan la traza.
- Logs JSON de una línea. Siempre pasan por `redact()`.
- Nunca se devuelve una traza al cliente HTTP.

## Migraciones

Están en `supabase/migrations/`, numeradas `000N_descripcion.sql`.

Para crear una:

1. Nuevo archivo con el siguiente número. **Nunca modifiques una ya aplicada.**
2. Mantén RLS activo; no des permisos a `anon` ni `authenticated`.
3. `npm test` — `migrations.test.ts` verifica estas invariantes.
4. Pruébala en un Supabase de pruebas antes que en el real.

**No se han ejecutado contra un Postgres real durante el desarrollo.** La
validación es estructural.

## Cómo añadir cosas

### Un proveedor de IA

1. Implementa `ProviderExecution` (`detect()` + `run()`) en
   `apps/agent/src/providers/`.
2. Si habla el formato de OpenAI, reutiliza `HttpApiProvider`: basta con añadir
   su configuración a `providers.http` en `config.json`.
3. Regístralo en `LuxyAgent.initializeProviders()`.
4. Añádelo a `PROVIDER_IDS` en `shared/constants.ts` y a `PROVIDER_LABELS`.
5. Tests de construcción de argumentos y de manejo de errores.

**Antes de usar un flag de un CLI: ejecuta su `--help` y compruébalo.** No
copies la sintaxis de otra versión. La detección de capacidades vive en
`parseClaudeCapabilities` / `parseCodexCapabilities`.

### Un comando de Telegram

1. Añádelo a `CONTROL_COMMANDS` o `TASK_COMMANDS` en `shared/telegram/commands.ts`.
2. Manéjalo en `handleControlCommand` (`gateway/src/handlers/commands.ts`).
3. Añádelo a `HELP_TEXT` y a `docs/TELEGRAM.md`.
4. Tests del parser en `commands.test.ts`.

### Un tipo de trabajo

1. Estado nuevo → `JOB_STATUSES` en `shared/constants.ts` **y** el enum
   `luxy_job_status` en una migración nueva.
2. Etiqueta en `STATUS_LABELS`.
3. Revisa `luxy_claim_job` y `luxy_expire_leases`: puede que el estado nuevo
   deba entrar o quedar fuera de la reclamación.

## Configuración por máquina

Vive en `%APPDATA%\Luxy\config.json`, **fuera del repositorio**. El mismo alias
puede apuntar a rutas distintas en cada ordenador. **Nunca versiones rutas
locales ni pongas rutas absolutas del equipo de nadie en archivos del repo.**

Esquema: `agentConfigSchema` en `shared/schemas.ts`.

## Leases y heartbeats

- Heartbeat cada 10 s; sin heartbeat 45 s → máquina desconectada.
- Lease de 120 s sobre el trabajo, renovado al enviar eventos.
- `luxy_expire_leases` (cron cada minuto):
  - `claimed` + `started_at is null` → vuelve a la cola. **Seguro.**
  - Ya empezado → `interrupted`. **No se reasigna**, porque puede haber cambios
    sin guardar en su worktree.

Esa distinción es la regla más importante del sistema. Si tocas la reclamación,
no la rompas.

## Git worktrees

Toda tarea que pueda modificar archivos corre en
`%LOCALAPPDATA%\Luxy\worktrees\<id>-<timestamp>`, rama `luxy/<id>-<slug>`.
**La carpeta de trabajo del usuario nunca se toca.** Los worktrees con cambios
no se borran sin aprobación explícita.

Si el proyecto no es un repo git: se permiten tareas de lectura y se rechazan
las de edición, explicando cómo inicializarlo.

## Pruebas sin consumir tokens

`npm test` **nunca** llama a una API real ni gasta tokens. Todo se mockea:

- Telegram → objetos `Request`/`Response` construidos a mano.
- Supabase → cliente falso con `selectOne`/`insertIfAbsent`.
- Claude y Codex → se prueba la **construcción de argumentos** y el **parseo de
  la salida**, nunca la ejecución real.
- APIs HTTP → se prueban `parseSseLine`, presupuestos y errores sin red.

Lo que sí se ejecuta de verdad: `git` (worktrees en carpetas temporales) y
`node` (procesos hijo, cancelación, timeouts). Es intencionado: son la parte
donde los bugs de Windows aparecen.

`npm run demo` hace un trabajo completo end-to-end con un proveedor simulado.

Las pruebas de un proyecto modificado **no** se ejecutan en el sistema anfitrión
salvo que ese proyecto tenga `allowHostChecks: true`. La lista blanca evita
inyección de shell, pero no convierte en seguro el código que la prueba importa.

## Reglas obligatorias

**Proveedores de IA**

- No usar la API de Anthropic. No usar `ANTHROPIC_API_KEY`.
- No usar la API de OpenAI. No usar `OPENAI_API_KEY`.
- No automatizar las páginas web de Claude ni de ChatGPT. Nada de navegadores.
- Claude Code y Codex CLI se usan con **la sesión local autenticada**.
- **Nunca `--dangerously-skip-permissions`** ni el equivalente de Codex.

**Operaciones**

- No hacer `git push` sin autorización explícita del usuario.
- No desplegar servicios externos sin autorización.
- No aplicar migraciones contra producción sin autorización.
- No modificar archivos fuera del worktree activo.

**Código**

- No guardar secretos en el repositorio.
- **Nunca `child_process.exec` ni `shell: true`** con contenido no confiable.
  Siempre `spawn` con ejecutable y argumentos separados.
- Validar **toda** entrada externa con Zod.
- Añadir o actualizar pruebas con cada cambio importante.

**Antes de decir que algo está terminado**

- Ejecutar `npm run lint`, `npm run typecheck`, `npm test` y `npm run build`.
- **No ocultar pruebas que fallan.** Si falla algo, dilo con su salida.
- **No decir "verificado" cuando solo está "implementado".** Si no lo has
  ejecutado, di que no lo has ejecutado.

## Archivos que nunca se versionan

```
.env  .env.providers  wrangler.toml  .dev.vars
%APPDATA%\Luxy\config.json   (contiene el token de la maquina)
```

Los `.example` sí se versionan, siempre con valores `PENDIENTE_...`.

## Riesgos y decisiones conocidas

1. **Rate limiting aproximado.** En memoria del isolate de Cloudflare, por tanto
   por isolate. Suficiente contra bucles, no contra un ataque. Un Durable Object
   lo haría exacto.
2. **Shims `.cmd` de Windows.** Node rechaza lanzarlos sin shell. Los
   desreferenciamos leyendo el shim (`resolve-executable.ts`). Los `.bat` que no
   se pueden desreferenciar (`flutter.bat`) pasan por `cmd.exe` con validación
   estricta de argumentos. Esa ruta solo la alcanzan comandos de la lista blanca.
3. **Migraciones sin ejecutar** contra Postgres real. Validación estructural.
4. **Prompt injection**: mitigado (contexto marcado como dato, system prompt,
   límites recordados), no eliminado. La defensa real es el aislamiento del
   worktree y la lista blanca de comandos.
5. **Polling en vez de push** al agente: es el precio de no abrir puertos.
   Decisión deliberada, ver `docs/decisions/0001-luxy-architecture.md`.

## Mantener este archivo

Actualiza `CLAUDE.md` **y** `AGENTS.md` cuando cambie:

- la arquitectura o la estructura del monorepo,
- los comandos principales de `package.json`,
- las políticas de seguridad,
- el flujo de despliegue,
- la configuración de proveedores,
- el sistema de trabajos, leases o permisos.

Los dos archivos **no deben contradecirse**. `docs/README-CHECKS.md` describe la
comprobación de coherencia; `npm test` verifica que los comandos citados aquí
existen de verdad en `package.json`.
