# Luxy — tarea activa

ID: **LUXY-P0-LONG-RESPONSES**  
Prioridad: **P0 — bloquea la consolidación del checkpoint**  
Estado: **en curso; `P0.0`–`P0.5`, `P0.6a`, `P0.6b`, `P0.6d`, `P0.8` y `P0.9`
cerrados**  
Responsable actual: **la próxima IA que abra el repositorio en VS Code**

> **Dónde está el trabajo, comprobado el 2026-08-06 08:17.** No es lo que decía
> `LA-008`. El repositorio activo es `C:\Users\daniel\Desktop\Luxy`, rama
> `feat/luxy-desktop`, **árbol limpio**, y todo `P0.0`–`P0.5` está commiteado
> (`9012eda`, `16c6e9a`, `845c3cb`, `c6e5094`). Aquel riesgo de 7.997 líneas sin
> commit ya no existe. Línea base verificada aquí: **1.408 pasadas**, 9
> omitidas, 71 archivos.

## Objetivo

Hacer que una conversación larga termine con un estado correcto, conserve todo
lo recuperable y nunca contamine la memoria, sin confundir una pausa legítima de
un modelo lento con el final de la respuesta.

## Hechos confirmados

- Las respuestas normales ya finalizan automáticamente y guardan memoria y
  tokens.
- **Detener** funciona.
- **Causa demostrada el 2026-08-05**: las respuestas llegaban enteras
  (`done_marker`, `finish_reason: stop`, sin aborto) y Luxy las cortaba **al
  guardar**, con un tope de 4.000 caracteres compartido con las tareas.
  Corregido en `P0.3b`.
- Una generación de web con Kimi duró unos 23 min 43 s, produjo alrededor de
  6.422 tokens de salida y acabó en mitad de HTML. Aquel caso no tenía
  telemetría; el patrón coincide con el tope de guardado.
- El fallback de memoria resumía el texto visible y copiaba código. Eliminado en
  `P0.3`.
- Las conversaciones HTTP usan por defecto el timeout general del trabajo
  (una hora), no un temporizador de inactividad de cinco segundos.

## Restricciones de esta tarea

- No tocar migraciones, incluida `0006`.
- No commit, push, deploy ni producción.
- No API real en tests automatizados.
- No registrar prompts, respuestas, claves, cabeceras ni URLs con secretos.
- No añadir un cierre por silencio corto.
- No reducir el timeout de los modelos lentos.
- No cambiar la memoria anterior hasta distinguir final correcto de salida
  parcial.

## Plan ejecutable

Cada paso debe actualizar su estado aquí y añadir evidencia a
`CHANGELOG-WORK.md` en cuanto termine.

### P0.0 — verificar el checkpoint

Estado: `done` (Claude Code, 2026-08-05 08:38)

- Leer `git status --short --branch` y `git diff --stat` del worktree real.
- Confirmar qué parches están presentes mediante código y, cuando proceda,
  `git apply --reverse --check`.
- Listar migraciones sin modificarlas y registrar la discrepancia 0005/0006.
- Ejecutar las pruebas específicas actuales para obtener una línea base.

Criterio de aceptación: estado real documentado sin limpiar ni modificar
código.

Resultado: rama `luxy/work-update-001-studio`, HEAD `61fb7ee`, 29 modificados y
22 sin seguimiento. Migraciones `0001`–`0006` presentes e intactas. Los tres
parches finales están aplicados. Línea base **verde** en Windows: 1.316 passed,
9 skipped, exit 0; los 9 fallos ambientales anteriores eran de la copia Linux.
Detalle en `TEST-RESULTS.md` y `CHANGELOG-WORK.md`.

### P0.1 — telemetría segura del final de la respuesta

Estado: `done` (Claude Code, 2026-08-05 08:51)

Implementado y verificado:

- `STREAM_TRANSPORT_ENDS` y `RESPONSE_ABORT_SOURCES` en `shared/constants.ts`.
- `responseTerminationSchema` y `formatResponseTermination` en `shared/schemas.ts`.
- `sseData` informa de la última señal (`done_marker`, `body_closed`,
  `local_end`, `read_error`) con bytes, chunks y duración.
- `HttpApiProvider` compone el diagnóstico y lo devuelve en
  `ProviderRunResult.termination`, también cuando la petición falla, se cancela
  o se agota el tiempo. El camino sin streaming informa `no_stream`.
