# Luxy — estado canónico del proyecto

Última actualización: **2026-09-01 — BUG-GIT-IDENTITY-001**

Capacidad corregida: Luxy ya puede confirmar el trabajo de un worktree en un
ordenador **sin identidad de Git configurada**. `commitWorktree` aporta una
identidad de respaldo (`Luxy <luxy@local.invalid>`) sólo cuando el equipo no
tiene ninguna, conservando la autoría real del usuario cuando sí existe.
Antes fallaba de forma silenciosa, después de haber inicializado el proyecto
correctamente. `npm run check` exit 0: 96 archivos, 1.653 superadas, 14
omitidas. Sin commit, push, deploy ni migración.

Nota de entorno: la copia operativa de esta sesión es
`C:\Users\oscar\Desktop\Daniel\Luxy`, un clon nuevo, no la
`C:\Users\daniel\Desktop\Luxy` que describe el checkpoint del 2026-08-21.
La integración de `F4.9` ya está hecha (`main` @ `00a9cc1`), aunque los
documentos anteriores todavía la presentan como pendiente; `LA-029` sí sigue
abierta. `LA-030` recoge la identidad global de Git de este equipo.

Trabajo acordado y no empezado: `F5-VAULT-001`, conversaciones privadas
cifradas en cliente y sincronizadas, con la infraestructura viendo sólo
ciphertext. Diseño y pasos en `CURRENT-TASK.md`.

Última actualización: **2026-08-27 — F4.9-DYNAMIC-HTTP-PROVIDERS**

Luxy Studio ya permite añadir, editar, activar, desactivar y eliminar proveedores
HTTP compatibles con `chat completions`, sin editar `config.json`. La clave se
guarda cifrada, nunca vuelve al renderer y se invalida al cambiar de endpoint o
eliminar el proveedor. Los identificadores configurados viajan por Gateway y
aparecen en Trabajos y Conversaciones; el agente aplica la configuración al
quedar libre, sin interrumpir un trabajo en curso. URLs remotas exigen HTTPS y
siguen bloqueadas las APIs prohibidas por D-003.

Estado: implementado y verificado en el worktree aislado
`luxy/f4-9-dynamic-http-providers`, con el commit local
`feat: añade proveedores HTTP configurables`; sin push, deploy ni migración. La
puerta `npm run check` pasa con 96 archivos, 1.656 pruebas superadas y 9
omitidas. No se llamó a ningún proveedor real; la integración, publicación y
prueba manual están en `LA-029`.

Última actualización: **2026-08-21**

`LUXY-CONSOLIDATION-001` cerró la consolidación de los ocho worktrees en una
sola línea canónica: `C:\Users\daniel\Desktop\Luxy`, rama `feat/luxy-desktop`,
HEAD `e40268a`. `git worktree list` sólo contiene ya esa copia. El bloque de
`luxy/consolidate-worktrees` (workspaces reutilizables, Remote 4d, ficha de
proyecto, diálogos de confirmación React embebidos) quedó fusionado por
fast-forward; los worktrees restantes se auditaron archivo por archivo y se
eliminaron al confirmarse sin trabajo único. Detalle completo en
`CURRENT-TASK.md` y en las entradas del 2026-08-21 de `CHANGELOG-WORK.md`.
Las notas de «consolidación en curso» de más abajo describen ese proceso
mientras estuvo abierto; quedan como historial, no como estado pendiente.

Actualización puntual: **BUG-HUNYUAN-002** recupera en la rama de Studio la
compatibilidad ya desarrollada para el historial de proveedores. La lectura de
trabajos admite identificadores seguros externos; crear, reintentar y continuar
siguen acotados a proveedores reconocidos. No se realizó despliegue ni migración.

Actualización puntual: el catálogo detectado clasifica `hy3` como modelo de texto
de la familia `other`; esto no elimina el identificador histórico `hunyuan` de
los trabajos ya guardados. Los modelos nuevos detectados quedan sin herramientas
ni capacidad de agente.

Actualización 2026-08-11: `F4.8-T5` implementado. Studio puede crear y abrir un
worktree antes de una tarea, recordar el seleccionado y reutilizarlo en llamadas
posteriores sin perder archivos. El contrato de Gateway necesita publicación
manual y la interfaz necesita reconstrucción para la validación real.

Última actualización: **2026-08-10**

Actualización 2026-08-10: `F4.8-T4` implementado. Cuando un retry reutiliza el
worktree, el prompt del agente marca explícitamente la ejecución como
continuación y le ordena inspeccionar y conservar los archivos existentes. La
prueba y la reconstrucción de Desktop quedan pendientes en este checkpoint.

