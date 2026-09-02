// contrato IPC entre el proceso principal, el preload y el renderer.
//
// REGLA INNEGOCIABLE: por aqui no pasa ningun secreto hacia el renderer. React
// puede saber si una clave esta configurada, nunca cual es. Los canales son
// verbos cerrados (getStatus, startAgent), jamas algo como exec(comando).
//
// todo argumento que llega al main se valida con zod antes de tocar logica,
// igual que la entrada de telegram en el gateway.
import { z } from 'zod';
import {
  type agentEventSchema,
  agentHostStatusSchema,
  jobStatusSchema,
  projectAliasSchema,
  studioConversationUpdateRequestSchema,
  studioConversationUpdateResponseSchema,
  studioJobActionRequestSchema,
  studioJobActionResponseSchema,
  studioJobCreateRequestSchema,
  studioJobFeedbackRequestSchema,
  studioJobFeedbackResponseSchema,
  studioJobResponseSchema,
  studioJobsResponseSchema,
  studioOptionsResponseSchema,
} from '@luxy/shared';

// las constantes de canal y de nombre de secreto viven en channels.ts porque
// las necesita el preload, que no puede cargar zod
export * from './channels.js';

// -----------------------------------------------------------------------------
// argumentos de entrada
// -----------------------------------------------------------------------------

export const emptyArgsSchema = z.undefined().or(z.null()).or(z.object({}).strict());

export const stopAgentArgsSchema = z.object({
  reason: z.string().min(1).max(200).default('peticion desde la interfaz'),
});

/**
 * abrir la carpeta de un artefacto.
 *
 * solo viaja el identificador del trabajo, nunca una ruta: la raiz la calcula
 * el proceso principal y el renderer no puede proponer donde mirar.
 */
export const artifactOpenFolderArgsSchema = z.object({
  jobId: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9-]+$/, 'identificador de trabajo no valido'),
});

/** la ruta sigue validandose y confinándose en main antes de abrirse */
export const worktreeOpenFolderArgsSchema = z.object({
  worktreePath: z.string().min(1).max(1024),
});

export const logsTailArgsSchema = z.object({
  count: z.number().int().min(1).max(500).default(120),
});

export const pickFolderArgsSchema = z.object({
  title: z.string().min(1).max(120).default('Elige la carpeta del proyecto'),
});

// -----------------------------------------------------------------------------
// respuestas
// -----------------------------------------------------------------------------

/** envoltorio uniforme: el renderer nunca recibe una traza */
export const ipcFailureSchema = z.object({
  ok: z.literal(false),
  error: z.string(),
  hint: z.string().nullable(),
});

export function ipcOk<T extends z.ZodTypeAny>(value: T) {
  return z.object({ ok: z.literal(true), value });
}

export const appInfoSchema = z.object({
  appVersion: z.string(),
  electronVersion: z.string(),
  nodeVersion: z.string(),
  platform: z.string(),
  /** nombre local del sistema; sirve para proponer una identidad, no es secreto */
  hostname: z.string().min(1).max(255),
  /** carpeta de logs, para el boton "abrir carpeta" */
  logsDirectory: z.string(),
  /** true si safeStorage puede cifrar en este equipo */
  encryptionAvailable: z.boolean(),
  /** huella del bundle del agente en marcha; null si no ha arrancado */
  agentBuild: z.string().nullable(),
});

export type AppInfo = z.infer<typeof appInfoSchema>;

export const logsTailResultSchema = z.object({ lines: z.array(z.string()) });

export const pickFolderResultSchema = z.object({
  canceled: z.boolean(),
  path: z.string().nullable(),
});

export const agentStatusResultSchema = agentHostStatusSchema;

// -----------------------------------------------------------------------------
// configuracion y secretos
// -----------------------------------------------------------------------------

/**
 * lo que el renderer llega a saber de los secretos: que nombres existen y si
 * estan configurados. NUNCA el valor.
 */
export const secretsSummarySchema = z.object({
  encryptionAvailable: z.boolean(),
  /** nombre del secreto -> configurado */
  configured: z.record(z.string(), z.boolean()),
});

export const configSummarySchema = z.object({
  configured: z.boolean(),
  configPath: z.string(),
  /** la configuracion del disco, siempre sin machineToken */
  config: z.unknown().nullable(),
  secrets: secretsSummarySchema,
});

/**
 * nombres de secreto admitidos: evita que el renderer escriba claves sueltas.
 *
 * el tercer patron son los `apiKeyEnv` de providers.http (config.json), que
 * siguen la convencion de variable de entorno (p.ej. DEEPSEEK_API_KEY): son
 * los mismos nombres que ya acepta la CLI via .env.providers.
 */
