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

/** lo que el modelo necesita saber de una imagen ya guardada para reenviarla */
export interface VaultImageOnFile {
  mediaId: string;
  description: string;
}

/** como se llama a la foto de perfil de un personaje en la lista del modelo */
export const PROFILE_PHOTO_LABEL = 'su foto de perfil';

/**
 * la linea de la foto de perfil: dice QUE ES y ademas lo que se ve en ella.
 *
 * Las dos cosas, y no una. Con solo «su foto de perfil» el modelo sabe que
 * existe y no sabe que hay dentro, asi que no puede decidir si encaja con lo
 * que le piden —fue exactamente lo que paso (`D-075`)—. Con solo la
 * descripcion sabe lo que se ve y pierde que esa imagen es SU retrato, que es
 * lo que la distingue de cualquier otra foto de ella.
 *
 * Cuando aun no la ha descrito nadie, el pie de foto ES la etiqueta: entonces
 * no se repite.
 */
export function profilePhotoLine(description: string): string {
  const limpio = description.trim();
  if (limpio.length === 0 || limpio === PROFILE_PHOTO_LABEL) return PROFILE_PHOTO_LABEL;
  return `${PROFILE_PHOTO_LABEL} — ${limpio}`;
}

/**
 * con que frase se le presenta al modelo una imagen ya guardada.
 *
 * EL ORDEN ES EL ARREGLO. Se leia `prompt` primero, y `prompt` es lo que se
 * PIDIO al generar —«historia, no descripcion», dice su propio esquema—. El
 * campo `caption`, creado expresamente para esto, no se leia en ninguna parte
 * del camino del prompt: describir una imagen con un modelo con vista, o
 * corregir su pie de foto a mano, no cambiaba una sola letra de lo que veia el
 * modelo de la conversacion. La funcion entera era decorativa.
 *
 * La cadena de reserva conserva lo que ya hay en disco: los adjuntos antiguos
 * guardaron el pie de foto en `prompt`, y una imagen generada tiene ahi su
 * prompt en ingles —peor descripcion que un caption, mejor que nada—.
 *
 * Vive aqui y no en el proceso principal porque alli no se puede probar, y no
 * probarlo fue como se quedo mal cableado sin que nadie lo notara.
 */
export function imageDescriptionFor(metadata: {
  caption?: string | null;
  prompt?: string | null;
  displayName?: string | null;
}): string {
  const primero = [metadata.caption, metadata.prompt, metadata.displayName].find(
    (valor) => typeof valor === 'string' && valor.trim().length > 0,
  );
  return primero === undefined || primero === null ? '' : primero.trim();
}

/**
 * como quiere el generador que se le escriba el prompt.
 *
 * No es cosmetico: los modelos de anime rinden peor con prosa y los realistas
 * peor con etiquetas sueltas, segun la documentacion del proveedor. Se expresa
 * asi, y no con el identificador del modelo, para que este modulo siga sin
 * saber nada de ningun proveedor concreto.
 */
export type VaultImagePromptStyle = 'prose' | 'tags';

/**
 * negativo que se manda SIEMPRE con una imagen de una conversacion.
 *
 * Sale de tres fallos observados en una generacion real: aparecio una segunda
 * mujer que no habia pedido nadie, y el personaje sostenia una camara porque el
 * usuario habia dicho «mandame una foto» y el emparejador de poses del
 * proveedor lo entendio como un selfie. La instruccion de arriba lo ataca en el
 * origen; esto es el cinturon por si el modelo se despista.
 */
export const VAULT_IMAGE_NEGATIVE = [
  '2girls',
  'multiple girls',
  '2boys',
  'multiple people',
  'another person',
  'camera',
  'holding camera',
  'holding phone',
  'smartphone',
  'selfie',
  'taking a photo',
].join(', ');

