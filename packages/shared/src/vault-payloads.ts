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
  /**
   * personaje del proveedor que gobierna las imagenes de esta conversacion.
   *
   * Vive con el turno por el mismo motivo que las instrucciones: es lo que
   * convierte «el personaje» en algo de la conversacion y no en un campo que
   * hay que rescribir cada vez. Es un identificador del proveedor, no un
   * secreto, pero viaja cifrado como todo lo demas: saber que dos
   * conversaciones comparten personaje ya dice algo.
   */
  characterId: z.string().max(128).nullable().default(null),
  /**
   * quien es el personaje, en texto, para el MODELO.
   *
   * El identificador de arriba solo le sirve al proveedor de imagenes: el
   * conserva la identidad entre generaciones. Pero el modelo que escribe no ve
   * ninguna imagen y no sabe nada de ese identificador, asi que sin esto no
   * puede describir al personaje ni componer una escena coherente con el.
   *
   * Se guarda con el turno, cifrado, por la misma razon que las instrucciones:
   * describe a alguien.
   */
  characterDescription: z.string().max(2000).nullable().default(null),
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
 * `video/mp4` ya dice bastante sin abrir ninguno. Lo mismo con `prompt`, con el
 * pie de foto y con el identificador de personaje del proveedor.
 */
export const vaultMediaPayloadSchema = z.object({
  v: payloadVersionSchema,
  mimeType: z.string().max(128),
  /** nombre para mostrar y para guardar; nunca se usa como ruta */
  displayName: z.string().max(260).nullable().default(null),
  /**
   * lo que se PIDIO al generar el medio, tal y como se le mando al proveedor.
   *
   * Es historia, no descripcion: no se corrige. Es lo unico que explica por que
   * una imagen salio como salio, y borrarlo al reescribir el pie de foto dejaba
   * el archivo sin ninguna forma de saber de donde venia.
   */
  prompt: z.string().max(8000).nullable().default(null),
  /**
   * lo que se VE, en las palabras de quien lo mira. Esto SI se corrige.
   *
   * Va aparte de `prompt` porque mezclarlos fue el error: un mismo campo
   * significaba tres cosas distintas segun el origen del medio —la intencion en
   * ingles de una imagen generada, el pie de foto de un adjunto, o la cadena
   * fija del avatar copiado—, asi que ni describia ni recordaba bien.
   *
   * Importa mas de lo que parece: el pie de foto es lo unico que el modelo sabe
   * de una imagen ya guardada, porque no la abre ni la ve. Con una descripcion
   * vacia o inutil elige a ciegas y paga otra generacion en vez de reenviar la
   * que ya existe.
   *
   * `default(null)` conserva lo ya escrito en disco: un medio sellado antes de
   * este campo se abre con `caption: null` en vez de fallar al validarse.
   */
  caption: z.string().max(3200).nullable().default(null),
  width: z.number().int().min(1).max(16384).nullable().default(null),
  height: z.number().int().min(1).max(16384).nullable().default(null),
  durationMs: z.number().int().min(0).nullable().default(null),
  /** identificador del personaje en el proveedor, si lo hubiera */
  characterId: z.string().max(128).nullable().default(null),
  provider: z.string().max(64).nullable().default(null),
  model: z.string().max(128).nullable().default(null),
  /**
   * enlace con el intento que produjo este medio, en el registro local.
   *
   * Es una referencia, no una copia: la semilla real, el worker que atendio la
   * peticion, los avisos del envio y el plan entero viven en el almacen de
   * intentos de la conversacion, que es donde tambien quedan los que NO
   * produjeron ningun medio —los censurados, los fallidos y los descartados—.
   * Duplicar aqui esos campos obligaria a mantener dos verdades sobre la misma
   * generacion, y la de este sobre solo existiria cuando la imagen llego.
   *
   * Es el unico campo nuevo del sobre por eso mismo: sin el, un medio guardado
   * no tiene ninguna forma de senalar a su propia historia.
   *
   * `default(null)` conserva lo ya escrito en disco, igual que `caption`: un
   * medio sellado antes de este campo se abre con `attemptId: null` en vez de
   * fallar al validarse. Un Studio antiguo que resellara el sobre al corregir
   * el pie de foto perderia el enlace, nunca el dato: el registro de intentos
   * sigue siendo la autoridad.
   */
  attemptId: z.string().max(64).nullable().default(null),
  createdAt: z.string().datetime(),
});
/**
 * `caption` y `attemptId` son opcionales en el TIPO aunque el esquema los
 * rellene siempre.
 *
 * Quien sella construye estos metadatos a mano, campo a campo, y casi ninguna
 * alta tiene pie de foto ni viene de una generacion: exigir `caption: null` y
 * `attemptId: null` en cada una solo conseguiria que se rellenen por costumbre.
 * Al abrir un medio los campos estan siempre, porque el `default(null)` los
 * pone; el tipo solo es mas permisivo de lo necesario en ese sentido, nunca al
 * reves. Es el mismo trato que `instructions` en un turno.
 */
export type VaultMediaPayload = Omit<
  z.infer<typeof vaultMediaPayloadSchema>,
  'caption' | 'attemptId'
> & {
  caption?: string | null;
  attemptId?: string | null;
};
