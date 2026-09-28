// el aviso por nombre y los textos del enganche (`D-103`, `D-105`). Todo el
// texto es inventado.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  charactersNamedIn,
  describeCharacterLink as describeLinkWith,
  describeCharacterUnlink,
  linkSeparator,
  ownerHintQuestion,
  ownerTitle,
  replySpeaker,
  suggestCharacters,
  suggestWithHistory,
  userTextsOf,
  type OwnerChangePreview,
  type OwnerView,
} from './vault-character-link.js';

// casi todas las pruebas son de un personaje CON ficha; la vacia tiene la suya
const describeCharacterLink = (preview: OwnerChangePreview): string[] =>
  describeLinkWith(preview, { hasDescription: true });

const LIA = { characterId: 'lia-id', label: 'Lía' };

const sugiere = (text: string, characters = [LIA]) =>
  suggestCharacters({ userTexts: [text], draft: '', characters, ownerId: null, dismissed: false });

describe('suggestCharacters', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(['hola lía', 'Lia, ¿estás?', 'LÍA', 'liaaa, ven'])('casa: %s', (texto) => {
    expect(sugiere(texto)).toEqual(['lia-id']);
  });

  it('casa con etiquetas mas largas', () => {
    expect(sugiere('hola lia', [{ characterId: 'h', label: 'Lía (Horde)' }])).toEqual(['h']);
    expect(sugiere('hola lia martin', [{ characterId: 'm', label: 'Lía Martín' }])).toEqual(['m']);
  });

  it.each([
    'Liana vino ayer',
    'es un aliado',
    'no me lías',
    'esto se lía',
    'me lía mucho',
    'la lía parda',
    'mira github.com/lia/x',
    'el comando `lia` falla',
    'escribe a lia@correo.es',
  ])('no casa: %s', (texto) => {
    expect(sugiere(texto)).toEqual([]);
  });

  it('una palabra corriente no casa en minuscula, si a mitad de frase en mayuscula', () => {
    const rosa = [{ characterId: 'r', label: 'Rosa' }];
    expect(sugiere('me he puesto la camiseta rosa', rosa)).toEqual([]);
    expect(sugiere('Rosa es bonito', rosa)).toEqual([]);
    expect(sugiere('hoy he visto a Rosa en el bar', rosa)).toEqual(['r']);
  });

  it('con dueño o descartada no sugiere nada', () => {
    const base = { userTexts: ['hola lia'], draft: '', characters: [LIA] };
    expect(suggestCharacters({ ...base, ownerId: 'lia-id', dismissed: false })).toEqual([]);
    expect(suggestCharacters({ ...base, ownerId: null, dismissed: true })).toEqual([]);
  });

  it('mira tambien el borrador', () => {
    expect(
      suggestCharacters({ userTexts: [], draft: 'lia?', characters: [LIA], ownerId: null, dismissed: false }),
    ).toEqual(['lia-id']);
  });

  it('dos personajes nombrados dan los dos, y la pregunta los nombra', () => {
    const dos = [LIA, { characterId: 'nora-id', label: 'Nora' }];
    expect(sugiere('lia y nora', dos)).toEqual(['lia-id', 'nora-id']);
    expect(ownerHintQuestion(['Lía'])).toBe('¿Es de Lía?');
    expect(ownerHintQuestion(['Lía', 'Nora'])).toBe('¿Es de Lía o de Nora?');
  });

  it('una palabra corriente tras un signo de final cuenta como inicio de frase', () => {
    // el troceo ya no copia el prefijo entero: mira solo el hueco desde la
    // palabra anterior, y tiene que seguir viendo el punto, el salto y los espacios
    const rosa = [{ characterId: 'r', label: 'Rosa' }];
    expect(sugiere('vale.   Rosa me gusta', rosa)).toEqual([]);
    expect(sugiere('¿vienes? Rosa no', rosa)).toEqual([]);
    expect(sugiere('   Rosa al principio', rosa)).toEqual([]);
    expect(sugiere('vale, Rosa vino', rosa)).toEqual(['r']);
    expect(sugiere('ayer 3 Rosa vino', rosa)).toEqual(['r']);
  });

  it('lo del historial, calculado aparte, da lo mismo que todo junto', () => {
    // la pantalla memoiza el historial y solo trocea el borrador en cada tecla
    const personajes = [LIA, { characterId: 'nora-id', label: 'Nora' }, { characterId: 'v', label: '  ' }];
    const casos: { textos: string[]; borrador: string }[] = [
      { textos: ['hola lia', 'y nora?'], borrador: '' },
      { textos: ['nada que ver'], borrador: 'oye nora' },
      { textos: ['nora vino'], borrador: 'y lía' },
      { textos: [], borrador: '' },
      { textos: ['se lía todo'], borrador: 'me lía' },
    ];
    for (const { textos, borrador } of casos) {
      const junto = suggestCharacters({
        userTexts: textos,
        draft: borrador,
        characters: personajes,
        ownerId: null,
        dismissed: false,
      });
      const aparte = suggestWithHistory({
        namedInHistory: charactersNamedIn(textos, personajes),
        draft: borrador,
        characters: personajes,
        ownerId: null,
        dismissed: false,
      });
      expect(aparte).toEqual(junto);
    }
    // en el orden de la lista, aunque el borrador nombre antes al segundo
    expect(
      suggestWithHistory({
        namedInHistory: ['nora-id'],
        draft: 'lia',
        characters: personajes,
        ownerId: null,
        dismissed: false,
      }),
    ).toEqual(['lia-id', 'nora-id']);
    // con dueño o descartada, nada, aunque el historial nombre a alguien
    const nombrada = { namedInHistory: ['lia-id'], draft: '', characters: personajes };
    expect(suggestWithHistory({ ...nombrada, ownerId: 'lia-id', dismissed: false })).toEqual([]);
    expect(suggestWithHistory({ ...nombrada, ownerId: null, dismissed: true })).toEqual([]);
    // un nombre vacio no casa con nada
    expect(charactersNamedIn(['  '], personajes)).toEqual([]);
  });

  it('la criba previa no se come ninguna de las dos vias', () => {
    // nombre de pila corto: solo casa la secuencia entera, y la criba la busca
    const al = [{ characterId: 'al', label: 'Al Pacino' }];
    expect(charactersNamedIn(['ayer vi a AL PACINO'], al)).toEqual(['al']);
    expect(charactersNamedIn(['al final no'], al)).toEqual([]);
    // letras repetidas y tildes en mensajes largos, lejos del principio
    const relleno = 'palabra '.repeat(500);
    expect(charactersNamedIn([`${relleno}LÍAAA ven`], [LIA])).toEqual(['lia-id']);
    expect(charactersNamedIn([`${relleno}hola lia martin`], [{ characterId: 'm', label: 'Lía Martín' }])).toEqual([
      'm',
    ]);
    // la criba solo descarta: «se lía» pasa la criba y lo sigue parando el troceo
    expect(charactersNamedIn([`${relleno}esto se lía`], [LIA])).toEqual([]);
  });

  it('solo mira los mensajes de Daniel', () => {
    expect(
      userTextsOf([
        { role: 'user', text: 'uno' },
        { role: 'assistant', text: 'soy lia' },
      ]),
    ).toEqual(['uno']);
  });

  it('no escribe nada en consola', () => {
    const espias = (['log', 'info', 'warn', 'error', 'debug'] as const).map((metodo) =>
      vi.spyOn(console, metodo),
    );
    sugiere('hola lía');
    describeCharacterLink(base());
    describeCharacterUnlink({ ...base(), instructionsOutcome: 'removed' });
    for (const espia of espias) expect(espia).not.toHaveBeenCalled();
  });
});

