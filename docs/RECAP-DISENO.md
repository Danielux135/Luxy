# F24-RECAP-001 — memoria acumulativa para las conversaciones que ya existen

Diseño definitivo, listo para implementar. Todo lo técnico de aquí está verificado leyendo el worktree el 2026-09-14; los números de línea que cito pueden moverse (hay 20 archivos modificados sin commitear ahora mismo), pero los nombres de función y los invariantes no.

---

## 0. Lo que hay de verdad en la bóveda (medido, no estimado)

Contando líneas y bytes de `%APPDATA%\Luxy\vault\conversations`, **sin descifrar nada**:

- **18 archivos, 308 turnos.**
- Turnos por conversación: 65, 53, 33, 28, 24, 22, 18, 12, 10, 9, 6, 6, 6, 6, 4, 2, 2, 2.
- Registros con `"sealedMemory"` no nulo: **9, y los 9 están en la conversación de 28 turnos** (la posterior al arreglo del 11-09).
- Es decir: **17 conversaciones con cero memoria acumulativa, 280 turnos.** Coincide exactamente con el encargo.

Esto fija el dimensionado real: con ventanas de 40 turnos, **16 de las 17 caben en una sola llamada** y sólo la de 65 y la de 53 necesitan dos. **20 llamadas de suscripción, una sola vez.** El tiempo por llamada no tiene ninguna medida en el repositorio (el «11-16 s de arranque» de `docs/PENDIENTES-DISENO.md:241` no está respaldado por `TEST-RESULTS.md` ni por `CHANGELOG-WORK.md`): trátalo como conjetura y mídelo en el paso 8.

---

## 1. Hallazgo que cambia el diseño respecto a lo que se propuso

**El prompt privado YA lleva, en cada turno, una línea de índice por cada episodio de la bóveda — incluidos los de la conversación abierta.**

Verificado: `buildRecall` llama a `selectIndexEpisodes(all, MAX_EPISODE_LINES)` con tope 40 (`apps/desktop/src/main/vault/recall.ts:818-821`) y **no filtra por `isAlreadyInPrompt`**, al contrario que el camino de la cita (`:904`, `:930`). Hoy hay 40 momentos y el tope es 40, así que entran todos. Cada línea es, en `formatRecallLines` (`packages/shared/src/vault-prompt.ts:302-307`):

```
- [r3] 2026-09-03 · <titulo> · 12 turnos
```

Y **el resumen del catálogo sólo lo lleva el episodio MÁS ANTIGUO de todos** (`recall.ts:834-841`: la condición es `episodeKey(episode) === episodeKey(primero)`).

Consecuencias directas, y hay que tomarlas en serio:

1. **Una «memoria» deducida del catálogo que repita fechas y títulos es relleno puro.** Ya viaja. Lo único que el catálogo aporta y el prompt NO lleva es el **`summary` de cada escena** (≤300 caracteres).
2. Por tanto el nivel deducido existe, pero **se llama índice, no memoria**, sólo lleva los resúmenes de escena, y **no cuenta como cobertura**.
3. Y sobre todo: **la mera presencia de memoria apaga el aviso de turnos omitidos** (`vault-prompt.ts:581` — la condición es `omitted > 0 && input.memory === null`, y la prueba que lo fija está en `vault-prompt.test.ts`). Meter un índice ahí sin tocar el prompt sería una **regresión de seguridad**: Lía perdería la orden de preguntar en vez de suponer, justo cuando lo que tiene es un índice.

---

## 2. Qué se hace, en una frase

Se genera hacia atrás la memoria acumulativa de las 17 conversaciones con Claude Code o Codex, por ventanas, acumulando ventana a ventana; **no se toca ni un byte de los `.jsonl` sellados**; el resultado vive en un almacén cifrado nuevo (`vault/recap.json`) que el turno privado usa **como respaldo sólo mientras esa conversación no tenga memoria sellada**; y el prompt **declara** cuándo lo que lleva es parcial o es sólo un índice.

El objetivo no es «17 de 17 resumidas». Es: **ninguna conversación se queda a medias en silencio.**

---

## 3. Dónde vive la memoria, y por qué NO dentro del `.jsonl`

### 3.1 Archivo nuevo

`%APPDATA%\Luxy\vault\recap.json`, hermano de `catalog.json` y `relation.json`. Clase `RecapStore`, **calcada de `relation-store.ts`, no de `catalog-store.ts`**:

- cifrado con `vault.subkeyFor('identity', 'recap')` y propósito `'vault.identity'` — exactamente como el catálogo (`identity` + contexto `catalog`) y los pendientes (`identity` + contexto `relation`). **Deliberadamente NO se usa `subkeyFor('memory', …)`:** ese dominio es el de la memoria sellada dentro de un registro, y compartirlo haría que un sobre de recap abriera con la misma familia de llaves que un `sealedMemory`, invitando a moverlo de un sitio a otro. Aquí lo que se quiere es que eso sea imposible por construcción. `'identity'` está en `KEY_DOMAINS` (`packages/vault-crypto/src/kdf.ts:133-141`) y `'vault.identity'` funciona como propósito porque `assertPurpose` sólo valida el juego de caracteres y `VAULT_PURPOSES` sólo gobierna los registros que viajan al servidor;
- escritura atómica **con `fsync` antes del `rename`** y `.tmp` sellado igual que el definitivo (`relation-store.ts:355-377`). El catálogo se salta el `fsync`; aquí no;
- **carril de escritura serializado** (`relation-store.ts:197`, `:286-295`);
- **lectura tolerante**: lo que no valida se saca de la lista que se usa, se cuenta en `droppedOnRead` y **vuelve al archivo tal cual** al guardar. Un sobre que no abre **detiene** el trabajo y no se sobrescribe nunca;
- **`checkedForWrite`**: se niega a escribir algo que la siguiente lectura descartaría en silencio.

Contrapartida honesta: **`recap.json` no se sincroniza a otro equipo**, igual que `catalog.json` y `relation.json` (`docs/PENDIENTES-DISENO.md` §10). Se acepta: es regenerable con una pasada gratis, y en cuanto Daniel retome el hilo la memoria **sellada** que descienda de ella sí viaja.

### 3.2 Los cuatro motivos por los que no va dentro del registro

Los cuatro verificados en el código:

1. **No existe la API.** `sealedMemory` sólo lo escribe `sealTurn`, y `sealTurn` sólo lo llama `appendTurn` (`conversation-store.ts:152-169`). No hay `replaceRecord`. Los únicos escritores del archivo son `appendTurn`, `appendRaw` (`:146-149`) y `removeLastTurn`.
2. **Reescribir una línea es reescribir el archivo**, y el único precedente —`removeLastTurn`— hace `.tmp` + `renameSync` **sin `fsync`**, al contrario que `relation-store.ts:371-375`, que lo hace y explica por qué. Ahí dentro están las 17 conversaciones.
3. **`sealTurn` no sabe re-sellar**: `recordId` nuevo (`private-store.ts:107`) y `createdAt` nuevo (`:113`). `list()` usa `last.createdAt` como `updatedAt` y ordena por él (`conversation-store.ts:215`, `:219`): re-sellar el último registro de cada conversación pondría las 17 con fecha de hoy y reordenaría la única fecha que Daniel ve. Y en el servidor chocaría con `vault_records_unique_sequence` por un camino que `insertVaultRecords` se traga con `.catch(() => [])`.
4. **Un error no degrada: apaga.** `openTurn` lanza sin tolerancia si la memoria no abre o no valida (`private-store.ts:135-139`), y `list()` abre el último registro de **cada** conversación dentro de un bucle **sin `try/catch`** (`conversation-store.ts:205-217`). Una sola memoria mal escrita tumba la lista entera de Privado, `PrivateMemory`, el catálogo y la pasada de pendientes.

Y un registro sintético «sólo memoria» tampoco vale: `privateRecordSchema` exige `content` (`packages/shared/src/vault.ts:119-136`), así que sería un turno fantasma que aparece en `read()`, en pantalla, en el índice léxico, en los episodios, en el `turns: records.length` de la lista (`:214`) y en los ULTIMOS TURNOS del prompt; y rompería los cursores de pendientes, que validan `throughAt === turn.createdAt` (`relation-sync.ts:235-247`).

### 3.3 Forma de una entrada

