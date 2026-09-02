# Luxy — tarea activa

## BUG-GIT-IDENTITY-001 — identidad de Git de respaldo al confirmar un worktree

Estado: **`done` — Claude, 2026-09-01. Sin commit.**

En un Windows sin `user.name`/`user.email`, Luxy inicializaba un proyecto
editable correctamente pero **no podía confirmar el trabajo del modelo**:
`ensureGitRepository` ya inyectaba una identidad de respaldo para su commit
`estado inicial` y `commitWorktree`, en el mismo archivo, no inyectaba ninguna.

Arreglado en `apps/agent/src/git.ts` con `FALLBACK_IDENTITY_ARGS` y
`hasCommitIdentity()`. El respaldo entra **sólo** cuando el equipo no tiene
identidad: un commit de trabajo conserva la autoría real del usuario cuando
existe. Dos pruebas nuevas cubren los dos lados.

`npm run check` → exit 0; 96 archivos, 1.653 superadas, 14 omitidas.
Evidencia en `CHANGELOG-WORK.md` y `TEST-RESULTS.md` del 2026-09-01.

Queda `LA-030`: la identidad global de este ordenador sigue sin configurar.
Luxy ya no depende de ella; los commits manuales de Daniel sí.

---

## Discrepancias encontradas al abrir la sesión del 2026-09-01

1. Este ordenador (`C:\Users\oscar\Desktop\Daniel\Luxy`) es un clon nuevo **sin
   `node_modules`**. La línea canónica que describe `PROJECT-STATE.md` es
   `C:\Users\daniel\Desktop\Luxy`. Ver `docs/ARRANQUE-ORDENADOR-NUEVO.md`.
2. El «siguiente paso exacto» de `F4.9-DYNAMIC-HTTP-PROVIDERS` decía integrar el
   commit local en `main`. **Ya está integrado**: `main` @ `00a9cc1` *es* ese
   commit. `LA-029` (publicar y validar) sigue abierta; la integración no.

---

## F9-VAULT-001 — conversaciones privadas cifradas y sincronizadas

Estado: **en curso, punto de retoma del 2026-09-01 (tras `F9.18` y `F9.19`).**
Rama aislada `luxy/f9-1-vault-crypto` sobre `main` @ `00a9cc1`. `npm run check`
verde: 117 archivos, 2.030 pruebas superadas, 9 omitidas.

**Todo el camino crítico de código está cerrado.** Lo que queda es de tres
tipos, y conviene no confundirlos:

| tipo | qué es | quién |
| --- | --- | --- |
| **ejecución** | aplicar `0007`, desplegar el gateway, clave de Xavira, probar con dos equipos | Daniel (`LA-031`) |
| **piezas pendientes** | `F9.20` instrucciones fijas · `F9.21` vídeo grande · `F9.9` puente Telegram · `F9.11` invitado · `F9.16` remoto | IA |
| **deuda de documentación** | `F9.12`: `docs/PRIVACY.md`, `SECURITY.md`, modelo de amenazas | IA |

Nada de lo implementado ha hablado con Supabase, con el gateway real ni con la
API de Xavira. Es la advertencia que más veces se ha repetido en este bloque y
sigue siendo cierta.

> **PUNTO DE RETOMA — leer esto entero antes de tocar nada.** Debajo, cada paso
> `F9.x` conserva su bloque de cierre como historial; esta cabecera es el estado
> real que prevalece sobre ellos.

### Qué es y qué funciona hoy

Una sección **Privado** en Studio, con bóveda cifrada. Ya funciona de extremo a
extremo **en local**, y Daniel lo confirmó a mano (crear, abrir, cerrar,
conversar, ver el `.jsonl` cifrado):

- crear/abrir/cerrar la bóveda, clave de recuperación, desbloqueo por Windows,
  auto-bloqueo configurable;
- conversaciones privadas: se ejecutan en la máquina local **sin pasar por la
  cola de Supabase** (`run_local_turn`), se cifran y se guardan en
  `%APPDATA%\Luxy\vault\conversations\<uuid>.jsonl`;
- memoria acumulativa: cada turno envía resumen + 8 últimos turnos, no el hilo
  entero;
- adjuntar y **generar** imágenes/vídeo (adaptador de Xavira conectado), cifrado
  en `vault\media\<hex>.bin`.

Añadido después, **implementado y probado con mocks pero sin ejecutar de verdad**:

- **cuenta**: crear, entrar, salir, y usar la bóveda sólo en este equipo sin
  cuenta. Un ordenador nuevo funciona sabiendo el correo y la contraseña;
- **recuperación**: la clave de recuperación abre desde cualquier ordenador, y
  desde ahí se elige contraseña nueva;
- **vincular** una bóveda anterior a las cuentas, sin recifrar su contenido;
- **sincronización** de turnos entre equipos, autorizada por sesión de cuenta.

### Lo que falta, con nombre y tamaño

Ordenado por lo que más se nota al usarlo:

1. **La API de generación nunca se ha llamado de verdad** (`F9.17`). Es lo único
   que queda del camino y lo único donde espero sorpresas. Lo verificado sin
   gastar créditos: la URL base responde, `GET /v1/generations/<id>` existe y
   devuelve **401** sin credenciales (no 404), y su sobre de error es
   `{error:{code,message,request_id}}`, que encaja con el adaptador. **Sin
   verificar**: los nombres de campo de `POST /v1/images:generate`, la rama
   201-con-`output_url` frente a 202-con-`poll_url`, y la creación de personaje.
   Necesita la clave en Conexiones (`VAULT_MEDIA_API_KEY`) y una generación.
3. **`F9.21` — vídeo grande sin previsualizar.** Se genera y se guarda cifrado,
   pero el tope de 20 MB del IPC impide verlo. Falta un protocolo de Electron
   que sirva el flujo descifrado. Ojo: **sincronizar y previsualizar tienen
   topes distintos** — 90 MB para viajar, 20 MB para verlo.
4. **Un archivo de más de 90 MB no se sincroniza.** Se salta, se cuenta y la
   interfaz lo dice; se queda en el equipo donde se creó. Es el límite del
   cuerpo de una petición a un Worker (`D-050`).
