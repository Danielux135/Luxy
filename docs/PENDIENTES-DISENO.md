# F23-PENDIENTES-001: asuntos pendientes que Lía saca sola

## 1. Qué hace

Luxy guarda, dentro de la bóveda cifrada, cada promesa o plan que quedó pendiente entre Daniel y Lía. Cada uno es un puntero a un turno real con una cita literal que el código comprueba. Un modelo de suscripción (Codex o Claude) los extrae entre turnos, siempre con la misma función y el mismo cursor para las 17 conversaciones antiguas y para las nuevas. En el turno de pago, el código elige como mucho 2 y los añade como un bloque de DATOS. Cada línea lleva hechos ya calculados («hace 7 dias», «no lo has sacado nunca», «el no ha vuelto a nombrarlo»). Así ella puede recordárselo, reclamárselo, echárselo en cara o callárselo con su voz, sin que Daniel lo nombre y sin repetirse. La llamada de pago sigue siendo una sola: no hay salida nueva, y el bloque solo existe los turnos en que la selección da líneas.

**De dónde sale.** La base es el diseño 2: puntero con cita verificada, rol comprobado, una sola vía de captura, cursor, claves deterministas, lápidas y Daniel con la última palabra. Del diseño 3 vienen la dosificación sin estado calculada desde la línea temporal, la guarda de desfase, los hechos por línea, la simulación sobre los mensajes reales, la prueba centinela, `LOCAL_CLI_PROVIDERS` y `kind` preparado para ánimo y personas. Del diseño 1 vienen la guarda de proveedor del catálogo, el corte del bucle solo con `cataloged === 0`, el disparo por inactividad y la frase «puedes creerle o pedirle que te lo demuestre».

**Qué corrige de los diseños.**
- Ya no hay «solo esta cumplida si pasa en la escena», que contradecía el canon.
- La regla contra inventar cuenta también el momento transcrito.
- El desfase se acota por promesa y no cuenta las conversaciones negadas.
- El diagnóstico va en un archivo aparte.
- El proveedor auxiliar es una preferencia del proceso principal y, si no se ha elegido, vale `codex`.
- No hay afirmaciones de concurrencia sin medir.

## 2. Modelo de datos

### 2.1 Tipos y esquemas puros (`packages/shared/src/vault-relation.ts`, nuevo)

```ts
import { z } from 'zod';
import { LOCAL_CLI_PROVIDERS, type ReasoningEffort } from './constants.js';

// v1 solo produce 'promise' y 'plan'. Los demas reservan la forma para el
// animo (joy/hurt) y para lo que ella sabe de el (taste/person).
export const RELATION_KINDS = ['promise', 'plan', 'joy', 'hurt', 'taste', 'person'] as const;
export type RelationKind = (typeof RELATION_KINDS)[number];
export const ACTIVE_RELATION_KINDS = ['promise', 'plan'] as const;

export const RELATION_STATUSES = ['open', 'fulfilled', 'released', 'dismissed'] as const;
export const RELATION_EXTRACTOR_VERSION = 1;
export const RELATION_OPEN = '<LUXY_PENDIENTES>';
export const RELATION_CLOSE = '</LUXY_PENDIENTES>';
export const RELATION_WINDOW_TURNS = 40;   // parte nueva por llamada
export const RELATION_CONTEXT_TURNS = 4;   // contexto ya revisado, marcado
export const RELATION_OPEN_LIST_MAX = 30;  // abiertas que se le enseñan
export const QUOTE_MIN_CHARS = 12;
export const QUOTE_MAX_CHARS = 240;

const iso = z.string().datetime();

export const relationTurnRefSchema = z.object({
  conversationId: z.string().uuid(),
  sequence: z.number().int().min(0),
});

export const relationNoteSchema = z.object({
  /** sha256 de `${conversationId}#${sequence}#${normalizeQuote(quote)}`, 16 hex */
  id: z.string().regex(/^[0-9a-f]{16}$/),
  kind: z.enum(RELATION_KINDS),
  /** quien se compromete; 'both' = plan de los dos */
  by: z.enum(['user', 'character', 'both']),
  origin: relationTurnRefSchema.extend({
    role: z.enum(['user', 'assistant']),
    at: iso, // createdAt del turno: ordena sin descifrar
  }),
  /** LITERAL y verificada contra origin al guardar y al enseñar */
  quote: z.string().min(QUOTE_MIN_CHARS).max(QUOTE_MAX_CHARS),
  /** indice libre del extractor: SOLO sirve para callarla antes, nunca llega al prompt */
  keywords: z.array(z.string().min(2).max(30)).max(5).default([]),
  status: z.enum(RELATION_STATUSES),
  closure: z
    .object({
      how: z.enum(['fulfilled', 'released', 'dismissed']),
      /** turno donde se ve; null si lo cerro Daniel o si su conversacion se borro */
      ref: relationTurnRefSchema.extend({ quote: z.string().max(QUOTE_MAX_CHARS), at: iso }).nullable(),
      at: iso,
    })
    .nullable(),
  source: z.enum(['extractor', 'manual']).default('extractor'),
  /** quien puso el estado actual: el extractor nunca pisa a 'daniel' */
  decidedBy: z.enum(['extractor', 'daniel']),
  reopenedByDaniel: z.boolean().default(false),
  extractedBy: z.string().max(128).nullable(),
  extractorVersion: z.number().int().min(1),
  createdAt: iso,
  updatedAt: iso,
});
export type RelationNote = z.infer<typeof relationNoteSchema>;

export const relationCursorSchema = z.object({
  conversationId: z.string().uuid(),
  /** ultimo turno del PERSONAJE ya revisado; -1 = nada */
  through: z.number().int().min(-1),
  /** createdAt de ese turno: si no casa, el cursor vuelve a -1 (reextraer es idempotente) */
  throughAt: iso.nullable(),
  version: z.number().int().min(1),
  provider: z.enum(LOCAL_CLI_PROVIDERS),
  model: z.string().max(128).nullable(),
  at: iso,
  /** negativa persistida: no bloquea el desfase y no se reintenta sola si no ha crecido */
  refusedVersion: z.number().int().min(1).nullable().default(null),
  refusedAtTurns: z.number().int().min(0).nullable().default(null),
});

export const relationCountersSchema = z.object({
  proposed: z.number().int().min(0).default(0),
  accepted: z.number().int().min(0).default(0),
  rejectedShape: z.number().int().min(0).default(0),
  rejectedQuote: z.number().int().min(0).default(0),
  rejectedRole: z.number().int().min(0).default(0),
  rejectedWindow: z.number().int().min(0).default(0),
  rejectedClosure: z.number().int().min(0).default(0),
  merged: z.number().int().min(0).default(0),
  refused: z.number().int().min(0).default(0),
});

/** respuesta del extractor, tolerante elemento a elemento */
export const relationProposalSchema = z.object({
  turn: z.number().int().min(0),
  by: z.enum(['user', 'character', 'both']),
  kind: z.enum(ACTIVE_RELATION_KINDS),
  quote: z.string().transform((v) => v.trim()).pipe(z.string().min(QUOTE_MIN_CHARS).max(QUOTE_MAX_CHARS)),
  keywords: z.array(z.unknown()).default([]).transform((vs) =>
    vs.filter((v): v is string => typeof v === 'string').map((v) => v.trim().slice(0, 30)).filter((v) => v.length >= 2).slice(0, 5)),
});
export const relationClosureProposalSchema = z.object({
  ref: z.string().min(2).max(8), // p1..p30
  how: z.enum(['fulfilled', 'released']),
  turn: z.number().int().min(0),
  quote: z.string().transform((v) => v.trim()).pipe(z.string().min(QUOTE_MIN_CHARS).max(QUOTE_MAX_CHARS)),
});

