// pruebas del confinamiento.
//
// se crean junctions y symlinks DE VERDAD en disco: el hueco que tenia el codigo
// anterior solo aparece con un enlace real, no con rutas de texto.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir, platform } from 'node:os';
import { join } from 'node:path';
import { confinePath, isForbiddenName, PathConfinementError } from './confine.js';

const esWindows = platform() === 'win32';

let base: string;
let root: string;
let fuera: string;

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'luxy-confine-')));
  root = join(base, 'worktree');
  fuera = join(base, 'fuera');
  mkdirSync(root, { recursive: true });
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(fuera, { recursive: true });
  writeFileSync(join(root, 'src', 'index.ts'), 'export const a = 1;\n');
  writeFileSync(join(fuera, 'secreto.txt'), 'no me leas\n');
});

afterEach(() => rmSync(base, { recursive: true, force: true }));

const confina = (candidate: string): string => confinePath({ root, candidate });

describe('rutas validas', () => {
  it('acepta una ruta relativa dentro del worktree', () => {
    expect(confina('src/index.ts')).toBe(join(root, 'src', 'index.ts'));
  });

  it('acepta la propia raiz', () => {
    expect(confina('.')).toBe(root);
  });

  it('acepta un archivo que TODAVIA NO existe', () => {
    // este es el caso de crear un archivo: el objetivo no existe y aun asi hay
    // que poder verificar que su destino cae dentro
    expect(confina('src/nuevo.ts')).toBe(join(root, 'src', 'nuevo.ts'));
  });

  it('acepta una carpeta nueva a varios niveles', () => {
    expect(confina('a/b/c/d.txt')).toBe(join(root, 'a', 'b', 'c', 'd.txt'));
  });

  it('acepta una ruta absoluta que cae dentro', () => {
    expect(confina(join(root, 'src', 'index.ts'))).toBe(join(root, 'src', 'index.ts'));
  });

  it('normaliza las barras', () => {
    expect(confina('src\\index.ts')).toBe(join(root, 'src', 'index.ts'));
  });
});

describe('escapes del worktree', () => {
  it('rechaza .. que sale', () => {
    expect(() => confina('../fuera/secreto.txt')).toThrow(PathConfinementError);
  });

  it('rechaza .. encadenados', () => {
    expect(() => confina('src/../../fuera/secreto.txt')).toThrow(PathConfinementError);
  });

  it('rechaza una ruta absoluta externa', () => {
    expect(() => confina(join(fuera, 'secreto.txt'))).toThrow(PathConfinementError);
  });

  it('rechaza una carpeta hermana con prefijo comun', () => {
    // "worktree-otro" empieza por "worktree": la comparacion debe ser por segmento
    const hermana = `${root}-otro`;
    mkdirSync(hermana, { recursive: true });
    expect(() => confina(join(hermana, 'x.txt'))).toThrow(PathConfinementError);
  });

  it('rechaza rutas UNC', () => {
    expect(() => confina('\\\\servidor\\recurso\\x.txt')).toThrow(PathConfinementError);
  });

  it('rechaza el prefijo \\\\?\\', () => {
    expect(() => confina('\\\\?\\C:\\Windows\\System32')).toThrow(PathConfinementError);
  });

  it('rechaza el prefijo \\\\.\\ de dispositivo', () => {
    expect(() => confina('\\\\.\\PhysicalDrive0')).toThrow(PathConfinementError);
  });
});

