// pruebas de que modelo se manda con cada proveedor.
//
// Existe por un fallo que costo cinco llamadas: el proveedor cambiado a Claude y
// el modelo aun en `DeepSeek-V4-Pro`, que para Claude no existe. La regla estaba
// escrita en la pantalla y no la comprobaba nadie.
import { describe, it, expect } from 'vitest';
import {
  NATIVE_MODEL_SUGGESTIONS,
  effortsFor,
  modelForProvider,
  modelsForProvider,
  type SelectableModel,
} from './model-selection.js';

/** azucar: casi todo el catalogo son modelos de texto normales */
const texto = (
  apiModel: string,
  family: string,
  connectionId: string,
  enabled = true,
): SelectableModel => ({ apiModel, family, connectionId, enabled, category: 'text' });

const CATALOGO: SelectableModel[] = [
  texto('DeepSeek-V4-Pro', 'deepseek', 'hcnsec'),
  texto('DeepSeek-V4-Flash', 'deepseek', 'hcnsec'),
  texto('opus', 'claude', 'claude'),
  texto('retirado', 'deepseek', 'hcnsec', false),
  // un proveedor HTTP: sus modelos NO forman una familia nuestra, y por eso
  // se emparejan por conexion. Groq sirve qwen y otros bajo el nombre «groq»
  texto('qwen/qwen3.6-27b', 'qwen', 'groq'),
  // los seis de Groq que NO son de chat, y que llegaban al desplegable como
  // candidatos para describir una foto
  { apiModel: 'whisper-large-v3', family: 'other', connectionId: 'groq', enabled: true, category: 'audio' },
  {
    apiModel: 'canopylabs/orpheus-v1-english',
    family: 'other',
    connectionId: 'groq',
    enabled: true,
    category: 'audio',
  },
  // un clasificador: su categoria SI es texto, y aun asi no se puede hablar con el
  texto('meta-llama/llama-prompt-guard-2-86m', 'other', 'groq'),
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
    // proveedor `qwen` de la pasarela no puede ofrecer un modelo de Groq
    const deQwen = modelsForProvider(CATALOGO, 'qwen').map((m) => m.apiModel);
    expect(deQwen).toContain('qwen/qwen3.6-27b');
  });

  it('la familia sigue funcionando para la pasarela agregadora', () => {
    // una conexion sirve muchas familias por el mismo endpoint, y el agente
    // registra un proveedor por familia: ese camino no puede romperse
    const deep = modelsForProvider(CATALOGO, 'deepseek').map((m) => m.apiModel);
    expect(deep).toEqual(['DeepSeek-V4-Pro', 'DeepSeek-V4-Flash']);
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
