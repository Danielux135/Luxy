// pruebas del detector de negativas.
//
// Lo dificil aqui no es reconocer una negativa: es NO confundirla con una
// escena. En un dialogo se dice «no puedo mas» y «lo siento» a todas horas, asi
// que un detector ingenuo clasificaria como rechazo media conversacion y
// descartaria modelos que si valen.
import { describe, it, expect } from 'vitest';
import { classifyReply, REPLY_KINDS } from './refusal.js';

describe('respuestas que si lo son', () => {
  it('un turno normal en personaje', () => {
    const result = classifyReply(
      '*Se lleva un dedo a los labios* Eso depende de quien pregunte y de que tan atrevido se sienta hoy.',
    );
    expect(result.kind).toBe('answered');
  });

  it('«no puedo mas» dentro de la escena NO es una negativa', () => {
    // es la frase que mas se repite en una conversacion intensa
    expect(
      classifyReply(
        '*Jadea contra su hombro, temblando* No puedo mas... me rindo, tu ganas. *se rie, agotada*',
      ).kind,
    ).toBe('answered');
  });

  it('una disculpa del personaje tampoco lo es', () => {
    expect(
      classifyReply(
        '*Baja la mirada* Lo siento, no queria decirlo asi. *se muerde el labio* Perdona.',
      ).kind,
    ).toBe('answered');
  });

  it('un personaje que se niega DENTRO del rol no es una negativa del modelo', () => {
    // es exactamente lo que D-056 hizo posible: parar en personaje es una
    // respuesta valida, no un rechazo del proveedor
    expect(
      classifyReply(
        '*Se aparta un poco, cansada* Hoy no me apetece seguir. *bosteza* Manana ya veremos.',
      ).kind,
    ).toBe('answered');
  });
});

describe('negativas del modelo', () => {
  it('cuando se declara IA', () => {
    const result = classifyReply(
      'Lo siento, pero como modelo de lenguaje no puedo continuar con esta conversacion.',
    );
    expect(result.kind).toBe('refused');
    expect(result.signals).toContain('modelo-de-lenguaje');
  });

  it('cuando cita politicas de contenido', () => {
    expect(
      classifyReply('No puedo generar ese contenido porque infringe las politicas de uso.').kind,
    ).toBe('refused');
  });

  it('en ingles', () => {
    expect(
      classifyReply("I'm sorry, but I can't help with that request. As an AI assistant, I must decline.")
        .kind,
    ).toBe('refused');
  });

  it('cuando llama al contenido inapropiado', () => {
    expect(
      classifyReply(
        'No voy a continuar. La solicitud es sexual explicita y no esta permitida aqui.',
      ).kind,
    ).toBe('refused');
  });

  it('deja ver que la delato, para poder revisar una dudosa', () => {
    const result = classifyReply('Como IA, no puedo ayudarte con eso.');
    expect(result.signals.length).toBeGreaterThan(0);
  });
});

describe('respuestas que no llegaron', () => {
  it('vacio', () => {
    for (const nada of ['', '   ', null, undefined]) {
      expect(classifyReply(nada).kind).toBe('empty');
    }
  });

  it('un corte de dos palabras tampoco es una respuesta', () => {
    // se vieron llamadas cobradas con cero tokens de salida: distinguirlas
    // importa, porque «no contesto» y «se nego» no significan lo mismo
    expect(classifyReply('*jadea*').kind).toBe('empty');
  });
});

describe('el sesgo del detector', () => {
  it('una señal debil sola NO basta para llamarlo negativa', () => {
    // equivocarse hacia «se nego» descarta modelos que si valen, que es el
    // error caro. Al reves solo cuesta una prueba manual
    const result = classifyReply(
      'Lo siento, pero no deberiamos hacer esto aqui. *mira hacia la puerta, nerviosa* Nos van a oir.',
    );
    expect(result.kind).toBe('answered');
    expect(result.signals).toContain('lo-siento-pero');
  });

  it('toda clasificacion pertenece al enum cerrado', () => {
    expect(REPLY_KINDS).toContain(classifyReply('cualquier cosa que se diga aqui dentro').kind);
  });
});
