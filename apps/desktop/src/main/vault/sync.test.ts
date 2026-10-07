// pruebas de la sincronizacion de turnos, protocolo v2 (SYNC-F1-06).
//
// Contra el gateway DE VERDAD y un Supabase falso con semantica de Postgres
// (`sync-gateway.fixture.ts`): fechas con «+00:00» y la fraccion recortada,
// INSERT atomico con 409, paginas con limite. Las 84 pruebas de la v1 pasaban
// con los tres fallos de SEG-SYNC-001 dentro porque su gateway falso respondia
// lo que el cliente esperaba. Estas no: si el cliente se equivoca de contrato,
// el Worker se lo dice.
//
// Lo que se comprueba de verdad es que lo que sube un equipo se puede ABRIR en
// otro: contar subidas no demuestra nada.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openText, type SealedEnvelope } from '@luxy/vault-crypto';
import type { PrivateRecord } from '@luxy/shared';
import { VaultService, VaultError, type DeviceKeyStore } from './vault-service.js';
import { vaultFilePathFor } from './key-file.js';
import { PrivateConversationStore, conversationsDirectory } from './conversation-store.js';
import { PrivateMediaStore, mediaIndexDirectory } from './media-store.js';
import { LocalBlobStore, mediaDirectory } from './blob-store.js';
import { SyncStateStore, syncStateFilePath } from './sync-state-store.js';
import { SyncDeletedStore, syncDeletedFilePath } from './sync-deleted-store.js';
import { SyncAnchorStore, syncAnchorFilePath } from './sync-anchor-store.js';
import { sealTurn } from './private-store.js';
import { syncVault, type SyncPart, type VaultSyncDeps, type VaultSyncStores } from './sync.js';
import { TEST_TOKEN, TEST_USER, startTestGateway, type TestGateway } from './sync-gateway.fixture.js';

const PASSWORD = 'una frase larga de prueba';
const FAST = { t: 1, m: 8 * 1024, p: 1 } as const;
const SECRETO = 'un secreto que no debe viajar en claro';

