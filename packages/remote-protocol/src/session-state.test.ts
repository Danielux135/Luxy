// pruebas de la maquina de estados de la sesion.
//
// Lo que se protege: que una sesion no conceda mas de lo que el dispositivo
// tiene, que el modo atendido pida permiso de verdad, y que revocar durante una
// sesion activa la corte en el acto en vez de esperar a la siguiente conexion.
import { describe, it, expect } from 'vitest';
import {
  RemoteSession,
  DEFAULT_IDLE_TIMEOUT_MS,
  DEFAULT_MAX_DURATION_MS,
  USER_PROMPT_TIMEOUT_MS,
  type SessionPolicy,
} from './session-state.js';
import type { Capability } from './capabilities.js';

const SESION = '66666666-6666-4666-8666-666666666666';
const DEVICE = '77777777-7777-4777-8777-777777777777';
const T0 = 1_800_000_000_000;

function sesion(policy: Partial<SessionPolicy> = {}): RemoteSession {
  return new RemoteSession(SESION, DEVICE, {
    devicePermissions: ['view', 'control'] as Capability[],
    unattended: false,
    deviceActive: true,
    ...policy,
  });
}

describe('modo atendido: pide permiso de verdad', () => {
  it('una sesion queda esperando al usuario', () => {
    const s = sesion();
    const resultado = s.request(['view', 'control'], T0);

    expect(resultado.ok).toBe(true);
    if (resultado.ok) expect(resultado.state).toBe('awaiting_user');
    // y mientras espera NO puede hacer nada
    expect(s.activeCapabilities()).toEqual([]);
  });

  it('si el usuario rechaza, la sesion termina', () => {
    const s = sesion();
    s.request(['view', 'control'], T0);
    s.userDecision(false, [], T0 + 1000);

    expect(s.snapshot().state).toBe('ended');
    expect(s.snapshot().endCause).toBe('user_rejected');
  });

  it('el usuario puede conceder MENOS de lo pedido', () => {
    // "permitir solo visualizacion" es una opcion del dialogo
    const s = sesion();
    s.request(['view', 'control'], T0);
    s.userDecision(true, ['view'], T0 + 1000);
    s.beginNegotiation(['sha-256 AA'], T0 + 1100);
    s.activate(T0 + 2000);

    expect(s.activeCapabilities()).toEqual(['view']);
  });

  it('el usuario NO puede conceder mas de lo pedido', () => {
    const s = sesion();
    s.request(['view'], T0);
    s.userDecision(true, ['view', 'control'], T0 + 1000);
    s.beginNegotiation([], T0 + 1100);
    s.activate(T0 + 2000);

    expect(s.activeCapabilities()).toEqual(['view']);
  });

  it('conceder solo control sin ver se rechaza: no se controla a ciegas', () => {
    const s = sesion();
    s.request(['view', 'control'], T0);
    s.userDecision(true, ['control'], T0 + 1000);

    expect(s.snapshot().state).toBe('ended');
  });

  it('si nadie contesta al dialogo, la sesion caduca sola', () => {
    const s = sesion();
    s.request(['view'], T0);

    const causa = s.checkExpiry(T0 + USER_PROMPT_TIMEOUT_MS + 1, true);
    expect(causa).toBe('user_rejected');
  });
});

describe('acceso desatendido', () => {
  it('entra sin confirmacion local', () => {
    const s = sesion({ unattended: true });
    const resultado = s.request(['view', 'control'], T0);

    expect(resultado.ok).toBe(true);
    if (resultado.ok) expect(resultado.state).toBe('negotiating');
  });

  it('un dispositivo SIN desatendido nunca salta el dialogo', () => {
    const s = sesion({ unattended: false });
    const resultado = s.request(['view'], T0);
    if (resultado.ok) expect(resultado.state).toBe('awaiting_user');
  });
});

