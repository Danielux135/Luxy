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

// proveedores conocidos por luxy: las FAMILIAS que una conexion agregadora
// registra sola. NO son todos los proveedores que puede tener una maquina.
//
// Es la mitad de la lista, y creerla entera costo el fallo del 2026-09-15: cada
// entrada de `providers.http` se registra con SU identificador —`groq`,
// `ovh-nemo`, `horde-cydonia`— y ninguno de esos esta aqui ni puede estarlo.
// Lo que una maquina ofrece de verdad lo calcula `machineProviders`
// (`machines.ts`), y quien ejecuta un modelo concreto lo decide
// `providerCandidatesForModel` (`apps/desktop/src/shared/model-selection.ts`).
//
// el modelo exacto vive en el catalogo (packages/shared/src/models) y, cuando
// el usuario lo fija, en jobs.model.
export const PROVIDER_IDS = [
  'claude',
  'codex',
  'deepseek',
  'glm',
  // se conserva por compatibilidad con trabajos historicos ya persistidos.
  // excluirla del enum hace que Studio no pueda ni siquiera leerlos.
  'hunyuan',
  'qwen',
  // familias añadidas con el catalogo verificado contra la conexion
  'kimi',
  'kat',
  'minimax',
  'step',
] as const;

/** distingue una familia ejecutable actual de un identificador historico leido */
export function isProviderId(value: string): value is (typeof PROVIDER_IDS)[number] {
  return (PROVIDER_IDS as readonly string[]).includes(value);
}

// proveedores que se ejecutan mediante un cli local con sesion autenticada
export const LOCAL_CLI_PROVIDERS = ['claude', 'codex'] as const;

/**
 * cuanto se le deja pensar al modelo antes de contestar.
 *
 * Union de lo que aceptan los dos CLI, COMPROBADO contra ellos el 2026-09-10 y
 * no copiado de ningun sitio:
 *
 * - `claude --help` declara `--effort <level>` con «low, medium, high, xhigh,
 *   max»;
 * - Codex no tiene flag propio: va por `-c model_reasoning_effort=<valor>`, y
 *   su catalogo real da `low, medium, high, xhigh, max, ultra`, con `ultra`
 *   solo en algunos modelos.
 *
 * QUE NO ES: una lista que valga para cualquier modelo. El propio esquema de
 * Codex lo dice —«must be supported by the selected model»— y ahi esta el
 * detalle que cuesta dinero: mandarle `ultra` a un modelo que no lo acepta no
 * lo recorta, falla, y la llamada se paga igual. Quien ofrece la lista al
 * usuario tiene que filtrarla POR MODELO; esto es solo el conjunto de valores
 * que existen.
 *
 * Estan en orden de gasto creciente a proposito: es el orden en que se pintan.
 */
export const REASONING_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const;

export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

/** distingue un esfuerzo valido de una cadena cualquiera */
export function isReasoningEffort(value: string): value is ReasoningEffort {
  return (REASONING_EFFORTS as readonly string[]).includes(value);
}

/**
 * el aviso de que el esfuerzo elegido NO se va a aplicar, o `null` si si.
 *
 * UN AJUSTE QUE SE CAE EN SILENCIO ES PEOR QUE NO TENERLO. El flag se descarta
 * a proposito cuando el CLI instalado no lo declara —pasarselo no lo ignora,
 * aborta la invocacion— pero callarselo deja al usuario creyendo que eligio y
 * que se aplico: puso `low` para gastar menos y esta pagando lo de siempre.
 *
 * Es la misma enfermedad que `D-073`, `D-079` y `D-080`: el dato existe y no
 * llega a nadie. Lo encontro un barrido del repositorio, no una prueba, porque
 * no habia ninguna que lo mirara.
 *
 * Vive aqui, puro, para poder probarlo sin lanzar un proceso: la decision es de
 * texto, y el adaptador solo tiene que emitir lo que devuelva.
 */
export function effortIgnoredWarning(
  effort: string | undefined,
  supported: boolean,
  displayName: string,
): string | null {
  if (effort === undefined || supported) return null;
  return (
    `esta version de ${displayName} no admite elegir el esfuerzo de razonamiento, ` +
    `asi que el turno corre con el suyo; actualiza el CLI si quieres poder bajarlo`
  );
}

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

// silencio que se le concede a un proveedor HTTP antes de dar la llamada por
// muerta: tiempo sin recibir NADA, no duracion total de la respuesta.
//
// POR QUE EXISTE: hasta ahora este tope no lo habia elegido nadie. Era el de
// fabrica de Node —300.000 ms exactos de `headersTimeout`/`bodyTimeout`— y no
// habia una sola linea en el proyecto que lo cambiara. El 2026-09-14 dos
// llamadas de DeepSeek murieron a los 302 y 300 segundos justos, el reintento
// siguiente contesto a los 304, y cada intento se cobro entero porque la
// pasarela cobra POR LLAMADA. Quince minutos es el numero que cabia elegir: da
// sitio a un modelo lento sin dejar colgada para siempre una llamada muerta.
//
// una respuesta larga que va llegando NO muere por durar mucho: cada byte
// reinicia la cuenta. Lo que la mata es el silencio.
export const PROVIDER_SILENCE_TIMEOUT_MS = 900_000;

