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
});

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
  /**
   * que le paso al bloque de memoria en este turno.
   *
   * Se calculaba y se tiraba. Sin esto, un modelo que escribe mal el bloque deja
   * la conversacion sin actualizar la memoria —se conserva la anterior, que es
   * lo correcto— y el usuario solo lo nota semanas despues, como «se le olvidan
   * cosas», sin poder atribuirlo al cambio de modelo.
   */
  memoryStatus: conversationMemoryStatusSchema,
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
  projectAlias: projectAliasSchema,
  /** solo esta; sin ella, todas las que lo necesiten */
  conversationId: conversationIdSchema.optional(),
  /** tope de conversaciones por tanda: cada una es una llamada de verdad */
  limit: z.number().int().min(1).max(10).default(3),
});

export const vaultCatalogSyncResultSchema = z.object({
  cataloged: z.number().int().min(0),
  scenes: z.number().int().min(0),
  /** las que se intentaron y no salieron, con el motivo */
  failed: z.array(z.object({ conversationId: z.string(), reason: z.string() })),
  /**
   * cuantas quedan por catalogar despues de esta tanda.
   *
   * Se devuelve porque sin esto la pantalla no puede distinguir «esta acabando
   * una cola» de «esta repitiendo lo mismo cada vez», que es exactamente la
   * confusion que produjo no enseñarlo.
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
  caption: z.string().max(2000).default(''),
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
  projectAlias: projectAliasSchema,
});

/** qué pasó al pedir la descripción; `caption` es null cuando no se pudo */
export const vaultMediaDescribeResultSchema = z.object({
  caption: z.string().nullable(),
  /** por qué no se pudo, para poder arreglarlo: no contestó o se negó */
  failure: z.enum(['vacio', 'negativa']).nullable(),
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
    caption: string,
  ): Promise<IpcResult<{ attached: number }>>;
  checkVaultCompatibility(
    args: z.infer<typeof vaultCompatibilityArgsSchema>,
  ): Promise<IpcResult<z.infer<typeof vaultCompatibilityResultSchema>>>;
  listVaultMemory(): Promise<IpcResult<z.infer<typeof vaultMemoryListResultSchema>>>;
  syncVaultCatalog(
    args: z.infer<typeof vaultCatalogSyncArgsSchema>,
  ): Promise<IpcResult<z.infer<typeof vaultCatalogSyncResultSchema>>>;
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
  /** corrige a mano el pie de foto; devuelve la lista ya actualizada */
  setVaultMediaCaption(
    args: z.infer<typeof vaultMediaCaptionArgsSchema>,
  ): Promise<IpcResult<z.infer<typeof vaultMediaListResultSchema>>>;
  /** se lo pide a un modelo con vista. Gasta una llamada */
  describeVaultMedia(
    args: z.infer<typeof vaultMediaDescribeArgsSchema>,
  ): Promise<IpcResult<z.infer<typeof vaultMediaDescribeResultSchema>>>;
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
