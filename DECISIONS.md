# Luxy — registro de decisiones

Las decisiones recientes prevalecen sobre documentos antiguos. Una IA no las
reabre por preferencia personal: necesita nueva evidencia, un conflicto técnico
demostrado o una petición explícita de Daniel.

## D-001 — producto privado y coste cero

Fecha: 2026-08-01  
Estado: aceptada

Luxy es personal y privado. No SaaS, facturación, multi-tenant, planes, pagos,
publicación comercial ni iOS. La arquitectura debe mantenerse en servicios y
planes gratuitos sin gasto silencioso.

## D-002 — Studio es la interfaz principal

Fecha: 2026-08-01  
Estado: aceptada

Luxy Studio para Windows es la prioridad. Telegram se conserva para órdenes
rápidas, notificaciones y respaldo. Android llegará después. Luxy Remote se
conserva pausado.

## D-003 — Claude y Codex sin API de pago

Fecha: 2026-07-27  
Estado: aceptada

Claude Code y Codex CLI usan la sesión local autenticada de las suscripciones.
No usar las APIs de Anthropic u OpenAI ni automatizar sus interfaces web.

## D-004 — sin fallback silencioso

Fecha: 2026-07-27  
Estado: aceptada

Luxy ejecuta el proveedor/modelo pedido o explica por qué no puede. La interfaz
muestra siempre lo que se ejecutó realmente. Una recomendación sólo se aplica
mediante una acción explícita.

## D-005 — aislamiento Git y aprobaciones

Fecha: 2026-07-27  
Estado: aceptada

Las tareas que pueden escribir trabajan en un worktree. La carpeta original no
se toca. Aplicar crea un commit aislado sólo tras confirmación. Descartar elimina
el worktree sólo tras confirmación. Push requiere dos confirmaciones y
`allowPush: true`.

Corrección aceptada el 2026-08-10: si un proyecto editable no tiene Git, Luxy
crea `.gitignore` sólo si no existe, ejecuta `git init` y crea el commit local
`estado inicial` sin remoto antes de crear el worktree. No se inicializan
proyectos con `allowEdits: false`; `.env`, dependencias y salidas generadas
quedan excluidos por defecto.

## D-006 — tests sin tokens reales

Fecha: 2026-07-27  
Estado: aceptada

La suite automatizada usa mocks para proveedores, gateway, Telegram y Supabase.
Las pruebas reales de proveedor son manuales, explícitas y separadas.

## D-007 — conversaciones sobre la cola existente

Fecha: 2026-08-03  
Estado: aceptada

Las conversaciones reutilizan trabajos, eventos y metadata. No necesitan una
tabla propia mientras ese diseño sea suficiente. Una migración nueva debe
justificarse con una limitación demostrada.

## D-008 — conversaciones de solo lectura

Fecha: 2026-08-03  
Estado: aceptada

Una conversación no crea worktree, no usa herramientas, no ejecuta checks y no
puede modificar el proyecto. Las tareas de agente siguen siendo un modo distinto.

## D-009 — memoria estructurada en Luxy

Fecha: 2026-08-03  
Estado: aceptada, corrección P0 pendiente

Las APIs no necesitan memoria nativa. Luxy guarda un resumen estructurado con
hechos, decisiones, plan, preguntas y lecciones. El bloque se separa del texto
visible y se trata como dato no confiable. La memoria no es historial completo
ni almacenamiento de código.

Corrección aprobada de diseño: una respuesta incompleta o una memoria inválida
no puede reemplazar una memoria válida anterior.

## D-010 — feedback como aprendizaje local explícito

Fecha: 2026-08-04  
Estado: aceptada

`Útil` y `No me sirvió` no entrenan el modelo. Alimentan puntuaciones locales de
proveedor/modelo y, en A/B, eligen la respuesta canónica. Luxy explica la
recomendación y no cambia de modelo automáticamente.

## D-011 — finalización por señales, no por silencio breve

Fecha: 2026-08-04  
Estado: aceptada

Una pausa larga puede ser legítima. El final normal se basa en `[DONE]`,
`finish_reason`, usage final, bloque de memoria completo o cierre HTTP normal.
El watchdog es el timeout general configurable del trabajo, no un cierre de
cinco segundos desde el último texto.

