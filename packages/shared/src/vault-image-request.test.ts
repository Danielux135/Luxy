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

  it('reenviar una imagen existente no lleva prompt', () => {
    const parsed = parseVaultImageRequest(bloque('{"mediaId":"med-1"}'));
    // generar cuesta creditos; reenviar lo que ya se hizo no cuesta nada
    expect(parsed.status).toBe('structured');
    expect(parsed.request?.mediaId).toBe('med-1');
    expect(parsed.request?.prompt).toBeUndefined();
  });

  it('pedir las dos cosas a la vez se rechaza', () => {
    const parsed = parseVaultImageRequest(bloque('{"prompt":"algo","mediaId":"med-1"}'));
    // con las dos no se sabe si quiere generar o reenviar
    expect(parsed.status).toBe('invalid');
  });

  it('un bloque sin ninguna de las dos no pide nada', () => {
    expect(parseVaultImageRequest(bloque('{"kind":"image"}')).status).toBe('invalid');
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

  it('una peticion de foto exige el bloque y una respuesta en personaje', () => {
    const instruction = buildVaultImageInstruction();
    expect(instruction).toContain('responde primero en personaje');
    expect(instruction).toContain('no alegues que no puedes adjuntar archivos');
    expect(instruction).toContain('no prometas enviarla sin incluirlo');
  });

  it('sin imagenes previas no se le ofrece reenviar ninguna', () => {
    expect(buildVaultImageInstruction()).not.toContain('IMAGENES QUE YA EXISTEN');
  });

  it('con imagenes previas se las lista para que las reenvie', () => {
    const texto = buildVaultImageInstruction([
      { mediaId: 'med-1', description: 'de pie junto a la ventana' },
      { mediaId: 'med-2', description: '' },
    ]);
    // sin la lista no puede reenviar nada: genera otra, pagando, cada vez que
    // le piden «la de antes»
    expect(texto).toContain('med-1: de pie junto a la ventana');
    expect(texto).toContain('med-2: sin descripcion');
    expect(texto).toContain('gratis');
  });
});
