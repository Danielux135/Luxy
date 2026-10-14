// POR QUE EXISTEN (D-107): el razonamiento se añadio PARA PROBARLO, sin saber
// si la pasarela lo deja pasar. Lo que no puede pasar es: (1) que vacio mande
// algo, (2) que a un modelo se le ofrezca un valor que su documentacion no
// admite —en GLM-5.3 apagarlo da error; en DeepSeek, encenderlo rompe los
// trabajos con herramientas—, y (3) que la cifra que dice si razono salga a
// disco tapada por `redactDeep`.
import { describe, expect, it } from 'vitest';
import {
  bareHost,
  catalogDialectFor,
  classifyReasoningEvidence,
  countReasoningTagChars,
  REASONING_JUDGE_MIN_OUTPUT,
  REASONING_MODE_LABELS,
  REASONING_MODE_SHORT,
  REASONING_MODES,
  REASONING_NOT_SENT,
  reasoningLogFields,
  reasoningModeSchema,
  reasoningModesFromDeclared,
  reasoningNoteFor,
  reasoningOptionsFor,
  reasoningRequestFields,
  type CatalogDialect,
  type ReasoningMode,
} from './reasoning-control.js';
import { isSecretKeyName, redactDeep } from './redact.js';

const PASARELA = 'api.hcnsec.cn';
const GROQ = 'api.groq.com';
const NANOGPT = 'api.nano-gpt.com';
const NANOGPT_WEB = 'nano-gpt.com';

