// como se enseña lo que escribio cada modelo, y lo que NO se pierde por el
// camino.
//
// Lo que fijan estas pruebas no es estetica: que las repeticiones sigan siendo
// alcanzables una a una —son el motivo de repetir—, que el recorte de la
// pantalla se distinga del corte del modelo, y que el recorte del proceso
// principal se diga siempre en vez de pasar por el final de la respuesta.
import { describe, it, expect } from 'vitest';
import { trimWithMark } from '@luxy/shared';
import { REPLY_KINDS } from '../shared/refusal.js';
import { VAULT_COMPATIBILITY_REPLY_CHARS, VAULT_COMPATIBILITY_TRIM_MARK } from '../shared/ipc.js';
import {
  COMPATIBILITY_PREVIEW_CHARS,
  COMPATIBILITY_PREVIEW_ELLIPSIS,
  compatibilityFor,
  describeReply,
  replyAt,
  replyTabLabel,
  replyTone,
  type CompatibilityReply,
} from './vault-compatibility-reply.js';

function respuesta(over: Partial<CompatibilityReply> = {}): CompatibilityReply {
  const text = over.text ?? 'se gira despacio y te mira desde la puerta.';
  return {
    attempt: over.attempt ?? 1,
    kind: over.kind ?? 'answered',
    text,
    chars: over.chars ?? text.length,
    kept: over.kept ?? text.length,
    clipped: over.clipped ?? false,
  };
}

/**
 * una respuesta recortada TAL Y COMO la arma el proceso principal.
 *
 * La prueba que habia fabricaba el recorte a mano y sin la marca, asi que era un
 * `clipped: true` que no podia salir del handler: por eso no cazo que la nota
 * contaba los caracteres de la marca como si los hubiera escrito el modelo.
 */
function recortada(escrito: string): CompatibilityReply {
  const text = trimWithMark(
    escrito,
    VAULT_COMPATIBILITY_REPLY_CHARS,
    VAULT_COMPATIBILITY_TRIM_MARK,
  );
  return {
    attempt: 1,
    kind: 'answered',
    text,
    chars: escrito.length,
    kept: text.length - VAULT_COMPATIBILITY_TRIM_MARK.length,
    clipped: true,
  };
}

/** un parrafo de los de verdad: ~1.500 caracteres es lo que ocupa un turno */
function largo(caracteres: number): string {
  const palabra = 'noche ';
  // sin espacio al final: `describeReply` recorta los blancos de los bordes y
  // uno colgando descuadraria la cuenta de lo plegado por un caracter
  return palabra
    .repeat(Math.ceil(caracteres / palabra.length))
    .slice(0, caracteres)
    .trimEnd();
}

describe('el boton de cada repeticion', () => {
  it('lleva el numero Y el veredicto: lo interesante es cuando NO coinciden', () => {
    // tres botones iguales obligarian a abrirlos uno a uno para descubrir que
    // un modelo contesto, se nego y volvio a contestar, que es justo el dato
    // que hace que ese modelo no sirva
    expect(replyTabLabel(respuesta({ attempt: 2, kind: 'refused' }))).toBe('2 · se negó');
    expect(replyTabLabel(respuesta({ attempt: 1, kind: 'answered' }))).toBe('1 · contestó');
    expect(replyTabLabel(respuesta({ attempt: 3, kind: 'empty' }))).toBe('3 · sin respuesta');
  });

  it('los tres veredictos tienen tono, sin ninguno sin cubrir', () => {
    for (const kind of REPLY_KINDS) {
      expect(['ok', 'warn', 'idle']).toContain(replyTone(kind));
    }
  });
});

describe('cual de las repeticiones se pinta', () => {
  it('la que se haya pulsado', () => {
    const replies = [respuesta({ attempt: 1 }), respuesta({ attempt: 2, kind: 'refused' })];
    expect(replyAt(replies, 2)?.kind).toBe('refused');
  });

  it('sin eleccion, la primera', () => {
    const replies = [respuesta({ attempt: 1 }), respuesta({ attempt: 2 })];
    expect(replyAt(replies, null)?.attempt).toBe(1);
  });

  it('un numero que ya no existe cae a la primera, no a ninguna', () => {
    // un intento que revienta antes de escribir nada no deja entrada, asi que
    // la lista de una tanda nueva puede no tener el numero que quedo pulsado en
    // la anterior. Devolver `null` dejaria el hueco en blanco sin decir por que
    expect(replyAt([respuesta({ attempt: 2 })], 1)?.attempt).toBe(2);
  });

  it('sin respuestas no hay nada que pintar', () => {
    expect(replyAt([], 1)).toBeNull();
  });
});

