import { describe, it, expect } from 'vitest';
import {
  parseCommand,
  extractMention,
  detectProvider,
  parseNaturalMention,
  CommandParseError,
} from './commands.js';
import { MAX_PROMPT_LENGTH } from '../constants.js';

describe('parseCommand - comandos de control', () => {
  it('reconoce /start y /help sin argumento', () => {
    expect(parseCommand('/start')).toEqual({ kind: 'control', command: 'start', argument: null });
    expect(parseCommand('/help')).toEqual({ kind: 'control', command: 'help', argument: null });
  });

  it('extrae el argumento de /use', () => {
    expect(parseCommand('/use portatil')).toEqual({
      kind: 'control',
      command: 'use',
      argument: 'portatil',
    });
  });

  it('acepta /cancel con y sin identificador', () => {
    expect(parseCommand('/cancel')).toMatchObject({ command: 'cancel', argument: null });
    expect(parseCommand('/cancel LUX-4F82')).toMatchObject({ argument: 'LUX-4F82' });
  });

  it('normaliza mayusculas en el nombre del comando', () => {
    expect(parseCommand('/STATUS')).toMatchObject({ kind: 'control', command: 'status' });
  });
});

describe('parseCommand - comandos de tarea', () => {
  it('separa proveedor, proyecto y tarea', () => {
    const parsed = parseCommand('/claude errorlux Corrige el Quick Pick y ejecuta las pruebas');
    expect(parsed).toEqual({
      kind: 'task',
      command: 'claude',
      model: null,
      provider: 'claude',
      projectAlias: 'errorlux',
      prompt: 'Corrige el Quick Pick y ejecuta las pruebas',
    });
  });

  it('trata /auto como modo automatico sin proveedor fijado', () => {
    const parsed = parseCommand('/auto portfolio Revisa el responsive');
    expect(parsed).toMatchObject({ kind: 'task', command: 'auto', provider: null });
  });

  it('reconoce los proveedores http', () => {
    for (const provider of ['deepseek', 'glm', 'qwen'] as const) {
      expect(parseCommand(`/${provider} demo analiza esto`)).toMatchObject({ provider });
    }
  });

  it('conserva los saltos de linea del prompt', () => {
    const parsed = parseCommand('/codex demo linea uno\nlinea dos');
    expect(parsed).toMatchObject({ prompt: 'linea uno\nlinea dos' });
  });

  it('rechaza un comando de tarea sin descripcion', () => {
    expect(() => parseCommand('/claude errorlux')).toThrow(CommandParseError);
  });

  it('rechaza un alias de proyecto con caracteres no validos', () => {
    // un alias con barra podria usarse para intentar salir de la carpeta
    expect(() => parseCommand('/claude ../secretos haz algo')).toThrow(CommandParseError);
    expect(() => parseCommand('/claude a/b haz algo')).toThrow(CommandParseError);
  });

  it('rechaza un prompt que supera el limite', () => {
    const largo = 'a'.repeat(MAX_PROMPT_LENGTH + 1);
    expect(() => parseCommand(`/claude demo ${largo}`)).toThrow(CommandParseError);
  });

  it('normaliza el alias a minusculas', () => {
    expect(parseCommand('/claude ERRORLUX arregla algo')).toMatchObject({
      projectAlias: 'errorlux',
    });
  });
});

describe('parseCommand - menciones al bot en el comando', () => {
  it('acepta /comando@BotName cuando el nombre coincide', () => {
    const parsed = parseCommand('/status@LuxyBot', { botUsername: 'LuxyBot' });
    expect(parsed).toMatchObject({ kind: 'control', command: 'status' });
  });

  it('ignora un comando dirigido a otro bot', () => {
    expect(parseCommand('/status@OtroBot', { botUsername: 'LuxyBot' })).toEqual({ kind: 'none' });
  });

  it('la comparacion del nombre del bot no distingue mayusculas', () => {
    expect(parseCommand('/status@luxybot', { botUsername: 'LuxyBot' })).toMatchObject({
      command: 'status',
    });
  });
});

describe('parseCommand - casos limite', () => {
  it('devuelve none si el texto no empieza por barra', () => {
    expect(parseCommand('hola')).toEqual({ kind: 'none' });
    expect(parseCommand('')).toEqual({ kind: 'none' });
  });

  it('marca como desconocido un comando que no existe', () => {
    expect(parseCommand('/inventado')).toEqual({ kind: 'unknown', command: 'inventado' });
  });
});

describe('extractMention', () => {
  it('detecta la mencion y la quita del texto', () => {
    const result = extractMention('@LuxyBot revisa Errorlux', { botUsername: 'LuxyBot' });
    expect(result.mentioned).toBe(true);
    expect(result.text).toBe('revisa Errorlux');
  });

  it('en un grupo sin mencion no se considera dirigido al bot', () => {
    const result = extractMention('esto es una charla', { botUsername: 'LuxyBot' });
    expect(result.mentioned).toBe(false);
  });

  it('en chat privado siempre se considera dirigido al bot', () => {
    const result = extractMention('haz algo', { botUsername: 'LuxyBot', isPrivateChat: true });
    expect(result.mentioned).toBe(true);
  });

  it('una respuesta directa a un mensaje del bot cuenta como mencion', () => {
    const result = extractMention('y ahora las pruebas', {
      botUsername: 'LuxyBot',
      isReplyToBot: true,
    });
    expect(result.mentioned).toBe(true);
  });

  it('detecta el proveedor mencionado en lenguaje natural', () => {
    const result = extractMention('@LuxyBot Claude, arregla esto', { botUsername: 'LuxyBot' });
    expect(result.provider).toBe('claude');
  });
});

