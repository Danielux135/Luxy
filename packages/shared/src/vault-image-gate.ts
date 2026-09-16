// la puerta que decide si en ESTE turno se le ofrece generar una imagen.
//
// EL FALLO, con dos casos reales del 2026-09-15 en la misma conversacion:
//
// - 14:11. El escribio «Tu ya me has hecho temblar, gritar, romperme,
//   correrme... No tienes que hacerme nada. Tu descansa, Lia.» y el modelo
//   GENERO una imagen de ella acurrucada con los ojos cerrados: ilustro su
//   frase. Nadie habia pedido una foto.
// - unos minutos despues. «Se mi pequeña gatita entonces. *Le acaricio como si
//   fuese una gata suave* Pero no me arañes mas, porfa... tengo la espalda
//   destrozada.» Otra imagen, otra vez sin que nadie la pidiera.
//
// Cada una costo hasta 25 minutos de cola en AI Horde y rompio el cierre de la
// escena. Y el prompt ya lo prohibia: el bloque de imagen ocupa 6.383
// caracteres, el 33% del turno, y aun asi no se cumplio. Mas texto no lo
// arregla, porque el problema es de SITIO: el bloque le pide al modelo que
// decida algo que el programa ya sabe antes de llamarlo.
//
// Lo que este modulo saca del prompt NO es «que imagen mandar», que el modelo
// hace bien. Es «si en este turno la herramienta existe siquiera».
//
// TRES COSAS QUE HAY QUE ENTENDER ANTES DE TOCAR ESTO:
//
// 1. La puerta va ANTES de llamar al modelo, nunca despues. Vetar el bloque
//    despues de que lo escriba es PEOR que el fallo actual: Lia ya habria dicho
//    «toma, mirame» y la foto no llegaria nunca. Promesa rota, que es la tercera
//    forma de fallar que el bloque prohibe expresamente. Si no se le ofrece
//    generar, no promete generar.
// 2. La puerta es TEMATICA, no gramatical, y ahi esta la diferencia con
//    `D-085`. Alli «hablamos» aparecia constantemente y habia que leer la
//    construccion entera. Aqui «foto» casi nunca aparece por casualidad: los dos
//    casos legitimos —pedir una imagen, o hacer una foto dentro de la escena—
//    EXIGEN nombrar el asunto. Alto alcance y baja precision a proposito: esto
//    no sustituye al prompt, le quita los turnos en los que el tema nunca salio.
// 3. Los errores no cuestan lo mismo. Abrir de mas deja las cosas como estan
//    hoy: decide el prompt. Cerrar de menos rompe `D-086` y el arreglo del
//    2026-09-15. Por eso el lexico es generoso y ante la duda se ABRE.
//
// Este modulo es PURO: no lee disco, no habla con nadie y no guarda estado.
// Solo mira el texto de este turno, el anterior de cada uno y dos datos ciertos.

/**
 * por que se abrio o se cerro la puerta.
 *
 * Va al log de cada turno porque «cerrada» a secas no se puede diagnosticar:
 * un cierre por `sin-motivo` en un turno que si pedia una foto es un agujero
 * del lexico, y se arregla ampliandolo.
 */
export const VAULT_IMAGE_GATE_REASONS = [
  /** el mensaje nombra el asunto: pide una imagen o hace una foto en la escena */
  'pide-o-hace-foto',
  /** el tema ya estaba abierto en el turno anterior y este lo continua */
  'acepta-ofrecimiento',
  /** la imagen del turno anterior no llego a generarse: dato cierto, no adivinanza */
  'fallo-anterior',
  /** nadie ha hablado de imagenes en este turno */
  'sin-motivo',
] as const;
export type VaultImageGateReason = (typeof VAULT_IMAGE_GATE_REASONS)[number];

