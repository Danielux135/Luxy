// la pista del selector de razonamiento (`D-107`).
//
// Existe por un fallo de pantalla: en el formulario del proveedor HTTP el valor
// se guarda en el nivel superior y viaja con CUALQUIER modelo que pida la
// peticion y no tenga su propio ajuste, pero las opciones y la nota salen del
// modelo del formulario, y nada decia que no fuera un ajuste solo de ese modelo.
//
// Y los textos del mismo selector en un host con dialecto de catalogo (F36): el
// caso es NanoGPT, que publica en su catalogo los niveles de cada modelo. Alli
// nada de lo que se dice esta comprobado con una llamada, asi que las pruebas
// fijan QUE se afirma y de quien: «NanoGPT declara», con la fecha del catalogo,
// y nunca «este modelo admite». Sin red: la forma de la lista es la de NanoGPT
// con detalle y los datos estan inventados.
import { describe, expect, it } from 'vitest';
import {
  buildCatalogSnapshot,
  httpProviderConfigSchema,
  storedAgentConfigSchema,
  type CatalogSnapshot,
} from '@luxy/shared';
import {
  catalogDateLabel,
  reasoningChoicesFor,
  reasoningModeError,
  type ReasoningChoices,
} from '../http-provider-config.js';
import type { StoredCatalog } from '../useCatalog.js';
import {
  PROVIDER_MODEL_SETTINGS_NOTICE,
  REFRESH_PROVIDER_MODELS,
  catalogGatewayLabel,
  catalogNoticeText,
  catalogReadLine,
  declaredReasoningTag,
  deepseekSamplingNotice,
  outputCapFieldHint,
  providerModelRowMark,
  reasoningCapWarning,
  reasoningFieldHint,
  reasoningHintFor,
  reasoningOrphanNotice,
  reasoningOrphanOption,
  storedCatalogLine,
} from './Config.js';

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

// las frases de la tabla, ENTERAS. Los pasos de Registros pasaron a decirse en
// un solo sitio para que el camino del catalogo los comparta; estas son las de
// antes de moverlos, letra por letra, y las citan LA-055 y LA-058
const TABLA_CON_OPCIONES =
  'Es del proveedor, no solo de este modelo: viaja también con cualquier otro modelo suyo que ' +
  'elijas en una conversación, si no tiene su propio ajuste y admite este valor; a los que no ' +
  'lo admiten no se les envía nada. Las opciones de aquí son las del modelo de arriba. Nota ' +
  'inventada. No se sabe si tu pasarela deja pasar este ajuste. Para saberlo: envía un mensaje, ' +
  've a Registros, pulsa «Actualizar» y busca «llamada al proveedor». Si reasoningSent dice ' +
  'not_sent, no se envió nada. reasoningVerdict dice qué se le notó: visible, razonó y se ve; ' +
  'counted, el proveedor dice que razonó sin enseñarlo (cuánto, en reasoningTokensReported); ' +
  'hidden, probablemente razonó sin enseñarlo; not_seen, no se le notó; unclear o no_data, no ' +
  'se puede decir.';
const TABLA_SIN_OPCIONES =
  'Luxy no sabe cómo pedírselo a este modelo: no enviará nada. Sólo se ofrece donde la ' +
  'documentación del modelo dice qué valores admite.';

const NANO_URL = 'https://api.nano-gpt.com/api/v1';
const TABLA_URL = 'https://api.example/v1';
const FLASH = 'deepseek/deepseek-v4-flash-0731';
const CYDONIA = 'TheDrummer/Cydonia-24B-v4.3';
const THINKING = 'deepseek/deepseek-v3.2:thinking';
const RARO = 'raro/niveles-que-luxy-no-conoce';
const CORTO = 'corto/tope-pequeno';
const LEIDO = '2026-10-13T09:30:00.000Z';
// la fecha tal y como la dicen los errores de `reasoningModeError`: las pistas
// tienen que decirla igual
const FECHA = catalogDateLabel(LEIDO) ?? '';
const CUANDO = new Date(LEIDO).toLocaleString();

function leido(detail: 'detailed' | 'basic' | undefined, modelsPayload: unknown): StoredCatalog {
  return {
    loading: false,
    snapshot: buildCatalogSnapshot({
      connectionId: 'nanogpt',
      source: 'http',
      fetchedAt: LEIDO,
      modelsPayload,
      pricingPayload: null,
      ...(detail === undefined ? {} : { detail }),
    }),
  };
}

const CON_DETALLE = leido('detailed', {
  object: 'list',
  data: [
    {
      id: FLASH,
      capabilities: { reasoning: true },
      reasoning_efforts: ['none', 'high', 'max'],
      max_output_tokens: 131072,
    },
    // la pasarela declara que no razona
    { id: CYDONIA, capabilities: { reasoning: false }, max_output_tokens: null },
    // razona y no declara niveles
    { id: THINKING, capabilities: { reasoning: true }, max_output_tokens: 65536 },
    // declara niveles, pero ninguno que Luxy sepa nombrar
    { id: RARO, capabilities: { reasoning: true }, reasoning_efforts: ['auto', 'turbo'] },
    // declara niveles sin `max` y un tope de salida pequeño
    {
      id: CORTO,
      capabilities: { reasoning: true },
      reasoning_efforts: ['low', 'high'],
      max_output_tokens: 8192,
    },
  ],
});
const SIN_DETALLE = leido('basic', { object: 'list', data: [{ id: FLASH }, { id: CYDONIA }] });
const SIN_CATALOGO: StoredCatalog = { snapshot: null, loading: false };
const LEYENDO: StoredCatalog = { snapshot: null, loading: true };

