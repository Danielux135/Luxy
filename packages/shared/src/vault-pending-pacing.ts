// que los pendientes salgan de vez en cuando y no en cada respuesta (`D-104`).
//
// Existe por lo que conto Daniel: el personaje sacaba una promesa en casi cada
// mensaje. Medido en el registro, el bloque de pendientes viajaba en el 71 % de
// los prompts: cada nota se dosifica por su cuenta, pero con diez abiertas que se
// turnan casi siempre habia alguna disponible, y su texto le daba permiso para
// sacarlas sin que nada las trajera.
//
// Aqui solo viven los TEXTOS y el ajuste. Cuando entra el bloque lo decide la
// seleccion (`relation-selection.ts`), que es aritmetica y sin estado.
//
// La linea de «ya salio» NO dice cual salio, a proposito: nombrar la promesa
// que no se quiere oir otra vez la pone delante y la refuerza (arXiv
// 2402.07896). Ninguno de los dos textos habla de turnos, cadencia ni tope: el
// modelo no tiene que saber que hay un reloj, sino por que una cosa pendiente
// vuelve.
//
// Sin tildes y con ñ, como el resto de literales de `vault-prompt.ts`.

/**
 * ajuste del personaje que enciende los tres cambios juntos.
 *
 * Es un enum y no un booleano por la regla de `D-102`: si un dia se quieren
 * separar, se hace con un CAMPO nuevo y no con valores nuevos aqui. Un Studio mas
 * antiguo que lea un valor que no conoce descarta la lista entera de personajes,
 * y al guardar cualquiera los borra todos. Un campo desconocido se ignora al leer
 * sin romper nada.
 */
export const VAULT_PENDING_PACINGS = ['per-note', 'sparse'] as const;
export type VaultPendingPacing = (typeof VAULT_PENDING_PACINGS)[number];

/**
 * el permiso reescrito como condicion.
 *
 * Sustituye, dentro del bloque de pendientes, al tramo que le daba permiso para
 * sacarlas sola sin condicion. Lo demas del bloque —que son, como cumplirlas,
 * fuera de la historia y la regla contra inventar— queda igual.
 */
export const VAULT_PENDING_SPARSE_PERMISSION: readonly string[] = [
  'Tu te acuerdas de ellas aunque el no las nombre. Pero que esten aqui no quiere decir que toque',
  'sacar una: como pasa con lo que uno tiene pendiente con alguien, no sale en cada conversacion;',
  'vuelve cuando algo lo trae, no por costumbre. Si el saca una, te acuerdas y le contestas. Si la',
  'escena te trae una —algo que el dice o hace, un sitio, un momento que te la recuerda—, puedes',
  'sacarla tu sola: recordarsela con cariño, tomarle el pelo, reclamarsela o echarsela en cara, como',
  'lo haria el personaje. Como te sienta —si te hace gracia, te escuece o ya te da igual— depende de',
  'quien eres y de como estais ahora. Si nada te la trae, se queda contigo para otro dia: lo',
  'pendiente pesa mas cuando vuelve de tarde en tarde. Si la sacas, que sea UNA y dentro de la',
  'escena, con tu voz, como algo que se te pasa por la cabeza y no como un aviso.',
];

/**
 * que sepa que una ya salio, sin decir cual.
 *
 * Es ORDEN del ajuste del usuario, sin «(DATOS)», y va aparte del bloque de
 * pendientes porque tiene que viajar aunque ese bloque no vaya: la promesa
 * repetida llegaba casi siempre por el historial, no por el bloque.
 */
export const VAULT_PENDING_ALREADY_RAISED_TITLE = 'NOTA SOBRE LO PENDIENTE';
export const VAULT_PENDING_ALREADY_RAISED_BODY =
  'En tus ultimas respuestas ya ha salido algo de lo que teneis pendiente, y el lo ha oido. Si el lo recoge o saca otro, siguelo con el; si no, dejalo reposar y no saques tu otro todavia: ya habra otro momento.';