describe('razonamiento: que se ofrece a cada modelo', () => {
  it('DeepSeek-V4 solo se puede apagar: encenderlo seria un fallo nuevo', () => {
    for (const model of ['DeepSeek-V4-Flash', 'DeepSeek-V4-Pro', 'DeepSeek-V4.1-Flash']) {
      expect(reasoningOptionsFor(model, PASARELA)).toEqual(['off']);
    }
    // y el cuerpo lleva exactamente lo documentado
    expect(reasoningRequestFields('DeepSeek-V4-Flash', PASARELA, 'off')).toEqual({
      thinking: { type: 'disabled' },
    });
    expect(reasoningRequestFields('DeepSeek-V4-Flash', PASARELA, 'high')).toEqual({});
    // solo los tres de la tabla: V4.1-Pro no esta comprobado en su documentacion
    for (const model of ['DeepSeek-V4.1-Pro', 'deepseek-chat', 'DeepSeek-V3.2', 'DeepSeek-V4-Flash-free']) {
      expect(reasoningOptionsFor(model, PASARELA), model).toEqual([]);
    }
    // la medida es de una pasarela y un dia, y la nota no la afirma de otras
    expect(reasoningNoteFor('DeepSeek-V4-Flash', 'otra.example')).toContain('en otra conexión no se ha medido');
  });

  it('GLM-5.3 NO ofrece apagar: su documentacion dice que da error', () => {
    for (const model of ['glm-5.3', 'glm-5.3-flash', 'GLM-5.3-FLASH']) {
      expect(reasoningOptionsFor(model, PASARELA)).toEqual(['low', 'high']);
      expect(reasoningRequestFields(model, PASARELA, 'off')).toEqual({});
    }
    expect(reasoningRequestFields('glm-5.3', PASARELA, 'low')).toEqual({ reasoning_effort: 'low' });
  });

  it('una variante de GLM-5.3 no cae en la regla de los GLM que se apagan', () => {
    // el fallo de la refutacion: con un limite de palabra tras el «5»,
    // `glm-5.3-air` casaba con la regla de GLM-5 y se le ofrecia «Sin razonar»,
    // que en la serie 5.3 da error
    for (const model of ['glm-5.3-air', 'glm-5.3-flash-promo', 'glm-5.4', 'glm-5.3-flash-250101']) {
      expect(reasoningOptionsFor(model, PASARELA)).toEqual([]);
      expect(reasoningRequestFields(model, PASARELA, 'off')).toEqual({});
    }
  });

  it('GLM-5.2 se apaga o va a high; low no se ofrece porque es high', () => {
    expect(reasoningOptionsFor('glm-5.2', PASARELA)).toEqual(['off', 'high']);
    expect(reasoningOptionsFor('glm-5', PASARELA)).toEqual(['off']);
    expect(reasoningOptionsFor('glm-4.6', PASARELA)).toEqual(['off']);
  });

  it('la nota de GLM-5.2 no dice que falte «low»: Z.AI lo acepta y lo trata como high', () => {
    // la documentacion dice «`low` and `medium` will be mapped to `high`». No se
    // ofrece porque prometeria menos razonamiento del que da, pero la pantalla
    // no puede afirmar que no lo admite (novena ronda)
    const nota = reasoningNoteFor('glm-5.2', PASARELA) ?? '';
    expect(nota).not.toContain('No admite');
    expect(nota).toContain('igual que «high»');
    expect(reasoningRequestFields('glm-5.2', PASARELA, 'low')).toEqual({});
    expect(reasoningRequestFields('glm-5.2', PASARELA, 'off')).toEqual({
      thinking: { type: 'disabled' },
    });
  });

  it('los GLM que se apagan avisan de que la guia de Z.AI se contradice', () => {
    // la pagina de cada modelo admite `disabled`; la guia de razonamiento solo
    // lo nombra para GLM-5.2. La nota no puede prometer que funciona sin mas
    for (const model of ['glm-5.1', 'glm-5', 'glm-4.6', 'glm-4.5']) {
      expect(reasoningOptionsFor(model, PASARELA), model).toEqual(['off']);
      expect(reasoningRequestFields(model, PASARELA, 'off'), model).toEqual({
        thinking: { type: 'disabled' },
      });
      const nota = reasoningNoteFor(model, PASARELA) ?? '';
      expect(nota, model).toContain('solo lo nombra para GLM-5.2');
      expect(nota, model).toContain('«Lo que traiga el modelo»');
    }
    // y ninguno pide un esfuerzo: `reasoning_effort` es de la 5.2 en adelante
    for (const mode of ['low', 'high'] as const) {
      expect(reasoningRequestFields('glm-5.1', PASARELA, mode)).toEqual({});
    }
  });

  it('kimi-k3 razona siempre: solo bajar, sin mandar `thinking`', () => {
    expect(reasoningOptionsFor('kimi-k3', PASARELA)).toEqual(['low', 'high']);
    expect(reasoningRequestFields('kimi-k3', PASARELA, 'high')).toEqual({
      reasoning_effort: 'high',
    });
  });

  it('Qwen de la pasarela manda las dos formas al apagar, y solo apagar', () => {
    expect(reasoningOptionsFor('Qwen3.8-27B', PASARELA)).toEqual(['off']);
    expect(reasoningRequestFields('Qwen3.8-27B', PASARELA, 'off')).toEqual({
      enable_thinking: false,
      chat_template_kwargs: { enable_thinking: false },
    });
    // qwen3.8-max: solo lo que vale con cualquiera de sus dos lecturas
    expect(reasoningOptionsFor('qwen3.8-max', PASARELA)).toEqual(['off']);
    // Flash-Next no esta en la documentacion: sin regla
    expect(reasoningOptionsFor('Qwen3.8-Flash-Next', PASARELA)).toEqual([]);
  });

  it('las reglas de Groq solo valen en Groq', () => {
    expect(reasoningOptionsFor('qwen/qwen3.8-27b', GROQ)).toEqual(['off', 'low', 'high']);
    expect(reasoningRequestFields('qwen/qwen3.8-27b', GROQ, 'off')).toEqual({
      reasoning_effort: 'none',
    });
    // low/high piden el razonamiento aparte: con `raw`, que es el defecto,
    // llegaria DENTRO de la respuesta
    expect(reasoningRequestFields('qwen/qwen3.8-27b', GROQ, 'low')).toEqual({
      reasoning_effort: 'low',
      reasoning_format: 'parsed',
    });
    expect(reasoningOptionsFor('openai/gpt-oss-20b', GROQ)).toEqual(['low', 'high']);
    expect(reasoningOptionsFor('openai/gpt-oss-120b', 'api.groq.com:443')).toEqual(['low', 'high']);
    // el mismo nombre en OpenRouter no recibe el dialecto de Groq
    expect(reasoningOptionsFor('openai/gpt-oss-20b', 'openrouter.ai')).toEqual([]);
    expect(reasoningOptionsFor('qwen/qwen3.8-27b', null)).toEqual([]);
    expect(reasoningOptionsFor('openai/gpt-oss-20b', 'https://api.groq.com/openai/v1')).toEqual([
      'low',
      'high',
    ]);
  });

  it('un modelo sin regla no recibe nada, ni con un valor escrito a mano', () => {
    expect(REASONING_MODES).toHaveLength(7);
    for (const model of ['step-5-preview', 'hy4', 'auto', 'toString', 'constructor', '']) {
      expect(reasoningOptionsFor(model, PASARELA)).toEqual([]);
      expect(reasoningNoteFor(model, PASARELA)).toBeNull();
      for (const mode of REASONING_MODES) {
        expect(reasoningRequestFields(model, PASARELA, mode), `${model} ${mode}`).toEqual({});
        expect(reasoningLogFields(model, PASARELA, mode)).toEqual({
          reasoningMode: mode,
          reasoningSent: REASONING_NOT_SENT,
        });
      }
    }
  });

  // F36 añadio cuatro modos al vocabulario para lo que declara el catalogo de
  // una pasarela. La tabla no los gana: sus reglas salen de la documentacion de
  // cada fabricante, y ninguna de las leidas respalda esos niveles
  it('ninguna regla de la tabla gana un modo nuevo', () => {
    const deSiempre: readonly ReasoningMode[] = ['off', 'low', 'high'];
    const nuevos = REASONING_MODES.filter((mode) => !deSiempre.includes(mode));
    expect(nuevos).toEqual(['minimal', 'medium', 'xhigh', 'max']);

    // un nombre por cada alternativa de cada regla, con lo que ofrecia antes
    const tabla: readonly (readonly [string, string, readonly ReasoningMode[]])[] = [
      ['DeepSeek-V4-Flash', PASARELA, ['off']],
      ['DeepSeek-V4-Pro', PASARELA, ['off']],
      ['DeepSeek-V4.1-Flash', PASARELA, ['off']],
      ['glm-5.3', PASARELA, ['low', 'high']],
      ['glm-5.3-flash', PASARELA, ['low', 'high']],
      ['glm-5.2', PASARELA, ['off', 'high']],
      ['glm-4.5', PASARELA, ['off']],
      ['glm-4.6', PASARELA, ['off']],
      ['glm-5', PASARELA, ['off']],
      ['glm-5.1', PASARELA, ['off']],
      ['kimi-k3', PASARELA, ['low', 'high']],
      ['mimo-v2.5', PASARELA, ['off']],
      ['mimo-v2.5-pro', PASARELA, ['off']],
      ['mimo-v2.6-flash', PASARELA, ['off']],
      ['mimo-v2.6-pro', PASARELA, ['off']],
      ['mimo-v2.6-pro-ultraspeed', PASARELA, ['off']],
      ['MiniMax-M3', PASARELA, ['off']],
      ['Qwen3.8-27B', PASARELA, ['off']],
      ['qwen3.8-flash', PASARELA, ['off']],
      ['qwen3.8-max', PASARELA, ['off']],
      ['qwen/qwen3.8-27b', GROQ, ['off', 'low', 'high']],
      ['openai/gpt-oss-20b', GROQ, ['low', 'high']],
      ['openai/gpt-oss-120b', GROQ, ['low', 'high']],
    ];
    for (const [model, host, ofrecia] of tabla) {
      expect(reasoningOptionsFor(model, host), model).toEqual(ofrecia);
      for (const mode of nuevos) {
        expect(reasoningRequestFields(model, host, mode), `${model} ${mode}`).toEqual({});
        expect(reasoningLogFields(model, host, mode).reasoningSent, `${model} ${mode}`).toBe(
          REASONING_NOT_SENT,
        );
      }
    }
  });

  it('en un host sin dialecto, lo que sepa la pantalla o el agente no cambia nada', () => {
    // el ultimo parametro solo se mira en un host con dialecto de catalogo: alli
    // decide, y aqui manda la tabla, con o sin el
    expect(reasoningOptionsFor('DeepSeek-V4-Flash', NANOGPT, { declared: ['max'] })).toEqual([
      'max',
    ]);
    expect(reasoningOptionsFor('DeepSeek-V4-Flash', PASARELA, { declared: ['max'] })).toEqual([
      'off',
    ]);
    expect(
      reasoningOptionsFor('DeepSeek-V4-Flash', PASARELA, { declared: ['max'], manual: true }),
    ).toEqual(['off']);
    expect(reasoningOptionsFor('step-5-preview', PASARELA, { manual: true })).toEqual([]);
    expect(reasoningNoteFor('step-5-preview', PASARELA, { manual: true })).toBeNull();
    expect(reasoningNoteFor('glm-5.2', PASARELA, { declared: ['none'] })).toBe(
      reasoningNoteFor('glm-5.2', PASARELA),
    );
    // sin entrada propia tambien viaja: es el camino de Groq por el nivel superior
    expect(reasoningRequestFields('qwen/qwen3.8-27b', GROQ, 'off', { ownEntry: false })).toEqual({
      reasoning_effort: 'none',
    });
    // y con herramientas sale lo mismo que salia
    expect(reasoningRequestFields('kimi-k3', PASARELA, 'high', { withTools: true })).toEqual({
      reasoning_effort: 'high',
    });
    expect(reasoningLogFields('kimi-k3', PASARELA, 'high', { withTools: true })).toEqual({
      reasoningMode: 'high',
      reasoningSent: 'reasoning_effort',
    });
  });

  it('vacio no manda nada a ningun modelo', () => {
    expect(reasoningRequestFields('DeepSeek-V4-Flash', PASARELA, undefined)).toEqual({});
    expect(reasoningLogFields('DeepSeek-V4-Flash', PASARELA, undefined)).toEqual({});
  });

  it('devuelve una copia: tocar el cuerpo no toca la tabla', () => {
    const primero = reasoningRequestFields('DeepSeek-V4-Flash', PASARELA, 'off');
    (primero['thinking'] as { type: string }).type = 'enabled';
    expect(reasoningRequestFields('DeepSeek-V4-Flash', PASARELA, 'off')).toEqual({
      thinking: { type: 'disabled' },
    });
  });
});

