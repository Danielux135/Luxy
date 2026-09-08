// pruebas de la cola de AI Horde camino de la pantalla.
//
// Lo que fijan es que una espera larga se pueda EXPLICAR. El fallo original no
// fue que la imagen no llegara: fue que diez minutos de espera no dejaron ni un
// dato con el que distinguir «estabas el 300º de la cola» de «ningun worker
// sirve tus modelos». Son dos averias y se arreglan distinto.
import { describe, it, expect } from 'vitest';
import {
  describeQueue,
  hordeQueueProgressSchema,
  worthReporting,
  type HordeQueueProgress,
} from './horde-progress.js';

const cola = (overrides: Partial<HordeQueueProgress> = {}): HordeQueueProgress => ({
  queuePosition: 0,
  waitTimeSeconds: 0,
  waiting: 0,
  processing: 0,
  finished: 0,
  ...overrides,
});

describe('que vale la pena registrar', () => {
  it('la primera vuelta siempre: dice desde donde se partia', () => {
    expect(worthReporting(null, cola({ queuePosition: 312 }))).toBe(true);
  });

  it('el mismo puesto otra vez, no', () => {
    // el sondeo da unas ochenta vueltas en diez minutos: registrarlas todas
    // llena el log de lineas identicas y esconde el momento en que avanza
    const previo = cola({ queuePosition: 312, waitTimeSeconds: 480 });
    expect(worthReporting(previo, cola({ queuePosition: 312, waitTimeSeconds: 470 }))).toBe(false);
  });

  it('avanzar en la cola, si', () => {
    const previo = cola({ queuePosition: 312 });
    expect(worthReporting(previo, cola({ queuePosition: 300 }))).toBe(true);
  });

  it('que alguien la empiece a dibujar, si aunque el puesto no cambie', () => {
    // es el hecho que dice que la espera se acabo, y puede pasar sin que el
    // puesto se mueva
    const previo = cola({ queuePosition: 0, waiting: 1 });
    expect(worthReporting(previo, cola({ queuePosition: 0, processing: 1 }))).toBe(true);
  });

  it('que termine, tambien', () => {
    expect(worthReporting(cola({ processing: 1 }), cola({ processing: 1, finished: 1 }))).toBe(true);
  });
});

describe('como se le cuenta la espera a una persona', () => {
  it('dibujandola manda sobre cualquier puesto', () => {
    // con un worker ya trabajando, el puesto en la cola es historia
    expect(describeQueue(cola({ processing: 1, queuePosition: 40 }))).toBe('Dibujándola…');
  });

  it('el puesto y los minutos van juntos', () => {
    // por separado no dicen nada: «puesto 312» no se sabe si es mucho, y
    // «420 s» no se sabe si va a bajar
    expect(describeQueue(cola({ queuePosition: 312, waitTimeSeconds: 420 }))).toBe(
      'En cola, puesto 312 · unos 7 min',
    );
  });

  it('menos de un minuto no se redondea a cero', () => {
    // «unos 0 min» se lee como que ya deberia estar
    expect(describeQueue(cola({ queuePosition: 3, waitTimeSeconds: 20 }))).toContain(
      'menos de un minuto',
    );
  });

  it('sin puesto ni estimacion no inventa numeros', () => {
    expect(describeQueue(cola())).toBe('En cola');
  });
});

describe('lo que se deja cruzar entre procesos', () => {
  it('acepta un progreso de contadores', () => {
    expect(hordeQueueProgressSchema.safeParse(cola({ queuePosition: 7 })).success).toBe(true);
  });

  it('rechaza un puesto negativo o decimal', () => {
    expect(hordeQueueProgressSchema.safeParse({ ...cola(), queuePosition: -1 }).success).toBe(false);
    expect(hordeQueueProgressSchema.safeParse({ ...cola(), queuePosition: 1.5 }).success).toBe(
      false,
    );
  });

  it('el esquema es CERRADO en su forma: solo contadores', () => {
    // la garantia que permite mandarlo al renderer sin tocar la premisa de la
    // boveda. Si algun dia el progreso del proveedor creciera con algo que no
    // sea un numero, esto no lo deja pasar por descuido
    const claves = Object.keys(hordeQueueProgressSchema.shape);
    expect(claves).toEqual([
      'queuePosition',
      'waitTimeSeconds',
      'waiting',
      'processing',
      'finished',
    ]);
    const salida = hordeQueueProgressSchema.parse({ ...cola(), prompt: 'una mujer desnuda' });
    expect(Object.keys(salida)).not.toContain('prompt');
  });
});
