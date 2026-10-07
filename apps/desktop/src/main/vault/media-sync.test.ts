// pruebas de la sincronizacion de imagenes y videos, protocolo v2 (SYNC-F1-06).
//
// Contra el gateway DE VERDAD y su Supabase falso (`sync-gateway.fixture.ts`):
// el alta de un medio exige sus bytes y su conversacion, la lista va por paginas
// y la descarga la autoriza la tabla. Sin red y sin tokens.
//
// Lo que se comprueba de verdad: que un archivo generado en un equipo se puede
// ABRIR en el otro. Contar subidas y bajadas no demuestra nada si lo que llega
// no se descifra.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VAULT_MAX_OBJECT_BYTES } from '@luxy/shared';
import { VaultService, type DeviceKeyStore } from './vault-service.js';
import { vaultFilePathFor } from './key-file.js';
import { PrivateConversationStore, conversationsDirectory } from './conversation-store.js';
import { PrivateMediaStore, mediaIndexDirectory } from './media-store.js';
import { LocalBlobStore, mediaDirectory } from './blob-store.js';
import { SyncStateStore, syncStateFilePath } from './sync-state-store.js';
import { SyncDeletedStore, syncDeletedFilePath } from './sync-deleted-store.js';
import { SyncAnchorStore, syncAnchorFilePath } from './sync-anchor-store.js';
import { sealTurn } from './private-store.js';
import { syncVault, type SyncPart, type VaultSyncDeps, type VaultSyncStores } from './sync.js';
import { TEST_TOKEN, startTestGateway, type TestGateway } from './sync-gateway.fixture.js';
import type { VaultSyncMediaReport } from '../../shared/ipc.js';

const PASSWORD = 'una frase larga de prueba';
const FAST = { t: 1, m: 8 * 1024, p: 1 } as const;
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

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

const turn = (text: string) => ({
  role: 'user' as const,
  text,
  title: 'Titulo',
  provider: null,
  model: null,
  inputTokens: null,
  outputTokens: null,
});

interface Machine {
  directory: string;
  conversations: PrivateConversationStore;
  media: PrivateMediaStore;
  deleted: SyncDeletedStore;
  stores: VaultSyncStores;
}

let root: string;
let vault: VaultService;
let gateway: TestGateway;
let count = 0;

function machine(): Machine {
  count += 1;
  const directory = join(root, `equipo-${count}`);
  mkdirSync(directory, { recursive: true });
  const conversations = new PrivateConversationStore(conversationsDirectory(directory));
  const media = new PrivateMediaStore(
    mediaIndexDirectory(directory),
    new LocalBlobStore(mediaDirectory(directory)),
  );
  const deleted = new SyncDeletedStore(syncDeletedFilePath(directory));
  return {
    directory,
    conversations,
    media,
    deleted,
    stores: {
      conversations,
      media,
      deleted,
      state: new SyncStateStore(syncStateFilePath(directory)),
      anchor: new SyncAnchorStore(syncAnchorFilePath(directory)),
    },
  };
}

/** las subidas de bytes (PUT de objetos) que llegaron al gateway */
function puts(): number {
  return gateway.calls.filter((call) => call.method === 'PUT').length;
}

/**
 * cambia el tamaño apuntado de un medio en el indice de este equipo: generar
 * decenas de megas en una prueba seria pagar disco para probar una comparacion
 */
function falsearTamano(equipo: Machine, conversationId: string, mediaId: string, byteSize: number): void {
  const index = join(mediaIndexDirectory(equipo.directory), `${conversationId}.jsonl`);
  const parsed = readFileSync(index, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as { mediaId: string; byteSize: number });
  for (const record of parsed) {
    if (record.mediaId === mediaId) record.byteSize = byteSize;
  }
  writeFileSync(index, `${parsed.map((r) => JSON.stringify(r)).join('\n')}\n`, 'utf8');
}

