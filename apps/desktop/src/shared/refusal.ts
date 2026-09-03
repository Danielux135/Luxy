// distingue una negativa del proveedor de una respuesta normal.
//
// Para que sirve: saber que modelos sirven para una conversacion antes de
// montarla encima de uno que la va a rechazar. Hoy una negativa llega como un
// turno mas y parece que el personaje se ha puesto raro.
//
// Este modulo NO contiene contenido de ninguna clase: contiene las señales con
// las que un modelo dice que no. La sonda es la conversacion del usuario, que ya
// esta cifrada en su boveda; escribir aqui un texto de muestra daria una prueba
// peor —lo que importa es si acepta lo suyo, no lo mio— y ademas metria en el
// repositorio algo que no tiene por que estar.
//
// Es PURO: recibe texto y devuelve una clasificacion.
//
// El problema real es el falso positivo. En una escena se dice «no puedo mas» y
// «lo siento» constantemente, asi que una lista de palabras sueltas clasificaria
// como negativa media conversacion. De ahi las dos reglas de abajo.

export const REPLY_KINDS = [
  /** contesto lo que se le pedia */
  'answered',
  /** se nego: rompio el papel, cito politicas o se declaro IA */
  'refused',
  /** no contesto: vacio, error o corte */
  'empty',
] as const;

export type ReplyKind = (typeof REPLY_KINDS)[number];

export interface ReplyClassification {
  kind: ReplyKind;
  /** que lo delato, para poder revisar una clasificacion dudosa */
  signals: string[];
}

/**
 * señales FUERTES: bastan por si solas.
 *
 * Todas tienen en comun que el que habla deja de ser el personaje y pasa a ser
 * el sistema. Dentro de una escena no aparecen: nadie dice «como modelo de
 * lenguaje» en mitad de un dialogo.
 */
const STRONG_SIGNALS: readonly { id: string; pattern: RegExp }[] = [
  { id: 'se-declara-ia', pattern: /\b(?:soy|como)\s+(?:una?\s+)?(?:ia|inteligencia artificial|asistente virtual)\b/i },
  { id: 'modelo-de-lenguaje', pattern: /\bmodelos?\s+de\s+lenguaje\b/i },
  { id: 'language-model', pattern: /\b(?:as an?|i'?m an?)\s+(?:ai|assistant|language model)\b/i },
  { id: 'politica-de-contenido', pattern: /\bpol[ií]ticas?\s+de\s+(?:contenido|uso)\b/i },
  { id: 'content-policy', pattern: /\b(?:content|usage)\s+polic(?:y|ies)\b/i },
  { id: 'directrices', pattern: /\b(?:directrices|lineamientos|guidelines)\b/i },
  { id: 'no-puedo-ayudar', pattern: /\bno\s+puedo\s+(?:ayudar(?:te)?\s+con|asistir(?:te)?\s+con|continuar\s+con\s+(?:esta|este))\b/i },
  { id: 'cannot-assist', pattern: /\bi\s+(?:can'?t|cannot)\s+(?:help\s+with|assist\s+with|continue\s+with|create|generate)\b/i },
  { id: 'inapropiado', pattern: /\b(?:contenido|material|solicitud)\s+(?:es\s+)?(?:inapropiad|explicit|sexual)\w*\b/i },
  { id: 'viola', pattern: /\b(?:viola|infringe|violates)\b/i },
];

/**
 * señales DEBILES: solo cuentan al principio.
 *
 * Una negativa empieza negando. Las mismas palabras a mitad de un parrafo son
 * dialogo —«lo siento», «no puedo mas»— y no significan nada.
 */
const WEAK_SIGNALS: readonly { id: string; pattern: RegExp }[] = [
  { id: 'lo-siento-pero', pattern: /^\s*(?:lo\s+siento|perd[oó]n(?:a)?)\s*,?\s*(?:pero|no)\b/i },
  { id: 'sorry-but', pattern: /^\s*(?:i'?m\s+sorry|sorry)\s*,?\s*(?:but|i)\b/i },
  { id: 'no-voy-a', pattern: /^\s*no\s+(?:voy\s+a|puedo|podr[ée])\b/i },
];

/**
 * cuanto texto cuenta como «el principio».
 *
 * Una negativa se declara en la primera frase. Mas alla de esto, las mismas
 * palabras pertenecen a la escena.
 */
const OPENING_CHARS = 200;

/**
 * un texto mas corto que esto no llego a ser una respuesta.
 *
 * No es lo mismo que vacio del todo: hay proveedores que devuelven un jadeo de
 * dos palabras al cortarse, y eso tampoco es una respuesta.
 */
const MIN_ANSWER_CHARS = 24;

export function classifyReply(text: string | null | undefined): ReplyClassification {
  const value = (text ?? '').trim();
  if (value.length < MIN_ANSWER_CHARS) return { kind: 'empty', signals: [] };

  const signals: string[] = [];
  for (const signal of STRONG_SIGNALS) {
    if (signal.pattern.test(value)) signals.push(signal.id);
  }

  const opening = value.slice(0, OPENING_CHARS);
  const weak: string[] = [];
  for (const signal of WEAK_SIGNALS) {
    if (signal.pattern.test(opening)) weak.push(signal.id);
  }

  // una señal fuerte basta. Una debil sola NO: «lo siento» abre tanto una
  // negativa como una disculpa dentro de la escena, y equivocarse hacia el lado
  // de «se nego» descartaria modelos que si valen
  if (signals.length > 0) return { kind: 'refused', signals: [...signals, ...weak] };
  return { kind: 'answered', signals: weak };
}
