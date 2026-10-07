// contrato IPC entre el proceso principal, el preload y el renderer.
//
// REGLA INNEGOCIABLE: por aqui no pasa ningun secreto hacia el renderer. React
// puede saber si una clave esta configurada, nunca cual es. Los canales son
// verbos cerrados (getStatus, startAgent), jamas algo como exec(comando).
//
// todo argumento que llega al main se valida con zod antes de tocar logica,
// igual que la entrada de telegram en el gateway.
import { z } from 'zod';
import type { HordeQueueProgress } from './horde-progress.js';
// el vocabulario de la sonda de compatibilidad: es puro y no toca electron ni
// zod, asi que se puede nombrar desde aqui sin arrastrar nada al preload
import { REPLY_KINDS } from './refusal.js';
import {
  ACTIVE_RELATION_KINDS,
  LOCAL_CLI_PROVIDERS,
  MEMORY_RELINK_FAILURES,
  MEMORY_RELINK_OUTCOMES,
  MEMORY_RELINK_PHASES,
  PROVIDER_FAILURE_REASONS,
  REASONING_EFFORTS,
  RECAP_REFUSAL_KINDS,
  RECAP_SOURCES,
  RELATION_PARTIES,
  RELATION_STATUSES,
  VAULT_IMAGE_ATTEMPT_STATES,
  imageAttemptSchema,
  imageAttemptWarningSchema,
  vaultImagePlanEditSchema,
  type agentEventSchema,
  agentHostStatusSchema,
  catalogSnapshotSchema,
  conversationMemoryStatusSchema,
  hordeRecipeSchema,
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
  VAULT_PENDING_PACINGS,
  VAULT_RECENT_MEMORIES,
  VAULT_REPLY_GUIDANCES,
  vaultImagePlanSchema,
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

/**
 * si el aviso de presencia se ha contado.
 *
 * `false` con la ventana escondida, sin el foco o con la boveda cerrada: un
 * renderer no puede mantenerla abierta sin nadie delante (`D-106`).
 */
export const vaultPresenceResultSchema = z.object({ counted: z.boolean() });

/**
 * el ultimo fallo del PROCESO de un CLI del trabajo de fondo, sin superar
 * (`INV-FONDO-001`).
 *
 * Solo enums y horas: el proveedor, el motivo estructurado del agente y desde
 * cuando se vuelve a intentar solo. Nunca el mensaje del CLI. Es lo que deja a
 * la pantalla decir «Claude Code no tiene la sesion iniciada; ejecuta claude
 * auth login» sin parsear ningun texto.
 */
export const vaultAuxiliaryFailureSchema = z.object({
  provider: z.enum(LOCAL_CLI_PROVIDERS),
  /**
   * con que modelo y esfuerzo fallo: la espera es de ESE lanzamiento, no del CLI
   * entero, y el aviso tiene que nombrar el que falla (duodecima ronda). `null`,
   * el que trae el CLI
   */
  model: z.string().max(128).nullable(),
  effort: z.enum(REASONING_EFFORTS).nullable(),
  /** la espera es del CLI entero, con cualquier modelo: una cuenta sin sesion */
  wholeProvider: z.boolean(),
  /** `null`: fallo sin motivo estructurado (el agente parado, un tiempo agotado) */
  reason: z.enum(PROVIDER_FAILURE_REASONS).nullable(),
  at: z.string(),
  retryAt: z.string(),
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
  /**
   * hay clave guardada de AI Horde, el proveedor de imagenes gratuito.
   *
   * Va aparte de la anterior porque son dos cuentas distintas y un personaje
   * pertenece a una sola de las dos: tener la de pago no habilita el horde.
   */
  hordeConfigured: z.boolean(),
  /**
   * la clave guardada del horde es la anonima.
   *
   * Funciona y no cuesta nada, pero la red la atiende la ultima y ademas fuerza
   * `shared`, es decir, dona las imagenes a un conjunto de datos publico. La
   * pantalla tiene que poder decirlo: para una boveda privada es justo lo
   * contrario de lo que se espera.
   */
  hordeAnonymous: z.boolean(),
  /**
   * los CLI del trabajo de fondo cuyo ultimo proceso fallo y aun no ha vuelto a
   * contestar. Se van solos en cuanto uno contesta. Opcional: los handlers que
   * devuelven el estado sin pasar por el de siempre no lo traen
   */
  auxiliaryFailures: z.array(vaultAuxiliaryFailureSchema).optional(),
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
  /**
   * cuanto dejarle pensar antes de contestar.
   *
   * `null` deja lo que traiga el proveedor, que es lo de siempre. Solo lo
   * entienden los CLI nativos; una conexión HTTP lo ignora porque el contrato
   * `chat completions` no tiene dónde ponerlo.
   */
  effort: z.enum(REASONING_EFFORTS).nullable().default(null),
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

/**
 * de quien es la conversacion abierta, para la pantalla (`D-103`).
 *
 * Lo resuelve el proceso principal con la misma funcion que el prompt: la
 * pantalla no deduce nada por su cuenta.
 */
export const vaultConversationOwnerViewSchema = z.object({
  /** `none` sin dueño; `turn` si nacio con el; `link` si se engancho */
  source: z.enum(['none', 'turn', 'link']),
  /** su nombre ya resuelto; `null` sin dueño o si ya no esta en la boveda */
  label: z.string().nullable(),
  /** las respuestas con secuencia mayor se escribieron con su ficha */
  signedAfter: z.number().int().min(-1).nullable(),
  /** cuando se engancho, si se engancho */
  linkedAt: z.string().nullable(),
  /**
   * hasta que secuencia se escribio con OTRO personaje en vigor: esas
   * respuestas no se firman con su nombre (`D-108`, octava ronda). Ausente si
   * no hay ninguna
   */
  foreignUpTo: z.number().int().min(-1).optional(),
});
export type VaultConversationOwnerView = z.infer<typeof vaultConversationOwnerViewSchema>;

export const vaultConversationSummarySchema = z.object({
  conversationId: z.string(),
  title: z.string(),
  turns: z.number().int().min(0),
  updatedAt: z.string(),
  /**
   * de quién es el hilo. Es el `characterId` durable de la bóveda (`D-068`).
   *
   * `null` cuando nunca se eligió personaje, que es un grupo legítimo y no un
   * error: hay conversaciones privadas que no son de nadie.
   */
  characterId: z.string().nullable().default(null),
  /**
   * su nombre, ya resuelto aquí.
   *
   * Va junto al identificador porque la lista se agrupa por personaje y el
   * renderer no tiene forma de traducir un uuid a un nombre. `null` si el
   * personaje ya no existe: el hilo sobrevive a que lo olvides.
   */
  characterLabel: z.string().nullable().default(null),
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
  /**
   * proveedor del ultimo turno; `null` en una conversacion sin turnos.
   *
   * La pantalla lo preselecciona al abrirla. Sin esto el proveedor vivia solo
   * en memoria de la ventana y un reinicio lo devolvia al primero de la lista.
   */
  provider: z.string().nullable(),
  /** modelo del ultimo turno; `null` si nunca se eligio uno */
  model: z.string().nullable(),
  owner: vaultConversationOwnerViewSchema,
});

/**
 * enganchar (con un personaje) o soltar (con `null`) una conversacion.
 *
 * Solo el identificador: la ficha y las instrucciones las pone el proceso
 * principal desde la boveda, nunca el renderer.
 */
export const vaultConversationOwnerPreviewArgsSchema = z
  .object({
    conversationId: conversationIdSchema,
    characterId: z.string().min(1).max(128).nullable(),
  })
  .strict();

export const vaultConversationOwnerSetArgsSchema = z
  .object({
    conversationId: conversationIdSchema,
    characterId: z.string().min(1).max(128).nullable(),
    /** el proyecto donde corre la relectura de pendientes en segundo plano */
    projectAlias: z.string().min(1).max(64),
  })
  .strict();

/** lo que la confirmacion necesita saber ANTES de enseñarse */
export const vaultConversationOwnerPreviewSchema = z.object({
  /** el nombre del personaje que entra o que sale */
  characterLabel: z.string(),
  /** registros que ya tiene la conversacion */
  turns: z.number().int().min(0),
  /**
   * que pasa con las instrucciones: se cargan las del personaje, se quedan las
   * propias, el personaje no tiene, se quitan las del enganche, o se quedan.
   */
  instructionsOutcome: z.enum(['character', 'own', 'none', 'removed', 'kept']),
  /** tiene memoria sellada propia, escrita sin la ficha */
  hasOwnMemory: z.boolean(),
  /**
   * sin memoria sellada, tiene ficha retroactiva o indice con memoria: lo que
   * viaja, tambien escrito sin la ficha (septima ronda)
   */
  inheritedMemory: z.boolean(),
  /**
   * y eso viaja YA en el proximo mensaje: el indice siempre, la ficha
   * retroactiva solo aprobada, de la version actual y al dia con la cola
   * (`chooseConversationMemory`). Sin esto la confirmacion afirmaba que le
   * llegaba una ficha sin aprobar (`D-093`)
   */
  inheritedTravels: z.boolean(),
  /** el personaje tiene encendido el resumen de sus dos ultimas conversaciones */
  recentMemoriesOn: z.boolean(),
  /** la conversacion esta excluida de lo que recuerda */
  excluded: z.boolean(),
  /** quien hara la relectura de pendientes */
  backgroundCli: z.enum(LOCAL_CLI_PROVIDERS),
  /** cuantas llamadas, como mucho: una por cada 40 registros */
  reviewCalls: z.number().int().min(0),
  /** al soltar: la foto de perfil que se copio se queda entre sus imagenes */
  profilePhotoStays: z.boolean(),
});
export type VaultConversationOwnerPreview = z.infer<typeof vaultConversationOwnerPreviewSchema>;

/**
 * en que quedo la peticion de imagen de un turno.
 *
 * Tres y no mas: `done` cubre los tres finales de siempre —se genero, se
 * reenvio o fallo—, que la pantalla ya distingue con `mediaId` y `error`.
 * Añadir un estado por cada uno de esos tres seria renombrar lo que ya
 * funciona; los que hacian falta son los dos que antes no tenian forma de
 * llegar hasta aqui.
 */
export const VAULT_IMAGE_TURN_STATES = ['done', 'pending', 'malformed'] as const;
export type VaultImageTurnState = (typeof VAULT_IMAGE_TURN_STATES)[number];

export const vaultConversationSendResultSchema = z.object({
  conversationId: z.string(),
  outcome: z.enum(['completed', 'failed', 'cancelled']),
  turns: z.array(vaultConversationTurnSchema),
  instructions: z.string().nullable(),
  characterId: z.string().nullable(),
  characterDescription: z.string().nullable(),
  /** proveedor con el que se respondio; queda fijado para la conversacion */
  provider: z.string().nullable(),
  /** modelo con el que se respondio, tal y como lo ejecuto el agente */
  model: z.string().nullable(),
  owner: vaultConversationOwnerViewSchema,
  /**
   * que le paso al bloque de memoria en este turno.
   *
   * Se calculaba y se tiraba. Sin esto, un modelo que escribe mal el bloque deja
   * la conversacion sin actualizar la memoria —se conserva la anterior, que es
   * lo correcto— y el usuario solo lo nota semanas despues, como «se le olvidan
   * cosas», sin poder atribuirlo al cambio de modelo.
   */
  /**
   * cómo salió el bloque de memoria de ESTE turno.
   *
   * `null` cuando la llamada ni siquiera llegó a completarse. No es lo mismo
   * que `absent`: un turno fallido dejaba `absent`, y la pantalla lo leía como
   * «ese modelo no está escribiendo bien el bloque de memoria», culpando al
   * modelo de algo que nunca ocurrió. El error de la llamada ya lo explica.
   */
  memoryStatus: conversationMemoryStatusSchema.nullable(),
  /**
   * si el mensaje del usuario sobrevivio a este turno.
   *
   * `false` cuando el modelo no devolvio nada: el turno se retira para que el
   * historial no acumule mensajes sin contestacion, y la pantalla debe conservar
   * el texto en el compositor en vez de obligar a reescribirlo.
   */
  userTurnKept: z.boolean(),
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
      /**
       * en qué se cuenta ese número.
       *
       * No es cosmético: los créditos del proveedor de pago se compran con
       * dinero y los kudos de AI Horde no. Enseñar «12 créditos» después de una
       * generación gratuita se lee como que la opción gratis está cobrando.
       */
      costUnit: z.enum(['creditos', 'kudos']).nullable().default(null),
      error: z.string().nullable(),
      /**
       * en que quedo la peticion, que no es lo mismo que si hay imagen.
       *
       * `done` es el camino de siempre —se mando, se reenvio o fallo— y se
       * distingue con `mediaId` y `error`, como hasta ahora. Los otros dos son
       * estados que antes no existian y que sin nombre propio se leian como un
       * turno sin imagen: `pending` es que el texto esta compuesto y esperando
       * a que una persona lo apruebe, y `malformed` es que ella SI pidio una
       * imagen y el bloque llego cortado o mal escrito —hoy invisible, porque
       * nadie miraba el `status` del parser—.
       */
      state: z.enum(VAULT_IMAGE_TURN_STATES).default('done'),
      /**
       * el intento en el registro cifrado, para poder mirarlo despues.
       *
       * Es un uuid y nada mas: el texto del plan no viaja en el error ni en el
       * log, se lee del registro con este identificador.
       */
      attemptId: z.string().nullable().default(null),
      /**
       * lo que se va a mandar, entero, para el panel de revision.
       *
       * Solo viaja en memoria main -> renderer y solo cuando hay algo que
       * decidir. No se escribe en ningun sitio por este camino: en disco vive
       * cifrado dentro del intento.
       */
      plan: vaultImagePlanSchema.nullable().default(null),
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

/**
 * comprobar que modelos sirven para una conversacion.
 *
 * La sonda es la propia conversacion, que ya esta cifrada en la boveda: no viaja
 * ningun texto desde el renderer y no hay nada que guardar en el repositorio.
 * Es de SOLO LECTURA — no añade turnos ni toca la memoria.
 */
export const vaultCompatibilityArgsSchema = z.object({
  conversationId: conversationIdSchema,
  /** el turno se ejecuta dentro de un proyecto, igual que uno normal */
  projectAlias: projectAliasSchema,
  targets: z
    .array(
      z.object({
        provider: z.string().min(1).max(64),
        /** `null` deja decidir a la conexion, como en un turno normal */
        model: z.string().max(128).nullable().default(null),
        /** y su esfuerzo, que es parte de lo que se esta comparando */
        effort: z.enum(REASONING_EFFORTS).nullable().default(null),
      }),
    )
    .min(1)
    .max(12),
  /**
   * veces que se prueba cada modelo.
   *
   * Una negativa depende del prompt y de la suerte, asi que una sola muestra es
   * un sondeo y no una prueba. Se deja a la vista para que nadie confunda «no me
   * lo rechazo una vez» con «no me lo rechaza».
   */
  repetitions: z.number().int().min(1).max(5).default(1),
});

/**
 * tope de lo que se conserva de CADA respuesta.
 *
 * Un turno privado ronda los 1.500 caracteres, asi que con 2.000 la respuesta
 * normal llega ENTERA —que es el caso que hay que poder juzgar— y lo unico que
 * se recorta es la desbocada, de la que los primeros 2.000 ya dicen como
 * escribe. Con los topes del sondeo —12 modelos por 5 repeticiones— el peor
 * caso son 120.000 caracteres en un viaje de IPC que ya mueve fichas de memoria
 * enteras: el tope no esta por el transporte, esta para que un modelo que no
 * para de escribir no convierta el panel en un muro.
 */
export const VAULT_COMPATIBILITY_REPLY_CHARS = 2000;

/**
 * lo que se añade cuando el recorte es NUESTRO.
 *
 * Misma regla que el razonamiento del describidor: un corte mudo es
 * indistinguible de un modelo que se quedo sin salida, y son dos averias
 * distintas. Si el corte es nuestro, se dice.
 */
export const VAULT_COMPATIBILITY_TRIM_MARK = ' […recortado por Luxy]';

/**
 * lo que escribio un modelo en UNA de las repeticiones.
 *
 * `text` es CONTENIDO DE LA BOVEDA. Viaja al renderer como cualquier turno —se
 * enseña y se tira, no se guarda en ningun sitio— y no puede acabar en ningun
 * registro, ni en un mensaje de error, ni en un extracto de fallo: a los logs
 * van CIFRAS. Es el mismo camino que el `preview` de la pasada retroactiva.
 */
export const vaultCompatibilityReplySchema = z.object({
  /** cual de las repeticiones, desde 1. Un intento que ni corrio no deja entrada */
  attempt: z.number().int().min(1).max(5),
  /** la misma clasificacion que ya alimenta los contadores de arriba */
  kind: z.enum(REPLY_KINDS),
  /** CONTENIDO DE LA BOVEDA, recortado a `VAULT_COMPATIBILITY_REPLY_CHARS` */
  text: z.string().max(VAULT_COMPATIBILITY_REPLY_CHARS),
  /** cuanto escribio de verdad, ANTES de nuestro recorte */
  chars: z.number().int().min(0),
  /**
   * cuantos caracteres DEL MODELO sobreviven en `text`, sin contar la marca.
   *
   * Va calculado desde aqui y no se deduce en la pantalla porque la marca se
   * pega DENTRO del tope (`trimWithMark` reserva su hueco): quien reste mal se
   * queda con una nota que dice «guardó los primeros 2000» de un texto en el
   * que 22 de esos caracteres los escribimos nosotros. Sin recorte es lo mismo
   * que `chars`; el renderer no tiene que saber que existe una marca.
   */
  kept: z.number().int().min(0),
  /** true si lo que se enseña lo cortamos nosotros */
  clipped: z.boolean(),
});

export const vaultCompatibilityResultSchema = z.object({
  results: z.array(
    z.object({
      provider: z.string(),
      model: z.string().nullable(),
      answered: z.number().int().min(0),
      refused: z.number().int().min(0),
      empty: z.number().int().min(0),
      /** que delato la negativa, cuando la hubo */
      signals: z.array(z.string()).max(20),
      /** si ademas escribio bien el bloque de memoria */
      memoryOk: z.number().int().min(0),
      error: z.string().nullable(),
      /**
       * lo que escribio cada vez. CONTENIDO DE LA BOVEDA.
       *
       * Sin esto la sonda solo contestaba «¿este modelo colabora con lo mio?», y
       * la pregunta de hoy es «¿cual escribe mejor?», que no se responde con
       * cifras: hay que LEERLOS.
       *
       * Va una entrada por REPETICION y no una sola con un contador: las
       * repeticiones existen porque la respuesta varia entre intentos, asi que
       * enseñar una y decir «y otras dos» escondia justo lo que se mide.
       */
      replies: z.array(vaultCompatibilityReplySchema).max(5).default([]),
    }),
  ),
});

/**
 * los recuerdos que tiene el personaje.
 *
 * Existe para diagnosticar: si no se acuerda de algo, hay que poder ver por
 * que. No sirve para crearlos —eso es automatico— sino para mirar y excluir.
 */
export const vaultMemoryEpisodeSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  from: z.number().int().min(0),
  to: z.number().int().min(0),
  date: z.string(),
  title: z.string(),
  turns: z.number().int().min(0),
  /**
   * con que modelo se catalogo, o `null` si la escena se dedujo por silencios.
   *
   * Se enseña porque catalogar manda la conversacion ENTERA a ese proveedor, y
   * eso es una decision del usuario que no debe tomarse sin que la vea.
   */
  catalogedBy: z.string().nullable(),
});

export const vaultMemoryListResultSchema = z.object({
  episodes: z.array(vaultMemoryEpisodeSchema),
  /** conversaciones que hoy quedan fuera del banco */
  excluded: z.array(z.string()),
});

export const vaultMemoryReadArgsSchema = z.object({
  conversationId: conversationIdSchema,
  from: z.number().int().min(0),
  to: z.number().int().min(0),
});

export const vaultMemoryReadResultSchema = z.object({
  turns: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string() })),
});

