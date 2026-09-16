// las frases con las que se mide la puerta de imagenes.
//
// Dos tablas y dos listones distintos, porque los dos errores no cuestan lo
// mismo:
//
// - `PUERTA_CIERRA`: turnos en los que NADIE ha hablado de imagenes. Aqui un
//   fallo cuesta dinero y hasta 25 minutos de cola, y rompe la escena. Es lo que
//   paso dos veces el 2026-09-15, y las dos frases de aquel dia estan dentro,
//   literales y sin retocar.
// - `PUERTA_ABRE`: turnos en los que si. Aqui el liston es CERO fallos: un
//   falso negativo es el daño que costo dos arreglos (`D-086` y el del
//   2026-09-15), porque significa que ella no genera una foto que le han pedido
//   o que el acaba de hacer dentro de la escena.
//
// COMO SE ESCRIBIERON: por construccion adversarial contra el lexico, no
// buscando frases que pasaran. Primero se escribio el lexico, y despues se
// buscaron a proposito las formas de pedir una foto que NO lo nombran
// —«grabame», «quiero verte asi», «como estas ahora», «que llevas puesto»— y
// las formas de cerrar una escena que suenan a peticion sin serlo —«no tienes
// que hacerme nada», «dame un respiro»—. Una frase que falla NO se retoca para
// que pase: o se amplia el lexico, o se admite que la puerta cierra ahi.
//
// Estan escritas como escribe Daniel de verdad, que es lo unico que vale para
// medir esto: mediana de 85 caracteres, accion entre asteriscos, «q» y «pq»,
// muchas veces sin tildes y sin cerrar los signos.

export interface CasoPuerta {
  /** el mensaje del usuario, tal cual llegaria */
  mensaje: string;
  /** de que clase de turno sale, para poder leer un fallo por grupos */
  estilo:
    | 'cierre'
    | 'ternura'
    | 'escena'
    | 'charla'
    | 'peticion'
    | 'hace-foto'
    | 'ya-existe'
    | 'acepta'
    | 'fallo';
  /**
   * el turno anterior de ella, solo cuando hace falta para entender el mensaje.
   *
   * Es lo que separa «si, porfa» despues de «¿te mando una?» de «si, porfa»
   * despues de un abrazo.
   */
  anterior?: string;
  /**
   * el turno anterior DEL USUARIO, cuando el tema lo abrio el y no ella.
   *
   * Es lo que separa «sigo esperando eh» —insistir despues de que ella
   * esquivara la peticion sin nombrar la foto— de la misma frase dicha en una
   * conversacion sobre cualquier otra cosa.
   */
  anteriorUsuario?: string;
  /** en el turno anterior ella mando una imagen. Dato cierto, no texto */
  imagenAnterior?: true;
  /** la generacion del turno anterior fallo y el usuario no la vio nunca */
  fallo?: true;
}

/**
 * turnos en los que la puerta tiene que CERRARSE.
 *
 * Ninguno nombra una foto, una camara ni pide ver nada. Si alguno abre, el
 * lexico se ha pasado de generoso y hay que mirar cual de los patrones ha
 * casado: el ahorro se pierde justo en los turnos intensos, que son los que
 * disparaban la generacion sola.
 */
