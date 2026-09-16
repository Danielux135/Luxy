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
import { trimWithMark } from './vault-describe.js';

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
 * lo que el modelo necesita saber de una imagen ya guardada para reenviarla.
 *
 * EL ORDEN ES PARTE DEL DATO: de la mas antigua a la mas reciente. La lista no
 * lleva fecha ni numero —200 caracteres por imagen es todo el presupuesto—, asi
 * que sin un orden declarado «la ultima» no se puede resolver, y ese es
 * justamente uno de los determinantes que mandan reenviar. El bloque se lo dice
 * al modelo en su cabecera, de modo que quien la construya tiene que ordenarla:
 * lo hace `PrivateMediaStore.list`, porque el indice es un JSONL que se añade
 * al final y la sincronizacion escribe lo que baja de otro equipo en el orden
 * del listado remoto, no por fecha.
 */
export interface VaultImageOnFile {
  mediaId: string;
  description: string;
}

/**
 * cuanto ocupa como mucho la linea de UNA imagen en el prompt.
 *
 * MEDIDO, no elegido a ojo. Al guardar el prompt compuesto entero, cada imagen
 * generada aportaba ~308 tokens a esta lista: con once imagenes eran 3.388
 * tokens, el 36% de todo lo que se le enviaba al modelo en un turno real.
 *
 * Doscientos caracteres bastan para distinguir una foto de otra, que es para lo
 * que existe la lista. Y hay un incentivo bueno: un pie de foto de verdad
 * —escrito por el describidor o a mano— es mas corto Y mas util que el prompt
 * de generacion, asi que describir las imagenes mejora las dos cosas a la vez.
 */
export const MAX_IMAGE_LINE_CHARS = 200;

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
  if (primero === undefined || primero === null) return '';
  // el negativo NO describe la imagen: dice lo que se pidio evitar. Va detras
  // de ' ### ' porque el horde no tiene campo aparte, y arrastrarlo aqui suma
  // cien tokens por imagen que no ayudan a elegir ninguna
  const sinNegativo = primero.split(' ### ')[0] ?? primero;
  return trimWithMark(sinNegativo.trim(), MAX_IMAGE_LINE_CHARS, '…');
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
 * lo que se le dice cuando la imagen que ofrecio sigue sin salir.
 *
 * Con la revision puesta, el turno TERMINA sin generar: el texto se compone, se
 * apunta y espera a que una persona lo apruebe. Para ella eso es invisible —su
 * turno guarda lo que escribio y nada mas—, asi que sin esta nota el turno
 * siguiente se construye sobre una mentira: ella ya dijo «toma, mirame» y el
 * usuario no ha visto ninguna foto.
 *
 * Es el mismo agujero que `lastError` tapa para los fallos, y por eso se dice
 * igual de claro: no la ha visto NADIE.
 */
