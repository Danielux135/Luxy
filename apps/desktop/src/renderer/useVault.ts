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
  ImageAttempt,
  MemoryRelinkOutcome,
  ReasoningEffort,
  RelationStatus,
  VaultImagePlanEdit,
  VaultPendingPacing,
  VaultRecentMemories,
  VaultReplyGuidance,
} from '@luxy/shared';
import type { OwnerChangePreview, OwnerView } from './vault-character-link.js';
import type { HordeQueueProgress } from '../shared/horde-progress.js';
import { callBridge } from './bridge-call.js';
import { compatibilityFor, type CompatibilityRun } from './vault-compatibility-reply.js';
import { discardDecrypted } from './vault-lock-reset.js';
import {
  VAULT_LOCK_NOTICE_UNKNOWN,
  lockNoticeFor,
  vaultLockReasonSchema,
} from '../shared/vault-lock.js';
import { recapSignature } from './vault-recap-row.js';
import type { RecapSweepRound } from './vault-sweep.js';
import type {
  vaultCompatibilityResultSchema,
  vaultHordeAccountResultSchema,
  vaultMemoryListResultSchema,
  vaultRecapListResultSchema,
  vaultRecapSyncResultSchema,
  vaultRecapUpdateArgsSchema,
  vaultRelationListResultSchema,
  vaultVisionProbeResultSchema,
  vaultMemoryDiagnosticsResultSchema,
  VaultImageTurnState,
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
 * la cuenta del horde, tal y como llega del proceso principal.
 *
 * Se DERIVA del esquema del IPC en vez de repetirla a mano: con el desglose son
 * nueve campos, y una forma escrita dos veces se separa a la segunda semana.
 * `kudosDetails` es nullable a proposito —el horde puede no mandarlo— y cada
 * casilla suya tambien: ahi `null` es «no lo dijo», nunca «cero».
 */
export type HordeAccountView = z.infer<typeof vaultHordeAccountResultSchema>;

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
  /**
   * si hay que enseñar el texto de la imagen antes de generarla.
   *
   * Con `siempre`, el turno termina dejando la petición esperando una pulsación
   * en vez de gastar una generación a ciegas.
   */
  imageReview: 'siempre' | 'nunca';
  /**
   * qué se dibuja cuando en la escena salen los dos.
   *
   * Con `character-only` —lo de siempre— se pide sólo a él, en plano cercano.
   * Con `both` se ilustra la escena entera, a cambio de que estos modelos
   * encajen dos figuras de forma irregular.
   */
  imageCast: 'character-only' | 'both';
  /**
   * si su prompt lleva las notas de dirección contra la autocopia (`D-102`).
   *
   * Con `none` —el defecto— esta casilla no añade nada al prompt, lo que no
   * quiere decir que el prompt sea el de antes (la ficha editada se sella sola,
   * `D-104`). Con `vary-and-lead` le pide
   * no reutilizar la forma de sus respuestas anteriores y poner su parte.
   */
  replyGuidance: VaultReplyGuidance;
  /**
   * si sus pendientes van en modo esporádico (`D-104`).
   *
   * Con `per-note` —el defecto— esta casilla no añade nada al prompt. Con `sparse` la lista
   * entra en menos mensajes, se le pide sacarlos sólo si la escena los trae y
   * se le avisa, sin decir cuál, cuando ya sacó uno.
   */
  pendingPacing: VaultPendingPacing;
  /**
   * si le llega el resumen de sus dos ultimas conversaciones (`D-105`).
   *
   * Con `off` —el defecto— esta casilla no añade nada al prompt.
   */
  recentMemories: VaultRecentMemories;
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
  /** esa clave es la anónima: funciona, y su documentación dice que comparte */
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
  /**
   * su intento en el registro cifrado, cuando lo generó Luxy.
   *
   * Con él se leen la semilla que usó de verdad y el worker que la dibujó, que
   * no están guardados con el medio. `null` en lo adjuntado a mano y en todo lo
   * sellado antes de que existiera el registro.
   */
  attemptId: string | null;
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

/**
 * de qué sección es un aviso de error.
 *
 * Un nombre por RECUADRO y no uno por botón: lo que hace falta saber es en qué
 * recuadro de la pantalla se tiene que ver el motivo. Lo que no lleva dueño se
 * pinta en el aviso general de la página, que es el único que no puede quedar
 * plegado ni fuera de pantalla.
 *
 * `trabajo-de-fondo` existe porque «Quién hace el trabajo de fondo» vive en «Lo
 * que recuerda» y su fallo se estaba pintando dentro de «Memoria de lo ya
 * hablado», que es OTRA sección del mismo panel y está dos bloques más abajo:
 * exactamente el defecto que estos dueños vinieron a arreglar. El mismo verbo lo
 * llaman dos sitios distintos, así que el dueño lo pone quien llama, no el verbo.
 */
export type VaultErrorArea =
  | 'memoria'
  | 'trabajo-de-fondo'
  | 'personajes'
  | 'disponibilidad'
  /**
   * la confirmacion de enganchar o soltar (`D-103`). Su fallo y su pista se
   * pintan dentro de ella: en el aviso general la pista no salia, y la
   * confirmacion se quedaba en «Comprobando…» sin decir que habia fallado
   */
  | 'enganche';

export interface VaultController {
  status: VaultStatusView;
  loading: boolean;
  busy: boolean;
  error: string | null;
  /**
   * la sección a la que pertenece `error`, o `null` si no es de ninguna.
   *
   * Sin esto un solo fallo pintaba cuatro o cinco recuadros rojos idénticos en
   * la misma vista, y uno de ellos dentro de un panel que no se había tocado.
   */
  errorArea: VaultErrorArea | null;
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
  hordeAccount: HordeAccountView | null;
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
  /**
   * decide si ese personaje enseña el texto de la imagen antes de generarla.
   *
   * No toca nada más suyo, y no depende de qué proveedor le haga las fotos:
   * revisar un texto se puede hacer siempre.
   */
  setCharacterImageReview: (characterId: string, review: 'siempre' | 'nunca') => Promise<boolean>;
  /**
   * decide si una escena donde salen los dos se dibuja entera o sólo con él.
   *
   * No toca nada más suyo y no depende del proveedor: es una decisión sobre qué
   * se pide, no sobre con qué se genera.
   */
  setCharacterImageCast: (
    characterId: string,
    cast: 'character-only' | 'both',
  ) => Promise<boolean>;
  /**
   * enciende o apaga las notas de dirección contra la autocopia.
   *
   * No toca nada más suyo. Apagadas, esta casilla no añade nada al prompt; no
   * es «el prompt de siempre», porque otras casillas y la ficha editada también
   * lo cambian (`D-093`).
   */
  setCharacterReplyGuidance: (
    characterId: string,
    guidance: VaultReplyGuidance,
  ) => Promise<boolean>;
  /**
   * enciende o apaga el modo esporádico de los pendientes.
   *
   * No toca nada más suyo. Apagado, esta casilla no añade nada al prompt; la
   * regla del bloque de pendientes sí cambia con la casilla del resumen
   * (`recentMemories`) encendida, y eso es de la otra casilla (`D-093`).
   */
  setCharacterPendingPacing: (characterId: string, pacing: VaultPendingPacing) => Promise<boolean>;
  /** enciende o apaga el resumen de sus dos ultimas conversaciones */
  setCharacterRecentMemories: (
    characterId: string,
    recent: VaultRecentMemories,
  ) => Promise<boolean>;
  /**
   * de quien es la conversacion abierta, resuelto en main (`D-103`); `null`
   * en una conversacion nueva, que todavia no es de nadie.
   */
  conversationOwner: OwnerView | null;
  /** lo que pasaria al enganchar o soltar, ya pedido; `null` si no hay ninguno */
  ownerPreview: OwnerChangePreview | null;
  /**
   * sube cada vez que se relee la conversacion abierta y con ello se tira su
   * vista previa. La confirmacion depende de el para volver a pedirla: sin esto,
   * reabrir la MISMA conversacion o «Sincronizar» la dejaban para siempre en
   * «Comprobando qué cambiaría…», con Enviar bloqueado (revision del 28/09)
   */
  ownerPreviewEpoch: number;
  /** pide la vista previa; la confirmacion no se enseña hasta tenerla */
  previewConversationOwner: (characterId: string | null) => Promise<OwnerChangePreview | null>;
  clearOwnerPreview: () => void;
  /** engancha (con un personaje) o suelta (con `null`) la conversacion abierta */
  setConversationOwner: (characterId: string | null, projectAlias: string) => Promise<boolean>;
  /**
   * conversaciones en las que se dijo «No, esta no» al aviso por nombre.
   *
   * Solo en memoria: no se guarda en ningun sitio y vuelve a salir al reiniciar
   * Studio. La conversacion nueva, sin id todavia, va con la clave `''`.
   */
  ownerHintDismissed: ReadonlySet<string>;
  dismissOwnerHint: (conversationId: string | null) => void;
  create: (password: string) => Promise<boolean>;
  unlock: (method: 'password' | 'recovery' | 'device', secret?: string) => Promise<boolean>;
  lock: () => Promise<void>;
  /**
   * hay alguien delante (`D-106`). Lo llama `useVaultPresence` con eventos
   * reales de teclado y raton; leer la boveda ya no cuenta como actividad.
   */
  markPresence: () => void;
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
    /**
     * en qué quedó la petición, que no es lo mismo que si hay imagen.
     *
     * `pending` es que el texto está compuesto y esperando a que una persona lo
     * apruebe, y `malformed` que ella SÍ pidió una imagen y el bloque llegó
     * cortado o mal escrito. Sin estos dos nombres, las dos cosas se pintaban
     * igual que un turno en el que no pidió nada.
     */
    state: VaultImageTurnState;
    /** el intento en el registro cifrado, para poder mirarlo después */
    attemptId: string | null;
  } | null;
  /**
   * la imagen que está esperando una decisión en la conversación abierta.
   *
   * Lleva el PLAN entero —el texto exacto que saldría hacia el proveedor—, así
   * que es contenido descifrado de la bóveda y por eso está declarado en
   * `DECRYPTED_RENDERER_STATE`: al cerrarse la bóveda deja de existir aquí.
   *
   * Se lee del registro cifrado y no del resultado del turno: cerrar Studio con
   * una imagen sin decidir no es decir que no, y al volver a abrir la
   * conversación la tarjeta tiene que seguir ahí.
   */
  pendingImagePlan: ImageAttempt | null;
  /**
   * manda el plan pendiente, con la corrección escrita a mano si la hay.
   *
   * `edit: null` significa «tal y como lo compusiste». No se manda el plan
   * entero: sólo el texto. El plan base lo lee el proceso principal del registro
   * cifrado y la huella la recalcula él, así que un `planId` de esta ventana no
   * se lo cree nadie.
   */
  commitImagePlan: (input: {
    attemptId: string;
    edit: VaultImagePlanEdit | null;
  }) => Promise<boolean>;
  /** dice que no: no se genera y no se cobra */
  discardImagePlan: (attemptId: string) => Promise<boolean>;
  /**
   * pregunta lo que costaría sin encolar nada.
   *
   * Sólo AI Horde, y sólo con un botón: el endpoint tiene límites por IP y
   * preguntar el precio en cada tecla es un uso abusivo. `null` es que la
   * pregunta falló; el error ya está puesto.
   */
  estimateImagePlan: (input: {
    attemptId: string;
    edit: VaultImagePlanEdit | null;
  }) => Promise<{ kudos: number | null; warnings: { code: string; message: string }[] } | null>;
  /** se está preguntando el precio; no es lo mismo que estar generando */
  estimatingImage: boolean;
  /**
   * el intento que se está mirando ahora mismo, leído del registro cifrado.
   *
   * Es historia: lo que se mandó de verdad, con su semilla, su worker y su
   * motivo de fallo. Lleva el plan entero, así que es contenido descifrado y por
   * eso entra en la purga del candado igual que `pendingImagePlan`.
   *
   * Hay UNO solo a propósito: se mira de uno en uno —un aviso de fallo, o la
   * imagen abierta en el visor—, y guardarlos todos sería tener colgado de la
   * ventana el texto de cada foto de la conversación sin que nadie lo esté
   * leyendo.
   */
  openImageAttempt: ImageAttempt | null;
  /**
   * lee un intento del registro y lo deja en `openImageAttempt`.
   *
   * Se pide a mano, cada vez que se abre lo que lo enseña: leer el archivo
   * cuesta un descifrado y no hay ninguno que valga para dos intentos. Devuelve
   * `false` cuando ese intento ya no está —el registro es un anillo— para que
   * quien lo pidió pueda decirlo en vez de quedarse en blanco.
   */
  readImageAttempt: (attemptId: string) => Promise<boolean>;
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
  /**
   * `area` la pone quien llama: hay dos botones en dos secciones distintas.
   *
   * El desplegable de arriba pertenece a «Lo que recuerda»; «Rehacer con Claude»,
   * a «Memoria de lo ya hablado». Fijar el dueño dentro del verbo mandaba el
   * motivo de uno a la sección del otro.
   */
  setAuxiliary: (choice: AuxiliaryChoice | null, area: VaultErrorArea) => Promise<void>;
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
  /**
   * vuelve a leer la lista, sin llamar a ningún CLI. Devuelve qué salió.
   *
   * Devuelve algo y no `void` porque el botón que la dispara no tenía NADA que
   * decir: si lo releído coincide con lo que ya estaba en pantalla, React pinta
   * lo mismo y una acción que tarda segundos parecía no haberse ejecutado. Con
   * esto el panel puede escribir «releídas 18, sigue igual», que es información.
   *
   * `null` cuando falló: el error ya está puesto, pero quien llama necesita
   * saber que no hay nada que anunciar.
   */
  loadRecaps: () => Promise<{ rows: number; changed: boolean } | null>;
  /**
   * aprobar una, aprobarlas todas, u olvidar una; devuelve la lista ya rehecha.
   *
   * El booleano dice si la decisión llegó a escribirse: hace falta para
   * encadenar «borra la ficha y después su memoria» sin dejar la ficha viva
   * junto a una memoria ya borrada.
   */
  decideRecap: (args: RecapDecision) => Promise<boolean>;
  /**
   * borra lo que ella recuerda de una conversación, dejando la conversación.
   *
   * Devuelve cuántos turnos llevaban memoria, o `null` si falló. Devuelve la
   * cifra y no `void` porque un borrado que no encuentra nada y otro que borra
   * nueve copias se ven exactamente igual en pantalla —la fila se queda sin su
   * botón— y quien pulsa tiene derecho a saber qué se llevó por delante.
   */
  forgetSealedMemory: (conversationId: string) => Promise<number | null>;
  /**
   * la memoria reescrita con su ficha (`D-108`): volver a la de antes, o
   * pedirla otra vez. Devuelve `null` si falló y, si no, en qué acabó la
   * pasada —`null` al volver a la de antes—: sin eso, un CLI que no arranca
   * dejaba la fila igual y el botón parecía no hacer nada (séptima ronda).
   */
  decideMemoryRelink: (args: {
    conversationId: string;
    choice: 'keep-old' | 'retry';
    projectAlias: string;
  }) => Promise<{ outcome: MemoryRelinkOutcome | null } | null>;
  /** hay una decisión escribiéndose: los botones se apagan mientras tanto */
  decidingRecap: boolean;
  readMemoryEpisode: (
    episode: MemoryEpisode,
  ) => Promise<{ role: 'user' | 'assistant'; text: string }[] | null>;
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
  }) => Promise<{ role: 'user' | 'assistant'; text: string }[] | null>;
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
    /** con un envio en curso: se deja para la siguiente (revision del 28/09) */
    conversationsDeferred: number;
  } | null;
  sync: () => Promise<void>;
  acknowledgeRecoveryKey: () => void;
  clearError: () => void;
}

