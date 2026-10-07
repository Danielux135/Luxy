// contrato v2 de la sincronizacion de la boveda (SYNC-F1-01, D-110).
//
// Por que un v2 y no un arreglo del v1: el v1 nunca funciono (SEG-SYNC-001) y
// sus tres fallos estaban en el propio contrato. El cliente exigia fechas en
// «Z» y Postgres las devuelve con «+00:00»; la subida se tragaba el 409 de un
// duplicado y respondia 200 con cero guardados, asi que desde la segunda vez
// no subia nada sin avisar; y el tope era de 200 registros sin paginar. El
// gateway cierra las rutas v1 con 426 ANTES de autenticar: ningun Studio viejo
// puede escribir con aquellas reglas ni resucitar lo que se borre.
//
// Lo que fija este archivo, compartido por el gateway y por Studio:
//  - el rango de los turnos, [0, VAULT_FACT_SEQUENCE_BASE). Lo de arriba queda
//    reservado para los hechos de F2: ninguna ruta de turnos lo acepta ni lo
//    devuelve, para que F2 encaje sin migracion;
//  - las fechas: se SUBEN en forma canonica (la de toISOString) y se BAJAN
//    como las escribe Postgres, normalizadas aqui a esa misma cadena. La
//    atadura exacta de D-108 compara createdAt byte a byte;
//  - los topes, en registros y en BYTES, que el gateway mira antes de leer;
//  - la forma exacta de cada peticion y de cada respuesta.
//
// Nada de esto cifra ni descifra: describe la forma de lo que viaja.
import { z } from 'zod';
import { privateMediaSchema, sealedEnvelopeSchema, VAULT_MAX_OBJECT_BYTES } from './vault.js';

/** version del protocolo que habla este contrato. capabilities la anuncia */
export const VAULT_SYNC_PROTOCOL = 2 as const;

/**
 * primera secuencia reservada a los hechos de F2.
 *
 * Los turnos viven por debajo; los hechos, en un «espacio» y de aqui hacia
 * arriba. La columna es int4 (llega a 2.147.483.647) con un unique por
 * (conversacion, secuencia): reservar un rango evita una migracion.
 */
export const VAULT_FACT_SEQUENCE_BASE = 1_000_000_000;

/**
 * «Max rows» de PostgREST en un proyecto de Supabase, el valor por defecto.
 *
 * PostgREST recorta EN SILENCIO cualquier lectura a min(limit, max-rows) y
 * responde 200 igual, sin decir que habia mas. Con un manifiesto de 2000 por
 * pagina, una conversacion de mas de 1000 turnos llegaba con 1000 y el cliente
 * la daba por entera (revision F1-R1-02). Ningun tope de pagina del contrato
 * puede pasar de aqui; una prueba lo ata. Si un dia se sube «Max rows» en
 * Supabase, esto no se toca: el cliente sigue pidiendo hasta una pagina vacia.
 */
export const VAULT_POSTGREST_MAX_ROWS = 1000;

/**
 * topes del protocolo.
 *
 * Por BYTES y no solo por numero: un turno con una memoria larga puede pesar
 * cien veces otro, y lo que cuesta CPU en el Worker es analizar el cuerpo. Un
 * lote de varios registros cabe en 512 KiB; un registro suelto, hasta 4 MiB,
 * para que un turno enorme viaje solo en vez de no viajar nunca.
 *
 * Las paginas de lectura no pasan de VAULT_POSTGREST_MAX_ROWS.
 */
export const VAULT_SYNC_V2_LIMITS = {
  pushMaxRecords: 40,
  pushMaxBytes: 512 * 1024,
  pushSingleRecordMaxBytes: 4 * 1024 * 1024,
  fetchMaxSequences: 100,
  manifestMaxPage: VAULT_POSTGREST_MAX_ROWS,
  conversationsMaxPage: 500,
  mediaMaxPage: 500,
  mediaPushMaxBytes: 1024 * 1024,
  /** listas, manifiesto, descarga por secuencias y purga: cuerpos pequeños */
  smallRequestMaxBytes: 16 * 1024,
  /** medios cuyos objetos borra cada llamada a la purga (≤ 2 objetos cada uno) */
  purgeBatchMedia: 20,
  objectMaxBytes: VAULT_MAX_OBJECT_BYTES,
} as const;

