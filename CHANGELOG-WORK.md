# Luxy — registro de trabajo de IA

Registro cronológico y append-only. No reescribir una entrada anterior para que
parezca correcta; añadir una corrección nueva.

## Historial consolidado anterior al protocolo

### 2026-08-01 — ChatGPT Work — AUDIT-001

- Estado anterior: agente/gateway maduros; prioridad antigua centrada en
  Telegram y Remote.
- Objetivo: auditar el repositorio y reorientar el producto.
- Resultado real: se fijó Studio Windows como interfaz principal, Android como
  fase posterior, Telegram secundario y Remote pausado.
- Decisiones: coste 0 €, uso privado, sin iOS, sin push/deploy/migraciones sin
  autorización, Claude/Codex mediante CLI local.
- Evidencia: handoff técnico y auditoría del monorepo.
- Siguiente paso: primer vertical slice real de Studio.

### 2026-08-02 — ChatGPT Work — STUDIO-001

- Objetivo: máquina → proyecto → proveedor/modelo → trabajo → eventos →
  resultado/diff.
- Archivos: shared, gateway, agent, Desktop, documentación y migración `0005`
  preparada.
- Resultado real: parche `luxy-work-update-001.patch` aplicado en el worktree
  aislado `luxy-work-update-001`.
- Pruebas históricas: 1.260 pasaron y 14 se omitieron en Windows; build completo.
- Restricciones: `0004` Remote no era requisito de Studio; `0005` no debía
  aplicarse automáticamente.
- Siguiente paso: decisiones aplicar/descartar y Conversaciones.

### 2026-08-03 — ChatGPT Work — STUDIO-DECISIONS

- Objetivo: aplicar o descartar cambios de un trabajo desde Studio.
- Resultado real: decisiones persistentes mediante gateway/aprobaciones; aplicar
  crea commit en rama aislada y descartar limpia el worktree tras confirmación.
- Riesgos preservados: ninguna acción mezcla rama principal ni hace push.
- Siguiente paso: conversación persistente y comparación.

### 2026-08-03 — ChatGPT Work — CONVERSATIONS-001

- Objetivo: chat individual/A-B con streaming e historial.
- Resultado real: conversaciones sobre jobs/metadata, solo lectura, selección
  explícita de máquina/proyecto/proveedor/modelo y comparación de dos respuestas.
- Siguiente paso: memoria y aprendizaje local.

### 2026-08-03 — ChatGPT Work — MEMORY-001

- Objetivo: continuar conversaciones sin depender de memoria nativa de la API.
- Resultado real: bloque `LUXY_MEMORY`, parseo Zod, resumen/hechos/decisiones/
  plan/preguntas/lecciones, memorias relacionadas del mismo proyecto y feedback.
- Limitación conocida entonces: fallback desde el texto visible si el bloque no
  era válido.
- Siguiente paso: validar ejecución real con Kimi.

### 2026-08-04 — ChatGPT Work — CONVERSATIONS-FINALIZATION

- Problema observado: Kimi mostraba texto, pero el trabajo quedaba en
  `Respondiendo`.
- Iteraciones: lectura del último evento sin salto, señales terminales, cierre de
  socket, cancelación y recuperación de estados huérfanos.
- Causa final demostrada del bloqueo posterior al stream: el redactor trataba
  `inputTokens` y `outputTokens` como credenciales, los convertía en cadenas y
  la validación del outcome fallaba.
- Resultado real: respuestas normales pasan a `Guardado`, conservan duración,
  tokens y memoria; `Detener` funciona.
- Pruebas históricas: 91/91 para señales; 30/30 para outcome/tokens/memoria.
- Siguiente paso: feedback al primer clic.

### 2026-08-04 — ChatGPT Work — FEEDBACK-001

- Problema: el primer clic ya se persistía, pero la UI ignoraba el job devuelto
  por el gateway y una recarga podía ser absorbida por el polling.
- Resultado implementado: actualizar historial y detalle con la respuesta
  confirmada; bloquear botones mientras guarda.
- Pruebas históricas: 11/11 específicas, lint, tipos y build.
- Confirmación manual: pendiente de registrar en el worktree de Windows.

### 2026-08-04 — Daniel + ChatGPT Work — LONG-RESPONSE-OBSERVATION

- Estado anterior: conversación normal y memoria confirmadas por Daniel.
- Prueba manual: pedir una web completa a Kimi.
- Observado: unos 23 min 43 s, alrededor de 6.422 tokens de salida, HTML cortado
  a mitad y memoria de fallback llena de código.
- Diagnóstico: causa del corte no demostrada; límite de tokens y corte de
  conexión siguen siendo hipótesis competidoras.
- Incidencias: `LUXY-P0-001`, `LUXY-P0-002` y `LUXY-P0-003`.
- Siguiente paso: instrumentar finales de transporte y proteger memoria antes de
  tocar timeouts.

## Entradas bajo el nuevo protocolo

