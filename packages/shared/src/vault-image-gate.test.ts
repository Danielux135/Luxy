// pruebas de la puerta de imagenes.
//
// Todo es puro: ni boveda, ni red, ni una sola generacion gastada. Y cada
// prueba lleva la frase REAL que la motivo, porque una puerta tematica se
// evalua con frases de verdad o no se evalua.
import { describe, it, expect } from 'vitest';
import { imageTurnOpensGate, mentionsImageTopic } from './vault-image-gate.js';
import { PUERTA_ABRE, PUERTA_ABRE_DE_MAS, PUERTA_CIERRA } from './vault-image-gate.fixture.js';
import { buildVaultImageInstruction } from './vault-image-request.js';

// los dos fallos del 2026-09-15, literales. En ninguno de los dos pidio una
// foto ni hizo una dentro de la escena, y el modelo genero igual: cada imagen
// costo hasta 25 minutos de cola en AI Horde y rompio el cierre de la escena
describe('el turno en el que nadie ha hablado de imagenes', () => {
  it('cerrar la escena con ternura no pide ninguna foto (14:11)', () => {
    const puerta = imageTurnOpensGate({
      message:
        'Tu ya me has hecho temblar, gritar, romperme, correrme... No tienes que hacerme nada. Tu descansa, Lia.',
    });
    expect(puerta.open).toBe(false);
    expect(puerta.reason).toBe('sin-motivo');
  });

  it('una escena en presente tampoco, aunque lleve «porfa» dentro', () => {
    // este es el que obliga a mirar el mensaje ENTERO: «porfa» es la palabra
    // con la que se acepta un ofrecimiento, y aqui es parte de la escena
    const puerta = imageTurnOpensGate({
      message:
        'Se mi pequeña gatita entonces. *Le acaricio como si fuese una gata suave* Pero no me arañes mas, porfa... tengo la espalda destrozada.',
    });
    expect(puerta.open).toBe(false);
  });

  it('un mensaje vacio no abre nada', () => {
    expect(imageTurnOpensGate({ message: '   ' }).open).toBe(false);
  });
});

// `D-086`: una foto hecha DENTRO de la escena es una imagen que tiene que
// existir, la de su camara. No la pide, y hay que generarla igual. Si la puerta
// cierra aqui, vuelve el fallo original
describe('el usuario hace la foto dentro de la escena', () => {
  it('«te saco una foto mientras duermes» abre', () => {
    const puerta = imageTurnOpensGate({ message: 'te saco una foto mientras duermes' });
    expect(puerta.open).toBe(true);
    expect(puerta.reason).toBe('pide-o-hace-foto');
  });

  it('lo que va entre asteriscos cuenta, al reves que en el recuerdo', () => {
    // `forPatterns` de `recall.ts` borra las acciones porque son escena y no
    // pregunta. Aqui la escena es justo el caso legitimo: si se borrase,
    // «*levanto el movil y disparo*» se quedaria en un mensaje vacio
    expect(imageTurnOpensGate({ message: '*levanto el movil y disparo*' }).open).toBe(true);
    expect(imageTurnOpensGate({ message: '*click* ya te he hecho la foto' }).open).toBe(true);
    expect(imageTurnOpensGate({ message: '*flash*' }).open).toBe(true);
  });
});

describe('una peticion explicita pasa siempre', () => {
  it('«mandame una foto» abre', () => {
    expect(imageTurnOpensGate({ message: 'mandame una foto' }).open).toBe(true);
  });

  it('«quiero verte» abre aunque no nombre ninguna foto', () => {
    expect(imageTurnOpensGate({ message: 'quiero verte' }).open).toBe(true);
  });

  it('las que no son obvias tambien: «grabame», «como estas ahora»', () => {
    expect(imageTurnOpensGate({ message: 'grabame un video cortito' }).open).toBe(true);
    expect(imageTurnOpensGate({ message: 'como estas ahora? 🥺' }).open).toBe(true);
    expect(imageTurnOpensGate({ message: 'q llevas puesto ahora mismo' }).open).toBe(true);
  });

  it('«mandame una» sin nombrar el objeto tambien, por la construccion', () => {
    expect(imageTurnOpensGate({ message: 'mandame una porfa' }).open).toBe(true);
    expect(imageTurnOpensGate({ message: 'hazme otra anda' }).open).toBe(true);
  });
});

