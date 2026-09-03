// pruebas de que modelo se manda con cada proveedor.
//
// Existe por un fallo que costo cinco llamadas: el proveedor cambiado a Claude y
// el modelo aun en `DeepSeek-V4-Pro`, que para Claude no existe. La regla estaba
// escrita en la pantalla y no la comprobaba nadie.
import { describe, it, expect } from 'vitest';
import {
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

  it('un proveedor sin modelos no rompe nada', () => {
    expect(modelForProvider(CATALOGO, 'codex', 'opus')).toBeNull();
    expect(modelsForProvider(CATALOGO, 'codex')).toEqual([]);
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
