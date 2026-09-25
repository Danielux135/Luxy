# Lía: repetición, aprendizaje y evolución — investigación y plan

Investigación del 2026-09-25. Continúa `docs/ROLEPLAY-MEMORIA.md` (2026-09-10),
que iba de **memoria y estado de escena**. Esta va de otra cosa: **por qué Lía
repite las promesas en cada respuesta**, y cómo hacen las plataformas de roleplay
para que un personaje **aprenda del usuario, evolucione con él, varíe, tome la
iniciativa y siga sonando a sí mismo**.

Se hizo con tres ramas: un diagnóstico de la repetición con los registros reales
y tres revisores escépticos que intentaron tumbarlo; trece frentes de
investigación (Character.AI, Replika, Nomi, Kindroid, SillyTavern, plataformas
adultas, NovelAI/AI Dungeon, papers de persona, papers de repetición, comunidad,
iniciativa, aprendizaje implícito y oficio narrativo), cada uno repasado por un
verificador; y un inventario de lo que Luxy ya tiene. **Es un plan, no está
implementado.** No se ha abierto la bóveda: todas las cifras salen de
`studio.log` y `luxy.log`, que solo guardan números.

Una segunda ronda, el mismo día, revisó tres cosas que la primera dejó cojas: el
caso de los 17 turnos que abrió todo (1.6), por qué el carril de fondo lleva diez
días sin apuntar nada (1.5) y cuatro frentes que no se habían mirado: MiniMax
Talkie/Xingye, RisuAI, la memoria de ChatGPT y de Claude y los compañeros de Grok
(3.6). También corrigió seis afirmaciones que un crítico marcó como débiles. **Esa
ronda cambió el orden de las recomendaciones**; el resumen lo dice.

**Cómo leer las marcas:**

- **DEMOSTRADO**: hay archivo y línea, una cifra medida o una URL que lo dice.
- **HIPÓTESIS**: se sospecha; al lado va la comprobación que lo confirmaría.
- **INFERIDO**: conclusión de este documento a partir de una fuente que no lo
  dice tal cual.
- **CAÍDO**: algo que se afirmó y un verificador tumbó. Se deja para que nadie lo
  vuelva a dar por bueno.

---

## Resumen en una pantalla

### Qué pasa con la repetición

**No sabemos todavía de dónde sale.** El contador que se puso para averiguarlo
(`ecoHistorial`) no mide si Lía vuelve a sacar una promesa: mide si su respuesta
comparte dos o tres palabras sueltas con la cita de **alguna** de las 10
promesas abiertas, y además recorre toda la conversación, no lo que viaja en el
prompt. Con respuestas largas casa casi por azar. Las cuatro lecturas
provisionales que se apoyaban en él («la memoria no es la fuente», «quitar el
bloque no cambia nada»...) **no están demostradas ni en un sentido ni en otro.**

Lo que sí está demostrado, y basta para actuar:

0. **El caso que abrió todo pasó sobre todo sin el bloque de pendientes** (1.6).
   Antes de `29f829d` (2026-09-17), ninguna tanda de 17 turnos seguidos de una
   misma conversación llevó el bloque en más de 11. De las 15 repeticiones que
   vio Daniel, por tanto, **al menos 4 salieron en turnos sin bloque**.
   HIPÓTESIS, la más probable: fueron los turnos 1-17 de `d0685ae5`, con el
   bloque en 7 de 17 y diez turnos seguidos sin él; entonces fueron al menos 8.
   Todo con glm-4.5-air. Si Lía repetía «casi con las mismas palabras» cuando el
   bloque no estaba, **limitar el bloque no habría evitado aquel caso**.
1. **El bloque de pendientes no es esporádico hoy.** Va en **27 de 38 turnos
   respondidos (71 %)** de la conversación principal desde el 18/09 (en la misma
   conversación, antes del 17/09, en 12 de 23, un 52 %), y su texto le dice
   «puedes sacar una tú sola». Cada promesa descansa por separado, pero con 10
   abiertas que se turnan casi siempre hay alguna disponible: **no hay un tope
   para el bloque en conjunto.** Es lo contrario del «esporádico» que pide Daniel,
   aunque no sea la causa del caso original.
2. **Nada le dice a Lía que una promesa ya la sacó ella.** Sus últimas
   respuestas le vuelven literales en cada turno, rotuladas «Asistente:», y el
   system prompt llama al historial «el contenido al que respondes». No hay ni
   una instrucción contra repetirse en el camino de conversación.
3. **El modelo pesa mucho.** glm-4.5-air casó 13 de 13 respuestas; DeepSeek-V4-Flash,
   el que atiende hoy a Lía, 4 de 10, con respuestas igual de largas o más.
   Modelo, día y escena van juntos, así que no se sabe cuánto es del modelo.
4. **La palanca de muestreo no existe para el modelo de Lía.** Las familias de
   una conexión se crean sin temperatura, y la API oficial de DeepSeek ignora
   las penalizaciones de frecuencia y presencia.

La causa más citada por la bibliografía —**Lía se copia a sí misma** desde sus
últimas respuestas— sigue siendo la más plausible, pero es **HIPÓTESIS**. En
contra, el único experimento natural del registro: DeepSeek no repitió en 5
respuestas seguidas con la ventana llena de texto que casaba. A favor, el caso
original: repeticiones «casi con las mismas palabras» en turnos sin bloque, y en
diez de ellos el selector veía 2-3 promesas dentro de los mensajes que viajan
literales (1.6; mismo comparador ruidoso).

### Las cinco ideas que más valen la pena

**Qué cambió en la segunda ronda:** el tope del bloque baja del nº 1 al nº 2,
porque el caso original ocurrió con el bloque ausente en la mayoría de los turnos
y la razón que lo ponía primero («todas las plataformas limitan el concepto») no
tenía fuente. «Lo dicho está dicho» sube al nº 1, y en el plan pasa a ser el
paso 2. El solapamiento de 5 palabras (paso 1.4) pasa a ser la medida que más importa.
La idea 5 ya no se apoya solo en apps de compañía (ChatGPT y RisuAI lo tienen). La
idea 4 toma como modelo la memoria de Claude. Y antes de cargar el carril de fondo
con más tareas hay que saber por qué 58 revisiones seguidas no apuntaron nada
(paso 0).

