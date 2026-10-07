import { describe, expect, it } from 'vitest';
import {
  VAULT_FACT_SEQUENCE_BASE,
  VAULT_POSTGREST_MAX_ROWS,
  VAULT_SYNC_PROTOCOL,
  VAULT_SYNC_V2_LIMITS,
  VAULT_SYNC_V2_PATHS,
  canonicalIsoSchema,
  serverIsoSchema,
  vaultSyncV2CapabilitiesSchema,
  vaultV2ConversationListRequestSchema,
  vaultV2ManifestRequestSchema,
  vaultV2MediaPushRequestSchema,
  vaultV2NextCursor,
  vaultV2PushBodyLimit,
  vaultV2PushRejectedResponseSchema,
  vaultV2PushRequestSchema,
  vaultV2RecordsFetchRequestSchema,
  vaultV2RecordsFetchResponseSchema,
  vaultV2RemoteMediaSchema,
} from './vault-sync-v2.js';
import { VAULT_MAX_OBJECT_BYTES, VAULT_PURPOSES, privateRecordSchema } from './vault.js';

const CONVERSATION = 'ad6a9bf6-c69f-4eab-9624-f405b78bdda5';
const OTHER = '6b1d3a52-2f0e-4c4b-9a39-1d7f0c3e5b11';

const envelope = (purpose: string, ciphertext = 'gKXo4HjmSky6cOWq') => ({
  version: 1,
  purpose,
  nonce: 'QLBVV_RjvTFFlpRx',
  ciphertext,
});

const recordId = (sequence: number): string =>
  `${String(sequence).padStart(8, '0')}-0000-4000-8000-000000000000`;

const record = (sequence: number, overrides: Record<string, unknown> = {}) => ({
  recordId: recordId(sequence),
  conversationId: CONVERSATION,
  privacy: 'private',
  sequence,
  content: envelope('vault.conversation'),
  sealedMemory: null,
  createdAt: '2026-09-01T14:33:21.073Z',
  ...overrides,
});

const push = (records: unknown[], base: unknown = null) =>
  vaultV2PushRequestSchema.safeParse({ conversationId: CONVERSATION, base, records });

describe('fechas', () => {
  // lo que Postgres devuelve de una fecha que subio un cliente con toISOString
  const casos: Array<[string, string]> = [
    ['2026-09-01T14:33:21.123+00:00', '2026-09-01T14:33:21.123Z'],
    // la fraccion sale recortada: .120 viaja como .12
    ['2026-09-01T14:33:21.12+00:00', '2026-09-01T14:33:21.120Z'],
    // y sin fraccion si era .000
    ['2026-09-01T14:33:21+00:00', '2026-09-01T14:33:21.000Z'],
    // timestamptz guarda microsegundos; lo subido en milisegundos vuelve igual
    ['2026-09-01T14:33:21.123000+00:00', '2026-09-01T14:33:21.123Z'],
    // otro desfase cualquiera es el mismo instante
    ['2026-09-01T16:33:21.123+02:00', '2026-09-01T14:33:21.123Z'],
  ];

  it.each(casos)('%s baja como la cadena original %s', (servidor, original) => {
    expect(serverIsoSchema.parse(servidor)).toBe(original);
    // y esa cadena es exactamente la que se puede volver a subir
    expect(canonicalIsoSchema.safeParse(original).success).toBe(true);
  });

  it('el contrato v1 rechazaba lo que devuelve Postgres (SEG-SYNC-001, fallo 1)', () => {
    // documenta el fallo: con el esquema viejo, la primera bajada se cortaba
    expect(
      privateRecordSchema.safeParse({ ...record(0), createdAt: '2026-09-01T14:33:21.12+00:00' })
        .success,
    ).toBe(false);
  });

  it('para subir solo vale la forma canonica', () => {
    for (const mala of [
      '2026-09-01T14:33:21.12Z',
      '2026-09-01T14:33:21Z',
      '2026-09-01T14:33:21.1234Z',
      '2026-09-01T14:33:21.123+00:00',
      'ayer',
    ]) {
      expect(canonicalIsoSchema.safeParse(mala).success, mala).toBe(false);
    }
  });

  it('una fecha que no lo es no baja', () => {
    expect(serverIsoSchema.safeParse('2026-13-45T99:00:00+00:00').success).toBe(false);
    expect(serverIsoSchema.safeParse('2026-09-01T14:33:21.123+00').success).toBe(false);
  });
});

