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
export const vaultImageRequestSchema = z
  .object({
    prompt: z.string().min(1).max(2000).optional(),
    kind: z.enum(['image', 'video']).default('image'),
    /**
     * reenviar una imagen que YA existe en la conversacion, en vez de generar.
     *
     * Generar cuesta creditos y tarda; volver a enseñar algo que ya se hizo no
     * cuesta nada. Sin esta via, pedir «mandame otra vez la de antes» acababa
     * pagando una imagen nueva y ademas distinta.
     */
    mediaId: z.string().max(128).optional(),
  })
  // una cosa o la otra: con las dos no se sabe que se quiere, y sin ninguna no
  // se esta pidiendo nada
  .refine((value) => (value.prompt === undefined) !== (value.mediaId === undefined), {
    message: 'indica `prompt` para generar o `mediaId` para reenviar, no las dos',
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
/** lo que el modelo necesita saber de una imagen ya guardada para reenviarla */
export interface VaultImageOnFile {
  mediaId: string;
  description: string;
}

export function buildVaultImageInstruction(available: VaultImageOnFile[] = []): string {
  const lines = [
    'Puedes enseñar UNA imagen por respuesta, y tienes dos formas de hacerlo.',
    '',
    'a) REENVIAR una que ya existe en esta conversacion. Es gratis e inmediato, y es lo que',
    '   hay que hacer cuando el usuario pide «otra vez esa», «la de antes» o «tu foto» y ya',
    '   hay alguna que encaje:',
    `   ${VAULT_IMAGE_OPEN}{"mediaId":"<id de la lista de abajo>"}${VAULT_IMAGE_CLOSE}`,
    '',
    'b) GENERAR una nueva. Cuesta creditos y tarda, asi que solo cuando pidan algo que aun',
    '   no existe. En `prompt` va una descripcion visual de la escena, solo lo que se ve;',
    '   no copies el mensaje del usuario:',
    `   ${VAULT_IMAGE_OPEN}{"prompt":"descripcion visual de la escena","kind":"image"}${VAULT_IMAGE_CLOSE}`,
    '',
    'El bloque va al final de tu respuesta, antes del bloque de memoria. No puedes adjuntar',
    'archivos de ninguna otra forma: si no escribes el bloque, no se enseña nada. Si no hace',
    'falta ninguna imagen, no lo escribas.',
  ];

  if (available.length > 0) {
    lines.push(
      '',
      'IMAGENES QUE YA EXISTEN AQUI (su id sirve para reenviarlas):',
      ...available.map((image) => {
        const description =
          image.description.trim().length === 0 ? 'sin descripcion' : image.description.trim();
        return `- ${image.mediaId}: ${description}`;
      }),
    );
  }

  return lines.join('\n');
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