Actualización 2026-08-10: `F4.8-T1` implementado. Los proyectos con
`allowEdits: true` que aún no tienen Git se inicializan automáticamente con un
`.gitignore` seguro y el commit local `estado inicial`, sin remoto; después el
trabajo usa el worktree aislado habitual. `allowEdits: false` sigue siendo sólo
lectura. Prueba focalizada 72/72; typecheck pendiente por dependencia ausente.

`F4.8-T2` implementado y desplegado: un reintento agentic conserva un nuevo
registro, pero Gateway y agente validan y reutilizan el mismo worktree y rama.
Una web parcial continúa desde sus archivos, no desde el proyecto base. Gateway
`a5cb5ba8-34d9-4cca-85ba-e02f95e3942f`, `/health` HTTP 200; Desktop y agente
reconstruidos con timeout ampliado; falta validación manual.

Estado documental: **checkpoint reconciliado en Windows; `F4.1-T4/T5`,
`F4.2-T1/T2/T3` y `F4.3-T1`–`F4.3-T8` verificados y commiteados localmente;
`F4.3-T9/T10` y `F4.4-T1/T2` commiteados en `3771549`; `F4.4-T3` y `F4.5/F4.6`
verificados después del commit y pendientes de commit; push pendiente**

Gateway desplegado con autorización el 2026-08-09: `luxy-gateway`, versión
`b3fb5c99-5cf1-42a1-b011-f6d44b9f0730`; comprobación pública `/health` HTTP 200.

## 1. Cómo interpretar este estado

Orden de precedencia:

1. El contenido real del worktree de Windows.
2. Este archivo.
3. `CURRENT-TASK.md`, `DECISIONS.md` y `MASTER-PLAN.md`.
4. `CHANGELOG-WORK.md`, `TEST-RESULTS.md` y `LOCAL-ACTIONS.md`.
5. README y documentación técnica.
6. Handoffs, capturas y parches antiguos.

Si el worktree contradice este archivo, no se reescribe código para hacerlo
coincidir. Se registra la discrepancia, se averigua qué cambio existe realmente
y se actualiza primero la documentación.

## 2. Producto y restricciones vinculantes

Luxy es un sistema privado y personal para controlar modelos y agentes de IA.
La interfaz principal es **Luxy Studio para Windows**. Telegram queda como canal
secundario. Luxy Mobile para Android es una fase futura y Luxy Remote permanece
pausado, no eliminado.

Restricciones:

- Coste obligatorio de producto: **0 €**.
- No SaaS, facturación, multi-tenant, iOS ni publicación comercial.
- Claude Code y Codex usan las sesiones locales de las suscripciones; no se
  pagan ni se integran sus APIs.
- No automatizar las webs de Claude o ChatGPT.
- No usar `--dangerously-skip-permissions` ni equivalentes.
- El modelo sólo edita en un worktree aislado; al primer trabajo editable Luxy
  puede crear en la carpeta original el `.git` y el commit local `estado
inicial` necesarios para disponer de ese aislamiento.
- No commit sin aprobación explícita de Daniel.
- No push sin dos confirmaciones y `allowPush: true`.
- No desplegar ni aplicar migraciones reales sin autorización explícita.
- No usar APIs reales en pruebas automatizadas.
- No exponer secretos, rutas personales ni el entorno completo a procesos hijo.

## 3. Arquitectura actual

```text
Luxy Studio / Telegram
        |
        v
Cloudflare Worker (gateway y única pieza pública)
        |
        v
Supabase/Postgres (trabajos, leases, eventos, aprobaciones y metadata)
        ^
        | polling HTTPS saliente
Agente local de Windows
        |
        +-- Claude Code o Codex CLI con sesión local
        +-- Proveedores HTTP configurados
        +-- Worktrees Git para tareas que pueden editar
```

Monorepo:

| Ruta                  | Responsabilidad                                       |
| --------------------- | ----------------------------------------------------- |
| `packages/shared`     | tipos, esquemas Zod y lógica pura compartida          |
| `apps/gateway`        | API de Studio, cola, autenticación y Telegram         |
| `apps/agent`          | proveedores, procesos, worktrees, checks y resultados |
| `apps/desktop`        | Electron/React, IPC, Studio y secretos cifrados       |
| `supabase/migrations` | SQL acumulativo                                       |
| `packages/remote-*`   | Luxy Remote conservado y pausado                      |

## 4. Checkpoint operativo conocido

**Corrección del 2026-08-09, comprobada en este ordenador.** El checkpoint
operativo actual es:

