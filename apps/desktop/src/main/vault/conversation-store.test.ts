import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import type * as NodeFs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VaultService, VaultError, type DeviceKeyStore } from './vault-service.js';
import { vaultFilePathFor } from './key-file.js';
import { PrivateConversationStore, conversationsDirectory } from './conversation-store.js';

/**
 * las dos llamadas que hacen durable una escritura, envueltas para ver su ORDEN.
 *
 * Mismo molde que en `recap-store.test.ts` y `relation-store.test.ts`, y aqui
 * importa mas: lo que se reescribe entero son los MENSAJES. Forzar a disco
 * DESPUES del rename no serviria de nada —el rename solo mueve metadatos—, asi
 * que un corte entre los dos dejaria el nombre bueno apuntando a bloques sin
 * escribir y no quedaria ni la conversacion nueva ni la vieja. Lo demas de
 * `node:fs` sigue siendo el de verdad.
 */
const fsCalls = vi.hoisted(() => [] as string[]);
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
  };
});

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

const turn = (text: string, role: 'user' | 'assistant' = 'user') => ({
  role,
  text,
  title: 'Un titulo revelador',
  provider: 'xavira',
  model: 'un-modelo',
  inputTokens: null,
  outputTokens: null,
});

describe('conversaciones privadas en disco', () => {
  let directory: string;
  let vault: VaultService;
  let store: PrivateConversationStore;
  let conversations: string;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'luxy-conv-'));
    vault = new VaultService(vaultFilePathFor(directory), memoryDeviceKeys(), {
      argon2Params: FAST,
    });
    await vault.create(PASSWORD);
    conversations = conversationsDirectory(directory);
    store = new PrivateConversationStore(conversations);
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('guarda y recupera un turno', async () => {
    await store.appendTurn(vault, A, turn('hola'));
    const turns = await store.read(vault, A);
    expect(turns).toHaveLength(1);
    expect(turns[0]?.text).toBe('hola');
    expect(turns[0]?.role).toBe('user');
  });

  it('conserva el orden de los turnos', async () => {
    await store.appendTurn(vault, A, turn('primero'));
    await store.appendTurn(vault, A, turn('segundo', 'assistant'));
    await store.appendTurn(vault, A, turn('tercero'));

    const turns = await store.read(vault, A);
    expect(turns.map((t) => t.text)).toEqual(['primero', 'segundo', 'tercero']);
    expect(turns.map((t) => t.sequence)).toEqual([0, 1, 2]);
  });

  it('el archivo en disco no contiene el texto ni el titulo', async () => {
    await store.appendTurn(vault, A, turn('un secreto que no debe verse'));

    const raw = readFileSync(join(conversations, `${A}.jsonl`), 'utf8');
    expect(raw).not.toContain('un secreto que no debe verse');
    expect(raw).not.toContain('Un titulo revelador');
    expect(raw).not.toContain('xavira');
  });

  it('el nombre del archivo es el uuid, nunca el titulo', async () => {
    await store.appendTurn(vault, A, turn('hola'));
    // %APPDATA% no puede revelar de que hablas ni con la boveda cerrada
    expect(readdirSync(conversations)).toEqual([`${A}.jsonl`]);
  });

  it('sobrevive a cerrar y volver a abrir la boveda', async () => {
    await store.appendTurn(vault, A, turn('escrito antes de cerrar'));
    vault.lock('manual');

    const otra = new VaultService(vaultFilePathFor(directory), memoryDeviceKeys(), {
      argon2Params: FAST,
    });
    await otra.unlock(PASSWORD);
    const turns = await new PrivateConversationStore(conversations).read(otra, A);
    expect(turns[0]?.text).toBe('escrito antes de cerrar');
  });

  it('con la boveda cerrada no se puede leer nada', async () => {
    await store.appendTurn(vault, A, turn('hola'));
    vault.lock('manual');
    await expect(store.read(vault, A)).rejects.toThrow(VaultError);
    await expect(store.list(vault)).rejects.toThrow(VaultError);
  });

  it('separa conversaciones distintas', async () => {
    await store.appendTurn(vault, A, turn('de la primera'));
    await store.appendTurn(vault, B, turn('de la segunda'));

    expect((await store.read(vault, A)).map((t) => t.text)).toEqual(['de la primera']);
    expect((await store.read(vault, B)).map((t) => t.text)).toEqual(['de la segunda']);
  });

  it('lista con titulo y numero de turnos', async () => {
    await store.appendTurn(vault, A, turn('uno'));
    await store.appendTurn(vault, A, turn('dos', 'assistant'));
    await store.appendTurn(vault, B, turn('solo uno'));

    const list = await store.list(vault);
    expect(list).toHaveLength(2);
    const first = list.find((c) => c.conversationId === A);
    expect(first?.title).toBe('Un titulo revelador');
    expect(first?.turns).toBe(2);
  });

  it('la lista dice de que personaje es cada conversacion', async () => {
    await store.appendTurn(vault, A, { ...turn('hola'), characterId: 'lia' });
    await store.appendTurn(vault, B, turn('sin personaje'));

    const list = await store.list(vault);
    expect(list.find((c) => c.conversationId === A)?.characterId).toBe('lia');
    expect(list.find((c) => c.conversationId === B)?.characterId).toBeNull();
  });

  it('encuentra el personaje aunque solo lo lleve el primer turno', async () => {
    // el personaje SOLO se vuelve a sellar cuando cambia, asi que mirar el
    // ultimo turno devolveria null en casi todos los hilos y la lista no
    // podria separar los de uno de los de otro
    await store.appendTurn(vault, A, { ...turn('primero'), characterId: 'lia' });
    for (const texto of ['segundo', 'tercero', 'cuarto']) {
      await store.appendTurn(vault, A, turn(texto));
    }

    const list = await store.list(vault);
    expect(list.find((c) => c.conversationId === A)?.characterId).toBe('lia');
  });

  it('un personaje quitado a mitad deja la conversacion sin dueño', async () => {
    // cadena vacia es «ya no es de nadie», no «sigue igual»: si contara como
    // sin sellar, quitar el personaje no tendria forma de notarse
    await store.appendTurn(vault, A, { ...turn('con personaje'), characterId: 'lia' });
    await store.appendTurn(vault, A, { ...turn('ya no'), characterId: '' });

    const list = await store.list(vault);
    expect(list.find((c) => c.conversationId === A)?.characterId).toBeNull();
  });

  it('el proveedor y el modelo pertenecen a la conversacion', async () => {
    // vivian solo en memoria de la ventana: al reiniciar Studio el proveedor
    // volvia al primero de la lista y el modelo nunca se elegia, asi que una
    // conversacion de roleplay acababa en un modelo que la rechaza
    await store.appendTurn(vault, A, { ...turn('hola'), provider: 'deepseek', model: 'flash' });
    await store.appendTurn(vault, A, {
      ...turn('que tal', 'assistant'),
      provider: 'deepseek',
      model: 'pro',
    });

    expect(await store.latestProvider(vault, A)).toBe('deepseek');
    // vale el ULTIMO que lo llevaba, igual que las instrucciones
    expect(await store.latestModel(vault, A)).toBe('pro');
  });

  it('un turno sin proveedor ni modelo no borra el que hubiera', async () => {
    await store.appendTurn(vault, A, { ...turn('uno'), provider: 'deepseek', model: 'pro' });
    await store.appendTurn(vault, A, { ...turn('dos'), provider: null, model: null });

    // `null` significa «este turno no lo cambio», no «se quito»
    expect(await store.latestProvider(vault, A)).toBe('deepseek');
    expect(await store.latestModel(vault, A)).toBe('pro');
  });

  it('sin turnos no hay proveedor ni modelo que recordar', async () => {
    expect(await store.latestProvider(vault, A)).toBeNull();
    expect(await store.latestModel(vault, A)).toBeNull();
  });

  it('cada conversacion recuerda el suyo', async () => {
    await store.appendTurn(vault, A, { ...turn('uno'), provider: 'deepseek', model: 'pro' });
    await store.appendTurn(vault, B, { ...turn('otro'), provider: 'claude', model: 'opus' });

    expect(await store.latestModel(vault, A)).toBe('pro');
    expect(await store.latestModel(vault, B)).toBe('opus');
  });

  it('una conversacion inexistente es una lista vacia, no un error', async () => {
    expect(await store.read(vault, B)).toEqual([]);
  });

  it('retira el ultimo turno cuando el modelo no contesto', async () => {
    // pasa de verdad: se escribe a DeepSeek, da error, y el mensaje se queda
    // guardado sin respuesta. Al reescribirlo aparece dos veces —en pantalla y
    // en el proximo prompt—, que fue como se detecto
    await store.appendTurn(vault, A, turn('hola'));
    await store.appendTurn(vault, A, turn('¿sigues ahi?'));

    expect(store.removeLastTurn(A)).toBe(true);
    const turns = await store.read(vault, A);
    expect(turns.map((each) => each.text)).toEqual(['hola']);
  });

  it('retirar el unico turno deja la conversacion sin existir', async () => {
    // una entrada vacia en la lista es peor que ninguna
    await store.appendTurn(vault, A, turn('hola'));
    expect(store.removeLastTurn(A)).toBe(true);
    expect(await store.list(vault)).toEqual([]);
  });

  it('retirar de una conversacion que no existe no es un error', () => {
    expect(store.removeLastTurn(A)).toBe(false);
  });

  it('con un registro concreto, solo retira la ultima linea si es la suya', async () => {
    // revision del 28/09: sin la llave no se ve el rol, y detras del mensaje sin
    // contestar puede haber quedado otra linea —una respuesta buena o lo que bajo
    // la sincronizacion—. Esa no se toca
    await store.appendTurn(vault, A, turn('hola'));
    const suyo = await store.appendTurn(vault, A, turn('mensaje sin respuesta'));
    const detras = await store.appendTurn(vault, A, turn('otra linea que quedo detras'));

    expect(store.removeLastTurn(A, suyo.recordId)).toBe(false);
    expect((await store.read(vault, A)).map((each) => each.text)).toEqual([
      'hola',
      'mensaje sin respuesta',
      'otra linea que quedo detras',
    ]);

    expect(store.removeLastTurn(A, detras.recordId)).toBe(true);
    expect(store.removeLastTurn(A, suyo.recordId)).toBe(true);
    expect((await store.read(vault, A)).map((each) => each.text)).toEqual(['hola']);
  });

  it('lo retirado no deja rastro para el siguiente turno', async () => {
    await store.appendTurn(vault, A, turn('primero'));
    await store.appendTurn(vault, A, turn('intento fallido'));
    store.removeLastTurn(A);
    await store.appendTurn(vault, A, turn('segundo intento'));

    const turns = await store.read(vault, A);
    expect(turns.map((each) => each.text)).toEqual(['primero', 'segundo intento']);
    // y las secuencias siguen siendo unicas y crecientes
    expect(turns.map((each) => each.sequence)).toEqual([...turns].map((each) => each.sequence).sort((a, b) => a - b));
    expect(new Set(turns.map((each) => each.sequence)).size).toBe(turns.length);
  });

  it('las instrucciones de un personaje se pueden recuperar de su ultima conversacion', async () => {
    // la personalidad es del personaje y no del hilo: es lo que permite
    // rellenarlas al elegirlo en una conversacion nueva
    const LIA = '83cc7f03-5eb3-4d03-833f-56dfbe80cd7d';
    await store.appendTurn(vault, A, {
      ...turn('hola'),
      characterId: LIA,
      instructions: 'Dulce, curiosa, un poco tímida',
    });

    expect((await store.owner(vault, A)).characterId).toBe(LIA);
    expect((await store.owner(vault, A)).instructions).toBe('Dulce, curiosa, un poco tímida');
  });

  it('borrar elimina el archivo', async () => {
    await store.appendTurn(vault, A, turn('hola'));
    store.delete(A);
    expect(await store.read(vault, A)).toEqual([]);
    expect(readdirSync(conversations)).toEqual([]);
  });

  it('una linea corrupta no invalida el resto', async () => {
    await store.appendTurn(vault, A, turn('valido'));
    const file = join(conversations, `${A}.jsonl`);
    // se simula un corte de luz a media escritura
    writeFileSync(file, `${readFileSync(file, 'utf8')}{ esto no es json\n`, 'utf8');

    const turns = await store.read(vault, A);
    expect(turns).toHaveLength(1);
    expect(turns[0]?.text).toBe('valido');
  });

  it('rechaza un identificador que no sea uuid', async () => {
    // sin esto, "..\\..\\algo" seria una ruta valida de archivo
    await expect(store.appendTurn(vault, '../fuera', turn('x'))).rejects.toThrow(VaultError);
    await expect(store.read(vault, 'no-es-uuid')).rejects.toThrow(VaultError);
  });

  it('ignora archivos ajenos que haya en la carpeta', async () => {
    mkdirSync(conversations, { recursive: true });
    writeFileSync(join(conversations, 'notas.txt'), 'algo', 'utf8');
    writeFileSync(join(conversations, 'invalido.jsonl'), 'algo', 'utf8');
    await store.appendTurn(vault, A, turn('hola'));

    const list = await store.list(vault);
    expect(list.map((c) => c.conversationId)).toEqual([A]);
  });

  it('sin carpeta todavia, la lista esta vacia', async () => {
    const vacio = new PrivateConversationStore(join(directory, 'no-existe'));
    expect(await vacio.list(vault)).toEqual([]);
  });
});