export const secretNameSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(
    /^(machineToken|connection:[a-z0-9][a-z0-9-]*|[A-Z][A-Z0-9_]{0,62})$/,
    'nombre de secreto no admitido',
  );

/**
 * argumentos de la boveda.
 *
 * las contraseñas SI viajan del renderer al main: es la unica direccion posible,
 * porque el usuario las escribe en la ventana. Lo que jamas viaja de vuelta es
 * material derivado de ellas. Por eso ninguna respuesta de este bloque contiene
 * llaves, sales ni sobres, salvo la clave de recuperacion en el momento exacto
 * de crear la boveda, que se muestra una vez y no se guarda.
 */
export const vaultPasswordArgsSchema = z.object({
  password: z.string().min(1).max(512),
});

export const vaultUnlockArgsSchema = z.object({
  method: z.enum(['password', 'recovery', 'device']),
  /** ausente con 'device': ahi lo aporta el sistema operativo */
  secret: z.string().min(1).max(512).optional(),
});

export const vaultChangePasswordArgsSchema = z.object({
  currentPassword: z.string().min(1).max(512),
  newPassword: z.string().min(1).max(512),
});

export const vaultDeviceUnlockSetArgsSchema = z.object({
  enabled: z.boolean(),
});

/**
 * minutos de inactividad antes del cierre automatico. 0 = no cerrar sola.
 *
 * lista cerrada y no un numero libre: el valor llega del renderer, y un entero
 * arbitrario permitiria pedir un cierre cada 50 ms y dejar la boveda inservible.
 */
export const vaultAutoLockSetArgsSchema = z.object({
  minutes: z.union([
    z.literal(1),
    z.literal(5),
    z.literal(15),
    z.literal(30),
    z.literal(60),
    z.literal(240),
    z.literal(0),
  ]),
});

/**
 * lo que se cuenta de la cuenta. Ni el token de sesion ni nada derivado de la
 * contraseña: el correo, si hay sesion viva y cuando caduca.
 */
export const vaultAccountStatusSchema = z.object({
  /** cuenta a la que pertenece la boveda de este equipo, haya sesion o no */
  email: z.string().nullable(),
  signedIn: z.boolean(),
  expiresAt: z.string().nullable(),
  /** se entro con la clave de recuperacion: conviene elegir contraseña nueva */
  openedWithRecoveryKey: z.boolean(),
});

export const vaultStatusSchema = z.object({
  configured: z.boolean(),
  unlocked: z.boolean(),
  methods: z.object({ password: z.boolean(), recovery: z.boolean(), device: z.boolean() }),
  autoLockMinutes: z.number().int().min(0),
  lockingInMs: z.number().int().min(0).nullable(),
  account: vaultAccountStatusSchema,
  /**
   * hay clave guardada del proveedor de imagenes.
   *
   * Solo el hecho, nunca la clave. Es lo que permite a la interfaz decir «falta
   * la clave» en vez de dejar que el usuario descubra el fallo cuando pida una
   * imagen y no llegue.
   */
  mediaProviderConfigured: z.boolean(),
});

/**
 * clave del proveedor de imagenes.
 *
 * Va por un canal propio y no por `secretSet` a proposito: ese canal exige que
 * el nombre pertenezca a la configuracion, y este secreto esta RESERVADO
 * precisamente para que nadie pueda apropiarselo declarando un proveedor con
 * ese `apiKeyEnv`. Aqui el nombre no viaja: lo pone el proceso principal, asi
 * que el renderer no puede elegir que secreto escribe.
 */
export const vaultMediaKeyArgsSchema = z.object({
  apiKey: z.string().min(1).max(512),
});

/**
 * credenciales de la cuenta.
 *
 * el correo se valida aqui y otra vez en el proceso principal: esta es la
 * comodidad de la interfaz, la de alli es la que cuenta.
 */
export const vaultAccountArgsSchema = z.object({
  email: z.string().trim().min(3).max(320),
  password: z.string().min(1).max(512),
});

/**
 * entrar en la cuenta por una de las dos puertas.
 *
 * `method` decide con que se abre la llave que devuelve el servidor. Las dos
 * abren la misma bóveda; la clave de recuperación es la que permite entrar
 * desde un ordenador nuevo cuando se ha olvidado la contraseña.
 */
export const vaultAccountLoginArgsSchema = z.object({
  email: z.string().trim().min(3).max(320),
  method: z.enum(['password', 'recovery']).default('password'),
  secret: z.string().min(1).max(512),
});