// F36: los niveles que declara el catalogo de NanoGPT no caben en off/low/high
// —174 de sus 232 modelos con niveles tienen alguno fuera de esos tres, y `max`
// es justo el que declaran los DeepSeek V4—. El vocabulario crece; lo que cada
// regla de la tabla ofrece, no.
describe('razonamiento: los siete modos', () => {
  it('son siete, de menos a mas, y `off` no se renombra', () => {
    expect([...REASONING_MODES]).toEqual([
      'off',
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ]);
    for (const mode of REASONING_MODES) expect(reasoningModeSchema.parse(mode)).toBe(mode);
    // `none` es un valor del CUERPO, no de la eleccion
    for (const raro of ['none', 'disabled', 'ultra', '', 'MAX', 'Off']) {
      expect(reasoningModeSchema.safeParse(raro).success, raro).toBe(false);
    }
  });

  it('cada uno tiene su etiqueta, y las tres de antes no cambian', () => {
    expect(REASONING_MODE_LABELS).toEqual({
      off: 'Sin razonar: contesta directamente',
      minimal: 'Razonar lo mínimo (minimal)',
      low: 'Razonar poco (low)',
      medium: 'Razonar a medias (medium)',
      high: 'Razonar más (high)',
      xhigh: 'Razonar mucho (xhigh)',
      max: 'Razonar al máximo (max)',
    });
    expect(REASONING_MODE_SHORT).toEqual({
      off: 'sin razonar',
      minimal: 'lo mínimo (minimal)',
      low: 'poco (low)',
      medium: 'a medias (medium)',
      high: 'más (high)',
      xhigh: 'mucho (xhigh)',
      max: 'al máximo (max)',
    });
  });
});

