// la boveda local sin cuenta que ya no se pisa al entrar en una (`SYNC-F1-07`).
//
// Vive en `shared` porque lo usan los dos lados: el proceso principal lanza este
// error al negarse, y la pantalla lo reconoce para ofrecer la salida —apartar la
// boveda local, que la renombra y no borra nada— en vez de dejar a Daniel con un
// mensaje y ningun boton.

export const LOCAL_VAULT_CONFLICT = {
  message: 'este equipo tiene una bóveda local sin cuenta, con contenido, y otra llave',
  hint: 'entrar aquí en la cuenta la dejaría ilegible para siempre, así que no se ha tocado nada. Si es tuya y quieres conservarla, vincúlala desde la bóveda abierta. Si quieres entrar en la cuenta igualmente, apártala: Luxy la renombra sin borrar nada.',
} as const;