| # | idea | por qué | coste |
| --- | --- | --- | --- |
| 1 | **Decirle que lo dicho está dicho**, en positivo y sin nombrar la promesa, y que responda al mensaje nuevo | Hoy no hay ninguna frase así. Es la única de la lista que apunta al canal más probable del caso original: si las repeticiones salían sin bloque, llegaban por el historial, la memoria, el índice o la ficha, y el historial es el candidato con más peso (HIPÓTESIS, 1.6). La bibliografía mide que un modelo se refuerza con lo que ya dijo | pequeño |
| 2 | **Tope global al bloque de pendientes**: como mucho en 1 de cada 3-4 turnos, y solo si la escena da pie; si él la nombra, sale siempre | Es literalmente el «esporádico» que pide Daniel, y hoy el bloque va en el 71 % de los turnos. **No arregla el caso original.** Hay mecanismos de cadencia parecidos (la frecuencia de la Author's Note, el cooldown global de DeepLore), pero ninguno está documentado como remedio de un personaje que repite una promesa | pequeño |
| 3 | **Un diálogo de ejemplo en la ficha de Lía** | Hoy «quién eres» ocupa 67 caracteres y el catálogo de imágenes 5.700. La voz se ancla con ejemplos, no con adjetivos (Character.AI, Kindroid, Ali:Chat) | pequeño |
| 4 | **Lo que Lía sabe de él**, escrito en diferido por Claude Code o Codex, visible y editable por Daniel dato a dato | Es el «aprende de ti» que tienen todas: Facts, Learned Context, Identity Core, Mind Map, y fuera del roleplay los «Topics» de la memoria de Claude y la lista más resumen de ChatGPT. Luxy ya reservó el hueco (`taste`, `person`) y nunca lo llenó. **Antes**, saber por qué el carril que lo escribiría lleva 58 revisiones sin apuntar nada (1.5) | mediano |
| 5 | **Ver qué entró en cada respuesta y poder callarlo**: «no lo saques más» para un pendiente y «que no lo vuelva a ver» para una respuesta | Lo tiene oficialmente ChatGPT: «Sources» bajo cada respuesta y «Don't mention this again», que calla un recuerdo sin borrarlo (nota de versión del 05-05-2026). RisuAI enseña en código abierto qué resúmenes entraron en el último prompt y por qué vía. También Kindroid y Replika Ultra. Hoy la bóveda solo deja borrar la conversación entera | mediano |

Antes de todo, dos pasos de medida sin los que nada de lo anterior se podrá
juzgar (pasos 0 y 1 del plan). El paso 0 incluye pulsar una vez el diagnóstico de
memoria, que dice qué hace el extractor.

---

## 1. El diagnóstico de la repetición

### 1.1 Qué son «las promesas» y cómo se dosifican

Un extractor (Claude Code o Codex, en segundo plano) apunta en
`vault/relation.json` los asuntos pendientes entre los dos —algo que uno prometió,
un plan, una cita— con la cita literal. Cada turno, `selectPendingForTurn`
(`apps/desktop/src/main/vault/relation-selection.ts:277`) decide cuáles se le
enseñan a Lía en el bloque ASUNTOS PENDIENTES
(`packages/shared/src/vault-prompt.ts:442-472`). Diseño en
`docs/PENDIENTES-DISENO.md`.

La dosificación (DEMOSTRADO, `relation-selection.ts:39-57`): como mucho 2 líneas
por turno (`PENDING_MAX_LINES`); una promesa que ella saca descansa 72 h
(`HER_COOLDOWN_MS`); cada promesa está disponible 6 mensajes seguidos de Daniel
(`OFFER_RUN_USER_TURNS`) y luego descansa 48 h (`OFFER_WAIT_MS`); si ya aparece
en la ventana reciente, sale del bloque (`:388-391`). **Todos esos relojes son
por promesa.** No hay ninguno para el bloque entero.

### 1.2 Por qué el contador no sirve para decidir

DEMOSTRADO en el código:

- **Bolsa de raíces.** Una respuesta «casa» con una promesa si comparte al menos
  `min(2, k)` de las `k` raíces de su cita y son al menos el 40 %, en cualquier
  parte del texto, sin mirar orden ni cercanía
  (`apps/desktop/src/main/vault/relation.ts:35-38` y `97-113`). Y basta con casar
  con **una** de las 10 promesas vivas.
- **Recorre la conversación entera.** `ecoHistorial` usa
  `history.slice(0, -1).filter(assistant)` sobre el hilo completo
  (`apps/desktop/src/main/ipc/handlers.ts:4403` y `4651`), no la ventana de 8
  turnos que viaja en el prompt. El comentario de `handlers.ts:4649-4650` dice lo
  contrario y **es falso**. El famoso «45 de 60» lo dominan las 23 respuestas
  anteriores a la instrumentación, que casaron todas.
- **`ecoMemoria` solo mira dos de seis campos** (`plan` y `openQuestions`,
  `handlers.ts:4645-4648`). No ve `summary` (hasta 1.200 caracteres), `facts`,
  `decisions` ni `lessons` (`packages/shared/src/schemas.ts:243-251`). Su «0 de 3»
  no descarta la memoria.

Prueba sintética (DEMOSTRADO como prueba, con citas inventadas): el comparador
real, con 10 promesas inventadas, contra texto afectuoso que no hablaba de
ninguna, casó el **39 %** de las respuestas de 500 caracteres y el **83 %** de las
de 1.000. Las respuestas visibles de Lía rondan los **700-1.100 caracteres**.

> **CAÍDO**: «las respuestas reales rondan los 1.400-2.200 caracteres» y «casi el
> 100 % con 2.000». Esa cifra es la salida cruda del modelo (`textChars`), con el
> bloque de memoria dentro; el contador trabaja sobre el texto visible.
>
> **CAÍDO**: «el registro es indistinguible del ruido». Un azar homogéneo no da a
> la vez 13/13 un día y 3/9 otro (Fisher ≈ 0,001). El contador responde a
> *algo* del contenido o del estilo del modelo; que ese algo sea «la promesa» no
> está demostrado.
>
> **CAÍDO**: «la tasa sigue a la longitud». El 25/09, DeepSeek no casó en sus 5
> primeras respuestas, que eran las más largas de los dos días comparados.

### 1.3 Las cifras que sí aguantan

Todo de `studio.log` cruzado con `luxy.log`; se reprodujeron en tres análisis
independientes. Conversación principal: `d0685ae5`.

| qué | cifra | reserva |
| --- | --- | --- |
| Turnos respondidos en `d0685ae5` con contador | **38** | Las 62 líneas del log incluyen 24 prompts recompuestos tras un fallo de la llamada; contar líneas infla todo |
| Turnos con bloque de pendientes | **27 de 38 (71 %)** | Contando líneas salía 50 de 62 (81 %) |
| Veces que aludió a lo que el bloque le enseñó | **6 de 42** turnos con bloque (todo el registro); **4 de 45** notas mostradas desde el 18/09 | Mismo comparador ruidoso |
| Casar por modelo | glm-4.5-air 13/13, Qwen3.8-27B 4/4, **DeepSeek-V4-Flash 4/10**, step 1/3, Horde 0/3 | Modelo, día y escena van juntos |
| Casar por día | 13/13 (18/09), 1/10 (21/09), 5/5 (24/09), 3/9 (25/09) | Autocorrelación enorme: la muestra efectiva se parece más a 4 bloques que a 37 |
| Con bloque frente a sin bloque | 15/26 frente a 7/11 | **No es un grupo control**: los turnos sin bloque siempre vienen justo después de rachas con bloque |
| Promesas apuntadas o cerradas desde el 16/09 | **0 en 58 revisiones reales**, todas terminadas con Claude Code; `abiertas=10` en todo el periodo | Las 187 líneas `pendientes extraidos` del periodo incluyen 129 tandas sin nada que revisar: contarlas como extracciones infla el cero. Ver 1.5 |
| Bloque de imagen con la puerta cerrada | **7.647 caracteres, 36 % del prompt** | Es coste, no causa demostrada |

La única cifra relativamente limpia es la tercera de la tabla: **lo que el bloque
le ofrece casi nunca sale**. Lo que Daniel ve repetido, por tanto, o no está en
el bloque de ese turno, o el comparador no lo ve. El caso original apunta a lo
primero: pasó con el bloque ausente en la mayoría de los turnos (1.6).

### 1.4 Las causas candidatas, por peso

| causa | estado | lo que la apoya | lo que la frena |
| --- | --- | --- | --- |
| **Lía se copia a sí misma** desde sus 4 últimas respuestas, que viajan literales | HIPÓTESIS, la de más peso en la bibliografía | Estructura DEMOSTRADA: ventana `turns.slice(-8)` literal (`vault-prompt.ts:36`, `706-741`), un único mensaje `user` (`http-provider.ts:538-550`), el system llama al historial «el contenido al que respondes» (`http-provider.ts:460-461`). Autorrefuerzo medido en Xu et al. 2022; copia del contexto en Li et al. 2019; apego a lo ya dicho en Laban et al. 2025. El caso original: al menos 4 repeticiones, probablemente 8 o más, «casi con las mismas palabras» en turnos sin bloque; en diez de ellos el selector veía 2-3 promesas dentro de los mensajes que viajan literales (1.6) | El 25/09 a las 07:14, con la ventana llena de texto que casaba (5 y 6 promesas «en escena»), DeepSeek no casó en 5 respuestas seguidas |
| **El modelo que responde** | HIPÓTESIS, la señal más fuerte en las cifras | glm/Qwen 17/17 respuestas largas frente a DeepSeek 4/10 | Confundido con el día y la escena |
| **El bloque es casi permanente y da permiso** | Estructura DEMOSTRADA; efecto sin medir | 71 % de los turnos; «Tú te acuerdas aunque él no las nombre», «Puedes sacar una tú sola» (`vault-prompt.ts:449-451`) | Ella casi nunca usa lo que el bloque ofrece; y el caso original pasó con el bloque ausente en la mayoría de los turnos (1.6) |
| **Nada le dice que ya lo sacó** | Hueco DEMOSTRADO | La nota en escena sale del bloque en silencio (`relation-selection.ts:388-391`); cero instrucciones contra repetirse (grep de `repit`/`repeti` en `vault-prompt.ts`) | Es un agravante, no una causa por sí solo |
| **La memoria acumulativa arrastra la promesa** | Canal abierto, sin medir | La orden es «conserva lo válido» (`schemas.ts:258-266`); en el último prompt quedaban ≥690 caracteres de memoria sin medir | Solo un indicio: el 18/09 `ecoMemoria` da 0 de 4 entradas, con el mismo comparador y mirando solo `plan` y `openQuestions` |
| **Un título del índice de recuerdos nombra una promesa** | Posible, sin medir | Las líneas del índice viajan siempre (`recall.ts:50`, `806-846`) | No se ha abierto la bóveda |
| **El bloque de imagen** | Marginal | Va al final, después del mensaje nuevo | Sin relación dosis-respuesta: el 21/09 repite 1/9 con los bloques más grandes |

Hallazgo lateral DEMOSTRADO en el código, que agrava todo lo anterior: **el
enfriamiento de 72 h usa el mismo comparador ruidoso**
(`relation-selection.ts:398-402`, `lastOf(herByAnything)`). Si una respuesta larga
casa por azar con una promesa, esa promesa pasa a descansar como si ella la
hubiera sacado. El ruido no solo estropea la medida: **decide qué se ofrece**.
HIPÓTESIS: por eso el bloque rota entre promesas casi al azar.

### 1.5 Dos cosas raras que conviene mirar primero

- **El extractor no apunta ni cierra nada desde el 16/09, pero no está
  atascado.** Revisado en la segunda ronda, con `studio.log` y `luxy.log`:
  - DEMOSTRADO: desde el 16/09 hay 187 líneas `pendientes extraidos`. 129 son
    tandas sin conversación candidata (`conversaciones:0`): la línea se escribe
    también cuando no hay nada que revisar, fuera de la guarda
    `candidates.length > 0` (`apps/desktop/src/main/vault/relation-sync.ts:573-581`).
    Las otras **58 son revisiones reales**. Todas terminaron con Claude Code
    (`opus`, `completed`; cada una casa con un «turno privado terminado» de
    `luxy.log`), con `negativas:0`, `fallidas:0` y `quedan:0`, y en todas avanzó
    el cursor, porque `reviewed` solo sube después de `persist`
    (`relation-sync.ts:794-809`). **Ninguna apuntó ni cerró nada.**
  - DEMOSTRADO: cerrar sí sabe. El 15/09, 42 ventanas dieron 13 apuntados y 2
    cerrados, uno con Codex y otro con Claude.
  - **No se sabe** si las 58 devolvieron listas vacías, o si propusieron cosas que
    se fusionaron con una abierta (mismo `by` y Jaccard ≥ 0,5,
    `apps/desktop/src/main/vault/relation.ts:161-185`) o que no pasaron la
    verificación de cita, rol o ventana (`packages/shared/src/vault-relation.ts:771-785`).
    La línea del registro no lo desglosa. Los contadores que lo distinguen
    (`proposed`, `merged`, `rejectedQuote`, `rejectedRole`, `rejectedWindow`,
    `rejectedClosure`, `clipped`) viven cifrados en `relation.json` y solo llegan
    al registro con el diagnóstico de memoria (`handlers.ts:2707-2721`), que no se
    ejecuta desde el 15/09 a las 15:49. Línea base de entonces: `proposed` 16,
    `accepted` 15, `merged` 1, todos los rechazos a 0, `clipped` 0,
    `maxConsecutiveOffersSameNote` 6.
  - El prompt empuja a la lista vacía, y es a propósito: «Mejor ninguno que uno
    dudoso» (`vault-relation.ts:552`) y no apuntar lo que ya está abierto
    (`:543-544`).
  - HIPÓTESIS de por qué las 10 no bajan: mencionarlas no las cierra, por diseño
    (`vault-relation.ts:550-551`); cada mención reinicia el silencio de 14 días
    que las dormiría (`relation-selection.ts:405-411`); y Daniel no ha cerrado ni
    descartado ninguna (0 líneas `pendiente corregido` desde el 08/09). También
    sigue abierta la de la primera versión: alguna de las 10 ya se cumplió y sigue
    ofreciéndose. Comprobación: `raising.sameNoteWithin24h` y el delta de
    `rejectedClosure` en el próximo diagnóstico, y que Daniel repase las 10. Y es
    posible que lo que Daniel llama «promesas» no esté entre esas 10.
  - Discrepancia sin explicar: el 15/09 el registro suma 13 apuntados, pero a las
    15:49 el almacén tenía 12 notas, y `abiertas` bajó de 11 a 10 entre las
    15:37:33 y las 15:39:04 sin cierre ni `pendiente corregido`. HIPÓTESIS: se
    borró una conversación (`removeConversation`,
    `apps/desktop/src/main/vault/relation-store.ts:305`, el único camino que
    borra notas). No hay línea que lo pruebe; el próximo diagnóstico daría
    `notes.total`.
  - **Consecuencia para el plan:** las ideas 4 (lo que Lía sabe de él), el
    cuaderno de la relación (3.3), el depósito de cosas que decir (3.4) y el
    vigilante de la voz (3.5) van por este mismo carril de `D-087`/`D-088`. El
    carril **corre** (termina, avanza el cursor, no falla), pero no se sabe si
    **produce**. Hay que saberlo antes de cargarlo con más tareas (paso 0).
- **Respuestas degeneradas guardadas como buenas** (DEMOSTRADO en `luxy.log`):
  4 respuestas de 24 caracteres de glm-4.5-air, con `finishReason` nulo, el 21/09
  entre las 14:30 y las 14:42, guardadas con final `completed`. Y una de 149
  caracteres de AI Horde, también `completed`, **reescribió la memoria
  acumulativa** de 1.219 caracteres y 4 entradas a 333 y 0. Contaminan el
  historial, la memoria y las cifras.

### 1.6 El caso que abrió todo: 17 turnos, casi siempre sin el bloque

Origen (`CURRENT-TASK.md:108-109`, `D-098`): en una conversación de 17 turnos Lía
sacó la misma promesa en 15, «casi con las mismas palabras». La primera versión de
este documento despachó la cifra de `CURRENT-TASK.md` (16 de 95 prompts con el
bloque) como «de otro periodo». **No lo es: el caso cae dentro de ese periodo.**

**Qué conversación es.** Antes del 2026-09-18 la línea del registro no lleva el id
de la conversación (lo añadió `29f829d`), así que se identifica por la continuidad
de los tamaños de los bloques.

- DEMOSTRADO: hay una cadena sin cortes desde el 2026-09-16 a las 06:31:57Z (un
  turno sin historial, el primero de una conversación) hasta las primeras líneas
  etiquetadas `d0685ae5` del 18/09. Continúan el índice (24 líneas), la memoria
  (~950-1.000 caracteres), la encarnación y el bloque de imagen, que crece sin
  parar de 5.692 a 8.927 caracteres. En la primera línea etiquetada
  `ecoHistorial.respuestas` vale 23; ese contador recorre el hilo entero
  (`handlers.ts:4403`, `4651`) y la cadena tiene exactamente 23 turnos
  respondidos. `d0685ae5` empezó, por tanto, el 16/09 a las 06:31:57Z, con
  glm-4.5-air en 22 de esos turnos y nemotron en uno.
- HIPÓTESIS: el caso son los turnos 1-17 de `d0685ae5`; el 17 es del 17/09 a las
  07:32Z (09:32 hora local), la misma mañana del commit. La única alternativa es
  otra conversación que empezó el 11/09 a las 11:01Z, de unos 38 turnos con
  DeepSeek-V4-Pro y luego glm-4.5-air, **con el bloque en 0 de todos**.
  Comprobación: la hora del mensaje de Daniel que cita los «17 turnos» en la
  transcripción de Claude Code del 17/09 (no se leyó).

| turnos de `d0685ae5` | fecha (UTC) | con bloque | en escena / en reposo / en espera (de 10 abiertas) |
| --- | --- | --- | --- |
| 1 | 16/09 06:31 | sí (1 ofrecida) | 0 / 5 / 4 |
| 2-11 | 16/09 06:36 → 14:56 | **ninguno** | 2-3 / 3-4 / 4 |
| 12-17 | 16/09 15:19 → 17/09 07:32 | sí (2 ofrecidas) | 2 / 4 / 1 |
| **1-17** | | **7 de 17** | |
| 18-23 | 17/09 07:38 → 14:54 | 5 de 6 | |

DEMOSTRADO: ninguna tanda de 17 turnos seguidos de una misma conversación, entre
todas las respondidas antes de `29f829d`, llevó el bloque en más de 11. Al menos 4
de las 15 repeticiones salieron sin bloque, sea cual sea la conversación; si es
`d0685ae5`, al menos 8, y los turnos 2-11 fueron diez seguidos sin él.

Que falte el bloque no quiere decir que falte la promesa. En los turnos 2-11 «en
escena» vale 2-3: según `relation-selection.ts:313-316` y `388-390`, el comparador
encontraba 2 o 3 promesas dentro de los 8 mensajes que viajan literales, y el
selector las callaba precisamente por eso. **HIPÓTESIS: la promesa llegaba por el
historial.** Es el mismo comparador ruidoso de 1.2, así que es un indicio, no una
medida.

**De dónde sale el «16 de 95»** (DEMOSTRADO): son las líneas «prompt privado
compuesto» de `studio.log` anteriores al 17/09 a las 14:54Z, desde el 11/09, de
todas las conversaciones y personajes, con reintentos y fallos. Se descompone así:

- 34 líneas del 11/09 al 15/09 a las 07:51Z, **anteriores a que el bloque
  existiera**: `selectPendingForTurn` y el objeto `pendientes` del registro entran
  en `fbcba9f` (14/09), y la primera línea con contadores es del 15/09 a las 13:39Z;
- 13 líneas con `abiertas=0` (otros hilos y pruebas de modelos del 15/09);
- **48 líneas de Lía con la función activa, de las que 16 llevan bloque (33 %).**

El 27 de 38 de 1.3 usa otra vara (solo `d0685ae5`, del 18/09 al 25/09, turnos
respondidos sin duplicados; reproducido). Con esa misma vara, `d0685ae5` antes del
commit da 12 de 23 (52 %). **La subida es del 52 % al 71 %, no del 17 % al 71 %.**

| periodo | turnos respondidos | con bloque | modelo |
| --- | --- | --- | --- |
| A: 11/09 → 15/09 07:51, sin la función | 31 | 0 | DeepSeek-V4-Pro |
| B: 15/09 13:39 → 16/09 06:22, Lía | 21 | 3 | glm-4.5-air 10, gpt-oss-20b 7, otros |
| C1: `d0685ae5` turnos 1-17 | 17 | 7 | glm-4.5-air 17 |
| C2: `d0685ae5` turnos 18-23 | 6 | 5 | glm-4.5-air 5, nemotron 1 |
| D: `d0685ae5` 18/09 → 25/09 | 38 | 27 | ver 1.3 |

**La dosificación no ha cambiado desde `fbcba9f`** (DEMOSTRADO con `git log -S` y
`-G`): `29f829d` en `relation-selection.ts` es una refactorización pura
(`isLiveNote`); las constantes no se tocan desde `bf00fee`; `166b6e0` solo cambia el
texto de `whoPromised`; `relation-sync.ts`, `relation.ts` y `vault-relation.ts` no
tienen commits posteriores al 14/09.

**Por qué subió la presencia.** DEMOSTRADO en los contadores: el 15 y el 16/09
«en reposo» vale 3-5 y «en espera» 4 de las 10; el 21 y el 24/09, tras huecos de
tres días, los dos bajan a 0 y se ofrecen 2 notas casi en cada turno. HIPÓTESIS
coherente con el código: los reposos son de reloj (72 h y 48 h,
`relation-selection.ts:45` y `:51`) y la tanda de 6 cuenta todos los mensajes de
Daniel desde el origen de la nota, se ofreciera o no (`availableInRun`,
`:483-510`). Con sesiones cortas separadas por más de 2-3 días, las esperas caducan
entre sesión y sesión y el bloque vuelve en todos los turnos. Comprobación: las
fechas de origen de las notas en `relation.json` (requiere la bóveda) o la
simulación de `relation-diagnostics.ts`.

**Qué cambia en el plan:**

- Poner tope al bloque atiende al «esporádico» que pide Daniel, pero **no a la
  causa del caso original**. Si Daniel pregunta «si ya repetía cuando el bloque
  casi no salía, ¿por qué limitarlo lo arregla?», la respuesta es que no lo
  arregla. Por eso baja al nº 2 y «lo dicho está dicho» sube al nº 1.
- Con repeticiones «casi con las mismas palabras» sin bloque, ganan peso el
  solapamiento de 5 palabras (paso 1.4) y el recorte de la ventana (paso 7), y
  pierde fuerza el segundo argumento contra DRY («solo corta copias literales»,
  sección 5). Es un juicio, no una medida.
- El caso ocurrió con glm-4.5-air, el mismo modelo del 13/13 del 18/09.

---

## 2. El plan, por pasos

Orden: primero saber qué pasa, luego lo barato y reversible, lo invasivo al
final. Cada paso dice cómo se sabe si ha funcionado. **El objetivo no es cero
promesas: es que salgan a veces**, como en una relación real.

Los pasos 2 y 3 son los dos baratos. En la primera versión el orden era el
inverso; se cambió tras 1.6. El 2 va primero porque apunta al canal más probable
del caso original. El 3 es lo que Daniel pide literalmente, pero no habría evitado
aquel caso. Se miden por separado.

### Paso 0 — La vara de medir de Daniel · pequeño · sin código

Durante 20-30 respuestas, con **un solo modelo** (DeepSeek-V4-Flash) y sin
columnas de comparación, Daniel apunta fuera del log si cada respuesta repetía
una promesa, y cuál, con sus palabras. En la misma sentada: repasar las 10
pendientes abiertas (¿alguna ya se cumplió?) y mirar en Studio los 4 turnos de 24
caracteres del 21/09. Y, con la bóveda abierta, **pulsar una vez el diagnóstico de
memoria**: solo escribe enteros en `studio.log`, y su `relaciones.extraction`
comparado con la línea base del 15/09 (1.5) dice qué hace el extractor:

| si… | significa |
| --- | --- |
| `proposed` sigue en 16 | Opus devolvió listas vacías en las 58 ventanas: o el prompt es demasiado conservador o de verdad no había nada |
| `merged` sube | la fusión se come las propuestas |
| `rejectedQuote`, `rejectedRole` o `rejectedWindow` suben | las propuestas no pasan la verificación |
| `rejectedClosure` sube | intenta cerrar y se le rechaza |
| `clipped` pasa de 0 | hay ventanas que no se leyeron enteras |

- **Por qué:** el síntoma lo define Daniel y el contador no es fiable. Es la
  única medida que no hereda el ruido. El diagnóstico decide si el carril de fondo
  sirve para las ideas que se apoyan en él.
- **Medir:** respuestas marcadas ÷ respuestas totales. Es la cifra de partida.

### Paso 1 — Arreglar la medida · mediano · solo enteros

Sin tocar `matchesStems`, que usan también la selección y la dosificación. Solo
números, nunca contenido ni id de nota (un id es el sha256 de la cita y se podría
adivinar por diccionario).

1. Partir `ecoHistorial` en `ventana` (sus respuestas dentro de lo que viaja) y
   `conversacion`, y corregir el comentario falso de `handlers.ts:4649`.
2. **Tabla 2×2 por promesa en cada turno**, sobre la respuesta visible:
   {en la ventana y casa, en la ventana y no casa, fuera y casa, fuera y no casa}.
   Compara promesas **dentro de la misma respuesta**, así que longitud, modelo y
   día se cancelan. Es lo que permite ver la autocopia.
   *(Corrección de un revisor: registrar solo «¿estaba ya en la ventana?» para las
   que casan no da el denominador y confirmaría la autocopia con puro ruido.)*
3. **Placebo por pares (respuesta, promesa)**, no por respuesta: si no, se compara
   un «alguna de 10» (≈57 % de azar) con un «esta en concreto» (≈8 %) y se saca la
   conclusión contraria.
4. **Solapamiento literal**: cuántos grupos de 5 palabras de la respuesta nueva ya
   estaban en sus respuestas de la ventana. Ve la copia que la bolsa de raíces no
   ve. Tras 1.6 es **la medida que más importa**: el caso original fueron
   repeticiones «casi con las mismas palabras» sin el bloque delante.
5. `ecoMemoria` por campo: `summary`, `facts`, `decisions`, `plan`,
   `openQuestions`, `lessons`.
6. **El modelo** en la línea «prompt privado compuesto», y la longitud del **texto
   visible**, no la salida cruda.
7. Una variante estricta del comparador en paralelo (≥3 raíces o ≥60 %).
8. `counters.cooling` por turno, para ver si el enfriamiento lo dispara el ruido.
9. El desglose por tanda en la línea `pendientes extraidos` (`proposed`,
   `merged`, `rejected*`, `clipped`), para no depender del diagnóstico de memoria
   para saber qué hace el extractor (1.5).

- **Riesgo:** ninguno para Lía; no cambia el prompt.
- **Medir, tras unas 30 respuestas con un modelo:** si el placebo por pares queda
  muy por debajo de la tasa real, el exceso es repetición de verdad; si «en la
  ventana y casa» gana claramente a «fuera y casa», gana la autocopia; si lo que
  acompaña a las marcas de Daniel es `summary`/`facts`, la vía es la memoria y se
  salta al paso 6.

### Paso 2 — Lo dicho está dicho · pequeño · con interruptor

Dos cambios de texto, reversibles:

1. Una frase **genérica, en positivo y sin nombrar ninguna promesa** en la
   cabecera de ÚLTIMOS TURNOS o en la encarnación, del estilo: «Lo que ya dijiste
   en tus últimos turnos él ya lo ha leído y se da por dicho. Tu respuesta contesta
   a su mensaje nuevo y lleva la escena un paso más allá.» Sin nombrar la promesa
   por el efecto «elefante rosa» (arXiv 2402.07896; Jang et al. 2022): prohibir algo
   nombrándolo puede provocarlo.
2. En el system del modo conversación (`http-provider.ts:460-461`), que responda al
   **mensaje nuevo** y trate memoria e historial como contexto. Respetando `D-055`:
   no volver a imponer al asistente técnico.

Y, **por separado** (para poder medirlo aparte), reescribir el permiso del bloque
de pendientes como condición y no como invitación: quitar «Tú te acuerdas aunque
él no las nombre» y «Puedes sacar una tú sola» en favor de algo como «si la escena
te lleva a ello». INFERIDO de un caso parecido, no documentado como regla: en
Nomi, un usuario que pidió emojis «de vez en cuando» en un campo que viaja siempre
los recibía en todos los mensajes (ver 3.1). Ojo: en el caso original el bloque
faltaba en la mayoría de los turnos, así que este cambio pesa menos que los dos de
arriba.

- **Por qué va primero:** es lo único barato que apunta al canal más probable del
  caso original (1.6), el propio historial.
- **Riesgo:** que suelte hilos que sí debe seguir (un plan que están viviendo
  ahora) y parezca fría. Las pruebas que fijan el prompt byte a byte hay que
  actualizarlas.
- **Medir:** A/B **por bloques de al menos 5 turnos o por sesiones**, no alternando
  turno a turno. *(Corrección de un revisor: si la causa es la autocopia, lo que
  pasa en un turno viaja a los 4 siguientes y contamina el otro brazo.)*
  Objetivos a la vez: baja la repetición por encima del placebo, baja el
  solapamiento de 5 palabras (paso 1.4), las alusiones espontáneas no caen a cero y
  Daniel no nota pérdida de hilo.

### Paso 3 — Tope global al bloque de pendientes · pequeño

El bloque entra como mucho en **1 de cada K turnos** (K = 3-4, una constante). Una
promesa que Daniel nombra en su mensaje (`touched`) se salta el tope siempre. Si
se quiere un grado más de naturalidad, dos piezas de las plataformas:

- **Una tirada de probabilidad** cuando toca (el «Trigger %» del World Info de
  SillyTavern; la tirada única por turno de Inner Self en AI Dungeon).
- **Oportunidad antes que reloj**: preferir la promesa que casa con lo que pasa
  en la escena, o el principio de una sesión, como hacen los directores de juego
  (ver 3.4).

Todo es aritmética pura sobre la línea temporal que ya existe: sin estado nuevo,
sin llamada extra.

- **Por qué:** es lo que Daniel pide («esporádico») para el bloque, se mide solo
  (proporción de prompts con el bloque) y se revierte con una constante. Además
  corta, sea cual sea la causa, el efecto de 1.6: si los descansos por promesa
  caducan entre sesiones separadas por más de 2-3 días (HIPÓTESIS), hoy el bloque
  vuelve en todos los turnos.
- **Lo que no hace:** arreglar el caso original, que pasó con el bloque ausente
  en la mayoría de los turnos. No se debe juzgar solo.
- **Riesgo:** callar una promesa justo cuando tocaba; lo mitiga `touched`. Si la
  causa real es la autocopia, esto solo no bastará.
- **Medir:** prompts con bloque ≤ 1/K; marcas de Daniel antes y después con el
  mismo modelo; que siga habiendo alusiones espontáneas.

### Paso 4 — El modelo y la temperatura · mediano

1. Temperatura opcional en las **familias** de una conexión: hoy
   `buildFamilyProviders` (`apps/agent/src/agent.ts:386-404`) crea el proveedor sin
   ningún parámetro de muestreo, así que los cuatro de `D-098` solo alcanzan a
   `providers.http`, que tampoco tienen ninguno puesto. Para DeepSeek, **sin
   penalizaciones**: su documentación dice que «will not take effect».
2. Registrar el muestreo efectivo en «llamada al proveedor».
3. Comprobar primero que la pasarela `hcnsec` reenvía la temperatura (3 llamadas
   neutras, fuera de la bóveda, a 0 y otras 3 a 1,8). Y si su «DeepSeek-V4-Flash»
   corre en modo razonamiento, porque en ese modo DeepSeek **ignora la
   temperatura**.
4. Solo entonces, A/B por bloques. Las dos recomendaciones chocan: DeepSeek
   recomienda **1,3** para conversación (documentación oficial); un preset de la
   comunidad de SillyTavern recomienda **0,6-0,7 con el razonamiento apagado** para
   V4 Flash (una sola fuente de terceros). Hay que probar, no elegir a ojo.
5. Para separar modelo de escena: en la misma escena, alternar modelo por bloques
   de ≥5 turnos durante unos 15 bloques.

- **Riesgo:** más temperatura, más deriva de voz y más memoria mal formada (la
  memoria sale en la misma respuesta). Vigilar `memoriaHuecos`, finales distintos
  de `completed` y longitud. Un parámetro desconocido puede dar un 400: vacío tiene
  que seguir siendo el cuerpo de siempre.

### Paso 5 — Decirle con hechos que ya lo sacó · mediano · solo si 1 lo pide

Si el paso 1 confirma la autocopia y el 2 no basta: una línea calculada, en el
estilo de `raisedLabel`, tras ÚLTIMOS TURNOS, para las promesas que están en
escena **porque las sacó ella**: «en tu respuesta de hace N turnos ya sacaste lo
de «…»; si él no lo retoma, déjalo estar». Se calla si él la nombra.

Lo respaldan dos papers de 2026, los dos fuera del roleplay: nombrar la jugada del
turno anterior baja la repetición de jugada de 0,51 y 0,57 a 0,38 y 0,40 en Qwen-3
de 1,7B y 4B, en apoyo emocional (arXiv 2604.11742); y una instrucción que nombra
solo lo que se ha desviado supera a reinyectar la ficha completa (arXiv
2609.24532, 87 % frente a 35 %, midiendo la expresión de síntomas simulados de
TDAH). **Riesgo:** nombrar la promesa puede reforzarla; por eso va después del paso
2 y se compara con él.

### Paso 6 — La memoria · pequeño · solo si 1 lo pide

Si `summary`, `facts` o `decisions` llevan la promesa en los turnos que repiten: en
la orden de memoria del modo conversación, dejar dicho que `plan` y
`openQuestions` guardan lo acordado pero **no son un guion** para la respuesta
siguiente. **Riesgo:** la memoria es el único sitio donde vive lo acordado cuando
sale de la ventana; restringirla de más le haría olvidar promesas de verdad.

### Paso 7 — Recortar la ventana · grande · último recurso

Recorte asimétrico: los mensajes de Daniel van literales; en las respuestas
antiguas de ella se quitan las frases que casan con una promesa ya sacada. Es el
más invasivo: la ventana literal es hoy el único sitio donde vive el estado de la
escena y el ancla de su voz, y una promesa recién hecha y aún sin extraer solo
vive ahí (`PENDIENTES-DISENO.md:225`). Tras 1.6 gana peso: si el caso original
llegó por el historial, este es el remedio directo. **Precedente en contra:** Janitor AI probó
en agosto de 2026 a dejar de enviar los mensajes ya resumidos y dio marcha atrás
porque las respuestas «got vaguer or forgot details» (changelog oficial).

### Paso 8 — Aparte, por coste y limpieza · pequeño

- Con la puerta de imagen cerrada, limitar el catálogo a la foto de perfil más las
  últimas 5-6 imágenes, con «hay N más antiguas». Ahorra unos 4.400 caracteres
  (~1.250 tokens) por turno. **Requiere una decisión nueva de Daniel**: `D-090`
  punto 3 dice que el reenvío no se toca. No está demostrado que reduzca la
  repetición.
- Que una respuesta de 24 caracteres con `finishReason` nulo, o una muy corta sin
  memoria, no se guarde como `completed` ni reescriba la memoria.

---

## 3. Catálogo de ideas, por lo que ganaría Lía

Cada idea dice de dónde sale, si Luxy ya tiene algo y con qué restricción choca.
Recordatorio de las restricciones: cada turno es **una** llamada de pago; el
trabajo de fondo va **solo** por Claude Code o Codex con la sesión local
(`D-087`); la llave no vive sin Daniel, así que lo proactivo se **anota** y sale
al abrir; y cuantos más bloques de campos, más suena a formulario.

### 3.1 Variar: no repetirse

**Tope global de cadencia** — *prioridad: pronto.* Es el paso 3. Fuentes, todas
DEMOSTRADAS en su documentación o código: la Author's Note de SillyTavern tiene
«Frequency» (1 = cada mensaje, 4 = uno de cada cuatro); el World Info tiene
probabilidad, sticky, cooldown, delay y grupos de inclusión que dejan pasar una
sola entrada; la extensión DeepLore tiene un cooldown **global** de reinyección
«para evitar que el mismo lore se reinyecte en cada generación»; el sistema de
diálogo de Valve (Source) guarda por **concepto** la hora en que se dijo y no deja
repetirlo antes de `respeakdelay`; Inner Self (AI Dungeon) tira un dado por turno y
solo carga el cerebro de un personaje. Son **mecanismos de cadencia**: ninguno
está documentado como remedio de un personaje que repite una promesa, y la primera
versión de este documento generalizaba de más al decir que «todas las plataformas
que lo resuelven limitan el concepto». **Ya existe:** dosificación por promesa y
`PENDING_MAX_LINES = 2`. **Le falta:** el tope del bloque entero. No habría evitado
el caso original (1.6).

**El permiso como condición, no como orden permanente** — *pronto.* Nomi, en el
resumen de una retransmisión (wiki.nomi.ai, 2025_07): una frase sobre el campo
«Inclination», que es «only for things you're okay with being constantly
present», y la anécdota de un usuario que escribió «usa emojis de vez en cuando» y
los recibía en todos los mensajes. Es un caso, no una regla que Nomi formule en
general. SpicyChat, en su
documentación: un recuerdo fijado se tiene en cuenta y se menciona «frequently».
Kindroid: «Reused words in EM/BS often trigger repeated output» y «describe
personality, not scripts»; el modelo lee una directiva como «en mi respuesta
debo…». Nomi separa además **rasgos** (siempre) de **tendencias** (solo si encajan
en la escena) en sus imágenes V5. INFERIDO, generalizando desde esos casos: lo que
viaja en cada turno con tono de directiva tiende a salir en cada turno, y el bloque
de pendientes de Lía, hoy en el 71 % de los turnos y con «puedes sacar una tú
sola», se parece a eso. Pero el caso original pasó con el bloque ausente en la
mayoría de los turnos (1.6), así que esta vía no lo explica. **Ya existe:**
«Callártela también es una respuesta» y «que sea UNA». **Le falta:** que el empujón
no esté en cada turno.

**Lo dicho está dicho** — *ya.* Paso 2. Además de la bibliografía, es el
consenso de las guías: AI Dungeon manda deshacer hasta antes de la primera
repetición y revisar si la frase está en la memoria o en la Author's Note;
Kindroid admite por escrito que su Repetition Guard no cubre «repetitive ideas or
plot points expressed in varied language» y que sus remedios tocan el
**contexto**; la comunidad de SillyTavern desaconseja regañar al bot citando la
frase.

**Qué jugada hiciste antes** — *después.* Zhan et al. (arXiv 2604.11742, abril de
2026) miden la «tactic stickiness»: los LLM repiten el mismo **tipo** de jugada
(validar, preguntar, prometer...) del turno anterior en un 50-56 % de los casos,
los humanos en un 27 %, y las métricas de similitud no lo ven (BERTScore 0,87
frente a 0,86). Pedir en genérico que varíe la baja algo —de 0,51 a 0,45 en
Qwen-3 1,7B y de 0,57 a 0,52 en 4B—; decirle qué jugada usó en el turno anterior la
baja a 0,38 y 0,40. Caveats DEMOSTRADOS: diálogo de apoyo emocional, modelos de 1,7B
y 4B, no roleplay. En Luxy haría falta etiquetar la jugada: con reglas locales baratas
(¿termina en pregunta?, ¿casa con una promesa?) o por el CLI en diferido.

**Ocultar una respuesta del prompt** — *pronto.* SillyTavern tiene `/hide`, que saca
un mensaje del prompt sin borrarlo; Kindroid, editar en vez de corregir, Rewind y
Chat Break (vaciar la ventana corta con un saludo nuevo que fija tono y
extensión, conservando la memoria larga); AI Dungeon, deshacer. **En Luxy no hay
nada** (DEMOSTRADO): los canales de la bóveda son listar, leer, enviar, borrar la
conversación entera y olvidar la memoria (`apps/desktop/src/shared/channels.ts:58-68`).
Una marca «que no lo vuelva a ver», guardada aparte y cifrada, rompe el bucle sin
tocar el sellado de los turnos y, de paso, es una señal de qué no le gusta a Daniel
(ver 3.2).

**Regenerar** — *después.* Kindroid sube la temperatura **solo** en la regeneración
y sin acumularse. Cuesta una llamada, pero la decide Daniel igual que un turno.

**Temperatura por familia** — *pronto.* Paso 4.

**DRY y XTC** — *quizá.* Ver sección 5: sí existen por HTTP, pero no en el
proveedor de Lía, y no arreglan la repetición de tema.

**Variedad sorteada en el código** — *quizá.* La extensión bf-ooc-injection sortea
en cada mensaje una instrucción de longitud, dirección o tono y no la guarda en el
historial; el preset Deus Ex Machina hace que el modelo proponga cuatro rutas al
pie de su respuesta y el código sortea una para el turno siguiente. Coste cero en
llamadas. Riesgo: suena a formulario y dirige a Lía desde fuera.

**Varios modelos al azar** — *quizá.* Chai midió que mezclar tres modelos
pequeños eligiendo uno al azar por turno igualó o superó a uno de más de 175B
(arXiv 2401.02994). Dado lo mucho que parece pesar el modelo, es interesante;
pero choca con la voz consistente.

### 3.2 Aprender de él

**Lo que Lía sabe de él** — *pronto.* Es lo que Daniel pide con «aprendan de ti», y
todas lo tienen: Character.AI **Facts** (2026, c.ai+: detalles estables del usuario,
del personaje y de secundarios, en pestañas editables y copiables a un chat
nuevo); Replika, pestaña **Memory** con lo que ha aprendido de ti, editable;
Kindroid **Learned Context** (agosto de 2026: «Growth & relationship», «Important
facts», «Ongoing context»); Nomi **Mind Map 2.0** (personas, lugares, temas y metas,
editable y con entradas bloqueables). Fuera del roleplay, el «aprende de ti» más
desplegado (3.6): la memoria de Claude guarda temas sueltos que se leen, se editan
o se borran uno a uno, y se puede pausar sin borrar; ChatGPT combina una lista de
memorias sueltas con un resumen que se actualiza solo. **Ya existe:** el hueco
reservado —`taste` y `person` en `packages/shared/src/vault-relation.ts:29-33`— y
el carril del extractor de promesas por CLI. **Le falta:** productor, consumidor y
pantalla. Encaje: el mismo carril de `D-087`, en diferido (no «mientras se habla»,
que sería una segunda llamada), cifrado como `relation.json`, con cita verificada
como las promesas. **Requisito previo:** saber por qué ese carril lleva 58
revisiones sin apuntar nada (1.5, paso 0). Dos lecciones medidas: el **recordatorio simple**
funciona mejor que los prompts complejos para respetar preferencias (PrefEval,
arXiv 2502.09597; **caído** que sea «lo mejor en general»: RAG y el ajuste fino
rinden más); y una lista plana de recuerdos hace que el modelo meta datos que no
vienen a cuento (arXiv 2608.08300: presentarlos por temas baja esa fuga un 8,8 %).
Riesgos: sobrepersonalización, y los gustos que cambian: HorizonBench (arXiv
2604.17283) mide que los modelos se quedan con el valor antiguo en más de un tercio
de sus errores, así que cada dato necesita fecha y poder corregirse.

**Ver y callar lo que alimentó cada respuesta** — *pronto.* ChatGPT, en su ayuda
oficial: las «Sources» bajo cada respuesta dicen qué chat, memoria o instrucción la
personalizó, y «Don't mention this again» reduce las referencias futuras **sin
borrar el origen** (nota de versión del 05-05-2026: «see what information helped
personalize a response and make edits»). RisuAI, en código abierto, deja filtrar
qué resúmenes entraron en el último prompt y por qué vía (importante, reciente,
parecido o al azar) (3.6). Replika Ultra deja ver qué recuerdo se usó en una
respuesta (ayuda oficial); Kindroid pone un icono de cerebro en cada respuesta con
los recuerdos usados y un botón «despriorizar»; Character.AI enseña un medidor de
qué ocupa el contexto. Del lado de las quejas solo hay una anécdota: una reseña de
Trustpilot (25-02-2026) de un usuario de Replika que no puede borrar recuerdos
invisibles que le hacen repetir. No hay ninguna medida de cuánto se queja la gente
de esto. **Ya existe:** Luxy registra el tamaño de cada bloque en `studio.log` y
tiene la revisión de pendientes (cumplida, liberada, descartada). **Le falta:**
enseñarlo por turno en Studio y un estado «no lo saques más» que no cierre la
promesa: hoy los estados son `open | fulfilled | released | dismissed`
(`vault-relation.ts:40`) y no existe «abierta pero no la saques».

**Favoritos que pesan al consolidar** — *después.* En Kindroid, un mensaje marcado con
el corazón recibe «additional priority» al consolidar la memoria y el Learned
Context, y no es retroactivo. Encaje: el catálogo y el cuaderno de la relación por
CLI (3.3) darían prioridad a lo marcado.

**Aprender en diferido de lo que Daniel corrige** — *después.* CIPHER (arXiv
2404.15269) infiere en texto qué preferencia explica cada edición del usuario y la
recupera después, sin reentrenar; Chai usa «siguió hablando» y «no pidió otra» como
etiquetas (arXiv 2303.06135); RLHI usa la réplica insatisfecha del usuario (arXiv
2509.25137). En Luxy solo cabe la versión sin entrenamiento: el CLI lee lo que
Daniel ocultó o regeneró (si existe 3.1) y lo resume en notas de estilo. Riesgo que
reconoce la propia Replika: sus modelos están diseñados para «align with the user»,
y eso lleva a darle la razón en todo. Hay que separar «lo que a Daniel le gusta» de
«quién es Lía».

**Un pulgar que no cambia nada es un placebo** — lección, no idea. Nomi lo dice en
su retransmisión de 2025-12: el pulgar solo alimenta el entrenamiento global, «Everything
else is just your individual Nomi». Replika y Character.AI también usan las
valoraciones para entrenar el modelo de todos. Luxy no entrena modelos: un botón de
valorar solo tiene sentido si algo lo lee (el CLI de fondo).

**Feedback que ya está en la conversación** — *quizá.* Hasta un 30 % de las
conversaciones contienen feedback explícito («otra vez con eso», reformular,
corregir) (arXiv 2407.10944). Pero la extracción automática acierta poco (precisión
0,43 en los tramos). Podría ayudar a medir la repetición sin pedirle nada a Daniel;
no como única vara.

### 3.3 Evolucionar con él

**Un cuaderno de la relación, escrito en diferido** — *después.* Kindroid Learned
Context («durable scratchpad» que el kin mantiene; activado por defecto); Nomi
**Identity Core** (lo que el personaje decide de sí mismo, separado de lo que escribe
el usuario, y que «no será un espejo tuyo»); Letta separa el agente que conversa del
que reescribe la memoria entre turnos; CharacterGPT (arXiv 2405.19778) distingue
rasgos que se reescriben (personalidad, motivaciones) de rasgos que se acumulan en
orden (historia, relaciones, crecimiento); PHASE-Tree (arXiv 2608.06975) pone una
raíz de identidad inmutable y capas que cambian a distinto ritmo. **Ya existe:** la
memoria acumulativa por conversación (con vocabulario de tarea), el catálogo y la
memoria retroactiva. **Le falta:** una capa **entre conversaciones** sobre la
relación y sobre ella. Encaje: la ficha que escribe Daniel es la raíz inmutable; el
cuaderno lo escribe el CLI cuando la bóveda está abierta (mismo carril que las
promesas; ver el requisito de 1.5), y Daniel lo aprueba, como
las propuestas de «current setting» de Kindroid (el sistema propone y el usuario
confirma). Dos avisos medidos: la evolución solo con prompt es tímida —cambios
reales pero comprimidos 3-4 veces respecto a los humanos (arXiv 2608.06485)—, así
que hay que escribirla, no esperarla; y según un reseñador, Learned Context puede
«aplanar» dinámicas complejas (terceros).

**Ánimo con palabras, no con barras** — *después.* La extensión Smart Memory guarda
cada relación como hasta seis descriptores con intensidad, del tipo «confiada (alta)»,
editables; BetterSimTracker limita cuánto puede cambiar un valor por turno. Es la
forma de dar evolución sin la barra de progreso que ya se descartó. **Ya existe:**
`joy` y `hurt` reservados sin usar (`vault-relation.ts:29-33`).

**Que un asunto vuelva distinto, no igual** — *después.* Oficio narrativo: en Dungeon
World los peligros avanzan por abandono y se notan cuando vuelven; en Blades in the
Dark un reloj avanza por **sucesos**, no por turnos; un running gag solo funciona si
varía y escala. **Ya existe:** `raisedLabel` le dice cuántas veces lo sacó ella.
**Le falta:** que a partir de la segunda vez cambie el **modo** (de recordarlo con
cariño a tomarle el pelo o a dejarlo correr), y que vuelva por algo que ha pasado, no
porque le toque.

**Cerrar arcos** — *pronto, como comprobación.* Smart Memory cierra los hilos resueltos
en un resumen y deja de enviarlos. Luxy ya tiene `fulfilled` y `released`, y el
extractor sabe cerrar (lo hizo dos veces el 15/09), pero en 58 revisiones desde el
16/09 no ha cerrado nada y Daniel tampoco (1.5). Si hay promesas cumplidas que
siguen abiertas, es combustible para el bucle.

**Un repaso de «lo nuestro»** — *quizá.* Nomi Wrapped: una página que el propio
personaje cura con los momentos que importaron. Hace visible la evolución sin
convertirla en marcador. Encaje: CLI en diferido.

### 3.4 Tomar la iniciativa

**Hoy las promesas son su único canal de iniciativa** (DEMOSTRADO: el inventario no
encuentra ningún otro; la de fotos se le quitó a propósito en `D-090`). INFERIDO: si
lo único que puede sacar por su cuenta son deudas, es natural que saque deudas.

**Saber qué hora es y cuánto hace** — *pronto.* Lía no sabe qué día ni qué hora es ni
cuánto hace del último mensaje (DEMOSTRADO por ausencia en `composeVaultPrompt`),
aunque el ancla temporal ya se calcula en `handlers.ts:4541`. Una línea. Le da algo
propio que decir tras una ausencia de tres días en vez de volver a la promesa.
Replika 12 presume de preguntar por algo «when it matters» y un tercero lo describe
como «a chance», una probabilidad, no una regla (la ficha de la App Store no se pudo
verificar: devolvió HTTP 429).

**Oportunidad antes que reloj** — *pronto, junto al paso 3.* Los directores de juego
preparan revelaciones sin sitio fijo y las sueltan cuando la escena da pie (Sly
Flourish, «secrets and clues»); The Alexandrian reserva el empujón proactivo para
cuando la escena se atasca; PlotBrain recuerda una promesa **cuando vuelve la persona
o el objeto** que tiene que ver; en Fallen London gana el contenido que más condiciones
cumple y lo ya usado pesa en contra. **Ya existe:** `touched` (él la nombra) manda
sobre los descansos, y la búsqueda por palabras clave. **Le falta:** que sin pie
en la escena no se ofrezca.

**Un depósito de cosas que decir** — *después.* Inner Thoughts (arXiv 2501.00383,
CHI 2025): el agente genera pensamientos en paralelo y solo dice los que superan un
umbral, puntuados con ocho criterios entre ellos **originalidad** («no repetir lo ya
dicho»); los que no dice esperan. Encaje: el CLI, entre turnos, genera candidatos
(una promesa, una curiosidad, algo de su día), los puntúa; el código ofrece **uno**
por encima del umbral y lo retira en cuanto se usa. Hace esporádica la iniciativa por
diseño. Coste: una tarea más en el carril de `D-087`, que antes tiene que demostrar
que produce (1.5).

**Lo proactivo anotado, finito y que se retira** — *después.* Ya decidido que se
anota y sale al abrir. Lo que añaden las plataformas: Nomi espera «about double the
time» si su mensaje queda sin respuesta; Kindroid reduce la frecuencia si no contestas
y deja visible cuando decide **no** escribir; ChatGPT Pulse entrega unas pocas tarjetas
y se para («that's it for today»); en un estudio CHI 2025 con asistentes de programación
el modo insistente bajó la preferencia al 47 % y lo llamaron «annoying» (otro dominio).

**Vida propia simulada** — *quizá.* Plan del día (Generative Agents), necesidades que
decaen (Humanoid Agents), deseos (D2A), un narrador aparte (Concordia). Caro en
llamadas y en campos; cabe como «algo de su día» dentro del depósito anterior.

### 3.5 Sonar a ella misma

**Un diálogo de ejemplo en la ficha** — *ya.* DEMOSTRADO en el registro: «quién eres»
ocupa 67 caracteres, las instrucciones 405, y el prompt no tiene ningún hueco para
ejemplos (grep de `ejemplo`/`example` en `vault-prompt.ts`: nada). Character.AI admite
hasta 32.000 caracteres de definición con intercambios de ejemplo y pide poner lo
importante al principio; Kindroid: el Example Message sirve para «lock in formatting,
tone, and speech style», y en grupos los personajes solo suenan distintos si cada
uno tiene el suyo; la guía Ali:Chat: el modelo copia patrones, no adjetivos; Ditto
(arXiv 2401.12474): el estilo se adquiere fácil. Avisos de Kindroid: un ejemplo con
patrones repetitivos se imita «rigidly», y las palabras del ejemplo tienden a
repetirse. Lo escribe Daniel.

**Qué es lo último que lee antes de escribir** — *pronto.* DEMOSTRADO: el bloque de
imagen va al final, **después del mensaje nuevo**. AI Dungeon y SillyTavern coinciden
en que lo que va más cerca del final es lo que más pesa en la respuesta inmediata.
HIPÓTESIS: que lo último que Lía lee sea un catálogo de fotos no ayuda a su voz. Mover
el bloque delante del mensaje o dejar al final una línea corta de voz es barato; hay
que medirlo.

**Sus turnos rotulados «Asistente:»** — *pronto, con A/B.* DEMOSTRADO: el historial
va aplanado en un único mensaje de usuario y sus respuestas llevan la etiqueta
«Asistente» (`vault-prompt.ts:308-309` y `736-738`). HIPÓTESIS: tira hacia el tono de
asistente y facilita copiar la transcripción. Probar con su nombre.

**Un vigilante de la voz, en diferido** — *después.* Leins et al. (arXiv 2609.24532,
21-09-2026): cada 4 turnos un monitor compara la conducta real con la esperada y, si se
desvía, mete una instrucción de 2-4 frases que nombra **solo** lo desviado, válida para
la respuesta siguiente. 87 % frente a 35 % de la reinyección estática de la ficha
completa, con cuatro LLM, DeepSeek V4 Flash entre ellos. Caveats DEMOSTRADOS: la
«deriva» medida era la expresión de síntomas simulados de TDAH, no un personaje de
roleplay, y el contenido va mezclado con el momento. Encaje: el monitor es el CLI
entre turnos (sin coste de llamada), con un turno de retraso, por el carril que
antes tiene que demostrar que produce (1.5). Podría vigilar también la repetición.

**Elegir el modelo por la voz** — *pronto.* Replika tuvo que ofrecer volver a la versión
antigua del modelo tras un cambio (prensa, 2023); en Character.AI, tras PipSqueak 2,
usuarios dicen que hacia el turno 50 todos los personajes «hablan igual» (terceros que
recogen hilos de Reddit que no se pudieron abrir). El razonamiento explícito no mejora el
roleplay (arXiv 2502.16940). Y el registro de Lía muestra diferencias enormes por modelo.
Comprobar si `hcnsec` sirve DeepSeek con el razonamiento activado.

**Que no le dé la razón en todo** — *quizá.* Nomi entrena para que el personaje «stands
by you» sin ceder bajo presión; presets de la comunidad traen reglas contra la personaje
empalagosa. **Ya existe:** la encarnación le permite dudar, frenar o decir que no
(`vault-prompt.ts:612-622`).

### 3.6 Lo que faltaba en la primera ronda

Cuatro frentes que la primera ronda no miró. Límites de esta pasada: la búsqueda web
estaba agotada, así que todo sale de páginas abiertas directamente (algunas a
través del lector `r.jina.ai`, porque help.openai.com y openai.com devuelven 403); las
frases entre comillas pasaron por el resumen de otro modelo; y los números de línea de
RisuAI son aproximados.

**MiniMax: Talkie y Xingye.** DEMOSTRADO según la Wikipedia en inglés (que cita al WSJ
y a The Wire China): Talkie salió en junio de 2023 y Xingye (星野) en septiembre de
2023; tenía unos 11 millones de usuarios activos al mes en julio de 2024.

- Talkie **no documenta una memoria del usuario que se vea o se edite**: su FAQ
  reconoce que las conversaciones antiguas se «olvidan». Su sección «Memory» es otra
  cosa: una galería social de trozos de chat compartidos, con likes.
- Su evolución está **en el modelo, no en cada usuario**. El post de MiniMax-M2-her
  describe RLHF en línea con señales explícitas (regenerar, me gusta / no me gusta) e
  implícitas (duración de la sesión, número de turnos). Y reconoce el problema de
  Lía: «Models naturally tend toward mechanical loops and repetitive phrasing», con la
  calidad cayendo hacia el turno 20. Lo miden con su **Role-Play Bench**, una de cuyas
  categorías de fallo es «repetitive plot beats».
- **No se sabe** cómo guarda Xingye lo que aprende ni si deja editarlo: la portada solo
  tiene eslóganes.
- Frente a Luxy: el aprendizaje entrenando el modelo global está descartado (sección
  5). Aporta una vara de medir la repetición de trama y la confirmación, del lado de
  un fabricante, de que los modelos tienden solos al bucle. HIPÓTESIS: M2-her como
  modelo para Lía. Comprobación: si `MiniMax-M2-her` sale en el `/v1/models` de alguna
  conexión *chat completions*.

**RisuAI: SupaMemory y HypaMemory.** El frontend abierto alternativo a SillyTavern
(`github.com/kwaroran/Risuai`, `src/ts/process/memory/`). DEMOSTRADO en el código:

- SupaMemory resume los mensajes viejos cuando se pasa del contexto, y vuelve a
  resumir el resumen cuando crece: es recursivo.
- HypaMemory v3 resume de 6 en 6 mensajes, reserva el 20 % del contexto para memoria y
  lo reparte así: primero los resúmenes marcados como importantes; un 40 % para los
  recientes; un 40 % para los parecidos por embeddings a los últimos 3 mensajes; y **el
  resto, al azar** (por defecto un 20 %).
- Su pantalla deja, por cada resumen, editarlo, marcarlo con estrella, regenerarlo,
  borrarlo, ver los mensajes de origen y etiquetarlo. Y **filtrar qué resúmenes
  entraron en el último prompt y por qué vía** (importante, reciente, parecido o al
  azar).
- Frente a Luxy: esa vista es la idea 5 ya hecha en código abierto; la estrella es la
  prioridad de Kindroid. La cuota al azar da variedad por diseño, pero aplicada a los
  pendientes haría lo contrario de lo que se busca (sacarlos más): sirve como patrón,
  no para copiarla. Resumir dentro del turno sería una segunda llamada; por el carril
  del CLI sí cabe. Los embeddings por API son otra llamada de pago; con un modelo
  local, no.

**La memoria de ChatGPT y de Claude**, el «aprende de ti» más desplegado del mundo.
DEMOSTRADO en su documentación oficial:

- **ChatGPT:** memoria desde 2024; desde abril de 2025 también consulta todo el
  historial. Guarda cuando se le pide y por su cuenta, y convive una lista de memorias
  sueltas con un resumen que se actualiza solo. Bajo cada respuesta pueden salir las
  **Sources** que la personalizaron. **«Don't mention this again»** reduce las
  referencias futuras sin borrar el origen. Notas de versión de 2026: fuentes de
  memoria editables (05-05), memoria más al día (04-06), borrar y apagar (12-06).
- Queja documentada: una, la de Simon Willison (21-05-2025). ChatGPT le metió en una
  imagen un detalle sacado de chats anteriores, y los únicos remedios eran apagarlo
  todo o archivar chats. **No se sabe** si hay quejas documentadas de que saque
  recuerdos «en cada respuesta». HIPÓTESIS: que «Sources» y «Don't mention this
  again» nacieran de esas quejas; ninguna fuente lo dice, solo coinciden en el tiempo.
- **Claude:** memoria desde septiembre de 2025 (Team y Enterprise) y octubre (Pro y
  Max). Hoy guarda «a set of individual topics»: cada tema se lee, se edita o se borra
  en Ajustes; se le puede pedir desde el chat que recuerde u olvide algo; cada
  proyecto tiene memoria aparte; se puede **pausar** (conserva lo guardado y deja de
  crear) sin reiniciar. El anuncio dice que se probó si la memoria llevaba a
  «over-accommodation». La página no aclara si la memoria entra en todas las
  respuestas o solo cuando viene a cuento.
- Frente a Luxy: no hay equivalente de «Sources» ni de «Don't mention this again» (idea
  5), ni de los temas editables uno a uno (idea 4), ni un «pausar aprendizaje». La
  pantalla y la supresión son locales y sin llamada. Escribir los datos mientras se
  habla, como Claude, sería una segunda llamada de pago; en diferido por el CLI encaja
  con `D-087`, a costa de no ser inmediato.

**Los compañeros de Grok.** DEMOSTRADO: salen en julio de 2025 con modo NSFW, y la FAQ
de Grok dice que solo están en la app de iOS. La Wikipedia cuenta 5 a finales de
febrero de 2026, en una sección sin fuentes. **No se sabe** si hubo niveles de afecto
ni si se retiraron: ni las noticias de xAI, ni la ficha de la App Store, ni TechCrunch
(15-07-2025) los describen. No aporta nada nuevo: el descarte de la relación con puntos
y niveles se sostiene solo.

---

## 4. Lo que ya existe y lo que le falta

| lo que Luxy ya tiene | lo que la industria sugiere que le falta |
| --- | --- |
| Dosificación por promesa (`relation-selection.ts:39-57`) | Tope del bloque entero; tirada de probabilidad; preferir oportunidad |
| Bloque de pendientes con «callártela también es una respuesta» | Que el empujón no viaje en cada turno |
| Medida de eco (`handlers.ts:4632-4666`) | Que mida lo que viaja, por promesa, con placebo y con el modelo |
| Parámetros de muestreo en `providers.http` (`D-098`) | Que lleguen a las familias de una conexión, que es por donde va Lía |
| Tipos `taste`, `person`, `joy`, `hurt` reservados | Productor, consumidor y pantalla |
| Revisión de pendientes (cumplida, liberada, descartada) | Un «no lo saques más» sin cerrarla («Don't mention this again» de ChatGPT); ver por turno qué entró («Sources», la vista del último prompt de RisuAI) |
| Borrar una conversación entera y olvidar su memoria | Ocultar o regenerar una respuesta concreta; pausar el aprendizaje sin borrar (Claude) |
| Carril de fondo por CLI (`D-087`) | Saber por qué lleva 58 revisiones sin apuntar nada; después, usarlo para algo más que promesas y catálogo: cuaderno, gustos, vigilante, depósito |
| Línea `pendientes extraidos` en `studio.log` | Que desglose `proposed`, `merged`, `rejected*` y `clipped` por tanda |
| Ancla temporal calculada (`handlers.ts:4541`) | Enseñársela a Lía |
| Encarnación y ficha | Un diálogo de ejemplo |
| `touched`: si él la nombra, manda | Que sin pie en la escena no se ofrezca |

---

## 5. Descartado, con motivo

| idea | motivo |
| --- | --- |
| Reintento automático cuando la respuesta repite (Repetition Guard de Kindroid, corte temprano de Janitor) | Es una segunda llamada dentro del turno de pago. Kindroid lo dejó apagado por defecto en agosto de 2026 y admite que no cubre ideas repetidas con otras palabras |
| Penalizaciones de frecuencia y presencia con DeepSeek | La API oficial dice que «will not take effect». Además, en servidores tipo vLLM solo miran lo generado en esa llamada, no los turnos anteriores (docstrings de vLLM) |
| DRY y XTC con el proveedor actual de Lía | La pasarela es de DeepSeek, que no los tiene, y ese motivo basta. El segundo —que DRY solo corta copias literales; su autor admite que no para «paraphrasing and situational looping»— pierde fuerza tras 1.6: el caso original fueron repeticiones «casi con las mismas palabras». Si Lía cambia a un proveedor que lo tenga, se reabre |
| Palabras vetadas (muted words de Character.AI) | Solo coincidencias exactas: se esquivan con un sinónimo o una forma flexionada (terceros) |
| Cualquier paso que piense antes de responder con otra llamada (Stepped Thinking, Objective con comprobación) | Segunda llamada dentro del turno |
| Entrenar con valoraciones (Chai, Replika, Character.AI, MiniMax Talkie con RLHF en línea, MINT, DITTO) y todo lo que toca los logits (split-softmax, decodificación contrastiva) | Luxy no entrena modelos ni ve logits por HTTP |
| Relación gamificada con puntos y niveles | Se mantiene el descarte de septiembre, que se sostiene solo. Sobre los niveles de afecto de los compañeros de Grok no se encontró fuente primaria, ni de que existieran ni de que se retiraran (3.6): no se usa como argumento |
| Mensajes que el personaje escribe solo, con la bóveda cerrada | La llave no vive sin Daniel; lo proactivo se anota |
| Despedidas que retienen («¿ya te vas?») | Antipatrón medido: el 37 % de 1.200 despedidas en apps de compañía usan culpa o miedo a perderse algo para retener (De Freitas et al., arXiv 2508.19258) |
| Gastar un turno de Daniel cada N turnos en generar un arco (Story Arc Engine) | Un turno de pago que no es suyo |
| Lorebook por palabra clave | Ya estaba en la ronda de septiembre (World Info) |

---

## 6. Lo que corrige de `docs/ROLEPLAY-MEMORIA.md`

1. **«Antirrepetición por muestreo (DRY, XTC): no existe sobre HTTP»** — FALSO en
   general. Existen en servidores compatibles con OpenAI: llama.cpp, KoboldCpp,
   Aphrodite y TabbyAPI. Faltan en la API de DeepSeek y en OpenRouter (según sus
   documentaciones), y en vLLM principal hay un PR abierto. El descarte se mantiene
   **para el proveedor actual de Lía**, pero por otro motivo: su API no los tiene, y
   solo frenan la repetición literal. **CAÍDO** en esta ronda: que falten en
   Featherless y NanoGPT (ninguna fuente citada trata de ellos) y que TabbyAPI tenga
   `no_repeat_ngram_size` (no está en el archivo citado).
2. **«Relación gamificada (Replika): descartada»** — se mantiene, pero **no arrastra
   con ella la evolución de la relación**: hay formas sin barras (descriptores con
   intensidad, cuaderno de la relación, Identity Core).
3. **Fase 5, «ampliar la ventana es gratis en dinero»** — ahora hay una razón para no
   tocarla ni en un sentido ni en otro hasta medir: si Lía se copia a sí misma, una
   ventana mayor le da más de sí misma que copiar; y Janitor AI comprobó que recortar
   los mensajes literales vuelve al personaje vago y olvidadizo.
4. **Fase 3, «las instrucciones de imagen ocupan ~2.050 tokens»** — hoy el bloque, con
   la puerta cerrada, ocupa 7.647 caracteres (36 % del prompt), crece unos 257 por
   imagen porque el catálogo no tiene tope, y va **después** del mensaje nuevo. La
   reducción de `D-090` se la comió el crecimiento.
5. **Fase 7, «lo proactivo se vuelve un remate barato»** — necesita además retirada
   si no hay respuesta y entrega finita (Nomi, Kindroid, ChatGPT Pulse); insistir hunde
   la aceptación.
6. **«El riesgo que no arregla ninguna fase» (la voz converge a la del modelo)** —
   ya no es del todo cierto: hay remedios medidos o documentados que caben en Luxy (el
   diálogo de ejemplo, el vigilante de la voz de arXiv 2609.24532, decirle qué jugada
   usó). Ninguno lo elimina.
7. **Character.AI** — el «presupuesto de memoria visible» de septiembre se ha
   convertido en Story Memory con recuerdos fijados protegidos de la compresión, Facts
   y un medidor de uso (blog oficial, mayo de 2026).
8. **Fase 6** — a la puntuación recencia × relevancia × importancia se le puede
   sumar **diversidad**, como hace Kindroid desde mayo de 2026 («relevance, recency,
   and diversity»).

---

## 7. Hallazgos laterales

- **Privacidad** (reportado sin citar): el inventario encontró que
  `packages/shared/src/vault-image-gate.ts:6-11` y la cabecera de
  `vault-image-gate.fixture.ts` contienen frases literales de una conversación real,
  y que `DECISIONS.md` (`D-090`) cita fragmentos. Son archivos versionados con remoto
  en GitHub. No se ha comprobado si el repositorio es público.
- **La cifra de `CURRENT-TASK.md` sobre el bloque de pendientes (16 de 95)**: la
  primera versión la despachó como «de otro periodo», y no lo es: cubre el caso
  original. Está reconciliada en 1.6. Mezcla 34 líneas anteriores a que existiera
  el bloque y 13 de otros hilos; contada sobre Lía con la función activa es 16 de
  48 (33 %). Su conclusión para aquel caso («no busques el fallo ahí») se sostiene:
  el caso pasó con el bloque ausente en la mayoría de los turnos.
- **Documentación desfasada**: `D-058` dice «sin implementar» y
  `episodes.ts`/`recall.ts` lo implementan; el bloqueo por desfase (`LA-045`) vale 0 en
  124 de 125 prompts. No se ha tocado ninguno de esos archivos.
- `studio.log` está limpio: ningún campo de texto pasa de 120 caracteres.

---

## 8. Lo que no se sabe

- La tasa real de repetición y cuánto del 58-75 % del contador es ruido.
- Si las «promesas» que Daniel ve están entre las 10 apuntadas.
- Si la causa principal es la autocopia, el modelo o el bloque.
- Si `summary`, `facts` o `decisions` llevan la promesa.
- Si algún título del índice de recuerdos nombra una promesa.
- Si las instrucciones y la ficha que escribió Daniel empujan a recordar promesas
  (solo él puede leerlas).
- Si la pasarela `hcnsec` reenvía la temperatura, si corre DeepSeek en modo
  razonamiento y si es la API oficial.
- Qué contienen las 4 respuestas de 24 caracteres del 21/09.
- Si las 58 revisiones del extractor desde el 16/09 devolvieron listas vacías o
  propuestas que se fusionaron o se rechazaron (lo dice el diagnóstico de memoria,
  paso 0).
- Qué conversación fue la de los 17 turnos: `d0685ae5` (turnos 1-17) es lo más
  probable; lo cerraría la hora del mensaje de Daniel en la transcripción de Claude
  Code del 17/09.
- Por qué la presencia del bloque subió del 52 % al 71 % en `d0685ae5` (hipótesis
  de los reposos de reloj en 1.6).
- Por qué el 15/09 el registro suma 13 apuntados y el almacén tenía 12 notas.
- Cómo guarda Xingye lo que aprende; si los compañeros de Grok tuvieron niveles de
  afecto; si hay quejas documentadas de que ChatGPT saque recuerdos en cada
  respuesta.

---

## 9. Fuentes

### Código y registros de Luxy

- `packages/shared/src/vault-prompt.ts` (ventana `:36`, `:706-741`; bloque de
  pendientes `:442-472`; imagen `:774`; encarnación `:599-625`)
- `apps/desktop/src/main/vault/relation-selection.ts` (`:39-57`, `:388-391`, `:398-402`)
- `apps/desktop/src/main/vault/relation.ts` (`:35-38`, `:97-113`)
- `apps/desktop/src/main/ipc/handlers.ts` (`:4403`, `:4645-4651`)
- `apps/agent/src/providers/http-provider.ts` (`:460-461`, `:538-550`)
- `apps/agent/src/agent.ts` (`:386-404`)
- `packages/shared/src/schemas.ts` (`:243-266`)
- `packages/shared/src/vault-relation.ts` (`:29-33`)
- `apps/desktop/src/shared/channels.ts` (`:58-68`)
- Segunda ronda: `apps/desktop/src/main/vault/relation-selection.ts` (`:45`, `:51`,
  `:313-316`, `:405-411`, `:483-510`); `apps/desktop/src/main/vault/relation-sync.ts`
  (`:573-581`, `:794-809`); `apps/desktop/src/main/vault/relation.ts` (`:161-185`);
  `apps/desktop/src/main/vault/relation-store.ts` (`:305`);
  `packages/shared/src/vault-relation.ts` (`:40`, `:543-552`, `:771-785`);
  `apps/desktop/src/main/ipc/handlers.ts` (`:2707-2721`); `CURRENT-TASK.md:108-116`;
  `git log -S`/`-G` sobre `relation-selection.ts` desde `bf00fee` hasta `29f829d`
- `%LOCALAPPDATA%/Luxy/logs/studio.log` y `luxy.log` (solo cifras)

### Plataformas

- Character.AI — https://blog.character.ai/memory/ ;
  https://blog.character.ai/pipsqueak2-and-more/ ;
  https://blog.character.ai/reducing-repetition-in-character-conversations/ ;
  https://blog.character.ai/prompt-design-at-character-ai/ ;
  https://book.character.ai/character-guide/character-attributes/definition ;
  https://blog.character.ai/inside-kaiju-building-conversational-models-at-scale/ ;
  https://support.character.ai/hc/en-us/articles/32658130419355-What-is-the-Muted-words-feature .
  **CAÍDO:** que Facts avise «al registrarse»; que Story Memory se llamara antes
  Pinned Memories; que Chat Memories se retirase en mayo de 2026; las «estrellas de 1 a
  4» en el post de Kaiju.
- Replika — https://github.com/lukalabs/replika-research (charlas SCAI 2019 y 2021);
  https://help.replika.com/hc/en-us/articles/115001095972-How-do-I-teach-my-Replika ;
  https://help.replika.com/hc/en-us/articles/37292892831885-What-is-Replika-Ultra ;
  https://blog.replika.com/posts/creating-a-safe-replika-experience .
  Sin verificar: el relanzamiento 12.x de 2026 (la App Store devolvió 429).
- Nomi — https://nomi.ai/updates/introducing-the-nomi-identity-core-fostering-dynamic-and-authentic-identities/ ;
  https://nomi.ai/updates/mind-map-2-0-bringing-nomi-memory-into-view/ ;
  https://wiki.nomi.ai/2025_07_Stream_Summary ; https://wiki.nomi.ai/2026_02_Stream_Summary ;
  https://wiki.nomi.ai/V5_Images_&_Appearance_Guide ;
  https://nomi.ai/nomi-knowledge/proactive-messaging-when-your-nomi-messages-you-first/ .
  **CAÍDO:** «pulgas» en la taxonomía de fallos; la cita «saben quiénes son y lo
  aplican el 100 % del tiempo» atribuida al stream de 2026-09 (el informe la situaba
  también en el de 2025-07, sobre Solstice; esa atribución no se verificó).
- Kindroid — https://kindroid.ai/v2/docs/memory/ ;
  https://kindroid.ai/v2/docs/update-log/ ;
  https://kindroid.ai/v2/docs/chat-features-and-tools/ ;
  https://kindroid.ai/v2/docs/ember-llm-guide/ ;
  https://kindroid.ai/v2/docs/equinox-v7-llm-guide/ .
  **CAÍDO:** que Kindroid prohíba a la IA reescribir el backstory (es inferencia); la
  fecha del 23/08 para los favoritos.
- SillyTavern — https://docs.sillytavern.app/usage/core-concepts/authors-note/ ;
  https://docs.sillytavern.app/usage/core-concepts/worldinfo/ ;
  https://docs.sillytavern.app/extensions/objective/ ;
  https://docs.sillytavern.app/usage/st-script/ ;
  https://github.com/pixelnull/sillytavern-DeepLore ;
  https://github.com/senjinthedragon/Smart-Memory ;
  https://github.com/BF-GitH/bf-ooc-injection ;
  https://github.com/lsennn/Deus-ex-machina ;
  https://github.com/3271097126/sillytavern-plotbrain ;
  https://rentry.org/Sukino-Guides ; https://rentry.co/alichat ;
  https://rpfiend.com/deepseek-v4-flash-presets-sillytavern/ (terceros).
- Muestreo — https://github.com/oobabooga/text-generation-webui/pull/5677 (DRY);
  https://github.com/oobabooga/text-generation-webui/pull/6335 (XTC);
  https://aphrodite.pygmalion.chat/usage/openai/ ;
  https://raw.githubusercontent.com/vllm-project/vllm/main/vllm/sampling_params.py ;
  https://api-docs.deepseek.com/api/create-chat-completion ;
  https://api-docs.deepseek.com/quick_start/parameter_settings/ .
- Plataformas adultas — https://docs.spicychat.ai/product-guides/premium-features/memory-manager.md ;
  https://docs.spicychat.ai/product-guides/director-mode.md ;
  https://janitorai.com/news/changelog/ ;
  https://help.janitorai.com/en/article/chat-memory-context-management-9oivt3/ .
  **CAÍDO:** que el Director Mode de SpicyChat valga para un solo turno.
- NovelAI y AI Dungeon — https://docs.novelai.net/en/text/lorebook/ ;
  https://docs.novelai.net/en/text/editor/advancedsettings/ ;
  https://help.aidungeon.com/faq/how-to-avoidfix-repetition-in-my-story ;
  https://help.aidungeon.com/faq/what-is-the-authors-note ;
  https://github.com/LewdLeah/Inner-Self .
  **CAÍDO:** el rediseño de memoria de AI Dungeon de febrero de 2026 (la página no se
  pudo leer).
- Oficio — https://slyflourish.com/eight_steps_2023.html ;
  https://www.dungeonworldsrd.com/gamemastering/fronts/ ;
  https://bladesinthedark.com/progress-clocks ;
  https://thealexandrian.net/wordpress/4147/roleplaying-games/dont-prep-plots ;
  https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/game/server/ai_speech.cpp ;
  https://emshort.blog/2016/04/12/beyond-branching-quality-based-and-salience-based-narrative-structures/ .
  **CAÍDO:** que el callback de comedia se defina por distancia y recontextualización
  (la Wikipedia no lo dice).
- MiniMax — https://en.wikipedia.org/wiki/MiniMax_(company) ;
  https://www.talkie-ai.com/faq ; https://www.talkie-ai.com/memory ;
  https://www.talkie-ai.com/blog/m2-role-play ; https://www.xingyeai.com/ .
- RisuAI — https://github.com/kwaroran/Risuai (`src/ts/process/memory/supaMemory.ts`,
  `hypav3.ts`, `hypamemory.ts`; `src/lib/Others/HypaV3Modal.svelte`).
- ChatGPT — https://openai.com/index/memory-and-new-controls-for-chatgpt/ ;
  https://help.openai.com/en/articles/8590148-memory-faq ;
  https://help.openai.com/en/articles/6825453-chatgpt-release-notes ;
  https://simonwillison.net/2025/May/21/chatgpt-new-memory/ .
- Claude — https://claude.com/blog/memory ; https://support.claude.com/en/articles/11817273 .
- Grok — https://en.wikipedia.org/wiki/Grok_(chatbot) ; https://grok.com/faq ;
  https://techcrunch.com/2025/07/15/of-course-groks-ai-companions-want-to-have-sex-and-burn-down-schools/ .
  **CAÍDO:** que los niveles de afecto se retiraran en 2026 (un tercero sin fuente).
- **CAÍDO en la segunda ronda:** «todas las plataformas que lo resuelven limitan el
  concepto» (generalización sin fuente); «Nomi lo documenta: lo que viaja en cada
  turno sale en cada turno» (es inferencia de un caso); «el remedio nº 1 de la
  comunidad y la queja nº 1 de Replika» (sin medida; una sola reseña); «87 % frente
  a 35 % de un recordatorio reflexivo» (el 35 % es reinyectar la ficha completa);
  «pedir variedad apenas cambia nada» (baja de 0,51 a 0,45 y de 0,57 a 0,52); «la
  cifra de 16 de 95 es de otro periodo» (cubre el caso original).

### Papers

- Repetición: Xu et al. 2022, arXiv 2206.02369; See et al. 2019, arXiv 1902.08654;
  Zhan et al. 2026, arXiv 2604.11742; Wan et al. 2026, arXiv 2602.03664; Li et al.
  2026, arXiv 2609.05882; Sinha et al., arXiv 2509.09677; Laban et al. 2025, arXiv
  2505.06120; Yan et al. 2024, arXiv 2310.00297; Li et al. 2019, arXiv 1911.03860;
  Paech et al. (Antislop), arXiv 2510.15061; Castricato et al. 2024, arXiv 2402.07896;
  Pucci et al. 2026, arXiv 2609.04484; Verbalized Sampling, arXiv 2510.01171.
- Persona y voz: Leins et al. 2026, arXiv 2609.24532; Li et al. 2024, arXiv
  2402.10962; DynSess, arXiv 2605.29256; Ko y Geiping, arXiv 2606.30571; Assistant
  Axis, arXiv 2601.10387; RoleLLM, arXiv 2310.00746; Ditto, arXiv 2401.12474; Feng et
  al., arXiv 2502.16940.
- Evolución: CharacterGPT, arXiv 2405.19778; PHASE-Tree, arXiv 2608.06975; Wang et
  al., arXiv 2608.06485; Skjuve et al. 2023 (Interacting with Computers).
- Aprendizaje del usuario: PrefEval, arXiv 2502.09597; PersonaMem, arXiv 2504.14225;
  HorizonBench, arXiv 2604.17283; arXiv 2608.08300; Don-Yehiya et al., arXiv
  2407.10944 y 2609.02859; CIPHER, arXiv 2404.15269; RLHI, arXiv 2509.25137; Chai,
  arXiv 2303.06135 y 2401.02994; RMM, arXiv 2503.08026.
- Iniciativa: Inner Thoughts, arXiv 2501.00383; Generative Agents, arXiv 2304.03442;
  Humanoid Agents, arXiv 2310.05418; D2A, arXiv 2412.06435; MIRROR, arXiv 2506.00430;
  Concordia, arXiv 2312.03664; CHI 2025 asistentes proactivos, arXiv 2410.04596;
  sleep-time compute, arXiv 2504.13171.
- Antipatrones: De Freitas et al., arXiv 2508.19258.
