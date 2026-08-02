// implementacion real de InputBackend: user32!SendInput a traves de koffi.
//
// ESTE ARCHIVO NO TIENE PRUEBAS AUTOMATICAS, Y ES DELIBERADO. Todo lo que se
// puede comprobar sin una pantalla delante esta en input-plan.ts, que si las
// tiene. Aqui solo queda copiar campos a memoria y llamar. Lo que hay que
// verificar a mano es una unica cosa: que la llamada llegue.
//
// POR QUE KOFFI Y NO UN ADDON NATIVO:
//
// koffi es MIT, esta activo, y sobre todo usa N-API 8, que es ABI ESTABLE. Un
// addon compilado contra los headers de Node tendria que recompilarse para el
// ABI 148 de Electron 43 y otra vez en cada actualizacion de Electron. Con N-API
// el mismo binario vale para las dos cosas.
//
// LO QUE ESTO NO PUEDE HACER, Y NO ES UN FALLO:
//   - No llega a ventanas ELEVADAS (UIPI). Falla en silencio: ver la nota de
//     abajo y describeElevatedBlock.
//   - No llega al escritorio seguro (UAC, pantalla de bloqueo, Ctrl+Alt+Supr).
//     Eso exige un servicio LOCAL_SYSTEM. Ver docs/adr/0005-host-windows.md.
import type { Modifier, MouseButton, SpecialKey } from '@luxy/remote-protocol';
import type { InputBackend, ForegroundWindowInfo } from './input-dispatcher.js';
import type { AbsolutePoint } from './monitors.js';
import {
  INPUT_KEYBOARD,
  INPUT_MOUSE,
  planButton,
  planKey,
  planMove,
  planScroll,
  planText,
  type InputPlan,
} from './input-plan.js';

/** lo que se necesita de koffi, tipado a mano para no depender de sus tipos */
interface KoffiLike {
  struct(name: string, fields: Record<string, unknown>): unknown;
  union(name: string, fields: Record<string, unknown>): unknown;
  pointer(type: unknown): unknown;
  sizeof(type: unknown): number;
  load(library: string): { func(...args: unknown[]): (...args: unknown[]) => unknown };
}

interface Union32 {
  SendInput(count: number, inputs: unknown[], size: number): number;
  GetForegroundWindow(): unknown;
  GetWindowTextW(handle: unknown, buffer: Uint8Array, max: number): number;
  GetWindowThreadProcessId(handle: unknown, pid: Uint32Array): number;
  OpenProcess(access: number, inherit: number, pid: number): unknown;
  OpenProcessToken(process: unknown, access: number, token: unknown[]): number;
  CloseHandle(handle: unknown): number;
}

/** constantes de winnt.h que se usan para el sondeo de elevacion */
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const TOKEN_QUERY = 0x0008;

let cargado: { user32: Union32; inputSize: number } | null = null;
let errorDeCarga: string | null = null;

/**
 * carga koffi y declara las funciones. Se hace una sola vez y en perezoso.
 *
 * Es perezoso a proposito: si koffi no cargara, Luxy tiene que seguir
 * arrancando y limitarse a decir que el control remoto no esta disponible. Un
 * fallo aqui no puede impedir que el usuario abra la aplicacion.
 */