export const vaultMemoryExcludeArgsSchema = z.object({
  conversationId: conversationIdSchema,
  excluded: z.boolean(),
});

/**
 * cataloga las conversaciones que lo necesiten.
 *
 * Una llamada por conversacion sin catalogar, no por turno. Es automatico: lo
 * dispara la pantalla al abrirse, no un boton, porque un cerebro no se llena a
 * botonazos.
 */
export const vaultCatalogSyncArgsSchema = z.object({
  provider: z.string().min(1).max(64),
  model: z.string().max(128).nullable().default(null),
  /**
   * cuanto dejarle pensar en CADA conversacion del lote.
   *
   * Aqui es donde mas se nota: catalogar no es una llamada, son `limit`
   * llamadas seguidas, asi que el esfuerzo se multiplica por la tanda.
   */
  effort: z.enum(REASONING_EFFORTS).nullable().default(null),
  projectAlias: projectAliasSchema,
  /** solo esta; sin ella, todas las que lo necesiten */
  conversationId: conversationIdSchema.optional(),
  /** tope de conversaciones por tanda: cada una es una llamada de verdad */
  limit: z.number().int().min(1).max(10).default(3),
  /**
   * la pide un boton: puede lanzar el CLI UNA vez aunque este en espera tras un
   * fallo de su proceso (`INV-FONDO-001`). La apertura del panel no la manda, y
   * los botones solo en su primera llamada: si no, un CLI roto se arrancaria
   * una vez por conversacion fallida
   */
  retryNow: z.boolean().default(false),
});

/**
 * apunta las promesas y los planes que quedaron pendientes.
 *
 * No lleva proveedor: el trabajo de fondo va SIEMPRE al CLI elegido en el panel,
 * nunca al de la ventana. Por eso aqui solo viaja en que proyecto corre.
 */
export const vaultRelationSyncArgsSchema = z.object({
  projectAlias: projectAliasSchema,
  /** solo esta, y reintentandola aunque se hubiera negado antes */
  conversationId: conversationIdSchema.optional(),
  /** tope de conversaciones por tanda: cada una es una llamada de verdad */
  limit: z.number().int().min(1).max(10).default(3),
  /**
   * pedida a mano: se reintenta lo que se nego o fallo antes.
   *
   * Existe porque sin ella una negativa no tenia salida desde ninguna pantalla.
   * Solo la manda el boton, y solo en su primera vuelta: repetirla en las doce
   * volveria a arrancar el CLI para las mismas conversaciones rotas.
   */
  force: z.boolean().default(false),
});

export const vaultRelationSyncResultSchema = z.object({
  /**
   * conversaciones cuyo cursor avanzo.
   *
   * No basta para decidir si dar otra vuelta: una tanda entera negada no avanza
   * ningun cursor y la siguiente coge OTRAS tres conversaciones, porque las
   * negadas quedan marcadas. Lo que dice que no vale la pena seguir es que no
   * pase nada de nada: ni revisadas, ni negativas, ni fallos.
   */
  reviewed: z.number().int().min(0),
  /** promesas y planes nuevos apuntados */
  notes: z.number().int().min(0),
  /** los que esta tanda dio por cerrados */
  closed: z.number().int().min(0),
  /** conversaciones que no contestaron con el bloque pedido */
  refused: z.number().int().min(0),
  failed: z.array(z.object({ conversationId: z.string(), reason: z.string() })),
  /** cuantas siguen por revisar AL TERMINAR esta tanda, recalculado */
  pending: z.number().int().min(0),
  /**
   * de la tanda, las que no se mandaron porque el CLI espera tras un fallo de su
   * proceso. Siguen en `pending`. Opcional: una tanda anterior no la trae
   */
  waiting: z.number().int().min(0).optional(),
});

/**
 * un pendiente tal y como se repasa.
 *
 * Lleva la CITA LITERAL a proposito: es lo unico con lo que se puede juzgar si
 * de verdad se prometio algo, y sin ella la lista solo diria «hay 9 promesas».
 * Viaja al renderer igual que los turnos de una conversacion, que ya son texto
 * descifrado de la misma boveda; lo que no sale de aqui nunca son las palabras
 * clave del extractor, que solo sirven para callarla antes.
 */
export const vaultRelationNoteSchema = z.object({
  id: z.string(),
  /** de quien es; `null` son los hilos que nunca tuvieron personaje */
  characterId: z.string().nullable(),
  kind: z.enum(ACTIVE_RELATION_KINDS),
  by: z.enum(RELATION_PARTIES),
  quote: z.string(),
  /** el dia civil en que se prometio, con el corte de las 05:00 */
  day: z.string(),
  status: z.enum(RELATION_STATUSES),
  /** el extractor nunca pisa lo que decidio Daniel */
  decidedBy: z.enum(['extractor', 'daniel']),
  reopenedByDaniel: z.boolean(),
  /** con que CLI se reviso: «revisado con Codex» */
  extractedBy: z.string().nullable(),
  /** el turno al que apunta; con el se abre y se lee en su contexto */
  origin: z.object({ conversationId: z.string(), sequence: z.number().int().min(0) }),
  /**
   * la cita ya no aparece en su turno.
   *
   * Una nota asi no se le ofrece a ella. Se enseña porque es la unica forma de
   * entender por que un pendiente que esta en la lista no sale nunca.
   */
  quoteBroken: z.boolean(),
  closedDay: z.string().nullable(),
});

export const vaultRelationListResultSchema = z.object({
  notes: z.array(vaultRelationNoteSchema),
});