describe('instrucciones fijas de la conversacion', () => {
  let directory: string;
  let vault: VaultService;
  let store: PrivateConversationStore;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'luxy-instr-'));
    vault = new VaultService(vaultFilePathFor(directory), memoryDeviceKeys(), {
      argon2Params: FAST,
    });
    await vault.create(PASSWORD);
    store = new PrivateConversationStore(conversationsDirectory(directory));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('sin instrucciones no hay instrucciones', async () => {
    await store.appendTurn(vault, A, turn('hola'));
    expect((await store.owner(vault, A)).instructions).toBeNull();
  });

  it('valen las del ultimo turno que las llevaba', async () => {
    await store.appendTurn(vault, A, { ...turn('uno'), instructions: 'responde en gallego' });
    // un turno que no las toca NO las borra: solo significa que no las cambio
    await store.appendTurn(vault, A, turn('dos'));
    expect((await store.owner(vault, A)).instructions).toBe('responde en gallego');
  });

  it('la ultima gana', async () => {
    await store.appendTurn(vault, A, { ...turn('uno'), instructions: 'la primera' });
    await store.appendTurn(vault, A, { ...turn('dos'), instructions: 'la segunda' });
    expect((await store.owner(vault, A)).instructions).toBe('la segunda');
  });

  it('una cadena vacia las borra, y se distingue de no tocarlas', async () => {
    await store.appendTurn(vault, A, { ...turn('uno'), instructions: 'algo' });
    await store.appendTurn(vault, A, { ...turn('dos'), instructions: '' });
    // sin esta distincion no habria forma de volver atras una vez puestas
    expect((await store.owner(vault, A)).instructions).toBeNull();
  });

  it('no salen en claro en el archivo', async () => {
    await store.appendTurn(vault, A, {
      ...turn('hola'),
      instructions: 'un contexto que no debe verse en disco',
    });
    const file = join(conversationsDirectory(directory), `${A}.jsonl`);
    expect(readFileSync(file, 'utf8')).not.toContain('un contexto que no debe verse');
  });

  it('con la boveda cerrada no se pueden leer', async () => {
    await store.appendTurn(vault, A, { ...turn('uno'), instructions: 'secreto' });
    vault.lock('manual');
    await expect(store.owner(vault, A)).rejects.toThrow(VaultError);
  });

  it('cada conversacion tiene las suyas', async () => {
    await store.appendTurn(vault, A, { ...turn('uno'), instructions: 'las de A' });
    await store.appendTurn(vault, B, turn('uno'));
    expect((await store.owner(vault, B)).instructions).toBeNull();
  });
});

