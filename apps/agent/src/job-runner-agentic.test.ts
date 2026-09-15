// el contexto de herramientas de un trabajo, con MAS DE UNA conexion.
//
// POR QUE EXISTE ESTE ARCHIVO: `buildAgenticContext` metia en un solo registro
// el catalogo de fabrica repetido por conexion. Ese catalogo trae las mismas 19
// ids para cualquier `connectionId` —la id es literal en `RAW_CATALOG` y lo
// unico que cambia es el campo `connectionId`—, asi que con dos conexiones
// `new ModelRegistry` lanzaba el MISMO `ModelRegistryError` del 2026-09-15,
// «hay dos modelos con la id "deepseek-v4-pro"». Y lo lanzaba al construir el
// argumento de `provider.run`, antes incluso de mirar si el modelo es agentic:
// TODO trabajo con modelo resoluble acababa en `failed` con ese mensaje.
//
// No se veia porque el `config.json` de Daniel tiene una sola conexion, pero
// `agentConfigSchema` admite dieciseis. Ninguna prueba pasaba de una: esto es
// lo que lo dejo pasar.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentConfig, ClaimedJob, ProjectConfig } from '@luxy/shared';
import { buildAgenticContext, type JobRunnerDeps } from './job-runner.js';

function connection(id: string, enabled = true) {
  return {
    id,
    displayName: id,
    baseUrl: 'https://api.ejemplo.test',
    protocol: 'openai' as const,
    headers: {},
    apiKeyEnv: `connection:${id}`,
    enabled,
    timeoutMs: 120_000,
  };
}

function configConConexiones(...ids: string[]): AgentConfig {
  return { connections: ids.map((id) => connection(id)) } as unknown as AgentConfig;
}

function job(model: string): ClaimedJob {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    shortId: 'abc123',
    prompt: 'arregla el bug',
    provider: 'deepseek',
    model,
    metadata: {},
    attachment: null,
  } as unknown as ClaimedJob;
}

const project = { alias: 'luxy', allowEdits: true } as unknown as ProjectConfig;

function deps(config: AgentConfig): JobRunnerDeps {
  return { config, emit: () => undefined } as unknown as JobRunnerDeps;
}

describe('buildAgenticContext con varias conexiones', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'luxy-agentic-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function contexto(config: AgentConfig) {
    return buildAgenticContext(
      job('DeepSeek-V4-Pro'),
      deps(config),
      root,
      project,
      new AbortController().signal,
    );
  }

  it('con una sola conexion devuelve el contexto de siempre', () => {
    const uno = contexto(configConConexiones('hcnsec'));
    expect(uno?.allowedTools.length).toBeGreaterThan(0);
  });

  it('con dos conexiones NO lanza, y da exactamente lo mismo', () => {
    const uno = contexto(configConConexiones('hcnsec'));
    const dos = contexto(configConConexiones('hcnsec', 'otra'));
    expect(dos?.allowedTools).toEqual(uno?.allowedTools);
    expect(dos?.limits).toEqual(uno?.limits);
    expect(dos?.useNativeTools).toBe(uno?.useNativeTools);
  });

  it('con las dieciseis que admite el esquema tampoco lanza', () => {
    const muchas = configConConexiones(
      ...Array.from({ length: 16 }, (_, indice) => `conexion-${indice}`),
    );
    expect(() => contexto(muchas)).not.toThrow();
    expect(contexto(muchas)?.allowedTools.length).toBeGreaterThan(0);
  });

  it('un modelo que no es agentic sigue sin contexto de herramientas', () => {
    const sinHerramientas = buildAgenticContext(
      job('step-image-edit-2'),
      deps(configConConexiones('hcnsec', 'otra')),
      root,
      project,
      new AbortController().signal,
    );
    expect(sinHerramientas).toBeUndefined();
  });

  it('sin conexiones no hay contexto, y tampoco lanza', () => {
    expect(contexto(configConConexiones())).toBeUndefined();
  });
});
