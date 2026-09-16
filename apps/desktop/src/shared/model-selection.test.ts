// pruebas de que modelo se manda con cada proveedor.
//
// Existe por un fallo que costo cinco llamadas: el proveedor cambiado a Claude y
// el modelo aun en `DeepSeek-V4-Pro`, que para Claude no existe. La regla estaba
// escrita en la pantalla y no la comprobaba nadie.
import { describe, it, expect } from 'vitest';
import {
  NATIVE_MODEL_SUGGESTIONS,
  effortsFor,
  executionChoices,
  missingProviderReason,
  modelForProvider,
  modelsForProvider,
  providerForModel,
  type SelectableModel,
} from './model-selection.js';

/**
 * azucar: casi todo el catalogo son modelos de texto normales.
 *
 * `origin` es obligatorio y no tiene valor comodo por defecto a proposito: es
 * lo que distingue una conexion agregadora de una entrada de `providers.http`,
 * y confundirlas es exactamente el fallo que se esta probando.
 */
const texto = (
  apiModel: string,
  family: string,
  connectionId: string,
  origin: 'connection' | 'http' = 'connection',
  enabled = true,
): SelectableModel => ({ apiModel, family, connectionId, origin, enabled, category: 'text' });

/**
 * la lista REAL que el agente dio de alta en la maquina de Daniel el
 * 2026-09-15, sacada de su registro.
 *
 * Es la unica fuente que decide quien ejecuta: `providers.http` entra con su
 * identificador y una `connection` entra por familia, asi que `hcnsec` NO
 * aparece aunque sea la conexion mas usada.
 */
const EN_MARCHA = [
  'claude',
  'codex',
  'mistral',
  'groq',
  'horde-cydonia',
  'horde-behemoth',
  'horde-safeword',
  'horde-stheno',
  'ovh-nemo',
  'deepseek',
  'glm',
  'kat',
  'kimi',
  'minimax',
  'qwen',
  'step',
];

const CATALOGO: SelectableModel[] = [
  texto('DeepSeek-V4-Pro', 'deepseek', 'hcnsec'),
  texto('DeepSeek-V4-Flash', 'deepseek', 'hcnsec'),
  texto('opus', 'claude', 'claude'),
  texto('retirado', 'deepseek', 'hcnsec', 'connection', false),
  // un proveedor HTTP: sus modelos NO forman una familia nuestra, y por eso
  // se emparejan por conexion. Groq sirve qwen y otros bajo el nombre «groq»
  texto('qwen/qwen3.6-27b', 'qwen', 'groq', 'http'),
  // los seis de Groq que NO son de chat, y que llegaban al desplegable como
  // candidatos para describir una foto
  {
    apiModel: 'whisper-large-v3',
    family: 'other',
    connectionId: 'groq',
    origin: 'http',
    enabled: true,
    category: 'audio',
  },
  {
    apiModel: 'canopylabs/orpheus-v1-english',
    family: 'other',
    connectionId: 'groq',
    origin: 'http',
    enabled: true,
    category: 'audio',
  },
  // un clasificador: su categoria SI es texto, y aun asi no se puede hablar con el
  texto('meta-llama/llama-prompt-guard-2-86m', 'other', 'groq', 'http'),
];