/** unica respuesta del bloque que lleva un secreto, y solo al crear */
export const vaultCreateResultSchema = z.object({
  status: vaultStatusSchema,
  /**
   * se muestra UNA vez y no se guarda en ningun sitio en claro. Si el usuario
   * no la copia, deja de existir: es intencionado y la interfaz debe decirlo.
   */
  recoveryKey: z.string(),
});

const conversationIdSchema = z.string().uuid();

export const vaultConversationSendArgsSchema = z.object({
  /** null para empezar una conversacion nueva */
  conversationId: conversationIdSchema.nullable(),
  /** texto en claro: el usuario lo acaba de escribir en la ventana */
  message: z.string().min(1).max(200_000),
  provider: z.string().min(1).max(64),
  model: z.string().max(128).nullable(),
  projectAlias: z.string().min(1).max(64),
  /**
   * instrucciones fijas de la conversacion, tal y como estan en la ventana.
   *
   * `null` significa «no las toques»: se conservan las que ya hubiera. Una
   * cadena vacia SI las borra. Sin esa distincion no habria forma de quitarlas
   * una vez puestas.
   */
  instructions: z.string().max(8000).nullable().default(null),
  /**
   * personaje que gobierna las imagenes de esta conversacion.
   *
   * misma regla que `instructions`: `null` conserva el que hubiera, y una
   * cadena vacia lo quita.
   */
  characterId: z.string().max(128).nullable().default(null),
  /**
   * quién es el personaje, en texto, para el modelo.
   *
   * El identificador de arriba sólo le sirve al proveedor de imágenes. El
   * modelo que escribe no ve ninguna imagen: sin esto no sabe a quién encarna.
   */
  characterDescription: z.string().max(2000).nullable().default(null),
});

export const vaultConversationIdArgsSchema = z.object({
  conversationId: conversationIdSchema,
});

export const vaultConversationSummarySchema = z.object({
  conversationId: z.string(),
  title: z.string(),
  turns: z.number().int().min(0),
  updatedAt: z.string(),
});

export const vaultConversationListResultSchema = z.object({
  conversations: z.array(vaultConversationSummarySchema),
});

export const vaultConversationTurnSchema = z.object({
  sequence: z.number().int().min(0),
  role: z.enum(['user', 'assistant']),
  text: z.string(),
  createdAt: z.string(),
});

export const vaultConversationReadResultSchema = z.object({
  conversationId: z.string(),
  turns: z.array(vaultConversationTurnSchema),
  /** las que estan en vigor; texto en claro, porque el main ya las descifro */
  instructions: z.string().nullable(),
  characterId: z.string().nullable(),
  characterDescription: z.string().nullable(),
});

export const vaultConversationSendResultSchema = z.object({
  conversationId: z.string(),
  outcome: z.enum(['completed', 'failed', 'cancelled']),
  turns: z.array(vaultConversationTurnSchema),
  instructions: z.string().nullable(),
  characterId: z.string().nullable(),
  characterDescription: z.string().nullable(),
  /**
   * la imagen que el modelo pidio en este turno, si pidio alguna.
   *
   * `null` significa que no pidio ninguna, que es lo normal. Con `mediaId` la
   * imagen esta guardada y cifrada; con `error` se pidio y no pudo ser, y la
   * interfaz debe decir por que: una imagen que no aparece sin explicacion
   * parece un cuelgue.
   */
  image: z
    .object({
      mediaId: z.string().nullable(),
      costCredits: z.number().nullable(),
      error: z.string().nullable(),
    })
    .nullable(),
  error: z.string().nullable(),
});

/**
 * tope de un archivo que se puede previsualizar.
 *
 * los bytes descifrados cruzan el IPC como texto base64, que infla un 33%. Un
 * video de cientos de megas por ese camino congela la ventana, asi que por
 * encima de este tope se devuelven los metadatos y no el contenido. La solucion
 * real es un protocolo propio de Electron que sirva el flujo; no existe todavia
 * y la interfaz lo dice en vez de fingir que carga.
 */
export const VAULT_PREVIEW_MAX_BYTES = 20 * 1024 * 1024;

export const vaultMediaAttachArgsSchema = z.object({
  conversationId: conversationIdSchema,
});

export const vaultMediaListArgsSchema = z.object({
  conversationId: conversationIdSchema,
});

export const vaultMediaReadArgsSchema = z.object({
  conversationId: conversationIdSchema,
  mediaId: z.string().uuid(),
});

