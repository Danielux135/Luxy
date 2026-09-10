// pruebas del esfuerzo de razonamiento.
//
// Lo que se fija aqui es lo unico que no se puede comprobar mirando: que un
// ajuste que NO se va a aplicar se diga. El flag se descarta a proposito cuando
// el CLI instalado no lo declara —pasarselo aborta la invocacion— y ese descarte
// era silencioso hasta que lo encontro un barrido del repositorio. Nadie tenia
// una prueba que lo mirara, que es exactamente por que hacia falta.
import { describe, it, expect } from 'vitest';
import { REASONING_EFFORTS, effortIgnoredWarning, isReasoningEffort } from './constants.js';

describe('esfuerzo de razonamiento', () => {
  it('la lista va de menos a mas gasto: es el orden en que se pinta', () => {
    expect([...REASONING_EFFORTS]).toEqual(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
  });

  it('distingue un esfuerzo de una cadena cualquiera', () => {
    expect(isReasoningEffort('xhigh')).toBe(true);
    // el que trae Claude en su --help y el que Codex no tiene, cada uno en su sitio
    expect(isReasoningEffort('XHIGH')).toBe(false);
    expect(isReasoningEffort('minimal')).toBe(false);
  });
});

describe('avisar de que el esfuerzo no se aplica', () => {
  it('avisa cuando se eligio uno y el CLI no lo admite', () => {
    const aviso = effortIgnoredWarning('low', false, 'Claude Code');
    expect(aviso).not.toBeNull();
    // dice QUE pasa y QUE hacer: un aviso que solo constata deja igual
    expect(aviso).toContain('Claude Code');
    expect(aviso).toContain('actualiza el CLI');
  });

  it('calla cuando el CLI si lo admite', () => {
    expect(effortIgnoredWarning('low', true, 'Claude Code')).toBeNull();
  });

  it('y calla cuando no se eligio ninguno: no hay nada que se caiga', () => {
    // este es el caso normal, y avisar aqui seria ruido en cada turno
    expect(effortIgnoredWarning(undefined, false, 'Codex CLI')).toBeNull();
    expect(effortIgnoredWarning(undefined, true, 'Codex CLI')).toBeNull();
  });
});
