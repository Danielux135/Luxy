// estado de la boveda en el renderer.
//
// Este modulo NUNCA guarda material criptografico. Lo que maneja es:
//
//   - el estado que devuelve el proceso principal (si existe, si esta abierta);
//   - la contraseña, el tiempo justo que tarda en cruzar el IPC;
//   - la clave de recuperacion, sólo en el momento de crear la boveda y hasta
//     que el usuario confirma que la ha guardado.
//
// Nada de eso se persiste en localStorage, ni en un estado global, ni se envia
// a ningun sitio.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AuxiliaryChoice,
  ConversationMemoryStatus,
  HordeRecipe,
  ReasoningEffort,
  RelationStatus,
} from '@luxy/shared';
import type { HordeQueueProgress } from '../shared/horde-progress.js';
import { compatibilityFor, type CompatibilityRun } from './vault-compatibility-reply.js';
import { discardDecrypted } from './vault-lock-reset.js';
import type { RecapSweepRound } from './vault-sweep.js';
import type {
  vaultCompatibilityResultSchema,
  vaultMemoryListResultSchema,
  vaultRecapListResultSchema,
  vaultRecapSyncResultSchema,
  vaultRecapUpdateArgsSchema,
  vaultRelationListResultSchema,
  vaultVisionProbeResultSchema,
  vaultMemoryDiagnosticsResultSchema,
} from '../shared/ipc.js';
import type { z } from 'zod';

/**
 * lo que contesto un modelo en la sonda, con las cifras y lo que escribio.
 *
 * `replies` es CONTENIDO DE LA BOVEDA: vive en el estado de la ventana, se
 * enseña para poder comparar quien escribe mejor y se va al cerrar la boveda.
 * No se guarda, no vuelve al proceso principal y no se registra.
 */
export type CompatibilityResult = z.infer<typeof vaultCompatibilityResultSchema>['results'][number];
type MemoryEpisode = z.infer<typeof vaultMemoryListResultSchema>['episodes'][number];

/**
 * una promesa o un plan que quedo pendiente entre los dos.
 *
 * Lleva la cita literal porque es lo unico con lo que Daniel puede juzgar si de
 * verdad se prometio algo. Vive en el estado de la ventana y desaparece al
 * cerrar la boveda, como el resto del contenido privado.
 */
export type PendingAffair = z.infer<typeof vaultRelationListResultSchema>['notes'][number];

/**
 * una conversacion antigua con su ficha de continuidad, tal y como se repasa.
 *
 * Lleva el bloque ENTERO, que es contenido descifrado de la boveda: es lo unico
 * con lo que Daniel puede juzgar si lo escrito vale antes de dejarlo entrar en
 * ningun prompt, y desde el primer turno nuevo el modelo de pago lo arrastra
 * para siempre. Vive en el estado de la ventana y se va al cerrar la boveda.
 */
export type RecapRow = z.infer<typeof vaultRecapListResultSchema>['rows'][number];

/** la linea de cobertura; sus numeros SUMAN o es un fallo */
export type RecapCoverage = z.infer<typeof vaultRecapListResultSchema>['coverage'];

/** lo que se HABRIA escrito, para leerlo sin guardar nada */
export type RecapPreview = z.infer<typeof vaultRecapSyncResultSchema>['preview'][number];

/**
 * lo que hizo la ultima tanda, sin el vistazo.
 *
 * El vistazo va aparte porque es contenido de la boveda y solo llega con
 * `dryRun`; esto son cifras y se puede enseñar siempre.
 */
export type RecapSyncSummary = Omit<z.infer<typeof vaultRecapSyncResultSchema>, 'preview'>;

/** aprobar una, aprobarlas todas, u olvidar una */
export type RecapDecision = z.infer<typeof vaultRecapUpdateArgsSchema>;

/**
 * lo que devuelve el banco de pruebas de visión.
 *
 * No se guarda en ningún sitio: vive en el estado de la ventana y desaparece al
 * cerrar la bóveda. Es una prueba, no contenido.
 */
export type VisionProbe = z.infer<typeof vaultVisionProbeResultSchema>;

/** el diagnostico de la memoria: solo cifras, nunca contenido */
export type MemoryDiagnosticsView = z.infer<typeof vaultMemoryDiagnosticsResultSchema>;

/**
 * una prueba guardada a la vista, con identidad propia.
 *
 * El identificador no es adorno: sin el, la lista se dibujaba con la POSICION
 * como clave, y eso funciona mientras solo se apila por delante. En cuanto se
 * puede cerrar una del medio deja de funcionar: React reutiliza el recuadro de
 * la que se fue y enseña la imagen de una prueba con el texto de otra, que en
 * un banco cuya unica razon de ser es comparar modelos es el peor fallo
 * posible.
 */
export type StoredProbe = VisionProbe & { id: string };

/**
 * la cuenta, tal y como la ve la interfaz.
 *
 * `email` puede existir sin `signedIn`: la bóveda de este equipo pertenece a
 * una cuenta y su sesión ha caducado. Son dos problemas distintos y se
 * arreglan de forma distinta, así que se muestran por separado.
 */
/** un personaje guardado. Crearlo cuesta créditos: por eso se guarda */
export interface VaultCharacterView {
  /** la clave durable de la bóveda; a ella se agarran recuerdos e imágenes */
  characterId: string;
  description: string;
  label: string;
  avatarObjectKey: string | null;
  createdAt: string;
  /** quién le hace las fotos AHORA; se cambia sin tocar nada más (`D-068`) */
  imageProvider: 'xavira' | 'horde';
  /** su identidad en Xavira, si la tiene. El identificador es el de SU API */
  xavira: { characterId: string; modelId: string } | null;
  /**
   * su aspecto en AI Horde, si lo tiene.
   *
   * Allí no hay personajes en el servidor: esto **es** su cara, y por eso la
   * pantalla tiene que poder enseñarlo y corregirlo.
   */
  horde: { recipe: HordeRecipe } | null;
}

export interface VaultAccountView {
  email: string | null;
  signedIn: boolean;
  expiresAt: string | null;
  /** se entró con la clave de recuperación: toca elegir contraseña nueva */
  openedWithRecoveryKey: boolean;
}

export interface VaultStatusView {
  configured: boolean;
  unlocked: boolean;
  methods: { password: boolean; recovery: boolean; device: boolean };
  /** 0 significa que no se cierra sola */
  autoLockMinutes: number;
  lockingInMs: number | null;
  account: VaultAccountView;
  /** hay clave guardada del proveedor de imágenes; nunca la clave */
  mediaProviderConfigured: boolean;
  /** hay clave guardada de AI Horde, el proveedor gratuito */
  hordeConfigured: boolean;
  /** esa clave es la anónima: funciona, pero comparte lo que genera */
  hordeAnonymous: boolean;
}

const CLOSED: VaultStatusView = {
  configured: false,
  unlocked: false,
  methods: { password: false, recovery: false, device: false },
  autoLockMinutes: 0,
  lockingInMs: null,
  account: { email: null, signedIn: false, expiresAt: null, openedWithRecoveryKey: false },
  mediaProviderConfigured: false,
  hordeConfigured: false,
  hordeAnonymous: false,
};

/**
 * cuantas pruebas de vision se conservan a la vista.
 *
 * Son imagenes descifradas en memoria: guardarlas todas llenaria la pantalla
 * de copias que ya nadie mira. Cuatro bastan para comparar modelos, que es
 * para lo que existe el banco.
 */
const MAX_PROBES = 4;

/** cada cuanto se refresca la cuenta atras del bloqueo automatico */
const TICK_MS = 5000;

export interface PrivateTurn {
  sequence: number;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
}

export interface PrivateConversation {
  conversationId: string;
  title: string;
  turns: number;
  updatedAt: string;
  /** de quién es el hilo; `null` cuando nunca se eligió personaje */
  characterId: string | null;
  /** su nombre, ya resuelto por el proceso principal; `null` si ya no existe */
  characterLabel: string | null;
}

export interface PrivateMediaItem {
  mediaId: string;
  mimeType: string;
  displayName: string | null;
  hasThumbnail: boolean;
  /** false si es demasiado grande para previsualizar por ahora */
  previewable: boolean;
  /**
   * lo que se VE en el archivo, y lo único que el modelo sabe de él.
   *
   * Con esto decide cuál reenviarte en vez de pagar otra generación. Se puede
   * corregir; `null` cuando nadie lo ha escrito.
   */
  caption: string | null;
  /** lo que se PIDIÓ al generarlo. Es historia y no se corrige */
  prompt: string | null;
  /**
   * el modelo que la dibujó de verdad.
   *
   * No es el primero de la receta: se mandan varios para que la coja el que
   * esté libre, y cada uno da una cara distinta.
   */
  model: string | null;
}