/** a quien se manda el trabajo auxiliar: NUNCA a una conexion de pago */
export interface AuxiliaryTarget {
  provider: (typeof LOCAL_CLI_PROVIDERS)[number];
  model: string | null;
  effort: ReasoningEffort | null;
  /** true si lo pedido no era un CLI y se sustituyo */
  replaced: boolean;
}
export function resolveAuxiliaryTarget(
  requested: { provider: string; model: string | null; effort: ReasoningEffort | null } | null,
  preferred: { provider: (typeof LOCAL_CLI_PROVIDERS)[number]; model: string | null } | null,
): AuxiliaryTarget;
```

Funciones puras del mismo módulo:
- `normalizeQuote(text)`: pasa a minúsculas; quita las tildes y conserva la ñ; quita los asteriscos y las comillas «»"“”'; convierte la puntuación en espacios y colapsa los espacios.
- `quoteAppearsIn(quote, turnText)`: comprueba contra el texto COMPLETO del turno, no contra el recortado. Una cita que cruce la marca «[…recorte…]» no aparece y se rechaza.
- `buildRelationExtractionPrompt(...)`.
- `parseRelationExtraction(text)`: devuelve `structured`, `absent`, `truncated_block` o `invalid`, más las propuestas válidas y el recuento de las mal formadas.
- `verifyRelationExtraction(parsed, ctx)`.

Las expresiones regulares de `normalizeQuote` se escriben con la herramienta de edición, nunca con heredoc (CLAUDE.md, regla 2 bis).

`packages/shared/src/vault-catalog.ts` exporta, sin cambiar su comportamiento, las piezas de recorte que hoy son privadas: `flatten`, `turnAllowance`, `clip` y `CUT_MARK`, con los nombres `flattenTurnText`, `turnAllowance`, `clipMiddle` y `CATALOG_CUT_MARK`. El extractor usa el mismo recorte por el medio y el mismo tope de 60.000 caracteres.

### 2.2 Línea del prompt (`packages/shared/src/vault-prompt.ts`)

```ts
export interface PendingAffairLine {
  by: 'user' | 'character' | 'both';
  day: string;              // civilDayLabel(origin.at, anchor), AAAA-MM-DD
  daysAgo: number;          // dias civiles (corte a las 05:00)
  quote: string;            // literal
  raisedCount: number;      // veces que ELLA lo saco (solo por la cita, no por keywords)
  lastRaisedDaysAgo: number | null;
  heMentionedDaysAgo: number | null;
  touchedNow: boolean;      // lo nombra en su mensaje de ahora
}
// VaultPromptInput gana: pending?: PendingAffairLine[]
```

### 2.3 Almacén cifrado (`apps/desktop/src/main/vault/relation-store.ts`, nuevo)

- `relationFilePath(configDir)` devuelve `<configDir>/vault/relation.json`.
- El sobre es `{version:1, content}`, sellado con `vault.subkeyFor('identity','relation')` y el propósito `'vault.identity'`, calcado de `catalog-store.ts`. `'identity'` ya está en `KEY_DOMAINS` (`packages/vault-crypto/src/kdf.ts:133`), así que no se toca la criptografía.
- Escritura atómica, con `.tmp` más `rename`. El `.tmp` va sellado.
- Contenido: `{ v: 1, notes: unknown[], cursors: unknown[], counters }`.
- Lectura TOLERANTE, al revés que `CatalogStore.list()` (`catalog-store.ts:74-79`, que devuelve `[]` sin avisar):
  - cada nota y cada cursor se validan uno a uno; los inválidos o de un `kind` desconocido se cuentan en `droppedOnRead` y el resto sigue;
  - si el sobre no se abre, se lanza `VaultError` y el archivo NO se sobrescribe nunca, porque perderlo borraría las decisiones de Daniel.
- API:
  - `read(vault)` devuelve `{notes, cursors, counters, droppedOnRead}`;
  - `apply(vault, mutator)`, serializada con una cola de promesas interna, para que el extractor y los botones de la interfaz no se pisen;
  - `removeConversation(vault, id)`.
- No guarda `characterId`: el dueño se deduce al leer, a partir de la conversación de origen (el mismo criterio que los episodios, D-058 y D-062).
- No hay caché en memoria.

### 2.4 Preferencia del auxiliar (`apps/desktop/src/main/vault/memory-preferences.ts`)

- `fileSchema` gana `auxiliary: z.object({ provider: z.enum(LOCAL_CLI_PROVIDERS), model: z.string().max(128).nullable() }).nullable().default(null)`.
- Métodos nuevos: `auxiliary()` y `setAuxiliary()`, y `persist()` escribe los dos campos.
- Sigue sin cifrar porque solo lleva ids, como `excluded`.
- Si vale `null`, el valor efectivo es `{provider:'codex', model:null}`.

### 2.5 Catálogo (`apps/desktop/src/main/vault/catalog-store.ts`)

`catalogedEpisodeSchema` gana `provider: z.string().max(64).nullable().default(null)`. El valor por defecto es obligatorio: sin él, un payload antiguo haría que `list()` devolviera `[]` y se perderían los 40 momentos.

## 3. Captura en los turnos nuevos

Todo corre en el proceso principal (`apps/desktop/src/main/vault/relation-sync.ts`, nuevo). No hay llamadas de pago.

**Una sola función, `RelationSync.runOnce({conversationId?, limit})`.** Por cada conversación pendiente:
1. Lee los turnos desde `cursor.through + 1` hasta el ÚLTIMO TURNO DEL PERSONAJE. Nunca lee un mensaje del usuario sin respuesta: `removeLastTurn` lo retira y `appendTurn` reutiliza su `sequence` (`conversation-store.ts:161` y `362`).
2. Si ya se ha procesado alguna parte, añade 4 turnos de contexto marcados.
3. Toma una ventana de 40 turnos.
4. Le pasa las notas abiertas del MISMO personaje con `origin.at` anterior al primer turno de la ventana: las 30 más recientes, con refs posicionales p1..p30.
5. Llama a `controller.runLocalTurn({ kind: 'technical', provider, model, projectAlias, prompt })`. `provider` y `model` salen de `resolveAuxiliaryTarget(null, preferences.auxiliary())`, así que por construcción solo pueden ser `claude` o `codex`.
6. `parseRelationExtraction` y `verifyRelationExtraction` aplican lo siguiente, descartando de uno en uno con su motivo contado:
   - el turno está dentro de la parte nueva (si no, `rejectedWindow`);
   - el rol casa: `by:'user'` solo si la cita sale de un turno del usuario, `'character'` solo si sale de uno del personaje, y `'both'` vale con cualquiera (si no, `rejectedRole`). Esto impide blanquear un «me prometiste un collar» que se inventara ella;
   - la cita aparece literal en ese turno una vez normalizada (si no, `rejectedQuote`);
   - un cierre apunta a una ref ofrecida, a un turno de la parte nueva con `createdAt` posterior al origen y a una conversación del mismo personaje (si no, `rejectedClosure`).
7. `mergeExtraction` (`apps/desktop/src/main/vault/relation.ts`, puro) fusiona:
   - id determinista;
   - una cita contenida en otra, o con Jaccard de raíces ≥ 0,6 en el mismo turno, se queda con la existente;
   - la repetición de una abierta (mismo `by`, mismo personaje y Jaccard ≥ 0,5) cuenta como `merged`, no como nota nueva;
   - lo que choca con una lápida `dismissed` se tira y cuenta como `merged`;
   - el extractor NUNCA reabre ni toca una nota con `decidedBy:'daniel'`.
8. Se hace un `store.apply` atómico con notas, cursor y contadores. Solo avanza el cursor si el estado fue `structured`.
9. Si la respuesta no trae bloque (una negativa), el cursor no avanza. Se guardan `refusedVersion` y `refusedAtTurns`, se suma `refused` y la conversación se salta en la sesión (`relationFailures`, como `catalogFailures`). No hay caída automática a otro proveedor.

**Serialización.** El catálogo y la extracción comparten un único carril, `runOnAuxiliaryLane(task)` en `registerIpcHandlers`. Sustituye al bucle `while (catalogInFlight !== null)` de `handlers.ts:1297-1311`, de modo que nunca corren dos CLI a la vez.

**Disparos.** Sin esperar, y siempre después de escribir la respuesta:
- **Tras cada turno privado** (`vaultConversationSend`, después de `context.privateMemory.invalidate()`, hacia la línea 2886) se llama a `void relationSync.afterTurn({conversationId, wroteReply, firstTurn: existing.length === 0})`:
  - si `wroteReply` es falso, no hace nada;
  - reinicia el temporizador de inactividad a 3 minutos;
  - si la conversación actual tiene 4 turnos o más detrás del cursor, la procesa ya. Así sale media llamada de suscripción por turno. No se pierde nada, porque hasta que se extrae la promesa sigue literal en los 8 turnos recientes (`VAULT_RECENT_TURNS`);
  - si era el primer turno de una conversación nueva, procesa la cola de las demás, es decir, la anterior que se dejó a medias.
- **Inactividad.** A los 3 minutos sin turnos privados se procesa la actual si tiene 1 turno o más detrás, y hasta 2 conversaciones distintas con 10 minutos o más sin turnos. Al dispararse comprueba `vault.isUnlocked()`.
- **Envío en curso.** Nunca se extrae una conversación con un envío en curso. El Set `sendInFlight` se rellena al entrar en `vaultConversationSend` y se vacía en `finally`.
- **Bloqueo.** `context.vault.onLock(() => relationSync.cancel())` cancela el temporizador. Un `runOnce` a medias falla limpio al sellar, porque `subkeyFor` exige la bóveda abierta: no guarda nada ni avanza el cursor.
- **Primero el temporizador, luego el disparo inmediato.** El disparo por inactividad se activa antes que el inmediato tras el turno. `host-entry.ts:195` atiende los mensajes sin serializar, así que en principio el turno de pago y el CLI pueden correr a la vez. Aun así, antes de activar el disparo inmediato se mide: un registro nuevo, «turno privado terminado», lleva `{duracionMs: result.durationMs, extraccionEnCurso}` y se comparan las medianas con y sin extracción. Si el turno empeora, se queda solo el de inactividad.

## 4. Pasada sobre las conversaciones antiguas

- Una conversación está pendiente si no tiene cursor, si su `through` está por detrás del último turno del personaje, si `version < RELATION_EXTRACTOR_VERSION` o si `throughAt` no casa. Hoy lo están las 17.
- Van en **orden cronológico**, por el `createdAt` de su primer turno, de la más antigua a la más nueva. Así, al procesar la conversación del día 4, ya existe la promesa del día 1 y se puede cerrar. Además, la lista abierta se filtra por `origin.at` anterior al primer turno de la ventana: aunque el orden se rompa en un reintento, una ventana antigua nunca ve ni cierra una promesa del futuro.
- **Ventanas de 40 turnos** con 4 de contexto. Una conversación de más de 60 turnos no pierde la cola, al contrario que el catálogo (`CATALOG_MAX_TURNS`, `handlers.ts:1348` más `turnsAtCatalog` en la 1393). El progreso parcial se conserva ventana a ventana.
- **Arranque.**
  - Al abrir «Lo que recuerda», después del bucle del catálogo y en el mismo carril, `MemoryPanel` repite `syncRelations({limit:3})` hasta `pending === 0`, o hasta que una tanda no avance ningún cursor, con un tope de 12 vueltas.
  - Hay además un botón, «Buscar lo pendiente en lo ya hablado».
  - El bucle no se para por un fallo aislado: una negativa en una conversación explícita no detiene las otras 16.
- **Menciones de lo antiguo.** No hay que recalcular nada: son deducidas (§6.2) de la línea temporal que ya está en RAM. Una promesa del 2026-09-01 llega desde el primer momento con su «no lo has sacado nunca» o «lo has sacado 2 veces».
- **Versiones futuras.** Subir `RELATION_EXTRACTOR_VERSION` (v2 con `joy` y `hurt`) vuelve a poner pendientes todas las conversaciones. Reextraer es idempotente: lo que existe no se duplica y lo cerrado o descartado no se reabre.
- **Coste.** Entre 17 y 20 llamadas de suscripción una sola vez, de 20 a 60 s cada una (11-16 s de arranque del CLI). En total, de 6 a 20 minutos en segundo plano. Cero llamadas de pago.
- **Cuándo está hecha.** En el diagnóstico, `coverage.behind === 0`, `coverage.upToDate === 17 − excluidas` y `extraction.byProvider.other === 0`.

**Guarda del catálogo, que va en el mismo cambio y como paso 1.** Hoy `catalogOnce` llama a `runLocalTurn` con `args.provider` (`handlers.ts:1355-1357`), que es el proveedor del compositor (`Vault.tsx:205` y `343`). Con DeepSeek, abrir el panel cuesta llamadas de pago. A partir de ahora:
- `catalogOnce` usa `resolveAuxiliaryTarget(args, context.memoryPreferences.auxiliary())`: un proveedor que no esté en `LOCAL_CLI_PROVIDERS` se sustituye y se descartan su modelo y su esfuerzo;
- cada entrada guarda `provider`;
- el bucle de `Vault.tsx:4227` corta solo con `result.cataloged === 0`, y no con `failed > 0`;
- el aviso de `Vault.tsx:4246` dice que el texto va a Codex o a Claude, el elegido en el panel, y nunca a una API de pago.

## 5. Ciclo de vida y edición manual

**Qué cuenta.**
- PROMESA: uno se compromete a hacer algo por el otro más adelante («mañana te traigo dos cafés y una tarta de chocolate a la cama», «te debo una»).
- PLAN: los dos quedan en hacer algo juntos más adelante.
- NO cuenta:
  - un deseo sin compromiso;
  - una hipótesis;
  - lo que se hace en ese momento o en el turno siguiente;
  - lo que se promete y se cumple en la misma ventana;
  - lo prometido a terceros;
  - lo que se dice fuera de la historia, sobre la aplicación o el roleplay.

**Estados guardados.**
- `open`: al crearla.
- `fulfilled`: un turno posterior y verificado muestra que se hizo. Puede decirlo cualquiera de los dos roles.
- `released`: quien la esperaba la perdona, o quien la hizo se desdice y el otro lo acepta.
- `dismissed`: solo Daniel, con «No era una promesa». Es una lápida: nunca se borra y bloquea que se vuelva a proponer.
- Recordarla, reclamarla o repetirla no la cierra.

**Estados deducidos**, que se calculan en cada turno y no se guardan, así que no se desincronizan. La selección de §6 decide «en escena», «en reposo», «en espera», «tocada», «dormida», «bloqueada por desfase» y «cita rota».

**Transiciones.**
- El extractor solo puede crear notas `open` y cerrar notas `open`, con `decidedBy:'extractor'`.
- Daniel puede todas las transiciones: Cumplida, Ya no vale (`released`), No era una promesa (`dismissed`) y Reabrir (`open`, `reopenedByDaniel:true`).
- Cada cambio de Daniel pone `decidedBy:'daniel'`.

**Borrados y exclusiones.**
- **Borrar la conversación de origen** borra sus notas y su cursor (`context.relations.removeConversation` junto a `context.catalogs.removeConversation`, `handlers.ts:1062`).
- **Borrar la conversación del cierre** conserva el cierre con `closure.ref = null`. Reabrirla haría que ella reclamase algo cumplido, y ante la duda el lado seguro es que calle. Se cuenta en `closuresOrphaned` y Daniel puede reabrirla.
- **Excluir una conversación** no borra nada. Sus notas dejan de ofrecerse, porque `PrivateMemory` no la incluye en `conversationsFor`, y no se envía al extractor.

**Edición manual.** Sección «Lo que tenéis pendiente» dentro de `MemoryPanel`:
- una lista por personaje con quién, la cita literal, el día, el estado y «revisado con Codex/Claude»;
- los botones Cumplida, Ya no vale, No era una promesa y Reabrir (`vaultRelationUpdate`);
- «Ver turno», que reutiliza `vaultMemoryRead` con `from = to = sequence`;
- el selector «Quién hace el trabajo de fondo (sin coste por turno)», limitado a los CLI detectados de Claude y Codex con su modelo, que usan tanto el catálogo como el extractor.
- No hay alta en texto libre: todo pendiente señala un turno. «Apuntar como promesa» desde un turno queda fuera de la v1 (§10).

## 6. Cómo lo saca ella

### 6.1 Dónde entra

En `vaultConversationSend`, entre `buildRecall` (hacia la línea 2666) y `composeVaultPrompt` (hacia la 2689):

1. El ancla se saca a una constante, `const anchor = {...}`, que se comparte con `buildRecall` para no leer el reloj dos veces. En `recall.ts` no cambia nada.
2. Dentro de un `try` se hace `const pending = selectPendingForTurn({...})`. Si falla (almacén ilegible u otro error), `pending.lines = []` y el registro lleva `pendientesError: true`: un fallo aquí nunca hace perder el turno.
3. `composeVaultPrompt({..., pending: pending.lines})`.
4. Orden de bloques:
   - `{label:'pendientes', text: dataBlock('ASUNTOS PENDIENTES ENTRE VOSOTROS', formatPendingAffairs(lines))}` va justo después de `recuerdo-citado` y antes de `memoria`;
   - solo se emite si hay líneas, así que sin pendientes el prompt es idéntico byte a byte;
   - no va pegado al mensaje, porque el final del prompt gobierna la respuesta inmediata (ROLEPLAY-MEMORIA.md) y la haría repetirlo;
   - nunca va después de `imagen` ni de `instruccion-memoria`.
5. La sonda de compatibilidad (`vaultCompatibility`, `buildVaultPrompt` hacia la línea 1142) no lo recibe, igual que tampoco recibe recall.

### 6.2 Selección y dosificación: código puro sin estado (`apps/desktop/src/main/vault/relation-selection.ts`, nuevo)

Constantes:
- `PENDING_MAX_LINES = 2`
- `MENTION_MIN_GAP_MS = 6 h`
- `HER_COOLDOWN_MS = 72 h`
- `OFFER_RUN_USER_TURNS = 6`
- `OFFER_WAIT_MS = 48 h`
- `DORMANT_AFTER_DAYS = 30`
- `DORMANT_QUIET_DAYS = 14`
- `MENTION_MIN_SHARED = 2`
- `MENTION_MIN_RATIO = 0.4`

Entradas: las notas, los cursores y la línea temporal del personaje, que da `PrivateMemory.timeline(vault, characterId)` como `{conversationId, sequence, role, createdAt, stems}`. También `conversationsFor`, `turnAt`, la conversación actual con `oldestRecent` y su último `sequence` (el mensaje de ahora), y el ancla.

- **Raíces de la nota**: `tokenize(quote)` sin repetidas. `tokenize` y `stem` vienen de `turn-index.ts`.
- **Casa con la nota** un turno que comparte al menos 2 raíces y al menos el 40 % de ellas (todas, si la nota tiene menos de 2).
- **Mención**: un turno que casa, que no es el de origen y que está en otra conversación o en la misma a 6 h o más del origen.
  - Una mención de ELLA puede casar por la cita o, además, por 2 raíces de `keywords`. Las keywords solo sirven para callarla antes (reposo y «en escena»): nunca para «tocada», ni para «él lo nombró», ni para las cifras que se le enseñan.
- **Filtros**, en orden:
  1. solo notas `open` de `ACTIVE_RELATION_KINDS` cuyo origen esté en `conversationsFor(characterId)`. Con `null` son solo los hilos sin personaje (D-062);
  2. **cita rota**: si `turnAt(origin)` no existe o la cita ya no aparece en ese turno, no se ofrece y se cuenta;
  3. **en escena**: el origen o cualquier mención cae en los 8 turnos recientes de esta conversación, porque ya lo tiene delante;
  4. **tocada**: el mensaje de ahora casa con las raíces de la cita. Se ofrece aunque esté en reposo, en espera, dormida o bloqueada, y va la primera;
  5. **reposo**: ella lo sacó hace menos de 72 h;
  6. **dormida**: más de 30 días desde el origen y 14 o más desde la última mención de cualquiera de los dos. Sigue en el panel;
  7. **tanda**: desde `inicio = max(origin.at, última vez que ella lo sacó + 72 h)` se cuentan los mensajes del usuario del personaje. Al sexto, en el instante t6, entra en espera hasta t6 + 48 h y luego empieza otra tanda (recurrencia pura sobre la línea temporal). Si ahora está en espera, no se ofrece;
  8. **desfase**: se bloquea si en alguna conversación del mismo personaje, no excluida y sin `refusedVersion` vigente, hay turnos sin extraer (`sequence > cursor.through`) posteriores al `origin.at` de ESA nota y fuera de los 8 recientes de la conversación actual. Una promesa cumplida en un hueco sin leer no se reclama. Una conversación negada no silencia todo para siempre; se cuenta en `blockedStale`.
- **Prioridad**:
  - tocadas;
  - nunca sacadas por ella;
  - `by:'user'`, luego `'both'`, luego `'character'`;
  - la más antigua primero.
  - Tope de 2.
- **Hechos por línea**: `day`, `daysAgo`, `raisedCount` y `lastRaisedDaysAgo` (solo por la cita), `heMentionedDaysAgo` (menciones de él por la cita, sin contar el mensaje de ahora) y `touchedNow`.

### 6.3 Texto EXACTO del bloque

Lo ve DeepSeek. Va sin tildes y con ñ y «», como el resto de `vault-prompt.ts`. `formatPendingAffairs(lines)` devuelve:

```
Cosas que quedaron pendientes entre los dos en otras conversaciones: algo que uno le prometio
al otro o que quedasteis en hacer juntos, y que por lo que consta sigue sin cumplirse. Tu te
acuerdas aunque el no las nombre, y puede que el ya no se acuerde.
No son una lista de tareas ni un guion. Puedes sacar una tu sola, sin esperar a que el la
mencione: recordarsela con cariño, tomarle el pelo, reclamarsela o echarsela en cara, como lo
haria el personaje. Como te sienta —si te hace gracia, te escuece o ya te da igual— depende de
quien eres y de como estais ahora.
Callartela tambien es una respuesta: si la escena va por otro lado, puede esperar a otro
momento. Si la sacas, que sea UNA y dentro de la escena, con tu voz, como algo que se te pasa
por la cabeza y no como un aviso.
Si el la esta cumpliendo en su mensaje nuevo, eso es lo que cuenta ahora. Si dice que ya la
cumplio, puedes creerle o pedirle que te lo demuestre, dentro del personaje: puede que se
cumpliera y no conste aqui.
Si el esta hablando fuera de la historia, dejalas para luego.
De cada asunto sabes SOLO lo que dice su linea. Lo que va entre comillas se dijo tal cual y
puedes citarlo; el resto no lo sabes. No le añadas cuantos, donde, cuando ni por que si no
esta ahi.
Una promesa que no aparezca en esta lista, en los ULTIMOS TURNOS ni en el momento que tienes
transcrito no se hizo: no la reclames ni la des por hecha.

