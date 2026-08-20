# Luxy — registro de trabajo de IA

### 2026-08-17 — Codex — GIT-CHECKPOINT-001

- Estado anterior: `luxy/auto-init-git` estaba publicado en `1b01fc3`, con 44
  archivos versionados modificados y 9 archivos nuevos del desarrollo posterior.
- Objetivo: consolidar el checkpoint local autorizado por Daniel antes de
  actualizar GitHub, sin incorporar la carpeta principal ni archivos sensibles.
- Archivos revisados: código, pruebas, documentación y lanzadores del worktree
  aislado; los archivos nuevos son políticas/pruebas de notificación y workspace,
  catálogo compartido y cuatro lanzadores `.bat` documentados.
- Comandos ejecutados: `gh auth status`, estado y remotos Git, comparación con
  GitHub, `git diff --check`, búsqueda de patrones de secretos y `npm.cmd run check`.
- Resultado real: GitHub conserva `1b01fc3`, pero no este checkpoint. El escaneo
  sólo encontró credenciales ficticias en pruebas de redacción; no hay claves
  reales en el alcance. Diff sin errores.
- Pruebas: lint y typecheck correctos; 88 archivos, 1.594 pruebas pasadas,
  9 omitidas y 0 fallos; build completo correcto.
- Decisiones: Daniel autorizó el commit y pidió push. El commit se hace sólo en
  `luxy/auto-init-git`. El push sigue sujeto a `allowPush: true` y a la segunda
  confirmación obligatoria; la configuración actual deja `allowPush` sin definir.
- Riesgos o límites: validaciones manuales `LA-024` y `LA-025` siguen pendientes;
  no bloquean conservar el checkpoint, pero sí cerrar funcionalmente esas tareas.
- Estado nuevo: checkpoint validado y autorizado para commit local.
- Siguiente paso exacto: crear el commit; después, activar `allowPush` y pedir la
  segunda confirmación antes de enviar la rama.

### 2026-08-11 12:10 — Codex — F4.8-T5-GATEWAY-GUARD

- Estado anterior: Studio mostraba una ruta preparada, pero el Gateway antiguo
  eliminaba el campo y cada trabajo creaba otro worktree.
- Evidencia: el log local muestra `LUX-8ZLC` a las 12:04 y la carpeta nueva
  correspondiente; el agente sólo reutiliza cuando recibe
  `resumeWorktreePath`.
- Resultado: Desktop comprueba que la respuesta del Gateway conserva
  exactamente la ruta solicitada. Si no, solicita cancelación y explica que hay
  que ejecutar `deploy-gateway.bat`.
- Archivos: `useStudio.ts` y prueba nueva de enlace de workspace.
- Pruebas: focalizadas 107/107; suite 1.594 pasadas, 9 omitidas; lint, typecheck
  y build correctos.
- Siguiente paso: desplegar Gateway, reconstruir y repetir `LA-024`.

### 2026-08-11 12:00 — Codex — UI-JOB-FOCUS

- Estado anterior: tras finalizar un trabajo, la ventana seguía dibujando los
  controles activos pero no aceptaba desplegables ni escritura.
- Causa observada en código: cada final/fallo crea un toast nativo de Electron
  incluso con la ventana enfocada; es el único efecto global del cierre y los
  avisos aparecen en las capturas del fallo. Confirmación manual pendiente.
- Archivos modificados: `apps/desktop/src/main/index.ts`, nueva política y su
  prueba, y documentación de continuidad.
- Resultado real: los toasts de trabajos se suprimen sólo cuando Luxy está
  visible y enfocado; siguen activos en segundo plano.
- Pruebas: focalizadas 34/34; suite 1.592 pasadas, 9 omitidas; lint, typecheck y
  build completos correctos.
- Riesgo: el bloqueo sólo puede darse por confirmado tras repetirlo en Electron
  sobre Windows.
- Siguiente paso exacto: `LA-025`.

### 2026-08-11 11:42 — Codex — F4.8-T5

- Estado anterior: cada tarea normal creaba otra carpeta; sólo un reintento de
  fallo podía recuperar su worktree.
- Objetivo: preparar la carpeta antes del prompt y reutilizarla en trabajos
  sucesivos.
- Causa demostrada: el contrato de creación no aceptaba un worktree elegido y
  Desktop no tenía una operación local para prepararlo.
- Archivos modificados: contratos shared/IPC, host y controlador del agente,
  handlers de Desktop y Gateway, Studio, estilos, pruebas y documentación.
- Resultado real: Studio prepara y abre una carpeta confinada, recuerda su
  selección ligada a máquina/proyecto, la transporta al trabajo y permite
  recuperar la ruta desde el historial. El agente reutiliza y protege el
  contenido existente.
- Pruebas: focalizadas 162/162; lint, typecheck, suite 1.590 pasadas y 9
  omitidas, y build completo correctos.
- Decisiones: sin migración; la ruta viaja en metadata existente. Conversaciones
  y Laboratorio no admiten worktrees preparados.
- Riesgos o límites: falta publicar Gateway y validación manual con proveedor;
  no se hizo deploy, commit ni push.
- Estado nuevo: implementado y verificado automáticamente.
- Siguiente paso exacto: ejecutar `LA-024`.

Registro cronológico y append-only. No reescribir una entrada anterior para que
parezca correcta; añadir una corrección nueva.

### 2026-08-20 — Codex — CONSOLIDATE-WORKTREES-001

- Estado anterior: fases terminadas y correcciones posteriores estaban repartidas entre varios worktrees, con riesgo de arrancar una rama antigua.
- Archivos y ramas integrados: `luxy/auto-init-git` y `luxy/phase-4d-session-host`.
- Resultado: commits de integración `82e728a` y `cbac4f2`; cada uno pasó `npm.cmd run check` (1.602 y 1.622 pruebas pasadas, respectivamente; 9 omitidas).
- Límites: quedan cambios sin commit en otros worktrees; se preservan y se integrarán por bloque. Los archivos personales y de claves no se versionan.
- Siguiente paso exacto: integrar los cambios pendientes de catálogo, timeout y compatibilidad sobre esta rama.

### 2026-08-20 — Codex — BUG-RATE-LIMIT-UX-001

- Archivos modificados: `http-provider.ts` y su prueba.
- Resultado: cada reintento HTTP 429 publica su espera en los eventos; el aviso final explica que se agotaron los intentos.
- Pruebas: `npm.cmd test -- --run apps/agent/src/providers/providers.test.ts`, 73 pasadas.
- Estado nuevo: commit local `ac38bcd`; sin llamadas reales, push, despliegue ni migraciones.

### 2026-08-20 — Codex — BUG-TIMEOUT-DEEPSEEK-001

- Archivos modificados: `http-provider.ts` y su prueba.
- Resultado: un límite de salida durante razonamiento sin texto visible se clasifica y explica sin revelar razonamiento ni reintentar inútilmente.
- Pruebas: `npm.cmd test -- --run apps/agent/src/providers/providers.test.ts`, 75 pasadas.
- Estado nuevo: commit local `0976308`; sin llamadas reales, push, despliegue ni migraciones.

### 2026-08-20 — Codex — BUG-HUNYUAN-002

- Estado anterior: el Studio reiniciado desde `luxy/ux-001-detalle-trabajo` rechazaba los trabajos históricos con `provider: hunyuan` y mostraba el error de Zod completo.
- Causa demostrada: la corrección previa quedó sin commit en el worktree `lux/bug-hunyuan-backcompat`; esta rama se creó desde una base anterior.
- Archivos modificados: contrato compartido, aliases y etiquetas de proveedores, protecciones de reintento/continuación y pruebas de esquema.
- Resultado: el historial se lee con identificadores seguros y las acciones de ejecución sólo aceptan proveedores reconocidos. Studio fue reconstruido y reiniciado desde esta rama.
- Validación automática: `npm.cmd run check` correcta, 1.582 pruebas pasadas y 9 omitidas; sin llamadas reales, push, despliegue ni migraciones.
- Corrección del reinicio: el primer lanzamiento directo apuntó por error a la raíz del monorepo y Electron mostró «Unable to find Electron app». Se cerró ese proceso y se abrió correctamente el paquete `apps/desktop`.
- Siguiente paso: completar la comprobación visual `LA-021`.

### 2026-08-20 — Codex — CATALOG-DETECTED-003

- Objetivo: integrar el bloque pendiente de catálogo sin confundir el proveedor histórico `hunyuan` con la familia de modelo `hy3`.
- Archivos modificados: catálogo y parser de `/v1/models` compartidos, tipos, vista de Configuración y pruebas de catálogo/registro.
- Resultado: `hy3` queda en la familia `other`; los modelos de texto nuevos detectados exponen sólo texto y streaming, sin herramientas, capacidades de agente ni contratos inventados. La lectura de trabajos con `provider: hunyuan` se conserva en el bloque de compatibilidad anterior.
- Pruebas: `catalog-fetch.test.ts` y `registry.test.ts`, 53 pasadas; `npm.cmd run typecheck`, exit 0.
- Límites: no hubo llamadas reales, push, despliegue ni migraciones. Quedan más cambios sin commit en otros worktrees por revisar.
- Siguiente paso exacto: crear el commit local y continuar con el siguiente bloque aislado.

### 2026-08-10 — Codex — F4.8-T4

- Observación: el retry reanudaba la misma ruta y rama, pero el modelo recibía
  otra vez el prompt original y comenzaba anunciando la llamada 1; después el
  proveedor devolvía HTTP 503.
- Cambio: `buildProviderPrompt` añade instrucciones específicas de continuación
  cuando existe `resumeFromJobId` o `resumeWorktreePath`: inspeccionar el estado
  Git, conservar archivos y commits y continuar sólo con la parte incompleta.
- Archivos modificados: `apps/agent/src/job-runner.ts`,
  `apps/agent/src/agent.test.ts` y esta documentación de continuidad.
- Decisión: el reintento conserva un nuevo registro de auditoría, pero no se
  pretende conservar automáticamente el contexto interno del proveedor; el
  worktree y sus commits son la fuente de verdad.
- Riesgo abierto: HTTP 503 sigue siendo un fallo transitorio de MiniMax; esta
  mejora evita reiniciar el trabajo lógico, pero no puede reparar una caída del
  proveedor.
- Siguiente paso exacto: ejecutar las comprobaciones y reconstruir Desktop.

### 2026-08-10 — Codex — F4.8-T4b

- Observación: `LUX-H7SA` estaba cancelado con “Sin eventos todavía”; nunca
  había reclamado un worktree, por lo que no podía reanudarse.
- Cambio: Studio detecta la ausencia de `worktreePath` y crea un intento nuevo
  desde el proyecto base; los trabajos que sí tienen worktree conservan el
  flujo de reanudación.
- Verificación: lint, typecheck, Desktop 328/328 pruebas y build pasados.

### 2026-08-10 — Codex — F4.8-T4c

- Observación: Kimi devolvió “paso 2” y una pregunta aunque la tarea pedía
  completar la web en varias llamadas; Luxy lo clasificó como `completed` al no
  haber otra herramienta solicitada.
- Cambio: el prompt agentic exige continuar fases autónomas, no preguntar al
  usuario y responder sólo tras crear y comprobar todos los requisitos.
- Verificación: lint, typecheck, agente 76/76 pruebas y build de Desktop
  pasados.
- Riesgo: el modelo puede ignorar instrucciones; una validación semántica
  universal de “web completa” requiere criterios específicos por tarea.

### 2026-08-10 — Codex — F4.8-T4d

- Observación: Qwen devolvió HTTP 429 por límite de frecuencia.
- Cambio: las vueltas agentic reintentan ahora un 429 hasta tres intentos,
  respetando `Retry-After` y mostrando el tiempo de espera como evento; no se
  reintentan 401 ni errores con contenido parcial.
- Verificación: lint, typecheck, providers 72/72 y build de Desktop pasados.

### 2026-08-10 — Codex — F4.8-T1 — inicio

- Estado anterior: una carpeta sin repositorio Git hacía fallar el trabajo editable antes de crear el worktree.
- Objetivo: inicializar Git automáticamente cuando el proyecto permite edición y crear un baseline local seguro.
- Hipótesis: el bloqueo de la captura pertenece a la comprobación `isGitRepository`; el soporte existente sólo cubre repositorios Git sin `HEAD`.
- Archivos previstos: `apps/agent/src/git.ts`, `apps/agent/src/job-runner.ts`, pruebas del agente y documentación de seguridad/continuidad.
- Decisión: la inicialización será sólo para `allowEdits: true`, sin remoto, con `.gitignore` creado únicamente si falta y commit local `estado inicial`.
- Siguiente paso exacto: implementar y ejecutar la prueba focalizada.

### 2026-08-10 — Codex — F4.8-T1 — implementación

- Archivos modificados: `apps/agent/src/git.ts`, `apps/agent/src/job-runner.ts`, `apps/agent/src/agent.test.ts`, documentación de seguridad y continuidad.
- Resultado real: un proyecto editable sin Git crea `.gitignore` si falta, ejecuta `git init`, excluye secretos/dependencias/salidas y crea `estado inicial` con identidad local de Luxy; después continúa por `createWorktree`.
- Pruebas: `vitest run apps/agent/src/agent.test.ts` — **72/72 pasadas**; cubre `.env`, `node_modules`, archivos normales y mensaje del commit. `npm run lint` pasó. `typecheck` falló antes de compilar por falta de `@cloudflare/workers-types`; suite completa y build quedan pendientes.
- Decisiones: no se crea remoto; `.gitignore` existente nunca se sobrescribe; `allowEdits: false` sigue sin inicializar nada.
- Estado nuevo: implementado; verificación completa bloqueada por dependencia ambiental.
- Siguiente paso exacto: instalar/restaurar las dependencias autorizadas, reconstruir Desktop/agente y probar el flujo real en un proyecto no-Git.

