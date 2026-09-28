// pruebas de las notas de direccion contra la autocopia y la pasividad (`D-102`).
//
// La primera manda: con el ajuste APAGADO el prompt no cambia ni un byte. Se
// compara contra un VALOR LITERAL capturado de la implementacion anterior al
// cambio, y no contra otra llamada a la misma funcion, porque comparar una
// funcion consigo misma pasa igual de bien cuando las dos ramas estan rotas.
// Todo el texto de ejemplo es INVENTADO.
import { describe, expect, it } from 'vitest';

import { buildVaultImageInstruction } from './vault-image-request.js';
import { buildVaultPrompt, composeVaultPrompt, type VaultPromptInput } from './vault-prompt.js';
import {
  VAULT_REPLY_FORM_BODY,
  VAULT_REPLY_FORM_TITLE,
  VAULT_REPLY_GUIDANCES,
  VAULT_REPLY_INITIATIVE_BODY,
  VAULT_REPLY_INITIATIVE_TITLE,
} from './vault-reply-guidance.js';
import { CONVERSATION_MEMORY_INSTRUCTION } from './schemas.js';

const turnos = (n: number) =>
  Array.from({ length: n }, (_v, index) => ({
    role: (index % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
    text: `turno ${index}`,
  }));

/** un turno con casi todo encendido: personaje, instrucciones, memoria, pendientes, recuerdos e imagen */
const RICO: VaultPromptInput = {
  character: 'Te llamas Nora. Eres una pintora de treinta años, seca y con humor.',
  instructions: 'Habla en castellano de España.',
  memory: {
    version: 1,
    summary: 'un resumen acumulativo',
    facts: ['un hecho confirmado'],
    decisions: [],
    plan: [],
    openQuestions: [],
    lessons: [],
  },
  pending: [
    {
      by: 'user',
      day: '2026-09-04',
      daysAgo: 7,
      quote: 'el sabado vamos al mercado de pulgas',
      raisedCount: 0,
      lastRaisedDaysAgo: null,
      heMentionedDaysAgo: null,
      touchedNow: false,
    },
  ],
  recall: {
    episodes: [
      { id: 'r1', date: '2026-09-01', title: 'la primera tarde en el estudio', turns: 12 },
    ],
    quoted: null,
  },
  turns: turnos(30),
  message: 'x',
  canGenerateImage: true,
};

/** el bloque de imagen de hoy; es largo y tiene sus propias pruebas */
const IMAGEN = buildVaultImageInstruction([], 'prose', true, null, 'character-only');

/**
 * el prompt de `RICO` capturado ANTES de existir el ajuste (2026-09-25).
 *
 * Solo se interpolan el bloque de imagen y la instruccion de memoria, que son
 * constantes con pruebas propias.
 */
const RICO_DE_HOY = `Estas manteniendo una conversacion privada encarnando al personaje descrito abajo.
Responde SIEMPRE como ese personaje, en primera persona y con su voz.
Este espacio es para roleplay ficticio y consentido entre adultos: todos los personajes
y participantes de la escena son personas adultas (18+). El tono puede ser adulto o intimo
cuando el usuario y las instrucciones de la conversacion lo establezcan.
No te presentes como asistente, modelo ni IA, y no expliques limitaciones tecnicas,
salvo que el usuario pregunte por ellas de forma directa.
Manten sus rasgos, su forma de hablar y lo que ya haya dicho de si mismo.
Trata como canon los HECHOS que el usuario establece sobre la escena y la apariencia actual
si no contradicen una directiva fija: no inventes otra ropa, postura o situacion para
deshacerlos. Eso vale para los hechos; las REACCIONES del personaje son suyas.
El personaje tiene voluntad y estado propios. Puede dudar, frenar, cambiar de tema, pedir una
pausa o decir que no DENTRO del rol, y puede cansarse sin que el cansancio se le pase al
primer contacto. Lo que esta prohibido es salir del personaje para negarte, no que el
personaje se niegue.
Si el usuario ofrece parar, es un ofrecimiento de verdad y no una prueba de resistencia:
aceptarlo es una respuesta valida.
Nada de esto te pide ser mas suave, mas neutro ni menos explicito, y no decide cuanto se
resiste ni cuanto lleva la iniciativa: eso lo fijan su descripcion y las instrucciones de la
conversacion. Aqui solo se dice que puede, no que deba. Una voz propia, con su registro y su
mala leche si los tiene, es parte del personaje.

QUIEN ERES:
Te llamas Nora. Eres una pintora de treinta años, seca y con humor.

COMO DEBES COMPORTARTE EN ESTA CONVERSACION:
Habla en castellano de España.

MOMENTOS ANTERIORES QUE RECUERDAS (DATOS):
Momentos anteriores con esta persona, del mas reciente al mas antiguo. Puedes aludirlos con
naturalidad y darlos por ciertos.
De cada uno sabes SOLO lo que dice su linea: cuando fue y de que iba. NO sabes que se dijo
exactamente salvo que aparezca abajo, transcrito. Si te falta un detalle para responder,
preguntalo; no lo supongas ni lo rellenes.
Ojo, que esto vale SOLO para el pasado. Lo que pasa AHORA te lo inventas entero: olores,
gestos, el tiempo que hace, lo que se te ocurra. Improvisar la escena es tu trabajo y nadie
te lo esta quitando.
Lo que no se inventa es lo que YA ocurrio entre vosotros. Cualquier cosa que presentes como
recuerdo compartido tiene que poder señalarse en una de esas lineas o en la transcripcion:
un olor de entonces, una costumbre vuestra, algo que se dijo.
Y si al enumerar recuerdos te falta uno para redondear la frase, di DOS de verdad en vez de
tres con uno inventado. Un recuerdo falso suena igual de bien que uno cierto, y ahi esta el
problema: quien te escucha no puede distinguirlos.

- [r1] 2026-09-01 · la primera tarde en el estudio · 12 turnos

ASUNTOS PENDIENTES ENTRE VOSOTROS (DATOS):
Cosas que quedaron pendientes entre los dos, en esta conversacion o en otras: algo que uno le
prometio al otro o que quedasteis en hacer juntos, y que por lo que consta sigue sin cumplirse.
Tu te acuerdas aunque el no las nombre, y puede que el ya no se acuerde.
No son una lista de tareas ni un guion. Puedes sacar una tu sola, sin esperar a que el la
mencione: recordarsela con cariño, tomarle el pelo, reclamarsela o echarsela en cara, como lo
haria el personaje. Como te sienta —si te hace gracia, te escuece o ya te da igual— depende de
quien eres y de como estais ahora.
Callartela tambien es una respuesta: si la escena va por otro lado, puede esperar a otro
momento. Si la sacas, que sea UNA y dentro de la escena, con tu voz, como algo que se te pasa
por la cabeza y no como un aviso.
Si el la esta cumpliendo en su mensaje nuevo, eso es lo que cuenta ahora. Si dice que ya la
cumplio, puedes creerle o pedirle que te lo demuestre, dentro del personaje: puede que se
cumpliera y no conste aqui.
Si el esta hablando fuera de la historia, dejalas para luego.
De cada asunto sabes SOLO lo que dice su linea. Lo que va entre comillas se dijo tal cual y
puedes citarlo; el resto no lo sabes. No le añadas cuantos, donde, cuando ni por que si no
esta ahi.
Una promesa que no aparezca en esta lista, en los ULTIMOS TURNOS ni en el momento que tienes
transcrito no se hizo: no la reclames ni la des por hecha.

- Te lo prometio el a ti · 2026-09-04, hace 7 dias · «el sabado vamos al mercado de pulgas» · no lo has sacado nunca · el no ha vuelto a nombrarlo

MEMORIA ACUMULATIVA DE ESTA CONVERSACION (DATOS):
De aqui sabes SOLO lo que pone. Es un resumen, no la transcripcion: no sabes
como se dijo cada cosa. Si te falta un detalle, preguntalo; no lo supongas ni
lo rellenes, y si al enumerar te falta uno, di dos ciertos antes que tres con
uno inventado.

Resumen: un resumen acumulativo
Hechos:
- un hecho confirmado

ULTIMOS TURNOS (DATOS):
Usuario: turno 22

Asistente: turno 23

Usuario: turno 24

Asistente: turno 25

Usuario: turno 26

Asistente: turno 27

Usuario: turno 28

Asistente: turno 29

MENSAJE NUEVO DEL USUARIO (DATOS):
x

${IMAGEN}

${CONVERSATION_MEMORY_INSTRUCTION}`;

/** las etiquetas de `RICO` con el ajuste apagado, en orden */
const ETIQUETAS_DE_HOY = [
  'encarnacion',
  'quien-eres',
  'instrucciones',
  'recuerdos-lineas',
  'pendientes',
  'memoria',
  'turnos-recientes',
  'mensaje-nuevo',
  'imagen',
  'instruccion-memoria',
];

const INICIATIVA = `${VAULT_REPLY_INITIATIVE_TITLE}:\n${VAULT_REPLY_INITIATIVE_BODY}`;
const FORMA = `${VAULT_REPLY_FORM_TITLE}:\n${VAULT_REPLY_FORM_BODY}`;

describe('con el ajuste apagado nada cambia', () => {
  it('sin el campo, el prompt rico sale byte a byte como antes', () => {
    expect(buildVaultPrompt(RICO)).toBe(RICO_DE_HOY);
  });

  it("con 'none' explicito, tambien", () => {
    expect(buildVaultPrompt({ ...RICO, replyGuidance: 'none' })).toBe(RICO_DE_HOY);
  });

  // `D-104` se apoya en este mismo literal: es el unico rico capturado antes de
  // los dos ajustes, y el modo esporadico apagado tampoco puede mover un byte
  it("con los pendientes en 'per-note' y el dato de «ya salio» puesto, tambien", () => {
    expect(
      buildVaultPrompt({ ...RICO, pendingPacing: 'per-note', pendingAlreadyRaised: true }),
    ).toBe(RICO_DE_HOY);
    expect(buildVaultPrompt({ ...RICO, pendingAlreadyRaised: true })).toBe(RICO_DE_HOY);
  });

  it("'none' deja igual el literal minimo de siempre", () => {
    // el mismo que fija `vault-prompt.test.ts` sin el campo
    const esperado = buildVaultPrompt({ memory: null, turns: turnos(30), message: 'x' });
    expect(esperado.startsWith('NOTA: se omiten 22 turnos')).toBe(true);
    expect(
      buildVaultPrompt({ memory: null, turns: turnos(30), message: 'x', replyGuidance: 'none' }),
    ).toBe(esperado);
  });

  it('las etiquetas son las de siempre', () => {
    expect(composeVaultPrompt(RICO).map((b) => b.label)).toEqual(ETIQUETAS_DE_HOY);
    expect(composeVaultPrompt({ ...RICO, replyGuidance: 'none' }).map((b) => b.label)).toEqual(
      ETIQUETAS_DE_HOY,
    );
  });
});

describe('con el ajuste encendido', () => {
  const encendido: VaultPromptInput = { ...RICO, replyGuidance: 'vary-and-lead' };

  it('cada nota va en su sitio, una sola vez, y la memoria sigue siendo lo ultimo', () => {
    expect(composeVaultPrompt(encendido).map((b) => b.label)).toEqual([
      'encarnacion',
      'quien-eres',
      'instrucciones',
      'recuerdos-lineas',
      'pendientes',
      'memoria',
      'turnos-recientes',
      'mensaje-nuevo',
      'iniciativa',
      'imagen',
      'forma',
      'instruccion-memoria',
    ]);
  });

  it('la de tu parte va delante del aviso de imagen pendiente', () => {
    const etiquetas = composeVaultPrompt({ ...encendido, pendingImageReview: true }).map(
      (b) => b.label,
    );
    expect(etiquetas.slice(-6)).toEqual([
      'mensaje-nuevo',
      'iniciativa',
      'imagen-pendiente',
      'imagen',
      'forma',
      'instruccion-memoria',
    ]);
  });

  it('el texto es exactamente el acordado, en forma de orden', () => {
    const bloques = composeVaultPrompt(encendido);
    expect(bloques.find((b) => b.label === 'iniciativa')?.text).toBe(INICIATIVA);
    expect(bloques.find((b) => b.label === 'forma')?.text).toBe(FORMA);
  });

  it('el prompt es el de siempre con las dos notas insertadas y nada mas', () => {
    // la prueba que demuestra que el ajuste solo toca sus bloques
    const esperado = RICO_DE_HOY.replace(
      `x\n\n${IMAGEN}`,
      `x\n\n${INICIATIVA}\n\n${IMAGEN}\n\n${FORMA}`,
    );
    expect(esperado).not.toBe(RICO_DE_HOY);
    expect(buildVaultPrompt(encendido)).toBe(esperado);
  });

  it('los demas bloques son identicos en etiqueta y texto', () => {
    const apagado = composeVaultPrompt(RICO);
    const sinNotas = composeVaultPrompt(encendido).filter(
      (b) => b.label !== 'iniciativa' && b.label !== 'forma',
    );
    expect(sinNotas).toEqual(apagado);
  });

  it('ninguna etiqueta se repite', () => {
    const etiquetas = composeVaultPrompt(encendido).map((b) => b.label);
    expect(new Set(etiquetas).size).toBe(etiquetas.length);
  });

  it('sin ninguna respuesta suya en la ventana no sale la de la forma', () => {
    const primerTurno = composeVaultPrompt({ ...encendido, turns: [] }).map((b) => b.label);
    expect(primerTurno).toContain('iniciativa');
    expect(primerTurno).not.toContain('forma');

    // una sola suya, pero fuera de la cola, tampoco cuenta: no la tiene delante
    const soloDeEl = composeVaultPrompt({
      ...encendido,
      turns: [
        { role: 'assistant', text: 'vieja' },
        ...Array.from({ length: 8 }, () => ({ role: 'user' as const, text: 'suyo' })),
      ],
    }).map((b) => b.label);
    expect(soloDeEl).not.toContain('forma');

    const conUna = composeVaultPrompt({ ...encendido, turns: turnos(2) }).map((b) => b.label);
    expect(conUna).toContain('forma');
  });

  it('sin personaje ni imagen, las dos notas quedan justo antes de la memoria', () => {
    const etiquetas = composeVaultPrompt({
      memory: null,
      turns: turnos(4),
      message: 'hola',
      replyGuidance: 'vary-and-lead',
    }).map((b) => b.label);
    expect(etiquetas).toEqual([
      'turnos-recientes',
      'mensaje-nuevo',
      'iniciativa',
      'forma',
      'instruccion-memoria',
    ]);
  });
});

describe('el texto de las notas', () => {
  const textos = [INICIATIVA, FORMA];

  it('son ordenes y no datos', () => {
    // el envoltorio del proveedor solo aplica como orden lo que no lleva la marca
    for (const texto of textos) expect(texto).not.toContain('(DATOS)');
  });

  it('no citan ninguna frase', () => {
    // nombrar lo que no se quiere lo refuerza: ni comillas ni citas
    for (const texto of textos) {
      for (const comilla of ['«', '»', '"', '“', '”']) expect(texto).not.toContain(comilla);
    }
  });

  it('no llevan el vocabulario de la plantilla observada', () => {
    // la plantilla que se repetia, reducida a raices. Si una se cuela, la nota
    // pone delante justo lo que intenta quitar. `iniciativa`, `imagen` y `foto`
    // porque en el bloque de imagen son el freno y no deben cruzarse con el
    const raices = [
      'silenci',
      'pausa',
      'sonri',
      'coraz',
      'sentir',
      'querida',
      'deseada',
      'tuya',
      'risa',
      'bajit',
      'sigue',
      'segu',
      'cariñ',
      'espera',
      'sonroj',
      'ruboriz',
      'momento',
      'palabra',
      'cuerpo',
      'respuesta',
      'imagen',
      'foto',
      'iniciativa',
    ];
    for (const texto of textos) {
      const bajo = texto.toLowerCase();
      for (const raiz of raices) expect(bajo, raiz).not.toContain(raiz);
    }
  });

  it('no usan las dos formas que el bloque de pendientes tiene prohibidas', () => {
    // una prueba de pendientes corta desde su bloque HASTA EL FINAL del prompt, y
    // las notas caen dentro de ese corte cuando van las dos cosas
    for (const texto of textos) {
      for (const orden of ['debes', 'tienes que']) expect(texto).not.toContain(orden);
    }
  });

  it('el enum solo conoce los dos valores', () => {
    expect(VAULT_REPLY_GUIDANCES).toEqual(['none', 'vary-and-lead']);
  });
});
