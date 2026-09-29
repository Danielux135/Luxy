// la reescritura de la memoria de una conversacion enganchada (`D-108`). Todo
// el texto es INVENTADO.
import { describe, expect, it } from 'vitest';
import {
  RELINK_CLOSE,
  RELINK_OPEN,
  buildMemoryRelinkPrompt,
  decideRelink,
  effectiveSealedMemory,
  memoryRelinkEntrySchema,
  parseMemoryRelinkResponse,
  relinkApplies,
  relinkNeedsRun,
  relinkPhase,
  textOutsideRelinkBlock,
  type MemoryRelinkEntry,
  type RelinkOwnerRef,
} from './vault-relink.js';
import { CONVERSATION_MEMORY_OPEN, type ConversationMemory } from './schemas.js';
import { buildVaultPrompt } from './vault-prompt.js';
import { chooseConversationMemory, compareMemoryEntries, countKeptEntries } from './vault-recap.js';

const CONV = '11111111-1111-4111-8111-111111111111';
const EVENT = '22222222-2222-4222-8222-222222222222';
const OTHER_EVENT = '33333333-3333-4333-8333-333333333333';
const NORA = 'e0000000-5555-4555-8555-555555555555';

function memoria(over: Partial<ConversationMemory> = {}): ConversationMemory {
  return {
    version: 1,
    summary:
      'La IA y el pasean por un puerto inventado. Ella le cuenta que pinta barcos al amanecer y el le promete ir a verla el sabado por la mañana, con cafe.',
    facts: ['La IA vive en un faro inventado', 'El la llama marinera cuando esta de buenas'],
    decisions: ['Quedaron en escribirse cada noche'],
    plan: ['El ira al faro el sabado'],
    openQuestions: [],
    lessons: ['A ella le gusta que el pregunte por sus cuadros'],
    ...over,
  };
}

const owner: RelinkOwnerRef = { source: 'link', characterId: NORA, winningEventId: EVENT };
const sealed = { sequence: 5, createdAt: '2026-09-20T10:05:00.000Z' };

function fila(over: Partial<MemoryRelinkEntry> = {}): MemoryRelinkEntry {
  return memoryRelinkEntrySchema.parse({
    v: 1,
    conversationId: CONV,
    ownerEventId: EVENT,
    characterId: NORA,
    status: 'ready',
    basedOn: sealed,
    memory: memoria({ facts: ['Nora vive en un faro inventado', 'El la llama marinera cuando esta de buenas'] }),
    drift: { kept: 4, rewritten: 1, dropped: 0, added: 0, shortened: 0 },
    provider: 'claude',
    model: null,
    failure: null,
    createdAt: '2026-09-28T10:00:00.000Z',
    updatedAt: '2026-09-28T10:00:00.000Z',
    ...over,
  });
}

const bloque = (memory: unknown): string => `${RELINK_OPEN}${JSON.stringify(memory)}${RELINK_CLOSE}`;

describe('el prompt de la reescritura', () => {
  it('lleva el nombre, la ficha como DATOS y la memoria en JSON, y ningun turno', () => {
    const prompt = buildMemoryRelinkPrompt({
      label: 'Nora',
      description: 'Nora es una pintora inventada de treinta años.',
      previous: memoria(),
    });
    expect(prompt).toContain('es\nNora, y abajo tienes su descripcion.');
    expect(prompt).toContain('SU DESCRIPCION (DATOS):\nNora es una pintora inventada de treinta años.');
    expect(prompt).toContain('LA MEMORIA DE AHORA (DATOS):');
    expect(prompt).toContain('"La IA vive en un faro inventado"');
    expect(prompt).toContain(RELINK_OPEN);
    // la etiqueta del turno vivo contradiria el `system` del turno tecnico
    expect(prompt).not.toContain(CONVERSATION_MEMORY_OPEN);
    expect(prompt).not.toMatch(/Usuario:|Personaje:/);
  });

  it('le dice que no complete un texto cortado al guardarlo', () => {
    const prompt = buildMemoryRelinkPrompt({ label: 'Nora', description: null, previous: memoria() });
    expect(prompt).toContain('Un texto que acaba en «…» se corto al guardarlo: dejalo asi, sin completarlo.');
  });

  it('sin ficha no promete una descripcion que no va', () => {
    const prompt = buildMemoryRelinkPrompt({ label: 'Nora', description: '   ', previous: memoria() });
    expect(prompt).not.toContain('SU DESCRIPCION');
    expect(prompt).not.toContain('abajo tienes su descripcion');
    expect(prompt).toContain('pones Nora;');
  });
});