/**
 * la ultima palabra de Daniel sobre un pendiente.
 *
 * El estado ES la decision: `fulfilled` (cumplida), `released` (ya no vale),
 * `dismissed` (no era una promesa) y `open` (reabrir). Un enum aparte acabaria
 * separandose del que guarda el almacen, y entonces un boton dejaria de hacer
 * lo que dice.
 *
 * No hay alta a mano: toda promesa señala un turno con una cita verificada, y
 * una escrita a mano no tendria contra que comprobarse.
 */
export const vaultRelationUpdateArgsSchema = z.object({
  /** los 16 hex deterministas de la nota */
  id: z.string().regex(/^[0-9a-f]{16}$/),
  status: z.enum(RELATION_STATUSES),
});

/**
 * rellena hacia atras la memoria acumulativa de las conversaciones viejas.
 *
 * Como la de pendientes, no lleva proveedor: el trabajo de fondo va SIEMPRE al
 * CLI elegido en el panel, nunca al de la ventana, y nunca a una API de pago.
 */
export const vaultRecapSyncArgsSchema = z.object({
  projectAlias: projectAliasSchema,
  /** solo esta, y empezandola desde cero si ademas viene `force` */
  conversationId: conversationIdSchema.optional(),
  /**
   * tope de conversaciones por tanda.
   *
   * Dos, y no tres como los pendientes, porque aqui una sola conversacion puede
   * gastar varias llamadas: una ventana por cada cuarenta turnos. Es el mismo
   * numero que `RECAP_DEFAULT_LIMIT` en la pasada, repetido aqui porque esta
   * capa no puede importar del proceso principal; la prueba lo fija.
   */
  limit: z.number().int().min(1).max(10).default(2),
  /**
   * pedida a mano: es «Rehacerlo».
   *
   * No solo se salta la negativa persistida, ademas empieza la conversacion
   * desde cero. Sin eso, una ya cubierta con huecos no se podria reintentar con
   * el otro CLI, que es justo lo que promete el boton.
   */
  force: z.boolean().default(false),
  /**
   * corre la pasada entera y NO guarda nada.
   *
   * Es lo unico que contesta a la vez «¿se niegan los CLI?» y «¿sale bueno el
   * resumen?», y hoy no hay en todo el repositorio ni una medida de negativa de
   * Claude o de Codex sobre esta boveda. Lo que devuelve es contenido de la
   * boveda: viaja al renderer como cualquier turno, y a ningun registro.
   */
  dryRun: z.boolean().default(false),
  /**
   * la pide un boton en esta vuelta: puede lanzar el CLI UNA vez aunque este en
   * espera tras un fallo de su proceso (`INV-FONDO-001`). Solo en la primera de
   * las doce vueltas del panel, como `force`
   */
  retryNow: z.boolean().default(false),
});

/**
 * lo que se HABRIA guardado, para poder leerlo antes de decidir.
 *
 * Solo viene con `dryRun`. `block` es el texto ya renderizado de la ficha, o
 * sea contenido descifrado de la boveda: se enseña y se tira, nunca se registra.
 */
export const vaultRecapPreviewSchema = z.object({
  conversationId: z.string(),
  block: z.string(),
  source: z.enum(RECAP_SOURCES),
  covered: z.object({
    from: z.number().int().min(0),
    to: z.number().int().min(0),
  }),
  /** tramos que el CLI prefirio no resumir: declararlos es un EXITO */
  gaps: z.number().int().min(0),
  chars: z.number().int().min(0),
  /**
   * la CLASIFICACION de lo que paso, jamas el texto.
   *
   * A este CLI se le ha pedido describir la escena, asi que lo que conteste en
   * lugar de la ficha puede citarla. La clasificacion da la misma informacion
   * operativa —que boton pulsar— sin traerse nada de la conversacion.
   */
  refusedKind: z.enum(RECAP_REFUSAL_KINDS).nullable(),
});

export const vaultRecapSyncResultSchema = z.object({
  /** conversaciones cuya ficha se escribio o se amplio */
  reviewed: z.number().int().min(0),
  /** llamadas al CLI: una por ventana */
  windows: z.number().int().min(0),
  /** ventanas que salieron enteras */
  ok: z.number().int().min(0),
  /** ventanas con tramos declarados. Es un EXITO: el hueco viaja al prompt */
  partial: z.number().int().min(0),
  /** conversaciones que se quedaron en el indice deducido, sin llamar a nadie */
  deduced: z.number().int().min(0),
  /** ventanas en las que el CLI se nego */
  refused: z.number().int().min(0),
  /** ventanas que obedecieron y sanearon: el caso peor, porque valida */
  vague: z.number().int().min(0),
  /** ventanas cuyo bloque no se pudo leer: ausente, cortado o mal formado */
  invalid: z.number().int().min(0),
  failed: z.array(z.object({ conversationId: z.string(), reason: z.string() })),
  /**
   * de la tanda, las que no se mandaron porque el CLI espera tras un fallo de su
   * proceso (`INV-FONDO-001`). Opcional: una tanda anterior no la trae
   */
  waiting: z.number().int().min(0).optional(),
  /** conversaciones que ya tenian memoria propia: la sellada gana siempre */
  superseded: z.number().int().min(0),
  gaps: z.number().int().min(0),
  /** turnos que no se enseñaron enteros. Con el presupuesto de hoy es 0 */
  clipped: z.number().int().min(0),
  kept: z.number().int().min(0),
  rewritten: z.number().int().min(0),
  dropped: z.number().int().min(0),
  /** lo que las ventanas encadenadas APORTARON: sin esto una esteril parece perfecta */
  added: z.number().int().min(0),
  /** suma de los bloques renderizados: lo que se paga en cada turno futuro */
  chars: z.number().int().min(0),
  /**
   * las que siguen por rellenar AL TERMINAR la tanda, recalculado.
   *
   * Como en los pendientes, no basta para decidir si dar otra vuelta: una tanda
   * entera negada no avanza ningun cursor. Lo que dice que pare es que no pase
   * nada de nada.
   */
  pending: z.number().int().min(0),
  provider: z.enum(LOCAL_CLI_PROVIDERS),
  /** true si la preferencia guardada pedia un proveedor de pago y se sustituyo */
  replaced: z.boolean(),
  /** vacio salvo con `dryRun` */
  preview: z.array(vaultRecapPreviewSchema).default([]),
});

/**
 * una conversacion rellenada, tal y como se repasa.
 *
 * Lleva el bloque ENTERO a proposito, igual que los pendientes llevan la cita:
 * es lo unico con lo que se puede juzgar si lo escrito vale, y desde el primer
 * turno nuevo el modelo de pago lo va a arrastrar para siempre. Lo que no sale
 * de aqui nunca es lo que dijo el CLI cuando se nego a escribirlo.
 */
export const vaultRecapRowSchema = z.object({
  conversationId: z.string(),
  /** el mismo que se ve en la lista de Privado */
  title: z.string(),
  /** el dia civil del ultimo turno, con el corte de las 05:00 */
  day: z.string(),
  /** «cubre 40 de 65»: turnos cubiertos por la ficha y turnos que hay */
  covered: z.number().int().min(0),
  turns: z.number().int().min(0),
  /** `formatConversationMemory` de la ficha; cadena vacia si no hay nada que leer */
  block: z.string(),
  /**
   * la memoria SELLADA de esa conversacion, la que de verdad viaja hoy.
   *
   * Nada que ver con `block`, que es la ficha retroactiva: en una conversacion
   * sellada `block` es papel muerto —ya no entra en ningun prompt— y esto es lo
   * unico que ella lee. Viaja porque sin ello no habia NINGUNA via de leerlo: la
   * fila sellada sin ficha previa se quedaba sin un solo boton, y la que si
   * tenia ficha ofrecia un «Ver» que enseñaba la muerta sin avisar.
   *
   * Sale de la `latestMemory` que `readRecapList` ya descifra para saber si esta
   * sellada, asi que no cuesta ni un descifrado mas. Cadena vacia cuando no hay
   * memoria sellada.
   */
  sealedBlock: z.string(),
  chars: z.number().int().min(0),
  source: z.enum(RECAP_SOURCES),
  /** tramos declarados que nadie resumio: de esos no se sabe nada */
  gaps: z.number().int().min(0),
  approved: z.boolean(),
  /**
   * estaba aprobada y el trabajo de fondo la reescribio.
   *
   * No es un matiz de `approved`: es la unica forma de distinguir una ficha que
   * nadie ha aprobado todavia de una cuya aprobacion se ha perdido. La segunda
   * ha dejado de viajar en los prompts de ese hilo, y hasta ahora eso pasaba sin
   * una palabra en pantalla. El disparador tipico es borrar la memoria sellada:
   * devuelve la conversacion a la pasada, que amplia la ficha ya aprobada.
   */
  approvalReset: z.boolean(),
  /** con que CLI se escribio: «revisado con Codex» */
  provider: z.enum(LOCAL_CLI_PROVIDERS).nullable(),
  model: z.string().nullable(),
  at: z.string(),
  /**
   * que paso, clasificado. NUNCA lo que contesto el modelo.
   *
   * La fila de un fallo se enseña con el dia, el numero de mensajes y esto; el
   * titulo se queda fuera, porque una negativa no tiene por que decir de que iba
   * la conversacion.
   */
  refusedKind: z.enum(RECAP_REFUSAL_KINDS).nullable(),
  /** a que CLI se le nego: el boton de reintentar apunta al OTRO por su nombre */
  refusedProvider: z.enum(LOCAL_CLI_PROVIDERS).nullable(),
  /** ya tiene memoria sellada viva: el relleno no la toca y se marco */
  superseded: z.boolean(),
  /**
   * esa conversacion tiene memoria sellada AHORA MISMO.
   *
   * No es lo mismo que `superseded`, que es la marca que estampa la pasada: en
   * cuanto Daniel contesta un turno de un hilo sin aprobar, ese turno sella su
   * propia memoria y la ficha deja de poder entrar, pero la marca no llega
   * hasta la pasada siguiente. Sin esto, entre medias la fila decia «aprobada,
   * pero todavia no llega hasta los ultimos turnos», que es falso: no llega
   * porque la conversacion ya tiene memoria propia, y la sellada gana siempre.
   */
  sealed: z.boolean(),
  /**
   * excluida a mano del trabajo de fondo.
   *
   * Excluir no borra su ficha ni se la quita a su propio hilo —el turno no
   * consulta las exclusiones—, solo la saca de la pasada. La fila lo dice para
   * que «en uso» no parezca contradecir a un «Rehacerlo» que ahi no haria nada.
   */
  excluded: z.boolean(),
  /**
   * hay una entrada suya en el almacen.
   *
   * Falso en las filas de una conversacion que todavia no se ha leido nunca.
   * Existen para contestar «¿cuales quedaron sin resumir?», que antes solo era
   * un numero, y sobre todo para que una conversacion que ni se pudo leer ni se
   * pudo guardar tenga desde donde reintentarse: el aviso mandaba pulsar
   * «Rehacerlo» en una fila que no existia.
   */
  hasEntry: z.boolean(),
  /**
   * si hoy viajaria de verdad en el prompt.
   *
   * No es lo mismo que tener ficha: una sin aprobar, o una que no llega hasta la
   * cola literal, existe y no se usa. Se calcula con la MISMA funcion que decide
   * en el turno, para que el panel no pueda decir «resumida» de algo que el
   * turno esta descartando.
   */
  inPrompt: z.boolean(),
  /**
   * borrar la memoria propia haria que su ficha retroactiva EMPEZARA a viajar.
   *
   * `chooseConversationMemory` solo antepone la sellada: en cuanto desaparece,
   * la ficha de esa MISMA conversacion vuelve a ser candidata. O sea que borrar
   * no siempre limpia —a veces cambia un texto por otro— y eso hay que decirlo
   * ANTES de pulsar, no despues. Es el mismo calculo que `inPrompt`, hecho sin
   * la sellada: si la conversacion no esta sellada esto es siempre `false`,
   * porque entonces no hay nada que borrar que pueda destapar nada.
   */
  cardRevivesOnForget: z.boolean(),
  /**
   * en que punto esta la reescritura de su memoria con la ficha, si es una
   * conversacion enganchada (`D-108`). Opcional: `null` o ausente en las que no
   * lo son. Con ella, `sealedBlock` es la memoria EFECTIVA —la que viaja—, y
   * `previousBlock` la de antes mientras todavia se puede volver a ella.
   */
  relink: z
    .object({
      phase: z.enum(MEMORY_RELINK_PHASES),
      /** con quien se hizo o se intento por ultima vez */
      provider: z.enum(LOCAL_CLI_PROVIDERS).nullable(),
      failure: z.enum(MEMORY_RELINK_FAILURES).nullable(),
      drift: z
        .object({
          kept: z.number().int().min(0),
          rewritten: z.number().int().min(0),
          dropped: z.number().int().min(0),
          shortened: z.number().int().min(0),
          added: z.number().int().min(0),
          /** si cambio el resumen; ausente en las filas de antes de la septima ronda */
          summaryChanged: z.boolean().optional(),
        })
        .nullable(),
      at: z.string().nullable(),
      /** la memoria sellada de antes, solo mientras se puede volver a ella */
      previousBlock: z.string(),
      /** hay texto reescrito guardado: «Borrar su memoria» lo borra tambien */
      holdsRewrite: z.boolean(),
      /**
       * si tiene memoria sellada. Una pendiente sin ella viaja con su ficha
       * retroactiva o su indice, y no hay nada que reescribir hasta que su
       * primera respuesta guarde memoria (septima ronda)
       */
      hasMemory: z.boolean(),
      /**
       * el CLI que toca esta en espera tras un fallo de su proceso: se retoma
       * solo pasada la espera, y la pantalla no puede prometer «despues de tu
       * proximo mensaje» a secas (septima ronda, `INV-FONDO-001`)
       */
      stalled: z.boolean(),
      /**
       * su proceso falla por su cuenta con el CLI que toca: es de ella, y no se
       * reintenta sola en un par de horas (undecima y decimotercera ronda; el
       * nombre es de cuando era hasta reiniciar). Opcional: una vista anterior
       * no lo trae
       */
      blockedThisSession: z.boolean().optional(),
    })
    .nullable()
    .optional(),
});

