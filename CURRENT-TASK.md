# Luxy — tarea activa

> **Por dónde entrar (2026-09-23).** Este archivo va de más nuevo a más viejo y
> tiene varios «siguiente paso exacto» abiertos a la vez, con dueños distintos.
> El orden que manda es éste:
>
> 00. **`REV-TRES-ENCARGOS-001` (28/09): los tres encargos del 25/09 —bóveda,
>    enganche con resumen y promesas— se construyeron en un flujo cuya revisión
>    independiente NO se hizo** (la autenticación caducó y los siete revisores se
>    cayeron). Rondas de revisión posteriores encontraron defectos y se
>    corrigieron el 28/09 en seis rondas de arreglos. **La tercera, la cuarta y
>    la quinta tuvieron cada una su revisión de cinco revisores, y las tres
>    pasaron `npm run check` a solas** (222 archivos; 4511, 4520 y 4531
>    pruebas); la quinta quedó commiteada en `a45953b`. La sexta cerró lo que
>    dejó la última revisión; ocho revisores la revisaron junto con 2f, 2g y
>    2h, y `npm run check` a solas pasó sobre todo ello (29/09: 228 archivos,
>    4677 pruebas y 12 omitidas). La **séptima** (`REV-CUATRO-FRENTES-001`,
>    29/09) cerró lo que encontraron; otros ocho revisores la revisaron y su
>    `npm run check` a solas falló por UNA prueba que pasó del tope de tiempo
>    (`account-client.test.ts`, que sola pasa). La **octava** (29/09) cierra
>    eso. **La octava no ha tenido revisión ni `npm run check` entero.** Antes
>    de pedirle a Daniel `LA-052` a `LA-057`, lo que toca es esa revisión y el
>    check a solas. Bloques justo debajo.
> 0. **`SEG-BOVEDA-001`: la bóveda no se cerraba sola. Construido el 25/09
>    (`D-106`) y corregido el 28/09, SIN verse en pantalla.** Leer ya no cuenta
>    como actividad, y Win+L, suspender y la X la cierran. Falta `LA-053`, de
>    Daniel: que Windows avise de Win+L a Luxy no se ha podido comprobar fuera de
>    su equipo. Bloque más abajo.
> 1. **`LA-045` es el bloqueo duro y va antes que nada.** Hasta que la pasada
>    sobre las conversaciones del personaje no termine **en una sola sesión**, la
>    guarda de
>    desfase bloquea cualquier nota y todo `F23-PENDIENTES-001` parecerá roto.
>    Es de Daniel, no de un agente.
> 2. **`F33-VARIEDAD-001`: los cuatro cambios contra la autocopia de Lía están
>    hechos (`D-102`), con `npm run check` en verde y SIN verse en pantalla.**
>    Daniel tiene que encender la casilla en la ficha de Lía y poner la
>    temperatura en el MODELO que de verdad usa (`LA-050`). Releva al «paso 0»
>    de `F31-REPETICION-001`: la conversación que Daniel pegó el 25/09 ya sirvió
>    de muestra de referencia.
> 2b. **`SEG-SYNC-001`: la bóveda no tiene ninguna copia.** No se ha
>    sincronizado nunca, y la sincronización de hoy no la haría: tres fallos en
>    el código y, por diseño, no sube ni el personaje ni las fichas de memoria.
>    Mientras tanto, copia a mano (`LA-049`).
> 2c. **`F33-ENGANCHE-001`, la parte del servidor: diseñada, nada construido.**
>    Depende de arreglar antes la sincronización, porque va montada encima. La
>    parte de este equipo ya está hecha (2d).
> 2d. **`F33-ENGANCHE-LOCAL-001` y `F33-RECUERDO-001`: el enganche en ESTE equipo
>    y el resumen de sus dos últimas conversaciones, construidos y SIN verse en
>    pantalla.** Se prueban con `LA-052`. La parte del servidor de
>    `F33-ENGANCHE-001` sigue esperando a `SEG-SYNC-001`.
> 2e. **`F33-PROMESAS-001`: las promesas de vez en cuando (`D-104`), construido
>    el 25/09 y corregido el 28/09, SIN verse en pantalla ni medirse.** Se prueba
>    con `LA-054`, y con `LA-045` abierto el tope parecerá no hacer nada.
> 2f. **`F34-RAZONAMIENTO-001`: el razonamiento por modelo (`D-107`), construido
>    el 28/09 y corregido el 29/09 en la séptima y la octava ronda. La séptima
>    tuvo revisión; la octava, NI revisión NI `npm run check` entero. SIN probar
>    contra la pasarela ni verse en pantalla.** Se prueba con `LA-055`. Bloque
>    justo debajo del índice.
> 2g. **`F33-RECUERDO-ENTERO-001`: con la casilla de `D-105` le llega la memoria
>    entera de sus dos últimas conversaciones (quinta ronda de `D-105`),
>    construido el 28/09 y corregido el 29/09 en la séptima y la octava ronda;
>    la octava SIN revisión NI `npm run check` entero, y nada visto en
>    pantalla.** Se prueba con `LA-056`. Bloque justo debajo del índice.
> 2h. **`F33-IGUAL-001`: una conversación enganchada queda como una empezada
>    con su personaje (`D-108`): memoria reescrita con su ficha por el CLI
>    local, foto de perfil, firma y textos. Construido el 28-29/09 y corregido
>    el 29/09 en la séptima y la octava ronda; la octava SIN revisión NI `npm
>    run check` entero, SIN ninguna reescritura real y SIN verse en
>    pantalla.** Se prueba con `LA-057`. Bloque justo debajo del índice.
> 3. **Comprobaciones de pantalla de Daniel** de F28, F29-POSTURA-001 y F30. El
>    índice está en `LOCAL-ACTIONS.md`, `LA-048`; el detalle, en cada bloque.
> 4. Lo demás. `PROVEEDORES-005`, más abajo, tiene una prueba de diez minutos
>    que no depende de nada de lo anterior.
>
> `KIMI-K3-EXPERIMENT-001`, al final del archivo, está **abandonado**, no en
> curso. No lo retomes sin que Daniel lo pida.

## REV-CUATRO-FRENTES-001 — octava ronda: lo que encontró la revisión de la séptima (2026-09-29)

Estado: **corregido el 29/09, sin revisión de esta ronda, sin `npm run check`
entero, sin `npm run build` y nada visto en pantalla.** Pasados: las pruebas de
lo tocado y `npm run typecheck` (`TEST-RESULTS.md`).

Ocho revisores (equivalencia, razonamiento, resumen, bóveda, regresión,
privacidad, pantalla y documentación) sobre la séptima, y un `npm run check` a
solas que falló por una prueba que pasó del tope de 20 s con la suite cargada.
Siete defectos importantes. Cada uno se comprobó en el código antes de tocarlo,
y cada prueba nueva se vio fallar sin su arreglo.

Corregido:

1. **[equivalencia] Una reescrita `ready` no llegaba nunca a sus otras
   conversaciones** si Daniel no escribía en la enganchada: el resumen de
   `D-105` solo llevaba la `applied`. Ahora quien la lleva fuera la apunta
   `applied` antes, por compare-and-set, igual que el turno de su hilo; si no
   puede, lleva la sellada. El control de `ecoRecientes` no apunta nada.
2. **[equivalencia] Una pendiente solo se reintentaba con un envío en ella.**
   Una pasada cortada por un cierre, un reinicio o un fallo local la dejaba
   «pendiente… en segundo plano» para siempre. Ahora, tras cada envío en
   Privado, `MemoryRelink.sweep` mira las filas que pueden tener algo pendiente
   y, una vez por apertura de la bóveda, las enganchadas sin fila. La fila dice
   cuándo se intenta.
3. **[razonamiento] Una salida corta salía `hidden`**: por debajo de 64 tokens
   (`REASONING_JUDGE_MIN_OUTPUT`) sale `unclear`. Es un criterio.
4. **[resumen] `ecoRecientes` contaba los nombres como raíces**: fuera el de
   ella (ficha) y los nombres propios que salen en el 30 % de las frases o más
   (`raicesComunes`, nuevo en el registro). Y las frases de medir ya no se
   parten en «3.30» ni en «Sr.».
5. **[regresión] La firma**: con dueño por un turno se firma otra vez como en
   `a45953b`; en una enganchada, lo escrito con la ficha de OTRO personaje no
   lleva su nombre (`lastForeignSequence`, `foreignUpTo` en la vista).
6. **[pantalla] La confirmación del enganche** dice cuál de las dos memorias
   viaja y que por encima de 6.000 caracteres se quitan las entradas viejas.
7. **[documentación] El check de la sexta y los tres frentes** (4677, en verde)
   faltaba en los documentos, y este mismo archivo decía que no se había hecho.
   Ahora está en `TEST-RESULTS.md`, junto con el de la séptima.

Menores corregidos: «Volver a la de antes» mira otra vez el envío y el turno
apunta también sobre una `applied`, así que el compare-and-set ve el choque; el
atajo de `run()` ya no salta una `applied` que aún guarda su texto, y una
cumplida lo suelta; `reasoningOf` no cuenta dos veces el mismo texto en los dos
campos; una etiqueta citada entre acentos graves no es razonamiento; la espera
`turn-image` solo con el proveedor de pago (AI Horde espera como `image`); el
aviso cuando el tope corta la imagen del turno y lo que le llega a Lía como
motivo; la prueba del tramo que empieza en Win+L y la de integración del cierre
durante la imagen; el acuse de «Reescribir» tras «Volver a la de antes»; las
recortadas dentro de las corregidas; el tooltip «detrás»; el aviso de DeepSeek y
la pista de razonamiento (más corta, con «Actualizar»); el pie de la casilla de
`D-105`; `account-client.test.ts` con tope propio; y en los documentos: los
revisores contados, «sin revisión» donde ya la hubo, «casi 30» minutos, la
«regla 3» de `D-107`, los umbrales de `D-108` y la quinta ronda de
`TEST-RESULTS.md` sobre los finales de línea.

No se cambia, con el motivo: la huella del corte con los topes de la ficha
dentro de una memoria `turn` (deducción sin datos); la ficha vacía en la fila
(«con su ficha»); `normalizeConversationMemory` se queda con las 12 primeras
(anterior a esto; cambiarlo cambia qué se sella); `forgetRelink` en una no
enganchada sigue sin avisar si no puede quitar un resto; las enganchadas con
`a45953b` se reescriben tras el siguiente mensaje sin haber visto la
confirmación nueva (lo decide Daniel; anotado en `D-108`).

**Siguiente paso exacto:** la revisión de esta ronda y `npm run check` a solas;
después `LA-052` a `LA-057`, de Daniel.

## REV-CUATRO-FRENTES-001 — séptima ronda: lo que encontró la revisión de los cuatro frentes (2026-09-29)

Estado: **corregido el 29/09. Después la revisaron ocho revisores y su `npm run
check` a solas falló por una prueba que pasó del tope de tiempo (4699 en verde,
1 caída, 12 omitidas); lo que encontraron lo cierra la octava ronda, arriba.**
Nada visto en pantalla. Pasados entonces: `npm run typecheck`, `eslint` de lo
tocado y `vitest` de todo `apps/desktop`, `packages/shared` y
`apps/agent/src/providers` por partes (`TEST-RESULTS.md`).

Ocho revisores (equivalencia, razonamiento, resumen, bóveda, regresión,
privacidad, pantalla y documentación; aquí decía «cinco») sobre los cuatro
frentes sin commitear —la sexta ronda de `REV-TRES-ENCARGOS-001`,
`F34-RAZONAMIENTO-001`, `F33-RECUERDO-ENTERO-001` y `F33-IGUAL-001`—, con un
`npm run check` a solas en verde sobre ellos (228 archivos, 4677 pruebas y 12
omitidas), dejaron diez defectos importantes y veintitrés menores (aquí decía
«veinticuatro»). Cada uno se comprobó en el código antes de tocarlo, y cada
prueba nueva se comprobó fallando sin su arreglo (21 mutaciones).

Corregido:

1. **[enganche] La guarda dejaba vaciar una memoria corta.** Tres reglas nuevas
   en `decideRelink`: no más de la mitad de las entradas, ni el resumen ni las
   entradas por debajo de la mitad, y al menos la mitad de las palabras del
   resumen. La confirmación lo dice con esas cifras, atadas a `RELINK_LIMITS`.
2. **[enganche] La ficha retroactiva y el índice no se reescribían.** Una
   enganchada sin memoria sellada queda `pending`, y se reescribe la primera que
   se selle. La confirmación y «Lo que recuerda» dicen que mientras tanto viaja
   la ficha retroactiva. Queda la diferencia de la primera respuesta (`D-108`).
3. **[enganche] La confirmación prometía que los mensajes de antes dejaban de
   leerse**: ahora dice que pueden volver transcritos como recuerdos, aquí y en
   sus otras conversaciones.
4. **[razonamiento] Falso `hidden` en una vuelta que solo pide herramientas**:
   ahora `unclear` con menos de 400 caracteres de prosa. No medido.
5. **[resumen] El control de `ecoRecientes`** quita lo compartido de los dos
   lados (`excluidasEnviadas`).
6. **[resumen/enganche] La reescritura recibía la palabra partida**: ahora
   `repairSlicedMemory`, y el encargo le dice que no complete lo cortado.
7. **[pantalla] «Reescribir con su ficha» no decía nada**: devuelve en qué acabó,
   el botón dice «Reescribiendo…», y una pendiente atascada en la sesión ya no
   promete trabajo en segundo plano.
8. **[pantalla] Lo añadido y el resumen cambiado** se cuentan en la fila.
9. **[pantalla] «En Sistema»** era «Registros»; la pista explica los seis
   veredictos y `hidden` como deducción. También en `LA-055`.
10. **[documentación] «15 minutos desde el texto»** era falso: cuentan desde que
    el coordinador ve el tramo. `CLAUDE.md`, `AGENTS.md`, `LA-053`, `D-106`, este
    archivo y `CHANGELOG-WORK.md`.

Menores corregidos: `<think>` vacío y cierre sin apertura; `DeepSeek-V4.1-Pro`
fuera de la regla; la nota de DeepSeek y su aviso en Conexiones; el error del
valor huérfano; el resumen de `D-105` solo lleva la reescrita `applied`; «Lo que
recuerda» presenta la memoria arreglada; `erasingInFlight` (borrar con un envío
arrancando en medio, conversación y memoria); `forgetRelink` en una no
enganchada ya no bloquea el borrado; `removeConversation` sin fila no resella;
`Soltar` apunta `sin-limpiar`; los motivos de rechazo de las decisiones;
`ecoRecientesControl` solo con la casilla; `recent-echo.test.ts` vuelve a fijar
la forma exacta; el pie de la casilla de `D-105`; la cuenta del proveedor de
pago en el coordinador y `D-106`; que cortar no cancela la imagen; que
`clipAtWord` cambia también la memoria de las Conversaciones normales;
`TEST-RESULTS.md` (los finales de línea); `D-107` y la entrada 2f con su estado;
la regla de `redact()` en `CLAUDE.md` y `AGENTS.md`.

No se cambia, con el motivo (en `D-108` y `D-106`): una `applied` cumplida
conserva su texto cifrado; `failed`/`discarded` no caducan; la sonda no monta
`recientes`; cortar la bóveda no cancela la imagen del turno (decisión de
Daniel); la ficha retroactiva encadenada sigue sin arreglar la palabra.

**Siguiente paso exacto:** hecho —la revisión y el check—; siguió la octava
ronda, arriba.

## F33-IGUAL-001 — una conversación enganchada, igual que una empezada con su personaje (2026-09-28/29)

Estado: **implementado; revisado por ocho revisores con `npm run check` a solas
en verde (4677), corregido en la séptima ronda —revisada, y su check cayó por
tiempo en una prueba ajena— y en la octava, sin revisión ni check. Sin ninguna
reescritura real hecha por Claude o Codex y sin verse en pantalla.** Decisión:
`D-108`. Se prueba con `LA-057`.

El criterio es de Daniel: que una conversación que pasa a ser de Lía quede «como
si hubiese empezado con ella». Diseño y refutación: flujo `wf_b1411ff7-0ef`
(`disenar:equivalencia`, `refutar:equivalencia`). La construcción la empezó un
agente el 28/09, que se cortó antes de terminar (flujo `wf_db3de991-06e`), y la
terminó otro el 29/09 conservando todo lo hecho.

- **La memoria sellada se reescribe con su ficha**, con Claude Code o Codex y la
  sesión local, en `vault/memory-relink.json`. El `.jsonl` no se toca. Solo vale
  atada al enganche y a la última memoria sellada exacta; lo que pierde material
  no se aplica. «Lo que recuerda» enseña en qué quedó, la de antes y los botones
  «Volver a la de antes» y «Reescribir con su ficha».
- **La foto de perfil** se copia al enganchar, y se reconoce con
  `isProfilePhotoOf` (arregla que cualquier imagen generada de ella contara como
  foto de perfil, también en las nacidas).
- **La firma**: con dueño, todas las respuestas llevan su nombre (modifica
  `D-103`).
- **Un único lector de memoria** (`effectiveSealed`): el turno, la sonda, el
  resumen de `D-105` y «Lo que recuerda».
- **Los pendientes si el CLI se niega**: comprobado que no se quedan callados; se
  fija con una prueba, sin cambiar código.
- **Los textos**: la pista «Solo en este equipo» y la confirmación, sin sugerir que
  el resto de la bóveda viaja (`SEG-SYNC-001`).
- **La sincronización**, fuera de alcance: anotada en `D-108` para
  `F33-ENGANCHE-001`.
- **Lo que no se puede igualar** y la confirmación dice: los últimos mensajes
  viajan literales y se escribieron sin la ficha.

Siguiente paso exacto: `npm run check` **a solas** (con carga, pruebas de
bóveda caen por tiempo; hoy `conversation-owner.test.ts` pasó de 20 s sola con
la máquina cargada), y después `LA-057` con Daniel. Hasta verla, nada de esto
está verificado (`D-093`).

## F33-RECUERDO-ENTERO-001 — la memoria entera de sus dos últimas conversaciones (2026-09-28)

Estado: **implementado el 28/09; revisado por ocho revisores con `npm run
check` a solas en verde (4677), corregido en la séptima ronda —revisada— y en la
octava, sin revisión ni check. Sin verse en pantalla** (`TEST-RESULTS.md`).

Daniel decidió que con «Pasarle la memoria de sus dos últimas conversaciones»
le llegue la memoria entera de cada una, y solo la memoria, no los mensajes.
Diseño y refutación: flujo `wf_b1411ff7-0ef` (`disenar:resumen-entero`,
`refutar:resumen-entero`); los once fallos de la refutación quedaron cerrados
(ver `D-105`, quinta ronda, y `CHANGELOG-WORK.md`).

- Viajan `summary`, `facts`, `decisions` y `lessons` enteros; `plan` y
  `openQuestions` siguen fuera. Sin los topes de 400/800/160: queda una
  salvaguarda de 6.000 por conversación que quita lo más viejo primero.
- Una regla del bloque separa lo que dura (quién es quién, cómo la llama) de lo
  que era de aquella escena (sitio, hora, ropa).
- El aviso de tramos sin resumir de una ficha viaja con ella.
- La palabra cortada: `clipAtWord` en los cinco sitios que la cortaban
  (incluido `clampRecapMemory`), y `repairSlicedMemory` arregla lo ya guardado
  al presentarlo, en `recientes` y en el bloque `memoria`.
- `ecoRecientes` formato 2: `frases`, `porCampo`, `frasesDeUnaRaiz` y un control
  con la tercera conversación, fijada al montar el prompt, sin lo que también
  viajó y con el mismo número de frases.
- Textos de la casilla, la confirmación del enganche, soltar y «Memoria de lo ya
  hablado».

**Siguiente paso exacto:** `npm run check` a solas junto con lo demás del 28/09;
luego `LA-056`.

## F34-RAZONAMIENTO-001 — el razonamiento se elige por modelo, y el registro dice si razonó (2026-09-28)

Estado: **implementado el 28/09; revisado por ocho revisores con `npm run
check` a solas en verde (4677), corregido en la séptima ronda —revisada— y en la
octava, sin revisión ni check. Sin probar contra la pasarela real**
(`TEST-RESULTS.md`).

Daniel lo aprobó **para probarlo**: «no estoy seguro de que pueda cambiarse el
razonamiento de los modelos». Diseño y refutación: flujo `wf_b1411ff7-0ef`
(`disenar:razonamiento`, `refutar:razonamiento`); los ocho fallos de la
refutación quedaron cerrados (ver `D-107` y `CHANGELOG-WORK.md`).

- `reasoningMode` (`off`/`low`/`high`) en el muestreo; vacío no manda nada. Por
  modelo en una conexión y en el nivel superior de un proveedor HTTP (Groq).
- Tabla en `packages/shared/src/reasoning-control.ts`, nombres enteros y host
  para Groq. DeepSeek solo se apaga (encenderlo rompe los trabajos con
  herramientas); GLM-5.3 y kimi-k3 no se apagan; Qwen de la pasarela manda dos
  formas; Qwen3.8-Flash-Next queda sin regla.
- Luxy lee ahora `reasoning`, `reasoning_content`, `<think>` en el texto y
  `reasoning_tokens`, también sin transmisión. La línea «llamada al proveedor»
  lleva `reasoningVerdict` y `charsPerOutput` siempre.
- Selector «Razonamiento» en Conexiones, junto a la temperatura.

**Siguiente paso exacto:** `npm run check` a solas junto con lo demás del 28/09;
luego `LA-055`.

## REV-TRES-ENCARGOS-001 — revisión de los tres encargos del 25/09, y sus arreglos (2026-09-28)

Estado: **seis rondas de arreglos el 28/09. La corrección hizo tres rondas de cinco revisores, una tras cada ronda de arreglos de la tercera a la quinta, y las tres pasaron `npm run check` a solas: 222 archivos y 4511, 4520 y 4531 pruebas (12 omitidas); la última quedó commiteada en `a45953b`. La sexta (bloque «Sexta ronda», abajo) solo con las pruebas de lo tocado, el typecheck y el lint de esos archivos; sin revisión.** (Hasta la sexta ronda esta línea decía «cuatro rondas» y que la cuarta no había pasado el check: estaba desfasada.) Sobre las dos primeras: **dos rondas de arreglos hechas el 28/09. `npm run check` en verde tras la segunda (220 archivos, 4489 pruebas en verde y 12 omitidas, 4501; salida 0); el verde de la primera ronda (4475) no se reprodujo: una prueba con un temporizador fijo fallaba con la suite entera. Ninguna de las dos rondas ha
tenido revisión independiente, y nada se ha visto en pantalla.**

**Qué pasó.** Un flujo construyó `SEG-BOVEDA-001` (`D-106`),
`F33-ENGANCHE-LOCAL-001` con `F33-RECUERDO-001` (`D-103`, `D-105`) y
`F33-PROMESAS-001` (`D-104`). La autenticación caducó antes de terminar y **la
revisión independiente del flujo no se hizo: los siete revisores se cayeron.** El
`npm run check` en verde de entonces (220 archivos, 4452 pruebas) solo decía que
lo probado pasaba. Una ronda de revisión posterior, encargada por quien coordina,
encontró los defectos de abajo; un agente los verificó en el código uno a uno
antes de tocarlos y los corrigió el 28/09.

**Corregido, con prueba en cada uno:**

1. **Reintentar el primer mensaje fallido dejaba la conversación sin personaje.**
   Main retira el turno y borra el archivo, pero la pantalla se quedaba con el id
   y el reenvío salía como conversación ya empezada, sin Lía. Ahora la pantalla
   vuelve a «nueva» (`conversationAfterSend`, `useVault.ts`).
2. **Soltar y volver a elegir a la MISMA Lía con el Studio anterior perdía su
   ficha.** `resolveConversationOwner` hereda la última ficha sellada con ese
   mismo dueño o sin ninguno si gana un turno sin ficha; nunca la de otro
   personaje (`inheritedDescription`, `vault-owner.ts`). Probado en
   `vault-owner.test.ts` y de punta a punta en `conversation-owner.test.ts`, que
   fallaba antes del arreglo.
3. **La galería de personajes —nombre, ficha entera y receta— sobrevivía al
   cierre de la bóveda** en memoria de la ventana. Entra en
   `DECRYPTED_RENDERER_STATE`.
4. **Win+L se aplazaba también por una imagen**, no solo por un envío, como
   decían `D-106` y `LA-053`. Ahora las esperas tienen clase (`reply` o
   `image`) y solo `reply` aplaza Win+L; la línea «cierre de la boveda aplazado»
   lleva `envios` en vez de `esperas`.
5. **Promesas: el bloque y la nota de «ya salió» chocaban en cada apertura del
   tope**, porque con K = 4 y ocho turnos de ventana la respuesta a la apertura
   anterior es siempre la más antigua de la ventana. En un mensaje abierto esa
   respuesta ya no cuenta para la nota. Simulado con texto inventado: antes, bloque
   y nota juntos en los mensajes 5, 9…; después, ninguna vez.
6. **La guía de campos de `D-105` invitaba a apuntar las promesas en
   `decisions`**, que es lo que viaja en el resumen. Ahora dice que van en `plan`.
   Plausible, no medido: depende de lo que escriba el modelo.
7. **La confirmación del enganche prometía cosas no comprobadas** (`D-093`): con
   la casilla apagada, «la verá entre sus momentos» (el índice tiene tope de 40);
   con la ficha retroactiva, «si la aprobaste» (además tiene que estar al día).
   Reescritas en condicional, y la rama de la ficha dice ya que el resumen solo
   cubre las dos más recientes.
8. **La confirmación del enganche se atascaba**: sobrevivía a «Nueva» y a abrir
   otra conversación (selector desactivado sin salida, o la confirmación saltando
   a otro hilo), una vista previa vieja podía rotular el botón con otro nombre, y
   un fallo la dejaba en «Comprobando…» sin decirlo ni enseñar la pista. Ahora va
   atada a su conversación, descarta respuestas viejas, dice que falló con
   «Volver a comprobar» y pinta error y pista dentro. Sus botones y los del aviso
   «¿Es de…?» se desactivan durante un envío.
9. **Menores:** la ficha del renderer ya no se usa como repuesto al nacer; un
   personaje sin nombre firma «Sin nombre»; «nació con» solo si de verdad nació
   con él; volver a dar de alta un personaje conserva sus casillas y su receta; el
   bloque `recientes` ya no dice «la más reciente primero» (una vieja enganchada va
   primera con una fecha anterior); la presencia no gasta sus 20 s si la ventana
   no tiene el foco; los fallos de las casillas de la ficha salen en la galería;
   las guardas `owner-single-source.test.ts` y `renderer-effect-deps.test.ts`
   cazan más formas; el JSDoc huérfano de `vault-prompt.ts`, en su sitio.

**Revisado y NO cambiado, con el motivo:**

- «Sincronizar» puede cortarse por inactividad: es lo que decide `D-106` (el
  trabajo de fondo no cuenta, «aunque se lance con un botón»). El revisor decía
  que `D-106` no hablaba de sincronizar; sí lo nombra. **No se reintenta sola**
  (hay que volver a pulsar) y que no pierda datos al cortarse **no está
  comprobado**: aquí ponía «la tanda se reintenta», y era falso (corregido en la
  segunda ronda).
- La prueba de `vault-pending-pacing.test.ts` que compone bloque y nota juntos es
  del compositor, que no decide cuándo viajan: sigue siendo correcta.
- «Dejar la conversación pendiente de catalogar» (B.3): solo se quita su marca de
  fallo, porque el catálogo no lee al dueño. Queda como está, justificado en el
  código.
- Lo que el resumen de `D-105` copie a la memoria de otra conversación no se va al
  borrar, excluir o soltar la de origen; el mensaje de un envío cortado por el
  cierre se queda en el cuadro, en claro; la cuenta atrás se queda en el límite
  durante una espera aunque a los 35 minutos se cierre en la siguiente vuelta; y
  la entrada de un control remoto contaría como presencia. Anotados en `D-105` y
  `D-106`; ninguno se ha arreglado.
- `D-104` sigue antes que `D-103` en `DECISIONS.md`: es solo orden.

### Segunda ronda del 28/09

Otra ronda de revisores sobre lo anterior. Un agente comprobó cada defecto en el
código antes de tocarlo; todos los importantes se sostenían. **Tampoco esta ronda
ha tenido revisión independiente.**

Corregido, con prueba:

1. **`npm run check` fallaba** en `conversation-owner.test.ts`: la relectura de
   fondo del enganche se esperaba con un temporizador fijo de 30 ms, que con la
   suite entera en marcha se quedaba corto (en solitario pasaba). Las tres esperas
   de ese archivo esperan ahora a que ocurra lo que miran.
2. **La ficha editada no llegaba a ninguna conversación existente** (regresión
   de `D-103`; antes llegaba con «Usar» y enviar). Main la sella desde la bóveda
   con el turno cuando cambia. Tres pruebas en `conversation-owner.test.ts`.
3. **Claude Code y `codex exec` dejaban la sesión entera, con el prompt, en claro**
   en sus carpetas de sesiones. Todo lo de solo lectura lleva ahora
   `--no-session-persistence` o `--ephemeral`, si la versión lo anuncia
   (comprobado con `--help` en Claude Code 2.1.267 y codex-cli 0.154.0). Lo ya
   escrito no se borra ni se ha mirado.
4. **Promesas:** la regla «lo que no esté en esta lista no se hizo» se
   contradecía con el tope, con el `Plan:` de la memoria y con el resumen de
   otras conversaciones; se reescribe solo cuando hay tope o resumen, y apagado
   sale byte a byte como antes. El bloque `recientes` dice que lo prometido ahí no
   es un guion; la ficha retroactiva manda las promesas a `plan`; y se mide
   `ecoOtras`. Una cita de una o dos raíces ya no cuenta como «ya salió».
5. **El criterio de medida de `D-104` y `LA-054` confundía aciertos con ruido**:
   reescrito. Lo que separa uno de otro es leer las respuestas, no la cifra.
6. **Del resumen de otra conversación viajaba el principio y se caía lo último.**
   Ahora viajan la primera frase y las últimas que quepan; la reserva de las
   decisiones baja a 160. `recientes` gana `fuera` y `sinIndice`.
7. **Un turno con imagen sellaba el texto de ella después de generarla**: con AI
   Horde, un Win+L o la espera máxima podían tirar una respuesta ya pagada. El
   texto se guarda antes; un cierre a mitad solo pierde la imagen.
8. **Pantalla:** «Usar» y crear un personaje ya no abren el enganche lejos de
   donde se pulsó; «Memoria de lo ya hablado» ya no dice que es solo de su
   conversación; no se envía con la confirmación abierta; soltar vale como «No,
   esta no»; el descarte de una nueva no pasa a la siguiente; el botón de
   enganchar no sale sin proyectos; la pista del selector en una nueva dice que
   luego no se cambia; el aviso de personaje desconocido ya no manda a un campo
   que no existe; la casilla y la confirmación ya no prometen de más.
