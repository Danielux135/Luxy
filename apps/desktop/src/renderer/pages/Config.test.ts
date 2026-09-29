// la pista del selector de razonamiento (`D-107`).
//
// Existe por un fallo de pantalla: en el formulario del proveedor HTTP el valor
// se guarda en el nivel superior y viaja con CUALQUIER modelo que pida la
// peticion y no tenga su propio ajuste, pero las opciones y la nota salen del
// modelo del formulario, y nada decia que no fuera un ajuste solo de ese modelo.
import { describe, expect, it } from 'vitest';
import { reasoningFieldHint } from './Config.js';

describe('reasoningFieldHint', () => {
  it('en el proveedor HTTP dice que vale para sus otros modelos', () => {
    const texto = reasoningFieldHint({ options: ['low'], note: 'Nota inventada.', providerWide: true });
    expect(texto).toContain('Es del proveedor, no solo de este modelo');
    expect(texto).toContain('si no tiene su propio ajuste y admite este valor');
    expect(texto).toContain('a los que no lo admiten no se les envía nada');
    expect(texto).toContain('Nota inventada.');
    expect(texto).toContain('busca «llamada al proveedor»');
  });

  it('en el ajuste de un modelo de una conexion no lo dice: alli es solo de ese modelo', () => {
    const texto = reasoningFieldHint({ options: ['low'], note: null, providerWide: false });
    expect(texto).not.toContain('Es del proveedor');
    expect(texto).toContain('No se sabe si tu pasarela deja pasar este ajuste');
  });

  it('sin regla no ofrece nada ni habla de otros modelos', () => {
    const texto = reasoningFieldHint({ options: [], note: null, providerWide: true });
    expect(texto).toContain('Luxy no sabe cómo pedírselo a este modelo: no enviará nada.');
    expect(texto).not.toContain('Es del proveedor');
  });
});