- repositorio activo: el checkout `Luxy` del workspace actual;
- rama activa: `feat/luxy-desktop`, HEAD local con el commit
  `feat: incorpora modelos y laboratorio reproducible`, un commit por delante de
  `origin/feat/luxy-desktop` (`59870c6`);
- `P0.0`–`P0.5` están **commiteados** (`9012eda`, `16c6e9a`, `845c3cb`,
  `c6e5094`). El riesgo de las 7.997 líneas sin commit que registraba `LA-008`
  ya no existe;
- `P0.6a`–`P0.6d`, `P0.8`, `P0.9`, `F4.1-T1`–`F4.1-T5`, `F4.2-T1`–`F4.2-T3`
  y `F4.3-T1`–`F4.3-T8` están incorporados;
- hay un cambio local ajeno en `package-lock.json` y elementos sin seguimiento
  con claves/demos. Se preservan y no forman parte del trabajo actual.

- Commit y push: **autorizados y hechos** el 2026-08-06 (`af095b3`, `9f0ab42`).
- Despliegue del gateway: **autorizado y hecho** por Daniel el 2026-08-07,
  versión `096f2623-c6cc-4dcd-94d3-b41a12608ea4`. Sin migración: todo lo nuevo
  viaja en `metadata` (`D-014`, `D-017`).
- Migración nueva: sigue sin autorizarse y sin hacer falta.

Checkpoint anterior, conservado por si hace falta rastrear algo:

- Repositorio: `Danielux135/Luxy`.
- Worktree de prueba en Windows:
  `%LOCALAPPDATA%\Luxy\worktrees\luxy-work-update-001`.
- Rama conocida: `luxy/work-update-001-studio`.
- Perfil de prueba de Desktop:
  `%LOCALAPPDATA%\Luxy\test-profiles\studio-001`.
- Gateway local: Wrangler en `apps/gateway`, normalmente
  `http://localhost:8787`.

El estado exacto de Git y de las migraciones debe volver a leerse en Windows al
abrir la siguiente sesión. No asumir que un parche está aplicado sólo porque sus
pruebas existen; usar el código real y `git apply --reverse --check` cuando sea
necesario.

## 5. Capacidades implementadas

| Área                   | Estado conocido           | Observaciones                                                                                     |
| ---------------------- | ------------------------- | ------------------------------------------------------------------------------------------------- |
| Agente, gateway y cola | Implementado              | polling saliente, leases, heartbeats, eventos y cancelación                                       |
| Desktop Electron       | Implementado              | agente en utility process, bandeja, configuración y secretos cifrados                             |
| Studio — trabajos      | Implementado en código    | formulario real, historial, eventos, resultado, diff, pruebas y trazabilidad de llamadas/worktree |
| Worktrees              | Implementado              | la carpeta original no se modifica; el primer trabajo puede preparar Git en un proyecto sin repositorio |
| Aplicar/descartar      | Implementado en código    | aplicar crea commit aislado; descartar borra worktree tras confirmar; sin push                    |
| Conversaciones         | Implementado parcialmente | uno o dos modelos, streaming, historial, tiempos, tokens y cancelación                            |
| Diagnóstico del final  | Implementado y verificado | señal de transporte, aborto, límites efectivos y tokens; sin contenido                            |
| Finales explícitos     | Implementado y verificado | seis resultados; la salida parcial se conserva y no se reintenta a ciegas                         |
| Memoria                | Implementado y verificado | sin fallback: sólo un bloque válido la sustituye; el código se rechaza                            |
| Recomendaciones        | Implementado              | feedback y resultados ajustan una recomendación explícita; nunca cambia solo                      |
| Continuación           | Implementado              | unión con evidencia y aviso cuando no la hay; el parcial viaja como dato                          |
| Cancelación            | Implementado              | conserva lo generado como resultado; no ofrece continuar ni escribe memoria                       |
| Feedback               | Arreglo preparado         | el primer clic usa la respuesta del gateway; falta confirmación manual final                      |
| Proveedores/modelos    | Implementado; validar     | 23 modelos reales; el snapshot detectado alimenta las pantallas operativas; sin sondeo de precios |
| Laboratorio            | Implementado; validar     | catálogo, ejecución individual/par, persistencia, evidencia, comparación y recomendación prudente |
| Errores de proveedor   | Implementado y verificado | límite de plan y 429 explicados; se obedece `Retry-After`; intentos reales                        |
| Telegram               | Conservado                | canal secundario                                                                                  |
| Mobile Android         | No iniciado               | prioridad posterior a estabilizar Desktop                                                         |
| Remote                 | Pausado                   | conservar código, ADR, threat model y pruebas                                                     |

## 6. Flujo de Conversaciones que ya funciona

