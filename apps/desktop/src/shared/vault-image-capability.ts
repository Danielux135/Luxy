// por que una conversacion privada no puede pedir imagenes.
//
// Vive aqui porque la regla la necesitan los dos lados: el proceso principal,
// que arma el prompt y no debe ofrecer lo que no se puede cumplir, y la
// pantalla, que avisa ANTES de enviar. Escrita dos veces, una de las dos se
// queda atras; y esa fue exactamente la averia que la motivo.
//
// El orden de las comprobaciones importa y no es cosmetico: un personaje que la
// boveda no conoce se dice antes que una clave que falta, porque arreglar la
// clave no arreglaria nada. Mezclarlos mandaba a mirar Conexiones cuando el
// problema estaba en el identificador.

export const IMAGE_BLOCK_REASONS = [
  /** la conversacion no tiene ningun personaje fijado */
  'sin-personaje',
  /** tiene uno, pero su identificador no corresponde a nadie de esta boveda */
  'personaje-desconocido',
  /** el personaje esta bien; lo que falta es la clave del proveedor */
  'sin-clave',
] as const;

export type ImageBlockReason = (typeof IMAGE_BLOCK_REASONS)[number];

export interface ImageCapabilityInput {
  /** el que tiene fijado la conversacion, tal y como se guardo */
  characterId: string | null;
  /** si ese identificador corresponde a un personaje de esta boveda */
  characterInVault: boolean;
  /** si hay clave del proveedor de imagenes guardada en este equipo */
  hasApiKey: boolean;
}

/**
 * `null` cuando si se puede generar; si no, el primer motivo que lo impide.
 *
 * Un identificador vacio y uno solo con espacios son lo mismo: nadie.
 */
export function imageBlockReason(input: ImageCapabilityInput): ImageBlockReason | null {
  if (input.characterId === null || input.characterId.trim().length === 0) {
    return 'sin-personaje';
  }
  if (!input.characterInVault) return 'personaje-desconocido';
  if (!input.hasApiKey) return 'sin-clave';
  return null;
}