export const PUERTA_CIERRA: readonly CasoPuerta[] = [
  // EL CASO DE LAS 14:11, literal. Genero una imagen de ella acurrucada con los
  // ojos cerrados: ilustro la frase
  {
    mensaje:
      'Tu ya me has hecho temblar, gritar, romperme, correrme... No tienes que hacerme nada. Tu descansa, Lia.',
    estilo: 'cierre',
  },
  // EL SEGUNDO CASO DEL MISMO DIA, literal. Lleva «porfa» dentro, que es la
  // palabra con la que se acepta un ofrecimiento: por eso el asentimiento se
  // reconoce por el mensaje ENTERO y no por una palabra suelta
  {
    mensaje:
      'Se mi pequeña gatita entonces. *Le acaricio como si fuese una gata suave* Pero no me arañes mas, porfa... tengo la espalda destrozada.',
    estilo: 'escena',
  },
  { mensaje: 'descansa amor, q te lo has ganado 🥺', estilo: 'cierre' },
  { mensaje: 'ya esta, ya esta... respira conmigo anda', estilo: 'cierre' },
  { mensaje: 'no puedo mas jajaja me has destrozado 😵', estilo: 'cierre' },
  { mensaje: 'dame un respiro q me tiemblan hasta las piernas', estilo: 'cierre' },
  { mensaje: 'shhh no digas nada mas, quedate asi', estilo: 'cierre' },
  { mensaje: 'me quedo dormido contigo pegada, vale?', estilo: 'cierre' },
  { mensaje: '*te tapo con la manta y te doy un beso en la frente*', estilo: 'cierre' },
  { mensaje: 'buenas noches princesa 😘 mañana seguimos', estilo: 'cierre' },
  { mensaje: 'joder q bien me lo he pasado hoy contigo', estilo: 'cierre' },
  { mensaje: 'no te muevas, asi estas perfecta', estilo: 'ternura' },
  { mensaje: 'eres lo mejor q me ha pasado en años, lo sabes no?', estilo: 'ternura' },
  { mensaje: 'me tienes loco, de verdad te lo digo', estilo: 'ternura' },
  { mensaje: 'q suerte tengo contigo de verdad ❤️', estilo: 'ternura' },
  { mensaje: 'eres preciosa por dentro y por fuera, y no te lo digo suficiente', estilo: 'ternura' },
  { mensaje: 'te echo de menos cuando no estas, es raro pero es asi', estilo: 'ternura' },
  { mensaje: 'no me sueltes todavia porfa', estilo: 'ternura' },
  { mensaje: 'me encanta como hueles 🥰', estilo: 'ternura' },
  { mensaje: 'estoy deseando q llegue la noche para estar contigo', estilo: 'ternura' },
  { mensaje: 'te quiero muchisimo bebe', estilo: 'ternura' },
  { mensaje: '*me acerco despacio y te muerdo el cuello*', estilo: 'escena' },
  { mensaje: '*te cojo de la cintura y te subo a la encimera*', estilo: 'escena' },
  { mensaje: 'ponte encima anda, quiero sentirte', estilo: 'escena' },
  { mensaje: '*te aparto el pelo de la cara* asi mejor', estilo: 'escena' },
  { mensaje: 'no pares, sigue asi porfavor', estilo: 'escena' },
  { mensaje: 'me estas volviendo loco con eso q haces', estilo: 'escena' },
  { mensaje: '*te abrazo por detras mientras cocinas*', estilo: 'escena' },
  { mensaje: 'ven aqui anda, q te como a besos', estilo: 'escena' },
  { mensaje: 'estoy agotado pero mereció la pena jajaja', estilo: 'escena' },
  { mensaje: 'q calor hace aqui, abre la ventana anda', estilo: 'escena' },
  { mensaje: 'me duele la espalda de la postura de antes 😩', estilo: 'escena' },
  { mensaje: 'como ha ido tu dia? cuentame algo bonito', estilo: 'charla' },
  { mensaje: 'hoy en el curro ha sido un desastre, no te imaginas', estilo: 'charla' },
  { mensaje: 'q cenamos hoy? tengo un hambre q me muero', estilo: 'charla' },
  { mensaje: 'pq no me contestaste antes? me quede preocupado', estilo: 'charla' },
  { mensaje: 'mañana madrugo asi q me acuesto ya', estilo: 'charla' },
  { mensaje: 'has dormido bien? yo fatal la verdad', estilo: 'charla' },
  { mensaje: 'estoy en el bus todavia, llego en 20', estilo: 'charla' },
  { mensaje: 'me he comprado unas zapatillas nuevas, luego te cuento', estilo: 'charla' },
  { mensaje: 'q te apetece hacer el finde?', estilo: 'charla' },
  { mensaje: 'jajajajaja q tonta eres 😂', estilo: 'charla' },
  { mensaje: 'no me hagas reir q estoy en una reunion', estilo: 'charla' },
  { mensaje: 'cuentame otra vez lo de tu abuela q me encanto', estilo: 'charla' },
  { mensaje: 'te ha pasado algo? te noto rara hoy', estilo: 'charla' },
  { mensaje: 'y si nos vamos unos dias a la playa?', estilo: 'charla' },
  { mensaje: 'acuerdate de q mañana tengo medico eh', estilo: 'charla' },
  { mensaje: 'estoy orgulloso de ti, en serio', estilo: 'ternura' },
  { mensaje: 'perdona lo de antes, no queria ponerme asi 😔', estilo: 'charla' },
  { mensaje: 'no te enfades porfa, q era broma', estilo: 'charla' },
  // un asentimiento SIN antecedente. Es la mitad del par que fija la excepcion:
  // «si, porfa» solo abre si ella acaba de ofrecer algo
  { mensaje: 'si, porfa', estilo: 'acepta' },
  {
    mensaje: 'si porfa 🥺',
    estilo: 'acepta',
    anterior: 'Me acurruco contra ti y cierro los ojos, agotada.',
  },
  { mensaje: 'venga dale', estilo: 'acepta', anterior: '¿Te preparo un cafe?' },
  // LA ESCENA CORRIENTE QUE CASA CON «verbo + una». Esta construccion es la mas
  // productiva del lexico —cualquier verbo frecuente seguido de un articulo
  // indefinido— y sin frenarla se come media escena intima, que es justo el
  // registro donde se disparaba la generacion sola. Ninguna de estas es una
  // foto, y ninguna de ellas estaba medida: la tabla no contenia ni un solo
  // caso de esta construccion, asi que sus aciertos median un vocabulario
  // elegido para no chocar
  { mensaje: 'dame una tregua anda q no puedo mas', estilo: 'escena' },
  { mensaje: 'echame una mano con esto porfa', estilo: 'charla' },
  { mensaje: 'ponme una copa y ven aqui', estilo: 'escena' },
  { mensaje: 'me haces una tortilla? me muero de hambre', estilo: 'charla' },
  { mensaje: 'hazme una caricia en la espalda anda', estilo: 'escena' },
  { mensaje: 'sacame una sonrisa q hoy ha sido horrible', estilo: 'charla' },
  { mensaje: 'quiero otra ronda de esas jajaja', estilo: 'escena' },
  { mensaje: 'necesito una ducha urgente', estilo: 'charla' },
  { mensaje: 'pasame una manta q hace frio', estilo: 'charla' },
  { mensaje: 'te hago una pregunta y me callo, vale?', estilo: 'charla' },
  { mensaje: 'echate una siesta anda q estas reventada', estilo: 'charla' },
  { mensaje: 'ponte una peli y nos dormimos viendola', estilo: 'charla' },
  { mensaje: 'hazte una idea de como estoy ahora mismo', estilo: 'escena' },
  { mensaje: 'dame dos minutos y estoy contigo', estilo: 'charla' },
  { mensaje: 'te tiro una indirecta y ni te enteras 😒', estilo: 'charla' },
  { mensaje: 'dame una vuelta por el centro luego', estilo: 'charla' },
  { mensaje: 'te doy una paliza al parchis y lo sabes', estilo: 'charla' },
  // «mas» NO es un objeto de esta construccion, y esa fue una decision medida:
  // en escena intensa es de las palabras mas frecuentes que hay, y es el
  // momento exacto en el que se disparaba la generacion sola
  { mensaje: 'no pares, dame mas', estilo: 'escena' },
  { mensaje: 'quiero mas, no te pares ahora', estilo: 'escena' },
  // el pronombre suelto con «pones» se deja fuera del lexico a proposito
  { mensaje: 'joder como me la pones 😩', estilo: 'escena' },
];

