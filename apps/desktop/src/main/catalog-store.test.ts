import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catalogReasoningFor, type CatalogSnapshot } from '@luxy/shared';
import { readCatalogSnapshot, writeCatalogSnapshot } from './catalog-store.js';

function snapshot(overrides: Partial<CatalogSnapshot> = {}): CatalogSnapshot {
  return {
    connectionId: 'mistral',
    source: 'http',
    fetchedAt: '2026-09-04T16:00:00.000Z',
    models: [
      {
        apiModel: 'pixtral-12b-2409',
        ownedBy: null,
        billing: 'unknown',
        modelRatio: null,
        completionRatio: null,
        perCall: null,
        groups: [],
      },
    ],
    pricingAvailable: false,
    notice: null,
    ...overrides,
  };
}

describe('catalogos guardados de los dos origenes', () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'luxy-catalog-'));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('guarda y recupera el de un proveedor HTTP', () => {
    writeCatalogSnapshot(directory, snapshot());
    const leido = readCatalogSnapshot(directory, 'mistral', 'http');
    expect(leido?.models.map((model) => model.apiModel)).toEqual(['pixtral-12b-2409']);
  });

  it('una conexion y un proveedor con el MISMO nombre no se pisan', () => {
    // las dos listas comparten espacio de nombres: sin separarlos, consultar
    // uno sobrescribia el catalogo del otro y la pantalla enseñaba los modelos
    // de una pasarela bajo el nombre de la otra
    writeCatalogSnapshot(directory, snapshot({ source: 'http' }));
    writeCatalogSnapshot(
      directory,
      snapshot({
        source: 'connection',
        models: [
          {
            apiModel: 'kimi-k3',
            ownedBy: null,
            billing: 'unknown',
            modelRatio: null,
            completionRatio: null,
            perCall: null,
            groups: [],
          },
        ],
      }),
    );

    expect(readCatalogSnapshot(directory, 'mistral', 'http')?.models[0]?.apiModel).toBe(
      'pixtral-12b-2409',
    );
    expect(readCatalogSnapshot(directory, 'mistral', 'connection')?.models[0]?.apiModel).toBe(
      'kimi-k3',
    );
  });

  it('el de una conexion conserva el nombre de archivo de siempre', () => {
    // cambiarlo dejaria huerfanos los catalogos ya leidos y la pantalla diria
    // «sin consultar todavia» sobre una conexion que si se consulto
    writeCatalogSnapshot(directory, snapshot({ connectionId: 'pasarela', source: 'connection' }));
    expect(readdirSync(directory)).toContain('pasarela.json');
  });

  it('un catalogo escrito antes de que existieran los origenes se sigue leyendo', () => {
    mkdirSync(directory, { recursive: true });
    const viejo = { ...snapshot({ connectionId: 'pasarela' }) } as Record<string, unknown>;
    delete viejo.source;
    writeFileSync(join(directory, 'pasarela.json'), JSON.stringify(viejo), 'utf8');

    const leido = readCatalogSnapshot(directory, 'pasarela', 'connection');
    expect(leido?.source).toBe('connection');
    expect(leido?.models).toHaveLength(1);
  });

  it('sin archivo devuelve null en vez de reventar', () => {
    expect(readCatalogSnapshot(directory, 'no-existe', 'http')).toBeNull();
  });

  it('un archivo con JSON valido y la forma equivocada se trata como ausente', () => {
    // esto era un cast, `JSON.parse(raw) as CatalogSnapshot`. El try de
    // alrededor solo atrapaba el JSON ilegible, asi que una de estas formas
    // pasaba entera, viajaba por IPC y llegaba al catalogo, que se construye en
    // el CUERPO del render de la raiz: ventana en negro desde el arranque y
    // ninguna pista de que archivo borrar
    const raros: Record<string, unknown>[] = [
      { models: [{ id: 'x' }] },
      { models: {} },
      { ...snapshot(), models: [{ apiModel: 42 }] },
      { ...snapshot(), fetchedAt: 17 },
      { hola: 'que tal' },
    ];
    for (const [indice, raro] of raros.entries()) {
      const id = `raro${indice}`;
      writeFileSync(join(directory, `http-${id}.json`), JSON.stringify(raro), 'utf8');
      expect(readCatalogSnapshot(directory, id, 'http')).toBeNull();
    }
  });

  it('un archivo que no es siquiera un objeto se trata como ausente', () => {
    writeFileSync(join(directory, 'http-lista.json'), '[1,2,3]', 'utf8');
    expect(readCatalogSnapshot(directory, 'lista', 'http')).toBeNull();
  });

  it('conserva lo que la pasarela declara saber hacer', () => {
    // el esquema que habia escrito en el contrato IPC no tenia este campo: el
    // dia que alguien lo aplicara, habria borrado en silencio lo que marca cual
    // acepta imagenes y volveriamos a deducirlo del nombre
    writeCatalogSnapshot(
      directory,
      snapshot({
        connectionId: 'declara',
        models: [
          {
            apiModel: 'pixtral-12b-2409',
            ownedBy: null,
            billing: 'unknown',
            modelRatio: null,
            completionRatio: null,
            perCall: null,
            groups: [],
            declaredCapabilities: ['vision', 'tools'],
          },
        ],
      }),
    );
    const leido = readCatalogSnapshot(directory, 'declara', 'http');
    expect(leido?.models[0]?.declaredCapabilities).toEqual(['vision', 'tools']);
  });

  it('conserva lo que la pasarela declara de razonamiento y limites, y con que lista se leyo', () => {
    // la trampa de siempre: tras pulsar el boton la pantalla recibe el objeto
    // en memoria, y lo que no este en el esquema de LECTURA desaparece al
    // reabrir Luxy. Los niveles se verian un rato y luego no
    const detallado = snapshot({
      connectionId: 'nanogpt',
      detail: 'detailed',
      models: [
        {
          apiModel: 'deepseek/deepseek-v4-pro',
          ownedBy: null,
          billing: 'unknown',
          modelRatio: null,
          completionRatio: null,
          perCall: null,
          groups: [],
          declaredCapabilities: ['reasoning'],
          reasoning: true,
          reasoningEfforts: ['none', 'high', 'max'],
          declaredOutputCap: 64000,
          declaredContext: 128000,
        },
        {
          // declara que NO razona: `false` no es lo mismo que no decirlo
          apiModel: 'TheDrummer/Cydonia-24B-v4.3',
          ownedBy: null,
          billing: 'unknown',
          modelRatio: null,
          completionRatio: null,
          perCall: null,
          groups: [],
          declaredCapabilities: [],
          reasoning: false,
          declaredContext: 32768,
        },
      ],
    });
    writeCatalogSnapshot(directory, detallado);
    const leido = readCatalogSnapshot(directory, 'nanogpt', 'http');

    expect(leido).toEqual(detallado);
    expect(leido?.models[1]?.reasoning).toBe(false);
    expect(catalogReasoningFor(leido, 'deepseek/deepseek-v4-pro')).toEqual({
      state: 'levels',
      levels: ['none', 'high', 'max'],
      fetchedAt: '2026-09-04T16:00:00.000Z',
      outputCap: 64000,
    });
    expect(catalogReasoningFor(leido, 'TheDrummer/Cydonia-24B-v4.3').state).toBe('not-reasoning');

    // y «se leyo sin detalle» tambien sobrevive: sin eso, al reabrir no se
    // podria distinguir de un catalogo en el que nadie declara niveles
    writeCatalogSnapshot(directory, snapshot({ connectionId: 'sin-detalle', detail: 'basic' }));
    expect(readCatalogSnapshot(directory, 'sin-detalle', 'http')?.detail).toBe('basic');
  });

  it('un catalogo guardado antes de F36 se lee igual y no pasa por detallado', () => {
    // sin `detail` y sin nada declarado: asi son todos los que ya hay en disco
    const viejo = snapshot({ connectionId: 'nanogpt' });
    writeFileSync(join(directory, 'http-nanogpt.json'), JSON.stringify(viejo), 'utf8');

    const leido = readCatalogSnapshot(directory, 'nanogpt', 'http');
    expect(leido).toEqual(viejo);
    // ningun valor por defecto: las claves nuevas ni existen
    expect(Object.keys(leido ?? {})).not.toContain('detail');
    const modelo = Object.keys(leido?.models[0] ?? {});
    for (const clave of ['reasoning', 'reasoningEfforts', 'declaredOutputCap', 'declaredContext']) {
      expect(modelo).not.toContain(clave);
    }
    // de un catalogo viejo no se puede decir que el modelo no declare niveles:
    // no se pidieron. Por eso su estado es `basic` y no `no-levels`
    expect(catalogReasoningFor(leido, 'pixtral-12b-2409')).toEqual({
      state: 'basic',
      levels: [],
      fetchedAt: '2026-09-04T16:00:00.000Z',
      outputCap: null,
    });
  });

  it('un dato raro en lo declarado cuesta ese campo, no el catalogo', () => {
    // quien lee del disco tira el catalogo ENTERO si el esquema falla, y la
    // pantalla diria «Sin consultar todavia» sobre 644 modelos ya leidos
    const base = snapshot({ connectionId: 'raro' }).models[0];
    const raro = {
      ...snapshot({ connectionId: 'raro' }),
      detail: 'detallado',
      models: [
        {
          ...base,
          apiModel: 'a-medias',
          reasoning: true,
          reasoningEfforts: 'high',
          declaredOutputCap: -5,
          declaredContext: 128000,
        },
        {
          ...base,
          apiModel: 'todo-mal',
          reasoning: 'si',
          reasoningEfforts: ['low', 7],
          declaredOutputCap: 1.5,
          declaredContext: null,
        },
      ],
    };
    writeFileSync(join(directory, 'http-raro.json'), JSON.stringify(raro), 'utf8');

    const leido = readCatalogSnapshot(directory, 'raro', 'http');
    expect(leido?.models.map((model) => model.apiModel)).toEqual(['a-medias', 'todo-mal']);
    // lo que si casa se conserva al lado de lo que no
    expect(leido?.models[0]?.reasoning).toBe(true);
    expect(leido?.models[0]?.declaredContext).toBe(128000);
    expect(leido?.models[0]?.reasoningEfforts).toBeUndefined();
    expect(leido?.models[0]?.declaredOutputCap).toBeUndefined();
    expect(leido?.models[1]?.reasoning).toBeUndefined();
    expect(leido?.models[1]?.reasoningEfforts).toBeUndefined();
    expect(leido?.models[1]?.declaredOutputCap).toBeUndefined();
    expect(leido?.models[1]?.declaredContext).toBeUndefined();
    // un `detail` desconocido se lee como «no se sabe», que es sin detalle
    expect(leido?.detail).toBeUndefined();
    expect(catalogReasoningFor(leido, 'a-medias').state).toBe('basic');
  });

  it('un identificador con separadores de ruta no escapa de la carpeta', () => {
    writeCatalogSnapshot(directory, snapshot({ connectionId: '../../fuera', source: 'http' }));
    for (const entry of readdirSync(directory)) {
      expect(entry.startsWith('http-')).toBe(true);
    }
  });
});