Una por conversación. En `packages/shared/src/vault-recap.ts`:

```ts
export const RECAP_VERSION = 1;

export const recapGapSchema = z.object({
  from: z.number().int().min(0),
  to: z.number().int().min(0),
  // ENUM CERRADO, nunca texto libre: un motivo escrito a mano vuelve
  // describiendo justo lo que el modelo se nego a describir, y eso acabaria
  // en disco y quiza en una pantalla
  why: z.enum(['explicito', 'confuso', 'otro']),
});

export const recapEntrySchema = z.object({
  conversationId: z.string().uuid(),
  /** null cuando lo unico que hay de esta conversacion es una negativa */
  memory: conversationMemorySchema.nullable(),
  source: z.enum(['cli', 'index']),
  covered: z.object({ from: z.number().int().min(0), to: z.number().int().min(0) }),
  /** createdAt del turno `covered.to`: detecta numero de secuencia reutilizado */
  coveredAt: z.string().datetime().nullable(),
  gaps: z.array(recapGapSchema).max(20).default([]),
  turnsAtRecap: z.number().int().min(0),
  version: z.number().int().min(1),
  provider: z.enum(['claude', 'codex']).nullable(),
  model: z.string().max(128).nullable(),
  at: z.string().datetime(),
  /** caracteres del bloque ya renderizado: es lo que se paga en cada turno */
  chars: z.number().int().min(0),
  /** hasta que Daniel no aprueba, no entra en ningun prompt */
  approved: z.boolean().default(false),
  refusedKind: z
    .enum(['refused', 'absent', 'truncated', 'invalid', 'vague'])
    .nullable()
    .default(null),
  refusedAtTurns: z.number().int().min(0).nullable().default(null),
  refusedProvider: z.enum(['claude', 'codex']).nullable().default(null),
  /** cuando la conversacion pasa a tener memoria sellada viva */
  supersededAt: z.string().datetime().nullable().default(null),
});

export const recapCountersSchema = z.object({
  windows: z.number().int().min(0).default(0),
  ok: z.number().int().min(0).default(0),
  partial: z.number().int().min(0).default(0),
  deduced: z.number().int().min(0).default(0),
  refused: z.number().int().min(0).default(0),
  vague: z.number().int().min(0).default(0),
  invalid: z.number().int().min(0).default(0),
  failed: z.number().int().min(0).default(0),
  clipped: z.number().int().min(0).default(0),
  kept: z.number().int().min(0).default(0),
  rewritten: z.number().int().min(0).default(0),
  dropped: z.number().int().min(0).default(0),
});
```

**El esquema de memoria NO se toca.** No hace falta subir `VAULT_PAYLOAD_VERSION` ni añadir migración. Todo el metadato que el sobre sellado no puede llevar (`{v, memory}` y nada más, `vault-payloads.ts:83-87`) vive aquí.

### 3.4 Cómo se lee: un cambio de LECTURA, no de escritura

`conversation-store.ts` **no se toca**. Se añade una función pura en `vault-recap.ts`:

```ts
export type MemorySource = 'turn' | 'recap' | 'index';

export interface ChosenMemory {
  memory: ConversationMemory | null;
  source: MemorySource;
  /** tramos declarados que nadie resumio */
  gaps: number;
}

export function chooseConversationMemory(input: {
  sealed: ConversationMemory | null;
  entry: RecapEntry | undefined;
  /** secuencia y createdAt de todos los turnos, en orden */
  turns: readonly { sequence: number; createdAt: string }[];
  recentTurns?: number;   // VAULT_RECENT_TURNS
}): ChosenMemory
```

Reglas, en este orden:

1. **`sealed !== null` → la sellada SIEMPRE gana.** `{memory: sealed, source: 'turn', gaps: 0}`. Sin excepciones y sin mezclar dos memorias escritas por modelos distintos.
2. Entrada con `memory !== null`, `approved === true`, `version === RECAP_VERSION`, `source === 'cli'`, **y que pase la invariante de cobertura** → `{memory, source: 'recap', gaps: entry.gaps.length}`.
3. Entrada con `source === 'index'` y `memory !== null` → `{memory, source: 'index', gaps: 0}` (el índice deducido **no necesita aprobación**: no lleva ni una palabra escrita por un modelo nuevo, sólo resúmenes de escena que ya estaban en la bóveda).
4. Si no, `{memory: null, source: 'turn', gaps: 0}` → comportamiento idéntico byte a byte al de hoy.

**La invariante de cobertura** (la segunda red de seguridad, y lo que hace imposible por construcción el peor fallo del encargo):

```
coveredAt casa con el createdAt del turno `covered.to`
Y  covered.to >= (secuencia del primer turno de la cola literal) - 1
```

donde la cola literal son los últimos `VAULT_RECENT_TURNS` turnos, que viajan enteros. Si el recap no llega hasta ahí, **hay un hueco que nadie ha declarado** (no es un `skipped`, es «la pasada no ha terminado») y el recap **no se usa**: la conversación se queda como hoy, con su aviso de turnos omitidos. Con los datos reales sólo afecta a las dos conversaciones largas y sólo hasta que se procesa su segunda ventana.

Se usa en los **dos** —y únicos— sitios que leen memoria hoy, verificados con `grep`:

- `handlers.ts:2926`, el turno privado;
- `handlers.ts:1176`, la sonda de compatibilidad.

---

## 4. Quién lo genera, y cómo

### 4.1 El carril y el objetivo

`resolveAuxiliaryTarget(null, context.memoryPreferences.auxiliary())` (`packages/shared/src/auxiliary-target.ts:41-68`, `D-087`) **más la segunda comprobación en ejecución con `isLocalCliProvider`**, exactamente como `relation-sync.ts:626-636` y como el catálogo NO hace. `memory-excluded.json` está sin cifrar en disco a propósito, y colar ahí un proveedor de pago costaría una llamada cobrada por ventana.

- `kind: 'technical'` siempre.
- Mismo `createAuxiliaryLane` que ya comparten catálogo y pendientes (`handlers.ts:1332`). Quien llama a `runOnce` **no** vuelve a envolverlo.
- Guardia `isSending` (`handlers.ts:1341`): no se lee una conversación que se está contestando.
- `context.vault.onLock(() => recapSync.cancel())` y `isUnlocked()` **entre ventana y ventana**, no sólo entre conversaciones: una ventana tarda un minuto y la bóveda puede cerrarse dentro.

### 4.2 Etiqueta propia: `<LUXY_RECAP>`

**No se puede pedir `<LUXY_MEMORY>`.** Dos motivos verificados:

- la rama técnica del job-runner dice literalmente «No escribas ningun bloque de memoria: este turno no alimenta ninguna» (`apps/agent/src/job-runner.ts:264`). Pedirlo contradice su propio system prompt;
- `parseConversationMemoryResponse` localiza el bloque con `lastIndexOf(CONVERSATION_MEMORY_OPEN)` (`schemas.ts:396`), así que un recap que contuviera esa cadena podría secuestrar el parseo del turno vivo siguiente.

Regla dura, comprobada en código: **se rechaza cualquier entrada que contenga la subcadena `<LUXY_`.**

### 4.3 El troceado

Función `recapWindow(turns, through, scenes)` en `vault-recap.ts`. Reutiliza la regla exacta de `relationWindow` (`relation-sync.ts:288-320`) y le añade una cosa:

1. candidatos = turnos con `sequence > through` y `<= lastReviewableOf(turns)` (el último turno del **personaje**: un mensaje del usuario sin respuesta nunca se da por leído, porque su número puede reutilizarse si el turno falla);
2. `fresh = candidatos.slice(0, RECAP_WINDOW_TURNS)` con `RECAP_WINDOW_TURNS = 40`;
3. **preferencia de escena**: si el catálogo de esa conversación es fiable —existe, `turnsAtCatalog >= turns.length`, y `detectEvenSplit(...).even === false`— y hay una escena cuyo `to` cae en los **últimos 12 turnos** de `fresh`, se corta ahí. Una escena partida por la mitad le da al resumidor media escena, y los cortes buenos ya existen y ya están pagados;
4. si no, se recorta `fresh` hacia atrás hasta que termine en turno del personaje, con la misma salida de emergencia que `relationWindow` para una tirada de 40 mensajes del usuario seguidos;
5. contexto = `RECAP_CONTEXT_TURNS = 3` turnos anteriores en crudo, marcados como ya revisados;
6. presupuesto de texto: `turnAllowance(lengths, RECAP_TURN_CHARS)` con `RECAP_TURN_CHARS = CATALOG_PROMPT_CHARS` (60.000, **sin** el tope de 1.400 del catálogo). Es la misma decisión que tomó el extractor de pendientes y por el mismo motivo (`D-088`, caso 1): un cursor que avanza sobre texto recortado marca como leído lo que nadie vio. Recorte por el medio con `clipMiddle` y `CATALOG_CUT_MARK`, y se cuenta `clipped` **sólo sobre los turnos frescos**.