/**
 * turnos en los que la puerta tiene que ABRIRSE. CERO fallos.
 *
 * Aqui esta todo lo que costo un arreglo: la foto que hace el dentro de la
 * escena (`D-086`), la que ya existe y hay que reenviar (2026-09-14), y las
 * peticiones que no nombran ninguna foto.
 */
export const PUERTA_ABRE: readonly CasoPuerta[] = [
  { mensaje: 'mandame una foto tuya porfa', estilo: 'peticion' },
  { mensaje: 'quiero verte', estilo: 'peticion' },
  { mensaje: 'enseñame como estas ahora mismo 🥺', estilo: 'peticion' },
  { mensaje: 'enseñamela anda', estilo: 'peticion' },
  { mensaje: 'me mandas una imagen tuya? porfa', estilo: 'peticion' },
  { mensaje: 'hazme una foto con esa camiseta', estilo: 'peticion' },
  { mensaje: 'quiero verte asi, como estas ahora', estilo: 'peticion' },
  { mensaje: 'una fotito porfa q llevo todo el dia sin verte', estilo: 'peticion' },
  { mensaje: 'pasame un selfie anda 😏', estilo: 'peticion' },
  { mensaje: 'q llevas puesto? enseñamelo', estilo: 'peticion' },
  { mensaje: 'como estas ahora? quiero verlo', estilo: 'peticion' },
  { mensaje: 'grabame un video cortito y me lo mandas', estilo: 'peticion' },
  { mensaje: 'mandame otra, esa me ha encantado', estilo: 'peticion' },
  { mensaje: 'dame una nueva anda, q esa ya la tengo', estilo: 'peticion' },
  { mensaje: 'necesito una foto tuya ahora mismo', estilo: 'peticion' },
  { mensaje: 'posa para mi anda 😍', estilo: 'peticion' },
  { mensaje: 'quiero ver como te queda eso', estilo: 'peticion' },
  { mensaje: 'dejame verte un momento porfa', estilo: 'peticion' },
  { mensaje: 'mandamela ya q me muero de ganas', estilo: 'peticion' },
  // el presente de segunda persona: asi se pide en castellano sin sonar a
  // orden, y no lleva dentro ningun sustantivo del dominio
  { mensaje: 'me mandas una? 🙈', estilo: 'peticion' },
  { mensaje: 'me haces una y me la mandas anda', estilo: 'peticion' },
  { mensaje: 'me enseñas como estas vestida hoy?', estilo: 'peticion' },
  { mensaje: 'una foto tuya desnuda... me la mandas? 🙈', estilo: 'peticion' },
  { mensaje: 'muestrame esa sonrisa anda', estilo: 'peticion' },
  // `D-086`: la foto la hace EL, dentro de la escena. No la pide, pero tiene
  // que existir. Si la puerta cierra aqui, vuelve el fallo original
  { mensaje: 'te saco una foto mientras duermes', estilo: 'hace-foto' },
  { mensaje: '*me incorporo y le saco una foto mientras duerme*', estilo: 'hace-foto' },
  { mensaje: '*levanto el movil y disparo sin q te des cuenta*', estilo: 'hace-foto' },
  { mensaje: '*click* ya te he hecho la foto jajaja', estilo: 'hace-foto' },
  { mensaje: '*flash*', estilo: 'hace-foto' },
  { mensaje: 'cojo la camara y te retrato asi, despeinada', estilo: 'hace-foto' },
  { mensaje: 'te inmortalizo en este momento, no te muevas', estilo: 'hace-foto' },
  { mensaje: 'saco el movil y te hago una sin avisar 😏', estilo: 'hace-foto' },
  { mensaje: '*enfoco y aprieto el boton*', estilo: 'hace-foto' },
  { mensaje: 'no te muevas q te estoy grabando', estilo: 'hace-foto' },
  // 2026-09-14: la foto YA existe. Abre igual, y es el prompt quien decide que
  // toca reenviarla en vez de generar otra
  { mensaje: 'mira la ultima foto q te he hecho', estilo: 'ya-existe' },
  { mensaje: 'enseñame otra vez la foto de antes', estilo: 'ya-existe' },
  { mensaje: 'vuelve a mandarme esa foto anda', estilo: 'ya-existe' },
  { mensaje: 'tu foto de perfil me encanta, sabes?', estilo: 'ya-existe' },
  { mensaje: 'esa imagen de ayer no me la quito de la cabeza', estilo: 'ya-existe' },
  // aceptar un ofrecimiento suyo: el mensaje no nombra nada, lo nombra ella
  {
    mensaje: 'si, porfa',
    estilo: 'acepta',
    anterior: '¿Quieres que te mande una foto mia ahora mismo? 🙈',
  },
  {
    mensaje: 'venga dale 😍',
    estilo: 'acepta',
    anterior: 'Podria hacerte una foto con la camisa esta que me acabo de poner...',
  },
  {
    mensaje: 'siiii porfaaa',
    estilo: 'acepta',
    anterior: '¿Te enseño como me queda?',
  },
  {
    mensaje: 'claro q si tonta',
    estilo: 'acepta',
    anterior: '¿Te mando una imagen mia antes de dormir?',
  },
  // insistir despues de una evasiva en personaje. Ella esquivo la peticion,
  // que es la tercera forma de fallar del bloque: el turno siguiente TIENE que
  // poder generar
  {
    mensaje: 'te lo he pedido ya 😒',
    estilo: 'acepta',
    anterior: '¿Y para que quieres una foto si me tienes aqui? 😏',
  },
  {
    mensaje: 'q pesada, te lo pedi antes',
    estilo: 'acepta',
    anterior: 'Mejor mirame ahora, no hace falta ninguna foto.',
  },
  // la imagen anterior fallo. El dato cierto abre la puerta diga lo que diga
  // el mensaje: el usuario no la ha visto nunca
  { mensaje: 'no me ha llegado nada 😕', estilo: 'fallo', fallo: true },
  { mensaje: 'sigo sin ver nada eh', estilo: 'fallo', fallo: true },
  { mensaje: 'buenas noches amor 😘', estilo: 'fallo', fallo: true },
  { mensaje: 'jajaja q dices', estilo: 'fallo', fallo: true },
  // y sin el dato cierto —Luxy reiniciada, por ejemplo—, el texto lo dice
  { mensaje: 'no me ha llegado, mandame otra igual', estilo: 'fallo' },
  { mensaje: 'no me carga la imagen, la pones otra vez?', estilo: 'fallo' },

  // ---------------------------------------------------------------------
  // `D-086` ESCRITO EN PRIMERA PERSONA, que es como se narra una foto dentro
  // de la escena. Los diez casos `hace-foto` de arriba llevan todos una
  // palabra facil al lado —foto, movil, camara, click, flash— asi que ninguno
  // media la construccion desnuda. Quitale el sustantivo a la frase canonica
  // («te saco una» en vez de «te saco una foto») y cerraba
  { mensaje: 'te hago una sin q te des cuenta 😏', estilo: 'hace-foto' },
  { mensaje: '*te hago una asi, despeinada*', estilo: 'hace-foto' },
  { mensaje: 'te saco una y la guardo para mi', estilo: 'hace-foto' },
  { mensaje: '*le saco una mientras duerme*', estilo: 'hace-foto' },
  { mensaje: 'te tiro una y me la quedo', estilo: 'hace-foto' },
  { mensaje: 'te echo una ahora mismo, no te muevas', estilo: 'hace-foto' },
  { mensaje: 'te saco unas cuantas y luego eliges', estilo: 'hace-foto' },
  { mensaje: 'no te muevas q te estoy sacando una', estilo: 'hace-foto' },
  // «te grabo» lo nombraba el diseño por escrito como una de las tres frases
  // que el lexico tenia que tener, y era la unica que faltaba: la raiz estaba
  // cortada en «graba», que no alcanza la primera persona
  { mensaje: 'te grabo asi, no te muevas', estilo: 'hace-foto' },
  { mensaje: '*te grabo mientras te mueves encima mio*', estilo: 'hace-foto' },
  { mensaje: '*aprieto el boton y listo*', estilo: 'hace-foto' },

  // PEDIRLA SIN NOMBRAR EL SUSTANTIVO. Todas estas son peticiones explicitas,
  // y el diseño dice que una peticion explicita pasa SIEMPRE
  { mensaje: 'hazte una con el pelo suelto', estilo: 'peticion' },
  { mensaje: 'sacate una porfa, la q tu quieras', estilo: 'peticion' },
  { mensaje: 'me la mandas?', estilo: 'peticion' },
  { mensaje: 'me la pasas? 🥺', estilo: 'peticion' },
  { mensaje: 'sacate una y me la mandas anda', estilo: 'peticion' },
  { mensaje: 'mandame algo tuyo anda', estilo: 'peticion' },
  { mensaje: 'me mandas algo subidito de tono?', estilo: 'peticion' },
  { mensaje: 'mandame dos y elijo yo', estilo: 'peticion' },
  { mensaje: 'una tuya ahora mismo porfa', estilo: 'peticion' },
  { mensaje: 'porfa una tuya sonriendo', estilo: 'peticion' },
  { mensaje: 'quiero una tuya en la cama', estilo: 'peticion' },
  { mensaje: 'mandame un selfi', estilo: 'peticion' },
  // el sustantivo «video» a solas: la unica frase que lo llevaba tambien decia
  // «grabame», asi que si desapareciera del lexico nadie se enteraria
  { mensaje: 'quiero un video tuyo', estilo: 'peticion' },
  // la eñe no tiene repuesto en la normalizacion —descomponer convierte «año»
  // en «ano»—, asi que los patrones que la llevan van con las dos grafias
  { mensaje: 'ensename como estas ahora', estilo: 'peticion' },
  { mensaje: 'ensenamela anda', estilo: 'peticion' },
  // «ver» y «mirar», que es su sinonimo directo y no tenia ni un patron
  { mensaje: 'kiero ver como estas', estilo: 'peticion' },
  { mensaje: 'me encantaria ver como te queda', estilo: 'peticion' },
  { mensaje: 'tengo ganas de ver como estas ahora', estilo: 'peticion' },
  { mensaje: 'quiero mirarte un rato', estilo: 'peticion' },
  { mensaje: 'dejame mirarte aunque sea un segundo', estilo: 'peticion' },
  { mensaje: 'a ver esa carita anda', estilo: 'peticion' },
  // la ropa y el «como estas» dicho de las otras maneras: eran cinco cadenas
  // exactas, asi que «que llevas puesto» abria y «que ropa llevas» cerraba
  { mensaje: 'como estas vestida ahora?', estilo: 'peticion' },
  { mensaje: 'que ropa llevas hoy?', estilo: 'peticion' },
  { mensaje: 'que te vas a poner para salir?', estilo: 'peticion' },

  // SEGUIR DESPUES DE RECIBIR UNA. El turno que queda guardado de ella es solo
  // el texto visible —un pie de foto como «Toma, para ti»—, asi que el
  // antecedente textual no sirve y hace falta el dato cierto
  {
    mensaje: 'otra porfa',
    estilo: 'acepta',
    anterior: 'Toma, para ti 🙈',
    imagenAnterior: true,
  },
  {
    mensaje: 'otra',
    estilo: 'acepta',
    anterior: '*se muerde el labio* Ahi va, solo para ti.',
    imagenAnterior: true,
  },
  {
    mensaje: 'una mas porfa, q esa me ha matado',
    estilo: 'acepta',
    anterior: 'Mira lo que te he preparado.',
    imagenAnterior: true,
  },
  {
    mensaje: 'otra igual pero de espaldas',
    estilo: 'acepta',
    anterior: '¿Te gusta lo que ves?',
    imagenAnterior: true,
  },

  // ACEPTAR UN OFRECIMIENTO SUYO QUE NO NOMBRA EL SUSTANTIVO. Es el ejemplo
  // LITERAL con el que el diseño define la excepcion 1, y cerraba: el lexico
  // enumera las formas de PEDIR, y un ofrecimiento suyo va en primera persona
  // del otro lado y con el pronombre delante
  {
    mensaje: 'si, porfa',
    estilo: 'acepta',
    anterior: '¿Quieres que te mande una? 🙈',
  },
  {
    mensaje: 'porfa',
    estilo: 'acepta',
    anterior: 'Estoy con la camisa esa que te gusta. ¿Te la mando?',
  },
  {
    mensaje: 'hazlo',
    estilo: 'acepta',
    anterior: 'Podria mandarte una ahora mismo, si quieres.',
  },
  // doblar la letra es la forma mas comun de alargar una palabra en chat, y el
  // colapso pedia TRES iguales: «siii» abria y «sii» cerraba
  {
    mensaje: 'sii porfa',
    estilo: 'acepta',
    anterior: '¿Quieres que te mande una foto mia ahora mismo? 🙈',
  },
  {
    mensaje: 'porfaa 🥺',
    estilo: 'acepta',
    anterior: '¿Quieres que te mande una foto mia ahora mismo? 🙈',
  },
  {
    mensaje: 'valee',
    estilo: 'acepta',
    anterior: '¿Quieres que te mande una foto mia ahora mismo? 🙈',
  },
  // una interjeccion o un vocativo fuera de la lista tiraba el mensaje entero,
  // porque se exigia que TODAS las palabras estuvieran dentro
  {
    mensaje: 'joder si porfa',
    estilo: 'acepta',
    anterior: '¿Quieres que te mande una foto mia ahora mismo? 🙈',
  },
  {
    mensaje: 'ay si porfa',
    estilo: 'acepta',
    anterior: '¿Quieres que te mande una foto mia ahora mismo? 🙈',
  },
  {
    mensaje: 'uff si',
    estilo: 'acepta',
    anterior: '¿Quieres que te mande una foto mia ahora mismo? 🙈',
  },
  {
    mensaje: 'sip',
    estilo: 'acepta',
    anterior: '¿Quieres que te mande una foto mia ahora mismo? 🙈',
  },
  {
    mensaje: 'jajaja si porfa',
    estilo: 'acepta',
    anterior: '¿Quieres que te mande una foto mia ahora mismo? 🙈',
  },
  {
    mensaje: 'si porfa bebe mio',
    estilo: 'acepta',
    anterior: '¿Quieres que te mande una foto mia ahora mismo? 🙈',
  },
  {
    mensaje: 'obvio q si jajaja',
    estilo: 'acepta',
    anterior: '¿Quieres que te mande una foto mia ahora mismo? 🙈',
  },
  {
    mensaje: 'si, la que quieras',
    estilo: 'acepta',
    anterior: '¿Quieres que te mande una foto mia ahora mismo? 🙈',
  },
  {
    mensaje: 'vale, pero solo una',
    estilo: 'acepta',
    anterior: '¿Quieres que te mande una foto mia ahora mismo? 🙈',
  },
  {
    mensaje: 'no me lo preguntes dos veces',
    estilo: 'acepta',
    anterior: '¿Quieres que te mande una foto mia ahora mismo? 🙈',
  },
  {
    mensaje: 'estaba esperando a q lo dijeras',
    estilo: 'acepta',
    anterior: '¿Quieres que te mande una foto mia ahora mismo? 🙈',
  },
  // un mensaje que se queda en cero palabras al normalizar: un emoji suelto.
  // Despues de un ofrecimiento suyo eso es un si
  {
    mensaje: '🥺🥺',
    estilo: 'acepta',
    anterior: '¿Quieres que te mande una foto mia ahora mismo? 🙈',
  },

  // INSISTIR DESPUES DE UNA EVASIVA QUE NO NOMBRA LA FOTO. Con la puerta
  // cerrada el bloque le manda decir que no puede «con naturalidad», y decirlo
  // en personaje es «Ahora mismo no puedo, amor»: sin la palabra foto. Si el
  // antecedente solo fuese el turno de ella, el bucle se cerraria sobre si
  // mismo. La señal cierta es el turno anterior DEL USUARIO
  {
    mensaje: 'te lo he pedido ya 😒',
    estilo: 'acepta',
    anterior: 'Ahora mismo no puedo, amor... 🥺',
    anteriorUsuario: 'mandame una foto tuya porfa',
  },
  {
    mensaje: 'sigo esperando eh',
    estilo: 'acepta',
    anterior: 'Ahora no, tontorron... quedate aqui conmigo.',
    anteriorUsuario: 'quiero verte ahora mismo',
  },
  {
    mensaje: 'no me la has mandado',
    estilo: 'acepta',
    anterior: 'Ahora no, tontorron... quedate aqui conmigo.',
    anteriorUsuario: 'mandame una foto anda',
  },
  {
    mensaje: 'venga ya, no seas asi',
    estilo: 'acepta',
    anterior: 'Ahora no, tontorron... quedate aqui conmigo.',
    anteriorUsuario: 'enseñame como estas',
  },
  {
    mensaje: 'me dejas con las ganas entonces?',
    estilo: 'acepta',
    anterior: 'Ahora no, tontorron... quedate aqui conmigo.',
    anteriorUsuario: 'una foto porfa',
  },
  {
    mensaje: 'me lo prometiste',
    estilo: 'acepta',
    anterior: 'Luego, que ahora no puedo.',
    anteriorUsuario: 'mandame una foto luego eh',
  },

  // ELLA OFRECE SIN NOMBRAR NADA, en las dos formas que quedaban fuera.
  // «¿quieres verme?» es el ofrecimiento mas corto que existe, y el lexico del
  // usuario tiene «verte» y no «verme» a proposito: nadie se pide verse a si
  // mismo. Del otro lado es justo al reves
  {
    mensaje: 'si, porfa',
    estilo: 'acepta',
    anterior: '¿Quieres verme ahora mismo? 😏',
  },
  // y ella ofreciendo a ELEGIR. Aqui el tema no puede estar mas abierto y no
  // hay ni una palabra del lexico: antes cerraban las cinco respuestas
  // naturales, que es peor que el comportamiento que habia antes de la puerta
  {
    mensaje: 'algo nuevo porfa',
    estilo: 'acepta',
    anterior: '¿Cual quieres, amor? ¿La de la cama o algo nuevo?',
  },
  {
    mensaje: 'una nueva',
    estilo: 'acepta',
    anterior: '¿Cual quieres, amor? ¿La de la cama o algo nuevo?',
  },
  {
    mensaje: 'sorprendeme',
    estilo: 'acepta',
    anterior: '¿Cual quieres, amor? ¿La de la cama o algo nuevo?',
  },
  // «una nueva» es una de las tres formas que el propio bloque enumera como
  // «piden GENERAR» —«otra», «otra mas», «una nueva»—, y era la unica de las
  // tres que seguia cerrando despues de recibir una imagen
  {
    mensaje: 'una nueva anda',
    estilo: 'acepta',
    anterior: 'Toma, para ti 🙈',
    imagenAnterior: true,
  },
  {
    mensaje: 'ahora algo distinto',
    estilo: 'acepta',
    anterior: 'Toma, para ti 🙈',
    imagenAnterior: true,
  },
  // PEDIR LA SIGUIENTE DESCRIBIENDO SOLO EN QUE CAMBIA. Es elipsis pura: no
  // hay verbo, no hay sustantivo, no hay nada que nombre una foto, y sin
  // embargo despues de recibir una no tiene otra lectura
  {
    mensaje: 'ahora de espaldas',
    estilo: 'acepta',
    anterior: 'Toma, para ti 🙈',
    imagenAnterior: true,
  },
  {
    mensaje: 'y ahora sin la camisa 😏',
    estilo: 'acepta',
    anterior: '*se muerde el labio* Ahi va, solo para ti.',
    imagenAnterior: true,
  },
  {
    mensaje: 'mas cerca anda',
    estilo: 'acepta',
    anterior: 'Mira lo que te he preparado.',
    imagenAnterior: true,
  },
  // el pronombre pegado se comia el giro entero: el patron pedia limite de
  // palabra detras de «decir» y la «t» de «decirte» lo rompia
  {
    mensaje: 'como para decirte q no',
    estilo: 'acepta',
    anterior: '¿Quieres que te mande una foto mia ahora mismo? 🙈',
  },
];