export interface VaultImageGateInput {
  /** lo que acaba de escribir el usuario, tal cual */
  message: string;
  /**
   * el ultimo turno de ella, tal cual, o `null` si no hay ninguno.
   *
   * Hace falta para una sola cosa: entender «si, porfa». Un asentimiento no
   * nombra el asunto, asi que sin el turno anterior es indistinguible de
   * cualquier otro «vale» de la escena.
   */
  previousAssistantText?: string | null;
  /**
   * el turno anterior DEL USUARIO, o `null` si este es el primero.
   *
   * PASO DE VERDAD que lo obliga: el pide una foto, la puerta abre, ella la
   * esquiva en personaje SIN nombrarla —«Ahora no, tontorron... quedate aqui
   * conmigo»— y el insiste. Si solo se mirase el turno de ella, ese turno de
   * insistencia cerraria, porque su evasiva no dice «foto» por ningun lado: el
   * bucle se cerraria sobre si mismo hasta que a Daniel se le ocurriese
   * escribir la palabra. La evasiva en personaje es la tercera forma de fallar
   * que el bloque prohibe, asi que el turno siguiente TIENE que poder generar.
   */
  previousUserText?: string | null;
  /**
   * en el turno anterior ella mando o genero una imagen. Dato cierto.
   *
   * Es lo que hace que «otra porfa» funcione. El turno que queda guardado de
   * ella es solo el texto visible —el bloque se recorta antes de guardarlo—,
   * asi que un pie de foto («Toma, para ti 🙈») no nombra nada y el antecedente
   * textual no sirve. Sin este dato, pedir otra justo despues de recibir una
   * cerraba la puerta, y con la puerta cerrada la unica salida del modelo es
   * reenviar la que acaba de mandar: el daño exacto del 2026-09-14.
   */
  previousTurnSentImage?: boolean;
  /**
   * la imagen del turno anterior fallo y el usuario no la ha visto nunca.
   *
   * Con esto la puerta se abre a la fuerza. No es una adivinanza sobre el
   * texto —«no me ha llegado» y compañia—, es un dato que Luxy ya guarda de
   * cierto, y un dato cierto gana siempre a una adivinanza. Es el mismo
   * criterio que hizo quitar la regla adivinatoria del 2026-09-14.
   */
  lastImageFailed?: boolean;
}

export interface VaultImageGateDecision {
  /** si en este turno se le ofrece GENERAR. Reenviar no pasa nunca por aqui */
  open: boolean;
  reason: VaultImageGateReason;
}

// ---------------------------------------------------------------------------
// normalizacion

/**
 * las vocales acentuadas, escritas una a una.
 *
 * Se hace asi y no con `normalize('NFD')` por dos motivos que ya costaron un
 * rato en `turn-index.ts`: descomponer convierte «año» en «ano», que es otra
 * palabra y bastante desafortunada, y la alternativa —apartar la eñe con un
 * caracter centinela de control— deja dentro del archivo un caracter invisible
 * que no sobrevive a una copia. Un mapa explicito se lee y no tiene trampa.
 *
 * La eñe se queda como esta, y por eso TODO patron que la lleve dentro va
 * escrito con las dos grafias («enseñ» y «ensen»): con el teclado a medias o
 * con prisa, «ensename» es lo que sale, y sin repuesto esa frase se quedaba sin
 * lexico entero. Es el mismo apaño que `recall.ts` hace con «cariño|carino».
 */
const ACCENTS: Readonly<Record<string, string>> = {
  á: 'a',
  à: 'a',
  ä: 'a',
  â: 'a',
  é: 'e',
  è: 'e',
  ë: 'e',
  ê: 'e',
  í: 'i',
  ì: 'i',
  ï: 'i',
  î: 'i',
  ó: 'o',
  ò: 'o',
  ö: 'o',
  ô: 'o',
  ú: 'u',
  ù: 'u',
  ü: 'u',
  û: 'u',
};

/**
 * minusculas, sin tildes, sin emojis, sin asteriscos y con las abreviaturas de
 * chat escritas enteras.
 *
 * Es una VARIANTE de `forPatterns` (`apps/desktop/src/main/vault/recall.ts`),
 * no la misma funcion, y la diferencia importa: alli se borra lo que va entre
 * asteriscos porque es escena y no pregunta. Aqui la escena es justo el caso
 * legitimo numero 2 —«*levanto el movil y disparo*», «*click*»—, asi que los
 * asteriscos se quitan y su contenido SE QUEDA.
 *
 * LAS LETRAS REPETIDAS se colapsan porque asi escribe Daniel de verdad:
 * «siiii», «porfaaa». La primera version pedia TRES iguales seguidas
 * (`\1{2,}`) y eso dejaba un escalon invisible en la forma mas comun de todas,
 * que es doblar la letra: «siii» abria y «sii» cerraba, «porfaaa» abria y
 * «porfaa» cerraba. La misma palabra decidia una cosa u otra segun cuanto se
 * dejo pulsada la tecla, y con ella ofreciendo la foto en el turno anterior eso
 * la hacia desdecirse una linea despues.
 *
 * Se colapsa en dos pasadas y no en una sola de `\1+` a proposito: bajar el
 * cuantificador general a dos convierte «llevas» en «levas» y «llegado» en
 * «legado», y los patrones del lexico —«que llevas puesto», «no me ha
 * llegado»— dejan de casar. Las vocales no tienen ese problema en castellano.
 */