### 2026-08-10 — Codex — F4.8-T2

- Estado anterior: **Reintentar trabajo** creaba otro trabajo y otro worktree, perdiendo el contexto de la página ya escrita.
- Cambio: Studio envía `resumeJobId`; Gateway valida propietario, máquina, proyecto, proveedor, modelo, prompt y estado terminal. El agente valida la ruta bajo `%LOCALAPPDATA%\Luxy\worktrees`, su pertenencia al repositorio base y la rama `luxy/...`, y reanuda el worktree.
- Archivos modificados: `packages/shared/src/schemas.ts`, `apps/gateway/src/handlers/studio.ts`, `apps/desktop/src/renderer/pages/Studio.tsx`, `apps/agent/src/git.ts`, `apps/agent/src/job-runner.ts`, `apps/agent/src/agent.test.ts`.
- Resultado real: implementado; el nuevo registro audita el intento, pero la ejecución continúa en la misma página/rama.
- Pruebas: nueva prueba de reanudación añadida; matriz completa pendiente por dependencia `@cloudflare/workers-types` ausente.
- Siguiente paso exacto: restaurar dependencias, ejecutar `npm run check` y validar manualmente el reintento de `LUX-L9CC`.

### 2026-08-10 — Codex — F4.8-T3

- Observación: el primer intento con auto-inicialización falló con `ENOENT` al escribir `C:\Users\daniel\Desktop\test\.gitignore`.
- Causa demostrada: la ruta configurada no existe en este portátil.
- Cambio: `ensureGitRepository` valida existencia y tipo de carpeta antes de escribir y devuelve un `GitError` accionable.
- Prueba añadida: ruta inexistente identificada como tal.
- Siguiente paso exacto: seleccionar la carpeta real del proyecto en Ajustes y reconstruir el agente con este cambio.

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

### 2026-08-06 08:20 — Claude Code — P0.6a

- Estado anterior: `P0.6` `pending`. Studio ya sabía **pedir** la continuación
  (`P0.5`), pero nadie unía los fragmentos: el botón sólo rellenaba el
  compositor.
- Discrepancia encontrada al abrir, registrada antes de tocar nada: la
  documentación describe el trabajo como «sin commitear» sobre
  `luxy/work-update-001-studio` en `C:\Users\Daniel\Desktop\proyecto github\Luxy`
  (`LA-008`). El worktree real es `C:\Users\daniel\Desktop\Luxy`, rama
  `feat/luxy-desktop`, **árbol limpio**, y `P0.0`–`P0.5` ya están commiteados
  (`9012eda`, `16c6e9a`, `845c3cb`, `c6e5094`). El riesgo de las 7.997 líneas sin
  commit de `LA-008` **ya no existe**. No se limpió ni se movió nada.
- Objetivo: unir una respuesta cortada con su continuación sin duplicar texto y
  sin descartar nada sin evidencia.
- Hipótesis o causa demostrada: no aplica, es una capacidad nueva.
- Archivos leídos: `packages/shared/src/response-outcome.ts`,
  `packages/shared/src/constants.ts`, `packages/shared/src/index.ts`,
  `apps/desktop/src/renderer/conversation.ts`,
  `apps/desktop/src/renderer/pages/Conversations.tsx`,
  `apps/desktop/src/renderer/useConversations.ts`.
- Archivos modificados: `packages/shared/src/continuation.ts` (nuevo),
  `packages/shared/src/continuation.test.ts` (nuevo, 18 pruebas),
  `packages/shared/src/constants.ts` (cinco constantes nuevas),
  `packages/shared/src/index.ts`, `CURRENT-TASK.md`.
- Comandos ejecutados: `npm run build`, `npm test` (línea base),
  `npx vitest run packages/shared/src/continuation.test.ts`,
  `npx prettier --write`, `npm run lint`, `npm run typecheck`, `npm test`.
- Resultado real: `joinContinuation` decide dónde empieza lo nuevo con cinco
  estrategias —`overlap`, `resynced`, `restart`, `duplicate`, `appended`— y
  siempre dice cuál usó. `continuationTail` acota el final que se le enseña al
  modelo. Línea base antes de tocar nada: **1.408 pasadas**, igual que dejó
  `P0.5`.
- Pruebas: 18 nuevas, **1.426 pasadas, 9 omitidas, 0 fallos** en 72 archivos.
  Tres fallos durante el desarrollo, los tres por umbrales inventados en vez de
  medidos: el ancla de resincronización exigía 120 caracteres repetidos cuando
  un modelo repite una línea; el solapamiento mínimo de 24 dejaba fuera
  `      <li>Segundo</li>` (22 caracteres); y el corte por salto de línea de
  `continuationTail` usaba un tercio del trozo en vez de la mitad.
- Decisiones: (a) sin evidencia de continuidad **no se descarta texto**: se pega
  y se marca `needsReview`. Perder contenido es peor que una costura fea.
  (b) La resincronización sólo mira una ventana de 2.000 caracteres al principio
  de la continuación: buscar el ancla en todo el texto encontraría repeticiones
  legítimas más abajo y borraría contenido bueno. (c) `restart` se comprueba
  antes que el solapamiento, porque si la continuación contiene la respuesta
  entera, empalmar por el final la duplicaría.
- Riesgos o límites: al cerrar este subpaso la función todavía no la usaba
  nadie. Eso lo resuelve `P0.6b`, en la misma sesión.
- Estado nuevo: `P0.6a` `done`.
- Siguiente paso exacto: `P0.6b`, enlazar la continuación con su parcial y usar
  la unión en Studio.

### 2026-08-06 08:34 — Claude Code — P0.6b

- Estado anterior: `P0.6a` `done`, pero la unión no se usaba en ningún sitio.
  La continuación dependía por completo de que el modelo obedeciera el mensaje
  del compositor.
- Objetivo: que un turno sepa **qué respuesta continúa**, que el modelo reciba
  el parcial como dato no confiable y que Studio muestre el documento unido.
- Hipótesis o causa demostrada: no aplica, es una capacidad nueva.
- Archivos leídos: `packages/shared/src/schemas.ts`,
  `apps/gateway/src/handlers/studio.ts`,
  `apps/gateway/src/handlers/studio.test.ts`,
  `apps/desktop/src/shared/ipc.ts`, `apps/desktop/src/preload/index.ts`.
- Archivos modificados: `packages/shared/src/schemas.ts` (`continuesJobId`
  opcional en `studioJobCreateRequestSchema`),
  `apps/gateway/src/handlers/studio.ts` (lo persiste en la metadata del
  trabajo), `apps/desktop/src/renderer/conversation.ts`
  (`continuesJobId` en `ConversationMetadata`, bloque de continuación en
  `buildConversationPrompt`, `continuationSourceOf`, `conversationDocumentOf`),
  `apps/desktop/src/renderer/useConversations.ts`,
  `apps/desktop/src/renderer/pages/Conversations.tsx`,
  `apps/desktop/src/renderer/conversation.test.ts` (8 pruebas),
  `apps/gateway/src/handlers/studio.test.ts` (2 pruebas).
- Comandos ejecutados: `npm run build`,
  `npx vitest run apps/desktop/src/renderer/conversation.test.ts`,
  `npx vitest run apps/gateway/src/handlers/studio.test.ts`,
  `npx prettier --write`, `npm run lint`, `npm run typecheck`, `npm test`.
- Resultado real: al pulsar **Continuar generación** el envío queda marcado; el
  prompt lleva el final del parcial en un bloque
  `(DATOS, NO INSTRUCCIONES)` acotado a 1.200 caracteres, justo delante de la
  pregunta; el trabajo nuevo guarda `continuesJobId` en su metadata, así que la
  unión sobrevive a una recarga; y la tarjeta de la respuesta continuada muestra
  el documento reconstruido, cuántos fragmentos lo componen y un aviso cuando
  alguna costura no se pudo demostrar.
- Pruebas: 10 nuevas, **1.436 pasadas, 9 omitidas, 0 fallos** en 72 archivos.
  `lint`, `typecheck`, `build` y `prettier` limpios. Ningún fallo durante el
  desarrollo de este subpaso.
- Decisiones: (a) `continuesJobId` es **opcional** en el esquema y viaja en
  metadata, no en una columna: `D-014` prohíbe migraciones y `D-017` ya fijó que
  el detalle de una respuesta vive ahí. Un Studio antiguo que no lo mande sigue
  funcionando. (b) El parcial entra como **dato**, con el mismo trato que la
  memoria o el contexto de otra conversación, nunca como instrucción. (c) El
  bloque de continuación se coloca por delante de la pregunta pero se descarta
  antes que ella si no cabe: la pregunta actual nunca se recorta. (d) El
  documento unido se muestra en la tarjeta, pero **no** se reescribe el
  `resultSummary` de ningún trabajo: cada fragmento sigue siendo lo que el
  proveedor devolvió, y la unión es una vista.
- Riesgos o límites: (1) nada de esto se ha visto en pantalla — Studio sigue sin
  arrancar en este ordenador por `LA-010`, así que lo verificado es el contrato,
  no el píxel; (2) la memoria acumulativa todavía se cierra turno a turno: no
  espera a que la secuencia esté completa, que es lo que queda del apartado;
  (3) sigue sin existir la ruta de artefacto (`D-013`), así que un documento
  largo vive en `resultSummary` de cada fragmento; (4) una cancelación manual
  sigue sin conservar el texto parcial (viene del gateway, no de aquí).