describe('borrar la memoria propia sin tocar la conversacion', () => {
  let directory: string;
  let vault: VaultService;
  let store: PrivateConversationStore;
  let conversations: string;

  const memoria = (summary: string) => ({
    memory: {
      version: 1 as const,
      summary,
      facts: [],
      decisions: [],
      plan: [],
      openQuestions: [],
      lessons: [],
    },
  });

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'luxy-olvido-'));
    vault = new VaultService(vaultFilePathFor(directory), memoryDeviceKeys(), {
      argon2Params: FAST,
    });
    await vault.create(PASSWORD);
    conversations = conversationsDirectory(directory);
    store = new PrivateConversationStore(conversations);
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('quita la memoria y deja los turnos enteros', async () => {
    await store.appendTurn(vault, A, turn('hola'));
    await store.appendTurn(vault, A, turn('que tal', 'assistant'), memoria('lo de las fotos'));

    expect(store.clearMemory(A)).toBe(1);
    expect(await store.latestMemory(vault, A)).toBeNull();
    // lo que NO se toca, que es la mitad de la promesa del boton
    const turns = await store.read(vault, A);
    expect(turns.map((each) => each.text)).toEqual(['hola', 'que tal']);
  });

  it('las quita TODAS, no solo la ultima', async () => {
    // `latestMemory` busca hacia atras: dejar una sola sin borrar no borra nada,
    // solo destapa la anterior
    await store.appendTurn(vault, A, turn('uno', 'assistant'), memoria('la primera'));
    await store.appendTurn(vault, A, turn('dos', 'assistant'), memoria('la segunda'));
    await store.appendTurn(vault, A, turn('tres', 'assistant'), memoria('la tercera'));

    expect(store.clearMemory(A)).toBe(3);
    expect(await store.latestMemory(vault, A)).toBeNull();
  });

  it('el archivo deja de contener el sobre de la memoria', async () => {
    await store.appendTurn(vault, A, turn('uno', 'assistant'), memoria('lo de las fotos'));
    const file = join(conversations, `${A}.jsonl`);
    expect(readFileSync(file, 'utf8')).toContain('"sealedMemory":{');

    store.clearMemory(A);
    expect(readFileSync(file, 'utf8')).toContain('"sealedMemory":null');
  });

  it('sin memoria que borrar devuelve cero y no reescribe nada', async () => {
    await store.appendTurn(vault, A, turn('hola'));
    const file = join(conversations, `${A}.jsonl`);
    const antes = readFileSync(file, 'utf8');

    expect(store.clearMemory(A)).toBe(0);
    expect(readFileSync(file, 'utf8')).toBe(antes);
  });

  it('no toca las demas conversaciones', async () => {
    await store.appendTurn(vault, A, turn('uno', 'assistant'), memoria('la de A'));
    await store.appendTurn(vault, B, turn('uno', 'assistant'), memoria('la de B'));

    store.clearMemory(A);
    expect(await store.latestMemory(vault, B)).not.toBeNull();
  });

  it('una linea ilegible se conserva tal cual en vez de perderse', async () => {
    await store.appendTurn(vault, A, turn('uno', 'assistant'), memoria('lo de las fotos'));
    const file = join(conversations, `${A}.jsonl`);
    // reescribir el archivo desde `readRecords` habria borrado esta linea de
    // verdad: esa lectura descarta en silencio lo que no parsea
    writeFileSync(file, `${readFileSync(file, 'utf8')}esto no es json\n`, 'utf8');

    expect(store.clearMemory(A)).toBe(1);
    expect(readFileSync(file, 'utf8')).toContain('esto no es json');
  });

  it('de una conversacion que no existe no se borra nada', () => {
    expect(store.clearMemory(B)).toBe(0);
  });

  it('los mensajes se fuerzan a disco ANTES de renombrar', async () => {
    // reescribir el archivo entero por querer quitar una ficha es la unica
    // operacion que pone en juego la conversacion completa: sin el `fsync` un
    // corte de luz podia dejar el nombre bueno apuntando a nada
    await store.appendTurn(vault, A, turn('hola'));
    await store.appendTurn(vault, A, turn('que tal', 'assistant'), memoria('lo de las fotos'));
    fsCalls.length = 0;

    expect(store.clearMemory(A)).toBe(1);

    expect(fsCalls).toEqual(['fsync', 'rename']);
  });

  it('y retirar el ultimo turno tampoco puede dejar el historial a medias', async () => {
    // el mismo camino y el mismo riesgo: `removeLastTurn` reescribe el archivo
    // entero, y lo dispara sola cada envio que falla sin respuesta
    await store.appendTurn(vault, A, turn('hola'));
    await store.appendTurn(vault, A, turn('que tal', 'assistant'));
    fsCalls.length = 0;

    expect(store.removeLastTurn(A)).toBe(true);

    expect(fsCalls).toEqual(['fsync', 'rename']);
  });

  it('un identificador que no es un uuid se rechaza', () => {
    expect(() => store.clearMemory('../otra-cosa')).toThrow(VaultError);
  });
});