5. **Los objetos huérfanos no se limpian.** Borrar una conversación borra sus
   filas en cascada, pero los bytes se quedan en el almacén. No rompen nada y no
   son legibles; falta una limpieza.
6. **Sin streaming** (`D-043`). Cada respuesta aparece entera al terminar. Es
   deliberado, no un olvido: cambiarlo sería revisar la decisión, no completar
   un paso.
7. **`F9.12` — documentación de privacidad.** `docs/PRIVACY.md`, `SECURITY.md` y
   el modelo de amenazas siguen sin escribirse. Es la deuda que más cara sale a
   quien llegue nuevo.
8. **`F9.9`** (puente de Telegram por conversación) y **`F9.11`** (invitar a un
   tercero) siguen sin empezar. Ya no están bloqueados por `D-001`: lo matizó
   `D-045`.

### Arquitectura de claves (la que hay que respetar)

```
contraseña ──Argon2id(sal)──► llave maestra (256b, sólo en RAM del main)
                                ├── HKDF ─────────────► subclaves de cifrado (por dominio y objeto)
                                ├── HKDF ─────────────► vault_id (identificador público)
                                └── Argon2id(2ª vuelta)► hash de acceso (lo ÚNICO que autentica en servidor)
```

`ARGON2_PARAMS`: t=3, m=64 MiB, p=1 (~2,7 s medidos; ver `D-040`). Guardados por
envoltura y por cuenta, nunca leídos de la constante al abrir.

La misma llave maestra tiene **dos puertas** en el servidor, con sal, coste,
propósito y hash de acceso propios: la contraseña y la clave de recuperación.
La segunda usa `RECOVERY_ARGON2_PARAMS` (t=1, m=8 MiB) porque no es una
contraseña sino ~157 bits al azar, y encarecer cada intento no compra nada sin
diccionario que probar (`D-049`).

### El estado que NO es intuitivo, y es lo primero a entender

Hasta `F9.18` había **dos orígenes de la misma llave maestra sin unir**. **Ya
están unidos** (`D-047`), y así es como funciona ahora:

- la **cuenta es el origen**. Crear una cuenta genera la llave aquí; entrar en
  ella la trae envuelta del servidor y la abre la contraseña. `vaultId` y
  subclaves salen iguales por los dos caminos, y una prueba lo comprueba
  comparando dos equipos;
- el archivo local `vault.json` es la **caché** de esa llave: la misma, envuelta
  con la misma contraseña, para arrancar sin red. Ya no es una segunda bóveda;
- `VaultService.adoptAccountKey()` es el **único** punto por donde una llave de
  fuera entra en la bóveda. La llave maestra sigue sin salir nunca: lo que sale
  son sobres y hashes construidos con ella dentro;
- una bóveda **sin cuenta** sigue siendo válida —es la que tiene Daniel hoy— y
  se puede **vincular** después sin recifrar nada, con la contraseña que ya la
  abre;
- un equipo guarda la bóveda de **una sola cuenta**. Registrar o entrar con otra
  se corta antes de llamar al servidor.

Lo que sigue sin ejecutarse: **nada de esto ha hablado con Supabase ni con el
gateway real**. Ver el punto 2 de la lista de abajo.

### Estado por paso

| paso | qué es | estado |
| --- | --- | --- |
| F9.1 | `packages/vault-crypto` | done, verificado |
| F9.2 | esquemas `vault.ts` | done |
| F9.3 | `VaultService` (vault local) | done, confirmado a mano |
| F9.4 | cifrado en cliente (`private-store`) | done |
| F9.5 | `run_local_turn` sin cola | done |
| F9.6 | migración `0007` | **rehecha con usuarios; NO aplicada** |
| F9.7 | sincronización | done la lógica; ver aviso |
| F9.8 | higiene de logs/cachés/devtools | done |
| F9.13 | interfaz de la bóveda | done, confirmado a mano |
| F9.14 | conversaciones e2e | done, confirmado a mano |
| F9.16 | almacén de medios (local) | done; remoto no existe |
| F9.17 | adaptador Xavira + generación | implemented; **sin llamada real** |
| memoria | memoria acumulativa | done |
| F9.10 | cuentas de usuario | **implemented (3 capas de lógica); sin ejecución real** |
| F9.18 | interfaz de cuenta y unión de los dos orígenes de la llave | done; sin ejecución real |
| F9.19 | recuperación desde un equipo nuevo | done; sin ejecución real |
| F9.20 | instrucciones fijas por conversación | done |
| F9.16 remoto | los medios viajan entre equipos | done |
| F9.22 | el modelo pide una imagen y se genera sola | done; sin llamada real |
| F9.9 | puente Telegram por conversación | planned |
| F9.11 | transportes del invitado | planned |
| F9.12 | documentación de privacidad | planned |

### Lo que hay que tener en cuenta, sin suavizar

1. **`0007` YA ESTÁ APLICADA** (2026-09-01, por Daniel): las cinco tablas
   `vault_*` con `rowsecurity = true`. A partir de aquí **no se toca**. Lo que
   queda es `0008`, que crea el bucket privado de los medios (`LA-031`, paso 2b).
   Sigue pendiente confirmar que el gateway apunta a ese mismo proyecto (trampa
   3 de `docs/ARRANQUE-ORDENADOR-NUEVO.md`).
2. **Nada del gateway ni de las cuentas se ha ejecutado contra Supabase real.**
   Todo son mocks: gateway falso, cliente falso. Incluida la autorización cruzada
   entre usuarios de `withVaultAuth`, que sólo se confirma con Postgres delante.
3. **Las rutas `/api/vault/*` no están desplegadas.** Existen en el código; falta
   `wrangler deploy` (acción de Daniel, con autorización). Hasta entonces
   sincronizar contra el gateway real falla.
4. **La generación de Xavira nunca ha llamado a la API real.** El contrato viene
   de su documentación pública. La primera llamada de verdad puede desmentir
   nombres de campo o formato de error. La clave va en `SecretStore` como
   `VAULT_MEDIA_API_KEY` (reservada), la pone Daniel en Conexiones.
