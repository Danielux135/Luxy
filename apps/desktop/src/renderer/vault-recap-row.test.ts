// como se enseña una ficha de continuidad, y lo que NO se enseña.
//
// La regla que fijan estas pruebas no es de estilo: lo que el modelo conteste en
// lugar de la ficha puede citar la escena, asi que en pantalla va la
// clasificacion y nada mas, y una conversacion que nadie ha querido resumir no
// anuncia de que iba.
import { describe, it, expect } from 'vitest';
import { RECAP_REFUSAL_KINDS } from '@luxy/shared';
import {
  CLI_LABELS,
  RECAP_PARTIAL_REFUSAL_LABELS,
  RECAP_REFUSAL_LABELS,
  describeForgetAck,
  describeRecapRow,
  otherCli,
  recapSignature,
  type RecapRowView,
} from './vault-recap-row.js';

/** una ficha escrita, aprobada y viajando en el prompt */
const buena: RecapRowView = {
  title: 'La noche del hotel',
  block: 'RESUMEN: van bien.',
  sealedBlock: '',
  source: 'cli',
  approved: true,
  approvalReset: false,
  inPrompt: true,
  superseded: false,
  sealed: false,
  excluded: false,
  hasEntry: true,
  cardRevivesOnForget: false,
  refusedKind: null,
  refusedProvider: null,
};

/** lo que hay cuando nadie ha querido resumir nada: ni una palabra escrita */
const vacia: RecapRowView = {
  ...buena,
  block: '',
  approved: false,
  inPrompt: false,
};

describe('el otro CLI', () => {
  it('es siempre el que no se nego', () => {
    expect(otherCli('claude')).toBe('codex');
    expect(otherCli('codex')).toBe('claude');
  });
});

describe('una negativa en pantalla', () => {
  it('no enseña NUNCA el titulo de la conversacion', () => {
    // sin ficha: nadie ha querido resumirla, asi que decir de que iba en la
    // misma linea es justo lo que se estaba evitando. Con ficha es otro caso y
    // tiene su propia prueba abajo
    for (const kind of RECAP_REFUSAL_KINDS) {
      const look = describeRecapRow(
        { ...vacia, refusedKind: kind, refusedProvider: 'codex' },
        'codex',
      );
      expect(look.title).toBeNull();
    }
  });

  it('dice la clasificacion y quien se nego, y nada mas', () => {
    const look = describeRecapRow(
      { ...buena, block: '', approved: false, inPrompt: false, refusedKind: 'refused', refusedProvider: 'codex' },
      'codex',
    );
    expect(look.state).toBe(`Codex ${RECAP_REFUSAL_LABELS.refused}`);
    expect(look.tone).toBe('warn');
    // el titulo es lo unico de la conversacion que la fila tenia, y no sale
    expect(look.state).not.toContain('hotel');
  });

  it('distingue la vaga de la negativa, porque se arreglan distinto', () => {
    const vaga = describeRecapRow(
      { ...vacia, refusedKind: 'vague', refusedProvider: 'claude' },
      'claude',
    );
    expect(vaga.state).toBe('Claude salió demasiado vaga');
    expect(vaga.state).not.toBe(`Claude ${RECAP_REFUSAL_LABELS.refused}`);
  });

  it('y el reintento apunta al OTRO CLI, no al que se nego', () => {
    const look = describeRecapRow(
      { ...vacia, refusedKind: 'refused', refusedProvider: 'codex' },
      // aunque el elegido para el trabajo de fondo siga siendo el que se nego
      'codex',
    );
    expect(look.retryWith).toBe('claude');
    expect(CLI_LABELS[look.retryWith]).toBe('Claude');
  });

  it('cuando lo que queda es el indice, se dice delante', () => {
    const look = describeRecapRow(
      {
        ...buena,
        source: 'index',
        block: 'INDICE',
        approved: true,
        inPrompt: false,
        refusedKind: 'refused',
        refusedProvider: 'claude',
      },
      'claude',
    );
    expect(look.state.startsWith('sólo índice:')).toBe(true);
    expect(look.title).toBeNull();
  });
});

