// capacidades de un dispositivo y de una sesion.
//
// REGLA CENTRAL: la interfaz NUNCA deduce lo que se puede hacer a partir del
// sistema operativo. La capacidad es un dato que declara el host, que el gateway
// contrasta con los permisos del dispositivo, y que el host vuelve a comprobar
// en cada mensaje. Ver docs/adr/0002-modelo-de-capacidades.md
import { z } from 'zod';

// iOS queda FUERA DEL ALCANCE por decision del proyecto (uso personal,
// sideload, sin App Store). Ver docs/adr/0006-alcance-android-windows.md
export const DEVICE_KINDS = ['desktop', 'android'] as const;
export type DeviceKind = (typeof DEVICE_KINDS)[number];

/**
 * lo que un host puede ofrecer.
 *
 * `control` implica `view`: no se puede controlar a ciegas. El validador lo
 * exige, no es solo una convencion.
 */
export const CAPABILITIES = [
  'view',
  'control',
  'audio',
  'clipboard_read',
  'clipboard_write',
  'file_send',
  'file_receive',
] as const;
export type Capability = (typeof CAPABILITIES)[number];

export const capabilitySchema = z.enum(CAPABILITIES);

/**
 * por que NO esta disponible una capacidad.
 *
 * existe porque un icono gris no es accionable. "iOS no ofrece API publica para
 * inyectar toques" le dice al usuario que no hay nada que configurar; "el
 * usuario no ha concedido el permiso" le dice que si.
 */
export const UNAVAILABLE_REASONS = [
  'platform_forbids',
  'permission_denied',
  'not_granted_for_session',
  'requires_sideload',
  'host_disabled',
  'unknown',
] as const;
export type UnavailableReason = (typeof UNAVAILABLE_REASONS)[number];

export const capabilityReportSchema = z.object({
  capability: capabilitySchema,
  available: z.boolean(),
  reason: z.enum(UNAVAILABLE_REASONS).nullable().default(null),
  /** explicacion en lenguaje llano, ya lista para mostrar */
  detail: z.string().max(300).default(''),
});
export type CapabilityReport = z.infer<typeof capabilityReportSchema>;

/**
 * grado maximo al que puede llegar un host.
 * ordenado de mas a menos: sirve para degradar sin inventar.
 */
export const CAPABILITY_TIERS = ['control', 'view', 'transfer', 'clipboard', 'luxy_only'] as const;
export type CapabilityTier = (typeof CAPABILITY_TIERS)[number];

/** deduce el grado a partir de las capacidades concedidas */
export function tierOf(granted: readonly Capability[]): CapabilityTier {
  if (granted.includes('control')) return 'control';
  if (granted.includes('view')) return 'view';
  if (granted.includes('file_send') || granted.includes('file_receive')) return 'transfer';
  if (granted.includes('clipboard_read') || granted.includes('clipboard_write')) return 'clipboard';
  return 'luxy_only';
}

/**
 * comprueba que el conjunto de capacidades es coherente.
 *
 * `control` sin `view` seria controlar a ciegas: se rechaza en vez de
 * aceptarlo y que el usuario descubra el sinsentido en mitad de una sesion.
 */
export function validateCapabilitySet(granted: readonly Capability[]): string | null {
  if (granted.includes('control') && !granted.includes('view')) {
    return 'no se puede conceder control sin conceder tambien visualizacion';
  }
  return null;
}

/**
 * lo que cada plataforma puede ofrecer COMO HOST, segun la investigacion de la
 * fase 0. Es un valor por defecto para la interfaz, NO una autorizacion: la
 * autorizacion siempre la da el host en tiempo real.
 *
 * Ver docs/adr/0002-modelo-de-capacidades.md para las fuentes.
 */
export const PLATFORM_HOST_LIMITS: Record<DeviceKind, readonly Capability[]> = {
  desktop: [
    'view',
    'control',
    'audio',
    'clipboard_read',
    'clipboard_write',
    'file_send',
    'file_receive',
  ],
  // el control existe pero solo por sideload (Shizuku/ADB); en Google Play la
  // build no lo lleva. La captura para al bloquear pantalla desde Android 15 QPR1
  android: ['view', 'clipboard_read', 'clipboard_write', 'file_send', 'file_receive'],
} as const;

/** motivo por el que una plataforma no puede ofrecer una capacidad */
export function explainMissing(kind: DeviceKind, capability: Capability): CapabilityReport {
  const permitidas = PLATFORM_HOST_LIMITS[kind];
  if (permitidas.includes(capability)) {
    return { capability, available: true, reason: null, detail: '' };
  }

  if (kind === 'android' && capability === 'control') {
    return {
      capability,
      available: false,
      reason: 'requires_sideload',
      detail:
        'controlar Android necesita Shizuku o ADB, que no se pueden usar en la version ' +
        'de Google Play. Disponible en la version instalada manualmente.',
    };
  }
  if (kind === 'android' && capability === 'audio') {
    return {
      capability,
      available: false,
      reason: 'platform_forbids',
      detail:
        'Android solo deja capturar audio de apps que lo permiten, y nunca de llamadas.',
    };
  }

  return { capability, available: false, reason: 'unknown', detail: '' };
}
