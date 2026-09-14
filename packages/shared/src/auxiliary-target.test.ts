import { describe, expect, it } from 'vitest';
import { isLocalCliProvider, resolveAuxiliaryTarget } from './auxiliary-target.js';

describe('a quien va el trabajo de fondo de la boveda', () => {
  it('un proveedor de pago nunca pasa: se sustituye por Codex sin su modelo ni su esfuerzo', () => {
    // el fallo de verdad: con DeepSeek en la ventana, catalogar costaba una
    // llamada de pago por conversacion
    expect(
      resolveAuxiliaryTarget({ provider: 'deepseek', model: 'deepseek-pro', effort: 'high' }, null),
    ).toEqual({ provider: 'codex', model: null, effort: null, replaced: true });
  });

  it('sin eleccion, si la ventana ya es Claude o Codex, no cambia nada', () => {
    expect(
      resolveAuxiliaryTarget({ provider: 'claude', model: 'claude-sonnet-5', effort: 'low' }, null),
    ).toEqual({ provider: 'claude', model: 'claude-sonnet-5', effort: 'low', replaced: false });
  });

  it('lo elegido en el panel manda sobre la ventana', () => {
    expect(
      resolveAuxiliaryTarget(
        { provider: 'deepseek', model: 'deepseek-pro', effort: 'high' },
        { provider: 'claude', model: null },
      ),
    ).toEqual({ provider: 'claude', model: null, effort: null, replaced: true });
  });

  it('el esfuerzo de la ventana solo vale si es el mismo proveedor', () => {
    expect(
      resolveAuxiliaryTarget(
        { provider: 'codex', model: null, effort: 'high' },
        { provider: 'codex', model: 'gpt-6' },
      ).effort,
    ).toBe('high');
    expect(
      resolveAuxiliaryTarget(
        { provider: 'claude', model: null, effort: 'high' },
        { provider: 'codex', model: null },
      ),
    ).toEqual({ provider: 'codex', model: null, effort: null, replaced: false });
  });

  it('sin nada pedido ni elegido, Codex', () => {
    expect(resolveAuxiliaryTarget(null, null)).toEqual({
      provider: 'codex',
      model: null,
      effort: null,
      replaced: false,
    });
  });

  it('solo Claude y Codex son locales', () => {
    expect(isLocalCliProvider('claude')).toBe(true);
    expect(isLocalCliProvider('codex')).toBe(true);
    expect(isLocalCliProvider('deepseek')).toBe(false);
    expect(isLocalCliProvider('')).toBe(false);
  });
});