describe('una ficha parcial: hay resumen Y ademas algo se nego', () => {
  /** lo que deja una conversacion larga cuya segunda ventana se nego */
  const parcial: RecapRowView = { ...buena, refusedKind: 'refused', refusedProvider: 'codex' };

  it('dice EN USO, no que se negara a resumirla', () => {
    // es el caso que el diseño llama EXITO: esa ficha esta viajando en cada
    // turno de ese hilo. Leerla como fallo total empuja a «Rehacerlo», que es lo
    // unico que si puede dejar esa conversacion sin nada
    const look = describeRecapRow(parcial, 'codex');

    expect(look.state.startsWith('en uso')).toBe(true);
    expect(look.tone).toBe('ok');
    expect(look.state).not.toContain(RECAP_REFUSAL_LABELS.refused);
  });

  it('y lo que se nego va detras, por tramos y sin el texto del modelo', () => {
    const look = describeRecapRow(parcial, 'codex');

    expect(look.state).toBe(`en uso · Codex ${RECAP_PARTIAL_REFUSAL_LABELS.refused}`);
    expect(look.state).toContain('lo que falta');
  });

  it('enseña el titulo, porque el bloque entero se lee a un clic', () => {
    const look = describeRecapRow(parcial, 'codex');
    expect(look.title).toBe('La noche del hotel');
  });

  it('sin aprobar todavia, lo dice sin convertirse en una negativa', () => {
    const look = describeRecapRow({ ...parcial, approved: false, inPrompt: false }, 'codex');
    expect(look.state.startsWith('sin aprobar')).toBe(true);
    expect(look.tone).toBe('busy');
    expect(look.canApprove).toBe(true);
  });

  it('pero el indice deducido SIGUE siendo una negativa: ahi no hay resumen', () => {
    // el diseño le da su propia frase porque de verdad no se sabe que se dijo
    const look = describeRecapRow(
      { ...parcial, source: 'index', block: 'INDICE', inPrompt: true },
      'codex',
    );
    expect(look.state.startsWith('sólo índice:')).toBe(true);
    expect(look.tone).toBe('warn');
    expect(look.title).toBeNull();
  });
});

describe('una conversacion que ya tiene memoria propia AUNQUE nadie la haya marcado', () => {
  it('lo dice con su motivo real, no con el de la invariante de cobertura', () => {
    // entre que Daniel contesta un turno de un hilo sin aprobar y la pasada
    // siguiente estampa la marca, la fila decia «aprobada, pero todavia no llega
    // hasta los ultimos turnos», que es falso: no llega porque la sellada gana
    const look = describeRecapRow({ ...buena, sealed: true, inPrompt: false }, 'codex');

    expect(look.state).toBe('ya tiene memoria propia');
    expect(look.tone).toBe('idle');
    expect(look.canApprove).toBe(false);
    expect(look.canRedo).toBe(false);
    // y se puede seguir leyendo lo que se escribio
    expect(look.canRead).toBe(true);
    // pero lo que hay escrito ya NO viaja: el mismo boton «Ver» enseñaba esto
    // bajo una etiqueta que decia «ya tiene memoria propia», sin avisar
    expect(look.cardIsStale).toBe(true);
  });

  it('ofrece leer SU memoria, que es lo unico que ella lee en ese hilo', () => {
    const look = describeRecapRow(
      { ...buena, sealed: true, inPrompt: false, sealedBlock: 'Resumen: lo suyo.' },
      'codex',
    );

    expect(look.canReadSealed).toBe(true);
  });

  it('la sellada que nunca paso por la pasada retroactiva TAMBIEN se puede leer', () => {
    // este es el caso que dejaba una fila sin un solo boton: sellada, sin
    // entrada y sin ficha, los cuatro se apagaban a la vez y no habia forma de
    // ver lo que ella si esta leyendo
    const look = describeRecapRow(
      {
        ...buena,
        sealed: true,
        inPrompt: false,
        approved: false,
        hasEntry: false,
        block: '',
        sealedBlock: 'Resumen: lo suyo.',
      },
      'codex',
    );

    expect(look.canRead).toBe(false);
    expect(look.cardIsStale).toBe(false);
    expect(look.canReadSealed).toBe(true);
    expect(look.canApprove).toBe(false);
    expect(look.canRedo).toBe(false);
  });

  it('sin memoria sellada que enseñar no se ofrece leerla', () => {
    // `superseded` sin bloque: no hay nada que abrir y el boton no puede existir
    const look = describeRecapRow(
      { ...buena, superseded: true, inPrompt: false, sealedBlock: '' },
      'codex',
    );

    expect(look.canReadSealed).toBe(false);
  });

  it('lo que se puede leer se puede borrar', () => {
    const look = describeRecapRow(
      { ...buena, sealed: true, inPrompt: false, sealedBlock: 'Resumen: lo suyo.' },
      'codex',
    );

    expect(look.canForgetSealed).toBe(true);
  });

  it('no se ofrece borrar lo que no se ha podido enseñar', () => {
    // un boton destructivo sobre algo que no se ha visto es lo contrario de lo
    // que pide una accion de este tipo
    const look = describeRecapRow(
      { ...buena, superseded: true, inPrompt: false, sealedBlock: '' },
      'codex',
    );

    expect(look.canForgetSealed).toBe(false);
  });

  it('borrar NO se ofrece por tener ficha retroactiva: son dos textos', () => {
    // la fila con ficha y sin memoria propia ya tiene su «Borrarlo»; ofrecer
    // ademas «Borrar su memoria» prometeria quitar algo que no existe
    const look = describeRecapRow({ ...buena, sealedBlock: '' }, 'codex');

    expect(look.canRead).toBe(true);
    expect(look.canForgetSealed).toBe(false);
  });

  it('avisa cuando borrar destapa la ficha, porque ahi no limpia nada', () => {
    // el caso que encontraron dos revisiones: `chooseConversationMemory` solo
    // antepone la sellada, asi que al quitarla la ficha de esa MISMA
    // conversacion vuelve a entrar en el prompt. Borrar cambia un texto por
    // otro, y eso hay que decirlo ANTES de pulsar
    const look = describeRecapRow(
      {
        ...buena,
        sealed: true,
        inPrompt: false,
        sealedBlock: 'Resumen: lo suyo.',
        cardRevivesOnForget: true,
      },
      'codex',
    );

    expect(look.canForgetSealed).toBe(true);
    expect(look.forgetRevivesCard).toBe(true);
  });

  it('sin ficha que destapar no se avisa de nada', () => {
    const look = describeRecapRow(
      { ...buena, block: '', sealed: true, inPrompt: false, sealedBlock: 'Resumen: lo suyo.' },
      'codex',
    );

    expect(look.canForgetSealed).toBe(true);
    expect(look.forgetRevivesCard).toBe(false);
  });

  it('no se avisa de una consecuencia que no se puede provocar', () => {
    // sin bloque no hay boton de borrar, y un aviso sobre lo que pasaria al
    // pulsarlo es ruido en un sitio donde todo lo escrito tiene que cumplirse
    const look = describeRecapRow(
      { ...buena, superseded: true, inPrompt: false, sealedBlock: '', cardRevivesOnForget: true },
      'codex',
    );

    expect(look.canForgetSealed).toBe(false);
    expect(look.forgetRevivesCard).toBe(false);
  });
});

