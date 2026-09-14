// a donde va de verdad el trabajo de fondo, y que el panel lo diga bien.
//
// La prueba que importa aqui es la de la divergencia: el panel calculaba el
// destino con el proveedor de la VENTANA y las dos pasadas lo calculan sin el,
// asi que en el estado inicial de la aplicacion —«Automatico» arriba y Claude
// Code en la ventana— el boton decia Claude y el trabajo salia por Codex.
import { describe, it, expect } from 'vitest';
import { resolveAuxiliaryTarget } from '@luxy/shared';
import { auxiliaryName, backgroundAuxiliary } from './vault-auxiliary.js';

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