- `job-runner` publica un evento `log` con `metadata.responseTermination`; el
  gateway ya persiste `metadata` de evento, así que llega a Studio sin migración.

Límite conocido, aún no resuelto: el camino agentic (`callTurn`) todavía no
rellena `termination`. Las conversaciones no lo usan.

Añadir eventos diagnósticos estructurados, sin contenido, para conservar:

- `httpStatus`;
- streaming o no streaming;
- bytes/chunks recibidos y duración;
- última señal observada: `[DONE]`, `finish_reason`, usage final, cierre de
  cuerpo, aborto, timeout o error de lectura;
- `finishReason` exacto cuando exista;
- quién inició el aborto: usuario, timeout de trabajo, finalización local o
  transporte;
- timeout efectivo y `maxOutputTokens` efectivo;
- tokens finales y si el usage era final o parcial.

Criterio de aceptación: un trabajo deja evidencia suficiente para explicar por
qué terminó sin guardar el contenido de la respuesta.

### P0.2 — modelo explícito de resultados

Estado: `done` (Claude Code, 2026-08-05 09:55)

Implementado y verificado:

- `RESPONSE_OUTCOMES` en `shared/constants.ts` y `classifyResponseOutcome` en
  `shared/response-outcome.ts`, lógica pura con su matriz de pruebas.
- El proveedor **ya no reintenta** un corte que había producido texto (`D-016`),
  y devuelve lo generado en `finalText` aunque `ok` sea false.
- `job-runner` clasifica, conserva la salida parcial como resultado
  (`truncated`, `interrupted`, `timed_out`) y avisa con el motivo real.
- El resultado lleva `responseOutcome` y `responseTermination`; el gateway los
  persiste en la metadata del trabajo (`D-017`), sin migración.
- Una respuesta que no termina en `completed` **no escribe memoria**: Studio
  sigue usando la última válida.

Límites conocidos:

- una cancelación manual todavía no conserva el texto parcial; el camino
  `cancelled` del gateway no guarda resultado. `P0.5` no lo arregla: la interfaz
  ya sabe pintar un `cancelled` con texto parcial, pero ese texto no llega.
  Pasa a `P0.6`;
- el camino agentic sigue sin `termination`, así que cae en la rama «sin
  diagnóstico» del clasificador, que no inventa motivos.

Hallazgo de `P0.1`, ya resuelto aquí: un `read_error` con texto parcial se
reintentaba entero. Ahora no se reintenta (`D-016`) y se clasifica como
`interrupted` conservando lo generado. Hay prueba de las dos ramas: con texto,
un solo intento; sin texto, tres.

Separar al menos:

- `completed`: señal terminal válida o cierre HTTP normal con respuesta válida;
- `truncated`: `finish_reason === "length"`;
- `interrupted`: error/cierre anómalo después de recibir contenido parcial;
- `timed_out`: timeout efectivo de Luxy;
- `cancelled`: cancelación solicitada por el usuario;
- `failed`: no hay resultado utilizable.

No convertir una salida parcial en `completed`. Conservarla como dato recuperable
y mostrar el motivo real en Studio.

Criterio de aceptación: cada final simulado llega a un estado único y no queda
eternamente en `running`.

### P0.2b — corte local con datos en vuelo

Estado: `done` (Claude Code, 2026-08-05 10:52)

No estaba en el plan: salió de una prueba manual de Daniel con Kimi K2.6, que
devolvió una web cortada por la mitad con 3.180 tokens de salida sobre un tope
de 8.192.

- **Reproducido** en `sse.test.ts`: un `usage` intermedio armaba el cierre local
  y éste se ejecutaba un segundo después aunque el modelo siguiera escribiendo.
  Luxy se quedaba con el primer fragmento y descartaba el resto.
- Arreglado con señales fuertes y débiles (`D-018`). El margen se cuenta desde
  el último evento, no desde la primera señal.
- `softTerminalGraceMs` es configurable por proveedor; por defecto 15 s.

### P0.3 — memoria resistente a truncaciones y código

Estado: `done` (Claude Code, 2026-08-05 10:52)

- Eliminado `compactConversationMemoryFallback`: no hay resumen de reserva.
- `parseConversationMemoryResponse` devuelve `memory: null` y un estado
  explícito: `structured`, `absent`, `truncated_block`, `invalid` o
  `rejected_code`.
