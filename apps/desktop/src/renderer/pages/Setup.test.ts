import { describe, expect, it } from 'vitest';
import { storedAgentConfigSchema } from '@luxy/shared';
import { configWithRegisteredMachine, suggestedMachineName } from './Setup.js';

describe('registro local del onboarding', () => {
  it('propone un nombre valido a partir del hostname real', () => {
    expect(suggestedMachineName('DESKTOP_VM5J5GT')).toBe('desktop-vm5j5gt');
    expect(suggestedMachineName('---')).toBe('equipo');
    expect(suggestedMachineName(`PC-${'x'.repeat(80)}`)).toHaveLength(48);
  });

  it('conserva la ID que devuelve Gateway en la configuracion no secreta', () => {
    const config = storedAgentConfigSchema.parse({
      machineName: 'sobremesa',
      gatewayUrl: 'https://gateway.example',
    });
    const machineId = '11111111-1111-4111-8111-111111111111';

    expect(configWithRegisteredMachine(config, machineId).machineId).toBe(machineId);
    expect(configWithRegisteredMachine(config, null)).toBe(config);
  });
});