describe('detectProvider', () => {
  it('reconoce los nombres y alias de cada proveedor', () => {
    expect(detectProvider('usa Claude para esto')).toBe('claude');
    expect(detectProvider('hazlo con Codex')).toBe('codex');
    expect(detectProvider('analiza con DeepSeek')).toBe('deepseek');
    expect(detectProvider('con GLM por favor')).toBe('glm');
    expect(detectProvider('usa Qwen')).toBe('qwen');
  });

  it('devuelve null cuando no se nombra ningun proveedor', () => {
    expect(detectProvider('arregla el menu de navegacion')).toBeNull();
  });

  it('no confunde un alias dentro de otra palabra', () => {
    // "gpt" no debe detectarse dentro de "gptcosa"
    expect(detectProvider('revisa el archivo gptcosa.txt')).toBeNull();
  });
});

describe('parseNaturalMention', () => {
  const alias = ['errorlux', 'portfolio', 'portfolio-v2'];

  it('encuentra el alias del proyecto en texto libre', () => {
    const result = parseNaturalMention('revisa el responsive de portfolio', alias);
    expect(result.projectAlias).toBe('portfolio');
  });

  it('prefiere el alias mas largo cuando uno contiene al otro', () => {
    const result = parseNaturalMention('arregla portfolio-v2 por favor', alias);
    expect(result.projectAlias).toBe('portfolio-v2');
  });

  it('detecta a la vez proveedor y proyecto', () => {
    const result = parseNaturalMention('usa Codex en portfolio para el responsive', alias);
    expect(result.provider).toBe('codex');
    expect(result.projectAlias).toBe('portfolio');
  });

  it('devuelve null cuando ningun alias aparece', () => {
    const result = parseNaturalMention('arregla lo de ayer', alias);
    expect(result.projectAlias).toBeNull();
  });
});

// -----------------------------------------------------------------------------
// alias por modelo del catalogo
// -----------------------------------------------------------------------------
describe('alias de modelo en telegram', () => {
  const task = (text: string) => {
    const parsed = parseCommand(text);
    if (parsed.kind !== 'task') throw new Error(`no es una tarea: ${parsed.kind}`);
    return parsed;
  };

  it('/kimi ya se acepta como comando de tarea', () => {
    // antes el parser solo conocia los cinco PROVIDER_IDS originales
    expect(task('/kimi proyecto arregla el bug').provider).toBe('kimi');
  });

  it('conserva hunyuan para poder leer y continuar trabajos historicos', () => {
    // el historial persistido puede contener proveedores que el catalogo actual
    // ya no propone. El contrato no puede rechazar esos trabajos al cargarlos.
    expect(task('/hunyuan proyecto continua el trabajo anterior').provider).toBe('hunyuan');
  });

  it('un alias explicito fija el apiModel EXACTO', () => {
    expect(task('/kimi_k26 proyecto tarea').model).toBe('Kimi-K2.6');
    expect(task('/qwen_36 proyecto tarea').model).toBe('Qwen3.6-35B-A3B');
    expect(task('/kat_v25 proyecto tarea').model).toBe('kat-coder-pro-v2.5');
    expect(task('/step_35_2603 proyecto tarea').model).toBe('step-3.5-flash-2603');
    expect(task('/deepseek_flash proyecto tarea').model).toBe('DeepSeek-V4-Flash');
  });

  it('un alias sin version NO fija modelo: lo elige el predeterminado', () => {
    // esto es lo que permite cambiar el predeterminado sin cambiar el comando
    expect(task('/deepseek proyecto tarea').model).toBeNull();
    expect(task('/qwen proyecto tarea').model).toBeNull();
    expect(task('/step proyecto tarea').model).toBeNull();
  });

  it('cada alias lleva a su familia correcta', () => {
    expect(task('/glm_51 proyecto tarea').provider).toBe('glm');
    expect(task('/minimax_m3 proyecto tarea').provider).toBe('minimax');
    expect(task('/step_37 proyecto tarea').provider).toBe('step');
  });

  it('/auto no fija ni proveedor ni modelo', () => {
    const parsed = task('/auto proyecto tarea');
    expect(parsed.provider).toBeNull();
    expect(parsed.model).toBeNull();
  });

  it('los alias retirados siguen sin existir', () => {
    for (const retirado of ['/kat_v2', '/minimax_m27', '/sensenova', '/sensenova_flash']) {
      expect(parseCommand(`${retirado} proyecto tarea`).kind).toBe('unknown');
    }
  });

  it('los modelos de audio e imagen tienen comando propio', () => {
    expect(task('/transcribe proyecto tarea').model).toBe('stepaudio-2.5-asr');
    expect(task('/speak proyecto tarea').model).toBe('stepaudio-2.5-tts');
    expect(task('/image_edit proyecto tarea').model).toBe('step-image-edit-2');
  });

  it('los routers no son comandos de tarea', () => {
    expect(parseCommand('/step_router_v1 proyecto tarea').kind).toBe('unknown');
  });
});