## D-012 — estados incompletos explícitos

Fecha: 2026-08-04  
Estado: aceptada para implementar

Luxy debe distinguir completado, truncado, interrumpido, timeout, cancelado y
fallo. Una salida parcial no se marca como completada y no se pierde.

## D-013 — código largo como artefacto

Fecha: 2026-08-04  
Estado: aceptada para diseñar

Una web, documento o bloque grande no se guarda en `resultSummary` ni en la
memoria. Debe existir una ruta de artefacto/archivo con límites y procedencia.

## D-014 — no tocar migraciones durante la estabilización

Fecha: 2026-08-04  
Estado: aceptada

No modificar `0005`, `0006` ni aplicar migraciones. Primero se aclara el estado
del worktree y del proyecto remoto. Cualquier migración futura requiere plan,
prueba estructural, entorno de prueba y autorización.

## D-020 — el resumen de una conversación es la respuesta

Fecha: 2026-08-05  
Estado: aceptada, implementada

`summary` significa dos cosas distintas según el trabajo:

- en una **tarea de agente** es un resumen de lo que se hizo, va a Telegram y
  sigue limitado a 4.000 caracteres;
- en una **conversación** es la respuesta completa, y se guarda hasta 120.000
  caracteres.

Motivo demostrado: el mismo tope de 4.000 se aplicaba a las dos. En `LUX-8B8T`
el modelo entregó 7.691 caracteres con `finish_reason: stop` y la llamada
terminó bien; se guardaron 4.000, cortados a mitad de una etiqueta. Parecía que
el proveedor se había quedado a medias y el corte era nuestro, al persistir.

Reglas que van con esto:

- si aun así no cabe, se avisa con un evento y se marca `summaryTruncated`.
  **Nunca se pierde contenido en silencio.**
- la tarjeta de Telegram se recorta al renderizar, no al guardar.
- 120.000 caracteres **no** convierten esto en almacén de documentos. Cuando una
  salida no quepa, la ruta es el artefacto (`D-013`), no subir el número.

## D-018 — señales terminales fuertes y débiles

Fecha: 2026-08-05  
Estado: aceptada, implementada  
Sustituye la parte de `D-011` que trataba todas las señales por igual.

No todas las señales de final valen lo mismo:

- **Fuerte** — `finish_reason`, o el bloque de memoria cerrado en una
  conversación. El protocolo dice que el mensaje terminó. Se espera un margen
  corto (1 s) por si viene el consumo final y se cierra.
- **Débil** — un `usage` sin `choices`. Suele ser el último evento, pero hay
  endpoints que lo mandan a mitad. Exige **15 s de silencio** antes de cerrar, y
  cualquier evento nuevo reinicia la espera.

Motivo: reproducido en `sse.test.ts`. Un `usage` intermedio armaba el cierre y
éste se ejecutaba un segundo después aunque el modelo siguiera escribiendo.

**Corrección del 2026-08-05 12:00:** este mecanismo era real, pero la telemetría
demostró después que **no** fue la causa de los cortes que vio Daniel. En
`LUX-YJT9` y `LUX-8B8T` el transporte terminó con `done_marker`,
`finish_reason: stop` y `abortedBy: null`. El corte visible era el tope de
guardado de 4.000 caracteres (`D-020`). Esta decisión se mantiene como
endurecimiento de un fallo latente con prueba propia, no como explicación de
aquel síntoma.

La regla general: **lo que autoriza a cerrar es el silencio tras la señal, nunca
el reloj mientras llegan datos.**

## D-019 — la memoria no tiene fallback

Fecha: 2026-08-05  
Estado: aceptada, implementada  
Cumple la corrección pendiente de `D-009`.

Sólo un bloque `LUXY_MEMORY` completo, válido, sin código dentro y en una
respuesta con final `completed` sustituye la memoria. En cualquier otro caso el
turno **no aporta memoria** y se conserva la última válida.

Se elimina el resumen de reserva de los primeros 1.200 caracteres: convertía una
página web en memoria y pisaba un contexto correcto con HTML a medias.