/** rutas del protocolo v2. Los ids viajan en el CUERPO, nunca en la URL */
export const VAULT_SYNC_V2_PATHS = {
  capabilities: '/api/vault/v2/capabilities',
  conversationsList: '/api/vault/v2/conversations/list',
  manifest: '/api/vault/v2/conversations/manifest',
  recordsFetch: '/api/vault/v2/records/fetch',
  recordsPush: '/api/vault/v2/records/push',
  mediaList: '/api/vault/v2/media/list',
  mediaPush: '/api/vault/v2/media/push',
  purge: '/api/vault/v2/conversations/purge',
} as const;

/** cuanto puede pesar el cuerpo de una subida de turnos con `count` registros */
export function vaultV2PushBodyLimit(count: number): number {
  return count > 1
    ? VAULT_SYNC_V2_LIMITS.pushMaxBytes
    : VAULT_SYNC_V2_LIMITS.pushSingleRecordMaxBytes;
}

/**
 * cursor de la pagina siguiente, o null si esta era la ultima.
 *
 * La ultima es la VACIA, no la incompleta. Las lecturas devuelven el cuerpo de
 * Supabase sin tocarlo, asi que el servidor no añade «hay mas», y una pagina
 * corta no prueba que no haya mas: PostgREST recorta a su «Max rows» sin
 * avisar, aunque el gateway haya aceptado un limite mayor. Dar por terminada la
 * primera pagina corta dejaba sin ver lo que hubiera detras (revision
 * F1-R1-02). Cuesta una peticion mas por lista, a cambio de no depender de
 * ningun ajuste del servidor.
 */
export function vaultV2NextCursor<T, C>(rows: readonly T[], cursorOf: (row: T) => C): C | null {
  const last = rows[rows.length - 1];
  return last === undefined ? null : cursorOf(last);
}

// -----------------------------------------------------------------------------
// piezas
// -----------------------------------------------------------------------------

/**
 * uuid en minusculas.
 *
 * Postgres guarda y devuelve los uuid en minusculas. Si un cliente subiera uno
 * en mayusculas, el servidor le devolveria otra cadena y el cliente veria una
 * conversacion «en dos versiones» que no lo esta. Se exige la forma que vuelve.
 */
export const canonicalUuidSchema = z
  .string()
  .uuid()
  .regex(/^[0-9a-f-]{36}$/, 'el identificador debe ir en minusculas');

/**
 * fecha para SUBIR: exactamente la cadena de toISOString.
 *
 * Asi lo que baja, normalizado, es byte a byte lo que subio. D-108 ata la
 * memoria reescrita a la secuencia y al createdAt exactos: una fecha que
 * cambiara de forma en el viaje rompia esa atadura en el otro equipo.
 */
export const canonicalIsoSchema = z
  .string()
  .datetime()
  // zod ejecuta el refine aunque datetime() ya haya fallado: sin mirar antes
  // que es una fecha, toISOString lanzaria en vez de rechazar
  .refine((value) => isInstant(value) && value === new Date(value).toISOString(), {
    message: 'la fecha debe ir en forma canonica (toISOString, con milisegundos y Z)',
  });

