// sincronizacion v2 de la boveda (SYNC-F1-03, D-110).
//
// El contrato exacto esta en packages/shared/src/vault-sync-v2.ts; aqui solo lo
// que hace cumplir el servidor. Las reglas que ordenan este archivo:
//
//  1. **Los topes se miran antes de leer.** Content-Length primero y, si miente
//     o falta, el cuerpo se lee contando bytes y se corta al pasarse. Lo caro
//     en el Worker es analizar el JSON, asi que un cuerpo demasiado grande no
//     llega a analizarse.
//  2. **Las lecturas no se analizan.** PostgREST ya da la forma del contrato
//     con alias, y el cuerpo se reenvia tal cual, en flujo: el gateway no tiene
//     nada que mirar dentro de unos sobres cifrados.
//  3. **Un lote de turnos entra entero o no entra.** INSERT plano; si choca, se
//     explica registro a registro y no se guarda nada. Una conversacion solo se
//     crea con base null, y la de otro usuario es un 404.
//  4. **El rango reservado a los hechos no se toca.** Los turnos van por debajo
//     de VAULT_FACT_SEQUENCE_BASE y no entran en un espacio de F2.
//  5. **Ningun fallo se traga ni se cuenta.** Un error de Supabase o del almacen
//     es un 502 redactado; su cuerpo no sale nunca.
//  6. **En los registros, solo el usuario y recuentos.** Nunca un id de
//     conversacion, de turno ni de medio, ni nada del contenido.
import {
  VAULT_SYNC_PROTOCOL,
  VAULT_SYNC_V2_LIMITS,
  assertNoPlaintextLeak,
  vaultV2ConversationListRequestSchema,
  vaultV2ManifestRequestSchema,
  vaultV2MediaListRequestSchema,
  vaultV2MediaPushRequestSchema,
  vaultV2PurgeRequestSchema,
  vaultV2PushBodyLimit,
  vaultV2PushRequestSchema,
  vaultV2RecordsFetchRequestSchema,
} from '@luxy/shared';
import type { ApiDeps } from './api.js';
import { errorResponse, json } from './api.js';
import { withVaultAuth } from './vault.js';
import type { AuthenticatedVaultUser } from '../vault-auth.js';
import { SupabaseError } from '../supabase.js';
import { ObjectStoreError } from '../object-store.js';

const LIMITS = VAULT_SYNC_V2_LIMITS;

// -----------------------------------------------------------------------------
// utilidades
// -----------------------------------------------------------------------------

type CappedBody = { ok: true; value: unknown; bytes: number } | { ok: false; response: Response };

function tooLarge(): Response {
  return errorResponse('el envio pesa demasiado; partelo en lotes mas pequeños', 413);
}

function invalid(): Response {
  return errorResponse('el cuerpo no cumple el contrato esperado', 422);
}

function notFound(): Response {
  // el mismo 404 para «no existe» y «es de otro»: distinguirlos diria que
  // existe una conversacion ajena con ese identificador
  return errorResponse('esa conversacion no existe', 404);
}

/**
 * lee el cuerpo JSON sin pasar de `maxBytes`.
 *
 * Content-Length se mira primero: si declara de mas, se rechaza sin leer nada.
 * Como puede faltar o mentir, el cuerpo se lee ademas contando bytes y se corta
 * en cuanto se pasa.
 */
async function readCappedJson(request: Request, maxBytes: number): Promise<CappedBody> {
  const declared = request.headers.get('Content-Length');
  if (declared !== null) {
    const size = Number(declared);
    if (!Number.isInteger(size) || size < 0) {
      return { ok: false, response: errorResponse('la cabecera Content-Length no es valida', 400) };
    }
    if (size > maxBytes) return { ok: false, response: tooLarge() };
  }
  if (request.body === null) {
    return { ok: false, response: errorResponse('el cuerpo debe ser json valido', 400) };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return { ok: false, response: tooLarge() };
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    // fatal: un UTF-8 roto es un cuerpo invalido, no algo que remendar
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
    return { ok: true, value: JSON.parse(text) as unknown, bytes: total };
  } catch {
    return { ok: false, response: errorResponse('el cuerpo debe ser json valido', 400) };
  }
}

/** rechaza lo que lleve un campo de contenido en claro, este donde este */
function plaintextLeak(value: unknown): Response | null {
  try {
    assertNoPlaintextLeak(value);
    return null;
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : 'el envio lleva contenido en claro',
      422,
    );
  }
}

/**
 * reenvia el cuerpo de PostgREST tal cual, en flujo.
 *
 * Ni se lee ni se analiza: con los alias ya tiene la forma del contrato, y
 * guardarlo entero en memoria para devolverlo igual no aporta nada.
 */
