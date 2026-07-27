import { describe, it, expect, beforeEach } from 'vitest';
import { redact, redactDeep, SecretRegistry, buildSafeEnv, secretRegistry } from './redact.js';

describe('redact - patrones genericos', () => {
  it('redacta un token de bot de telegram', () => {
    const text = 'usando 123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw para el webhook';
    const result = redact(text);
    expect(result).not.toContain('AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw');
    expect(result).toContain('[REDACTADO]');
  });

  it('redacta un jwt', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N';
    expect(redact(`token=${jwt}`)).not.toContain('dozjgNryP4J3jVmNHl0w5N');
  });

  it('redacta una cabecera bearer conservando el esquema', () => {
    const result = redact('Authorization: Bearer sk-abcdefghijklmnopqrstuvwxyz123456');
    expect(result).toContain('Bearer [REDACTADO]');
    expect(result).not.toContain('abcdefghijklmnopqrstuvwxyz');
  });

  it('redacta credenciales dentro de una url conservando el usuario', () => {
    const result = redact('conectando a https://usuario:claveSuperSecreta@db.example.com/base');
    expect(result).not.toContain('claveSuperSecreta');
    expect(result).toContain('usuario');
    expect(result).toContain('db.example.com');
  });

  it('redacta variables acabadas en _KEY, _TOKEN y _SECRET', () => {
    expect(redact('SUPABASE_SERVICE_ROLE_KEY=abcd1234efgh5678')).not.toContain('abcd1234efgh5678');
    expect(redact('MACHINE_TOKEN=abcd1234efgh5678')).not.toContain('abcd1234efgh5678');
    expect(redact('WEBHOOK_SECRET: "abcd1234efgh5678"')).not.toContain('abcd1234efgh5678');
  });

  it('redacta claves con prefijos conocidos', () => {
    expect(redact('ghp_abcdefghijklmnopqrstuvwxyz1234')).toBe('[REDACTADO]');
    expect(redact('xoxb-abcdefghijklmnopqrstuvwxyz')).toBe('[REDACTADO]');
  });

  it('redacta una clave privada pem completa', () => {
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIabc123\n-----END RSA PRIVATE KEY-----';
    expect(redact(pem)).toBe('[REDACTADO]');
  });

  it('no altera texto normal', () => {
    const text = 'Se corrigio la conservacion de solutionId al seleccionar una solucion.';
    expect(redact(text)).toBe(text);
  });

  it('es idempotente', () => {
    const text = 'Authorization: Bearer sk-abcdefghijklmnopqrstuvwxyz123456';
    expect(redact(redact(text))).toBe(redact(text));
  });

  it('tolera entradas vacias', () => {
    expect(redact('')).toBe('');
  });
});

describe('SecretRegistry - valores literales conocidos', () => {
  let registry: SecretRegistry;

  beforeEach(() => {
    registry = new SecretRegistry();
  });

  it('redacta un valor registrado aunque no tenga forma de secreto', () => {
    registry.add('valor-de-aspecto-inocente-12345');
    const result = redact('el token es valor-de-aspecto-inocente-12345 ahora', registry);
    expect(result).not.toContain('valor-de-aspecto-inocente-12345');
    expect(result).toContain('[REDACTADO]');
  });

  it('ignora valores demasiado cortos para evitar falsos positivos', () => {
    registry.add('abc');
    expect(redact('abc es una palabra normal', registry)).toContain('abc');
  });

  it('carga los secretos de un entorno por el nombre de la variable', () => {
    registry.addFromEnv({
      DEEPSEEK_API_KEY: 'clave-secreta-larga-123456',
      RUTA_NORMAL: 'C:/proyectos',
    });
    expect(registry.list()).toContain('clave-secreta-larga-123456');
    expect(registry.list()).not.toContain('C:/proyectos');
  });

  it('redacta todas las apariciones de un mismo secreto', () => {
    registry.add('secreto-repetido-abcdef');
    const result = redact('secreto-repetido-abcdef y secreto-repetido-abcdef', registry);
    expect(result).not.toContain('secreto-repetido-abcdef');
  });
});

describe('redactDeep', () => {
  it('redacta valores anidados en objetos y arrays', () => {
    const input = {
      nivel1: { texto: 'Bearer sk-abcdefghijklmnopqrstuvwxyz123456' },
      lista: ['ghp_abcdefghijklmnopqrstuvwxyz1234'],
    };
    const output = JSON.stringify(redactDeep(input));
    expect(output).not.toContain('abcdefghijklmnopqrstuvwxyz');
  });

  it('redacta por completo una clave con nombre de secreto en camelCase', () => {
    const output = redactDeep({ machineToken: 'lo-que-sea', apiKey: 'x' }) as Record<string, string>;
    expect(output.machineToken).toBe('[REDACTADO]');
    expect(output.apiKey).toBe('[REDACTADO]');
  });

  it('redacta claves en SCREAMING_SNAKE', () => {
    const output = redactDeep({
      SUPABASE_SERVICE_ROLE_KEY: 'x',
      MACHINE_TOKEN: 'y',
      WEBHOOK_SECRET: 'z',
    }) as Record<string, string>;
    expect(Object.values(output)).toEqual(['[REDACTADO]', '[REDACTADO]', '[REDACTADO]']);
  });

  it('no redacta claves normales que solo se parecen', () => {
    const output = redactDeep({ monkey: 'un mono', keyboard: 'teclado' }) as Record<string, string>;
    expect(output.monkey).toBe('un mono');
    expect(output.keyboard).toBe('teclado');
  });

  it('conserva valores que no son cadenas', () => {
    const output = redactDeep({ contador: 42, activo: true, vacio: null }) as Record<string, unknown>;
    expect(output).toEqual({ contador: 42, activo: true, vacio: null });
  });
});

describe('buildSafeEnv', () => {
  const source = {
    PATH: 'C:/Windows/System32',
    TEMP: 'C:/Temp',
    DEEPSEEK_API_KEY: 'no-debe-pasar',
    GITHUB_TOKEN: 'no-debe-pasar',
    AWS_ACCESS_KEY_ID: 'no-debe-pasar',
    SSH_AUTH_SOCK: 'no-debe-pasar',
    ANTHROPIC_API_KEY: 'no-debe-pasar',
    OPENAI_API_KEY: 'no-debe-pasar',
  };

  it('solo deja pasar las variables de la lista permitida', () => {
    const env = buildSafeEnv(source, ['PATH', 'TEMP']);
    expect(env).toEqual({ PATH: 'C:/Windows/System32', TEMP: 'C:/Temp' });
  });

  it('bloquea variables sensibles aunque esten en la lista permitida', () => {
    const env = buildSafeEnv(source, [
      'PATH',
      'DEEPSEEK_API_KEY',
      'GITHUB_TOKEN',
      'AWS_ACCESS_KEY_ID',
      'SSH_AUTH_SOCK',
      'ANTHROPIC_API_KEY',
      'OPENAI_API_KEY',
    ]);
    expect(Object.keys(env)).toEqual(['PATH']);
  });

  it('nunca hereda el entorno completo', () => {
    const env = buildSafeEnv(source, []);
    expect(Object.keys(env)).toHaveLength(0);
  });
});

describe('registro global', () => {
  it('existe y acepta valores', () => {
    secretRegistry.add('valor-global-de-prueba-123');
    expect(redact('valor-global-de-prueba-123')).toBe('[REDACTADO]');
    secretRegistry.clear();
  });
});
