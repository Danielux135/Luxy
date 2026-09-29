# Enganchar una conversación a un personaje: plan de implementación

Fecha: 2026-09-25. Autor: Claude. Estado: **plan; la parte de este equipo,
construida con cambios (nota de abajo); la del servidor, sin implementar**. Nada
del servidor está escrito, probado ni desplegado.

> **Nota del 2026-09-25 (tarde): la parte de ESTE equipo está construida**
> (`F33-ENGANCHE-LOCAL-001`, `F33-RECUERDO-001`, decisiones `D-103` y `D-105`).
> Sin servidor, sin migración y sin sincronización. Lo que cambia respecto a
> este plan:
>
> - **§3.2 y §5.1**: el almacén local NO sella evento a evento con la subclave de
>   la conversación ni rellena a tamaño fijo. Guarda `{event, uploadedAt: null}`
>   dentro de un archivo sellado entero con `identity|conversation-owners`
>   (`vault/conversation-owners.json`). `event` es ya la carga v1 definitiva
>   (`conversationOwnerEventSchema`, en `packages/shared/src/vault-owner.ts`, no en
>   `vault-payloads.ts`), sin `deviceLabel` ni `pad`: el relleno y el propósito
>   del sobre son del servidor. Subir será sellar cada `event` y marcar
>   `uploadedAt`.
> - **§4.1**: la regla es «último no nulo por posición», pero **no igual para los
>   tres campos**: el dueño es el del último hecho que lo fija; la ficha cuenta
>   solo desde la posición de ese hecho y, si ganó un TURNO sin ficha, hereda la
>   última sellada con ese mismo dueño o sin ninguno, nunca la de otro personaje
>   (`inheritedDescription`, revisión del 28/09); las instrucciones, sin límite de
>   posición. Desde la segunda ronda del 28/09, además, main sella la ficha
>   actual de la bóveda con el turno cuando cambia, así que una ficha editada
>   gana por posición (`D-103`). Y el ANCLA DE UN EVENTO NUEVO HEREDA LA MAYOR DE
>   LOS EVENTOS CONOCIDOS (`nextOwnerEventPosition`). Es el arreglo de la refutación
>   de sincronización n.º 1: un evento que sustituye a otro le gana siempre. No
>   hay `legacyCharacterId`, `timeline`, `heads`, `conflict` ni `missing`: en un
>   equipo no hacen falta y quedan para la fase del servidor.
> - **§4.2**: `owner()` descifra la conversación entera; `list()` para antes.
>   Los lectores `latest*` de personaje e instrucciones se borraron sin
>   envoltorios.
> - **§6.3**: un cursor sin `owner` vale solo si la conversación no tiene
>   eventos (refutación de producción n.º 5), en vez de compararse con
>   `legacyCharacterId`.
> - **§7**: «Soltar» solo deshace un enganche propio; no se puede soltar ni
>   cambiar una conversación que nació con personaje. Las respuestas se firman
>   por posición y hay un solo separador, el del enganche en vigor. *(Sustituido
>   por `D-108`, punto 3: en una enganchada se firman todas salvo las escritas
>   con otro personaje, y con dueño por turno como en `a45953b`.)*
> - **§8 (R1)**: va detrás de la casilla `recentMemories` del personaje, apagada
>   por defecto, con 240/400/800 caracteres (160/400/800 desde la segunda
>   revisión del 28/09, con la primera frase y las últimas del resumen), la ficha
>   retroactiva solo si está
>   APROBADA y la guía de campos detrás de la misma casilla. M1 y M2 no se
>   construyeron. *(Los topes y el corte por frases los sustituye `D-105`,
>   quinta ronda: viaja la memoria entera sin `plan` ni `openQuestions`, con una
>   salvaguarda de 6.000 caracteres por conversación.)*
>
> Lo de §3.3, §3.4, §5.2, §5.3, §6.4, §6.5 (salvo lo dicho), §6.6 y las fases C y
> H sigue sin construir.

Este documento es el plan que un implementador sigue paso a paso sin volver a
investigar. Reúne las cuatro investigaciones del flujo `wf_92cec875-c48`
(servidor, cliente y cifrado, precedencia del dueño, despliegue y pantalla), el
diseño anterior «con el próximo mensaje» y sus dos refutaciones. Donde las
investigaciones proponían cosas distintas, aquí se elige una y se dice por qué.

Las líneas de `handlers.ts`, `Vault.tsx` y `useVault.ts` se citan a fecha de
25/09. Otro flujo edita esos archivos ahora mismo, así que se moverán: el
implementador busca por el nombre de la función o del manejador que se cita al
lado.

---

## 0. Lo que ha decidido Daniel y lo que significa

| Decisión | Consecuencia en el diseño |
| --- | --- |
| El enganche es **inmediato** al pulsar y llega a **los dos ordenadores** | Un registro nuevo, cifrado, en una tabla nueva del servidor (opción c1). Migración `0009` y despliegue del Worker, los dos con su autorización expresa. |
| **R1**: resumen de las **2** últimas conversaciones del personaje en cada mensaje | Bloque nuevo en el prompt, de unos 800 caracteres más cabeceras, sin llamadas nuevas. |
| El **cuaderno** de la relación, después | No se diseña. El protocolo de eventos se puede reutilizar en una tabla hermana (§12). |
| **Aviso** «¿Es de Lía?» con «No, esta no» | Módulo puro en el renderer, sin IPC ni registro. |

Tres límites de partida, que la pantalla tiene que decir tal cual (`D-093`):

- «Llega a los dos ordenadores» significa que **queda en el servidor al pulsar**
  y que el otro equipo lo recibe **cuando sincroniza**. Hoy la sincronización es
  manual: su único disparador es el botón de `Vault.tsx` (hacia la línea 4239).
- Enganchar cambia **de quién** es la conversación. No hace que el personaje la
  recuerde entera desde otras conversaciones. Eso lo acerca R1 y lo cumpliría el
  cuaderno.
- Los personajes **no se sincronizan** (`character-store.ts:14-15`). Si Lía no
  tiene el mismo `characterId` en los dos equipos, en el otro se verá como «Lía ·
  no está en este equipo» (§7.4). Es una pregunta abierta a Daniel (§11).

---

## 1. El diseño en una página

1. **Un evento de conversación**, inmutable y cifrado, por cada enganche o cada
   «soltar». Tiene un id aleatorio (`eventId`) y **no ocupa secuencia de turno**:
   no toca `vault_records`, ni `turn_count`, ni el sobre v1 del turno, ni el
   recuento del catálogo.
2. **Cifrado como un turno.** Se usa la subclave `conversation` de esa
   conversación y un propósito propio, `vault.conversation.event`. Los ids van
   repetidos dentro y se comprueban al abrir. Todo evento se rellena al **mismo
   tamaño**, de modo que el servidor no distingue enganchar de soltar.
3. **Tabla aparte** `vault_conversation_events`, de solo anexar: sin `UPDATE`,
   con RLS forzado y sin permisos a `anon` ni a `authenticated`. Rutas nuevas:
   `GET` y `POST /api/vault/events`.
4. **El orden va dentro del sobre, no en relojes.** Gana la mayor posición
   `(anchorSequence, 1, generation, eventId)` frente a la de los turnos que
   sellaron personaje, `(sequence, 0, 0, '')`. Los dos equipos, con los mismos
   registros, calculan lo mismo, y el servidor no puede reordenar nada.
5. **Una sola función del dueño**, `resolveConversationOwner`, pura, en
   `packages/shared`. Un único punto de E/S, `PrivateConversationStore.owner()`,
   sustituye a `characterOf`, `latestCharacterId`, `latestCharacterDescription`
   y, para estos fines, a `latestInstructions`.
6. **El cursor de pendientes guarda con qué dueño se revisó.** Si no coincide
   con el actual, deja de valer. Con eso no hay «reinicio» que se pueda perder
   en una carrera, y el otro equipo se cura solo al bajar el evento.
7. **Studio nuevo contra un gateway viejo**: el enganche vale al instante en este
   equipo, se guarda en local como «falta subir» y sube en cuanto el servidor
   tenga las rutas. La sincronización de turnos no falla por eso.

---

## 2. Qué ve el servidor

Lo que **ya veía**: que existe la conversación (su id), a qué cuenta pertenece,
cuándo se tocó y cuántos turnos tiene.

Lo que **ve de nuevo**, y hay que decírselo a Daniel:

- que esa conversación tiene N eventos y a qué hora llegó cada uno (hora del
  servidor);
- un id opaco por evento;
- un tamaño **constante** por evento.

Lo que **no ve**: si es enganchar o soltar, a qué personaje, su nombre, su
ficha, sus instrucciones, el equipo que lo hizo, ni el orden entre eventos.
Todo eso va dentro del texto cifrado.

Un registro inmediato y sincronizado delata por fuerza su momento. Es inherente
a la opción que eligió Daniel.

---

## 3. El evento

### 3.1 Carga sellada (`packages/shared/src/vault-payloads.ts`)