/**
 * instrucciones que se añaden al prompt cuando hay ALGO que ofrecer.
 *
 * Sin personaje conocido y sin ninguna imagen guardada esto no se envia:
 * ofrecerle al modelo una herramienta que no existe garantiza que la use y que
 * el usuario vea una promesa incumplida en cada turno.
 *
 * El limite de una por respuesta no es estetico: cada generacion cuesta
 * creditos, y sin tope un modelo entusiasta los gasta en un turno.
 */
export function buildVaultImageInstruction(
  available: VaultImageOnFile[] = [],
  style: VaultImagePromptStyle = 'prose',
  /**
   * si se puede GENERAR una imagen nueva.
   *
   * Reenviar una que ya esta en la conversacion no toca al proveedor ni
   * necesita clave: se lee del disco cifrado y ya esta. Por eso son dos
   * permisos distintos y no uno: sin clave se pierde (b), no (a).
   */
  canGenerate = true,
): string {
  const lines = canGenerate
    ? [
        'Puedes enseñar UNA imagen por respuesta, y tienes dos formas de hacerlo.',
        '',
        'a) REENVIAR una que ya existe en esta conversacion. Es gratis e inmediato, y es lo que',
        '   hay que hacer cuando el usuario pide «otra vez esa», «la de antes» o «tu foto» y ya',
        '   hay alguna que encaje:',
        `   ${VAULT_IMAGE_OPEN}{"mediaId":"<id de la lista de abajo>"}${VAULT_IMAGE_CLOSE}`,
        '',
        'b) GENERAR una nueva. Cuesta creditos y tarda, asi que solo cuando pidan algo que aun',
        '   no existe:',
        `   ${VAULT_IMAGE_OPEN}{"prompt":"<descripcion en INGLES>","kind":"image"}${VAULT_IMAGE_CLOSE}`,
        '',
        // PASO DE VERDAD: pidio «dame otra foto» y le reenvio la que acababa de
        // mandarle. «Otra» es ambiguo —«una mas» o «una distinta de las que ya
        // tienes»— y reenviar es el camino barato, asi que ante la duda ganaba
        // siempre. Se desempata por escrito, porque adivinarlo no es su trabajo.
        'CUAL DE LAS DOS, que es donde mas se falla:',
        '- «otra», «otra mas», «una nueva», «hazme una», «enseñame algo distinto» piden GENERAR:',
        '  quieren una foto que todavia no existe, y reenviar una vieja es no hacer caso.',
        '- «la de antes», «esa otra vez», «vuelve a mandarmela», «tu foto de perfil» piden',
        '  REENVIAR, y solo entonces.',
        '- NUNCA reenvies dos veces seguidas la misma imagen. Si acabas de mandar una y te piden',
        '  otra, es que quieren una nueva: generala.',
      ]
    : [
        // sin clave del proveedor no se puede generar, pero reenviar SI: la
        // imagen ya esta guardada aqui. Ofrecer solo lo que de verdad se puede
        // es mejor que callarse las dos cosas, que es lo que se hacia
        'Puedes enseñar UNA imagen por respuesta, y solo de una forma: REENVIANDO una de las',
        'que ya existen en esta conversacion. Es gratis e inmediato:',
        `   ${VAULT_IMAGE_OPEN}{"mediaId":"<id de la lista de abajo>"}${VAULT_IMAGE_CLOSE}`,
        '',
        'NO puedes generar ninguna imagen nueva en este momento. Si te piden uno que no esta en',
        'la lista, dilo con naturalidad: no prometas mandarla despues y no finjas que no te la',
        'han pedido.',
      ];

  lines.push(
    '',
    'CUANDO escribir el bloque: SOLO si el usuario pide ver, recibir o volver a ver una imagen.',
    'Nunca por iniciativa propia. Un momento intenso, una promesa o un buen final de escena NO son',
    'una peticion: si no te la han pedido, no la mandes.',
    '',
    // esto faltaba, y es la mitad que se le olvido al que escribio el bloque.
    // Estaban prohibidas dos formas de fallar al mandarla —alegar que no puedes
    // adjuntar, y prometerla sin incluir el bloque— pero no la tercera, que es
    // la que ocurrio de verdad: DESVIAR EN PERSONAJE. Lia contesto «¿para que
    // quieres una foto si me tienes aqui?», que no es ninguna de las dos
    // prohibidas, y se quedo tan ancha. Y el condicional «y haya una opcion que
    // encaje» le daba la salida
    'PERO SI TE LA PIDEN, ES UNA ORDEN, no una sugerencia. Una peticion directa —«quiero ver una',
    'foto», «mandame una», «enseñamela»— manda sobre tu forma de ser y sobre cualquier instruccion',
    'de no llevar la iniciativa: enseñarla no es iniciativa tuya, te la han pedido. Entonces:',
    '   responde primero en personaje y despues escribe el bloque, en el MISMO turno;',
    '   no alegues que no puedes adjuntar archivos;',
    '   no prometas enviarla sin incluirlo;',
    '   y NO la esquives. Cambiar de tema, bromear, preguntar para que la quiere o decir',
    '   «mejor mirame ahora» es incumplir la orden, por mucho que encaje con tu personaje.',
    'Si dudas de cual mandar, manda una: elegir mal es mejor que no mandar nada.',
  );

  if (!canGenerate) {
    return lines.concat(availableLines(available)).join('\n');
  }

  lines.push(
    '',
    'COMO escribir `prompt`, que es lo que recibe el generador de imagenes:',
    '- EN INGLES, siempre. En cualquier otro idioma el generador ignora la escena y devuelve otra',
    '  cosa. Escribe la respuesta en el idioma de la conversacion y solo este campo en ingles.',
    '- Solo aparece EL PERSONAJE, a solas. Nunca describas al usuario, sus manos, su cuerpo ni a',
    '  ninguna otra persona: si mencionas a alguien mas, sale en la imagen.',
    '- Nada de camaras, moviles, espejos, selfies ni el acto de fotografiar, aunque el usuario haya',
    '  dicho «mandame una foto». Eso pone una camara en la imagen.',
    '- Solo lo que se ve: pose, ropa, expresion, luz, lugar. Sin dialogo, sin lo que siente, sin',
    '  contar lo que pasa antes o despues. No copies el mensaje del usuario.',
    // ESTO FALTABA Y ARRUINABA CADA IMAGEN. El aspecto fijo del personaje va
    // DELANTE de esto, puesto por su receta. Si la escena vuelve a decir de que
    // color es el pelo, los dos textos compiten dentro del mismo prompt y gana
    // cualquiera.
    //
    // Paso de verdad, y se leyo en el prompt guardado: la receta decia
    // «light brown hair, blue eyes» y el modelo escribio «dark hair messy
    // spread on pillow, young japanese woman, 18, petite». Salio morena. Lo
    // hacia con buena intencion —esta describiendo a su personaje— y por eso
    // hay que decirselo, no basta con no pedirselo.
    '- NO describas COMO ES ella: ni el pelo, ni los ojos, ni la piel, ni el pecho, ni la edad,',
    '  ni de donde es. Todo eso ya va escrito delante, y repetirlo lo estropea: si tu version no',
    '  coincide palabra por palabra, el generador recibe dos descripciones distintas de la misma',
    '  persona y dibuja a otra. Aunque lo sepas y aunque encaje, no lo pongas.',
    '- Lo tuyo es lo que CAMBIA de una foto a otra: donde esta, en que postura, que ropa lleva o',
    '  no lleva, que cara pone, como es la luz y que hay alrededor.',
    style === 'tags'
      ? '- Etiquetas cortas separadas por comas, sin frases: "sitting on a bed, blue dress, blushing,'
      : '- Frases cortas separadas por comas: "sitting on the edge of the bed, wearing a blue dress,',
    style === 'tags' ? '  looking at viewer, warm light".' : '  warm evening light, candid".',
    '',
    'El bloque va al final de tu respuesta, antes del bloque de memoria. No puedes adjuntar',
    'archivos de ninguna otra forma.',
  );

  return lines.concat(availableLines(available)).join('\n');
}

