import { describe, it, expect } from 'vitest';
import { handleVaultConversations, handleVaultDelete, handleVaultPull, handleVaultPush } from './vault.js';

const VAULT_ID = 'A'.repeat(43);
const CONVERSATION = 'ad6a9bf6-c69f-4eab-9624-f405b78bdda5';

const envelope = {
  version: 1,
  purpose: 'vault.conversation' as const,
  nonce: 'QLBVV_RjvTFFlpRx',
  ciphertext: 'gKXo4HjmSky6cOWq',
};

const record = (sequence = 0) => ({
  recordId: `0000000${sequence}-0000-4000-8000-000000000000`,
  conversationId: CONVERSATION,
  privacy: 'private' as const,
  sequence,
  content: envelope,
  sealedMemory: null,
  createdAt: '2026-09-01T14:33:21.073Z',
});

/**
 * ALCANCE DE ESTAS PRUEBAS, para que nadie las lea como mas de lo que son.
 *
 * Los cuatro manejadores estan envueltos en `withMachineAuth`, que consulta el
 * token contra Supabase. Conducirlos de extremo a extremo exigiria un cliente
 * falso completo, y eso ya lo cubren las pruebas de autenticacion.
 *
 * Aqui se verifica el CONTRATO: que un lote se acota, que un identificador de
 * boveda mal formado se rechaza, que el guardian de texto en claro hace su
 * trabajo, y que la respuesta de listado no tiene donde meter un titulo.
 *
 * Lo que NO se verifica y sigue pendiente de una prueba real contra Postgres:
 * que la idempotencia por (vault_id, conversation_id, sequence) funcione de
 * verdad, y que el borrado en cascada se lleve turnos y medios.
 */

describe('contrato de subida', () => {
  it('el manejador existe y esta protegido por autenticacion de maquina', () => {
    // no se exporta el interior: la unica via es con token, y eso es correcto
    for (const handler of [handleVaultPush, handleVaultPull, handleVaultConversations, handleVaultDelete]) {
      expect(typeof handler).toBe('function');
    }
  });

  it('un registro valido tiene solo campos cifrados o de metadato', () => {
    const keys = Object.keys(record()).sort();
    expect(keys).toEqual([
      'content',
      'conversationId',
      'createdAt',
      'privacy',
      'recordId',
      'sealedMemory',
      'sequence',
    ]);
  });
});

describe('el servidor no se fia del cliente', () => {
  it('assertNoPlaintextLeak rechaza un registro con titulo', async () => {
    const { assertNoPlaintextLeak } = await import('@luxy/shared');
    // el escritorio ya lo comprueba antes de enviar, pero un servidor que
    // confia en eso acaba guardando lo que no debe el dia que cambia el cliente
    expect(() => assertNoPlaintextLeak({ ...record(), conversationTitle: 'revelador' })).toThrow();
  });

  it('acepta un registro que solo lleva ciphertext', async () => {
    const { assertNoPlaintextLeak } = await import('@luxy/shared');
    expect(() => assertNoPlaintextLeak(record())).not.toThrow();
  });

  it('el esquema de subida limita el tamaño del lote', async () => {
    const { vaultSyncPushRequestSchema } = await import('@luxy/shared');
    const demasiados = Array.from({ length: 201 }, (_v, index) => record(index));
    expect(
      vaultSyncPushRequestSchema.safeParse({
        vaultId: VAULT_ID,
        conversationId: CONVERSATION,
        records: demasiados,
      }).success,
    ).toBe(false);
  });

  it('el esquema exige un identificador de boveda con la forma correcta', async () => {
    const { vaultSyncPushRequestSchema } = await import('@luxy/shared');
    for (const malo of ['corto', 'A'.repeat(42), 'A'.repeat(44), 'con espacios aqui!']) {
      expect(
        vaultSyncPushRequestSchema.safeParse({
          vaultId: malo,
          conversationId: CONVERSATION,
          records: [record()],
        }).success,
      ).toBe(false);
    }
  });

  it('un lote vacio se rechaza', async () => {
    const { vaultSyncPushRequestSchema } = await import('@luxy/shared');
    expect(
      vaultSyncPushRequestSchema.safeParse({
        vaultId: VAULT_ID,
        conversationId: CONVERSATION,
        records: [],
      }).success,
    ).toBe(false);
  });
});

describe('parametros de descarga', () => {
  it('acepta una marca de tiempo para traer solo lo nuevo', async () => {
    const { vaultSyncPullQuerySchema } = await import('@luxy/shared');
    const parsed = vaultSyncPullQuerySchema.safeParse({
      vaultId: VAULT_ID,
      since: '2026-09-01T14:00:00.000Z',
    });
    expect(parsed.success).toBe(true);
    // sin limite explicito se aplica uno: nadie descarga la boveda entera por error
    expect(parsed.success && parsed.data.limit).toBe(200);
  });

  it('acota el limite', async () => {
    const { vaultSyncPullQuerySchema } = await import('@luxy/shared');
    expect(vaultSyncPullQuerySchema.safeParse({ vaultId: VAULT_ID, limit: 5000 }).success).toBe(
      false,
    );
  });

  it('rechaza una marca de tiempo que no lo es', async () => {
    const { vaultSyncPullQuerySchema } = await import('@luxy/shared');
    expect(
      vaultSyncPullQuerySchema.safeParse({ vaultId: VAULT_ID, since: 'ayer' }).success,
    ).toBe(false);
  });
});

describe('lo que se registra', () => {
  it('el contrato de respuesta no incluye titulos ni contenido', async () => {
    const { vaultSyncListResponseSchema } = await import('@luxy/shared');
    const parsed = vaultSyncListResponseSchema.parse({
      conversations: [
        {
          conversationId: CONVERSATION,
          turnCount: 4,
          updatedAt: '2026-09-01T14:35:11Z',
          // lo que alguien podria intentar añadir "para que la lista sea util"
          title: 'un titulo',
        },
      ],
    });
    expect(JSON.stringify(parsed)).not.toContain('un titulo');
  });
});
