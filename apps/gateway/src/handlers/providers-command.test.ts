// que contesta `/providers` de Telegram.
//
// PASO DE VERDAD: `renderProviders` filtraba sobre la lista literal
// `['claude','codex','deepseek','glm','qwen']`, asi que de la maquina de Daniel
// —que anunciaba dieciseis proveedores— contestaba «casa: Claude, Codex,
// DeepSeek, GLM, Qwen». No nombraba `mistral`, ni `groq`, ni ninguna de las
// cuatro conexiones de AI Horde: justo la categoria que destapo el fallo del
// 2026-09-15, los proveedores con nombre propio de conexion. Y es la pantalla
// que se consulta para saber que se puede pedir.
import { describe, expect, it } from 'vitest';
import type { Machine, MachineCapabilities } from '@luxy/shared';
import { handleTextMessage, type CommandContext } from './commands.js';
import type { Repository } from '../repository.js';
import type { GatewayConfig } from '../env.js';
import type { Logger } from '../logger.js';
import type { TelegramClient } from '../telegram.js';

function capacidades(httpProviders: string[]): MachineCapabilities {
  const presente = { available: true, version: '1.0', path: 'C:/x' };
  const ausente = { available: false, version: null, path: null };
  return {
    git: presente,
    node: presente,
    npm: presente,
    claude: presente,
    codex: presente,
    flutter: ausente,
    httpProviders,
  };
}

/** los dieciseis que el agente dio de alta de verdad en la maquina de Daniel */
const ANUNCIADOS = [
  'mistral',
  'groq',
  'horde-cydonia',
  'horde-behemoth',
  'horde-safeword',
  'horde-stheno',
  'ovh-nemo',
  'deepseek',
  'glm',
  'kat',
  'kimi',
  'minimax',
  'qwen',
  'step',
];

function maquina(httpProviders: string[]): Machine {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'casa',
    hostname: 'DESKTOP',
    platform: 'win32',
    platformVersion: '11',
    agentVersion: '0.1.0',
    capabilities: capacidades(httpProviders),
    projects: ['luxy'],
    lastSeenAt: new Date().toISOString(),
    enabled: true,
  } as Machine;
}

function contexto(machines: Machine[]): CommandContext {
  return {
    config: { botUsername: 'luxy_bot' } as GatewayConfig,
    repo: { listMachines: async () => machines } as unknown as Repository,
    telegram: {} as TelegramClient,
    logger: { info: () => {}, warn: () => {}, error: () => {} } as unknown as Logger,
    chatId: 1,
    userId: 1,
    username: 'daniel',
    isPrivateChat: true,
    isReplyToBot: false,
    quotedText: null,
  };
}

describe('/providers', () => {
  it('nombra los proveedores con nombre propio de conexion', async () => {
    const reply = await handleTextMessage(contexto([maquina(ANUNCIADOS)]), '/providers');
    const texto = reply!.text;
    for (const esperado of ['Groq', 'horde-cydonia', 'ovh-nemo', 'Mistral']) {
      expect(texto.toLowerCase()).toContain(esperado.toLowerCase());
    }
  });

  it('sigue nombrando las familias y los CLI locales', async () => {
    const reply = await handleTextMessage(contexto([maquina(ANUNCIADOS)]), '/providers');
    for (const esperado of ['Claude', 'Codex', 'DeepSeek', 'GLM', 'Qwen', 'Kimi']) {
      expect(reply!.text).toContain(esperado);
    }
  });

  it('no inventa lo que la maquina no anuncia', async () => {
    const reply = await handleTextMessage(contexto([maquina([])]), '/providers');
    expect(reply!.text).toContain('Claude');
    expect(reply!.text).not.toContain('DeepSeek');
    expect(reply!.text).not.toContain('Groq');
  });
});