### 2026-08-04 — Codex Work — DOC-HANDOFF-001

- Estado anterior: contexto repartido entre handoff del 1 de agosto, parches,
  capturas y conversación.
- Objetivo: preparar continuidad completa para Claude y Codex en VS Code.
- Archivos leídos: `AGENTS.md`, `CLAUDE.md`, README, arquitectura, Desktop,
  schemas de memoria, SSE, proveedor HTTP, job runner, gateway, hooks de
  Conversaciones, migraciones y parches acumulados.
- Archivos modificados: sólo documentación raíz y referencias de documentación.
- Resultado real: fuente de verdad, plan maestro, tarea P0, decisiones,
  protocolo de relevo, acciones locales y resultados de prueba consolidados.
- Decisiones: no atribuir el corte largo a tokens sin evidencia; preservar
  memoria anterior; código largo como artefacto; cada paso queda documentado.
- Riesgos: el estado Git/migraciones exacto del worktree de Windows aún debe
  contrastarse allí.
- Comandos ejecutados: Prettier check, validación JSON/referencias,
  `npm run lint`, `npm run typecheck`, `npm test` y `npm run build`.
- Pruebas: formato, JSON, referencias, lint, tipos y build pasaron. La suite
  reprodujo 1.294 verdes, 9 omitidas, 9 fallos ambientales y dos suites
  Electron sin cargar; detalle en `TEST-RESULTS.md`.
- Estado nuevo: documentación creada y validada dentro de las limitaciones de la
  copia Linux; la suite global no se declara verde.
- Siguiente paso exacto: empaquetar el relevo y, en Windows, ejecutar `LA-002`
  antes de iniciar `P0.0`.

### 2026-08-05 08:38 — Claude Code — P0.0

- Estado anterior: `P0.0` pendiente; el estado Git y de migraciones del worktree
  de Windows sólo estaba supuesto desde la copia Linux.
- Objetivo: verificar el checkpoint real sin limpiar ni modificar código.
- Hipótesis o causa demostrada: no aplica; paso de verificación.
- Archivos leídos: `AGENTS.md`, `CLAUDE.md`, `PROJECT-STATE.md`,
  `CURRENT-TASK.md`, `MASTER-PLAN.md`, `DECISIONS.md`, `CHANGELOG-WORK.md`,
  `TEST-RESULTS.md`, `LOCAL-ACTIONS.md`, `AI-WORK-PROTOCOL.md`,
  `apps/agent/src/providers/sse.ts`, `apps/agent/src/providers/http-provider.ts`,
  `apps/agent/src/job-runner.ts`, `packages/shared/src/schemas.ts`,
  `apps/agent/src/conversation-job.test.ts`.
- Archivos modificados: sólo documentación (`CURRENT-TASK.md`,
  `CHANGELOG-WORK.md`, `TEST-RESULTS.md`, `PROJECT-STATE.md`).
- Comandos ejecutados: `git status --short --branch`, `git diff --stat`,
  `git log --oneline -3`, listado de `supabase/migrations`,
  `git apply --reverse --check` de los tres parches finales,
  vitest sobre las ocho suites de Conversaciones y `npm test`.
- Resultado real:
  - rama `luxy/work-update-001-studio`, HEAD `61fb7ee`, 29 archivos modificados
    y 22 sin seguimiento; 1.603 inserciones y 88 borrados sin confirmar;
  - migraciones presentes: `0001` a `0006`, con
    `0006_luxy_service_role_grants.sql` (384 B) sin seguimiento. Ninguna tocada;
  - los tres parches finales (`signal-finalization`,
    `outcome-token-finalization-fix`, `feedback-single-click-fix`) están
    **presentes**: `git apply --reverse --check` sale con código 0;
  - el fallback de memoria por 1.200 caracteres sigue vivo en
    `packages/shared/src/schemas.ts:200-211` y se usa en tres ramas de
    `parseConversationMemoryResponse`; `LUXY-P0-002` se confirma en código;
  - `apps/agent/src/providers/http-provider.ts` no emite hoy ninguna telemetría
    de final de transporte: `finishReason`, motivo de aborto y `finalUsageReceived`
    se descartan al convertir el turno en `LoopTurnResult`/`readStream`.
- Pruebas: suites de Conversaciones 57/57 passed. `npm test` completo en
  Windows: 68 archivos, 1.316 passed, 9 skipped, exit 0.
- Decisiones: ninguna nueva. Se mantiene `D-014`: no se toca `0005` ni `0006`.
- Riesgos o límites: los 9 fallos ambientales registrados el 2026-08-04 eran de
  la copia Linux; en Windows no aparecen. La línea base de esta máquina es
  verde, así que cualquier fallo posterior aquí es una regresión, no ambiente.
- Estado nuevo: `P0.0` done. Discrepancia 0005/0006 registrada: los archivos
  existen, no hay evidencia de que se hayan aplicado contra Postgres.