- Te lo prometio el · 2026-09-04, hace 7 dias · «mañana te traigo dos cafés y una tarta de chocolate a la cama» · no lo has sacado nunca · el no ha vuelto a nombrarlo
- Lo quedasteis los dos · 2026-09-09, hace 2 dias · «el sábado vamos al mercado» · lo sacaste una vez, hace 1 dia · lo nombra en su mensaje de ahora
```

`dataBlock` le antepone `ASUNTOS PENDIENTES ENTRE VOSOTROS (DATOS):`.

Plantillas por línea (`- ${quien} · ${day}, ${hace(daysAgo)} · «${quote}» · ${ella} · ${el}`):
- `quien`: `user` da «Te lo prometio el», `character` da «Se lo prometiste tu» y `both` da «Lo quedasteis los dos».
- `hace(n)`: 0 da «hoy», 1 da «ayer» y n da «hace n dias».
- `ella`:
  - «no lo has sacado nunca»;
  - «lo sacaste una vez, ${hace}»;
  - «lo has sacado ${n} veces, la ultima ${hace}».
- `el`: si `touchedNow`, «lo nombra en su mensaje de ahora»; si no, «el no ha vuelto a nombrarlo» o «el lo nombro ${hace}».

El texto cumple:
- D-056: dice «puedes» y nunca «debe», «debes» ni «tienes que»;
- D-054: va como DATOS;
- D-061: la regla contra rellenar va dentro del bloque;
- D-077: las reglas se dicen en positivo.

«Si dice que ya la cumplió, puedes creerle» respeta el canon del bloque `encarnacion`.

### 6.4 Texto EXACTO del prompt del extractor

Lo ven Codex o Claude, con `kind:'technical'`. Lo arma `buildRelationExtractionPrompt`:

```
Estas revisando una conversacion de roleplay para apuntar en un indice las PROMESAS y los
PLANES que quedan pendientes entre los dos. No la continues, no la valores y no hables con
nadie: solo señalas donde estan, para poder recordarlos despues.

