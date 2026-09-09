// pruebas de como el modelo pide una imagen.
//
// Todo esto es puro: se prueba cada caso limite sin montar una boveda y, sobre
// todo, **sin gastar una generacion**. Es justo la parte donde un modelo se
// desvia del formato, y donde un fallo silencioso se veria como «pedi una foto
// y no llego» sin ninguna pista.
import { describe, it, expect } from 'vitest';
import {
  VAULT_IMAGE_CLOSE,
  VAULT_IMAGE_NEGATIVE,
  VAULT_IMAGE_OPEN,
  buildVaultImageInstruction,
  PROFILE_PHOTO_LABEL,
  TRANSPORTABLE_IMAGE_TYPES,
  imageTransportProblem,
  imageDescriptionFor,
  profilePhotoLine,
  parseVaultImageRequest,
} from './vault-image-request.js';
import { parseConversationMemoryResponse } from './schemas.js';
import { buildVaultPrompt } from './vault-prompt.js';

const bloque = (json: string): string => `${VAULT_IMAGE_OPEN}\n${json}\n${VAULT_IMAGE_CLOSE}`;

describe('peticion de imagen del modelo', () => {
  it('sin bloque no hay peticion, y el texto queda intacto', () => {
    const parsed = parseVaultImageRequest('Te miro y sonrio.');
    expect(parsed.request).toBeNull();
    expect(parsed.status).toBe('absent');
    expect(parsed.visibleText).toBe('Te miro y sonrio.');
  });

  it('separa el bloque del texto visible', () => {
    const parsed = parseVaultImageRequest(
      `Aqui la tienes.\n\n${bloque('{"prompt":"de pie junto a la ventana","kind":"image"}')}`,
    );
    expect(parsed.status).toBe('structured');
    expect(parsed.request).toEqual({ prompt: 'de pie junto a la ventana', kind: 'image' });
    // el bloque tecnico NO puede acabar guardado como parte de la respuesta
    expect(parsed.visibleText).toBe('Aqui la tienes.');
    expect(parsed.visibleText).not.toContain(VAULT_IMAGE_OPEN);
  });

  it('kind por defecto es imagen', () => {
    const parsed = parseVaultImageRequest(bloque('{"prompt":"un retrato"}'));
    expect(parsed.request?.kind).toBe('image');
  });

  it('acepta video cuando se pide', () => {
    const parsed = parseVaultImageRequest(bloque('{"prompt":"caminando","kind":"video"}'));
    expect(parsed.request?.kind).toBe('video');
  });

  it('tolera que el modelo lo envuelva en una cerca Markdown', () => {
    const parsed = parseVaultImageRequest(
      `${VAULT_IMAGE_OPEN}\n\`\`\`json\n{"prompt":"un retrato"}\n\`\`\`\n${VAULT_IMAGE_CLOSE}`,
    );
    expect(parsed.status).toBe('structured');
    expect(parsed.request?.prompt).toBe('un retrato');
  });

  it('un bloque cortado se distingue de uno que no existia', () => {
    const parsed = parseVaultImageRequest(`Texto util.\n${VAULT_IMAGE_OPEN}\n{"prompt":"a med`);
    // «se corto» y «no lo pidio» acaban igual, pero se arreglan de otra forma
    expect(parsed.status).toBe('truncated_block');
    expect(parsed.request).toBeNull();
    expect(parsed.visibleText).toBe('Texto util.');
  });

  it('un bloque invalido no se traga la respuesta', () => {
    const parsed = parseVaultImageRequest(`Lo que dije.\n\n${bloque('{"prompt":')}`);
    expect(parsed.status).toBe('invalid');
    expect(parsed.request).toBeNull();
    expect(parsed.visibleText).toBe('Lo que dije.');
  });

  it('un prompt vacio no se acepta', () => {
    const parsed = parseVaultImageRequest(bloque('{"prompt":""}'));
    expect(parsed.status).toBe('invalid');
    expect(parsed.request).toBeNull();
  });

  it('reenviar una imagen existente no lleva prompt', () => {
    const parsed = parseVaultImageRequest(bloque('{"mediaId":"med-1"}'));
    // generar cuesta creditos; reenviar lo que ya se hizo no cuesta nada
    expect(parsed.status).toBe('structured');
    expect(parsed.request?.mediaId).toBe('med-1');
    expect(parsed.request?.prompt).toBeUndefined();
  });

  it('pedir las dos cosas a la vez se rechaza', () => {
    const parsed = parseVaultImageRequest(bloque('{"prompt":"algo","mediaId":"med-1"}'));
    // con las dos no se sabe si quiere generar o reenviar
    expect(parsed.status).toBe('invalid');
  });

  it('un bloque sin ninguna de las dos no pide nada', () => {
    expect(parseVaultImageRequest(bloque('{"kind":"image"}')).status).toBe('invalid');
  });

  it('un kind inventado no se acepta', () => {
    const parsed = parseVaultImageRequest(bloque('{"prompt":"algo","kind":"gif"}'));
    expect(parsed.status).toBe('invalid');
  });

  it('el texto de despues del bloque tambien se conserva', () => {
    const parsed = parseVaultImageRequest(
      `Antes.\n${bloque('{"prompt":"x"}')}\nDespues.`,
    );
    expect(parsed.visibleText).toBe('Antes.\n\nDespues.');
  });
});