function base(over: Partial<OwnerChangePreview> = {}): OwnerChangePreview {
  return {
    characterLabel: 'Lía',
    turns: 44,
    instructionsOutcome: 'character',
    hasOwnMemory: true,
    recentMemoriesOn: false,
    excluded: false,
    backgroundCli: 'codex',
    reviewCalls: 2,
    profilePhotoStays: false,
    ...over,
  };
}

const unido = (paragraphs: string[]) => paragraphs.join('\n');

describe('describeCharacterLink', () => {
  it('siempre dice que solo vale en este equipo y como se deshace', () => {
    for (const preview of [base(), base({ excluded: true }), base({ recentMemoriesOn: true })]) {
      const texto = unido(describeCharacterLink(preview));
      expect(texto).toContain('De momento solo vale en este equipo');
      expect(texto).toContain('«Sincronizar» no lo sube');
      expect(texto).toContain('Se deshace con «Soltar»');
      expect(texto).toContain('también sus 44 mensajes anteriores, que se escribieron sin su ficha');
    }
  });

  it('una rama por cada destino de las instrucciones', () => {
    expect(unido(describeCharacterLink(base()))).toContain('te responde con su ficha y con sus instrucciones.');
    expect(unido(describeCharacterLink(base({ instructionsOutcome: 'own' })))).toContain(
      'se quedan las instrucciones que ya tenía esta conversación, las suyas no se cargan.',
    );
    expect(unido(describeCharacterLink(base({ instructionsOutcome: 'none' })))).toContain(
      'Lía no tiene instrucciones guardadas.',
    );
  });

  it('el resumen, segun la casilla, la memoria y la exclusion', () => {
    const apagada = unido(describeCharacterLink(base()));
    expect(apagada).toContain(
      'su casilla «Pasarle un resumen corto de sus dos últimas conversaciones» está apagada',
    );
    // el nombre de la casilla no promete que las recuerde (`D-093`)
    expect(apagada).not.toContain('Recordar sus dos');

    const encendida = unido(describeCharacterLink(base({ recentMemoriesOn: true })));
    // le LLEGA; que lo recuerde no esta comprobado y el bloque le pide no
    // sacarlo por su cuenta (`D-093`)
    expect(encendida).toContain('le llegará un resumen corto de esa memoria');
    expect(encendida).not.toContain('recordará');
    expect(encendida).toContain('en cuanto haya dos más nuevas sale del resumen');
    expect(encendida).toContain('puede no incluir todo lo que acordasteis');

    const sinMemoria = unido(describeCharacterLink(base({ recentMemoriesOn: true, hasOwnMemory: false })));
    expect(sinMemoria).toContain('no tiene todavía memoria propia apuntada');
    expect(sinMemoria).not.toContain('la escribió el modelo sin su ficha');
    // aprobarla no basta, y la regla de las dos mas recientes vale igual aqui
    expect(sinMemoria).toContain('solo si está aprobada y al día con los últimos mensajes');
    expect(sinMemoria).toContain('en cuanto haya dos más nuevas sale del resumen');

    // apagada no promete que la vera: el indice tiene tope y una vieja puede
    // quedarse fuera (`D-093`)
    expect(apagada).not.toContain('La verá entre sus momentos');
    expect(apagada).not.toContain('podrá leer un trozo');
    expect(apagada).toContain('puede que no la vea');

    const excluida = unido(describeCharacterLink(base({ excluded: true, recentMemoriesOn: true })));
    expect(excluida).toContain('está excluida de lo que recuerda');
    expect(excluida).toContain('fuera del trabajo de fondo');
    expect(excluida).not.toContain('la recordará');
    expect(excluida).not.toContain('le llegará un resumen corto de esa memoria');
  });

  it('con la ficha vacia no promete que responda con ella', () => {
    // main sella el enganche sin ficha y el prompt sale sin «QUIEN ERES»
    const vacia = unido(describeLinkWith(base(), { hasDescription: false }));
    expect(vacia).not.toContain('te responde con su ficha');
    expect(vacia).toContain('su ficha está vacía');
    expect(vacia).toContain('se responde sin ninguna descripción de quién es y con sus instrucciones.');
    expect(vacia).toContain('Si rellenas su ficha, le llega desde el mensaje siguiente.');
    // y el resto de la confirmacion no cambia
    expect(vacia).toContain('también sus 44 mensajes anteriores');
    expect(vacia).toContain('Se deshace con «Soltar»');
    expect(unido(describeLinkWith(base({ instructionsOutcome: 'none' }), { hasDescription: false }))).toContain(
      'sin ninguna descripción de quién es. Lía no tiene instrucciones guardadas.',
    );
  });

  it('avisa de que sus pendientes pueden callarse hasta que acabe la revision', () => {
    // la guarda de desfase ve sus turnos como sin revisar hasta entonces
    expect(unido(describeCharacterLink(base()))).toContain(
      'Hasta que termine, puede que sus pendientes anteriores no le lleguen en ninguna de sus conversaciones.',
    );
    // excluida no se revisa: no hay espera que anunciar
    expect(unido(describeCharacterLink(base({ excluded: true })))).not.toContain('Hasta que termine');
  });

  it('avisa de que su memoria se escribio sin la ficha', () => {
    // sin su ficha, que es lo comprobado; no «sin saber que hablaba con Lía»:
    // si él la llamaba por su nombre, el modelo pudo saberlo (`D-093`)
    const texto = unido(describeCharacterLink(base()));
    expect(texto).toContain('la escribió el modelo sin su ficha: no tenía la descripción de Lía');
    expect(texto).not.toContain('sin saber que hablaba');
  });

  it('las llamadas se cuentan: una, o unas N', () => {
    expect(unido(describeCharacterLink(base({ reviewCalls: 1 })))).toContain('con Codex y tu sesión: una llamada.');
    expect(unido(describeCharacterLink(base({ reviewCalls: 2, backgroundCli: 'claude' })))).toContain(
      'con Claude y tu sesión: unas 2 llamadas.',
    );
  });
});

