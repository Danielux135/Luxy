// migracion de secretos en claro al almacen cifrado.
//
// hay tres orígenes historicos, todos en texto plano:
//   1. machineToken dentro de config.json
//   2. claves de API en .env.providers, en la raiz del repositorio
//   3. un archivo suelto que el usuario señale (por ejemplo un .txt de notas)
//
// la migracion importa, cifra y DESPUES ofrece borrar el original. Nunca borra
// sola: perder una clave por una decision automatica es peor que dejar el
// archivo un rato mas.
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { isSecretKeyName } from '@luxy/shared';

/** una clave detectada, sin su valor: esto es lo que puede ver el renderer */
export interface DetectedSecret {
  /** nombre de la variable, por ejemplo DEEPSEEK_API_KEY */
  name: string;
  /** los cuatro ultimos caracteres, para que el usuario la reconozca */
  preview: string;
  source: string;
}

export interface MigrationCandidate {
  file: string;
  secrets: DetectedSecret[];
}

/** valores de ejemplo que nunca deben importarse */
function isPlaceholder(value: string): boolean {
  return value.length === 0 || /^PENDIENTE/i.test(value) || /^(x{3,}|\.{3,}|tu[-_])/i.test(value);
}

/** solo los ultimos caracteres; suficiente para reconocerla, inutil para usarla */
export function previewOf(value: string): string {
  return value.length <= 4 ? '****' : `...${value.slice(-4)}`;
}

/**
 * parsea un archivo tipo .env.
 *
 * mismo formato que loadProviderKeys del agente: CLAVE=valor, con # como
 * comentario y comillas opcionales.
 */
export function parseEnvFile(content: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;

    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;

    const name = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (name.length === 0 || isPlaceholder(value)) continue;
    values[name] = value;
  }
  return values;
}

/**
 * busca claves sueltas en un texto libre.
 *
 * sirve para archivos de notas donde la clave no esta en formato CLAVE=valor.
 * solo reconoce prefijos inequivocos, para no importar basura.
 */
export function findLooseSecrets(content: string): string[] {
  const patterns = [/\bsk-[A-Za-z0-9_-]{16,}\b/g, /\bsb_secret_[A-Za-z0-9_-]{16,}\b/g];
  const found = new Set<string>();
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) found.add(match[0]);
  }
  return [...found];
}

/** inspecciona un archivo .env sin importar nada todavia */
export function inspectEnvFile(file: string): MigrationCandidate | null {
  if (!existsSync(file)) return null;

  let content: string;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    return null;
  }

  const values = parseEnvFile(content);
  const secrets: DetectedSecret[] = Object.entries(values)
    // solo lo que parece un secreto por su nombre; el resto es configuracion
    .filter(([name]) => isSecretKeyName(name))
    .map(([name, value]) => ({ name, preview: previewOf(value), source: file }));

  return secrets.length === 0 ? null : { file, secrets };
}

/** lee los valores reales para importarlos. SOLO en el proceso principal */
export function readEnvSecrets(file: string, names: string[]): Record<string, string> {
  if (!existsSync(file)) return {};
  const values = parseEnvFile(readFileSync(file, 'utf8'));
  const selected: Record<string, string> = {};
  for (const name of names) {
    const value = values[name];
    if (typeof value === 'string' && value.length > 0) selected[name] = value;
  }
  return selected;
}

/**
 * borra el archivo original tras confirmar la importacion.
 *
 * se comprueba que las claves esten realmente guardadas antes de borrar: sin
 * esta condicion, un fallo del almacen cifrado perderia las claves para siempre.
 */
export function deleteMigratedFile(file: string, verify: () => boolean): boolean {
  if (!verify()) return false;
  if (!existsSync(file)) return true;
  unlinkSync(file);
  return true;
}
