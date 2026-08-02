// pruebas de las banderas de SendInput.
//
// POR QUE ESTAS PRUEBAS SON LAS MAS VALIOSAS DE LA FASE 4:
//
// Un flag mal puesto NO da error. SendInput devuelve exito, GetLastError dice
// que todo bien, y el cursor aparece en otro monitor, o el scroll va al reves, o
// el texto sale vacio. Son fallos que normalmente solo se ven con una pantalla
// delante. Aqui se comprueban los numeros exactos, para que lo unico que quede
// por verificar a mano sea que koffi carga y que la llamada llega.
import { describe, it, expect } from 'vitest';
import {
  KEYEVENTF,
  MOUSEEVENTF,
  WHEEL_DELTA,
  planButton,
  planKey,
  planMove,
  planScroll,
  planText,
  toUint32,
  type KeyInputPlan,
  type MouseInputPlan,
} from './input-plan.js';
import { MAX_UNITS_PER_BATCH, scanCodeFor, textToUnitChunks } from './keycodes.js';

function raton(plan: ReturnType<typeof planMove>[number]): MouseInputPlan {
  if (plan.kind !== 'mouse') throw new Error('se esperaba un evento de raton');
  return plan;
}

function tecla(plan: ReturnType<typeof planKey>[number]): KeyInputPlan {
  if (plan.kind !== 'key') throw new Error('se esperaba un evento de teclado');
  return plan;
}

describe('posicionamiento del raton', () => {
  it('SIEMPRE lleva ABSOLUTE, VIRTUALDESK y MOVE juntas', () => {
    // sin ABSOLUTE el valor se lee como desplazamiento relativo y la aceleracion
    // lo multiplica hasta por cuatro: el cursor no llega nunca al sitio pedido.
    // sin VIRTUALDESK el 0..65535 se reparte solo sobre el monitor primario, asi
    // que con dos monitores nada cae en el secundario.
    const [evento] = planMove({ dx: 1234, dy: 5678 });
    const m = raton(evento!);

    expect(m.flags & MOUSEEVENTF.ABSOLUTE).toBe(MOUSEEVENTF.ABSOLUTE);
    expect(m.flags & MOUSEEVENTF.VIRTUALDESK).toBe(MOUSEEVENTF.VIRTUALDESK);
    expect(m.flags & MOUSEEVENTF.MOVE).toBe(MOUSEEVENTF.MOVE);
    expect(m.dx).toBe(1234);
    expect(m.dy).toBe(5678);
  });
});

describe('botones', () => {
  it('un clic con punto mueve ANTES de pulsar', () => {
    const plan = planButton('left', 'down', { dx: 100, dy: 200 });

    expect(plan).toHaveLength(2);
    expect(raton(plan[0]!).flags & MOUSEEVENTF.MOVE).toBe(MOUSEEVENTF.MOVE);
    expect(raton(plan[1]!).flags).toBe(MOUSEEVENTF.LEFTDOWN);
  });

  it('sin punto NO se emite ningun movimiento', () => {
    // es el caso de releaseAll: soltar a ciegas al cortar la sesion. Si aqui
    // apareciera un MOVE, el cursor del usuario saltaria a la esquina.
    const plan = planButton('left', 'up', null);

    expect(plan).toHaveLength(1);
    expect(raton(plan[0]!).flags).toBe(MOUSEEVENTF.LEFTUP);
    expect(raton(plan[0]!).flags & MOUSEEVENTF.MOVE).toBe(0);
  });

  it('cada boton tiene su pareja down/up y no se cruzan', () => {
    expect(raton(planButton('right', 'down', null)[0]!).flags).toBe(MOUSEEVENTF.RIGHTDOWN);
    expect(raton(planButton('right', 'up', null)[0]!).flags).toBe(MOUSEEVENTF.RIGHTUP);
    expect(raton(planButton('middle', 'down', null)[0]!).flags).toBe(MOUSEEVENTF.MIDDLEDOWN);
    expect(raton(planButton('middle', 'up', null)[0]!).flags).toBe(MOUSEEVENTF.MIDDLEUP);
  });
});