/**
 * la linea de cobertura, y sus numeros SUMAN.
 *
 * `summarized + withGaps + indexOnly + awaitingApproval + missing + sealed ===
 * total - excluded`. Si no cuadra es un fallo, no un redondeo.
 */
export const vaultRecapCoverageSchema = z.object({
  total: z.number().int().min(0),
  excluded: z.number().int().min(0),
  /** con ficha completa de un CLI, aprobada y al dia */
  summarized: z.number().int().min(0),
  /** con ficha, pero con tramos que nadie resumio */
  withGaps: z.number().int().min(0),
  /** solo el indice deducido: NO cuenta como cobertura */
  indexOnly: z.number().int().min(0),
  /**
   * escritas y esperando que Daniel las lea y las apruebe.
   *
   * Sin este cajon, la linea decia «17 sin leer» justo despues de la pasada que
   * escribia las diecisiete, que es lo contrario de lo que habia pasado.
   */
  awaitingApproval: z.number().int().min(0),
  /** sin nada que pueda viajar; conserva el aviso de turnos omitidos, que es el estado seguro */
  missing: z.number().int().min(0),
  /** las que ya tenian memoria propia */
  sealed: z.number().int().min(0),
});

export const vaultRecapListResultSchema = z.object({
  rows: z.array(vaultRecapRowSchema),
  coverage: vaultRecapCoverageSchema,
});

/**
 * la ultima palabra de Daniel sobre una ficha.
 *
 * Tres verbos y ninguna edicion libre: `approve` la deja entrar en el prompt,
 * `approve-all` hace lo mismo con todas las que esperan —son diecisiete textos
 * cortos—, y `forget` borra la entrada y devuelve esa conversacion a su aviso de
 * turnos omitidos, que es el estado seguro. Eso hace el trabajo reversible.
 *
 * Es una union discriminada, y ESTRICTA, y las dos cosas por lo mismo: que
 * `approve-all` no pueda llegar con un `conversationId` que nadie mire ni
 * `approve` con un texto que nadie escriba. Sin `strict` un campo de mas se
 * descarta en silencio, y entonces un boton dice una cosa y hace otra; con el,
 * el fallo del que llama se ve en vez de aprobar diecisiete fichas.
 */
export const vaultRecapUpdateArgsSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve'), conversationId: conversationIdSchema }).strict(),
  z.object({ action: z.literal('forget'), conversationId: conversationIdSchema }).strict(),
  z.object({ action: z.literal('approve-all') }).strict(),
]);

/**
 * lo que Daniel decide sobre la memoria reescrita con la ficha (`D-108`).
 *
 * Dos verbos: `keep-old` vuelve a la sellada de antes —solo mientras la
 * reescrita siga atada a ella, es decir, hasta el siguiente mensaje que selle
 * memoria—, y `retry` la vuelve a pedir al CLI aunque se hubiera negado.
 * Estricto, como `vaultRecapUpdateArgsSchema`.
 */
export const vaultMemoryRelinkDecideArgsSchema = z
  .object({
    conversationId: conversationIdSchema,
    choice: z.enum(['keep-old', 'retry']),
    projectAlias: z.string().min(1).max(64),
  })
  .strict();

/**
 * la lista entera y, al reescribir, en que acabo la pasada. Sin eso un CLI que
 * no arranca o una respuesta que llega tarde dejaban la fila igual y sin una
 * palabra (septima ronda). `null` al volver a la de antes.
 */
export const vaultMemoryRelinkDecideResultSchema = vaultRecapListResultSchema.extend({
  relinkOutcome: z.enum(MEMORY_RELINK_OUTCOMES).nullable(),
});

/**
 * lo que deja el borrado de la memoria propia de una conversacion.
 *
 * Devuelve la lista entera —como `vaultRecapUpdate`— para que la pantalla no
 * tenga que volver a pedirla y pueda quedarse sin saber si el borrado prendio.
 *
 * `cleared` son TURNOS, no conversaciones: la memoria se vuelve a sellar en
 * cada turno que la trae buena, asi que una conversacion larga guarda muchas
 * copias y la que manda es la ultima. Cero no es un fallo: significa que esa
 * conversacion no tenia memoria propia.
 */
export const vaultSealedMemoryForgetResultSchema = vaultRecapListResultSchema.extend({
  cleared: z.number().int().min(0),
});

/**
 * quien hace el trabajo de fondo de la boveda.
 *
 * Solo Claude o Codex, que van con la sesion local: con la API de pago de la
 * ventana, catalogar costaba una llamada por conversacion pendiente.
 */
export const vaultAuxiliaryChoiceSchema = z.object({
  provider: z.enum(LOCAL_CLI_PROVIDERS),
  model: z.string().max(128).nullable(),
});

export const vaultAuxiliaryGetArgsSchema = z.object({});

/** `null` vuelve a lo automatico */
export const vaultAuxiliarySetArgsSchema = z.object({
  choice: vaultAuxiliaryChoiceSchema.nullable(),
});

export const vaultCatalogSyncResultSchema = z.object({
  cataloged: z.number().int().min(0),
  scenes: z.number().int().min(0),
  /**
   * las que se intentaron y no salieron, con el motivo.
   *
   * `process` dice que lo que fallo fue el PROCESO del CLI, no la respuesta:
   * esas no se quedan fuera hasta reiniciar, se reintentan solas pasada la
   * espera (`INV-FONDO-001`), y su motivo es el mensaje de Luxy, nunca lo que
   * escribio el CLI.
   *
   * `blocked` dice que su proceso falla por su cuenta: la espera la da por suya
   * y la pasada sola la salta un par de horas, despues de las cuales se prueba
   * una vez (decimotercera ronda). No lleva `process`: no se reintenta en
   * minutos, y la pantalla no lo promete. Sin ninguno de los dos, fallo por la
   * respuesta y no se reintenta sola en la sesion
   */
  failed: z.array(
    z.object({
      conversationId: z.string(),
      reason: z.string(),
      process: z.boolean().optional(),
      blocked: z.boolean().optional(),
    }),
  ),
  /**
   * de la tanda, las que no se mandaron porque el CLI espera tras un fallo de su
   * proceso. Siguen en `pending`. Opcional por compatibilidad
   */
  waiting: z.number().int().min(0).optional(),
  /**
   * cuantas quedan por catalogar despues de esta tanda.
   *
   * Se devuelve porque sin esto la pantalla no puede distinguir «esta acabando
   * una cola» de «esta repitiendo lo mismo cada vez», que es exactamente la
   * confusion que produjo no enseñarlo. Es la cola entera aunque se pida una
   * sola conversacion: lo que falta por ordenar, no lo que falta de lo pedido
   */
  pending: z.number().int().min(0),
  /**
   * catálogos que parecen cortados por longitud y no por lo que pasa.
   *
   * Cuando todas las escenas salen del mismo tamaño —seis de cuatro turnos,
   * por ejemplo— no es que la conversación fuera así: es que el modelo no
   * encontró dónde cortar y repartió. El catálogo **se conserva**, porque uno
   * tosco es mejor que ninguno; esto sólo permite avisar y ofrecer repetirlo
   * con otro modelo.
   */
  uneven: z.array(z.object({ conversationId: z.string(), scenes: z.number().int() })),
  /**
   * cuales se ordenaron en esta tanda. La pantalla junta las vueltas de una
   * pasada, y sin esto no podia quitar de su aviso una conversacion que una
   * vuelta anterior dio por fallida y esta ha ordenado. Opcional por
   * compatibilidad (undecima ronda)
   */
  catalogedIds: z.array(z.string()).optional(),
  /**
   * el CLI que lo hizo. La pantalla mira SU espera para retomar sola una pasada
   * que se quedo esperando a que el CLI volviera (undecima ronda). Opcional
   */
  provider: z.enum(LOCAL_CLI_PROVIDERS).nullable().optional(),
  /**
   * y con que modelo y esfuerzo: la espera va por lanzamiento, y la de otro
   * modelo del mismo CLI no dice nada de esta pasada (duodecima ronda). Opcional
   */
  model: z.string().max(128).nullable().optional(),
  effort: z.enum(REASONING_EFFORTS).nullable().optional(),
});

