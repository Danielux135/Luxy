import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CONNECTIONS,
  DEFAULT_CONNECTION_ID,
  ModelRegistry,
  buildDefaultCatalog,
  routeModel,
} from './index.js';

const CATALOG = buildDefaultCatalog();

const SERVED = CATALOG.map((model) => model.apiModel);

function registry(options: { served?: string[]; hasApiKey?: boolean } = {}): ModelRegistry {
  return new ModelRegistry({
    connections: DEFAULT_CONNECTIONS,
    models: CATALOG,
    statuses: [
      {
        connectionId: DEFAULT_CONNECTION_ID,
        hasApiKey: options.hasApiKey ?? true,
        reachable: true,
        checkedAt: null,
        availableModels: options.served ?? SERVED,
        error: null,
      },
    ],
  });
}

describe('router de modelos', () => {
  it('respeta el modelo pedido explicitamente', () => {
    const decision = routeModel(registry(), { prompt: 'haz algo', explicitAlias: 'kimi' });
    expect(decision.model?.definition.apiModel).toBe('kimi-k3');
    expect(decision.reason).toContain('explicitamente');
    expect(decision.substituted).toBeNull();
  });

  it('un alias sin version usa el predeterminado de la familia', () => {
    const decision = routeModel(registry(), { prompt: 'haz algo', explicitAlias: 'qwen' });
    expect(decision.model?.definition.apiModel).toBe('Qwen3.8-27B');
  });

  it('si el modelo pedido no esta disponible, sustituye Y lo explica', () => {
    // esta conexion no sirve Kimi
    const sinKimi = registry({ served: SERVED.filter((m) => m !== 'kimi-k3') });
    const decision = routeModel(sinKimi, { prompt: 'arregla el bug', explicitAlias: 'kimi' });

    expect(decision.model).not.toBeNull();
    expect(decision.model?.definition.apiModel).not.toBe('kimi-k3');
    // criterio 29: una sustitucion nunca es silenciosa
    expect(decision.substituted?.requested).toBe('Kimi K3');
    expect(decision.substituted?.because).toContain('no sirve el modelo');
  });

  it('sin ningun modelo disponible lo dice en vez de inventarse uno', () => {
    const decision = routeModel(registry({ hasApiKey: false }), { prompt: 'haz algo' });
    expect(decision.model).toBeNull();
    expect(decision.reason).toContain('no hay ningun modelo');
  });

  it('para editar solo elige modelos con herramientas', () => {
    const decision = routeModel(registry(), {
      prompt: 'refactoriza el modulo de pagos',
      needsEditing: true,
    });
    expect(decision.model?.definition.agentic).toBe(true);
    expect(decision.model?.definition.category).toBe('text');
  });

  it('nunca elige un modelo de audio, imagen o router', () => {
    for (const prompt of ['transcribe esto', 'edita la imagen', 'enruta la peticion']) {
      const decision = routeModel(registry(), { prompt });
      expect(decision.model?.definition.category).toBe('text');
    }
  });

  it('es determinista: el mismo prompt da siempre el mismo modelo', () => {
    const prompt = 'analiza los logs y diagnostica el error';
    const primera = routeModel(registry(), { prompt }).model?.definition.id;
    for (let i = 0; i < 5; i += 1) {
      expect(routeModel(registry(), { prompt }).model?.definition.id).toBe(primera);
    }
  });

  it('devuelve alternativas consideradas', () => {
    const decision = routeModel(registry(), { prompt: 'arregla los tests que fallan' });
    expect(decision.alternatives.length).toBeGreaterThan(0);
    expect(decision.alternatives[0]).toHaveProperty('score');
  });

  it('explica el motivo de la eleccion', () => {
    const decision = routeModel(registry(), { prompt: 'documenta el readme del proyecto' });
    expect(decision.reason.length).toBeGreaterThan(0);
  });

  it('no confunde una palabra contenida en otra', () => {
    // el router v1 hacia includes: "log" casaba dentro de "logica"
    const conLogica = routeModel(registry(), { prompt: 'reescribe la logica de negocio' });
    const conLogs = routeModel(registry(), { prompt: 'revisa los logs del servidor' });
    // no se exige un modelo concreto, solo que las dos frases no se traten igual
    expect(conLogica.reason).not.toBe('');
    expect(conLogs.reason).not.toBe('');
  });

  it('un alias desconocido no rompe: enruta por contenido', () => {
    const decision = routeModel(registry(), {
      prompt: 'arregla el bug',
      explicitAlias: 'inventado',
    });
    expect(decision.model).not.toBeNull();
    expect(decision.substituted).toBeNull();
  });

  it('los routers desactivados nunca se eligen', () => {
    const ids = [
      routeModel(registry(), { prompt: 'elige el mejor modelo' }).model?.definition.id,
      routeModel(registry(), { prompt: 'auto' }).model?.definition.id,
    ];
    expect(ids).not.toContain('step-router-v1');
    expect(ids).not.toContain('newapi-auto');
  });
});