describe('convivencia con el bloque de memoria', () => {
  it('los dos bloques se separan y no queda ninguno en el texto', () => {
    // el orden real: la imagen antes de la memoria, porque la instruccion de
    // memoria dice que no se escriba nada despues de su bloque
    const respuesta = [
      'Te la mando.',
      bloque('{"prompt":"junto a la ventana","kind":"image"}'),
      '<LUXY_MEMORY>',
      '{"version":1,"summary":"charla","facts":[],"decisions":[],"plan":[],"openQuestions":[],"lessons":[]}',
      '</LUXY_MEMORY>',
    ].join('\n');

    const memoria = parseConversationMemoryResponse(respuesta);
    expect(memoria.status).toBe('structured');

    const imagen = parseVaultImageRequest(memoria.visibleText);
    expect(imagen.status).toBe('structured');
    expect(imagen.request?.prompt).toBe('junto a la ventana');

    // lo que se guarda como turno no lleva ni un bloque tecnico
    expect(imagen.visibleText).toBe('Te la mando.');
    expect(imagen.visibleText).not.toContain('LUXY_');
  });
});

describe('la herramienta solo se ofrece cuando existe', () => {
  const base = { memory: null, turns: [], message: 'hola' };

  it('sin poder generar, el prompt no menciona el bloque', () => {
    const prompt = buildVaultPrompt(base);
    // ofrecerle lo que no existe garantiza que lo use y que el usuario vea una
    // promesa incumplida en cada turno
    expect(prompt).not.toContain(VAULT_IMAGE_OPEN);
  });

  it('pudiendo generar, el prompt lo explica', () => {
    const prompt = buildVaultPrompt({ ...base, canGenerateImage: true });
    expect(prompt).toContain(VAULT_IMAGE_OPEN);
    expect(prompt).toContain(VAULT_IMAGE_CLOSE);
  });

  it('sin poder generar pero CON imagenes guardadas, si se ofrece reenviarlas', () => {
    // reenviar no toca al proveedor ni necesita clave. El mismo turno copia el
    // avatar del personaje a la conversacion para poder reenviarlo, y despues
    // se tiraba la lista que lo contenia: quedaba sin poder enseñar ni su
    // propia foto de perfil
    const prompt = buildVaultPrompt({
      ...base,
      canGenerateImage: false,
      existingImages: [{ mediaId: 'med-1', description: 'su foto de perfil' }],
    });
    expect(prompt).toContain(VAULT_IMAGE_OPEN);
    expect(prompt).toContain('med-1: su foto de perfil');
    expect(prompt).toContain('NO puedes generar');
  });

  it('sin poder generar y sin imagenes, sigue sin mencionarse el bloque', () => {
    // no hay nada que ofrecer: el bloque solo seria ruido y una promesa
    const prompt = buildVaultPrompt({ ...base, canGenerateImage: false, existingImages: [] });
    expect(prompt).not.toContain(VAULT_IMAGE_OPEN);
  });

  it('la instruccion pide describir la escena, no repetir al usuario', () => {
    // sin esto el modelo reenvia el mensaje del usuario como prompt, que casi
    // nunca describe una imagen
    expect(buildVaultImageInstruction()).toContain('No copies el mensaje del usuario');
  });

  it('no se ofrece enviar una imagen que nadie ha pedido', () => {
    // paso de verdad: mando dos fotos sin que se las pidieran, una de ellas en
    // un momento dramatico de la escena. La instruccion empujaba a usar el
    // bloque y no decia en ningun sitio que no lo usara por su cuenta
    const instruction = buildVaultImageInstruction();
    expect(instruction).toContain('SOLO si el usuario pide ver, recibir o volver a ver una imagen');
    expect(instruction).toContain('Nunca por iniciativa propia');
    expect(instruction).toContain('si no te la han pedido, no la mandes');
  });

  it('el prompt del generador se pide en ingles', () => {
    // su documentacion es explicita: en otro idioma el generador ignora la
    // escena. La instruccion estaba escrita en español y no lo decia
    const instruction = buildVaultImageInstruction();
    expect(instruction).toContain('EN INGLES');
    expect(instruction).toContain('solo este campo en ingles');
  });

  it('prohibe la segunda persona y las camaras, que fue lo que salio en la imagen', () => {
    // una generacion real devolvio al personaje correcto con una mujer de mas
    // en el encuadre y una camara en la mano: el usuario habia dicho «mandame
    // una foto» y eso acaba emparejando con la pose «selfie» del proveedor
    const instruction = buildVaultImageInstruction();
    expect(instruction).toContain('Solo aparece EL PERSONAJE, a solas');
    expect(instruction).toContain('si mencionas a alguien mas, sale en la imagen');
    expect(instruction).toContain('Nada de camaras, moviles, espejos, selfies');
  });

  it('el estilo del prompt sigue al modelo del personaje', () => {
    // los modelos de anime rinden peor con prosa y al reves, segun su doc
    expect(buildVaultImageInstruction([], 'tags')).toContain('Etiquetas cortas separadas por comas');
    expect(buildVaultImageInstruction([], 'prose')).toContain('Frases cortas separadas por comas');
    expect(buildVaultImageInstruction([], 'tags')).not.toContain('Frases cortas');
  });

  it('el negativo cubre la segunda persona y la camara', () => {
    // cinturon por si el modelo se despista: la instruccion lo ataca en el
    // origen, esto lo tapa en el generador
    for (const termino of ['2girls', 'multiple people', 'camera', 'selfie', 'holding phone']) {
      expect(VAULT_IMAGE_NEGATIVE).toContain(termino);
    }
  });

  it('una peticion de foto exige el bloque y una respuesta en personaje', () => {
    const instruction = buildVaultImageInstruction();
    expect(instruction).toContain('responde primero en personaje y despues escribe el bloque');
    expect(instruction).toContain('no alegues que no puedes adjuntar archivos');
    expect(instruction).toContain('no prometas enviarla sin incluirlo');
  });

  it('la descripcion es todo lo que sabe: no puede inventar lo que no ve', () => {
    // paso de verdad: el pie de foto decia «gata blanca con manchas marrones y
    // negras» y el modelo añadio ojos grandes y una oreja doblada, dandolos por
    // vistos. Inventar detalle es peor que decir que no puede ver la imagen,
    // porque suena a observacion
    const instruction = buildVaultImageInstruction([
      { mediaId: 'med-1', description: 'gata blanca con manchas marrones y negras' },
    ]);

    expect(instruction).toContain('TODO lo que sabes de cada imagen: NO las ves');
    expect(instruction).toContain('no añadas ningun detalle visual que no este escrito ahi');
    expect(instruction).toContain('preguntalo; no lo supongas');
  });

  it('la lista manda sobre la memoria, porque la memoria se contamina', () => {
    // paso de verdad, y es el mecanismo importante: el detalle inventado en un
    // turno («una oreja doblada») entro en la memoria acumulativa, volvio
    // marcado como hecho y en el turno siguiente genero mas —ojos amarillos,
    // la cola enroscada—. Una alucinacion que llega a la memoria se blanquea
    const instruction = buildVaultImageInstruction([
      { mediaId: 'med-1', description: 'gata blanca con manchas marrones y negras' },
    ]);

    expect(instruction).toContain('Esta lista MANDA sobre la memoria');
    expect(instruction).toContain('no lo des por visto');
    expect(instruction).toContain('La memoria recuerda lo que se');
  });

  it('sin imagenes que listar no se le advierte de nada', () => {
    // la advertencia acompaña a la lista: sin lista no hay nada que inventar y
    // solo seria ruido en el prompt
    expect(buildVaultImageInstruction()).not.toContain('NO las ves');
  });

  it('sin imagenes previas no se le ofrece reenviar ninguna', () => {
    expect(buildVaultImageInstruction()).not.toContain('IMAGENES QUE YA EXISTEN');
  });

  it('con imagenes previas se las lista para que las reenvie', () => {
    const texto = buildVaultImageInstruction([
      { mediaId: 'med-1', description: 'de pie junto a la ventana' },
      { mediaId: 'med-2', description: '' },
    ]);
    // sin la lista no puede reenviar nada: genera otra, pagando, cada vez que
    // le piden «la de antes»
    expect(texto).toContain('med-1: de pie junto a la ventana');
    expect(texto).toContain('med-2: sin descripcion');
    expect(texto).toContain('gratis');
  });
});