/** las opciones de un modelo en la entrada POR MODELO de un proveedor de NanoGPT */
function enNano(model: string, stored: StoredCatalog = CON_DETALLE): ReasoningChoices {
  return reasoningChoicesFor(model, NANO_URL, { stored });
}

function modelo(catalog: StoredCatalog, apiModel: string): CatalogSnapshot['models'][number] {
  const found = catalog.snapshot?.models.find((entry) => entry.apiModel === apiModel);
  if (found === undefined) throw new Error(`falta ${apiModel} en el catalogo de la prueba`);
  return found;
}

/**
 * lo que NINGUN texto de un host con dialecto de catalogo puede decir (`D-093`):
 * que el modelo «admite» algo, que algo esta «verificado», la pista de la tabla,
 * ni «no razona» como afirmacion propia. Solo vale como algo que la pasarela
 * DECLARA.
 */
function soloLoDeclarado(texto: string, caso: string): void {
  expect(texto, caso).not.toMatch(/admit|verificad/i);
  expect(texto, caso).not.toContain('Luxy no sabe cómo pedírselo');
  expect(texto, caso).not.toContain('Es del proveedor, no solo de este modelo');
  const sinAtribuir = texto.replace(/declara que (este modelo )?no razona/g, '');
  expect(sinAtribuir, caso).not.toContain('no razona');
}

describe('los textos de un host de la tabla no cambian ni una letra', () => {
  it('la pista son las frases de siempre, enteras, tambien con las opciones ya calculadas', () => {
    expect(
      reasoningFieldHint({ options: ['low'], note: 'Nota inventada.', providerWide: true }),
    ).toBe(TABLA_CON_OPCIONES);
    expect(reasoningFieldHint({ options: [], note: null, providerWide: false })).toBe(
      TABLA_SIN_OPCIONES,
    );
    // el selector ya no llama a esa funcion directamente: recibe las opciones
    // calculadas y pregunta a `reasoningHintFor`, que en la tabla tiene que dar
    // exactamente lo mismo. Un modelo con regla: DeepSeek-V4-Flash solo ofrece
    // apagarlo
    const conRegla = reasoningChoicesFor('DeepSeek-V4-Flash', TABLA_URL);
    expect(conRegla.options).toEqual(['off']);
    for (const providerWide of [true, false]) {
      expect(reasoningHintFor(conRegla, { providerWide })).toBe(
        reasoningFieldHint({ options: ['off'], note: conRegla.note, providerWide }),
      );
    }
    // y uno sin regla, con el nombre vacio o sin el, y aunque alguien le pase
    // un catalogo que declara otra cosa: alli manda la tabla
    const sinRegla = reasoningChoicesFor(FLASH, TABLA_URL, { stored: CON_DETALLE });
    expect(reasoningHintFor(sinRegla, { providerWide: true })).toBe(TABLA_SIN_OPCIONES);
    expect(reasoningHintFor(sinRegla, { providerWide: false, modelEmpty: true })).toBe(
      TABLA_SIN_OPCIONES,
    );
  });

  it('el valor que ya no vale se rotula como siempre: alli no viaja', () => {
    const sinRegla = reasoningChoicesFor('modelo-sin-regla', TABLA_URL);
    expect(reasoningOrphanNotice('high', sinRegla)).toBe(
      'Este modelo no admite ese valor: elige otro o «Lo que traiga el modelo (no se envía ' +
        'nada)». Luxy no sabe cómo pedírselo a este modelo.',
    );
    expect(reasoningOrphanOption('high', sinRegla)).toBe('Razonar más (high) (no admitido)');
    // con regla, la nota del modelo va dentro del aviso
    const conRegla = reasoningChoicesFor('DeepSeek-V4-Flash', TABLA_URL);
    expect(reasoningOrphanNotice('high', conRegla)).toBe(
      'Este modelo no admite ese valor: elige otro o «Lo que traiga el modelo (no se envía ' +
        `nada)». ${conRegla.note}`,
    );
  });

  it('el aviso de DeepSeek dice lo de siempre, con regla y sin ella', () => {
    const documentado =
      'DeepSeek documenta que, cuando el modelo razona, ni la temperatura ni las penalizaciones ' +
      'de frecuencia y de presencia hacen efecto.';
    const medir =
      'Para medir, cambia una sola cosa cada vez y mira en Registros si esa llamada razonó.';
    expect(deepseekSamplingNotice(reasoningChoicesFor('DeepSeek-V4-Flash', TABLA_URL))).toBe(
      `${documentado} Con «Sin razonar» sí, si tu pasarela deja pasar el ajuste: el registro lo ` +
        `dirá. ${medir}`,
    );
    expect(deepseekSamplingNotice(reasoningChoicesFor('deepseek-chat', TABLA_URL))).toBe(
      `${documentado} Luxy sólo sabe apagarle el razonamiento a DeepSeek-V4-Flash, V4-Pro y ` +
        `V4.1-Flash; con este nombre no puede. ${medir}`,
    );
  });

  it('sin dialecto de catalogo no hay marca de fila ni dato de la pasarela junto al tope', () => {
    const fila = { apiModel: FLASH, sampling: { reasoningMode: 'max' as const } };
    expect(providerModelRowMark(fila, TABLA_URL, CON_DETALLE)).toBeNull();
    expect(providerModelRowMark(fila, TABLA_URL, SIN_CATALOGO)).toBeNull();
    expect(
      outputCapFieldHint(8192, reasoningChoicesFor(FLASH, TABLA_URL, { stored: CON_DETALLE })),
    ).toBe(
      'Vacío = el del proveedor (8192). Un número entero entre 256 y 200000, sin puntos ni comas.',
    );
  });
});

