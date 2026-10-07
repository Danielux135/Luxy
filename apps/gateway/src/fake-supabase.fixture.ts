// doble de Supabase para las pruebas del gateway: PostgREST y Storage en memoria.
//
// Por que tan fiel: las pruebas de la sincronizacion v1 pasaban con los tres
// fallos de SEG-SYNC-001 dentro, porque sus dobles devolvian lo que el codigo
// esperaba y no lo que devuelve Supabase. Este imita justo lo que importa:
//  - las fechas salen como las escribe Postgres: «+00:00», con microsegundos y
//    la fraccion recortada («.07+00:00», o sin fraccion);
//  - un INSERT es atomico: si una fila choca (23505) o le falta el padre
//    (23503), no entra ninguna y responde 409;
//  - `on_conflict` solo cuenta con `Prefer: resolution=...`; sin el es un
//    INSERT normal, que es lo que congelaba la v1;
//  - una columna desconocida da 400, al leer y al escribir;
//  - jsonb reordena las claves: nadie puede depender del orden;
//  - borrar arrastra en cascada, y un trigger recuenta turn_count;
//  - Storage responde 400 con statusCode "404" a un objeto que no existe, como
//    hacen versiones de Supabase que siguen en produccion;
//  - una lectura no devuelve mas de «Max rows» filas (1000 por defecto), pida
//    el limite que pida, y responde 200 sin avisar del recorte. Sin esto un
//    manifiesto de 2000 por pagina parecia completo con 1000 (F1-R1-02).
// No es Postgres: es lo que el gateway usa, y nada mas.
//
// Solo APIs web, porque se compila con el resto del Worker.
import { hashToken } from './auth.js';
import type { Env } from './env.js';

type Row = Record<string, unknown>;
type ColumnKind = 'uuid' | 'text' | 'int4' | 'int8' | 'bool' | 'timestamp' | 'json';

interface TableSpec {
  columns: Record<string, ColumnKind>;
  notNull: readonly string[];
  primaryKey: readonly string[];
  uniques: ReadonlyArray<{ name: string; columns: readonly string[] }>;
  foreignKeys: ReadonlyArray<{ name: string; column: string; table: string; refColumn: string }>;
  defaults: Record<string, () => unknown>;
  checks: ReadonlyArray<{ name: string; ok: (row: Row) => boolean }>;
}

const INT4_MAX = 2_147_483_647;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface FakeRequestInfo {
  method: string;
  kind: 'rest' | 'storage';
  /** tabla de PostgREST o ruta del objeto dentro del bucket */
  target: string;
  url: string;
  prefer: string | null;
}

interface Failure {
  match: (info: FakeRequestInfo) => boolean;
  status: number;
  body: string;
}

class PgError {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly message: string,
    readonly details: string | null = null,
  ) {}

  toResponse(): Response {
    return new Response(
      JSON.stringify({ code: this.code, details: this.details, hint: null, message: this.message }),
      { status: this.status, headers: { 'Content-Type': 'application/json; charset=utf-8' } },
    );
  }
}

export class FakeSupabase {
  readonly tables = new Map<string, Row[]>();
  readonly specs: Record<string, TableSpec>;
  /** objetos del bucket, por «usuario/clave» */
  readonly objects = new Map<string, Uint8Array>();
  readonly log: FakeRequestInfo[] = [];
  /** el texto exacto de cada respuesta de lectura, para compararlo byte a byte */
  readonly readBodies: string[] = [];
  /** veces que alguien leyo el cuerpo de un objeto, y veces que lo cancelo */
  objectBodyReads = 0;
  objectBodyCancels = 0;
  /** estado con el que Storage dice «no existe»: 400 en versiones viejas, 404 en nuevas */
  missingObjectStatus: 400 | 404 = 400;
  /**
   * tope de un archivo en Storage. 50 MiB es el del plan gratuito (y el que
   * trae un proyecto nuevo); por encima no guarda nada. Las pruebas lo bajan
   * para ver el rechazo sin mover megas (GW-R2-01)
   */
  objectSizeLimit = 50 * 1024 * 1024;
  /** estado con el que Storage dice «demasiado grande»: 400 en versiones viejas, 413 en nuevas */
  oversizeStatus: 400 | 413 = 400;
  /**
   * «Max rows» de PostgREST: ninguna lectura devuelve mas, y no avisa. 1000 es
   * el valor por defecto de Supabase; las pruebas lo bajan para ver el recorte
   * sin sembrar miles de filas
   */
  maxRows = 1000;
  private failures: Failure[] = [];
  private tick = 0;

