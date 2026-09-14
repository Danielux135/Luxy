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
  describeRecapRow,
  otherCli,
  type RecapRowView,
} from './vault-recap-row.js';

/** una ficha escrita, aprobada y viajando en el prompt */
const buena: RecapRowView = {
  title: 'La noche del hotel',
  block: 'RESUMEN: van bien.',
  source: 'cli',
  approved: true,
  inPrompt: true,
  superseded: false,
  sealed: false,
  excluded: false,
  hasEntry: true,
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