Cada turno registra por qué: `structured`, `absent`, `truncated_block`,
`invalid` o `rejected_code`. El detector de código se aplica **también** a un
bloque bien formado, porque el modelo puede meter la respuesta dentro.

## D-016 — un corte con contenido no se reintenta

Fecha: 2026-08-05  
Estado: aceptada, implementada

Si el modelo ya había escrito algo cuando se cortó la conexión, la petición
**no se repite**. Reintentar no recupera nada: tira lo generado, vuelve a pagar
el prompt y empieza de cero. En una generación de veinte minutos eso convierte
una respuesta parcial recuperable en tres pérdidas.

Un corte **sin** contenido sí se reintenta: no hay nada que perder y suele ser
un fallo transitorio del proveedor.

Sustituye al comportamiento anterior, en el que cualquier error sin código HTTP
se consideraba reintentable.

## D-017 — el final detallado viaja en metadata, no en el enum

Fecha: 2026-08-05  
Estado: aceptada, implementada

`completed`, `truncated`, `interrupted`, `timed_out`, `cancelled` y `failed`
viven en `responseOutcome`, dentro del resultado y de la metadata del trabajo.
El enum `luxy_job_status` de Postgres **no se toca**: una respuesta parcial se
guarda con estado `completed` y su motivo real al lado.

Motivo: conservar lo generado no puede depender de una migración, y `D-014`
prohíbe tocar migraciones durante la estabilización. Una salida parcial guardada
como `failed` se perdería entera, que es justo lo que se quiere evitar.

Consecuencia obligatoria: ninguna pantalla puede leer `status: completed` como
«respuesta entera». Studio muestra siempre el `responseOutcome`.

## D-021 — unir fragmentos sólo con evidencia, y avisar cuando no la hay

Fecha: 2026-08-06  
Estado: aceptada, implementada

Una respuesta continuada se une con `joinContinuation`
(`packages/shared/src/continuation.ts`), que decide dónde empieza lo nuevo y
declara siempre con qué estrategia lo decidió: `overlap`, `resynced`, `restart`,
`duplicate` o `appended`.

La regla que gobierna todas: **sin prueba de continuidad no se descarta texto.**
Se pega, se marca `needsReview` y Studio lo dice. Una costura fea se arregla
mirándola; el contenido que se tira no vuelve, y estas respuestas cuestan veinte
minutos de generación.

Consecuencias que van con esto:

- el parcial se le enseña al modelo como **dato no confiable**, en un bloque
  acotado a 1.200 caracteres, nunca como instrucción;
- el enlace entre fragmentos es `continuesJobId` en la metadata del trabajo, no
  una columna: `D-014` prohíbe migraciones y `D-017` ya puso ahí el detalle de
  una respuesta. Es opcional, así que un Studio antiguo sigue funcionando;
- la unión es una **vista**. El `resultSummary` de cada fragmento se queda como
  lo devolvió el proveedor; nadie lo reescribe;
- esto no sustituye a `D-013`: un documento largo sigue necesitando su ruta de
  artefacto. Unir fragmentos no convierte `resultSummary` en almacén.

## D-015 — documentación como memoria compartida

Fecha: 2026-08-04  
Estado: aceptada

Claude y Codex comparten `PROJECT-STATE.md`, `CURRENT-TASK.md`,
`MASTER-PLAN.md`, `CHANGELOG-WORK.md`, `TEST-RESULTS.md` y `LOCAL-ACTIONS.md`.
Cada paso se documenta al cambiar de estado. El chat no sustituye este relevo.

## D-022 — no consultar precios que la pasarela no publica

Fecha: 2026-08-09

Estado: aceptada, implementada

La pasarela confirmó 22 modelos, pero ninguna ruta probada publicó precios
útiles: dos respuestas contenían cero entradas y otra devolvió 404. Por decisión
explícita de Daniel, Luxy consulta únicamente `/v1/models`; no sondea rutas de
precios ni repite «sin precio» en cada modelo.

La ausencia de precio no bloquea un modelo ni autoriza a inventar una cifra. Si
otra conexión futura documenta una API de precios real, será una integración
explícita de esa conexión, no una batería de rutas tentativas.