// POR QUE EXISTEN (F36): en NanoGPT hay cientos de modelos y lo que se ofrece
// sale de SU catalogo, no de la tabla. Lo que no puede pasar: (1) que el modo de
// nivel de proveedor viaje a un modelo para el que nadie lo eligio, (2) que una
// llamada cuyo cuerpo lleva `tools` pida un nivel que razone —Luxy no le
// devuelve el razonamiento al modelo—, (3) que el registro diga otra cosa que
// el cuerpo, y (4) que un host que se parece a la pasarela reciba su campo.
describe('razonamiento: dialecto de catalogo', () => {
  const DEEPSEEK = 'deepseek/deepseek-v4-flash';

  it('los dos hosts de NanoGPT tienen dialecto, escritos como vengan', () => {
    for (const host of [
      NANOGPT,
      NANOGPT_WEB,
      'API.Nano-GPT.com',
      'api.nano-gpt.com:443',
      'https://api.nano-gpt.com/api/v1',
      'https://nano-gpt.com/api/v1/',
      ' https://api.nano-gpt.com/api/v1legacy ',
    ]) {
      const dialect = catalogDialectFor(host);
      expect(dialect?.family, host).toBe('nanogpt');
    }
    const dialect = catalogDialectFor(NANOGPT);
    expect(dialect).toMatchObject({
      label: 'NanoGPT',
      hosts: ['api.nano-gpt.com', 'nano-gpt.com'],
      field: 'reasoning_effort',
      catalogQuery: { detailed: 'true' },
    });
    // «off» es `none` en el cuerpo; el resto viaja con su nombre
    expect(dialect?.values).toEqual({
      off: 'none',
      minimal: 'minimal',
      low: 'low',
      medium: 'medium',
      high: 'high',
      xhigh: 'xhigh',
      max: 'max',
    });
  });

  it('los demas hosts no tienen dialecto: van por la tabla', () => {
    for (const host of [PASARELA, GROQ, 'openrouter.ai', 'localhost', '', null, undefined]) {
      expect(catalogDialectFor(host), String(host)).toBeNull();
    }
  });

  it('ofrece lo que declara el catalogo, en el orden de los modos', () => {
    expect(reasoningOptionsFor(DEEPSEEK, NANOGPT, { declared: ['none', 'high', 'max'] })).toEqual([
      'off',
      'high',
      'max',
    ]);
    // el orden es el de los modos, no el de la lista de la pasarela
    expect(
      reasoningOptionsFor(DEEPSEEK, NANOGPT, { declared: ['max', 'xhigh', 'low', 'minimal'] }),
    ).toEqual(['minimal', 'low', 'xhigh', 'max']);
    // un modelo que razona siempre no declara `none`, y no se le ofrece apagar
    expect(
      reasoningOptionsFor('openai/gpt-oss-120b', NANOGPT, { declared: ['low', 'medium', 'high'] }),
    ).toEqual(['low', 'medium', 'high']);
  });

  it('sin nada declarado no ofrece nada, y a mano ofrece los siete', () => {
    expect(reasoningOptionsFor(DEEPSEEK, NANOGPT)).toEqual([]);
    expect(reasoningOptionsFor(DEEPSEEK, NANOGPT, {})).toEqual([]);
    expect(reasoningOptionsFor(DEEPSEEK, NANOGPT, { declared: null })).toEqual([]);
    expect(reasoningOptionsFor(DEEPSEEK, NANOGPT, { declared: [] })).toEqual([]);
    expect(reasoningOptionsFor(DEEPSEEK, NANOGPT, { declared: ['turbo'] })).toEqual([]);
    expect(reasoningOptionsFor(DEEPSEEK, NANOGPT, { manual: false })).toEqual([]);
    // a mano: el catalogo se leyo sin detalle o el modelo no declara niveles
    expect(reasoningOptionsFor(DEEPSEEK, NANOGPT, { manual: true })).toEqual([...REASONING_MODES]);
    expect(reasoningOptionsFor(DEEPSEEK, NANOGPT, { manual: true, declared: null })).toEqual([
      ...REASONING_MODES,
    ]);
    // sin modelo no hay nada que elegir
    expect(reasoningOptionsFor('  ', NANOGPT, { manual: true })).toEqual([]);
    // y lo devuelto es una copia: tocarla no cambia el vocabulario
    const opciones = reasoningOptionsFor(DEEPSEEK, NANOGPT, { manual: true }) as ReasoningMode[];
    opciones.length = 0;
    expect(REASONING_MODES).toHaveLength(7);
  });

  it('la nota dice lo que DECLARA la pasarela, y sin opciones no hay nota', () => {
    expect(reasoningNoteFor(DEEPSEEK, NANOGPT)).toBeNull();
    expect(reasoningNoteFor(DEEPSEEK, NANOGPT, { declared: [] })).toBeNull();
    expect(reasoningNoteFor(DEEPSEEK, NANOGPT, { declared: ['turbo'] })).toBeNull();

    const declarada = reasoningNoteFor(DEEPSEEK, NANOGPT, { declared: ['none', 'max'] }) ?? '';
    expect(declarada).toContain('NanoGPT declara estos niveles');
    expect(declarada).toContain('no está comprobado con ninguna llamada');
    // «puede»: que pasa con un nivel que la ruta no tiene no esta garantizado
    expect(declarada).toContain('NanoGPT puede ajustarlo al más cercano o contestar con un error');

    const aMano = reasoningNoteFor(DEEPSEEK, NANOGPT, { manual: true }) ?? '';
    expect(aMano).toContain('se elige a mano y decide NanoGPT');
    // a mano no se puede decir que la pasarela declare nada de este modelo
    expect(aMano).not.toContain('declara estos niveles');

    // `D-093`: ninguna de las dos afirma nada del modelo
    for (const nota of [declarada, aMano]) {
      for (const prohibido of ['admite', 'no razona', 'verificado', 'Verificado']) {
        expect(nota, prohibido).not.toContain(prohibido);
      }
    }
  });

  it('con ajuste propio viaja el campo de la pasarela, y nada mas', () => {
    const viaja: readonly (readonly [ReasoningMode, string])[] = [
      ['off', 'none'],
      ['minimal', 'minimal'],
      ['low', 'low'],
      ['medium', 'medium'],
      ['high', 'high'],
      ['xhigh', 'xhigh'],
      ['max', 'max'],
    ];
    for (const [mode, valor] of viaja) {
      expect(reasoningRequestFields(DEEPSEEK, NANOGPT, mode, { ownEntry: true }), mode).toEqual({
        reasoning_effort: valor,
      });
    }
    // el agente no conoce el catalogo: un nivel que el modelo no declara viaja
    // igual, y decide la pasarela
    expect(
      reasoningRequestFields('TheDrummer/Cydonia-24B-v4.3', NANOGPT, 'max', { ownEntry: true }),
    ).toEqual({ reasoning_effort: 'max' });
    // vacio no manda nada, tampoco aqui
    expect(reasoningRequestFields(DEEPSEEK, NANOGPT, undefined, { ownEntry: true })).toEqual({});
    expect(reasoningRequestFields('', NANOGPT, 'max', { ownEntry: true })).toEqual({});
  });

  it('sin ajuste propio no viaja: el modo de nivel de proveedor no es de ese modelo', () => {
    for (const mode of REASONING_MODES) {
      expect(reasoningRequestFields(DEEPSEEK, NANOGPT, mode), mode).toEqual({});
      expect(reasoningRequestFields(DEEPSEEK, NANOGPT, mode, {}), mode).toEqual({});
      expect(reasoningRequestFields(DEEPSEEK, NANOGPT, mode, { ownEntry: false }), mode).toEqual(
        {},
      );
      expect(reasoningLogFields(DEEPSEEK, NANOGPT, mode, { ownEntry: false }), mode).toEqual({
        reasoningMode: mode,
        reasoningSent: REASONING_NOT_SENT,
      });
    }
    // y que si viaja con el ajuste propio, para que lo de arriba no sea un vacio
    expect(reasoningRequestFields(DEEPSEEK, NANOGPT, 'high', { ownEntry: true })).toEqual({
      reasoning_effort: 'high',
    });
  });

  it('con herramientas solo viaja «off»', () => {
    expect(
      reasoningRequestFields(DEEPSEEK, NANOGPT, 'off', { ownEntry: true, withTools: true }),
    ).toEqual({ reasoning_effort: 'none' });
    for (const mode of REASONING_MODES.filter((value) => value !== 'off')) {
      const context = { ownEntry: true, withTools: true };
      expect(reasoningRequestFields(DEEPSEEK, NANOGPT, mode, context), mode).toEqual({});
      // la misma llamada sin herramientas si lo manda
      expect(
        reasoningRequestFields(DEEPSEEK, NANOGPT, mode, { ownEntry: true, withTools: false }),
        mode,
      ).toEqual({ reasoning_effort: mode });
    }
    // sin ajuste propio, ni «off»
    expect(reasoningRequestFields(DEEPSEEK, NANOGPT, 'off', { withTools: true })).toEqual({});
  });

  it('el registro dice lo mismo que el cuerpo, con el mismo contexto', () => {
    const contextos = [
      undefined,
      {},
      { ownEntry: true },
      { ownEntry: false },
      { ownEntry: true, withTools: true },
      { ownEntry: true, withTools: false },
      { withTools: true },
    ];
    for (const context of contextos) {
      for (const mode of REASONING_MODES) {
        const claves = Object.keys(reasoningRequestFields(DEEPSEEK, NANOGPT, mode, context));
        expect(reasoningLogFields(DEEPSEEK, NANOGPT, mode, context)).toEqual({
          reasoningMode: mode,
          reasoningSent: claves.length === 0 ? REASONING_NOT_SENT : claves.join('+'),
        });
      }
      expect(reasoningLogFields(DEEPSEEK, NANOGPT, undefined, context)).toEqual({});
    }
    expect(reasoningLogFields(DEEPSEEK, NANOGPT, 'max', { ownEntry: true })).toEqual({
      reasoningMode: 'max',
      reasoningSent: 'reasoning_effort',
    });
    expect(
      reasoningLogFields(DEEPSEEK, NANOGPT, 'max', { ownEntry: true, withTools: true }),
    ).toEqual({ reasoningMode: 'max', reasoningSent: REASONING_NOT_SENT });
  });

  it('el host de la web se comporta igual que el directo', () => {
    for (const host of [NANOGPT_WEB, 'https://nano-gpt.com/api/v1', 'nano-gpt.com:443']) {
      expect(reasoningOptionsFor(DEEPSEEK, host, { declared: ['none', 'high', 'max'] })).toEqual([
        'off',
        'high',
        'max',
      ]);
      expect(reasoningRequestFields(DEEPSEEK, host, 'max', { ownEntry: true })).toEqual({
        reasoning_effort: 'max',
      });
      expect(reasoningRequestFields(DEEPSEEK, host, 'max')).toEqual({});
    }
  });

  it('un host que se parece al de NanoGPT no recibe nada', () => {
    const parecidos = [
      'api.nano-gpt.com.example.org',
      'nano-gpt.com.example.org',
      'xnano-gpt.com',
      'api-nano-gpt.com',
      'api.nanogpt.com',
      'www.nano-gpt.com',
      'eu.api.nano-gpt.com',
      'api.nano-gpt.co',
      'https://example.org/api.nano-gpt.com/v1',
      'https://api.nano-gpt.com@example.org/v1',
      'https://example.org?next=@api.nano-gpt.com',
      'https://example.org#@api.nano-gpt.com',
      'https://example.org\\@api.nano-gpt.com/v1',
    ];
    for (const host of parecidos) {
      expect(catalogDialectFor(host), host).toBeNull();
      // sin dialecto manda la tabla, y la tabla no conoce ese nombre
      expect(
        reasoningOptionsFor(DEEPSEEK, host, { declared: ['max'], manual: true }),
        host,
      ).toEqual([]);
      expect(reasoningNoteFor(DEEPSEEK, host, { manual: true }), host).toBeNull();
      for (const mode of REASONING_MODES) {
        expect(
          reasoningRequestFields(DEEPSEEK, host, mode, { ownEntry: true }),
          `${host} ${mode}`,
        ).toEqual({});
      }
    }
    // el contraste: el de verdad si
    expect(reasoningRequestFields(DEEPSEEK, NANOGPT, 'max', { ownEntry: true })).toEqual({
      reasoning_effort: 'max',
    });
  });

  it('un nombre que casaria con la tabla no la usa en un host con dialecto', () => {
    // `glm-5.2` y `DeepSeek-V4-Flash` tienen regla en la tabla, con OTROS campos
    for (const model of ['glm-5.2', 'DeepSeek-V4-Flash', 'kimi-k3', 'Qwen3.8-27B']) {
      // sin nada declarado no se ofrece lo de la tabla
      expect(reasoningOptionsFor(model, NANOGPT), model).toEqual([]);
      expect(reasoningNoteFor(model, NANOGPT), model).toBeNull();
      // el modo de nivel de proveedor, que en la tabla viajaria, aqui no
      expect(reasoningRequestFields(model, NANOGPT, 'off'), model).toEqual({});
      expect(reasoningRequestFields(model, NANOGPT, 'high'), model).toEqual({});
      // y con ajuste propio viaja el campo de la pasarela, no el de la tabla
      expect(reasoningRequestFields(model, NANOGPT, 'off', { ownEntry: true }), model).toEqual({
        reasoning_effort: 'none',
      });
      // un modo que la regla de la tabla no tiene tambien viaja: decide la pasarela
      expect(reasoningRequestFields(model, NANOGPT, 'max', { ownEntry: true }), model).toEqual({
        reasoning_effort: 'max',
      });
    }
    // en su host de siempre siguen con lo suyo
    expect(reasoningRequestFields('glm-5.2', PASARELA, 'off')).toEqual({
      thinking: { type: 'disabled' },
    });
    // y las reglas atadas a Groq no saltan aqui por compartir nombre
    expect(reasoningOptionsFor('qwen/qwen3.8-27b', NANOGPT)).toEqual([]);
    expect(reasoningRequestFields('qwen/qwen3.8-27b', NANOGPT, 'low', { ownEntry: true })).toEqual({
      reasoning_effort: 'low',
    });
  });

  it('un valor escrito a mano que no es un modo no saca nada del prototipo', () => {
    // un modo de verdad viaja con su valor del dialecto...
    expect(reasoningRequestFields(DEEPSEEK, NANOGPT, 'xhigh', { ownEntry: true })).toEqual({
      reasoning_effort: 'xhigh',
    });
    // ...y lo que no es un modo no saca de ahi ni una funcion del prototipo ni
    // el valor crudo: `none` es del cuerpo, y la eleccion se llama `off`
    for (const raro of ['toString', 'constructor', '__proto__', 'none', 'ultra', '']) {
      expect(
        reasoningRequestFields(DEEPSEEK, NANOGPT, raro as ReasoningMode, { ownEntry: true }),
        raro,
      ).toEqual({});
    }
  });

  it('devuelve un objeto nuevo cada vez: tocar el cuerpo no toca el dialecto', () => {
    const primero = reasoningRequestFields(DEEPSEEK, NANOGPT, 'max', { ownEntry: true });
    primero['reasoning_effort'] = 'none';
    primero['otro'] = true;
    expect(reasoningRequestFields(DEEPSEEK, NANOGPT, 'max', { ownEntry: true })).toEqual({
      reasoning_effort: 'max',
    });
  });
});