export const vaultMediaItemSchema = z.object({
  mediaId: z.string(),
  mimeType: z.string(),
  displayName: z.string().nullable(),
  byteSize: z.number().int().min(0),
  hasThumbnail: z.boolean(),
  /** false cuando pasa de VAULT_PREVIEW_MAX_BYTES */
  previewable: z.boolean(),
});

export const vaultMediaListResultSchema = z.object({
  media: z.array(vaultMediaItemSchema),
});

export const vaultMediaReadResultSchema = z.object({
  mediaId: z.string(),
  mimeType: z.string(),
  /** data URL con los bytes descifrados. null si es demasiado grande */
  dataUrl: z.string().nullable(),
});

export const vaultMediaGenerateArgsSchema = z.object({
  conversationId: conversationIdSchema,
  characterId: z.string().min(1).max(128),
  prompt: z.string().min(1).max(2000),
  kind: z.enum(['image', 'video']),
  /** solo para video: anima una imagen ya generada */
  fromGenerationId: z.string().max(128).optional(),
});

export const vaultCharacterCreateArgsSchema = z.object({
  /**
   * modelo del personaje. Obligatorio para la API, y no se puede cambiar
   * después: decide el aspecto de todo lo que genere ese personaje.
   */
  modelId: z.enum(['realistic-sharp-v1', 'anime-pure-v1']).default('realistic-sharp-v1'),
  /**
   * rasgos del enum CERRADO que publica el proveedor.
   *
   * No es texto libre: la API rechaza cualquier valor que no esté en su lista.
   * Se validan aquí para que un renderer alterado no pueda mandar otra cosa, y
   * porque un valor inventado se explica mucho mejor antes de salir a la red.
   */
  traits: z
    .object({
      gender: z.enum(['female', 'male']),
      ethnicity: z.enum([
        'white',
        'black',
        'hispanic',
        'middle-eastern',
        'indian',
        'east-asian',
        'south-east-asian',
      ]),
      ageRange: z.enum(['18-22', '21-22', '23-29', '30-39', '40-plus']),
      hairLength: z.enum(['short', 'medium', 'long']),
      hairColor: z.enum(['black', 'brown', 'blonde', 'red', 'auburn', 'grey', 'white']),
      build: z.enum(['petite', 'slim', 'athletic', 'curvy', 'voluptuous']),
      /** sólo aplican con gender=female; la API los ignora en male */
      breastSize: z.enum(['small', 'medium', 'large', 'very-large', 'huge']).optional(),
      assSize: z.enum(['small', 'medium', 'large', 'very-large', 'huge']).optional(),
    })
    .partial()
    .default({}),
  /**
   * lo que los rasgos no cubren: ojos, pecas, ropa, luz, pose, escenario.
   *
   * En inglés, según su documentación, y pasa por su moderación.
   */
  scene: z.string().max(1000).default(''),
  /** avatar base vestido; sólo afecta al avatar inicial, no a cada generación */
  sfw: z.boolean().default(false),
  /** etiqueta para reconocerlo en la lista; también viaja al proveedor */
  label: z.string().max(100).default(''),
  /** quién es, en texto, para el modelo que escribe */
  description: z.string().max(2000).default(''),
});

export const vaultMediaGenerateResultSchema = z.object({
  mediaId: z.string(),
  mimeType: z.string(),
  byteSize: z.number().int().min(0),
  /** creditos declarados por el proveedor, para que el gasto sea visible */
  costCredits: z.number().nullable(),
});

/**
 * un personaje guardado en la bóveda.
 *
 * Se guarda porque crearlo **cuesta créditos** y su identificador sólo se
 * devuelve una vez: la API no tiene forma de listarlos, así que uno que no se
 * guarde aquí no se recupera de ninguna manera.
 */
export const vaultCharacterSummarySchema = z.object({
  characterId: z.string(),
  modelId: z.string(),
  description: z.string(),
  label: z.string(),
  /** hay avatar guardado; los bytes se piden aparte y van cifrados en disco */
  avatarObjectKey: z.string().nullable(),
  createdAt: z.string(),
});

export const vaultCharacterListResultSchema = z.object({
  characters: z.array(vaultCharacterSummarySchema),
});

export const vaultCharacterCreateResultSchema = z.object({
  characterId: z.string(),
  /** la lista completa, ya con el nuevo: la interfaz no vuelve a preguntar */
  characters: z.array(vaultCharacterSummarySchema),
});

export const vaultCharacterForgetArgsSchema = z.object({
  characterId: z.string().min(1).max(128),
});