describe('la respuesta', () => {
  it('lee el bloque propio y no el de memoria del turno', () => {
    const next = memoria({ summary: 'Nora y el pasean por un puerto inventado.' });
    expect(parseMemoryRelinkResponse(`hecho\n${bloque(next)}`)).toEqual({
      status: 'structured',
      memory: next,
    });
    expect(parseMemoryRelinkResponse(`${CONVERSATION_MEMORY_OPEN}{}`).status).toBe('absent');
  });

  it('distingue cortado, roto y con una marca de Luxy dentro', () => {
    expect(parseMemoryRelinkResponse(`${RELINK_OPEN}{"summary":"a"`).status).toBe('truncated');
    expect(parseMemoryRelinkResponse(`${RELINK_OPEN}no es json${RELINK_CLOSE}`).status).toBe('invalid');
    expect(
      parseMemoryRelinkResponse(bloque(memoria({ facts: ['dice <LUXY_MEMORY> dentro'] }))).status,
    ).toBe('invalid');
  });

  it('a los topes de la sellada, no a los de la ficha retroactiva', () => {
    const larga = 'palabra '.repeat(140).trim();
    const parsed = parseMemoryRelinkResponse(bloque(memoria({ summary: larga })));
    expect(parsed.status).toBe('structured');
    // 400 seria el tope de la ficha: aqui se conserva hasta 1.200
    expect(parsed.memory!.summary.length).toBeGreaterThan(1000);
  });

  it('lo de fuera del bloque es lo unico que se clasifica', () => {
    expect(textOutsideRelinkBlock(`no puedo ayudar con eso ${bloque(memoria())}`)).toBe(
      'no puedo ayudar con eso ',
    );
    expect(textOutsideRelinkBlock('lo siento')).toBe('lo siento');
  });
});

