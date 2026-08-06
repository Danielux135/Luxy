// cuando una salida larga deja de ser texto y pasa a ser un archivo.
//
// POR QUE EXISTE: una web generada son 20.000-40.000 caracteres. Guardarla en
// `resultSummary` funciona hasta que deja de funcionar: viaja entera por la red
// en cada consulta del historial, no se puede abrir en un editor ni en un
// navegador, y una pagina de 2.000 lineas roza el tope de guardado. `D-013` ya
// dijo que la ruta correcta es un archivo; aqui esta la parte que se puede
// decidir sin tocar disco.
//
// Es logica pura a proposito: quien escribe el archivo es el agente.
import { ARTIFACT_MIN_CHARS } from './constants.js';
// solo se usa como tipo: `ARTIFACT_KINDS` vive en constants y el esquema Zod lo
// consume alli mismo
import type { ARTIFACT_KINDS } from './constants.js';
import { looksLikeCode } from './schemas.js';

export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

const EXTENSIONS: Record<ArtifactKind, string> = {
  html: 'html',
  css: 'css',
  js: 'js',
  json: 'json',
  md: 'md',
  txt: 'txt',
};

/**
 * de que tipo es el documento, mirando lo que hay dentro.
 *
 * el orden importa: una pagina web lleva CSS y JavaScript dentro, asi que HTML
 * se comprueba primero o se guardaria un `index.css` con una web entera.
 */
export function artifactKindFor(text: string): ArtifactKind {
  const sample = text.trim().slice(0, 4000).toLowerCase();
  if (sample.length === 0) return 'txt';
  if (/<!doctype html|<html[\s>]|<body[\s>]|<div[\s>]|<section[\s>]/.test(sample)) return 'html';

  const trimmed = text.trim();
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    try {
      JSON.parse(trimmed);
      return 'json';
    } catch {
      // no era JSON valido: sigue evaluandose como el resto
    }
  }

  if (/^\s*(#{1,6}\s|\|.+\|)/m.test(text) && /```/.test(text)) return 'md';
  if (/(^|\n)\s*(function |const |let |var |class |import |export )/.test(text)) return 'js';
  if (/[.#][\w-]+\s*\{[^}]*:[^}]*\}/.test(text)) return 'css';
  return 'txt';
}

/**
 * true si esta salida merece un archivo en vez de una columna de texto.
 *
 * dos condiciones a la vez, y las dos hacen falta: que sea larga y que sea un
 * documento. Una explicacion de 10.000 caracteres es una respuesta que se lee,
 * no un archivo que se abre; una web de 300 no merece un archivo todavia.
 */
export function shouldStoreAsArtifact(
  text: string,
  minChars: number = ARTIFACT_MIN_CHARS,
): boolean {
  const trimmed = text.trim();
  if (trimmed.length < minChars) return false;
  return looksLikeCode(trimmed);
}

/**
 * nombre del archivo, construido por Luxy y NUNCA propuesto por el modelo.
 *
 * es la diferencia entre escribir un archivo y dejar que un texto generado
 * elija donde cae: el identificador del trabajo ya es seguro, y aun asi se
 * filtra. Sin nombre utilizable se usa `salida`.
 */
export function artifactFileName(kind: ArtifactKind, shortId: string): string {
  const safe = shortId
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '')
    .slice(0, 32);
  return `${safe.length > 0 ? safe : 'SALIDA'}.${EXTENSIONS[kind]}`;
}

/** texto para la interfaz: que se guardo y cuanto ocupa */
export function describeArtifactSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
