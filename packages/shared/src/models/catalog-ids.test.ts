// las ids del catalogo leido de una pasarela.
//
// POR QUE EXISTE: el 2026-09-15 la pantalla de Modelos de Luxy se quedo EN
// NEGRO. AI Horde sirve estos dos modelos, que son distintos y solo se
// diferencian en las mayusculas:
//
//   koboldcpp/llama-3.2-3b-instruct-q4_k_m
//   koboldcpp/Llama-3.2-3B-Instruct-Q4_K_M
//
// La id interna se derivaba del nombre ya pasado por `toLowerCase()`, asi que
// de 27 modelos salian 26 ids, `ModelRegistry` lanzaba `ModelRegistryError` y
// lo hacia DENTRO del render de `ModelsPage`: se llevo por delante el arbol de
// React entero y hubo que cerrar Luxy desde la bandeja.
//
// Se prueban las dos mitades del arreglo: que las ids no colisionen, y que
// NINGUN catalogo, por raro que sea, lance.
import { describe, it, expect } from 'vitest';
import {
  buildCatalogForConnection,
  buildCatalogReport,
  buildDefaultCatalog,
  mergeCatalogs,
} from './catalog.js';
import type { ServedModel } from './catalog.js';
import type { ModelDefinition } from './types.js';

/**
 * el catalogo REAL de AI Horde, guardado el 2026-09-15.
 *
 * Es el caso que rompio, con sus nombres exactos. Se guarda aqui y no se
 * descarga en la prueba: una prueba no toca la red. Para volver a leerlo:
 * `curl -H "Authorization: Bearer 0000000000" https://oai.aihorde.net/v1/models`
 * —esa clave es la anonima y publica del horde, no es un secreto—.
 */
const HORDE_MODELS: readonly string[] = [
  'koboldcpp/llama-3.2-3b-instruct-q4_k_m',
  'koboldcpp/Llama-3.2-3B',
  'koboldcpp/Angelic_Eclipse-12B',
  'aphrodite/TheDrummer/Cydonia-24B-v4.3',
  'koboldcpp/L3-8B-Stheno-v3.2-IQ3_S-imat',
  'koboldcpp/gemma-4-31B-it-heretic',
  'koboldcpp/L3-Super-Nova-RP-8B',
  'koboldcpp/mini-magnum-12b-v1.1',
  'koboldcpp/Qwen/Qwen3.5-0.8B',
  'koboldcpp/TheDrummer_Behemoth-128B-v3-Q4_K_M',
  'koboldcpp/L3-8B-Stheno-v3.2-Q8_0',
  'koboldcpp/Gemma-4-E4B-it-Ultra-Uncensored-Heretic',
  'koboldcpp/Gemma-4-E4B-Uncensored-HauhauCS-Aggressive-Q4_K_M',
  'aphrodite/SicariusSicariiStuff/Impish_Bloodmoon_12B',
  'koboldcpp/L3-8B-Stheno-v3.2-Q5_K_M',
  'koboldcpp/MN-Violet-Lotus-12B.Q8_0',
  'koboldcpp/Qwen_Qwen3-0.6B-IQ4_XS',
  'koboldcpp/debug-Froopert-31B-v1.1-Q4_K_M',
  'aphrodite/SicariusSicariiStuff/Impish_LLAMA_4B',
  'koboldcpp/Llama-3.2-1B-Instruct',
  'meta-llama/Llama-3.2-3B-Instruct',
  'aphrodite/TheDrummer/Behemoth-X-123B-v2.1',
  'koboldcpp/Rocinante-X-12B',
  'koboldcpp/Llama-3.2-3B-Instruct-Q4_K_M',
  'koboldcpp/Qwen3-4B-Nymphaea-RP.i1-Q4_K_S',
  'koboldcpp/ReadyArt/Forgotten-Safeword-22B',
  'koboldcpp/L3-8B-Stheno-v3.2',
];

/** los dos que chocaban, y que son modelos distintos de verdad */
const CHOCAN = [
  'koboldcpp/llama-3.2-3b-instruct-q4_k_m',
  'koboldcpp/Llama-3.2-3B-Instruct-Q4_K_M',
] as const;

/**
 * la derivacion EXACTA de antes del arreglo, copiada tal cual.
 *
 * Sirve para afirmar que un modelo que no choca conserva su id: hay catalogos
 * ya guardados en el disco de Daniel y un cambio masivo de ids los invalidaria
 * en silencio.
 */
