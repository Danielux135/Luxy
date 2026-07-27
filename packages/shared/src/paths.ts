// validacion de rutas independiente del sistema de ficheros.
// las comprobaciones que necesitan disco (symlinks) viven en el agente local.

/** normaliza separadores y mayusculas de unidad para comparar rutas en windows */
export function normalizePathForCompare(input: string): string {
  let value = input.replace(/\\/g, '/');
  // colapsar barras repetidas salvo el prefijo unc
  const isUnc = value.startsWith('//');
  value = (isUnc ? value.slice(2) : value).replace(/\/{2,}/g, '/');
  if (isUnc) value = `//${value}`;
  // quitar barra final salvo en la raiz
  if (value.length > 1 && value.endsWith('/')) value = value.slice(0, -1);
  // en windows la unidad no distingue mayusculas
  if (/^[a-zA-Z]:/.test(value)) value = value[0]!.toUpperCase() + value.slice(1);
  return value;
}

/** indica si una ruta es absoluta en windows o en posix */
export function isAbsolutePath(input: string): boolean {
  if (input.length === 0) return false;
  // unidad de windows: C:\ o C:/
  if (/^[a-zA-Z]:[\\/]/.test(input)) return true;
  // ruta unc: \\servidor\recurso
  if (/^[\\/]{2}[^\\/]/.test(input)) return true;
  // posix
  return input.startsWith('/');
}

/**
 * indica si `candidate` esta contenido dentro de `root`.
 * ambas rutas deben venir ya resueltas con path.resolve por quien llama.
 * compara por segmentos para que /raiz-mala no cuente como hijo de /raiz.
 */
export function isPathInside(candidate: string, root: string): boolean {
  const normalizedRoot = normalizePathForCompare(root);
  const normalizedCandidate = normalizePathForCompare(candidate);
  if (normalizedCandidate === normalizedRoot) return true;
  return normalizedCandidate.startsWith(`${normalizedRoot}/`);
}

/** detecta intentos evidentes de path traversal antes de tocar el disco */
export function containsTraversal(input: string): boolean {
  const segments = input.replace(/\\/g, '/').split('/');
  if (segments.includes('..')) return true;
  // secuencias codificadas que algunos clientes envian
  return /%2e%2e|%252e/i.test(input);
}

/**
 * caracteres que windows no admite en un nombre de fichero.
 * los de control (U+0000 a U+001F) estan a proposito: windows los prohibe y
 * ademas son una via clasica de inyeccion en rutas.
 */
// eslint-disable-next-line no-control-regex -- detectar caracteres de control es justo el objetivo
const WINDOWS_FORBIDDEN = /[<>:"|?*\u0000-\u001f]/;

/**
 * valida una ruta de proyecto declarada en la configuracion local.
 * devuelve la lista de problemas encontrados, vacia si la ruta es aceptable.
 */
export function validateProjectPath(input: string): string[] {
  const problems: string[] = [];
  if (input.trim().length === 0) {
    problems.push('la ruta esta vacia');
    return problems;
  }
  if (!isAbsolutePath(input)) problems.push('la ruta debe ser absoluta');
  if (containsTraversal(input)) problems.push('la ruta contiene segmentos ".."');
  // se excluye el prefijo de unidad al buscar caracteres prohibidos
  const withoutDrive = /^[a-zA-Z]:/.test(input) ? input.slice(2) : input;
  if (WINDOWS_FORBIDDEN.test(withoutDrive)) {
    problems.push('la ruta contiene caracteres no validos en windows');
  }
  return problems;
}

/**
 * comprueba que una ruta objetivo cae dentro de alguna de las raices permitidas.
 * es la barrera principal contra escrituras fuera del worktree.
 */
export function isPathAllowed(candidate: string, allowedRoots: string[]): boolean {
  if (containsTraversal(candidate)) return false;
  return allowedRoots.some((root) => isPathInside(candidate, root));
}
