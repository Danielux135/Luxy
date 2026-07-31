// coordinador del emparejamiento en el escritorio.
//
// LA PIEZA QUE CIERRA EL MODELO DE AMENAZAS.
//
// Todo el diseno parte de que el gateway NO es de fiar. Pero mientras el
// escritorio no guardara localmente las claves publicas de sus pares, la unica
// fuente sobre "con quien estoy emparejado" era justo el gateway: aunque el
// emparejamiento se firme y se confirme bien, despues un gateway comprometido
// podia afirmar dispositivos que el ordenador no tenia forma de contrastar.
//
// Aqui se ANCLA la clave del movil en disco en el momento de confirmar, y a
// partir de entonces la lista del gateway se contrasta contra la local.
import { randomUUID } from 'node:crypto';
import { fingerprint, fromBase64Url, canonicalPublicKey } from '@luxy/remote-crypto';
import type { RemoteIdentityStore, PairedDevice } from './remote-identity.js';
import type { RemoteClient, PairingProgress } from './remote-client.js';

export class PairingError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'PairingError';
  }
}

export interface PairingInvitationView {
  code: string;
  qrPayload: string;
  expiresAt: number;
}

export interface PairingPendingView {
  state: PairingProgress['state'];
  /** palabras que el usuario debe comparar con la pantalla del movil */
  words: string[] | null;
  claimantName: string | null;
  /** true cuando ya se puede pulsar "confirmar" */
  readyToConfirm: boolean;
}

export class PairingCoordinator {
  private codigoActivo: string | null = null;
  private claveDelMovil: string | null = null;

  constructor(
    private readonly client: RemoteClient,
    private readonly identity: RemoteIdentityStore,
  ) {}

  /** abre una invitacion nueva y devuelve lo que hay que pintar */
  async invite(): Promise<PairingInvitationView> {
    const invitacion = await this.client.startPairing();
    this.codigoActivo = invitacion.code;
    this.claveDelMovil = null;

    return {
      code: invitacion.code,
      qrPayload: invitacion.qrPayload,
      expiresAt: invitacion.expiresAt,
    };
  }

  /** consulta el estado; guarda la clave del movil para poder firmar despues */
  async poll(): Promise<PairingPendingView> {
    if (this.codigoActivo === null) {
      throw new PairingError('no hay ningun emparejamiento en curso', 'no_pairing');
    }

    const progreso = await this.client.pairingProgress(this.codigoActivo);
    this.claveDelMovil = progreso.claimantPublicKey;

    return {
      state: progreso.state,
      words: progreso.words,
      claimantName: progreso.claimantName,
      readyToConfirm: progreso.state === 'claimed' && progreso.words !== null,
    };
  }

  /**
   * confirma desde el ordenador y ANCLA la clave del movil en disco.
   *
   * El orden importa: primero se confirma contra el gateway (que puede fallar) y
   * solo despues se guarda en local. Al reves quedaria un dispositivo anclado
   * localmente que el gateway no reconoce, y el usuario lo veria en su lista sin
   * poder conectarse nunca.
   */
  async confirm(accepted: boolean): Promise<{ paired: boolean; device: PairedDevice | null }> {
    if (this.codigoActivo === null) {
      throw new PairingError('no hay ningun emparejamiento en curso', 'no_pairing');
    }
    if (this.claveDelMovil === null) {
      throw new PairingError('todavia no ha reclamado ningun movil', 'not_claimed');
    }

    const canonica = canonicalPublicKey(this.claveDelMovil);
    if (canonica === null) {
      throw new PairingError('la clave del movil no es valida', 'bad_key');
    }

    const nombre = (await this.poll()).claimantName ?? 'dispositivo';
    const resultado = await this.client.confirmPairing(this.codigoActivo, accepted, canonica);

    if (!accepted || !resultado.paired) {
      this.reset();
      return { paired: false, device: null };
    }

    const device: PairedDevice = {
      id: resultado.deviceId ?? randomUUID(),
      name: nombre,
      kind: 'android',
      publicKey: canonica,
      fingerprint: fingerprint(fromBase64Url(canonica)),
      pairedAt: new Date().toISOString(),
      lastSeenAt: null,
      // emparejar no es autorizar: los permisos se conceden aparte
      permissions: [],
      unattended: false,
      requireBiometrics: false,
      revokedAt: null,
    };

    this.identity.addDevice(device);
    this.reset();
    return { paired: true, device };
  }

