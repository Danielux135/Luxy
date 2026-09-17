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