5. **La sincronización ya se autentica con la sesión de cuenta** (`D-048`), y el
   `vaultId` dejó de viajar. Lo que queda de esto: la sesión **caduca** (30 días)
   y entonces sincronizar deja de funcionar hasta volver a entrar, aunque la
   bóveda se siga abriendo sin conexión. La interfaz lo distingue; no se ha
   probado con un gateway real devolviendo un 401 de verdad.
6. **Vídeo grande**: se genera y guarda, pero no se previsualiza (tope de 20 MB
   del IPC). Falta un protocolo de Electron que sirva el flujo descifrado.
7. **Medios no se sincronizan**: sólo turnos. El almacén remoto (`F9.16` remoto,
   p.ej. R2) no existe.
8. **Sin streaming** en conversaciones privadas (`D-043`), a propósito.
9. **`git config --global` de este equipo sigue sin configurar** (`LA-030`).
10. **La clave de recuperación ya abre desde cualquier ordenador** (`F9.19`).
    Lo que hay que saber de ella: entrar con la clave deja el equipo **sin
    envoltura de contraseña** hasta que se elija una nueva, y vincular una
    bóveda anterior a las cuentas **genera una clave nueva** que invalida la
    anterior. Las dos cosas las dice la interfaz.
11. **Un equipo guarda la bóveda de UNA cuenta.** Registrar o entrar con otra se
    rechaza antes de llamar al servidor: pisar `vault.json` dejaría ilegible, sin
    aviso, todo lo cifrado con la llave anterior. Para cambiar de cuenta en un
    equipo hay que borrar esa bóveda a mano; **no hay botón para eso**, y es un
    hueco conocido.
12. **Salir de la cuenta no borra nada.** Cierra la bóveda y olvida la sesión; lo
    cifrado se queda en el equipo y vuelve a abrirse con la misma contraseña.
13. **El token de sesión vive en `SecretStore`** como `VAULT_ACCOUNT_SESSION`
    (reservado, DPAPI) y **no cruza el IPC**. Una prueba enumera las claves del
    estado que ve el renderer para que no se cuele.
14. **`changePassword` de una bóveda de cuenta no se puede hacer sólo en local**:
    `VaultService` lo rechaza. Primero el servidor, después la envoltura local; al
    revés, un fallo de red dejaría este equipo con una contraseña que ningún otro
    reconoce.
15. **Las instrucciones fijas viven dentro del sobre del turno**, no en un campo
    del registro (`F9.20`). Consecuencia práctica: cambiarlas escribe un turno
    nuevo, y los turnos anteriores conservan las suyas. Es lo que hace que el
    historial no mienta sobre qué las gobernaba.
16. Límites de diseño que van a `docs/PRIVACY.md` (`F9.12`, pendiente): el
    proveedor de IA ve el prompt en claro —la bóveda protege el almacenamiento y
    el transporte propio de Luxy, no lo que un tercero recibe porque el usuario
    decide enviárselo—; Telegram no puede leer ciphertext; DPAPI no protege de
    otro proceso de la misma cuenta; una filtración de la BD entrega N llaves
    envueltas y la contraseña más débil de la organización es el objetivo; quien
    tenga una clave de recuperación abre esa bóveda desde cualquier sitio; el
    servidor no puede restablecer una contraseña; revocar un permiso no recupera
    lo ya descifrado; las migraciones nunca se han probado en Postgres.

### Decisiones que rigen este bloque

`D-039` (contraseña envuelve, no cifra) · `D-040` (coste Argon2 medido) · `D-041`
(propósito autenticado) · `D-042` (sondeo, nunca callback) · `D-043` (sin
streaming) · `D-044` (relleno de longitud) · `D-045` (multiusuario, matiza
`D-001`) · `D-046` (auth y cifrado por caminos separados) · `D-047` (la cuenta
es el origen de la llave; el archivo local es su caché) · `D-048` (sincronizar
autoriza por sesión de cuenta) · `D-049` (la clave de recuperación no se trata
como una contraseña) · `D-050` (los bytes de los medios van a Supabase Storage) ·
`D-051` (el modelo pide la imagen con un bloque, no con una herramienta).

### Siguiente paso exacto (para quien retome)

Los tres sub-pasos de `F9.18` —pantalla de cuenta, unir los dos orígenes de la
llave, sincronizar por sesión— y la recuperación desde otro equipo (`F9.19`)
están **hechos**. Todo el camino crítico de código está cerrado; lo que queda
es ejecutar y documentar.

1. **`LA-031`, la única acción de Daniel que bloquea lo demás.** `0007` ya está
   aplicada; quedan `0008` (bucket de medios), desplegar el gateway, poner la
   clave de Xavira y probar de verdad. Lo que sólo se puede confirmar
   ahí: que un usuario no puede leer los registros de otro (`withVaultAuth`),
   que la bóveda que Daniel ya tiene se vincula sin perder nada, y que el
   contrato del adaptador de Xavira coincide con la API real.

2. **`F9.21`, vídeo grande sin previsualizar.** Es lo único de interfaz que
   queda con efecto visible, y no depende de `LA-031`.

3. **`F9.12`, documentación de privacidad.** Es barata y cierra deuda: es la que
   explica todo esto a quien llegue. Tiene cuatro límites nuevos que contar:
   entrar con la clave de recuperación deja el equipo sin contraseña hasta que
   se elija una; salir de la cuenta no borra lo cifrado de este equipo; quien
   tenga la clave de recuperación abre la bóveda desde cualquier sitio; y un
   equipo guarda la bóveda de una sola cuenta.

Después quedan la limpieza de objetos huérfanos, `F9.9` (puente Telegram) y
`F9.11` (invitar a un tercero).

### F9.22 — done (Claude, 2026-09-02, sin llamada real)

El flujo que faltaba: **pedirle una imagen al personaje dentro de la
conversación y recibirla**. No funcionaba, y no por la clave — la conversación y
la generación eran dos cosas desconectadas y nadie escuchaba al modelo.

Ahora el modelo la pide con un bloque estructurado al final de su respuesta
—mismo patrón que la memoria— y el proceso principal la genera, la cifra y la
guarda en la conversación (`D-051`). El personaje pertenece a la conversación,
como las instrucciones. La herramienta **sólo se ofrece cuando existe de
verdad**: sin personaje o sin clave, la instrucción ni se envía.

