import { describe, it, expect } from 'vitest';
import {
  buildCatalogForConnection,
  buildDefaultCatalog,
  DEFAULT_CONNECTIONS,
  DEFAULT_CONNECTION_ID,
  ModelRegistry,
  ModelRegistryError,
  normalizeAlias,
  connectionProfileSchema,
  modelDefinitionSchema,
  type ConnectionStatus,
} from './index.js';

const CATALOG = buildDefaultCatalog();

/** apiModel que la conexion devolvio en /v1/models el 2026-08-11 */
const SERVED_BY_CONNECTION = [
  'auto',
  'DeepSeek-V4-Flash',
  'DeepSeek-V4-Pro',
  'glm-5.1',
  'glm-5.2',
  'kat-coder-pro-v2.5',
  'Kimi-K2.6',
  'MiniMax-M3',
  'hy3',
  'Qwen3-Embedding-8B',
  'Qwen3.6-27B',
  'sensenova-6.7-flash-lite',
  'sensenova-u1-fast',
  'step-3.5-flash',
  'step-3.5-flash-2603',
  'step-3.7-flash',
  'step-explore',
  'stepaudio-2.5-asr',
  'stepaudio-2.5-chat',
  'stepaudio-2.5-realtime',
  'stepaudio-2.5-tts',
  'step-image-edit-2',
  'step-router-v1',
];

/** null = conexion sin sincronizar todavia */
function buildRegistry(status: Partial<ConnectionStatus> | null = {}): ModelRegistry {
  return new ModelRegistry({
    connections: DEFAULT_CONNECTIONS,
    models: CATALOG,
    statuses:
      status === null
        ? []
        : [
            {
              connectionId: DEFAULT_CONNECTION_ID,
              hasApiKey: true,
              reachable: true,
              checkedAt: new Date().toISOString(),
              availableModels: SERVED_BY_CONNECTION,
              error: null,
              ...status,
            },
          ],
  });
}

// -----------------------------------------------------------------------------
// catalogo
// -----------------------------------------------------------------------------
describe('catalogo inicial', () => {
  it('todas las entradas cumplen el esquema', () => {
    for (const model of CATALOG) {
      expect(modelDefinitionSchema.safeParse(model).success).toBe(true);
    }
  });

  it('la conexion por defecto es valida', () => {
    for (const connection of DEFAULT_CONNECTIONS) {
      expect(connectionProfileSchema.safeParse(connection).success).toBe(true);
    }
    expect(DEFAULT_CONNECTIONS[0]?.baseUrl).toBe('https://api.hcnsec.cn/v1');
  });

  it('el apiModel se conserva EXACTO, sin normalizar', () => {
    const exactos = CATALOG.map((model) => model.apiModel);
    // mayusculas, puntos y guiones tal cual los devuelve la API
    expect(exactos).toContain('DeepSeek-V4-Pro');
    expect(exactos).toContain('Kimi-K2.6');
    expect(exactos).toContain('Qwen3.6-27B');
    expect(exactos).toContain('MiniMax-M3');
    expect(exactos).toContain('kat-coder-pro-v2.5');
    expect(exactos).toContain('glm-5.2');
  });

  it('solo contiene modelos que la conexion sirve de verdad', () => {
    for (const model of CATALOG) {
      expect(SERVED_BY_CONNECTION).toContain(model.apiModel);
    }
  });

  it('la lectura real sustituye el catalogo operativo completo', () => {
    const detected = buildCatalogForConnection(DEFAULT_CONNECTION_ID, [
      'hy3',
      'Qwen3.6-27B',
      'modelo-recien-publicado',
    ]);
    expect(detected.map((model) => model.apiModel)).toEqual([
      'hy3',
      'Qwen3.6-27B',
      'modelo-recien-publicado',
    ]);
    expect(detected.map((model) => model.apiModel)).not.toContain('Qwen3.5-397B-A17B');
    expect(detected.find((model) => model.apiModel === 'modelo-recien-publicado')).toMatchObject({
      family: 'other',
      capabilities: [],
      supportsNativeTools: null,
    });
  });

  it('no contiene los dos modelos que la conexion no sirve', () => {
    const apiModels = CATALOG.map((model) => model.apiModel);
    for (const ausente of ['kat-coder-pro-v2', 'MiniMax-M2.7']) {
      expect(apiModels).not.toContain(ausente);
    }
  });

  it('incluye los modelos que la conexion sirve y faltaban en la lista original', () => {
    const apiModels = CATALOG.map((model) => model.apiModel);
    expect(apiModels).toContain('glm-5.1');
    expect(apiModels).toContain('auto');
    expect(apiModels).toContain('step-explore');
    expect(apiModels).toContain('sensenova-6.7-flash-lite');
    expect(apiModels).toContain('sensenova-u1-fast');
  });

  it('los tres modelos nuevos no inventan capacidades ni herramientas', () => {
    for (const apiModel of ['step-explore', 'sensenova-6.7-flash-lite', 'sensenova-u1-fast']) {
      const model = CATALOG.find((entry) => entry.apiModel === apiModel);
      expect(model?.capabilities).toEqual(['text']);
      expect(model?.agentic).toBe(false);
      expect(model?.allowedTools).toEqual([]);
      expect(model?.supportsNativeTools).toBeNull();
      expect(model?.metadata['contractVerified']).toBe(false);
    }
  });

  it('cada familia tiene como mucho un predeterminado', () => {
    const registry = buildRegistry();
    for (const family of registry.listFamilies()) {
      const defaults = registry.listByFamily(family).filter((model) => model.defaultForFamily);
      expect(defaults.length).toBeLessThanOrEqual(1);
    }
  });

  it('los alias son unicos en todo el catalogo', () => {
    expect(() => buildRegistry()).not.toThrow();
  });

  it('rechaza dos modelos que reclamen el mismo alias', () => {
    const duplicado = modelDefinitionSchema.parse({
      id: 'otro-modelo',
      apiModel: 'Otro',
      displayName: 'Otro',
      family: 'deepseek',
      connectionId: DEFAULT_CONNECTION_ID,
      category: 'text',
      telegramAliases: ['deepseek'],
    });
    expect(
      () =>
        new ModelRegistry({ connections: DEFAULT_CONNECTIONS, models: [...CATALOG, duplicado] }),
    ).toThrow(ModelRegistryError);
  });
});