- Estado nuevo: `P0.6b` `done`. `P0.6` sigue `in_progress` por `P0.6c`.
- Siguiente paso exacto: `P0.6c`. **Decidir antes de escribir código** dónde
  vive un artefacto largo y con qué límites: sin Supabase Storage ni nada
  facturable, el candidato natural es un archivo bajo
  `%LOCALAPPDATA%\Luxy\artifacts\<jobId>\` escrito por el agente, con el gateway
  guardando sólo la referencia. Esa decisión la aprueba Daniel antes de tocar
  código.

### 2026-08-06 09:20 — Claude Code — P0.8

- Estado anterior: `P0.6c` era el siguiente paso, pero Daniel arrancó Studio y
  observó un bucle de peticiones contra el gateway cada menos de 3 segundos.
  Esto pasa por delante: es gasto real contra Supabase.
- Objetivo: dejar de sondear lo que no puede haber cambiado.
- **Causa demostrada**, leyendo la salida de `wrangler` que pegó Daniel y el
  código del renderer: `useConversations` recargaba cada **1.500 ms** las
  opciones, la lista de trabajos y el detalle de **cada** respuesta visible,
  aunque llevara horas guardada. Con seis respuestas en pantalla son 8
  peticiones cada 1,5 s ≈ **19.200 a la hora**, y coincide con las 29.432 del
  panel en 60 minutos. `useStudio` hacía lo mismo cada 3 s.
- Archivos leídos: `apps/desktop/src/renderer/useConversations.ts`,
  `apps/desktop/src/renderer/useStudio.ts`, `apps/agent/src/agent.ts`,
  `packages/shared/src/schemas.ts`.
- Archivos modificados: `apps/desktop/src/renderer/conversation.ts`
  (`conversationPollDelayMs`, `conversationDetailsToFetch` y sus constantes),
  `apps/desktop/src/renderer/useConversations.ts`,
  `apps/desktop/src/renderer/useStudio.ts`,
  `apps/desktop/src/renderer/conversation.test.ts` (7 pruebas).
- Comandos ejecutados: `npm run build`,
  `npx vitest run apps/desktop/src/renderer/conversation.test.ts apps/desktop/src/renderer/useConversations.test.ts`,
  `npx prettier --write`, `npm run lint`, `npm run typecheck`, `npm test`.
- Resultado real, tres cambios:
  1. **el detalle de un trabajo terminado no se vuelve a pedir.** La lista ya
     trae el trabajo entero en cada vuelta y sirve de testigo: si el estado, el
     `completedAt` y el `resultSummary` no han cambiado y el trabajo ya había
     terminado, su detalle tampoco puede haber cambiado. Un trabajo vivo se pide
     siempre;
  2. **el ritmo depende de lo que pasa**: 1,5 s con algo corriendo, 10 s sin
     nada, 60 s con la ventana oculta. Al volver a la ventana se refresca en el
     acto, y enviar o detener recalcula el ritmo sin esperar al temporizador
     lento;
  3. **las opciones caducan a los 30 s** en vez de pedirse en cada vuelta.
- Cuentas, con una conversación de seis respuestas guardadas y nada corriendo:
  antes 8 peticiones cada 1,5 s (**≈19.200/h**), ahora 1 lista cada 10 s más las
  opciones cada 30 s (**≈480/h**). Con la ventana oculta, 60/h. Es una
  estimación aritmética a partir del código, no una medición: **la medición la
  tiene que dar el panel de Supabase de Daniel tras reiniciar Studio**
  (`LA-012`).
- Pruebas: 7 nuevas, **1.443 pasadas, 9 omitidas, 0 fallos** en 72 archivos.
  `lint`, `typecheck`, `build` y `prettier` limpios.
- Decisiones: (a) la cache de detalles vive en un ref y se sincroniza también al
  valorar y al cancelar; si se quedara atrás, el sondeo dejaría de refrescar ese
  trabajo, que es peor que la petición de más. (b) La ventana oculta manda sobre
  «hay algo corriendo»: si nadie mira, el streaming no urge. (c) **No he tocado
  el sondeo del agente** (`pollIntervalMs`, 2 s por defecto, ≈1.800 reclamaciones
  a la hora): es la decisión de arquitectura `0001`, vive en la configuración de
  máquina de Daniel y subirlo retrasa el arranque de los trabajos. Queda
  anotado en `LA-012` como decisión suya.
- Riesgos o límites: sin comprobación visual todavía; lo verificado es el
  contrato de las dos funciones puras, no el número real de peticiones. Si
  Daniel ve que una respuesta tarda hasta 10 s en aparecer estando la ventana
  en segundo plano, es esto y es deliberado.
- Estado nuevo: `P0.8` `done`.
- Siguiente paso exacto: Daniel reinicia Studio y confirma la caída de
  peticiones en el panel (`LA-012`). Después, `P0.6c`, que sigue bloqueado por
  la decisión de `LA-011`.

### 2026-08-06 09:40 — Claude Code — P0.9

- Estado anterior: `P0.8` bajó el sondeo en reposo, pero durante una generación
  Studio seguía preguntando cada 1,5 s por el texto de una respuesta que estaba
  produciendo un proceso hijo suyo.
- Objetivo, pedido por Daniel: reducir drásticamente las llamadas **sin perder
  funcionalidad**.
- Hecho observado en el código, no hipótesis: el agente corre en un utility
  process de Studio y ya publica `job.claimed`, `job.output`, `job.completed`,
  `job.failed` y `job.cancelled` con `jobId`
  (`packages/shared/src/agent-events.ts`); el renderer ya se suscribe en
  `useAgent.ts:112`. En una conversación, cada `provider_output` lleva el texto
  **acumulado** (`http-provider.ts:760`), que es justo lo que pinta la tarjeta.
- Archivos leídos: `packages/shared/src/agent-events.ts`,
  `apps/desktop/src/renderer/useAgent.ts`, `apps/desktop/src/preload/index.ts`,
  `apps/agent/src/agent.ts`, `apps/agent/src/job-runner.ts`,
  `apps/agent/src/providers/http-provider.ts`.
- Archivos modificados: `apps/desktop/src/renderer/conversation.ts`
  (`reduceLocalJobStream`, `activeJobsAreLocal`, `localFirstTokenMs`,
  `streamedLocally` en `conversationPollDelayMs`),
  `apps/desktop/src/renderer/useConversations.ts` (suscripción al bus local y
  recarga dirigida por evento), `apps/desktop/src/renderer/pages/Conversations.tsx`,
  `apps/desktop/src/renderer/conversation.test.ts` (8 pruebas).
- Comandos ejecutados: `npm run build`,
  `npx vitest run apps/desktop/src/renderer/conversation.test.ts`,
  `npx prettier --write`, `npm run lint`, `npm run typecheck`, `npm test`.
- Resultado real: durante una generación en esta máquina el texto se pinta
  desde el bus local, **sin ninguna petición**; el final de un trabajo dispara
  **una** recarga dirigida en vez de un sondeo a ciegas; y con todo lo vivo en
  local el sondeo baja de 1,5 s a 10 s. Una conversación completa pasa de ~40
  peticiones por minuto de generación a ~7.
- Pruebas: 8 nuevas, **1.451 pasadas, 9 omitidas, 0 fallos** en 72 archivos.
  `lint`, `typecheck`, `build` y `prettier` limpios.
- Decisiones: (a) **los eventos disparan la lectura, no la sustituyen.** Un
  evento local dice que el agente terminó, no lo que quedó guardado; el final
  real (`responseOutcome`, memoria, tokens) se sigue leyendo del trabajo
  persistido. El bus es best-effort y un proceso puede reiniciar. (b) Basta una
  respuesta viva de **otra** máquina para volver al sondeo de 1,5 s: de esa no
  llega ningún evento local, y perderla de vista sería perder funcionalidad.
  (c) Se conserva el contador de «primer texto» midiéndolo con el primer
  `job.output` local, porque durante el directo ya no se piden los eventos
  guardados.
- Riesgos o límites: (1) sin comprobación visual, como todo lo anterior;
  (2) el texto en vivo sigue recortado a 4.000 caracteres, que es lo que emite
  el proveedor por evento — comportamiento anterior, no una regresión nueva;
  (3) no toca el sondeo del agente al gateway.
- Estado nuevo: `P0.9` `done`.
- Siguiente paso exacto: `LA-012`, que ahora cubre `P0.8` **y** `P0.9`. Después,
  `P0.6c`, bloqueado por `LA-011`.

### 2026-08-06 09:55 — Claude Code — P0.6d

- Estado anterior: `P0.6c` bloqueado por `LA-011` (decisión de Daniel). Se coge
  lo que `P0.2` dejó apuntado como límite y aparcado para `P0.6`: una
  cancelación manual no conservaba el texto generado. La interfaz ya sabía
  pintarlo desde `P0.5`; el texto no llegaba.
- Objetivo: que pulsar **Detener** no cueste lo ya generado.
- Causa demostrada, leída en el código: `buildCancelledOutcome` sólo devolvía
  archivos modificados, worktree y duración; `handleJobCancelled` guardaba
  estado y metadata, sin `result_summary`. El texto recuperado existía en
  `recoveredText` y se tiraba.
- Archivos leídos: `apps/agent/src/job-runner.ts`, `apps/agent/src/agent.ts`,
  `apps/gateway/src/handlers/api.ts`, `apps/gateway/src/handlers/studio.ts`,
  `packages/shared/src/schemas.ts`.
- Archivos modificados: `packages/shared/src/schemas.ts` (`partialText` y
  `responseTermination` opcionales en `jobCancelledRequestSchema`),
  `apps/agent/src/job-runner.ts`, `apps/agent/src/agent.ts`,
  `apps/gateway/src/handlers/api.ts`,
  `apps/agent/src/response-matrix.test.ts` (caso 10 ampliado),
  `apps/gateway/src/handlers/cancelled-events.test.ts` (2 pruebas).
- Comandos ejecutados: `npm run build`,
  `npx vitest run apps/agent/src/response-matrix.test.ts`,
  `npx vitest run apps/gateway/src/handlers/cancelled-events.test.ts`,
  `npx prettier --write`, `npm run lint`, `npm run typecheck`, `npm test`.
- Resultado real: al cancelar, el agente manda lo generado —redactado y con el
  mismo tope que un resultado normal— junto al diagnóstico; el gateway lo guarda
  como `result_summary` y marca `responseOutcome: 'cancelled'` en la metadata.
  Sin texto no se inventa nada: ni resultado ni final.
- Pruebas: 2 nuevas y una ampliada, **1.453 pasadas, 9 omitidas, 0 fallos** en
  72 archivos. `lint`, `typecheck`, `build` y `prettier` limpios.
- Decisiones: (a) `cancelled` **sigue fuera** de `RECOVERABLE_RESPONSE_OUTCOMES`.
  El texto se conserva y se ve, pero no aparece **Continuar generación**: lo paró
  una persona y sabe por qué. Cambiar eso es otra decisión, no un efecto
  colateral. (b) Una cancelación **no escribe memoria**, igual que antes: sólo
  un final `completed` la sustituye (`D-019`). (c) Los campos nuevos son
  opcionales: un agente anterior sigue cancelando igual.
- Riesgos o límites: sin comprobación visual (`LA-010`/`LA-012`). El camino
  rápido de Studio (`finishConversationCancellation`, cuando el trabajo aún no
  llegó al agente) sigue cerrando sin resultado, y es correcto: ahí no hay texto
  que guardar.
- Estado nuevo: `P0.6d` `done`. `F2.13` del plan maestro pasa a `implemented`.
- Siguiente paso exacto: `P0.6c`, aún bloqueado por `LA-011`. Si Daniel prefiere
  abrir el bloque de aprendizaje antes, la evaluación de las diez ideas está en
  su respuesta y necesita que elija cuáles entran.

### 2026-08-06 13:05 — Claude Code — P0.6c

- Estado anterior: `P0.6c` bloqueado por `LA-011`. Daniel decidió: **archivo en
  su disco**, opción A.
- Objetivo: que una salida larga deje de vivir en una columna de texto y pase a
  ser un archivo que se pueda abrir (`D-013`).
- Hipótesis o causa demostrada: no aplica, es una capacidad nueva.
- Archivos leídos: `packages/shared/src/paths.ts`, `apps/agent/src/paths.ts`,
  `apps/desktop/src/main/ipc/handlers.ts`, `apps/desktop/src/shared/channels.ts`,
  `apps/desktop/src/shared/ipc.ts`, `apps/desktop/src/main/index.ts`.
- Archivos modificados: `packages/shared/src/artifacts.ts` (nuevo),
  `packages/shared/src/artifacts.test.ts` (nuevo, 12 pruebas),
  `packages/shared/src/constants.ts`, `packages/shared/src/schemas.ts`
  (`jobArtifactSchema`), `packages/shared/src/index.ts`,
  `apps/agent/src/artifacts.ts` (nuevo),
  `apps/agent/src/artifacts.test.ts` (nuevo, 5 pruebas),
  `apps/agent/src/job-runner.ts`, `apps/gateway/src/handlers/api.ts`,
  `apps/desktop/src/shared/channels.ts`, `apps/desktop/src/shared/ipc.ts`,
  `apps/desktop/src/preload/index.ts`,
  `apps/desktop/src/main/ipc/handlers.ts`, `apps/desktop/src/main/index.ts`,
  `apps/desktop/src/renderer/conversation.ts`,
  `apps/desktop/src/renderer/pages/Conversations.tsx`.
- Comandos ejecutados: `npm run build`,
  `npx vitest run packages/shared/src/artifacts.test.ts apps/agent/src/artifacts.test.ts`,
  `npx prettier --write`, `npm run lint`, `npm run typecheck`, `npm test`.
- Resultado real: cuando una respuesta de conversación es **larga y además un
  documento**, el agente la escribe en
  `%LOCALAPPDATA%\Luxyrtifacts\<jobId>\<LUX-XXXX>.<ext>`, el gateway guarda
  sólo la referencia (nombre, tipo, bytes, sha-256, fecha) en la metadata, y la
  tarjeta de Studio la muestra con un botón **Abrir carpeta**.
- Pruebas: 17 nuevas, **1.470 pasadas, 9 omitidas, 0 fallos** en 74 archivos.
  `lint`, `typecheck`, `build` y `prettier` limpios. Un fallo de lint durante el
  desarrollo: `ARTIFACT_KINDS` sólo se usa como tipo en `artifacts.ts` y
  `consistent-type-imports` exige `import type`.
- Decisiones: (a) **el nombre lo construye Luxy**, nunca el modelo: sale del
  `shortId` del trabajo filtrado a `[A-Z0-9-]`, y la extensión de un detector de
  contenido. Dejar que un texto generado elija nombre es dejarle elegir dónde
  cae. (b) Dos barreras, no una: el nombre se filtra al construirlo **y** la
  ruta final se comprueba contra la raíz antes de escribir. (c) Hacen falta las
  **dos** condiciones —largo y documento— para escribir archivo: una explicación
  de 10.000 caracteres es una respuesta que se lee, no un archivo que se abre.
  (d) El artefacto **no sustituye** al resultado: `resultSummary` sigue llevando
  el texto, así que nada cambia para quien sólo mira la tarjeta. (e) Si escribir
  falla, se avisa y el trabajo sigue: un artefacto es una mejora, no un
  requisito. (f) El renderer manda sólo el `jobId` por IPC, nunca una ruta: la
  raíz la calcula el proceso principal.
- Riesgos o límites: (1) el archivo vive en la máquina que lo generó — desde
  otra máquina la referencia se ve pero no el contenido, que es la pega conocida
  de la opción elegida; (2) nadie borra artefactos todavía: no hay caducidad ni
  cuota total, sólo el tope de 2 MB por archivo; (3) sin comprobación visual
  (`LA-012`); (4) sigue faltando cerrar la memoria acumulativa sólo cuando la
  secuencia esté completa, que era la otra mitad de `P0.6c`.
- Estado nuevo: `P0.6c` `done` en su parte de artefactos. `LA-011` resuelta.
- Siguiente paso exacto: `P0.7`, validación y cierre del bloque P0 — o el bloque
  de aprendizaje, si Daniel elige antes las ideas y el presupuesto.

### 2026-08-06 13:55 — Claude Code — F4.1-T1

- Estado anterior: el catálogo de modelos está **escrito a mano** en
  `models/catalog.ts`, con 8.192 tokens de salida para todos los modelos, un
  número que nunca se verificó. `LA-007` lleva abierta desde que `LUX-3966`
  terminó con `finish_reason: length` justo ahí.
- Objetivo, pedido por Daniel: que Luxy consulte los modelos y los precios
  reales de la pasarela en vez de creerse una lista estática.
- Investigación previa, con su resultado real: `https://api.hcnsec.cn/pricing`
  es una SPA del panel _New API_ y no se puede leer sin JavaScript; `/v1/models`
  y `/api/pricing` devuelven **401**. Por búsqueda web se confirma que es un
  relay público y gratuito de 新疆幻城网安 que agrupa 30–40 proveedores en
  formato OpenAI, con créditos de regalo y **sin SLA**. Conclusión: la lista
  sólo se puede obtener con la clave, luego la tiene que pedir Luxy.
