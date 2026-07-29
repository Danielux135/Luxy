// pruebas del empaquetado y del arranque del proceso del agente.
//
// ORIGEN: la version 0.1.0 instalada moria con "codigo 1" y sin una sola linea
// en el log. La causa era que el agente se copiaba a resources/agent tal cual
// salia de tsc, con sus imports de "@luxy/shared" y "zod" sin resolver. Dentro
// del repositorio funcionaba de casualidad -node subia el arbol y encontraba el
// node_modules del monorepo-, pero en %LOCALAPPDATA%\Programs\Luxy no hay
// ninguno encima.
//
// Estas pruebas fijan que eso no pueda repetirse.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveAgentEntry } from './agent-controller.js';

const desktopRoot = join(import.meta.dirname, '..', '..');
const agentBundle = join(desktopRoot, 'out', 'agent', 'host-entry.js');

describe('bundle del agente', () => {
  it('el empaquetado apunta a resources/agent/host-entry.js', () => {
    const entry = resolveAgentEntry({
      isPackaged: true,
      appPath: 'C:/app',
      resourcesPath: 'C:/instalado/resources',
    });
    expect(entry).toBe(join('C:/instalado/resources', 'agent', 'host-entry.js'));
    // ya NO hay subcarpeta runtime: eso era el dist de tsc sin empaquetar
    expect(entry).not.toContain('runtime');
    expect(entry).not.toContain('dist');
  });

  it('en desarrollo usa el MISMO bundle que en produccion', () => {
    // probar en desarrollo un artefacto distinto del que se instala fue
    // justamente lo que dejo pasar el fallo
    const entry = resolveAgentEntry({
      isPackaged: false,
      appPath: 'C:/repo/apps/desktop',
      resourcesPath: 'C:/x',
    });
    expect(entry).toBe(join('C:/repo/apps/desktop', 'out', 'agent', 'host-entry.js'));
  });
});

// si no se ha construido, no se puede afirmar nada del bundle
const built = existsSync(agentBundle);
const suite = built ? describe : describe.skip;

suite('el bundle es autocontenido', () => {
  const source = built ? readFileSync(agentBundle, 'utf8') : '';

  it('no importa ningun paquete de node_modules', () => {
    // esta es LA invariante: cualquier import que no sea node: exige un
    // node_modules que en la carpeta de instalacion no existe
    const imports = [...source.matchAll(/^import[^;]*?from\s*["']([^"']+)["']/gm)].map(
      (match) => match[1]!,
    );
    const externos = imports.filter((name) => !name.startsWith('node:'));
    expect(externos).toEqual([]);
  });

  it('no queda ningun require de un paquete', () => {
    const requires = [...source.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)].map(
      (match) => match[1]!,
    );
    expect(requires.filter((name) => !name.startsWith('node:'))).toEqual([]);
  });

  it('no menciona @luxy/shared ni zod como modulo externo', () => {
    expect(source).not.toMatch(/from\s*["']@luxy\/shared["']/);
    expect(source).not.toMatch(/from\s*["']zod["']/);
  });

  it('es un unico archivo, sin trozos aparte', () => {
    // inlineDynamicImports: un solo archivo que copiar a resources
    expect(source).not.toMatch(/import\(\s*["']\.\//);
  });

  it('contiene de verdad el codigo del agente', () => {
    // si el bundle estuviera vacio las pruebas de arriba pasarian igual
    expect(source).toContain('Luxy arrancando como maquina');
    expect(source.length).toBeGreaterThan(50_000);
  });
});