export const VAULT_IMAGE_PENDING_NOTICE = [
  'AVISO: la imagen que ofreciste en tu turno anterior NO ha salido. Quedo esperando a que el',
  'usuario decida si se manda, y el no la ha visto nunca.',
  'No la des por mandada ni describas lo que se ve en ella. Si te pregunta por ella, dilo tal',
  'cual: que todavia no le ha llegado.',
].join('\n');

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
  /**
   * la imagen del turno anterior no llego a generarse, y por que.
   *
   * `null` cuando la anterior salio bien o no hubo ninguna, que es lo normal.
   */
  lastError: string | null = null,
): string {
  // reenviar solo existe si hay algo que reenviar. Sin nada guardado se
  // enviaban igual el apartado a) y CUAL DE LAS DOS entero —702 caracteres, el
  // 14% del bloque— mandando elegir entre dos vias cuando solo hay una, y
  // apuntando dos veces a «la lista de abajo», que en ese camino no se imprime
  const canResend = available.length > 0;
  const lines = !canGenerate
    ? [
        // sin clave del proveedor no se puede generar, pero reenviar SI: la
        // imagen ya esta guardada aqui. Ofrecer solo lo que de verdad se puede
        // es mejor que callarse las dos cosas, que es lo que se hacia
        'Puedes enseñar UNA imagen por respuesta, y solo de una forma: REENVIANDO una de las',
        'que ya existen en esta conversacion. Es gratis e inmediato:',
        `   ${VAULT_IMAGE_OPEN}{"mediaId":"<id de la lista de abajo>"}${VAULT_IMAGE_CLOSE}`,
        '',
        // «uno» era una errata de concordancia —imagen, foto, mandarla, son
        // femeninas— y estaba en un camino que casi no se imprimia: solo sin
        // clave o sin personaje. Con la puerta este bloque pasa a ser el de la
        // mayoria de los turnos, asi que es el texto que se lee a diario
        'NO puedes generar ninguna imagen nueva en este momento. Si te piden una que no esta en',
        // y NOMBRANDO la foto, no «con naturalidad» a secas. De eso depende algo
        // concreto: el turno siguiente la puerta mira si el tema sigue abierto,
        // y una evasiva en personaje —«Ahora mismo no puedo, amor»— no nombra
        // nada. Decir «ahora no puedo mandarte una nueva» deja el tema abierto
        // y hace que insistir funcione
        'la lista, dilo nombrando la foto —«ahora no puedo mandarte una nueva»—: no prometas',
        'mandarla despues y no finjas que no te la han pedido.',
      ]
    : !canResend
      ? [
          'Puedes enseñar UNA imagen por respuesta, y solo de una forma: GENERANDOLA. En esta',
          'conversacion todavia no hay ninguna guardada, asi que no hay nada que reenviar:',
          `   ${VAULT_IMAGE_OPEN}{"prompt":"<descripcion en INGLES>","kind":"image"}${VAULT_IMAGE_CLOSE}`,
        ]
      : [
          'Puedes enseñar UNA imagen por respuesta, y tienes dos formas de hacerlo.',
          '',
          // los ejemplos de cuando toca reenviar estaban aqui Y otra vez en CUAL
          // DE LAS DOS, y las dos copias no decian lo mismo: aqui el criterio era
          // «y ya hay alguna que encaje» —semantico— y alli «y solo entonces»
          // sobre una lista cerrada de cuatro frases. Una sola copia, la de abajo
          'a) REENVIAR una que ya existe en esta conversacion. Es gratis e inmediato:',
          `   ${VAULT_IMAGE_OPEN}{"mediaId":"<id de la lista de abajo>"}${VAULT_IMAGE_CLOSE}`,
          '',
          'b) GENERAR una nueva. Cuesta creditos y tarda, asi que solo cuando pidan algo que aun',
          '   no existe, o cuando el haga una foto (ver CUANDO, caso 2):',
          `   ${VAULT_IMAGE_OPEN}{"prompt":"<descripcion en INGLES>","kind":"image"}${VAULT_IMAGE_CLOSE}`,
          '',
          // PASO DE VERDAD: pidio «dame otra foto» y le reenvio la que acababa de
          // mandarle. «Otra» es ambiguo —«una mas» o «una distinta de las que ya
          // tienes»— y reenviar es el camino barato, asi que ante la duda ganaba
          // siempre. Se desempata por escrito, porque adivinarlo no es su trabajo.
          //
          // SEGUNDO PASO DE VERDAD, y es el contrario: «Mira la ultima foto que te
          // he hecho durmiendo», con esa foto YA guardada. Ella la identifico y la
          // describio bien —no fallo la comprension— y ademas genero una nueva, que
          // llego distinta y rompio la escena. Fallo por dos motivos que se suman:
          // este apartado cerraba el reenvio con «y solo entonces» sobre una lista
          // de cuatro frases que no incluia «la ultima», y el caso 2 de mas abajo
          // tenia un ejemplo casi calcado de esa frase.
          //
          // El desempate es la LISTA, no las palabras sueltas: si la foto de la
          // que habla ya esta guardada, se reenvia; generar es para lo que aun no
          // existe. Por eso aqui van determinantes —«la ultima», «la de antes»— y
          // no formas verbales: «te he hecho» tambien es lo que se dice en
          // castellano de la foto que se acaba de hacer en este mismo mensaje, y
          // esa hay que generarla (`D-086`).
          'CUAL DE LAS DOS, que es donde mas se falla:',
          '- «otra», «otra mas», «una nueva», «hazme una», «enseñame algo distinto» piden GENERAR:',
          '  quieren una foto que todavia no existe, y reenviar una vieja es no hacer caso.',
          '- «la de antes», «esa otra vez», «la ultima», «vuelve a mandarmela», «tu foto de perfil»',
          '  piden REENVIAR: nombran una que YA existe. Buscala en la lista de abajo y manda su id.',
          '  Solo si ninguna encaja, generala.',
          // el «NUNCA» de antes era incondicional y se comia la familia de
          // frases en que repetir la misma imagen es justo lo que se pide —«no
          // me ha llegado», «no me carga, ponla otra vez»—, que ademas esta dos
          // lineas mas arriba del lado del reenvio. Acotado a «otra», que es la
          // palabra del fallo real, la contradiccion desaparece y ocupa menos
          '- Si acabas de mandar una y te piden «otra», quieren una NUEVA: generala, no repitas esa.',
        ];

  if (lastError !== null) {
    // PASO DE VERDAD: fallo una generacion, ella no se entero, y cuando el
    // usuario dijo «no me ha llegado, mandame otra igual» copio el prompt de
    // la ultima imagen GUARDADA —una vieja, porque la fallida nunca se
    // guardo— y devolvio aquella escena, que ya no tenia nada que ver.
    lines.push(
      '',
      'AVISO: la imagen que pediste en tu turno anterior NO llego a generarse. El usuario no la',
      `ha visto nunca. Motivo tecnico: ${lastError}`,
      'Si te pide «otra igual» o dice que no le llego, se refiere a ESA, la que intentaste y no',
      'salio: vuelve a describir aquella escena. NO copies el prompt de una imagen mas antigua de',
      'la lista solo porque sea la ultima que quedo guardada.',
    );
  }

  // PASO DE VERDAD: «me incorporo y le saco una foto mientras duerme». Ella lo
  // entendio, reacciono en personaje y NO la genero, porque la regla solo
  // contaba «el usuario pide ver una imagen», y hacer una foto no es pedirla.
  // Solo salio cuando el dijo «la he borrado, dame una nueva». Una foto hecha
  // DENTRO de la escena es una imagen que tiene que existir: la de su camara
  //
  // De aqui se han quitado dos cosas, por el fallo contrario del 2026-09-14:
  //
  // - el ejemplo «te hago una mientras duermes», que juntaba las dos piezas de
  //   la frase que fallo —el verbo de hacer una foto y el complemento de
  //   dormir— y se leia como permiso para generar ante «la foto que te he hecho
  //   durmiendo». El ejemplo canonico de `D-086` («le saco una foto mientras
  //   duerme») sigue entero: es el que manda y el unico que hace falta;
  // - la regla «si mira una foto que te acaba de hacer y no esta en la lista,
  //   es que no llego a generarse: generala», que adivinaba del texto del
  //   usuario lo que el parametro `lastError` ya sabe de cierto, y que ante la
  //   misma frase mandaba lo contrario que la linea de encima. Dos reglas que
  //   se contradicen son una moneda al aire en cada turno; un dato cierto gana
  //   siempre a una adivinanza. Lo poco que cubria de mas —el bloque cortado o
  //   invalido— se tapa apuntando el error donde ya se apunta, no aqui
  //
  // Y lo que separa los dos casos es CUANDO se hace la foto, no el tiempo
  // verbal. La primera version de este arreglo escribia «el caso 2 es siempre
  // el PRESENTE», y eso reabria `D-086` por la otra conjugacion: en castellano
  // peninsular el preterito perfecto es la forma normal de contar lo que acaba
  // de pasar, asi que «*click* ya te he hecho la foto» describe una foto que
  // NO existe todavia y hay que generar. Con una foto parecida ya guardada
  // —lo normal en una conversacion larga— aquella regla la mandaba a reenviar
  // la vieja: una imagen equivocada, que es el daño exacto del 2026-09-14
  lines.push(
    '',
    ...(canGenerate
      ? [
          'CUANDO escribir el bloque, en DOS casos y solo en esos:',
          '1. el usuario pide ver, recibir o volver a ver una imagen;',
          '2. el usuario HACE UNA FOTO en este turno, dentro de la escena, y sales tu en ella («te',
          '   saco una foto», «levanto el movil y disparo»). No la pide, pero tiene que existir:',
          '   GENERALA. Si salis los dos, o os la hace otra persona, generala solo contigo, en plano',
          '   cercano y sin el. Si solo se fotografia a si mismo, o solo lo dice o lo recuerda («ayer',
          '   te hice una», «voy a hacerte una»), no. Lo que decide es CUANDO se hace la foto, no el',
          '   tiempo verbal: la de antes de este mensaje («la ultima», «esa») es del caso 1; la que',
          '   hace aqui es del 2, aunque escriba «ya te he hecho una».',
          'Fuera de esos dos casos, nunca por iniciativa propia: un momento intenso, una promesa o un',
          'buen final de escena NO cuentan. Que el haga la foto no es iniciativa tuya, es el caso 2:',
          'reaccionas en personaje y escribes el bloque en el MISMO turno.',
          // EL VERBO, restituido. Hasta el commit `42146e1` la frase entera era
          // «Nunca por iniciativa propia. Un momento intenso, una promesa o un
          // buen final de escena NO son una peticion: si no te la han pedido, no
          // la mandes». El arreglo de `D-086` la partio en dos caminos y la
          // orden se quedo SOLO en el que no puede generar, donde no sirve de
          // nada: el camino que si puede generar se quedo con el adjetivo («NO
          // cuentan») y sin el verbo.
          //
          // El 2026-09-15 el modelo genero dos imagenes sin que nadie las
          // pidiera —un cierre de escena con ternura y una escena de caricias—,
          // y las dos veces el bloque decia «NO cuentan» y ninguna decia «no la
          // mandes». Va DESPUES del caso 2 a proposito: ese orden es lo que
          // arreglo `D-086`, y nombrar los dos casos aqui evita reabrirlo
          'Si no te la han pedido y no la ha hecho el en este mensaje, no la mandes.',
        ]
      : [
          'CUANDO escribir el bloque: SOLO si el usuario pide ver, recibir o volver a ver una imagen.',
          'Nunca por iniciativa propia. Un momento intenso, una promesa o un buen final de escena NO',
          'son una peticion: si no te la han pedido, no la mandes.',
        ]),
    '',
    // esto faltaba, y es la mitad que se le olvido al que escribio el bloque.
    // Estaban prohibidas dos formas de fallar al mandarla —alegar que no puedes
    // adjuntar, y prometerla sin incluir el bloque— pero no la tercera, que es
    // la que ocurrio de verdad: DESVIAR EN PERSONAJE. Lia contesto «¿para que
    // quieres una foto si me tienes aqui?», que no es ninguna de las dos
    // prohibidas, y se quedo tan ancha. Y el condicional «y haya una opcion que
    // encaje» le daba la salida
    'PERO SI TE LA PIDEN, ES UNA ORDEN, no una sugerencia. Una peticion directa —«quiero ver una',
    // acotado a ESTA instruccion, que es lo que queria decir. «Cualquier
    // instruccion de no llevar la iniciativa» sonaba a permiso general para
    // saltarse el freno, y el freno de dos lineas mas arriba es justo una
    // instruccion de no llevar la iniciativa: la frase se autorizaba a ignorarlo
    'foto», «mandame una», «enseñamela»— manda sobre tu forma de ser y sobre esa instruccion',
    'de no llevar la iniciativa: enseñarla no es iniciativa tuya, te la han pedido. Entonces:',
    '   responde primero en personaje y despues escribe el bloque, en el MISMO turno;',
    '   no alegues que no puedes adjuntar archivos;',
    '   no prometas enviarla sin incluirlo;',
    '   y NO la esquives. Cambiar de tema, bromear, preguntar para que la quiere o decir',
    '   «mejor mirame ahora» es incumplir la orden, por mucho que encaje con tu personaje.',
    // «cual» solo existe si hay lista. Sin ninguna imagen guardada esta linea
    // mandaba elegir entre las cero opciones de un menu que no se imprime, y
    // salia igual en los cuatro caminos, incluido el de cero imagenes.
    //
    // Y «de la lista» no es un adorno: el desempate es SIEMPRE entre las
    // guardadas. Sin acotar, en el camino cerrado —que con la puerta es el de
    // la mayoria de los turnos— se leia como «manda una cualquiera», que junto
    // a la orden de no esquivar empuja a reenviar una vieja cuando lo que piden
    // es nueva: el daño exacto del 2026-09-14
    // LA EXCEPCION A LA ORDEN, y solo en el camino cerrado. Aqui coincidian en
    // el mismo bloque un limite dicho en voz baja —«dilo con naturalidad»— y
    // una orden dicha en el tono mas fuerte de todo el texto: ante «mandame una
    // nueva», con cuatro ids delante y sin poder generar, la orden ganaba y la
    // salida natural era reenviar una vieja como si fuera la nueva. Se dice la
    // excepcion en el MISMO registro que la orden, que es lo unico que la hace
    // valer. La orden de no esquivar se queda entera: el hueco que tapo no se
    // reabre
    ...(!canGenerate
      ? ['   pero si lo que te piden NO existe todavia, dilo: no mandes otra en su lugar.']
      : []),
    ...(canResend
      ? ['Si dudas de cual de la lista mandar, manda una: elegir mal es mejor que no mandar nada.']
      : []),
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
    '  dicho «mandame una foto» o aunque la foto la este haciendo el. Eso pone una camara en la',
    '  imagen. Ni siquiera en negativo: «not looking at camera» tambien la dibuja.',
    // PASO DE VERDAD (2026-09-16), dos veces el mismo dia. Daniel pidio la foto
    // «desde detras» tres veces y salio de frente; luego «el culo mirando a
    // camara» y salio de frente otra vez. Faltaban las dos mitades: que lo que
    // el pide MANDA —solo habia dos ejemplos de encuadre y ninguno era el suyo—
    // y que «a camara» no nombra un aparato, dice hacia donde mira, asi que la
    // prohibicion de la linea de arriba se llevaba por delante la frase entera.
    '- Si el usuario dice desde donde la quiere o en que postura, ESO MANDA: es lo unico que ha',
    '  pedido. «desde detras» y «el culo a camara» son «from behind»; «de espaldas», «from behind,',
    '  facing away»; «mirando a camara», «looking at viewer»; «de cerca», «close-up»; «de cuerpo',
    '  entero», «full body»; «desde arriba/abajo/de lado», «from above/below/the side». «A camara»',
    '  NO nombran un objeto: traduce la direccion y no pongas la camara.',
    '- Si no lo dice y la foto la hace el, describe la escena tal como se ve desde donde esta el.',
    '  Si estas dormida o no te das cuenta, dilo con «eyes closed», «asleep» o «looking away».',
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
    // EL NUMERO IMPORTA, y no estaba dicho. Un generador reparte su atencion
    // entre todo lo que se le pone: con trece elementos cada uno recibe una
    // fraccion, y los del final —que es donde caen los detalles concretos— son
    // los que menos. Paso de verdad: una escena de trece pedia «de espaldas,
    // mirando sobre el hombro, camisa caida hasta la cintura, vaqueros
    // bajados», y volvio una foto de frente, vestida y sentada.
    '- OCHO elementos como mucho, y mejor seis. No es una lista de todo lo que pasa: es lo que',
    '  hay que ver. Cada cosa que añades le quita fuerza a las demas.',
    '- El PRIMERO es el que mas pesa, asi que empieza por lo que no puede faltar. Si lo que',
    '  importa es que esta de espaldas, «from behind» va primero, no al final.',
    '- Los estados de ropa se dicen con la etiqueta corta que existe —«open shirt», «off',
    '  shoulder», «undressing»— y no describiendolos: «la camisa se le cae del todo por los',
    '  hombros y se queda en la cintura» no lo entiende, «off shoulder» si.',
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
    // el orden va DICHO. Sin el, «la ultima» —que es de los determinantes que
    // mandan reenviar— no se puede resolver contra una lista sin fecha ni
    // numero: el caso del 2026-09-14 se salvaba de casualidad, porque
    // «durmiendo» casaba con una sola linea. Con dos fotos parecidas volvia a
    // ser una moneda al aire. Decirlo solo vale si es cierto, y por eso la
    // ordena `PrivateMediaStore.list` antes de llegar aqui
    'IMAGENES QUE YA EXISTEN AQUI, de la mas antigua a la mas reciente (su id sirve para reenviarlas):',
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
