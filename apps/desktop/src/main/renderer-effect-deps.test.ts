// que la pantalla de la boveda no vuelva a releerse sola (`D-106`).
//
// ORIGEN: `useVault()` devuelve un objeto nuevo en cada render, y hay un render
// cada 5 s por el latido del estado. Dos efectos lo tenian en sus dependencias
// —la foto del personaje y el visor de imagen— y descifraban contenido en cada
// vuelta: 112 archivos de la boveda leidos en un minuto con el equipo
// desatendido. Como leer contaba como actividad, la boveda no se cerraba nunca.
//
// Es una prueba ESTATICA, sobre el texto del codigo, porque el renderer no se
// monta en las pruebas. Un cambio de formato puede darle un falso rojo; lo que
// no puede es dar un falso verde sobre lo que protege. Vive en `main` porque
// necesita leer archivos y el tsconfig del renderer no tiene tipos de Node.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const RENDERER = fileURLToPath(new URL('../renderer', import.meta.url));

function fuentes(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) found.push(...fuentes(path));
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) found.push(path);
  }
  return found;
}

/**
 * los arrays de dependencias: el ultimo argumento de una llamada, `, [...])`.
 *
 * Antes solo reconocia `}, [`, el final de un efecto escrito con llaves, y se le
 * escapaban `useMemo(() => x, [vault])` y `useCallback(fn, [vault])`.
 */
const DEPENDENCIAS = /,\s*\[([^\]]*)\]\s*\)/g;
/** `vault` suelto; `vault.algo` es un valor concreto y no cambia en cada render */
const VAULT_SUELTO = /(^|[^\w.])vault(?![\w.])/;

/** lineas donde un array de dependencias lleva el controlador entero */
function effectsDependingOnVault(source: string): number[] {
  const lines: number[] = [];
  for (const match of source.matchAll(DEPENDENCIAS)) {
    if (VAULT_SUELTO.test(match[1] ?? '')) {
      lines.push(source.slice(0, match.index).split('\n').length);
    }
  }
  return lines;
}

/**
 * lo que devuelve `useVault` y no es estable: ni un `useState` ni un
 * `useCallback` ni un `useMemo`. Una flecha en linea o una funcion suelta es
 * nueva en cada render y el efecto que dependa de ella se vuelve a disparar.
 */
function unstableVaultReturns(source: string): string[] {
  const text = source.replace(/\r\n/g, '\n');
  const start = text.indexOf('export function useVault(): VaultController {');
  if (start < 0) return ['<no se encontro useVault>'];
  const body = text.slice(start);
  const open = body.indexOf('\n  return {\n');
  const close = body.indexOf('\n  };\n', open);
  const block = body.slice(open, close);
  const before = body.slice(0, open);
  // los valores derivados que se sabe que no son funciones
  const derived = new Set(['compatibility']);

  const unstable: string[] = [];
  for (const line of block.split('\n').slice(2)) {
    const pair = /^\s{4}(\w+):\s*(.+?),?$/.exec(line);
    if (pair !== null) {
      if (!derived.has(pair[1]!) || pair[2]!.includes('=>')) unstable.push(pair[1]!);
      continue;
    }
    const short = /^\s{4}(\w+),$/.exec(line);
    if (short === null) continue;
    const key = short[1]!;
    const stable = [
      // prettier parte las lineas largas: el `=` puede quedar solo al final
      new RegExp(`\\n  const ${key} =\\s*use(Callback|Memo)\\b`),
      new RegExp(`\\n  const \\[${key}, \\w+\\] =\\s*useState\\b`),
      new RegExp(`\\n  const \\[\\w+, ${key}\\] =\\s*useState\\b`),
    ].some((pattern) => pattern.test(before));
    if (!stable) unstable.push(key);
  }
  return unstable;
}

describe('la pantalla no se relee sola', () => {
  it('ningun efecto del renderer depende del controlador `vault` entero', () => {
    const culpables: string[] = [];
    for (const file of fuentes(RENDERER)) {
      for (const line of effectsDependingOnVault(readFileSync(file, 'utf8'))) {
        culpables.push(`${relative(RENDERER, file)}:${line}`);
      }
    }
    expect(culpables).toEqual([]);
  });

  it('todo lo que devuelve useVault es estado o una funcion estable', () => {
    const source = readFileSync(join(RENDERER, 'useVault.ts'), 'utf8');
    expect(unstableVaultReturns(source)).toEqual([]);
  });

  it('la comprobacion caza los dos efectos que causaron el fallo', () => {
    // sin esto, un patron roto daria verde para siempre
    const foto = 'useEffect(() => {\n  void vault.readCharacterAvatar(id);\n}, [vault, characterId]);';
    const visor = 'useEffect(() => {\n  void vault.openMedia(id);\n}, [item.mediaId, vault]);';
    expect(effectsDependingOnVault(foto)).toEqual([3]);
    expect(effectsDependingOnVault(visor)).toEqual([3]);
    expect(effectsDependingOnVault('}, [vault.conversations]);')).toEqual([]);
    expect(effectsDependingOnVault('}, [readAvatar, characterId]);')).toEqual([]);
    // y los que no terminan en llave
    expect(effectsDependingOnVault('const x = useMemo(() => vault.turns, [vault]);')).toEqual([1]);
    expect(effectsDependingOnVault('const f = useCallback(leer, [vault]);')).toEqual([1]);
  });

  it('y caza una flecha o una funcion suelta en lo que devuelve useVault', () => {
    const hook = (extra: string, ret: string): string =>
      [
        'export function useVault(): VaultController {',
        '  const [status, setStatus] = useState(null);',
        '  const lock = useCallback(() => undefined, []);',
        extra,
        '  return {',
        '    status,',
        '    lock,',
        ret,
        '  };',
        '}',
        '',
      ].join('\n');
    expect(unstableVaultReturns(hook('', '    clearError: () => setError(null),'))).toEqual([
      'clearError',
    ]);
    expect(unstableVaultReturns(hook('  const suelta = async () => undefined;', '    suelta,'))).toEqual([
      'suelta',
    ]);
    expect(unstableVaultReturns(hook('', ''))).toEqual([]);
  });
});