describe('permisos: nunca mas de lo concedido', () => {
  it('pedir mas de lo que tiene se recorta', () => {
    // un cliente comprometido pediria todo; se recorta en vez de rechazar
    const s = sesion({ devicePermissions: ['view'] as Capability[], unattended: true });
    const resultado = s.request(['view', 'control', 'file_receive'], T0);

    expect(resultado.ok).toBe(true);
    if (resultado.ok) expect(resultado.granted).toEqual(['view']);
  });

  it('si NADA de lo pedido esta concedido, se rechaza', () => {
    const s = sesion({ devicePermissions: ['view'] as Capability[] });
    const resultado = s.request(['control', 'file_send'], T0);

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.code).toBe('requested_more_than_granted');
  });

  it('un dispositivo SIN permisos no abre sesion', () => {
    // es el estado en el que nace todo dispositivo recien emparejado
    const s = sesion({ devicePermissions: [] });
    const resultado = s.request(['view'], T0);

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.code).toBe('no_permissions');
  });

  it('un dispositivo REVOCADO no abre sesion', () => {
    const s = sesion({ deviceActive: false });
    const resultado = s.request(['view'], T0);

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.code).toBe('device_revoked');
  });

  it('no se puede pedir sesion dos veces sobre el mismo objeto', () => {
    const s = sesion({ unattended: true });
    s.request(['view'], T0);
    const segunda = s.request(['view', 'control'], T0 + 100);

    expect(segunda.ok).toBe(false);
    if (!segunda.ok) expect(segunda.code).toBe('already_active');
  });
});

describe('revocar durante una sesion activa', () => {
  function activa(): RemoteSession {
    const s = sesion({ unattended: true });
    s.request(['view', 'control'], T0);
    s.beginNegotiation(['sha-256 AA'], T0 + 100);
    s.activate(T0 + 200);
    return s;
  }

  it('LA CORTA EN EL ACTO, no en la siguiente conexion', () => {
    const s = activa();
    expect(s.activeCapabilities()).toHaveLength(2);

    const causa = s.checkExpiry(T0 + 1000, false);

    expect(causa).toBe('device_revoked');
    expect(s.snapshot().state).toBe('ended');
    expect(s.activeCapabilities()).toEqual([]);
  });

  it('una sesion terminada NO acepta mas actividad', () => {
    // esto es lo que impide que los mensajes en vuelo se ejecuten tras cortar
    const s = activa();
    s.end('user_ended_local', T0 + 1000);

    expect(s.touch(T0 + 1100)).toBe(false);
    expect(s.activeCapabilities()).toEqual([]);
  });

  it('terminar dos veces no cambia la causa original', () => {
    const s = activa();
    s.end('user_ended_local', T0 + 1000);
    s.end('transport_failed', T0 + 2000);

    expect(s.snapshot().endCause).toBe('user_ended_local');
  });
});

describe('vencimientos', () => {
  function activa(policy: Partial<SessionPolicy> = {}): RemoteSession {
    const s = sesion({ unattended: true, ...policy });
    s.request(['view'], T0);
    s.beginNegotiation([], T0 + 100);
    s.activate(T0 + 200);
    return s;
  }

  it('corta por inactividad', () => {
    const s = activa();
    expect(s.checkExpiry(T0 + DEFAULT_IDLE_TIMEOUT_MS + 1000, true)).toBe('timeout_idle');
  });

  it('la actividad reinicia el contador de inactividad', () => {
    const s = activa();
    s.touch(T0 + DEFAULT_IDLE_TIMEOUT_MS - 1000);
    expect(s.checkExpiry(T0 + DEFAULT_IDLE_TIMEOUT_MS + 500, true)).toBeNull();
  });

  it('corta por duracion maxima AUNQUE haya actividad', () => {
    const s = activa();
    let ahora = T0;
    // se mantiene viva tocando cada minuto
    for (let i = 0; i < 300; i += 1) {
      ahora += 60_000;
      s.touch(ahora);
      if (s.snapshot().state === 'ended') break;
      s.checkExpiry(ahora, true);
    }

    expect(s.snapshot().endCause).toBe('timeout_max_duration');
    expect(ahora - T0).toBeGreaterThan(DEFAULT_MAX_DURATION_MS);
  });

  it('los topes se pueden configurar', () => {
    const s = activa({ idleTimeoutMs: 5_000 });
    expect(s.checkExpiry(T0 + 6_000, true)).toBe('timeout_idle');
  });
});

describe('transiciones invalidas', () => {
  it('no se activa una sesion que no esta negociando', () => {
    const s = sesion();
    expect(s.activate(T0)).toBe(false);
  });

  it('no se decide sobre una sesion que no espera al usuario', () => {
    const s = sesion({ unattended: true });
    s.request(['view'], T0);
    expect(s.userDecision(true, ['view'], T0 + 100)).toBe(false);
  });

  it('no se negocia sin haber pedido', () => {
    const s = sesion();
    expect(s.beginNegotiation(['x'], T0)).toBe(false);
  });

  it('una sesion recien creada no concede nada', () => {
    expect(sesion().activeCapabilities()).toEqual([]);
  });
});
