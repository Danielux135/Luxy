// lo que va DENTRO de un sobre de la boveda.
//
// vault.ts describe lo que el servidor ve; esto describe lo que el servidor
// nunca vera. Se valida igual, y por el mismo motivo: cuando algo se descifra
// sigue siendo entrada que hay que comprobar antes de usar. Un archivo alterado
// no puede hacer fallar al renderer con una forma inesperada.
//
// Cada carga lleva `v`. Un turno sellado hoy tiene que poder abrirse con una
// version futura de Luxy, y para eso hay que saber con que version se escribio.
import { z } from 'zod';
import { conversationMemorySchema } from './schemas.js';

export const VAULT_PAYLOAD_VERSION = 1;

const payloadVersionSchema = z.literal(VAULT_PAYLOAD_VERSION);

/**
 * un turno de conversacion.
 *
 * Todo lo identificable esta aqui dentro, incluido el titulo, el proveedor y el
 * modelo. Dejar fuera el proveedor revelaria a que API hablas y con que
 * frecuencia, que es justo el tipo de metadato que no hace falta ceder.
 */
export const vaultTurnPayloadSchema = z.object({
  v: payloadVersionSchema,
  role: z.enum(['user', 'assistant']),
  text: z.string().max(2_000_000),
  /** titulo de la conversacion; viaja con cada turno para no necesitar indice */
  title: z.string().max(400).nullable().default(null),
  provider: z.string().max(64).nullable().default(null),
  model: z.string().max(128).nullable().default(null),
  inputTokens: z.number().int().min(0).nullable().default(null),
  outputTokens: z.number().int().min(0).nullable().default(null),
  /**
   * instrucciones fijas que gobernaban la conversacion en ESTE turno.
   *
   * Van dentro del sobre del turno, y no en un campo propio del registro, por
   * dos razones. La primera es de diseño: guardarlas con el turno deja ver que
   * instrucciones estaban en vigor cuando se genero cada respuesta, en vez de
   * dejar solo las de hoy y hacer que el historial mienta sobre su propio
   * origen. La segunda es practica: el servidor no ve un campo nuevo, asi que
   * esto no añade una columna a `vault_records` ni cambia lo que el gateway
   * valida.
   *
   * El coste es duplicarlas en cada turno. Son unos cientos de bytes cifrados;
   * a cambio, la ultima vale como estado actual sin indice aparte.
   */
  instructions: z.string().max(8000).nullable().default(null),
  createdAt: z.string().datetime(),
});
export type VaultTurnPayload = z.infer<typeof vaultTurnPayloadSchema>;

/**
 * memoria estructurada de la conversacion, sellada aparte del turno.
 *
 * Envuelve `conversationMemorySchema`, el MISMO formato que usa Luxy en las
 * conversaciones normales. Tener dos formas de memoria segun donde viva seria
 * garantizar que divergen, y ademas obligaria a escribir dos veces el prompt
 * que la produce.
 */
export const vaultMemoryPayloadSchema = z.object({
  v: payloadVersionSchema,
  memory: conversationMemorySchema,
});
export type VaultMemoryPayload = z.infer<typeof vaultMemoryPayloadSchema>;

/**
 * metadatos de una imagen o un video.
 *
 * `mimeType` va aqui y no fuera: saber que una conversacion tiene cuarenta
 * `video/mp4` ya dice bastante sin abrir ninguno. Lo mismo con `prompt` y con
 * el identificador de personaje del proveedor.
 */
export const vaultMediaPayloadSchema = z.object({
  v: payloadVersionSchema,
  mimeType: z.string().max(128),
  /** nombre para mostrar y para guardar; nunca se usa como ruta */
  displayName: z.string().max(260).nullable().default(null),
  prompt: z.string().max(8000).nullable().default(null),
  width: z.number().int().min(1).max(16384).nullable().default(null),
  height: z.number().int().min(1).max(16384).nullable().default(null),
  durationMs: z.number().int().min(0).nullable().default(null),
  /** identificador del personaje en el proveedor, si lo hubiera */
  characterId: z.string().max(128).nullable().default(null),
  provider: z.string().max(64).nullable().default(null),
  model: z.string().max(128).nullable().default(null),
  createdAt: z.string().datetime(),
});
export type VaultMediaPayload = z.infer<typeof vaultMediaPayloadSchema>;