export const vaultMediaAttachArgsSchema = z.object({
  conversationId: conversationIdSchema,
  /**
   * que hay en el archivo, escrito por el usuario.
   *
   * Sin esto, adjuntar solo servia para guardar: el modelo veia el nombre del
   * fichero y nada mas, asi que no podia comentar la imagen ni tenerla en
   * cuenta. Va al mismo campo que la descripcion de una imagen generada, que es
   * el que despues leeria un describidor automatico.
   */
  caption: z.string().max(500).default(''),
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
  /**
   * lo que se VE en el archivo, y lo único que el modelo sabe de él.
   *
   * Viaja al renderer porque hasta ahora el usuario no podía ni verlo ni
   * corregirlo: el modelo elegía qué foto reenviarte a partir de una línea
   * invisible. `null` cuando nadie lo ha escrito.
   */
  caption: z.string().nullable().default(null),
  /**
   * lo que se PIDIÓ al generarlo, cuando lo generó Luxy.
   *
   * Es historia y no se corrige: es lo único que explica por qué una imagen
   * salió como salió. Separado de `caption` a propósito.
   */
  prompt: z.string().nullable().default(null),
  /**
   * el modelo que la dibujó de verdad.
   *
   * NO es el primero de la receta: al horde se le mandan varios para que la
   * coja el que esté libre, y cada uno da una cara distinta. Estaba guardado
   * con el medio y no se veía en ningún sitio, así que «la misma semilla me da
   * caras distintas» no se podía ni empezar a diagnosticar.
   */
  model: z.string().nullable().default(null),
  /**
   * el intento del registro cifrado que la genero, si lo hubo.
   *
   * Es una referencia, no una copia: la semilla de verdad, el worker y los
   * avisos viven alli. Sin esto, «la misma semilla me da caras distintas» no se
   * puede ni empezar a mirar, porque el sobre del medio no guarda la semilla.
   * `null` en todo lo sellado antes del registro y en lo que se adjunto a mano.
   */
  attemptId: z.string().nullable().default(null),
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

/**
 * corrige a mano el pie de foto de un medio guardado.
 *
 * Vacío lo deja sin pie de foto, que es distinto de no haberlo tocado: es la
 * única forma de retirar una descripción que estaba mal.
 */
export const vaultMediaCaptionArgsSchema = z.object({
  conversationId: conversationIdSchema,
  mediaId: z.string().min(1).max(128),
  caption: z.string().max(3200).default(''),
});

/**
 * se lo pide a un modelo que sepa mirar.
 *
 * Gasta una llamada, así que lo dispara el usuario y nunca ocurre solo. El
 * modelo y el proveedor los elige quien llama, como en el catalogador: no hay
 * un «modelo auxiliar» global todavía.
 */
export const vaultMediaDescribeArgsSchema = z.object({
  conversationId: conversationIdSchema,
  mediaId: z.string().min(1).max(128),
  provider: z.string().min(1).max(64),
  model: z.string().min(1).max(128).nullable().default(null),
  /**
   * cuanto dejarle pensar. `null` deja lo que traiga el proveedor.
   *
   * Va donde va el modelo, siempre. Dejarlo fuera de un camino lo convierte en
   * el unico que no lo respeta, y eso no se ve: la llamada sale, contesta y
   * cuesta lo que cueste sin que nada lo diga.
   */
  effort: z.enum(REASONING_EFFORTS).nullable().default(null),
  projectAlias: projectAliasSchema,
});

/** qué pasó al pedir la descripción; `caption` es null cuando no se pudo */
export const vaultMediaDescribeResultSchema = z.object({
  caption: z.string().nullable(),
  /** por qué no se pudo, para poder arreglarlo: no contestó o se negó */
  failure: z.enum(['vacio', 'negativa', 'sin-imagen', 'solo-razono']).nullable(),
  /**
   * lo que el modelo razonó antes de contestar, si lo escribió.
   *
   * Se conserva y se enseña, pero **nunca** se guarda como pie de foto: es
   * la explicación de por qué dijo lo que dijo, no lo que se ve en la imagen.
   */
  reasoning: z.string().nullable().default(null),
});

/**
 * reescribe un pie de foto en español correcto, sin cambiar lo que dice.
 *
 * Existe porque los modelos con vista disponibles ven bien y redactan mal, y
 * ese texto es justo el que después lee el personaje como un hecho sobre la
 * imagen. Corregirlo a mano es tedioso; corregirlo con otro modelo cuesta una
 * llamada y sale mejor.
 *
 * **No toca la bóveda.** No recibe `mediaId` ni escribe el pie de foto: entra
 * texto y sale texto. Así funciona igual sobre lo que el usuario está
 * escribiendo sin haberlo guardado, y sobre todo deja la decisión donde tiene
 * que estar: la reformulación vuelve al recuadro y se guarda —o no— a mano. Un
 * botón que reescribiera directamente sobre lo guardado sustituiría un texto
 * verdadero por uno que nadie ha leído.
 */
export const vaultMediaRewriteCaptionArgsSchema = z.object({
  caption: z.string().min(1).max(3200),
  provider: z.string().min(1).max(64),
  model: z.string().min(1).max(128).nullable().default(null),
  /**
   * cuanto dejarle pensar. `null` deja lo que traiga el proveedor.
   *
   * Va donde va el modelo, siempre. Dejarlo fuera de un camino lo convierte en
   * el unico que no lo respeta, y eso no se ve: la llamada sale, contesta y
   * cuesta lo que cueste sin que nada lo diga.
   */
  effort: z.enum(REASONING_EFFORTS).nullable().default(null),
  projectAlias: projectAliasSchema,
});

/** el texto reescrito; `caption` es null cuando no se pudo */
export const vaultMediaRewriteCaptionResultSchema = z.object({
  caption: z.string().nullable(),
  failure: z.enum(['vacio', 'negativa', 'sin-imagen', 'solo-razono']).nullable(),
  /** lo que razonó antes de contestar; se enseña, no se guarda */
  reasoning: z.string().nullable().default(null),
});

/**
 * diagnostico de la memoria: sin argumentos, todas las conversaciones.
 *
 * Existe porque Daniel pidio que cada mejora incluya lo ya hablado y poder
 * comprobarlo sobre ello. Sus conversaciones estan cifradas y siguen estandolo:
 * el diagnostico corre DENTRO del proceso principal con la llave abierta y solo
 * devuelve cifras. Ni una palabra de lo dicho cruza este canal.
 */
export const vaultMemoryDiagnosticsArgsSchema = z.object({});

/** un entero no negativo: el diagnostico de pendientes no devuelve otra cosa */
const diagnosticCount = z.number().int().min(0);

/**
 * los asuntos pendientes, en cifras.
 *
 * Va como campo aparte y opcional: un diagnostico hecho con una version
 * anterior —o con la boveda sin nada apuntado todavia— sigue siendo valido sin
 * el, y la pantalla solo enseña sus parrafos cuando llega.
 *
 * Todo son enteros y booleanos. Ni citas, ni identificadores, ni dias: esto
 * cruza el IPC y acaba en el registro.
 */
export const vaultRelationDiagnosticsSchema = z.object({
  /** la guarda del trabajo auxiliar: `byOther` tiene que ser 0 */
  catalogGuard: z.object({
    entries: diagnosticCount,
    byLocalCli: diagnosticCount,
    byOther: diagnosticCount,
    legacyUnknown: diagnosticCount,
  }),
  coverage: z.object({
    conversations: diagnosticCount,
    upToDate: diagnosticCount,
    behind: diagnosticCount,
    turnsBehind: diagnosticCount,
    outdatedVersion: diagnosticCount,
    excludedSkipped: diagnosticCount,
    refusedPersisted: diagnosticCount,
    /**
     * negativas de antes de `INV-FONDO-001`, que eran fallos del proceso y ya
     * no frenan nada. Opcional: un diagnostico anterior no la trae
     */
    refusedLegacy: diagnosticCount.optional(),
    /**
     * de las que van por detras, las que esperan a que el CLI vuelva tras un
     * fallo de su proceso: lo que distingue «esperando» de «al dia» y de una
     * negativa. Opcional por lo mismo
     */
    waitingForProcess: diagnosticCount.optional(),
    failedThisSession: diagnosticCount,
    auxiliaryConfigured: z.boolean(),
  }),
  extraction: z.object({
    proposed: diagnosticCount,
    accepted: diagnosticCount,
    rejectedShape: diagnosticCount,
    rejectedQuote: diagnosticCount,
    rejectedRole: diagnosticCount,
    rejectedWindow: diagnosticCount,
    rejectedClosure: diagnosticCount,
    merged: diagnosticCount,
    refused: diagnosticCount,
    /**
     * turnos que no se le enseñaron enteros al extractor.
     *
     * Tiene que ser 0. Si sube, el cursor esta avanzando sobre texto que nadie
     * ha mirado: una promesa dicha ahi no se apunta y ese turno no se vuelve a
     * leer nunca. Es lo que distingue «no habia promesas» de «no se llego a
     * leer», que sin esta cifra se ven exactamente igual.
     */
    clipped: diagnosticCount,
    byProvider: z.object({
      claude: diagnosticCount,
      codex: diagnosticCount,
      other: diagnosticCount,
    }),
  }),
  notes: z.object({
    total: diagnosticCount,
    byStatus: z.object({
      open: diagnosticCount,
      fulfilled: diagnosticCount,
      released: diagnosticCount,
      dismissed: diagnosticCount,
    }),
    byKind: z.object({ promise: diagnosticCount, plan: diagnosticCount }),
    byWho: z.object({
      user: diagnosticCount,
      character: diagnosticCount,
      both: diagnosticCount,
    }),
    decidedByDaniel: diagnosticCount,
    reopenedByDaniel: diagnosticCount,
    dormant: diagnosticCount,
  }),
  integrity: z.object({
    quoteValid: diagnosticCount,
    quoteBroken: diagnosticCount,
    closuresOrphaned: diagnosticCount,
    droppedOnRead: diagnosticCount,
    orphanNoCharacter: diagnosticCount,
  }),
  /** que habria salido en cada mensaje real, con la misma funcion del turno */
  dosing: z.object({
    userTurnsSimulated: diagnosticCount,
    turnsWithBlock: diagnosticCount,
    linesOffered: diagnosticCount,
    touched: diagnosticCount,
    suppressedInScene: diagnosticCount,
    suppressedCooldown: diagnosticCount,
    suppressedWaiting: diagnosticCount,
    dormant: diagnosticCount,
    blockedStale: diagnosticCount,
    quoteBroken: diagnosticCount,
    maxConsecutiveOffersSameNote: diagnosticCount,
  }),
  raising: z.object({
    herMentions: diagnosticCount,
    notesRaisedByHer: diagnosticCount,
    /** la medida exacta de «sin que yo se lo recuerde» */
    notesRaisedByHerBeforeHim: diagnosticCount,
    sameNoteWithin24h: diagnosticCount,
    maxRaisesPerNote: diagnosticCount,
    medianDaysToFirstRaise: diagnosticCount,
    /**
     * de las anteriores, las que pasan la regla estricta: una COTA SUPERIOR de
     * las que habrian llevado la nota de «ya salio», no esa cifra (`D-104`)
     */
    herMentionsClear: diagnosticCount,
    /** citas de nueve raices o mas, donde la regla estricta casi nunca acepta */
    longQuotes: diagnosticCount,
    herMentionsLong: diagnosticCount,
    herMentionsClearLong: diagnosticCount,
  }),
  /** lo que reclama ella y cuanto de eso consta; `unbacked` no puede subir */
  inventionGuard: z.object({
    herClaims: diagnosticCount,
    backed: diagnosticCount,
    unbacked: diagnosticCount,
  }),
  nextTurn: z.object({ linesForLatestConversation: diagnosticCount }),
});

export const vaultMemoryDiagnosticsResultSchema = z.object({
  scope: z.object({
    otherConversations: z.number().int().min(0),
    characterName: z.string().nullable(),
  }),
  conversations: z.object({
    total: z.number().int().min(0),
    cataloged: z.number().int().min(0),
    gapOnly: z.number().int().min(0),
    withoutEpisodes: z.number().int().min(0),
  }),
  episodes: z.object({
    total: z.number().int().min(0),
    cataloged: z.number().int().min(0),
    firstDay: z.string().nullable(),
    lastDay: z.string().nullable(),
    distinctDays: z.number().int().min(0),
  }),
  index: z.object({
    cap: z.number().int().min(0),
    lines: z.number().int().min(0),
    omitted: z.number().int().min(0),
    firstInIndex: z.boolean(),
  }),
  dateRecall: z.object({
    tested: z.number().int().min(0),
    hits: z.number().int().min(0),
    misses: z.number().int().min(0),
    /** dias con formato AAAA-MM-DD: cuando se hablo, nunca que se dijo */
    missedDays: z.array(z.string()),
  }),
  origin: z.object({
    /** formas corrientes de preguntarlo que se prueban, y cuantas lo reconocen */
    probes: z.number().int().min(0),
    found: z.number().int().min(0),
    day: z.string().nullable(),
  }),
  style: z.object({
    userMessages: z.number().int().min(0),
    medianChars: z.number().int().min(0),
    withTemporalReference: z.number().int().min(0),
    withMemoryRequest: z.number().int().min(0),
    withConversationRecall: z.number().int().min(0),
  }),
  triggers: z.object({
    byOrigin: z.number().int().min(0),
    byDate: z.number().int().min(0),
    byWords: z.number().int().min(0),
    dateWithoutQuestion: z.number().int().min(0),
    dateWithoutMoment: z.number().int().min(0),
    dateInHistory: z.number().int().min(0),
  }),
  /** los asuntos pendientes, si hay almacen que leer */
  relations: vaultRelationDiagnosticsSchema.optional(),
  /**
   * cuantas conversaciones pueden retomarse, y de que clase es su memoria.
   *
   * Va como campo aparte y opcional, igual que los pendientes: un almacen que no
   * se abre no puede dejar sin cifras al resto del diagnostico. Es la unica
   * medida de cobertura de la MEMORIA que hay; lo demas mide catalogo, fechas,
   * estilo y disparos.
   */
  recaps: vaultRecapCoverageSchema.optional(),
});

/**
 * prueba de visión: una imagen del disco, un modelo, y la descripción de vuelta.
 *
 * **No escribe nada.** Ni en la bóveda, ni en la conversación, ni en el pie de
 * foto de nada. Existe para poder saber si un modelo sabe mirar **antes** de
 * confiarle una imagen privada, y para no tener que crear una conversación sólo
 * para probarlo.
 */
export const vaultVisionProbeArgsSchema = z.object({
  provider: z.string().min(1).max(64),
  model: z.string().min(1).max(128).nullable().default(null),
  /**
   * cuanto dejarle pensar. `null` deja lo que traiga el proveedor.
   *
   * Va donde va el modelo, siempre. Dejarlo fuera de un camino lo convierte en
   * el unico que no lo respeta, y eso no se ve: la llamada sale, contesta y
   * cuesta lo que cueste sin que nada lo diga.
   */
  effort: z.enum(REASONING_EFFORTS).nullable().default(null),
  projectAlias: projectAliasSchema,
});

export const vaultVisionProbeResultSchema = z.object({
  /** true si cerró el diálogo sin elegir; no es un error */
  cancelled: z.boolean(),
  fileName: z.string().nullable(),
  mimeType: z.string().nullable(),
  byteSize: z.number().int().min(0),
  /** para verla al lado del texto; `null` si es demasiado grande */
  dataUrl: z.string().nullable(),
  caption: z.string().nullable(),
  /**
   * por qué no hubo descripción.
   *
   * `fallo` es distinto de `vacio` y separarlos importa: la llamada puede
   * romperse —clave, red, un 400 del proveedor— y devolver texto vacío. Al
   * contarlo como «no contestó nada» se le decía al usuario que reintentara
   * algo que no va a funcionar, y el motivo real no aparecía por ningún lado.
   */
  failure: z.enum(['vacio', 'negativa', 'fallo', 'sin-imagen', 'solo-razono']).nullable(),
  /**
   * lo que el modelo razonó antes de contestar, si lo escribió.
   *
   * Se conserva y se enseña, pero **nunca** se guarda como pie de foto: es
   * la explicación de por qué dijo lo que dijo, no lo que se ve en la imagen.
   */
  reasoning: z.string().nullable().default(null),
  /** el mensaje del fallo cuando lo hay; nunca una traza */
  error: z.string().nullable(),
  /** el modelo que respondió de verdad, que puede no ser el pedido */
  executedModel: z.string().nullable(),
});

export const vaultMediaGenerateArgsSchema = z.object({
  conversationId: conversationIdSchema,
  characterId: z.string().min(1).max(128),
  prompt: z.string().min(1).max(2000),
  kind: z.enum(['image', 'video']),
  /** solo para vídeo: anima una imagen ya generada */
  fromGenerationId: z.string().max(128).optional(),
  /**
   * parte de una imagen que YA está en esta conversación (img2img).
   *
   * Es un identificador de medio LOCAL, no del proveedor: los bytes se leen de
   * la bóveda, se descifran en memoria y viajan en el cuerpo de la petición.
   * Nunca se publica una URL, que es la misma razón por la que se sondea en vez
   * de usar un callback (`D-042`).
   *
   * Sirve para **variar** una imagen que ya salió bien, no para llevar la cara
   * del personaje a una escena nueva: eso AI Horde no lo sabe hacer.
   */
  fromMediaId: z.string().max(128).optional(),
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
  /** lo que declaró el proveedor, para que el gasto sea visible */
  costCredits: z.number().nullable(),
  /** créditos (se compran con dinero) o kudos (no se compran); ver el bloque `image` */
  costUnit: z.enum(['creditos', 'kudos']).nullable().default(null),
});

// -----------------------------------------------------------------------------
// la decision sobre una imagen que quedo esperando
// -----------------------------------------------------------------------------

/**
 * el pendiente de una conversacion.
 *
 * Se pregunta al abrir la conversacion, no al enviar: el intento vive cifrado
 * en disco, asi que cerrar Studio con una imagen sin decidir no es decir que
 * no, y sin este verbo la tarjeta no volveria a aparecer nunca.
 */
export const vaultImagePendingArgsSchema = z.object({
  conversationId: conversationIdSchema,
});

export const vaultImagePendingResultSchema = z.object({
  /** `null` cuando no hay nada esperando, que es lo normal */
  attempt: imageAttemptSchema.nullable(),
});

/** el registro de esa conversacion, tal y como esta guardado */
export const vaultImageAttemptsArgsSchema = z.object({
  conversationId: conversationIdSchema,
});

export const vaultImageAttemptsResultSchema = z.object({
  /** del mas antiguo al mas reciente, que es como se apuntaron */
  attempts: z.array(imageAttemptSchema),
});

/**
 * la decision de Daniel sobre el texto que iba a salir.
 *
 * Union discriminada y ESTRICTA en las dos ramas, por el mismo motivo escrito
 * en `vaultRecapUpdateArgsSchema`: sin `strict` un campo de mas se descarta en
 * silencio, y entonces el boton dice una cosa y hace otra. Aqui eso se paga en
 * kudos y en una imagen que no es la que se pidio.
 *
 * ESO INCLUYE EL OBJETO ANIDADO, que es el que lleva el texto que se paga: las
 * dos ramas de `vaultImagePlanEditSchema` son estrictas tambien, y esta atado
 * con una prueba aqui («un campo de mas DENTRO de `edit`...»). Sin ella, un
 * `seed` colado en la correccion —lo primero que uno intenta al ver la semilla
 * en el panel— se tiraba en silencio y la imagen salia con otra.
 *
 * `edit` a `null` significa «mandalo tal y como lo compusiste». No se acepta un
 * plan entero desde el renderer: solo el TEXTO corregido. El plan base se lee
 * del registro cifrado y la huella se recalcula en el main, asi que un `planId`
 * que llegue de fuera no lo cree nadie.
 */
export const vaultImageCommitArgsSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('generate'),
      conversationId: conversationIdSchema,
      attemptId: z.string().uuid(),
      edit: vaultImagePlanEditSchema.nullable().default(null),
    })
    .strict(),
  z
    .object({
      action: z.literal('discard'),
      conversationId: conversationIdSchema,
      attemptId: z.string().uuid(),
    })
    .strict(),
]);

