import { httpProviderConfigSchema } from '@luxy/shared';
import type { StoredAgentConfig } from '@luxy/shared';

export type HttpProviderConfig = StoredAgentConfig['providers']['http'][number];

export interface HttpProviderDraft {
  id: string;
  displayName: string;
  baseUrl: string;
  model: string;
  enabled: boolean;
  supportsStreaming: boolean;
  maxOutputTokens: string;
  dailyBudget: string;
}

export interface HttpProviderBuildResult {
  provider: HttpProviderConfig | null;
  error: string | null;
}

/**
 * proveedores conocidos, para no tener que recordar su URL exacta.
 *
 * Un solo carácter de más en la URL base produce un 404 que no se ve hasta el
 * primer trabajo, porque este camino no tiene botón de «Probar». Estas están
 * comprobadas contra su documentación el 2026-09-04.
 *
 * `nota` no es publicidad: es lo que hay que saber ANTES de gastar la clave.
 */
export const HTTP_PROVIDER_PRESETS: readonly {
  id: string;
  displayName: string;
  baseUrl: string;
  model: string;
  nota: string;
}[] = [
  {
    id: 'cohere',
    displayName: 'Cohere',
    // el host es .ai; la API nativa vive en .com y NO habla este contrato
    baseUrl: 'https://api.cohere.ai/compatibility/v1',
    model: 'command-a-03-2025',
    nota: 'Clave de evaluación gratuita: 20 peticiones por minuto y 1.000 llamadas al mes. Su documentación no la permite para producción, y sus términos prohíben contenido pornográfico.',
  },
  {
    id: 'deepseek',
    displayName: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    nota: 'De pago por uso, sin cuota gratuita renovable. Pon un presupuesto diario distinto de cero.',
  },
  {
    id: 'groq',
    displayName: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
    nota: 'Nivel gratuito por minuto y por día, sin tarjeta. No promete aceptar contenido adulto.',
  },
  {
    id: 'mistral',
    displayName: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    model: 'mistral-large-latest',
    nota: 'Plan gratuito con crédito mensual y sin tarjeta. Su política sobre ficción adulta no es explícita.',
  },
  {
    id: 'openrouter',
    displayName: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'meta-llama/llama-3.3-70b-instruct',
    nota: 'Agregador: la política y la retención dependen del modelo que elijas, no de OpenRouter.',
  },
];

export function emptyHttpProviderDraft(): HttpProviderDraft {
  return {
    id: '',
    displayName: '',
    baseUrl: '',
    model: '',
    enabled: true,
    supportsStreaming: true,
    maxOutputTokens: '8192',
    dailyBudget: '0',
  };
}

export function httpProviderToDraft(provider: HttpProviderConfig): HttpProviderDraft {
  return {
    id: provider.id,
    displayName: provider.displayName,
    baseUrl: provider.baseUrl,
    model: provider.model,
    enabled: provider.enabled,
    supportsStreaming: provider.supportsStreaming,
    maxOutputTokens: String(provider.maxOutputTokens),
    dailyBudget: String(provider.dailyBudget),
  };
}

/** el nombre interno no lo decide el renderer ni se muestra como campo libre */
export function apiKeyNameForProvider(id: string): string {
  return `LUXY_HTTP_${id.toUpperCase().replace(/-/g, '_')}_API_KEY`;
}

export function buildHttpProvider(
  draft: HttpProviderDraft,
  existing: HttpProviderConfig | null,
): HttpProviderBuildResult {
  const id = draft.id.trim().toLowerCase();
  const parsed = httpProviderConfigSchema.safeParse({
    id,
    displayName: draft.displayName.trim(),
    baseUrl: draft.baseUrl.trim().replace(/\/+$/, ''),
    model: draft.model.trim(),
    apiKeyEnv: existing?.apiKeyEnv ?? apiKeyNameForProvider(id),
    enabled: draft.enabled,
    supportsStreaming: draft.supportsStreaming,
    maxOutputTokens: Number(draft.maxOutputTokens),
    dailyBudget: Number(draft.dailyBudget),
    ...(existing?.softTerminalGraceMs === undefined
      ? {}
      : { softTerminalGraceMs: existing.softTerminalGraceMs }),
    // el tope de silencio no tiene campo en el formulario todavia: si no se
    // arrastra aqui, editar el modelo de una conexion le devolveria el valor
    // por defecto y se perderia el ajuste sin avisar
    ...(existing?.silenceTimeoutMs === undefined
      ? {}
      : { silenceTimeoutMs: existing.silenceTimeoutMs }),
    // lo mismo con el tope de llamadas diarias: es una proteccion, y una
    // proteccion que se apaga sola al editar otra cosa es peor que no tenerla
    ...(existing?.dailyCallLimit === undefined
      ? {}
      : { dailyCallLimit: existing.dailyCallLimit }),
  });
  if (parsed.success) return { provider: parsed.data, error: null };

  return {
    provider: null,
    error: parsed.error.issues
      .slice(0, 3)
      .map((issue) => issue.message)
      .join('; '),
  };
}
