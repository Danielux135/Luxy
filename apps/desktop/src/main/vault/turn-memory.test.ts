import { describe, expect, it } from 'vitest';
import type { ConversationMemory } from '@luxy/shared';
import { memoryOfTurn } from './turn-memory.js';

const MEMORIA: ConversationMemory = {
  version: 1,
  summary: 'lo que va pasando',
  facts: ['le gusta el faro'],
  decisions: [],
  plan: [],
  openQuestions: [],
  lessons: [],
};

describe('la memoria que cuenta en un turno privado', () => {
  it('manda la del agente, que ya la separo de la respuesta', () => {
    // el fallo de verdad: el texto ya no lleva el bloque y buscarlo ahi daba
    // `absent` en todos los turnos
    const memoria = memoryOfTurn(
      { memory: MEMORIA, memoryStatus: 'structured' },
      { memory: null, status: 'absent' },
    );
    expect(memoria).toEqual({ memory: MEMORIA, status: 'structured' });
  });

  it('una respuesta cortada informa el estado pero no guarda nada', () => {
    // el agente retiene la memoria si la respuesta no termino bien
    const memoria = memoryOfTurn({ memoryStatus: 'structured' }, { memory: null, status: 'absent' });
    expect(memoria).toEqual({ memory: null, status: 'structured' });
  });

  it('con un agente viejo que no manda el campo, se busca en el texto', () => {
    const memoria = memoryOfTurn({}, { memory: MEMORIA, status: 'structured' });
    expect(memoria).toEqual({ memory: MEMORIA, status: 'structured' });
  });

  it('un estado nulo cuenta como no enviado', () => {
    const memoria = memoryOfTurn(
      { memory: null, memoryStatus: null },
      { memory: null, status: 'invalid' },
    );
    expect(memoria.status).toBe('invalid');
  });
});
