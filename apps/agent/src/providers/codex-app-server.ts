// segundo transporte de Codex: su `app-server`, por tuberia, en vez de `codex exec`.
//
// POR QUE EXISTE, en una frase: `codex exec` solo admite imagenes con
// `-i <FICHERO>`, o sea escribiendo una copia SIN CIFRAR en el disco, y eso
// rompe lo unico que hace privada a la boveda. El protocolo del app-server
// acepta la imagen EN LINEA, como `data:` URI dentro del mensaje, igual que
// Claude Code la acepta por su stdin. La foto se descifra en memoria, viaja por
// la tuberia y no toca el disco en ningun momento.
//
// NO SUSTITUYE A `codex exec`, Y ESO ES DELIBERADO. El propio CLI marca
// `app-server` como `[experimental]`: su protocolo puede cambiar en cualquier
// actualizacion. Si fuera el unico camino, una actualizacion dejaria a Codex
// entero sin funcionar. Se usa SOLO cuando hace falta —un turno con imagenes
// que no tienen ruta en disco—, asi que si el protocolo se rompe se pierde
// describir fotos de la boveda con Codex, no Codex.
//
// COMPROBADO CONTRA EL BINARIO REAL el 2026-09-10, no deducido de la
// documentacion: una sonda mando un PNG de 4x4 mitad rojo mitad azul como data
// URI y Codex contesto describiendolo. El esquema del protocolo se vuelca con
// `codex app-server generate-json-schema --out <DIR>`, que es gratis y no gasta
// ninguna llamada.
import { spawn, type ChildProcess } from 'node:child_process';
import { buildSafeEnv } from '@luxy/shared';
import type { ProviderImage, ResponseTermination } from '@luxy/shared';
import { BASE_ENV_ALLOWLIST, killProcessTree, resolveExecutable } from '../process.js';

/** lo que Codex entiende como un trozo de mensaje del usuario */
export type CodexUserInput =
  | { type: 'text'; text: string }
  | { type: 'image'; url: string };

/**
 * como acabo el turno, con las palabras exactas del protocolo.
 *
 * Son las cuatro de `TurnStatus` y no hay mas: **no existe una notificacion
 * `turn/failed`**. El fracaso viaja DENTRO de `turn/completed`, en
 * `turn.status`, y solo entonces viene poblado `turn.error`. Buscar un
 * `turn/failed` que no existe es la forma de quedarse esperando para siempre.
 */
export type CodexTurnStatus = 'completed' | 'interrupted' | 'failed' | 'inProgress';

export interface CodexTurnError {
  message: string;
  codexErrorInfo?: unknown;
  additionalDetails?: string | null;
}

/**
 * el mensaje que compone el turno, con la imagen en linea.
 *
 * El orden importa poco para el modelo, pero se manda la imagen ANTES del texto
 * porque asi lo hace el propio Codex en su interfaz y es como se probo.
 *
 * El `data:` URI se compone aqui y no antes a proposito: por el resto de Luxy
 * el base64 viaja PURO, sin prefijo, porque cada proveedor lo quiere a su
 * manera. Colar el prefijo donde no toca produce un «imagen corrupta» que no
 * explica nada.
 */
export function buildTurnInput(
  prompt: string,
  images: readonly ProviderImage[] = [],
): CodexUserInput[] {
  const entrada: CodexUserInput[] = images.map((image) => ({
    type: 'image',
    url: `data:${image.mimeType};base64,${image.base64}`,
  }));
  entrada.push({ type: 'text', text: prompt });
  return entrada;
}

/** que clase de linea acaba de llegar por la tuberia */
export type CodexIncoming =
  | { kind: 'response'; id: number | string; result: unknown }
  | { kind: 'error'; id: number | string; message: string }
  | { kind: 'request'; id: number | string; method: string }
  | { kind: 'notification'; method: string; params: Record<string, unknown> }
  | { kind: 'ignored' };

