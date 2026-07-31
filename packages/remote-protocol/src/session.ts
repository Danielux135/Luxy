// mensajes de emparejamiento, negociacion y ciclo de vida de la sesion.
import { z } from 'zod';
import { capabilitySchema, DEVICE_KINDS, capabilityReportSchema } from './capabilities.js';
import { deviceIdSchema, sessionIdSchema } from './envelope.js';

// -----------------------------------------------------------------------------
// emparejamiento
// -----------------------------------------------------------------------------

/** clave publica P-256 en formato raw (0x04 ‖ X ‖ Y), base64url. Ver ADR 0001 */
export const publicKeySchema = z
  .string()
  .min(86)
  .max(90)
  .regex(/^[A-Za-z0-9_-]+$/, 'la clave publica debe ir en base64url');

/** firma ECDSA P-256 en formato IEEE P1363 (r‖s), base64url */
export const signatureSchema = z
  .string()
  .min(84)
  .max(90)
  .regex(/^[A-Za-z0-9_-]+$/, 'la firma debe ir en base64url');

/**
 * codigo de emparejamiento.
 *
 * 8 digitos y vida corta. No es un secreto de larga duracion: solo sirve para
 * enlazar dos dispositivos que ya se estan mirando, y la verificacion real la
 * hacen las palabras de confirmacion.
 */
export const pairingCodeSchema = z.string().regex(/^\d{8}$/);

export const PAIRING_CODE_TTL_MS = 3 * 60 * 1000;

export const pairingStartSchema = z.object({
  type: z.literal('pair.start'),
  deviceName: z.string().min(1).max(64),
  deviceKind: z.enum(DEVICE_KINDS),
  publicKey: publicKeySchema,
});

export const pairingOfferSchema = z.object({
  type: z.literal('pair.offer'),
  code: pairingCodeSchema,
  expiresAt: z.number().int().positive(),
  /** huella del host, para que el movil pueda comprobar que habla con quien cree */
  hostFingerprint: z.string().length(64),
});

export const pairingClaimSchema = z.object({
  type: z.literal('pair.claim'),
  code: pairingCodeSchema,
  deviceName: z.string().min(1).max(64),
  deviceKind: z.enum(DEVICE_KINDS),
  publicKey: publicKeySchema,
  /** firma del codigo con la clave privada del que reclama: prueba que la tiene */
  signature: signatureSchema,
});

/**
 * confirmacion mutua.
 *
 * Los dos dispositivos muestran las MISMAS palabras, derivadas de las dos claves
 * publicas. Si un gateway malicioso sustituye una clave, las palabras dejan de
 * coincidir y el usuario lo ve. Es lo que convierte al gateway en un buzon tonto.
 */
export const pairingConfirmSchema = z.object({
  type: z.literal('pair.confirm'),
  code: pairingCodeSchema,
  accepted: z.boolean(),
});

// -----------------------------------------------------------------------------
// negociacion de sesion
// -----------------------------------------------------------------------------

export const SESSION_MODES = ['attended', 'unattended'] as const;
export type SessionMode = (typeof SESSION_MODES)[number];

export const sessionRequestSchema = z.object({
  type: z.literal('session.request'),
  deviceId: deviceIdSchema,
  /** que pide poder hacer; el host concede esto o menos, nunca mas */
  requested: z.array(capabilitySchema).min(1).max(8),
  mode: z.enum(SESSION_MODES).default('attended'),
});

export const sessionGrantSchema = z.object({
  type: z.literal('session.grant'),
  sessionId: sessionIdSchema,
  /** lo que el host concede DE VERDAD, que puede ser menos de lo pedido */
  granted: z.array(capabilitySchema),
  /** capacidades no concedidas, con el motivo, para poder explicarlo */
  denied: z.array(capabilityReportSchema).default([]),
  /** vencimiento del permiso; null = hasta que se cierre la sesion */
  expiresAt: z.number().int().positive().nullable().default(null),
});