function isInstant(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

/**
 * fecha para BAJAR: la de Postgres, normalizada.
 *
 * Postgres escribe «+00:00» y recorta los ceros de la fraccion
 * («.07+00:00», o sin fraccion). Como todo lo sube un cliente en milisegundos,
 * toISOString devuelve la cadena original exacta.
 */
export const serverIsoSchema = z
  .string()
  .datetime({ offset: true })
  .refine(isInstant, { message: 'la fecha del servidor no es un instante valido' })
  .transform((value) => new Date(value).toISOString());

/** secuencia de un turno: nunca en el rango reservado a los hechos */
export const turnSequenceSchema = z
  .number()
  .int()
  .min(0)
  .max(VAULT_FACT_SEQUENCE_BASE - 1);

/** sobre de un turno: solo el proposito de turno, ningun otro */
export const turnContentEnvelopeSchema = sealedEnvelopeSchema.extend({
  purpose: z.literal('vault.conversation'),
});

/** sobre de la memoria de un turno */
export const turnMemoryEnvelopeSchema = sealedEnvelopeSchema.extend({
  purpose: z.literal('vault.memory'),
});

/** sobre de los metadatos de un medio. 'vault.fact' llegara con F2, en el espacio */
export const mediaContentEnvelopeSchema = sealedEnvelopeSchema.extend({
  purpose: z.literal('vault.media'),
});

const pageLimit = (max: number) => z.number().int().min(1).max(max).default(max);

// -----------------------------------------------------------------------------
// capacidades
// -----------------------------------------------------------------------------

export const vaultSyncV2LimitsSchema = z.object({
  pushMaxRecords: z.number().int().positive(),
  pushMaxBytes: z.number().int().positive(),
  pushSingleRecordMaxBytes: z.number().int().positive(),
  fetchMaxSequences: z.number().int().positive(),
  manifestMaxPage: z.number().int().positive(),
  conversationsMaxPage: z.number().int().positive(),
  mediaMaxPage: z.number().int().positive(),
  mediaPushMaxBytes: z.number().int().positive(),
  smallRequestMaxBytes: z.number().int().positive(),
  purgeBatchMedia: z.number().int().positive(),
  objectMaxBytes: z.number().int().positive(),
});
export type VaultSyncV2Limits = z.infer<typeof vaultSyncV2LimitsSchema>;

/**
 * GET capabilities.
 *
 * `protocol` es un literal: un gateway que un dia hable otra cosa debe hacer
 * que este Studio se niegue a sincronizar, no que lo intente con reglas que no
 * conoce. `sessionExpiresAt` es la caducidad YA renovada, para que Studio la
 * guarde.
 */
export const vaultSyncV2CapabilitiesSchema = z.object({
  protocol: z.literal(VAULT_SYNC_PROTOCOL),
  facts: z.boolean(),
  limits: vaultSyncV2LimitsSchema,
  sessionExpiresAt: serverIsoSchema,
});
export type VaultSyncV2Capabilities = z.infer<typeof vaultSyncV2CapabilitiesSchema>;

// -----------------------------------------------------------------------------
// lista de conversaciones
// -----------------------------------------------------------------------------

export const vaultV2ConversationListRequestSchema = z
  .object({
    /** ultima conversacion de la pagina anterior; null para empezar */
    after: canonicalUuidSchema.nullable().default(null),
    limit: pageLimit(VAULT_SYNC_V2_LIMITS.conversationsMaxPage),
  })
  .strict();
export type VaultV2ConversationListRequest = z.input<typeof vaultV2ConversationListRequestSchema>;

export const vaultV2ConversationEntrySchema = z.object({
  conversationId: canonicalUuidSchema,
  /** lo cuenta un trigger; en un espacio de F2 contara tambien los hechos */
  turnCount: z.number().int().min(0),
  updatedAt: serverIsoSchema,
});
export type VaultV2ConversationEntry = z.infer<typeof vaultV2ConversationEntrySchema>;

/** ordenada por conversationId ascendente. Pagina siguiente: vaultV2NextCursor */
export const vaultV2ConversationListResponseSchema = z.array(vaultV2ConversationEntrySchema);

// -----------------------------------------------------------------------------
// manifiesto
// -----------------------------------------------------------------------------

export const vaultV2ManifestRequestSchema = z
  .object({
    conversationId: canonicalUuidSchema,
    /** ultima secuencia de la pagina anterior; -1 para empezar */
    after: z
      .number()
      .int()
      .min(-1)
      .max(VAULT_FACT_SEQUENCE_BASE - 1)
      .default(-1),
    limit: pageLimit(VAULT_SYNC_V2_LIMITS.manifestMaxPage),
  })
  .strict();
export type VaultV2ManifestRequest = z.input<typeof vaultV2ManifestRequestSchema>;

export const vaultV2ManifestEntrySchema = z.object({
  sequence: turnSequenceSchema,
  recordId: canonicalUuidSchema,
});
export type VaultV2ManifestEntry = z.infer<typeof vaultV2ManifestEntrySchema>;

/** ordenado por secuencia ascendente, solo turnos (< VAULT_FACT_SEQUENCE_BASE) */
export const vaultV2ManifestResponseSchema = z.array(vaultV2ManifestEntrySchema);

// -----------------------------------------------------------------------------
// bajar registros por secuencias concretas
// -----------------------------------------------------------------------------

export const vaultV2RecordsFetchRequestSchema = z
  .object({
    conversationId: canonicalUuidSchema,
    sequences: z.array(turnSequenceSchema).min(1).max(VAULT_SYNC_V2_LIMITS.fetchMaxSequences),
  })
  .strict()
  .refine((value) => new Set(value.sequences).size === value.sequences.length, {
    message: 'una secuencia repetida',
    path: ['sequences'],
  });
export type VaultV2RecordsFetchRequest = z.input<typeof vaultV2RecordsFetchRequestSchema>;

/**
 * un turno tal como baja.
 *
 * PostgREST no puede devolver una constante, asi que `privacy` lo pone esta
 * transformacion: el resultado es un PrivateRecord listo para verificar y
 * guardar. La fecha sale normalizada. El cliente debe comprobar aun que
 * `conversationId` es la que pidio: el esquema no la conoce.
 */
export const vaultV2RemoteRecordSchema = z
  .object({
    recordId: canonicalUuidSchema,
    conversationId: canonicalUuidSchema,
    sequence: turnSequenceSchema,
    content: turnContentEnvelopeSchema,
    sealedMemory: turnMemoryEnvelopeSchema.nullable(),
    createdAt: serverIsoSchema,
  })
  .transform((row) => ({ ...row, privacy: 'private' as const }));
export type VaultV2RemoteRecord = z.infer<typeof vaultV2RemoteRecordSchema>;

/** ordenado por secuencia ascendente; falta lo que el servidor no tiene */
export const vaultV2RecordsFetchResponseSchema = z.array(vaultV2RemoteRecordSchema);

// -----------------------------------------------------------------------------
// subir turnos
// -----------------------------------------------------------------------------

/** un turno tal como sube: la forma exacta, sin campos de mas */
export const vaultV2PushRecordSchema = z
  .object({
    recordId: canonicalUuidSchema,
    conversationId: canonicalUuidSchema,
    privacy: z.literal('private'),
    sequence: turnSequenceSchema,
    content: turnContentEnvelopeSchema,
    sealedMemory: turnMemoryEnvelopeSchema.nullable().default(null),
    createdAt: canonicalIsoSchema,
  })
  .strict();
export type VaultV2PushRecord = z.output<typeof vaultV2PushRecordSchema>;

/** el registro del servidor que precede al lote, segun el manifiesto */
export const vaultV2RecordRefSchema = z
  .object({
    sequence: turnSequenceSchema,
    recordId: canonicalUuidSchema,
  })
  .strict();
export type VaultV2RecordRef = z.infer<typeof vaultV2RecordRefSchema>;

/**
 * POST records/push.
 *
 * `base` es el ultimo registro del servidor ANTERIOR al primero del lote, o
 * null si no hay ninguno. Si no casa, el servidor cambio desde el manifiesto y
 * el lote no se mira. Una conversacion que no existe solo se crea con base
 * null: un equipo desfasado no resucita una conversacion purgada.
 *
 * El lote va ordenado por secuencia, sin repetidos, todo de la misma
 * conversacion. Las secuencias pueden saltar: rellenar un hueco es legitimo.
 */
export const vaultV2PushRequestSchema = z
  .object({
    conversationId: canonicalUuidSchema,
    base: vaultV2RecordRefSchema.nullable(),
    records: z.array(vaultV2PushRecordSchema).min(1).max(VAULT_SYNC_V2_LIMITS.pushMaxRecords),
  })
  .strict()
  .superRefine((value, ctx) => {
    const ids = new Set<string>();
    let previous = value.base === null ? -1 : value.base.sequence;
    value.records.forEach((record, index) => {
      if (record.conversationId !== value.conversationId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'un registro no pertenece a la conversacion del lote',
          path: ['records', index, 'conversationId'],
        });
      }
      // estrictamente creciente: ordena y prohibe repetidos de una vez. La
      // base tambien tiene que ir delante: es la que PRECEDE al lote
      if (record.sequence <= previous) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'las secuencias deben ir en orden creciente, sin repetirse y despues de la base',
          path: ['records', index, 'sequence'],
        });
      }
      previous = record.sequence;
      if (ids.has(record.recordId) || record.recordId === value.base?.recordId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'un identificador de registro repetido',
          path: ['records', index, 'recordId'],
        });
      }
      ids.add(record.recordId);
    });
  });
