// pruebas del indice de busqueda sobre turnos.
//
// Todo es puro, asi que no hace falta montar una boveda ni descifrar nada: se
// prueba con objetos, que es justo lo que permite cubrir los casos raros del
// español —tildes, eñes, la puntuacion de la accion— sin ceremonia.
import { describe, it, expect } from 'vitest';
import { TurnIndex, normalizeTerm, stem, tokenize, type IndexedTurn } from './turn-index.js';

const A = 'a1111111-1111-4111-8111-111111111111';
const B = 'b2222222-2222-4222-8222-222222222222';

const turn = (
  conversationId: string,
  sequence: number,
  text: string,
  role: 'user' | 'assistant' = 'assistant',
): IndexedTurn => ({ conversationId, sequence, text, role });

describe('normalizacion de terminos', () => {
  it('quita las tildes, porque nadie las escribe al buscar', () => {
    expect(normalizeTerm('Cómo')).toBe('como');
    expect(normalizeTerm('MAÑANA')).toBe('mañana');
    expect(normalizeTerm('íntimo')).toBe('intimo');
  });

  it('conserva la eñe', () => {
    // descomponerla la convertiria en «n» y «año» pasaria a ser otra palabra
    // bastante desafortunada
    expect(normalizeTerm('año')).toBe('año');
    expect(normalizeTerm('año')).not.toBe('ano');
  });
});

describe('raiz de una palabra', () => {
  it('la familia de una palabra cae en la misma raiz', () => {
    // es lo que hace que preguntar «cuando nos presentamos» encuentre un turno
    // que decia «presentacion», sin listar sinonimos a mano
    const raiz = stem('presentamos');
    expect(stem('presentacion')).toBe(raiz);
    expect(stem('presentar')).toBe(raiz);
    expect(stem('presentaciones')).toBe(raiz);
  });

  it('conocer, conocimos y conocido son lo mismo al buscar', () => {
    const raiz = stem('conocimos');
    expect(stem('conocer')).toBe(raiz);
    expect(stem('conocido')).toBe(raiz);
  });

  it('los plurales no son otra palabra', () => {
    expect(stem('estrellas')).toBe(stem('estrella'));
    expect(stem('galletas')).toBe(stem('galleta'));
  });

  it('no se pasa de agresivo con las palabras cortas', () => {
    // una raiz demasiado corta junta palabras que no tienen nada que ver y
    // ensucia todas las busquedas
    for (const corta of ['mar', 'casa', 'vida', 'ojos']) {
      expect(stem(corta).length).toBeGreaterThanOrEqual(3);
    }
    expect(stem('vainilla')).not.toBe(stem('vaina'));
  });

  it('LIMITE: un verbo irregular cambia de raiz y esto no lo alcanza', () => {
    // «vengo» y «venias» no comparten sufijo sino raiz cambiada; ningun recorte
    // de sufijos arregla eso. Es parte de por que hacen falta etiquetas
    expect(stem('vengo')).not.toBe(stem('venias'));
  });
});

describe('troceado en terminos', () => {
  it('la puntuacion y los asteriscos de la accion son separadores', () => {
    // ya salen recortadas a su raiz: es lo que se guarda en el indice
    expect(tokenize('*Hace una reverencia juguetona.*')).toEqual([
      'hace',
      'reverencia',
      'juguetona',
    ].map(stem));
  });

  it('descarta palabras vacias y las de menos de tres letras', () => {
    expect(tokenize('y de la que no me lo ha')).toEqual([]);
  });

  it('un texto sin nada indexable no da terminos', () => {
    expect(tokenize('...!!! ¿?')).toEqual([]);
  });
});

describe('busqueda', () => {
  it('encuentra el turno que contiene lo buscado', () => {
    const index = new TurnIndex();
    index.addAll([
      turn(A, 1, 'Vengo de un lugar donde huele a vainilla'),
      turn(A, 2, 'Hablamos del tiempo y de la lluvia'),
    ]);

    const found = index.search('vainilla');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ conversationId: A, sequence: 1 });
  });

  it('encuentra con tilde lo que se escribio sin ella y al reves', () => {
    const index = new TurnIndex();
    index.add(turn(A, 1, 'me acuerdo de como nos conocimos'));
    expect(index.search('¿cómo nos conocimos?')).toHaveLength(1);
  });

  it('una palabra que sale en todos los turnos no decide nada', () => {
    // es lo que hace que «conocimos» pese y «quiero» no, sin mantener a mano
    // ninguna lista de palabras importantes
    const index = new TurnIndex();
    index.addAll([
      turn(A, 1, 'quiero verte conocimos'),
      turn(A, 2, 'quiero cenar'),
      turn(A, 3, 'quiero dormir'),
      turn(A, 4, 'quiero salir'),
    ]);

    const found = index.search('quiero conocimos');
    // el primero gana por «conocimos», que es lo unico distintivo
    expect(found[0]).toMatchObject({ sequence: 1 });
    expect(found[0]!.score).toBeGreaterThan(found[1]!.score);
  });

  it('repetir una palabra suma cada vez menos', () => {
    const index = new TurnIndex();
    index.addAll([
      turn(A, 1, 'vainilla'),
      turn(A, 2, 'vainilla vainilla vainilla vainilla vainilla'),
      turn(A, 3, 'otra cosa distinta'),
    ]);

    const [primero, segundo] = index.search('vainilla');
    expect(primero).toMatchObject({ sequence: 2 });
    // cinco veces no vale cinco veces mas que una
    expect(segundo!.score * 5).toBeGreaterThan(primero!.score);
  });

  it('sin terminos utiles no devuelve nada, en vez de devolverlo todo', () => {
    const index = new TurnIndex();
    index.add(turn(A, 1, 'algo'));
    expect(index.search('de la que')).toEqual([]);
    expect(index.search('')).toEqual([]);
  });

  it('respeta el tope de resultados', () => {
    const index = new TurnIndex();
    for (let i = 1; i <= 20; i += 1) index.add(turn(A, i, 'vainilla'));
    expect(index.search('vainilla', { limit: 3 })).toHaveLength(3);
  });

  it('puede limitarse a unas conversaciones concretas', () => {
    // lo necesitan el alcance por personaje y las conversaciones excluidas del
    // banco: hay hilos que no deberian volver nunca
    const index = new TurnIndex();
    index.addAll([turn(A, 1, 'vainilla'), turn(B, 1, 'vainilla')]);

    const found = index.search('vainilla', { only: new Set([B]) });
    expect(found).toHaveLength(1);
    expect(found[0]?.conversationId).toBe(B);
  });

  it('a igualdad de puntuacion gana el turno mas antiguo', () => {
    // al rememorar interesa el origen de algo, no su ultima mencion
    const index = new TurnIndex();
    index.addAll([turn(A, 9, 'vainilla'), turn(A, 2, 'vainilla')]);
    expect(index.search('vainilla')[0]).toMatchObject({ sequence: 2 });
  });
});