- Archivos leídos: `apps/desktop/src/main/ipc/handlers.ts` (prueba de conexión
  existente), `apps/desktop/src/shared/ipc.ts`,
  `packages/shared/src/models/catalog.ts`,
  `apps/desktop/src/renderer/pages/Config.tsx`.
- Archivos modificados: `packages/shared/src/models/catalog-fetch.ts` (nuevo),
  `packages/shared/src/models/catalog-fetch.test.ts` (nuevo, 11 pruebas),
  `packages/shared/src/models/index.ts`,
  `apps/desktop/src/main/catalog-store.ts` (nuevo),
  `apps/desktop/src/main/ipc/handlers.ts`, `apps/desktop/src/main/index.ts`,
  `apps/desktop/src/shared/channels.ts`, `apps/desktop/src/shared/ipc.ts`,
  `apps/desktop/src/preload/index.ts`,
  `apps/desktop/src/renderer/pages/Config.tsx`.
- Comandos ejecutados: `npm run build`,
  `npx vitest run packages/shared/src/models/catalog-fetch.test.ts`,
  `npx prettier --write`, `npm run lint`, `npm run typecheck`, `npm test`.
- Resultado real: en **Modelos** hay un panel «Catálogo real de la conexión» con
  un botón que consulta `/v1/models` y, después, `/api/pricing`. El resultado se
  guarda con fecha en `%LOCALAPPDATA%\Luxy\catalog\<conexion>.json` y se pinta
  agrupado por familia, diciendo de cada modelo si se cobra **por tokens** o
  **por llamada**.
- Pruebas: 11 nuevas, **1.481 pasadas, 9 omitidas, 0 fallos** en 75 archivos.
  `lint`, `typecheck`, `build` y `prettier` limpios.
- Decisiones: (a) **manda `/v1/models`**: un precio suelto no inventa un modelo,
  y un modelo servido sin precio se lista igual marcado `unknown`. No saber lo
  que cuesta no es motivo para esconderlo. (b) El parseo de precios acepta
  **cualquier forma**: todos los campos son opcionales y hay `passthrough`.
  Todavía no se ha visto una respuesta real de esta pasarela y exigir campos
  haría que un cambio menor tirase el catálogo entero. (c) **No se convierten
  los multiplicadores a dinero.** `model_ratio` se guarda tal cual; traducirlo a
  yuanes exige saber la unidad de crédito de la pasarela, y un número inventado
  aquí sería peor que no dar ninguno. Se decide con la respuesta real delante.
  (d) La clave **no cruza el IPC**: el renderer manda sólo el identificador de
  conexión, la URL sale de la configuración guardada y la petición la hace el
  proceso principal, igual que la prueba de conexión existente.
- Riesgos o límites: (1) nadie ha ejecutado todavía la consulta contra la
  pasarela real, así que el parseo de precios está probado contra la forma
  **documentada** de _New API_, no contra su respuesta; (2) el catálogo real es
  **informativo**: todavía no alimenta `models/catalog.ts` ni el
  `maxOutputTokens` que se envía, que es lo que cerraría `LA-007`; (3) el
  archivo guardado no contiene claves, sólo nombres, multiplicadores y grupos.
- Estado nuevo: `F4.1` `implemented` en su primera mitad.
- Siguiente paso exacto: Daniel pulsa **Consultar a la pasarela** y me pasa lo
  que salga (`LA-014`). Con la respuesta real: ajustar el parseo si hace falta,
  traducir multiplicadores a coste y llevar el `maxOutputTokens` verificado al
  catálogo, que cierra `LA-007` y `F2.14`.

### 2026-08-06 14:05 — Claude Code — F4.1-T2

- Estado anterior: Daniel abrió **Modelos** y los **19 modelos del catálogo**
  salían «no disponible», cada uno con `la conexion "API China" no sirve el
modelo X`. Con la clave puesta y trabajos ejecutándose contra esa misma
  conexión ese mismo día.
- **Causa demostrada**, leída en el código: `buildRegistry` en
  `apps/desktop/src/renderer/pages/Config.tsx` pasaba `availableModels: []` con
  el comentario «sin sincronizar todavia: no se afirma que un modelo este
  disponible». Pero `ModelRegistry.resolve` hacía
  `status.availableModels.includes(apiModel)` sobre una lista vacía, que da
  `false`, no `null`. O sea: **afirmaba justo lo que el comentario decía que no
  iba a afirmar**. No era un fallo de la conexión ni del catálogo.
- Archivos leídos: `packages/shared/src/models/registry.ts`,
  `packages/shared/src/models/registry.test.ts`,
  `apps/desktop/src/renderer/pages/Config.tsx`.
- Archivos modificados: `packages/shared/src/models/registry.ts` (una lista
  vacía es «no se sabe», no «no sirve ninguno»),
  `packages/shared/src/models/registry.test.ts` (prueba del caso real),
  `apps/desktop/src/renderer/pages/Config.tsx` (la pantalla usa el catálogo real
  guardado cuando existe, y comparte ese estado con el panel de `F4.1-T1`).
- Comandos ejecutados: `npm run build`,
  `npx vitest run packages/shared/src/models/registry.test.ts`,
  `npx prettier --write`, `npm run lint`, `npm run typecheck`, `npm test`.
- Resultado real: sin catálogo consultado, los modelos salen **«sin comprobar»**
  en vez de «no disponible». Tras pulsar **Consultar a la pasarela**, la
  disponibilidad se calcula contra lo que la pasarela dice servir de verdad, con
  su fecha.
- Pruebas: 1 nueva, **1.482 pasadas, 9 omitidas, 0 fallos** en 75 archivos.
  `lint`, `typecheck`, `build` y `prettier` limpios.
- Decisiones: el arreglo va en `registry.ts`, no en la pantalla. Una conexión que
  funciona sirve **algo**, así que cero modelos sólo puede significar que nadie
  ha preguntado. Arreglarlo únicamente en la pantalla dejaría la misma trampa
  para el siguiente que construya un registro.
- Riesgos o límites: Daniel está viendo un Studio con el build anterior, así que
  ni este arreglo ni el panel de `F4.1-T1` aparecen hasta reconstruir y
  reiniciar (`LA-004`, `LA-012`, `LA-014`).
- Estado nuevo: corregido.
- Siguiente paso exacto: `LA-014` — reconstruir, pulsar el botón y devolver el
  JSON del catálogo.

### 2026-08-07 08:45 — Claude Code + Daniel — F4.1-T3 y despliegue

- Estado anterior: en `portatil-clase`, Conversaciones daba
  `el gateway respondio 404: ruta no encontrada` y 0 conversaciones.
- **Causa demostrada**: `gatewayUrl` de esa máquina apunta al Worker desplegado
  `https://luxy-gateway.dlux135.workers.dev`, y ese despliegue era **anterior a
  Studio**: tenía `/api/machines/*` y `/api/jobs/*` —por eso agente y gateway
  salían en verde— pero ninguna ruta `/api/studio/*`. No había nada escuchando
  en el 8787, así que no era wrangler local.
- Acción de Daniel, autorizada por él: `npx wrangler deploy` del gateway actual.
  Versión `096f2623-c6cc-4dcd-94d3-b41a12608ea4`.
- Verificación hecha desde aquí, sin credenciales: `GET /api/studio/options`
  devuelve **401**, no 404 ni 500. Los tres datos que da esa única respuesta:
  la ruta existe (el despliegue llegó), `envSchema` valida (los secretos están
  puestos en Cloudflare aunque no aparezcan en la lista de bindings), y la
  autenticación rechaza lo no autenticado.
- Por qué el despliegue no necesitó migración: todo lo de `P0.1`–`P0.9` viaja en
  `metadata` por diseño (`D-014`, `D-017`). El enum de Postgres no se tocó.
- Compatibilidad: la otra máquina sigue con el agente del 30 de julio y no se
  rompe, porque los campos nuevos del contrato son todos opcionales.

- Datos reales del catálogo, leídos de
  `%LOCALAPPDATA%\Luxy\catalog\hcnsec.json` el 2026-08-07 06:08 UTC: la
  pasarela sirve **22 modelos**, no los 19 del catálogo escrito a mano.
  - Sirve dos que el catálogo da por **no servidos**: `sensenova-6.7-flash-lite`
    y `sensenova-u1-fast`. Hay una prueba en `registry.test.ts` que afirma lo
    contrario y ahora es falsa.
  - Sirve uno que no existía cuando se escribió: `step-explore`.
  - **Cero precios**: `pricingAvailable: false` y `notice: null`, o sea que la
    ruta contestó algo que parseó pero sin entradas, y no había forma de saber
    qué.
- Archivos modificados: `packages/shared/src/models/catalog-fetch.ts`
  (`PricingProbe`, `describePricingProbes`, familias step/step-media/minimax/
  sensenova/router), `packages/shared/src/models/catalog-fetch.test.ts`
  (4 pruebas más), `apps/desktop/src/main/ipc/handlers.ts` (prueba tres rutas de
  precios y apunta código HTTP, claves y número de entradas de cada una),
  `apps/desktop/src/shared/ipc.ts`.
- Comandos ejecutados: `npm run build`, `npx vitest run packages/shared/src/models/`,
  `npx prettier --write`, `npm run lint`, `npm run typecheck`, `npm test`.
- Pruebas: 4 nuevas, **1.486 pasadas, 9 omitidas, 0 fallos** en 75 archivos.
- Decisiones: el aviso de «sin precios» pasa a decir **qué contestó cada ruta**.
  Un `sin precios declarados` mudo no se puede depurar; `/api/pricing: 200 con 0
entradas (success, data)` sí.
- Riesgos o límites: (1) el catálogo real sigue siendo informativo y no alimenta
  `models/catalog.ts` ni el `maxOutputTokens` efectivo; (2) la prueba de
  `registry.test.ts` sobre modelos «no servidos» está desmentida por los datos y
  hay que corregirla con criterio, no borrarla; (3) nada de `P0.6`–`P0.9` se ha
  visto funcionar todavía contra el gateway nuevo.
- Estado nuevo: gateway desplegado con el código actual; `LA-014` cumplida en su
  primera vuelta.
- Siguiente paso exacto: en Studio de desarrollo, comprobar Conversaciones ya sin
  404, y repetir **Consultar a la pasarela** para leer el diagnóstico de precios.

### 2026-08-09 — Codex — DOC-CHECKPOINT-002

- Estado anterior: la rama real estaba en `59870c6` y sincronizada con origen,
  pero `CURRENT-TASK.md`, `PROJECT-STATE.md`, `MASTER-PLAN.md` y
  `LOCAL-ACTIONS.md` todavía presentaban `P0.6c`, el push y partes de `F4.1`
  como pendientes.
- Objetivo: reconciliar la memoria canónica antes de continuar código.
- Hipótesis o causa demostrada: documentación de relevo no actualizada después
  de los commits `265fd64` y `59870c6`; comprobado con Git y el código actual.
- Archivos leídos: documentos obligatorios de relevo, historial reciente,
  catálogo, registro, instantánea real y pantalla de Modelos.
- Archivos modificados: `CURRENT-TASK.md`, `PROJECT-STATE.md`,
  `MASTER-PLAN.md`, `LOCAL-ACTIONS.md`, `CHANGELOG-WORK.md`.
- Comandos ejecutados: `git status --short --branch`, `git diff --stat`,
  `git log`, `git branch -r` y `git rev-parse` sobre ramas local/remotas.
- Resultado real: HEAD y `origin/feat/luxy-desktop` son `59870c6`; el rescate
  de Remote existe en origen como `e27aa05`; se preservan el cambio ajeno de
  `package-lock.json` y los archivos sin seguimiento.
- Pruebas: no aplica todavía; reconciliación documental y comprobaciones Git de
  solo lectura.
- Decisiones: continuar como `F4.1-T4`; no reabrir `P0.6c` ni repetir pushes.
- Riesgos o límites: precios y topes reales siguen sin evidencia; no se leen
  secretos ni se llama a la pasarela.
- Estado nuevo: `DOC-CHECKPOINT-002` `done`; `F4.1-T4` `in_progress`.
- Siguiente paso exacto: representar en el catálogo operativo los tres modelos
  observados que faltan, con capacidades conservadoras y pruebas sin red.

### 2026-08-09 — Codex — F4.1-T4

- Estado anterior: la lectura real de la pasarela contenía 22 modelos, pero
  `buildDefaultCatalog` conservaba 19 y una prueba afirmaba que dos SenseNova no
  se servían.
- Objetivo: llevar los tres modelos observados al catálogo operativo sin
  inventar capacidades, herramientas, precios ni límites.
- Hipótesis o causa demostrada: la instantánea sólo alimentaba
  `availableModels`; `step-explore`, `sensenova-6.7-flash-lite` y
  `sensenova-u1-fast` no tenían definición y por tanto no llegaban al registro.
- Archivos leídos: catálogo, tipos, registro y pruebas de modelos; pantalla de
  Modelos; persistencia y parseo de la instantánea real.
- Archivos modificados: `packages/shared/src/models/types.ts`, `catalog.ts`,
  `registry.ts`, `registry.test.ts`; `apps/desktop/src/renderer/pages/Config.tsx`;
  documentación canónica.
- Comandos ejecutados: Prettier, Vitest específico, `npm run lint`,
  `npm run typecheck`, `npm test`, `npm run build`, siempre mediante RTK.