- Crea cada respuesta como un trabajo persistente de Studio.
- Agrupa conversación, turno y columna A/B en metadata.
- Ejecuta el proveedor en solo lectura, sin herramientas, worktree ni checks.
- Muestra streaming, primer texto, duración total y tokens cuando el proveedor
  los entrega.
- El botón **Detener** cancela y recupera cancelaciones huérfanas.
- Las respuestas normales pasan solas a **Guardado**.
- La memoria estructurada se separa del texto visible y se reutiliza en turnos
  posteriores.
- El feedback `Útil` / `No me sirvió` alimenta la selección de proveedor y
  modelo, pero no entrena sus pesos.
- En A/B, la respuesta útil más reciente es la fuente canónica del siguiente
  turno; sin valoración se usa A.

Arreglos acumulados relevantes:

1. Lectura de `finish_reason`, `[DONE]`, usage final y último evento sin salto.
2. Cancelación real y recuperación de estados huérfanos.
3. Finalización por señales de protocolo, no por una pausa breve arbitraria.
4. Publicación de respuestas cortas.
5. Conservación de `inputTokens` y `outputTokens` como números: el redactor ya
   no los confunde con credenciales.
6. Feedback visual al primer clic.

## 7. Incidencias abiertas prioritarias

### LUXY-P0-001 — respuesta larga incompleta — **causa demostrada el 2026-08-05**

**Era el tope de guardado, no el proveedor ni el transporte.** Con la telemetría
de `P0.1` funcionando, dos ejecuciones reales dieron:

| Trabajo    | tokens salida | caracteres recibidos | guardado | transporte    | finish_reason | aborto  |
| ---------- | ------------- | -------------------- | -------- | ------------- | ------------- | ------- |
| `LUX-YJT9` | 3.180         | 7.716                | 4.000    | `done_marker` | `stop`        | ninguno |
| `LUX-8B8T` | 2.720         | 7.691                | 4.000    | `done_marker` | `stop`        | ninguno |

La llamada terminaba bien y la respuesta llegaba entera. `summary` estaba
limitado a 4.000 caracteres para cualquier trabajo, así que una conversación
perdía la mitad al persistir. Corregido en `P0.3b` (`D-020`).

Lo que **no** era, ya con evidencia: ni el límite de tokens (2.720 y 3.180 de
8.192), ni un aborto de Luxy (`abortedBy: null`), ni un socket caído
(`done_marker`).

Queda abierto y **ya confirmado como límite real**: el trabajo `LUX-3966` con
KAT Coder Pro v2.5 terminó con `finish_reason: length` y exactamente 8.192
tokens de salida — 22.574 caracteres, unas 700 líneas. Para páginas de
1.000–2.000 líneas hace falta el tope real por modelo (`LA-007`, `F2.14`).

Ese mismo trabajo confirma en producción los arreglos: se guardaron 22.025
caracteres donde antes cabían 4.000, el final se clasificó `truncated` y la
memoria quedó marcada `truncated_block` sin contaminarse.

Evidencia original observada el 2026-08-04, que abrió la incidencia:

- Kimi generó una respuesta durante aproximadamente **23 min 43 s**.
- El panel del proveedor registró la llamada y alrededor de **6.422 tokens de
  salida**.
- El HTML visible terminó a mitad de una etiqueta.
- La respuesta no permite distinguir todavía si el motivo fue
  `finish_reason: length`, timeout local, timeout o aborto del upstream, cierre
  anómalo del socket, proxy intermedio o pérdida de un evento terminal.

No está demostrado que fuese el límite de tokens. Tampoco está demostrado que
Luxy cortase la conexión. La siguiente tarea debe añadir diagnóstico seguro y
reproducir todos los finales posibles antes de cambiar otro timeout.

Avance del 2026-08-05 (`P0.1`, verificado): el transporte ya deja evidencia. Un
trabajo publica un evento `log` con `metadata.responseTermination`, que conserva
código HTTP, si hubo streaming, bytes, chunks, duración, última señal observada
(`done_marker`, `body_closed`, `local_end`, `read_error`, `no_stream`),
`finish_reason` exacto, si el usage era final, quién abortó, timeout y
`max_tokens` efectivos, tokens y longitud del texto. Nunca el contenido. Con
esto, la próxima repetición del caso sí podrá clasificarse.

Hallazgo del mismo paso, **ya resuelto en `P0.2`**: un corte de lectura con
texto parcial se reintentaba entero, porque los errores sin `status` se
consideraban reintentables. Para una generación de 20 minutos eso era empezar de
cero tres veces. Ahora no se reintenta (`D-016`), lo generado se conserva y el
turno se clasifica como `interrupted`.