Lo que hay que saber al probarlo: si el modelo no escribe el bloque o lo escribe
mal, **no hay imagen y el turno sigue siendo válido**. Es el mismo límite que ya
tiene la memoria.

`npm run check` exit 0: 119 archivos, 2.060 superadas, 9 omitidas.

### F9.20 y F9.16 remoto — done (Claude, 2026-09-01, sin commit)

**Instrucciones fijas por conversación.** Se escriben en la propia conversación,
acompañan a cada turno y se guardan cifradas **dentro del sobre del turno**, no
en un campo del registro: así el historial conserva cuáles regían cada respuesta,
y —lo que decidió el cómo— no hacía falta una columna nueva en `vault_records`,
que era imposible porque `0007` se estaba aplicando en ese momento.

**Los medios ya se sincronizan** (`D-050`). Los bytes van a un bucket privado de
Supabase Storage, que crea la migración `0008`. Suben antes que el registro, y
el gateway rechaza un registro cuyos bytes no estén: al revés, el otro equipo
vería un archivo que no puede abrir. Lo que pasa de 90 MB se salta y se cuenta.

**Rasgos del personaje**: el botón mandaba `{}`; ahora hay dónde escribirlos.

`npm run check` exit 0: 118 archivos, 2.046 superadas, 9 omitidas.

### F9.19 — done (Claude, 2026-09-01, sin commit)

La clave de recuperación abre la bóveda **desde cualquier ordenador**, no sólo
desde el que la creó. El servidor guarda una segunda copia de la llave maestra
cerrada con ella, con propósito y hash de acceso propios, y tampoco puede
abrirla. Detalle en `CHANGELOG-WORK.md` y `D-049`.

Tres consecuencias que la interfaz dice y conviene no olvidar:

- entrar con la clave deja este equipo **sin envoltura de contraseña** —no se
  conoce— hasta que se elija una nueva. El formulario aparece ya desplegado, y
  la prueba que pide es la clave, no la contraseña olvidada;
- **cambiar la contraseña no invalida la clave de recuperación.** El papel del
  cajón sigue valiendo;
- **vincular** una bóveda anterior a las cuentas genera una clave **nueva** y la
  anterior deja de valer.

`npm run check` exit 0: 117 archivos, 2.030 superadas, 9 omitidas.

### F9.18 — done (Claude, 2026-09-01, sin commit)

La avería que impedía usar la bóveda en un segundo ordenador, cerrada. Detalle
completo en `CHANGELOG-WORK.md`; lo esencial:

- **`AccountPanel`** en `Vault.tsx` es la puerta cuando el equipo no tiene
  bóveda: crear cuenta / entrar, y «usar sólo en este equipo» para quien no
  quiera cuenta. **`AccountSection`**, con la bóveda abierta, enseña la cuenta,
  deja salir y ofrece **vincular** una bóveda local anterior.
- **`VaultAccountManager`** (`vault/account-manager.ts`) es el cable: pide la
  llave al cliente de cuentas, se la entrega a `VaultService` y no conserva
  copia. Guarda la sesión en el almacén cifrado (`VAULT_ACCOUNT_SESSION`) y no
  la deja cruzar el IPC.
- **`sync.ts`** se autentica con el token de sesión; el `vaultId` dejó de viajar.
- De paso: la clave de recuperación que devolvía `createAccount` **no envolvía
  nada**; ahora envuelve la copia local. Que no abra desde un equipo nuevo es la
  limitación que queda como `F9.19`.

`npm run check` exit 0: 117 archivos, 2.015 superadas, 9 omitidas. Nada
ejecutado contra Supabase ni contra el gateway real, y no confirmado a mano en
Studio.

### F9.1 — done (Claude, 2026-09-01, sin commit)

`packages/vault-crypto`, puro y sin dependencias nuevas. Sobre AES-256-GCM con
propósito y versión autenticados; Argon2id sólo para la contraseña y HKDF para
las subclaves; llave maestra con tres envolturas independientes (contraseña,
recuperación, equipo); envoltura X25519 con clave efímera para compartir una
conversación sin entregar el resto.

71 pruebas propias. `npm run check` exit 0: 99 archivos, 1.729 superadas, 9
omitidas. Decisiones `D-039`, `D-040`, `D-041`.

Dos correcciones hechas en el código, no en las pruebas: `randomBytes()` sobre
el tope de 65.536 bytes de `crypto.getRandomValues`, y el coste de Argon2 bajado
de 256 MiB (13 s medidos por desbloqueo) a la segunda opción recomendada por
RFC 9106.

### F9.2 — done (Claude, 2026-09-01)

`packages/shared/src/vault.ts`: la forma de lo que viaja cifrado, separada de la
criptografía. Nivel `cloud` | `private` sin estado intermedio, lista cerrada de
propósitos, registro privado **sin ningún campo donde quepa texto en claro**,
medio con clave de objeto opaca, puente de Telegram apagado por defecto,
invitaciones y permisos por conversación.

`findPlaintextLeaks()` / `assertNoPlaintextLeak()` convierten en código
ejecutable la regla de que una conversación privada no envía contenido en claro,
y la ejecutan los dos lados. Exime los valores que ya son un sobre válido.

35 pruebas. `npm run check` exit 0: 100 archivos, 1.764 superadas.

### Xavira — API verificada en su documentación pública

`GET /v1/generations/:id` permite **polling**, y el callback es opcional. Luxy
no necesita exponer ningún endpoint público: el agente pregunta y descarga
directo, y el Gateway no ve el resultado. Sin esto, la premisa de `F9` no se
sostendría para vídeo. Detalle en `CHANGELOG-WORK.md`.

### F9.3 — done (Claude, 2026-09-01)

`VaultService` en el proceso principal. La llave maestra sólo vive en su
memoria; lo único que sale es `subkeyFor(dominio, contexto)`, y sólo dentro del
main. `status()` es lo único que cruza el IPC, y una prueba enumera sus claves
para verificar que no lleva material criptográfico.

El bloqueo automático se comprueba por reloj y no con un temporizador, porque un
temporizador no se entera de que el equipo estuvo suspendido. Cambiar la
contraseña exige la actual aunque la bóveda esté abierta.

