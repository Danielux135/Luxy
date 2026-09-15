import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CatalogSnapshot } from '@luxy/shared';
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

  it('un identificador con separadores de ruta no escapa de la carpeta', () => {
    writeCatalogSnapshot(directory, snapshot({ connectionId: '../../fuera', source: 'http' }));
    for (const entry of readdirSync(directory)) {
      expect(entry.startsWith('http-')).toBe(true);
    }
  });
});