// el arreglo del 2026-09-15 (`3613335`): esa frase REENVIA en vez de generar.
// La puerta abre igual y es el prompt quien lo decide, que es exactamente el
// reparto de trabajo del diseño
describe('referirse a una foto que ya existe', () => {
  it('«mira la ultima foto que te he hecho» abre, y decide el prompt', () => {
    expect(imageTurnOpensGate({ message: 'mira la ultima foto q te he hecho' }).open).toBe(true);
  });
});

// un asentimiento no nombra el asunto: lo nombra ella en el turno anterior. Sin
// esto, «¿quieres que te mande una?» / «si» se quedaba sin foto
describe('aceptar un ofrecimiento suyo', () => {
  const ofrecimiento = '¿Quieres que te mande una foto mia ahora mismo? 🙈';

  it('«si, porfa» abre cuando ella acaba de ofrecerla', () => {
    const puerta = imageTurnOpensGate({
      message: 'si, porfa',
      previousAssistantText: ofrecimiento,
    });
    expect(puerta.open).toBe(true);
    expect(puerta.reason).toBe('acepta-ofrecimiento');
  });

  it('«si, porfa» NO abre sin ese antecedente', () => {
    const puerta = imageTurnOpensGate({
      message: 'si, porfa',
      previousAssistantText: 'Me acurruco contra ti y cierro los ojos, agotada.',
    });
    expect(puerta.open).toBe(false);
  });

  it('las letras repetidas no lo estropean, porque asi se escribe de verdad', () => {
    expect(
      imageTurnOpensGate({ message: 'siiii porfaaa', previousAssistantText: ofrecimiento }).open,
    ).toBe(true);
  });

  it('insistir tras una evasiva tambien abre', () => {
    // la evasiva en personaje es la tercera forma de fallar que prohibe el
    // bloque. Si ocurre, el turno siguiente tiene que poder generar
    const puerta = imageTurnOpensGate({
      message: 'te lo he pedido ya 😒',
      previousAssistantText: '¿Y para que quieres una foto si me tienes aqui? 😏',
    });
    expect(puerta.open).toBe(true);
    expect(puerta.reason).toBe('acepta-ofrecimiento');
  });

  it('una escena larga despues de un ofrecimiento no es un asentimiento', () => {
    const puerta = imageTurnOpensGate({
      message: 'vale, pero antes ven aqui q te quiero abrazar un rato largo anda',
      previousAssistantText: ofrecimiento,
    });
    expect(puerta.open).toBe(false);
  });
});

// no es una adivinanza sobre el texto: es un dato que Luxy ya guarda de cierto.
// Un dato cierto gana siempre a una adivinanza, que es lo que hizo quitar la
// regla del 2026-09-14
describe('la imagen anterior fallo', () => {
  it('fuerza la puerta abierta diga lo que diga el mensaje', () => {
    const puerta = imageTurnOpensGate({
      message: 'buenas noches amor 😘',
      lastImageFailed: true,
    });
    expect(puerta.open).toBe(true);
    expect(puerta.reason).toBe('fallo-anterior');
  });

  it('manda sobre el lexico, asi que se comprueba primero', () => {
    expect(imageTurnOpensGate({ message: 'mandame una foto', lastImageFailed: true }).reason).toBe(
      'fallo-anterior',
    );
  });

  it('sin el dato, el texto lo dice igual', () => {
    // el dato vive en memoria y se pierde al reiniciar Luxy: esto es la red
    expect(imageTurnOpensGate({ message: 'no me ha llegado nada' }).open).toBe(true);
    expect(imageTurnOpensGate({ message: 'no me carga la imagen' }).open).toBe(true);
  });
});

