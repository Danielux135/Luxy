// cliente minimo de supabase sobre postgrest, usando solo fetch nativo.
// no se usa el sdk oficial: el worker solo necesita rest y rpc.
import type { GatewayConfig } from './env.js';

export class SupabaseError extends Error {
  /**
   * codigo de Postgres o de PostgREST (23505, 23503, PGRST205...), si lo trae.
   *
   * Existe para que un 409 se pueda reconocer: un unique violado y una clave
   * foranea sin padre llegan los dos como 409, y no significan lo mismo.
   */
  readonly code: string | null;

  constructor(
    message: string,
    readonly status: number,
    readonly details: string,
    code: string | null = errorCodeOf(details),
  ) {
    super(message);
    this.name = 'SupabaseError';
    this.code = code;
  }

  /** se violo un unique: un INSERT plano no metio NINGUNA fila del lote */
  get isUniqueViolation(): boolean {
    return this.status === 409 && this.code === '23505';
  }

  /** la fila apunta a un padre que no existe (por ejemplo, una conversacion purgada) */
  get isForeignKeyViolation(): boolean {
    return this.status === 409 && this.code === '23503';
  }

  /**
   * construye el error a partir de una respuesta fallida.
   *
   * El codigo se lee del cuerpo ENTERO antes de recortarlo: recortado a 500
   * caracteres podria no ser JSON y el 409 dejaria de reconocerse.
   */
  static async from(response: Response, message: string): Promise<SupabaseError> {
    const details = await response.text().catch(() => '');
    return new SupabaseError(message, response.status, details.slice(0, 500), errorCodeOf(details));
  }
}

function errorCodeOf(details: string): string | null {
  try {
    const parsed = JSON.parse(details) as unknown;
    if (parsed !== null && typeof parsed === 'object') {
      const code = (parsed as { code?: unknown }).code;
      if (typeof code === 'string' && code.length > 0) return code;
    }
  } catch {
    // un cuerpo que no es JSON no trae codigo; el estado sigue valiendo
  }
  return null;
}

export interface SelectOptions {
  columns?: string;
  filters?: Record<string, string>;
  order?: string;
  limit?: number;
  offset?: number;
}

export class SupabaseClient {
  private readonly restUrl: string;
  private readonly headers: Record<string, string>;