Cerrada de paso una brecha: el renderer podía fijar cualquier secreto cuyo
nombre apareciese como `apiKeyEnv`, así que bastaba declarar un proveedor
llamado `VAULT_DEVICE_KEY` para pisar la llave del equipo. Añadido
`RESERVED_SECRET_NAMES`.

38 pruebas. `npm run check` exit 0: 101 archivos, 1.802 superadas.

**Pendiente de F9.3**: los canales IPC existen y están validados, pero **ninguna
pantalla los usa todavía**. La bóveda no es visible ni usable desde Studio.

### F9.4 — done (Claude, 2026-09-01)

`private-store.ts` es la frontera por la que sale todo lo privado: contenido en
claro entra, registros que el gateway puede almacenar salen. `sealTurn` y
`sealMedia` pasan por `assertNoPlaintextLeak()` como último paso, así que el
guardián ya no es una regla escrita sino una que se ejecuta.

Dentro del cifrado: texto, título, proveedor, modelo, tokens, `mimeType`,
nombre, prompt, `characterId`, dimensiones y duración. Fuera, como metadato
asumido: que existe un registro, de qué conversación, su orden, cuándo y cuánto
ocupa.

Sobre binario nuevo (`sealBlob`) para imágenes y vídeo: coste fijo de 29 bytes
en vez del 33% que añadiría base64. Miniaturas cifradas con su propia subclave.
Claves de objeto aleatorias, nunca derivadas del contenido ni del nombre.

31 pruebas nuevas. `npm run check` exit 0: 103 archivos, 1.833 superadas.

**Pendiente**: esto sella y abre, pero **todavía no sube nada**. No hay cliente
de almacén de objetos, ni endpoints en el gateway, ni migración.

### F9.5 — done (Claude, 2026-09-01)

Un turno privado ya se ejecuta en la máquina local sin tocar la cola de
Supabase. En vez de escribir un segundo ejecutor, se construye un trabajo
sintético y se pasa por `runJob`, marcado como conversación: esa etiqueta ya
activa el camino de sólo lectura, así que un turno privado hereda la garantía
de no tocar archivos en vez de reimplementarla.

El aislamiento se consigue **no dando** las tres piezas que hablan con el
gateway: los eventos van a quien llama y no a la `EventQueue`, el resultado se
devuelve y no se persiste, y `downloadAttachment` lanza
`LocalTurnIsolationError` en vez de llamar. La prueba que lo sostiene espía
`globalThis.fetch` durante un turno completo y verifica **cero llamadas**.

Lo que se pierde, y está escrito en el propio archivo: no hay lease, no hay
reintento tras un corte y no hay historial en el servidor. Si Luxy se cierra a
media respuesta, esa respuesta se pierde.

12 pruebas. `npm run check` exit 0: 104 archivos, 1.845 superadas.

**Pendiente**: `runLocalTurn` exige el agente en marcha. El proceso principal
todavía **no envía** estas peticiones: el canal existe y el host lo atiende,
pero nadie lo llama aún.

### Corrección del plan — 2026-09-01

Daniel preguntó si el hueco de interfaz que yo repetía al cerrar cada paso
estaba planeado. **No lo estaba**, y no faltaba una fila: faltaban las cuatro
capas que consumen la bóveda. Añadidos `F9.13`–`F9.17` en `MASTER-PLAN.md`
con su causa y el camino crítico. Los IDs cerrados no se renumeran.

El camino hasta la primera imagen privada **no es el orden numérico**:
`F9.13` → `F9.14` → `F9.17` da una imagen privada guardada sólo en local;
`F9.6` → `F9.15` → `F9.16` añade la sincronización entre equipos.

Daniel eligió `F9.13`.

### F9.13 — done, confirmado a mano (2026-09-01)

Sección **Privado** en Studio: crear, abrir, cerrar y ajustar la bóveda. Con la
bóveda cerrada no se muestra nada de su contenido, y el indicador de la barra
es un punto y nunca un recuento, porque un número ya diría cuántas hay.
Daniel lo vio funcionando.

Después, a raíz de sus preguntas: el cierre automático pasa a ser configurable
(1, 5, 15, 30, 60, 240 minutos o nunca) porque los 5 minutos eran una constante
que elegí yo; y la pantalla avisa de que «recordar en este equipo» y «cerrar
sola» se contradicen, cosa que antes callaba.

### F9.14 — done, confirmado a mano (2026-09-01)

Conversaciones privadas de extremo a extremo. Escribes, el agente responde sin
pasar por la cola, y todo queda cifrado en `vault/conversations/<uuid>.jsonl`.

Daniel pegó el archivo real: sin texto, sin título, sin proveedor, sin modelo, y
los cuatro nonces distintos. **Pero al medirlo apareció una fuga**: AES-GCM no
rellena, así que el tamaño del sobre revelaba el del mensaje y con eso se
reconstruía la forma de la conversación. Añadido `padding.ts`: el texto se
rellena a múltiplos de 256 bytes, con marca `LXP1` para que lo guardado antes
se siga abriendo.

Precio asumido y documentado: **no hay streaming** en una conversación privada.

### F9.8 — done (2026-09-01)

Era la condición dura antes de usar la bóveda con contenido real, y ya está
levantada. La fuga grave: `devTools` no estaba configurado y su valor por
defecto es `true`, así que con la bóveda abierta cualquiera podía pulsar
Ctrl+Shift+I en la aplicación instalada y leer las conversaciones descifradas
**sin la contraseña**. Además: volcados de fallo redirigidos y nunca enviados, y
una prueba que fija que un turno privado no dispara notificaciones.

### F9.17 — implemented, sin verificar contra la API real (2026-09-01)

Adaptador de generación de imagen y vídeo. Usa **sondeo y no `callback_url`**,
aunque la API lo ofrezca: un callback exigiría una URL pública y el contenido
pasaría por el gateway. Hay prueba de que la petición nunca lo incluye.

Una prueba encontró que `redact()` no tapaba la clave de API, porque llega por
parámetro sin pasar por el registro de secretos: añadido `stripKey()`.