describe('lo que se dice despues de borrar la memoria propia', () => {
  it('cuenta los turnos que llevaban memoria, que no es lo mismo que cero', () => {
    expect(describeForgetAck({ turns: 0, cardNowInUse: false })).toContain(
      'No quedaba ninguna memoria',
    );
    expect(describeForgetAck({ turns: 1, cardNowInUse: false })).toContain('de 1 mensaje');
    expect(describeForgetAck({ turns: 9, cardNowInUse: false })).toContain('de 9 mensajes');
  });

  it('NO promete empezar de cero cuando la ficha ha quedado al descubierto', () => {
    // la frase vieja —«empezara a recordar de nuevo desde estos ultimos»— es
    // falsa justo en ese caso: el proximo mensaje no va en blanco, va con la
    // ficha retroactiva de esta misma conversacion
    const texto = describeForgetAck({ turns: 3, cardNowInUse: true });

    expect(texto).not.toContain('desde estos últimos');
    expect(texto).toContain('ficha retroactiva');
    // y dice que hacer con ella, que es lo unico accionable
    expect(texto).toContain('Borrarlo');
  });

  it('cuando no hay ficha que destape, si dice que empieza de cero', () => {
    const texto = describeForgetAck({ turns: 3, cardNowInUse: false });

    expect(texto).toContain('desde estos últimos');
    expect(texto).not.toContain('ficha retroactiva');
  });

  it('dice SIEMPRE que borra en este equipo, que es lo que hace (D-099)', () => {
    // la subida es idempotente por secuencia, asi que el registro que ya esta
    // en el servidor conserva su memoria y el borrado no viaja. «Borrado» a
    // secas era prometer lo que el codigo no hace
    for (const cardNowInUse of [true, false]) {
      const texto = describeForgetAck({ turns: 2, cardNowInUse });
      expect(texto).toContain('en este equipo');
      expect(texto).toContain('otro ordenador');
    }
  });
});