- Siguiente paso exacto: `P0.1`, telemetría segura del final de la respuesta en
  `apps/agent/src/providers/sse.ts` y `http-provider.ts`.

### 2026-08-05 08:51 — Claude Code — P0.1

- Estado anterior: `P0.0` done. El transporte sabía `finishReason` y
  `finalUsageReceived`, pero los descartaba: nadie observaba quién abortó ni
  cómo se cerró el cuerpo.
- Objetivo: dejar evidencia suficiente para explicar por qué termina una
  respuesta, sin guardar su contenido.
- Hipótesis o causa demostrada: ninguna causa nueva atribuida a `LUXY-P0-001`.
  Este paso construye la evidencia que falta, no la interpreta.
- Archivos leídos: `sse.ts`, `http-provider.ts`, `job-runner.ts`, `agent.ts`,
  `event-queue.ts`, `repository.ts`, `types.ts`, `constants.ts`, `schemas.ts`.
- Archivos modificados:
  - `packages/shared/src/constants.ts`: `STREAM_TRANSPORT_ENDS` y
    `RESPONSE_ABORT_SOURCES`.
  - `packages/shared/src/schemas.ts`: `responseTerminationSchema` y
    `formatResponseTermination`.
  - `packages/shared/src/types.ts`: tipos derivados y
    `ProviderRunResult.termination`.
  - `apps/agent/src/providers/sse.ts`: `onTransportEnd` con última señal,
    bytes, chunks y duración; `read_error` se marca antes de propagar.
  - `apps/agent/src/providers/http-provider.ts`: diagnóstico por petición,
    origen del aborto (`user`, `request_timeout`, `local_finalization`) y
    `no_stream`; el diagnóstico se cierra en `finally`, así que sobrevive a un
    flujo que revienta.
  - `apps/agent/src/job-runner.ts` y `agent.ts`: evento `log` con
    `metadata.responseTermination`; `deps.emit` acepta metadata.
  - Pruebas: `sse.test.ts`, `providers.test.ts`, `conversation-job.test.ts` y
    `packages/shared/src/response-termination.test.ts` (nuevo).
- Comandos ejecutados: `npx vitest run` por suite, `npm run lint`,
  `npm run typecheck`, `npm test`, `npm run build`.
- Resultado real: **verificado**. Suite completa 69 archivos, 1.334 passed,
  9 skipped, exit 0 (antes 68/1.316). Lint sin incidencias, typecheck y build
  correctos.
- Pruebas: 4 casos nuevos de señal de transporte en `sse.test.ts` (36/36),
  6 de diagnóstico en `providers.test.ts` (60/60), 1 en `conversation-job.test.ts`
  (3/3) y 7 en `response-termination.test.ts`.
- Decisiones: el diagnóstico viaja en `ProviderRunResult` y en la metadata del
  evento, no en una tabla nueva ni en el enum de estados. `D-014` intacta: cero
  migraciones.
- Riesgos o límites:
  - el camino agentic (`callTurn`) todavía no rellena `termination`; las
    conversaciones no lo usan, pero queda pendiente;
  - **hallazgo**: un `read_error` con texto parcial se reintenta entero, porque
    `shouldRetry` acepta los errores sin `status`. Observado en la prueba nueva:
    el intento siguiente vuelve a empezar en vez de recuperar. Es material para
    `P0.2`, no se ha cambiado aquí;
  - la telemetría no demuestra todavía qué pasó el 2026-08-04: hará falta la
    prueba manual `LA-006` cuando estén `P0.2`–`P0.4`.
- Estado nuevo: `P0.1` done; `P0.2` pendiente con el hallazgo del reintento
  anotado en `CURRENT-TASK.md`.
- Siguiente paso exacto: `P0.2`, decidir el reintento de un corte con contenido
  parcial en `http-provider.ts` y llevar los estados explícitos al `JobOutcome`
  de `job-runner.ts`.

### 2026-08-05 09:49 — Claude Code — P0.2

- Estado anterior: `P0.1` done. El transporte ya explicaba el final, pero seguía
  habiendo sólo dos resultados posibles, y un corte con texto parcial se
  reintentaba entero y acababa como fallo sin contenido.
- Objetivo: seis finales explícitos, conservar lo generado y dejar de repetir
  ciegamente una generación cortada.
- Hipótesis o causa demostrada: **reproducido**. La prueba nueva de
  `providers.test.ts` cuenta los intentos: antes tres, ahora uno cuando ya había
  texto. La otra rama sigue reintentando tres veces cuando no llegó nada.
- Archivos leídos: `http-provider.ts`, `job-runner.ts`, `api.ts`,
  `conversation.ts` del renderer, `schemas.ts`, `final-outcome.test.ts`.
