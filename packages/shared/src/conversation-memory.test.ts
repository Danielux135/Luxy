// pruebas de la memoria estructurada de Conversaciones.
//
// POR QUE EXISTE: cuando una respuesta era una pagina web, la memoria acababa
// llena de HTML, CSS y JavaScript. El motivo era un fallback que resumia los
// primeros 1.200 caracteres del texto visible cuando faltaba el bloque
// `LUXY_MEMORY`. Ese resumen no sirve como contexto y ademas pisaba una memoria
// anterior que si era correcta. La regla nueva: solo un bloque completo, valido
// y en prosa sustituye la memoria; todo lo demas conserva la anterior.
import { describe, expect, it } from 'vitest';
import {
  CONVERSATION_MEMORY_CLOSE,
  CONVERSATION_MEMORY_OPEN,
  formatConversationMemory,
  looksLikeCode,
  parseConversationMemoryResponse,
} from './schemas.js';

const MEMORIA_VALIDA = {
  version: 1,
  summary: 'Daniel esta creando memoria para Luxy.',
  facts: ['Las APIs HTTP no conservan sesion.'],
  decisions: ['Luxy reenviara contexto.'],
  plan: ['Probar un segundo turno.'],
  openQuestions: [],
  lessons: [],
};

/** la respuesta que rompio la memoria: una web entera */
const PAGINA_WEB = [
  'Aqui tienes `index.html` completo, autocontenido y profesional.',
  '',
  '```html',
  '<!DOCTYPE html>',
  '<html lang="es">',
  '<head>',
  '<meta charset="UTF-8">',
  '<title>Luxy — Interfaz Cognitiva</title>',
  '<style>',
  "@import url('https://fonts.googleapis.com/css2?family=Orbitron');",
  ':root{--cyan:#00f0ff;--purple:#bc13fe;--bg:#050a14;}',
  'body{background:var(--bg);color:var(--text);font-family:Inter,sans-serif;}',
  '</style>',
  '</head>',
  '<body>',
  '<canvas id="fondo"></canvas>',
  '<script>',
  'const canvas = document.getElementById("fondo");',
  'class Particle{ constructor(){ this.x = Math.random()*w; } }',
  '</script>',
].join('\n');

