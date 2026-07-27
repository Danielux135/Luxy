import { describe, it, expect } from 'vitest';
import {
  isAbsolutePath,
  isPathInside,
  containsTraversal,
  validateProjectPath,
  isPathAllowed,
  normalizePathForCompare,
} from './paths.js';

describe('isAbsolutePath', () => {
  it('acepta rutas de windows con unidad', () => {
    expect(isAbsolutePath('C:\\Users\\Daniel\\proyecto')).toBe(true);
    expect(isAbsolutePath('D:/proyectos/luxy')).toBe(true);
  });

  it('acepta rutas unc', () => {
    expect(isAbsolutePath('\\\\servidor\\recurso')).toBe(true);
  });

  it('acepta rutas posix', () => {
    expect(isAbsolutePath('/home/daniel/proyecto')).toBe(true);
  });

  it('rechaza rutas relativas', () => {
    expect(isAbsolutePath('proyecto')).toBe(false);
    expect(isAbsolutePath('./proyecto')).toBe(false);
    expect(isAbsolutePath('..\\proyecto')).toBe(false);
    expect(isAbsolutePath('')).toBe(false);
  });
});

describe('containsTraversal', () => {
  it('detecta segmentos ".." en ambos separadores', () => {
    expect(containsTraversal('C:/proyecto/../secretos')).toBe(true);
    expect(containsTraversal('C:\\proyecto\\..\\secretos')).toBe(true);
    expect(containsTraversal('../../etc/passwd')).toBe(true);
  });

  it('detecta traversal codificado en url', () => {
    expect(containsTraversal('proyecto/%2e%2e/secreto')).toBe(true);
    expect(containsTraversal('proyecto/%252e%252e/secreto')).toBe(true);
  });

  it('no marca nombres que solo contienen puntos', () => {
    expect(containsTraversal('C:/proyecto/archivo..txt')).toBe(false);
    expect(containsTraversal('C:/mi.proyecto/src')).toBe(false);
  });
});

describe('isPathInside', () => {
  it('acepta un descendiente directo', () => {
    expect(isPathInside('C:/luxy/worktrees/lux-1', 'C:/luxy/worktrees')).toBe(true);
  });

  it('acepta la propia raiz', () => {
    expect(isPathInside('C:/luxy/worktrees', 'C:/luxy/worktrees')).toBe(true);
  });

  it('rechaza un hermano con prefijo comun', () => {
    // este es el fallo clasico de comparar solo con startsWith
    expect(isPathInside('C:/luxy/worktrees-malicioso', 'C:/luxy/worktrees')).toBe(false);
  });

  it('rechaza un ancestro', () => {
    expect(isPathInside('C:/luxy', 'C:/luxy/worktrees')).toBe(false);
  });

  it('trata igual las barras de windows y las normales', () => {
    expect(isPathInside('C:\\luxy\\worktrees\\a', 'C:/luxy/worktrees')).toBe(true);
  });

  it('ignora la diferencia de mayusculas en la letra de unidad', () => {
    expect(isPathInside('c:/luxy/worktrees/a', 'C:/luxy/worktrees')).toBe(true);
  });

  it('ignora una barra final sobrante', () => {
    expect(isPathInside('C:/luxy/worktrees/a', 'C:/luxy/worktrees/')).toBe(true);
  });
});

describe('normalizePathForCompare', () => {
  it('colapsa barras repetidas', () => {
    expect(normalizePathForCompare('C://luxy///worktrees')).toBe('C:/luxy/worktrees');
  });

  it('conserva el prefijo unc', () => {
    expect(normalizePathForCompare('\\\\servidor\\recurso')).toBe('//servidor/recurso');
  });
});

describe('validateProjectPath', () => {
  it('acepta una ruta absoluta y limpia', () => {
    expect(validateProjectPath('C:\\Users\\Daniel\\Desktop\\proyecto')).toEqual([]);
  });

  it('rechaza rutas vacias', () => {
    expect(validateProjectPath('   ')).toContain('la ruta esta vacia');
  });

  it('rechaza rutas relativas', () => {
    expect(validateProjectPath('proyectos/luxy')).toContain('la ruta debe ser absoluta');
  });

  it('rechaza rutas con traversal', () => {
    expect(validateProjectPath('C:/proyectos/../secretos')).toContain(
      'la ruta contiene segmentos ".."',
    );
  });

  it('rechaza caracteres no validos en windows', () => {
    const problemas = validateProjectPath('C:/proyectos/pro<yecto');
    expect(problemas.some((p) => p.includes('caracteres no validos'))).toBe(true);
  });

  it('no confunde el prefijo de unidad con un caracter prohibido', () => {
    // los dos puntos de "C:" son legitimos
    expect(validateProjectPath('C:/proyectos/luxy')).toEqual([]);
  });
});

describe('isPathAllowed', () => {
  const raices = ['C:/luxy/worktrees', 'C:/luxy/state'];

  it('acepta rutas dentro de una raiz permitida', () => {
    expect(isPathAllowed('C:/luxy/worktrees/lux-1/src/a.ts', raices)).toBe(true);
    expect(isPathAllowed('C:/luxy/state/pending.json', raices)).toBe(true);
  });

  it('rechaza rutas fuera de todas las raices', () => {
    expect(isPathAllowed('C:/Users/usuario/.ssh/id_rsa', raices)).toBe(false);
    expect(isPathAllowed('C:/Windows/System32/config', raices)).toBe(false);
  });

  it('rechaza cualquier ruta con traversal aunque parezca interna', () => {
    expect(isPathAllowed('C:/luxy/worktrees/../../Users/Daniel/.ssh', raices)).toBe(false);
  });

  it('rechaza todo si no hay ninguna raiz permitida', () => {
    expect(isPathAllowed('C:/lo/que/sea', [])).toBe(false);
  });
});