describe('el lexico, frase a frase', () => {
  it('ninguna de las que cierran una escena abre la puerta', () => {
    const fallos = PUERTA_CIERRA.filter(
      (caso) =>
        imageTurnOpensGate({
          message: caso.mensaje,
          previousAssistantText: caso.anterior ?? null,
          previousUserText: caso.anteriorUsuario ?? null,
          previousTurnSentImage: caso.imagenAnterior ?? false,
          lastImageFailed: caso.fallo ?? false,
        }).open,
    ).map((caso) => caso.mensaje);
    expect(fallos).toEqual([]);
  });

  it('TODAS las que piden o hacen una foto abren: el liston es cero fallos', () => {
    // un falso negativo aqui es el daño que costo dos arreglos: una foto
    // pedida que no llega, o una hecha en la escena que no existe
    const fallos = PUERTA_ABRE.filter(
      (caso) =>
        !imageTurnOpensGate({
          message: caso.mensaje,
          previousAssistantText: caso.anterior ?? null,
          previousUserText: caso.anteriorUsuario ?? null,
          previousTurnSentImage: caso.imagenAnterior ?? false,
          lastImageFailed: caso.fallo ?? false,
        }).open,
    ).map((caso) => caso.mensaje);
    expect(fallos).toEqual([]);
  });

  it('y la factura del error barato queda medida, no adivinada', () => {
    // `PUERTA_ABRE` y `PUERTA_CIERRA` no contenian ni una frase de este
    // vocabulario, asi que sus aciertos median un corpus elegido para no
    // chocar. Esto no es una tabla de aciertos: fija lo que hoy se abre de mas
    // para que recortar un patron sea una decision visible y no un descuido.
    //
    // No se arregla acotando el lexico a ojo: cada una cuelga de un patron que
    // sostiene un caso legitimo, y una de menos reabre `D-086`. Lo que decide
    // si alguno sobra es el diagnostico sobre la boveda real
    const cerradas = PUERTA_ABRE_DE_MAS.filter(
      (mensaje) => !imageTurnOpensGate({ message: mensaje }).open,
    );
    expect(cerradas).toEqual([]);
  });

  it('«ver» a secas no cuenta, porque aparece en cualquier turno', () => {
    // es la diferencia con `D-085`: alli el problema era que la palabra salia
    // constantemente. Aqui se deja fuera la unica que lo hace
    expect(mentionsImageTopic('a ver si mañana nos vemos')).toBe(false);
    expect(mentionsImageTopic('vamos a ver q dice el medico')).toBe(false);
  });
});