describe('el almacen frente a la sincronizacion (SYNC-F1-04)', () => {
  let directory: string;
  let vault: VaultService;
  let store: PrivateConversationStore;
  let conversations: string;

  /** una fuente aparte, con la MISMA boveda, para fabricar registros de verdad */
  let source: PrivateConversationStore;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'luxy-f104-'));
    vault = new VaultService(vaultFilePathFor(directory), memoryDeviceKeys(), {
      argon2Params: FAST,
    });
    await vault.create(PASSWORD);
    conversations = conversationsDirectory(directory);
    store = new PrivateConversationStore(conversations);
    source = new PrivateConversationStore(join(directory, 'fuente'));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  const archivo = (): string => join(conversations, `${A}.jsonl`);

  /** registros sellados de A con secuencias 0..n-1 */
  async function sellados(textos: string[]) {
    const out = [];
    for (const texto of textos) out.push(await source.appendTurn(vault, A, turn(texto)));
    return out;
  }

  it('con un hueco, el turno nuevo usa la mayor secuencia mas uno', async () => {
    const [cero, , dos] = await sellados(['cero', 'uno', 'dos']);
    mkdirSync(conversations, { recursive: true });
    // falta la 1: contar lineas (2) repetiria la secuencia 2, que ya existe
    writeFileSync(archivo(), `${JSON.stringify(cero)}\n${JSON.stringify(dos)}\n`, 'utf8');

    const nuevo = await store.appendTurn(vault, A, turn('tres'));

    expect(nuevo.sequence).toBe(3);
    expect(store.scanIntegrity(A).duplicateSequences).toBe(0);
    expect((await store.read(vault, A)).map((t) => t.text)).toEqual(['cero', 'dos', 'tres']);
  });

  it('un turno nuevo se fuerza a disco', async () => {
    fsCalls.length = 0;
    await store.appendTurn(vault, A, turn('hola'));
    expect(fsCalls).toContain('fsync');
  });

  it('una linea a medias seguida de appendRemote no corrompe el registro nuevo', async () => {
    const [cero, uno] = await sellados(['cero', 'uno']);
    mkdirSync(conversations, { recursive: true });
    // un corte de luz a mitad de escribir la linea 1: sin salto final
    writeFileSync(archivo(), `${JSON.stringify(cero)}\n{"recordId":"a-medi`, 'utf8');
    expect(store.scanIntegrity(A).partialTail).toBe(true);

    expect(store.appendRemote(A, [uno!])).toBe(1);

    // sin el salto delante, lo nuevo se pegaba a la linea rota y se perdian
    // las dos
    expect((await store.read(vault, A)).map((t) => t.text)).toEqual(['cero', 'uno']);
    expect(store.scanIntegrity(A)).toMatchObject({ unreadable: 1, partialTail: false });
  });

  it('y lo mismo con un turno escrito aqui', async () => {
    const [cero] = await sellados(['cero']);
    mkdirSync(conversations, { recursive: true });
    writeFileSync(archivo(), `${JSON.stringify(cero)}\n{"recordId":"a-medi`, 'utf8');

    await store.appendTurn(vault, A, turn('uno'));

    expect((await store.read(vault, A)).map((t) => t.text)).toEqual(['cero', 'uno']);
  });

  it('appendRemote fuerza el lote a disco', async () => {
    const registros = await sellados(['cero', 'uno']);
    fsCalls.length = 0;
    expect(store.appendRemote(A, registros)).toBe(2);
    expect(fsCalls).toContain('fsync');
  });

  it('rechaza un registro de otra conversacion y no escribe nada del lote', async () => {
    const [cero, uno] = await sellados(['cero', 'uno']);
    const ajeno = { ...uno!, conversationId: B };

    expect(() => store.appendRemote(A, [cero!, ajeno])).toThrow(
      expect.objectContaining({ reason: 'foreign' }),
    );
    // o entra el lote entero o no entra nada
    expect(store.scanIntegrity(A).lines).toBe(0);
  });

  it('rechaza una secuencia ya ocupada aqui por otro registro', async () => {
    const [cero] = await sellados(['cero']);
    await store.appendTurn(vault, A, turn('el mio'));

    // la misma secuencia 0 con otro recordId: dos versiones, no se pisa
    expect(() => store.appendRemote(A, [cero!])).toThrow(
      expect.objectContaining({ reason: 'occupied', sequence: 0 }),
    );
    expect((await store.read(vault, A)).map((t) => t.text)).toEqual(['el mio']);
  });

  it('rechaza el rango reservado a los hechos', async () => {
    const [cero] = await sellados(['cero']);
    expect(() => store.appendRemote(A, [{ ...cero!, sequence: 1_000_000_000 }])).toThrow(
      expect.objectContaining({ reason: 'reserved' }),
    );
    expect(store.scanIntegrity(A).lines).toBe(0);
  });

  it('rechaza un recordId que ya esta en otra secuencia', async () => {
    const [cero] = await sellados(['cero']);
    store.appendRemote(A, [cero!]);
    expect(() => store.appendRemote(A, [{ ...cero!, sequence: 7 }])).toThrow(
      expect.objectContaining({ reason: 'duplicate-record' }),
    );
    expect(store.scanIntegrity(A).lines).toBe(1);
  });

  it('el diagnostico cuenta bien cada caso, sin descifrar', async () => {
    const [cero, uno, dos] = await sellados(['cero', 'uno', 'dos']);
    const otroUno = (await source.appendTurn(vault, B, turn('otro'))) as typeof uno;
    mkdirSync(conversations, { recursive: true });
    const lineas = [
      JSON.stringify(cero),
      // copia exacta: misma secuencia y mismo recordId
      JSON.stringify(cero),
      JSON.stringify(uno),
      // la secuencia 1 otra vez, con otro recordId: el fallo del numerado viejo
      JSON.stringify({ ...otroUno!, conversationId: A, sequence: 1 }),
      // falta la 2 y la 3: dos huecos
      JSON.stringify({ ...dos!, sequence: 4 }),
      '{ esto no es json',
      JSON.stringify({ ...dos!, conversationId: B, sequence: 9 }),
      JSON.stringify({ ...dos!, recordId: '33333333-3333-4333-8333-333333333333', sequence: 1_000_000_000 }),
    ];
    writeFileSync(archivo(), `${lineas.join('\n')}\n`, 'utf8');

    // la boveda cerrada: el diagnostico no necesita la llave
    vault.lock('manual');
    expect(store.scanIntegrity(A)).toEqual({
      lines: 8,
      unreadable: 3,
      duplicateLines: 1,
      duplicateSequences: 1,
      holes: 2,
      partialTail: false,
    });
  });

  it('una conversacion que no existe tiene un diagnostico vacio', () => {
    expect(store.scanIntegrity(A)).toEqual({
      lines: 0,
      unreadable: 0,
      duplicateLines: 0,
      duplicateSequences: 0,
      holes: 0,
      partialTail: false,
    });
  });
});
