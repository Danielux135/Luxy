// pruebas de como el modelo pide una imagen.
//
// Todo esto es puro: se prueba cada caso limite sin montar una boveda y, sobre
// todo, **sin gastar una generacion**. Es justo la parte donde un modelo se
// desvia del formato, y donde un fallo silencioso se veria como «pedi una foto
// y no llego» sin ninguna pista.
import { describe, it, expect } from 'vitest';
import {
  VAULT_IMAGE_CLOSE,
  VAULT_IMAGE_NEGATIVE,
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
    expect(buildVaultImageInstruction()).toContain('No copies el mensaje del usuario');
  });

  it('no se ofrece enviar una imagen que nadie ha pedido', () => {
    // paso de verdad: mando dos fotos sin que se las pidieran, una de ellas en
    // un momento dramatico de la escena. La instruccion empujaba a usar el
    // bloque y no decia en ningun sitio que no lo usara por su cuenta
    const instruction = buildVaultImageInstruction();
    expect(instruction).toContain('SOLO si el usuario pide ver, recibir o volver a ver una imagen');
    expect(instruction).toContain('Nunca por iniciativa propia');
    expect(instruction).toContain('si no te la han pedido, no la mandes');
  });

  it('el prompt del generador se pide en ingles', () => {
    // su documentacion es explicita: en otro idioma el generador ignora la
    // escena. La instruccion estaba escrita en español y no lo decia
    const instruction = buildVaultImageInstruction();
    expect(instruction).toContain('EN INGLES');
    expect(instruction).toContain('solo este campo en ingles');
  });

  it('prohibe la segunda persona y las camaras, que fue lo que salio en la imagen', () => {
    // una generacion real devolvio al personaje correcto con una mujer de mas
    // en el encuadre y una camara en la mano: el usuario habia dicho «mandame
    // una foto» y eso acaba emparejando con la pose «selfie» del proveedor
    const instruction = buildVaultImageInstruction();
    expect(instruction).toContain('Solo aparece EL PERSONAJE, a solas');
    expect(instruction).toContain('si mencionas a alguien mas, sale en la imagen');
    expect(instruction).toContain('Nada de camaras, moviles, espejos, selfies');
  });

  it('el estilo del prompt sigue al modelo del personaje', () => {
    // los modelos de anime rinden peor con prosa y al reves, segun su doc
    expect(buildVaultImageInstruction([], 'tags')).toContain('Etiquetas cortas separadas por comas');
    expect(buildVaultImageInstruction([], 'prose')).toContain('Frases cortas separadas por comas');
    expect(buildVaultImageInstruction([], 'tags')).not.toContain('Frases cortas');
  });

  it('el negativo cubre la segunda persona y la camara', () => {
    // cinturon por si el modelo se despista: la instruccion lo ataca en el
    // origen, esto lo tapa en el generador
    for (const termino of ['2girls', 'multiple people', 'camera', 'selfie', 'holding phone']) {
      expect(VAULT_IMAGE_NEGATIVE).toContain(termino);
    }
  });

  it('una peticion de foto exige el bloque y una respuesta en personaje', () => {
    const instruction = buildVaultImageInstruction();
    expect(instruction).toContain('responde primero en personaje y despues escribe el bloque');
    expect(instruction).toContain('no alegues que no puedes adjuntar archivos');
    expect(instruction).toContain('no prometas enviarla sin incluirlo');
  });

  it('la descripcion es todo lo que sabe: no puede inventar lo que no ve', () => {
    // paso de verdad: el pie de foto decia «gata blanca con manchas marrones y
    // negras» y el modelo añadio ojos grandes y una oreja doblada, dandolos por
    // vistos. Inventar detalle es peor que decir que no puede ver la imagen,
    // porque suena a observacion
    const instruction = buildVaultImageInstruction([
      { mediaId: 'med-1', description: 'gata blanca con manchas marrones y negras' },
    ]);

    expect(instruction).toContain('TODO lo que sabes de cada imagen: NO las ves');
    expect(instruction).toContain('no añadas ningun detalle visual que no este escrito ahi');
    expect(instruction).toContain('preguntalo; no lo supongas');
  });

  it('la lista manda sobre la memoria, porque la memoria se contamina', () => {
    // paso de verdad, y es el mecanismo importante: el detalle inventado en un
    // turno («una oreja doblada») entro en la memoria acumulativa, volvio
    // marcado como hecho y en el turno siguiente genero mas —ojos amarillos,
    // la cola enroscada—. Una alucinacion que llega a la memoria se blanquea
    const instruction = buildVaultImageInstruction([
      { mediaId: 'med-1', description: 'gata blanca con manchas marrones y negras' },
    ]);

    expect(instruction).toContain('Esta lista MANDA sobre la memoria');
    expect(instruction).toContain('no lo des por visto');
    expect(instruction).toContain('La memoria recuerda lo que se');
  });

  it('sin imagenes que listar no se le advierte de nada', () => {
    // la advertencia acompaña a la lista: sin lista no hay nada que inventar y
    // solo seria ruido en el prompt
    expect(buildVaultImageInstruction()).not.toContain('NO las ves');
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
