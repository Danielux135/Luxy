// pruebas del glosario de la interfaz.
//
// Lo que se fija aqui no es logica: es que las explicaciones sigan sirviendo
// para lo que existen. Una entrada que se queda sin usar envejece sin que nadie
// la lea, y una que dice el termino con otras palabras no explica nada. Las dos
// cosas pasan solas con el tiempo y ninguna rompe la compilacion.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GLOSSARY, type GlossaryEntry, type GlossaryKey } from './glossary.js';

const RENDERER = dirname(dirname(fileURLToPath(import.meta.url)));

/** todo el codigo de la interfaz, para saber que terminos se usan de verdad */
function rendererSources(directory: string = RENDERER): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) return rendererSources(full);
    return entry.endsWith('.tsx') || (entry.endsWith('.ts') && !entry.endsWith('.test.ts'))
      ? [readFileSync(full, 'utf8')]
      : [];
  });
}

const claves = Object.keys(GLOSSARY) as GlossaryKey[];

describe('glosario de la interfaz', () => {
  it('cada entrada explica de verdad, no repite el nombre del campo', () => {
    for (const clave of claves) {
      const entry: GlossaryEntry = GLOSSARY[clave];
      expect(entry.termino.trim().length, clave).toBeGreaterThan(0);
      // el fallo real es «CLIP skip: el ajuste de CLIP skip», que no explica
      // nada y ademas parece que si
      expect(entry.queEs.trim().length, clave).toBeGreaterThan(60);
      expect(entry.queEs.toLowerCase(), clave).not.toBe(entry.termino.toLowerCase());
    }
  });

  it('un ejemplo siempre viene acompañado de que hay que escribir', () => {
    // un valor suelto sin decir que es deja igual de perdido que antes
    for (const clave of claves) {
      const entry: GlossaryEntry = GLOSSARY[clave];
      if (entry.ejemplo === undefined) continue;
      expect(entry.queRelleno, clave).toBeDefined();
    }
  });

  it('ninguna entrada se queda sin usar en la interfaz', () => {
    // una explicacion que ya no cuelga de ningun cuadro no la lee nadie, y se
    // queda desactualizada sin que falle nada
    const fuentes = rendererSources().join('\n');
    const huerfanas = claves.filter(
      (clave) => !fuentes.includes(`"${clave}"`) && !fuentes.includes(`'${clave}'`),
    );
    expect(huerfanas).toEqual([]);
  });

  it('el aviso de `ojo` solo aparece donde equivocarse cuesta algo', () => {
    // no es una regla de estilo: si todo lleva aviso, el aviso deja de leerse
    const conAviso = claves.filter((clave) => (GLOSSARY[clave] as GlossaryEntry).ojo !== undefined);
    expect(conAviso.length).toBeLessThan(claves.length);
  });
});
