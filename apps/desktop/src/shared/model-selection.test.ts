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
  { apiModel: 'DeepSeek-V4-Pro', family: 'deepseek', enabled: true },
  { apiModel: 'DeepSeek-V4-Flash', family: 'deepseek', enabled: true },
  { apiModel: 'opus', family: 'claude', enabled: true },
  { apiModel: 'retirado', family: 'deepseek', enabled: false },
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