describe('el modelo que viaja con el proveedor', () => {
  it('vale si pertenece a esa familia', () => {
    expect(modelForProvider(CATALOGO, 'deepseek', 'DeepSeek-V4-Pro')).toBe('DeepSeek-V4-Pro');
  });

  it('NO vale si es de otra familia', () => {
    // el fallo exacto: cinco llamadas gastadas con `unrecognized_model`
    expect(modelForProvider(CATALOGO, 'claude', 'DeepSeek-V4-Pro')).toBeNull();
  });

  it('sin elegir ninguno decide la conexion', () => {
    expect(modelForProvider(CATALOGO, 'deepseek', null)).toBeNull();
    expect(modelForProvider(CATALOGO, 'deepseek', '')).toBeNull();
  });

  it('un modelo desactivado no se manda', () => {
    expect(modelForProvider(CATALOGO, 'deepseek', 'retirado')).toBeNull();
  });

  it('uno que no esta en el catalogo tampoco', () => {
    // el catalogo se lee de la conexion: si el modelo desaparecio, mandarlo
    // gasta la llamada para nada
    expect(modelForProvider(CATALOGO, 'deepseek', 'un-modelo-que-ya-no-existe')).toBeNull();
  });

  it('sin catalogo para esa familia se acepta lo que se escriba', () => {
    // Claude y Codex son CLI locales y no salen en `/v1/models`: si aqui se
    // bloqueara, no se podria elegir modelo con ellos, que es justo lo que
    // pasaba. La proteccion contra la familia equivocada es soltar el modelo al
    // cambiar de proveedor, no esta comprobacion
    expect(modelForProvider(CATALOGO, 'claude-cli', 'sonnet')).toBe('sonnet');
    expect(modelsForProvider(CATALOGO, 'claude-cli')).toEqual([]);
  });

  it('las sugerencias nativas no se inventan donde no se han comprobado', () => {
    // `CLAUDE.md` prohibe inventarse los valores de un CLI sin mirar su --help
    expect(NATIVE_MODEL_SUGGESTIONS['claude']).toContain('sonnet');
    // sale del propio `claude --help`, que nombra 'fable', 'opus' y 'sonnet'
    expect(NATIVE_MODEL_SUGGESTIONS['claude']).toContain('fable');
    // Codex estuvo sin lista un rato, y no por descuido: `codex exec --help`
    // declara `--model <MODEL>` sin enumerar un solo valor. La lista aparecio
    // cuando se encontro una fuente de verdad —el catalogo vivo de la propia
    // instalacion— y no antes.
    //
    // Lo que NO vale como fuente es `codex debug models`: devuelve un catalogo
    // empaquetado en el binario que se dejaba fuera `gpt-6-astra`, el modelo
    // nuevo. Esta prueba lo fija justo por eso: si alguien cambia la lista por
    // la de ese comando, el modelo nuevo desaparece y esto lo caza.
    expect(NATIVE_MODEL_SUGGESTIONS['codex']).toContain('gpt-6-astra');
  });
});

describe('los modelos que se ofrecen', () => {
  it('solo los de esa familia y solo los activos', () => {
    expect(modelsForProvider(CATALOGO, 'deepseek').map((each) => each.apiModel)).toEqual([
      'DeepSeek-V4-Pro',
      'DeepSeek-V4-Flash',
    ]);
    expect(modelsForProvider(CATALOGO, 'claude').map((each) => each.apiModel)).toEqual(['opus']);
  });
});