describe('razonamiento: lo que declara el catalogo, traducido', () => {
  // se pide dentro de cada prueba y no al definir el bloque: si el dialecto
  // faltase tiene que fallar la prueba que lo usa, no la carga del archivo
  const nano = (): CatalogDialect => {
    const dialect = catalogDialectFor(NANOGPT);
    if (dialect === null) throw new Error('NanoGPT no tiene dialecto de catalogo');
    return dialect;
  };

  it('traduce por el valor del dialecto, en orden y sin repetir', () => {
    expect(reasoningModesFromDeclared(nano(), ['none', 'high', 'max'])).toEqual([
      'off',
      'high',
      'max',
    ]);
    expect(
      reasoningModesFromDeclared(nano(), ['max', 'high', 'none', 'high', 'max', 'none']),
    ).toEqual(['off', 'high', 'max']);
    expect(
      reasoningModesFromDeclared(nano(), [
        'none',
        'minimal',
        'low',
        'medium',
        'high',
        'xhigh',
        'max',
      ]),
    ).toEqual([...REASONING_MODES]);
    expect(reasoningModesFromDeclared(nano(), [])).toEqual([]);
  });

  it('no distingue mayusculas ni espacios de alrededor', () => {
    expect(reasoningModesFromDeclared(nano(), ['NONE', ' High ', 'XHigh', 'mAx\n'])).toEqual([
      'off',
      'high',
      'xhigh',
      'max',
    ]);
  });

  it('ignora lo que no conoce sin perder lo demas', () => {
    // `off` es el nombre de Luxy, no el del catalogo: alli es `none`
    expect(
      reasoningModesFromDeclared(nano(), [
        'off',
        'disabled',
        'ultra',
        'default',
        '',
        '   ',
        'hi gh',
        'toString',
        'constructor',
        '__proto__',
        'low',
      ]),
    ).toEqual(['low']);
  });

  it('lo que no es una cadena o no es una lista no rompe nada', () => {
    const sucio = [1, null, undefined, true, {}, ['high'], 'medium', Number.NaN] as unknown;
    expect(reasoningModesFromDeclared(nano(), sucio as string[])).toEqual(['medium']);
    for (const raro of [null, undefined, 'high', 7, { 0: 'high', length: 1 }]) {
      expect(reasoningModesFromDeclared(nano(), raro as unknown as string[])).toEqual([]);
    }
    // y lo mismo cuando llega por el selector
    expect(
      reasoningOptionsFor('deepseek/deepseek-v4-flash', NANOGPT, {
        declared: sucio as string[],
      }),
    ).toEqual(['medium']);
  });
});