  cancel(): void {
    this.reset();
  }

  private reset(): void {
    this.codigoActivo = null;
    this.claveDelMovil = null;
  }
}

// -----------------------------------------------------------------------------
// contraste con lo anclado en local
// -----------------------------------------------------------------------------

export type DeviceDiscrepancy =
  | { kind: 'unknown_device'; deviceId: string; name: string }
  | { kind: 'key_mismatch'; deviceId: string; name: string }
  | { kind: 'missing_locally'; deviceId: string; name: string }
  | { kind: 'revoked_locally'; deviceId: string; name: string };

export interface GatewayDeviceView {
  id: string;
  name: string;
  publicKey: string;
  revoked: boolean;
}

/**
 * contrasta la lista que devuelve el gateway con la anclada en disco.
 *
 * Esto es lo que convierte al gateway en un simple mensajero. Sin este contraste
 * podria: inventarse un dispositivo emparejado, cambiar la clave publica de uno
 * real por otra que el atacante controle, o hacer desaparecer uno revocado para
 * que el usuario crea que ya no tiene acceso.
 *
 * NO decide nada por su cuenta: devuelve las discrepancias para que la interfaz
 * las muestre. Un dispositivo que el gateway anuncia y que no esta anclado aqui
 * NO debe poder abrir una sesion, y eso lo aplica quien acepta la sesion.
 */
export function compareWithLocal(
  remotos: readonly GatewayDeviceView[],
  locales: readonly PairedDevice[],
): DeviceDiscrepancy[] {
  const porId = new Map(locales.map((d) => [d.id, d]));
  const discrepancias: DeviceDiscrepancy[] = [];

  for (const remoto of remotos) {
    const local = porId.get(remoto.id);

    if (local === undefined) {
      // el gateway anuncia un dispositivo que este ordenador nunca confirmo
      discrepancias.push({ kind: 'unknown_device', deviceId: remoto.id, name: remoto.name });
      continue;
    }

    if (local.publicKey !== remoto.publicKey) {
      // la clave cambio: o el gateway miente, o alguien sustituyo la identidad
      discrepancias.push({ kind: 'key_mismatch', deviceId: remoto.id, name: remoto.name });
      continue;
    }

    if (local.revokedAt !== null && !remoto.revoked) {
      // se revoco aqui pero el gateway lo da por activo
      discrepancias.push({ kind: 'revoked_locally', deviceId: remoto.id, name: remoto.name });
    }
  }

  // anclados aqui que el gateway ya no menciona
  const idsRemotos = new Set(remotos.map((r) => r.id));
  for (const local of locales) {
    if (local.revokedAt === null && !idsRemotos.has(local.id)) {
      discrepancias.push({ kind: 'missing_locally', deviceId: local.id, name: local.name });
    }
  }

  return discrepancias;
}

/** texto para la interfaz; cada discrepancia dice que hacer, no solo que pasa */
export function describeDiscrepancy(d: DeviceDiscrepancy): string {
  switch (d.kind) {
    case 'unknown_device':
      return `"${d.name}" aparece en el servidor pero este ordenador nunca lo confirmo. No podra conectarse. Si no lo reconoces, revocalo.`;
    case 'key_mismatch':
      return `la identidad de "${d.name}" NO coincide con la que se guardo al emparejar. No te conectes: vuelve a emparejarlo desde cero.`;
    case 'revoked_locally':
      return `"${d.name}" esta revocado en este ordenador pero el servidor lo da por activo. Revocalo de nuevo.`;
    case 'missing_locally':
      return `"${d.name}" esta emparejado en este ordenador pero el servidor no lo conoce, asi que no podra conectarse. Vuelve a emparejarlo, o revocalo si ya no lo usas.`;
  }
}