```ts
export const CONVERSATION_EVENT_KINDS = ['owner'] as const;

export const vaultConversationEventPayloadSchema = z.object({
  v: z.literal(1),
  // abre la puerta a otros tipos (p. ej. un olvido global de memoria, D-099)
  kind: z.enum(CONVERSATION_EVENT_KINDS),
  // copias de la fila exterior: se comparan al abrir
  eventId: z.string().uuid(),
  conversationId: z.string().uuid(),
  // ultima secuencia de turno que tenia ESTE equipo al crear el evento; -1 si ninguna
  anchorSequence: z.number().int().min(-1),
  // 1 + la mayor generation conocida en esa conversacion
  generation: z.number().int().min(1),
  // cabezas que el autor tenia delante: detecta cambios concurrentes
  supersedes: z.array(z.string().uuid()).max(16),
  // null = soltar
  characterId: z.string().min(1).max(128).nullable(),
  // copias para el equipo que no tenga el personaje (no se sincronizan)
  characterLabel: z.string().max(100).nullable(),
  characterDescription: z.string().max(2000).nullable(),
  // null = no toca las instrucciones; '' = las quita; texto = las pone
  instructions: z.string().max(8000).nullable(),
  // solo para mostrar en un conflicto; nunca sale del sobre
  deviceLabel: z.string().max(64).nullable(),
  createdAt: z.string().datetime(),
  pad: z.string(),
}).strict();

// para leer eventos de una version futura sin fallar: solo {v, kind}
export const vaultConversationEventHeadSchema = z.object({
  v: z.number().int(), kind: z.string(),
}).passthrough();
```

Reglas:

- Un evento que se abre pero **no valida** con el esquema estricto, porque lo
  escribió un Studio más nuevo, se conserva tal cual y se marca `needsUpdate`.
  **No** entra en la resolución y la pantalla dice «hay un cambio hecho con una
  versión más nueva de Studio: actualiza este equipo». Nunca se resuelve en
  silencio.
- `characterDescription` e `instructions` los calcula **main**, nunca el
  renderer (§6.2).

### 3.2 Sobre y relleno (`apps/desktop/src/main/vault/private-store.ts`)

- `sealConversationEvent(vault, payload)`:
  - clave `vault.subkeyFor('conversation', conversationId)`;
  - propósito `'vault.conversation.event'`;
  - el AAD resultante es `luxy.vault.v1.vault.conversation.event`
    (`envelope.ts:61-63`).
- **Tamaño fijo.** Se rellena `pad` con espacios hasta que el JSON mida
  exactamente `EVENT_PLAINTEXT_BYTES - 8` = **65.528 bytes**. `pad()` añade su
  cabecera de 8 bytes y lo deja en 65.536, y el texto cifrado queda en 65.552
  bytes, unos 87.400 caracteres en base64url.
  - Se eligen 64 KiB porque las instrucciones admiten 8.000 caracteres
    (`vault-payloads.ts`, `instructions`), y escapadas en JSON pueden ocupar
    varias veces eso.
  - Si un caso patológico no cabe, se **rechaza** con un `VaultError` que dice
    qué acortar. Nunca se recorta en silencio.
  - Los eventos son pocos (uno por enganche o por soltar), así que el coste en
    disco y en red es despreciable. La descarga se hace por ids (§5.3) para no
    rebajarlos cada vez.
- `openConversationEvent(vault, row)`:
  1. abre con la clave y el propósito;
  2. exige `payload.eventId === row.eventId` y
     `payload.conversationId === row.conversationId`;
  3. valida con el esquema estricto y, si no casa, con el de cabecera
     (`needsUpdate`);
  4. aplica `guard()` antes de devolver.

Qué impide cada cosa:

| Ataque | Lo impide |
| --- | --- |
| Mover el evento a otra conversación | La subclave HKDF cambia (`kdf.ts:152-170`) |
| Llevarlo a otra bóveda | Cambia la llave maestra |
| Hacerlo pasar por un turno, o un turno por él | El propósito del AAD |
| Reponer un evento viejo con otro id | Los ids repetidos dentro |
| Reordenar eventos | El orden va dentro (`anchorSequence`, `generation`) |
| Distinguir enganchar de soltar por el tamaño | Relleno a tamaño fijo |

Lo que **no** impide: que el servidor **omita** un evento. Eso retrasa, pero no
revierte, porque el almacén local solo crece. Solo se detecta si otro evento cita
al que falta en `supersedes` (§4.3).

### 3.3 Fila exterior (`packages/shared/src/vault.ts`)

- `'vault.conversation.event'` se añade a `VAULT_PURPOSES` (`vault.ts:26-36`).
- Esquema de la fila:

```ts
export const privateConversationEventSchema = z.object({
  eventId: z.string().uuid(),
  conversationId: z.string().uuid(),
  privacy: z.literal('private'),
  content: sealedEnvelopeSchema.extend({
    purpose: z.literal('vault.conversation.event'),
    ciphertext: base64UrlSchema.min(1).max(90_000),
  }),
}).strict();
```

  Es `.strict()` a propósito, al revés que `privateRecordSchema`: un campo nuevo
  en claro se rechaza con un 422, no se descarta en silencio.
- Esquemas nuevos:
  - `vaultEventsPushRequestSchema`: `{ events: array(1..20) }`, estricto;
  - `vaultEventsPushResponseSchema`: `{ results: [{ eventId, outcome: 'stored' | 'duplicate' | 'rejected' }] }`;
  - `vaultEventsListResponseSchema`: `{ events: [{ eventId, conversationId, receivedAt }], hasMore }`;
  - `vaultEventsFetchResponseSchema`: `{ events: [privateConversationEvent + receivedAt] }`.
- **No cambian** `privateRecordSchema`, `vaultSyncPushRequestSchema`,
  `vaultSyncPullResponseSchema` ni `vaultSyncListResponseSchema`. Un Studio o un
  gateway viejos no notan nada.

### 3.4 Tabla (`supabase/migrations/0009_luxy_vault_conversation_events.sql`)

```sql
-- 0009: eventos de conversacion de la boveda (enganche a personaje), cifrados.
-- Migracion acumulativa. NO modifica 0001-0008. Solo anexar: nada se actualiza.
begin;

-- (conversacion, propietario) como clave candidata, para que la FK compuesta
-- garantice EN LA BASE que un evento es del dueño de su conversacion.
-- conversation_id ya es PK (0007): la pareja es unica por construccion.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'vault_conversations_owner_pair_unique'
       and conrelid = 'public.vault_conversations'::regclass
  ) then
    alter table public.vault_conversations
      add constraint vault_conversations_owner_pair_unique
      unique (conversation_id, owner_user_id);
  end if;
end
$$;

create table if not exists public.vault_conversation_events (
  event_id        uuid primary key,
  owner_user_id   uuid not null references public.vault_users (id) on delete cascade,
  conversation_id uuid not null,
  -- sobre sellado {version, purpose, nonce, ciphertext}; nada en claro
  content         jsonb not null,
  -- hora del SERVIDOR; la del cliente va dentro del sobre
  created_at      timestamptz not null default now(),

  constraint vault_conversation_events_conversation_fk
    foreign key (conversation_id, owner_user_id)
    references public.vault_conversations (conversation_id, owner_user_id)
    on delete cascade,
  constraint vault_conversation_events_content_shape check (
    jsonb_typeof(content) = 'object'
    and content ->> 'purpose' = 'vault.conversation.event'
    and octet_length(content::text) <= 131072
  )
);

create index if not exists vault_conversation_events_owner_idx
  on public.vault_conversation_events (owner_user_id, created_at, event_id);

alter table public.vault_conversation_events enable row level security;
alter table public.vault_conversation_events force row level security;
revoke all on public.vault_conversation_events from anon, authenticated;
-- sin UPDATE: la inmutabilidad queda tambien en los permisos. DELETE solo para
-- que la cascada de handleVaultDelete no dependa de sutilezas de RI.
grant select, insert, delete on table public.vault_conversation_events to service_role;
commit;
```

Por qué así:

- **Sin columna `revision` ni `kind` en claro.** El orden y el tipo van dentro
  del sobre. La unicidad es la del `event_id`, así que dos eventos concurrentes
  de dos equipos se guardan los dos y ninguno gana en silencio en el servidor,
  como sí pasa hoy con los turnos (`sync.ts:14-18`).
- **FK compuesta**: cierra en la base el agujero de propiedad que tiene
  `vault_records` (`repository.ts:757-763`, `ensureVaultConversation` no mira de
  quién es).
- **No toca** `vault_records`, `luxy_touch_vault_conversation` ni `turn_count`
  (`0007:258-293`), ni añade funciones ni triggers.
- El `revoke` explícito es obligatorio: el de `0001:259` solo afectó a las tablas
  que existían entonces.

---

## 4. La regla del dueño

### 4.1 Función pura (`packages/shared/src/vault-owner.ts`, nuevo)

```ts
resolveConversationOwner({
  turns: { sequence, characterId, characterDescription, instructions }[],  // del sobre v1
  events: OwnerEvent[],        // abiertos y validados
  unreadableEvents: number,    // needsUpdate
}) => {
  characterId: string | null,
  characterDescription: string | null,
  characterLabel: string | null,       // del evento ganador, si es un evento
  instructions: string | null,
  source: 'none' | 'turn' | 'event',
  winnerEventId: string | null,
  legacyCharacterId: string | null,    // contando SOLO turnos (cursores antiguos)
  timeline: { position, characterId, kind: 'birth'|'turn'|'link'|'unlink' }[], // separadores y firmas
  heads: string[],                     // eventos que ningun otro cita
  conflict: boolean,                   // >= 2 cabezas con characterId distinto
  missing: string[],                   // citados en supersedes que no estan
  needsUpdate: boolean,
}
```

Reglas, sin relojes (el `createdAt` de dos equipos no se puede comparar):

