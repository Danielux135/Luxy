// almacen de los bytes cifrados de imagenes y videos.
//
// Va sobre Supabase Storage y no sobre R2 por una razon concreta: el gateway
// YA tiene la URL y la service role key de Supabase. Usar R2 obligaria a un
// binding nuevo en `wrangler.toml` —que ni siquiera se versiona— y a un
// despliegue distinto, a cambio de nada que aqui se note.
//
// Lo que entra y sale son bytes que este servicio no puede leer: llegan
// cifrados del equipo del usuario y se devuelven igual. El bucket es privado y
// sin politicas, asi que solo la service role key llega a el, exactamente como
// las tablas `vault_*`.
//
// La clave del objeto es opaca (32 hex) y se guarda bajo el identificador del
// usuario, para que dos cuentas no puedan chocar ni descubrirse por la ruta.
import type { GatewayConfig } from './env.js';

/** nombre del bucket. Debe existir antes: lo crea la migracion 0008 */
export const VAULT_BUCKET = 'vault-media';

/**
 * tope de un archivo que se anuncia si nadie configura otro
 * (`VAULT_OBJECT_MAX_BYTES`).
 *
 * El tope del protocolo, 90 MiB, es el cuerpo de una peticion a un Worker; el
 * de Storage es otro y mas bajo: el plan gratuito de Supabase no admite un
 * archivo de mas de 50 MB (GW-R2-01). Anunciar 90 MiB hacia que Studio
 * subiera un video de 60 MB, Storage lo rechazara y Studio lo reintentara
 * entero en cada pasada. Va en megas decimales y no en MiB porque no se ha
 * comprobado en que unidad cuenta Supabase: el menor de los dos vale en ambos.
 */
export const VAULT_STORAGE_DEFAULT_OBJECT_MAX_BYTES = 50 * 1000 * 1000;

const OBJECT_KEY = /^[0-9a-f]{32}$/;

export class ObjectStoreError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ObjectStoreError';
  }
}

export class VaultObjectStore {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;

