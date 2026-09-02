// contrato de la boveda privada.
//
// Aqui vive la FORMA de lo que viaja, no la criptografia, que esta en
// @luxy/vault-crypto. La separacion es deliberada: este paquete lo importan el
// gateway y el renderer, y ninguno de los dos debe poder cifrar ni descifrar.
// El gateway valida que un registro privado tiene la forma correcta y lo
// almacena; nunca puede leerlo.
import { z } from 'zod';

/**
 * nivel de privacidad de una conversacion.
 *
 * `cloud`: como hasta ahora. El gateway lee prompt, respuesta y titulo.
 * `private`: el gateway solo recibe texto cifrado. No hay estado intermedio,
 *   porque "medio privado" siempre acaba significando "en claro en algun sitio".
 */
export const CONVERSATION_PRIVACY = ['cloud', 'private'] as const;
export type ConversationPrivacy = (typeof CONVERSATION_PRIVACY)[number];
export const conversationPrivacySchema = z.enum(CONVERSATION_PRIVACY);

/**
 * propositos de sobre reconocidos.
 *
 * lista cerrada a proposito: un proposito arbitrario que llegase del exterior
 * podria usarse para que un dato de un dominio se acepte en otro.
 */
export const VAULT_PURPOSES = [
  'vault.index',
  'vault.conversation',
  'vault.memory',
  'vault.media',
  'vault.thumbnail',
  'vault.masterkey.password',
  'vault.masterkey.recovery',
  'vault.masterkey.device',
  'vault.share.key',
] as const;
export type VaultPurpose = (typeof VAULT_PURPOSES)[number];

/** base64url sin relleno: es como viaja todo el material binario */
const base64UrlSchema = z
  .string()
  .max(16_000_000)
  .regex(/^[A-Za-z0-9_-]*$/, 'el valor debe estar en base64url sin relleno');

/**
 * un sobre sellado, tal y como se persiste.
 *
 * debe coincidir byte a byte con `SealedEnvelope` de @luxy/vault-crypto. Una
 * prueba lo verifica sellando de verdad y validando el resultado aqui: si las
 * dos definiciones se separan, falla.
 */
export const sealedEnvelopeSchema = z.object({
  version: z.number().int().min(1).max(255),
  purpose: z.enum(VAULT_PURPOSES),
  // nonce de 96 bits -> 16 caracteres en base64url
  nonce: base64UrlSchema.length(16),
  ciphertext: base64UrlSchema.min(1),
});
export type SealedEnvelopeRecord = z.infer<typeof sealedEnvelopeSchema>;

/** parametros de Argon2id, guardados con cada envoltura (ver D-040) */
export const argon2ParamsSchema = z.object({
  t: z.number().int().min(1).max(16),
  // entre 8 MiB y 2 GiB, en KiB. El tope evita que una envoltura manipulada
  // pida memoria absurda y tumbe el proceso al intentar abrirla.
  m: z.number().int().min(8 * 1024).max(2 * 1024 * 1024),
  p: z.number().int().min(1).max(4),
});

export const WRAP_METHODS = ['password', 'recovery', 'device'] as const;
export type WrapMethodName = (typeof WRAP_METHODS)[number];

/**
 * una envoltura de la llave maestra.
 *
 * `salt` y `params` son nulos solo en el metodo `device`, donde no hay
 * contraseña que derivar. El refinamiento de abajo impide guardar una envoltura
 * incoherente, como una de contraseña sin sal.
 */
export const keyWrapSchema = z
  .object({
    method: z.enum(WRAP_METHODS),
    salt: base64UrlSchema.length(22).nullable(),
    params: argon2ParamsSchema.nullable(),
    envelope: sealedEnvelopeSchema,
    createdAt: z.string().datetime(),
  })
  .refine(
    (wrap) =>
      wrap.method === 'device'
        ? wrap.salt === null && wrap.params === null
        : wrap.salt !== null && wrap.params !== null,
    { message: 'la envoltura no corresponde a su metodo' },
  );