/**
 * clasifica una linea del servidor.
 *
 * LA RAMA QUE MAS IMPORTA ES `request`, y no es evidente: el servidor no solo
 * notifica, tambien **pregunta**, con mensajes que llevan `id` y esperan
 * respuesta —aprobaciones, refresco de credenciales, herramientas—. Si nadie
 * contesta, el turno se queda colgado hasta el timeout y parece que el modelo
 * no responde. Por eso se distinguen: `method` + `id` es una pregunta;
 * `method` a secas es un aviso.
 *
 * El campo `jsonrpc` NO sirve para discriminar: el esquema del protocolo ni
 * siquiera lo declara.
 */
export function classifyIncoming(value: unknown): CodexIncoming {
  if (typeof value !== 'object' || value === null) return { kind: 'ignored' };
  const mensaje = value as Record<string, unknown>;
  const id = mensaje['id'];
  const method = mensaje['method'];

  if (typeof method === 'string') {
    if (typeof id === 'number' || typeof id === 'string') {
      return { kind: 'request', id, method };
    }
    const params = mensaje['params'];
    return {
      kind: 'notification',
      method,
      params: typeof params === 'object' && params !== null ? (params as Record<string, unknown>) : {},
    };
  }

  if (typeof id !== 'number' && typeof id !== 'string') return { kind: 'ignored' };
  const error = mensaje['error'];
  if (typeof error === 'object' && error !== null) {
    const dentro = error as Record<string, unknown>;
    const texto = typeof dentro['message'] === 'string' ? dentro['message'] : 'error sin mensaje';
    return { kind: 'error', id, message: texto };
  }
  return { kind: 'response', id, result: mensaje['result'] };
}

/**
 * traduce el codigo de error del protocolo a algo que se pueda leer y actuar.
 *
 * Se traduce y no se vuelca en crudo porque estos codigos se arreglan de formas
 * muy distintas: uno pide esperar, otro pide cambiar de modelo y otro pide
 * iniciar sesion. Un mensaje que solo constata deja al usuario igual.
 */
export function describeCodexErrorInfo(info: unknown): string | null {
  const codigo = typeof info === 'string' ? info : null;
  if (codigo === null) {
    // la otra forma es un objeto de una sola clave con el detalle dentro
    if (typeof info === 'object' && info !== null) {
      const clave = Object.keys(info as Record<string, unknown>)[0];
      if (clave === 'responseStreamDisconnected') {
        return 'el flujo de respuesta se corto a mitad del turno';
      }
      if (clave === 'httpConnectionFailed' || clave === 'responseStreamConnectionFailed') {
        return 'no se pudo conectar con el servidor de Codex';
      }
      if (clave === 'responseTooManyFailedAttempts') {
        return 'Codex reintento y siguio fallando';
      }
    }
    return null;
  }
  const traducciones: Record<string, string> = {
    contextWindowExceeded: 'la conversacion no cabe en la ventana de contexto de ese modelo',
    sessionBudgetExceeded: 'se agoto el presupuesto de la sesion',
    usageLimitExceeded: 'has llegado al limite de uso de tu suscripcion; espera y vuelve a probar',
    serverOverloaded: 'el servidor de Codex esta saturado ahora mismo',
    unauthorized: 'la sesion de Codex no esta iniciada; ejecuta "codex" una vez y entra con ChatGPT',
    badRequest: 'Codex rechazo la peticion',
    internalServerError: 'Codex fallo por su lado',
    sandboxError: 'fallo el sandbox de Codex',
    cyberPolicy: 'Codex rechazo el contenido por su politica',
    misalignmentPolicyViolation: 'Codex rechazo el contenido por su politica',
  };
  return traducciones[codigo] ?? null;
}

export interface CodexTurnOutcome {
  ok: boolean;
  status: CodexTurnStatus;
  errorMessage: string | null;
  /** para el diagnostico de final de respuesta; nunca lleva contenido */
  finishReason: string | null;
}

/**
 * lee el desenlace del turno.
 *
 * `interrupted` NO es un fallo: es lo que devuelve el protocolo cuando alguien
 * pulsa Detener, y contarlo como error haria que una cancelacion pidiera
 * reintentar algo que el usuario acababa de parar a proposito.
 */