- `looksLikeCode` detecta HTML, CSS, JavaScript, JSON y cercas de Markdown, y se
  aplica **también** dentro de un bloque bien formado.
- La memoria sólo se sustituye con un bloque válido en una respuesta
  `completed`; el resto conserva la anterior porque `latestConversationMemory`
  retrocede hasta el último turno con memoria.
- `conversationMemoryStatus` viaja en el resultado y lo persiste el gateway.

Resuelto en `P0.5`: Studio **dice** qué le pasó a la memoria en este turno, con
una frase distinta por cada uno de los cinco estados
(`describeConversationMemoryStatus`). Queda para más adelante decir de qué turno
concreto viene la memoria que se conservó.

- Pasar al nuevo trabajo una copia estructurada de la última memoria válida,
  separada del prompt visible, usando metadata; no requiere una tabla nueva.
- Reemplazar memoria sólo cuando llegue un bloque `LUXY_MEMORY` completo y
  válido dentro de una respuesta completada.
- Si el turno termina truncado, interrumpido, cancelado o con memoria inválida,
  conservar la anterior y marcar `conversationMemoryStatus: "preserved"`.
- Si no existe memoria anterior, guardar un estado `unavailable`, no código.
- Eliminar el fallback basado en los primeros 1.200 caracteres de la respuesta.
- Añadir detectores defensivos para cercas de código, HTML, CSS, JS y JSON
  extenso, aunque el modelo etiquete mal el contenido.

Criterio de aceptación: ninguna prueba puede introducir código en `summary`, y
una memoria válida anterior sobrevive a todos los finales incompletos.

### P0.3b — el corte real: el tope de guardado

Estado: `done` (Claude Code, 2026-08-05 11:15)

La telemetría de `P0.1` sirvió para lo que se hizo: **descartar hipótesis con
datos**. Consultando la metadata de los dos trabajos reales:

| Trabajo    | tokens salida | caracteres recibidos | guardado | transporte    | finish_reason | aborto  |
| ---------- | ------------- | -------------------- | -------- | ------------- | ------------- | ------- |
| `LUX-YJT9` | 3.180         | 7.716                | 4.000    | `done_marker` | `stop`        | ninguno |
| `LUX-8B8T` | 2.720         | 7.691                | 4.000    | `done_marker` | `stop`        | ninguno |

Conclusión **demostrada**: la llamada terminaba bien y la respuesta llegaba
entera. El corte lo hacía Luxy al guardar, con el tope de 4.000 caracteres que
compartían tareas y conversaciones. El final del texto guardado coincide
carácter a carácter con el punto donde la captura de Daniel se corta.

Arreglado (`D-020`): la conversación guarda hasta 120.000 caracteres, la tarea
sigue en 4.000, la tarjeta de Telegram se recorta al renderizar y, si alguna vez
no cabe, se avisa y se marca `summaryTruncated`.

Además, `conversationMemoryStatus: invalid` en `LUX-8B8T` demostró que el modelo
**sí** escribía su memoria: el bloque se descartaba entero por pasarse de los
límites. Ahora se recorta a los límites en vez de tirarlo.

### P0.3c — errores del proveedor explicados como lo que son

Estado: `done` (Claude Code, 2026-08-05 16:36)

Salió de una prueba de Daniel con KAT Coder Pro v2.5. Los errores son del
proveedor —429 por frecuencia y 400 por límite de plan— y no se arreglan desde
aquí, pero Luxy los contaba y los explicaba mal:

- decía «tras 3 intentos» cuando había rechazado a la primera;
- perdía el código HTTP al envolver el error, así que volcaba el JSON crudo del
  proveedor en vez de una frase útil;
- ignoraba `Retry-After` en los 429;
- no distinguía un límite de plan de un fallo cualquiera.

Los cuatro corregidos, con prueba de cada uno usando los mensajes reales.

### P0.4 — matriz de regresión sin APIs reales

Estado: `done` — 2026-08-05

Mocks obligatorios:

1. `[DONE]` normal.
2. `finish_reason: stop` y socket abierto.
3. usage final sin `choices` y socket abierto.
4. último JSON sin salto de línea.
5. cierre HTTP normal sin `[DONE]`.
6. pausa larga con nuevos bytes posteriores: no cortar.
7. `finish_reason: length` con texto parcial.
8. `AbortError` por timeout con texto parcial.
9. error de lectura/cierre de socket con texto parcial.
10. cancelación manual.
11. bloque de memoria completo.
12. bloque ausente, malformado o cortado en mitad.
13. respuesta compuesta principalmente por HTML/CSS/JS.