**No se ha llamado a la API real ni una vez**, y el adaptador **no está
cableado**: ninguna parte de Luxy lo llama. Por eso no está en `done`.

### Estado real a 2026-09-01

Hecho y confirmado a mano: `F9.0`–`F9.5`, `F9.8`, `F9.13`, `F9.14`.
Hecho sin verificar contra el exterior: `F9.17`.
Pendiente: `F9.6`, `F9.7`, `F9.9`, `F9.12`, `F9.15`, `F9.16`.
Bloqueado por `D-001`: `F9.10`, `F9.11`.

Lo que YA se puede usar: crear la bóveda, abrirla, cerrarla, conversar en
privado y que se guarde cifrado en este equipo.
Lo que NO: sincronizar entre equipos, y generar imágenes o vídeo.

### F9.6 y F9.15 — implemented, sin ejecución real (2026-09-01)

Migración `0007_luxy_vault.sql` y endpoints de sincronización.

El problema de fondo era **de quién es un registro privado**: con sólo el token
de máquina, lo del portátil no se ve desde el sobremesa. Resuelto con
`vault_id`, derivado de la llave maestra con HKDF: dos equipos que abren la
misma bóveda obtienen el mismo valor sin coordinarse, y el servidor lo guarda
sin aprender nada de la llave.

**Límite escrito en la migración**: el `vault_id` agrupa, **no autoriza**. Si
algún día entra `F9.10` (usuarios), hay que revisarlo antes de abrirlo a nadie.

El gateway ejecuta `assertNoPlaintextLeak` sobre cada registro antes de
guardarlo, aunque el escritorio ya lo compruebe: un servidor que confía en que
el cliente hizo los deberes acaba guardando lo que no debe.

**La migración no se ha ejecutado contra ningún Postgres** (riesgo conocido nº3)
y **el escritorio todavía no sincroniza**: los endpoints existen y nadie los
llama.

### F9.16 — implemented en su parte local (2026-09-01)

Daniel pidió cerrar primero el camino de medios. `BlobStore` guarda los bytes
que `sealMedia` ya devolvió cifrados, y `PrivateMediaStore` une el registro con
los archivos.

`blob-store.ts` **no cifra**: si lo hiciera, habría dos sitios decidiendo cómo
se protege un archivo y acabarían discrepando.

Orden de escritura: bytes primero, registro después. Si falla a medias queda un
huérfano recuperable en vez de un registro que apunta a nada.

Todo se guarda como `.bin`, también el vídeo: un `.mp4` junto a un `.png` ya
diría que hay vídeo, y Windows generaría miniaturas de ambos. Nunca se escribe
una copia sin cifrar a disco, ni temporal.

17 pruebas. `npm run check` exit 0: 111 archivos, 1.941 superadas.

**Pendiente en F9.16**: la implementación remota no existe, sólo la local. Y
**nadie llama al almacén todavía**: no hay IPC ni interfaz para adjuntar o ver
un medio.

**Limitación conocida, anotada como trabajo aparte**: devolver los bytes en
memoria vale para una imagen, no para un vídeo de cientos de megas.
Reproducirlo sin escribirlo a disco exigirá un protocolo propio de Electron que
sirva el flujo descifrado.

### Medios conectados a la interfaz — implemented (2026-09-01)

Ya se pueden adjuntar y ver imágenes y vídeos dentro de una conversación
privada. La ruta la elige el usuario en un diálogo nativo del proceso
principal: el renderer no propone ninguna, porque si pudiera tendría una vía
para leer cualquier archivo del equipo a través de Luxy.

Los bytes descifrados **no se guardan en el estado del renderer**: se piden al
abrir y se sueltan al cerrar.

Tope de previsualización de 20 MB. Por encima se devuelve el tipo pero no el
contenido, y la interfaz dice por qué. Un vídeo grande sigue sin poder verse,
pero ahora el límite es **visible** en vez de silencioso.

Borrar una conversación borra primero sus medios.

**Sin confirmación manual**: no se ha adjuntado ni visto un medio real.

Siguiente paso exacto: el cliente de sincronización que use los endpoints de
`F9.15` — subir lo nuevo y bajar lo que falte. O `F9.12`, la documentación de
privacidad, que sigue pendiente y es la que explica todo esto a quien llegue
después.

---

## F4.9-DYNAMIC-HTTP-PROVIDERS — proveedores HTTP configurables desde Studio

Estado: **`done` — Codex, 2026-08-27**

Objetivo cerrado: permitir añadir, editar, activar, desactivar y eliminar desde
Studio un proveedor HTTP compatible con `chat completions`, guardar su clave
cifrada y hacer que el agente lo use tras aplicar la configuración, sin editar
`config.json` a mano.

Resultado verificado:

- formulario completo en Conexiones y disponibilidad dinámica en Trabajos y
  Conversaciones;
- validación Zod de identificador, URL, modelo, límites y duplicados;
- clave ligada a la configuración y guardada en `SecretStore`, con invalidación
  al eliminar el proveedor o cambiar su endpoint;
- recarga inmediata si el agente está libre y diferida si ejecuta un trabajo;
- `npm run check`: lint, tipos y builds correctos; 96 archivos, 1.656 pruebas
  superadas y 9 omitidas;
- commit local autorizado y creado; ninguna API real, push, deploy ni migración
  ejecutados.

Estado real de partida:

- rama aislada `luxy/f4-9-dynamic-http-providers`, basada en `main` @ `2ae1291`;
- `main` y `origin/main` ya coinciden en `2ae1291`; `LA-028` quedó superada por
  el estado real aunque la documentación anterior todavía la presenta pendiente;
- el commit `2ae1291` permite guardar claves de entradas ya existentes en
  `providers.http`, pero no crear ni editar esas entradas desde Studio;
- `LuxyAgent.initializeProviders` ya construye `HttpApiProvider` desde la
  configuración y el flujo IPC ya puede reiniciar el agente;
- Codebase Memory está operativo sobre `main` @ `2ae1291`. La cobertura de los
  archivos candidatos no registra huecos, pero marca metadata cambiada; por eso
  se contrasta el grafo con el código fuente del worktree antes de editar.

Criterios de aceptación:

