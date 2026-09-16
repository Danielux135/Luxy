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
  MAX_IMAGE_LINE_CHARS,
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
    expect(instruction).toContain('en DOS casos y solo en esos');
    expect(instruction).toContain('1. el usuario pide ver, recibir o volver a ver una imagen');
    expect(instruction).toContain('Fuera de esos dos casos, nunca por iniciativa propia');
    expect(instruction).toContain('NO cuentan');
    // sin poder generar solo queda el primer caso, dicho como antes
    const sinGenerar = buildVaultImageInstruction([], 'prose', false);
    expect(sinGenerar).toContain('SOLO si el usuario pide ver, recibir o volver a ver una imagen');
    expect(sinGenerar).toContain('Nunca por iniciativa propia');
    expect(sinGenerar).toContain('si no te la han pedido, no la mandes');
  });

  it('el camino que SI puede generar tambien lleva el verbo, que era el agujero', () => {
    // `D-086` partio la frase en dos caminos y la orden se quedo solo en el que
    // NO puede generar, donde no sirve de nada: el que si puede generar decia
    // «NO cuentan» —un adjetivo— y en ningun sitio «no la mandes». El
    // 2026-09-15 el modelo genero dos imagenes que nadie habia pedido, en un
    // cierre de escena y en una escena de caricias
    const instruction = buildVaultImageInstruction();
    expect(instruction).toContain('no la mandes');
    // y nombrando los dos casos, que es lo que impide reabrir `D-086`: la foto
    // que hace el dentro de la escena se sigue generando
    expect(instruction).toContain('no la ha hecho el en este mensaje');
  });

  it('«si dudas de cual mandar» solo sale cuando hay entre cuales elegir', () => {
    // salia en los cuatro caminos, incluido el de cero imagenes guardadas,
    // donde no hay ningun «cual»: es un error de alcance, no un cambio de
    // politica
    expect(buildVaultImageInstruction()).not.toContain('elegir mal es mejor');
    const conLista = [{ mediaId: 'med-1', description: 'junto a la ventana' }];
    expect(buildVaultImageInstruction(conLista)).toContain('elegir mal es mejor');
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
    const conLista = [{ mediaId: 'med-1', description: 'junto a la ventana' }];
    expect(buildVaultImageInstruction(conLista)).toContain(
      'elegir mal es mejor que no mandar nada',
    );
    // pero «cual» son SIEMPRE las de la lista. Sin acotar, en el camino cerrado
    // se lee como «manda una cualquiera», y junto a la orden de no esquivar
    // empuja a reenviar una vieja cuando lo que piden es nueva
    expect(buildVaultImageInstruction(conLista)).toContain('cual de la lista mandar');
  });
});

// el camino cerrado es el que la puerta convierte en el de la mayoria de los
// turnos, asi que lo que dice deja de ser un caso de averia y pasa a leerse a
// diario. Antes coincidian dentro un limite dicho en voz baja —«dilo con
// naturalidad»— y una orden en el tono mas fuerte del bloque
describe('lo que dice el bloque cuando no se puede generar', () => {
  const conLista = [
    { mediaId: 'med-1', description: 'junto a la ventana' },
    { mediaId: 'med-2', description: 'sentada en la cama' },
  ];
  const cerrado = buildVaultImageInstruction(conLista, 'prose', false);

  it('la orden de no esquivar sigue entera: ese hueco no se reabre', () => {
    expect(cerrado).toContain('ES UNA ORDEN');
    expect(cerrado).toContain('NO la esquives');
  });

  it('pero con su excepcion dicha en el mismo tono, no en voz baja', () => {
    // sin esto, ante «mandame una nueva» la orden ganaba al limite y la unica
    // salida disponible era reenviar una vieja como si fuera la nueva: el daño
    // exacto del 2026-09-14
    expect(cerrado).toContain('NO existe todavia, dilo: no mandes otra en su lugar');
    // y esa excepcion es del camino cerrado: donde si se puede generar, lo que
    // no existe se genera
    expect(buildVaultImageInstruction(conLista, 'prose', true)).not.toContain(
      'no mandes otra en su lugar',
    );
  });

  it('manda NOMBRAR la foto al negarse, y no solo decirlo con naturalidad', () => {
    // de esto depende que insistir funcione: el turno siguiente la puerta mira
    // si el tema sigue abierto, y «Ahora mismo no puedo, amor» no nombra nada
    expect(cerrado).toContain('dilo nombrando la foto');
    expect(cerrado).toContain('ahora no puedo mandarte una nueva');
  });

  it('y concuerda: es una imagen, no «uno»', () => {
    expect(cerrado).not.toContain('Si te piden uno');
    expect(cerrado).toContain('Si te piden una que no esta en');
  });
});