9. **Privacidad y bóveda, menores:** los descartes de «¿Es de Lía?» y una vista
   previa en vuelo entran en la purga; cerrar la sesión de la cuenta cierra la
   bóveda antes de esperar al servidor.
10. **Documentos:** `D-103`…`D-106` con su «Segunda ronda»; `LA-052` explica el
    `0` de `recientes.conversaciones`; `ENGANCHE-DISENO.md` §4.1 ya no dice que la
    regla sea igual para los tres campos; `CLAUDE.md` y `AGENTS.md` ya no llaman
    «que ya existían» a los dos `touch()` nuevos; el registro de
    `SEG-BOVEDA-001` lleva `aplazadoMs`.

**Sabido y no arreglado en esta ronda**, anotado en su decisión: una imagen
cobrada se pierde si la bóveda se cierra mientras se genera, y su intento se
queda en `sent` (`D-106`); en una conversación excluida la nota «ya salió» no
viaja nunca (`D-104`); el `characterLabel` vacío de la lista sigue vacío; el
separador no sale en las conversaciones antiguas fijadas a mitad; la cuenta
atrás y la entrega de `lock-screen` siguen sin comprobar; y el archivo temporal
de `--output-last-message` de `codex exec` deja la respuesta en claro mientras
dura el turno.

**Siguiente paso exacto:** una revisión independiente de las dos rondas de
arreglos y de los tres encargos. Después, `LA-052`, `LA-053` y `LA-054`, de
Daniel.

### Tercera ronda del 28/09 (main, shared y documentos)

Siete revisores sobre las dos rondas anteriores. Este bloque es la parte de
main, `packages/shared` y documentación; **la pantalla (`apps/desktop/src/renderer/`)
la hizo otro agente a la vez**, registrada al final del bloque. Cada defecto se comprobó en
el código antes de tocarlo. **Esta ronda tampoco ha tenido revisión
independiente**, y nada se ha visto en pantalla.

Corregido, con prueba (las tres primeras comprobadas FALLANDO sin el arreglo):

1. **[rompía] Un envío cortado podía borrar la respuesta anterior de Lía**: con
   la bóveda cerrada durante la llamada y la llamada sin respuesta, el turno se
   retiraba dos veces y la segunda se llevaba su última respuesta buena, sin
   papelera. `PrivateTurnProgress.userTurnRetired` (`handlers.ts`); pruebas con
   `failed` y con texto vacío en `private-turn-vault-lock.test.ts` (`D-106`).
2. **Win+L se aplazaba por la imagen de un turno**, con su texto ya guardado. Se
   arregla el código: en cuanto el texto está en disco, el envío cambia su
   espera `reply` por una `image` (`onReplySaved`). Prueba en
   `private-turn-image.test.ts`; `CLAUDE.md`, `AGENTS.md`, `LA-053` y el comentario
   de `vault-lock-coordinator.ts` lo dicen igual (`D-106`).
3. **La nota de «ya salió» casi nunca se disparaba.** Módulo nuevo
   `raise-roots.ts`, usado solo por `clearlyRaises`: formas de diez verbos
   irregulares, terminaciones regulares que el recorte no alcanza y prefijos de
   cinco letras con dos de sobra como mucho. Umbrales y `stem()` intactos, y la
   bolsa laxa exacta tiene que casar antes. Con texto inventado: de 2 de 9 a 7 de
   9, y 0 falsos en 248 pares de control (`D-104`).
4. **«Apagado = idéntico» donde no lo es.** La ficha editada que sella main se
   **mantiene** (es lo que Daniel esperaría), pero `D-103`, `D-104`, `D-105` y los
   comentarios de `character-store.ts` ya no dicen que con las casillas apagadas
   el prompt sea el de antes: lo que no cambia es lo que añade cada casilla.
5. **`account-manager.test.ts` por tiempo**: sola pasa tres veces seguidas (la
   prueba lenta tarda 8,9 s, 11,3 s y 9,0 s, con tope de 20 s): es carga. Esa
   prueba, y solo esa, tiene 60 s con el motivo al lado; ninguna aserción cambia.
6. **Menores de documentos**: la cifra vieja de 240 en `D-105` y la de «min(3,
   n)» en `D-104`; `D-105` avisa de la trampa de `add()` con `recentMemories`; la
   guarda `renderer-effect-deps.test.ts` se describe como guarda de texto;
   `CLAUDE.md`/`AGENTS.md` dicen que la ficha editada va dentro del turno, que sí
   sube al sincronizar; `ROLEPLAY-EVOLUCION.md` y `PENDIENTES-DISENO.md` llevan
   una nota de estado con `D-104`; `PROJECT-STATE.md` vuelve a CRLF.

**No se sostiene o no se cambia, con el motivo** (detalle en su decisión):

- «Lo que llega del resumen es poco»: cierto, y es una decisión de producto que se
  le plantea a Daniel. **Los topes no se tocan** (`D-105`, tercera ronda).
- La regla contra inventar promesas se va con el bloque cuando el tope lo cierra:
  cierto; moverla cambia un texto de tres redacciones y un juez, eso con Daniel
  (`D-104`).
- `conversation-owners.json` ilegible tumba todas las conversaciones: cierto; leerlo
  como vacío cambiaría el dueño en silencio. Con Daniel (`D-103`).
- La ficha retroactiva nueva mueve la línea base de `ecoMemoria`: cierto, anotado
  (`D-104`).
- El último trozo de un resumen sin punto final viaja sin «…»: es el texto tal y
  como está sellado; marcarlo diría que se cortó (`D-105`).
- Fuera de lo pedido: si `runLocalTurn` LANZA con la bóveda abierta,
  `runPrivateTurn` no retiraba el mensaje ya escrito. **Corregido en la cuarta
  ronda**, abajo.

**Parte de pantalla de la tercera ronda: HECHA** (otro agente, a la vez que lo de
arriba; aquí se registra después). Todo en `apps/desktop/src/renderer/` y
**nada visto en Electron**: el repositorio no monta componentes.

1. **El botón de enganchar lejos de su confirmación.** `OwnerChangePanel` lleva
   la vista a sí mismo al montarse (`scrollIntoView`, como el formulario del
   Horde), y junto a «Enviar» un `field__hint` dice que espera a que se confirme
   o se deje estar el cambio (el `title` se queda).
2. **El aviso «¿Es de…?» troceaba la conversación en cada render.**
   `charactersNamedIn` va en un `useMemo` sobre los turnos y los personajes;
   `suggestWithHistory` solo trocea el borrador. Medido con texto inventado,
   600 mensajes de 2000 caracteres: de ~600 ms en cada tecla a ~180 ms una vez
   por cambio de turnos y 0,02-0,2 ms por tecla.
3. **La vista previa que se quedaba en «Comprobando…»** al reabrir la misma
   conversación o sincronizar: `ownerPreviewEpoch` en `useVault` la vuelve a
   pedir.
4. **«Te responde con su ficha» con la ficha vacía**: `describeCharacterLink`
   exige `hasDescription` y con la ficha vacía lo dice.
5. **Textos (`D-093`)**: las tres casillas apagadas dicen «apagada, esta casilla
   no añade nada al prompt»; «la recordará» pasa a «le llegará un resumen corto»;
   y la confirmación del enganche avisa de que sus pendientes pueden callarse
   hasta que termine la relectura.

Prueba nueva: `apps/desktop/src/main/owner-change-panel.test.ts`, **estática
sobre el texto del código** (que existan el `scrollIntoView`, el epoch y el memo),
no de comportamiento. Ejecutado por el revisor de pantalla: 39 pruebas en verde
entre esa y `vault-character-link.test.ts`, y `tsc` del renderer sin errores.

### Cuarta ronda del 28/09

Cinco revisores sobre la tercera, y un `npm run check` a solas (el «seis» de
antes contaba el check). Un agente comprobó cada defecto en el código antes de
tocarlo. Después la revisaron otros cinco revisores y pasó `npm run check` a
solas (222 archivos, 4520 pruebas y 12 omitidas). **Nada visto en Electron.**

Corregido, con prueba (de las seis nuevas de los puntos 1 y 2, cuatro comprobadas
FALLANDO sin el arreglo: dos de `sync.test.ts` y las dos de
`private-turn-vault-lock.test.ts`; la de `conversation-store.test.ts` y la tercera
de `sync.test.ts` no se vieron fallar):

1. **[importante] «Sincronizar» a mitad de un envío** (venía de antes). Subía el
   mensaje de Daniel todavía sin respuesta; si la llamada fallaba, main lo
   retiraba en local, pero el servidor se quedaba con él, y el mensaje bueno que
   ocupaba después ese número se descartaba en silencio. Y un registro bajado del
   otro equipo durante el envío quedaba detrás de su mensaje, y `removeLastTurn`
   se lo llevaba a él. Ahora: `syncVault` deja para la siguiente los turnos de la
   conversación que está en `sendInFlight` —sus medios sí viajan— (lo mira antes de subir y justo antes
   de cada escritura), y la pantalla lo dice; y `removeLastTurn` recibe el
   `recordId` del mensaje y solo retira la última línea si es esa. Pruebas en
   `sync.test.ts` (tres), `conversation-store.test.ts` y
   `private-turn-vault-lock.test.ts` («otra línea detrás»).
2. **El mensaje huérfano si `runLocalTurn` lanza con la bóveda abierta** (el
   agente parado): se retira igual que cuando la llamada vuelve vacía
   (`retireUnansweredTurn`, una sola vez y por `recordId`). Su texto sigue en el
   cuadro. Prueba en `private-turn-vault-lock.test.ts`. Con esto es verdad lo que
   dice `D-104`: solo quedaría uno si el proceso muere en medio.
3. **«Ya salió»**: la regla general de la vocal final se quita (unía «casa» y
   «caso», «peli» y «pelo»; con ella se fabricó un falso), y cuatro verbos de raíz
   corta van en tabla (besar, cenar, jurar, pagar). Las citas largas siguen casi
   sin dispararse: **no se baja el listón** —medido con texto inventado, bajarlo
   metía falsos de conversaciones del mismo tema— y el diagnóstico de pendientes
   cuenta ahora cuántas citas largas hay y cuántas veces contaron
   (`longQuotes`, `herMentionsClear…`). Detalle en `D-104`.
4. **Pantalla, menores**: la casilla se llama «Pasarle un resumen corto de sus dos
   últimas conversaciones»; «Aplicando el cambio…» en vez de volver a
   «Comprobando…» al confirmar; la ficha de solo espacios se juzga con `trim`,
   como el prompt; volver a la conversación ya no salta a la confirmación; y la
   pista «El modelo sabe que es» avisa si se editó su ficha.
5. **Documentos**: este bloque; `D-103`…`D-106` con su cuarta ronda y los cuerpos
   de `D-104` y `D-105` sin «byte a byte» del prompt entero; `LA-054` avisa de no
   tocar la ficha entre los dos brazos; la línea larga de `CLAUDE.md`/`AGENTS.md`.

**No se cambia, con el motivo:** la espera `image` del turno empieza su propio
tope de 35 minutos, así que un envío con imagen puede tener la inactividad parada
más de 35 (anotado en `D-106`); los verbos de raíz corta que también son otra
palabra (mirar, tocar, pasar, bañar, beber, comer) no se unen.

**Siguiente paso exacto:** `npm run check` completo y la revisión independiente
de las cuatro rondas; después, `LA-052`, `LA-053` y `LA-054`, de Daniel.
(Hecho después: la revisión de la cuarta ronda, cinco revisores, y un `npm run
check` a solas en verde, 222 archivos, 4520 pruebas y 12 omitidas, los pasó quien
coordina; de ahí sale la quinta.)

### Quinta ronda del 28/09

Cinco revisores sobre la cuarta, y un `npm run check` a solas (el «seis» de
antes contaba el check): ninguno encontró nada que rompa. Dos defectos
importantes, los dos en «ya salió», y menores. Un agente los comprobó en el
código antes de tocarlos. Después la revisaron otros cinco revisores y pasó
`npm run check` a solas (222 archivos, 4531 pruebas y 12 omitidas); commiteada en
`a45953b`. **Nada visto en Electron.**

Corregido, con prueba:

1. **[importante] «traerme» no llegaba a la tabla de traer**, ni «traernos»,
   «traértelo» o «ponérmelo»: la tabla se consultaba con la raíz tal cual. Ahora
   también sin su pronombre (`regularRoot`).
2. **[importante] «te preparo» no casaba con «prepararte» ni «prepararía»**:
   `stem()` deja «preparo» en «prep» y quitar el infinitivo una sola vez dejaba
   «prepar». Ahora lo que queda al quitar pronombre o condicional se recorta con
   el mismo `stem()`. De paso: pronombres dobles, gerundio con pronombre y
   «viniera», «saliera», «durmamos», «vernos», «darme». Con el texto inventado
   de la revisión, paráfrasis 29 de 32 (antes 25), sin ningún falso nuevo en
   neutras, cruzadas ni adversarias. Detalle y límites en `D-104`, quinta ronda.
3. **Un envío por conversación**: un segundo envío a la misma conversación con
   otro en curso se rechaza antes de escribir nada. Y sin `userRecordId` el turno
   no retira nada, en vez de caer a «la última línea».
4. **Ficha de solo espacios**: main (y la pista de pantalla) la juzgan con `trim`,
   como el compositor; ya no sustituye a la sellada.
5. **Menores de pantalla y documentos**: `title` en el botón de enganchar
   desactivado; el comentario de `useVault.ts` nombra la guarda que existe
   (`renderer-effect-deps.test.ts`); `CLAUDE.md`/`AGENTS.md` y `D-106` ya no dicen
   que la sincronización deja «entera» la conversación en curso (sus medios
   viajan); `D-104`/`D-105` cuentan el tercer cambio sin casilla y llaman a
   `herMentionsClear` cota superior; este bloque corrige cuántas pruebas de la
   cuarta ronda se vieron fallar.

**No se cambia, con el motivo:** la bolsa exacta va primero (de diseño; explica 2
de las 3 paráfrasis que quedan); los falsos por tema que ya estaban (cenamos~cenar,
precio~preciosa, por la regla del prefijo); la ficha vigente que llega sin aviso a
una conversación sin ficha sellada, y el texto «tu mensaje no se ha guardado»
cuando la retirada no casa (ya ningún camino conocido lo alcanza).

**Siguiente paso exacto:** hecho —la revisión (cinco revisores) y el `npm run
check` a solas, 4531 pruebas—; de ahí sale la sexta.

### Sexta ronda del 28/09

Lo que dejó la revisión de la quinta (`r3:*`): dos defectos importantes y
menores. Un agente los comprobó en el código antes de tocarlos. **Revisada
después por ocho revisores junto con 2f, 2g y 2h, con `npm run check` a solas en
verde (29/09: 228 archivos, 4677 pruebas y 12 omitidas; aquí decía «sin
revisión, sin check»). Nada visto en Electron.**

Corregido, con prueba comprobada fallando sin el arreglo:

1. **[importante] Win+L tiraba la imagen del turno, ya pagada.** Tras guardar el
   texto, el envío soltaba `reply` y arrancaba la imagen; el cierre aplazado se
   cumplía en la vuelta siguiente del reloj y la imagen, cobrada, no se podía
   guardar. Decisión de quien coordina, con el propósito de `D-106`: el
   aplazamiento cubre también esa imagen, como tercera clase de espera
   (`turn-image`), con tope de 15 minutos desde que el coordinador ve ese tramo
   (desde el texto guardado o, si Win+L llega después, desde Win+L; corregido
   en la séptima ronda, aquí decía «desde que el texto queda guardado»), y
   después cierra. La `image` del panel sigue sin aplazar nada. Código en
   `vault-lock-coordinator.ts`, `vault-service.ts` y `handlers.ts`; pruebas en
   `vault-lock-coordinator.test.ts` (tres) y `private-turn-image.test.ts`; la
   regla, igual en `CLAUDE.md`, `AGENTS.md`, `D-106`, `LA-053` y el comentario
   del coordinador.
2. **[importante] Los documentos se contradecían sobre la verificación.** Este
   bloque, la entrada del archivo, `CHANGELOG-WORK.md`, `PROJECT-STATE.md`,
   `MASTER-PLAN.md`, `TEST-RESULTS.md` y `D-106` dicen ahora lo mismo: la corrección hizo tres rondas de cinco revisores, una tras cada ronda de
arreglos de la tercera a la quinta, y las tres pasaron `npm run check` a solas:
222 archivos y 4511, 4520 y 4531 pruebas (12 omitidas); la última quedó
commiteada en `a45953b`.
3. **[importante] La cifra de `LA-054`.** `herMentionsClear` es una COTA
   SUPERIOR, no «cuántas habrían llevado la nota»: lo dicen `LA-054`, el JSDoc
   del campo (y el del esquema) y el texto de pantalla («lo dijeron lo bastante
   claro para la nota; como mucho»).
4. **Borrar una conversación con un envío en vuelo** la resucitaba con solo la
   respuesta de ella; ahora se rechaza, como olvidar la memoria. Prueba en
   `private-turn-vault-lock.test.ts`.
5. **Comprobado, ya estaba**: si `runLocalTurn` LANZA con la bóveda abierta, el
   envío retira el mensaje una sola vez (`retireUnansweredTurn`, desde la cuarta
   ronda). Dos pruebas más: el primer mensaje, y una línea ajena detrás, que no
   se toca.
6. **«Ya salió», menores** (`raise-roots.ts`): «llegué», «busqué», «empecé» y
   «pagué» se unen con su verbo; la tabla de pagar genera «pague» y no «page»;
   «leer» entra en la tabla; en un verbo de la tabla no vale el prefijo, que unía
   «te cuento» con «cuéntame». Con el texto inventado del revisor: paráfrasis 40
   de 48 (antes 38), adversarias 3 de 45 (antes 4), neutras y cruzadas 0.
7. **Textos que decían «el prompt de siempre» con todo apagado**: `ipc.ts`,
   `useVault.ts`, `handlers.ts`, `ipc.test.ts` y una nota en `D-102` dicen ahora
   que la casilla apagada no añade nada, no que el prompt sea el de antes.
8. **Menores de documentos y comentarios**: el motivo falso del rechazo del
   segundo envío (salir de Privado no reinicia `sending`; recargar la ventana
   sí); `D-106` con su quinta ronda como bloque propio; `D-104` sobre quién
   pierde el «QUIÉN ERES»; los comentarios de `sync.ts` sobre lo que se aplaza;
   el de `whileUserWaits`; el título de `F33-RECUERDO-001`.
9. **«¿Es de Rosa?» al principio de una línea**: el troceo de
   `vault-character-link.ts` quitaba el salto de línea antes de mirarlo; ahora
   solo quita espacios y tabuladores, y la raya de diálogo también empieza frase.
   Prueba en `vault-character-link.test.ts`.

**No se cambia, con el motivo:** `docs/PENDIENTES-DISENO.md` en LF
(`core.autocrlf` lo normaliza al guardar en git).

**Siguiente paso exacto:** `npm run check` a solas y la revisión de la sexta
ronda; después, `LA-052`, `LA-053` y `LA-054`, de Daniel.

## F33-PROMESAS-001 — las promesas, de vez en cuando (2026-09-25; corregido el 2026-09-28)

Estado: **construido, sin revisión independiente del flujo (ver
`REV-TRES-ENCARGOS-001`), NADA visto en pantalla y NADA medido contra una
conversación real.** Decisión `D-104`; prueba de Daniel `LA-054`.

**Origen.** Daniel: «Lía sigue en bucle con las promesas a cada mensaje. Debería
de ser algo esporádico». El bloque de pendientes iba en el 71 % de los prompts.

**Lo construido**, detrás de una casilla por personaje, «Sacar los pendientes solo
de vez en cuando» (`pendingPacing: 'sparse'`, nace en `per-note`; apagada, esta
casilla no cambia ni un byte del prompt, aunque la ficha editada y la ficha
retroactiva nueva sí pueden cambiarlo: `D-104`, tercera ronda):

1. **Tope**: el bloque va solo en los mensajes 1, 5, 9… de él en esa conversación
   (`PENDING_BLOCK_EVERY = 4`); una nota que él nombra lo salta siempre.
2. **Permiso con condición** (`VAULT_PENDING_SPARSE_PERMISSION`).
3. **«Ya salió», sin decir cuál**: bloque `pendientes-ya-salio` antes del mensaje
   nuevo, cuando ella sacó una con claridad en la ventana y él no la ha retomado.
   Desde el 28/09, en un mensaje con el tope abierto no cuenta la respuesta a la
   apertura anterior.
4. **Medida** en «prompt privado compuesto»: `pendientesEsporadicos`,
   `notaYaSalio` y, dentro de `pendientes`, `topeCerrado`, `retenidasPorTope` y
   `sacadasPorElla`. Solo booleanos y enteros.

Pruebas: `vault-pending-pacing.test.ts`, `relation-selection.test.ts`,
`ipc/character-pending-pacing.test.ts`, `ipc/private-turn-pending-pacing.test.ts`,
y casos en `vault-reply-guidance.test.ts`, `character-store.test.ts` e
`ipc.test.ts`.

**No hecho / no comprobado:** ~~si un reintento de Studio añade otro mensaje suyo y
corre una posición la apertura~~ (resuelto: un mensaje sin respuesta se retira
siempre, también si el turno lanza con la bóveda abierta, desde la cuarta ronda
del 28/09; solo queda si el proceso muere entre guardarlo y retirarlo); `aludidos` de «pendientes en la respuesta» vale 0
por construcción con el tope cerrado; el título «NOTA SOBRE LO PENDIENTE» lo puso
el agente, no el panel de redacción; con el ajuste encendido, `sacadasPorElla` ya
no cuenta en un mensaje abierto la respuesta a la apertura anterior (apagado
sigue siendo la línea base).

**Siguiente paso exacto:** la revisión de `REV-TRES-ENCARGOS-001`; después,
`LA-054`, de Daniel.

## F33-ENGANCHE-LOCAL-001 y F33-RECUERDO-001 — enganchar en este equipo, y un resumen corto de sus dos últimas conversaciones (2026-09-25)

Estado: **construido, sin revisión independiente del flujo y corregido el 28/09
en seis rondas (`REV-TRES-ENCARGOS-001`), NADA visto en pantalla.** El «`npm
run check` en verde (213 archivos, 4396 pruebas)» que decía esta línea era el del
25/09 y no cubre los arreglos. La corrección hizo tres rondas de cinco revisores, una tras cada ronda de
arreglos de la tercera a la quinta, y las tres pasaron `npm run check` a solas:
222 archivos y 4511, 4520 y 4531 pruebas (12 omitidas); la última quedó
commiteada en `a45953b`. La sexta no lo ha pasado entero. Relevan la parte local de `F33-ENGANCHE-001`;
la del servidor sigue sin construir. Decisiones `D-103` (el dueño) y `D-105` (el
resumen). Prueba de Daniel: `LA-052`.

**Origen.** Daniel: «si Lía no recuerda que es su conversación, no me sirve para
nada». Enganchar cambia de quién es; que la recuerde desde otras lo hace el resumen.

**Lo construido:**

1. **Un solo dueño.** `resolveConversationOwner` (`packages/shared/src/vault-owner.ts`)
   y `PrivateConversationStore.owner()`; `list()` usa la misma función. Fuera
   `characterOf` y los tres `latest*` de personaje e instrucciones; los lectores
   (prompt, índice, pendientes, lista, pantalla, sonda, instrucciones del
   personaje) pasan por ahí. `owner-single-source.test.ts` lo vigila.
2. **Enganche al pulsar**, cifrado en `vault/conversation-owners.json` con la carga
   v1 definitiva (`uploadedAt: null`), con id, ficha e instrucciones puestos por
   main. Dos IPC: `vaultConversationOwnerPreview` y `vaultConversationOwnerSet`.
3. **Al cambiar el dueño**: `privateMemory.invalidate()`, cursor de pendientes con
   dueño (sin carrera), relectura en segundo plano, marca de catálogo quitada.
4. **Una sola forma**: fuera el campo del identificador; el envío rechaza
   personaje en una conversación con mensajes; el turno 0 lo sella main con la
   ficha de la bóveda.
5. **Pantalla**: selector «Personaje» junto a Proveedor, título con el nombre,
   respuestas firmadas por posición y separador, botón «Enganchar a un
   personaje», confirmación con la vista previa, «Soltar» y casilla nueva en la
   ficha.
6. **Aviso «¿Es de Lía?»** (`renderer/vault-character-link.ts`), con tildes y sin
   ellas, sin registrar nada.
7. **R1**: bloque `recientes` con sus dos conversaciones más recientes, detrás de
   la casilla «Pasarle un resumen corto de sus dos últimas conversaciones» (antes
   «Recordar sus dos últimas conversaciones»), con la guía de campos.

**Cambios de comportamiento que hay que saber:**

- Una conversación que selló un id sin ficha después de la de OTRO personaje, o
  que se soltó con `''`, deja de mandar la ficha vieja. Es el arreglo, pero cambia
  prompts reales; cuántos, no se sabe sin descifrar. Desde el 28/09, soltar y
  volver a elegir a la MISMA con el Studio anterior conserva su ficha: la primera
  versión de la regla se la quitaba.
- **Ya no se puede soltar ni cambiar una conversación que nació con personaje**:
  el campo del identificador era la única vía.
- Si `conversation-owners.json` existe y no abre, la lista de Privado falla con un
  `VaultError` que dice que no se ha tocado el archivo. Es a propósito: seguir sin
  él cambiaría de dueño conversaciones en silencio.

**No hecho / no comprobado:** el servidor y la sincronización de estos eventos;
M1 y M2 del diseño; que la frase «las promesas ya cumplidas siguen cumplidas» sea
cierta (se quitó de la pantalla por no estar probada); el coste de `list()` y
`owner()`; qué llevan de verdad los `decisions` de las memorias selladas; el
recuento actual de registros de la 3657a284.

**Siguiente paso exacto:** la revisión de `REV-TRES-ENCARGOS-001`; después,
`LA-052`, de Daniel.

## F33-VARIEDAD-001 — que Lía no se copie a sí misma (2026-09-25)

Estado: **construido, `npm run check` en verde (200 archivos, 4220 pruebas en verde y 12 omitidas (4232)),
NADA visto en pantalla.** La decisión completa es `D-102`.

**Origen.** Daniel pegó en el chat una conversación de 16 turnos con Lía en
DeepSeek. **No se guardó en ningún sitio ni se pasó a ningún agente**: se les
describió el patrón en abstracto. La repetición no eran las promesas, era la
**forma**: 11 de 14 respuestas abrían con la misma acotación, 9 cerraban igual (6
palabra por palabra), había acotaciones de dos líneas idénticas letra por letra y
una plantilla de siete pasos que se endurecía turno a turno. Y le cedió la
iniciativa tres veces de forma explícita y las tres se la devolvió.

**Lo construido**, cuatro cambios, todos con interruptor:

1. **Muestreo por modelo** en cada conexión (`modelSampling`), que
   `familyProviderConfig` pasa a las familias. Arregla que los cuatro campos de
   `D-098` no llegaran nunca al modelo de Lía. Sin valor por defecto.
2. y 3. **Dos notas de dirección** (`packages/shared/src/vault-reply-guidance.ts`)
   detrás de un ajuste por personaje, `replyGuidance`, apagado por defecto. Apagado,
   el prompt sale byte a byte como antes. El texto salió de cuatro redacciones y
   tres jueces.
4. **Medidor de copia** (`packages/shared/src/self-copy.ts`): una línea «copia de
   sus respuestas» en `studio.log`, sólo con enteros, que compara lo copiado de la
   ventana con un control de respuestas que no tenía delante.

**Lo que se corrigió después del flujo, a mano y con escépticos:**

- la nota de iniciativa acababa con una regla **sin excepción** («ciérrala tú, sin
  devolverle el turno») que Daniel no aprobó y que chocaba con las órdenes de
  preguntar en vez de inventar (`D-061`). Pasó a «no siempre» con permiso para
  preguntar; **un escéptico demostró que ese permiso dejaba la puerta abierta**
  —«¿qué quieres que te haga?» podía pasar por un dato que le falta—, y quedó con
  el criterio «lo que puedes decidir tú no es un dato»;
- el método de medir de `D-102` (tandas de 5 turnos sin descartar nada, cuando
  cada respuesta sigue viajando cuatro turnos más);