export interface VaultComposer {
  /** proveedor elegido; `null` mientras no se haya elegido ninguno */
  provider: string | null;
  /**
   * modelo elegido; `null` deja decidir al de la conexion.
   *
   * Mandarlo siempre en `null` era el motivo de que una conversacion privada
   * acabara SIEMPRE en el modelo por defecto de la conexion, sin poder elegir.
   */
  model: string | null;
  /**
   * cuanto se le deja pensar; `null` deja lo que traiga el proveedor.
   *
   * No se persiste, como el resto del composer, y eso aqui es deliberado: el
   * esfuerzo se paga por turno, y una eleccion cara que sobreviviera a cerrar
   * la ventana volveria a cobrarse sin que nadie la hubiera vuelto a elegir.
   */
  effort: ReasoningEffort | null;
  /** proyecto elegido; `null` mientras no se haya elegido ninguno */
  project: string | null;
  message: string;
  /** `null` mientras no se editen: enviar sin tocarlas conserva las guardadas */
  instructions: string | null;
  characterId: string | null;
  characterDescription: string | null;
  /** pie de foto que acompañara al proximo adjunto */
  caption: string;
  /**
   * quién MIRA las imágenes, aparte de quién lleva la conversación.
   *
   * Son dos cosas distintas y compartían selector: elegir un modelo con vista
   * para describir una foto cambiaba también quién encarna al personaje. Con
   * esto, Lía sigue en su modelo y las fotos las mira otro.
   *
   * `null` significa «el mismo de la conversación», que es el comportamiento de
   * siempre y sigue siendo un valor legítimo.
   */
  visionProvider: string | null;
  visionModel: string | null;
  /**
   * y cuanto se le deja pensar a QUIEN MIRA.
   *
   * Aparte del de la conversacion por lo mismo que el modelo esta aparte:
   * describir una foto y encarnar a alguien son dos trabajos, y el ajuste de
   * uno no puede gobernar el otro. Sin esto, el banco de pruebas comparaba
   * modelos mezclando dos variables sin decirlo.
   */
  visionEffort: ReasoningEffort | null;
}

/**
 * lo que se borra al cambiar de conversacion.
 *
 * Fuera quedan proveedor, modelo y proyecto: los dos primeros los trae la
 * conversacion que se abre, y el proyecto es preferencia del usuario.
 */
const EMPTY_DRAFT = {
  message: '',
  instructions: null,
  characterId: null,
  characterDescription: null,
  caption: '',
} satisfies Omit<
  VaultComposer,
  | 'provider'
  | 'model'
  | 'effort'
  | 'project'
  | 'visionProvider'
  | 'visionModel'
  | 'visionEffort'
>;