describe('la pista del selector en un host con dialecto de catalogo', () => {
  it('con niveles declarados dice quien los declara, cuando se leyeron y como comprobarlo', () => {
    const texto = reasoningHintFor(enNano(CORTO), { providerWide: false });
    expect(texto).toContain(
      'NanoGPT declara estos niveles para este modelo en su catálogo; no está comprobado con ' +
        'ninguna llamada.',
    );
    expect(texto).toContain('Lo que eliges es lo que Luxy pide');
    expect(texto).toContain('NanoGPT puede ajustarlo al más cercano');
    expect(FECHA).not.toBe('');
    expect(texto).toContain(`Luxy leyó ese catálogo el ${FECHA}.`);
    // los pasos de Registros, los mismos que dice la pista de la tabla
    expect(texto).toContain('ve a Registros, pulsa «Actualizar» y busca «llamada al proveedor»');
    expect(texto).toContain('Si reasoningSent dice not_sent, no se envió nada.');
    // pero no la frase de la tabla sobre «tu pasarela»
    expect(texto).not.toContain('No se sabe si tu pasarela deja pasar este ajuste');
    // este modelo no declara `max`: no se habla de el
    expect(texto).not.toContain('(max)');
    soloLoDeclarado(texto, 'niveles');
  });

  it('si la lista trae max, avisa de que no figura en el esquema publicado de la API', () => {
    const texto = reasoningHintFor(enNano(FLASH), { providerWide: false });
    expect(texto).toContain(
      '«Razonar al máximo (max)» figura en el catálogo y en la guía de NanoGPT, no en el esquema ' +
        'publicado de su API: si contesta con un error, elige otro.',
    );
    soloLoDeclarado(texto, 'niveles con max');
  });

  it('sin catalogo manda a pulsar el boton de la propia tarjeta, y leyendo dice que lee', () => {
    const falta = reasoningHintFor(enNano(FLASH, SIN_CATALOGO), { providerWide: false });
    expect(falta).toBe(
      'No hay ningún catálogo de NanoGPT guardado, y los niveles salen de él: pulsa ' +
        '«Actualizar modelos de este proveedor».',
    );
    expect(reasoningHintFor(enNano(FLASH, LEYENDO), { providerWide: false })).toBe(
      'Luxy está leyendo el catálogo guardado de NanoGPT: los niveles salen de él.',
    );
    // el rotulo del boton es el que citan la pista y el error al guardar
    expect(REFRESH_PROVIDER_MODELS).toBe('Actualizar modelos de este proveedor');
    expect(reasoningModeError('high', FLASH, NANO_URL, { stored: SIN_CATALOGO })).toContain(
      `«${REFRESH_PROVIDER_MODELS}»`,
    );
  });

  it('un catalogo leido sin detalle lo dice, manda a actualizar y deja elegir a mano', () => {
    const texto = reasoningHintFor(enNano(FLASH, SIN_DETALLE), { providerWide: false });
    expect(texto).toContain(
      `El catálogo guardado de NanoGPT del ${FECHA} se leyó sin detalle y no trae los niveles ` +
        'que declara cada modelo: pulsa «Actualizar modelos de este proveedor» para pedirlo ' +
        'otra vez.',
    );
    expect(texto).toContain('el nivel se elige a mano y decide NanoGPT');
    expect(texto).toContain('Un error así no se reintenta.');
    expect(texto).toContain('busca «llamada al proveedor»');
    soloLoDeclarado(texto, 'sin detalle');
  });

  it('sin detalle y con «Modelo» vacio no habla de un nivel que no se puede elegir', () => {
    // es lo PRIMERO que se ve al pulsar «Añadir modelo» con un catalogo leido sin
    // detalle: todavia no hay nombre, y sin nombre el selector no ofrece nada
    const vacio = enNano('  ', SIN_DETALLE);
    expect(vacio.source).toBe('basic');
    expect(vacio.options).toEqual([]);
    const esperado =
      `El catálogo guardado de NanoGPT del ${FECHA} se leyó sin detalle y no trae los niveles ` +
      'que declara cada modelo: pulsa «Actualizar modelos de este proveedor» para pedirlo otra ' +
      'vez. Escribe arriba el modelo para elegir el nivel a mano.';
    expect(reasoningHintFor(vacio, { providerWide: false, modelEmpty: true })).toBe(esperado);
    // mandan las opciones: da igual que quien llama no diga que el campo esta vacio
    expect(reasoningHintFor(vacio, { providerWide: false })).toBe(esperado);
    soloLoDeclarado(esperado, 'sin detalle, sin modelo');
  });

  it('un modelo que no declara niveles se puede elegir a mano, y decide la pasarela', () => {
    const texto = reasoningHintFor(enNano(THINKING), { providerWide: false });
    expect(texto).toContain(
      `NanoGPT no declara niveles para este modelo en su catálogo del ${FECHA}.`,
    );
    expect(texto).toContain('el nivel se elige a mano y decide NanoGPT');
    expect(texto).toContain('puede ajustarlo o contestar con un error');
    expect(texto).toContain('Un error así no se reintenta.');
    soloLoDeclarado(texto, 'sin niveles');
  });

  it('sin niveles declarados ni nada que ofrecer tampoco deja colgada la frase del error', () => {
    // un catalogo recien leido no trae identificadores vacios, pero el esquema
    // del disco si los deja pasar: con uno, el campo «Modelo» vacio cae en
    // `no-levels` y el selector sigue sin ofrecer nada
    const detalle = CON_DETALLE.snapshot;
    if (detalle === null) throw new Error('falta el catalogo de la prueba');
    const conVacio: StoredCatalog = {
      loading: false,
      snapshot: {
        ...detalle,
        models: [...detalle.models, { ...modelo(CON_DETALLE, THINKING), apiModel: '' }],
      },
    };
    const vacio = enNano('', conVacio);
    expect(vacio.source).toBe('no-levels');
    expect(vacio.options).toEqual([]);
    expect(reasoningHintFor(vacio, { providerWide: false, modelEmpty: true })).toBe(
      `NanoGPT no declara niveles para este modelo en su catálogo del ${FECHA}. Escribe arriba ` +
        'el modelo para elegir el nivel a mano.',
    );
  });

  it('lo que la pasarela declara que no razona se dice asi, con su fecha', () => {
    expect(reasoningHintFor(enNano(CYDONIA), { providerWide: false })).toBe(
      `NanoGPT declara que este modelo no razona, en su catálogo del ${FECHA}: no se ofrece ` +
        'ningún nivel.',
    );
  });

  it('un identificador que no esta en el catalogo manda a mirar mayusculas y sufijo', () => {
    const otro = enNano('deepseek/DeepSeek-V4-Flash-0731');
    expect(otro.source).toBe('unknown-model');
    expect(reasoningHintFor(otro, { providerWide: false })).toBe(
      `Este identificador no está en el catálogo de NanoGPT del ${FECHA}: comprueba las ` +
        'mayúsculas y el sufijo, o pulsa «Actualizar modelos de este proveedor». Mientras no ' +
        'esté, no se ofrece ningún nivel.',
    );
    // con el campo del modelo vacio no hay identificador del que hablar
    const vacio = reasoningHintFor(enNano('  '), { providerWide: false, modelEmpty: true });
    expect(vacio).toBe(
      'Escribe arriba el modelo: los niveles salen de lo que NanoGPT declara para cada uno en ' +
        `su catálogo del ${FECHA}.`,
    );
  });

  it('niveles declarados que Luxy no sabe pedir se nombran tal cual, sin ofrecer ninguno', () => {
    const texto = reasoningHintFor(enNano(RARO), { providerWide: false });
    expect(texto).toBe(
      `NanoGPT declara para este modelo, en su catálogo del ${FECHA}, niveles que Luxy no sabe ` +
        'pedir (auto, turbo): no se ofrece ninguno.',
    );
  });

  it('el nivel de proveedor no se ofrece: dice que alli se elige por modelo', () => {
    const delProveedor = reasoningChoicesFor(FLASH, NANO_URL, { providerWide: true });
    expect(delProveedor.options).toEqual([]);
    const texto = reasoningHintFor(delProveedor, { providerWide: true });
    expect(texto).toContain(
      'En NanoGPT el nivel no se elige para todo el proveedor, sino para cada modelo',
    );
    expect(texto).toContain('Se elige en «Ajustes por modelo», en la tarjeta de este proveedor');
    soloLoDeclarado(texto, 'nivel de proveedor');
    // y una conexion apuntada a ese host no tiene catalogo que leer
    const conexion = reasoningHintFor(reasoningChoicesFor(FLASH, NANO_URL), {
      providerWide: false,
    });
    expect(conexion).toContain('Luxy sólo lo lee para un proveedor HTTP');
    soloLoDeclarado(conexion, 'conexion');
  });

  it('ningun texto de esos hosts dice «admite», «verificado» ni la pista de la tabla', () => {
    const casos: [string, ReasoningChoices][] = [
      ['niveles', enNano(FLASH)],
      ['niveles raros', enNano(RARO)],
      ['sin niveles', enNano(THINKING)],
      ['no razona', enNano(CYDONIA)],
      ['fuera del catalogo', enNano('no/existe')],
      ['sin detalle', enNano(FLASH, SIN_DETALLE)],
      ['sin catalogo', enNano(FLASH, SIN_CATALOGO)],
      ['leyendo', enNano(FLASH, LEYENDO)],
      ['nivel de proveedor', reasoningChoicesFor(FLASH, NANO_URL, { providerWide: true })],
      ['conexion', reasoningChoicesFor(FLASH, NANO_URL)],
    ];
    for (const [caso, choices] of casos) {
      expect(choices.dialect?.label, caso).toBe('NanoGPT');
      soloLoDeclarado(reasoningHintFor(choices, { providerWide: false }), `pista: ${caso}`);
      soloLoDeclarado(reasoningOrphanNotice('medium', choices), `aviso: ${caso}`);
      soloLoDeclarado(reasoningOrphanOption('medium', choices), `opcion: ${caso}`);
      soloLoDeclarado(deepseekSamplingNotice(choices), `deepseek: ${caso}`);
      soloLoDeclarado(outputCapFieldHint(4096, choices), `tope: ${caso}`);
      soloLoDeclarado(
        reasoningCapWarning({ ownIsEmpty: true, providerMax: 4096, choices }),
        `aviso de tope: ${caso}`,
      );
    }
  });

  it('ninguna pista deja una frase colgada, con el modelo escrito o con el campo vacio', () => {
    // todos los estados del catalogo por todos los modelos de la prueba, y el
    // campo vacio en cada uno: es lo que se ve nada mas pulsar «Añadir modelo»
    const modelos = ['', '  ', FLASH, CYDONIA, THINKING, RARO, CORTO, 'no/existe'];
    const catalogos: [string, StoredCatalog][] = [
      ['con detalle', CON_DETALLE],
      ['sin detalle', SIN_DETALLE],
      ['sin catalogo', SIN_CATALOGO],
      ['leyendo', LEYENDO],
    ];
    const casos: [string, ReasoningChoices, boolean][] = [
      ['nivel de proveedor', reasoningChoicesFor(FLASH, NANO_URL, { providerWide: true }), false],
      ['conexion', reasoningChoicesFor(FLASH, NANO_URL), false],
      ['conexion sin modelo', reasoningChoicesFor('', NANO_URL), true],
    ];
    for (const [nombre, stored] of catalogos) {
      for (const model of modelos) {
        casos.push([`${nombre}: «${model}»`, enNano(model, stored), model.trim().length === 0]);
      }
    }
    for (const [caso, choices, modelEmpty] of casos) {
      const texto = reasoningHintFor(choices, { providerWide: false, modelEmpty });
      // una pieza vacia en medio de la frase deja dos espacios seguidos
      expect(texto, caso).not.toMatch(/\s{2}/);
      expect(texto, caso).toBe(texto.trim());
      // «un error así» solo vale detras de la nota que habla del error
      if (texto.includes('Un error así no se reintenta.')) {
        expect(texto, caso).toContain('o contestar con un error. Un error así no se reintenta.');
      }
      // sin nada que elegir no hay envio que ir a mirar a Registros
      if (choices.options.length === 0) {
        expect(texto, caso).not.toContain('busca «llamada al proveedor»');
        expect(texto, caso).not.toContain('Un error así');
      }
    }
  });
});