- Archivos modificados:
  - `packages/shared/src/constants.ts`: `RESPONSE_OUTCOMES` y
    `RECOVERABLE_RESPONSE_OUTCOMES`.
  - `packages/shared/src/response-outcome.ts` (nuevo): `classifyResponseOutcome`,
    `isRecoverableOutcome`, etiquetas y explicaciones. Lógica pura.
  - `packages/shared/src/schemas.ts`: `responseOutcomeSchema`, y
    `responseOutcome`/`responseTermination` en `jobCompleteRequestSchema`.
  - `packages/shared/src/types.ts`, `index.ts`: tipos y export.
  - `apps/agent/src/providers/http-provider.ts`: `shouldRetry` no repite con
    texto delante; el texto parcial viaja en `finalText` aunque `ok` sea false;
    un timeout marca `timedOut`.
  - `apps/agent/src/job-runner.ts`: clasificación, conservación de la salida
    parcial, aviso con el motivo real y bloqueo de la memoria cuando el final no
    es `completed`.
  - `apps/gateway/src/handlers/api.ts`: persiste ambos campos en la metadata.
  - Pruebas: `response-outcome.test.ts` (nuevo), `providers.test.ts`,
    `conversation-job.test.ts`, `final-outcome.test.ts`.
- Comandos ejecutados: vitest por suite, `npm run lint`, `npm run typecheck`,
  `npm test`, `npm run build`.
- Resultado real: **verificado**. Suite completa 70 archivos, 1.356 passed,
  9 skipped, exit 0 (antes 69/1.334). Lint, tipos y build correctos.
- Pruebas: 15 casos de clasificación cubriendo los seis finales y la ausencia de
  diagnóstico; 3 nuevos de reintento y conservación en `providers.test.ts`;
  2 en `conversation-job.test.ts`; 2 en `final-outcome.test.ts`.
- Decisiones: `D-016` (un corte con contenido no se reintenta) y `D-017` (el
  final detallado viaja en metadata, el enum de Postgres no se toca). Ninguna
  migración.
- Riesgos o límites:
  - una cancelación manual todavía no conserva el texto parcial: el camino
    `cancelled` del gateway no guarda resultado. Queda para `P0.5`;
  - el camino agentic sigue sin `termination` y cae en la rama sin diagnóstico,
    que no inventa motivos;
  - `status: completed` deja de significar «respuesta entera». Toda pantalla
    debe leer `responseOutcome`; Studio aún no lo muestra, eso es `P0.5`.
- Estado nuevo: `P0.2` done. `P0.3` adelantado en parte: una respuesta que no
  termina bien ya no escribe memoria.
- Siguiente paso exacto: `P0.3`, sustituir
  `compactConversationMemoryFallback` (`packages/shared/src/schemas.ts:200`) por
  un estado explícito y añadir los detectores de código.

### 2026-08-05 10:53 — Claude Code — P0.2b y P0.3

- Estado anterior: `P0.2` done. Daniel repitió la prueba manual con Kimi K2.6 y
  aportó capturas de Studio y del panel del proveedor.
- Objetivo: explicar el corte con datos reales y arreglar las dos cosas que
  observó: la web cortada por la mitad y la memoria llena de código.
- Evidencia aportada por Daniel (**observado**): Kimi-K2.6, 753 tokens de
  entrada y **3.180 de salida**, primer token 8,5 s, duración 3 min 53 s en el
  proveedor y 237 s en Studio, 14 t/s. Respuesta cortada a mitad de HTML,
  marcada `Guardado`, y memoria mostrando el HTML como resumen.
- Hipótesis descartada con el código: **no fue el tope de tokens**. El tope
  efectivo para Kimi es 8.192 (`maxOutputTokens` por defecto del catálogo, la
  entrada `kimi-k2.6` no lo sube) y la respuesta paró en 3.180.
- Causa **reproducida**: `terminalDeadline` se armaba al ver una señal terminal
  y no se desarmaba nunca. Bastaba un `usage` sin `choices` a mitad de la
  respuesta para que Luxy cerrase el transporte un segundo después, aunque el
  modelo siguiera escribiendo. La prueba nueva de `sse.test.ts` falla contra el
  código anterior quedándose con `<html>` y descartando el resto.
- Archivos leídos: `sse.ts`, `http-provider.ts`, `agent.ts`, `catalog.ts`,
  `models/types.ts`, `conversation.ts` del renderer, y sólo los campos de
  límites de `%APPDATA%\Luxy\config.json` (ningún secreto).
- Archivos modificados:
  - `packages/shared/src/constants.ts`: `TERMINAL_GRACE_MS`,
    `SOFT_TERMINAL_GRACE_MS` y `CONVERSATION_MEMORY_STATUSES`.
  - `apps/agent/src/providers/sse.ts`: señales fuertes y débiles; el margen se
    cuenta desde el último evento y se desarma si deja de haber señal.
  - `apps/agent/src/providers/http-provider.ts`: `finish_reason` y memoria
    completa son fuertes; `usage` sin `choices` es débil con 15 s de silencio.
  - `packages/shared/src/schemas.ts`: `softTerminalGraceMs` en la configuración
    del proveedor; parser de memoria sin fallback, con estado explícito y
    `looksLikeCode`; `conversationMemoryStatus` en el resultado.
  - `packages/shared/src/types.ts`, `apps/agent/src/job-runner.ts`,
    `apps/gateway/src/handlers/api.ts`.
  - Pruebas: `sse.test.ts`, `providers.test.ts`, `conversation-memory.test.ts`
    (reescrita con la web real de la captura), `conversation-job.test.ts`.