// una prueba de TAMAÑO, que es lo que impide que el bloque vuelva a crecer 16
// veces en trece dias sin que nadie lo note: paso de 398 a 6.656 caracteres, y
// llego a ocupar el 33% del prompt de un turno real
describe('lo que ocupa el bloque', () => {
  const cuatro = [
    { mediaId: 'med-1', description: 'de pie junto a la ventana, camisa blanca' },
    { mediaId: 'med-2', description: 'sentada en la cama, luz calida' },
    { mediaId: 'med-3', description: 'en la cocina, de espaldas' },
    { mediaId: 'med-4', description: 'durmiendo, ojos cerrados' },
  ];

  it('pudiendo generar no pasa de 6.500 caracteres', () => {
    expect(buildVaultImageInstruction(cuatro, 'prose', true).length).toBeLessThan(6500);
  });

  it('sin poder generar baja de 3.000: se salta la seccion COMO entera', () => {
    expect(buildVaultImageInstruction(cuatro, 'prose', false).length).toBeLessThan(3000);
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
  // el desempate solo se envia cuando hay algo que reenviar: sin lista no hay
  // dos vias entre las que elegir
  const instruccion = buildVaultImageInstruction([
    { mediaId: 'med-1', description: 'de pie junto a la ventana' },
  ]);

  it('lista las formas de pedir una nueva', () => {
    expect(instruccion).toContain('piden GENERAR');
    for (const forma of ['«otra»', '«una nueva»', '«hazme una»']) {
      expect(instruccion).toContain(forma);
    }
  });

  it('acota cuando SI vale reenviar', () => {
    // antes lo cerraba con «y solo entonces» sobre una lista de cuatro frases,
    // y esa exhaustividad dejaba fuera «la ultima»: se acota por lo que la
    // frase NOMBRA, no por una lista cerrada de ejemplos
    expect(instruccion).toContain('«la de antes»');
    expect(instruccion).toContain('piden REENVIAR: nombran una que YA existe');
    expect(instruccion).not.toContain('y solo entonces');
  });

  it('prohibe mandar dos veces seguidas la misma, pero solo si piden «otra»', () => {
    // era exactamente lo que hacia: la misma foto, dos turnos seguidos.
    //
    // La prohibicion NO puede ser incondicional, que es como estaba escrita:
    // «no me ha llegado» y «no me carga, ponla otra vez» piden justo repetir
    // la misma imagen, y estan dos lineas mas arriba del lado del reenvio
    expect(instruccion).toContain(
      'Si acabas de mandar una y te piden «otra», quieren una NUEVA: generala, no repitas esa.',
    );
    expect(instruccion).not.toContain('NUNCA reenvies dos veces seguidas');
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

// PASO DE VERDAD, y lo diagnostico Daniel: fallo una generacion, Lia no se
// entero —el turno guarda su texto y nada mas—, y cuando el le dijo «se me ha
// borrado, mandame una nueva pero igual», ella copio el prompt de la ultima
// imagen GUARDADA. Como la fallida nunca llego a guardarse, la ultima guardada
// era una vieja, de otra escena: devolvio aquella foto.
describe('cuando la imagen anterior no llego a generarse', () => {
  it('se le dice, y con el motivo', () => {
    const texto = buildVaultImageInstruction([], 'tags', true, 'AI Horde: no estuvo lista a tiempo');
    expect(texto).toContain('NO llego a generarse');
    expect(texto).toContain('no estuvo lista a tiempo');
  });

  it('le dice que el usuario NO la ha visto', () => {
    // es lo que distingue «no llego» de «no le gusto»: sin esto podria
    // disculparse por la foto en vez de volver a mandarla
    const texto = buildVaultImageInstruction([], 'tags', true, 'fallo');
    // sin saltos de linea, que es como lo lee el modelo y no como se escribio
    expect(texto.replace(/\s+/g, ' ')).toContain('El usuario no la ha visto nunca');
  });

  it('le prohibe copiar el prompt de una imagen mas antigua', () => {
    // el fallo exacto: «otra igual» resolvia a la ultima guardada
    const texto = buildVaultImageInstruction([], 'tags', true, 'fallo');
    expect(texto).toContain('NO copies el prompt de una imagen mas antigua');
  });

  it('sin fallo anterior no se le dice nada', () => {
    // el aviso es informacion de un turno; repetirlo siempre seria ruido
    expect(buildVaultImageInstruction([], 'tags', true, null)).not.toContain('NO llego a generarse');
    expect(buildVaultImageInstruction()).not.toContain('NO llego a generarse');
  });

  it('el prompt de la conversacion lo transmite', () => {
    const prompt = buildVaultPrompt({
      memory: null,
      turns: [],
      message: 'mandame otra igual',
      canGenerateImage: true,
      lastImageError: 'AI Horde: no estuvo lista a tiempo',
    });
    expect(prompt).toContain('NO llego a generarse');
  });

  it('y sin fallo el prompt no lo menciona', () => {
    const prompt = buildVaultPrompt({
      memory: null,
      turns: [],
      message: 'mandame una foto',
      canGenerateImage: true,
    });
    expect(prompt).not.toContain('NO llego a generarse');
  });
});

// PASO DE VERDAD, y lo destapo Daniel mirando un log: `tokensIn=9321` en un
// turno con once imagenes guardadas. Al guardar el prompt compuesto entero,
// cada imagen aportaba ~308 tokens a la lista: 3.388 en total, el 36% de todo
// lo que se le enviaba al modelo.
describe('lo que ocupa cada imagen en el prompt', () => {
  const NEGATIVO = 'worst quality, low quality, blurry, bad anatomy, watermark, censored';

  it('el negativo NO viaja: no describe la imagen, dice lo que se evito', () => {
    const linea = imageDescriptionFor({ prompt: `sitting on a bed, blue dress ### ${NEGATIVO}` });
    expect(linea).toBe('sitting on a bed, blue dress');
    expect(linea).not.toContain('worst quality');
  });

  it('se recorta por el tope, marcado', () => {
    const largo = 'palabra '.repeat(200);
    const linea = imageDescriptionFor({ caption: largo });
    expect(linea.length).toBeLessThanOrEqual(MAX_IMAGE_LINE_CHARS);
    expect(linea.endsWith('…')).toBe(true);
  });

  it('un pie de foto corto se deja intacto', () => {
    // describir las imagenes mejora la eleccion Y acorta el prompt: es el caso
    // bueno y no debe tocarse
    expect(imageDescriptionFor({ caption: 'una mujer de pelo castaño en la cama' })).toBe(
      'una mujer de pelo castaño en la cama',
    );
  });

  it('once imagenes ya no se comen un tercio del prompt', () => {
    const compuesto = `${'tag, '.repeat(120)} ### ${NEGATIVO}`;
    const total = Array.from({ length: 11 }, () => imageDescriptionFor({ prompt: compuesto })).join(
      '',
    ).length;
    // antes eran ~13.500 caracteres; el tope los deja en 2.200 como mucho
    expect(total).toBeLessThanOrEqual(11 * MAX_IMAGE_LINE_CHARS);
  });
});

describe('una foto que hace EL dentro de la escena', () => {
  // paso de verdad: «me incorporo y le saco una foto mientras duerme». Ella lo
  // entendio y reacciono al clic, pero no la genero: la regla solo contaba
  // «pide ver una imagen». Salio cuando el dijo «la he borrado, dame otra»

  it('se genera aunque no pida verla, en el mismo turno en que reacciona', () => {
    const instruction = buildVaultImageInstruction();
    expect(instruction).toContain('2. el usuario HACE UNA FOTO en este turno, dentro de la escena');
    expect(instruction).toContain('No la pide, pero tiene que existir:');
    expect(instruction).toContain('reaccionas en personaje y escribes el bloque en el MISMO turno');
  });

  it('«nunca por iniciativa propia» ya no anula la foto que hace el', () => {
    // la revision lo encontro: la frase siguiente al caso 2 decia «si no te la
    // han pedido, no la mandes», que es justo el hueco del fallo original
    const instruction = buildVaultImageInstruction();
    expect(instruction).not.toContain('si no te la han pedido, no la mandes');
    expect(instruction).toContain('Que el haga la foto no es iniciativa tuya, es el caso 2');
    // el apartado b) y su remision solo existen cuando hay dos vias
    expect(buildVaultImageInstruction([{ mediaId: 'med-1', description: 'en la ventana' }])).toContain(
      'o cuando el haga una foto (ver CUANDO, caso 2)',
    );
  });

  it('decide por escrito la foto de los dos juntos y la que solo se dice', () => {
    const instruction = buildVaultImageInstruction();
    expect(instruction).toContain('Si salis los dos, o os la hace otra persona, generala solo contigo');
    expect(instruction).toContain('Si solo se fotografia a si mismo, o solo lo dice o lo recuerda');
    // la regla que adivinaba «esta mirando una foto que no esta en la lista,
    // luego no llego a generarse» se borro: `lastError` lo sabe de cierto y
    // aquella mandaba lo contrario que la linea de encima ante la misma frase
    expect(instruction).not.toContain('es que no llego a generarse: generala');
  });

  it('sin poder generar no se le pide generarla', () => {
    // prometer lo que no se puede hacer es peor que no ofrecerlo
    const instruction = buildVaultImageInstruction([], 'prose', false);
    expect(instruction).not.toContain('HACE UNA FOTO');
    expect(instruction).not.toContain('caso 2');
  });

  it('el prompt de esa foto no nombra ninguna camara, ni en negativo', () => {
    // «not looking at camera» mete la palabra en el prompt, y el generador no
    // entiende el «not»: dibuja lo que se nombra
    const instruction = buildVaultImageInstruction();
    expect(instruction).toContain('o aunque la foto la este haciendo el');
    expect(instruction).toContain('Ni siquiera en negativo');
    expect(instruction).toContain('tal como se ve desde donde esta el');
    expect(instruction).not.toContain('lo que ve su camara');
    expect(instruction).not.toContain('sin mirar a la camara');
  });
});

// PASO DE VERDAD del 2026-09-14, y es el CONTRARIO del de `D-086`. Daniel
// escribio, dentro de la escena, «Mira la ultima foto que te he hecho
// durmiendo», refiriendose a una foto que YA estaba guardada.
//
// Lo importante es lo que hizo Lia: la identifico, cogio el movil, abrio la
// galeria y la describio BIEN —ella dormida, la boca entreabierta, el pelo
// esparcido, la luz de la tarde—. No fallo la comprension ni la identificacion.
// Lo que sobro fue el bloque de GENERAR que escribio ademas: llego una imagen
// distinta de la que el tenia en la cabeza, y eso rompe la escena.
//
// Fallo porque dos reglas mandaban cosas distintas ante esa misma frase: el
// caso 2 traia el ejemplo «te hago una mientras duermes» —presente de hacer una
// foto MAS complemento de dormir, las dos piezas de lo que el escribio— y a dos
// lineas estaba la regla correcta, «solo lo dice o lo recuerda, no». Dos reglas
// en conflicto son una moneda al aire en cada turno.
//
// Estas pruebas fijan los dos lados a la vez: el falso positivo de hoy y el
// falso negativo de `D-086`, que es el que se arreglo antes y no puede volver.
describe('lo que decide es CUANDO se hace la foto, no el tiempo verbal', () => {
  // la foto de la que hablaba: dormida, y ya guardada
  const guardadas = [
    { mediaId: 'med-1', description: 'dormida en la cama, la boca entreabierta, luz de tarde' },
  ];
  // el modelo no lee el array de lineas, lee un texto corrido: las frases que
  // cruzan un salto de linea hay que buscarlas asi o la prueba miente
  const corrido = (texto: string): string => texto.replace(/\s+/g, ' ');

  it('«Mira la ultima foto que te he hecho durmiendo» se REENVIA, no se genera', () => {
    const instruction = buildVaultImageInstruction(guardadas);
    // el determinante de su frase, del lado del reenvio
    const bullet = instruction
      .split('\n')
      .find((linea) => linea.includes('«la ultima»') && linea.includes('«la de antes»'));
    expect(bullet).toBeDefined();
    expect(instruction).toContain('piden REENVIAR: nombran una que YA existe');
    expect(instruction).toContain('Buscala en la lista de abajo y manda su id');
    // y el caso 2 ya no la reclama: lo dice el, en el mismo sitio donde fallaba,
    // y ademas dice a que caso pertenece, para que no caiga en «fuera de esos
    // dos casos, nunca por iniciativa propia» y se quede sin mandar nada
    expect(corrido(instruction)).toContain(
      'la de antes de este mensaje («la ultima», «esa») es del caso 1',
    );
  });

  it('«*click* ya te he hecho la foto» se GENERA: el perfecto no manda a reenviar', () => {
    // el arreglo anterior escribia «el caso 2 es siempre el PRESENTE», y eso
    // reabria `D-086` por la otra conjugacion: en castellano peninsular el
    // preterito perfecto es la forma normal de contar lo que acaba de pasar.
    // Con una foto parecida ya guardada —la de `guardadas`, dormida— aquella
    // regla mandaba reenviar la vieja en vez de generar la que el acababa de
    // hacer: una imagen equivocada, el daño exacto del 2026-09-14
    const instruction = corrido(buildVaultImageInstruction(guardadas));
    expect(instruction).not.toContain('El caso 2 es siempre el PRESENTE');
    expect(instruction).toContain('Lo que decide es CUANDO se hace la foto, no el tiempo verbal');
    expect(instruction).toContain('la que hace aqui es del 2, aunque escriba «ya te he hecho una»');
    // y el disparador del caso 2 sigue acotado al mismo turno, que es el otro
    // extremo de la misma vara de medir
    expect(instruction).toContain('el usuario HACE UNA FOTO en este turno');
  });

  it('el perfecto ya no dispara el reenvio por si solo', () => {
    // «la que te he hecho» estaba en la lista de formas que piden REENVIAR, y
    // eso es un disparo por palabra suelta de los que prohibe `D-085`: la misma
    // conjugacion sirve para la foto que se acaba de hacer en este mensaje.
    // Los ejemplos del reenvio son ahora determinantes, que si distinguen
    const instruction = buildVaultImageInstruction(guardadas);
    expect(instruction).not.toContain('«la que te he hecho»');
    for (const forma of ['«la ultima»', '«la de antes»', '«esa otra vez»']) {
      expect(instruction).toContain(forma);
    }
  });

  it('el ejemplo que se parecia a su frase ya no esta', () => {
    // «te hago una mientras duermes» juntaba el verbo y el complemento de la
    // frase que fallo, y se leia como permiso para generar
    expect(corrido(buildVaultImageInstruction(guardadas))).not.toContain('mientras duermes');
  });

  it('«te saco una foto mientras duermes» sigue GENERANDO (`D-086` intacto)', () => {
    const instruction = corrido(buildVaultImageInstruction(guardadas));
    expect(instruction).toContain('el usuario HACE UNA FOTO en este turno, dentro de la escena');
    expect(instruction).toContain('(«te saco una foto»');
    expect(instruction).toContain('No la pide, pero tiene que existir: GENERALA');
  });

  it('«me incorporo y le saco una foto mientras duerme» sigue GENERANDO', () => {
    // la frase literal de `D-086`. Lo que dispara es que la foto se hace en
    // ESTE mensaje, no la palabra «foto» ni que ella este dormida: el
    // complemento de sueño no cambia la decision en ninguno de los dos sentidos
    const instruction = corrido(buildVaultImageInstruction(guardadas));
    expect(instruction).toContain('el usuario HACE UNA FOTO en este turno, dentro de la escena');
    expect(instruction).toContain('Que el haga la foto no es iniciativa tuya, es el caso 2');
  });

  it('«esa que me mandaste» y «la de antes» reenvian', () => {
    const instruction = buildVaultImageInstruction(guardadas);
    for (const forma of ['«la de antes»', '«esa otra vez»', '«tu foto de perfil»']) {
      expect(instruction).toContain(forma);
    }
    expect(instruction).toContain('med-1: dormida en la cama');
  });

  it('«dame otra foto» despues de mandar una sigue GENERANDO', () => {
    // el arreglo de hoy empuja hacia reenviar: esta es la prueba de que no se
    // ha pasado de frenada y el fallo de «dame otra» no vuelve
    const instruction = buildVaultImageInstruction(guardadas);
    expect(instruction).toContain('«otra», «otra mas», «una nueva», «hazme una»');
    expect(instruction).toContain('piden GENERAR');
    expect(instruction).toContain('quieren una NUEVA: generala, no repitas esa');
  });

  it('«no me carga, ponla otra vez» SIN `lastError` reenvia la misma, no otra', () => {
    // el caso corriente que quedaba sin cubrir: la imagen SI se genero y se
    // guardo, y el no la vio o no le cargo. El aviso de `lastError` no existe
    // aqui —solo salta cuando la generacion fallo de verdad— y la prohibicion
    // «NUNCA reenvies dos veces seguidas» se lo llevaba por delante: tres
    // minutos y medio de cola del horde para recibir otra imagen distinta,
    // cuando repetir la que ya estaba era gratis e instantaneo
    const instruction = buildVaultImageInstruction(guardadas);
    expect(instruction).toContain('«vuelve a mandarmela»');
    expect(instruction).toContain('piden REENVIAR');
    // la prohibicion solo alcanza a «otra», que es la palabra del fallo real
    expect(instruction).not.toContain('NUNCA reenvies');
    expect(instruction).toContain('te piden «otra», quieren una NUEVA');
  });

  it('la lista dice en que orden va, que es lo que hace resoluble «la ultima»', () => {
    // sin orden declarado, «la ultima» no se puede resolver contra una lista de
    // `- <id>: <descripcion>` sin fecha ni numero. El caso del 2026-09-14 se
    // salvaba de casualidad, porque «durmiendo» casaba con una sola linea
    const instruction = buildVaultImageInstruction([
      ...guardadas,
      { mediaId: 'med-2', description: 'dormida boca abajo, la sabana enredada' },
    ]);
    expect(instruction).toContain(
      'IMAGENES QUE YA EXISTEN AQUI, de la mas antigua a la mas reciente',
    );
    // y el orden que promete es el que le llega: `PrivateMediaStore.list` lo
    // garantiza, esta funcion solo lo conserva
    const lineas = instruction.split('\n').filter((linea) => linea.startsWith('- med-'));
    expect(lineas).toEqual([
      '- med-1: dormida en la cama, la boca entreabierta, luz de tarde',
      '- med-2: dormida boca abajo, la sabana enredada',
    ]);
  });

  it('una foto que NO esta en la lista se genera', () => {
    // el reenvio manda solo si hay algo que reenviar; si no, generar
    expect(buildVaultImageInstruction(guardadas)).toContain('Solo si ninguna encaja, generala.');
  });

  it('con `lastError` puesto, «no me ha llegado» sigue generando AQUELLA', () => {
    // el aviso lleva un dato CIERTO —la generacion anterior lanzo— y por eso
    // manda sobre la busqueda en la lista: la imagen que el no vio no esta ahi
    const instruction = buildVaultImageInstruction(
      guardadas,
      'prose',
      true,
      'AI Horde: no estuvo lista a tiempo',
    );
    expect(instruction).toContain('NO llego a generarse');
    expect(corrido(instruction)).toContain('El usuario no la ha visto nunca');
    expect(instruction).toContain('vuelve a describir aquella escena');
    expect(instruction).toContain('NO copies el prompt de una imagen mas antigua');
  });

  it('ya no quedan dos reglas que manden cosas distintas ante la misma frase', () => {
    const instruction = buildVaultImageInstruction(guardadas);
    // la que adivinaba del texto lo que `lastError` sabe de cierto
    expect(instruction).not.toContain('es que no llego a generarse: generala');
    // la lista cerrada que dejaba «la ultima» fuera del reenvio
    expect(instruction).not.toContain('y solo entonces');
    // la que excluia del caso 2 todo el preterito perfecto, incluido el de la
    // foto que se acaba de hacer en este mismo mensaje
    expect(instruction).not.toContain('siempre el PRESENTE');
    // y la prohibicion incondicional de repetir una imagen, que chocaba con
    // «vuelve a mandarmela» dos lineas mas arriba
    expect(instruction).not.toContain('NUNCA reenvies');
    // y los ejemplos de reenvio vivian duplicados en el apartado a) y en CUAL
    // DE LAS DOS, con criterios distintos. Ahora hay una sola copia
    expect(instruction.split('«la de antes»').length - 1).toBe(1);
    expect(instruction).not.toContain('hay alguna que encaje');
  });
});

// sin ninguna imagen guardada se enviaban igual 702 caracteres de maquinaria de
// reenvio —el apartado a) y CUAL DE LAS DOS entero— que remitian dos veces a
// «la lista de abajo», y la lista no se imprime en ese camino. Un bloque que ya
// es el mas grande del prompt no puede gastar el 14% en mandar elegir entre dos
// vias cuando solo existe una.
describe('sin nada guardado no se le ofrece elegir', () => {
  const vacio = buildVaultImageInstruction([], 'prose', true, null);
  const conLista = buildVaultImageInstruction([
    { mediaId: 'med-1', description: 'de pie junto a la ventana' },
  ]);

  it('no habla de dos formas ni del apartado a)', () => {
    expect(vacio).toContain('solo de una forma: GENERANDOLA');
    expect(vacio).not.toContain('tienes dos formas de hacerlo');
    expect(vacio).not.toContain('a) REENVIAR');
    expect(vacio).not.toContain('CUAL DE LAS DOS');
  });

  it('no remite a una lista que no se imprime', () => {
    expect(vacio).not.toContain('lista de abajo');
    expect(vacio).not.toContain('IMAGENES QUE YA EXISTEN');
    // y con lista si remite: es lo que hace reenviable lo que ya existe
    expect(conLista).toContain('lista de abajo');
  });

  it('conserva lo que NO depende de que haya lista', () => {
    // el caso 2, la orden de no esquivar la peticion y el formato del prompt
    // valen igual sin nada guardado: lo unico que sobraba era el desempate
    expect(vacio).toContain('el usuario HACE UNA FOTO en este turno');
    expect(vacio).toContain('ES UNA ORDEN');
    expect(vacio).toContain('EN INGLES');
  });

  it('ese camino ocupa bastante menos', () => {
    // la razon por la que se toco: las llamadas mueren cuando el prompt crece
    expect(vacio.length).toBeLessThan(conLista.length - 600);
  });
});