function idAntesDelArreglo(apiModel: string): string {
  return apiModel
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-');
}

describe('ids del catalogo real de AI Horde', () => {
  const modelos = buildCatalogForConnection('horde', HORDE_MODELS);

  it('los 27 modelos servidos dan 27 ids distintas', () => {
    expect(modelos).toHaveLength(27);
    expect(new Set(modelos.map((modelo) => modelo.id)).size).toBe(27);
  });

  it('los dos que solo se diferencian en las mayusculas siguen siendo dos', () => {
    const dos = modelos.filter((modelo) => (CHOCAN as readonly string[]).includes(modelo.apiModel));
    expect(dos).toHaveLength(2);
    expect(dos[0]?.id).not.toBe(dos[1]?.id);
  });

  it('el apiModel de los que chocan queda intacto', () => {
    // es lo que se le manda a la pasarela: tocarlo pide un modelo que no existe
    expect(modelos.map((modelo) => modelo.apiModel)).toEqual(HORDE_MODELS);
  });

  it('un modelo que no choca conserva la id que tenia antes del arreglo', () => {
    const solitarios = modelos.filter(
      (modelo) => !(CHOCAN as readonly string[]).includes(modelo.apiModel),
    );
    expect(solitarios).toHaveLength(25);
    for (const modelo of solitarios) {
      expect(modelo.id).toBe(idAntesDelArreglo(modelo.apiModel));
    }
  });

  it('el mismo catalogo en otro orden da exactamente las mismas ids', () => {
    // la desambiguacion sale del NOMBRE, no de la posicion: si la pasarela
    // reordena su catalogo —y lo hace, el orden depende de sus workers— las
    // ids no pueden bailar
    const alReves = buildCatalogForConnection('horde', [...HORDE_MODELS].reverse());
    const porNombre = new Map(alReves.map((modelo) => [modelo.apiModel, modelo.id]));
    for (const modelo of modelos) {
      expect(porNombre.get(modelo.apiModel)).toBe(modelo.id);
    }
  });
});