describe('un valor que ya no se ofrece en un host con dialecto de catalogo', () => {
  it('si la pasarela ya no lo declara, se dice asi y que Luxy lo sigue enviando', () => {
    // FLASH declara none, high y max: «low» no esta
    expect(reasoningOrphanNotice('low', enNano(FLASH))).toBe(
      `NanoGPT no declara «poco (low)» para este modelo en su catálogo del ${FECHA}. Si ya ` +
        'estaba guardado, Luxy lo sigue enviando hasta que lo cambies. Elige uno de los que ' +
        'declara o «Lo que traiga el modelo (no se envía nada)».',
    );
    expect(reasoningOrphanOption('low', enNano(FLASH))).toBe(
      'Razonar poco (low) (NanoGPT no lo declara)',
    );
  });

  it('cada silencio del catalogo dice el suyo, y ninguno que el valor deje de viajar', () => {
    const sigue = 'Luxy lo sigue enviando hasta que lo cambies';
    const noRazona = reasoningOrphanNotice('high', enNano(CYDONIA));
    expect(noRazona).toContain(
      `NanoGPT declara que este modelo no razona, en su catálogo del ${FECHA}.`,
    );
    expect(noRazona).toContain(sigue);
    expect(reasoningOrphanOption('high', enNano(CYDONIA))).toBe(
      'Razonar más (high) (NanoGPT no lo declara)',
    );

    const fuera = reasoningOrphanNotice('high', enNano('no/existe'));
    expect(fuera).toContain(`Este identificador no está en el catálogo de NanoGPT del ${FECHA}`);
    expect(fuera).toContain('Luxy no puede comprobar «más (high)»');
    expect(fuera).toContain('lo sigue enviando hasta que lo cambies');
    expect(reasoningOrphanOption('high', enNano('no/existe'))).toBe(
      'Razonar más (high) (sin comprobar)',
    );

    const falta = reasoningOrphanNotice('high', enNano(FLASH, SIN_CATALOGO));
    expect(falta).toContain('No hay ningún catálogo de NanoGPT guardado');
    expect(falta).toContain(sigue);
    expect(falta).toContain(`Pulsa «${REFRESH_PROVIDER_MODELS}».`);

    const raros = reasoningOrphanNotice('high', enNano(RARO));
    expect(raros).toContain('niveles que Luxy no sabe pedir (auto, turbo)');
    expect(raros).toContain(sigue);

    // en una conexion a ese host tambien viaja lo que se escribio a mano
    const conexion = reasoningOrphanNotice('high', reasoningChoicesFor(FLASH, NANO_URL));
    expect(conexion).toContain('aquí no puede comprobar «más (high)»');
    expect(conexion).toContain(sigue);
  });

  it('el nivel de proveedor es el unico que no se envia, y se dice', () => {
    const delProveedor = reasoningChoicesFor(FLASH, NANO_URL, { providerWide: true });
    const texto = reasoningOrphanNotice('high', delProveedor);
    expect(texto).toContain('En NanoGPT el nivel de proveedor no se envía nunca');
    expect(texto).toContain('elígelo en «Ajustes por modelo», en la tarjeta de este proveedor');
    expect(texto).not.toContain('sigue enviando');
    expect(reasoningOrphanOption('high', delProveedor)).toBe(
      'Razonar más (high) (aquí no se envía)',
    );
  });

  it('mientras se lee el catalogo, el valor guardado se enseña sin juzgarlo', () => {
    expect(reasoningOrphanOption('high', enNano(FLASH, LEYENDO))).toBe(
      'Razonar más (high) (leyendo el catálogo)',
    );
  });
});

