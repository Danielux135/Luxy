// lo que la pantalla dice de una sincronizacion (SYNC-F1-08, D-093).
//
// La regla que se fija aqui: «Sincronizado» solo cuando todo coincide. Cada
// forma de que algo falte —una conversacion fallida, congelada, con turnos
// repetidos, ocupada, sin empezar; un archivo que no subio; una pasada parada—
// tiene que cambiar el titular y decir que falta.
import { describe, it, expect } from 'vitest';
import type { VaultSyncDiagnosis, VaultSyncResult } from '../shared/ipc.js';
import { VAULT_SYNC_STOP_REASONS } from '../shared/ipc.js';
import {
  CAPTION_DOES_NOT_TRAVEL,
  DELETE_KEEPS_SERVER_COPY,
  NOT_TRAVELING_YET,
  ONLY_THIS_CONVERSATION,
  REPLICA_NOTICE,
  conversationCopied,
  describeStop,
  localTime,
  summarizeDiagnosis,
  summarizeSync,
  syncAllGood,
} from './vault-sync-status.js';

const A = '0000000a-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = '0000000b-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
/** las 10:42 en la hora de este ordenador, sea cual sea su zona */
const A_LAS_10_42 = new Date(2026, 9, 7, 10, 42, 5).toISOString();
const HORA = { timeOf: () => '10:42' };
/** cualquier forma de decir que quedo copiado, la de ahora y la de antes */
const TODO_BIEN = /sincronizados? a las|quedó copiada|quedaron copiados/i;

type Report = VaultSyncResult['conversations'][number];

function informe(id: string, overrides: Partial<Report> = {}): Report {
  return {
    conversationId: id,
    status: 'ok',
    local: 3,
    server: 3,
    uploaded: 0,
    downloaded: 0,
    unreadable: 0,
    duplicateSequences: 0,
    serverLost: 0,
    notUploadable: 0,
    unopenable: 0,
    error: null,
    ...overrides,
  };
}

function resultado(overrides: Partial<VaultSyncResult> = {}): VaultSyncResult {
  return {
    protocol: 2,
    scope: 'all',
    stopped: null,
    stoppedDetail: null,
    role: 'origin',
    conversations: [informe(A), informe(B)],
    deletedStillOnServer: 0,
    uploaded: 2,
    downloaded: 1,
    media: {
      reached: true,
      uploaded: 1,
      downloaded: 0,
      alreadyThere: 0,
      skipped: 0,
      waiting: 0,
      failed: 0,
      unopenable: 0,
      notUploadable: 0,
      error: null,
    },
    finishedAt: A_LAS_10_42,
    ...overrides,
  };
}

const titulos = (id: string): string | null => (id === A ? 'Paseo por el puerto' : null);

/** todo lo que se pinta, junto, para buscar en ello */
function todo(result: VaultSyncResult): string {
  const summary = summarizeSync(result, titulos);
  return [
    summary.headline.text,
    ...summary.lines.map((line) => line.text),
    ...summary.conversations.map((row) => `${row.title} ${row.label} ${row.counts} ${row.detail ?? ''}`),
  ].join('\n');
}

