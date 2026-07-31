// cliente del gateway para el control remoto, desde el proceso principal.
//
// POR QUE VIVE EN EL MAIN Y NO EN EL RENDERER: aqui esta la clave privada. El
// renderer NUNCA la ve ni la puede pedir; solo recibe el texto del QR ya hecho y
// las palabras de confirmacion. Si la firma ocurriera en el renderer, cualquier
// fallo de aislamiento de contexto expondria la identidad del ordenador.
import { randomUUID } from 'node:crypto';
import {
  signRequest,
  hashBody,
  buildQrPayload,
  confirmationWords,
  fromBase64Url,
  toBase64Url,
  type PublicKey,
} from '@luxy/remote-crypto';
import type { Capability } from '@luxy/remote-protocol';
import type { RemoteIdentityStore } from './remote-identity.js';

export interface RemoteClientOptions {
  gatewayUrl: string;
  identity: RemoteIdentityStore;
  machineName: string;
  /** inyectable para poder probar sin red */
  fetchImpl?: typeof fetch;
}

export class RemoteClientError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = 'RemoteClientError';
  }
}

export interface PairingInvitation {
  code: string;
  qrPayload: string;
  expiresAt: number;
  hostDeviceId: string;
}

export interface PairingProgress {
  state: 'waiting' | 'claimed' | 'confirmed' | 'rejected' | 'expired';
  /** palabras que hay que comparar con la pantalla del movil */
  words: string[] | null;
  claimantName: string | null;
  deviceId: string | null;
}

export class RemoteClient {
  private readonly fetchImpl: typeof fetch;
  private hostDeviceId: string | null = null;

