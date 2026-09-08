// pruebas del logger, y sobre todo de que dos logs puedan compartir carpeta.
//
// POR QUE EXISTE: el proceso principal de Studio no escribia en ningun sitio
// —era un `console.log` bajo `isDev`, y electron.exe no hereda consola— y todo
// el camino de imagenes de la boveda vive alli. Costo dos diagnosticos
// equivocados seguidos.
//
// Darle su propio archivo obligaba a parametrizar el nombre base, y ahi estaba
// la trampa: el nombre aparecia en TRES sitios que tenian que moverse juntos
// —el archivo, el nombre al rotar y el patron de limpieza— y ese ultimo BORRA.
// Cambiar solo el primero habria dejado a un logger llevandose por delante los
// archivos rotados del otro.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentLogger } from './logger.js';

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'luxy-log-'));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe('donde escribe cada logger', () => {
  it('por defecto es el del agente, que siempre se ha llamado asi', () => {
    new AgentLogger('info', directory, false).info('hola');
    expect(readdirSync(directory)).toContain('luxy.log');
  });

  it('con otro nombre base escribe en su propio archivo', () => {
    new AgentLogger('info', directory, false, 'studio').info('hola');
    const archivos = readdirSync(directory);
    expect(archivos).toContain('studio.log');
    expect(archivos).not.toContain('luxy.log');
  });

  it('los dos conviven en la misma carpeta sin pisarse', () => {
    new AgentLogger('info', directory, false).info('del agente');
    new AgentLogger('info', directory, false, 'studio').info('de studio');

    expect(readFileSync(join(directory, 'luxy.log'), 'utf8')).toContain('del agente');
    expect(readFileSync(join(directory, 'luxy.log'), 'utf8')).not.toContain('de studio');
    expect(readFileSync(join(directory, 'studio.log'), 'utf8')).toContain('de studio');
  });
});

describe('la limpieza de rotados solo toca los suyos', () => {
  // LA PRUEBA QUE IMPORTA. La limpieza filtra por patron y despues BORRA: si el
  // patron no derivara del nombre base, el logger de Studio se llevaria por
  // delante el historial del agente, que es justo donde se mira cuando algo
  // falla.
  it('un logger no borra los rotados de otro al rotar', () => {
    // seis rotados del agente: mas de los cinco que se conservan, asi que si
    // Studio los mirase, borraria alguno
    for (let i = 0; i < 6; i += 1) {
      writeFileSync(join(directory, `luxy-2026-09-0${i}.log`), 'historial del agente');
    }
    // y uno de Studio, para que su limpieza tenga algo que hacer
    writeFileSync(join(directory, 'studio-2026-09-01.log'), 'historial de studio');

    // se fuerza la rotacion de Studio con un archivo mas grande que el tope
    const studio = new AgentLogger('info', directory, false, 'studio');
    writeFileSync(join(directory, 'studio.log'), 'x'.repeat(6 * 1024 * 1024));
    studio.info('esto rota');

    const restantes = readdirSync(directory);
    for (let i = 0; i < 6; i += 1) {
      expect(restantes).toContain(`luxy-2026-09-0${i}.log`);
    }
  });

  it('el nombre base se escapa antes de meterlo en la expresion regular', () => {
    // un punto en el nombre casaria con cualquier caracter y podria alcanzar
    // los rotados de otro log
    writeFileSync(join(directory, 'luxy-2026-09-01.log'), 'del agente');
    const raro = new AgentLogger('info', directory, false, 'a.b');
    writeFileSync(join(directory, 'a.b.log'), 'x'.repeat(6 * 1024 * 1024));
    raro.info('esto rota');

    expect(readdirSync(directory)).toContain('luxy-2026-09-01.log');
  });
});

describe('lo que se escribe', () => {
  it('es JSON de una linea, con nivel y marca de tiempo', () => {
    new AgentLogger('info', directory, false).info('turno privado', { puedeGenerar: true });
    const linea = readFileSync(join(directory, 'luxy.log'), 'utf8').trim().split(/\r?\n/)[0] ?? '';
    const objeto = JSON.parse(linea) as Record<string, unknown>;
    expect(objeto['msg']).toBe('turno privado');
    expect(objeto['level']).toBe('info');
    expect(objeto['puedeGenerar']).toBe(true);
    expect(typeof objeto['ts']).toBe('string');
  });

  it('por debajo del nivel minimo no se escribe nada', () => {
    new AgentLogger('warn', directory, false).info('esto no interesa');
    expect(readdirSync(directory)).not.toContain('luxy.log');
  });
});