## D-023 — definir y confirmar una evaluación antes de ejecutarla

Fecha: 2026-08-09

Estado: aceptada, implementada en el contrato; ejecución UI deshabilitada

Preparar o previsualizar una prueba no autoriza a consumir tokens. Un trabajo de
evaluación exige `confirmed: true`, un `apiModel` exacto y un snapshot versionado
de definición, fixture, scoring y modo de validación. El Gateway compara ese
snapshot y el prompt completo con el catálogo actual antes de crear el trabajo.

La ejecución se representa con `studioMode: evaluation` y metadata, sin
migración. El agente la trata como solo lectura: no crea worktree, no concede
herramientas, no escribe memoria y no ejecuta comprobaciones del proyecto. La
metadata nunca incluye una puntuación hasta que un validador real la produzca.
El botón del Laboratorio sigue deshabilitado; conectar el IPC será una decisión
posterior y explícita.

## D-024 — una salida incompleta o no automática no recibe puntuación

Fecha: 2026-08-09

Estado: aceptada, implementada

El Gateway sólo aplica los validadores locales cuando una evaluación confirmó
un `responseOutcome: completed`, conserva un modelo efectivo y su snapshot
sigue coincidiendo con el catálogo. `truncated`, `interrupted`, `timed_out` o un
final antiguo sin evidencia se guardan como `not_scored`, no como fallo del
modelo.

Los modos `manual`, `sandbox` y `trace` también quedan `not_scored` hasta que
exista su revisor o runner real. El resultado conserva checks, duración, tokens
y tamaño de salida, pero no calcula una nota numérica ni un ranking: esos datos
no tienen todavía una fórmula aprobada y convertir un booleano en una nota
aparentemente objetiva sería inventar evidencia.

## D-025 — el historial del Laboratorio se lee bajo demanda

Fecha: 2026-08-09

Estado: aceptada, implementada

Laboratorio lee como máximo los últimos 100 trabajos una vez al abrirse. No usa
el polling de Trabajos ni crea otro temporizador. Sólo el botón **Actualizar**
repite la lectura. La pantalla muestra como máximo 12 resultados recientes y
hace visible el límite de cobertura.

Antes de presentar metadata como evidencia, el renderer valida su esquema y
comprueba que evaluación, versión y modelo coinciden con el trabajo. Una entrada
incompleta o contradictoria se ignora; no se repara ni se infiere.

## D-026 — primera ejecución sólo automática, individual y doblemente confirmada

Fecha: 2026-08-09

Estado: aceptada, implementada

La primera apertura del Laboratorio se limita a rapidez exacta, instrucciones,
JSON y contexto largo, porque son las únicas pruebas con validador puro. Código,
frontend, español y tool calling no pueden ejecutarse hasta disponer del runner
o revisor que declararon desde el catálogo.

Crear el trabajo exige una casilla de posible consumo y un diálogo final que
repite prueba, modelo exacto y máquina. La ausencia de precio se muestra como
desconocida y no provoca consultas (`D-022`). Gateway vuelve a validar prompt,
snapshot y política, y rechaza otra evaluación activa ya visible del mismo
Studio. Esta última barrera reduce duplicados, pero no es un lock transaccional
entre dos peticiones que lleguen exactamente a la vez.

## D-027 — cancelar una evaluación significa sin puntuar

Fecha: 2026-08-09

Estado: aceptada, implementada

Una cancelación iniciada por la persona no demuestra calidad ni falta de calidad
del modelo. Gateway conserva cualquier parcial recuperable, pero el resultado de
Laboratorio queda `not_scored` con `responseOutcome: cancelled`; nunca `failed`.
La regla también se aplica si se canceló antes de recibir texto.

Laboratorio no sondea el cierre. Muestra la solicitud como enviada y sólo cambia
el estado cuando la persona pulsa **Actualizar**. Así se conserva `D-025` y no se
reintroduce tráfico periódico para una operación ocasional.

## D-028 — un fallo operativo tampoco es un suspenso

Fecha: 2026-08-09

Estado: aceptada, implementada