describe('subida de turnos', () => {
  it('acepta un lote ordenado con base', () => {
    const parsed = push([record(3), record(4), record(7)], { sequence: 2, recordId: recordId(2) });
    expect(parsed.success).toBe(true);
  });

  it('acepta un lote sin base y rellena la memoria nula', () => {
    const { sealedMemory: _omitida, ...sinMemoria } = record(0);
    const parsed = push([sinMemoria]);
    expect(parsed.success && parsed.data.records[0]?.sealedMemory).toBeNull();
  });

  it('rechaza una secuencia del rango reservado a los hechos', () => {
    expect(push([record(VAULT_FACT_SEQUENCE_BASE, { recordId: recordId(1) })]).success).toBe(false);
    expect(push([record(VAULT_FACT_SEQUENCE_BASE - 1, { recordId: recordId(1) })]).success).toBe(true);
  });

  it('rechaza una fecha que no es canonica', () => {
    expect(push([record(0, { createdAt: '2026-09-01T14:33:21.07Z' })]).success).toBe(false);
    expect(push([record(0, { createdAt: '2026-09-01T14:33:21.073+00:00' })]).success).toBe(false);
  });

  it('rechaza registros de otra conversacion', () => {
    expect(push([record(0), record(1, { conversationId: OTHER })]).success).toBe(false);
  });

  it('rechaza secuencias repetidas o desordenadas', () => {
    expect(push([record(1), record(1, { recordId: recordId(9) })]).success).toBe(false);
    expect(push([record(2), record(1)]).success).toBe(false);
  });

  it('rechaza un recordId repetido, tambien el de la base', () => {
    expect(push([record(1), record(2, { recordId: recordId(1) })]).success).toBe(false);
    expect(push([record(3, { recordId: recordId(2) })], { sequence: 2, recordId: recordId(2) }).success).toBe(false);
  });

  it('la base tiene que ir delante del lote', () => {
    expect(push([record(3)], { sequence: 3, recordId: recordId(9) }).success).toBe(false);
    expect(push([record(3)], { sequence: 5, recordId: recordId(9) }).success).toBe(false);
  });

  it('rechaza 41 registros', () => {
    const cuarenta = Array.from({ length: VAULT_SYNC_V2_LIMITS.pushMaxRecords }, (_v, i) => record(i));
    expect(push(cuarenta).success).toBe(true);
    expect(push([...cuarenta, record(40)]).success).toBe(false);
  });

  it('rechaza un proposito que no es de turno', () => {
    expect(push([record(0, { content: envelope('vault.media') })]).success).toBe(false);
    expect(push([record(0, { content: envelope('vault.memory') })]).success).toBe(false);
    expect(push([record(0, { sealedMemory: envelope('vault.conversation') })]).success).toBe(false);
    expect(push([record(0, { sealedMemory: envelope('vault.memory') })]).success).toBe(true);
  });

  it('rechaza un campo de mas, aunque parezca inocente', () => {
    expect(push([record(0, { title: 'revelador' })]).success).toBe(false);
    expect(
      vaultV2PushRequestSchema.safeParse({
        conversationId: CONVERSATION,
        base: null,
        records: [record(0)],
        vaultId: 'A'.repeat(43),
      }).success,
    ).toBe(false);
  });

  it('rechaza un uuid en mayusculas: Postgres lo devolveria distinto', () => {
    const conLetras = 'abcdef12-0000-4000-8000-00000000abcd';
    expect(push([record(0, { recordId: conLetras })]).success).toBe(true);
    expect(push([record(0, { recordId: conLetras.toUpperCase() })]).success).toBe(false);
  });

  it('acepta un unico registro de 3 MiB', () => {
    const grande = record(0, { content: envelope('vault.conversation', 'A'.repeat(3 * 1024 * 1024)) });
    expect(push([grande]).success).toBe(true);
  });

  it('el tope por bytes depende de si el registro va solo', () => {
    expect(vaultV2PushBodyLimit(1)).toBe(4 * 1024 * 1024);
    expect(vaultV2PushBodyLimit(2)).toBe(512 * 1024);
  });

  it('el 409 dice por que y nunca trae un stored', () => {
    expect(
      vaultV2PushRejectedResponseSchema.safeParse({
        error: 'x',
        reason: 'records',
        results: [{ recordId: recordId(0), sequence: 0, outcome: 'stored' }],
      }).success,
    ).toBe(false);
    expect(
      vaultV2PushRejectedResponseSchema.safeParse({
        error: 'x',
        reason: 'records',
        results: [
          { recordId: recordId(0), sequence: 0, outcome: 'duplicate' },
          { recordId: recordId(1), sequence: 1, outcome: 'conflict' },
          { recordId: recordId(2), sequence: 2, outcome: 'pending' },
        ],
      }).success,
    ).toBe(true);
  });
});