function forGate(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[áàäâéèëêíìïîóòöôúùüû]/gu, (char) => ACCENTS[char] ?? char)
      // todo lo que no es letra, numero o puntuacion util pasa a ser un espacio:
      // emojis, asteriscos, guiones bajos y cercas. El contenido sobrevive
      .replace(/[^\p{L}\p{N}\s¿?¡!.,;:'"«»()-]/gu, ' ')
      // cualquier letra tres veces o mas: «okkk», «jajaja» no, «nooo» si
      .replace(/(\p{L})\1{2,}/gu, '$1')
      // y las vocales ya desde dos, que es como se alarga de verdad
      .replace(/([aeiou])\1+/gu, '$1')
      .replace(/\b(?:q|k)\b/gu, 'que')
      .replace(/\b(?:pq|xq|porq|porke)\b/gu, 'por que')
      .replace(/\bpa\b/gu, 'para')
      .replace(/\b(?:xfa|xfi|pf)\b/gu, 'porfa')
      .replace(/\s+/gu, ' ')
      .trim()
  );
}

// ---------------------------------------------------------------------------
// el lexico

/**
 * lo que hace que un turno hable de imagenes.
 *
 * REGLA AL AMPLIARLO: se añade lo que pueda faltar, no se quita lo que sobre.
 * Una palabra de mas devuelve el turno al comportamiento de hoy —decide el
 * prompt, como siempre—; una de menos cierra un turno legitimo y reabre
 * `D-086`, que costo dos arreglos.
 *
 * Nada de esto son palabras sueltas elegidas a ojo: cada grupo cubre una forma
 * real de nombrar una foto en una escena intima.
 */