export function interpretTurn(turn: unknown): CodexTurnOutcome {
  const datos = (typeof turn === 'object' && turn !== null ? turn : {}) as Record<string, unknown>;
  const bruto = datos['status'];
  const status: CodexTurnStatus =
    bruto === 'completed' || bruto === 'interrupted' || bruto === 'failed' || bruto === 'inProgress'
      ? bruto
      : 'failed';

  if (status === 'completed') {
    return { ok: true, status, errorMessage: null, finishReason: 'completed' };
  }
  if (status === 'interrupted') {
    return { ok: false, status, errorMessage: null, finishReason: 'interrupted' };
  }

  const error = datos['error'];
  const dentro = (typeof error === 'object' && error !== null ? error : {}) as Record<
    string,
    unknown
  >;
  const mensaje = typeof dentro['message'] === 'string' ? dentro['message'] : null;
  const pista = describeCodexErrorInfo(dentro['codexErrorInfo']);
  const texto =
    pista !== null && mensaje !== null
      ? `${pista} (${mensaje})`
      : (pista ?? mensaje ?? 'el turno de Codex fallo sin decir por que');

  return { ok: false, status, errorMessage: texto, finishReason: status };
}

export interface CodexAppServerOptions {
  prompt: string;
  images: readonly ProviderImage[];
  cwd: string;
  model?: string | undefined;
  effort?: string | undefined;
  timeoutMs: number;
  signal: AbortSignal;
  onPhase: (message: string) => void;
  onText: (chunk: string) => void;
}

export interface CodexAppServerResult {
  ok: boolean;
  finalText: string;
  sessionId: string | null;
  errorMessage: string | null;
  timedOut: boolean;
  cancelled: boolean;
  termination: ResponseTermination;
}

/** cuanto se espera al apreton de manos antes de rendirse */
const HANDSHAKE_TIMEOUT_MS = 60_000;

/**
 * ejecuta UN turno contra el app-server y devuelve lo que dijo el modelo.
 *
 * El hilo es EFIMERO y el sandbox de SOLO LECTURA, y las dos cosas son
 * barreras, no preferencias: un turno que describe una foto no tiene por que
 * poder tocar un archivo, ni dejar una sesion guardada con el contenido de la
 * boveda dentro.
 */