describe('razonamiento: el host', () => {
  it('saca el host de lo que le den', () => {
    expect(bareHost('api.groq.com')).toBe('api.groq.com');
    expect(bareHost('API.Groq.com:443')).toBe('api.groq.com');
    expect(bareHost('https://api.groq.com/openai/v1')).toBe('api.groq.com');
    expect(bareHost('https://usuario:clave@api.groq.com:8443/v1')).toBe('api.groq.com');
    expect(bareHost('  https://api.nano-gpt.com/api/v1  ')).toBe('api.nano-gpt.com');
    for (const vacio of [null, undefined, '', '   ', 'https://']) {
      expect(bareHost(vacio), String(vacio)).toBeNull();
    }
  });

  it('el host acaba donde acaba la autoridad, no solo en la barra', () => {
    // antes solo se cortaba en `/`: lo de detras de la ultima `@` se tomaba por
    // host, y estas tres salian como si fueran la pasarela
    expect(bareHost('https://example.org?next=@api.nano-gpt.com')).toBe('example.org');
    expect(bareHost('https://example.org#@api.nano-gpt.com')).toBe('example.org');
    expect(bareHost('https://example.org\\@api.nano-gpt.com/v1')).toBe('example.org');
    expect(bareHost('example.org?x=1')).toBe('example.org');
  });

  it('el esquema solo cuenta al principio de la cadena', () => {
    // antes valia el primer «://» de CUALQUIER parte: sin esquema delante, el de
    // la ruta o el de la consulta se tomaba por el del principio, y estas cuatro
    // salian como si fueran la pasarela
    expect(bareHost('example.org/ir?a=https://api.nano-gpt.com/api/v1')).toBe('example.org');
    expect(bareHost('example.org?next=https://api.nano-gpt.com')).toBe('example.org');
    expect(bareHost('example.org#https://api.nano-gpt.com')).toBe('example.org');
    expect(bareHost('example.org:8443/v1?next=https://api.nano-gpt.com')).toBe('example.org');
    // con su esquema delante ya salia bien, y sigue saliendo
    expect(bareHost('https://example.org/ir?a=https://api.nano-gpt.com')).toBe('example.org');
    expect(bareHost('http://localhost:11434/v1?next=https://api.groq.com')).toBe('localhost');
  });

  it('una cadena rara no casa por accidente con ningun host', () => {
    // lo que importa es hacia donde se falla: ante algo que no se sabe leer, a
    // NO casar —y entonces no viaja nada—, nunca a casar con la pasarela ni con
    // un host de la tabla. `URL` lee las dos primeras como `example.org`; las
    // demas ni siquiera son una URL
    const raras = (destino: string): string[] => [
      `https:example.org?next=https://${destino}`,
      `https:/example.org?next=https://${destino}`,
      `//example.org/v1?next=https://${destino}`,
      `/v1?next=https://${destino}`,
      `?next=https://${destino}`,
      `#https://${destino}`,
      `://${destino}`,
      `1x://${destino}`,
      `no es un esquema://${destino}`,
    ];
    for (const host of raras(NANOGPT)) {
      expect(bareHost(host), host).not.toBe(NANOGPT);
      expect(catalogDialectFor(host), host).toBeNull();
      for (const mode of REASONING_MODES) {
        expect(
          reasoningRequestFields('deepseek/deepseek-v4-flash', host, mode, { ownEntry: true }),
          `${host} ${mode}`,
        ).toEqual({});
      }
    }
    // y con la tabla, que tiene reglas atadas al host de Groq
    for (const host of raras(GROQ)) {
      expect(bareHost(host), host).not.toBe(GROQ);
      expect(reasoningOptionsFor('openai/gpt-oss-20b', host), host).toEqual([]);
      expect(reasoningRequestFields('openai/gpt-oss-20b', host, 'low'), host).toEqual({});
    }
  });

  it('el host con punto final es el mismo servidor', () => {
    // `api.nano-gpt.com.` es el mismo nombre escrito entero, y `URL` conserva el
    // punto en `host`: sin quitarlo, la pasarela se quedaba sin su dialecto y
    // Groq sin sus reglas
    expect(bareHost('api.nano-gpt.com.')).toBe('api.nano-gpt.com');
    expect(bareHost('API.Groq.com.:443')).toBe('api.groq.com');
    expect(bareHost('https://api.nano-gpt.com./api/v1')).toBe('api.nano-gpt.com');
    expect(catalogDialectFor('https://nano-gpt.com./api/v1')?.family).toBe('nanogpt');
    expect(reasoningOptionsFor('openai/gpt-oss-20b', 'api.groq.com.')).toEqual(['low', 'high']);
    // UNO solo: con dos ya no es un nombre de host, y un parecido sigue siendo
    // otro servidor aunque acabe en punto
    for (const otro of ['api.nano-gpt.com..', 'api.nano-gpt.com.example.org.']) {
      expect(catalogDialectFor(otro), otro).toBeNull();
    }
    for (const vacio of ['.', 'https://.', '.:443']) {
      expect(bareHost(vacio), vacio).toBeNull();
    }
  });
});