Con los datos reales: 20 ventanas para las 17 conversaciones, y `clipped` tiene que salir 0.

### 4.4 El encadenado

La ventana N recibe la ficha de la N−1 renderizada con `formatConversationMemory` —el mismo texto que vería en un turno real— y la orden **no** es «resume»: es «esto ya estaba anotado, devuélvelo entero, corregido y ampliado, y lo que siga siendo verdad se queda tal cual, palabra por palabra».

Y un ancla contra la evaporación del principio: la **primera** ventana emite su primera entrada de `facts` con el prefijo literal `Empezó: `. El código la extrae, la reinyecta en un bloque propio a todas las ventanas siguientes, y **la vuelve a añadir si el modelo la perdió**. Es seguro re-añadirla porque está en pasado: una escena posterior puede mudarlos de sitio, no puede desmentir cómo empezó.

Se mide, sin modelo: `countKeptEntries(previous, next)` devuelve `{kept, rewritten, dropped}`. Si `dropped` sube, el prompt está derivando y sale en el panel.

### 4.5 El tope de tamaño

El esquema admite ~15.900 caracteres, **más que el prompt privado entero** medido en `D-058` (~14.000 c / ~4.000 tokens). Lo que produce un turno real son **342c y 382c** (`TEST-RESULTS.md:67-78`). Cada carácter se paga en **todos** los turnos futuros de ese hilo, se reescribe en cada respuesta, y engorda el riesgo de `truncated_block` —que por `D-016` no se reintenta si ya produjo texto—. Y nada recorta el prompt: `measureVaultPrompt` sólo mide y el recorte que anticipa el comentario de `vault-prompt.ts` no existe.

Por eso:

- en el prompt se pide: `summary` ≤ 400 caracteres, ≤ 6 entradas por lista, ≤ 160 caracteres cada una;
- **el código recorta a esos topes del relleno, no a los del esquema** (`clampRecapMemory`). Recortar y no rechazar es la lección de LUX-8B8T (`schemas.ts:344-372`);
- y hay un **tope duro del bloque renderizado: 1.800 caracteres**. Si `formatConversationMemory(memory).length > 1800`, se quitan entradas por la cola en este orden —`lessons`, `openQuestions`, `plan`, `decisions`, `facts`— hasta que quepa. `facts` y `decisions` se defienden las últimas porque son el estado y los acuerdos. 1.800 c ≈ 515 tokens ≈ 13 % del prompt medido.

---

## 5. El texto EXACTO del prompt

En `packages/shared/src/vault-recap.ts`, función `buildRecapPrompt(input)`. Los bloques entre `< >` son sustituciones del código.

> ```
> Estas escribiendo la FICHA DE CONTINUIDAD de una conversacion de ficcion entre
> dos personas adultas, para que el personaje pueda retomarla sin releerla entera.
>
> Quien va a leer esto es ELLA, el personaje, justo antes de contestarle. No es un
> informe para nadie. No continues la conversacion, no la valores, no hables con
> nadie y no encarnes a nadie: solo apuntas lo que hay que recordar.
>
> Es ficcion consentida entre adultos y puede haber escenas sexuales. La ficha las
> RECOGE, no las reproduce: donde pasa, entre quienes, que se pidio, que gusto y
> que cambio despues. Con eso basta, y eso es exactamente lo que hace falta. No
> copies frases, no narres la escena y no la adornes.
>
> Y al reves: «tuvieron un encuentro intimo» no sirve para nada. Una ficha que no
> dice que paso no es una ficha, es un hueco con forma de frase. Si hay algo que
> prefieres no escribir, NO lo escribas a medias: dejalo fuera y anotalo en
> `skipped`.
>
> LO QUE VA EN CADA CAMPO. En tercera persona, en presente, sobre los dos y con
> sus nombres. Nada de «el usuario», «la IA», «la conversacion», «se acordo que»
> ni «el sistema».
>
> - `summary`: como van las cosas entre ellos y donde quedo la ultima escena.
>   Unos 400 caracteres. Es lo primero que ella lee.
> - `facts`: lo fijo. Quien es quien, donde estan, que hora es alli, como va
>   vestida, como la llama el, que sabe cada uno de la vida del otro.
>   SIRVE: «El la llama nena cuando esta de buenas».
>   NO SIRVE: «Tienen buena quimica».
> - `decisions`: lo que quedo acordado entre los dos, incluidos los limites y las
>   reglas del juego. Una promesa o algo que quedaron en hacer juntos NO va
>   aqui: va en `plan`.
>   SIRVE: «Quedaron en que ella escribe primero por las mañanas».
> - `plan`: lo que queda por delante, si lo hay, con las promesas que sigan sin
>   cumplirse.
> - `openQuestions`: lo que quedo en el aire sin respuesta.
> - `lessons`: lo que ELLA ha aprendido de EL. Que le gusta, que le corta, que
>   tono funciona y cual no.
>   SIRVE: «Se cierra si ella va demasiado deprisa al principio».
>
> Maximo 6 entradas por lista y unos 160 caracteres cada una. Lo que sobre se
> recorta solo, asi que elige: cinco cosas ciertas valen mas que ocho con una
> inventada.
>
> NADA INVENTADO. Si no esta dicho ni hecho en los turnos de abajo, no se apunta.
> Y no completes una enumeracion para que suene mejor: dos ciertas antes que tres
> con una falsa.
>
> NADA DE FUERA DE PERSONAJE. Si el rompe la ficcion —«eres una IA», «esto es un
> chat»— eso no es parte de la historia y no entra en la ficha.
> ```

**Sólo en la primera ventana** se añade:

> ```
> Esta es la PRIMERA parte de la conversacion. La primera entrada de `facts` tiene
> que empezar por «Empezo: » y decir como arranco esto y que son el uno del otro.
> Se conservara tal cual en las fichas siguientes.
> ```

**Sólo a partir de la segunda ventana** se añade:

> ```
> LO QUE YA ESTABA ANOTADO. Abajo tienes la ficha de la parte anterior de esta
> misma conversacion. NO la resumas otra vez: devuelvela ENTERA, corregida y
> ampliada con lo nuevo.
>
> Lo que siga siendo verdad se queda TAL CUAL, palabra por palabra. Solo cambias
> una entrada si la parte nueva la desmiente, y solo borras una si ha dejado de
> ser cierta. Reescribir lo que ya estaba bien hace que a la tercera vuelta el
> principio de la conversacion haya desaparecido.
>
> La entrada de `facts` que empieza por «Empezo:» va SIEMPRE, tal cual.
> ```

Después, siempre:

> ```
> Responde SOLO con este bloque, sin nada antes ni despues y sin cercas Markdown:
> <LUXY_RECAP>
> {"version":1,"summary":"...","facts":[],"decisions":[],"plan":[],"openQuestions":[],"lessons":[],"covered":{"from":<F>,"to":<T>},"skipped":[]}
> </LUXY_RECAP>
>
> `covered` son el primer y el ultimo turno que has tenido en cuenta, incluidos.
>
> `skipped` son los tramos que prefieres no resumir. Dejar uno fuera es una
> respuesta VALIDA y es mejor que no contestar: lo que quede ahi se marcara como
> no leido y nadie va a suponer lo que habia. Cada tramo va como
> {"from":12,"to":18,"why":"explicito"}, y `why` solo puede ser "explicito",
> "confuso" u "otro". No escribas el motivo con tus palabras.
>
> Si un turno viene con « […recorte…] » en medio, es que se le ha quitado el
> centro para que quepa: tienes su principio y su final, y lo de en medio no
> existe como salto.
> ```

Y los datos, en este orden:

