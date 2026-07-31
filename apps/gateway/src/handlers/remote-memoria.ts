// base de datos en memoria para las pruebas de control remoto.
//
// Respeta las DOS invariantes que importan y que un mock ingenuo se saltaria:
// el nonce se comporta como clave primaria (comprobar y registrar es atomico) y
// las transiciones filtran por estado (dos reclamaciones simultaneas no ganan
// las dos). Sin eso, las pruebas pasarian y la realidad fallaria.
import type { RemoteDeviceRow, PairingCodeRow } from '../remote-repository.js';

export class MemoriaRemota {
  devices = new Map<string, RemoteDeviceRow>();
  codes = new Map<string, PairingCodeRow>();
  nonces = new Set<string>();
  auditoria: { action: string; deviceId: string | null }[] = [];

  async getDeviceById(id: string) {
    return this.devices.get(id) ?? null;
  }
  async getDeviceByPublicKey(key: string) {
    return [...this.devices.values()].find((d) => d.public_key === key) ?? null;
  }
  async listPeersOf(hostId: string) {
    return [...this.devices.values()].filter((d) => d.peer_device_id === hostId);
  }
  async createDevice(input: {
    name: string;
    kind: 'desktop' | 'android';
    publicKey: string;
    fingerprint: string;
    peerDeviceId: string | null;
    permissions: string[];
  }) {
    if ([...this.devices.values()].some((d) => d.public_key === input.publicKey)) {
      throw new Error('clave publica duplicada');
    }
    const row: RemoteDeviceRow = {
      id: crypto.randomUUID(),
      name: input.name,
      kind: input.kind,
      public_key: input.publicKey,
      fingerprint: input.fingerprint,
      peer_device_id: input.peerDeviceId,
      permissions: input.permissions,
      unattended: false,
      require_biometrics: false,
      paired_at: new Date().toISOString(),
      last_seen_at: null,
      revoked_at: null,
    };
    this.devices.set(row.id, row);
    return row;
  }
  async revokeDevice(id: string) {
    const row = this.devices.get(id);
    if (row === undefined || row.revoked_at !== null) return false;
    row.revoked_at = new Date().toISOString();
    row.unattended = false;
    row.permissions = [];
    return true;
  }
  async updateDeviceAccess(
    id: string,
    values: { permissions?: string[]; unattended?: boolean; requireBiometrics?: boolean; name?: string },
  ) {
    const row = this.devices.get(id);
    if (row === undefined || row.revoked_at !== null) return null;
    if (values.permissions !== undefined) row.permissions = values.permissions;
    if (values.unattended !== undefined) row.unattended = values.unattended;
    if (values.requireBiometrics !== undefined) row.require_biometrics = values.requireBiometrics;
    if (values.name !== undefined) row.name = values.name;
    return row;
  }
  async markDeviceSeen(id: string) {
    const row = this.devices.get(id);
    if (row !== undefined) row.last_seen_at = new Date().toISOString();
  }
  async getPairingCode(code: string) {
    return this.codes.get(code) ?? null;
  }
  async createPairingCode(input: { code: string; hostDeviceId: string; expiresAt: string }) {
    this.codes.set(input.code, {
      code: input.code,
      host_device_id: input.hostDeviceId,
      state: 'waiting',
      claimant_public_key: null,
      claimant_name: null,
      claimant_kind: null,
      host_confirmed: false,
      claimant_confirmed: false,
      expires_at: input.expiresAt,
      claimed_at: null,
      resolved_at: null,
    });
  }
  /** filtra por estado, igual que el UPDATE real: dos a la vez no ganan las dos */
  async transitionPairingCode(
    code: string,
    fromState: PairingCodeRow['state'],
    values: Partial<PairingCodeRow>,
  ) {
    const row = this.codes.get(code);
    if (row === undefined || row.state !== fromState) return null;
    Object.assign(row, values);
    return row;
  }
  /** false si ya existia: es la senal de replay */
  async registerNonce(_deviceId: string, nonce: string) {
    if (this.nonces.has(nonce)) return false;
    this.nonces.add(nonce);
    return true;
  }
  async audit(action: string, input: { deviceId?: string | null }) {
    this.auditoria.push({ action, deviceId: input.deviceId ?? null });
  }
}