export type KeyWrapRecord = z.infer<typeof keyWrapSchema>;

/** clave publica X25519 en base64url: 32 bytes -> 43 caracteres */
export const vaultPublicKeySchema = base64UrlSchema.length(43);

/** una llave envuelta para otra persona */
export const sealedForRecipientSchema = z.object({
  ephemeralPublicKey: vaultPublicKeySchema,
  recipientPublicKey: vaultPublicKeySchema,
  envelope: sealedEnvelopeSchema,
});
export type SealedForRecipientRecord = z.infer<typeof sealedForRecipientSchema>;

/**
 * lo que el gateway recibe de una conversacion privada.
 *
 * Fijate en lo que NO esta: titulo, prompt, respuesta, memoria, nombres de
 * archivo, recuento de tokens. Nada de eso tiene un campo donde encajar, asi
 * que no es que se prometa no enviarlo: no hay por donde.
 *
 * Lo que si viaja, y hay que asumirlo como metadato visible: que existe una
 * conversacion, a que maquina pertenece, cuando se toco y cuanto ocupa.
 */
export const privateRecordSchema = z.object({
  /** identificador opaco. no se deriva del titulo ni del contenido */
  recordId: z.string().uuid(),
  conversationId: z.string().uuid(),
  privacy: z.literal('private'),
  /** orden dentro de la conversacion, para reconstruirla sin descifrar */
  sequence: z.number().int().min(0),
  content: sealedEnvelopeSchema,
  /**
   * sobre aparte: la memoria se descifra sin traer todo el turno.
   *
   * se llama `sealedMemory` y no `memory` para que el nombre diga que va
   * cifrado. Un campo llamado `memory` en un registro privado invita a que
   * alguien le meta texto en claro dentro de seis meses.
   */
  sealedMemory: sealedEnvelopeSchema.nullable().default(null),
  createdAt: z.string().datetime(),
});
export type PrivateRecord = z.infer<typeof privateRecordSchema>;

/**
 * un medio guardado (imagen, video, miniatura).
 *
 * los bytes no viajan por aqui: van al almacen de objetos ya cifrados. Este
 * registro solo dice donde estan y como abrirlos.
 *
 * `mimeType` se guarda cifrado dentro de `content`, no en claro: saber que una
 * conversacion tiene 40 archivos `video/mp4` ya dice bastante.
 */
export const privateMediaSchema = z.object({
  mediaId: z.string().uuid(),
  conversationId: z.string().uuid(),
  /** clave opaca en el almacen de objetos. sin extension ni nombre legible */
  objectKey: z.string().regex(/^[0-9a-f]{32}$/, 'la clave del objeto debe ser opaca'),
  /** bytes del objeto cifrado, para cuotas y limpieza */
  byteSize: z.number().int().min(1),
  /** metadatos del medio, cifrados: tipo, dimensiones, duracion, prompt */
  content: sealedEnvelopeSchema,
  thumbnailObjectKey: z
    .string()
    .regex(/^[0-9a-f]{32}$/)
    .nullable()
    .default(null),
  createdAt: z.string().datetime(),
});
export type PrivateMedia = z.infer<typeof privateMediaSchema>;

/**
 * puente de Telegram para una conversacion concreta.
 *
 * Telegram no puede leer texto cifrado: cualquier mensaje que llegue al
 * telefono ha pasado en claro por el gateway y esta en los servidores de
 * Telegram. Por eso esto es explicito, por conversacion, y apagado por defecto.
 *
 * `acknowledgedAt` guarda cuando el usuario confirmo entender eso. Sin esa
 * confirmacion el puente no se activa.
 */
export const telegramBridgeSchema = z.object({
  enabled: z.boolean().default(false),
  acknowledgedAt: z.string().datetime().nullable().default(null),
  enabledAt: z.string().datetime().nullable().default(null),
});
export type TelegramBridge = z.infer<typeof telegramBridgeSchema>;

