// POR QUE EXISTE ESTE ARCHIVO: el tope de silencio no lo aplica Luxy con un
// reloj propio, lo aplica la pila HTTP que Node trae dentro. Eso significa que
// si el truco de configurarla deja de funcionar —otra version de Node, otro
// despachador global— no falla nada: las peticiones vuelven en silencio al tope
// de fabrica de 300 s, que es exactamente el que mato dos llamadas de pago el
// 2026-09-14. Solo una prueba que mida de verdad lo nota.
//
// El servidor es local (127.0.0.1, puerto efimero) y no habla con nadie: no hay
// API, ni red de salida, ni un solo token gastado.
import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import {
  isSilenceTimeout,
  silenceTransport,
  silenceTransportAvailable,
} from './http-dispatcher.js';

let servidor: Server | null = null;

afterEach(async () => {
  if (servidor === null) return;
  const abierto = servidor;
  servidor = null;
  await new Promise<void>((resolve) => abierto.close(() => resolve()));
});

/**
 * levanta un servidor que calla lo que se le pida antes de contestar.
 *
 * `silencioAntesDeCabeceras` imita al proveedor que tarda en decir la primera
 * palabra; `trozos` imita la respuesta larga que SI va llegando.
 */
async function servidorLento(opciones: {
  silencioAntesDeCabeceras: number;
  trozos?: { cuantos: number; cadaMs: number };
}): Promise<string> {
  const creado = createServer((_peticion, respuesta) => {
    setTimeout(() => {
      respuesta.writeHead(200, { 'Content-Type': 'text/plain' });
      const trozos = opciones.trozos ?? { cuantos: 0, cadaMs: 0 };
      let enviados = 0;
      if (trozos.cuantos === 0) {
        respuesta.end('listo');
        return;
      }
      const temporizador = setInterval(() => {
        enviados += 1;
        respuesta.write('.');
        if (enviados >= trozos.cuantos) {
          clearInterval(temporizador);
          respuesta.end();
        }
      }, trozos.cadaMs);
    }, opciones.silencioAntesDeCabeceras);
  });
  servidor = creado;
  await new Promise<void>((resolve) => creado.listen(0, '127.0.0.1', resolve));
  const direccion = creado.address();
  if (direccion === null || typeof direccion === 'string') throw new Error('sin puerto');
  return `http://127.0.0.1:${direccion.port}/`;
}

describe('tope de silencio de las peticiones al proveedor', () => {
  it('esta disponible en el Node con el que corre Luxy', () => {
    expect(silenceTransportAvailable()).toBe(true);
  });

  it('corta un proveedor que calla mas de lo permitido', async () => {
    // el servidor calla el doble de lo que se permite; el suelo del tope es de
    // un segundo, asi que el silencio tiene que pasar de ahi para medirse
    const url = await servidorLento({ silencioAntesDeCabeceras: 2_000 });

    const fallo = await fetch(url, silenceTransport(1_000)).then(
      () => null,
      (error: unknown) => error,
    );

    expect(fallo).not.toBeNull();
    // y el error tiene la forma que Luxy sabe reconocer: si esto cambia, el
    // silencio volveria a colarse como un fallo de red reintentable
    expect(isSilenceTimeout(fallo)).toBe(true);
  });

  it('deja vivir al mismo proveedor cuando el tope es mayor', async () => {
    const url = await servidorLento({ silencioAntesDeCabeceras: 600 });

    const respuesta = await fetch(url, silenceTransport(5_000));

    expect(respuesta.status).toBe(200);
    expect(await respuesta.text()).toBe('listo');
  });

  // LA DIFERENCIA QUE IMPORTA: es tiempo sin recibir NADA, no duracion. Una
  // respuesta larga que va llegando no puede morir por durar mucho, que es
  // justo lo que hace un tope total mal puesto.
  it('una respuesta que va llegando no muere aunque dure mas que el tope', async () => {
    const url = await servidorLento({
      silencioAntesDeCabeceras: 0,
      trozos: { cuantos: 8, cadaMs: 100 },
    });

    const inicio = Date.now();
    const respuesta = await fetch(url, silenceTransport(1_000));
    const cuerpo = await respuesta.text();

    expect(cuerpo).toBe('........');
    expect(Date.now() - inicio).toBeGreaterThan(600);
  });

  it('reutiliza el mismo despachador para el mismo tope', () => {
    const uno = silenceTransport(123_000);
    const otro = silenceTransport(123_000);
    expect(uno.dispatcher).toBeDefined();
    expect(uno.dispatcher).toBe(otro.dispatcher);
    expect(silenceTransport(456_000).dispatcher).not.toBe(uno.dispatcher);
  });
});
