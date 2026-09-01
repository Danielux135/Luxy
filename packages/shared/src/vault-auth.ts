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

export const vaultRegisterRequestSchema = z.object({
  email: vaultEmailSchema,
  authSalt: base64UrlSchema.length(22),
  argon2Params: argon2ParamsSchema,
  authHash: base64UrlSchema.length(43),
  wrappedMasterKey: sealedEnvelopeSchema,
  vaultId: base64UrlSchema.length(43),
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
});
export type VaultLoginStartResponse = z.infer<typeof vaultLoginStartResponseSchema>;

/** con la maestra ya abierta en local, el cliente prueba el hash de acceso */
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
  /** prueba la contraseña actual sin enviarla */
  currentAuthHash: base64UrlSchema.length(43),
  authSalt: base64UrlSchema.length(22),
  argon2Params: argon2ParamsSchema,
  authHash: base64UrlSchema.length(43),
  wrappedMasterKey: sealedEnvelopeSchema,
});
