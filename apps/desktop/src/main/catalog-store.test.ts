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

  it('un identificador con separadores de ruta no escapa de la carpeta', () => {
    writeCatalogSnapshot(directory, snapshot({ connectionId: '../../fuera', source: 'http' }));
    for (const entry of readdirSync(directory)) {
      expect(entry.startsWith('http-')).toBe(true);
    }
  });
});