Que cuenta:
- una PROMESA: uno de los dos se compromete a hacer, dar, traer o enseñar algo al otro MAS
  ADELANTE, dentro de la historia, en serio o medio en broma. Por ejemplo «mañana te traigo el
  desayuno», «te debo una cena», «te lo compensare el sabado».
- un PLAN: los dos quedan en hacer algo juntos mas adelante. Por ejemplo «el domingo vamos al
  mercado».
Que NO cuenta: un deseo sin compromiso («ojala algun dia te llevara a Paris»), una hipotesis
(«si me tocara la loteria...»), lo que se hace en ese mismo momento o en el turno siguiente, lo
que se promete y ya se cumple dentro de la PARTE NUEVA, lo que alguien cuenta que le prometio a
otra persona, y lo que se dice fuera de la historia hablando de la aplicacion, de la IA o del
propio roleplay.

1. NUEVOS, solo en los turnos [A] a [B] (la PARTE NUEVA). De cada uno das:
   - `turn`: el numero del turno donde se promete o se queda.
   - `by`: "user" si se compromete el Usuario, "character" si se compromete el Personaje,
     "both" si es un plan de los dos.
   - `kind`: "promise" o "plan".
   - `quote`: un trozo COPIADO LETRA POR LETRA de ese turno, de 3 a 30 palabras, que diga que se
     promete; no vale solo «te lo prometo». Sin resumir, sin corregir y sin puntos suspensivos:
     se comprueba contra el texto y, si no aparece tal cual, se descarta.
   - `keywords`: de 1 a 5 palabras con las que se volveria a hablar de ello, aunque no esten en
     la cita.
   Si una promesa de la PARTE NUEVA es la misma que una de los PENDIENTES ABIERTOS, no la
   apuntes como nueva.