describe('memoria estructurada de conversaciones', () => {
  it('separa el bloque interno de la respuesta visible', () => {
    const result = parseConversationMemoryResponse(
      [
        'Respuesta para Daniel.',
        CONVERSATION_MEMORY_OPEN,
        JSON.stringify(MEMORIA_VALIDA),
        CONVERSATION_MEMORY_CLOSE,
      ].join('\n'),
    );

    expect(result.visibleText).toBe('Respuesta para Daniel.');
    expect(result.status).toBe('structured');
    expect(result.memory?.decisions).toEqual(['Luxy reenviara contexto.']);
    expect(formatConversationMemory(result.memory!)).toContain('Plan:');
  });

  it('sin bloque no inventa memoria: este turno no aporta ninguna', () => {
    const result = parseConversationMemoryResponse('respuesta sin bloque');
    expect(result.status).toBe('absent');
    expect(result.memory).toBeNull();
    expect(result.visibleText).toBe('respuesta sin bloque');
  });

  it('un json invalido no rompe la respuesta ni produce memoria', () => {
    const result = parseConversationMemoryResponse(
      `texto valido\n${CONVERSATION_MEMORY_OPEN}\n{mal}\n${CONVERSATION_MEMORY_CLOSE}`,
    );
    expect(result.visibleText).toBe('texto valido');
    expect(result.status).toBe('invalid');
    expect(result.memory).toBeNull();
  });

  it('un bloque abierto y cortado a mitad se distingue de uno ausente', () => {
    const result = parseConversationMemoryResponse(
      `texto valido\n${CONVERSATION_MEMORY_OPEN}\n{"version":1,"summ`,
    );
    expect(result.status).toBe('truncated_block');
    expect(result.memory).toBeNull();
    // el bloque privado nunca se enseña, ni siquiera roto
    expect(result.visibleText).toBe('texto valido');
  });

  // el fallo exacto de la captura del 2026-08-05
  it('una respuesta que es una web NO se convierte en memoria', () => {
    const result = parseConversationMemoryResponse(PAGINA_WEB);
    expect(result.status).toBe('absent');
    expect(result.memory).toBeNull();
    expect(result.visibleText).toContain('<!DOCTYPE html>');
  });

  it('rechaza un bloque bien formado que lleva codigo dentro', () => {
    // el modelo puede equivocarse y meter la respuesta en el resumen
    const result = parseConversationMemoryResponse(
      [
        'Aqui tienes la web.',
        CONVERSATION_MEMORY_OPEN,
        JSON.stringify({
          ...MEMORIA_VALIDA,
          summary: '<!DOCTYPE html><html lang="es"><head><style>body{margin:0;}</style></head>',
        }),
        CONVERSATION_MEMORY_CLOSE,
      ].join('\n'),
    );
    expect(result.status).toBe('rejected_code');
    expect(result.memory).toBeNull();
    // la respuesta visible se conserva entera: lo que se descarta es la memoria
    expect(result.visibleText).toBe('Aqui tienes la web.');
  });

  // POR QUE EXISTE: en LUX-8B8T el modelo SI escribio su memoria, pero el
  // bloque se descarto entero por pasarse de largo y Daniel se quedo sin panel.
  // Un texto largo sobra, no contamina: se recorta.
  it('recorta un bloque que se pasa de los limites en vez de tirarlo', () => {
    const result = parseConversationMemoryResponse(
      [
        'Respuesta.',
        CONVERSATION_MEMORY_OPEN,
        JSON.stringify({
          version: 1,
          summary: `Daniel pidio una pagina web. ${'Detalle del encargo. '.repeat(120)}`,
          facts: Array.from({ length: 20 }, (_, i) => `Hecho numero ${i} del proyecto Luxy.`),
          decisions: [`Se decidio lo siguiente. ${'Motivo largo. '.repeat(40)}`],
          plan: [],
          openQuestions: [],
          lessons: [],
        }),
        CONVERSATION_MEMORY_CLOSE,
      ].join('\n'),
    );

    expect(result.status).toBe('structured');
    expect(result.memory).not.toBeNull();
    expect(result.memory!.summary.length).toBe(1200);
    expect(result.memory!.summary.startsWith('Daniel pidio una pagina web.')).toBe(true);
    // se conservan los primeros hechos, no se pierde la memoria entera
    expect(result.memory!.facts).toHaveLength(12);
    expect(result.memory!.decisions[0]!.length).toBe(240);
  });

  it('descarta entradas vacias sin invalidar el bloque', () => {
    const result = parseConversationMemoryResponse(
      [
        'Respuesta.',
        CONVERSATION_MEMORY_OPEN,
        JSON.stringify({ ...MEMORIA_VALIDA, facts: ['   ', 'Un hecho util.', ''] }),
        CONVERSATION_MEMORY_CLOSE,
      ].join('\n'),
    );
    expect(result.status).toBe('structured');
    expect(result.memory!.facts).toEqual(['Un hecho util.']);
  });

  it('tambien rechaza codigo escondido en un hecho', () => {
    const result = parseConversationMemoryResponse(
      [
        'texto',
        CONVERSATION_MEMORY_OPEN,
        JSON.stringify({
          ...MEMORIA_VALIDA,
          facts: ['const canvas = document.getElementById("fondo");'],
        }),
        CONVERSATION_MEMORY_CLOSE,
      ].join('\n'),
    );
    expect(result.status).toBe('rejected_code');
  });
});

describe('looksLikeCode', () => {
  it('reconoce HTML, CSS, JavaScript, JSON y cercas', () => {
    for (const muestra of [
      '<!DOCTYPE html><html lang="es">',
      '<div class="content"><span>hola</span></div>',
      'body{background:var(--bg);color:#fff;}',
      "@import url('https://fonts.googleapis.com/css2?family=Orbitron');",
      'const canvas = document.getElementById("fondo");',
      'function resize(){ return 1; }',
      '{"version":1,"summary":"x"}',
      '```html\n<p>hola</p>\n```',
    ]) {
      expect(looksLikeCode(muestra), muestra).toBe(true);
    }
  });

  it('no confunde prosa tecnica con codigo', () => {
    for (const muestra of [
      'Daniel esta creando memoria para Luxy.',
      'Las APIs HTTP no conservan sesion entre llamadas.',
      'Decidimos no añadir Redux al proyecto, que usa Vite.',
      'El usuario pidio una pagina web con CSS y JavaScript.',
      'Hay que revisar el timeout del gateway (son 3.600 s).',
      '',
    ]) {
      expect(looksLikeCode(muestra), muestra).toBe(false);
    }
  });
});