> ```
> EL PRINCIPIO DE ESTA CONVERSACION (DATOS):
> <la entrada «Empezo: …», si existe>
>
> LO QUE YA ESTABA ANOTADO (DATOS):
> <formatConversationMemory(ficha de la ventana anterior)>
>
> YA REVISADO, SOLO PARA ENGANCHAR (DATOS):
> [n] Usuario: …
> [n] Personaje: …
>
> LA PARTE NUEVA (DATOS):
> [n] Usuario: …
> [n] Personaje: …
> ```

Los turnos se aplanan con `flattenTurnText` y se recortan con `clipMiddle(texto, turnAllowance(...))`, las mismas piezas que ya usan el catálogo y el extractor de pendientes, exportadas justo para esto.

---

## 6. El índice deducido (nivel sin modelo)

Función pura `deduceRecap({ scenes, first, last, anchor })`. **Cero llamadas, imposible que se niegue.** Y, por el hallazgo del §1, **sólo lleva lo que el prompt no lleva ya**:

- `summary`: `Indice de las N escenas de esta conversacion, del <dia> al <dia>. No se sabe que se dijo dentro de ellas.` (`civilDayLabel` con el ancla, como el bloque de pendientes). Recortado a 400.
- `facts`: una entrada por escena, `«<title>»: <summary de la escena>`, recortada a 160, máximo 6. Con más de 6, se toman la primera, la última y las cuatro de resumen más largo. El título va sólo como ancla para que ella pueda ligarlo a su línea de índice; **lo nuevo es el resumen**.
- `decisions`, `plan`, `openQuestions`, `lessons`: **vacías**. Un índice no sabe qué se decidió ni qué quedó en el aire.
- `covered` = `{from: min(scene.from), to: max(scene.to)}`, `coveredAt` = `createdAt` de ese turno.
- `source: 'index'`, `approved: true` (no lleva prosa nueva de ningún modelo).
- Si la conversación no tiene escenas catalogadas, o todas tienen `summary` vacío, **no se crea entrada**. Vale más el aviso de turnos omitidos que un bloque hueco.

En el prompt se presenta **como índice, nunca como memoria** (§7), y **no cuenta como cobertura** en el panel: tiene su propia columna.

---

## 7. Los cambios en `packages/shared/src/vault-prompt.ts`

**Dependencia dura del §3.4: si esto no entra, el relleno no se enciende.** Es aditivo: sin los campos nuevos, el prompt sale byte a byte como hoy.

`VaultPromptInput` gana dos campos opcionales:

```ts
/** de donde sale la memoria: del turno vivo, del relleno, o es solo un indice */
memorySource?: 'turn' | 'recap' | 'index';
/** tramos que nadie resumio dentro de lo que si cubre */
memoryGaps?: number;
```

Comportamiento:

| `memory` | `memorySource` | bloque | coletilla | aviso de turnos omitidos |
|---|---|---|---|---|
| `null` | — | no se emite | — | como hoy (`omitted > 0`) |
| ≠ null | `'turn'` (o ausente) | `MEMORIA ACUMULATIVA DE ESTA CONVERSACION` | — | **no** (como hoy) |
| ≠ null | `'recap'`, `gaps === 0` | igual | — | **no** |
| ≠ null | `'recap'`, `gaps > 0` | igual | «De esta conversacion hay N tramos que no se pudieron resumir. De esos tramos no sabes nada: si hace falta algo de ahi, preguntalo en vez de suponerlo.» | **sí**, si `omitted > 0` |
| ≠ null | `'index'` | `INDICE DE ESTA CONVERSACION (no es un resumen de lo que se dijo)` | «Son los titulos de sus escenas y una frase de cada una. No sabes que se dijo dentro: si hace falta, preguntalo. No supongas el contenido a partir del titulo.» | **sí**, si `omitted > 0` |

Y —esto va **para todos los orígenes, incluido `'turn'`**— el bloque de memoria gana **su propia regla contra la invención**:

> ```
> De aqui sabes SOLO lo que pone. Es un resumen, no la transcripcion: no sabes
> como se dijo cada cosa. Si te falta un detalle, preguntalo; no lo supongas ni
> lo rellenes, y si al enumerar te falta uno, di dos ciertos antes que tres con
> uno inventado.
> ```

Motivo: es el **único** bloque de resumen del prompt que no la tiene, frente a `formatRecallLines` (`vault-prompt.ts:320-332`) y `formatPendingAffairs` (`:406-411`), y la lección general de `D-061` dice literalmente que cada bloque que entrega resúmenes en vez de texto literal necesita la suya y que no basta con haberla escrito en otro bloque parecido (`DECISIONS.md:1554-1558`).

**Aviso para quien implemente:** esto cambia el prompt del camino de pago en unas 4 líneas (~250 caracteres, ~1,8 % del prompt medido). Las pruebas de `vault-prompt.test.ts` que fijan texto exacto hay que actualizarlas, en particular la que afirma «no avisa si hay memoria», que pasa a ser «no avisa si hay memoria COMPLETA». Díselo a Daniel antes de hacerlo.

---

## 8. Las negativas: la escalera completa

Se dan por hechas, y se separan en **cinco estados**, porque el arreglo de cada uno es distinto. Mezclarlos es el defecto que ya tiene la pasada de pendientes, que mete negativa, JSON malo y corte en el mismo contador (`relation-sync.ts:772-779`).

| estado | cómo se detecta | qué significa | qué lo arregla |
|---|---|---|---|
| **parcial** | bloque válido con `skipped` no vacío | **ÉXITO.** El modelo hizo su trabajo y dijo dónde no llegó | nada; el hueco viaja al prompt |
| `refused` | `classifyReply(texto).kind === 'refused'` | moderación | **cambiar de CLI** |
| `absent` / `truncated` / `invalid` | `parseRecapResponse` | formato o corte | reintentar con el mismo, o ventana más corta |
| `vague` | puntuación local, §8.2 | obedeció y saneó | cambiar de CLI o de **modelo** |
| `failed` | `run.outcome !== 'completed'` | el proceso no terminó | se marca en la sesión y se salta |

**Nota importante: una negativa NO llega como error.** Llega como `completed` con texto. Se clasifica con `classifyReply` (`apps/desktop/src/shared/refusal.ts:84-107`), que ya existe, tiene 13 pruebas, está sesgado a propósito hacia no confundir diálogo con rechazo (`D-059`) y **hoy no lo llama ningún carril de fondo**.

### 8.1 Conducta

- **Una negativa NO para la tanda.** `keepSweepingRecaps` cuenta `refused`, `vague` y `failed` como progreso, por la razón escrita en `vault-sweep.ts:27-44`: las conversaciones de una tanda son siempre las más antiguas, así que si las primeras se niegan y sólo se mira lo hecho, el bucle corta dejando el resto sin leer. Ese fallo exacto ya se ha entregado **dos veces** en este repositorio.
- **La negativa se PERSISTE** en la entrada (`refusedKind`, `refusedAtTurns`, `refusedProvider`), con el modelo de `relationCursorSchema` y no con el `Set` de sesión del catálogo (`catalogFailures`, `handlers.ts:1510`), que se pierde al reiniciar y hace que cada arranque mande otra vez las mismas conversaciones explícitas al mismo CLI para recibir la misma negativa.
- **No se reintenta sola.** `refusedStillRecap(entry, turns, provider)`, calcado de `refusedStill` (`relation-sync.ts:263-277`): vuelve a entrar si la conversación crece, si sube `RECAP_VERSION`, **si cambia el CLI**, o si Daniel pulsa el botón (`force`).
- **Una ventana negada NO bloquea la conversación: se salta y se sigue a la siguiente**, y su tramo entra en `gaps` con `why: 'explicito'`. Es la diferencia deliberada con la pasada de pendientes. Para una memoria acumulativa, saltar hacia delante es legítimo mientras el hueco se declare, y lo que se compra es **la cola**, que es justo la parte que sirve para retomar. **Tope: 2 ventanas negadas seguidas** por conversación y pasada, para que un hilo explícito de punta a punta cueste 2 llamadas y no 8.
- **Si todas las ventanas de una conversación fallan**, se cae al índice deducido (§6).
- **No hay caída automática al otro CLI**, por decisión explícita: quien elige es Daniel, en el selector que ya existe. Y **nunca** una API de pago.
- **Si se niegan los dos CLI y no hay catálogo**, esa conversación se queda sin nada y se dice en el panel. Es el estado seguro: conserva el aviso de turnos omitidos.