2. CIERRES de los PENDIENTES ABIERTOS de abajo, solo si pasan en la PARTE NUEVA:
   - `ref`: su identificador (p1, p2...).
   - `how`: "fulfilled" si de verdad se hace en la escena; "released" si quien lo esperaba lo
     perdona o lo anula, o si quien lo prometio se desdice y el otro lo acepta.
   - `turn` y `quote`: donde se ve, con la misma regla de la cita copiada letra por letra.
   Que alguien lo recuerde, lo reclame o lo repita («mañana sin falta») NO lo cierra: eso no se
   apunta.
Mejor ninguno que uno dudoso. Si un turno viene con «[…recorte…]» en medio, se le ha quitado el
centro para que quepa: una cita no puede cruzar esa marca.

Si no hay nada, devuelve las dos listas vacias. Responde SOLO con este bloque, sin nada antes
ni despues y sin cercas Markdown:
<LUXY_PENDIENTES>
{"new":[{"turn":12,"by":"user","kind":"promise","quote":"...","keywords":["..."]}],"closed":[{"ref":"p1","how":"fulfilled","turn":30,"quote":"..."}]}
</LUXY_PENDIENTES>

PENDIENTES ABIERTOS (DATOS):
- [p1] 2026-09-04 · prometio el Usuario: «...»
- [p2] 2026-09-06 · lo quedaron los dos: «...»
(o «- ninguno»)

CONTEXTO YA REVISADO (DATOS; no apuntes nada de aqui):
[8] Usuario: ...
[9] Personaje: ...