- **una afirmación falsa**, en cuatro sitios, uno de ellos texto de la pantalla de
  Conexiones: que DeepSeek ignora las penalizaciones. Sólo es cierto **en modo
  razonamiento** (https://api-docs.deepseek.com/guides/thinking_mode), y por la
  pasarela de Daniel 12 de 13 llamadas iban sin razonar. El error salió del
  encargo que se les dio a los agentes.

**Siguiente paso exacto: `LA-050`, de Daniel.**

**Menores que quedan abiertos:** el medidor no recibe el mensaje de él, así que su
eco literal cuenta como autocopia (afecta igual a los dos brazos); el `system` de
conversación sigue llamando al historial «el canon» (el paso 2.2 del plan, que no
estaba aprobado); y un comentario de `handlers.ts` que no cuenta los turnos citados
en un recuerdo como «lo que tenía delante».

## SEG-SYNC-001 — la bóveda no tiene copia, y la sincronización no la haría (2026-09-25)

Estado: **diagnosticado con lectura de código y mediciones, NADA arreglado.**

**Lo demostrado.** La bóveda sólo existe en este disco (Daniel, 25/09: la bóveda
ni existe en el otro ordenador) y **no hay ni una sincronización** en los
registros. El gateway en producción es **byte a byte el commit `5bde157`**:
probado con el log de wrangler del 02/09 y con el paquete del dry-run que quedó
en `apps/gateway/.wrangler/dry-run/`, cuyas 52 fuentes coinciden. El código de la
sincronización no ha cambiado desde entonces en ningún lado: **volver a desplegar
no arregla nada.**

**Tres fallos, en el código de hoy:**

1. **Fechas.** La bajada exige `z.string().datetime()` (fechas en «Z»,
   `packages/shared/src/vault.ts:135` y `:162`), y el gateway devuelve
   `row.created_at` tal cual (`handlers/vault.ts:67` y `:79`). Postgres escribe
   `+00:00`: la sincronización se cortaría tras la primera conversación. Hipótesis
   de confianza alta; la confirma `select to_json(now());` (`LA-051`).
2. **Congelación.** `insertVaultRecords` usa `on_conflict` sin `Prefer:
   resolution=ignore-duplicates` y se traga los errores (`repository.ts:784-785`):
   desde la segunda sincronización, lo nuevo no sube y no avisa.
3. **Límite de 200.** El push admite 200 registros y la bajada no pagina. La
   conversación más larga tiene hoy 122.

**Por diseño no sube**, aunque todo lo anterior funcionara: `characters.json`
(Lía, su semilla y su receta), los avatares, `catalog.json`, `recap.json` —la
memoria de **18 de las 22 conversaciones** vive sólo ahí—, `relation.json` e
`image-attempts/`.

**Siguiente paso exacto:** `LA-049` ya. Arreglar los tres fallos está pendiente
de que Daniel lo apruebe; desplegarlo exige su autorización expresa.

## F33-ENGANCHE-001 — enganchar una conversación a un personaje (2026-09-25)

Estado: **la parte de ESTE equipo, construida el 25/09 (`F33-ENGANCHE-LOCAL-001`,
arriba); la del servidor, diseñada y sin construir.** Plan en
`docs/ENGANCHE-DISENO.md`. Lo que sigue es el diagnóstico de antes de construir:
el campo «Personaje de esta conversación» ya no existe (el selector es
«Personaje») y la causalidad del dueño la cierra `D-103`.

**Origen.** Daniel empezó sin querer una conversación sin personaje (`3657a284`,
19 turnos) y le habló a Lía. Pidió un botón para engancharla y que Lía la
recuerde.

**Demostrado (antes de construir):** no hay fuga entre personajes —el índice
filtra por igualdad estricta, `private-memory.ts:257-262`—; el enganche **existía
a medias**: el campo «Personaje de esta conversación» sellaba sólo el id, sin la
descripción ni las instrucciones, y soltar dejaba la descripción vieja en vigor. Y
**enganchar no es recordar**: la memoria de una conversación no la lee ninguna
otra, y desde otra Lía sólo vería una línea de índice.

**Decisiones de Daniel (25/09):** enganche **inmediato y en los dos ordenadores**
(exige una migración nueva y volver a desplegar); resumen de las 2 últimas
conversaciones en cada mensaje; el cuaderno de la relación, **después** del
resumen; y aviso «¿Es de Lía?» al nombrarla. Lía sólo existe en este ordenador.

**El diseño tenía 22 fallos** de tres escépticos. El peor —la regla del dueño
ignoraba la causalidad— quedó cerrado en el formato local por `D-103`; los que son
de dos equipos siguen abiertos (la lista, en `D-103`).

**Siguiente paso:** arreglar `SEG-SYNC-001`, porque el enganche va encima; después,
segunda vuelta del diseño del servidor.

## SEG-BOVEDA-001 — la bóveda no se cierra por inactividad (2026-09-23; construido el 2026-09-25, corregido el 2026-09-28)

**Estado (28/09): construido, `npm run check` en verde el 25/09 (220 archivos, 4452
pruebas y 12 omitidas), sin revisión independiente del flujo y corregido el 28/09
(`REV-TRES-ENCARGOS-001`), NADA visto en pantalla.** Decisión `D-106`; prueba de Daniel
`LA-053`. Lo de abajo, bajo «El diagnóstico del 23/09», es la causa medida y sigue
valiendo como historia.

**Lo construido (el encargo C, aprobado por Daniel):**

1. **Leer no es actividad.** `touch()` sale de `subkeyFor()` y de `vaultId()`.
   Solo cuentan: abrir; la presencia real en Privado (teclado, clic, movimiento y
   rueda del sistema, como mucho un aviso cada 20 s, y el proceso principal lo
   cuenta solo con la ventana visible y con el foco); una **espera del usuario**
   mientras dura un envío, generar una imagen desde el panel o aprobar una
   pendiente, con tope de 35 minutos; y las operaciones de cuenta y el ajuste de
   minutos, que ya lo hacían. El trabajo de fondo no cuenta nunca.
2. **El bucle de la pantalla, cortado.** Los dos efectos (la foto del personaje y el
   visor) dependen de la función y no del objeto de `useVault`; las tres flechas
   del `return` pasan a `useCallback`. `renderer-effect-deps.test.ts` lo vigila.
3. **Win+L y suspender** cierran (`powerMonitor`). Win+L con un envío suyo en curso
   espera a que la respuesta se guarde, como mucho 10 minutos, y desbloquear antes
   lo anula. **Solo un envío**: generar o aprobar una imagen no aplaza Win+L (la
   primera versión sí lo hacía; corregido el 28/09). Suspender cierra siempre en
   el acto.
4. **La X cierra la bóveda**, aunque Luxy siga en la bandeja.
5. **Registro:** «boveda abierta» `{via}` y «boveda cerrada» `{motivo, abiertaMs,
   derivaciones, aplazadoMs?}` —`aplazadoMs` solo si el cierre venía aplazado por
   Win+L—, en un solo sitio (`VaultLockCoordinator`). Sustituye a «boveda
   bloqueada por inactividad».
6. **Pruebas:** la que exigía que leer fuera actividad, reescrita; el temporizador
   real con relojes falsos; cada disparador; el envío cortado; y las tres pasadas
   de fondo, que ya no marcan como fallida una conversación porque la bóveda se
   cerrara a mitad (`D-088`).

**Sin tocar:** el ajuste de minutos y su «0 = nunca». Con «No cerrarla sola», Win+L,
suspender y la X siguen cerrando.

**Decisiones que Daniel no ha confirmado** (van en `D-106`): aplazar el cierre por
Win+L si hay un envío en curso (cambiarlo es poner `LOCK_SCREEN_GRACE_MS` a 0); que
la X cierre en el acto aunque se pierda una respuesta ya pagada; y que el 0 no
apague Win+L, suspender ni la X.

**No hecho / no comprobado:** que Windows 11 entregue `lock-screen` a Electron 43;
nada en pantalla; cancelar el turno del modelo al cerrar; el tercer lector del
diagnóstico (69 medios y 21 conversaciones leídos en un minuto, que los dos
efectos no explican): ya no mantiene viva la bóveda, y `derivaciones` en la línea
de cierre dirá si sigue ocurriendo. Tras un envío cortado **después** de guardar la
respuesta, al reabrir la bóveda esa conversación queda seleccionada y vacía hasta
pulsarla (leído en el código, no visto).

**Siguiente paso exacto:** la revisión de `REV-TRES-ENCARGOS-001`; después,
`LA-053`, de Daniel.

### El diagnóstico del 23/09

Daniel se fue hora y media y la bóveda siguió abierta. Su ajuste son **15
minutos**, leídos en `%APPDATA%\Luxy\vault.json`; el valor por defecto del código
son 5 (`key-file.ts:26`).

**La causa, medida en su equipo con el equipo desatendido:** la propia pantalla de
la bóveda se relee sola cada uno o dos minutos —112 archivos leídos en un minuto—
y **toda lectura reinicia el contador**, porque `touch()` vive dentro de
`subkeyFor()` y `subkeyFor` es la única puerta a cualquier contenido. Lo disparan
dos efectos que dependen de la identidad del controlador, que cambia en cada
render: la **foto del personaje** y el visor de imagen.

**Siguiente paso exacto, y es de Daniel:** abrir Privado con la bóveda abierta,
mirar la cuenta atrás de «Bloqueo automático» dos minutos sin tocar nada. Si
vuelve a saltar a 15:00, confirmado. **Si en su lista no se ve ninguna foto de
personaje, la explicación principal no vale** y hay que buscar un tercer camino.

**El arreglo bueno no es el parche.** Lo de fondo es separar «hay alguien delante»
de «se usó la llave»: sacar `touch()` de `subkeyFor` y marcarlo en el borde donde
hay intención real. Mientras siga ahí, cualquier lector periódico que se añada
desactiva el cierre en silencio. El parche —estabilizar el objeto de `useVault`
con `useMemo` y quitar `vault` de las dependencias de los dos efectos— corta el
bucle de hoy y no cierra la puerta de mañana.

**La prueba que impedía cazarlo hay que reescribirla**, no sólo añadir otra:
`vault-service.test.ts:227` («usar la boveda cuenta como actividad») **exige** que
`subkeyFor` aplace el cierre. Y ningún `.test.ts` importa `main/index.ts`, así que
el `setInterval` real no está cubierto por nada.

**Tres agujeros más de la misma familia, ninguno arreglado:** cerrar la ventana
con la X no cierra la bóveda (se esconde en la bandeja); **Win+L tampoco**
(`powerMonitor` no aparece en todo el proceso principal); y `vaultUnlock` /
`vaultLock` no escriben ni una línea de log, así que no hay forense posible.

## F32-OLVIDAR-001 — borrar la memoria que una conversación se escribe sola (2026-09-23)

**Estado: construido, cuatro rondas, `npm run check` en verde (4.107 pruebas).
NO visto en pantalla.**

Daniel lo pidió porque una conversación de **prueba** —sólo pedir fotos para
comprobar cambios de código— estaba siendo recordada. Se construyó ver la memoria
propia y borrarla, con confirmación que dice qué se destruye y qué no.

El detalle está en `CHANGELOG-WORK.md` de esta misma fecha y en `D-099`, `D-100` y
`D-101`. Lo que hace falta aquí es lo que queda:

**Siguiente paso exacto, de Daniel:** reconstruir, abrir Studio y usar el botón
sobre esa conversación de prueba. La revisión final siguió su caso concreto
—excluida del trabajo de fondo, sellada, sin ficha— paso a paso y no encuentra
nada que le haga perder algo. Lo que **no** está visto: que el aviso rojo se lea,
que los tres botones de la confirmación quepan, y que el acuse salga donde se
espera. El acuse **no sale verde**: `.notice[data-tone=ok]` no existe en
`styles.css`.

**Tres defectos conocidos y abiertos**, ninguno alcanza al caso de Daniel pero sí
a otras conversaciones:

1. `forgetCostsApproval` (`vault-recap-row.ts:247`) se apaga con
   `!cardRevivesOnForget` sobre una premisa falsa: eso no significa «la ficha cubre
   hasta el final». El razonamiento de `:166-171` y `D-101 §2` hay que corregirlo,
   no sólo ampliar la condición.
2. No cubre la conversación cuya única entrada es el `supersededMarker`.
3. **El recuadro rojo de esa sección no se apaga** cuando la operación siguiente
   sale bien: sus cuatro verbos no pasan por `run()`, que es lo único que limpia.

**Y dos menores que también quedan:** la guarda `sendInFlight` cubre el envío pero
no una pasada de relleno en vuelo (`recap-sync.ts:1275-1288`); y el acuse puede
quedarse mintiendo si la fila desaparece por otro motivo (borrar la conversación
entera).

> **Relevado el 2026-09-25 por `F33-VARIEDAD-001`**, que construyó los cambios.
> Lo de abajo se conserva como historia del diagnóstico.

## F31-REPETICION-001 — medir la repetición antes de tocarla

Estado: **medido el 2026-09-25 con 62 turnos reales — y la medida no sirve.**
Diagnóstico completo, con tres refutaciones, en `docs/ROLEPLAY-EVOLUCION.md`
§1-§2. Lo de abajo, desde «Origen», es del 2026-09-17 y se conserva como
historia; **donde contradiga a este párrafo, manda este párrafo.**

### Lo medido el 2026-09-25, en corto

**El contador no mide lo que se creía.** `matchesStems` es una bolsa de raíces:
basta con compartir `min(2, k)` raíces de la cita, al menos el 40 %, en
cualquier orden, con **una cualquiera** de las diez notas vivas
(`apps/desktop/src/main/vault/relation.ts:35-38` y `97-113`). Con una prueba
sintética —promesas y textos inventados, nada de la bóveda— casa por azar el
39 % de las respuestas de 500 caracteres y el 83 % de las de 1.000.

**`ecoHistorial` recorre la conversación entera, no la ventana.**
`history.slice(0, -1).filter(assistant)` sobre el hilo completo
(`handlers.ts:4403` y `4651`); **el comentario de `handlers.ts:4649-4650` dice
lo contrario y es falso**. Y `ecoMemoria` sólo mira `plan` y `openQuestions`:
no ve `summary`, `facts`, `decisions` ni `lessons`, así que su 0 no descarta la
memoria.

**Lo que sí separa el contador es el MODELO**, y con fuerza: glm-4.5-air y Qwen
casan 17 de 17 respuestas largas; DeepSeek-V4-Flash 4 de 10 con respuestas igual
de largas o más (Fisher unilateral p ≈ 0,0007, confundido con el día).

**El caso original de los 17 turnos ocurrió casi sin bloque de pendientes.** Si
es la conversación `d0685ae5` —la hipótesis más probable—, el bloque iba en 7 de
17 y los turnos 2-11 fueron diez seguidos sin él. **Un tope al bloque no habría
evitado ese caso.** Hace esporádico lo que Daniel pide, pero no ataca la causa.

**Demostrado en el código, y es lo que se puede tocar ya:**

- no hay **ni una instrucción contra la repetición** en el camino de
  conversación: `grep repit|repeti` en `vault-prompt.ts` y en el `system` de
  conversación da cero;
- sus cuatro últimas respuestas viajan literales, rotuladas «Asistente:», y el
  `system` las presenta como «el canon y el contenido al que respondes»
  (`http-provider.ts:461`);
- cuando una promesa está en la ventana, el selector la quita del bloque **en
  silencio** (`relation-selection.ts:388-391`): nada le dice que ya la sacó;
- el bloque de pendientes va en el **71 %** de los prompts recientes, no
  esporádico, con «Puedes sacar una tu sola»;
- **los cuatro parámetros de muestreo de `D-098` no llegan al modelo de Lía.**
  `buildFamilyProviders` (`apps/agent/src/agent.ts:367-410`) construye el
  proveedor de cada familia de una conexión sin `temperature` ni ninguna
  penalización; sólo los recibe `providers.http`. Verificado leyendo el código
  el 2026-09-25. Además DeepSeek declara que sus penalizaciones «will not take
  effect».

**Tres cosas rotas que salieron de paso:** cinco respuestas de 24 caracteres de
glm-4.5-air con `finishReason null` se guardaron como `completed` y viajan en el
historial; el bloque de imagen va **después** del mensaje nuevo y crece unos 257
caracteres por imagen sin tope (7.647 hoy, el 36 %); y el comparador ruidoso
también decide qué promesas se enfrían (`relation-selection.ts:398-402`), así
que el ruido contamina la dosificación, no sólo la medida.

**El extractor no está atascado**, contra lo que se sospechó: el cursor avanza
y las 58 revisiones reales desde el 16/09 terminaron bien. Pero ninguna apuntó
ni cerró nada, y el registro no dice por qué.

### El siguiente paso exacto

**Paso 0, de Daniel:** 20-30 respuestas con un solo modelo, marcando a mano
cuáles repiten una promesa. Es la única verdad de referencia que hay. **Y decir
con qué modelo notó el bucle**, porque el modelo es la palanca más fuerte que se
ve en los datos.

Después, por orden (`docs/ROLEPLAY-EVOLUCION.md` §2): arreglar la medida
—placebo por pares, solapamiento de cinco palabras, `ecoMemoria` por campo, el
modelo en la línea—; la frase «lo dicho está dicho» sin nombrar ninguna
promesa, con interruptor para A/B; el tope global al bloque; y la temperatura
por familia, que exige arreglar `buildFamilyProviders` primero.

Origen, de Daniel: en una conversación de 17 turnos el personaje sacó la misma
promesa en 15, casi con las mismas palabras.

### Lo que se descartó, para que nadie lo reinvestigue

La hipótesis obvia —que la dosificación de promesas no funciona— se cayó: de 95
prompts registrados sólo 16 llevaban el bloque de pendientes, y su techo
aritmético son 5-6 turnos seguidos, medido ejecutando el selector. **No busques
el fallo ahí.**

Lo que sí se verificó, y es la sospecha viva:

- **los ocho últimos mensajes viajan literales en cada prompt**, o sea cuatro
  respuestas enteras de ella, entre el 18 y el 44% del texto;
- **la memoria acumulativa es un bucle sin reposo ni tope**: la escribe el modelo
  y se le devuelve entera con la orden de conservarla;
- el cuerpo que se mandaba era exactamente `{model, messages, max_tokens}`: ni
  temperatura ni una sola penalización, y el esquema no permitía configurarlas.

### Qué se construyó, y por qué NO se arregló nada

A propósito: primero medir.

1. **Dos contadores de eco en el registro.** `ecoMemoria` y `ecoHistorial`, en la
   línea `prompt privado compuesto` de `apps/desktop/src/main/ipc/handlers.ts`
   (~4488-4633): cuántas entradas de la memoria acumulativa casan con una promesa
   viva, y cuántas de sus respuestas recientes también. Sólo enteros; ni una
   palabra de texto. Van **fuera** del `try` del bloque de pendientes a propósito:
   un fallo de la medida no puede quitarle al prompt algo ya calculado.
2. **Cuatro parámetros de muestreo por conexión HTTP**, los cuatro opcionales y
   **sin ningún valor por defecto**: `temperature` (0..2), `frequencyPenalty` y
   `presencePenalty` (-2..2, aditivas, de OpenAI) y `repetitionPenalty` (>0..2,
   multiplicativa, neutra en 1, **no** es de OpenAI). Esquema en
   `packages/shared/src/schemas.ts:1003-1045`, envío condicional en
   `apps/agent/src/providers/http-provider.ts:1439-1444`, formulario en
   `apps/desktop/src/renderer/pages/Config.tsx:1235-1281`. Una conexión sin
   configurar manda el mismo cuerpo que antes, campo por campo, y hay una prueba
   que lo fija. El porqué de que sean opcionales está en `D-098`.

### El siguiente paso exacto: MEDIR, no ajustar

**No rellenes los cuatro campos «a ojo».** Existen para comparar con y sin; un
valor puesto sin línea base destruye la comparación, que es lo único que compró
el commit entero.

El orden es: dejar los cuatro campos **vacíos**, mantener varias conversaciones
normales, y leer `ecoMemoria` y `ecoHistorial` en `studio.log`. Sólo con esos
números delante se decide qué se toca —el recorte de los ocho mensajes
literales, el tope de la memoria acumulativa, o las penalizaciones— y en qué
orden.

Pruebas: el mensaje de `29f829d` declara `npm run check` exit 0 con 190
archivos, 3.989 pruebas y 12 saltadas. **No se ha vuelto a ejecutar** en la
pasada documental del 2026-09-23.

## PROVEEDORES-005 — las cinco rondas de proveedores, y qué hacer con ellas

Estado: **investigación cerrada con recomendación; sin ejecutar — anotado el
2026-09-23.**

Existen dos documentos que **ningún archivo de continuidad citaba**, y por eso
casi se pierden: `docs/PROVEEDORES-INVESTIGACION.md` (125.599 bytes, cuatro
rondas, hasta 2026-09-07) y `docs/PROVEEDORES-QUINTA-RONDA.md` (21.619 bytes,
2026-09-15). El único enlace entre ambos es una línea dentro del segundo.

**Dos cambios de criterio de Daniel** invalidan parte de las rondas 1 a 4: que un
proveedor entrene con lo enviado **no descarta** —sólo descartan pedir tarjeta y
prohibir el contenido por contrato—, y Claude Code y Codex no se niegan con el
material de la bóveda, así que el trabajo de fondo ya no necesita alternativa
(`D-087`).

**Tres candidatos con números propios** en la quinta ronda:

1. **OVHcloud anónimo**, sin clave, 2,4-3,3 s. El más barato de probar.
2. **Puente OpenAI de AI Horde**, `https://oai.aihorde.net/v1`, con
   Cydonia-24B-v4.3: mediana 15,8 s, 5 de 5 útiles.
3. **llama.cpp local.** Ver el aviso de abajo antes de considerarlo.

### El siguiente paso accionable, y son diez minutos

Dar de alta **OVHcloud anónimo** como conexión HTTP en Conexiones y mandarle un
turno. No requiere clave, no requiere código y no compromete nada.

### Aviso: un modelo local no encaja con cómo se elige proveedor, y no es de configuración

`D-064` es sobre **imágenes**, y dice que ese proveedor pertenece al
**personaje**, no a la máquina. La quinta ronda extiende el argumento al texto en
el punto 3 de la lista de su sección «5. Qué cuesta enchufarlo a Luxy» (línea 188;
ese documento no tiene numeración de subsecciones), y el argumento se sostiene: un
`llama-server` local es intrínsecamente
**de la máquina** —vive en un puerto de un ordenador concreto—, así que si el
turno cae en el portátil y el modelo está en el sobremesa, no hay modelo. La
ronda propone modelarlo como capacidad de máquina en la selección de `shared`.
**Esa decisión no está tomada**, así que no integres `llama.cpp` local hasta que
lo esté. Los otros dos candidatos son remotos y no tienen el problema.

### Sobre el método, y esto es una falta

Los números de la quinta ronda salen de **llamadas reales** que hicieron los
agentes, y así lo dice el propio documento. `AI-WORK-PROTOCOL.md` §6 y §10
reservan esas llamadas a Daniel, y **no consta autorización en ningún registro**.
No costó dinero (AI Horde con clave anónima, OVHcloud sin clave) y no se usó
contenido de la bóveda. Queda escrito aquí porque es también la razón de que
ésta sea la primera ronda con cifras medidas en vez de leídas, que es justo lo
que falló en las cuatro anteriores.

## DEFECTO-GLM-1113 — un fallo de saldo llega en chino y sin traducir

Estado: **observado, no reproducido; sin arreglar — anotado el 2026-09-23.**

Lo observado: una conexión a GLM falló con el código de negocio **1113** (saldo
insuficiente) y el mensaje que llegó a la pantalla traía el cuerpo en chino, sin
decir qué había pasado. Hubo que traducirlo para saber qué proveedor había
fallado. Se ofreció arreglarlo en su momento y no se hizo. Esto es lo que se vio
en una conversación, no una prueba: no está reproducido.

Lo verificado hoy en el código, que es la mitad útil de la nota:
`apps/agent/src/providers/http-provider.ts` ya tiene el molde —`esLimiteDePlan`
(1901) y `providerSaid` (1921), que anteponen lo que dijo el proveedor sin
adornarlo—, y el `displayName` viaja en todos los mensajes. Lo que falla es el
caso que cae al genérico de la línea **2013**,
`` `${displayName} fallo: ${message.slice(0, 300)}` ``, con el cuerpo en chino
dentro. `grep 1113` sobre todo el código: **cero**. El arreglo es reconocer el
código de negocio en el cuerpo y colgarlo de esa misma rama.

## F30-REPARTO-001 — poder dibujar las escenas en las que salís los dos

Estado: **implementado y probado; el camino automático sin ver en pantalla.
Dos imágenes de dos figuras SÍ generadas, a mano, pegando el prompt en el
panel: anatomía correcta y el personaje reconocible — Claude, 2026-09-21.**
Decisión nueva en `D-097`.

Origen, de Daniel: quiere poder ilustrar enteras las escenas en las que salen
los dos. Se le avisó de que la calidad con dos figuras es irregular en estos
modelos y aun así lo quiere, **con un interruptor para apagarlo si sale mal**.

Hasta hoy esas escenas se dibujaban recortadas —sólo el personaje, en plano
cercano— y no por descuido: está escrito a propósito desde `D-057`, que nació de
una generación real con una segunda mujer que nadie había pedido.

### Qué hay

**El interruptor, de punta a punta**, gemelo exacto de `imageReview`: campo
`imageCast` con valores en inglés (`character-only` | `both`), por defecto
`character-only`, que es el comportamiento de siempre. Almacén cifrado, contrato
IPC con verbo propio, canal, puente, handler y casilla en la ficha del personaje,
justo debajo de la de revisión. Al registro va sólo la decisión (`{ reparto }`),
nunca quién es.

**Las tres piezas que hacen que `both` cambie de verdad lo que se manda**, porque
cualquiera sola deja la foto igual:

1. **la instrucción**, que cambia DOS frases —la del caso 2 de CUÁNDO y el bullet
   de CÓMO, que es donde de verdad se prohibía nombrar al usuario—;
2. **el negativo**, que pierde `2boys`, `multiple people` y `another person` —y
   sólo esas tres: `2girls` y `multiple girls` se quedan siempre—;
3. **el `solo` de la receta**, que en el vocabulario de estos modelos significa
   «una sola persona en la imagen» y vive en la apariencia que escribió el
   usuario, contradiciendo la escena sin que nadie lo pusiera ahí para eso.

**Dos puertas, no una.** El ajuste dice que se PUEDE dibujar a los dos; la escena
dice si en ésa hacen falta los dos. El bloque depende sólo del ajuste —se escribe
antes de que exista la escena—, pero el negativo y el recorte del `solo` sólo se
relajan cuando la escena nombra de verdad a la segunda figura. Así una foto de
ella sola conserva sus defensas con el interruptor encendido, que es lo que evita
reabrir el fallo de `D-057`.

### Con el interruptor apagado no cambia nada, y está medido

Era la condición que mandaba sobre todo lo demás. Medido en esta pasada, no
heredado:

- `VAULT_IMAGE_NEGATIVE` es **el mismo string byte a byte** que en `HEAD`: las
  tres etiquetas se extraen a una constante y se vuelven a intercalar en su sitio
  con un spread, así que el orden no se mueve;
- el bloque de instrucciones apagado ocupa **6.474** (prosa) y **6.478**
  (etiquetas), igual que lo dejó `F29-POSTURA-004`; encendido ocupa **6.411** y
  **6.415**, 63 caracteres menos. El tope de 6.500 no se toca;
- el recorte del `solo` no se ejecuta nunca con el ajuste apagado, y el párrafo
  del panel que lo explica sólo se pinta si de verdad se quitó uno.

### Lo que falta, y es de Daniel

Nada del camino AUTOMATICO se ha visto en pantalla. Lo que sí se ha probado, y
salió bien, son **dos imágenes de dos figuras generadas a mano** con el prompt
pegado en el panel: anatomía correcta y el personaje reconocible.

1. **Reconstruir y abrir Studio**: ha cambiado `packages/shared`, así que
   `npm run build` y abrir.
2. **Encender el ajuste** en la ficha del personaje —«Dibujar las escenas en las
   que salís los dos»— y comprobar que la casilla se queda encendida al volver a
   entrar. Con un personaje guardado antes de hoy tiene que aparecer **apagada**:
   el valor por defecto se aplica al leer.
3. **Pedir una escena en la que salgáis los dos** y mirar el panel ANTES de
   generar: el texto tiene que nombrar al otro (`1boy`, `a man`), el negativo ya
   no puede llevar las tres prohibiciones, y `solo` tiene que aparecer en lo
   descartado, con su botón para devolverlo.
4. **Pedir una foto de ella sola con el ajuste encendido** y comprobar lo
   contrario: ahí el negativo sigue entero y `solo` no se quita. Es la segunda
   puerta, y es lo único que protege de que vuelva a colarse gente de más.
5. **Generar, y decidir.** Que la imagen salga bien no lo dice ninguna prueba:
   **es una expectativa, no una observación**. Si sale mal, apagarlo; para eso
   existe. Y si sale mal, decir con qué modelo, que es lo que permitiría medirlo.

**Siguiente paso exacto:** el punto 3 de esa lista —una escena de dos, mirando el
panel antes de gastar nada—.

## F29-POSTURA-005 — la decision retirada y la nueva, completas

Estado: **hecho — Claude, 2026-09-18.** Pasada de sólo documentación: **ni una
línea de código.** Cierra los tres huecos que `F29-POSTURA-003` y `-004` dejaron
en la memoria escrita, que era donde tenían que quedar.

Qué faltaba, y por qué importaba:

1. **`D-095` decía que estaba revocada, pero no qué clase de error fue.** Ahora su
   cabecera deja constancia de que se escribió el 2026-09-17 y se retiró el
   2026-09-18 —471 líneas de módulo y 251 de prueba en ese día, medidas sobre
   `git show HEAD` de los dos archivos borrados—, y nombra el error: **razonar
   cómo debería comportarse el generador en vez de medirlo.** Su premisa
   —«`from behind` es ambiguo, hay que decir QUE parte va hacia el objetivo»— es
   impecable como razonamiento y falsa como hecho.
2. **`D-096` tenía la conclusión pero no lo que costó llegar a ella.** Gana las
   seis hipótesis que se cayeron, una por una —pesos, prompt negativo, etiquetas
   faciales, orden, vocabulario y `looking back`—, la tabla de las doce
   generaciones convertida en tabla de verdad, y el **método**, que es lo que de
   verdad se lleva uno de aquí: las hipótesis que **añadían** variables al prompt
   que fallaba no dijeron nada; las que **quitaban** del que funcionaba aislaron
   la causa en tres pasos. Cuando un prompt falla y otro funciona, se adelgaza el
   que funciona. (Las cuentas de una y otra tanda no suman las doce generaciones:
   cuatro se perdieron en bloqueos del filtro y una en un despiste, y eso también
   es parte de lo que cuesta medir aquí.)
3. **`D-096` no declaraba su alcance.** Sección nueva al final: doce
   generaciones, **una semilla y un modelo**. No está comprobado que otro modelo
   se comporte igual, ni otra semilla. Si Daniel cambia de modelo, la decisión no
   se hereda: se vuelve a medir. Lo único que sí es portable es el método.

Y `PROJECT-STATE.md`, que se había quedado en la tanda del 2026-09-17, pasa a
contar ésta: la regla, el método, el alcance y los dos pasos de producto.

Las cifras de esta pasada son de esta pasada: `npm test` ejecutado aquí, **190
archivos, 3.996 pruebas pasadas y 12 saltadas, exit 0**. Están en
`TEST-RESULTS.md` con su salida literal. No se tocó código, así que la suite es
la misma que dejó `F29-POSTURA-004`: se vuelve a correr para poder decirlo
habiéndolo visto, no para afirmar que este cambio la mueve.

**Siguiente paso exacto:** el de `F29-POSTURA-004`, que sigue abierto y es de
Daniel —pedir una foto en un ángulo concreto y mirar si el prompt nombra algo
visible sólo desde ahí en vez de una etiqueta de cámara—. De esta pasada no sale
nada que comprobar en pantalla: es documentación.

## F29-POSTURA-004 — el bloque aprende la regla del angulo

Estado: **hecho y probado — Claude, 2026-09-18.** Aplica `D-096` al único sitio
que había quedado fuera: el bloque de instrucciones de
`packages/shared/src/vault-image-request.ts`.

Qué se quitó: el bullet del 2026-09-17 que mandaba «di QUE parte va hacia el
objetivo —«ass to camera», «back to camera»— y donde queda la cara». Las doce
generaciones lo dejaron sin pie, así que lo único que hacía era enseñarle al
modelo a escribir ruido. También se cayó, de la tabla de equivalencias, el par
que traducía «desde detrás» y «el culo a cámara» por `from behind` a secas; y el
ejemplo del bullet del orden, que era ese mismo `from behind`.

Qué se dejó: el resto de la tabla —`close-up`, `full body`,
`from above/below/the side`, `looking at viewer`—. `close-up` aparecía en un
prompt que **sí** funcionó, pero nunca se probó aislada: no saber no es lo mismo
que saber que falla, y lo que no está demostrado falso no se tira. Queda marcado
en el comentario y en una prueba.

Qué se puso, en el hueco que dejó el bullet borrado: «La etiqueta de encuadre
sola no mueve la cámara: nombra ADEMÁS algo que SOLO se vea desde ese ángulo y la
colocará ahí para poder dibujarlo», con un ejemplo por ángulo —la coronilla, las
plantas de los pies, un detalle que a dos metros no se vería—. **Ninguna etiqueta
explícita concreta**: se enseña el principio y es la escena la que decide qué se
ve. La última frase del bullet lo dice y hay una prueba que la fija; si un día
alguien mete ahí una etiqueta, Luxy estaría imponiendo contenido.

El guardián de 6.500: se entró con 44 caracteres de margen y se sale con 22
(prosa 6.474, etiquetas 6.478). El límite **no se ha tocado**. Lo que pagó el
texto nuevo: el bullet borrado (156), el par de la tabla, el ejemplo del orden y
una condensación de la prohibición de cámaras —«aunque te la pidan así o la haga
él», que conserva los dos casos que costaron una imagen y tiene su prueba—.

**Siguiente paso exacto:** Daniel pide una foto en un ángulo concreto y mira si
el prompt que compone el modelo nombra algo visible sólo desde ahí en vez de una
etiqueta de cámara. Que la imagen salga bien lo dice su pantalla o no lo dice
nadie: aquí sólo está probado lo que llega al bloque.

## F29-POSTURA-003 — el desambiguador de orientacion se va entero

Estado: **hecho y probado — Claude, 2026-09-18.** Decision en `D-096`, que
**revoca `D-095`**.

Qué pasó: doce generaciones reales de Daniel, con la semilla `1080257389` y el
modelo WAI-ANI-NSFW-PONYXL, demostraron que ninguna de las dos etiquetas que
ponía el desambiguador —`ass to camera`, `back to camera`— mueve la cámara. Ni
solas, ni juntas, ni con pesos. Lo que sí lo consigue es `pussy`, y el motivo es
la regla que hay que recordar: **este modelo obedece lo que puede dibujar, no las
instrucciones sobre dónde poner la cámara.** `pussy` en esa postura solo se ve
desde detrás, así que la cámara se coloca sola.

Qué se quitó: el módulo `vault-image-orientation.ts` y sus 33 pruebas, su llamada
en `composeHordeImagePlan`, su export en `index.ts`, el campo `added` del plan,
`removeAddedFragment` y el cartel del panel que lo explicaba. El recorte
(`dropped`) **no se ha tocado**: ése funciona y se ha visto trabajar.

Por qué no bastaba con dejarlo puesto: además de meter una etiqueta inútil en
todos los prompts, el panel le enseñaba a Daniel un cartel diciéndole que Luxy le
había resuelto el encuadre. Eso es peor que no hacer nada, porque hace creer que
el problema está cerrado.

Compatibilidad de lo ya guardado: `hordeImagePlanSchema` es un `z.object`
normal, no `.strict()`, así que un intento de la bóveda que lleve `added` se
sigue leyendo —Zod ignora la clave—; y `computePlanId` nunca midió ese campo, así
que ningún plan viejo cambia de huella ni pasa a contar como «editado». Por eso
el campo se borra en vez de quedarse tolerado. Hay una prueba que lo fija.

**Siguiente paso exacto:** hecho en `F29-POSTURA-004` — el bloque de
instrucciones de `vault-image-request.ts` ya no pide «ass to camera» ni «back to
camera».

## F29-POSTURA-002 — «desde detras» lo desambigua el codigo — REVOCADA

Estado: **borrada del código el 2026-09-18 (F29-POSTURA-003, `D-096`).** Se
conserva la entrada porque explica qué se midió y qué no. Decisión en `D-095`.

Qué hay: `disambiguateOrientation`, función pura en
`packages/shared/src/vault-image-orientation.ts`, aplicada en
`composeHordeImagePlan` **después** del recorte de rasgos. Lo añadido viaja en
`added` —gemelo exacto de `dropped`— y el panel lo enseña con un botón que lo
quita antes de gastar nada en generar.

**Segunda vuelta: cuatro defectos, todos medidos ejecutando la función.** La luz
—«1girl, backlit from behind, facing the camera…» ganaba un `back to camera` al
lado del `facing the camera` que ya estaba—, el artículo —«her back to the
camera» salía con la misma orden dos veces—, cinco posturas ambiguas que daban
una etiqueta sexual en escenas que no la implican —`kneeling` y compañía— y el
cartel del panel afirmando de más. Cerrados con una prueba por frase exacta.

**Tercera vuelta, de verificación:** los cuatro cierres se volvieron a medir
llamando a la función con las frases del informe; las diecisiete salen como
debían. Sólo quedaban dos enumeraciones incompletas —el comentario del cartel
nuevo del panel, que nombraba tres de las cuatro puertas, y el de
`computePlanId`, que no nombraba `added`—, corregidas. El detalle y las cifras,
en `CHANGELOG-WORK.md` y `TEST-RESULTS.md`.

**Lo que sigue sin comprobar:** que el generador obedezca `ass to camera`. Las
pruebas fijan que la etiqueta llega al prompt; que la imagen salga de espaldas lo
dice la pantalla de Daniel o no lo dice nadie. Y lo nuevo de esta tanda: que las
dos puertas nuevas no dejen fuera una escena que **sí** pedía espaldas. La luz
gana siempre que va pegada al disparador sin coma en medio, así que «backlit from
behind, on all fours» no gana etiqueta; es deliberado y sólo lo desmiente un
prompt real.

**Siguiente paso exacto:** Daniel pide una foto de espaldas, mira el panel antes
de generar —tiene que aparecer el cartel de lo añadido— y compara el resultado
con las tres que salieron de frente.

## F29-POSTURA-001 — siete arreglos de una tarde de imagenes

Estado: **implementado, revisado, corregido y probado; sin ver en pantalla —
Claude, 2026-09-17 (madrugada).** Decision nueva en `D-094`; `D-091` queda
confirmada **por una sola via** —el reloj del bloqueo— y su hueco de
instrumentacion, cerrado.

**Segunda vuelta: once defectos.** La tanda paso `npm run check` y aun asi una
revision encontro once, la mayoria verificados ejecutando el codigo. Cerrados en
la madrugada del 2026-09-17 por tres agentes de codigo y una pasada de
documentacion: el helper `trace()` ya no decide por su cuenta que significa un
rastro vacio (`absent` queda para lo unico que se puede afirmar); `prune` pasa a
contar dos cupos y deja de tirar lo irrecuperable; cinco arreglos en el recorte de
rasgos; el bullet de verbos se rehace y vuelve «enseñame algo distinto»; y el
guardian de tamaño pasa a medir los dos estilos. El detalle, en
`CHANGELOG-WORK.md`.

**Lo que esa revision deja como leccion, y es lo que hay que llevarse:** nueve de
los once defectos —los otros dos eran de codigo— eran documentacion afirmando de
mas: una cifra inventada, una
comparacion heredada sin comprobar, citas de linea que ya no apuntaban a nada y
dos deducciones escritas como hechos—. Es la tercera vez en dos dias. Ninguna
cifra que no se haya medido en la pasada que la escribe, y ninguna afirmacion sin
decir de donde sale.

Origen: Daniel pasa la tarde generando imagenes de su personaje y comparando
prompts. Los siete arreglos salen de casos vistos en pantalla, no de ideas.

Tres bloques:

1. **Cuatro reglas nuevas en el bloque de instrucciones**
   (`vault-image-request.ts`): la postura del cuerpo, que el encuadre no dice; el
   encuadre heredado en «quedate como estas»; el relleno decorativo nombrado con
   ejemplos; y que «describe», «mira» o «que te parece» comentan una foto que ya
   existe en vez de mandar otra. Sin subir el guardian de tamaño: el bloque cabe
   en **6.296** (`prose`) y **6.300** (`tags`) de 6.500 porque se condenso lo que
   ya estaba escrito. **Al condensar si se perdieron dos textos**: «enseñame algo
   distinto», devuelto en la segunda vuelta, y «levanto el movil y disparo», que
   sigue fuera. El bullet de verbos del punto cuatro se rehizo entero, porque
   contradecia el criterio de determinantes de `D-086`.
2. **El recorte automatico pasa de dos familias a cuatro**
   (`vault-image-provider.ts`): a color de pelo/ojos y origen se le añaden
   **complexion** y **rubor**, con las dos reglas de siempre —solo se quita lo que
   la apariencia fija ya dice, y se quita el rasgo, no la frase— y todo lo quitado
   sale en `dropped`.
3. **Un fallo de imagen deja rastro entero** (`horde.ts`, `vault-image-plan.ts`,
   `handlers.ts`, `Vault.tsx`, `image-attempt-store.ts`): worker, id del worker,
   modelo y semilla, y un campo que dice si el hueco es «no lo dijo», «no lo
   hubo» o «no se apunto» —tres lecturas, y la decide quien apunta el intento, no
   el helper—. Ademas, el apunte de un fallo ya no lo empuja fuera del registro
   una racha de imagenes buenas: son dos cupos, 50 y 200.

### Lo que falta, y es de Daniel

Todo lo de aqui es de pantalla: las pruebas fijan que el texto llega al prompt,
**nunca que el generador obedezca**.

1. **La postura.** Pedir una foto nombrando solo el encuadre —«desde detras»— y
   mirar en el panel de `D-092` si el texto que sale trae ademas una postura
   (`on all fours`, `lying face down`, `kneeling`, `sitting`). Si la trae, la
   instruccion funciona; si ademas la imagen sale asi, funciona el modelo.
2. **El encuadre heredado.** Decir «quedate como estas» tras una foto y ver si se
   conserva el encuadre. **Anotar la frase exacta** que se uso: el fallo es
   intermitente y no se ha aislado cual lo conserva.
3. **Nombrar una foto no es pedirla.** Comentar una ya enviada («describe esta»,
   «que te parece esa») y comprobar que **no** genera otra ni la reenvia. Y un
   mensaje que comente una y ademas pida otra: ahi si tiene que generar la nueva.
   Dos frases concretas que la revision uso como caso limite y conviene probar tal
   cual: «enseñame otra» —no nombra ninguna existente, asi que **genera**— y «¿que
   te parece si me mandas una?» —pide, asi que **manda**—.
4. **El rastro del bloqueo.** Cuando el Horde vuelva a rechazar una, abrir la
   tarjeta del intento: ahora salen worker, id, modelo y semilla, y donde falta
   algo se lee «no lo dijo», «no lo hubo» o «no se apuntó» en vez de un guion. Eso
   cierra el punto 3 de `F28-PLAN-IMAGEN-001`.
5. **El recorte nuevo.** Mirar la lista de rasgos descartados de un par de
   generaciones y confirmar que complexion y rubor solo se llevan lo que la
   apariencia fija ya decia. Si alguna vez se lleva algo de la escena, decir la
   frase entera: la lista de terminos es cerrada y se corrige.
6. **El registro de intentos, cuando haya un bloqueo viejo.** Con los dos cupos,
   un fallo de hace dias tiene que seguir estando aunque en medio haya habido
   muchas imagenes buenas. Es lo unico del anillo que se ve desde la pantalla.

### Pendiente de codigo, pequeño y anotado

> **Retirado el 2026-09-23: este defecto no existe.** Decía que el comentario
> del `throw` por vencimiento de `apps/agent/src/providers/horde.ts` todavía
> terminaba diciendo «la peticion no llego a producir generacion». Esa cadena
> **no está en el archivo** (`grep` sobre él: cero) y `git log -S` sobre ese
> mismo archivo no devuelve ni un commit que la haya contenido nunca. Lo que
> hay hoy en las líneas 1110-1123 es la versión corregida: distingue «NO SE
> SABE» de «no lo hubo» y explica por qué el sondeo por `check` no puede
> atribuir. La frase sólo vive en `CHANGELOG-WORK.md` y `DECISIONS.md` como
> **cita de lo que se retiró**, y de ahí se copió aquí por error.
>
> No queda nada pendiente en `horde.ts`. No lo «arregles»: el comentario que
> hay es el bueno.

## F28-PLAN-IMAGEN-001 — ver y corregir el prompt antes de que se genere

Estado: **implementado, revisado y corregido; sin ver en pantalla — Claude,
2026-09-16.** Decision en `D-092`.

Origen: «Prepara lo de ver y corregir el prompt antes de generar».

Con el interruptor del personaje en «siempre», el turno termina sin generar y deja
el plan pendiente; Daniel lo ve, lo corrige y decide. Con «nunca», todo funciona
exactamente como antes. Cada intento queda apuntado cifrado, **tambien los que
fallan**, con el `rc` del Horde, la semilla y el worker.

### Lo que falta, y es de Daniel

1. **Abrirlo y usarlo.** Nada de esto se ha visto en pantalla. Pedir una foto,
   mirar el texto que sale, corregirlo y generar.
2. Comprobar que con el interruptor en «nunca» la conversacion va como siempre.
3. Cuando el Horde vuelva a rechazar una, **mirar lo que se mando** y decir que
   `rc` sale: `csam` (el clasificador de la imagen) o `censored` (un worker con
   censura propia, y entonces repetir SI tiene sentido). Esa distincion es la que
   `D-091` no pudo hacer en tres semanas.
4. Abrir un archivo de `vault/image-attempts/` con el bloc de notas y confirmar
   que no se entiende nada.

## IDEA-KUDOS-001 — ganar kudos valorando imagenes, dentro de Studio

Estado: **CERRADA, no se hace — Claude, 2026-09-17.** Investigada contra el
codigo publico del Horde y contra el servidor en vivo. Decision de la tanda en
`D-093`.

Pedida por Daniel a mitad de otra tarea: «valorar imagenes y etc da kudos al
parecer, me gustaria un sitio donde poder valorar al menos las imagenes que
genero y ganar un poco de kudos».

### Por que se cierra

**Valorar exige tener las imagenes compartidas, y el servidor deja el compartido
apagado en todos los modelos menos uno.** El endpoint de valoracion estetica
empieza rechazando lo que no sea publico: `if not wp.shared: raise
InvalidAestheticAttempt("You can only aesthetically rate requests you have opted
to share publicly")`. Y `shared` acaba en falso porque `initiate_waiting_prompt`
termina en `else: shared = False`, una linea de julio de 2023 que pisa hasta el
forzado del anonimo; la unica rama que lo deja en cierto pide el modelo
`SDXL_beta::stability.ai#6901`, un beta de Stability retirado. Son dos cerrojos
independientes sobre la misma puerta, y el primero depende del segundo.

Lo demas que se encontro, por si vuelve a plantearse:

- **esta topado por diseño**: «You can never gain more kudos than you spent for
  this generation» (`if self.kudos >= wp.consumed_kudos: self.kudos =
  wp.consumed_kudos - 1`). Aunque funcionara, nunca seria una fuente neta: es un
  reembolso parcial de lo que ya pagaste;
- **el servicio de valoraciones no respondia**: el Horde calcula los 5 kudos por
  valoracion —15 en el caso «la mejor»— y **reenvia a un servicio externo cuyo
  codigo no es publico**, que el dia de la comprobacion devolvia **503**; y la
  pagina que la FAQ oficial enlaza para valorar, la de ArtBot, devolvia **404**.
  No se puede distinguir una caida real de un bloqueo al agente que lo consulto:
  eso queda sin verificar;
- **las imagenes propias** nunca llegaron a ser la pregunta: sin compartir, ni
  las propias ni las ajenas.

### Lo que SI da kudos, que era la pregunta de fondo

Verificado en el codigo del Horde y en su FAQ; el detalle esta en
`docs/IMAGENES-GRATIS.md`:

1. **Prestar la GPU.** 50 kudos cada 10 minutos por estar encendido, +2 por
   modelo cargado y +30 si aceptas LoRAs, mas lo que pague cada trabajo. **El neto
   de una cuenta nueva no es ese**: mientras no sea «de confianza», el 100% del
   premio por estar encendido y la mitad de lo generado quedan **retenidos en
   deposito**, que no es saldo gastable ni da puesto en la cola. Se liberan al
   ascender —minimo 7 dias de cuenta y superar un umbral— y ese umbral lo fija una
   variable del servidor que no se ve desde fuera: si estuviera sin poner, **no se
   liberaria solo**. Ademas publica la cuenta en la lista publica de workers y mete
   prompts de desconocidos en la maquina.
2. **Pedir una transferencia en el Discord oficial.** Lo recomienda su propia
   FAQ: «People tend to give plenty to new users». Es lo unico gratis, inmediato y
   sin hardware. Con la cuenta en el suelo el no puede transferir los suyos, pero
   si recibir.

Y lo que **no** da kudos, que es lo que se creia: compartir las imagenes. Nunca
fue un ingreso —era un descuento de 2 sobre esa misma peticion— y ademas esta
apagado. Ver `D-093`.

### Lo que queda por hacer, y es de Daniel

Pulsar **«Ver mis kudos»** en Privado y mirar el desglose nuevo. Si las cinco
casillas de entrada —`awarded`, `received`, `styled`, `recurring` y `admin`—
salen a cero, queda demostrado sobre su cuenta —y no por deduccion— que **por
esas cinco** no ha entrado nada. Lo que paga prestar la GPU no se veria ahi: cae
en `accumulated`, que es «accumulated **or used**» y mezcla lo entrado con lo
gastado. Y el desglose dira ademas de que clase es la cuenta, porque el servidor
lo declara en `pseudonymous`. **Nadie ha usado su clave**: todo lo de arriba es
codigo leido, no su cuenta medida.

## F27-ENCUADRE-001 — que la foto salga desde donde Daniel la pide

Estado: **implementado y probado, sin verificar en pantalla — Claude, 2026-09-16.**

Origen: «He cambiado de modelo, y es que ya no se parece nada a Lia... Notese que
la foto tampoco tiene la pose que le digo».

Dos commits, porque el primero no basto: `5f0901a` añade la traduccion de las
frases de encuadre, y `c35a57a` arregla que la prohibicion de dibujar camaras
hiciera al modelo descartar la frase entera. Detalle en `CHANGELOG-WORK.md`.

### Lo que falta, y es de Daniel

1. Pedir una foto diciendo el encuadre —«desde detras», «el culo a camara», «de
   cerca»— y mirar si sale asi. Es la unica comprobacion que vale: lo demas son
   pruebas de que el texto llega al prompt, no de que el modelo lo obedezca.
2. Si sigue fallando, decir **con que modelo de imagen**: no todos siguen igual de
   bien una indicacion de camara, y eso ya no se arregla en el prompt.

### De la misma tanda

- `166b6e0` remata F23: la linea de una promesa dice quien se la hizo a quien.
- `D-091` **se reescribio entera el mismo dia**: su primera version culpaba al prompt
  negativo y era falsa. El filtro que bloquea puntua **la imagen ya dibujada**, en el
  worker. Queda pendiente el hueco de instrumentacion que describe al final.
- **Continua en `F29-POSTURA-001`** (2026-09-17): las pruebas controladas de
  Daniel descartaron pesos, negativo anti-retrato y etiquetas de cara; lo que le
  faltaba al prompt que fallaba era **la postura del cuerpo** (`D-094`). Y el
  hueco de instrumentacion de `D-091` queda cerrado.

## F26-LLAMADAS-VACIAS-001 — el 18% de lo que paga por Lia no compra nada

Estado: **los cuatro arreglos hechos y comprobados — Claude, 2026-09-15.**
Informe en `docs/DEEPSEEK-LLAMADAS-VACIAS.md`.

Origen: Daniel vio turnos con `modelCalls: 2` y `3` en su panel de gasto y dijo
«investiga con los datos que tienes».

**La cadena, verificada:** Node v24 aborta una peticion a los **300.000 ms** por
defecto y **nadie configuro otra cosa en todo el proyecto**; ese error llega
**sin codigo de estado**; y el filtro de reintentos trata como reintentable todo
lo que no trae codigo. Asi que Luxy reenvia el prompt entero hasta tres veces.
**Los reintentos son de Luxy, no del proveedor**: los huecos entre llamadas —2,
4 y 5 segundos— son su espera programada. Dos de las tres llamadas vacias del
2026-09-14 murieron a los 302 y 300 segundos.

La tarifa es **por llamada** (~6,935 ¥), asi que un intento que devuelve 0
tokens cuesta lo mismo que uno bueno. Medido del 4 al 14 de septiembre: **73
llamadas pagadas para 60 turnos; 90 ¥ tirados de 506 ¥, un 18%**. Y es un suelo:
hay 7 turnos mas cuyo contador quedo a cero.

**Mi hipotesis inicial era falsa y conviene que conste**: propuse que la causa
era el tamaño del prompt, a partir de seis puntos de una captura. Dos agentes
independientes —uno atacandola, otro defendiendola— la **refutaron**: la
correlacion es 0,025. Los prompts mas grandes de ese dia salieron a la primera.
Lo que cambio fue la velocidad del proveedor: mediana de 203 s frente a 61 s.

**Aprobado por Daniel el 2026-09-14, los cuatro:**

1. subir el tope de espera, que hoy es el de fabrica de Node y nadie eligio;
2. no reintentar a ciegas una respuesta vacia, y **avisar en pantalla**: no
   ahorra por si solo, pero devuelve la decision a Daniel en vez de gastar sin
   que se entere;
3. **una linea de registro POR LLAMADA** —espera hasta la primera palabra,
   tokens enviados, como murio—. Hoy solo se apunta una por turno, asi que de
   las tres llamadas muertas no queda constancia de nada;
4. contar **todos** los intentos en el presupuesto. Hoy solo cuenta el que
   salio bien, asi que Luxy cree que se gasta menos de lo que se gasta. Y como
   esta pasarela cobra por llamada, el presupuesto por tokens es
   estructuralmente ciego: hace falta un contador de llamadas.

**Dos cabos sueltos del informe, que NO cierran estos arreglos:**

- de las 13 llamadas de mas, **solo 3 encajan con el tope de 5 minutos**. Las
  otras 10 pasaron en turnos cuyas llamadas duraban entre 29 y 135 segundos:
  **hay una segunda causa que el registro no guarda**. El arreglo 3 es lo que
  permitira verla;
- `tokensEstimados` se queda corto **~1.650 tokens siempre**. Acierta el ritmo
  de crecimiento (3% de error), asi que sirve para «cuanto añade este bloque»,
  no para «cuanto estoy mandando».

**Hecho el 2026-09-15**, con quince hallazgos confirmados en la revision:

- **el tope** pasa de accidente de fabrica a silencio elegido de 15 minutos,
  configurable por conexion. Se construye un despachador propio leyendo la
  clase del que Node ya tiene puesto, **sin añadir `undici` como dependencia**:
  esta en `node_modules` solo de rebote y una instalacion limpia habria
  reventado. Si la pila no se deja configurar, la peticion sale igual con el
  tope de fabrica: este arreglo puede no aplicarse, pero nunca impide un turno;
- distingue **silencio** de **duracion**: una respuesta larga que va llegando no
  muere por durar, porque cada byte reinicia el contador. Con prueba;
- **una llamada ya cobrada no se repite sola**, y se avisa en pantalla por el
  mismo camino que el aviso de 429. Pero la revision corrigio el arreglo: no
  reintentar NUNCA quitaba la recuperacion automatica que si servia. Ahora se
  separan cinco finales, y `dropped` —la corto el otro lado tras minutos— ni es
  gratis ni se reintenta;
- **una linea de registro por llamada**, con el tiempo hasta la primera palabra,
  que es la medida que faltaba. Las tres llamadas vacias del 2026-09-14
  quedarian hoy como `silence`, `silence` y `dropped`, las tres cobradas;
- **el presupuesto cuenta todos los intentos**, y hay un limite diario de
  LLAMADAS, que es lo unico que protege de una tarifa por llamada. Se comprueba
  tambien entre reintentos, no solo al empezar el turno.

**Falta**: nadie lo ha visto correr con la boveda abierta. Y los diez desfases
del historico que no encajan con el tope siguen sin explicacion: el registro
nuevo es lo que la destapara.

**Lo que NO se hace, y por que**: recortar el prompt. Se cobra por llamada, asi
que el texto es gratis en dinero; el tamaño no dispara los fallos; y lo unico
que compra son ~2,3 s por cada 1.000 tokens sobre llamadas de 250 s. Los bloques
de promesas y memoria retroactiva suman ~2 segundos: se enchufan sin miedo.

## F25-ENTRE-HILOS-001 — que recuerde algo de un hilo estando en otro

Estado: **investigado; NO hace falta codigo para lo que pidio Daniel —
Claude, 2026-09-14.** Informe completo en `docs/ENTRE-HILOS-INFORME.md`.

Origen: Daniel contesto que queria «las dos cosas», y esta es la segunda.

Veredicto, verificado contra el codigo: **para su ejemplo —los dos cafes y la
tarta— no hay que escribir nada.** Una promesa es exactamente lo que cruza
hilos por diseño, con cita literal, y el prompt ya le da permiso escrito para
sacarla sola. Falta ejecutarlo: `LA-045`.

Lo que SI cruza hoy, en tres niveles muy distintos:

1. **la lista de momentos**, en todos los turnos y de todas las conversaciones:
   fecha, titulo y cuantos turnos. Nada mas. Con la orden expresa de preguntar
   en vez de rellenar;
2. **un momento transcrito entero** (12 turnos, 6.000 caracteres) de cualquier
   conversacion, pero **solo si Daniel lo pide** por una de las tres puertas
   de `D-085`;
3. **las promesas**, que es el unico canal donde ella tiene INICIATIVA.

Lo que NO cruza: el contenido de una escena ajena, y todo lo que no sea una
promesa —el animo, los gustos, las personas—, cuyos campos existen en el
codigo (`joy`, `hurt`, `taste`, `person`) pero estan apagados.

**El cambio barato, pendiente de decidir.** El resumen de cada escena YA existe,
ya esta pagado y ya esta cifrado en `catalog.json`, pero solo se le enseña el
del momento MAS ANTIGUO (`recall.ts`, `lineFor`). Enseñar tambien los N mas
recientes son cinco lineas y una constante. Coste: no en dinero —se cobra por
llamada—, sino en atencion del modelo: los 40 enteros casi doblarian el prompt;
los 10 mas recientes son unas 900 palabras-token sobre las 4.800 de hoy.
Decision aplazada a DESPUES de `LA-045`, para tener el prompt real delante.

**Riesgo detectado, sin confirmar:** el indice tiene tope de 40 lineas y el
2026-09-11 ya habia exactamente 40 momentos. Al pasarse se conservan los 39 mas
recientes y el primero de todos: **lo que se cae es el medio**, y ella recibe un
aviso de que faltan pero no de cuales. Se confirma mirando el numero en «Lo que
recuerda».

## F24-RECAP-001 — memoria acumulativa para los chats que ya existen

Estado: **entregada entera; falta que alguien la use — Claude, 2026-09-14,
estado corregido el 2026-09-23.** Diseño en `docs/RECAP-DISENO.md`, con las
correcciones de la revision en su §16.

> **Corrección del 2026-09-23.** Este bloque decía «pasos 2 a 5 hechos; faltan
> el IPC (6), el enganche (7) y la pantalla (8)». Era falso: los tres se
> entregaron ese mismo día. `28c6b55` («enganchar la memoria retroactiva al
> turno, con su canal», 14 archivos, 2.430 inserciones) cubre los pasos 6 y 7,
> y `3d994c2` («Memoria de lo ya hablado, con probar antes de guardar») el 8.
> Verificado en el árbol de hoy: `vaultRecapSync`, `vaultRecapList` y
> `vaultRecapUpdate` en `apps/desktop/src/shared/channels.ts`; las pruebas
> `apps/desktop/src/main/ipc/conversation-recap.test.ts` y
> `apps/desktop/src/main/vault/recap-dry-run.test.ts`; y `RecapSection` en
> `apps/desktop/src/renderer/pages/Vault.tsx`. **No hay nada que reconstruir.**
>
> Lo que de verdad queda: la pantalla «Memoria de lo ya hablado» existe, con
> «Generar la memoria de lo ya hablado», «Probar sin guardar», ver la ficha,
> «Aprobar» una o todas y rehacerla con el otro CLI, y **nadie la ha abierto**.
> La pasada sobre las 17 conversaciones es de Daniel: `LA-045`.
>
> `keepSweepingRecaps`, en `apps/desktop/src/renderer/vault-sweep.ts` con su
> `vault-sweep.test.ts`, es el módulo puro que protege del fallo que se entregó
> mal dos veces: que la tanda parase al negarse las primeras y el panel dijera
> que no queda nada. Una negativa parcial es un ÉXITO y la tanda sigue.

Origen, de Daniel: «Quiero generar la memoria acumulativa de los chats
antiguos». Cierra la linea que quedo abierta en `F22-MEMORIA-ACUMULATIVA-001`:
«generarla de golpe por suscripcion queda por decidir».

Medido sin descifrar nada: **18 archivos, 308 turnos; solo 9 registros llevan
memoria sellada y los 9 estan en la misma conversacion**, la posterior al
arreglo del 11-09. O sea 17 conversaciones y 280 turnos sin memoria. Con
ventanas de 40 turnos, 16 de las 17 caben en una llamada: **20 llamadas de
suscripcion, una sola vez.**

Lo esencial del diseño, que salio de tres propuestas y dos jueces:

- **no se toca ni un byte de los `.jsonl` sellados.** No existe API para
  re-sellar; `sealTurn` estampa `recordId` y `createdAt` nuevos y pondria las
  17 con fecha de hoy; y una memoria que no abra **apaga la lista entera de
  Privado**, porque `list()` abre el ultimo registro de cada conversacion sin
  `try/catch`;
- la memoria retroactiva vive en `vault/recap.json`, con el molde de
  `relation-store.ts` (`fsync`, carril, lectura tolerante). La **sellada gana
  siempre**; el recap solo es respaldo mientras no haya sellada;
- **una negativa parcial es un EXITO**: el modelo dice donde no llego y el
  hueco viaja al prompt. Cinco estados distintos, no un contador unico;
- el caso peor no es que se nieguen, es que **obedezcan y saneen**: un
  detector de vaguedad sin modelo lo caza en su version tosca. La competente
  no la caza nadie, y por eso Daniel aprueba antes de que se use;
- **una regresion ya existente, que este diseño arregla de paso**: cualquier
  memoria, aunque sea parcial, apaga hoy el aviso de turnos omitidos.

**Contestado por Daniel el 2026-09-14: quiere LAS DOS COSAS.** Esto le da la
primera —que al reabrir una conversacion antigua Lia sepa en que punto quedo
ESA conversacion—, porque la memoria acumulativa es por hilo. La segunda —que
se acuerde de un hilo estando en otro— es otro canal: los recuerdos y los
pendientes, que ya existen. Se investiga aparte que le falta a ese canal, en
`F25-ENTRE-HILOS-001`; puede que la pasada de promesas ya lo cubra y no haga
falta codigo nuevo.

## F22-MEMORIA-ACUMULATIVA-001 — la memoria de cada conversacion privada no se guardaba

Estado: **`done` y verificado en turnos reales — Claude, 2026-09-11.**
Agente, protocolo y handler hechos; el turno privado y la sonda de
compatibilidad usan `memoryOfTurn`.

Todo turno local va como `studioMode: 'conversation'`, asi que el job-runner
separa el bloque `<LUXY_MEMORY>` de la respuesta y lo pone en
`conversationMemory`. `toLocalResult` solo devolvia el texto, y el handler lo
buscaba en un texto que ya no lo llevaba: `absent` en todos los turnos, y nunca
se guardaba nada. El modelo seguia escribiendo el bloque: tokens pagados para
nada. La sonda de compatibilidad tiene el mismo fallo (`memoryOk` siempre 0).

Hecho: `LocalTurnResult` y la respuesta `local_turn` llevan `memory` y
`memoryStatus` (opcionales, para agentes viejos); `host-entry` los reenvia;
`turn-memory.ts` decide cual cuenta. Pruebas con el `runLocalTurn` real y un
proveedor falso.

Falta, y es de Daniel: reiniciar Studio y hablar con Lia. Desde el segundo
turno de una conversacion, el registro «prompt privado compuesto» tiene que
enseñar el bloque `memoria`. Las 17 conversaciones existentes empiezan sin
memoria acumulativa y la van ganando al retomarlas; generarla de golpe por
suscripcion queda por decidir.


## F23-PENDIENTES-001 — que Lia saque sola las promesas y lo pendiente

Estado: **pasos 1 a 10 hechos y comprobados; falta la prueba real de Daniel
(12) — Claude, 2026-09-14.**
Diseño en `docs/PENDIENTES-DISENO.md`.

- **Paso 1, el trabajo de fondo (`D-087`)**: catalogar ya no usa la API de pago.
  Hecho, con selector en el panel. Sin ver todavia con la boveda abierta;
- **Pasos 2 y 3, el nucleo puro**: hechos por agentes, con dos revisores y un
  esceptico por hallazgo. `vault-relation.ts` (esquemas, prompt del extractor,
  lectura y verificacion de la respuesta), `relation.ts` (fusion, coincidencias
  y reclamaciones) y `relation-selection.ts` (que promesa sale en cada turno y
  cual se calla). Nada de esto esta enganchado todavia: son funciones puras;
- **Paso 4, el almacen cifrado**: hecho. `relation-store.ts` sella con la
  subclave de identidad, escribe de forma atomica con `fsync`, serializa las
  escrituras y lee con tolerancia: lo que no valida se CONSERVA en crudo y se
  reescribe, en vez de desaparecer. `PrivateMemory` gana la linea temporal,
  `conversationsFor`, `turnAt` y `timeline`. Borrar una conversacion borra sus
  notas y deja los cierres sin referencia;
- **Paso 9, el bloque del prompt**: hecha la parte compartida.
  `formatPendingAffairs` arma «ASUNTOS PENDIENTES ENTRE VOSOTROS» con los
  hechos calculados por linea. Sin pendientes, el prompt es identico al de
  antes. Falta engancharlo en el turno;
- **Paso 6 y 8, la extraccion y la pasada**: hechos. `relation-sync.ts`
  recorre las conversaciones en ventanas de 40 turnos con 4 de contexto, con
  cursor por conversacion que solo avanza sobre turnos REVISADOS de verdad. La
  parte nueva de una ventana termina siempre en un turno del personaje, asi que
  un mensaje sin respuesta nunca se da por leido. Corre entre turnos: a los 3
  minutos de silencio, con 4 turnos de desfase, y al terminar el primer turno de
  una conversacion nueva. Catalogo y extraccion comparten un solo carril
  (`createAuxiliaryLane`), asi que nunca hay dos CLI a la vez;
- **Paso 7, la lista**: hecha. «Lo que teneis pendiente» en el panel de memoria,
  agrupada por personaje, con la cita literal, el dia, el estado y los cuatro
  botones (Cumplida, Ya no vale, No era una promesa, Reabrir). Lo que decide
  Daniel queda con `decidedBy: daniel` y el extractor no lo pisa;
- **Paso 5, el diagnostico**: hecho. `relation-diagnostics.ts` es puro y
  devuelve solo enteros y booleanos: cobertura, desfase, notas por estado,
  integridad de las citas, la dosificacion simulada sobre los mensajes reales de
  Daniel, cuantas saca ella antes de que el las nombre y cuantas reclamaciones
  van sin respaldo;
- **Paso 9, el enganche**: hecho. `selectPendingForTurn` corre dentro de un
  `try` en `vaultConversationSend`: si falla, el turno sale sin bloque en vez de
  perderse. Los contadores van al registro «prompt privado compuesto» y despues
  de la respuesta se apunta «pendientes en la respuesta» con cuantas se le
  enseñaron y cuantas aludio;
- **Paso 10, comprobado**: `npm run check` exit 0, 166 archivos de prueba,
  3187 pruebas, 12 saltadas.

**Falta, y es de Daniel (paso 12):** reiniciar Studio, pulsar «Comprobar la
memoria» ANTES de extraer nada para tener la linea base, lanzar «Buscar lo
pendiente en lo ya hablado», repasar la lista y descartar lo que no sea una
promesa, y solo entonces hablar con Lia sin nombrar la deuda. Ver `LA-045`.

Origen, de Daniel: «que ella misma pueda sacar recuerdos sola: por ejemplo, le
prometi dos cafes y una tarta de chocolate en la cama. Ella podria
recordarmelo, echarmelo en cara, etc sin que yo se lo recuerde».

Se diseña con tres propuestas independientes y dos jueces antes de tocar
codigo. Condiciones: sin llamadas de pago extra por turno, con pasada sobre
las 17 conversaciones que ya existen, y comprobable con el diagnostico en
cifras.

## F22-ALCANCE-MEMORIA-001 — el tope del indice deja de limitar lo que recuerda

Estado: **`done` en codigo — Claude, 2026-09-11.** Tres rondas adversariales
(dos revisiones y una caza de 287 frases con 141 falsos positivos), deteccion
reescrita como gramatica (`D-085`), `npm run check` exit 0 con 2964 pruebas.
Falta verlo en turnos reales: el diagnostico «Comprobar la memoria» dira que
camino dispara con los mensajes de Daniel.

Salio del diagnostico real: 40 momentos con un tope de 40 lineas, y los
caminos que transcriben solo miraban dentro de esas 40. Ademas «¿como nos
conocimos?» no lo recogia ningun camino. Cuatro cambios:

1. el tope limita las LINEAS, no el alcance: principio, fecha y palabras
   buscan en todos los episodios, y el primero de todos va fijo en el indice,
   con un aviso de cuantos faltan entre medias;
2. un camino para el principio, que exige preguntar: «desde el primer dia
   supe que...» no se lo hace recitar;
3. de un dia con varios momentos (casi siete de media) se elige el que
   nombran las palabras con contenido del mensaje, o el mas largo; los demas
   se le nombran y puede preguntar cual;
4. el diagnostico pasa cada mensaje real por la memoria tal y como estaba al
   escribirlo y cuenta que camino habria disparado.

## F22-DIAGNOSTICO-MEMORIA-001 — comprobar la memoria sobre lo ya hablado

Estado: **`done` y ejecutado sobre la boveda real — Claude, 2026-09-11.**

Origen, de Daniel: «quiero que cada mejora que hagamos incluya las
conversaciones ya tenidas. ¿No puedes cogerlas e indexarlas con las nuevas
mejoras, y de paso hacer pruebas, o que veas mi estilo de hablarle?».

Principio adoptado: **cada mejora de memoria trae su pasada sobre las
conversaciones ya tenidas.** Ya se cumplia en la indexacion —`PrivateMemory`
recorre todas en cada apertura—; faltaba poder COMPROBARLO sin sacar nada de
la boveda.

Boton «Comprobar la memoria» en el panel de memoria de Privado. Corre en el
proceso principal con la llave abierta y devuelve solo cifras: cobertura del
catalogo, la busqueda por fecha probada contra cada dia real en que se hablo
(«¿de que hablamos ayer?» desde el dia siguiente) y el estilo de Daniel en
recuentos de patrones. Sin llamadas a modelos.

### Primera ejecucion real (2026-09-11, 08:58)

Lo pulso Daniel; las cifras salen de `studio.log`, sin una sola frase:

- 17 de 17 conversaciones catalogadas; 0 solo por pausas;
- 40 momentos, todos catalogados, en 6 dias (2026-09-01 a 2026-09-10);
- busqueda por fecha: 6 de 6 dias;
- 137 mensajes suyos, mediana de 85 caracteres; 7 con fecha, 3 pidiendo
  recuerdos y 0 hablando de lo dicho.

Lo que destapo, y no se veia en pantalla: **40 momentos con un tope de 40
lineas**, y los tres caminos que transcriben solo miraban dentro de esas 40.
La conversacion siguiente habria dejado fuera el primer dia. Se arregla en
`F22-ALCANCE-MEMORIA-001`.


## F22-RECUERDO-POR-FECHA-001 — Lia reconoce conversaciones por su fecha

Estado: **`done` en codigo, `pendiente de prueba real` — Claude, 2026-09-11.**

«¿te acuerdas de lo que hablamos el jueves?» ya encuentra la conversacion de ese
dia. Antes no podia: la busqueda era solo por palabras. Detalle en
`CHANGELOG-WORK.md` y en `docs/ROLEPLAY-MEMORIA.md`.

### Lo que falta, y es de Daniel

1. **Probarlo en Privado**, reiniciando antes Studio: preguntarle por lo que
   hablasteis «hoy», «ayer», «el lunes». Es lo unico que confirma que las fechas
   del disco casan con las del mensaje en su maquina.
2. Y comprobar lo contrario: que una frase con fecha que no pregunta nada —«hoy
   estoy cansado»— NO le haga recitar la conversacion.

### Lo siguiente del plan

- que Lia elija entre los candidatos de un dia, y pueda preguntar cual;
- las lineas del indice solo muestran el titulo. El catalogo ya guarda titulo,
  resumen y etiquetas, y resumen y etiquetas ya alimentan la busqueda; lo que
  falta es decidir si el resumen entra en la linea, que cuesta tokens;
- fase 3: recuperar los tokens del bloque de imagen, en cuanto haya medidas
  reales de una conversacion (fase 1 ya las registra).


## F21-CODEX-TUBERIA-001 — Codex describe fotos de la boveda sin tocar el disco

Estado: **`done` y PROBADO contra el binario real — Claude, 2026-09-10.**
`npm run check` exit 0, 2.704 pasadas.

Transporte nuevo por `codex app-server`: la foto viaja descifrada en memoria,
en linea dentro del mensaje, y el disco no se toca. Convive con `codex exec`,
que sigue llevando todo lo demas. Detalle en `CHANGELOG-WORK.md` (2026-09-10
12:30) y `D-084`.

Prueba real hecha: PNG en memoria, `gpt-6-astra`, esfuerzo `low`, respuesta
correcta en 11 segundos, con tokens y diagnostico de final de respuesta — que
`codex exec` no rellenaba nunca.

### Lo que falta, y es de Daniel

1. **Probarlo desde la pantalla**, no desde un script: abrir una foto de la
   boveda, elegir Codex como modelo de vision y pulsar Describir con IA. Es el
   unico camino que no se ha ejercitado entero.
2. Comparar esa descripcion con la de Opus, que sigue siendo la mejor de las
   probadas.

### Aviso para quien siga

El protocolo del app-server es `[experimental]` segun el propio CLI. Si una
actualizacion de Codex lo cambia, lo que se pierde es describir fotos de la
boveda con Codex; el resto de Codex sigue por `codex exec`. La deteccion
(`capabilities.appServer`) apaga el camino sola si el subcomando desaparece.


## LA-CLIS-001 — los dos CLI actualizados

Estado: **`done` y verificado — Claude, 2026-09-10.** `npm run check` exit 0.

Codex a **0.154.0** y Claude Code a **2.1.267**. Detalle en `CHANGELOG-WORK.md`
(2026-09-10 12:00).

Habia DOS Codex: el de la app de escritorio (0.153.4, con Astra) y el de npm
(0.150.1, sin Astra), y Luxy usa el de npm. `codex update` desde la app no toca
esa instalacion. Ahora `gpt-6-astra` funciona en Luxy.

Se comprobaron los veinte flags que Luxy detecta del `--help`: diecinueve
siguen. `--max-turns` desaparecio, y resulto ser una capacidad **fantasma** —se
detectaba y nadie la leia—, asi que se quito.

### Lo que falta, y es de Daniel

1. **Probar Astra en Luxy**, ahora que el CLI lo soporta. En el banco de vision
   o en la conversacion, con el esfuerzo que quiera.
2. Si quiere, comparar Astra contra Opus describiendo la MISMA imagen: es el
   dato que faltaba para decidir si merece la pena el transporte
   `codex app-server` (probado y documentado, sin implementar).


## F20-CODEX-IMAGENES-001 — Codex si ve imagenes

Estado: **`done` en codigo, `pendiente de prueba real` — Claude, 2026-09-10.**
`npm run check` exit 0, 2.687 pasadas.

Luxy decia que Codex «solo acepta texto» y era falso: `codex exec --help`
declara `-i, --image <FILE>...`. Detalle en `CHANGELOG-WORK.md` (2026-09-10
11:00) y `D-083`.

Lo que Codex no acepta son BYTES, solo rutas. De ahi que valga en el banco de
vision —el archivo lo elige el usuario y ya esta en claro en su disco— y no en
la boveda, donde la imagen solo existe descifrada en memoria.

### Lo que falta, y es de Daniel

1. **Probar Codex en el banco de vision.** Es lo unico que confirma que el
   `-i` funciona de verdad contra su CLI: ninguna prueba lanza un proceso.
2. Si falla, mirar `%LOCALAPPDATA%\Luxy\logs\luxy.log`: los argumentos
   construidos salen ahi.

### De la tanda anterior, ya verificado por el

`F18-ESFUERZO` esta **probado de verdad**: Opus describio una imagen entera con
esfuerzo `low` —unos 1.700 caracteres, con encuadre, luz, paleta, complexion,
pelo, ojos y cuerpo—. `low` basta para describir. Y Sonnet se nego a la misma
imagen, que no es un fallo de Luxy: lo clasifico bien y no lo guardo como pie de
foto.


## F18-ESFUERZO-002 — el esfuerzo, en los seis caminos de la boveda

Estado: **`done` en codigo, `pendiente de prueba real` — Claude, 2026-09-10.**
`npm run check` exit 0, 2.684 pasadas.

Lo pidio Daniel: «no has puesto el esfuerzo del razonamiento en comprobar
imagenes». Faltaba en cinco de seis caminos. Detalle en `CHANGELOG-WORK.md`
(2026-09-10 09:50) y `D-082`.

### Lo que falta, y es de Daniel

1. **Reiniciar Studio**: esta vez si cambia codigo. `npm run build` y abrir.
2. **Probar el selector nuevo del banco de vision**: la misma foto con `low` y
   con `xhigh`, a ver si la descripcion mejora lo bastante para pagarlo.
3. **Decidir si quiere el esfuerzo en la cola de trabajos.** Es otra tarea:
   pide columna nueva y migracion contra su Supabase, y esas no se tocan sin
   que lo pida.


## F19-TIPAR-PRUEBAS-001 — las pruebas entran en el typecheck

Estado: **`done` y verificado — Claude, 2026-09-10.** `npm run check` exit 0.

Un literal anotado de los tests llevaba meses sin listar tres campos
obligatorios y nadie se enteraba: los tsconfig excluian las pruebas y vitest no
comprueba tipos. Ahora hay un `tsconfig.tests.json` por paquete y
`npm run typecheck` los ejecuta. Detalle en `CHANGELOG-WORK.md` (2026-09-10
09:30).

124 errores arreglados, ninguno en produccion, y **una sola afirmacion
cambiada**: `response-matrix.test.ts` verificaba `final=aborted`, un valor que
`STREAM_TRANSPORT_ENDS` no tiene y que produccion no escribe jamas.

### Lo que falta, y es de Daniel

Nada de esta tarea. Queda pendiente lo de antes: probar de verdad el selector de
esfuerzo (`F18-ESFUERZO-001`) y volver a describir la imagen cuyo pie de foto
se guardo cortado (`F16-DESCRIBIDOR-002`).


## F18-ESFUERZO-001 — elegir cuanto piensa el modelo

Estado: **`done` en codigo, `pendiente de prueba real` — Claude, 2026-09-10.**

Origen: Codex salia a `xhigh` en cada turno, heredado del `config.toml` del
usuario, y no habia forma de verlo ni de cambiarlo desde Luxy. Detalle en
`CHANGELOG-WORK.md` (2026-09-10 08:55) y `D-082`.

Selector de esfuerzo junto al de modelo, gateado por deteccion en los dos CLI, y
con la lista de niveles filtrada POR MODELO —`ultra` no existe en `gpt-5.5` y
mandarlo falla la llamada, que se paga igual—. `npm run check` exit 0, 2.676
pasadas.

### Lo que falta, y es de Daniel

1. **Probarlo de verdad.** Nada de esto ha hecho una llamada real: las pruebas
   fijan como se CONSTRUYEN los argumentos, no que el CLI los acepte. Lo que hay
   que mirar la primera vez es que un turno con `low` conteste mas rapido y mas
   corto que uno con `xhigh`.
2. **Decidir si su `~/.codex/config.toml` se queda como esta.** Ese
   `model_reasoning_effort = "xhigh"` sigue gobernando Codex fuera de Luxy.
   No se ha tocado: es configuracion personal.


## F16-DESCRIBIDOR-002 — el pie de foto se corrige y se reescribe

Estado: **`done` en codigo, `pendiente de prueba real` — Claude, 2026-09-10.**

Origen: Daniel intenta corregir a mano un pie de foto y se topa con «un solo
recuadrito que te lleva al principio sin poder hacer scroll», y pregunta por un
boton que se lo reformule con otra IA. Detalle en `CHANGELOG-WORK.md`, entrada
del 2026-09-10 08:20, y `D-081`.

Tres cosas: recuadro de diez filas en vez de `input`, tope del pie de foto de
1.900 a 3.000 (esquemas a 3.200) y boton **Mejorar el español**, que no ve la
imagen, no guarda nada y devuelve el texto al borrador.

### Lo que falta, y es de Daniel

1. **Reconstruir y abrir Studio** para verlo: `npm run desktop:build` no basta,
   ha cambiado `packages/shared`. Toca `npm run build`.
2. **Volver a describir la imagen cortada.** El pie de foto guardado se recorto
   con el tope viejo y sigue cortado en disco: hay que pulsar **Describir con
   IA** otra vez sobre esa imagen para que se escriba entero.
3. Probar el boton nuevo sobre una descripcion mal redactada y comprobar lo
   unico que importa: que **no añade** nada que no estuviera.

## F16-DESCRIBIDOR-001 — el describidor de imagenes de la boveda

Estado: **`done` en codigo, `pendiente de prueba real` — Claude, 2026-09-08.**

Siete arreglos seguidos sobre el mismo camino: pedirle a un modelo con vista que
escriba el pie de foto de una imagen guardada. Detalle commit a commit en
`CHANGELOG-WORK.md`, entrada del 2026-09-08 11:05.

Lo ultimo, `D-072`: un recorte nuestro se marca y corta por frontera de palabra;
los topes suben a 1.900 (pie de foto) y 20.000 (razonamiento). `npm run check`
exit 0, 2.523 pasadas.

### Lo que falta, y es de Daniel

1. **Volver a describir la misma foto** y comprobar que el razonamiento llega
   entero, con la marca al final si se recorta.
2. **Probar una foto SIN personas.** Es el caso que `788080a` arreglo —el prompt
   daba por hecho que habia alguien— y no se ha probado ni una vez.
3. **Elegir `qwen/qwen3.6-27b` a mano** en el banco. `llama-3.3-70b-versatile`
   no esta en el catalogo de Groq; el modelo por defecto de la conexion es el
   que se enredaba razonando.

### Bloqueado, no olvidado

Redimensionar la imagen antes de enviarla —la causa de fondo del troceado que
describe `D-071`— sigue sin poderse hacer: `nativeImage` no decodifica webp
(`D-069`).

### Deuda del entorno

Tres claves de API quedaron expuestas en la conversacion (Mistral x2, Groq x1).
Daniel dijo que las rotaria; **no consta que lo haya hecho** (2026-09-23). La
rama `copia-antes-de-limpiar` sigue existiendo: es historial PRE-reescritura y
se puede borrar cuando de por bueno el reescrito, cosa que **tampoco consta**.

**Hay 135 commits sin subir** (`git rev-list --count origin/main..main`, medido
el 2026-09-23). La cifra que había escrita aquí, 41, era de una foto vieja y se
arrastró sin recontar.

> **Aviso para quien reconstruya el estado a ciegas.** Los cinco commits más
> recientes de `main` son `5ff93ae` (2026-09-23, `imageCast`), `4a7f289`,
> `0538508`, `6bd4850` y `29f829d`. **No** son documentación de proveedores:
> los de Featherless / Alibaba / «cuarta vuelta» son del 2026-09-07. Si ves
> esos mensajes con hashes que no están en `main`, estás mirando
> `copia-antes-de-limpiar`. No hubo trabajo de proveedores los días 22 y 23.


## BUG-CATALOGO-ORIGEN-001 — el catalogo solo sabia preguntarle a una conexion

Estado: **`done` — Claude, 2026-09-04.** Faltaba probarlo contra Mistral y eso
ya no puede ocurrir: `LA-040` quedó cerrada sin hacer al descartarse Mistral
(`LA-044`). Hay que probarlo contra **cualquier otra** conexión con catálogo
propio, o darlo por bueno como está.

Daniel guarda la clave de Mistral, va a Modelos, pulsa «Actualizar modelos» y le
salen 19 modelos que no son de Mistral.

### La causa, que eran dos

**1. Dos listas que no se hablan.** Luxy guarda las conexiones en `connections`
y en `providers.http`. Toda la maquinaria del catalogo miraba solo la primera, y
solo su PRIMER elemento, escrito a mano en tres sitios: `useCatalog.ts:16` —el
catalogo que alimenta los selectores de Privado, Conversaciones y Laboratorio—,
`Config.tsx:98` —el panel «Catalogo real»— y `Config.tsx:69` —el registro de la
lista grande—.

**2. La familia se adivinaba por el nombre.** Los modelos con vista de Mistral se
llaman `pixtral`, asi que caian en `other`. Como el identificador de proveedor ES
la familia, el selector de modelo de Privado habria seguido vacio aunque el
catalogo ya se leyera. Sin esto, el arreglo se quedaba a medias.

### Lo hecho

`CatalogSource` en el contrato; los dos handlers buscan en la lista que toca y
con el nombre de secreto que toca; el almacen separa los origenes por archivo
—conservando el nombre de siempre para las conexiones, para no dejar huerfano lo
ya leido—; `catalogOriginsOf` junta las dos listas; `useDetectedCatalog` lee
TODOS los origenes y deduplica; selector «A quien se le pregunta»;
`familyOverride` para que un proveedor HTTP imponga su identificador; y familia
`mistral` con sus nombres reales.

**Riesgo cerrado antes de seguir:** `family` es un enum CERRADO, asi que meter un
identificador cualquiera tumbaria el catalogo entero por una errata. El override
solo se aplica si es una familia real. Con prueba.

`npm run check` exit 0: **140 archivos, 2.453 pruebas superadas, 12 omitidas.**

### Lo que sigue sin tener sitio en la pantalla

`imageUrlFormat` existe en el esquema y el agente lo usa, pero **no hay campo
para cambiarlo**: se queda en `object`. Mistral documenta `image_url` como
cadena. Si «Describir con IA» devuelve un 400 que no explica nada, es eso.

### Siguiente paso exacto

`LA-040`: reiniciar Luxy, elegir Mistral en el selector del catalogo, pulsar
«Actualizar modelos» y quedarse con el identificador real de un modelo con vista.

---

## F13-GALERIA-001 y F13-HILOS-001 — la galeria y los hilos por personaje

Estado: **`done` — Claude, 2026-09-04.** Falta verlo en pantalla: `LA-039`.

Las dos ultimas peticiones del mensaje de Daniel sobre la memoria: «una galeria
mas chula, conversaciones ordenadas por tiempo/personaje para separar las que no
son de Lia». Quedaron sin empezar en la tanda anterior y se dijo asi.

### F13-HILOS-001 — de quien es cada conversacion

La lista era plana y ordenada solo por fecha, asi que los hilos de Lia salian
mezclados con los que no son suyos y habia que ABRIRLOS para saber de quien
eran. En un contenido privado eso es justo lo que no se quiere hacer.

Lo dificil no era agrupar sino **saber de quien es cada hilo**: el personaje solo
se vuelve a sellar cuando CAMBIA —para no repetirlo en cada turno y engordar el
archivo—, asi que el ultimo turno devuelve `null` en casi todos. `characterOf`
recorre hacia atras y se queda con el primero que lo lleve, reutilizando el
registro que la lista ya habia abierto. Cadena vacia sigue siendo «ya no es de
nadie», distinto de «sin sellar».

El nombre se resuelve en el proceso principal: al renderer solo llegaria un uuid.
Un personaje olvidado conserva sus hilos bajo «Personaje olvidado»; los que nunca
tuvieron personaje van al final aunque sean recientes. Con un solo grupo no se
pinta cabecera.

### F13-GALERIA-001 — los archivos en rejilla

Era una lista de botones «Ver» y no se veia nada sin abrirlos de uno en uno.
Ahora hay rejilla de baldosas cuadradas y un visor a pantalla casi completa con
el pie de foto, lo que se pidio al generarla, «Describir con IA» y sus avisos.

**No hay miniaturas guardadas, y no es un olvido: `nativeImage` de Electron no
decodifica webp ni gif** —comprobado ejecutandolo—, y webp es el formato de casi
todo lo que entra aqui. Cada baldosa descifra su imagen al entrar en pantalla y
ni una antes (`D-069`).

### De paso: media pantalla no tenia bordes

`--line` y `--accent` se usaban en trece sitios y **no existian en la paleta**.
Una `var()` sin definir invalida la declaracion entera, asi que esos bordes no se
pintaban. Declarados como alias de `--rule` y `--signal`.

`npm run check` exit 0: **137 archivos, 2.436 pruebas superadas, 12 omitidas.**

### Siguiente paso exacto

`LA-039`: abrir Privado y mirarlo. En concreto, que las cabeceras de personaje
salgan cuando hay mas de uno, que las baldosas carguen al bajar y que el visor
cierre con Escape sin cerrarse al escribir el pie de foto.

---

## F11-HORDE-001 — imagenes NSFW gratis con AI Horde

Estado: **`done` — Claude, 2026-09-04. Sin commit.** Queda `LA-038`, que es
probarlo contra la red real: trabajo de Daniel.

Daniel pidio generar imagenes NSFW —anime y realistas— **sin gastar un euro**, y
probar Cohere y AI Horde. El texto se queda con DeepSeek, que le va bien.

Todo lo de roleplay vive en **Privado**, bajo la boveda, como corresponde.

### Lo que decidio el diseño

**AI Horde no tiene personajes.** El proveedor de pago guarda el personaje en su
servidor y devuelve un identificador; eso es lo que mantiene la misma cara entre
generaciones. En el horde no hay nada al otro lado que recuerde a nadie.

Asi que un personaje del horde **es** una receta local y cifrada: modelos,
aspecto fijo en ingles, ropa, negativo, semilla, tamaño, pasos y `clipSkip`. Ver
`D-064`. De ahi salen tres cosas que el de pago no tiene: editarlo es gratis,
conserva su identificador —y con el sus imagenes y sus recuerdos—, y la
identidad va **primero** en el prompt, porque los primeros tokens pesan mas.

**La clave anonima no se pone sola.** `0000000000` funciona, pero con ella el
servidor **fuerza `shared`**: dona lo generado a un conjunto de datos publico.
Una boveda que existe para que nadie lea lo de dentro no puede regalar por
defecto lo que produce. Se puede escribir a mano y entonces la pantalla avisa de
lo que implica. Ver `D-065`.

**La clave que hace falta es la del proveedor de ESE personaje.** `D-066`.

### Piezas

| pieza | donde | pruebas |
| --- | --- | --- |
| transporte del horde | `apps/agent/src/providers/horde.ts` | 40 |
| receta y catalogo curado | `packages/shared/src/vault-image-provider.ts` | 15 |
| almacen de personajes | `character-store.ts`, `provider` + `recipe` | 4 nuevas |
| contrato IPC | `ipc.ts`, `channels.ts`, `preload` | 3 nuevas |
| generacion y claves | `handlers.ts` | — |
| pantalla Privado | `Vault.tsx`, `styles.css` | — |
| proveedores conocidos | `http-provider-config.ts`, `Config.tsx` | 2 nuevas |

El adaptador respeta el contrato tal y como lo publica su swagger vivo:
cabecera `apikey` (no `Authorization`), `censor_nsfw` **siempre explicito**
—porque el swagger dice `false` y el servidor dice `True`—, sondeo por
`/generate/check` y una sola llamada a `/generate/status`, que tiene limite de
diez por minuto, y las dos formas del campo `img` (URL de R2 que caduca a los
1800 s, o base64).

### Cohere

**Ya funcionaba sin tocar codigo.** Se da de alta en Ajustes → Conexiones →
Proveedores HTTP con base `https://api.cohere.ai/compatibility/v1` —el host es
`.ai`, la API nativa es `.com` y no habla este contrato—. Lo unico que se añadio
es un selector de proveedores conocidos para no tener que recordar esa URL, con
Cohere, DeepSeek, Groq, Mistral y OpenRouter.

Dos cosas que conviene saber antes de gastar la clave, y que estan escritas en
`docs/PROVIDERS.md`: `safety_mode` **no viaja** por la capa de compatibilidad
—su defecto es `CONTEXTUAL` y se obtiene de facto, sin poder elegirlo— y sus
Terminos de Uso prohiben contenido pornografico, aunque su politica de uso solo
prohiba expresamente lo relacionado con menores. Es contradictorio; no es una
base solida para roleplay adulto.

### Pruebas

`npm run check` exit 0: **132 archivos, 2.340 pruebas superadas, 12 omitidas.**

Una revision adversarial por cuatro dimensiones confirmo 12 hallazgos de 26 y
dejo ocho arreglos: la censura propia de un worker, la cancelacion que nunca se
enviaba, el agujero de `configSave` con los secretos reservados, la clave
anonima corrompiendo `redact()`, editar un personaje secuestrando la
conversacion, los kudos llamados «creditos», y dos avisos que fallaban en
silencio. Ver `CHANGELOG-WORK.md` del 2026-09-04 10:30.

### Lo que NO esta verificado

Nada de esto se ha ejecutado contra la API real de AI Horde ni se ha visto en
pantalla. Las pruebas demuestran **que contrato se envia**, no que la red
responda lo que se espera. Es `LA-038`.

### F11-HORDE-002 — LoRAs e imagen de partida — **hecha**

Salio de una pregunta de Daniel: si se puede subir una imagen de referencia para
que el personaje sea coherente. **No**, y la comprobacion contra el swagger vivo
y los 178 modelos esta en `D-067`: AI Horde no tiene ningun mecanismo de
identidad por imagen, ni un solo worker sirviendo un modelo de edicion por
instruccion.

Lo que si fija la identidad son los pesos, y ese era el hueco: **el campo de
LoRA no existia en la pantalla** aunque el esquema y el adaptador ya lo
soportaban. Hecho, con lo que cuesta escrito al lado: +3 kudos por LoRA y solo 9
de los 18 workers los aceptan.

Hecho tambien **img2img**, anunciado por lo que es —varia una imagen que ya
salio bien, no lleva la cara a una escena nueva— con `fromMediaId` de punta a
punta: la pantalla elige un medio de la conversacion y el proceso principal lo
descifra en memoria y lo manda en base64 puro en el CUERPO, nunca por URL.

Dos detalles del contrato que no se adivinan: `source_image` va en la RAIZ y
`denoising_strength` dentro de `params`. Al reves, el servidor ignora la imagen
en silencio. Hay una prueba por cada ubicacion.

**ControlNet NO se implemento**: su gate real solo admite SD1 y SD2, asi que en
Pony o Illustrious vuelve con `ControlNetMismatch`. Habria sido codigo que falla
siempre justo en los modelos que se usan.

`npm run check` exit 0: **133 archivos, 2.356 pruebas superadas, 12 omitidas.**

### Siguiente paso exacto

Sacar la clave gratuita en aihorde.net, guardarla en Privado, crear un personaje
del horde y pedir una imagen dentro de una conversacion privada.

---

## F10-MEMORY-001 — memoria episodica del personaje

Estado: **`done` — 2026-09-03, verificado de punta a punta.** Sin push.

Un personaje recuerda entre conversaciones: en un hilo nuevo, sin historial ni
memoria acumulativa, cita momentos de otras conversaciones y los sitúa en el
tiempo. Nueve de once afirmaciones comprobadas una a una contra los turnos.

Decisiones: `D-058` (puntero y no copia; dos niveles), `D-059` (compatibilidad de
modelos), `D-060` (sin señal temporal no se inventa un corte) y `D-061` (no
inventa un pasado, pero sigue improvisando el presente).

Aquello de «gané yo» donde constaba «ganaste» quedo resuelto solo: al corregirla
volvio a «creo que los dos ganamos», que es casi textual de aquella noche. Sabia
lo que constaba y estaba jugando. Nada que atar.

Que un personaje rememore: «¿te acuerdas de como nos conocimos?» debe traer
aquel dia con sus palabras. La memoria acumulativa actual no puede —es un
resumen que se reescribe, con techo, y pertenece a la conversacion— y se queda
como esta: sirve para el hilo inmediato.

**Principio:** un recuerdo es un PUNTERO a turnos reales, no una copia
resumida. Nada de esto lo escribe el modelo, asi que nada de esto se puede
inventar. Ver `D-058` para el razonamiento y los numeros.

### F10.0 — elegir modelo y ver el estado de la memoria — **hecha**

Estado: `done`, 2026-09-03. Sin verificar en pantalla.

La conversacion privada mandaba `model: null` **siempre**, asi que
`modelFor()` del proveedor HTTP caia en el modelo de la conexion: nunca se podia
elegir, y en la cuenta de Daniel eso significa el Pro de la familia en cada
turno.

- `latestModel` en `conversation-store.ts`, gemelo de `latestProvider`: el turno
  ya sellaba el modelo y nadie lo leia. El modelo pasa a ser propiedad de la
  conversacion y sobrevive al reinicio.
- Selector de modelo en Privado, con el catalogo real filtrado por familia —el
  id de proveedor ES la familia, asi los registra el agente—. La opcion vacia
  mantiene el comportamiento anterior, ahora como eleccion visible.
- **Estado del bloque de memoria por turno**, que se calculaba y se tiraba. Sin
  esto no se puede cambiar de modelo con criterio: uno mas pequeño puede escribir
  bien la escena y mal el bloque, y como un bloque invalido conserva la memoria
  anterior (`D-019`), la averia solo se nota semanas despues como «se le olvidan
  cosas».

Cuatro pruebas nuevas en `conversation-store.test.ts`. `npm run check` exit 0:
122 archivos, 2.134 superadas, 9 omitidas.

Pendiente de Daniel: comparar un modelo menor contra el actual mirando ese aviso,
con Laboratorio o a mano. El coste no es criterio (ver `D-058`): el motivo para
bajar de modelo seria la latencia, que en los registros llega a 56 s hasta el
primer token.

### F10.1 — indice de busqueda en memoria

Indice invertido sobre el texto de los turnos ya descifrados, construido al
desbloquear la boveda y descartado al cerrarla. **Nunca toca disco**: un indice
de terminos en claro filtraria el contenido con solo mirarlo.

- normalizacion: minusculas, sin acentos, sin signos; lista de vacias en
  español;
- entrada: `(conversationId, sequence)`; salida: turnos ordenados por
  coincidencia;
- vive en `apps/desktop/src/main/vault/`, es pura salvo la lectura inicial;
- pruebas: normalizacion, orden de resultados, y que el indice se vacia al
  cerrar la boveda.

Volumen medido: la conversacion mas larga son 116 KB; cien conversaciones no
llegan a 12 MB. No hace falta nada mas sofisticado.

**Hecha el 2026-09-03**, en `apps/desktop/src/main/vault/turn-index.ts`, con 19
pruebas. Puntuacion TF-IDF corta: un termino que sale en pocos turnos pesa mas
que uno que sale en todos, asi que «conocimos» decide y «quiero» no, sin ninguna
lista de palabras importantes a mano. Normaliza tildes y **conserva la eñe**,
porque descomponerla convertiria «año» en otra palabra. Admite limitar la
busqueda a un conjunto de conversaciones, que es lo que necesitan el alcance por
personaje y los hilos excluidos.

**Hallazgo que cambio el plan:** el lexico NO resuelve el caso que motiva la
funcion si la pregunta no comparte palabras con lo que se dijo. La prueba lo
afirma en vez de disimularlo.

Se ataco por los dos lados. El determinista esta hecho aqui: **recorte de raices
en dos pasadas**, que cubre la morfologia regular —«presentamos», «presenta» y
«presentar» comparten raiz— y no alcanza los verbos irregulares, que cambian la
raiz y no el sufijo. Una prueba afirma cada mitad. El otro lado —que el modelo
elija sobre el indice completo— es F10.3, ya revisada. Ver `D-058`.

Pendiente al integrarlo (F10.2): **`clear()` al cerrar la boveda**. El indice
tiene texto en claro en memoria y una boveda cerrada que conserve su contenido
accesible no esta cerrada. Hoy no hay agujero porque nadie lo construye todavia.

### F10.2 — episodios y su almacen

Un episodio es un tramo contiguo de turnos de una conversacion.

- **Segmentacion determinista, sin modelo**: corta por salto de tiempo entre
  turnos (umbral a fijar, orientativo 6 h), por cambio de conversacion y por un
  maximo de turnos.
- Registro: `{ id, characterId, conversationId, desde, hasta, inicio, fin,
  turnos }`. Sin texto: el texto son los turnos.
- Cifrado como el resto, con su dominio propio. Esquema en `vault-payloads.ts`.
- Los episodios se recalculan a partir de los turnos, asi que **las
  conversaciones que ya existen entran solas**, incluida la que Daniel quiere
  conservar.
- Pertenecen al personaje. Una conversacion puede excluirse del banco.

**Hecha el 2026-09-03**, con una simplificacion sobre lo planeado: **los
episodios NO se persisten.** Se deducen por completo de los turnos, que ya estan
en disco; un almacen cifrado propio añadiria un esquema, una migracion y la
posibilidad de que los dos se separen, a cambio de ahorrar una pasada sobre una
lista que ya se ha leido. Lo unico que habra que guardar algun dia son los
titulos y etiquetas de F10.6, porque eso no se deduce de nada.

Piezas: `episodes.ts` (segmentacion pura, 13 pruebas) y `private-memory.ts`, que
junta el indice y los episodios y les pone lo unico que no puede ser puro —leer
la boveda y saber cuando dejan de valer— con 8 pruebas contra una boveda real.

Se construye **perezosamente**, en la primera busqueda y no al abrir: abrir ya
tarda por el derivado de la contraseña, y quien no rememore nada no debe pagar
una pasada sobre todo su historial.

Y se vacia sola al cerrar. Para eso `VaultService` tiene ahora `onLock`: cerrar
ocurre por tres caminos —a mano, por inactividad y al salir— y avisar desde
dentro de `lock()` es lo unico que garantiza que ninguno se olvide. Hay una
prueba que lo afirma.

### F10.3 — recuperacion en dos niveles

El limite es el contexto y la dilucion, **no el dinero**: la pasarela cobra por
llamada, no por token (ver la correccion de `D-058` con los registros reales).
Medido: el prompt actual son ~4.800 tokens de entrada confirmados y un episodio
de 6 turnos en crudo ~1.500.

- **Nivel 1 (siempre): TODOS los episodios**, no solo los que el lexico
  encuentre. ~40 tokens por linea de indice; un centenar cabe de sobra. Asi el
  personaje SIEMPRE sabe que ocurrio y de que iba, y la busqueda deja de decidir
  eso para decidir solo que se cita en crudo. Es la respuesta a que el modelo
  resuelva lo que el literal no alcanza, sin gastar una llamada de mas. El unico
  tope es no diluir las directivas de personaje.
- **Nivel 2 (con peticion de memoria y coincidencia fuerte):** los turnos en
  crudo del episodio, con tope de turnos y de caracteres.
- La seleccion se hace ANTES de la llamada, con el mensaje del usuario.
  **Invariante: una sola llamada por turno.** Con cobro por llamada, una segunda
  duplicaria la factura.
- Pruebas: que sin señal de memoria no se activa el nivel 2; que el nivel 2
  respeta su tope; que el numero de llamadas por turno sigue siendo uno.

### F10.4 — entrada en el prompt

- Bloque nuevo en `buildVaultPrompt`, marcado **(DATOS)** como la memoria y los
  turnos: es contenido, no ordenes.
- Cada recuerdo lleva su fecha, para que pueda situarlo en el tiempo.
- Regla explicita, heredada de la averia de la imagen: lo que no este en el
  recuerdo no se da por ocurrido.
- Pruebas del prompt, sin red.

**F10.3 y F10.4 hechas el 2026-09-03**, y enchufadas al turno de verdad.

`recall.ts` decide que recuerda el personaje: las lineas de todos los episodios
siempre —hasta 40, ~1.600 tokens— y UNO transcrito solo cuando el mensaje pide
rememorar de forma reconocible y la busqueda acierta. Si pide rememorar y no
acierta, **no se trae un episodio cualquiera**: traer el equivocado es peor que
no traer ninguno.

`buildVaultPrompt` los renderiza como **(DATOS)**, con la misma regla que la
lista de imagenes: de un momento no transcrito solo sabe su linea, y si le falta
un detalle lo pregunta en vez de rellenarlo. Es la leccion de la oreja doblada
aplicada antes de que ocurra.

Detalles que costaron una prueba cada uno:

- lo que ya viaja como historial reciente **no se transcribe otra vez**;
- el identificador que ve el modelo es corto (`r1`) y no un uuid: el prompt no
  tiene por que llevar identificadores internos;
- el recorte del episodio conserva el PRINCIPIO: quien pregunta por un momento
  quiere como fue, no como acabo;
- mirar al pasado no es pedir un recuerdo. «Ayer trabaje mucho» no transcribe
  nada.

El indice se invalida al terminar cada turno y al borrar una conversacion —sin
lo segundo, el personaje seguiria recordando algo borrado—. Se reconstruye solo
y perezosamente. Si algun dia se nota, la alternativa es añadir los dos turnos
nuevos al indice en vez de tirarlo entero; `TurnIndex.add` ya lo permite.

### F10.5 — pantalla de recuerdos

Ver los episodios de un personaje, abrirlos y **excluir** uno o una conversacion
entera. No sirve para crearlos —eso es automatico— sino para diagnosticar: si no
se acuerda de algo, hay que poder ver por que.

**Hecha el 2026-09-03.** Panel «Lo que recuerda» en Privado: lista de episodios
con fecha, titulo y numero de turnos, con «Ver» para abrir el contenido real y
«Excluir esta conversacion» para sacarla del banco.

Excluir NO borra: los turnos siguen ahi y la conversacion se abre igual. Lo que
cambia es si el personaje puede recordarla desde otro sitio.

Las exclusiones viven en `vault/memory-excluded.json`, **sin cifrar y a
proposito**: lo unico que guarda son identificadores de conversacion, que ya
estan a la vista como nombres de archivo en `vault/conversations/`. Cifrarlo no
ocultaria nada nuevo y obligaria a tener la boveda abierta para saber que
excluir, justo cuando se construye el indice. Ni un titulo, ni un texto, ni una
fecha entran ahi.

El panel carga al abrirse y no antes: construir el indice cuesta y nadie lo
habia pedido.

### F10.6 — catalogador — **en curso**

Ya NO es opcional: `D-058` la pedia para las parafrasis y `D-060` la hizo
necesaria para partir por escenas, porque dentro de una sesion continua no hay
ninguna señal temporal que sirva.

**Hecho (2026-09-03): el contrato y su validacion**, en
`packages/shared/src/vault-catalog.ts`, con 21 pruebas y sin gastar una llamada.

- `buildCatalogPrompt` pide partir por lo que PASA —sitio, momento, asunto,
  alguien que se duerme y vuelve— y prohibe expresamente partir por longitud,
  que es lo que fallaba. Va en modo tecnico, no en personaje, y la conversacion
  entra como DATOS.
- Pide `tags` **que no esten escritas en la escena**: es lo que resuelve la
  parafrasis. «Primer encuentro» aunque nadie diga esas palabras.
- `parseCatalogResponse` **rechaza en bloque**: huecos, solapes, un tramo que no
  se cubre entero, un titulo vacio. Reparar a medias produciria episodios que no
  corresponden a su titulo, y eso es peor que la segmentacion por silencios, que
  sera tosca pero nunca miente sobre donde empieza cada cosa.
- La asimetria que permite delegar esto en un modelo: **escribe el indice, nunca
  el contenido**. Un catalogo equivocado hace que un recuerdo no se encuentre;
  no puede hacer que se recuerde algo que no paso.

**Hecho tambien (2026-09-03): el resto.**

- `catalog-store.ts`: almacen cifrado. Es lo UNICO de la memoria episodica que
  se persiste, porque un titulo y unas etiquetas no se deducen de nada.
  Sustituye el catalogo de una conversacion en vez de acumularlo: dos versiones
  del mismo momento compitiendo en la lista es peor que ninguna.
- **Modo tecnico en el turno local.** `buildLocalJob` ponia siempre
  `luxyPrivateLocalTurn: true`, que activa el envoltorio de personaje de
  `D-055`. El catalogador habria catalogado en personaje. Ahora el protocolo
  lleva `kind: 'conversation' | 'technical'`.
- El handler cataloga **una llamada por conversacion sin catalogar**, no por
  turno, y descarta entero un catalogo que no cuadre: esa conversacion se queda
  con la segmentacion por silencios, que es tosca pero no miente.
- `PrivateMemory` prefiere el catalogo cuando existe, y las etiquetas viven en
  un **indice aparte**: su texto no es lo que se dijo, asi que mezclarlo con los
  turnos ensuciaria lo que despues se cita.
- Lo dispara la pantalla al abrir el panel, no un boton.

**Falta:** verificarlo contra un modelo real. La prueba esta escrita en
`live.test.ts` y se lanza con la clave en el entorno; `npm test` sigue sin gastar
nada.



Solo si F10.3 demuestra que el lexico no basta. Añade titulo legible y busqueda
por parafrasis. Va en un hueco de «modelo auxiliar» en Conexiones, el mismo que
pide el describidor de imagenes.

**Dos restricciones que el precio por token no captura:** el catalogador leeria
contenido explicito, asi que un modelo barato que se niegue no vale; y con cobro
por llamada, catalogar un episodio cuesta lo mismo que un turno de conversacion,
asi que «mas barato» apenas existe como palanca. Lo que abarata es no llamar.

### Orden y criterio de parada

F10.1 → F10.2 → F10.3 → F10.4 son lo minimo que ya rememora. F10.5 antes de dar
por bueno el conjunto. F10.6 solo con evidencia de que hace falta.

---

## VAULT-ROLEPLAY-001 — cinco fallos de la conversacion privada

Estado: **`done` — Claude, 2026-09-02. Sin commit al abrir este bloque.**
Queda `LA-037`, que es probarlo y ajustar el tono: trabajo de Daniel.

Salidos de revisar una conversacion real. Cinco sintomas, cinco causas:

1. **El proveedor y los borradores se perdian al cambiar de pestaña.** Vivian en
   estado de `ConversationPanel`, que se desmonta al navegar. De ahi que las
   instrucciones «no se guardasen» —nunca llegaban a enviarse— y que el
   proveedor volviera a Claude. Subidos a `useVault` como `composer`.
2. **El prompt de imagen.** En español (su API exige ingles), describiendo a mas
   de una persona y mencionando fotos: de ahi la segunda mujer y la camara, que
   es la pose `selfie` del proveedor. Corregido en la instruccion y reforzado
   con `negative_prompt_append`. `D-057`.
3. **Imagenes no pedidas.** La instruccion empujaba a usar el bloque sin
   prohibir la iniciativa propia.
4. **Adjuntar no servia de nada.** Se guardaba sin descripcion; ahora hay pie de
   foto, al mismo campo que rellenaria un describidor automatico.
5. **El personaje decia que si a todo.** «No inventes una negativa» leido como
   «no digas que no». `D-056`.

Lo importante de `D-056`, que se pidio explicitamente: **el prompt global abre
la posibilidad y no impone tono.** Cuanto se resiste el personaje pertenece a su
descripcion y a las instrucciones de la conversacion, que son del usuario. Una
prueba fija que el bloque dice «puede» y nunca «debe».

`npm run check` en verde: 122 archivos, 2.127 superadas, 9 omitidas.

**Nada visto en pantalla.** Ver `LA-037`.

---

## BUG-VAULT-CHARACTER-001 — un personaje que la boveda no conoce

Estado: **`done` — Claude, 2026-09-02. Sin commit.** Queda `LA-036`, que es
trabajo de Daniel en la aplicacion, no codigo.

Pedir una foto nueva en una conversacion privada devolvia el JSON crudo de la
API. El identificador del personaje era falso: se creo el personaje el 02/09 a
las 08:50:37 UTC, Luxy no guardo su `character_id` —eso ya se arreglo en su dia—
y despues se dio de alta a mano el UUID que aparece en la ruta del avatar, que
no identifica a nadie.

Recuperado con `GET /v1/generations/036edeab-bbc6-46b5-8047-7f91faf49883`, que
devuelve `character_id` y no cuesta creditos. El bueno es
**`83cc7f03-5eb3-4d03-833f-56dfbe80cd7d`**, modelo `anime-pure-v1`.

Lo que se corrigio en el codigo, que es lo que convirtio un dato equivocado en
un misterio:

1. `xavira.ts` traduce `error.code` a un mensaje y una pista accionables, y
   conserva `code` y `requestId`. El 404 dice ahora que revise el identificador
   **y** la clave, porque la API responde igual para un personaje inventado y
   para uno de otra cuenta, y su documentacion dice que no distingue.
2. `imageBlockReason` (`apps/desktop/src/shared/vault-image-capability.ts`)
   decide si se puede generar. Exige que el personaje este en la boveda, no solo
   que el campo tenga texto. La usan el proceso principal y la pantalla: escrita
   dos veces, una de las dos se queda atras.
3. El alta manual exige el UUID del proveedor. No atrapa un UUID equivocado
   —para eso esta el aviso—, pero si todo lo que se copia de una URL.

`npm run check` en verde: 122 archivos, 2.116 superadas, 9 omitidas.

**No visto en pantalla.** Las pruebas fijan la regla; nadie ha abierto Studio
todavia. Ver `LA-036`.

---

## BUG-GIT-IDENTITY-001 — identidad de Git de respaldo al confirmar un worktree

Estado: **`done` — Claude, 2026-09-01. Sin commit.**

En un Windows sin `user.name`/`user.email`, Luxy inicializaba un proyecto
editable correctamente pero **no podía confirmar el trabajo del modelo**:
`ensureGitRepository` ya inyectaba una identidad de respaldo para su commit
`estado inicial` y `commitWorktree`, en el mismo archivo, no inyectaba ninguna.

Arreglado en `apps/agent/src/git.ts` con `FALLBACK_IDENTITY_ARGS` y
`hasCommitIdentity()`. El respaldo entra **sólo** cuando el equipo no tiene
identidad: un commit de trabajo conserva la autoría real del usuario cuando
existe. Dos pruebas nuevas cubren los dos lados.

`npm run check` → exit 0; 96 archivos, 1.653 superadas, 14 omitidas.
Evidencia en `CHANGELOG-WORK.md` y `TEST-RESULTS.md` del 2026-09-01.

Queda `LA-030`: la identidad global de este ordenador sigue sin configurar.
Luxy ya no depende de ella; los commits manuales de Daniel sí.

---

## Discrepancias encontradas al abrir la sesión del 2026-09-01

1. Este ordenador (`C:\Users\oscar\Desktop\Daniel\Luxy`) es un clon nuevo **sin
   `node_modules`**. La línea canónica que describe `PROJECT-STATE.md` es
   `C:\Users\daniel\Desktop\Luxy`. Ver `docs/ARRANQUE-ORDENADOR-NUEVO.md`.
2. El «siguiente paso exacto» de `F4.9-DYNAMIC-HTTP-PROVIDERS` decía integrar el
   commit local en `main`. **Ya está integrado**: `main` @ `00a9cc1` *es* ese
   commit. `LA-029` (publicar y validar) sigue abierta; la integración no.

---

## F9-VAULT-001 — conversaciones privadas cifradas y sincronizadas

Estado: **en curso, punto de retoma del 2026-09-02.** Rama aislada
`luxy/f9-1-vault-crypto` sobre `main` @ `00a9cc1`. El remoto y `HEAD` coincidían
en `296fe9a` al abrir `F9.29`; este subpaso queda sin commit. `npm run check`
verde: 120 archivos, 2.093 pruebas superadas, 9 omitidas.

**La infraestructura ya no es teórica.** En la sesión del 2026-09-02 se ejecutó
por primera vez contra los servicios reales:

| pieza | estado real |
| --- | --- |
| migración `0007` | **aplicada**; las cinco tablas `vault_*` con `rowsecurity = true` |
| migración `0008` | **aplicada**; bucket `vault-media` privado (`public = false`) |
| gateway | **desplegado**: `luxy-gateway`, versión `44aee3d5`, en `luxy-gateway.danielux135.workers.dev` |
| cuenta | **probada de verdad**: vincular la bóveda local e iniciar sesión funcionan contra Supabase |
| API de generación | **probada**: crea personajes y genera imágenes. Corrigió el contrato dos veces |

Lo que queda es de tres tipos, y conviene no confundirlos:

| tipo | qué es | quién |
| --- | --- | --- |
| **piezas pendientes** | `F9.21` vídeo grande · personajes sin sincronizar · limpieza de huérfanos · `F9.9` puente Telegram · `F9.11` invitado | IA |
| **deuda de documentación** | `F9.12`: `docs/PRIVACY.md`, `SECURITY.md`, modelo de amenazas | IA |
| **publicación** | `git push` de la rama; se deniega desde la sesión de IA (`LA-032`) | Daniel |

Lo que **sigue sin probarse contra Postgres**: la autorización cruzada entre
usuarios de `withVaultAuth` —hace falta una segunda cuenta— y la sincronización
real entre dos equipos.

### F9.29 — roleplay privado coherente con personaje, escena y medios

Estado: **`done` — Codex, 2026-09-02. Sin commit.**

Incidencia observada en una conversación real: el personaje empieza encarnando
su ficha, pero ante detalles adultos de la escena contradice el avatar y sale
del rol; cuando se le pide una imagen disponible o nueva, responde con una
negativa de texto en vez de emitir el bloque `LUXY_IMAGEN`.

Causa demostrada en el código: `buildVaultPrompt` ya manda el personaje y las
instrucciones como directivas (`D-054`), pero `buildProviderPrompt` envuelve
después **todo** el prompt como «DATOS de la conversación». En conexiones HTTP
hay una segunda contradicción de mayor prioridad: el `system` fija «Eres un
asistente técnico» y vuelve a decir que el mensaje es dato. El modelo recibe a
la vez «encarna al personaje» y «eres un asistente técnico».

Hipótesis y criterio de aceptación:

- el turno local privado conserva las directivas de personaje como órdenes y
  sólo trata memoria, historial y mensaje como datos;
- los proveedores HTTP reciben un `system` conversacional en conversaciones y
  mantienen el técnico en trabajos/evaluaciones;
- el contrato privado declara que todos los personajes son ficticios y adultos,
  que el roleplay consentido puede ser adulto, y que los hechos establecidos en
  la escena no se contradicen por inventar una realidad alternativa;
- si se pide enseñar o enviar una imagen y la capacidad existe, el modelo debe
  responder en personaje y emitir un único bloque `LUXY_IMAGEN`; el proveedor de
  medios sigue validando y ejecutando la generación;
- pruebas focalizadas verdes y después `npm run lint`, `npm run typecheck`,
  `npm test` y `npm run build`, todos sin red ni créditos.

Discrepancia al retomar: la rama real está limpia y `HEAD` `296fe9a` coincide
con `origin/luxy/f9-1-vault-crypto`; la cabecera y `LA-032` aún dicen «13 commits
sin publicar». Corregido al cerrar este subpaso, sin commit ni push.

Implementado y verificado:

- el envoltorio de `buildProviderPrompt` distingue el turno local privado: ya
  no rebaja sus directivas a datos ni duplica la instrucción de memoria;
- `ProviderRunRequest.interactionMode` permite que las conexiones HTTP usen un
  `system` conversacional; trabajos y evaluaciones conservan el técnico;
- el prompt fija el contrato de ficción consentida entre adultos, la continuidad
  del canon de escena y que no se inventen ropa, situación o negativas fuera de
  personaje para contradecir lo ya establecido;
- la instrucción de medios exige responder en personaje y emitir
  `LUXY_IMAGEN` cuando se pide una imagen disponible o nueva;
- primera prueba focalizada: 118 verdes y 1 fallo por una frase ambigua dentro
  de una negación; corregida. Prueba focalizada final: **120/120**;
- `npm run check`: **exit 0 — 120 archivos, 2.093 superadas, 9 omitidas**.

Siguiente paso exacto: `LA-034`, reiniciar Studio con esta compilación y repetir
el diálogo que reprodujo el fallo. Primero reenviar la foto de perfil existente
(sin gastar una generación); generar una nueva sólo si Daniel decide consumir
el crédito. Las pruebas fijan el contrato enviado, pero el comportamiento de un
modelo real sólo se confirma con esa ejecución.

> **PUNTO DE RETOMA — leer esto entero antes de tocar nada.** Debajo, cada paso
> `F9.x` conserva su bloque de cierre como historial; esta cabecera es el estado
> real que prevalece sobre ellos.

### Qué es y qué funciona hoy

Una sección **Privado** en Studio, con bóveda cifrada. Ya funciona de extremo a
extremo **en local**, y Daniel lo confirmó a mano (crear, abrir, cerrar,
conversar, ver el `.jsonl` cifrado):

- crear/abrir/cerrar la bóveda, clave de recuperación, desbloqueo por Windows,
  auto-bloqueo configurable;
- conversaciones privadas: se ejecutan en la máquina local **sin pasar por la
  cola de Supabase** (`run_local_turn`), se cifran y se guardan en
  `%APPDATA%\Luxy\vault\conversations\<uuid>.jsonl`;
- memoria acumulativa: cada turno envía resumen + 8 últimos turnos, no el hilo
  entero;
- adjuntar y **generar** imágenes/vídeo (adaptador de Xavira conectado), cifrado
  en `vault\media\<hex>.bin`.

Añadido después, **con la infraestructura ya desplegada**:

- **cuenta**: crear, entrar, salir, y usar la bóveda sólo en este equipo sin
  cuenta. Un ordenador nuevo funciona sabiendo el correo y la contraseña.
  **Verificado de verdad**: vincular la bóveda local e iniciar sesión funcionan
  contra el gateway y Supabase reales;
- **recuperación**: la clave de recuperación abre desde cualquier ordenador, y
  desde ahí se elige contraseña nueva. Probado sólo con dobles;
- **vincular** una bóveda anterior a las cuentas, sin recifrar su contenido;
- **sincronización** de turnos y de medios entre equipos, autorizada por sesión
  de cuenta. Probada sólo con dobles: falta hacerlo con dos equipos de verdad;
- **personaje de la conversación**: rasgos del enum cerrado del proveedor,
  guardado cifrado en la bóveda con su avatar. **Verificado**: se crean
  personajes y se generan imágenes contra la API real;
- **instrucciones fijas** por conversación, y el modelo **las obedece** como
  órdenes del usuario, no como datos (`D-054`);
- **el modelo puede pedir una imagen** dentro de la conversación: generar una
  nueva —cuesta créditos— o **reenviar** una que ya existe, gratis (`D-051`).

### Lo que la API de generación nos enseñó, y no estaba en su documentación

Es la parte que más veces desmintió lo que suponíamos, y conviene tenerla junta
porque **el contrato se corrigió con lo que la API respondió**, no con lo que
publica:

| lo que suponíamos | lo que resultó |
| --- | --- |
| crear un personaje sólo necesita rasgos | exige **`model_id`**: `realistic-sharp-v1` o `anime-pure-v1`. Los de vídeo no valen |
| los rasgos son texto libre | son un **enum cerrado**: `gender`, `ethnicity`, `ageRange`, `hairLength`, `hairColor`, `build`, y `breastSize`/`assSize` sólo con `gender=female` |
| se puede dar una foto de referencia | **la retiraron**. `reference_image_unsupported`: no existe el campo, y su documentación explica que no aceptan fotos para contenido adulto |
| se pueden listar los personajes | **no hay `GET /v1/characters`**. Sólo crear, `PATCH` y sondear |
| el `character_id` se puede recuperar | `GET /v1/generations/:id` devuelve estado, URL y coste, **no el personaje**. Un identificador que no guarde Luxy se pierde |

Dos hallazgos útiles que sí estaban en su documentación, en `xavira.ai/docs`
—no en `api.xavira.ai/docs`, que da 404—:

- **`PATCH /v1/characters/:id`** cambia los rasgos **sin crear otro personaje**:
  el avatar y la cara no se tocan. Evita pagar una creación por un ajuste. **No
  está conectado en Luxy**;
- el proveedor **ya inyecta los rasgos del personaje en cada generación**
  («identity anchor»), por eso las imágenes salen coherentes con prompts cortos;
- crear un personaje **renderiza su avatar y cuesta un crédito**; tarda 8–16 s y
  la API corta a 26. El tope del adaptador son 120 s, así que el modo asíncrono
  no hace falta.

### Lo que falta, con nombre y tamaño

Ordenado por lo que más se nota al usarlo:

1. **Los personajes no se sincronizan.** Viven en `vault/characters.json`,
   cifrados, **sólo en este equipo**. Los de un portátil no aparecen en el de
   sobremesa, y como la API no sabe listarlos, en el otro equipo habría que
   darlos de alta a mano. Es la pieza que más se va a notar en cuanto se use un
   segundo ordenador.
2. **`PATCH /v1/characters/:id` no está conectado.** Permite cambiar los rasgos
   de un personaje sin crear otro —sin pagar otra creación— y hoy no hay forma
   de hacerlo desde Luxy: la única salida es crear uno nuevo.
3. **`F9.21` — vídeo grande sin previsualizar.** Se genera y se guarda cifrado,
   pero el tope de 20 MB del IPC impide verlo. Falta un protocolo de Electron
   que sirva el flujo descifrado. Ojo: **sincronizar y previsualizar tienen
   topes distintos** — 90 MB para viajar, 20 MB para verlo.
4. **Un archivo de más de 90 MB no se sincroniza.** Se salta, se cuenta y la
   interfaz lo dice; se queda en el equipo donde se creó. Es el límite del
   cuerpo de una petición a un Worker (`D-050`).
5. **Los objetos huérfanos no se limpian.** Borrar una conversación borra sus
   filas en cascada, pero los bytes se quedan en el almacén. No rompen nada y no
   son legibles; falta una limpieza.
6. **Sin streaming** (`D-043`). Cada respuesta aparece entera al terminar. Es
   deliberado, no un olvido: cambiarlo sería revisar la decisión, no completar
   un paso.
7. **`F9.12` — documentación de privacidad.** `docs/PRIVACY.md`, `SECURITY.md` y
   el modelo de amenazas siguen sin escribirse. Es la deuda que más cara sale a
   quien llegue nuevo.
8. **`F9.9`** (puente de Telegram por conversación) y **`F9.11`** (invitar a un
   tercero) siguen sin empezar. Ya no están bloqueados por `D-001`: lo matizó
   `D-045`.
9. **La autorización cruzada entre usuarios sigue sin probarse con Postgres
   delante.** `withVaultAuth` filtra por el usuario de la sesión y las pruebas lo
   cubren con dobles, pero hace falta **una segunda cuenta real** para
   confirmarlo. Es lo único de seguridad del bloque que no se puede dar por
   verificado.
10. **La sincronización entre dos equipos no se ha hecho nunca de verdad.** El
    código está probado con dobles y la infraestructura desplegada; falta
    ejecutarlo con dos ordenadores.

### Arquitectura de claves (la que hay que respetar)

```
contraseña ──Argon2id(sal)──► llave maestra (256b, sólo en RAM del main)
                                ├── HKDF ─────────────► subclaves de cifrado (por dominio y objeto)
                                ├── HKDF ─────────────► vault_id (identificador público)
                                └── Argon2id(2ª vuelta)► hash de acceso (lo ÚNICO que autentica en servidor)
```

`ARGON2_PARAMS`: t=3, m=64 MiB, p=1 (~2,7 s medidos; ver `D-040`). Guardados por
envoltura y por cuenta, nunca leídos de la constante al abrir.

La misma llave maestra tiene **dos puertas** en el servidor, con sal, coste,
propósito y hash de acceso propios: la contraseña y la clave de recuperación.
La segunda usa `RECOVERY_ARGON2_PARAMS` (t=1, m=8 MiB) porque no es una
contraseña sino ~157 bits al azar, y encarecer cada intento no compra nada sin
diccionario que probar (`D-049`).

### El estado que NO es intuitivo, y es lo primero a entender

Hasta `F9.18` había **dos orígenes de la misma llave maestra sin unir**. **Ya
están unidos** (`D-047`), y así es como funciona ahora:

- la **cuenta es el origen**. Crear una cuenta genera la llave aquí; entrar en
  ella la trae envuelta del servidor y la abre la contraseña. `vaultId` y
  subclaves salen iguales por los dos caminos, y una prueba lo comprueba
  comparando dos equipos;
- el archivo local `vault.json` es la **caché** de esa llave: la misma, envuelta
  con la misma contraseña, para arrancar sin red. Ya no es una segunda bóveda;
- `VaultService.adoptAccountKey()` es el **único** punto por donde una llave de
  fuera entra en la bóveda. La llave maestra sigue sin salir nunca: lo que sale
  son sobres y hashes construidos con ella dentro;
- una bóveda **sin cuenta** sigue siendo válida —es la que tiene Daniel hoy— y
  se puede **vincular** después sin recifrar nada, con la contraseña que ya la
  abre;
- un equipo guarda la bóveda de **una sola cuenta**. Registrar o entrar con otra
  se corta antes de llamar al servidor.

Lo que sigue sin ejecutarse: **nada de esto ha hablado con Supabase ni con el
gateway real**. Ver el punto 2 de la lista de abajo.

### Estado por paso

| paso | qué es | estado |
| --- | --- | --- |
| F9.1 | `packages/vault-crypto` | done, verificado |
| F9.2 | esquemas `vault.ts` | done |
| F9.3 | `VaultService` (vault local) | done, confirmado a mano |
| F9.4 | cifrado en cliente (`private-store`) | done |
| F9.5 | `run_local_turn` sin cola | done |
| F9.6 | migración `0007` | **rehecha con usuarios; NO aplicada** |
| F9.7 | sincronización | done la lógica; ver aviso |
| F9.8 | higiene de logs/cachés/devtools | done |
| F9.13 | interfaz de la bóveda | done, confirmado a mano |
| F9.14 | conversaciones e2e | done, confirmado a mano |
| F9.16 | almacén de medios (local) | done; remoto no existe |
| F9.17 | adaptador Xavira + generación | implemented; **sin llamada real** |
| memoria | memoria acumulativa | done |
| F9.10 | cuentas de usuario | **implemented (3 capas de lógica); sin ejecución real** |
| F9.18 | interfaz de cuenta y unión de los dos orígenes de la llave | done; sin ejecución real |
| F9.19 | recuperación desde un equipo nuevo | done; sin ejecución real |
| F9.20 | instrucciones fijas por conversación | done |
| F9.16 remoto | los medios viajan entre equipos | done |
| F9.22 | el modelo pide una imagen y se genera sola | done; sin llamada real |
| F9.23 | imagen de referencia del personaje | done; sin llamada real |
| F9.9 | puente Telegram por conversación | planned |
| F9.11 | transportes del invitado | planned |
| F9.12 | documentación de privacidad | planned |

### Lo que hay que tener en cuenta, sin suavizar

1. **`0007` y `0008` están aplicadas, y el gateway desplegado** (2026-09-02).
   Las cinco tablas `vault_*` con `rowsecurity = true` y el bucket `vault-media`
   con `public = false`. **A partir de aquí no se tocan**: cualquier cambio de
   esquema va en una migración nueva.

   Que el gateway apunta al mismo proyecto **está confirmado**, y así se hizo:
   `POST /api/vault/login/start` con un correo inexistente devolvió 200 con la
   respuesta señuelo. Eso prueba tres cosas a la vez —la ruta existe, la consulta
   a `vault_users` funcionó y el código de `F9.19` está vivo—, porque si la tabla
   no estuviera en ese proyecto, `getVaultUserByEmail` habría lanzado un 500. Es
   la forma barata de comprobar la trampa 3 de
   `docs/ARRANQUE-ORDENADOR-NUEVO.md` sin crear ninguna cuenta.
2. **Nada del gateway ni de las cuentas se ha ejecutado contra Supabase real.**
   Todo son mocks: gateway falso, cliente falso. Incluida la autorización cruzada
   entre usuarios de `withVaultAuth`, que sólo se confirma con Postgres delante.
3. **Las rutas `/api/vault/*` no están desplegadas.** Existen en el código; falta
   `wrangler deploy` (acción de Daniel, con autorización). Hasta entonces
   sincronizar contra el gateway real falla.
4. **La generación de Xavira nunca ha llamado a la API real.** El contrato viene
   de su documentación pública. La primera llamada de verdad puede desmentir
   nombres de campo o formato de error. La clave va en `SecretStore` como
   `VAULT_MEDIA_API_KEY` (reservada). **Se pone en Privado, no en Conexiones**:
   el formulario de Conexiones rechaza los nombres reservados por diseño, así
   que durante un tiempo esta clave no se pudo configurar desde ningún sitio.
5. **La sincronización ya se autentica con la sesión de cuenta** (`D-048`), y el
   `vaultId` dejó de viajar. Lo que queda de esto: la sesión **caduca** (30 días)
   y entonces sincronizar deja de funcionar hasta volver a entrar, aunque la
   bóveda se siga abriendo sin conexión. La interfaz lo distingue; no se ha
   probado con un gateway real devolviendo un 401 de verdad.
6. **Vídeo grande**: se genera y guarda, pero no se previsualiza (tope de 20 MB
   del IPC). Falta un protocolo de Electron que sirva el flujo descifrado.
7. **Medios no se sincronizan**: sólo turnos. El almacén remoto (`F9.16` remoto,
   p.ej. R2) no existe.
8. **Sin streaming** en conversaciones privadas (`D-043`), a propósito.
9. **`git config --global` de este equipo sigue sin configurar** (`LA-030`).
10. **La clave de recuperación ya abre desde cualquier ordenador** (`F9.19`).
    Lo que hay que saber de ella: entrar con la clave deja el equipo **sin
    envoltura de contraseña** hasta que se elija una nueva, y vincular una
    bóveda anterior a las cuentas **genera una clave nueva** que invalida la
    anterior. Las dos cosas las dice la interfaz.
11. **Un equipo guarda la bóveda de UNA cuenta.** Registrar o entrar con otra se
    rechaza antes de llamar al servidor: pisar `vault.json` dejaría ilegible, sin
    aviso, todo lo cifrado con la llave anterior. Para cambiar de cuenta en un
    equipo hay que borrar esa bóveda a mano; **no hay botón para eso**, y es un
    hueco conocido.
12. **Salir de la cuenta no borra nada.** Cierra la bóveda y olvida la sesión; lo
    cifrado se queda en el equipo y vuelve a abrirse con la misma contraseña.
13. **El token de sesión vive en `SecretStore`** como `VAULT_ACCOUNT_SESSION`
    (reservado, DPAPI) y **no cruza el IPC**. Una prueba enumera las claves del
    estado que ve el renderer para que no se cuele.
14. **`changePassword` de una bóveda de cuenta no se puede hacer sólo en local**:
    `VaultService` lo rechaza. Primero el servidor, después la envoltura local; al
    revés, un fallo de red dejaría este equipo con una contraseña que ningún otro
    reconoce.
15. **Las instrucciones fijas viven dentro del sobre del turno**, no en un campo
    del registro (`F9.20`). Consecuencia práctica: cambiarlas escribe un turno
    nuevo, y los turnos anteriores conservan las suyas. Es lo que hace que el
    historial no mienta sobre qué las gobernaba.
16. **La foto de perfil de un personaje es una COPIA en la conversación.** El
    avatar vive en la ficha del personaje; la primera vez que se usa en una
    conversación se copia ahí cifrado, marcado con su `characterId`. Sin esa
    copia, «pásame tu foto» no tenía nada que reenviar, porque la lista de
    imágenes reenviables sale de los medios de la conversación.
17. **Una conexión NO es sólo para descubrir modelos.** El agente registra **un
    proveedor por familia** apuntando a ese endpoint (`deepseek`, `glm`, `kimi`,
    `qwen`…), y esos proveedores ejecutan turnos. La lista buena es la que el
    agente anuncia en su estado, no la que se deduce de `providers.http`:
    deducirla dejaba fuera todo lo que sirve una pasarela.
18. **Los modelos de una conexión no se consultan solos.** Hay que pulsar
    «Actualizar modelos» en Modelos → «Catálogo real de la conexión» una vez.
    Hasta entonces dice «Sin consultar todavía», que se lee como si no hubiera.
19. **La clave del proveedor de imágenes se pone en Privado, no en Conexiones.**
    Es un secreto reservado y el formulario de Conexiones lo rechaza por diseño;
    durante un tiempo no se pudo configurar desde ningún sitio.
20. Límites de diseño que van a `docs/PRIVACY.md` (`F9.12`, pendiente): el
    proveedor de IA ve el prompt en claro —la bóveda protege el almacenamiento y
    el transporte propio de Luxy, no lo que un tercero recibe porque el usuario
    decide enviárselo—; Telegram no puede leer ciphertext; DPAPI no protege de
    otro proceso de la misma cuenta; una filtración de la BD entrega N llaves
    envueltas y la contraseña más débil de la organización es el objetivo; quien
    tenga una clave de recuperación abre esa bóveda desde cualquier sitio; el
    servidor no puede restablecer una contraseña; revocar un permiso no recupera
    lo ya descifrado; la separación real entre dos usuarios aún no se ha probado
    con una segunda cuenta.

### Decisiones que rigen este bloque

`D-039` (contraseña envuelve, no cifra) · `D-040` (coste Argon2 medido) · `D-041`
(propósito autenticado) · `D-042` (sondeo, nunca callback) · `D-043` (sin
streaming) · `D-044` (relleno de longitud) · `D-045` (multiusuario, matiza
`D-001`) · `D-046` (auth y cifrado por caminos separados) · `D-047` (la cuenta
es el origen de la llave; el archivo local es su caché) · `D-048` (sincronizar
autoriza por sesión de cuenta) · `D-049` (la clave de recuperación no se trata
como una contraseña) · `D-050` (los bytes de los medios van a Supabase Storage) ·
`D-051` (el modelo pide la imagen con un bloque, no con una herramienta) ·
`D-052` (revertida: la API retiró la imagen de referencia) · `D-053` (personaje
por enum cerrado) · `D-054` (las instrucciones del usuario son órdenes) ·
`D-055` (una conversación privada no hereda la identidad técnica del ejecutor).

### Siguiente paso exacto (para quien retome)

`LA-031` está **hecha**: migraciones aplicadas, gateway desplegado, clave del
proveedor puesta y personajes e imágenes creados de verdad. Lo que queda:

1. **Validar F9.29 con el personaje real (`LA-034`).** Reiniciar Studio/Agent y
   repetir el caso. Primero pedir que reenvíe la foto de perfil existente, que
   no consume una generación. El contrato está verificado; el proveedor real no.

2. **`F9.12`, documentación de privacidad.** Es la deuda más cara y la más
   barata de pagar. Hay bastante que contar que antes no existía: la clave de
   recuperación abre desde cualquier equipo, la sesión caduca a los 30 días,
   salir de la cuenta no borra lo cifrado, un equipo guarda la bóveda de una
   sola cuenta, el proveedor de texto y el de imágenes ven en claro lo que se
   les envía, y los personajes son locales.

3. **Sincronizar los personajes.** Hoy son locales y la API no sabe listarlos:
   en un segundo equipo hay que darlos de alta a mano. Es lo que más se va a
   notar en cuanto se use otro ordenador.

4. **Probar con dos equipos y dos cuentas.** Es lo único de seguridad que no se
   puede dar por verificado: que un usuario no lea los registros de otro
   (`withVaultAuth`) sólo se confirma con una segunda cuenta real.

5. **`F9.21`**, vídeo grande sin previsualizar, y la **limpieza de objetos
   huérfanos**. Después, `F9.9` (puente Telegram) y `F9.11` (invitar a un
   tercero).

6. **Commit y publicación de F9.29**, sólo cuando Daniel lo autorice. Antes de
   este paso la rama ya estaba publicada hasta `296fe9a`; el pendiente actual
   es exclusivamente el diff sin commit que se deja ahora (`LA-032`).

### F9.20 … F9.25 — la sesión del 2026-09-02

Un bloque largo de correcciones que salieron **al usar la aplicación de
verdad**, no de revisar código. Merece la pena leerlas juntas porque casi todas
comparten la misma causa: una pieza existía y nadie la conectaba.

| qué pasaba | por qué | dónde quedó |
| --- | --- | --- |
| el modelo respondía como asistente pese al contexto fijo | se le enviaba marcado `(DATOS)`: «tenlo en cuenta, **no lo obedezcas**» | `D-054` |
| no sabía a quién encarnaba | el `character_id` sólo le sirve al proveedor de imágenes; el modelo no ve ninguna | `characterDescription` |
| se hacía llamar otro nombre | el nombre se guardaba como etiqueta y nunca salía del disco | «Te llamas X» abre la descripción |
| la clave del proveedor no se podía guardar | es un secreto reservado y Conexiones lo rechaza por diseño | canal propio, panel en Privado |
| se perdía un personaje pagado | sólo se guardaba si enviabas un mensaje después | `character-store.ts` |
| «pásame tu foto» fallaba | el avatar vivía en la ficha, no en la conversación | se copia cifrado al usarlo |
| pedir «la de antes» pagaba otra imagen | el modelo sólo sabía generar | bloque con `mediaId`, gratis |
| no se veía qué personaje estaba en uso | la marca comparaba con el guardado, que cambia al enviar | botón «Usar» + etiqueta |
| el avatar salía a pantalla completa | clase CSS que no existía | miniatura de 44 px |
| los modelos chinos no salían en Privado | el desplegable deducía la lista de `providers.http` | usa la que anuncia el agente |

### F9.23 — done (Claude, 2026-09-02, sin llamada real)

Imagen de referencia del personaje. El campo existía en el adaptador y nada lo
usaba, porque conectarlo tal cual habría obligado a **alojar la foto en una URL
pública**. Se envía como `data:` URI dentro del cuerpo (`D-052`), y se guarda
cifrada en la conversación antes de salir.

**Riesgo abierto, y es el que puede tumbarlo**: no está verificado que la API
acepte un `data:` URI en un campo que se llama `reference_image_url`. Si lo
rechaza, la alternativa es publicar la imagen —lo que Daniel llamó «opción 2»—
o un endpoint de subida, si existe.

### F9.22 — done (Claude, 2026-09-02, sin llamada real)

El flujo que faltaba: **pedirle una imagen al personaje dentro de la
conversación y recibirla**. No funcionaba, y no por la clave — la conversación y
la generación eran dos cosas desconectadas y nadie escuchaba al modelo.

Ahora el modelo la pide con un bloque estructurado al final de su respuesta
—mismo patrón que la memoria— y el proceso principal la genera, la cifra y la
guarda en la conversación (`D-051`). El personaje pertenece a la conversación,
como las instrucciones. La herramienta **sólo se ofrece cuando existe de
verdad**: sin personaje o sin clave, la instrucción ni se envía.

Lo que hay que saber al probarlo: si el modelo no escribe el bloque o lo escribe
mal, **no hay imagen y el turno sigue siendo válido**. Es el mismo límite que ya
tiene la memoria.

`npm run check` exit 0: 119 archivos, 2.060 superadas, 9 omitidas.

### F9.20 y F9.16 remoto — done (Claude, 2026-09-01, sin commit)

**Instrucciones fijas por conversación.** Se escriben en la propia conversación,
acompañan a cada turno y se guardan cifradas **dentro del sobre del turno**, no
en un campo del registro: así el historial conserva cuáles regían cada respuesta,
y —lo que decidió el cómo— no hacía falta una columna nueva en `vault_records`,
que era imposible porque `0007` se estaba aplicando en ese momento.

**Los medios ya se sincronizan** (`D-050`). Los bytes van a un bucket privado de
Supabase Storage, que crea la migración `0008`. Suben antes que el registro, y
el gateway rechaza un registro cuyos bytes no estén: al revés, el otro equipo
vería un archivo que no puede abrir. Lo que pasa de 90 MB se salta y se cuenta.

**Rasgos del personaje**: el botón mandaba `{}`; ahora hay dónde escribirlos.

`npm run check` exit 0: 118 archivos, 2.046 superadas, 9 omitidas.

### F9.19 — done (Claude, 2026-09-01, sin commit)

La clave de recuperación abre la bóveda **desde cualquier ordenador**, no sólo
desde el que la creó. El servidor guarda una segunda copia de la llave maestra
cerrada con ella, con propósito y hash de acceso propios, y tampoco puede
abrirla. Detalle en `CHANGELOG-WORK.md` y `D-049`.

Tres consecuencias que la interfaz dice y conviene no olvidar:

- entrar con la clave deja este equipo **sin envoltura de contraseña** —no se
  conoce— hasta que se elija una nueva. El formulario aparece ya desplegado, y
  la prueba que pide es la clave, no la contraseña olvidada;
- **cambiar la contraseña no invalida la clave de recuperación.** El papel del
  cajón sigue valiendo;
- **vincular** una bóveda anterior a las cuentas genera una clave **nueva** y la
  anterior deja de valer.

`npm run check` exit 0: 117 archivos, 2.030 superadas, 9 omitidas.

### F9.18 — done (Claude, 2026-09-01, sin commit)

La avería que impedía usar la bóveda en un segundo ordenador, cerrada. Detalle
completo en `CHANGELOG-WORK.md`; lo esencial:

- **`AccountPanel`** en `Vault.tsx` es la puerta cuando el equipo no tiene
  bóveda: crear cuenta / entrar, y «usar sólo en este equipo» para quien no
  quiera cuenta. **`AccountSection`**, con la bóveda abierta, enseña la cuenta,
  deja salir y ofrece **vincular** una bóveda local anterior.
- **`VaultAccountManager`** (`vault/account-manager.ts`) es el cable: pide la
  llave al cliente de cuentas, se la entrega a `VaultService` y no conserva
  copia. Guarda la sesión en el almacén cifrado (`VAULT_ACCOUNT_SESSION`) y no
  la deja cruzar el IPC.
- **`sync.ts`** se autentica con el token de sesión; el `vaultId` dejó de viajar.
- De paso: la clave de recuperación que devolvía `createAccount` **no envolvía
  nada**; ahora envuelve la copia local. Que no abra desde un equipo nuevo es la
  limitación que queda como `F9.19`.

`npm run check` exit 0: 117 archivos, 2.015 superadas, 9 omitidas. Nada
ejecutado contra Supabase ni contra el gateway real, y no confirmado a mano en
Studio.

### F9.1 — done (Claude, 2026-09-01, sin commit)

`packages/vault-crypto`, puro y sin dependencias nuevas. Sobre AES-256-GCM con
propósito y versión autenticados; Argon2id sólo para la contraseña y HKDF para
las subclaves; llave maestra con tres envolturas independientes (contraseña,
recuperación, equipo); envoltura X25519 con clave efímera para compartir una
conversación sin entregar el resto.

71 pruebas propias. `npm run check` exit 0: 99 archivos, 1.729 superadas, 9
omitidas. Decisiones `D-039`, `D-040`, `D-041`.

Dos correcciones hechas en el código, no en las pruebas: `randomBytes()` sobre
el tope de 65.536 bytes de `crypto.getRandomValues`, y el coste de Argon2 bajado
de 256 MiB (13 s medidos por desbloqueo) a la segunda opción recomendada por
RFC 9106.

### F9.2 — done (Claude, 2026-09-01)

`packages/shared/src/vault.ts`: la forma de lo que viaja cifrado, separada de la
criptografía. Nivel `cloud` | `private` sin estado intermedio, lista cerrada de
propósitos, registro privado **sin ningún campo donde quepa texto en claro**,
medio con clave de objeto opaca, puente de Telegram apagado por defecto,
invitaciones y permisos por conversación.

`findPlaintextLeaks()` / `assertNoPlaintextLeak()` convierten en código
ejecutable la regla de que una conversación privada no envía contenido en claro,
y la ejecutan los dos lados. Exime los valores que ya son un sobre válido.

35 pruebas. `npm run check` exit 0: 100 archivos, 1.764 superadas.

### Xavira — API verificada en su documentación pública

`GET /v1/generations/:id` permite **polling**, y el callback es opcional. Luxy
no necesita exponer ningún endpoint público: el agente pregunta y descarga
directo, y el Gateway no ve el resultado. Sin esto, la premisa de `F9` no se
sostendría para vídeo. Detalle en `CHANGELOG-WORK.md`.

### F9.3 — done (Claude, 2026-09-01)

`VaultService` en el proceso principal. La llave maestra sólo vive en su
memoria; lo único que sale es `subkeyFor(dominio, contexto)`, y sólo dentro del
main. `status()` es lo único que cruza el IPC, y una prueba enumera sus claves
para verificar que no lleva material criptográfico.

El bloqueo automático se comprueba por reloj y no con un temporizador, porque un
temporizador no se entera de que el equipo estuvo suspendido. Cambiar la
contraseña exige la actual aunque la bóveda esté abierta.

Cerrada de paso una brecha: el renderer podía fijar cualquier secreto cuyo
nombre apareciese como `apiKeyEnv`, así que bastaba declarar un proveedor
llamado `VAULT_DEVICE_KEY` para pisar la llave del equipo. Añadido
`RESERVED_SECRET_NAMES`.

38 pruebas. `npm run check` exit 0: 101 archivos, 1.802 superadas.

**Pendiente de F9.3**: los canales IPC existen y están validados, pero **ninguna
pantalla los usa todavía**. La bóveda no es visible ni usable desde Studio.

### F9.4 — done (Claude, 2026-09-01)

`private-store.ts` es la frontera por la que sale todo lo privado: contenido en
claro entra, registros que el gateway puede almacenar salen. `sealTurn` y
`sealMedia` pasan por `assertNoPlaintextLeak()` como último paso, así que el
guardián ya no es una regla escrita sino una que se ejecuta.

Dentro del cifrado: texto, título, proveedor, modelo, tokens, `mimeType`,
nombre, prompt, `characterId`, dimensiones y duración. Fuera, como metadato
asumido: que existe un registro, de qué conversación, su orden, cuándo y cuánto
ocupa.

Sobre binario nuevo (`sealBlob`) para imágenes y vídeo: coste fijo de 29 bytes
en vez del 33% que añadiría base64. Miniaturas cifradas con su propia subclave.
Claves de objeto aleatorias, nunca derivadas del contenido ni del nombre.

31 pruebas nuevas. `npm run check` exit 0: 103 archivos, 1.833 superadas.

**Pendiente**: esto sella y abre, pero **todavía no sube nada**. No hay cliente
de almacén de objetos, ni endpoints en el gateway, ni migración.

### F9.5 — done (Claude, 2026-09-01)

Un turno privado ya se ejecuta en la máquina local sin tocar la cola de
Supabase. En vez de escribir un segundo ejecutor, se construye un trabajo
sintético y se pasa por `runJob`, marcado como conversación: esa etiqueta ya
activa el camino de sólo lectura, así que un turno privado hereda la garantía
de no tocar archivos en vez de reimplementarla.

El aislamiento se consigue **no dando** las tres piezas que hablan con el
gateway: los eventos van a quien llama y no a la `EventQueue`, el resultado se
devuelve y no se persiste, y `downloadAttachment` lanza
`LocalTurnIsolationError` en vez de llamar. La prueba que lo sostiene espía
`globalThis.fetch` durante un turno completo y verifica **cero llamadas**.

Lo que se pierde, y está escrito en el propio archivo: no hay lease, no hay
reintento tras un corte y no hay historial en el servidor. Si Luxy se cierra a
media respuesta, esa respuesta se pierde.

12 pruebas. `npm run check` exit 0: 104 archivos, 1.845 superadas.

**Pendiente**: `runLocalTurn` exige el agente en marcha. El proceso principal
todavía **no envía** estas peticiones: el canal existe y el host lo atiende,
pero nadie lo llama aún.

### Corrección del plan — 2026-09-01

Daniel preguntó si el hueco de interfaz que yo repetía al cerrar cada paso
estaba planeado. **No lo estaba**, y no faltaba una fila: faltaban las cuatro
capas que consumen la bóveda. Añadidos `F9.13`–`F9.17` en `MASTER-PLAN.md`
con su causa y el camino crítico. Los IDs cerrados no se renumeran.

El camino hasta la primera imagen privada **no es el orden numérico**:
`F9.13` → `F9.14` → `F9.17` da una imagen privada guardada sólo en local;
`F9.6` → `F9.15` → `F9.16` añade la sincronización entre equipos.

Daniel eligió `F9.13`.

### F9.13 — done, confirmado a mano (2026-09-01)

Sección **Privado** en Studio: crear, abrir, cerrar y ajustar la bóveda. Con la
bóveda cerrada no se muestra nada de su contenido, y el indicador de la barra
es un punto y nunca un recuento, porque un número ya diría cuántas hay.
Daniel lo vio funcionando.

Después, a raíz de sus preguntas: el cierre automático pasa a ser configurable
(1, 5, 15, 30, 60, 240 minutos o nunca) porque los 5 minutos eran una constante
que elegí yo; y la pantalla avisa de que «recordar en este equipo» y «cerrar
sola» se contradicen, cosa que antes callaba.

### F9.14 — done, confirmado a mano (2026-09-01)

Conversaciones privadas de extremo a extremo. Escribes, el agente responde sin
pasar por la cola, y todo queda cifrado en `vault/conversations/<uuid>.jsonl`.

Daniel pegó el archivo real: sin texto, sin título, sin proveedor, sin modelo, y
los cuatro nonces distintos. **Pero al medirlo apareció una fuga**: AES-GCM no
rellena, así que el tamaño del sobre revelaba el del mensaje y con eso se
reconstruía la forma de la conversación. Añadido `padding.ts`: el texto se
rellena a múltiplos de 256 bytes, con marca `LXP1` para que lo guardado antes
se siga abriendo.

Precio asumido y documentado: **no hay streaming** en una conversación privada.

### F9.8 — done (2026-09-01)

Era la condición dura antes de usar la bóveda con contenido real, y ya está
levantada. La fuga grave: `devTools` no estaba configurado y su valor por
defecto es `true`, así que con la bóveda abierta cualquiera podía pulsar
Ctrl+Shift+I en la aplicación instalada y leer las conversaciones descifradas
**sin la contraseña**. Además: volcados de fallo redirigidos y nunca enviados, y
una prueba que fija que un turno privado no dispara notificaciones.

### F9.17 — implemented, sin verificar contra la API real (2026-09-01)

Adaptador de generación de imagen y vídeo. Usa **sondeo y no `callback_url`**,
aunque la API lo ofrezca: un callback exigiría una URL pública y el contenido
pasaría por el gateway. Hay prueba de que la petición nunca lo incluye.

Una prueba encontró que `redact()` no tapaba la clave de API, porque llega por
parámetro sin pasar por el registro de secretos: añadido `stripKey()`.

**No se ha llamado a la API real ni una vez**, y el adaptador **no está
cableado**: ninguna parte de Luxy lo llama. Por eso no está en `done`.

### Estado real a 2026-09-01

Hecho y confirmado a mano: `F9.0`–`F9.5`, `F9.8`, `F9.13`, `F9.14`.
Hecho sin verificar contra el exterior: `F9.17`.
Pendiente: `F9.6`, `F9.7`, `F9.9`, `F9.12`, `F9.15`, `F9.16`.
Bloqueado por `D-001`: `F9.10`, `F9.11`.

Lo que YA se puede usar: crear la bóveda, abrirla, cerrarla, conversar en
privado y que se guarde cifrado en este equipo.
Lo que NO: sincronizar entre equipos, y generar imágenes o vídeo.

### F9.6 y F9.15 — implemented, sin ejecución real (2026-09-01)

Migración `0007_luxy_vault.sql` y endpoints de sincronización.

El problema de fondo era **de quién es un registro privado**: con sólo el token
de máquina, lo del portátil no se ve desde el sobremesa. Resuelto con
`vault_id`, derivado de la llave maestra con HKDF: dos equipos que abren la
misma bóveda obtienen el mismo valor sin coordinarse, y el servidor lo guarda
sin aprender nada de la llave.

**Límite escrito en la migración**: el `vault_id` agrupa, **no autoriza**. Si
algún día entra `F9.10` (usuarios), hay que revisarlo antes de abrirlo a nadie.

El gateway ejecuta `assertNoPlaintextLeak` sobre cada registro antes de
guardarlo, aunque el escritorio ya lo compruebe: un servidor que confía en que
el cliente hizo los deberes acaba guardando lo que no debe.

**La migración no se ha ejecutado contra ningún Postgres** (riesgo conocido nº3)
y **el escritorio todavía no sincroniza**: los endpoints existen y nadie los
llama.

### F9.16 — implemented en su parte local (2026-09-01)

Daniel pidió cerrar primero el camino de medios. `BlobStore` guarda los bytes
que `sealMedia` ya devolvió cifrados, y `PrivateMediaStore` une el registro con
los archivos.

`blob-store.ts` **no cifra**: si lo hiciera, habría dos sitios decidiendo cómo
se protege un archivo y acabarían discrepando.

Orden de escritura: bytes primero, registro después. Si falla a medias queda un
huérfano recuperable en vez de un registro que apunta a nada.

Todo se guarda como `.bin`, también el vídeo: un `.mp4` junto a un `.png` ya
diría que hay vídeo, y Windows generaría miniaturas de ambos. Nunca se escribe
una copia sin cifrar a disco, ni temporal.

17 pruebas. `npm run check` exit 0: 111 archivos, 1.941 superadas.

**Pendiente en F9.16**: la implementación remota no existe, sólo la local. Y
**nadie llama al almacén todavía**: no hay IPC ni interfaz para adjuntar o ver
un medio.

**Limitación conocida, anotada como trabajo aparte**: devolver los bytes en
memoria vale para una imagen, no para un vídeo de cientos de megas.
Reproducirlo sin escribirlo a disco exigirá un protocolo propio de Electron que
sirva el flujo descifrado.

### Medios conectados a la interfaz — implemented (2026-09-01)

Ya se pueden adjuntar y ver imágenes y vídeos dentro de una conversación
privada. La ruta la elige el usuario en un diálogo nativo del proceso
principal: el renderer no propone ninguna, porque si pudiera tendría una vía
para leer cualquier archivo del equipo a través de Luxy.

Los bytes descifrados **no se guardan en el estado del renderer**: se piden al
abrir y se sueltan al cerrar.

Tope de previsualización de 20 MB. Por encima se devuelve el tipo pero no el
contenido, y la interfaz dice por qué. Un vídeo grande sigue sin poder verse,
pero ahora el límite es **visible** en vez de silencioso.

Borrar una conversación borra primero sus medios.

**Sin confirmación manual**: no se ha adjuntado ni visto un medio real.

Siguiente paso exacto: el cliente de sincronización que use los endpoints de
`F9.15` — subir lo nuevo y bajar lo que falte. O `F9.12`, la documentación de
privacidad, que sigue pendiente y es la que explica todo esto a quien llegue
después.

Actualización 2026-08-31 — corrección SSE: el rechazo de `tool_calls` queda en
`readStream` (solo consulta), no en `consumeStream` compartido. La regresión
ejecuta `write_file` con el bucle agentic y confirma una segunda vuelta final.

## KIMI-K3-RETRY-001 — recuperación de cortes de red

Estado: **`implemented` — Codex, 2026-08-31; validación manual pendiente**

`LUX-SKA7` confirmó un ciclo agentic real: ejecutó `list_files` y `write_file`
en un worktree aislado, y la siguiente vuelta terminó con `fetch failed` tras
quince minutos. La causa demostrada fue que `runAgentic` sólo reintentaba 429.
Ahora reintenta red, 408, 429 y 5xx recuperables sin repetir herramientas ya
terminadas. Siguiente paso: reiniciar Desktop y pulsar **Reintentar trabajo**
en `LUX-SKA7`; sigue experimental hasta que cierre una prueba real.

## OPS-REGISTRATION-001 — alta y arranque de este ordenador

Estado: **`done` — Codex, 2026-08-31**

Objetivo: dejar este perfil de Windows preparado para registrar el agente,
conservar y mostrar la ID que devuelve Gateway, reconstruir y abrir Luxy, y
separar con precisión lo automatizable de lo que exige un secreto de Daniel.

Resultado operativo de cierre:

- la máquina `portatil-oscar` está registrada en Gateway con ID
  `6f34d4b8-5927-43ee-a0d0-360ac54f3c01`;
- `config.json` contiene la configuración no secreta, sin `machineToken`; el
  archivo `secrets.enc` cifrado existe y no se ha leído ni impreso;
- se conservaron una conexión y un proyecto configurados; el secreto temporal
  se retiró del portapapeles tras consumirlo;
- Desktop se reinició retirando `ELECTRON_RUN_AS_NODE` sólo de ese proceso y
  confirmó `agente listo`.

Estado real de partida:

- no existen `%APPDATA%\Luxy\config.json` ni `secrets.enc` para este usuario;
- el Gateway desplegado responde `/health` con `status: ok` y `configured:
  true`;
- no existe `MACHINE_REGISTRATION_SECRET` en el entorno, `.dev.vars` ni otra
  fuente local conocida, por lo que todavía no se puede obtener una UUID ni un
  token válidos;
- el hostname real es `DESKTOP-VM5J5GT`; el nombre sugerido es
  `oscar-desktop-vm5j5gt`;
- Node, npm y Git existen en rutas instaladas pero no están en `PATH`; Claude,
  Codex CLI y `rtk` no aparecen en las ubicaciones habituales;
- el cambio continúa en el worktree aislado
  `luxy/f2-4-conversation-library`, que conserva F2.4-T1 sin commit.

Criterios de aceptación:

1. La ID devuelta por el alta se guarda en `config.json` y se muestra en el
   onboarding sin tratarla como secreto.
2. El token permanece únicamente en `SecretStore` cifrado y el secreto temporal
   de registro se descarta.
3. Luxy se reconstruye y abre en la pantalla correcta para completar el alta.
4. Se documenta exactamente qué debe introducir Daniel y qué comprobar después.
5. Los cambios tienen pruebas y pasan lint, typecheck, suite y build.

Resultado implementado y verificado:

- el onboarding propone `desktop-vm5j5gt` a partir del hostname real;
- la UUID devuelta por Gateway se conserva en `config.json` y aparece tanto en
  el onboarding como en Ajustes;
- el token continúa exclusivamente en `SecretStore` cifrado y el secreto
  temporal se descarta;
- el Gateway público responde correctamente y su URL quedó copiada en el
  portapapeles;
- lint, typecheck, 1.662 pruebas y build completo terminan con exit 0.

Bloqueos externos demostrados:

1. No existe una copia accesible de `MACHINE_REGISTRATION_SECRET`; sin ella el
   Gateway rechaza el alta antes de crear/devolver la UUID.
2. Windows Code Integrity bloquea el `electron.exe` no firmado del worktree con
   eventos 3033/3077 y Policy ID
   `{0283ac0f-fff1-49ae-ada1-8a933130cad6}`. No hay una instalación aprobada de
   Luxy en este equipo.

Reintento del 2026-08-31:

- Gateway sano y configurado; Desktop recompila main/preload, pero Electron
  vuelve a fallar con `spawn UNKNOWN` y nuevos eventos 3033/3077 a las 08:13;
- Wrangler 4.114.0 ya tiene sesión Cloudflare autenticada por Daniel y acceso
  verificado al Worker `luxy-gateway`;
- no hay certificado de firma de código utilizable en el usuario o la máquina;
- el wizard de terminal antiguo no se usa porque guardaría el token en claro en
  `config.json`, contrario al criterio de aceptación 2.
- `CiTool` confirma Smart App Control `VerifiedAndReputableDesktop` en
  enforcement; la base admite suplementos. App Control Wizard 2.8.0.0 ya está
  instalado, pero su primera regla de tipo `Folder Scan` produjo un XML
  suplementario sin `FileRules` ni hashes, por lo que no se desplegó.

Siguiente paso exacto: desde la pantalla principal comprobar visualmente que la
barra de estado muestra el agente conectado y, si hiciera falta, pulsar
**Iniciar agente**. La comprobación de un trabajo real con una API China queda
separada hasta disponer de una clave válida y consentimiento explícito para
consumirla.

---

## BUG-EMPTY-TOOL-CALL-001 — no completar una tarea sin texto ni cambios

Estado: **`done` — Codex, 2026-08-31**

Evidencia real: el trabajo `LUX-A9K9` solicitó Kimi K3 y recibió HTTP 200,
`finish_reason=tool_calls`, 452/2.263 tokens y cero caracteres visibles. El
modelo devolvió llamadas de herramienta, pero `kimi-k3` todavía no declara un
contrato agentic verificado, así que Luxy no ejecutó ninguna; la ruta de solo
texto descartaba esas llamadas y devolvía incorrectamente `completed`.

Corrección: `HttpApiProvider` rechaza cualquier `tool_calls` en una consulta sin
contexto agentic, tanto en SSE como sin streaming. El fallo no se reintenta,
conserva el diagnóstico de transporte y explica que no se ejecutó ninguna
herramienta ni se hicieron cambios. Kimi K3 no recibe herramientas hasta que su
contrato se compruebe de forma explícita.

Validación: reproducción nueva en `providers.test.ts`; lint, typecheck, suite
completa, build y `git diff --check` correctos. El trabajo histórico no se
reescribe porque su estado remoto ya fue cerrado y no hubo archivos que
conservar.

---

## KIMI-K3-EXPERIMENT-001 — verificar ejecución agentic real

Estado: **`abandonado` — cerrado el 2026-09-23 sin evidencia.** Abierto
`in_progress` por Daniel/Codex el 2026-08-31.

> **Por qué se cierra.** En más de tres semanas no hay un solo commit, entrada
> de `CHANGELOG-WORK.md` ni línea de `TEST-RESULTS.md` que lo toque, mientras
> por encima se abrieron y cerraron F22 a F30. `AI-WORK-PROTOCOL.md` §3 prohíbe
> dejar un paso vivo así, y era el único `in_progress` del archivo: hace creer
> que hay trabajo en vuelo y que alguien lo está llevando.
>
> **Qué queda puesto en el código, y hay que saberlo antes de tocarlo:** el
> catálogo habilita Kimi K3 con herramientas nativas y ejecutor confinado al
> worktree, conservando `contractVerified: false` y la nota
> `EXPERIMENTAL_TOOL_CALLING_2026-08-31`. **Eso sigue ahí.** No lo retires sin
> preguntar a Daniel y no lo des por verificado: la evidencia nunca se obtuvo.
>
> Si se retoma, se abre un bloque nuevo. Éste no se reabre.

Daniel pidió probar Kimi K3 después de observar su `tool_calls` real. El
catálogo lo habilita temporalmente con herramientas nativas y ejecutor confinado
al worktree, pero conserva `contractVerified: false` y la nota
`EXPERIMENTAL_TOOL_CALLING_2026-08-31` hasta obtener evidencia completa.

Siguiente paso exacto: crear desde Studio un trabajo nuevo con **Kimi K3** y una
tarea pequeña que escriba un archivo dentro de su worktree. Debe terminar con
una o más herramientas registradas y un diff no vacío; si no, Codex conservará
el fallo y retirará la capacidad experimental.

Actualización 2026-08-31:

- los dos XML creados por App Control Wizard se comprobaron vacíos; no se
  desplegó ninguno;
- el fallo reproducible actual era `ELECTRON_RUN_AS_NODE=1` en el entorno, que
  hacía que Electron arrancase como Node y fallase al importar `BrowserWindow`;
- al retirar esa variable sólo del proceso de desarrollo, Desktop arrancó y el
  onboarding quedó disponible;
- el secreto de registro se rotó con autorización ya concedida, se subió al
  Worker y se dejó sólo en el portapapeles de Windows para este onboarding.
- `CATALOG-REFRESH-001` queda `done`: el catálogo inicial se ajustó a los 19
  modelos actuales que Daniel mostró el 2026-08-31, con IDs exactos, alias
  actualizados y capacidades conservadoras hasta comprobar cada contrato.

---

## F2.4-T1 — biblioteca de conversaciones

Estado: **`done` — Codex, 2026-08-28**

Objetivo: permitir renombrar, archivar y buscar conversaciones desde Studio,
reutilizando la cola y la metadata existentes, sin migración ni sondeo nuevo.

Estado real de partida:

- `main` y `origin/main` coinciden en `00a9cc1`, que ya integra
  `F4.9-DYNAMIC-HTTP-PROVIDERS`; la integración que este archivo aún marcaba
  como siguiente paso ocurrió fuera del relevo documental;
- `LA-029` continúa pendiente únicamente para publicar Gateway, reconstruir y
  validar manualmente; no se ejecutará sin autorización explícita;
- el trabajo nuevo vive en el worktree aislado
  `luxy/f2-4-conversation-library`, basado en `main` @ `00a9cc1`;
- los cambios locales de `.codebase-memory/` en la copia principal son el ruido
  regenerable ya documentado y se preservan.

Criterios de aceptación:

1. Un título explícito de conversación se valida y persiste sin reescribir los
   prompts ni respuestas guardados.
2. Archivar oculta la conversación de la vista activa y existe una forma clara
   de consultar y restaurar las archivadas.
3. La búsqueda filtra por título y contenido visible ya cargado, sin introducir
   polling ni enviar texto privado a un servicio nuevo.
4. Metadata antigua sigue siendo legible y las acciones se acotan al mismo
   usuario y conversación.
5. No hay migración, deploy, API real, commit ni push automáticos.
6. Lint, typecheck, suite y build terminan en verde con pruebas de lo nuevo.

Resultado verificado:

- renombrado y archivo persistentes en metadata de la conversación, autorizados
  contra la máquina creadora y sin modificar prompts ni respuestas;
- vistas Activas/Archivadas, restauración y búsqueda local por título,
  preguntas y respuestas ya cargadas;
- el título elegido se conserva en turnos posteriores y una conversación
  archivada no admite nuevos envíos hasta restaurarla;
- contratos Zod, Gateway, cliente, IPC, preload, hook y renderer conectados sin
  migración ni polling nuevo;
- una prueba histórica de worktrees ya no depende de la identidad Git global;
- `npm run lint`, `npm run typecheck`, `npm test` y `npm run build`: exit 0;
  96 archivos, 1.655 pruebas superadas y 14 omitidas.

No ejecutado: API real, automatización de navegador, migración, deploy, commit
ni push. El trabajo permanece sin commit en
`luxy/f2-4-conversation-library`.

Siguiente paso exacto: revisar el diff y, si Daniel lo aprueba, crear el commit
local de `F2.4-T1`; la publicación/reconstrucción y validación manual quedan en
`LA-030`. Después, el siguiente bloque planificado es `F2.5`.

---

## F4.9-DYNAMIC-HTTP-PROVIDERS — proveedores HTTP configurables desde Studio

Estado: **`done` — Codex, 2026-08-27**

Objetivo cerrado: permitir añadir, editar, activar, desactivar y eliminar desde
Studio un proveedor HTTP compatible con `chat completions`, guardar su clave
cifrada y hacer que el agente lo use tras aplicar la configuración, sin editar
`config.json` a mano.

Resultado verificado:

- formulario completo en Conexiones y disponibilidad dinámica en Trabajos y
  Conversaciones;
- validación Zod de identificador, URL, modelo, límites y duplicados;
- clave ligada a la configuración y guardada en `SecretStore`, con invalidación
  al eliminar el proveedor o cambiar su endpoint;
- recarga inmediata si el agente está libre y diferida si ejecuta un trabajo;
- `npm run check`: lint, tipos y builds correctos; 96 archivos, 1.656 pruebas
  superadas y 9 omitidas;
- commit local autorizado y creado; ninguna API real, push, deploy ni migración
  ejecutados.

Estado real de partida:

- rama aislada `luxy/f4-9-dynamic-http-providers`, basada en `main` @ `2ae1291`;
- `main` y `origin/main` ya coinciden en `2ae1291`; `LA-028` quedó superada por
  el estado real aunque la documentación anterior todavía la presenta pendiente;
- el commit `2ae1291` permite guardar claves de entradas ya existentes en
  `providers.http`, pero no crear ni editar esas entradas desde Studio;
- `LuxyAgent.initializeProviders` ya construye `HttpApiProvider` desde la
  configuración y el flujo IPC ya puede reiniciar el agente;
- Codebase Memory está operativo sobre `main` @ `2ae1291`. La cobertura de los
  archivos candidatos no registra huecos, pero marca metadata cambiada; por eso
  se contrasta el grafo con el código fuente del worktree antes de editar.

Criterios de aceptación:

1. Studio administra el proveedor completo: identificador, nombre, URL base,
   modelo, clave, estado, streaming y límites seguros.
2. Toda entrada se valida con Zod; no se aceptan URLs inseguras ni nombres de
   secreto arbitrarios que no correspondan a la configuración guardada.
3. Las claves permanecen fuera de `config.json`, cifradas por `SecretStore`.
4. Guardar reinicia o actualiza el agente para que el proveedor aparezca en los
   selectores sin reiniciar Luxy manualmente.
5. Eliminar o cambiar el identificador de clave borra el secreto huérfano.
6. No se llama a ninguna API real; lint, typecheck, suite y build quedan verdes.

Archivos previstos: esquemas shared; store/IPC/configuración y renderer de
Desktop; pruebas de contratos, almacenamiento, IPC/UI y runtime; documentación
de continuidad. Sin commit, push, deploy ni migraciones.

Siguiente paso exacto: integrar el commit local en `main` y ejecutar `LA-029`
para publicar el Gateway, reconstruir Desktop/agente y validar desde Studio una
API elegida por Daniel.

---

## Checkpoint de continuidad — 2026-08-21 (rama renombrada a `main`)

`LUXY-CONSOLIDATION-001` está cerrada (`done`). Después de cerrarla, Daniel
pidió un saneamiento final del checkpoint (secretos protegidos en
`.gitignore`, scratch temporal eliminado, `.codebase-memory/artifact.json`
documentado como problema de diseño abierto — ver `AI-WORK-PROTOCOL.md` §9)
y, tras eso, renombrar la rama canónica a un nombre claro.

**La rama local dejó de llamarse `feat/luxy-desktop` y ahora es `main`**
(`git branch -m`, cambio puramente local). El remoto ya tenía `origin/main`
como rama por defecto (`origin/HEAD -> origin/main`), en `c6e5094`, que es
**ancestro directo** del HEAD actual: no hay divergencia, así que el push
pendiente es un fast-forward limpio, no una reescritura de historia.
`origin/feat/luxy-desktop` (`65ca161`) queda intacta en el remoto sin
actualizar; qué hacer con ella (dejarla o borrarla) es una decisión
pendiente y separada.

- **Línea canónica actual**: `C:\Users\daniel\Desktop\Luxy`, rama `main`,
  HEAD `02c2080`. Copia operativa real (registrada en
  `%APPDATA%\Luxy\config.json`).
- `git worktree list` contiene únicamente esa copia.
- **Push pendiente, bloqueado por el entorno** (no por falta de
  autorización): `git push origin main` fue denegado dos veces por el
  sistema de permisos de esta sesión sin mostrar ningún prompt. Registrado
  como acción manual de Daniel en `LOCAL-ACTIONS.md`, `LA-028`, con el
  comando exacto.
- Working tree limpio salvo el ruido conocido y ya documentado de
  `.codebase-memory/artifact.json`/`graph.db.zst` (el watcher del MCP los
  reescribe en cuanto detecta cualquier cambio; no es un problema de
  producto, ver `AI-WORK-PROTOCOL.md` §9).
- Sin secretos tracked ni staged. Sin cambios de producto sin commitear.

Siguiente acción exacta: Daniel ejecuta `LA-028` (`git push origin main`)
desde una terminal fuera de esta sesión. Después, decidir si se actualiza o
se borra `origin/feat/luxy-desktop` en el remoto, y si se cambia el branch
por defecto de GitHub (si no lo estuviera ya en `main`). Ninguna de las dos
cosas se ha hecho todavía.

---

## Checkpoint de continuidad — 2026-08-21 13:30 (histórico — branch aún `feat/luxy-desktop` en este momento)

Paso cerrado: **LUXY-CONSOLIDATION-001 — consolidación de los ocho worktrees**

Estado: **done — Claude, 2026-08-21**

### Qué es esta tarea

Antes de esta sesión existían ocho worktrees de Luxy sin una línea canónica
declarada: el checkout principal (`feat/luxy-desktop`) con cambios locales
sin commitear, y siete worktrees más creados por el propio agente de Luxy
para tareas anteriores (`luxy/consolidate-worktrees`, `luxy/auto-init-git`,
`lux/bug-hunyuan-backcompat`, `luxy/timeout-deepseek-agentic`,
`luxy/work-update-001-studio`, `luxy/phase-4d-session-host`,
`luxy/ux-001-detalle-trabajo`), cada uno con trabajo real, parte ya
commiteado y parte sin commitear. `LUXY-CONSOLIDATION-001` audita las ocho
líneas, unifica el trabajo válido en una sola y elimina lo redundante.

Detalle completo, cronológico y con evidencia de cada paso: `CHANGELOG-WORK.md`,
entradas del 2026-08-21 bajo `LUXY-CONSOLIDATION-001`. Este archivo sólo
resume el estado final; no repite esa evidencia.

### Estado final

- **Línea canónica**: `C:\Users\daniel\Desktop\Luxy`, rama `feat/luxy-desktop`,
  HEAD `e40268a`. Es tu copia operativa real (registrada en
  `%APPDATA%\Luxy\config.json`).
- **`git worktree list` contiene únicamente esa copia.** Los ocho worktrees
  originales quedaron en uno solo:
  - `luxy/consolidate-worktrees` (HEAD `11dff48`) se identificó como la mejor
    base — descendiente lineal de `feat/luxy-desktop`, sin divergencia — y ya
    integraba como commits `luxy/auto-init-git`, `luxy/ux-001-detalle-trabajo`
    y `luxy/phase-4d-session-host`.
  - Se le añadió un bloque nuevo: diálogo de confirmación React embebido en
    `Studio.tsx` (sustituye `window.confirm()`, mismo patrón que ya usaba
    `Laboratory.tsx`; decisión de Daniel de no adoptar el diálogo IPC nativo
    alternativo de `lux-bug-hunyuan`) y la ficha editable de proyecto de
    `lux-auto-init-git` (`project-profile.ts`, panel «Ficha · alias» en
    `Config.tsx`, CSS asociado, decisiones `D-034`–`D-037`).
  - Ese bloque se commiteó (`e40268a`) y se fusionó en `feat/luxy-desktop`
    por fast-forward.
  - Los cuatro worktrees restantes con cambios sin commitear
    (`lux-bug-hunyuan`, `lux-timeout-deepseek`) o ya limpios
    (`phase-4d-session-host`, `ux-001-detalle-trabajo`, y el propio
    `luxy-consolidate-worktrees`, redundante tras la fusión) se auditaron
    archivo por archivo contra `e40268a` y se confirmó que no aportaban nada
    único: se eliminaron con `git worktree remove --force`. Sus ramas locales
    siguen existiendo (no se borraron ramas, sólo carpetas de trabajo).
- **`git stash@{0}`** (snapshot previo a la fusión) se auditó completo: de
  25 archivos, sólo cinco encabezados históricos de `TEST-RESULTS.md`
  (validaciones manuales del 2026-08-11 sobre el catálogo de modelos) no
  habían llegado a la línea canónica; se rescataron. El resto ya estaba
  integrado o superado. El stash se descartó (`git stash drop`) tras esa
  auditoría.
- **Memoria MCP** (`codebase-memory-mcp`, proyecto `C-Users-daniel-Desktop-Luxy`)
  reindexada explícitamente sobre `e40268a` (4.474 nodos, 14.190 aristas).
  Verificada: `get_architecture` recupera los ocho paquetes reales del
  monorepo; `search_graph` localiza símbolos añadidos en esta misma sesión
  (`buildProjectProfileUpdate`, `resolveHttpRequestTimeout`) en su ubicación
  exacta.
- **Verificación completa en la copia canónica**: `npm run typecheck`,
  `npm run lint` y `npm run build` limpios; `npm test` → **94 archivos, 1.641
  pasadas, 9 omitidas, 0 fallos**. (`npm install` fue necesario una vez, a
  mitad de la fusión: `node_modules` llevaba desde el 1 de agosto sin
  refrescar y producía errores de tipo falsos.)

### Checkpoint final — 2026-08-21 13:50

- `git status --short --branch`: sólo documentación de continuidad
  modificada (`AI-WORK-PROTOCOL.md`, `CHANGELOG-WORK.md`, `CURRENT-TASK.md`,
  `LOCAL-ACTIONS.md`, `MASTER-PLAN.md`, `PROJECT-STATE.md`,
  `TEST-RESULTS.md`) y los artefactos regenerados de memoria MCP
  (`.codebase-memory/artifact.json`, `.codebase-memory/graph.db.zst`); el
  resto son archivos sin seguimiento ya conocidos (claves, demos, respaldo
  temporal, `.wrangler-manual.toml`, el propio scratch de la matriz). **Sin
  commitear** — pendiente de que Daniel autorice ese commit.
- `git worktree list`: **una sola línea**,
  `C:/Users/daniel/Desktop/Luxy e40268a [feat/luxy-desktop]`.
- `npm run lint`: sin incidencias.
- `npm run typecheck`: sin errores.
- `npm test`: **94 archivos, 1.641 pasadas, 9 omitidas, 0 fallos**.
- `npm run build`: correcto en los cuatro workspaces.
- `git diff --check`: sin salida (sin conflictos ni espacios en blanco
  problemáticos).
- Comprobación de secretos: los dos archivos de claves siguen sin
  seguimiento, no aparecen en `git status` como candidatos a commit; escaneo
  de patrones (`sk-…`, `api_key`, `service_role`, `Bearer …`, bloques PEM)
  sobre los documentos tocados esta sesión sin coincidencias.
- Ninguna API real, migración, deploy ni push.

`LUXY-CONSOLIDATION-001` queda **cerrada**. El resumen completo pedido por
Daniel (rama, HEAD, worktrees eliminados/restantes, stash, bloques
integrados/descartados, pruebas, memoria MCP, documentación, validación
manual pendiente, riesgos) se entregó en el chat al cerrar esta tarea.

### Riesgos y validación manual pendiente, conocidos ya ahora

- **Ningún push** de ninguna rama. `feat/luxy-desktop` está 21+ commits por
  delante de `origin/feat/luxy-desktop`.
- **Sin migraciones ni deploy.**
- `npm install` durante la fusión informó **12 vulnerabilidades (5 moderate,
  6 high, 1 critical)** en dependencias. Registrado como hallazgo de
  seguridad; **no se ejecutó `npm audit fix` ni `--force`** por instrucción
  explícita de Daniel — se audita aparte, después de cerrar esta
  consolidación, para no introducir cambios incompatibles sin control.
- `.codebase-memory.pre-merge-backup/` (índice MCP local anterior a la
  fusión, regenerable) sigue en disco: el entorno denegó el permiso para
  borrarlo por comando. Acción manual de Daniel si quiere limpiarlo — ver
  `LOCAL-ACTIONS.md`.
- No hay validación manual de UI pendiente conocida: los cambios de este
  bloque (diálogo de confirmación, ficha de proyecto) están cubiertos por
  pruebas automatizadas, pero nadie los ha visto todavía corriendo en Studio.
  No es bloqueante para cerrar la consolidación; sí conviene probarlo la
  próxima vez que abras Studio.

### Siguiente tarea después de `LUXY-CONSOLIDATION-001`

Ninguna todavía. Por instrucción explícita de Daniel, no se empieza el nuevo
`MASTER-PLAN.md` empresarial hasta que esta consolidación quede cerrada y
Daniel, ChatGPT/Codex y Claude lo redefinan juntos.

---

## Historial de trabajo anterior a esta consolidación

Los pasos `F0`–`F4` (respuestas largas, memoria, catálogo de modelos,
Laboratorio) y las tareas de continuidad `CONSOLIDATE-WORKTREES-001`,
`BUG-HUNYUAN-002` y `GIT-CHECKPOINT-001` que llevaron a los ocho worktrees
descritos arriba están **todas cerradas** y su código integrado en la línea
canónica actual. El registro completo, paso a paso, vive en
`CHANGELOG-WORK.md` (append-only, nunca se reescribe) y el estado de
capacidades del producto en `PROJECT-STATE.md`. No se repite aquí para que
este archivo siga señalando un único trabajo activo, tal como exige
`AI-WORK-PROTOCOL.md`.


### F24, lo hecho y lo que falta

- **Paso 2, el nucleo puro**: `packages/shared/src/vault-recap.ts` (1.485
  lineas). Esquemas, el prompt del §5 —verificado con `diff` contra el diseño,
  no copiado a ojo—, el parseo, la verificacion, el recorte, el detector de
  vaguedad, la ventana, el indice deducido y la eleccion entre memoria sellada y
  recap. **El presupuesto por turno NO hereda el del catalogo**, que es el error
  que ya se cometio con las promesas;
- **Paso 3, el bloque del prompt**: hecho, y arregla de paso la regresion que ya
  existia: cualquier memoria, aunque fuera parcial, apagaba el aviso de turnos
  omitidos. Sin recap, el prompt sale identico al de antes;
- **Paso 4, el almacen**: `recap-store.ts`, con el molde de `relation-store`
  (`fsync`, carril, lectura tolerante, `checkedForWrite`), no con el del
  catalogo;
- **Paso 5, la pasada**: `recap-sync.ts` (1.229 lineas), con los cinco estados
  separados de §8 y la negativa clasificada con `classifyReply`.

**Falta**: el IPC con `dryRun` (6), el enganche en el turno y el borrado de
conversacion (7), y la pantalla (8). Y despues, la pasada real de Daniel, que
es la unica forma de saber si los CLI se niegan.
