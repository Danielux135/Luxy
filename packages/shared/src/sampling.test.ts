import { describe, expect, it } from 'vitest';
import { connectionProfileSchema } from './models/types.js';
import {
  MAX_MODEL_SAMPLING_ENTRIES,
  modelSamplingSchema,
  samplingForModel,
  samplingLogFields,
  samplingParametersSchema,
  samplingRequestFields,
} from './sampling.js';
import { httpProviderConfigSchema, storedAgentConfigSchema } from './schemas.js';

// POR QUE EXISTEN: el muestreo de las familias de una conexion es la unica via
// por la que una temperatura llega al modelo de Lia (F31-REPETICION-001). Lo
// que no puede pasar es que un modelo SIN entrada empiece a mandar algo: se
// perderia el «sin» contra el que se compara y las pasarelas que devuelven 400
// ante un parametro desconocido dejarian de contestar.
describe('muestreo: lo que viaja en el cuerpo', () => {
  it('vacio no añade ni una clave', () => {
    expect(samplingRequestFields({})).toEqual({});
    expect(Object.keys(samplingRequestFields({}))).toHaveLength(0);
  });

  it('usa los nombres del contrato, en snake_case', () => {
    expect(
      samplingRequestFields({
        temperature: 1.3,
        frequencyPenalty: 0.2,
        presencePenalty: -0.1,
        repetitionPenalty: 1.05,
      }),
    ).toEqual({
      temperature: 1.3,
      frequency_penalty: 0.2,
      presence_penalty: -0.1,
      repetition_penalty: 1.05,
    });
  });

  it('un cero SI se manda', () => {
    expect(samplingRequestFields({ temperature: 0, frequencyPenalty: 0 })).toEqual({
      temperature: 0,
      frequency_penalty: 0,
    });
  });

  it('el registro lleva solo los puestos, con el nombre del esquema', () => {
    expect(samplingLogFields({})).toEqual({});
    expect(samplingLogFields({ temperature: 1.3 })).toEqual({ temperature: 1.3 });
    expect('frequencyPenalty' in samplingLogFields({ temperature: 1.3 })).toBe(false);
    expect(samplingLogFields({ temperature: 0 })).toEqual({ temperature: 0 });
  });
});

describe('muestreo: que entrada corresponde a un modelo', () => {
  const porModelo = { 'DeepSeek-V4-Flash': { temperature: 1.3 } };

  it('el modelo con entrada usa SOLO la suya, sin mezclarla con el nivel superior', () => {
    expect(samplingForModel('DeepSeek-V4-Flash', porModelo, { frequencyPenalty: 0.5 })).toEqual({
      temperature: 1.3,
    });
  });

  it('un modelo sin entrada usa el nivel superior, como antes', () => {
    expect(samplingForModel('DeepSeek-V4-Pro', porModelo, {})).toEqual({});
    expect(samplingForModel('DeepSeek-V4-Pro', porModelo, { temperature: 0.7 })).toEqual({
      temperature: 0.7,
    });
    expect(samplingForModel('DeepSeek-V4-Flash', undefined, {})).toEqual({});
  });

  it('distingue mayusculas: el nombre tiene que ser el que viaja', () => {
    expect(samplingForModel('deepseek-v4-flash', porModelo, {})).toEqual({});
  });

  it('un modelo llamado como una propiedad del prototipo no saca nada de ahi', () => {
    for (const model of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
      expect(samplingForModel(model, porModelo, {})).toEqual({});
    }
  });
});

// los dos esquemas tienen que validar EXACTAMENTE lo mismo. Se recorren los dos
// con los mismos extremos en vez de confiar en que comparten el objeto.
describe('muestreo: rangos iguales en los dos esquemas', () => {
  const proveedor = {
    id: 'kimi',
    displayName: 'Kimi',
    baseUrl: 'https://ejemplo.test/v1',
    model: 'Kimi-K2.6',
    apiKeyEnv: 'connection:x',
  };
  const esquemas: [string, (extra: Record<string, number>) => boolean][] = [
    [
      'proveedor HTTP',
      (extra) => httpProviderConfigSchema.safeParse({ ...proveedor, ...extra }).success,
    ],
    ['por modelo', (extra) => samplingParametersSchema.safeParse(extra).success],
  ];

  for (const [nombre, acepta] of esquemas) {
    it(`${nombre}: temperatura 0..2`, () => {
      expect(acepta({ temperature: 0 })).toBe(true);
      expect(acepta({ temperature: 1.3 })).toBe(true);
      expect(acepta({ temperature: 2 })).toBe(true);
      expect(acepta({ temperature: -0.1 })).toBe(false);
      expect(acepta({ temperature: 2.1 })).toBe(false);
      expect(acepta({ temperature: Number.NaN })).toBe(false);
    });

    it(`${nombre}: frecuencia y presencia -2..2`, () => {
      for (const key of ['frequencyPenalty', 'presencePenalty']) {
        expect(acepta({ [key]: -2 })).toBe(true);
        expect(acepta({ [key]: 2 })).toBe(true);
        expect(acepta({ [key]: -2.1 })).toBe(false);
        expect(acepta({ [key]: 2.1 })).toBe(false);
      }
    });

    it(`${nombre}: repeticion mayor que 0 y hasta 2`, () => {
      expect(acepta({ repetitionPenalty: 0 })).toBe(false);
      expect(acepta({ repetitionPenalty: 0.01 })).toBe(true);
      expect(acepta({ repetitionPenalty: 2 })).toBe(true);
      expect(acepta({ repetitionPenalty: 2.1 })).toBe(false);
    });
  }
});