describe('rueda', () => {
  it('una muesca son 120', () => {
    const plan = planScroll({ dx: 0, dy: 0 }, 0, 1);
    const rueda = raton(plan[1]!);

    expect(rueda.flags).toBe(MOUSEEVENTF.WHEEL);
    expect(rueda.mouseData).toBe(WHEEL_DELTA);
  });

  it('el scroll hacia abajo viaja en complemento a dos', () => {
    // mouseData es un entero CON SIGNO metido en un campo sin signo. Si -120
    // viajara tal cual, Windows leeria un desplazamiento gigantesco hacia arriba
    // y la pagina saltaria al principio en cada gesto.
    const plan = planScroll({ dx: 0, dy: 0 }, 0, -1);

    expect(raton(plan[1]!).mouseData).toBe(toUint32(-WHEEL_DELTA));
    expect(raton(plan[1]!).mouseData).toBe(0xffffff88);
    expect(raton(plan[1]!).mouseData).toBeGreaterThan(0);
  });

  it('horizontal y vertical son eventos distintos', () => {
    const plan = planScroll({ dx: 0, dy: 0 }, 2, -3);
    const banderas = plan.slice(1).map((p) => raton(p).flags);

    expect(banderas).toContain(MOUSEEVENTF.WHEEL);
    expect(banderas).toContain(MOUSEEVENTF.HWHEEL);
  });

  it('un eje a cero no genera evento', () => {
    // emitir una rueda de 0 hace que algunas aplicaciones interpreten un gesto
    expect(planScroll({ dx: 0, dy: 0 }, 0, 0)).toHaveLength(1);
  });
});

describe('teclado', () => {
  it('las teclas van por SCANCODE y con wVk a cero', () => {
    // el virtual-key depende de la distribucion del host: con teclado AZERTY,
    // mandar VK_Z acabaria en otra tecla fisica
    const t = tecla(planKey('enter', 'down')[0]!);

    expect(t.flags & KEYEVENTF.SCANCODE).toBe(KEYEVENTF.SCANCODE);
    expect(t.wVk).toBe(0);
    expect(t.wScan).toBe(0x1c);
  });

  it('soltar anade KEYUP y conserva el resto', () => {
    const t = tecla(planKey('enter', 'up')[0]!);
    expect(t.flags & KEYEVENTF.KEYUP).toBe(KEYEVENTF.KEYUP);
    expect(t.flags & KEYEVENTF.SCANCODE).toBe(KEYEVENTF.SCANCODE);
  });

  it('las teclas del bloque de navegacion llevan EXTENDEDKEY', () => {
    // sin el prefijo E0, "Inicio" es el 7 del teclado numerico y la flecha
    // arriba es un 8: el usuario escribiria numeros al intentar navegar
    for (const key of ['home', 'end', 'up', 'down', 'left', 'right', 'delete', 'insert'] as const) {
      const t = tecla(planKey(key, 'down')[0]!);
      expect(t.flags & KEYEVENTF.EXTENDEDKEY, key).toBe(KEYEVENTF.EXTENDEDKEY);
    }
  });

  it('las que NO son extendidas no llevan el flag', () => {
    for (const key of ['escape', 'tab', 'space', 'f1', 'f12'] as const) {
      expect(tecla(planKey(key, 'down')[0]!).flags & KEYEVENTF.EXTENDEDKEY, key).toBe(0);
    }
  });

  it('la tecla Windows es extendida', () => {
    expect(tecla(planKey('meta', 'down')[0]!).flags & KEYEVENTF.EXTENDEDKEY).toBe(
      KEYEVENTF.EXTENDEDKEY,
    );
  });

  it('todas las teclas del protocolo tienen scancode', () => {
    // si el protocolo crece y aqui no, la tecla nueva se descartaria en silencio
    const claves = [
      'escape', 'tab', 'backspace', 'enter', 'space', 'delete', 'insert',
      'home', 'end', 'pageup', 'pagedown', 'up', 'down', 'left', 'right',
      'f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9', 'f10', 'f11', 'f12',
      'printscreen', 'ctrl', 'alt', 'shift', 'meta',
    ] as const;

    for (const clave of claves) {
      expect(scanCodeFor(clave), clave).not.toBeNull();
    }
  });

  it('los scancodes no se repiten dentro del mismo espacio', () => {
    // dos teclas con el mismo (code, extended) serian indistinguibles: una de las
    // dos no funcionaria nunca y costaria mucho verlo
    const claves = [
      'escape', 'tab', 'backspace', 'enter', 'space', 'delete', 'insert',
      'home', 'end', 'pageup', 'pagedown', 'up', 'down', 'left', 'right',
      'f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9', 'f10', 'f11', 'f12',
      'printscreen', 'ctrl', 'alt', 'shift', 'meta',
    ] as const;

    const vistos = claves.map((c) => {
      const s = scanCodeFor(c)!;
      return `${s.code}:${s.extended}`;
    });

    expect(new Set(vistos).size).toBe(claves.length);
  });
});