/**
 * dar de alta un personaje que ya existe en el proveedor.
 *
 * Hace falta porque la API **no sabe listar personajes**: quien tenga un
 * identificador de antes no tiene otra forma de meterlo en Luxy, y crear otro
 * cuesta créditos.
 */
export const vaultCharacterImportArgsSchema = z.object({
  /**
   * identificador del proveedor, que es un UUID: asi lo declara su API y asi lo
   * exige al generar. Validarlo al pegar convierte un 404 de tres pantallas
   * despues en un aviso inmediato. No atrapa un UUID equivocado —para eso esta
   * el aviso de «no esta en la boveda»—, pero si todo lo que se copia de una
   * URL y no es un identificador.
   */
  characterId: z
    .string()
    .uuid('el identificador del personaje es el UUID que devuelve el proveedor'),
  modelId: z.enum(['realistic-sharp-v1', 'anime-pure-v1']).default('realistic-sharp-v1'),
  label: z.string().max(100).default(''),
  description: z.string().max(2000).default(''),
  /** URL del avatar, si se conoce: se descarga y se cifra aquí */
  avatarUrl: z.string().max(2000).default(''),
});

export const vaultCharacterAvatarResultSchema = z.object({
  /** data URL descifrada, o null si ese personaje no tiene avatar guardado */
  dataUrl: z.string().nullable(),
});

export const vaultSyncResultSchema = z.object({
  uploaded: z.number().int().min(0),
  downloaded: z.number().int().min(0),
  conversations: z.number().int().min(0),
  /** imagenes y videos, aparte: son otro tipo de trabajo y otro coste */
  mediaUploaded: z.number().int().min(0),
  mediaDownloaded: z.number().int().min(0),
  /** demasiado grandes para una peticion; se quedan en su equipo */
  mediaSkipped: z.number().int().min(0),
});

export const configSaveArgsSchema = z.object({
  /** se valida con storedAgentConfigSchema en el proceso principal */
  config: z.unknown(),
  /** alta o sustitucion atomica de la clave de un proveedor http */
  providerSecret: z
    .object({
      name: secretNameSchema,
      value: z.string().min(1).max(512),
    })
    .optional(),
});

export const secretSetArgsSchema = z.object({
  name: secretNameSchema,
  value: z.string().min(1).max(512),
});

export const secretDeleteArgsSchema = z.object({ name: secretNameSchema });

/** un secreto detectado en un archivo en claro; el valor jamas viaja */
export const detectedSecretSchema = z.object({
  name: z.string(),
  preview: z.string(),
  source: z.string(),
});

export const migrationScanResultSchema = z.object({
  candidates: z.array(z.object({ file: z.string(), secrets: z.array(detectedSecretSchema) })),
});

export const migrationImportArgsSchema = z.object({
  file: z.string().min(1).max(500),
  /** nombres a importar; el valor lo lee el proceso principal, no el renderer */
  names: z.array(z.string().min(1).max(80)).min(1).max(32),
  /** id de conexion a la que asociar la clave, si aplica */
  connectionId: z.string().max(32).nullable().default(null),
});

export const migrationDeleteFileArgsSchema = z.object({ file: z.string().min(1).max(500) });

// -----------------------------------------------------------------------------
// onboarding
// -----------------------------------------------------------------------------

export const toolPresenceSchema = z.object({
  available: z.boolean(),
  version: z.string().nullable(),
  path: z.string().nullable(),
});

export const toolsDetectResultSchema = z.object({
  tools: z.record(z.string(), toolPresenceSchema),
});

export const gatewayCheckArgsSchema = z.object({
  gatewayUrl: z.string().url().max(300),
});

export const gatewayCheckResultSchema = z.object({
  reachable: z.boolean(),
  configured: z.boolean().nullable(),
  error: z.string().nullable(),
});

export const machineRegisterArgsSchema = z.object({
  gatewayUrl: z.string().url().max(300),
  machineName: z
    .string()
    .min(1)
    .max(48)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'el nombre admite minusculas, digitos y guion'),
  /** secreto de registro: se usa una vez y NO se guarda en ningun sitio */
  registrationSecret: z.string().min(8).max(200),
});

export const machineRegisterResultSchema = z.object({
  registered: z.boolean(),
  machineId: z.string().nullable(),
});

export const connectionTestArgsSchema = z
  .object({
    connectionId: z.string().min(1).max(32),
  })
  .strict();

export const connectionTestResultSchema = z.object({
  reachable: z.boolean(),
  /** apiModel que la conexion declara servir */
  models: z.array(z.string()),
  error: z.string().nullable(),
});