const IMAGE_TOPIC: readonly RegExp[] = [
  // el sustantivo, en todas sus formas de chat: foto, fotos, fotito, fotaza,
  // fotografia, y tambien el prestamo ingles («mandame un pic»)
  // «fotito» y «fotaza» van aparte: `\bfoto` NO casa con ellas —la raiz se
  // parte en «foti»— y el comentario de la primera version daba por hecho que si
  /\bfoto|\bfotit|\bfotaz/u,
  /\bfotograf/u,
  /\bpic\b/u,
  /\bnude/u,
  /\bimagen\b|\bimagenes\b/u,
  /\bretrat/u,
  // la raiz se corta en «selfi» y no en «selfie»: «un selfi» es la forma
  // adaptada al castellano y se escribe asi con normalidad, no es una errata
  /\bselfi/u,
  /\bautofoto|\bautorretrat/u,
  /\bpostal\b|\binstantanea\b/u,
  // video y grabacion. «grabame» lo pidio Daniel tal cual, y no lleva ni foto
  // ni imagen dentro. La raiz se corta en «grab» por el mismo motivo que
  // «enfoc» dos grupos mas abajo: cortada en «graba» se quedaba fuera «te
  // grabo», que es como se escribe dentro de la escena, y el diseño aprobado
  // nombraba esa frase por escrito como una de las tres que no podian faltar
  /\bvideo/u,
  /\bgrab/u,
  /\bwebcam\b|\bvideollamada\b/u,
  // el aparato y el acto de disparar: es el caso 2 de `D-086` escrito con la
  // camara en vez de con la foto. «*click*» y «*levanto el movil*» son esto
  /\bcamara\b|\bcamaras\b/u,
  /\bmovil\b|\btelefono\b|\bcelular\b|\biphone\b/u,
  /\bflash\b|\bobturador\b/u,
  /\bclick\b|\bclic\b/u,
  /\bdispar/u,
  // sin recortar la raiz se quedaba fuera la primera persona, que es como se
  // escribe dentro de la escena: «*enfoco y aprieto el boton*». Lo caza la
  // tabla ABREN, y la regla es ampliar el lexico, no retocar la frase
  /\benfoc/u,
  /\binmortaliz|\bcaptur/u,
  /\bpos(?:a|as|ar|ando|e|es)\b/u,
  // el gesto sin nombrar el aparato: «*aprieto el boton y listo*»
  /\b(?:aprieto|apreto|aprieta|pulso|pulsa) (?:el |al )?boton\b/u,
  // enseñar y mostrar: el verbo con el que se pide ver algo, con o sin
  // pronombre pegado («enseñamela», «muestrame»). Con la eñe y sin ella
  /\bense(?:ñ|n)/u,
  /\bmuestra|\bmostra/u,
  // ver referido a ELLA. «ver» a secas se queda fuera a proposito: «a ver si»
  // y «vamos a ver» aparecen en cualquier turno y abririan la puerta siempre.
  // «mirar» va calcado de «ver»: es su sinonimo directo y no tenia ni un solo
  // patron, asi que «dejame mirarte» cerraba mientras «dejame verte» abria
  /\bver(?:te|la|las|lo|los|nos)\b/u,
  /\bmirar(?:te|la|las|lo|los|nos)\b|\bmirate\b/u,
  /\bte ve(?:o|a|as|ria)\b/u,
  // la lista de verbos de deseo delante de «ver» estaba en cinco, y con cinco
  // «quiero ver como te queda» abria y «me encantaria ver como te queda»
  // cerraba: la misma frase a cara o cruz segun el verbo. «kiero» y «qiero»
  // van dentro porque son la tecla de al lado, no un estilo
  /\b(?:quiero|kiero|qiero|puedo|dejame|deja|dejas|podria|necesito|quisiera|me encantaria|me gustaria|me apetece|apetece|tengo ganas de|ganas de) (?:ver|mirar)\b/u,
  /\bdeja que te vea\b|\bme dejas ver\b|\bme dejas mirar\b/u,
  // «a ver» a secas es charla, pero «a ver esa carita» es una peticion: lo que
  // lo separa es el determinante detras, no el verbo
  /\ba ver (?:esa|ese|esas|esos|tu|tus)\b/u,
  // las que no son obvias y son peticiones igual: preguntar como esta AHORA o
  // que lleva puesto es pedir verla, aunque no nombre ninguna foto. Estaban
  // escritas como cinco cadenas exactas, y entonces «que llevas puesto» abria
  // y «que ropa llevas» cerraba. Se dice la categoria, no la frase
  /\bcomo estas (?:ahora|en este momento|vestida|vestido|de ropa)\b/u,
  /\bcomo (?:vas|andas) (?:ahora|vestida|vestido|de ropa)\b/u,
  /\bque (?:llevas|tienes) puest(?:o|a)\b/u,
  /\bque te has puesto\b|\bque te vas a poner\b|\bque ropa (?:llevas|tienes|te has puesto)\b/u,
  /\bdesnud/u,
  // «mandame una», «hazme otra», «sacame una»: el objeto no se nombra, pero la
  // construccion solo tiene un significado. Van tres conjugaciones y no una:
  //
  // - el imperativo y el presente de segunda persona —«me mandas una?»—, que en
  //   castellano es la forma normal de pedir algo sin sonar a orden;
  // - la PRIMERA persona, que es como se narra `D-086` desde dentro de la
  //   escena: «te saco una», «te hago una sin q te des cuenta», «te grabo».
  //   Faltaba entera, asi que la frase canonica solo abria por llevar la
  //   palabra «foto» al lado; quitandosela, cerraba;
  // - los reflexivos «hazte una» y «sacate una», que es como se pide un selfie
  //   cuando la foto se la hace ella. Hasta ahora «hazme una» abria y «hazte
  //   una» cerraba, siendo la segunda la mas natural de las dos.
  //
  // «ponte», «echate» y «tirate» se quedan FUERA a proposito, aunque sean
  // reflexivos igual: «ponte una camiseta», «echate una siesta» y «tirate una
  // hora» son escena corriente y de las tres no sale ninguna foto nunca.
  //
  // Y detras va una lista de sustantivos que no son una imagen jamas, porque
  // esta construccion es «verbo muy frecuente + articulo indefinido» y sin ella
  // se come media escena intima: «echame una mano», «dame una tregua»,
  // «hazme una paja». Solo desactiva ESTE patron: si la frase nombra una foto
  // de cualquier otra forma, sigue abriendo por su propio grupo
  /\b(?:manda|mandame|mandas|mando|mandando|envia|enviame|envias|envio|enviando|pasa|pasame|pasas|paso|pasando|echa|echame|echas|echo|echando|saca|sacame|sacas|saco|sacando|sacate|haz|hazme|hazte|haces|hago|haciendo|tira|tirame|tiras|tiro|tirando|pon|ponme|pones|pongo|dame|das|doy|regalame|regalas|pillo|pillando|robo|robando|cojo|quiero|kiero|qiero|necesito|quisiera|mandarme|mandarte|enviarme|enviarte|pasarme|pasarte|sacarme|sacarte|sacarle|hacerme|hacerte|hacerle|enseñarme|ensenarme|enseñarte|ensenarte|mostrarme|ponerme) (?:una|otra|otras|alguna|algunas|unas|dos|tres|un par)\b(?! (?:mano|manos|siesta|siestas|tregua|copa|copas|cerveza|birra|cana|canas|tila|tortilla|cena|comida|pizza|caricia|caricias|sonrisa|sonrisas|pregunta|preguntas|ducha|manta|peli|pelicula|serie|vuelta|vueltas|idea|ideas|oportunidad|tonteria|risa|risas|broma|bromas|charla|llamada|semana|semanas|hora|horas|rato|vez|veces|cosa|cosas|duda|dudas|explicacion|ayuda|pausa|historia|historias|cancion|receta|lista|promesa|camiseta|camisa|chaqueta|falda|postura|posturas|excusa|razon|ronda|paja|pajas|mamada|pena|escena|cita|paliza|torta|hostia|colleja|palmada|azote|azotes|nalgada|patada|cabezada|vueltecita|mierda|minuto|minutos|segundo|segundos|dia|dias|indirecta|indirectas|excusas|birras|cañas|pista|pistas|señal|señales|tila|infusion|tostada|tostadas)\b)/u,
  // el mismo verbo con el objeto sin verbo delante: «una tuya sonriendo»,
  // «otra tuya pero de espaldas», «mandame algo tuyo». «Tuya» y «algo tuyo» no
  // tienen otra lectura posible en esta conversacion
  /\b(?:una|otra|otras|unas|alguna) tuy(?:a|as|o|os)\b/u,
  /\balgo tuy(?:o|a)\b|\balgo de ti\b/u,
  // «algo» a secas cuando lo que se pide es que ella mande o enseñe algo. Es
  // frecuente justo cuando no se quiere concretar, que es el registro de una
  // escena intima, y «me mandas algo?» aqui no tiene otra lectura
  /\b(?:manda|mandame|mandas|envia|enviame|envias|pasa|pasame|pasas|enseña|enseñame|ensename|enseñas|muestra|muestrame|quiero|kiero|necesito|dame) algo\b/u,
  // el mismo verbo con el pronombre pegado: «mandamela», «pasamela», «ponla»,
  // «hazmela», «sacatela»
  /\b(?:manda|envia|pasa|saca|echa|tira|pon|enseña|ensena|muestra|haz)(?:me|te|nos)?l(?:a|as|o|os)\b/u,
  // y con el pronombre SUELTO y delante, que es como se pide en presente de
  // segunda persona: «me la mandas?», «me la pasas?». Esa forma se quedaba
  // entre los dos patrones de arriba —uno exige el clitico soldado, el otro un
  // objeto explicito, y el pronombre es justo lo que sustituye al objeto—.
  // «pon» y «pones» se quedan fuera aqui por un motivo concreto: «me la pones
  // dura» no habla de ninguna imagen y es frecuente en esta conversacion
  /\b(?:me|nos) l(?:a|as|o|os) (?:manda|mandas|mandes|envia|envias|pasa|pasas|enseña|enseñas|ensena|ensenas|muestra|muestras|saca|sacas|echa|echas|tira|tiras|haces|hace|das|da)\b/u,
  // la imagen anterior no llego. El dato cierto (`lastImageFailed`) es mejor y
  // va primero, pero se pierde al reiniciar Luxy y esto es la red debajo.
  // Participio y con pronombre: «no llego» a secas es otra cosa en una escena
  // intima, y abrirla por eso seria perder el ahorro justo donde mas se nota
  /\bno (?:me )?(?:ha )?llegado\b|\bno me llego\b/u,
  /\bno (?:me )?carga\b|\bno se ve\b|\bno la veo\b|\bno veo nada\b|\bsigo sin ver\b/u,
];

