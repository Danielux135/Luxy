// sincronizacion de la boveda privada.
//
// El gateway transporta y almacena; NO lee. No tiene la llave y no hay ninguna
// ruta por la que pudiera pedirla. Su unico trabajo aqui es comprobar que lo
// que llega tiene la FORMA de contenido sellado, guardarlo y devolverlo.
//
// Por eso este archivo hace algo que puede parecer paranoico: ademas de validar
// con Zod, ejecuta `assertNoPlaintextLeak` sobre cada registro. El escritorio ya
// lo comprueba antes de enviar, pero un servidor que confia en que el cliente
// hizo los deberes acaba guardando lo que no debe el dia que alguien cambia el
// cliente. Es la misma razon por la que el agente revalida las aprobaciones.
import {
  assertNoPlaintextLeak,
  vaultSyncPullQuerySchema,
  vaultSyncPushRequestSchema,
} from '@luxy/shared';
import type { PrivateRecord } from '@luxy/shared';
import { errorResponse, json, readBody, withMachineAuth } from './api.js';

interface VaultRecordRow {
  record_id: string;
  vault_id: string;
  conversation_id: string;
  sequence: number;
  content: unknown;
  sealed_memory: unknown;
  created_at: string;
}

interface VaultConversationRow {
  conversation_id: string;
  turn_count: number;
  updated_at: string;
}

function toPrivateRecord(row: VaultRecordRow): PrivateRecord {
  return {
    recordId: row.record_id,
    conversationId: row.conversation_id,
    privacy: 'private',
    sequence: row.sequence,
    content: row.content as PrivateRecord['content'],
    sealedMemory: (row.sealed_memory ?? null) as PrivateRecord['sealedMemory'],
    createdAt: row.created_at,
  };
}

/**
 * sube un lote de turnos sellados.
 *
 * Es idempotente por `(vault_id, conversation_id, sequence)`, igual que los
 * eventos de trabajo lo son por `(job_id, sequence)`. Reenviar un lote tras un
 * corte de red no duplica nada, y eso importa mas de lo que parece: sin esa
 * garantia, la unica opcion segura seria no reintentar.
 */
export const handleVaultPush = withMachineAuth(async (request, deps) => {
  const body = await readBody(request, vaultSyncPushRequestSchema);
  if (!body.ok) return body.response;

  // el cliente ya lo comprueba; el servidor no se fia
  for (const record of body.data.records) {
    try {
      assertNoPlaintextLeak(record);
    } catch (error) {
      return errorResponse(
        error instanceof Error ? error.message : 'el registro lleva contenido en claro',
        422,
      );
    }
    if (record.conversationId !== body.data.conversationId) {
      return errorResponse('un registro no pertenece a la conversacion indicada', 422);
    }
  }

  // la conversacion debe existir antes que sus turnos: la clave ajena lo exige,
  // y ademas es lo que permite que borrarla se lleve todo por delante
  await deps.repo.ensureVaultConversation(body.data.vaultId, body.data.conversationId);

  const stored = await deps.repo.insertVaultRecords(body.data.vaultId, body.data.records);

  deps.logger.info('registros de boveda almacenados', {
    // NUNCA el identificador de conversacion ni nada del contenido: lo unico
    // que se registra es cuantos y de que boveda, y el vault_id ya es publico
    vaultId: body.data.vaultId,
    stored,
    received: body.data.records.length,
  });

  return json({ stored, skipped: body.data.records.length - stored });
});

/** lista que conversaciones hay y cuando cambiaron. sin titulos: van cifrados */
export const handleVaultConversations = withMachineAuth(async (request, deps) => {
  const url = new URL(request.url);
  const query = vaultSyncPullQuerySchema.safeParse({
    vaultId: url.searchParams.get('vaultId') ?? undefined,
    since: url.searchParams.get('since') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
  });
  if (!query.success) return errorResponse('los parametros de sincronizacion no son validos', 422);

  const rows = await deps.repo.listVaultConversations(query.data);
  return json({
    conversations: rows.map((row: VaultConversationRow) => ({
      conversationId: row.conversation_id,
      turnCount: row.turn_count,
      updatedAt: row.updated_at,
    })),
  });
});

/** descarga los turnos sellados de una boveda */
export const handleVaultPull = withMachineAuth(async (request, deps, _machine, params) => {
  const conversationId = params.conversationId;
  if (conversationId === undefined) return errorResponse('falta la conversacion', 400);

  const url = new URL(request.url);
  const query = vaultSyncPullQuerySchema.safeParse({
    vaultId: url.searchParams.get('vaultId') ?? undefined,
    since: url.searchParams.get('since') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
  });
  if (!query.success) return errorResponse('los parametros de sincronizacion no son validos', 422);

  const rows = await deps.repo.listVaultRecords(query.data.vaultId, conversationId, query.data.limit);
  return json({ records: rows.map(toPrivateRecord) });
});

/**
 * borra una conversacion entera.
 *
 * la clave ajena en cascada se lleva turnos y medios. No hay papelera: quien
 * borra algo de la boveda espera que desaparezca, no que quede recuperable.
 */
export const handleVaultDelete = withMachineAuth(async (request, deps, _machine, params) => {
  const conversationId = params.conversationId;
  if (conversationId === undefined) return errorResponse('falta la conversacion', 400);

  const url = new URL(request.url);
  const vaultId = url.searchParams.get('vaultId');
  if (vaultId === null || !/^[A-Za-z0-9_-]{43}$/.test(vaultId)) {
    return errorResponse('falta el identificador de boveda', 422);
  }

  const deleted = await deps.repo.deleteVaultConversation(vaultId, conversationId);
  return json({ deleted });
});