export type VaultV2PushRequest = z.input<typeof vaultV2PushRequestSchema>;

export const VAULT_V2_RECORD_OUTCOMES = ['stored', 'duplicate', 'conflict', 'pending'] as const;
export type VaultV2RecordOutcome = (typeof VAULT_V2_RECORD_OUTCOMES)[number];

export const vaultV2RecordResultSchema = z.object({
  recordId: canonicalUuidSchema,
  sequence: turnSequenceSchema,
  outcome: z.enum(VAULT_V2_RECORD_OUTCOMES),
});
export type VaultV2RecordResult = z.infer<typeof vaultV2RecordResultSchema>;

/** 200: entro el lote entero */
export const vaultV2PushStoredResponseSchema = z.object({
  results: z.array(vaultV2RecordResultSchema.extend({ outcome: z.literal('stored') })),
});

/**
 * 409: no entro NADA del lote, y aqui esta por que.
 *
 * - `records`: el INSERT choco. Cada registro dice si ya estaba igual
 *   (`duplicate`: mismo recordId en la misma secuencia), si su secuencia la
 *   ocupa otro o su recordId esta en otro sitio (`conflict`), o si habria
 *   entrado (`pending`). Un conflict es una conversacion en dos versiones.
 * - `base-mismatch`: el servidor cambio desde el manifiesto; hay que releerlo.
 * - `conversation-missing`: base no era null y la conversacion no existe (o
 *   desaparecio mientras tanto). No se crea.
 * - `space`: esa conversacion guarda hechos (F2); los turnos no van ahi.
 */