describe('el aviso de DeepSeek en un host con dialecto de catalogo', () => {
  it('no dice que Luxy no pueda con ese nombre: el selector de debajo ofrece niveles', () => {
    const texto = deepseekSamplingNotice(enNano(FLASH));
    expect(texto).toBe(
      'DeepSeek documenta que, cuando el modelo razona, ni la temperatura ni las penalizaciones ' +
        'de frecuencia y de presencia hacen efecto. No está comprobado en NanoGPT: con ' +
        'cualquier nivel distinto de «Sin razonar», la temperatura y las penalizaciones de esta ' +
        'entrada pueden dejar de actuar sin dar error. Para medir, cambia una sola cosa cada ' +
        'vez y mira en Registros si esa llamada razonó.',
    );
    expect(texto).not.toContain('con este nombre no puede');
    expect(texto).not.toContain('Luxy sólo sabe apagarle');
  });
});

describe('la marca de una fila de «Ajustes por modelo»', () => {
  const fila = (
    apiModel: string,
    reasoningMode?: 'off' | 'low' | 'high' | 'max',
  ): Parameters<typeof providerModelRowMark>[0] => ({
    apiModel,
    sampling: reasoningMode === undefined ? undefined : { reasoningMode },
  });

  it('calla cuando el nivel guardado esta entre los declarados, o no hay nivel', () => {
    expect(providerModelRowMark(fila(FLASH, 'high'), NANO_URL, CON_DETALLE)).toBeNull();
    expect(providerModelRowMark(fila(FLASH, 'off'), NANO_URL, CON_DETALLE)).toBeNull();
    // solo tope, o solo temperatura: no hay nivel que marcar
    expect(providerModelRowMark(fila(FLASH), NANO_URL, CON_DETALLE)).toBeNull();
    expect(providerModelRowMark(fila(CYDONIA), NANO_URL, CON_DETALLE)).toBeNull();
    // elegido a mano en un modelo que no declara niveles: no es un desfase
    expect(providerModelRowMark(fila(THINKING, 'max'), NANO_URL, CON_DETALLE)).toBeNull();
  });

  it('marca el nivel guardado que la pasarela ya no declara, con la fecha', () => {
    expect(providerModelRowMark(fila(FLASH, 'low'), NANO_URL, CON_DETALLE)).toBe(
      `NanoGPT no declara «poco (low)» en el catálogo del ${FECHA}; Luxy lo sigue enviando ` +
        'hasta que lo cambies.',
    );
    expect(providerModelRowMark(fila(CYDONIA, 'high'), NANO_URL, CON_DETALLE)).toBe(
      `NanoGPT declara que este modelo no razona, en su catálogo del ${FECHA}; Luxy sigue ` +
        'enviando «más (high)» hasta que lo cambies.',
    );
  });

  it('marca el identificador que no esta en el catalogo, tenga nivel o no', () => {
    const errata = 'deepseek/DeepSeek-V4-Flash-0731';
    expect(providerModelRowMark(fila(errata), NANO_URL, CON_DETALLE)).toBe(
      `Este identificador no está en el catálogo de NanoGPT del ${FECHA}: comprueba las ` +
        'mayúsculas y el sufijo.',
    );
    expect(providerModelRowMark(fila(errata, 'high'), NANO_URL, CON_DETALLE)).toBe(
      `Este identificador no está en el catálogo de NanoGPT del ${FECHA}: comprueba las ` +
        'mayúsculas y el sufijo. Luxy sigue enviando «más (high)» con él.',
    );
  });

  it('no afirma nada de lo que el catalogo guardado no permite decir', () => {
    // todavia no se ha leido: no se sabe
    expect(providerModelRowMark(fila(FLASH, 'low'), NANO_URL, LEYENDO)).toBeNull();
    expect(providerModelRowMark(fila('no/existe', 'low'), NANO_URL, LEYENDO)).toBeNull();
    // leido sin detalle: no se pidieron los niveles, ni se puede decir que falte
    expect(providerModelRowMark(fila(FLASH, 'low'), NANO_URL, SIN_DETALLE)).toBeNull();
    expect(providerModelRowMark(fila('no/existe'), NANO_URL, SIN_DETALLE)).toBeNull();
    // sin catalogo solo se dice que el nivel no se puede comprobar
    expect(providerModelRowMark(fila(FLASH), NANO_URL, SIN_CATALOGO)).toBeNull();
    expect(providerModelRowMark(fila(FLASH, 'high'), NANO_URL, SIN_CATALOGO)).toBe(
      'No hay catálogo de NanoGPT guardado para comprobar «más (high)»; Luxy lo sigue enviando.',
    );
  });

  it('ninguna marca dice «admite» ni «no razona» por su cuenta', () => {
    for (const [row, stored] of [
      [fila(FLASH, 'low'), CON_DETALLE],
      [fila(CYDONIA, 'high'), CON_DETALLE],
      [fila(RARO, 'high'), CON_DETALLE],
      [fila('no/existe', 'max'), CON_DETALLE],
      [fila(FLASH, 'high'), SIN_CATALOGO],
    ] as const) {
      const marca = providerModelRowMark(row, NANO_URL, stored);
      expect(marca, row.apiModel).not.toBeNull();
      soloLoDeclarado(marca ?? '', row.apiModel);
    }
  });
});