  constructor(config: Pick<GatewayConfig, 'SUPABASE_URL' | 'SUPABASE_SERVICE_ROLE_KEY'>) {
    this.baseUrl = `${config.SUPABASE_URL.replace(/\/+$/, '')}/storage/v1/object`;
    this.headers = {
      apikey: config.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${config.SUPABASE_SERVICE_ROLE_KEY}`,
    };
  }

  /**
   * ruta del objeto dentro del bucket.
   *
   * el identificador de usuario va DELANTE de la clave para que la propiedad
   * este en la ruta y no solo en la tabla: aunque alguien adivinara una clave
   * opaca ajena, la ruta que construye este servicio nunca la alcanzaria desde
   * otra sesion.
   */
  private pathFor(ownerUserId: string, objectKey: string): string {
    if (!OBJECT_KEY.test(objectKey)) {
      throw new ObjectStoreError('la clave del objeto no es valida', 422);
    }
    return `${VAULT_BUCKET}/${ownerUserId}/${objectKey}`;
  }

  async put(ownerUserId: string, objectKey: string, bytes: ArrayBuffer): Promise<void> {
    const response = await fetch(`${this.baseUrl}/${this.pathFor(ownerUserId, objectKey)}`, {
      method: 'POST',
      headers: {
        ...this.headers,
        // todos los objetos son opacos: declarar el tipo real diria si es un
        // video o una imagen sin abrir nada
        'Content-Type': 'application/octet-stream',
        // reenviar una subida cortada no debe fallar por «ya existe»
        'x-upsert': 'true',
      },
      body: bytes,
    });

    if (!response.ok) {
      if (response.status === 404) {
        await response.body?.cancel();
        throw new ObjectStoreError('el almacen de medios no esta creado en este proyecto', 503);
      }
      // un 413 y no un 502: «demasiado grande» no se arregla reintentando. Con
      // un 502 Studio lo contaba como fallo pasajero y volvia a subir el
      // archivo entero en cada pasada, para siempre (GW-R2-01); con un 413 lo
      // salta, lo cuenta y sigue
      if (await isTooLarge(response)) {
        throw new ObjectStoreError('ese archivo pasa del tamaño que admite el almacen del servidor', 413);
      }
      throw new ObjectStoreError('no se pudo guardar el archivo', 502);
    }
  }

  async get(ownerUserId: string, objectKey: string): Promise<ArrayBuffer> {
    const response = await fetch(`${this.baseUrl}/${this.pathFor(ownerUserId, objectKey)}`, {
      headers: this.headers,
    });
    if (!response.ok) {
      const missing = await isMissingObject(response);
      throw new ObjectStoreError('ese archivo no esta en el almacen', missing ? 404 : 502);
    }
    return response.arrayBuffer();
  }

  /**
   * dice si el objeto existe SIN descargarlo.
   *
   * Antes se comprobaba bajando el objeto entero —hasta 90 MiB— solo para
   * tirarlo. Se pide con GET (el HEAD de Storage no se ha verificado en vivo)
   * y el cuerpo se cancela sin leer un byte. Un fallo que no es «no existe» se
   * propaga: decir «no esta» cuando el almacen no contesta haria que el cliente
   * resubiera para nada, o que diera por perdido lo que esta.
   */
  async exists(ownerUserId: string, objectKey: string): Promise<boolean> {
    const response = await fetch(`${this.baseUrl}/${this.pathFor(ownerUserId, objectKey)}`, {
      headers: this.headers,
    });
    if (response.ok) {
      await response.body?.cancel();
      return true;
    }
    if (await isMissingObject(response)) return false;
    throw new ObjectStoreError('el almacen de medios no respondio', 502);
  }

  /**
   * borra un objeto y dice si existia.
   *
   * Un objeto que ya no esta cuenta como borrado (la purga es reanudable). Un
   * fallo de verdad se propaga, para que la purga no avance su cursor dejando
   * atras un objeto vivo.
   */
  async delete(ownerUserId: string, objectKey: string): Promise<boolean> {
    const response = await fetch(`${this.baseUrl}/${this.pathFor(ownerUserId, objectKey)}`, {
      method: 'DELETE',
      headers: this.headers,
    });
    if (response.ok) {
      await response.body?.cancel();
      return true;
    }
    if (await isMissingObject(response)) return false;
    throw new ObjectStoreError('no se pudo borrar el archivo', 502);
  }
}

/**
 * «no existe», en las dos formas en que lo dice Storage.
 *
 * Las versiones nuevas responden 404; otras que siguen en servicio responden
 * 400 con `statusCode: "404"` en el cuerpo. Tomar ese 400 por un fallo haria
 * que un objeto simplemente ausente pareciera una averia del almacen. El cuerpo
 * que se lee aqui es el del error, pequeño; nunca el de un objeto.
 */
async function isMissingObject(response: Response): Promise<boolean> {
  if (response.status === 404) {
    await response.body?.cancel();
    return true;
  }
  if (response.status !== 400) {
    await response.body?.cancel();
    return false;
  }
  const body = await storageErrorBody(response);
  return body.statusCode === '404' || body.statusCode === 404 || body.error === 'not_found';
}

/**
 * «demasiado grande», en las dos formas en que lo dice Storage: 413, o 400 con
 * `statusCode: "413"` («Payload too large», `EntityTooLarge`) en las versiones
 * que responden asi, igual que con el 404.
 */
async function isTooLarge(response: Response): Promise<boolean> {
  if (response.status === 413) {
    await response.body?.cancel();
    return true;
  }
  if (response.status !== 400) {
    await response.body?.cancel();
    return false;
  }
  const body = await storageErrorBody(response);
  return (
    body.statusCode === '413' ||
    body.statusCode === 413 ||
    body.error === 'Payload too large' ||
    body.code === 'EntityTooLarge'
  );
}

interface StorageErrorBody {
  statusCode?: unknown;
  error?: unknown;
  code?: unknown;
}

/** el cuerpo de un error de Storage, pequeño; vacio si no es JSON */
async function storageErrorBody(response: Response): Promise<StorageErrorBody> {
  const text = await response.text().catch(() => '');
  try {
    const body: unknown = JSON.parse(text);
    return typeof body === 'object' && body !== null ? (body as StorageErrorBody) : {};
  } catch {
    return {};
  }
}
