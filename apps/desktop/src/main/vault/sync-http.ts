// el cable de la sincronizacion v2 con el gateway (`SYNC-F1-06`).
//
// Lo comparten los turnos (`sync.ts`) y los medios (`media-sync.ts`). Hace tres
// cosas que antes no hacia nadie:
//
//  1. pone tiempo limite a cada peticion: 30 s a las de JSON y 10 minutos a
//     las de bytes. Sin el, una red colgada dejaba «Sincronizando…» para
//     siempre;
//  2. corta lo que este en vuelo cuando se cierra la boveda (la señal de la
//     pasada), y lo distingue de un tiempo agotado: lo primero para la pasada
//     sin darla por buena, lo segundo es un fallo de red;
//  3. separa los fallos por su naturaleza, porque cada uno se trata distinto:
//     la sesion caducada para todo, la red caida para todo tras dos seguidas, y
//     un 5xx solo cuesta la conversacion o el medio en que ocurrio.
//
// Los ids van siempre en el CUERPO (`D-110`): ninguna URL de aqui lleva uno,
// salvo la clave opaca de un objeto, que es la ruta que el diseño deja igual.
import { VaultError } from './vault-service.js';

export const SYNC_JSON_TIMEOUT_MS = 30_000;
export const SYNC_OBJECT_TIMEOUT_MS = 10 * 60_000;

export type SyncFailureKind =
  /** la sesion ya no vale: se para todo y se olvida */
  | 'session'
  /** la boveda se cerro con la peticion en vuelo */
  | 'locked'
  /** no hubo respuesta: red caida, tiempo agotado */
  | 'transport'
  /** el gateway respondio con un estado que no se esperaba */
  | 'http'
  /** el gateway respondio algo que no cumple el contrato */
  | 'invalid';

export class SyncFailure extends VaultError {
  constructor(
    readonly kind: SyncFailureKind,
    message: string,
    hint: string | null,
    readonly status: number | null = null,
  ) {
    super(message, hint);
    this.name = 'SyncFailure';
  }
}

export interface SyncHttpOptions {
  gatewayUrl: string;
  sessionToken: string;
  fetchImpl?: typeof fetch;
  /** se aborta al cerrar la boveda */
  signal?: AbortSignal;
  onUnauthorized?: () => void;
  jsonTimeoutMs?: number;
  objectTimeoutMs?: number;
}

export interface JsonReply {
  status: number;
  body: unknown;
}

export class SyncHttp {
  private readonly base: string;
  private readonly doFetch: typeof fetch;

  constructor(private readonly options: SyncHttpOptions) {
    this.base = options.gatewayUrl.replace(/\/+$/, '');
    this.doFetch = options.fetchImpl ?? fetch;
  }

  /** la pasada ya no puede seguir: la boveda se cerro */
  get aborted(): boolean {
    return this.options.signal?.aborted === true;
  }

  private signalFor(timeoutMs: number): AbortSignal {
    const timeout = AbortSignal.timeout(timeoutMs);
    return this.options.signal === undefined ? timeout : AbortSignal.any([this.options.signal, timeout]);
  }

  private async send(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    if (this.aborted) throw lockedFailure();
    try {
      return await this.doFetch(`${this.base}${path}`, {
        ...init,
        signal: this.signalFor(timeoutMs),
        headers: {
          Authorization: `Bearer ${this.options.sessionToken}`,
          ...(init.headers ?? {}),
        },
      });
    } catch {
      // el motivo no se guarda: un error de red puede traer la URL entera
      if (this.aborted) throw lockedFailure();
      throw new SyncFailure(
        'transport',
        'no se ha podido hablar con el servidor',
        'comprueba la conexion y vuelve a sincronizar; lo tuyo sigue en este equipo',
      );
    }
  }

  /** un 401 olvida la sesion: con el mismo token volveria a fallar igual */
  private unauthorized(): never {
    this.options.onUnauthorized?.();
    throw new SyncFailure(
      'session',
      'tu sesion ha caducado',
      'vuelve a entrar con tu correo y contraseña desde Privado',
      401,
    );
  }