describe('el campo «Máximo de tokens de este modelo»', () => {
  const BASE =
    'Vacío = el del proveedor (4096). Un número entero entre 256 y 200000, sin puntos ni comas.';

  it('pone al lado lo que declara la pasarela, con su fecha y sin separador de miles', () => {
    expect(outputCapFieldHint(4096, enNano(FLASH))).toBe(
      `${BASE} NanoGPT declara 131072 de salida para este modelo en su catálogo del ${FECHA}; ` +
        'no está comprobado con ninguna llamada.',
    );
  });

  it('sin dato de la pasarela no inventa ninguno', () => {
    // el catalogo lo trae a null, el modelo no esta, no hay catalogo, se esta leyendo
    expect(outputCapFieldHint(4096, enNano(CYDONIA))).toBe(BASE);
    expect(outputCapFieldHint(4096, enNano('no/existe'))).toBe(BASE);
    expect(outputCapFieldHint(4096, enNano(FLASH, SIN_CATALOGO))).toBe(BASE);
    expect(outputCapFieldHint(4096, enNano(FLASH, LEYENDO))).toBe(BASE);
  });

  it('el aviso de tope corto dice cual se aplicaria y cuanto poner', () => {
    const vacio = reasoningCapWarning({
      ownIsEmpty: true,
      providerMax: 4096,
      choices: enNano(FLASH),
    });
    expect(vacio).toBe(
      'Con un máximo por debajo de 8192 tokens, el razonamiento puede gastarlo entero antes de ' +
        'escribir la respuesta: sale del mismo máximo, y esa llamada se paga igual. Con este ' +
        'campo vacío se usa el del proveedor (4096). Pon aquí 8192 o más; por ejemplo, 16384.',
    );
    // con un numero escrito ya se ve cual es: no se repite el del proveedor
    const escrito = reasoningCapWarning({
      ownIsEmpty: false,
      providerMax: 16384,
      choices: enNano(FLASH),
    });
    expect(escrito).not.toContain('Con este campo vacío');
    expect(escrito).toContain('Pon aquí 8192 o más; por ejemplo, 16384.');
  });

  it('no propone mas de lo que la pasarela declara para ese modelo', () => {
    const texto = reasoningCapWarning({
      ownIsEmpty: true,
      providerMax: 4096,
      choices: enNano(CORTO),
    });
    expect(texto).toContain(
      'NanoGPT declara 8192 de salida para este modelo: no pongas más que eso.',
    );
    expect(texto).not.toContain('por ejemplo, 16384');
  });
});