1. Studio administra el proveedor completo: identificador, nombre, URL base,
   modelo, clave, estado, streaming y límites seguros.
2. Toda entrada se valida con Zod; no se aceptan URLs inseguras ni nombres de
   secreto arbitrarios que no correspondan a la configuración guardada.
3. Las claves permanecen fuera de `config.json`, cifradas por `SecretStore`.
4. Guardar reinicia o actualiza el agente para que el proveedor aparezca en los
   selectores sin reiniciar Luxy manualmente.
5. Eliminar o cambiar el identificador de clave borra el secreto huérfano.
6. No se llama a ninguna API real; lint, typecheck, suite y build quedan verdes.

Archivos previstos: esquemas shared; store/IPC/configuración y renderer de
Desktop; pruebas de contratos, almacenamiento, IPC/UI y runtime; documentación
de continuidad. Sin commit, push, deploy ni migraciones.

Siguiente paso exacto: integrar el commit local en `main` y ejecutar `LA-029`
para publicar el Gateway, reconstruir Desktop/agente y validar desde Studio una
API elegida por Daniel.

---

## Checkpoint de continuidad — 2026-08-21 (rama renombrada a `main`)

`LUXY-CONSOLIDATION-001` está cerrada (`done`). Después de cerrarla, Daniel
pidió un saneamiento final del checkpoint (secretos protegidos en
`.gitignore`, scratch temporal eliminado, `.codebase-memory/artifact.json`
documentado como problema de diseño abierto — ver `AI-WORK-PROTOCOL.md` §9)
y, tras eso, renombrar la rama canónica a un nombre claro.

**La rama local dejó de llamarse `feat/luxy-desktop` y ahora es `main`**
(`git branch -m`, cambio puramente local). El remoto ya tenía `origin/main`
como rama por defecto (`origin/HEAD -> origin/main`), en `c6e5094`, que es
**ancestro directo** del HEAD actual: no hay divergencia, así que el push
pendiente es un fast-forward limpio, no una reescritura de historia.
`origin/feat/luxy-desktop` (`65ca161`) queda intacta en el remoto sin
actualizar; qué hacer con ella (dejarla o borrarla) es una decisión
pendiente y separada.

- **Línea canónica actual**: `C:\Users\daniel\Desktop\Luxy`, rama `main`,
  HEAD `02c2080`. Copia operativa real (registrada en
  `%APPDATA%\Luxy\config.json`).
- `git worktree list` contiene únicamente esa copia.
- **Push pendiente, bloqueado por el entorno** (no por falta de
  autorización): `git push origin main` fue denegado dos veces por el
  sistema de permisos de esta sesión sin mostrar ningún prompt. Registrado
  como acción manual de Daniel en `LOCAL-ACTIONS.md`, `LA-028`, con el
  comando exacto.
- Working tree limpio salvo el ruido conocido y ya documentado de
  `.codebase-memory/artifact.json`/`graph.db.zst` (el watcher del MCP los
  reescribe en cuanto detecta cualquier cambio; no es un problema de
  producto, ver `AI-WORK-PROTOCOL.md` §9).
- Sin secretos tracked ni staged. Sin cambios de producto sin commitear.

Siguiente acción exacta: Daniel ejecuta `LA-028` (`git push origin main`)
desde una terminal fuera de esta sesión. Después, decidir si se actualiza o
se borra `origin/feat/luxy-desktop` en el remoto, y si se cambia el branch
por defecto de GitHub (si no lo estuviera ya en `main`). Ninguna de las dos
cosas se ha hecho todavía.

---

## Checkpoint de continuidad — 2026-08-21 13:30 (histórico — branch aún `feat/luxy-desktop` en este momento)

Paso cerrado: **LUXY-CONSOLIDATION-001 — consolidación de los ocho worktrees**

Estado: **done — Claude, 2026-08-21**

### Qué es esta tarea

Antes de esta sesión existían ocho worktrees de Luxy sin una línea canónica
declarada: el checkout principal (`feat/luxy-desktop`) con cambios locales
sin commitear, y siete worktrees más creados por el propio agente de Luxy
para tareas anteriores (`luxy/consolidate-worktrees`, `luxy/auto-init-git`,
`lux/bug-hunyuan-backcompat`, `luxy/timeout-deepseek-agentic`,
`luxy/work-update-001-studio`, `luxy/phase-4d-session-host`,
`luxy/ux-001-detalle-trabajo`), cada uno con trabajo real, parte ya
commiteado y parte sin commitear. `LUXY-CONSOLIDATION-001` audita las ocho
líneas, unifica el trabajo válido en una sola y elimina lo redundante.

Detalle completo, cronológico y con evidencia de cada paso: `CHANGELOG-WORK.md`,
entradas del 2026-08-21 bajo `LUXY-CONSOLIDATION-001`. Este archivo sólo
resume el estado final; no repite esa evidencia.

### Estado final

- **Línea canónica**: `C:\Users\daniel\Desktop\Luxy`, rama `feat/luxy-desktop`,
  HEAD `e40268a`. Es tu copia operativa real (registrada en
  `%APPDATA%\Luxy\config.json`).
- **`git worktree list` contiene únicamente esa copia.** Los ocho worktrees
  originales quedaron en uno solo:
  - `luxy/consolidate-worktrees` (HEAD `11dff48`) se identificó como la mejor
    base — descendiente lineal de `feat/luxy-desktop`, sin divergencia — y ya
    integraba como commits `luxy/auto-init-git`, `luxy/ux-001-detalle-trabajo`
    y `luxy/phase-4d-session-host`.
  - Se le añadió un bloque nuevo: diálogo de confirmación React embebido en
    `Studio.tsx` (sustituye `window.confirm()`, mismo patrón que ya usaba
    `Laboratory.tsx`; decisión de Daniel de no adoptar el diálogo IPC nativo
    alternativo de `lux-bug-hunyuan`) y la ficha editable de proyecto de
    `lux-auto-init-git` (`project-profile.ts`, panel «Ficha · alias» en
    `Config.tsx`, CSS asociado, decisiones `D-034`–`D-037`).
  - Ese bloque se commiteó (`e40268a`) y se fusionó en `feat/luxy-desktop`
    por fast-forward.
  - Los cuatro worktrees restantes con cambios sin commitear
    (`lux-bug-hunyuan`, `lux-timeout-deepseek`) o ya limpios
    (`phase-4d-session-host`, `ux-001-detalle-trabajo`, y el propio
    `luxy-consolidate-worktrees`, redundante tras la fusión) se auditaron
    archivo por archivo contra `e40268a` y se confirmó que no aportaban nada
    único: se eliminaron con `git worktree remove --force`. Sus ramas locales
    siguen existiendo (no se borraron ramas, sólo carpetas de trabajo).