Avance del 2026-08-05 (`P0.2`, verificado): existen seis finales explícitos —
`completed`, `truncated`, `interrupted`, `timed_out`, `cancelled` y `failed`—
decididos por lógica pura en `packages/shared/src/response-outcome.ts`. Una
salida parcial se guarda con su motivo real en la metadata del trabajo
(`D-017`), sin tocar el enum de Postgres, y **no escribe memoria**.

Dato de código: una conversación HTTP usa el `jobTimeoutMs` general, una hora
por defecto, y no el antiguo tope fijo de cinco minutos. El esquema permite
hasta seis horas. Aun así, un intermediario o el proveedor puede imponer su
propio límite.

Aviso para cualquier pantalla: desde `D-017`, `status: completed` **ya no
significa** que la respuesta llegara entera. Hay que leer `responseOutcome`.

### Fallo latente corregido el 2026-08-05 (`P0.2b`)

Luxy armaba el cierre local al ver una señal terminal y lo ejecutaba un segundo
después aunque el modelo siguiera escribiendo. Bastaba un `usage` sin `choices`
a mitad de la respuesta. **Reproducido** en `sse.test.ts` y corregido con señales
fuertes y débiles (`D-018`).

Aviso importante para no confundir dos cosas: este fallo era real, pero la
telemetría demostró después que **no** fue la causa de los cortes que veía
Daniel. Ésa está en `LUXY-P0-001`, y era el tope de guardado.

### LUXY-P0-002 — memoria contaminada por código — **resuelto el 2026-08-05**

El fallback compactaba los primeros 1.200 caracteres del texto visible cuando no
llegaba un bloque `LUXY_MEMORY` válido. En una respuesta de HTML/CSS/JS eso
guardaba código como resumen, y además pisaba una memoria anterior correcta.

Corregido en `P0.3` (`D-019`): el fallback ya no existe. Sólo un bloque completo,
válido, sin código dentro y en una respuesta `completed` sustituye la memoria;
cualquier otro caso conserva la última válida y registra por qué
(`absent`, `truncated_block`, `invalid`, `rejected_code`). `looksLikeCode` se
aplica también dentro de un bloque bien formado, porque el modelo puede meter la
respuesta ahí.

Queda para `P0.5`: que Studio **diga** que la memoria se conservó y de qué turno
viene, en lugar de limitarse a mostrar la última.

Requisitos originales, todos cubiertos salvo el aviso en pantalla:

- Nunca convertir HTML, CSS, JavaScript, JSON extenso ni bloques de código en
  memoria.
- No reemplazar una memoria anterior válida cuando el turno acaba truncado,
  interrumpido, cancelado o sin bloque estructurado válido.
- Registrar por separado si la memoria fue `structured`, `preserved` o
  `unavailable`.
- Conservar una respuesta parcial como salida o artefacto, no como memoria.

### LUXY-P0-003 — salidas largas no son artefactos

Desde `P0.3b` una conversación guarda hasta 120.000 caracteres y avisa si aun
así no cabe, así que ya no se pierde una respuesta normal. Eso **no** cierra la
incidencia: sigue siendo el campo de resultado, no un almacén de documentos, y
el listado de Studio devuelve esas respuestas completas.

Una web completa no debe depender de ese campo ni de la memoria.

Avance del 2026-08-06 (`P0.6a` y `P0.6b`, verificado por pruebas): continuar una
generación interrumpida **ya no duplica fragmentos**. `joinContinuation` decide
dónde empieza lo nuevo con cinco estrategias, `continuesJobId` guarda el enlace
en la metadata para que la unión sobreviva a una recarga, y cuando no hay prueba
de continuidad se pega y se avisa en vez de descartar texto (`D-021`).

Sigue faltando la ruta de artefacto: un documento largo aún vive en el
`resultSummary` de cada fragmento, y la memoria acumulativa se cierra turno a
turno en lugar de esperar a que la secuencia esté completa. Es `P0.6c`, y
empieza por una decisión de Daniel sobre dónde se guarda un artefacto.

### LUXY-P0-004 — sondeo desbordado — **causa demostrada y corregida el 2026-08-06**

Observado por Daniel con Studio ya arrancando: **29.432 peticiones al API
Gateway de Supabase en 60 minutos**, 100 % de éxito, con el mismo bloque
repitiéndose cada menos de 3 s.

La causa no era el agente: era el renderer. `useConversations` recargaba cada
1.500 ms las opciones, la lista y el detalle de **cada** respuesta visible,
aunque llevara horas guardada. Con seis respuestas en pantalla, 8 peticiones cada
1,5 s ≈ 19.200/h. `useStudio` repetía el patrón cada 3 s.

