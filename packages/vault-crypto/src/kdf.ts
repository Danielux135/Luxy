// derivacion de la contraseña y separacion de dominios.
//
// dos funciones distintas que la gente confunde a menudo:
//
//   Argon2id  convierte una CONTRASEÑA (poca entropia, adivinable) en una llave.
//             Es lento y caro en memoria a proposito: es lo unico que encarece
//             probar millones de contraseñas a quien se lleve el archivo.
//
//   HKDF      convierte una LLAVE (ya aleatoria) en varias llaves independientes.
//             Es rapido, y debe serlo: no hay nada que adivinar.
//
// usar HKDF sobre una contraseña seria un fallo grave. Usar Argon2id para las
// subclaves solo seria lento sin ganar nada.
import { argon2idAsync } from '@noble/hashes/argon2.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { KEY_BYTES } from './envelope.js';
import { VaultCryptoError, toBase64Url, utf8 } from './bytes.js';

/**
 * coste de Argon2id: la SEGUNDA opcion recomendada por RFC 9106 §4.
 *
 * Elegido con tiempos medidos en el equipo de desarrollo, no a ojo. Argon2 en
 * JavaScript puro es bastante mas lento que una implementacion nativa:
 *
 *     m=256 MiB, t=3  →  ~12,8 s   inaceptable para desbloquear
 *     m=128 MiB, t=3  →   ~5,6 s   sigue siendo demasiado
 *     m= 64 MiB, t=3  →   ~2,7 s   elegido
 *     m= 32 MiB, t=3  →   ~1,3 s   por debajo de la recomendacion del RFC
 *
 * 2,7 s se paga pocas veces: al crear la boveda, al abrirla en un equipo nuevo
 * y cuando el usuario desactiva "recordar en este equipo". El desbloqueo del
 * dia a dia usa la envoltura del sistema operativo, que es instantanea.
 *
 * p=1 y no el p=4 del RFC porque esta implementacion es de un solo hilo: con la
 * misma m y t, subir las lineas no añade trabajo total, solo lo reordena. El
 * atacante, que si puede paralelizar, no gana nada con nuestra eleccion.
 *
 * los parametros se GUARDAN junto al material derivado. No se leen de esta
 * constante al descifrar: si algun dia se suben, las bovedas antiguas deben
 * seguir abriendose con los suyos.
 */
export const ARGON2_PARAMS = {
  /** iteraciones */
  t: 3,
  /** memoria en KiB */
  m: 64 * 1024,
  /** paralelismo */
  p: 1,
} as const;

export interface Argon2Params {
  t: number;
  m: number;
  p: number;
}

/**
 * coste para la clave de recuperacion, que NO es una contraseña.
 *
 * Argon2id es caro porque una contraseña humana tiene poca entropia y hay que
 * encarecer cada intento. Una clave de recuperacion de Luxy son 32 caracteres
 * de un alfabeto de 30, generados al azar: ~157 bits. Ni con el coste minimo
 * hay ataque de diccionario que valga, porque no hay diccionario.
 *
 * Cobrar aqui los 2,7 s de `ARGON2_PARAMS` no compraria seguridad y si
 * doblaria el tiempo de crear una cuenta, que ya paga dos derivaciones. Es el
 * mismo criterio por el que un gestor de contraseñas trata su «clave secreta»
 * distinto de la contraseña maestra. Ver `D-049`.
 *
 * m esta en el minimo que admite `assertArgon2Params`, no por debajo: la
 * validacion sigue siendo la misma para todo el mundo.
 */
export const RECOVERY_ARGON2_PARAMS = {
  t: 1,
  m: 8 * 1024,
  p: 1,
} as const;

/** limites defensivos: un archivo manipulado no puede pedir memoria absurda */
const MAX_MEMORY_KIB = 2 * 1024 * 1024;

export function assertArgon2Params(params: Argon2Params): void {
  if (!Number.isInteger(params.t) || params.t < 1 || params.t > 16) {
    throw new VaultCryptoError('parametros de derivacion no validos');
  }
  if (!Number.isInteger(params.m) || params.m < 8 * 1024 || params.m > MAX_MEMORY_KIB) {
    throw new VaultCryptoError('parametros de derivacion no validos');
  }
  if (!Number.isInteger(params.p) || params.p < 1 || params.p > 4) {
    throw new VaultCryptoError('parametros de derivacion no validos');
  }
}

export const SALT_BYTES = 16;

/**
 * convierte la contraseña en la llave que envuelve la llave maestra (KEK).
 *
 * `onProgress` existe porque esto tarda cientos de milisegundos: la interfaz
 * necesita poder decir "descifrando" en vez de parecer colgada.
 */