describe('un proveedor HTTP cuyos modelos no son una familia nuestra', () => {
  // PASO DE VERDAD con Groq: `MODEL_FAMILIES` es una lista cerrada y «groq»
  // no esta, asi que sus modelos se catalogan como `qwen` y `other`. Pidiendo
  // solo por familia, el selector de Privado quedaba VACIO para siempre y
  // actualizar el catalogo no lo arreglaba: el problema no era la frescura.
  it('sus modelos salen al elegir ese proveedor', () => {
    // whisper y el clasificador SI son suyos y ya no salen: son de esta
    // conexion, pero no se puede hablar con ellos. Ver el bloque de abajo
    const suyos = modelsForProvider(CATALOGO, 'groq').map((m) => m.apiModel);
    expect(suyos).toEqual(['qwen/qwen3.6-27b']);
  });

  it('no se cuelan en otro proveedor por su familia adivinada', () => {
    // `qwen/qwen3.6-27b` tiene familia `qwen`, pero lo sirve Groq: elegir el
    // proveedor `qwen` de la pasarela no puede ofrecer un modelo de Groq.
    //
    // Esta prueba existia con la asercion CONTRARIA a su propio titulo —decia
    // «no se cuelan» y comprobaba `toContain`—, o sea que fijaba el fallo en
    // verde y convencia al siguiente lector de que el caso estaba cubierto.
    //
    // Hace falta la lista de lo que hay EN MARCHA: sin ella la pregunta que se
    // puede hacer es «¿podria?», y por la via de la familia la respuesta es que
    // si. Con ella se pregunta quien lo ejecuta, que es lo que decide adonde
    // viaja la llamada
    const deQwen = modelsForProvider(CATALOGO, 'qwen', EN_MARCHA).map((m) => m.apiModel);
    expect(deQwen).not.toContain('qwen/qwen3.6-27b');
    expect(modelsForProvider(CATALOGO, 'groq', EN_MARCHA).map((m) => m.apiModel)).toContain(
      'qwen/qwen3.6-27b',
    );
  });

  it('un modelo con ejecutor mas exacto tampoco viaja al selector de su familia', () => {
    // el mismo fallo leido al reves, y el que de verdad cuesta dinero: elegirlo
    // en el selector de `mistral` lo manda a la pasarela de Mistral, que no lo
    // sirve. `modelForProvider` validaba contra esta misma lista, asi que no
    // paraba nada
    const nemo = texto('Mistral-Nemo-Instruct-2407', 'mistral', 'ovh-nemo', 'http');
    const catalogo = [...CATALOGO, nemo, texto('mistral-large-2411', 'mistral', 'mistral', 'http')];
    expect(modelsForProvider(catalogo, 'mistral', EN_MARCHA).map((m) => m.apiModel)).toEqual([
      'mistral-large-2411',
    ]);
    expect(modelForProvider(catalogo, 'mistral', 'Mistral-Nemo-Instruct-2407', EN_MARCHA)).toBeNull();
    // y sigue estando donde le toca
    expect(modelsForProvider(catalogo, 'ovh-nemo', EN_MARCHA).map((m) => m.apiModel)).toEqual([
      'Mistral-Nemo-Instruct-2407',
    ]);
  });

  it('con el agente parado no se vacia el selector de la agregadora', () => {
    // sin lista de proveedores no se puede saber quien ejecuta, y filtrar ahi
    // dejaria todos los desplegables en blanco sin explicar nada: se vuelve a
    // la pregunta floja, que es el comportamiento de siempre.
    //
    // El modelo de Groq NO vuelve a colarse en `qwen` ni asi, y eso es del
    // `origin`: una entrada de `providers.http` se registra con su
    // identificador y con ninguno mas, lo sepamos o no
    expect(modelsForProvider(CATALOGO, 'deepseek').map((m) => m.apiModel)).toEqual([
      'DeepSeek-V4-Pro',
      'DeepSeek-V4-Flash',
    ]);
    expect(modelsForProvider(CATALOGO, 'qwen').map((m) => m.apiModel)).toEqual([]);
  });

  it('la familia sigue funcionando para la pasarela agregadora', () => {
    // una conexion sirve muchas familias por el mismo endpoint, y el agente
    // registra un proveedor por familia: ese camino no puede romperse
    const deep = modelsForProvider(CATALOGO, 'deepseek').map((m) => m.apiModel);
    expect(deep).toEqual(['DeepSeek-V4-Pro', 'DeepSeek-V4-Flash']);
  });

  it('cada conexion ofrece los suyos aunque las dos sirvan el mismo nombre', () => {
    // las cuatro altas de AI Horde apuntan a la MISMA pasarela y sirven los
    // mismos nombres. El catalogo junto conserva una ficha por origen para que
    // esto funcione: antes se quedaba con la primera y el resto de conexiones
    // tenia el desplegable vacio
    const dosHordes: SelectableModel[] = [
      texto('koboldcpp/Cydonia-24B', 'other', 'horde-cydonia', 'http'),
      texto('koboldcpp/Cydonia-24B', 'other', 'horde-behemoth', 'http'),
    ];
    expect(modelsForProvider(dosHordes, 'horde-cydonia', EN_MARCHA).map((m) => m.apiModel)).toEqual(
      ['koboldcpp/Cydonia-24B'],
    );
    expect(modelsForProvider(dosHordes, 'horde-behemoth', EN_MARCHA).map((m) => m.apiModel)).toEqual(
      ['koboldcpp/Cydonia-24B'],
    );
  });

  it('por FAMILIA no se repite un nombre servido por dos origenes', () => {
    // el valor de cada opcion del desplegable es el `apiModel`: repetido, la
    // eleccion deja de decir cual se eligio
    const dosOrigenes: SelectableModel[] = [
      texto('Kimi-K3', 'kimi', 'hcnsec'),
      texto('Kimi-K3', 'kimi', 'otra-pasarela'),
    ];
    expect(modelsForProvider(dosOrigenes, 'kimi').map((m) => m.apiModel)).toEqual(['Kimi-K3']);
  });

  it('lo desactivado no se ofrece por ninguna de las dos vias', () => {
    expect(modelsForProvider(CATALOGO, 'hcnsec').map((m) => m.apiModel)).not.toContain(
      'retirado',
    );
  });
});