describe('trampas de windows', () => {
  it('rechaza los nombres de dispositivo reservados', () => {
    for (const nombre of ['NUL', 'con', 'CON.txt', 'com1', 'LPT9', 'aux', 'prn']) {
      expect(() => confina(`src/${nombre}`)).toThrow(PathConfinementError);
    }
  });

  it('rechaza los flujos de datos alternativos', () => {
    // un ADS quedaria invisible para git status y el diff mentiria
    expect(() => confina('src/index.ts:oculto')).toThrow(PathConfinementError);
  });

  it('rechaza componentes que terminan en punto o espacio', () => {
    expect(() => confina('src/archivo.')).toThrow(PathConfinementError);
    expect(() => confina('src/archivo ')).toThrow(PathConfinementError);
  });

  it('rechaza un byte nulo', () => {
    expect(() => confina('src/index.ts\0.png')).toThrow(PathConfinementError);
  });

  it('rechaza una ruta vacia', () => {
    expect(() => confina('   ')).toThrow(PathConfinementError);
  });
});

describe('enlaces y junctions reales', () => {
  it('rechaza escribir a traves de un enlace de directorio que sale', () => {
    // ESTE es el hueco que tenia assertInsideWorktree: como el objetivo no
    // existe, se saltaba realpath y solo comparaba texto
    const tipo = esWindows ? 'junction' : 'dir';
    try {
      symlinkSync(fuera, join(root, 'puente'), tipo);
    } catch {
      return; // sin permisos para crear enlaces: la prueba no aplica
    }
    expect(() => confina('puente/nuevo.txt')).toThrow(PathConfinementError);
  });

  it('rechaza leer a traves de un enlace de directorio que sale', () => {
    const tipo = esWindows ? 'junction' : 'dir';
    try {
      symlinkSync(fuera, join(root, 'puente'), tipo);
    } catch {
      return;
    }
    expect(() => confina('puente/secreto.txt')).toThrow(PathConfinementError);
  });

  it('rechaza un enlace de archivo que apunta fuera', () => {
    try {
      symlinkSync(join(fuera, 'secreto.txt'), join(root, 'atajo.txt'), 'file');
    } catch {
      return;
    }
    expect(() => confina('atajo.txt')).toThrow(PathConfinementError);
  });
});

describe('archivos que nunca se exponen', () => {
  it('rechaza los .env aunque esten dentro del worktree', () => {
    for (const nombre of ['.env', '.env.local', '.env.providers', '.env.production']) {
      writeFileSync(join(root, nombre), 'CLAVE=secreta');
      expect(() => confina(nombre)).toThrow(PathConfinementError);
    }
  });

  it('rechaza claves privadas', () => {
    for (const nombre of ['id_rsa', 'id_ed25519', 'cert.pem', 'almacen.pfx']) {
      expect(() => confina(`src/${nombre}`)).toThrow(PathConfinementError);
    }
  });

  it('rechaza credenciales de herramientas', () => {
    for (const nombre of ['.npmrc', '.netrc', '.git-credentials', 'secrets.enc']) {
      expect(() => confina(nombre)).toThrow(PathConfinementError);
    }
  });

  it('rechaza el directorio .git', () => {
    // los hooks viven ahi: escribir uno seria ejecucion de codigo en el commit
    expect(() => confina('.git/config')).toThrow(PathConfinementError);
    expect(() => confina('.git/hooks/pre-commit')).toThrow(PathConfinementError);
  });

  it('isForbiddenName reconoce las variantes', () => {
    expect(isForbiddenName('.env')).toBe(true);
    expect(isForbiddenName('.ENV')).toBe(true);
    expect(isForbiddenName('clave.pem')).toBe(true);
    expect(isForbiddenName('index.ts')).toBe(false);
    expect(isForbiddenName('environment.ts')).toBe(false);
  });
});

describe('falla cerrado', () => {
  it('deniega si la raiz no existe', () => {
    expect(() =>
      confinePath({ root: join(base, 'raiz-inexistente'), candidate: 'x.txt' }),
    ).toThrow(PathConfinementError);
  });

  it('el error nunca revela el contenido, solo la ruta pedida', () => {
    try {
      confina('../fuera/secreto.txt');
    } catch (error) {
      expect((error as PathConfinementError).candidate).toBe('../fuera/secreto.txt');
      expect((error as Error).message).not.toContain('no me leas');
    }
  });
});