1. **Posición.** Un turno que selló `characterId` (incluido `''`) ocupa
   `(sequence, 0, 0, '')`. Un evento ocupa `(anchorSequence, 1, generation,
   eventId)`. Gana el máximo en orden lexicográfico.
   - Un evento va después de todo lo que su equipo vio y antes de cualquier
     turno posterior que selle personaje. En la práctica solo sellan personaje
     el turno 0 de una conversación nueva y los turnos de un Studio antiguo.
2. **`characterId`**: el del ganador. `''` y `null` son «sin personaje».
3. **`characterDescription`**: `null` si no hay dueño. Si lo hay, es la del
   último elemento **con descripción** cuya posición sea mayor o igual que la
   del ganador. Una descripción anterior al cambio de dueño no se hereda nunca,
   y eso arregla también los datos que ya existen: hoy, soltar por el campo deja
   en vigor la ficha de Lía (`conversation-store.ts:364-377`).
4. **`instructions`**: la última no nula por posición, entre turnos y eventos,
   con `''` como «ninguna». Es la regla de `latestInstructions`
   (`conversation-store.ts:283-295`) ampliada a los eventos.
5. **`legacyCharacterId`**: el ganador contando solo turnos (§6.3).
6. **Desempate**: dos eventos con la misma ancla y la misma `generation` se
   ordenan por `eventId`. Es determinista, pero arbitrario; por eso se avisa
   (§4.3).

### 4.2 Punto único de E/S (`apps/desktop/src/main/vault/conversation-store.ts`)

- `PrivateConversationStore` recibe inyectado el almacén de eventos (§5.1).
- `owner(vault, id)`:
  1. lee los eventos de esa conversación;
  2. descifra los turnos hacia atrás hasta tener los tres campos resueltos. Los
     que caen por debajo del ancla del ganador ya no pueden ganarle; solo se
     sigue bajando si faltan las instrucciones;
  3. si falta la descripción y el personaje existe en este equipo, la completa
     con la de su ficha (datos antiguos).
- `list()` usa `owner()`. Su resumen gana `characterDescription`,
  `characterLabel`, `ownerSource`, `conflict`, `needsUpdate` y `pendingUpload`.
- **Se borran** `characterOf` (`103-117`), `latestCharacterId` (`344-355`) y
  `latestCharacterDescription` (`364-377`). `latestInstructions` pasa a leer de
  `owner()`. Mientras el otro flujo tenga `handlers.ts`, los tres quedan como
  envoltorios `@deprecated` que llaman a `owner()`, y se borran en `E40`: los
  errores de compilación enumeran a los lectores que falten.
- **Prueba estructural** nueva: falla si `turn.characterId`,
  `turn.characterDescription` o `turn.instructions` se leen fuera de
  `conversation-store.ts` (`owner`) y `vault-owner.ts`.

### 4.3 Conflictos

- **Cuándo**: dos equipos enganchan o sueltan sin haberse visto. Se crean dos
  eventos con id distinto, el servidor guarda los dos y ninguno se pierde. Tras
  sincronizar, los dos equipos eligen el mismo ganador (regla 1).
- **Se avisa siempre** que haya dos o más cabezas con personaje distinto:
  - «Esta conversación se cambió en los dos equipos sin sincronizar entre
    medias: en {equipo A} a {X} y en {equipo B} a {nadie}. Ha quedado {X} en los
    dos, por una regla fija que los dos equipos aplican igual, no porque fuera el
    último cambio.»
  - Botones: «Dejarla así» y «Cambiar». Los dos crean un evento que cita todas
    las cabezas en `supersedes`, y el conflicto se cierra en los dos equipos.
- **Falta un evento citado** (`missing`): «Falta un cambio que el servidor no ha
  devuelto; sincroniza otra vez».
- **Un Studio antiguo** que selle personaje en un turno posterior al ancla gana
  en los dos equipos. Es coherente con la regla, pero sorprende: se pinta como un
  separador más («cambiado desde un Studio anterior»).

---

## 5. Almacén local y sincronización

### 5.1 Almacén (`apps/desktop/src/main/vault/conversation-event-store.ts`, nuevo)

- Archivo `vault/conversation-events.json` = `{version: 1, content: sealText(subkeyFor('identity', 'conversation-events'), 'vault.identity', JSON)}`.
  - El JSON interior es `{v: 1, rows: [{event: <fila exterior tal cual viaja>, uploaded: boolean, origin: 'here' | 'remote', rejectedAt: iso | null}]}`.
  - El sello exterior hace que el disco no delate qué conversaciones tienen
    eventos. Las filas van dentro ya selladas con la subclave de su
    conversación, listas para subir.
- Calcado de `relation-store.ts`:
  - carril serializado (`lane`) para leer, modificar y escribir (`286-295`);
  - temporal, `fsyncSync` y `renameSync` (`355-375`);
  - si el archivo existe y no abre, `VaultError` y **no se sobrescribe nunca**
    (`204-254`);
  - lo que no valida se conserva tal cual (`256-282`).
- Métodos:
  - `append(vault, conversationId, build)`: calcula `generation` y `supersedes`
    **dentro del carril**, así que dos clics seguidos no repiten generación;
  - `merge(vault, rows)`: unión por `eventId`, idempotente;
  - `markUploaded(ids)`, `markRejected(ids)`;
  - `forConversation(id)`, `pendingUpload()`;
  - `removeConversation(id)`, llamado desde `PrivateConversationStore.delete()`.
- Caché en memoria de los eventos ya abiertos, por `eventId`, que se vacía al
  cerrar la bóveda (`vault.onLock`).
- **Compatibilidad hacia atrás**: es un archivo nuevo. Un Studio anterior lo
  ignora, no reescribe `characters.json` con campos nuevos
  (`character-store.ts:84-90`) y no cambia el formato de los `.jsonl`.

### 5.2 Rutas del gateway

| Ruta | Qué hace |
| --- | --- |
| `GET /api/vault/events?limit&offset` | Lista `{eventId, conversationId, receivedAt}` del usuario, ordenados por `(created_at, event_id)`, con `hasMore`. |
| `GET /api/vault/events?ids=a,b,…` (1 a 20 uuids) | Devuelve las filas completas de esos ids que sean del usuario. |
| `POST /api/vault/events` | Sube de 1 a 20 eventos y devuelve `stored`, `duplicate` o `rejected` por evento. |

- Todas van envueltas en `withVaultAuth` y filtran **siempre** por
  `owner_user_id = user.id`.
- `POST`:
  1. `readBody` con el esquema estricto;
  2. `assertNoPlaintextLeak` sobre cada evento;
  3. por cada `conversationId` distinto: `ensureVaultConversation` y después
     `repo.vaultConversationOwnedBy(user.id, id)`. Si no es suya, sus eventos
     salen `rejected` y no se insertan;
  4. `repo.insertVaultEvents` usa un método nuevo del cliente,
     `SupabaseClient.insertIgnoringDuplicates(table, rows, 'event_id')`, con
     `Prefer: resolution=ignore-duplicates,return=representation`, como
     `insertIfAbsent` (`supabase.ts:93-106`). **Nunca** con `.catch(() => [])`;
  5. lo que no vuelve se clasifica leyendo por `event_id` con el filtro de
     dueño: si existe, `duplicate`; si no, `rejected`;
  6. el log lleva solo `userId` y los recuentos, sin conversación ni ids.
- Si Supabase responde que la tabla no existe (Worker desplegado antes de
  migrar), se devuelve **503** «falta aplicar la migracion 0009 en Supabase» en
  vez de 500.
- Una ruta desconocida en un gateway viejo ya devuelve 404 «ruta no encontrada»
  (`index.ts`, al final de `fetch`).

### 5.3 Cliente (`apps/desktop/src/main/vault/sync.ts`)

- `call()` hoy lanza `SyncError` sin el código (`sync.ts:73-87`). Se añade
  `callOptional()`, que devuelve `{status: 404 | 503}` en lugar de lanzar para
  esos dos códigos.
- `syncConversationEvents(vault, events, deps)`, **después** de los turnos de
  todas las conversaciones y **antes** de los medios:
  1. **Sonda**: `GET /api/vault/events?limit=1`. Con 404 o 503, el resultado es
     `eventsUnsupported: true`. Los pendientes se quedan en «falta subir», no
     se lanza nada y la sincronización de turnos ya hecha cuenta como hecha.
  2. **Subir** `pendingUpload()` en lotes de 20. `stored` y `duplicate` marcan
     `uploaded`; `rejected` marca `rejectedAt` y lo cuenta.
  3. **Listar** todos los ids remotos, paginando, y pedir por `ids` solo los que
     no están en local.
  4. **Verificar** cada fila con `openConversationEvent` antes de `merge`. Lo que
     no abre se cuenta como `eventsRejected` y no se guarda.
- `VaultSyncResult` gana `eventsUploaded`, `eventsDownloaded`, `eventsRejected`,
  `eventsPending` y `eventsUnsupported`, y además `ownerChanged: string[]`: las
  conversaciones cuyo `characterId` resuelto cambió con lo bajado.
- **Exclusión con el envío** (cierra el turno huérfano, §9):
  - `syncVault` recibe `isBusy(conversationId)` y **salta** turnos, eventos y
    medios de una conversación con envío en curso. Lo cuenta como
    `skippedBusy`, y la pantalla lo dice;
  - mientras sincroniza una conversación, la marca en un conjunto
    `syncInFlight` que el envío consulta.

---

## 6. Lo que pasa al cambiar el dueño

### 6.1 Quién lee el dueño hoy, y a qué pasa