/** ids de conversacion deterministas, en minusculas como los de randomUUID */
const conv = (n: number): string => `${n.toString(16).padStart(8, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;

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

const turn = (text: string) => ({
  role: 'user' as const,
  text,
  title: 'Titulo revelador',
  provider: null,
  model: null,
  inputTokens: null,
  outputTokens: null,
});

interface Machine {
  directory: string;
  conversations: PrivateConversationStore;
  media: PrivateMediaStore;
  state: SyncStateStore;
  deleted: SyncDeletedStore;
  anchor: SyncAnchorStore;
  stores: VaultSyncStores;
}

let root: string;
let vault: VaultService;
let gateway: TestGateway;
let machines = 0;

function machine(): Machine {
  machines += 1;
  const directory = join(root, `equipo-${machines}`);
  mkdirSync(directory, { recursive: true });
  const conversations = new PrivateConversationStore(conversationsDirectory(directory));
  const media = new PrivateMediaStore(
    mediaIndexDirectory(directory),
    new LocalBlobStore(mediaDirectory(directory)),
  );
  const state = new SyncStateStore(syncStateFilePath(directory));
  const deleted = new SyncDeletedStore(syncDeletedFilePath(directory));
  const anchor = new SyncAnchorStore(syncAnchorFilePath(directory));
  return {
    directory,
    conversations,
    media,
    state,
    deleted,
    anchor,
    stores: { conversations, media, state, deleted, anchor },
  };
}

function deps(extra: Partial<VaultSyncDeps> = {}): VaultSyncDeps {
  return {
    gatewayUrl: 'https://gateway.test',
    sessionToken: TEST_TOKEN,
    fetchImpl: gateway.fetchImpl,
    ...extra,
  };
}

/** sella `count` turnos de una conversacion y los escribe de una vez */
async function seed(target: Machine, conversationId: string, count: number, prefix = 't'): Promise<PrivateRecord[]> {
  const records: PrivateRecord[] = [];
  for (let sequence = 0; sequence < count; sequence += 1) {
    records.push(
      await sealTurn(vault, { conversationId, sequence, turn: turn(`${prefix}${sequence}`) }),
    );
  }
  writeLines(target, conversationId, records);
  return records;
}

function writeLines(target: Machine, conversationId: string, records: readonly PrivateRecord[]): void {
  const directory = conversationsDirectory(target.directory);
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, `${conversationId}.jsonl`),
    records.map((record) => `${JSON.stringify(record)}\n`).join(''),
    'utf8',
  );
}

function rawLines(target: Machine, conversationId: string): string[] {
  return readFileSync(join(conversationsDirectory(target.directory), `${conversationId}.jsonl`), 'utf8')
    .split('\n')
    .filter((line) => line.length > 0);
}

function report(result: Awaited<ReturnType<typeof syncVault>>, conversationId: string) {
  const found = result.conversations.find((entry) => entry.conversationId === conversationId);
  if (found === undefined) throw new Error(`no hay informe de ${conversationId}`);
  return found;
}

/**
 * mete en el servidor, sin pasar por el gateway, lo que habria subido otro
 * equipo: la conversacion (si falta) y esos turnos, tal cual
 */
function sembrar(records: readonly PrivateRecord[], owner = TEST_USER): void {
  for (const record of records) {
    const existe = gateway.fake
      .rows('vault_conversations')
      .some((row) => row.conversation_id === record.conversationId);
    if (!existe) {
      gateway.fake.seed('vault_conversations', [
        { conversation_id: record.conversationId, owner_user_id: owner },
      ]);
    }
    gateway.fake.seed('vault_records', [
      {
        record_id: record.recordId,
        owner_user_id: owner,
        conversation_id: record.conversationId,
        sequence: record.sequence,
        content: record.content,
        sealed_memory: record.sealedMemory ?? null,
        created_at: record.createdAt,
      },
    ]);
  }
}

/** las subidas de turnos que llegaron al gateway: cuantos registros y como acabo */
function subidas(): { records: number; status: number }[] {
  return gateway.calls
    .filter((call) => call.path.endsWith('/records/push'))
    .map((call) => ({
      records: ((call.body as { records?: unknown[] } | null)?.records ?? []).length,
      status: call.status,
    }));
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'luxy-sync-v2-'));
  vault = new VaultService(vaultFilePathFor(root), memoryDeviceKeys(), { argon2Params: FAST });
  await vault.create(PASSWORD);
  gateway = await startTestGateway();
  machines = 0;
});

afterEach(() => {
  gateway.stop();
  rmSync(root, { recursive: true, force: true });
});

describe('sincronizacion v2: copia y vuelta', () => {
  it('22 conversaciones, una de 450 turnos: sube todo, otro equipo lo baja y lo ABRE', async () => {
    const origen = machine();
    await seed(origen, conv(1), 450, 'largo');
    for (let n = 2; n <= 22; n += 1) await seed(origen, conv(n), 3, `c${n}-`);

    const subida = await syncVault(vault, origen.stores, deps());
    expect(subida.stopped).toBeNull();
    expect(subida.uploaded).toBe(450 + 21 * 3);
    expect(subida.conversations.every((entry) => entry.status === 'ok')).toBe(true);
    expect(report(subida, conv(1))).toMatchObject({ local: 450, server: 450, uploaded: 450 });
    expect(gateway.records()).toHaveLength(450 + 21 * 3);

    // el segundo equipo: otra carpeta, la MISMA llave
    const copia = machine();
    const bajada = await syncVault(vault, copia.stores, deps());
    expect(bajada.stopped).toBeNull();
    expect(bajada.downloaded).toBe(450 + 21 * 3);
    expect(report(bajada, conv(1))).toMatchObject({ local: 450, server: 450, downloaded: 450 });

    // contar no demuestra nada: lo bajado se abre y es lo mismo
    const leido = await copia.conversations.read(vault, conv(1));
    expect(leido).toHaveLength(450);
    expect(leido[449]?.text).toBe('largo449');
    expect(leido.map((t) => t.sequence)).toEqual(Array.from({ length: 450 }, (_v, i) => i));
  });

  it('la segunda pasada sube 0 y baja 0, en los dos equipos', async () => {
    const origen = machine();
    await seed(origen, conv(1), 5);
    await seed(origen, conv(2), 3);
    await syncVault(vault, origen.stores, deps());
    const copia = machine();
    await syncVault(vault, copia.stores, deps());

    for (const equipo of [origen, copia]) {
      const otra = await syncVault(vault, equipo.stores, deps());
      expect(otra).toMatchObject({ stopped: null, uploaded: 0, downloaded: 0 });
      expect(otra.conversations.map((entry) => entry.status)).toEqual(['ok', 'ok']);
      // y ninguna subida: lo que ya esta no se vuelve a mandar
      expect(otra.conversations.every((entry) => entry.local === entry.server)).toBe(true);
    }
    expect(rawLines(copia, conv(1))).toHaveLength(5);
  });

  it('las fechas vuelven byte a byte aunque Postgres las devuelva con +00:00', async () => {
    const origen = machine();
    const sellados = await seed(origen, conv(1), 4);
    await syncVault(vault, origen.stores, deps());

    const copia = machine();
    const bajada = await syncVault(vault, copia.stores, deps());
    expect(bajada.downloaded).toBe(4);

    // la atadura de D-108 compara createdAt exacto: tiene que ser la misma cadena
    const llegados = copia.conversations.rawRecords(conv(1));
    expect(llegados.map((r) => r.createdAt)).toEqual(sellados.map((r) => r.createdAt));
    expect(llegados.map((r) => r.recordId)).toEqual(sellados.map((r) => r.recordId));
  });

  it('lo que viaja va cifrado: ni el texto ni el titulo salen en ninguna peticion', async () => {
    const origen = machine();
    await origen.conversations.appendTurn(vault, conv(1), turn(SECRETO));
    await syncVault(vault, origen.stores, deps());

    const enviado = JSON.stringify(gateway.calls.map((call) => call.body));
    expect(enviado).not.toContain(SECRETO);
    expect(enviado).not.toContain('Titulo revelador');
    expect(enviado).not.toContain(PASSWORD);
  });

  it('el estado de la sincronizacion no guarda contenido', async () => {
    const origen = machine();
    await origen.conversations.appendTurn(vault, conv(1), turn(SECRETO));
    await syncVault(vault, origen.stores, deps());

    const file = syncStateFilePath(origen.directory);
    expect(readFileSync(file, 'utf8')).not.toContain(SECRETO);
    const sobre = JSON.parse(readFileSync(file, 'utf8')) as { content: SealedEnvelope };
    const texto = await openText(vault.subkeyFor('identity', 'sync-state'), 'vault.identity', sobre.content);
    expect(texto).not.toContain(SECRETO);
    expect(texto).not.toContain('Titulo revelador');
    expect(JSON.parse(texto)).toMatchObject({ conversations: { [conv(1)]: { frozen: false, uploaded: 1 } } });
  });

  it('pagina el manifiesto y la lista cuando el servidor anuncia paginas pequeñas', async () => {
    gateway.rewrite = (path, status, body) => {
      if (path !== '/api/vault/v2/capabilities' || status !== 200) return body;
      const caps = body as { limits: Record<string, number> };
      return { ...caps, limits: { ...caps.limits, manifestMaxPage: 7, conversationsMaxPage: 2 } };
    };
    const origen = machine();
    await seed(origen, conv(1), 30);
    for (let n = 2; n <= 5; n += 1) await seed(origen, conv(n), 1);
    await syncVault(vault, origen.stores, deps());

    const copia = machine();
    const bajada = await syncVault(vault, copia.stores, deps());
    expect(bajada.downloaded).toBe(34);
    expect(gateway.calls.filter((c) => c.path.endsWith('/conversations/list')).length).toBeGreaterThan(2);
    expect(rawLines(copia, conv(1))).toHaveLength(30);
  });
});

describe('sincronizacion v2: reglas de seguridad', () => {
  it('un 500 en una conversacion no para las demas ni los medios', async () => {
    const origen = machine();
    await seed(origen, conv(1), 2);
    await seed(origen, conv(2), 2);
    await seed(origen, conv(3), 2);
    await origen.media.add(vault, conv(3), new Uint8Array([1, 2, 3]), {
      mimeType: 'image/png',
      displayName: 'foto.png',
      prompt: null,
      width: 1,
      height: 1,
      durationMs: null,
      characterId: null,
      provider: null,
      model: null,
    });
    // la primera consulta a Supabase sobre la conversacion 2 revienta con un
    // 500 de Postgres; el gateway lo convierte en 502
    gateway.fake.failNext(
      (info) => info.kind === 'rest' && info.method === 'GET' && info.url.includes(conv(2)),
      500,
      '{"code":"XX000","message":"boom"}',
    );

    const result = await syncVault(vault, origen.stores, deps());

    expect(result.stopped).toBeNull();
    expect(report(result, conv(1)).status).toBe('ok');
    expect(report(result, conv(2))).toMatchObject({ status: 'failed', uploaded: 0 });
    expect(report(result, conv(2)).error).toContain('502');
    expect(report(result, conv(3)).status).toBe('ok');
    expect(result.media).toMatchObject({ reached: true, uploaded: 1, failed: 0 });

    // la siguiente pasada sube lo que falto
    const otra = await syncVault(vault, origen.stores, deps());
    expect(report(otra, conv(2))).toMatchObject({ status: 'ok', uploaded: 2 });
  });

  it('la misma secuencia con otro recordId congela SOLO esa conversacion y no borra nada', async () => {
    const origen = machine();
    await seed(origen, conv(1), 2, 'de-origen');
    await seed(origen, conv(2), 2);
    await syncVault(vault, origen.stores, deps());

    // el otro equipo escribio en la misma conversacion sin haberla bajado
    const otro = machine();
    await seed(otro, conv(1), 3, 'del-otro');
    const antes = rawLines(otro, conv(1));

    const result = await syncVault(vault, otro.stores, deps());

    expect(report(result, conv(1))).toMatchObject({ status: 'frozen', uploaded: 0, downloaded: 0 });
    expect(report(result, conv(2))).toMatchObject({ status: 'ok', downloaded: 2 });
    // nada se toca a ningun lado
    expect(rawLines(otro, conv(1))).toEqual(antes);
    expect(gateway.records().filter((r) => r.conversationId === conv(1))).toHaveLength(2);

    // y sigue congelada: la siguiente pasada ni pregunta por ella
    gateway.calls.length = 0;
    const otra = await syncVault(vault, otro.stores, deps());
    expect(report(otra, conv(1)).status).toBe('frozen');
    expect(JSON.stringify(gateway.calls.map((c) => c.body))).not.toContain(conv(1));
  });

  it('rechaza un registro que el servidor devuelve como de otra conversacion', async () => {
    const origen = machine();
    await seed(origen, conv(1), 3);
    await seed(origen, conv(2), 1);
    await syncVault(vault, origen.stores, deps());

    gateway.rewrite = (path, status, body) => {
      if (!path.endsWith('/records/fetch') || status !== 200) return body;
      const rows = body as { conversationId: string; sequence: number }[];
      return rows.map((row) =>
        row.conversationId === conv(1) && row.sequence === 1 ? { ...row, conversationId: conv(2) } : row,
      );
    };
    const copia = machine();
    const result = await syncVault(vault, copia.stores, deps());

    const informe = report(result, conv(1));
    expect(informe.status).toBe('failed');
    expect(informe.error).toContain('otra conversacion');
    // lo anterior al malo se guarda y lo de detras no: sin huecos
    expect(copia.conversations.rawRecords(conv(1)).map((r) => r.sequence)).toEqual([0]);
    expect(report(result, conv(2)).status).toBe('ok');
  });

  it('un registro que esta boveda no puede abrir detiene la conversacion sin dejar hueco', async () => {
    const origen = machine();
    await seed(origen, conv(1), 5);
    await syncVault(vault, origen.stores, deps());

    gateway.rewrite = (path, status, body) => {
      if (!path.endsWith('/records/fetch') || status !== 200) return body;
      const rows = body as { sequence: number; content: { ciphertext: string } }[];
      return rows.map((row) =>
        row.sequence === 3 ? { ...row, content: { ...row.content, ciphertext: `${row.content.ciphertext.slice(0, -4)}AAAA` } } : row,
      );
    };
    const copia = machine();
    const result = await syncVault(vault, copia.stores, deps());

    expect(report(result, conv(1))).toMatchObject({ status: 'failed', unopenable: 1, downloaded: 3 });
    expect(copia.conversations.rawRecords(conv(1)).map((r) => r.sequence)).toEqual([0, 1, 2]);
  });

  it('una conversacion borrada en este equipo no resucita', async () => {
    const origen = machine();
    await seed(origen, conv(1), 2);
    await seed(origen, conv(2), 2);
    await syncVault(vault, origen.stores, deps());

    // borrar: la lapida PRIMERO, despues el archivo
    origen.deleted.add(conv(1));
    origen.conversations.delete(conv(1));

    gateway.calls.length = 0;
    const result = await syncVault(vault, origen.stores, deps());

    expect(result.deletedStillOnServer).toBe(1);
    expect(result.conversations.map((entry) => entry.conversationId)).toEqual([conv(2)]);
    expect(origen.conversations.listConversationIds()).toEqual([conv(2)]);
    // ni se pidio: su id no viaja
    expect(JSON.stringify(gateway.calls.map((c) => c.body))).not.toContain(conv(1));
    // la copia del servidor se queda hasta F2
    expect(gateway.records().filter((r) => r.conversationId === conv(1))).toHaveLength(2);
  });

  it('con la boveda cerrada a mitad, la pasada queda interrumpida y no se da por buena', async () => {
    const origen = machine();
    for (let n = 1; n <= 4; n += 1) await seed(origen, conv(n), 2);
    let subidas = 0;
    gateway.intercept = (path) => {
      // Daniel cierra la boveda mientras sube la segunda conversacion
      if (path.endsWith('/records/push')) {
        subidas += 1;
        if (subidas === 2) vault.lock('manual');
      }
      return undefined;
    };

    const result = await syncVault(vault, origen.stores, deps());

    expect(result.stopped).toBe('locked');
    expect(result.conversations.map((entry) => entry.status)).toEqual([
      'ok',
      'interrupted',
      'not-reached',
      'not-reached',
    ]);
    expect(result.media.reached).toBe(false);
    // lo bajado o subido antes del cierre se queda; lo demas, en la siguiente
    await vault.unlock(PASSWORD);
    gateway.intercept = null;
    const siguiente = await syncVault(vault, origen.stores, deps());
    expect(siguiente.stopped).toBeNull();
    expect(siguiente.conversations.every((entry) => entry.status === 'ok')).toBe(true);
    expect(gateway.records()).toHaveLength(8);
  });

  it('con un gateway viejo (404 en capabilities) no se sube nada', async () => {
    const origen = machine();
    await seed(origen, conv(1), 2);
    gateway.intercept = (path) =>
      path.endsWith('/v2/capabilities') ? Response.json({ error: 'ruta desconocida' }, { status: 404 }) : undefined;

    const result = await syncVault(vault, origen.stores, deps());

    expect(result.stopped).toBe('gateway-outdated');
    expect(result.stoppedDetail).toContain('actualizar');
    expect(gateway.calls.map((c) => c.path)).toEqual(['/api/vault/v2/capabilities']);
    expect(gateway.records()).toHaveLength(0);
  });

  it('un protocolo que este Studio no conoce tampoco sincroniza', async () => {
    const origen = machine();
    await seed(origen, conv(1), 1);
    gateway.rewrite = (path, _status, body) =>
      path.endsWith('/v2/capabilities') ? { ...(body as object), protocol: 3 } : body;

    const result = await syncVault(vault, origen.stores, deps());
    expect(result.stopped).toBe('gateway-protocol');
    expect(gateway.records()).toHaveLength(0);
  });

  it('se rellena un hueco local desde el servidor', async () => {
    const origen = machine();
    const sellados = await seed(origen, conv(1), 5);
    await syncVault(vault, origen.stores, deps());

    const otro = machine();
    // tiene todos menos el 2
    writeLines(otro, conv(1), sellados.filter((r) => r.sequence !== 2));
    const result = await syncVault(vault, otro.stores, deps());

    expect(report(result, conv(1))).toMatchObject({ status: 'ok', downloaded: 1, uploaded: 0 });
    expect(otro.conversations.syncView(conv(1)).integrity.holes).toBe(0);
    expect((await otro.conversations.read(vault, conv(1))).map((t) => t.text)).toEqual([
      't0',
      't1',
      't2',
      't3',
      't4',
    ]);
  });

  it('si el servidor perdio turnos, se avisa y se vuelven a subir', async () => {
    const origen = machine();
    await seed(origen, conv(1), 5);
    await syncVault(vault, origen.stores, deps());

    // el servidor pierde los dos ultimos
    const tabla = (gateway.fake as unknown as { tables: Map<string, Record<string, unknown>[]> }).tables;
    tabla.set(
      'vault_records',
      (tabla.get('vault_records') ?? []).filter((row) => Number(row.sequence) < 3),
    );

    const result = await syncVault(vault, origen.stores, deps());

    expect(report(result, conv(1))).toMatchObject({ status: 'ok', serverLost: 2, uploaded: 2, server: 5 });
    expect(gateway.records()).toHaveLength(5);
  });

  it('la conversacion con un envio en curso se deja para la siguiente', async () => {
    const origen = machine();
    await seed(origen, conv(1), 2);
    await seed(origen, conv(2), 2);
    const result = await syncVault(
      vault,
      origen.stores,
      deps({ isBusy: (id: string, part: SyncPart) => id === conv(2) && part === 'turns' }),
    );

    expect(report(result, conv(1)).status).toBe('ok');
    expect(report(result, conv(2))).toMatchObject({ status: 'busy', uploaded: 0 });
    expect(JSON.stringify(gateway.calls.map((c) => c.body))).not.toContain(conv(2));
  });

  it('si un envio empieza mientras baja, no escribe nada detras de su mensaje', async () => {
    const origen = machine();
    await seed(origen, conv(1), 3);
    await syncVault(vault, origen.stores, deps());

    const otro = machine();
    let enviando = false;
    gateway.intercept = (path) => {
      // el envio arranca justo mientras se descargan los turnos
      if (path.endsWith('/records/fetch')) enviando = true;
      return undefined;
    };
    const result = await syncVault(vault, otro.stores, deps({ isBusy: () => enviando }));

    expect(report(result, conv(1))).toMatchObject({ status: 'busy', downloaded: 0 });
    expect(otro.conversations.listConversationIds()).toEqual([]);
  });

  it('una conversacion con secuencias repetidas aqui no se sube y se enseña con cifras', async () => {
    const origen = machine();
    const a = await seed(origen, conv(1), 2);
    const b = await sealTurn(vault, { conversationId: conv(1), sequence: 1, turn: turn('repetido') });
    writeLines(origen, conv(1), [...a, b]);
    await seed(origen, conv(2), 1);

    const result = await syncVault(vault, origen.stores, deps());

    expect(report(result, conv(1))).toMatchObject({
      status: 'local-duplicates',
      duplicateSequences: 1,
      uploaded: 0,
    });
    expect(report(result, conv(2)).status).toBe('ok');
    expect(gateway.records().filter((r) => r.conversationId === conv(1))).toHaveLength(0);
  });

  it('un turno con una forma que el contrato no admite no viaja, y se cuenta', async () => {
    const origen = machine();
    const sellados = await seed(origen, conv(1), 3);
    // una fecha sin milisegundos: valida, pero no canonica
    writeLines(origen, conv(1), [sellados[0]!, { ...sellados[1]!, createdAt: '2026-09-01T10:00:00Z' }, sellados[2]!]);

    const result = await syncVault(vault, origen.stores, deps());
    expect(report(result, conv(1))).toMatchObject({ status: 'ok', uploaded: 2, notUploadable: 1 });
  });

  it('un 401 para la pasada, olvida la sesion y explica que hacer', async () => {
    const origen = machine();
    await seed(origen, conv(1), 1);
    let olvidada = false;
    const result = await syncVault(
      vault,
      origen.stores,
      deps({
        sessionToken: 'una-sesion-que-no-existe-000000',
        onUnauthorized: () => {
          olvidada = true;
        },
      }),
    );
    expect(result.stopped).toBe('session');
    expect(olvidada).toBe(true);
    expect(gateway.records()).toHaveLength(0);
  });

  it('sin red, para tras dos fallos seguidos en vez de esperar a cada conversacion', async () => {
    const origen = machine();
    for (let n = 1; n <= 5; n += 1) await seed(origen, conv(n), 1);
    gateway.intercept = (path) => {
      if (path.endsWith('/conversations/manifest') || path.endsWith('/records/push')) {
        throw new TypeError('fetch failed');
      }
      return undefined;
    };

    const result = await syncVault(vault, origen.stores, deps());
    expect(result.stopped).toBe('unreachable');
    expect(result.conversations.map((entry) => entry.status)).toEqual([
      'failed',
      'failed',
      'not-reached',
      'not-reached',
      'not-reached',
    ]);
  });

  it('con la boveda cerrada al empezar no sincroniza ni llama a nadie', async () => {
    const origen = machine();
    vault.lock('manual');
    await expect(syncVault(vault, origen.stores, deps())).rejects.toThrow(VaultError);
    expect(gateway.calls).toHaveLength(0);
  });

  it('autoriza la sesion de la cuenta y guarda la caducidad renovada', async () => {
    const origen = machine();
    await seed(origen, conv(1), 1);
    let caducidad: string | null = null;
    const vistos: (string | null)[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      vistos.push(new Headers(init?.headers ?? {}).get('Authorization'));
      return gateway.fetchImpl(input, init);
    }) as typeof fetch;

    await syncVault(
      vault,
      origen.stores,
      deps({
        fetchImpl,
        onSessionRenewed: (expiresAt) => {
          caducidad = expiresAt;
        },
      }),
    );
    expect(vistos.every((value) => value === `Bearer ${TEST_TOKEN}`)).toBe(true);
    expect(caducidad).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    // los ids van en el cuerpo, nunca en la URL
    expect(gateway.calls.some((c) => c.path.includes(conv(1)))).toBe(false);
  });

  it('solo esta conversacion: no toca las demas', async () => {
    const origen = machine();
    await seed(origen, conv(1), 2);
    await seed(origen, conv(2), 2);

    const result = await syncVault(vault, origen.stores, deps(), {
      mode: 'conversation',
      conversationId: conv(2),
    });

    expect(result.scope).toBe('conversation');
    expect(result.conversations.map((entry) => entry.conversationId)).toEqual([conv(2)]);
    expect(gateway.records().map((r) => r.conversationId)).toEqual([conv(2), conv(2)]);
    expect(JSON.stringify(gateway.calls.map((c) => c.body))).not.toContain(conv(1));
    // y una segunda vez sube 0
    const otra = await syncVault(vault, origen.stores, deps(), {
      mode: 'conversation',
      conversationId: conv(2),
    });
    expect(report(otra, conv(2))).toMatchObject({ status: 'ok', uploaded: 0, local: 2, server: 2 });
  });
});

describe('sincronizacion v2: un servidor que recorta cada lectura (F1-R1-02)', () => {
  // PostgREST recorta a su «Max rows» (1000 por defecto) sin avisar. Aqui a
  // 20, para no sembrar mil turnos: es la misma situacion que una conversacion
  // de 1500 turnos contra el Supabase de verdad
  it('la copia baja la conversacion ENTERA, y la segunda pasada del origen no ve perdidas', async () => {
    const origen = machine();
    await seed(origen, conv(1), 30);
    await syncVault(vault, origen.stores, deps());
    gateway.fake.maxRows = 20;

    const copia = machine();
    // tandas de bajada por debajo del recorte: lo que se mide es el manifiesto
    const bajada = await syncVault(vault, copia.stores, deps({ fetchChunk: 10 }));

    // antes: 20 y «al dia», con diez turnos de menos
    expect(report(bajada, conv(1))).toMatchObject({ status: 'ok', local: 30, server: 30, downloaded: 30 });
    expect(rawLines(copia, conv(1))).toHaveLength(30);

    // y el origen no avisa de un «el servidor perdio turnos» falso ni vuelve a
    // subir lo que no veia
    gateway.calls.length = 0;
    const otra = await syncVault(vault, origen.stores, deps());
    expect(report(otra, conv(1))).toMatchObject({ status: 'ok', serverLost: 0, uploaded: 0, server: 30 });
    expect(subidas()).toEqual([]);
  });
});

describe('sincronizacion v2: cada rechazo de la subida hace lo que dice (T2)', () => {
  it('un «conflict» en la subida congela la conversacion, lo apunta y no toca el disco', async () => {
    const origen = machine();
    const [primero] = await seed(origen, conv(1), 1, 'mio');
    await syncVault(vault, origen.stores, deps());
    // aqui se escribe el turno 1; otro equipo sube SU turno 1 entre el
    // manifiesto y esta subida
    const mio = await sealTurn(vault, { conversationId: conv(1), sequence: 1, turn: turn('mio1') });
    writeLines(origen, conv(1), [primero!, mio]);
    const ajeno = await sealTurn(vault, { conversationId: conv(1), sequence: 1, turn: turn('del otro') });
    const antes = rawLines(origen, conv(1));
    gateway.calls.length = 0;
    gateway.intercept = (path) => {
      if (path.endsWith('/records/push') && subidas().length === 0) sembrar([ajeno]);
      return undefined;
    };

    const result = await syncVault(vault, origen.stores, deps());

    expect(subidas()).toEqual([{ records: 1, status: 409 }]);
    expect(report(result, conv(1))).toMatchObject({ status: 'frozen', uploaded: 0 });
    // ni se borra ni se sobreescribe nada en ningun lado
    expect(rawLines(origen, conv(1))).toEqual(antes);
    expect(
      gateway.records().filter((r) => r.conversationId === conv(1)).map((r) => r.recordId).sort(),
    ).toEqual([primero!.recordId, ajeno.recordId].sort());
    // y queda apuntada: la siguiente pasada ni pregunta
    expect((await origen.state.read(vault)).conversations[conv(1)]).toMatchObject({ frozen: true });
  });

  it('«base-mismatch»: relee el manifiesto, baja lo nuevo y sube lo suyo con la base buena', async () => {
    const origen = machine();
    const sellados = await seed(origen, conv(1), 3);
    await syncVault(vault, origen.stores, deps());
    // aqui se escribe el 4 sin tener el 3; otro equipo sube el 3 entre el
    // manifiesto y esta subida
    const cuatro = await sealTurn(vault, { conversationId: conv(1), sequence: 4, turn: turn('t4') });
    writeLines(origen, conv(1), [...sellados, cuatro]);
    const tres = await sealTurn(vault, { conversationId: conv(1), sequence: 3, turn: turn('del otro') });
    gateway.calls.length = 0;
    gateway.intercept = (path) => {
      if (path.endsWith('/records/push') && subidas().length === 0) sembrar([tres]);
      return undefined;
    };

    const result = await syncVault(vault, origen.stores, deps());

    expect(subidas()).toEqual([
      { records: 1, status: 409 },
      { records: 1, status: 200 },
    ]);
    expect(report(result, conv(1))).toMatchObject({ status: 'ok', downloaded: 1, uploaded: 1, local: 5, server: 5 });
    expect((await origen.conversations.read(vault, conv(1))).map((t) => t.text)).toEqual([
      't0',
      't1',
      't2',
      'del otro',
      't4',
    ]);
  });

  it('«base-mismatch» una y otra vez: se rinde a las tres vueltas y lo dice', async () => {
    const origen = machine();
    await seed(origen, conv(1), 2);
    gateway.intercept = (path) =>
      path.endsWith('/records/push')
        ? Response.json({ error: 'cambio', reason: 'base-mismatch' }, { status: 409 })
        : undefined;

    const result = await syncVault(vault, origen.stores, deps());

    expect(subidas()).toHaveLength(3);
    expect(report(result, conv(1))).toMatchObject({ status: 'failed', uploaded: 0 });
    expect(report(result, conv(1)).error).toContain('el servidor cambio varias veces');
  });

  it('«conversation-missing»: desaparecio del servidor a mitad y no se vuelve a crear', async () => {
    const origen = machine();
    const sellados = await seed(origen, conv(1), 2);
    await syncVault(vault, origen.stores, deps());
    const nuevo = await sealTurn(vault, { conversationId: conv(1), sequence: 2, turn: turn('t2') });
    writeLines(origen, conv(1), [...sellados, nuevo]);
    gateway.calls.length = 0;
    gateway.intercept = (path) => {
      // una purga entre el manifiesto y la subida
      if (path.endsWith('/records/push')) {
        const tablas = gateway.fake.tables;
        for (const tabla of ['vault_records', 'vault_conversations']) {
          tablas.set(tabla, (tablas.get(tabla) ?? []).filter((row) => row.conversation_id !== conv(1)));
        }
      }
      return undefined;
    };

    const result = await syncVault(vault, origen.stores, deps());

    expect(subidas()).toEqual([{ records: 1, status: 409 }]);
    expect(report(result, conv(1))).toMatchObject({ status: 'failed', uploaded: 0, server: 0 });
    expect(report(result, conv(1)).error).toContain('no se ha vuelto a crear');
    expect(gateway.fake.rows('vault_conversations')).toEqual([]);
    expect(gateway.records()).toEqual([]);
  });

  it('un 413 parte el lote en dos, y un registro suelto que no cabe no viaja y se cuenta', async () => {
    const origen = machine();
    await seed(origen, conv(1), 10);
    await seed(origen, conv(2), 1);
    let partido = false;
    gateway.intercept = (path, body) => {
      if (!path.endsWith('/records/push')) return undefined;
      const { conversationId, records } = body as { conversationId: string; records: unknown[] };
      // el calculo de bytes de Studio se quedo corto una vez
      if (conversationId === conv(1) && records.length > 1 && !partido) {
        partido = true;
        return Response.json({ error: 'pesa demasiado' }, { status: 413 });
      }
      if (conversationId === conv(2)) return Response.json({ error: 'pesa demasiado' }, { status: 413 });
      return undefined;
    };

    const result = await syncVault(vault, origen.stores, deps());

    expect(subidas().filter((s) => s.status !== 413 || s.records > 1).map((s) => s.records)).toEqual([10, 5, 5]);
    expect(report(result, conv(1))).toMatchObject({ status: 'ok', uploaded: 10, server: 10 });
    expect(report(result, conv(2))).toMatchObject({ uploaded: 0, notUploadable: 1 });
    expect(gateway.records().filter((r) => r.conversationId === conv(1))).toHaveLength(10);
  });

  it('un 409 todo «duplicate» cuenta como copiado, no como subido', async () => {
    const origen = machine();
    const sellados = await seed(origen, conv(1), 3);
    gateway.intercept = (path) => {
      // una pasada anterior lo subio y no llego a apuntarlo
      if (path.endsWith('/records/push') && subidas().length === 0) sembrar(sellados);
      return undefined;
    };

    const result = await syncVault(vault, origen.stores, deps());

    expect(subidas()).toEqual([{ records: 3, status: 409 }]);
    expect(report(result, conv(1))).toMatchObject({ status: 'ok', uploaded: 0, local: 3, server: 3 });
    expect((await origen.state.read(vault)).conversations[conv(1)]).toMatchObject({ frozen: false, uploaded: 3 });
  });

  it('«pending»: lo que habria entrado se vuelve a intentar con el manifiesto nuevo', async () => {
    const origen = machine();
    const sellados = await seed(origen, conv(1), 3);
    gateway.intercept = (path) => {
      // solo el primero estaba ya: los otros dos habrian entrado
      if (path.endsWith('/records/push') && subidas().length === 0) sembrar([sellados[0]!]);
      return undefined;
    };

    const result = await syncVault(vault, origen.stores, deps());

    expect(subidas()).toEqual([
      { records: 3, status: 409 },
      { records: 2, status: 200 },
    ]);
    expect(report(result, conv(1))).toMatchObject({ status: 'ok', uploaded: 2, server: 3 });
    expect(gateway.records().filter((r) => r.conversationId === conv(1))).toHaveLength(3);
  });

  it('un 404 (la conversacion es de otra cuenta) falla sin subir nada', async () => {
    const OTRA = '7e57a000-0000-4000-8000-000000000002';
    gateway.fake.seed('vault_users', [{ id: OTRA, email: 'otra@prueba.test', vault_id: 'B'.repeat(43) }]);
    gateway.fake.seed('vault_conversations', [{ conversation_id: conv(1), owner_user_id: OTRA }]);
    const origen = machine();
    await seed(origen, conv(1), 2);

    const result = await syncVault(vault, origen.stores, deps());

    expect(subidas()).toEqual([{ records: 2, status: 404 }]);
    expect(report(result, conv(1))).toMatchObject({ status: 'failed', uploaded: 0 });
    expect(report(result, conv(1)).error).toContain('otra cuenta');
    expect(gateway.records()).toEqual([]);
  });

  it('«space»: ese id guarda hechos y no se le suben turnos', async () => {
    gateway.fake.seed('vault_conversations', [{ conversation_id: conv(1), owner_user_id: TEST_USER }]);
    gateway.fake.seed('vault_records', [
      {
        record_id: '7e57a000-0000-4000-8000-0000000000f1',
        owner_user_id: TEST_USER,
        conversation_id: conv(1),
        sequence: 1_000_000_000,
        content: { version: 1, purpose: 'vault.fact', nonce: 'QLBVV_RjvTFFlpRx', ciphertext: 'hecho' },
      },
    ]);
    const origen = machine();
    await seed(origen, conv(1), 2);

    const result = await syncVault(vault, origen.stores, deps());

    expect(subidas()).toEqual([{ records: 2, status: 409 }]);
    expect(report(result, conv(1))).toMatchObject({ status: 'failed', uploaded: 0 });
    expect(report(result, conv(1)).error).toContain('otra cosa con este identificador');
    expect(gateway.records()).toHaveLength(1);
  });
});

describe('el papel de cada equipo', () => {
  it('un equipo nuevo sin nada propio, con el servidor lleno, es una replica', async () => {
    const origen = machine();
    await seed(origen, conv(1), 2);
    const primero = await syncVault(vault, origen.stores, deps());
    expect(primero.role).toBe('origin');

    const nuevo = machine();
    const segundo = await syncVault(vault, nuevo.stores, deps());
    expect(segundo.role).toBe('replica');
    expect((await nuevo.state.read(vault)).role).toBe('replica');

    // y lo sigue siendo aunque ya tenga conversaciones bajadas
    const otra = await syncVault(vault, nuevo.stores, deps());
    expect(otra.role).toBe('replica');
  });

  it('el de siempre sigue siendo origen aunque el servidor tenga una que aqui se borro', async () => {
    // la v1 llego a subir conversaciones que despues se borraron aqui: con la
    // regla literal, este equipo quedaria como replica y Privado no enviaria
    const otro = machine();
    await seed(otro, conv(9), 1);
    await syncVault(vault, otro.stores, deps());

    const deSiempre = machine();
    await seed(deSiempre, conv(1), 3);
    const result = await syncVault(vault, deSiempre.stores, deps());
    expect(result.role).toBe('origin');
  });

  it('sin nada a ningun lado no se decide todavia', async () => {
    const vacio = machine();
    const result = await syncVault(vault, vacio.stores, deps());
    expect(result.role).toBeNull();
  });

  it('el que entro en la cuenta con la carpeta vacia es replica aunque tenga algo propio (F1-R1-01)', async () => {
    const origen = machine();
    await seed(origen, conv(1), 2);
    await syncVault(vault, origen.stores, deps());

    // el segundo ordenador entro en la cuenta (eso apunta el ancla) y algo se
    // escribio antes de su primera pasada. Antes, con una sola conversacion
    // propia, quedaba como origen y podia seguir las del otro sin las fichas
    const nuevo = machine();
    nuevo.anchor.record('replica', 'account-login');
    await seed(nuevo, conv(5), 1);

    const result = await syncVault(vault, nuevo.stores, deps());
    expect(result.role).toBe('replica');
    expect((await nuevo.state.read(vault)).role).toBe('replica');
  });

  it('una replica que pierde su estado sellado sigue siendo replica (F1-R1-01)', async () => {
    const origen = machine();
    await seed(origen, conv(1), 2);
    await syncVault(vault, origen.stores, deps());
    const nuevo = machine();
    expect((await syncVault(vault, nuevo.stores, deps())).role).toBe('replica');
    // el papel queda tambien en el ancla, sin sellar
    expect(nuevo.anchor.read()).toEqual({ kind: 'role', role: 'replica' });

    // el estado sellado se pierde (ilegible, borrado): antes se volvia a decidir
    // y, con las conversaciones ya bajadas, salia origen
    rmSync(syncStateFilePath(nuevo.directory));
    const otra = await syncVault(vault, nuevo.stores, deps());
    expect(otra.role).toBe('replica');
    expect((await nuevo.state.read(vault)).role).toBe('replica');
  });

  it('el de siempre queda apuntado como origen tambien en el ancla', async () => {
    const deSiempre = machine();
    await seed(deSiempre, conv(1), 3);
    const result = await syncVault(vault, deSiempre.stores, deps());
    expect(result.role).toBe('origin');
    expect(deSiempre.anchor.read()).toEqual({ kind: 'role', role: 'origin' });
  });
});

describe('fechas de una conversacion con turnos de otra boveda', () => {
  it('un registro de otra boveda no entra', async () => {
    const otraCarpeta = mkdtempSync(join(tmpdir(), 'luxy-otra-'));
    try {
      const otraVault = new VaultService(vaultFilePathFor(otraCarpeta), memoryDeviceKeys(), {
        argon2Params: FAST,
      });
      await otraVault.create('otra frase larga distinta');
      const ajeno = await sealTurn(otraVault, { conversationId: conv(1), sequence: 0, turn: turn('de otra') });
      const origen = machine();
      writeLines(origen, conv(1), [ajeno]);
      await syncVault(vault, origen.stores, deps());

      const copia = machine();
      const result = await syncVault(vault, copia.stores, deps());
      expect(report(result, conv(1))).toMatchObject({ status: 'failed', unopenable: 1, downloaded: 0 });
      expect(copia.conversations.listConversationIds()).toEqual([]);
    } finally {
      rmSync(otraCarpeta, { recursive: true, force: true });
    }
  });
});
