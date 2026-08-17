// constantes compartidas entre el gateway y el agente local

// nombre visible del agente en mensajes, logs, ramas e interfaz
export const LUXY_NAME = 'Luxy';

// prefijo de los identificadores cortos que se ven en telegram
export const JOB_SHORT_ID_PREFIX = 'LUX-';

// prefijo de las ramas de git que crea luxy en los worktrees
export const LUXY_BRANCH_PREFIX = 'luxy/';

// limite duro de caracteres de un mensaje de telegram
export const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;

// limite de longitud del prompt aceptado desde telegram
export const MAX_PROMPT_LENGTH = 8000;

// segundos sin heartbeat tras los que una maquina se considera desconectada
export const DEFAULT_MACHINE_OFFLINE_SECONDS = 45;

// segundos que dura el lease de un trabajo antes de poder recuperarse
export const DEFAULT_JOB_LEASE_SECONDS = 120;

// intervalo minimo entre ediciones del mensaje de progreso en telegram
export const MIN_PROGRESS_EDIT_INTERVAL_MS = 1500;

// version del protocolo entre agente y gateway
export const LUXY_PROTOCOL_VERSION = 1;

// estados posibles de un trabajo
export const JOB_STATUSES = [
  'queued',
  'waiting_for_machine',
  'claimed',
  'running',
  'waiting_for_approval',
  'completed',
  'failed',
  'cancelled',
  'interrupted',
] as const;

// estados en los que un trabajo ya no avanza
export const TERMINAL_JOB_STATUSES = ['completed', 'failed', 'cancelled', 'interrupted'] as const;

// canal que creo el trabajo. Telegram queda como canal secundario; Studio y
// Mobile comparten la misma cola sin inventar identificadores de chat.
export const JOB_ORIGINS = ['telegram', 'studio', 'mobile'] as const;

// proveedores conocidos por luxy
// un "proveedor" es una FAMILIA de modelos, no un modelo concreto.
//
// el modelo exacto vive en el catalogo (packages/shared/src/models) y, cuando
// el usuario lo fija, en jobs.model. Esta lista decide que maquina puede
// ejecutar cada familia y forma el enum del contrato con el gateway.
export const PROVIDER_IDS = [
  'claude',
  'codex',
  'deepseek',
  'glm',
  'hunyuan',
  'qwen',
  // familias añadidas con el catalogo verificado contra la conexion
  'kimi',
  'kat',
  'minimax',
  'step',
] as const;

// proveedores que se ejecutan mediante un cli local con sesion autenticada
export const LOCAL_CLI_PROVIDERS = ['claude', 'codex'] as const;

// proveedores que se consumen por http con clave propia
export const HTTP_API_PROVIDERS = [
  'deepseek',
  'glm',
  'hunyuan',
  'qwen',
  'kimi',
  'kat',
  'minimax',
  'step',
] as const;

// tipos de evento que el agente envia al gateway
export const JOB_EVENT_TYPES = [
  'phase',
  'log',
  'provider_output',
  'test_result',
  'diff_summary',
  'warning',
  'error',
] as const;

// acciones que requieren aprobacion explicita del usuario
export const APPROVAL_ACTIONS = ['commit', 'discard', 'push'] as const;

// ultima señal observada en el transporte de una respuesta.
//
// una respuesta incompleta no se puede atribuir a tokens, timeout o socket sin
// evidencia. Estos valores son esa evidencia, y NUNCA llevan contenido.
export const STREAM_TRANSPORT_ENDS = [
  // el proveedor mando `data: [DONE]`
  'done_marker',
  // el cuerpo HTTP se cerro por su cuenta, sin marcador
  'body_closed',
  // Luxy decidio terminar tras una señal terminal (finish_reason o usage final)
  'local_end',
  // la lectura del cuerpo lanzo: socket caido, aborto o error de red
  'read_error',
  // la respuesta no se transmitio: un solo JSON
  'no_stream',
] as const;

// que aporto un turno a la memoria de la conversacion.
//
// solo `structured` sustituye la memoria anterior. Todo lo demas la conserva:
// una respuesta cortada no puede pisar un contexto que si era correcto.
export const CONVERSATION_MEMORY_STATUSES = [
  // bloque completo, valido y en prosa
  'structured',
  // no habia bloque
  'absent',
  // el bloque se abrio y la respuesta se corto dentro de el
  'truncated_block',
  // habia bloque, pero no valida
  'invalid',
  // validaba, pero llevaba codigo dentro: no es memoria, es la respuesta
  'rejected_code',
] as const;

// tope del resumen de una TAREA de agente.
//
// es un resumen de verdad: describe lo que se hizo y se manda por Telegram.
export const MAX_TASK_RESULT_CHARS = 4000;

