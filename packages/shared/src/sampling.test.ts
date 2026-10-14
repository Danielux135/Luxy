import { describe, expect, it } from 'vitest';
import { connectionProfileSchema } from './models/types.js';
import {
  hasOwnModelSampling,
  MAX_MODEL_SAMPLING_ENTRIES,
  modelOutputCapsSchema,
  modelSamplingSchema,
  outputCapForModel,
  samplingForModel,
  samplingLogFields,
  samplingParametersSchema,
  samplingParametersShape,
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
    // solo los siete de la pantalla (F36), que son los niveles que declara el
    // catalogo de una pasarela mas «off»
    for (const valor of ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']) {
      expect(
        modelSamplingSchema.safeParse({ 'Qwen3.8-27B': { reasoningMode: valor } }).success,
        valor,
      ).toBe(true);
    }
    // ni los del CUERPO (`none`, `disabled`), ni niveles que no existen, ni
    // vacio, ni los mismos con otra caja: la eleccion se guarda exacta
    for (const valor of ['none', 'disabled', 'ultra', '', 'OFF', 'Off', 'Max', 'HIGH', ' low']) {
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

// F36: una entrada de `providers.http` apuntada a una pasarela sirve cientos de
// modelos, y el que razona no es el predeterminado. El razonamiento y el tope
// de salida se eligen POR MODELO. Lo que no puede pasar: que una entrada
// guardada antes cambie sola, que el tope por modelo se coma el del proveedor,
// y que un modelo llamado como algo del prototipo saque un valor de ahi.
describe('ajustes por modelo en un proveedor HTTP', () => {
  const proveedor = {
    id: 'nanogpt',
    displayName: 'NanoGPT',
    baseUrl: 'https://api.nano-gpt.com/api/v1',
    model: 'TheDrummer/Cydonia-24B-v4.3',
    apiKeyEnv: 'LUXY_HTTP_NANOGPT_API_KEY',
  };
  const modelSampling = {
    'deepseek/deepseek-v4-flash': { reasoningMode: 'max' as const },
    'deepseek/deepseek-v4-pro:thinking': { temperature: 0.7, reasoningMode: 'off' as const },
  };
  const modelOutputCaps = { 'deepseek/deepseek-v4-flash': 16384 };

  it('el proveedor admite los dos mapas, y una entrada anterior no gana las claves', () => {
    const parsed = httpProviderConfigSchema.parse({ ...proveedor, modelSampling, modelOutputCaps });
    expect(parsed.modelSampling).toEqual(modelSampling);
    expect(parsed.modelOutputCaps).toEqual(modelOutputCaps);
    // el tope del proveedor sigue siendo el suyo: el del modelo va aparte
    expect(parsed.maxOutputTokens).toBe(8192);

    // sin `.default({})` a proposito: config.json no puede cambiar solo
    const anterior = httpProviderConfigSchema.parse(proveedor);
    expect('modelSampling' in anterior).toBe(false);
    expect('modelOutputCaps' in anterior).toBe(false);
    expect(anterior.maxOutputTokens).toBe(8192);
    // y con su tope puesto a mano tampoco se toca
    expect(
      httpProviderConfigSchema.parse({ ...proveedor, maxOutputTokens: 4096, modelOutputCaps })
        .maxOutputTokens,
    ).toBe(4096);
  });

  it('el tope por modelo va en su mapa: ni en la forma de muestreo ni en las conexiones', () => {
    const parsed = httpProviderConfigSchema.parse({ ...proveedor, modelOutputCaps });
    expect(outputCapForModel('deepseek/deepseek-v4-flash', parsed.modelOutputCaps)).toBe(16384);
    // metido en la forma de muestreo pisaria el `maxOutputTokens` del proveedor
    // —que extiende esa forma— y le quitaria el 8192 por defecto
    expect('maxOutputTokens' in samplingParametersShape).toBe(false);
    expect('modelOutputCaps' in samplingParametersShape).toBe(false);
    // una entrada de muestreo no lo acepta como parametro: sola, esta vacia
    expect(
      modelSamplingSchema.safeParse({ 'deepseek/deepseek-v4-flash': { maxOutputTokens: 16384 } })
        .success,
    ).toBe(false);
    // y las conexiones no lo ganan: alli el tope sigue siendo el de la familia
    const conexion = connectionProfileSchema.parse({
      id: 'hcnsec',
      displayName: 'Pasarela',
      baseUrl: 'https://api.example/v1',
      modelOutputCaps,
    });
    expect('modelOutputCaps' in conexion).toBe(false);
  });

  it('se conservan en la ida y vuelta de la configuracion', () => {
    const parsed = storedAgentConfigSchema.parse({
      machineName: 'portatil',
      gatewayUrl: 'https://gateway.example',
      providers: { http: [{ ...proveedor, modelSampling, modelOutputCaps }] },
    });
    const again = storedAgentConfigSchema.parse(JSON.parse(JSON.stringify(parsed)));
    expect(again.providers.http[0]?.modelSampling).toEqual(modelSampling);
    expect(again.providers.http[0]?.modelOutputCaps).toEqual(modelOutputCaps);
  });

  it('el error dice que modelo y que campo', () => {
    const fuera = httpProviderConfigSchema.safeParse({
      ...proveedor,
      modelSampling: { 'deepseek/deepseek-v4-flash': { reasoningMode: 'none' } },
    });
    expect(fuera.success).toBe(false);
    expect(fuera.error?.issues[0]?.path).toEqual([
      'modelSampling',
      'deepseek/deepseek-v4-flash',
      'reasoningMode',
    ]);
    const tope = httpProviderConfigSchema.safeParse({
      ...proveedor,
      modelOutputCaps: { 'deepseek/deepseek-v4-flash': 100 },
    });
    expect(tope.error?.issues[0]?.path).toEqual(['modelOutputCaps', 'deepseek/deepseek-v4-flash']);
  });

  it('el tope por modelo tiene el mismo rango que el del proveedor', () => {
    const delModelo = (valor: unknown): boolean =>
      modelOutputCapsSchema.safeParse({ 'un-modelo': valor }).success;
    const delProveedor = (valor: unknown): boolean =>
      httpProviderConfigSchema.safeParse({ ...proveedor, maxOutputTokens: valor }).success;
    for (const valor of [255, 256, 4096, 200_000, 200_001, 1024.5, -1, 0, '4096', null]) {
      expect(delModelo(valor), String(valor)).toBe(delProveedor(valor));
    }
    expect(delModelo(256)).toBe(true);
    expect(delModelo(200_000)).toBe(true);
    expect(delModelo(255)).toBe(false);
    expect(delModelo(200_001)).toBe(false);
    expect(delModelo(1024.5)).toBe(false);
  });

  it('el mapa de topes rechaza una clave que no puede ser un modelo y pone un tope de entradas', () => {
    expect(modelOutputCapsSchema.safeParse({ 'modelo con espacios': 4096 }).success).toBe(false);
    expect(modelOutputCapsSchema.safeParse({}).success).toBe(true);
    const lleno = Object.fromEntries(
      Array.from({ length: MAX_MODEL_SAMPLING_ENTRIES }, (_, i) => [`modelo-${i}`, 4096]),
    );
    expect(modelOutputCapsSchema.safeParse(lleno).success).toBe(true);
    expect(modelOutputCapsSchema.safeParse({ ...lleno, 'uno-mas': 4096 }).success).toBe(false);
  });

  it('outputCapForModel da el tope del modelo, y nada si no lo tiene', () => {
    expect(outputCapForModel('deepseek/deepseek-v4-flash', modelOutputCaps)).toBe(16384);
    expect(outputCapForModel('TheDrummer/Cydonia-24B-v4.3', modelOutputCaps)).toBeUndefined();
    expect(outputCapForModel('deepseek/deepseek-v4-flash', undefined)).toBeUndefined();
    expect(outputCapForModel('deepseek/deepseek-v4-flash', {})).toBeUndefined();
    // distingue mayusculas: el nombre tiene que ser el que viaja
    expect(outputCapForModel('DeepSeek/DeepSeek-V4-Flash', modelOutputCaps)).toBeUndefined();
    // `undefined` y no 0: quien lo usa encadena con `??` hacia el del proveedor
    expect(outputCapForModel('otro', modelOutputCaps) ?? 4096).toBe(4096);
  });

  it('un modelo llamado como algo del prototipo no saca un tope de ahi', () => {
    for (const model of ['toString', 'constructor', '__proto__', 'hasOwnProperty', 'valueOf']) {
      expect(outputCapForModel(model, modelOutputCaps), model).toBeUndefined();
      expect(outputCapForModel(model, {}), model).toBeUndefined();
    }
    // y un valor que no es un numero no llega nunca al cuerpo, venga de donde venga
    const sucio = { raro: '4096', nulo: null, infinito: Infinity } as unknown as Record<
      string,
      number
    >;
    for (const model of ['raro', 'nulo', 'infinito']) {
      expect(outputCapForModel(model, sucio), model).toBeUndefined();
    }
  });

  it('hasOwnModelSampling contesta lo mismo que usa samplingForModel', () => {
    const delProveedor = { temperature: 0.2 };
    const casos = [
      'deepseek/deepseek-v4-flash',
      'deepseek/deepseek-v4-pro:thinking',
      'TheDrummer/Cydonia-24B-v4.3',
      'DeepSeek/DeepSeek-V4-Flash',
      'toString',
      'constructor',
      '__proto__',
      'hasOwnProperty',
      '',
    ];
    for (const model of casos) {
      const propia = samplingForModel(model, modelSampling, delProveedor) !== delProveedor;
      expect(hasOwnModelSampling(model, modelSampling), model).toBe(propia);
    }
    expect(hasOwnModelSampling('deepseek/deepseek-v4-flash', modelSampling)).toBe(true);
    expect(hasOwnModelSampling('TheDrummer/Cydonia-24B-v4.3', modelSampling)).toBe(false);
    for (const model of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
      expect(hasOwnModelSampling(model, modelSampling), model).toBe(false);
    }
    expect(hasOwnModelSampling('deepseek/deepseek-v4-flash', undefined)).toBe(false);
  });

  it('un tope propio no le quita al modelo el muestreo del proveedor', () => {
    // es por lo que el tope va en un mapa hermano: dentro de la entrada de
    // muestreo, un modelo con solo tope taparia la temperatura del proveedor
    const parsed = httpProviderConfigSchema.parse({
      ...proveedor,
      temperature: 1.1,
      modelOutputCaps: { 'zai-org/glm-5.2': 32768 },
    });
    expect(hasOwnModelSampling('zai-org/glm-5.2', parsed.modelSampling)).toBe(false);
    expect(samplingForModel('zai-org/glm-5.2', parsed.modelSampling, { temperature: 1.1 })).toEqual(
      { temperature: 1.1 },
    );
    expect(outputCapForModel('zai-org/glm-5.2', parsed.modelOutputCaps)).toBe(32768);
  });
});