  private async readJson(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch (error) {
      if (this.aborted) throw lockedFailure();
      // un JSON roto es una respuesta que no cumple; un cuerpo que se corta a
      // mitad —tiempo agotado, red caida— es un fallo de red
      if (error instanceof SyntaxError) throw invalidReply('al leer la respuesta');
      throw new SyncFailure(
        'transport',
        'la respuesta del servidor se corto',
        'comprueba la conexion y vuelve a sincronizar; lo tuyo sigue en este equipo',
        response.status,
      );
    }
  }

  /**
   * una peticion JSON. Devuelve el estado y el cuerpo si el estado es uno de
   * `accept`; con cualquier otro lanza, sin leer el cuerpo del error: no se
   * enseña lo que el servidor diga.
   */
  async json(
    method: 'GET' | 'POST',
    path: string,
    body: unknown,
    accept: readonly number[] = [200],
  ): Promise<JsonReply> {
    const timeoutMs = this.options.jsonTimeoutMs ?? SYNC_JSON_TIMEOUT_MS;
    const response = await this.send(
      path,
      method === 'GET'
        ? { method }
        : {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          },
      timeoutMs,
    );
    if (response.status === 401) this.unauthorized();
    if (!accept.includes(response.status)) {
      await discard(response);
      throw httpFailure(response.status);
    }
    return { status: response.status, body: await this.readJson(response) };
  }

  /** sube los bytes ya cifrados de un objeto */
  async putObject(objectKey: string, bytes: Uint8Array): Promise<void> {
    const response = await this.send(
      `/api/vault/media/objects/${objectKey}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        // un ArrayBuffer propio: la vista tal cual mandaria el buffer entero si
        // fuera una ventana sobre uno mayor
        body: bytes.slice().buffer as ArrayBuffer,
      },
      this.options.objectTimeoutMs ?? SYNC_OBJECT_TIMEOUT_MS,
    );
    if (response.status === 401) this.unauthorized();
    await discard(response);
    if (!response.ok) throw httpFailure(response.status);
  }

  /** baja los bytes cifrados de un objeto, tal cual */
  async getObject(objectKey: string): Promise<Uint8Array> {
    const response = await this.send(
      `/api/vault/media/objects/${objectKey}`,
      { method: 'GET' },
      this.options.objectTimeoutMs ?? SYNC_OBJECT_TIMEOUT_MS,
    );
    if (response.status === 401) this.unauthorized();
    if (!response.ok) {
      await discard(response);
      throw httpFailure(response.status);
    }
    try {
      return new Uint8Array(await response.arrayBuffer());
    } catch {
      if (this.aborted) throw lockedFailure();
      throw new SyncFailure(
        'transport',
        'la descarga de un archivo se corto',
        'vuelve a sincronizar; lo que ya estaba sigue aqui',
      );
    }
  }
}

/** el cuerpo de un error no se lee, pero se suelta para no dejar la conexion colgada */
async function discard(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // nada que hacer: solo era liberar
  }
}

export function lockedFailure(): SyncFailure {
  return new SyncFailure(
    'locked',
    'la boveda se cerro mientras se sincronizaba',
    'abrela y vuelve a sincronizar: sigue donde se quedo',
  );
}

export function httpFailure(status: number): SyncFailure {
  return new SyncFailure(
    'http',
    `el servidor respondio ${status}`,
    status === 503
      ? 'falta crear el almacen de medios en Supabase'
      : status === 426
        ? 'este Studio habla un protocolo que el servidor ya no admite: actualiza Luxy Studio'
        : 'reintenta mas tarde; lo tuyo sigue en este equipo',
    status,
  );
}

export function invalidReply(what: string): SyncFailure {
  return new SyncFailure(
    'invalid',
    `el servidor respondio algo inesperado ${what}`,
    'reintenta mas tarde; si se repite, puede que haya que actualizar Studio o el servidor',
  );
}