describe('la guarda contra perder material', () => {
  const anterior = memoria();

  it('corregir el nombre se aplica sola', () => {
    const next = memoria({
      summary: anterior.summary.replace('La IA', 'Nora'),
      facts: ['Nora vive en un faro inventado', anterior.facts[1]!],
    });
    const decision = decideRelink({
      previous: anterior,
      parsed: { status: 'structured', memory: next },
      refused: false,
    });
    expect(decision.status).toBe('ready');
  });

  it('sin bloque: negativa o invalida segun lo que diga fuera', () => {
    expect(
      decideRelink({ previous: anterior, parsed: { status: 'absent', memory: null }, refused: true }),
    ).toMatchObject({ status: 'failed', failure: 'refused' });
    expect(
      decideRelink({ previous: anterior, parsed: { status: 'absent', memory: null }, refused: false }),
    ).toMatchObject({ status: 'failed', failure: 'invalid' });
  });

  it('un resumen rehecho en corto no se aplica aunque no falte ninguna entrada', () => {
    const next = memoria({ summary: 'Nora y el pasean por el puerto y quedan el sabado.' });
    expect(compareMemoryEntries(anterior, next).dropped).toBe(0);
    expect(
      decideRelink({ previous: anterior, parsed: { status: 'structured', memory: next }, refused: false }),
    ).toMatchObject({ status: 'failed', failure: 'lossy' });
  });

  it('las entradas recortadas cuentan como perdida, aunque la similitud diga «reescrita»', () => {
    const next = memoria({
      facts: ['La IA vive', 'El la llama'],
      lessons: ['A ella le gusta'],
    });
    const comparacion = compareMemoryEntries(anterior, next);
    expect(comparacion.dropped).toBe(0);
    expect(comparacion.shortened).toBe(3);
    expect(
      decideRelink({ previous: anterior, parsed: { status: 'structured', memory: next }, refused: false }),
    ).toMatchObject({ status: 'failed', failure: 'lossy' });
  });

  it('quitar tres entradas no se aplica', () => {
    const next = memoria({ facts: [], plan: [] , lessons: [] });
    expect(
      decideRelink({ previous: anterior, parsed: { status: 'structured', memory: next }, refused: false }),
    ).toMatchObject({ status: 'failed', failure: 'lossy' });
  });

  it('una vaga no se aplica si la de antes no lo era', () => {
    const next = memoria({
      summary: 'Tuvieron un encuentro intimo.',
      facts: [],
      decisions: [],
      plan: [],
      lessons: [],
    });
    expect(
      decideRelink({ previous: anterior, parsed: { status: 'structured', memory: next }, refused: false }),
    ).toMatchObject({ status: 'failed', failure: 'vague' });
  });

  // septima ronda: en una memoria corta —una conversacion enganchada al poco de
  // empezar— las holguras y las «dos permitidas» dejaban vaciarla entera
  it('una memoria corta no se puede vaciar dentro de las holguras', () => {
    const corta = memoria({
      summary: 'Daniel y Marta se besan por primera vez en el puerto.',
      facts: ['Marta es enfermera en el hospital.', 'Daniel le regalo una pulsera roja.'],
      decisions: [],
      plan: [],
      lessons: [],
    });
    const vaciada = memoria({ summary: 'Lia.', facts: [], decisions: [], plan: [], lessons: [] });
    expect(
      decideRelink({ previous: corta, parsed: { status: 'structured', memory: vaciada }, refused: false }),
    ).toMatchObject({ status: 'failed', failure: 'lossy' });
    // quitar una de dos es quitar la mitad: se aplica. Dos de dos, no
    const sinUna = memoria({ ...corta, summary: corta.summary.replace('Marta', 'Nora'), facts: [corta.facts[1]!] });
    expect(
      decideRelink({ previous: corta, parsed: { status: 'structured', memory: sinUna }, refused: false }).status,
    ).toBe('ready');
    // y corregir el nombre en la corta sigue pasando
    const corregida = memoria({
      ...corta,
      summary: corta.summary.replace('Marta', 'Nora'),
      facts: ['Nora es enfermera en el hospital.', corta.facts[1]!],
    });
    expect(
      decideRelink({ previous: corta, parsed: { status: 'structured', memory: corregida }, refused: false }),
    ).toMatchObject({ status: 'ready', drift: { summaryChanged: true } });
  });

  it('quitar dos de tres entradas no se aplica, aunque quede la larga', () => {
    // solo la regla de la mitad lo ve: son «dos» y el total no baja a la mitad
    const larga = 'Nora guarda en el faro inventado una caja con las cartas que le escribio su abuela marinera';
    const antes = memoria({ facts: [larga, 'Le gusta el te', 'Tiene un gato'], decisions: [], plan: [], lessons: [] });
    const despues = memoria({ facts: [larga], decisions: [], plan: [], lessons: [] });
    expect(compareMemoryEntries(antes, despues)).toMatchObject({ dropped: 2, shortened: 0 });
    expect(
      decideRelink({ previous: antes, parsed: { status: 'structured', memory: despues }, refused: false }),
    ).toMatchObject({ status: 'failed', failure: 'lossy' });
  });

  it('las entradas no pueden bajar de la mitad aunque quepa en la holgura', () => {
    // solo el suelo de la mitad lo ve: una entrada quitada, 110 caracteres de
    // 150, menos que los 120 de holgura
    const larga = 'x'.repeat(10) + ' Nora guarda en el faro una caja con las cartas de su abuela marinera y un mapa de la costa';
    expect(larga.length).toBeGreaterThan(95);
    const antes = memoria({ facts: ['Le gusta el te verde', 'Tiene un gato gris', larga], decisions: [], plan: [], lessons: [] });
    const despues = memoria({ facts: ['Le gusta el te verde', 'Tiene un gato gris'], decisions: [], plan: [], lessons: [] });
    const total = (m: typeof antes) => m.facts.reduce((n, f) => n + f.length, 0);
    expect(total(antes) - total(despues)).toBeLessThanOrEqual(120);
    expect(total(despues)).toBeLessThan(total(antes) / 2);
    expect(
      decideRelink({ previous: antes, parsed: { status: 'structured', memory: despues }, refused: false }),
    ).toMatchObject({ status: 'failed', failure: 'lossy' });
  });

  it('un resumen que cuenta otra cosa con el mismo largo no se aplica', () => {
    const otro = memoria({
      summary:
        'Nora y el discuten en un tren nocturno inventado. Ella le reprocha una carta que nunca llego y el promete escribirle otra, esta vez con sello verde.',
    });
    expect(Math.abs(otro.summary.length - anterior.summary.length)).toBeLessThan(20);
    expect(
      decideRelink({ previous: anterior, parsed: { status: 'structured', memory: otro }, refused: false }),
    ).toMatchObject({ status: 'failed', failure: 'lossy' });
  });

  it('dice si el resumen cambio, y un punto de mas no es un cambio', () => {
    const igual = memoria({ summary: `${anterior.summary.toUpperCase()}  ` });
    expect(
      decideRelink({ previous: anterior, parsed: { status: 'structured', memory: igual }, refused: false }),
    ).toMatchObject({ status: 'ready', drift: { summaryChanged: false } });
  });

  it('countKeptEntries sigue devolviendo los cuatro campos de siempre', () => {
    expect(Object.keys(countKeptEntries(anterior, anterior)).sort()).toEqual(
      ['added', 'dropped', 'kept', 'rewritten'],
    );
  });
});