### 8.2 El detector de vaguedad

**El caso peor no es que se nieguen: es que obedezcan y saneen.** «Tuvieron un encuentro íntimo y acordaron verse el sábado» valida contra el esquema, pasa `classifyReply`, avanza el cursor, apaga el aviso y —por «Conserva lo valido de la memoria anterior» (`schemas.ts:258`)— se convierte en la semilla permanente que el modelo de pago arrastra en cada turno de ese hilo.

`scoreRecapVagueness(memory)` en `vault-recap.ts`, puro y sin modelo. Se marca `vague` **sólo cuando coinciden dos cosas** (mismo sesgo conservador que `classifyReply`: más vale dejar pasar uno malo que tirar uno bueno):

1. **poca sustancia**: `caracteres(summary) + Σ caracteres(entradas) < 320`, **o** `total de entradas de las cinco listas === 0`;
2. **y al menos un comodín** de esta lista cerrada, sin acentos y sin distinguir mayúsculas: `momento intimo`, `encuentro intimo`, `contenido explicito`, `de naturaleza personal`, `cierto momento`, `sin entrar en detalles`, `no puedo detallar`, `no es apropiado`, `no procede describir`.

Además, señal independiente y suficiente: `Σ caracteres < 150`.

Efecto: **no se guarda nada, el cursor no avanza**, se cuenta en `vague`, y se persiste como negativa con `refusedKind: 'vague'` para que no se repita sola. En pantalla sale con su propio mensaje, distinto del de la negativa.

### 8.3 Lo que NO va a los registros

**El extracto de 160 caracteres de lo que dijo el modelo NO se guarda, ni se registra, ni se enseña.** Es la única divergencia deliberada con el catálogo, que sí lo conserva (`describeCatalogFailure`, `vault-catalog.ts:84-105`) y lo pinta en pantalla. Motivo: al catálogo se le pide un índice, así que lo que dice en su lugar es una negativa genérica; aquí se le ha pedido **describir la escena**, así que lo que diga en su lugar puede citarla. Es contenido de la bóveda con otro nombre. Se sustituye por la **clasificación**, que da exactamente la misma información operativa (qué botón pulsar). Y `redact()` no vale de coartada: tapa secretos, no la bóveda, y eso ya está escrito en un comentario de `handlers.ts`.

---

## 9. Lo que ve Daniel

### 9.1 En el turno

Al reabrir una de las 17 aparece por primera vez el bloque `memoria` en el prompt, visible en `studio.log` como `memoria NNNc` dentro de «prompt privado compuesto» (`handlers.ts:3054-3062`, que ya registra tamaño por bloque y nunca contenido). Lía deja de repetir lo que ya sabía y puede retomar de más atrás de los 8 turnos.

**Lo que NO le da, y hay que decírselo antes de empezar:** la memoria es **por conversación** (`latestMemory` es por hilo, y el bloque se titula «DE ESTA CONVERSACION»). Esto **no** hace que ella se acuerde de un hilo cuando está en otro; ese canal son los recuerdos y los pendientes.

### 9.2 En «Lo que recuerda», bloque nuevo: **«Memoria de lo ya hablado»**

- **Una línea de cobertura con números que SUMAN**, y una prueba que lo exige:

  > «11 resumidas · 3 con huecos · 2 solo por índice · 1 sin leer (17 en total). 1 ya tiene memoria propia.»

  Invariante: `resumidas + conHuecos + soloIndice + sinNada + conSelladaViva === total − excluidas`. Si no cuadra es un fallo, no un redondeo. Es el equivalente al `coverage.behind === 0` de los pendientes, que hoy **no existe** para la memoria: `memory-diagnostics.ts` mide catálogo, fechas, estilo y disparos, y no mide cuántas conversaciones tienen memoria.

- **Botón propio**: «Generar la memoria de lo ya hablado». **Deliberadamente FUERA del `onToggle`** que hoy encadena catálogo y pendientes (`Vault.tsx:4247-4282`): los tres comparten un solo carril y un solo CLI, y abrir el panel no puede convertirse en media hora de proceso arrancando. Bucle de 12 vueltas con `keepSweepingRecaps`, tandas de 2 conversaciones.

- **Una fila por conversación**: título, «cubre 18 de 18 turnos» o «cubre 40 de 65», tamaño en caracteres, con qué CLI se escribió, y el estado.

- **«Ver»**, que enseña el texto renderizado con `formatConversationMemory`. **No es un adorno: hoy no hay ni una pantalla en todo Luxy donde se pueda leer la memoria de una conversación** — el renderer sólo muestra `lastMemoryStatus`, que es el estado del último turno (`Vault.tsx:318-325`). Estamos a punto de escribir texto en 17 conversaciones que Daniel no puede leer y que, desde el primer turno nuevo, el modelo de pago va a arrastrar para siempre. **Si hay que recortar el plan, se recorta cualquier cosa menos esto.**

- **«Aprobar»**, y por defecto **un recap de CLI NO entra en ningún prompt hasta que Daniel lo apruebe**. Con un **«Aprobar todas»** para quien no quiera revisar una por una: son 17 textos cortos, un minuto. El índice deducido no necesita aprobación.

- **«Rehacerlo»** (encola esa conversación con `force`) y **«Borrarlo»** (quita su entrada; la conversación vuelve al aviso de turnos omitidos, que es el estado seguro). Eso hace el trabajo entero reversible.

- **Los fallos, distinguidos y con el reintento apuntando al OTRO CLI por su nombre**:

  > «Del 1 de septiembre · 34 mensajes · **Codex se negó a 2 tramos** · [Reintentar con Claude]»
  > «Del 3 de septiembre · 51 mensajes · **salió demasiado vago** · [Reintentar con Claude]»
  > «Del 5 de septiembre · 22 mensajes · **solo índice: se negaron los dos** · [Reintentar con Claude]»

  Nunca de qué iba la conversación: día, número de mensajes y qué pasó.

- **El aviso de a dónde va el texto**, junto al que ya existe para el catálogo, con una frase más: «Lo que se negó a resumir no se manda a ningún otro sitio: se queda sin resumir y aquí lo verás.»

---

## 10. Las cifras que se registran (nunca contenido)

Una sola línea por tanda, con el criterio de `relation-store.ts:100-110` («una cifra, no una lista»):

```ts
context.log('memoria de lo ya hablado', {
  conversaciones, ventanas,
  resumidas, conHuecos, deducidas,
  negativas, vagas, invalidas, fallidas,
  tramosSaltados, recortados,
  conservadas, reescritas, perdidas,   // kept / rewritten / dropped
  caracteres,                          // suma de los bloques renderizados
  quedan,
  proveedor, sustituido,
});
```

**Ni un título, ni una entrada, ni una cita, ni el `conversationId`** —un identificador de conversación más una marca de tiempo es un dato correlacionable, y ni el catálogo (`handlers.ts:1601-1609`) ni la pasada de pendientes (`relation-sync.ts:576-584`) lo escriben—. Y nada de lo que dijo el modelo (§8.3).

---

## 11. Pasos numerados, con archivos

> **Paso 0 — NO EMPEZAR todavía.** `git status` da 20 archivos modificados sin commitear y 13 sin seguir, incluidos `handlers.ts`, `Vault.tsx`, `useVault.ts`, `channels.ts`, `ipc.ts`, `vault-prompt.ts`, `vault-catalog.ts` y todo `relation-*`. Los pasos 2-5 crean archivos nuevos y no chocan; del 6 en adelante hay que esperar.

**Paso 1 — MEDIR ANTES DE CONSTRUIR, sin escribir nada.**
Apuntar la sonda de compatibilidad (`vaultCompatibility`, `handlers.ts:1164-1224`) a `claude` y a `codex` con varias repeticiones, sobre las conversaciones más explícitas. Es de sólo lectura —«no añade turnos, no toca la memoria»—, no gasta créditos y devuelve `answered` / `refused` / `empty` y `memoryOk`. **Nadie la ha apuntado nunca a los CLI locales, y no existe en todo el repositorio ni una medida de negativa de Claude o Codex sobre esta bóveda.** Aviso honesto: mide si el CLI se presta a **conversar**, no a **resumir**; es un proxy barato, no la medida. La medida de verdad llega con `dryRun` en el paso 6. Apuntar el resultado en `TEST-RESULTS.md`. Si los dos se niegan casi siempre, entregar los pasos 2 (parte de índice) y 3 y parar.

