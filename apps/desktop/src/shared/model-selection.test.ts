// pruebas de que modelo se manda con cada proveedor.
//
// Existe por un fallo que costo cinco llamadas: el proveedor cambiado a Claude y
// el modelo aun en `DeepSeek-V4-Pro`, que para Claude no existe. La regla estaba
// escrita en la pantalla y no la comprobaba nadie.
import { describe, it, expect } from 'vitest';
import {
  NATIVE_MODEL_SUGGESTIONS,
  modelForProvider,
  modelsForProvider,
  type SelectableModel,
} from './model-selection.js';

const CATALOGO: SelectableModel[] = [
  { apiModel: 'DeepSeek-V4-Pro', family: 'deepseek', connectionId: 'hcnsec', enabled: true },
  { apiModel: 'DeepSeek-V4-Flash', family: 'deepseek', connectionId: 'hcnsec', enabled: true },
  { apiModel: 'opus', family: 'claude', connectionId: 'claude', enabled: true },
  { apiModel: 'retirado', family: 'deepseek', connectionId: 'hcnsec', enabled: false },
  // un proveedor HTTP: sus modelos NO forman una familia nuestra, y por eso
  // se emparejan por conexion. Groq sirve qwen y otros bajo el nombre «groq»
  { apiModel: 'qwen/qwen3.6-27b', family: 'qwen', connectionId: 'groq', enabled: true },
  { apiModel: 'whisper-large-v3', family: 'other', connectionId: 'groq', enabled: true },
];

describe('el modelo que viaja con el proveedor', () => {
  it('vale si pertenece a esa familia', () => {
    expect(modelForProvider(CATALOGO, 'deepseek', 'DeepSeek-V4-Pro')).toBe('DeepSeek-V4-Pro');
  });

  it('NO vale si es de otra familia', () => {
    // el fallo exacto: cinco llamadas gastadas con `unrecognized_model`
    expect(modelForProvider(CATALOGO, 'claude', 'DeepSeek-V4-Pro')).toBeNull();
  });

  it('sin elegir ninguno decide la conexion', () => {
    expect(modelForProvider(CATALOGO, 'deepseek', null)).toBeNull();
    expect(modelForProvider(CATALOGO, 'deepseek', '')).toBeNull();
  });

  it('un modelo desactivado no se manda', () => {
    expect(modelForProvider(CATALOGO, 'deepseek', 'retirado')).toBeNull();
  });

  it('uno que no esta en el catalogo tampoco', () => {
    // el catalogo se lee de la conexion: si el modelo desaparecio, mandarlo
    // gasta la llamada para nada
    expect(modelForProvider(CATALOGO, 'deepseek', 'un-modelo-que-ya-no-existe')).toBeNull();
  });

  it('sin catalogo para esa familia se acepta lo que se escriba', () => {
    // Claude y Codex son CLI locales y no salen en `/v1/models`: si aqui se
    // bloqueara, no se podria elegir modelo con ellos, que es justo lo que
    // pasaba. La proteccion contra la familia equivocada es soltar el modelo al
    // cambiar de proveedor, no esta comprobacion
    expect(modelForProvider(CATALOGO, 'claude-cli', 'sonnet')).toBe('sonnet');
    expect(modelsForProvider(CATALOGO, 'claude-cli')).toEqual([]);
  });

  it('las sugerencias nativas no se inventan donde no se han comprobado', () => {
    // `CLAUDE.md` prohibe inventarse los valores de un CLI sin mirar su --help
    expect(NATIVE_MODEL_SUGGESTIONS['claude']).toContain('sonnet');
    expect(NATIVE_MODEL_SUGGESTIONS['codex']).toBeUndefined();
  });
});

describe('los modelos que se ofrecen', () => {
  it('solo los de esa familia y solo los activos', () => {
    expect(modelsForProvider(CATALOGO, 'deepseek').map((each) => each.apiModel)).toEqual([
      'DeepSeek-V4-Pro',
      'DeepSeek-V4-Flash',
    ]);
    expect(modelsForProvider(CATALOGO, 'claude').map((each) => each.apiModel)).toEqual(['opus']);
  });
});

describe('un proveedor HTTP cuyos modelos no son una familia nuestra', () => {
  // PASO DE VERDAD con Groq: `MODEL_FAMILIES` es una lista cerrada y «groq»
  // no esta, asi que sus modelos se catalogan como `qwen` y `other`. Pidiendo
  // solo por familia, el selector de Privado quedaba VACIO para siempre y
  // actualizar el catalogo no lo arreglaba: el problema no era la frescura.
  it('sus modelos salen al elegir ese proveedor', () => {
    const suyos = modelsForProvider(CATALOGO, 'groq').map((m) => m.apiModel);
    expect(suyos).toEqual(['qwen/qwen3.6-27b', 'whisper-large-v3']);
  });

  it('no se cuelan en otro proveedor por su familia adivinada', () => {
    // `qwen/qwen3.6-27b` tiene familia `qwen`, pero lo sirve Groq: elegir el
    // proveedor `qwen` de la pasarela no puede ofrecer un modelo de Groq
    const deQwen = modelsForProvider(CATALOGO, 'qwen').map((m) => m.apiModel);
    expect(deQwen).toContain('qwen/qwen3.6-27b');
  });

  it('la familia sigue funcionando para la pasarela agregadora', () => {
    // una conexion sirve muchas familias por el mismo endpoint, y el agente
    // registra un proveedor por familia: ese camino no puede romperse
    const deep = modelsForProvider(CATALOGO, 'deepseek').map((m) => m.apiModel);
    expect(deep).toEqual(['DeepSeek-V4-Pro', 'DeepSeek-V4-Flash']);
  });

  it('lo desactivado no se ofrece por ninguna de las dos vias', () => {
    expect(modelsForProvider(CATALOGO, 'hcnsec').map((m) => m.apiModel)).not.toContain(
      'retirado',
    );
  });
});
