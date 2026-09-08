import { describe, expect, it } from 'vitest';
import {
  buildCatalogForConnection,
  isAudioModel,
  isClassifierModel,
  isConversationalModel,
} from './catalog.js';

describe('catalogo de un origen que impone su familia', () => {
  // un proveedor HTTP se registra bajo SU identificador, y el identificador de
  // proveedor ES la familia con la que el agente lo ejecuta. Adivinarla por el
  // nombre del modelo dejaba a Mistral en «other» y su selector vacio
  it('pone la familia impuesta en todos sus modelos', () => {
    const modelos = buildCatalogForConnection(
      'mistral',
      ['pixtral-12b-2409', 'un-nombre-que-no-dice-nada'],
      'mistral',
    );

    expect(modelos.map((modelo) => modelo.family)).toEqual(['mistral', 'mistral']);
  });

  it('sin familia impuesta la sigue adivinando por el nombre', () => {
    const modelos = buildCatalogForConnection('pasarela', ['DeepSeek-V4-Pro', 'kimi-k3']);
    expect(modelos.map((modelo) => modelo.family)).toEqual(['deepseek', 'kimi']);
  });

  it('una familia que no existe NO tumba el catalogo', () => {
    // `family` es un enum cerrado: meter ahi el identificador de un proveedor
    // cualquiera haria saltar el esquema y dejaria la pantalla sin catalogo.
    // Se prefiere agrupar peor a no tener nada
    const modelos = buildCatalogForConnection('lo-que-sea', ['kimi-k3'], 'lo-que-sea');
    expect(modelos).toHaveLength(1);
    expect(modelos[0]?.family).toBe('kimi');
  });

  it('la categoria se deduce del nombre aunque la familia venga impuesta', () => {
    // un proveedor puede servir texto, audio e imagen a la vez: si la categoria
    // saliera de la familia, sus modelos de audio pasarian por texto
    const modelos = buildCatalogForConnection(
      'mistral',
      ['stepaudio-2.5-tts', 'mistral-large-latest'],
      'mistral',
    );

    expect(modelos.map((modelo) => modelo.category)).toEqual(['audio', 'text']);
  });

  it('con familia impuesta no se hereda la ficha de fabrica', () => {
    // el mismo nombre puede existir en otra pasarela con otra familia y otros
    // alias de telegram: heredarla mezclaria dos modelos distintos
    const modelos = buildCatalogForConnection('mistral', ['kimi-k3'], 'mistral');
    expect(modelos[0]?.connectionId).toBe('mistral');
    expect(modelos[0]?.telegramAliases).toEqual([]);
  });
});

// COMPROBADO CONTRA EL CATALOGO REAL de Groq el 2026-09-08: de sus 14 modelos,
// seis no son de chat y los seis se ofrecian para describir una imagen.
describe('modelos que no sirven para conversar', () => {
  it('reconoce los de voz aunque lleven el vendor delante', () => {
    expect(isAudioModel('whisper-large-v3')).toBe(true);
    expect(isAudioModel('whisper-large-v3-turbo')).toBe(true);
    // la trampa: un startsWith sobre la cadena entera no captura ninguno
    expect(isAudioModel('canopylabs/orpheus-v1-english')).toBe(true);
    expect(isAudioModel('canopylabs/orpheus-arabic-saudi')).toBe(true);
  });

  it('no confunde un modelo de chat con uno de voz', () => {
    expect(isAudioModel('qwen/qwen3.6-27b')).toBe(false);
    expect(isAudioModel('openai/gpt-oss-120b')).toBe(false);
    expect(isAudioModel('DeepSeek-V4-Pro')).toBe(false);
  });

  it('reconoce los clasificadores', () => {
    expect(isClassifierModel('meta-llama/llama-prompt-guard-2-22m')).toBe(true);
    expect(isClassifierModel('meta-llama/llama-prompt-guard-2-86m')).toBe(true);
    expect(isClassifierModel('openai/gpt-oss-safeguard-20b')).toBe(true);
    expect(isClassifierModel('openai/gpt-oss-20b')).toBe(false);
  });

  it('un clasificador es de categoria TEXTO y aun asi no es conversacional', () => {
    // entra texto y sale una etiqueta: decir que su categoria es otra cosa
    // seria mentir. Son dos preguntas distintas y se responden por separado
    expect(
      isConversationalModel({ apiModel: 'openai/gpt-oss-safeguard-20b', category: 'text' }),
    ).toBe(false);
    expect(isConversationalModel({ apiModel: 'qwen/qwen3.6-27b', category: 'text' })).toBe(true);
    expect(isConversationalModel({ apiModel: 'whisper-large-v3', category: 'audio' })).toBe(false);
  });
});