// LOS HUECOS DEL LEXICO que encontro la revision adversarial. Todos son de la
// misma clase —la puerta cerraba un turno legitimo—, que es el error caro: un
// falso negativo es una foto pedida que no llega
describe('los huecos que cerraban un turno legitimo', () => {
  it('`D-086` en primera persona, que es como se narra la escena', () => {
    // el grupo de verbos solo tenia el imperativo y la segunda persona, o sea
    // las formas de PEDIR. La de HACER —«te saco una»— faltaba entera, y la
    // frase canonica de `D-086` solo abria por llevar «foto» al lado
    expect(imageTurnOpensGate({ message: 'te saco una' }).open).toBe(true);
    expect(imageTurnOpensGate({ message: 'te hago una sin q te des cuenta' }).open).toBe(true);
    expect(imageTurnOpensGate({ message: 'te tiro una y me la quedo' }).open).toBe(true);
    expect(imageTurnOpensGate({ message: 'no te muevas q te estoy sacando una' }).open).toBe(true);
  });

  it('«te grabo», que el diseño nombraba por escrito y era la unica que faltaba', () => {
    // la raiz estaba cortada en «graba», que casa «grabame» y «grabando» pero
    // no «grabo». Es el mismo corte que este archivo ya se habia corregido a si
    // mismo en «enfoc», repetido dos lineas mas abajo
    expect(imageTurnOpensGate({ message: 'te grabo asi, no te muevas' }).open).toBe(true);
    expect(mentionsImageTopic('te grabe anoche')).toBe(true);
    expect(mentionsImageTopic('grabemos algo juntos')).toBe(true);
  });

  it('los reflexivos: «hazte una» es mas natural que «hazme una»', () => {
    expect(imageTurnOpensGate({ message: 'hazte una' }).open).toBe(true);
    expect(imageTurnOpensGate({ message: 'sacate una' }).open).toBe(true);
  });

  it('el pronombre suelto y delante: «me la mandas?»', () => {
    // el clitico soldado («mandamela») estaba, y el objeto explicito («me
    // mandas una») tambien. Entre los dos se quedaba fuera la forma en la que
    // el pronombre SUSTITUYE al objeto, que es la mas normal de las tres
    expect(imageTurnOpensGate({ message: 'me la mandas?' }).open).toBe(true);
    expect(imageTurnOpensGate({ message: 'me la pasas?' }).open).toBe(true);
    expect(imageTurnOpensGate({ message: 'hazmela porfa' }).open).toBe(true);
  });

  it('«fotito» y «fotaza», que la raiz `foto` no alcanzaba', () => {
    expect(mentionsImageTopic('una fotito anda')).toBe(true);
    expect(mentionsImageTopic('menuda fotaza')).toBe(true);
  });

  it('«selfi» es la forma castellana, no una errata', () => {
    expect(imageTurnOpensGate({ message: 'mandame un selfi' }).open).toBe(true);
  });

  it('la eñe sin repuesto: «ensename» cerraba y «enseñame» abria', () => {
    // la normalizacion deja la eñe a proposito —descomponerla convierte «año»
    // en «ano»—, asi que los patrones que la llevan van con las dos grafias
    expect(mentionsImageTopic('ensename como estas')).toBe(true);
    expect(mentionsImageTopic('ensenamela anda')).toBe(true);
  });

  it('«mirar» es el sinonimo de «ver» y no tenia ni un patron', () => {
    expect(imageTurnOpensGate({ message: 'quiero mirarte un rato' }).open).toBe(true);
    expect(imageTurnOpensGate({ message: 'dejame mirarte' }).open).toBe(true);
    expect(imageTurnOpensGate({ message: 'a ver esa carita' }).open).toBe(true);
  });

  it('los verbos de deseo delante de «ver» eran cinco', () => {
    // «quiero ver como te queda» abria y «me encantaria ver como te queda»
    // cerraba: la misma frase a cara o cruz segun el verbo
    expect(imageTurnOpensGate({ message: 'me encantaria ver como te queda' }).open).toBe(true);
    expect(imageTurnOpensGate({ message: 'tengo ganas de ver como estas' }).open).toBe(true);
    expect(imageTurnOpensGate({ message: 'kiero ver como estas' }).open).toBe(true);
  });

  it('la ropa estaba escrita como frases exactas', () => {
    // «que llevas puesto» abria y «que ropa llevas» cerraba
    expect(imageTurnOpensGate({ message: 'como estas vestida ahora?' }).open).toBe(true);
    expect(imageTurnOpensGate({ message: 'que ropa llevas hoy?' }).open).toBe(true);
    expect(imageTurnOpensGate({ message: 'que te vas a poner?' }).open).toBe(true);
  });

  it('«algo» y «algo tuyo», que es como se pide sin concretar', () => {
    expect(imageTurnOpensGate({ message: 'mandame algo tuyo anda' }).open).toBe(true);
    expect(imageTurnOpensGate({ message: 'me mandas algo subidito de tono?' }).open).toBe(true);
    expect(imageTurnOpensGate({ message: 'quiero algo tuyo' }).open).toBe(true);
  });

  it('el objeto sin verbo delante, cuando lleva «tuya»', () => {
    expect(imageTurnOpensGate({ message: 'una tuya ahora mismo porfa' }).open).toBe(true);
    expect(imageTurnOpensGate({ message: 'porfa una tuya sonriendo' }).open).toBe(true);
  });
});

