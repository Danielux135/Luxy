// preload de la ventana OCULTA de captura.
//
// Es aparte del preload de la interfaz y expone otra cosa: la interfaz no puede
// tocar el motor de captura y el motor de captura no puede tocar la
// configuracion ni los secretos. Si compartieran preload, comprometer cualquiera
// de las dos ventanas daria acceso a la superficie de la otra.
//
// Como el de la interfaz, corre con sandbox:true: solo contextBridge e
// ipcRenderer. Nada de zod aqui (ver shared/channels.ts).
import { contextBridge, ipcRenderer } from 'electron';
import { CAPTURE_CHANNEL } from '../shared/channels.js';

/** lo unico que la ventana oculta puede hacer con el main */
export interface CaptureBridge {
  /** se suscribe a las ordenes del main; devuelve la funcion para darse de baja */
  onCommand(handler: (message: unknown) => void): () => void;
  /** manda un mensaje al main; el main lo valida antes de mirarlo */
  send(message: unknown): void;
}

const bridge: CaptureBridge = {
  onCommand: (handler) => {
    // el evento de ipcRenderer se descarta y solo se pasa el payload: si se
    // pasara entero, el renderer tendria acceso a event.sender y con el a otros
    // canales del main
    const escucha = (_event: unknown, payload: unknown): void => handler(payload);
    ipcRenderer.on(CAPTURE_CHANNEL.toCapture, escucha);
    return () => ipcRenderer.removeListener(CAPTURE_CHANNEL.toCapture, escucha);
  },
  send: (message) => ipcRenderer.send(CAPTURE_CHANNEL.fromCapture, message),
};

contextBridge.exposeInMainWorld('luxyCapture', bridge);