describe('una conversacion excluida del trabajo de fondo', () => {
  it('lo dice, y no ofrece rehacerla porque la pasada no la coge', () => {
    // excluir no le quita la ficha a su propio hilo: el turno no consulta las
    // exclusiones. Lo que deja de pasar es que la pasada la actualice
    const look = describeRecapRow({ ...buena, excluded: true }, 'codex');

    expect(look.state).toBe('en uso · excluida del trabajo de fondo');
    expect(look.canRedo).toBe(false);
    expect(look.canRead).toBe(true);
  });
});

describe('una conversacion que todavia no se ha leido nunca', () => {
  const sinEntrada: RecapRowView = { ...vacia, hasEntry: false };

  it('sale igual, para poder ver cual falta y poder pedirla', () => {
    // la que ni se pudo leer ni se pudo guardar no escribe entrada, y sin fila
    // el aviso mandaba pulsar un boton que no existia
    const look = describeRecapRow(sinEntrada, 'codex');

    expect(look.state).toBe('sin leer todavía');
    expect(look.tone).toBe('idle');
    expect(look.canRedo).toBe(true);
    expect(look.canRead).toBe(false);
    expect(look.canApprove).toBe(false);
  });

  it('y el boton no dice «rehacer» lo que nadie ha hecho', () => {
    expect(describeRecapRow(sinEntrada, 'codex').redoLabel).toBe('Leerla con Codex');
    expect(describeRecapRow(buena, 'codex').redoLabel).toBe('Rehacerlo con Codex');
  });
});

describe('una ficha sin negativa', () => {
  it('en uso enseña el titulo y apunta al CLI elegido', () => {
    const look = describeRecapRow(buena, 'claude');
    expect(look.state).toBe('en uso');
    expect(look.tone).toBe('ok');
    expect(look.title).toBe('La noche del hotel');
    expect(look.retryWith).toBe('claude');
  });

  it('sin aprobar lo dice, y ofrece aprobarla', () => {
    const look = describeRecapRow({ ...buena, approved: false, inPrompt: false }, 'codex');
    expect(look.state).toBe('sin aprobar');
    expect(look.canApprove).toBe(true);
    expect(look.canRead).toBe(true);
    // nadie la habia aprobado, asi que no hay ninguna decision perdida
    expect(look.approvalLost).toBe(false);
  });

  it('LA QUE ESTABA APROBADA no se lee igual que la que nadie ha mirado', () => {
    // las dos llegan aqui como `approved: false`, y significan cosas muy
    // distintas: la segunda nunca ha viajado, y la primera ha DEJADO de viajar
    // en ese hilo porque el trabajo de fondo la reescribio
    const look = describeRecapRow(
      { ...buena, approved: false, approvalReset: true, inPrompt: false },
      'codex',
    );
    expect(look.approvalLost).toBe(true);
    expect(look.state).toBe('la aprobaste y se ha reescrito');
    // y con el boton que la devuelve: avisar sin salida seria peor que callar
    expect(look.canApprove).toBe(true);
  });

  it('BORRAR la memoria propia puede costar la aprobacion, y hay que decirlo antes', () => {
    // la ficha aprobada que NO llega hasta el final: al quitar la memoria
    // sellada, esa conversacion vuelve a la cola del trabajo de fondo y la
    // pasada la amplia, dejandola sin aprobar. El dialogo decia ahi «la ficha
    // retroactiva se queda donde esta», que es verdad del texto y falso de la
    // decision de Daniel
    const look = describeRecapRow(
      { ...buena, sealed: true, inPrompt: false, sealedBlock: 'Resumen: lo suyo.' },
      'codex',
    );
    expect(look.forgetRevivesCard).toBe(false);
    expect(look.forgetCostsApproval).toBe(true);
  });

  it('y NO se dice cuando la ficha va a empezar a viajar: de eso avisa el aviso rojo', () => {
    const look = describeRecapRow(
      {
        ...buena,
        sealed: true,
        inPrompt: false,
        sealedBlock: 'Resumen: lo suyo.',
        cardRevivesOnForget: true,
      },
      'codex',
    );
    expect(look.forgetRevivesCard).toBe(true);
    expect(look.forgetCostsApproval).toBe(false);
  });

  it('ni cuando no habia aprobacion que perder', () => {
    const look = describeRecapRow(
      {
        ...buena,
        approved: false,
        sealed: true,
        inPrompt: false,
        sealedBlock: 'Resumen: lo suyo.',
      },
      'codex',
    );
    expect(look.forgetCostsApproval).toBe(false);
  });

  it('una aprobacion perdida NO se anuncia si la ficha ya volvio a aprobarse', () => {
    const look = describeRecapRow({ ...buena, approvalReset: true }, 'codex');
    expect(look.approvalLost).toBe(false);
    expect(look.state).toBe('en uso');
  });

  it('ni en una conversacion que ya tiene memoria propia, donde la ficha no pinta nada', () => {
    const look = describeRecapRow(
      { ...buena, approved: false, approvalReset: true, superseded: true, inPrompt: false },
      'codex',
    );
    expect(look.approvalLost).toBe(false);
    expect(look.state).toBe('ya tiene memoria propia');
  });

  it('aprobada y aun asi fuera del prompt NO se calla', () => {
    // es la invariante de cobertura: la ficha no llega hasta la cola literal, asi
    // que hay un hueco que nadie ha declarado y el turno la esta descartando.
    // Decir «aprobada» a secas seria decir que viaja
    const look = describeRecapRow({ ...buena, inPrompt: false }, 'codex');
    expect(look.state).toContain('todavía no llega');
    expect(look.canApprove).toBe(false);
  });

  it('la que ya tiene memoria propia no se aprueba ni se rehace', () => {
    const look = describeRecapRow(
      { ...buena, superseded: true, approved: false, inPrompt: false, block: '' },
      'codex',
    );
    expect(look.state).toBe('ya tiene memoria propia');
    expect(look.canApprove).toBe(false);
    expect(look.canRedo).toBe(false);
    expect(look.canRead).toBe(false);
  });

  it('una fila sin nada escrito no ofrece leer ni aprobar', () => {
    const look = describeRecapRow(
      { ...buena, block: '', approved: false, inPrompt: false },
      'codex',
    );
    expect(look.canRead).toBe(false);
    expect(look.canApprove).toBe(false);
    // y sin ficha tampoco se enseña el titulo: no hay nada que juzgar
    expect(look.title).toBeNull();
    expect(look.canRedo).toBe(true);
  });
});

