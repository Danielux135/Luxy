// identidad criptografica de un dispositivo.
//
// P-256 (ECDSA para firmar, ECDH para acordar claves). El motivo esta en
// docs/adr/0001-identidad-de-dispositivo-p256.md y se resume en una frase: es la
// UNICA curva con respaldo por hardware tanto en el Secure Enclave de Apple como
// en StrongBox de Android. Ed25519 obligaria a que la clave privada viviera en
// software en el movil.
//
// POR QUE @noble/curves Y NO WebCrypto: React Native no trae WebCrypto. Con
// noble, el escritorio y el movil ejecutan LITERALMENTE la misma implementacion,
// asi que desaparece la clase de fallos de "dos implementaciones que difieren en
// un detalle de codificacion" — que en verificacion de firmas significa aceptar
// algo que deberia rechazarse.
import { p256 } from '@noble/curves/nist.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { randomBytes } from '@noble/hashes/utils.js';

/** clave privada: 32 bytes. NUNCA sale del dispositivo */
export type PrivateKey = Uint8Array;
/** clave publica sin comprimir: 65 bytes (0x04 ‖ X ‖ Y) */
export type PublicKey = Uint8Array;

export const PRIVATE_KEY_BYTES = 32;
export const PUBLIC_KEY_BYTES = 65;
/** firma en formato IEEE P1363: r‖s, 32+32 */
export const SIGNATURE_BYTES = 64;

export interface Identity {
  privateKey: PrivateKey;
  publicKey: PublicKey;
}

/** genera una identidad nueva */
export function generateIdentity(): Identity {
  const privateKey = p256.utils.randomSecretKey();
  return { privateKey, publicKey: p256.getPublicKey(privateKey, false) };
}

/**
 * comprueba que unos bytes son de verdad un punto de la curva P-256.
 *
 * NO basta con mirar la longitud y el 0x04 inicial. Unos bytes con la forma
 * correcta pero que no estan en la curva se guardarian como dispositivo
 * emparejado y despues NINGUNA firma verificaria contra ellos: el
 * emparejamiento quedaria roto en silencio, y averiguar por que costaria horas.
 */
export function isValidPublicKey(bytes: Uint8Array): boolean {
  if (bytes.length !== PUBLIC_KEY_BYTES || bytes[0] !== 0x04) return false;
  try {
    p256.Point.fromBytes(bytes).assertValidity();
    return true;
  } catch {
    return false;
  }
}

/** deriva la clave publica de una privada existente */
export function publicKeyOf(privateKey: PrivateKey): PublicKey {
  return p256.getPublicKey(privateKey, false);
}

// -----------------------------------------------------------------------------
// separacion de dominios
// -----------------------------------------------------------------------------

/**
 * contextos de firma.
 *
 * ESTO NO ES DECORATIVO. Sin separacion de dominios, una firma obtenida en un
 * contexto vale en otro: la firma del codigo de emparejamiento serviria como
 * firma de una oferta SDP, y quien capturase la primera podria montar una sesion.
 * El contexto va DENTRO de lo que se firma, asi que una firma de "pair" no
 * verifica nunca como "sdp".
 */
export const SIGNING_CONTEXTS = [
  'luxy.pair.claim.v1',
  'luxy.pair.confirm.v1',
  'luxy.session.request.v1',
  'luxy.sdp.offer.v1',
  'luxy.sdp.answer.v1',
  'luxy.auth.challenge.v1',
] as const;
export type SigningContext = (typeof SIGNING_CONTEXTS)[number];

/**
 * mensaje canonico que se firma.
 *
 * El separador es 0x1F (unit separator), un byte que no aparece en texto normal.
 * Con un separador imprimible, dos campos distintos podrian producir el mismo
 * flujo de bytes: firmar ("ab","c") y ("a","bc") daria lo mismo, y una firma
 * valida para uno lo seria para el otro.
 */
/** 0x1F, unit separator: no aparece en texto normal */
export const FIELD_SEPARATOR = '';

