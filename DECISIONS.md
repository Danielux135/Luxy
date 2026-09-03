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