export const SHARE_STATES = ['pending', 'active', 'revoked'] as const;
export type ShareState = (typeof SHARE_STATES)[number];

/**
 * invitacion a ver conversaciones concretas.
 *
 * `pending` no es un detalle burocratico: no se puede cifrar para alguien cuya
 * clave publica todavia no existe. La invitacion se queda esperando hasta que
 * el invitado acepta y publica la suya, y solo entonces quien comparte puede
 * cerrar el sobre. La interfaz debe explicarlo, no presentarlo como un fallo.
 */
export const shareInviteSchema = z.object({
  inviteId: z.string().uuid(),
  email: z.string().email().max(320),
  state: z.enum(SHARE_STATES),
  /** null mientras el invitado no haya aceptado */
  recipientPublicKey: vaultPublicKeySchema.nullable().default(null),
  createdAt: z.string().datetime(),
  acceptedAt: z.string().datetime().nullable().default(null),
  revokedAt: z.string().datetime().nullable().default(null),
});
export type ShareInvite = z.infer<typeof shareInviteSchema>;

/**
 * permiso sobre UNA conversacion.
 *
 * el permiso es por conversacion y nunca por defecto: compartir es siempre un
 * acto explicito sobre un elemento concreto. `wrappedKey` es la subclave de esa
 * conversacion envuelta para el invitado; el gateway la transporta sin poder
 * abrirla.
 */
export const shareGrantSchema = z.object({
  grantId: z.string().uuid(),
  inviteId: z.string().uuid(),
  conversationId: z.string().uuid(),
  state: z.enum(SHARE_STATES),
  wrappedKey: sealedForRecipientSchema,
  createdAt: z.string().datetime(),
  revokedAt: z.string().datetime().nullable().default(null),
});
export type ShareGrant = z.infer<typeof shareGrantSchema>;

/**
 * campos que jamas pueden viajar en claro en una conversacion privada.
 *
 * Existe porque una regla escrita en un documento se rompe sola con el tiempo.
 * Esta se puede ejecutar, y la ejecutan tanto el escritorio antes de enviar
 * como el gateway antes de aceptar: si un campo prohibido aparece, se rechaza
 * el registro entero en vez de guardarlo "solo esta vez".
 */
export const FORBIDDEN_PLAINTEXT_FIELDS = [
  'prompt',
  'title',
  'conversationTitle',
  'conversationUserMessage',
  'resultSummary',
  'memory',
  'caption',
  'fileName',
  'mimeType',
  'outputUrl',
  'characterId',
  'characterName',
] as const;

/** true si el valor tiene la forma de un sobre ya sellado */
function isSealedEnvelope(value: unknown): boolean {
  return sealedEnvelopeSchema.safeParse(value).success;
}

/**
 * comprueba que un objeto destinado al gateway no lleva contenido en claro.
 *
 * devuelve los campos ofensivos en vez de un booleano para que el error diga
 * cual es el problema. Recorre en profundidad: esconder el titulo dentro de un
 * objeto anidado seguiria siendo enviarlo.
 */
export function findPlaintextLeaks(payload: unknown, path = ''): string[] {
  if (payload === null || typeof payload !== 'object') return [];

  if (Array.isArray(payload)) {
    return payload.flatMap((item, index) => findPlaintextLeaks(item, `${path}[${index}]`));
  }

  const leaks: string[] = [];
  for (const [key, value] of Object.entries(payload)) {
    const here = path.length === 0 ? key : `${path}.${key}`;
    if ((FORBIDDEN_PLAINTEXT_FIELDS as readonly string[]).includes(key)) {
      // un campo prohibido con valor nulo o vacio no es una fuga: no lleva nada
      if (value === null || value === undefined || value === '') continue;
      // ni lo es si ya viene cifrado. Lo que importa es el contenido, no como
      // se llame el campo: `title` con un sobre dentro es exactamente lo que
      // queremos que ocurra, no lo que queremos impedir.
      if (isSealedEnvelope(value)) continue;
      leaks.push(here);
      continue;
    }
    leaks.push(...findPlaintextLeaks(value, here));
  }
  return leaks;
}