| # | Lector | Hoy | Pasa a |
| --- | --- | --- | --- |
| L1 | Lista (`handlers.ts` hacia 1156-1173; `vault-conversation-groups.ts`) | `list().characterId` | `list()` ya resuelto, más `characterLabel` |
| L2 | Abrir conversación (hacia 1177-1187) | `latestCharacterId` + `latestCharacterDescription` + `latestInstructions` | `owner()` |
| L3 | Prueba de compatibilidad (hacia 1366) | `latestCharacterDescription`, `latestInstructions` | `owner()` |
| L4 | Panel de pendientes (hacia 1692; `relation-review.ts:111`) | `list()` | sin cambio de contrato |
| L5 | Diagnóstico de memoria (hacia 2538-2620; `relation-diagnostics.ts:311-323, 362`) | `list()` + `effectiveThrough` sin dueño | `effectiveThrough` con dueño (§6.3) |
| L6 | Instrucciones del personaje (hacia 3238-3281) | `list()` + `latestCharacterId` por conversación | `list()` |
| L7 | Turno privado (`runPrivateTurn`, hacia 4318-4400 y siguientes) | `previousCharacter` y `previousDescription` | `owner()`; el envío ya no cambia el dueño de una conversación existente (§6.2) |
| L8 | Resultado del envío (hacia 5287) | `latest*` | `owner()` |
| L9 | Índice y recuerdo (`private-memory.ts:158-164`; `recall.ts`) | `list()` **y además** `latestCharacterId`: descifra dos veces | el dueño del resumen de `list()`; expone `ownerOf(id)` |
| L10 | Extractor de pendientes (`relation-sync.ts:536-537`, 705, 838, 913-922) | `list()` | igual, y sella el dueño en el cursor |
| L11 | Guarda de desfase (`relation-selection.ts:300-301`) | `cursor.through` en crudo | `effectiveThrough` con dueño (también arregla que ignore las subidas de versión) |
| L12 | Medios y `esAvatar` (hacia 4540) | compara con el personaje actual | excluye del modelo los medios con `metadata.characterId` distinto del dueño actual |

Lo que **no** lee el dueño, comprobado: el catálogo (su prompt solo lleva
turnos) y la memoria retroactiva (`vault-recap.ts`, `recap-sync.ts` y
`recap-store.ts` no contienen «character»). No hay que tocarlos.

### 6.2 En este equipo: el manejador de enganche

IPC nuevos:

- `vaultConversationOwnerPreview` (`{conversationId, characterId | null}`)
  devuelve lo que hace falta para el texto de la confirmación, calculado en main
  **antes** de enseñarla:

```ts
{
  label, characterFound, turns,
  instructionsOutcome: 'character' | 'own' | 'none' | 'removed' | 'kept',
  backgroundCli: 'claude' | 'codex',
  signedIn: boolean,
  serverSupport: 'yes' | 'no' | 'unknown',   // de la ultima sincronizacion
  replyInFlight: boolean,
}
```

- `vaultConversationOwnerSet` (`{conversationId, characterId | null,
  resolvesConflict: boolean, projectAlias?: string}`, `.strict()`) devuelve la
  conversación leída con el dueño resuelto. **No lleva descripción ni
  instrucciones**: las pone main desde `context.characters`.

Guardas, copiadas de `vaultConversationMemoryForget` (hacia 2100-2135):

- la bóveda está abierta;
- no hay envío en curso (`!sendInFlight.has(id)`) ni sincronización de esa
  conversación en curso;
- la conversación tiene registros;
- el personaje existe en este equipo, o es `null` para soltar;
- si el dueño resuelto ya es ese y no hay conflicto, no se crea nada: se
  devuelve el estado.

Pasos:

1. `append` del evento. Main calcula:
   - la descripción desde la ficha;
   - las instrucciones, con la lógica de «instrucciones del personaje» (hacia
     3265-3281), **solo** si la conversación no tiene instrucciones propias; si
     las tiene, `null` («no se tocan»);
   - al **soltar**: `''` si las instrucciones vigentes vienen del evento que se
     deshace y nadie las cambió después; si no, `null`.
   El evento queda sellado y escrito con `fsync`.
2. `context.privateMemory.invalidate()`. La generación ya descarta una pasada en
   curso (`private-memory.ts:214`).
3. `relationSync.forgetFailure(id)` (método nuevo). Si llega `projectAlias`,
   `void relationSync.runOnce({conversationId: id, projectAlias, limit: 1,
   force: true})` dentro de un `try` (`D-088`). Aunque no se lance, el cursor ya
   no vale (§6.3) y la próxima pasada lo relee.
4. Subida en segundo plano: `void uploadPendingEvents()`, con fallo silencioso,
   que solo cambia el estado a «subido» o «falta subir».
5. Log de una línea con el verbo (`enganchar` / `soltar`), sin ids ni nombres.

Lo que **no** hace:

- no toca turnos, ni `removeLastTurn`, ni copia el avatar, ni lee nada de forma
  asíncrona en el renderer;
- el catálogo y la retroactiva no dependen del dueño, así que no se tocan.

**En el envío (`runPrivateTurn`)**:

- En una conversación **con registros**, `args.characterId` o
  `args.characterDescription` distintos de `null` se **rechazan** con
  `VaultError` antes de `appendTurn`, o sea sin gastar nada: «el personaje se
  cambia con el selector Personaje». El dueño solo cambia por evento.
- En una conversación **nueva** (turno 0, su nacimiento), el personaje se sigue
  sellando en el turno, como hoy. Main completa la descripción desde la ficha y,
  si no llegan instrucciones, pone las del personaje. Se acaba la carga asíncrona
  de `Vault.tsx` (hacia 441-455).

### 6.3 El cursor de pendientes guarda con qué dueño se revisó

- `relationCursorSchema` (`packages/shared/src/vault-relation.ts:123-136`, no
  `schemas.ts`) gana `owner: z.string().max(128).nullable().optional()`.
- `persist` y `persistRefusal` (`relation-sync.ts`, hacia 830-861) sellan
  `owner = candidate.characterId`: el dueño con el que **se revisó**, capturado
  en `sweep` antes de llamar al CLI (`536-537`, `705`). Nunca el actual.
- `effectiveThrough(cursor, turns, owner)` (`relation-sync.ts:235-247`) devuelve
  -1 si `cursor.owner !== owner.characterId`. Un cursor antiguo sin el campo se
  compara con `owner.legacyCharacterId`: antes de esta versión no había eventos,
  así que la comparación es exacta y no hay que migrar `relation.json`.
- `relation-selection.ts:300-301` y `relation-diagnostics.ts:362` usan esa misma
  función con el dueño.
- Se compara el `characterId`, no el evento: enganchar, soltar y volver a
  enganchar a Lía sin haber revisado nada entre medias no obliga a releer.

Qué arregla:

- **La carrera**: una extracción que empezó antes del enganche escribe un cursor
  sellado con el dueño viejo, y la siguiente pasada lo ve inválido y relee.
- **El otro equipo**: al bajar el evento cambia el dueño resuelto, y su cursor
  deja de valer sin depender de `characterChanged`.
- Releer no duplica notas, porque su id es determinista, y su dueño se deduce al
  leer (`relation-sync.ts:913-922`).
- Mientras tanto, la guarda de desfase bloquea las promesas antiguas de Lía en
  esa conversación. Es el lado seguro de `D-088`: si la extracción falla, la
  conversación pasa a no legible y deja de bloquear.

### 6.4 En el otro equipo

Tras «Sincronizar», en el manejador `vaultSync` (hacia 2944-2963):

1. Si `downloaded > 0` o `eventsDownloaded > 0`: `privateMemory.invalidate()`.
   Hoy falta incluso para los turnos.
2. Por cada conversación en `ownerChanged`: `relationSync.forgetFailure(id)`.
3. `relationSync.poke()` (método nuevo): rearma la pasada en reposo si ya hay un
   `projectAlias` conocido. Si no lo hay, porque en ese equipo no se ha escrito
   desde que arrancó, la revisión espera al siguiente mensaje o al panel de
   pendientes. **HIPÓTESIS**: no hay otro disparador (`relation-sync.ts:449-452`,
   `481-490`).

Qué recibe ese equipo: el dueño, la etiqueta, la ficha y las instrucciones que
viajan en el evento. Si Lía no está allí con ese id, ver §7.4.

### 6.5 Medios

- `esAvatar` y la lista de medios que se ofrecen al modelo **excluyen** los que
  tengan `metadata.characterId` distinto del dueño actual. Hoy, tras soltar, la
  foto de perfil de Lía llegaría como una imagen cualquiera.
- **Residuo del avatar** en un turno que falla: la copia se sigue haciendo antes
  del turno (hacia 4343-4395), pero se guarda la `objectKey` añadida. Si el turno
  se retira, se llama a `privateMedia.remove(conversationId, objectKey)`, un
  método nuevo en `media-store.ts` que trabaja sobre las líneas crudas, como
  `clearMemory`, y borra el blob cifrado.
  - No puede estar subido, porque la sincronización salta la conversación con un
    envío en curso (§5.3).
  - El evento de enganche no copia el avatar: lo copia el siguiente envío, que
    ya va con el dueño fijado.

### 6.6 Retirar el turno sin respuesta sin borrar uno bueno

- `conversation-store.ts` gana `removeTurnIfLast(conversationId, recordId)`:
  quita la última línea **solo** si su `recordId`, que va en claro en el `.jsonl`,
  es el indicado.
  - No necesita la bóveda abierta y es idempotente: una segunda llamada no
    encuentra ese `recordId` al final y no hace nada.
