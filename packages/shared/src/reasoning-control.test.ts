// POR QUE EXISTEN (D-107): el razonamiento se añadio PARA PROBARLO, sin saber
// si la pasarela lo deja pasar. Lo que no puede pasar es: (1) que vacio mande
// algo, (2) que a un modelo se le ofrezca un valor que su documentacion no
// admite —en GLM-5.3 apagarlo da error; en DeepSeek, encenderlo rompe los
// trabajos con herramientas—, y (3) que la cifra que dice si razono salga a
// disco tapada por `redactDeep`.
import { describe, expect, it } from 'vitest';
import {
  classifyReasoningEvidence,
  countReasoningTagChars,
  REASONING_JUDGE_MIN_OUTPUT,
  REASONING_NOT_SENT,
  reasoningLogFields,
  reasoningNoteFor,
  reasoningOptionsFor,
  reasoningRequestFields,
} from './reasoning-control.js';
import { isSecretKeyName, redactDeep } from './redact.js';

const PASARELA = 'api.hcnsec.cn';
const GROQ = 'api.groq.com';

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
    for (const model of ['step-5-preview', 'hy4', 'auto', 'toString', 'constructor', '']) {
      expect(reasoningOptionsFor(model, PASARELA)).toEqual([]);
      expect(reasoningNoteFor(model, PASARELA)).toBeNull();
      for (const mode of ['off', 'low', 'high'] as const) {
        expect(reasoningRequestFields(model, PASARELA, mode)).toEqual({});
      }
    }
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
