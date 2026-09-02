// pruebas de la sincronizacion de imagenes y videos.
//
// Sin red y sin Supabase: el gateway es un objeto con memoria que se comporta
// como el real en lo que importa aqui —rechaza un registro cuyos bytes no estan
// subidos, y separa lo de cada equipo.
//
// Lo que se comprueba de verdad: que un archivo generado en un equipo se puede
// ABRIR en el otro. Contar subidas y bajadas no demuestra nada si lo que llega
// no se descifra.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VAULT_MAX_OBJECT_BYTES } from '@luxy/shared';
import { VaultService, VaultError, type DeviceKeyStore } from './vault-service.js';
import { vaultFilePathFor } from './key-file.js';
import { PrivateMediaStore, mediaIndexDirectory } from './media-store.js';
import { LocalBlobStore, mediaDirectory } from './blob-store.js';
import { syncMedia } from './media-sync.js';

const PASSWORD = 'una frase larga de prueba';
const FAST = { t: 1, m: 8 * 1024, p: 1 } as const;
const A = '11111111-1111-4111-8111-111111111111';

function memoryDeviceKeys(): DeviceKeyStore {
  let value: string | undefined;
  return {
    get: () => value,
    set: (next: string) => {
      value = next;
    },
    delete: () => {
      value = undefined;
    },
  };
}

const metadata = (name: string) => ({
  mimeType: 'image/png',
  displayName: name,
  prompt: 'un prompt que no debe viajar en claro',
  width: 512,
  height: 512,
  durationMs: null,
  characterId: null,
  provider: 'proveedor',
  model: null,
});

/** gateway falso: guarda objetos y registros como el real, y con sus reglas */
function fakeGateway() {
  const objects = new Map<string, Uint8Array>();
  const media: unknown[] = [];
  const calls: { method: string; path: string }[] = [];

  const impl = (async (url: string | URL, init?: RequestInit) => {
    const path = new URL(url.toString()).pathname;
    const method = init?.method ?? 'GET';
    calls.push({ method, path });

    const objectMatch = /^\/api\/vault\/media\/objects\/([0-9a-f]{32})$/.exec(path);
    if (objectMatch !== null) {
      const key = objectMatch[1]!;
      if (method === 'PUT') {
        objects.set(key, new Uint8Array(init?.body as ArrayBuffer));
        return Response.json({ stored: true });
      }
      const stored = objects.get(key);
      if (stored === undefined) return new Response('', { status: 404 });
      return new Response(stored.slice().buffer as ArrayBuffer, { status: 200 });
    }

    if (path === '/api/vault/media' && method === 'POST') {
      const body = JSON.parse(String(init?.body)) as { media: { objectKey: string } };
      // el registro no puede existir sin sus bytes, como en el gateway real
      if (!objects.has(body.media.objectKey)) return new Response('', { status: 409 });
      media.push(body.media);
      return Response.json({ stored: 1, skipped: 0 });
    }

    if (path === '/api/vault/media' && method === 'GET') {
      return Response.json({ media });
    }

    return new Response('', { status: 404 });
  }) as unknown as typeof fetch;

  return { impl, objects, media, calls };
}