- Resultado real: el catálogo operativo contiene los 22 identificadores. Los
  tres nuevos sólo declaran texto, quedan no agentic, sin herramientas, sin
  alias y con contrato no verificado. Un alias de familia exige ahora un modelo
  predeterminado explícito.
- Pruebas: primera ejecución específica: 49 pasadas y 1 fallo, porque la familia
  nueva inventaba `/sensenova`; corregido. Ejecución específica final: 88/88.
  Suite completa: 1.488 pasadas, 9 omitidas, 0 fallos en 75 archivos. Lint,
  tipos y build: exit 0. El primer `git diff --check` detectó los dos espacios
  finales usados como salto Markdown en dos líneas nuevas; se sustituyeron por
  párrafos y la repetición terminó con exit 0.
- Decisiones: representar disponibilidad observada no autoriza a afirmar tool
  calling, rapidez, precio o máximo de salida; se mantienen desconocidos.
- Riesgos o límites: el `maxOutputTokens` por defecto sigue siendo 8.192 y no se
  presenta como verificado; la segunda lectura de precios requiere `LA-014`.
- Estado nuevo: `F4.1-T4` `done`; `F4.1` `implemented`, pendiente de evidencia
  manual para precios y topes.
- Siguiente paso exacto: Daniel reconstruye Studio y repite **Consultar a la
  pasarela** (`LA-014`).

### 2026-08-09 — Codex + Daniel — F4.1-T5

- Estado anterior: Studio pedía `/v1/models` y después probaba tres rutas de
  precios; la pantalla mostraba el diagnóstico y repetía «sin precio» para cada
  modelo.
- Objetivo: dejar de consultar precios que la pasarela no publica.
- Hipótesis o causa demostrada: captura de Daniel con 22 modelos y tres sondeos
  sin entradas útiles: dos respuestas vacías y un 404.
- Archivos leídos: handler IPC del catálogo, pantalla de Modelos, contratos IPC,
  parser y pruebas del catálogo.
- Archivos modificados: `apps/desktop/src/main/ipc/handlers.ts`,
  `apps/desktop/src/renderer/pages/Config.tsx`, prueba de catálogo y documentos
  de continuidad/decisión.