describe('muestreo por modelo en una conexion', () => {
  const conexion = {
    id: 'hcnsec',
    displayName: 'Pasarela',
    baseUrl: 'https://api.example/v1',
  };

  it('una conexion anterior no gana la clave al volver a guardarse', () => {
    // sin `.default({})` a proposito: config.json no puede cambiar solo
    const parsed = connectionProfileSchema.parse(conexion);
    expect('modelSampling' in parsed).toBe(false);
  });

  it('se conserva entera en la ida y vuelta de la configuracion', () => {
    const modelSampling = { 'DeepSeek-V4-Flash': { temperature: 1.3 } };
    const parsed = storedAgentConfigSchema.parse({
      machineName: 'portatil',
      gatewayUrl: 'https://gateway.example',
      connections: [{ ...conexion, modelSampling }],
    });
    expect(parsed.connections[0]?.modelSampling).toEqual(modelSampling);
    const again = storedAgentConfigSchema.parse(JSON.parse(JSON.stringify(parsed)));
    expect(again.connections[0]?.modelSampling).toEqual(modelSampling);
  });

  it('rechaza una entrada vacia, una clave que no puede ser un modelo y un valor fuera de rango', () => {
    expect(modelSamplingSchema.safeParse({ 'DeepSeek-V4-Flash': {} }).success).toBe(false);
    expect(
      modelSamplingSchema.safeParse({ 'modelo con espacios': { temperature: 1 } }).success,
    ).toBe(false);

    const fuera = connectionProfileSchema.safeParse({
      ...conexion,
      modelSampling: { 'DeepSeek-V4-Flash': { temperature: 2.1 } },
    });
    expect(fuera.success).toBe(false);
    // la ruta dice QUE modelo y QUE campo, que es lo que ve quien lo edito
    expect(fuera.error?.issues[0]?.path).toEqual([
      'modelSampling',
      'DeepSeek-V4-Flash',
      'temperature',
    ]);
  });

  // D-107: el razonamiento viaja en la misma entrada, pero NO por
  // `samplingRequestFields`: lo traduce su propia tabla, por modelo
  it('una entrada con solo el razonamiento vale, y vacia se sigue rechazando', () => {
    expect(modelSamplingSchema.safeParse({ 'Qwen3.8-27B': { reasoningMode: 'off' } }).success).toBe(
      true,
    );
    expect(modelSamplingSchema.safeParse({ 'Qwen3.8-27B': {} }).success).toBe(false);
    // solo los tres valores de la pantalla: ni los del cuerpo ni otros niveles
    for (const valor of ['medium', 'none', 'max', 'disabled', '']) {
      expect(
        modelSamplingSchema.safeParse({ 'Qwen3.8-27B': { reasoningMode: valor } }).success,
        valor,
      ).toBe(false);
    }
  });

  it('el razonamiento no sale nunca por los campos de muestreo', () => {
    expect(samplingRequestFields({ reasoningMode: 'off' })).toEqual({});
    expect(samplingRequestFields({ temperature: 1, reasoningMode: 'high' })).toEqual({
      temperature: 1,
    });
    expect(samplingLogFields({ reasoningMode: 'off' })).toEqual({});
  });

  it('el proveedor HTTP lo admite en el nivel superior, y sin el no gana la clave', () => {
    const proveedor = {
      id: 'groq',
      displayName: 'Groq',
      baseUrl: 'https://api.groq.com/openai/v1',
      model: 'qwen/qwen3.8-27b',
      apiKeyEnv: 'LUXY_HTTP_GROQ_API_KEY',
    };
    expect(
      httpProviderConfigSchema.parse({ ...proveedor, reasoningMode: 'off' }).reasoningMode,
    ).toBe('off');
    expect('reasoningMode' in httpProviderConfigSchema.parse(proveedor)).toBe(false);
    expect(httpProviderConfigSchema.safeParse({ ...proveedor, reasoningMode: 'x' }).success).toBe(
      false,
    );
  });

  it('pone un tope al numero de modelos', () => {
    const lleno = Object.fromEntries(
      Array.from({ length: MAX_MODEL_SAMPLING_ENTRIES }, (_, i) => [
        `modelo-${i}`,
        { temperature: 1 },
      ]),
    );
    expect(modelSamplingSchema.safeParse(lleno).success).toBe(true);
    expect(modelSamplingSchema.safeParse({ ...lleno, 'uno-mas': { temperature: 1 } }).success).toBe(
      false,
    );
  });
});