describe('razonamiento: lo que se apunta', () => {
  it('apunta el modo y las CLAVES que viajaron, nunca valores', () => {
    expect(reasoningLogFields('Qwen3.8-27B', PASARELA, 'off')).toEqual({
      reasoningMode: 'off',
      reasoningSent: 'enable_thinking+chat_template_kwargs',
    });
    expect(reasoningLogFields('step-5-preview', PASARELA, 'off')).toEqual({
      reasoningMode: 'off',
      reasoningSent: REASONING_NOT_SENT,
    });
  });

  it('ningun nombre nuevo del registro lo tapa `redactDeep`', () => {
    // `visiblePorToken`, el nombre del diseño, SI se tapaba: acaba en «rToken»
    expect(isSecretKeyName('visiblePorToken')).toBe(true);
    const linea = {
      reasoningMode: 'off',
      reasoningSent: 'enable_thinking+chat_template_kwargs',
      reasoningField: 'reasoning_content+reasoning+think',
      reasoningTagChars: 12,
      toolArgChars: 40,
      reasoningTokensReported: 900,
      charsPerOutput: 0.76,
      reasoningVerdict: 'hidden',
    };
    for (const key of Object.keys(linea)) expect(isSecretKeyName(key), key).toBe(false);
    expect(redactDeep(linea)).toEqual(linea);
  });
});

describe('razonamiento: etiquetas dentro del texto', () => {
  it('cuenta lo que hay dentro de <think>, cerrado o cortado a mitad', () => {
    expect(countReasoningTagChars('hola')).toBe(0);
    expect(countReasoningTagChars('<think>abc</think>respuesta')).toBe(3);
    expect(countReasoningTagChars('<THINKING>ab</THINKING> y <reasoning>cd</reasoning>')).toBe(4);
    // cortado: el bloque se queda abierto hasta el final
    expect(countReasoningTagChars('<think>sin cerrar')).toBe('sin cerrar'.length);
  });

  it('un bloque vacio no es razonamiento', () => {
    // lo que deja un Qwen3 hibrido con el razonamiento apagado si el servidor
    // no aparta el bloque: daba `visible` en la prueba de «Sin razonar»
    expect(countReasoningTagChars('<think>\n\n</think>\n\nHola, ¿qué tal?')).toBe(0);
    expect(countReasoningTagChars('<think>   </think>respuesta')).toBe(0);
    expect(countReasoningTagChars('<think>\n abc \n</think>respuesta')).toBe(3);
  });

  it('el cierre sin apertura: lo de antes era razonamiento', () => {
    // la plantilla puso <think> en el prompt (familia R1, QwQ)
    expect(countReasoningTagChars('pienso esto\n</think>\nLa respuesta.')).toBe('pienso esto'.length);
    // y no se cuenta dos veces si despues viene otro bloque entero
    expect(countReasoningTagChars('abc</think>texto<think>de</think>fin')).toBe(5);
    // un cierre DESPUES de una apertura es el caso normal
    expect(countReasoningTagChars('<think>abc</think>resto</think>')).toBe(3);
  });

  // octava ronda: una etiqueta citada contaba todo lo de despues, o todo lo de
  // antes, como razonamiento
  it('una etiqueta citada entre acentos graves no es razonamiento', () => {
    expect(
      countReasoningTagChars('El modelo abre `<think>` y lo cierra con `</think>`; nada mas.'),
    ).toBe(0);
    expect(countReasoningTagChars('Mira:\n```\nconst a = "<think>";\n```\nY sigue.')).toBe(0);
    expect(countReasoningTagChars('Usa `</think>` para cerrar el bloque.')).toBe(0);
    // y una de verdad se sigue contando aunque dentro haya codigo citado
    expect(countReasoningTagChars('<think>uso `x` aqui</think>respuesta')).toBe('uso   aqui'.length);
  });
});