- Comandos ejecutados: Prettier, Vitest específico, búsqueda de rutas de precio,
  `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.
- Verificación de llamadas: la búsqueda de `/api/pricing`, `/v1/pricing` y
  `/api/models` en `apps/desktop/src` devolvió 0 coincidencias y exit 1, que es
  la convención de `rg` cuando no encuentra resultados.
- Resultado real: **Actualizar modelos** realiza una sola petición a
  `/v1/models`. La interfaz muestra una nota neutra única y sólo lista nombres;
  desaparecen el diagnóstico de rutas y las etiquetas por modelo.
- Pruebas: 80/80 específicas; suite completa 1.488 pasadas, 9 omitidas, 0
  fallos en 75 archivos. Lint, tipos y build: exit 0. La primera comprobación
  del diff encontró un salto Markdown con whitespace final en `DECISIONS.md`;
  se sustituyó por un párrafo y la repetición quedó limpia.
- Decisiones: `D-022`; una conexión futura con API de precios documentada
  necesitará integración explícita. No se prueban rutas tentativas.
- Riesgos o límites: los campos antiguos de precio se conservan en el formato
  del snapshot para leer archivos existentes, pero no provocan red ni se pintan.
- Estado nuevo: `F4.1-T5` `done`; `LA-014` cerrada por decisión.
- Siguiente paso exacto: reconstruir/reiniciar Studio para cargar el renderer
  nuevo; el botón queda sólo para actualizar modelos.

### 2026-08-09 — Codex — F4.2-T1

- Estado anterior: Modelos mostraba catálogo y disponibilidad declarada por la
  conexión, pero no utilizaba la evidencia de trabajos ya guardados.
- Objetivo: resumir disponibilidad, velocidad, estabilidad y errores por modelo
  sin ejecutar benchmarks ni llamadas de proveedor.
- Hipótesis o causa demostrada: `StudioJob` ya conserva `model`, estado,
  `responseOutcome`, `durationMs`, fechas y error. No hace falta esquema nuevo.
- Archivos leídos: contratos de trabajos, gateway de Studio, hooks de historial,
  pantalla de Modelos y reglas de finales de respuesta.
- Archivos modificados: nuevos `model-evidence.ts` y
  `model-evidence.test.ts`, `Config.tsx` y documentación canónica.
- Comandos ejecutados: Prettier, Vitest específico, `npm run lint`,
  `npm run typecheck`, `npm test`, `npm run build`.
- Resultado real: al abrir Modelos se leen una vez hasta 100 trabajos. Por
  modelo exacto se muestran completas/observaciones, porcentaje, mediana de las
  completas, truncadas, interrumpidas, timeout, fallidas y canceladas aparte.
- Pruebas: 71/71 específicas; suite completa **1.494 pasadas, 9 omitidas, 0
  fallos** en 76 archivos. Lint, tipos y build: exit 0.
- Decisiones: (a) no inferir modelo desde proveedor; (b) cancelaciones no miden
  inestabilidad del modelo; (c) la velocidad usa sólo respuestas completas;
  (d) una lectura por apertura, nunca polling.
- Riesgos o límites: muestra máxima de 100 trabajos; ejecuciones con `model:
null` no pueden atribuirse; falta confirmación visual.
- Estado nuevo: `F4.2-T1` `done`; `F4.2` `implemented` inicialmente.
- Siguiente paso exacto: `LA-017`, reconstruir Studio y comprobar la vista.

### 2026-08-09 — Codex — F4.2-T2

- Estado anterior: las métricas sólo podían atribuir trabajos cuyo campo
  `model` ya contenía un identificador exacto; al pedir una familia, el modelo
  predeterminado resuelto por el agente podía perderse.
- Objetivo: conservar el `apiModel` realmente ejecutado y usarlo como evidencia
  en completados, fallos y cancelaciones, manteniendo compatibilidad con
  agentes y trabajos anteriores.
- Hipótesis o causa demostrada: el agente resolvía el modelo antes de invocar al
  proveedor, pero los contratos de resultado no transportaban ese dato hasta
  el gateway. Si el proveedor devuelve `usage.model`, ésa es la evidencia más
  precisa y debe prevalecer.
- Archivos modificados: `packages/shared/src/schemas.ts`,
  `apps/agent/src/job-runner.ts`, `apps/agent/src/agent.ts`,
  `apps/gateway/src/handlers/api.ts`,
  `apps/desktop/src/renderer/model-evidence.ts` y sus pruebas relacionadas.
- Comandos ejecutados: build de `@luxy/shared`, Prettier, Vitest específico,
  `npm run lint`, `npm run typecheck`, `npm test` y `npm run build`, mediante
  RTK.
- Resultado real: `executedModel` viaja en todos los finales. Gateway rellena
  `model` sólo si estaba vacío, conserva además `metadata.executedModel` y usa
  el modelo efectivo en la fuente de memoria de conversación. El agregador
  prefiere `job.model` y acepta la metadata sólo si es una cadena válida.
- Pruebas: primera matriz específica, 28 pasadas y 3 fallos porque Gateway
  cargaba el `dist` anterior de `@luxy/shared`; tras reconstruirlo, 30 pasadas y
  1 fallo real: la cancelación de una fixture heredada omitía `model` y no se
  trataba como vacío. Corregido sin sobrescribir valores existentes. Matriz
  final 31/31; suite completa 1.497 pasadas, 9 omitidas, 0 fallos en 76
  archivos. Lint, tipos y build: exit 0. Las 64 pruebas documentales, Prettier
  sobre los archivos del paso y `git diff --check` también pasan. El
  `format:check` global sigue fallando por deuda previa extendida y por el HTML
  inválido de `Web demos/GLM demos/index.html`; no se modificaron esos archivos
  ajenos al paso.
- Decisiones: no inferir modelos históricos; guardar evidencia explícita. Un
  `usage.model` del proveedor prevalece sobre el predeterminado resuelto.
- Riesgos o límites: agentes antiguos no envían el campo; los trabajos ya
  guardados sin modelo continúan sin atribución. Falta validación visual.
- Estado nuevo: `F4.2-T2` `done`; `LA-017` queda como acción activa de Daniel.
- Siguiente paso exacto: reconstruir/reiniciar Studio y el agente, y ejecutar
  la lista ampliada de `LA-017`.

### 2026-08-09 — Codex — F4.2-T3

- Estado anterior: Modelos pedía una sola página de 100 trabajos y el agregador
  descartaba cualquier elemento posterior, aunque el historial durable pudiera
  ser mayor.
- Objetivo: paginar la evidencia sin polling ni carga ilimitada y mostrar la
  cobertura real de la muestra.
- Hipótesis o causa demostrada: el contrato validaba sólo `limit`; repositorio y
  PostgREST no recibían desplazamiento. La limitación estaba en toda la ruta,
  no sólo en el renderer.
- Archivos leídos: contratos compartidos e IPC, cliente de Gateway, handler de
  Studio, repositorio/PostgREST, pantalla y agregador de Modelos y pruebas.
- Archivos modificados: `packages/shared/src/schemas.ts`,
  `apps/desktop/src/shared/ipc.ts`, `apps/agent/src/gateway-client.ts`,
  `apps/gateway/src/supabase.ts`, `repository.ts`, `handlers/studio.ts`,
  `apps/desktop/src/renderer/model-evidence.ts`, `pages/Config.tsx` y cuatro
  archivos de pruebas.
- Comandos ejecutados: build de `@luxy/shared`, Prettier, Vitest específico,
  `npm run lint`, `npm run typecheck`, `npm test` y `npm run build`, siempre con
  RTK.
- Resultado real: `offset` opcional y validado llega hasta PostgREST. Modelos
  lee páginas de 100 una sola vez, deduplica por ID, limita la revisión a 1.000
  y hace una sonda de un registro para distinguir muestra completa de truncada.
  Si un Gateway anterior repite la primera página, se detiene y lo avisa.
- Pruebas: matriz específica final 60/60. Suite completa 1.504 pasadas, 9
  omitidas, 0 fallos en 76 archivos. Lint, tipos y build: exit 0.
- Fallo durante desarrollo: el primer `typecheck` encontró tres consumidores
  antiguos porque el valor por defecto de Zod hacía `offset` obligatorio en el
  tipo IPC. Se dejó opcional en Desktop y el valor `0` se aplica en Gateway;
  repetición verde.
- Decisiones: máximo local de 1.000 trabajos para evitar una lectura sin límite;
  la interfaz declara el tope en vez de ocultarlo. No hay polling.
- Riesgos o límites: el Gateway desplegado no se actualizó. Un Desktop nuevo
  contra esa versión mostrará el aviso de paginación detenida hasta probar en
  local o autorizar deploy.
- Estado nuevo: `F4.2-T3` `done`; `LA-017` vuelve a ser el paso activo.
- Siguiente paso exacto: reconstruir Studio y agente, usar Gateway actualizado
  y ejecutar la lista de `LA-017`.

### 2026-08-09 — Codex — F4.3-T1

- Estado anterior: F4.3 enumeraba áreas de prueba, pero no existía Laboratorio
  ni un contrato reproducible; cualquier comparación futura habría tenido que
  inventar prompts y criterios en la interfaz.
- Objetivo: crear el catálogo versionado y hacerlo revisable sin permitir aún
  ejecuciones ni consumo de tokens.
- Hipótesis o causa demostrada: no había ninguna definición de benchmark en
  shared, Desktop, agente o Gateway. Las puntuaciones existentes pertenecían al
  router y al feedback, no a evaluaciones reproducibles.
- Archivos leídos: navegación de Desktop, primitivas visuales, catálogo y tipos
  de modelos, exports compartidos y estilos existentes.
- Archivos modificados: nuevos `packages/shared/src/models/evaluations.ts`,
  `evaluations.test.ts` y `apps/desktop/src/renderer/pages/Laboratory.tsx`;
  además `models/index.ts`, `App.tsx` y documentación canónica.
- Comandos ejecutados: build de `@luxy/shared`, Prettier, Vitest específico,
  `npm run lint`, `npm run typecheck`, `npm test` y `npm run build`, mediante
  RTK.
- Resultado real: ocho definiciones validadas cubren todas las áreas de F4.3.
  Cada una fija versión, prompt, estrategia de scoring, capacidades, fixture y
  criterios. La nueva navegación Laboratorio las muestra y declara modo
  preparación; `executionEnabled` sólo admite `false`.
- Pruebas: 46/46 específicas; suite completa 1.507 pasadas, 9 omitidas, 0
  fallos en 77 archivos. Lint, tipos y build: exit 0.
- Decisiones: separar definición de ejecución. Tener un prompt catalogado no
  autoriza a llamar al proveedor; el runner exigirá una acción explícita y será
  otro paso.
- Riesgos o límites: las fixtures se nombran pero todavía no existen; no hay
  validadores, selector, persistencia ni puntuaciones. La pantalla es catálogo,
  no benchmark funcional.
- Estado nuevo: `F4.3-T1` `done`; `LA-018` queda pendiente.
- Siguiente paso exacto: validar visualmente el catálogo y después implementar
  `F4.3-T2`, fixtures y validadores locales sin red.

### 2026-08-09 — Codex — F4.3-T2

- Estado anterior: el catálogo nombraba seis fixtures y estrategias de scoring,
  pero las fixtures no existían y ninguna salida podía evaluarse localmente.
- Objetivo: materializar datos reproducibles y separar validación pura de los
  runners que requieren aislamiento o juicio humano.
- Hipótesis o causa demostrada: `fixtureId` era sólo una referencia textual. No
  había contenido, resolución por ID ni función de validación en el repositorio.
- Archivos leídos: catálogo de evaluaciones, tipos de modelos, pantalla
  Laboratorio, exports compartidos y pruebas del área.
- Archivos modificados: nuevo
  `packages/shared/src/models/evaluation-fixtures.ts` y su prueba;
  `evaluations.ts`, `models/index.ts`, `Laboratory.tsx` y documentación.
- Comandos ejecutados: build de `@luxy/shared`, Prettier, Vitest específico,
  `npm run lint`, `npm run typecheck`, `npm test` y `npm run build`, con RTK.
- Resultado real: seis fixtures versionadas y validadas, sin archivos
  temporales ni red. El contexto largo se genera igual en cada lectura con
  1.200 líneas y cuatro anclas; tool calling usa archivos virtuales. Cuatro
  validadores puros devuelven checks explicables. Ninguna salida se ejecuta.
- Pruebas: 53/53 específicas; suite completa 1.514 pasadas, 9 omitidas, 0
  fallos en 78 archivos. Lint, tipos y build: exit 0.
- Decisiones: una prueba de código no se puntúa hasta disponer de sandbox; una
  rúbrica o traza no se presenta como automática. `validationMode` fija esta
  distinción en el contrato.
- Riesgos o límites: los validadores existen como lógica compartida, pero aún no
  hay respuestas reales que pasarles; Laboratorio sigue sin selector ni botón.
- Estado nuevo: `F4.3-T2` `done`; `LA-018` permanece pendiente y ampliada.
- Siguiente paso exacto: `F4.3-T3`, selección compatible y previsualización del
  prompt compuesto sin enviar nada.

### 2026-08-09 — Codex — F4.3-T3

- Estado anterior: catálogo, fixtures y validadores existían, pero no había
  forma de elegir una prueba/modelo ni revisar el prompt que recibiría el
  proveedor.
- Objetivo: preparar una ejecución de forma completamente local y auditable,
  manteniendo deshabilitado el envío.
- Hipótesis o causa demostrada: Laboratorio sólo renderizaba las tarjetas; no
  componía fixtures ni cruzaba requisitos con el catálogo operativo.
- Archivos leídos: Laboratorio, configuración disponible en App, catálogo de
  modelos, evaluaciones, fixtures, primitivas visuales y pruebas.
- Archivos modificados: `evaluations.ts`, `evaluation-fixtures.ts` y sus pruebas;
  `Laboratory.tsx`, `App.tsx` y documentación canónica.
- Comandos ejecutados: build de `@luxy/shared`, Prettier, Vitest específico,
  `npm run lint`, `npm run typecheck`, `npm test` y `npm run build`, mediante
  RTK.
- Resultado real: filtro puro por capacidades declaradas y estado habilitado;
  prompt determinista con cabecera, versión, instrucciones y fixture delimitada
  como datos. Studio muestra selectores, modelo efectivo de la vista previa,
  tamaño, fixture y contenido completo. No existe botón ni llamada IPC.
- Pruebas: 55/55 específicas; suite completa 1.516 pasadas, 9 omitidas, 0
  fallos en 78 archivos. Lint, tipos y build: exit 0.
- Decisiones: la lista compatible es una lectura del catálogo, no evidencia de
  capacidad. El prompt no cambia entre modelos para conservar comparabilidad.
- Riesgos o límites: el catálogo puede declarar capacidades aún no verificadas;
  ninguna selección se persiste y el prompt largo puede ser grande al abrir su
  detalle, aunque sólo se genera en memoria.
- Estado nuevo: `F4.3-T3` `done`; `LA-018` permanece pendiente y ampliada.
- Siguiente paso exacto: diseñar confirmación y persistencia antes de habilitar
  la primera ejecución (`F4.3-T4`/`F4.5`).

### 2026-08-09 — Codex — F4.3-T4

- Estado anterior: Laboratorio componía una vista previa comparable, pero no
  existía contrato de confirmación, persistencia ni aislamiento específico para
  una futura ejecución.
- Objetivo: fijar esas fronteras sin conectar la interfaz a ningún proveedor.
- Hipótesis o causa demostrada: los trabajos existentes ya conservan prompt,
  modelo y metadata; no hace falta migración, pero una tarea normal podría
  recibir worktree y herramientas si se reutilizara sin un modo propio.
- Archivos leídos: contratos shared, handler y pruebas de Studio, job runner,
  Laboratorio y documentación canónica.
- Archivos modificados: esquemas/evaluaciones shared, handler del Gateway, job
  runner, Laboratorio, tres suites de contrato/aislamiento y documentación.
- Comandos ejecutados: build de `@luxy/shared`, Prettier, Vitest específico,
  lint, typecheck, suite completa y build mediante RTK.
- Resultado real: `mode: evaluation` exige modelo exacto, confirmación literal
  y snapshot versionado. Gateway compara definición y prompt con el catálogo y
  persiste metadata sin score. El agente impide edición, herramientas, memoria
  y checks. La UI sólo muestra confirmación futura y botón deshabilitado.
- Pruebas: 37/37 específicas; suite completa 1.523 pasadas, 9 omitidas, 0
  fallos en 80 archivos. Lint, tipos y build: exit 0.
- Decisiones: `D-023`; definir, seleccionar o marcar una casilla no sustituye
  la acción de ejecución. Toda puntuación debe proceder de un validador real.
- Riesgos o límites: el endpoint ya entiende el contrato confirmado, pero el
  renderer no lo invoca. Sandbox, rúbricas, trazas, comparaciones y scores aún
  no están conectados.
- Estado nuevo: `F4.3-T4` `done`; `LA-018` permanece pendiente y ampliada.
- Siguiente paso exacto: `F4.3-T5`, contrato de resultado y validación local de
  salidas persistidas, manteniendo deshabilitada la ejecución desde UI.

### 2026-08-09 — Codex — F4.3-T5

- Estado anterior: el trabajo podía conservar la definición confirmada, pero
  su salida no se vinculaba a un resultado validado y trazable.
- Objetivo: validar en el cierre las pruebas automáticas sin activar ninguna
  ejecución ni confundir una salida parcial con un suspenso.
- Hipótesis o causa demostrada: `handleJobComplete` ya reúne snapshot, salida,
  modelo, final, duración y usage; aplicar ahí lógica pura evita una segunda
  lectura y no requiere migración.
- Archivos modificados: nuevo `evaluation-results.ts` y su suite, export shared,
  handler final del Gateway, pruebas del cierre y documentación canónica.
- Resultado real: contrato persistible con `passed`, `failed` y `not_scored`;
  guarda checks y métricas observadas. Sólo valida `completed` con catálogo
  vigente. Modos manual/sandbox/traza explican por qué siguen sin puntuación.
- Pruebas: 18/18 específicas; suite completa 1.531 pasadas, 9 omitidas, 0
  fallos en 81 archivos. Lint, tipos y build: exit 0.
- Decisiones: `D-024`; no hay nota numérica ni ranking. Un corte de transporte
  no se atribuye como fallo de calidad del modelo.
- Riesgos o límites: no hay UI de resultados ni trabajos reales; el botón sigue
  deshabilitado. `evaluationValidatedAt` se genera al persistir en Gateway.
- Estado nuevo: `F4.3-T5` `done`; `LA-018` permanece pendiente.
- Siguiente paso exacto: diseñar la primera ejecución individual y cómo mostrar
  su resultado, manteniendo fuera comparaciones y runners no implementados.

### 2026-08-09 — Codex — F4.3-T6

- Estado anterior: Gateway podía guardar resultados validados, pero Laboratorio
  no tenía forma de leerlos o distinguirlos de metadata arbitraria.
- Objetivo: mostrar evidencia histórica sin habilitar ejecución ni polling.
- Hipótesis o causa demostrada: la lista existente de trabajos ya contiene toda
  la metadata necesaria; basta una lectura acotada y un parser estricto.
- Archivos modificados: nuevos `evaluation-history.ts` y su prueba,
  `Laboratory.tsx` y documentación canónica.
- Resultado real: lectura única de 100 trabajos al montar, actualización manual
  y hasta 12 resultados visibles. Se muestran estado, checks, modelo, fecha,
  duración, caracteres y tokens; metadata incoherente se descarta.
- Pruebas: 104/104 específicas; suite completa 1.535 pasadas, 9 omitidas, 0
  fallos en 82 archivos. Lint, tipos y build: exit 0.
- Decisiones: `D-025`; consultar historial no autoriza a ejecutar y no necesita
  un temporizador.
- Riesgos o límites: resultados más antiguos que los últimos 100 trabajos no
  aparecen. No hay datos reales hasta que se habilite y ejecute una evaluación.
- Estado nuevo: `F4.3-T6` `done`; `LA-018` queda ampliada.
- Siguiente paso exacto: definir política y estados de la primera ejecución
  individual antes de conectar el botón.

### 2026-08-09 — Codex — F4.3-T7

- Estado anterior: contrato, validación e historial estaban listos, pero el
  renderer nunca creaba una evaluación.
- Objetivo: abrir una primera ejecución individual con el mínimo alcance seguro.
- Archivos modificados: catálogo y pruebas, política nueva del renderer,
  Laboratorio, handler/pruebas de Studio y documentación.
- Resultado real: cuatro pruebas automáticas habilitadas; selección de
  máquina/proyecto/modelo, casilla y diálogo final. Gateway rechaza modos no
  automáticos, revalida prompt/snapshot y comprueba evaluaciones activas. El
  agente conserva el aislamiento de solo lectura implementado en T4.
- Pruebas: 50/50 específicas; suite completa 1.541 pasadas, 9 omitidas, 0
  fallos en 83 archivos. Lint, tipos y build: exit 0.
- Decisiones: `D-026`; precio desconocido sin consulta, una ejecución a la vez
  en la experiencia normal y ninguna puntuación sin validador.
- Riesgos o límites: la comprobación de concurrencia no es transaccional; un
  Gateway anterior rechazará el contrato nuevo. No se hizo ninguna llamada real.
- Estado nuevo: `F4.3-T7` `done`; `LA-018` y `LA-019` pendientes.
- Siguiente paso exacto: validación visual y, sólo si Daniel acepta el consumo,
  una ejecución de rapidez exacta con todas las piezas actualizadas.

### 2026-08-09 — Codex — F4.3-T8

- Estado anterior: se podía crear una evaluación, pero Laboratorio sólo decía
  que se siguiera en Trabajos y una cancelación no generaba resultado evaluable.
- Objetivo: seguimiento activo y cancelación coherente sin reintroducir polling.
- Archivos modificados: parser/pruebas de historial, Laboratorio, handler y
  pruebas de cancelación, y documentación canónica.
- Resultado real: panel activo validado, cancelación confirmada con solicitud no
  repetible en la sesión y cierre `not_scored` aunque no hubiera parcial.
- Pruebas: 38/38 específicas; suite completa 1.543 pasadas, 9 omitidas, 0
  fallos en 83 archivos. Lint, tipos y build: exit 0.
- Decisiones: `D-027`; cancelar no equivale a suspender y el estado sólo se
  vuelve a leer bajo acción explícita.
- Riesgos o límites: si se reinicia Studio antes del cierre, se pierde sólo la
  marca visual local de «solicitada»; Gateway conserva la petición. Hace falta
  pulsar Actualizar para observar el final.
- Estado nuevo: `F4.3-T8` `done`; `LA-018` y `LA-019` pendientes.
- Siguiente paso exacto: validación visual y prueba real opcional con las tres
  piezas actualizadas.

### 2026-08-09 — Codex — COMMIT-F4-MODELOS-LABORATORIO

- Autorización: Daniel pidió explícitamente «Commit y sigue».
- Resultado: commit local con mensaje
  `feat: incorpora modelos y laboratorio reproducible`.
- Alcance: 48 archivos de código, pruebas y documentación de `F4.1-T4/T5`,
  `F4.2-T1/T2/T3` y `F4.3-T1`–`F4.3-T8`.
- Exclusiones preservadas: `package-lock.json`, archivos de claves, demos,
  handoff copiado y `apps/gateway/tail.err`.
- Estado remoto: rama un commit por delante de origen; no se hizo push ni deploy.
- Evidencia previa al commit: 1.543 pasadas, 9 omitidas, 0 fallos; lint, tipos y
  build en verde. `git diff --cached --check` correcto.

### 2026-08-09 — Codex — F4.3-T9

- Estado anterior: completados y cancelados tenían resultado, pero un fallo del
  agente desaparecía del historial validado y un lease interrumpido no tenía
  representación en Laboratorio.
- Objetivo: hacer visibles esos finales sin atribuir calidad inexistente.
- Resultado real: fallos nuevos persistidos `not_scored`; razones específicas
  por cada final no completo; fallback visual estricto para terminales con
  snapshot válido y sin resultado.
- Pruebas: 30/30 específicas; suite completa 1.546 pasadas, 9 omitidas, 0
  fallos en 83 archivos. Lint, tipos y build: exit 0.
- Decisiones: `D-028`; estado operativo y calidad son dimensiones separadas.
- Git: cambio posterior al checkpoint `032f6f4`, todavía sin commit. Sin push ni
  deploy.
- Siguiente paso exacto: validación manual; después, agregación descriptiva con
  umbral de muestra, nunca ranking prematuro.

### 2026-08-09 — Codex — F4.3-T10

- Estado anterior: cada resultado era trazable, pero no existía resumen por
  modelo/prueba y una futura agregación podía exagerar muestras mínimas.
- Objetivo: evidencia descriptiva con umbral explícito, sin ranking.
- Resultado real: grupos por prueba/versión/modelo; tasa sólo desde 3 puntuados;
  medianas sólo sobre resultados puntuados; `not_scored` visible y excluido.
- Pruebas: 19/19 específicas; suite completa 1.548 pasadas, 9 omitidas, 0
  fallos en 83 archivos. Lint, tipos y build finales: exit 0.
- Incidencia: primer build falló por importar el agregador renderer desde
  `@luxy/shared`; ruta corregida y matriz completa repetida en verde.
- Decisiones: `D-029`; tres muestras permiten describir, no recomendar.
- Git: T9/T10 posteriores a `032f6f4`, pendientes de commit. Sin push ni deploy.
- Siguiente paso exacto: validación real y después comparación controlada.

### 2026-08-09 — Codex — F4.4-T1

- Estado anterior: las evaluaciones individuales bloqueaban cualquier segunda
  ejecución activa y no existía identidad compartida para un par comparable.
- Objetivo: definir y proteger en shared/Gateway una comparación de exactamente
  dos modelos, sin habilitar todavía el botón del Desktop.
- Resultado real: snapshot opcional con UUID de grupo e índice 0/1 inseparables;
  el segundo miembro exige un primero activo con mismo grupo, prueba, versión,
  prompt, máquina y proyecto, y un modelo exacto distinto. Las ejecuciones
  individuales conservan la barrera anterior.
- Pruebas: 32/32 específicas; suite completa 1.557 pasadas, 9 omitidas, 0
  fallos en 83 archivos. Prettier, lint, tipos y build: exit 0.
- Incidencia: typecheck detectó un acceso no estrechado a `IpcResult` en la carga
  conjunta del Laboratorio; se separaron las ramas de error y quedó validado.
- Decisión: `D-030`. La comprobación actual no es una transacción de base de
  datos; reduce estados inválidos, pero no promete exclusión frente a dos POST
  verdaderamente simultáneos.
- Git: cambio posterior a `032f6f4`, aún sin commit, push ni deploy.
- Siguiente paso exacto: F4.4-T2, orquestación Desktop del par con una sola
  confirmación y recuperación explícita si sólo se acepta uno de los miembros.

### 2026-08-09 — Codex — F4.4-T2

- Estado anterior: shared/Gateway aceptaban un par válido, pero Desktop no podía
  construirlo ni representar una aceptación parcial.
- Objetivo: orquestar la comparación desde Laboratorio sin ejecución implícita.
- Resultado real: selector individual/comparación, segundo modelo compatible,
  una confirmación que enumera ambos modelos y dos POST ordenados con UUID común.
  Si falla el primero no se envía el segundo; si falla el segundo se conserva y
  muestra el identificador del primero, sin reintento automático.
- Pruebas: 40/40 específicas; suite completa 1.561 pasadas, 9 omitidas, 0
  fallos en 84 archivos. Prettier, lint, tipos y build: exit 0.
- Riesgos o límites: cada miembro consume tokens reales sólo tras confirmar; el
  par todavía se presenta como dos trabajos/resultados separados y conserva el
  límite no transaccional de `D-030`.
- Git: T9/T10 y F4.4-T1/T2 siguen posteriores a `032f6f4`, sin commit, push ni
  deploy.
- Siguiente paso exacto: F4.4-T3, reconstruir y presentar juntos los dos
  miembros por UUID, incluidos parcial, cancelación y fallo sin puntuación falsa.

### 2026-08-09 — Codex — checkpoint y F4.4-T3

- Checkpoint: commit local `3771549 feat: añade evidencia y comparación
controlada`; 23 archivos, T9/T10 y F4.4-T1/T2. `package-lock.json`, claves,
  demos, handoff copiado y `tail.err` quedaron fuera. Sin push ni deploy.
- Objetivo posterior: reconstruir y presentar juntos los miembros de cada par.
- Resultado real: metadata de comparación validada como grupo/índice inseparable;
  agregador exclusivo por UUID e índice; panel conjunto con A/B, modelo, trabajo,
  estado y resultado. Pares parciales, duplicados, identidades mezcladas y
  terminales sin resultado quedan señalados, nunca emparejados por fecha.
- Pruebas: 49/49 específicas; suite completa 1.565 pasadas, 9 omitidas, 0
  fallos en 84 archivos. Lint, tipos y build: exit 0.
- Incidencia: los primeros fixtures nuevos omitían el snapshot completo y fueron
  rechazados por el agregador; se corrigieron los fixtures, no se relajó el
  contrato, y la matriz se repitió en verde.
- Decisión: `D-031`; una vista conjunta describe ambos miembros, no decide un
  ganador ni convierte ausencia operativa en evidencia de calidad.
- Git: F4.4-T3 queda después de `3771549`, sin commit, push ni deploy.
- Siguiente paso exacto: revisar F4.5 contra la evidencia ya persistida, cerrar
  cualquier hueco real y preparar la validación manual de comparación.

### 2026-08-09 — Codex — F4.5/F4.6 y cierre funcional de Modelos/Laboratorio

- Estado anterior: el trabajo ya persistía prompt, respuesta, snapshot, modelo,
  tokens, tiempos y validación, pero Laboratorio no reunía esa trazabilidad ni
  emitía una recomendación prudente.
- Objetivo: cerrar evidencia y recomendador sin inventar puntuaciones ni ejecutar
  modelos automáticamente.
- F4.5: cada resultado validado expone en un detalle colapsado proveedor,
  proyecto, máquina, modo, scoring, prompt completo y respuesta completa; tokens,
  duración, checks y final ya permanecían en `evaluationResult`/trabajo.
- F4.6: recomendación provisional sólo con dos modelos que tengan al menos tres
  resultados puntuados de la misma prueba y versión. Tasa validada primero;
  duración sólo desempata pruebas `timing`; feedback sólo desempata con al menos
  dos valoraciones de conversaciones completadas del mismo proyecto/modelo.
- Seguridad de producto: empates e insuficiencia muestran **Sin recomendación**;
  seleccionar la propuesta no ejecuta nada y vuelve a exigir confirmación.
- Integridad final: historial/recomendador sólo aceptan si metadata, resultado y
  prompt completo coinciden; los pares también detectan mezcla de snapshot,
  prompt, máquina o proyecto bajo un mismo UUID.
- Pruebas focalizadas: 26/26, 3 archivos. Matriz completa: 1.572 pasadas, 9
  omitidas, 0 fallos en 85 archivos; Prettier, lint, tipos y build exit 0.
- Estado: alcance v1 de Modelos/Laboratorio **100% implementado en código**;
  validación manual `LA-018/LA-019` pendiente. Manual, sandbox y tool-trace siguen
  bloqueados y etiquetados como expansión futura, no como runners disponibles.
- Git: posterior a `3771549`, sin commit, push ni deploy. Archivos ajenos fuera.
- Siguiente paso exacto: Daniel ejecuta la lista única de `LOCAL-ACTIONS.md`; si
  no aparecen incidencias, cerrar Fase 4 y pasar al siguiente bloque de Studio.

### 2026-08-09 — Codex — corrección de validación manual del selector

- Evidencia recibida: captura de Laboratorio con
  `frontend-accessible-card-v1`; la casilla y el botón estaban deshabilitados con
  el mensaje de runner/revisión pendiente.
- Causa: el formulario de ejecución mezclaba las ocho definiciones del catálogo
  con las cuatro pruebas realmente automáticas. El bloqueo era correcto, pero la
  opción no debía ofrecerse como ejecutable.
- Corrección: `EXECUTABLE_MODEL_EVALUATIONS` compartido y selector limitado a
  las cuatro automáticas. El encabezado muestra `4 ejecutables · 8 definidas` y
  la nota explica que manual/sandbox/traza siguen documentadas abajo.
- Compatibilidad: una selección antigua conservada por recarga/HMR cae a la
  primera automática; no se habilitan runners inseguros.
- Pruebas focalizadas: 15/15; suite completa 1.572 pasadas, 9 omitidas, 0
  fallos en 85 archivos; tipos, lint y build exit 0.
- Git: posterior a `3771549`, sin commit, push ni deploy.

### 2026-08-09 — Codex — despliegue autorizado del Gateway

- Motivo: el Desktop nuevo enviaba comparación A/B, pero el Worker conectado
  rechazaba el contrato con `422 cuerpo no cumple el contrato esperado`.
- Acción autorizada: `wrangler deploy` sobre el Worker existente `luxy-gateway`.
- Resultado: deploy correcto en
  `https://luxy-gateway.danielux135.workers.dev`, versión
  `b3fb5c99-5cf1-42a1-b011-f6d44b9f0730`; `/health` respondió HTTP 200.