  constructor(private readonly options: RemoteClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /** id que el gateway asigno a este ordenador; null hasta el primer emparejamiento */
  currentHostDeviceId(): string | null {
    return this.hostDeviceId;
  }

  // ---------------------------------------------------------------------------
  // emparejamiento
  // ---------------------------------------------------------------------------

  /**
   * abre una invitacion de emparejamiento y devuelve el QR listo para pintar.
   *
   * NO lleva firma de dispositivo: el ordenador puede no estar registrado
   * todavia. La proteccion del paso es el codigo, que caduca en tres minutos y
   * es de un solo uso.
   */
  async startPairing(): Promise<PairingInvitation> {
    const respuesta = await this.call('POST', '/api/remote/pair/start', {
      hostPublicKey: this.options.identity.publicKeyBase64(),
      hostName: this.options.machineName,
    });

    const datos = respuesta as { code: string; expiresAt: number; hostDeviceId: string };
    this.hostDeviceId = datos.hostDeviceId;

    return {
      code: datos.code,
      expiresAt: datos.expiresAt,
      hostDeviceId: datos.hostDeviceId,
      qrPayload: buildQrPayload({
        gatewayUrl: this.options.gatewayUrl,
        code: datos.code,
        desktopPublicKey: this.options.identity.publicKey(),
        desktopName: this.options.machineName,
        ttlMs: datos.expiresAt - Date.now(),
      }),
    };
  }

  /**
   * consulta como va el emparejamiento.
   *
   * Las palabras se calculan AQUI, en local, a partir de las dos claves
   * publicas. No se piden al gateway a proposito: si el gateway las dictara,
   * podria enviar las mismas a los dos lados tras haber sustituido una clave, y
   * la confirmacion del usuario no valdria de nada.
   */
  async pairingProgress(code: string): Promise<PairingProgress> {
    const respuesta = (await this.call('GET', `/api/remote/pair/${code}/state`, null)) as {
      state: PairingProgress['state'];
      claimantPublicKey: string | null;
      claimantName: string | null;
      deviceId: string | null;
    };

    let words: string[] | null = null;
    if (respuesta.claimantPublicKey !== null) {
      let clave: PublicKey;
      try {
        clave = fromBase64Url(respuesta.claimantPublicKey);
      } catch {
        throw new RemoteClientError('la clave del movil no es valida', 'bad_key');
      }
      words = confirmationWords(this.options.identity.publicKey(), clave);
    }

    return {
      state: respuesta.state,
      words,
      claimantName: respuesta.claimantName,
      deviceId: respuesta.deviceId,
    };
  }

  /** confirma o rechaza desde el lado del ordenador */
  async confirmPairing(code: string, accepted: boolean): Promise<{ paired: boolean }> {
    const respuesta = (await this.call('POST', '/api/remote/pair/confirm', {
      code,
      side: 'host',
      accepted,
    })) as { paired: boolean; deviceId?: string };

    return { paired: respuesta.paired };
  }

  // ---------------------------------------------------------------------------
  // dispositivos (peticiones firmadas)
  // ---------------------------------------------------------------------------

  async listDevices(): Promise<unknown> {
    return this.callSigned('GET', '/api/remote/devices', null);
  }

  async setAccess(
    deviceId: string,
    values: { permissions?: Capability[]; unattended?: boolean; requireBiometrics?: boolean },
  ): Promise<unknown> {
    return this.callSigned('POST', `/api/remote/devices/${deviceId}/access`, values);
  }

  async revokeDevice(deviceId: string): Promise<unknown> {
    return this.callSigned('POST', `/api/remote/devices/${deviceId}/revoke`, null);
  }

  // ---------------------------------------------------------------------------
  // transporte
  // ---------------------------------------------------------------------------

  private async call(method: string, path: string, body: unknown): Promise<unknown> {
    return this.send(method, path, body, {});
  }

  /**
   * peticion firmada con la clave privada del ordenador.
   *
   * El nonce es un UUID aleatorio por peticion: reutilizarlo haria que el
   * gateway rechazara la segunda como replay, que es exactamente lo que debe
   * pasar si alguien reenvia una capturada.
   */
  private async callSigned(method: string, path: string, body: unknown): Promise<unknown> {
    if (this.hostDeviceId === null) {
      throw new RemoteClientError(
        'este ordenador todavia no esta registrado en el gateway',
        'not_registered',
      );
    }

    const texto = body === null ? '' : JSON.stringify(body);
    const headers = signRequest({
      privateKey: this.options.identity.privateKey(),
      deviceId: this.hostDeviceId,
      method,
      path,
      bodyHash: await hashBody(texto),
      nonce: randomUUID(),
    });

    return this.send(method, path, body, {
      'x-luxy-device': headers.deviceId,
      'x-luxy-timestamp': String(headers.timestamp),
      'x-luxy-nonce': headers.nonce,
      'x-luxy-signature': headers.signature,
    });
  }

  private async send(
    method: string,
    path: string,
    body: unknown,
    extraHeaders: Record<string, string>,
  ): Promise<unknown> {
    const url = `${this.options.gatewayUrl.replace(/\/+$/, '')}${path}`;
    const respuesta = await this.fetchImpl(url, {
      method,
      headers: { 'content-type': 'application/json', ...extraHeaders },
      ...(body === null ? {} : { body: JSON.stringify(body) }),
    });

    const texto = await respuesta.text();
    let datos: unknown = null;
    if (texto.length > 0) {
      try {
        datos = JSON.parse(texto);
      } catch {
        throw new RemoteClientError(
          `el gateway respondio algo que no es JSON (${respuesta.status})`,
          'bad_response',
          respuesta.status,
        );
      }
    }

    if (!respuesta.ok) {
      const error = (datos as { error?: { code?: string; detail?: string } })?.error;
      throw new RemoteClientError(
        error?.detail ?? `el gateway respondio ${respuesta.status}`,
        error?.code ?? 'http_error',
        respuesta.status,
      );
    }

    return datos;
  }

  /** deja constancia del id del ordenador tras cargar la identidad */
  adoptHostDeviceId(id: string | null): void {
    this.hostDeviceId = id;
  }
}

/** palabras que este ordenador mostraria frente a una clave concreta */
export function wordsAgainst(identity: RemoteIdentityStore, peerPublicKey: string): string[] {
  return confirmationWords(identity.publicKey(), fromBase64Url(peerPublicKey));
}

/** solo para diagnostico: nunca sale del proceso principal */
export function describeIdentity(identity: RemoteIdentityStore): {
  publicKey: string;
  fingerprint: string;
} {
  return {
    publicKey: toBase64Url(identity.publicKey()),
    fingerprint: identity.fingerprint(),
  };
}