// PASO DE VERDAD: de los 14 modelos que sirve la conexion de Groq, SEIS no son
// de chat —whisper x2, orpheus x2 y tres clasificadores— y todos se ofrecian en
// el desplegable del banco de vision. Elegir uno gasta una llamada que no puede
// funcionar, y ninguno declara `image_input`, asi que la etiqueta «ve imagenes»
// no aparecia en ninguno: no habia forma de saber cual probar.
describe('el selector solo ofrece modelos con los que se puede hablar', () => {
  const deGroq = modelsForProvider(CATALOGO, 'groq').map((model) => model.apiModel);

  it('deja pasar el de chat', () => {
    expect(deGroq).toContain('qwen/qwen3.6-27b');
  });

  it('quita los de voz, aunque esten habilitados', () => {
    expect(deGroq).not.toContain('whisper-large-v3');
    // el vendor delante era la trampa: `startsWith('orpheus')` no lo captura
    expect(deGroq).not.toContain('canopylabs/orpheus-v1-english');
  });

  it('quita los clasificadores, que SI son de categoria texto', () => {
    // entra texto y sale una etiqueta: decir que su categoria es otra cosa
    // seria mentir, asi que la pregunta «se puede hablar con el» se responde
    // aparte y no forzando el enum de categorias
    expect(deGroq).not.toContain('meta-llama/llama-prompt-guard-2-86m');
  });

  it('un modelo de voz elegido antes deja de valer y se suelta', () => {
    // `null` significa «usa el de la conexion», que es mejor que mandar un
    // whisper y pagar el error
    expect(modelForProvider(CATALOGO, 'groq', 'whisper-large-v3')).toBeNull();
  });
});

describe('esfuerzos que se pueden ofrecer', () => {
  // el detalle que cuesta dinero: mandarle un esfuerzo que el modelo no acepta
  // no lo recorta, falla, y la llamada se paga igual
  it('ofrece ultra solo en los modelos que lo aceptan', () => {
    expect(effortsFor('codex', 'gpt-6-astra')).toContain('ultra');
    expect(effortsFor('codex', 'gpt-5.6-sol')).toContain('ultra');
    expect(effortsFor('codex', 'gpt-5.6-luna')).not.toContain('ultra');
    expect(effortsFor('codex', 'gpt-5.5')).not.toContain('ultra');
  });

  it('y max solo hasta donde llega', () => {
    expect(effortsFor('codex', 'gpt-5.6-luna')).toContain('max');
    expect(effortsFor('codex', 'gpt-5.5')).not.toContain('max');
    expect(effortsFor('codex', 'gpt-5.3-codex-spark')).not.toContain('max');
  });

  it('con un modelo desconocido se queda corto, que es el error barato', () => {
    // equivocarse hacia arriba cuesta una llamada fallida; hacia abajo solo
    // deja una opcion sin ofrecer
    const desconocido = effortsFor('codex', 'gpt-7-lo-que-sea');
    expect(desconocido).toEqual(['low', 'medium', 'high', 'xhigh']);
    expect(effortsFor('codex', null)).toEqual(desconocido);
  });

  it('Claude no varia por modelo: el nivel es de la sesion', () => {
    expect(effortsFor('claude', 'opus')).toEqual(effortsFor('claude', 'haiku'));
    // los cinco de su --help, ni uno mas: ultra no existe en Claude
    expect(effortsFor('claude', 'opus')).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
  });

  it('una conexion HTTP no entiende de esfuerzos, y no se le ofrece ninguno', () => {
    // el contrato chat completions no tiene donde ponerlo: un selector ahi
    // seria un mando que no mueve nada
    expect(effortsFor('groq', 'llama-3.3-70b')).toEqual([]);
    expect(effortsFor('deepseek', null)).toEqual([]);
  });
});

