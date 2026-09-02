// pruebas de como el modelo pide una imagen.
//
// Todo esto es puro: se prueba cada caso limite sin montar una boveda y, sobre
// todo, **sin gastar una generacion**. Es justo la parte donde un modelo se
// desvia del formato, y donde un fallo silencioso se veria como «pedi una foto
// y no llego» sin ninguna pista.
import { describe, it, expect } from 'vitest';
import {
  VAULT_IMAGE_CLOSE,
  VAULT_IMAGE_OPEN,
  buildVaultImageInstruction,
  parseVaultImageRequest,
} from './vault-image-request.js';
import { parseConversationMemoryResponse } from './schemas.js';
import { buildVaultPrompt } from './vault-prompt.js';

const bloque = (json: string): string => `${VAULT_IMAGE_OPEN}\n${json}\n${VAULT_IMAGE_CLOSE}`;

describe('peticion de imagen del modelo', () => {
  it('sin bloque no hay peticion, y el texto queda intacto', () => {
    const parsed = parseVaultImageRequest('Te miro y sonrio.');
    expect(parsed.request).toBeNull();
    expect(parsed.status).toBe('absent');
    expect(parsed.visibleText).toBe('Te miro y sonrio.');
  });

  it('separa el bloque del texto visible', () => {
    const parsed = parseVaultImageRequest(
      `Aqui la tienes.\n\n${bloque('{"prompt":"de pie junto a la ventana","kind":"image"}')}`,
    );
    expect(parsed.status).toBe('structured');
    expect(parsed.request).toEqual({ prompt: 'de pie junto a la ventana', kind: 'image' });
    // el bloque tecnico NO puede acabar guardado como parte de la respuesta
    expect(parsed.visibleText).toBe('Aqui la tienes.');
    expect(parsed.visibleText).not.toContain(VAULT_IMAGE_OPEN);
  });

  it('kind por defecto es imagen', () => {
    const parsed = parseVaultImageRequest(bloque('{"prompt":"un retrato"}'));
    expect(parsed.request?.kind).toBe('image');
  });

  it('acepta video cuando se pide', () => {
    const parsed = parseVaultImageRequest(bloque('{"prompt":"caminando","kind":"video"}'));
    expect(parsed.request?.kind).toBe('video');
  });

  it('tolera que el modelo lo envuelva en una cerca Markdown', () => {
    const parsed = parseVaultImageRequest(
      `${VAULT_IMAGE_OPEN}\n\`\`\`json\n{"prompt":"un retrato"}\n\`\`\`\n${VAULT_IMAGE_CLOSE}`,
    );
    expect(parsed.status).toBe('structured');
    expect(parsed.request?.prompt).toBe('un retrato');
  });

  it('un bloque cortado se distingue de uno que no existia', () => {
    const parsed = parseVaultImageRequest(`Texto util.\n${VAULT_IMAGE_OPEN}\n{"prompt":"a med`);
    // «se corto» y «no lo pidio» acaban igual, pero se arreglan de otra forma
    expect(parsed.status).toBe('truncated_block');
    expect(parsed.request).toBeNull();
    expect(parsed.visibleText).toBe('Texto util.');
  });

  it('un bloque invalido no se traga la respuesta', () => {
    const parsed = parseVaultImageRequest(`Lo que dije.\n\n${bloque('{"prompt":')}`);
    expect(parsed.status).toBe('invalid');
    expect(parsed.request).toBeNull();
    expect(parsed.visibleText).toBe('Lo que dije.');
  });

  it('un prompt vacio no se acepta', () => {
    const parsed = parseVaultImageRequest(bloque('{"prompt":""}'));
    expect(parsed.status).toBe('invalid');
    expect(parsed.request).toBeNull();
  });

  it('un kind inventado no se acepta', () => {
    const parsed = parseVaultImageRequest(bloque('{"prompt":"algo","kind":"gif"}'));
    expect(parsed.status).toBe('invalid');
  });

  it('el texto de despues del bloque tambien se conserva', () => {
    const parsed = parseVaultImageRequest(
      `Antes.\n${bloque('{"prompt":"x"}')}\nDespues.`,
    );
    expect(parsed.visibleText).toBe('Antes.\n\nDespues.');
  });
});

describe('convivencia con el bloque de memoria', () => {
  it('los dos bloques se separan y no queda ninguno en el texto', () => {
    // el orden real: la imagen antes de la memoria, porque la instruccion de
    // memoria dice que no se escriba nada despues de su bloque
    const respuesta = [
      'Te la mando.',
      bloque('{"prompt":"junto a la ventana","kind":"image"}'),
      '<LUXY_MEMORY>',
      '{"version":1,"summary":"charla","facts":[],"decisions":[],"plan":[],"openQuestions":[],"lessons":[]}',
      '</LUXY_MEMORY>',
    ].join('\n');

    const memoria = parseConversationMemoryResponse(respuesta);
    expect(memoria.status).toBe('structured');

    const imagen = parseVaultImageRequest(memoria.visibleText);
    expect(imagen.status).toBe('structured');
    expect(imagen.request?.prompt).toBe('junto a la ventana');

    // lo que se guarda como turno no lleva ni un bloque tecnico
    expect(imagen.visibleText).toBe('Te la mando.');
    expect(imagen.visibleText).not.toContain('LUXY_');
  });
});

describe('la herramienta solo se ofrece cuando existe', () => {
  const base = { memory: null, turns: [], message: 'hola' };

  it('sin poder generar, el prompt no menciona el bloque', () => {
    const prompt = buildVaultPrompt(base);
    // ofrecerle lo que no existe garantiza que lo use y que el usuario vea una
    // promesa incumplida en cada turno
    expect(prompt).not.toContain(VAULT_IMAGE_OPEN);
  });

  it('pudiendo generar, el prompt lo explica', () => {
    const prompt = buildVaultPrompt({ ...base, canGenerateImage: true });
    expect(prompt).toContain(VAULT_IMAGE_OPEN);
    expect(prompt).toContain(VAULT_IMAGE_CLOSE);
  });

  it('la instruccion pide describir la escena, no repetir al usuario', () => {
    // sin esto el modelo reenvia el mensaje del usuario como prompt, que casi
    // nunca describe una imagen
    expect(buildVaultImageInstruction()).toContain('descripcion visual');
  });
});