Criterio de aceptación: pruebas deterministas, rápidas y sin red real que
cubran transporte, resultado, gateway, persistencia y renderer.

**Cerrado.** La matriz vive en `apps/agent/src/response-matrix.test.ts`, 19
pruebas, y se lee como la tabla que es. Reparto:

| Casos | Dónde                    | Cómo                                                                                                                                                          |
| ----- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1–9   | `describe` de transporte | tabla `CASOS_TRANSPORTE`; cada fila pasa un cuerpo real por `sseData` y `TurnAssembler`, y de ahí sale el diagnóstico que clasifica `classifyResponseOutcome` |
| 10    | `describe` propio        | de punta a punta con `runJob`: `AbortController` durante el streaming                                                                                         |
| 11–13 | `describe` de memoria    | `parseConversationMemoryResponse` y `looksLikeCode`                                                                                                           |

Decisión de diseño: las terminaciones **no** se escriben a mano. Si se
inventaran, la prueba sólo comprobaría que el clasificador es coherente consigo
mismo, no que el transporte sigue diciendo lo mismo. Lo único que se inyecta a
mano es lo que el transporte no puede producir solo: el aborto por timeout del
caso 8 y el `abortedBy: 'user'` del caso 10.

Lo que la matriz fija además de los trece casos:

- El caso 6 comprueba que el texto **posterior a la pausa** sigue ahí. Es la
  regresión concreta que cortó una web por la mitad: lo que autoriza a cerrar es
  el silencio tras la señal débil, nunca el reloj mientras llegan datos.
- Sólo `truncated`, `interrupted` y `timed_out` ofrecen continuar. Si alguien
  añade `cancelled` a `RECOVERABLE_RESPONSE_OUTCOMES`, la matriz falla.
- La cancelación manda sobre cualquier diagnóstico: aunque el transporte diga
  `length`, si lo paró una persona el final es `cancelled`. No se le atribuye al
  modelo algo que hizo Daniel.
- El caso 10 comprueba las cuatro cosas de punta a punta: final `cancelled`, el
  texto generado antes de parar sí llegó a Studio como evento, el diagnóstico se
  emite **también** al cancelar, y una conversación cancelada no ejecuta
  comprobaciones ni deja worktree.

### P0.5 — interfaz de recuperación

Estado: `done` — 2026-08-05

- Mostrar `Guardado`, `Truncado`, `Conexión interrumpida`, `Tiempo agotado`,
  `Cancelado` o `Falló` según corresponda.
- Mostrar tokens y duración aunque el resultado sea parcial.
- Conservar la respuesta parcial visible.
- Mostrar que la memoria anterior se conservó, sin desplegar código en ella.
- Añadir **Continuar generación** sólo para `truncated` o `interrupted` con
  contenido parcial.

Criterio de aceptación: Daniel entiende qué ocurrió y puede recuperar el trabajo
sin pulsar Detener para finalizarlo.

Archivos:

- `packages/shared/src/schemas.ts`: `describeConversationMemoryStatus`, una frase
  por cada uno de los **cinco** estados de memoria.
- `apps/desktop/src/renderer/conversation.ts`: `conversationOutcomeView`,
  `conversationTerminationOf`, `conversationMemoryStatusOf` y
  `continuationMessageFor`.
- `apps/desktop/src/renderer/pages/Conversations.tsx`: `ResponseCard` lee el
  final real y añade el botón; la página rellena el compositor.
- `apps/desktop/src/renderer/conversation.test.ts`: 10 pruebas nuevas.

Lo que decide el diseño:

1. **La etiqueta sale de `responseOutcome`, no de `status`.** Un trabajo
   truncado sigue siendo `completed` en la base de datos, así que pintar
   `STATUS[status]` diría «Guardado» sobre una respuesta cortada. `status` sólo
   se usa como respaldo cuando el final es genuinamente desconocido: trabajo aún
   corriendo, o turno anterior al contrato.
2. **El texto parcial se ve siempre que exista, también con `errorMessage`.** Un
   aviso rojo no puede tapar veintitrés minutos de generación.
3. **Los contadores no se inventan.** Sin `responseTermination` no hay tokens; la
   duración cae a `metadata.durationMs` y, si tampoco está, a la observada.