function passThrough(upstream: Response): Response {
  return new Response(upstream.body, {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

/**
 * un fallo de Supabase o del almacen: 502 redactado.
 *
 * El registro lleva el estado y el codigo, nunca el cuerpo: el detalle de un
 * 23503 o un 23505 incluye la clave que choco, y esa clave es un id de
 * conversacion o de turno.
 */
function upstreamFailure(
  deps: ApiDeps,
  user: AuthenticatedVaultUser,
  route: string,
  error: unknown,
): Response {
  deps.logger.error('fallo en la sincronizacion v2 de la boveda', {
    userId: user.id,
    route,
    errorName: error instanceof Error ? error.name : 'desconocido',
    ...(error instanceof SupabaseError
      ? { supabaseStatus: error.status, supabaseCode: error.code }
      : {}),
    ...(error instanceof ObjectStoreError ? { storageStatus: error.status } : {}),
  });
  return errorResponse(
    'el almacen de la boveda no respondio bien; reintentalo mas tarde. Lo de este equipo sigue a salvo',
    502,
  );
}

// -----------------------------------------------------------------------------
// capacidades
// -----------------------------------------------------------------------------

/**
 * GET capabilities.
 *
 * Es la puerta de la sincronizacion: un gateway viejo responde 404 a esta ruta
 * y el Studio nuevo no sincroniza. `facts` es false hasta F2. La caducidad que
 * devuelve es la de despues de renovar, para que Studio la guarde.
 *
 * El tope de un archivo es el del almacen de este despliegue, no el del
 * protocolo: Studio salta sin subirlo lo que no cabe, en vez de mandarlo
 * entero para que Storage lo rechace en cada pasada (GW-R2-01).
 */
export const handleVaultV2Capabilities = withVaultAuth(async (_request, deps, user) =>
  json({
    protocol: VAULT_SYNC_PROTOCOL,
    facts: false,
    limits: { ...LIMITS, objectMaxBytes: deps.config.VAULT_OBJECT_MAX_BYTES },
    sessionExpiresAt: user.sessionExpiresAt,
  }),
);

// -----------------------------------------------------------------------------
// lecturas
// -----------------------------------------------------------------------------

export const handleVaultV2ConversationList = withVaultAuth(async (request, deps, user) => {
  const body = await readCappedJson(request, LIMITS.smallRequestMaxBytes);
  if (!body.ok) return body.response;
  const parsed = vaultV2ConversationListRequestSchema.safeParse(body.value);
  if (!parsed.success) return invalid();

  try {
    return passThrough(
      await deps.repo.listVaultConversationsRaw(user.id, parsed.data.after, parsed.data.limit),
    );
  } catch (error) {
    return upstreamFailure(deps, user, 'conversations/list', error);
  }
});

export const handleVaultV2Manifest = withVaultAuth(async (request, deps, user) => {
  const body = await readCappedJson(request, LIMITS.smallRequestMaxBytes);
  if (!body.ok) return body.response;
  const parsed = vaultV2ManifestRequestSchema.safeParse(body.value);
  if (!parsed.success) return invalid();

  try {
    // una conversacion ajena o inexistente da una lista vacia: el filtro por
    // usuario es la autorizacion, y no dice si existe
    return passThrough(
      await deps.repo.listVaultManifestRaw(
        user.id,
        parsed.data.conversationId,
        parsed.data.after,
        parsed.data.limit,
      ),
    );
  } catch (error) {
    return upstreamFailure(deps, user, 'conversations/manifest', error);
  }
});

export const handleVaultV2RecordsFetch = withVaultAuth(async (request, deps, user) => {
  const body = await readCappedJson(request, LIMITS.smallRequestMaxBytes);
  if (!body.ok) return body.response;
  const parsed = vaultV2RecordsFetchRequestSchema.safeParse(body.value);
  if (!parsed.success) return invalid();

  try {
    return passThrough(
      await deps.repo.fetchVaultRecordsRaw(user.id, parsed.data.conversationId, parsed.data.sequences),
    );
  } catch (error) {
    return upstreamFailure(deps, user, 'records/fetch', error);
  }
});

export const handleVaultV2MediaList = withVaultAuth(async (request, deps, user) => {
  const body = await readCappedJson(request, LIMITS.smallRequestMaxBytes);
  if (!body.ok) return body.response;
  const parsed = vaultV2MediaListRequestSchema.safeParse(body.value);
  if (!parsed.success) return invalid();

  try {
    return passThrough(await deps.repo.listVaultMediaRaw(user.id, parsed.data.after, parsed.data.limit));
  } catch (error) {
    return upstreamFailure(deps, user, 'media/list', error);
  }
});

// -----------------------------------------------------------------------------
// subir turnos
// -----------------------------------------------------------------------------

function pushRejected(
  reason: 'base-mismatch' | 'conversation-missing' | 'space',
): Response {
  const error = {
    'base-mismatch': 'el servidor cambio desde la ultima lectura; vuelve a pedir el manifiesto',
    'conversation-missing': 'esa conversacion no esta en el servidor; no se crea con una base',
    space: 'esa conversacion guarda hechos de la boveda; los turnos no van ahi',
  }[reason];
  return json({ error, reason }, 409);
}

function sameBase(
  server: { sequence: number; record_id: string } | null,
  base: { sequence: number; recordId: string } | null,
): boolean {
  if (server === null || base === null) return server === base;
  return server.sequence === base.sequence && server.record_id === base.recordId;
}

/**
 * POST records/push: un lote de turnos, entero o nada.
 *
 * Orden de las comprobaciones, de la mas barata a la que escribe: tope de
 * bytes, contenido en claro, contrato, dueño, espacio, base e INSERT. Si el
 * INSERT choca no se reintenta nada: se explica cada registro y el cliente
 * decide (un duplicate es que ya estaba; un conflict, dos versiones).
 */
export const handleVaultV2RecordsPush = withVaultAuth(async (request, deps, user) => {
  const body = await readCappedJson(request, LIMITS.pushSingleRecordMaxBytes);
  if (!body.ok) return body.response;
  const leak = plaintextLeak(body.value);
  if (leak !== null) return leak;
  const parsed = vaultV2PushRequestSchema.safeParse(body.value);
  if (!parsed.success) return invalid();
  const { conversationId, base, records } = parsed.data;
  // un registro suelto puede pesar hasta 4 MiB; un lote, no
  if (body.bytes > vaultV2PushBodyLimit(records.length)) return tooLarge();
  const first = records[0]!;

  try {
    const owner = await deps.repo.getVaultConversationOwner(conversationId);
    if (owner !== null && owner !== user.id) return notFound();

    let created = false;
    if (owner === null) {
      // sin base, el cliente dice «el servidor no tiene nada»: solo entonces
      // se crea. Con base, la conversacion existia y ya no: se purgo, y un
      // equipo desfasado no la resucita
      if (base !== null) {
        deps.logger.info('turnos de boveda rechazados', { userId: user.id, rejected: 'conversation-missing' });
        return pushRejected('conversation-missing');
      }
      const ensured = await deps.repo.ensureVaultConversation(user.id, conversationId);
      if (ensured === 'foreign') return notFound();
      created = ensured === 'created';
    }

    // recien creada no puede tener nada: ni hechos ni base que comprobar
    if (!created) {
      if (await deps.repo.vaultConversationHoldsFacts(conversationId)) {
        deps.logger.info('turnos de boveda rechazados', { userId: user.id, rejected: 'space' });
        return pushRejected('space');
      }
      const predecessor = await deps.repo.lastVaultRecordBefore(conversationId, first.sequence);
      if (!sameBase(predecessor, base)) {
        deps.logger.info('turnos de boveda rechazados', { userId: user.id, rejected: 'base-mismatch' });
        return pushRejected('base-mismatch');
      }
    }

    try {
      await deps.repo.insertVaultRecords(user.id, records);
    } catch (error) {
      // la conversacion desaparecio entre la comprobacion y el INSERT
      if (error instanceof SupabaseError && error.isForeignKeyViolation) {
        return pushRejected('conversation-missing');
      }
      if (!(error instanceof SupabaseError && error.isUniqueViolation)) throw error;

      const results = await deps.repo.classifyVaultRecords(user.id, conversationId, records);
      deps.logger.info('turnos de boveda rechazados', {
        userId: user.id,
        rejected: 'records',
        received: records.length,
        duplicates: results.filter((result) => result.outcome === 'duplicate').length,
        conflicts: results.filter((result) => result.outcome === 'conflict').length,
        pending: results.filter((result) => result.outcome === 'pending').length,
      });
      return json(
        {
          error: 'el lote choca con lo que ya hay en el servidor; no se ha guardado nada',
          reason: 'records',
          results,
        },
        409,
      );
    }

    deps.logger.info('turnos de boveda almacenados', { userId: user.id, stored: records.length });
    return json({
      results: records.map((record) => ({
        recordId: record.recordId,
        sequence: record.sequence,
        outcome: 'stored',
      })),
    });
  } catch (error) {
    return upstreamFailure(deps, user, 'records/push', error);
  }
});

// -----------------------------------------------------------------------------
// alta de medios
// -----------------------------------------------------------------------------

function mediaRejected(reason: 'object-missing' | 'conversation-missing' | 'space' | 'conflict'): Response {
  const error = {
    'object-missing': 'sube el archivo y su miniatura antes de registrarlo',
    'conversation-missing': 'la conversacion de ese archivo aun no esta en el servidor; sube antes sus turnos',
    space: 'ese archivo no puede ir en un espacio de hechos',
    conflict: 'ese archivo choca con otro que ya esta en el servidor',
  }[reason];
  return json({ error, reason }, 409);
}

/**
 * POST media/push: el registro de un medio cuyos bytes ya estan subidos.
 *
 * Los bytes van antes (D-050) y aqui se comprueba que estan, original y
 * miniatura, sin descargarlos. La conversacion tiene que existir y ser suya:
 * un medio no crea conversaciones, para que uno rezagado no resucite una
 * purgada.
 */
export const handleVaultV2MediaPush = withVaultAuth(async (request, deps, user) => {
  const body = await readCappedJson(request, LIMITS.mediaPushMaxBytes);
  if (!body.ok) return body.response;
  const leak = plaintextLeak(body.value);
  if (leak !== null) return leak;
  const parsed = vaultV2MediaPushRequestSchema.safeParse(body.value);
  if (!parsed.success) return invalid();
  const media = parsed.data.media;

  try {
    const owner = await deps.repo.getVaultConversationOwner(media.conversationId);
    if (owner === null) return mediaRejected('conversation-missing');
    if (owner !== user.id) return notFound();
    // 'vault.media' solo fuera de un espacio; los avatares de F2 iran con su
    // propio proposito y solo dentro
    if (await deps.repo.vaultConversationHoldsFacts(media.conversationId)) {
      return mediaRejected('space');
    }

    const keys =
      media.thumbnailObjectKey === null ? [media.objectKey] : [media.objectKey, media.thumbnailObjectKey];
    for (const key of keys) {
      if (!(await deps.objects.exists(user.id, key))) return mediaRejected('object-missing');
    }

    let outcome: 'stored' | 'duplicate' | 'conflict';
    try {
      outcome = await deps.repo.insertVaultMedia(user.id, media);
    } catch (error) {
      if (error instanceof SupabaseError && error.isForeignKeyViolation) {
        return mediaRejected('conversation-missing');
      }
      throw error;
    }
    if (outcome === 'conflict') {
      deps.logger.info('medio de boveda rechazado', { userId: user.id, rejected: 'conflict' });
      return mediaRejected('conflict');
    }
    deps.logger.info('medio de boveda registrado', { userId: user.id, outcome });
    return json({ outcome });
  } catch (error) {
    return upstreamFailure(deps, user, 'media/push', error);
  }
});

// -----------------------------------------------------------------------------
// purga
// -----------------------------------------------------------------------------

/**
 * POST conversations/purge: borra una conversacion del servidor, por tandas.
 *
 * Cada llamada borra los objetos de como mucho purgeBatchMedia medios (40
 * objetos, con su miniatura) y devuelve el cursor. Con la autenticacion y las
 * consultas son 48 subpeticiones como mucho: por debajo de cualquier limite de
 * un Worker, sin depender de un borrado multiple de Storage que no se ha
 * verificado. La ultima llamada borra la fila de la conversacion, y la cascada
 * se lleva turnos y medios. Purgar lo que ya no existe responde done.
 */
export const handleVaultV2Purge = withVaultAuth(async (request, deps, user) => {
  const body = await readCappedJson(request, LIMITS.smallRequestMaxBytes);
  if (!body.ok) return body.response;
  const parsed = vaultV2PurgeRequestSchema.safeParse(body.value);
  if (!parsed.success) return invalid();
  const { conversationId, after } = parsed.data;

  try {
    const owner = await deps.repo.getVaultConversationOwner(conversationId);
    if (owner === null) return json({ done: true, after: null, deletedObjects: 0 });
    if (owner !== user.id) return notFound();
    if (await deps.repo.vaultConversationHoldsFacts(conversationId)) {
      return json({ error: 'un espacio de hechos no se purga como una conversacion', reason: 'space' }, 409);
    }

    const batch = await deps.repo.listVaultMediaForPurge(user.id, conversationId, after, LIMITS.purgeBatchMedia);
    let deletedObjects = 0;
    for (const media of batch) {
      for (const key of [media.object_key, media.thumbnail_object_key]) {
        if (key === null) continue;
        if (await deps.objects.delete(user.id, key)) deletedObjects += 1;
      }
    }

    if (batch.length === LIMITS.purgeBatchMedia) {
      deps.logger.info('purga de boveda en curso', { userId: user.id, deletedObjects });
      return json({ done: false, after: batch[batch.length - 1]!.media_id, deletedObjects });
    }

    await deps.repo.deleteVaultConversation(user.id, conversationId);
    deps.logger.info('purga de boveda terminada', { userId: user.id, deletedObjects });
    return json({ done: true, after: null, deletedObjects });
  } catch (error) {
    return upstreamFailure(deps, user, 'conversations/purge', error);
  }
});
