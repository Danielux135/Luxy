import { describe, it, expect } from 'vitest';
import { routeProvider, NoProviderAvailableError, defaultRoutingStrategy } from './router.js';
import type { ProviderId } from './types.js';

const TODOS: ProviderId[] = ['claude', 'codex', 'deepseek', 'glm', 'qwen'];

describe('routeProvider - peticion explicita', () => {
  it('respeta siempre el proveedor pedido si esta disponible', () => {
    for (const provider of TODOS) {
      const decision = routeProvider({
        prompt: 'documenta el proyecto entero',
        availableProviders: TODOS,
        explicitProvider: provider,
      });
      expect(decision.provider).toBe(provider);
      expect(decision.reason).toContain('explicitamente');
    }
  });

  it('si el proveedor pedido no esta instalado, elige otro y lo explica', () => {
    const decision = routeProvider({
      prompt: 'refactoriza varios modulos',
      availableProviders: ['codex'],
      explicitProvider: 'claude',
    });
    expect(decision.provider).toBe('codex');
    expect(decision.reason).toContain('no esta disponible');
    expect(decision.unavailable).toContain('claude');
  });
});

describe('routeProvider - modo automatico', () => {
  it('elige Claude para cambios complejos en varios archivos', () => {
    const decision = routeProvider({
      prompt: 'refactoriza la arquitectura del modulo de autenticacion',
      availableProviders: TODOS,
    });
    expect(decision.provider).toBe('claude');
    expect(decision.reason).toContain('varios archivos');
  });

  it('elige Codex para una correccion concreta y verificable', () => {
    const decision = routeProvider({
      prompt: 'corrige el bug que hace fallar el test de login',
      availableProviders: TODOS,
    });
    expect(decision.provider).toBe('codex');
    expect(decision.reason).toContain('verificar');
  });

  it('elige una API china para analizar logs largos', () => {
    const decision = routeProvider({
      prompt: `analiza estos logs y diagnostica el problema ${'x'.repeat(3000)}`,
      availableProviders: TODOS,
    });
    expect(['deepseek', 'glm', 'qwen']).toContain(decision.provider);
    expect(decision.reason).toContain('analisis');
  });

  it('elige Qwen o GLM para documentacion extensa', () => {
    const decision = routeProvider({
      prompt: 'documenta la guia de instalacion y actualiza el readme',
      availableProviders: TODOS,
    });
    expect(['qwen', 'glm', 'deepseek']).toContain(decision.provider);
    expect(decision.reason).toContain('documentacion');
  });

  it('usa Claude por defecto cuando no hay señales claras', () => {
    const decision = routeProvider({ prompt: 'haz algo con esto', availableProviders: TODOS });
    expect(decision.provider).toBe('claude');
    expect(decision.reason).toContain('por defecto');
  });

  it('funciona sin tildes y con mayusculas', () => {
    const decision = routeProvider({
      prompt: 'REFACTORIZA LA ARQUITECTURA',
      availableProviders: TODOS,
    });
    expect(decision.provider).toBe('claude');
  });
});

describe('routeProvider - disponibilidad limitada', () => {
  it('nunca devuelve un proveedor que no este disponible', () => {
    const prompts = [
      'refactoriza la arquitectura',
      'corrige el bug del test',
      'documenta el readme',
      'analiza estos logs',
      'haz algo',
    ];
    for (const prompt of prompts) {
      const decision = routeProvider({ prompt, availableProviders: ['qwen'] });
      expect(decision.provider).toBe('qwen');
    }
  });

  it('cae a Claude si las APIs http no estan disponibles para documentacion', () => {
    const decision = routeProvider({
      prompt: 'documenta la guia completa',
      availableProviders: ['claude', 'codex'],
    });
    expect(['claude', 'codex']).toContain(decision.provider);
  });

  it('lanza un error claro si no hay ningun proveedor', () => {
    expect(() => routeProvider({ prompt: 'algo', availableProviders: [] })).toThrow(
      NoProviderAvailableError,
    );
  });
});

describe('routeProvider - determinismo', () => {
  it('la misma entrada produce siempre la misma salida', () => {
    const input = { prompt: 'corrige el error del login', availableProviders: TODOS };
    const primera = routeProvider(input);
    for (let i = 0; i < 20; i += 1) {
      expect(routeProvider(input)).toEqual(primera);
    }
  });
});

describe('defaultRoutingStrategy', () => {
  it('expone el router determinista con un identificador estable', () => {
    expect(defaultRoutingStrategy.id).toBe('deterministic-v1');
    const decision = defaultRoutingStrategy.decide({
      prompt: 'refactoriza la arquitectura',
      availableProviders: TODOS,
    });
    expect(decision).toMatchObject({ provider: 'claude' });
  });
});