// -----------------------------------------------------------------------------
// alias
// -----------------------------------------------------------------------------
describe('resolucion de alias', () => {
  const registry = buildRegistry();

  it('/deepseek usa DeepSeek-V4-Pro', () => {
    expect(registry.resolveAlias('deepseek')?.apiModel).toBe('DeepSeek-V4-Pro');
    expect(registry.resolveAlias('deepseek_pro')?.apiModel).toBe('DeepSeek-V4-Pro');
  });

  it('/deepseek_flash usa DeepSeek-V4-Flash', () => {
    expect(registry.resolveAlias('deepseek_flash')?.apiModel).toBe('DeepSeek-V4-Flash');
  });

  it('los alias sin version apuntan al predeterminado de su familia', () => {
    expect(registry.resolveAlias('glm')?.apiModel).toBe('glm-5.2');
    expect(registry.resolveAlias('kat')?.apiModel).toBe('kat-coder-pro-v2.5');
    expect(registry.resolveAlias('minimax')?.apiModel).toBe('MiniMax-M3');
    expect(registry.resolveAlias('qwen')?.apiModel).toBe('Qwen3.6-27B');
    expect(registry.resolveAlias('step')?.apiModel).toBe('step-3.7-flash');
    expect(registry.resolveAlias('kimi')?.apiModel).toBe('Kimi-K2.6');
  });

  it('los alias explicitos apuntan siempre al modelo concreto', () => {
    expect(registry.resolveAlias('glm_51')?.apiModel).toBe('glm-5.1');
    expect(registry.resolveAlias('glm_52')?.apiModel).toBe('glm-5.2');
    expect(registry.resolveAlias('qwen_36')?.apiModel).toBe('Qwen3.6-27B');
    expect(registry.resolveAlias('step_35_2603')?.apiModel).toBe('step-3.5-flash-2603');
  });

  it('los alias de audio e imagen apuntan a su modelo', () => {
    expect(registry.resolveAlias('transcribe')?.apiModel).toBe('stepaudio-2.5-asr');
    expect(registry.resolveAlias('speak')?.apiModel).toBe('stepaudio-2.5-tts');
    expect(registry.resolveAlias('voice')?.apiModel).toBe('stepaudio-2.5-realtime');
    expect(registry.resolveAlias('audio_chat')?.apiModel).toBe('stepaudio-2.5-chat');
    expect(registry.resolveAlias('image_edit')?.apiModel).toBe('step-image-edit-2');
  });

  it('los alias de los modelos retirados ya no resuelven', () => {
    for (const retirado of [
      'kat_v2',
      'minimax_m27',
      'sensenova',
      'sensenova_fast',
      'sensenova_flash',
    ]) {
      expect(registry.resolveAlias(retirado)).toBeNull();
    }
  });

  it('una familia nueva sin predeterminado no inventa un alias', () => {
    expect(registry.resolveAlias('sensenova')).toBeNull();
  });

  it('los routers no tienen alias de telegram', () => {
    expect(registry.resolveAlias('step_router_v1')).toBeNull();
    // "auto" no debe resolver a un modelo: lo maneja el router local
    expect(registry.resolveAlias('auto')).toBeNull();
  });

  it('normaliza variantes razonables', () => {
    expect(normalizeAlias('/DeepSeek-Pro')).toBe('deepseek_pro');
    expect(registry.resolveAlias('/DEEPSEEK')?.apiModel).toBe('DeepSeek-V4-Pro');
    expect(registry.resolveAlias('  deepseek-flash ')?.apiModel).toBe('DeepSeek-V4-Flash');
  });

  it('devuelve null ante un alias desconocido', () => {
    expect(registry.resolveAlias('no_existe')).toBeNull();
    expect(registry.resolveAlias('')).toBeNull();
  });

  it('cambiar el predeterminado cambia el modelo sin cambiar el comando', () => {
    // el usuario marca DeepSeek-V4-Flash como predeterminado de su familia
    const modificado = CATALOG.map((model) =>
      model.family === 'deepseek'
        ? { ...model, defaultForFamily: model.id === 'deepseek-v4-flash' }
        : model,
    );
    const otro = new ModelRegistry({ connections: DEFAULT_CONNECTIONS, models: modificado });

    // el alias explicito sigue apuntando al modelo concreto
    expect(otro.resolveAlias('deepseek_pro')?.apiModel).toBe('DeepSeek-V4-Pro');
    // pero el alias sin version ya usa el nuevo predeterminado
    expect(otro.defaultForFamily('deepseek')?.apiModel).toBe('DeepSeek-V4-Flash');
  });
});