/**
 * refrescar el catalogo real de una conexion.
 *
 * igual que la prueba de conexion, el renderer solo manda el identificador: la
 * URL sale de la configuracion guardada y la clave nunca cruza el IPC.
 */
export const catalogRefreshArgsSchema = z.object({
  connectionId: z.string().min(1).max(64),
});

export const catalogModelSchema = z.object({
  apiModel: z.string(),
  ownedBy: z.string().nullable(),
  billing: z.enum(['token', 'call', 'unknown']),
  modelRatio: z.number().nullable(),
  completionRatio: z.number().nullable(),
  perCall: z.number().nullable(),
  groups: z.array(z.string()),
});

export const catalogSnapshotSchema = z.object({
  connectionId: z.string(),
  fetchedAt: z.string(),
  models: z.array(catalogModelSchema),
  pricingAvailable: z.boolean(),
  notice: z.string().nullable(),
  /** que contesto cada ruta de precios probada */
  pricingProbes: z
    .array(
      z.object({
        url: z.string(),
        status: z.number().nullable(),
        topLevelKeys: z.array(z.string()),
        entryCount: z.number(),
      }),
    )
    .optional(),
});

export const approvalResolveArgsSchema = z.object({
  jobId: z.string().min(1).max(64),
  shortId: z.string().min(1).max(32),
  action: z.enum(['commit', 'discard', 'push']),
  projectAlias: z.string().min(1).max(64),
  worktreePath: z.string().min(1).max(1024),
  branch: z.string().min(1).max(256),
  message: z.string().max(500).nullable().default(null),
  /** el push exige que la interfaz pida confirmacion DOS veces */
  confirmedTwice: z.boolean().default(false),
});

export const approvalResolveResultSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
});

export const workspacePrepareArgsSchema = z.object({
  projectAlias: z.string().min(1).max(64),
  label: z.string().trim().min(1).max(120),
});

export const workspaceResultSchema = z.object({
  projectAlias: z.string().min(1).max(64),
  path: z.string().min(1).max(1024),
  branch: z.string().min(1).max(256),
});
export const workspaceOpenArgsSchema = z.object({ path: z.string().min(1).max(1024) });

// -----------------------------------------------------------------------------
// Luxy Studio
// -----------------------------------------------------------------------------

export const studioJobCreateArgsSchema = studioJobCreateRequestSchema;
export const studioJobsListArgsSchema = z.object({
  targetMachineId: z.string().uuid().optional(),
  projectAlias: projectAliasSchema.optional(),
  status: jobStatusSchema.optional(),
  limit: z.number().int().min(1).max(100).default(30),
  offset: z.number().int().min(0).max(100_000).optional(),
});
export const studioJobIdArgsSchema = z.object({ jobId: z.string().uuid() });
export const studioJobActionArgsSchema = studioJobActionRequestSchema.extend({
  jobId: z.string().uuid(),
});
export const studioJobFeedbackArgsSchema = studioJobFeedbackRequestSchema.extend({
  jobId: z.string().uuid(),
});
export const studioConversationUpdateArgsSchema = studioConversationUpdateRequestSchema.and(
  z.object({ jobId: z.string().uuid() }),
);

export const studioOptionsResultSchema = studioOptionsResponseSchema;
export const studioJobsListResultSchema = studioJobsResponseSchema;
export const studioJobResultSchema = studioJobResponseSchema;
export const studioJobActionResultSchema = studioJobActionResponseSchema;
export const studioJobFeedbackResultSchema = studioJobFeedbackResponseSchema;
export const studioConversationUpdateResultSchema = studioConversationUpdateResponseSchema;

// -----------------------------------------------------------------------------
// API que el preload expone en window.luxy
// -----------------------------------------------------------------------------

export type IpcResult<T> =
  { ok: true; value: T } | { ok: false; error: string; hint: string | null };

