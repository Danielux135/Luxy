// pruebas del modo esporadico de los pendientes (`D-104`).
//
// La primera manda: con el ajuste APAGADO el prompt no cambia ni un byte. Se
// compara contra un VALOR LITERAL capturado de la implementacion anterior al
// cambio, y no contra otra llamada a la misma funcion, porque comparar una
// funcion consigo misma pasa igual de bien cuando las dos ramas estan rotas.
// Todo el texto de ejemplo es INVENTADO.
import { describe, expect, it } from 'vitest';

import {
  buildVaultPrompt,
  composeVaultPrompt,
  type PendingAffairLine,
  type VaultPromptInput,
} from './vault-prompt.js';
import {
  VAULT_PENDING_ALREADY_RAISED_BODY,
  VAULT_PENDING_ALREADY_RAISED_TITLE,
  VAULT_PENDING_PACINGS,
  VAULT_PENDING_SPARSE_PERMISSION,
} from './vault-pending-pacing.js';

const turnos = (n: number) =>
  Array.from({ length: n }, (_v, index) => ({
    role: (index % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
    text: `turno ${index}`,
  }));

const linea: PendingAffairLine = {
  by: 'character',
  day: '2026-09-10',
  daysAgo: 5,
  quote: 'te debo una cena en el sitio del puerto',
  raisedCount: 1,
  lastRaisedDaysAgo: 3,
  heMentionedDaysAgo: null,
  touchedNow: false,
};

const BASE: VaultPromptInput = {
  memory: null,
  turns: turnos(4),
  message: 'buenos dias',
  pending: [linea],
};

/**
 * el prompt de `BASE` capturado ANTES de existir el ajuste (2026-09-25).
 *
 * Todo es texto tal cual, incluida la instruccion de memoria: si esa constante
 * cambia un dia, esta prueba tiene que cambiar con ella a proposito.
 */
const BASE_DE_HOY = `ASUNTOS PENDIENTES ENTRE VOSOTROS (DATOS):
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

- Se lo prometiste tu a el · 2026-09-10, hace 5 dias · «te debo una cena en el sitio del puerto» · lo sacaste una vez, hace 3 dias · el no ha vuelto a nombrarlo

ULTIMOS TURNOS (DATOS):
Usuario: turno 0

Asistente: turno 1

Usuario: turno 2

Asistente: turno 3

MENSAJE NUEVO DEL USUARIO (DATOS):
buenos dias

Al final de tu respuesta añade una memoria acumulativa para Luxy.
Conserva lo valido de la memoria anterior y aplica correcciones del usuario.
Incluye solo hechos expresos u observados; no conviertas suposiciones en hechos.
No pongas este bloque dentro de una cerca Markdown ni escribas nada despues.
<LUXY_MEMORY>
{"version":1,"summary":"resumen acumulativo breve","facts":[],"decisions":[],"plan":[],"openQuestions":[],"lessons":[]}
</LUXY_MEMORY>`;

/** el permiso de siempre, las ocho lineas que el modo esporadico sustituye */
const PERMISO_DE_HOY = [
  'Tu te acuerdas aunque el no las nombre, y puede que el ya no se acuerde.',
  'No son una lista de tareas ni un guion. Puedes sacar una tu sola, sin esperar a que el la',
  'mencione: recordarsela con cariño, tomarle el pelo, reclamarsela o echarsela en cara, como lo',
  'haria el personaje. Como te sienta —si te hace gracia, te escuece o ya te da igual— depende de',
  'quien eres y de como estais ahora.',
  'Callartela tambien es una respuesta: si la escena va por otro lado, puede esperar a otro',
  'momento. Si la sacas, que sea UNA y dentro de la escena, con tu voz, como algo que se te pasa',
  'por la cabeza y no como un aviso.',
].join('\n');

/** la regla de la promesa que no consta, tal y como era */
const REGLA_DE_HOY = [
  'Una promesa que no aparezca en esta lista, en los ULTIMOS TURNOS ni en el momento que tienes',
  'transcrito no se hizo: no la reclames ni la des por hecha.',
].join('\n');

/** la misma regla con el tope: nombra la memoria y no afirma que la lista este completa */
const REGLA_INCOMPLETA = [
  'Una promesa que no aparezca en esta lista, en los ULTIMOS TURNOS, en la memoria de esta',
  'conversacion ni en el momento que tienes transcrito',
  'no la saques tu ni la des por hecha. Esta lista no siempre las trae todas: si el nombra una',
  'que no ves aqui, no la niegues; siguele sin añadir nada que no conste.',
].join('\n');

/** el texto que aprobo el panel, en un solo parrafo: las lineas solo lo parten */
const PERMISO_DEL_PANEL =
  'Tu te acuerdas de ellas aunque el no las nombre. Pero que esten aqui no quiere decir que toque sacar una: como pasa con lo que uno tiene pendiente con alguien, no sale en cada conversacion; vuelve cuando algo lo trae, no por costumbre. Si el saca una, te acuerdas y le contestas. Si la escena te trae una —algo que el dice o hace, un sitio, un momento que te la recuerda—, puedes sacarla tu sola: recordarsela con cariño, tomarle el pelo, reclamarsela o echarsela en cara, como lo haria el personaje. Como te sienta —si te hace gracia, te escuece o ya te da igual— depende de quien eres y de como estais ahora. Si nada te la trae, se queda contigo para otro dia: lo pendiente pesa mas cuando vuelve de tarde en tarde. Si la sacas, que sea UNA y dentro de la escena, con tu voz, como algo que se te pasa por la cabeza y no como un aviso.';

const YA_SALIO = `${VAULT_PENDING_ALREADY_RAISED_TITLE}:\n${VAULT_PENDING_ALREADY_RAISED_BODY}`;

describe('con el ajuste apagado nada cambia', () => {
  it('sin el campo, el prompt sale byte a byte como antes', () => {
    expect(buildVaultPrompt(BASE)).toBe(BASE_DE_HOY);
  });

  it("con 'per-note' explicito, tambien", () => {
    expect(buildVaultPrompt({ ...BASE, pendingPacing: 'per-note' })).toBe(BASE_DE_HOY);
  });

  it("con 'per-note', la nota de «ya salio» no sale aunque el dato diga que si", () => {
    expect(
      buildVaultPrompt({ ...BASE, pendingPacing: 'per-note', pendingAlreadyRaised: true }),
    ).toBe(BASE_DE_HOY);
    expect(buildVaultPrompt({ ...BASE, pendingAlreadyRaised: true })).toBe(BASE_DE_HOY);
  });
});

describe('con el ajuste encendido', () => {
  // revision del 28/09: tambien cambia la regla de la promesa que no consta. Con
  // el tope cerrado la lista lleva SOLO las notas que el toca, y la de siempre
  // declaraba «no se hizo» a las demas, que siguen abiertas
  it('el bloque de pendientes solo cambia en el permiso y en esa regla; lo demas es identico', () => {
    const hoy = composeVaultPrompt(BASE);
    const encendido = composeVaultPrompt({ ...BASE, pendingPacing: 'sparse' });
    expect(encendido.map((b) => b.label)).toEqual(hoy.map((b) => b.label));
    for (const [index, bloque] of encendido.entries()) {
      const antes = hoy[index]!;
      if (bloque.label !== 'pendientes') {
        expect(bloque.text).toBe(antes.text);
        continue;
      }
      expect(antes.text.includes(PERMISO_DE_HOY)).toBe(true);
      expect(antes.text.includes(REGLA_DE_HOY)).toBe(true);
      expect(bloque.text).toBe(
        antes.text
          .replace(PERMISO_DE_HOY, VAULT_PENDING_SPARSE_PERMISSION.join('\n'))
          .replace(REGLA_DE_HOY, REGLA_INCOMPLETA),
      );
    }
  });

  it('el permiso es el texto del panel, palabra por palabra', () => {
    expect(VAULT_PENDING_SPARSE_PERMISSION.join(' ')).toBe(PERMISO_DEL_PANEL);
  });

  it('la nota de «ya salio» va entre sus turnos y el mensaje nuevo', () => {
    const etiquetas = composeVaultPrompt({
      ...BASE,
      pendingPacing: 'sparse',
      pendingAlreadyRaised: true,
    }).map((b) => b.label);
    expect(etiquetas).toEqual([
      'pendientes',
      'turnos-recientes',
      'pendientes-ya-salio',
      'mensaje-nuevo',
      'instruccion-memoria',
    ]);
  });

  it('con las notas de direccion tambien encendidas, cada bloque una vez y la memoria al final', () => {
    const etiquetas = composeVaultPrompt({
      ...BASE,
      pendingPacing: 'sparse',
      pendingAlreadyRaised: true,
      replyGuidance: 'vary-and-lead',
    }).map((b) => b.label);
    expect(etiquetas).toEqual([
      'pendientes',
      'turnos-recientes',
      'pendientes-ya-salio',
      'mensaje-nuevo',
      'iniciativa',
      'forma',
      'instruccion-memoria',
    ]);
    expect(new Set(etiquetas).size).toBe(etiquetas.length);
  });

  it('la nota viaja aunque ese turno no lleve el bloque de pendientes', () => {
    const bloques = composeVaultPrompt({
      ...BASE,
      pending: [],
      pendingPacing: 'sparse',
      pendingAlreadyRaised: true,
    });
    expect(bloques.map((b) => b.label)).not.toContain('pendientes');
    expect(bloques.find((b) => b.label === 'pendientes-ya-salio')?.text).toBe(YA_SALIO);
  });

  it('sin respuestas suyas en la cola no sale: hablaria de algo que no tiene delante', () => {
    const soloEl = composeVaultPrompt({
      ...BASE,
      turns: [{ role: 'user', text: 'turno 0' }],
      pendingPacing: 'sparse',
      pendingAlreadyRaised: true,
    });
    expect(soloEl.map((b) => b.label)).not.toContain('pendientes-ya-salio');
    const vacio = composeVaultPrompt({
      ...BASE,
      turns: [],
      pendingPacing: 'sparse',
      pendingAlreadyRaised: true,
    });
    expect(vacio.map((b) => b.label)).not.toContain('pendientes-ya-salio');
  });

  it('sin el dato, encendido no añade la nota', () => {
    const etiquetas = composeVaultPrompt({ ...BASE, pendingPacing: 'sparse' }).map(
      (b) => b.label,
    );
    expect(etiquetas).not.toContain('pendientes-ya-salio');
    expect(
      composeVaultPrompt({ ...BASE, pendingPacing: 'sparse', pendingAlreadyRaised: false }).map(
        (b) => b.label,
      ),
    ).toEqual(etiquetas);
  });
});

describe('los textos', () => {
  const permiso = VAULT_PENDING_SPARSE_PERMISSION.join('\n');

  it('el ajuste tiene dos valores y nace en el de siempre', () => {
    expect(VAULT_PENDING_PACINGS).toEqual(['per-note', 'sparse']);
  });

  it('la nota es una orden, no un dato', () => {
    expect(YA_SALIO).not.toContain('(DATOS)');
  });

  it('ni comillas, ni «debes», ni «tienes que», ni tildes', () => {
    for (const texto of [permiso, VAULT_PENDING_ALREADY_RAISED_TITLE, VAULT_PENDING_ALREADY_RAISED_BODY]) {
      expect(texto).not.toMatch(/[«»"“”]/);
      expect(texto.toLowerCase()).not.toContain('debes');
      expect(texto.toLowerCase()).not.toContain('tienes que');
      expect(texto).not.toMatch(/[áéíóúÁÉÍÓÚ]/);
    }
  });

  it('ninguno habla de turnos, cadencia ni tope: no tiene que saber que hay un reloj', () => {
    for (const texto of [permiso, VAULT_PENDING_ALREADY_RAISED_BODY]) {
      expect(texto.toLowerCase()).not.toMatch(/turno|cadencia|tope|cada cuatro|mensajes/);
    }
  });

  it('la nota no nombra ninguna promesa: solo dice que salio algo', () => {
    expect(VAULT_PENDING_ALREADY_RAISED_BODY).not.toContain(linea.quote);
  });
});