- No se cambiaron secretos, migraciones, push ni otros Workers. El primer intento
  falló por sesión Cloudflare de otra cuenta; se renovó OAuth y el segundo intento
  publicó correctamente.
- Siguiente acción: reiniciar agente/Desktop y repetir una comparación con
  confirmación explícita.

### 2026-08-09 — Codex — UI-RESPONSE-FORMATTING

- Corrección visual: las comparaciones controladas ya no heredan el `display:flex`
  de las listas anidadas; el título, UUID y miembros ocupan ahora el ancho correcto.
- Conversaciones: las respuestas de las IA se renderizan con Markdown seguro
  (encabezados, listas, énfasis, enlaces y bloques de código), preservando el texto
  original y sus acentos sin insertar HTML no confiable.
- Verificación: typecheck correcto y 328 pruebas del Desktop pasadas.

### 2026-08-09 — Codex — INITIAL-COMMIT-ISOLATED

- Cambio solicitado: permitir que Luxy trabaje con un repositorio Git vacío y
  cree su primer commit desde **Aplicar cambios**.
- Implementación: el agente crea una rama huérfana en el worktree aislado cuando
  no existe `HEAD`; la carpeta principal no se modifica. `collectDiff` y el commit
  aprobado funcionan también sobre esa rama sin historia.
- Si el repositorio vacío ya tiene archivos sin seguimiento, se copian al worktree
  aislado (excluyendo `.git`) antes de ejecutar la tarea, para que el primer commit
  represente el estado real del proyecto.
- Seguridad: sigue siendo necesaria la aprobación explícita; no se hace commit
  automático ni push.
- Prueba: caso real de worktree vacío añadido; 71/71 pruebas de Agent pasadas.
- Incidencia posterior: el primer reinicio usó `apps/desktop/out/agent/host-entry.js`
  generado antes del cambio. Se reconstruyó el Desktop completo para propagar la
  rama huérfana al proceso que realmente arranca Luxy.

### 2026-08-09 — Codex — STUDIO-RETRY

- Incidencia observada: DeepSeek terminó trabajos con HTTP 502 después de escribir
  parte del proyecto; Trabajos no ofrecía una forma explícita de repetirlos.
- Cambio: los trabajos `failed`, `interrupted` y `cancelled` muestran **Reintentar
  trabajo**. La acción pide confirmación y crea un trabajo nuevo con la misma
  máquina, proveedor, modelo, proyecto y prompt; no reintenta automáticamente.
- Verificación: typecheck y ESLint correctos; Desktop reconstruido.

## Plantilla para próximas entradas

### 2026-08-09 — Codex — LAB-RESPONSE-TIME

- Observación: el tiempo total ya se persistía en `evaluationResult.durationMs`,
  pero Laboratorio lo mostraba sólo como un valor suelto en milisegundos.
- Cambio: historial, comparaciones A/B y evidencia muestran ahora **Tiempo de
  respuesta** con lectura humana (ms, s o min), conservando el valor exacto en
  ms.
- Límite: una evaluación en curso no tiene tiempo final; aparece como pendiente
  hasta que termine y se pulse **Actualizar**.
- Verificación: `npm run desktop:test` — 328 pruebas pasadas.

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
### 2026-08-20 08:27 — Codex — UX-001

- Estado anterior: Studio mostraba pruebas, diff y eventos, pero no las llamadas
  efectivas al modelo ni la ubicación del worktree.
- Objetivo: hacer visibles ambas trazas y abrir el worktree desde Windows sin
  entregar al renderer una capacidad de abrir rutas arbitrarias.
- Hipótesis o causa demostrada: `runAgenticLoop` ya medía vueltas al modelo y
  herramientas, pero `ProviderRunResult`, el cierre del Gateway y la pantalla no
  conservaban ese dato.
- Archivos leídos: Studio, IPC/preload/main, `job-runner`, proveedor HTTP,
  `agentic-loop`, contratos shared, cierre Gateway y pruebas relacionadas.
- Archivos modificados: contrato shared, proveedor HTTP, runner, Gateway, IPC,
  main/preload, Studio y pruebas nuevas de métricas y confinamiento de rutas.
- Comandos ejecutados: Prettier; build de `@luxy/shared`; lint; dos matrices
  focalizadas de Vitest; typecheck completo.
- Resultado real: lint correcto; 105 pruebas focalizadas correctas. La primera
  matriz de 119 tuvo 118 correctas y 1 fallo porque el enlace temporal de
  dependencias cargó el build compartido anterior. Typecheck no cerró por ese
  mismo build, ausencia de `@cloudflare/workers-types` y un error previo de
  `Config.tsx` con `other`.