export interface LuxyBridge {
  getAppInfo(): Promise<IpcResult<AppInfo>>;
  getAgentStatus(): Promise<IpcResult<z.infer<typeof agentStatusResultSchema>>>;
  startAgent(): Promise<IpcResult<z.infer<typeof agentStatusResultSchema>>>;
  stopAgent(reason?: string): Promise<IpcResult<z.infer<typeof agentStatusResultSchema>>>;
  restartAgent(): Promise<IpcResult<z.infer<typeof agentStatusResultSchema>>>;
  tailLogs(count?: number): Promise<IpcResult<{ lines: string[] }>>;
  openLogsFolder(): Promise<IpcResult<{ opened: boolean }>>;
  openArtifactFolder(jobId: string): Promise<IpcResult<{ opened: boolean }>>;
  openWorktreeFolder(worktreePath: string): Promise<IpcResult<{ opened: boolean }>>;
  pickFolder(title?: string): Promise<IpcResult<{ canceled: boolean; path: string | null }>>;
  getConfig(): Promise<IpcResult<z.infer<typeof configSummarySchema>>>;
  saveConfig(
    config: unknown,
    providerSecret?: { name: string; value: string },
  ): Promise<IpcResult<z.infer<typeof configSummarySchema>>>;
  setSecret(name: string, value: string): Promise<IpcResult<z.infer<typeof secretsSummarySchema>>>;
  deleteSecret(name: string): Promise<IpcResult<z.infer<typeof secretsSummarySchema>>>;
  scanForSecrets(): Promise<IpcResult<z.infer<typeof migrationScanResultSchema>>>;
  importSecrets(
    file: string,
    names: string[],
    connectionId?: string | null,
  ): Promise<IpcResult<z.infer<typeof secretsSummarySchema>>>;
  deleteMigratedFile(file: string): Promise<IpcResult<{ deleted: boolean }>>;
  detectTools(): Promise<IpcResult<z.infer<typeof toolsDetectResultSchema>>>;
  checkGateway(gatewayUrl: string): Promise<IpcResult<z.infer<typeof gatewayCheckResultSchema>>>;
  registerMachine(
    args: z.infer<typeof machineRegisterArgsSchema>,
  ): Promise<IpcResult<z.infer<typeof machineRegisterResultSchema>>>;
  testConnection(
    connectionId: string,
  ): Promise<IpcResult<z.infer<typeof connectionTestResultSchema>>>;
  refreshCatalog(connectionId: string): Promise<IpcResult<z.infer<typeof catalogSnapshotSchema>>>;
  readCatalog(
    connectionId: string,
  ): Promise<IpcResult<{ snapshot: z.infer<typeof catalogSnapshotSchema> | null }>>;
  resolveApproval(
    args: z.infer<typeof approvalResolveArgsSchema>,
  ): Promise<IpcResult<z.infer<typeof approvalResolveResultSchema>>>;
  prepareWorkspace(
    projectAlias: string,
    label: string,
  ): Promise<IpcResult<z.infer<typeof workspaceResultSchema>>>;
  openWorkspaceFolder(path: string): Promise<IpcResult<{ opened: boolean }>>;
  getStudioOptions(): Promise<IpcResult<z.infer<typeof studioOptionsResultSchema>>>;
  createStudioJob(
    args: z.infer<typeof studioJobCreateArgsSchema>,
  ): Promise<IpcResult<z.infer<typeof studioJobResultSchema>>>;
  listStudioJobs(
    args?: z.infer<typeof studioJobsListArgsSchema>,
  ): Promise<IpcResult<z.infer<typeof studioJobsListResultSchema>>>;
  getStudioJob(jobId: string): Promise<IpcResult<z.infer<typeof studioJobResultSchema>>>;
  cancelStudioJob(jobId: string): Promise<IpcResult<{ cancelled: boolean }>>;
  rateStudioJob(
    args: z.infer<typeof studioJobFeedbackArgsSchema>,
  ): Promise<IpcResult<z.infer<typeof studioJobFeedbackResultSchema>>>;
  updateStudioConversation(
    args: z.infer<typeof studioConversationUpdateArgsSchema>,
  ): Promise<IpcResult<z.infer<typeof studioConversationUpdateResultSchema>>>;
  requestStudioJobAction(
    args: z.infer<typeof studioJobActionArgsSchema>,
  ): Promise<IpcResult<z.infer<typeof studioJobActionResultSchema>>>;

