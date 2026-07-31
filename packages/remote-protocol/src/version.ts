// version del protocolo remoto.
//
// POR QUE SE VERSIONA DESDE EL PRIMER DIA: el escritorio y el movil se
// actualizan por separado y en momentos distintos. Un APK instalado hace tres
// meses va a hablar con un Luxy Desktop recien actualizado, y al reves. Sin
// version explicita eso se manifiesta como un fallo raro a mitad de sesion, en
// vez de como un mensaje claro antes de empezar.

/** version que habla esta compilacion */
export const PROTOCOL_VERSION = 1;

/**
 * version minima que esta compilacion todavia entiende.
 *
 * mientras sea igual a PROTOCOL_VERSION no hay compatibilidad hacia atras, que
 * es lo correcto antes de la primera version estable: es preferible rechazar
 * limpio a interpretar a medias.
 */
export const MIN_SUPPORTED_VERSION = 1;

export interface VersionCheck {
  ok: boolean;
  /** mensaje para el usuario, ya redactado; null si es compatible */
  reason: string | null;
  /** que extremo se ha quedado atras, para poder decir cual actualizar */
  outdated: 'local' | 'remote' | null;
}

/**
 * comprueba si se puede hablar con la otra punta.
 *
 * devuelve QUIEN esta desactualizado, no solo que no son compatibles: el
 * usuario necesita saber si actualiza el movil o el ordenador.
 */
export function checkVersion(remoteVersion: number): VersionCheck {
  if (!Number.isInteger(remoteVersion) || remoteVersion < 1) {
    return {
      ok: false,
      reason: 'la otra punta no declaro una version de protocolo valida',
      outdated: null,
    };
  }

  if (remoteVersion > PROTOCOL_VERSION) {
    return {
      ok: false,
      reason:
        `el otro dispositivo habla la version ${remoteVersion} y este entiende hasta la ` +
        `${PROTOCOL_VERSION}. Actualiza este dispositivo`,
      outdated: 'local',
    };
  }

  if (remoteVersion < MIN_SUPPORTED_VERSION) {
    return {
      ok: false,
      reason:
        `el otro dispositivo habla la version ${remoteVersion} y este necesita al menos la ` +
        `${MIN_SUPPORTED_VERSION}. Actualiza el otro dispositivo`,
      outdated: 'remote',
    };
  }

  return { ok: true, reason: null, outdated: null };
}