describe('cuanto se pinta de la elegida', () => {
  it('una respuesta corta se pinta ENTERA y no ofrece desplegar', () => {
    const look = describeReply(respuesta(), false);
    expect(look.body).toBe('se gira despacio y te mira desde la puerta.');
    expect(look.hidden).toBe(0);
    expect(look.expandable).toBe(false);
  });

  it('una larga se pliega, dice cuanto falta y se puede desplegar entera', () => {
    const texto = largo(1500);
    const plegada = describeReply(respuesta({ text: texto }), false);

    expect(plegada.expandable).toBe(true);
    expect(plegada.body.length).toBeLessThanOrEqual(COMPATIBILITY_PREVIEW_CHARS + 1);
    expect(plegada.hidden).toBeGreaterThan(0);
    // el trozo plegado mas lo que dice que falta suman el texto entero: sin esa
    // cuenta «quedan N» no significa nada
    expect(plegada.body.length - COMPATIBILITY_PREVIEW_ELLIPSIS.length + plegada.hidden).toBe(
      texto.length,
    );

    const abierta = describeReply(respuesta({ text: texto }), true);
    expect(abierta.body).toBe(texto);
    expect(abierta.hidden).toBe(0);
  });

  it('el pliegue va por frontera de palabra y se marca', () => {
    // cortar a mitad de palabra se lee como un modelo que se corto solo, que es
    // una de las averias que esta sonda existe para encontrar
    const look = describeReply(respuesta({ text: largo(1000) }), false);
    expect(look.body.endsWith(COMPATIBILITY_PREVIEW_ELLIPSIS)).toBe(true);
    expect(look.body.slice(0, -1).endsWith('noche')).toBe(true);
  });

  it('un texto sin un solo espacio se corta igual, en vez de quedarse vacio', () => {
    const look = describeReply(respuesta({ text: 'a'.repeat(1000) }), false);
    expect(look.body.length).toBe(COMPATIBILITY_PREVIEW_CHARS + 1);
  });
});

describe('la nota de debajo', () => {
  it('dice cuanto escribio DE VERDAD, que es medio criterio para elegir', () => {
    // un modelo que despacha el turno en 200 caracteres y otro que suelta 4.000
    // no se distinguen por el trozo que cabe en pantalla
    expect(describeReply(respuesta({ chars: 1842 }), false).meta).toContain('1842 caracteres');
  });

  it('y si el recorte fue NUESTRO lo dice, tambien con la respuesta desplegada', () => {
    // un corte mudo es indistinguible de un modelo que se quedo sin salida, y
    // son dos averias que se arreglan en sitios distintos
    const reply = recortada(largo(7400));
    expect(describeReply(reply, false).meta).toContain('7400 caracteres');
    expect(describeReply(reply, true).meta).toContain('Luxy guardó');
  });

  it('cuenta lo que guardo DEL MODELO, sin apuntarle los caracteres de la marca', () => {
    // la marca se pega DENTRO del tope, asi que lo guardado son sus 22
    // caracteres menos. Contarlos decia «guardó los primeros 1995» de un texto
    // con 1973 del modelo, y encima con la marca a la vista justo encima
    const reply = recortada(largo(7400));
    expect(reply.kept).toBe(reply.text.length - VAULT_COMPATIBILITY_TRIM_MARK.length);
    expect(describeReply(reply, true).meta).toContain(`Luxy guardó los primeros ${reply.kept}`);
    expect(describeReply(reply, true).meta).not.toContain(`${reply.text.length}`);
  });

  it('sin recorte nuestro no se menciona a Luxy', () => {
    expect(describeReply(respuesta({ chars: 43 }), false).meta).not.toContain('Luxy');
  });

  it('una respuesta en blanco lo dice con palabras, no con un «0 caracteres»', () => {
    // y sin cuerpo: la pantalla no pinta la caja cuando `body` esta vacio,
    // porque un recuadro con borde y nada dentro se lee como un fallo de
    // pintado y no como «este modelo no escribio nada»
    const look = describeReply(respuesta({ text: '', chars: 0 }), false);
    expect(look.body).toBe('');
    expect(look.meta).toBe('el modelo no escribió nada');
    expect(look.expandable).toBe(false);
  });

  it('un turno de solo blancos es lo mismo que uno vacio', () => {
    expect(describeReply(respuesta({ text: '   \n  ', chars: 0 }), false).body).toBe('');
  });
});

describe('el boton de desplegar', () => {
  it('no promete «entera» cuando lo que hay es lo GUARDADO', () => {
    // desplegar una recortada enseña nuestros 2.000, no los 7.400 que escribio:
    // lo que tiro el proceso principal no llego nunca a la ventana
    const plegada = describeReply(recortada(largo(7400)), false);
    expect(plegada.expandLabel).toContain('Leer lo guardado');
    expect(plegada.expandLabel).not.toContain('entera');
    expect(plegada.expandLabel).toContain(`${plegada.hidden}`);
  });

  it('una respuesta entera si se lee entera', () => {
    const plegada = describeReply(respuesta({ text: largo(1500) }), false);
    expect(plegada.expandLabel).toBe(`Leer entera (${plegada.hidden} más)`);
  });

  it('desplegada solo pliega', () => {
    expect(describeReply(respuesta({ text: largo(1500) }), true).expandLabel).toBe('Plegar');
    expect(describeReply(recortada(largo(7400)), true).expandLabel).toBe('Plegar');
  });
});

describe('de que conversacion es lo que se enseña', () => {
  const tanda = { conversationId: 'lia-noche', results: ['deepseek', 'kimi'] };

  it('se pinta con la conversacion que sirvio de sonda', () => {
    expect(compatibilityFor(tanda, 'lia-noche')).toEqual(['deepseek', 'kimi']);
  });

  it('NO se pinta bajo otra conversacion', () => {
    // el texto se genero con el personaje, las instrucciones y la memoria de la
    // primera. Pintarlo bajo la segunda es atribuirle su roleplay a otro
    // personaje, y lo que se juzga ahi —«¿suena a ella?»— hace que no se note
    expect(compatibilityFor(tanda, 'otra-cualquiera')).toBeNull();
  });

  it('sin conversacion abierta no hay donde pintarlo', () => {
    expect(compatibilityFor(tanda, null)).toBeNull();
  });

  it('sin tanda no hay nada', () => {
    expect(compatibilityFor(null, 'lia-noche')).toBeNull();
  });
});