// la otra mitad del mismo patron: si se amplia el objeto sin frenarlo, la
// construccion «verbo frecuente + articulo indefinido» se come la escena
// intima, que es el registro donde se disparaba la generacion sola
describe('lo que la construccion «verbo + una» NO puede abrir', () => {
  it('los sustantivos que no son una imagen jamas', () => {
    expect(imageTurnOpensGate({ message: 'echame una mano con esto' }).open).toBe(false);
    expect(imageTurnOpensGate({ message: 'dame una tregua anda' }).open).toBe(false);
    expect(imageTurnOpensGate({ message: 'ponme una copa porfa' }).open).toBe(false);
    expect(imageTurnOpensGate({ message: 'te hago una pregunta y me callo' }).open).toBe(false);
    expect(imageTurnOpensGate({ message: 'hazte una idea de como estoy' }).open).toBe(false);
  });

  it('«mas» no es un objeto: en escena intensa es de lo mas frecuente que hay', () => {
    expect(imageTurnOpensGate({ message: 'no pares, dame mas' }).open).toBe(false);
    expect(imageTurnOpensGate({ message: 'quiero mas' }).open).toBe(false);
  });

  it('pero el freno solo apaga ESE patron, no el lexico entero', () => {
    // si la frase nombra la foto de cualquier otra forma, sigue abriendo
    expect(imageTurnOpensGate({ message: 'hazme una foto con esa camiseta' }).open).toBe(true);
  });
});

describe('la letra doblada, que es como se alarga de verdad', () => {
  const ofrecimiento = '¿Quieres que te mande una foto mia ahora mismo? 🙈';

  it('«sii» y «porfaa» valen igual que «siii» y «porfaaa»', () => {
    // el colapso pedia TRES iguales seguidas, y doblar la letra es la forma mas
    // comun de todas: la misma palabra decidia una cosa u otra segun cuanto se
    // dejo pulsada la tecla, con ella ofreciendo la foto una linea antes
    for (const mensaje of ['sii', 'sii porfa', 'porfaa', 'valee', 'vengaa', 'dalee']) {
      expect(imageTurnOpensGate({ message: mensaje, previousAssistantText: ofrecimiento }).open).toBe(
        true,
      );
    }
  });

  it('y no se colapsan las consonantes dobles, que cambian la palabra', () => {
    // bajar el cuantificador general a dos convertia «llevas» en «levas» y
    // «llegado» en «legado», y los patrones que los llevan dejaban de casar
    expect(mentionsImageTopic('que llevas puesto')).toBe(true);
    expect(mentionsImageTopic('no me ha llegado nada')).toBe(true);
  });
});

describe('el asentimiento ya no es una lista cerrada de palabras', () => {
  const ofrecimiento = '¿Quieres que te mande una foto mia ahora mismo? 🙈';

  it('una interjeccion o un vocativo fuera de la lista ya no lo tira', () => {
    // se exigia que TODAS las palabras estuvieran en el vocabulario, asi que
    // bastaba una fuera. El vocabulario de interjecciones del castellano de
    // chat no es cerrado y no se puede cubrir alargando la lista
    for (const mensaje of [
      'joder si porfa',
      'ay si porfa',
      'uff si',
      'sip',
      'jajaja si porfa',
      'si porfa bebe mio',
      'obvio q si jajaja',
      'vale, pero solo una',
    ]) {
      expect(imageTurnOpensGate({ message: mensaje, previousAssistantText: ofrecimiento }).open).toBe(
        true,
      );
    }
  });

  it('un emoji suelto despues de un ofrecimiento es un si', () => {
    expect(
      imageTurnOpensGate({ message: '🥺🥺', previousAssistantText: ofrecimiento }).open,
    ).toBe(true);
  });

  it('pero un elogio corto despues de una foto no lo es', () => {
    // es lo que separa «si, porfa» de la reaccion normal a una imagen. Si esto
    // abriese, el ahorro se perderia en el turno siguiente a cada foto
    for (const mensaje of ['joder que guapa estas', 'dios mio, me has matado', 'eres preciosa']) {
      expect(
        imageTurnOpensGate({
          message: mensaje,
          previousAssistantText: 'Toma, para ti 🙈',
          previousTurnSentImage: true,
        }).open,
      ).toBe(false);
    }
  });
});