- Comandos ejecutados: vitest por suite, `npm run lint`, `npm run typecheck`,
  `npm test`, `npm run build`.
- Resultado real: **verificado**. Suite completa 70 archivos, 1.366 passed,
  9 skipped, exit 0 (antes 1.356). Lint, tipos y build correctos.
- Pruebas: 3 nuevas de corte con datos en vuelo en `sse.test.ts`; 1 del margen
  por defecto en `providers.test.ts`; `conversation-memory.test.ts` pasa de 3 a
  9 casos, incluidos la web entera y el bloque válido con código dentro.
- Decisiones: `D-018` (señales fuertes y débiles; sustituye la parte de `D-011`
  que las igualaba) y `D-019` (la memoria no tiene fallback; cumple la
  corrección pendiente de `D-009`).
- Riesgos o límites:
  - **no está demostrado** que el corte de Daniel fuese exactamente este
    mecanismo: no había telemetría cuando ocurrió. Es la única causa
    reproducida, y la repetición con el build nuevo lo confirmará o no;
  - aunque el corte esté arreglado, **8.192 tokens de salida no dan para una
    página de 1.000–2.000 líneas**. Hace falta confirmar el tope real de
    Kimi K2.6 antes de subirlo: `LA-007`;
  - Studio todavía no dice que la memoria se conservó; sólo deja de
    contaminarla. Eso es `P0.5`.
- Estado nuevo: `P0.2b` y `P0.3` done.
- Siguiente paso exacto: `LA-006` y `LA-007` por parte de Daniel, y `P0.4` para
  cerrar la matriz de regresión (falta el caso 10, cancelación de punta a
  punta).

### 2026-08-05 11:15 — Claude Code — P0.3b

- Estado anterior: `P0.2b` y `P0.3` cerrados. Daniel repitió la prueba con el
  build nuevo y la web **seguía saliendo cortada**, esta vez sin panel de
  memoria.
- Objetivo: usar la telemetría de `P0.1` para decidir la causa con datos, en vez
  de seguir acumulando hipótesis.
- Método: consulta de sólo lectura a la base del proyecto con las credenciales
  locales del gateway, pidiendo únicamente metadata y longitudes. No se volcó ni
  se guardó contenido de las respuestas.
- **Causa demostrada** (no hipótesis):

  | Trabajo    | tokens salida | caracteres recibidos | guardado | transporte    | finish_reason | aborto  |
  | ---------- | ------------- | -------------------- | -------- | ------------- | ------------- | ------- |
  | `LUX-YJT9` | 3.180         | 7.716                | 4.000    | `done_marker` | `stop`        | ninguno |
  | `LUX-8B8T` | 2.720         | 7.691                | 4.000    | `done_marker` | `stop`        | ninguno |

  La llamada terminaba bien y la respuesta llegaba entera. El corte era nuestro,
  al guardar: `summary` estaba limitado a 4.000 caracteres para todo tipo de
  trabajo. Los últimos caracteres guardados (`<input ty`) coinciden exactamente
  con el punto donde se corta la captura de Daniel.

- **Corrección de una conclusión anterior:** en la entrada de `P0.2b` atribuí el
  corte al cierre local por señal débil. Ese fallo era real y está reproducido,
  pero `abortedBy: null` y `done_marker` demuestran que **no** fue lo que le
  pasó a Daniel. El arreglo se mantiene como endurecimiento; la explicación era
  incompleta y queda corregida aquí.
- Segundo hallazgo: `conversationMemoryStatus: invalid` en `LUX-8B8T` demuestra
  que el modelo **sí** devolvía su memoria. El bloque se descartaba entero por
  pasarse de los límites del esquema, y por eso desapareció el panel.
- Archivos modificados:
  - `packages/shared/src/constants.ts`: `MAX_TASK_RESULT_CHARS`,
    `MAX_CONVERSATION_RESULT_CHARS` y `MAX_TELEGRAM_SUMMARY_CHARS`.
  - `packages/shared/src/schemas.ts`: tope del resultado y `summaryTruncated`;
    `normalizeConversationMemory` recorta a los límites en vez de rechazar.
  - `apps/agent/src/job-runner.ts`: tope según el tipo de trabajo y aviso
    explícito si aun así no cabe.
  - `apps/gateway/src/handlers/api.ts`: la tarjeta de Telegram se recorta al
    renderizar, no al guardar.
  - Pruebas: `conversation-job.test.ts`, `conversation-memory.test.ts`,
    `final-outcome.test.ts`.
- Comandos ejecutados: vitest por suite, `npm run lint`, `npm run typecheck`,
  `npm test`, `npm run build`.