  constructor(
    readonly baseUrl = 'https://fake-project.supabase.test',
    readonly serviceKey = 'service-role-de-prueba-0123456789',
    /** reloj en milisegundos; las pruebas lo fijan para que todo sea determinista */
    public clock: () => number = () => Date.now(),
  ) {
    this.specs = buildSpecs(() => this.nowMicros());
    for (const table of Object.keys(this.specs)) this.tables.set(table, []);
  }

  /** la siguiente peticion que cumpla `match` falla con ese estado y cuerpo */
  failNext(match: (info: FakeRequestInfo) => boolean, status: number, body: string): void {
    this.failures.push({ match, status, body });
  }

  /** filas de una tabla tal como las devolveria un select=* */
  rows(table: string): Row[] {
    return (this.tables.get(table) ?? []).map((row) => this.format(table, row));
  }

  /** mete filas sin pasar por PostgREST, para preparar un escenario */
  seed(table: string, values: Row[]): void {
    const result = this.insert(table, values, { arbiter: null, resolution: null });
    if (result instanceof PgError) throw new Error(`semilla invalida: ${result.code} ${result.message}`);
  }

  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input as RequestInfo, init);
    const url = new URL(request.url);
    if (!request.url.startsWith(this.baseUrl)) {
      throw new Error(`el doble de Supabase no sirve ${url.host}`);
    }
    const auth = request.headers.get('Authorization');
    if (request.headers.get('apikey') !== this.serviceKey || auth !== `Bearer ${this.serviceKey}`) {
      return new Response(JSON.stringify({ message: 'Invalid API key' }), { status: 401 });
    }

    const restPrefix = '/rest/v1/';
    const storagePrefix = '/storage/v1/object/vault-media/';
    const info: FakeRequestInfo = {
      method: request.method,
      kind: url.pathname.startsWith(storagePrefix) ? 'storage' : 'rest',
      target: url.pathname.startsWith(storagePrefix)
        ? url.pathname.slice(storagePrefix.length)
        : url.pathname.slice(restPrefix.length),
      url: request.url,
      prefer: request.headers.get('Prefer'),
    };
    this.log.push(info);

    const failure = this.failures.findIndex((candidate) => candidate.match(info));
    if (failure >= 0) {
      const [chosen] = this.failures.splice(failure, 1);
      return new Response(chosen!.body, { status: chosen!.status });
    }

    if (info.kind === 'storage') return this.storage(request, info.target);
    if (!url.pathname.startsWith(restPrefix)) {
      return new PgError(404, 'PGRST000', `ruta desconocida ${url.pathname}`).toResponse();
    }
    return this.rest(request, url, info.target);
  };

  // ---------------------------------------------------------------------------
  // PostgREST
  // ---------------------------------------------------------------------------

  private async rest(request: Request, url: URL, table: string): Promise<Response> {
    const spec = this.specs[table];
    if (spec === undefined) {
      return new PgError(404, 'PGRST205', `Could not find the table 'public.${table}' in the schema cache`).toResponse();
    }
    const prefer = parsePrefer(request.headers.get('Prefer'));

    if (request.method === 'GET') {
      const result = this.select(table, url.searchParams);
      if (result instanceof PgError) return result.toResponse();
      const text = pgJsonArray(result.rows, result.jsonKeys);
      this.readBodies.push(text);
      return new Response(text, {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Range': result.rows.length === 0 ? '*/*' : `0-${result.rows.length - 1}/*`,
        },
      });
    }

    if (request.method === 'POST') {
      let payload: unknown;
      try {
        payload = JSON.parse(await request.text());
      } catch {
        return new PgError(400, 'PGRST102', 'Empty or invalid json').toResponse();
      }
      const values = Array.isArray(payload) ? payload : [payload];
      const onConflict = url.searchParams.get('on_conflict');
      const arbiter =
        prefer.resolution === null
          ? null
          : onConflict === null
            ? [...spec.primaryKey]
            : onConflict.split(',').map((part) => part.trim());
      const result = this.insert(table, values as Row[], { arbiter, resolution: prefer.resolution });
      if (result instanceof PgError) return result.toResponse();
      return this.written(table, result, prefer.returning, 201);
    }

    if (request.method === 'PATCH') {
      const filter = this.compileFilters(table, url.searchParams);
      if (filter instanceof PgError) return filter.toResponse();
      const payload = JSON.parse(await request.text()) as Row;
      const result = this.update(table, filter, payload);
      if (result instanceof PgError) return result.toResponse();
      return this.written(table, result, prefer.returning, 200);
    }

    if (request.method === 'DELETE') {
      const filter = this.compileFilters(table, url.searchParams);
      if (filter instanceof PgError) return filter.toResponse();
      const removed = this.remove(table, filter);
      return this.written(table, removed, prefer.returning, 200);
    }

    return new PgError(405, 'PGRST117', `metodo ${request.method} no admitido`).toResponse();
  }

  private written(table: string, rows: Row[], returning: 'representation' | 'minimal', okStatus: number): Response {
    if (returning === 'minimal') return new Response(null, { status: okStatus === 201 ? 201 : 204 });
    const jsonKeys = new Set(
      Object.entries(this.specs[table]!.columns)
        .filter(([, kind]) => kind === 'json')
        .map(([column]) => column),
    );
    return new Response(pgJsonArray(rows.map((row) => this.format(table, row)), jsonKeys), {
      status: okStatus,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }

  private select(table: string, params: URLSearchParams): { rows: Row[]; jsonKeys: Set<string> } | PgError {
    const spec = this.specs[table]!;
    const columns = parseSelect(params.get('select') ?? '*', spec);
    if (columns instanceof PgError) return columns;
    const filter = this.compileFilters(table, params);
    if (filter instanceof PgError) return filter;

    let rows = (this.tables.get(table) ?? []).filter(filter);
    const order = params.get('order');
    if (order !== null) {
      const keys = order.split(',').map((part) => {
        const [column, direction] = part.split('.');
        return { column: column!, descending: direction === 'desc' };
      });
      for (const key of keys) {
        if (!(key.column in spec.columns)) {
          return new PgError(400, '42703', `column ${table}.${key.column} does not exist`);
        }
      }
      rows = [...rows].sort((a, b) => {
        for (const key of keys) {
          const diff = compareValues(a[key.column], b[key.column]);
          if (diff !== 0) return key.descending ? -diff : diff;
        }
        return 0;
      });
    }
    const offset = Number(params.get('offset') ?? '0');
    const limit = params.get('limit');
    // como PostgREST: min(limit, max-rows), y sin decir que se recorto
    const applied = Math.min(limit === null ? Number.POSITIVE_INFINITY : Number(limit), this.maxRows);
    rows = rows.slice(offset, offset + applied);

    const jsonKeys = new Set(
      columns.filter(({ column }) => spec.columns[column] === 'json').map(({ alias }) => alias),
    );
    return {
      jsonKeys,
      rows: rows.map((row) => {
        const formatted = this.format(table, row);
        const out: Row = {};
        for (const { alias, column } of columns) out[alias] = formatted[column];
        return out;
      }),
    };
  }

  private insert(
    table: string,
    values: Row[],
    options: { arbiter: string[] | null; resolution: 'ignore-duplicates' | 'merge-duplicates' | null },
  ): Row[] | PgError {
    const spec = this.specs[table]!;
    if (options.arbiter !== null) {
      const matches = [...spec.uniques].some((unique) => sameColumns(unique.columns, options.arbiter!));
      if (!matches) {
        return new PgError(
          400,
          '42P10',
          'there is no unique or exclusion constraint matching the ON CONFLICT specification',
        );
      }
    }

    const working = [...(this.tables.get(table) ?? [])];
    const returned: Row[] = [];
    for (const value of values) {
      const staged = this.stage(table, value, true);
      if (staged instanceof PgError) return staged;

      for (const check of spec.checks) {
        if (!check.ok(staged)) {
          return new PgError(400, '23514', `new row for relation "${table}" violates check constraint "${check.name}"`);
        }
      }
      const missingParent = this.missingParent(table, staged);
      if (missingParent !== null) return missingParent;

      // como Postgres: el arbitro de ON CONFLICT se mira primero; lo demas, despues
      if (options.arbiter !== null) {
        const clash = working.findIndex((row) => sameKey(row, staged, options.arbiter!));
        if (clash >= 0) {
          if (options.resolution === 'merge-duplicates') {
            working[clash] = { ...working[clash], ...staged };
            returned.push(working[clash]!);
          }
          continue;
        }
      }
      const violation = uniqueViolation(spec, working, staged);
      if (violation !== null) return violation;
      working.push(staged);
      returned.push(staged);
    }

    this.tables.set(table, working);
    if (table === 'vault_records') this.recount(returned.map((row) => row.conversation_id as string));
    return returned;
  }

  private update(table: string, filter: (row: Row) => boolean, payload: Row): Row[] | PgError {
    const spec = this.specs[table]!;
    const staged = this.stage(table, payload, false);
    if (staged instanceof PgError) return staged;
    const working = [...(this.tables.get(table) ?? [])];
    const changed: Row[] = [];
    for (let index = 0; index < working.length; index += 1) {
      if (!filter(working[index]!)) continue;
      working[index] = { ...working[index], ...staged };
      changed.push(working[index]!);
    }
    for (const row of changed) {
      const others = working.filter((candidate) => candidate !== row);
      const violation = uniqueViolation(spec, others, row);
      if (violation !== null) return violation;
    }
    this.tables.set(table, working);
    return changed;
  }

  private remove(table: string, filter: (row: Row) => boolean): Row[] {
    const rows = this.tables.get(table) ?? [];
    const removed = rows.filter(filter);
    this.tables.set(table, rows.filter((row) => !filter(row)));
    this.cascade(table, removed);
    if (table === 'vault_records') this.recount(removed.map((row) => row.conversation_id as string));
    return removed;
  }

  /** ON DELETE CASCADE: todas las claves foraneas del esquema de la boveda lo son */
  private cascade(table: string, removed: Row[]): void {
    if (removed.length === 0) return;
    for (const [child, spec] of Object.entries(this.specs)) {
      for (const fk of spec.foreignKeys) {
        if (fk.table !== table) continue;
        const gone = new Set(removed.map((row) => row[fk.refColumn]));
        const childRows = this.tables.get(child) ?? [];
        const orphaned = childRows.filter((row) => gone.has(row[fk.column]));
        if (orphaned.length === 0) continue;
        this.tables.set(child, childRows.filter((row) => !gone.has(row[fk.column])));
        this.cascade(child, orphaned);
        if (child === 'vault_records') this.recount(orphaned.map((row) => row.conversation_id as string));
      }
    }
  }

  /** trigger luxy_touch_vault_conversation (0007): recuenta y toca updated_at */
  private recount(conversationIds: string[]): void {
    const records = this.tables.get('vault_records') ?? [];
    const conversations = this.tables.get('vault_conversations') ?? [];
    for (const id of new Set(conversationIds)) {
      const target = conversations.find((row) => row.conversation_id === id);
      if (target === undefined) continue;
      target.turn_count = records.filter((row) => row.conversation_id === id).length;
      target.updated_at = this.nowMicros();
    }
  }

  private missingParent(table: string, row: Row): PgError | null {
    for (const fk of this.specs[table]!.foreignKeys) {
      const value = row[fk.column];
      if (value === null || value === undefined) continue;
      const parent = (this.tables.get(fk.table) ?? []).some((candidate) => candidate[fk.refColumn] === value);
      if (!parent) {
        return new PgError(
          409,
          '23503',
          `insert or update on table "${table}" violates foreign key constraint "${fk.name}"`,
          `Key (${fk.column})=(${String(value)}) is not present in table "${fk.table}".`,
        );
      }
    }
    return null;
  }

  /** convierte lo que llega por JSON al valor que guardaria Postgres */
  private stage(table: string, value: Row, applyDefaults: boolean): Row | PgError {
    const spec = this.specs[table]!;
    const row: Row = {};
    for (const [column, raw] of Object.entries(value)) {
      const kind = spec.columns[column];
      if (kind === undefined) {
        return new PgError(400, 'PGRST204', `Could not find the '${column}' column of '${table}' in the schema cache`);
      }
      const coerced = coerce(kind, raw);
      if (coerced instanceof PgError) return coerced;
      row[column] = coerced;
    }
    if (!applyDefaults) return row;
    for (const column of Object.keys(spec.columns)) {
      if (row[column] !== undefined) continue;
      const fallback = spec.defaults[column];
      row[column] = fallback === undefined ? null : fallback();
    }
    for (const column of spec.notNull) {
      if (row[column] === null || row[column] === undefined) {
        return new PgError(400, '23502', `null value in column "${column}" of relation "${table}" violates not-null constraint`);
      }
    }
    return row;
  }

  private compileFilters(table: string, params: URLSearchParams): ((row: Row) => boolean) | PgError {
    const spec = this.specs[table]!;
    const tests: Array<(row: Row) => boolean> = [];
    for (const [key, value] of params.entries()) {
      if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(key)) continue;
      const compiled =
        key === 'and' || key === 'or'
          ? compileGroup(key, value, spec, table)
          : compileCondition(key, value, spec, table);
      if (compiled instanceof PgError) return compiled;
      tests.push(compiled);
    }
    return (row) => tests.every((test) => test(row));
  }

  /** la fila con sus valores como los serializa PostgREST */
  private format(table: string, row: Row): Row {
    const spec = this.specs[table]!;
    const out: Row = {};
    for (const [column, kind] of Object.entries(spec.columns)) {
      const value = row[column];
      out[column] = kind === 'timestamp' && typeof value === 'number' ? formatTimestamp(value) : value ?? null;
    }
    return out;
  }

  private nowMicros(): number {
    // microsegundos, como now() en Postgres. El contador evita dos instantes
    // iguales seguidos sin depender del reloj real
    this.tick = (this.tick + 1) % 1000;
    return this.clock() * 1000 + this.tick;
  }

  // ---------------------------------------------------------------------------
  // Storage
  // ---------------------------------------------------------------------------

  private async storage(request: Request, path: string): Promise<Response> {
    if (request.method === 'POST' || request.method === 'PUT') {
      const exists = this.objects.has(path);
      if (exists && request.headers.get('x-upsert') !== 'true') {
        return storageError(400, '409', 'Duplicate', 'The resource already exists');
      }
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (bytes.byteLength > this.objectSizeLimit) {
        return storageError(
          this.oversizeStatus,
          '413',
          'Payload too large',
          'The object exceeded the maximum allowed size',
        );
      }
      this.objects.set(path, bytes);
      return new Response(JSON.stringify({ Key: `vault-media/${path}` }), { status: 200 });
    }
    const stored = this.objects.get(path);
    if (stored === undefined) {
      return storageError(this.missingObjectStatus, '404', 'not_found', 'Object not found');
    }
    if (request.method === 'DELETE') {
      this.objects.delete(path);
      return new Response(JSON.stringify({ message: 'Successfully deleted' }), { status: 200 });
    }
    // highWaterMark 0: el flujo no se llena solo, asi que un pull es una lectura
    // de verdad. Es lo que deja probar que alguien NO leyo el cuerpo
    const body = new ReadableStream<Uint8Array>(
      {
        pull: (controller) => {
          this.objectBodyReads += 1;
          controller.enqueue(stored);
          controller.close();
        },
        cancel: () => {
          this.objectBodyCancels += 1;
        },
      },
      { highWaterMark: 0 },
    );
    return new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(stored.byteLength) },
    });
  }
}