function deps(extra: Partial<VaultSyncDeps> = {}): VaultSyncDeps {
  return {
    gatewayUrl: 'https://gateway.test',
    sessionToken: TEST_TOKEN,
    fetchImpl: gateway.fetchImpl,
    ...extra,
  };
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'luxy-media-sync-v2-'));
  vault = new VaultService(vaultFilePathFor(root), memoryDeviceKeys(), { argon2Params: FAST });
  await vault.create(PASSWORD);
  gateway = await startTestGateway();
  count = 0;
});

afterEach(() => {
  gateway.stop();
  rmSync(root, { recursive: true, force: true });
});

describe('sincronizacion de medios v2', () => {
  it('sube un archivo y el otro equipo lo puede ABRIR, miniatura incluida', async () => {
    const primero = machine();
    await primero.conversations.appendTurn(vault, A, turn('hola'));
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const guardado = await primero.media.add(
      vault,
      A,
      bytes,
      metadata('foto.png'),
      new Uint8Array([9, 9]),
    );

    const subida = await syncVault(vault, primero.stores, deps());
    expect(subida.media).toMatchObject({ reached: true, uploaded: 1, failed: 0, error: null });

    const segundo = machine();
    const bajada = await syncVault(vault, segundo.stores, deps());
    expect(bajada.media).toMatchObject({ downloaded: 1, failed: 0, unopenable: 0 });

    // contar bajadas no demuestra nada: lo que importa es que se pueda abrir
    const leido = await segundo.media.read(vault, A, guardado.mediaId);
    expect([...leido.bytes]).toEqual([...bytes]);
    expect(leido.mimeType).toBe('image/png');
    // y la miniatura, que la v1 no podia bajar
    expect([...(await segundo.media.readThumbnail(vault, A, guardado.mediaId))]).toEqual([9, 9]);
  });

  it('lo que viaja no lleva el nombre ni el prompt en claro', async () => {
    const equipo = machine();
    await equipo.conversations.appendTurn(vault, A, turn('hola'));
    await equipo.media.add(vault, A, new Uint8Array([9, 9, 9]), metadata('secreto.png'));

    await syncVault(vault, equipo.stores, deps());

    const enviado = JSON.stringify(gateway.calls.map((call) => call.body));
    expect(enviado).not.toContain('secreto.png');
    expect(enviado).not.toContain('un prompt que no debe viajar');
    expect(enviado).not.toContain('image/png');
  });

  it('los bytes suben ANTES que el registro', async () => {
    const equipo = machine();
    await equipo.conversations.appendTurn(vault, A, turn('hola'));
    await equipo.media.add(vault, A, new Uint8Array([1, 2, 3]), metadata('foto.png'));

    await syncVault(vault, equipo.stores, deps());

    const put = gateway.calls.findIndex((call) => call.method === 'PUT');
    const alta = gateway.calls.findIndex((call) => call.path.endsWith('/v2/media/push'));
    // al reves quedaria una fila apuntando a algo que no existe
    expect(put).toBeGreaterThanOrEqual(0);
    expect(put).toBeLessThan(alta);
  });

  it('la segunda pasada no sube ni baja nada', async () => {
    const equipo = machine();
    await equipo.conversations.appendTurn(vault, A, turn('hola'));
    await equipo.media.add(vault, A, new Uint8Array([1, 2, 3]), metadata('foto.png'));

    await syncVault(vault, equipo.stores, deps());
    gateway.calls.length = 0;
    const segunda = await syncVault(vault, equipo.stores, deps());

    expect(segunda.media).toMatchObject({ uploaded: 0, downloaded: 0, alreadyThere: 0, failed: 0 });
    expect(gateway.calls.some((call) => call.method === 'PUT')).toBe(false);
  });

  it('un archivo demasiado grande se salta sin romper el resto', async () => {
    const equipo = machine();
    await equipo.conversations.appendTurn(vault, A, turn('hola'));
    await equipo.media.add(vault, A, new Uint8Array([1, 2, 3]), metadata('pequeño.png'));
    // se falsea el tamaño del registro: generar 90 MB en una prueba seria pagar
    // minutos de disco para comprobar una comparacion
    const enorme = await equipo.media.add(vault, A, new Uint8Array([4, 5, 6]), metadata('enorme.mp4'));
    falsearTamano(equipo, A, enorme.mediaId, VAULT_MAX_OBJECT_BYTES + 1);

    const result = await syncVault(vault, equipo.stores, deps());

    expect(result.media).toMatchObject({ skipped: 1, uploaded: 1, failed: 0 });
  });

  it('uno por encima del tope del almacen se salta SIN subir un byte (GW-R2-01)', async () => {
    const equipo = machine();
    await equipo.conversations.appendTurn(vault, A, turn('hola'));
    const pequeno = await equipo.media.add(vault, A, new Uint8Array([1, 2, 3]), metadata('pequeño.png'));
    const grande = await equipo.media.add(vault, A, new Uint8Array([4, 5, 6]), metadata('grande.mp4'));
    // 60 MB: cabe en los 90 MiB del protocolo, no en los 50 MB de Storage. Con
    // los 90 MiB anunciados se subia entero, Storage lo rechazaba y en la
    // pasada siguiente se volvia a subir
    falsearTamano(equipo, A, grande.mediaId, 60 * 1000 * 1000);

    const result = await syncVault(vault, equipo.stores, deps());

    expect(result.media).toMatchObject({ skipped: 1, uploaded: 1, failed: 0, error: null });
    // solo los bytes del pequeño: el grande ni se intenta
    expect(puts()).toBe(1);
    expect(gateway.media().map((entry) => entry.mediaId)).toEqual([pequeno.mediaId]);
  });

  it.each([400, 413] as const)(
    'si Storage rechaza los bytes por tamaño (%i), se salta y no se da de alta (GW-R2-01)',
    async (status) => {
      const equipo = machine();
      await equipo.conversations.appendTurn(vault, A, turn('hola'));
      await equipo.media.add(vault, A, new Uint8Array([1, 2, 3]), metadata('foto.png'));
      // un almacen que admite menos de lo que anuncia el gateway
      gateway.fake.objectSizeLimit = 1;
      gateway.fake.oversizeStatus = status;

      const result = await syncVault(vault, equipo.stores, deps());

      // ni un fallo pasajero que reintentar ni un «subido»: demasiado grande
      expect(result.media).toMatchObject({ skipped: 1, uploaded: 0, failed: 0, error: null });
      expect(gateway.calls.some((call) => call.path.endsWith('/v2/media/push'))).toBe(false);
      expect(gateway.fake.objects.size).toBe(0);
      expect(gateway.media()).toEqual([]);
    },
  );

  it('descarta un medio que esta boveda no puede abrir', async () => {
    const otraCarpeta = mkdtempSync(join(tmpdir(), 'luxy-media-otra-'));
    try {
      const otraVault = new VaultService(vaultFilePathFor(otraCarpeta), memoryDeviceKeys(), {
        argon2Params: FAST,
      });
      await otraVault.create('otra frase larga distinta');
      const ajeno = machine();
      await ajeno.conversations.appendTurn(otraVault, A, turn('de otra'));
      await ajeno.media.add(otraVault, A, new Uint8Array([1, 2, 3]), metadata('de otra.png'));
      await syncVault(otraVault, ajeno.stores, deps());

      // otra boveda, otra llave: lo que hay en el servidor no se abre aqui
      const mio = machine();
      const result = await syncVault(vault, mio.stores, deps());

      expect(result.media).toMatchObject({ downloaded: 0, unopenable: 1 });
      expect(mio.media.rawRecords(A)).toHaveLength(0);
    } finally {
      rmSync(otraCarpeta, { recursive: true, force: true });
    }
  });

  it('mas de 500 medios: la lista va por paginas y no se queda ninguno', async () => {
    const primero = machine();
    await primero.conversations.appendTurn(vault, A, turn('hola'));
    for (let n = 0; n < 501; n += 1) {
      await primero.media.add(vault, A, new Uint8Array([n % 256, 1]), metadata(`f${n}.png`));
    }
    const subida = await syncVault(vault, primero.stores, deps());
    expect(subida.media).toMatchObject({ uploaded: 501, failed: 0 });

    gateway.calls.length = 0;
    const segundo = machine();
    const bajada = await syncVault(vault, segundo.stores, deps());
    expect(bajada.media).toMatchObject({ downloaded: 501, failed: 0 });
    // 500, 1 y la vacia: una pagina corta no prueba que no haya mas (F1-R1-02)
    expect(gateway.calls.filter((call) => call.path.endsWith('/v2/media/list'))).toHaveLength(3);
    expect(segundo.media.rawRecords(A)).toHaveLength(501);
  }, 120_000);

  it('un 200 sin «stored» no cuenta como subido', async () => {
    const equipo = machine();
    await equipo.conversations.appendTurn(vault, A, turn('hola'));
    await equipo.media.add(vault, A, new Uint8Array([1, 2, 3]), metadata('foto.png'));
    // lo que respondia la v1: un 200 con cero guardados
    gateway.rewrite = (path, status, body) =>
      path.endsWith('/v2/media/push') && status === 200 ? { stored: 0, skipped: 1 } : body;

    const result = await syncVault(vault, equipo.stores, deps());
    expect(result.media).toMatchObject({ uploaded: 0, failed: 1 });
    expect(result.media.error).toContain('inesperado');
  });

  it('«duplicate» cuenta como copiado, no como subido', async () => {
    const equipo = machine();
    await equipo.conversations.appendTurn(vault, A, turn('hola'));
    await equipo.media.add(vault, A, new Uint8Array([1, 2, 3]), metadata('foto.png'));
    gateway.rewrite = (path, status, body) =>
      path.endsWith('/v2/media/push') && status === 200 ? { outcome: 'duplicate' } : body;

    const result = await syncVault(vault, equipo.stores, deps());
    expect(result.media).toMatchObject({ uploaded: 0, alreadyThere: 1, failed: 0 });
  });

  it('el medio de una conversacion con un envio en curso SI viaja', async () => {
    const equipo = machine();
    await equipo.conversations.appendTurn(vault, A, turn('hola'));
    await syncVault(vault, equipo.stores, deps());
    await equipo.media.add(vault, A, new Uint8Array([1, 2, 3]), metadata('foto.png'));

    const result = await syncVault(
      vault,
      equipo.stores,
      deps({ isBusy: (id: string, part: SyncPart) => id === A && part === 'turns' }),
    );

    expect(result.conversations[0]?.status).toBe('busy');
    expect(result.media).toMatchObject({ uploaded: 1, failed: 0 });
  });

  it('si su conversacion aun no esta en el servidor, espera a la siguiente', async () => {
    const equipo = machine();
    await equipo.conversations.appendTurn(vault, A, turn('hola'));
    await equipo.media.add(vault, A, new Uint8Array([1, 2, 3]), metadata('foto.png'));

    // sus turnos no suben en esta pasada (envio en curso): el alta del medio
    // no crea la conversacion
    const primera = await syncVault(
      vault,
      equipo.stores,
      deps({ isBusy: (_id: string, part: SyncPart) => part === 'turns' }),
    );
    expect(primera.media).toMatchObject({ uploaded: 0, waiting: 1, failed: 0 });
    // y espera SIN subir sus bytes: el alta los habria dejado huerfanos
    expect(puts()).toBe(0);
    expect(gateway.fake.objects.size).toBe(0);

    const segunda = await syncVault(vault, equipo.stores, deps());
    expect(segunda.media).toMatchObject({ uploaded: 1, waiting: 0 });
  });

  it('los de una conversacion que nunca sube no dejan bytes huerfanos en cada pasada (GW-F1-02)', async () => {
    const equipo = machine();
    // secuencias repetidas aqui (el numerado viejo): sus turnos no suben nunca
    const uno = await sealTurn(vault, { conversationId: A, sequence: 0, turn: turn('a') });
    const otro = await sealTurn(vault, { conversationId: A, sequence: 0, turn: turn('b') });
    mkdirSync(conversationsDirectory(equipo.directory), { recursive: true });
    writeFileSync(
      join(conversationsDirectory(equipo.directory), `${A}.jsonl`),
      `${JSON.stringify(uno)}\n${JSON.stringify(otro)}\n`,
      'utf8',
    );
    await equipo.media.add(vault, A, new Uint8Array([1, 2, 3]), metadata('video.mp4'), new Uint8Array([4]));

    for (let pasada = 0; pasada < 3; pasada += 1) {
      gateway.calls.length = 0;
      const result = await syncVault(vault, equipo.stores, deps());
      expect(result.conversations[0]?.status).toBe('local-duplicates');
      expect(result.media).toMatchObject({ uploaded: 0, waiting: 1, failed: 0 });
      // antes: hasta 90 MiB y su miniatura otra vez en cada pasada, un 409 y
      // los objetos en Storage sin fila que los nombre
      expect(puts()).toBe(0);
    }
    expect(gateway.fake.objects.size).toBe(0);
    expect(gateway.media()).toEqual([]);
  });

  it('con «solo esta conversacion» pregunta UNA vez si su conversacion esta en el servidor', async () => {
    const equipo = machine();
    await equipo.conversations.appendTurn(vault, A, turn('hola'));
    await syncVault(vault, equipo.stores, deps());
    await equipo.media.add(vault, A, new Uint8Array([1, 2, 3]), metadata('a.png'));
    await equipo.media.add(vault, A, new Uint8Array([4, 5, 6]), metadata('b.png'));
    gateway.calls.length = 0;

    // con un envio en curso sus turnos se saltan y no hay manifiesto que diga
    // si esta alli: se pregunta a la lista, y una sola vez
    const result = await syncVault(
      vault,
      equipo.stores,
      deps({ isBusy: (_id: string, part: SyncPart) => part === 'turns' }),
      { mode: 'conversation', conversationId: A },
    );

    expect(result.media).toMatchObject({ uploaded: 2, waiting: 0, failed: 0 });
    // una sola lista para los dos medios: su pagina y la vacia que la cierra
    expect(gateway.calls.filter((call) => call.path.endsWith('/conversations/list'))).toHaveLength(2);
  });

  it('los medios de una conversacion borrada aqui ni suben ni bajan', async () => {
    const origen = machine();
    await origen.conversations.appendTurn(vault, A, turn('hola'));
    await origen.conversations.appendTurn(vault, B, turn('hola'));
    await origen.media.add(vault, A, new Uint8Array([1]), metadata('a.png'));
    await origen.media.add(vault, B, new Uint8Array([2]), metadata('b.png'));
    await syncVault(vault, origen.stores, deps());

    const otro = machine();
    otro.deleted.add(A);
    const result = await syncVault(vault, otro.stores, deps());

    expect(result.media).toMatchObject({ downloaded: 1 });
    expect(otro.media.rawRecords(A)).toHaveLength(0);
    expect(otro.media.rawRecords(B)).toHaveLength(1);
  });

  it('si falta el almacen en Supabase, lo dice y para', async () => {
    const equipo = machine();
    await equipo.conversations.appendTurn(vault, A, turn('hola'));
    await equipo.media.add(vault, A, new Uint8Array([1, 2, 3]), metadata('foto.png'));
    gateway.intercept = (_path, _body, request) =>
      request.method === 'PUT' ? Response.json({ error: 'sin bucket' }, { status: 503 }) : undefined;

    const result = await syncVault(vault, equipo.stores, deps());
    expect(result.stopped).toBe('media-store-missing');
    expect(result.stoppedDetail).toContain('almacen de medios');
    // los turnos si se sincronizaron
    expect(result.conversations[0]?.status).toBe('ok');
  });

  it('con la boveda cerrada a mitad de los medios, se para y no da nada por bueno', async () => {
    const primero = machine();
    await primero.conversations.appendTurn(vault, A, turn('hola'));
    for (let n = 0; n < 3; n += 1) {
      await primero.media.add(vault, A, new Uint8Array([n, 1]), metadata(`f${n}.png`));
    }
    await syncVault(vault, primero.stores, deps());

    const segundo = machine();
    let descargas = 0;
    gateway.intercept = (path, _body, request) => {
      if (request.method === 'GET' && path.includes('/media/objects/')) {
        descargas += 1;
        if (descargas === 2) vault.lock('manual');
      }
      return undefined;
    };
    const result = await syncVault(vault, segundo.stores, deps());

    expect(result.stopped).toBe('locked');
    expect(result.media.downloaded).toBe(1);
    expect(segundo.media.rawRecords(A)).toHaveLength(1);
  });
});

