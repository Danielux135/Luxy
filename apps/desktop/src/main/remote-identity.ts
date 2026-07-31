// identidad remota de ESTE ordenador, y los dispositivos que tiene emparejados.
//
// DONDE VIVE CADA COSA:
//
//   clave privada  -> cifrada con safeStorage (DPAPI en Windows), en disco local
//   clave publica  -> en claro, no es secreta
//   dispositivos   -> en claro: solo claves publicas, nombres y permisos
//
// La clave privada NUNCA sale de este archivo sin cifrar, NUNCA se sube al
// gateway y NUNCA se escribe en un log. Es la unica cosa que demuestra que este
// ordenador es este ordenador.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import {
  generateIdentity,
  publicKeyOf,
  fingerprint,
  toBase64Url,
  fromBase64Url,
  isValidPublicKey,
  type Identity,
} from '@luxy/remote-crypto';
import type { Capability } from '@luxy/remote-protocol';

/** lo minimo que hace falta de safeStorage, para poder probar sin Electron */
export interface EncryptionBackend {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export const pairedDeviceSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(64),
  kind: z.enum(['android', 'desktop']),
  publicKey: z.string().min(80).max(100),
  fingerprint: z.string().length(64),
  pairedAt: z.string(),
  lastSeenAt: z.string().nullable().default(null),
  /** lo que este dispositivo puede pedir. Vacio = no puede hacer nada */
  permissions: z.array(z.string()).default([]),
  /**
   * acceso sin confirmacion local.
   *
   * DESACTIVADO POR DEFECTO, y a proposito: es la diferencia entre una
   * herramienta de control remoto y una puerta trasera. Se activa a mano, por
   * dispositivo, desde el ordenador.
   */
  unattended: z.boolean().default(false),
  /** exigir biometria en el movil antes de conectar */
  requireBiometrics: z.boolean().default(false),
  revokedAt: z.string().nullable().default(null),
});

export type PairedDevice = z.infer<typeof pairedDeviceSchema>;

const storeSchema = z.object({
  version: z.literal(1),
  /** clave privada cifrada, en base64. Solo la puede abrir este usuario de Windows */
  encryptedPrivateKey: z.string().min(1),
  publicKey: z.string().min(80).max(100),
  devices: z.array(pairedDeviceSchema).max(64).default([]),
});

export class RemoteIdentityStore {
  private identity: Identity | null = null;
  private devices: PairedDevice[] = [];
  private publicKeyB64 = '';

  constructor(
    private readonly filePath: string,
    private readonly backend: EncryptionBackend,
  ) {}

  /**
   * carga la identidad, o la crea la primera vez.
   *
   * Si safeStorage no esta disponible NO se guarda la clave en claro como
   * alternativa: se falla. Una clave privada de control remoto en texto plano en
   * el disco es peor que no tener control remoto.
   */
  load(): void {
    if (!this.backend.isEncryptionAvailable()) {
      throw new Error(
        'el cifrado del sistema no esta disponible, asi que no se puede guardar la ' +
          'identidad remota de forma segura. Luxy no la guardara en claro.',
      );
    }

    if (!existsSync(this.filePath)) {
      this.create();
      return;
    }

    const parsed = storeSchema.safeParse(JSON.parse(readFileSync(this.filePath, 'utf8')));
    if (!parsed.success) {
      throw new Error('el almacen de identidad remota esta corrupto');
    }

    const privateKey = fromBase64Url(
      this.backend.decryptString(Buffer.from(parsed.data.encryptedPrivateKey, 'base64')),
    );
    const publicKey = publicKeyOf(privateKey);

    // la publica guardada tiene que coincidir con la derivada de la privada. Si
    // no, alguien manipulo el archivo, y seguir adelante significaria anunciar
    // una identidad que no se puede firmar.
    if (toBase64Url(publicKey) !== parsed.data.publicKey) {
      throw new Error('la identidad remota no es coherente: el archivo fue manipulado');
    }

    this.identity = { privateKey, publicKey };
    this.publicKeyB64 = parsed.data.publicKey;
    this.devices = parsed.data.devices;
  }

  private create(): void {
    const identity = generateIdentity();
    this.identity = identity;
    this.publicKeyB64 = toBase64Url(identity.publicKey);
    this.devices = [];
    this.persist();
  }