export const sessionDenySchema = z.object({
  type: z.literal('session.deny'),
  reason: z.enum([
    'user_rejected',
    'device_not_paired',
    'device_revoked',
    'host_busy',
    'unattended_disabled',
    'rate_limited',
  ]),
  detail: z.string().max(300).default(''),
});

/**
 * SDP firmado. AQUI ESTA LA SEGURIDAD DE TODO EL SISTEMA.
 *
 * La oferta y la respuesta llevan la huella DTLS dentro. Si viajan firmadas con
 * la clave del dispositivo y el otro extremo verifica esa firma contra la clave
 * publica emparejada, un gateway comprometido NO puede sustituir la huella y
 * colocarse en medio. Sin esto, quien controle la senalizacion controla la
 * sesion, por muy cifrado que vaya el DTLS.
 */
export const signedSdpSchema = z.object({
  type: z.enum(['sdp.offer', 'sdp.answer']),
  sessionId: sessionIdSchema,
  sdp: z.string().min(1).max(64 * 1024),
  signature: signatureSchema,
});

export const iceCandidateSchema = z.object({
  type: z.literal('ice.candidate'),
  sessionId: sessionIdSchema,
  candidate: z.string().max(1024),
  sdpMid: z.string().max(64).nullable(),
  sdpMLineIndex: z.number().int().min(0).max(64).nullable(),
});

// -----------------------------------------------------------------------------
// ciclo de vida
// -----------------------------------------------------------------------------

export const monitorInfoSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().max(64),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  primary: z.boolean(),
  /** factor de escala de Windows; el cliente NO lo usa para coordenadas, solo
   *  para mostrarlo en el diagnostico */
  scale: z.number().min(0.5).max(4),
});
export type MonitorInfo = z.infer<typeof monitorInfoSchema>;

export const helloSchema = z.object({
  type: z.literal('hello'),
  protocolVersion: z.number().int().positive(),
  deviceKind: z.enum(DEVICE_KINDS),
  appVersion: z.string().max(32),
  capabilities: z.array(capabilityReportSchema).max(16),
  monitors: z.array(monitorInfoSchema).max(16).default([]),
});

export const heartbeatSchema = z.object({
  type: z.literal('heartbeat'),
  sessionId: sessionIdSchema,
});

export const statsSchema = z.object({
  type: z.literal('stats'),
  rttMs: z.number().min(0).max(60_000),
  packetsLost: z.number().int().min(0),
  bitrateKbps: z.number().min(0),
  framesDropped: z.number().int().min(0),
  fps: z.number().min(0).max(240),
  jitterMs: z.number().min(0),
  codec: z.string().max(32),
  width: z.number().int().min(0),
  height: z.number().int().min(0),
  /** si va por TURN o directo: cambia la latencia y el consumo, hay que verlo */
  relayed: z.boolean(),
});

export const SESSION_END_REASONS = [
  'user_ended_local',
  'user_ended_remote',
  'timeout_idle',
  'timeout_max_duration',
  'revoked',
  'permission_expired',
  'transport_failed',
  'host_shutdown',
  'error',
] as const;

export const sessionEndSchema = z.object({
  type: z.literal('session.end'),
  sessionId: sessionIdSchema,
  reason: z.enum(SESSION_END_REASONS),
  detail: z.string().max(300).default(''),
});

export const protocolErrorSchema = z.object({
  type: z.literal('error'),
  code: z.string().max(64),
  detail: z.string().max(300),
  /** si el cliente puede reintentar o es definitivo */
  retryable: z.boolean().default(false),
});

export const sessionMessageSchema = z.discriminatedUnion('type', [
  helloSchema,
  sessionRequestSchema,
  sessionGrantSchema,
  sessionDenySchema,
  iceCandidateSchema,
  heartbeatSchema,
  statsSchema,
  sessionEndSchema,
  protocolErrorSchema,
]);

export type SessionMessage = z.infer<typeof sessionMessageSchema>;
export type SignedSdp = z.infer<typeof signedSdpSchema>;