describe('quien ejecuta un modelo', () => {
  it('un proveedor HTTP se resuelve por su conexion, aunque no tenga familia', () => {
    // EL FALLO DEL 2026-09-15, exacto: esto mandaba `family`, el modelo de AI
    // Horde sale con familia `other` —de verdad no es de ninguna familia
    // conocida— y la sonda pedia ejecutar contra un proveedor «other», que no
    // existe. Un turno gastado para leerlo.
    const cydonia = texto('aphrodite/TheDrummer/Cydonia-24B-v4.3', 'other', 'horde-cydonia');
    expect(providerForModel(cydonia, EN_MARCHA)).toBe('horde-cydonia');
    expect(missingProviderReason(cydonia, EN_MARCHA)).toBeNull();
  });

  it('una conexion agregadora se resuelve por familia, porque asi se registra', () => {
    // `hcnsec` no es un proveedor y no lo sera nunca: el agente recorre sus
    // familias y da de alta `deepseek`, `glm`, `kimi`, `qwen`...
    expect(providerForModel(texto('DeepSeek-V4-Pro', 'deepseek', 'hcnsec'), EN_MARCHA)).toBe(
      'deepseek',
    );
    expect(providerForModel(texto('Kimi-K3', 'kimi', 'hcnsec'), EN_MARCHA)).toBe('kimi');
  });

  it('lo que ya funcionaba sigue igual', () => {
    // Mistral funcionaba por casualidad —familia e identificador coinciden— y
    // esa casualidad no puede dejar de funcionar
    expect(providerForModel(texto('mistral-large-2411', 'mistral', 'mistral'), EN_MARCHA)).toBe(
      'mistral',
    );
    expect(providerForModel(texto('opus', 'claude', 'claude'), EN_MARCHA)).toBe('claude');
  });

  it('la conexion gana a la familia, y ahi esta la llamada que se salva', () => {
    // `ovh-nemo` sirve un modelo cuya familia adivinada es `mistral`, que en
    // esta maquina es OTRA pasarela con otra clave. Por familia se mandaria a un
    // endpoint que no lo tiene y la llamada se paga igual
    const nemo = texto('Mistral-Nemo-Instruct-2407', 'mistral', 'ovh-nemo', 'http');
    expect(providerForModel(nemo, EN_MARCHA)).toBe('ovh-nemo');
  });

  it('un proveedor HTTP apagado NO cae a su familia adivinada', () => {
    // el caso que faltaba: Daniel desactiva `ovh-nemo` en Conexiones y su
    // catalogo cacheado sigue en la lista. Con la familia como segundo
    // candidato, `Mistral-Nemo-Instruct-2407` resolvia a `mistral` —otra
    // pasarela—, no salia ningun aviso, la casilla quedaba habilitada y la
    // sonda ejecutaba contra un endpoint que no sirve ese nombre.
    //
    // La familia de un `providers.http` es una adivinanza sacada del nombre, no
    // una via de registro: `initializeProviders` le da de alta SU identificador
    // y ninguno mas
    const apagados = EN_MARCHA.filter((id) => id !== 'ovh-nemo' && id !== 'groq');
    const nemo = texto('Mistral-Nemo-Instruct-2407', 'mistral', 'ovh-nemo', 'http');
    expect(providerForModel(nemo, apagados)).toBeNull();
    // y el motivo nombra la conexion a secas, porque su familia no pinta nada
    const motivo = missingProviderReason(nemo, apagados);
    expect(motivo).toContain('ovh-nemo');
    expect(motivo).not.toContain('mistral');

    // lo mismo con Groq parado: sus modelos no se van a la agregadora
    expect(providerForModel(texto('qwen/qwen3.6-27b', 'qwen', 'groq', 'http'), apagados)).toBeNull();
  });

  it('el aviso dice DE QUE maquina habla', () => {
    // en Privado los proveedores salen del agente de este ordenador; en el
    // Laboratorio hay un desplegable de maquinas, y decirle «esta maquina» a
    // alguien que ha elegido el portatil le manda a mirar el agente equivocado
    const huerfano = texto('SenseNova-V7', 'sensenova', 'hcnsec');
    expect(missingProviderReason(huerfano, EN_MARCHA, 'local')).toContain('Esta máquina');
    expect(missingProviderReason(huerfano, EN_MARCHA, 'local')).toContain('aquí.');
    const seleccionada = missingProviderReason(huerfano, EN_MARCHA, 'selected');
    expect(seleccionada).toContain('La máquina seleccionada');
    expect(seleccionada).toContain('ahí.');
  });

  it('el aviso agrupado habla en plural, porque va encima de veintisiete fichas', () => {
    // se escribio sin nombrar el modelo para poder juntar los de un origen, y
    // se cerraba en «ese modelo», un demostrativo singular que encima de la
    // lista no señalaba a nada
    const grupo = missingProviderReason(texto('a', 'other', 'horde-apagada'), EN_MARCHA, 'group');
    expect(grupo).toContain('sus modelos no se pueden ejecutar aquí');
    expect(grupo).not.toContain('ese modelo');
  });

  it('sin proveedor no resuelve nada, y lo dice antes de ejecutar', () => {
    // ni su conexion es un `providers.http` registrado ni su familia esta en
    // `PROVIDER_IDS`: no hay quien lo ejecute, y eso se sabe al marcar la
    // casilla y no despues de esperar al turno
    const huerfano = texto('SenseNova-V7', 'sensenova', 'pasarela-apagada');
    expect(providerForModel(huerfano, EN_MARCHA)).toBeNull();
    const motivo = missingProviderReason(huerfano, EN_MARCHA);
    expect(motivo).toContain('pasarela-apagada');
    expect(motivo).toContain('sensenova');
  });

  it('una conexion con clave pero apagada tampoco resuelve', () => {
    // `registered` son los que el agente ANUNCIA, no los de `config.json`: una
    // conexion sin clave guardada no registra ni una familia
    expect(providerForModel(texto('GLM-5', 'glm', 'hcnsec'), [])).toBeNull();
  });

  it('el motivo no nombra el modelo, para poder juntar los de un mismo origen', () => {
    // los 27 modelos de una conexion de Horde dan la MISMA frase: asi el aviso
    // es uno y no veintisiete
    const uno = missingProviderReason(texto('a', 'other', 'horde-apagada'), EN_MARCHA);
    const otro = missingProviderReason(texto('b', 'other', 'horde-apagada'), EN_MARCHA);
    expect(uno).toBe(otro);
  });
});