- Resultado real: **verificado**. Suite completa 70 archivos, 1.370 passed,
  9 skipped, exit 0 (antes 1.366). Lint, tipos y build correctos.
- Decisiones: `D-020` (el resumen de una conversación es la respuesta; nunca se
  pierde contenido en silencio) y corrección del alcance de `D-018`.
- Riesgos o límites:
  - los trabajos ya guardados **siguen truncados**: el contenido perdido no se
    puede recuperar, sólo dejará de ocurrir;
  - 7,7 K caracteres es lo que produjo el modelo, no lo que cabe. Con
    `max_tokens` en 8.192 el techo son unas 700 líneas de HTML: para 1.000–2.000
    sigue haciendo falta `LA-007`;
  - una conversación puede ahora guardar hasta 120 K caracteres y el listado de
    Studio los devuelve; si el historial crece mucho habrá que paginar o mover
    la respuesta al detalle. Anotado en `F2.3`.
- Estado nuevo: `P0.3b` done.
- Siguiente paso exacto: Daniel repite la prueba (`LA-006`) y confirma el tope
  de salida (`LA-007`); después `P0.4`.

### 2026-08-05 16:36 — Claude Code — P0.3c

- Estado anterior: `P0.3b` cerrado. Daniel probó con KAT Coder Pro v2.5 y recibió
  dos errores del proveedor mostrados como JSON crudo, en chino, precedidos de
  «fallo tras 3 intentos».
- Objetivo: que un fallo del proveedor se explique bien y no se le atribuya a
  Luxy. Los errores en sí son del proveedor y no se pueden arreglar desde aquí.
- Evidencia de producción (sólo lectura, sin volcar contenido):

  | Trabajo    | final       | finish_reason | tokens salida | caracteres | guardado | memoria           |
  | ---------- | ----------- | ------------- | ------------- | ---------- | -------- | ----------------- |
  | `LUX-3966` | `truncated` | `length`      | **8.192**     | 22.574     | 22.025   | `truncated_block` |
  | `LUX-Y4W5` | `completed` | `stop`        | 633           | 1.537      | 955      | `structured`      |
  | `LUX-LYTT` | `completed` | `stop`        | 600           | 1.098      | 805      | `structured`      |

  Los arreglos anteriores funcionan en real: 22.025 caracteres guardados donde
  antes cabían 4.000, `truncated` detectado por `finish_reason: length` y
  memoria `structured` en los turnos normales.

- Fallos de Luxy encontrados y corregidos:
  1. `RetryError` decía siempre «tras N intentos» usando el máximo configurado.
     Un 400 rechazado a la primera se anunciaba como «tras 3 intentos». Ahora
     cuenta los intentos reales y usa singular cuando toca.
  2. El envoltorio del reintento perdía el `status`, así que `describeHttpError`
     caía en la rama genérica y volcaba el cuerpo crudo de la respuesta. Ahora
     `RetryError` conserva el código y el describidor mira también dentro.
  3. Un 429 se reintentaba con backoff ciego ignorando `Retry-After`. Ahora se
     obedece la espera pedida, con tope de 60 s.
  4. Mensaje propio para el límite de plan (`UnaccessibleUser`,
     `not allowed to access`, `plan limited`): dice que no es un fallo de Luxy,
     que reintentar no ayuda y que se elija otro modelo. No se cambia de modelo
     solo (`D-004`).
- Archivos modificados: `packages/shared/src/backoff.ts`,
  `apps/agent/src/providers/http-provider.ts`, y sus pruebas en
  `format-budget.test.ts` y `providers.test.ts`.
- Comandos ejecutados: vitest por suite, `npm run lint`, `npm run typecheck`,
  `npm test`, `npm run build`.
- Resultado real: **verificado**. Suite completa 70 archivos, 1.379 passed,
  9 skipped, exit 0 (antes 1.370). Lint, tipos y build correctos.
- Riesgos o límites:
  - los 429 y los límites de plan **siguen ocurriendo**: son del proveedor.
    Luxy sólo los explica bien y espera lo que le piden;
  - `LUX-3966` demuestra que 8.192 tokens **sí** es un techo real alcanzable:
    22.574 caracteres, unas 700 líneas. `LA-007` deja de ser hipotético.
- Estado nuevo: `P0.3c` done.
- Siguiente paso exacto: `LA-007` (tope real por modelo) y `P0.4`.

### 2026-08-05 22:05 — Claude Code — MIGRACION-PC

- Estado anterior: el trabajo de `P0.0`–`P0.3c` vivía sólo en el worktree del
  ordenador `N-2278`, sin commitear. Esta copia estaba en `feat/luxy-desktop`
  con documentación del 2026-08-04, sin nada de Conversaciones.
- Objetivo: dejar este ordenador con el árbol idéntico al del worktree antiguo,
  porque `N-2278` ya no se va a usar.
