// pruebas del coordinador de cierre de la boveda (`D-106`).
//
// ORIGEN: Daniel dejo la boveda abierta hora y media con el ajuste en 15
// minutos y no se cerro. La pantalla se releia sola, leer contaba como
// actividad, y el `setInterval` que tenia que cerrarla vivia en `main/index.ts`,
// que ninguna prueba importa. Aqui corre el temporizador DE VERDAD —con relojes
// falsos— sobre una boveda real, y cada disparador nuevo tiene la suya.
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sealText } from '@luxy/vault-crypto';
import { VaultService } from './vault-service.js';
import { vaultFilePathFor } from './key-file.js';
import {
  LOCK_SCREEN_GRACE_MS,
  VAULT_TICK_MS,
  VaultLockCoordinator,
  type VaultPowerSource,
} from './vault-lock-coordinator.js';
import {
  VAULT_LOCK_REASONS,
  VAULT_UNLOCK_VIAS,
  type VaultLockReason,
} from '../../shared/vault-lock.js';

// inventada para la prueba; el centinela comprueba que no llega a ningun registro
const PASSWORD = 'contraseña-inventada-para-probar-7Qx';
const FAST = { t: 1, m: 8 * 1024, p: 1 } as const;

interface LogLine {
  message: string;
  fields: Record<string, unknown>;
}