  constructor(config: Pick<GatewayConfig, 'SUPABASE_URL' | 'SUPABASE_SERVICE_ROLE_KEY'>) {
    this.restUrl = `${config.SUPABASE_URL.replace(/\/+$/, '')}/rest/v1`;
    // la service role key omite RLS: solo existe aqui, nunca en los equipos locales
    this.headers = {
      apikey: config.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${config.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    };
  }

  private async request<T>(path: string, init: RequestInit, expectJson = true): Promise<T> {
    const response = await fetch(`${this.restUrl}${path}`, {
      ...init,
      headers: { ...this.headers, ...(init.headers as Record<string, string> | undefined) },
    });

    if (!response.ok) {
      throw await SupabaseError.from(response, `supabase respondio ${response.status}`);
    }

    if (!expectJson || response.status === 204) return undefined as T;
    const text = await response.text();
    return (text.length > 0 ? JSON.parse(text) : undefined) as T;
  }

  /** construye la query string de postgrest a partir de filtros simples */
  private buildQuery(options: SelectOptions): string {
    const params = new URLSearchParams();
    params.set('select', options.columns ?? '*');
    for (const [key, value] of Object.entries(options.filters ?? {})) {
      params.append(key, value);
    }
    if (options.order) params.set('order', options.order);
    if (options.limit) params.set('limit', String(options.limit));
    if (options.offset !== undefined) params.set('offset', String(options.offset));
    return params.toString();
  }

  async select<T>(table: string, options: SelectOptions = {}): Promise<T[]> {
    return this.request<T[]>(`/${table}?${this.buildQuery(options)}`, { method: 'GET' });
  }

  async selectOne<T>(table: string, options: SelectOptions = {}): Promise<T | null> {
    const rows = await this.select<T>(table, { ...options, limit: 1 });
    return rows[0] ?? null;
  }

  /**
   * select que devuelve la respuesta SIN analizar el cuerpo.
   *
   * Para las lecturas de la sincronizacion: el gateway no tiene nada que mirar
   * dentro de unos sobres cifrados, y analizar megas de JSON solo para volver
   * a serializarlos gasta la CPU del Worker. Con alias en `columns`, PostgREST
   * ya da la forma del contrato y el cuerpo se reenvia tal cual. Si no es 2xx,
   * lanza un SupabaseError: el cuerpo de error nunca llega al cliente.
   */
  async selectRaw(table: string, options: SelectOptions = {}): Promise<Response> {
    const response = await fetch(`${this.restUrl}/${table}?${this.buildQuery(options)}`, {
      method: 'GET',
      headers: this.headers,
    });
    if (!response.ok) {
      throw await SupabaseError.from(response, `supabase respondio ${response.status}`);
    }
    return response;
  }

  async insert<T>(table: string, values: unknown, returning = true): Promise<T[]> {
    return this.request<T[]>(`/${table}`, {
      method: 'POST',
      headers: { Prefer: returning ? 'return=representation' : 'return=minimal' },
      body: JSON.stringify(values),
    });
  }

  /**
   * insercion idempotente: si la clave ya existe no falla ni sobrescribe.
   * se usa para telegram_updates, donde update_id es unico.
   * devuelve true si la fila era nueva.
   */
  async insertIfAbsent(table: string, values: unknown, conflictColumn: string): Promise<boolean> {
    const rows = await this.request<unknown[]>(
      `/${table}?on_conflict=${encodeURIComponent(conflictColumn)}`,
      {
        method: 'POST',
        headers: {
          Prefer: 'resolution=ignore-duplicates,return=representation',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(values),
      },
    );
    return Array.isArray(rows) && rows.length > 0;
  }

  /**
   * inserta lo que no choque con `conflictColumns` y devuelve SOLO lo nuevo.
   *
   * `on_conflict` sin `Prefer: resolution` es un INSERT normal que responde 409
   * al primer duplicado: es lo que congelaba la sincronizacion v1, que ademas
   * se tragaba ese error. Aqui va la cabecera, y cualquier otro error (otro
   * unique, una clave foranea, un 500) se propaga.
   */
  async insertIgnoringDuplicates<T>(
    table: string,
    values: unknown,
    conflictColumns: string,
  ): Promise<T[]> {
    const rows = await this.request<T[] | undefined>(
      `/${table}?on_conflict=${encodeURIComponent(conflictColumns)}`,
      {
        method: 'POST',
        headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
        body: JSON.stringify(values),
      },
    );
    return Array.isArray(rows) ? rows : [];
  }

  async upsert<T>(table: string, values: unknown, conflictColumn: string): Promise<T[]> {
    return this.request<T[]>(`/${table}?on_conflict=${encodeURIComponent(conflictColumn)}`, {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify(values),
    });
  }

  /**
   * borra filas.
   *
   * PostgREST rechaza un DELETE sin filtros, lo cual es una red de seguridad
   * util; aun asi se comprueba aqui, para que el error diga que pasa en vez de
   * llegar como un 400 del servidor.
   */
  async delete(table: string, filters: Record<string, string>): Promise<number> {
    if (Object.keys(filters).length === 0) {
      throw new SupabaseError('un borrado sin filtros borraria la tabla entera', 400, '');
    }
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) params.append(key, value);
    const rows = await this.request<unknown[]>(`/${table}?${params.toString()}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=representation' },
    });
    return Array.isArray(rows) ? rows.length : 0;
  }

  async update<T>(table: string, filters: Record<string, string>, values: unknown): Promise<T[]> {
    const params = new URLSearchParams(filters);
    return this.request<T[]>(`/${table}?${params.toString()}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(values),
    });
  }

  /** llama a una funcion postgres (las de reclamacion y leases) */
  async rpc<T>(functionName: string, args: Record<string, unknown> = {}): Promise<T> {
    const response = await fetch(
      `${this.restUrl.replace('/rest/v1', '/rest/v1/rpc')}/${functionName}`,
      {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(args),
      },
    );
    if (!response.ok) {
      throw await SupabaseError.from(response, `rpc ${functionName} respondio ${response.status}`);
    }
    const text = await response.text();
    return (text.length > 0 ? JSON.parse(text) : null) as T;
  }
}

// helper de filtros postgrest, para no repetir la sintaxis por todo el codigo
export const eq = (value: string | number): string => `eq.${value}`;
/** mayor o igual: se usa para traer solo lo posterior a una marca de tiempo */
export const gte = (value: string | number): string => `gte.${value}`;
/** estrictamente mayor: el cursor de una pagina no se repite en la siguiente */
export const gt = (value: string | number): string => `gt.${value}`;
export const lt = (value: string | number): string => `lt.${value}`;
export const isNull = (): string => 'is.null';
export const inList = (values: Array<string | number>): string => `in.(${values.join(',')})`;
