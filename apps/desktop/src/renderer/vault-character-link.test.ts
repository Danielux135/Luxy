// el aviso por nombre y los textos del enganche (`D-103`, `D-105`). Todo el
// texto es inventado.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RECENT_MEMORY_ENTRY_CHARS, RELINK_LIMITS } from '@luxy/shared';
import {
  charactersNamedIn,
  describeCharacterLink as describeLinkWith,
  describeCharacterUnlink,
  linkSeparator,
  linkedOwnerHint,
  ownerHintQuestion,
  ownerTitle,
  replySpeaker,
  suggestCharacters,
  suggestWithHistory,
  syncParagraph,
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

  it('una linea nueva, o una raya de dialogo, tambien empieza frase', () => {
    // `trimEnd()` se comia el salto antes de mirarlo: «Rosa» al principio de
    // una linea sin punto delante salia como «¿Es de Rosa?» (revision del 28/09)
    const rosa = [{ characterId: 'r', label: 'Rosa' }];
    expect(sugiere('me gusta\nRosa vino', rosa)).toEqual([]);
    expect(sugiere('me gusta\n  Rosa vino', rosa)).toEqual([]);
    expect(sugiere('vale.\n—Rosa, ven', rosa)).toEqual([]);
    // un espacio sin salto sigue sin serlo
    expect(sugiere('me gusta Rosa vino', rosa)).toEqual(['r']);
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
    inheritedMemory: false,
    inheritedTravels: false,
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
  it('siempre dice que solo vale en este ordenador y como se deshace', () => {
    for (const preview of [base(), base({ excluded: true }), base({ recentMemoriesOn: true })]) {
      const texto = unido(describeCharacterLink(preview));
      // «solo en este equipo» no se entendia (`D-108`): se dice entero
      expect(texto).toContain('se guardan solo en este ordenador');
      expect(texto).toContain('«Sincronizar» no los sube');
      expect(texto).toContain('en otro ordenador esta conversación seguiría sin ser de Lía');
      // y sin dar a entender que el resto de la boveda si viaja (`SEG-SYNC-001`)
      expect(texto).toContain('no cuentes con «Sincronizar» como copia de nada de la bóveda');
      expect(texto).toContain('Se deshace con «Soltar»');
      expect(texto).toContain('también sus 44 mensajes anteriores, que se escribieron sin su ficha');
    }
  });

  // lo que no se puede igualar, dicho antes de enganchar (`D-108`): la cola
  // literal viaja tal cual y se escribio sin su ficha
  it('dice que los ultimos mensajes le siguen llegando tal cual', () => {
    for (const preview of [base(), base({ excluded: true }), base({ hasOwnMemory: false })]) {
      const texto = unido(describeCharacterLink(preview));
      expect(texto).toContain('sus últimos mensajes de aquí (hasta 8, tuyos y suyos) le siguen llegando tal cual');
      expect(texto).toContain('hasta que tus próximos 4 mensajes los dejen atrás');
      // y no promete que deje de leerlos: los recuerdos pueden transcribirlos
      // despues, aqui y desde sus otras conversaciones (septima ronda)
      expect(texto).toContain('Y aun después pueden volver');
      expect(texto).toContain('se le pueden transcribir trozos de esos mensajes, aquí y en sus otras conversaciones');
      expect(texto).toContain('Eso no se reescribe.');
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

  it('la memoria de otras, segun la casilla, la memoria y la exclusion', () => {
    const apagada = unido(describeCharacterLink(base()));
    expect(apagada).toContain(
      'su casilla «Pasarle la memoria de sus dos últimas conversaciones» está apagada',
    );
    // quinta ronda de `D-105`: ya no viaja un resumen corto, y ningun texto lo dice
    expect(apagada).not.toContain('resumen corto');
    // el nombre de la casilla no promete que las recuerde (`D-093`)
    expect(apagada).not.toContain('Recordar sus dos');

    const encendida = unido(describeCharacterLink(base({ recentMemoriesOn: true })));
    // le LLEGA; que lo recuerde no esta comprobado y el bloque le pide no
    // sacarlo por su cuenta (`D-093`)
    expect(encendida).toContain('le llegará esa memoria entera');
    // lo que no viaja, dicho: el plan, lo que quedo en el aire y los mensajes
    expect(encendida).toContain('salvo el plan y las preguntas que quedaron en el aire');
    expect(encendida).toContain('No le llegan los mensajes');
    expect(encendida).not.toContain('recordará');
    expect(encendida).not.toContain('resumen corto');
    expect(encendida).toContain('en cuanto haya dos más nuevas deja de llegarle');
    expect(encendida).toContain('puede no incluir todo lo que acordasteis');
    // octava ronda: CUAL viaja, y «entera» con su salvedad
    expect(encendida).toContain(
      'la de ahora mientras la reescrita no esté lista, y la reescrita cuando lo esté',
    );
    expect(RECENT_MEMORY_ENTRY_CHARS).toBe(6000);
    expect(encendida).toContain('Si pasara de 6.000 caracteres, se le quitarían primero las entradas más viejas');
    // los mensajes SI pueden volver transcritos: esta frase no puede negarlo
    expect(encendida).toContain('No le llegan los mensajes por esta vía');
    expect(encendida).toContain('los trozos que se le pueden transcribir van aparte');

    const sinMemoria = unido(describeCharacterLink(base({ recentMemoriesOn: true, hasOwnMemory: false })));
    expect(sinMemoria).toContain('no tiene todavía memoria propia apuntada');
    expect(sinMemoria).not.toContain('la escribió el modelo sin su ficha');
    // aprobarla no basta, y la regla de las dos mas recientes vale igual aqui
    expect(sinMemoria).toContain('solo si está aprobada y al día con los últimos mensajes');
    expect(sinMemoria).toContain('en cuanto haya dos más nuevas deja de llegarle');
    expect(sinMemoria).not.toContain('resumen');

    // apagada no promete que la vera: el indice tiene tope y una vieja puede
    // quedarse fuera (`D-093`)
    expect(apagada).not.toContain('La verá entre sus momentos');
    expect(apagada).not.toContain('podrá leer un trozo');
    expect(apagada).toContain('puede que no la vea');

    const excluida = unido(describeCharacterLink(base({ excluded: true, recentMemoriesOn: true })));
    expect(excluida).toContain('está excluida de lo que recuerda');
    expect(excluida).toContain('fuera del trabajo de fondo');
    expect(excluida).not.toContain('la recordará');
    expect(excluida).not.toContain('le llegará esa memoria entera');
    expect(excluida).toContain('ni le llegará su memoria');
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
    // la reescritura de su memoria no lleva descripcion que no hay: solo el nombre
    expect(vacia).toContain('Se va a reescribir con su nombre (su ficha está vacía)');
    expect(vacia).toContain('Se le pide que solo cambie cómo se la nombra, y que deje igual');
    expect(vacia).not.toContain('lo que su ficha contradiga');
    expect(vacia).not.toContain('Se va a reescribir con su ficha');
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

  it('avisa de que su memoria se escribio sin la ficha, y de que se reescribe', () => {
    // sin su ficha, que es lo comprobado; no «sin saber que hablaba con Lía»:
    // si él la llamaba por su nombre, el modelo pudo saberlo (`D-093`)
    const texto = unido(describeCharacterLink(base()));
    expect(texto).toContain('la escribió el modelo sin la ficha de Lía');
    expect(texto).not.toContain('sin saber que hablaba');
    // `D-108`: se reescribe con el CLI local, y lo que pasa si no sale
    expect(texto).toContain('Se va a reescribir con su ficha, en segundo plano, con Codex y tu sesión');
    expect(texto).toContain('No se aplica, y sigue valiendo la de ahora');
    expect(texto).toContain('podrás volver a la de antes hasta que un mensaje tuyo aquí guarde memoria nueva');
    // lo que la refutacion tumbo: quitar entradas es posible, «no se pierde nada» no
    expect(texto).not.toContain('no se pierde nada');
    // y lo que SI puede perderse se dice con su cifra, la misma que aplica la guarda
    expect(texto).toContain('quita o recorta más de dos entradas o más de la mitad de las que había');
    expect(texto).toContain('Si quita o recorta una o dos, sin pasar de la mitad, se aplica igual: eso deja de viajar.');
    expect(texto).toContain('deja el resumen o el resto en menos de la mitad');
    expect(texto).toContain('cambia la mayor parte de las palabras del resumen');
    // lo añadido no lo rechaza la guarda, y se dice
    expect(texto).toContain('Lo que añada también se aplica');
    // «dos» y «la mitad» estan escritos en la frase: si la guarda cambia, esta
    // prueba lo avisa
    expect(RELINK_LIMITS.maxLostEntries).toBe(2);
    expect(RELINK_LIMITS.maxLostShare).toBe(0.5);
    expect(RELINK_LIMITS.hardMinRatio).toBe(0.5);
    expect(RELINK_LIMITS.minSummaryWordsKept).toBe(0.5);
    // «acorta mucho» no decia cuanto: ahora van las cifras, las de la guarda.
    // El texto da un solo porcentaje para los dos: si se separan, esto avisa
    expect(texto).not.toContain('acorta mucho');
    expect(texto).toContain('si los acorta más de un 20 % (el resumen, perdiendo más de 60 caracteres; el resto, más de 120)');
    expect(RELINK_LIMITS.minEntriesRatio).toBe(RELINK_LIMITS.minSummaryRatio);
    // decima ronda: prometia ver en la fila «esas cifras» —los umbrales—, que
    // la fila no enseña; enseña cuantas entradas tocó, tambien si no se aplicó
    expect(texto).not.toContain('con esas cifras');
    expect(texto).toContain('cuántas entradas dejó igual, corrigió, quitó o añadió, también si no se aplicó');
    // se dice lo que se le PIDE, no lo que el modelo vaya a hacer
    expect(texto).toContain('Se le pide que solo cambie cómo se la nombra');

    // excluida: no se reescribe, y se dice
    const excluida = unido(describeCharacterLink(base({ excluded: true })));
    expect(excluida).toContain('la escribió el modelo sin la ficha de Lía, y no se va a reescribir con ella');
    expect(excluida).not.toContain('Se va a reescribir');

    // sin memoria no hay nada que reescribir ni que prometer
    const sinMemoria = unido(describeCharacterLink(base({ hasOwnMemory: false })));
    expect(sinMemoria).not.toContain('reescribir');
  });

  it('sin memoria propia pero con ficha retroactiva, dice que viaja esa y que se reescribe la siguiente', () => {
    const heredada = unido(
      describeCharacterLink(base({ hasOwnMemory: false, inheritedMemory: true, inheritedTravels: true })),
    );
    expect(heredada).toContain('lo que le llega de ella es su ficha retroactiva o el índice de sus escenas');
    expect(heredada).toContain('que escribió un CLI sin la ficha de Lía');
    expect(heredada).toContain('así será también en tu próximo mensaje aquí');
    expect(heredada).toContain('es esa la que se reescribirá con su ficha después');
    // excluida no se reescribe nada: no se promete
    const excluida = unido(
      describeCharacterLink(base({ hasOwnMemory: false, inheritedMemory: true, excluded: true })),
    );
    expect(excluida).not.toContain('se reescribirá');
  });

  // `chooseConversationMemory` solo lleva una ficha retroactiva aprobada, de la
  // version actual y al dia: la confirmacion afirmaba que le llegaba igual
  it('con la ficha retroactiva sin aprobar no dice que le llegue', () => {
    const sinAprobar = unido(
      describeCharacterLink(base({ hasOwnMemory: false, inheritedMemory: true, inheritedTravels: false })),
    );
    expect(sinAprobar).not.toContain('lo que le llega de ella es su ficha retroactiva');
    expect(sinAprobar).toContain('ahora mismo tampoco le llega su ficha retroactiva');
    expect(sinAprobar).toContain('solo viaja si está aprobada y al día con los últimos mensajes');
    expect(sinAprobar).toContain('esa se reescribirá con su ficha después');
  });

  it('sin memoria propia y con la ficha vacia, la reescritura solo lleva su nombre', () => {
    const vacia = unido(
      describeLinkWith(base({ hasOwnMemory: false, inheritedMemory: true, inheritedTravels: true }), {
        hasDescription: false,
      }),
    );
    expect(vacia).toContain('se reescribirá con su nombre (su ficha está vacía) después');
    expect(vacia).not.toContain('se reescribirá con su ficha');
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
    expect(sinFoto).toContain('de la memoria que les llega a sus otras conversaciones');
  });

  // `D-108`: la reescrita era del enganche; lo sellado a partir de ella es de la
  // conversacion, y no se promete volver a «la de antes» cuando ya no existe
  it('soltar dice que la reescrita se quita, sin prometer la de antes', () => {
    const texto = unido(describeCharacterUnlink(base()));
    expect(texto).toContain('la reescrita se quita');
    expect(texto).toContain('que será la de antes si ningún mensaje la ha sustituido todavía');
    expect(unido(describeCharacterUnlink(base({ hasOwnMemory: false })))).not.toContain('reescrita');
  });

  // lo sabido y no arreglado de `D-105`: soltar no borra lo que otra memoria ya
  // copio de aqui, y con la memoria entera hay que decirlo
  it('con la casilla encendida avisa de que lo ya apuntado en otras se queda', () => {
    const encendida = unido(describeCharacterUnlink(base({ recentMemoriesOn: true })));
    expect(encendida).toContain('eso se queda: esa memoria es de aquella conversación');
    const apagada = unido(describeCharacterUnlink(base()));
    expect(apagada).not.toContain('eso se queda');
    const excluida = unido(describeCharacterUnlink(base({ recentMemoriesOn: true, excluded: true })));
    expect(excluida).not.toContain('eso se queda');
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

  // `D-108`: una enganchada queda como si hubiera empezado con ella, tambien
  // en la firma de lo de antes del ancla
  it('en una enganchada se firman con su nombre todas sus respuestas', () => {
    expect(replySpeaker({ role: 'assistant', sequence: 19 }, enganchada)).toBe('Lía');
    expect(replySpeaker({ role: 'assistant', sequence: 1 }, enganchada)).toBe('Lía');
    expect(replySpeaker({ role: 'assistant', sequence: 21 }, enganchada)).toBe('Lía');
    // octava ronda: con dueño por un TURNO —las del Studio anterior— se firma
    // como en `a45953b`, solo lo de despues: lo de antes pudo escribirlo otra
    const porTurno: OwnerView = { ...enganchada, source: 'turn', signedAfter: 10 };
    expect(replySpeaker({ role: 'assistant', sequence: 3 }, porTurno)).toBe('Respuesta');
    expect(replySpeaker({ role: 'assistant', sequence: 10 }, porTurno)).toBe('Respuesta');
    expect(replySpeaker({ role: 'assistant', sequence: 11 }, porTurno)).toBe('Lía');
    // y en una enganchada, lo escrito con la ficha de OTRO personaje no lleva su nombre
    const conOtra: OwnerView = { ...enganchada, foreignUpTo: 7 };
    expect(replySpeaker({ role: 'assistant', sequence: 7 }, conOtra)).toBe('Respuesta');
    expect(replySpeaker({ role: 'assistant', sequence: 8 }, conOtra)).toBe('Lía');
    expect(replySpeaker({ role: 'assistant', sequence: 21 }, conOtra)).toBe('Lía');
    expect(replySpeaker({ role: 'user', sequence: 20 }, enganchada)).toBe('Tú');
    expect(replySpeaker({ role: 'assistant', sequence: 21 }, null)).toBe('Respuesta');
    // sin dueño, o con uno que ya no esta en la boveda, no se inventa un nombre
    expect(
      replySpeaker({ role: 'assistant', sequence: 21 }, { source: 'none', label: null, signedAfter: null, linkedAt: null }),
    ).toBe('Respuesta');
  });

  it('el separador solo sale en un enganche, con la fecha y nada mas', () => {
    expect(linkSeparator(enganchada)).toMatch(/^Enganchada a Lía el .+\.$/);
    expect(linkSeparator(enganchada)).not.toContain('sin su ficha');
    expect(linkSeparator({ ...enganchada, source: 'turn' })).toBeNull();
  });

  // «Solo en este equipo» no se entendia (`D-108`)
  it('la pista del selector se entiende y no sugiere que lo demas viaje', () => {
    const pista = linkedOwnerHint('Lía', enganchada.linkedAt);
    expect(pista).toMatch(/^Enganchada a Lía el .+\. /);
    expect(pista).toContain('se guarda solo en este ordenador');
    expect(pista).toContain('«Sincronizar» no lo sube');
    expect(pista).toContain('hoy no sirve de copia de nada de la bóveda');
    expect(pista).not.toContain('Solo en este equipo');
    expect(linkedOwnerHint('Lía', null)).toMatch(/^Enganchada a Lía\. /);
    expect(syncParagraph('Lía')).toContain('no cuentes con «Sincronizar» como copia de nada');
  });
});