// -----------------------------------------------------------------------------
// esquema: el de 0007, solo las tablas de la boveda
// -----------------------------------------------------------------------------

function buildSpecs(now: () => number): Record<string, TableSpec> {
  const uuid = (): string => crypto.randomUUID();
  return {
    vault_users: {
      columns: {
        id: 'uuid',
        email: 'text',
        auth_salt: 'text',
        argon2_t: 'int4',
        argon2_m: 'int4',
        argon2_p: 'int4',
        auth_hash: 'text',
        wrapped_master_key: 'json',
        recovery_salt: 'text',
        recovery_argon2_t: 'int4',
        recovery_argon2_m: 'int4',
        recovery_argon2_p: 'int4',
        recovery_auth_hash: 'text',
        recovery_wrapped_master_key: 'json',
        vault_id: 'text',
        disabled: 'bool',
        created_at: 'timestamp',
        updated_at: 'timestamp',
      },
      notNull: ['id', 'email', 'vault_id', 'disabled'],
      primaryKey: ['id'],
      uniques: [
        { name: 'vault_users_pkey', columns: ['id'] },
        { name: 'vault_users_email_unique', columns: ['email'] },
      ],
      foreignKeys: [],
      defaults: { id: uuid, disabled: () => false, created_at: now, updated_at: now },
      checks: [],
    },
    vault_sessions: {
      columns: {
        id: 'uuid',
        user_id: 'uuid',
        token_hash: 'text',
        created_at: 'timestamp',
        expires_at: 'timestamp',
        revoked_at: 'timestamp',
        machine_id: 'uuid',
      },
      notNull: ['id', 'user_id', 'token_hash', 'expires_at'],
      primaryKey: ['id'],
      uniques: [
        { name: 'vault_sessions_pkey', columns: ['id'] },
        { name: 'vault_sessions_token_hash_unique', columns: ['token_hash'] },
      ],
      foreignKeys: [{ name: 'vault_sessions_user_id_fkey', column: 'user_id', table: 'vault_users', refColumn: 'id' }],
      defaults: { id: uuid, created_at: now },
      checks: [],
    },
    vault_conversations: {
      columns: {
        conversation_id: 'uuid',
        owner_user_id: 'uuid',
        turn_count: 'int4',
        updated_at: 'timestamp',
        created_at: 'timestamp',
      },
      notNull: ['conversation_id', 'owner_user_id', 'turn_count'],
      primaryKey: ['conversation_id'],
      uniques: [{ name: 'vault_conversations_pkey', columns: ['conversation_id'] }],
      foreignKeys: [
        { name: 'vault_conversations_owner_user_id_fkey', column: 'owner_user_id', table: 'vault_users', refColumn: 'id' },
      ],
      defaults: { turn_count: () => 0, updated_at: now, created_at: now },
      checks: [{ name: 'vault_conversations_turns_positive', ok: (row) => (row.turn_count as number) >= 0 }],
    },
    vault_records: {
      columns: {
        record_id: 'uuid',
        owner_user_id: 'uuid',
        conversation_id: 'uuid',
        sequence: 'int4',
        content: 'json',
        sealed_memory: 'json',
        created_at: 'timestamp',
      },
      notNull: ['record_id', 'owner_user_id', 'conversation_id', 'sequence', 'content'],
      primaryKey: ['record_id'],
      uniques: [
        { name: 'vault_records_pkey', columns: ['record_id'] },
        { name: 'vault_records_unique_sequence', columns: ['conversation_id', 'sequence'] },
      ],
      foreignKeys: [
        { name: 'vault_records_owner_user_id_fkey', column: 'owner_user_id', table: 'vault_users', refColumn: 'id' },
        {
          name: 'vault_records_conversation_id_fkey',
          column: 'conversation_id',
          table: 'vault_conversations',
          refColumn: 'conversation_id',
        },
      ],
      defaults: { created_at: now },
      checks: [{ name: 'vault_records_sequence_positive', ok: (row) => (row.sequence as number) >= 0 }],
    },
    vault_media: {
      columns: {
        media_id: 'uuid',
        owner_user_id: 'uuid',
        conversation_id: 'uuid',
        object_key: 'text',
        byte_size: 'int8',
        content: 'json',
        thumbnail_object_key: 'text',
        created_at: 'timestamp',
      },
      notNull: ['media_id', 'owner_user_id', 'conversation_id', 'object_key', 'byte_size', 'content'],
      primaryKey: ['media_id'],
      uniques: [
        { name: 'vault_media_pkey', columns: ['media_id'] },
        { name: 'vault_media_object_key_unique', columns: ['owner_user_id', 'object_key'] },
      ],
      foreignKeys: [
        { name: 'vault_media_owner_user_id_fkey', column: 'owner_user_id', table: 'vault_users', refColumn: 'id' },
        {
          name: 'vault_media_conversation_id_fkey',
          column: 'conversation_id',
          table: 'vault_conversations',
          refColumn: 'conversation_id',
        },
      ],
      defaults: { created_at: now },
      checks: [
        { name: 'vault_media_object_key_opaque', ok: (row) => /^[0-9a-f]{32}$/.test(String(row.object_key)) },
        {
          name: 'vault_media_thumbnail_opaque',
          ok: (row) => row.thumbnail_object_key === null || /^[0-9a-f]{32}$/.test(String(row.thumbnail_object_key)),
        },
        { name: 'vault_media_size_positive', ok: (row) => (row.byte_size as number) > 0 },
      ],
    },
  };
}