export async function runCodexAppServerTurn(
  options: CodexAppServerOptions,
): Promise<CodexAppServerResult> {
  const empezadoEn = Date.now();
  const resolved = resolveExecutable('codex');
  const hijo: ChildProcess = spawn(resolved.command, [...resolved.prefixArgs, 'app-server'], {
    cwd: options.cwd,
    env: buildSafeEnv(process.env, BASE_ENV_ALLOWLIST),
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    shell: false,
  });

  let siguienteId = 0;
  const pendientes = new Map<number, { ok: (v: unknown) => void; fallo: (e: Error) => void }>();
  let buffer = '';
  let texto = '';
  let sessionId: string | null = null;
  // el tipo va explicito porque esto se rellena desde el manejador de la
  // tuberia: sin la anotacion, TypeScript estrecha la variable a `never` y
  // luego se queja de leer sus campos
  let desenlace: CodexTurnOutcome | null = null;
  const anotarDesenlace = (valor: CodexTurnOutcome): void => {
    desenlace = valor;
  };
  let avisoDeError: string | null = null;
  // el esquema los quiere numericos, no nulos: sin dato se queda en cero, y
  // `finalUsageReceived` es quien distingue «cero» de «no lo dijo»
  let inputTokens = 0;
  let outputTokens = 0;
  let huboUso = false;
  let trozos = 0;
  let bytes = 0;
  let muerto = false;

  const enviar = (method: string, params: unknown): Promise<unknown> => {
    siguienteId += 1;
    const id = siguienteId;
    hijo.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    return new Promise((ok, fallo) => pendientes.set(id, { ok, fallo }));
  };

  // el servidor PREGUNTA, y si nadie contesta el turno se cuelga. Se rechaza
  // todo por defecto: un turno de solo lectura no aprueba comandos, no entrega
  // credenciales de ChatGPT —Luxy nunca las maneja— y no ejecuta herramientas
  const rechazar = (id: number | string, method: string): void => {
    hijo.stdin?.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Luxy no atiende ${method} en un turno de solo lectura` },
      })}\n`,
    );
  };

  const cerrar = (): void => {
    if (muerto) return;
    muerto = true;
    killProcessTree(hijo);
  };

  hijo.stdout?.setEncoding('utf8');
  hijo.stdout?.on('data', (trozo: string) => {
    buffer += trozo;
    let corte = buffer.indexOf('\n');
    while (corte !== -1) {
      const linea = buffer.slice(0, corte).trim();
      buffer = buffer.slice(corte + 1);
      corte = buffer.indexOf('\n');
      if (linea.length === 0) continue;

      let crudo: unknown;
      try {
        crudo = JSON.parse(linea);
      } catch {
        continue;
      }
      const mensaje = classifyIncoming(crudo);

      if (mensaje.kind === 'response' || mensaje.kind === 'error') {
        const espera = typeof mensaje.id === 'number' ? pendientes.get(mensaje.id) : undefined;
        if (espera === undefined) continue;
        pendientes.delete(mensaje.id as number);
        if (mensaje.kind === 'error') espera.fallo(new Error(mensaje.message));
        else espera.ok(mensaje.result);
        continue;
      }

      if (mensaje.kind === 'request') {
        rechazar(mensaje.id, mensaje.method);
        continue;
      }

      if (mensaje.kind !== 'notification') continue;
      const { method, params } = mensaje;

      if (method === 'item/agentMessage/delta') {
        const delta = params['delta'];
        if (typeof delta === 'string') {
          texto += delta;
          trozos += 1;
          bytes += Buffer.byteLength(delta, 'utf8');
          options.onText(delta);
        }
        continue;
      }

      // el texto DEFINITIVO viene aqui, completo. Los deltas valen para pintar
      // en vivo, pero reconstruir la respuesta sumandolos es fragil: si en un
      // turno hay preambulo y respuesta final son dos items distintos
      if (method === 'item/completed') {
        const item = params['item'];
        if (typeof item === 'object' && item !== null) {
          const datos = item as Record<string, unknown>;
          if (datos['type'] === 'agentMessage' && typeof datos['text'] === 'string') {
            const completo = datos['text'];
            if (completo.trim().length > 0) texto = completo;
          }
        }
        continue;
      }

      if (method === 'thread/tokenUsage/updated') {
        const uso = params['tokenUsage'];
        if (typeof uso === 'object' && uso !== null) {
          const ultimo = (uso as Record<string, unknown>)['last'];
          if (typeof ultimo === 'object' && ultimo !== null) {
            const n = ultimo as Record<string, unknown>;
            if (typeof n['inputTokens'] === 'number') {
              inputTokens = n['inputTokens'];
              huboUso = true;
            }
            if (typeof n['outputTokens'] === 'number') {
              outputTokens = n['outputTokens'];
              huboUso = true;
            }
          }
        }
        continue;
      }

      // un `error` con `willRetry` NO cierra nada: el servidor lo reintenta
      // solo y el turno sigue vivo. El final autoritativo es `turn/completed`
      if (method === 'error') {
        const reintenta = params['willRetry'] === true;
        const error = params['error'];
        if (!reintenta && typeof error === 'object' && error !== null) {
          const dentro = error as Record<string, unknown>;
          const pista = describeCodexErrorInfo(dentro['codexErrorInfo']);
          const suyo = typeof dentro['message'] === 'string' ? dentro['message'] : null;
          avisoDeError = pista ?? suyo;
        }
        continue;
      }

      if (method === 'turn/completed') {
        anotarDesenlace(interpretTurn(params['turn']));
        continue;
      }
    }
  });

  // stderr no se reenvia a la pantalla: puede llevar rutas y detalles del
  // entorno, y esto corre sobre contenido de la boveda
  hijo.stderr?.resume();

  let timedOut = false;
  let cancelled = false;

  const temporizador = setTimeout(() => {
    timedOut = true;
    cerrar();
  }, options.timeoutMs);

  const alCancelar = (): void => {
    cancelled = true;
    cerrar();
  };
  options.signal.addEventListener('abort', alCancelar, { once: true });

  const finDelProceso = new Promise<void>((resolve) => {
    hijo.once('exit', () => resolve());
    hijo.once('error', () => resolve());
  });

  try {
    options.onPhase('conectando con Codex');
    await conLimite(
      enviar('initialize', {
        clientInfo: { name: 'luxy', title: 'Luxy', version: '1' },
      }),
      HANDSHAKE_TIMEOUT_MS,
      'Codex no respondio al saludo inicial',
    );
    hijo.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'initialized' })}\n`);

    const hilo = await conLimite(
      enviar('thread/start', {
        // efimero: no deja una sesion guardada con contenido de la boveda dentro
        ephemeral: true,
        cwd: options.cwd,
        // barreras duras para un turno que solo mira una foto
        sandbox: 'read-only',
        approvalPolicy: 'never',
        ...(options.model === undefined ? {} : { model: options.model }),
      }),
      HANDSHAKE_TIMEOUT_MS,
      'Codex no pudo abrir la conversacion',
    );
    const datosHilo = (typeof hilo === 'object' && hilo !== null ? hilo : {}) as Record<
      string,
      unknown
    >;
    const dentro = (
      typeof datosHilo['thread'] === 'object' && datosHilo['thread'] !== null
        ? datosHilo['thread']
        : {}
    ) as Record<string, unknown>;
    const threadId = typeof dentro['id'] === 'string' ? dentro['id'] : null;
    if (threadId === null) throw new Error('Codex no devolvio identificador de conversacion');
    sessionId = threadId;

    options.onPhase('lanzando Codex');
    await enviar('turn/start', {
      threadId,
      input: buildTurnInput(options.prompt, options.images),
      ...(options.model === undefined ? {} : { model: options.model }),
      ...(options.effort === undefined ? {} : { effort: options.effort }),
    });

    // se espera al desenlace, no al final del proceso: el app-server sigue vivo
    // despues del turno, esperando otro
    await esperarA(() => desenlace !== null || muerto, options.timeoutMs);
  } catch (error) {
    if (!timedOut && !cancelled) {
      avisoDeError = error instanceof Error ? error.message : String(error);
    }
  } finally {
    clearTimeout(temporizador);
    options.signal.removeEventListener('abort', alCancelar);
    cerrar();
    await finDelProceso;
  }

  const salida = desenlace as CodexTurnOutcome | null;
  const durationMs = Date.now() - empezadoEn;
  const ok = salida !== null && salida.ok && texto.trim().length > 0;
  const errorMessage = cancelled
    ? 'cancelado por el usuario'
    : timedOut
      ? 'Codex no termino a tiempo'
      : (salida?.errorMessage ??
        avisoDeError ??
        (ok ? null : 'Codex no llego a contestar nada'));

  return {
    ok,
    finalText: texto,
    sessionId,
    errorMessage,
    timedOut,
    cancelled,
    termination: {
      httpStatus: null,
      streamed: true,
      chunks: trozos,
      bytes,
      durationMs,
      // un aborto se ve como corte de lectura, igual que en el resto de Luxy
      transportEnd: cancelled || timedOut ? 'read_error' : 'done_marker',
      finishReason: salida?.finishReason ?? null,
      finalUsageReceived: huboUso,
      abortedBy: cancelled ? 'user' : timedOut ? 'request_timeout' : null,
      effectiveTimeoutMs: options.timeoutMs,
      maxOutputTokens: null,
      inputTokens,
      outputTokens,
      // el TAMAÑO del texto, nunca el texto: este bloque viaja a los registros
      textLength: texto.length,
    },
  };
}

/** rechaza si la promesa no llega a tiempo, con un motivo que se pueda leer */
async function conLimite<T>(promesa: Promise<T>, ms: number, motivo: string): Promise<T> {
  let temporizador: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promesa,
      new Promise<never>((_, fallo) => {
        temporizador = setTimeout(() => fallo(new Error(motivo)), ms);
      }),
    ]);
  } finally {
    if (temporizador !== undefined) clearTimeout(temporizador);
  }
}

/** espera a que se cumpla una condicion, sondeandola sin bloquear */
async function esperarA(condicion: () => boolean, maxMs: number): Promise<void> {
  const limite = Date.now() + maxMs;
  while (!condicion() && Date.now() < limite) {
    await new Promise((r) => setTimeout(r, 50));
  }
}