/** lanza si el registro lleva contenido en claro. lo usan los dos lados */
export function assertNoPlaintextLeak(payload: unknown): void {
  const leaks = findPlaintextLeaks(payload);
  if (leaks.length > 0) {
    throw new Error(
      `una conversacion privada no puede enviar estos campos en claro: ${leaks.join(', ')}`,
    );
  }
}

// -----------------------------------------------------------------------------
// sincronizacion entre equipos
// -----------------------------------------------------------------------------

/**
 * identificador de boveda: 32 bytes derivados con HKDF, en base64url.
 *
 * agrupa los registros de una misma boveda sin que el servidor sepa nada de la
 * llave. AGRUPA, NO AUTORIZA: quien autoriza es la sesion de la cuenta, y el
 * servidor decide de quien es cada registro por el usuario de esa sesion.
 *
 * Sigue existiendo porque el cliente lo usa para comprobar, tras entrar, que le
 * han dado su cuenta y no otra. En las peticiones de sincronizacion es
 * OPCIONAL y no se envia: mandarlo invitaba a confundirlo con una credencial.
 */
export const vaultIdSchema = base64UrlSchema.length(43);

export const vaultSyncPushRequestSchema = z.object({
  vaultId: vaultIdSchema.optional(),
  conversationId: z.string().uuid(),
  /** lote de turnos ya sellados. el servidor valida su forma, nunca su contenido */
  records: z.array(privateRecordSchema).min(1).max(200),
});

export const vaultSyncPullQuerySchema = z.object({
  vaultId: vaultIdSchema.optional(),
  /** solo lo posterior a esta marca, para no rebajar todo cada vez */
  since: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

export const vaultSyncConversationSchema = z.object({
  conversationId: z.string().uuid(),
  turnCount: z.number().int().min(0),
  updatedAt: z.string(),
});

export const vaultSyncListResponseSchema = z.object({
  conversations: z.array(vaultSyncConversationSchema),
});

export const vaultSyncPullResponseSchema = z.object({
  records: z.array(privateRecordSchema),
});

export const vaultSyncPushResponseSchema = z.object({
  stored: z.number().int().min(0),
  /** los que ya estaban: reenviar un lote no duplica nada */
  skipped: z.number().int().min(0),
});

/**
 * tope de un objeto que viaja al almacen remoto.
 *
 * Es el limite del cuerpo de una peticion a un Worker de Cloudflare. Un video
 * mas grande se queda en el equipo donde se genero, y la interfaz lo dice: es
 * preferible a un fallo a mitad de subida que nadie sabe interpretar.
 */
export const VAULT_MAX_OBJECT_BYTES = 90 * 1024 * 1024;

/** los medios de una boveda, con sus metadatos cifrados y sin los bytes */
export const vaultMediaListResponseSchema = z.object({
  media: z.array(privateMediaSchema),
});

/**
 * alta de un medio.
 *
 * los BYTES no van aqui: se suben aparte, a
 * `/api/vault/media/objects/:objectKey`, y este registro se crea despues. Ese
 * orden deja huerfanos recuperables en vez de registros que apuntan a nada.
 */
export const vaultMediaPushRequestSchema = z.object({
  media: privateMediaSchema,
});

export type VaultSyncPushRequest = z.infer<typeof vaultSyncPushRequestSchema>;
export type VaultSyncPullQuery = z.infer<typeof vaultSyncPullQuerySchema>;
export type VaultSyncConversation = z.infer<typeof vaultSyncConversationSchema>;