describe('VaultLockCoordinator', () => {
  let directory: string;
  let vault: VaultService;
  let power: EventEmitter & VaultPowerSource;
  let logs: LogLine[];
  let notified: VaultLockReason[];
  let coordinator: VaultLockCoordinator;

  const build = (log?: (message: string, fields?: Record<string, unknown>) => void) =>
    new VaultLockCoordinator({
      vault,
      power,
      log:
        log ??
        ((message, fields = {}) => {
          logs.push({ message, fields });
        }),
      notifyRenderer: (reason) => notified.push(reason),
    });

  const lines = (message: string): LogLine[] => logs.filter((line) => line.message === message);

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'luxy-vault-lock-'));
    // solo el intervalo y el reloj: Argon2 y el cifrado tienen que correr de
    // verdad, y con todos los temporizadores falsos se quedarian esperando
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    vault = new VaultService(
      vaultFilePathFor(directory),
      { get: () => undefined, set: () => undefined, delete: () => undefined },
      { argon2Params: FAST },
    );
    power = new EventEmitter() as EventEmitter & VaultPowerSource;
    logs = [];
    notified = [];
    await vault.create(PASSWORD);
    vault.setAutoLockMinutes(1);
    coordinator = build();
    coordinator.start();
  });

  afterEach(() => {
    coordinator.stop();
    vi.useRealTimers();
    rmSync(directory, { recursive: true, force: true });
  });

  it('el temporizador real cierra por inactividad', () => {
    vi.advanceTimersByTime(45_000);
    expect(vault.isUnlocked()).toBe(true);
    vi.advanceTimersByTime(30_000);
    expect(vault.isUnlocked()).toBe(false);
    expect(lines('boveda cerrada')).toHaveLength(1);
    expect(lines('boveda cerrada')[0]!.fields).toMatchObject({ motivo: 'inactividad' });
    expect(notified).toEqual(['inactividad']);
  });

  it('comprueba cada 15 segundos', () => {
    expect(VAULT_TICK_MS).toBe(15_000);
  });

  it('leer sin nadie delante no la mantiene abierta: el bucle de la pantalla ya no la salva', () => {
    // lo que hacia la foto del personaje cada 5 s: derivar una subclave
    const reader = setInterval(() => {
      if (vault.isUnlocked()) vault.subkeyFor('identity', 'characters');
    }, 5_000);
    vi.advanceTimersByTime(75_000);
    clearInterval(reader);
    expect(vault.isUnlocked()).toBe(false);
    // y la linea de cierre lo delata: hubo lecturas sin nadie delante
    const derivaciones = lines('boveda cerrada')[0]!.fields['derivaciones'];
    expect(typeof derivaciones).toBe('number');
    expect(derivaciones as number).toBeGreaterThan(10);
  });

  it('la presencia si la mantiene abierta', () => {
    for (let i = 0; i < 10; i += 1) {
      vi.advanceTimersByTime(30_000);
      vault.touch();
    }
    expect(vault.isUnlocked()).toBe(true);
  });

  it('bloquear Windows sin nada en camino cierra en el acto', () => {
    power.emit('lock-screen');
    expect(vault.isUnlocked()).toBe(false);
    expect(lines('boveda cerrada')[0]!.fields).toMatchObject({ motivo: 'pantalla-bloqueada' });
    expect(notified).toEqual(['pantalla-bloqueada']);
  });

  it('suspender cierra aunque haya un envio en curso', () => {
    vault.beginUserWait('reply');
    power.emit('suspend');
    expect(vault.isUnlocked()).toBe(false);
    expect(notified).toEqual(['suspension']);
  });

  it('bloquear Windows con un envio en curso espera a que se guarde la respuesta', () => {
    const release = vault.beginUserWait('reply');
    power.emit('lock-screen');
    expect(vault.isUnlocked()).toBe(true);
    expect(lines('cierre de la boveda aplazado')[0]!.fields).toEqual({
      motivo: 'pantalla-bloqueada',
      envios: 1,
    });

    vi.advanceTimersByTime(60_000);
    expect(vault.isUnlocked()).toBe(true);

    release();
    vi.advanceTimersByTime(VAULT_TICK_MS);
    expect(vault.isUnlocked()).toBe(false);
    const cierre = lines('boveda cerrada')[0]!.fields;
    expect(cierre['motivo']).toBe('pantalla-bloqueada');
    expect(typeof cierre['aplazadoMs']).toBe('number');
  });

  it('bloquear Windows mientras se genera o aprueba una imagen cierra en el acto', () => {
    // solo un envio aplaza el cierre: el tope se midio sobre turnos privados, y
    // una imagen del Horde no deja la llave en memoria con Windows bloqueado
    vault.beginUserWait('image');
    power.emit('lock-screen');
    expect(vault.isUnlocked()).toBe(false);
    expect(lines('cierre de la boveda aplazado')).toHaveLength(0);
    expect(notified).toEqual(['pantalla-bloqueada']);
  });

  it('con un envio y una imagen a la vez, el aplazamiento solo cuenta el envio', () => {
    const release = vault.beginUserWait('reply');
    vault.beginUserWait('image');
    power.emit('lock-screen');
    expect(lines('cierre de la boveda aplazado')[0]!.fields).toEqual({
      motivo: 'pantalla-bloqueada',
      envios: 1,
    });
    // la imagen sigue en marcha, pero en cuanto llega la respuesta se cierra
    release();
    vi.advanceTimersByTime(VAULT_TICK_MS);
    expect(vault.isUnlocked()).toBe(false);
  });

  it('volver antes anula el cierre aplazado', () => {
    vault.setAutoLockMinutes(15);
    const release = vault.beginUserWait('reply');
    power.emit('lock-screen');
    vi.advanceTimersByTime(30_000);
    power.emit('unlock-screen');
    expect(lines('cierre de la boveda anulado')).toHaveLength(1);
    expect(lines('cierre de la boveda anulado')[0]!.fields['motivo']).toBe('pantalla-bloqueada');

    release();
    vi.advanceTimersByTime(60_000);
    expect(vault.isUnlocked()).toBe(true);
  });

  it('el aplazamiento tiene tope aunque la espera no se suelte nunca', () => {
    vault.beginUserWait('reply');
    power.emit('lock-screen');
    vi.advanceTimersByTime(LOCK_SCREEN_GRACE_MS - VAULT_TICK_MS);
    expect(vault.isUnlocked()).toBe(true);
    vi.advanceTimersByTime(2 * VAULT_TICK_MS);
    expect(vault.isUnlocked()).toBe(false);
  });

  it('cerrar la ventana cierra la boveda, aunque haya un envio', () => {
    vault.beginUserWait('reply');
    coordinator.windowClosed();
    expect(vault.isUnlocked()).toBe(false);
    expect(notified).toEqual(['ventana-cerrada']);
  });

  it('con «No cerrarla sola» Win+L, suspender y la X siguen cerrando', async () => {
    vault.setAutoLockMinutes(0);
    vi.advanceTimersByTime(60 * 60_000);
    expect(vault.isUnlocked()).toBe(true);
    power.emit('lock-screen');
    expect(vault.isUnlocked()).toBe(false);

    await vault.unlock(PASSWORD);
    power.emit('suspend');
    expect(vault.isUnlocked()).toBe(false);

    await vault.unlock(PASSWORD);
    coordinator.windowClosed();
    expect(vault.isUnlocked()).toBe(false);
  });

  it('abrir deja una linea con la puerta y cerrar otra con el motivo', async () => {
    vault.lock('manual');
    await vault.unlock(PASSWORD);
    expect(lines('boveda abierta').at(-1)!.fields).toEqual({ via: 'password' });
    vi.advanceTimersByTime(3_000);
    vault.lock('manual');
    expect(lines('boveda cerrada').at(-1)!.fields).toEqual({
      motivo: 'manual',
      abiertaMs: 3_000,
      derivaciones: 0,
    });
  });

  it('cerrar lo ya cerrado no deja una linea doble', () => {
    vault.lock('salida');
    vault.lock('salida');
    expect(lines('boveda cerrada')).toHaveLength(1);
    expect(notified).toEqual(['salida']);
  });

  it('centinela: ningun registro lleva la contraseña ni el contenido', async () => {
    const sobre = await sealText(vault.subkeyFor('media'), 'prueba', 'TEXTO_TESTIGO');
    expect(JSON.stringify(sobre)).not.toContain('TEXTO_TESTIGO');
    const motivos: VaultLockReason[] = [...VAULT_LOCK_REASONS];
    for (const motivo of motivos) {
      if (!vault.isUnlocked()) await vault.unlock(PASSWORD);
      vault.subkeyFor('media');
      vault.lock(motivo);
    }
    power.emit('lock-screen');

    const volcado = JSON.stringify(logs);
    expect(volcado).not.toContain(PASSWORD);
    expect(volcado).not.toContain('TEXTO_TESTIGO');
    const permitidos = new Set<string>([...VAULT_LOCK_REASONS, ...VAULT_UNLOCK_VIAS]);
    for (const line of logs) {
      for (const value of Object.values(line.fields)) {
        const ok =
          typeof value === 'number' ||
          typeof value === 'boolean' ||
          value === null ||
          (typeof value === 'string' && permitidos.has(value));
        expect(ok, `${line.message}: ${String(value)}`).toBe(true);
      }
    }
    expect(lines('boveda cerrada')).toHaveLength(VAULT_LOCK_REASONS.length);
  });

  it('un registro que lanza no mata el temporizador', () => {
    coordinator.stop();
    let calls = 0;
    coordinator = build(() => {
      calls += 1;
      if (calls === 1) throw new Error('disco lleno');
    });
    coordinator.start();
    // la primera linea —el cierre— lanza; la pantalla se entera igual
    vi.advanceTimersByTime(75_000);
    expect(vault.isUnlocked()).toBe(false);
    expect(notified).toEqual(['inactividad']);
  });

  it('una vuelta que falla no mata el temporizador: la siguiente cierra', () => {
    const tick = vi.spyOn(vault, 'tickAutoLock').mockImplementationOnce(() => {
      throw new Error('archivo de llaves ilegible');
    });
    vi.advanceTimersByTime(75_000);
    expect(tick).toHaveBeenCalledTimes(5);
    expect(vault.isUnlocked()).toBe(false);
    // se registra el tipo del fallo, nunca su mensaje
    const fallo = lines('fallo en el cierre automatico de la boveda');
    expect(fallo).toHaveLength(1);
    expect(fallo[0]!.fields).toEqual({ tipo: 'Error' });
  });

  it('un aviso a la pantalla que lanza no deja sin cerrar ni sin registrar', () => {
    coordinator.stop();
    coordinator = new VaultLockCoordinator({
      vault,
      power,
      log: (message, fields = {}) => logs.push({ message, fields }),
      notifyRenderer: () => {
        throw new Error('ventana destruida');
      },
    });
    coordinator.start();
    vi.advanceTimersByTime(75_000);
    expect(vault.isUnlocked()).toBe(false);
    expect(lines('boveda cerrada')).toHaveLength(1);
  });

  it('stop quita el temporizador y los oyentes', () => {
    coordinator.stop();
    power.emit('lock-screen');
    expect(vault.isUnlocked()).toBe(true);
    vi.advanceTimersByTime(10 * 60_000);
    expect(vault.isUnlocked()).toBe(true);
    expect(power.listenerCount('lock-screen')).toBe(0);
    expect(power.listenerCount('suspend')).toBe(0);
  });
});