export interface VaultController {
  status: VaultStatusView;
  loading: boolean;
  busy: boolean;
  error: string | null;
  hint: string | null;
  /** sólo entre crear la boveda y confirmar que se copio */
  recoveryKey: string | null;
  /** crea la cuenta: la bóveda de este equipo nace vinculada a ella */
  registerAccount: (email: string, password: string) => Promise<boolean>;
  /** entra en una cuenta ya existente y trae su llave a este equipo */
  loginAccount: (
    email: string,
    secret: string,
    method?: 'password' | 'recovery',
  ) => Promise<boolean>;
  /** sube a una cuenta nueva la bóveda que ya existía aquí, sin recifrarla */
  linkAccount: (email: string, password: string) => Promise<boolean>;
  logoutAccount: () => Promise<void>;
  /** guarda la clave del proveedor de imágenes; el nombre lo pone el main */
  setMediaKey: (apiKey: string) => Promise<boolean>;
  deleteMediaKey: () => Promise<void>;
  /** guarda la clave de AI Horde, el proveedor de imágenes gratuito */
  setHordeKey: (apiKey: string) => Promise<boolean>;
  deleteHordeKey: () => Promise<void>;
  /** kudos y prioridad de la cuenta del horde; null si no se ha consultado */
  hordeAccount: { username: string; kudos: number; concurrency: number; anonymous: boolean } | null;
  readHordeAccount: () => Promise<void>;
  /** modelos con workers AHORA MISMO; null hasta que se piden */
  hordeModels: { name: string; count: number; eta: number; jobs: number }[] | null;
  loadHordeModels: () => Promise<void>;
  /**
   * guarda o corrige un personaje de AI Horde. No cuesta nada y se puede
   * repetir: allí un personaje **es** su receta.
   */
  saveHordeCharacter: (input: {
    characterId: string;
    label: string;
    description: string;
    recipe: HordeRecipe;
  }) => Promise<string | null>;
  /** corrige a mano el pie de foto de un archivo guardado */
  setMediaCaption: (mediaId: string, caption: string) => Promise<boolean>;
  /**
   * le pide a un modelo con vista que describa un archivo.
   *
   * Gasta una llamada, así que lo dispara el usuario. Devuelve el motivo cuando
   * no se pudo: no contestó, o se negó, que se arreglan de forma distinta.
   */
  describeMedia: (input: {
    mediaId: string;
    provider: string;
    model: string | null;
    /** `null` deja el esfuerzo que traiga el proveedor */
    effort: ReasoningEffort | null;
    projectAlias: string;
    /** `reasoning` se devuelve para verlo, y NUNCA se guarda con el archivo */
  }) => Promise<{ caption: string | null; failure: string | null; reasoning: string | null }>;
  describingMedia: boolean;
  /**
   * reescribe un pie de foto en español correcto sin cambiar lo que dice.
   *
   * **No guarda nada.** Devuelve el texto para que vuelva al recuadro y se
   * acepte o se tire a mano: los modelos con vista redactan mal, pero ven bien,
   * y sustituir a ciegas lo que vieron por lo que otro modelo supone que
   * quisieron decir es cambiar un texto verdadero por uno que nadie ha leído.
   */
  rewriteCaption: (input: {
    caption: string;
    provider: string;
    model: string | null;
    /** `null` deja el esfuerzo que traiga el proveedor */
    effort: ReasoningEffort | null;
    projectAlias: string;
  }) => Promise<{ caption: string | null; failure: string | null; reasoning: string | null }>;
  rewritingCaption: boolean;
  /**
   * comprueba la memoria sobre TODAS las conversaciones ya tenidas.
   *
   * Cobertura del catalogo, una prueba de la busqueda por fecha contra las
   * fechas reales, y el estilo en cifras. Nada de contenido sale de la boveda.
   */
  diagnoseMemory: () => Promise<MemoryDiagnosticsView | null>;
  diagnosingMemory: boolean;
  lastDiagnostics: MemoryDiagnosticsView | null;
  /**
   * banco de pruebas: una imagen del disco y a ver qué dice el modelo.
   *
   * **No escribe nada** y no necesita conversación abierta. Sirve para saber si
   * un modelo sabe mirar antes de gastar una llamada sobre contenido de la
   * bóveda, y sin dejar una conversación de prueba dentro.
   */
  probeVision: (input: {
    provider: string;
    model: string | null;
    /** `null` deja el esfuerzo que traiga el proveedor */
    effort: ReasoningEffort | null;
    projectAlias: string;
  }) => Promise<VisionProbe | null>;
  probingVision: boolean;
  /** lo último que devolvió el banco de pruebas; no se guarda en disco */
  /**
   * lo que ha devuelto el banco de pruebas, de lo más reciente a lo más viejo.
   *
   * Una lista y no el último: el banco existe para COMPARAR modelos, y
   * guardando sólo uno el siguiente intento borraba el anterior. Pasó de
   * verdad: Claude describió una imagen y, treinta y dos segundos después, el
   * 429 de Mistral se llevó esa descripción de la pantalla sin que se leyera.
   *
   * No se persiste en ningún sitio y muere al cerrar la bóveda.
   */
  probes: StoredProbe[];
  /** olvida lo probado hasta ahora; nada de esto estaba guardado */
  clearProbes: () => void;
  /**
   * cierra UNA prueba.
   *
   * Existe porque las que se quedan son imagenes descifradas en la pantalla.
   * El tope de cuatro las acaba echando, pero «acabar» puede ser dentro de un
   * rato y mientras tanto siguen ahi a la vista. Poder quitar la que ya has
   * mirado es lo mismo que la galeria plegada: nada del contenido privado se
   * queda expuesto porque si.
   */
  dismissProbe: (id: string) => void;
  /**
   * cambia quién le hace las fotos a un personaje.
   *
   * No toca nada más: el personaje, sus recuerdos y sus conversaciones siguen
   * siendo los mismos. Falla si todavía no tiene identidad en el destino.
   */
  setCharacterImageProvider: (
    characterId: string,
    provider: 'xavira' | 'horde',
  ) => Promise<boolean>;
  create: (password: string) => Promise<boolean>;
  unlock: (method: 'password' | 'recovery' | 'device', secret?: string) => Promise<boolean>;
  lock: () => Promise<void>;
  changePassword: (current: string, next: string) => Promise<boolean>;
  setDeviceUnlock: (enabled: boolean) => Promise<boolean>;
  setAutoLock: (minutes: number) => Promise<boolean>;
  conversations: PrivateConversation[];
  openConversationId: string | null;
  turns: PrivateTurn[];
  /** instrucciones fijas de la conversación abierta; null si no tiene */
  instructions: string | null;
  /** personaje que gobierna las imágenes de la conversación abierta */
  characterId: string | null;
  /** quién es ese personaje, en texto: es lo que lee el modelo */
  characterDescription: string | null;
  /**
   * qué pasó con la imagen del último turno.
   *
   * null si el modelo no pidió ninguna, que es lo normal. Existe para que la
   * interfaz pueda decir por qué no hay imagen: callarse parece un cuelgue.
   */
  lastImage: {
    mediaId: string | null;
    costCredits: number | null;
    /** en qué se cuenta: los créditos se compran con dinero y los kudos no */
    costUnit: 'creditos' | 'kudos' | null;
    error: string | null;
  } | null;
  /**
   * que le paso al bloque de memoria en el ultimo turno.
   *
   * Existe para poder cambiar de modelo con evidencia: un modelo mas pequeño
   * puede escribir bien la escena y mal el bloque, y esa averia es silenciosa.
   */
  lastMemoryStatus: ConversationMemoryStatus | null;
  /** resultado de la ultima comprobacion de compatibilidad; null si no se hizo */
  /** episodios que el personaje puede recordar; null hasta que se piden */
  memoryEpisodes: MemoryEpisode[] | null;
  /** conversaciones que hoy quedan fuera del banco */
  memoryExcluded: string[];
  /** quien hace el trabajo de fondo de la boveda; `null` es automatico */
  auxiliary: AuxiliaryChoice | null;
  loadAuxiliary: () => Promise<void>;
  setAuxiliary: (choice: AuxiliaryChoice | null) => Promise<void>;
  loadMemory: () => Promise<void>;
  /**
   * cataloga en escenas lo que aun no lo este. Gasta una llamada por
   * conversacion, asi que la pantalla lo lanza una vez al abrirse y no en bucle.
   */
  syncCatalog: (input: {
    provider: string;
    model: string | null;
    /** `null` deja el esfuerzo que traiga el proveedor */
    effort: ReasoningEffort | null;
    projectAlias: string;
    /** solo esta, y reintentandola aunque hubiera fallado antes */
    conversationId?: string;
  }) => Promise<{ pending: number; cataloged: number; failed: number } | null>;
  catalogingMemory: boolean;
  /** que paso en el ultimo catalogado; null si no se ha hecho ninguno */
  lastCatalog: {
    cataloged: number;
    scenes: number;
    pending: number;
    failed: { conversationId: string; reason: string }[];
    /**
     * catálogos que parecen cortados por longitud y no por lo que pasa.
     *
     * Todas las escenas del mismo tamaño no es como fue la conversación: es que
     * el modelo no encontró dónde cortar y repartió. El catálogo se conserva;
     * esto sólo permite avisar y ofrecer repetirlo con otro modelo.
     */
    uneven: { conversationId: string; scenes: number }[];
  } | null;
  /**
   * busca en lo ya hablado las promesas y los planes que quedaron pendientes.
   *
   * Va al mismo sitio que catalogar —Claude o Codex con la sesión local— y por
   * el mismo carril, así que nunca corren los dos a la vez. Devuelve `null` si
   * ya había una en marcha.
   */
  syncRelations: (input: {
    projectAlias: string;
    /** sólo ésta, y reintentándola aunque se hubiera negado antes */
    conversationId?: string;
    /**
     * pedida a mano: reintenta lo que se negó o falló antes.
     *
     * Sin esto, una negativa no tenía salida desde ninguna pantalla: quedaba
     * persistida en el almacén y ni cambiar de CLI ni reiniciar la volvían a
     * intentar.
     */
    force?: boolean;
  }) => Promise<{
    pending: number;
    reviewed: number;
    notes: number;
    refused: number;
    failed: number;
  } | null>;
  syncingRelations: boolean;
  /** qué pasó en la última búsqueda; null si no se ha hecho ninguna */
  lastRelationSync: {
    reviewed: number;
    notes: number;
    closed: number;
    refused: number;
    failed: { conversationId: string; reason: string }[];
    pending: number;
  } | null;
  /**
   * lo que quedó pendiente entre los dos; `null` hasta que se pide.
   *
   * Es una lista para CORREGIR: lo que Daniel descarte aquí no vuelve a
   * apuntarse, y lo que dé por cumplido deja de poder salir por boca de ella.
   */
  pendingAffairs: PendingAffair[] | null;
  loadPendingAffairs: () => Promise<void>;
  /**
   * la última palabra sobre un pendiente.
   *
   * El estado es la decisión: cumplida, ya no vale, no era una promesa y
   * reabrir. El extractor no la pisa nunca.
   */
  decidePendingAffair: (id: string, status: RelationStatus) => Promise<void>;
  /** hay una decisión escribiéndose: los botones se apagan mientras tanto */
  decidingPendingAffair: boolean;
  /**
   * rellena hacia atrás la memoria acumulativa de las conversaciones viejas.
   *
   * Va al mismo sitio que catalogar y que buscar lo pendiente —Claude o Codex
   * con la sesión local— y por el mismo carril, así que nunca corren dos a la
   * vez. Devuelve `null` si ya había una en marcha o si falló, que es lo que
   * `keepSweepingRecaps` entiende como «no insistas».
   */
  syncRecaps: (input: {
    projectAlias: string;
    /** sólo ésta */
    conversationId?: string;
    /** «Rehacerlo»: la empieza desde cero y se salta lo que se negó antes */
    force?: boolean;
    /**
     * corre la pasada entera y NO guarda nada.
     *
     * Es lo único que contesta a la vez «¿se niegan los CLI?» y «¿sale bueno el
     * resumen?». Lo que devuelve se lee y se tira.
     */
    dryRun?: boolean;
  }) => Promise<RecapSweepRound | null>;
  syncingRecaps: boolean;
  /** qué pasó en la última tanda; null si no se ha hecho ninguna */
  lastRecapSync: RecapSyncSummary | null;
  /**
   * lo que se habría escrito sin guardarlo; `null` mientras no se pruebe.
   *
   * Es contenido descifrado de la bóveda: se enseña, se tira y no va a ningún
   * registro.
   */
  recapPreview: RecapPreview[] | null;
  clearRecapPreview: () => void;
  /**
   * las fichas escritas, con su bloque entero; `null` hasta que se piden.
   *
   * Es una lista para LEER ANTES: una ficha de un CLI no entra en ningún prompt
   * hasta que Daniel la aprueba, porque lo único que el código no puede cazar es
   * un resumen competente pero saneado, que valida, avanza y se queda de semilla
   * para siempre en ese hilo.
   */
  recaps: RecapRow[] | null;
  /** la línea de cobertura que acompaña a la lista */
  recapCoverage: RecapCoverage | null;
  loadRecaps: () => Promise<void>;
  /** aprobar una, aprobarlas todas, u olvidar una; devuelve la lista ya rehecha */
  decideRecap: (args: RecapDecision) => Promise<void>;
  /** hay una decisión escribiéndose: los botones se apagan mientras tanto */
  decidingRecap: boolean;
  readMemoryEpisode: (
    episode: MemoryEpisode,
  ) => Promise<{ role: 'user' | 'assistant'; text: string }[]>;
  /**
   * los turnos de un tramo cualquiera, para verlos tal y como se dijeron.
   *
   * Lo usan los episodios y el «Ver turno» de un pendiente, que apunta a un
   * turno suelto (`from === to`). Es el mismo canal: un pendiente no es un
   * resumen, es un puntero a algo que se dijo de verdad.
   */
  readMemoryTurns: (input: {
    conversationId: string;
    from: number;
    to: number;
  }) => Promise<{ role: 'user' | 'assistant'; text: string }[]>;
  excludeFromMemory: (conversationId: string, excluded: boolean) => Promise<void>;
  compatibility: CompatibilityResult[] | null;
  checkingCompatibility: boolean;
  /**
   * prueba la conversacion abierta contra varios modelos.
   *
   * Solo lectura: no añade turnos ni toca la memoria. La sonda es la propia
   * conversacion, que ya esta en la boveda.
   */
  checkCompatibility: (input: {
    projectAlias: string;
    /** el esfuerzo va dentro del candidato: es parte de lo que se compara */
    targets: { provider: string; model: string | null; effort: ReasoningEffort | null }[];
    repetitions: number;
  }) => Promise<void>;
  /**
   * lo que hay escrito y todavia no se ha enviado.
   *
   * Vive AQUI y no en la pantalla a proposito. Estaba en estado del componente,
   * asi que cambiar de pestaña desmontaba la pagina y se perdia todo: las
   * instrucciones a medio escribir desaparecian sin haberse guardado nunca, y
   * el proveedor volvia al primero de la lista, con lo que se acababa enviando
   * a un modelo que no era el elegido.
   */
  composer: VaultComposer;
  setComposer: (patch: Partial<VaultComposer>) => void;
  sending: boolean;
  openConversation: (conversationId: string | null) => Promise<void>;
  /** devuelve `true` si el mensaje llego a formar parte de la conversacion */
  send: (input: {
    message: string;
    provider: string;
    /** `null` deja que decida la conexion; con valor, manda este */
    model: string | null;
    /** `null` deja el esfuerzo que traiga el proveedor */
    effort: ReasoningEffort | null;
    projectAlias: string;
    /** null conserva las que hubiera; cadena vacía las borra */
    instructions: string | null;
    characterId: string | null;
    characterDescription: string | null;
  }) => Promise<boolean>;
  removeConversation: (conversationId: string) => Promise<void>;
  media: PrivateMediaItem[];
  attaching: boolean;
  /** el pie de foto es lo unico que el modelo llega a saber del archivo */
  attachMedia: (caption: string) => Promise<void>;
  openMedia: (mediaId: string) => Promise<string | null>;
  generating: boolean;
  /** como va la cola de AI Horde mientras se genera; `null` si no se espera nada */
  hordeProgress: HordeQueueProgress | null;
  /** créditos declarados por el proveedor en la última generación */
  lastCost: { amount: number; unit: 'creditos' | 'kudos' } | null;
  generateMedia: (input: {
    characterId: string;
    prompt: string;
    kind: 'image' | 'video';
    /**
     * parte de una imagen que ya está en esta conversación (img2img).
     *
     * Varía una imagen que ya salió bien; no lleva la cara del personaje a una
     * escena nueva, que es otra cosa y AI Horde no sabe hacerla.
     */
    fromMediaId?: string;
  }) => Promise<boolean>;
  /**
   * crea un personaje. Con `withReferenceImage`, el proceso principal abre el
   * diálogo, cifra la imagen en la conversación y la envía en el cuerpo de la
   * petición: no se publica en ninguna parte y el renderer nunca ve los bytes.
   */
  /** personajes guardados en la bóveda; la API no sabe listarlos */
  characters: VaultCharacterView[];
  createCharacter: (input: {
    modelId: 'realistic-sharp-v1' | 'anime-pure-v1';
    traits: Record<string, string>;
    scene: string;
    sfw: boolean;
    label: string;
    description: string;
  }) => Promise<string | null>;
  forgetCharacter: (characterId: string) => Promise<void>;
  /** da de alta uno que ya existe en el proveedor; la API no sabe listarlos */
  importCharacter: (input: {
    characterId: string;
    modelId: 'realistic-sharp-v1' | 'anime-pure-v1';
    label: string;
    description: string;
    avatarUrl: string;
  }) => Promise<boolean>;
  /**
   * las ultimas instrucciones que se usaron con ese personaje.
   *
   * Para no reescribir su personalidad en cada conversacion nueva: es del
   * personaje, no del hilo.
   */
  readCharacterInstructions: (characterId: string) => Promise<string | null>;
  /** avatar descifrado como data URL; null si ese personaje no tiene */
  readCharacterAvatar: (characterId: string) => Promise<string | null>;
  syncing: boolean;
  lastSync: {
    uploaded: number;
    downloaded: number;
    mediaUploaded: number;
    mediaDownloaded: number;
    mediaSkipped: number;
  } | null;
  sync: () => Promise<void>;
  acknowledgeRecoveryKey: () => void;
  clearError: () => void;
}

