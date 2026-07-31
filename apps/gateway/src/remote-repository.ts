// acceso a las tablas de control remoto.
//
// Se separa de Repository a proposito: son tablas nuevas, con su propio ciclo de
// vida, y mezclarlas con las de trabajos de IA haria de Repository una clase de
// mil lineas donde nadie encuentra nada.
import { eq, type SupabaseClient } from './supabase.js';

export interface RemoteDeviceRow {
  id: string;
  name: string;
  kind: 'desktop' | 'android';
  public_key: string;
  fingerprint: string;
  peer_device_id: string | null;
  permissions: string[];
  unattended: boolean;
  require_biometrics: boolean;
  paired_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
}

export interface PairingCodeRow {
  code: string;
  host_device_id: string;
  state: 'waiting' | 'claimed' | 'confirmed' | 'rejected' | 'expired' | 'used';
  claimant_public_key: string | null;
  claimant_name: string | null;
  claimant_kind: 'desktop' | 'android' | null;
  host_confirmed: boolean;
  claimant_confirmed: boolean;
  expires_at: string;
  claimed_at: string | null;
  resolved_at: string | null;
}

const DEVICE_COLUMNS =
  'id,name,kind,public_key,fingerprint,peer_device_id,permissions,unattended,' +
  'require_biometrics,paired_at,last_seen_at,revoked_at';

export class RemoteRepository {
  constructor(private readonly db: SupabaseClient) {}

  // ---------------------------------------------------------------------------
  // dispositivos
  // ---------------------------------------------------------------------------

  async getDeviceById(id: string): Promise<RemoteDeviceRow | null> {
    return this.db.selectOne<RemoteDeviceRow>('remote_devices', {
      columns: DEVICE_COLUMNS,
      filters: { id: eq(id) },
    });
  }

  async getDeviceByPublicKey(publicKey: string): Promise<RemoteDeviceRow | null> {
    return this.db.selectOne<RemoteDeviceRow>('remote_devices', {
      columns: DEVICE_COLUMNS,
      filters: { public_key: eq(publicKey) },
    });
  }

  /** dispositivos emparejados con un host concreto */
  async listPeersOf(hostDeviceId: string): Promise<RemoteDeviceRow[]> {
    return this.db.select<RemoteDeviceRow>('remote_devices', {
      columns: DEVICE_COLUMNS,
      filters: { peer_device_id: eq(hostDeviceId) },
      order: 'paired_at.desc',
    });
  }

  async createDevice(input: {
    name: string;
    kind: 'desktop' | 'android';
    publicKey: string;
    fingerprint: string;
    peerDeviceId: string | null;
    permissions: string[];
  }): Promise<RemoteDeviceRow> {
    const rows = await this.db.insert<RemoteDeviceRow>('remote_devices', {
      name: input.name,
      kind: input.kind,
      public_key: input.publicKey,
      fingerprint: input.fingerprint,
      peer_device_id: input.peerDeviceId,
      permissions: input.permissions,
    });
    const row = rows[0];
    if (row === undefined) throw new Error('no se pudo crear el dispositivo');
    return row;
  }

  /**
   * revoca un dispositivo.
   *
   * NO borra la fila y limpia permisos y desatendido en la misma operacion. Si
   * fueran dos escrituras, una caida entre ambas dejaria un dispositivo revocado
   * que conserva el acceso sin confirmacion.
   */
  async revokeDevice(id: string): Promise<boolean> {
    const rows = await this.db.update<RemoteDeviceRow>(
      'remote_devices',
      { id: eq(id), revoked_at: 'is.null' },
      {
        revoked_at: new Date().toISOString(),
        unattended: false,
        permissions: [],
        updated_at: new Date().toISOString(),
      },
    );
    return rows.length > 0;
  }

  /** cambia permisos y desatendido. Un dispositivo revocado no se toca */
  async updateDeviceAccess(
    id: string,
    values: { permissions?: string[]; unattended?: boolean; requireBiometrics?: boolean; name?: string },
  ): Promise<RemoteDeviceRow | null> {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (values.permissions !== undefined) patch.permissions = values.permissions;
    if (values.unattended !== undefined) patch.unattended = values.unattended;
    if (values.requireBiometrics !== undefined) patch.require_biometrics = values.requireBiometrics;
    if (values.name !== undefined) patch.name = values.name;

    const rows = await this.db.update<RemoteDeviceRow>(
      'remote_devices',
      { id: eq(id), revoked_at: 'is.null' },
      patch,
    );
    return rows[0] ?? null;
  }

  async markDeviceSeen(id: string): Promise<void> {
    await this.db.update('remote_devices', { id: eq(id) }, {
      last_seen_at: new Date().toISOString(),
    });
  }

  // ---------------------------------------------------------------------------
  // codigos de emparejamiento
  // ---------------------------------------------------------------------------

  async getPairingCode(code: string): Promise<PairingCodeRow | null> {
    return this.db.selectOne<PairingCodeRow>('remote_pairing_codes', {
      filters: { code: eq(code) },
    });
  }

  async createPairingCode(input: {
    code: string;
    hostDeviceId: string;
    expiresAt: string;
  }): Promise<void> {
    await this.db.insert(
      'remote_pairing_codes',
      { code: input.code, host_device_id: input.hostDeviceId, expires_at: input.expiresAt },
      false,
    );
  }

  /**
   * actualiza un codigo comprobando el estado esperado.
   *
   * El filtro por estado NO es cosmetico: es lo que hace que dos reclamaciones
   * simultaneas no puedan ganar las dos. Sin el, leer-y-escribir por separado
   * deja una ventana en la que ambas ven 'waiting'.
   */
  async transitionPairingCode(
    code: string,
    fromState: PairingCodeRow['state'],
    values: Partial<{
      state: PairingCodeRow['state'];
      claimant_public_key: string;
      claimant_name: string;
      claimant_kind: string;
      claimed_at: string;
      resolved_at: string;
      host_confirmed: boolean;
      claimant_confirmed: boolean;
    }>,
  ): Promise<PairingCodeRow | null> {
    const rows = await this.db.update<PairingCodeRow>(
      'remote_pairing_codes',
      { code: eq(code), state: eq(fromState) },
      values,
    );
    return rows[0] ?? null;
  }

  // ---------------------------------------------------------------------------
  // nonces de autenticacion
  // ---------------------------------------------------------------------------

  /**
   * registra un nonce y dice si era nuevo.
   *
   * Devuelve false si YA existia, que es exactamente la senal de replay. Se
   * apoya en la clave primaria (device_id, nonce), asi que comprobar y
   * registrar son la misma operacion atomica: dos peticiones identicas
   * simultaneas no pueden pasar las dos. El espacio de nonces es POR
   * DISPOSITIVO, no global: si no, otro dispositivo podria pre-registrar los
   * nonces de una victima que los derive de un contador y bloquearla.
   */
  async registerNonce(deviceId: string, nonce: string, expiresAt: string): Promise<boolean> {
    return this.db.insertIfAbsent(
      'remote_auth_nonces',
      { nonce, device_id: deviceId, expires_at: expiresAt },
      'device_id,nonce',
    );
  }

  // ---------------------------------------------------------------------------
  // auditoria
  // ---------------------------------------------------------------------------

  async audit(
    action: string,
    input: { deviceId?: string | null; sessionId?: string | null; detail?: Record<string, unknown> },
  ): Promise<void> {
    await this.db.insert(
      'remote_audit',
      {
        action,
        device_id: input.deviceId ?? null,
        session_id: input.sessionId ?? null,
        detail: input.detail ?? {},
      },
      false,
    );
  }
}