// las cifras son las MEDIDAS en luxy.log el 2026-09-28, sin contenido
describe('razonamiento: veredicto por el cociente', () => {
  const base = {
    finalUsageReceived: true,
    toolArgChars: 0,
    reasoningChars: 0,
    reasoningTagChars: 0,
    reasoningTokensReported: 0,
  };

  it('prosa normal de DeepSeek por la pasarela: no se le nota', () => {
    expect(classifyReasoningEvidence({ ...base, outputTokens: 1000, textChars: 3340 })).toEqual({
      reasoningVerdict: 'not_seen',
      charsPerOutput: 3.34,
    });
  });

  it('Qwen3.8-27B por la pasarela (mediana 0,76): razono sin enseñarlo', () => {
    expect(classifyReasoningEvidence({ ...base, outputTokens: 1000, textChars: 760 })).toEqual({
      reasoningVerdict: 'hidden',
      charsPerOutput: 0.76,
    });
  });

  it('8192 de 8192 sin un caracter es oculto, no «sin datos»', () => {
    expect(
      classifyReasoningEvidence({ ...base, outputTokens: 8192, textChars: 0 }).reasoningVerdict,
    ).toBe('hidden');
  });

  // octava ronda: 6 caracteres en 4 tokens daban 1,5 y `hidden`
  it('una salida corta no se juzga: el token de fin pesa mas que la prosa', () => {
    expect(classifyReasoningEvidence({ ...base, outputTokens: 4, textChars: 6 })).toEqual({
      reasoningVerdict: 'unclear',
      charsPerOutput: 1.5,
    });
    expect(
      classifyReasoningEvidence({ ...base, outputTokens: 30, textChars: 55 }).reasoningVerdict,
    ).toBe('unclear');
    expect(REASONING_JUDGE_MIN_OUTPUT).toBe(64);
    expect(
      classifyReasoningEvidence({ ...base, outputTokens: 63, textChars: 0 }).reasoningVerdict,
    ).toBe('unclear');
    // con salida de sobra, un «Hecho.» tras cientos de tokens sigue siendo oculto
    expect(
      classifyReasoningEvidence({ ...base, outputTokens: 64, textChars: 6 }).reasoningVerdict,
    ).toBe('hidden');
    expect(
      classifyReasoningEvidence({ ...base, outputTokens: 500, textChars: 6 }).reasoningVerdict,
    ).toBe('hidden');
  });

  it('entre los dos umbrales no se afirma nada', () => {
    expect(
      classifyReasoningEvidence({ ...base, outputTokens: 1000, textChars: 2400 }).reasoningVerdict,
    ).toBe('unclear');
  });

  it('una vuelta que solo pide una herramienta NO es un falso oculto', () => {
    // el fallo de la refutacion: sin contar los argumentos, cociente ~0
    const sinTexto = { ...base, outputTokens: 60, textChars: 0, toolArgChars: 200 };
    expect(classifyReasoningEvidence(sinTexto)).toEqual({
      reasoningVerdict: 'unclear',
      charsPerOutput: 3.33,
    });
    // el de la septima: `read_file` con `{"path":"src/a.ts"}` en DeepSeek-V4 sin
    // razonar. Unos 9 tokens de nombre y argumentos y unos 10 de envoltura que
    // no llegan como texto: el cociente cae a 1,12 y salia `hidden`
    expect(
      classifyReasoningEvidence({ ...base, outputTokens: 25, textChars: 0, toolArgChars: 28 }),
    ).toEqual({ reasoningVerdict: 'unclear', charsPerOutput: 1.12 });
  });

  it('con prosa de sobra alrededor, la herramienta ya no impide juzgar', () => {
    expect(
      classifyReasoningEvidence({ ...base, outputTokens: 1000, textChars: 399, toolArgChars: 20 })
        .reasoningVerdict,
    ).toBe('unclear');
    expect(
      classifyReasoningEvidence({ ...base, outputTokens: 400, textChars: 450, toolArgChars: 20 })
        .reasoningVerdict,
    ).toBe('hidden');
    expect(
      classifyReasoningEvidence({ ...base, outputTokens: 300, textChars: 1000, toolArgChars: 20 })
        .reasoningVerdict,
    ).toBe('not_seen');
  });

  it('lo declarado y lo visible mandan sobre el cociente', () => {
    expect(
      classifyReasoningEvidence({
        ...base,
        outputTokens: 1000,
        textChars: 3300,
        reasoningTokensReported: 400,
      }).reasoningVerdict,
    ).toBe('counted');
    expect(
      classifyReasoningEvidence({
        ...base,
        outputTokens: 1000,
        textChars: 3300,
        reasoningChars: 50,
      }).reasoningVerdict,
    ).toBe('visible');
    // <think> dentro del texto: el cociente lo veria como prosa normal
    expect(
      classifyReasoningEvidence({
        ...base,
        outputTokens: 1000,
        textChars: 3300,
        reasoningTagChars: 2000,
      }).reasoningVerdict,
    ).toBe('visible');
  });

  it('razono y se ve no sale igual que razono y la pasarela no lo deja pasar', () => {
    // con el recuento decidido primero, los dos salian `counted` y el veredicto
    // no decia lo que `D-107` quiere saber de la pasarela (novena ronda)
    const declarado = {
      ...base,
      outputTokens: 1000,
      textChars: 3300,
      reasoningTokensReported: 400,
    };
    expect(classifyReasoningEvidence({ ...declarado, reasoningChars: 1200 })).toEqual({
      reasoningVerdict: 'visible',
      charsPerOutput: 3.3,
    });
    const conEtiquetas = classifyReasoningEvidence({ ...declarado, reasoningTagChars: 900 });
    expect(conEtiquetas.reasoningVerdict).toBe('visible');
    // declarado y sin nada que se vea: razono sin enseñarlo, y no es deduccion
    expect(classifyReasoningEvidence(declarado).reasoningVerdict).toBe('counted');
  });

  it('sin consumo final o sin tokens no hay contra que medir', () => {
    expect(classifyReasoningEvidence({ ...base, outputTokens: 0, textChars: 500 })).toEqual({
      reasoningVerdict: 'no_data',
      charsPerOutput: null,
    });
    expect(
      classifyReasoningEvidence({
        ...base,
        finalUsageReceived: false,
        outputTokens: 100,
        textChars: 20,
      }),
    ).toEqual({ reasoningVerdict: 'no_data', charsPerOutput: null });
  });
});