describe('el aviso fijo de «Ajustes por modelo» en un proveedor HTTP', () => {
  it('dice lo que alli cuesta algo: el muestreo del proveedor, el cobro y el presupuesto', () => {
    // la entrada de un modelo sustituye ENTERO el nivel del proveedor, y eso
    // incluye su nivel de razonamiento, que en un host de la tabla si viajaba
    expect(PROVIDER_MODEL_SETTINGS_NOTICE).toContain(
      'deja de recibir la temperatura, las penalizaciones y el nivel de razonamiento del ' +
        'proveedor: repite aquí lo que quieras conservar',
    );
    expect(PROVIDER_MODEL_SETTINGS_NOTICE).toContain(
      'Poner sólo el máximo de tokens no cambia eso',
    );
    expect(PROVIDER_MODEL_SETTINGS_NOTICE).toContain(
      'Los tokens de razonamiento se cobran como salida',
    );
    expect(PROVIDER_MODEL_SETTINGS_NOTICE).toContain(
      'vale para todos los turnos de ese modelo hasta que lo quites',
    );
    expect(PROVIDER_MODEL_SETTINGS_NOTICE).toContain(
      'el «Presupuesto diario» de Luxy no lo frena en un proveedor HTTP',
    );
    soloLoDeclarado(PROVIDER_MODEL_SETTINGS_NOTICE, 'aviso fijo');
  });
});

describe('como se dice un catalogo guardado', () => {
  it('sin marca de detalle la linea es la de siempre', () => {
    expect(catalogReadLine({ fetchedAt: LEIDO }, null)).toBe(`Leido el ${CUANDO}`);
    // tambien en un host con dialecto: de un catalogo viejo no se sabe como se leyo
    expect(catalogReadLine({ fetchedAt: LEIDO }, 'NanoGPT')).toBe(`Leido el ${CUANDO}`);
  });

  it('dice si se leyo con detalle o sin el, y de quien es lo declarado', () => {
    expect(catalogReadLine({ fetchedAt: LEIDO, detail: 'detailed' }, 'NanoGPT')).toBe(
      `Leído con detalle el ${CUANDO}: trae lo que NanoGPT declara de cada modelo, que Luxy no ` +
        'ha comprobado con ninguna llamada.',
    );
    expect(catalogReadLine({ fetchedAt: LEIDO, detail: 'basic' }, 'NanoGPT')).toBe(
      `Leído sin detalle el ${CUANDO}: no trae los niveles de razonamiento que NanoGPT declara ` +
        'de cada modelo.',
    );
  });

  it('el aviso es el guardado con el catalogo, no un texto fijo', () => {
    expect(catalogNoticeText({ notice: 'Aviso guardado.' }, null)).toBe('Aviso guardado.');
    // un catalogo sin aviso conserva el de siempre en un host sin dialecto
    expect(catalogNoticeText({ notice: null }, null)).toBe(
      'Esta conexion no publica precios por API; Luxy no los consulta.',
    );
    expect(
      catalogNoticeText(
        { notice: 'Luxy no lee los precios de NanoGPT.', detail: 'detailed' },
        'NanoGPT',
      ),
    ).toBe('Luxy no lee los precios de NanoGPT.');
    expect(catalogNoticeText({ notice: null, detail: 'basic' }, 'NanoGPT')).toBe(
      'Luxy no lee los precios de NanoGPT.',
    );
  });

  it('en un host con dialecto nunca dice que la pasarela no publica precios', () => {
    // un catalogo guardado antes de F36 trae el aviso viejo y ninguna marca
    const viejo = catalogNoticeText(
      { notice: 'Esta conexion no publica precios por API; Luxy no los consulta.' },
      'NanoGPT',
    );
    expect(viejo).not.toContain('no publica precios');
    expect(viejo).toContain('se guardó antes de que Luxy pidiera su lista con detalle');
    expect(viejo).toContain('pulsa «Actualizar modelos»');
    expect(viejo).toContain('Luxy no lee los precios de NanoGPT.');
  });

  it('junto al boton: leyendo, sin catalogo, o cuantos modelos y como se leyo', () => {
    expect(storedCatalogLine(LEYENDO, 'NanoGPT')).toBe('Leyendo el catálogo guardado…');
    expect(storedCatalogLine(SIN_CATALOGO, 'NanoGPT')).toBe(
      'No hay catálogo guardado de este proveedor: Luxy no sabe qué modelos sirve.',
    );
    expect(storedCatalogLine(CON_DETALLE, 'NanoGPT')).toBe(
      `5 modelos. ${catalogReadLine({ fetchedAt: LEIDO, detail: 'detailed' }, 'NanoGPT')}`,
    );
    const uno = leido(undefined, { object: 'list', data: [{ id: FLASH }] });
    expect(storedCatalogLine(uno, null)).toBe(`1 modelo. Leido el ${CUANDO}`);
    expect(storedCatalogLine(SIN_DETALLE, 'NanoGPT')).toBe(
      `2 modelos. ${catalogReadLine({ fetchedAt: LEIDO, detail: 'basic' }, 'NanoGPT')}`,
    );
  });

  it('de un catalogo leido sin detalle enseña el aviso guardado: es donde queda el motivo', () => {
    // el respaldo salio bien, asi que el boton no tuvo ningun error que enseñar:
    // el codigo HTTP del intento con detalle solo esta en el aviso del catalogo
    const motivo =
      'NanoGPT no devolvió la lista de modelos con detalle (HTTP 429): este catálogo se leyó ' +
      'sin detalle y no trae los niveles de razonamiento que declara cada modelo.';
    const snapshot = SIN_DETALLE.snapshot;
    if (snapshot === null) throw new Error('falta el catalogo de la prueba');
    const conMotivo: StoredCatalog = { loading: false, snapshot: { ...snapshot, notice: motivo } };
    expect(storedCatalogLine(conMotivo, 'NanoGPT')).toBe(
      `2 modelos. Leído el ${CUANDO}. ${motivo}`,
    );
    // con detalle el aviso guardado no se repite aqui: solo habla de precios
    const detalle = CON_DETALLE.snapshot;
    if (detalle === null) throw new Error('falta el catalogo de la prueba');
    expect(
      storedCatalogLine(
        { loading: false, snapshot: { ...detalle, notice: 'Luxy no lee los precios de NanoGPT.' } },
        'NanoGPT',
      ),
    ).not.toContain('precios');
  });
});