- **`git stash@{0}`** (snapshot previo a la fusión) se auditó completo: de
  25 archivos, sólo cinco encabezados históricos de `TEST-RESULTS.md`
  (validaciones manuales del 2026-08-11 sobre el catálogo de modelos) no
  habían llegado a la línea canónica; se rescataron. El resto ya estaba
  integrado o superado. El stash se descartó (`git stash drop`) tras esa
  auditoría.
- **Memoria MCP** (`codebase-memory-mcp`, proyecto `C-Users-daniel-Desktop-Luxy`)
  reindexada explícitamente sobre `e40268a` (4.474 nodos, 14.190 aristas).
  Verificada: `get_architecture` recupera los ocho paquetes reales del
  monorepo; `search_graph` localiza símbolos añadidos en esta misma sesión
  (`buildProjectProfileUpdate`, `resolveHttpRequestTimeout`) en su ubicación
  exacta.
- **Verificación completa en la copia canónica**: `npm run typecheck`,
  `npm run lint` y `npm run build` limpios; `npm test` → **94 archivos, 1.641
  pasadas, 9 omitidas, 0 fallos**. (`npm install` fue necesario una vez, a
  mitad de la fusión: `node_modules` llevaba desde el 1 de agosto sin
  refrescar y producía errores de tipo falsos.)

### Checkpoint final — 2026-08-21 13:50

- `git status --short --branch`: sólo documentación de continuidad
  modificada (`AI-WORK-PROTOCOL.md`, `CHANGELOG-WORK.md`, `CURRENT-TASK.md`,
  `LOCAL-ACTIONS.md`, `MASTER-PLAN.md`, `PROJECT-STATE.md`,
  `TEST-RESULTS.md`) y los artefactos regenerados de memoria MCP
  (`.codebase-memory/artifact.json`, `.codebase-memory/graph.db.zst`); el
  resto son archivos sin seguimiento ya conocidos (claves, demos, respaldo
  temporal, `.wrangler-manual.toml`, el propio scratch de la matriz). **Sin
  commitear** — pendiente de que Daniel autorice ese commit.
- `git worktree list`: **una sola línea**,
  `C:/Users/daniel/Desktop/Luxy e40268a [feat/luxy-desktop]`.
- `npm run lint`: sin incidencias.
- `npm run typecheck`: sin errores.
- `npm test`: **94 archivos, 1.641 pasadas, 9 omitidas, 0 fallos**.
- `npm run build`: correcto en los cuatro workspaces.
- `git diff --check`: sin salida (sin conflictos ni espacios en blanco
  problemáticos).
- Comprobación de secretos: los dos archivos de claves siguen sin
  seguimiento, no aparecen en `git status` como candidatos a commit; escaneo
  de patrones (`sk-…`, `api_key`, `service_role`, `Bearer …`, bloques PEM)
  sobre los documentos tocados esta sesión sin coincidencias.
- Ninguna API real, migración, deploy ni push.

`LUXY-CONSOLIDATION-001` queda **cerrada**. El resumen completo pedido por
Daniel (rama, HEAD, worktrees eliminados/restantes, stash, bloques
integrados/descartados, pruebas, memoria MCP, documentación, validación
manual pendiente, riesgos) se entregó en el chat al cerrar esta tarea.

### Riesgos y validación manual pendiente, conocidos ya ahora

- **Ningún push** de ninguna rama. `feat/luxy-desktop` está 21+ commits por
  delante de `origin/feat/luxy-desktop`.
- **Sin migraciones ni deploy.**
- `npm install` durante la fusión informó **12 vulnerabilidades (5 moderate,
  6 high, 1 critical)** en dependencias. Registrado como hallazgo de
  seguridad; **no se ejecutó `npm audit fix` ni `--force`** por instrucción
  explícita de Daniel — se audita aparte, después de cerrar esta
  consolidación, para no introducir cambios incompatibles sin control.
- `.codebase-memory.pre-merge-backup/` (índice MCP local anterior a la
  fusión, regenerable) sigue en disco: el entorno denegó el permiso para
  borrarlo por comando. Acción manual de Daniel si quiere limpiarlo — ver
  `LOCAL-ACTIONS.md`.
- No hay validación manual de UI pendiente conocida: los cambios de este
  bloque (diálogo de confirmación, ficha de proyecto) están cubiertos por
  pruebas automatizadas, pero nadie los ha visto todavía corriendo en Studio.
  No es bloqueante para cerrar la consolidación; sí conviene probarlo la
  próxima vez que abras Studio.

### Siguiente tarea después de `LUXY-CONSOLIDATION-001`

Ninguna todavía. Por instrucción explícita de Daniel, no se empieza el nuevo
`MASTER-PLAN.md` empresarial hasta que esta consolidación quede cerrada y
Daniel, ChatGPT/Codex y Claude lo redefinan juntos.

---

## Historial de trabajo anterior a esta consolidación

Los pasos `F0`–`F4` (respuestas largas, memoria, catálogo de modelos,
Laboratorio) y las tareas de continuidad `CONSOLIDATE-WORKTREES-001`,
`BUG-HUNYUAN-002` y `GIT-CHECKPOINT-001` que llevaron a los ocho worktrees
descritos arriba están **todas cerradas** y su código integrado en la línea
canónica actual. El registro completo, paso a paso, vive en
`CHANGELOG-WORK.md` (append-only, nunca se reescribe) y el estado de
capacidades del producto en `PROJECT-STATE.md`. No se repite aquí para que
este archivo siga señalando un único trabajo activo, tal como exige
`AI-WORK-PROTOCOL.md`.
