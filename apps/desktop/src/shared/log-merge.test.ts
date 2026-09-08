// pruebas de la fusion de registros.
//
// Lo que fijan es que los dos archivos se lean como UNA historia. «turno
// privado» lo escribe Studio antes de llamar y «turno privado terminado» el
// agente despues: separados se parecen tanto que ya indujeron a error una vez.
import { describe, it, expect } from 'vitest';
import { mergeLogLines } from './log-merge.js';

const linea = (ts: string, msg: string): string => JSON.stringify({ ts, level: 'info', msg });

describe('fundir los dos registros', () => {
  it('los ordena por hora, no por archivo', () => {
    const studio = [linea('2026-09-08T09:47:00.000Z', 'turno privado')];
    const agente = [linea('2026-09-08T09:49:51.000Z', 'turno privado terminado')];

    const salida = mergeLogLines([agente, studio], 10).map(
      (l) => (JSON.parse(l) as { msg: string }).msg,
    );
    // el del agente estaba primero en la lista y va SEGUNDO, porque paso despues
    expect(salida).toEqual(['turno privado', 'turno privado terminado']);
  });

  it('devuelve solo las ultimas que se piden', () => {
    const muchas = Array.from({ length: 10 }, (_v, i) =>
      linea(`2026-09-08T09:0${i}:00.000Z`, `linea ${i}`),
    );
    const salida = mergeLogLines([muchas], 3).map((l) => (JSON.parse(l) as { msg: string }).msg);
    expect(salida).toEqual(['linea 7', 'linea 8', 'linea 9']);
  });

  it('con la misma hora conserva el orden de cada archivo', () => {
    const a = [linea('2026-09-08T09:00:00.000Z', 'a1'), linea('2026-09-08T09:00:00.000Z', 'a2')];
    const salida = mergeLogLines([a], 10).map((l) => (JSON.parse(l) as { msg: string }).msg);
    expect(salida).toEqual(['a1', 'a2']);
  });

  it('una linea sin hora no se pierde: se queda donde estaba', () => {
    // es justo el ruido que explica un fallo, y tirarlo por no tener `ts` seria
    // perder lo unico que quedaba de una salida rara
    const a = [linea('2026-09-08T09:00:00.000Z', 'antes'), 'basura sin ts', linea('2026-09-08T09:00:02.000Z', 'despues')];
    const salida = mergeLogLines([a], 10);
    expect(salida[1]).toBe('basura sin ts');
    expect(salida).toHaveLength(3);
  });

  it('un archivo vacio o inexistente no molesta', () => {
    expect(mergeLogLines([[], []], 5)).toEqual([]);
    expect(mergeLogLines([[linea('2026-09-08T09:00:00.000Z', 'sola')], []], 5)).toHaveLength(1);
  });
});