4. **La nota de memoria distingue los cinco estados.** Por dentro los cuatro que
   no son `structured` acaban igual (se conserva la anterior), pero «no había
   bloque» y «el bloque se cortó» no significan lo mismo, y confundirlos es lo
   que hace pensar que Luxy ha olvidado algo.

Dos precisiones frente a la letra de este apartado:

- El botón usa `isRecoverableOutcome`, luego aparece también en `timed_out`,
  no sólo en `truncated` e `interrupted`. Es deliberado: una sola fuente de
  verdad, y `describeResponseOutcome('timed_out')` ya dice «puedes continuarla».
  `cancelled` sigue fuera.
- **Continuar generación sólo rellena el compositor** con el modelo original y
  un mensaje que nombra el motivo del corte y prohíbe repetir lo escrito. La
  unión real de los fragmentos, con detección de solapamiento, es `P0.6`. Aquí
  no se concatena nada.

### P0.6 — continuación sin duplicados y artefactos

Estado: `in_progress` — dividido en tres subpasos con ID propio.

| ID    | Trabajo                                                   | Estado              |
| ----- | --------------------------------------------------------- | ------------------- |
| P0.6a | unión de fragmentos con detección de solapamiento (puro)  | `done` — 2026-08-06 |
| P0.6b | la continuación recibe el parcial como dato no confiable  | `done` — 2026-08-06 |
| P0.6c | artefactos: dónde vive una salida larga y con qué límites | `done` — 2026-08-06 |
| P0.6d | una cancelación manual conserva lo generado               | `done` — 2026-08-06 |

- La continuación debe referenciar el objetivo, el resultado parcial y un
  solapamiento final acotado como datos no confiables.
- Unir fragmentos con detección de solapamiento; nunca concatenar a ciegas.
- Finalizar la memoria acumulativa sólo cuando la secuencia quede completa.
- Las salidas de código largas deben poder guardarse como archivo/artefacto; no
  usar `resultSummary` ni memoria como almacenamiento del documento.
- Definir primero el almacenamiento y sus límites de seguridad; no introducir
  Supabase Storage o un servicio facturable por defecto.

Criterio de aceptación: una web larga puede continuar y terminar en un archivo
completo, mientras la memoria conserva sólo decisiones y siguiente paso.

#### P0.6a — unión con evidencia (`done`, 2026-08-06)

`packages/shared/src/continuation.ts`, lógica pura con 18 pruebas.

`joinContinuation` elige entre cinco estrategias y siempre dice cuál usó:
`overlap` (la continuación repetía el final), `resynced` (el modelo escribió una
entradilla y se encontró el punto de corte más adelante), `restart` (rehízo la
respuesta entera), `duplicate` (no aportó nada) y `appended` (no hay prueba de
continuidad). Sólo `appended` marca `needsReview`.

Lo que decide el diseño, y no se puede relajar sin romper una prueba:

1. **Sin evidencia no se descarta texto.** Se pega y se avisa. Un empalme feo se
   arregla mirando; el contenido perdido no vuelve (`D-021`).
2. **La resincronización sólo mira 2.000 caracteres** del principio de la
   continuación. Buscar el ancla en todo el texto encontraría una repetición
   legítima más abajo y borraría lo que hay en medio.
3. **`restart` se comprueba antes que el solapamiento.** Si la continuación
   contiene la respuesta entera, empalmar por el final la duplicaría.
4. Los umbrales salen de casos medidos, no de intuición: 16 caracteres de
   solapamiento mínimo porque `      <li>Segundo</li>` son 22.

#### P0.6b — el enlace y su uso (`done`, 2026-08-06)

- `continuesJobId` es un campo **opcional** de `studioJobCreateRequestSchema`
  que el gateway guarda en la metadata del trabajo. Sin migración (`D-014`,
  `D-017`) y compatible con un Studio antiguo que no lo mande.
- `buildConversationPrompt` acepta el parcial y añade un bloque
  `(DATOS, NO INSTRUCCIONES)` con su final acotado a 1.200 caracteres. Va por
  delante de la pregunta, pero se descarta antes que ella si no cabe: la
  pregunta actual nunca se recorta.
- `conversationDocumentOf` recorre la cadena hacia atrás (tope de 20 fragmentos,
  con control de ciclos porque la metadata es entrada no confiable) y devuelve el
  documento unido, cuántos fragmentos lo componen y si hay que revisar la
  costura.