// PASO DE VERDAD. Daniel escribio «Quiero ver una foto» en mitad de una escena
// y Lia contesto «¿para que quieres una foto si me tienes aqui?». No estaba
// bloqueada: tenia personaje en la boveda y clave del horde guardada, asi que
// el bloque SI iba en su prompt.
//
// El bloque prohibia dos formas de fallar —alegar que no puedes adjuntar, y
// prometerla sin incluirla— y se dejaba fuera la tercera, que es la que ocurrio:
// DESVIAR EN PERSONAJE. Encima el permiso estaba condicionado a «y haya una
// opcion que encaje», que le daba la salida cuando la unica imagen existente
// era el avatar y su descripcion decia «su foto de perfil».
describe('una peticion directa manda sobre el personaje', () => {
  it('dice que es una orden, no una sugerencia', () => {
    expect(buildVaultImageInstruction()).toContain('ES UNA ORDEN');
  });

  it('prohibe expresamente esquivarla, que era el hueco', () => {
    const texto = buildVaultImageInstruction();
    expect(texto).toContain('NO la esquives');
    // las tres formas concretas que uso, escritas para que no valga ninguna
    expect(texto).toContain('bromear');
    expect(texto).toContain('preguntar para que la quiere');
  });

  it('desactiva la excusa de «no llevo la iniciativa»', () => {
    // sus instrucciones de personaje decian «no llevas la iniciativa dos turnos
    // seguidos», y el modelo lo aplico a una peticion explicita
    const texto = buildVaultImageInstruction();
    expect(texto).toContain('no llevar la iniciativa');
    expect(texto).toContain('te la han pedido');
  });

  it('ante la duda manda una, en vez de no mandar nada', () => {
    expect(buildVaultImageInstruction()).toContain('elegir mal es mejor que no mandar nada');
  });
});

