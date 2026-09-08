// funde los registros de Studio y del agente en uno solo.
//
// POR QUE: son las dos mitades de la misma historia y estaban en dos archivos
// distintos. El proceso principal decide si un turno puede ofrecer imagenes; el
// agente cuenta como termino la llamada. Leer uno sin el otro fue exactamente
// lo que hizo falta hoy y no se pudo.
//
// Ademas los dos mensajes se parecen tanto que ya indujeron a error una vez:
// «turno privado» lo escribe Studio ANTES de llamar, y «turno privado
// terminado» el agente DESPUES. Juntos y en orden se leen como lo que son.
//
// Modulo PURO: quien lee el disco es el proceso principal.

/** saca la marca de tiempo de una linea de log sin parsear el JSON entero */
function timestampOf(line: string): string {
  // el logger escribe `ts` el primero, asi que un match basta y no hay que
  // pagar un JSON.parse por linea con un archivo de cinco megas
  const match = /"ts"\s*:\s*"([^"]+)"/.exec(line);
  return match?.[1] ?? '';
}

/**
 * une las lineas de varios registros y devuelve las ultimas `count`, en orden.
 *
 * Las lineas sin marca de tiempo —una salida rara, un archivo a medio escribir—
 * NO se tiran: se quedan pegadas detras de la ultima que si tenia hora, que es
 * donde estaban. Perderlas seria perder justo el ruido que explica un fallo.
 */
export function mergeLogLines(sources: readonly string[][], count: number): string[] {
  const fechadas: { ts: string; orden: number; line: string }[] = [];
  let orden = 0;
  for (const source of sources) {
    let ultima = '';
    for (const line of source) {
      if (line.length === 0) continue;
      const ts = timestampOf(line);
      if (ts.length > 0) ultima = ts;
      fechadas.push({ ts: ultima, orden, line });
      orden += 1;
    }
  }
  // ISO-8601 se ordena bien como texto, que es justo para lo que sirve. El
  // `orden` desempata: dos lineas del mismo milisegundo conservan su secuencia
  fechadas.sort((a, b) => (a.ts === b.ts ? a.orden - b.orden : a.ts < b.ts ? -1 : 1));
  return fechadas.slice(-count).map((entry) => entry.line);
}