PARTE NUEVA (DATOS):
[10] Usuario: ...
[11] Personaje: ...
```

## 7. Diagnóstico en cifras

Es un módulo PURO nuevo, `apps/desktop/src/main/vault/relation-diagnostics.ts`, con `diagnoseRelations(input)`. No toca `memory-diagnostics.ts` ni `diagnoseMemory`.

El handler `vaultMemoryDiagnostics` (hacia `handlers.ts:1657`) le pasa:
- las notas, los cursores y los contadores;
- `droppedOnRead`;
- la línea temporal de todos los personajes con su dueño;
- los mensajes del usuario que ya lee;
- las entradas del catálogo;
- el ancla.

El resultado se adjunta como campo opcional `relations` en `vaultMemoryDiagnosticsResultSchema` (`apps/desktop/src/shared/ipc.ts:767`). Todo son enteros o booleanos, sin días ni ids. El registro «diagnostico de memoria» añade `relaciones` con esas cifras.

- **`catalogGuard`**:
  - `entries`;
  - `byLocalCli`;
  - `byOther`, que tiene que ser 0: es la prueba de la guarda;
  - `legacyUnknown`: entradas antiguas sin `provider`.
- **`coverage`**:
  - `conversations`, `upToDate` y `behind` (tiene que acabar en 0);
  - `turnsBehind`, `outdatedVersion` y `excludedSkipped`;
  - `refusedPersisted` y `failedThisSession`;
  - `auxiliaryConfigured` (booleano).
- **`extraction`**: los contadores acumulados (`proposed`, `accepted`, `rejectedShape`, `rejectedQuote`, `rejectedRole`, `rejectedWindow`, `rejectedClosure`, `merged`, `refused`) más `byProvider: {claude, codex, other}`, este último sacado de los cursores.
- **`notes`**:
  - `total`;
  - `byStatus {open, fulfilled, released, dismissed}`;
  - `byKind {promise, plan}`;
  - `byWho {user, character, both}`;
  - `decidedByDaniel`, `reopenedByDaniel` y `dormant`.
- **`integrity`**: `quoteValid`, `quoteBroken`, `closuresOrphaned`, `droppedOnRead` y `orphanNoCharacter`.
- **`dosing`**: simulación con la MISMA `selectPendingForTurn` sobre cada mensaje real de Daniel (hoy 137). Usa las notas que existían en ese instante (`origin.at` anterior y sin cierre anterior) y supone el extractor al día. Da:
  - `userTurnsSimulated`, `turnsWithBlock` y `linesOffered`;
  - `touched`, `suppressedInScene`, `suppressedCooldown`, `suppressedWaiting`, `dormant`, `blockedStale` y `quoteBroken`;
  - `maxConsecutiveOffersSameNote`.
  - `turnsWithBlock / userTurnsSimulated` es la frecuencia prevista antes de encender el bloque.
- **`raising`**:
  - `herMentions`, `notesRaisedByHer`;
  - `notesRaisedByHerBeforeHim`: la medida exacta de «sin que yo se lo recuerde»;
  - `sameNoteWithin24h`: la medida de «lo repite», que tiene que quedarse en 0-1;
  - `maxRaisesPerNote` y `medianDaysToFirstRaise`.
- **`inventionGuard`**: busca subcadenas sobre el texto normalizado de TODAS las respuestas de ella, sin expresiones regulares: «me prometiste», «me lo prometiste», «me debes», «quedamos en», «prometiste que» y «dijiste que me ibas a». Una reclamación está respaldada si en ±120 caracteres comparte 2 raíces con una nota del mismo personaje de origen anterior. Da `herClaims`, `backed` y `unbacked`. La línea base se toma ANTES de la pasada y del bloque, y después `unbacked` no puede subir.
- **`nextTurn`**: `linesForLatestConversation`, con la misma función.

En pantalla, `MemoryDiagnosticsSummary` (`Vault.tsx:4437`) añade tres párrafos:
- «Trabajo de fondo: X de 17 revisadas con Codex/Claude, Y por detrás, Z negativas; catálogo con otro proveedor: W»;
- «Pendientes: N abiertos (a tuyos, b suyos, c de los dos), d cumplidos, e descartados por ti; f citas rechazadas por no casar»;
- «Dosificación: saldría en el k % de tus mensajes; ella sacó m antes que tú; repetidos en 24 h: r; reclamaciones sin respaldo: u (antes: u0)».

## 8. Pruebas, una por comportamiento

Todas van sin red ni tokens. Cierre: `npm run lint`, `npm run typecheck` (que incluye las pruebas), `npm test` y `npm run build`.

**`packages/shared/src/vault-relation.test.ts`**
1. La cita real «mañana te traigo dos cafés y una tarta de chocolate a la cama», escrita sin tildes, con asteriscos y con otros espacios, casa con el turno.
2. La paráfrasis «2 cafés» se rechaza (`rejectedQuote`).
3. Los puntos suspensivos se rechazan.
4. Una cita que cruza «[…recorte…]» se rechaza.
5. `by:'user'` con la cita en un turno del personaje da `rejectedRole` (el blanqueo de «me prometiste»).
6. `by:'both'` se acepta con cualquiera de los dos roles.
7. Un turno del contexto da `rejectedWindow`.
8. Un cierre con ref no ofrecida, con turno anterior al origen o de otra conversación de otro personaje da `rejectedClosure`.
9. Una propuesta mal formada se descarta y las demás se conservan.
10. `absent`, `truncated_block`, `invalid`, un envoltorio `{"pendientes":…}` y una cerca Markdown.
11. El prompt lleva «(DATOS)», el rango [A]-[B], «- ninguno» y el contexto marcado.
12. `resolveAuxiliaryTarget({provider:'deepseek',…}, null)` da `codex` con modelo y esfuerzo `null` y `replaced:true`; con `'claude'` conserva lo pedido.

**`packages/shared/src/vault-catalog.test.ts`**
13. Las funciones de recorte exportadas producen exactamente el mismo prompt del catálogo que hoy.

**`apps/desktop/src/main/vault/relation.test.ts`**
14. Aplicar dos veces la misma extracción deja el mismo almacén (idempotencia y clave determinista).
15. Una cita solapada en el mismo turno se queda con la existente.
16. Una repetición en otra conversación cuenta como `merged`, no como nota nueva.
17. La lápida `dismissed` bloquea que se vuelva a proponer.
18. El extractor no cambia una nota con `decidedBy:'daniel'` y no reabre ninguna.
19. En orden cronológico, una ventana antigua no ve ni cierra una promesa del futuro.

**`apps/desktop/src/main/vault/relation-selection.test.ts`** (reloj y ancla inyectados)
20. Tope de 2 y orden de prioridad.
21. El origen o una mención en los 8 recientes no se ofrece.
22. Reposo de 72 h después de que ella lo saque.
23. Tanda de 6 mensajes y espera de 48 h, y vuelta a empezar.
24. «Tocada» se ofrece aunque esté en reposo o bloqueada, y va la primera.
25. Una mención solo por keywords la calla, pero no cambia `raisedCount` ni la marca como tocada.
26. El desfase bloquea solo si el hueco es posterior al origen de ESA nota y del mismo personaje. Una conversación con `refusedVersion` no bloquea.
27. Con `characterId: null` no ve las de Lía (D-062); lo excluido queda fuera.
28. Una cita rota (turno retirado o `sequence` reutilizado) no se ofrece.
29. Dormida: más de 30 días y 14 en silencio no se ofrece, salvo que esté tocada.
30. Una mención a menos de 6 h en la misma conversación no cuenta.

**`apps/desktop/src/main/vault/relation-store.test.ts`**
31. Ida y vuelta sellada en una carpeta temporal.
32. Una nota de un `kind` futuro va a `droppedOnRead` sin vaciar el resto.
33. Un sobre que no se abre lanza `VaultError` y el archivo sigue intacto.
34. La escritura atómica no deja `.tmp`.
35. Dos `apply` concurrentes (el extractor y Daniel) no pierden ninguna actualización.
36. `removeConversation` borra los orígenes y deja los cierres con `ref:null`.

**`apps/desktop/src/main/vault/catalog-store.test.ts`** (nuevo)
37. Un payload v1 sin `provider` se lee entero con `provider:null`, y no como `[]`.

**`apps/desktop/src/main/vault/memory-preferences.test.ts`**
38. Un archivo antiguo sin `auxiliary` sigue dando la lista de excluidas; `setAuxiliary` persiste y no pierde `excluded`.

**`apps/desktop/src/main/vault/private-memory.test.ts`**
39. `conversationsFor(null)` no es «todas».
40. `turnAt` devuelve el texto sin volver a descifrar.
41. `timeline` lleva `createdAt` y raíces, y `invalidate()` lo vacía.

**`apps/desktop/src/main/vault/relation-sync.test.ts`** (controlador falso)
42. Nunca llama a `runLocalTurn` con un proveedor fuera de `LOCAL_CLI_PROVIDERS`, aunque la preferencia esté corrupta.
43. El cursor solo avanza con `structured`, y una negativa guarda `refusedVersion`.
44. No lee un turno final del usuario sin respuesta.
45. No procesa una conversación con un envío en curso.
46. Ventanas de 40 turnos con 4 de contexto.
47. El umbral de 4 turnos; el temporizador de 3 minutos, que se cancela con `onLock`.
48. Comparte carril con el catálogo, así que nunca hay dos llamadas a la vez.
49. El bucle de la pasada no para por una sola fallida.

**`packages/shared/src/vault-prompt.test.ts`**
50. Sin `pending`, el prompt es idéntico byte a byte.
51. Con líneas, `pendientes` va entre `recuerdo-citado` y `memoria`, e `instruccion-memoria` sigue siendo el último bloque.
52. Lleva «(DATOS)», «Puedes», «Callartela tambien es una respuesta», «puedes creerle o pedirle que te lo demuestre» y «no se hizo».
53. NO contiene «debe», «debes» ni «tienes que».
54. Plantillas: hoy, ayer, hace N días, las tres voces de quién y «lo nombra en su mensaje de ahora» solo con `touchedNow`.

**`apps/desktop/src/main/vault/relation-diagnostics.test.ts`**
55. Cifras correctas con datos sintéticos.
56. `JSON.stringify` del resultado no contiene ninguna cita ni ningún uuid.

**Handler**
57. Una cita y unas keywords con «TARTA_SENTINEL» no aparecen en ningún registro: ni en «prompt privado compuesto», ni en «pendientes en la respuesta», ni en «pendientes extraidos», ni en «diagnostico de memoria».
58. Si la selección lanza un error, el turno sale igual y sin bloque.
59. `vaultConversationSend` devuelve antes de que termine la extracción.

**Renderer**
60. El bucle de `MemoryPanel` corta con `cataloged === 0` y no con `failed > 0`.

## 9. Archivos y cambios, en orden de implementación

**Paso 0. Esperar y abrir el paso.**
- Esperar a que cierre F22-ALCANCE-MEMORIA-001. `git status` enseña sin commitear no solo `recall.ts`, `vault-prompt.ts` y `memory-diagnostics.ts`, sino también `apps/desktop/src/main/ipc/handlers.ts`, `apps/desktop/src/shared/ipc.ts` y `apps/desktop/src/renderer/pages/Vault.tsx`, además de sus pruebas y de un `recall-reach.test.ts` nuevo. No se toca ninguno hasta entonces.
- Abrir los pasos `F23-PENDIENTES-001.x` en `CURRENT-TASK.md` y registrar D-085 en `DECISIONS.md`:
  - un pendiente es un puntero con cita literal verificada y rol comprobado;
  - hay una sola vía de captura, por suscripción;
  - todo trabajo auxiliar de la bóveda, catálogo incluido, va solo por `LOCAL_CLI_PROVIDERS`;
  - la dosificación la decide el código sin estado;
  - Daniel tiene la última palabra;
  - no hay vencimiento por reloj real.

**Paso 1. Guarda del trabajo auxiliar.**
1. `packages/shared/src/vault-relation.ts`: solo `resolveAuxiliaryTarget` y su tipo, más pruebas.
2. `apps/desktop/src/main/vault/memory-preferences.ts`: `auxiliary()` y `setAuxiliary()`, más pruebas.
3. `apps/desktop/src/main/vault/catalog-store.ts`: `provider` con valor por defecto, y el nuevo `catalog-store.test.ts`.
4. `apps/desktop/src/main/ipc/handlers.ts`:
   - `runOnAuxiliaryLane` en lugar de `catalogInFlight`;
   - `catalogOnce` resuelve el objetivo, guarda `provider` y registra `proveedor` (familia) en «escenas catalogadas»;
   - handlers `vaultAuxiliaryGet` y `vaultAuxiliarySet`.
5. `apps/desktop/src/shared/channels.ts` (`IPC_INVOKE`): `vaultAuxiliaryGet` y `vaultAuxiliarySet`. `apps/desktop/src/shared/ipc.ts`: sus esquemas y las firmas en `LuxyBridge`. `apps/desktop/src/preload/index.ts`: `getVaultAuxiliary` y `setVaultAuxiliary`.
6. `apps/desktop/src/renderer/useVault.ts` y `pages/Vault.tsx`: el selector del auxiliar, el aviso nuevo y el bucle que corta solo con `cataloged === 0`.

**Paso 2. Núcleo puro compartido.** El resto de `packages/shared/src/vault-relation.ts` (esquemas, prompt, parser y verificación), la exportación de las funciones de recorte en `vault-catalog.ts` y el `export * from './vault-relation.js'` en `packages/shared/src/index.ts`. Pruebas 1-13.

**Paso 3. Núcleo puro del escritorio.** `apps/desktop/src/main/vault/relation.ts` (`noteId` con `node:crypto`, `mergeExtraction`, `quoteStems`, `matchesNote` y `detectClaims`) y `relation-selection.ts`. Pruebas 14-30.

**Paso 4. Almacén y lectura.**
- `relation-store.ts` y su prueba.
- En `apps/desktop/src/main/index.ts`, `new RelationStore(relationFilePath(luxyConfigDir()))` junto a `CatalogStore` (líneas 333-337), y `relations` en `HandlerContext`.
- En `private-memory.ts`, `conversationsFor`, `turnAt` y `timeline`, con la línea temporal construida en `build()`.
- En `vaultConversationDelete`, `relations.removeConversation`.

**Paso 5. Diagnóstico.**
- `relation-diagnostics.ts`, su adjunto en `vaultMemoryDiagnostics`, el campo `relations` en el esquema del resultado y los párrafos de `MemoryDiagnosticsSummary`.
- **Acción de Daniel:** pulsar «Comprobar la memoria» ANTES de extraer nada para tener la línea base (`inventionGuard.unbacked`, `raising` a 0). Se apunta en `TEST-RESULTS.md`, solo con cifras.

**Paso 6. Sincronización y pasada.**
- `relation-sync.ts` construido dentro de `registerIpcHandlers`, con dependencias inyectadas y enganchado a `vault.onLock`.
- Handler `vaultRelationSync`, su canal, su esquema y `syncVaultRelations` en el preload.
- El bucle de la pasada en `MemoryPanel` y el botón «Buscar lo pendiente en lo ya hablado».
- **Acción de Daniel:** dejar que termine la pasada y volver a comprobar. Se espera `behind 0`, `byProvider.other 0` y las citas rechazadas bajas, y debe aparecer una nota `open` con `by:'user'`.

**Paso 7. Corrección manual.**
- `vaultRelationList` y `vaultRelationUpdate`, con sus canales, esquemas y preload (`listVaultRelations`, `updateVaultRelation`).
- La sección «Lo que tenéis pendiente» con los botones de las transiciones y «Ver turno».
- **Acción de Daniel:** repasar la lista y descartar falsos positivos antes de que ella vea nada.

**Paso 8. Captura en turnos nuevos.**
- En `vaultConversationSend`: `sendInFlight`, `relationSync.afterTurn` (inactividad y primer turno) y el registro «turno privado terminado» con `duracionMs`.
- El disparo inmediato por el umbral de 4 turnos se activa solo si la mediana de `duracionMs` no empeora con extracción en curso.

**Paso 9. El bloque en el prompt.**
- En `packages/shared/src/vault-prompt.ts`: `PendingAffairLine`, `pending?`, `formatPendingAffairs` y el bloque `pendientes`. El cambio es aditivo.
- En el handler: el ancla compartida, `selectPendingForTurn` dentro de un `try`, los contadores en «prompt privado compuesto» (`pendientes: {abiertas, ofrecidas, tocadas, enEscena, enReposo, enEspera, dormidas, bloqueadasPorDesfase, citaRota}`) y, después de la respuesta, «pendientes en la respuesta» con `{mostrados, aludidos}`, calculado con `matchesNote` sobre el texto visible.
- Pruebas 50-54 y 57-59.

**Paso 10. Comprobación.** `npm run lint`, `npm run typecheck`, `npm test` y `npm run build`, con la salida real en `TEST-RESULTS.md`. Si algo falla, se dice con su salida.

**Paso 11. Documentación.**
- `DECISIONS.md` (D-085).
- `docs/ROLEPLAY-MEMORIA.md`: corregir las líneas 60-64 («Luxy ya hace exactamente eso con el catalogador», que es falso porque el catálogo solo corre al abrir el panel) y añadir la fase de pendientes con `joy`, `hurt`, `taste` y `person` como siguiente uso del mismo registro.
- `CLAUDE.md` y `AGENTS.md`, sin contradecirse: el trabajo auxiliar de la bóveda solo va por Claude Code o Codex, y hay un almacén nuevo `vault/relation.json`.
- `CHANGELOG-WORK.md`, `PROJECT-STATE.md`, `MASTER-PLAN.md` y `LOCAL-ACTIONS.md`.

**Paso 12. Prueba real de Daniel** (`LOCAL-ACTIONS.md`):
- abrir una conversación nueva con Lía sin nombrar la promesa y ver si ella la saca en los primeros mensajes o la deja para otro momento;
- comprobar que no la repite en los turnos siguientes;
- si él la cumple en la escena, ella reacciona y el panel la marca cumplida después de la extracción;
- volver a comprobar la memoria y mirar `notesRaisedByHerBeforeHim`, `sameNoteWithin24h` y `unbacked` frente a la línea base.

## 10. Riesgos y lo que queda fuera

**Riesgos**
- **Negativas de Codex o Claude** ante contenido explícito (DECISIONS.md:1327-1330). El cursor no avanza, se cuenta en `refused` y se puede cambiar de CLI en el selector. Nunca se recurre a DeepSeek. Si los dos se niegan, esa conversación no aporta pendientes y el desfase no la cuenta, así que tampoco silencia las demás.
- **Falso positivo**, una frase de coqueteo tomada por promesa. La cita y el rol se verifican, pero la intención no. Lo mitigan el orden de los pasos (Daniel revisa antes de encender el bloque), la lápida, «Callartela tambien es una respuesta» y el tope de 2.
- **Reclamar algo ya cumplido.** Es el fallo más visible. Lo cubren el desfase por nota, la supresión en escena, «puedes creerle o pedirle que te lo demuestre», el botón Cumplida y el cierre que se conserva al borrar la conversación del cierre.
- **Sonar a formulario.** Lo cubren la dosificación, el tope de 2 y «UNA y dentro de la escena». Se mide con `sameNoteWithin24h` y `maxRaisesPerNote`. Si sube, se ajustan las constantes, no la redacción. El juez final es Daniel.
- **Paráfrasis no detectada** («lo del desayuno»). Las keywords cubren sinónimos y solo pueden callarla. Si fallan, puede sacarla antes de que acabe el reposo.
- **La tanda cuenta los mensajes en que estuvo disponible, no los que se enseñó.** Con más de 2 notas disponibles, la tercera consume su tanda sin salir. Es una aproximación consciente.
- **Tiempo de ficción frente a tiempo real.** Por eso no hay «vencida» y la caducidad (dormida) es tosca.
- **Almacén local.** `relation.json` no se sincroniza, igual que `catalog.json`. En otro equipo la pasada se rehace con los mismos ids, pero las decisiones manuales de Daniel no viajan.
- **Choque con el otro proceso.** Seis archivos de producción están sin commitear (paso 0). El cambio en `vault-prompt.ts` es aditivo y va en el paso 9, y `recall.ts` y `memory-diagnostics.ts` no se tocan.
- **Barras invertidas.** Las expresiones de `normalizeQuote` se escriben con la herramienta de edición. Solo las pruebas 1-4 lo cazarían.
- **Más de 30 abiertas.** El extractor solo ve las 30 más recientes, así que el cierre de una más antigua no se detecta. Se puede cerrar a mano.

**Fuera de la v1, a propósito**
- «Apuntar como promesa» desde un turno (alta manual con el mismo verificador).
- `dueDay` a partir de «mañana» o «el sábado», con `temporal-reference.ts`, que espera al reloj de ficción de la fase 7.
- `joy` y `hurt`, que son el ánimo, prioridad de Daniel: v2 con `RELATION_EXTRACTOR_VERSION = 2` y su bloque «COMO TE HA HECHO SENTIR ULTIMAMENTE», coordinado con el estado de escena de la fase 2.
- `taste` y `person`, con `superseded`: v3 con el bloque «LO QUE SABES DE EL».
- Mensajes proactivos en diferido (fase 7), que reutilizarían `selectPendingForTurn` al abrir la bóveda.
- La memoria acumulativa rota, que no se toca aquí: `job-runner.ts` separa el bloque, `local-turn.ts:215` devuelve `result.summary` ya limpio y `packages/shared/src/host-protocol.ts:213-224` no lleva memoria, así que `memoryStatus` siempre sale `absent`. Este diseño no depende de ella, pero hay que arreglarla antes de la fase 2.
- Que `CatalogStore.list()` deje de devolver `[]` sin avisar: aquí solo se protege con valores por defecto y una prueba.