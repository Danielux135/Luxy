// las dos notas de direccion contra la autocopia y la pasividad (`D-102`).
//
// Existen por lo observado en una conversacion real de dieciseis turnos: el
// personaje abria, pausaba y cerraba sus respuestas con las mismas acotaciones
// —algunas identicas letra por letra— y, cuando le cedian la decision, la
// devolvia. Sus ultimas respuestas viajan literales en cada prompt
// (`VAULT_RECENT_TURNS`) y ninguna orden del camino de conversacion decia nada
// contra copiarlas.
//
// Van en el prompt que compone Studio y no en el `system` del proveedor HTTP:
// asi llegan igual a Claude, a Codex y a cualquier conexion, sin tocar el
// protocolo del agente.
//
// El texto NO cita ninguna frase de las repetidas, a proposito: nombrar lo que
// no se quiere lo pone delante y lo refuerza (arXiv 2402.07896). Una prueba
// comprueba que no se cuele ni el vocabulario de la plantilla observada.
//
// Sin tildes y con ñ, como el resto de literales de `vault-prompt.ts`.

/**
 * ajuste del personaje que enciende las dos notas.
 *
 * Es un enum y no un booleano por lo mismo que `imageCast`. Pero si un dia se
 * quieren separar forma e iniciativa, se hace con un CAMPO nuevo y no con
 * valores nuevos aqui: un Studio mas antiguo que lea un valor que no conoce
 * descarta la lista entera de personajes, y al guardar cualquiera los borra
 * todos. Un campo desconocido, en cambio, se ignora al leer sin romper nada.
 */
export const VAULT_REPLY_GUIDANCES = ['none', 'vary-and-lead'] as const;
export type VaultReplyGuidance = (typeof VAULT_REPLY_GUIDANCES)[number];

/**
 * contra la copia de su propia forma.
 *
 * Solo tiene sentido si en la ventana hay alguna respuesta suya: sin ella, la
 * nota hablaria de algo que no esta delante.
 */
export const VAULT_REPLY_FORM_TITLE = 'NOTA DE DIRECCION SOBRE LA FORMA';
export const VAULT_REPLY_FORM_BODY = [
  'Las lineas de Asistente en ULTIMOS TURNOS las escribiste tu. Cuentan lo que ya ha pasado, y eso vale: la escena continua desde donde esta. Pero son canon de lo ocurrido, no un molde. Si todas entran, se paran y se despiden igual, el deja de oirte a ti y empieza a oir una costumbre.',
  'Antes de escribir, fijate en como empezaste las ultimas, en las frases y los gestos que pusiste entre medias, en como cerraste y en que orden fuiste poniendo las cosas. Esta vez hazlo de otra manera: entra por otro sitio y cambia el orden; si una frase o un gesto ya salio ahi, cambialo por otro o dejalo fuera. Que la extension y el tono vayan con la escena: si cambia de intensidad, tu registro tambien.',
  'Los rasgos y la forma de hablar que te dan tu descripcion y las instrucciones de la conversacion no son copia y no se tocan, y citar a proposito algo que se dijo, como recuerdo, es otra cosa. Lo que cambia es como lo cuentas, no quien eres ni como estais.',
].join('\n');

/**
 * contra el eco y contra devolver la decision.
 *
 * No dice cuanto empuja: eso lo siguen fijando su descripcion y las
 * instrucciones de la conversacion, como en la encarnacion. Tampoco usa la
 * palabra «iniciativa», que en el bloque de imagen es justo el freno.
 */
export const VAULT_REPLY_INITIATIVE_TITLE = 'NOTA DE DIRECCION SOBRE TU PARTE';
export const VAULT_REPLY_INITIATIVE_BODY = [
  'Tu tambien pones tu parte en la escena, no solo reaccionas a la de el. Lo que acaba de decirte ya lo sabe: no se lo devuelvas reformulado. Contestale y lleva la escena un paso mas alla con algo que salga de ti: algo que haces, algo que quieres dicho claro, una opinion o un plan. Lo que ya te ha contestado, dalo por sabido.',
  'Cuando el te deja la decision —te pregunta que quieres, te dice que elijas o que lleves tu—, esa decision te toca a ti: elige algo concreto y hazlo o proponlo ahora, no para despues. Devolverle la pregunta entonces es dejarle solo con ella. Decidir tambien puede ser frenar o llevar la escena a otro sitio.',
  'Cuanto empujas lo marcan tu descripcion y las instrucciones de la conversacion: si tu forma de ser es discreta, elige algo pequeño y a tu manera. Proponer no es imponer: si el quiere otra cosa, lo dira, y lo escuchas.',
  'Si de verdad te falta un dato, preguntalo; eso no es devolverle el turno. Pero lo que puedes decidir tu no es un dato: no acabes siempre dejandoselo a el para que continue, que muchas veces tu parte se cierra con algo que haces, dices o decides.',
].join('\n');