  private persist(): void {
    if (this.identity === null) throw new Error('no hay identidad que guardar');

    mkdirSync(dirname(this.filePath), { recursive: true });
    const cifrada = this.backend
      .encryptString(toBase64Url(this.identity.privateKey))
      .toString('base64');

    writeFileSync(
      this.filePath,
      JSON.stringify(
        {
          version: 1,
          encryptedPrivateKey: cifrada,
          publicKey: this.publicKeyB64,
          devices: this.devices,
        },
        null,
        2,
      ),
      'utf8',
    );
  }

  /** clave privada, solo para firmar. No se expone fuera del proceso principal */
  privateKey(): Uint8Array {
    if (this.identity === null) throw new Error('la identidad remota no esta cargada');
    return this.identity.privateKey;
  }

  publicKey(): Uint8Array {
    if (this.identity === null) throw new Error('la identidad remota no esta cargada');
    return this.identity.publicKey;
  }

  publicKeyBase64(): string {
    return this.publicKeyB64;
  }

  fingerprint(): string {
    return fingerprint(this.publicKey());
  }

  listDevices(): PairedDevice[] {
    return this.devices.map((device) => ({ ...device }));
  }

  /** solo los que pueden conectarse ahora mismo */
  activeDevices(): PairedDevice[] {
    return this.listDevices().filter((device) => device.revokedAt === null);
  }

  findDevice(id: string): PairedDevice | null {
    return this.devices.find((device) => device.id === id) ?? null;
  }

  /**
   * guarda un dispositivo emparejado.
   *
   * Se valida la clave publica contra la curva ANTES de guardarla: unos bytes
   * con la forma correcta pero fuera de la curva dejarian un emparejamiento que
   * nunca podria verificar una firma, y el fallo aparaceria mucho despues.
   */
  addDevice(device: PairedDevice): void {
    if (!isValidPublicKey(fromBase64Url(device.publicKey))) {
      throw new Error('la clave publica del dispositivo no es valida');
    }
    if (this.devices.some((existing) => existing.publicKey === device.publicKey)) {
      throw new Error('ese dispositivo ya esta emparejado');
    }
    this.devices.push(pairedDeviceSchema.parse(device));
    this.persist();
  }

  /**
   * revoca un dispositivo.
   *
   * NO se borra la fila: se marca. Borrarla dejaria sin rastro de que ese
   * dispositivo existio, y el registro de quien tuvo acceso y hasta cuando es
   * justo lo que hace falta despues de perder un movil.
   */
  revokeDevice(id: string, now = new Date()): boolean {
    const device = this.devices.find((entry) => entry.id === id);
    if (device === undefined || device.revokedAt !== null) return false;

    device.revokedAt = now.toISOString();
    device.unattended = false;
    device.permissions = [];
    this.persist();
    return true;
  }

  /** cambia los permisos de un dispositivo */
  setPermissions(id: string, permissions: readonly Capability[]): boolean {
    const device = this.devices.find((entry) => entry.id === id);
    if (device === undefined || device.revokedAt !== null) return false;

    device.permissions = [...permissions];
    this.persist();
    return true;
  }

  /**
   * activa o desactiva el acceso desatendido.
   *
   * Un dispositivo revocado no puede recuperarlo: hay que volver a emparejarlo.
   */
  setUnattended(id: string, enabled: boolean): boolean {
    const device = this.devices.find((entry) => entry.id === id);
    if (device === undefined || device.revokedAt !== null) return false;

    device.unattended = enabled;
    this.persist();
    return true;
  }

  rename(id: string, name: string): boolean {
    const device = this.devices.find((entry) => entry.id === id);
    if (device === undefined) return false;
    device.name = name.slice(0, 64);
    this.persist();
    return true;
  }

  markSeen(id: string, now = new Date()): void {
    const device = this.devices.find((entry) => entry.id === id);
    if (device === undefined) return;
    device.lastSeenAt = now.toISOString();
    this.persist();
  }
}

/** ruta del almacen dentro de los datos de usuario de Luxy */
export function remoteIdentityPath(userDataPath: string): string {
  return join(userDataPath, 'remote-identity.json');
}
