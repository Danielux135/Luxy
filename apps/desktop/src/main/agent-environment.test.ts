import { describe, expect, it } from 'vitest';
import { buildAgentProcessEnv } from './agent-environment.js';

describe('buildAgentProcessEnv', () => {
  it('conserva solo las variables del sistema necesarias', () => {
    const env = buildAgentProcessEnv(
      {
        Path: 'C:\\Windows\\System32',
        LOCALAPPDATA: 'C:\\Users\\persona\\AppData\\Local',
        OPENAI_API_KEY: 'no-debe-pasar',
        SUPABASE_SERVICE_ROLE_KEY: 'tampoco-debe-pasar',
        LUXY_API_KEY: 'ni-las-claves-de-proveedores',
      },
      null,
    );

    expect(env).toEqual({
      Path: 'C:\\Windows\\System32',
      LOCALAPPDATA: 'C:\\Users\\persona\\AppData\\Local',
    });
  });

  it('añade la ruta explicita de node sin heredar un valor anterior', () => {
    const env = buildAgentProcessEnv(
      { LUXY_NODE_PATH: 'C:\\ruta\\manipulada.exe', TEMP: 'C:\\Temp' },
      'C:\\Program Files\\nodejs\\node.exe',
    );

    expect(env).toEqual({
      TEMP: 'C:\\Temp',
      LUXY_NODE_PATH: 'C:\\Program Files\\nodejs\\node.exe',
    });
  });
});