describe('lecturas', () => {
  it('un turno bajado sale como PrivateRecord, con la fecha normalizada', () => {
    const parsed = vaultV2RecordsFetchResponseSchema.parse([
      {
        recordId: recordId(5),
        conversationId: CONVERSATION,
        sequence: 5,
        content: envelope('vault.conversation'),
        sealedMemory: null,
        createdAt: '2026-09-01T14:33:21.07+00:00',
      },
    ]);
    expect(parsed[0]?.privacy).toBe('private');
    expect(parsed[0]?.createdAt).toBe('2026-09-01T14:33:21.070Z');
    // y el resultado valida contra el contrato local de siempre
    expect(privateRecordSchema.safeParse(parsed[0]).success).toBe(true);
  });

  it('un registro del rango reservado no se acepta como turno', () => {
    expect(
      vaultV2RecordsFetchResponseSchema.safeParse([
        {
          recordId: recordId(5),
          conversationId: CONVERSATION,
          sequence: VAULT_FACT_SEQUENCE_BASE,
          content: envelope('vault.conversation'),
          sealedMemory: null,
          createdAt: '2026-09-01T14:33:21.07+00:00',
        },
      ]).success,
    ).toBe(false);
  });

  it('la descarga por secuencias se acota y no admite repetidas', () => {
    const cien = Array.from({ length: VAULT_SYNC_V2_LIMITS.fetchMaxSequences }, (_v, i) => i);
    expect(vaultV2RecordsFetchRequestSchema.safeParse({ conversationId: CONVERSATION, sequences: cien }).success).toBe(true);
    expect(
      vaultV2RecordsFetchRequestSchema.safeParse({ conversationId: CONVERSATION, sequences: [...cien, 100] }).success,
    ).toBe(false);
    expect(
      vaultV2RecordsFetchRequestSchema.safeParse({ conversationId: CONVERSATION, sequences: [1, 1] }).success,
    ).toBe(false);
    expect(
      vaultV2RecordsFetchRequestSchema.safeParse({
        conversationId: CONVERSATION,
        sequences: [VAULT_FACT_SEQUENCE_BASE],
      }).success,
    ).toBe(false);
  });

  it('el manifiesto empieza en -1 y no pasa de 1000 por pagina', () => {
    const parsed = vaultV2ManifestRequestSchema.parse({ conversationId: CONVERSATION });
    expect(parsed).toEqual({ conversationId: CONVERSATION, after: -1, limit: 1000 });
    expect(vaultV2ManifestRequestSchema.safeParse({ conversationId: CONVERSATION, limit: 1001 }).success).toBe(false);
  });

  it('ninguna pagina de lectura pasa del «Max rows» de PostgREST (F1-R1-02)', () => {
    // PostgREST recorta en silencio a su «Max rows» (1000 por defecto en
    // Supabase) y responde 200. Con 2000 por pagina, el manifiesto de una
    // conversacion de mas de 1000 turnos llegaba cortado y parecia entero
    expect(VAULT_POSTGREST_MAX_ROWS).toBe(1000);
    for (const page of [
      VAULT_SYNC_V2_LIMITS.manifestMaxPage,
      VAULT_SYNC_V2_LIMITS.conversationsMaxPage,
      VAULT_SYNC_V2_LIMITS.mediaMaxPage,
      VAULT_SYNC_V2_LIMITS.fetchMaxSequences,
      VAULT_SYNC_V2_LIMITS.purgeBatchMedia,
    ]) {
      expect(page).toBeLessThanOrEqual(VAULT_POSTGREST_MAX_ROWS);
    }
  });

  it('las listas paginan por id y rechazan un limite de mas en vez de recortarlo', () => {
    expect(vaultV2ConversationListRequestSchema.parse({})).toEqual({ after: null, limit: 500 });
    expect(vaultV2ConversationListRequestSchema.safeParse({ limit: 501 }).success).toBe(false);
  });

  it('el cursor solo se acaba con una pagina VACIA: una corta puede venir recortada', () => {
    const filas = [{ id: 'a' }, { id: 'b' }];
    expect(vaultV2NextCursor(filas, (fila) => fila.id)).toBe('b');
    // una sola fila, aunque se pidieran mil: puede ser el recorte de PostgREST
    expect(vaultV2NextCursor([{ id: 'c' }], (fila) => fila.id)).toBe('c');
    expect(vaultV2NextCursor([], (fila: { id: string }) => fila.id)).toBeNull();
  });

  it('un medio bajado normaliza la fecha y exige proposito de medio', () => {
    const media = {
      mediaId: recordId(1),
      conversationId: CONVERSATION,
      objectKey: 'a'.repeat(32),
      byteSize: 10,
      content: envelope('vault.media'),
      thumbnailObjectKey: null,
      createdAt: '2026-09-01T14:33:21+00:00',
    };
    expect(vaultV2RemoteMediaSchema.parse(media).createdAt).toBe('2026-09-01T14:33:21.000Z');
    expect(vaultV2RemoteMediaSchema.safeParse({ ...media, content: envelope('vault.conversation') }).success).toBe(false);
  });
});

