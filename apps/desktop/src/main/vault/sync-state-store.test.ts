// estado de la sincronizacion y lapidas locales (SYNC-F1-05).
//
// Lo que se fija: que el estado no guarda contenido, que un archivo ilegible se
// borra y se empieza de cero SIN tocar nada con la boveda cerrada, y que la
// lapida se apunta sin la llave, a disco, antes de borrar nada.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import type * as NodeFs from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { openText, type SealedEnvelope } from '@luxy/vault-crypto';
import { VaultService, VaultError, type DeviceKeyStore } from './vault-service.js';
import { vaultFilePathFor } from './key-file.js';
import { SyncStateStore, syncStateFilePath } from './sync-state-store.js';
import { SyncDeletedStore, syncDeletedFilePath } from './sync-deleted-store.js';

const fsCalls = vi.hoisted(() => [] as string[]);
/** fallos de E/S a la carta: el codigo de error con que fallara la proxima llamada */
const fsFailures = vi.hoisted(() => ({ read: null as string | null, unlink: null as string | null }));
function ioError(code: string): Error {
  return Object.assign(new Error(`${code}: recurso ocupado`), { code });
}
vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof NodeFs>();
  return {
    ...real,
    default: real,
    fsyncSync: (descriptor: number) => {
      fsCalls.push('fsync');
      real.fsyncSync(descriptor);
    },
    renameSync: (from: NodeFs.PathLike, to: NodeFs.PathLike) => {
      fsCalls.push('rename');
      real.renameSync(from, to);
    },
    readFileSync: ((...args: Parameters<typeof real.readFileSync>) => {
      const code = fsFailures.read;
      if (code !== null && String(args[0]).endsWith('sync-state.json')) {
        fsFailures.read = null;
        throw ioError(code);
      }
      return real.readFileSync(...args);
    }) as typeof real.readFileSync,
    unlinkSync: (path: NodeFs.PathLike) => {
      const code = fsFailures.unlink;
      if (code !== null) {
        fsFailures.unlink = null;
        throw ioError(code);
      }
      real.unlinkSync(path);
    },
  };
});

const PASSWORD = 'una frase larga de prueba';
const FAST = { t: 1, m: 8 * 1024, p: 1 } as const;
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const DEVICE = '99999999-9999-4999-8999-999999999999';

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

async function abrir(directory: string): Promise<VaultService> {
  const vault = new VaultService(vaultFilePathFor(directory), memoryDeviceKeys(), {
    argon2Params: FAST,
  });
  await vault.create(PASSWORD);
  return vault;
}

