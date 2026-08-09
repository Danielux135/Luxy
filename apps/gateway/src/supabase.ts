// cliente minimo de supabase sobre postgrest, usando solo fetch nativo.
// no se usa el sdk oficial: el worker solo necesita rest y rpc.
import type { GatewayConfig } from './env.js';

export class SupabaseError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details: string,
  ) {
    super(message);
    this.name = 'SupabaseError';
  }
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
      const details = await response.text().catch(() => '');
      throw new SupabaseError(
        `supabase respondio ${response.status}`,
        response.status,
        details.slice(0, 500),
      );
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

  async upsert<T>(table: string, values: unknown, conflictColumn: string): Promise<T[]> {
    return this.request<T[]>(`/${table}?on_conflict=${encodeURIComponent(conflictColumn)}`, {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify(values),
    });
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
      const details = await response.text().catch(() => '');
      throw new SupabaseError(
        `rpc ${functionName} respondio ${response.status}`,
        response.status,
        details.slice(0, 500),
      );
    }
    const text = await response.text();
    return (text.length > 0 ? JSON.parse(text) : null) as T;
  }
}

// helper de filtros postgrest, para no repetir la sintaxis por todo el codigo
export const eq = (value: string | number): string => `eq.${value}`;
export const isNull = (): string => 'is.null';
export const inList = (values: Array<string | number>): string => `in.(${values.join(',')})`;