async function cargar(): Promise<{ user32: Union32; inputSize: number }> {
  if (cargado !== null) return cargado;
  if (errorDeCarga !== null) throw new Error(errorDeCarga);

  try {
    const modulo = (await import('koffi')) as unknown as { default: KoffiLike };
    const koffi = modulo.default;

    // LA DISPOSICION EN MEMORIA IMPORTA. En x64 INPUT mide 40 bytes: 4 de tipo,
    // 4 de relleno por alineacion a 8, y 32 de union. koffi calcula el relleno
    // solo a partir de los tipos, por eso dwExtraInfo va como uintptr y no como
    // uint32: en 32 bits mide 4 y en 64 mide 8, y ponerlo fijo desalinearia
    // toda la estructura en una de las dos arquitecturas.
    const MOUSEINPUT = koffi.struct('LUXY_MOUSEINPUT', {
      dx: 'int32',
      dy: 'int32',
      mouseData: 'uint32',
      dwFlags: 'uint32',
      time: 'uint32',
      dwExtraInfo: 'uintptr',
    });
    const KEYBDINPUT = koffi.struct('LUXY_KEYBDINPUT', {
      wVk: 'uint16',
      wScan: 'uint16',
      dwFlags: 'uint32',
      time: 'uint32',
      dwExtraInfo: 'uintptr',
    });
    const HARDWAREINPUT = koffi.struct('LUXY_HARDWAREINPUT', {
      uMsg: 'uint32',
      wParamL: 'uint16',
      wParamH: 'uint16',
    });
    // el HARDWAREINPUT no se usa, pero tiene que estar: la union mide lo que su
    // miembro mayor, y omitir uno podria cambiar el tamano que se pasa en cbSize
    const INPUT_UNION = koffi.union('LUXY_INPUT_UNION', {
      mi: MOUSEINPUT,
      ki: KEYBDINPUT,
      hi: HARDWAREINPUT,
    });
    const INPUT = koffi.struct('LUXY_INPUT', { type: 'uint32', u: INPUT_UNION });

    const lib = koffi.load('user32.dll');
    const kernel = koffi.load('kernel32.dll');
    const advapi = koffi.load('advapi32.dll');

    const user32 = {
      SendInput: lib.func('SendInput', 'uint32', [
        'uint32',
        koffi.pointer(INPUT),
        'int32',
      ]) as Union32['SendInput'],
      GetForegroundWindow: lib.func('GetForegroundWindow', 'void *', []) as never,
      GetWindowTextW: lib.func('GetWindowTextW', 'int', [
        'void *',
        koffi.pointer('uint16'),
        'int',
      ]) as never,
      GetWindowThreadProcessId: lib.func('GetWindowThreadProcessId', 'uint32', [
        'void *',
        koffi.pointer('uint32'),
      ]) as never,
      OpenProcess: kernel.func('OpenProcess', 'void *', ['uint32', 'int', 'uint32']) as never,
      OpenProcessToken: advapi.func('OpenProcessToken', 'int', [
        'void *',
        'uint32',
        koffi.pointer('void *'),
      ]) as never,
      CloseHandle: kernel.func('CloseHandle', 'int', ['void *']) as never,
    } as unknown as Union32;

    cargado = { user32, inputSize: koffi.sizeof(INPUT) };
    return cargado;
  } catch (error) {
    errorDeCarga =
      'no se pudo cargar la capa de entrada nativa (koffi): ' +
      (error instanceof Error ? error.message : String(error));
    throw new Error(errorDeCarga);
  }
}

/** convierte el plan puro a la estructura que espera koffi */
function aEstructura(plan: InputPlan): Record<string, unknown> {
  if (plan.kind === 'mouse') {
    return {
      type: INPUT_MOUSE,
      u: {
        mi: {
          dx: plan.dx,
          dy: plan.dy,
          mouseData: plan.mouseData,
          dwFlags: plan.flags,
          // time a 0 = "ahora". Poner una marca propia hace que Windows
          // reordene los eventos si el reloj no coincide con el suyo.
          time: 0,
          dwExtraInfo: 0,
        },
      },
    };
  }

  return {
    type: INPUT_KEYBOARD,
    u: { ki: { wVk: plan.wVk, wScan: plan.wScan, dwFlags: plan.flags, time: 0, dwExtraInfo: 0 } },
  };
}

/**
 * backend real. Se construye con create(), que ya ha cargado koffi.
 *
 * Todos los metodos LANZAN si SendInput no acepta los eventos, y eso es
 * correcto: InputDispatcher lo captura y lo convierte en un resultado, que es
 * donde se decidio que se maneja el fallo.
 */
class KoffiInputBackend implements InputBackend {
  constructor(
    private readonly user32: Union32,
    private readonly inputSize: number,
  ) {}

