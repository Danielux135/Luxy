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
      throw new ObjectStoreError(
        response.status === 404
          ? 'el almacen de medios no esta creado en este proyecto'
          : 'no se pudo guardar el archivo',
        response.status === 404 ? 503 : 502,
      );
    }
  }

  async get(ownerUserId: string, objectKey: string): Promise<ArrayBuffer> {
    const response = await fetch(`${this.baseUrl}/${this.pathFor(ownerUserId, objectKey)}`, {
      headers: this.headers,
    });
    if (!response.ok) {
      throw new ObjectStoreError('ese archivo no esta en el almacen', response.status === 404 ? 404 : 502);
    }
    return response.arrayBuffer();
  }

  async delete(ownerUserId: string, objectKey: string): Promise<void> {
    // un borrado que falla no se propaga: deja un huerfano, que es recuperable,
    // en vez de impedir que se borre el registro que si molesta
    await fetch(`${this.baseUrl}/${this.pathFor(ownerUserId, objectKey)}`, {
      method: 'DELETE',
      headers: this.headers,
    }).catch(() => undefined);
  }
}