// tope de la respuesta guardada de una CONVERSACION.
//
// no es un resumen: es la respuesta. Con 4.000 caracteres, una pagina web de
// 7.691 llegaba entera y se guardaba cortada a la mitad, y parecia que el
// modelo se habia quedado a medias. Medido el 2026-08-05 en LUX-8B8T.
//
// no es almacenamiento de documentos: cuando una salida no quepa aqui, la ruta
// correcta es el artefacto (`D-013`), no subir mas este numero.
export const MAX_CONVERSATION_RESULT_CHARS = 120_000;

// lo que cabe en una tarjeta de Telegram sin partirla en decenas de mensajes
export const MAX_TELEGRAM_SUMMARY_CHARS = 3500;

// --- artefactos: cuando una salida larga pasa a ser un archivo (`D-013`)

// tope duro de un artefacto en disco.
//
// no es una cuota de almacenamiento: es el limite de lo que se acepta escribir
// de una vez desde texto generado. Una web enorme cabe de sobra; un volcado
// accidental de megabytes, no.
export const MAX_ARTIFACT_BYTES = 2_000_000;

// a partir de aqui una salida que ADEMAS parece un documento merece archivo.
//
// por debajo sigue siendo una respuesta que se lee en pantalla. Las dos
// condiciones tienen que darse: larga y documento.
export const ARTIFACT_MIN_CHARS = 8000;

// tipos de artefacto que Luxy sabe nombrar; el resto acaba en `txt`
export const ARTIFACT_KINDS = ['html', 'css', 'js', 'json', 'md', 'txt'] as const;

// margen tras una señal terminal FUERTE (`finish_reason`, memoria completa).
// El mensaje ya termino: solo se espera por si viene el consumo final.
export const TERMINAL_GRACE_MS = 1000;

// silencio exigido tras una señal terminal DEBIL (`usage` sin `choices`).
//
// no demuestra que la respuesta acabara: hay endpoints que lo mandan a mitad.
// Cerrar al segundo corto una pagina de mas de mil lineas con 3.180 tokens de
// salida y un tope de 8.192. Un modelo que sigue escribiendo no calla 15 s.
export const SOFT_TERMINAL_GRACE_MS = 15_000;

// como termino de verdad una respuesta.
//
// el estado de un trabajo en Postgres es mas grueso a proposito (no se toca el
// enum sin migracion). Esto es el detalle que necesita Studio para decir que
// paso y si queda algo que recuperar.
export const RESPONSE_OUTCOMES = [
  // señal terminal valida o cierre normal con respuesta utilizable
  'completed',
  // el modelo se quedo sin presupuesto: `finish_reason: length`
  'truncated',
  // cierre o error anomalo DESPUES de recibir contenido
  'interrupted',
  // se agoto el tope de tiempo efectivo de Luxy
  'timed_out',
  // lo paro el usuario
  'cancelled',
  // no hay nada utilizable
  'failed',
] as const;

// resultados que conservan contenido parcial y admiten continuacion
export const RECOVERABLE_RESPONSE_OUTCOMES = ['truncated', 'interrupted', 'timed_out'] as const;

// --- union de una respuesta cortada con su continuacion (`joinContinuation`)

// cuanto final del parcial se le enseña al modelo para que retome.
//
// es contexto, no el documento: compite en el prompt con la memoria
// acumulativa y con los turnos anteriores.
export const CONTINUATION_TAIL_CHARS = 1200;

// solapamiento maximo que se busca entre los dos fragmentos.
//
// un modelo que repite para coger carrerilla repite un parrafo, no una pagina.
// Mas alla de esto, una coincidencia es sospechosa de ser codigo repetido
// legitimo (una etiqueta, un bloque igual mas abajo).
export const CONTINUATION_MAX_OVERLAP_CHARS = 4000;

// solapamiento minimo que cuenta como prueba de continuidad.
//
// por debajo, coincidir es trivial: cualquier respuesta HTML termina en `>` y
// casi cualquiera en un salto de linea. Descartar texto por eso seria perderlo.
//
// 16 sale de medir una linea real de las que repite un modelo al retomar
// (`      <li>Segundo</li>` son 22). Con 24 se escapaban repeticiones de una
// linea corta, y equivocarse por aqui solo cuesta 16 caracteres de cierre;
// equivocarse por el otro lado duplica un parrafo entero.
export const CONTINUATION_MIN_OVERLAP_CHARS = 16;

// ventana del principio de la continuacion donde se busca el punto de corte
// cuando el modelo escribe una entradilla antes de retomar
export const CONTINUATION_RESYNC_WINDOW_CHARS = 2000;

// ancla maxima del final del parcial al resincronizar. Se prueba de mas larga a
// mas corta: cuanto mas larga case, mas evidencia hay de que es el corte.
export const CONTINUATION_ANCHOR_CHARS = 120;

// quien pidio el aborto de una peticion, cuando lo hubo
export const RESPONSE_ABORT_SOURCES = [
  // cancelacion del usuario o del trabajo entero
  'user',
  // se agoto el tope de tiempo de ESTA peticion
  'request_timeout',
  // Luxy cerro el transporte tras una señal terminal valida
  'local_finalization',
  // el proveedor o la red cortaron
  'transport',
] as const;