describe('cuando vale la reescrita', () => {
  const selladaConTexto = { ...sealed, memory: memoria() };

  it('solo atada al mismo enganche, personaje y ultima sellada en secuencia y fecha', () => {
    expect(relinkApplies(fila(), owner, sealed)).toBe(true);
    expect(relinkApplies(fila({ status: 'applied' }), owner, sealed)).toBe(true);
    expect(relinkApplies(fila({ ownerEventId: OTHER_EVENT }), owner, sealed)).toBe(false);
    expect(relinkApplies(fila({ characterId: 'otra' }), owner, sealed)).toBe(false);
    expect(relinkApplies(fila(), owner, { ...sealed, sequence: 7 })).toBe(false);
    // el mismo numero reutilizado con otra fecha es otra memoria
    expect(relinkApplies(fila(), owner, { ...sealed, createdAt: '2026-09-21T10:05:00.000Z' })).toBe(false);
    expect(relinkApplies(fila(), owner, null)).toBe(false);
    expect(relinkApplies(fila({ status: 'discarded' }), owner, sealed)).toBe(false);
    expect(relinkApplies(fila({ status: 'failed', memory: null }), owner, sealed)).toBe(false);
    expect(relinkApplies(fila(), { ...owner, source: 'turn' }, sealed)).toBe(false);
  });

  it('la efectiva es la reescrita solo mientras esta atada', () => {
    const reescrita = fila();
    expect(effectiveSealedMemory({ sealed: selladaConTexto, relink: reescrita, owner })).toEqual({
      memory: reescrita.memory,
      rewritten: true,
    });
    expect(
      effectiveSealedMemory({ sealed: { ...selladaConTexto, sequence: 9 }, relink: reescrita, owner }),
    ).toEqual({ memory: selladaConTexto.memory, rewritten: false });
    expect(effectiveSealedMemory({ sealed: null, relink: reescrita, owner })).toEqual({
      memory: null,
      rewritten: false,
    });
  });

  it('el prompt con la reescrita sale igual que el de una nacida con esa memoria', () => {
    const reescrita = fila().memory!;
    const efectiva = effectiveSealedMemory({ sealed: selladaConTexto, relink: fila(), owner });
    const turnos = [{ sequence: 0, createdAt: '2026-09-20T10:00:00.000Z' }];
    const deLaEnganchada = chooseConversationMemory({ sealed: efectiva.memory, entry: undefined, turns: turnos });
    const deLaNacida = chooseConversationMemory({ sealed: reescrita, entry: undefined, turns: turnos });
    expect(deLaEnganchada).toEqual(deLaNacida);
    const prompt = (m: typeof deLaNacida) =>
      buildVaultPrompt({
        memory: m.memory,
        memorySource: m.source,
        memoryGaps: m.gaps,
        turns: [],
        message: 'hola inventado',
        instructions: null,
        character: 'Nora es una pintora inventada.',
        canGenerateImage: false,
      });
    expect(prompt(deLaEnganchada)).toBe(prompt(deLaNacida));
  });
});

