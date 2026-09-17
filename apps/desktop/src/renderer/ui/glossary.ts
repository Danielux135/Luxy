// glosario de la interfaz: que significa cada tecnicismo y que hay que escribir.
//
// Por que existe: esta aplicacion arrastra vocabulario de tres mundos distintos
// —difusion de imagenes, APIs de modelos de lenguaje y criptografia— y ninguno
// de los tres se explica solo. Un campo llamado «clipSkip» no le dice nada a
// nadie que no venga ya de ahi, y adivinarlo cuesta kudos, creditos o una tarde.
//
// Reglas de escritura, y son el motivo de que esto sea un archivo y no textos
// sueltos por las pantallas:
//
//   1. Se escribe para alguien que NO sabe nada del tema. Sin «simplemente»,
//      sin «basta con» y sin dar por sabido otro tecnicismo.
//   2. `queEs` explica el concepto. `queRelleno` dice que hacer con ESE cuadro,
//      que es lo que de verdad se pregunta al pararse delante de el.
//   3. `ojo` solo aparece cuando equivocarse cuesta algo real: dinero, una
//      espera larga o un resultado que parece bueno y no lo es.
//   4. Un termino se explica en UN sitio. Si dos pantallas lo usan, comparten
//      esta entrada: dos explicaciones del mismo campo acaban contradiciendose.

export interface GlossaryEntry {
  /** el termino tal y como se dice en voz alta, no el nombre del campo */
  termino: string;
  /** que es, para alguien que no ha oido la palabra nunca */
  queEs: string;
  /** que se escribe en ese cuadro; se omite en lo que no es un campo */
  queRelleno?: string;
  /** un valor concreto que funciona, para poder copiarlo y seguir */
  ejemplo?: string;
  /** solo si equivocarse cuesta dinero, tiempo o un resultado engañoso */
  ojo?: string;
}