/** cada forma de que algo falte, con lo que tiene que decir */
const VARIANTES: { nombre: string; result: VaultSyncResult; dice: RegExp }[] = [
  {
    nombre: 'una conversacion fallida',
    result: resultado({ conversations: [informe(A, { status: 'failed', error: 'el servidor respondio 502' }), informe(B)] }),
    dice: /1 conversación ha fallado/,
  },
  {
    nombre: 'una conversacion en dos versiones',
    result: resultado({ conversations: [informe(A, { status: 'frozen' }), informe(B)] }),
    dice: /dos versiones y no se copia\. No se ha borrado nada/,
  },
  {
    nombre: 'turnos repetidos aqui',
    result: resultado({ conversations: [informe(A, { status: 'local-duplicates', duplicateSequences: 2 }), informe(B)] }),
    dice: /turnos repetidos en este ordenador y no se sube/,
  },
  {
    nombre: 'una conversacion ocupada',
    result: resultado({ conversations: [informe(A, { status: 'busy' }), informe(B)] }),
    dice: /estaba ocupada: va en la siguiente/,
  },
  {
    nombre: 'la boveda cerrada a mitad',
    result: resultado({
      stopped: 'locked',
      conversations: [informe(A), informe(B, { status: 'interrupted', server: null })],
    }),
    dice: /interrumpida: no se da nada por bueno/,
  },
  {
    nombre: 'un gateway viejo',
    result: resultado({ stopped: 'gateway-outdated', conversations: [], media: { ...resultado().media, reached: false } }),
    dice: /hay que actualizarlo\. No se ha subido ni bajado nada/,
  },
  {
    nombre: 'la sesion caducada',
    result: resultado({ stopped: 'session', conversations: [informe(A, { status: 'failed' }), informe(B, { status: 'not-reached', server: null })] }),
    dice: /vuelve a entrar en tu cuenta/,
  },
  {
    nombre: 'un archivo fallido',
    result: resultado({ media: { ...resultado().media, failed: 1, error: 'el servidor respondio 502' } }),
    dice: /1 archivo ha fallado: el servidor respondio 502/,
  },
  {
    nombre: 'un archivo esperando a su conversacion',
    result: resultado({ media: { ...resultado().media, waiting: 2 } }),
    dice: /2 archivos esperan a que suba su conversación/,
  },
  {
    nombre: 'un archivo demasiado grande',
    result: resultado({ media: { ...resultado().media, skipped: 1 } }),
    dice: /demasiado grande para sincronizar/,
  },
  {
    nombre: 'el servidor perdio turnos',
    result: resultado({ conversations: [informe(A, { serverLost: 2, uploaded: 2 }), informe(B)] }),
    dice: /El servidor había perdido 2 turnos que ya tenía; se han vuelto a subir/,
  },
  {
    nombre: 'un turno que no puede viajar',
    result: resultado({ conversations: [informe(A, { notUploadable: 1, local: 4 }), informe(B)] }),
    dice: /1 turno no puede viajar/,
  },
  {
    nombre: 'un turno del servidor que no se abre',
    result: resultado({ conversations: [informe(A, { status: 'failed', unopenable: 1 }), informe(B)] }),
    dice: /no se abre con esta bóveda/,
  },
  {
    nombre: 'local y servidor que no suman lo mismo',
    result: resultado({ conversations: [informe(A, { local: 4, server: 3 }), informe(B)] }),
    dice: /no suman lo mismo/,
  },
  {
    nombre: 'una replica',
    result: resultado({ role: 'replica' }),
    dice: /Este ordenador es una copia/,
  },
  {
    nombre: 'falta el almacen de archivos',
    result: resultado({ stopped: 'media-store-missing' }),
    dice: /Falta el almacén de archivos/,
  },
];