describe('sincronizacion de medios', () => {
  let directories: string[] = [];
  let gateway: ReturnType<typeof fakeGateway>;

  /** un equipo con su boveda y su almacen de medios */
  async function machine(): Promise<{ vault: VaultService; store: PrivateMediaStore }> {
    const directory = mkdtempSync(join(tmpdir(), 'luxy-media-sync-'));
    directories.push(directory);
    const vault = new VaultService(vaultFilePathFor(directory), memoryDeviceKeys(), {
      argon2Params: FAST,
    });
    await vault.create(PASSWORD);
    const store = new PrivateMediaStore(
      mediaIndexDirectory(directory),
      new LocalBlobStore(mediaDirectory(directory)),
    );
    return { vault, store };
  }

  const deps = (onUnauthorized?: () => void) => ({
    gatewayUrl: 'https://gw.example',
    sessionToken: 'sesion-de-prueba',
    fetchImpl: gateway.impl,
    ...(onUnauthorized === undefined ? {} : { onUnauthorized }),
  });

  beforeEach(() => {
    gateway = fakeGateway();
    directories = [];
  });

  afterEach(() => {
    for (const directory of directories) rmSync(directory, { recursive: true, force: true });
  });

  it('sube un archivo y el otro equipo lo puede ABRIR', async () => {
    const primero = await machine();
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const guardado = await primero.store.add(primero.vault, A, bytes, metadata('foto.png'));

    expect((await syncMedia(primero.vault, primero.store, deps())).uploaded).toBe(1);

    // el segundo equipo: otro almacen, otra carpeta, y la MISMA llave maestra,
    // que es lo que garantiza la cuenta al entrar con la misma contraseña
    const otroDirectorio = mkdtempSync(join(tmpdir(), 'luxy-media-sync-'));
    directories.push(otroDirectorio);
    const segundo = new PrivateMediaStore(
      mediaIndexDirectory(otroDirectorio),
      new LocalBlobStore(mediaDirectory(otroDirectorio)),
    );

    expect((await syncMedia(primero.vault, segundo, deps())).downloaded).toBe(1);

    // contar bajadas no demuestra nada: lo que importa es que se pueda abrir
    const leido = await segundo.read(primero.vault, A, guardado.mediaId);
    expect([...leido.bytes]).toEqual([...bytes]);
    expect(leido.mimeType).toBe('image/png');
  });

  it('lo que viaja no lleva el nombre ni el prompt en claro', async () => {
    const { vault, store } = await machine();
    await store.add(vault, A, new Uint8Array([9, 9, 9]), metadata('secreto.png'));

    await syncMedia(vault, store, deps());

    const enviado = JSON.stringify(gateway.media);
    expect(enviado).not.toContain('secreto.png');
    expect(enviado).not.toContain('un prompt que no debe viajar');
    expect(enviado).not.toContain('image/png');
  });

  it('los bytes suben ANTES que el registro', async () => {
    const { vault, store } = await machine();
    await store.add(vault, A, new Uint8Array([1, 2, 3]), metadata('foto.png'));

    await syncMedia(vault, store, deps());

    const put = gateway.calls.findIndex((call) => call.method === 'PUT');
    const post = gateway.calls.findIndex(
      (call) => call.method === 'POST' && call.path === '/api/vault/media',
    );
    // al reves quedaria una fila apuntando a algo que no existe
    expect(put).toBeLessThan(post);
  });

  it('no vuelve a subir lo que ya esta', async () => {
    const { vault, store } = await machine();
    await store.add(vault, A, new Uint8Array([1, 2, 3]), metadata('foto.png'));

    await syncMedia(vault, store, deps());
    const segunda = await syncMedia(vault, store, deps());

    expect(segunda.uploaded).toBe(0);
    expect(segunda.downloaded).toBe(0);
  });

  it('un archivo demasiado grande se salta sin romper el resto', async () => {
    const { vault, store } = await machine();
    await store.add(vault, A, new Uint8Array([1, 2, 3]), metadata('pequeño.png'));

    // se falsea el tamaño del registro: generar 90 MB en una prueba seria
    // pagar minutos de disco para comprobar una comparacion
    const enorme = await store.add(vault, A, new Uint8Array([4, 5, 6]), metadata('enorme.mp4'));
    const index = join(mediaIndexDirectory(directories[0]!), `${A}.jsonl`);
    const { readFileSync, writeFileSync } = await import('node:fs');
    const lines = readFileSync(index, 'utf8').trim().split('\n');
    const parsed = lines.map((line) => JSON.parse(line) as { mediaId: string; byteSize: number });
    for (const record of parsed) {
      if (record.mediaId === enorme.mediaId) record.byteSize = VAULT_MAX_OBJECT_BYTES + 1;
    }
    writeFileSync(index, `${parsed.map((r) => JSON.stringify(r)).join('\n')}\n`, 'utf8');

    const result = await syncMedia(vault, store, deps());

    expect(result.skipped).toBe(1);
    // el pequeño SI sube: perder el resto por un video enorme seria peor
    expect(result.uploaded).toBe(1);
  });

  it('descarta un registro que esta boveda no puede abrir', async () => {
    const ajeno = await machine();
    await ajeno.store.add(ajeno.vault, A, new Uint8Array([1, 2, 3]), metadata('de otra.png'));
    await syncMedia(ajeno.vault, ajeno.store, deps());

    // otra boveda, otra llave: lo que hay en el servidor no se abre aqui
    const mio = await machine();
    const result = await syncMedia(mio.vault, mio.store, deps());

    expect(result.downloaded).toBe(0);
    expect(mio.store.rawRecords(A)).toHaveLength(0);
  });

  it('con la boveda cerrada no sincroniza', async () => {
    const { vault, store } = await machine();
    vault.lock();
    await expect(syncMedia(vault, store, deps())).rejects.toThrow(VaultError);
    expect(gateway.calls).toHaveLength(0);
  });

  it('un 401 olvida la sesion y explica que hacer', async () => {
    const { vault, store } = await machine();
    const impl = (async () => new Response('', { status: 401 })) as unknown as typeof fetch;
    let olvidada = false;

    await expect(
      syncMedia(vault, store, {
        gatewayUrl: 'https://gw.example',
        sessionToken: 'caducada',
        fetchImpl: impl,
        onUnauthorized: () => {
          olvidada = true;
        },
      }),
    ).rejects.toMatchObject({ hint: expect.stringContaining('vuelve a entrar') });
    expect(olvidada).toBe(true);
  });

  it('si falta el almacen en Supabase, lo dice', async () => {
    const { vault, store } = await machine();
    await store.add(vault, A, new Uint8Array([1, 2, 3]), metadata('foto.png'));

    const impl = (async (_url: string | URL, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'GET') return Response.json({ media: [] });
      return new Response('', { status: 503 });
    }) as unknown as typeof fetch;

    await expect(
      syncMedia(vault, store, {
        gatewayUrl: 'https://gw.example',
        sessionToken: 'sesion',
        fetchImpl: impl,
      }),
    ).rejects.toMatchObject({ hint: expect.stringContaining('almacen de medios') });
  });
});
