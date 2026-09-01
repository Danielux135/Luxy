// archivo de envolturas de la boveda.
//
// Este archivo se puede leer. Contiene la llave maestra CIFRADA una vez por
// cada forma de abrirla, nunca la llave. Copiarlo no da acceso a nada: hace
// falta la contraseña, la clave de recuperacion o la cuenta de Windows.
//
// Vive junto a config.json, fuera del repositorio.
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { keyWrapSchema, type KeyWrapRecord, type WrapMethodName } from '@luxy/shared';
import { z } from 'zod';

const FORMAT_VERSION = 1;

/**
 * opciones de bloqueo automatico, en minutos. 0 = no cerrar sola.
 *
 * Es una lista cerrada y no un numero libre porque el valor viaja desde el
 * renderer: un entero arbitrario permitiria pedir un cierre cada 50 ms y dejar
 * la boveda inservible.
 */
export const AUTO_LOCK_MINUTES = [1, 5, 15, 30, 60, 240, 0] as const;
export type AutoLockMinutes = (typeof AUTO_LOCK_MINUTES)[number];

/** cinco minutos. Es un punto de partida, no una recomendacion */
export const DEFAULT_AUTO_LOCK_MINUTES = 5;

export class VaultFileError extends Error {
  constructor(
    message: string,
    readonly hint: string | null = null,
  ) {
    super(message);
    this.name = 'VaultFileError';
  }
}

/**
 * el archivo completo.
 *
 * `wraps` no puede tener dos entradas del mismo metodo: dos envolturas de
 * contraseña significarian dos contraseñas validas, y ninguna forma de saber
 * cual creia el usuario que habia cambiado.
 */
export const vaultKeyFileSchema = z.object({
  version: z.literal(FORMAT_VERSION),
  wraps: z
    .array(keyWrapSchema)
    .min(1)
    .max(8)
    .refine(
      (wraps) => new Set(wraps.map((wrap) => wrap.method)).size === wraps.length,
      { message: 'hay dos envolturas del mismo metodo' },
    ),
  createdAt: z.string().datetime(),
  /**
   * cuenta a la que pertenece esta boveda, si esta vinculada.
   *
   * No es un secreto y no autoriza nada: es la etiqueta que permite decir de
   * quien es la boveda de este equipo sin haber iniciado sesion, y detectar que
   * alguien intenta abrir aqui la boveda de otra cuenta. Opcional porque una
   * boveda creada antes de existir las cuentas sigue siendo valida.
   */
  account: z
    .object({
      email: z.string().min(3).max(320),
      vaultId: z.string().length(43),
    })
    .optional(),
  /**
   * ajustes de la boveda. No son secretos, por eso viven en el mismo archivo.
   *
   * opcional para que una boveda creada antes de existir este campo se siga
   * abriendo: se le aplica el valor por defecto.
   */
  settings: z
    .object({
      autoLockMinutes: z
        .union([
          z.literal(1),
          z.literal(5),
          z.literal(15),
          z.literal(30),
          z.literal(60),
          z.literal(240),
          z.literal(0),
        ])
        .default(DEFAULT_AUTO_LOCK_MINUTES),
    })
    .default({ autoLockMinutes: DEFAULT_AUTO_LOCK_MINUTES }),
});

export type VaultKeyFile = z.infer<typeof vaultKeyFileSchema>;

export function vaultFilePathFor(configDirectory: string): string {
  return join(configDirectory, 'vault.json');
}

export function readVaultKeyFile(file: string): VaultKeyFile | null {
  if (!existsSync(file)) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    throw new VaultFileError(
      'el archivo de la boveda no se puede leer',
      'puede estar dañado. Si tienes la clave de recuperacion, podras recrearlo.',
    );
  }

  const parsed = vaultKeyFileSchema.safeParse(raw);
  if (!parsed.success) {
    // no se "repara" ni se ignora la parte mala: un archivo de llaves a medias
    // es justo el sitio donde adivinar acaba en perdida de datos
    throw new VaultFileError(
      'el archivo de la boveda no tiene el formato esperado',
      'no se toca por seguridad. Usa la clave de recuperacion para volver a crearlo.',
    );
  }
  return parsed.data;
}

/** escritura atomica: un corte a medias no puede dejar el archivo ilegible */
export function writeVaultKeyFile(file: string, contents: VaultKeyFile): void {
  const parsed = vaultKeyFileSchema.safeParse(contents);
  if (!parsed.success) throw new VaultFileError('las envolturas a guardar no son validas');

  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  writeFileSync(temporary, JSON.stringify(parsed.data, null, 2), 'utf8');
  renameSync(temporary, file);
}

export function deleteVaultKeyFile(file: string): void {
  if (existsSync(file)) unlinkSync(file);
}

/**
 * frontera entre @luxy/vault-crypto y el contrato de @luxy/shared.
 *
 * vault-crypto trabaja con `purpose: string` porque no le corresponde conocer
 * el catalogo de dominios de Luxy. shared lo estrecha a una lista cerrada. Esta
 * funcion es donde esa lista se impone, y lo hace EN EJECUCION, no con un cast:
 * un proposito inventado no llega a escribirse en disco.
 */
export function toKeyWrapRecord(wrap: unknown): KeyWrapRecord {
  const parsed = keyWrapSchema.safeParse(wrap);
  if (!parsed.success) {
    throw new VaultFileError('la envoltura generada no encaja con el contrato de la boveda');
  }
  return parsed.data;
}

export function findWrap(
  contents: VaultKeyFile,
  method: WrapMethodName,
): KeyWrapRecord | undefined {
  return contents.wraps.find((wrap) => wrap.method === method);
}

/** sustituye la envoltura de un metodo, o la añade si no existia */
export function upsertWrap(contents: VaultKeyFile, wrap: unknown): VaultKeyFile {
  const record = toKeyWrapRecord(wrap);
  const others = contents.wraps.filter((existing) => existing.method !== record.method);
  return { ...contents, wraps: [...others, record] };
}

export function removeWrap(contents: VaultKeyFile, method: WrapMethodName): VaultKeyFile {
  return { ...contents, wraps: contents.wraps.filter((wrap) => wrap.method !== method) };
}

export function createVaultKeyFile(
  wraps: unknown[],
  account?: { email: string; vaultId: string },
): VaultKeyFile {
  return {
    version: FORMAT_VERSION,
    wraps: wraps.map(toKeyWrapRecord),
    createdAt: new Date().toISOString(),
    ...(account === undefined ? {} : { account }),
    settings: { autoLockMinutes: DEFAULT_AUTO_LOCK_MINUTES },
  };
}