export const GLOSSARY = {
  // ---------------------------------------------------------------------------
  // generacion de imagenes
  // ---------------------------------------------------------------------------

  modeloImagen: {
    termino: 'Modelo de imagen',
    queEs:
      'El "pintor" que dibuja. Cada modelo ha aprendido de imágenes distintas, así que uno hace anime, otro hace fotos realistas y ninguno hace bien lo del otro. El nombre tiene que ir escrito exactamente igual, letra por letra.',
    queRelleno:
      'Marca de la lista los que encajen con tu personaje. Puedes marcar hasta cuatro.',
    ojo: 'Marcar varios NO cuesta más y acorta la espera: la petición se la queda el primero que se libere de todos ellos.',
  },

  workers: {
    termino: 'Workers',
    queEs:
      'Los ordenadores de voluntarios que generan las imágenes. AI Horde no tiene servidores propios: presta gente su tarjeta gráfica. Por eso es gratis y por eso a veces hay cola.',
    ojo: 'Un modelo con cero workers no lo está sirviendo nadie ahora mismo: tu petición se quedaría esperando hasta caducar a los diez minutos.',
  },

  kudos: {
    termino: 'Kudos',
    queEs:
      'Los puntos de AI Horde. NO son dinero: no se compran, no se venden y no caducan. Lo único que hacen es decidir en qué puesto de la cola entra tu petición.',
    ojo: 'Con cero kudos se genera igual, sólo que esperando más. Registrarse no los regala: lo que da es un suelo —25 con cuenta de Google, Discord o GitHub— por debajo del cual el saldo no cae, aunque se siga cobrando cada imagen.',
  },

  claveAnonima: {
    termino: 'Clave anónima',
    queEs:
      'Una clave pública que AI Horde deja usar sin registrarse: son diez ceros. Funciona, pero te atiende la última.',
    ojo: 'Con ella el servidor COMPARTE lo que generes: dona tus imágenes a un conjunto de datos público. Una clave propia es gratis, tarda un minuto y no comparte nada.',
  },

  lora: {
    termino: 'LoRA',
    queEs:
      'Un archivo pequeño que se le añade al modelo para enseñarle algo concreto: una cara, un estilo, un personaje. A diferencia de describir el aspecto con palabras, un LoRA lo impone.',
    queRelleno:
      'El identificador del LoRA en la web CivitAI. Se saca de la dirección de su página: en civitai.com/models/247778 el identificador es 247778.',
    ejemplo: '247778',
    ojo: 'Tiene que estar publicado en CivitAI —no se puede subir uno tuyo— y cada uno cuesta 3 kudos más. Además sólo 9 de los 18 workers aceptan LoRAs, así que pedir uno reduce a la mitad quién puede atenderte.',
  },

  loraVersion: {
    termino: 'Es un id de versión',
    queEs:
      'Un mismo LoRA puede tener varias versiones, y cada una pinta un poco distinto. Sin marcar esta casilla te sirven siempre la última, que puede cambiar sin avisar.',
    queRelleno:
      'Márcala sólo si arriba has puesto el número de UNA versión concreta, no el del LoRA entero. Ese número está en la página de CivitAI, al elegir la versión.',
    ojo: 'Marcada, el valor tiene que ser un número. Un nombre no funciona y la petición se queda esperando.',
  },

  loraPeso: {
    termino: 'Peso del LoRA',
    queEs:
      'Cuánta fuerza tiene el LoRA sobre el resultado. 1 es su fuerza normal. Menos lo suaviza; más lo exagera hasta deformar la imagen.',
    queRelleno: 'Déjalo en 1 la primera vez. Si sale demasiado marcado, baja a 0,7.',
    ejemplo: '1',
  },

  loraTrigger: {
    termino: 'Palabra de activación',
    queEs:
      'Algunos LoRA sólo se despiertan si una palabra concreta aparece en el texto. Su autor la indica en la página de CivitAI.',
    queRelleno:
      'La palabra que diga su página. Si no sabes cuál es, escribe "any" y se busca sola. Si lo dejas vacío y ese LoRA la necesitaba, no hará prácticamente nada.',
    ejemplo: 'any',
  },

  semilla: {
    termino: 'Semilla',
    queEs:
      'Un número que fija el azar. Con la misma semilla y el mismo texto sale una imagen muy parecida; cambiándolo sale otra distinta.',
    queRelleno:
      'Pulsa "Fijar una al azar" y déjala. Es lo que más ayuda a que tu personaje se parezca a sí mismo entre imágenes.',
    ejemplo: '1265879423',
    ojo: 'Vacío significa azar cada vez, y entonces la cara cambia bastante de una imagen a otra.',
  },

  clipSkip: {
    termino: 'CLIP skip',
    queEs:
      'Un ajuste técnico de cuánto "lee" el modelo tu texto. No hay uno bueno: hay uno que espera cada familia de modelos.',
    queRelleno:
      'No lo toques. Se pone solo al elegir el modelo: 2 para los de anime modernos y 1 para los antiguos.',
    ojo: 'Con el valor que no toca no falla nada, pero las caras salen planas y las manos peor. Es el fallo más difícil de diagnosticar mirando la imagen.',
  },

  pasos: {
    termino: 'Pasos',
    queEs:
      'Cuántas veces repasa el modelo la imagen antes de darla por terminada. Más pasos, más detalle... hasta cierto punto, y luego sólo más espera.',
    queRelleno: 'Deja 30. Por debajo de 20 se nota borroso; por encima de 40 casi no cambia nada.',
    ejemplo: '30',
    ojo: 'Más pasos no arreglan una descripción mala, sólo tardan más y gastan más kudos.',
  },

  resolucion: {
    termino: 'Ancho y alto',
    queEs:
      'El tamaño de la imagen en píxeles. Cada familia de modelos se entrenó a un tamaño y rinde peor fuera de él.',
    queRelleno:
      'Déjalo como se pone solo al elegir el modelo: 1024×1024 para los modernos, 512×768 para los antiguos.',
    ojo: 'Los dos números tienen que ser múltiplos de 64 (512, 576, 640…). Y pedirle 1024 a un modelo antiguo produce cuerpos deformes y personas duplicadas.',
  },

  aspectoFijo: {
    termino: 'Aspecto fijo',
    queEs:
      'La descripción de cómo es tu personaje: pelo, ojos, complexión, rasgos. Se pone delante de cada escena que generes, y por eso es lo que hace que se parezca siempre a sí mismo.',
    queRelleno:
      'En INGLÉS, separado por comas, sólo lo que se VE. Nada de personalidad ni de qué está pasando.',
    ejemplo: '1girl, long black hair, green eyes, small mole under left eye, slim',
    ojo: 'En español el generador se pierde y devuelve otra cosa. Y si describes a más de una persona, saldrán dos.',
  },

  negativo: {
    termino: 'Negativo',
    queEs:
      'La lista de lo que NO quieres que aparezca. Existe porque una descripción normal no sabe decir "no": si escribes "sin sombrero", suele salir un sombrero.',
    queRelleno:
      'En inglés y separado por comas, sólo si has visto algo que quieras quitar. Puedes dejarlo vacío: Luxy ya añade lo básico por su cuenta.',
    ejemplo: 'extra fingers, watermark, blurry',
  },

  estiloPrompt: {
    termino: 'Etiquetas o prosa',
    queEs:
      'Los modelos de anime aprendieron con etiquetas sueltas separadas por comas; los realistas, con frases. Escribirle a uno como al otro da peores resultados.',
    queRelleno:
      'Lo elige el botón "Anime" o "Realista" que ya has pulsado. No hay nada que rellenar.',
  },

  imagenPartida: {
    termino: 'Partir de una imagen',
    queEs:
      'Coger una imagen que ya salió bien y generar otra parecida a partir de ella, en vez de empezar de cero.',
    queRelleno: 'Elige una de las imágenes que ya hay en esta conversación, o deja "Empezar de cero".',
    ojo: 'Esto VARÍA una imagen; no lleva la cara de tu personaje a una escena nueva. AI Horde no sabe hacer eso. Además cuesta un 30 % más de kudos.',
  },

  cuantoPuedeCambiar: {
    termino: 'Cuánto puede cambiar',
    queEs:
      'Cuando partes de una imagen, esto decide cuánto se permite alejarse de ella. Cero coma algo es "casi la misma imagen"; uno es "olvídala del todo".',
    queRelleno: 'Deja 0,45. Si quieres un cambio pequeño, 0,3; si quieres otra escena, 0,6.',
    ejemplo: '0,45',
    ojo: 'Por encima de 0,6 se pierde la cara, que suele ser justo lo que querías conservar.',
  },

  personajeReceta: {
    termino: 'Personaje',
    queEs:
      'En AI Horde un personaje no existe en ningún servidor: es la lista de ajustes que guarda Luxy —modelo, aspecto, semilla, tamaño— y que se repite igual en cada imagen. Eso es todo lo que lo mantiene reconocible.',
    ojo: 'Por eso corregirlo no cuesta nada y se puede repetir hasta que la cara salga bien, al revés que en Xavira, donde crear otro cuesta créditos.',
  },

  // ---------------------------------------------------------------------------
  // proveedores
  // ---------------------------------------------------------------------------

  xavira: {
    termino: 'Xavira',
    queEs:
      'El proveedor de imágenes de pago. Guarda el personaje en SU servidor y le da un identificador, y eso es lo que mantiene la misma cara entre generaciones. Es el único de los dos que hace vídeo.',
    ojo: 'Cada imagen consume créditos comprados con dinero, y el aspecto de un personaje no se puede cambiar después de crearlo.',
  },

  aiHorde: {
    termino: 'AI Horde',
    queEs:
      'Una red de voluntarios que prestan su tarjeta gráfica para generar imágenes. Es gratis de verdad y no pide método de pago, a cambio de esperar cuando hay cola.',
  },

  urlBase: {
    termino: 'URL base',
    queEs:
      'La dirección de internet del servicio con el que quieres hablar, hasta la parte de la versión. Luxy le añade el resto por su cuenta.',
    queRelleno:
      'Pégala tal cual la publique el proveedor, sin barra al final y sin nada detrás de la versión.',
    ejemplo: 'https://api.cohere.ai/compatibility/v1',
    ojo: 'Un solo carácter de más produce un error que no verás hasta el primer trabajo. Si el proveedor está en la lista de arriba, elígelo y se rellena solo.',
  },

  modeloTexto: {
    termino: 'Modelo predeterminado',
    queEs:
      'Cuál de los modelos de ese proveedor se usa cuando no eliges otro. Cada proveedor tiene los suyos y el nombre es exacto.',
    queRelleno: 'Cópialo de la documentación del proveedor, sin cambiar mayúsculas ni guiones.',
    ejemplo: 'deepseek-chat',
  },

  claveApi: {
    termino: 'Clave de API',
    queEs:
      'La contraseña con la que ese servicio sabe que eres tú. Se saca de tu cuenta en su página web.',
    queRelleno: 'Pégala entera. Se guarda cifrada con tu cuenta de Windows y no se vuelve a mostrar.',
    ojo: 'No la escribas en ningún otro sitio de Luxy ni la pegues en una conversación.',
  },

  maxTokens: {
    termino: 'Máximo de tokens',
    queEs:
      'El tope de longitud de la respuesta. Un token es más o menos media palabra, así que 8192 son unas 6.000 palabras.',
    queRelleno: 'Deja 8192. Súbelo sólo si notas que las respuestas se cortan a media frase.',
    ejemplo: '8192',
  },

  streaming: {
    termino: 'Respuesta en streaming',
    queEs:
      'Que el texto vaya llegando mientras se escribe, en vez de aparecer entero al final. Es sólo cómo llega, no cambia lo que dice.',
    queRelleno: 'Déjalo marcado. Desmárcalo únicamente si ese proveedor da error al primer intento.',
  },

  presupuestoDiario: {
    termino: 'Presupuesto diario',
    queEs: 'Un tope de gasto al día para ese proveedor. Al llegar, Luxy deja de usarlo hasta mañana.',
    queRelleno:
      'Cero significa SIN LÍMITE. En un proveedor que cobra, pon una cifra que no te importe perder.',
    ejemplo: '5',
  },

  identificadorProveedor: {
    termino: 'Identificador',
    queEs:
      'Un nombre corto e interno para referirte a esta conexión desde el resto de Luxy. No lo ve nadie más.',
    queRelleno: 'Minúsculas y sin espacios. Queda fijo después de crearla.',
    ejemplo: 'cohere',
  },

  // ---------------------------------------------------------------------------
  // bóveda
  // ---------------------------------------------------------------------------

  boveda: {
    termino: 'Bóveda',
    queEs:
      'La parte privada de Luxy. Todo lo que hay dentro —conversaciones, personajes, imágenes— está cifrado en tu disco con tu contraseña. Ni el servidor de Luxy ni nadie más puede leerlo.',
    ojo: 'Si pierdes la contraseña y la clave de recuperación, el contenido no se recupera. No hay puerta trasera, y eso es a propósito.',
  },

  claveRecuperacion: {
    termino: 'Clave de recuperación',
    queEs:
      'Una lista de letras y números que abre la bóveda si olvidas la contraseña. Se enseña UNA vez, al crearla.',
    queRelleno: 'Guárdala fuera del ordenador: en papel, o en un gestor de contraseñas.',
    ojo: 'Es la única segunda puerta que existe. Sin ella, olvidar la contraseña es perderlo todo.',
  },

  instruccionesConversacion: {
    termino: 'Instrucciones',
    queEs:
      'Lo que le dices al modelo sobre cómo comportarse, y que acompaña a cada mensaje de esta conversación sin que tengas que repetirlo.',
    queRelleno:
      'Cómo quieres que te responda, qué debe tener en cuenta y qué evitar. En tu idioma, con tus palabras.',
  },
} as const satisfies Record<string, GlossaryEntry>;

export type GlossaryKey = keyof typeof GLOSSARY;
