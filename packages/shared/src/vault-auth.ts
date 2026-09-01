// contrato de las cuentas de bóveda.
//
// La forma de lo que viaja entre el cliente y el gateway al registrarse, entrar
// y salir. Como el resto de `vault.ts`: el servidor valida la FORMA, nunca
// puede leer el contenido.
//
// Lo que el servidor recibe y guarda —hash de acceso, sal, coste, llave
// envuelta— le permite verificar quién eres, no abrir tu bóveda. Ver D-046.
import { z } from 'zod';

const base64UrlSchema = z
  .string()
  .max(16_000)
  .regex(/^[A-Za-z0-9_-]*$/, 'el valor debe estar en base64url');

/** el mismo sobre sellado que el resto de la bóveda */
const sealedEnvelopeSchema = z.object({
  version: z.number().int().min(1).max(255),
  purpose: z.literal('vault.account.masterkey'),
  nonce: base64UrlSchema.length(16),
  ciphertext: base64UrlSchema.min(1),
});

/**
 * el sobre de la copia de recuperación.
 *
 * Propósito distinto y validado como tal: intercambiarlo con el de contraseña
 * en la base de datos no cuela, porque el propósito viaja autenticado
 * (`D-041`), y el servidor tampoco lo acepta por la forma.
 */
const recoveryEnvelopeSchema = z.object({
  version: z.number().int().min(1).max(255),
  purpose: z.literal('vault.account.recovery'),
  nonce: base64UrlSchema.length(16),
  ciphertext: base64UrlSchema.min(1),
});

const argon2ParamsSchema = z.object({
  t: z.number().int().min(1).max(16),
  m: z.number().int().min(8 * 1024).max(2 * 1024 * 1024),
  p: z.number().int().min(1).max(4),
});

/** correo normalizado: en minúsculas, forma básica. NO se prueba entrega */
export const vaultEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(320)
  .email();

/**
 * mínimo de contraseña, validado también en servidor.
 *
 * con varias personas, la contraseña más débil de la organización es el
 * objetivo de una filtración, así que el mínimo deja de ser una sugerencia del
 * cliente (D-046).
 */
export const VAULT_MIN_PASSWORD_LENGTH = 10;

/**
 * la misma llave maestra envuelta con la clave de recuperación.
 *
 * Es lo que hace que olvidar la contraseña no pierda la bóveda **ni siquiera
 * desde un ordenador nuevo** (`F9.19`). Su coste de Argon2id es más bajo a
 * propósito: la clave de recuperación no es una contraseña, son ~157 bits al
 * azar y no hay diccionario que probar (`D-049`).
 */
export const vaultRecoverySchema = z.object({
  authSalt: base64UrlSchema.length(22),
  argon2Params: argon2ParamsSchema,
  authHash: base64UrlSchema.length(43),
  wrappedMasterKey: recoveryEnvelopeSchema,
});
export type VaultRecovery = z.infer<typeof vaultRecoverySchema>;

export const vaultRegisterRequestSchema = z.object({
  email: vaultEmailSchema,
  authSalt: base64UrlSchema.length(22),
  argon2Params: argon2ParamsSchema,
  authHash: base64UrlSchema.length(43),
  wrappedMasterKey: sealedEnvelopeSchema,
  vaultId: base64UrlSchema.length(43),
  recovery: vaultRecoverySchema,
});
export type VaultRegisterRequest = z.infer<typeof vaultRegisterRequestSchema>;

/** el cliente pide primero los parámetros para poder derivar antes de entrar */
export const vaultLoginStartRequestSchema = z.object({
  email: vaultEmailSchema,
});

export const vaultLoginStartResponseSchema = z.object({
  authSalt: base64UrlSchema.length(22),
  argon2Params: argon2ParamsSchema,
  wrappedMasterKey: sealedEnvelopeSchema,
  /**
   * la puerta de la clave de recuperación, con su propia sal y su propio coste.
   *
   * Viaja SIEMPRE, también en la respuesta señuelo de un correo que no existe:
   * omitirla para las cuentas sin recuperación delataría cuáles la tienen.
   */
  recovery: vaultRecoverySchema.omit({ authHash: true }),
});
export type VaultLoginStartResponse = z.infer<typeof vaultLoginStartResponseSchema>;

/**
 * con la maestra ya abierta en local, el cliente prueba el hash de acceso.
 *
 * No dice por qué puerta entró: el servidor compara con los dos hashes que
 * guarda —el de la contraseña y el de la clave de recuperación— y los dos
 * prueban lo mismo, que quien llama puede abrir la bóveda. Decirlo sólo daría
 * al servidor un dato que no necesita.
 */
export const vaultLoginFinishRequestSchema = z.object({
  email: vaultEmailSchema,
  authHash: base64UrlSchema.length(43),
});

export const vaultSessionResponseSchema = z.object({
  /** token de sesión en claro; el servidor guarda solo su hash */
  sessionToken: z.string().min(16).max(200),
  expiresAt: z.string().datetime(),
  /** para que el cliente confirme que le dieron su cuenta y no otra */
  vaultId: base64UrlSchema.length(43),
});
export type VaultSessionResponse = z.infer<typeof vaultSessionResponseSchema>;

export const vaultChangePasswordRequestSchema = z.object({
  /**
   * prueba la contraseña actual sin enviarla.
   *
   * vale también el hash de la clave de recuperación: es lo que permite
   * arreglar de verdad un «he olvidado la contraseña» —entrar con la clave y
   * elegir una nueva— en vez de dejar al usuario con acceso pero sin poder
   * cambiarla.
   */
  currentAuthHash: base64UrlSchema.length(43),
  authSalt: base64UrlSchema.length(22),
  argon2Params: argon2ParamsSchema,
  authHash: base64UrlSchema.length(43),
  wrappedMasterKey: sealedEnvelopeSchema,
});