- Pruebas: se añadieron cobertura de `callMetrics`, parser de Studio, contrato
  IPC y rechazo de una carpeta externa.
- Decisiones: `modelCalls` es el número exacto de peticiones HTTP al modelo;
  `toolCalls` se presenta aparte. Los trabajos históricos quedan sin cifra. Main
  usa `realpath` y confina la carpeta bajo la raíz local antes de usar el
  Explorador.
- Riesgos o límites: requiere reconstruir y desplegar Gateway autorizado para
  ver la métrica en una tarea nueva. El worktree temporal quedó con un enlace de
  dependencias que el entorno no permitió retirar; está ignorado por Git.
- Estado nuevo: bloqueado sólo para la matriz completa e integración, sin commit,
  push, deploy, migración ni llamadas reales.
- Siguiente paso exacto: seguir `LA-020`.

### 2026-08-20 08:36 — Codex — UX-001, cierre de validación

- Estado anterior: la matriz completa estaba bloqueada por un enlace temporal a
  dependencias del checkout principal.
- Acción: se retiró sólo ese junction confirmado y se instalaron dependencias
  del worktree con `npm ci --ignore-scripts`.
- Comandos ejecutados: `npm.cmd run typecheck`, `npm.cmd test` y `npm.cmd run build`.
- Resultado real: typecheck y build correctos; Vitest 1.574 pasadas, 14 omitidas,
  0 fallos, 87 archivos, 59,37 s.
- Estado nuevo: UX-001 verificado y listo para el commit autorizado. No hubo
  llamadas reales, migración, despliegue ni push.
- Siguiente paso exacto: crear el commit y arrancar Desktop desde esta rama.

### 2026-08-20 08:38 — Codex — UX-001, entrega local

- Acción autorizada: commit local creado como `feat: muestra llamadas y worktree en Studio`.
- Reinicio: se cerró el árbol Electron que ejecutaba otra rama y Studio se abrió
  desde `luxy/ux-001-detalle-trabajo`.
- Incidencia de arranque: `ELECTRON_RUN_AS_NODE=1` hacía que Electron iniciara
  como Node; se eliminó sólo de la sesión de lanzamiento. El proceso principal,
  renderer, GPU y utility process de la rama nueva quedaron vivos.
- No se hizo push ni despliegue. La métrica de llamadas requerirá actualizar el
  Gateway antes de poder guardarse en trabajos nuevos de producción.

### 2026-08-10 10:08 — Codex — F4.8-T2-DEPLOY

- Estado anterior: Desktop reconstruido y ejecutándose desde el worktree; el
  Gateway desplegado todavía no aceptaba `resumeJobId`.
- Objetivo: publicar el contrato de reanudación necesario para reutilizar el
  mismo worktree tras un fallo del proveedor.
- Hipótesis o causa demostrada: un Desktop nuevo contra un Gateway antiguo
  perdería `resumeJobId` y crearía otro worktree.
- Archivos leídos: `PROJECT-STATE.md`, `CURRENT-TASK.md`, `LOCAL-ACTIONS.md`,
  `apps/gateway/package.json`, `apps/gateway/src/handlers/studio.ts` y
  `packages/shared/src/schemas.ts`.
- Archivos modificados: sólo documentación de continuidad.
- Comandos ejecutados: build de Gateway, Vitest sobre Gateway/shared, dry-run
  de Wrangler, despliegue autorizado y petición pública a `/health`.
- Resultado real: Worker `luxy-gateway` desplegado en la versión
  `33da28e0-4a72-4c0b-8661-50d1cc838dec`; `/health` respondió HTTP 200 con
  `configured: true`.
- Pruebas: build exit 0; 37 archivos y 641 pruebas pasadas, 0 fallos; dry-run
  final exit 0.
- Decisiones: conservar variables remotas con `--keep-vars`, el flag
  `nodejs_compat` y el cron de un minuto; sin migraciones ni cambios de secretos.
- Riesgos o límites: falta la validación manual de `LA-022`; no existe todavía
  una prueba Gateway específica de `resumeJobId`.
- Estado nuevo: Gateway y Desktop actualizados; validación manual pendiente.
- Siguiente paso exacto: repetir `LUX-L9CC` desde **Reintentar trabajo** y
  comprobar que conserva ruta y rama sin crear otro worktree.

### 2026-08-10 10:25 — Codex — F4.8-T2-TIMEOUT-RESTART

- Estado anterior: Gateway desplegado con `resumeJobId`; Desktop podía seguir
  usando una instancia anterior del agente con timeout fijo de cinco minutos.
- Objetivo: cerrar la instancia anterior, reconstruir el agente/Proveedor y
  Desktop desde `lux-auto-init-git`, actualizar el Gateway y arrancar la copia
  nueva.
- Archivos modificados: ninguno por esta acción; se usó el código existente del
  worktree. Se actualiza sólo esta documentación de continuidad.
- Comandos ejecutados: `npm.cmd run build`; despliegue Wrangler conservando
  variables remotas; smoke check de `/health`; arranque del binario Electron con
  `apps/desktop` del worktree.
- Resultado real: build exit 0; Worker `luxy-gateway` desplegado como versión
  `a5cb5ba8-34d9-4cca-85ba-e02f95e3942f`; `/health` respondió HTTP 200 y
  `configured: true`; Desktop abierto y apuntando a `lux-auto-init-git`.
- Pruebas: `git diff --check` sin errores; no se inició ningún trabajo real.
- Decisiones: no pulsar **Reintentar** hasta este despliegue; sin migraciones,
  commit ni push.
- Riesgos o límites: queda pendiente la validación manual de que MiniMax supera
  cinco minutos y de que el reintento conserva exactamente la misma ruta y rama.
- Estado nuevo: Desktop, agente y Gateway actualizados y ejecutándose.
- Siguiente paso exacto: ejecutar manualmente `LA-022` sobre `LUX-L9CC`.

### 2026-08-11 — Codex — OPS-BAT-LAUNCHERS

- Objetivo: ofrecer reconstrucción y arranque de Luxy por doble clic, siempre
  relativos a la raíz del worktree operativo.
- Archivos modificados: `rebuild-luxy.bat`, `start-luxy.bat`,
  `rebuild-and-start-luxy.bat` y `README.md`.
- Resultado real: los lanzadores usan `%~dp0`, limpian `ELECTRON_RUN_AS_NODE`,
  comprueban la salida de Desktop y localizan Electron en el worktree con
  fallback a la instalación principal.
- Pruebas: `rebuild-luxy.bat no-pause` ejecutado con exit 0; build completo
  correcto. `git diff --check` sin errores.
- Siguiente paso exacto: usar `rebuild-and-start-luxy.bat` tras cambios y
  `start-luxy.bat` para abrir sin reconstruir.

### 2026-08-11 — Codex — UI-LAB-LAYOUT

- Estado anterior: en Laboratorio, la lista horizontal genérica repartía título,
  métricas, checks y evidencia como columnas equivalentes. Los títulos quedaban
  reducidos a pocas letras por línea y se superponían con el resto del contenido.
- Objetivo: ordenar resultados guardados y comparaciones sin perder información
  y mantener una lectura coherente en ventanas estrechas.
- Archivos modificados: `apps/desktop/src/renderer/pages/Laboratory.tsx` y
  `apps/desktop/src/renderer/styles.css`.
- Resultado real: cada resultado tiene cabecera, etiquetas, métricas, motivo y
  evidencia en filas propias; las métricas envuelven sin invadir el título. Los
  miembros A/B usan una cuadrícula de dos columnas que cae a una sola columna
  por debajo de 920 px.
- Pruebas: Prettier aplicado; lint y typecheck exit 0; Desktop 328/328; build
  completo exit 0; `git diff --check` sin errores.
- Estado nuevo: implementado, verificado automáticamente, Desktop reconstruido y
  reiniciado desde `lux-auto-init-git`.
- Siguiente paso exacto: confirmación visual manual en Resultados guardados y
  Comparaciones controladas.

### 2026-08-11 — Codex — UI-LAB-LAYOUT-FOLLOWUP

- Evidencia manual: la primera corrección aún alineaba las etiquetas de cada
  modelo hacia el centro de la columna izquierda, distinta de la composición de
  Evidencia descriptiva indicada como referencia.
- Corrección: estados y validación quedan justo debajo del nombre del modelo y
  alineados al mismo borde izquierdo; las métricas conservan su columna derecha.
- Archivos modificados: `apps/desktop/src/renderer/styles.css`.
- Pruebas: Prettier check, lint y build de Desktop exit 0; `git diff --check`
  sin errores. Desktop reiniciado.
- Siguiente paso exacto: confirmación visual manual con la segunda captura como
  referencia.

### 2026-08-11 10:01 — Codex — F4.3-T11

- Estado anterior: Modelos persistía una lectura real de 23 identificadores,
  pero Laboratorio y Conversaciones seguían usando el catálogo estático de 22.
- Objetivo: hacer canónico el snapshot detectado en todas las pantallas que
  ofrecen modelos y representar correctamente el cierre fallido.
- Causa demostrada: `Laboratory.tsx` y `Conversations.tsx` llamaban directamente
  a `buildDefaultCatalog`; Laboratorio sólo releía al montar o al pulsar
  Actualizar; la vista llamaba «Tiempo de respuesta» a `durationMs` incluso con
  `responseOutcome: failed`. Los logs de `LUX-LR82` y `LUX-TQC3` confirmaron dos
  503 contra los Qwen retirados.
- Archivos modificados: catálogo, familias/proveedores, pruebas de registry,
  router, Telegram y agente; `useCatalog.ts`; páginas Modelos, Laboratorio,
  Conversaciones y Setup; documentación de continuidad y modelos.
- Comandos ejecutados: pruebas focalizadas, Prettier y `npm.cmd run check`.
- Resultado real: el snapshot persistido sustituye la lista operativa; Hy3 se
  agrupa y ejecuta como Hunyuan; el embedding queda visible pero no ejecutable;
  Laboratorio refresca cada 5 s sólo mientras haya activos y etiqueta la
  duración según el final. «Par completo» pasa a «Par terminado».
- Pruebas: lint, typecheck y build correctos; 85 archivos, 1.581 pasadas, 9
  omitidas, 0 fallos.
- Decisiones: un identificador desconocido se conserva visible con capacidades
  vacías; nunca hereda chat o herramientas por heurística.
- Riesgos o límites: falta reiniciar y confirmar visualmente; no se realizó una
  llamada real, deploy, commit ni push.
- Estado nuevo: implementado y verificado automáticamente.
- Siguiente paso exacto: reiniciar Luxy y comprobar selectores y refresco.

### 2026-08-11 10:44 — Codex — OPS-GATEWAY-BAT

- Objetivo: permitir que Daniel despliegue manualmente el contrato actualizado
  del Gateway sin migraciones ni edición de secretos.
- Archivos modificados: `deploy-gateway.bat`, `README.md`, `LOCAL-ACTIONS.md` y
  documentación de continuidad.
- Resultado real: el lanzador compila Shared/Gateway, crea una configuración
  TOML temporal desde la plantilla, ejecuta dry-run, exige escribir `DESPLEGAR`,
  publica con `--keep-vars` y elimina la configuración temporal.
- Pruebas: el primer `check` falló porque Wrangler no interpreta `.toml.example`
  como configuración; se corrigió. Segundo `check`: exit 0, bundle 468,11 KiB,
  gzip 105,68 KiB; no se desplegó nada y el TOML temporal fue eliminado.
- Estado nuevo: lanzador manual verificado sin publicación.
- Siguiente paso exacto: Daniel ejecuta `deploy-gateway.bat` y confirma
  escribiendo `DESPLEGAR`.

### 2026-08-11 10:47 — Codex — OPS-MAIN-LAUNCHERS

- Objetivo: concentrar los accesos manuales en `Desktop\Luxy` sin volver a
  ejecutar por error el checkout distinto del que usa la aplicación.
- Resultado real: los cuatro `.bat` de la carpeta principal delegan en
  `%LOCALAPPDATA%\Luxy\worktrees\lux-auto-init-git` y fallan con un mensaje
  claro si ese worktree no existe.
- Pruebas: `deploy-gateway.bat check` lanzado desde la carpeta principal; exit
  0, compilación y dry-run correctos, sin despliegue.
- Siguiente paso exacto: usar desde ahora únicamente los accesos de la carpeta
  principal.

### 2026-08-11 11:09 — Codex — UI-LAB-CONFIRM

- Evidencia manual: después de aceptar una evaluación, toda la ventana de
  Electron dejaba de responder a desplegables, incluso fuera de Laboratorio.
- Causa probable acotada: Laboratorio usaba `window.confirm()`, diálogo
  bloqueante del renderer; no había ningún `disabled` global ni capa CSS activa.
- Corrección: ejecución y cancelación usan ahora un diálogo React propio que se
  desmonta antes de crear/cancelar el trabajo; se eliminaron los dos
  `window.confirm()` de Laboratorio.
- Archivos modificados: `Laboratory.tsx` y `styles.css`.
- Pruebas: 20 focalizadas pasadas; matriz completa con lint, typecheck y build
  correctos; 1.581 pasadas, 9 omitidas y 0 fallos.
- Riesgo: falta confirmación manual porque las pruebas no reproducen la gestión
  de foco de una ventana Electron real.
- Siguiente paso exacto: reconstruir/reiniciar y ejecutar una prueba; al cerrar
  el diálogo y terminar, comprobar desplegables en Laboratorio y Trabajos.