export const vaultV2PushRejectedResponseSchema = z.discriminatedUnion('reason', [
  z.object({
    error: z.string(),
    reason: z.literal('records'),
    results: z.array(
      vaultV2RecordResultSchema.extend({ outcome: z.enum(['duplicate', 'conflict', 'pending']) }),
    ),
  }),
  z.object({ error: z.string(), reason: z.literal('base-mismatch') }),
  z.object({ error: z.string(), reason: z.literal('conversation-missing') }),
  z.object({ error: z.string(), reason: z.literal('space') }),
]);
export type VaultV2PushRejectedResponse = z.infer<typeof vaultV2PushRejectedResponseSchema>;

// -----------------------------------------------------------------------------
// medios
// -----------------------------------------------------------------------------

export const vaultV2MediaListRequestSchema = z
  .object({
    /** ultimo mediaId de la pagina anterior; null para empezar */
    after: canonicalUuidSchema.nullable().default(null),
    limit: pageLimit(VAULT_SYNC_V2_LIMITS.mediaMaxPage),
  })
  .strict();
export type VaultV2MediaListRequest = z.input<typeof vaultV2MediaListRequestSchema>;

/** un medio tal como baja, con la fecha normalizada */
export const vaultV2RemoteMediaSchema = z.object({
  mediaId: canonicalUuidSchema,
  conversationId: canonicalUuidSchema,
  objectKey: z.string().regex(/^[0-9a-f]{32}$/),
  byteSize: z.number().int().min(1),
  content: mediaContentEnvelopeSchema,
  thumbnailObjectKey: z
    .string()
    .regex(/^[0-9a-f]{32}$/)
    .nullable(),
  createdAt: serverIsoSchema,
});
export type VaultV2RemoteMedia = z.infer<typeof vaultV2RemoteMediaSchema>;