describe('el resumen de una sincronizacion', () => {
  it('con todo al dia, y solo entonces, dice «sincronizados»', () => {
    const summary = summarizeSync(resultado(), titulos, HORA);
    expect(summary.headline).toEqual({ tone: 'ok', text: syncAllGood('10:42') });
    expect(summary.lines.map((line) => line.text)).toEqual([
      'Turnos: 2 subidos, 1 bajados. Lo que viaja va cifrado; el servidor no puede leerlo.',
      'Archivos: 1 subidos, 0 bajados.',
      NOT_TRAVELING_YET,
    ]);
    expect(summary.conversations.map((row) => [row.title, row.label, row.counts])).toEqual([
      ['Paseo por el puerto', 'al día', '3 aquí · 3 en el servidor'],
      ['conversación sin abrir aquí', 'al día', '3 aquí · 3 en el servidor'],
    ]);
  });

  for (const variante of VARIANTES) {
    it(`NUNCA dice «sincronizados» con ${variante.nombre}, y dice que falta`, () => {
      const summary = summarizeSync(variante.result, titulos);
      expect(summary.headline.tone).not.toBe('ok');
      expect(summary.headline.text).not.toMatch(TODO_BIEN);
      expect(todo(variante.result)).not.toMatch(TODO_BIEN);
      expect(todo(variante.result)).toMatch(variante.dice);
    });
  }

  it('cada conversacion dice como acabo, con lo de aqui frente a lo del servidor', () => {
    const summary = summarizeSync(
      resultado({
        conversations: [
          informe(A, { status: 'frozen', local: 5, server: 4 }),
          informe(B, { status: 'not-reached', local: 2, server: null }),
        ],
      }),
      titulos,
    );
    expect(summary.conversations[0]).toMatchObject({
      title: 'Paseo por el puerto',
      tone: 'fault',
      label: 'en dos versiones: no se copia',
      counts: '5 aquí · 4 en el servidor',
    });
    expect(summary.conversations[0]?.detail).toContain('No se ha borrado nada de ningún lado');
    expect(summary.conversations[0]?.detail).toContain('Puedes seguir escribiendo aquí, pero esta conversación no se copia');
    expect(summary.conversations[1]).toMatchObject({ label: 'sin empezar', counts: '2 aquí' });
  });

  it('una conversacion fallida enseña su motivo', () => {
    const summary = summarizeSync(
      resultado({ conversations: [informe(A, { status: 'failed', error: 'el servidor respondio 502' })] }),
      titulos,
    );
    expect(summary.conversations[0]).toMatchObject({ label: 'falló', detail: 'el servidor respondio 502' });
  });

  it('las borradas aqui que siguen en el servidor se dicen sin alarmar', () => {
    const summary = summarizeSync(resultado({ deletedStillOnServer: 2 }), titulos, HORA);
    expect(summary.lines.map((line) => line.text)).toContain(
      '2 conversaciones borradas aquí siguen en el servidor: su copia se borrará con la próxima actualización. No vuelven a este ordenador.',
    );
    // es lo que Daniel pidio: no es un fallo
    expect(summary.headline.text).toBe(syncAllGood('10:42'));
    // pero el titular no puede decir que coincidian: el servidor tiene mas
    expect(summary.headline.text).not.toMatch(/coincid/i);
  });

  it('el titular va en pasado y con la hora en que acabo (STUDIO-R1-01)', () => {
    // en F1 nada sincroniza solo: «coincide», en presente y sin hora, seguia en
    // pantalla despues de escribir treinta mensajes que no habian subido
    const summary = summarizeSync(resultado(), titulos);
    expect(localTime(A_LAS_10_42)).toBe('10:42');
    expect(summary.headline.text).toBe(
      'Turnos y archivos sincronizados a las 10:42: en ese momento, los de este ordenador estaban también en el servidor.',
    );
    expect(summary.headline.text).not.toMatch(/coincide\b|\bestán\b/);
  });

  it('el titular dice QUE se sincronizo y nunca promete «todo»; lo que no viaja va siempre al lado (STUDIO-R2-01)', () => {
    // en F1 solo viajan turnos y archivos. «Lo de este ordenador y lo del
    // servidor coincidia» hacia creer que la copia del servidor bastaba para
    // recuperar a Lia y las fichas de memoria, que no habian subido
    const summary = summarizeSync(resultado(), titulos, HORA);
    expect(summary.headline.tone).toBe('ok');
    expect(summary.headline.text).toMatch(/^Turnos y archivos sincronizados a las 10:42/);
    expect(summary.headline.text).not.toMatch(/\btodo\b|coincid|lo de este ordenador/i);
    expect(summary.lines.at(-1)).toEqual({ tone: 'idle', text: NOT_TRAVELING_YET });

    // con cualquier resultado, no solo en una replica
    const todos = [
      resultado(),
      resultado({ role: 'replica' }),
      resultado({ deletedStillOnServer: 1 }),
      resultado({ scope: 'conversation', conversations: [informe(A)] }),
      resultado({ conversations: [], uploaded: 0, downloaded: 0, media: { ...resultado().media, reached: false } }),
      ...VARIANTES.map((variante) => variante.result),
    ];
    for (const result of todos) {
      expect(summarizeSync(result, titulos).lines.map((line) => line.text)).toContain(NOT_TRAVELING_YET);
    }

    // y nombra cada pieza que el diseño deja para la siguiente version
    for (const pieza of [
      'Lía y los demás personajes',
      'fotos de perfil',
      'fichas de memoria',
      'enganches',
      'memoria reescrita',
      'cuaderno',
      'catálogo de escenas',
      'apartadas de los recuerdos',
      'la copia de seguridad a mano de la bóveda sigue haciendo falta',
    ]) {
      expect(NOT_TRAVELING_YET).toContain(pieza);
    }
  });

  it('si desde entonces se escribio o se borro algo aqui, ya no dice que coincidia todo', () => {
    const summary = summarizeSync(resultado(), titulos, { ...HORA, changedSince: true });
    expect(summary.headline.tone).toBe('warn');
    expect(summary.headline.text).not.toMatch(TODO_BIEN);
    expect(summary.lines.map((line) => line.text)).toContain(
      'Desde la sincronización de las 10:42 has escrito o borrado algo en este ordenador: eso todavía no está en el servidor. Vuelve a sincronizar para copiarlo.',
    );
  });

  it('«solo esta conversacion» habla de esa y nunca de todo el ordenador (STUDIO-R1-02)', () => {
    // la primera prueba en vivo: una conversacion desechable con «Solo esta
    // conversacion», y las otras 21 sin subir nunca. Decir «lo de este
    // ordenador y lo del servidor coincide» era falso
    const summary = summarizeSync(
      resultado({ scope: 'conversation', conversations: [informe(A, { local: 2, server: 2 })] }),
      titulos,
      HORA,
    );
    expect(summary.headline).toEqual({ tone: 'ok', text: conversationCopied('10:42', 2, 2) });
    expect(summary.headline.text).toBe(
      'Los turnos y archivos de esta conversación quedaron copiados a las 10:42: 2 turnos aquí, 2 en el servidor. Las demás no se han mirado.',
    );
    expect(summary.headline.text).not.toMatch(/^(Turnos y archivos )?sincronizados/i);
    expect(todo(resultado({ scope: 'conversation', conversations: [informe(A)] }))).not.toContain(
      'lo de este ordenador y lo del servidor',
    );
    expect(summary.lines.map((line) => line.text)).toContain(ONLY_THIS_CONVERSATION);
  });

  it('«solo esta conversacion» sobre una borrada aqui no presume de nada', () => {
    const summary = summarizeSync(resultado({ scope: 'conversation', conversations: [] }), titulos, HORA);
    expect(summary.headline).toEqual({
      tone: 'warn',
      text: 'No se ha copiado nada: esa conversación se borró en este ordenador.',
    });
  });

  it('«solo esta conversacion» con algo pendiente tampoco dice que quedo copiada', () => {
    const summary = summarizeSync(
      resultado({ scope: 'conversation', conversations: [informe(A, { status: 'frozen' })] }),
      titulos,
      HORA,
    );
    expect(summary.headline.tone).toBe('fault');
    expect(summary.headline.text).not.toMatch(TODO_BIEN);
  });

  it('cada motivo de parada tiene su frase, y todas dicen que lo suyo sigue o que no se toco nada', () => {
    for (const reason of VAULT_SYNC_STOP_REASONS) {
      const texto = describeStop(reason);
      expect(texto.length).toBeGreaterThan(20);
      expect(texto).not.toMatch(/^Sincronizado/);
    }
    expect(describeStop('locked')).toContain('no se da nada por bueno');
    expect(describeStop('gateway-outdated')).toContain('hay que actualizarlo');
    expect(describeStop('gateway-protocol')).toContain('actualiza Luxy Studio');
    expect(describeStop('tombstones-unreadable')).toContain('volverían conversaciones que borraste');
  });

  it('los textos fijos dicen lo que de verdad pasa en F1', () => {
    expect(DELETE_KEEPS_SERVER_COPY).toBe(
      'Borrarla la quita de este ordenador; la copia del servidor se borrará con la próxima actualización.',
    );
    expect(CAPTION_DOES_NOT_TRAVEL).toContain('todavía no viaja');
    expect(REPLICA_NOTICE).toContain('no escribe en Privado');
  });

  it('sin nada que sincronizar no presume', () => {
    const summary = summarizeSync(
      resultado({ conversations: [], uploaded: 0, downloaded: 0, media: { ...resultado().media, reached: false, uploaded: 0 } }),
      titulos,
    );
    expect(summary.headline).toEqual({ tone: 'idle', text: 'No había nada que sincronizar.' });
  });
});