// reenviar una imagen que YA esta en la conversacion no toca al proveedor ni
// necesita clave: se lee del disco cifrado. Son dos permisos, no uno.
describe('sin poder generar todavia se puede reenviar', () => {
  const guardadas = [{ mediaId: 'med-1', description: 'de pie junto a la ventana' }];

  it('ofrece reenviar y NO ofrece generar', () => {
    const texto = buildVaultImageInstruction(guardadas, 'prose', false);
    expect(texto).toContain('REENVIANDO');
    expect(texto).toContain('med-1: de pie junto a la ventana');
    expect(texto).toContain('NO puedes generar');
    // el formato del prompt del generador sobra si no se puede generar
    expect(texto).not.toContain('EN INGLES');
  });

  it('sigue prohibiendo esquivar la peticion', () => {
    // el hueco no se tapa solo para el camino con generacion
    expect(buildVaultImageInstruction(guardadas, 'prose', false)).toContain('NO la esquives');
  });

  it('conserva el aviso de que no ve las imagenes', () => {
    // es la regla que impide `D-061`, y duplicar la lista era la forma de que
    // una de las dos copias se quedara sin ella
    expect(buildVaultImageInstruction(guardadas, 'prose', false)).toContain('NO las ves');
  });
});

// EL FALLO: el esquema documenta `caption` como «lo unico que el modelo sabe de
// una imagen ya guardada», y el prompt leia `prompt`, que el mismo esquema
// define como «historia, no descripcion». Describir una imagen con un modelo
// con vista no cambiaba una letra de lo que veia el modelo de la conversacion.
describe('con que frase se le presenta una imagen guardada', () => {
  it('el pie de foto MANDA sobre el prompt de generacion', () => {
    expect(
      imageDescriptionFor({
        caption: 'una mujer desnuda de perfil junto a una puerta blanca',
        prompt: 'standing by a window, blue dress',
        displayName: 'med-1.webp',
      }),
    ).toBe('una mujer desnuda de perfil junto a una puerta blanca');
  });

  it('sin pie de foto vale el prompt: peor descripcion, mejor que nada', () => {
    // y conserva lo que ya hay en disco, donde los adjuntos antiguos guardaron
    // su pie de foto en `prompt`
    expect(imageDescriptionFor({ caption: null, prompt: 'standing by a window' })).toBe(
      'standing by a window',
    );
  });

  it('sin ninguno de los dos queda el nombre del archivo', () => {
    expect(imageDescriptionFor({ displayName: 'foto de perfil' })).toBe('foto de perfil');
  });

  it('una cadena en blanco no cuenta como descripcion', () => {
    // un caption vacio no puede tapar un prompt que si dice algo
    expect(imageDescriptionFor({ caption: '   ', prompt: 'standing by a window' })).toBe(
      'standing by a window',
    );
  });

  it('sin nada devuelve cadena vacia, que la instruccion pinta como «sin descripcion»', () => {
    expect(imageDescriptionFor({})).toBe('');
  });
});