/**
 * si un texto habla de imagenes.
 *
 * Se usa con el mensaje del usuario y tambien con el turno anterior de ella,
 * que es como se entiende un «si, porfa» suelto.
 */
export function mentionsImageTopic(text: string): boolean {
  const normalized = forGate(text);
  return IMAGE_TOPIC.some((pattern) => pattern.test(normalized));
}

/**
 * ella OFRECIENDO una imagen, que es otra conjugacion.
 *
 * El lexico de arriba esta escrito para el mensaje del USUARIO, asi que enumera
 * las formas de PEDIR —imperativo y segunda persona— y las de NARRAR la escena
 * —primera persona—. Un ofrecimiento suyo no es ninguna de las dos: es primera
 * persona pero del otro lado («¿quieres que te mande una?», «¿te la mando?»),
 * y ademas suele llevar el pronombre delante y no detras.
 *
 * Sin esto, el ejemplo LITERAL con el que el diseño define la excepcion 1
 * —ella dice «¿quieres que te mande una?» y el contesta «si»— cerraba la
 * puerta: ella acababa de ofrecer la foto y al turno siguiente se le mandaba
 * decir que no puede generar ninguna. Esa es la promesa rota que esta puerta
 * existe para evitar, producida por la puerta misma.
 *
 * Aqui se puede ser mas laxo que con el mensaje del usuario sin coste: esto
 * solo decide si el turno anterior deja el tema ABIERTO, y encima hace falta
 * ademas que el mensaje de este turno sea una respuesta corta.
 */