- Hipótesis o causa demostrada: no aplica, es una migración.
- Archivos leídos: worktree remoto por UNC y sus metadatos de git.
- Archivos modificados: 60 archivos del árbol de trabajo, aplicados desde
  `luxy-work-update-001-COMPLETO.patch`. Previamente se respaldaron los
  documentos desactualizados de esta copia en
  `Desktop\luxy-recuperado\docs-de-esta-copia-2026-08-05\`.
- Comandos ejecutados: `git worktree prune -v`, `git checkout
luxy/work-update-001-studio`, `git apply --whitespace=nowarn`, `npm run build`,
  `npm test`, `npm run lint`, `npm run typecheck`, `npx prettier --check .`.
- Resultado real: parche aplicado limpio. `git worktree prune` eliminó dos
  registros que apuntaban a rutas de la máquina antigua y bloqueaban el
  `checkout`; no tocó ningún commit. `stash@{0}` sigue intacto.
- Pruebas: **1.379 pasadas, 9 omitidas, 0 fallos** en 70/70 archivos.
  `lint`, `typecheck` y `prettier --check` limpios. Detalle en
  `TEST-RESULTS.md`.
  Aviso útil para la próxima IA: la primera ejecución dio **25 fallos** con
  `Cannot read properties of undefined (reading 'safeParse')`. No era el parche:
  `packages/shared/dist` era de un build anterior y no tenía los esquemas
  nuevos. **Tras un cambio de rama o un parche grande hay que ejecutar
  `npm run build` antes que `npm test`.**
- Decisiones: no commitear todavía; `D-005` exige confirmación explícita. No
  copiar `config.json` por contener el token de máquina.
- Riesgos o límites: las 7.997 líneas siguen sin commit. El respaldo son las dos
  copias de `Desktop\luxy-recuperado\`, no git. Ver `D-016`.
- Estado nuevo: migración `completada` (`LA-008`). `LUXY-P0-LONG-RESPONSES`
  vuelve a estar `en curso`, ya no bloqueada.
- Siguiente paso exacto: `P0.4`, y `LA-007` (confirmar el tope real de salida por
  modelo). Antes, Daniel decide si se commitea lo recuperado en esta rama
  aislada.

### 2026-08-05 22:22 — Claude Code — P0.4

- Estado anterior: `P0.4` `pending`. Doce de los trece casos ya tenían prueba,
  repartidos entre cuatro archivos; faltaba el caso 10 y una lectura unificada.
- Objetivo: dejar la matriz de regresión completa, determinista y legible como
  tabla, sin red ni tokens.
- Hipótesis o causa demostrada: no aplica, es cobertura.
- Archivos leídos: `apps/agent/src/providers/sse.ts`,
  `apps/agent/src/providers/sse.test.ts`, `apps/agent/src/job-runner.ts`,
  `apps/agent/src/conversation-job.test.ts`,
  `packages/shared/src/response-outcome.ts`,
  `packages/shared/src/schemas.ts`, `packages/shared/src/constants.ts`.
- Archivos modificados: `apps/agent/src/response-matrix.test.ts` (nuevo, 19
  pruebas), `CURRENT-TASK.md`, `TEST-RESULTS.md` y este registro. **Ningún
  archivo de producción tocado**: la matriz no necesitó cambiar código, que es
  la señal de que `P0.1`–`P0.3c` dejaron el comportamiento donde debía.
- Comandos ejecutados: `npx vitest run apps/agent/src/response-matrix.test.ts`,
  `npx prettier --write`, `npm run lint`, `npm run typecheck`, `npm test`.
- Resultado real: los trece casos cubiertos. 1–9 como tabla `CASOS_TRANSPORTE`
  que pasa cuerpos reales por `sseData` y `TurnAssembler`; 10 de punta a punta
  con `runJob` y un `AbortController` que aborta durante el streaming; 11–13
  sobre `parseConversationMemoryResponse` y `looksLikeCode`. Las terminaciones
  no se escriben a mano a propósito: inventarlas convertiría la prueba en una
  comprobación de que el clasificador es coherente consigo mismo.
- Pruebas: **1.398 pasadas, 9 omitidas, 0 fallos** en 71 archivos. `lint`,
  `typecheck` y `prettier` limpios. Un único fallo durante el desarrollo:
  el estado válido de la memoria se llama `structured`, no `valid`.
- Decisiones: la matriz vive en `apps/agent`, no en `packages/shared`, porque
  el caso 10 necesita `runJob` y `packages/shared` no puede importar `node:*`.
- Riesgos o límites: el caso 10 usa un proveedor simulado. Que Studio pinte bien
  el estado cancelado es `P0.5` y sigue sin comprobarse a mano. `LA-006` y
  `LA-007` siguen pendientes de Daniel y ahora exigen `npm run setup:machine`.
- Estado nuevo: `P0.4` `done`. `LUXY-P0-LONG-RESPONSES` en curso, siguiente paso
  `P0.5`.
- Siguiente paso exacto: `P0.5`, interfaz de recuperación. Los datos ya existen
  (`RESPONSE_OUTCOME_LABELS`, `describeResponseOutcome`, `isRecoverableOutcome`);
  falta llevarlos a Studio y añadir **Continuar generación** sólo para los
  finales recuperables.

### 2026-08-05 23:40 — Claude Code — P0.5

- Estado anterior: `P0.5` `pending`. Todo el diagnóstico existía y viajaba en la
  metadata desde `P0.3c`, pero Studio no lo leía: pintaba `STATUS[status]`, y
  como una respuesta truncada se guarda con `status: completed`, la interfaz
  decía **«Guardado»** encima de una respuesta cortada por la mitad.
- Objetivo: que Daniel entienda qué pasó de verdad y pueda recuperar el trabajo
  sin pulsar Detener para forzar el final.
- Hipótesis o causa demostrada: causa demostrada. El fallo no era del transporte
  sino de la lectura: `status` y `responseOutcome` responden a preguntas
  distintas y la interfaz usaba el primero para contestar la segunda.
- Archivos leídos: `packages/shared/src/response-outcome.ts`,
  `packages/shared/src/constants.ts`, `packages/shared/src/schemas.ts`,
  `apps/desktop/src/renderer/conversation.ts`,
  `apps/desktop/src/renderer/pages/Conversations.tsx`,
  `apps/desktop/src/renderer/ui/primitives.tsx`.
- Archivos modificados: `packages/shared/src/schemas.ts`
  (`describeConversationMemoryStatus`), `apps/desktop/src/renderer/conversation.ts`
  (`conversationOutcomeView`, `conversationTerminationOf`,
  `conversationMemoryStatusOf`, `continuationMessageFor`),
  `apps/desktop/src/renderer/pages/Conversations.tsx`,
  `apps/desktop/src/renderer/conversation.test.ts` (10 pruebas nuevas), más
  `CURRENT-TASK.md`, `TEST-RESULTS.md`, `MASTER-PLAN.md`, `PROJECT-STATE.md` y
  este registro.
- Comandos ejecutados: `npm run build`,
  `npx vitest run apps/desktop/src/renderer/conversation.test.ts`,
  `npx prettier --write`, `npm run lint`, `npm run typecheck`, `npm test`.
- Resultado real: la tarjeta de respuesta muestra la etiqueta del final real,
  el aviso de qué hacer cuando no es `completed`, tokens y duración aunque la
  salida sea parcial, el texto parcial **también** cuando hay error, una frase
  por cada estado de memoria y el botón **Continuar generación** cuando procede.
- Pruebas: **1.408 pasadas, 9 omitidas, 0 fallos** en 71 archivos (antes 1.398).
  `lint`, `typecheck`, `build` y `prettier` limpios. Tres fallos durante el
  desarrollo, todos míos y todos por inventar valores en vez de leer el enum:
  faltaba el quinto estado de memoria (`rejected_code`) en el `switch`, la
  terminación de prueba llevaba un campo inexistente y le faltaba
  `finalUsageReceived`, y `'stream_end'` no es miembro de
  `STREAM_TRANSPORT_ENDS` (es `local_end`).
- Decisiones: (a) el botón usa `isRecoverableOutcome`, así que cubre también
  `timed_out` y no sólo los dos finales que nombra el apartado; una sola fuente
  de verdad, coherente con `describeResponseOutcome`. `cancelled` sigue fuera.
  (b) El botón **sólo rellena el compositor**, con el modelo original y un
  mensaje que nombra el motivo del corte; unir los fragmentos es `P0.6` y aquí
  no se concatena nada a ciegas. (c) El texto parcial se muestra siempre que
  exista, aunque haya `errorMessage`: no se esconden veintitrés minutos de
  generación detrás de un aviso rojo.
- Riesgos o límites: nada de esto se ha visto en pantalla todavía. Studio no
  arranca en este ordenador porque falta la configuración de máquina y cuatro
  secretos (`LA-010`), así que la comprobación es por pruebas, no visual. Sigue
  sin resolverse que una cancelación manual no guarde el texto parcial: la
  interfaz ya sabría pintarlo, pero el gateway no lo envía.
- Estado nuevo: `P0.5` `done`. `LUXY-P0-LONG-RESPONSES` en curso, siguiente paso
  `P0.6`.
- Siguiente paso exacto: `P0.6`. Definir primero dónde vive un artefacto largo y
  con qué límites, luego la unión con detección de solapamiento en
  `packages/shared`, pasando el parcial como dato no confiable.

## Plantilla para próximas entradas

```markdown
### AAAA-MM-DD HH:MM — <IA> — <ID>

- Estado anterior:
- Objetivo:
- Hipótesis o causa demostrada:
- Archivos leídos:
- Archivos modificados:
- Comandos ejecutados:
- Resultado real:
- Pruebas:
- Decisiones:
- Riesgos o límites:
- Estado nuevo:
- Siguiente paso exacto:
```