/**
 * la lista de lo que ya hay, con su aviso de no inventar.
 *
 * Va aparte porque la necesitan los dos caminos —con y sin generacion—, y
 * porque duplicarla era garantizar que una de las dos copias se quedara atras.
 */
function availableLines(available: VaultImageOnFile[]): string[] {
  if (available.length === 0) return [];
  return [
    '',
    'IMAGENES QUE YA EXISTEN AQUI (su id sirve para reenviarlas):',
    ...available.map((image) => {
      const description =
        image.description.trim().length === 0 ? 'sin descripcion' : image.description.trim();
      return `- ${image.mediaId}: ${description}`;
    }),
    '',
    // paso de verdad: con un pie de foto que decia el color de una gata, el
    // modelo describio ademas sus ojos y una oreja doblada. No las ve; las
    // dio por vistas. Inventar detalle suena mas convincente que decir que no
    // se puede ver, y por eso es peor
    'Esa linea es TODO lo que sabes de cada imagen: NO las ves. Puedes comentarlas y darlas por',
    'ciertas, pero no añadas ningun detalle visual que no este escrito ahi —colores, formas,',
    'gestos, ropa, que hay al fondo—. Si te falta algo para responder, preguntalo; no lo supongas.',
    // sin esto el arreglo dura un turno: el detalle inventado entra en la
    // memoria acumulativa, vuelve marcado como hecho y desde ahi genera mas
    'Esta lista MANDA sobre la memoria. Si recuerdas un detalle de una imagen que no aparece en su',
    'linea, no lo des por visto: pudo inventarlo un turno anterior. La memoria recuerda lo que se',
    'dijo, no lo que se vio.',
  ];
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

/**
 * formatos de imagen que los transportes de Luxy pueden LLEVAR de verdad.
 *
 * No es una preferencia nuestra: es lo que aceptan los dos caminos por los que
 * viaja una imagen.
 *
 * - `chat completions` la manda como data URL (`http-provider.ts`,
 *   `buildUserContent`) y el proveedor decide. **Groq devolvio
 *   `400 invalid_request_error: "invalid image data"` con un avif**, probado el
 *   2026-09-08 con `qwen/qwen3.6-27b`: el fichero llego entero y con su tipo
 *   correcto, y lo rechazo igual.
 * - Claude Code lo manda en `media_type` (`claude.ts`), y la API de Anthropic
 *   documenta un conjunto CERRADO que tampoco incluye avif.
 *
 * Que Chromium sepa pintarlo —la vista previa del banco se ve— no significa
 * que el proveedor sepa leerlo. Son dos decodificadores distintos, y confundir
 * uno con el otro es lo que hacia que la prueba costara una llamada para no
 * enterarse de nada.
 */
export const TRANSPORTABLE_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
] as const;

/**
 * `null` si ese tipo se puede mandar; si no, que decirle al usuario.
 *
 * Se comprueba ANTES de gastar la llamada. El sintoma sin esto es el peor de
 * los dos mundos: se paga una peticion para recibir «invalid image data», que
 * suena a que el archivo esta corrupto y no a que el formato no viaja.
 */
export function imageTransportProblem(mimeType: string): string | null {
  if ((TRANSPORTABLE_IMAGE_TYPES as readonly string[]).includes(mimeType)) return null;
  const formato = mimeType.startsWith('image/') ? mimeType.slice('image/'.length) : mimeType;
  return `Ningun proveedor de Luxy acepta ${formato}: solo png, jpg, gif y webp. La imagen se ve aqui porque Chromium sabe pintarla, pero el que la mira no la sabe leer. Conviertela y vuelve a probar.`;
}