Corregido en `P0.8`: un trabajo terminado no se vuelve a pedir, el ritmo baja a
10 s en reposo y a 60 s con la ventana oculta, y las opciones caducan a los 30 s.
Aritméticamente, de ≈19.200/h a ≈480/h en reposo.

Corregido en `P0.9` lo que faltaba, la generación: el agente corre dentro de
Studio y ya publicaba el texto acumulado por el bus local, así que preguntárselo
a Supabase cada 1,5 s era preguntar por algo que estaba en el propio proceso.
Ahora el directo se pinta desde ese bus, el final del agente dispara **una**
recarga dirigida y el sondeo queda de red de seguridad. De ~40 peticiones por
minuto de generación a ~7.

Regla que sostiene `P0.9` y no se puede relajar: **el evento local dispara la
lectura, nunca la sustituye.** Dice que el agente terminó, no lo que quedó
guardado; el final real se lee del trabajo persistido. Y basta una respuesta
viva de otra máquina para volver al sondeo rápido.

**Falta la medición real** (`LA-012`): los dos arreglos están en el renderer y
exigen reiniciar Studio.

Lo que sigue sondeando por diseño: el agente, con `pollIntervalMs` de 2 s
(≈1.800 reclamaciones/h) y heartbeat cada 10 s. Es la decisión `0001` — sin
puertos abiertos, sondea él — y su ajuste vive en la configuración de máquina.

## 8. Estado de migraciones: no inferir

La copia de referencia contiene `0001` a `0005`. Documentación anterior dice
que `0005_luxy_studio_jobs.sql` estaba preparada y debía probarse antes de
aplicarse. Las sesiones recientes mencionan además una `0006` en el worktree de
Windows y ordenan expresamente no tocarla.

Esto es una discrepancia abierta, no permiso para «arreglarla»:

- No modificar `0005`, `0006` ni ninguna migración existente.
- No crear `0007` durante la estabilización de Conversaciones salvo que el
  diseño demostrado lo exija y Daniel lo autorice.
- Verificar primero archivos locales y estado remoto; registrar el resultado en
  `LOCAL-ACTIONS.md` y `CHANGELOG-WORK.md`.

## 9. Validación conocida

Las últimas validaciones históricas comunicadas para los arreglos de
Conversaciones fueron:

- 91/91 pruebas específicas para finalización por señales.
- 30/30 para persistencia de resultado, tokens y memoria.
- 11/11 para estado de Conversaciones y feedback.
- `lint`, TypeScript y build completos en verde en la copia de desarrollo.
- Suite global más reciente: 1.312 pruebas ejecutadas; 1.294 pasaron, 9 se
  omitieron y quedaron 9 fallos ambientales conocidos en Linux más dos suites
  de Electron bloqueadas por caché/permisos. No se informó de regresiones de
  código nuevas.

Son resultados históricos. `TEST-RESULTS.md` debe registrar por separado lo que
se ejecute en cada nuevo checkout o worktree.

La copia Linux usada para preparar este relevo reprodujo el 2026-08-04 la misma
línea base: formato, manifiesto, referencias, lint, tipos y build pasaron;
`npm test` mantuvo 1.294 verdes, 9 omitidas, 9 fallos ambientales y dos suites
Electron sin cargar. El detalle exacto está en `TEST-RESULTS.md`.

**Línea base real de Windows, 2026-08-05:** la suite completa pasa entera.
Antes de `P0.1`, 68 archivos y 1.316 verdes; tras `P0.1`, 69 y 1.334; tras
`P0.2`, 70 y 1.356; tras `P0.2b` y `P0.3`, 70 y 1.366; tras `P0.3b`, 70 y
1.370; tras `P0.3c`, 70 y 1.379; tras `P0.4`, 71 y 1.398; tras `P0.5`, 71 y
1.408; tras `P0.6a`, 72 y 1.426; tras `P0.6b`, 72 y 1.436; tras `P0.8`, 72 y
1.443; tras `P0.9`, 72 y 1.451; tras `P0.6d`, 72 y 1.453. Siempre 9 omitidas y
exit 0. Los 9 fallos «ambientales» eran exclusivos de la copia
Linux y aquí no existen: en esta máquina un fallo es una regresión.

## 10. Próximo objetivo

### UX-001 — trazabilidad del detalle de trabajos (2026-08-20)