**Paso 2 — el núcleo puro.**
`packages/shared/src/vault-recap.ts` (NUEVO) + `vault-recap.test.ts`. Constantes (`RECAP_VERSION`, `RECAP_OPEN`/`RECAP_CLOSE`, `RECAP_WINDOW_TURNS = 40`, `RECAP_CONTEXT_TURNS = 3`, `RECAP_TURN_CHARS`, topes 400/6/160 y el tope duro de 1.800), esquemas (§3.3), `buildRecapPrompt` (§5), `parseRecapResponse`, `verifyRecap`, `clampRecapMemory`, `scoreRecapVagueness`, `recapWindow`, `countKeptEntries`, `deduceRecap`, `chooseConversationMemory`, `refusedStillRecap`, `recapCoverage`. Reutiliza `flattenTurnText`, `turnAllowance`, `clipMiddle`, `CATALOG_CUT_MARK`, `detectEvenSplit` de `vault-catalog.ts`; `conversationMemorySchema`, `formatConversationMemory` y `looksLikeCode` de `schemas.ts`; `civilDayLabel` de `temporal-reference.ts`.
**No se toca `schemas.ts`**: `looksLikeCode` ya está exportado y los topes del relleno son más estrictos que los del esquema, así que el clamp es propio.
Reexportar en `packages/shared/src/index.ts`.

**Paso 3 — el bloque del prompt (§7).**
`packages/shared/src/vault-prompt.ts` + `vault-prompt.test.ts`. **Aditivo, y entregable solo**: arregla por sí mismo una regresión latente que ya existe hoy (cualquier memoria parcial apaga el aviso) y añade la regla de `D-061` al único bloque de resumen que no la tiene.

**Paso 4 — el almacén.**
`apps/desktop/src/main/vault/recap-store.ts` (NUEVO) + test. `recapFilePath(configDirectory)` → `vault/recap.json`. Copia de `relation-store.ts`: `subkeyFor('identity','recap')`, `.tmp` sellado + `fsync` + `rename`, carril, lectura tolerante que conserva en crudo, `checkedForWrite`. Expone `read`, `apply`, `entryFor`, `removeConversation`, `markSuperseded`.

**Paso 5 — la pasada.**
`apps/desktop/src/main/vault/recap-sync.ts` (NUEVO) + test con controlador falso. Estructura de `relation-sync.ts`: `runOnce` = `deps.lane(() => this.sweep(...))`, `auxiliary()` con doble comprobación, `pending()` en orden cronológico ascendente con los filtros de excluidas / `isSending` / fallos de sesión por CLI / `refusedStillRecap` / `supersededAt`, bucle de ventanas encadenando la ficha anterior, reinyección del ancla `Empezó:`, escalera de negativas (§8), `deduceRecap` como caída, contadores, y `cancel()` enganchado a `vault.onLock`. Comprobar `isUnlocked()` **entre ventanas**.

**Paso 6 — el IPC.**
`apps/desktop/src/shared/channels.ts` (`luxy:vault:recap:sync`, `:list`, `:update`), `apps/desktop/src/shared/ipc.ts` (args y resultados con Zod, copiando `vaultRelationSync*`). `vaultRecapSyncArgsSchema` lleva `projectAlias`, `conversationId?`, `limit` (default 2), `force`, y **`dryRun`**: corre la pasada entera, devuelve el texto que escribiría y **no guarda nada**. Son veinte líneas y es lo único que contesta a la vez «¿se niegan?» y «¿sale bueno?». `vaultRecapUpdateArgsSchema` cubre aprobar / borrar / aprobar todas.

**Paso 7 — el enganche.**
`apps/desktop/src/main/index.ts`: construir `RecapStore` junto a `CatalogStore` y `RelationStore` (~líneas 335-338). `apps/desktop/src/main/ipc/handlers.ts`: `recaps` en el contexto; construir `RecapSync` junto a `RelationSync` (~1356) con el mismo `runOnAuxiliaryLane` y el mismo `isSending`; `context.vault.onLock(() => recapSync.cancel())`; registrar los tres handlers; **añadir `recaps.removeConversation` al borrado de conversación**, junto a las dos líneas que ya hay (`:1084` y `:1088`); y el **único cambio del turno vivo**: la lectura de `latestMemory` de la `:2926` pasa por `chooseConversationMemory` y se pasan `memorySource`/`memoryGaps` a `composeVaultPrompt`. Lo mismo en la sonda (`:1176`). **Los dos `appendTurn` (`:2906` y `:3235`) no se tocan.** Añadir la cobertura de recap al diagnóstico.

**Paso 8 — la pantalla.**
`apps/desktop/src/renderer/vault-sweep.ts` — `keepSweepingRecaps` + su prueba, **lo primero**, porque es la pieza que ya se ha entregado mal dos veces. Después `Vault.tsx`, `useVault.ts`, `preload/index.ts`, `styles.css`: el bloque del panel (§9.2).

**Paso 9 — `npm run check` entero** (lint, typecheck de código **y** de pruebas, test, build). Yo no lo he ejecutado y no lo voy a ejecutar: el worktree está ocupado.

**Paso 10 — la pasada real, de Daniel, con la bóveda abierta.**
Primero con `dryRun`, leer lo que sale de dos o tres conversaciones y decidir CLI **y modelo** — el único caso real documentado dice que esto depende del modelo, no del proveedor: Opus describió una imagen de la bóveda que Sonnet rechazó (`TEST-RESULTS.md:281-284`). Después la pasada de verdad, revisar en «Ver», aprobar. Anotar en `TEST-RESULTS.md` las cifras reales y **cuánto tardó cada llamada**, que es la medida que hoy falta.

**Paso 11 — la prueba que importa.**
Reabrir una conversación del 1 de septiembre y mirar dos cosas: que «prompt privado compuesto» enseña `memoria NNNc` con N cercano a los ~350-800 c y no a los ~15.900 del techo del esquema; y que Lía retoma sin pedir que se le repita lo de aquel día. Y con una deducida, que **no** se inventa lo que había dentro de una escena de la que sólo tiene el título.

**Paso 12 — documentación.**
`DECISIONS.md` (decisión nueva: la memoria retroactiva vive fuera del `.jsonl`; la sellada gana siempre; una negativa parcial se declara en el prompt; el extracto del modelo no se conserva aquí aunque el catálogo sí), `CURRENT-TASK.md` (cierra la línea pendiente de F22: «generarla de golpe por suscripcion queda por decidir»), `CHANGELOG-WORK.md`, `TEST-RESULTS.md`, `LOCAL-ACTIONS.md` (pasos 1 y 10), `docs/ROLEPLAY-MEMORIA.md`. `CLAUDE.md` y `AGENTS.md` si se añade el almacén a alguna lista.

### Archivos, resumidos

**Nuevos:** `packages/shared/src/vault-recap.ts` (+test), `apps/desktop/src/main/vault/recap-store.ts` (+test), `apps/desktop/src/main/vault/recap-sync.ts` (+test).

**Modificados:** `packages/shared/src/vault-prompt.ts` (+test), `packages/shared/src/index.ts`, `apps/desktop/src/main/index.ts`, `apps/desktop/src/main/ipc/handlers.ts`, `apps/desktop/src/main/vault/memory-diagnostics.ts`, `apps/desktop/src/shared/channels.ts`, `apps/desktop/src/shared/ipc.ts`, `apps/desktop/src/preload/index.ts`, `apps/desktop/src/renderer/useVault.ts`, `apps/desktop/src/renderer/vault-sweep.ts` (+test), `apps/desktop/src/renderer/pages/Vault.tsx`, `apps/desktop/src/renderer/styles.css`.

**NO SE TOCAN, nunca:** `apps/desktop/src/main/vault/conversation-store.ts`, `private-store.ts`, `packages/shared/src/vault.ts`, `vault-payloads.ts`, `schemas.ts`, `packages/vault-crypto/*`, `supabase/migrations/*`, `apps/gateway/*`.

---

## 12. Pruebas, una por comportamiento

**Núcleo puro (`vault-recap.test.ts`)**