// -----------------------------------------------------------------------------
// el alta rechazada (T2R-02)
// -----------------------------------------------------------------------------

describe('un alta de medio rechazada no cuenta como subida', () => {
  // la regla del diseño: solo cuenta como subido lo que el gateway confirma con
  // stored o duplicate. Es la misma clase de fallo que SEG-SYNC-001 («cero
  // guardados» contado como subido), y ninguna de estas ramas tenia prueba
  const rechazos: {
    nombre: string;
    status: number;
    body: unknown;
    cuenta: Partial<VaultSyncMediaReport>;
    error: RegExp | null;
  }[] = [
    {
      nombre: '404, la conversacion es de otra cuenta',
      status: 404,
      body: { error: 'esa conversacion no existe' },
      cuenta: { failed: 1, waiting: 0, skipped: 0 },
      error: /otra cuenta/,
    },
    {
      nombre: '409 object-missing',
      status: 409,
      body: { error: 'faltan los bytes', reason: 'object-missing' },
      cuenta: { failed: 1, waiting: 0, skipped: 0 },
      error: /no encuentra los bytes/,
    },
    {
      nombre: '409 conflict',
      status: 409,
      body: { error: 'esa clave la usa otro', reason: 'conflict' },
      cuenta: { failed: 1, waiting: 0, skipped: 0 },
      error: /ya la usa otro/,
    },
    {
      nombre: '409 space',
      status: 409,
      body: { error: 'es un espacio', reason: 'space' },
      cuenta: { failed: 1, waiting: 0, skipped: 0 },
      error: /otra cosa con el identificador/,
    },
    {
      // con onServer por delante ya no se alcanza en una pasada normal: una
      // conversacion que desaparece del servidor entre la lista y el alta
      nombre: '409 conversation-missing',
      status: 409,
      body: { error: 'falta la conversacion', reason: 'conversation-missing' },
      cuenta: { failed: 0, waiting: 1, skipped: 0 },
      error: null,
    },
    {
      nombre: '413 en el alta',
      status: 413,
      body: { error: 'el envio pesa demasiado' },
      cuenta: { failed: 0, waiting: 0, skipped: 1 },
      error: null,
    },
  ];

  for (const rechazo of rechazos) {
    it(`${rechazo.nombre}: lo cuenta como lo que es y no como subido`, async () => {
      const equipo = machine();
      await equipo.conversations.appendTurn(vault, A, turn('hola'));
      await equipo.media.add(vault, A, new Uint8Array([1, 2, 3]), metadata('foto.png'));
      gateway.intercept = (path) =>
        path.endsWith('/v2/media/push') ? Response.json(rechazo.body, { status: rechazo.status }) : undefined;

      const result = await syncVault(vault, equipo.stores, deps());

      expect(result.media).toMatchObject({ uploaded: 0, alreadyThere: 0, ...rechazo.cuenta });
      if (rechazo.error === null) expect(result.media.error).toBeNull();
      else expect(result.media.error).toMatch(rechazo.error);
      // los bytes subieron antes del alta, pero el servidor no tiene el medio
      expect(puts()).toBe(1);
      expect(gateway.media()).toEqual([]);
    });
  }

  it('un 409 con un motivo que no conoce es una respuesta invalida, no un «subido»', async () => {
    const equipo = machine();
    await equipo.conversations.appendTurn(vault, A, turn('hola'));
    await equipo.media.add(vault, A, new Uint8Array([1, 2, 3]), metadata('foto.png'));
    gateway.intercept = (path) =>
      path.endsWith('/v2/media/push')
        ? Response.json({ error: 'x', reason: 'otra-cosa' }, { status: 409 })
        : undefined;

    const result = await syncVault(vault, equipo.stores, deps());

    expect(result.media).toMatchObject({ uploaded: 0, failed: 1 });
  });
});