export function useVault(): VaultController {
  const [status, setStatus] = useState<VaultStatusView>(CLOSED);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setErrorText] = useState<string | null>(null);
  const [errorArea, setErrorArea] = useState<VaultErrorArea | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  /**
   * el aviso, y de quién es.
   *
   * `error` es uno solo para todo el controlador, y eso estaba bien mientras se
   * pintara en un solo sitio. Al acercar el motivo a los botones que lo
   * provocan, el mismo texto acabó saliendo hasta cinco veces en la misma
   * pantalla —y un fallo de listar modelos de AI Horde aparecía dentro de
   * «Memoria de lo ya hablado», diciendo que falló algo que nadie había
   * tocado—. Con dueño, cada sección pinta lo suyo y el aviso general de la
   * página se queda con lo que no es de nadie, que es lo que hacía antes.
   *
   * Por defecto NO hay dueño: `setError` lo borra en cada llamada, así que un
   * fallo nuevo sin marcar no puede heredar la sección de uno viejo y quedarse
   * escondido en un panel plegado.
   */
  const setError = useCallback(
    (message: string | null, area: VaultErrorArea | null = null): void => {
      setErrorText(message);
      setErrorArea(message === null ? null : area);
    },
    [],
  );
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [conversations, setConversations] = useState<PrivateConversation[]>([]);
  const [openConversationId, setOpenConversationId] = useState<string | null>(null);
  const [turns, setTurns] = useState<PrivateTurn[]>([]);
  const [instructions, setInstructions] = useState<string | null>(null);
  const [characterId, setCharacterId] = useState<string | null>(null);
  const [characterDescription, setCharacterDescription] = useState<string | null>(null);
  const [conversationOwner, setConversationOwnerView] = useState<OwnerView | null>(null);
  const [ownerPreview, setOwnerPreview] = useState<OwnerChangePreview | null>(null);
  const [ownerPreviewEpoch, setOwnerPreviewEpoch] = useState(0);
  /** el numero de la ultima vista previa pedida: ver `previewConversationOwner` */
  const previewTicket = useRef(0);
  const [ownerHintDismissed, setOwnerHintDismissed] = useState<ReadonlySet<string>>(new Set());
  const [characters, setCharacters] = useState<VaultCharacterView[]>([]);
  const [describingMedia, setDescribingMedia] = useState(false);
  const [rewritingCaption, setRewritingCaption] = useState(false);
  const [diagnosingMemory, setDiagnosingMemory] = useState(false);
  const [lastDiagnostics, setLastDiagnostics] = useState<MemoryDiagnosticsView | null>(null);
  const [probingVision, setProbingVision] = useState(false);
  // lo ultimo que devolvio el banco de pruebas; no se guarda en ningun sitio
  const [probes, setProbes] = useState<StoredProbe[]>([]);
  const [hordeAccount, setHordeAccount] = useState<HordeAccountView | null>(null);
  // null significa «todavía no se ha preguntado»; [] significa «no hay ninguno»
  const [hordeModels, setHordeModels] = useState<
    { name: string; count: number; eta: number; jobs: number }[] | null
  >(null);
  const [lastImage, setLastImage] = useState<VaultController['lastImage']>(null);
  // el plan lleva el texto exacto que saldria hacia el proveedor: es contenido
  // descifrado, y por eso entra en la purga del cierre igual que los turnos
  const [pendingImagePlan, setPendingImagePlan] = useState<ImageAttempt | null>(null);
  // el que se esta mirando, que tambien lleva el plan entero: mismo material y
  // por tanto misma purga. Uno solo: se mira de uno en uno
  const [openImageAttempt, setOpenImageAttempt] = useState<ImageAttempt | null>(null);
  // preguntar el precio no es generar: tiene su propio indicador para que el
  // boton pueda decir «Comprobando…» sin apagar el de Generar
  const [estimatingImage, setEstimatingImage] = useState(false);
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
  /**
   * la firma de lo último que se leyó, para poder decir si ha cambiado.
   *
   * Es un `ref` y no un estado porque nadie la pinta: sólo la compara el
   * `loadRecaps` siguiente, y dentro del callback un `useState` llegaría con el
   * valor de la renderización anterior. Y son METADATOS —identificador, fecha,
   * tamaños, banderas—, nunca el texto: comparar bloques obligaría a guardar una
   * segunda copia de contenido descifrado sin necesidad.
   */
  const recapSignatureRef = useRef<string | null>(null);
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
      pendingImagePlan: () => setPendingImagePlan(null),
      openImageAttempt: () => setOpenImageAttempt(null),
      characterDescription: () => {
        setCharacterDescription(null);
        setCharacterId(null);
      },
      conversationOwner: () => setConversationOwnerView(null),
      ownerPreview: () => {
        // y la que este en vuelo, fuera: su respuesta llegaria DESPUES de la
        // purga, pasaria la comprobacion del numero y volveria a escribir el
        // nombre y las cifras con la boveda cerrada (revision del 28/09)
        previewTicket.current += 1;
        setOwnerPreview(null);
      },
      characters: () => setCharacters([]),
      ownerHintDismissed: () => setOwnerHintDismissed(new Set()),
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
    const unsubscribe = window.luxy.onVaultLocked((payload) => {
      void refresh();
      // el aviso dice POR QUE, y solo lo que ha pasado de verdad (`D-093`):
      // «por inactividad» despues de un Win+L seria falso. El motivo llega de
      // fuera del renderer y se valida antes de fiarse de el
      const motivo = vaultLockReasonSchema.safeParse(payload);
      if (!motivo.success) {
        setHint(VAULT_LOCK_NOTICE_UNKNOWN);
        return;
      }
      // el boton, salir y cerrar la sesion los ha pedido el: sin aviso
      const aviso = lockNoticeFor(motivo.data);
      if (aviso !== null) setHint(aviso);
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

  /**
   * envuelve una operacion: un solo sitio decide como se ven los errores.
   *
   * `area` dice en qué recuadro de la pantalla tiene que verse el motivo si
   * falla. Sin ella el aviso va al general de la página, que es el
   * comportamiento de siempre y el que no puede esconderse.
   */
  const run = useCallback(
    async <T>(operation: () => Promise<{ ok: true; value: T } | { ok: false; error: string; hint: string | null }>, area: VaultErrorArea | null = null): Promise<T | null> => {
      setBusy(true);
      setError(null);
      setHint(null);
      try {
        // por `callBridge` y no a pelo: si el puente se rompe, el rechazo sale
        // de aquí sin que nadie lo recoja —los manejadores son `void f()`— y la
        // pantalla queda igual que si la operación hubiera ido bien
        const result = await callBridge(operation);
        if (!result.ok) {
          setError(result.error, area);
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
          ? 'Clave anónima guardada. Funciona, pero la red te atiende la última. Sobre compartir, la documentación del horde dice que con ella se dona lo que generes y el código desplegado descarta esa petición: una clave propia de aihorde.net es gratis y no tiene esa duda.'
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
    // por `run`, y por lo mismo que `readHordeAccount`: antes se tragaba el
    // error y ADEMAS borraba la lista que hubiera en pantalla, de modo que con
    // la red caída el panel decía «la consulta no ha devuelto ningún modelo» —o
    // sea, confundía «no hay» con «no se pudo preguntar»— y el motivo real no
    // aparecía en ninguna parte
    // el motivo se queda en el formulario, que es donde está «Ver
    // disponibilidad»: pintarlo además en los otros tres avisos de esta misma
    // vista repetía el mismo texto cuatro veces
    const value = await run(() => window.luxy.listVaultHordeModels(), 'disponibilidad');
    if (value === null) return;
    setHordeModels(value.models);
  }, [run]);

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

  // sin `run`: no toca `busy` ni borra el error de la pantalla, y un fallo aqui
  // no es nada que Daniel tenga que ver. Si no llega, la boveda se cierra antes,
  // que es el lado seguro
  const markPresence = useCallback((): void => {
    void callBridge(() => window.luxy.markVaultPresence());
  }, []);

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

  const setAuxiliary = useCallback(
    async (choice: AuxiliaryChoice | null, area: VaultErrorArea): Promise<void> => {
      const result = await callBridge(() => window.luxy.setVaultAuxiliary({ choice }));
      if (!mounted.current) return;
      if (!result.ok) {
        // el dueño lo pone quien pulsa: este verbo tiene dos botones y están en
        // dos secciones distintas del mismo panel
        setError(result.error, area);
        setHint(result.hint);
        return;
      }
      setAuxiliaryState(result.value);
    },
    [],
  );

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
        const result = await callBridge(() =>
          window.luxy.syncVaultRecaps({
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
          }),
        );
        if (!result.ok) {
          setError(result.error, 'memoria');
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

  const loadRecaps = useCallback(async (): Promise<{
    rows: number;
    changed: boolean;
  } | null> => {
    const result = await callBridge(() => window.luxy.listVaultRecaps());
    if (!mounted.current) return null;
    if (!result.ok) {
      setError(result.error, 'memoria');
      setHint(result.hint);
      return null;
    }
    setRecaps(result.value.rows);
    setRecapCoverage(result.value.coverage);
    const signature = recapSignature(result.value.rows);
    const previous = recapSignatureRef.current;
    recapSignatureRef.current = signature;
    // la primera lectura no ha «cambiado» nada: antes no había nada con lo que
    // comparar, y decir que sí sería inventarse una diferencia
    return { rows: result.value.rows.length, changed: previous !== null && previous !== signature };
  }, []);

  /**
   * decide sobre una ficha retroactiva. Devuelve si la decisión se escribió.
   *
   * El booleano existe para poder encadenar: «borra las dos» quita primero la
   * ficha y sólo entonces la memoria propia, y si el primer paso falla el
   * segundo NO puede correr —quedaría la ficha viva y la memoria borrada, que
   * es exactamente el estado que ese botón promete evitar—.
   */
  const decideRecap = useCallback(async (args: RecapDecision): Promise<boolean> => {
    setDecidingRecap(true);
    try {
      const result = await callBridge(() => window.luxy.updateVaultRecap(args));
      if (!mounted.current) return false;
      if (!result.ok) {
        setError(result.error, 'memoria');
        setHint(result.hint);
        return false;
      }
      // el proceso principal devuelve la lista y la cobertura ya rehechas:
      // volver a pedirlas abriria una ventana en la que los botones enseñan el
      // estado anterior
      setRecaps(result.value.rows);
      setRecapCoverage(result.value.coverage);
      // la firma sigue a lo que se ENSEÑA, no a la última lectura: si no, el
      // repaso siguiente diría «ha cambiado» de un cambio que Daniel acaba de
      // hacer y ya está viendo
      recapSignatureRef.current = recapSignature(result.value.rows);
      return true;
    } finally {
      if (mounted.current) setDecidingRecap(false);
    }
  }, []);

  /**
   * borra la memoria propia de una conversación, sin tocar sus mensajes.
   *
   * Comparte `decidingRecap` con `decideRecap` a propósito: las dos escriben
   * sobre la misma fila y los botones de esa sección ya se apagan con esa
   * bandera. Una bandera nueva sólo conseguiría que se pudiera pulsar «Aprobar»
   * mientras se está borrando.
   *
   * Lo que NO puede salir de esta bandera es la ETIQUETA del botón rojo: es
   * compartida, así que una decisión sobre la ficha de otra fila ponía
   * «Borrando…» en una confirmación abierta donde no se estaba borrando nada.
   * Quién está borrando qué lo lleva el panel, que es el único que lo sabe.
   */
  const forgetSealedMemory = useCallback(async (conversationId: string): Promise<number | null> => {
    setDecidingRecap(true);
    try {
      const result = await callBridge(() =>
        window.luxy.forgetVaultSealedMemory({ conversationId }),
      );
      if (!mounted.current) return null;
      // un borrado que falla en silencio es lo peor de los dos: la fila se queda
      // igual y no hay forma de saber si es que no prendió o que no había nada
      if (!result.ok) {
        setError(result.error, 'memoria');
        setHint(result.hint);
        return null;
      }
      setRecaps(result.value.rows);
      setRecapCoverage(result.value.coverage);
      recapSignatureRef.current = recapSignature(result.value.rows);
      return result.value.cleared;
    } finally {
      if (mounted.current) setDecidingRecap(false);
    }
  }, []);

  /**
   * vuelve a la memoria de antes o pide otra vez la reescrita con su ficha.
   *
   * Comparte `decidingRecap` con las otras dos por lo mismo: escriben sobre la
   * misma fila, y una bandera nueva dejaría pulsar «Borrar su memoria» mientras
   * se reescribe.
   */
  const decideMemoryRelink = useCallback(
    async (args: {
      conversationId: string;
      choice: 'keep-old' | 'retry';
      projectAlias: string;
    }): Promise<{ outcome: MemoryRelinkOutcome | null } | null> => {
      setDecidingRecap(true);
      try {
        const result = await callBridge(() => window.luxy.decideVaultMemoryRelink(args));
        if (!mounted.current) return null;
        if (!result.ok) {
          setError(result.error, 'memoria');
          setHint(result.hint);
          return null;
        }
        setRecaps(result.value.rows);
        setRecapCoverage(result.value.coverage);
        recapSignatureRef.current = recapSignature(result.value.rows);
        return { outcome: result.value.relinkOutcome };
      } finally {
        if (mounted.current) setDecidingRecap(false);
      }
    },
    [],
  );

  const readMemoryTurns = useCallback(
    async (input: {
      conversationId: string;
      from: number;
      to: number;
    }): Promise<{ role: 'user' | 'assistant'; text: string }[] | null> => {
      const result = await callBridge(() => window.luxy.readVaultMemory(input));
      if (!result.ok) {
        setError(result.error);
        setHint(result.hint);
        // `null` y no `[]`: una lista vacía abría el recuadro sin nada dentro y
        // eso se lee como «esta conversación no tiene turnos», que es falso.
        // Quien llama tiene que poder NO abrirlo
        return null;
      }
      return result.value.turns;
    },
    [],
  );

  const readMemoryEpisode = useCallback(
    async (
      episode: MemoryEpisode,
    ): Promise<{ role: 'user' | 'assistant'; text: string }[] | null> =>
      readMemoryTurns({
        conversationId: episode.conversationId,
        from: episode.from,
        to: episode.to,
      }),
    [readMemoryTurns],
  );

  const excludeFromMemory = useCallback(
    async (conversationId: string, excluded: boolean): Promise<void> => {
      const result = await callBridge(() =>
        window.luxy.excludeFromVaultMemory({ conversationId, excluded }),
      );
      if (!mounted.current) return;
      if (!result.ok) {
        setError(result.error);
        setHint(result.hint);
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
      // el «No, esta no» de una conversacion nueva es de ESA, que aun no tiene
      // id y va con la clave `''`. Al cambiar de conversacion se suelta: si no,
      // la siguiente nueva nacia con un descarte que nadie habia dicho y lo
      // heredaba al primer envio (revision del 28/09)
      setOwnerHintDismissed((previous) => {
        if (!previous.has('')) return previous;
        const next = new Set(previous);
        next.delete('');
        return next;
      });
      if (conversationId === null) {
        setTurns([]);
        // una conversación nueva empieza sin instrucciones: arrastrar las de la
        // anterior las aplicaría sin que nadie las haya escrito aquí
        setInstructions(null);
        setCharacterId(null);
        setCharacterDescription(null);
        setConversationOwnerView(null);
        previewTicket.current += 1;
        setOwnerPreview(null);
        setLastImage(null);
        setPendingImagePlan(null);
        setLastMemoryStatus(null);
        return;
      }
      const result = await window.luxy.readVaultConversation(conversationId);
      if (mounted.current && result.ok) {
        setTurns(result.value.turns);
        setInstructions(result.value.instructions);
        setCharacterId(result.value.characterId);
        setCharacterDescription(result.value.characterDescription);
        setConversationOwnerView(result.value.owner);
        previewTicket.current += 1;
        setOwnerPreview(null);
        // la vista previa que se acaba de tirar puede ser de ESTA misma
        // conversacion, con la confirmacion abierta: que la vuelva a pedir, ya
        // con los turnos releidos
        setOwnerPreviewEpoch((value) => value + 1);
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
      // la imagen que quedo esperando SI pertenece a la conversacion, y por eso
      // se lee del registro cifrado en vez de perderse: cerrar Studio —o abrir
      // otro hilo y volver— no es decir que no
      const pendingResult = await window.luxy.readVaultImagePending({ conversationId });
      if (mounted.current) {
        setPendingImagePlan(pendingResult.ok ? pendingResult.value.attempt : null);
      }
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
        // una conversacion nueva cuyo primer mensaje se quedo sin respuesta ya no
        // existe: main retiro el turno y borro el archivo. Si la pantalla se
        // quedara con su id, el reenvio iria como conversacion YA EMPEZADA, sin
        // el personaje elegido, y naceria sin su ficha (`D-103`)
        const openAfter = conversationAfterSend(result.value);
        if (openAfter === null) {
          setOpenConversationId(null);
          setTurns([]);
          setComposerState((previous) => ({ ...previous, message: input.message }));
          if (result.value.error !== null) setError(result.value.error);
          await reloadConversations();
          return false;
        }
        // el «No, esta no» de una conversacion nueva pasa a su id al nacer
        if (openConversationId === null) {
          setOwnerHintDismissed((previous) => {
            if (!previous.has('')) return previous;
            const next = new Set(previous);
            next.delete('');
            next.add(result.value.conversationId);
            return next;
          });
        }
        setOpenConversationId(result.value.conversationId);
        setTurns(result.value.turns);
        setInstructions(result.value.instructions);
        setCharacterId(result.value.characterId);
        setCharacterDescription(result.value.characterDescription);
        setConversationOwnerView(result.value.owner);
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
        const imagen = result.value.image;
        // el PLAN no se copia a `lastImage`: es el texto que saldria hacia el
        // proveedor, o sea contenido descifrado, y este estado no entra en la
        // purga del candado. El panel lo lee de `pendingImagePlan`, que si entra
        setLastImage(
          imagen === null
            ? null
            : {
                mediaId: imagen.mediaId,
                costCredits: imagen.costCredits,
                costUnit: imagen.costUnit,
                error: imagen.error,
                state: imagen.state,
                attemptId: imagen.attemptId,
              },
        );
        // se pregunta SIEMPRE, no solo cuando este turno dejo uno: un mensaje
        // nuevo sustituye la peticion anterior, y sin esto la tarjeta de la de
        // antes seguiria en pantalla ofreciendo generar algo que ya no vale
        const pendingResult = await window.luxy.readVaultImagePending({
          conversationId: result.value.conversationId,
        });
        if (mounted.current) {
          setPendingImagePlan(pendingResult.ok ? pendingResult.value.attempt : null);
        }
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

  /**
   * manda el plan que quedo esperando, con la correccion si la hubo.
   *
   * Reutiliza `generating` y `hordeProgress` tal cual: por dentro es la misma
   * generacion que el panel manual, asi que por primera vez un turno de la
   * conversacion enseña la cola del horde en vez de diez minutos en blanco.
   *
   * El `attemptId` llega por argumento y no se lee del estado: entre pintar la
   * tarjeta y pulsar el boton puede haber pasado un turno entero, y mandar «el
   * pendiente que haya ahora» seria generar uno que nadie miro.
   */
  const commitImagePlan = useCallback(
    async (input: { attemptId: string; edit: VaultImagePlanEdit | null }): Promise<boolean> => {
      if (openConversationId === null) return false;
      setGenerating(true);
      setError(null);
      setHint(null);
      // la cola de la generacion anterior no dice nada de esta
      setHordeProgress(null);
      try {
        const result = await window.luxy.commitVaultImage({
          action: 'generate',
          conversationId: openConversationId,
          attemptId: input.attemptId,
          edit: input.edit,
        });
        if (!result.ok) {
          setError(result.error);
          setHint(result.hint);
        }
        // los DOS caminos tocan la ventana, no solo el del exito: ver
        // `windowAfterImageCommit`. El aviso del hilo hablaba de este intento y
        // dejarlo diciendo «esperando» —despues de generar o despues de fallar—
        // seria mentir sobre lo que acaba de pasar
        const after = windowAfterImageCommit({
          attemptId: input.attemptId,
          result: result.ok
            ? {
                ok: true,
                attemptId: result.value.attemptId,
                mediaId: result.value.mediaId,
                costCredits: result.value.costCredits,
                costUnit: result.value.costUnit,
              }
            : { ok: false, error: result.error },
        });
        setLastImage(after.lastImage);
        if (after.pending === 'clear') {
          // decidido: deja de esperar a nadie. El registro conserva el intento
          // con lo que se mando; lo que desaparece es la tarjeta
          setPendingImagePlan(null);
        } else {
          // y si fallo, manda el registro: es el unico que sabe si el intento
          // sigue esperando. Quedarse con la copia caducada dejaba la tarjeta
          // clavada con los tres botones encendidos sobre algo que el proceso
          // principal ya rechaza, «Descartar» incluido
          const pendingResult = await window.luxy.readVaultImagePending({
            conversationId: openConversationId,
          });
          if (mounted.current) {
            setPendingImagePlan(pendingResult.ok ? pendingResult.value.attempt : null);
          }
        }
        if (!result.ok) return false;
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
          // terminada o fallida, la cola ya no existe
          setHordeProgress(null);
        }
      }
    },
    [openConversationId, reloadMedia],
  );

  /** dice que no. No se genera, no se cobra y el intento queda apuntado como descartado */
  const discardImagePlan = useCallback(
    async (attemptId: string): Promise<boolean> => {
      if (openConversationId === null) return false;
      setError(null);
      setHint(null);
      const result = await window.luxy.commitVaultImage({
        action: 'discard',
        conversationId: openConversationId,
        attemptId,
      });
      if (!result.ok) {
        setError(result.error);
        setHint(result.hint);
        // por el mismo motivo que en `commitImagePlan`: si el registro ya no lo
        // tiene esperando, la tarjeta se va igual. Conservar la copia caducada
        // es lo que dejaba al usuario sin ninguna salida
        const pendingResult = await window.luxy.readVaultImagePending({
          conversationId: openConversationId,
        });
        if (mounted.current) {
          setPendingImagePlan(pendingResult.ok ? pendingResult.value.attempt : null);
        }
        return false;
      }
      setPendingImagePlan(null);
      // y el aviso del hilo se va con ella: no hubo imagen y ya no se espera
      // ninguna, asi que no queda nada que contar de ese turno
      setLastImage((previous) =>
        previous !== null && previous.attemptId === attemptId ? null : previous,
      );
      return true;
    },
    [openConversationId],
  );

  /**
   * pregunta el precio en seco, sin encolar nada.
   *
   * Se pregunta por el texto CORREGIDO, que es el que se mandaria: un precio de
   * un texto que no va a salir no sirve de nada. Preguntar no decide: el intento
   * sigue esperando despues.
   */
  const estimateImagePlan = useCallback(
    async (input: {
      attemptId: string;
      edit: VaultImagePlanEdit | null;
    }): Promise<{ kudos: number | null; warnings: { code: string; message: string }[] } | null> => {
      if (openConversationId === null) return null;
      setEstimatingImage(true);
      setError(null);
      setHint(null);
      try {
        const result = await window.luxy.estimateVaultImage({
          conversationId: openConversationId,
          attemptId: input.attemptId,
          edit: input.edit,
        });
        if (!result.ok) {
          setError(result.error);
          setHint(result.hint);
          return null;
        }
        return { kudos: result.value.kudos, warnings: result.value.warnings };
      } finally {
        if (mounted.current) setEstimatingImage(false);
      }
    },
    [openConversationId],
  );

  /**
   * trae del registro cifrado el intento que se quiere mirar.
   *
   * No pone `error` cuando no aparece: un intento que el anillo ya tiró no es
   * una avería, es historia que caducó, y un aviso rojo arriba de la pantalla
   * por abrir un desplegable sería ruido. Quien lo pidió recibe `false` y lo
   * dice donde estaba mirando.
   */
  const readImageAttempt = useCallback(
    async (attemptId: string): Promise<boolean> => {
      if (openConversationId === null) return false;
      const result = await window.luxy.listVaultImageAttempts({
        conversationId: openConversationId,
      });
      if (!mounted.current) return false;
      if (!result.ok) {
        setError(result.error);
        setHint(result.hint);
        return false;
      }
      const found = result.value.attempts.find((entry) => entry.attemptId === attemptId) ?? null;
      setOpenImageAttempt(found);
      return found !== null;
    },
    [openConversationId],
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
        setError(result.error, 'personajes');
        setHint(result.hint);
        return false;
      }
      setCharacters(result.value.characters);
      return true;
    },
    [],
  );

  const setCharacterImageReview = useCallback(
    async (characterId: string, review: 'siempre' | 'nunca'): Promise<boolean> => {
      setError(null);
      setHint(null);
      const result = await window.luxy.setVaultCharacterImageReview({ characterId, review });
      if (!result.ok) {
        setError(result.error, 'personajes');
        setHint(result.hint);
        return false;
      }
      // vuelve la lista entera ya aplicada: sin esto el interruptor se quedaría
      // enseñando el valor viejo hasta la siguiente recarga
      setCharacters(result.value.characters);
      return true;
    },
    [],
  );

  const setCharacterImageCast = useCallback(
    async (characterId: string, cast: 'character-only' | 'both'): Promise<boolean> => {
      setError(null);
      setHint(null);
      const result = await window.luxy.setVaultCharacterImageCast({ characterId, cast });
      if (!result.ok) {
        setError(result.error, 'personajes');
        setHint(result.hint);
        return false;
      }
      // igual que el de revisión: vuelve la lista aplicada para que el
      // interruptor no se quede pintando el valor viejo
      setCharacters(result.value.characters);
      return true;
    },
    [],
  );

  const setCharacterReplyGuidance = useCallback(
    async (characterId: string, guidance: VaultReplyGuidance): Promise<boolean> => {
      setError(null);
      setHint(null);
      const result = await window.luxy.setVaultCharacterReplyGuidance({ characterId, guidance });
      if (!result.ok) {
        setError(result.error, 'personajes');
        setHint(result.hint);
        return false;
      }
      // como los otros dos: la lista aplicada, para no pintar el valor viejo
      setCharacters(result.value.characters);
      return true;
    },
    [],
  );

  const setCharacterPendingPacing = useCallback(
    async (characterId: string, pacing: VaultPendingPacing): Promise<boolean> => {
      setError(null);
      setHint(null);
      const result = await window.luxy.setVaultCharacterPendingPacing({ characterId, pacing });
      if (!result.ok) {
        setError(result.error, 'personajes');
        setHint(result.hint);
        return false;
      }
      // la lista aplicada, para que la casilla no se quede con el valor viejo
      setCharacters(result.value.characters);
      return true;
    },
    [],
  );

  const setCharacterRecentMemories = useCallback(
    async (characterId: string, recent: VaultRecentMemories): Promise<boolean> => {
      setError(null);
      setHint(null);
      const result = await window.luxy.setVaultCharacterRecentMemories({ characterId, recent });
      if (!result.ok) {
        setError(result.error, 'personajes');
        setHint(result.hint);
        return false;
      }
      // la lista aplicada, para que la casilla no se quede con el valor viejo
      setCharacters(result.value.characters);
      return true;
    },
    [],
  );

  const previewConversationOwner = useCallback(
    async (characterId: string | null): Promise<OwnerChangePreview | null> => {
      // cada peticion lleva su numero y solo la ULTIMA puede pintar. Sin esto,
      // cambiar de personaje en la confirmacion dejaba llegar tarde la vista
      // previa del anterior: el boton decia «Enganchar a Lia» y enganchaba a
      // otra, y el acuse repetia el nombre equivocado (`D-093`)
      previewTicket.current += 1;
      const ticket = previewTicket.current;
      setOwnerPreview(null);
      if (openConversationId === null) return null;
      setError(null);
      setHint(null);
      const result = await window.luxy.previewVaultConversationOwner({
        conversationId: openConversationId,
        characterId,
      });
      if (!mounted.current || ticket !== previewTicket.current) return null;
      if (!result.ok) {
        setError(result.error, 'enganche');
        setHint(result.hint);
        return null;
      }
      setOwnerPreview(result.value);
      return result.value;
    },
    [openConversationId, setError],
  );

  const clearOwnerPreview = useCallback((): void => {
    // lo que este en camino ya no puede pintar
    previewTicket.current += 1;
    setOwnerPreview(null);
  }, []);

  const setConversationOwner = useCallback(
    async (characterId: string | null, projectAlias: string): Promise<boolean> => {
      if (openConversationId === null) return false;
      setBusy(true);
      setError(null);
      setHint(null);
      try {
        const result = await window.luxy.setVaultConversationOwner({
          conversationId: openConversationId,
          characterId,
          projectAlias,
        });
        if (!result.ok) {
          setError(result.error, 'enganche');
          setHint(result.hint);
          return false;
        }
        if (!mounted.current) return true;
        // la conversacion tal y como la ve main con el dueño nuevo
        setTurns(result.value.turns);
        setInstructions(result.value.instructions);
        setCharacterId(result.value.characterId);
        setCharacterDescription(result.value.characterDescription);
        setConversationOwnerView(result.value.owner);
        setOwnerPreview(null);
        // soltar a proposito vale como «No, esta no»: sin esto el aviso «¿Es de
        // Lia? · Si, es suya» volvia a salir en el acto, invitando a enganchar
        // lo que se acababa de soltar (revision del 28/09)
        if (characterId === null) {
          const soltada = openConversationId;
          setOwnerHintDismissed((previous) => new Set([...previous, soltada]));
        }
        await reloadConversations();
        return true;
      } finally {
        if (mounted.current) setBusy(false);
      }
    },
    [openConversationId, reloadConversations],
  );

  const dismissOwnerHint = useCallback((conversationId: string | null): void => {
    setOwnerHintDismissed((previous) => new Set([...previous, conversationId ?? '']));
  }, []);

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
    const result = await callBridge(() => window.luxy.forgetVaultCharacter({ characterId }));
    if (!mounted.current) return;
    // sin esta rama, la «×» de olvidar un personaje fallaba en silencio
    // absoluto: ni el personaje desaparecía ni se decía por qué
    if (!result.ok) {
      setError(result.error, 'personajes');
      setHint(result.hint);
      return;
    }
    setCharacters(result.value.characters);
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
        conversationsDeferred: result.value.conversationsDeferred,
      });
      // lo descargado puede incluir conversaciones que aqui no existian
      await reloadConversations();
      if (openConversationId !== null) await openConversation(openConversationId);
    } finally {
      if (mounted.current) setSyncing(false);
    }
  }, [reloadConversations, openConversation, openConversationId]);

  // las tres que faltaban por estabilizar. El objeto que devuelve este hook es
  // nuevo en cada render —y hay uno cada 5 s por el latido—, asi que NADIE debe
  // depender de el en un efecto: se depende de la funcion, y la funcion tiene
  // que ser estable. Dos efectos que dependian del objeto releian la boveda
  // sola cada pocos segundos (`D-106`); `main/renderer-effect-deps.test.ts` lo vigila
  const clearRecapPreview = useCallback((): void => setRecapPreview(null), []);
  const acknowledgeRecoveryKey = useCallback((): void => setRecoveryKey(null), []);
  const clearError = useCallback((): void => setError(null), [setError]);

  return {
    status,
    loading,
    busy,
    error,
    errorArea,
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
    setCharacterImageReview,
    setCharacterImageCast,
    setCharacterReplyGuidance,
    setCharacterPendingPacing,
    setCharacterRecentMemories,
    conversationOwner,
    ownerPreview,
    ownerPreviewEpoch,
    previewConversationOwner,
    clearOwnerPreview,
    setConversationOwner,
    ownerHintDismissed,
    dismissOwnerHint,
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
    markPresence,
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
    pendingImagePlan,
    commitImagePlan,
    discardImagePlan,
    estimateImagePlan,
    estimatingImage,
    openImageAttempt,
    readImageAttempt,
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
    clearRecapPreview,
    recaps,
    recapCoverage,
    loadRecaps,
    decideRecap,
    forgetSealedMemory,
    decideMemoryRelink,
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
    acknowledgeRecoveryKey,
    clearError,
  };
}