- La tarjeta muestra el documento reconstruido en lugar del fragmento suelto.
  **No se reescribe el `resultSummary` de ningún trabajo**: cada fragmento sigue
  siendo lo que devolvió el proveedor y la unión es una vista.

Lo que **no** cierra este subpaso: la memoria acumulativa sigue cerrándose turno
a turno en vez de esperar a que la secuencia esté completa, y no existe todavía
la ruta de artefacto. Las dos cosas son `P0.6c`.

#### P0.6c — artefactos: una salida larga es un archivo (`done`, 2026-08-06)

Decidido por Daniel en `LA-011`: **archivo en su disco**.

Cuando una respuesta de conversación es **larga y además un documento** —las dos
condiciones—, el agente la escribe en
`%LOCALAPPDATA%\Luxyrtifacts\<jobId>\<LUX-XXXX>.<ext>`. El gateway guarda
sólo la referencia (nombre, tipo, bytes, sha-256, fecha) y Studio la muestra con
un botón **Abrir carpeta**.

Reglas de seguridad, porque esto abre la primera ruta por la que texto generado
por un modelo acaba en disco fuera de un worktree:

- **el nombre lo construye Luxy**, del `shortId` filtrado a `[A-Z0-9-]`, y la
  extensión sale de un detector de contenido. El modelo no propone nombre;
- **dos barreras**: se filtra al construir el nombre **y** se comprueba la ruta
  final contra la raíz antes de escribir;
- tope de 2 MB por archivo;
- si escribir falla, se avisa y el trabajo sigue. Un artefacto es una mejora, no
  un requisito;
- el renderer manda sólo el `jobId` por IPC, nunca una ruta.

El artefacto **no sustituye** al resultado: `resultSummary` sigue llevando el
texto.

Lo que queda de este apartado: cerrar la memoria acumulativa sólo cuando la
secuencia esté completa, y decidir caducidad o cuota de los artefactos —hoy
nadie los borra.

#### P0.6d — pulsar Detener ya no cuesta lo generado (`done`, 2026-08-06)

Era el límite que `P0.2` dejó apuntado y `P0.5` no pudo arreglar: la interfaz
sabía pintar un `cancelled` con texto parcial, pero el texto no llegaba.
`buildCancelledOutcome` devolvía archivos, worktree y duración; el gateway
guardaba estado y metadata. Lo generado existía en `recoveredText` y se tiraba.

Ahora el agente manda el parcial —redactado y con el mismo tope que un resultado
normal— junto al diagnóstico, y el gateway lo guarda como `result_summary` con
`responseOutcome: 'cancelled'`. Sin texto no se inventa nada.

Tres cosas que no cambian, a propósito:

- `cancelled` **sigue fuera** de `RECOVERABLE_RESPONSE_OUTCOMES`: el texto se ve,
  pero no aparece **Continuar generación**. Lo paró una persona y sabe por qué;
- una cancelación **no escribe memoria** (`D-019`);
- los campos nuevos son opcionales, así que un agente anterior sigue cancelando
  igual.

### P0.8 — el sondeo no puede desbordar la base de datos

Estado: `done` — 2026-08-06

Fuera de plan. Salió de una observación de Daniel con Studio ya arrancando:
29.432 peticiones al API Gateway de Supabase en 60 minutos, con el mismo bloque
repitiéndose cada menos de 3 s en la salida de `wrangler`.

**Causa demostrada**, leyendo el código junto a esa salida: `useConversations`
recargaba cada 1.500 ms las opciones, la lista y el detalle de **cada** respuesta
visible, incluidas las guardadas hacía horas. Con seis respuestas en pantalla son
8 peticiones cada 1,5 s ≈ 19.200/h. `useStudio` repetía el patrón cada 3 s.

Tres cambios:

1. **Un trabajo terminado no se vuelve a pedir.** La lista ya trae el trabajo
   completo en cada vuelta, así que hace de testigo: si el estado, `completedAt`
   y `resultSummary` siguen igual y ya había terminado, su detalle no puede
   haber cambiado. Un trabajo vivo se pide siempre.
2. **El ritmo sigue a la realidad**: 1,5 s con algo corriendo, 10 s en reposo,
   60 s con la ventana oculta. Volver a la ventana refresca en el acto; enviar o
   detener recalcula el ritmo sin esperar al temporizador lento.