describe('mantenimiento del indice', () => {
  it('reindexar el mismo turno no duplica sus apariciones', () => {
    const index = new TurnIndex();
    index.add(turn(A, 1, 'vainilla'));
    index.add(turn(A, 1, 'vainilla'));
    expect(index.size).toBe(1);
  });

  it('cambiar el texto de un turno olvida el anterior', () => {
    const index = new TurnIndex();
    index.add(turn(A, 1, 'vainilla'));
    index.add(turn(A, 1, 'canela'));

    expect(index.search('vainilla')).toEqual([]);
    expect(index.search('canela')).toHaveLength(1);
  });

  it('borrar una conversacion la saca entera', () => {
    const index = new TurnIndex();
    index.addAll([turn(A, 1, 'vainilla'), turn(A, 2, 'canela'), turn(B, 1, 'vainilla')]);

    index.removeConversation(A);
    expect(index.size).toBe(1);
    expect(index.search('vainilla')[0]?.conversationId).toBe(B);
  });

  it('clear no deja ni un termino: la boveda cerrada no conserva su contenido', () => {
    // esto NO es higiene: aqui dentro hay texto en claro, y una boveda cerrada
    // que siga teniendo su contenido en memoria no esta cerrada
    const index = new TurnIndex();
    index.addAll([turn(A, 1, 'un secreto que no debe sobrevivir al cierre')]);

    index.clear();
    expect(index.size).toBe(0);
    expect(index.termCount).toBe(0);
    expect(index.search('secreto')).toEqual([]);
  });
});

describe('el caso que motiva todo esto', () => {
  it('«¿te acuerdas de como nos conocimos?» encuentra el primer dia', () => {
    const index = new TurnIndex();
    index.addAll([
      turn(A, 1, 'Hola, ¿cómo te llamas? ¿De dónde eres?', 'user'),
      turn(A, 2, '*Hace una reverencia juguetona* Me llamo Luxy. Vengo de un lugar donde huele a vainilla.'),
      turn(A, 40, 'Hoy he estado trabajando todo el día, qué cansancio', 'user'),
      turn(A, 41, '*Se estira perezosamente* Deberías descansar.'),
    ]);

    // compartiendo alguna palabra, encuentra el origen sin dudar
    const found = index.search('¿te acuerdas de cuando me dijiste lo de la vainilla?');
    expect(found[0]?.sequence).toBe(2);
    // y no se lo lleva el turno de la jornada laboral, que no viene a cuento
    expect(found.map((match) => match.sequence)).not.toContain(41);
  });

  it('una palabra de la misma familia ya vale: «presentamos» encuentra «presento»', () => {
    // esto lo resuelve el recorte de raices, sin modelo y sin coste
    const index = new TurnIndex();
    index.addAll([
      turn(A, 1, 'Hola, ¿cómo te llamas?', 'user'),
      turn(A, 2, '*Se presenta con una reverencia* Me llamo Luxy.'),
      turn(A, 40, 'Hoy he trabajado todo el día', 'user'),
    ]);

    expect(index.search('¿te acuerdas de cuando nos presentamos?')[0]?.sequence).toBe(2);
  });

  it('LIMITE CONOCIDO: una parafrasis sin palabras comunes no encuentra nada', () => {
    // Esto no es un fallo a corregir aqui: es la frontera del metodo, y esta
    // prueba existe para que se note el dia que alguien la cruce. «presentamos»
    // no aparece en ningun turno, y «venias» no es la misma cadena que «vengo».
    //
    // Es la razon de que F10.6 —etiquetas escritas por un modelo— pase de ser
    // adorno a hacer falta de verdad para el caso que motiva la funcion.
    const index = new TurnIndex();
    index.addAll([
      turn(A, 1, 'Hola, ¿cómo te llamas? ¿De dónde eres?', 'user'),
      turn(A, 2, '*Hace una reverencia juguetona* Me llamo Luxy. Vengo de un lugar donde huele a vainilla.'),
    ]);

    expect(
      index.search('¿te acuerdas de cuando nos presentamos y me dijiste de dónde venías?'),
    ).toEqual([]);
  });
});