const OFFER_TOPIC: readonly RegExp[] = [
  /\b(?:te|os) l(?:a|as|o|os) (?:mando|mande|mandaria|envio|envie|paso|pase|enseño|enseñe|enseno|ensene|saco|saque|hago|haga|pongo|ponga)\b/u,
  /\b(?:mando|mande|mandaria|envio|envie|paso|pase|enseño|enseñe|enseno|ensene|saco|saque|sacaria|hago|haga|haria|pongo|ponga) (?:una|otra|alguna|unas|dos)\b/u,
  /\b(?:mandarte|enviarte|pasarte|enseñarte|ensenarte|hacerte|sacarte|ponerte) (?:una|otra|alguna|unas)\b/u,
  /\bmirame\b|\bmira lo que\b/u,
  /\bquieres que te l(?:a|as|o|os)\b/u,
  // «¿quieres verme?». El lexico del usuario tiene «verte» y no «verme» por un
  // motivo: el usuario no se pide verse a si mismo. Del otro lado es justo al
  // reves, y este es el ofrecimiento mas corto que existe
  /\bquieres ver(?:me|nos)\b|\bme quieres ver\b|\bte apetece verme\b/u,
  // ella ofreciendo a ELEGIR entre lo que hay y algo nuevo: «¿cual quieres, la
  // de la cama o algo nuevo?». No nombra ninguna foto y sin embargo el tema no
  // puede estar mas abierto; despues de eso «algo nuevo porfa» o «sorprendeme»
  // cerraban, y eso es peor que el comportamiento que habia antes de la puerta
  /\bcual (?:quieres|prefieres|te gusta|te apetece|te mando)\b/u,
];

function previousTurnOffersImage(text: string): boolean {
  const normalized = forGate(text);
  return OFFER_TOPIC.some((pattern) => pattern.test(normalized));
}

// ---------------------------------------------------------------------------
// continuar el tema que ya estaba abierto

/**
 * palabras que por si solas dicen que si.
 *
 * Esto NO es la lista de palabras permitidas: es la lista de las que cuentan.
 * La primera version exigia que el mensaje ENTERO estuviera hecho de una lista
 * cerrada de unas cuarenta palabras, y eso significaba que una sola palabra de
 * fuera —una interjeccion, un vocativo, una risa— tiraba el turno entero:
 * «joder si porfa», «ay si porfa», «uff si», «jajaja si porfa» y «si porfa bebe
 * mio» cerraban todos con ella ofreciendo la foto una linea antes. El
 * vocabulario de interjecciones del castellano de chat no es cerrado y no se
 * puede cubrir alargando la lista; lo que estaba invertido era el criterio.
 *
 * Ahora basta con que aparezca UNA de estas, y eso es lo que sigue separando
 * «si, porfa» de un elogio corto despues de una foto: «joder que guapa estas»
 * no lleva ninguna dentro.
 */