describe('el diagnostico local', () => {
  const base = (overrides: Partial<VaultSyncDiagnosis['conversations'][number]> = {}) => ({
    conversationId: A,
    lines: 4,
    turns: 4,
    unreadable: 0,
    duplicateLines: 0,
    duplicateSequences: 0,
    holes: 0,
    partialTail: false,
    ...overrides,
  });

  it('cuenta conversaciones y turnos', () => {
    const summary = summarizeDiagnosis(
      { conversations: [base(), base({ conversationId: B, turns: 2, lines: 2 })], deleted: 0 },
      titulos,
    );
    expect(summary.headline).toEqual({
      tone: 'idle',
      text: 'En este ordenador: 2 conversaciones con 6 turnos.',
    });
    expect(summary.lines).toEqual([]);
  });

  it('señala por su titulo las que tienen secuencias repetidas', () => {
    const summary = summarizeDiagnosis(
      { conversations: [base({ duplicateSequences: 2 }), base({ conversationId: B })], deleted: 1 },
      titulos,
    );
    expect(summary.headline.tone).toBe('fault');
    expect(summary.headline.text).toContain('1 tiene turnos repetidos');
    expect(summary.lines.map((line) => line.text)).toEqual([
      '«Paseo por el puerto»: 2 posiciones repetidas con turnos distintos. No se subirá.',
      '1 conversación borrada en este ordenador no viajará.',
    ]);
  });

  it('dice lineas rotas, copias, huecos y finales a medias', () => {
    const summary = summarizeDiagnosis(
      {
        conversations: [base({ unreadable: 1, duplicateLines: 2, holes: 3, partialTail: true })],
        deleted: 0,
      },
      titulos,
    );
    expect(summary.lines.map((line) => line.text)).toEqual([
      '1 línea no se puede leer y no viajará.',
      '2 líneas son copias exactas de otra: viaja una sola vez.',
      'Faltan 3 turnos en medio de alguna conversación; si el servidor los tiene, se bajarán.',
      '1 conversación acaba en una línea a medias; lo siguiente se escribirá detrás sin pisarla.',
    ]);
  });

  it('con la lista de borradas ilegible avisa de que no se podra sincronizar', () => {
    const summary = summarizeDiagnosis({ conversations: [base()], deleted: null }, titulos);
    expect(summary.headline.tone).toBe('fault');
    expect(summary.lines.map((line) => line.text).join(' ')).toContain('no se podrá sincronizar');
  });
});