export function canonicalMessage(context: SigningContext, parts: readonly string[]): Uint8Array {
  // si una parte pudiera contener el separador, dos troceados distintos darian
  // los mismos bytes y una firma de uno valdria para el otro. Ninguna parte
  // legitima lo contiene (son base64url, digitos o UUID), asi que verlo aqui
  // significa que algo va mal y se para en vez de firmar algo ambiguo.
  for (const part of parts) {
    if (part.includes(FIELD_SEPARATOR)) {
      throw new Error('una parte del mensaje contiene el separador de campos');
    }
  }
  const texto = [context, ...parts].join(FIELD_SEPARATOR);
  return new TextEncoder().encode(texto);
}

// -----------------------------------------------------------------------------
// firma
// -----------------------------------------------------------------------------

export function sign(
  privateKey: PrivateKey,
  context: SigningContext,
  parts: readonly string[],
): Uint8Array {
  const mensaje = canonicalMessage(context, parts);
  // devuelve ya los 64 bytes en formato P1363 (r‖s)
  return p256.sign(sha256(mensaje), privateKey, { prehash: false });
}

/**
 * verifica una firma.
 *
 * NUNCA lanza. Una clave mal formada, una firma de longitud incorrecta o basura
 * devuelven `false`, no una excepcion: si lanzara, un `catch` mal puesto en el
 * llamador podria convertirse en "no se pudo verificar, sigamos".
 */
export function verify(
  publicKey: PublicKey,
  context: SigningContext,
  parts: readonly string[],
  signature: Uint8Array,
): boolean {
  if (publicKey.length !== PUBLIC_KEY_BYTES) return false;
  if (signature.length !== SIGNATURE_BYTES) return false;
  try {
    return p256.verify(signature, sha256(canonicalMessage(context, parts)), publicKey, {
      prehash: false,
    });
  } catch {
    return false;
  }
}

// -----------------------------------------------------------------------------
// huella y palabras de confirmacion
// -----------------------------------------------------------------------------

/** huella de una clave publica: sha256 en hexadecimal */
export function fingerprint(publicKey: PublicKey): string {
  return toHex(sha256(publicKey));
}

/** huella en grupos de cuatro, para poder leerla en voz alta */
export function formatFingerprint(hex: string): string {
  return (hex.slice(0, 32).match(/.{4}/g) ?? []).join(' ');
}

/**
 * lista de palabras para la confirmacion mutua.
 *
 * 256 palabras cortas, sin tildes, sin parecidos entre si al leerlas en voz alta
 * y sin ninguna que pueda sonar ofensiva. Cada palabra aporta 8 bits: cuatro
 * palabras son 32 bits, suficiente para que un atacante que quiera provocar una
 * coincidencia tenga que hacer 2^31 intentos EN VIVO, mientras el usuario mira
 * las dos pantallas.
 */
export const CONFIRMATION_WORDS: readonly string[] = [
  'abeja','abrigo','aceite','acero','agua','ajedrez','alambre','alba',
  'ancla','anillo','antena','arbol','arcilla','arena','arpa','arroz',
  'avena','azucar','balcon','ballena','bambu','banco','barco','bosque',
  'bota','boton','brisa','bronce','buho','burbuja','buzon','caballo',
  'cabana','cactus','cadena','cafe','calle','camino','campana','canela',
  'cantera','capa','caracol','carbon','carta','casco','cebolla','cedro',
  'ceniza','cereza','cesta','chapa','cielo','ciervo','cinta','ciruela',
  'cisne','clavel','cobre','coco','cofre','columna','cometa','concha',
  'conejo','copa','coral','corcho','cordel','corona','cristal','cuchara',
  'cuerda','cuervo','cumbre','dado','delfin','disco','dragon','duna',
  'enebro','erizo','escoba','esfera','espada','espejo','espiga','faro',
  'fideo','fiesta','flauta','flecha','flor','foca','fresa','fuego',
  'fuente','galleta','ganso','garza','gato','gema','globo','goma',
  'gota','granate','grillo','grulla','guante','guitarra','gusano','harina',
  'helecho','hielo','hierro','higo','hilo','hoja','hongo','hormiga',
  'horno','huerto','humo','iglesia','iman','isla','jabon','jarra',
  'jazmin','jirafa','joya','junco','lago','lampara','lana','lanza',
  'laurel','leche','lechuza','lena','leon','libro','lima','limon',
  'lince','lirio','llave','lluvia','lobo','loro','luna','madera',
  'maiz','malva','manzana','mapa','mar','marfil','martillo','mascara',
  'melon','menta','miel','mimbre','mirlo','molino','moneda','montana',
  'mora','mosaico','muelle','nido','nieve','nube','nuez','olivo',
  'olla','onda','orquidea','oso','ostra','oveja','paloma','pan',
  'panal','papel','pared','pato','pera','perla','pez','piedra',
  'pino','pinza','pipa','pizarra','plata','playa','pluma','polen',
  'pozo','puente','puerta','pulpo','queso','rama','rana','raton',
  'red','reloj','remo','resina','rio','roble','rocio','rosa',
  'rueda','sal','salmon','sandia','sauce','seda','selva','sello',
  'sierra','silla','sol','sombra','sopa','tabla','tambor','tejado',
  'tela','templo','tigre','tinta','torre','trigo','trineo','trueno',
  'tulipan','uva','vaca','valle','vapor','vela','ventana','verja',
  'vidrio','viento','vina','violin','yunque','zafiro','zorro','zumo',
] as const;