describe('la firma con la que se sabe si el repaso ha cambiado algo', () => {
  /** una fila cualquiera, con los campos que mira la firma */
  const fila = {
    conversationId: 'c1',
    at: '2026-01-01T00:00:00.000Z',
    chars: 120,
    covered: 10,
    turns: 12,
    gaps: 0,
    block: 'RESUMEN: van bien.',
    sealedBlock: '',
    source: 'cli' as const,
    approved: true,
    approvalReset: false,
    inPrompt: true,
    sealed: false,
    superseded: false,
    excluded: false,
    hasEntry: true,
    cardRevivesOnForget: false,
    refusedKind: null,
  };

  it('dos lecturas iguales dan la misma firma: eso es «sigue igual»', () => {
    expect(recapSignature([fila])).toBe(recapSignature([{ ...fila }]));
  });

  it('cambiar el estado de una fila la cambia', () => {
    expect(recapSignature([fila])).not.toBe(recapSignature([{ ...fila, approved: false }]));
  });

  it('una ficha reescrita la cambia aunque mida lo mismo, por la fecha', () => {
    const reescrita = { ...fila, at: '2026-02-02T00:00:00.000Z' };
    expect(recapSignature([fila])).not.toBe(recapSignature([reescrita]));
  });

  it('NO lleva ni una palabra del contenido, solo su largo', () => {
    // es contenido descifrado de la boveda: la firma sobrevive en un `ref`
    // durante toda la sesion y no tiene por que guardar una segunda copia
    const firma = recapSignature([fila, { ...fila, conversationId: 'c2', sealedBlock: 'Resumen: lo suyo.' }]);
    expect(firma).not.toContain('van bien');
    expect(firma).not.toContain('lo suyo');
    expect(firma).toContain(String(fila.block.length));
  });

  it('un bloque distinto del mismo largo no se detecta, y es el precio aceptado', () => {
    // documentado a proposito: lo que de verdad cambia una ficha cambia tambien
    // su fecha o su tamaño, y el caso contrario solo hace que el acuse diga
    // «sigue igual» de mas, nunca que se pierda nada
    const otro = { ...fila, block: 'RESUMEN: van maaal' };
    expect(otro.block.length).toBe(fila.block.length);
    expect(recapSignature([otro])).toBe(recapSignature([fila]));
  });
});

describe('las clasificaciones', () => {
  it('todas tienen texto, y ninguno es una cita del modelo', () => {
    for (const kind of RECAP_REFUSAL_KINDS) {
      const label = RECAP_REFUSAL_LABELS[kind];
      expect(label.length).toBeGreaterThan(0);
      expect(label.includes('«')).toBe(false);
      expect(label.includes('"')).toBe(false);
    }
  });
});
