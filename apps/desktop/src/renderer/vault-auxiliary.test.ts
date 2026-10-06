// a donde va de verdad el trabajo de fondo, y que el panel lo diga bien.
//
// La prueba que importa aqui es la de la divergencia: el panel calculaba el
// destino con el proveedor de la VENTANA y las dos pasadas lo calculan sin el,
// asi que en el estado inicial de la aplicacion —«Automatico» arriba y Claude
// Code en la ventana— el boton decia Claude y el trabajo salia por Codex.
import { describe, it, expect } from 'vitest';
import { resolveAuxiliaryTarget } from '@luxy/shared';
import { auxiliaryName, backgroundAuxiliary, describeAuxiliaryFailure } from './vault-auxiliary.js';

/** lo que hay elegido en la ventana de conversacion cuando se abre Studio */
const VENTANA_CLAUDE = { provider: 'claude', model: 'claude-sonnet-5', effort: null };

describe('a quien va lo que corre por detras', () => {
  it('sin preferencia es Codex, diga lo que diga la ventana', () => {
    // es lo que hacen `relation-sync.ts` y `recap-sync.ts`: llaman con `null`
    expect(backgroundAuxiliary(null).provider).toBe('codex');
    expect(backgroundAuxiliary(null).model).toBeNull();
  });

  it('y NO coincide con el destino del catalogo, que si manda el de la ventana', () => {
    // la divergencia es real y por eso hacen falta dos nombres en el panel: con
    // uno solo, «Rehacerlo con Claude» se lo volvia a mandar a Codex
    const catalogo = resolveAuxiliaryTarget(VENTANA_CLAUDE, null);
    const fondo = backgroundAuxiliary(null);

    expect(catalogo.provider).toBe('claude');
    expect(fondo.provider).toBe('codex');
  });

  it('con preferencia elegida manda la preferencia, y las dos coinciden', () => {
    expect(backgroundAuxiliary({ provider: 'claude', model: null }).provider).toBe('claude');
    expect(backgroundAuxiliary({ provider: 'codex', model: null }).provider).toBe('codex');
  });

  it('una preferencia no se cuenta nunca como sustitucion', () => {
    // `replaced` solo es cierto cuando lo pedido era de pago, y aqui no se pide
    // nada: sin esto el panel avisaria de una sustitucion que no ha ocurrido
    expect(backgroundAuxiliary(null).replaced).toBe(false);
    expect(backgroundAuxiliary({ provider: 'claude', model: null }).replaced).toBe(false);
  });
});

describe('como se le llama en pantalla', () => {
  it('el modelo si lo hay, y si no el CLI', () => {
    expect(auxiliaryName({ provider: 'codex', model: null })).toBe('Codex');
    expect(auxiliaryName({ provider: 'claude', model: null })).toBe('Claude');
    expect(auxiliaryName({ provider: 'claude', model: 'sonnet' })).toBe('sonnet');
  });
});

// `INV-FONDO-001`: Claude Code estuvo una semana sin sesion y la pantalla no dijo
// nada. Ahora, donde se elige quien hace el trabajo de fondo, se dice que hacer
describe('el aviso cuando el CLI del trabajo de fondo no puede contestar', () => {
  it('sin sesion: dice el comando exacto y que no hace falta reiniciar', () => {
    const aviso = describeAuxiliaryFailure({ provider: 'claude', reason: 'auth' });
    expect(aviso.tone).toBe('warn');
    expect(aviso.text).toContain('Claude Code no tiene la sesión iniciada');
    expect(aviso.text).toContain('claude auth login');
    expect(aviso.text).toContain('No hace falta reiniciar');
    // propone el otro, pero no lo elige por su cuenta
    expect(aviso.text).toContain('puedes elegir Codex');
  });

  it('el limite de uso no pide nada: se espera solo', () => {
    const aviso = describeAuxiliaryFailure({ provider: 'claude', reason: 'rate_limit' });
    expect(aviso.tone).toBe('idle');
    expect(aviso.text).toContain('límite de uso');
    expect(aviso.text).not.toContain('auth login');
  });

  it('una espera de un modelo lo nombra, y dice que lo demas sigue (duodecima ronda)', () => {
    const aviso = describeAuxiliaryFailure({
      provider: 'codex',
      reason: 'api_error',
      model: 'modelo-inventado-a',
      effort: 'high',
      wholeProvider: false,
    });
    expect(aviso.text).toContain('Codex (modelo modelo-inventado-a, esfuerzo high)');
    expect(aviso.text).toContain('lo demás sigue');
    // con el CLI a secas no hay nada que nombrar ni que separar
    const aSecas = describeAuxiliaryFailure({
      provider: 'codex',
      reason: 'api_error',
      model: null,
    });
    expect(aSecas.text).not.toContain('modelo');
    expect(aSecas.text).not.toContain('lo demás sigue');
  });

  it('sin sesion es del CLI entero: no nombra ningun modelo', () => {
    const aviso = describeAuxiliaryFailure({
      provider: 'claude',
      reason: 'auth',
      model: null,
      effort: null,
      wholeProvider: true,
    });
    expect(aviso.text).not.toContain('modelo');
    expect(aviso.text).toContain('claude auth login');
  });

  it('cualquier otro fallo dice como mirarlo, sin culpar a la conversacion', () => {
    for (const reason of ['api_error', 'exit_code', null] as const) {
      const aviso = describeAuxiliaryFailure({ provider: 'codex', reason });
      expect(aviso.text).toContain('Codex no llegó a terminar');
      expect(aviso.text).toContain('ejecuta codex');
      expect(aviso.text).not.toContain('negó');
    }
  });
});