describe('texto Unicode', () => {
  it('cada unidad lleva su down y su up, con wVk a cero', () => {
    // KEYEVENTF_UNICODE EXIGE wVk=0: con cualquier virtual-key puesto Windows
    // descarta el evento en silencio y no se escribe nada
    const [lote] = planText('ab');
    expect(lote).toHaveLength(4);

    for (const evento of lote!) {
      expect(tecla(evento).wVk).toBe(0);
      expect(tecla(evento).flags & KEYEVENTF.UNICODE).toBe(KEYEVENTF.UNICODE);
    }
    expect(tecla(lote![1]!).flags & KEYEVENTF.KEYUP).toBe(KEYEVENTF.KEYUP);
  });

  it('el texto NUNCA lleva SCANCODE', () => {
    // los dos flags son incompatibles: con SCANCODE puesto, Windows ignora el
    // valor Unicode y busca una tecla fisica que no existe
    const [lote] = planText('ñ');
    for (const evento of lote!) {
      expect(tecla(evento).flags & KEYEVENTF.SCANCODE).toBe(0);
    }
  });

  it('un emoji viaja como par de surrogates', () => {
    const [lote] = planText('🙂');
    // dos unidades, cada una con down y up
    expect(lote).toHaveLength(4);
    expect(tecla(lote![0]!).wScan).toBe(0xd83d);
    expect(tecla(lote![2]!).wScan).toBe(0xde42);
  });

  it('los caracteres no ASCII llegan enteros', () => {
    const [lote] = planText('ñ');
    expect(tecla(lote![0]!).wScan).toBe('ñ'.charCodeAt(0));
  });
});

describe('troceado del texto', () => {
  it('un texto largo se reparte en lotes', () => {
    const lotes = textToUnitChunks('a'.repeat(MAX_UNITS_PER_BATCH * 2 + 5));
    expect(lotes.length).toBe(3);
    expect(lotes[0]).toHaveLength(MAX_UNITS_PER_BATCH);
  });

  it('un par de surrogates NUNCA se parte entre dos lotes', () => {
    // si se partiera, el usuario recibiria dos caracteres basura en vez del
    // emoji, y solo a veces: dependeria de la longitud del texto anterior
    const texto = 'a'.repeat(9) + '🙂';
    const lotes = textToUnitChunks(texto, 10);

    // el emoji no cabe en el primer lote (quedaba 1 hueco y necesita 2)
    expect(lotes).toHaveLength(2);
    expect(lotes[0]).toHaveLength(9);
    expect(lotes[1]).toEqual([0xd83d, 0xde42]);
  });

  it('ningun lote empieza o acaba con medio par', () => {
    const texto = '🙂'.repeat(20);
    for (const lote of textToUnitChunks(texto, 7)) {
      expect(lote.length % 2).toBe(0);
      // un lote par de surrogates completos: el primero siempre es high
      expect(lote[0]! >= 0xd800 && lote[0]! <= 0xdbff).toBe(true);
    }
  });

  it('texto vacio no genera lotes', () => {
    expect(textToUnitChunks('')).toEqual([]);
  });
});