export function useVault(): VaultController {
  const [status, setStatus] = useState<VaultStatusView>(CLOSED);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [conversations, setConversations] = useState<PrivateConversation[]>([]);
  const [openConversationId, setOpenConversationId] = useState<string | null>(null);
  const [turns, setTurns] = useState<PrivateTurn[]>([]);
  const [instructions, setInstructions] = useState<string | null>(null);
  const [characterId, setCharacterId] = useState<string | null>(null);
  const [characterDescription, setCharacterDescription] = useState<string | null>(null);
  const [characters, setCharacters] = useState<VaultCharacterView[]>([]);
  const [describingMedia, setDescribingMedia] = useState(false);
  const [rewritingCaption, setRewritingCaption] = useState(false);
  const [diagnosingMemory, setDiagnosingMemory] = useState(false);
  const [lastDiagnostics, setLastDiagnostics] = useState<MemoryDiagnosticsView | null>(null);
  const [probingVision, setProbingVision] = useState(false);
  // lo ultimo que devolvio el banco de pruebas; no se guarda en ningun sitio
  const [probes, setProbes] = useState<StoredProbe[]>([]);
  const [hordeAccount, setHordeAccount] = useState<{
    username: string;
    kudos: number;
    concurrency: number;
    anonymous: boolean;
  } | null>(null);
  // null significa «todavía no se ha preguntado»; [] significa «no hay ninguno»
  const [hordeModels, setHordeModels] = useState<
    { name: string; count: number; eta: number; jobs: number }[] | null
  >(null);
  const [lastImage, setLastImage] = useState<VaultController['lastImage']>(null);
  const [lastMemoryStatus, setLastMemoryStatus] = useState<ConversationMemoryStatus | null>(null);
  const [memoryEpisodes, setMemoryEpisodes] = useState<MemoryEpisode[] | null>(null);
  const [memoryExcluded, setMemoryExcluded] = useState<string[]>([]);
  const [auxiliary, setAuxiliaryState] = useState<AuxiliaryChoice | null>(null);
  const [catalogingMemory, setCatalogingMemory] = useState(false);
  // un `useState` no sirve de guarda: dentro del callback llega con el valor de
  // la ultima renderizacion, y dos disparos seguidos lo leen los dos en `false`
  const catalogingRef = useRef(false);
  const [lastCatalog, setLastCatalog] = useState<VaultController['lastCatalog']>(null);
  const [syncingRelations, setSyncingRelations] = useState(false);
  // por el mismo motivo que el del catálogo: dentro del callback, un `useState`
  // llega con el valor de la última renderización
  const relationsRef = useRef(false);
  const [lastRelationSync, setLastRelationSync] =
    useState<VaultController['lastRelationSync']>(null);
  const [pendingAffairs, setPendingAffairs] = useState<PendingAffair[] | null>(null);
  const [decidingPendingAffair, setDecidingPendingAffair] = useState(false);
  const [syncingRecaps, setSyncingRecaps] = useState(false);
  // y por el mismo motivo que los otros dos: dentro del callback, un `useState`
  // llega con el valor de la ultima renderizacion y dos disparos seguidos lo
  // leen los dos en `false`
  const recapsRef = useRef(false);
  const [lastRecapSync, setLastRecapSync] = useState<RecapSyncSummary | null>(null);
  const [recapPreview, setRecapPreview] = useState<RecapPreview[] | null>(null);
  const [recaps, setRecaps] = useState<RecapRow[] | null>(null);
  const [recapCoverage, setRecapCoverage] = useState<RecapCoverage | null>(null);
  const [decidingRecap, setDecidingRecap] = useState(false);
  // atada a la conversacion con la que se pidio, y no suelta: se genera con SU
  // personaje y SU memoria, asi que pintarla bajo otra seria atribuir el
  // roleplay de un hilo a otro. Quien decide si se puede pintar es
  // `compatibilityFor`, unas lineas mas abajo
  const [compatibility, setCompatibility] = useState<CompatibilityRun<CompatibilityResult> | null>(
    null,
  );
  const [checkingCompatibility, setCheckingCompatibility] = useState(false);
  const [sending, setSending] = useState(false);
  const [composer, setComposerState] = useState<VaultComposer>({
    provider: null,
    model: null,
    // arranca sin elegir a proposito: lo que traiga el proveedor. Poner aqui un
    // valor seria decidir por el usuario cuanto gasta cada turno
    effort: null,
    project: null,
    // quien mira las imagenes es una preferencia de la herramienta, no
    // de la conversacion: no se borra al cambiar de hilo
    visionProvider: null,
    visionModel: null,
    visionEffort: null,
    ...EMPTY_DRAFT,
  });
  const [media, setMedia] = useState<PrivateMediaItem[]>([]);
  const [attaching, setAttaching] = useState(false);
  const [generating, setGenerating] = useState(false);
  // como va la cola del horde AHORA. Se pisa a si mismo en cada vuelta del
  // sondeo y se borra al terminar: es un contador, no un historial
  const [hordeProgress, setHordeProgress] = useState<HordeQueueProgress | null>(null);
  const [lastCost, setLastCost] = useState<{
    amount: number;
    unit: 'creditos' | 'kudos';
  } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<VaultController['lastSync']>(null);
  const mounted = useRef(true);

  /**
   * como se vacia cada cosa descifrada.
   *
   * Los setters de `useState` no cambian nunca, asi que esto se construye una
   * vez y las dos rutas que cierran la boveda —el refresco que detecta el
   * bloqueo y el cierre de sesion— usan el mismo objeto. Quien añada un estado
   * con contenido de la boveda a `DECRYPTED_RENDERER_STATE` y no lo ponga aqui
   * se entera al compilar, que es el unico aviso que no se olvida.
   */
  const purga = useMemo(
    () => ({
      conversations: () => setConversations([]),
      turns: () => setTurns([]),
      media: () => setMedia([]),
      probes: () => setProbes([]),
      instructions: () => setInstructions(null),
      openConversation: () => setOpenConversationId(null),
      pendingAffairs: () => setPendingAffairs(null),
      recaps: () => setRecaps(null),
      recapCoverage: () => setRecapCoverage(null),
      recapPreview: () => setRecapPreview(null),
      compatibility: () => setCompatibility(null),
    }),
    [],
  );

  const refresh = useCallback(async (): Promise<void> => {
    const result = await window.luxy.getVaultStatus();
    if (!mounted.current) return;
    if (result.ok) {
      setStatus(result.value);
      // al cerrarse la boveda se descarta TODO lo descifrado que hubiera en
      // memoria del renderer. No se oculta: deja de existir aqui.
      //
      // La lista vive en `vault-lock-reset.ts` y no aqui porque este bloque y el
      // de `logoutAccount` la tenian escrita cada uno por su cuenta y acabaron
      // distintos: el texto de la sonda entro sin que ninguno de los dos se
      // enterara
      if (!result.value.unlocked) discardDecrypted(purga);
    }
    setLoading(false);
  }, [purga]);

  const reloadCharacters = useCallback(async (): Promise<void> => {
    const result = await window.luxy.listVaultCharacters();
    if (mounted.current && result.ok) setCharacters(result.value.characters);
  }, []);

  const reloadConversations = useCallback(async (): Promise<void> => {
    const result = await window.luxy.listVaultConversations();
    if (mounted.current && result.ok) setConversations(result.value.conversations);
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    // el bloqueo automatico ocurre en el proceso principal; aqui solo se
    // refresca la cuenta atras para que la interfaz no mienta
    const timer = setInterval(() => void refresh(), TICK_MS);
    const unsubscribe = window.luxy.onVaultLocked(() => {
      void refresh();
      setHint('La bóveda se cerró sola por inactividad.');
    });
    // la cola de AI Horde. Llega muchas veces por imagen —el sondeo da unas
    // ochenta vueltas en diez minutos—, asi que es un contador que se pisa a si
    // mismo, no una lista de avisos
    const unsubscribeHorde = window.luxy.onHordeProgress((progress) => {
      if (mounted.current) setHordeProgress(progress);
    });
    return () => {
      mounted.current = false;
      clearInterval(timer);
      unsubscribe();
      unsubscribeHorde();
    };
  }, [refresh]);

  /** envuelve una operacion: un solo sitio decide como se ven los errores */
  const run = useCallback(
    async <T>(operation: () => Promise<{ ok: true; value: T } | { ok: false; error: string; hint: string | null }>): Promise<T | null> => {
      setBusy(true);
      setError(null);
      setHint(null);
      try {
        const result = await operation();
        if (!result.ok) {
          setError(result.error);
          setHint(result.hint);
          return null;
        }
        return result.value;
      } finally {
        if (mounted.current) setBusy(false);
      }
    },
    [],
  );

  const create = useCallback(
    async (password: string): Promise<boolean> => {
      const value = await run(() => window.luxy.createVault(password));
      if (value === null) return false;
      setStatus(value.status);
      // se muestra una vez. Si el usuario no la copia, deja de existir.
      setRecoveryKey(value.recoveryKey);
      return true;
    },
    [run],
  );

  const registerAccount = useCallback(
    async (email: string, password: string): Promise<boolean> => {
      const value = await run(() => window.luxy.registerVaultAccount({ email, password }));
      if (value === null) return false;
      setStatus(value.status);
      // se muestra una vez. Si el usuario no la copia, deja de existir.
      setRecoveryKey(value.recoveryKey);
      return true;
    },
    [run],
  );

  const loginAccount = useCallback(
    async (
      email: string,
      secret: string,
      method: 'password' | 'recovery' = 'password',
    ): Promise<boolean> => {
      const value = await run(() => window.luxy.loginVaultAccount({ email, method, secret }));
      if (value === null) return false;
      setStatus(value);
      void reloadConversations();
      void reloadCharacters();
      return true;
    },
    [run, reloadConversations, reloadCharacters],
  );

  const linkAccount = useCallback(
    async (email: string, password: string): Promise<boolean> => {
      const value = await run(() => window.luxy.linkVaultAccount({ email, password }));
      if (value === null) return false;
      setStatus(value.status);
      // la clave nueva se muestra una vez, igual que al crear la cuenta: la
      // anterior ha dejado de valer y hay que decirlo con el papel delante
      setRecoveryKey(value.recoveryKey);
      return true;
    },
    [run],
  );

  const logoutAccount = useCallback(async (): Promise<void> => {
    const value = await run(() => window.luxy.logoutVaultAccount());
    if (value === null) return;
    // salir cierra también la bóveda, y lo descifrado se descarta AQUÍ y no en
    // el próximo refresco: hasta entonces seguiría en memoria del renderer.
    // Por la misma lista que el bloqueo, que es de donde le faltaban la mitad de
    // las cosas cuando la mantenía a mano
    setStatus(value);
    discardDecrypted(purga);
  }, [run, purga]);

  const setMediaKey = useCallback(
    async (apiKey: string): Promise<boolean> => {
      const value = await run(() => window.luxy.setVaultMediaKey({ apiKey }));
      if (value === null) return false;
      setStatus(value);
      setHint('Clave guardada. Ya puedes pedir imágenes dentro de una conversación.');
      return true;
    },
    [run],
  );

  const deleteMediaKey = useCallback(async (): Promise<void> => {
    const value = await run(() => window.luxy.deleteVaultMediaKey());
    if (value !== null) setStatus(value);
  }, [run]);

  const setHordeKey = useCallback(
    async (apiKey: string): Promise<boolean> => {
      const value = await run(() => window.luxy.setVaultHordeKey({ apiKey }));
      if (value === null) return false;
      setStatus(value);
      // los kudos que hubiera en pantalla son de la clave anterior: dejarlos
      // ahí sería enseñar el saldo de una cuenta que ya no es la configurada
      setHordeAccount(null);
      setHint(
        value.hordeAnonymous
          ? 'Clave anónima guardada. Funciona, pero la red te atiende la última y comparte lo que generes: una clave propia de aihorde.net es gratis y no comparte nada.'
          : 'Clave de AI Horde guardada. Ya puedes crear un personaje gratuito.',
      );
      return true;
    },
    [run],
  );

  const deleteHordeKey = useCallback(async (): Promise<void> => {
    const value = await run(() => window.luxy.deleteVaultHordeKey());
    if (value !== null) setStatus(value);
    setHordeAccount(null);
  }, [run]);

  const readHordeAccount = useCallback(async (): Promise<void> => {
    // pasa por `run` para que un fallo se VEA. Antes se tragaba el error y
    // borraba lo que hubiera en pantalla: pulsar el botón con una clave mala no
    // producía nada, y la única lectura posible era que estaba roto
    const value = await run(() => window.luxy.readVaultHordeAccount());
    setHordeAccount(value);
  }, [run]);

  const loadHordeModels = useCallback(async (): Promise<void> => {
    const result = await window.luxy.listVaultHordeModels();
    setHordeModels(result.ok ? result.value.models : []);
  }, []);

  const saveHordeCharacter = useCallback(
    async (input: {
      characterId: string;
      label: string;
      description: string;
      recipe: HordeRecipe;
    }): Promise<string | null> => {
      setError(null);
      setHint(null);
      const result = await window.luxy.saveVaultHordeCharacter(input);
      if (!result.ok) {
        setError(result.error);
        setHint(result.hint);
        return null;
      }
      setCharacters(result.value.characters);
      return result.value.characterId;
    },
    [],
  );

  const unlock = useCallback(
    async (method: 'password' | 'recovery' | 'device', secret?: string): Promise<boolean> => {
      const value = await run(() =>
        window.luxy.unlockVault(secret === undefined ? { method } : { method, secret }),
      );
      if (value === null) return false;
      setStatus(value);
      void reloadConversations();
      void reloadCharacters();
      return true;
    },
    [run, reloadConversations, reloadCharacters],
  );

  const lock = useCallback(async (): Promise<void> => {
    const value = await run(() => window.luxy.lockVault());
    if (value !== null) setStatus(value);
  }, [run]);

  const changePassword = useCallback(
    async (current: string, next: string): Promise<boolean> => {
      const value = await run(() =>
        window.luxy.changeVaultPassword({ currentPassword: current, newPassword: next }),
      );
      if (value === null) return false;
      setStatus(value);
      setHint('Contraseña cambiada. Tu clave de recuperación sigue siendo válida.');
      return true;
    },
    [run],
  );

  const setDeviceUnlock = useCallback(
    async (enabled: boolean): Promise<boolean> => {
      const value = await run(() => window.luxy.setVaultDeviceUnlock(enabled));
      if (value === null) return false;
      setStatus(value);
      return true;
    },
    [run],
  );

  const setAutoLock = useCallback(
    async (minutes: number): Promise<boolean> => {
      const value = await run(() => window.luxy.setVaultAutoLock(minutes));
      if (value === null) return false;
      setStatus(value);
      return true;
    },
    [run],
  );

  const loadMemory = useCallback(async (): Promise<void> => {
    const result = await window.luxy.listVaultMemory();
    if (!mounted.current) return;
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setMemoryEpisodes(result.value.episodes);
    setMemoryExcluded(result.value.excluded);
  }, []);

  const loadAuxiliary = useCallback(async (): Promise<void> => {
    const result = await window.luxy.getVaultAuxiliary();
    if (mounted.current && result.ok) setAuxiliaryState(result.value);
  }, []);

  const setAuxiliary = useCallback(async (choice: AuxiliaryChoice | null): Promise<void> => {
    const result = await window.luxy.setVaultAuxiliary({ choice });
    if (!mounted.current) return;
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setAuxiliaryState(result.value);
  }, []);

  const syncCatalog = useCallback(
    async (input: {
      provider: string;
      model: string | null;
      /** `null` deja el esfuerzo que traiga el proveedor */
      effort: ReasoningEffort | null;
      projectAlias: string;
      conversationId?: string;
    }): Promise<{ pending: number; cataloged: number; failed: number } | null> => {
      // guarda en la pantalla ademas de la del proceso principal: sin esto se
      // encolan tandas que ya no hacen falta, y el `<details>` puede disparar
      // el `onToggle` mas de una vez
      if (catalogingRef.current) return null;
      catalogingRef.current = true;
      setCatalogingMemory(true);
      try {
        const result = await window.luxy.syncVaultCatalog({ ...input, limit: 3 });
        if (!result.ok) {
          setError(result.error);
          return null;
        }
        if (!mounted.current) return null;
        setLastCatalog({
          cataloged: result.value.cataloged,
          scenes: result.value.scenes,
          pending: result.value.pending,
          failed: result.value.failed,
          uneven: result.value.uneven,
        });
        return {
          pending: result.value.pending,
          cataloged: result.value.cataloged,
          failed: result.value.failed.length,
        };
      } finally {
        catalogingRef.current = false;
        if (mounted.current) setCatalogingMemory(false);
      }
    },
    [],
  );

  const syncRelations = useCallback(
    async (input: {
      projectAlias: string;
      conversationId?: string;
      /** pedida a mano: reintenta lo que se nego o fallo antes */
      force?: boolean;
    }): Promise<{
      pending: number;
      reviewed: number;
      notes: number;
      refused: number;
      failed: number;
    } | null> => {
      if (relationsRef.current) return null;
      relationsRef.current = true;
      setSyncingRelations(true);
      try {
        const result = await window.luxy.syncVaultRelations({
          ...input,
          limit: 3,
          force: input.force ?? false,
        });
        if (!result.ok) {
          setError(result.error);
          return null;
        }
        if (!mounted.current) return null;
        setLastRelationSync(result.value);
        // van tambien las negativas y los fallos: quien decide si dar otra vuelta
        // los necesita, porque una tanda entera negada no avanza ningun cursor y
        // aun asi la siguiente coge otras tres conversaciones
        return {
          pending: result.value.pending,
          reviewed: result.value.reviewed,
          notes: result.value.notes,
          refused: result.value.refused,
          failed: result.value.failed.length,
        };
      } finally {
        relationsRef.current = false;
        if (mounted.current) setSyncingRelations(false);
      }
    },
    [],
  );

  const loadPendingAffairs = useCallback(async (): Promise<void> => {
    const result = await window.luxy.listVaultRelations();
    if (!mounted.current) return;
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setPendingAffairs(result.value.notes);
  }, []);

  const decidePendingAffair = useCallback(
    async (id: string, status: RelationStatus): Promise<void> => {
      setDecidingPendingAffair(true);
      try {
        const result = await window.luxy.updateVaultRelation({ id, status });
        if (!mounted.current) return;
        if (!result.ok) {
          setError(result.error);
          return;
        }
        // el proceso principal devuelve la lista ya rehecha: volver a pedirla
        // abriria una ventana en la que los botones enseñan el estado anterior
        setPendingAffairs(result.value.notes);
      } finally {
        if (mounted.current) setDecidingPendingAffair(false);
      }
    },
    [],
  );

  const syncRecaps = useCallback(
    async (input: {
      projectAlias: string;
      conversationId?: string;
      force?: boolean;
      dryRun?: boolean;
    }): Promise<RecapSweepRound | null> => {
      if (recapsRef.current) return null;
      recapsRef.current = true;
      setSyncingRecaps(true);
      // el vistazo de la prueba caduca EN CUANTO empieza una pasada de verdad:
      // la de verdad coge las mismas conversaciones que la prueba acaba de
      // enseñar, asi que dejarlo en pantalla bajo su «no se ha guardado nada»
      // significa decidir —y aprobar— leyendo un texto que ya no es el que hay
      // en disco
      if (input.dryRun !== true) setRecapPreview(null);
      try {
        const result = await window.luxy.syncVaultRecaps({
          projectAlias: input.projectAlias,
          ...(input.conversationId === undefined
            ? {}
            : { conversationId: input.conversationId }),
          // el mismo numero que `RECAP_DEFAULT_LIMIT` en la pasada: dos y no
          // tres como los pendientes, porque aqui una sola conversacion puede
          // gastar una llamada por cada cuarenta turnos
          limit: 2,
          force: input.force ?? false,
          dryRun: input.dryRun ?? false,
        });
        if (!result.ok) {
          setError(result.error);
          return null;
        }
        if (!mounted.current) return null;
        const { preview, ...counters } = result.value;
        setLastRecapSync(counters);
        // el vistazo solo se pisa cuando se ha pedido uno: una pasada de verdad
        // devuelve la lista vacia, y dejarla entrar borraria lo que Daniel esta
        // leyendo en ese momento
        if (input.dryRun === true) setRecapPreview(preview);
        // van tambien las negativas, las vagas, las ilegibles, los indices y las
        // selladas: quien decide si dar otra vuelta las necesita, porque una
        // tanda entera negada no escribe ninguna ficha y aun asi la siguiente
        // coge OTRAS dos conversaciones
        return {
          pending: counters.pending,
          reviewed: counters.reviewed,
          refused: counters.refused,
          vague: counters.vague,
          invalid: counters.invalid,
          failed: counters.failed.length,
          deduced: counters.deduced,
          superseded: counters.superseded,
        };
      } finally {
        recapsRef.current = false;
        if (mounted.current) setSyncingRecaps(false);
      }
    },
    [],
  );

  const loadRecaps = useCallback(async (): Promise<void> => {
    const result = await window.luxy.listVaultRecaps();
    if (!mounted.current) return;
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setRecaps(result.value.rows);
    setRecapCoverage(result.value.coverage);
  }, []);

  const decideRecap = useCallback(async (args: RecapDecision): Promise<void> => {
    setDecidingRecap(true);
    try {
      const result = await window.luxy.updateVaultRecap(args);
      if (!mounted.current) return;
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // el proceso principal devuelve la lista y la cobertura ya rehechas:
      // volver a pedirlas abriria una ventana en la que los botones enseñan el
      // estado anterior
      setRecaps(result.value.rows);
      setRecapCoverage(result.value.coverage);
    } finally {
      if (mounted.current) setDecidingRecap(false);
    }
  }, []);

  const readMemoryTurns = useCallback(
    async (input: {
      conversationId: string;
      from: number;
      to: number;
    }): Promise<{ role: 'user' | 'assistant'; text: string }[]> => {
      const result = await window.luxy.readVaultMemory(input);
      if (!result.ok) {
        setError(result.error);
        return [];
      }
      return result.value.turns;
    },
    [],
  );

  const readMemoryEpisode = useCallback(
    async (episode: MemoryEpisode): Promise<{ role: 'user' | 'assistant'; text: string }[]> =>
      readMemoryTurns({
        conversationId: episode.conversationId,
        from: episode.from,
        to: episode.to,
      }),
    [readMemoryTurns],
  );

  const excludeFromMemory = useCallback(
    async (conversationId: string, excluded: boolean): Promise<void> => {
      const result = await window.luxy.excludeFromVaultMemory({ conversationId, excluded });
      if (!mounted.current) return;
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMemoryEpisodes(result.value.episodes);
      setMemoryExcluded(result.value.excluded);
    },
    [],
  );

  const checkCompatibility = useCallback(
    async (input: {
      projectAlias: string;
      /** el esfuerzo va dentro del candidato: es parte de lo que se compara */
      targets: { provider: string; model: string | null; effort: ReasoningEffort | null }[];
      repetitions: number;
    }): Promise<void> => {
      if (openConversationId === null) {
        setError('abre una conversacion: es la que se usa como sonda');
        return;
      }
      setCheckingCompatibility(true);
      // la tanda anterior se va ANTES de empezar: quince turnos seguidos tardan
      // minutos, y dejar el texto viejo debajo de un boton que pone «Probando…»
      // se lee como si ya hubieran contestado. Y si esta falla, el error no
      // queda al lado de unas respuestas que no son suyas
      setCompatibility(null);
      setError(null);
      try {
        const result = await window.luxy.checkVaultCompatibility({
          conversationId: openConversationId,
          ...input,
        });
        if (!result.ok) {
          setError(result.error);
          setHint(result.hint);
          return;
        }
        // sellada con la conversacion que sirvio de sonda: es lo que la ata al
        // personaje y a la memoria con los que se genero
        setCompatibility({ conversationId: openConversationId, results: result.value.results });
      } finally {
        if (mounted.current) setCheckingCompatibility(false);
      }
    },
    [openConversationId],
  );

  const setComposer = useCallback((patch: Partial<VaultComposer>): void => {
    setComposerState((previous) => ({ ...previous, ...patch }));
  }, []);

  const openConversation = useCallback(
    async (conversationId: string | null): Promise<void> => {
      setOpenConversationId(conversationId);
      // los borradores pertenecen a la conversacion en la que se escribieron.
      // El proyecto es preferencia y se conserva; el proveedor lo trae la propia
      // conversacion unas lineas mas abajo, porque pertenece a ella
      setComposerState((previous) => ({ ...previous, ...EMPTY_DRAFT }));
      if (conversationId === null) {
        setTurns([]);
        // una conversación nueva empieza sin instrucciones: arrastrar las de la
        // anterior las aplicaría sin que nadie las haya escrito aquí
        setInstructions(null);
        setCharacterId(null);
        setCharacterDescription(null);
        setLastImage(null);
        setLastMemoryStatus(null);
        return;
      }
      const result = await window.luxy.readVaultConversation(conversationId);
      if (mounted.current && result.ok) {
        setTurns(result.value.turns);
        setInstructions(result.value.instructions);
        setCharacterId(result.value.characterId);
        setCharacterDescription(result.value.characterDescription);
        // el proveedor pertenece a la conversacion, no a la ventana: viene
        // sellado con su ultimo turno y por eso sobrevive a reiniciar Studio.
        // Sin turnos todavia se conserva el que estuviera elegido
        if (result.value.provider !== null) {
          setComposerState((previous) => ({ ...previous, provider: result.value.provider }));
        }
        // el modelo tambien pertenece a la conversacion. `null` no se propaga:
        // una conversacion vieja sin modelo no debe borrar el que este elegido
        if (result.value.model !== null) {
          setComposerState((previous) => ({ ...previous, model: result.value.model }));
        }
      }
      // el resultado de una imagen y el estado de la memoria pertenecen al turno
      // que los produjo, no a la conversacion: al cambiar de hilo dejan de tener
      // sentido
      setLastImage(null);
      setLastMemoryStatus(null);
      const mediaResult = await window.luxy.listVaultMedia(conversationId);
      if (mounted.current && mediaResult.ok) setMedia(mediaResult.value.media);
    },
    [],
  );

  const reloadMedia = useCallback(async (): Promise<void> => {
    if (openConversationId === null) return;
    const result = await window.luxy.listVaultMedia(openConversationId);
    if (mounted.current && result.ok) setMedia(result.value.media);
  }, [openConversationId]);

  const setMediaCaption = useCallback(
    async (mediaId: string, caption: string): Promise<boolean> => {
      if (openConversationId === null) return false;
      setError(null);
      const result = await window.luxy.setVaultMediaCaption({
        conversationId: openConversationId,
        mediaId,
        caption,
      });
      if (!result.ok) {
        setError(result.error);
        setHint(result.hint);
        return false;
      }
      setMedia(result.value.media);
      return true;
    },
    [openConversationId],
  );

  const describeMedia = useCallback(
    async (input: {
      mediaId: string;
      provider: string;
      model: string | null;
      /** `null` deja el esfuerzo que traiga el proveedor */
      effort: ReasoningEffort | null;
      projectAlias: string;
    }): Promise<{ caption: string | null; failure: string | null; reasoning: string | null }> => {
      if (openConversationId === null) return { caption: null, failure: null, reasoning: null };
      setDescribingMedia(true);
      setError(null);
      setHint(null);
      try {
        const result = await window.luxy.describeVaultMedia({
          conversationId: openConversationId,
          ...input,
        });
        if (!result.ok) {
          setError(result.error);
          setHint(result.hint);
          return { caption: null, failure: null, reasoning: null };
        }
        // el pie de foto ya está guardado en el main: se recarga para verlo
        if (result.value.caption !== null) await reloadMedia();
        return result.value;
      } finally {
        if (mounted.current) setDescribingMedia(false);
      }
    },
    [openConversationId, reloadMedia],
  );

  /**
   * reescribe un pie de foto en buen español. Ni lee ni escribe la bóveda.
   *
   * No necesita `mediaId` ni conversación abierta a propósito: entra texto y
   * sale texto, así que vale igual sobre lo que se está escribiendo sin
   * guardar, y la decisión de quedárselo sigue siendo del usuario.
   */
  const rewriteCaption = useCallback(
    async (input: {
      caption: string;
      provider: string;
      model: string | null;
      /** `null` deja el esfuerzo que traiga el proveedor */
      effort: ReasoningEffort | null;
      projectAlias: string;
    }): Promise<{ caption: string | null; failure: string | null; reasoning: string | null }> => {
      setRewritingCaption(true);
      setError(null);
      setHint(null);
      try {
        const result = await window.luxy.rewriteVaultMediaCaption(input);
        if (!result.ok) {
          setError(result.error);
          setHint(result.hint);
          return { caption: null, failure: null, reasoning: null };
        }
        return result.value;
      } finally {
        if (mounted.current) setRewritingCaption(false);
      }
    },
    [],
  );

  const diagnoseMemory = useCallback(async (): Promise<MemoryDiagnosticsView | null> => {
    setDiagnosingMemory(true);
    setError(null);
    setHint(null);
    try {
      const result = await window.luxy.diagnoseVaultMemory();
      if (!result.ok) {
        setError(result.error);
        setHint(result.hint);
        return null;
      }
      if (mounted.current) setLastDiagnostics(result.value);
      return result.value;
    } finally {
      if (mounted.current) setDiagnosingMemory(false);
    }
  }, []);

  /**
   * prueba de visión: una imagen del disco y a ver qué dice el modelo.
   *
   * No escribe nada y **no necesita conversación abierta**, que es justo el
   * punto: sirve para saber si un modelo sabe mirar antes de gastar una llamada
   * sobre contenido de la bóveda, y sin dejar una conversación de prueba dentro.
   */
  const probeVision = useCallback(
    async (input: {
      provider: string;
      model: string | null;
      /** `null` deja el esfuerzo que traiga el proveedor */
      effort: ReasoningEffort | null;
      projectAlias: string;
    }): Promise<VisionProbe | null> => {
      setProbingVision(true);
      setError(null);
      setHint(null);
      try {
        const result = await window.luxy.probeVision(input);
        if (!result.ok) {
          setError(result.error);
          setHint(result.hint);
          return null;
        }
        // cerrar el diálogo sin elegir no es un resultado: deja lo anterior
        if (result.value.cancelled) return null;
        // se apila delante y se recortan las viejas: comparar tres o cuatro
        // es el caso real, y guardarlas todas llena la pantalla de imágenes
        // descifradas sin que nadie las mire
        if (mounted.current) {
          setProbes((previas) =>
            [{ ...result.value, id: crypto.randomUUID() }, ...previas].slice(0, MAX_PROBES),
          );
        }
        return result.value;
      } finally {
        if (mounted.current) setProbingVision(false);
      }
    },
    [],
  );

  const clearProbes = useCallback((): void => {
    setProbes([]);
  }, []);

  const dismissProbe = useCallback((id: string): void => {
    setProbes((previas) => previas.filter((probe) => probe.id !== id));
  }, []);

  const attachMedia = useCallback(async (caption: string): Promise<void> => {
    if (openConversationId === null) {
      setError('abre o empieza una conversacion antes de adjuntar');
      return;
    }
    setAttaching(true);
    setError(null);
    try {
      const result = await window.luxy.attachVaultMedia(openConversationId, caption);
      if (!result.ok) {
        setError(result.error);
        setHint(result.hint);
        return;
      }
      await reloadMedia();
    } finally {
      if (mounted.current) setAttaching(false);
    }
  }, [openConversationId, reloadMedia]);

  /**
   * devuelve una data URL con los bytes descifrados, o null si el archivo es
   * demasiado grande para previsualizarlo todavia.
   *
   * No se cachea a proposito: mantener imagenes descifradas en el estado del
   * renderer las dejaria vivas despues de cerrar la boveda.
   */
  const openMedia = useCallback(
    async (mediaId: string): Promise<string | null> => {
      if (openConversationId === null) return null;
      const result = await window.luxy.readVaultMedia({
        conversationId: openConversationId,
        mediaId,
      });
      if (!result.ok) {
        setError(result.error);
        return null;
      }
      return result.value.dataUrl;
    },
    [openConversationId],
  );

  const send = useCallback(
    async (input: {
      message: string;
      provider: string;
      model: string | null;
      effort: ReasoningEffort | null;
      projectAlias: string;
      instructions: string | null;
      characterId: string | null;
      characterDescription: string | null;
    }): Promise<boolean> => {
      setSending(true);
      setError(null);
      try {
        const result = await window.luxy.sendVaultMessage({
          conversationId: openConversationId,
          ...input,
        });
        if (!result.ok) {
          setError(result.error);
          setHint(result.hint);
          return false;
        }
        setOpenConversationId(result.value.conversationId);
        setTurns(result.value.turns);
        setInstructions(result.value.instructions);
        setCharacterId(result.value.characterId);
        setCharacterDescription(result.value.characterDescription);
        if (result.value.provider !== null) {
          setComposerState((previous) => ({ ...previous, provider: result.value.provider }));
        }
        if (result.value.model !== null) {
          setComposerState((previous) => ({ ...previous, model: result.value.model }));
        }
        setLastMemoryStatus(result.value.memoryStatus);
        // el mensaje se retiro porque no hubo respuesta: se devuelve al
        // compositor en vez de obligar a reescribirlo, que es lo que acababa
        // duplicandolo en el historial
        if (!result.value.userTurnKept) {
          setComposerState((previous) => ({ ...previous, message: input.message }));
        }
        setLastImage(result.value.image);
        // lo generado en este turno se guarda contra la conversacion: recargar
        // los medios es lo que hace que la imagen aparezca sin recargar nada
        if (result.value.image?.mediaId != null) await reloadMedia();
        if (result.value.error !== null) setError(result.value.error);
        await reloadConversations();
        return result.value.userTurnKept;
      } finally {
        if (mounted.current) setSending(false);
      }
    },
    [openConversationId, reloadConversations, reloadMedia],
  );

  const removeConversation = useCallback(
    async (conversationId: string): Promise<void> => {
      const result = await window.luxy.deleteVaultConversation(conversationId);
      // un borrado que falla a medias deja en disco algo que Daniel mando
      // borrar —el resumen de lo que se dijo, lo apuntado, las escenas—, y
      // callarlo era lo peor de los dos: la conversacion desaparecia de la
      // lista y nadie decia que algo habia sobrevivido
      if (!result.ok) setError(result.error);
      if (openConversationId === conversationId) {
        setOpenConversationId(null);
        setTurns([]);
      }
      await reloadConversations();
    },
    [openConversationId, reloadConversations],
  );

  /**
   * genera un medio y lo guarda cifrado.
   *
   * Tarda: la generación no es inmediata y el proceso principal sondea al
   * proveedor hasta que termina. `generating` existe para que la interfaz lo
   * diga en vez de parecer colgada.
   */
  const generateMedia = useCallback(
    async (input: {
      characterId: string;
      prompt: string;
      kind: 'image' | 'video';
      fromMediaId?: string;
    }): Promise<boolean> => {
      if (openConversationId === null) {
        setError('abre o empieza una conversacion antes de generar');
        return false;
      }
      setGenerating(true);
      setError(null);
      // la cola de la generacion anterior no dice nada de esta
      setHordeProgress(null);
      try {
        const result = await window.luxy.generateVaultMedia({
          conversationId: openConversationId,
          ...input,
        });
        if (!result.ok) {
          setError(result.error);
          setHint(result.hint);
          return false;
        }
        setLastCost(
          result.value.costCredits === null
            ? null
            : { amount: result.value.costCredits, unit: result.value.costUnit ?? 'creditos' },
        );
        await reloadMedia();
        return true;
      } finally {
        if (mounted.current) {
          setGenerating(false);
          // terminada o fallida, la cola ya no existe: dejarla en pantalla
          // haria creer que sigue esperando
          setHordeProgress(null);
        }
      }
    },
    [openConversationId, reloadMedia],
  );

  const createCharacter = useCallback(
    async (input: {
      modelId: 'realistic-sharp-v1' | 'anime-pure-v1';
      traits: Record<string, string>;
      scene: string;
      sfw: boolean;
      label: string;
      description: string;
    }): Promise<string | null> => {
      setError(null);
      setHint(null);
      const result = await window.luxy.createVaultCharacter(input);
      if (!result.ok) {
        setError(result.error);
        setHint(result.hint);
        return null;
      }
      // llega ya guardado: crearlo cuesta créditos y el identificador sólo se
      // devuelve una vez
      setCharacters(result.value.characters);
      return result.value.characterId;
    },
    [],
  );

  const importCharacter = useCallback(
    async (input: {
      characterId: string;
      modelId: 'realistic-sharp-v1' | 'anime-pure-v1';
      label: string;
      description: string;
      avatarUrl: string;
    }): Promise<boolean> => {
      setError(null);
      setHint(null);
      const result = await window.luxy.importVaultCharacter(input);
      if (!result.ok) {
        setError(result.error);
        setHint(result.hint);
        return false;
      }
      setCharacters(result.value.characters);
      return true;
    },
    [],
  );

  const setCharacterImageProvider = useCallback(
    async (characterId: string, provider: 'xavira' | 'horde'): Promise<boolean> => {
      setError(null);
      setHint(null);
      const result = await window.luxy.setVaultCharacterImageProvider({ characterId, provider });
      if (!result.ok) {
        setError(result.error);
        setHint(result.hint);
        return false;
      }
      setCharacters(result.value.characters);
      return true;
    },
    [],
  );

  const readCharacterInstructions = useCallback(
    async (characterId: string): Promise<string | null> => {
      const result = await window.luxy.readVaultCharacterInstructions({ characterId });
      return result.ok ? result.value.instructions : null;
    },
    [],
  );

  const readCharacterAvatar = useCallback(async (characterId: string): Promise<string | null> => {
    const result = await window.luxy.readVaultCharacterAvatar({ characterId });
    return result.ok ? result.value.dataUrl : null;
  }, []);

  const forgetCharacter = useCallback(async (characterId: string): Promise<void> => {
    const result = await window.luxy.forgetVaultCharacter({ characterId });
    if (result.ok) setCharacters(result.value.characters);
  }, []);

  const sync = useCallback(async (): Promise<void> => {
    setSyncing(true);
    setError(null);
    setHint(null);
    try {
      const result = await window.luxy.syncVault();
      if (!result.ok) {
        setError(result.error);
        setHint(result.hint);
        return;
      }
      setLastSync({
        uploaded: result.value.uploaded,
        downloaded: result.value.downloaded,
        mediaUploaded: result.value.mediaUploaded,
        mediaDownloaded: result.value.mediaDownloaded,
        mediaSkipped: result.value.mediaSkipped,
      });
      // lo descargado puede incluir conversaciones que aqui no existian
      await reloadConversations();
      if (openConversationId !== null) await openConversation(openConversationId);
    } finally {
      if (mounted.current) setSyncing(false);
    }
  }, [reloadConversations, openConversation, openConversationId]);

  return {
    status,
    loading,
    busy,
    error,
    hint,
    recoveryKey,
    registerAccount,
    loginAccount,
    linkAccount,
    logoutAccount,
    setMediaKey,
    deleteMediaKey,
    setHordeKey,
    deleteHordeKey,
    hordeAccount,
    readHordeAccount,
    hordeModels,
    loadHordeModels,
    saveHordeCharacter,
    setCharacterImageProvider,
    setMediaCaption,
    describeMedia,
    describingMedia,
    rewriteCaption,
    rewritingCaption,
    diagnoseMemory,
    diagnosingMemory,
    lastDiagnostics,
    probeVision,
    probingVision,
    probes,
    clearProbes,
    dismissProbe,
    create,
    unlock,
    lock,
    changePassword,
    setDeviceUnlock,
    setAutoLock,
    conversations,
    openConversationId,
    turns,
    instructions,
    characterId,
    characterDescription,
    characters,
    forgetCharacter,
    importCharacter,
    readCharacterInstructions,
    readCharacterAvatar,
    lastImage,
    sending,
    openConversation,
    send,
    removeConversation,
    media,
    attaching,
    composer,
    setComposer,
    lastMemoryStatus,
    memoryEpisodes,
    memoryExcluded,
    auxiliary,
    loadAuxiliary,
    setAuxiliary,
    loadMemory,
    syncCatalog,
    catalogingMemory,
    lastCatalog,
    syncRelations,
    syncingRelations,
    lastRelationSync,
    pendingAffairs,
    loadPendingAffairs,
    decidePendingAffair,
    decidingPendingAffair,
    syncRecaps,
    syncingRecaps,
    lastRecapSync,
    recapPreview,
    clearRecapPreview: () => setRecapPreview(null),
    recaps,
    recapCoverage,
    loadRecaps,
    decideRecap,
    decidingRecap,
    readMemoryEpisode,
    readMemoryTurns,
    excludeFromMemory,
    // solo si es de la conversacion que hay abierta. Con la boveda cerrada ya no
    // hay nada que filtrar, porque el estado se vacio al cerrarla
    compatibility: compatibilityFor(compatibility, openConversationId),
    checkingCompatibility,
    checkCompatibility,
    attachMedia,
    openMedia,
    generating,
    hordeProgress,
    lastCost,
    generateMedia,
    createCharacter,
    syncing,
    lastSync,
    sync,
    acknowledgeRecoveryKey: () => setRecoveryKey(null),
    clearError: () => setError(null),
  };
}

/** etiqueta legible de cada opcion de bloqueo automatico */
export function formatAutoLockOption(minutes: number): string {
  if (minutes === 0) return 'No cerrarla sola';
  if (minutes < 60) return `${minutes} minutos de inactividad`;
  const hours = minutes / 60;
  return hours === 1 ? '1 hora de inactividad' : `${hours} horas de inactividad`;
}

/** texto del tiempo restante antes del bloqueo automatico */
export function formatLockCountdown(lockingInMs: number | null): string | null {
  if (lockingInMs === null) return null;
  const minutes = Math.floor(lockingInMs / 60_000);
  if (minutes >= 1) return `se cerrará sola en ${minutes} min`;
  const seconds = Math.max(0, Math.floor(lockingInMs / 1000));
  return `se cerrará sola en ${seconds} s`;
}