- `runPrivateTurn` guarda el `recordId` del turno del usuario (lo devuelve
  `appendTurn`) y la línea `if (!userTurnKept) store.removeLastTurn(...)` (hacia
  5158) pasa a `removeTurnIfLast`.
- El manejador `vaultConversationSend` añade un `catch` que llama a
  `removeTurnIfLast(id, userRecordId)` y vuelve a lanzar.
  - Si la respuesta ya se escribió, el último registro es la respuesta, así que
    no se toca nada.
  - Si ya se retiró, tampoco.
- `removeLastTurn` sin condición queda solo para quien lo necesite de verdad, y
  se busca con `grep` que no quede ningún otro uso en el camino del envío.

---

## 7. La pantalla

### 7.1 Selector «Personaje»

Va en la fila Proveedor, Modelo, Esfuerzo y Proyecto (`Vault.tsx`, hacia
494-574). Muestra nombre y avatar, nunca el UUID. Estados:

| Estado | Qué muestra y qué permite |
| --- | --- |
| Hilo nuevo | Elegir prepara el turno 0. Sin confirmación: no cambia nada existente. |
| Existente sin dueño | Elegir abre la confirmación (§7.3). |
| Con dueño | «Lía», y solo ofrece «Soltar», con confirmación. Pasar de un personaje a otro no se ofrece directamente. |
| «Lía · falta subir» | Sin sesión, sin sincronizar o con el servidor sin actualizar. |
| «Lía · no está en este equipo» | La etiqueta sale del evento (§7.4). |
| «Conflicto» | Abre el aviso de §4.3. |
| «Cambio de una versión más nueva» | `needsUpdate`. |

Además:

- Desaparece el campo del UUID (`Vault.tsx`, hacia 1238-1250), y queda una línea
  que remite al selector.
- «Usar» de la galería en un hilo existente solo elige para generar imágenes; si
  además cambiaría el dueño, pasa por la confirmación.
- «Nueva con Lía» junto a «Nueva» (hacia 344-348), cuando el hilo abierto tiene
  personaje.

### 7.2 Visibilidad en el hilo

- El título pasa a «Conversación privada · Lía» o «· sin personaje» (hacia 344).
- Cada respuesta se firma con el dueño **que tenía en su posición**, según
  `timeline`: «Lía» o «Respuesta (sin personaje)». No se firma con Lía lo que se
  escribió sin su ficha.
- Un separador por cada evento: «Enganchada a Lía · 25/09 10:30 · lo anterior se
  escribió sin su ficha». Otro para «Soltada».

### 7.3 Confirmación

Va dentro de la página, con el patrón de F32 (`Vault.tsx`, hacia 6124-6232). El
texto lo compone `describeCharacterLink(preview)`, una función pura con prueba.
El botón de confirmar está desactivado hasta que llega `preview`. Partes, todas
condicionadas:

1. **Qué cambia ahora.** «Desde ya es de Lía entera, también los {turns} turnos
   anteriores, que se escribieron sin su ficha. Sale en su grupo. Desde tu
   próximo mensaje aquí responde con su ficha.» Y **una** de estas:
   - «y con sus instrucciones»;
   - «se quedan las instrucciones que ya tenía esta conversación; las de Lía no
     se cargan»;
   - «Lía no tiene instrucciones guardadas».
2. **Qué recordará desde otras conversaciones.** «Una línea con la fecha y cómo
   empezaba (dos si entre medias pasaron más de 6 horas). Si le preguntas por una
   fecha («¿de qué hablamos esta mañana?», que solo vale el mismo día), leerá el
   PRINCIPIO de esta conversación, hasta 12 turnos. Si le preguntas por algo
   concreto, leerá los turnos de alrededor. Mientras sea una de sus 2
   conversaciones más recientes, recibirá además un resumen corto de lo que el
   modelo apuntó aquí, que puede no incluir todo lo acordado.»
   - Nada de «recordará lo acordado»: `recall.ts:907-908, 971-973`, `53-54`;
     `episodes.ts:85, 136-141`.
3. **Pendientes.** «Lo prometido aquí se revisará como suyo en cada equipo con
   Studio actualizado: una llamada a {Claude|Codex} con tu sesión.»
4. **El otro ordenador.** «Queda guardado en el servidor al pulsar y llega al
   otro cuando sincronices allí; hoy no hay sincronización automática. Si allí
   Lía no es la misma ficha, saldrá como personaje que no está en ese equipo.» Si
   `signedIn` es falso o `serverSupport` es `'no'`: «de momento solo en este
   equipo; subirá cuando entres / cuando se actualice el servidor».
5. **Deshacer.** «Se puede soltar. No se borra nada: queda como otro cambio,
   también cifrado en el servidor. Lo que se revisó como suyo vuelve a ser de
   nadie, salvo las promesas antiguas suyas que ya se cerraron aquí.»

`describeCharacterUnlink` y `describeOwnerConflict` siguen el mismo patrón.

### 7.4 Personaje que no está en este equipo

- La etiqueta sale del evento. La conversación se agrupa por el `characterId`:
  si algún día el personaje aparece con ese id, entra solo en su grupo.
- El modelo recibe la ficha y las instrucciones copiadas en el evento.
- **No hay imágenes**: `characterInVault` es falso, coherente con `D-064`.
- No se ofrece «revincular» con un id local: rebotaría al otro equipo. El arreglo
  real es sincronizar personajes, y queda fuera de este trabajo.
- `FORGOTTEN_LABEL` («Personaje olvidado», `vault-conversation-groups.ts:24,
  78-80`) pasa a «Personaje que no está en este equipo», que es verdad tanto si se
  borró como si vive en el otro equipo.

### 7.5 Aviso «¿Es de Lía?»

Módulo puro nuevo, `apps/desktop/src/renderer/vault-character-link.ts`, con
`suggestCharacters({userTexts, draft, characters, ownerId, dismissed})`, que
devuelve una lista de `characterId`.

**Normalización, simétrica** (se aplica igual al label y al texto):

- minúsculas con `toLocaleLowerCase('es')`;
- tildes quitadas con un **mapa explícito**, como `vault-image-gate.ts:118-148`,
  sin NFD;
- `ñ` → `n` en los dos lados;
- letras repetidas juntadas (liaaa → lia);
- se parte con la RegExp **literal** `/[^\p{L}]+/u`. **Nunca** una RegExp
  construida con el nombre.

**Claves del label:**