1. `buildRecapPrompt` de la primera ventana pide la entrada `Empezó:` y NO lleva el bloque «lo que ya estaba anotado».
2. `buildRecapPrompt` de la segunda ventana lleva la ficha anterior renderizada y la orden de conservar literal, y reinyecta el ancla `Empezó:`.
3. `parseRecapResponse` devuelve `structured` / `absent` / `truncated` / `invalid` en los cuatro casos.
4. `verifyRecap` rechaza un `skipped` cuyo rango cae fuera de `covered`.
5. `verifyRecap` rechaza un `why` que no está en el enum.
6. `verifyRecap` rechaza una entrada que contenga la cadena `<LUXY_`.
7. `verifyRecap` rechaza una memoria con código dentro (`looksLikeCode`).
8. `clampRecapMemory` recorta a 400/6/160 en vez de rechazar, y el bloque renderizado nunca pasa de 1.800 caracteres, tirando primero `lessons` y nunca `facts`.
9. `scoreRecapVagueness` marca «tuvieron un encuentro íntimo y quedaron el sábado» y **no** marca una ficha concreta de tamaño parecido.
10. `recapWindow` termina siempre en turno del personaje.
11. `recapWindow` corta en el `to` de una escena cuando el catálogo es fiable y el corte cae en los últimos 12 turnos.
12. `recapWindow` **no** usa los rangos del catálogo cuando `detectEvenSplit` lo marca o cuando `turnsAtCatalog < turns`.
13. `recapWindow` con 40 mensajes del usuario seguidos alarga hasta la primera respuesta en vez de devolver `null`.
14. `countKeptEntries` cuenta bien `kept` / `rewritten` / `dropped`.
15. `deduceRecap` produce sólo resúmenes de escena (ni fechas ni listas vacías rellenas) y no crea entrada si no hay resúmenes.
16. `chooseConversationMemory`: la sellada gana siempre sobre el recap.
17. `chooseConversationMemory`: un recap no aprobado no se usa.
18. `chooseConversationMemory`: un recap cuyo `coveredAt` no casa no se usa.
19. **Invariante de cobertura**: un recap que cubre 0-39 de 65 turnos NO se usa; uno que cubre hasta el primer turno de la cola literal SÍ.
20. `refusedStillRecap` deja pasar cuando cambia el CLI, cuando crece la conversación y cuando sube `RECAP_VERSION`.
21. `recapCoverage`: los cuatro números suman siempre el total menos excluidas.

**Prompt (`vault-prompt.test.ts`)**

22. Sin `memorySource`, el prompt sale byte a byte igual que antes del cambio (salvo la regla anti-invención, que se fija en su propia prueba).
23. `source: 'recap'` con `gaps > 0` emite la coletilla **y** conserva el aviso de turnos omitidos.
24. `source: 'index'` cambia el título y conserva el aviso.
25. `source: 'turn'` no emite ni coletilla ni aviso (como hoy).
26. El bloque de memoria lleva su regla contra la invención en los tres orígenes.

**Almacén (`recap-store.test.ts`)**

27. Ida y vuelta cifrada: lo escrito se lee igual.
28. Una entrada inválida se descarta de la lista usada, se cuenta, **y vuelve al archivo** al guardar.
29. Un sobre que no abre lanza y **no** sobrescribe nada.
30. `checkedForWrite` se niega a escribir un estado inválido y no toca el archivo.
31. Dos `apply` concurrentes no se pisan.
32. `removeConversation` borra la entrada de esa conversación.

**Pasada (`recap-sync.test.ts`, con controlador falso, sin arrancar ningún CLI)**

33. El proveedor **nunca** es de pago, aunque la preferencia venga tocada a mano con uno.
34. Las conversaciones se recorren en orden cronológico ascendente.
35. Una conversación con memoria sellada viva se marca `supersededAt` y se salta.
36. Una negativa persiste con su `refusedKind` y su CLI, y el cursor no avanza.
37. Una negativa en una conversación **no arrastra** a las otras dieciséis.
38. Una ventana negada se salta y la siguiente se procesa; el tramo entra en `gaps`.
39. Dos ventanas negadas seguidas paran esa conversación en esa pasada.
40. Si todas las ventanas fallan, sale el índice deducido.
41. Una respuesta vaga no se guarda, no avanza el cursor y se cuenta en `vague`.
42. La segunda ventana recibe la ficha de la primera.
43. Cerrar la bóveda a mitad para la pasada entre ventanas sin escribir nada a medias.
44. `dryRun` no escribe ni una entrada.
45. El registro no lleva `conversationId`, ni títulos, ni extractos de lo que dijo el modelo.

**Pantalla (`vault-sweep.test.ts`)**

46. `keepSweepingRecaps` sigue con `refused > 0`, con `vague > 0`, con `failed > 0` y con `deduced > 0`; y corta con `pending === 0` o cuando no pasó nada.

**Borrado (`conversation-delete.test.ts`)**

47. Borrar una conversación borra también su recap.

---

## 13. Lo que se decidió NO hacer, y por qué

| descartado | motivo |
|---|---|
| **Re-sellar o reescribir un registro del `.jsonl`** | No existe API; obliga a reescribir el archivo entero con el único precedente que NO hace `fsync`; `sealTurn` estampa `recordId` y `createdAt` nuevos y pondría las 17 con fecha de hoy; una memoria que no abra apaga la lista entera de Privado. §3.2 |
| **Añadir un registro sintético «sólo memoria»** | `privateRecordSchema` exige `content`: sería un turno fantasma en `read()`, la pantalla, el índice, la línea temporal, los episodios, el `turns` de la lista y los ULTIMOS TURNOS del prompt, y rompería los cursores de pendientes |
| **Reutilizar `<LUXY_MEMORY>`** | La rama técnica del job-runner prohíbe expresamente escribir bloques de memoria, y `lastIndexOf` haría que un recap con esa cadena secuestrara el parseo del turno vivo siguiente |
| **`interactionMode: 'conversation'` para la pasada** | Haría que Claude o Codex **encarnaran a Lía** sobre contenido explícito: la tasa de negativa máxima posible, y justo lo que la separación técnica evita |
| **Caída automática al otro CLI**, y cualquier API de pago | Quien elige es Daniel, en el panel. `D-087` |
| **Reintentar la misma ventana con el mismo CLI** esperando otra suerte | Cuesta el arranque del proceso y falla igual |
| **Suavizar o falsear el material para esquivar la moderación** | Produciría una memoria que no corresponde a la conversación: peor que no tenerla |
| **Trocear en pedazos minúsculos para «diluir» lo explícito** | Multiplica las llamadas y el problema sigue ahí |
| **Cambiar `conversationMemorySchema` o subir `VAULT_PAYLOAD_VERSION`** | Todo el metadato que falta cabe en la entrada del almacén nuevo. Cero migraciones |
| **Sincronizar `recap.json` al servidor** | Es una caché regenerable; meterla en el registro chocaría además con `(conversation_id, sequence)`. Lo que sí viaja es la memoria sellada que descienda de ella |
| **Un índice deducido con fechas y títulos** | Ya viajan en cada prompt como líneas de índice (§1). Sólo se aporta lo que falta: el resumen de cada escena |
| **Contar el índice deducido como cobertura** | No es memoria. Tiene su columna, su título propio en el prompt y conserva el aviso de turnos omitidos |
| **Conservar el extracto de lo que dijo el modelo al negarse** | Aquí es contenido de la bóveda con otro nombre. Se sustituye por la clasificación, que da la misma información operativa. §8.3 |
| **Edición libre del recap en la v1** | Son seis listas anidadas y una pantalla entera. «Borrarlo» y «Rehacerlo con el otro CLI» cubren el caso. Queda para una v2 |
| **Rellenar la conversación que YA tiene memoria sellada** | La sellada gana siempre, así que el trabajo se tiraría. Se marca `supersededAt`. Son 17 de 18, que es exactamente lo que se pidió |
| **Mezclar la memoria sellada con el recap** | Dos memorias escritas por modelos distintos, sin criterio de desempate: un modo de fallo nuevo a cambio de nada |
| **Arreglar el `try/catch` que le falta a `list()`** (`conversation-store.ts:205-217`) | Fuera de alcance: este diseño lo **esquiva** no escribiendo ahí, no lo arregla. Es una bomba encendida que merece su propia tarea |

---

## 14. Riesgos, sin maquillar