describe('alta de medios', () => {
  const media = (overrides: Record<string, unknown> = {}) => ({
    media: {
      mediaId: recordId(1),
      conversationId: CONVERSATION,
      objectKey: 'a'.repeat(32),
      byteSize: 10,
      content: envelope('vault.media'),
      thumbnailObjectKey: 'b'.repeat(32),
      createdAt: '2026-09-01T14:33:21.073Z',
      ...overrides,
    },
  });

  it('acepta un medio con su miniatura', () => {
    expect(vaultV2MediaPushRequestSchema.safeParse(media()).success).toBe(true);
  });

  it('solo admite el proposito de medio: un hecho no va por aqui en F1', () => {
    expect(vaultV2MediaPushRequestSchema.safeParse(media({ content: envelope('vault.conversation') })).success).toBe(false);
  });

  it('respeta el tope de 90 MiB, que no cambia', () => {
    expect(VAULT_MAX_OBJECT_BYTES).toBe(90 * 1024 * 1024);
    expect(vaultV2MediaPushRequestSchema.safeParse(media({ byteSize: VAULT_MAX_OBJECT_BYTES + 1 })).success).toBe(false);
  });

  it('una miniatura que es el mismo objeto se rechaza', () => {
    expect(vaultV2MediaPushRequestSchema.safeParse(media({ thumbnailObjectKey: 'a'.repeat(32) })).success).toBe(false);
  });

  it('una fecha no canonica se rechaza', () => {
    expect(vaultV2MediaPushRequestSchema.safeParse(media({ createdAt: '2026-09-01T14:33:21Z' })).success).toBe(false);
  });
});

describe('capacidades', () => {
  it('el protocolo es un literal y la caducidad baja normalizada', () => {
    const parsed = vaultSyncV2CapabilitiesSchema.parse({
      protocol: VAULT_SYNC_PROTOCOL,
      facts: false,
      limits: VAULT_SYNC_V2_LIMITS,
      sessionExpiresAt: '2026-11-06T08:00:00.5+00:00',
    });
    expect(parsed.sessionExpiresAt).toBe('2026-11-06T08:00:00.500Z');
    expect(
      vaultSyncV2CapabilitiesSchema.safeParse({ ...parsed, protocol: 3 }).success,
    ).toBe(false);
  });

  it('las rutas no llevan ningun parametro en la URL', () => {
    for (const ruta of Object.values(VAULT_SYNC_V2_PATHS)) {
      expect(ruta).toMatch(/^\/api\/vault\/v2\/[a-z/]+$/);
    }
  });

  it('F1 no añade todavia el proposito de los hechos', () => {
    expect((VAULT_PURPOSES as readonly string[]).includes('vault.fact')).toBe(false);
  });
});