/**
 * en que quedo la decision.
 *
 * Un solo objeto para las dos ramas, con los campos del medio a `null` cuando
 * no hubo medio: `discard` no genera y no cobra, y la pantalla necesita poder
 * pintar las dos respuestas con el mismo codigo.
 */
export const vaultImageCommitResultSchema = z.object({
  attemptId: z.string(),
  state: z.enum(VAULT_IMAGE_ATTEMPT_STATES),
  mediaId: z.string().nullable().default(null),
  mimeType: z.string().nullable().default(null),
  byteSize: z.number().int().min(0).nullable().default(null),
  costCredits: z.number().nullable().default(null),
  costUnit: z.enum(['creditos', 'kudos']).nullable().default(null),
});

/**
 * cuanto costaria, preguntado en seco.
 *
 * Mismos argumentos que `generate` porque se pregunta por el MISMO texto: lo
 * que se estime tiene que ser lo que despues se mande, incluida la correccion
 * escrita a mano. El handler es del paso 10.
 */
export const vaultImageEstimateArgsSchema = z
  .object({
    conversationId: conversationIdSchema,
    attemptId: z.string().uuid(),
    edit: vaultImagePlanEditSchema.nullable().default(null),
  })
  .strict();

export const vaultImageEstimateResultSchema = z.object({
  /** `null` si el servidor no devolvio precio; nunca un numero inventado */
  kudos: z.number().nullable(),
  warnings: z.array(imageAttemptWarningSchema),
});

/**
 * un personaje guardado en la bóveda.
 *
 * Se guarda porque crearlo **cuesta créditos** y su identificador sólo se
 * devuelve una vez: la API no tiene forma de listarlos, así que uno que no se
 * guarde aquí no se recupera de ninguna manera.
 */
export const vaultCharacterSummarySchema = z.object({
  /**
   * la clave DURABLE de la bóveda, no la de ningún proveedor.
   *
   * A ella se agarran sus conversaciones, sus recuerdos y sus imágenes, así que
   * no cambia nunca. La de Xavira, cuando la tiene, va dentro de `xavira`.
   */
  characterId: z.string(),
  description: z.string(),
  label: z.string(),
  /** hay avatar guardado; los bytes se piden aparte y van cifrados en disco */
  avatarObjectKey: z.string().nullable(),
  createdAt: z.string(),
  /**
   * quién le hace las fotos AHORA.
   *
   * Es una propiedad del personaje que se cambia cuando se quiera. El personaje
   * no depende de ella: sus conversaciones, sus recuerdos y sus imágenes se
   * agarran a `characterId`, que no cambia nunca (`D-068`).
   */
  imageProvider: z.enum(['xavira', 'horde']).default('xavira'),
  /**
   * si hay que enseñar el texto de la imagen antes de generarla.
   *
   * Viaja al renderer porque el interruptor vive en su ficha y tiene que poder
   * pintar el estado real. El valor por defecto está aquí por lo mismo que en
   * `imageProvider`: una bóveda escrita antes de este campo sigue leyendo su
   * propia lista sin que la pantalla tenga que adivinar nada.
   */
  imageReview: z.enum(['siempre', 'nunca']).default('siempre'),
  /**
   * en una escena donde salen los dos, si se dibuja entera o sólo el personaje.
   *
   * Viaja al renderer por lo mismo que `imageReview`: el interruptor vive en su
   * ficha y tiene que pintar el estado real. Y trae defecto por lo mismo: una
   * bóveda escrita antes de este campo se lee sin que la pantalla adivine nada,
   * y lo que lee es el comportamiento de siempre.
   */
  imageCast: z.enum(['character-only', 'both']).default('character-only'),
  /**
   * si su prompt lleva las notas de dirección contra la autocopia (`D-102`).
   *
   * Viaja por lo mismo que `imageCast`: la casilla vive en su ficha y tiene que
   * pintar el estado real. Con el defecto, una bóveda anterior se lee apagada,
   * y apagada esta casilla no añade nada al prompt (el prompt entero puede
   * cambiar por otras vias: la ficha editada se sella sola, `D-104`).
   */
  replyGuidance: z.enum(VAULT_REPLY_GUIDANCES).default('none'),
  /**
   * si sus pendientes van en modo esporádico (`D-104`).
   *
   * Viaja por lo mismo que `replyGuidance`: la casilla vive en su ficha. Con el
   * defecto, una bóveda anterior se lee apagada, y apagada esta casilla no
   * añade nada al prompt.
   */
  pendingPacing: z.enum(VAULT_PENDING_PACINGS).default('per-note'),
  /**
   * si le llega el resumen de sus dos ultimas conversaciones (`D-105`).
   *
   * Viaja por lo mismo que los de arriba: la casilla vive en su ficha. Con el
   * defecto, una boveda anterior se lee apagada, y apagada esta casilla no
   * añade nada al prompt.
   */
  recentMemories: z.enum(VAULT_RECENT_MEMORIES).default('off'),
  /** su identidad en Xavira, si la tiene. El identificador es el de SU API */
  xavira: z
    .object({ characterId: z.string(), modelId: z.string() })
    .nullable()
    .default(null),
  /**
   * su aspecto en AI Horde, si lo tiene.
   *
   * Viaja al renderer entero y a propósito: sin él la pantalla no podría
   * enseñar ni corregir con qué modelo y qué rasgos se está generando, que es
   * justo lo que hay que mirar cuando un personaje deja de parecerse a sí mismo.
   * No contiene ningún secreto.
   */
  horde: z.object({ recipe: hordeRecipeSchema }).nullable().default(null),
});

/**
 * cambia quién le hace las fotos a un personaje.
 *
 * No toca nada más: es lo que permite que Lía siga siendo Lía —con sus
 * recuerdos y sus conversaciones— tanto si sus fotos las da Xavira como si las
 * da AI Horde.
 */
export const vaultCharacterProviderArgsSchema = z.object({
  characterId: z.string().min(1).max(128),
  provider: z.enum(['xavira', 'horde']),
});

/**
 * decide si ese personaje enseña el texto de la imagen antes de generarla.
 *
 * Va por su propio verbo, como el proveedor, y no dentro de un «guardar
 * personaje» genérico: un canal que sólo puede cambiar una cosa no puede
 * reescribirle por accidente la receta, el nombre ni el avatar.
 */
export const vaultCharacterImageReviewArgsSchema = z.object({
  characterId: z.string().min(1).max(128),
  review: z.enum(['siempre', 'nunca']),
});

/**
 * decide si una escena donde salen los dos se dibuja entera o sólo con él.
 *
 * Verbo propio, por el mismo motivo que los otros dos: un canal que sólo puede
 * cambiar una cosa no puede reescribirle por accidente la receta ni el nombre.
 */
export const vaultCharacterImageCastArgsSchema = z.object({
  characterId: z.string().min(1).max(128),
  cast: z.enum(['character-only', 'both']),
});

/**
 * enciende o apaga las notas de dirección contra la autocopia de un personaje.
 *
 * Verbo propio, por el mismo motivo que los otros tres: un canal que sólo puede
 * cambiar una cosa no puede reescribirle por accidente la receta ni el nombre.
 */
export const vaultCharacterReplyGuidanceArgsSchema = z.object({
  characterId: z.string().min(1).max(128),
  guidance: z.enum(VAULT_REPLY_GUIDANCES),
});

/**
 * enciende o apaga el modo esporádico de los pendientes de un personaje.
 *
 * Verbo propio, por el mismo motivo que los demás: un canal que sólo puede
 * cambiar una cosa no puede reescribirle por accidente otra.
 */
export const vaultCharacterPendingPacingArgsSchema = z.object({
  characterId: z.string().min(1).max(128),
  pacing: z.enum(VAULT_PENDING_PACINGS),
});

/**
 * enciende o apaga el resumen de sus dos ultimas conversaciones.
 *
 * Verbo propio, por el mismo motivo que los demas.
 */
export const vaultCharacterRecentMemoriesArgsSchema = z
  .object({
    characterId: z.string().min(1).max(128),
    recent: z.enum(VAULT_RECENT_MEMORIES),
  })
  .strict();

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

/**
 * clave de AI Horde.
 *
 * Canal propio por la misma razón que la del proveedor de pago: el nombre del
 * secreto lo pone el proceso principal y nunca viaja por el IPC, así que el
 * renderer no puede elegir qué secreto escribe.
 */
export const vaultHordeKeyArgsSchema = z.object({
  apiKey: z.string().min(1).max(512),
});

/**
 * el desglose por conceptos que la misma respuesta ya traía.
 *
 * Cada casilla es `number | null`, y `null` significa «el servidor no la mandó»,
 * nunca «vale cero». La pantalla tiene que poder distinguirlo: un 0 es una
 * afirmación —por ahí no ha entrado nada— y la ausencia no afirma nada.
 */