3. **Las opciones caducan a los 30 s** en vez de pedirse en cada vuelta.

Aritmética, con seis respuestas guardadas y nada corriendo: de ≈19.200/h a
≈480/h; con la ventana oculta, 60/h. **Es una cuenta sobre el código, no una
medición**: la medición es `LA-012`.

Lo que **no** se ha tocado: el sondeo del agente (`pollIntervalMs`, 2 s, ≈1.800
reclamaciones/h). Es la decisión de arquitectura `0001`, vive en la configuración
de máquina y subirlo retrasa el arranque de los trabajos. Es decisión de Daniel.

### P0.9 — el streaming llega por el bus local, no por Supabase

Estado: `done` — 2026-08-06

`P0.8` arregló el reposo. Esto arregla la generación: Studio le preguntaba a
Supabase, a unos 800 ms por viaje, qué estaba escribiendo un proceso que tiene
dentro de sí mismo.

El canal ya existía y no se usaba en Conversaciones: el agente corre en un
utility process y publica `job.claimed`, `job.output`, `job.completed`,
`job.failed` y `job.cancelled` con `jobId`; el renderer ya se suscribía en
`useAgent.ts`. En una conversación, cada `provider_output` lleva el texto
**acumulado**, que es exactamente lo que pinta la tarjeta.

Qué hace ahora:

1. mientras genera esta máquina, el texto sale del bus local: **cero
   peticiones** durante la generación;
2. cuando el agente termina, **una** recarga dirigida, para leer lo que quedó
   guardado;
3. con todo lo vivo en local, el sondeo baja de 1,5 s a 10 s.

Tres invariantes que no se pueden relajar:

- **el evento dispara la lectura, no la sustituye.** Un evento local dice que el
  agente terminó, no lo que se guardó. El final real —`responseOutcome`,
  memoria, tokens— se lee del trabajo persistido, que sigue siendo la fuente de
  verdad. El bus es best-effort;
- **basta una respuesta viva de otra máquina** para volver al sondeo de 1,5 s:
  de esa no llega ningún evento local;
- el contador de «primer texto» se mide con el primer `job.output` local, porque
  durante el directo ya no se piden los eventos guardados.

De ~40 peticiones por minuto de generación a ~7.

### P0.7 — validación y cierre

Estado: `pending`

- Ejecutar pruebas específicas.
- Ejecutar `npm run lint`, `npm run typecheck`, `npm test` y `npm run build`.
- Hacer una única prueba manual con proveedor real sólo si Daniel la inicia
  explícitamente.
- Actualizar todos los archivos de continuidad.
- Preparar diff; no commit ni push.

Criterio de aceptación: resultados completos documentados y ninguna regresión
oculta.

## Siguiente acción exacta

Cuatro cosas, en este orden:

0. **Daniel**: reiniciar Studio y confirmar en el panel de Supabase que las
   peticiones caen (`LA-012`). El arreglo de `P0.8` está en el renderer, así que
   un Studio ya abierto sigue con el código viejo.
1. **Daniel, decisión que bloquea `P0.6c`**: dónde vive un artefacto largo.
   Propuesta, para aprobar o corregir: lo escribe el agente en
   `%LOCALAPPDATA%\Luxy\artifacts\<jobId>\<nombre>`, con tope por archivo, sólo
   dentro de esa carpeta y validando la ruta con `paths.ts`; el gateway guarda
   únicamente la referencia en la metadata. Coste 0 €, sin Supabase Storage y
   sin abrir puertos. No se escribe código hasta que esto esté decidido.
2. **Daniel**: `LA-010` sigue bloqueando cualquier comprobación visual. Nada de
   `P0.5` ni de `P0.6b` se ha visto en pantalla. Después, `LA-006` y `LA-007`.
3. `P0.6c`, ya con la decisión tomada: ruta de artefacto para salidas largas y
   cierre de la memoria acumulativa sólo cuando la secuencia esté completa.

`P0.4` quedó cerrado el 2026-08-05: matriz completa en
`apps/agent/src/response-matrix.test.ts`. `P0.5` el mismo día: Studio ya no
llama «Guardado» a una respuesta cortada. `P0.6a` y `P0.6b`, el 2026-08-06:
Studio une los fragmentos con evidencia y avisa cuando no la tiene.