// PASO DE VERDAD: el Laboratorio se quedaba con la primera ficha de cada
// `apiModel` y tiraba el resto, con un comentario que decia «aqui el origen da
// igual, porque la prueba se ejecuta por FAMILIA». Con la regla nueva el origen
// ES el ejecutor, asi que eso elegia en silencio cual de las cuatro conexiones
// de Daniel a AI Horde pagaba la prueba —cada una con su clave y sus topes— y,
// si la primera estaba sin clave, declaraba inejecutable un modelo que las
// otras tres servian.
describe('una opcion por ejecucion, no por nombre', () => {
  const HORDES = ['horde-safeword', 'horde-cydonia', 'horde-behemoth', 'horde-stheno'];
  const cuatroCopias = HORDES.map((id) =>
    texto('aphrodite/TheDrummer/Cydonia-24B-v4.3', 'other', id, 'http'),
  );

  it('las cuatro conexiones al mismo Horde siguen siendo elegibles', () => {
    const opciones = executionChoices(cuatroCopias, EN_MARCHA);
    expect(opciones.map((m) => m.connectionId)).toEqual(HORDES);
  });

  it('la que no se puede ejecutar desaparece si otra del mismo nombre si', () => {
    // el bloqueo indebido: con `horde-safeword` sin clave y las otras tres en
    // marcha, quedarse con la primera ficha dejaba el modelo entero bloqueado
    const sinSafeword = EN_MARCHA.filter((id) => id !== 'horde-safeword');
    const opciones = executionChoices(cuatroCopias, sinSafeword);
    expect(opciones.map((m) => m.connectionId)).toEqual([
      'horde-cydonia',
      'horde-behemoth',
      'horde-stheno',
    ]);
  });

  it('si ninguna se puede ejecutar queda una, para que el bloqueo explique algo', () => {
    const opciones = executionChoices(cuatroCopias, ['claude']);
    expect(opciones).toHaveLength(1);
    expect(missingProviderReason(opciones[0]!, ['claude'])).toContain('horde-safeword');
  });

  it('no junta dos modelos distintos ni parte uno solo', () => {
    const catalogo = [
      texto('DeepSeek-V4-Pro', 'deepseek', 'hcnsec'),
      texto('Kimi-K3', 'kimi', 'hcnsec'),
    ];
    expect(executionChoices(catalogo, EN_MARCHA)).toHaveLength(2);
  });
});