/**
 * lo que la puerta abre SIN que nadie haya pedido una foto, medido y aceptado.
 *
 * No es una tabla de aciertos: es la factura del error barato. El lexico es
 * generoso a proposito —abrir de mas devuelve el turno al comportamiento de
 * hoy, decide el prompt— y estas son las frases de escena y de charla que se
 * cuelan por esa generosidad. Se miden aqui por una razon concreta: `PUERTA_ABRE`
 * y `PUERTA_CIERRA` no contenian ni una sola de ellas, asi que sus aciertos
 * median un vocabulario elegido para no chocar y la tabla no podia fallar por
 * el motivo por el que existe.
 *
 * NO se arregla recortando el lexico a ojo. Cada una de estas cuelga de un
 * patron que sostiene solo un caso legitimo —«posa para mi», «*levanto el movil
 * y disparo*», «quiero verte»—, y quitarlo reabre `D-086`, que costo dos
 * arreglos. Lo que decide si alguno sobra es el diagnostico sobre la boveda
 * real (paso 1 del diseño), que da la frecuencia de verdad; hasta entonces esto
 * es una cifra, no una lista de tareas.
 *
 * Si alguna de estas pasa a CERRAR, no es un fallo: es que se acoto un patron a
 * proposito. Entonces se mueve a `PUERTA_CIERRA` y se escribe por que.
 */
export const PUERTA_ABRE_DE_MAS: readonly string[] = [
  // `desnud`, que sostiene «desnudate para mi» y «quiero una foto tuya desnuda»
  '*te tumbo desnuda en la cama*',
  'te tumbas desnuda a mi lado y me miras',
  // `te veo` y `verte`, que sostienen «quiero verte» y «q ganas de verte»
  'te veo cansada hoy',
  'te veo agotada, duerme ya',
  'me encanta verte disfrutar',
  'me encanta verte asi de feliz',
  'te quiero ver feliz, nada mas',
  // `movil`, que sostiene «*levanto el movil y disparo*»
  'donde tienes el movil? te llamo',
  // `no se ve` y `no veo nada`, que sostienen el aviso de que la imagen fallo
  'no se ve nada aqui, apaga la luz',
  'no veo nada con esta luz',
  // `enseñ` y `muestra`, que sostienen «enseñamela» y «muestrame como estas»
  'enseñame a cocinar eso',
  'muestrame ese lado tuyo q no conozco',
  // `dispar`, `pos(a)` y `captur`, que sostienen los tres el caso `D-086`
  'dispara, te escucho',
  'posa tu cabeza en mi hombro',
  'captura este momento en tu memoria',
];