// Daniel, sobre la foto de perfil: «Lía debe de saber que existe y es su foto de
// perfil, y debería saber lo que describe la foto, aunque no se vea siempre».
// Son las DOS cosas, y antes solo se daba una.
describe('la linea de la foto de perfil', () => {
  it('dice que es su retrato Y lo que se ve en el', () => {
    expect(profilePhotoLine('una mujer de pelo castaño junto a una puerta')).toBe(
      'su foto de perfil — una mujer de pelo castaño junto a una puerta',
    );
  });

  it('sin describir todavia, no se repite a si misma', () => {
    // el pie de foto de partida ES la etiqueta: «su foto de perfil — su foto de
    // perfil» no informa de nada
    expect(profilePhotoLine(PROFILE_PHOTO_LABEL)).toBe(PROFILE_PHOTO_LABEL);
    expect(profilePhotoLine('')).toBe(PROFILE_PHOTO_LABEL);
    expect(profilePhotoLine('   ')).toBe(PROFILE_PHOTO_LABEL);
  });

  it('sigue diciendo que es su foto aunque la descripcion sea larga', () => {
    // con solo la descripcion se pierde que ese retrato es SUYO, que es lo que
    // lo distingue de cualquier otra foto de ella
    expect(profilePhotoLine('desnuda, pelo castaño, ojos azules')).toContain(PROFILE_PHOTO_LABEL);
  });
});

// PROBADO CONTRA GROQ el 2026-09-08, gastando una llamada para averiguarlo:
// `qwen/qwen3.6-27b` devolvio `400 invalid_request_error: "invalid image data"`
// con un avif que habia llegado entero y con su tipo correcto. Que Chromium
// sepa pintarlo —la vista previa del banco se veia perfectamente— no significa
// que el proveedor sepa leerlo.
describe('formatos que los transportes pueden llevar', () => {
  it('los cuatro de siempre pasan', () => {
    for (const tipo of TRANSPORTABLE_IMAGE_TYPES) {
      expect(imageTransportProblem(tipo)).toBeNull();
    }
  });

  it('avif se para, y el motivo dice que hacer', () => {
    const problema = imageTransportProblem('image/avif');
    expect(problema).not.toBeNull();
    expect(problema).toContain('avif');
    expect(problema).toContain('png');
  });

  it('el motivo no acusa al archivo de estar roto', () => {
    // «invalid image data» suena a fichero corrupto, que es la pista falsa que
    // devuelve el proveedor. El formato es lo que no viaja, no el archivo
    const problema = imageTransportProblem('image/heic') ?? '';
    expect(problema).not.toContain('corrupt');
    expect(problema).toContain('Chromium');
  });

  it('lo que no es una imagen tambien se para', () => {
    expect(imageTransportProblem('application/octet-stream')).not.toBeNull();
  });
});