// -----------------------------------------------------------------------------
// utilidades
// -----------------------------------------------------------------------------

function storageError(status: number, statusCode: string, error: string, message: string): Response {
  return new Response(JSON.stringify({ statusCode, error, message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function parsePrefer(header: string | null): {
  returning: 'representation' | 'minimal';
  resolution: 'ignore-duplicates' | 'merge-duplicates' | null;
} {
  const parts = (header ?? '').split(',').map((part) => part.trim());
  return {
    returning: parts.includes('return=representation') ? 'representation' : 'minimal',
    resolution: parts.includes('resolution=ignore-duplicates')
      ? 'ignore-duplicates'
      : parts.includes('resolution=merge-duplicates')
        ? 'merge-duplicates'
        : null,
  };
}

function parseSelect(select: string, spec: TableSpec): Array<{ alias: string; column: string }> | PgError {
  if (select === '*') return Object.keys(spec.columns).map((column) => ({ alias: column, column }));
  const out: Array<{ alias: string; column: string }> = [];
  for (const item of select.split(',')) {
    // PostgREST: «alias:columna», o la columna sola
    const [alias, renamed] = item.split(':') as [string, string | undefined];
    const column = renamed ?? alias;
    if (!(column in spec.columns)) return new PgError(400, '42703', `column ${column} does not exist`);
    out.push({ alias, column });
  }
  return out;
}

/** separa por comas que no esten dentro de parentesis */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of text) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (current.length > 0) parts.push(current);
  return parts;
}

function compileGroup(
  kind: 'and' | 'or',
  raw: string,
  spec: TableSpec,
  table: string,
): ((row: Row) => boolean) | PgError {
  if (!raw.startsWith('(') || !raw.endsWith(')')) {
    return new PgError(400, 'PGRST100', `"failed to parse logic tree (${raw})"`);
  }
  const tests: Array<(row: Row) => boolean> = [];
  for (const part of splitTopLevel(raw.slice(1, -1))) {
    const nested = /^(and|or)(\(.*\))$/.exec(part);
    let compiled: ((row: Row) => boolean) | PgError;
    if (nested !== null) {
      compiled = compileGroup(nested[1] as 'and' | 'or', nested[2]!, spec, table);
    } else {
      const dot = part.indexOf('.');
      compiled = dot < 0
        ? new PgError(400, 'PGRST100', `"failed to parse logic tree (${raw})"`)
        : compileCondition(part.slice(0, dot), part.slice(dot + 1), spec, table);
    }
    if (compiled instanceof PgError) return compiled;
    tests.push(compiled);
  }
  return kind === 'and'
    ? (row) => tests.every((test) => test(row))
    : (row) => tests.some((test) => test(row));
}

function compileCondition(
  column: string,
  expression: string,
  spec: TableSpec,
  table: string,
): ((row: Row) => boolean) | PgError {
  const kind = spec.columns[column];
  if (kind === undefined) return new PgError(400, '42703', `column ${table}.${column} does not exist`);
  const dot = expression.indexOf('.');
  if (dot < 0) return new PgError(400, 'PGRST100', `"failed to parse filter (${expression})"`);
  const operator = expression.slice(0, dot);
  const operand = expression.slice(dot + 1);

  if (operator === 'is') {
    if (operand === 'null') return (row) => row[column] === null || row[column] === undefined;
    if (operand === 'true' || operand === 'false') return (row) => row[column] === (operand === 'true');
    return new PgError(400, 'PGRST100', `"failed to parse filter (${expression})"`);
  }
  if (operator === 'in') {
    if (!operand.startsWith('(') || !operand.endsWith(')')) {
      return new PgError(400, 'PGRST100', `"failed to parse filter (${expression})"`);
    }
    const list: unknown[] = [];
    for (const item of splitTopLevel(operand.slice(1, -1))) {
      const value = parseOperand(kind, item);
      if (value instanceof PgError) return value;
      list.push(value);
    }
    return (row) => list.some((value) => compareValues(row[column], value) === 0 && row[column] !== null);
  }
  const value = parseOperand(kind, operand);
  if (value instanceof PgError) return value;
  const cmp = (row: Row): number | null =>
    row[column] === null || row[column] === undefined ? null : compareValues(row[column], value);
  switch (operator) {
    case 'eq':
      return (row) => cmp(row) === 0;
    case 'neq':
      return (row) => { const c = cmp(row); return c !== null && c !== 0; };
    case 'gt':
      return (row) => { const c = cmp(row); return c !== null && c > 0; };
    case 'gte':
      return (row) => { const c = cmp(row); return c !== null && c >= 0; };
    case 'lt':
      return (row) => { const c = cmp(row); return c !== null && c < 0; };
    case 'lte':
      return (row) => { const c = cmp(row); return c !== null && c <= 0; };
    default:
      return new PgError(400, 'PGRST100', `"unknown operator (${operator})"`);
  }
}

function parseOperand(kind: ColumnKind, text: string): unknown {
  switch (kind) {
    case 'int4':
    case 'int8': {
      if (!/^-?\d+$/.test(text)) return new PgError(400, '22P02', `invalid input syntax for type integer: "${text}"`);
      return Number(text);
    }
    case 'timestamp': {
      const micros = parseTimestamp(text);
      return micros === null ? new PgError(400, '22007', `invalid input syntax for type timestamp with time zone: "${text}"`) : micros;
    }
    case 'uuid':
      return UUID.test(text) ? text.toLowerCase() : new PgError(400, '22P02', `invalid input syntax for type uuid: "${text}"`);
    case 'bool':
      return text === 'true';
    default:
      return text;
  }
}

function coerce(kind: ColumnKind, raw: unknown): unknown {
  if (raw === null || raw === undefined) return null;
  switch (kind) {
    case 'uuid':
      if (typeof raw !== 'string' || !UUID.test(raw)) {
        return new PgError(400, '22P02', `invalid input syntax for type uuid: "${String(raw)}"`);
      }
      // Postgres guarda los uuid en minusculas y asi los devuelve
      return raw.toLowerCase();
    case 'int4':
    case 'int8':
      if (typeof raw !== 'number' || !Number.isInteger(raw)) {
        return new PgError(400, '22P02', `invalid input syntax for type integer: "${String(raw)}"`);
      }
      if (kind === 'int4' && Math.abs(raw) > INT4_MAX) {
        return new PgError(400, '22003', `value "${raw}" is out of range for type integer`);
      }
      return raw;
    case 'bool':
      return Boolean(raw);
    case 'timestamp': {
      const micros = typeof raw === 'string' ? parseTimestamp(raw) : null;
      return micros === null
        ? new PgError(400, '22007', `invalid input syntax for type timestamp with time zone: "${String(raw)}"`)
        : micros;
    }
    case 'json':
      return jsonb(raw);
    default:
      return String(raw);
  }
}

/** microsegundos desde 1970, como guarda timestamptz */
function parseTimestamp(value: string): number | null {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  const fraction = /T\d{2}:\d{2}:\d{2}\.(\d+)/.exec(value)?.[1] ?? '';
  const extra = Number(`${fraction}000000`.slice(3, 6));
  return ms * 1000 + extra;
}

/** como lo escribe Postgres en JSON: «+00:00» y la fraccion sin ceros al final */
export function formatTimestamp(micros: number): string {
  const ms = Math.floor(micros / 1000);
  const rest = micros - ms * 1000;
  const iso = new Date(ms).toISOString();
  const fraction = `${iso.slice(20, 23)}${String(rest).padStart(3, '0')}`.replace(/0+$/, '');
  return `${iso.slice(0, 19)}${fraction.length > 0 ? `.${fraction}` : ''}+00:00`;
}

/**
 * el texto que devuelve PostgREST, que no es el de JSON.stringify.
 *
 * PostgREST arma la respuesta con json_agg, que separa los elementos con
 * «, » y un salto de linea, y un valor jsonb sale con su texto de jsonb, con
 * espacio tras «:» y «,». Imitarlo es lo que hace que «el cuerpo llega byte a
 * byte» pruebe algo: un gateway que analizara y volviera a serializar daria
 * otro texto.
 */
function pgJsonArray(rows: Row[], jsonKeys: Set<string>): string {
  if (rows.length === 0) return '[]';
  const items = rows.map(
    (row) =>
      `{${Object.entries(row)
        .map(([key, value]) => `${JSON.stringify(key)}:${jsonKeys.has(key) ? jsonbText(value) : JSON.stringify(value)}`)
        .join(',')}}`,
  );
  return `[${items.join(', \n ')}]`;
}

function jsonbText(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(jsonbText).join(', ')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Row)
      .map(([key, item]) => `${JSON.stringify(key)}: ${jsonbText(item)}`)
      .join(', ')}}`;
  }
  return JSON.stringify(value);
}

/** jsonb ordena las claves: primero las cortas, y a igual longitud por bytes */
function jsonb(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(jsonb);
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Row).sort(([a], [b]) =>
      a.length !== b.length ? a.length - b.length : a < b ? -1 : a > b ? 1 : 0,
    );
    return Object.fromEntries(entries.map(([key, item]) => [key, jsonb(item)]));
  }
  return value;
}

function compareValues(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const left = String(a);
  const right = String(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

function sameColumns(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((column) => b.includes(column));
}

function sameKey(a: Row, b: Row, columns: readonly string[]): boolean {
  return columns.every((column) => a[column] !== null && a[column] !== undefined && a[column] === b[column]);
}

function uniqueViolation(spec: TableSpec, rows: Row[], candidate: Row): PgError | null {
  for (const unique of spec.uniques) {
    if (rows.some((row) => row !== candidate && sameKey(row, candidate, unique.columns))) {
      const values = unique.columns.map((column) => String(candidate[column])).join(', ');
      return new PgError(
        409,
        '23505',
        `duplicate key value violates unique constraint "${unique.name}"`,
        `Key (${unique.columns.join(', ')})=(${values}) already exists.`,
      );
    }
  }
  return null;
}

// -----------------------------------------------------------------------------
// kit para las pruebas: entorno, cuentas y el fetch global
// -----------------------------------------------------------------------------

/** entorno valido del Worker apuntando al doble. Ningun valor es real */
export function fakeEnv(fake: FakeSupabase): Env {
  return {
    TELEGRAM_BOT_TOKEN: 'telegram-de-prueba-0123456789',
    TELEGRAM_WEBHOOK_SECRET: 'webhook-de-prueba',
    TELEGRAM_ADMIN_USER_ID: '1',
    TELEGRAM_ALLOWED_CHAT_IDS: '1',
    SUPABASE_URL: fake.baseUrl,
    SUPABASE_SERVICE_ROLE_KEY: fake.serviceKey,
    MACHINE_REGISTRATION_SECRET: 'registro-de-prueba',
    LOG_LEVEL: 'debug',
  };
}

/** pone el doble como fetch global y devuelve como quitarlo */
export function installFakeFetch(fake: FakeSupabase): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = fake.fetch as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

/** crea una cuenta con una sesion viva y devuelve su token */
export async function seedVaultAccount(
  fake: FakeSupabase,
  options: { userId: string; token: string; expiresAt: string; email?: string },
): Promise<void> {
  fake.seed('vault_users', [
    { id: options.userId, email: options.email ?? `${options.userId}@prueba.test`, vault_id: 'A'.repeat(43) },
  ]);
  fake.seed('vault_sessions', [
    { user_id: options.userId, token_hash: await hashToken(options.token), expires_at: options.expiresAt },
  ]);
}
