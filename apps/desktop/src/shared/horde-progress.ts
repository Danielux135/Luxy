// como va la cola de AI Horde, camino de la pantalla.
//
// POR QUE EXISTE: generar una imagen en el horde puede tardar diez minutos, y
// durante esos diez minutos la ventana no decia absolutamente nada. Al final
// salia «la imagen no estuvo lista a tiempo», que no distingue «estabas el 300º
// de la cola» de «ningun worker sirve tus modelos». Son dos averias distintas y
// se arreglan distinto: una es esperar o conseguir kudos, la otra cambiar de
// modelo.
//
// El dato existia todo el tiempo. `pollImage` calcula el progreso en CADA
// vuelta —unas ochenta en diez minutos, porque el sondeo se espacia hasta 8 s—
// y lo tiraba entero.
//
// QUE PUEDE CRUZAR: solo numeros y booleanos. Ni el prompt, ni la imagen, ni el
// personaje. Por eso este progreso puede llegar al renderer sin tocar la
// premisa de la boveda, y por eso el tipo de aqui es CERRADO: si algun dia el
// progreso del proveedor creciera con algo que no sea un contador, esto no lo
// deja pasar por descuido.
//
// Modulo PURO: sin Electron y sin red.
import { z } from 'zod';

/**
 * lo que la pantalla necesita saber de la cola.
 *
 * El esquema es la unica definicion, y el tipo se deriva de el: escribir los
 * dos a mano es como se separan. `int()` y `min(0)` no son ceremonia — el
 * proveedor devuelve numeros suyos y esto es la frontera entre procesos.
 */
export const hordeQueueProgressSchema = z.object({
  /** puesto en la cola. 0 cuando ya no espera */
  queuePosition: z.number().int().min(0),
  /** lo que el propio horde estima que falta */
  waitTimeSeconds: z.number().int().min(0),
  /** peticiones tuyas esperando a que alguien las coja */
  waiting: z.number().int().min(0),
  /** peticiones tuyas que un worker ya esta dibujando */
  processing: z.number().int().min(0),
  finished: z.number().int().min(0),
});

export type HordeQueueProgress = z.infer<typeof hordeQueueProgressSchema>;

/**
 * si este progreso merece dejar rastro, comparado con el anterior.
 *
 * El sondeo da unas ochenta vueltas en diez minutos. Registrarlas todas llena
 * el log de lineas identicas y esconde justo lo que se busca: el momento en que
 * la peticion avanza. Solo se anota cuando cambia el puesto en la cola o cuando
 * alguien la empieza a dibujar, que son los dos hechos que explican una espera.
 *
 * `null` como anterior significa la primera vuelta: esa siempre se anota,
 * porque dice desde donde se partia.
 */
export function worthReporting(
  previous: HordeQueueProgress | null,
  next: HordeQueueProgress,
): boolean {
  if (previous === null) return true;
  if (previous.queuePosition !== next.queuePosition) return true;
  // el salto de «esperando» a «dibujando» es el que dice que la espera se
  // acabo, y puede pasar sin que el puesto cambie
  if (previous.processing !== next.processing) return true;
  return previous.finished !== next.finished;
}

/**
 * la espera, dicha para una persona.
 *
 * El horde devuelve segundos y un puesto. Los dos a la vez sobran en pantalla y
 * por separado no dicen nada: «puesto 312» no se sabe si es mucho, y «420 s» no
 * se sabe si va a bajar.
 */
export function describeQueue(progress: HordeQueueProgress): string {
  if (progress.processing > 0) return 'Dibujándola…';
  const minutos = Math.round(progress.waitTimeSeconds / 60);
  const espera =
    progress.waitTimeSeconds <= 0
      ? ''
      : minutos < 1
        ? ` · menos de un minuto`
        : ` · unos ${minutos} min`;
  if (progress.queuePosition <= 0) return `En cola${espera}`;
  return `En cola, puesto ${progress.queuePosition}${espera}`;
}