/**
 * la conversacion que queda abierta tras un envio, o `null` si ya no existe.
 *
 * Un turno sin respuesta se retira, y si era el unico main borra el archivo:
 * la conversacion no llego a nacer. Quedarse con su id convertia el reenvio en
 * el de una conversacion ya empezada, sin personaje, y la confirmacion del
 * enganche se atascaba en una vista previa que no podia calcularse.
 */
export function conversationAfterSend(result: {
  conversationId: string;
  userTurnKept: boolean;
  turns: readonly unknown[];
}): string | null {
  if (!result.userTurnKept && result.turns.length === 0) return null;
  return result.conversationId;
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

/**
 * la tarjeta del pendiente que hay que pintar ADEMAS de la del ultimo turno.
 *
 * `lastImage` es estado de ESTA ventana: cambiar de conversacion o cerrar Studio
 * lo borra. El pendiente no —vive en el registro cifrado y se relee al abrir la
 * conversacion—, asi que mientras la tarjeta salio solo de `lastImage` un plan
 * guardado quedaba inalcanzable: no se podia ni ver, ni generar, ni descartar,
 * porque el unico boton que abre el panel esta dentro de esa tarjeta.
 *
 * Devuelve `null` cuando no hay pendiente o cuando la tarjeta de `lastImage` ya
 * es la de ESE intento: pintarlas las dos seria el mismo aviso repetido.
 */
export function pendingImageCard(input: {
  lastImage: VaultController['lastImage'];
  pendingImagePlan: ImageAttempt | null;
}): NonNullable<VaultController['lastImage']> | null {
  const pending = input.pendingImagePlan;
  if (pending === null) return null;
  const last = input.lastImage;
  if (last !== null && last.state === 'pending' && last.attemptId === pending.attemptId) {
    return null;
  }
  return {
    mediaId: null,
    costCredits: null,
    costUnit: null,
    error: null,
    state: 'pending',
    attemptId: pending.attemptId,
  };
}

/** que decir sobre lo que costo una imagen que ya termino */
export type ImageCostOutcome =
  | { kind: 'resent' }
  | { kind: 'generated'; unit: 'creditos' | 'kudos'; amount: number | null };

/**
 * distingue una imagen REENVIADA de una generada cuyo precio no se sabe.
 *
 * Las dos llegan con `costCredits: null` y hasta ahora el hilo miraba solo ese
 * campo, asi que una generacion de verdad se anunciaba como «te ha reenviado una
 * que ya tenia, sin gastar creditos»: mentia dos veces sobre una imagen que si
 * se genero y si se cobro.
 *
 * Lo que las separa es `costUnit`: el reenvio pone los DOS campos a null porque
 * no hay ninguna moneda de por medio, y una generacion siempre dice en que
 * moneda, aunque el servidor se calle el numero. Y se calla a menudo: AI Horde
 * devuelve el estado sin `kudos` cuando le apetece, que es justo lo que destapo
 * este fallo.
 */
export function imageCostOutcome(input: {
  costCredits: number | null;
  costUnit: 'creditos' | 'kudos' | null;
}): ImageCostOutcome {
  if (input.costCredits === null && input.costUnit === null) return { kind: 'resent' };
  return {
    kind: 'generated',
    unit: input.costUnit ?? 'creditos',
    amount: input.costCredits,
  };
}

/**
 * como queda la ventana despues de aprobar un pendiente.
 *
 * Es pura porque es justo la parte que fallaba: el camino de FALLO no tocaba
 * nada. El proceso principal dejaba el intento en `sent` y despues en `failed`,
 * pero la copia de la ventana seguia diciendo `pending`, asi que el aviso del
 * hilo seguia diciendo «esta esperando» y los tres botones del panel seguian
 * encendidos sobre un intento que el proceso principal ya rechaza —«Descartar»
 * incluido—: el usuario se quedaba sin ninguna salida.
 *
 * En el fallo pide `reload` y no `clear` porque desde aqui NO se sabe en que
 * quedo: puede haberse mandado y haber fallado el proveedor —ya no hay nada que
 * decidir— o no haber llegado a salir, y entonces sigue esperando y se tiene que
 * poder decidir. Quien lo sabe es el registro.
 */
export function windowAfterImageCommit(input: {
  attemptId: string;
  result:
    | {
        ok: true;
        attemptId: string;
        mediaId: string | null;
        costCredits: number | null;
        costUnit: 'creditos' | 'kudos' | null;
      }
    | { ok: false; error: string };
}): {
  /** lo que queda en `lastImage`, a partir de lo que hubiera */
  lastImage: (previous: VaultController['lastImage']) => VaultController['lastImage'];
  /** que hacer con la copia del pendiente */
  pending: 'clear' | 'reload';
} {
  const { result } = input;
  return {
    pending: result.ok ? 'clear' : 'reload',
    lastImage: (previous) => {
      // el aviso del hilo hablaba de ESTE intento: el de otro turno no se toca
      if (previous === null || previous.attemptId !== input.attemptId) return previous;
      if (result.ok) {
        return {
          mediaId: result.mediaId,
          costCredits: result.costCredits,
          costUnit: result.costUnit,
          error: null,
          state: 'done',
          attemptId: result.attemptId,
        };
      }
      // `done` no es «salio bien»: es «este turno ya no espera a nadie». Con
      // `error` puesto, el hilo lo pinta como el fallo que fue
      return { ...previous, state: 'done', error: result.error };
    },
  };
}

/** la semilla y el worker de un intento, copiados donde se estan enseñando */
export type ImageOrigin = { attemptId: string; seed: string | null; worker: string | null };

/**
 * lo que el visor sigue enseñando de un intento despues de leerlo.
 *
 * El hueco `openImageAttempt` del controlador es UNO y lo comparten dos sitios:
 * el desplegable «Ver lo que se mando» de un fallo y el origen del archivo
 * abierto en el visor. El desplegable vuelve a pedir el suyo en cuanto se lo
 * quitan, asi que leyendo del hueco el visor perdia la fila «Semilla / Worker» y
 * no volvia a tenerla mientras el desplegable siguiera abierto. Reintentar
 * tambien desde el visor no arregla nada: los dos se lo quitarian el uno al otro
 * sin parar.
 *
 * Se copian estos DOS campos y no el intento entero a proposito: son un numero y
 * el nombre de una maquina. El texto de la escena no se copia a ningun sitio.
 */
export function imageOriginSnapshot(
  previous: ImageOrigin | null,
  input: { attemptId: string | null; shared: ImageAttempt | null },
): ImageOrigin | null {
  const { attemptId, shared } = input;
  // un archivo adjuntado a mano no tiene intento y no hay nada que enseñar
  if (attemptId === null) return null;
  if (shared !== null && shared.attemptId === attemptId) {
    return { attemptId, seed: shared.seed, worker: shared.worker };
  }
  // lo copiado vale mientras sea de ESTE archivo: que el hueco pase a tener otro
  // intento no borra lo que ya se leyo, y abrir otro archivo si
  return previous !== null && previous.attemptId === attemptId ? previous : null;
}