  private enviar(plan: InputPlan[]): void {
    if (plan.length === 0) return;

    const estructuras = plan.map(aEstructura);
    const aceptados = this.user32.SendInput(estructuras.length, estructuras, this.inputSize);

    // OJO CON LO QUE SIGNIFICA ESTE CERO. Que SendInput acepte los eventos NO
    // quiere decir que lleguen: contra una ventana elevada devuelve exito y no
    // pasa nada (UIPI). Un cero aqui es otra cosa: la cola de entrada rechazo el
    // bloque, normalmente porque otro proceso la tiene bloqueada.
    if (aceptados !== estructuras.length) {
      throw new Error(
        `SendInput solo acepto ${aceptados} de ${estructuras.length} eventos; ` +
          'la cola de entrada de Windows rechazo el bloque',
      );
    }
  }

  moveTo(point: AbsolutePoint): void {
    this.enviar(planMove(point));
  }

  mouseButton(button: MouseButton, action: 'down' | 'up', point: AbsolutePoint | null): void {
    this.enviar(planButton(button, action, point));
  }

  scroll(point: AbsolutePoint, dx: number, dy: number): void {
    this.enviar(planScroll(point, dx, dy));
  }

  keyDown(key: SpecialKey | Modifier): void {
    this.enviar(planKey(key, 'down'));
  }

  keyUp(key: SpecialKey | Modifier): void {
    this.enviar(planKey(key, 'up'));
  }

  typeText(text: string): void {
    // por lotes: SendInput es atomica y un texto largo en una sola llamada
    // bloquea la cola de entrada del sistema mientras dura
    for (const lote of planText(text)) this.enviar(lote);
  }

  /**
   * quien tiene el foco y si esta elevada.
   *
   * HEURISTICA, y hay que saberlo: se intenta abrir el TOKEN del proceso en
   * primer plano. Un proceso de integridad media no puede abrir el token de uno
   * elevado, asi que el fallo de OpenProcessToken es la senal. No es una
   * comprobacion de elevacion de verdad -tambien falla con procesos protegidos
   * del sistema- pero para lo unico que se usa es para decidir si mostrar un
   * aviso, y en esos casos el aviso tambien es correcto: tampoco llegaria la
   * entrada.
   *
   * Si Luxy corriera elevado, no fallaria nada y no habria aviso, que es justo
   * lo que toca.
   */
  foregroundWindow(): ForegroundWindowInfo | null {
    try {
      const ventana = this.user32.GetForegroundWindow();
      if (ventana === null || ventana === 0) return null;

      const buffer = new Uint8Array(512);
      const largo = this.user32.GetWindowTextW(ventana, buffer, 256);
      const titulo =
        largo > 0
          ? String.fromCharCode(...new Uint16Array(buffer.buffer, 0, largo)).replace(/\0+$/, '')
          : '';

      const pid = new Uint32Array(1);
      this.user32.GetWindowThreadProcessId(ventana, pid);
      if (pid[0] === undefined || pid[0] === 0) return { title: titulo, elevated: false };

      const proceso = this.user32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid[0]);
      if (proceso === null || proceso === 0) return { title: titulo, elevated: true };

      try {
        const token: unknown[] = [null];
        const abierto = this.user32.OpenProcessToken(proceso, TOKEN_QUERY, token);
        if (abierto !== 0 && token[0] !== null && token[0] !== 0) {
          this.user32.CloseHandle(token[0]);
          return { title: titulo, elevated: false };
        }
        return { title: titulo, elevated: true };
      } finally {
        this.user32.CloseHandle(proceso);
      }
    } catch {
      // el sondeo es informativo: si falla, no se avisa de nada en vez de
      // inventarse que hay una ventana elevada
      return null;
    }
  }
}

export type KoffiBackend = InputBackend & { foregroundWindow(): ForegroundWindowInfo | null };

/**
 * construye el backend real, o explica por que no se pudo.
 *
 * Devuelve el motivo en vez de lanzar para que el llamante pueda seguir con una
 * sesion de SOLO VISUALIZACION: ver la pantalla sin poder tocarla sigue siendo
 * util, y es mejor que no poder conectar.
 */
export async function createKoffiInputBackend(): Promise<
  { ok: true; backend: KoffiBackend } | { ok: false; reason: string }
> {
  if (process.platform !== 'win32') {
    return { ok: false, reason: 'el control de entrada solo esta implementado en Windows' };
  }

  try {
    const { user32, inputSize } = await cargar();
    return { ok: true, backend: new KoffiInputBackend(user32, inputSize) };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}