describe('catalogos que antes tumbaban la pantalla', () => {
  it('tres nombres que chocan a la vez salen los tres', () => {
    // el dia que una pasarela sirva `foo`, `FOO` y `Foo`
    const modelos = buildCatalogForConnection('pasarela', ['foo', 'FOO', 'Foo']);
    expect(modelos).toHaveLength(3);
    expect(new Set(modelos.map((modelo) => modelo.id)).size).toBe(3);
    expect(modelos.map((modelo) => modelo.apiModel)).toEqual(['foo', 'FOO', 'Foo']);
  });

  it('un nombre vacio se omite y no lanza', () => {
    const { models, skipped } = buildCatalogReport('pasarela', ['', '   ', 'kimi-k3']);
    expect(models.map((modelo) => modelo.apiModel)).toEqual(['kimi-k3']);
    expect(skipped.map((fuera) => fuera.reason)).toEqual(['empty-name', 'empty-name']);
  });

  it('un nombre que se queda en nada al normalizar sigue teniendo id valida', () => {
    // «///» y un emoji no dejan ni una letra: antes salia `model-` mas la
    // POSICION en la lista, que era -1 para todos y volvia a chocar
    const modelos = buildCatalogForConnection('pasarela', ['///', '...', '🙂']);
    expect(modelos).toHaveLength(3);
    expect(new Set(modelos.map((modelo) => modelo.id)).size).toBe(3);
    for (const modelo of modelos) {
      expect(modelo.id).toMatch(/^[a-z0-9][a-z0-9._-]*$/);
    }
  });

  it('un nombre larguisimo no lanza: o cabe recortado o se omite', () => {
    const largo = 'z'.repeat(100);
    const imposible = 'z'.repeat(200);
    const { models, skipped } = buildCatalogReport('pasarela', [largo, imposible]);

    // 100 caracteres no caben en una id de 64, pero si en un apiModel de 128
    expect(models).toHaveLength(1);
    expect(models[0]?.apiModel).toBe(largo);
    expect(models[0]?.id.length).toBeLessThanOrEqual(64);
    expect(models[0]?.displayName.length).toBeLessThanOrEqual(64);
    // 200 no caben ni en el apiModel, y el apiModel NO se recorta
    expect(skipped).toEqual([{ apiModel: imposible, reason: 'name-too-long' }]);
  });

  it('el mismo nombre dos veces deja un modelo, no dos ids iguales', () => {
    const { models, skipped } = buildCatalogReport('pasarela', ['kimi-k3', 'kimi-k3']);
    expect(models).toHaveLength(1);
    expect(skipped).toEqual([{ apiModel: 'kimi-k3', reason: 'duplicate-name' }]);
  });

  it('cual de dos que chocan sobrevive NO depende del orden de llegada', () => {
    // el catalogo de AI Horde son los workers vivos en ese instante y el orden
    // lo pone la pasarela. Con «gana el primero» la id `...-ce554cd4` quedaba
    // ligada a un apiModel distinto segun como devolviera la lista: no es que
    // faltase un modelo, es que el que habia detras de esa id cambiaba solo
    const gemelo = 'koboldcpp/llama-3.2-3b-instruct-q4_k_m';
    const derivada = buildCatalogForConnection('horde', [gemelo, CHOCAN[1]]).find(
      (modelo) => modelo.apiModel === gemelo,
    );
    const impostor = derivada?.id ?? '';
    expect(impostor).toMatch(/-[0-9a-f]{8}$/);

    const unOrden = buildCatalogReport('horde', [gemelo, CHOCAN[1], impostor]);
    const otroOrden = buildCatalogReport('horde', [impostor, gemelo, CHOCAN[1]]);

    const dueño = (report: { models: ModelDefinition[] }): string | undefined =>
      report.models.find((modelo) => modelo.id === impostor)?.apiModel;
    expect(dueño(unOrden)).toBe(dueño(otroOrden));
    expect(unOrden.skipped).toEqual(otroOrden.skipped);
    expect(unOrden.skipped.map((fuera) => fuera.reason)).toEqual(['duplicate-id']);
  });

  it('una id derivada no le quita la suya a un modelo del catalogo de fabrica', () => {
    // `DeepSeek-V4-Pro` lleva la id escrita a mano y los alias de telegram; si
    // se la robara el nombre en minusculas, /deepseek dejaria de resolver
    const modelos = buildCatalogForConnection('hcnsec', ['DeepSeek-V4-Pro', 'deepseek-v4-pro']);
    expect(modelos).toHaveLength(2);
    const [conocido, derivado] = modelos;
    expect(conocido?.id).toBe('deepseek-v4-pro');
    expect(conocido?.telegramAliases).toContain('deepseek');
    expect(derivado?.id).not.toBe('deepseek-v4-pro');
    expect(derivado?.apiModel).toBe('deepseek-v4-pro');
  });
});

/**
 * la lista de servidos llega de un JSON del disco o de `/v1/models`, y en
 * runtime no la comprueba nadie: el tipo `ServedModel[]` describe lo que
 * DEBERIA venir. La primera pasada tocaba ese dato crudo fuera del try, y esta
 * funcion corre en la raiz del arbol de React: con cualquiera de estas formas
 * la ventana se quedaba en negro desde el arranque, sin decir que archivo era.
 */
describe('un catalogo con la forma equivocada no lanza', () => {
  const bueno = 'kimi-k3';
  const hostiles: [string, unknown][] = [
    ['una entrada null', [null, bueno]],
    ['una entrada numerica', [42, bueno]],
    ['una fila sin apiModel', [{ id: 'foo' }, bueno]],
    ['un apiModel que no es cadena', [{ apiModel: 123 }, bueno]],
    ['capacidades con un numero dentro', [{ apiModel: bueno, declaredCapabilities: [1] }]],
    ['capacidades que no son lista', [{ apiModel: bueno, declaredCapabilities: 7 }]],
  ];

  for (const [nombre, servidos] of hostiles) {
    it(`sobrevive a ${nombre}`, () => {
      const { models, skipped } = buildCatalogReport(
        'pasarela',
        servidos as readonly ServedModel[],
      );
      // el modelo bueno sigue saliendo: se pierde la entrada rara, no la lista
      expect(models.map((modelo) => modelo.apiModel)).toContain(bueno);
      expect(models.length + skipped.length).toBe((servidos as unknown[]).length);
    });
  }

  it('una lista que no es una lista devuelve un catalogo vacio', () => {
    // esto lanzaba «servedModels is not iterable» ANTES de entrar al bucle, o
    // sea fuera del alcance de cualquier try de dentro
    for (const raro of [undefined, null, {}, 'kimi-k3', 7]) {
      expect(buildCatalogReport('pasarela', raro as readonly ServedModel[])).toEqual({
        models: [],
        skipped: [],
      });
    }
  });

  it('una entrada sin nombre se cuenta con su propio motivo', () => {
    const { skipped } = buildCatalogReport('pasarela', [null, ''] as readonly ServedModel[]);
    expect(skipped).toEqual([
      { apiModel: '', reason: 'invalid-entry' },
      { apiModel: '', reason: 'empty-name' },
    ]);
  });
});

