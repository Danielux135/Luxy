// confinamiento de rutas del ejecutor de herramientas.
//
// ESTA ES LA BARRERA. Toda operacion de archivo de una herramienta pasa por
// aqui, y si aqui hay un hueco, el aislamiento del worktree no existe.
//
// Lo que hacia el codigo anterior (git.ts:assertInsideWorktree) y por que no
// bastaba:
//
//   1. hacia realpath del OBJETIVO. Si el objetivo no existe todavia -que es
//      justo el caso de crear un archivo- se saltaba realpath entero y solo
//      comparaba texto. Una junction en el camino colaba.
//   2. si realpath lanzaba, descartaba la comprobacion de enlaces y se quedaba
//      con el resultado textual. Fallaba ABIERTO.
//   3. solo normalizaba a mayusculas la letra de unidad, asi que dos rutas
//      equivalentes de Windows podian no coincidir.
//
// Aqui se resuelve el antepasado EXISTENTE mas cercano, se recompone el resto,
// se compara en minusculas completas en Windows y cualquier error deniega.
import { realpathSync, lstatSync } from 'node:fs';
import { isAbsolute, resolve, sep, parse, relative } from 'node:path';
import { isWindows } from '../paths.js';

export class PathConfinementError extends Error {
  constructor(
    message: string,
    readonly candidate: string,
  ) {
    super(message);
    this.name = 'PathConfinementError';
  }
}

/**
 * nombres de dispositivo reservados de Windows.
 * abrir CON, NUL o COM1 no toca el disco: habla con un dispositivo.
 */
const RESERVED_DEVICES =
  /^(con|prn|aux|nul|com[1-9]¹?²?³?|lpt[1-9]¹?²?³?)(\..*)?$/i;

/** archivos que ninguna herramienta debe tocar, aunque esten dentro del worktree */
const FORBIDDEN_NAMES = new Set([
  '.env',
  '.env.local',
  '.env.production',
  '.env.providers',
  'secrets.enc',
  'id_rsa',
  'id_ed25519',
  '.npmrc',
  '.netrc',
  '.git-credentials',
]);

const FORBIDDEN_PATTERNS = [
  /^\.env(\..+)?$/i,
  /\.pem$/i,
  /\.pfx$/i,
  /\.p12$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)$/i,
];

export interface ConfineOptions {
  /** raiz permitida; normalmente el worktree del trabajo */
  root: string;
  /** ruta que pide la herramienta, relativa a la raiz o absoluta dentro de ella */
  candidate: string;
}

/** true si el nombre del archivo es de los que nunca se exponen */
export function isForbiddenName(name: string): boolean {
  const lower = name.toLowerCase();
  if (FORBIDDEN_NAMES.has(lower)) return true;
  return FORBIDDEN_PATTERNS.some((pattern) => pattern.test(name));
}

/** normaliza para comparar. en windows el sistema de archivos ignora mayusculas */
function forCompare(value: string): string {
  const normalized = value.replace(/[\\/]+/g, sep).replace(new RegExp(`\\${sep}+$`), '');
  return isWindows ? normalized.toLowerCase() : normalized;
}

/**
 * resuelve el antepasado existente mas cercano con realpath y recompone el resto.
 *
 * es la pieza que cierra el hueco: para crear un archivo nuevo, el objetivo no
 * existe, pero su carpeta padre si, y es ahi donde puede haber una junction.
 */
function realpathOfNearestAncestor(target: string): string {
  const segments: string[] = [];
  let current = target;

  for (;;) {
    try {
      const real = realpathSync(current);
      return segments.length === 0 ? real : resolve(real, ...segments.reverse());
    } catch {
      const parent = resolve(current, '..');
      if (parent === current) {
        // se llego a la raiz sin encontrar nada existente: no se puede verificar
        throw new PathConfinementError('no se pudo resolver ninguna parte de la ruta', target);
      }
      segments.push(relative(parent, current));
      current = parent;
    }
  }
}

/** rechaza enlaces simbolicos y puntos de reanalisis dentro de la raiz */
function assertNoReparsePoints(root: string, resolved: string): void {
  let current = resolved;
  const rootCompare = forCompare(root);

  while (forCompare(current) !== rootCompare) {
    try {
      const stats = lstatSync(current);
      if (stats.isSymbolicLink()) {
        throw new PathConfinementError('la ruta atraviesa un enlace simbolico', resolved);
      }
    } catch (error) {
      if (error instanceof PathConfinementError) throw error;
      // el componente no existe todavia: normal al crear un archivo
    }
    const parent = resolve(current, '..');
    if (parent === current) break;
    current = parent;
  }
}

