// rasgos de un personaje, escritos a mano.
//
// Vive fuera de `pages/Vault.tsx` por dos razones. La de fondo: es logica pura
// y se prueba sin montar la pantalla. La practica: exportar una funcion que no
// es un componente desde un modulo de componentes rompe el refresco rapido de
// React, y en desarrollo eso convierte cada cambio de la pantalla en una
// recarga entera.

/**
 * convierte «clave: valor» por linea en el mapa que espera el proveedor.
 *
 * Es deliberadamente tonto: sin claves vacias, sin valores vacios y sin lineas
 * que no lleven dos puntos. Lo que no encaja se ignora en vez de inventarse una
 * clave, porque un rasgo mal formado viajaria al proveedor tal cual.
 */
export function parseTraits(text: string): Record<string, string> {
  const traits: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim().slice(0, 64);
    const value = line.slice(separator + 1).trim().slice(0, 120);
    if (key.length === 0 || value.length === 0) continue;
    traits[key] = value;
  }
  return traits;
}