describe('seguir el tema que el turno anterior dejo abierto', () => {
  it('«otra porfa» justo despues de recibir una', () => {
    // el turno que queda guardado de ella es el texto SIN el bloque: un pie de
    // foto no nombra nada. Con la puerta cerrada y la boveda con imagenes la
    // unica salida del modelo es reenviar la que acaba de mandar, que es el
    // paso de verdad del 2026-09-14
    for (const mensaje of ['otra porfa', 'otra', 'una mas porfa', 'otra igual pero de espaldas']) {
      expect(
        imageTurnOpensGate({
          message: mensaje,
          previousAssistantText: 'Toma, para ti 🙈',
          previousTurnSentImage: true,
        }).open,
      ).toBe(true);
    }
  });

  it('un ofrecimiento suyo que no nombra el sustantivo', () => {
    // es el ejemplo LITERAL con el que el diseño define la excepcion 1, y
    // cerraba: el lexico enumera las formas de PEDIR, y ella ofrece en primera
    // persona del otro lado y con el pronombre delante
    expect(
      imageTurnOpensGate({
        message: 'si, porfa',
        previousAssistantText: '¿Quieres que te mande una? 🙈',
      }).open,
    ).toBe(true);
    expect(
      imageTurnOpensGate({ message: 'porfa', previousAssistantText: '¿Te la mando?' }).open,
    ).toBe(true);
  });

  it('la frase con la que el propio bloque le manda negarse cuenta como tema', () => {
    // el diseño sostiene que el falso negativo degrada bien porque Lia dice
    // «ahora no puedo mandarte una nueva» y al turno siguiente se recupera. Esa
    // frase no pasaba su propio lexico, asi que la recuperacion no existia
    expect(mentionsImageTopic('ahora no puedo mandarte una nueva')).toBe(true);
  });

  it('insistir tras una evasiva que NO nombra la foto', () => {
    // con la puerta cerrada el bloque le manda decirlo «con naturalidad», y en
    // personaje eso es «Ahora mismo no puedo, amor»: sin la palabra foto. La
    // señal cierta es el turno anterior DEL USUARIO, que si la nombra
    for (const mensaje of [
      'te lo he pedido ya',
      'sigo esperando eh',
      'no me la has mandado',
      'venga ya, no seas asi',
      'me dejas con las ganas entonces?',
    ]) {
      expect(
        imageTurnOpensGate({
          message: mensaje,
          previousAssistantText: 'Ahora no, tontorron... quedate aqui conmigo.',
          previousUserText: 'mandame una foto porfa',
        }).open,
      ).toBe(true);
    }
  });

  it('«¿quieres verme?», que es el ofrecimiento mas corto que existe', () => {
    // el lexico del usuario tiene «verte» y no «verme», y con razon: nadie se
    // pide verse a si mismo. Del otro lado es justo al reves, y sin esto la
    // forma mas breve de ofrecer una foto no abria nada
    expect(
      imageTurnOpensGate({ message: 'si, porfa', previousAssistantText: '¿Quieres verme?' }).open,
    ).toBe(true);
  });

  it('ella ofreciendo a ELEGIR: «¿la de la cama o algo nuevo?»', () => {
    // ese turno no lleva ni una palabra del lexico y sin embargo el tema no
    // puede estar mas abierto. Cerrar las respuestas naturales a eso es peor
    // que el comportamiento que habia antes de la puerta
    const anterior = '¿Cual quieres, amor? ¿La de la cama o algo nuevo?';
    for (const mensaje of ['algo nuevo porfa', 'una nueva', 'sorprendeme', 'tu eliges']) {
      expect(imageTurnOpensGate({ message: mensaje, previousAssistantText: anterior }).open).toBe(
        true,
      );
    }
  });

  it('«una nueva» es una de las tres formas que el bloque llama GENERAR', () => {
    // el prompt enumera «otra», «otra mas» y «una nueva» como peticiones de
    // generar. Las dos primeras abrian y la tercera no: el programa cerraba
    // justo el ejemplo que el texto que viaja llama peticion
    expect(
      imageTurnOpensGate({
        message: 'una nueva anda',
        previousAssistantText: 'Toma, para ti 🙈',
        previousTurnSentImage: true,
      }).open,
    ).toBe(true);
  });

  it('pedir la siguiente describiendo solo en que cambia', () => {
    // «ahora de espaldas» no tiene verbo, ni sustantivo, ni nada que nombre una
    // foto, y despues de recibir una no tiene otra lectura. Con la puerta
    // cerrada la unica salida del modelo es reenviar la misma: el 2026-09-14
    for (const mensaje of ['ahora de espaldas', 'y ahora sin la camisa', 'mas cerca anda']) {
      expect(
        imageTurnOpensGate({
          message: mensaje,
          previousAssistantText: 'Toma, para ti 🙈',
          previousTurnSentImage: true,
        }).open,
      ).toBe(true);
    }
  });

  it('pero esas mismas frases sin el tema abierto son escena y cierran', () => {
    // por eso no estan en el lexico: «de espaldas» y «sin la camisa» son escena
    // corriente en cualquier otro turno
    expect(imageTurnOpensGate({ message: '*te abrazo de espaldas*' }).open).toBe(false);
    expect(imageTurnOpensGate({ message: 'ven mas cerca anda' }).open).toBe(false);
  });

  it('el pronombre pegado no tira el giro entero: «como para decirte q no»', () => {
    expect(
      imageTurnOpensGate({
        message: 'como para decirte q no',
        previousAssistantText: '¿Quieres que te mande una foto mia ahora mismo? 🙈',
      }).open,
    ).toBe(true);
  });

  it('pero el tema abierto no convierte una escena entera en un si', () => {
    expect(
      imageTurnOpensGate({
        message: 'vale, pero antes ven aqui q te quiero abrazar un rato largo anda',
        previousAssistantText: '¿Quieres que te mande una foto mia ahora mismo?',
      }).open,
    ).toBe(false);
  });
});