- el nombre de pila: el primer token antes de «(», «[», «-», «—», «–», «,», «·»,
  «|» o «:»;
- la secuencia entera, si tiene de 1 a 4 tokens;
- un nombre de pila de menos de 3 letras solo casa con la secuencia entera.

**Descartes:**

- token anterior en {me, te, se, nos, os, le, les, lo, la, los, las, el, un, una}:
  «se lía», «me lía», «la lía parda»;
- URL, rutas, correos y lo que va entre acentos graves, que se quitan antes de
  partir;
- nombres que son palabras comunes (luz, sol, mar, paz, rosa, flor, alba, cielo,
  ángel, blanca, estrella, perla, dulce, gloria, victoria, pilar, rocío, aurora,
  sierra, león), salvo que vayan en mayúscula a mitad de frase o aparezca la
  secuencia entera.

**Ámbito:**

- solo los turnos `role: 'user'` y el borrador;
- solo sin dueño efectivo y sin descarte;
- si casan varios personajes, el aviso ofrece todos y no elige.

**Pantalla**: un `Notice tone="idle"` encima del cuadro de texto, con «Es de
{Lía}» (abre la confirmación de §7.3) y «No, esta no». El descarte vive en un
`useState` por `conversationId` y no se guarda en disco: tras reiniciar Studio
puede volver a salir una vez. No registra nada: sin `console`, sin IPC y sin
telemetría.

No se afirma que «habría detectado lo de hoy»: no se ha comprobado con el label
real ni con el primer mensaje real.

### 7.6 Sincronizar

- El botón se desactiva también mientras `vault.sending` (hoy solo con `syncing`
  o `busy`: `Vault.tsx`, hacia 4233).
- El resultado enseña, además de lo de hoy:
  - «N cambios de personaje subidos o bajados»;
  - «N pendientes de subir: el servidor aún no los admite»;
  - «N conversaciones saltadas porque estaban contestando».

---

## 8. R1: resumen de las 2 últimas conversaciones

### 8.1 Selección (`packages/shared/src/vault-recent-memories.ts`, nuevo, puro)

- **Candidatas**: `privateMemory.conversationsFor(owner)`, menos la actual y las
  excluidas, ordenadas por `updatedAt` de `list()`. Se toman **K = 2**. Solo si
  la conversación actual tiene dueño.
- **Fuente de cada una**:
  1. la memoria sellada (`latestMemory`), que viaja entre equipos;
  2. si no la hay, la ficha retroactiva **aprobada** que cubre la cola, con la
     misma regla que `chooseConversationMemory` (`vault-recap.ts:1328-1353`).
     Es local, así que el bloque puede diferir entre equipos, y se dice;
  3. si no hay ninguna, se salta, sin rellenar con otra.
- **Campos**:
  - `decisions` primero, con entradas **enteras** tomadas desde el final hasta
    unos 260 caracteres;
  - después `summary`, cortado en final de frase, hasta unos 400 por
    conversación y con un mínimo de unos 120;
  - **nunca** `plan`, `openQuestions`, `lessons` ni `facts`: `plan` y
    `openQuestions` son los canales de eco que mide `ecoMemoria`, y los cubren
    los pendientes.
- **Tope del bloque**: unos 800 caracteres más las cabeceras.

### 8.2 Prompt (`packages/shared/src/vault-prompt.ts`, después del otro flujo)

- Bloque `recientes-personaje` antes del bloque `memoria`. Lleva:
  - la cabecera «DE OTRAS CONVERSACIONES CON ÉL — NO OCURRIÓ EN ESTA (DATOS)»;
  - `MEMORY_NO_INVENTION` (`D-061`);
  - la orden de no copiarlo a la memoria de esta conversación;
  - por entrada, la fecha y el título.
- Bloque `definicion-memoria`, **solo de bóveda**, justo antes de
  `instruccion-memoria`. Define `decisions` como lo que quedó acordado entre los
  dos y `plan` como lo que queda por delante, con las definiciones de
  `vault-recap.ts:346-349`.
  - No toca `CONVERSATION_MEMORY_INSTRUCTION` (`schemas.ts:259`), que comparte
    `apps/agent/src/job-runner.ts:338`.
  - Arregla las memorias futuras, no las ya selladas.
- `measureVaultPrompt` mide los dos bloques con sus etiquetas.

### 8.3 Cableado y medidas (`handlers.ts`, después del otro flujo)

- En `runPrivateTurn`, **después** de `buildRecall` (que construye el índice del
  que sale `conversationsFor`) y dentro de un `try` que deja el bloque vacío si
  falla (`D-088`), sin registrar el motivo.
- **M3**: en la línea «turno privado terminado»,
  `recientes: {conversaciones, caracteres, decisiones, resumenRecortado}`.
- **ecoRecientes**, calcado de `ecoMemoria` con `quoteStems` y `matchesNote`
  (`relation.ts:78, 111`): sobre la memoria **nueva**,
  `{entradas, conRaicesDeRecientes, sinApoyoAqui}`. `sinApoyoAqui` son las
  entradas que casan con R1 y con ningún turno de esta conversación. Es el
  blanqueo. Solo números.
- **M1**, diagnóstico local de solo recuentos: por cada memoria sellada de las
  conversaciones del personaje, cuántas entradas de `decisions` y de `plan`
  llevan marcas de acuerdo (quedamos, acord-, promet-, «a partir de ahora»,
  regla, límite, trato). Si hay claramente más en `plan`, R1 no lleva lo acordado
  y se decide con Daniel.
- **M2**: en el panel de memoria, una vista previa con el bloque exacto que
  recibiría el personaje. Solo en pantalla, nunca en el log.
- **Advertencias en pantalla**:
  - la memoria de la conversación 3657a284 se escribió sin la ficha;
  - borrarla con F32 solo borra en este equipo (`D-099`): en el otro sigue
    entera, y R1 se la llevaría a Lía allí. Se cura sola si después se escribe
    una memoria nueva en esa conversación.

---

## 9. Cada fallo de los escépticos, y el paso que lo resuelve

| Fallo | Cómo queda resuelto | Paso |
| --- | --- | --- |
| El reinicio del cursor se pierde por una **carrera** con una extracción en curso que reescribe un cursor viejo (`relation-sync.ts`, `persist`) | Ya no hay reinicio. El cursor lleva el dueño con el que se revisó, capturado al empezar, y `effectiveThrough` lo invalida si no coincide. Un `persist` tardío escribe un cursor que ya nace inválido. | E13, E24 |
| En el **otro equipo** el cursor no se reinicia nunca (`characterChanged` sale falso) | El dueño resuelto cambia al bajar el evento, y la comparación invalida el cursor sin depender del turno. Además, `invalidate`, `forgetFailure` y `poke` tras sincronizar. | E24, E26, E40 |
| **Avatar** copiado antes del turno y no retirado si falla | Se guarda la `objectKey` añadida y se retira en la misma rama que retira el turno. El evento no copia avatar, y los medios de otro dueño no llegan al modelo. | E25, E40 |
| **Instrucciones** cargadas de forma asíncrona en el renderer | Las calcula main dentro del evento (enganche) o en el turno 0 (nacimiento). El renderer ya no las carga, y el texto sale de `preview`, que llega antes de poder confirmar. | E21, E40, E41, E51 |
| **Doble `removeLastTurn`** con la bóveda cerrada borra un registro bueno | `removeTurnIfLast(id, recordId)`: condicional al `recordId` en claro, idempotente y sin bóveda. Además el enganche ya no viaja en un turno. | E22, E40 |
| **Sincronizar a mitad de turno** sube un turno que luego se retira: huérfano | La sincronización salta las conversaciones con envío en curso (main), el botón se desactiva con `sending` (renderer) y el envío rechaza una conversación que se está sincronizando. | E26, E40, E51 |
| **Los personajes no se sincronizan**: con otro id no entra en su grupo | La etiqueta, la ficha y las instrucciones viajan en el evento. La pantalla dice «no está en este equipo», no «olvidado». La coincidencia de id se comprueba en el paso E84 y queda como pregunta a Daniel. | E11, E51, E84 |
| **Textos que prometían de más** (`D-093`) | `describeCharacterLink` condicional y con prueba de contenido: recordar por fecha da el PRINCIPIO; instrucciones según `preview`; «llega» = al sincronizar; el aviso no afirma lo no comprobado. | E14, E51 |

Y los defectos previos que aparecieron por el camino:

| Defecto | Paso |
| --- | --- |
| Soltar por el campo deja la ficha de Lía en vigor | E12 (regla 3), E40 |
| `vaultSync` no invalida el índice tras bajar turnos | E40 |
| `insertVaultRecords` probablemente no sube nada nuevo (HIPÓTESIS fuerte) | E01, E32 |
| `migrations.test.ts` solo mira la primera migración de bóveda | E30 |
| La guarda de desfase usa `cursor.through` en crudo e ignora las versiones | E24 |
| `private-memory.ts` descifra el dueño dos veces | E23 |

---

## 10. Pasos

Cada paso tiene un ID. Al empezarlo, bloquearlo o terminarlo se actualizan
`CURRENT-TASK.md` y `CHANGELOG-WORK.md` (`AI-WORK-PROTOCOL.md`). Si el otro flujo
ya usó `F33`, se renumera con la siguiente fase libre. Ningún paso de código
termina sin `npm run lint`, `npm run typecheck`, `npm test` y `npm run build` en
verde.

### Fase 0: antes de tocar nada

- **E00 — Relevo con el otro flujo.** Esperar a que el flujo que edita
  `handlers.ts`, `vault-prompt.ts`, `schemas.ts`, `Vault.tsx`, `useVault.ts` y
  el esquema de personajes haga commit o entregue el turno. Solo una IA escribe
  en el worktree a la vez. Se registra en `CURRENT-TASK.md` con los IDs
  `F33-ENGANCHE-*` y `F33-RECUERDO-*`.
- **E01 — Comprobar la subida de turnos (Daniel, solo lectura en producción).**
  En el SQL Editor:
  `select conversation_id, turn_count, updated_at from public.vault_conversations order by updated_at desc limit 20;`
  y comparar con los registros locales, contados sin descifrar.
  - Si el servidor tiene menos en conversaciones que crecieron después de su
    primera sincronización, se confirma que `insertVaultRecords` no sube nada
    nuevo y E32 entra en el mismo despliegue.
  - Alternativa sin tocar producción: en el log del Worker, «registros de
    boveda almacenados» con `stored: 0` y `received` N.

### Fase A: lógica pura en `shared` (no depende del servidor ni del otro flujo)

- **E10 — Contrato de la fila y de las rutas** (`packages/shared/src/vault.ts`):
  - el propósito nuevo;
  - `privateConversationEventSchema` (estricto);
  - los esquemas de subida, lista y descarga.

  Pruebas: un campo extra en claro o `characterId` fuera del sobre se rechaza;
  otro propósito se rechaza; más de 20 se rechaza; un sobre sellado de verdad
  valida (patrón de la prueba de `sealedEnvelopeSchema`).
- **E11 — Carga sellada** (`vault-payloads.ts`):
  - `vaultConversationEventPayloadSchema` y su esquema de cabecera;
  - `EVENT_PLAINTEXT_BYTES`.

  Pruebas: estricto; `v` o `kind` desconocidos pasan solo por la cabecera.
- **E12 — Función del dueño** (`vault-owner.ts`, nuevo). Pruebas:
  - soltar da descripción `null`;
  - una descripción anterior al cambio no se hereda;
  - dos eventos concurrentes convergen en los dos órdenes de entrada;
  - un turno antiguo posterior al ancla gana al evento, y un evento gana a los
    turnos que vio;
  - instrucciones: `null` no toca, `''` quita;
  - `heads`, `conflict`, `missing`, `needsUpdate` y `timeline`;
  - `legacyCharacterId` ignora los eventos.
- **E13 — Cursor con dueño** (`vault-relation.ts`): campo `owner` opcional.
  Prueba: un `relation.json` antiguo sigue parseando.
- **E14 — Textos de la pantalla** (`apps/desktop/src/renderer/vault-character-link.ts`,
  nuevo): `describeCharacterLink`, `describeCharacterUnlink` y
  `describeOwnerConflict`, puros. Pruebas de contenido, como `describeForgetAck`:
  - la frase del PRINCIPIO de la conversación sale siempre;
  - cada rama de instrucciones;
  - «falta subir» con y sin sesión, y servidor sin soporte;
  - la frase de soltar sobre las promesas ya cerradas.
- **E15 — Aviso por nombre** (mismo módulo): `suggestCharacters`.
  - Casa: «hola lía», «Lia, ¿estás?», «LÍA», «liaaa», label «Lía (Horde)»,
    label «Lía Martín».
  - No casa: «Liana», «aliado», «lías», «se lía», «me lía», «la lía parda»,
    «github.com/lia/x», «`lia`», «camiseta rosa» con una Rosa, textos del
    asistente.
  - Dos personajes dan dos resultados, y no hay ninguna llamada a `console`.
- **E60 — R1, selección y formato** (`vault-recent-memories.ts`, nuevo). Pruebas:
  - excluye la actual y las excluidas;
  - K = 2 y los recortes;
  - nunca `plan`, `openQuestions`, `lessons` ni `facts`;
  - la sellada va antes que la ficha, y solo fichas aprobadas que cubren la cola;
  - `decisions` desde el final y con entradas enteras.

### Fase B: escritorio, sin servidor (archivos fuera del otro flujo)

- **E20 — Sellar y abrir eventos** (`private-store.ts`). Pruebas:
  - el tamaño del texto cifrado es idéntico al enganchar con ficha larga y al
    soltar;
  - no abre en otra conversación;
  - ids cambiados fuera del sobre: rechazo;
  - propósito de turno: rechazo;
  - caso que no cabe: `VaultError` y no recorta.
- **E21 — Almacén de eventos** (`conversation-event-store.ts`, nuevo). Pruebas:
  - dos `append` seguidos no repiten generación;
  - `merge` es idempotente;
  - un archivo que no abre no se sobrescribe;
  - las filas ilegibles se conservan;
  - `removeConversation`;
  - escritura con `fsync` y `rename`.
- **E22 — `owner()` y `removeTurnIfLast`** (`conversation-store.ts`).
  - `list()` con los campos nuevos; `delete()` limpia eventos; los envoltorios
    `@deprecated` de los `latest*` de personaje.
  - Pruebas: los tres campos resueltos en datos antiguos y con eventos;
    `removeTurnIfLast` no toca un último registro distinto y funciona con la
    bóveda cerrada.
- **E23 — Índice** (`private-memory.ts`): el dueño sale del resumen de `list()`
  (deja de descifrar dos veces) y expone `ownerOf`. Prueba: una conversación
  enganchada por evento entra en `conversationsFor(Lía)`.
- **E24 — Pendientes con dueño**:
  - `relation-sync.ts`: `effectiveThrough` con dueño; `persist` y
    `persistRefusal` sellan `candidate.characterId`; `forgetFailure`; `poke`;
  - `relation-selection.ts:300-301` y `relation-diagnostics.ts:362`.

  Pruebas:
  - **carrera**: la extracción empieza con dueño `null`, se engancha a mitad y
    `persist` escribe; la siguiente pasada relee;
  - **otro equipo**: el cursor sellado con `null`, el evento `merge`d y el
    cursor inválido;
  - cursor antiguo sin `owner` frente a `legacyCharacterId`;
  - la guarda de desfase respeta las versiones.
- **E25 — Retirar un medio** (`media-store.ts`): `remove(conversationId,
  objectKey)` sobre líneas crudas y blob. Pruebas: solo ese medio; ausente, no
  hace nada.
- **E26 — Sincronización de eventos** (`sync.ts`), con `fetch` falso. Pruebas:
  - **gateway viejo** (404): los turnos se sincronizan, los eventos quedan
    pendientes y no lanza;
  - 503, igual;
  - `stored`, `duplicate` y `rejected`;
  - se sube antes de bajar;
  - solo se piden los ids que faltan;
  - una fila que no abre no se guarda;
  - `ownerChanged`;
  - `isBusy` salta la conversación en turnos, eventos y medios.

### Fase C: servidor, solo código (nada se despliega aquí)

- **E30 — Migración 0009 y sus pruebas.**
  - El archivo de §3.4.
  - En `migrations.test.ts`: los cuatro `migrations.find(m => m.name.includes('vault'))`
    (líneas 145, 171, 180 y 190) pasan a recorrer **todas** las migraciones de
    bóveda. Se añaden `character_id` y `character_name` a las columnas
    prohibidas, y la tabla nueva a las listas de RLS y force.
  - Pruebas propias de la 0009: la tabla existe; RLS con enable y force; revoca a
    `anon` y `authenticated`; da permisos a `service_role` **sin** `update`; FK
    compuesta con `on delete cascade`; el `do $$` idempotente; no contiene
    `delete from`, `drop` ni `create or replace function`; no toca
    `vault_records`, `turn_count` ni `luxy_touch_vault_conversation`.
  - Si ampliar a todas destapa algo en la 0008, se registra y se decide aparte;
    **nunca** se modifica una migración aplicada.
- **E31 — Gateway.**
  - `supabase.ts`: `insertIgnoringDuplicates`.
  - `repository.ts`: `vaultConversationOwnedBy`, `insertVaultEvents`,
    `findVaultEvents`, `listVaultEventIds`, siempre con `owner_user_id`.
  - `handlers/vault.ts`: `handleVaultEventsPush`, `handleVaultEventsList` y
    `handleVaultEventsFetch`.
  - `index.ts`: las rutas.

  Pruebas, con un `db` falso que atraviesa `withVaultAuth`:
  - sin sesión: 401;
  - campo en claro, propósito ajeno o lote grande: 422;
  - conversación ajena: `rejected` y el insert no se llama;
  - clasificación de resultados;
  - la lista y la descarga filtran por dueño;
  - tabla inexistente: 503;
  - el insert lleva `on_conflict=event_id` y `resolution=ignore-duplicates`;
  - **contrato viejo**: los cuerpos de un Studio anterior en push, pull y lista
    dan la misma respuesta de hoy.

  Después, `cd apps/gateway` y `npm run dry-run`.
- **E32 — (Condicionado a E01) `insertVaultRecords`** pasa a
  `insertIgnoringDuplicates(..., 'conversation_id,sequence')` y deja de tragarse
  errores. Prueba con `fetch` falso.
  - Cambia el comportamiento ante un error real: ahora da 500, que es lo honesto.
  - Si E01 no lo confirma, no se toca.

### Fase D: cableado en main (después de E00)

- **E40 — Lectores y envío** (`handlers.ts`):
  - L1 a L12 pasan a `owner()` y `list()`, y se borran los envoltorios
    `@deprecated`;
  - el envío rechaza personaje o descripción en una conversación con registros;
  - el turno 0 completa la descripción y las instrucciones desde la ficha;
  - `removeTurnIfLast` más el `catch` del manejador;
  - se retira el avatar añadido si se retira el turno;
  - exclusión mutua entre envío y sincronización;
  - `vaultSync` pasa `isBusy`, invalida y hace `forgetFailure` y `poke`;
  - L12 excluye los medios de otro dueño.

  Pruebas nuevas en `apps/desktop/src/main/ipc/` (calcadas de
  `conversation-pending.test.ts`):
  - rechazo sin gastar;
  - nacimiento con ficha e instrucciones;
  - si `runLocalTurn` lanza, se retira el turno del usuario;
  - si después de escribir la respuesta algo lanza, **no** se retira nada;
  - bóveda cerrada tras un fallo: ningún registro bueno borrado;
  - avatar retirado;
  - `vaultSync` con descargas invalida y sin ellas no.
- **E41 — IPC de enganche**: `channels.ts`, `ipc.ts` (`.strict()`), `preload`, y
  los manejadores `vaultConversationOwnerPreview` y `vaultConversationOwnerSet`.
  Pruebas:
  - guardas (bóveda cerrada, envío en curso, conversación vacía, personaje
    inexistente);
  - no-op si ya es suyo;
  - instrucciones propias conservadas; al soltar se quitan solo las del enganche;
  - `invalidate` y `forgetFailure` llamados;
  - la subida en segundo plano no bloquea la respuesta y un fallo deja
    «falta subir»;
  - el log no lleva ids.

### Fase E: pantalla (después de E00)

- **E51 — `Vault.tsx`, `useVault.ts` y `vault-conversation-groups.ts`**:
  - el selector con estados, la firma por posición, los separadores y «Nueva
    con»;
  - la confirmación con `preview`;
  - el aviso de conflicto, el aviso por nombre con descarte y el nuevo
    `FORGOTTEN_LABEL`;
  - Sincronizar desactivado con `sending`;
  - desaparecen el campo del UUID y la carga asíncrona de instrucciones.

  Prueba real en Studio con una conversación **desechable**; no se da por
  verificada solo con pruebas.

### Fase F: R1 (después de E00 y E23)

- **E61 — Bloques del prompt** (`vault-prompt.ts`): `recientes-personaje` y
  `definicion-memoria`. Pruebas: llevan `MEMORY_NO_INVENTION` y la orden de no
  copiar; `measureVaultPrompt` los mide; sin entradas no aparecen; `job-runner`
  no recibe la definición.
- **E62 — Cableado y medidas** (`handlers.ts`): el bloque, M3, `ecoRecientes`,
  M1 y la vista previa M2. Pruebas: si falla, el turno sale sin bloque; el log
  lleva solo números.

### Fase G: documentación

- **E70 — Continuidad y reglas.**
  - `DECISIONS.md`:
    - **D-102**: el enganche es un evento inmutable y cifrado en una tabla
      aparte, de tamaño fijo, con rutas nuevas. Explica por qué no una columna,
      ni `/records`, ni un turno, ni un índice local;
    - **D-103**: el dueño se ordena por posición y no por reloj, los conflictos
      se avisan y el cursor de pendientes guarda con qué dueño se revisó.
  - `LOCAL-ACTIONS.md`: **LA-049** con E80-E84 y una autorización por paso.
  - `docs/CLOUDFLARE.md`: las rutas de `/api/vault`, que hoy no documenta.
  - `docs/SUPABASE.md`: la 0009.
  - `CLAUDE.md` **y** `AGENTS.md`: el registro nuevo y sus invariantes (solo
    anexar, cifrado, tamaño fijo).
  - La discrepancia de `CLAUDE.md` («no se han ejecutado nunca contra un
    Postgres real»), que `LA-031` contradice: la 0007 y la 0008 se aplicaron en
    producción el 01-02/09.
  - `TEST-RESULTS.md` con las salidas reales. `npm run check` en verde.

### Fase H: despliegue (solo Daniel, o con su autorización expresa en cada paso)

- **E80 — Ensayo de la 0009 fuera de producción.** El proyecto llamado
  `luxy-studio-test` **es producción** (`LA-015`), así que no sirve para ensayar.
  Dos opciones, y elige Daniel:
  - (a) crear un proyecto gratuito desechable y ejecutar allí 0001-0009 en orden.
    Sería la primera vez que la cadena entera corre en un Postgres limpio;
  - (b) en el SQL Editor de producción: `begin;`, el cuerpo de la 0009 sin su
    `begin`/`commit`, las consultas de verificación y `rollback;`. Después hay
    que comprobar que la tabla **no** existe. **HIPÓTESIS**: que el editor
    respete un `begin`/`rollback` explícito. Esta opción toca producción.
- **E81 — Aplicar la 0009 en producción.** Verificación:
  - `select tablename, rowsecurity from pg_tables where tablename = 'vault_conversation_events';` debe dar true;
  - `select relforcerowsecurity from pg_class where relname = 'vault_conversation_events';` debe dar true;
  - `select count(*) from pg_policies where tablename = 'vault_conversation_events';` debe dar 0;
  - `select has_table_privilege('anon','public.vault_conversation_events','select'), has_table_privilege('authenticated','public.vault_conversation_events','insert'), has_table_privilege('service_role','public.vault_conversation_events','update');` debe dar false, false y false.

  Estado intermedio: nadie usa la tabla, y se puede quedar así indefinidamente.
- **E82 — Desplegar el gateway.**
  - Solo desde un árbol **limpio** en el commit de la versión
    (`git status --porcelain` vacío), porque `deploy-gateway.bat` compila lo que
    haya en disco.
  - Antes, apuntar la versión actual: desde `apps\gateway`,
    `..\..\node_modules\.bin\wrangler.cmd deployments list --name luxy-gateway`.
  - `deploy-gateway.bat check` y después el despliegue.
  - Verificación sin secretos en la consola:
    - `/health` da 200;
    - `GET /api/vault/events` sin cabecera da **401** y no 404, lo que prueba que
      la ruta existe;
    - el Studio actual sincroniza con los mismos recuentos y sin «error no
      controlado» en `wrangler tail`.
- **E83 — Studio en el equipo A.** Primero con una conversación desechable:
  enganchar, sincronizar, soltar y sincronizar.
  - En el SQL Editor,
    `select conversation_id, octet_length(content::text) from public.vault_conversation_events;`
    debe dar tamaños **iguales** y ningún texto legible.
  - Después, la 3657a284.
- **E84 — Studio en el equipo B.** Sincronizar y comprobar que baja el enganche.
  - Si sale «Lía · no está en este equipo», los ids difieren: queda resuelta la
    hipótesis y se decide con Daniel qué hacer.
  - Es además la primera prueba real con dos equipos (cierra en parte
    `LA-033`).

---

## 11. Orden de despliegue y marcha atrás

Orden: **E81 → E82 → E83 → E84**, siempre en este sentido.

- Si el Worker va antes que la migración, las rutas dan 503 y Studio lo trata
  como «no soportado».
- Si Studio va antes que el Worker, el enganche se queda en local como «falta
  subir».

Ningún estado intermedio rompe nada.

| Paso | Marcha atrás |
| --- | --- |
| E81 (migración) | Mientras no haya eventos: `drop table if exists public.vault_conversation_events;` y `alter table public.vault_conversations drop constraint if exists vault_conversations_owner_pair_unique;`. Si ya hay eventos, **no** se borra: se corrige con una 0010. |
| E82 (gateway) | `..\..\node_modules\.bin\wrangler.cmd rollback <version-id> --name luxy-gateway -m "volver sin enganches"`. La tabla se queda. Studio nuevo verá 404 y guardará en local. **HIPÓTESIS**: que el rollback no toque los secretos del Worker. |
| E83/E84 (Studio) | Reconstruir desde el commit anterior. `conversation-events.json` se queda y el Studio viejo lo ignora. Las conversaciones enganchadas **solo por evento** vuelven a verse sin personaje en ese equipo; nada se pierde, y al volver a actualizar reaparecen. |

---

## 12. Riesgos

1. **Producción**: una migración que nunca se ha ejecutado tal cual y un
   despliegue del Worker. Pueden fallar en Postgres real el `do $$` con
   `pg_constraint`, la FK compuesta, el `CHECK` sobre `jsonb` y la cascada bajo
   `FORCE ROW LEVEL SECURITY` (**HIPÓTESIS**: la cascada de una FK no pasa por
   RLS). Si la cascada fallara, `handleVaultDelete` daría 500 en conversaciones
   con eventos. Por eso E80 va antes.
2. **La sincronización entre dos equipos no se ha probado nunca**
   (`TEST-RESULTS.md`, `LA-033`). «Llega a los dos ordenadores» descansa sobre un
   camino sin verificar hasta E84.
3. **`insertVaultRecords`** (**HIPÓTESIS fuerte**, sin ejecutar contra
   PostgREST): sin `Prefer: resolution` es un INSERT normal, así que un lote con
   un turno ya subido daría 409, y el `.catch(() => [])` lo convierte en «0
   almacenados». Si es cierto, los **turnos** nuevos no llegan al otro equipo
   aunque el enganche sí. Se confirma con E01 y se arregla con E32.
4. **Personajes con otro id** en el otro equipo: el enganche llega, pero no
   agrupa con su Lía, y no hay imágenes. Hay que decidirlo aparte (sincronizar
   personajes).
5. **Metadato nuevo** para el servidor: cuántos cambios de dueño tuvo cada
   conversación y cuándo. Es aceptado por la decisión de Daniel y hay que
   decírselo.
6. **Desempate arbitrario** entre dos cambios concurrentes. Es determinista y se
   avisa siempre, pero no elige «el último de verdad».
7. **El servidor puede omitir eventos**: retrasa, no revierte, y se detecta solo
   si otro evento cita al que falta.
8. **Coste de `owner()` en `list()`** (**HIPÓTESIS**, sin medir): leer eventos es
   barato, pero descifrar hacia atrás las instrucciones puede recorrer media
   conversación. Si pesa, se añade una caché por (conversación, último
   `recordId`, versión del almacén de eventos).
9. **Tras enganchar**, las promesas antiguas de Lía en esa conversación quedan
   bloqueadas por desfase hasta que termine la relectura, y en el otro equipo
   hasta su siguiente pasada. Es el lado seguro de `D-088`, pero se nota.
10. **Cambio de comportamiento en datos antiguos**: las conversaciones que hoy
    reciben la ficha de un personaje ya soltado dejarán de recibirla, y el envío
    rechazará cambiar el personaje en una conversación existente. Hay que
    cambiar main y el renderer a la vez (E40 y E51).
11. **R1**: puede no llevar lo acordado si el modelo lo apuntó en `plan`
    (**HIPÓTESIS**, lo mide M1). El blanqueo no está medido (lo mide
    `ecoRecientes`). Puede diferir entre equipos cuando la fuente es una ficha
    retroactiva, que es local.
12. **Aviso**: quedan falsos negativos aceptados («la Lía», con artículo) y
    falsos positivos con nombres fuera de la lista. El descarte puede reaparecer
    tras reiniciar.
13. **Topes previos**: el push de turnos admite 200 registros (`vault.ts`,
    `vaultSyncPushRequestSchema`). Una conversación más larga no sincroniza
    entera. No lo causa este cambio, pero afecta a «llega a los dos».
14. **Secuencias en colisión**: si dos equipos escriben la misma secuencia de
    turno antes de sincronizar, el servidor se queda con la primera
    (`sync.ts:14-18`), y el `anchorSequence` de un evento puede referirse a un
    turno distinto en cada equipo. Es previo a este cambio, y la regla sigue
    siendo determinista.

---

## 13. La puerta del cuaderno (R2), abierta y sin diseñar

- El protocolo se reutiliza tal cual en una tabla hermana
  `vault_character_events`: eventos inmutables, sellados, de tamaño fijo, con
  orden dentro del sobre y conflictos avisados.
- Como los `characterId` son locales, necesitará un id opaco de personaje que
  viaje. Es la misma pieza que haría falta para sincronizar personajes (§7.4), y
  conviene diseñarlas juntas.
- `kind` en el evento de conversación admite tipos nuevos sin migración (por
  ejemplo, el olvido global de memoria que `D-099` dejó descrito).
- Requisitos previos, según el diseño anterior: R1 funcionando y el paso 0 de
  `ROLEPLAY-EVOLUCION` §1.5.
