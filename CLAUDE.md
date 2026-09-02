# CLAUDE.md — contexto de trabajo en Luxy

Instrucciones para agentes que trabajen en este repositorio. Es un complemento
del `README.md`, no un resumen: aquí solo hay lo que hace falta para **cambiar
código** sin romper el diseño.

## Lectura obligatoria y relevo con Codex

Antes de investigar, planificar o editar, lee en este orden:

1. `PROJECT-STATE.md`.
2. `CURRENT-TASK.md`.
3. `MASTER-PLAN.md`.
4. `DECISIONS.md`.
5. `CHANGELOG-WORK.md`, `TEST-RESULTS.md` y `LOCAL-ACTIONS.md`.
6. `AI-WORK-PROTOCOL.md`.

Si estás en un ordenador recién clonado y nada arranca, empieza por
`docs/ARRANQUE-ORDENADOR-NUEVO.md`: explica qué falta a propósito en el
repositorio y en qué orden se regenera.

Estos archivos son la memoria compartida de Claude y Codex. No repitas una
auditoría ya registrada: verifica sólo lo que pueda haber cambiado en el
worktree real. Si el repositorio contradice la documentación, detén la edición,
registra la discrepancia y actualiza primero `PROJECT-STATE.md`.

Sólo una IA escribe en este worktree a la vez. Antes de entregar el turno a
Codex, actualiza la documentación de continuidad. Al recibirlo, conserva todos
los cambios existentes; nunca limpies el worktree para ajustarlo al plan.

Todo paso del plan tiene un ID. Cuando un paso empieza, se bloquea, se completa
o cambia de alcance, actualiza `CURRENT-TASK.md` y añade evidencia a
`CHANGELOG-WORK.md` en ese momento. Sin archivos, comandos, resultados reales y
siguiente paso documentados, el trabajo no está terminado.

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
| `desktop` | trabajos, conversaciones, comparación, configuración, aprobaciones y estado local                         | exponer tokens al renderer     |

El agente **nunca** habla con Supabase ni con Telegram directamente. Solo con el
gateway, y solo saliente.

Las decisiones de Studio también pasan por el gateway: aplicar crea un commit
en la rama aislada y descartar elimina el worktree. Ambas exigen confirmación;
ninguna mezcla la rama principal ni hace `push`.

Si un proyecto editable todavía no tiene `.git`, el agente crea `.gitignore`
si falta, excluye secretos, dependencias y salidas generadas, y crea el commit
local `estado inicial` sin remoto antes de preparar el worktree. Con
`allowEdits: false` no se inicializa y permanece en solo lectura.

Conversaciones reutiliza los trabajos y eventos persistentes: la metadata agrupa
conversación, turno y columnas de comparación. Es un modo de solo lectura: no
crea worktree, no concede herramientas y no ejecuta comprobaciones. Codex exige
sandbox `read-only`; Claude bloquea herramientas de escritura, comandos y red.
Cada respuesta produce una memoria estructurada separada del texto visible. El
gateway la persiste con su trabajo; Studio combina la memoria acumulativa, los
ultimos turnos y recuerdos relevantes del mismo proyecto. Las recomendaciones
de proveedor usan resultados y feedback guardados, y siempre se aceptan de forma
explicita: no hay sustituciones silenciosas.

### Finales de una respuesta

Una respuesta no termina «bien o mal»: termina de una de seis formas —
`completed`, `truncated`, `interrupted`, `timed_out`, `cancelled` o `failed`.
Las decide `classifyResponseOutcome` en
`packages/shared/src/response-outcome.ts`, con la evidencia que recoge el
transporte (`responseTermination`: última señal, quién abortó, límites
efectivos, tokens y tamaños; **nunca contenido**).

El detalle viaja en `responseOutcome`, dentro del resultado del trabajo y de su
metadata. **El enum `luxy_job_status` no cambia**: una salida parcial se guarda
como `completed` con su motivo real al lado, así que leer `status: completed`
como «respuesta entera» es un error.

Dos invariantes que dependen de esto:

- un corte que ya había producido texto **no se reintenta**. Repetirlo tira lo
  generado, vuelve a pagar el prompt y empieza de cero;
- una respuesta cuyo final no sea `completed` **no escribe memoria**: se
  conserva la última válida.

## Flujo

En un turno privado local, `ProviderRunRequest.interactionMode` es
`conversation`: las conexiones HTTP usan un `system` conversacional y el
wrapper conserva como órdenes las directivas de personaje. Memoria, historial y
mensaje siguen siendo datos/canon. No volver a imponer la identidad de asistente
técnico sobre ese camino (`D-055`).

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

1. Si habla el contrato `chat completions`, se añade desde Conexiones de Studio:
   `HttpApiProvider` lo construye desde `providers.http` sin tocar código.
2. Sólo si usa otro protocolo, implementa `ProviderExecution` (`detect()` +
   `run()`) en `apps/agent/src/providers/` y regístralo en
   `LuxyAgent.initializeProviders()`.
3. Añade un identificador compilado a `PROVIDER_IDS` y `PROVIDER_LABELS` sólo
   para una familia nativa con comportamiento propio, no para una conexión HTTP.
4. Añade tests de construcción de argumentos y manejo de errores.

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

Studio también puede preparar el worktree antes del primer prompt, abrirlo para
añadir contexto y reutilizar esa misma ruta en trabajos posteriores. La
selección pertenece a una máquina y proyecto concretos; reutilizarla no crea
otra rama ni otra carpeta.

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
- Los proveedores HTTP configurables desde Studio deben hablar el contrato
  `chat completions`. Sus claves viven cifradas en `SecretStore`, nunca en
  `config.json`; las URLs remotas exigen HTTPS y HTTP sólo se admite en loopback.
- El catálogo real de una conexión consulta sólo `/v1/models`; no sondea rutas
  tentativas de precios (`D-022`).
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
- Sincronizar `CURRENT-TASK.md`, `PROJECT-STATE.md`, `MASTER-PLAN.md`,
  `CHANGELOG-WORK.md`, `TEST-RESULTS.md` y `LOCAL-ACTIONS.md`.

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

El contrato completo de documentación y cambio de IA vive en
`AI-WORK-PROTOCOL.md` y prevalece sobre notas antiguas de una conversación.
