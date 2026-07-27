// generacion de identificadores legibles y slugs seguros para ramas
import { JOB_SHORT_ID_PREFIX, LUXY_BRANCH_PREFIX } from './constants.js';

// alfabeto sin caracteres ambiguos (sin I, O, 0, 1) para leer los ids en el movil
const SHORT_ID_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/**
 * genera un identificador corto tipo LUX-4F82 para mostrar en telegram.
 * usa crypto.getRandomValues, disponible tanto en node como en workers.
 */
export function generateShortId(length = 4): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const byte of bytes) {
    out += SHORT_ID_ALPHABET[byte % SHORT_ID_ALPHABET.length];
  }
  return `${JOB_SHORT_ID_PREFIX}${out}`;
}

/** comprueba si una cadena tiene la forma de un identificador corto de trabajo */
export function isShortId(value: string): boolean {
  return new RegExp(`^${JOB_SHORT_ID_PREFIX}[${SHORT_ID_ALPHABET}]{3,8}$`).test(
    value.toUpperCase(),
  );
}

/** normaliza lo que el usuario escribe para poder buscar el trabajo */
export function normalizeShortId(value: string): string {
  const upper = value.trim().toUpperCase();
  return upper.startsWith(JOB_SHORT_ID_PREFIX) ? upper : `${JOB_SHORT_ID_PREFIX}${upper}`;
}

/**
 * convierte texto libre en un slug apto para un nombre de rama de git.
 * git rechaza espacios, tildes, dos puntos consecutivos y otros caracteres.
 */
export function slugify(text: string, maxLength = 32): string {
  const slug = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
  return slug.length > 0 ? slug : 'tarea';
}

/** construye el nombre de rama que luxy usara en el worktree */
export function buildBranchName(shortId: string, prompt: string): string {
  const id = shortId.replace(JOB_SHORT_ID_PREFIX, '').toLowerCase();
  return `${LUXY_BRANCH_PREFIX}${id}-${slugify(prompt)}`;
}
