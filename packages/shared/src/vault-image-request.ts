// como el modelo pide una imagen dentro de una conversacion privada.
//
// El problema que resuelve: la conversacion y la generacion eran dos cosas
// desconectadas. Se escribia en una y se generaba en otro panel, a mano, con el
// prompt y el personaje escritos otra vez. Pedirle una foto al personaje no
// producia ninguna, porque nadie escuchaba.
//
// La solucion reutiliza un patron que ya funciona aqui: el bloque de memoria.
// El modelo termina su respuesta con un bloque estructurado, el proceso
// principal lo separa del texto visible y actua. Mismo mecanismo, otro
// proposito, y por tanto los mismos limites conocidos: si el modelo no lo
// escribe bien, no pasa nada raro — simplemente no hay imagen.
//
// Este modulo es PURO. No genera, no cifra y no habla con nadie: solo decide
// que hay escrito. Asi cada caso limite se prueba sin montar una boveda ni
// gastar una generacion.
import { z } from 'zod';

export const VAULT_IMAGE_OPEN = '<LUXY_IMAGEN>';
export const VAULT_IMAGE_CLOSE = '</LUXY_IMAGEN>';

/**
 * lo que el modelo puede pedir.
 *
 * `prompt` es lo que se le manda al proveedor, y NO es lo que el usuario
 * escribio: es la descripcion visual que el modelo compone a partir de la
 * conversacion. Esa es la razon de que esto exista y no baste con reenviar el
 * mensaje del usuario, que casi nunca describe una imagen.
 */
export const vaultImageRequestSchema = z.object({
  prompt: z.string().min(1).max(2000),
  kind: z.enum(['image', 'video']).default('image'),
});
export type VaultImageRequest = z.infer<typeof vaultImageRequestSchema>;

/**
 * que paso con el bloque, dicho para una persona.
 *
 * Los tres que no son `structured` acaban igual —no hay imagen— pero NO
 * significan lo mismo: «no lo pidio» es lo normal, «el bloque se corto» avisa
 * de que la respuesta se quedo sin sitio, y eso se arregla de otra forma.
 */
export const VAULT_IMAGE_STATUSES = ['absent', 'structured', 'truncated_block', 'invalid'] as const;
export type VaultImageStatus = (typeof VAULT_IMAGE_STATUSES)[number];

export interface ParsedVaultImageRequest {
  /** la respuesta sin el bloque: es lo que se guarda y se enseña */
  visibleText: string;
  request: VaultImageRequest | null;
  status: VaultImageStatus;
}

/**
 * instrucciones que se añaden al prompt SOLO cuando generar es posible.
 *
 * Si no hay personaje o no hay clave, esto no se envia: ofrecerle al modelo una
 * herramienta que no existe garantiza que la use y que el usuario vea una
 * promesa incumplida en cada turno.
 *
 * El limite de una por respuesta no es estetico: cada generacion cuesta
 * creditos, y sin tope un modelo entusiasta los gasta en un turno.
 */
export function buildVaultImageInstruction(): string {
  return [
    'Puedes generar UNA imagen del personaje cuando el usuario la pida o cuando aporte algo.',
    'No puedes adjuntar ni recuperar archivos: lo unico que puedes hacer es generar una imagen',
    'nueva con este bloque. Si te piden una foto tuya, generala en vez de decir que no puedes.',
    'Para hacerlo, añade este bloque al final de tu respuesta, antes del bloque de memoria.',
    'Escribe en `prompt` una descripcion visual de la escena, no el mensaje del usuario.',
    'Describe solo lo que se ve. Si no hace falta ninguna imagen, no escribas el bloque.',
    VAULT_IMAGE_OPEN,
    '{"prompt":"descripcion visual de la escena","kind":"image"}',
    VAULT_IMAGE_CLOSE,
  ].join('\n');
}

/** separa el bloque del texto visible. Nunca lanza: una peticion mala no rompe el turno */
export function parseVaultImageRequest(text: string): ParsedVaultImageRequest {
  const openAt = text.lastIndexOf(VAULT_IMAGE_OPEN);
  if (openAt < 0) return { visibleText: text.trim(), request: null, status: 'absent' };

  const contentAt = openAt + VAULT_IMAGE_OPEN.length;
  const closeAt = text.indexOf(VAULT_IMAGE_CLOSE, contentAt);
  const before = text.slice(0, openAt).trim();
  // el bloque empezo y no se cerro: la respuesta se corto dentro de el. No se
  // adivina el contenido; se dice que se corto y se conserva lo que si llego
  if (closeAt < 0) return { visibleText: before, request: null, status: 'truncated_block' };

  const after = text.slice(closeAt + VAULT_IMAGE_CLOSE.length).trim();
  const visibleText = [before, after].filter((part) => part.length > 0).join('\n\n');

  try {
    const raw: unknown = JSON.parse(stripFence(text.slice(contentAt, closeAt)));
    const parsed = vaultImageRequestSchema.safeParse(raw);
    if (parsed.success) return { visibleText, request: parsed.data, status: 'structured' };
  } catch {
    // un bloque mal formado no puede ocultar la respuesta util que lo acompaña
  }
  return { visibleText, request: null, status: 'invalid' };
}

/** el modelo a veces envuelve el JSON en una cerca Markdown aunque se le pida que no */
function stripFence(block: string): string {
  const trimmed = block.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  return trimmed
    .replace(/^```[a-zA-Z]*\s*/, '')
    .replace(/```$/, '')
    .trim();
}
