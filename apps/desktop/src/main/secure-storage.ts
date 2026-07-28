// almacen cifrado de secretos.
//
// vive SOLO en el proceso principal. El renderer nunca recibe un valor: como
// mucho llega a saber que nombres hay guardados y si cada uno esta configurado.
//
// en Windows safeStorage usa DPAPI, atado a la cuenta del usuario del sistema.
// Eso protege frente a otro usuario del equipo y frente a que el archivo acabe
// en una copia de seguridad, no frente a otro proceso del mismo usuario.
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { secretRegistry } from '@luxy/shared';

const FORMAT_VERSION = 1;

/**
 * el cifrado se inyecta en vez de llamar a safeStorage directamente.
 *
 * dos motivos: el almacen se puede probar sin arrancar Electron, y si algun dia
 * hace falta otro respaldo (por ejemplo para la CLI) solo cambia esta pieza.
 */
export interface EncryptionBackend {
  isAvailable(): boolean;
  encrypt(plain: string): Buffer;
  decrypt(data: Buffer): string;
}

/** respaldo real: safeStorage de Electron, que en Windows usa DPAPI */
export function createSafeStorageBackend(safeStorage: {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(data: Buffer): string;
}): EncryptionBackend {
  return {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: (plain) => safeStorage.encryptString(plain),
    decrypt: (data) => safeStorage.decryptString(data),
  };
}

export class SecretStoreError extends Error {
  constructor(
    message: string,
    readonly hint: string | null = null,
  ) {
    super(message);
    this.name = 'SecretStoreError';
  }
}

// los nombres de secreto son parte del contrato compartido: los usan tambien el
// renderer (para saber si estan configurados) y el onboarding
export { MACHINE_TOKEN_SECRET, connectionSecretName } from '../shared/ipc.js';

interface SecretsFile {
  version: number;
  /** payload cifrado en base64 */
  data: string;
}

/**
 * almacen de secretos respaldado por safeStorage.
 *
 * si el cifrado no esta disponible NO se guarda nada en claro: se falla con una
 * explicacion. Guardar en claro un archivo llamado "secrets.enc" seria peor que
 * no guardarlo, porque nadie volveria a mirarlo.
 */
export class SecretStore {
  private cache: Record<string, string> | null = null;

  constructor(
    private readonly file: string,
    private readonly crypto: EncryptionBackend,
  ) {}

  static defaultPath(configDirectory: string): string {
    return join(configDirectory, 'secrets.enc');
  }

  isEncryptionAvailable(): boolean {
    return this.crypto.isAvailable();
  }

  private assertAvailable(): void {
    if (this.isEncryptionAvailable()) return;
    throw new SecretStoreError(
      'este equipo no puede cifrar secretos',
      'Windows no ofrece cifrado para tu cuenta. Luxy no guardara claves sin cifrar.',
    );
  }

  private read(): Record<string, string> {
    if (this.cache !== null) return this.cache;
    if (!existsSync(this.file)) {
      this.cache = {};
      return this.cache;
    }

    this.assertAvailable();
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as SecretsFile;
      if (raw.version !== FORMAT_VERSION) {
        throw new SecretStoreError(`formato de secretos desconocido (version ${raw.version})`);
      }
      const plain = this.crypto.decrypt(Buffer.from(raw.data, 'base64'));
      const parsed = JSON.parse(plain) as Record<string, string>;
      this.cache = parsed;
      // todo lo que sale de aqui queda registrado para que redact() lo tape
      for (const value of Object.values(parsed)) secretRegistry.add(value);
      return parsed;
    } catch (error) {
      if (error instanceof SecretStoreError) throw error;
      throw new SecretStoreError(
        'no se pudieron descifrar los secretos guardados',
        'puede que se creasen con otra cuenta de Windows. Vuelve a introducir las claves.',
      );
    }
  }

  private persist(values: Record<string, string>): void {
    this.assertAvailable();
    mkdirSync(dirname(this.file), { recursive: true });

    const encrypted = this.crypto.encrypt(JSON.stringify(values));
    const payload: SecretsFile = { version: FORMAT_VERSION, data: encrypted.toString('base64') };

    // escritura atomica: un corte a medias no puede dejar el archivo ilegible
    const temporary = `${this.file}.tmp`;
    writeFileSync(temporary, JSON.stringify(payload), 'utf8');
    renameSync(temporary, this.file);
    this.cache = values;
  }

  /** true si hay un valor guardado. es lo unico que puede saber el renderer */
  has(name: string): boolean {
    const value = this.read()[name];
    return typeof value === 'string' && value.length > 0;
  }

  /** nombres guardados, nunca los valores */
  listNames(): string[] {
    return Object.keys(this.read()).filter((name) => this.has(name));
  }

  /** SOLO para el proceso principal: jamas se envia el resultado al renderer */
  get(name: string): string | undefined {
    return this.read()[name];
  }

  /** SOLO para pasarselo al proceso del agente */
  getAll(): Record<string, string> {
    return { ...this.read() };
  }

  set(name: string, value: string): void {
    const trimmed = value.trim();
    if (trimmed.length === 0) throw new SecretStoreError('el valor esta vacio');
    const values = { ...this.read(), [name]: trimmed };
    this.persist(values);
    secretRegistry.add(trimmed);
  }

  delete(name: string): void {
    const values = { ...this.read() };
    if (!(name in values)) return;
    delete values[name];
    this.persist(values);
  }

  /** borra el archivo entero. lo usa "restablecer" en los ajustes */
  clear(): void {
    this.cache = {};
    if (existsSync(this.file)) unlinkSync(this.file);
  }
}