1. **La tasa de negativa es desconocida.** No hay en todo el repositorio ni una medida de Claude o Codex sobre esta bóveda. El 17/17 del catálogo (`TEST-RESULTS.md:146-160`) se hizo «unos con opus y otros con DeepSeek», **antes** de `D-087`, y pedía un **índice** —cuya seguridad se apoya en una asimetría que el propio archivo declara: un catálogo equivocado hace que un recuerdo no se encuentre, nunca que se invente—. Resumir expone más. **Que 17/17 pasen catalogando no permite concluir que 17/17 pasen resumiendo.** Por eso el paso 1 mide antes de construir.
2. **El hueco que no se declara.** Un modelo que se autocensura sin rellenar `skipped` deja un resumen que parece completo. El detector de vaguedad caza la versión tosca; **no caza la sosez competente**. Es el fallo que este diseño no cierra, y por eso la aprobación de Daniel y el visor no son adornos.
3. **El recap se propaga para siempre.** «Conserva lo valido de la memoria anterior» convierte lo que escriba el CLI en la semilla que el modelo de pago arrastra en cada turno futuro de ese hilo. Corta en los dos sentidos: es la razón de hacerlo bien y la razón de no hacerlo deprisa.
4. **Sonar a formulario.** El esquema es de tarea, los dos generadores son CLI técnicos, y `docs/ROLEPLAY-MEMORIA.md:271-277` avisa de que la deriva hacia la voz del modelo **es el único fallo de esa lista que pasa el `npm run check` entero y llega a producción intacto**, y además es gradual. Se ataca con el encuadre, el vocabulario de escena, los ejemplos y las palabras prohibidas. El juez es Daniel leyendo las 17.
5. **Deriva entre ventanas.** Con los datos reales sólo 2 conversaciones encadenan, así que **el camino más delicado del código es el que menos se va a ejercitar en la práctica**. Necesita prueba unitaria expresa (12, 14, 42), no confianza.
6. **Dos relatos del mismo pasado sin desempate.** El pasado de la conversación abierta aparece hasta tres veces en el prompt: como líneas de índice, posiblemente citado, y resumido en `memoria`. Catálogo y recap los escribieron modelos distintos y pueden contradecirse.
7. **Sin fechas dentro del bloque.** `formatConversationMemory` no lleva ninguna, al contrario que las líneas de recuerdo y los pendientes. Una conversación puede abarcar varios días (los episodios cortan a 6 h de silencio; 18 conversaciones dieron 40 momentos en 6 días). Mitigación: el prompt pide que las fechas vayan dentro del texto de `facts`.
8. **Coste permanente en el prompt**, acotado por los topes del relleno y el tope duro de 1.800 c, no por los ~15.900 del esquema.
9. **Tres pasadas sobre un solo carril y un solo CLI.** Y el carril **no cubre el turno privado** (`host-entry.ts` atiende sin serializar), así que la pasada puede correr a la vez que un turno de pago; el único guardia es `sendInFlight`, que es de lectura.
10. **Asimetría entre hilos.** Si salen 11 de 17, Lía será más coherente en unos que en otros. La línea de cobertura existe para que eso se vea en vez de parecer que «a veces se le va».
11. **La negativa depende del MODELO más que del proveedor.** El único caso real documentado es Opus describiendo una imagen que Sonnet rechazó. El selector del panel elige CLI, no modelo.
12. **Barras invertidas.** El módulo puro lleva expresiones regulares. Se escriben con la herramienta de edición de archivos, **nunca por heredoc**: un `\s` que llega como `s` compila, pasa el typecheck y sólo lo caza una prueba (`CLAUDE.md`, regla 2 bis).

---

## 15. La pregunta que conviene hacerle a Daniel antes del paso 2

«Memoria acumulativa de los chats antiguos» puede querer decir dos cosas, y esto sólo da una: **que al reabrir una conversación antigua, Lía sepa en qué punto quedó esa conversación**. Si lo que espera es **que se acuerde de un hilo cuando está en otro**, esto no se lo da: la memoria es por conversación (`latestMemory` es por hilo, el bloque se titula «DE ESTA CONVERSACION»), y ese canal son los recuerdos y los pendientes. Merece la pena preguntárselo antes de gastar el trabajo.

---

## 16. Correcciones tras implementar los pasos 2 a 5 (2026-09-14)

Este diseño se escribió antes de tocar código. Los pasos 2 a 5 están hechos y
comprobados, y una revisión adversarial con tres lentes confirmó **ocho**
defectos, **seis de ellos graves**. Lo que sigue manda sobre lo escrito arriba.

**El patrón, otra vez.** Cinco de los ocho eran variantes de `D-088`: algo se
daba por leído sin haberse leído, o se perdía sin avisar. Es el mismo defecto
que apareció en las promesas, en otro código y con otra cara.

### Los graves

**§4.4 y §5 — el encadenado tiraba lo NUEVO.** Con seis entradas por lista, la
ventana 2 **no podía aportar nada** a `facts`: el recorte se quedaba con las
primeras, que son siempre las de la ventana anterior. Una conversación de 65
turnos habría resumido sólo sus primeros 40. `clampRecapMemory` recibe ahora
`{chained}` y, si hay ficha anterior, conserva el ancla y las ÚLTIMAS entradas;
el prompt de la segunda ventana lo dice expreso («lo nuevo NO se queda fuera»);
y `RecapDrift` gana `added`, para poder ver si una ventana aportó algo.

**§4.3 y §7 — el hueco sólo se declaraba por la cola.** Un `covered.from` mayor
que el de la ventana dejaba turnos del PRINCIPIO dados por leídos sin leerse, y
sin declarar. Peor: `verifyRecap` validaba los tramos saltados contra el
`covered` que decía el propio modelo, así que **la respuesta honesta se
invalidaba entera y la silenciosa pasaba**. Ahora se valida contra la ventana
que se envió, y el tramo de cabecera se declara solo.

**§8 — una ventana ilegible borraba la aprobación de Daniel** sin cambiar una
palabra del contenido. Si la pasada no cambia nada, la entrada anterior se
conserva entera y sólo se le estampa el motivo encima.

**§8 — se clasificaba antes de leer.** `classifyReply` corría sobre el texto
entero antes de intentar el bloque, así que una ficha correcta **con vocabulario
de escena** —que es exactamente lo que se le ha pedido— se tiraba como negativa
y su tramo se declaraba como hueco. Ahora: leer, verificar, y clasificar sólo si
no hay ficha que valga, y sobre el texto de fuera del bloque.

**§5 — tras una ventana negada, a la siguiente se le decía que era «la PRIMERA
parte de la conversación»** y se le pedía contar cómo empezó. Se le estaba
pidiendo que inventara. Hay ahora tres arranques de prompt, y el del principio
se elige por empezar en el primer turno, no por no tener ficha previa.

### Los menores

**§6** — el índice deducido da dos cifras cuando hay más de seis escenas («6 de
las 9»): decir 9 y enseñar 6 invita a suponer las otras tres.

**§10** — la línea de la tanda gana `aportadas`. Es una cifra.

### Firmas que cambian, para el paso 6

`clampRecapMemory(memory, { chained })`, `RecapVerificationContext.chained?`,
`RecapPromptInput.startsAtFirstTurn` (obligatorio), `RecapDrift.added`,
`RecapCounters.added` y `RecapRunResult.added`.

### Dos cosas vistas y NO arregladas, por estar fuera del encargo

- `result.chars` de una tanda que no cambia nada suma los caracteres de la ficha
  que sigue en disco. Es un contador de registro y las dos lecturas se defienden;
- una conversación cuyo recap sea un índice deducido vuelve a entrar en cada
  pasada (su cursor es -1 por diseño) y gasta un hueco de la tanda aunque no
  haya nada que hacer. Merece su propia tarea.

### Y un incidente que confirma la regla 2 bis de `CLAUDE.md`

Una clase de caracteres con marcas combinantes **se transformó al escribirse**,
aun usando la herramienta de edición: llegó al disco con los caracteres
combinantes literales, invisibles en el editor. No se re-escapó: se sustituyó
por un recorrido comparando puntos de código contra dos constantes, que no puede
romperse por ese camino. Las cuatro expresiones regulares que quedan se
comprobaron con `grep` **sobre el archivo**, no sobre el comando.
