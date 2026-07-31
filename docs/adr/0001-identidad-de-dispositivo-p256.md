# ADR 0001 — La identidad de dispositivo usa P-256, no Ed25519

- **Estado:** aceptada
- **Fecha:** 2026-07-31
- **Fase:** 1 (protocolo e identidad)

## Contexto

Cada dispositivo emparejado (Luxy Desktop, Android, iPhone) necesita un par de
claves permanente. Con esa clave:

1. se autentica ante el gateway sin secretos compartidos;
2. **firma la oferta y la respuesta SDP**, incluida la huella DTLS.

El punto 2 es el que sostiene toda la seguridad del sistema: si la huella DTLS
va firmada y el otro extremo la verifica contra la clave pública emparejada, un
gateway comprometido **no puede** colocarse en medio de la sesión. Sin eso, quien
controle la señalización controla la sesión.

La primera intuición fue Ed25519: es lo que uno elige por defecto en 2026 para
firmar, es rápido y no tiene los pies de barro de ECDSA (nonces).

## Decisión

**ECDSA P-256 para firmar y ECDH P-256 para acordar claves.** No Ed25519.

## Motivo

El Secure Enclave de Apple **sólo admite claves privadas de curva elíptica de
256 bits** (`kSecAttrKeyTypeECSECPrimeRandom`, P-256). No admite Ed25519, ni RSA,
ni claves simétricas. Está en la
[documentación de `kSecAttrTokenIDSecureEnclave`](https://developer.apple.com/documentation/security/ksecattrtokenidsecureenclave).

Eso obliga a elegir:

| Opción | Consecuencia |
|---|---|
| Ed25519 en todas partes | En iPhone la clave privada **vive en software**. Un backup o un compromiso del dispositivo la expone, y el emparejamiento se puede clonar. |
| P-256 en todas partes | Clave respaldada por hardware en las tres plataformas. En iPhone la privada **nunca sale del Enclave**. |
| Ed25519 en Android/Desktop, P-256 en iOS | Dos formatos, dos rutas de verificación, dos sitios donde equivocarse. |

La tercera es la peor: introduce una bifurcación permanente en el código que
verifica firmas, que es justo el sitio donde un error es catastrófico y
silencioso.

Entre las dos primeras, el respaldo por hardware gana. La ventaja de Ed25519
sobre P-256 es real pero teórica en este contexto: los riesgos de ECDSA vienen de
generar mal el nonce `k`, y aquí **no implementamos ECDSA a mano** — firma
WebCrypto en Desktop, Keystore en Android y Secure Enclave en iOS. Ninguna de las
tres nos deja equivocarnos con el nonce.

Ventaja adicional: P-256 (`ECDSA` con `P-256`, y `ECDH` con `P-256`) está en
**WebCrypto en todas partes** desde hace años. Ed25519 en WebCrypto es reciente y
su disponibilidad varía. Como el Remote Host vive en un renderer de Electron y
el gateway es un Worker de Cloudflare, ambos usan WebCrypto: P-256 funciona en
los dos sin dependencias externas.

## Consecuencias

- Firma: `ECDSA` con `SHA-256`, formato **IEEE P1363** (r‖s, 64 bytes), que es lo
  que produce y consume WebCrypto. **No** DER: convertir formatos es otra fuente
  de fallos evitable.
- Claves públicas en formato **raw** (65 bytes, `0x04 ‖ X ‖ Y`), codificadas en
  base64url para viajar por JSON.
- La huella de dispositivo es `SHA-256` de la clave pública raw. De ahí salen las
  palabras de confirmación del emparejamiento.
- En iOS la clave se genera con `kSecAttrTokenIDSecureEnclave`; en Android con
  `KeyGenParameterSpec` y `setIsStrongBoxBacked(true)` cuando haya StrongBox; en
  Windows la clave privada se cifra con `safeStorage` (DPAPI), que es lo que ya
  usa Luxy para `secrets.enc`.
- **Nunca** se sube una clave privada a Supabase ni al gateway. El gateway guarda
  sólo claves públicas.

## Alternativas rechazadas

- **Ed25519**: mejor curva, pero pierde el respaldo por hardware en iPhone, que
  es el dispositivo más probable de perderse.
- **RSA**: descartado. Ni el Enclave lo admite, ni las firmas de 256+ bytes tienen
  sentido cuando van en cada mensaje de señalización.
- **Secreto compartido (HMAC)**: no sirve. Un secreto compartido tiene que
  guardarlo el gateway, y todo el diseño existe precisamente para que un gateway
  comprometido no baste para tomar el control.
