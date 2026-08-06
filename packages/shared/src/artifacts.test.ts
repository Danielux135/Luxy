// pruebas de la decision de artefacto.
//
// POR QUE EXISTE: `D-013` dice que un documento largo no puede vivir en el
// campo de resultado. Lo que se prueba aqui es la frontera: que una respuesta
// normal NO se convierta en archivo, que una web SI, y que el nombre del
// archivo lo construya Luxy y no el texto que devolvio un modelo.
import { describe, it, expect } from 'vitest';
import {
  artifactFileName,
  artifactKindFor,
  describeArtifactSize,
  shouldStoreAsArtifact,
} from './artifacts.js';
import { ARTIFACT_MIN_CHARS } from './constants.js';

const WEB = `<!doctype html>
<html lang="es">
  <head><style>.tarjeta { color: #fff; }</style></head>
  <body><div class="tarjeta">Hola</div></body>
</html>
${'<!-- relleno -->'.repeat(600)}`;

describe('shouldStoreAsArtifact', () => {
  it('una web larga merece archivo', () => {
    expect(WEB.length).toBeGreaterThan(ARTIFACT_MIN_CHARS);
    expect(shouldStoreAsArtifact(WEB)).toBe(true);
  });

  it('una explicacion larga NO es un archivo: es una respuesta que se lee', () => {
    const texto = 'Luxy guarda la memoria de forma estructurada. '.repeat(400);
    expect(texto.length).toBeGreaterThan(ARTIFACT_MIN_CHARS);
    expect(shouldStoreAsArtifact(texto)).toBe(false);
  });

  it('un fragmento de codigo corto tampoco: hacen falta las dos condiciones', () => {
    expect(shouldStoreAsArtifact('<div class="tarjeta">Hola</div>')).toBe(false);
  });

  it('el umbral se puede bajar para probar sin generar 8.000 caracteres', () => {
    expect(shouldStoreAsArtifact('<html><body>hola</body></html>', 10)).toBe(true);
  });
});

describe('artifactKindFor', () => {
  it('una pagina con CSS y JS dentro sigue siendo html', () => {
    // el orden importa: si CSS ganara, una web entera acabaria en un .css
    expect(artifactKindFor(WEB)).toBe('html');
  });

  it('reconoce json valido', () => {
    expect(artifactKindFor('{"a": 1, "b": [2, 3]}')).toBe('json');
    // parecido a json pero roto: no se etiqueta como tal
    expect(artifactKindFor('{"a": 1,,}')).not.toBe('json');
  });

  it('reconoce css y javascript sueltos', () => {
    expect(artifactKindFor('.tarjeta { color: #fff; padding: 1rem; }')).toBe('css');
    expect(artifactKindFor('export function suma(a, b) {\n  return a + b;\n}')).toBe('js');
  });

  it('lo que no reconoce acaba en txt, no en una extension inventada', () => {
    expect(artifactKindFor('una nota cualquiera')).toBe('txt');
    expect(artifactKindFor('')).toBe('txt');
  });
});

describe('artifactFileName', () => {
  it('usa el identificador del trabajo y su extension', () => {
    expect(artifactFileName('html', 'LUX-3966')).toBe('LUX-3966.html');
  });

  it('filtra cualquier cosa que pudiera salirse de la carpeta', () => {
    expect(artifactFileName('html', '../../etc/passwd')).toBe('ETCPASSWD.html');
    expect(artifactFileName('js', 'a/b\\c')).toBe('ABC.js');
    expect(artifactFileName('txt', '')).toBe('SALIDA.txt');
  });

  it('el nombre resultante nunca lleva separadores ni puntos de mas', () => {
    for (const entrada of ['..', './x', 'C:\\Windows', 'LUX 12']) {
      const nombre = artifactFileName('html', entrada);
      expect(nombre).toMatch(/^[A-Z0-9-]+\.html$/);
    }
  });
});

describe('describeArtifactSize', () => {
  it('usa la unidad que se lee de un vistazo', () => {
    expect(describeArtifactSize(512)).toBe('512 B');
    expect(describeArtifactSize(34_000)).toBe('33 KB');
    expect(describeArtifactSize(2_000_000)).toBe('1.9 MB');
  });
});