export async function deriveKeyEncryptionKey(
  password: string,
  salt: Uint8Array,
  params: Argon2Params = ARGON2_PARAMS,
  onProgress?: (fraction: number) => void,
): Promise<Uint8Array> {
  if (password.length === 0) throw new VaultCryptoError('la contraseña esta vacia');
  if (salt.length !== SALT_BYTES) {
    throw new VaultCryptoError(`la sal debe tener ${SALT_BYTES} bytes`);
  }
  assertArgon2Params(params);

  return argon2idAsync(utf8(password), salt, {
    t: params.t,
    m: params.m,
    p: params.p,
    dkLen: KEY_BYTES,
    // devuelve el control al bucle de eventos cada 10 ms para no congelar la UI
    asyncTick: 10,
    ...(onProgress === undefined ? {} : { onProgress }),
  });
}

/**
 * dominios de subclave.
 *
 * cada uno produce una llave distinta e independiente a partir de la maestra.
 * Que se filtre la de miniaturas no compromete la de mensajes, y ningun sobre
 * de un dominio se puede reabrir con la llave de otro.
 */
export const KEY_DOMAINS = [
  'index',
  'vaultid',
  'conversation',
  'memory',
  'media',
  'thumbnail',
  'identity',
] as const;

export type KeyDomain = (typeof KEY_DOMAINS)[number];

/**
 * deriva la subclave de un dominio a partir de la llave maestra.
 *
 * el `context` opcional separa ademas por objeto: con el se obtiene una llave
 * distinta POR CONVERSACION, que es lo que permite compartir una sola sin
 * entregar el resto de la boveda.
 */
export function deriveSubkey(
  masterKey: Uint8Array,
  domain: KeyDomain,
  context = '',
): Uint8Array {
  if (masterKey.length !== KEY_BYTES) {
    throw new VaultCryptoError(`la llave maestra debe tener ${KEY_BYTES} bytes`);
  }
  if (!KEY_DOMAINS.includes(domain)) {
    throw new VaultCryptoError(`dominio de llave desconocido: "${domain}"`);
  }
  // el separador no puede aparecer en el dominio (son minusculas y guiones), de
  // modo que ("media", "x:y") y ("media:x", "y") no colisionan nunca
  const info = utf8(context.length === 0 ? `luxy.vault.${domain}` : `luxy.vault.${domain}|${context}`);
  // la sal de HKDF no aporta aqui: la entrada ya es una llave uniforme de 256
  // bits. La separacion real la hace `info`.
  return hkdf(sha256, masterKey, undefined, info, KEY_BYTES);
}

/**
 * hash de acceso: lo UNICO derivado de la contraseña que puede ver el servidor.
 *
 * El peligro que evita es concreto. Si para autenticarte enviases la contraseña
 * —o la llave maestra, o algo derivado de ella con una funcion barata— el
 * servidor podria derivar tus llaves de cifrado. El cifrado extremo a extremo
 * dejaria de existir sin que nada lo delatase.
 *
 * Por eso se aplica una SEGUNDA vuelta de Argon2id sobre la llave maestra,
 * usando la contraseña como sal. Recuperar la llave maestra a partir de este
 * hash exigiria invertir Argon2id, que es justo lo que Argon2id no permite.
 *
 * Es el mismo esquema que usan los gestores de contraseñas conocidos, y por la
 * misma razon: poder verificar quien eres sin poder abrir lo que guardas.
 *
 * Ver `D-046`.
 */
export async function deriveAuthHash(
  masterKey: Uint8Array,
  password: string,
  params: Argon2Params = ARGON2_PARAMS,
): Promise<string> {
  if (masterKey.length !== KEY_BYTES) {
    throw new VaultCryptoError(`la llave maestra debe tener ${KEY_BYTES} bytes`);
  }
  if (password.length === 0) throw new VaultCryptoError('la contraseña esta vacia');
  assertArgon2Params(params);

  // la contraseña hace de sal, invirtiendo los papeles de la primera vuelta:
  // asi las dos derivaciones no pueden coincidir nunca por accidente
  const hash = await argon2idAsync(masterKey, utf8(password), {
    t: params.t,
    m: params.m,
    p: params.p,
    dkLen: KEY_BYTES,
    asyncTick: 10,
  });
  return toBase64Url(hash);
}

/**
 * identificador publico de la boveda.
 *
 * Existe por un problema concreto: la unica identidad de Luxy es el token de
 * maquina, y con eso los registros de un portatil no serian visibles desde el
 * de sobremesa. Hace falta algo que diga "estas dos maquinas abren la MISMA
 * boveda" sin inventar cuentas de usuario.
 *
 * Se deriva de la llave maestra con HKDF, asi que dos equipos que abren la
 * misma boveda obtienen el mismo valor sin coordinarse. Y como HKDF no se
 * invierte, el servidor puede guardarlo sin aprender nada de la llave.
 *
 * Lo que SI revela, y se asume: agrupa. El servidor ve que N registros son de
 * la misma boveda. Ya lo veria por el patron de subidas.
 *
 * AGRUPA, NO AUTORIZA. Quien autoriza sigue siendo el token de maquina.
 */
export function deriveVaultId(masterKey: Uint8Array): string {
  return toBase64Url(deriveSubkey(masterKey, 'vaultid'));
}
