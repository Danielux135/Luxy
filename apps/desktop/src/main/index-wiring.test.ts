// que el cierre automatico de la boveda siga enganchado en el arranque (`D-106`).
//
// `main/index.ts` carga Electron y ninguna prueba lo importa. El `setInterval`
// que cerraba la boveda vivia ahi, sin cubrir, y un verde en `tickAutoLock` era
// compatible con que el temporizador no existiera. Ahora vive en
// `VaultLockCoordinator`, que si se prueba; esto fija que index.ts lo use y que
// el temporizador no vuelva a esconderse aqui.
//
// Prueba ESTATICA sobre el texto, como `packaging.test.ts`: un cambio de formato
// puede darle un falso rojo, nunca un falso verde.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8');

describe('el arranque engancha el cierre de la boveda', () => {
  it('crea y arranca el coordinador con el powerMonitor de Electron', () => {
    expect(source).toContain('new VaultLockCoordinator(');
    expect(source).toContain('power: powerMonitor');
    expect(source).toContain('vaultLocks.start()');
  });

  it('cerrar la ventana y salir cierran la boveda', () => {
    expect(source).toContain('vaultLocks?.windowClosed()');
    expect(source).toContain("vault?.lock('salida')");
  });

  it('el temporizador se quita en el finally de la salida, no antes de los await', () => {
    const quit = source.slice(source.indexOf('async function quitCompletely'));
    const stopAt = quit.indexOf('vaultLocks?.stop()');
    expect(stopAt).toBeGreaterThan(quit.indexOf('} finally {'));
    expect(stopAt).toBeGreaterThan(quit.indexOf('await controller?.shutdown()'));
  });

  it('no queda ningun temporizador propio en index.ts', () => {
    expect(source).not.toContain('setInterval(');
    expect(source).not.toContain('tickAutoLock');
  });
});