describe('describeCharacterUnlink', () => {
  it('con y sin foto, y con las instrucciones que se van o se quedan', () => {
    const conFoto = unido(
      describeCharacterUnlink(base({ instructionsOutcome: 'removed', profilePhotoStays: true })),
    );
    expect(conFoto).toContain('deja de ser de Lía');
    expect(conFoto).toContain('sin las instrucciones que se cargaron al engancharla');
    expect(conFoto).toContain('Su foto de perfil');
    expect(conFoto).toContain('No se borra nada, y puedes volver a engancharla.');

    const sinFoto = unido(describeCharacterUnlink(base({ instructionsOutcome: 'kept' })));
    expect(sinFoto).toContain('las instrucciones se quedan como están');
    expect(sinFoto).not.toContain('foto de perfil');
  });
});

describe('titulo, firma y separador', () => {
  const enganchada: OwnerView = {
    source: 'link',
    label: 'Lía',
    signedAfter: 19,
    linkedAt: '2026-09-25T10:30:00.000Z',
  };

  it('el titulo dice de quien es', () => {
    expect(ownerTitle(enganchada, null)).toBe('Conversación privada · Lía');
    expect(ownerTitle({ ...enganchada, source: 'none', label: null, signedAfter: null }, null)).toBe(
      'Conversación privada · sin personaje',
    );
    expect(ownerTitle(null, 'Nora')).toBe('Conversación privada · Nora');
    expect(ownerTitle(null, null)).toBe('Conversación privada');
  });

  it('solo se firma con su nombre lo escrito con su ficha', () => {
    expect(replySpeaker({ role: 'assistant', sequence: 19 }, enganchada)).toBe('Respuesta');
    expect(replySpeaker({ role: 'assistant', sequence: 21 }, enganchada)).toBe('Lía');
    expect(replySpeaker({ role: 'user', sequence: 20 }, enganchada)).toBe('Tú');
    expect(replySpeaker({ role: 'assistant', sequence: 21 }, null)).toBe('Respuesta');
  });

  it('el separador solo sale en un enganche', () => {
    expect(linkSeparator(enganchada)).toMatch(/^Enganchada a Lía el .+\. Lo de arriba se escribió sin su ficha\.$/);
    expect(linkSeparator({ ...enganchada, source: 'turn' })).toBeNull();
  });
});