export const vaultHordeKudosDetailsSchema = z.object({
  accumulated: z.number().nullable(),
  gifted: z.number().nullable(),
  donated: z.number().nullable(),
  admin: z.number().nullable(),
  received: z.number().nullable(),
  recurring: z.number().nullable(),
  awarded: z.number().nullable(),
  styled: z.number().nullable(),
});

/**
 * la cuenta del horde, para poder enseñar la prioridad real.
 *
 * Los kudos no son dinero y no se compran: deciden en qué posición de la cola
 * entra cada petición. Verlos es la única forma de entender por qué una imagen
 * tarda dos minutos y otra veinte segundos.
 */
export const vaultHordeAccountResultSchema = z.object({
  username: z.string(),
  kudos: z.number(),
  /** imágenes que puede tener en vuelo a la vez */
  concurrency: z.number().int(),
  /** es la clave anónima: funciona, pero comparte lo que genera */
  anonymous: z.boolean(),
  /**
   * en qué se reparte ese total. `null` cuando esta respuesta no lo trajo: la
   * pantalla sigue funcionando solo con el total, que es lo que enseñaba antes.
   */
  kudosDetails: vaultHordeKudosDetailsSchema.nullable(),
  /**
   * tipo de cuenta tal y como lo declara el horde, no deducido del saldo.
   *
   * `true` = registrada sin OAuth (usuario suelto); `false` = registrada por
   * OAuth. `null` cuando la respuesta no lo trajo, y ese `null` significa «no
   * se sabe»: quien lo pinte tiene que decirlo así, no elegir una de las dos.
   */
  pseudonymous: z.boolean().nullable(),
  /**
   * cuenta de servicio usada por un proxy del horde, según su propio swagger.
   *
   * NO es el proveedor de OAuth: no dice Google, Discord ni GitHub, y en
   * `/v2/find_user` no se ha encontrado ningún campo que lo diga.
   */
  service: z.boolean().nullable(),
});

/** un modelo servido AHORA, con cuántos workers lo tienen cargado */
export const vaultHordeModelSchema = z.object({
  name: z.string(),
  count: z.number().int(),
  /** segundos estimados para vaciar la cola de ese modelo */
  eta: z.number().int(),
  jobs: z.number().int(),
});

export const vaultHordeModelsResultSchema = z.object({
  models: z.array(vaultHordeModelSchema),
});

/**
 * guarda un personaje de AI Horde.
 *
 * No llama a ninguna API y no cuesta nada: un personaje del horde **es** su
 * receta. Por eso se puede editar tantas veces como haga falta hasta que la
 * cara salga bien, al contrario que en el proveedor de pago, donde crear otro
 * cuesta créditos.
 */
export const vaultHordeCharacterSaveArgsSchema = z.object({
  /**
   * vacío al crear; con valor, sustituye a ese personaje conservando su
   * identificador, y con él las imágenes y los recuerdos que ya cuelgan de él.
   */
  characterId: z.string().max(128).default(''),
  label: z.string().max(100).default(''),
  /** quién es, en texto, para el modelo que escribe */
  description: z.string().max(2000).default(''),
  recipe: hordeRecipeSchema,
});

/**
 * como se comporto ese personaje la ultima vez.
 *
 * La personalidad es del personaje y no del hilo: al elegirlo en una
 * conversacion nueva se rellenan sus instrucciones para no tener que escribirlas
 * otra vez. Sigue siendo un borrador editable, y no pisa las que ya haya.
 */
export const vaultCharacterInstructionsResultSchema = z.object({
  instructions: z.string().nullable(),
});

export const vaultCharacterAvatarResultSchema = z.object({
  /** data URL descifrada, o null si ese personaje no tiene avatar guardado */
  dataUrl: z.string().nullable(),
});

/**
 * que sincronizar (`SYNC-F1-07`): todo, o solo una conversacion. La segunda es
 * la de la primera prueba en vivo: se ensaya con una conversacion desechable
 * antes de tocar las de verdad.
 */
export const vaultSyncScopeSchema = z.union([
  z.object({ mode: z.literal('all') }).strict(),
  z.object({ mode: z.literal('conversation'), conversationId: z.string().uuid() }).strict(),
]);
export type VaultSyncScope = z.infer<typeof vaultSyncScopeSchema>;

/** sin argumentos —el boton de siempre— es «todo» */
export const vaultSyncArgsSchema = z.preprocess(
  (value) =>
    value === undefined ||
    value === null ||
    (typeof value === 'object' && Object.keys(value).length === 0)
      ? { mode: 'all' }
      : value,
  vaultSyncScopeSchema,
);

/**
 * como acabo cada conversacion en una pasada.
 *
 * - `ok`: lo de aqui y lo del servidor coinciden al acabar;
 * - `frozen`: la misma secuencia tiene un registro distinto a cada lado. Esta
 *   «en dos versiones»: ni sube ni baja, y no se borra nada de ningun lado;
 * - `local-duplicates`: en este equipo hay secuencias repetidas con distinto
 *   registro (el numerado viejo). No se sube hasta decidir cual vale;
 * - `busy`: tenia un envio, un borrado, un cambio de dueño o «borrar su
 *   memoria» en curso. Va en la siguiente;
 * - `failed`: fallo algo de esta conversacion; las demas siguieron;
 * - `interrupted`: la boveda se cerro mientras se hacia;
 * - `not-reached`: la pasada se paro antes de llegar a ella.
 */
export const VAULT_SYNC_CONVERSATION_STATUSES = [
  'ok',
  'frozen',
  'local-duplicates',
  'busy',
  'failed',
  'interrupted',
  'not-reached',
] as const;
export type VaultSyncConversationStatus = (typeof VAULT_SYNC_CONVERSATION_STATUSES)[number];

export const vaultSyncConversationReportSchema = z.object({
  conversationId: z.string().uuid(),
  status: z.enum(VAULT_SYNC_CONVERSATION_STATUSES),
  /** turnos en este equipo al acabar, sin copias ni lineas rotas */
  local: z.number().int().min(0),
  /** turnos que el servidor tiene confirmados al acabar; `null` si no se le pregunto */
  server: z.number().int().min(0).nullable(),
  uploaded: z.number().int().min(0),
  downloaded: z.number().int().min(0),
  /** lineas de aqui que no se pueden usar: rotas, de otra conversacion o fuera de rango */
  unreadable: z.number().int().min(0),
  /** secuencias repetidas con distinto registro en este equipo */
  duplicateSequences: z.number().int().min(0),
  /** turnos que el servidor tuvo y ya no tiene; se vuelven a subir */
  serverLost: z.number().int().min(0),
  /** turnos que no pueden viajar: de mas de 4 MiB o con una forma que el contrato no admite */
  notUploadable: z.number().int().min(0),
  /** registros del servidor que esta boveda no puede abrir; la conversacion se detiene ahi */
  unopenable: z.number().int().min(0),
  /** que fallo, ya redactado; `null` si nada */
  error: z.string().nullable(),
});
export type VaultSyncConversationReport = z.infer<typeof vaultSyncConversationReportSchema>;

/**
 * por que se paro la pasada antes de acabar.
 *
 * - `locked`: se cerro la boveda. No se da nada por bueno: sigue al reabrir;
 * - `session`: la sesion de la cuenta ya no vale;
 * - `gateway-outdated`: el servidor no conoce el protocolo v2 (404);
 * - `gateway-protocol`: el servidor habla un protocolo que este Studio no sabe;
 * - `unreachable`: no hay red o el servidor no responde;
 * - `server-error`: el servidor respondio con un fallo donde la pasada no
 *   puede seguir sin el (las capacidades o la lista de conversaciones);
 * - `tombstones-unreadable`: la lista de borradas de este equipo no se lee, y
 *   sin ella volverian conversaciones borradas;
 * - `media-store-missing`: falta el almacen de medios en Supabase.
 */
export const VAULT_SYNC_STOP_REASONS = [
  'locked',
  'session',
  'gateway-outdated',
  'gateway-protocol',
  'unreachable',
  'server-error',
  'tombstones-unreadable',
  'media-store-missing',
] as const;
export type VaultSyncStopReason = (typeof VAULT_SYNC_STOP_REASONS)[number];

export const vaultSyncMediaReportSchema = z.object({
  /** se llego a sincronizar medios en esta pasada */
  reached: z.boolean(),
  uploaded: z.number().int().min(0),
  downloaded: z.number().int().min(0),
  /** ya estaban en el servidor: cuentan como copiados, no como subidos */
  alreadyThere: z.number().int().min(0),
  /** de mas de 90 MiB: se quedan en el equipo donde se crearon */
  skipped: z.number().int().min(0),
  /** su conversacion aun no esta en el servidor: van cuando suban sus turnos */
  waiting: z.number().int().min(0),
  failed: z.number().int().min(0),
  /** del servidor y no se abren con esta boveda: no entran */
  unopenable: z.number().int().min(0),
  /** con una forma que el contrato no admite: no viajan */
  notUploadable: z.number().int().min(0),
  /** el primer fallo, ya redactado */
  error: z.string().nullable(),
});
export type VaultSyncMediaReport = z.infer<typeof vaultSyncMediaReportSchema>;

export const vaultSyncResultSchema = z.object({
  protocol: z.literal(2),
  scope: z.enum(['all', 'conversation']),
  stopped: z.enum(VAULT_SYNC_STOP_REASONS).nullable(),
  /** el detalle del motivo, ya redactado */
  stoppedDetail: z.string().nullable(),
  /**
   * `replica`: este equipo se estreno con la boveda de la cuenta y sin nada
   * propio. Hasta tener los hechos (F2) no escribe turnos
   */
  role: z.enum(['origin', 'replica']).nullable(),
  conversations: z.array(vaultSyncConversationReportSchema),
  /** borradas en este equipo cuya copia sigue en el servidor hasta F2 */
  deletedStillOnServer: z.number().int().min(0),
  uploaded: z.number().int().min(0),
  downloaded: z.number().int().min(0),
  media: vaultSyncMediaReportSchema,
  /**
   * cuando acabo la pasada. La pantalla dice «coincidia a las 10:42», no
   * «coincide»: en F1 nada sincroniza solo, y lo que se escriba despues ya no
   * esta en el servidor (STUDIO-R1-01, `D-093`)
   */
  finishedAt: z.string().datetime(),
});
export type VaultSyncResult = z.infer<typeof vaultSyncResultSchema>;

/**
 * el diagnostico local, sin descifrar nada: cifras por conversacion.
 *
 * Es lo primero de la prueba en vivo: antes de subir nada, cuantas
 * conversaciones hay y cuales tienen secuencias repetidas.
 */
export const vaultSyncDiagnosisSchema = z.object({
  conversations: z.array(
    z.object({
      conversationId: z.string().uuid(),
      lines: z.number().int().min(0),
      turns: z.number().int().min(0),
      unreadable: z.number().int().min(0),
      duplicateLines: z.number().int().min(0),
      duplicateSequences: z.number().int().min(0),
      holes: z.number().int().min(0),
      partialTail: z.boolean(),
    }),
  ),
  /** borradas en este equipo; `null` si su lista no se puede leer */
  deleted: z.number().int().min(0).nullable(),
});
export type VaultSyncDiagnosis = z.infer<typeof vaultSyncDiagnosisSchema>;

/**
 * apartar la boveda local sin cuenta para poder entrar en una (`SYNC-F1-07`).
 * Se renombra, nunca se borra: devuelve los nombres con que quedo.
 */
export const vaultLocalSetAsideResultSchema = z.object({
  vaultFile: z.string(),
  vaultDirectory: z.string().nullable(),
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
  /**
   * de cuál de las dos listas sale: `connections` o `providers.http`.
   *
   * Hacen falta las dos porque son listas distintas y sus identificadores
   * comparten espacio de nombres. Sin esto, el catálogo sólo sabía preguntarle
   * a `connections`, así que un proveedor HTTP —donde vive Mistral— no tenía
   * forma de que le preguntaran qué sirve.
   *
   * El valor por defecto conserva el comportamiento anterior.
   */
  source: z.enum(['connection', 'http']).default('connection'),
});