/**
 * palabras que deben coincidir en las dos pantallas.
 *
 * ES CONMUTATIVA A PROPOSITO, y es un fallo facil de cometer: si se derivaran de
 * `hash(a ‖ b)` sin ordenar, el escritorio calcularia hash(desktop‖movil) y el
 * movil hash(movil‖desktop), verian listas DISTINTAS y el usuario no podria
 * confirmar nunca. Se ordenan las dos claves byte a byte antes de mezclarlas.
 *
 * Para que sirva de algo, el usuario tiene que comparar las dos pantallas: es lo
 * que detecta a un gateway que intente sustituir una clave.
 */
export function confirmationWords(a: PublicKey, b: PublicKey, count = 4): string[] {
  const [primera, segunda] = compareBytes(a, b) <= 0 ? [a, b] : [b, a];

  const mezcla = new Uint8Array(primera.length + segunda.length);
  mezcla.set(primera, 0);
  mezcla.set(segunda, primera.length);

  const digest = sha256(mezcla);
  const palabras: string[] = [];
  for (let i = 0; i < count; i += 1) {
    palabras.push(CONFIRMATION_WORDS[digest[i]! % CONFIRMATION_WORDS.length]!);
  }
  return palabras;
}

/** compara dos arrays de bytes en orden lexicografico */
export function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const minimo = Math.min(a.length, b.length);
  for (let i = 0; i < minimo; i += 1) {
    if (a[i]! !== b[i]!) return a[i]! - b[i]!;
  }
  return a.length - b.length;
}

// -----------------------------------------------------------------------------
// retos
// -----------------------------------------------------------------------------

export const CHALLENGE_BYTES = 32;

/** genera un reto aleatorio para autenticar sin enviar la clave */
export function generateChallenge(): Uint8Array {
  return randomBytes(CHALLENGE_BYTES);
}

// -----------------------------------------------------------------------------
// codificacion
// -----------------------------------------------------------------------------

export function toBase64Url(bytes: Uint8Array): string {
  let binario = '';
  for (const byte of bytes) binario += String.fromCharCode(byte);
  return btoa(binario).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(value: string): Uint8Array {
  const normalizado = value.replace(/-/g, '+').replace(/_/g, '/');
  const relleno = normalizado + '='.repeat((4 - (normalizado.length % 4)) % 4);
  const binario = atob(relleno);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i += 1) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * compara en tiempo constante.
 *
 * Comparar tokens o huellas con `===` filtra por el tiempo de respuesta cuantos
 * bytes iniciales coinciden, y eso permite reconstruir el valor byte a byte.
 */
export function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diferencia = 0;
  for (let i = 0; i < a.length; i += 1) diferencia |= a[i]! ^ b[i]!;
  return diferencia === 0;
}