Implementado, verificado y commiteado en el worktree aislado
`luxy/ux-001-detalle-trabajo`: los proveedores HTTP informan las llamadas
efectivas al modelo y las herramientas ejecutadas. Gateway las conserva como
`callMetrics`; Studio las presenta sin estimar los trabajos históricos. El detalle
también muestra el worktree y permite abrirlo en el Explorador de Windows. El IPC
resuelve enlaces y rechaza cualquier ruta fuera de
`%LOCALAPPDATA%\Luxy\worktrees`.

Lint, typecheck, 1.574 pruebas (14 omitidas) y build pasaron. Requiere desplegar
el Gateway con autorización para que los trabajos nuevos persistan la métrica.
No cambia los trabajos anteriores ni crea migraciones.

`F4.1-T4` cerró la discrepancia entre la instantánea real y el catálogo
operativo: el snapshot persistido representa los 23 modelos declarados por la
pasarela el 2026-08-07. Los tres incorporados conservan un contrato mínimo y no
reciben herramientas ni aliases implícitos.

Este paso no atribuye precios, tool calling ni límites de salida sin evidencia.
`F4.1-T5` cerró la investigación de precios: las rutas observadas no publican
entradas útiles y Daniel decidió no consultarlas. Luxy actualiza únicamente
`/v1/models` y lo explica una vez en la pantalla. `LA-007` continúa bloqueada
hasta verificar topes por modelo.

`F4.2-T1` añade evidencia local sin benchmarks: una lectura al abrir Modelos
resume trabajos con modelo exacto en completas, parciales, fallos,
cancelaciones y mediana de duración. La muestra está limitada a los últimos 100
trabajos. `F4.2-T2` hace que el agente informe el `apiModel` realmente ejecutado
y que el gateway lo conserve en completados, fallos y cancelaciones; así los
trabajos creados mediante una familia dejan de quedar sin atribución. Los
trabajos históricos sin ninguna evidencia de modelo siguen sin inferirse.
`F4.2-T3` pagina el historial en bloques de 100 hasta 1.000 trabajos, muestra la
cobertura y detecta un Gateway anterior que ignore el desplazamiento. Falta la
comprobación visual `LA-017`; la paginación real requiere probar contra el
Gateway actualizado.

`F4.3-T1` inicia Laboratorio sin gastar tokens: ocho pruebas versionadas cubren
rapidez, código, frontend, español, instrucciones, JSON, contexto largo y tool
calling. Studio muestra prompts y criterios, pero todas las definiciones llevan
`executionEnabled: false`. `F4.3-T2` materializa las seis fixtures referenciadas
y valida localmente salida exacta, restricciones, JSON y recuperación en
contexto largo. Código necesita sandbox; frontend y español, rúbrica humana;
tool calling, una traza real validada. `F4.3-T3` filtra modelos por capacidades
declaradas y
compone una vista previa idéntica para todos, con la fixture marcada como datos.
No verifica capacidades ni crea trabajos. `F4.3-T4` añade el contrato
versionado de una ejecución: exige confirmación literal y modelo exacto, y el
Gateway sólo acepta el snapshot y prompt exactos del catálogo. La metadata
conserva definición, fixture, scoring y modo de validación sin inventar una
nota. El agente reserva un camino de solo lectura sin worktree, herramientas,
memoria ni comprobaciones. Laboratorio muestra la confirmación futura y mantiene
el botón deshabilitado: aún no hay IPC ni consumo.

`F4.3-T5` completa el contrato del resultado automático. En el cierre del
trabajo, Gateway aplica únicamente validadores puros a una respuesta
`completed` cuyo snapshot siga coincidiendo con el catálogo. Persiste checks,
modelo, versión, fixture, final real, caracteres, duración y tokens disponibles
como `evaluationResult`; una salida parcial, un modelo desconocido o un modo
manual/sandbox/traza queda `not_scored`. No existe score numérico, ranking ni
ejecución nueva.

`F4.3-T6` hace visible esa evidencia sin activar evaluaciones. Laboratorio lee
una vez los últimos 100 trabajos al abrirse y sólo repite la lectura mediante
**Actualizar**; no sondea. Un parser puro acepta exclusivamente resultados con
esquema válido y coherentes con ID, versión y modelo del trabajo. La pantalla
muestra hasta 12 recientes con estado, checks, duración, caracteres y tokens, o
explica que todavía no existe ninguno.

`F4.3-T7` habilita la primera ejecución individual únicamente para los cuatro
modos automáticos. Exige máquina conectada, proyecto, familia soportada, modelo
exacto, casilla de consumo y un segundo diálogo que repite prueba/modelo. El
Gateway vuelve a validar catálogo y prompt, rechaza runners pendientes y evita
crear otra evaluación cuando ya observa una activa del mismo Studio. No es un
bloqueo transaccional entre solicitudes simultáneas: esa garantía exigiría otra
estrategia de persistencia. El agente mantiene el trabajo sin worktree,
herramientas, memoria ni checks del proyecto.