/** ordenada por mediaId ascendente. Pagina siguiente: vaultV2NextCursor */
export const vaultV2MediaListResponseSchema = z.array(vaultV2RemoteMediaSchema);

/**
 * POST media/push: el registro de un medio cuyos bytes ya estan subidos.
 *
 * Los bytes van antes, por PUT /api/vault/media/objects/:objectKey, el
 * original y la miniatura (D-050). La conversacion tiene que existir ya: este
 * alta no la crea, igual que los turnos con base, para que un medio rezagado
 * no resucite una conversacion purgada.
 */
export const vaultV2MediaPushRequestSchema = z
  .object({
    media: privateMediaSchema
      .extend({
        mediaId: canonicalUuidSchema,
        conversationId: canonicalUuidSchema,
        byteSize: z.number().int().min(1).max(VAULT_MAX_OBJECT_BYTES),
        content: mediaContentEnvelopeSchema,
        createdAt: canonicalIsoSchema,
      })
      .strict()
      .refine((media) => media.thumbnailObjectKey !== media.objectKey, {
        message: 'la miniatura no puede ser el mismo objeto que el original',
        path: ['thumbnailObjectKey'],
      }),
  })
  .strict();
export type VaultV2MediaPushRequest = z.input<typeof vaultV2MediaPushRequestSchema>;

/** 200: `stored` si es nuevo, `duplicate` si ya estaba ese mismo medio */
export const vaultV2MediaPushResponseSchema = z.object({
  outcome: z.enum(['stored', 'duplicate']),
});

/**
 * 409 del alta de un medio. No se guardo nada.
 *
 * - `object-missing`: faltan los bytes del original o de la miniatura;
 * - `conversation-missing`: la conversacion no existe todavia; se reintenta
 *   cuando hayan subido sus turnos;
 * - `space`: es un espacio de hechos; un 'vault.media' no va ahi;
 * - `conflict`: esa clave de objeto la usa otro medio, o ese mediaId otra clave.
 */
export const vaultV2MediaPushRejectedResponseSchema = z.object({
  error: z.string(),
  reason: z.enum(['object-missing', 'conversation-missing', 'space', 'conflict']),
});

// -----------------------------------------------------------------------------
// purga
// -----------------------------------------------------------------------------

/**
 * POST conversations/purge, por tandas (la usara F2).
 *
 * Cada llamada borra del almacen los objetos de como mucho purgeBatchMedia
 * medios, a partir de `after`, y devuelve el cursor. La ultima borra la fila de
 * la conversacion y con ella, en cascada, sus turnos y sus medios. Reanudable e
 * idempotente: purgar algo que ya no existe responde done.
 */
export const vaultV2PurgeRequestSchema = z
  .object({
    conversationId: canonicalUuidSchema,
    after: canonicalUuidSchema.nullable().default(null),
  })
  .strict();
export type VaultV2PurgeRequest = z.input<typeof vaultV2PurgeRequestSchema>;

export const vaultV2PurgeResponseSchema = z.object({
  done: z.boolean(),
  /** cursor para la llamada siguiente; null cuando done */
  after: canonicalUuidSchema.nullable(),
  deletedObjects: z.number().int().min(0),
});
export type VaultV2PurgeResponse = z.infer<typeof vaultV2PurgeResponseSchema>;

/** 409 de la purga: un espacio de hechos no se purga como una conversacion */
export const vaultV2PurgeRejectedResponseSchema = z.object({
  error: z.string(),
  reason: z.literal('space'),
});

/** cualquier respuesta que no es 2xx lleva al menos esto */
export const vaultV2ErrorResponseSchema = z.object({ error: z.string() });