describe('el contrato de estabilidad de una id derivada', () => {
  it('la id de un modelo se mueve el dia que aparece un hermano con su slug', () => {
    // NO es un fallo: es la simetria de `libre` —de un grupo que choca no se
    // queda con el slug desnudo ninguno—, y la alternativa asimetrica tiene el
    // mismo problema al reves. Se prueba para que quede ESCRITO: una id
    // derivada depende del conjunto servido en esa lectura, asi que no se
    // persiste. En AI Horde el catalogo son los workers vivos, de modo que
    // basta con que se desconecte el gemelo
    const solo = buildCatalogForConnection('pasarela', ['MyModel']);
    expect(solo[0]?.id).toBe('mymodel');

    const conHermano = buildCatalogForConnection('pasarela', ['MyModel', 'mymodel']);
    const mismo = conHermano.find((modelo) => modelo.apiModel === 'MyModel');
    expect(mismo?.id).not.toBe('mymodel');
    expect(mismo?.id).toMatch(/^mymodel-[0-9a-f]{8}$/);
  });
});

describe('varios origenes sirviendo el MISMO catalogo', () => {
  // las cuatro conexiones de Daniel a AI Horde apuntan a la misma pasarela, asi
  // que `/v1/models` les devuelve los mismos 27 nombres y las cuatro derivan
  // las mismas 27 ids
  const HORDES = ['horde-cydonia', 'horde-behemoth', 'horde-safeword', 'horde-stheno'];
  const junto = mergeCatalogs(
    HORDES.flatMap((origen) => buildCatalogForConnection(origen, HORDE_MODELS)),
  );

  it('ningun origen pierde sus modelos', () => {
    // antes se deduplicaba por id y ganaba el primero: tres de las cuatro
    // conexiones se quedaban con CERO modelos y el desplegable vacio
    for (const origen of HORDES) {
      expect(junto.filter((modelo) => modelo.connectionId === origen)).toHaveLength(27);
    }
    expect(junto).toHaveLength(108);
  });

  it('las ids siguen siendo unicas, que es lo que lanzaba', () => {
    expect(new Set(junto.map((modelo) => modelo.id)).size).toBe(108);
  });

  it('el PRIMER origen conserva exactamente las ids que tenia solo', () => {
    // hay catalogos guardados en disco y selecciones en pantalla: añadir una
    // segunda conexion no puede mover las ids de la primera
    const solo = buildCatalogForConnection('horde-cydonia', HORDE_MODELS);
    const despues = new Map(
      junto
        .filter((modelo) => modelo.connectionId === 'horde-cydonia')
        .map((modelo) => [modelo.apiModel, modelo.id]),
    );
    for (const modelo of solo) {
      expect(despues.get(modelo.apiModel)).toBe(modelo.id);
    }
  });

  it('el catalogo de fabrica de la primera conexion mantiene sus ids y sus alias', () => {
    // esas ids llevan los alias de telegram: moverlas rompe /deepseek
    const dos = mergeCatalogs([...buildDefaultCatalog('hcnsec'), ...buildDefaultCatalog('otra')]);
    const deepseek = dos.find((modelo) => modelo.connectionId === 'hcnsec' && modelo.agentic);
    expect(dos.filter((modelo) => modelo.connectionId === 'hcnsec')).toHaveLength(
      buildDefaultCatalog('hcnsec').length,
    );
    expect(deepseek?.id).toBe(
      buildDefaultCatalog('hcnsec').find((modelo) => modelo.agentic)?.id,
    );
    expect(new Set(dos.map((modelo) => modelo.id)).size).toBe(dos.length);
  });

  it('el mismo origen repetido no inventa modelos', () => {
    const repetido = mergeCatalogs([
      ...buildCatalogForConnection('horde-cydonia', HORDE_MODELS),
      ...buildCatalogForConnection('horde-cydonia', HORDE_MODELS),
    ]);
    expect(repetido).toHaveLength(27);
  });

  it('no lanza con una lista que no es una lista', () => {
    expect(mergeCatalogs(undefined as unknown as ModelDefinition[])).toEqual([]);
  });
});