describe('en que punto esta, y si hay que llamar al CLI', () => {
  it('las fases que no se ven en el estado', () => {
    expect(relinkPhase(undefined, owner, sealed)).toBe('pending');
    expect(relinkPhase(undefined, owner, null)).toBe('none');
    expect(relinkPhase(fila({ ownerEventId: OTHER_EVENT }), owner, sealed)).toBe('pending');
    expect(relinkPhase(fila(), owner, sealed)).toBe('ready');
    // lista pero se sello otra entre medias sin usarla: sigue pendiente
    expect(relinkPhase(fila(), owner, { ...sealed, sequence: 7 })).toBe('pending');
    expect(relinkPhase(fila({ status: 'applied' }), owner, sealed)).toBe('in-use');
    // usada, y la sellada despues salio de ella: cumplio
    expect(relinkPhase(fila({ status: 'applied' }), owner, { ...sealed, sequence: 7 })).toBe('done');
    expect(relinkPhase(fila(), { ...owner, source: 'turn' }, sealed)).toBe('none');
    expect(relinkPhase(fila({ status: 'not-needed', basedOn: null, memory: null }), owner, sealed)).toBe(
      'not-needed',
    );
  });

  it('una negativa solo se reintenta con el otro CLI o a mano', () => {
    const negada = fila({ status: 'failed', failure: 'refused', memory: null, provider: 'claude' });
    const base = { entry: negada, force: false, failedThisSession: null } as const;
    expect(relinkNeedsRun({ ...base, phase: 'failed', provider: 'claude' })).toBe(false);
    expect(relinkNeedsRun({ ...base, phase: 'failed', provider: 'codex' })).toBe(true);
    expect(relinkNeedsRun({ ...base, phase: 'failed', provider: 'claude', force: true })).toBe(true);
  });

  it('un proceso caido no se reintenta con el mismo CLI en la sesion', () => {
    expect(
      relinkNeedsRun({ phase: 'pending', entry: undefined, provider: 'codex', force: false, failedThisSession: 'codex' }),
    ).toBe(false);
    expect(
      relinkNeedsRun({ phase: 'pending', entry: undefined, provider: 'claude', force: false, failedThisSession: 'codex' }),
    ).toBe(true);
  });

  it('ni lista, ni en uso, ni cumplida, ni descartada se reescriben solas', () => {
    for (const phase of ['ready', 'in-use', 'done', 'discarded', 'not-needed', 'none'] as const) {
      expect(
        relinkNeedsRun({ phase, entry: fila(), provider: 'claude', force: false, failedThisSession: null }),
      ).toBe(false);
    }
    expect(
      relinkNeedsRun({ phase: 'discarded', entry: fila(), provider: 'claude', force: true, failedThisSession: null }),
    ).toBe(true);
  });
});