  /**
   * boveda privada.
   *
   * las contraseñas viajan del renderer al main, que es la unica direccion
   * posible: el usuario las escribe en la ventana. De vuelta solo llega estado,
   * salvo la clave de recuperacion en el instante exacto de crear la boveda.
   */
  getVaultStatus(): Promise<IpcResult<z.infer<typeof vaultStatusSchema>>>;
  /** crea la cuenta: la llave maestra nace aqui y el servidor la guarda envuelta */
  registerVaultAccount(
    args: z.infer<typeof vaultAccountArgsSchema>,
  ): Promise<IpcResult<z.infer<typeof vaultCreateResultSchema>>>;
  /** entra en una cuenta ya existente, con contraseña o clave de recuperación */
  loginVaultAccount(
    args: z.infer<typeof vaultAccountLoginArgsSchema>,
  ): Promise<IpcResult<z.infer<typeof vaultStatusSchema>>>;
  /**
   * sube a una cuenta nueva la boveda que ya existia en este equipo.
   *
   * devuelve una clave de recuperación nueva —la anterior deja de valer—,
   * porque la vieja se mostró una vez y no hay copia con la que cerrar la
   * llave para el servidor.
   */
  linkVaultAccount(
    args: z.infer<typeof vaultAccountArgsSchema>,
  ): Promise<IpcResult<z.infer<typeof vaultCreateResultSchema>>>;
  logoutVaultAccount(): Promise<IpcResult<z.infer<typeof vaultStatusSchema>>>;
  /** guarda la clave del proveedor de imagenes; el nombre lo pone el main */
  setVaultMediaKey(
    args: z.infer<typeof vaultMediaKeyArgsSchema>,
  ): Promise<IpcResult<z.infer<typeof vaultStatusSchema>>>;
  deleteVaultMediaKey(): Promise<IpcResult<z.infer<typeof vaultStatusSchema>>>;
  createVault(password: string): Promise<IpcResult<z.infer<typeof vaultCreateResultSchema>>>;
  unlockVault(
    args: z.infer<typeof vaultUnlockArgsSchema>,
  ): Promise<IpcResult<z.infer<typeof vaultStatusSchema>>>;
  lockVault(): Promise<IpcResult<z.infer<typeof vaultStatusSchema>>>;
  changeVaultPassword(
    args: z.infer<typeof vaultChangePasswordArgsSchema>,
  ): Promise<IpcResult<z.infer<typeof vaultStatusSchema>>>;
  setVaultDeviceUnlock(enabled: boolean): Promise<IpcResult<z.infer<typeof vaultStatusSchema>>>;
  setVaultAutoLock(minutes: number): Promise<IpcResult<z.infer<typeof vaultStatusSchema>>>;
  listVaultConversations(): Promise<
    IpcResult<z.infer<typeof vaultConversationListResultSchema>>
  >;
  readVaultConversation(
    conversationId: string,
  ): Promise<IpcResult<z.infer<typeof vaultConversationReadResultSchema>>>;
  sendVaultMessage(
    args: z.infer<typeof vaultConversationSendArgsSchema>,
  ): Promise<IpcResult<z.infer<typeof vaultConversationSendResultSchema>>>;
  deleteVaultConversation(conversationId: string): Promise<IpcResult<{ deleted: boolean }>>;
  attachVaultMedia(
    conversationId: string,
  ): Promise<IpcResult<{ attached: number }>>;
  listVaultMedia(
    conversationId: string,
  ): Promise<IpcResult<z.infer<typeof vaultMediaListResultSchema>>>;
  readVaultMedia(
    args: z.infer<typeof vaultMediaReadArgsSchema>,
  ): Promise<IpcResult<z.infer<typeof vaultMediaReadResultSchema>>>;
  generateVaultMedia(
    args: z.infer<typeof vaultMediaGenerateArgsSchema>,
  ): Promise<IpcResult<z.infer<typeof vaultMediaGenerateResultSchema>>>;
  createVaultCharacter(
    args: z.infer<typeof vaultCharacterCreateArgsSchema>,
  ): Promise<IpcResult<z.infer<typeof vaultCharacterCreateResultSchema>>>;
  /** personajes guardados en la bóveda; no los sirve la API, no los tiene */
  listVaultCharacters(): Promise<IpcResult<z.infer<typeof vaultCharacterListResultSchema>>>;
  forgetVaultCharacter(
    args: z.infer<typeof vaultCharacterForgetArgsSchema>,
  ): Promise<IpcResult<z.infer<typeof vaultCharacterListResultSchema>>>;
  /** da de alta uno que ya existe: la API no sabe listarlos */
  importVaultCharacter(
    args: z.infer<typeof vaultCharacterImportArgsSchema>,
  ): Promise<IpcResult<z.infer<typeof vaultCharacterListResultSchema>>>;
  readVaultCharacterAvatar(
    args: z.infer<typeof vaultCharacterForgetArgsSchema>,
  ): Promise<IpcResult<z.infer<typeof vaultCharacterAvatarResultSchema>>>;
  syncVault(): Promise<IpcResult<z.infer<typeof vaultSyncResultSchema>>>;
  /** avisa de que la boveda se cerro sola. devuelve la funcion de baja */
  onVaultLocked(listener: () => void): () => void;
  /** devuelve la funcion de baja; sin ella se acumulan listeners al navegar */
  onAgentEvent(listener: (event: z.infer<typeof agentEventSchema>) => void): () => void;
}

declare global {
  interface Window {
    luxy: LuxyBridge;
  }
}