describe('la etiqueta de razonamiento de un modelo en Modelos', () => {
  it('con niveles los enseña con los nombres de la pasarela, sin traducir', () => {
    expect(declaredReasoningTag(modelo(CON_DETALLE, FLASH), 'NanoGPT')).toBe(
      'razona: none · high · max',
    );
  });

  it('tres estados: dice que si, dice que no, o no dice nada', () => {
    expect(declaredReasoningTag(modelo(CON_DETALLE, THINKING), 'NanoGPT')).toBe(
      'razona, sin niveles declarados',
    );
    // el «no» lleva delante quien lo dice
    expect(declaredReasoningTag(modelo(CON_DETALLE, CYDONIA), 'NanoGPT')).toBe(
      'NanoGPT declara que no razona',
    );
    expect(declaredReasoningTag(modelo(CON_DETALLE, CYDONIA), null)).toBe(
      'la pasarela declara que no razona',
    );
    // ausente no pinta nada: un silencio no es un «no»
    expect(declaredReasoningTag(modelo(SIN_DETALLE, FLASH), 'NanoGPT')).toBeNull();
    expect(declaredReasoningTag({}, null)).toBeNull();
  });

  it('si la pasarela se contradice, enseña los niveles sin afirmar que razone', () => {
    expect(declaredReasoningTag({ reasoning: false, reasoningEfforts: ['low'] }, 'NanoGPT')).toBe(
      'niveles: low',
    );
  });
});

describe('de quien es el catalogo que se enseña en Modelos', () => {
  const config = storedAgentConfigSchema.parse({
    machineName: 'portatil',
    gatewayUrl: 'https://example.com',
    connections: [
      { id: 'pasarela', displayName: 'Pasarela', baseUrl: TABLA_URL },
      { id: 'nano', displayName: 'Nano por conexion', baseUrl: 'https://nano-gpt.com/api/v1' },
    ],
    providers: {
      http: [
        httpProviderConfigSchema.parse({
          id: 'nanogpt',
          displayName: 'NanoGPT de Daniel',
          baseUrl: NANO_URL,
          model: CYDONIA,
          apiKeyEnv: 'LUXY_HTTP_NANOGPT_API_KEY',
          enabled: true,
        }),
        httpProviderConfigSchema.parse({
          id: 'groq',
          displayName: 'Groq',
          baseUrl: 'https://api.groq.com/openai/v1',
          model: 'qwen/qwen3.8-27b',
          apiKeyEnv: 'LUXY_HTTP_GROQ_API_KEY',
          enabled: true,
        }),
      ],
    },
  });

  it('solo nombra a la pasarela cuyo host tiene dialecto de catalogo', () => {
    // el nombre sale del dialecto del HOST, no del que el usuario le puso
    expect(catalogGatewayLabel(config, { id: 'nanogpt', source: 'http' })).toBe('NanoGPT');
    expect(catalogGatewayLabel(config, { id: 'nano', source: 'connection' })).toBe('NanoGPT');
    expect(catalogGatewayLabel(config, { id: 'pasarela', source: 'connection' })).toBeNull();
    expect(catalogGatewayLabel(config, { id: 'groq', source: 'http' })).toBeNull();
    // se busca en la lista del ORIGEN: un identificador de la otra no cuenta
    expect(catalogGatewayLabel(config, { id: 'nanogpt', source: 'connection' })).toBeNull();
    expect(catalogGatewayLabel(config, { id: 'nano', source: 'http' })).toBeNull();
  });

  it('sin configuracion o sin origen no nombra a nadie', () => {
    expect(catalogGatewayLabel(null, { id: 'nanogpt', source: 'http' })).toBeNull();
    expect(catalogGatewayLabel(config, null)).toBeNull();
  });
});