// el esquema del catálogo vive en `@luxy/shared`, al lado del tipo que
// describe, y se re-exporta desde aquí para que el contrato IPC siga nombrando
// uno solo. El que había aquí escrito era una copia que NUNCA se ejecutaba
// —sus dos usos eran `z.infer`, o sea posiciones de tipo— y que ya se había
// quedado atrás: le faltaba `declaredCapabilities`, así que el día que alguien
// lo aplicara habría borrado en silencio lo que la pasarela declara saber
// hacer. Una sola definición, y viva: la ejecuta `readCatalogSnapshot`.
export { catalogSnapshotSchema };

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
  refreshCatalog(
    args: z.input<typeof catalogRefreshArgsSchema>,
  ): Promise<IpcResult<z.infer<typeof catalogSnapshotSchema>>>;
  readCatalog(
    args: z.input<typeof catalogRefreshArgsSchema>,
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
  /** guarda la clave de AI Horde; va aparte porque es otra cuenta */
  setVaultHordeKey(
    args: z.infer<typeof vaultHordeKeyArgsSchema>,
  ): Promise<IpcResult<z.infer<typeof vaultStatusSchema>>>;
  deleteVaultHordeKey(): Promise<IpcResult<z.infer<typeof vaultStatusSchema>>>;
  /** saldo de kudos: es lo que decide la posición en la cola, no el dinero */
  readVaultHordeAccount(): Promise<IpcResult<z.infer<typeof vaultHordeAccountResultSchema>>>;
  /** modelos que el horde sirve ahora mismo; el número de workers cambia solo */
  listVaultHordeModels(): Promise<IpcResult<z.infer<typeof vaultHordeModelsResultSchema>>>;
  /** guarda o corrige la receta de un personaje del horde; no cuesta nada */
  saveVaultHordeCharacter(
    args: z.infer<typeof vaultHordeCharacterSaveArgsSchema>,
  ): Promise<IpcResult<z.infer<typeof vaultCharacterCreateResultSchema>>>;
  /** cambia quien le hace las fotos; el personaje y sus recuerdos siguen igual */
  setVaultCharacterImageProvider(
    args: z.infer<typeof vaultCharacterProviderArgsSchema>,
  ): Promise<IpcResult<z.infer<typeof vaultCharacterListResultSchema>>>;
  /** decide si ese personaje enseña el texto de la imagen antes de generarla */
  setVaultCharacterImageReview(
    args: z.infer<typeof vaultCharacterImageReviewArgsSchema>,
  ): Promise<IpcResult<z.infer<typeof vaultCharacterListResultSchema>>>;
  /** decide si una escena con los dos se dibuja entera o sólo con el personaje */
  setVaultCharacterImageCast(
    args: z.infer<typeof vaultCharacterImageCastArgsSchema>,
  ): Promise<IpcResult<z.infer<typeof vaultCharacterListResultSchema>>>;
  /** enciende o apaga las notas de dirección contra la autocopia */
  setVaultCharacterReplyGuidance(
    args: z.infer<typeof vaultCharacterReplyGuidanceArgsSchema>,
  ): Promise<IpcResult<z.infer<typeof vaultCharacterListResultSchema>>>;
  /** enciende o apaga el modo esporádico de los pendientes */
  setVaultCharacterPendingPacing(
    args: z.infer<typeof vaultCharacterPendingPacingArgsSchema>,
  ): Promise<IpcResult<z.infer<typeof vaultCharacterListResultSchema>>>;
  /** enciende o apaga el resumen de sus dos ultimas conversaciones */
  setVaultCharacterRecentMemories(
    args: z.infer<typeof vaultCharacterRecentMemoriesArgsSchema>,
  ): Promise<IpcResult<z.infer<typeof vaultCharacterListResultSchema>>>;
  /** lo que pasaria al enganchar o soltar esa conversacion, sin hacerlo */
  previewVaultConversationOwner(
    args: z.infer<typeof vaultConversationOwnerPreviewArgsSchema>,
  ): Promise<IpcResult<z.infer<typeof vaultConversationOwnerPreviewSchema>>>;
  /** engancha o suelta; devuelve la conversacion leida con el dueño nuevo */
  setVaultConversationOwner(
    args: z.infer<typeof vaultConversationOwnerSetArgsSchema>,
  ): Promise<IpcResult<z.infer<typeof vaultConversationReadResultSchema>>>;
  createVault(password: string): Promise<IpcResult<z.infer<typeof vaultCreateResultSchema>>>;
  unlockVault(
    args: z.infer<typeof vaultUnlockArgsSchema>,
  ): Promise<IpcResult<z.infer<typeof vaultStatusSchema>>>;
  lockVault(): Promise<IpcResult<z.infer<typeof vaultStatusSchema>>>;
  /** hay alguien delante; `counted` dice si el proceso principal lo ha contado */
  markVaultPresence(): Promise<IpcResult<z.infer<typeof vaultPresenceResultSchema>>>;
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
    caption: string,
  ): Promise<IpcResult<{ attached: number }>>;
  checkVaultCompatibility(
    args: z.infer<typeof vaultCompatibilityArgsSchema>,
  ): Promise<IpcResult<z.infer<typeof vaultCompatibilityResultSchema>>>;
  listVaultMemory(): Promise<IpcResult<z.infer<typeof vaultMemoryListResultSchema>>>;
  syncVaultCatalog(
    args: z.infer<typeof vaultCatalogSyncArgsSchema>,
  ): Promise<IpcResult<z.infer<typeof vaultCatalogSyncResultSchema>>>;
  syncVaultRelations(
    args: z.infer<typeof vaultRelationSyncArgsSchema>,
  ): Promise<IpcResult<z.infer<typeof vaultRelationSyncResultSchema>>>;
  /** lo apuntado, para repasarlo antes de que ella lo saque */
  listVaultRelations(): Promise<IpcResult<z.infer<typeof vaultRelationListResultSchema>>>;
  /** aplica la decision de Daniel y devuelve la lista ya actualizada */
  updateVaultRelation(
    args: z.infer<typeof vaultRelationUpdateArgsSchema>,
  ): Promise<IpcResult<z.infer<typeof vaultRelationListResultSchema>>>;
  /**
   * rellena hacia atras la memoria de lo ya hablado.
   *
   * Con `dryRun` corre la pasada entera y no guarda nada: devuelve el texto que
   * escribiria para poder leerlo antes de dejarlo entrar en ningun prompt.
   */
  syncVaultRecaps(
    args: z.infer<typeof vaultRecapSyncArgsSchema>,
  ): Promise<IpcResult<z.infer<typeof vaultRecapSyncResultSchema>>>;
  /** lo rellenado, para leerlo y aprobarlo; incluye la linea de cobertura */
  listVaultRecaps(): Promise<IpcResult<z.infer<typeof vaultRecapListResultSchema>>>;
  /** aprueba, aprueba todas o borra, y devuelve la lista ya actualizada */
  updateVaultRecap(
    args: z.infer<typeof vaultRecapUpdateArgsSchema>,
  ): Promise<IpcResult<z.infer<typeof vaultRecapListResultSchema>>>;
  /**
   * borra lo que ella recuerda de una conversacion, sin tocar la conversacion.
   *
   * Es la memoria SELLADA, la que viaja en cada turno de ese hilo; no la ficha
   * retroactiva, que la quita `updateVaultRecap` con `forget`.
   */
  forgetVaultSealedMemory(
    args: z.infer<typeof vaultConversationIdArgsSchema>,
  ): Promise<IpcResult<z.infer<typeof vaultSealedMemoryForgetResultSchema>>>;
  /**
   * vuelve a la memoria de antes o pide otra vez la reescrita con la ficha
   * (`D-108`), y devuelve la lista de «Lo que recuerda» ya actualizada.
   */
  decideVaultMemoryRelink(
    args: z.infer<typeof vaultMemoryRelinkDecideArgsSchema>,
  ): Promise<IpcResult<z.infer<typeof vaultMemoryRelinkDecideResultSchema>>>;
  getVaultAuxiliary(): Promise<IpcResult<z.infer<typeof vaultAuxiliaryChoiceSchema> | null>>;
  setVaultAuxiliary(
    args: z.infer<typeof vaultAuxiliarySetArgsSchema>,
  ): Promise<IpcResult<z.infer<typeof vaultAuxiliaryChoiceSchema> | null>>;
  readVaultMemory(
    args: z.infer<typeof vaultMemoryReadArgsSchema>,
  ): Promise<IpcResult<z.infer<typeof vaultMemoryReadResultSchema>>>;
  excludeFromVaultMemory(
    args: z.infer<typeof vaultMemoryExcludeArgsSchema>,
  ): Promise<IpcResult<z.infer<typeof vaultMemoryListResultSchema>>>;
  listVaultMedia(
    conversationId: string,
  ): Promise<IpcResult<z.infer<typeof vaultMediaListResultSchema>>>;
  readVaultMedia(
    args: z.infer<typeof vaultMediaReadArgsSchema>,
  ): Promise<IpcResult<z.infer<typeof vaultMediaReadResultSchema>>>;
  generateVaultMedia(
    args: z.infer<typeof vaultMediaGenerateArgsSchema>,
  ): Promise<IpcResult<z.infer<typeof vaultMediaGenerateResultSchema>>>;
  /** la imagen que quedo esperando decision en esa conversacion, si quedo alguna */
  readVaultImagePending(
    args: z.infer<typeof vaultImagePendingArgsSchema>,
  ): Promise<IpcResult<z.infer<typeof vaultImagePendingResultSchema>>>;
  /** manda el pendiente —con el texto que sea— o lo tira. `discard` no cuesta nada */
  commitVaultImage(
    args: z.input<typeof vaultImageCommitArgsSchema>,
  ): Promise<IpcResult<z.infer<typeof vaultImageCommitResultSchema>>>;
  /** cuanto costaria, sin encolar nada. Solo AI Horde sabe contestarlo */
  estimateVaultImage(
    args: z.input<typeof vaultImageEstimateArgsSchema>,
  ): Promise<IpcResult<z.infer<typeof vaultImageEstimateResultSchema>>>;
  /** lo que se mando de verdad en esa conversacion, para mirarlo despues */
  listVaultImageAttempts(
    args: z.infer<typeof vaultImageAttemptsArgsSchema>,
  ): Promise<IpcResult<z.infer<typeof vaultImageAttemptsResultSchema>>>;
  /** corrige a mano el pie de foto; devuelve la lista ya actualizada */
  setVaultMediaCaption(
    args: z.infer<typeof vaultMediaCaptionArgsSchema>,
  ): Promise<IpcResult<z.infer<typeof vaultMediaListResultSchema>>>;
  /** se lo pide a un modelo con vista. Gasta una llamada */
  describeVaultMedia(
    args: z.infer<typeof vaultMediaDescribeArgsSchema>,
  ): Promise<IpcResult<z.infer<typeof vaultMediaDescribeResultSchema>>>;
  /** reescribe un pie de foto en buen español. Gasta una llamada, no guarda nada */
  rewriteVaultMediaCaption(
    args: z.infer<typeof vaultMediaRewriteCaptionArgsSchema>,
  ): Promise<IpcResult<z.infer<typeof vaultMediaRewriteCaptionResultSchema>>>;
  /** cifras sobre todas las conversaciones; nunca devuelve su contenido */
  diagnoseVaultMemory(): Promise<IpcResult<z.infer<typeof vaultMemoryDiagnosticsResultSchema>>>;
  probeVision(
    args: z.input<typeof vaultVisionProbeArgsSchema>,
  ): Promise<IpcResult<z.infer<typeof vaultVisionProbeResultSchema>>>;
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
  readVaultCharacterInstructions(
    args: z.infer<typeof vaultCharacterForgetArgsSchema>,
  ): Promise<IpcResult<z.infer<typeof vaultCharacterInstructionsResultSchema>>>;
  readVaultCharacterAvatar(
    args: z.infer<typeof vaultCharacterForgetArgsSchema>,
  ): Promise<IpcResult<z.infer<typeof vaultCharacterAvatarResultSchema>>>;
  /** todo, o solo una conversacion; sin argumentos, todo */
  syncVault(args?: VaultSyncScope): Promise<IpcResult<z.infer<typeof vaultSyncResultSchema>>>;
  /** cifras de cada conversacion de este equipo, sin descifrar nada */
  diagnoseVaultSync(): Promise<IpcResult<z.infer<typeof vaultSyncDiagnosisSchema>>>;
  /** aparta (renombra) la boveda local sin cuenta; nunca borra */
  setAsideLocalVault(): Promise<IpcResult<z.infer<typeof vaultLocalSetAsideResultSchema>>>;
  /**
   * avisa de que la boveda se cerro, por el camino que sea. Devuelve la funcion
   * de baja. Llega el motivo SIN validar: quien lo reciba lo pasa por
   * `vaultLockReasonSchema` antes de fiarse de el.
   */
  onVaultLocked(listener: (payload: unknown) => void): () => void;
  /**
   * como va la cola de AI Horde mientras se genera. Devuelve la funcion de baja.
   *
   * Llega muchas veces por imagen —el sondeo da unas ochenta vueltas en diez
   * minutos—, asi que es un contador en pantalla, no un aviso.
   */
  onHordeProgress(listener: (progress: HordeQueueProgress) => void): () => void;
  /** devuelve la funcion de baja; sin ella se acumulan listeners al navegar */
  onAgentEvent(listener: (event: z.infer<typeof agentEventSchema>) => void): () => void;
}

declare global {
  interface Window {
    luxy: LuxyBridge;
  }
}