const ASSENT_CORE = new Set([
  'si',
  'sisi',
  'sip',
  'sipi',
  'claro',
  'vale',
  'venga',
  'dale',
  'porfa',
  'porfi',
  'porfis',
  'porfita',
  'porfavor',
  'porfaporfa',
  'plis',
  'please',
  'obvio',
  'evidentemente',
  'ok',
  'oka',
  'okk',
  'okey',
  'okay',
  'bueno',
  'guay',
  'genial',
  'perfecto',
  'anda',
  'va',
  'vamos',
  'quiero',
  'kiero',
  'qiero',
  'necesito',
  'quisiera',
  'hazlo',
  'adelante',
  'sorprendeme',
  'ya',
  'eso',
  // seguir despues de recibir una: «otra», «otra porfa», «una mas». Es el
  // seguimiento mas frecuente que existe en este uso, y cerraba entero. Con la
  // puerta cerrada y la boveda con imagenes, la unica salida que le queda al
  // modelo es reenviar la que acaba de mandar, que es el paso de verdad del
  // 2026-09-14: pidio «dame otra foto» y le reenvio la de antes
  'otra',
  'otras',
  'mas',
  'dos',
  'unas',
  // y pedir que sea NUEVA, que es como se contesta a «¿la de la cama o algo
  // nuevo?». El bloque enumera «otra», «otra mas», «una nueva» como las formas
  // de pedir que GENERE, y de las tres esta era la unica que cerraba
  'nueva',
  'nuevo',
  'nuevas',
  'nuevos',
  'distinta',
  'distinto',
  // LOS VOCATIVOS SE FUERON, y es la otra mitad de invertir el criterio. Con la
  // lista cerrada habia que meter «tonta», «bebe», «guapa» o «cariño» dentro,
  // porque un «si» pelado casi no existe en esta conversacion —se escribe
  // «claro q si tonta»— y una palabra de tono fuera de la lista tiraba la frase
  // entera. Ahora que basta UNA palabra de asentimiento, tenerlos aqui hace lo
  // contrario de lo que se queria: «joder que guapa estas» y «eres preciosa»
  // —la reaccion normal a una foto— pasarian a abrir la puerta, y el ahorro se
  // perderia en el turno siguiente a cada imagen. El tono no dice que si.
]);

/** giros de asentimiento que no son una palabra suelta */
const ASSENT_PHRASES: readonly RegExp[] = [
  /\bpor favor\b/u,
  /\bpor supuesto\b/u,
  /\bdesde luego\b/u,
  /\bfaltaria mas\b/u,
  /\bme encantaria\b|\bme gustaria\b/u,
  /\bganas\b|\bme muero\b/u,
  /\b(?:la|las|lo|los) que quieras\b|\bcomo quieras\b|\btu eliges\b/u,
  // sin `\b` final a proposito: «como para decirte que no» es la forma en que
  // se dice de verdad, y el limite de palabra detras de «decir» la dejaba fuera
  // por la «t» del pronombre pegado
  /\bno me lo preguntes\b|\bestaba esperando\b|\bcomo para decir/u,
];

/**
 * insistir despues de una evasiva: «te lo he pedido ya», «sigo esperando».
 *
 * La primera version solo conocia la familia de «pedir», y el reproche se
 * escribe de muchas mas formas: «no me la has mandado», «me lo prometiste»,
 * «donde esta?», «sigo esperando eh». Todas salen del mismo sitio —ella
 * esquivo la peticion, que es la tercera forma de fallar que el bloque
 * prohibe— y todas tienen que abrir el turno siguiente.
 */
const INSISTENCE: readonly RegExp[] = [
  /\b(?:pedido|pedi|pido|pidiendo|insisto|repito)\b/u,
  /\besperando\b|\besperar\b|\bsigo esperando\b/u,
  /\bprometiste\b|\bprometido\b|\bibas a\b|\bdijiste\b/u,
  /\bdonde esta\b|\bdonde la tengo\b/u,
  /\bno me l(?:a|o) has\b|\bsigo sin\b/u,
  /\bvenga ya\b|\by eso\b|\bno seas asi\b|\bme dejas con las ganas\b/u,
];

/**
 * pedir la SIGUIENTE distinta, describiendo solo en que cambia.
 *
 * Cuando ella acaba de mandar una, la variante se pide por elipsis y sin ningun
 * verbo: «ahora de espaldas», «y ahora sin la camisa», «mas cerca». No hay nada
 * ahi que nombre una foto, asi que el lexico no las veia y la puerta cerraba
 * justo el seguimiento mas natural que hay despues de una imagen —y con la
 * puerta cerrada la unica salida del modelo es reenviar la misma, que es el
 * daño del 2026-09-14.
 *
 * Esto NO va en `IMAGE_TOPIC` a proposito: «de espaldas» y «sin la camisa» son
 * escena corriente en cualquier otro turno. Solo cuenta cuando el tema ya
 * estaba abierto, y ahi la lectura es una sola.
 */