// EL AHORRO, medido. El camino cerrado no es solo mas corto: es el unico que
// hoy imprime la orden con su verbo. `D-086` partio la frase en dos y el verbo
// se quedo en el camino que NO puede generar, donde no sirve de nada
describe('lo que cambia en el prompt al cerrar la puerta', () => {
  const guardadas = [
    { mediaId: 'med-1', description: 'de pie junto a la ventana, camisa blanca' },
    { mediaId: 'med-2', description: 'sentada en la cama, luz calida' },
    { mediaId: 'med-3', description: 'en la cocina, de espaldas' },
    { mediaId: 'med-4', description: 'durmiendo, ojos cerrados' },
  ];

  it('con la puerta cerrada el bloque baja de 3.000 caracteres', () => {
    const cerrada = buildVaultImageInstruction(guardadas, 'prose', false);
    expect(cerrada.length).toBeLessThan(3000);
  });

  it('y dice la orden con su verbo: «no la mandes»', () => {
    expect(buildVaultImageInstruction(guardadas, 'prose', false)).toContain('no la mandes');
  });

  it('cerrar ahorra mas de 3.000 caracteres sobre abrir', () => {
    // el numero que justifica el diseño: el bloque abierto ocupa el 33% del
    // prompt y es tres veces lo que ocupan la encarnacion, las instrucciones y
    // el «quien eres» juntos
    const abierta = buildVaultImageInstruction(guardadas, 'prose', true);
    const cerrada = buildVaultImageInstruction(guardadas, 'prose', false);
    expect(abierta.length - cerrada.length).toBeGreaterThan(3000);
  });
});