Si proveedor, agente o transporte fallan antes de obtener una respuesta válida,
la evaluación se persiste `not_scored` con `responseOutcome: failed`. Los cortes
por límite, interrupción, timeout y cancelación conservan razones distintas para
no ocultar la causa bajo una etiqueta genérica.

Un trabajo terminal de evaluación que no contiene `evaluationResult` se muestra
como **Sin resultado validado**. Esto cubre Gateways anteriores y la
interrupción provisional/terminal de leases sin mutar el trabajo al leerlo. No
se deriva un resultado ni una puntuación de `job.status`.

## D-029 — tres resultados antes de publicar una tasa

Fecha: 2026-08-09

Estado: aceptada, implementada

La evidencia del Laboratorio se agrupa únicamente cuando coinciden prueba,
versión y modelo exacto. Con menos de tres resultados puntuados se muestra
**Muestra insuficiente** y no se calcula porcentaje. Tres sigue siendo una
muestra pequeña: autoriza descripción, no ranking ni recomendación.

`not_scored` se cuenta para hacer visible cuántas ejecuciones no produjeron
evidencia de calidad, pero se excluye de tasa, mediana de duración y mediana de
tokens. Mezclar cancelaciones o fallos operativos con respuestas puntuadas
distorsionaría las métricas.

## D-030 — una comparación es un par identificado y homogéneo

Fecha: 2026-08-09

Estado: aceptada, contrato implementado; orquestación visual pendiente

Una comparación de evaluación contiene exactamente dos solicitudes, índices 0
y 1, enlazadas por un UUID nuevo. El segundo miembro sólo es comparable si
coinciden evaluación, versión, prompt exacto, máquina y proyecto, y si el modelo
exacto es distinto. No se admiten grupos incompletos de más de dos miembros ni se
reutiliza una ejecución individual como primer miembro implícito.

La barrera del Gateway consulta trabajos activos antes de crear. Esa separación
no es una transacción ni un bloqueo distribuido: dos peticiones concurrentes
podrían observar el mismo estado. Por ahora el Desktop debe enviar el par en
orden y representar una aceptación parcial; si se necesitara exclusión fuerte,
haría falta una primitiva atómica del repositorio o base de datos.

## D-031 — los pares se reconstruyen por identidad, no por proximidad

Fecha: 2026-08-09

Estado: aceptada, implementada

La vista conjunta sólo agrupa trabajos que contienen el mismo UUID de comparación
y los índices explícitos A/B. Fecha, prueba, prompt o modelos parecidos no bastan
para emparejar trabajos independientes. Índices duplicados, pruebas/versiones
mezcladas y miembros ausentes se muestran como problemas del grupo.

La comparación presenta estado y evidencia de cada miembro, pero no elige un
ganador. Un miembro cancelado, interrumpido, fallido o sin resultado validado
permanece visible y no cuenta como derrota del modelo.

## D-032 — recomendar exige dos muestras comparables maduras

Fecha: 2026-08-09

Estado: aceptada, implementada

Laboratorio sólo puede proponer un modelo para una prueba/versión cuando al menos
dos modelos exactos tienen tres resultados puntuados cada uno. Compara primero la
tasa validada. Sólo en pruebas de rapidez usa la mediana de duración como
desempate. Un `not_scored` se muestra, pero no altera esas métricas.

El feedback explícito sólo desempata si hay al menos dos valoraciones de
conversaciones completadas, del mismo proyecto y modelo exacto. No puede superar
una diferencia en evidencia de evaluación. Si todo sigue empatado, Luxy dice
**Sin recomendación**. Elegir la propuesta sólo cambia el selector: no confirma,
ejecuta ni llama al proveedor.

## D-033 — el formulario sólo ofrece runners disponibles

Fecha: 2026-08-09

Estado: aceptada, implementada tras validación manual

El catálogo puede documentar pruebas manuales, sandbox o tool-trace, pero el
selector que crea trabajos sólo enumera definiciones automáticas y habilitadas.
Mostrar una prueba pendiente dentro del mismo selector hace parecer que la
casilla está rota cuando en realidad actúa una barrera de seguridad.

Las definiciones pendientes siguen visibles como fichas, con su requisito real.
No se habilita un runner para resolver un problema de presentación.