/**
 * resuelve una ruta de herramienta dentro de la raiz permitida.
 *
 * devuelve la ruta absoluta ya verificada, o lanza. NUNCA devuelve algo dudoso:
 * ante cualquier error, deniega.
 */
export function confinePath(options: ConfineOptions): string {
  const { root, candidate } = options;
  // NO se recorta: un espacio final es exactamente lo que hay que detectar,
  // porque Windows lo ignora al abrir y dos textos distintos acabarian
  // apuntando al mismo archivo
  const raw = candidate;

  if (raw.trim().length === 0) {
    throw new PathConfinementError('la ruta esta vacia', candidate);
  }

  // 1. formas de ruta que ni siquiera se consideran
  if (raw.includes('\0')) {
    throw new PathConfinementError('la ruta contiene un byte nulo', candidate);
  }
  if (/^\\\\[?.]\\/.test(raw)) {
    throw new PathConfinementError('no se admiten las rutas \\\\?\\ ni \\\\.\\', candidate);
  }
  if (/^\\\\/.test(raw) || /^\/\//.test(raw)) {
    throw new PathConfinementError('no se admiten rutas de red UNC', candidate);
  }
  // flujos de datos alternativos: el contenido quedaria invisible para git
  const withoutDrive = raw.replace(/^[a-zA-Z]:/, '');
  if (withoutDrive.includes(':')) {
    throw new PathConfinementError('no se admiten los flujos de datos alternativos', candidate);
  }

  for (const segment of raw.split(/[\\/]+/)) {
    if (segment.length === 0) continue;
    // "." y ".." son segmentos legitimos; el escape lo resuelve la comparacion
    // contra la raiz, no esta comprobacion
    if (segment === '.' || segment === '..') continue;
    if (RESERVED_DEVICES.test(segment)) {
      throw new PathConfinementError(
        `"${segment}" es un nombre de dispositivo reservado de Windows`,
        candidate,
      );
    }
    // windows recorta puntos y espacios finales: dos textos distintos apuntarian
    // al mismo archivo y la comparacion dejaria de ser fiable
    if (/[. ]$/.test(segment)) {
      throw new PathConfinementError(
        'un componente de la ruta termina en punto o espacio',
        candidate,
      );
    }
  }

  // 2. una ruta absoluta solo vale si ya cae dentro de la raiz
  const absolute = isAbsolute(raw) ? resolve(raw) : resolve(root, raw);

  // 3. raiz y candidato resueltos por su antepasado existente mas cercano
  let realRoot: string;
  let realTarget: string;
  try {
    realRoot = realpathSync(root);
    realTarget = realpathOfNearestAncestor(absolute);
  } catch (error) {
    // FALLA CERRADO: si no se puede verificar, no se permite
    throw new PathConfinementError(
      error instanceof PathConfinementError
        ? error.message
        : 'no se pudo verificar la ruta en el disco',
      candidate,
    );
  }

  // 4. comparacion por segmento, en minusculas completas si es windows
  const rootCompare = forCompare(realRoot);
  const targetCompare = forCompare(realTarget);
  if (targetCompare !== rootCompare && !targetCompare.startsWith(rootCompare + sep)) {
    throw new PathConfinementError('la ruta queda fuera del worktree', candidate);
  }

  // 5. ningun componente puede ser un enlace que salga
  assertNoReparsePoints(realRoot, realTarget);

  // 6. archivos que nunca se exponen, ni para leer
  const name = parse(realTarget).base;
  if (isForbiddenName(name)) {
    throw new PathConfinementError(
      `"${name}" contiene credenciales y no se puede leer ni escribir`,
      candidate,
    );
  }

  // 7. el .git interno solo se toca con las herramientas de git, nunca a mano
  const relativeToRoot = relative(realRoot, realTarget);
  if (relativeToRoot.split(sep).some((segment) => segment.toLowerCase() === '.git')) {
    throw new PathConfinementError('no se puede acceder al directorio .git', candidate);
  }

  return realTarget;
}
