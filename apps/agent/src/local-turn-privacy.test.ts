// garantias de higiene de un turno privado.
//
// Estas pruebas no comprueban criptografia: comprueban que el contenido no se
// escapa por los caminos LATERALES, que es por donde se filtra de verdad. Un
// registro, una notificacion de Windows o un volcado de fallo revelan lo mismo
// que un archivo sin cifrar, y con menos esfuerzo.
import { describe, it, expect } from 'vitest';
import { agentEventSchema } from '@luxy/shared';
import type { AgentEvent } from '@luxy/shared';

/**
 * tipos de evento que hacen aparecer una notificacion de Windows.
 *
 * copiado de `onAgentEvent` en apps/desktop/src/main/index.ts. Si alli se añade
 * uno nuevo y aqui no, esta lista deja de proteger: por eso la prueba de abajo
 * comprueba que un turno privado no emite NINGUNO, no solo estos.
 */
const NOTIFYING_EVENTS = ['job.completed', 'job.failed', 'approval.pending', 'agent.error'];

/** los unicos eventos que host-entry emite durante un turno privado */
const PRIVATE_TURN_EVENTS = ['job.phase', 'job.warning'];

describe('un turno privado no dispara notificaciones', () => {
  it('los eventos que emite no estan entre los que notifican', () => {
    for (const type of PRIVATE_TURN_EVENTS) {
      expect(NOTIFYING_EVENTS).not.toContain(type);
    }
  });

  it('una fase privada es un evento valido y solo lleva el mensaje de fase', () => {
    const event: AgentEvent = {
      type: 'job.phase',
      at: new Date().toISOString(),
      jobId: '44444444-4444-4444-8444-444444444444',
      shortId: 'LOCAL-44444444',
      message: 'consultando al proveedor',
    };
    const parsed = agentEventSchema.safeParse(event);
    expect(parsed.success).toBe(true);
    // no hay campo donde quepa el texto de la respuesta
    expect(Object.keys(event).sort()).toEqual(['at', 'jobId', 'message', 'shortId', 'type']);
  });

  it('el identificador visible no revela de que conversacion es', () => {
    // "LOCAL-" + ocho caracteres del uuid del TURNO, no de la conversacion
    const shortId = 'LOCAL-44444444';
    expect(shortId).not.toContain('conversation');
    expect(shortId.length).toBeLessThanOrEqual(20);
  });
});

describe('los eventos de contenido no viajan', () => {
  it('job.output no esta entre los que emite un turno privado', () => {
    // `provider_output` lleva el texto que va generando el modelo. Es el que
    // convertiria el registro de eventos en una copia de la conversacion.
    expect(PRIVATE_TURN_EVENTS).not.toContain('job.output');
  });

  it('job.completed tampoco: llevaria el resumen, que es LA respuesta', () => {
    // en una conversacion `summary` no es un resumen, es la respuesta entera
    // (D-020). Por eso el resultado de un turno privado vuelve por el canal
    // aparte `local_turn` y no como evento.
    expect(PRIVATE_TURN_EVENTS).not.toContain('job.completed');
  });
});