const VARIANT_REQUEST: readonly RegExp[] = [
  /\bde (?:espaldas|frente|perfil|rodillas|lado|puntillas|cintura para)\b/u,
  /\bsin (?:la |el |las |los |esa |ese |esas |esos )?(?:ropa|camisa|camiseta|sujetador|braga|bragas|pantalon|pantalones|falda|vestido|toalla|nada)\b/u,
  /\bmas cerca\b|\bde cerca\b|\bprimer plano\b|\bmas lejos\b|\bcuerpo entero\b/u,
];

function tokens(normalized: string): string[] {
  return normalized.split(/[^\p{L}\p{N}]+/u).filter((token) => token.length > 0);
}

/**
 * si el mensaje continua el tema que el turno anterior dejo abierto.
 *
 * Tres formas, y todas exigen que el tema estuviera abierto:
 *
 * - un mensaje que se queda en CERO palabras, o sea un emoji suelto («🥺»).
 *   Despues de «¿te mando una?» eso es un si, y antes cerraba;
 * - un asentimiento corto que lleva dentro una palabra de asentimiento;
 * - una insistencia, que es lo que se escribe cuando ella ha esquivado la
 *   peticion;
 * - pedir la siguiente describiendo solo en que cambia: «ahora de espaldas».
 *
 * El limite de palabras no es cosmetico: es lo que distingue «si, porfa» de una
 * escena entera que por casualidad lleva un «vale» dentro.
 */
function continuesTheTopic(normalized: string): boolean {
  const words = tokens(normalized);
  if (words.length === 0) return true;
  if (words.length > 10) return false;
  if (INSISTENCE.some((pattern) => pattern.test(normalized))) return true;
  if (VARIANT_REQUEST.some((pattern) => pattern.test(normalized))) return true;
  if (words.length > 8) return false;
  if (words.some((word) => ASSENT_CORE.has(word))) return true;
  return ASSENT_PHRASES.some((pattern) => pattern.test(normalized));
}

/**
 * si el tema ya estaba abierto al empezar este turno.
 *
 * Tres señales, dos de ellas datos ciertos y no lecturas del texto:
 *
 * 1. en el turno anterior ella MANDO una imagen. No hace falta que su pie de
 *    foto nombre nada, y no lo nombra casi nunca;
 * 2. su turno anterior habla de imagenes o esta ofreciendo una;
 * 3. el turno anterior DEL USUARIO hablaba de imagenes. Esta es la que rompe
 *    el bucle de la evasiva muda: si el pidio una foto y ella contesto «ahora
 *    no puedo, amor» sin nombrarla, el tema sigue abierto aunque su texto no lo
 *    diga.
 */
function topicWasAlreadyOpen(input: VaultImageGateInput): boolean {
  if (input.previousTurnSentImage === true) return true;
  const previousAssistant = input.previousAssistantText ?? '';
  if (
    previousAssistant.length > 0 &&
    (mentionsImageTopic(previousAssistant) || previousTurnOffersImage(previousAssistant))
  ) {
    return true;
  }
  const previousUser = input.previousUserText ?? '';
  return previousUser.length > 0 && mentionsImageTopic(previousUser);
}

// ---------------------------------------------------------------------------

/**
 * si en este turno se le ofrece GENERAR una imagen nueva.
 *
 * No decide QUE imagen ni si toca reenviar: eso lo sigue decidiendo el prompt,
 * que lo hace bien. Y no toca nunca el camino de reenviar (`mediaId`):
 * reenviar es gratis e inmediato, asi que cerrarlo no ahorra nada y si puede
 * romper una escena.
 *
 * Cuando se equivoca y cierra, degrada bien: Lia dice «ahora no puedo mandarte
 * una nueva» —frase que el camino cerrado ya trae escrita— y el turno siguiente
 * Daniel lo nombra y la puerta se abre. El falso negativo se recupera en un
 * mensaje.
 */
export function imageTurnOpensGate(input: VaultImageGateInput): VaultImageGateDecision {
  // el dato cierto manda sobre cualquier lectura del texto
  if (input.lastImageFailed === true) return { open: true, reason: 'fallo-anterior' };

  if (mentionsImageTopic(input.message)) return { open: true, reason: 'pide-o-hace-foto' };

  if (topicWasAlreadyOpen(input) && continuesTheTopic(forGate(input.message))) {
    return { open: true, reason: 'acepta-ofrecimiento' };
  }

  return { open: false, reason: 'sin-motivo' };
}