// -----------------------------------------------------------------------------
// disponibilidad
// -----------------------------------------------------------------------------
describe('disponibilidad', () => {
  it('sin sincronizar, servedByConnection es null y no false', () => {
    const registry = buildRegistry(null);
    const resuelto = registry.resolve('deepseek-v4-pro');
    // no saber no es lo mismo que saber que no
    expect(resuelto?.servedByConnection).toBeNull();
  });

  it('una lista de modelos VACIA tampoco es saber que no', () => {
    // el caso real que vio Daniel el 2026-08-06: la pantalla de Modelos pasaba
    // una lista vacia porque nadie habia consultado, y el registro lo leia como
    // «no sirve ninguno». Con la clave puesta y trabajos ejecutandose, los 19
    // modelos salian «no disponible».
    const registry = buildRegistry({ availableModels: [] });
    const resuelto = registry.resolve('deepseek-v4-pro');

    expect(resuelto?.servedByConnection).toBeNull();
    expect(resuelto?.unavailableReason).toBeNull();
    expect(resuelto?.usable).toBe(true);
  });

  it('sin clave ningun modelo es utilizable, y lo explica', () => {
    const registry = buildRegistry({ hasApiKey: false });
    expect(registry.listUsable()).toHaveLength(0);
    expect(registry.resolve('deepseek-v4-pro')?.unavailableReason).toContain('falta la clave');
  });

  it('con clave y sincronizacion, los modelos activos son utilizables', () => {
    const registry = buildRegistry();
    const resuelto = registry.resolve('deepseek-v4-pro');
    expect(resuelto?.usable).toBe(true);
    expect(resuelto?.servedByConnection).toBe(true);
  });

  it('un modelo que la conexion deja de servir se marca no utilizable', () => {
    const registry = buildRegistry({
      availableModels: SERVED_BY_CONNECTION.filter((model) => model !== 'DeepSeek-V4-Pro'),
    });
    const resuelto = registry.resolve('deepseek-v4-pro');
    expect(resuelto?.usable).toBe(false);
    expect(resuelto?.unavailableReason).toContain('no sirve el modelo');
  });

  it('los routers estan desactivados por defecto', () => {
    const registry = buildRegistry();
    expect(registry.resolve('step-router-v1')?.usable).toBe(false);
    expect(registry.resolve('newapi-auto')?.usable).toBe(false);
  });

  it('una conexion desactivada deja sus modelos fuera', () => {
    const registry = new ModelRegistry({
      connections: [{ ...DEFAULT_CONNECTIONS[0]!, enabled: false }],
      models: CATALOG,
      statuses: [
        {
          connectionId: DEFAULT_CONNECTION_ID,
          hasApiKey: true,
          reachable: true,
          checkedAt: null,
          availableModels: SERVED_BY_CONNECTION,
          error: null,
        },
      ],
    });
    expect(registry.listUsable()).toHaveLength(0);
    expect(registry.resolve('glm-5.2')?.unavailableReason).toContain('desactivada');
  });

  it('solo los modelos de texto son agentic', () => {
    const registry = buildRegistry();
    for (const resuelto of registry.listAgentic()) {
      expect(resuelto.definition.category).toBe('text');
    }
    const ids = registry.listAgentic().map((resuelto) => resuelto.definition.id);
    expect(ids).toContain('deepseek-v4-pro');
    expect(ids).not.toContain('stepaudio-2.5-asr');
    expect(ids).not.toContain('step-image-edit-2');
  });

  it('ningun modelo de audio o imagen recibe herramientas de archivos', () => {
    for (const model of CATALOG) {
      if (
        model.category === 'audio' ||
        model.category === 'image' ||
        model.category === 'routing'
      ) {
        expect(model.agentic).toBe(false);
        expect(model.allowedTools).toHaveLength(0);
      }
    }
  });

  it('filtra candidatos por capacidad', () => {
    const registry = buildRegistry();
    const transcriptores = registry.listUsableWithCapability('transcription');
    expect(transcriptores.map((resuelto) => resuelto.definition.apiModel)).toEqual([
      'stepaudio-2.5-asr',
    ]);
  });

  it('las integraciones sin verificar quedan marcadas', () => {
    for (const model of CATALOG) {
      if (model.category !== 'text') {
        expect(model.metadata['contractVerified']).toBe(false);
      }
    }
  });

  it('ningun modelo declara tool calling nativo sin evidencia', () => {
    // se comprobo con llamadas reales el 2026-07-28: quien lo declare, en un
    // sentido o en otro, tiene que decir cuando se comprobo
    for (const model of CATALOG) {
      if (model.supportsNativeTools === null) continue;
      expect(model.metadata['toolCallingCheckedAt']).toBeTruthy();
    }
  });

  it('los modelos con tool calling verificado son los que respondieron', () => {
    const conTools = CATALOG.filter((model) => model.supportsNativeTools === true).map(
      (model) => model.apiModel,
    );
    expect(conTools).toEqual([
      'DeepSeek-V4-Pro',
      'DeepSeek-V4-Flash',
      'glm-5.2',
      'glm-5.1',
      // kat-coder-pro-v2.5 no esta: la cuenta no tiene acceso, asi que su
      // soporte de herramientas sigue siendo DESCONOCIDO, no verificado
      'Kimi-K2.6',
      'MiniMax-M3',
      'step-3.7-flash',
      'step-3.5-flash-2603',
    ]);
  });

  it('los modelos lentos quedan marcados como lentos, no como caidos', () => {
    // una primera medida con 45 s los dio por muertos: responden, pero tardan
    for (const apiModel of ['glm-5.2', 'MiniMax-M3', 'DeepSeek-V4-Pro']) {
      const model = CATALOG.find((entry) => entry.apiModel === apiModel);
      expect(model?.supportsNativeTools).toBe(true);
      expect(model?.metadata['slowResponse']).toBe(true);
      expect(model?.metadata['observedLatencyMs']).toBeGreaterThan(60_000);
    }
  });

  it('el modelo sin acceso queda anotado, no borrado', () => {
    const kat = CATALOG.find((model) => model.apiModel === 'kat-coder-pro-v2.5');
    expect(kat?.metadata['note']).toContain('rechazo el acceso');
    // rechazo en menos de 1 s: no es lentitud, es permiso
    expect(kat?.metadata['slowResponse']).toBeUndefined();
  });
});