describe('estado de la sincronizacion', () => {
  let directory: string;
  let vault: VaultService;
  let file: string;
  let resets: number;
  let store: SyncStateStore;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'luxy-sync-state-'));
    vault = await abrir(directory);
    file = syncStateFilePath(directory);
    resets = 0;
    store = new SyncStateStore(file, {
      newDeviceId: () => DEVICE,
      onReset: () => {
        resets += 1;
      },
    });
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('sin archivo empieza de cero, y lo guardado se vuelve a leer', async () => {
    expect(await store.read(vault)).toEqual({
      v: 1,
      deviceId: DEVICE,
      role: null,
      factsBootstrapped: false,
      autoSync: false,
      conversations: {},
    });

    await store.update(vault, (s) => ({
      ...s,
      role: 'origin',
      conversations: { [A]: { frozen: true, uploaded: 3 } },
    }));

    const otro = new SyncStateStore(file, { newDeviceId: () => 'no-se-usa' });
    expect(await otro.read(vault)).toMatchObject({
      deviceId: DEVICE,
      role: 'origin',
      conversations: { [A]: { frozen: true, uploaded: 3 } },
    });
  });

  it('va sellado y se escribe con fsync antes del rename', async () => {
    fsCalls.length = 0;
    await store.update(vault, (s) => ({
      ...s,
      conversations: { [A]: { frozen: false, uploaded: 1 } },
    }));
    expect(fsCalls).toEqual(['fsync', 'rename']);
    // en disco no se ve ni el identificador de la conversacion
    expect(readFileSync(file, 'utf8')).not.toContain(A);
  });

  it('NO GUARDA CONTENIDO: un campo de mas no entra', async () => {
    // el esquema es estricto: no hay sitio donde meter un titulo o un texto
    await expect(
      store.update(vault, (s) => ({ ...s, title: 'un titulo secreto' }) as typeof s),
    ).rejects.toThrow();
    await expect(
      store.update(vault, (s) => ({
        ...s,
        conversations: { [A]: { frozen: false, uploaded: 1, text: 'hola' } as never },
      })),
    ).rejects.toThrow();
    expect(existsSync(file)).toBe(false);
  });

  it('con un archivo ilegible se empieza de cero y el archivo se borra', async () => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, '{ esto no se entiende', 'utf8');

    expect(await store.read(vault)).toMatchObject({ deviceId: DEVICE, conversations: {} });
    expect(existsSync(file)).toBe(false);
    expect(resets).toBe(1);
  });

  it('el de otra boveda tambien cuenta como ilegible', async () => {
    const otraCarpeta = mkdtempSync(join(tmpdir(), 'luxy-sync-state-otra-'));
    try {
      const otra = await abrir(otraCarpeta);
      await new SyncStateStore(file, { newDeviceId: () => DEVICE }).update(otra, (s) => ({
        ...s,
        role: 'replica',
      }));

      expect(await store.read(vault)).toMatchObject({ role: null });
      expect(resets).toBe(1);
    } finally {
      rmSync(otraCarpeta, { recursive: true, force: true });
    }
  });

  it('un fallo de E/S al leerlo NO es «no abre»: no se borra ni se empieza de cero (F1-R1-01)', async () => {
    // un EBUSY de un antivirus en Windows. Antes se tomaba por ilegible, se
    // borraba, y con el archivo se iba el papel: una replica volvia a decidirse
    await store.update(vault, (s) => ({ ...s, role: 'replica' }));
    const antes = readFileSync(file, 'utf8');

    fsFailures.read = 'EBUSY';
    await expect(store.read(vault)).rejects.toThrow('EBUSY');

    expect(readFileSync(file, 'utf8')).toBe(antes);
    expect(resets).toBe(0);
    // pasado el fallo, se lee lo de siempre
    expect(await store.read(vault)).toMatchObject({ role: 'replica' });
  });

  it('si un archivo ilegible ni siquiera se puede borrar, se lanza en vez de fingir uno nuevo', async () => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, '{ esto no se entiende', 'utf8');

    fsFailures.unlink = 'EPERM';
    await expect(store.read(vault)).rejects.toThrow('EPERM');
    expect(resets).toBe(0);
    expect(existsSync(file)).toBe(true);
  });

  it('con la boveda cerrada no se borra nada', async () => {
    await store.update(vault, (s) => ({ ...s, role: 'origin' }));
    const antes = readFileSync(file, 'utf8');
    vault.lock('manual');

    await expect(store.read(vault)).rejects.toThrow(VaultError);
    expect(readFileSync(file, 'utf8')).toBe(antes);
    expect(resets).toBe(0);
  });

  it('borrar una conversacion purga sus entradas', async () => {
    await store.update(vault, (s) => ({
      ...s,
      conversations: {
        [A]: { frozen: true, uploaded: 2 },
        [B]: { frozen: false, uploaded: 5 },
      },
    }));

    await store.removeConversation(vault, A);

    const estado = await store.read(vault);
    expect(Object.keys(estado.conversations)).toEqual([B]);
    // y dentro del sobre tampoco queda
    const sobre = JSON.parse(readFileSync(file, 'utf8')) as { content: SealedEnvelope };
    const texto = await openText(
      vault.subkeyFor('identity', 'sync-state'),
      'vault.identity',
      sobre.content,
    );
    expect(texto).not.toContain(A);
  });
});

describe('lapidas locales', () => {
  let directory: string;
  let file: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'luxy-sync-deleted-'));
    file = syncDeletedFilePath(directory);
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('se escribe sin la llave: ni siquiera hay boveda', () => {
    const store = new SyncDeletedStore(file);
    store.add(A, new Date('2026-10-07T10:00:00.000Z'));

    expect(store.has(A)).toBe(true);
    expect(store.has(B)).toBe(false);
    expect(store.list()).toEqual([{ conversationId: A, deletedAt: '2026-10-07T10:00:00.000Z' }]);
  });

  it('se escribe con la boveda cerrada', async () => {
    const vault = await abrir(directory);
    vault.lock('manual');
    const store = new SyncDeletedStore(file);
    store.add(A);
    expect(new SyncDeletedStore(file).has(A)).toBe(true);
  });

  it('apuntar dos veces no duplica', () => {
    const store = new SyncDeletedStore(file);
    store.add(A);
    store.add(A.toUpperCase());
    expect(store.list()).toHaveLength(1);
  });

  it('a disco con fsync antes del rename', () => {
    fsCalls.length = 0;
    new SyncDeletedStore(file).add(A);
    expect(fsCalls).toEqual(['fsync', 'rename']);
  });

  it('solo guarda identificadores y fechas', () => {
    new SyncDeletedStore(file).add(A, new Date('2026-10-07T10:00:00.000Z'));
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({
      version: 1,
      deleted: [{ conversationId: A, deletedAt: '2026-10-07T10:00:00.000Z' }],
    });
  });

  it('un archivo ilegible NO se da por vacio ni se pisa', () => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, '{ roto', 'utf8');
    const store = new SyncDeletedStore(file);

    // darlo por vacio resucitaria todo lo borrado
    expect(() => store.list()).toThrow(VaultError);
    expect(() => store.has(A)).toThrow(VaultError);
    expect(() => store.add(A)).toThrow(VaultError);
    expect(readFileSync(file, 'utf8')).toBe('{ roto');
  });
});