// tiempo en vuelo a partir del cual una peticion que murio SIN cabeceras se da
// por atendida —y por tanto cobrada— en vez de por no conectada.
//
// POR QUE HACE FALTA UN UMBRAL: sin el, un `ECONNREFUSED` de 5 ms y un socket
// que la pasarela mantuvo abierto cuatro minutos y medio son literalmente el
// mismo caso para el codigo. La tercera llamada vacia del 2026-09-14 murio a
// los 268 s «porque la corto el otro lado», y como esta pasarela no manda
// cabeceras hasta que el modelo contesta, llego aqui sin codigo de estado: se
// declaraba gratis y se reenviaba sola, hasta tres veces.
//
// diez segundos son de sobra: un fallo de conexion real —DNS, rechazo del
// socket, TLS caido— ocurre en milisegundos, y equivocarse por este lado solo
// obliga a reenviar a mano una llamada que probablemente ya se pago.
export const CALL_ATTENDED_AFTER_MS = 10_000;

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

// por que fallo un CLI local cuando el propio CLI lo dice de forma estructurada.
//
// Existe por un fallo que paso desapercibido una semana: Claude Code sin sesion
// no falla «hacia fuera». Emite un `result` con `is_error: true` —y `subtype:
// "success"`, para mas confusion— cuyo texto es el mensaje de error, y Luxy
// guardaba ese texto como si fuera la respuesta del modelo. Los trabajos de
// fondo lo contaban como una negativa de Claude, y la pantalla no tenia forma
// de saber que lo unico que faltaba era iniciar sesion.
//
// Es un enum y no un texto a proposito: Studio decide con el sin parsear
// mensajes, y el registro puede llevarlo sin riesgo de arrastrar contenido.
export const PROVIDER_FAILURE_REASONS = [
  // el CLI no tiene sesion iniciada; se arregla con `claude auth login`
  'auth',
  // el CLI clasifico el fallo como limite de uso (su `rate_limit`, que es su
  // traduccion de un HTTP 429). Solo se usa con esa señal: no se adivina
  'rate_limit',
  // el CLI marco el resultado como error por cualquier otro motivo
  'api_error',
  // el proceso salio con codigo distinto de 0 sin un resultado de error que
  // explique por que
  'exit_code',
] as const;

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

// como acabo UNA llamada al proveedor. No es lo mismo que como acabo el turno.
//
// POR QUE EXISTE, y es la razon entera de esta lista: un turno puede costar
// tres llamadas y hasta ahora solo quedaba constancia de la ultima. De las tres
// llamadas vacias del 2026-09-14 no quedo rastro de ninguna clase —ni de por
// que murieron, ni de cuantos tokens se pagaron— porque Luxy solo apuntaba una
// linea POR TURNO. Y hay algo mas que encontrar: de las 13 llamadas de mas del
// historico, solo 3 encajan con la pared de los 300 s de Node; las otras 10
// pasaron en turnos cuyas llamadas duraban entre 29 y 135 segundos. Hay una
// segunda causa que nadie ha visto todavia, y separar los finales es lo que
// permitira reconocerla cuando vuelva a pasar.
//
// el orden va de «hubo respuesta» a «no hubo nada», y cada valor nombra una
// causa distinta a proposito: juntarlas es exactamente lo que hizo invisible el
// problema durante diez dias.
export const PROVIDER_CALL_ENDINGS = [
  // llego texto visible y el cierre fue normal
  'answered',
  // llego texto pero se corto por el tope de salida (`finish_reason: length`)
  'truncated',
  // cierre limpio y CERO texto visible: la llamada se paga igual
  'empty',
  // el proveedor estuvo hasta el tope sin enviar un solo byte
  'silence',
  // lo corto el reloj propio de Luxy, no el silencio de la conexion
  'timed_out',
  // lo paro una persona
  'cancelled',
  // el socket se cayo a mitad: lo corto el otro lado
  'remote_close',
  // no llegaron cabeceras nunca, pero la peticion llevaba minutos en vuelo.
  //
  // POR QUE NO ES `connect_failed`: esta pasarela retiene las cabeceras hasta
  // que el modelo empieza a contestar, asi que «sin cabeceras» no significa
  // «sin atender». La tercera llamada vacia del 2026-09-14 murio a los 268
  // segundos y se cobro igual; contarla como un socket rechazado la declaraba
  // gratis y la reenviaba sola. Un fallo de conexion de verdad ocurre en
  // milisegundos, no en cuatro minutos y medio.
  'dropped',
  // el proveedor rechazo la peticion con un codigo de estado
  'http_error',
  // error DENTRO del flujo, con HTTP 200: se paga como cualquier otra
  'stream_error',
  // no se llego a conectar. Es el unico final que NO cuesta dinero
  'connect_failed',
  // agoto el presupuesto de salida razonando, antes de escribir nada visible
  'output_budget',
] as const;

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