`F4.3-T8` completa el ciclo visible sin introducir polling. Un parser separado
identifica evaluaciones no terminales con snapshot válido; Laboratorio muestra
ID, prueba, modelo y estado, y permite solicitar cancelación tras confirmación.
La misma sesión no repite esa solicitud. Cuando el agente confirma el cierre,
Gateway persiste `evaluationResult.status: not_scored` y
`responseOutcome: cancelled`, incluso sin texto parcial.

`F4.3-T9` cubre finales operativos restantes. Un fallo informado por el agente
genera `evaluationResult: not_scored` y `responseOutcome: failed`. Los motivos
de no puntuación ya distinguen truncamiento, interrupción, timeout, cancelación,
fallo y ausencia de final declarado. Un trabajo terminal con snapshot válido
pero sin `evaluationResult` —por ejemplo, un lease expirado o Gateway anterior—
se muestra como **Sin resultado validado** y no se reescribe.

`F4.3-T10` agrega evidencia por prueba, versión y modelo. No publica tasa hasta
tener 3 resultados puntuados; `not_scored` cuenta como muestra observada pero se
excluye de tasa y medianas. No hay ranking ni recomendación.

`F4.4-T1` añade el contrato de comparación controlada sin exponer aún interfaz:
un UUID enlaza los índices 0 y 1, y Gateway sólo acepta el segundo si coincide
con el primero en prueba/versión, prompt exacto, máquina y proyecto, usando un
modelo exacto distinto. La ejecución individual mantiene su exclusión anterior.
La comprobación lectura-creación no es transaccional; la futura orquestación debe
mostrar una aceptación parcial y no asumir atomicidad.

`F4.4-T2` conecta esa orquestación en Laboratorio. La persona elige modo, dos
modelos y confirma una sola vez; Desktop envía miembro 0 y luego 1. Un rechazo
del primero detiene el par y uno del segundo deja el primero visible como estado
parcial, sin reintento. La presentación conjunta por UUID quedaba para `F4.4-T3`.

`F4.4-T3` cierra esa presentación: el historial valida UUID/índice juntos y
reconstruye A/B exclusivamente por esa identidad. El panel conserva pares
parciales, estados activos, `not_scored` y terminales sin resultado. Duplicados o
pruebas/versiones mezcladas se marcan inválidos; no hay emparejamiento por fecha
ni ganador automático.

`F4.5` queda cubierto sin una migración adicional: `jobs` ya conserva prompt y
respuesta completos, y `evaluationResult` conserva snapshot, modelo efectivo,
checks, final, caracteres, duración y tokens. Laboratorio reúne esa evidencia en
un detalle colapsado. `failed/not_scored` sustituyen cualquier nota numérica
subjetiva.

`F4.6` añade recomendación local provisional. Exige dos modelos con tres
resultados puntuados de la misma prueba/versión. Prioriza tasa; mediana sólo para
`timing`; feedback repetido de conversaciones completadas del mismo proyecto
sólo desempata. Empates e insuficiencia no producen recomendación y seleccionar
el modelo no ejecuta nada.

La primera validación visual detectó una ambigüedad: el selector permitía elegir
Frontend, cuyo runner manual está bloqueado, y por eso deshabilitaba confirmación
y botón. Se corrigió separando las cuatro opciones ejecutables de las ocho fichas
del catálogo. No se relajó la política de runners.

La primera prueba de comparación devolvió `422` porque el Worker remoto aún era
anterior al contrato A/B. Tras renovar la sesión Cloudflare de la cuenta correcta,
se desplegó el Worker existente y `/health` confirmó que responde. Falta repetir
la prueba funcional desde Desktop con el agente reiniciado.

Estimación de alcance a 2026-08-09, sujeta a validación manual y decisiones de
producto:

- Modelos/Laboratorio: **100% implementado; validación manual pendiente**;
- Luxy Studio v1 de escritorio, excluyendo Mobile: **72–76%**;
- roadmap completo actual, incluyendo Proyectos avanzados, Playground, Flujos y
  Android: **44–49%**.

El porcentaje completo es menor porque las fases 3, 5, 6 y 7 siguen planificadas;
no invalida que el núcleo de Studio ya sea utilizable.

El bloque de respuestas largas (`P0.0`–`P0.9`, incluido el artefacto de
`P0.6c`) está implementado y automatizadamente verificado. Su validación manual
en Studio permanece separada en `LA-012`; no bloquea corregir el catálogo.
