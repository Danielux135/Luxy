import { describe, expect, it } from 'vitest';
import { storedAgentConfigSchema } from '@luxy/shared';
import {
  isSecretNameAllowedForConfig,
  secretsToInvalidateForConfigChange,
} from './config-store.js';

const BASE = {
  machineName: 'portatil',
  gatewayUrl: 'https://gateway.example',
};

function configWithHttpProvider() {
  return storedAgentConfigSchema.parse({
    ...BASE,
    providers: {
      http: [
        {
          id: 'externo',
          displayName: 'Externo',
          baseUrl: 'https://api.example/v1',
          model: 'modelo',
          apiKeyEnv: 'LUXY_HTTP_EXTERNO_API_KEY',
          enabled: true,
        },
      ],
    },
  });
}

describe('secretos de proveedores HTTP', () => {
  it('invalida la clave al eliminar el proveedor o cambiar su endpoint', () => {
    const previous = configWithHttpProvider();
    const changed = storedAgentConfigSchema.parse({
      ...previous,
      providers: {
        ...previous.providers,
        http: [{ ...previous.providers.http[0]!, baseUrl: 'https://api.other/v1' }],
      },
    });
    const removed = storedAgentConfigSchema.parse({
      ...previous,
      providers: { ...previous.providers, http: [] },
    });

    expect(secretsToInvalidateForConfigChange(previous, changed)).toContain(
      'LUXY_HTTP_EXTERNO_API_KEY',
    );
    expect(secretsToInvalidateForConfigChange(previous, removed)).toContain(
      'LUXY_HTTP_EXTERNO_API_KEY',
    );
  });

  it('solo autoriza nombres vinculados a la configuracion', () => {
    const config = configWithHttpProvider();
    expect(isSecretNameAllowedForConfig('LUXY_HTTP_EXTERNO_API_KEY', config)).toBe(true);
    expect(isSecretNameAllowedForConfig('OTRA_API_KEY', config)).toBe(false);
  });
});
