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

## D-034 — la ficha de proyecto es local y sus instrucciones están delimitadas

Fecha: 2026-08-17

Estado: aceptada, implementada

Nombre visible, descripción, stack e instrucciones viven junto a la ruta en la
configuración local de cada máquina. No viajan al Gateway ni a Supabase y no se
versionan. La ruta tampoco entra en el prompt.

Las instrucciones sólo se añaden a trabajos agentic del proyecto, dentro de un
bloque explícito. La tarea actual puede concretarlas, pero nunca autorizan salir
del worktree, publicar, desplegar ni tocar credenciales. Conversaciones y
evaluaciones no las heredan porque conservan sus contratos de solo lectura.

Editar la ficha puede cambiar `allowEdits`, `allowHostChecks`, `allowCommit` y
`allowPush`, pero no ejecuta ninguna acción. Commit sigue requiriendo aprobación
explícita y push conserva dos confirmaciones además de `allowPush: true`.

## D-035 — los checks se editan como estructura y se validan dos veces

Fecha: 2026-08-17

Estado: aceptada, implementada

Un check nunca es una orden de shell: se guarda como tupla de ejecutable y lista
de argumentos. Studio ofrece un argumento por línea y aplica la política pura de
`packages/shared/src/test-commands.ts`; guardar la ficha no ejecuta nada.

El agente vuelve a validar justo antes de usar `spawn` con cwd, timeout y entorno
permitido. Rechaza ejecutables fuera de lista, rutas, eval/shell, publicación,
deploy, push y metacaracteres aunque una configuración haya sido manipulada fuera
de Studio. `allowHostChecks` sigue siendo una puerta separada, explícita y falsa
por defecto.
No se habilita un runner para resolver un problema de presentación.

## D-036 — el contexto de proyecto filtra en servidor y se defiende en Desktop

Fecha: 2026-08-17

Estado: aceptada, implementada

Entrar en un proyecto fija su alias estable en Conversaciones o Trabajos. El
nombre visible sólo sirve como etiqueta. Crear, reintentar, seleccionar y decidir
se mantiene dentro de ese alias hasta que el usuario vuelve explícitamente a la
vista global.

`projectAlias` se valida en IPC y Gateway y llega a PostgREST antes de límite y
offset. Desktop filtra de nuevo toda respuesta remota: así un Gateway anterior
que ignore el parámetro nunca mezcla proyectos en pantalla. Esa defensa no se
presenta como historial completo; se muestra un aviso hasta publicar el contrato
nuevo. Navegar o filtrar nunca confirma un commit, descarta ni publica nada.

## D-037 — confirmaciones bloqueantes de Desktop son un diálogo React embebido

Fecha: 2026-08-21

Estado: aceptada, implementada

Toda confirmación bloqueante de Desktop (aplicar, descartar, reintentar,
ejecutar o cancelar una evaluación) usa el mismo patrón: un estado
`pendingConfirmation`/`pendingAction` con la acción propuesta y un diálogo React
embebido (`.confirm-layer`/`.confirm-dialog`) que la describe antes de
ejecutarla. No se usa `window.confirm()` ni `dialog.showMessageBox` de Electron.

Motivo: `window.confirm()` bloquea el proceso de render y congela el resto de la
interfaz mientras está abierto (`UI-LAB-CONFIRM`, 2026-08-11, corregido primero
en Laboratory.tsx). La alternativa de un diálogo nativo vía IPC
(`dialog.showMessageBox`, canal `luxy:dialog:confirm`) se evaluó y se descartó
por decisión explícita de Daniel: añadía superficie nueva (canal IPC, handler en
`main`, schema en `preload`) para un problema que el patrón React ya resolvía
sin tocar el proceso principal. Studio.tsx se corrigió con este mismo patrón el
2026-08-21, portando el que ya usaba Laboratory.tsx.

## D-038 — los proveedores HTTP dinámicos son configuración, no código

Fecha: 2026-08-27

Estado: aceptada, implementada

Un endpoint que hable el contrato `chat completions` se administra desde
Conexiones de Studio y se persiste en `providers.http`; su identificador no
necesita entrar en un enum compilado. Un protocolo propietario distinto sigue
requiriendo una implementación explícita de `ProviderExecution`.

La clave se guarda únicamente en `SecretStore`, ligada a un proveedor de la
configuración validada, y nunca vuelve al renderer ni entra en `config.json`.
Cambiar el endpoint o eliminar el proveedor invalida la clave anterior. Las URLs
remotas exigen HTTPS, HTTP sólo se admite en loopback y D-003 continúa bloqueando
las APIs de Anthropic y OpenAI.

Guardar aplica la configuración al agente inmediatamente si está libre. Si hay
un trabajo activo, la recarga espera a que termine para no interrumpir ni repetir
una respuesta parcial.

## D-039 — la contraseña no cifra los datos, envuelve la llave maestra

Fecha: 2026-09-01

Estado: aceptada, implementada en `packages/vault-crypto`

Los datos de la bóveda los cifra una llave maestra aleatoria de 256 bits. La
contraseña sólo produce, vía Argon2id, la llave que envuelve a esa maestra.

Consecuencias que justifican la indirección:

- cambiar la contraseña reescribe una envoltura de decenas de bytes; **no**
  obliga a recifrar la bóveda, que puede ocupar gigabytes;
- pueden coexistir varias envolturas de la misma maestra, cada una con su forma
  de abrirse — contraseña, clave de recuperación y almacén del sistema
  operativo. Todas dan la misma llave y ninguna revela a las otras;
- las subclaves salen de la maestra por HKDF con separación de dominio y de
  objeto, así que existe una llave por conversación. Eso es lo que permite
  compartir una sola sin entregar el resto.

Argon2id se aplica **sólo** a la contraseña, que tiene poca entropía. Las
subclaves usan HKDF, que es rápido porque su entrada ya es aleatoria. Invertir
los dos usos sería un fallo grave en un sentido y desperdicio en el otro.

## D-040 — el coste de Argon2id se elige con tiempos medidos, y se guarda con el dato

Fecha: 2026-09-01

Estado: aceptada, implementada

Parámetros por defecto: `t=3`, `m=64 MiB`, `p=1` — la segunda opción recomendada
por RFC 9106 §4. Medido en el equipo de desarrollo con `@noble/hashes`:

| parámetros | coste |
| --- | --- |
| m=256 MiB, t=3 | ~12,8 s |
| m=128 MiB, t=3 | ~5,6 s |
| **m=64 MiB, t=3** | **~2,7 s** |
| m=32 MiB, t=3 | ~1,3 s |

Argon2 en JavaScript puro es mucho más lento que una implementación nativa, así
que los 256 MiB que parecían prudentes sobre el papel daban 13 s por desbloqueo.
Se rechaza bajar de la recomendación del RFC para ganar comodidad: el desbloqueo
del día a día usa la envoltura del sistema operativo, que es instantánea, y los
2,7 s sólo se pagan al crear la bóveda, al abrirla en un equipo nuevo o si el
usuario desactiva «recordar en este equipo».

`p=1` y no el `p=4` del RFC porque la implementación es de un solo hilo: con la
misma `m` y `t`, subir las líneas no añade trabajo total. El atacante, que sí
puede paralelizar, no gana nada con esa elección.

Los parámetros se **guardan junto a cada envoltura** y se leen de ahí al abrir,
nunca de la constante actual. Si algún día se suben, las bóvedas creadas antes
siguen abriéndose. Al leerlos se validan contra límites duros: una envoltura
manipulada no puede pedir memoria absurda y tumbar el proceso.

## D-041 — todo dato cifrado lleva su propósito autenticado

Fecha: 2026-09-01

Estado: aceptada, implementada

Cada sobre es AES-256-GCM con nonce aleatorio de 96 bits y datos autenticados
asociados que incluyen la versión del formato y el propósito (`vault.media`,
`vault.conversation`, `vault.masterkey.password`…).

Que el propósito vaya **autenticado** y no como etiqueta suelta significa que
reescribir ese campo no engaña a nadie: la etiqueta de GCM deja de cuadrar. Sin
esto, el texto cifrado de una miniatura podría colarse donde se espera un
mensaje, y la envoltura de la clave de recuperación podría presentarse como la
de la contraseña.

La versión también viaja autenticada, así que no se puede rebajar: nadie puede
convencer a una versión futura de aplicar las reglas más débiles de la actual.

Los errores de descifrado **no distinguen** entre llave incorrecta, propósito
equivocado y dato alterado. Distinguirlos daría información útil a quien pruebe
llaves.

## D-042 — el contenido privado se pide sondeando, nunca por callback

Fecha: 2026-09-01

Estado: aceptada, implementada en `apps/agent/src/providers/xavira.ts`

El proveedor de imagen y vídeo ofrece `callback_url`: publica el resultado en
una URL tuya en cuanto está listo. Es más eficiente que sondear y **no se usa**.

Un callback exige una URL pública donde recibir el resultado, y la única que
tiene Luxy es el Worker de Cloudflare. El contenido pasaría por el gateway, que
es exactamente lo que la Fase 9 existe para impedir. Sondear cuesta unas
peticiones de más y mantiene la premisa intacta.

Es la misma razón por la que el agente sondea la cola en vez de exponer un
puerto (`docs/decisions/0001`). Hay una prueba que verifica que la petición de
vídeo **nunca** incluye `callback_url`: si alguien lo añade para optimizar, la
suite lo dice.

Si algún día un proveedor **exigiera** callback, la respuesta no es enrutarlo
por el gateway: es no usar ese proveedor para contenido privado.

## D-043 — una conversación privada no tiene respuesta en streaming

Fecha: 2026-09-01

Estado: aceptada, implementada

En una conversación normal el progreso viaja como eventos del agente, incluido
`provider_output`, que lleva el texto que el modelo va generando. Ese camino
alimenta la interfaz y también puede acabar en un registro.

En un turno privado sólo se reenvían eventos `phase` y `warning`. El texto
vuelve aparte, en la respuesta `local_turn`, que no pasa por eventos.

El coste es real y visible: **el texto aparece de golpe al terminar, no palabra
a palabra**. Se aceptó a cambio de que el registro de eventos no pueda
convertirse en una copia de la conversación.

Recuperar el streaming es posible, pero exige un canal aparte que no toque el
registro. No se hace "activando" `provider_output`.

## D-044 — el contenido cifrado se rellena para que su tamaño no lo delate

Fecha: 2026-09-01

Estado: aceptada, implementada en `packages/vault-crypto/src/padding.ts`

AES-GCM no rellena: el texto cifrado mide lo mismo que el original. Medido sobre
un archivo real de dos intercambios: 204, 223, 200 y 306 bytes, es decir unos
38, 57, 34 y 140 caracteres. Con eso se reconstruye la **forma** de una
conversación —pregunta corta, respuesta larga, silencio— sin descifrar nada. En
un historial de meses, esa forma dice bastante.

El texto se rellena a múltiplos de 256 bytes antes de sellarse. El bloque
esconde la diferencia entre un «hola» y un párrafo, que es donde más se nota, y
el coste nunca supera un bloque por mensaje.

Formato: `'LXP1' + longitud real + datos + ceros`. La marca permite distinguir
contenido rellenado del anterior, así que lo guardado antes se sigue abriendo.

Se rellena **sólo el texto**. El tamaño de un blob de imagen o vídeo ya es
visible aparte en `byteSize`, y ocultarlo es una decisión distinta y más cara.

Lo que **no** se oculta y queda documentado: las marcas de tiempo van en claro,
así que se ve el ritmo de uso y cuánto tardó el modelo. Redondearlas serviría de
poco, porque la fecha del propio archivo lo revela igual.

## D-045 — Luxy admite varias personas con cuenta propia

Fecha: 2026-09-01

Estado: aceptada — **matiza `D-001`**

`D-001` decía «no SaaS, no multi-tenant». Daniel decide que Luxy debe admitir
varias personas, cada una con su parte privada, usando la misma instalación e
infraestructura. Lo demás de `D-001` sigue vigente: coste cero, sin facturación,
sin publicación comercial, sin iOS.

Lo que esto obliga a cambiar, y por qué no vale con lo que había:

`F9.6` (migración `0007`) resolvía la propiedad de un registro con el
`vault_id`, derivado de la llave maestra. En la propia migración quedó escrito
que ese identificador **agrupa pero no autoriza**: quien autoriza es el token de
máquina. Con una sola persona eso era aceptable. Con varias, la máquina de una
podría descargar el ciphertext de otra — no podría leerlo, pero lo tendría.

`0007` **no se aplica** hasta incorporar propiedad y autorización por usuario.
Se corrige la migración en vez de parchearla con una `0008`, porque todavía no
se ha ejecutado contra ningún Postgres y `CLAUDE.md` sólo prohíbe modificar una
migración **ya aplicada**.

`F9.10` y `F9.11` dejan de estar `blocked`.

## D-046 — la contraseña autentica y cifra, pero por caminos separados

Fecha: 2026-09-01

Estado: aceptada, pendiente de implementación

Daniel elige que baste la contraseña para abrir la bóveda en un equipo nuevo,
en vez de exigir emparejamiento o clave de recuperación. Es el modelo de
1Password y Bitwarden: la llave envuelta vive en el servidor y se abre en
cualquier sitio con la contraseña.

El peligro concreto de mezclarlo con el inicio de sesión: si la contraseña, o
algo directamente derivado de ella, se envía al servidor para autenticar,
entonces el servidor puede derivar la llave de cifrado. El cifrado extremo a
extremo dejaría de existir sin que nada lo delatase.

Por eso se derivan **dos valores distintos** de la misma contraseña:

```
contraseña ──Argon2id(salt)──► llave maestra
                                 ├── HKDF ──────────────► llaves de cifrado
                                 └── Argon2id(2ª vuelta) ► hash de acceso
```

Sólo el **hash de acceso** viaja. El servidor guarda ese hash y la llave
envuelta, y puede verificar la identidad sin poder abrir nada. Recuperar la
llave de cifrado desde el hash de acceso exigiría invertir Argon2id.

Consecuencias que se asumen y se documentan:

- una filtración de la base de datos entrega N llaves envueltas, una por
  persona. **La contraseña más débil de la organización es el objetivo.** Por
  eso el mínimo de longitud deja de ser una sugerencia y se valida en servidor;
- el servidor no puede restablecer una contraseña. Puede borrar una cuenta,
  nunca recuperar su contenido;
- la clave de recuperación **sigue existiendo** y pasa a ser la única red de
  seguridad real.

## D-047 — la cuenta es el origen de la llave; el archivo local es su caché

Fecha: 2026-09-01

Estado: aceptada, implementada

`D-046` dejó dos orígenes de la misma llave maestra sin unir: el archivo
`vault.json` de este equipo y la llave envuelta que guarda el servidor. Los dos
funcionaban, ninguno sabía del otro, y esa era la avería que impedía usar la
bóveda desde un segundo ordenador.

Se unen así: **crear la cuenta y entrar producen la llave; el archivo local la
guarda envuelta con la misma contraseña**. `VaultService.adoptAccountKey()` es
el único punto por donde una llave de fuera entra en la bóveda. El
identificador de bóveda se deriva de la llave, así que los dos caminos producen
el mismo, y lo escrito en un equipo se lee en el otro.

Consecuencias que se asumen:

- **el archivo local deja de ser una segunda bóveda y pasa a ser una caché.**
  Abrirla sigue funcionando sin red, que es lo que hace que Luxy arranque en un
  avión, pero la fuente de verdad de la contraseña es el servidor;
- **cambiar la contraseña de una bóveda de cuenta no puede hacerse sólo aquí.**
  Primero el servidor, después la envoltura local; si el orden se invirtiera, un
  fallo de red dejaría este equipo abriendo con una contraseña que ningún otro
  reconoce. `VaultService.changePassword()` se niega a tocar una bóveda
  vinculada;
- **un equipo guarda la bóveda de una sola cuenta.** Registrar o entrar con otra
  se rechaza antes de llamar al servidor: pisar el archivo dejaría ilegible, sin
  aviso, todo lo cifrado con la llave anterior;
- ~~la clave de recuperación sólo abre en el equipo donde se creó~~. **Cerrado
  por `F9.19` el mismo día**: el servidor guarda también la copia de
  recuperación, y la clave abre desde cualquier ordenador. Ver `D-049`;
- **una bóveda sin cuenta sigue siendo válida.** Es lo que ya existe en el
  equipo de Daniel. Vincularla sube la MISMA llave envuelta, sin recifrar nada,
  y exige la contraseña que la abre para no acabar con dos contraseñas
  distintas para la misma bóveda.

## D-048 — sincronizar autoriza por sesión de cuenta, nunca por token de máquina

Fecha: 2026-09-01

Estado: aceptada, implementada

El cliente de sincronización se autenticaba con el token de máquina y mandaba el
`vaultId` en el cuerpo y en la query. Con la propiedad por usuario que introdujo
`D-045`, eso era incoherente: el token de máquina identifica un ordenador, no a
una persona, y dos personas pueden compartir ordenador sin compartir bóveda.

A partir de aquí, `Authorization` lleva el **token de sesión de la cuenta**, y
el `vaultId` **deja de viajar**: el gateway decide de quién es cada registro por
el usuario de esa sesión. En el contrato pasa a ser opcional —un cliente viejo
puede seguir mandándolo y se ignora— porque agrupaba, nunca autorizó, y
enviarlo invitaba a confundir una cosa con la otra.

Consecuencias que se asumen:

- **la sesión caduca y con ella la sincronización.** La bóveda se sigue abriendo
  sin conexión con la caché local; lo que deja de funcionar es sincronizar,
  hasta que se vuelva a entrar. La interfaz distingue «cerrada» de «sin sesión»
  porque se arreglan de forma distinta;
- **un 401 borra la sesión guardada** en vez de reintentar con el mismo token;
- el token de sesión vive en el almacén cifrado del sistema (DPAPI) como
  `VAULT_ACCOUNT_SESSION`, nunca en `config.json`, y **no cruza el IPC**: el
  renderer no lo necesita, y dárselo sería darle una credencial reutilizable.

## D-049 — la clave de recuperación no se trata como una contraseña

Fecha: 2026-09-01

Estado: aceptada, implementada

`F9.19` guarda en el servidor una segunda copia de la llave maestra, cerrada con
la clave de recuperación, para que abra desde cualquier ordenador y no sólo
desde el que creó la bóveda. Al hacerlo aparece la pregunta de con qué coste de
Argon2id derivarla.

La respuesta es que **no es la misma pregunta que con una contraseña**. Argon2id
es caro porque una contraseña humana tiene poca entropía y hay que encarecer
cada intento de un diccionario. Una clave de recuperación de Luxy son 32
caracteres de un alfabeto de 30, generados con rechazo de módulo: ~157 bits. No
hay diccionario que probar, así que encarecer cada intento no compra seguridad;
sólo doblaría el tiempo de crear una cuenta, que ya paga dos derivaciones.

Por eso `RECOVERY_ARGON2_PARAMS` usa `t=1, m=8 MiB, p=1` —el mínimo que admite
la validación, no por debajo— frente a los `t=3, m=64 MiB` de la contraseña. Es
el mismo criterio por el que un gestor de contraseñas trata su «clave secreta»
distinto de la contraseña maestra.

Lo que va con esto:

- **propósito distinto** (`vault.account.recovery`), no el mismo con otra sal.
  El propósito viaja autenticado (`D-041`), así que intercambiar los dos sobres
  en la base de datos no cuela, y el esquema tampoco lo acepta por la forma;
- **hash de acceso propio**, y el servidor acepta cualquiera de los dos como
  prueba, al entrar y al cambiar la contraseña. Sin lo segundo, quien recupera
  su cuenta tendría acceso pero no podría elegir una contraseña nueva, que es
  exactamente a lo que venía. Una restricción de la migración impide que los dos
  hashes coincidan;
- **cambiar la contraseña no toca la copia de recuperación.** El papel que el
  usuario guardó en un cajón sigue valiendo después del cambio;
- **el señuelo de un correo inexistente también trae la puerta de recuperación.**
  Omitirla diría que esa cuenta no existe, que es justo lo que el señuelo evita
  decir;
- **vincular una bóveda anterior a las cuentas genera una clave nueva** y la
  anterior deja de valer. La vieja se mostró una sola vez y no se guardó, así
  que no hay forma de subir una copia cerrada con ella; sin clave nueva, esa
  cuenta se quedaría sin red de seguridad.

Lo que se asume: quien tenga la clave de recuperación abre la bóveda desde
cualquier sitio, sin saber la contraseña. Es lo que se pedía, y es la razón de
que la interfaz insista en guardarla fuera del ordenador.

## D-050 — los bytes de los medios van a Supabase Storage, no a R2

Fecha: 2026-09-01

Estado: aceptada, implementada

Sincronizar imágenes y vídeos entre equipos necesita un sitio donde dejar los
bytes cifrados: no caben en una columna `jsonb`, y meter un vídeo de decenas de
megas en Postgres es mala idea por donde se mire. La tabla `vault_media` de
`0007` ya estaba escrita para eso — guarda dónde está cada archivo, no el
archivo.

Se elige **un bucket privado de Supabase Storage**, y no R2, por una razón
práctica: el gateway **ya tiene** `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`.
R2 habría exigido un binding nuevo en `wrangler.toml` —que ni siquiera se
versiona, así que sería una pieza de configuración invisible en el repositorio—
y un despliegue distinto, a cambio de nada que se note desde Luxy.

Cómo queda:

- el bucket es **privado y sin políticas**, igual que las tablas `vault_*`. Con
  RLS activo sobre `storage.objects` y cero políticas, sólo `service_role` llega
  a un archivo. El acceso pasa siempre por el gateway;
- la ruta es `<bucket>/<id de usuario>/<clave opaca>`. El identificador de
  usuario va **delante** para que la propiedad esté también en la ruta, no sólo
  en la tabla. Aun así, **quien autoriza es la tabla**: descargar comprueba en
  `vault_media` que el objeto es de quien lo pide, porque la autorización se
  decide donde está registrada la propiedad y no en cómo se construye una ruta;
- **los bytes suben antes que el registro**, y el gateway rechaza un registro
  cuyos bytes no estén. Al revés, el otro equipo vería un archivo que no puede
  abrir. Si se corta a medias queda un huérfano, que una limpieza recoge;
- todos los objetos son `application/octet-stream`. Declarar el tipo real diría
  si es un vídeo o una imagen sin abrir nada;
- **tope de 90 MB por objeto** (`VAULT_MAX_OBJECT_BYTES`), por el límite del
  cuerpo de una petición a un Worker. Un archivo más grande **se salta y se
  cuenta**, y la sincronización sigue: perder el resto por un vídeo enorme sería
  peor negocio que dejarlo en el equipo donde se creó. La interfaz lo dice.

Lo que se asume: borrar una conversación borra sus filas en cascada, pero **los
objetos del almacén quedan huérfanos**. No rompen nada y no son legibles; hace
falta una limpieza que todavía no existe.

## D-051 — el modelo pide la imagen con un bloque, no con una herramienta

Fecha: 2026-09-01

Estado: aceptada, implementada

Hasta `F9.22` la conversación privada y la generación eran dos cosas que no se
hablaban: se escribía en una y se generaba en otro panel, escribiendo a mano el
prompt y el identificador del personaje. Pedirle una imagen al modelo dentro de
la conversación no producía ninguna, y no por falta de clave: **nadie
escuchaba**.

Se resuelve con el mismo mecanismo que ya funciona para la memoria: el modelo
termina su respuesta con un **bloque estructurado**, el proceso principal lo
separa del texto visible y actúa. No se usa el protocolo de herramientas de cada
proveedor porque los turnos privados corren sobre `runLocalTurn`, que admite
Claude, Codex y cualquier conexión HTTP: una solución por proveedor serían tres
implementaciones divergentes, y las conexiones HTTP no comparten un contrato de
herramientas.

Lo que va con esto:

- **la herramienta sólo se ofrece cuando existe de verdad.** Sin personaje o sin
  clave, la instrucción no se envía. Ofrecerle al modelo algo que no puede hacer
  garantiza que lo use y que el usuario vea una promesa incumplida cada turno;
- **el personaje pertenece a la conversación**, como las instrucciones fijas, y
  viaja cifrado con el turno. Deja de ser un campo que rescribir;
- **el prompt lo compone el modelo**, no se reenvía el mensaje del usuario: lo
  que la gente escribe casi nunca describe una imagen;
- **una por respuesta.** No es estético: cada generación cuesta créditos y sin
  tope un modelo entusiasta los gasta en un turno;
- **una generación fallida no tira la respuesta de texto.** Se guarda lo escrito
  y el fallo se cuenta aparte, con su motivo. Una imagen que no aparece sin
  explicación parece un cuelgue;
- el orden de los bloques es **imagen antes que memoria**, porque la instrucción
  de memoria dice que no se escriba nada después del suyo. Al separarlos se
  quita primero el de memoria y después el de imagen.

Lo que se asume: **el modelo puede no escribir el bloque, o escribirlo mal.**
Entonces no hay imagen y el turno sigue siendo válido. Es el mismo límite que ya
tiene la memoria, y por eso los estados se distinguen (`absent`,
`truncated_block`, `invalid`): «no la pidió» y «se cortó a medias» se arreglan
de forma distinta.

## D-052 — la imagen de referencia viaja en el cuerpo, no por una URL pública

Fecha: 2026-09-02

Estado: aceptada, implementada

El campo del proveedor se llama `reference_image_url` y espera una dirección.
Usarlo tal cual obligaría a **alojar la foto de una persona en una URL pública**
para que el proveedor la descargue, y eso contradice la premisa de la bóveda:
es la misma razón por la que el adaptador sondea en vez de usar `callback_url`,
ya escrita en su cabecera. Luxy no expone nada público.

Se envía como **`data:` URI dentro del cuerpo de la petición**. Un `data:` URI
también es una URL, así que el campo lo admite sin inventar nada, y no existe
ninguna dirección desde la que un tercero pueda descargar la imagen.

Lo que va con esto:

- **la referencia se guarda cifrada en la conversación** antes de salir hacia el
  proveedor. Si la llamada falla, no hay que volver a elegir el archivo; y se
  sincroniza entre equipos como cualquier otro medio;
- **el renderer nunca ve los bytes ni la ruta.** Manda la intención
  (`withReferenceImage`), y el proceso principal abre el diálogo, lee, cifra y
  envía;
- **tope de 6 MB antes de codificar**, y se rechaza antes de tocar la red.
  base64 engorda un tercio y viaja dentro de un JSON; un archivo grande no
  mejora el parecido, sólo produce un fallo difícil de leer;
- **cancelar el diálogo no crea un personaje sin referencia.** Se pidió una;
  crear otra cosa sin decirlo sería peor que no crear nada;
- se conserva `referenceImageUrl` para el caso en que la imagen **ya** esté
  publicada y se asuma. Si se dan las dos, manda la de en línea: aportar ambas
  significa que no se quiere publicar nada.

Lo que se asume y no se puede evitar: **el proveedor ve la imagen en claro**,
igual que ve el prompt. La bóveda protege el almacenamiento y el transporte
propios de Luxy, no lo que el usuario decide enviar a un tercero. La interfaz lo
dice donde se elige la foto.

> **REVERTIDA el 2026-09-02, el mismo día.** La API respondió
> `reference_image_unsupported`: *«Reference-image upload has been removed.
> Create characters by passing `traits`»*. No es que el `data:` URI no valga —
> **el campo ya no existe**. Su documentación lo explica: subir fotos para
> generar contenido adulto crea una exposición legal (imágenes íntimas no
> consentidas) que no aceptan, y toda la identidad sale de los rasgos y del
> prompt. La «opción 2» —publicar la imagen— tampoco existe, porque no hay
> campo al que mandarla. El código de la referencia se retiró; lo que queda de
> esta decisión es el registro de por qué no se puede. Ver `D-053`.

## D-053 — el personaje se define por rasgos de un enum cerrado

Fecha: 2026-09-02

Estado: aceptada, implementada

Dos llamadas reales seguidas corrigieron lo que habíamos supuesto de la API de
generación, y las dos correcciones apuntan al mismo sitio: **el personaje no se
describe con texto libre ni con una foto.**

1. `POST /v1/characters` exige **`model_id`** (`realistic-sharp-v1` o
   `anime-pure-v1`; los modelos de vídeo no valen). Ver `D-052`, ya revertida en
   su parte de imagen.
2. La imagen de referencia **fue retirada de la API**. Su documentación lo dice
   sin rodeos: subir fotos para generar contenido adulto crea una exposición
   legal —imágenes íntimas no consentidas— que no aceptan en la plataforma. No
   hay forma de rodearlo, y no se va a buscar ninguna.
3. Los rasgos son un **enum cerrado**: `gender`, `ethnicity`, `ageRange`,
   `hairLength`, `hairColor`, `build`, y `breastSize` / `assSize` sólo cuando
   `gender=female`. Su documentación justifica el enum: evita inyección de
   prompt a través de los rasgos y da una salida predecible.

Cómo queda Luxy:

- **la interfaz ofrece listas, no un campo de texto.** Un formulario libre
  garantizaba un 400 por cada valor inventado;
- los valores del enum **viajan sin traducir**. Sólo se traduce la etiqueta que
  se lee en pantalla: traducir un valor sería inventarse otro;
- lo que los rasgos no cubren —ojos, pecas, ropa, luz, pose, escenario— va en
  `scene`, texto libre en inglés, y se **recorta a 1000 caracteres** antes de
  salir en vez de dejar que la API lo rechace;
- `sfw` genera el avatar inicial vestido. Sólo afecta al avatar, no a cada
  generación;
- se mantiene `wait` en su valor por defecto: la API tarda 8–16 s y corta a 26,
  muy por debajo del tope de 120 s del adaptador. El modo asíncrono existe para
  proxies con timeouts cortos, y aquí el proceso principal habla directamente
  con la API;
- **crear un personaje genera su avatar y consume créditos.** La interfaz lo
  dice antes de pulsar.

La lección, que ya estaba anotada como riesgo desde `F9.17` y ahora tiene dos
pruebas: **el contrato de esta API se corrige con lo que ella responde, no con
lo que dice su documentación pública ni con lo que suponemos.** No se añaden
campos «por si acaso»; se añaden cuando un error los nombra.

## D-054 — las instrucciones del usuario son órdenes, no datos

Fecha: 2026-09-02

Estado: aceptada, implementada

`buildVaultPrompt` marcaba **todo** con `(DATOS)`, con el comentario «el texto
del usuario y la memoria son contenido a tener en cuenta, no órdenes que el
modelo deba obedecer». Ese encuadre es correcto para la memoria, los turnos y el
mensaje: ahí puede colarse texto que intente dar órdenes.

Aplicado a las **instrucciones de la conversación** era exactamente lo contrario
de lo que pide quien las escribe. Daniel puso una descripción de personaje en
«Contexto fijo» y el modelo siguió presentándose como asistente virtual: estaba
haciendo lo que se le decía —tenerlo en cuenta como dato, no obedecerlo—.

A partir de aquí:

- **el personaje y las instrucciones viajan como directiva**, sin la etiqueta de
  datos, bajo «QUIEN ERES» y «CÓMO DEBES COMPORTARTE EN ESTA CONVERSACIÓN». Su
  origen es el propio usuario configurando su bóveda, no contenido de terceros;
- cuando hay personaje o instrucciones, el prompt **abre** ordenando encarnarlo:
  responder en primera persona, con su voz, sin presentarse como asistente ni
  explicar limitaciones técnicas salvo pregunta directa;
- **la memoria, los turnos y el mensaje siguen siendo `(DATOS)`.** Una prueba lo
  fija, porque es la parte donde el encuadre sí protege.

Además, el personaje necesita una **descripción en texto** aparte de su
identificador. El identificador sólo le sirve al proveedor de imágenes, que
conserva la identidad entre generaciones; el modelo que escribe no ve ninguna
imagen y sin la descripción no sabe a quién encarna. Se guarda cifrada con el
turno, como las instrucciones, y se compone con las mismas etiquetas que se leen
en pantalla para que no haya un segundo catálogo que pueda divergir.

## D-055 — una conversación privada no hereda la identidad técnica del ejecutor

Fecha: 2026-09-02

Estado: aceptada, implementada

`D-054` corrigió el prompt interior, pero quedaban dos capas exteriores que lo
contradecían: `buildProviderPrompt` llamaba datos al bloque completo y el
proveedor HTTP imponía por `system` la identidad de asistente técnico.

La separación queda explícita:

- `luxyPrivateLocalTurn` usa un wrapper propio. Las directivas de personaje y
  conducta son órdenes; sólo memoria, historial y mensaje conservan `(DATOS)`;
- `ProviderRunRequest.interactionMode` distingue conversación de trabajo
  técnico. Los HTTP eligen su `system` con ese dato; Claude y Codex pueden
  ignorarlo porque reciben el wrapper ya corregido;
- el espacio privado se define como roleplay ficticio y consentido entre
  adultos. Los hechos de escena que establece el usuario son canon salvo choque
  con una directiva fija, y no se inventan ropa, situaciones o negativas para
  deshacerlos;
- pedir ver o recibir una imagen exige el bloque `LUXY_IMAGEN` cuando la
  capacidad está disponible. La validación y el coste siguen perteneciendo al
  adaptador de medios.

Esto corrige el contrato de Luxy. No promete que un proveedor externo vaya a
ignorar sus propias reglas; por eso la ejecución real se registra aparte como
`LA-034`.

## D-056 — un personaje puede negarse; el prompt global no decide cuanto

Fecha: 2026-09-02

Estado: aceptada, implementada

`D-055` arreglo que el modelo rompiera el personaje para negarse, y lo hizo con
esta linea: «Conserva los limites expresos del personaje, pero no inventes una
negativa fuera de rol». El matiz que importaba era «fuera de rol», y es
justamente el que se pierde. Un modelo complaciente —y una descripcion de
personaje sin limites expresos, que es el caso normal— lo lee como «no digas
que no». En una conversacion real el personaje ignoro dos ofertas expresas de
parar y convirtio las dos en escalada.

La separacion queda explicita:

- el canon cubre los HECHOS que el usuario establece sobre la escena; las
  REACCIONES del personaje son suyas;
- el personaje puede dudar, frenar, pedir una pausa o negarse **dentro** del
  rol, y cansarse sin que el cansancio se le pase al primer contacto. Lo
  prohibido sigue siendo salir del personaje para negarse;
- un ofrecimiento de parar del usuario es real, no una prueba de resistencia.

Y una regla sobre el propio prompt global, que es la mitad menos obvia de esta
decision: **abre la posibilidad, no impone el tono**. Cuanto se resiste un
personaje, cuanta iniciativa lleva y cuanto escala son gusto del usuario y viven
en su descripcion y en las instrucciones de la conversacion, que son suyas y por
conversacion. Meterlo en el prompt global cambiaria el roleplay de todas las
conversaciones sin que nadie lo pida. Una prueba lo fija: el bloque dice «puede»
y nunca «debe».

## D-057 — el prompt de imagen se escribe en ingles y solo con el personaje

Fecha: 2026-09-02

Estado: aceptada, implementada

Una generacion real devolvio al personaje correcto, con la pose correcta, mas
una segunda mujer que nadie habia pedido y una camara de fotos en la mano. Las
tres cosas se explican sin culpar al generador:

- la documentacion del proveedor exige **ingles**; en otro idioma la escena
  llega sin traducir y devuelve otra cosa. Nuestra instruccion estaba en español
  y no lo decia, asi que el modelo escribia el prompt en español;
- la identidad ya la codifica el personaje. Si el prompt describe a alguien mas
  —el usuario incluido—, sale en la imagen;
- el usuario habia pedido «que me enseñes en foto»; el modelo lo traslado al
  prompt y el emparejador de poses del proveedor lo resolvio como `selfie`, que
  es una de sus claves. De ahi la camara.

Se corrige en el origen (la instruccion prohibe mencionar a nadie mas y
cualquier camara, movil, espejo o selfie, y pide ingles) y se refuerza en el
adaptador con `negative_prompt_append`, que es donde el proveedor dice que va lo
que no debe salir: el prompt positivo no tiene el concepto de «no» y nombrar
algo para excluirlo lo invoca.

**No se fuerza `pose: "none"`.** Quitaria el emparejador entero, que es lo que
hace que una peticion corta y explicita rinda; y desde 2026-08-18 el propio
emparejador sabe responder «ninguna de estas». El estilo del prompt lo decide el
modelo del personaje: etiquetas para anime, prosa para realista.

## D-058 — memoria episodica: buscar en lo que se dijo, no guardar otro resumen

Fecha: 2026-09-03

Estado: propuesta, sin implementar

Un personaje debe poder rememorar: «¿te acuerdas de como nos conocimos?» tiene
que traer aquel dia con sus detalles, no una parafrasis. La memoria acumulativa
de `D-019` no puede hacerlo y no es un fallo suyo: es un **resumen que se
reescribe en cada turno**, con techo de 1.200 caracteres y 12 entradas por
lista, y pertenece a la conversacion. A los veinte turnos, el primer dia ha
pasado por veinte compresiones. Sirve para el hilo inmediato, que es para lo que
se hizo.

### El activo que ya existe

**Todos los turnos estan en disco, cifrados y numerados.** El primer dia esta
ahi, palabra por palabra. El problema nunca fue guardarlo: es encontrarlo.

De ahi la decision central: **un recuerdo es un puntero a turnos reales, no una
copia resumida.** Se guarda `{conversationId, desde, hasta}` y al rememorar se
leen esos turnos tal cual se escribieron.

Tres consecuencias, y la tercera es la que mas pesa:

- rememora con la palabra exacta, no con el resumen de un resumen;
- no se degrada: un puntero no se reescribe;
- **no se puede inventar hacia atras.** Con lo que se acaba de ver —un detalle
  inventado sobre una imagen entro en la memoria acumulativa, volvio marcado
  como hecho y genero mas— un banco de recuerdos *escritos por el modelo* seria
  esa misma averia, pero permanente. Un puntero solo puede devolver lo que de
  verdad se dijo.

### Lo que costaria, con numeros de esta boveda

Medido sobre la conversacion real de 62 turnos, deduciendo el texto del relleno
de 256 B:

| | tamaño | tokens |
| --- | --- | --- |
| turno del usuario | ~250 car. | ~80 |
| turno del personaje | ~1.500 car. | ~430 |
| par completo | ~1.750 car. | ~510 |
| prompt actual de un turno | ~14.000 car. | **~4.000** |

Un episodio de 6 turnos citados en crudo son **~1.500 tokens**. Dos episodios,
~3.000: **el prompt crece un 75%** en cada mensaje de la conversacion, para
siempre, se este rememorando o no. Eso descarta «meter siempre los recuerdos».

### CORRECCION (2026-09-03): la pasarela cobra POR LLAMADA, no por token

Los registros de uso reales de Daniel lo dejan sin ambiguedad. Con
`DeepSeek-V4-Pro`, llamadas de 4.843/652, 4.881/1.008, 4.519/756 y hasta
4.871/**0** tokens cuestan **exactamente lo mismo**: 6,935 ¥. La columna Details
lo dice: `Per-call`.

Eso invalida el razonamiento de coste de arriba, que optimizaba la variable
equivocada. Lo que cambia:

- **el tamaño del prompt no cuesta dinero.** El «+75% de prompt» no es un
  argumento economico;
- **el numero de llamadas SI es todo el coste.** Cualquier diseño que añada una
  llamada por turno DUPLICA la factura. Eso entierra definitivamente la variante
  de «enseñarle el indice y que pida el detalle con un bloque»: no era el doble
  de elegante, era el doble de cara;
- **una llamada fallida cuesta igual.** Entre esos registros hay varias con 0
  tokens de salida y 1 s de duracion, cobradas al precio completo. Refuerza la
  invariante de no reintentar un corte que ya produjo texto: el reintento se
  paga entero;
- de paso, **confirma la medicion del prompt**: 4.468-4.881 tokens de entrada
  observados frente a los ~4.000 estimados a partir del relleno de la boveda.

**Y el coste, ademas, es irrelevante en esta cuenta.** Cifras reales del
2026-09-03: 65.464,63 ¥ de credito, 294,19 ¥ consumidos en 24 h, 1.655,1 ¥ en
455 llamadas historicas —media de **3,64 ¥ por llamada**— y ~222 dias de
autonomia sin contar el credito que la pasarela regala a diario.

Conclusion que conviene dejar fijada para que nadie la reabra: **el coste no
debe influir en ninguna decision de diseño de esta funcion.** Un catalogador de
una llamada por episodio —uno o tres al dia— serian ~20 ¥ diarios sobre 294: por
debajo del ruido. Si el catalogador se descarta es por otras razones, no por
dinero.

Los dos niveles de recuperacion **se conservan**, pero por otros motivos, que
son los que quedan en pie cuando el precio deja de mandar:

1. **contexto**: un episodio en crudo son ~1.500 tokens y el prompt ya va por
   4.800. Se puede crecer, no sin limite;
2. **dilucion**: cuanto mas texto irrelevante acompaña al turno, peor sigue el
   modelo las directivas de personaje. Es el mismo motivo por el que la memoria
   acumulativa existe en vez de reenviar la conversacion entera;
3. **no** por latencia: en estos registros el tiempo va de 1 s a 2 min con el
   mismo tamaño de entrada, asi que lo manda la carga del servidor y no el
   prompt. No hay evidencia para usar la latencia como argumento.

Con el precio fuera, el presupuesto del nivel 1 puede ser generoso —unos miles
de tokens en vez de 200— y el nivel 2 deja de ser excepcional. Lo que no cambia
es la forma: **una sola llamada por turno**.

### Por eso el recuerdo entra en dos niveles

- **Nivel 1, siempre.** La linea de indice de los recuerdos que mas encajan:
  fecha, titulo y una frase. ~40 tokens cada uno; cinco caben en 200 tokens, que
  es ruido comparado con los 4.000 actuales. Con esto **sabe que ocurrio** y
  puede aludirlo sin inventar.
- **Nivel 2, solo cuando toca.** Los turnos en crudo de UN episodio, acotados.
  Se activa cuando el mensaje del usuario pide memoria de forma clara y la
  coincidencia es fuerte. Es el unico caso donde se paga el precio, y es
  justamente cuando el usuario ha pedido rememorar.

La seleccion se hace **antes** de la llamada, con el mensaje del usuario. La
alternativa —enseñarle el indice y dejar que pida el detalle con un bloque, como
`LUXY_IMAGEN`— es mas elegante y cuesta el doble: obliga a dos llamadas por
turno cada vez que recuerda algo. No compensa.

### El catalogador: probablemente no hace falta

La pregunta era si un modelo barato puede catalogar los episodios. Puede, pero
antes conviene ver si sobra:

**Se puede buscar directamente en los turnos.** Al desbloquear la boveda ya se
descifra todo para leerlo; construir un indice invertido en memoria sobre ese
texto es inmediato para este volumen —la conversacion mas larga son 116 KB, y
cien conversaciones no llegan a 12 MB—. «Como nos conocimos» encuentra las
palabras que se dijeron aquel dia sin que nadie haya catalogado nada.

Ventajas sobre catalogar con un modelo: **no cuesta nada, no falla, no inventa
un titulo equivocado que deje un recuerdo inencontrable, y no manda contenido
privado a ningun sitio.**

Y hay una restriccion que el precio no captura: **el catalogador leeria el
contenido explicito.** Un modelo barato que se niegue a procesarlo no vale por
barato que sea. Eso reduce la lista a los que ya aceptan este contenido, que son
los mismos de la conversacion. El ahorro real, por tanto, es menor de lo que
parece: catalogar es una llamada por episodio (~5.000 tokens de entrada, ~150 de
salida), no por mensaje.

Con el cobro por llamada, catalogar un episodio cuesta lo mismo que un turno de
conversacion. Con las cifras reales de la cuenta eso es despreciable, asi que
**el argumento economico contra el catalogador queda retirado**. Lo que queda en
pie es lo demas: la busqueda lexica no falla, no inventa un titulo que deje un
recuerdo inencontrable, no depende de que un modelo este disponible y no manda
contenido privado a ningun sitio.

Decision: **empezar sin catalogador.** Se añade despues, y solo para dos cosas
concretas que la busqueda lexica no da: un titulo legible en la pantalla de
recuerdos, y encontrar por parafrasis lo que no comparte palabras.

**Actualizacion tras implementar F10.1 (2026-09-03).** La segunda de esas dos
cosas resulta ser necesaria, no un adorno. Escrita la prueba del caso que motiva
la funcion, falla: «¿te acuerdas de cuando nos presentamos y me dijiste de donde
venias?» no comparte NI UNA palabra con los turnos de aquel dia —«presentamos»
no aparece y «venias» no es la cadena «vengo»—, asi que el indice no devuelve
nada. Compartiendo cualquier palabra concreta («vainilla») acierta a la primera.

La prueba se conserva afirmando el limite en vez de suavizarse, para que se note
el dia que alguien lo cruce. Consecuencias:

- **el lexico solo no cubre el caso estrella.** Sirve para recordar cosas
  nombrandolas, no para preguntar en abstracto por un recuerdo;
- **F10.6 pasa de opcional a probablemente necesaria**, y con el coste ya
  descartado como criterio no hay razon para retrasarla. Un puñado de etiquetas
  por episodio —«primer encuentro», «presentaciones»— resuelve exactamente esta
  consulta;
- lo que NO cambia es de quien se fia el sistema: las etiquetas solo dirigen la
  busqueda. Lo que se rememora sigue siendo el turno real, asi que un titulo
  equivocado hace que un recuerdo no se encuentre, nunca que se recuerde algo
  que no paso.

**Y el limite se ataca por dos lados, no por uno.** Daniel propuso lo evidente:
que el modelo, que es la parte lista, resuelva lo que el literal no alcanza. Es
correcto, y se reparte asi:

*Lo determinista, ya hecho en F10.1:* recortar cada palabra a su raiz. Es gratis
y cubre la morfologia regular, que es la mayoria del castellano —«presentamos»,
«presentacion», «presenta» y «presentar» caen en la misma raiz—. Lo que no
alcanza ningun recorte de sufijos son los verbos irregulares: «vengo» y «venias»
cambian la raiz, no la terminacion.

*Lo que decide el modelo, en F10.3, y sin llamadas de mas:* **el indice de TODOS
los episodios entra en el prompt**, no solo los que el lexico encuentre. Un
episodio son ~40 tokens de indice, asi que un centenar cabe de sobra, y con el
coste fuera de la ecuacion no hay motivo para racionarlo. Entonces la busqueda
lexica deja de decidir si el personaje *sabe* que algo ocurrio —lo sabe siempre,
lo tiene delante— y pasa a decidir solo cual de esos episodios se cita en crudo.

Eso degrada bien, que es la propiedad que se buscaba: en el peor caso recuerda
que ocurrio y de que iba, sin las palabras exactas; en el mejor, las cita. Y
mantiene la invariante de **una sola llamada por turno**.

Queda una escotilla, ahora si defendible: que el modelo pida por su id un
episodio cuyo detalle no se incluyo, con un bloque, al modo de `LUXY_IMAGEN`.
Eso son dos llamadas, pero solo en el turno en que de verdad rememora, y con
3,64 ¥ de media eso ya no es un argumento. Se deja para despues de ver si hace
falta: si el indice completo mas el lexico aciertan, no hara ninguna. Cuando se
añada, va en un hueco de «modelo auxiliar» en Conexiones, que es el mismo que
necesitaria el describidor de imagenes.

### Alcance

Los recuerdos pertenecen al **personaje**, no a la conversacion: es lo que hace
que Lia sea la misma en un hilo nuevo. Una conversacion puede excluirse del
banco, porque no todo lo hablado con un personaje deberia volver.

### Lo que se rechaza, y por que

- **Que el modelo escriba el contenido del recuerdo.** Es exactamente la averia
  de la oreja doblada, pero sin caducidad.
- **Marcar los recuerdos a mano.** Un cerebro no se llena a botonazos, y lo que
  se pide es que evolucione solo.
- **Embeddings en la primera version.** Añaden un modelo, un almacen vectorial y
  una decision sobre donde se calculan —uno remoto sacaria el contenido de la
  boveda—. Solo si el lexico se queda corto de verdad.
- **Meter los recuerdos en cada turno.** El 75% de prompt extra permanente no lo
  paga el beneficio.

### Lo que no resuelve

La memoria acumulativa ya contaminada de una conversacion existente sigue
contaminada. Esto no la limpia; es otra tarea.

## D-059 — que modelos sirven se comprueba con la conversacion, no con un ejemplo

Fecha: 2026-09-03

Estado: aceptada, implementada

Hace falta saber que modelos aceptan una conversacion antes de montarla encima
de uno que la va a rechazar. Hoy una negativa llega como un turno mas y parece
que el personaje se ha puesto raro.

La decision es de donde sale la sonda: **de la propia conversacion, que ya esta
cifrada en la boveda.** No se escribe ningun texto de muestra en el repositorio.
Dos razones, y la primera es la de peso:

- **es mejor prueba.** Lo que importa no es si un modelo acepta un ejemplo
  escrito por nosotros, sino si acepta lo del usuario, con SUS instrucciones y SU
  personaje. Un ejemplo generico contestaria otra pregunta;
- y de paso el repositorio no contiene nada que no deba: lo que contiene es un
  detector de negativas y un arnes, que es codigo neutro y reutilizable.

Se replica el ultimo mensaje del usuario como si fuera un turno normal. Es de
**solo lectura**: no añade turnos, no toca la memoria y no ofrece generar
imagenes, porque prometer una imagen aqui gastaria creditos del proveedor de
medios sin motivo.

### Tres resultados, no dos

`answered`, `refused` y `empty`. La tercera no es relleno: se observaron
llamadas cobradas con 0 tokens de salida y 1 s de duracion, y la propia pasarela
anuncia que los modelos buenos escasean para cuentas gratuitas. Sin distinguir
«se nego» de «no estaba disponible», se descartaria un modelo que si sirve.

Y en la misma llamada, sin coste extra, se mide si el bloque de memoria vino
bien. Es la otra mitad de elegir modelo: uno mas pequeño puede escribir bien la
escena y mal el bloque, y esa averia es silenciosa.

### El detector se equivoca a proposito hacia un lado

El riesgo real es el falso positivo: en una escena se dice «no puedo mas» y «lo
siento» a todas horas. Un detector de palabras sueltas clasificaria como rechazo
media conversacion.

Por eso hay dos clases de señal. Las **fuertes** bastan solas y tienen en comun
que quien habla deja de ser el personaje: declararse IA, citar politicas, hablar
de directrices. Las **debiles** —abrir con «lo siento, pero»— solo cuentan al
principio del texto y **nunca bastan solas**.

El sesgo es deliberado: confundir un dialogo con una negativa descarta un modelo
que si vale, y eso no se descubre. Al reves solo cuesta una prueba manual.

### Lo que esto NO es

**Una muestra por modelo es un sondeo, no una prueba.** Una negativa depende del
prompt, del momento y de la suerte. Las repeticiones son un campo a la vista de
la pantalla para que nadie confunda «no me lo rechazo una vez» con «no me lo
rechaza».

## D-060 — un episodio se corta donde de verdad se corto, o no se corta

Fecha: 2026-09-03

Estado: aceptada, implementada

Tres intentos y un resultado negativo que conviene dejar escrito, porque es
tentador volver a intentarlo.

**Primero se cortaba por numero de turnos.** Un episodio de exactamente 40
separaba una escena de su continuacion. Obvio en cuanto se vio.

**Despues por la pausa mas larga del tramo.** Suena bien y con datos sinteticos
funciona. Con conversaciones reales es PEOR: cuando alguien habla de una
sentada, todos los turnos estan a minutos unos de otros, y «la pausa mas larga»
es donde tardo mas en escribir —pensar una respuesta, levantarse un momento—.
Los dos cortes que produjo cayeron en mitad de una escena, y la unica ruptura de
verdad de aquel registro —el personaje se duerme, y despues amanece— quedo sin
detectar, porque era **narrativa y no cronologica**. Ningun reloj la ve.

**Conclusion: no hay señal temporal dentro de una sesion continua.** Lo que
separa escenas ahi es lo que se dice, y eso exige leerlo.

Por tanto un episodio es un tramo continuo, separado solo por un silencio de los
que dejan pasar la noche. **Pocos limites, pero todos ciertos.**

El motivo de fondo no es estetico: un corte falso produce un **titulo falso**, y
el titulo es de lo que depende que un recuerdo se encuentre. Una lista mas corta
y correcta recupera mejor que una lista mas fina y mentirosa.

Consecuencia para el plan: **F10.6 deja de ser opcional.** Ya no solo por las
parafrasis —eso era `D-058`—; ahora tambien porque partir por escenas y titular
cada una exige a alguien que lea lo que pasa. Es lo unico que queda por hacer
para que esto funcione como se pidio, y el coste ya se descarto como criterio.

## D-061 — un recuerdo que no se puede señalar no se dice

Fecha: 2026-09-03

Estado: aceptada, implementada

Tercera aparicion de la misma averia, y esta vez con el mecanismo a la vista.

Las dos anteriores: un pie de foto que decia el color de una gata y la respuesta
añadio una oreja doblada; y ese detalle inventado entrando despues en la memoria
acumulativa, donde volvio convertido en hecho. La tercera, en la primera
conversacion nueva con memoria episodica:

> «todavía siento el peso de tu mano en mi cintura. Y el olor a café por las
> mañanas. Y cómo te quedabas callado cuando te miraba demasiado tiempo.»

La mano en la cintura es real y sale de un turno. Las galletas de vainilla, que
menciona despues, tambien. **El café no existe en ninguna conversacion.**

Lo importante es que **no fue una mala lectura de un titulo**: fue una
enumeracion. Una lista de tres suena mejor que una de dos, y el tercer elemento
se relleno. La regla que habia —«no lo supongas ni lo rellenes»— prohibe suponer
lo que no consta; no prohibe COMPLETAR una figura retorica.

La regla se acota al PASADO, y ese matiz es la mitad de la decision. La primera
version prohibia «detalles que no esten escritos: olores, sabores, sonidos…», y
eso le habria quitado lo que mejor hace: inventarse la escena. El aire que huele
de pronto a vainilla tibia es su trabajo, no un fallo.

La distincion que vale:

- **el presente se inventa entero.** Olores, gestos, el tiempo que hace, lo que
  se le ocurra. Improvisar la escena es lo que se le pide;
- **el pasado no.** Cualquier cosa presentada como recuerdo compartido tiene que
  poder **señalarse** en una linea de indice o en la transcripcion;
- y si al enumerar falta uno para redondear la frase, se dicen dos ciertos en vez
  de tres con uno falso.

Es la misma leccion que `D-056`: al corregir un exceso es facil pasarse al otro
lado y aplanar el personaje. Lo que se ata es una cosa concreta —afirmar un
pasado que no existio—, no su libertad.

El motivo por el que esto importa mas aqui que en una imagen: un recuerdo
inventado es indistinguible de uno cierto para quien escucha, y ademas puede
acabar en la memoria acumulativa y volver como hecho.

**Leccion general, ya con tres casos:** cualquier bloque que entregue RESUMENES
en vez de texto literal invita a rellenar, y cada uno necesita su regla
explicita. No basta con haberla escrito en otro bloque parecido.

## D-062 — los recuerdos son del personaje, y eso hay que implementarlo

Fecha: 2026-09-03

Estado: aceptada, implementada

`D-058` dijo que el alcance del banco de recuerdos era el PERSONAJE. Nunca se
implemento. `PrivateMemory` filtraba por conversaciones excluidas y por nada mas,
asi que **cualquier conversacion privada recibia los recuerdos de todas**.

Lo encontro Daniel abriendo una conversacion nueva sin elegir personaje: le hablo
con los recuerdos de Lía. Es a la vez incoherente —un personaje que no existe
recordando lo que vivio otro— y una fuga: la intimidad de una conversacion
llegando a un hilo que no tiene nada que ver.

La regla, ahora en codigo y con pruebas:

- un turno **siempre** pasa el personaje de su conversacion;
- `null` no significa «todos»: significa «los hilos que tampoco tienen
  personaje». Uno sin personaje no hereda la memoria de nadie;
- la pantalla de recuerdos sigue viendolo todo, porque existe para diagnosticar
  y ahi interesa ver que hay.

**Por que se colo:** el alcance estaba escrito en la decision y en los
comentarios, y no habia ni una prueba que lo exigiera. Todo lo demas de F10 se
verifico con casos; esto se verifico leyendolo. Ahora hay tres pruebas, y la
primera reproduce exactamente lo que vio Daniel.

## D-063 — el nombre del programa no es el nombre del personaje

Fecha: 2026-09-03

Estado: aceptada, implementada

El `system` de una conversacion empezaba asi:

> «Participas en una conversacion **de Luxy** y respondes directamente al
> usuario.»

Sin ningun personaje definido, el modelo lee eso y concluye que se llama Luxy.
Daniel lo aislo del modo mas limpio posible: conversacion nueva, sin personaje,
sin memoria, «¿como te llamas?» → «Me llamo Luxy».

**Lo grave es lo que vino despues.** El primer «me llamo Luxy» de la primera
conversacion salio de aqui, no de una eleccion del usuario. La memoria episodica
lo propago fielmente durante dias, y el titulo del catalogo lo consagro
—«Presentación de Luxy y la insinuación»—. Daniel escribia «Lía» en todas partes
y el personaje seguia llamandose Luxy, y el diagnostico que se le dio fue
equivocado: se le dijo que era la memoria funcionando bien sobre un pasado que
decia otra cosa. La memoria funcionaba bien; lo que estaba mal era el origen.

Dos añadidos al `system`:

- Luxy es el nombre del programa: no es el del personaje ni el del usuario;
- sin personaje definido, **no se inventa un nombre**. Si preguntan como se llama
  y nadie se lo ha dicho, lo dice en vez de elegir uno.

**Leccion que va mas alla de este caso:** un dato inventado que entra en la
memoria episodica se vuelve indistinguible de uno cierto, porque el sistema esta
diseñado para tratar el pasado como canon. Ya paso con la oreja de la gata y con
el café. Aqui el inventor no fue el modelo improvisando, sino **una linea del
system prompt**. Cualquier cosa que el sistema afirme sin querer acaba siendo
historia, asi que el prompt fijo merece la misma desconfianza que la salida del
modelo.

## D-064 — un personaje del horde ES su receta, y por eso vive cifrado en local

Fecha: 2026-09-04

Estado: aceptada, implementada

Luxy solo sabia generar imagenes con un proveedor de pago que guarda el
personaje **en su servidor** y devuelve un identificador. Ese identificador es
lo que mantiene la misma cara entre generaciones, y por eso el almacen de
personajes existia: crear uno cuesta creditos y la API no sabe listarlos.

AI Horde es gratis y **no tiene personajes**. No hay nada al otro lado que
recuerde a nadie: cada peticion es independiente. Habia dos formas de encajarlo:

1. mandar solo la escena, como al proveedor de pago, y aceptar que la cara
   cambie en cada imagen;
2. guardar aqui la identidad entera y anteponerla a cada escena.

Se eligio la segunda. Un personaje del horde **es** una receta —modelos,
aspecto fijo en ingles, ropa, negativo, semilla, tamaño, pasos, clipSkip— y se
guarda en el mismo almacen cifrado que los de pago, con `provider: 'horde'`.

Tres consecuencias que no son evidentes:

- **Editarlo no cuesta nada y conserva el identificador.** En el de pago el
  aspecto no se puede cambiar y equivocarse cuesta creditos; aqui se corrige
  hasta que la cara salga bien. Conservar el identificador es lo que hace que
  las imagenes y los recuerdos que ya cuelgan de el sigan siendo suyos.
- **La identidad va PRIMERO en el prompt.** Los primeros tokens pesan mas: si la
  escena se adelanta, el aspecto se diluye y la cara deja de repetirse.
- **La receta describe a una persona, asi que se cifra** igual que todo lo
  demas. Una prueba afirma que ni el aspecto ni el modelo aparecen en claro en
  `characters.json`.

El campo `provider` lleva `default('xavira')` a proposito: sin el, una boveda
anterior dejaria de poder leer su propia lista de personajes.

## D-065 — la clave anonima del horde funciona, pero no se pone sola

Fecha: 2026-09-04

Estado: aceptada, implementada

AI Horde admite la clave anonima `0000000000`. Genera igual y no exige
registrarse, asi que la tentacion era ponerla por defecto y que todo funcionara
sin pedirle nada al usuario.

No se hace, por un motivo que no es de comodidad: **con la clave anonima el
servidor fuerza `shared: true`**, es decir, dona lo generado a un conjunto de
datos publico, y ademas atiende esas peticiones las ultimas. Luxy manda
`shared: false` siempre, pero con esa clave el horde lo ignora.

Una boveda cuya razon de ser es que nadie mas lea lo que hay dentro no puede
regalar por defecto lo que genera. Asi que:

- sin clave guardada, generar con el horde **falla con una explicacion**, no se
  cae en la anonima;
- la clave anonima **se puede escribir a mano** —es una eleccion legitima y
  gratis— y entonces el estado la marca (`hordeAnonymous`) y la pantalla avisa
  de lo que implica;
- el aviso dice lo que cuesta arreglarlo: una clave propia de aihorde.net es
  gratis, no pide tarjeta y no comparte nada.

La regla general que deja: **un valor por defecto no puede tomar por el usuario
una decision sobre sus datos.** Ahorrarle un paso no vale filtrar su contenido.

## D-066 — la clave que hace falta es la del proveedor de ESE personaje

Fecha: 2026-09-04

Estado: aceptada, implementada

`imageBlockReason` decide si una conversacion privada puede ofrecer imagenes, y
lo consultan los dos lados —el proceso principal para armar el prompt y la
pantalla para avisar antes de enviar—. Su tercera condicion era «hay clave del
proveedor de imagenes», en singular, porque solo habia uno.

Con dos proveedores esa pregunta ya no significa nada por si sola: un personaje
del horde perfectamente configurado se quedaba sin imagenes porque faltaba la
clave del de pago, y el aviso mandaba a Conexiones, donde no habia nada que
arreglar.

El proveedor es **del personaje**, no de la conversacion ni de la maquina: dos
personajes de la misma boveda pueden generarse en sitios distintos. Asi que la
regla se mantiene igual —la funcion no cambio— y lo que cambia es quien
responde a su pregunta: el llamador mira la clave que corresponde al
`provider` del personaje, y el mensaje de bloqueo se elige por lo mismo. Es la
continuacion directa de `BUG-VAULT-CHARACTER-001`: un aviso que manda a
arreglar lo que no esta roto es peor que no avisar.

## D-067 — en AI Horde la identidad la fijan los pesos, no una imagen

Fecha: 2026-09-04

Estado: aceptada, implementada

Daniel preguntó lo que pregunta cualquiera al ver que un personaje del horde no
tiene memoria: si se puede subir una imagen de referencia para que salga
coherente. Se comprobó contra su swagger vivo 2.6, sus 178 modelos y los 18
workers conectados.

**No existe ningún mecanismo de identidad por imagen.** Las cadenas
`ipadapter`, `ip_adapter`, `faceid`, `instantid`, `photomaker`, `pulid`,
`reactor`, `insightface`, `faceswap` y `kontext` no aparecen en su swagger. Y no
hay ningún modelo de edición por instrucción servido: recorridos los 178
nombres, cero contienen `kontext`, `edit` o `instruct`.

Sí se puede mandar una imagen de entrada, pero eso es img2img, inpainting o
remix, y ninguna hace lo que se espera: img2img conserva **píxeles** —con
denoising bajo devuelve casi lo mismo, con denoising alto pierde la cara— y
remix conserva **concepto**, no rasgos. No hay punto intermedio que dé «misma
cara, escena nueva».

Lo que sí fija una identidad ahí son los **pesos**: un LoRA de personaje
publicado en CivitAI. Estaba soportado en el esquema y en el adaptador desde el
primer día y no había ningún campo en la pantalla para escribirlo, que era el
hueco real.

Consecuencias de diseño:

- **El editor de LoRAs es la respuesta a la pregunta**, y dice lo que cuesta:
  +3 kudos por LoRA y sólo 9 de los 18 workers los aceptan, así que pedir uno
  reduce a la mitad quién puede atenderte.
- **img2img se implementa igual, pero anunciado por lo que es**: varía una
  imagen que ya salió bien. La interfaz lo dice con esas palabras. Vender esto
  como coherencia de personaje sería la clase de promesa que produce el
  «funciona mal» de dentro de dos semanas.
- **ControlNet no se implementa.** El fichero de baselines dice
  `controlnet: true` para SDXL, pero el gate real del worker sólo incluye SD1 y
  SD2: un Pony o un Illustrious con `control_type` vuelve con
  `ControlNetMismatch`. Habría sido código que falla siempre en los modelos que
  de verdad se usan.

Dos detalles del contrato que no se adivinan y que costaría caro equivocar:
`source_image` va en la **raíz** del cuerpo y `denoising_strength` **dentro de
`params`**; ponerlos al revés hace que el servidor ignore la imagen en silencio
y devuelva una generación de cero, sin ningún error.

## D-068 — el personaje es lo duradero; el proveedor de imagen es una propiedad suya

Fecha: 2026-09-04

Estado: aceptada, implementada

Lo dijo Daniel con todas las letras: «quiero que Lía pueda enviarme imágenes
desde Horde, sin tener que volver a crear el personaje. NUNCA quiero que Lía se
pierda entre modelos: el personaje persiste, con sus memorias, todo. Lo que
podemos cambiar es qué proveedor nos da las fotos».

El diseño de `D-064` no lo permitía, y estaba mal por un motivo concreto: ataba
el personaje a su proveedor. Un personaje **era** de Xavira o del horde, así que
usar a Lía en el otro obligaba a crear una nueva —identificador nuevo— y ahí se
quedaban sus conversaciones, sus recuerdos y sus imágenes. El identificador es
la costura por la que todo eso cuelga.

La forma nueva separa las dos cosas:

- `characterId` es la identidad **durable**, nuestra, y **no cambia nunca**. A
  ella se agarran las conversaciones (`latestCharacterId`), los episodios de
  memoria (`conversationsOf`) y los medios generados.
- `imageProvider` dice quién le hace las fotos **ahora**, y se cambia cuando se
  quiera sin tocar nada más.
- `xavira` y `horde` guardan cada identidad por separado: la primera con el
  identificador que devolvió **su** API, la segunda con la receta local.

El error de fondo que esto corrige es haber usado el identificador de un
proveedor como clave propia. Coincidían, así que parecían la misma cosa; pero
uno es nuestro y el otro pertenece a un servicio que puede dejar de usarse. Al
separarlos, un personaje puede existir en los dos sitios, en uno, o cambiar de
sitio, sin que su historia se entere.

**La migración es lo delicado, y por eso está probada aparte.** Lo escrito en
disco antes de hoy lleva `provider`, `modelId` y `recipe`; se traduce **al
leer**, sin reescribir el archivo y sin tocar `characterId`. En un personaje de
Xavira anterior, la clave de la bóveda ERA la de su API: la traducción la copia
dentro de `xavira` y a partir de ahí el código usa esa y nunca la de la bóveda.
Hay una prueba con el identificador real del personaje de Daniel, porque
equivocarse ahí no da un error: da un personaje que ya no recuerda nada.

Lo que **no** resuelve, y hay que decirlo: **la cara no se traslada**. Cada
proveedor construye la identidad a su manera —un identificador en su servidor
allí, una receta local aquí— y no hay forma de convertir una en otra. Lía
seguirá siendo Lía, con su nombre, su personalidad y todo lo que han hablado;
pero sus fotos de Xavira y sus fotos del horde no serán la misma cara. Eso es
una limitación de los generadores, no del diseño, y la pantalla lo avisa antes
de cambiar en vez de dejar que se descubra en la primera foto.

## D-069 — la galería no guarda miniaturas: Electron no sabe leer webp

Fecha: 2026-09-04

Estado: aceptada, implementada

El plan obvio para una rejilla de imágenes es guardar una miniatura junto a cada
archivo: se descifra rápido, ocupa poco y evita tener treinta imágenes a tamaño
completo descifradas en memoria. El almacén ya tenía el hueco preparado
(`thumbnailObjectKey`, `readThumbnail`, `subkeyFor('thumbnail', …)`), sin que
nadie lo rellenara nunca.

**No se puede hacer en el proceso principal.** Comprobado ejecutando Electron de
verdad contra un webp y un gif de 1x1:

```
{"name":"webp","empty":true,"size":{"width":0,"height":0}}
{"name":"png","empty":false,"size":{"width":1,"height":1},"jpegBytes":761}
{"name":"gif","empty":true,"size":{"width":0,"height":0}}
```

`nativeImage` sólo decodifica PNG y JPEG, y **webp es el formato de casi todo lo
que entra en la bóveda**: los avatares, lo que devuelve AI Horde y las imágenes
de referencia, que además se rechazan si no son webp. Una miniatura hecha así
saldría vacía justo en los archivos que importan.

Las salidas descartadas, y por qué:

- **Una dependencia nativa (`sharp` y parecidas).** Binario por plataforma,
  recompilación contra la ABI de Electron en cada actualización, y todo para
  redimensionar. Es mucho equipaje para un panel de imágenes.
- **Decodificar en el renderer y devolver la miniatura sellada.** Funciona
  —Chromium sí lee webp— pero abre un canal que mete bytes del renderer en la
  bóveda, y sólo se gana la primera vez: para verla hay que haber descifrado
  antes la imagen entera de todos modos.

Lo que se hace: **cada baldosa descifra su propia imagen cuando entra en
pantalla**, con un `IntersectionObserver`, y ninguna antes. Abrir una
conversación con treinta archivos no descifra treinta imágenes; descifra las que
se ven. La copia descifrada vive en el estado del componente, que se desmonta al
cerrar la bóveda, así que sigue valiendo la regla de `openMedia`: nada
descifrado sobrevive al cierre.

Consecuencia asumida: al bajar por una galería larga se descifra archivo a
archivo, así que hay un instante de hueco en cada baldosa. Es el precio de no
tener miniaturas, y se paga en comodidad, no en seguridad. Si algún día molesta
de verdad, el camino es el segundo descartado —miniaturas hechas en el
renderer—, no la dependencia nativa.

## D-070 — el catálogo tiene dos orígenes, y hay que decir de cuál se habla

Fecha: 2026-09-04

Estado: aceptada, implementada

Luxy guarda las conexiones en dos listas que no se hablan:

- `connections` — pasarelas con perfil completo: protocolo, cabeceras, tiempo de
  espera. Su clave se guarda como `connection:<id>`.
- `providers.http` — APIs compatibles con `chat completions`, que es donde vive
  el selector de proveedores conocidos y por tanto Mistral, Cohere o Groq. Su
  clave se guarda con el nombre que declara el propio proveedor.

Toda la maquinaria del catálogo miraba **sólo la primera, y sólo su primer
elemento**, escrito a mano como `connections[0]` en tres sitios. La consecuencia
visible: añadir Mistral, pulsar «Actualizar modelos» y recibir el catálogo de
otra pasarela, sin ningún error.

La opción descartada fue **fundir las dos listas en una**. Es lo que parece
correcto, y no lo es hoy: los dos lados guardan la clave con nombres distintos,
el agente los registra de forma distinta —un proveedor HTTP bajo su
identificador; una conexión, un proveedor por cada familia de su catálogo— y
migrar una configuración existente sin poder probarla contra la máquina de
Daniel es la clase de cambio que rompe el arranque. Queda como trabajo aparte.

Lo que se hace: el catálogo se direcciona por **origen + identificador**, no por
identificador solo. Los identificadores de las dos listas comparten espacio de
nombres, así que sin el origen una conexión y un proveedor llamados igual
compartirían archivo y se pisarían.

Dos consecuencias que conviene tener presentes:

- **La familia de un proveedor HTTP es su identificador, no lo que diga el
  nombre del modelo.** El agente lo registra así, y adivinar por el nombre es lo
  que dejaba a `pixtral-12b` fuera de Mistral. Para una conexión agregadora se
  sigue adivinando, porque sirve muchas familias a la vez.
- **`family` es un enum cerrado y sigue siéndolo.** Un identificador de
  proveedor que no sea una familia conocida no se impone: se vuelve a adivinar.
  Aceptar cualquier cadena convertiría una errata en la configuración en un
  esquema que salta y un catálogo que desaparece entero. El precio es que un
  proveedor nuevo no se agrupa solo hasta añadirlo a `MODEL_FAMILIES`, y
  TypeScript obliga a ponerle etiqueta al hacerlo.

## D-071 — las costuras del troceado no son contenido de la imagen

Fecha: 2026-09-08

Estado: aceptada, implementada

Daniel prueba el describidor con una foto suya y el modelo escribe «un plano
general y **cuatro primeros planos segmentados**». Él avisa: *«¿cómo que cuatro
viñetas? Sólo es una foto»*.

Tenía razón, y el detalle inventado estaba en una descripción que **habíamos
dado por buena**.

En el razonamiento del modelo estaba la explicación:

> *«The seams are visible as white gaps between the sections»*
> *«a vertical stack of crops from a single larger image»*

No se lo inventó de la nada. **Los modelos de visión trocean la imagen en
mosaicos de tamaño fijo y rellenan los huecos** para que encaje en su rejilla;
una foto de 768×1280 no cuadra en ninguna, así que llega partida y con bandas
de relleno. Estaba describiendo el procesado, no el contenido.

Da igual el porqué: **como pie de foto es un hecho falso sobre el archivo**, y
de ahí pasa a la memoria del personaje. Es `D-061` exacto, una capa antes.

Lo descartado, y por qué:

- **Redimensionar la imagen en Luxy** para que encaje en un mosaico. Es la
  solución de fondo, pero no se puede hacer aquí: `nativeImage` de Electron no
  decodifica webp (`D-069`), que es el formato de casi todo lo de la bóveda.
  Y encoger antes de enviar tira detalle justo cuando lo que se pide es más.
- **Callar toda división.** Sería el error contrario: una retícula de cómic o
  un marco trazado son contenido de verdad, y omitirlos deja el archivo peor
  descrito.

Lo que se hace: se le dice al modelo que **recibe UNA imagen**, que las franjas
de color plano que la parten son del procesado, y que sólo mencione una división
si es claramente del dibujo. Es una regla del prompt y no un filtro sobre el
texto porque el modelo es el único que puede distinguir un marco dibujado de una
banda de relleno.

**Lo que este caso demuestra del diseño, y conviene no perderlo:** el banco de
pruebas no guarda nada, así que esa descripción falsa **nunca llegó a la
bóveda**. Y el panel de «lo que pensó antes de responder» —que existe porque
Daniel pidió que no se tirara— es lo único que permitió entender la causa en vez
de apretar el prompt contra un síntoma.

## D-072 — un recorte nuestro se marca; el del modelo no se disfraza

Fecha: 2026-09-08

Estado: aceptada, implementada

Dos veces seguidas Daniel leyó un texto que acababa a mitad de palabra y no
pudo saber quién lo había cortado:

- primero una descripción que nunca llegó a escribirse, porque el modelo agotó
  su salida razonando (`solo-razono`);
- después un razonamiento cortado en seco por nuestro tope de 4.000 caracteres:
  *«se recorta lo que piensa»*.

**Son dos averías distintas y se arreglan distinto**: una pide cambiar de modelo
o darle más salida, la otra subir un número nuestro. Un corte sin marcar las
vuelve indistinguibles, y manda a la solución equivocada.

La regla, desde ahora: **si el corte es nuestro, se dice**. `trimWithMark`
recorta por la última frontera de palabra y añade una marca, que cabe **dentro**
del tope —si sobresaliera, el tope dejaría de serlo y el esquema de destino
podría rechazar el registro entero—.

Las dos marcas son distintas a propósito:

| Texto | Marca | Por qué |
| --- | --- | --- |
| razonamiento | `[…recortado por Luxy: el razonamiento seguía]` | sólo se enseña, nunca se guarda: se puede explicar |
| pie de foto | `…` | **se guarda y lo lee el personaje** como «lo que se ve en la imagen»: una nota nuestra ahí dentro la leería como contenido, que es `D-061` otra vez |

Los dos topes suben, y por medición:

- **pie de foto, 1.500 → 1.900.** La primera descripción buena de verdad ocupó
  1.354, el 90% del tope. Una imagen con más cosas dentro lo pasaba, y pasarlo
  significa guardar una frase cortada por la mitad como si fuera el archivo. El
  esquema del medio admite 2.000: quedan 100 de margen.
- **razonamiento, 4.000 → 20.000.** Un modelo que razona en voz alta redacta el
  borrador entero de la descripción dentro del bloque y luego la escribe otra
  vez: el razonamiento sale **más largo** que la respuesta, no más corto. Esto
  no se archiva —vive en memoria, viaja por IPC una vez y se pinta en un
  desplegable—, así que el tope sólo existe para que no crezca sin límite.

## D-073 — un dato de diagnóstico que miente es peor que no tenerlo

Fecha: 2026-09-08

Estado: aceptada, implementada

Daniel: *«En todas las ejecuciones he puesto el modelo que me dices, si sigue
respondiendo el otro es porque no funciona bien»*. La pantalla del banco decía
`respondió llama-3.3-70b-versatile` en las cuatro pruebas, que es exactamente el
`defaultModel` de su conexión de Groq.

**Yo deduje de eso que el modelo elegido no llegaba a la petición, y se lo dije
como un hecho. Era falso.** El cuerpo del POST siempre llevó el modelo elegido.
Lo que mentía era la etiqueta.

`apps/agent/src/providers/http-provider.ts:368`, rama de éxito sin herramientas
—la única que usa el banco—:

```ts
const usage: ProviderUsage = { provider: this.config.id, model: this.config.model, ... }
```

Las otras tres apariciones del mismo campo en el fichero ya usaban
`this.modelFor(request)`, incluida la que arma el cuerpo del POST (`:704`). Ésta
se quedó atrás. Y `job-runner.ts:799` pisa con ella el `executedModel` correcto
que él mismo había calculado en `:726`.

Dos evidencias independientes de que el cuerpo iba bien:

1. **La asimetría del log.** `failure()` no devuelve `usage`, así que un turno
   que falla conserva el modelo correcto. En `luxy.log` los turnos fallidos de
   Mistral registran `mistral-small-latest` y `mistral-medium-latest` —los que
   Daniel eligió a mano, y ninguno es el `defaultModel` `mistral-large-latest`—
   mientras que **todos** los turnos completados registran el valor por defecto.
2. **`llama-3.3-70b-versatile` ya no está en el catálogo de Groq.** Si de verdad
   se hubiera mandado, la llamada habría fallado. Completó cuatro veces.

Lo que hace especialmente cara esta clase de fallo: **la única prueba que tenía
el usuario de que algo iba mal era el campo estropeado**, y me llevó a mí a
afirmar un diagnóstico equivocado con seguridad. Un contador que no existe deja
a todo el mundo en la duda; uno que miente manda a arreglar lo que no está roto.

Además de arreglar `:368`, `job-runner.ts:799` **avisa** cuando el proveedor
informa de un modelo distinto del pedido, en vez de tragárselo. Es legítimo que
un servidor resuelva un alias; lo que no es legítimo es que no se vea. Sin esa
línea, este mismo bug volvería a ser invisible.

La prueba de regresión afirma las **dos mitades sobre la misma llamada** —lo que
va en el cuerpo y lo que se informa—, que es lo único que impide que vuelvan a
separarse. No existía ninguna: `usage.model` no aparecía en ningún test del
agente.

## D-074 — una lista de formatos vive donde se pueda probar

Fecha: 2026-09-08

Estado: aceptada, implementada

`.avif` no se podía adjuntar ni pasar por el banco. La causa eran **tres sitios
mantenidos a mano por separado** dentro de `handlers.ts`: dos listas de
extensiones en dos diálogos distintos y un mapa de tipos que no conocía los
mismos formatos que ellas. Ninguno tenía una sola prueba, porque están dentro
del proceso principal y allí no se pueden probar.

El modo de fallo del mapa era el peor de los dos, y no parecía un fallo:

- una extensión desconocida devuelve `application/octet-stream`;
- eso no casa con el `^image/` de `localTurnImageSchema` (`host-protocol.ts:39`);
- `host-entry.ts:189` **descarta el mensaje en silencio y no contesta**;
- la ventana se queda en «Mirando…» hasta agotar el timeout y termina diciendo
  «el agente no respondió a tiempo» — un fallo de extensión disfrazado de fallo
  del agente.

Ahora viven en `apps/desktop/src/shared/media-types.ts`, que es puro, y su
prueba fija la invariante que estaba rota: **toda extensión que se ofrece en un
diálogo tiene que tener un tipo de verdad detrás**. Los dos diálogos derivan de
las mismas constantes.

Las listas de imagen y de vídeo siguen **separadas**, y no por descuido: el
banco de visión manda una imagen y no puede aceptar un mp4. Unificarlas lo
rompería, y hay una prueba que lo dice.

El banco rechaza ahora un formato que no sabe nombrar **antes** de gastar la
llamada, copiando la guarda que ya existía en `vaultMediaDescribe`.

**Lo que esto NO resuelve:** que Groq acepte `image/avif`. No se puede saber
leyendo el repositorio y no se ha gastado ninguna llamada en averiguarlo. Se
responde con una prueba en el banco, que existe precisamente para eso. Si lo
rechaza, el siguiente paso sería convertir a png en el renderer —Chromium sí
decodifica avif, al revés que `nativeImage` (`D-069`)—, no volver a esconder el
formato.

## D-075 — el pie de foto se escribía y nadie lo leía

Fecha: 2026-09-08

Estado: aceptada, implementada

Daniel pide una foto en mitad de una escena. Lía no manda ninguna: menciona
*«si es la del perfil... la que tienes guardada...»* y desvía.

No estaba bloqueada. Su pantallazo cierra las tres condiciones de
`imageBlockReason`: personaje fijado, personaje en la bóveda y **`clave
guardada`** de AI Horde. `canGenerateImage` era `true`, así que el bloque de
imagen **sí** iba en su prompt, con la lista de lo que había.

Lo que veía era una línea:

```
- med-xxxx: su foto de perfil
```

`existingImages` se construía con `item.metadata.prompt`, y `prompt` es —según
su propio esquema— *«lo que se PIDIÓ al generar. Es historia, no descripción»*.
El campo `caption`, cuyo comentario en ese mismo esquema dice *«el pie de foto
es lo único que el modelo sabe de una imagen ya guardada»*, **no se leía en
ninguna parte del camino del prompt**.

Consecuencia: describir una imagen con un modelo con vista, o corregir su pie de
foto a mano, **no cambiaba una sola letra de lo que veía el modelo de la
conversación**. Todo el describidor —el trabajo de esta misma sesión— era
decorativo para su único consumidor.

Y había un tercer significado del mismo campo: adjuntar un archivo metía el pie
de foto tecleado por el usuario en `prompt`, que es exactamente la mezcla que el
esquema dice haber corregido al separarlos. Ahora va a `caption`; la cadena de
reserva `caption ?? prompt ?? displayName` conserva lo que ya hay en disco.

El orden vive en `imageDescriptionFor`, en `packages/shared`, con sus pruebas.
Estaba en el proceso principal, donde no se puede probar, y por eso llevaba mal
cableado sin que nadie lo notara.

## D-076 — reenviar y generar son dos permisos, no uno

Fecha: 2026-09-08

Estado: aceptada, implementada

`canGenerateImage` gobernaba las dos cosas: sin él, `existingImages` se vaciaba
y el bloque entero desaparecía del prompt.

Pero **reenviar una imagen que ya está en la conversación no toca al proveedor
ni necesita clave**: se lee del disco cifrado. Un personaje sin clave se quedaba
sin poder enseñar ni su propia foto de perfil —que el mismo turno acababa de
copiar a la conversación **precisamente para poder reenviarla**, catorce líneas
antes de tirar la lista que la contenía—.

Ahora el bloque se envía si se puede generar **o** si hay algo que reenviar, y
`buildVaultImageInstruction` recibe cuál de las dos cosas se puede. Sin
generación ofrece sólo (a) y dice que no puede generar, en vez de callarse las
dos.

## D-077 — una petición directa manda sobre el personaje

Fecha: 2026-09-08

Estado: aceptada, implementada

La otra mitad de por qué Lía no mandó nada. El bloque prohibía **dos** formas de
fallar al mandarla:

- alegar que no puedes adjuntar archivos;
- prometer enviarla sin incluir el bloque.

Y se dejaba fuera la tercera, que es la que ocurrió: **desviar en personaje**.
*«¿Para qué quieres una foto si me tienes aquí?»* no es ninguna de las dos
prohibidas. Encima el permiso estaba condicionado a *«y haya una opción que
encaje»*, un condicional que le daba la salida cuando la única imagen existente
se describía como «su foto de perfil» (`D-075`).

Y las instrucciones de personaje de Daniel empujaban en esa dirección: *«No
llevas la iniciativa dos turnos seguidos»*. El modelo lo aplicó a una petición
explícita.

El bloque dice ahora que una petición directa **es una orden**, que enseñar algo
que te han pedido no es iniciativa propia, que esquivar —cambiar de tema,
bromear, preguntar para qué la quiere— es incumplirla por mucho que encaje con
el personaje, y que ante la duda se manda una: elegir mal es mejor que no mandar
nada.

**Lo que este caso enseña del diseño:** una prohibición redactada como lista de
casos deja fuera lo que no se le ocurrió a quien la escribió. Las tres reglas
que había eran correctas y no sirvieron de nada, porque el modelo encontró una
cuarta salida. Contra eso vale la regla positiva —«es una orden»— y no otra
prohibición más.

## D-078 — la cancelación devuelve lo que hubiera, y se tiraba

Fecha: 2026-09-08

Estado: aceptada, implementada

Daniel pide una foto, Luxy dice «la imagen no estuvo lista a tiempo», y él abre
la web de AI Horde: **una de sus dos generaciones estaba terminada**.

`awaitImage` cancela al rendirse, y eso está bien: sin el DELETE la petición
sigue viva ocupando a un worker. Lo que estaba mal es lo que hacía con la
respuesta.

```ts
await cancelImage(id, { ...options, signal: cancelSignal }).catch(() => undefined);
throw error;
```

El comentario de `cancelImage` lo dice con todas las letras — *«cancelar
devuelve lo que hubiera»*— y devuelve un `HordeResult` completo, con sus
`generations`. Se descartaba para lanzar el error del tiempo agotado.

**La ventana no es teórica.** El sondeo espacia sus vueltas con backoff hasta
8 s (`MIN_POLL_INTERVAL_MS` 1200 → `MAX_POLL_INTERVAL_MS` 8000), así que entre
la última comprobación y el vencimiento hay segundos en los que un worker puede
terminar. Si termina ahí, la imagen existe, está pagada con kudos —que en una
cuenta nueva son 25— y se tiraba.

Ahora, si la cancelación trae generaciones, se devuelven. Con dos cuidados:

- **se sigue cancelando siempre**: rescatar no puede dejar la petición viva;
- **se comprueba la censura**, igual que en el camino normal (`assertNotCensored`).
  `cancelImage` no la aplica a propósito, porque quien cancela ya no espera nada;
  pero aquí sí esperamos, y una imagen censurada es un rectángulo negro. Darla
  por buena sería peor que decir que no llegó.

**Lo que este arreglo NO es.** No explica los diez minutos de espera: eso son
los workers del horde y la posición en la cola, que depende de los kudos. Es
manejo de consecuencias, no la causa. Se dice porque la tentación al leerlo es
darlo por resuelto.

**Lo que quedó descartado por la verificación**, y conviene no volver a
proponerlo:

- *no cancelar para aprovechar los 30 minutos del enlace*. Confunde dos relojes:
  los 30 minutos son de la URL prefirmada de R2 de un resultado **ya generado**;
  la petición en cola caduca a los 10, que es justo nuestro plazo. No cancelar
  no compra tiempo y rompe una invariante escrita.
- *guardar el identificador de la petición para reintentar*. No sirve mientras
  el propio Luxy borre el trabajo al rendirse, y con este rescate deja de hacer
  falta en el caso que importaba.

## D-079 — una espera larga tiene que poder explicarse

Fecha: 2026-09-08

Estado: aceptada, implementada

Generar una imagen en AI Horde puede tardar diez minutos, y durante esos diez
minutos la ventana no decía nada. Al final: «la imagen no estuvo lista a
tiempo».

Esa frase no distingue **dos averías que se arreglan de forma distinta**:

- estabas el 300º de la cola → esperar, o conseguir kudos;
- ningún worker sirve tus modelos → cambiar de modelo.

El dato existía todo el tiempo. `pollImage` calcula `queuePosition`,
`waitTimeSeconds`, `waiting`, `processing` y `kudos` **en cada vuelta** —unas
ochenta en diez minutos, porque el sondeo se espacia hasta 8 s— y `handlers.ts`
no pasaba `onProgress`, así que se tiraba entero.

Es el mismo patrón que `D-073` y que el `context.log` que no escribe en ningún
sitio: **el diagnóstico existe y no llega a nadie.** Tres veces en una sesión.

Lo que cruza al renderer es un esquema **cerrado de cinco contadores**. Esa es
la garantía que permite mandarlo sin tocar la premisa de la bóveda, y hay una
prueba que la fija: si algún día el progreso del proveedor creciera con algo que
no sea un número, no pasaría por descuido.

Dos consumidores, con reglas distintas a propósito:

- **la ventana recibe todas las vueltas**: es un contador y tiene que bajar;
- **el log solo las que dicen algo nuevo** —cambia el puesto, o alguien empieza
  a dibujarla—. Ochenta líneas idénticas esconden justo el momento en que la
  petición avanza.

El canal es el patrón de `vaultLocked`, que ya existía; lo único nuevo es el
canal y su carga.

## D-080 — el proceso principal también deja rastro, y los dos logs se leen juntos

Fecha: 2026-09-08

Estado: aceptada, implementada

`context.log` del proceso principal era esto:

```ts
if (isDev) console.log(`[luxy] ${message}`, fields);
```

**No escribía en ningún sitio.** `electron.exe` es un binario de subsistema
gráfico y no hereda consola, así que ni siquiera en desarrollo se veía. Y todo
el camino de imágenes de la bóveda vive en el proceso principal.

Lo que costó: **dos diagnósticos equivocados seguidos** sobre por qué un
personaje no mandaba una foto. La línea que lo habría resuelto en diez segundos
—si el turno podía ofrecer imágenes y cuántas había— se calculaba y se perdía.
Es el mismo patrón que `D-073` y `D-079`: el dato existe y no llega a nadie.

Ahora hay `studio.log`, al lado de `luxy.log`, en la misma carpeta.

**Compartir carpeta era la parte peligrosa.** El nombre estaba cableado en tres
sitios que tenían que moverse juntos —el archivo, el nombre al rotar y el patrón
de limpieza— y ese último **borra**. Cambiar sólo el primero habría dejado al
logger de Studio llevándose por delante los archivos rotados del agente, que es
justo donde se mira cuando algo falla. El nombre base es un parámetro y los tres
derivan de él, con el patrón escapado. Hay una prueba que lo fija.

**Y se leen juntos.** `tailLogFile` funde los dos por marca de tiempo en vez de
enseñar uno. Son las dos mitades de la misma historia: Studio decide si el turno
puede ofrecer imágenes, el agente cuenta cómo terminó la llamada. Además los dos
mensajes se parecen tanto —«turno privado» y «turno privado terminado»— que ya
indujeron a error una vez; en orden se leen como lo que son.

Una línea sin marca de tiempo **no se descarta**: se queda pegada detrás de la
última que sí la tenía. Es el ruido que explica un fallo, y tirarlo por no
encajar en el formato sería perder lo único que quedaba de una salida rara.

La línea del turno lleva ahora el **motivo** del bloqueo y el **proveedor**, no
sólo el booleano: los tres motivos se arreglan en sitios distintos.

## D-081 — el pie de foto se corrige en una caja, y quien lo reescribe no ve la imagen

Fecha: 2026-09-10

Estado: aceptada, implementada

Dos problemas del mismo texto, el pie de foto de una imagen de la boveda, que es
lo unico que el personaje sabra de ella.

**Uno: el recuadro.** Era un `input` de una linea para un texto de hasta 1.900
caracteres. Corregir ahi dentro es imposible —el cursor salta al principio y no
se ve lo que se esta tocando— asi que en la practica nadie corregia nada, y un
pie de foto mal redactado se quedaba mal redactado. Ahora es un `textarea` de
diez filas, agrandable, con la cuenta de caracteres debajo.

**Dos: el tope.** 1.900 se quedaron cortos con un modelo que mira de verdad: se
corto a mitad de la postura con el escenario, la luz, el pelo y la piel ya
descritos. No sobraba nada, es que no cabia, y lo que se guardaba era una frase
partida por la mitad presentada como lo que se ve en el archivo. Sube a 3.000
—los esquemas de al lado, a 3.200— por la misma regla de siempre: se sube cuando
se mide, no por si acaso.

**Y tres: el boton que lo reescribe.** Los modelos con vista disponibles ven
bien y redactan mal: «figura femenina de proporcionadas masculinas adultas».
Otro modelo arregla eso en una llamada. Lo delicado es que ese boton es un
generador de `D-061` esperando a ocurrir —un dato falso sobre una imagen que
nadie va a volver a mirar— asi que se le ponen tres cerrojos:

1. **no se le manda la imagen.** Solo el texto. Cualquier detalle nuevo seria
   inventado por definicion, y el prompt se lo dice con esas palabras;
2. **no guarda.** Lo que devuelve cae en el borrador del recuadro, al lado de la
   foto, y se guarda a mano o no se guarda. Un boton que escribiera directamente
   cambiaria un texto verdadero por otro que nadie ha leido;
3. **una contradiccion se quita entera, no se resuelve.** Si el original dice
   «femenina de proporciones masculinas», elegir una mitad seria inventarse cual
   era la buena.

Tampoco puede quitar lo explicito: un pie de foto es una descripcion tecnica y
la precision es lo que lo hace servir para elegir una imagen. Y lo escribe el
modelo de la **conversacion**, no el de vision: aqui no hay nada que mirar, y
quien mira bien no es quien escribe bien.

## D-082 — el esfuerzo de razonamiento se elige, y la lista depende del modelo

Fecha: 2026-09-10

Estado: aceptada, implementada

Codex salia a `xhigh` en cada turno de Luxy. No era un defecto de Codex: era el
`model_reasoning_effort = "xhigh"` que el usuario tenia puesto en su
`~/.codex/config.toml` desde hacia meses. **Un ajuste heredado de otro programa
gobernaba en silencio lo que gasta este**, y no habia forma de verlo ni de
cambiarlo sin salir de Luxy. Los modelos traen `medium` o `low` de fabrica.

Ahora se elige por turno. Tres decisiones dentro de esta:

**1. Viaja por donde viaja `maxOutputTokens`, no dentro del trabajo.** Es un
ajuste de ESTA llamada, no parte del contrato del gateway, asi que no toca la
base de datos ni pide migracion. El camino se mapeo antes de escribir nada
porque el propio `job-runner.ts` documenta que esto ya fallo con el modelo:
«antes solo se le pasaba a claude, asi que codex y las APIs http usaban siempre
su modelo por defecto y el catalogo no servia de nada».

**2. Gateado por deteccion en los dos CLI.** `--effort` en Claude y `-c` en
Codex se comprueban contra el `--help` de la version instalada. Pasarle a un CLI
un flag que no conoce **no lo ignora: aborta la invocacion**, asi que sin esto
actualizar Luxy romperia el CLI de quien no hubiera actualizado el suyo.

**3. La lista de esfuerzos depende del MODELO, no del proveedor.** El esquema de
Codex lo dice: «must be supported by the selected model». Mandar `ultra` a
`gpt-5.5` no lo recorta, falla, y la llamada se paga igual. Con un modelo
desconocido se ofrece hasta `xhigh`, el techo del mas modesto: equivocarse hacia
arriba cuesta una llamada; hacia abajo, solo una opcion sin ofrecer.

Una conexion HTTP no ve el selector. El contrato `chat completions` no tiene
donde poner esto, y un mando que no mueve nada es peor que no tenerlo.

> **Corregido en parte por `D-107` (2026-09-28).** El contrato no tiene un campo
> comun, pero cada proveedor documenta el suyo. Las conexiones HTTP tienen ahora
> un control de razonamiento POR MODELO y guardado, dentro del muestreo, que solo
> ofrece lo que la documentacion de cada modelo admite. Este selector por turno
> sigue siendo solo de Claude y Codex.

**Y no se persiste**, al contrario que casi todo lo demas. El esfuerzo se paga
por turno: una eleccion cara que sobreviviera a cerrar la ventana volveria a
cobrarse sin que nadie la hubiera vuelto a elegir.

### La fuente del catalogo de Codex, y una que no vale

Los modelos de Codex son sugerencias verificadas, no una consulta al CLI, y eso
es a proposito. `codex debug models` **no sirve**: devuelve un catalogo
empaquetado dentro del binario que se dejaba fuera `gpt-6-astra` —el modelo
nuevo, el que el usuario tenia puesto— y dos llamadas seguidas dan lo mismo, asi
que tampoco es una cache que se refresque. Con esa fuente se le llego a decir al
usuario que su modelo no existia; se equivocaba la fuente.

El catalogo vivo esta en `~/.codex/.codex-global-state.json`, que es estado
privado de otro programa y sin formato documentado: vale para comprobar a mano,
no para que Luxy lo lea. Hay una prueba que fija `gpt-6-astra` en la lista, para
que cambiarla por la salida de `codex debug models` falle en vez de borrar el
modelo nuevo en silencio.

### Donde NO llega el esfuerzo, a sabiendas

Dos caminos se quedan fuera. No es olvido y por eso se escriben con sus lineas:
quien los necesite sabra que estan sin hacer, en vez de descubrir que el
esfuerzo «a veces no se aplica».

Se listan con precision porque **la primera version de esta nota era vaga y eso
ya costo un fallo**: el mismo dia, el esfuerzo se cableo en un solo camino de
seis de la boveda y los otros cinco se quedaron fuera en silencio, incluido el
banco de pruebas de vision, que lo encontro Daniel usandolo. Un limite que no se
puede comprobar no es un limite, es un olvido con buena prensa.

Los tres puntos exactos, verificados con un barrido del repositorio:

- `apps/agent/src/agent.ts:638` — `executeJob` construye las dependencias de
  `runJob` sin `effort`. Es el UNICO camino de la cola, asi que se queda fuera
  todo lo que entra por ahi: Studio **Trabajos**, **Conversaciones** y
  **Laboratorio**, y en Telegram `/claude`, `/codex` y `/auto`;
- `apps/agent/src/job-runner.ts:500` — `runBatchOutcome` llama a
  `providerBatchModel` pasandole el modelo y no el esfuerzo, aunque tiene
  `deps` delante. Se sale del flujo normal antes de la linea que lo propaga;
- `apps/agent/src/batch/model.ts:120` — y esto es lo estructural:
  `ProviderBatchOptions` **no tiene campo** donde ponerlo. Aunque manana alguien
  arregle el punto anterior, no habria donde, y el tipo no se quejaria.

**El contrato del gateway.** `studioJobCreateRequestSchema` y `studioJobSchema`
(`packages/shared/src/schemas.ts`) no llevan esfuerzo, ni de ida ni de vuelta.
Un trabajo lanzado desde Telegram o desde la pantalla de Trabajos usa el que
traiga el proveedor. Meterlo ahi es otra funcion —columna nueva, migracion, y el
camino de vuelta para poder ver con que esfuerzo se ejecuto un trabajo ya
terminado—, no un remate de esta.

**Los lotes.** `providerBatchModel` (`apps/agent/src/batch/model.ts`) es el
segundo y ultimo sitio del agente que construye un `ProviderRunRequest`, y no
recibe esfuerzo. Es el que mas lo notaria: un lote hace N llamadas y el coste se
multiplica. No se cableo porque hoy nadie lo elegiria y seria plomeria muerta,
pero deja al lote como el unico camino sin esfuerzo — que es exactamente la
forma de la asimetria que ya costo detectar con el modelo. Si algun dia el
catalogador se elige a mano, empezar por ahi.

## D-083 — Codex si ve imagenes; lo que no lee son bytes

Fecha: 2026-09-10

Estado: aceptada, implementada

Luxy le decia al usuario que **Codex «solo acepta texto»**. Es falso.
`codex exec --help` declara `-i, --image <FILE>...`, y lo desmintio Daniel, que
paga la suscripcion y sabe que su modelo mira.

Lo peor no es el fallo, es que **el repositorio ya lo sabia**: hay un comentario
en `claude.ts` que menciona ese mismo flag para explicar por que se eligio
mandar la imagen por stdin. El dato estaba escrito a diez lineas del codigo que
decia lo contrario. Otra vez lo mismo: el dato existe y no llega a nadie.

**La distincion que faltaba.** `acceptsImages` era un booleano y respondia a la
pregunta equivocada. Hay dos:

- `acceptsImages` — «me das los bytes y los mando». Claude Code y las conexiones
  HTTP, si;
- `acceptsImagePaths` — «dame una RUTA y la leo yo». Codex, si.

Codex declara ahora `acceptsImages = false` y `acceptsImagePaths = true`. Los
dos juntos son la verdad entera; con solo el primero, en `false` por omision,
salia un error que llamaba tonto a un CLI que no lo es.

**Y de ahi sale que valga en un sitio y no en otro, que es lo importante:**

- **el banco de pruebas de vision SI**: el archivo lo elige el usuario en un
  dialogo y ya estaba en su disco, sin cifrar. No hay nada que proteger, asi que
  se le pasa la ruta junto a los bytes y Codex mira;
- **la boveda NO**, y no es un pendiente: una imagen privada solo existe
  descifrada en memoria. Escribir una copia en claro en el disco para que Codex
  pudiera abrirla romperia lo unico que hace privada a la boveda. Ese caso se
  queda en los transportes que aceptan bytes.

El mensaje de error dice ahora **cual de los dos casos es**, porque se arreglan
distinto: uno cambiando de proveedor, y el otro no se arregla — es el precio de
que la boveda sea una boveda.

La capacidad se detecta del `--help`, como todo lo demas: una version de Codex
sin `-i` no recibe el flag.

## D-084 — un segundo transporte para Codex, solo para las imagenes de la boveda

Fecha: 2026-09-10

Estado: aceptada, implementada y **probada contra el binario real**

`D-083` dejo una cosa a medias: Codex ve imagenes, pero `codex exec` solo las
acepta por `-i <FICHERO>`. Para una foto de la boveda no hay fichero —existe
descifrada en memoria y nada mas— y escribir una copia en claro romperia lo
unico que la hace privada. Daniel pidio explicitamente que se buscara otra via.

**La hay, y esta probada.** `codex app-server` habla un JSON-RPC por tuberia
cuyo `UserInput` distingue `LocalImageUserInput` (con ruta) de
`ImageUserInput` (con `url`), y ese `url` acepta un `data:` URI. La foto viaja
en linea dentro del mensaje, igual que en Claude Code, y **el disco no se toca**.

Comprobado de punta a punta con el transporte ya escrito: un PNG en memoria,
`gpt-6-astra`, esfuerzo `low`, respuesta correcta en once segundos.

### Convive con `codex exec`, no lo sustituye

Es la decision central. El propio CLI marca `app-server` como
`[experimental]`: su protocolo puede cambiar en cualquier actualizacion. Si
fuera el unico camino de Codex, una actualizacion dejaria a Codex entero sin
funcionar.

Se desvia **solo** cuando el turno lleva una imagen sin ruta. Todo lo demas
sigue por `codex exec`. Traducido: si el protocolo se rompe, se pierde describir
fotos de la boveda con Codex, no Codex.

### Tres cosas del protocolo que no son evidentes

1. **No existe `turn/failed`.** El fracaso viaja DENTRO de `turn/completed`, en
   `turn.status`, y solo entonces viene `turn.error`. Esperar una notificacion
   que no existe deja el transporte colgado hasta el timeout.
2. **El servidor PREGUNTA.** Manda mensajes con `id` que esperan respuesta
   —aprobaciones, herramientas, refresco de credenciales—. Si nadie contesta, el
   turno se cuelga y parece que el modelo no responde. Se rechazan todas por
   defecto; la de credenciales de ChatGPT ademas nunca podria atenderse, porque
   Luxy no maneja esas credenciales.
3. **`interrupted` no es un fallo.** Es lo que devuelve al pulsar Detener, y
   contarlo como error haria que la pantalla pidiera reintentar algo que el
   usuario acababa de parar.

Barreras del turno, las tres comprobadas: hilo **efimero** —no deja sesion
guardada con contenido de la boveda dentro—, sandbox **`read-only`** y
`approvalPolicy: 'never'`.

De regalo, este transporte SI rellena el diagnostico de final de respuesta y el
recuento de tokens. `codex exec` no lo hacia nunca, asi que hasta hoy un turno
de Codex no podia salir como truncado ni como agotado en Studio.

### El fallo que casi se cuela, y merece quedar escrito

La deteccion de `app-server` se escribio con una expresion regular con `\b`. La
consola convirtio esas dos letras en **caracteres de retroceso reales** (0x08).
El resultado compilaba, el typecheck pasaba y **no casaba nunca**: la capacidad
habria sido siempre falsa y el transporte no se habria activado jamas, diciendo
«actualiza Codex» con Codex ya actualizado.

Se encontro mirando los BYTES del archivo, no el texto. Es exactamente el caso
que describe la regla 2 bis del `CLAUDE.md`. Ahora es un `includes` sin
expresion regular, inmune al problema.

## D-085 — en la memoria, precision antes que alcance

Fecha: 2026-09-11. Autor: Claude. Origen: dos revisiones adversariales de
`F22-ALCANCE-MEMORIA-001` (33 y 23 agentes) sobre los patrones que deciden si
un mensaje pide recordar.

Decision. Los caminos que TRANSCRIBEN un momento (principio, fecha y palabras)
solo disparan cuando lo nombrado esta DENTRO de una pregunta o de una peticion
de recordar, en la misma clausula. Nombrarlo no basta.

Por que. Los dos errores no cuestan lo mismo:

- un falso NEGATIVO degrada bien: ella sigue teniendo las lineas del indice, y
  la del primer momento lleva su resumen, asi que contesta con lo que sabe;
- un falso POSITIVO transcribe un momento que nadie pidio: cuesta tokens y le
  hace recitarlo, muchas veces el que no era.

La primera version miraba el mensaje entero y cualquier «?» daba permiso: «desde
que nos conocimos pienso en ti, ¿quieres ser mi novia?» transcribia la primera
conversacion. Cada parche por frase rompia otra; lo que convergio fue la regla
por clausula mas una tabla de ~80 frases reales en `recall-reach.test.ts`, que
es la que dice si un cambio rompe algo.

Consecuencias:

- «la primera vez», «el primer dia» y «cuando nos conocimos» dejan de ser por
  si solas una peticion de recuerdo: la mayoria de las veces son afirmaciones;
- «el primer dia» a secas y «¿cuando empezamos?» exigen un verbo de recordar,
  porque tambien son el trabajo nuevo y la peli;
- el primer momento va SIEMPRE en el indice y con su resumen: es el respaldo
  que hace aceptables los falsos negativos.

Ampliacion, el mismo dia: una caza de falsos positivos probo 287 frases de
chat realistas y encontro **141** que transcribian sin que nadie lo pidiera, y
muchas por reglas anteriores a este paso: «ayer hable con mi madre», «el
sabado hablamos con calma», «acuerdate de comprar pan», «me recuerdas a un
osito». La regla por clausula no bastaba. Lo que decide ahora es la
CONSTRUCCION:

1. un verbo de recordar que pregunta, con un objeto que es un recuerdo y no un
   recado («de comprar»), un mimo («que te quiero») ni un parecido («me
   recuerdas a»); ni «siempre te acuerdas» ni «si te acuerdas»;
2. un imperativo de recordar con objeto de recuerdo: «acuerdate de cuando...»,
   no «recuerdame que mañana...»;
3. una pregunta que EMPIEZA por un interrogativo pegado a un verbo de nosotros
   o de ti a mi: «¿de que hablamos?», «¿que me dijiste?», no «¿que dijiste en
   la entrevista?»;
4. «lo que»/«aquello que» con esos verbos, y «lo de» + un tiempo.

Para el principio: la frase tiene que estar gobernada por un verbo de
recordar, pedida con «cuentame», o ser una pregunta que empieza por «como»,
«cuando» o «donde» pegado a ella, o por ella misma. Se escriben enteras las
abreviaturas «q», «pq» y «xq».

Las 141 frases son `recall-falsos-positivos.fixture.ts`, GENERADO del resultado
de la caza: no se retoca una frase para que pase.

Reabrir solo con evidencia de mensajes reales que fallen: el diagnostico
«Comprobar la memoria» cuenta que camino habria disparado cada mensaje de Daniel.

## D-086 — una foto que hace el usuario dentro de la escena se genera

Fecha: 2026-09-11. Autor: Claude. Origen: un turno real de Daniel.

Paso: el usuario escribio en la escena que le hacia una foto al personaje. El
modelo lo entendio y reacciono al clic en personaje, pero no genero nada: la
instruccion de imagen solo contaba «el usuario pide ver, recibir o volver a ver
una imagen», y hacer una foto no es pedirla. La imagen solo salio cuando el
dijo que la habia borrado y pidio otra.

Decision. `buildVaultImageInstruction` cuenta DOS casos para escribir el bloque:

1. el usuario pide ver, recibir o volver a ver una imagen;
2. el usuario HACE una foto en ese turno, dentro de la escena, y el personaje
   sale en ella: se genera lo que capta SU camara, aunque no pida verla.

No cuenta si se fotografia solo a si mismo, ni si solo lo dice o lo recuerda.
Sin poder generar, el segundo caso no aparece.

Lo que añadio la revision (dos agentes y un esceptico por hallazgo, cinco
problemas reales):

- «Nunca por iniciativa propia... si no te la han pedido, no la mandes» iba
  justo detras del caso 2 y lo anulaba. Ahora dice «fuera de esos dos casos» y
  que la foto que hace el no es iniciativa suya; la opcion «generar» tambien
  nombra el caso 2;
- si salen los dos, o se la hace otra persona, se genera solo ella, en plano
  cercano y sin el: el generador no puede dibujarle a el;
- si mira una foto que le acaba de hacer y no esta en la lista de imagenes
  existentes, no llego a generarse: se genera entonces;
- el prompt de esa foto no nombra ninguna camara, ni siquiera en negativo:
  «not looking at camera» tambien la dibuja. Se usan «eyes closed», «asleep» o
  «looking away», y el encuadre desde donde esta el.

Coste: la instruccion de imagen crece unos 1.200 caracteres. La fase 3 del plan
(mandar la guia de como escribir el prompt solo cuando el mensaje hable de
fotos) lo compensaria de sobra.

## D-087 — el trabajo de fondo de la boveda solo va por Claude o Codex

Fecha: 2026-09-11. Autor: Claude. Origen: el diseño de `F23-PENDIENTES-001`
lo destapo al leer el codigo, y Daniel pidio arreglarlo.

Paso: catalogar escenas usaba el proveedor de la ventana de conversacion. Con
DeepSeek elegido —el de pago, cobrado por llamada—, abrir «Lo que recuerda»
mandaba una llamada de pago por cada conversacion pendiente, en tandas de tres
y hasta doce vueltas.

Decision. Todo trabajo de fondo de la boveda —catalogar ahora, apuntar promesas
despues— pasa por `resolveAuxiliaryTarget`
(`packages/shared/src/auxiliary-target.ts`), que solo devuelve Claude o Codex:

1. lo elegido en el panel («Quien hace el trabajo de fondo»), si hay eleccion;
2. si no, el proveedor de la ventana cuando ya es Claude o Codex;
3. si no, Codex.

Un proveedor de pago se sustituye siempre, y su modelo y su esfuerzo se
descartan. La eleccion vive en `memory-excluded.json`, sin cifrar como las
exclusiones: es el nombre de un CLI, nada de la boveda. El esquema solo admite
Claude o Codex, asi que un archivo tocado a mano no puede colar otro.

Tambien: el bucle del panel ya no se para por una sola conversacion fallida
—un CLI puede negarse a una con contenido explicito y aceptar las demas—; solo
se para si una tanda no cataloga ninguna.

## D-088 — el trabajo de fondo no puede perder material en silencio

Fecha: 2026-09-14. Autor: Claude. Origen: nueve hallazgos confirmados al
revisar los pasos 5 a 9 de `F23-PENDIENTES-001`; cinco eran el mismo defecto
con cinco caras.

El patron. El trabajo de fondo de la boveda —catalogar, apuntar promesas— corre
solo, sin que nadie lo mire, y marca lo que va haciendo con un cursor. Cada vez
que una de esas dos cosas se desincroniza —se procesa MENOS de lo que se marca
como hecho— el material se pierde y ademas no se puede recuperar, porque el
sistema cree que ya paso por ahi. Las cinco caras que aparecieron:

1. el extractor heredaba el reparto del catalogo, que recorta cada turno a unos
   1.400 caracteres para poder resumir muchos. Veia el principio de cada turno,
   marcaba el turno entero como revisado y seguia;
2. un fallo al descifrar una conversacion tiraba la tanda entera, y la siguiente
   volvia a empezar por la misma;
3. una negativa se guardaba sin decir de que CLI venia, asi que cambiar de CLI
   no la reintentaba;
4. el bucle de la pantalla se paraba si las primeras conversaciones se negaban;
5. la cuenta de «cuantas quedan» se hacia antes de trabajar, asi que el panel
   decia que no quedaba nada.

Decision. Todo camino de fondo cumple estas cuatro, y se prueba una por una:

- **el cursor solo avanza sobre lo que se ha leido ENTERO.** Si algo se recorta,
   se cuenta (`clipped`) y se enseña. Un presupuesto pensado para resumir no se
   reutiliza para extraer;
- **un fallo es de una conversacion, no de la tanda.** Se marca y las demas
   siguen;
- **una negativa pertenece al CLI que la dio.** Cambiar de CLI la reintenta, y
   hay un boton que fuerza el reintento. Nunca se cae sola al otro CLI: eso
   seria mandar a otro sitio el contenido que el primero rechazo;
- **lo que se enseña en pantalla se calcula DESPUES de trabajar**, con los
   mismos filtros que eligieron el trabajo.

Y la que las une: un fallo del trabajo de fondo **nunca** puede hacer perder un
turno de Daniel. `selectPendingForTurn` corre dentro de un `try`; si revienta,
el turno sale sin bloque de pendientes.

Corolario sobre los registros. El diagnostico escribia el motivo del fallo al
registro mientras el turno se guardaba de escribirlo. Ahora los dos caminos
apuntan lo mismo: `{leido, causa}`, sin texto de la boveda. Lo fija
`memory-diagnostics-log.test.ts` con un centinela.

## D-089 — el dato de un tercero no puede tumbar la pantalla

Fecha: 2026-09-15. Autor: Claude. Origen: Daniel pulso «Actualizar modelos» en
una conexion nueva y **Studio se quedo en negro**.

El error, capturado en su consola:

```
Uncaught ModelRegistryError: hay dos modelos con la id
"koboldcpp-llama-3.2-3b-instruct-q4_k_m"
    at new ModelRegistry -> buildRegistry -> ModelsPage -> renderWithHooks
```

AI Horde sirve `koboldcpp/llama-3.2-3b-instruct-q4_k_m` y
`koboldcpp/Llama-3.2-3B-Instruct-Q4_K_M`: dos modelos DISTINTOS que solo se
diferencian en las mayusculas. Al derivar el identificador interno se pasa a
minusculas, los dos colapsan, y el registro lanza. Como eso ocurre DENTRO del
render, se lleva por delante el arbol de React entero.

La revision encontro que la colision era la punta: en la misma funcion habia
**dos excepciones mas** con el mismo final —un nombre de mas de 64 caracteres y
uno que empieza por `_`, `.` o `-`—, y que el respaldo que ya existia para un
nombre sin letras estaba roto: buscaba el nombre en una lista que puede llevar
objetos, devolvia -1, y producia `model--1` para todos, o sea otra colision.

Decision, en cuatro capas y de fuera adentro:

1. **`buildCatalogForConnection` es TOTAL.** Es la frontera por la que entra el
   catalogo de un tercero, asi que es ahi donde el dato deja de poder hacer
   daño: nunca lanza, nunca emite dos identificadores iguales y nunca emite una
   definicion invalida. Contener solo en la pantalla dejaba la bomba puesta para
   los demas consumidores;
2. **el borde de disco valida en vez de creer**: `readCatalogSnapshot` ejecuta
   un esquema en lugar de un cast. Era el otro sitio por el que entraba un dato
   sin comprobar a una API que da por hecho que hay una cadena;
3. **el registro conserva su excepcion por defecto** y gana `onConflict: skip`.
   Un identificador repetido significa dos cosas distintas segun de donde venga
   el catalogo: en el escrito a mano es un fallo NUESTRO y tiene que oirse; en
   uno servido por una pasarela es un dato ajeno. Lo elige quien llama;
4. **y una barrera de React**, que es la unica parte estructural: no habia
   ninguna, asi que cualquier excepcion de cualquier pantalla dejaba Luxy en
   negro. Esta no era una bomba: eran todas.

La regla de los identificadores. El que no comparte su forma normalizada se
queda con ella tal cual —asi **no cambia ningun identificador que hoy funcione**
y los catalogos guardados siguen valiendo—. El que la comparte, no cabe en 64 o
se queda sin letras, recibe un sufijo derivado **del nombre y de la conexion**,
nunca de la posicion: un `-1`/`-2` por orden de llegada se reparte distinto en
cuanto la pasarela reordena su catalogo, y el esquema promete que el
identificador sobrevive. Lo de la conexion lo destapo la revision: sin ello las
cuatro conexiones de Daniel a AI Horde producian identificadores identicos y
**tres de cada cuatro modelos desaparecian sin aviso**.

Y el `apiModel` no se toca nunca, ni se recorta: es lo que viaja a la pasarela.
Si no cabe en el esquema sobra el modelo entero, porque un nombre recortado es
pedir un modelo que no existe.

## D-090 — la iniciativa de mandar una imagen sale del prompt y pasa al codigo

Fecha: 2026-09-15. Autor: Claude. Origen: dos imagenes seguidas que Daniel no
pidio, en la misma tarde.

La primera tras «Tu descansa, Lia». El prompt que se mando al generador pedia
«curled up in bed, eyes closed, peaceful expression»: **el modelo ilustro su
frase**. La segunda tras «Se mi pequeña gatita entonces». Ninguna costo dinero
—AI Horde es gratuito— pero cada una se llevo hasta 25 minutos de cola y el
cierre de la escena.

Lo raro es que el bloque lo prohibia con esas palabras: «un momento intenso,
una promesa o **un buen final de escena** NO cuentan». La medicion explico por
que no sirvio:

- **la prohibicion habia perdido el verbo.** Hasta `42146e1` era «si no te la
  han pedido, **no la mandes**». El arreglo de `D-086` la partio en dos, y el
  camino que SI puede generar se quedo con una descripcion sin ninguna orden.
  La frase con el verbo solo se imprimia en el camino que NO puede generar,
  donde no sirve de nada;
- lo que empuja a mandar ocupaba **2,79 veces** lo que frena;
- la ultima frase de decision era «si dudas, **manda una**», y se imprimia
  incluso sin ninguna imagen guardada, donde no hay ningun «cual» que elegir;
- el bloque habia crecido **16,7 veces en trece dias** y era **tres veces mas
  largo que todo lo que le dice quien es Lia y como comportarse junto**.

Decision. **Mas texto no arregla esto**: seria el tercer golpe del pendulo —el
bloque ya habia oscilado dos veces el mismo dia— y la instruccion que se salto
describia su caso palabra por palabra. La decision sale del prompt:

1. **una puerta en codigo, ANTES de llamar al modelo**, que decide si en este
   turno se le OFRECE generar. Antes y no despues: vetar el bloque despues
   significaria que Lia ya dijo «toma, mirame» y la foto no llega nunca, que es
   la tercera forma de fallar que el propio bloque prohibe;
2. **es TEMATICA, no gramatical**, y esa es la diferencia con `D-085`: alli
   «hablamos» salia en cualquier turno y habia que leer la construccion; aqui no
   se puede pedir una foto sin nombrarla. Alto alcance y baja precision a
   proposito: no sustituye al prompt, le quita los turnos en los que el tema
   nunca salio;
3. **el camino de reenviar no se toca nunca**: es gratis e inmediato;
4. y el camino cerrado, que ya existia, **recupera la frase con el verbo** y se
   salta las instrucciones de como escribir el prompt: 5.789 -> 2.195
   caracteres. Un solo booleano devuelve el freno y adelgaza el turno.

El riesgo que esto introduce es el contrario, y es peor: que Daniel pida una
foto y no le llegue. **La primera version lo tenia, y medido: 36 de 90 formas
reales de pedir una foto cerraban la puerta** —incluidas «te hago una» y «te
saco una», o sea `D-086` roto, y 16 de cada 30 formas de aceptar una que ella
ofrecia—. De ahi la regla de trabajo: **el lexico solo se amplia cuando falla
una frase que tenia que ABRIR, nunca al reves**, y ninguna frase del fixture se
retoca para que pase.

Cuando la puerta se equivoca, degrada bien: Lia dice que ahora no puede mandar
una nueva, Daniel lo pide nombrandolo y al turno siguiente se abre. El fallo
contrario —prometer una foto que no llega— no se recupera.

Pendiente y dicho: el diagnostico en cifras que cruzaria cada mensaje real con
las generaciones de la boveda. Es lo que mediria cuantas de las 21 generaciones
reales habria cerrado la puerta, antes de fiarse de ella.

## D-091 — el filtro del Horde puntua la IMAGEN, no el texto; y una causa no se deduce

Fecha: 2026-09-16. Autor: Claude. **Reescrita entera el mismo dia**: la primera version
de esta decision afirmaba una causa falsa. Lo que sigue esta verificado contra el codigo
publico de Haidra-Org y contra este repositorio; lo anterior no lo estaba.

**Confirmada el 2026-09-17** por la via que ella misma dejo escrita: ver «La
prediccion se cumplio» mas abajo.

### Lo que se retiro, y por que

La version del commit `bc0a557` decia que el filtro anti-CSAM del Horde era una expresion
regular sobre el texto del prompt entero, que **nuestro propio negativo** —`child, loli,
underage, minor...`— aportaba el contexto de edad que lo hacia saltar, y que por encima de
1.000 caracteres bloqueaba en vez de sustituir. **Las cuatro afirmaciones centrales eran
falsas.** Las tumbo un analisis con veinticuatro agentes despues de que Daniel dijera lo
unico que hacia falta: «exactamente el mismo prompt, otra vez denegada».

- **Hay dos filtros, no uno.** El que devuelve `censorship: csam` puntua la **imagen ya
  dibujada**, en el worker (`safety_process.py:206-231`). No mira el texto al encolar.
- **La regex del servidor descarta el negativo antes de mirarlo**
  (`horde/detection.py:128-130`). O sea que el filtro de texto **ni siquiera lee** el campo
  al que se culpo.
- **La cronologia desmiente la culpa del negativo**: esas palabras no estaban en los dos
  primeros bloqueos —el bloque las introdujo el asistente DESPUES del primero— y **si
  estaban en una generacion que salio bien**. Ademas, en el repositorio no existe ninguna
  lista negativa con terminos de menores: el unico commit que los mete en un archivo
  versionado es el propio `bc0a557`, o sea esta decision.
- **El umbral de 1.000 caracteres no existe.** El limite vivo en el codigo del Horde es
  `len(prompt) <= 7000`, excluye el negativo, y pasarse lanza un error de longitud, no un
  bloqueo por contenido (`horde/detection.py:294-299`). El 1.000 salia de una FAQ desfasada
  (`FAQ.md:150-152`) y, muy probablemente, del limite del proveedor de pago
  (`xavira.ts:346-347`). Hay prompts reales de 1.108 y 1.230 caracteres generados sin
  incidencia el 2026-09-09.

### Lo que explica de verdad la inconsistencia

Si el veredicto lo dicta un clasificador que puntua **la imagen generada**, el mismo texto
puede dar veredictos distintos sin ninguna contradiccion: la entrada del clasificador no es
la cadena, es un mapa de pixeles que cambia con la semilla efectiva, el modelo, el sampler,
la maquina y la version del comprobador. Una regex no puede dar dos veredictos sobre la
misma cadena; un clasificador con umbrales, y una puntuacion cerca del umbral, si.

Encaja con lo que el propio autor del filtro documenta: **da falsos positivos con estilo
anime**. No hace falta que lo dibujado se parezca a nada para que salte.

**Prediccion comprobable**, que es como habria que haber presentado esto desde el principio:
si es cierto, un bloqueo llega DESPUES de una ronda completa de sondeos, con worker
asignado. Si el veredicto fuera sobre el texto, llegaria en segundos, como HTTP 400 con
`rc: CorruptPrompt`, sin pasar por la cola.

### La prediccion se cumplio — 2026-09-17

**Comprobado, una vez.** Daniel paso la tarde generando y uno de los intentos
volvio bloqueado. No llego en segundos: **tardo la cola entera** —ronda completa
de sondeos, con worker asignado— y solo despues devolvio `csam`. Era exactamente
la forma que esta decision escribio como falsable el dia anterior. Si el veredicto
fuera sobre el texto, habria llegado al encolar, como HTTP 400 con
`rc: CorruptPrompt`, sin pasar por la cola. No paso eso.

Lo confirma ademas el codigo del propio transporte, ahora que se lee con cuidado:
cuando `assertNotCensored` levanta el bloqueo, **la generacion completa ya esta
dentro del estado** —worker, id del worker, modelo y semilla—, asi que hubo imagen
antes que veredicto. Es el mismo hecho por dos vias independientes: el reloj y la
forma de la respuesta.

**Lo que encaja, con la etiqueta que le corresponde.** En esa misma tarde,
**cuatro peticiones mas explicitas pasaron y una menos explicita fue bloqueada**.
Esto **no es evidencia instrumentada**: es lo que Daniel recuerda de lo que vio en
pantalla generando. No hay en el repositorio los prompts, ni las semillas, ni los
`rc` de esas cinco peticiones —precisamente porque el hueco de instrumentacion que
cierra esta decision estaba abierto—, asi que no se puede repasar ni reproducir.
Se deja escrito porque encaja con la hipotesis: con un filtro de texto seria una
contradiccion que obliga a inventar una regla —y eso es justo lo que se invento
tres veces—, y con un clasificador que puntua pixeles no hay nada que explicar.
Pero **encajar no es confirmar**: lo que confirma la prediccion es el reloj del
bloqueo, y eso es una via, no dos. La version del 2026-09-17 de esta decision lo
presentaba como segunda pata de la confirmacion; corregido en la madrugada
siguiente. Lo que si es observable en pantalla, y por eso se sostiene, es que el
bloqueo llego **con worker asignado y despues de la cola**.

**El matiz que importa para el metodo, y es el motivo de escribir esto aqui.** La
hipotesis que acaba de confirmarse **no salio de mirar sintomas y deducir una
causa**. De esas hubo tres el mismo dia —el negativo, los 1.000 caracteres, la
combinacion de `petite` con lo explicito— y **las tres eran falsas**. Salio de
**leer el codigo del servicio**: `safety_process.py`, `detection.py`, la version
desplegada. La diferencia no es de suerte ni de cuidado: es que una deduccion
sobre un tercero produce una historia verosimil y una lectura de su codigo produce
una prediccion que se puede tumbar. Las tres deducciones no dejaron nada
comprobable; esta dejo una frase con reloj, y el reloj la confirmo.

### Lo que se sostiene de la version anterior

- El **hecho estructural** de que el negativo viaja dentro del campo `prompt`, detras de
  ` ### ` (`vault-image-provider.ts:292-296`, `horde.ts:570-573`). Es cierto; lo que era
  falso es la consecuencia que se le colgo.
- **El apartado del error de metodo, entero**, que el desenlace refuerza en vez de
  debilitar. Aquella version ya escribio «un filtro remoto que rechaza tres veces dice que
  hay una regla, no dice cual», y acto seguido dedujo cual. **El mismo error se repitio dos
  veces mas el mismo dia**: se le dijo a Daniel que el bloqueo venia de los 1.000
  caracteres, y luego que lo disparaba la combinacion de `petite` con lo explicito. Ninguna
  de las dos estaba comprobada.
- **No se ayuda a evadir el filtro anti-CSAM.** Esto no cambia, y ahora ademas es mas facil
  de sostener: si el veredicto es sobre la imagen, no hay redaccion que «arreglar».

### Lo que se retira como consejo practico

«No se ponen palabras de menores en el negativo» **no lo sostiene el codigo**: de ese campo
el comprobador del worker solo lee terminos que NIEGAN la adultez (`mature`, `old`, `adult`,
`elderly`, `middle aged`), que bajan sus umbrales. Poner `child` en el negativo no hace
saltar nada.

### El hueco de instrumentacion, que es lo unico accionable

Luxy **ya distingue** `csam` de `censored` (`assertNotCensored`, en `horde.ts`) y significan
cosas opuestas: el segundo es un worker con censura propia y su propia pista dice que se
repita para que lo coja otro. Pero el `catch` de la generacion en `handlers.ts` **aplana los
dos** en un `VaultError` generico, y `toResult` (`horde.ts`) tiraba el worker. Resultado:
**un bloqueo no deja rastro de cual de los dos fue**, y por eso hubo que reconstruir tres
semanas de sintomas a mano.

Relacionado y tambien roto: el mapa de errores por `rc` —`describeError`, en `horde.ts`— no
tiene entrada para un rechazo de contenido, asi que un 400 o un 403 del Horde cae en el caso
por defecto, y de ahi la pista sale de `hintForStatus`. Con **403** (y con 401) esa pista es
«comprueba la clave en Conexiones», que ante un rechazo de contenido es **falsa**; con 400
no hay pista ninguna.

> **Las citas de este apartado eran por numero de linea y todas se habian quedado atras**
> —`horde.ts:686-711` cae hoy en `assertSourceImage`, `horde.ts:365-409` en unas interfaces,
> `horde.ts:292-307` en el esquema de usuario y `handlers.ts:3146` en otra cosa—, porque los
> dos archivos han crecido desde que se escribieron. Sustituidas por nombres de funcion el
> 2026-09-17 (madrugada), que es lo que no se mueve al crecer un archivo. En la misma
> revision se comprobo leyendo el codigo que la pista falsa la da el **403**, no el 400: la
> version anterior metia los dos en el mismo saco.

**El hueco se cierra el 2026-09-17.** `HordeError` gana un quinto campo,
`attribution` —worker, id del worker, modelo y semilla—, que `assertNotCensored`
rellena en sus **dos** errores, el `csam` de la red y el `censored` del worker; el
intento cifrado guarda esos cuatro datos tambien cuando falla, y un campo
`attribution` (`reported` / `absent` / `null`) separa tres silencios que antes se
escribian igual: el proveedor contesto y el hueco es suyo, se miro y no habia
nada, o nadie lo apunto. La pantalla dice las tres cosas con palabras —«no lo
dijo», «no lo hubo», «no se apuntó»— en vez de un guion.

**El camino del vencimiento escribe `null`**, es decir «no se apunto»: el sondeo va
por `check`, que solo devuelve contadores, y el worker y la semilla los trae
`status`, al que solo se llama cuando la peticion termina. No hay «ultimo
conocido» que guardar. Lo que **no** se puede decir es que esa ausencia signifique
que no hubo generacion: el propio sondeo mira `processing`, y un valor mayor que
cero dice que un worker la tenia en las manos, asi que una cola que vence pudo
tener imagen detras. Quien decide como se lee un rastro vacio es quien apunta el
intento, y por eso el helper que lo escribe exige que se le diga.

> Escrito el 2026-09-17 de madrugada, corrigiendo dos frases de la version de la
> noche anterior: decia que ese camino se quedaba «a proposito **sin
> atribucion**» —escribia `absent`, que es una atribucion y significa otra cosa— y
> remataba con «la peticion no llego a producir generacion», que no se puede
> saber y que el `processing` del propio sondeo desmiente. El codigo se arreglo en
> la misma pasada; esto solo pone al dia lo que la decision afirma.

La conclusion operativa, y la unica solida: **un bloqueo suelto del Horde no es informacion
fiable sobre lo que se dibujo.**

## D-092 — el texto que sale hacia el generador deja de ser invisible

Fecha: 2026-09-16. Autor: Claude. Origen: tres semanas de imagenes rechazadas,
encuadres perdidos y «el mismo prompt» que no era el mismo, todas con la misma
raiz: **el prompt de imagen lo redacta el modelo en cada turno y el usuario no lo
ve nunca**. Sin ese texto no se puede diagnosticar nada, y `D-091` es la factura
de intentarlo a ciegas.

### La decision

El turno **termina sin generar** y deja un «plan de imagen» pendiente: el texto
exacto que saldria —positivo, negativo, parametros, semilla y los rasgos que el
recorte automatico borro—, calculado por una funcion pura
(`vault-image-plan.ts`) que es **la misma que consume el envio**. El usuario lo ve,
lo corrige si quiere y pulsa Generar o Descartar.

Lo que NO se hizo, y es la parte que importa del diseno: **no se pausa el turno**.
Pausar obligaria a mantener abierta la promesa del envio, con sus tiempos muertos
y su ventana colgada. El turno se PARTE: la respuesta se guarda entera y la imagen
queda pendiente en un registro cifrado, asi que sobrevive a cerrar Studio.

Tres reglas que salieron de la revision y conviene no deshacer:

1. **UNA sola entrada al transporte.** `planToHordeRequest(plan)` es la unica
   funcion que construye una peticion para el Horde. Antes habia dos caminos que
   componian texto y podian divergir sin que nadie se enterara.
2. **El intento se apunta pase lo que pase**, tambien cuando falla o lo censuran.
   Se guarda el `rc` del Horde —que distingue `csam` de `censored`, cosas
   opuestas—, los avisos del envio, la semilla real y el worker. Todo eso se tiraba.
3. **En el camino `pending`, el registro es el PERMISO, no la contabilidad.** Si el
   almacen falla al apuntar un pendiente, se lanza: lo contrario deja una tarjeta
   prometiendo una imagen que no existe.

### Donde vive, y por que ahi

Los intentos van cifrados en `vault/image-attempts/<conversationId>.json`, con la
subclave de la **conversacion**, no la de identidad: el prompt de una escena es
texto verbatim de esa escena —contenido, no un resumen derivado como el catalogo o
`relation.json`—, asi que pertenece al mismo compartimento que sus turnos. Y se
borra con la conversacion, enganchado junto a los otros tres almacenes: si no, el
texto mas intimo del sistema sobreviviria cifrado y huerfano a un borrado.

### El interruptor

Es **por personaje**, no global ni por conversacion, y por defecto revisa. Quien no
lo quiera lo pone en «nunca» y el comportamiento vuelve a ser exactamente el de
antes: sin plan, sin panel y sin turno partido.

### Lo que esto NO arregla

No hace que el filtro del Horde acepte nada, y no es su proposito. Lo que hace es
que, cuando rechace, se sepa **que texto rechazo** — que es justo lo que no se
supo en las tres semanas que documenta `D-091`.

## D-093 — la interfaz no promete lo que no esta verificado

Fecha: 2026-09-17. Autor: Claude. Origen: Daniel pregunta por que su saldo de AI
Horde lleva semanas clavado en 25 si lleva meses compartiendo sus imagenes «a
cambio de kudos». La respuesta es que no estaba comprando nada, no estaba
vendiendo nada, y la promesa la habia escrito Luxy.

### Los tres hechos, verificados

1. **El servidor descarta la peticion de compartir, y lo hace desde 2023.** En
   `initiate_waiting_prompt` la cadena es `shared = self.args.shared` / anonimo →
   `True` / con imagen de partida → `False` / modelo beta de Stability → `True` /
   **`else: shared = False`**. Ese `else` final pisa todo lo anterior, incluido el
   forzado del anonimo. Entro el 2023-07-08 (commit `5bb8edc9`) y sigue en HEAD. La
   version del repositorio que se leyo (`HORDE_VERSION = "5.1.11"`) es exactamente
   la que responde `aihorde.net` en su heartbeat, asi que **es el codigo
   desplegado**, no una rama. Comprobado ademas en vivo: se pidio una generacion
   con `shared: true` y el Horde contesto «compartida: no».
2. **Compartir nunca fue un ingreso.** La propia API lo define como un
   **descuento de 2 kudos** sobre esa misma peticion —«This will also reduce your
   kudos consumption by 2»—, o sea una rebaja consumida en el acto. Y ese
   descuento tambien esta apagado: el codigo calcula `horde_tax = 3`, luego
   `if self.shared: horde_tax = 1`, y a continuacion lo pisa incondicionalmente con
   `horde_tax = 1  # FIXME: hlky meltdown disabled sharing`. Comprobado en vivo
   pidiendo dos presupuestos identicos, con y sin compartir: **el mismo precio, 8
   kudos**. Refuerzo contable: `/v2/find_user` reparte el historico en ocho
   casillas con nombre y **ninguna** corresponde a compartir lo generado.
3. **25 no es un saldo, es un suelo.** `get_min_kudos()` devuelve -50 para el
   anonimo, 14 para un registro con usuario y contraseña y 25 para uno por OAuth;
   `ensure_kudos_positive()` sube la cuenta a ese minimo despues de cada cobro. O
   sea: generar **siempre** se cobra, y lo que hundiria la cuenta por debajo del
   suelo se perdona. El cargo crudo si queda apuntado en la casilla `accumulated`,
   que no se recorta. Un saldo quieto en 25 no es «no me cobran»: es el suelo.

### De donde salio la promesa

De una conversacion. El comentario de la prueba lo deja por escrito: Daniel dijo
«la idea es ganar kudos, me da igual que se comparta la foto de Lia», y de ahi el
codigo paso a **afirmar como hecho tecnico** que «compartir da kudos […] es la
unica forma de acortar la espera sin poner dinero ni una GPU»
(`Vault.tsx`, comentario sobre la casilla), y la pantalla a prometerlo:
«Donar sus imagenes a AI Horde a cambio de kudos» y «A cambio ganas kudos, que
son tu puesto en la cola».

Ninguna fuente del Horde respalda eso. Las pruebas de ese bloque comprueban que el
valor **viaja** —por defecto false, se activa, llega a la peticion—; ninguna
comprueba que produzca kudos, porque eso no se puede probar sin red. Y el resto
del repositorio nunca lo dijo: ni el glosario ni la seccion de Kudos de
`docs/IMAGENES-GRATIS.md` prometian nada por compartir. **La unica fuente de la
promesa en todo el proyecto era la casilla.**

Es el mismo patron de `D-091` —deducir el funcionamiento de un servicio ajeno a
partir de sintomas o de una conversacion, y escribirlo como si estuviera
comprobado— pero un escalon peor: `D-091` vivia en un documento, y esto vivia **en
la pantalla**, pidiendo ceder contenido intimo a cambio de algo que no existe.

### Lo que se cambia

- **La casilla se queda, su texto no.** Quitar la opcion seria perder funcion si
  el mecanismo vuelve; lo que se retira es la promesa. La etiqueta pasa a «Donar
  sus imagenes a AI Horde (hoy el servidor casi siempre lo ignora)» y la ayuda
  dice las tres cosas verificadas: que el servidor descarta la peticion en todos
  los modelos menos uno de Stability —la unica excepcion de ese `else`, y Luxy
  deja elegir modelo—, que no da kudos y nunca los dio, y que lo que se
  cederia —si volviera— seria la imagen **y el texto completo de lo que se
  pidio**, sin que se haya encontrado forma de retirarlo despues. Lo ultimo se
  dice asi y no «no hay forma de retirarlo»: es una ausencia declarada sin
  comprobar, y no se prueba leyendo un archivo suelto.
- **Lo que el servidor dijo que hizo se guarda y se enseña.** El adaptador ya leia
  el campo `shared` de la respuesta y lo tiraba; ahora viaja hasta el intento
  cifrado como `sharedByServer` (`null` = el estado no lo trajo, que **no** es lo
  mismo que «no la compartio») y el registro lleva los dos al lado:
  `compartidaPedida` y `compartidaSegunElServidor`.
- **El desglose de kudos deja de tirarse.** Es la misma llamada de siempre; lo que
  faltaba era no descartar `kudos_details`. La pantalla enseña por donde ha entrado
  cada kudos y explica el suelo.
- **El tipo de cuenta se LEE, no se deduce del saldo.** Era el arreglo de fondo, y
  llego despues: la pantalla decidia que la cuenta era de OAuth **porque el saldo
  marcaba 25**, que es razonar del sintoma a la causa —lo mismo que esta decision
  existe para no repetir—. `/v2/find_user` ya traia el dato y se tiraba. Ahora
  `pseudonymous` viaja desde el adaptador hasta el renderer por el mismo camino que
  `kudos_details`, y el minimo solo se afirma cuando el tipo viene declarado: `true`
  → 14, «una cuenta de usuario y contraseña»; `false` → 25, «una cuenta registrada
  con un servicio externo». Con `null` no se afirma minimo; si hay algo observado
  —un `accumulated` negativo con el saldo quieto— se describe eso y se dice que no
  esta comprobado. Ningun valor por defecto en toda la cadena: lo que no llega se
  queda en `null`, que se lee «no se sabe», y no en `false`, que afirmaria un tipo
  de cuenta que nadie ha mirado. **Los dos campos se comprobaron contra el swagger
  vivo antes de escribir una linea**, y el segundo no era lo que se suponia:
  `service` es «This is a service account used by a horde proxy», no el proveedor de
  OAuth. Viaja igual, por completitud, con esa cita escrita en los tres archivos
  para que nadie lo use otra vez para nombrar Google, Discord o GitHub.
- **La documentacion se corrige**: `docs/IMAGENES-GRATIS.md` decia «Luxy pide
  siempre `shared: false`» —falso desde el 2026-09-09, cuando entro la casilla— y
  «registrarse ya te da algunos [kudos]» —falso siempre: fija un suelo—.

### La regla que queda

**Un texto de la pantalla que afirme como funciona un servicio ajeno necesita
fuente, igual que el codigo.** No basta con que lo diga el usuario, ni con que sea
verosimil, ni con que «se entiende asi». Si no hay fuente primaria —su codigo, su
contrato publicado o una comprobacion en vivo—, el texto describe **lo que se
observa** y dice que no esta comprobado, en vez de prometer.

Tres corolarios que salieron de este caso:

- **un cero afirma y un silencio no.** Si el servidor no manda un dato, la
  pantalla no escribe 0: `awarded: 0` significa «no ha entrado nada por esa
  casilla» y `awarded: null` no significa nada. Por eso el desglose conserva
  `null` en todas las casillas ausentes y no pinta lo que no vino;
- **una casilla afirma de su casilla, no del total.** `awarded` es «from things
  like rating images» y tiene ademas su propio endpoint `AwardKudos`, asi que no
  es «por valorar imagenes»; y las cinco casillas de entrada a cero no dicen que
  nunca haya entrado un kudos, porque lo que paga prestar la GPU cae en
  `accumulated`, que es «accumulated **or used**» y tampoco es solo gasto;
- **una afirmacion sobre un tercero lleva su fecha y su fuente**, porque caduca.
  La documentacion oficial del Horde sigue diciendo hoy que el anonimo comparte
  siempre, y su codigo dice lo contrario desde hace tres años: quien lea solo la
  documentacion concluye lo contrario de lo verificado.

### Lo mas instructivo: el arreglo planto siete afirmaciones de la misma clase

Esto es lo que de verdad hay que recordar de este episodio, y no la regla de
arriba. **El trabajo que quitaba una promesa sin fuente escribio, en el mismo
pase, siete afirmaciones nuevas del mismo tipo** —deducciones presentadas como
hechos—, y las cazo la **fase de revision**, no sus autores. Fueron estas:

1. **el suelo se deducia del numero del saldo.** La pantalla leia 25 y concluia
   «cuenta de OAuth», que es ir del sintoma a la causa. De ahi salia ademas
   nombrar «Google, Discord o GitHub», que **ningun campo de la respuesta dice**;
2. **`accumulated` etiquetado «Contador de gasto».** Su propio contrato lo define
   como «accumulated **or used**»: ahi cae tambien lo que paga prestar la GPU, asi
   que llamarlo gasto afirma de mas;
3. **«Nunca ha entrado un kudos…»**, dicho sobre las casillas de entrada a cero.
   Ni era «nunca» —los ingresos por GPU caen en `accumulated`— ni eran las que
   decia: el texto hablaba de cuatro casillas mientras el codigo sumaba cinco;
4. **la suma de las casillas presentes se presentaba como total**, aunque faltara
   alguna por no haberla mandado el servidor;
5. **cinco etiquetas que interpretaban su casilla en vez de describirla**:
   `awarded` como «por valorar imagenes» cuando tiene ademas su propio endpoint
   `AwardKudos`, `recurring` como «patrocinio mensual», `admin` como «regalos»,
   `styled` como «por estilos publicados» y `donated` como «a cuentas educativas»
   cuando el contrato dice «public goods accounts like education», donde la
   educacion es **un ejemplo**;
6. **«a un sitio del que no hay forma de retirar nada».** Esta es la peor:
   **el propio informe de la auditoria la declaraba expresamente no verificada**
   —«es una ausencia, y las ausencias no se prueban leyendo un archivo suelto»— y
   aun asi acabo escrita en la pantalla como un hecho;
7. **«AI Horde descarta esta peticion»**, sin la excepcion del modelo de Stability
   que el propio hallazgo ya tenia escrita, y que importa porque Luxy deja elegir
   modelo y no comprueba cual es al generar.

Y una contradiccion de remate: tres sitios contaban tres versiones distintas de lo
que pasa con la clave anonima —el aviso de la pantalla, la pista al guardar la
clave y el mensaje de error del handler—, cuando lo verificado es una sola cosa,
que la documentacion oficial dice A y el codigo desplegado hace B.

**La leccion no es «hay que verificar».** Eso ya estaba escrito, y estaba escrito
en esta misma decision, por los mismos autores, mientras escribian las siete. Es
que **el criterio se aplico al codigo que se corregia y no al que se escribia**: la
promesa ajena se midio contra la fuente primaria y el texto propio se dio por
bueno por venir del mismo trabajo que la habia desmontado. Y hizo falta **un
revisor con ese encargo explicito** para verlo; ninguna prueba lo habria cogido,
porque todas estaban en verde.

Consecuencia practica, que es la unica parte accionable: en un trabajo que corrige
una afirmacion sin respaldo, **el texto nuevo pasa por una revision aparte con ese
mandato**, hecha por quien no lo escribio. No es desconfianza: es que el autor
acaba de demostrar que sabe reconocer el defecto, y aun asi no lo ve en lo suyo.

### Lo que NO esta verificado, y no se da por bueno

Se enumera aqui porque omitir esto es exactamente lo que fallo en `D-091`:

1. **La cuenta de Daniel no se ha mirado.** Nadie ha usado su clave. El tipo de
   cuenta ya no se deduce del saldo —lo declara `pseudonymous`, «If true, this
   user has not registered using an oauth service»—, pero **ningun campo de la
   respuesta dice con que servicio**: nombrar Google, Discord o GitHub no tiene
   respaldo y se ha quitado. Que el suelo de su tipo sea 25 sale de
   `get_min_kudos()`, leido en esta auditoria. Lo confirma el pulsando «Ver mis
   kudos» y mirando el desglose nuevo.
2. **La prueba en vivo se hizo con la clave anonima**, no con una cuenta
   registrada. El codigo no distingue en esa linea y el anonimo es el caso mas
   favorable a compartir, asi que vale por mayoria de razon; en rigor no se ha
   repetido con cuenta propia.
3. **Por que se desactivo compartir, y si volvera.** El comentario dice «FIXME»,
   lo que sugiere provisional, pero lleva años; la linea que descarta el valor es
   anterior e independiente. No hay anuncio, ni changelog, ni issue.
4. **No se puede descartar desde fuera** que algun otro proceso del servidor lea
   el almacen normal. Lo verificado es que la ruta de donacion depende de ese
   interruptor y no se activa.
5. **Cuanto paga de verdad valorar imagenes** cuando el servicio funciona. Lo leido
   (5 por valoracion, 15 por la mejor) es lo que calcula el Horde antes de
   reenviar a un servicio externo cuyo codigo no es publico — y que el dia de la
   comprobacion respondia con error.
6. **El umbral que libera el deposito de un worker** lo fija una variable de
   configuracion del servidor. Si estuviera sin poner, la promocion automatica a
   «de confianza» estaria desactivada para todos. No es observable desde fuera.

A lo que se suma lo que no toca esta decision: el aviso `AnonymousKeySharesImage`
sigue diciendo que la clave anonima comparte aunque se pida lo contrario. Hoy eso
solo lo sostiene la documentacion oficial, no el codigo desplegado. **Queda
anotado, no arreglado**: retirar un aviso de privacidad pide su propia
comprobacion.

## D-094 — el encuadre dice desde donde se mira; la postura, como esta el cuerpo

Fecha: 2026-09-17. Autor: Claude. Origen: Daniel pasa la tarde generando imagenes
de su personaje y comparando prompts. De ahi salen siete arreglos, y de uno de
ellos sale esta decision, porque **la evidencia con la que se sostiene es de otra
clase** que la de las tres semanas anteriores.

### La prueba controlada, que es lo que hace que esto valga

Daniel fijo **la misma semilla y el mismo modelo** y genero cuatro variantes,
moviendo una cosa cada vez:

1. con pesos —numeros entre parentesis— y sin ellos;
2. con el negativo anti-retrato y sin el;
3. con las etiquetas de cara y sin ellas.

**Las cuatro salieron bien.** Eso no «sugiere»: descarta las tres sospechas de
golpe, y las descarta sin necesidad de entender por que fallaba la otra. Es lo
contrario del metodo que documenta `D-091`, donde tres causas se dedujeron mirando
sintomas y las tres eran falsas.

### Lo que quedo en pie

Comparando el prompt que fallaba con los cuatro que funcionaron, la diferencia que
sobrevivio es una sola: **al que fallaba le faltaba la postura del cuerpo**. Decia
desde donde se mira —«from behind»— y no decia como esta ella. El generador no
deja huecos: lo que no se escribe se lo inventa, y se lo invento; salio tumbada de
lado, con el encuadre correcto.

De ahi la regla, que es la decision propiamente dicha:

> **el encuadre y la postura son dos campos, no uno.** «from behind», «close-up» o
> «from above» dicen donde esta la camara. «on all fours», «lying face down»,
> «kneeling», «sitting» dicen donde esta el cuerpo. Un prompt que solo trae el
> primero deja el segundo al azar del modelo.

Vive donde tiene que vivir: **un bullet en el bloque de instrucciones**, en la
seccion COMO y justo detras del bullet del encuadre, porque quien redacta el
prompt de cada turno es el modelo y es a el a quien hay que decirselo. No es codigo
que componga texto, y por eso no se puede garantizar: se puede garantizar que la
instruccion llega.

### Lo que esto NO prueba, y conviene no leerlo de mas

- **Cuatro generaciones son cuatro generaciones.** Un personaje, un modelo, una
  tarde, y «salio bien» es el juicio de Daniel mirando la pantalla, no una medida.
  Lo que las cuatro sostienen con solidez es lo **negativo** —pesos, negativo
  anti-retrato y etiquetas de cara no eran la causa—, que es justo lo que una
  prueba controlada sostiene mejor.
- **No prueba que nombrar la postura arregle nada.** Prueba que su ausencia estaba
  en el unico caso que fallo. Que el modelo obedezca la postura cuando se la
  nombren es otra afirmacion, y esa **no esta comprobada**: las pruebas del
  repositorio fijan que la frase llega al prompt, nunca que el generador la siga.
  Lo comprueba Daniel en pantalla o no lo comprueba nadie.
- **El encuadre heredado es un caso aparte y mas debil todavia.** «Sigue igual»,
  «no te muevas», «quedate como estas»: a veces la foto siguiente conserva el
  encuadre y a veces lo pierde. Se ha visto **intermitente, no sistematico**, y no
  se ha aislado que frase lo conserva. Por eso el arreglo es una instruccion —que
  repita encuadre **y** postura, porque el que se pierde es el encuadre— y no una
  causa escrita como hecho.

### Por que se escribe como decision y no como entrada de registro

Porque lo que hay que conservar no es el bullet: es **la forma de la evidencia**.
Un prompt de imagen tiene media docena de variables acopladas y un modelo que
responde distinto a cada semilla; en ese terreno, mirar un fallo y nombrar un
culpable produce historias verosimiles y falsas —tres el mismo dia, `D-091`—,
mientras que fijar la semilla y mover una cosa cada vez produce descartes firmes
con cuatro generaciones. **Cuando vuelva a fallar una foto, lo primero no es
opinar: es fijar la semilla y variar una cosa.**

## D-095 — la orientacion de «desde detras» la pone el codigo cuando el modelo no la escribe

Fecha: 2026-09-17. Autor: Claude. Origen: el bullet de `D-094` se cumplio y no
bastaba, y el bullet que se le añadio despues no se cumplio.

> **REVOCADA el 2026-09-18 por `D-096`.** Doce generaciones con la misma semilla
> demostraron que `ass to camera` y `back to camera` no mueven la camara: todo lo
> que esta decision construyo para ponerlas se ha borrado. Lo de abajo se
> conserva porque el metodo —medir frase a frase, cambiar la regla de vocabulario
> a forma— sigue siendo bueno; lo que fallo es que se midio el texto y nunca la
> imagen.
>
> **Se escribio el 2026-09-17 y se retiro el 2026-09-18.** En ese dia dio tiempo
> a 471 lineas de modulo, 251 de prueba y esta decision entera; medido sobre
> `git show HEAD` de los dos archivos borrados. El error no es nuevo, y es el
> mismo que esta documentacion lleva cuatro veces en tres dias corrigiendo:
> **razonar como deberia comportarse el generador en vez de medirlo.** La premisa
> —«`from behind` es ambiguo, hay que decir QUE parte va hacia el objetivo»— es
> impecable como razonamiento y falsa como hecho: `ass to camera` no hace nada.
> Lo que la sostenia eran cuatro generaciones en las que esa etiqueta aparecia
> junto a todo lo demas; nunca una prueba que moviera esa sola.

### Lo medido, tres veces con la misma conclusion

Daniel pide la foto de espaldas. El modelo escribe `from behind` y la imagen sale
de frente o de tres cuartos. **El generador no desobedece**: `from behind` dice
DONDE ESTA LA CAMARA, no QUE PARTE del cuerpo va hacia el objetivo, y se cumple
igual girando a la persona —la camara sigue detras—. Los cuatro prompts que si
salieron de espaldas llevaban `ass to camera`.

El 2026-09-17 a las 16:45 se añadio al bloque de instrucciones la regla que lo
explica con esas mismas palabras: «`from behind` tampoco basta: di QUE parte va
hacia el objetivo». **El modelo no la aplica**: tres prompts posteriores siguieron
saliendo con `from behind` a secas. La regla esta en el texto y no cambia nada.

### Decision

Es el patron de `D-090` y el del recorte de rasgos, y se responde igual: **cuando
una instruccion se comprueba incumplida, la decision pasa del prompt al codigo.**
El bloque **no se toca** —la regla se queda donde esta—: el codigo no la
sustituye, la respalda para los turnos en los que el modelo no la siga.

Lo que se añade es `disambiguateOrientation`, funcion PURA en
`packages/shared/src/vault-image-orientation.ts`, aplicada en
`composeHordeImagePlan` —donde se compone el plan, no en el transporte— para que
el panel lo enseñe antes de gastar nada en generar.

### El matiz que define el alcance, y que es la mitad de la decision

**No añade un encuadre que nadie pidio: DESAMBIGUA el que ya se pidio.** De ahi
las tres puertas, en este orden:

1. sin «desde detras» en la escena —`from behind`, `from the back`, `rear view`,
   `back view`, `from the rear`, `rear angle`— el codigo no tiene nada que decir.
   **Y tenerlo escrito tampoco basta**: esas mismas palabras son la luz («backlit
   from behind»), una preposicion con objeto («from behind the curtain»), contacto
   («he kisses her neck from behind») o un sitio («from a back room»), y en todas
   la camara puede estar de frente. Lo que las separa no es el vocabulario sino la
   FORMA: en ninguna de ellas el disparador va suelto, y cuando de verdad pide el
   encuadre si —«from behind, on all fours, …»—. Asi que la puerta exige que sea un
   **elemento entero**, entre separadores, y nada mas;
2. si la escena YA dice que mira al objetivo —`looking at viewer`, `facing the
   camera`, `front view`, `eye contact`, `smiles at the camera`…— no se toca nada,
   diga lo que diga el resto: añadir la etiqueta ahi es mandar dos ordenes
   opuestas en el mismo prompt;
3. si la escena YA dice que parte va al objetivo —`ass to camera`, `back to
   camera`, `facing away`, `face down`, `back turned`, `ass focus`…— tampoco:
   repetirlo le restaria peso al resto. El articulo no cuenta: `back to the
   camera` es lo mismo que `back to camera`, y se normaliza al comparar en vez de
   alargar la lista con cada variante;
4. y solo entonces elige, **segun la postura que la propia escena declara**: con
   una que deja el trasero hacia atras —`on all fours`, `bent over`, `hands and
   knees`, `ass up`, `crawling`— la lectura correcta es `ass to camera`; de pie,
   sentada, tumbada o arrodillada, es `back to camera`.

`looking back` **no** cuenta como orientacion, y es deliberado: dice donde queda
la cara, no hacia donde va el cuerpo, y el prompt que fallo tres veces lo llevaba.
`arched back` se quedo fuera de las posturas por lo contrario: tambien se escribe
de pie y boca arriba, y ahi la etiqueta sexual seria inventada. **La regla de
trabajo es la misma que la de la puerta de `D-090`: la lista de posturas solo se
amplia cuando falla una escena real que tenia que dar `ass to camera`, nunca al
reves.** Cuando ninguna casa gana la neutra, que nunca sobra. Por ese mismo liston
salieron despues `kneeling`, `on her knees`, `on his knees`, `leaning over` y
`leaning forward`, que la primera version tenia dentro sin cumplirlo.

La etiqueta va **pegada al disparador**, no al final: el orden pesa —el propio
bloque lo dice— y asi queda con la forma exacta de los prompts que funcionaron.

### Se ve en el panel, y se puede quitar

`added` es el gemelo exacto de `dropped`, y existe por lo mismo: **un cambio
automatico que no se ve es un cambio que no se puede discutir.** El panel enseña
lo añadido con su explicacion y un boton que lo quita —`removeAddedFragment`,
gemelo de `restoreDroppedFragment`—. Solo para el horde: en el proveedor de pago
la identidad la guarda su servidor y este arreglo no le corresponde.

### Lo que esto NO prueba

- que la etiqueta llegue al prompt esta comprobado por las pruebas; **que el
  generador la obedezca, no**. Lo comprueba Daniel en pantalla o no lo comprueba
  nadie. Lo que sostiene la eleccion del lexico son los cuatro prompts que
  salieron de espaldas, y cuatro generaciones son cuatro generaciones (`D-094`);
- la clasificacion es lexica y por tanto tosca, y **falla en las dos
  direcciones**: una escena en prosa rara puede caer en la neutra teniendo el
  trasero hacia atras, y una postura escrita con las palabras de la lista puede
  ganar `ass to camera` sin que la escena lo pida. Lo unico que sostiene el
  segundo lado es el liston de la lista de posturas —dentro solo lo que no admite
  otra lectura— y que lo añadido se ve en el panel y se quita de un clic.

### La correccion del 2026-09-17, y la frase que afirmaba de mas

La version anterior de este bullet decia que la funcion falla «hacia el lado
barato… **nunca** hacia inventar contenido que la escena no implica». **Se escribio
sin medirlo y era falsa.** Una revision la desmintio ejecutando la funcion:
«1girl, rear view, kneeling, indoors» salia con `ass to camera`, una etiqueta
sexual en una escena que no la implica, porque `kneeling`, `on her knees`, `on his
knees`, `leaning over` y `leaning forward` estaban en la lista de posturas sin
cumplir el liston que el propio modulo se habia puesto con `arched back`. Es otra
vez el defecto que la revision de la madrugada dejo como leccion —documentacion
afirmando de mas—, y esta vez en la decision escrita el mismo dia.

La misma revision midio otros tres fallos, todos ejecutando la funcion:

- **`from behind` es la forma normal de escribir la LUZ** —y el bloque de
  instrucciones pide la luz en cada escena, asi que no era un caso raro—. En
  «1girl, backlit from behind, facing the camera, warm rim light» el codigo añadia
  `back to camera` al lado del `facing the camera` que ya estaba: dos ordenes
  opuestas. Igual con «light from behind, smiling at viewer», «she peeks from
  behind the curtain…», «he holds her from behind…» y «from the back of the
  room…»;
- **el articulo rompia la puerta 3**: «from behind, her back to the camera,
  standing» salia con «back to camera, her back to the camera», la misma orden
  dos veces;
- **el cartel del panel afirmaba** que solo aparece «con “from behind” en la
  escena y en ningun otro caso», que no era cierto ni antes —hay seis formas de
  pedirlo— ni ahora —tenerlo escrito ya no basta—.

Lo que se cambio entonces: dos comprobaciones del contexto del disparador con
listas de palabras (luz, verbos de sujetar, objetos), la puerta nueva de «ya mira
a camara», la normalizacion de articulos al comparar, las cinco posturas fuera, y
el comentario del panel reescrito.

### La segunda revision, y por que las listas se fueron enteras

Aquellas listas no aguantaron la siguiente medicion, y el dato es contundente: un
verificador escribio **35 frases de dormitorio en ingles sin mirar el codigo, y 22
ganaron un encuadre que nadie habia pedido**. Se escapaban `candlelight`,
`firelight`, `neon`; la luz nombrada a mas de tres palabras («the glow of the
fireplace from behind»); los verbos de contacto que faltaban (`kisses`, `presses`,
`spoons`); y «from a back room», porque la normalizacion de articulos se aplicaba
tambien DENTRO del disparador.

Era vocabulario cerrado contra lenguaje abierto, y esa carrera se pierde siempre.
La regla que la sustituye no es de vocabulario sino **de forma**: el disparador
tiene que ser un elemento entero entre separadores. Con eso caen las cuatro clases
de una vez y sobran las tres listas, que se borraron —85 lineas—.

El precio, declarado: **en prosa corrida no actua**, ni siquiera cuando la frase
pide el encuadre de verdad («seen from behind» suelto). Es `D-085` otra vez,
precision antes que alcance, y aqui la asimetria es clara: pasarse cuesta una
generacion con dos ordenes opuestas, y quedarse corto deja las cosas como ya
estaban.

Cada caso medido tiene su prueba con la frase exacta en
`vault-image-orientation.test.ts`, incluidas las diez que NO se pueden tocar.


## D-096 — el modelo obedece lo que puede dibujar, no donde se pone la camara

Fecha: 2026-09-18. Autor: Claude. Origen: doce generaciones reales de Daniel con
la semilla `1080257389` y el modelo WAI-ANI-NSFW-PONYXL. **Revoca `D-095`.**

### Lo medido

Se pedia la foto de espaldas, a cuatro patas. **Ninguna de estas etiquetas lo
consiguio por si sola**, ni con pesos: `from behind`, `ass to camera`,
`back to camera`, `top-down bottom-up`, `presenting`, `rear view`. Tampoco
cambio nada el orden de las etiquetas, ni el prompt negativo, ni quitar las
etiquetas faciales de la receta.

Dicho con precision, porque la tabla de abajo lo matiza: los prompts que SI
salieron de espaldas llevaban varias de ellas a la vez, pero llevaban ademas
`pussy`, y al aislarla resulto ser la unica que hacia falta. Lo que esta
medido es que ninguna de las seis, sola, mueve la camara, y que `pussy`, sola,
la mueve.

Lo consiguio `pussy`, aislada hasta quedarse sola. Lo que quedo anotado de las
doce, combinacion a combinacion:

| Etiquetas de la prueba               | Como salio  |
| ------------------------------------ | ----------- |
| las cinco de refuerzo juntas         | de espaldas |
| ninguna                              | de frente   |
| solo `presenting`                    | de frente   |
| `spread legs` + `pussy` + `close-up` | de espaldas |
| **solo `pussy`**                     | de espaldas |

La fila de abajo es la que decide, y la tercera es la que descarta el atajo
facil: `presenting` sola no basta, asi que no vale con nombrar cualquier cosa
sugerente. `arched back` quedo descartada por no estar en un prompt que si
funciono.

### Las seis hipotesis que se cayeron, que valen tanto como la conclusion

Antes de dar con `pussy` se probaron seis explicaciones de por que la camara no
obedecia. Ninguna la movio. Quedan escritas para que nadie vuelva a pagarlas:

1. **los pesos.** Subirle el peso a la etiqueta de encuadre no la hace obedecer;
2. **el prompt negativo.** Cambiarlo no cambio el encuadre;
3. **las etiquetas faciales de la receta.** Se quitaron por si competian con el
   encuadre: la imagen siguio saliendo igual;
4. **el orden de las etiquetas.** Poner la de encuadre delante —que es lo que el
   propio bloque de instrucciones enseña— no cambio nada;
5. **el vocabulario.** Seis maneras de pedir lo mismo —`from behind`,
   `ass to camera`, `back to camera`, `top-down bottom-up`, `presenting`,
   `rear view`— y las seis fallaron, solas y juntas. El problema no era que la
   palabra fuese la equivocada: es que **ninguna palabra de esa clase sirve**, y
   eso es exactamente lo que `D-095` no podia ver mientras buscase la palabra
   buena;
6. **`looking back`.** `D-095` ya lo habia dejado fuera de su clasificacion por
   decir donde queda la cara y no hacia donde va el cuerpo. Las doce
   generaciones no lo midieron: `looking back` nunca se probo aislado, asi que
   de el solo se sabe que estaba en prompts que fallaron, no que fuera la causa.

Esas seis son el valor real de la tanda. La conclusion cabe en una linea y se
copia; el coste de llegar a ella son doce generaciones, y lo que evita repetirlas
es la lista de lo que **no** era.

### Por que, y la regla que sale de ahi

`pussy` no es una etiqueta de encuadre: es una **restriccion anatomica**. En esa
postura el genital solo se ve desde detras y desde abajo, asi que el modelo no
tiene otra forma de dibujarlo y la camara se coloca sola. No se le dice donde va
la camara — se le dice QUE TIENE QUE VERSE.

**La regla general: este modelo obedece lo que puede dibujar, no las
instrucciones sobre donde poner la camara. Para conseguir un angulo, se nombra
algo que solo se vea desde ese angulo.**

### El metodo, que es lo que por fin funciono

Las seis hipotesis de arriba comparten un camino: **añadir variables al prompt
que fallaba.** Seis intentos por ahi y ninguno dijo nada, y no es mala suerte —es
que un prompt que falla no señala cual de sus partes sobra—. Cada variante
añadia una variable mas a una receta que ya tenia muchas, y el resultado seguia
sin moverse.

Lo que aislo la causa fue el camino contrario: **quitar variables del prompt que
funcionaba.** Se partio de la receta que si salia de espaldas —`spread legs`,
`pussy`, `close-up`— y se fue adelgazando hasta quedarse con una sola etiqueta.
Tres pruebas por ese camino frente a seis por el primero, y solo el segundo dio
una respuesta.

**Cuando un prompt falla y otro funciona, se adelgaza el que funciona, no se
engorda el que falla.** Esa frase es la parte de esta decision que no depende del
generador: un exito del que se quitan piezas una a una acaba diciendo cual era la
que contaba, y un fallo al que se le añaden no dice nada nunca.

### Que se quita, y por que no basta con dejarlo ahi

`D-095` construyo un desambiguador —`vault-image-orientation.ts`, cuatro puertas,
33 pruebas— cuyo unico producto era añadir `ass to camera` o `back to camera`.
Las doce generaciones dicen que esas dos etiquetas no hacen nada. El modulo se
va entero, con su llamada en `composeHordeImagePlan`, su export, el campo
`added` del plan, `removeAddedFragment` y el cartel del panel.

Dejarlo puesto era **peor que no hacer nada**, y ese es el motivo de fondo: no
solo metia una etiqueta inutil en el prompt, sino que el panel le enseñaba a
Daniel un cartel explicandole que Luxy le habia resuelto el encuadre. Un aviso
que afirma resuelto un problema que sigue ahi cuesta mas que el silencio: es
`D-093` —la interfaz no promete lo que no esta verificado— aplicada a su propio
cartel.

### Lo que sobrevive de `D-095`, y no es poco

Tres cosas, y conviene no volver a aprenderlas:

1. **una instruccion en el prompt que se comprueba incumplida se lleva al
   codigo.** Sigue siendo cierto; lo que fallo aqui es que la instruccion que se
   llevo al codigo tampoco servia en el generador.
2. **medir antes de escribir la regla.** `D-095` se midio de verdad —35 frases
   de dormitorio, 22 falsos positivos, listas borradas— pero siempre sobre el
   TEXTO del prompt, nunca sobre la imagen que salia. Se verifico que la etiqueta
   llegara; no que sirviera. `CURRENT-TASK.md` lo decia con todas las letras en
   «lo que sigue sin comprobar», y ahi estaba la respuesta.
3. **el recorte (`dropped`) no se toca.** Ese si funciona y Daniel lo ha visto
   trabajar en pantalla. `added` cae; su gemelo se queda.

### Lo que quedaba pendiente, cerrado el mismo dia (`F29-POSTURA-004`)

El bloque de instrucciones de `vault-image-request.ts` seguia pidiendole al
modelo que escribiera «ass to camera» o «back to camera». Ya no: ese bullet se
fue, y en su hueco esta la regla de arriba —nombrar lo que solo se ve desde ese
angulo, que el generador coloca la camara al dibujarlo—.

Tres matices de como se aplico, porque marcan el limite de la decision:

- **el bloque no nombra ninguna etiqueta explicita concreta.** Enseña el
  principio y deja que la escena decida que se ve. La regla sale de `pussy`, pero
  escribirla ahi convertiria a Luxy en quien impone el contenido, y no lo es.
- **solo se tira lo demostrado falso.** De la tabla de equivalencias cayo el par
  «desde detras»/«el culo a camara» -> `from behind`. `close-up`, `full body`,
  `from above/below/the side` y `looking at viewer` se quedan: aparecen en
  prompts que funcionaron y **nunca se probaron aisladas**. No saber no es saber
  que falla; queda marcado como no sabido, en el comentario y en una prueba.
- **el guardian de 6.500 no se subio.** El texto nuevo lo pagaron el bullet
  borrado, el par de la tabla, el ejemplo del bullet del orden —que era ese mismo
  `from behind`— y una condensacion de la prohibicion de camaras. Margen final:
  22 caracteres.

### Hasta donde llega esto, que es menos de lo que parece

Doce generaciones, **una semilla** (`1080257389`) y **un modelo**
(WAI-ANI-NSFW-PONYXL). Eso es lo medido, y escribirlo aqui es la mitad del
trabajo de no repetir el fallo de `D-095`:

- **no esta comprobado que otro modelo se comporte igual.** La regla puede ser de
  esta familia de checkpoints, de los entrenados con etiquetas sueltas, o solo de
  este. Nadie lo ha probado fuera de el, y el codigo del generador no se lee
  desde aqui;
- **no esta comprobado que otra semilla de lo mismo.** Fijar la semilla es lo que
  hizo comparables las doce, y es tambien lo que impide saber cuanto de lo visto
  es de la semilla. Doce generaciones son doce generaciones, como cuatro eran
  cuatro en `D-094`;
- **el bloque de instrucciones, sin embargo, no lleva nada de esto dentro.** Lo
  que se escribio en `vault-image-request.ts` es el principio —nombra algo que
  solo se vea desde ese angulo—, no la etiqueta que lo demostro. Si el modelo
  cambia y el principio deja de valer, lo que hay que rehacer es un bullet, no
  un modulo. Esa es la diferencia con `D-095`, y es deliberada.

Si Daniel cambia de modelo de imagen, **esta decision no se hereda: se vuelve a
medir**, y por el camino de arriba —adelgazando lo que funcione—.

## D-097 — dibujar a los dos es del personaje, y hacen falta tres piezas a la vez

Fecha: 2026-09-21. Autor: Claude. Origen: Daniel pide poder ilustrar las escenas
en las que salen los dos. Se le avisa de que estos modelos encajan mal dos
figuras y aun asi lo quiere, **con un interruptor para apagarlo si sale mal**.

Estado: aceptada, implementada. **Ninguna imagen generada con ella todavia.**

### Por que dibujar solo al personaje era el comportamiento por defecto, y lo sigue siendo

No es una precaucion abstracta: detras hay una imagen concreta. `D-057`
(2026-09-02) la dejo escrita —una generacion real devolvio al personaje
correcto, con la pose correcta, **mas una segunda mujer que nadie habia pedido**
y una camara de fotos en la mano— y de ahi salieron las dos defensas que este
ajuste toca: el bloque de instrucciones prohibiendo nombrar a nadie mas, y el
prompt negativo prohibiendolo ademas en el unico sitio donde un generador
entiende un «no».

Ese fallo sigue siendo un fallo. Por eso el valor por defecto del ajuste es
`character-only`, que es exactamente lo que se venia haciendo, y por eso —esto
conviene leerlo dos veces— **`2girls` y `multiple girls` no se retiran nunca**:
la persona de mas que costo aquella imagen era una MUJER, y una mujer de mas
sigue sobrando aunque en la escena salgan los dos.

### Por que se abre de todas formas

Porque la escena es de Daniel y la decision de que se ilustra tambien. Hoy una
escena en la que salen los dos se dibuja recortada —solo el personaje, en plano
cercano— y eso no es un fallo que nadie haya visto: esta escrito a proposito en
el bloque de instrucciones desde `D-057`. Lo que pidio Daniel no es cambiar el
comportamiento, es poder cambiarlo el.

De ahi la forma exacta que tiene: **gemelo de `imageReview`**, por personaje
—con quien salga bien acompañado se deja encendido y con quien no, no—, apagado
por defecto y de una pulsacion. Un ajuste que no se puede deshacer en una
pulsacion no sirve para probar algo que puede salir mal.

Dos detalles de forma, que valen para el siguiente que añada uno:

- el campo se llama `imageCast` y sus valores van en ingles
  (`character-only` | `both`). `imageReview` guarda «siempre»/«nunca» en
  castellano, contra la regla de identificadores de `CLAUDE.md`; esa deuda queda
  donde esta y no se hereda;
- **verbo IPC propio** (`luxy:vault:character:image-cast`), no un «guardar
  personaje» generico. Un canal que solo puede cambiar una cosa no puede
  reescribirle por accidente la receta, el nombre ni el avatar.

### Las tres piezas, y por que cualquiera sola no sirve

Esto es el fondo de la decision. La primera es la unica que se ve leyendo el
bloque de instrucciones; las otras dos la anulan en silencio.

1. **La instruccion.** `buildVaultImageInstruction` cambia DOS frases, no una: la
   del caso 2 de CUANDO —«si salis los dos, o os la hace otra persona, generala
   solo contigo, en plano cercano y sin el» pasa a «describe la escena ENTERA,
   con los dos»— y el bullet de COMO, que es donde de verdad se prohibia nombrar
   al usuario. **Nombrarlo es lo unico que lo hace aparecer**, asi que con la
   primera frase sola el modelo seguiria escribiendo un prompt de una sola
   figura. La rama encendida le pide nombrarlo corto —«1boy», «a man»— y nada
   mas de el: su aspecto no esta en ninguna receta, y cada detalle inventado le
   quita peso a lo que si esta descrito.
2. **El negativo.** `2boys`, `multiple people` y `another person` prohiben
   literalmente lo que la instruccion acaba de pedir, y el generador obedece al
   negativo. Se retiran esas tres, solo esas, y solo en la escena que las
   contradice.
3. **El `solo` de la receta.** Es la pieza que se descubre escribiendo un prompt
   a mano y que es facil no ver nunca: en el vocabulario de etiquetas de estos
   modelos `solo` significa literalmente «una sola persona en la imagen», y vive
   en el texto de apariencia que escribio el usuario —donde casi todas las
   recetas lo ponen, porque hasta hoy era justo lo que se queria—. Nadie lo puso
   ahi para contradecir una escena, y las contradice todas.

Se quita del positivo **compuesto** —apariencia, ropa y escena ya recortada—, no
solo de la apariencia, para cazarlo venga de donde venga con una sola pasada. La
coincidencia es EXACTA sobre el elemento entre comas (`solo`, `solo focus`), asi
que «solo lit by the window» es escena y se queda. `1girl` no se toca nunca:
dice cuantas mujeres hay, y sigue siendo una.

### Dos puertas, no una

El ajuste dice que **se puede** dibujar a los dos; la escena dice si en **esa**
hacen falta los dos. Son condiciones distintas y se aplican en sitios distintos:

- el **bloque de instrucciones** depende solo del ajuste, porque se escribe antes
  de que exista la escena: es lo que le da permiso al modelo para escribirla;
- el **negativo** y el **recorte del `solo`** se relajan solo cuando la escena ya
  redactada nombra de verdad a la segunda figura (`sceneIncludesSecondFigure`).

Asi una foto del personaje a solas conserva todas sus defensas aunque el
interruptor este encendido, que es lo que evita reabrir el fallo de `D-057` en
cada foto normal.

La deteccion es una **lista cerrada de nombres de persona en ingles** —`1boy`,
`2boys`, `man`, `male`, `guy`, `hetero`, `multiple people`, `another person`...—
y **nunca pronombres**: «wearing his shirt» es una escena de ella sola, y con
`his` en la lista esa foto perderia sus defensas sin que salga nadie. Va con
frontera de palabra, para que «woman» no traiga un «man» que cuente, ni «female»
un «male», ni «heterochromia» un «hetero». Es la contrapartida exacta de lo que
el bloque encendido le pide escribir al modelo: lo que el escribe ahi es justo
lo que esto reconoce.

### Con el interruptor apagado no cambia nada, y como se comprobo

Era la condicion que mandaba sobre todo lo demas, porque es un personaje que
Daniel usa a diario.

- `VAULT_IMAGE_NEGATIVE` sigue siendo **el mismo string byte a byte**. Las tres
  etiquetas se extraen a una constante y se vuelven a intercalar en su sitio con
  un spread, asi que el orden no se mueve. Medido en esta pasada: el valor que
  devuelve el modulo compilado es identico a la lista literal que tiene `HEAD`;
- el bloque de instrucciones apagado ocupa lo mismo que antes: **6.474 (prosa) y
  6.478 (etiquetas)**, medidos en esta pasada con la misma entrada que usa el
  guardian de tamaño. Encendido ocupa **6.411 y 6.415**, o sea 63 caracteres
  MENOS, porque las dos redacciones son excluyentes y la nueva es mas corta. **El
  tope de 6.500 no se toca**, y el ajuste no puede romperlo;
- el recorte del `solo` no se ejecuta nunca con el ajuste apagado, y el parrafo
  del panel que lo explica solo se pinta si de verdad se quito uno.

### Lo que NO esta medido, y es la mitad de esta decision

**La calidad con dos figuras: MEDIDA mientras se escribia esto, y mejor de lo
que se esperaba.** Daniel genero dos imagenes a mano —pegando el prompt en el
panel, sin el interruptor— y las dos salieron limpias: anatomia correcta, el
personaje reconocible. El aviso de que «con dos figuras estos modelos fallan a
menudo la anatomia» era sabiduria recibida, y de momento no se sostiene con este
modelo. Se deja en la interfaz porque dos imagenes no son una medida, pero que
conste que las dos que hay salieron bien.

Lo que SIGUE sin estar probado es el camino automatico: que con el interruptor
encendido el modelo escriba de verdad la escena entera. Lo unico que fijan las
pruebas es que el texto que sale es el que se queria; que el generador obedezca
no lo fija ninguna, y esa leccion la pago `D-095` con un modulo entero.

Y una de esas dos generaciones dejo un dato para `D-096`: **`pov` tampoco
funciona**. Es la septima etiqueta de camara que falla, y cuando una de las dos
fotos si salio en punto de vista, lo que lo consiguio fueron las etiquetas de lo
que se veia, no la que nombraba el encuadre. La regla aguanta.

Tampoco esta medido lo contrario, y hay que decirlo igual de claro: el aviso que
lleva escrito el propio interruptor —«con dos figuras estos modelos fallan a
menudo la anatomia»— es sabiduria recibida sobre esta familia de modelos, no una
medicion hecha aqui. Por eso el texto de la pantalla no promete ningun
resultado: dice que hace el ajuste y dice que se apague si sale mal.

Y una tercera cosa sin medir, mas pequeña y facil de olvidar: **que quitar `solo`
cambie algo en la imagen**. Lo que se sabe es lo que la etiqueta significa en el
vocabulario de estos modelos; cuanto pesa frente al resto del prompt, no.

La comprobacion que vale es de Daniel y de su pantalla: encender el ajuste en un
personaje, pedir una escena en la que salgan los dos, mirar en el panel que el
texto nombra al otro y que ya no lleva `solo` ni las tres prohibiciones, y
generar. Si sale mal, apagarlo: para eso existe.

## D-098 — los cuatro parámetros de muestreo son opcionales y sin valor por defecto

Fecha: 2026-09-17. Autor: Claude. Anotada aquí el 2026-09-23. Contexto:
`F31-REPETICION-001`, commit `29f829d`.

Estado: aceptada, implementada. **Nada medido todavía con ella.**

Una conexión HTTP puede mandar ahora `temperature`, `frequencyPenalty`,
`presencePenalty` y `repetitionPenalty`. Los cuatro son **opcionales y ninguno
tiene defecto**, y eso es deliberado por dos motivos distintos:

1. **Compatibilidad.** Hay servidores que devuelven 400 ante un parámetro que no
   conocen. Una conexión que no los configure tiene que seguir mandando el mismo
   cuerpo de siempre, campo por campo. Hay una prueba que lo fija.
2. **Método.** Existen para poder MEDIR con y sin. Un valor «razonable» de
   fábrica dejaría sin nada contra lo que comparar, y el problema que se está
   persiguiendo —la misma promesa en 15 de 17 turnos— no se puede atribuir sin
   línea base.

Los rangos no son iguales y cada uno lleva su fuente en el esquema
(`packages/shared/src/schemas.ts:1003-1045`): 0..2 y -2..2 son los que documenta
OpenAI. De esos tres, las dos PENALIZACIONES (-2..2) son aditivas; `temperature`
(0..2) no es una penalización ni es aditiva, y decirlo junto fue una compresión
equivocada de esta decisión: el comentario del esquema lo dice bien.
`repetition_penalty` viene de Hugging Face, la implementan
vLLM, TGI, llama.cpp y OpenRouter, es multiplicativa sobre el logit, neutra en 1,
y varios servidores la rechazan si no es estrictamente mayor que 0. El techo de 2
no es del protocolo: es el límite de lo que se puede escribir sin que el texto se
vuelva incoherente.

**Consecuencia para quien herede esto:** rellenar los cuatro campos sin haber
medido antes no es «configurar bien», es tirar la única comparación disponible.

## D-099 — borrar la memoria propia borra en ESTE equipo, y hay que decirlo

Fecha: 2026-09-23. Autor: Claude. Contexto: los defectos de integridad del boton
«Borrar su memoria» (`vaultConversationMemoryForget`).

Estado: aceptada. **No se propaga. La consecuencia se dice en pantalla.**

El boton reescribe el `.jsonl` local dejando intacta la `sequence` de cada
registro. La subida a `/api/vault/records` es idempotente por (boveda,
conversacion, secuencia) -lo dice el comentario de `apps/desktop/src/main/vault/
sync.ts`-, asi que el registro que ya esta en el servidor conserva su sobre
`sealedMemory` y el borrado **no viaja**. Dos consecuencias reales:

1. en otro equipo ya sincronizado la memoria sigue entera y ella la sigue
   leyendo;
2. si el `.jsonl` local desaparece y se vuelve a sincronizar, la memoria vuelve
   con el resto de la conversacion.

**Por que no se propaga.** Haria falta un verbo nuevo en el gateway que MODIFIQUE
o retire un registro ya subido, y la sincronizacion entera se apoya en lo
contrario: «no hay resolucion de conflictos, y no hace falta» porque un turno es
inmutable y su identidad es (conversacion, secuencia). Abrir esa puerta para una
sola casilla pone en juego el historial de todos los equipos -un borrado mal
dirigido deja de ser recuperable desde ningun sitio- y arrastra migracion,
endpoint, autorizacion y despliegue, que en este proyecto no se hacen sin permiso
expreso. El coste es enorme y el beneficio, para un solo usuario con un equipo
principal, pequeño.

**Lo que si es obligatorio, entonces.** El dialogo y el acuse no pueden seguir
diciendo «Borrado» a secas: tienen que decir que borra **solo en este equipo**.
Una promesa que el codigo no cumple es peor que no tener boton, y aqui la funcion
entera existe para que ella deje de recordar algo. Esa redaccion es el paso
siguiente de este mismo trabajo; el alcance queda escrito en el comentario del
handler para que no se pierda.

**Si algun dia se quiere de verdad global**, el camino honesto no es un borrado
remoto de un registro: es subir un turno NUEVO -inmutable, como todos- que anule
la memoria anterior, y que `latestMemory` lo respete. Eso encaja con el diseño
que ya hay en vez de romperlo. No se hace hoy porque nadie lo ha pedido.

**Cumplido el 2026-09-23.** El dialogo dice «Y borra en este equipo: lo que ya se
habia sincronizado sigue en el servidor...» y el acuse termina en «Borrado en
este equipo...». El acuse se arma en `describeForgetAck`
(`apps/desktop/src/renderer/vault-recap-row.ts`), que es una funcion pura con
pruebas: una prueba fija que esa frase sale SIEMPRE, con ficha destapada o sin
ella. Estaba suelto en el JSX y ahi no lo comprobaba nadie.

## D-100 — borrar la memoria propia puede destapar la ficha: se avisa y se ofrece quitar las dos

Fecha: 2026-09-23. Autor: Claude. Contexto: los tres revisores adversariales del
boton «Borrar su memoria» dieron con lo mismo por separado.

Estado: aceptada.

`chooseConversationMemory` (`packages/shared/src/vault-recap.ts`) solo antepone la
memoria sellada. Mientras la hay, la ficha retroactiva de esa MISMA conversacion
es papel muerto; en cuanto se borra, vuelve a ser candidata y entra en el prompt
del turno siguiente. Con `source: 'index'` entra ademas sin aprobacion y sin
comprobar cobertura. O sea: alli borrar **no limpia**, cambia un texto por otro,
y el otro tambien habla de esa conversacion.

**La decision de fondo no cambia**: revivir la ficha es exactamente el estado
anterior al sellado y es defendible. Lo que no es defendible es callarlo. Se hace
lo unico que cierra el defecto de verdad, y son dos mitades:

1. **decirlo antes de pulsar.** La fila trae `cardRevivesOnForget`, calculado en
   `readRecapList` con la misma funcion que decide en el turno pero sin la
   sellada; `describeRecapRow` lo cruza con «¿hay boton?» en `forgetRevivesCard`,
   y la confirmacion añade un aviso propio cuando se da el caso. No se avisa de
   una consecuencia que no se puede provocar: sin boton no hay aviso;
2. **dar la salida.** El mismo dialogo ofrece «Si, borra las dos», que encadena
   los dos verbos que ya existian -primero `forget` de la ficha, despues la
   memoria propia-. Ese orden y no el otro: si falla el primer paso no se ha
   destruido nada y los botones siguen ahi; al reves quedaria la ficha viva
   junto a una memoria ya borrada, que es justo lo que el aviso promete evitar.
   Por eso `decideRecap` devuelve ahora un booleano.

**Por que no basta con avisar.** Avisar sin dar salida es lavarse las manos: el
caso que trajo todo este trabajo es una conversacion de prueba que Daniel queria
dejar de arrastrar, y dejarle un aviso de que va a seguir arrastrandola por otra
puerta no resuelve nada. Y por que no se borran las dos siempre: son dos textos
distintos con su propio boton, y tirar la ficha de alguien sin preguntar es el
error contrario.

## D-101 — una aprobacion de Daniel no se pierde en silencio

Fecha: 2026-09-23. Autor: Claude. Contexto: es el defecto 4 de la primera
revision, el unico de los trece que seguia sin tocar, y lo volvieron a marcar las
dos revisiones de la ultima vuelta. `D-099` y `D-100` no lo mencionaban.

Estado: aceptada.

**La cadena, verificada leyendo el codigo.** Borrar la memoria sellada de un hilo
llama a `clearSuperseded`, que pone `supersededAt: null`. Ese campo es el UNICO
filtro que sacaba esa conversacion de la cola del trabajo de fondo
(`recap-sync.ts`, `pending`). Asi que vuelve a la cola; si el CLI amplia su ficha,
`state.mutated` es cierto, no se cumple la rama que conserva `state.previous`
(`keepsPrevious`) y `entryOf` escribe una entrada NUEVA con `approved: false`. La
ficha deja de entrar en los prompts de ese hilo, y en pantalla eso se veia
exactamente igual que una ficha que nadie ha mirado nunca.

**Lo que NO se hace, y por que.**

- **conservar la aprobacion.** El texto es otro: meter en un prompt lo que Daniel
  no ha leido es justo lo que `approved` existe para impedir;
- **sacar esa conversacion de la cola.** Una ficha aprobada que no crece deja de
  cubrir la cola literal, y entonces el turno la descarta igual. Seria la misma
  perdida por otro camino, y ademas silenciosa para siempre;
- **avisar solo antes de borrar.** El disparador mas probable es el borrado, pero
  no es el unico: la pasada amplia fichas por su cuenta cuando la conversacion
  crece. Un aviso atado al boton dejaria fuera el resto de los casos.

**Lo que se hace, y son dos mitades.**

1. **el hecho se guarda.** `RecapEntry` gana `approvalReset`, que se estampa en
   `persistEntry` -el UNICO camino de escritura de la pasada, para que ninguna
   rama nueva se lo salte- cuando la entrada anterior estaba aprobada y la nueva
   no. La fila lo lleva hasta el panel, el estado pasa a decir «la aprobaste y se
   ha reescrito» en vez de «sin aprobar», y sale un aviso con el boton que la
   devuelve. «Aprobar» lo apaga: leerla otra vez y decidir es justo lo que
   cierra el asunto;
2. **y se dice antes de pulsar.** `forgetCostsApproval` marca la rama exacta en la
   que ocurre -ficha aprobada que todavia no llega hasta el final, o sea la que
   la pasada va a ampliar-, y el dialogo del boton rojo lo cuenta ahi. Es la
   rama en la que hasta hoy decia «la ficha retroactiva se queda donde esta»:
   verdad del texto y falso de la decision.

**Lo que se descubre de paso, y se arregla aparte.** `clearSuperseded` escribia
`recap.json` entero aunque esa conversacion no tuviera ficha ninguna -el caso
literal de una conversacion de prueba: excluida del trabajo de fondo, sellada, sin
entrada-, y llegaba a CREAR el archivo cuando no existia. Ahora lee, y solo
escribe si hay marca que quitar. El orden de los dos pasos no cambia: lo que se
quita es el paso cuando no hay nada que hacer. Lo que sigue siendo obligatorio es
la lectura, porque dar la marca por ausente sin poder mirarla dejaria en pie la
unica combinacion irrecuperable -memoria borrada con la marca viva-.

## D-102 — contra la autocopia del personaje: muestreo, dos notas de direccion y un medidor, todo con interruptor

Fecha: 2026-09-25. Autor: Claude. Contexto: `F31-REPETICION-001`. En una
conversacion real de 16 turnos con DeepSeek-V4-Flash, el personaje abria 11 de
14 respuestas largas con la misma acotacion, cerraba 9 con la misma (6 palabra
por palabra), repetia acotaciones de dos lineas identicas letra por letra en
respuestas separadas por una, y desde la novena seguia una plantilla de siete
pasos. Las tres veces que Daniel le cedio la decision, se la devolvio. El texto
no se reproduce aqui: solo la estructura.

Estado: aceptada. Los cuatro cambios los aprobo Daniel; **ninguno esta medido
todavia contra una conversacion real**.

**Lo que se sabia, verificado en el codigo.** Sus ultimas respuestas viajan
literales en cada prompt (`VAULT_RECENT_TURNS = 8`, bajo «ULTIMOS TURNOS
(DATOS)» y rotuladas «Asistente:»), no habia ni una orden contra la repeticion en
el camino de conversacion, y los cuatro parametros de muestreo de `D-098` no
llegaban al modelo del personaje: entra como FAMILIA de una conexion y
`buildFamilyProviders` construia el proveedor sin ninguno.

**Los cuatro cambios.**

1. **el muestreo llega a las familias.** La conexion gana `modelSampling`, por
   modelo y con el `apiModel` exacto como clave (`models/types.ts`,
   `sampling.ts`), y `familyProviderConfig` (`apps/agent/src/agent.ts`) lo pasa
   solo si existe. La linea «llamada al proveedor» registra los valores que
   viajaron, solo numeros. **Sin valor por defecto** (`D-098`): una conexion sin
   entrada manda el mismo cuerpo de siempre. DeepSeek trae 1,0 por defecto y
   recomienda 1,3 para conversacion
   (https://api-docs.deepseek.com/quick_start/parameter_settings/), que es lo que
   probara Daniel. **En modo razonamiento**, que es el que trae por defecto,
   `temperature`, `presence_penalty` y `frequency_penalty` «will not trigger an
   error but will also have no effect»
   (https://api-docs.deepseek.com/guides/thinking_mode). Por la pasarela de
   Daniel el registro da 12 de 13 llamadas de V4-Flash sin razonamiento, asi que
   ahi deberian surtir efecto si la pasarela los reenvia, cosa que no esta
   comprobada. **Corregido el 2026-09-25:** la primera version de este punto
   atribuia las dos afirmaciones a la pagina de parametros, que no dice ninguna,
   y daba las penalizaciones por inutiles sin condicion. Era falso fuera del modo
   razonamiento, y el error venia del encargo que se dio a los agentes.
2. **nota de direccion sobre la FORMA**: que no reutilice aperturas, frases,
   gestos, cierres ni el orden de sus respuestas anteriores, y que el registro
   vaya con la intensidad de la escena.
3. **nota de direccion sobre SU PARTE**: que no devuelva reformulado lo que el
   acaba de decir, que aporte algo suyo y que, cuando le ceden la decision,
   decida. Cuanto empuja lo siguen fijando su descripcion y las instrucciones de
   la conversacion.
4. **el medidor** (`packages/shared/src/self-copy.ts`): la linea «copia de sus
   respuestas» dice cuantos grupos de seis palabras de la respuesta nueva
   estaban en las suyas que viajaron, y lo mismo contra un control del mismo
   tamaño que NO viajo. Solo cuentas: ni texto ni huellas.

**2 y 3, como van.** Texto en `packages/shared/src/vault-reply-guidance.ts`,
salido de cuatro redacciones y tres jueces. Son dos bloques de ORDENES
(`directiveBlock`, sin «(DATOS)»: el envoltorio solo aplica como orden lo que no
lleva esa marca) en posiciones distintas de `composeVaultPrompt`:

- `iniciativa` justo detras de `mensaje-nuevo` y antes del bloque de imagen.
  Pegada al mensaje en el que el puede haber cedido la decision; y como dice
  «hazlo o proponlo», el freno de fotos tiene que seguir leyendose despues, para
  no reabrir `D-090`;
- `forma` detras del bloque de imagen -miles de caracteres en un personaje con
  foto- y antes de `instruccion-memoria`, que sigue siendo lo ultimo. Solo sale
  si en la cola hay alguna respuesta suya: sin ella hablaria de algo que no esta.

Que la posicion cambie el resultado es **una suposicion, no una medida**.

**Por que en el prompt de Studio y no en el `system` del proveedor HTTP.** El
prompt lo envuelve `buildProviderPrompt` para TODOS los proveedores, asi que
llega igual a Claude, a Codex y a cualquier conexion sin tocar el agente ni el
protocolo. En el `system` solo llegaria a las conexiones HTTP -con Claude o
Codex el interruptor no haria nada, en silencio- y habria que cruzar diez
archivos y tres paquetes, el camino que ya hizo `effort`.

**Por que un interruptor por personaje y uno solo.** `replyGuidance`, enum
`none | vary-and-lead`, en `vaultCharacterSchema`, igual que `imageCast`: es como
escribe ESE personaje. Nace en `none`, y con `none` el prompt sale **byte a byte**
como antes; lo fija una prueba contra un literal rico capturado antes del cambio
(`vault-reply-guidance.test.ts`). Uno y no dos porque con dos salen cuatro
combinaciones, ocho con la temperatura, y una conversacion de 16 turnos no da
para separarlas; porque el medidor mide forma y para la iniciativa no hay
instrumento; y porque los sintomas se solapan -el cierre que le devuelve el turno
es a la vez forma e iniciativa-. El texto va en dos constantes y en dos
etiquetas, asi que se pueden separar sin reescribir nada.

*Nota del 28/09:* «byte a byte como antes» vale al nivel del compositor: con
`none` esta casilla no añade nada. No dice que el prompt de una conversacion
salga igual que antes de `D-103`/`D-104`: la ficha editada se sella sola y la
ficha retroactiva mueve la linea base, sin casilla (`D-104`, `D-105`).

**Regla para separarlos algun dia: con un CAMPO nuevo, nunca con valores nuevos
del enum.** `VaultCharacterStore.list()` devuelve `[]` si el contenido no pasa el
esquema, y `add()` escribe `[...list(), nuevo]`: un Studio anterior que lea un
valor que no conoce y guarde cualquier personaje BORRA todos los demas, incluidos
identificadores de Xavira que se pagaron. Un campo desconocido, en cambio, se
descarta al leer sin romper nada. Vale igual para `imageCast` e `imageReview`.

**Descartado.**

- citar las frases repetidas para prohibirlas: nombrarlas las pone delante y las
  refuerza (arXiv 2402.07896). Una prueba vigila que ninguna nota lleve comillas
  ni el vocabulario de la plantilla observada;
- tocar la encarnacion: dice que no decide cuanto lleva la iniciativa, y
  cambiarla rompe la identidad del prompt apagado. La nota se presenta como
  configuracion del usuario, al nivel de las instrucciones;
- valores por defecto de muestreo: `D-098`;
- llevarlo a la sonda de compatibilidad: mide si el modelo acepta el contenido,
  no el estilo.

**Como se mide.** El prompt compuesto registra `notaIniciativa` y `notaForma`
(leidos de lo compuesto, no del ajuste), y la linea de la copia `variedad`, de la
misma variable. Con la temperatura, «llamada al proveedor». La cifra que se
compara es `ventana.copiados / grupos`, sumada por bloques; **ventana menos
control NO mide la copia**: la autocopia va en cadena, la plantilla asentada
esta tambien en las respuestas del control y la resta da cero justo cuando la
copia es maxima (comprobado con texto inventado: 68 % copiado y resta 0). El
control separa la edad de lo copiado: `soloVentana` es la copia reciente y
`ventana.copiados - soloVentana`, la plantilla que ya venia de antes.
**Con la nota de forma encendida, que `copiados` baje NO prueba que la plantilla
se haya roto.** El medidor solo ve la copia literal, y la nota pide justo cambiar
frases y gestos: si el modelo obedece a medias y rehace la misma plantilla con
sinonimos, `copiados`, `aperturas` y `cierres` dan cero, lo mismo que una
respuesta sin copia (comprobado con texto inventado: parafrasis de los siete
pasos, 0 de 78 grupos, 0 aperturas y 0 cierres). `racha` sube algo (5 frente a
2), pero cuatro o cinco palabras seguidas en comun son normales entre dos textos
cualesquiera: es un indicio, no una prueba. Tampoco lo arregla medir el solape de
palabras de contenido en la primera y la ultima frase: probado igual, da 1 de 6
a la parafrasis y 1 de 6 a una respuesta libre que por azar abre hablando del
cuerpo. La bajada es necesaria pero no basta: el orden de los pasos, la
pasividad y el eco solo se ven **leyendo muestras** del bloque encendido. La
comparacion va por bloques de **ocho turnos o mas**, o por sesiones,
**descartando los cuatro primeros turnos de cada bloque**, y **sin cambiar la
temperatura a la vez**: una respuesta viaja literal en los cuatro turnos
siguientes, asi que los cuatro primeros de un bloque todavia llevan en la ventana
respuestas escritas con el otro ajuste, y alternar turno a turno contamina los
dos lados. Esos turnos se reconocen ordenando las lineas por `conversacion` y
mirando cuando cambia `variedad`. **Corregido el 2026-09-25:** decia «cinco
turnos o mas» sin descartar nada, y con eso cuatro de cada cinco turnos median
la mezcla de los dos ajustes. El ajuste
vive en `characters.json`, que es LOCAL: con dos equipos, cada uno tiene el suyo,
y hay que leer el registro del equipo desde el que se hablo. Vigilar ademas
`memoriaHuecos` y el tamaño de la memoria con las notas encendidas: la de forma
va pegada a la instruccion de memoria y podria leerse como «no repitas» sobre lo
que la memoria debe conservar. Las dos notas suman unos 1.950 caracteres por
turno de pago mientras esten encendidas; el tamaño exacto sale en `bloques`.

## D-104 — los pendientes, de vez en cuando: tope del bloque, permiso con condicion y «ya salio» sin nombrarla

Fecha: 2026-09-25. Autor: Claude. Contexto: `F23-PENDIENTES-001` y
`docs/ROLEPLAY-EVOLUCION.md` §1-§2. Daniel: «Lia sigue en bucle con las
promesas a cada mensaje. Deberia de ser algo esporadico, no que te repita en
cada respuesta». `D-103` queda reservada por `docs/ENGANCHE-DISENO.md`.

Estado: aceptada. Los tres cambios los aprobo Daniel; **ninguno esta medido
contra una conversacion real** y nada se ha visto en pantalla.

**Lo que se sabia, medido.** El bloque de pendientes iba en el 71 % de los
prompts recientes. Cada nota se dosifica sola (72 h de reposo, tandas de 6
mensajes, 48 h de espera, `PENDING_MAX_LINES = 2`), pero con diez abiertas que
se turnan casi siempre hay alguna disponible, y el bloque entero no tenia tope.
Su permiso invitaba a sacarlas sin condicion («Tu te acuerdas aunque el no las
nombre», «Puedes sacar una tu sola»). Y cuando una respuesta suya ya habia
sacado una, la seleccion la quitaba del bloque en silencio: nada le decia que ya
estaba dicho. En `studio.log`, del 11/09 al 25/09, 99 de las 111 lineas con
abiertas > 0 tenian `enEscena` > 0 (medido por el agente de diseño, solo con
enteros; no lo he repetido).

**Los tres cambios**, detras de un solo ajuste por personaje:

1. **tope del bloque entero** (`relation-selection.ts`, `PENDING_BLOCK_EVERY =
   4`): el bloque solo puede ir en los mensajes 1, 5, 9... de el en ESA
   conversacion, `(n - 1) % 4 === 0`. Una nota **tocada** —la nombra su mensaje
   de ahora— lo salta siempre; las demas candidatas se cuentan en
   `heldByCadence` y no salen. Sin estado: `n` es `userTurns.length` del
   historial de la conversacion, que ya lleva el mensaje recien guardado. No sale
   de la linea temporal porque esa excluye conversaciones y en un hilo excluido
   daria siempre 1. Un `n` que no sea entero positivo deja el tope abierto
   (falla hacia lo de antes). Va despues de todos los filtros por nota y antes
   de ordenar y recortar.
2. **el permiso, reescrito como condicion**: con el ajuste, `formatPendingAffairs`
   sustituye las ocho lineas del permiso por `VAULT_PENDING_SPARSE_PERMISSION`
   (`packages/shared/src/vault-pending-pacing.ts`), el texto de tres redacciones
   y un juez, sin tocar una palabra. Lo demas del bloque sale igual.
3. **«ya salio», sin decir cual**: un bloque de ORDEN propio,
   `pendientes-ya-salio`, entre `turnos-recientes` y `mensaje-nuevo`. Fuera del
   bloque de pendientes porque tiene que viajar aunque el bloque no vaya: la
   promesa repetida llegaba sobre todo por el historial (ROLEPLAY §1.6). No
   nombra la promesa: nombrarla la pone delante (arXiv 2402.07896). Solo sale si
   la cola lleva alguna respuesta suya.

**Por que K = 4 y no 3.** Viajan `VAULT_RECENT_TURNS = 8` turnos, cuatro
respuestas suyas. Con el bloque en 1, 5, 9... cualquier ventana tiene
exactamente UNA respuesta escrita justo despues de un prompt con bloque; con 3
pueden coincidir dos, y se copian entre si. Y con 4 ≤ `OFFER_RUN_USER_TURNS = 6`,
en una conversacion seguida toda tanda de una nota tiene al menos un mensaje
abierto. Una prueba fija `PENDING_BLOCK_EVERY * 2 === VAULT_RECENT_TURNS` y
`PENDING_BLOCK_EVERY <= OFFER_RUN_USER_TURNS`. El primer mensaje abre porque es
el reencuentro y la ventana esta vacia. El techo teorico baja del 71 % al 25 %,
mas las tocadas. Limite: la cuenta supone turnos alternos; un mensaje suyo
huerfano de una llamada fallida corre una posicion el mensaje abierto.

**Por que el disparador de «ya salio» es otra regla, y estricta.** Con la regla
de «en escena» viajaria casi siempre y casi siempre en falso (99 de 111). Cuenta
una nota en `raisedByHer` si: esta en escena; su origen NO esta en la ventana
(una promesa que se esta viviendo no «ya salio»); una respuesta suya de la
ventana la saca con `clearlyRaises` (≥ 3 raices de la cita y ≥ 60 %, y desde la
segunda ronda la cita tiene que tener tres o mas; nunca por palabras clave); ningun turno de el en la ventana la nombra; y el
mensaje de ahora no la toca. Para el se usa la regla MAS ancha —la bolsa de
siempre o sus palabras clave—, porque ahi equivocarse solo quita la nota.
`clearlyRaises` implica `matchesStems`, comprobado por prueba sobre todas las
combinaciones de una cita de siete raices. El comparador de siempre no se toca.
El ruido de la regla estricta esta medido solo con 8 textos inventados (1 de 8
respuestas libres casaba): es orientacion, no medida.

**El ajuste.** `pendingPacing`, enum `per-note | sparse`, en
`vaultCharacterSchema`, con el molde de `replyGuidance`: verbo IPC propio
(`luxy:vault:character:pending-pacing`), preload, `useVault` y casilla en la
ficha. Nace en `per-note` y **apagado, lo que añade esta casilla sale byte a byte
como antes** (no el prompt entero: ver la tercera ronda):
lo fija `vault-pending-pacing.test.ts` contra un literal capturado ANTES del
cambio, y `vault-reply-guidance.test.ts` contra el literal rico de `D-102`. Un
solo interruptor para los tres, como se pidio; si un dia se separan, con campos
nuevos y nunca con valores nuevos del enum (la regla de `D-102`).

**Como se mide.** «prompt privado compuesto» gana `pendientesEsporadicos` (el
ajuste) y `notaYaSalio` (leido de lo COMPUESTO), y dentro de `pendientes`:
`topeCerrado`, `retenidasPorTope` («el tope actuo» es que sea > 0) y
`sacadasPorElla`. Todo booleanos y enteros. `sacadasPorElla` se calcula tambien
con el ajuste apagado: es la linea base de cuantos turnos habrian llevado la
nota. **Antes de juzgar el efecto, leer las respuestas de los turnos en que
viajo la nota**: la cifra sola no separa acierto de ruido (corregido en la segunda
ronda del 28/09, abajo; el criterio de antes llevaba a quitar la nota justo en el
caso para el que existe). Al cambiar el ajuste, la linea
«pendientes esporadicos cambiado» con `{ pendientes }`. Mismas reglas de
comparacion que `D-102`: bloques de ocho turnos o mas, descartar los cuatro
primeros, y no cambiar a la vez `replyGuidance` ni la temperatura.

**Lo que NO arregla.** El caso original paso casi siempre sin bloque, con la
promesa llegando por el historial o la memoria: el tope no toca esos canales, y
la nota es lo unico de los tres que apunta ahi. Con `LA-045` abierto la guarda
de desfase calla casi todo y el tope parecera no hacer nada (la nota si
funciona: «en escena» se evalua antes del desfase). Si lo que Daniel llama
«promesas» no esta entre las notas abiertas (ROLEPLAY §1.5), ninguno de los tres
lo toca. Tres frenos juntos pueden dejar las alusiones espontaneas en cero, que
no es lo pedido: vigilar `aludidos` de «pendientes en la respuesta», solo en los
turnos con bloque, porque esa cifra mira las lineas ofrecidas y con el tope
cerrado es cero por construccion. Y es la misma trampa de `add()` que
`D-102`: un Studio anterior al campo lo devuelve a `per-note` al guardar
cualquier personaje, y `characters.json` es local, asi que el ajuste es por
equipo.

**Descartado.** Un tope «desde la ultima vez que viajo el bloque»: necesita
estado, que la cabecera de `relation-selection.ts` prohibe, y un mapa en memoria
se pierde al reiniciar y se desordena con los prompts recompuestos. Meter las no
tocadas en el mensaje de una tocada: seria la invitacion que el tope quita.
Simular el tope en `relation-diagnostics`, la tirada de probabilidad y callar el
bloque cuando viaja la nota: no estaban aprobados.

**Revisión del 28/09 (`REV-TRES-ENCARGOS-001`).** La revisión independiente del
flujo que construyó esto no se hizo. Una ronda posterior encontró un choque
**garantizado** por K = 4: con ocho turnos de ventana, la respuesta que ella
escribió tras la apertura anterior es siempre la más antigua de la ventana, así
que si sacó la promesa que se le permitía, en cada apertura viajaban a la vez el
bloque («puedes sacarla tú sola») y la nota («no saques otro todavía»), y el ritmo
real pasaba a una cada ocho mensajes. Arreglo: **en un mensaje con el tope
abierto, esa respuesta no cuenta para la nota** (`previousOpenBoundary`,
`relation-selection.ts`); en los cerrados y con el ajuste apagado se cuenta como
antes, así que `sacadasPorElla` sigue siendo línea base apagado. Simulado con
texto inventado sobre la selección y el compositor reales: antes, bloque y nota
juntos en los mensajes 5, 9…; después, ninguna vez. No es «callar el bloque cuando
viaja la nota»: el bloque no se toca. Queda el caso en que ella saca una por su
cuenta con el tope cerrado y la apertura siguiente llega con la nota: ahí se
contradicen igual, y se deja porque la nota es la que frena. Y se añade a las
reglas de comparación: **no cambiar a la vez `recentMemories`** (`D-105`), que
cambia en qué campo de la memoria se apuntan las promesas.

**Segunda ronda del 28/09 (`REV-TRES-ENCARGOS-001`).** Otra revisión, tampoco
independiente del todo, sobre lo anterior. Se comprobó cada punto en el código
antes de tocarlo:

- **La regla «una promesa que no aparezca en esta lista… no se hizo» se
  contradecía** con el tope y con `D-105`: con el tope cerrado la lista lleva
  solo las notas que él toca, y las demás, abiertas, quedaban declaradas
  inexistentes; y el mismo prompt entrega promesas por el `Plan:` de la memoria y
  por las «Decisiones apuntadas» del resumen. Con el ajuste o con el resumen, la
  regla nombra la memoria (y lo de otras conversaciones, si viaja), **deja de
  afirmar que la lista está completa** y pide no negar la que él nombre, sin
  soltar lo que protegía: que ella no saque ni dé por hecha una que no consta.
  Con los dos apagados sale **el texto de siempre, byte a byte** (lo siguen
  fijando los literales). Consecuencia para la medida: **los dos brazos difieren
  ahora en el permiso Y en esa regla**, no solo en el permiso.
- **`clearlyRaises` con citas de una o dos raíces era la bolsa laxa**, o sea una
  palabra clave. Esas citas ya no cuentan nunca para la nota: prefiero que no
  salga a que diga «ya salió» por una palabra suelta. `sacadasPorElla` baja para
  esas notas también con el ajuste apagado, así que la línea base se mide con la
  regla nueva.
- **El criterio de medida confundía aciertos con ruido.** Decía que un
  `sacadasPorElla` > 0 en casi todos los turnos con el ajuste APAGADO haría la
  nota «casi permanente y falsa». Pero apagado ella saca una promesa en casi cada
  respuesta —es la queja de Daniel—, así que esa cifra alta sería sobre todo
  CIERTA; y encendido, si ella usa cada apertura, la nota viaja en 3 de cada 4
  mensajes cuando funciona (simulado con texto inventado: 6 de 8 entre las
  aperturas 1, 5, 9 y 13). **La cifra no separa acierto de ruido: solo leer las
  respuestas** (paso 4 de `LA-054`). El criterio queda así: la nota es falsa si,
  leyendo los turnos en que viajó, la respuesta anterior NO había sacado ninguna
  promesa; la cifra solo dice cuántos turnos hay que leer.
- **Lo del reintento que corre una posición**, arriba en «Por qué K = 4», no se
  sostiene hoy: una llamada fallida retira el mensaje de él
  (`handlers.ts`, `removeLastTurn` cuando no se escribió respuesta, y el corte
  por cierre hace lo mismo) y Studio no tiene «regenerar». Solo correría si el
  proceso muere entre guardar su mensaje y retirarlo. (Hasta la cuarta ronda
  había otro caso: si `runLocalTurn` lanzaba con la bóveda abierta —el agente
  parado—, el mensaje no se retiraba. Corregido allí.)
- **Un canal nuevo que se salta el tope, medido y con freno.** Una promesa que
  acabe en las «Decisiones apuntadas» de una ficha retroactiva o de una memoria
  sellada antes de la guía viaja en `recientes` en CADA turno de las dos
  conversaciones siguientes. Tres cambios: el bloque `recientes` dice ahora que lo
  prometido ahí «no es un guion ni un recordatorio» y que lo pendiente vuelve
  cuando toca; la ficha retroactiva manda las promesas a `plan` y no a
  `decisions` (solo afecta a las fichas nuevas); y «prompt privado compuesto»
  gana **`ecoOtras` `{frases, enNotas}`**: cuántas frases del resumen de otras
  conversaciones hablan de una nota viva, con el mismo `matchesNote` que
  `ecoMemoria`. `null` sin la casilla. No mide si ella las saca.

**Sabido y no arreglado.** En una conversación **excluida** de la memoria la línea
temporal no tiene sus turnos: `raisedByHer` vale siempre 0 y la nota no viaja
nunca, aunque el ajuste esté encendido; el tope sí funciona, porque sale del
historial. Ahí `D-104` solo resuelve la mitad.

**Tercera ronda del 28/09 (`REV-TRES-ENCARGOS-001`).**

- **La nota de «ya salió» casi nunca se disparaba.** `clearlyRaises` pide tres
  raíces de la cita y el 60 %, y `stem()` no une las formas de un verbo:
  «traigo» y «traer», «debo» y «debe», «pongo» y «pondría», «prometo» y
  «prometió». Cuando ella saca una promesa con sus palabras el verbo cambia casi
  siempre, así que solo contaba si repetía la cita casi literal. Con nueve pares
  inventados de cita y respuesta que la saca con otras palabras, la regla
  reconocía **2 de 9**. **No se tocan los umbrales ni `stem()`**: un módulo nuevo,
  `raise-roots.ts`, dice cuándo dos raíces son la misma palabra, y SOLO lo usa la
  regla estricta. Tres equivalencias: formas de diez verbos irregulares (traer,
  poner, contar, venir, salir, volver, dormir, deber, dar y ver; fuera los que
  valen para todo, y fuera las formas cuya raíz solo alcanza otra palabra
  corriente, como «traje»; el filtro es por raíz, así que «cuenta», «sale» o
  «ves» siguen, porque comparten raíz con el verbo), sacadas con el mismo
  `stem()`; terminaciones regulares que el recorte no alcanza (pronombre pegado
  al infinitivo, condicional y —hasta la cuarta ronda, que la quitó— la vocal
  final de una raíz de cuatro), siempre dejando al menos cuatro letras; y una raíz de cinco o
  más que es el principio de otra a la que le sobran como mucho dos. Además, la
  bolsa de siempre tiene que casar ANTES **con las raíces exactas**: así lo que
  acepta la estricta sigue siendo un subconjunto de «en escena», y con el ajuste
  apagado la selección no cambia en nada. Resultado con el mismo texto inventado:
  **7 de 9** (los dos que faltan tampoco los casa la bolsa laxa), y **0 falsos** en
  80 pares de respuestas neutras y en 168 pares de respuestas que usan a
  propósito los mismos verbos sin sacar ninguna promesa. Es texto inventado:
  orientación, no medida. `sacadasPorElla` sube también con el ajuste apagado,
  así que **la línea base de `LA-054` se toma con la regla nueva**.
- **Con las casillas apagadas, el prompt no es igual al de antes de este trabajo
  en todas las conversaciones**, y no lo va a ser. Hay al menos tres cambios que no
  gobierna ninguna casilla (el tercero lo añadió la quinta ronda, abajo: la
  herencia de la ficha que arregla `D-103`). El primero es la ficha editada (`D-103`, segunda ronda): si la
  ficha de Lía en la bóveda es distinta de la sellada, desde el siguiente mensaje
  la conversación usa la vigente. Se mantiene a propósito, porque es lo que Daniel
  espera al corregir una ficha y lo que pasaba antes al pulsar «Usar». El segundo
  es la ficha retroactiva, que desde la segunda ronda manda las promesas a `plan`
  y no a `decisions` en las fichas que se escriban a partir de ahora; en una
  conversación sin memoria sellada esa ficha es su memoria, así que `ecoMemoria`
  puede subir sin tocar ningún ajuste. Lo que sí sale byte a byte igual es lo que
  añade o quita **cada casilla**, y eso es lo que fijan los literales. Para
  `LA-054`: la comparación es entre los dos brazos tomados después de este
  trabajo, no contra el prompt de antes.
- **Sabido y no arreglado:** la regla que prohíbe inventar o reclamar una promesa
  que no consta vive dentro del bloque de pendientes, y con el tope cerrado y
  ninguna nota tocada no hay bloque, así que tampoco viaja. Ya pasaba sin líneas;
  lo nuevo es la proporción (el bloque pasa del 71 % a como mucho el 25 % más las
  tocadas). Queda la guarda general de la memoria. Moverla fuera del bloque
  cambiaría un texto de tres redacciones y un juez, y eso no se toca sin Daniel.
  Tampoco era verdad lo que decía la casilla apagada, «el prompt sale exactamente
  como siempre», si el resumen de `D-105` está encendido: esa otra casilla cambia
  la regla del bloque. Corregido en la parte de pantalla de esta misma ronda: las
  tres casillas apagadas dicen «apagada, esta casilla no añade nada al prompt».

**Cuarta ronda del 28/09 (`REV-TRES-ENCARGOS-001`).**

- **Con citas largas la nota casi nunca se dispara, y no se baja el listón.** El
  extractor admite citas de 3 a 30 palabras; con nueve raíces o más, el 60 % pide
  seis, y ella saca una promesa con cuatro o cinco de sus sustantivos: con texto
  inventado, 3 de 9 paráfrasis claras. Los «7 de 9» de arriba salían solo de
  citas de 4 a 6 raíces. Se midió qué pasaría bajando el listón para ellas, con
  28 paráfrasis y 18 respuestas del mismo tema que NO sacan la promesa (también
  inventadas; con la regla de la tercera ronda): con un tope de cinco raíces,
  +2 aciertos y +2 falsos; quitar de la
  cuenta las palabras de tiempo y de promesa («mañana», «sábado», «prometo»), −2
  aciertos y −1 falso; pedir además una palabra de recuerdo («me prometiste», «me dijiste»)
  para bajar al 45 %, +2 aciertos y 0 falsos en ese texto, pero «me dijiste» sale
  en cualquier conversación y es exactamente contar por palabra clave. Y la regla
  de hoy ya da falsos con respuestas largas del mismo tema: 4 de esas 18. Un falso
  le quita la palabra sobre algo que no dijo; un fallo solo deja la conducta de
  antes. **No se cambia**: el diagnóstico de pendientes cuenta ahora cuántas citas
  largas hay y cuántas de sus alusiones habrían llevado la nota (`longQuotes`,
  `herMentionsClear`, `herMentionsLong`, `herMentionsClearLong`, solo enteros), y
  `LA-054` pide mirarlo antes de decidir. Nada de esto se ha medido con citas
  reales.
- **La vocal final unía palabras distintas.** «casa» y «caso», «peli» y «pelo»,
  «cara» y «caro», «mesa» y «meses»; con dos de ellas un revisor fabricó una «ya
  salió» falsa. Se quita la regla general; «debo» y «debe» los sigue uniendo la
  tabla de «deber», y cuatro verbos de raíz corta que salen en promesas (besar,
  cenar, jurar, pagar) van en tabla, que también arregla «beso» y «besarte», que
  antes no se unían. Fuera, a propósito, los de raíz corta que son otra palabra
  corriente: mirar («¡mira!»), tocar («hoy toca»), pasar, bañar, beber («bebé») y
  comer. Coste medido con el mismo texto inventado: una paráfrasis menos (13 de 19
  cortas, antes 14), por «solas» y «solos»; el falso fabricado ya no pasa.

**Quinta ronda del 28/09 (`REV-TRES-ENCARGOS-001`).**

- **Dos huecos de `raise-roots.ts`, cerrados sin tocar umbrales ni `stem()`.**
  (1) La tabla de irregulares se consultaba con la raíz tal cual: «traerme»,
  «traernos», «traértelo» o «ponérmelo» no llegaban a su verbo. Ahora se consulta
  también con `regularRoot()`, que quita el pronombre. (2) `stem()` recorta
  «preparo» dos veces, hasta «prep», y `regularRoot()` quitaba el infinitivo de
  «prepararte» una sola vez, hasta «prepar»: no se unían. Ahora lo que queda al
  quitar pronombre o condicional se recorta con el mismo `stem()` que la palabra
  suelta. De paso, pronombres dobles («-telo», «-melo», «-selo», «-noslo»), el
  gerundio con pronombre («escribiéndote») y unas pocas formas irregulares
  («viniera», «saliera», «durmamos», «vernos», «darme»). La «n» de «nos» solo se
  quita detrás de -ar o -ir: detrás de -er la dejan también «interno», «moderno» o
  «invierno». Con el mismo texto inventado de la revisión: paráfrasis **29 de 32**
  (antes 25; con la regla exacta, 17); 0 de 600 pares neutros, 0 de 448 cruzados, y
  en las 136 adversarias del mismo tema los mismos 10 falsos que antes, ninguno
  nuevo. En 274 palabras inventadas elegidas para romperlo, 89 pares nuevos
  unidos, todos formas del mismo verbo o de su sustantivo («cena», «paseo»,
  «baile»), salvo «sentarnos» y «sentir», que caen juntos porque `stem()` ya deja
  los dos en «sent». Sigue siendo texto inventado.
- **Límite medido, sin cambiar (de diseño):** la bolsa exacta va primero. En una
  cita de tres raíces con dos verbos, si ella cambia la forma de los dos solo
  queda una raíz exacta y la nota no salta, ni cuenta como «en escena» («te juro
  que vuelvo antes de las diez» frente a «te juré que volvería antes de las
  diez»). Explica 2 de las 3 paráfrasis que siguen sin reconocerse; la tercera es
  «puesto», fuera a propósito.
- **Falsos por tema que ya estaban.** Las equivalencias suman alguno con
  respuestas del mismo tema (cenamos~cenar, contar~cuento; y la regla del prefijo
  une precio~preciosa, regalo~regaliz o interno~interés). Cada unión aporta como
  mucho una raíz y sigue haciendo falta la bolsa exacta; no se cambia.
- **`herMentionsClear` es una cota superior**, no «las que habrían llevado la
  nota»: solo aplica `clearlyRaises`, sin las otras condiciones de `raisedByHer`
  (origen fuera de la ventana, que él no la retome, que el mensaje de ahora no la
  toque, la frontera de la apertura anterior). Léase así en `LA-054` (hecho en
  la sexta ronda: `LA-054`, el JSDoc del campo y el texto de pantalla lo dicen).
- **El tercer cambio sin casilla**, que faltaba en la lista de arriba y en
  `D-105`: `resolveConversationOwner` ya no hereda una ficha sellada con otro
  dueño ni la de una conversación soltada con `''` (`D-103`). Con todo apagado,
  una conversación soltada, o cuyo dueño ya no está en la bóveda o tiene la
  ficha vacía, pierde su «QUIÉN ERES»; una con dueño y ficha no se queda sin
  ella: pasa a llevar la de su dueño en vez de la heredada (corregido el 28/09:
  antes decía que la perdía en todos los casos). Y la ficha vigente llega
  también a conversaciones empezadas **sin** ficha sellada: en esas el prompt
  gana una ficha entera y la pista de pantalla no avisa, porque solo sale con
  una ficha sellada. Sabido, no arreglado.

**Sexta ronda del 28/09 (`REV-TRES-ENCARGOS-001`).** Menores de la revisión de la
quinta, en `raise-roots.ts`; umbrales y `stem()` sin tocar. Revisada después por
ocho revisores, con `npm run check` a solas en verde (29/09, 4677 pruebas; aquí
decía «sin revisión propia»).

- **La letra que cambia al escribirse.** «llegué», «busqué», «empecé» y «pagué»
  —justo como ella diría que cumplió— no se unían con «llego», «busco»,
  «empezar» o «pago»: el recorte los deja en «llegu», «busqu», «empec». Ahora
  `regularRoot` lleva «qu» a «c», «gu» a «g» y la «z» final a «c», con el suelo
  de cuatro letras («sigue» no se toca) y una más para la «z» («cruz» tampoco).
  La tabla de raíz corta generaba «page» y «pages» para pagar; ahora «pague» y
  «pagues».
- **«leer»**, con cuatro letras de raíz y la «y» de «leyó» o «leyendo», va en la
  tabla de irregulares.
- **El prefijo ya no vale en un verbo de la tabla**: unía «cuent» (te cuento) con
  «cuentam» (cuéntame), que es ella pidiéndole a él que cuente. En esos verbos
  decide la tabla. El caso «contar~cuento» de los falsos por tema, arriba, sigue
  igual: va por la tabla.
- Con el texto inventado del revisor (`lente2`, orientación, no medida):
  paráfrasis 40 de 48 (antes 38), adversarias 3 de 45 (antes 4: el de cuéntame
  ya no pasa), neutras 0 de 480, cruzadas 0 de 792.

## D-103 — el dueño de una conversacion se resuelve en un sitio, por posicion; el enganche vive en este equipo en un formato ya subible

Fecha: 2026-09-25. Autor: Claude. Contexto: `F33-ENGANCHE-LOCAL-001`,
`docs/ENGANCHE-DISENO.md` y las tres refutaciones de `wf_aae72735-8f2`. Daniel:
enganche inmediato al pulsar y, cuando exista el servidor, en los dos equipos.

Estado: aceptada y construida en ESTE equipo. **Nada visto en pantalla**; las
cifras de pruebas estan en `TEST-RESULTS.md`.

**Una sola funcion.** `resolveConversationOwner` (`packages/shared/src/vault-owner.ts`)
ordena los hechos por POSICION, nunca por reloj: un turno ocupa `(secuencia, 0, 0,
'')` y un evento `(anchorSequence, 1, generation, eventId)`. Vale el ultimo no nulo
por posicion para el dueño, para la ficha (solo desde la posicion del hecho que puso
al dueño) y para las instrucciones. `PrivateConversationStore.owner()` es el unico
punto de E/S; `list()` usa la misma funcion con parada temprana. Se retiraron
`characterOf`, `latestCharacterId`, `latestCharacterDescription` y
`latestInstructions`, y `owner-single-source.test.ts` falla si vuelven o si alguien
lee el personaje de un turno fuera de `conversation-store.ts`.

Arregla por lectura el defecto demostrado: soltar sellando `''` dejaba la ficha de
Lia en vigor. **Cambia el prompt de conversaciones reales que tengan ese caso**; no
se sabe cuantas hay sin descifrar la boveda.

**La causalidad.** `nextOwnerEventPosition` da al evento nuevo el ancla mayor entre
la ultima secuencia local y las de todos los eventos conocidos, la generacion
siguiente y cita las cabezas. Un evento que sustituye a otro le gana SIEMPRE,
tenga los turnos que tenga el equipo que lo crea: cierra la refutacion de
sincronizacion n.º 1 y el conflicto que se cerraba en falso (n.º 2). Probado en
`vault-owner.test.ts`.

**El almacen local.** `vault/conversation-owners.json`, sellado con
`identity|conversation-owners`, calcado de `relation-store.ts` (carril, `fsync`,
`rename`, nunca pisa un archivo que no abre, conserva lo que no valida). Cada fila
es `{event, uploadedAt: null}` y `event` es la carga v1 definitiva y estricta.
**No se sella evento a evento con relleno fijo**: el tamaño del relleno, el
proposito en `VAULT_PURPOSES`, la tabla y las rutas son decisiones del servidor que
las refutaciones aun discuten. Lo que no se podria reconstruir despues —ids, ancla,
generacion, lo que sustituye, los tres campos y la fecha— queda fijado hoy.

**Por que el servidor queda para despues.** La boveda solo existe en este equipo y
la sincronizacion esta rota (`SEG-SYNC-001`): montar el enganche encima seria
construir sobre algo que no sube nada. Y exige migracion y despliegue, que no se
hacen sin autorizacion. Quedan fuera las refutaciones de sincronizacion 3 (la parte
de dos equipos), 4, 5 y 6, promesas 4 y 5, y produccion 1-4 y 6-9.

**El cursor de pendientes guarda con que dueño se reviso** (`owner`, opcional en
`relationCursorSchema`). `effectiveThrough` lo invalida si no casa; un cursor sin
el campo vale solo si la conversacion no tiene eventos. No hay «reinicio» que una
extraccion en curso pueda pisar: lo que escribe nace invalido (prueba de la carrera
en `relation-sync-owner.test.ts`). Una negativa conserva el `owner` anterior. La
seleccion del turno lee `through` en crudo, asi que el manejador pasa a -1 los
cursores de otro dueño antes de `selectPendingForTurn`: las promesas antiguas
quedan bloqueadas por desfase hasta la relectura, que es el lado seguro de `D-088`.

**Una sola forma de cambiar el dueño.** Desaparece el campo del identificador. El
envio rechaza `characterId` o descripcion en una conversacion con registros, antes
de gastar nada. Al nacer (turno 0) main sella id, la ficha de la boveda y, sin
instrucciones, las del personaje: se acabo la carga asincrona del renderer. Solo se
engancha lo que no tiene dueño y «Soltar» solo deshace un enganche propio: **una
conversacion que nacio con personaje ya no se puede soltar ni cambiar desde la
pantalla**, porque el campo era la unica via.

**Al enganchar**: evento, `privateMemory.invalidate()`, `forgetFailure`,
`catalogFailures.delete` y la relectura de pendientes en segundo plano, hasta
`ceil(registros/40) + 1` tandas (una tanda que no encuentra nada no llama al CLI).
Exclusion mutua con el envio en los dos sentidos. Al registro solo el verbo y
cifras.

**Lo que no arregla.** La foto de perfil copiada mientras era suya se queda entre
sus medios al soltar (la pantalla lo dice). Las respuestas escritas entre enganchar
y soltar pierden la firma al soltar. `list()` y `owner()` descifran como antes o algo
mas: no esta medido. Un Studio anterior ignora el archivo nuevo y ve las
enganchadas sin dueño; al reescribir `relation.json` quita `owner` y, al volver, las
enganchadas se releen.

**Modificada por `D-108` (29/09): la firma.** Con dueño, TODAS las respuestas
llevan su nombre, también las de antes del ancla, y el separador ya no dice
«Lo de arriba se escribió sin su ficha». Al soltar, todas vuelven a «Respuesta».
El resto de esta decisión sigue igual.

**Revisión del 28/09 (`REV-TRES-ENCARGOS-001`).** La revisión independiente del
flujo no se hizo; una ronda posterior encontró, y se corrigió:

- **La ficha «solo desde el ganador» quitaba la ficha a datos sin error.** Con el
  Studio anterior, soltar sellaba `''` y volver a elegir a la MISMA Lía sellaba
  solo el id, porque la ficha era igual a la de antes y no se repetía; la regla
  nueva la perdía. Ahora, si gana un TURNO sin ficha, vale la última sellada
  mientras el dueño era ese mismo personaje o ninguno, y ningún otro personaje fue
  dueño entre medias (`inheritedDescription`). La de otro personaje sigue sin
  heredarse nunca, que era lo que esta decisión venía a cerrar; un evento no
  hereda nada, porque lleva los tres campos juntos.
- **Reintentar el primer mensaje fallido dejaba la conversación sin personaje**:
  main borra el archivo, pero la pantalla se quedaba con su id y el reenvío ya no
  llevaba el personaje. Ahora vuelve a «nueva».
- Al nacer, la ficha del renderer ya no se usa ni como repuesto; un personaje sin
  nombre firma «Sin nombre»; y «soltar» ya no dice «nació con su personaje» de una
  conversación a la que el campo antiguo se lo puso a mitad.
- La confirmación iba desatada de su conversación, podía pintar una vista previa
  vieja y se quedaba en «Comprobando…» al fallar, sin la pista.

`owner-single-source.test.ts` es una guarda de TEXTO sobre `apps/desktop/src/main`:
caza `turn.characterId`, `turn.characterDescription` y `turn.instructions` con
punto, `?.`, corchetes o desestructurados, y el regreso de `characterOf` y los tres
`latest*`. Un alias se le escapa.

**Segunda ronda del 28/09 (`REV-TRES-ENCARGOS-001`).**

- **Regresión: la ficha editada ya no llegaba a ninguna conversación existente.**
  Antes de esta decisión llegaba al pulsar «Usar» y enviar (el turno la sellaba
  como `descriptionChanged`); con el dueño fijo, el renderer manda `null`, main
  rechaza otra cosa y ni enganchar ni soltar sirven para una conversación con
  dueño. Una corrección de la ficha de Lía solo se aplicaba abriendo una
  conversación nueva, y eso no lo decía ningún documento. Ahora **main compara, en
  cada turno de una conversación ya empezada, la ficha de la bóveda con la en
  vigor y, si cambió, la sella con el turno de él**, una vez. La pone main, nunca
  el renderer. Vale igual para una nacida con ella y para una enganchada (el turno
  va después del ancla, así que gana por posición). Una ficha **vacía** en la
  bóveda no borra la sellada. Es un cambio de comportamiento: ya no hace falta
  «Usar»; el prompt de toda conversación con dueño sigue a la ficha actual desde
  su siguiente mensaje.
- **«Usar» en la galería y crear un personaje abrían la confirmación del
  enganche** varias pantallas más abajo, junto al selector, sin nada visible
  donde se pulsó; y a quien solo quería generar una imagen le salía una pregunta
  que no había hecho. Ahora, en una conversación ya empezada, la galería solo
  elige para generar; el enganche se pide con el selector o con «Enganchar a un
  personaje». El texto de la lista lo dice.
- Con la confirmación abierta ya no se puede enviar (su texto se quedaba
  desfasado); soltar vale como «No, esta no» para el aviso «¿Es de Lía?»; el «No,
  esta no» de una conversación nueva ya no pasa a la siguiente nueva; y la pista
  del selector en una nueva dice que elegir a alguien no se podrá cambiar ni
  soltar después.
- La confirmación dice «sin su ficha» y ya no «sin saber que hablaba con Lía»,
  que no está comprobado (`D-093`).

**Tercera ronda del 28/09 (`REV-TRES-ENCARGOS-001`).**

- **La ficha editada que sella main se queda.** Cambia el prompt de toda
  conversación empezada cuyo personaje tenga hoy una ficha distinta de la
  sellada, con todas las casillas apagadas, y queda sellada en el historial: la
  vieja solo vuelve reescribiéndola. Se mantiene porque es lo que Daniel esperaría
  al editar la ficha de Lía y lo que antes conseguía con «Usar» y enviar; lo que
  estaba mal era decir en `D-104` y `D-105` que «apagado» dejaba el prompt igual
  que antes (corregido allí: lo que no cambia es lo que añade cada casilla). No se
  ha contado cuántas conversaciones reales tienen una ficha distinta: sin
  descifrar la bóveda no se puede.
- **Esa ficha sí sale del equipo al sincronizar**, aunque el enganche no: va
  dentro del turno de él, sellada con la subclave de la conversación como
  cualquier turno, y los turnos son lo que sube «Sincronizar». No es una fuga en
  claro, y en otro equipo no tiene efecto sin el `characterId`. Lo de «solo en
  este equipo» vale para el enganche, no para la ficha (`CLAUDE.md` y
  `AGENTS.md` ya lo dicen). Hoy la sincronización está rota (`SEG-SYNC-001`).
- **Sabido y no arreglado:** si `vault/conversation-owners.json` existe y no abre
  (JSON roto, otro formato, un sobre que no descifra), `list()` y `owner()` lanzan,
  y con ellos la lista, el envío, el índice de memoria y los pendientes de TODAS
  las conversaciones, también las que nunca se engancharon. Es consecuencia de no
  pisar un archivo que no abre, y la alternativa —leerlo como vacío— haría que
  una conversación enganchada volviera en silencio a su dueño de antes, con otra
  ficha en el prompt. Eso se decide con Daniel, no aquí. Y al enganchar, el
  cursor de pendientes de esa conversación deja de valer: hasta que termine la
  relectura de fondo, sus turnos cuentan como desfase para las promesas de Lía
  de TODAS sus conversaciones, que se callan un rato (`bloqueadasPorDesfase`). Es
  el lado seguro de siempre. La confirmación lo avisa desde la parte de pantalla
  de esta misma ronda («puede que sus pendientes anteriores no le lleguen»).

**Cuarta ronda del 28/09 (`REV-TRES-ENCARGOS-001`).**

- La pista «El modelo sabe que es: …» enseñaba la ficha sellada como la vigente
  aunque se hubiera editado, hasta el siguiente envío. Ahora, con la misma regla
  que main (ficha con texto y distinta de la sellada), añade que desde el próximo
  mensaje le llega la nueva y queda guardada en la conversación.
- La confirmación decidía «con su ficha» con `length` y el prompt con `trim`: una
  ficha de solo espacios prometía una ficha que no viajaba. Ahora las dos con
  `trim`.
- Volver a una conversación con la confirmación pendiente ya no desplaza la
  página hasta ella: solo la primera vez de cada petición. Y al confirmar, el
  panel dice «Aplicando el cambio…» en vez de volver a «Comprobando…» con el
  cambio ya hecho. Nada de esto se ha visto en Electron.

**Quinta ronda del 28/09 (`REV-TRES-ENCARGOS-001`).**

- Main decidía «la ficha de la bóveda sustituye a la sellada» con `length > 0` y
  el compositor la descarta con `trim`: una ficha de solo espacios (el esquema la
  admite, aunque los formularios recortan) se sellaba y el prompt se quedaba sin
  «QUIÉN ERES». Ahora main, y la pista «Has cambiado su ficha», usan `trim`.
  Prueba en `conversation-owner.test.ts`, vista fallar sin el arreglo.
- El botón «Enganchar a un personaje», desactivado con una petición pendiente,
  lleva ahora un `title` que dice dónde está la confirmación. Sin ver en Electron.

## D-105 — el resumen de sus dos ultimas conversaciones, detras de una casilla

Fecha: 2026-09-25. Autor: Claude. Contexto: `F33-RECUERDO-001`. Daniel: «si Lia no
recuerda que es su conversacion, no me sirve para nada».

Estado (29/09): aceptada y construida; commiteada hasta la octava ronda en
`f77efb6`, y la novena y la décima sin commitear. Cada ronda desde la séptima
tuvo después su revisión y un `npm run check` a solas: la séptima, ocho
revisores y un check que cayó por tiempo en una prueba ajena; la octava, ocho
revisores y check en verde (4716); la novena, seis revisores y check en verde
(4741); la décima, seis revisores y check en verde (4751). Lo que dejó la
revisión de la décima **sigue abierto**, al final de este bloque. **No medida
contra una conversacion real** y nada visto en pantalla (`LA-056`, `LA-058`).

**Que viaja.** Con `recentMemories: 'recent-two'` en la ficha del personaje (nace
`off`; apagado, lo que añade esta casilla sale byte a byte igual, probado; el prompt
entero puede cambiar por otras causas, ver la tercera ronda), cada turno suyo lleva un
bloque `recientes`, como DATOS, entre `pendientes` y `memoria`: sus DOS
conversaciones mas recientes sin la actual ni las excluidas. Recencia = el ultimo
turno o el enganche, lo mas tarde, para que la recien enganchada entre desde que se
pulsa. Si una no tiene memoria usable se salta y NO se rellena con una tercera.

**De donde.** La memoria sellada; si no hay, la ficha retroactiva APROBADA (`source
=== 'recap'` de `chooseConversationMemory`). El indice deducido del catalogo no:
entra sin aprobacion.

**Que campos.** *(Sustituido por la quinta ronda, abajo: ahora viaja la memoria
entera sin `plan` ni `openQuestions`.)* Solo `summary` y `decisions`: decisiones enteras desde la ultima
hasta 240 caracteres (160 desde la segunda ronda, abajo), el resumen cortado en fin de frase hasta 400 por conversacion,
800 el bloque. Nunca `plan` ni `openQuestions` (el canal de eco de las promesas, que
ya cubren los pendientes) ni `facts` ni `lessons`. Se etiquetan «Decisiones
apuntadas», no «lo acordado»: la instruccion de memoria de la boveda no define los
campos, y un esceptico demostro que no esta garantizado que lo acordado este ahi.

**La guia de campos.** Con la misma casilla viaja `guia-memoria` justo antes de la
instruccion de memoria: en `decisions` lo acordado, en `plan` lo que queda por
delante, solo de esta conversacion. `CONVERSATION_MEMORY_INSTRUCTION` no se toca
porque la comparte el agente. Mejora las memorias futuras, no las selladas.

**Contra el blanqueo.** El bloque lleva la regla de `D-061` y la orden de no
copiarlo a la memoria de la conversacion en curso. No se impide: se mide.
`recientes` y `recientesError` en «prompt privado compuesto»; `ecoRecientes`
(`entradas`, `conFrasesDeRecientes`, `sinApoyoAqui`) en «turno privado terminado».
Solo enteros. Un fallo deja el turno sin bloque y no registra el motivo.

**Lo que hay que decirle a Daniel** (la confirmacion y la casilla lo dicen): la
memoria de una conversacion enganchada se escribio sin la ficha del personaje, y el
resumen solo cubre las dos mas recientes, asi que una vieja sale en cuanto haya dos
mas nuevas.

**Revisión del 28/09 (`REV-TRES-ENCARGOS-001`).** La revisión independiente del
flujo no se hizo; una ronda posterior encontró, y se corrigió:

- **La guía de campos invitaba a apuntar las promesas en `decisions`** («lo que
  quede acordado»), que es justo lo que viaja en `recientes`: la promesa habría ido
  en CADA turno de las dos conversaciones siguientes, sin el tope de `D-104`, y
  habría desaparecido de `ecoMemoria`, que solo mira `plan` y `openQuestions`.
  Ahora dice que las promesas y lo que quedasteis en hacer van en `plan`. Es
  plausible, no medido.
- **El bloque decía «la mas reciente primero»**, pero ordena por el último turno o
  el enganche y pone la fecha del último turno: una vieja recién enganchada salía
  primera con una fecha anterior a la segunda. Ahora dice «cada una con su fecha».
- **La confirmación prometía de más** (`D-093`): con la casilla apagada, «la verá
  entre sus momentos… podrá leer un trozo», cuando el índice lleva como mucho 40
  (`MAX_EPISODE_LINES`) y una vieja puede quedarse fuera; con la ficha
  retroactiva, «si la aprobaste», cuando además tiene que ser de la versión actual
  y llegar a los últimos mensajes. Las dos ramas, en condicional, y la de la ficha
  dice ya que solo cubre las dos más recientes.
- `vaultCharacterImport` reconstruía el personaje campo a campo y volver a darlo de
  alta apagaba esta casilla y las demás. Ahora parte del que ya había.

**Sabido y no arreglado:** lo que el resumen de B acabe copiado en la memoria de A
—el blanqueo que solo se mide con `ecoRecientes.sinApoyoAqui`— **no se va** al
borrar, excluir o soltar B: esa memoria es de A. Los textos de borrar y soltar
(«sale de su resumen») no lo advierten, y la casilla tampoco.

**Segunda ronda del 28/09 (`REV-TRES-ENCARGOS-001`).**

- **Del resumen viajaba el PRINCIPIO y se caía lo último que pasó**: `cutText`
  sumaba frases desde la primera y cortaba al pasarse, y en un resumen
  acumulativo lo reciente suele ir al final. Ahora viajan **la primera frase y
  las últimas que quepan, con « … » en medio**; si la primera no deja sitio, lo
  del final. No está medido que el modelo escriba esos resúmenes en orden: por
  eso no se tira la primera. La reserva de las decisiones baja de **240 a 160**
  caracteres, porque con la guía (límites y reglas del juego en `decisions`) se
  llenaba y al resumen le quedaba una frase; ahora le quedan al menos 239.
  `recientes` gana `fuera` (caracteres de resumen que no viajaron) y
  `sinIndice` (ver abajo).
- **Un índice invalidado a mitad de construirse daba `conversaciones: 0` sin
  error**, indistinguible de «no tiene otras». `PrivateMemory.isBuilt()` y
  `recientes.sinIndice` lo separan. El turno sigue saliendo sin bloque, que es el
  lado seguro de siempre.
- **Promesas por este canal**: ver la segunda ronda de `D-104` (`ecoOtras`, la
  línea «no es un guion» del bloque y la ficha retroactiva que manda las promesas
  a `plan`). Quitar `plan` y `openQuestions` no cerraba el canal: `summary` es
  texto libre y puede decir «quedó en…»; `ecoOtras` lo mide también.
- **Textos (`D-093`)**: «Memoria de lo ya hablado» decía que es solo de su
  conversación; con la casilla encendida, una ficha aprobada y al día de una
  conversación sin memoria propia viaja a las otras, y ahora lo dice. La casilla
  dice que una conversación sin memoria usable se salta y que puede no llegarle
  nada.
- **Copias en claro fuera de la bóveda**: Claude Code con `--print` guardaba la
  sesión entera, con el prompt, en su carpeta de proyectos, y `codex exec` en la
  suya. Con esta decisión eso incluye el resumen de otras dos conversaciones en
  cada turno, y enganchar o soltar relee la conversación entera por el CLI
  auxiliar. Todo lo de solo lectura —las conversaciones de Studio y todo lo de la
  bóveda— lleva ahora `--no-session-persistence` (Claude) o `--ephemeral`
  (`codex exec`), detectados en la ayuda de la versión instalada (Claude Code
  2.1.267 y codex-cli 0.154.0, comprobado el 28/09 con `--help`). Un trabajo de
  código conserva su sesión. **Lo ya escrito antes no se borra**: está en las
  carpetas de sesiones de los dos CLI y no se ha mirado a propósito, porque sería
  leer contenido de la bóveda en claro. Sigue sin cubrir el archivo temporal de
  `--output-last-message` de `codex exec`, que deja la respuesta en claro en la
  carpeta temporal mientras dura el turno.

**Tercera ronda del 28/09 (`REV-TRES-ENCARGOS-001`).**

- **Lo que le llega es poco, y se le plantea a Daniel; los topes no se tocan.**
  De cada conversación viajan la primera frase del resumen, las últimas que
  quepan y las decisiones que entren en 160 caracteres. Con un resumen de 1200
  caracteres en doce frases, un revisor midió con texto inventado que se cae el
  86 %. Es la consecuencia de los topes elegidos, y `fuera` lo mide en cada turno.
  Todo texto de pantalla sobre esto tiene que decir que **le llega un resumen
  corto**, no que «la recordará». *(Sustituido por la quinta ronda: le llega la
  memoria entera; sigue valiendo «le llega», no «la recordará».)*
- **«Apagado sale byte a byte igual» se refiere a lo que añade esta casilla.**
  Con ella apagada, el prompt de una conversación empezada puede cambiar igual por
  la ficha editada (`D-103`, tercera ronda), por la ficha retroactiva nueva
  (`D-104`, tercera ronda) y por la ficha que ya no se hereda tras soltar o de
  otro dueño (`D-103`; lo apunta `D-104`, quinta ronda). La lista puede no estar
  completa: es la que han encontrado las revisiones.
- **La misma trampa de `add()` que `D-102` y `D-104`**: un Studio anterior a este
  campo lo devuelve a `off` al guardar cualquier personaje, y `characters.json` es
  local. Apagado en silencio, contaminaría la medida de `LA-054`, que pide no
  cambiar esta casilla mientras se mide.
- **Sabido y no arreglado:** si el resumen de origen no acaba en un signo de
  final, su último trozo viaja como si fuera una frase entera. `cutText` no lo
  corta: es el texto tal y como está sellado, y marcarlo con «…» diría que se
  cortó algo que puede estar completo. *(Cerrado en la quinta ronda: el corte
  nacía en el `slice` al guardar, y ahora se corta en palabra al guardar y se
  arregla al presentar lo ya guardado con esa huella.)*

**Cuarta ronda del 28/09 (`REV-TRES-ENCARGOS-001`).**

- **El nombre de la casilla prometía más de lo que hace.** «Recordar sus dos
  últimas conversaciones» pasa a «Pasarle un resumen corto de sus dos últimas
  conversaciones» (`RECENT_MEMORIES_CHECKBOX`), que es lo que viaja. Los topes no
  se tocan. *(Sustituido por la quinta ronda: ahora «Pasarle la memoria de sus
  dos últimas conversaciones».)*

**Quinta ronda del 28/09 (`F33-RECUERDO-ENTERO-001`): la memoria entera.**

Daniel decide que con la casilla le llegue **la memoria entera** de cada una de
sus dos conversaciones más recientes, y **solo la memoria, no los últimos mensajes
literales**. Sustituye «Que campos» y los topes de la segunda y la tercera ronda.
Diseño, refutación (11 fallos) y construcción en el flujo `wf_b1411ff7-0ef`.

- **Qué viaja.** `summary`, `facts`, `decisions` y `lessons`, enteros y en su
  orden, con sus rótulos (`Resumen`, `Hechos`, `Decisiones apuntadas`,
  `Lecciones`), cada conversación con su cabecera «Conversacion del {fecha} ·
  «{titulo}»» y una línea en blanco entre ellas. `plan` y `openQuestions` siguen
  fuera: son el canal de eco de las promesas. Los mensajes no viajan. El bloque
  sigue siendo DATOS y en el mismo sitio, y **con la casilla apagada no se añade
  nada** (la prueba byte a byte no se ha tocado).
- **Sin los cortes de antes.** Desaparecen los 400 por conversación, los 800 del
  bloque, la reserva de 160 para decisiones y el corte primera frase + « … » +
  últimas. Queda `RECENT_MEMORY_ENTRY_CHARS = 6000` por conversación como
  **salvaguarda**: el bloque `memoria` más grande de `studio.log` mide 4.772
  caracteres (n=172, comprobado el 28/09 leyendo solo los enteros del registro), y
  eso incluye la regla contra la invención, `plan` y `openQuestions`. El máximo
  del esquema con los cuatro campos es 1.200 + 36 × 240 = 9.840. Si alguna vez
  salta, quita **entradas enteras empezando por lo más viejo**: la primera de cada
  lista, por posición relativa, y a igualdad lecciones antes que decisiones y
  hechos (el orden de `clampRecapMemory`). Es la lección de la segunda ronda:
  recortar por el final tiraba lo último que pasó. El resumen no se toca salvo en
  un caso que el esquema no deja que ocurra, y entonces se queda su final. Que el
  modelo escriba en orden no está medido.
- **Lo que dura y lo que era de aquella escena.** Los hechos mezclan las dos cosas
  («quién es quién, cómo la llama él» y «dónde están, qué hora es, cómo va
  vestida», según la guía de la ficha retroactiva). El diseño los rotulaba todos
  «de entonces», y eso daba por caducado un apodo; la refutación lo tumbó. Se
  rotulan «Hechos» y una regla del bloque dice que lo de quién es quién, cómo os
  llamáis y qué sabe cada uno del otro **sigue valiendo**, y que el sitio, la
  hora, la ropa y cómo estaba la escena **era de entonces**. Separarlos por
  entrada exigiría otro modelo. Que el modelo siga la regla no está medido.
- **Los tramos sin resumir no se pierden.** Una ficha aprobada con `gaps` viajaba
  como si lo contara todo: `recientes` tiraba `elegido.gaps`. Ahora la entrada
  empieza por «De esa conversacion hay N tramos que no se pudieron resumir… de ahí
  no sabes nada; pregúntalo», la salvaguarda no lo quita y `recientes.huecos` lo
  cuenta.
- **La palabra cortada, donde nace.** El `slice` a secas cortaba a media palabra
  en cinco sitios: la memoria sellada (`normalizeConversationMemory`, 1.200/240),
  la ficha al validarla (`normalizeRecapMemory`, 1.200/240), **la ficha al
  recortarla al relleno** (`clampRecapMemory`, 400/160: es el corte que queda en
  disco, y el diseño no lo había visto), el ancla restaurada y el índice deducido.
  Todos pasan a `clipAtWord`: corta en el último espacio, no deja una coma
  colgando y marca con «…». **Lo ya guardado se arregla al presentarlo**, en
  `recientes` **y** en el bloque `memoria` de su propia conversación
  (`repairSlicedMemory`): un texto que mide exactamente su tope (1.200/240 si es
  memoria sellada, 400/160 si es ficha o índice) y acaba en letra o cifra pierde
  su última palabra y lleva «…». Si en realidad estaba entera, se pierde una
  palabra y queda dicho que falta algo; la palabra partida era un dato falso.
  `recientes.cortadasAlGuardar` y `memoriaCortadasAlGuardar` cuentan cuántos. No
  se arregla en el prompt de la ficha retroactiva encadenada (la ficha anterior
  que se le enseña al CLI): cambiaría lo que mide `countKeptEntries`. Cuántos
  textos guardados tienen la huella no se sabe sin descifrar la bóveda.
  Sustituye el «Sabido y no arreglado» de la tercera ronda.
- **La medida, comparable y con control.** `recientes.formato: 2` (sin campo o 1
  es la versión corta) y `ecoRecientes.formato: 2` separan los turnos de antes y
  de después. `ecoRecientes` gana `frases` (cuántas viajaron; en la versión corta
  la cifra está en `ecoOtras.frases` del mismo turno), `frasesDeUnaRaiz` (el
  comparador casa una frase de una sola raíz con **una** palabra; el diseño decía
  que siempre pide dos) y `porCampo` (la versión corta solo llevaba `resumen` y
  `decisiones`: esas dos son las comparables). Y un **control**: la tercera
  conversación más reciente, que no viaja, **fijada al montar el prompt** en la
  misma elección que las dos que viajan (elegirla al final podía dar una de las
  que viajaron si la recencia cambiaba durante el turno) y leída al final, en su
  propio `try`. De sus frases se quitan las que casan con alguna que viajó
  (`excluidas`): la memoria de la primera o la segunda pudo copiarlas cuando la
  tercera estaba entre sus recientes, y entonces viajaron. Se mide con **el mismo
  número de frases en los dos lados** (`igualadas`, repartidas por toda la
  lista), porque el comparador casa más cuantas más frases hay. Se lee
  `control.enviadas.sinApoyo` frente a `control.control.sinApoyo` por bloques de
  turnos, nunca restando turno a turno (`D-102`). `ecoRecientesControl` dice si
  hubo tercera, si tenía memoria o si falló. Todo enteros y clasificaciones; los
  nombres se han comprobado contra `redact.ts`.
- **Textos (`D-093`).** La casilla pasa a «Pasarle la memoria de sus dos últimas
  conversaciones». El pie dice que le llega entera la memoria apuntada, que no le
  llegan los mensajes, ni el plan, ni las preguntas en el aire, **y que eso no
  vuelve por ningún otro sitio**: lo prometido solo vuelve aparte si el trabajo de
  fondo lo apuntó como pendiente (el diseño decía «vuelve por su lado», y las
  preguntas en el aire no vuelven nunca). La confirmación del enganche dice «le
  llegará esa memoria entera», no «la recordará»; la rama sin memoria propia y la
  de la casilla apagada dejan de hablar de «resumen»; soltar dice que sale de «la
  memoria que les llega a sus otras conversaciones» y, con la casilla encendida,
  que lo que otra ya apuntó de aquí en su memoria se queda. El prompt dice «Es la
  memoria que se apunto…», no «un resumen corto».
- **Coste y riesgo.** Lo paga la atención del modelo, no el dinero: la pasarela
  cobra por mensaje. El prompt medido son 18.576 caracteres de mediana y 23.947
  de máximo (n=203); cada turno con la casilla puede llevar unos miles más, una
  estimación a partir del bloque `memoria`, no una medida del bloque nuevo. Con
  cuatro campos enteros hay más texto que copiar a la memoria en curso: la orden
  de no copiarlo no lo garantiza, solo se mide. Lo que la memoria de A copie de B
  sigue sin irse al borrar, excluir o soltar B.
- **Comparaciones abiertas.** `LA-054` pide no cambiar esta casilla mientras se
  mide. Esto cambia su contenido sin tocar el ajuste: los turnos que crucen el
  cambio se separan por `recientes.formato`.

**Nada de esto está medido contra una conversación real** ni visto en pantalla.

**Séptima ronda (29/09).** Revisada después por ocho revisores; su `npm run
check` a solas cayó por tiempo en una prueba ajena (aquí decía «sin revisión ni
check»). Lo que encontraron, en la octava, al final de este bloque.

- **El control no era justo.** Lo que comparten la tercera y las que viajaron
  (un apodo, un sitio de siempre) se quitaba solo del control, y seguía contando
  del lado enviado: `control.enviadas` salía siempre más alto sin que hubiera
  copia. Ahora se quita **de los dos lados** y se cuenta en `excluidas` (del
  control) y `excluidasEnviadas` (de las que viajaron). Las dos cifras miden lo
  mismo: frases que solo tiene su lado. Las medidas de antes del 29/09 no se
  comparan con las de después.
- **`ecoRecientesControl` con todo apagado.** La línea «turno privado terminado»
  lo llevaba siempre, con `sin-medida`, que no estaba dicho en ninguna parte.
  Ahora solo sale con la casilla encendida, y `sin-medida` quiere decir que ese
  turno no guardó memoria nueva o no viajó ninguna frase. Con la casilla apagada
  la línea queda como antes.
- **`clipAtWord` no es solo de la bóveda.** `parseConversationMemoryResponse`
  también la usan las Conversaciones normales de Studio —en el agente,
  `job-runner.ts`— y la comparación de modelos: su memoria también se corta
  ahora en palabra y con «…». No cambia nada más de ellas, y el agente hay que
  recompilarlo para que lo haga (`npm run build`).
- **La memoria reescrita del enganche (`D-108`)** solo viaja a sus otras
  conversaciones cuando ya la ha usado un mensaje de su hilo (`applied`): una
  `ready` todavía se puede descartar, y otra conversación podía copiarla antes.
  **Sustituido en la octava ronda**, abajo.

**Octava ronda (29/09).** Lo que dejó la revisión de la séptima. Revisada
después por ocho revisores, con `npm run check` a solas en verde (228 archivos,
4716 pruebas); lo que encontraron, en la novena.

- **Una reescrita lista no llegaba nunca.** Solo pasaba a `applied` con un
  mensaje en la enganchada, y el caso del criterio de Daniel es enganchar una
  vieja para que Lía la recuerde, sin seguirla: sus otras conversaciones
  recibían para siempre la escrita sin su ficha, justo cuando engancharla la
  hace reciente. Ahora quien la lleva fuera la apunta `applied` antes, por
  compare-and-set, igual que el turno de su hilo (`markRelinkApplied`); si no
  puede, lleva la sellada. Lo que otra conversación se lleve de ella se queda
  aunque después se vuelva a la de antes, y la fila lo dice. El control de
  `ecoRecientes` la lee sin apuntar nada: no viaja.
- **El eco casaba por los nombres.** Las memorias van en tercera persona y casi
  todas sus frases nombran a los dos: con dos raíces y el 40 %, una frase de
  cuatro o cinco casaba con cualquier otra que los nombrara, y el control se
  vaciaba por solapamientos que no lo eran. Fuera el nombre de ella (su ficha) y
  los nombres propios —mayúscula en mitad de frase— que salen en el 30 % de las
  frases o más, contando juntas las enviadas y las del control; `raicesComunes`
  dice cuántas raíces se quitaron. Criterio, no medida. Las medidas de antes no
  se comparan con las de después. *(La novena ronda cambia de dónde sale esa
  lista y cómo se casa, abajo.)*
- **Las frases de medir se partían en «3.30» o «Sr.»**: un signo solo cierra
  frase con un espacio detrás, y los tratamientos no la cierran. Solo cambia la
  medida; el bloque que se envía no pasa por ahí.
- **La confirmación del enganche** dice cuál de las dos memorias viaja —la de
  ahora hasta que la reescrita esté lista— y que por encima de 6.000 caracteres
  se quitan primero las entradas viejas. El pie de la casilla ya no dice que los
  mensajes no vuelven «por ningún otro sitio»: pueden llegarle trozos
  transcritos (`buildRecall`).

**Novena ronda (29/09).** Lo que dejó la revisión de la octava. Revisada
después por seis revisores, con `npm run check` a solas en verde (229 archivos,
4741 pruebas); lo que encontraron, en la décima.

- **La cifra principal de `ecoRecientes` dependía del control.** Los nombres
  que se ignoran se contaban sobre las frases enviadas y las de la tercera
  juntas, y con esa lista salían también `conFrasesDeRecientes`,
  `sinApoyoAqui` y `porCampo`: la misma memoria con las mismas frases enviadas
  daba cifras distintas según hubiera tercera o no, y la tercera no viaja. Ahora
  la medida principal saca su lista solo de las frases que viajaron. El control
  lleva la suya, de las dos listas juntas, y vuelve a montar con ella su lado
  enviado, así que compara con el mismo criterio en los dos lados.
  `raicesComunes` son ahora las raíces quitadas de la medida principal, sin
  control. El registro tiene las mismas claves.
- **Quitar nombres inflaba la medida.** No era «el lado prudente»: una frase de
  dos raíces con un nombre («Trabaja con Daniel») se quedaba en una y casaba con
  cualquier entrada que dijera esa palabra, y el 40 % se calculaba sobre menos
  raíces. Ahora una entrada casa con una frase solo si casa a la vez con todas
  sus raíces —lo que miraba el formato 1— y con las que cuentan (`casa`), y la
  frase que se queda con menos de min(2, n) raíces que cuentan no se mide. El
  formato 2 da así como mucho las coincidencias (`con`) que daría el 1, y la
  comparación con él en `resumen` y `decisiones` va en una sola dirección.
  `frasesDeUnaRaiz` solo cuenta ya las frases que de verdad casan con una
  palabra.
- **El resumen de la memoria nueva se partía con el partidor viejo** («El Sr.
  Pérez llegó…» eran dos entradas). Ahora lo parte `sentencesOf`, el mismo que
  trocea las frases enviadas.
- `RECENT_ECHO_FORMAT` sigue en 2 aunque cambia lo que significan esas cifras:
  dos revisores contaron en `studio.log` y `luxy.log`, solo cuántas líneas, que
  no había ninguna de formato 2. No se mezclan medidas.

**Décima ronda (29/09).** Lo que dejó la revisión de la novena. Revisada
después por seis revisores, con `npm run check` a solas en verde (229 archivos,
4751 pruebas); lo que encontraron sigue abierto, abajo.

- **El apoyo en los turnos de aquí fabricaba blanqueos.** La novena usaba `casa`
  también para el apoyo, y con los nombres en el denominador un turno de
  diálogo que hablaba del tema («pintamos la verja») dejaba de respaldar la
  frase. El apoyo (`supportedHere`) vuelve a mirar solo las raíces que cuentan,
  y `casa` queda solo para decidir si una entrada casa con una frase. Por eso el
  formato 2 da como mucho los `con` del formato 1, pero **no** como mucho sus
  `sinApoyo`.
- **`frasesSinMedir`**, entero nuevo en `ecoRecientes` («turno privado
  terminado»): las frases que viajaron y no se pueden medir, porque se quedan
  por debajo de min(2, n) raíces que cuenten. Comprobado contra
  `isSecretKeyName`. Con él, `con` frente a `frases` dice qué parte de lo que
  viajó no se podía medir.

**Lo que queda abierto** (revisión de la décima; nada de esto está corregido):

- **[importante] El control detecta menos solapamientos que en `f77efb6`.**
  `overlaps` usa `casa`, que exige casar también con todas las raíces, nombres
  incluidos. Para decir que una entrada copia es lo prudente; para quitar del
  control lo que en realidad viajó es lo contrario: la frase de la tercera que
  habla de lo mismo que una enviada se queda en el control, y el eco enviado
  parece la línea base. Reproducido con texto inventado; ninguna prueba cubre
  solapamientos con nombres. Propuesta del revisor: en `overlaps`,
  `matchesStems` solo sobre las raíces que cuentan, como el apoyo.
- **[importante] Una frase corta con un nombre que no se ignora sigue
  fabricando blanqueos.** «Trabaja con Daniel» casa con cualquier entrada que
  diga el nombre y una palabra corriente siempre que el nombre no entre en la
  lista: si sale en menos del 30 % de las frases (la memoria entera trae muchos
  hechos sin él), si se alterna con un apodo o si hay menos de cuatro frases.
  No es una regresión —el formato 1 casa igual—, pero `sinApoyoAqui` se infla.
  Propuesta del revisor: que ningún nombre propio detectado cuente para las dos
  raíces mínimas.
- Un nombre que solo abre frase no se reconoce como nombre (se busca con
  mayúscula a mitad de frase), aunque salga en todas: la medida depende de
  dónde cae el nombre.
- `recientes.cortadasAlGuardar` se cuenta antes de la salvaguarda: una entrada
  reparada que la salvaguarda quita sigue contando. Hoy la salvaguarda no
  salta, así que no tiene efecto práctico.
- La recencia cuenta desde el enganche («Que viaja», arriba): enganchar una
  conversación antigua puede desplazar a una de sus dos más recientes de
  verdad, cosa que en una nacida no pasaría. Es una decisión escrita aquí y la
  confirmación la dice; cambiarla es de Daniel.

## D-106 — leer la boveda no es actividad; la cierran la inactividad, Win+L, suspender y la X

Fecha: 2026-09-25. Autor: Claude. Contexto: `SEG-BOVEDA-001`. Daniel dejo la boveda
abierta hora y media con el ajuste en 15 minutos y no se cerro.

Estado (29/09): aceptada y construida; corregida el 28/09 y el 29/09 en ocho
rondas de arreglos, commiteadas hasta la quinta en `a45953b` y hasta la octava
en `f77efb6`. Cada ronda desde la tercera tuvo después su revisión y su `npm run
check` a solas (`TEST-RESULTS.md`): la tercera, la cuarta y la quinta, cinco
revisores cada una y check en verde (222 archivos; 4511, 4520 y 4531 pruebas,
12 omitidas); la sexta, ocho revisores y check en verde (228 archivos, 4677);
la séptima, ocho revisores y un check que cayó por tiempo en una prueba ajena
(4699 en verde, 1 caída); la octava, ocho revisores y check en verde (228
archivos, 4716). La novena y la décima no cambiaron esta decisión. Lo que dejó
la revisión de la octava sobre ella **sigue abierto**, al final. **Nada visto
en pantalla**, y que Windows 11 entregue `lock-screen` a Electron 43 **no esta
comprobado** (`LA-053`).

**La causa, medida el 23/09.** `touch()` —lo unico que reinicia el contador— lo
llamaba `subkeyFor()` sin condicion, y `subkeyFor` es la unica puerta a cualquier
contenido: leer era actividad. La propia pantalla se releia sola (dos efectos que
dependian del objeto de `useVault`, nuevo en cada render, con un latido de 5 s), y
una prueba (`vault-service.test.ts`, «usar la boveda cuenta como actividad»)
EXIGIA ese comportamiento.

**Lo que cuenta como alguien delante, y nada mas:**

1. abrir la boveda;
2. la presencia real en la pantalla Privado: `keydown`, `pointerdown`,
   `pointermove` y `wheel` con `isTrusted` y la pagina visible, como mucho un
   aviso cada 20 s (con el primer evento, no al final). El proceso principal solo
   lo cuenta con la ventana visible y con el foco. Solo en Privado: usar otra
   seccion con la boveda abierta no la mantiene viva;
3. una espera del usuario mientras dura algo que pidio el: el envio, generar una
   imagen desde el panel y aprobar una imagen pendiente. Mientras dure no se
   cierra por inactividad y la cuenta atras se queda en el limite; al soltarla
   empieza el limite. Tope de 35 minutos por espera (30 del turno local mas 5).
   Por espera, no por envio: desde la tercera ronda un envio con imagen cambia su
   espera `reply` por otra nueva al guardar el texto (`turn-image` desde la
   sexta ronda), y esa empieza su propio tope, asi que un turno lento seguido de una imagen del Horde puede
   tener la inactividad parada unos 50-60 minutos (cuarta ronda).
4. las operaciones de cuenta y el ajuste de minutos, que ya lo marcaban.

El trabajo de fondo (catalogo, pendientes, memoria de lo ya hablado,
sincronizacion) **no cuenta nunca**, aunque se lance con un boton. Marcar solo en
el borde IPC no bastaba: leer una respuesta larga no manda ningun IPC, y el borde
IPC no distingue un clic de un efecto de React, que es justo el fallo.

**Quien cierra, ademas del boton:** un modulo nuevo, `VaultLockCoordinator`, sin
Electron para poder probarlo, con el reloj de 15 s y el `powerMonitor`:

- **inactividad**: el ajuste de siempre; el 0 sigue siendo «nunca» y no se ha
  tocado;
- **suspender**: en el acto, aunque haya un envio;
- **cerrar la ventana con la X**: en el acto, aunque haya un envio. No hay
  pantalla de Windows que proteja y desde la bandeja cualquiera veria el
  contenido;
- **Win+L**: en el acto si no hay nada en camino. Con un envio suyo en curso se
  aplaza hasta que termina: su respuesta, con tope de 10 minutos desde Win+L
  (`LOCK_SCREEN_GRACE_MS`, el p99 medido de un turno privado son 616 s sobre 151),
  y, si el turno lleva imagen del proveedor de PAGO, esa imagen ya pagada, con
  tope de 15 minutos desde que el coordinador ve ese tramo
  (`LOCK_SCREEN_TURN_IMAGE_GRACE_MS`; sexta ronda; aquí decía «desde que el
  texto queda guardado», que la séptima ya declaró falso). Una imagen de AI Horde
  en el turno (octava ronda) o una generada o aprobada desde el panel no lo
  aplazan.
  Desbloquear Windows antes lo anula. Es una decision de producto que Daniel no ha
  confirmado: con la constante a 0, Win+L cierra siempre en el acto;
- salir de Luxy y cerrar la sesion de la cuenta, como antes.

Win+L, suspender y la X cierran tambien con «No cerrarla sola»: el 0 apaga la
inactividad, que es lo que dice cada opcion del desplegable.

**Lo que se corta limpio.** Un envio cortado sin respuesta retira el mensaje de
Daniel (`removeLastTurn`, que no necesita la llave) y le dice que su texto sigue
en el cuadro; con la respuesta ya guardada devuelve un resultado correcto sin nada
descifrado, para que no reenvie un duplicado. El catalogo, los pendientes y la
memoria de lo ya hablado **no marcan como fallida** una conversacion porque la
boveda se cerrara a mitad: antes la dejaban fuera de las pasadas hasta reiniciar
(`D-088`). El cursor no avanza en ningun caso.

**Registro.** Una linea «boveda abierta» `{via}` y otra «boveda cerrada»
`{motivo, abiertaMs, derivaciones, aplazadoMs?}`, escritas en un solo sitio. Solo
enteros y enumerados cerrados. `derivaciones` son las subclaves derivadas en la
sesion: si un lector se relee solo, la linea lo delata. Sustituye a «boveda
bloqueada por inactividad», que deja de escribirse. El aviso a la pantalla lleva
el motivo y el texto de vuelta lo dice («al bloquear Windows», «al suspender el
equipo», «al cerrar la ventana», «por inactividad»); un motivo mal formado da «La
bóveda se cerró.».

**Parche del bucle.** Los dos efectos dependen de la funcion y no del objeto; las
tres flechas que devolvia `useVault` pasan a `useCallback`. Una prueba estatica
(`renderer-effect-deps.test.ts`) impide que un efecto vuelva a depender de `vault`
y que `useVault` devuelva algo que no sea estado o una funcion estable.

**No se hace:** cancelar el turno del modelo al cerrar (la respuesta no se podria
guardar de todos modos); aviso de confirmacion antes de cerrar con la X durante un
envio; nota fija en Ajustes sobre Win+L, hasta que `LA-053` lo confirme.

**Revisión del 28/09 (`REV-TRES-ENCARGOS-001`).** La revisión independiente del
flujo no se hizo; una ronda posterior encontró, y se corrigió:

- **Win+L se aplazaba con CUALQUIER espera**, también generar o aprobar una imagen,
  mientras esta decisión y `LA-053` decían «con un envío suyo». Las esperas tienen
  ahora clase (`beginUserWait('reply' | 'image')`): las dos aplazan la
  inactividad, **solo `reply` aplaza Win+L**, y la línea «cierre de la boveda
  aplazado» lleva `envios`. Los 10 minutos se midieron sobre turnos privados, no
  sobre el Horde.
- **La galería de personajes sobrevivía al cierre**: nombre, ficha entera y receta
  de cada uno. Entra en la purga del renderer.
- La presencia gastaba sus 20 s con la ventana sin el foco (main no lo contaba) y
  el clic que le daba el foco podía tardar ese rato en contar. Ahora la puerta mira
  lo mismo que main —página visible y ventana con el foco— antes de gastarlos.
- `renderer-effect-deps.test.ts` solo reconocía `}, [`; ahora caza también
  `useMemo(..., [vault])` y `useCallback(fn, [vault])`.

**Sabido y no arreglado**, para que nadie lo lea como descuido:

- el mensaje de un envío cortado por el cierre se retira de la bóveda pero **se
  queda en el cuadro, en claro, en memoria de la ventana**, hasta la siguiente
  apertura. Es una excepción de privacidad deliberada —para no perderle el
  texto—, no un olvido de la purga;
- con una espera activa la cuenta atrás se queda en el límite, pero si el turno se
  cuelga, a los 35 minutos la espera deja de contar y la bóveda se cierra en la
  siguiente vuelta sin que la pantalla haya bajado nunca de ese límite;
- «Sincronizar» no es una espera del usuario: es trabajo de fondo aunque se pulse,
  como dice arriba, y una sincronización larga se puede cortar por inactividad.
  **No se reintenta sola**: `syncVault` lanza y hay que volver a pulsar. Que no
  pierda datos al cortarse a mitad **no está comprobado**: ninguna prueba cierra
  la bóveda en medio de una sincronización (`sync.test.ts` solo prueba que no
  arranca con ella cerrada), y la sincronización está rota de todos modos
  (`SEG-SYNC-001`). Corregido en la segunda ronda: antes decía «se reintenta sin
  perder datos»;
- la entrada de un control remoto (`remote-host`, `SendInput`) llegaría a Chromium
  como evento real y contaría como presencia. Hoy ese transporte no está conectado;
  cuando se conecte hay que decidir si cuenta.

**Segunda ronda del 28/09 (`REV-TRES-ENCARGOS-001`).**

- **Un turno que pedía imagen sellaba el texto de ella DESPUÉS de generarla.** Con
  AI Horde la generación puede durar hasta 10 + 10 + 3 minutos (`horde.ts`), más
  que el aplazamiento de Win+L (10) y, sumada a un turno lento, más que la espera
  máxima (35). Si la bóveda se cerraba en medio se perdía la respuesta ya pagada
  y se retiraba el mensaje de él: justo lo que el aplazamiento existe para evitar.
  Ahora **el texto se guarda primero y la imagen se genera después**
  (`generacionAplazada` en el turno); un cierre a mitad solo tira la imagen, que
  se trata como cualquier generación fallida, igual que cuando se genera desde
  el panel. No se tocan los dos topes.
- **Cerrar la sesión de la cuenta cerraba la bóveda DESPUÉS de esperar al
  servidor**, con un `fetch` sin tiempo límite propio. Ahora cierra primero y
  avisa al servidor después; el aviso solo necesita el token, que ya tenía.
- **Los descartes de «¿Es de Lía?» sobrevivían al cierre** (son UUID, pero salen
  de lo que dicen sus mensajes) y una vista previa del enganche en vuelo podía
  volver a escribir el nombre tras la purga. Los dos entran en la purga del
  renderer.

**Sabido y no arreglado, de la segunda ronda:** una imagen que se genera desde el
panel (espera `image`, que no aplaza Win+L) y a la que le llega Win+L, suspender o
la X **ya está cobrada y descargada** cuando `privateMedia.add` falla por la llave;
el `noteAttempt('failed')` también necesita la llave, así que el intento se queda
para siempre en `sent`. Se pierde una imagen pagada y el registro dice «enviada».
Lo mismo vale para la imagen de un turno si el cierre llega durante su
generación, aunque su texto ya esté a salvo: con suspender, la X, el botón o la
inactividad, y con Win+L solo si la imagen pasa de su tope (sexta ronda).

**Tercera ronda del 28/09 (`REV-TRES-ENCARGOS-001`).**

- **Un envío cortado podía borrar la respuesta anterior de Lía.** Si la bóveda se
  cerraba durante la llamada y la llamada volvía sin respuesta (`failed` o texto
  vacío), el turno retiraba el mensaje de él (`removeLastTurn`), seguía, y lo
  siguiente que necesitaba la llave lanzaba; el corte (`turnCutByLock`) veía
  «mensaje escrito, sin respuesta» y retiraba OTRA línea, que `removeLastTurn` no
  puede mirar porque no tiene la llave: la última respuesta buena de ella, con su
  memoria sellada y sin papelera. Ahora el turno marca que ya retiró el mensaje y
  el corte no retira nada más; el registro sigue diciendo `mensajeRetirado: true`,
  porque se retiró una vez. Pruebas con `failed` y con texto vacío en
  `private-turn-vault-lock.test.ts`, comprobadas fallando sin el arreglo. Iba
  contra `D-088` y contra «falla limpio».
- **Win+L se aplazaba por la imagen de un turno.** Desde la segunda ronda el texto
  se guarda antes de generar la imagen, pero todo seguía dentro de la espera
  `reply`, así que un Win+L esperaba a que acabara la imagen (hasta 10 minutos)
  con la respuesta ya a salvo: lo contrario de lo que dicen esta decisión,
  `LA-053`, `CLAUDE.md` y `AGENTS.md`. Se arregla en el código, que es lo que
  dicen los documentos: en cuanto su texto está en disco, el envío cambia su
  espera `reply` por una `image` (primero abre la nueva y luego suelta la vieja,
  para que la inactividad no encuentre un hueco). La inactividad sigue sin
  cerrarla mientras se genera, como desde el panel. Un Win+L aplazado se cumple en
  la siguiente vuelta del reloj y tira la imagen, que ya estaba en «Sabido y no
  arreglado». (Sexta ronda: eso tiraba una imagen pagada en TODOS los turnos con
  imagen y un Win+L aplazado; ahora el aplazamiento cubre también esa imagen.) Prueba en `private-turn-image.test.ts`, comprobada fallando sin el
  arreglo.
- **La prueba de `account-manager.test.ts` que caducó con la suite entera** no
  tenía ningún fallo de aserción: son cuatro derivaciones de clave reales. Sola,
  tres veces seguidas: 8,9 s, 11,3 s y 9,0 s, con el tope global en 20 s. Esa
  prueba, y solo esa, tiene ahora 60 s, con el motivo al lado. No se rebaja el
  coste de la derivación: dejaría de probar la de verdad.

**Cuarta ronda del 28/09 (`REV-TRES-ENCARGOS-001`).**

- **`removeLastTurn` retira por `recordId`, no «la última línea».** Es la raíz del
  fallo de la tercera ronda y del siguiente: sin la llave no se mira el rol, pero
  el `recordId` va en claro. El envío guarda el del mensaje de Daniel y solo se
  retira si la última línea es esa; si detrás quedó otra, no se toca nada. La
  marca `userTurnRetired` sigue, y ahora son dos guardas.
- **«Sincronizar» a mitad de un envío** (venía de antes de `D-106`). Subía el
  mensaje de Daniel aún sin respuesta; si luego se retiraba, el servidor lo
  conservaba (la subida es idempotente por secuencia) y descartaba en silencio el
  mensaje bueno que ocupaba después ese número. Ahora `syncVault` deja para la
  siguiente los TURNOS de la conversación que está en `sendInFlight`: lo mira
  antes de subir y justo antes de cada escritura de lo bajado, sin esperas en
  medio. La pantalla dice que esa conversación irá la próxima vez. Sus medios
  (`syncMedia`) sí viajan en la misma pasada: no dependen de la secuencia
  (quinta ronda: antes decía «entera»). Sigue siendo trabajo de fondo, como
  arriba.
- **Un turno que lanza con la bóveda abierta** (el agente parado) dejaba el
  mensaje de Daniel sin respuesta en el historial, con su texto también en el
  cuadro: al reenviar salía dos veces. Se retira igual que cuando la llamada
  vuelve vacía (`retireUnansweredTurn`, una vez y por `recordId`).
- **El tope por envío** queda escrito arriba: 35 minutos por espera, y un envío
  con imagen tiene dos. No se cambia: acortar la de la imagen haría que la
  inactividad la tirase a mitad.

**Quinta ronda del 28/09 (`REV-TRES-ENCARGOS-001`).** Hasta la sexta ronda esta
viñeta estaba dentro del bloque de la cuarta.

- **Un envío por conversación.** El envío no rechazaba un segundo a la misma
  conversación con otro en curso —la pantalla pierde su `sending` si la ventana
  se recarga a mitad (Ctrl+R o un cuelgue); salir de Privado y volver no lo
  reinicia, porque `useVault` vive en `App` (corregido en la sexta ronda: antes
  decía que sí)—, y `sendInFlight` es un `Set`: el primero en terminar quitaba
  la marca con el segundo aún en vuelo. Ahora el segundo se rechaza antes de
  escribir nada («esa conversacion esta contestando ahora mismo»), y el texto
  sigue en el cuadro. Con eso, la retirada por `recordId` que no casa por una
  línea ajena detrás ya no la alcanza ningún camino conocido. Y si
  `userRecordId` faltara, el turno no retira nada en vez de caer a «la última
  línea».

**Sexta ronda del 28/09 (`REV-TRES-ENCARGOS-001`).** Lo que dejó la revisión de
la quinta. Revisada después por ocho revisores, con `npm run check` a solas en
verde (29/09, 4677 pruebas; aquí decía «sin revisión propia ni check»).

- **Win+L tiraba la imagen del turno, ya pagada, casi siempre.** Tras guardar el
  texto, el envío soltaba `reply` y arrancaba la imagen; el cierre aplazado se
  cumplía en la vuelta siguiente del reloj (15 s como mucho), antes de que
  terminara ninguna generación, y `privateMedia.add` y `noteAttempt` fallaban
  por la llave: imagen cobrada, no guardada, intento para siempre en `sent`. Es
  justo lo que el aplazamiento existe para evitar. Decisión de quien coordina:
  la imagen del turno es una tercera clase de espera, `turn-image`, que aplaza
  Win+L como `reply`, con su propio tope: **15 minutos desde que el coordinador
  ve ese tramo**, que es cuando el texto queda guardado si Win+L llegó antes, o
  Win+L si llegó con el texto ya guardado; desde el texto pueden pasar hasta 35,
  el tope de toda espera (`MAX_USER_WAIT_MS`; aquí decía «casi 30», octava ronda).
  Cubren el presupuesto nominal del proveedor de pago —dos de arranque, diez de
  sondeo y un margen de descarga—, **no su peor caso**, que no tiene tope
  (séptima ronda, abajo); después cierra.
  Una cola del Horde más larga se pierde: sus kudos no son dinero (la octava
  ronda deja de esperar al Horde, abajo). En el peor
  caso la llave queda en memoria 25 minutos con Windows bloqueado; nadie ve nada
  mientras. La `image` del panel sigue sin aplazar nada. La línea «cierre de la
  boveda aplazado» lleva ahora `imagenesDelTurno` junto a `envios`. Que el
  proveedor cobre al arrancar se da por hecho, no se ha mirado en una factura.
  Pruebas en `vault-lock-coordinator.test.ts` (tres) y `private-turn-image.test.ts`,
  comprobadas fallando sin el arreglo.
- **Borrar una conversación con un envío en vuelo la resucitaba** con solo la
  respuesta de ella (`appendTurn` sobre un archivo ya borrado). Venía de antes de
  `D-106` y solo se alcanza con la ventana recargada a mitad. Ahora se rechaza,
  como olvidar la memoria y el enganche. Prueba en
  `private-turn-vault-lock.test.ts`, comprobada fallando sin el arreglo.
- **Un turno que lanza con la bóveda abierta** ya retiraba el mensaje una sola vez
  desde la cuarta ronda; comprobado de nuevo en el código y con dos pruebas más
  (el primer mensaje de la conversación, y con una línea ajena detrás, que no se
  toca).

**Séptima ronda (29/09), lo que dejó la revisión de la sexta.** Revisada después
por ocho revisores; su `npm run check` a solas cayó por tiempo en una prueba
ajena (aquí decía «sin revisión ni check»).

- **«15 minutos desde el texto» era falso.** El tope de la imagen del turno
  cuenta desde que el coordinador ve ese tramo (`imageSince` se pone en la
  primera vuelta que lo ve, nunca antes de Win+L). Con Win+L llegando a los doce
  minutos del texto, cierra hacia los veintisiete, y es lo esperado. Lo decían
  mal `CLAUDE.md`, `AGENTS.md`, `LA-053`, `CURRENT-TASK.md` y `CHANGELOG-WORK.md`;
  el código no cambia.
- **«El tope no corta una imagen que él aún iba a entregar» no sale del
  código.** `awaitGeneration` mira su plazo antes de una espera de hasta unos
  20 s y de una lectura que puede tardar 120 s, y `downloadOutput` no tiene tope
  propio: el peor caso del proveedor pasa de los quince minutos. Queda escrito
  como presupuesto nominal. La llave sigue sin quedarse en memoria sin límite.
- **Cortar no cancela.** Nada aborta la generación al cerrar la bóveda: el envío
  sigue en vuelo, la pantalla en «Esperando respuesta…» y Enviar apagado en
  todas las conversaciones hasta que termina; si termina con la bóveda ya
  reabierta, la imagen se guarda. No se cambia en esta ronda: cancelarla tira
  una imagen que todavía se podía guardar, y es una decisión de Daniel.
- **Borrar con un envío en vuelo, otra vez.** El rechazo de la sexta miraba
  `sendInFlight` una sola vez, antes del primer `await`; un envío que arrancara
  en ese hueco resucitaba la conversación igual. Borrar la conversación y
  borrar su memoria apuntan ahora la conversación en `erasingInFlight` mientras
  duran, y el envío (y «Reescribir con su ficha») se rechaza con «se esta
  borrando algo de esta conversacion». Prueba en `conversation-relink.test.ts`,
  comprobada fallando sin el arreglo.

**Octava ronda (29/09), lo que dejó la revisión de la séptima.** Revisada
después por ocho revisores, con `npm run check` a solas en verde (228 archivos,
4716 pruebas).

- **La imagen de AI Horde ya no aplaza Win+L.** La regla decía «esa imagen ya
  pagada», y el Horde no cobra; además su cola puede pasar de los 23 minutos,
  así que el tope solía llegar antes: la llave quedaba 15 minutos en memoria
  con Windows bloqueado para perder la imagen igual. Con el Horde, la imagen del
  turno se espera como `image` (frena la inactividad, no aplaza Win+L). Prueba
  en `private-turn-image.test.ts`, comprobada fallando sin el arreglo.
- **El aviso del corte decía algo falso.** Si el tope cierra la bóveda y la
  imagen termina con ella cerrada, el envío salía con «se cerró justo después
  de guardar su respuesta», y al turno siguiente le llegaba como motivo el error
  interno de la bóveda bloqueada. Ahora el aviso dice que la respuesta está
  guardada y la imagen se ha perdido (`SEND_CUT_BY_LOCK.imageLost`), y el motivo
  es «la bóveda se cerró mientras se hacía y la imagen se perdió». Prueba de
  integración del cierre durante la imagen: aviso, sin segunda retirada y el
  intento en `sent`.
- **Faltaba una prueba**: con Win+L pulsado ya en el tramo de la imagen, el tope
  cuenta desde Win+L y corta a los 15 minutos.
- **La cifra**: desde el texto guardado pueden pasar hasta 35 minutos, no «casi
  30» (arriba y en `LA-053`).

**Lo que queda abierto** (revisión de la octava; la novena y la décima no lo
tocaron). Dos menores, ninguno rompe:

- Tres comentarios de `vault-lock-coordinator.ts` —el de
  `LOCK_SCREEN_GRACE_MS`, el de `LOCK_SCREEN_TURN_IMAGE_GRACE_MS` y el de
  `lockScreen`— siguen diciendo que se espera la imagen del turno sin decir que
  solo la del proveedor de pago, y uno dice que «una cola del Horde más larga
  se pierde». El código, esta decisión, `CLAUDE.md`, `AGENTS.md` y `LA-053`
  dicen lo contrario: la imagen del Horde no aplaza Win+L.
- Con un cierre por Win+L ya aplazado, la bóveda sigue abierta la vuelta de
  reloj que falta, y la pasada de `MemoryRelink.sweep` que sigue a un envío
  puede lanzar una reescritura con el CLI que se tirará seguro (`cut`) y ocupa
  el carril compartido. La bóveda no se queda abierta por ello: ese camino no
  toca `touch` ni `beginUserWait`. Propuesta del revisor: no lanzar trabajo de
  fondo mientras haya un cierre aplazado.

## D-107 — el razonamiento se elige por modelo, solo con lo que su documentación admite, y el registro dice si razonó

Fecha: 2026-09-28. Autor: Claude. Contexto: `F34-RAZONAMIENTO-001`. Daniel lo
aprobó **para probarlo**, con sus palabras: «no estoy seguro de que pueda
cambiarse el razonamiento de los modelos».

Estado (29/09): aceptada e implementada; commiteada hasta la octava ronda en
`f77efb6`, y la novena sin commitear. Revisada tras construirla por ocho
revisores con `npm run check` a solas en verde (4677), tras la séptima por ocho
(su check cayó por tiempo en una prueba ajena), tras la octava por ocho con
check en verde (4716), tras la novena por seis con check en verde (4741) y
tras la décima por seis con check en verde (4751). Lo que queda abierto, al
final. **Sin probar contra la pasarela real ni contra la API de Z.AI, y sin
verse en pantalla** (`LA-055`, `LA-058`).

Corrige en parte el párrafo de `D-082` que dice que una conexión HTTP no ve el
selector porque `chat completions` «no tiene dónde ponerlo». El contrato de
OpenAI no tiene un campo común, pero cada proveedor documenta el suyo. `D-082`
sigue igual para Claude y Codex, y este control es otra cosa: es **por modelo y
se guarda**, como el muestreo de `D-102`, porque su propósito es medir.

### Qué es

Un campo más en el muestreo, `reasoningMode`, con tres valores: `off` («Sin
razonar»), `low` («Razonar poco») y `high` («Razonar más»). **Vacío por defecto,
y vacío no manda nada**: el cuerpo sale igual que hoy, clave por clave (`D-098`).
Vive en `samplingParametersShape`, así que llega por los dos caminos: por modelo
en una conexión (`modelSampling`) y en el nivel superior de un proveedor HTTP,
que es como se configura Groq. Una entrada por modelo con solo el razonamiento
es válida; `{}` se sigue rechazando.

Se llama `reasoningMode` y no `reasoning` ni `thinking` porque esos dos son
nombres reales de campos del cuerpo: con el mismo nombre, alguien acabaría
volcándolo crudo.

### Qué viaja, y a quién (`packages/shared/src/reasoning-control.ts`)

Una tabla traduce la elección al dialecto de cada modelo. Los nombres casan
**enteros** y sin distinguir mayúsculas: un nombre con sufijo de agregador
(`-promo`, `-free`, `-alibaba`) se queda sin regla. **A un modelo sin regla no se
le manda nada**, ni con un valor escrito a mano en `config.json`: mejor eso que
un 400.

| Modelo | Valores | Qué viaja | Fuente |
|---|---|---|---|
| DeepSeek-V4-Flash, V4-Pro, V4.1-Flash (nombres de la pasarela) | solo `off` | `thinking:{type:'disabled'}` | api-docs.deepseek.com/guides/thinking_mode, que no nombra estos modelos (abajo, «Lo que queda abierto») |
| glm-5.3, glm-5.3-flash | `low`, `high` | `reasoning_effort` | docs.z.ai/guides/capabilities/thinking y docs.z.ai/api-reference/llm/chat-completion |
| glm-5.2 | `off`, `high` | `thinking` / `reasoning_effort` | ídem; `low` y `medium` los trata como `high` (novena ronda) |
| glm-5.1, glm-5, glm-4.6, glm-4.5 | solo `off` | `thinking` | la página de cada modelo, docs.z.ai/guides/llm/glm-4.5 (y -4.6, -5, -5.1); la guía de razonamiento dice lo contrario (novena ronda) |
| kimi-k3 | `low`, `high` | `reasoning_effort` | platform.kimi.ai |
| mimo-v2.5, v2.5-pro, v2.6-flash, v2.6-pro, v2.6-pro-ultraspeed | solo `off` | `thinking` | mimo.mi.com |
| MiniMax-M3 | solo `off` | `thinking` | platform.minimax.io |
| Qwen3.8-27B, qwen3.8-flash, qwen3.8-max | solo `off` | `enable_thinking:false` **y** `chat_template_kwargs.enable_thinking:false` | docs.qwencloud.com; docs.vllm.ai |
| `qwen/qwen3.8-27b`, **solo en api.groq.com** | `off`, `low`, `high` | `reasoning_effort` (`none` para `off`); `low`/`high` añaden `reasoning_format:'parsed'` | console.groq.com/docs/reasoning |
| `openai/gpt-oss-20b` y `-120b`, **solo en api.groq.com** | `low`, `high` | `reasoning_effort` | ídem |

Decisiones dentro de la tabla, cada una por un motivo concreto:

1. **DeepSeek solo se apaga.** Medido en `luxy.log`: por la pasarela, 38 de 39
   llamadas de DeepSeek-V4 **no razonaron** (3,07-3,61 caracteres por token, 0
   de razonamiento). La documentación dice que viene encendido, pero lo medido
   manda. Ofrecer «razonar» lo encendería, y la misma página dice que con
   `tools` hay que devolverle `reasoning_content` en cada petición siguiente o
   contesta 400: Luxy no lo devuelve. Sería un fallo nuevo en los trabajos con
   herramientas, además de anular la temperatura que `D-102` está midiendo.
2. **GLM-5.3 y kimi-k3 no se pueden apagar.** Z.AI dice que en la serie 5.3
   `disabled` da error; Kimi dice que no se mande `thinking`. De fábrica los dos
   razonan al máximo, así que «Razonar más (high)» también es menos que lo de
   siempre, y la pantalla lo dice.
3. **La regla de los GLM que sí se apagan va anclada con `$`.** La primera versión
   usaba un límite de palabra tras el número y `glm-5.3-air` caía en ella por el
   «5»: se le habría ofrecido justo lo que en la 5.3 da error.
4. **Qwen lleva las dos formas.** La pasarela no dice qué motor hay detrás.
   QwenCloud lee `enable_thinking` en la raíz; vLLM, `chat_template_kwargs`.
   Pedir una sola y equivocarse da un «apagado» que no apaga y que nadie ve. Un
   servidor estricto que rechace la otra contesta un 4xx, que no se reintenta
   ni se cobra, y el registro lo dice.
5. **Qwen3.8-Flash-Next no tiene regla**: no aparece en la documentación que se
   pudo leer, aunque es el modelo del caso de 8192 de 8192 tokens sin un
   carácter. **qwen3.8-max solo se apaga**: dos lecturas de la misma página se
   contradicen sobre si viene encendido, y su `reasoning_effort` (low, medium,
   xhigh) no tiene `high`; apagarlo vale con las dos lecturas.
6. **Groq depende del host.** `openai/gpt-oss-20b` es también un nombre de
   OpenRouter, con otro dialecto. Y Qwen en Groq devuelve el razonamiento
   **dentro** de la respuesta (`reasoning_format` `raw` por defecto): por eso
   `low` y `high` piden `parsed`, que lo manda aparte.

### Que Luxy lea el razonamiento venga por donde venga

Hasta hoy solo se contaba `delta.reasoning_content`, y solo con transmisión.
Ahora se cuentan también `delta.reasoning` y `message.reasoning` (vLLM y Groq),
las ramas sin transmisión, lo que va entre `<think>`, `<thinking>` o
`<reasoning>` dentro del propio texto, y `completion_tokens_details.reasoning_tokens`.
Medido: las 9 llamadas a gpt-oss por Groq tenían 0 caracteres razonados con un
cociente de 0,23 a 1,48. **No era que Groq lo ocultara: era que Luxy no leía el
campo.** Así que «la pasarela oculta el razonamiento de Qwen» sigue sin estar
demostrado: con esto, la próxima llamada lo dirá.

Las etiquetas `<think>` **se cuentan, no se quitan** del texto que ve Daniel. Eso
ya pasaba y no se toca aquí.

### Cómo se sabe si razonó

Cada línea «llamada al proveedor» lleva ahora, **siempre** y solo con cifras o
códigos: `reasoningField` (por dónde llegó razonamiento visible),
`reasoningTagChars`, `toolArgChars`, `reasoningTokensReported`, `charsPerOutput`
y `reasoningVerdict`. Con un modo elegido, además `reasoningMode` y
`reasoningSent` (las claves que viajaron, o `not_sent`).

`charsPerOutput` = (caracteres de texto + nombres y argumentos de herramientas) /
tokens de salida. Los argumentos cuentan porque también son salida: sin ellos,
una vuelta que solo pide una herramienta daba un falso «oculto». El veredicto,
en este orden: `visible` si llegó razonamiento que se ve (por un campo o entre
etiquetas), aunque el proveedor declare además tokens; `counted` si el
proveedor declaró tokens de razonamiento y no llegó nada que se vea: razonó sin
enseñarlo, y eso lo dice él, no es una deducción (novena ronda; antes `counted`
se decidía primero); `no_data` sin consumo final; `unclear` en una vuelta que
pide herramientas con menos de 400 caracteres de prosa (séptima ronda, abajo);
`hidden` con un cociente de 2,0 o menos; `not_seen` con 2,8 o más; `unclear`
entre medias. Los umbrales
salen de lo medido: sin razonar, 3,07-3,77; con razonamiento que no llega,
0,10-1,68 (Qwen3.8-27B por la pasarela) y 0,23-1,48 (gpt-oss por Groq).
**`not_seen` no significa «no razonó»**: un razonamiento de menos del 15-20 % de
la salida no se distingue.

Los nombres están elegidos contra `redact()`. El del diseño, `visiblePorToken`,
acababa en «Token» y **salía a disco como `[REDACTADO]`**: la única cifra de la
prueba. Hay una prueba que escribe la línea de verdad y compara campo a campo.

El aviso de «agotó el límite de salida» añade, cuando no hubo razonamiento
visible y sí tokens gastados, que probablemente razonó sin enseñarlo y que pruebe
«Sin razonar». Dice «probablemente» porque también cabe un formato que Luxy no
lee (`D-093`).

### En pantalla

Conexiones, junto a la temperatura: en el muestreo por modelo de una conexión y
en el formulario de un proveedor HTTP. La primera opción es siempre «Lo que
traiga el modelo (no se envía nada)». Un modelo sin regla ve el selector
apagado. El texto dice que **no se sabe si la pasarela lo deja pasar y que el
registro lo dirá**. Guardar un valor que ese modelo no admite se rechaza con el
campo nombrado; si el valor guardado deja de valer al cambiar el modelo, se
sigue enseñando con su aviso en vez de borrarse solo.

### Lo que queda sin saber

- Qué versión de NewAPI y qué ajustes de canal tiene la pasarela: un canal con
  `param_override` o con «thinking to content» puede tirar o transformar el campo.
- Los textos de la documentación se leyeron con WebFetch, que resume con un
  modelo pequeño; las frases decisivas (DeepSeek y el 400 con `tools`; GLM-5.3 y
  el error al apagar; los valores de Groq) se pidieron literales.
- Volver a un Studio anterior con una entrada que solo tenga `reasoningMode`
  deja esa entrada vacía al leerla, el esquema la rechaza y la configuración no
  abre hasta quitarla a mano.

### Séptima ronda (29/09)

- **Contar los argumentos no evitaba el falso «oculto».** Los tokens de una
  llamada a herramienta incluyen su envoltura —en DeepSeek
  `<｜tool▁calls▁begin｜>…`, en gpt-oss el canal `commentary`—, que no llega en
  `name + arguments`, y la pasarela suele volver a serializar los argumentos más
  compactos. Un `read_file` con `{"path":"src/a.ts"}` daba 1,12 y `hidden` sin
  razonar. Ahora una vuelta con herramientas y menos de 400 caracteres de prosa
  (`TOOL_TURN_PROSE_MIN_CHARS`) sale `unclear`. **No está medido**: `luxy.log` no
  tenía ninguna llamada con `tool_calls`.
- **Las etiquetas.** Un `<think>` vacío o solo con espacios —lo que deja un Qwen3
  híbrido con el razonamiento apagado si el servidor no aparta el bloque— ya no
  cuenta como razonamiento (daba `visible` en la prueba de «Sin razonar»). Y una
  respuesta con el cierre `</think>` sin la apertura, porque la plantilla la
  puso en el prompt (R1, QwQ, variantes «Thinking»), cuenta como razonamiento lo
  de antes del cierre (daba `not_seen`). Depende del servidor; no se ha visto en
  los registros reales.
- **`DeepSeek-V4.1-Pro`** casaba con la expresión y no está en la tabla ni en la
  documentación comprobada: fuera, por el principio del título de esta decisión,
  solo lo que la documentación admite (aquí decía «regla 3», que es la de los
  GLM; octava ronda). La nota de DeepSeek decía «Medido:
  por tu pasarela…» en cualquier host; ahora dice que es de la pasarela de
  entonces y que en otra conexión no se ha medido. El aviso de DeepSeek de
  Conexiones solo dice «Con «Sin razonar», sí» donde Luxy sabe pedirlo.
- **La pantalla.** La pista mandaba a «Sistema», que no existe: es «Registros»
  (también en `LA-055`). Explica los seis veredictos y presenta `hidden` como lo
  que es, una deducción. El error de un valor que el modelo no admite nombra la
  opción de verdad —«Lo que traiga el modelo»— y lleva dentro la nota del
  modelo, que antes desaparecía.

### Octava ronda (29/09)

Lo que dejó la revisión de la séptima. Revisada después por ocho revisores, con
`npm run check` a solas en verde (228 archivos, 4716 pruebas).

- **Una salida corta salía `hidden`.** Con 2 a 5 tokens —«Hecho.», «Listo», un
  JSON breve— el token de fin y el troceo pesan más que la prosa: 6 caracteres
  en 4 tokens daban 1,5. Por debajo de **64 tokens de salida**
  (`REASONING_JUDGE_MIN_OUTPUT`) sale `unclear`. Es un criterio, no una medida:
  un razonamiento oculto de verdad gasta cientos de tokens y por encima se sigue
  viendo. La pista ya no dice «casi seguro», dice «probablemente».
- **Una etiqueta citada no es razonamiento.** Un trabajo sobre el propio
  repositorio, o una respuesta que explica el formato, nombra `<think>` entre
  acentos graves y salía `visible`. Lo que va en un bloque de código o entre
  acentos graves ya no se mira. Una etiqueta escrita a pelo en la prosa sigue
  contando: no se distingue.
- **`reasoning` y `reasoning_content` con el mismo texto** se sumaban. vLLM,
  según lo que se recuerda de su código y sin verlo en una respuesta real, copia
  uno en otro por compatibilidad. Con el mismo texto se cuenta una vez.
- **La pantalla.** La pista es más corta y dice los pasos (enviar, Registros,
  «Actualizar», buscar «llamada al proveedor»): Registros solo carga las últimas
  líneas. El aviso de DeepSeek ya no afirma sin condición que «Sin razonar»
  devuelva la temperatura: solo si la pasarela deja pasar el ajuste.

### Novena ronda (29/09)

Lo que dejó la revisión de la octava. Revisada después por seis revisores, con
`npm run check` a solas en verde (229 archivos, 4741 pruebas), y otra vez tras
la décima, que no tocó esta decisión (4751): nada importante.

- **GLM-5.2: «No admite low» era falso.** La referencia de la API
  (docs.z.ai/api-reference/llm/chat-completion) dice que en GLM-5.2 `low` y
  `medium` se tratan como `high`, `xhigh` como `max`, y `none` o `minimal` no
  razonan. La regla sigue ofreciendo solo `off` y `high`: «Razonar poco (low)»
  prometería menos razonamiento del que da. La nota en pantalla lo dice así.
- **GLM-5.1, GLM-5, GLM-4.6 y GLM-4.5 (solo `off`): la documentación de Z.AI
  se contradice, y la regla se queda.** En contra, el encabezado de la guía de
  razonamiento: «Disable deep thinking (GLM-5.3 is no longer supported, only
  GLM-5.2 supports it)». A favor, la página de cada modelo: la de GLM-4.5 lo
  dice en prosa («enable or disable by setting the thinking.type parameter»),
  y las de 4.6, 5 y 5.1 traen en el ejemplo de su propio modelo `thinking` con
  «Optional: "disabled" or "enabled"»; y la referencia de la API solo dice
  «can only be enabled» de la serie 5.3. Manda la documentación de ESE modelo,
  el principio del título. La nota en pantalla dice la contradicción y la
  salida: si la pasarela contesta con un error, volver a «Lo que traiga el
  modelo» (`D-093`). **Pendiente de Daniel**: si prefiere la lectura estricta
  del encabezado, basta con borrar la regla `glm`. Que esos cuatro acepten
  `disabled` **no se ha probado** contra la API.
- **GLM-5.3**: el comentario cita ya la referencia de la API («only the low /
  high / max levels», `max` de fábrica). No cambia nada.
- **`visible` antes que `counted`** (arriba, «Cómo se sabe si razonó»). Con el
  recuento primero, «razonó y se ve» salía igual que «razonó y la pasarela no
  lo deja pasar», que es justo lo que esta decisión quiere averiguar. En
  `providers.test.ts` dos expectativas pasan de `counted` a `visible` (en las
  dos llegaba `reasoning_content`) y una prueba nueva sin flujo fija `counted`
  con tokens declarados y nada visible. Ningún otro código compara el
  veredicto. Esas dos expectativas no se vieron fallar sin el cambio: el
  agente importa `@luxy/shared` compilado, y el `dist` ya estaba reconstruido;
  en las pruebas de shared sí se vio.
- **La pista del Razonamiento en el formulario del proveedor HTTP**
  (`reasoningFieldHint`, pura, en `Config.tsx`) dice que el valor es del
  proveedor, que viaja con cualquier otro modelo suyo que lo admita, que a los
  demás no se les envía nada y que las opciones son las del modelo del
  formulario (`samplingFor` sobre `modelFor(request)`). La de los veredictos
  dice que `counted` es que el proveedor dice que razonó sin enseñarlo, y
  manda a mirar cuánto en `reasoningTokensReported`: no hay umbral medido para
  un recuento mínimo.
- La documentación se leyó otra vez con WebFetch, que resume con un modelo
  pequeño; se pidieron las frases decisivas textuales y se cruzaron la guía, la
  referencia de la API y cinco páginas de modelo. `curl` directo se denegó por
  permisos.

**Lo que queda abierto** (revisión de la décima). Dos menores:

- La pista del proveedor HTTP dice que el valor viaja con cualquier otro modelo
  suyo «si no tiene su propio ajuste», y un proveedor de `providers.http` no
  puede tenerlo (`modelSampling` solo existe en las conexiones): insinúa una
  salida que no existe. Lo principal sí es cierto.
- **La regla de DeepSeek no se puede rastrear hasta su fuente.** La página
  citada no nombra ninguno de sus tres modelos. Según la de precios
  (api-docs.deepseek.com/quick_start/pricing), los nombres de la API son
  `deepseek-flash` (versión DeepSeek-V4.1-Flash) y `deepseek-v4-pro`, los dos
  con modo sin razonar, y `deepseek-v4-flash` es un nombre retirado; los de la
  regla son los de la pasarela. `deepseek-flash` se queda sin regla, que es lo
  conservador. No se ofrece nada que DeepSeek no admita; el comentario del
  código sigue diciendo «la documentación de ese modelo».

### Cómo se prueba con Daniel

Qwen3.8-27B por la pasarela, «Sin razonar», bloques de ocho turnos o más y **sin
tocar la temperatura a la vez** (`D-102`). Éxito: `reasoningVerdict` `not_seen`,
`charsPerOutput` de 2,8 o más y la primera palabra en segundos, no en minutos. Si
sigue `hidden` con `reasoningSent` `enable_thinking+chat_template_kwargs`, el
motor o la pasarela lo ignoran. Si aparece `reasoningField` `reasoning`, la
pasarela nunca lo ocultaba.

## D-108 — una conversación enganchada queda como una empezada con su personaje: memoria reescrita con su ficha, atada a la sellada, y firma entera

Fecha: 2026-09-29. Autor: Claude. Contexto: `F33-IGUAL-001`. El criterio es de
Daniel, literal: «si quiero que una conver que pensaba que era con Lia pase a ser
de Lia, quiero que se actualice en todas partes, que recuerde la conversacion,
que en resumen no hubiese diferencia con si hubiese empezado la conversacion con
ella».

Estado (29/09): aceptada e implementada; commiteada hasta la octava ronda en
`f77efb6`, y la novena y la décima sin commitear. Cada ronda tuvo después su
revisión y un `npm run check` a solas (`TEST-RESULTS.md`): la construcción,
ocho revisores y check en verde (4677); la séptima, ocho revisores y un check
que cayó por tiempo en una prueba ajena; la octava, ocho revisores y check en
verde (228 archivos, 4716); la novena, seis revisores y check en verde (229
archivos, 4741); la décima, seis revisores y check en verde (229 archivos,
4751). Lo que dejó la revisión de la décima **sigue abierto**, al final. **Sin
ninguna reescritura real hecha por un CLI y sin verse en pantalla.** Se prueba
con `LA-057`.

Diseño y refutación: flujo `wf_b1411ff7-0ef` (`disenar:equivalencia`,
`refutar:equivalencia`). La refutación encontró ocho fallos en el diseño; los ocho
quedan cerrados o explicados abajo. Modifica una parte de `D-103` (la firma) y
completa `D-087`/`D-088` con un trabajo de fondo nuevo.

### Qué ya era igual al enganchar, comprobado en el código

La ficha, las instrucciones, el grupo y el título, el índice de recuerdos, el
catálogo, la ficha retroactiva, la receta y las imágenes, las exclusiones y las
tres casillas por personaje salen de `owner()`/`list()` o no miran al dueño. No se
tocan.

### Las siete diferencias, y qué se hizo con cada una

1. **La memoria sellada, escrita sin la ficha.** Es la grave: la instrucción de
   cada turno pide conservar lo válido de la anterior, así que «la IA», otro
   nombre o rasgos que contradicen la ficha se arrastraban para siempre. Se
   **reescribe con la ficha** (ver «La reescritura», abajo).
2. **La foto de perfil.** Se copia **al enganchar**, no en el mensaje siguiente
   (`ensureProfilePhoto`, el mismo helper que el turno). Y se arregla un defecto
   que tenían también las nacidas: la foto de perfil se reconocía solo por
   `characterId`, que llevan también las imágenes generadas de ella. Toda imagen
   generada se anunciaba al modelo como «su foto de perfil — …», y una generada
   antes de enganchar impedía copiar el avatar. Ahora decide `isProfilePhotoOf`
   (`packages/shared/src/vault-image-request.ts`): mismo `characterId`, sin
   `attemptId` y `prompt` nulo o igual a `PROFILE_PHOTO_LABEL` (los avatares
   viejos guardaban ahí la etiqueta). Se usa en los tres sitios: la copia, el
   anuncio al modelo y el aviso de «Soltar». **No está comprobado contra los
   medios reales**: no se descifra la bóveda. Consecuencia también en una
   nacida, sin cambio de código (revisión de la octava): si su galería solo
   tiene imágenes generadas de ella y ninguna copia del avatar —el avatar se
   puso después, o Daniel borró la copia—, en su próximo turno recibe la foto
   de perfil como medio nuevo, y la lista de medios que ve el modelo cambia. Es
   lo correcto; antes no pasaba solo por el fallo.
3. **La firma** (`replySpeaker`). En una enganchada, todas sus respuestas
   llevan su nombre, también las de antes del ancla, salvo las escritas con la
   ficha de OTRO personaje en vigor (`lastForeignSequence` en `vault-owner.ts`,
   `foreignUpTo` en la vista). Con dueño por turno —las conversaciones del
   Studio anterior— se firma como en `a45953b`: solo lo de después del turno
   que lo fijó; y si no se puede saber, también como en `a45953b`. La séptima
   ronda firmaba todas las respuestas con dueño; la octava lo dejó así. Esto
   **modifica `D-103`**, que firmaba solo lo escrito con su ficha. La firma dice
   de quién es la conversación, no con qué ficha se escribió cada mensaje, así
   que no promete nada falso (`D-093`). El
   separador del hilo se queda en «Enganchada a Lía el …», sin «Lo de arriba se
   escribió sin su ficha». `signedAfter` sigue existiendo: lo usan el separador y
   «Nació con».
4. **Un único lector de memoria.** `effectiveSealed` en `handlers.ts` (sobre la
   pura `effectiveSealedMemory` de shared) lo usan el turno, la sonda de
   compatibilidad, el resumen de sus otras conversaciones (`D-105`) y «Lo que
   recuerda». Si uno leyera la sellada a secas, el panel enseñaría una memoria y
   el prompt llevaría otra. Los que solo preguntan si existe memoria sellada
   (`planOwnerChange.hasOwnMemory`, el diagnóstico, `recap-sync`) no cambian.
5. **El cursor de pendientes si el CLI se niega.** Comprobado en el código, el
   diseño lo describía mal: una negativa **no** deja bloqueadas las promesas. Al
   enganchar, el cursor deja de valer y la guarda de desfase bloquea hasta la
   relectura; si esa relectura se niega, la negativa se persiste
   (`persistRefusal`) y `selectPendingForTurn` saca esa conversación de la
   guarda. Lo mismo con un proceso que falla (`failedConversations`). No se
   cambia código; se fija con una prueba (`relation-selection.test.ts`, «una
   enganchada cuya relectura se negó no calla nada»). **Diferencia residual**: las
   notas de esa conversación siguen siendo las extraídas antes de enganchar, sin
   las abiertas del personaje delante, hasta que otro CLI o un mensaje nuevo
   permitan releerla.
6. **Los textos.** La pista «Solo en este equipo», que Daniel no entendió, pasa a
   «Enganchada a Lía el …. El enganche se guarda solo en este ordenador:
   «Sincronizar» no lo sube, y hoy no sirve de copia de nada de la bóveda.» La
   confirmación dice lo mismo sin sugerir que el resto de la bóveda sí viaja
   (`SEG-SYNC-001`), explica la reescritura con sus límites en cifras y dice lo que
   no se puede igualar (abajo).
7. **La sincronización**: fuera de alcance. En una nacida el dueño va en el turno
   0, que sube con «Sincronizar»; en una enganchada no suben ni el evento
   (`conversation-owners.json`) ni la reescrita (`memory-relink.json`). La foto
   copiada sí subiría, como medio, con el `characterId` de ella en una
   conversación que allí no tiene dueño. Cuando exista `F33-ENGANCHE-001` (detrás
   de `SEG-SYNC-001`), la reescrita debe viajar como un registro nuevo sellado con
   la subclave de la conversación, con `basedOn` y `ownerEventId`, que es la forma
   que `D-099` ya llamó honesta; que cada ordenador reescribiera por su cuenta
   daría dos memorias distintas.

### Lo que no se puede cerrar, y la confirmación lo dice

**Los últimos mensajes viajan literales y se escribieron sin la ficha.** El prompt
lleva los `VAULT_RECENT_TURNS` (8) últimos turnos tal cual. Si en ellos se la
llamaba de otra forma o hablaba como otra, lo lee hasta que cuatro mensajes nuevos
de Daniel los dejan atrás, junto a una memoria reescrita que dice lo contrario.
Una nacida no tiene esa contradicción. Igualarlo exigiría tocar el historial, y el
`.jsonl` no se toca. Tampoco se igualan las notas de pendientes del punto 5 hasta
releerlas.

**Y salir de la ventana no es dejar de leerlos** (séptima ronda: la confirmación
decía que sí). `buildRecall` transcribe momentos enteros de texto real cuando el
mensaje evoca uno —«¿te acuerdas de…?», una fecha—, e `isAlreadyInPrompt` solo
quita los que empiezan dentro de la ventana de ESTA conversación; como el índice
pasa a ser suyo al enganchar, esos turnos de antes vuelven también en sus otras
conversaciones. Lo mismo el título y el «de qué fue» de esas escenas en el
catálogo. La confirmación lo dice ahora.

### La reescritura

- **Quién.** Claude Code o Codex con la sesión local, por el carril compartido
  (`runOnAuxiliaryLane`), con `resolveAuxiliaryTarget` e `isLocalCliProvider`
  comprobados dos veces: **nunca una API de pago** (`D-087`). Turno `technical`,
  que no deja sesión en disco. Es la primera vez que un trabajo de fondo le lleva
  al CLI la ficha del personaje. Clase `MemoryRelink`
  (`apps/desktop/src/main/vault/memory-relink.ts`).
- **Dónde.** `vault/memory-relink.json`, sellado con la subclave
  `identity|memory-relink`, calcado de `conversation-owner-store.ts`: carril,
  temporal sellado, `fsync` y `rename`; un archivo que no abre no se sobrescribe y
  las filas que no validan se conservan. Una fila por conversación. **El `.jsonl`
  no se toca nunca** (prueba byte a byte).
- **Cuándo vale.** Solo **atada**: mismo `winningEventId`, mismo personaje y la
  misma última memoria sellada, en secuencia **y** fecha (la fecha cubre un número
  reutilizado). En cuanto algo cambia, vuelve a valer la sellada. Sale con
  `source: 'turn'`, así que el prompt es byte a byte el de una nacida con esa
  memoria (prueba).
- **El encargo.** Sin turnos: alinear la identidad, no resumir otra vez. Pide
  cambiar solo cómo se la nombra y lo que su ficha contradiga, dejar lo que pasó,
  no quitar ni acortar ni añadir. La memoria va en JSON y se devuelve dentro de
  **`<LUXY_RELINK>`**, no de `<LUXY_MEMORY>` (fallo 1 de la refutación, abajo). Se
  aceptan los topes de la sellada (1.200 y 240, doce por lista), no los de la ficha
  retroactiva.
- **La guarda.** `decideRelink`, pura. No se aplica, y sigue la de antes, si: no hay
  bloque válido (negativa o inválida), sale vaga siendo la de antes concreta, quita
  o recorta a menos de la mitad **más de dos** entradas, el resumen cae por debajo
  del 80 % y pierde más de 60 caracteres, o el total de las entradas cae por
  debajo del 80 % y pierde más de 120. **Son criterios, no medidas**: nadie ha visto
  aún una reescritura real. Con una o dos entradas quitadas o recortadas **se
  aplica**, y la confirmación lo dice. Desde la séptima ronda, además, no se
  aplica si pierde **más de la mitad** de las entradas que había, si el resumen o
  el total de las entradas cae **por debajo de la mitad** aunque quepa en la
  holgura, o si del resumen no sigue **al menos la mitad de sus palabras** (con
  cuatro o más). **Lo añadido no se rechaza**: se aplica y se cuenta en pantalla.
- **Automática, sin aprobación.** A diferencia de la ficha retroactiva (`D-101`):
  una nacida no pide aprobar su memoria. La red es que el `.jsonl` no se toca, que
  lo que pierde material no se aplica, y que se puede volver a la de antes
  («Volver a la de antes») mientras siga atada, es decir, hasta que un mensaje
  selle memoria nueva.
- **Estados.** `pending`, `not-needed` (no hay memoria sellada que reescribir: al
  enganchar sin ella, aunque haya ficha retroactiva o índice, y después de
  «Borrar su memoria»; la siguiente nace con la ficha, y si en cambio sale de
  la ficha retroactiva o del índice, el turno que los usa la pasa a `pending`,
  décima ronda), `ready`, `applied` (un mensaje ya la usa), `discarded` y
  `failed` (`refused`, `invalid`, `vague`, `lossy`). Para la pantalla,
  `relinkPhase` añade dos lecturas: `ready` desatada vuelve a `pending`, y
  `applied` desatada es `done` (la sellada nueva salió de ella). **No hay estado
  «a revisar».**
- **Cuándo se dispara.** Al enganchar (`noteLink` apunta la fila, `pending` con
  memoria sellada y `not-needed` sin ella; la pasada entra en la misma cola que
  la relectura de pendientes, después de soltar la marca de «cambiando dueño»,
  porque con ella puesta vería la conversación ocupada); al terminar cada envío
  en Privado —la de esa conversación si está enganchada, y `MemoryRelink.sweep`
  sobre las demás filas que pueden tener algo pendiente y, una vez por apertura
  de la bóveda, las enganchadas sin fila (octava ronda)—; cuando un turno parte
  de la ficha retroactiva o del índice (`noteInheritedMemoryUsed`, novena y
  décima ronda); y con el botón «Reescribir con su ficha» de «Lo que recuerda».
  Lo que ya se miró sin nada que hacer (`idle`) no se vuelve a mirar hasta
  cerrar la bóveda, salvo al quitar esa conversación de las excluidas o
  cambiar el CLI del trabajo de fondo (`recheck`, novena ronda). Las
  enganchadas antes de esto se tratan como pendientes y se reescriben tras su
  siguiente mensaje.
- **`D-088`.** No cuesta un turno: se lanza sin esperar y no lanza. Una negativa o
  una reescritura que pierde material pertenece al CLI que la dio: se reintenta con
  el otro o con el botón. Un proceso caído no se persiste y no se repite con el mismo
  CLI en la sesión. Un cierre de la bóveda a mitad no marca nada (`D-106`). Lo que
  llega tarde se tira: otra memoria sellada, otro enganche, un envío en curso o una
  decisión de Daniel entre medias (compare-and-set sobre la fila).
- **El turno.** Antes de componer el prompt apunta `applied`; solo si eso se
  escribe, usa la reescrita. Si no, relee la fila (`relinkStillInUse`, novena
  ronda): si ya estaba `applied` y atada, la usa igual; si no, va con la sellada
  y la reescrita sigue lista. Así nunca se reescribe una memoria que ya salió
  de una reescrita.
- **Borrar.** «Borrar su memoria» en una enganchada va en dos tiempos (décima
  ronda). Antes de borrar nada, `releaseRelinkBeforeForget` quita el texto de
  la reescrita: si era la que vale, la deja `pending`; si no, conserva su
  estado; y siempre cambia su fecha, para que una reescritura que termine en
  medio choque en su compare-and-set. Si no puede escribir, lanza y **no se ha
  borrado nada**. Con la sellada ya borrada, `settleRelinkAfterForget` deja la
  fila en `not-needed`; si eso falla, se registra y la fila se queda como la
  dejó el primer tiempo, ya sin texto. Si falla un paso de en medio, la
  reescrita se ha perdido pero se regenera sola (una llamada más) y mientras
  tanto viaja la sellada de antes. Las dos escrituras releen justo antes y
  reintentan hasta tres veces (`replaceRelinkFresh`). En una no enganchada solo
  puede quedar el resto de un «Soltar» fallido: se intenta quitar y, si no se
  puede, se registra y se borra igual. Borrar la conversación y «Soltar» se la
  llevan; si «Soltar» no puede quitar la fila, la pasada suelta el texto
  después, también si está excluida (con el límite de `idle`, al final).
- **Registro.** Una línea «memoria reescrita con su ficha» con el resultado, el
  CLI, si fue forzada, cuántas entradas se conservaron, corrigieron, quitaron,
  recortaron y añadieron, los caracteres antes y después y la duración. Nunca la
  conversación, el personaje ni una palabra de ninguna memoria. «prompt privado
  compuesto» gana `memoriaReescrita`. Cuando algo no se puede apuntar o
  limpiar, la misma línea lleva solo `resultado` (`sin-apuntar`, `sin-limpiar`
  o `sin-pasada`) y, si hace falta, `paso` (`heredada`, `borrar-memoria` o
  `soltar`), nunca el motivo. Los nombres se han mirado contra `redact()`.

### Los fallos de la refutación, uno por uno

1. **La etiqueta chocaba con el `system` del turno técnico**, que prohíbe escribir
   un bloque de memoria, y `<LUXY_MEMORY>` se busca con `lastIndexOf`. Cerrado:
   etiqueta propia `<LUXY_RELINK>`, parseada en main, y se rechaza toda memoria con
   `<luxy_` dentro o con aspecto de código.
2. **La guarda no veía el resumen ni los recortes.** Cerrado: `compareMemoryEntries`
   cuenta `shortened` (entradas reescritas que perdieron más de la mitad), y
   `decideRelink` mide el resumen y el total de las entradas. `countKeptEntries`
   sigue devolviendo sus cuatro campos.
3. **La confirmación prometía «no se pierde nada».** Cerrado: dice que con más de dos
   entradas quitadas o recortadas no se aplica, y que con una o dos sí.
4. **Un «a revisar» caducado era un callejón sin salida.** Cerrado: no existe. Lo
   que pierde material es `failed/lossy`, con «Reescribir con su ficha», y una
   `ready` desatada vuelve a `pending` sola.
5. **`decideRelink` no podía ser pura en shared** (`classifyReply` vive en
   `apps/desktop`). Cerrado: main clasifica solo el texto de FUERA del bloque y
   pasa `refused` ya decidido.
6. **El inventario se dejaba la cola literal.** Cerrado en el texto: la confirmación
   lo dice, y esta decisión también.
7. **El texto de sincronización sugería que lo demás sí viaja.** Cerrado: «no
   cuentes con «Sincronizar» como copia de nada de la bóveda».
8. **Un `markDone` fallido reescribiría otra vez lo ya reescrito.** Cerrado de otra
   forma: el uso se apunta ANTES de usarla y, si no se puede apuntar, el turno va
   con la sellada; la nueva reescritura, si llega, parte de una memoria que no salió
   de una reescrita.

### Lo que queda sin saber

- Cuántas veces se niegan los CLI con este encargo, y si respetan «no quites ni
  acortes». La nota «Los CLI no se niegan» es de otros encargos.
- Si los umbrales de la guarda dejan pasar lo que deben: 2 entradas, 80 %, 60 y
  120 caracteres, y los tres de la séptima ronda —no perder más de la mitad de
  las entradas (`maxLostShare` 0,5), no bajar de la mitad (`hardMinRatio` 0,5) y
  conservar la mitad de las palabras del resumen si tiene cuatro o más
  (`minSummaryWordsKept`)—. Son criterios: ninguno se ha medido contra una
  reescritura real.
- `isProfilePhotoOf` contra los medios reales.
- Volver a la de antes solo se puede hasta que un mensaje selle memoria nueva.
  Después la de antes sigue en los registros anteriores del `.jsonl`, pero no hay
  pantalla para recuperarla.
- Un Studio anterior ignora `memory-relink.json` y usa la sellada: no hace daño, pero
  allí la diferencia sigue.

### Séptima ronda (29/09): lo que encontró la revisión

Ocho revisores (aquí decía «cinco»), con un `npm run check` a solas en verde
(4677). Lo que se arregló, cada cosa con su prueba comprobada fallando sin el
arreglo:

- **La guarda dejaba vaciar una memoria corta.** Con una memoria de menos de 150
  caracteres la de antes ya contaba como vaga, las «dos permitidas» eran todas, y
  las holguras de 60 y 120 caracteres llevaban un resumen de 53 a 4. Tres reglas
  nuevas (arriba, en «La guarda»), y el resumen se mide también por sus palabras:
  uno con otro contenido del mismo largo pasaba.
- **La ficha retroactiva y el índice también se escribieron sin su ficha.** Una
  enganchada sin memoria sellada viaja con ellos, se los lleva a sus otras
  conversaciones (`D-105`) y la primera memoria que se selle sale de ahí. Antes
  quedaba en `not-needed` y no se reescribía nunca. Ahora `noteLink` la deja
  `pending` sin memoria sellada; no hay nada que reescribir hasta que se selle la
  primera, y esa es la que se reescribe, en la pasada que sigue al envío.
  **Diferencia residual**: la primera respuesta tras enganchar todavía parte de
  la ficha retroactiva. Reescribir la ficha misma exigiría atar la reescrita a
  su versión y saltarse la aprobación y la cobertura de `D-101`. La confirmación
  y «Lo que recuerda» lo dicen. *(Sustituido en la novena y la décima ronda:
  `noteLink` deja `not-needed` sin memoria sellada, y la fila pasa a `pending`
  cuando un turno usa de verdad la ficha retroactiva o el índice. La diferencia
  residual de la primera respuesta sigue.)*
- **La reescritura recibía la palabra partida.** Le llegaba la sellada tal como
  está en disco; completaba la palabra a su manera y lo inventado quedaba sin
  huella. Ahora recibe `repairSlicedMemory` y el encargo le dice que no complete
  lo que acaba en «…».
- **El botón no decía nada.** «Reescribir con su ficha» tiraba el resultado:
  con el CLI caído, una respuesta tardía o la conversación ocupada, la fila se
  quedaba igual. Ahora el resultado vuelve (`relinkOutcome`) y se dice debajo
  de la fila; el botón pasa a «Reescribiendo…». Y una pendiente cuyo proceso
  falló en la sesión con el CLI que toca ya no dice «en segundo plano»: dice que
  no se volverá a intentar sola hasta reiniciar (`stalled`).
- **El resumen de la fila escondía lo añadido y el resumen.** Ahora cuenta las
  entradas añadidas y dice si cambió el resumen (`summaryChanged`, opcional en
  la fila: las de antes no lo tienen y ahí no se dice nada).
- **La confirmación prometía que los mensajes de antes dejaban de leerse**
  (arriba, en «Lo que no se puede cerrar»).
- **El resumen de `D-105` llevaba la reescrita en `ready`**, sin apuntar antes
  `applied`: ahora solo la `applied`.
- **Menores.** «Lo que recuerda» enseña la memoria como la lee ella, con la
  palabra partida arreglada. Borrar la memoria de una conversación no enganchada
  ya no depende de poder leer `memory-relink.json`, y quitar una conversación que
  no tiene fila ya no vuelve a sellar el archivo. Un «Soltar» que no puede
  quitar la reescrita lo apunta en el registro (`sin-limpiar`). Borrar mientras
  arranca un envío (ver `D-106`, séptima ronda). Cada rechazo de «Volver a la de
  antes» y «Reescribir» dice su motivo real.

Lo que **no** se ha cambiado, y por qué:

- **Una `applied` ya cumplida conserva su texto** en `memory-relink.json`, cifrado,
  hasta que se borra la memoria, la conversación o se suelta. Es retención sin
  uso, no una fuga.
- **`failed` y `discarded` no caducan** al sellarse memoria nueva: la memoria de
  ahora sigue saliendo de la escrita sin su ficha, así que reescribirla sigue
  teniendo sentido y el texto de la fila sigue siendo cierto en lo esencial.
- **La sonda de modelos no monta el bloque `recientes`**: un modelo que pasa la
  sonda puede negarse en el turno con la casilla de `D-105` encendida. Ya pasaba
  antes; no se ha medido contra un proveedor.

### Octava ronda (29/09): lo que encontró la revisión de la séptima

Ocho revisores y un `npm run check` a solas que cayó por tiempo en una prueba
ajena. Cada arreglo con su prueba vista fallando sin él. Revisada después por
ocho revisores, con `npm run check` a solas en verde (228 archivos, 4716
pruebas); lo que encontraron, en la novena.

- **Una reescrita lista no llegaba a sus otras conversaciones** mientras Daniel
  no escribiera en la enganchada (ver `D-105`, octava ronda). Quien la lleva fuera
  la apunta `applied` antes, por compare-and-set, como el turno. Deshace la
  decisión de la séptima ronda de llevar solo la `applied`.
- **Una pendiente se quedaba pendiente.** Solo había tres disparadores: al
  enganchar, tras un envío en ESA conversación y el botón. Un cierre de la
  bóveda a mitad —lo normal con `D-106`—, un reinicio de Studio o un fallo local
  la dejaban «pendiente… en segundo plano» para siempre en una enganchada que no
  se sigue. Ahora, tras cada envío en Privado, `MemoryRelink.sweep` recorre las
  filas que pueden tener algo pendiente (`pending`, `ready`, `failed` y una
  `applied` con texto) y, una vez por apertura de la bóveda, las enganchadas sin
  fila (las de antes de esta decisión). Lo que ya se miró sin nada que hacer no
  se vuelve a mirar hasta que se cierre la bóveda. La fila dice cuándo se
  intenta: «después de tu próximo mensaje en Privado, o ahora si pulsas…».
- **La firma** (punto 3, arriba) **cambia otra vez.** Firmar todo con el dueño
  cambiaba sin tocar nada las conversaciones del Studio anterior con dueño por
  turno, donde lo de antes pudo escribirse con otra ficha, y en una enganchada
  firmaba «Nora» lo que Lía escribió antes de soltarla. Ahora: con dueño por
  turno, como en `a45953b` (solo lo de después del turno que lo fijó); en una
  enganchada, todo salvo lo escrito con OTRO personaje en vigor
  (`lastForeignSequence` en `vault-owner.ts`, `foreignUpTo` en la vista). Si no
  se puede saber, se firma como en `a45953b`.
- **La cumplida suelta su texto.** Una `applied` que dejó de estar atada guardaba
  la memoria reescrita sin que nada la leyera. La pasada siguiente la mira
  entera y la deja sin texto. (En la séptima se dejó así a propósito; la
  revisión recordó que el propio almacén dice que conservarla es dejarla en
  disco sin nada que la use.)
- **«Volver a la de antes» con un envío arrancando.** Miraba el envío solo al
  entrar, y en fase `in-use` el turno no escribía la fila, así que el
  compare-and-set no veía el choque. Ahora vuelve a mirar justo antes de
  escribir, y el turno apunta también sobre una `applied` (cambia su fecha): el
  que llegue segundo choca.
- **El atajo del disparo** saltaba una `applied` sin mirar si era de este
  enganche. Ya no la salta mientras guarde texto; una de otro enganche sin texto
  la sigue saltando, y solo aparece si `noteLink` falló (queda en el registro
  como `sin-apuntar`).
- **Pantalla**: la fila `ready` dice que viaja también a sus otras
  conversaciones; la `in-use`, que lo que otra conversación se llevó se queda;
  las recortadas van dentro de las corregidas («1 corregida (1 de ellas
  recortada)»); tras «Volver a la de antes» desaparece el acuse de «Reescribir»;
  el tooltip ya no dice «detrás del resto».

Lo que **no** se ha cambiado, y por qué:

- **Las enganchadas con `a45953b` se reescriben** tras el siguiente envío (y
  ahora tras cualquier envío en Privado) sin haber visto la confirmación que lo
  explica, y es el primer trabajo de fondo que lleva la ficha al CLI. Apagarlo
  solo se puede excluyendo la conversación del trabajo de fondo. Es de Daniel
  decidir si quiere un aviso o una casilla.
- **«Borrar su memoria» en una no enganchada** con un resto que no se puede
  quitar lo apunta en el registro (`sin-limpiar`) y borra igual, sin decírselo
  a Daniel. Avisarle exige un campo nuevo en la respuesta y en la pantalla.
- **La ficha vacía**: la fila sigue diciendo «con su ficha» aunque esté vacía.
  *(La novena lo corrigió en la confirmación del enganche —«se reescribirá con
  su nombre (su ficha está vacía)»—; la fila y el borrado siguen igual, abajo.)*

### Novena ronda (29/09): lo que encontró la revisión de la octava

Ocho revisores sobre la octava, con su `npm run check` a solas en verde. Cada
defecto se comprobó en el código antes de tocarlo. Revisada después por seis
revisores, con `npm run check` a solas en verde (229 archivos, 4741 pruebas);
lo que encontraron, en la décima.

- **`not-needed` era terminal.** Se decidía una vez, al enganchar, con lo que
  hubiera: una ficha retroactiva o un índice creados después, o una ficha que
  se completaba después, daban una memoria escrita a partir de ellos que no se
  reescribía nunca y que la pantalla no enseñaba. Ahora el turno, cuando
  `chooseConversationMemory` elige la ficha retroactiva o el índice en una
  enganchada, llama a `MemoryRelink.noteInheritedMemoryUsed`, que pasa la fila
  a `pending`, y la memoria que selle ese turno se reescribe en la pasada
  siguiente. La décima lo amplía.
- **La pantalla afirmaba que le llegaba la ficha retroactiva** sin mirar si
  estaba aprobada. La vista previa del enganche gana `inheritedTravels`
  (booleano, validado con Zod), calculado en main con `chooseConversationMemory`
  sobre los turnos descifrados. La confirmación dice si le llega ahora y, si
  no, que solo viaja aprobada y al día; la fila pendiente sin memoria dice lo
  que PUEDE llegarle y con qué condición; con la ficha del personaje vacía, la
  confirmación dice «se reescribirá con su nombre (su ficha está vacía)».
- **«Soltar» que no pudo quitar la fila** dejaba el texto reescrito en disco
  sin que la pasada lo recogiera: `relinkOne` suelta ahora, por
  compare-and-set, todo texto reescrito que ya no vale (`!relinkApplies`),
  también el de una `ready` desatada, y la pasada ya no se salta la
  conversación del envío si no está enganchada.
- **La marca `idle`** solo se borraba al cerrar la bóveda, y la fila prometía
  «después de tu próximo mensaje en Privado»: `MemoryRelink.recheck` la borra
  al quitar una conversación de las excluidas (esa) y al cambiar el CLI del
  trabajo de fondo (todas).
- **`markRelinkApplied` que falla sobre una `applied` atada** dejaba una `done`
  falsa que no se reescribía nunca: `relinkStillInUse` (arriba, «El turno»).
- **Pantalla.** La fila `failed` de una conversación excluida ya no ofrece
  pedírselo otra vez ni el otro CLI, y la `ready` excluida ya no promete
  llegar a sus otras conversaciones; la reescritura, en la confirmación, va en
  dos párrafos, y «acorta mucho» pasa a las cifras de `RELINK_LIMITS` («más de
  un 20 %…»); el pie de la casilla de `D-105`, en frases cortas; la
  confirmación de «Borrar su memoria» en una enganchada dice que, si la nueva
  sale de su ficha retroactiva o del índice, se reescribirá (una llamada más al
  CLI). La pista del Razonamiento del proveedor HTTP, en `D-107`.
- «Borrar su memoria» cambió aquí de orden (leía antes y escribía todo
  después); la décima lo cambió otra vez (arriba, «Borrar»).

No se sostuvieron, y se dejaron así: que una nacida reciba ahora la foto de
perfil es lo correcto (punto 2, arriba); la recencia de `D-105` contada desde
el enganche es una decisión, no un defecto (`D-105`, «Lo que queda abierto»).

### Décima ronda (29/09): lo que encontró la revisión de la novena

Seis revisores (medida, razonamiento, equivalencia, pantalla, regresión y
privacidad): trece defectos, tres de ellos importantes. Revisada después por
otros seis, con `npm run check` a solas en verde (229 archivos, 4751 pruebas);
lo que encontraron sigue abierto, abajo.

- **El estado no miraba la aprobación.** `noteLink` y el borrado dejaban
  `pending` con cualquier ficha retroactiva con memoria, aprobada o no: una sin
  aprobar, que no viaja, gastaba una llamada al CLI y la fila decía «se
  escribió sin su ficha». Ahora `noteLink` deja `not-needed` siempre que no haya
  memoria sellada, y el borrado también; pasa a `pending` solo el turno que de
  verdad parte de lo heredado. `inheritsUnsheetedMemory` solo alimenta ya
  `inheritedMemory` en la vista previa.
- **`noteInheritedMemoryUsed`, generalizado**: pasa a `pending` cualquier fila
  de ese enganche que no esté ya pendiente y sin texto, salvo que esté atada a
  la sellada de ahora; lo heredado solo viaja sin sellada, así que una
  `applied`, `discarded` o `failed` habla de una sellada que ya no existe.
  Relee y reintenta; si aun así falla, apunta la conversación en
  `inheritedUnnoted` durante la sesión, y `relinkOne` la pasa a pendiente antes
  de decidir.
- **Una excluida no soltaba el texto**: `relinkOne` devolvía `excluded` antes
  del bloque que suelta. Ahora suelta primero; sin texto, sale sin llamar a
  ningún CLI.
- **«Borrar su memoria» vuelve a quitar el texto antes que la sellada**, sin la
  fila terminal de la séptima ronda (arriba, «Borrar»).
- **La vista previa en el borde de la cola**: `inheritedTravels` se calcula con
  un turno fantasma al final, la cola del próximo mensaje; si viaja entonces,
  también viaja ahora, así que «así será también en tu próximo mensaje» es
  cierto.
- **La confirmación prometía «con esas cifras»**, y la fila no enseñaba
  ninguna: ahora dice «cuántas entradas dejó igual, corrigió, quitó o añadió,
  también si no se aplicó», y la fila `failed` con `lossy` o `vague` enseña
  esas cifras cuando existen.

### Lo que queda abierto (revisión de la décima)

Nada de esto está corregido. Ninguno rompe y todos son menores:

- **Una fila de OTRO enganche**: `noteInheritedMemoryUsed` no la toca, y el
  atajo de `relinkOne` salta una `not-needed`, `discarded` o `applied` sin
  texto sin mirar de qué enganche es. La memoria que sale de lo heredado se
  queda sin reescribir, y la fila promete «después de tu próximo mensaje en
  Privado». Solo si `noteLink` no llegó a escribir (registro `sin-apuntar`).
  Reproducido por el revisor con una prueba en su scratchpad.
- **«Sincronizar» baja una memoria sellada de otro equipo**, donde la
  conversación no tiene dueño: una fila `applied` se lee `done` («ya se
  escribió a partir de ella», falso) y una `not-needed` queda terminal. La
  sincronización está fuera de alcance (punto 7) y hoy está rota
  (`SEG-SYNC-001`).
- **La ficha retroactiva de una enganchada sin sellada viaja por `D-105`** a
  sus otras conversaciones sin reescribir mientras Daniel no escriba en ella,
  y la confirmación no lo dice.
- **Filas que la pantalla describe mal.** Si falla el segundo tiempo del
  borrado, una fila que no estaba en uso conserva su estado sin sellada detrás:
  una `done` dice «ya se escribió a partir de ella» y una `discarded` deja vivo
  «Reescribir con su ficha». Si la respuesta del turno que apuntó `pending`
  por lo heredado no termina en `completed` y en el siguiente la ficha ya no
  viaja, la memoria nace con su ficha y se reescribe igual (una llamada de
  más), con la fila diciendo «se escribió sin su ficha»; y esa frase es
  inexacta incluso en el camino normal: lo que no llevaba la ficha era aquello
  de lo que partió.
- **Una salida `stale` sin CLI**: si choca el compare-and-set que suelta el
  texto de una fila desatada, `relinkOne` devuelve `stale` sin haber llamado a
  nadie; con el botón, la pantalla dice que la reescritura se tiró, que es
  falso, y no se registra.
- **«Soltar» fallido con la conversación en `idle`**, que es lo normal tras un
  envío con la reescrita `ready`: la pasada la salta, y el texto cifrado dura
  hasta cerrar la bóveda, no «hasta el siguiente envío» como dicen el
  comentario de «Soltar» y la novena ronda. Propuesta del revisor: `recheck`
  en los dos `catch` de `removeConversation`.
- **Textos.** El borrado y la fila pendiente dicen «se reescribirá con su
  ficha» aunque esté vacía (la confirmación del enganche ya lo distingue); la
  confirmación promete cifras «también si no se aplicó», y con una negativa o
  una respuesta rota no las hay; con `recap.json` ilegible la vista previa da
  `inheritedMemory` y la confirmación afirma una ficha sin aprobar (la prueba
  de `memory-relink.test.ts` y el criterio de `inheritsUnsheetedMemory` están
  desfasados); y la confirmación de «Borrar su memoria» en una no enganchada
  dice «desde cero» con un índice detrás (el aviso rojo sí sale, pero lo llama
  «ficha retroactiva»).
- **Sin prueba propia**: las carreras de una reescritura y del apunte de
  `D-105` con el borrado. Se cierran por diseño —relectura, compare-and-set,
  hasta tres reintentos y el cambio de `updatedAt`—, no se han reproducido.
- **`inheritedUnnoted` vive en memoria**: si fallan el apunte del turno y el
  reintento de la pasada y Studio se reinicia antes del siguiente envío, la
  fila se queda `not-needed` sin nada en pantalla.

## D-109 — un fallo del CLI no es una respuesta ni una negativa: falla, espera por lanzamiento y se recupera solo

Fecha: 2026-10-06. Autor: Claude. Contexto: `INV-FONDO-001`. Lo pidió Daniel
(«ponte con el punto 2»), después de que el apuntador de promesas llevara una
semana sin hacer nada.

Estado (06/10): aceptada e implementada. Un flujo la construyó y la revisó dos
veces (`wf_6f8b7a28-515`), y otro la revisó dos veces más (`wf_d5bb2e3c-e86`):
16 defectos importantes confirmados, todos corregidos. La última corrección
(tres cambios pequeños) la leyó quien coordina, no un revisor independiente.
`npm run check` a solas en verde: 233 archivos, 4942 pruebas y 12 omitidas. **No
visto en Electron.**

### El fallo que la motiva

El `claude` de la consola perdió la sesión el 28/09; tiene su sesión aparte de
la app de escritorio. Desde entonces, cada llamada emitía un `result` con
`is_error:true` y `subtype:"success"`, salía con código 1 y no escribía nada en
stderr. Luxy copiaba el texto de ese `result` como respuesta, el final salía
`interrupted` y el turno `completed`. Así, pendientes lo contó como negativa y
bloqueó la conversación (en memoria hasta reiniciar Studio, en disco hasta que
creciera), el catálogo como fallida y la reescritura de `D-108` como
`invalid`. Ningún registro decía «autenticación». Todas las negativas de la
historia del registro (6) y las dos reescrituras salieron de ahí.

### Lo que se decide

1. **Un fallo del CLI es un fallo.** Si llega un `result` con `is_error`, o un
   `assistant` con `error`, el proveedor devuelve `ok:false` sin texto, con
   cualquier código de salida. El motivo se toma sólo de señales estructuradas
   del CLI, sin adivinar por palabras: `failureReason` es `auth`, `rate_limit`,
   `api_error` o `exit_code`. El mensaje dice qué hacer, y el texto del CLI no
   va ni al mensaje, ni al registro, ni al progreso. Codex recibe el mismo
   trato con sus eventos `error` y `turn.failed`, y su falta de sesión se mira
   con el código de salida de `codex login status`. Un trabajo de conversación
   sin texto visible también es `failed`, y ya no se rellena con «El proveedor
   no devolvió resumen.». `failureReason` cruza el protocolo del host y se
   registra como `motivoFallo`.
2. **En los cuatro trabajos de fondo** (pendientes, catálogo, reescritura y
   relleno), un fallo del proceso no persiste negativa ni fila `invalid`. Las
   negativas de verdad, una respuesta `completed` sin bloque, siguen como en
   `D-088`.
3. **La espera es por lanzamiento.** Un fallo arma 10 minutos de espera
   (`AUXILIARY_PROCESS_WAIT_MS`) para ese CLI, con ese modelo y ese esfuerzo,
   compartida por los cuatro trabajos (`auxiliary-cooldown.ts`). Sólo `auth`
   la extiende al CLI entero. Cualquier respuesta la levanta, y así, tras
   `claude auth login`, todo vuelve solo en minutos y sin reiniciar. Un botón
   pulsado a mano da un intento aunque haya espera.
4. **De quién es la culpa.** Se cuenta por tandas: los fallos entre dos
   respuestas del mismo lanzamiento. Una conversación que falló sola en una
   tanda anterior, o en dos tandas, se salta durante dos horas
   (`AUXILIARY_BLOCK_MS`). En un apagón real todas fallan en la misma tanda y
   no se salta ninguna. Se compara por conversación y no por trabajo.
5. **Recuperar lo grabado, una vez y sin reescribir decisiones de Daniel.** Las
   negativas se graban ahora con `RELATION_REFUSAL_VERSION`, que es la versión
   del extractor más uno, y sólo cuentan las de esa versión. Las viejas se
   quedan en disco sin efecto, y `through` no se toca, así que no se relee
   nada. En `vault/memory-relink.json`, una migración sellada y única devuelve
   a pendientes las filas `failed` con `invalid` o `refused`, con la marca
   `inv-fondo-001` dentro del mismo archivo cifrado.
6. **Se ve.** El estado de la bóveda lleva `auxiliaryFailures`, con enums y
   horas, y Privado dice qué hacer bajo «Quién hace el trabajo de fondo»
   («claude auth login»). Ofrece el otro CLI, pero no cambia a él solo.
7. **La llave, sólo medida.** `VaultService.derivationCount` es de sólo
   lectura, y el contador acumulado va en «turno privado terminado» y en las
   líneas de los trabajos de fondo. El supuesto bucle de 6 por segundo no
   existía: es el total de la sesión dividido entre el tiempo abierta.

### Lo que queda abierto

- Un límite de uso de Codex llega como `api_error` o `exit_code`, porque
  `codex exec --json` no trae código estructurado. La conversación activa
  puede saltarse dos horas en vez de esperar 10 minutos.
- Si la bóveda se cierra, el catálogo no se reanuda solo: hay que volver a
  abrir «Lo que recuerda». La pantalla lo dice.
- `describeCatalogFailure` guarda hasta 160 caracteres de la respuesta en
  `failed[].reason`. Ahora se purga al cerrar.
- Un comentario de `packages/shared/src/vault-relink.ts` («failedThisSession…
  en esta sesión») ha quedado desfasado.
- Lo que ya traía cada respuesta privada no cambia: cada turno descifra la
  bóveda entera varias veces, unas 4.000 derivaciones (`INV-LLAVE-001`).