// PASO DE VERDAD, y se leyo en el prompt guardado de la imagen que salio mal.
// La receta de Lia decia «light brown hair, blue eyes» y el modelo escribio como
// escena: «young japanese woman, 18, petite, small breasts, naked, lying on bed,
// ... dark hair messy spread on pillow ...». Salio morena y con otro cuerpo.
//
// No lo hacia por capricho: estaba describiendo a su personaje, que es lo que
// parece que se le pide. Por eso hay que PROHIBIRLO, no basta con no pedirlo.
describe('la escena no puede redefinir al personaje', () => {
  const instruccion = buildVaultImageInstruction();

  it('prohibe describir sus rasgos fijos, uno por uno', () => {
    expect(instruccion).toContain('NO describas COMO ES ella');
    for (const rasgo of ['pelo', 'ojos', 'piel', 'pecho', 'edad']) {
      expect(instruccion).toContain(rasgo);
    }
  });

  it('explica POR QUE, que es lo que hace que se cumpla', () => {
    // «no lo hagas» a secas invita a saltarselo cuando el modelo cree que ayuda
    expect(instruccion).toContain('dos descripciones distintas de la misma');
  });

  it('cierra la excusa de que encaje con lo que sabe', () => {
    expect(instruccion).toContain('Aunque lo sepas y aunque encaje');
  });

  it('dice lo que SI es suyo, para que no se quede sin nada que escribir', () => {
    // prohibir sin sustituir deja un prompt vacio, que es peor
    expect(instruccion).toContain('lo que CAMBIA de una foto a otra');
  });
});

// PASO DE VERDAD: Daniel escribio «Parece que te gusta... Dame otra foto» y Lia
// le REENVIO la que acababa de mandarle. «Otra» es ambiguo —«una mas» o «una
// distinta de las que ya tienes»— y reenviar es el camino barato, asi que ante
// la duda ganaba siempre. Empeoro cuando se le dijo «si dudas, manda una».
describe('«otra foto» significa una nueva', () => {
  const instruccion = buildVaultImageInstruction();

  it('lista las formas de pedir una nueva', () => {
    expect(instruccion).toContain('piden GENERAR');
    for (const forma of ['«otra»', '«una nueva»', '«hazme una»']) {
      expect(instruccion).toContain(forma);
    }
  });

  it('acota cuando SI vale reenviar', () => {
    expect(instruccion).toContain('«la de antes»');
    expect(instruccion).toContain('REENVIAR, y solo entonces');
  });

  it('prohibe mandar dos veces seguidas la misma', () => {
    // era exactamente lo que hacia: la misma foto, dos turnos seguidos
    expect(instruccion).toContain('NUNCA reenvies dos veces seguidas la misma imagen');
  });

  it('sin poder generar no promete lo que no puede hacer', () => {
    // el desempate solo tiene sentido cuando las dos opciones existen
    const sinGenerar = buildVaultImageInstruction([], 'prose', false);
    expect(sinGenerar).not.toContain('piden GENERAR');
    expect(sinGenerar).toContain('NO puedes generar');
  });
});

// PASO DE VERDAD: Lia escribio una escena de TRECE elementos pidiendo «de
// espaldas, mirando sobre el hombro, camisa caida hasta la cintura, vaqueros
// bajados», y volvio una foto de frente, vestida y sentada. Un generador
// reparte su atencion entre todo lo que se le pone: con trece cosas, las del
// final —que es donde caen los detalles concretos— no llegan.
describe('la escena tiene que ser corta para que se cumpla', () => {
  const instruccion = buildVaultImageInstruction();

  it('pone un tope de elementos, que era lo que faltaba', () => {
    expect(instruccion).toContain('OCHO elementos como mucho');
  });

  it('explica el mecanismo, no solo la regla', () => {
    // «se breve» sin motivo se salta; sabiendo que cada añadido resta, no
    expect(instruccion).toContain('le quita fuerza a las demas');
  });

  it('dice que el primero manda', () => {
    expect(instruccion).toContain('El PRIMERO es el que mas pesa');
  });

  it('manda usar la etiqueta corta de ropa en vez de describirla', () => {
    expect(instruccion).toContain('off');
    expect(instruccion).toContain('open shirt');
  });
});
