import { describe, expect, it } from 'vitest';
import { studioJobSchema } from './schemas.js';

describe('trabajos de Studio persistidos', () => {
  it('conserva un proveedor externo historico sin bloquear el historial', () => {
    // la disponibilidad actual se valida al crear o ejecutar. Leer un trabajo
    // guardado no puede depender del catalogo compilado en esta version.
    expect(studioJobSchema.pick({ provider: true }).parse({ provider: 'mi-api-privada' })).toEqual({
      provider: 'mi-api-privada',
    });
  });

  it('rechaza identificadores que no son seguros para el contrato', () => {
    expect(studioJobSchema.pick({ provider: true }).safeParse({ provider: '../salida' }).success).toBe(false);
  });
});
