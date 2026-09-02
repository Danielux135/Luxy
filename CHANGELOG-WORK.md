# Luxy — registro de trabajo de IA

### 2026-09-02 01:10 — Claude — BUG: la clave del proveedor de imagenes no se podia guardar

Daniel abrio Studio para probar y no encontro donde poner la clave. **No estaba
en ningun sitio.**

`VAULT_MEDIA_API_KEY` esta en `RESERVED_SECRET_NAMES`, e
`isSecretNameAllowedForConfig` rechaza los reservados: es la proteccion que
impide apropiarse de un secreto del proceso principal declarando un proveedor
HTTP con ese `apiKeyEnv`. La proteccion es correcta; lo que faltaba era una via
legitima. `F9.17` estaba, en la practica, inutilizable.

Yo lo empeore: llevo varias respuestas diciendo «ponla en Conexiones», y la
documentacion del repo decia lo mismo (`CURRENT-TASK.md`, `LOCAL-ACTIONS.md`).
Era falso desde que se escribio.

- canales nuevos `vaultMediaKeySet` y `vaultMediaKeyDelete`. **El nombre del
  secreto no viaja por el IPC**: lo pone el proceso principal, asi que el
  renderer sigue sin poder elegir que secreto escribe y la proteccion original
  no se toca;
- `vaultStatus` gana `mediaProviderConfigured`: solo el hecho, nunca la clave;
- panel «Proveedor de imagenes» en Privado, que es donde se usa y donde el
  usuario la busca. El panel de generacion avisa cuando falta, en vez de dejar
  que se descubra al pulsar y no recibir nada;
- corregidas las dos menciones falsas en la documentacion.

`npm run check` exit 0: 119 archivos, 2.060 superadas, 9 omitidas.

### 2026-09-02 00:30 — Claude — F9.22: pedir una imagen dentro de la conversacion

Daniel queria probar el flujo entero: pedirle una imagen al personaje dentro de
la conversacion y recibirla. **No funcionaba, y no por la clave de la API**: la
conversacion y la generacion eran dos cosas desconectadas. Se escribia en una y
se generaba en otro panel, a mano, con el prompt y el personaje escritos otra
vez. El modelo no generaba nada porque nadie escuchaba.

- `packages/shared/src/vault-image-request.ts` (nuevo): el modelo pide una
  imagen con un bloque estructurado al final de su respuesta, mismo patron que
  la memoria (`D-051`). El modulo es PURO: decide que hay escrito, no genera,
  no cifra y no habla con nadie, asi que **cada caso limite se prueba sin gastar
  una generacion**;
- la instruccion se añade al prompt **solo cuando generar es posible**. Sin
  personaje o sin clave no se envia: ofrecerle al modelo algo que no puede hacer
  garantiza una promesa incumplida en cada turno;
- **el personaje pertenece a la conversacion**, como las instrucciones fijas, y
  viaja cifrado en el turno. `latestCharacterId` lo lee hacia atras;
- el handler del turno privado separa memoria → imagen → texto visible, genera,
  cifra y guarda. **Una generacion fallida no tira la respuesta de texto**: se
  guarda lo escrito y el fallo se devuelve aparte con su motivo, porque una
  imagen que no aparece sin explicacion parece un cuelgue;
- la generacion se extrae a `generatePrivateMedia`, que usan los dos caminos —el
  panel manual y la peticion del modelo—. Tenerla dos veces garantizaria que una
  se olvide de cifrar o de sondear.

Pruebas: 14 nuevas en `vault-image-request.test.ts`, incluida la convivencia con
el bloque de memoria (los dos se separan y **ninguno acaba guardado como texto
del turno**) y que la herramienta no se ofrece cuando no existe.

**`npm run check` exit 0: 119 archivos, 2.060 superadas, 9 omitidas.** Studio
reconstruido.

Lo que sigue sin comprobarse: **la API de generacion nunca se ha llamado**. Lo
unico verificado contra ella es lo que se puede sin gastar nada — la URL base
responde, la ruta de sondeo existe y pide `Authorization`, y su sobre de error
es `{error:{code,message,request_id}}`, que encaja con lo que asume el
adaptador.

### 2026-09-01 23:40 — Claude — F9.20 y F9.16 remoto: contexto fijo y medios que viajan

Daniel aplico `0007` durante esta sesion (las cinco tablas con `rowsecurity =
true`) y pidio avanzar en paralelo con las dos piezas que no dependian de ello.

**F9.20 — instrucciones fijas por conversacion.** El campo `instructions` de
`buildVaultPrompt` existia y **nadie lo rellenaba**. Ahora se escribe en la
propia conversacion, acompaña a cada turno y se guarda cifrado.

- van DENTRO del sobre del turno y no en un campo propio del registro. Dos
  razones: guardarlas con el turno deja ver que instrucciones regian cuando se
  genero cada respuesta, en vez de dejar solo las de hoy y hacer que el
  historial mienta sobre su origen; y el servidor no ve un campo nuevo, asi que
  **no hacia falta una columna en `vault_records`** — que era imposible, porque
  `0007` se estaba aplicando en ese momento;
- `null` significa «no las toques» y conserva las que hubiera; una cadena vacia
  SI las borra. Sin esa distincion no habria forma de volver atras;
- solo se vuelven a sellar cuando cambian, para no engordar el archivo repitiendo
  lo mismo en cada turno.

**F9.16 remoto — los medios ya se sincronizan.** Era la media verdad que quedaba:
los turnos viajaban y las imagenes y videos no.

- **Supabase Storage y no R2** (`D-050`): el gateway ya tiene la URL y la service
  role key. R2 habria exigido un binding en `wrangler.toml`, que ni se versiona.
  El bucket es privado, sin politicas, y lo crea la migracion **`0008`**;
- rutas nuevas: listar medios, subir y bajar bytes, y registrar. **Los bytes van
  antes que el registro** y el gateway rechaza un registro cuyos bytes no esten:
  al reves, el otro equipo veria un archivo que no puede abrir;
- descargar comprueba en `vault_media` que el objeto es de quien lo pide. La ruta
  ya separa por usuario, pero la autorizacion se decide donde esta registrada la
  propiedad, no en como se construye una ruta;
- tope de 90 MB por objeto, por el limite del cuerpo de un Worker. Lo que no
  cabe **se salta, se cuenta y la sincronizacion sigue**;
- lo que llega se comprueba que se puede ABRIR antes de entrar en el indice,
  igual que en las conversaciones.

**Rasgos del personaje.** El boton «Crear personaje nuevo» mandaba `{}`. Ahora
hay donde escribir rasgos, uno por linea; lo que no encaja se ignora en vez de
inventarse una clave, porque un rasgo mal formado viajaria al proveedor tal cual.

Pruebas nuevas: `media-sync.test.ts` (9) y siete de instrucciones en
`conversation-store.test.ts`. La que sostiene el bloque: un archivo generado en
un equipo se **descifra** en el otro; contar bajadas no demuestra nada.

**`npm run check` exit 0: 118 archivos, 2.046 superadas, 9 omitidas.**

Falta ejecutar contra el gateway real: `0008` sin aplicar y `/api/vault/*` sin
desplegar.

### 2026-09-01 22:50 — Claude — cierre documental de F9.18 y F9.19, y commit

Daniel pidio documentar el estado completo —lo hecho, lo que falta y lo que hay
que tener en cuenta— y autorizo **explicitamente commit y push** de la rama.

- **`MASTER-PLAN.md`**: la tabla de la Fase 9 estaba desfasada en tres filas y
  se corrige con lo que hay de verdad: `F9.6` ya no dice «NO aplicar» (la
  migracion esta **completa**, solo sin aplicar), `F9.7` pasa de `planned` a
  implementada con mocks, y `F9.10` deja de decir «sin UI» porque la cuenta ya
  la tiene. Dos filas nuevas: **`F9.20`** (instrucciones fijas por conversacion)
  y **`F9.21`** (protocolo de Electron para medios grandes).
- **`F9.20` sale de un hueco encontrado al revisar el estado**, no de una idea
  nueva: `buildVaultPrompt` acepta un campo `instructions` y **nadie lo
  rellena**. No esta en `vaultConversationSendArgsSchema`, no se guarda con la
  conversacion y no hay donde escribirlo. Quien lea el codigo puede creer que
  hay contexto persistente por conversacion; no lo hay.
- **`CURRENT-TASK.md`**: cabecera nueva que separa lo que queda en tres tipos
  —ejecucion (Daniel), piezas pendientes (IA) y deuda de documentacion—, una
  seccion **«Lo que falta, con nombre y tamaño»** ordenada por cuanto se nota, y
  cinco avisos nuevos en la lista de «tener en cuenta»: un equipo guarda la
  boveda de UNA cuenta y **no hay boton para borrarla**; salir no borra nada; el
  token de sesion no cruza el IPC; `changePassword` de una boveda de cuenta se
  rechaza en local a proposito; y el campo `instructions` es codigo muerto hoy.
- **`PROJECT-STATE.md`**: resumen de lo que falta con punteros.
- Sin cambios de codigo. `npm run check` exit 0: 117 archivos, 2.030 superadas,
  9 omitidas.

Commits hechos (`76511e2` codigo, `d7c57e8` documentacion). **El push lo denego
el sistema de permisos de la sesion**, igual que en `LA-028` y `LA-030`: no
falta autorizacion de Daniel, hay que lanzarlo desde una terminal fuera de la
sesion. Registrado en `LOCAL-ACTIONS.md` como `LA-032`, en `pending`.

### 2026-09-01 22:20 — Claude — F9.19: la clave de recuperacion abre desde cualquier equipo

Daniel lo pidio explicitamente al leer la limitacion de `F9.18`. Hecho antes de
aplicar `0007`, que es lo que permitia meter las columnas sin una migracion
aparte. Sin commit, push, deploy ni migracion aplicada.

**El problema que se cierra.** La clave de recuperacion se generaba, se mostraba
una vez, y solo envolvia una copia LOCAL. Desde un ordenador nuevo no servia de
nada: el servidor no tenia ninguna copia cerrada con ella, asi que «he olvidado
la contraseña» seguia siendo «he perdido la boveda» en cuanto cambiabas de
equipo.

**Lo que hay ahora.** La llave maestra se envuelve DOS veces, con dos secretos
independientes y **dos propositos distintos** (`vault.account.masterkey` y
`vault.account.recovery`), y las dos copias viven en el servidor. Son la misma
llave por dos puertas, no dos bovedas.

- `supabase/migrations/0007_luxy_vault.sql`: seis columnas nuevas en
  `vault_users` con sus restricciones, incluida una que **impide que los dos
  hashes de acceso coincidan**.
- `packages/vault-crypto/src/account.ts`: `recoveryForMasterKey`,
  `openAccountWithRecoveryKey` y `passwordCredentialsForMasterKey` (la puerta de
  la contraseña sola, que es lo que sustituye un cambio de contraseña **sin
  tocar la copia de recuperacion**).
- `RECOVERY_ARGON2_PARAMS` en `kdf.ts`: coste bajo a proposito. La clave de
  recuperacion no es una contraseña —~157 bits al azar— y encarecer cada intento
  no compra nada cuando no hay diccionario que probar (`D-049`).
- Gateway: `login/start` entrega **las dos puertas siempre**, tambien en la
  respuesta señuelo de un correo inexistente; `login/finish` y `password`
  aceptan **cualquiera de los dos hashes** como prueba.
- Escritorio: `login(email, secreto, 'password' | 'recovery')`. Entrando con la
  clave, la cache local guarda la envoltura de recuperacion y **no** la de
  contraseña: no se conoce. La sesion recuerda por que puerta se entro.
- Interfaz: «He olvidado la contraseña» en la pantalla de cuenta; con la boveda
  ya abierta, un aviso de que este equipo aun no sabe la contraseña y el
  formulario de cambiarla **ya desplegado**, pidiendo la clave de recuperacion
  como prueba en vez de una contraseña que por definicion no se recuerda.
- Vincular una boveda anterior a las cuentas genera una clave de recuperacion
  **nueva** y la anterior deja de valer: la vieja no se guardo en ningun sitio,
  asi que no habia forma de cerrar con ella una copia para el servidor.
  Se muestra una vez, igual que al crear la cuenta.

Tambien de paso: `VaultUserRow` estaba duplicada en `repository.ts` y en
`vault-auth.ts`. Con columnas nuevas eso se desincroniza el primer dia, asi que
ahora hay una sola definicion.

Pruebas nuevas: siete en `account-manager.test.ts` —recuperar en un segundo
equipo da la MISMA subclave, la clave se acepta escrita de forma descuidada, el
equipo recuperado no guarda contraseña, se puede elegir una nueva con la clave
como prueba, y cambiar la contraseña **no** invalida la clave— mas seis en
`account.test.ts` y dos en `handlers/vault.test.ts` (el señuelo trae las dos
puertas; los sobres cruzados no cuelan).

**`npm run check` exit 0: 117 archivos, 2.030 superadas, 9 omitidas.**

Sigue sin ejecutarse nada contra Supabase ni el gateway real: eso es `LA-031`.

### 2026-09-01 21:30 — Claude — F9.18: la cuenta y la boveda, unidas

Los tres sub-pasos que dejaba `CURRENT-TASK.md`, hechos en ese orden. Sin
commit, sin push, sin deploy y sin migracion aplicada.

**1. Pantalla de cuenta** (`apps/desktop/src/renderer/pages/Vault.tsx`,
`useVault.ts`). Sin boveda en este equipo, la puerta ya no es «crear
contraseña» sino `AccountPanel`: crear cuenta / entrar, con «usar solo en este
equipo» como salida para quien no quiera cuenta. Con la boveda abierta,
`AccountSection` enseña la cuenta, deja salir, y ofrece **vincular** una boveda
local que existiera desde antes. La pantalla distingue «cerrada» de «sin
sesion»: son problemas distintos y se arreglan distinto.

**2. Los dos origenes de la llave, unidos.** `VaultService.adoptAccountKey()`
es el unico punto por donde entra una llave maestra de fuera: adopta la de la
cuenta y deja en disco la misma llave envuelta con la misma contraseña. El
archivo local deja de ser una segunda boveda y pasa a ser **cache** (`D-047`).
La prueba que lo sostiene compara subclaves entre dos equipos: `subkeyFor` da
lo mismo tras registrar en uno y entrar en otro.

- `VaultAccountManager` (`account-manager.ts`, nuevo) es el cable: llama al
  cliente de cuentas, entrega la llave a `VaultService` y no conserva copia.
  Guarda la sesion en el almacen cifrado (`VAULT_ACCOUNT_SESSION`, reservado) y
  **no la deja cruzar el IPC**.
- `VaultService` gana `adoptAccountKey`, `accountRegistration`,
  `accountAuthHash`, `verifyPassword`, `rewrapLocalPassword`, `bindAccount` y
  `boundAccount`. **La llave maestra sigue sin salir**: lo que sale son sobres y
  hashes construidos con ella dentro.
- `changePassword` de una boveda vinculada se **rechaza** en local: primero el
  servidor, despues la envoltura local. Al reves, un fallo de red dejaria este
  equipo con una contraseña que ningun otro reconoce.
- `registrationForMasterKey` en `@luxy/vault-crypto` permite registrar una llave
  que YA existe: es lo que hace posible vincular sin recifrar nada.
- Un equipo guarda la boveda de **una sola cuenta**; registrar o entrar con otra
  se corta **antes de la red**, para no dejar una cuenta huerfana en el servidor.

**3. Sincronizacion por sesion** (`vault/sync.ts`, `ipc/handlers.ts`). El
`Authorization` lleva el token de sesion y el `vaultId` **deja de viajar**: la
autorizacion es el usuario de la sesion (`D-048`). Un 401 olvida la sesion en
vez de reintentar con el mismo token. En `packages/shared/src/vault.ts` el
`vaultId` de los dos esquemas de sincronizacion pasa a **opcional**, y el
gateway lo ignora en vez de rechazarlo.

Correcciones hechas de paso, porque eran del mismo cable:

- la clave de recuperacion que devolvia `createAccount` **no abria nada**: se
  generaba y no envolvia ninguna copia de la llave. Ahora envuelve la copia
  local, asi que abre en el equipo donde se creo. Que **no** abra desde un
  equipo nuevo es una limitacion real, esta escrita en la propia pantalla y
  queda como `F9.19`;
- salir de la cuenta descarta lo descifrado del renderer en ese momento, no en
  el siguiente refresco.

Pruebas: `account-manager.test.ts` nuevo (18), `sync.test.ts` reescrito para la
sesion, `account-client.test.ts` y `useVault.test.ts` ajustados al contrato
nuevo. **`npm run check` exit 0: 117 archivos, 2.015 superadas, 9 omitidas.**

Sigue sin ejecutarse nada contra Supabase real: `0007` no aplicada, rutas
`/api/vault/*` sin desplegar. Eso es `LA-031`, y ahora ya no esta bloqueada por
falta de interfaz.

### 2026-09-01 20:45 — Claude — checkpoint de continuidad de F9-VAULT-001

- Daniel pidió documentar todo para retomar desde aquí. Sin cambios de código.
- Estado real verificado: rama `luxy/f9-1-vault-crypto`, **25 commits** sobre
  `main` @ `00a9cc1`, árbol limpio. `npm run check` verde (116 archivos, 1.997
  superadas, 9 omitidas).
- Documentos actualizados:
  - **`CURRENT-TASK.md`**: la cabecera de `F9-VAULT-001`, que estaba obsoleta
    («sin empezar»), pasa a ser el **punto de retoma canónico**: qué funciona hoy
    en local, la arquitectura de claves, la tabla de estado por paso, los **diez
    puntos a tener en cuenta sin suavizar**, las decisiones que rigen el bloque, y
    el **siguiente paso exacto** en cuatro sub-pasos ordenados. Los bloques `F9.x`
    de más abajo se conservan como historial.
  - **`PROJECT-STATE.md`**: resumen de la capacidad y puntero al punto de retoma.
  - **`LOCAL-ACTIONS.md`**: `LA-031`, `blocked` — aplicar `0007`, desplegar el
    gateway y probar la bóveda real. Marcada explícitamente como «NO ejecutar
    todavía» hasta que exista la interfaz de cuenta.
  - **`MASTER-PLAN.md`**: estado global de la Fase 9.
- El aviso central, repetido en los tres sitios para que no se pierda: **hay dos
  orígenes de la misma llave maestra sin unir** —vault local (`vault.json`, lo
  que funciona) y vault de cuenta (`account-client` + gateway, recién hecho)— y
  **`0007` no debe aplicarse hasta unirlos**, porque dejaría tablas que nada usa.
- Nada probado contra Supabase real; rutas `/api/vault/*` sin desplegar;
  generación de Xavira sin llamada real; sincronización aún autenticándose por
  token de máquina en vez de por sesión de cuenta.
- Siguiente paso exacto (documentado en `CURRENT-TASK.md`): pantalla de cuenta
  (registro/login/logout), unir los dos vaults, sincronizar por sesión, y sólo
  entonces `LA-031`.

### 2026-09-01 20:30 — Claude — F9.10, cuentas de usuario (tres piezas)

- `F9.10` en tres commits, por su tamaño. `D-045` y `D-046` lo guiaban.
- **Pieza 1 — criptografía y contrato** (`ffbb9e6`): `account.ts` compone
  `createAccount` / `openAccount` / `rewrapAccountPassword` sobre lo que ya
  existía. `vault-auth.ts`, el contrato de registro, login en dos pasos y cambio
  de contraseña. 10 pruebas.
- **Pieza 2 — gateway** (`370d6d6`): endpoints de cuenta y `withVaultAuth`. La
  corrección de `D-045`: la autorización pasa a ser por `owner_user_id`, no por
  `vault_id`. Un token de una cuenta no da acceso al contenido de otra.
  Rate limiting en register/login, que era el hueco que el `CLAUDE.md` del
  gateway señalaba. 16 pruebas.
- **Pieza 3 — cliente** (este commit): `account-client.ts`. Registra y abre una
  cuenta contra el gateway sin que la contraseña salga del equipo. 8 pruebas con
  un gateway falso con memoria que reproduce register + login + password.
- Propiedades que quedan verificadas de extremo a extremo, con mocks:
  - lo que se envía al registrarse **no lleva la contraseña**; la maestra viaja
    envuelta;
  - un login con contraseña incorrecta **falla en local** y ni siquiera llega a
    `login/finish`: el servidor no se entera del intento salvo por el rate limit;
  - un correo inexistente falla igual que una contraseña mala, por el señuelo;
  - el cliente comprueba que el `vaultId` recibido es el que derivó: si el
    servidor le diera otra cuenta, no sigue;
  - cambiar la contraseña reenvuelve la maestra y **no recifra la bóveda**.
- `npm run check` → **exit 0**; 116 archivos, 1.997 superadas.
- **Lo que falta para que esto funcione de verdad**, y es sustancial:
  - **la interfaz de cuenta no existe**: no hay pantalla de registro ni de
    login. `account-client` está escrito y probado, pero nadie lo llama desde la
    UI. El vault local (`vault.json`) y el vault de cuenta **conviven sin unirse
    todavía**: hoy la bóveda se crea en local; falta el flujo que la cree contra
    el servidor y guarde la sesión;
  - la sincronización sigue autenticándose con el token de máquina, no con la
    sesión de cuenta. Cambiarlo es el último cable;
  - **nada se ha probado contra un Supabase real**, porque la migración no está
    aplicada. Todo el gateway se prueba con cliente falso;
  - sin prueba de que withVaultAuth deniega de verdad el acceso cruzado entre
    usuarios: eso necesita Postgres.
- Estado nuevo: `F9.10` **implemented en sus tres capas de lógica**, sin
  interfaz y sin ejecución real.
- Siguiente paso exacto: pantalla de cuenta (registro/login/logout) y unir el
  vault local con el de cuenta, de modo que abrir la bóveda en un equipo nuevo
  sea entrar con la contraseña.

### 2026-09-01 20:10 — Claude — 0007 rehecha con cuentas de usuario

- Estado anterior: `D-045` y `D-046` registradas; `0007` marcada como «no
  aplicar».
- Reescrita `supabase/migrations/0007_luxy_vault.sql` **en el sitio**, no como
  `0008`: no se ha ejecutado nunca contra un Postgres y `CLAUDE.md` sólo prohíbe
  modificar una migración **ya aplicada**.
- Tablas: `vault_users`, `vault_sessions`, `vault_conversations`,
  `vault_records`, `vault_media`.
- **El cambio de fondo**: la propiedad pasa de `vault_id` a
  `owner_user_id uuid not null references vault_users`. Con varias personas,
  agrupar no basta: hay que autorizar. Hay prueba que falla si alguna de las
  tres tablas de contenido pierde esa columna.
- `vault_users` guarda tres cosas y ninguna abre nada:
  - `auth_hash`, la segunda vuelta de Argon2id. Sirve para verificar quién eres
    y para nada más;
  - `wrapped_master_key`, la llave maestra **cifrada**. El servidor la
    transporta y no puede abrirla. Es lo que permite entrar desde un equipo
    nuevo sabiendo sólo la contraseña;
  - `auth_salt` y el coste de Argon2, que son públicos por diseño: el cliente
    los necesita **antes** de poder iniciar sesión.
- El coste de Argon2 se guarda **por cuenta**. Subir el coste por defecto no
  puede dejar fuera a quien se registró antes.
- `vault_id` sigue existiendo, pero sólo en `vault_users` y con otro propósito:
  que el cliente compruebe, tras entrar, que el servidor le ha dado **su**
  cuenta y no otra.
- `vault_sessions` guarda sólo `token_hash`, nunca el token. Mismo criterio que
  `machine_tokens` en 0001, y la prueba que ya lo exigía sigue pasando.
- La clave de objeto de un medio es única **por propietario** y no globalmente:
  dos personas no deben poder descubrir que comparten un archivo por un choque
  de claves.
- `luxy_expire_vault_sessions()` limpia sesiones caducadas. Una sesión caducada
  que sigue en la tabla no da acceso, pero acumular filas muertas acaba costando.
- Pruebas nuevas de invariantes: la bóveda **no guarda contraseñas** (sólo
  hashes) y la llave maestra sólo aparece cifrada; la propiedad es por usuario.
- `npm run check` → **exit 0**; 114 archivos, 1.974 superadas.
- **Inconsistencia conocida y deliberada**: el cliente de sincronización y los
  manejadores del gateway siguen hablando de `vaultId` como si autorizase.
  Compilan y sus pruebas pasan porque el gateway de prueba es falso, pero
  **contra el esquema nuevo no funcionarían**. Es el trabajo de `F9.10`:
  registro, inicio de sesión, sesiones y autorización por usuario.
  Como la migración no está aplicada, nada está roto en ejecución.
- Siguiente paso exacto: `F9.10` — endpoints de registro e inicio de sesión en
  el gateway, y que la sincronización se autorice por usuario en vez de por
  `vaultId`. Sólo entonces se puede aplicar `0007`.

### 2026-09-01 20:05 — Claude — multiusuario decidido; 0007 NO se aplica

- Daniel preguntó, antes de aplicar `0007`, si estaba contemplado que haya
  usuarios únicos. **Parcialmente**, y su respuesta cambió la recomendación.
- Eligió **varias personas, cada una con su cuenta** y **acceso sólo con la
  contraseña** desde un equipo nuevo.
- **`0007` no se aplica.** Con una sola persona, el `vault_id` que agrupa pero
  no autoriza era aceptable; con varias, la máquina de una podría descargar el
  ciphertext de otra. No lo leería, pero lo tendría.
- Se corregirá la migración **en vez de parchearla con una `0008`**: todavía no
  se ha ejecutado contra ningún Postgres, y `CLAUDE.md` sólo prohíbe modificar
  una migración **ya aplicada**. Que Daniel preguntara antes de aplicarla es lo
  que permite arreglarlo bien.
- Decisiones registradas:
  - **`D-045`** — matiza `D-001`: Luxy admite varias personas con cuenta propia.
    El resto de `D-001` sigue vigente. `F9.10` y `F9.11` dejan de estar
    `blocked`.
  - **`D-046`** — la contraseña autentica y cifra, pero por caminos separados.
- Sobre el escrow en la nube: Daniel tiene razón en que es el modelo de
  1Password y Bitwarden, y lo presenté como más exótico de lo que es. Los dos
  matices que sí quedan escritos: «nadie accederá a la base de datos» es la
  premisa que falla justo en el escenario contra el que se diseña, y que la base
  sea local en el futuro no ayuda hoy, que está en Supabase. Con varias personas
  se amplifica: **la contraseña más débil de la organización es el objetivo.**
- **El punto crítico y lo implementado hoy**: si la contraseña, o algo derivado
  de ella con una función barata, se envía al servidor para autenticar, el
  servidor puede derivar las llaves de cifrado y el extremo a extremo desaparece
  sin que nada lo delate.
  `deriveAuthHash()` aplica una **segunda vuelta de Argon2id** sobre la llave
  maestra usando la contraseña como sal. Se invierten los papeles respecto a la
  primera derivación, así que las dos no pueden coincidir por accidente.
- Pruebas nuevas (7), y la que más importa: el hash de acceso **no coincide** ni
  con la llave maestra, ni con ninguna subclave, ni con el `vault_id`. Si
  coincidiera, enviarlo al servidor le entregaría material de cifrado.
- `npm run check` → **exit 0**; 114 archivos, 1.972 superadas.
- Siguiente paso exacto: rehacer `0007` con `vault_users`, propiedad por usuario
  y autorización real en el gateway; después ya se puede aplicar.

### 2026-09-01 20:05 — Claude — cliente de sincronización

- Estado anterior: los endpoints de `F9.15` existían y nadie los llamaba.
- Archivos creados: `apps/desktop/src/main/vault/sync.ts` y su prueba.
- Archivos modificados: `conversation-store.ts` (`rawRecords`,
  `listConversationIds`, `verifyRecord`, `appendRaw`), `vault-service.ts`
  (`vaultId()`), canales, contrato, preload, handlers, hook y pantalla.
- **No hay resolución de conflictos, y no hace falta.** Un turno es inmutable y
  su identidad es (conversación, secuencia): dos equipos no pueden escribir
  cosas distintas en la misma ranura. Lo peor posible es que dos generen el
  turno 5 a la vez, y el servidor se queda con el primero por su clave única.
- **Se sube antes de bajar.** Si el proceso se corta a medias, lo que se pierde
  es trabajo ajeno que se volverá a bajar, no trabajo propio que sólo existía
  aquí. Hay prueba que comprueba el orden de las llamadas.
- **Un registro descargado se verifica antes de guardarse**: se comprueba que
  esta bóveda puede abrirlo. Si entrase uno de otra bóveda o corrupto, cada
  lectura posterior fallaría sin que se supiera cuál es el malo. Hay prueba que
  crea una segunda bóveda de verdad y comprueba que su registro se descarta.
- **La unión de listas local y remota**: sin eso, una conversación creada en el
  otro equipo no se descargaría nunca porque aquí no existe. Con prueba.
- El `vaultId` se deriva **en el proceso principal** y no cruza el IPC. Aunque
  no revele la llave, sigue siendo el dato que agrupa todo lo tuyo.
- Se sincroniza **por conversación** y no de golpe, para que un fallo a mitad
  deje el resto sincronizado en vez de dejarlo todo a medias.
- Comandos:
  - `npx vitest run apps/desktop/src/main/vault/sync.test.ts` → **12/12**.
  - `npm run check` → **exit 0**; 113 archivos, 1.965 superadas.
- Riesgos o límites:
  - **la migración 0007 no está aplicada**, así que sincronizar contra el
    Supabase real fallará hasta que se aplique. `LOCAL-ACTIONS` debería
    recogerlo cuando Daniel decida hacerlo.
  - **los medios no se sincronizan**: sólo turnos. Los blobs siguen siendo
    locales, porque el almacén remoto (`F9.16` remoto) no existe.
  - sincronización **manual**, con un botón. No hay automática ni periódica.
  - sin prueba contra un gateway real: el gateway de las pruebas es falso.
- Siguiente paso exacto: aplicar `0007` y probar la sincronización real, o
  `F9.12` (documentación de privacidad).

### 2026-09-01 19:50 — Claude — generación de imagen y vídeo conectada

- Estado anterior: el adaptador `xavira.ts` existía con 22 pruebas pero nadie lo
  llamaba.
- Archivos modificados: `shared/channels.ts`, `shared/ipc.ts`,
  `preload/index.ts`, `main/ipc/handlers.ts`, `renderer/useVault.ts`,
  `renderer/pages/Vault.tsx`, `renderer/styles.css`.
- **La llamada la hace el proceso principal, no el agente.** El agente existe
  para lanzar procesos y manejar worktrees, y aquí no interviene ninguno de los
  dos. El proceso principal ya tiene red y ya lee secretos cifrados.
- `VAULT_MEDIA_API_KEY` entra en `RESERVED_SECRET_NAMES`, por el mismo motivo
  que la llave del equipo: nadie puede apropiarse de ese nombre declarando un
  proveedor HTTP con ese `apiKeyEnv`.
- Camino completo: generar → **sondear** (`D-042`, nunca callback) → descargar →
  `sealMedia` → disco. Los bytes descargados **no llegan a existir sin cifrar**
  en el sistema de ficheros en ningún momento.
- El log de generación registra sólo el tipo y el tamaño. Ni el prompt, ni la
  conversación, ni la URL del resultado.
- La interfaz muestra los **créditos** que declara el proveedor tras cada
  generación, para que el gasto sea visible y no una sorpresa a fin de mes.
- El panel avisa de que un vídeo puede tardar minutos y de que Luxy sondea. Sin
  eso, una espera de tres minutos parece un cuelgue.
- **Límite escrito en el código y en la interfaz**: el prompt lo recibe el
  proveedor. La bóveda protege lo que Luxy guarda y transporta, no lo que un
  tercero ve porque el usuario decidió enviárselo. Se guarda cifrado junto al
  medio, pero eso no lo retira de los registros del proveedor.
- Comandos: `npm run check` → **exit 0**; 112 archivos, 1.953 superadas.
- Riesgos o límites:
  - **sigue sin llamarse a la API real**. El contrato viene de la documentación
    pública. La primera llamada de verdad puede revelar diferencias en nombres
    de campo o en el formato de error.
  - la creación de personaje envía rasgos vacíos: el catálogo real de rasgos del
    proveedor no está modelado, y el identificador se puede pegar a mano.
  - un vídeo grande se genera y se guarda, pero **no se puede previsualizar**
    por el tope de 20 MB del IPC. Es la limitación ya documentada.
- Siguiente paso exacto: cliente de sincronización.

### 2026-09-01 19:30 — Claude — memoria acumulativa en conversaciones privadas

- Problema: cada turno reenviaba el hilo entero. Con veinte turnos eso
  multiplica coste y latencia y acaba chocando con el límite de contexto.
- **No inventé un formato nuevo.** `conversationMemorySchema`,
  `CONVERSATION_MEMORY_INSTRUCTION` y `parseConversationMemoryResponse` ya
  existían para las conversaciones normales. `vaultMemoryPayloadSchema` pasa a
  envolver ese mismo esquema: dos formas de memoria según dónde viva sería
  garantizar que divergen, y obligaría a escribir dos veces el prompt.
- Archivos creados: `packages/shared/src/vault-prompt.ts` y su prueba.
- Archivos modificados: `vault-payloads.ts`, `conversation-store.ts`
  (`latestMemory`), `main/ipc/handlers.ts`.
- `buildVaultPrompt` es **puro** y vive en shared: sin disco, sin red, sin
  reloj. Así cada caso límite se prueba sin montar una bóveda, que es justo
  donde se esconden los errores de este tipo de código.
- Decisiones con motivo:
  - **8 turnos recientes** literales; lo anterior va en la memoria. Deja ver el
    hilo inmediato —a qué se refiere el usuario cuando dice «eso»— sin
    arrastrarlo todo;
  - si se omiten turnos y **todavía no hay memoria**, se avisa al modelo
    explícitamente. Un modelo que no sabe que le falta contexto se inventa la
    parte que falta con toda naturalidad;
  - **si un turno no aporta memoria válida se conserva la anterior** (`D-019`).
    `latestMemory` busca hacia atrás y devuelve la primera válida: devolver null
    porque el último turno falló sería olvidar la conversación por un tropiezo;
  - la memoria viaja **dentro** de la respuesta y se separa antes de guardar: el
    turno guarda sólo el texto visible, sin el bloque técnico;
  - memoria, turnos y mensaje van marcados como **DATOS**, igual que en el
    prompt de tareas. No elimina la inyección de prompt, la encuadra.
- Medido en prueba: con 40 turnos de 2.000 caracteres, el prompt con memoria
  ocupa **menos de un tercio** del hilo entero.
- Comandos: `npm run check` → **exit 0**; 112 archivos, 1.953 superadas.
- Límite: la memoria la produce el propio modelo. Un modelo que ignore la
  instrucción no la generará, y entonces se conserva la anterior — correcto,
  pero significa que la calidad de la memoria depende del proveedor.
- Siguiente paso exacto: cablear la generación de imagen.

### 2026-09-01 17:50 — Claude — medios conectados a la interfaz

- Estado anterior: `F9.16` local implementado pero sin nadie que lo llamara.
- Objetivo: adjuntar y ver imágenes y vídeos dentro de una conversación privada.
- Archivos modificados: `shared/channels.ts`, `shared/ipc.ts`,
  `preload/index.ts`, `main/ipc/handlers.ts`, `main/index.ts`,
  `renderer/useVault.ts`, `renderer/pages/Vault.tsx`, `renderer/styles.css`.
- **La ruta del archivo la elige el usuario en un diálogo nativo del proceso
  principal.** El renderer no propone ninguna. Si pudiera, tendría una vía para
  leer cualquier archivo del equipo a través de Luxy.
- **Los bytes descifrados no se guardan en el estado del renderer.** Se piden al
  abrir y se sueltan al cerrar. Mantener imágenes descifradas en memoria las
  dejaría vivas después de cerrar la bóveda, que es justo lo contrario de lo que
  hace cerrarla.
- **Tope de previsualización: 20 MB.** Los bytes cruzan el IPC como base64, que
  infla un 33%; un vídeo de cientos de megas por ese camino congela la ventana.
  Por encima del tope se devuelve el tipo pero no el contenido, y la interfaz
  dice por qué: *«el archivo está guardado y cifrado; falta la parte que
  reproduce vídeo sin descifrarlo entero en memoria»*. Prefiero un aviso honesto
  a una previsualización que cuelga la aplicación.
- Borrar una conversación ahora borra **primero los medios** y después la
  conversación. Si sólo se borrara la conversación, sus archivos cifrados
  quedarían ocupando disco sin nada que los referenciara.
- Un detalle que corrigió el lint y mejoró el código: estaba partiendo la ruta
  con una expresión regular para sacar el nombre del archivo. `basename` de
  `node:path` hace eso mismo sin regex y sin errores de escape.
- Comandos ejecutados:
  - `npm run check` → **exit 0**; 111 archivos, 1.941 superadas, 9 omitidas.
- Riesgos o límites:
  - **sin confirmación manual**: no se ha adjuntado ni visto un medio real.
  - las pruebas cubren el almacén (17) y el contrato; la interfaz de medios no
    tiene pruebas propias, igual que el resto del renderer.
  - el vídeo grande sigue sin poder verse. Es la misma limitación de antes,
    ahora al menos **visible para el usuario** en vez de silenciosa.
  - no hay generación de medios: esto adjunta archivos que ya tienes.
- Estado nuevo: medios conectados de extremo a extremo en local.
- Siguiente paso exacto: el cliente de sincronización que use los endpoints de
  `F9.15`, o `F9.12` (documentación de privacidad).

### 2026-09-01 17:40 — Claude — F9.16, almacén de medios cifrados

- Estado anterior: `F9.6` y `F9.15` implementados. Daniel pidió cerrar primero
  el camino de medios y dejar la subida para después.
- Archivos creados: `apps/desktop/src/main/vault/blob-store.ts`,
  `media-store.ts` y `media-store.test.ts`.
- Alcance elegido: **local y cifrado ahora, con la interfaz lista para el
  almacén remoto**. `BlobStore` tiene hoy una sola implementación, la de disco.
  La remota subirá exactamente estos mismos bytes; que el contenido ya viaje
  cifrado es lo que convierte esa segunda implementación en un cambio de
  transporte y no en un rediseño.
- Separación de responsabilidades, y por qué: `blob-store.ts` guarda bytes y
  **no cifra**. Si cifrara, habría dos sitios decidiendo cómo se protege un
  archivo y acabarían discrepando. El cifrado vive sólo en `private-store.ts`.
- **El orden de escritura importa y está escrito en el código**: primero los
  bytes, después el registro. Si falla a medias queda un archivo huérfano
  —recuperable con una limpieza— en vez de un registro que apunta a algo que no
  existe, que es un error que sólo aparece meses después al abrir la imagen.
- Decisiones de opacidad, todas con prueba:
  - **todo se guarda con extensión `.bin`**, también los vídeos. Un `.mp4` junto
    a un `.png` ya diría que hay vídeo, y el explorador de Windows generaría
    miniaturas de ambos;
  - el nombre es la clave opaca de 32 hex, nunca el identificador de
    conversación ni el nombre original;
  - el índice no revela tipo, nombre, prompt ni personaje: todo va cifrado;
  - la miniatura ocupa su propio archivo, igual de opaco y con su propia
    subclave.
- **Nunca se escribe una copia sin cifrar a disco, ni siquiera temporal.** Los
  bytes descifrados se devuelven en memoria. Un temporal descifrado es
  exactamente la fuga que la bóveda evita, y además sobrevive a un cierre
  inesperado.
- Borrar una conversación se lleva **los bytes**, no sólo el índice. Sin eso
  quedarían archivos cifrados ocupando disco para siempre, sin nada que los
  referenciara y sin forma de saber a qué pertenecían. Hay prueba que cuenta los
  archivos antes y después.
- Comandos ejecutados:
  - `npx vitest run apps/desktop/src/main/vault/media-store.test.ts` → **17/17**.
  - `npm run check` → **exit 0**; 111 archivos, 1.941 superadas, 9 omitidas.
- Riesgos o límites:
  - **sin conectar todavía**: no hay IPC ni interfaz para añadir o ver un medio.
    El almacén funciona y está probado, pero nadie lo llama.
  - **la implementación remota no existe**. Sólo la local. Sincronizar medios
    entre equipos sigue pendiente.
  - **vídeo largo**: devolver los bytes en memoria vale para una imagen, no para
    un vídeo de cientos de megas. Reproducirlo sin escribirlo a disco exigirá un
    protocolo propio de Electron que sirva el flujo descifrado. Queda anotado
    como trabajo aparte, no resuelto.
- Estado nuevo: `F9.16` **implemented** en su parte local.
- Siguiente paso exacto: IPC e interfaz para adjuntar y ver medios en una
  conversación privada; después, el cliente de sincronización.

### 2026-09-01 17:32 — Claude — F9.6 y F9.15, migración y endpoints de sincronización

- **El problema de fondo que había que resolver primero**: ¿de quién es un
  registro privado? La única identidad de Luxy es el token de máquina, y con eso
  los registros de un portátil no serían visibles desde el de sobremesa. Sin
  resolverlo, «sincronización» no significa nada.
- Solución: **`vault_id`**, derivado de la llave maestra con HKDF
  (`deriveVaultId`). Dos equipos que abren la misma bóveda obtienen el mismo
  valor sin coordinarse, y como HKDF no se invierte el servidor puede guardarlo
  sin aprender nada de la llave. No hace falta inventar cuentas de usuario, así
  que no toca `D-001`.
- **Límite escrito en la propia migración para que no se olvide**: el `vault_id`
  **agrupa, no autoriza**. Quien autoriza sigue siendo el token de máquina. Una
  máquina con token válido podría pedir los registros de cualquier `vault_id`
  que conozca; no podría descifrarlos, pero los tendría. Es aceptable mientras
  valga `D-001` (un solo usuario). Si algún día entra `F9.10`, hay que revisarlo
  **antes** de abrirlo a nadie más.
- `F9.6` — migración `0007_luxy_vault.sql`:
  - tres tablas: `vault_records`, `vault_media`, `vault_conversations`;
  - **el enum `luxy_job_status` no se toca**, con prueba que lo verifica
    prohibiendo modificarlo y no nombrarlo, porque el comentario que explica por
    qué no se toca es justo lo que hay que conservar;
  - idempotencia por vault, conversación y secuencia, mismo patrón que los
    eventos de trabajo: reenviar un lote tras un corte de red no duplica. Sin
    esa garantía, la única opción segura sería no reintentar;
  - borrado en cascada: sin él, borrar una conversación dejaría ciphertext
    huérfano ocupando espacio para siempre;
  - RLS activo **y forzado** en las tres, como `machine_tokens`. Ninguna
    política: sin políticas y con RLS, nadie que no sea `service_role` ve una
    fila;
  - `vault_conversations` **no tiene columna de título**: va cifrado dentro de
    cada turno. Prueba nueva que falla si alguien añade `title`, `prompt`,
    `mime_type`, `output_url` o `summary` a la migración de bóveda;
  - un fallo mío corregido antes de cerrar: el trigger usaba `new` también en
    `DELETE`, donde es nulo. Ahora distingue por `tg_op`.
- `F9.15` — endpoints y repositorio:
  - cuatro rutas bajo `/api/vault`, todas con autenticación de máquina;
  - **el gateway ejecuta `assertNoPlaintextLeak` sobre cada registro** antes de
    guardarlo. El escritorio ya lo comprueba, pero un servidor que confía en que
    el cliente hizo los deberes acaba guardando lo que no debe el día que
    alguien cambia el cliente. Mismo razonamiento por el que el agente revalida
    las aprobaciones;
  - el log de subida registra la bóveda y cuántos registros, **nunca** el
    identificador de conversación ni nada del contenido;
  - añadidos `delete()` y `gte()` al cliente de Supabase, que no los tenía.
- Comandos ejecutados: `npm run check` → **exit 0**; 110 archivos, 1.924
  superadas, 9 omitidas.
- Riesgos o límites:
  - **la migración NO se ha ejecutado** contra ningún Postgres. Es el riesgo
    conocido nº3 del proyecto y `0007` lo hereda entero.
  - las pruebas del gateway verifican el **contrato**, no los manejadores de
    extremo a extremo, porque van envueltos en `withMachineAuth`. Queda sin
    verificar que la idempotencia y la cascada funcionen de verdad. Está escrito
    en la cabecera del archivo de pruebas.
  - **el escritorio todavía no sincroniza**: los endpoints existen y nadie los
    llama.
- Estado nuevo: `F9.6` y `F9.15` **implemented**, sin ejecución real.
- Siguiente paso exacto: el cliente de sincronización en el escritorio, o
  `F9.16` si se prefiere cerrar antes el camino de medios.

### 2026-09-01 17:15 — Claude — sincronización documental atrasada

- Motivo: Daniel preguntó si todo el plan seguía documentado. Al comprobarlo,
  **no del todo**.
- Estado encontrado:
  - `MASTER-PLAN.md`: al día, las 18 filas correctas.
  - `CHANGELOG-WORK.md` y `TEST-RESULTS.md`: al día, con entrada por cada paso.
  - **`CURRENT-TASK.md`: se había quedado en `F9.5`.** Le faltaban `F9.13`,
    `F9.14`, `F9.8`, `F9.17`, el bloqueo automático configurable y el relleno.
    Su «siguiente paso exacto» decía «decisión de Daniel entre dos órdenes
    válidos», cierto cinco pasos atrás.
  - **`DECISIONS.md`: le faltaban tres decisiones** que sólo vivían en el
    changelog.
- Por qué importa: `CURRENT-TASK.md` es el archivo que lee otra IA para saber
  dónde estamos. Si Codex cogiera el relevo ahora, creería que lo último cerrado
  fue `F9.5` y que el siguiente paso es una decisión que Daniel ya tomó.
- Causa: mantuve `CURRENT-TASK` al día en `F9.1`–`F9.5`, y al acelerar el ritmo
  empecé a actualizar sólo `MASTER-PLAN`, `CHANGELOG` y `TEST-RESULTS`. El
  archivo cuya función es la coordinación es justo el que se degrada cuando uno
  va con la cabeza metida en el código.
- Archivos modificados: `CURRENT-TASK.md` (estado real de los diez pasos y
  siguiente paso exacto), `DECISIONS.md` (`D-042`, `D-043`, `D-044`).
- Decisiones registradas, elegidas porque son las que alguien «arreglaría» sin
  saber por qué estaban así:
  - **`D-042`**: el contenido privado se pide sondeando, nunca por callback.
    Si un proveedor exigiera callback, la respuesta no es enrutarlo por el
    gateway: es no usar ese proveedor para contenido privado.
  - **`D-043`**: una conversación privada no tiene streaming. El coste es
    visible y se aceptó a cambio de que el registro de eventos no pueda ser una
    copia de la conversación. Recuperarlo exige un canal aparte, no «activar»
    `provider_output`.
  - **`D-044`**: el contenido se rellena para que su tamaño no lo delate, con
    los números medidos del archivo real de Daniel.
- `npm run check` → **exit 0**; 109 archivos, 1.910 superadas, 9 omitidas.
- Estado nuevo: documentación de continuidad sincronizada. Sin cambios de código.
- Siguiente paso exacto: `F9.6` (migración) y luego `F9.15` (endpoints), que es
  lo que convierte el almacén local en sincronización real.

### 2026-09-01 17:05 — Claude — F9.8, higiene de caminos laterales

- Estado anterior: `F9.17` implementado. `F9.8` era el único paso marcado como
  **condición dura antes de usar la bóveda con contenido real**.
- Enfoque: auditar por dónde puede escaparse el contenido en vez de suponerlo.
  El contenido cifrado no se filtra por el cifrado; se filtra por un registro,
  una notificación o un volcado de fallo.
- **Fuga 1 — herramientas de desarrollo abiertas en producción.** `devTools` no
  estaba configurado, y su valor por defecto es `true`. Con la bóveda abierta el
  renderer tiene conversaciones **descifradas** en memoria, así que cualquiera
  que pulsase Ctrl+Shift+I en la aplicación instalada podía leerlas **sin la
  contraseña**. Es exactamente el escenario que la bóveda existe para impedir.
  Ahora `devTools: options.isDev`.
- **Fuga 2 — volcados de fallo.** Chromium escribe minidumps aunque no se active
  el informador de fallos, y un volcado del renderer contiene su memoria: con la
  bóveda abierta, conversaciones descifradas en un `.dmp` sin cifrar. Ahora se
  redirigen a `%APPDATA%\Luxy\crash`, bajo la cuenta del usuario. Y se deja
  escrito por qué **no** se llama a `crashReporter.start()`: sin él no se sube
  nada a ningún servidor, y un volcado que viajase sería contenido privado
  saliendo del equipo.
- **Fuga 3 — corrector ortográfico.** Ya estaba desactivado, pero sin explicar
  por qué. Documentado: manda palabras a un servicio de Google y mantiene un
  diccionario del usuario en disco. Con la bóveda abierta eso sería texto
  privado saliendo por un camino que nadie mira.
- **Comprobado y ya correcto, sin cambios**: un turno privado no dispara
  notificaciones de Windows. `onAgentEvent` sólo notifica en `job.completed`,
  `job.failed`, `approval.pending` y `agent.error`, y `host-entry` sólo emite
  `job.phase` y `job.warning` para un turno privado. Era correcto por
  construcción, no por casualidad, pero no había nada que lo fijara: añadido
  `local-turn-privacy.test.ts` para que un evento nuevo no lo rompa en silencio.
- **Comprobado y ya correcto**: `describeError()` aplica `redact()` a todo
  mensaje de error antes de registrarlo (`logger.ts:113`).
- Comandos ejecutados:
  - `npm run check` → **exit 0**; 109 archivos, 1.910 superadas, 9 omitidas.
- Riesgos o límites que quedan y se documentan sin suavizar:
  - un volcado de fallo del renderer **sigue pudiendo** contener texto
    descifrado si ocurre con la bóveda abierta. Se acota dónde cae y se impide
    que salga del equipo; no se puede impedir que se escriba.
  - la memoria del proceso sigue siendo legible para quien tenga depurador y la
    misma cuenta de Windows. Es el límite de DPAPI, ya documentado.
  - `wipe()` reduce la ventana, no la elimina: V8 pudo copiar el buffer antes.
- Estado nuevo: `F9.8` **done**. Con esto se levanta la condición que bloqueaba
  usar la bóveda con contenido real.
- Siguiente paso exacto: `F9.15` y `F9.16` (sincronización), o cablear `F9.17`.

### 2026-09-01 16:52 — Claude — F9.17, adaptador de Xavira

- Estado anterior: `F9.14` cerrado y confirmado a mano.
- Objetivo: el adaptador de la API de imagen y vídeo. Última pieza del camino
  crítico hasta la primera imagen privada.
- Archivos creados: `apps/agent/src/providers/xavira.ts` y su prueba.
- Contrato implementado, verificado en su documentación pública el 2026-09-01:
  `POST /v1/characters`, `POST /v1/images:generate` (201 con `output_url` o 202
  con `poll_url`), `POST /v1/videos:generate` (202 siempre),
  `GET /v1/generations/:id`.
- **Se usa sondeo y NO `callback_url`, aunque la API lo ofrezca.** Un callback
  exigiría una URL pública donde recibir el resultado, y la única que tiene Luxy
  es el Worker: el contenido pasaría por el gateway, que es exactamente lo que
  la bóveda existe para impedir. Hay prueba que verifica que la petición de
  vídeo **nunca** incluye `callback_url`. Es la misma razón por la que el agente
  sondea la cola en vez de exponer un puerto (`docs/decisions/0001`).
- El sondeo sube el intervalo de forma exponencial: sondear cada 500 ms un vídeo
  que tarda tres minutos son cientos de peticiones inútiles y un 429 asegurado.
- **Una fuga real que encontró una prueba**: `redact()` sólo tapa los secretos
  registrados, y esta clave llega por parámetro sin pasar por el registro.
  Algunas APIs repiten la clave recibida en el cuerpo del error, así que un 400
  podía acabar escribiéndola en el archivo de registro. Añadido `stripKey()`,
  que se aplica **antes** de `redact()`. La prueba que lo detectó se conserva.
- Otras decisiones con motivo:
  - toda respuesta se valida con Zod, aunque venga de un proveedor de pago: una
    respuesta con otra forma debe fallar aquí y no tres capas más abajo;
  - la descarga exige **HTTPS**: una URL `http` sería contenido privado viajando
    en claro por la red;
  - el identificador se escapa en la ruta, porque uno con barra saltaría a otra
    ruta de la API. Hay prueba;
  - los errores traen una pista según el código: 401 clave, 402 sin créditos,
    429 demasiadas peticiones.
- El adaptador **no cifra ni escribe en disco**: pide, espera y devuelve bytes.
  Quien los reciba decide qué hacer con ellos.
- Comandos ejecutados:
  - `npx vitest run apps/agent/src/providers/xavira.test.ts` → **22/22**.
  - `npm run check` → **exit 0**; 108 archivos, 1.905 superadas, 9 omitidas.
- Riesgos o límites:
  - **Ninguna llamada real.** El contrato viene de la documentación pública, no
    de haberlo ejecutado. La primera llamada de verdad puede revelar diferencias.
  - **Todavía no está conectado.** Falta el mensaje de host que pida un medio,
    el guardado cifrado del resultado y la interfaz. Eso es lo siguiente.
- Estado nuevo: `F9.17` **implemented**, sin verificación contra la API real.
- Siguiente paso exacto: conectar el adaptador al camino privado — generar,
  descargar, cifrar con `sealMedia` y mostrarlo.

### 2026-09-01 16:45 — Claude — F9.14 confirmado y relleno contra la fuga de longitud

- **`F9.14` confirmado manualmente por Daniel.** Pegó el contenido real de
  `vault/conversations/<uuid>.jsonl` tras dos intercambios. Comprobado sobre ese
  archivo:
  - no aparece el texto, ni el título, ni el proveedor, ni el modelo;
  - los cuatro nonces son **distintos** (repetir un nonce en GCM es catastrófico);
  - los cuatro textos cifrados son distintos.
  Pasa de `implemented` a `done`.
- **Fuga encontrada al medir ese archivo real**: AES-GCM no rellena, así que el
  tamaño del sobre revela el del mensaje. Medido: 204, 223, 200 y 306 bytes,
  es decir ~38, ~57, ~34 y ~140 caracteres. Con eso se reconstruye la **forma**
  de una conversación —pregunta corta, respuesta larga— sin descifrar nada. En
  un historial de meses, esa forma dice bastante.
- Arreglado con `packages/vault-crypto/src/padding.ts`: el contenido se rellena
  a múltiplos de 256 bytes antes de sellarse. Dos mensajes de 30 y 200
  caracteres producen ahora sobres **idénticos en tamaño**, y hay prueba que lo
  comprueba comparando longitudes.
- Formato: `'LXP1' + longitud real (4 bytes BE) + datos + ceros`. La marca al
  principio permite distinguir contenido rellenado del anterior, así que **las
  conversaciones que Daniel ya creó se siguen abriendo**: `unpad` devuelve tal
  cual lo que no lleva marca. Hay prueba de esa compatibilidad.
- Elección del bloque: 256 bytes esconde la diferencia entre un «hola» y un
  párrafo, que es donde más se nota, y el coste nunca supera un bloque por
  mensaje, ni siquiera en uno de 100.000 caracteres. Hay prueba de las dos cosas.
- **Fuga que NO se arregla y queda documentada**: las marcas de tiempo van en
  claro (`14:33:21`, `14:33:29`…), así que se ve el ritmo de uso y cuánto tardó
  el modelo. Redondearlas no serviría de mucho: la fecha del propio archivo la
  revela igual.
- El relleno se aplica sólo a `sealText`, es decir a texto: turnos, memoria y
  metadatos de medios. El tamaño de un blob de imagen o vídeo ya es visible
  aparte, en `byteSize`, y ocultarlo es una decisión distinta y más cara.
- Comandos ejecutados:
  - `npx vitest run packages/vault-crypto` → **91/91**.
  - `npm run check` → **exit 0**; 107 archivos, 1.883 superadas, 9 omitidas.
- Estado nuevo: `F9.14` **done, confirmado manualmente**.
- Siguiente paso exacto: `F9.17`, adaptador de Xavira.

### 2026-09-01 16:30 — Claude — F9.14, conversaciones privadas de extremo a extremo

- Estado anterior: `F9.13` cerrado y confirmado a mano.
- Objetivo: unir la pantalla con el ejecutor. Escribes, el agente responde, y
  la conversación se guarda cifrada.
- Archivos creados: `apps/desktop/src/main/vault/conversation-store.ts` y su
  prueba.
- Archivos modificados: `apps/agent/src/runtime/host-entry.ts`,
  `apps/desktop/src/main/agent-controller.ts`, `shared/channels.ts`,
  `shared/ipc.ts`, `preload/index.ts`, `main/ipc/handlers.ts`, `main/index.ts`,
  `renderer/useVault.ts`, `renderer/pages/Vault.tsx`, `renderer/App.tsx`,
  `renderer/styles.css`.
- **Decisión de privacidad del progreso**: sólo se reenvían eventos de tipo
  `phase` y `warning`. `provider_output` lleva **texto del modelo**, y
  reenviarlo como evento lo metería en un camino que puede acabar en un log. El
  texto vuelve aparte, en la respuesta `local_turn`, que no pasa por eventos.
  Precio: no hay respuesta en streaming en una conversación privada.
- `pendingTurns` va aparte de `pending` en el controlador porque la respuesta de
  un turno no es un `ack`: lleva el texto. Timeout propio de 30 minutos, porque
  el de 30 segundos de las órdenes normales cortaría a media respuesta.
- **Almacén local cifrado**: un archivo por conversación en `vault/conversations`,
  formato JSON por líneas. Añadir un turno es escribir una línea al final, sin
  releer ni reescribir una conversación de mil mensajes. Una línea corrupta se
  salta y el resto se conserva; hay prueba que simula un corte a media escritura.
- El nombre del archivo es el **uuid**, nunca el título: `%APPDATA%` no puede
  revelar de qué hablas. Y el identificador se valida contra un uuid antes de
  construir la ruta, así que `../fuera` no es un nombre aceptable.
- Los registros que escribe son **exactamente** los que `F9.15` subirá al
  gateway. No es trabajo que se tire después.
- Al cerrarse la bóveda, el renderer descarta todo lo descifrado que tuviera en
  memoria: lista, turnos y conversación abierta. No se oculta, deja de existir.
- Comandos ejecutados:
  - `npx vitest run apps/desktop/src/main/vault/conversation-store.test.ts` →
    **14/14**.
  - `npm run check` → **exit 0**; 106 archivos, 1.874 superadas, 9 omitidas.
- Riesgos o límites:
  - **Sin confirmación manual.** No se ha probado una conversación real.
  - No hay streaming, por la decisión de privacidad de arriba.
  - La actividad sigue contándose al usar la bóveda criptográficamente; ahora
    leer una conversación **sí** cuenta, porque descifra. Queda resuelto de
    hecho, aunque no por un cambio explícito.
  - Sigue sin sincronizar: es almacenamiento local. Falta `F9.15` y `F9.16`.
- Estado nuevo: `F9.14` **implemented**, pendiente de prueba manual.
- Siguiente paso exacto: que Daniel pruebe una conversación privada real.
  Después, `F9.17` (adaptador de Xavira) para llegar a la primera imagen.

### 2026-09-01 16:20 — Claude — F9.13 confirmado a mano y bloqueo automático configurable

- **`F9.13` confirmado manualmente por Daniel.** Captura: sección Privado,
  bóveda abierta, estado, cuenta atrás y ajustes. Pasa de `implemented` a
  `done`. Es la primera vez que este código se ejecuta de verdad.
- Un fallo mío al indicarle cómo arrancar: le di `npm run desktop:dev` y
  PowerShell lo rechazó por su política de ejecución. **Ya estaba documentado**
  en `docs/ARRANQUE-ORDENADOR-NUEVO.md`, trampa nº 2: en PowerShell hay que usar
  `npm.cmd`. `CLAUDE.md` manda leer ese archivo cuando el equipo es un clon
  nuevo, y yo sabía que lo era. No hubo que cambiar nada del sistema.
- Daniel preguntó dos cosas que destaparon un problema real:
  1. Leyó «se cerrará sola en 2 min» como si el límite fuese 2 minutos. Era el
     tiempo **restante** de 5. La interfaz no distinguía una cosa de otra.
  2. Preguntó qué implica «Recordar en este equipo». Al explicarlo quedó claro
     que ese ajuste y el bloqueo automático **se contradicen** y la pantalla no
     lo decía.
- Además, los 5 minutos eran una constante que elegí yo. No hay ninguna razón
  para que lo decida quien escribe el código.
- Cambios:
  - `AUTO_LOCK_MINUTES` como **lista cerrada** (1, 5, 15, 30, 60, 240, 0). No es
    un entero libre porque el valor llega del renderer: uno arbitrario dejaría
    pedir un cierre cada 50 ms y volver la bóveda inservible.
  - el ajuste vive en `vault.json`, en `settings`, y es **opcional** para que
    una bóveda creada antes de que existiera el campo se siga abriendo.
  - `setAutoLockMinutes()` exige la bóveda **abierta**: si no, cualquiera que se
    siente delante podría desactivarlo y dejarla abierta para la próxima vez.
  - `0` = no cerrarla sola, con aviso explícito en pantalla.
  - aviso nuevo cuando el desbloqueo rápido está activo **y** hay cierre
    automático: reabrir es un clic, así que el cierre protege mucho menos.
  - el texto del desbloqueo rápido ahora dice también de qué **sí** protege:
    otra cuenta de Windows y que alguien copie el archivo a otro ordenador.
  - `status()` expone `autoLockMinutes` en vez de `autoLockMs`, para que la
    interfaz no tenga que dividir ni redondear.
- Límite que sigue abierto y conviene no perder de vista: la actividad se cuenta
  al **usar la bóveda criptográficamente**, no al mover el ratón. Hoy no se nota
  porque no hay nada que descifrar, pero con conversaciones reales leer una
  larga sin escribir podría cerrarla a media lectura. Se resolverá en `F9.14`,
  cuando exista actividad real que contar.
- Comandos ejecutados:
  - `npx vitest run apps/desktop/src/main/vault` → **62/62**.
  - `npm run check` → **exit 0**; 105 archivos, 1.860 superadas, 9 omitidas.
- Estado nuevo: `F9.13` **done, confirmado manualmente**.
- Siguiente paso exacto: `F9.14`.

### 2026-09-01 15:50 — Claude — F9.13, interfaz de la bóveda

- Estado anterior: `F9.5` cerrado; plan corregido con `F9.13`–`F9.17`.
- Objetivo: cerrar el hueco que motivó la corrección del plan. La bóveda deja
  de existir sólo por debajo y se puede crear, abrir, cerrar y configurar.
- Archivos creados: `apps/desktop/src/renderer/useVault.ts`,
  `pages/Vault.tsx`, `useVault.test.ts`.
- Archivos modificados: `shared/ipc.ts` (`LuxyBridge`), `preload/index.ts`,
  `renderer/App.tsx` (sección «Privado»), `renderer/styles.css`.
- Cuatro estados de pantalla, y la regla que los ordena: **con la bóveda
  cerrada no se muestra nada de su contenido**. Ni títulos, ni recuentos, ni
  «tu última conversación fue el martes». No es que se oculte: el renderer no
  lo tiene, porque el proceso principal no puede descifrarlo sin la llave.
- El indicador de la barra de navegación es un punto lleno o vacío, **nunca un
  recuento**. Un número ya diría cuántas conversaciones privadas hay.
- La clave de recuperación tiene su propia pantalla, con casilla de
  confirmación obligatoria antes de continuar, porque se muestra una sola vez
  y no se guarda en ningún sitio. Estilo propio (`.vault-key`): grande,
  monoespaciada y `user-select: all`, para copiarla de un tirón sin errores.
- El renderer no guarda material criptográfico en ningún momento. La contraseña
  vive lo justo para cruzar el IPC y se limpia del estado en cuanto se usa.
- Un detalle que verifiqué en vez de suponer: comprobé qué clases CSS existen de
  verdad antes de usarlas. `prose`, `code` y `btn--ghost` **no existían**;
  usé `btn--quiet` y `mono`, que sí, y añadí una única regla nueva para la
  clave de recuperación.
- Comandos ejecutados:
  - `npx vitest run apps/desktop/src/renderer/useVault.test.ts` → **10/10**.
  - `npm run check` → **exit 0**; 105 archivos, 1.855 superadas, 9 omitidas.
- Riesgos o límites: **no verificado a mano**. Está implementado y con pruebas
  de contrato y de formato, pero no se ha abierto Luxy para verlo. Las pruebas
  cubren la lógica, no el aspecto ni el flujo real de clics.
  La pantalla dice explícitamente que todavía no hay conversaciones privadas:
  falta `F9.14` para conectarla con el ejecutor.
- Estado nuevo: `F9.13` **done, sin confirmación manual**.
- Siguiente paso exacto: `F9.14`, que el proceso principal envíe
  `run_local_turn` al agente y muestre el progreso.

### 2026-09-01 15:40 — Claude — corrección del plan de la Fase 9

- Motivo: Daniel preguntó si el hueco de interfaz que yo repetía al cerrar cada
  paso estaba planeado. **No lo estaba.** Al revisarlo, no faltaba una fila:
  faltaban las cuatro capas que **consumen** la bóveda.
- Faltaban: interfaz en Studio, envío de `run_local_turn` desde el proceso
  principal, endpoints del gateway, cliente de almacén de objetos y adaptador
  del proveedor de imagen/vídeo.
- Consecuencia concreta del defecto: con el plan anterior se podían completar
  `F9.6`–`F9.12` **enteros** y seguir sin poder abrir la bóveda ni generar una
  imagen. El plan no llegaba al objetivo declarado.
- Causa: el plan se escribió de dentro hacia fuera, desde el núcleo
  criptográfico, y cada paso era «la siguiente capa que el anterior habilita».
  Todo lo que quedaba al otro lado de esa frontera se quedó sin ID. La señal
  estaba a la vista —«ninguna pantalla lo usa» aparece al cierre de `F9.3`,
  `F9.4` y `F9.5`— y la traté como nota al pie en vez de como lo que era.
- Archivos modificados: `MASTER-PLAN.md` (cinco pasos nuevos, `F9.13`–`F9.17`,
  nota de corrección y camino crítico explícito), `CURRENT-TASK.md`.
- Los IDs ya cerrados **no se renumeran**: aparecen en commits y en entradas
  anteriores del changelog, que no se reescriben.
- Cambio de orden: el camino hasta la primera imagen privada **no es el orden
  numérico**. Es `F9.13` → `F9.14` → `F9.17` (imagen privada sólo local), y
  después `F9.6` → `F9.15` → `F9.16` (además sincronizada).
- `F9.8` (higiene de logs, cachés y miniaturas) no bloquea ese camino, pero debe
  cerrarse **antes de usar la bóveda con contenido real**: es el paso que evita
  que lo cifrado con cuidado aparezca en claro en un log o en una caché.
- Efecto en la estimación: la que di antes se calculó sobre un plan al que le
  faltaban cuatro piezas, así que **era demasiado baja**. Corregida.
- Sin cambios de código. Sin pruebas nuevas.
- Siguiente paso exacto: sin cambios respecto a lo acordado — `F9.6` si se sigue
  el orden numérico, o `F9.13` si se prioriza llegar antes a una imagen real.

### 2026-09-01 15:25 — Claude — F9.5, turno privado sin cola

- Estado anterior: `F9.4` cerrado y commiteado (`cd4dd21`).
- Objetivo: que un turno privado se ejecute en la máquina local **sin pasar por
  la cola de Supabase**. Era el cambio estructural del bloque: hasta ahora el
  agente sólo recibía trabajo reclamándolo del gateway.
- Archivos creados: `apps/agent/src/local-turn.ts` y `local-turn.test.ts`.
- Archivos modificados: `packages/shared/src/host-protocol.ts`
  (`run_local_turn`, `cancel_local_turn`, respuesta `local_turn`),
  `apps/agent/src/agent.ts` (`runPrivateTurn`),
  `apps/agent/src/runtime/host.ts` (`runLocalTurn`, `cancelLocalTurn`).
- Cómo se hizo, y por qué así: en vez de escribir un segundo ejecutor, se
  construye un **trabajo sintético** y se pasa por `runJob`, el de siempre. Se
  marca con `studioMode: 'conversation'`, que es la etiqueta que ya activa el
  camino de sólo lectura — sin worktree, sin herramientas de escritura, sin
  comprobaciones en el anfitrión. Un turno privado no debe poder tocar archivos,
  y así hereda esa garantía en vez de reimplementarla.
- El aislamiento se consigue no dando las tres piezas que hablan con el gateway:
  - `emit` va sólo a quien llama, no a la `EventQueue`, así que no existe el
    camino por el que un evento acabaría en Supabase;
  - el resultado se devuelve, no se persiste con `outcomes`;
  - `downloadAttachment` lanza `LocalTurnIsolationError`. Es deliberadamente
    ruidoso: si esa rama se ejecuta alguna vez, alguien rompió el aislamiento
    sin darse cuenta, y es mejor que falle a que suba el contenido en silencio.
- **La prueba que sostiene todo el bloque**: espía `globalThis.fetch` durante un
  turno completo y verifica **cero llamadas**. También con proveedor ausente y
  con proyecto inexistente, que son los caminos de error.
- Lo que se pierde y queda documentado en el propio archivo: no hay lease, no
  hay reintento tras un corte y no hay historial en el servidor. Si Luxy se
  cierra a media respuesta, esa respuesta se pierde. Es el precio de que nadie
  más la vea.
- Un fallo mío que encontró la suite: el proveedor falso devolvía `text` en vez
  de `finalText`, el campo real de `ProviderRunResult`. El turno fallaba con
  «Cannot read properties of undefined (reading 'trim')». Corregida la prueba,
  no el código; el comentario del archivo explica el campo correcto para que no
  se repita.
- Comandos ejecutados:
  - `npx vitest run apps/agent/src/local-turn.test.ts` → **12/12**.
  - `npm run check` → **exit 0**; 104 archivos, 1.845 superadas, 9 omitidas.
- Riesgos o límites: `runLocalTurn` exige el agente **en marcha**, porque los
  proveedores se construyen al arrancar. El proceso principal de Electron
  todavía **no envía** estas peticiones: el canal existe en el protocolo y el
  host lo atiende, pero nadie lo llama aún.
- Estado nuevo: `F9.5` **done**.
- Siguiente paso exacto: `F9.6`, migración con las columnas de ciphertext. El
  enum `luxy_job_status` no se toca.

### 2026-09-01 15:12 — Claude — F9.4, cifrado en el cliente

- Estado anterior: `F9.3` cerrado y commiteado (`883e098`).
- Objetivo: la frontera por la que sale todo lo privado. Contenido en claro
  entra, registros que el gateway puede almacenar salen.
- Archivos creados: `packages/vault-crypto/src/blob.ts` y `blob.test.ts`;
  `packages/shared/src/vault-payloads.ts`;
  `apps/desktop/src/main/vault/private-store.ts` y `private-store.test.ts`.
- Archivos modificados: los dos `index.ts` de exportación.
- **Sobre binario nuevo.** El sobre JSON usa base64, que infla un 33%. Da igual
  en un mensaje; en un vídeo de 50 MB son 17 MB de más en disco, en la subida y
  en la descarga. `sealBlob`/`openBlob` devuelven bytes crudos con cabecera de
  13 bytes y etiqueta de 16: coste fijo de 29 bytes en vez de un porcentaje.
  Verificado con 100 KB → 100.029 bytes.
  El propósito **no** se guarda en el blob; lo aporta quien abre y va en los
  datos autenticados, así que no hay campo que reetiquetar. Es más estrecho que
  el sobre JSON, no menos.
- **Qué va dentro del cifrado y qué fuera.** Dentro: texto, título, proveedor,
  modelo, tokens, `mimeType`, nombre, prompt, `characterId`, dimensiones,
  duración. Fuera, y asumido como metadato visible: que existe un registro, a
  qué conversación pertenece, su orden, cuándo y cuánto ocupa.
  Dejar el proveedor fuera habría revelado a qué API hablas y con qué
  frecuencia; no hace falta cederlo.
- **El guardián está conectado de verdad.** `sealTurn` y `sealMedia` pasan por
  `assertNoPlaintextLeak()` como último paso antes de devolver nada. Da igual
  cómo se construyera el objeto: si lleva un campo prohibido, no sale.
- Subclaves separadas por objeto y por dominio: turno, memoria, medio y
  miniatura tienen la suya. Abrir el historial de una conversación no da acceso
  a su memoria, y la llave del vídeo no abre su miniatura. Hay pruebas de las
  dos cosas.
- La miniatura se cifra con el mismo cuidado que el original. Es el fallo
  clásico: cifrar `video.mp4` con esmero y dejar un `preview.jpg` legible al
  lado, que revela lo mismo con menos trabajo.
- Las claves de objeto son 16 bytes aleatorios en hexadecimal, **no derivadas
  del contenido ni del nombre**. Una derivada del contenido permitiría saber si
  dos archivos son iguales mirando el almacén; una derivada del nombre lo
  revelaría directamente. Prueba: el mismo contenido sellado dos veces produce
  claves distintas.
- Un fallo mío que encontró la suite: la expectativa de orden alfabético estaba
  mal escrita (`content` va antes que `conversationId`). Corregida la prueba, no
  el código.
- Comandos ejecutados:
  - `npx vitest run packages/vault-crypto/src/blob.test.ts` → **11/11**.
  - `npx vitest run apps/desktop/src/main/vault/private-store.test.ts` → **20/20**.
  - `npm run check` → **exit 0**; 103 archivos, 1.833 superadas, 9 omitidas.
- Riesgos o límites: esto sella y abre, pero **todavía no sube nada**. No hay
  cliente de almacén de objetos, ni endpoints en el gateway, ni migración. El
  camino de salida existe y está probado; falta enchufarlo.
- Estado nuevo: `F9.4` **done**.
- Siguiente paso exacto: `F9.5`, `run_local_turn` en `host-protocol`, para que
  un turno privado se ejecute local sin pasar por la cola de Supabase.

### 2026-09-01 15:05 — Claude — F9.3, VaultService y bloqueo

- Estado anterior: `F9.2` cerrado y commiteado (`a6c535d`).
- Objetivo: el servicio que custodia la llave maestra en el proceso principal.
- Archivos creados: `apps/desktop/src/main/vault/key-file.ts`,
  `vault-service.ts` y `vault-service.test.ts`.
- Archivos modificados: `apps/desktop/src/shared/channels.ts` (canales y
  `VAULT_DEVICE_SECRET`), `shared/ipc.ts` (contrato), `main/ipc/handlers.ts`
  (handlers y contexto), `main/index.ts` (arranque y bloqueo automático),
  `main/config-store.ts` (nombres reservados), `apps/desktop/package.json`.
- Reglas que impone el servicio:
  - la llave maestra **nunca se devuelve**. Lo único que sale es
    `subkeyFor(dominio, contexto)`, una subclave derivada, y sólo dentro del
    proceso principal;
  - `status()` es lo único que cruza el IPC. Una prueba enumera sus claves y
    verifica que no contiene contraseña, clave de recuperación, sales ni sobres;
  - al bloquear, la llave se sobreescribe y toda derivación posterior falla.
- Tres decisiones con motivo:
  1. **El bloqueo automático se comprueba por reloj, no con un temporizador.**
     Un `setTimeout` no se entera de que el equipo estuvo suspendido: al
     despertar seguiría pendiente y la bóveda habría quedado abierta toda la
     noche. Hay prueba que avanza el reloj nueve horas.
  2. **Cambiar la contraseña exige la actual aunque la bóveda esté abierta.**
     Tener la sesión abierta no demuestra conocer la contraseña, y quien se
     siente delante de un equipo desatendido no debería poder cambiarla.
  3. **Activar el desbloqueo rápido exige la bóveda abierta**: no se puede
     conceder acceso permanente sin demostrar acceso primero.
- Una brecha encontrada de paso y cerrada: `isSecretNameAllowedForConfig`
  permitía al renderer fijar cualquier secreto cuyo nombre apareciese como
  `apiKeyEnv` de un proveedor HTTP. Bastaba declarar uno llamado
  `VAULT_DEVICE_KEY` para pisar la llave del equipo — no lo habría revelado,
  pero habría dejado la bóveda sin desbloqueo rápido. Añadido
  `RESERVED_SECRET_NAMES`.
- Un problema de rendimiento que detectó la propia suite: con los parámetros
  reales de Argon2 el archivo tardaba **252 s** y un caso llegó a 18,2 s con el
  límite de vitest en 20, es decir, habría sido intermitente en un equipo más
  lento. `argon2Params` pasa a ser inyectable con el valor real por defecto, y
  una prueba comprueba que el valor por defecto **sigue siendo el real**, para
  que acelerar la suite no acabe silenciosamente en producción. El archivo baja
  a **18 s**.
- Un detalle de tipos resuelto en la frontera, no con un cast: `vault-crypto`
  usa `purpose: string` porque no le corresponde conocer el catálogo de Luxy, y
  `shared` lo estrecha a una lista cerrada. `toKeyWrapRecord()` impone esa lista
  **en ejecución**, así que un propósito inventado no llega a escribirse.
- Comandos ejecutados:
  - `npx vitest run apps/desktop/src/main/vault` → **38/38**, 18,07 s.
  - `npm run check` → **exit 0**; 101 archivos, 1.802 superadas, 9 omitidas.
- Estado nuevo: `F9.3` **done**. Falta la interfaz: los canales existen y están
  validados, pero ninguna pantalla los usa todavía.
- Siguiente paso exacto: `F9.4`, cifrar en el cliente antes de subir.

### 2026-09-01 13:10 — Claude — F9.2, contrato de la bóveda

- Estado anterior: `F9.1` cerrado y commiteado (`524a8da`).
- Objetivo: la **forma** de lo que viaja cifrado, en `packages/shared`, separada
  de la criptografía que vive en `@luxy/vault-crypto`.
- Archivos creados: `packages/shared/src/vault.ts` y `vault.test.ts`.
- Archivos modificados: `packages/shared/src/index.ts` (export),
  `packages/shared/package.json` (devDependency), `packages/shared/CLAUDE.md`.
- Contenido: nivel de privacidad (`cloud` | `private`, sin estado intermedio),
  lista cerrada de propósitos, sobre sellado, parámetros de Argon2 con topes,
  envoltura de llave maestra con refinamiento por método, registro privado,
  medio privado con clave de objeto opaca, puente de Telegram apagado por
  defecto, invitaciones y permisos por conversación.
- Dos decisiones de diseño que conviene registrar:
  1. **El registro privado no tiene ningún campo donde quepa texto en claro.**
     No hay `title`, ni `prompt`, ni `mimeType`. No se promete no enviarlos: no
     hay por dónde. Una prueba recorre las claves del esquema y lo comprueba.
  2. `findPlaintextLeaks()` / `assertNoPlaintextLeak()`: un guardián ejecutable
     que recorre en profundidad un objeto destinado al gateway y devuelve los
     campos prohibidos que lleva. Existe porque una regla escrita en un
     documento se rompe sola; ésta se puede ejecutar en los dos lados.
- Un fallo propio que encontró la prueba: el registro privado tenía un campo
  `memory` que contiene un **sobre cifrado**, pero `memory` está en la lista de
  campos prohibidos, así que el guardián marcaba como fuga un registro correcto.
  Corregido por partida doble: el campo pasa a llamarse `sealedMemory`, y
  `findPlaintextLeaks` exime los valores que ya son un sobre válido — lo que
  importa es el contenido, no cómo se llame el campo. Hay prueba de que algo que
  sólo *parece* un sobre sí cuenta como fuga.
- Acoplamiento verificado: `shared` importa `@luxy/vault-crypto` **sólo como
  dependencia de desarrollo**, y una prueba sella de verdad y valida el
  resultado contra el esquema. Si las dos definiciones se separan, falla. El
  código de producción de `shared` sigue sin cifrar ni descifrar nada, así que
  la regla de pureza del paquete se mantiene.
- Comandos ejecutados:
  - `npx vitest run packages/shared/src/vault.test.ts` → **35/35**.
  - `npm run check` → **exit 0**; 100 archivos, 1.764 superadas, 9 omitidas.
- Estado nuevo: `F9.2` **done**.
- Siguiente paso exacto: `F9.3`, `VaultService` en el proceso principal de
  Electron: desbloqueo, bloqueo, auto-bloqueo y la llave sólo en memoria.

### 2026-09-01 13:10 — Claude — hallazgo sobre la API de Xavira

Daniel indicó que probará `xavira.ai`. Consultada su documentación pública
(`xavira.ai/docs`), **sin registrarse ni usar credenciales**:

- base `https://api.xavira.ai`, autenticación `Authorization: Bearer xav_live_…`;
- `POST /v1/characters` — personaje persistente con identidad consistente;
- `POST /v1/images:generate` — responde **201** con `output_url` si termina, o
  **202** con `poll_url` si tarda. El adaptador debe soportar los dos;
- `POST /v1/videos:generate` — siempre **202**, asíncrono;
- `GET /v1/generations/:id` — **polling explícito, y el callback es opcional**;
- spec en `https://api.xavira.ai/openapi.yaml`.

**Lo importante para el diseño**: que el polling sea suficiente significa que
Luxy no necesita exponer ningún endpoint público. El agente pregunta y descarga
directamente; el Gateway no interviene y por tanto no ve el resultado. Encaja
con la decisión de `docs/decisions/0001` de usar polling en vez de push. Si el
callback fuese obligatorio, la única URL pública sería el Worker y el contenido
habría pasado por él, rompiendo la premisa de `F9`.

Riesgo pendiente: `output_url` es un enlace vivo al contenido. No puede
guardarse en claro; por eso `outputUrl` ya está en `FORBIDDEN_PLAINTEXT_FIELDS`.

### 2026-09-01 13:05 — Claude — F9.1, paquete de criptografía de la bóveda

- Estado anterior: `F9.0` cerrado (línea base verde). `F9-VAULT-001` sin empezar.
- Objetivo: `packages/vault-crypto`, la base criptográfica de la bóveda. Puro,
  sin E/S, sin dependencias nuevas.
- Archivos creados:
  - `packages/vault-crypto/package.json`, `tsconfig.json`
  - `src/bytes.ts` — base64url, `wipe()`, comparación en tiempo constante
  - `src/envelope.ts` — sobre AES-256-GCM versionado con propósito autenticado
  - `src/kdf.ts` — Argon2id para la contraseña, HKDF para las subclaves
  - `src/master-key.ts` — llave maestra y sus tres envolturas
  - `src/recipient.ts` — envoltura X25519 para compartir
  - `src/index.ts` y tres archivos de prueba
- Archivos modificados: `tsconfig.build.json` (referencia nueva).
- Dependencias: **ninguna nueva**. `@noble/hashes@2.2.0` ya traía `argon2` y
  `hkdf`, `@noble/curves@2.2.0` trae `x25519`, AES-256-GCM lo pone WebCrypto.
- Dos fallos propios que encontraron las pruebas y se corrigieron en el código,
  no en la prueba:
  1. `randomBytes()` reventaba por encima de 65.536 bytes, el tope por llamada
     de `crypto.getRandomValues`. Nunca habría fallado con llaves de 32 bytes,
     pero sí al usarlo con un bloque de imagen o vídeo. Ahora rellena por trozos.
  2. `m=256 MiB` daba **13 s** por desbloqueo. Medido, no estimado. Bajado a la
     segunda opción recomendada de RFC 9106 (`t=3, m=64 MiB`) → ~2,7 s. Tabla
     completa de tiempos en `D-040`.
- Nota de tipos: `tsconfig.base.json` usa `lib: ["ES2023"]`, sin DOM, así que
  `CryptoKey` y `BufferSource` no existen. En vez de añadir `DOM` al paquete —
  que traería `window` y `document` a algo que no puede tocarlos — los tipos se
  deducen de la propia API con `Awaited<ReturnType<typeof
  crypto.subtle.importKey>>`. Así el paquete no compila si alguien intenta usar
  el DOM desde él.
- Comandos ejecutados:
  - `npx vitest run packages/vault-crypto` → **71/71**.
  - `npx tsc -b tsconfig.build.json` → exit 0.
  - `npm run check` → **exit 0**; 99 archivos, 1.729 superadas, 9 omitidas.
- Pruebas: 71 propias. Cubren ida y vuelta, alteración de un solo bit,
  reetiquetado del propósito, versión desconocida, llave equivocada, separación
  por dominio y por objeto, formato y normalización de la clave de recuperación,
  cambio de contraseña sin recifrar, redirección de un sobre compartido a otro
  destinatario, sustitución de la clave efímera, y que el invitado que recibe
  una conversación no puede abrir las demás ni derivar la llave maestra.
- Decisiones: `D-039`, `D-040` y `D-041`.
- Riesgos o límites: el paquete es criptografía, no política. No decide qué se
  cifra ni cuándo se bloquea; eso llega en `F9.3` y `F9.4`. `wipe()` reduce la
  ventana en que una llave sigue en memoria, no la elimina: V8 pudo copiar el
  buffer antes. Sin auditoría externa.
- Estado nuevo: `F9.1` **done**, sin commit.
- Siguiente paso exacto: `F9.2`, esquemas Zod del nivel de privacidad, sobres,
  invitaciones y permisos en `packages/shared`.

### 2026-09-01 12:33 — Claude — BUG-GIT-IDENTITY-001

- Estado anterior: clon recién montado sin `node_modules`. Tras `npm install`,
  `npm run check` fallaba con 1 prueba roja:
  `apps/agent/src/agent.test.ts > worktrees reales > crea un worktree huerfano
  para permitir el primer commit aislado`, en
  `expect(commit.ok).toBe(true)` (línea 465).
- Objetivo: dejar la línea base verde antes de empezar el bloque F9.
- Hipótesis descartada: fallo ambiental sin más («este PC no tiene git
  configurado, se configura y ya»).
- Causa demostrada: `git config --list --show-origin | grep user.` no devuelve
  nada en este equipo, pero el fallo **no es sólo del equipo**. En
  `apps/agent/src/git.ts` conviven dos funciones que confirman:
  `ensureGitRepository` ya inyectaba `-c user.name=Luxy -c
  user.email=luxy@local.invalid` para su commit `estado inicial`, y
  `commitWorktree` no inyectaba nada. Por eso en un Windows sin identidad de
  Git, Luxy inicializa el proyecto correctamente y después **no puede confirmar
  el trabajo del modelo**. Es un fallo de producto, no de la prueba.
- Archivos leídos: `apps/agent/src/git.ts`, `apps/agent/src/agent.test.ts`,
  `apps/agent/src/process.ts`, `PROJECT-STATE.md`, `CURRENT-TASK.md`,
  `MASTER-PLAN.md`, `DECISIONS.md`, `AI-WORK-PROTOCOL.md`.
- Archivos modificados:
  - `apps/agent/src/git.ts`: constante `FALLBACK_IDENTITY_ARGS` y función
    `hasCommitIdentity()`, que pregunta a git con `git var GIT_COMMITTER_IDENT`
    en vez de leer la configuración a mano, porque la identidad puede venir de
    entorno, config local, global o de sistema y sólo git conoce la precedencia.
    `commitWorktree` usa la identidad de respaldo **sólo** si el equipo no tiene
    ninguna: ese commit es trabajo del usuario y su autoría no se pisa.
    `ensureGitRepository` pasa a reutilizar la misma constante; su commit sí es
    de Luxy y usa el respaldo siempre.
  - `apps/agent/src/agent.test.ts`: dos pruebas nuevas. Una fuerza un
    repositorio sin identidad con `user.useConfigOnly=true` (así el caso se
    reproduce aunque quien ejecute la suite sí tenga identidad global) y exige
    autor `Luxy <luxy@local.invalid>`. La otra configura `Persona Real` y exige
    que el respaldo **no** la pise.
- Comandos ejecutados:
  - `npm install` → exit 0.
  - `npx vitest run apps/agent/src/agent.test.ts` → 81/81, incluidas las dos
    nuevas y la que fallaba.
  - `npm run check` → **exit 0**; 96 archivos, 1.653 superadas, 14 omitidas.
- Resultado real: línea base verde. La prueba que fallaba pasa por el arreglo
  del código, no por haber tocado la configuración del equipo.
- Decisiones: la identidad de respaldo es un respaldo, no una firma. Un commit
  de trabajo conserva la autoría real cuando existe.
- Riesgos o límites: `git config --global` sigue sin estar puesto en este
  equipo. Luxy ya no depende de ello, pero los commits que Daniel haga a mano
  desde una terminal sí. Queda como `LA-030`. El intento de configurarlo desde
  la sesión fue denegado por el sistema de permisos sin mostrar diálogo, igual
  que el `git push` de `LA-028`.
- Estado nuevo: `done`, sin commit. No se ha pedido ni autorizado commit.
- Siguiente paso exacto: abrir `F9-VAULT-001` y empezar por `F9.1`
  (`packages/vault-crypto`) en rama aislada.

### 2026-08-27 10:49 — Codex — F4.9-DYNAMIC-HTTP-PROVIDERS, cierre

- Estado anterior: el runtime aceptaba entradas escritas a mano en
  `providers.http`, pero Studio no podía crearlas ni editarlas y los contratos
  de proveedor seguían cerrados en varias rutas.
- Cambio: proveedor HTTP dinámico validado de extremo a extremo; formulario de
  alta/edición/borrado; clave cifrada y ligada a su configuración; invalidación
  al cambiar endpoint; selectores dinámicos en Gateway, Trabajos y
  Conversaciones; recarga inmediata o diferida del agente.
- Archivos modificados: contratos y formato en `packages/shared`; host y agente
  en `apps/agent`; Studio, IPC, configuración y secretos en `apps/desktop`;
  handlers y pruebas de Studio en `apps/gateway`; documentación obligatoria y
  `docs/PROVIDERS.md`.
- Comandos ejecutados: consultas y cobertura de Codebase Memory; instalación
  local con `npm install --ignore-scripts`; typecheck forzado; pruebas dirigidas;
  `npm run lint`; `npm run format:check`; dos ejecuciones de `npm run check`.
- Resultado real: la primera suite completa detectó una incompatibilidad con el
  nombre histórico `connection:<id>` y se corrigió sin relajar la autorización
  por pertenencia. La ejecución final de `npm run check` terminó con exit 0:
  lint y tipos correctos, 96 archivos, 1.656 pruebas superadas, 9 omitidas y
  builds de todos los workspaces correctos.
- Límite conocido: `format:check` global falla en 333 archivos preexistentes y
  no se usó para reformatear el repositorio; `git diff --check` sí queda como
  comprobación acotada. No se automatizó la interfaz por política del proyecto.
- Decisión: D-038. El contrato dinámico cubre `chat completions`; un protocolo
  propietario diferente no se declara compatible por inferencia.
- Commit: Daniel lo autorizó explícitamente; creado localmente con el mensaje
  `feat: añade proveedores HTTP configurables` en la rama aislada.
- Operaciones no realizadas: ninguna API real, push, deploy ni migración. `npm
  install` volvió a informar las 12 vulnerabilidades ya abiertas en `LA-027`;
  no se aplicó `audit fix`.
- Estado nuevo: F4.9 implementada y verificada localmente.
- Siguiente paso exacto: integrar el commit local y ejecutar `LA-029`.

### 2026-08-26 11:40 — Codex — F4.9-DYNAMIC-HTTP-PROVIDERS, inicio

- Estado anterior: consolidación cerrada y publicada; `main`/`origin/main` en
  `2ae1291`. El último commit sólo permitía cifrar la clave de proveedores HTTP
  previamente escritos en `config.json`.
- Objetivo: administrar proveedores HTTP compatibles desde Studio y usarlos sin
  editar archivos a mano.
- Hipótesis o causa demostrada: el runtime ya consume `providers.http`; el hueco
  es de edición, validación y recarga en Desktop.
- Archivos leídos: documentación obligatoria; esquemas shared; configuración,
  proveedor y host del agente; store, IPC, controlador y Configuración de Desktop.
- Archivos modificados: `CURRENT-TASK.md`, `CHANGELOG-WORK.md`.
- Comandos ejecutados: comprobación de Git/worktrees; Codebase Memory
  `list_projects`, `index_status`, búsquedas, snippets, trazas y cobertura.
- Resultado real: worktree aislado
  `luxy/f4-9-dynamic-http-providers`; grafo `ready` sobre `2ae1291`; flujo
  existente acotado desde `ConfigStore.save` hasta
  `LuxyAgent.initializeProviders`.
- Pruebas: el HEAD de partida pasó `npm run check` el 2026-08-26 antes de crear
  la rama: 94 archivos, 1.641 pasadas, 9 omitidas, 0 fallos; lint, tipos y build
  correctos.
- Decisiones: ninguna API real; claves sólo en `SecretStore`; sin commit, push,
  deploy ni migraciones.
- Riesgos o límites: la metadata de cobertura del grafo está cambiada respecto
  a su generación; se leerá el fuente exacto antes de cada edición.
- Estado nuevo: `F4.9-DYNAMIC-HTTP-PROVIDERS` en progreso.
- Siguiente paso exacto: definir contratos y persistencia segura del proveedor.

### 2026-08-21 16:00 — Claude — renombra la rama canónica a `main`

- Estado anterior: saneamiento final cerrado (`5312d00`), `LA-028` abierta
  para el push de `feat/luxy-desktop`, bloqueado por el entorno. Daniel
  preguntó la diferencia entre «Luxy» (el proyecto) y `feat/luxy-desktop`
  (la rama) y pidió un nombre claro como `main`.
- Objetivo: renombrar la rama local sin perder historia ni forzar nada,
  comprobando primero que no hay conflicto con lo que ya existe en el
  remoto.
- Comandos ejecutados: `git branch -vv`, `git branch -r`,
  `git merge-base --is-ancestor c6e5094 HEAD`, `git log --oneline origin/main`,
  `git log --oneline master` — todo de lectura, antes de tocar nada.
- Resultado real:
  1. El remoto ya tiene `origin/main` (`c6e5094`) como rama por defecto
     (`origin/HEAD -> origin/main`), y ese commit es **ancestro directo**
     del HEAD actual — misma historia, sin divergencia.
  2. También existe una rama local `master` (`64d0210`, «primera version
     funcional de Luxy»), antigua y sin relación con esta consolidación; no
     se ha tocado.
  3. `git branch -m feat/luxy-desktop main` — cambio puramente local y
     reversible, sin afectar al remoto.
  4. `git branch --set-upstream-to=origin/main main` — el tracking pasa de
     `origin/feat/luxy-desktop` a `origin/main`. `git status` ahora informa
     «ahead 32» respecto a `origin/main` (antes «ahead 25» respecto a
     `origin/feat/luxy-desktop`, porque `origin/main` está más atrás).
- Archivos modificados: `LOCAL-ACTIONS.md` (`LA-028` actualizada: comando de
  push corregido a `git push origin main`, explica el cambio de nombre y
  que `origin/feat/luxy-desktop` queda intacta sin actualizar), `CURRENT-TASK.md`
  (nuevo checkpoint al principio con el estado real; el checkpoint anterior
  se conserva debajo, marcado como histórico, sin reescribirlo).
- Pruebas: ninguna (cambio de metadato de git y documentación, sin tocar
  código).
- Decisiones: ninguna nueva formal; queda pendiente decidir qué hacer con
  `origin/feat/luxy-desktop` (dejarla o borrarla) una vez confirmado el push
  a `main`.
- Riesgos o límites: el push a `origin/main` sigue bloqueado por el entorno
  (ver `LA-028`); hasta que Daniel lo ejecute, el remoto sigue exactamente
  como estaba. Ningún dato se ha perdido ni reescrito: el rename es
  puramente local.
- Estado nuevo: rama canónica local = `main`, HEAD `02c2080` (antes de este
  commit de documentación).
- Siguiente paso exacto: Daniel ejecuta `LA-028`
  (`git push origin main`) desde fuera de esta sesión.

### 2026-08-21 15:00 — Claude — smoke test manual final de la copia canónica

- Estado anterior: `LUXY-CONSOLIDATION-001` cerrada y commiteada (`90eff24`).
  Daniel pidió, antes de cerrar la sesión, un smoke test manual real de
  Studio (no sólo pruebas automatizadas) para validar visualmente el bloque
  integrado: diálogo de confirmación React, ficha de proyecto, campos
  Proyecto/Rama, y navegación básica de Trabajos/Conversaciones/
  Laboratorio/Ajustes.
- Objetivo: arrancar la app real desde `C:\Users\daniel\Desktop\Luxy` y
  comprobarlo con la app en pantalla, sin ejecutar APIs reales ni trabajos
  de pago.
- Comandos ejecutados: `npm run desktop:dev` (Electron + Vite dev server,
  en segundo plano). Automatización con PowerShell:
  `System.Windows.Automation` (UI Automation, `InvokePattern` por nombre
  accesible de botón) para navegar y pulsar controles, y
  `System.Drawing`/`System.Windows.Forms.Screen` para capturas de pantalla
  de verificación visual. `taskkill` sobre el proceso principal de Electron
  al terminar.
- Resultado real: arranque correcto (agente en marcha, Gateway conectado);
  diálogo de confirmación React verificado en vivo sobre un trabajo fallido
  real (`LUX-8APM`) y cancelado con «Volver» sin ejecutar nada; ficha de
  proyecto verificada abriendo y cerrando la del proyecto `test` sin
  guardar; campos Proyecto/Rama visibles en el detalle de un trabajo real;
  Trabajos, Proyectos, Conversaciones, Laboratorio y Ajustes navegables sin
  errores visibles, todos con datos reales (30 trabajos, 17 conversaciones,
  3 proyectos). Detalle completo en `TEST-RESULTS.md`,
  entrada `2026-08-21 15:00`.
- Archivos modificados: `TEST-RESULTS.md` (esta entrada de smoke test).
- Decisiones: ninguna nueva.
- Riesgos o límites: la primera técnica de automatización probada (clic de
  ratón por coordenadas) resultó poco fiable en este entorno porque el foco
  de la ventana volvía intermitentemente a esta sesión de Claude Code entre
  llamadas a PowerShell; no es un problema de Luxy, se resolvió cambiando a
  UI Automation. No se ejecutó ninguna API real, trabajo nuevo, evaluación
  del Laboratorio, migración ni deploy. El único job existente tocado
  (`LUX-8APM`) sólo se leyó y su diálogo de reintento se canceló.
- Estado nuevo: smoke test manual completado, **ningún fallo funcional
  encontrado**. `LUXY-CONSOLIDATION-001` sigue `done`.
- Siguiente paso exacto: ninguno de producto — a la espera de que Daniel
  autorice el commit de esta entrada y decida, junto con ChatGPT/Codex y
  Claude, el nuevo `MASTER-PLAN.md`.

### 2026-08-21 13:50 — Claude — LUXY-CONSOLIDATION-001 (documentación sincronizada, checkpoint final, cierre)

- Estado anterior: línea canónica fusionada (`e40268a`), sólo un worktree
  restante, `git stash@{0}` auditado y descartado, memoria MCP reindexada y
  verificada. Faltaba sincronizar la documentación de continuidad y repetir
  el checkpoint completo antes de cerrar la tarea.
- Objetivo: dejar `AI-WORK-PROTOCOL.md`, `CURRENT-TASK.md`,
  `PROJECT-STATE.md`, `MASTER-PLAN.md` y `LOCAL-ACTIONS.md` coherentes con el
  estado real, sin presentar la consolidación como trabajo pendiente, y
  ejecutar el checkpoint final: `git status`, `git worktree list`, lint,
  typecheck, suite, build, `git diff --check` y comprobación de secretos.
- Archivos modificados:
  - `AI-WORK-PROTOCOL.md`: nueva sección 9 «Memoria MCP / codebase-memory»
    (precedencia código→documentación→MCP→handoffs, cuándo reindexar, qué no
    hacer con `graph.db.zst`), referencias cruzadas añadidas en la sección 2
    (inicio de sesión) y la 8 (relevo entre IAs); secciones 9–11 antiguas
    renumeradas a 10–12 para mantener la secuencia.
  - `CURRENT-TASK.md`: reescrito por completo. Sustituye el conjunto disperso
    de tareas antiguas (`CONSOLIDATE-WORKTREES-001`, `BUG-HUNYUAN-002`,
    `GIT-CHECKPOINT-001`, más el histórico de `F0`–`F4`/`P0.x`/`LA-0xx`) por
    un único checkpoint activo que resume `LUXY-CONSOLIDATION-001` de
    principio a fin, remite al `CHANGELOG-WORK.md` para el detalle
    cronológico en vez de duplicarlo, y deja explícito que no hay tarea
    siguiente todavía (el nuevo `MASTER-PLAN.md` empresarial se define
    después, con Daniel, ChatGPT/Codex y Claude juntos).
  - `PROJECT-STATE.md`: cabecera actualizada — línea canónica, HEAD, y una
    nota de que las entradas anteriores de «consolidación en curso» son
    historial, no estado pendiente.
  - `MASTER-PLAN.md`: cabecera actualizada; fila `CONSOLIDATE-WORKTREES-001`
    de la tabla de incidencias pasada de `in_progress` a `done` con motivo y
    fecha; `BUG-HUNYUAN-002` anotada como código ya verificado en `e40268a`.
  - `LOCAL-ACTIONS.md`: `LA-026` (borrar `.codebase-memory.pre-merge-backup/`,
    opcional, comando incluido) y `LA-027` (auditar las 12 vulnerabilidades
    de `npm audit` sin `--force`, pospuesto deliberadamente).
  - `DECISIONS.md`, `AGENTS.md`, `CLAUDE.md`, `README.md`: revisados
    (`grep` dirigido por `consolidat`/`worktree`); no necesitaban cambios —
    describen arquitectura y política general, no un estado puntual que la
    consolidación haya invalidado.
- Comandos ejecutados para el checkpoint final: `git status --short
  --branch`, `git worktree list`, `git diff --check`, `npm run lint`,
  `npm run typecheck`, `npm test`, `npm run build`, y un escaneo de patrones
  de secretos (`sk-…`, `api_key`, `service_role`, `Bearer`, bloques PEM)
  sobre los documentos tocados en toda la sesión.
- Resultado real: `git worktree list` → una sola línea (la copia canónica);
  lint sin incidencias; typecheck sin errores; suite **94 archivos, 1.641
  pasadas, 9 omitidas, 0 fallos**; build correcto en los cuatro workspaces;
  `git diff --check` sin salida; los dos archivos de claves siguen sin
  seguimiento y sin coincidencias de patrones de secreto en la documentación
  tocada.
- Decisiones: ninguna nueva.
- Riesgos o límites: la documentación (7 archivos) sigue sin commitear,
  pendiente de autorización explícita de Daniel — no se asumió que el
  «adelante» de un bloque anterior cubriera también este. `npm install`
  reportó 12 vulnerabilidades (5 moderate, 6 high, 1 critical); registradas
  en `LA-027`, sin `npm audit fix` ejecutado por instrucción explícita.
  `.codebase-memory.pre-merge-backup/` sigue en disco (permiso denegado para
  borrarlo por comando); `LA-026` lo deja como acción manual opcional. No hay
  validación manual de UI pendiente conocida, pero nadie ha visto todavía en
  pantalla el diálogo de confirmación de `Studio.tsx` ni la ficha de
  proyecto corriendo de verdad.
- Estado nuevo: **`LUXY-CONSOLIDATION-001` = `done`.**
- Siguiente paso exacto: ninguno de producto — a la espera de que Daniel
  autorice el commit de esta documentación y decida, junto con ChatGPT/Codex
  y Claude, el nuevo `MASTER-PLAN.md` para la etapa de Luxy Organization.

### 2026-08-21 13:20 — Claude — LUXY-CONSOLIDATION-001 (memoria MCP reindexada sobre la línea canónica)

- Estado anterior: `git worktree list` reducido a la copia canónica
  (`e40268a`); el índice MCP (`codebase-memory-mcp`) no se había reindexado
  explícitamente desde la fusión, aunque el watcher en segundo plano ya lo
  había actualizado de forma autónoma.
- Objetivo: verificar y forzar el checkpoint de memoria MCP sobre la línea
  canónica, comprobar que recupera arquitectura/módulos/contexto reales, y
  decidir el destino de `.codebase-memory.pre-merge-backup/`.
- Herramientas usadas: `mcp__codebase-memory-mcp__list_projects`,
  `index_status` (antes y después), `index_repository` (modo `full`,
  `persistence: true`), `get_architecture`, `search_graph`.
- Resultado real:
  1. `index_status` reveló que el índice ya tenía
     `git.head_sha: e40268a1a5687145dbd510c01fd4d8c64062d2b0` y
     `git.base_sha: 65ca161...` — coincide exactamente con el commit
     canónico actual. El watcher en segundo plano ya lo había refrescado tras
     la fusión y la limpieza de worktrees.
  2. Se forzó de todos modos un reindex explícito (`index_repository`,
     `mode: full`, `persistence: true`) como checkpoint verificado, no sólo
     confiado al watcher. Resultado: mismos 4.474 nodos / 14.190 aristas,
     `status: indexed`, artefacto persistido en `.codebase-memory/graph.db.zst`.
     9 archivos `parse_partial` (demos HTML, migraciones SQL, `markdown.ts`,
     `secure-storage.test.ts`) — best-effort, ninguno crítico para la
     estructura del código TypeScript. 0 archivos `skipped`.
  3. Verificación de recuperación real: `get_architecture` devuelve los ocho
     paquetes correctos del monorepo (`desktop`, `agent`, `gateway`, `shared`,
     `remote-protocol`, `remote-crypto`, `migrations`, `setup-machine`) con
     conteos de nodos coherentes. `search_graph` con la consulta
     `"buildProjectProfileUpdate resolveHttpRequestTimeout"` — dos símbolos
     que se integraron o verificaron en esta misma sesión — los localiza
     exactamente en `apps/desktop/src/renderer/project-profile.ts:61-144` y
     `apps/agent/src/providers/http-provider.ts:113-117`. La memoria MCP
     corresponde al código real de `e40268a`.
- Archivos modificados: `.codebase-memory/graph.db.zst` y
  `.codebase-memory/artifact.json` (regenerados por la herramienta; no se
  editaron a mano, según la regla de `CLAUDE.md`).
- Decisión sobre `.codebase-memory.pre-merge-backup/`: con el reindex
  verificado, el backup ya no hace falta. Intenté eliminarlo
  (`rm -rf .codebase-memory.pre-merge-backup`) pero el entorno denegó el
  permiso para ese comando. Queda pendiente que Daniel lo borre manualmente
  (`C:\Users\daniel\Desktop\Luxy\.codebase-memory.pre-merge-backup\`) o
  autorice explícitamente el comando; no bloquea el resto de la
  consolidación.
- Pruebas: no aplica (operación de indexación, no de código).
- Decisiones: ninguna nueva.
- Riesgos o límites: la cobertura del índice es best-effort; los 9 archivos
  `parse_partial` no son código TypeScript de producto crítico. El backup
  `.codebase-memory.pre-merge-backup/` sigue en disco, pendiente de limpieza
  manual.
- Estado nuevo: memoria MCP consolidada y verificada contra `e40268a`.
- Siguiente paso exacto: sincronizar la documentación final
  (`PROJECT-STATE.md`, `CURRENT-TASK.md`, `MASTER-PLAN.md`, `DECISIONS.md`,
  `LOCAL-ACTIONS.md`, `AI-WORK-PROTOCOL.md`, `AGENTS.md`, `CLAUDE.md`,
  `README.md`) y ejecutar el checkpoint final completo.

### 2026-08-21 13:00 — Claude — LUXY-CONSOLIDATION-001 (últimos tres worktrees eliminados)

- Estado anterior: quedaban `lux-timeout-deepseek`, `phase-4d-session-host` y
  `ux-001-detalle-trabajo` sin auditar contra `e40268a`, más el propio
  `luxy-consolidate-worktrees`, ya redundante tras la fusión.
- Objetivo: completar la matriz de esos tres worktrees con evidencia
  funcional concreta en las tres áreas que pidió Daniel explícitamente
  (timeout/reintentos/diagnóstico DeepSeek, preservación de código de Remote,
  detalle de trabajos), y dejar `git worktree list` con sólo la copia
  canónica.
- Comandos ejecutados: delegado a un subagente de sólo lectura — `git status
  --short --branch`, `git diff` por archivo, `git show e40268a:<ruta>`,
  `git merge-base --is-ancestor <head> e40268a`, `git ls-tree -r e40268a
  --name-only`, lectura directa de código — sin ninguna mutación de git.
  Verificación propia adicional: `grep -n "resolveHttpRequestTimeout\|
  outputBudgetExhausted\|retryable === false"
  apps/agent/src/providers/http-provider.ts` contra el checkout ya fusionado,
  confirmando las tres funciones en las líneas 113, 227 y 834.
- Resultado real, añadido a `.claude-consolidation-matrix.md`:
  - `lux-timeout-deepseek` (sin commits propios, `65ca161`): los tres bloques
    funcionales sin commitear —`resolveHttpRequestTimeout()` (una llamada
    agentic usa el timeout completo del trabajo salvo que un lote imponga
    uno menor), el guard `retryable === false` en `shouldRetry`, y la
    detección de `outputBudgetExhausted` (DeepSeek-V4-Pro agotando la salida
    razonando, con o sin `finish_reason`)— están **literalmente idénticos**
    en `e40268a`, con los mismos tres tests nuevos en `providers.test.ts`.
    Sólo difiere el modelo por defecto de `live.test.ts` (prueba manual, no
    corre en CI), sin efecto funcional. Documentación de continuidad del
    worktree: contenido ya reflejado en los archivos consolidados.
  - `phase-4d-session-host` (HEAD `e27aa05`) y `ux-001-detalle-trabajo` (HEAD
    `6bd7077`): ambos worktrees estaban limpios (sin `M`/`??`) y sus HEAD son
    ancestros confirmados de `e40268a`
    (`git merge-base --is-ancestor` exit 0). Para Remote: los 15 archivos de
    `apps/desktop/src/main/remote-host/` (incluido `session-host.ts` + test)
    existen en el árbol de `e40268a` — verificación de preservación de
    código únicamente; Remote sigue pausado, ninguna ruta lo activa. Para
    detalle de trabajos: `callMetricsOf` (`studio-detail.ts:10`),
    `openWorktreeFolder` cableado por IPC (`shared/ipc.ts:330` +
    `preload/index.ts:23`) e `isProviderId` (`constants.ts:73`) presentes y
    cableados.
  - Ningún caso de "REQUIERE DECISIÓN DE DANIEL" en estos tres worktrees.
- Archivos modificados: `.claude-consolidation-matrix.md` (scratch, no
  versionado) — tres secciones nuevas añadidas al final, sin tocar las
  anteriores.
- Comandos de eliminación ejecutados, con autorización previa de Daniel de
  eliminar todo worktree sin trabajo único: `git worktree remove --force`
  para `lux-timeout-deepseek`, `phase-4d-session-host` y
  `ux-001-detalle-trabajo`; y, al comprobar que `luxy-consolidate-worktrees`
  quedaba limpio y en el mismo commit `e40268a` que la copia canónica (ya
  redundante como worktree separado), también para ese. `git worktree prune`
  después de los cuatro.
- Resultado real: los cuatro `git worktree remove` terminaron sin error.
  `git worktree list` muestra únicamente
  `C:/Users/daniel/Desktop/Luxy e40268a [feat/luxy-desktop]`.
- Pruebas: ninguna nueva (no se tocó código de producto en este paso); la
  verificación fue lectura y comparación contra el estado ya probado de
  `e40268a`.
- Decisiones: ninguna nueva.
- Riesgos o límites: las ramas locales `luxy/timeout-deepseek-agentic`,
  `luxy/phase-4d-session-host`, `luxy/ux-001-detalle-trabajo` y
  `luxy/consolidate-worktrees` siguen existiendo (sólo se retiraron las
  carpetas de trabajo, no las ramas). No se ha hecho push de ninguna rama.
- Estado nuevo: los ocho worktrees originales de `LUXY-CONSOLIDATION-001`
  quedan reducidos a uno solo, la copia canónica.
- Siguiente paso exacto: reindexar la memoria MCP sobre la línea canónica y
  decidir el destino de `.codebase-memory.pre-merge-backup/`; después,
  sincronizar la documentación final y ejecutar el checkpoint de cierre.

### 2026-08-21 12:30 — Claude — LUXY-CONSOLIDATION-001 (auditoría de git stash@{0})

- Estado anterior: `git stash@{0}` conservaba el snapshot de cambios locales
  del checkout principal previos al fast-forward (20 archivos rastreados + 5
  sin seguimiento), sin auditar.
- Objetivo: clasificar cada archivo del stash antes de decidir si se descarta,
  siguiendo la instrucción explícita de Daniel de no borrarlo sin mirar.
- Comandos ejecutados: `git diff --stat "stash@{0}^1" "stash@{0}"` (cambios
  rastreados), `git ls-tree -r --name-only "stash@{0}^3"` (archivos sin
  seguimiento capturados), comparación dirigida por título de prueba
  (`comm -23` sobre los patrones `it(`/`describe(` de `agent.test.ts` y
  `live.test.ts`), comparación por encabezado (`comm -23` sobre `## LA-`,
  `| F`, `###`) para `LOCAL-ACTIONS.md`, `MASTER-PLAN.md`, `PROJECT-STATE.md`
  y `TEST-RESULTS.md`, y diff directo contra HEAD para `catalog.ts`,
  `catalog-fetch.ts`, `types.ts`, `useCatalog.ts` y el bloque CSS
  `.model-catalog-list`.
- Resultado real, por archivo:
  - **YA INTEGRADO / REEMPLAZADO POR IMPLEMENTACIÓN POSTERIOR** (sin ninguna
    diferencia semántica útil frente a `e40268a`): `CHANGELOG-WORK.md`,
    `CURRENT-TASK.md`, `LOCAL-ACTIONS.md`, `MASTER-PLAN.md`, `PROJECT-STATE.md`,
    `apps/agent/src/agent.test.ts`, `apps/agent/src/providers/live.test.ts`
    (cero títulos de prueba únicos frente a HEAD), `apps/desktop/src/renderer/pages/Config.tsx`,
    `Conversations.tsx`, `Laboratory.tsx`, `Setup.tsx`, `apps/desktop/src/renderer/styles.css`
    (el bloque `.model-catalog-list > li { border: 0 }` que documentaba
    `F4.1-UI2` ya está byte a byte en HEAD), `packages/shared/src/models/catalog.ts`,
    `catalog-fetch.ts`, `catalog-fetch.test.ts`, `registry.test.ts`,
    `router-v2.test.ts`, `types.ts`, `packages/shared/src/telegram/commands.test.ts`,
    y el archivo sin seguimiento `apps/desktop/src/renderer/useCatalog.ts` (la
    versión de HEAD es estrictamente más nueva: ya tiene el estado `loading`
    que la del stash no tenía).
  - **ANTIGUO/DESCARTABLE**: `deploy-gateway.bat`, `rebuild-and-start-luxy.bat`,
    `rebuild-luxy.bat`, `start-luxy.bat` (sin seguimiento) — versiones que
    redirigían a `lux-auto-init-git`, ya identificado como un error de una
    tarea anterior; HEAD trae las versiones autocontenidas correctas.
  - **ÚNICO Y NECESARIO**: cinco encabezados de `TEST-RESULTS.md`
    (`F4.1-T6`, `F4.3-UI`, `F4.1-T7`, `F4.1-UI`, `F4.1-UI2`, todos
    2026-08-11) ausentes en el historial de `e40268a`. El código que
    documentan ya estaba confirmado presente por otra vía (ver arriba); eran
    únicamente el rastro histórico de validación manual de Daniel, huérfano
    porque las ramas divergieron antes de que `luxy/consolidate-worktrees`
    los heredara.
- Archivos modificados: `TEST-RESULTS.md` — los cinco registros rescatados,
  con una nota que explica su procedencia y por qué no representan trabajo
  pendiente.
- Pruebas: ninguna (cambio puramente documental).
- Decisiones: ninguna nueva.
- Riesgos o límites: ninguno detectado; la clasificación cubre el 100% de los
  25 archivos del stash.
- Estado nuevo: `git stash@{0}` queda vacío de contenido útil no rescatado;
  listo para `git stash drop` una vez que Daniel lo confirme.
- Siguiente paso exacto: `git stash drop stash@{0}` (mantener `stash@{1}`,
  ajeno a esta tarea); continuar con la matriz de los tres worktrees
  restantes.

### 2026-08-21 12:00 — Claude — LUXY-CONSOLIDATION-001 (línea canónica fusionada, primer lote de worktrees eliminado)

- Estado anterior: bloque 1 (confirmaciones React + ficha de proyecto)
  commiteado en `luxy/consolidate-worktrees` como `e40268a`, sin push. El
  checkout principal (`feat/luxy-desktop`) seguía en `65ca161` con cambios
  locales sin commit ya confirmados como duplicados o superados por el merge
  pendiente.
- Objetivo: con autorización explícita de Daniel, (a) portar los campos
  `Proyecto`/`Rama` que faltaban de `lux-auto-init-git` en `Studio.tsx`, (b)
  convertir `luxy/consolidate-worktrees` en la línea canónica fusionándola en
  `feat/luxy-desktop`, y (c) eliminar físicamente los worktrees ya confirmados
  sin trabajo único.
- Archivos modificados:
  - `apps/desktop/src/renderer/pages/Studio.tsx` (en `luxy-consolidate-worktrees`):
    añadidos `Proyecto` (tras Origen) y `Rama` (tras Modelo) al `Readout` del
    detalle, copiados de `lux-auto-init-git`.
- Comandos ejecutados, en orden:
  1. `npm run typecheck` / `npm run lint` en `luxy-consolidate-worktrees` tras
     el cambio de `Studio.tsx` — limpios.
  2. `git add` + `git commit` en `luxy-consolidate-worktrees` → `e40268a`.
  3. En el checkout principal: `git stash push -u -m "pre-merge snapshot..."`
     con la lista explícita de los archivos locales ya confirmados como
     duplicados/superados (catálogo de modelos, páginas de Desktop, `.bat`),
     dejando fuera del stash los archivos sensibles/ajenos (demos, claves,
     `.codebase-memory/`).
  4. `mv .codebase-memory .codebase-memory.pre-merge-backup` — colisionaba con
     la versión versionada que trae el merge (el índice MCP es regenerable,
     nunca se edita a mano).
  5. `git merge --ff-only luxy/consolidate-worktrees` → fast-forward limpio
     `65ca161..e40268a`, 88 archivos.
  6. `npm install` — `node_modules` llevaba desde 2026-08-01 sin refrescar;
     sin este paso `npm run typecheck` fallaba con errores de tipos falsos
     (`callMetrics`, `workspacePath`, `resumeJobId` "no existen") causados por
     una versión de dependencia desincronizada del `package-lock.json` recién
     fusionado, no por el código.
  7. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` en el
     checkout principal ya fusionado.
  8. `git worktree remove --force` para `lux-auto-init-git`, `lux-bug-hunyuan`
     y `luxy-work-update-001`.
- Resultado real: fast-forward limpio; typecheck y lint sin incidencias; suite
  completa **94 archivos, 1.641 pasadas, 9 omitidas, 0 fallos**; build correcto
  en shared/agent/desktop/gateway. Los tres `git worktree remove` terminaron
  sin error. `git worktree list` confirma que sólo quedan
  `lux-timeout-deepseek`, `luxy-consolidate-worktrees`, `phase-4d-session-host`
  y `ux-001-detalle-trabajo` además del checkout principal.
- Decisiones: ninguna nueva más allá de las ya registradas en la entrada
  anterior.
- Riesgos o límites: `git stash@{0}` de este checkout conserva el snapshot
  previo al merge (recuperable, no descartado) por si algo de esos archivos
  locales resultara tener valor no detectado; `.codebase-memory.pre-merge-backup/`
  conserva el índice MCP local anterior por la misma razón, aunque es
  regenerable. Ninguno de los dos se ha borrado todavía. Las ramas locales
  `luxy/auto-init-git`, `lux/bug-hunyuan-backcompat` y
  `luxy/work-update-001-studio` siguen existiendo (sólo se retiró la carpeta de
  trabajo, no la rama). No se ha hecho push de `feat/luxy-desktop` ni de
  `luxy/consolidate-worktrees`.
- Estado nuevo: `feat/luxy-desktop` (este checkout) es ahora la línea canónica
  con todo el bloque 1 integrado, en `e40268a`, 21 commits por delante de
  `origin/feat/luxy-desktop`. `LUXY-CONSOLIDATION-001` sigue `in_progress`.
- Siguiente paso exacto: auditar `lux-timeout-deepseek`, `phase-4d-session-host`
  y `ux-001-detalle-trabajo` con el mismo procedimiento de matriz antes de
  proponer su eliminación (sus HEAD ya están incluidos como commits en la línea
  fusionada, así que es probable que tampoco tengan trabajo único, pero
  `lux-timeout-deepseek` tiene cambios sin commitear sin comparar todavía).
  Decidir con Daniel qué hacer con `git stash@{0}` y
  `.codebase-memory.pre-merge-backup/`. Ningún commit de este checkout se ha
  hecho todavía sobre la documentación de continuidad más allá de lo que trajo
  el fast-forward — falta decidir si se commitea este propio registro.

### 2026-08-21 11:30 — Claude — LUXY-CONSOLIDATION-001 (bloque 1: ficha de proyecto + confirmaciones)

- Estado anterior: `luxy/consolidate-worktrees` (`11dff48`) identificado como
  base de convergencia de ocho worktrees. Matriz de comparación completa contra
  `lux-bug-hunyuan`, `lux-auto-init-git` y `luxy-work-update-001` en
  `C:\Users\daniel\Desktop\Luxy\.claude-consolidation-matrix.md` (scratch, no
  versionado). Dos decisiones de Daniel resueltas: (a) arquitectura de
  confirmación bloqueante = diálogo React embebido para toda la app; (b)
  integrar ya el bloque único de `lux-auto-init-git`.
- Objetivo: aplicar esas dos decisiones sobre este worktree.
- Archivos leídos: `Studio.tsx` y `Laboratory.tsx` de este worktree (patrón
  `pendingConfirmation`/`confirm-layer`/`confirm-dialog`);
  `apps/desktop/src/renderer/pages/Config.tsx`, `project-profile.ts` y
  `project-profile.test.ts` de `lux-auto-init-git`; su `styles.css` (bloques
  `.project-profile__*`/`.project-checks*`); su `DECISIONS.md` (`D-034` a
  `D-036`).
- Archivos modificados:
  - `apps/desktop/src/renderer/pages/Studio.tsx`: sustituidos los dos
    `window.confirm()` de `decide()`/`retry()` por el mismo patrón de estado +
    diálogo React que ya usaba `Laboratory.tsx`. La comprobación de proveedor
    histórico (`isProviderId`) se mantiene, ahora tras aceptar el diálogo, igual
    que antes se hacía tras aceptar el `window.confirm()`.
  - `apps/desktop/src/renderer/pages/Config.tsx`: `ProjectsPage` incorpora el
    panel «Ficha · alias» completo (nombre visible, descripción, tipo, stack,
    instrucciones, comandos de comprobación estructurados, timeout y los
    cuatro permisos), conservando los botones `onOpenProject` que ya existían
    en este worktree. `toggleHostChecks` se sustituye por el checkbox
    `allowHostChecks` dentro de la ficha.
  - Nuevos: `apps/desktop/src/renderer/project-profile.ts` y
    `project-profile.test.ts` (lógica pura de la ficha, copiados de
    `lux-auto-init-git` sin cambios).
  - `apps/desktop/src/renderer/styles.css`: añadido el bloque
    `.project-profile__*`/`.project-checks*`/`.project-list` con su
    media-query, copiado de `lux-auto-init-git`.
  - `DECISIONS.md`: añadidas `D-034`, `D-035`, `D-036` (texto de
    `lux-auto-init-git`, sin cambios) y `D-037`, nueva, que documenta
    explícitamente por qué se descartó el diálogo nativo IPC de
    `lux-bug-hunyuan` en favor del patrón React ya existente.
  - `TEST-RESULTS.md`: entrada de esta comprobación.
- Comandos ejecutados: `npm run typecheck`; `npx vitest run
  apps/desktop/src/renderer/project-profile.test.ts
  apps/desktop/src/shared/ipc.test.ts`; `npm test`; `npm run lint`; `npm run
  build`.
- Resultado real: typecheck sin errores; 38/38 pruebas focalizadas; suite
  completa 94 archivos, 1.641 pasadas, 9 omitidas, 0 fallos; lint sin
  incidencias; build correcto en los cuatro workspaces.
- Decisiones: `D-037` (nueva, ver `DECISIONS.md`).
- Riesgos o límites: no se portaron los campos `Proyecto`/`Rama` que
  `lux-auto-init-git` añadía al detalle de `Studio.tsx` (la matriz los marcó
  como fusión manual pendiente, fuera del alcance ya decidido); no se tocó
  `lux-bug-hunyuan` ni `luxy-work-update-001` todavía; ninguno de los tres
  worktrees comparados se ha eliminado.
- Estado nuevo: bloque 1 de `LUXY-CONSOLIDATION-001` cerrado en este worktree.
  Sigue `in_progress` a nivel de tarea completa.
- Siguiente paso exacto: decidir si se portan los campos `Proyecto`/`Rama` de
  `Studio.tsx` (`lux-auto-init-git`); revisar si queda algo más que rescatar de
  `lux-bug-hunyuan` fuera del bloque de diálogo ya resuelto; con eso,
  `lux-auto-init-git` pasaría a eliminable. `luxy-work-update-001` ya es
  eliminable sin condiciones según la matriz.

### 2026-08-21 11:45 — Claude — LUXY-CONSOLIDATION-001 (bloque 1, cierre)

- Estado anterior: bloque 1 verificado, pendiente sólo de decidir los campos
  `Proyecto`/`Rama` de `Studio.tsx` y de autorización de commit.
- Objetivo: cerrar el bloque 1 con la decisión de Daniel (portar los campos) y
  commitear localmente.
- Archivos modificados: `apps/desktop/src/renderer/pages/Studio.tsx` — añadidos
  `{ label: 'Proyecto', value: studio.detail.job.projectAlias }` tras Origen y
  `{ label: 'Rama', value: metadata['branch'] ?? 'sin rama' }` tras Modelo, en
  el `Readout` del detalle, copiados de `lux-auto-init-git` sin adaptar (los
  campos que la base tenía de más — métricas de llamadas, «abrir worktree» —
  se conservan intactos).
- Comandos ejecutados: `npm run typecheck`, `npm run lint`.
- Resultado real: typecheck sin errores, lint sin incidencias.
- Decisiones: ninguna nueva.
- Riesgos o límites: no se repitió la suite completa tras este cambio puntual
  de JSX (sin lógica nueva); el bloque 1 completo sí la tiene registrada en la
  entrada anterior.
- Estado nuevo: `lux-bug-hunyuan`, `lux-auto-init-git` y `luxy-work-update-001`
  quedan sin trabajo único pendiente frente a esta base, según la matriz
  actualizada en `.claude-consolidation-matrix.md` del checkout principal.
  Daniel autorizó el commit de este bloque en `luxy/consolidate-worktrees`
  (sin push).
- Siguiente paso exacto: commitear este bloque; después, pedir a Daniel
  confirmación explícita y separada para `git worktree remove` de los tres
  worktrees ya sin trabajo único, y para decidir el destino final de
  `luxy/consolidate-worktrees` (¿se convierte en `feat/luxy-desktop`? ¿push?).

### 2026-08-17 — Codex — GIT-CHECKPOINT-001

- Estado anterior: `luxy/auto-init-git` estaba publicado en `1b01fc3`, con 44
  archivos versionados modificados y 9 archivos nuevos del desarrollo posterior.
- Objetivo: consolidar el checkpoint local autorizado por Daniel antes de
  actualizar GitHub, sin incorporar la carpeta principal ni archivos sensibles.
- Archivos revisados: código, pruebas, documentación y lanzadores del worktree
  aislado; los archivos nuevos son políticas/pruebas de notificación y workspace,
  catálogo compartido y cuatro lanzadores `.bat` documentados.
- Comandos ejecutados: `gh auth status`, estado y remotos Git, comparación con
  GitHub, `git diff --check`, búsqueda de patrones de secretos y `npm.cmd run check`.
- Resultado real: GitHub conserva `1b01fc3`, pero no este checkpoint. El escaneo
  sólo encontró credenciales ficticias en pruebas de redacción; no hay claves
  reales en el alcance. Diff sin errores.
- Pruebas: lint y typecheck correctos; 88 archivos, 1.594 pruebas pasadas,
  9 omitidas y 0 fallos; build completo correcto.
- Decisiones: Daniel autorizó el commit y pidió push. El commit se hace sólo en
  `luxy/auto-init-git`. El push sigue sujeto a `allowPush: true` y a la segunda
  confirmación obligatoria; la configuración actual deja `allowPush` sin definir.
- Riesgos o límites: validaciones manuales `LA-024` y `LA-025` siguen pendientes;
  no bloquean conservar el checkpoint, pero sí cerrar funcionalmente esas tareas.
- Estado nuevo: checkpoint validado y autorizado para commit local.
- Siguiente paso exacto: crear el commit; después, activar `allowPush` y pedir la
  segunda confirmación antes de enviar la rama.

### 2026-08-11 12:10 — Codex — F4.8-T5-GATEWAY-GUARD

- Estado anterior: Studio mostraba una ruta preparada, pero el Gateway antiguo
  eliminaba el campo y cada trabajo creaba otro worktree.
- Evidencia: el log local muestra `LUX-8ZLC` a las 12:04 y la carpeta nueva
  correspondiente; el agente sólo reutiliza cuando recibe
  `resumeWorktreePath`.
- Resultado: Desktop comprueba que la respuesta del Gateway conserva
  exactamente la ruta solicitada. Si no, solicita cancelación y explica que hay
  que ejecutar `deploy-gateway.bat`.
- Archivos: `useStudio.ts` y prueba nueva de enlace de workspace.
- Pruebas: focalizadas 107/107; suite 1.594 pasadas, 9 omitidas; lint, typecheck
  y build correctos.
- Siguiente paso: desplegar Gateway, reconstruir y repetir `LA-024`.

### 2026-08-11 12:00 — Codex — UI-JOB-FOCUS

- Estado anterior: tras finalizar un trabajo, la ventana seguía dibujando los
  controles activos pero no aceptaba desplegables ni escritura.
- Causa observada en código: cada final/fallo crea un toast nativo de Electron
  incluso con la ventana enfocada; es el único efecto global del cierre y los
  avisos aparecen en las capturas del fallo. Confirmación manual pendiente.
- Archivos modificados: `apps/desktop/src/main/index.ts`, nueva política y su
  prueba, y documentación de continuidad.
- Resultado real: los toasts de trabajos se suprimen sólo cuando Luxy está
  visible y enfocado; siguen activos en segundo plano.
- Pruebas: focalizadas 34/34; suite 1.592 pasadas, 9 omitidas; lint, typecheck y
  build completos correctos.
- Riesgo: el bloqueo sólo puede darse por confirmado tras repetirlo en Electron
  sobre Windows.
- Siguiente paso exacto: `LA-025`.

### 2026-08-11 11:42 — Codex — F4.8-T5

- Estado anterior: cada tarea normal creaba otra carpeta; sólo un reintento de
  fallo podía recuperar su worktree.
- Objetivo: preparar la carpeta antes del prompt y reutilizarla en trabajos
  sucesivos.
- Causa demostrada: el contrato de creación no aceptaba un worktree elegido y
  Desktop no tenía una operación local para prepararlo.
- Archivos modificados: contratos shared/IPC, host y controlador del agente,
  handlers de Desktop y Gateway, Studio, estilos, pruebas y documentación.
- Resultado real: Studio prepara y abre una carpeta confinada, recuerda su
  selección ligada a máquina/proyecto, la transporta al trabajo y permite
  recuperar la ruta desde el historial. El agente reutiliza y protege el
  contenido existente.
- Pruebas: focalizadas 162/162; lint, typecheck, suite 1.590 pasadas y 9
  omitidas, y build completo correctos.
- Decisiones: sin migración; la ruta viaja en metadata existente. Conversaciones
  y Laboratorio no admiten worktrees preparados.
- Riesgos o límites: falta publicar Gateway y validación manual con proveedor;
  no se hizo deploy, commit ni push.
- Estado nuevo: implementado y verificado automáticamente.
- Siguiente paso exacto: ejecutar `LA-024`.

Registro cronológico y append-only. No reescribir una entrada anterior para que
parezca correcta; añadir una corrección nueva.

### 2026-08-20 — Codex — CONSOLIDATE-WORKTREES-001

- Estado anterior: fases terminadas y correcciones posteriores estaban repartidas entre varios worktrees, con riesgo de arrancar una rama antigua.
- Archivos y ramas integrados: `luxy/auto-init-git` y `luxy/phase-4d-session-host`.
- Resultado: commits de integración `82e728a` y `cbac4f2`; cada uno pasó `npm.cmd run check` (1.602 y 1.622 pruebas pasadas, respectivamente; 9 omitidas).
- Límites: quedan cambios sin commit en otros worktrees; se preservan y se integrarán por bloque. Los archivos personales y de claves no se versionan.
- Siguiente paso exacto: integrar los cambios pendientes de catálogo, timeout y compatibilidad sobre esta rama.

### 2026-08-20 — Codex — BUG-RATE-LIMIT-UX-001

- Archivos modificados: `http-provider.ts` y su prueba.
- Resultado: cada reintento HTTP 429 publica su espera en los eventos; el aviso final explica que se agotaron los intentos.
- Pruebas: `npm.cmd test -- --run apps/agent/src/providers/providers.test.ts`, 73 pasadas.
- Estado nuevo: commit local `ac38bcd`; sin llamadas reales, push, despliegue ni migraciones.

### 2026-08-20 — Codex — BUG-TIMEOUT-DEEPSEEK-001

- Archivos modificados: `http-provider.ts` y su prueba.
- Resultado: un límite de salida durante razonamiento sin texto visible se clasifica y explica sin revelar razonamiento ni reintentar inútilmente.
- Pruebas: `npm.cmd test -- --run apps/agent/src/providers/providers.test.ts`, 75 pasadas.
- Estado nuevo: commit local `0976308`; sin llamadas reales, push, despliegue ni migraciones.

### 2026-08-20 — Codex — BUG-HUNYUAN-002

- Estado anterior: el Studio reiniciado desde `luxy/ux-001-detalle-trabajo` rechazaba los trabajos históricos con `provider: hunyuan` y mostraba el error de Zod completo.
- Causa demostrada: la corrección previa quedó sin commit en el worktree `lux/bug-hunyuan-backcompat`; esta rama se creó desde una base anterior.
- Archivos modificados: contrato compartido, aliases y etiquetas de proveedores, protecciones de reintento/continuación y pruebas de esquema.
- Resultado: el historial se lee con identificadores seguros y las acciones de ejecución sólo aceptan proveedores reconocidos. Studio fue reconstruido y reiniciado desde esta rama.
- Validación automática: `npm.cmd run check` correcta, 1.582 pruebas pasadas y 9 omitidas; sin llamadas reales, push, despliegue ni migraciones.
- Corrección del reinicio: el primer lanzamiento directo apuntó por error a la raíz del monorepo y Electron mostró «Unable to find Electron app». Se cerró ese proceso y se abrió correctamente el paquete `apps/desktop`.
- Siguiente paso: completar la comprobación visual `LA-021`.

### 2026-08-20 — Codex — CATALOG-DETECTED-003

- Objetivo: integrar el bloque pendiente de catálogo sin confundir el proveedor histórico `hunyuan` con la familia de modelo `hy3`.
- Archivos modificados: catálogo y parser de `/v1/models` compartidos, tipos, vista de Configuración y pruebas de catálogo/registro.
- Resultado: `hy3` queda en la familia `other`; los modelos de texto nuevos detectados exponen sólo texto y streaming, sin herramientas, capacidades de agente ni contratos inventados. La lectura de trabajos con `provider: hunyuan` se conserva en el bloque de compatibilidad anterior.
- Pruebas: `catalog-fetch.test.ts` y `registry.test.ts`, 53 pasadas; `npm.cmd run typecheck`, exit 0.
- Límites: no hubo llamadas reales, push, despliegue ni migraciones. Quedan más cambios sin commit en otros worktrees por revisar.
- Siguiente paso exacto: crear el commit local y continuar con el siguiente bloque aislado.

### 2026-08-20 — Codex — COMMAND-POLICY-001

- Objetivo: usar una única política pura para validar los comandos de comprobación, tanto antes de guardarlos como justo antes de ejecutarlos.
- Archivos modificados: módulo compartido nuevo, exportación del paquete y adaptador compatible del agente.
- Resultado: la lista blanca y el rechazo de shell, evaluación, publicación y despliegue ya no pueden divergir entre consumidores.
- Pruebas: compilación de `@luxy/shared` y `apps/agent/src/agent.test.ts`, 76 pasadas.
- Siguiente paso exacto: commit local y continuar con el perfil de proyecto que consumirá esta política en Studio.

### 2026-08-20 — Codex — PROJECT-PROFILE-CORE-001

- Objetivo: integrar el contrato y el uso seguro del perfil local de proyecto sin esperar a la pantalla de edición.
- Archivos modificados: esquema compartido, prompt del agente y sus pruebas, cliente/repositorio/handler de Studio y pruebas de Gateway.
- Resultado: configuraciones antiguas siguen siendo válidas; nombre, descripción, stack e instrucciones se validan localmente. Sólo los trabajos editables reciben el contexto delimitado; conversaciones y evaluaciones siguen en sólo lectura. El historial acepta un filtro exacto por alias de proyecto antes de paginar.
- Pruebas: typecheck, compilación de Shared y 114 pruebas focalizadas de agente/Gateway correctas.
- Límites: falta integrar la interfaz de perfiles del worktree de origen. No hubo llamadas reales, push, despliegue ni migraciones.
- Siguiente paso exacto: commit local e integrar los controles de Studio sobre este contrato ya probado.

### 2026-08-20 — Codex — PROJECT-SCOPE-CORE-001

- Objetivo: impedir que una vista acotada mezcle trabajos de otro proyecto, incluso contra un Gateway anterior que ignore el filtro.
- Resultado: IPC, hooks y utilidades aceptan un alias validado; el cliente solicita el filtro y vuelve a filtrar localmente. La selección de máquina sólo acepta una que contenga el proyecto activo.
- Pruebas: typecheck, compilación de Shared y 36 pruebas de contexto/IPC correctas.
- Límite: la navegación y la barra visible permanecen pendientes; este commit no cambia todavía la pantalla que ve Daniel.

### 2026-08-20 — Codex — PROJECT-SCOPE-UI-001

- Resultado: cada proyecto abre Trabajos o Conversaciones acotados a su alias, bloquea el selector para no mezclarlo y permite volver explícitamente a la vista global.
- Defensa: si un Gateway anterior ignora el filtro, la interfaz elimina localmente lo ajeno y avisa de que el historial puede ser incompleto.
- Pruebas: typecheck, 362 pruebas de Desktop y build de Desktop correctos.
- Siguiente paso: integrar el editor ampliado del perfil de proyecto.

### 2026-08-10 — Codex — F4.8-T4

- Observación: el retry reanudaba la misma ruta y rama, pero el modelo recibía
  otra vez el prompt original y comenzaba anunciando la llamada 1; después el
  proveedor devolvía HTTP 503.
- Cambio: `buildProviderPrompt` añade instrucciones específicas de continuación
  cuando existe `resumeFromJobId` o `resumeWorktreePath`: inspeccionar el estado
  Git, conservar archivos y commits y continuar sólo con la parte incompleta.
- Archivos modificados: `apps/agent/src/job-runner.ts`,
  `apps/agent/src/agent.test.ts` y esta documentación de continuidad.
- Decisión: el reintento conserva un nuevo registro de auditoría, pero no se
  pretende conservar automáticamente el contexto interno del proveedor; el
  worktree y sus commits son la fuente de verdad.
- Riesgo abierto: HTTP 503 sigue siendo un fallo transitorio de MiniMax; esta
  mejora evita reiniciar el trabajo lógico, pero no puede reparar una caída del
  proveedor.
- Siguiente paso exacto: ejecutar las comprobaciones y reconstruir Desktop.

### 2026-08-10 — Codex — F4.8-T4b

- Observación: `LUX-H7SA` estaba cancelado con “Sin eventos todavía”; nunca
  había reclamado un worktree, por lo que no podía reanudarse.
- Cambio: Studio detecta la ausencia de `worktreePath` y crea un intento nuevo
  desde el proyecto base; los trabajos que sí tienen worktree conservan el
  flujo de reanudación.
- Verificación: lint, typecheck, Desktop 328/328 pruebas y build pasados.

### 2026-08-10 — Codex — F4.8-T4c

- Observación: Kimi devolvió “paso 2” y una pregunta aunque la tarea pedía
  completar la web en varias llamadas; Luxy lo clasificó como `completed` al no
  haber otra herramienta solicitada.
- Cambio: el prompt agentic exige continuar fases autónomas, no preguntar al
  usuario y responder sólo tras crear y comprobar todos los requisitos.
- Verificación: lint, typecheck, agente 76/76 pruebas y build de Desktop
  pasados.
- Riesgo: el modelo puede ignorar instrucciones; una validación semántica
  universal de “web completa” requiere criterios específicos por tarea.

### 2026-08-10 — Codex — F4.8-T4d

- Observación: Qwen devolvió HTTP 429 por límite de frecuencia.
- Cambio: las vueltas agentic reintentan ahora un 429 hasta tres intentos,
  respetando `Retry-After` y mostrando el tiempo de espera como evento; no se
  reintentan 401 ni errores con contenido parcial.
- Verificación: lint, typecheck, providers 72/72 y build de Desktop pasados.

### 2026-08-10 — Codex — F4.8-T1 — inicio

- Estado anterior: una carpeta sin repositorio Git hacía fallar el trabajo editable antes de crear el worktree.
- Objetivo: inicializar Git automáticamente cuando el proyecto permite edición y crear un baseline local seguro.
- Hipótesis: el bloqueo de la captura pertenece a la comprobación `isGitRepository`; el soporte existente sólo cubre repositorios Git sin `HEAD`.
- Archivos previstos: `apps/agent/src/git.ts`, `apps/agent/src/job-runner.ts`, pruebas del agente y documentación de seguridad/continuidad.
- Decisión: la inicialización será sólo para `allowEdits: true`, sin remoto, con `.gitignore` creado únicamente si falta y commit local `estado inicial`.
- Siguiente paso exacto: implementar y ejecutar la prueba focalizada.

### 2026-08-10 — Codex — F4.8-T1 — implementación

- Archivos modificados: `apps/agent/src/git.ts`, `apps/agent/src/job-runner.ts`, `apps/agent/src/agent.test.ts`, documentación de seguridad y continuidad.
- Resultado real: un proyecto editable sin Git crea `.gitignore` si falta, ejecuta `git init`, excluye secretos/dependencias/salidas y crea `estado inicial` con identidad local de Luxy; después continúa por `createWorktree`.
- Pruebas: `vitest run apps/agent/src/agent.test.ts` — **72/72 pasadas**; cubre `.env`, `node_modules`, archivos normales y mensaje del commit. `npm run lint` pasó. `typecheck` falló antes de compilar por falta de `@cloudflare/workers-types`; suite completa y build quedan pendientes.
- Decisiones: no se crea remoto; `.gitignore` existente nunca se sobrescribe; `allowEdits: false` sigue sin inicializar nada.
- Estado nuevo: implementado; verificación completa bloqueada por dependencia ambiental.
- Siguiente paso exacto: instalar/restaurar las dependencias autorizadas, reconstruir Desktop/agente y probar el flujo real en un proyecto no-Git.

### 2026-08-10 — Codex — F4.8-T2

- Estado anterior: **Reintentar trabajo** creaba otro trabajo y otro worktree, perdiendo el contexto de la página ya escrita.
- Cambio: Studio envía `resumeJobId`; Gateway valida propietario, máquina, proyecto, proveedor, modelo, prompt y estado terminal. El agente valida la ruta bajo `%LOCALAPPDATA%\Luxy\worktrees`, su pertenencia al repositorio base y la rama `luxy/...`, y reanuda el worktree.
- Archivos modificados: `packages/shared/src/schemas.ts`, `apps/gateway/src/handlers/studio.ts`, `apps/desktop/src/renderer/pages/Studio.tsx`, `apps/agent/src/git.ts`, `apps/agent/src/job-runner.ts`, `apps/agent/src/agent.test.ts`.
- Resultado real: implementado; el nuevo registro audita el intento, pero la ejecución continúa en la misma página/rama.
- Pruebas: nueva prueba de reanudación añadida; matriz completa pendiente por dependencia `@cloudflare/workers-types` ausente.
- Siguiente paso exacto: restaurar dependencias, ejecutar `npm run check` y validar manualmente el reintento de `LUX-L9CC`.

### 2026-08-10 — Codex — F4.8-T3

- Observación: el primer intento con auto-inicialización falló con `ENOENT` al escribir `C:\Users\daniel\Desktop\test\.gitignore`.
- Causa demostrada: la ruta configurada no existe en este portátil.
- Cambio: `ensureGitRepository` valida existencia y tipo de carpeta antes de escribir y devuelve un `GitError` accionable.
- Prueba añadida: ruta inexistente identificada como tal.
- Siguiente paso exacto: seleccionar la carpeta real del proyecto en Ajustes y reconstruir el agente con este cambio.

## Historial consolidado anterior al protocolo

### 2026-08-01 — ChatGPT Work — AUDIT-001

- Estado anterior: agente/gateway maduros; prioridad antigua centrada en
  Telegram y Remote.
- Objetivo: auditar el repositorio y reorientar el producto.
- Resultado real: se fijó Studio Windows como interfaz principal, Android como
  fase posterior, Telegram secundario y Remote pausado.
- Decisiones: coste 0 €, uso privado, sin iOS, sin push/deploy/migraciones sin
  autorización, Claude/Codex mediante CLI local.
- Evidencia: handoff técnico y auditoría del monorepo.
- Siguiente paso: primer vertical slice real de Studio.

### 2026-08-02 — ChatGPT Work — STUDIO-001

- Objetivo: máquina → proyecto → proveedor/modelo → trabajo → eventos →
  resultado/diff.
- Archivos: shared, gateway, agent, Desktop, documentación y migración `0005`
  preparada.
- Resultado real: parche `luxy-work-update-001.patch` aplicado en el worktree
  aislado `luxy-work-update-001`.
- Pruebas históricas: 1.260 pasaron y 14 se omitieron en Windows; build completo.
- Restricciones: `0004` Remote no era requisito de Studio; `0005` no debía
  aplicarse automáticamente.
- Siguiente paso: decisiones aplicar/descartar y Conversaciones.

### 2026-08-03 — ChatGPT Work — STUDIO-DECISIONS

- Objetivo: aplicar o descartar cambios de un trabajo desde Studio.
- Resultado real: decisiones persistentes mediante gateway/aprobaciones; aplicar
  crea commit en rama aislada y descartar limpia el worktree tras confirmación.
- Riesgos preservados: ninguna acción mezcla rama principal ni hace push.
- Siguiente paso: conversación persistente y comparación.

### 2026-08-03 — ChatGPT Work — CONVERSATIONS-001

- Objetivo: chat individual/A-B con streaming e historial.
- Resultado real: conversaciones sobre jobs/metadata, solo lectura, selección
  explícita de máquina/proyecto/proveedor/modelo y comparación de dos respuestas.
- Siguiente paso: memoria y aprendizaje local.

### 2026-08-03 — ChatGPT Work — MEMORY-001

- Objetivo: continuar conversaciones sin depender de memoria nativa de la API.
- Resultado real: bloque `LUXY_MEMORY`, parseo Zod, resumen/hechos/decisiones/
  plan/preguntas/lecciones, memorias relacionadas del mismo proyecto y feedback.
- Limitación conocida entonces: fallback desde el texto visible si el bloque no
  era válido.
- Siguiente paso: validar ejecución real con Kimi.

### 2026-08-04 — ChatGPT Work — CONVERSATIONS-FINALIZATION

- Problema observado: Kimi mostraba texto, pero el trabajo quedaba en
  `Respondiendo`.
- Iteraciones: lectura del último evento sin salto, señales terminales, cierre de
  socket, cancelación y recuperación de estados huérfanos.
- Causa final demostrada del bloqueo posterior al stream: el redactor trataba
  `inputTokens` y `outputTokens` como credenciales, los convertía en cadenas y
  la validación del outcome fallaba.
- Resultado real: respuestas normales pasan a `Guardado`, conservan duración,
  tokens y memoria; `Detener` funciona.
- Pruebas históricas: 91/91 para señales; 30/30 para outcome/tokens/memoria.
- Siguiente paso: feedback al primer clic.

### 2026-08-04 — ChatGPT Work — FEEDBACK-001

- Problema: el primer clic ya se persistía, pero la UI ignoraba el job devuelto
  por el gateway y una recarga podía ser absorbida por el polling.
- Resultado implementado: actualizar historial y detalle con la respuesta
  confirmada; bloquear botones mientras guarda.
- Pruebas históricas: 11/11 específicas, lint, tipos y build.
- Confirmación manual: pendiente de registrar en el worktree de Windows.

### 2026-08-04 — Daniel + ChatGPT Work — LONG-RESPONSE-OBSERVATION

- Estado anterior: conversación normal y memoria confirmadas por Daniel.
- Prueba manual: pedir una web completa a Kimi.
- Observado: unos 23 min 43 s, alrededor de 6.422 tokens de salida, HTML cortado
  a mitad y memoria de fallback llena de código.
- Diagnóstico: causa del corte no demostrada; límite de tokens y corte de
  conexión siguen siendo hipótesis competidoras.
- Incidencias: `LUXY-P0-001`, `LUXY-P0-002` y `LUXY-P0-003`.
- Siguiente paso: instrumentar finales de transporte y proteger memoria antes de
  tocar timeouts.

## Entradas bajo el nuevo protocolo

### 2026-08-04 — Codex Work — DOC-HANDOFF-001

- Estado anterior: contexto repartido entre handoff del 1 de agosto, parches,
  capturas y conversación.
- Objetivo: preparar continuidad completa para Claude y Codex en VS Code.
- Archivos leídos: `AGENTS.md`, `CLAUDE.md`, README, arquitectura, Desktop,
  schemas de memoria, SSE, proveedor HTTP, job runner, gateway, hooks de
  Conversaciones, migraciones y parches acumulados.
- Archivos modificados: sólo documentación raíz y referencias de documentación.
- Resultado real: fuente de verdad, plan maestro, tarea P0, decisiones,
  protocolo de relevo, acciones locales y resultados de prueba consolidados.
- Decisiones: no atribuir el corte largo a tokens sin evidencia; preservar
  memoria anterior; código largo como artefacto; cada paso queda documentado.
- Riesgos: el estado Git/migraciones exacto del worktree de Windows aún debe
  contrastarse allí.
- Comandos ejecutados: Prettier check, validación JSON/referencias,
  `npm run lint`, `npm run typecheck`, `npm test` y `npm run build`.
- Pruebas: formato, JSON, referencias, lint, tipos y build pasaron. La suite
  reprodujo 1.294 verdes, 9 omitidas, 9 fallos ambientales y dos suites
  Electron sin cargar; detalle en `TEST-RESULTS.md`.
- Estado nuevo: documentación creada y validada dentro de las limitaciones de la
  copia Linux; la suite global no se declara verde.
- Siguiente paso exacto: empaquetar el relevo y, en Windows, ejecutar `LA-002`
  antes de iniciar `P0.0`.

### 2026-08-05 08:38 — Claude Code — P0.0

- Estado anterior: `P0.0` pendiente; el estado Git y de migraciones del worktree
  de Windows sólo estaba supuesto desde la copia Linux.
- Objetivo: verificar el checkpoint real sin limpiar ni modificar código.
- Hipótesis o causa demostrada: no aplica; paso de verificación.
- Archivos leídos: `AGENTS.md`, `CLAUDE.md`, `PROJECT-STATE.md`,
  `CURRENT-TASK.md`, `MASTER-PLAN.md`, `DECISIONS.md`, `CHANGELOG-WORK.md`,
  `TEST-RESULTS.md`, `LOCAL-ACTIONS.md`, `AI-WORK-PROTOCOL.md`,
  `apps/agent/src/providers/sse.ts`, `apps/agent/src/providers/http-provider.ts`,
  `apps/agent/src/job-runner.ts`, `packages/shared/src/schemas.ts`,
  `apps/agent/src/conversation-job.test.ts`.
- Archivos modificados: sólo documentación (`CURRENT-TASK.md`,
  `CHANGELOG-WORK.md`, `TEST-RESULTS.md`, `PROJECT-STATE.md`).
- Comandos ejecutados: `git status --short --branch`, `git diff --stat`,
  `git log --oneline -3`, listado de `supabase/migrations`,
  `git apply --reverse --check` de los tres parches finales,
  vitest sobre las ocho suites de Conversaciones y `npm test`.
- Resultado real:
  - rama `luxy/work-update-001-studio`, HEAD `61fb7ee`, 29 archivos modificados
    y 22 sin seguimiento; 1.603 inserciones y 88 borrados sin confirmar;
  - migraciones presentes: `0001` a `0006`, con
    `0006_luxy_service_role_grants.sql` (384 B) sin seguimiento. Ninguna tocada;
  - los tres parches finales (`signal-finalization`,
    `outcome-token-finalization-fix`, `feedback-single-click-fix`) están
    **presentes**: `git apply --reverse --check` sale con código 0;
  - el fallback de memoria por 1.200 caracteres sigue vivo en
    `packages/shared/src/schemas.ts:200-211` y se usa en tres ramas de
    `parseConversationMemoryResponse`; `LUXY-P0-002` se confirma en código;
  - `apps/agent/src/providers/http-provider.ts` no emite hoy ninguna telemetría
    de final de transporte: `finishReason`, motivo de aborto y `finalUsageReceived`
    se descartan al convertir el turno en `LoopTurnResult`/`readStream`.
- Pruebas: suites de Conversaciones 57/57 passed. `npm test` completo en
  Windows: 68 archivos, 1.316 passed, 9 skipped, exit 0.
- Decisiones: ninguna nueva. Se mantiene `D-014`: no se toca `0005` ni `0006`.
- Riesgos o límites: los 9 fallos ambientales registrados el 2026-08-04 eran de
  la copia Linux; en Windows no aparecen. La línea base de esta máquina es
  verde, así que cualquier fallo posterior aquí es una regresión, no ambiente.
- Estado nuevo: `P0.0` done. Discrepancia 0005/0006 registrada: los archivos
  existen, no hay evidencia de que se hayan aplicado contra Postgres.
- Siguiente paso exacto: `P0.1`, telemetría segura del final de la respuesta en
  `apps/agent/src/providers/sse.ts` y `http-provider.ts`.

### 2026-08-05 08:51 — Claude Code — P0.1

- Estado anterior: `P0.0` done. El transporte sabía `finishReason` y
  `finalUsageReceived`, pero los descartaba: nadie observaba quién abortó ni
  cómo se cerró el cuerpo.
- Objetivo: dejar evidencia suficiente para explicar por qué termina una
  respuesta, sin guardar su contenido.
- Hipótesis o causa demostrada: ninguna causa nueva atribuida a `LUXY-P0-001`.
  Este paso construye la evidencia que falta, no la interpreta.
- Archivos leídos: `sse.ts`, `http-provider.ts`, `job-runner.ts`, `agent.ts`,
  `event-queue.ts`, `repository.ts`, `types.ts`, `constants.ts`, `schemas.ts`.
- Archivos modificados:
  - `packages/shared/src/constants.ts`: `STREAM_TRANSPORT_ENDS` y
    `RESPONSE_ABORT_SOURCES`.
  - `packages/shared/src/schemas.ts`: `responseTerminationSchema` y
    `formatResponseTermination`.
  - `packages/shared/src/types.ts`: tipos derivados y
    `ProviderRunResult.termination`.
  - `apps/agent/src/providers/sse.ts`: `onTransportEnd` con última señal,
    bytes, chunks y duración; `read_error` se marca antes de propagar.
  - `apps/agent/src/providers/http-provider.ts`: diagnóstico por petición,
    origen del aborto (`user`, `request_timeout`, `local_finalization`) y
    `no_stream`; el diagnóstico se cierra en `finally`, así que sobrevive a un
    flujo que revienta.
  - `apps/agent/src/job-runner.ts` y `agent.ts`: evento `log` con
    `metadata.responseTermination`; `deps.emit` acepta metadata.
  - Pruebas: `sse.test.ts`, `providers.test.ts`, `conversation-job.test.ts` y
    `packages/shared/src/response-termination.test.ts` (nuevo).
- Comandos ejecutados: `npx vitest run` por suite, `npm run lint`,
  `npm run typecheck`, `npm test`, `npm run build`.
- Resultado real: **verificado**. Suite completa 69 archivos, 1.334 passed,
  9 skipped, exit 0 (antes 68/1.316). Lint sin incidencias, typecheck y build
  correctos.
- Pruebas: 4 casos nuevos de señal de transporte en `sse.test.ts` (36/36),
  6 de diagnóstico en `providers.test.ts` (60/60), 1 en `conversation-job.test.ts`
  (3/3) y 7 en `response-termination.test.ts`.
- Decisiones: el diagnóstico viaja en `ProviderRunResult` y en la metadata del
  evento, no en una tabla nueva ni en el enum de estados. `D-014` intacta: cero
  migraciones.
- Riesgos o límites:
  - el camino agentic (`callTurn`) todavía no rellena `termination`; las
    conversaciones no lo usan, pero queda pendiente;
  - **hallazgo**: un `read_error` con texto parcial se reintenta entero, porque
    `shouldRetry` acepta los errores sin `status`. Observado en la prueba nueva:
    el intento siguiente vuelve a empezar en vez de recuperar. Es material para
    `P0.2`, no se ha cambiado aquí;
  - la telemetría no demuestra todavía qué pasó el 2026-08-04: hará falta la
    prueba manual `LA-006` cuando estén `P0.2`–`P0.4`.
- Estado nuevo: `P0.1` done; `P0.2` pendiente con el hallazgo del reintento
  anotado en `CURRENT-TASK.md`.
- Siguiente paso exacto: `P0.2`, decidir el reintento de un corte con contenido
  parcial en `http-provider.ts` y llevar los estados explícitos al `JobOutcome`
  de `job-runner.ts`.

### 2026-08-05 09:49 — Claude Code — P0.2

- Estado anterior: `P0.1` done. El transporte ya explicaba el final, pero seguía
  habiendo sólo dos resultados posibles, y un corte con texto parcial se
  reintentaba entero y acababa como fallo sin contenido.
- Objetivo: seis finales explícitos, conservar lo generado y dejar de repetir
  ciegamente una generación cortada.
- Hipótesis o causa demostrada: **reproducido**. La prueba nueva de
  `providers.test.ts` cuenta los intentos: antes tres, ahora uno cuando ya había
  texto. La otra rama sigue reintentando tres veces cuando no llegó nada.
- Archivos leídos: `http-provider.ts`, `job-runner.ts`, `api.ts`,
  `conversation.ts` del renderer, `schemas.ts`, `final-outcome.test.ts`.
- Archivos modificados:
  - `packages/shared/src/constants.ts`: `RESPONSE_OUTCOMES` y
    `RECOVERABLE_RESPONSE_OUTCOMES`.
  - `packages/shared/src/response-outcome.ts` (nuevo): `classifyResponseOutcome`,
    `isRecoverableOutcome`, etiquetas y explicaciones. Lógica pura.
  - `packages/shared/src/schemas.ts`: `responseOutcomeSchema`, y
    `responseOutcome`/`responseTermination` en `jobCompleteRequestSchema`.
  - `packages/shared/src/types.ts`, `index.ts`: tipos y export.
  - `apps/agent/src/providers/http-provider.ts`: `shouldRetry` no repite con
    texto delante; el texto parcial viaja en `finalText` aunque `ok` sea false;
    un timeout marca `timedOut`.
  - `apps/agent/src/job-runner.ts`: clasificación, conservación de la salida
    parcial, aviso con el motivo real y bloqueo de la memoria cuando el final no
    es `completed`.
  - `apps/gateway/src/handlers/api.ts`: persiste ambos campos en la metadata.
  - Pruebas: `response-outcome.test.ts` (nuevo), `providers.test.ts`,
    `conversation-job.test.ts`, `final-outcome.test.ts`.
- Comandos ejecutados: vitest por suite, `npm run lint`, `npm run typecheck`,
  `npm test`, `npm run build`.
- Resultado real: **verificado**. Suite completa 70 archivos, 1.356 passed,
  9 skipped, exit 0 (antes 69/1.334). Lint, tipos y build correctos.
- Pruebas: 15 casos de clasificación cubriendo los seis finales y la ausencia de
  diagnóstico; 3 nuevos de reintento y conservación en `providers.test.ts`;
  2 en `conversation-job.test.ts`; 2 en `final-outcome.test.ts`.
- Decisiones: `D-016` (un corte con contenido no se reintenta) y `D-017` (el
  final detallado viaja en metadata, el enum de Postgres no se toca). Ninguna
  migración.
- Riesgos o límites:
  - una cancelación manual todavía no conserva el texto parcial: el camino
    `cancelled` del gateway no guarda resultado. Queda para `P0.5`;
  - el camino agentic sigue sin `termination` y cae en la rama sin diagnóstico,
    que no inventa motivos;
  - `status: completed` deja de significar «respuesta entera». Toda pantalla
    debe leer `responseOutcome`; Studio aún no lo muestra, eso es `P0.5`.
- Estado nuevo: `P0.2` done. `P0.3` adelantado en parte: una respuesta que no
  termina bien ya no escribe memoria.
- Siguiente paso exacto: `P0.3`, sustituir
  `compactConversationMemoryFallback` (`packages/shared/src/schemas.ts:200`) por
  un estado explícito y añadir los detectores de código.

### 2026-08-05 10:53 — Claude Code — P0.2b y P0.3

- Estado anterior: `P0.2` done. Daniel repitió la prueba manual con Kimi K2.6 y
  aportó capturas de Studio y del panel del proveedor.
- Objetivo: explicar el corte con datos reales y arreglar las dos cosas que
  observó: la web cortada por la mitad y la memoria llena de código.
- Evidencia aportada por Daniel (**observado**): Kimi-K2.6, 753 tokens de
  entrada y **3.180 de salida**, primer token 8,5 s, duración 3 min 53 s en el
  proveedor y 237 s en Studio, 14 t/s. Respuesta cortada a mitad de HTML,
  marcada `Guardado`, y memoria mostrando el HTML como resumen.
- Hipótesis descartada con el código: **no fue el tope de tokens**. El tope
  efectivo para Kimi es 8.192 (`maxOutputTokens` por defecto del catálogo, la
  entrada `kimi-k2.6` no lo sube) y la respuesta paró en 3.180.
- Causa **reproducida**: `terminalDeadline` se armaba al ver una señal terminal
  y no se desarmaba nunca. Bastaba un `usage` sin `choices` a mitad de la
  respuesta para que Luxy cerrase el transporte un segundo después, aunque el
  modelo siguiera escribiendo. La prueba nueva de `sse.test.ts` falla contra el
  código anterior quedándose con `<html>` y descartando el resto.
- Archivos leídos: `sse.ts`, `http-provider.ts`, `agent.ts`, `catalog.ts`,
  `models/types.ts`, `conversation.ts` del renderer, y sólo los campos de
  límites de `%APPDATA%\Luxy\config.json` (ningún secreto).
- Archivos modificados:
  - `packages/shared/src/constants.ts`: `TERMINAL_GRACE_MS`,
    `SOFT_TERMINAL_GRACE_MS` y `CONVERSATION_MEMORY_STATUSES`.
  - `apps/agent/src/providers/sse.ts`: señales fuertes y débiles; el margen se
    cuenta desde el último evento y se desarma si deja de haber señal.
  - `apps/agent/src/providers/http-provider.ts`: `finish_reason` y memoria
    completa son fuertes; `usage` sin `choices` es débil con 15 s de silencio.
  - `packages/shared/src/schemas.ts`: `softTerminalGraceMs` en la configuración
    del proveedor; parser de memoria sin fallback, con estado explícito y
    `looksLikeCode`; `conversationMemoryStatus` en el resultado.
  - `packages/shared/src/types.ts`, `apps/agent/src/job-runner.ts`,
    `apps/gateway/src/handlers/api.ts`.
  - Pruebas: `sse.test.ts`, `providers.test.ts`, `conversation-memory.test.ts`
    (reescrita con la web real de la captura), `conversation-job.test.ts`.
- Comandos ejecutados: vitest por suite, `npm run lint`, `npm run typecheck`,
  `npm test`, `npm run build`.
- Resultado real: **verificado**. Suite completa 70 archivos, 1.366 passed,
  9 skipped, exit 0 (antes 1.356). Lint, tipos y build correctos.
- Pruebas: 3 nuevas de corte con datos en vuelo en `sse.test.ts`; 1 del margen
  por defecto en `providers.test.ts`; `conversation-memory.test.ts` pasa de 3 a
  9 casos, incluidos la web entera y el bloque válido con código dentro.
- Decisiones: `D-018` (señales fuertes y débiles; sustituye la parte de `D-011`
  que las igualaba) y `D-019` (la memoria no tiene fallback; cumple la
  corrección pendiente de `D-009`).
- Riesgos o límites:
  - **no está demostrado** que el corte de Daniel fuese exactamente este
    mecanismo: no había telemetría cuando ocurrió. Es la única causa
    reproducida, y la repetición con el build nuevo lo confirmará o no;
  - aunque el corte esté arreglado, **8.192 tokens de salida no dan para una
    página de 1.000–2.000 líneas**. Hace falta confirmar el tope real de
    Kimi K2.6 antes de subirlo: `LA-007`;
  - Studio todavía no dice que la memoria se conservó; sólo deja de
    contaminarla. Eso es `P0.5`.
- Estado nuevo: `P0.2b` y `P0.3` done.
- Siguiente paso exacto: `LA-006` y `LA-007` por parte de Daniel, y `P0.4` para
  cerrar la matriz de regresión (falta el caso 10, cancelación de punta a
  punta).

### 2026-08-05 11:15 — Claude Code — P0.3b

- Estado anterior: `P0.2b` y `P0.3` cerrados. Daniel repitió la prueba con el
  build nuevo y la web **seguía saliendo cortada**, esta vez sin panel de
  memoria.
- Objetivo: usar la telemetría de `P0.1` para decidir la causa con datos, en vez
  de seguir acumulando hipótesis.
- Método: consulta de sólo lectura a la base del proyecto con las credenciales
  locales del gateway, pidiendo únicamente metadata y longitudes. No se volcó ni
  se guardó contenido de las respuestas.
- **Causa demostrada** (no hipótesis):

  | Trabajo    | tokens salida | caracteres recibidos | guardado | transporte    | finish_reason | aborto  |
  | ---------- | ------------- | -------------------- | -------- | ------------- | ------------- | ------- |
  | `LUX-YJT9` | 3.180         | 7.716                | 4.000    | `done_marker` | `stop`        | ninguno |
  | `LUX-8B8T` | 2.720         | 7.691                | 4.000    | `done_marker` | `stop`        | ninguno |

  La llamada terminaba bien y la respuesta llegaba entera. El corte era nuestro,
  al guardar: `summary` estaba limitado a 4.000 caracteres para todo tipo de
  trabajo. Los últimos caracteres guardados (`<input ty`) coinciden exactamente
  con el punto donde se corta la captura de Daniel.

- **Corrección de una conclusión anterior:** en la entrada de `P0.2b` atribuí el
  corte al cierre local por señal débil. Ese fallo era real y está reproducido,
  pero `abortedBy: null` y `done_marker` demuestran que **no** fue lo que le
  pasó a Daniel. El arreglo se mantiene como endurecimiento; la explicación era
  incompleta y queda corregida aquí.
- Segundo hallazgo: `conversationMemoryStatus: invalid` en `LUX-8B8T` demuestra
  que el modelo **sí** devolvía su memoria. El bloque se descartaba entero por
  pasarse de los límites del esquema, y por eso desapareció el panel.
- Archivos modificados:
  - `packages/shared/src/constants.ts`: `MAX_TASK_RESULT_CHARS`,
    `MAX_CONVERSATION_RESULT_CHARS` y `MAX_TELEGRAM_SUMMARY_CHARS`.
  - `packages/shared/src/schemas.ts`: tope del resultado y `summaryTruncated`;
    `normalizeConversationMemory` recorta a los límites en vez de rechazar.
  - `apps/agent/src/job-runner.ts`: tope según el tipo de trabajo y aviso
    explícito si aun así no cabe.
  - `apps/gateway/src/handlers/api.ts`: la tarjeta de Telegram se recorta al
    renderizar, no al guardar.
  - Pruebas: `conversation-job.test.ts`, `conversation-memory.test.ts`,
    `final-outcome.test.ts`.
- Comandos ejecutados: vitest por suite, `npm run lint`, `npm run typecheck`,
  `npm test`, `npm run build`.
- Resultado real: **verificado**. Suite completa 70 archivos, 1.370 passed,
  9 skipped, exit 0 (antes 1.366). Lint, tipos y build correctos.
- Decisiones: `D-020` (el resumen de una conversación es la respuesta; nunca se
  pierde contenido en silencio) y corrección del alcance de `D-018`.
- Riesgos o límites:
  - los trabajos ya guardados **siguen truncados**: el contenido perdido no se
    puede recuperar, sólo dejará de ocurrir;
  - 7,7 K caracteres es lo que produjo el modelo, no lo que cabe. Con
    `max_tokens` en 8.192 el techo son unas 700 líneas de HTML: para 1.000–2.000
    sigue haciendo falta `LA-007`;
  - una conversación puede ahora guardar hasta 120 K caracteres y el listado de
    Studio los devuelve; si el historial crece mucho habrá que paginar o mover
    la respuesta al detalle. Anotado en `F2.3`.
- Estado nuevo: `P0.3b` done.
- Siguiente paso exacto: Daniel repite la prueba (`LA-006`) y confirma el tope
  de salida (`LA-007`); después `P0.4`.

### 2026-08-05 16:36 — Claude Code — P0.3c

- Estado anterior: `P0.3b` cerrado. Daniel probó con KAT Coder Pro v2.5 y recibió
  dos errores del proveedor mostrados como JSON crudo, en chino, precedidos de
  «fallo tras 3 intentos».
- Objetivo: que un fallo del proveedor se explique bien y no se le atribuya a
  Luxy. Los errores en sí son del proveedor y no se pueden arreglar desde aquí.
- Evidencia de producción (sólo lectura, sin volcar contenido):

  | Trabajo    | final       | finish_reason | tokens salida | caracteres | guardado | memoria           |
  | ---------- | ----------- | ------------- | ------------- | ---------- | -------- | ----------------- |
  | `LUX-3966` | `truncated` | `length`      | **8.192**     | 22.574     | 22.025   | `truncated_block` |
  | `LUX-Y4W5` | `completed` | `stop`        | 633           | 1.537      | 955      | `structured`      |
  | `LUX-LYTT` | `completed` | `stop`        | 600           | 1.098      | 805      | `structured`      |

  Los arreglos anteriores funcionan en real: 22.025 caracteres guardados donde
  antes cabían 4.000, `truncated` detectado por `finish_reason: length` y
  memoria `structured` en los turnos normales.

- Fallos de Luxy encontrados y corregidos:
  1. `RetryError` decía siempre «tras N intentos» usando el máximo configurado.
     Un 400 rechazado a la primera se anunciaba como «tras 3 intentos». Ahora
     cuenta los intentos reales y usa singular cuando toca.
  2. El envoltorio del reintento perdía el `status`, así que `describeHttpError`
     caía en la rama genérica y volcaba el cuerpo crudo de la respuesta. Ahora
     `RetryError` conserva el código y el describidor mira también dentro.
  3. Un 429 se reintentaba con backoff ciego ignorando `Retry-After`. Ahora se
     obedece la espera pedida, con tope de 60 s.
  4. Mensaje propio para el límite de plan (`UnaccessibleUser`,
     `not allowed to access`, `plan limited`): dice que no es un fallo de Luxy,
     que reintentar no ayuda y que se elija otro modelo. No se cambia de modelo
     solo (`D-004`).
- Archivos modificados: `packages/shared/src/backoff.ts`,
  `apps/agent/src/providers/http-provider.ts`, y sus pruebas en
  `format-budget.test.ts` y `providers.test.ts`.
- Comandos ejecutados: vitest por suite, `npm run lint`, `npm run typecheck`,
  `npm test`, `npm run build`.
- Resultado real: **verificado**. Suite completa 70 archivos, 1.379 passed,
  9 skipped, exit 0 (antes 1.370). Lint, tipos y build correctos.
- Riesgos o límites:
  - los 429 y los límites de plan **siguen ocurriendo**: son del proveedor.
    Luxy sólo los explica bien y espera lo que le piden;
  - `LUX-3966` demuestra que 8.192 tokens **sí** es un techo real alcanzable:
    22.574 caracteres, unas 700 líneas. `LA-007` deja de ser hipotético.
- Estado nuevo: `P0.3c` done.
- Siguiente paso exacto: `LA-007` (tope real por modelo) y `P0.4`.

### 2026-08-05 22:05 — Claude Code — MIGRACION-PC

- Estado anterior: el trabajo de `P0.0`–`P0.3c` vivía sólo en el worktree del
  ordenador `N-2278`, sin commitear. Esta copia estaba en `feat/luxy-desktop`
  con documentación del 2026-08-04, sin nada de Conversaciones.
- Objetivo: dejar este ordenador con el árbol idéntico al del worktree antiguo,
  porque `N-2278` ya no se va a usar.
- Hipótesis o causa demostrada: no aplica, es una migración.
- Archivos leídos: worktree remoto por UNC y sus metadatos de git.
- Archivos modificados: 60 archivos del árbol de trabajo, aplicados desde
  `luxy-work-update-001-COMPLETO.patch`. Previamente se respaldaron los
  documentos desactualizados de esta copia en
  `Desktop\luxy-recuperado\docs-de-esta-copia-2026-08-05\`.
- Comandos ejecutados: `git worktree prune -v`, `git checkout
luxy/work-update-001-studio`, `git apply --whitespace=nowarn`, `npm run build`,
  `npm test`, `npm run lint`, `npm run typecheck`, `npx prettier --check .`.
- Resultado real: parche aplicado limpio. `git worktree prune` eliminó dos
  registros que apuntaban a rutas de la máquina antigua y bloqueaban el
  `checkout`; no tocó ningún commit. `stash@{0}` sigue intacto.
- Pruebas: **1.379 pasadas, 9 omitidas, 0 fallos** en 70/70 archivos.
  `lint`, `typecheck` y `prettier --check` limpios. Detalle en
  `TEST-RESULTS.md`.
  Aviso útil para la próxima IA: la primera ejecución dio **25 fallos** con
  `Cannot read properties of undefined (reading 'safeParse')`. No era el parche:
  `packages/shared/dist` era de un build anterior y no tenía los esquemas
  nuevos. **Tras un cambio de rama o un parche grande hay que ejecutar
  `npm run build` antes que `npm test`.**
- Decisiones: no commitear todavía; `D-005` exige confirmación explícita. No
  copiar `config.json` por contener el token de máquina.
- Riesgos o límites: las 7.997 líneas siguen sin commit. El respaldo son las dos
  copias de `Desktop\luxy-recuperado\`, no git. Ver `D-016`.
- Estado nuevo: migración `completada` (`LA-008`). `LUXY-P0-LONG-RESPONSES`
  vuelve a estar `en curso`, ya no bloqueada.
- Siguiente paso exacto: `P0.4`, y `LA-007` (confirmar el tope real de salida por
  modelo). Antes, Daniel decide si se commitea lo recuperado en esta rama
  aislada.

### 2026-08-05 22:22 — Claude Code — P0.4

- Estado anterior: `P0.4` `pending`. Doce de los trece casos ya tenían prueba,
  repartidos entre cuatro archivos; faltaba el caso 10 y una lectura unificada.
- Objetivo: dejar la matriz de regresión completa, determinista y legible como
  tabla, sin red ni tokens.
- Hipótesis o causa demostrada: no aplica, es cobertura.
- Archivos leídos: `apps/agent/src/providers/sse.ts`,
  `apps/agent/src/providers/sse.test.ts`, `apps/agent/src/job-runner.ts`,
  `apps/agent/src/conversation-job.test.ts`,
  `packages/shared/src/response-outcome.ts`,
  `packages/shared/src/schemas.ts`, `packages/shared/src/constants.ts`.
- Archivos modificados: `apps/agent/src/response-matrix.test.ts` (nuevo, 19
  pruebas), `CURRENT-TASK.md`, `TEST-RESULTS.md` y este registro. **Ningún
  archivo de producción tocado**: la matriz no necesitó cambiar código, que es
  la señal de que `P0.1`–`P0.3c` dejaron el comportamiento donde debía.
- Comandos ejecutados: `npx vitest run apps/agent/src/response-matrix.test.ts`,
  `npx prettier --write`, `npm run lint`, `npm run typecheck`, `npm test`.
- Resultado real: los trece casos cubiertos. 1–9 como tabla `CASOS_TRANSPORTE`
  que pasa cuerpos reales por `sseData` y `TurnAssembler`; 10 de punta a punta
  con `runJob` y un `AbortController` que aborta durante el streaming; 11–13
  sobre `parseConversationMemoryResponse` y `looksLikeCode`. Las terminaciones
  no se escriben a mano a propósito: inventarlas convertiría la prueba en una
  comprobación de que el clasificador es coherente consigo mismo.
- Pruebas: **1.398 pasadas, 9 omitidas, 0 fallos** en 71 archivos. `lint`,
  `typecheck` y `prettier` limpios. Un único fallo durante el desarrollo:
  el estado válido de la memoria se llama `structured`, no `valid`.
- Decisiones: la matriz vive en `apps/agent`, no en `packages/shared`, porque
  el caso 10 necesita `runJob` y `packages/shared` no puede importar `node:*`.
- Riesgos o límites: el caso 10 usa un proveedor simulado. Que Studio pinte bien
  el estado cancelado es `P0.5` y sigue sin comprobarse a mano. `LA-006` y
  `LA-007` siguen pendientes de Daniel y ahora exigen `npm run setup:machine`.
- Estado nuevo: `P0.4` `done`. `LUXY-P0-LONG-RESPONSES` en curso, siguiente paso
  `P0.5`.
- Siguiente paso exacto: `P0.5`, interfaz de recuperación. Los datos ya existen
  (`RESPONSE_OUTCOME_LABELS`, `describeResponseOutcome`, `isRecoverableOutcome`);
  falta llevarlos a Studio y añadir **Continuar generación** sólo para los
  finales recuperables.

### 2026-08-05 23:40 — Claude Code — P0.5

- Estado anterior: `P0.5` `pending`. Todo el diagnóstico existía y viajaba en la
  metadata desde `P0.3c`, pero Studio no lo leía: pintaba `STATUS[status]`, y
  como una respuesta truncada se guarda con `status: completed`, la interfaz
  decía **«Guardado»** encima de una respuesta cortada por la mitad.
- Objetivo: que Daniel entienda qué pasó de verdad y pueda recuperar el trabajo
  sin pulsar Detener para forzar el final.
- Hipótesis o causa demostrada: causa demostrada. El fallo no era del transporte
  sino de la lectura: `status` y `responseOutcome` responden a preguntas
  distintas y la interfaz usaba el primero para contestar la segunda.
- Archivos leídos: `packages/shared/src/response-outcome.ts`,
  `packages/shared/src/constants.ts`, `packages/shared/src/schemas.ts`,
  `apps/desktop/src/renderer/conversation.ts`,
  `apps/desktop/src/renderer/pages/Conversations.tsx`,
  `apps/desktop/src/renderer/ui/primitives.tsx`.
- Archivos modificados: `packages/shared/src/schemas.ts`
  (`describeConversationMemoryStatus`), `apps/desktop/src/renderer/conversation.ts`
  (`conversationOutcomeView`, `conversationTerminationOf`,
  `conversationMemoryStatusOf`, `continuationMessageFor`),
  `apps/desktop/src/renderer/pages/Conversations.tsx`,
  `apps/desktop/src/renderer/conversation.test.ts` (10 pruebas nuevas), más
  `CURRENT-TASK.md`, `TEST-RESULTS.md`, `MASTER-PLAN.md`, `PROJECT-STATE.md` y
  este registro.
- Comandos ejecutados: `npm run build`,
  `npx vitest run apps/desktop/src/renderer/conversation.test.ts`,
  `npx prettier --write`, `npm run lint`, `npm run typecheck`, `npm test`.
- Resultado real: la tarjeta de respuesta muestra la etiqueta del final real,
  el aviso de qué hacer cuando no es `completed`, tokens y duración aunque la
  salida sea parcial, el texto parcial **también** cuando hay error, una frase
  por cada estado de memoria y el botón **Continuar generación** cuando procede.
- Pruebas: **1.408 pasadas, 9 omitidas, 0 fallos** en 71 archivos (antes 1.398).
  `lint`, `typecheck`, `build` y `prettier` limpios. Tres fallos durante el
  desarrollo, todos míos y todos por inventar valores en vez de leer el enum:
  faltaba el quinto estado de memoria (`rejected_code`) en el `switch`, la
  terminación de prueba llevaba un campo inexistente y le faltaba
  `finalUsageReceived`, y `'stream_end'` no es miembro de
  `STREAM_TRANSPORT_ENDS` (es `local_end`).
- Decisiones: (a) el botón usa `isRecoverableOutcome`, así que cubre también
  `timed_out` y no sólo los dos finales que nombra el apartado; una sola fuente
  de verdad, coherente con `describeResponseOutcome`. `cancelled` sigue fuera.
  (b) El botón **sólo rellena el compositor**, con el modelo original y un
  mensaje que nombra el motivo del corte; unir los fragmentos es `P0.6` y aquí
  no se concatena nada a ciegas. (c) El texto parcial se muestra siempre que
  exista, aunque haya `errorMessage`: no se esconden veintitrés minutos de
  generación detrás de un aviso rojo.
- Riesgos o límites: nada de esto se ha visto en pantalla todavía. Studio no
  arranca en este ordenador porque falta la configuración de máquina y cuatro
  secretos (`LA-010`), así que la comprobación es por pruebas, no visual. Sigue
  sin resolverse que una cancelación manual no guarde el texto parcial: la
  interfaz ya sabría pintarlo, pero el gateway no lo envía.
- Estado nuevo: `P0.5` `done`. `LUXY-P0-LONG-RESPONSES` en curso, siguiente paso
  `P0.6`.
- Siguiente paso exacto: `P0.6`. Definir primero dónde vive un artefacto largo y
  con qué límites, luego la unión con detección de solapamiento en
  `packages/shared`, pasando el parcial como dato no confiable.

### 2026-08-06 08:20 — Claude Code — P0.6a

- Estado anterior: `P0.6` `pending`. Studio ya sabía **pedir** la continuación
  (`P0.5`), pero nadie unía los fragmentos: el botón sólo rellenaba el
  compositor.
- Discrepancia encontrada al abrir, registrada antes de tocar nada: la
  documentación describe el trabajo como «sin commitear» sobre
  `luxy/work-update-001-studio` en `C:\Users\Daniel\Desktop\proyecto github\Luxy`
  (`LA-008`). El worktree real es `C:\Users\daniel\Desktop\Luxy`, rama
  `feat/luxy-desktop`, **árbol limpio**, y `P0.0`–`P0.5` ya están commiteados
  (`9012eda`, `16c6e9a`, `845c3cb`, `c6e5094`). El riesgo de las 7.997 líneas sin
  commit de `LA-008` **ya no existe**. No se limpió ni se movió nada.
- Objetivo: unir una respuesta cortada con su continuación sin duplicar texto y
  sin descartar nada sin evidencia.
- Hipótesis o causa demostrada: no aplica, es una capacidad nueva.
- Archivos leídos: `packages/shared/src/response-outcome.ts`,
  `packages/shared/src/constants.ts`, `packages/shared/src/index.ts`,
  `apps/desktop/src/renderer/conversation.ts`,
  `apps/desktop/src/renderer/pages/Conversations.tsx`,
  `apps/desktop/src/renderer/useConversations.ts`.
- Archivos modificados: `packages/shared/src/continuation.ts` (nuevo),
  `packages/shared/src/continuation.test.ts` (nuevo, 18 pruebas),
  `packages/shared/src/constants.ts` (cinco constantes nuevas),
  `packages/shared/src/index.ts`, `CURRENT-TASK.md`.
- Comandos ejecutados: `npm run build`, `npm test` (línea base),
  `npx vitest run packages/shared/src/continuation.test.ts`,
  `npx prettier --write`, `npm run lint`, `npm run typecheck`, `npm test`.
- Resultado real: `joinContinuation` decide dónde empieza lo nuevo con cinco
  estrategias —`overlap`, `resynced`, `restart`, `duplicate`, `appended`— y
  siempre dice cuál usó. `continuationTail` acota el final que se le enseña al
  modelo. Línea base antes de tocar nada: **1.408 pasadas**, igual que dejó
  `P0.5`.
- Pruebas: 18 nuevas, **1.426 pasadas, 9 omitidas, 0 fallos** en 72 archivos.
  Tres fallos durante el desarrollo, los tres por umbrales inventados en vez de
  medidos: el ancla de resincronización exigía 120 caracteres repetidos cuando
  un modelo repite una línea; el solapamiento mínimo de 24 dejaba fuera
  `      <li>Segundo</li>` (22 caracteres); y el corte por salto de línea de
  `continuationTail` usaba un tercio del trozo en vez de la mitad.
- Decisiones: (a) sin evidencia de continuidad **no se descarta texto**: se pega
  y se marca `needsReview`. Perder contenido es peor que una costura fea.
  (b) La resincronización sólo mira una ventana de 2.000 caracteres al principio
  de la continuación: buscar el ancla en todo el texto encontraría repeticiones
  legítimas más abajo y borraría contenido bueno. (c) `restart` se comprueba
  antes que el solapamiento, porque si la continuación contiene la respuesta
  entera, empalmar por el final la duplicaría.
- Riesgos o límites: al cerrar este subpaso la función todavía no la usaba
  nadie. Eso lo resuelve `P0.6b`, en la misma sesión.
- Estado nuevo: `P0.6a` `done`.
- Siguiente paso exacto: `P0.6b`, enlazar la continuación con su parcial y usar
  la unión en Studio.

### 2026-08-06 08:34 — Claude Code — P0.6b

- Estado anterior: `P0.6a` `done`, pero la unión no se usaba en ningún sitio.
  La continuación dependía por completo de que el modelo obedeciera el mensaje
  del compositor.
- Objetivo: que un turno sepa **qué respuesta continúa**, que el modelo reciba
  el parcial como dato no confiable y que Studio muestre el documento unido.
- Hipótesis o causa demostrada: no aplica, es una capacidad nueva.
- Archivos leídos: `packages/shared/src/schemas.ts`,
  `apps/gateway/src/handlers/studio.ts`,
  `apps/gateway/src/handlers/studio.test.ts`,
  `apps/desktop/src/shared/ipc.ts`, `apps/desktop/src/preload/index.ts`.
- Archivos modificados: `packages/shared/src/schemas.ts` (`continuesJobId`
  opcional en `studioJobCreateRequestSchema`),
  `apps/gateway/src/handlers/studio.ts` (lo persiste en la metadata del
  trabajo), `apps/desktop/src/renderer/conversation.ts`
  (`continuesJobId` en `ConversationMetadata`, bloque de continuación en
  `buildConversationPrompt`, `continuationSourceOf`, `conversationDocumentOf`),
  `apps/desktop/src/renderer/useConversations.ts`,
  `apps/desktop/src/renderer/pages/Conversations.tsx`,
  `apps/desktop/src/renderer/conversation.test.ts` (8 pruebas),
  `apps/gateway/src/handlers/studio.test.ts` (2 pruebas).
- Comandos ejecutados: `npm run build`,
  `npx vitest run apps/desktop/src/renderer/conversation.test.ts`,
  `npx vitest run apps/gateway/src/handlers/studio.test.ts`,
  `npx prettier --write`, `npm run lint`, `npm run typecheck`, `npm test`.
- Resultado real: al pulsar **Continuar generación** el envío queda marcado; el
  prompt lleva el final del parcial en un bloque
  `(DATOS, NO INSTRUCCIONES)` acotado a 1.200 caracteres, justo delante de la
  pregunta; el trabajo nuevo guarda `continuesJobId` en su metadata, así que la
  unión sobrevive a una recarga; y la tarjeta de la respuesta continuada muestra
  el documento reconstruido, cuántos fragmentos lo componen y un aviso cuando
  alguna costura no se pudo demostrar.
- Pruebas: 10 nuevas, **1.436 pasadas, 9 omitidas, 0 fallos** en 72 archivos.
  `lint`, `typecheck`, `build` y `prettier` limpios. Ningún fallo durante el
  desarrollo de este subpaso.
- Decisiones: (a) `continuesJobId` es **opcional** en el esquema y viaja en
  metadata, no en una columna: `D-014` prohíbe migraciones y `D-017` ya fijó que
  el detalle de una respuesta vive ahí. Un Studio antiguo que no lo mande sigue
  funcionando. (b) El parcial entra como **dato**, con el mismo trato que la
  memoria o el contexto de otra conversación, nunca como instrucción. (c) El
  bloque de continuación se coloca por delante de la pregunta pero se descarta
  antes que ella si no cabe: la pregunta actual nunca se recorta. (d) El
  documento unido se muestra en la tarjeta, pero **no** se reescribe el
  `resultSummary` de ningún trabajo: cada fragmento sigue siendo lo que el
  proveedor devolvió, y la unión es una vista.
- Riesgos o límites: (1) nada de esto se ha visto en pantalla — Studio sigue sin
  arrancar en este ordenador por `LA-010`, así que lo verificado es el contrato,
  no el píxel; (2) la memoria acumulativa todavía se cierra turno a turno: no
  espera a que la secuencia esté completa, que es lo que queda del apartado;
  (3) sigue sin existir la ruta de artefacto (`D-013`), así que un documento
  largo vive en `resultSummary` de cada fragmento; (4) una cancelación manual
  sigue sin conservar el texto parcial (viene del gateway, no de aquí).
- Estado nuevo: `P0.6b` `done`. `P0.6` sigue `in_progress` por `P0.6c`.
- Siguiente paso exacto: `P0.6c`. **Decidir antes de escribir código** dónde
  vive un artefacto largo y con qué límites: sin Supabase Storage ni nada
  facturable, el candidato natural es un archivo bajo
  `%LOCALAPPDATA%\Luxy\artifacts\<jobId>\` escrito por el agente, con el gateway
  guardando sólo la referencia. Esa decisión la aprueba Daniel antes de tocar
  código.

### 2026-08-06 09:20 — Claude Code — P0.8

- Estado anterior: `P0.6c` era el siguiente paso, pero Daniel arrancó Studio y
  observó un bucle de peticiones contra el gateway cada menos de 3 segundos.
  Esto pasa por delante: es gasto real contra Supabase.
- Objetivo: dejar de sondear lo que no puede haber cambiado.
- **Causa demostrada**, leyendo la salida de `wrangler` que pegó Daniel y el
  código del renderer: `useConversations` recargaba cada **1.500 ms** las
  opciones, la lista de trabajos y el detalle de **cada** respuesta visible,
  aunque llevara horas guardada. Con seis respuestas en pantalla son 8
  peticiones cada 1,5 s ≈ **19.200 a la hora**, y coincide con las 29.432 del
  panel en 60 minutos. `useStudio` hacía lo mismo cada 3 s.
- Archivos leídos: `apps/desktop/src/renderer/useConversations.ts`,
  `apps/desktop/src/renderer/useStudio.ts`, `apps/agent/src/agent.ts`,
  `packages/shared/src/schemas.ts`.
- Archivos modificados: `apps/desktop/src/renderer/conversation.ts`
  (`conversationPollDelayMs`, `conversationDetailsToFetch` y sus constantes),
  `apps/desktop/src/renderer/useConversations.ts`,
  `apps/desktop/src/renderer/useStudio.ts`,
  `apps/desktop/src/renderer/conversation.test.ts` (7 pruebas).
- Comandos ejecutados: `npm run build`,
  `npx vitest run apps/desktop/src/renderer/conversation.test.ts apps/desktop/src/renderer/useConversations.test.ts`,
  `npx prettier --write`, `npm run lint`, `npm run typecheck`, `npm test`.
- Resultado real, tres cambios:
  1. **el detalle de un trabajo terminado no se vuelve a pedir.** La lista ya
     trae el trabajo entero en cada vuelta y sirve de testigo: si el estado, el
     `completedAt` y el `resultSummary` no han cambiado y el trabajo ya había
     terminado, su detalle tampoco puede haber cambiado. Un trabajo vivo se pide
     siempre;
  2. **el ritmo depende de lo que pasa**: 1,5 s con algo corriendo, 10 s sin
     nada, 60 s con la ventana oculta. Al volver a la ventana se refresca en el
     acto, y enviar o detener recalcula el ritmo sin esperar al temporizador
     lento;
  3. **las opciones caducan a los 30 s** en vez de pedirse en cada vuelta.
- Cuentas, con una conversación de seis respuestas guardadas y nada corriendo:
  antes 8 peticiones cada 1,5 s (**≈19.200/h**), ahora 1 lista cada 10 s más las
  opciones cada 30 s (**≈480/h**). Con la ventana oculta, 60/h. Es una
  estimación aritmética a partir del código, no una medición: **la medición la
  tiene que dar el panel de Supabase de Daniel tras reiniciar Studio**
  (`LA-012`).
- Pruebas: 7 nuevas, **1.443 pasadas, 9 omitidas, 0 fallos** en 72 archivos.
  `lint`, `typecheck`, `build` y `prettier` limpios.
- Decisiones: (a) la cache de detalles vive en un ref y se sincroniza también al
  valorar y al cancelar; si se quedara atrás, el sondeo dejaría de refrescar ese
  trabajo, que es peor que la petición de más. (b) La ventana oculta manda sobre
  «hay algo corriendo»: si nadie mira, el streaming no urge. (c) **No he tocado
  el sondeo del agente** (`pollIntervalMs`, 2 s por defecto, ≈1.800 reclamaciones
  a la hora): es la decisión de arquitectura `0001`, vive en la configuración de
  máquina de Daniel y subirlo retrasa el arranque de los trabajos. Queda
  anotado en `LA-012` como decisión suya.
- Riesgos o límites: sin comprobación visual todavía; lo verificado es el
  contrato de las dos funciones puras, no el número real de peticiones. Si
  Daniel ve que una respuesta tarda hasta 10 s en aparecer estando la ventana
  en segundo plano, es esto y es deliberado.
- Estado nuevo: `P0.8` `done`.
- Siguiente paso exacto: Daniel reinicia Studio y confirma la caída de
  peticiones en el panel (`LA-012`). Después, `P0.6c`, que sigue bloqueado por
  la decisión de `LA-011`.

### 2026-08-06 09:40 — Claude Code — P0.9

- Estado anterior: `P0.8` bajó el sondeo en reposo, pero durante una generación
  Studio seguía preguntando cada 1,5 s por el texto de una respuesta que estaba
  produciendo un proceso hijo suyo.
- Objetivo, pedido por Daniel: reducir drásticamente las llamadas **sin perder
  funcionalidad**.
- Hecho observado en el código, no hipótesis: el agente corre en un utility
  process de Studio y ya publica `job.claimed`, `job.output`, `job.completed`,
  `job.failed` y `job.cancelled` con `jobId`
  (`packages/shared/src/agent-events.ts`); el renderer ya se suscribe en
  `useAgent.ts:112`. En una conversación, cada `provider_output` lleva el texto
  **acumulado** (`http-provider.ts:760`), que es justo lo que pinta la tarjeta.
- Archivos leídos: `packages/shared/src/agent-events.ts`,
  `apps/desktop/src/renderer/useAgent.ts`, `apps/desktop/src/preload/index.ts`,
  `apps/agent/src/agent.ts`, `apps/agent/src/job-runner.ts`,
  `apps/agent/src/providers/http-provider.ts`.
- Archivos modificados: `apps/desktop/src/renderer/conversation.ts`
  (`reduceLocalJobStream`, `activeJobsAreLocal`, `localFirstTokenMs`,
  `streamedLocally` en `conversationPollDelayMs`),
  `apps/desktop/src/renderer/useConversations.ts` (suscripción al bus local y
  recarga dirigida por evento), `apps/desktop/src/renderer/pages/Conversations.tsx`,
  `apps/desktop/src/renderer/conversation.test.ts` (8 pruebas).
- Comandos ejecutados: `npm run build`,
  `npx vitest run apps/desktop/src/renderer/conversation.test.ts`,
  `npx prettier --write`, `npm run lint`, `npm run typecheck`, `npm test`.
- Resultado real: durante una generación en esta máquina el texto se pinta
  desde el bus local, **sin ninguna petición**; el final de un trabajo dispara
  **una** recarga dirigida en vez de un sondeo a ciegas; y con todo lo vivo en
  local el sondeo baja de 1,5 s a 10 s. Una conversación completa pasa de ~40
  peticiones por minuto de generación a ~7.
- Pruebas: 8 nuevas, **1.451 pasadas, 9 omitidas, 0 fallos** en 72 archivos.
  `lint`, `typecheck`, `build` y `prettier` limpios.
- Decisiones: (a) **los eventos disparan la lectura, no la sustituyen.** Un
  evento local dice que el agente terminó, no lo que quedó guardado; el final
  real (`responseOutcome`, memoria, tokens) se sigue leyendo del trabajo
  persistido. El bus es best-effort y un proceso puede reiniciar. (b) Basta una
  respuesta viva de **otra** máquina para volver al sondeo de 1,5 s: de esa no
  llega ningún evento local, y perderla de vista sería perder funcionalidad.
  (c) Se conserva el contador de «primer texto» midiéndolo con el primer
  `job.output` local, porque durante el directo ya no se piden los eventos
  guardados.
- Riesgos o límites: (1) sin comprobación visual, como todo lo anterior;
  (2) el texto en vivo sigue recortado a 4.000 caracteres, que es lo que emite
  el proveedor por evento — comportamiento anterior, no una regresión nueva;
  (3) no toca el sondeo del agente al gateway.
- Estado nuevo: `P0.9` `done`.
- Siguiente paso exacto: `LA-012`, que ahora cubre `P0.8` **y** `P0.9`. Después,
  `P0.6c`, bloqueado por `LA-011`.

### 2026-08-06 09:55 — Claude Code — P0.6d

- Estado anterior: `P0.6c` bloqueado por `LA-011` (decisión de Daniel). Se coge
  lo que `P0.2` dejó apuntado como límite y aparcado para `P0.6`: una
  cancelación manual no conservaba el texto generado. La interfaz ya sabía
  pintarlo desde `P0.5`; el texto no llegaba.
- Objetivo: que pulsar **Detener** no cueste lo ya generado.
- Causa demostrada, leída en el código: `buildCancelledOutcome` sólo devolvía
  archivos modificados, worktree y duración; `handleJobCancelled` guardaba
  estado y metadata, sin `result_summary`. El texto recuperado existía en
  `recoveredText` y se tiraba.
- Archivos leídos: `apps/agent/src/job-runner.ts`, `apps/agent/src/agent.ts`,
  `apps/gateway/src/handlers/api.ts`, `apps/gateway/src/handlers/studio.ts`,
  `packages/shared/src/schemas.ts`.
- Archivos modificados: `packages/shared/src/schemas.ts` (`partialText` y
  `responseTermination` opcionales en `jobCancelledRequestSchema`),
  `apps/agent/src/job-runner.ts`, `apps/agent/src/agent.ts`,
  `apps/gateway/src/handlers/api.ts`,
  `apps/agent/src/response-matrix.test.ts` (caso 10 ampliado),
  `apps/gateway/src/handlers/cancelled-events.test.ts` (2 pruebas).
- Comandos ejecutados: `npm run build`,
  `npx vitest run apps/agent/src/response-matrix.test.ts`,
  `npx vitest run apps/gateway/src/handlers/cancelled-events.test.ts`,
  `npx prettier --write`, `npm run lint`, `npm run typecheck`, `npm test`.
- Resultado real: al cancelar, el agente manda lo generado —redactado y con el
  mismo tope que un resultado normal— junto al diagnóstico; el gateway lo guarda
  como `result_summary` y marca `responseOutcome: 'cancelled'` en la metadata.
  Sin texto no se inventa nada: ni resultado ni final.
- Pruebas: 2 nuevas y una ampliada, **1.453 pasadas, 9 omitidas, 0 fallos** en
  72 archivos. `lint`, `typecheck`, `build` y `prettier` limpios.
- Decisiones: (a) `cancelled` **sigue fuera** de `RECOVERABLE_RESPONSE_OUTCOMES`.
  El texto se conserva y se ve, pero no aparece **Continuar generación**: lo paró
  una persona y sabe por qué. Cambiar eso es otra decisión, no un efecto
  colateral. (b) Una cancelación **no escribe memoria**, igual que antes: sólo
  un final `completed` la sustituye (`D-019`). (c) Los campos nuevos son
  opcionales: un agente anterior sigue cancelando igual.
- Riesgos o límites: sin comprobación visual (`LA-010`/`LA-012`). El camino
  rápido de Studio (`finishConversationCancellation`, cuando el trabajo aún no
  llegó al agente) sigue cerrando sin resultado, y es correcto: ahí no hay texto
  que guardar.
- Estado nuevo: `P0.6d` `done`. `F2.13` del plan maestro pasa a `implemented`.
- Siguiente paso exacto: `P0.6c`, aún bloqueado por `LA-011`. Si Daniel prefiere
  abrir el bloque de aprendizaje antes, la evaluación de las diez ideas está en
  su respuesta y necesita que elija cuáles entran.

### 2026-08-06 13:05 — Claude Code — P0.6c

- Estado anterior: `P0.6c` bloqueado por `LA-011`. Daniel decidió: **archivo en
  su disco**, opción A.
- Objetivo: que una salida larga deje de vivir en una columna de texto y pase a
  ser un archivo que se pueda abrir (`D-013`).
- Hipótesis o causa demostrada: no aplica, es una capacidad nueva.
- Archivos leídos: `packages/shared/src/paths.ts`, `apps/agent/src/paths.ts`,
  `apps/desktop/src/main/ipc/handlers.ts`, `apps/desktop/src/shared/channels.ts`,
  `apps/desktop/src/shared/ipc.ts`, `apps/desktop/src/main/index.ts`.
- Archivos modificados: `packages/shared/src/artifacts.ts` (nuevo),
  `packages/shared/src/artifacts.test.ts` (nuevo, 12 pruebas),
  `packages/shared/src/constants.ts`, `packages/shared/src/schemas.ts`
  (`jobArtifactSchema`), `packages/shared/src/index.ts`,
  `apps/agent/src/artifacts.ts` (nuevo),
  `apps/agent/src/artifacts.test.ts` (nuevo, 5 pruebas),
  `apps/agent/src/job-runner.ts`, `apps/gateway/src/handlers/api.ts`,
  `apps/desktop/src/shared/channels.ts`, `apps/desktop/src/shared/ipc.ts`,
  `apps/desktop/src/preload/index.ts`,
  `apps/desktop/src/main/ipc/handlers.ts`, `apps/desktop/src/main/index.ts`,
  `apps/desktop/src/renderer/conversation.ts`,
  `apps/desktop/src/renderer/pages/Conversations.tsx`.
- Comandos ejecutados: `npm run build`,
  `npx vitest run packages/shared/src/artifacts.test.ts apps/agent/src/artifacts.test.ts`,
  `npx prettier --write`, `npm run lint`, `npm run typecheck`, `npm test`.
- Resultado real: cuando una respuesta de conversación es **larga y además un
  documento**, el agente la escribe en
  `%LOCALAPPDATA%\Luxyrtifacts\<jobId>\<LUX-XXXX>.<ext>`, el gateway guarda
  sólo la referencia (nombre, tipo, bytes, sha-256, fecha) en la metadata, y la
  tarjeta de Studio la muestra con un botón **Abrir carpeta**.
- Pruebas: 17 nuevas, **1.470 pasadas, 9 omitidas, 0 fallos** en 74 archivos.
  `lint`, `typecheck`, `build` y `prettier` limpios. Un fallo de lint durante el
  desarrollo: `ARTIFACT_KINDS` sólo se usa como tipo en `artifacts.ts` y
  `consistent-type-imports` exige `import type`.
- Decisiones: (a) **el nombre lo construye Luxy**, nunca el modelo: sale del
  `shortId` del trabajo filtrado a `[A-Z0-9-]`, y la extensión de un detector de
  contenido. Dejar que un texto generado elija nombre es dejarle elegir dónde
  cae. (b) Dos barreras, no una: el nombre se filtra al construirlo **y** la
  ruta final se comprueba contra la raíz antes de escribir. (c) Hacen falta las
  **dos** condiciones —largo y documento— para escribir archivo: una explicación
  de 10.000 caracteres es una respuesta que se lee, no un archivo que se abre.
  (d) El artefacto **no sustituye** al resultado: `resultSummary` sigue llevando
  el texto, así que nada cambia para quien sólo mira la tarjeta. (e) Si escribir
  falla, se avisa y el trabajo sigue: un artefacto es una mejora, no un
  requisito. (f) El renderer manda sólo el `jobId` por IPC, nunca una ruta: la
  raíz la calcula el proceso principal.
- Riesgos o límites: (1) el archivo vive en la máquina que lo generó — desde
  otra máquina la referencia se ve pero no el contenido, que es la pega conocida
  de la opción elegida; (2) nadie borra artefactos todavía: no hay caducidad ni
  cuota total, sólo el tope de 2 MB por archivo; (3) sin comprobación visual
  (`LA-012`); (4) sigue faltando cerrar la memoria acumulativa sólo cuando la
  secuencia esté completa, que era la otra mitad de `P0.6c`.
- Estado nuevo: `P0.6c` `done` en su parte de artefactos. `LA-011` resuelta.
- Siguiente paso exacto: `P0.7`, validación y cierre del bloque P0 — o el bloque
  de aprendizaje, si Daniel elige antes las ideas y el presupuesto.

### 2026-08-06 13:55 — Claude Code — F4.1-T1

- Estado anterior: el catálogo de modelos está **escrito a mano** en
  `models/catalog.ts`, con 8.192 tokens de salida para todos los modelos, un
  número que nunca se verificó. `LA-007` lleva abierta desde que `LUX-3966`
  terminó con `finish_reason: length` justo ahí.
- Objetivo, pedido por Daniel: que Luxy consulte los modelos y los precios
  reales de la pasarela en vez de creerse una lista estática.
- Investigación previa, con su resultado real: `https://api.hcnsec.cn/pricing`
  es una SPA del panel _New API_ y no se puede leer sin JavaScript; `/v1/models`
  y `/api/pricing` devuelven **401**. Por búsqueda web se confirma que es un
  relay público y gratuito de 新疆幻城网安 que agrupa 30–40 proveedores en
  formato OpenAI, con créditos de regalo y **sin SLA**. Conclusión: la lista
  sólo se puede obtener con la clave, luego la tiene que pedir Luxy.
- Archivos leídos: `apps/desktop/src/main/ipc/handlers.ts` (prueba de conexión
  existente), `apps/desktop/src/shared/ipc.ts`,
  `packages/shared/src/models/catalog.ts`,
  `apps/desktop/src/renderer/pages/Config.tsx`.
- Archivos modificados: `packages/shared/src/models/catalog-fetch.ts` (nuevo),
  `packages/shared/src/models/catalog-fetch.test.ts` (nuevo, 11 pruebas),
  `packages/shared/src/models/index.ts`,
  `apps/desktop/src/main/catalog-store.ts` (nuevo),
  `apps/desktop/src/main/ipc/handlers.ts`, `apps/desktop/src/main/index.ts`,
  `apps/desktop/src/shared/channels.ts`, `apps/desktop/src/shared/ipc.ts`,
  `apps/desktop/src/preload/index.ts`,
  `apps/desktop/src/renderer/pages/Config.tsx`.
- Comandos ejecutados: `npm run build`,
  `npx vitest run packages/shared/src/models/catalog-fetch.test.ts`,
  `npx prettier --write`, `npm run lint`, `npm run typecheck`, `npm test`.
- Resultado real: en **Modelos** hay un panel «Catálogo real de la conexión» con
  un botón que consulta `/v1/models` y, después, `/api/pricing`. El resultado se
  guarda con fecha en `%LOCALAPPDATA%\Luxy\catalog\<conexion>.json` y se pinta
  agrupado por familia, diciendo de cada modelo si se cobra **por tokens** o
  **por llamada**.
- Pruebas: 11 nuevas, **1.481 pasadas, 9 omitidas, 0 fallos** en 75 archivos.
  `lint`, `typecheck`, `build` y `prettier` limpios.
- Decisiones: (a) **manda `/v1/models`**: un precio suelto no inventa un modelo,
  y un modelo servido sin precio se lista igual marcado `unknown`. No saber lo
  que cuesta no es motivo para esconderlo. (b) El parseo de precios acepta
  **cualquier forma**: todos los campos son opcionales y hay `passthrough`.
  Todavía no se ha visto una respuesta real de esta pasarela y exigir campos
  haría que un cambio menor tirase el catálogo entero. (c) **No se convierten
  los multiplicadores a dinero.** `model_ratio` se guarda tal cual; traducirlo a
  yuanes exige saber la unidad de crédito de la pasarela, y un número inventado
  aquí sería peor que no dar ninguno. Se decide con la respuesta real delante.
  (d) La clave **no cruza el IPC**: el renderer manda sólo el identificador de
  conexión, la URL sale de la configuración guardada y la petición la hace el
  proceso principal, igual que la prueba de conexión existente.
- Riesgos o límites: (1) nadie ha ejecutado todavía la consulta contra la
  pasarela real, así que el parseo de precios está probado contra la forma
  **documentada** de _New API_, no contra su respuesta; (2) el catálogo real es
  **informativo**: todavía no alimenta `models/catalog.ts` ni el
  `maxOutputTokens` que se envía, que es lo que cerraría `LA-007`; (3) el
  archivo guardado no contiene claves, sólo nombres, multiplicadores y grupos.
- Estado nuevo: `F4.1` `implemented` en su primera mitad.
- Siguiente paso exacto: Daniel pulsa **Consultar a la pasarela** y me pasa lo
  que salga (`LA-014`). Con la respuesta real: ajustar el parseo si hace falta,
  traducir multiplicadores a coste y llevar el `maxOutputTokens` verificado al
  catálogo, que cierra `LA-007` y `F2.14`.

### 2026-08-06 14:05 — Claude Code — F4.1-T2

- Estado anterior: Daniel abrió **Modelos** y los **19 modelos del catálogo**
  salían «no disponible», cada uno con `la conexion "API China" no sirve el
modelo X`. Con la clave puesta y trabajos ejecutándose contra esa misma
  conexión ese mismo día.
- **Causa demostrada**, leída en el código: `buildRegistry` en
  `apps/desktop/src/renderer/pages/Config.tsx` pasaba `availableModels: []` con
  el comentario «sin sincronizar todavia: no se afirma que un modelo este
  disponible». Pero `ModelRegistry.resolve` hacía
  `status.availableModels.includes(apiModel)` sobre una lista vacía, que da
  `false`, no `null`. O sea: **afirmaba justo lo que el comentario decía que no
  iba a afirmar**. No era un fallo de la conexión ni del catálogo.
- Archivos leídos: `packages/shared/src/models/registry.ts`,
  `packages/shared/src/models/registry.test.ts`,
  `apps/desktop/src/renderer/pages/Config.tsx`.
- Archivos modificados: `packages/shared/src/models/registry.ts` (una lista
  vacía es «no se sabe», no «no sirve ninguno»),
  `packages/shared/src/models/registry.test.ts` (prueba del caso real),
  `apps/desktop/src/renderer/pages/Config.tsx` (la pantalla usa el catálogo real
  guardado cuando existe, y comparte ese estado con el panel de `F4.1-T1`).
- Comandos ejecutados: `npm run build`,
  `npx vitest run packages/shared/src/models/registry.test.ts`,
  `npx prettier --write`, `npm run lint`, `npm run typecheck`, `npm test`.
- Resultado real: sin catálogo consultado, los modelos salen **«sin comprobar»**
  en vez de «no disponible». Tras pulsar **Consultar a la pasarela**, la
  disponibilidad se calcula contra lo que la pasarela dice servir de verdad, con
  su fecha.
- Pruebas: 1 nueva, **1.482 pasadas, 9 omitidas, 0 fallos** en 75 archivos.
  `lint`, `typecheck`, `build` y `prettier` limpios.
- Decisiones: el arreglo va en `registry.ts`, no en la pantalla. Una conexión que
  funciona sirve **algo**, así que cero modelos sólo puede significar que nadie
  ha preguntado. Arreglarlo únicamente en la pantalla dejaría la misma trampa
  para el siguiente que construya un registro.
- Riesgos o límites: Daniel está viendo un Studio con el build anterior, así que
  ni este arreglo ni el panel de `F4.1-T1` aparecen hasta reconstruir y
  reiniciar (`LA-004`, `LA-012`, `LA-014`).
- Estado nuevo: corregido.
- Siguiente paso exacto: `LA-014` — reconstruir, pulsar el botón y devolver el
  JSON del catálogo.

### 2026-08-07 08:45 — Claude Code + Daniel — F4.1-T3 y despliegue

- Estado anterior: en `portatil-clase`, Conversaciones daba
  `el gateway respondio 404: ruta no encontrada` y 0 conversaciones.
- **Causa demostrada**: `gatewayUrl` de esa máquina apunta al Worker desplegado
  `https://luxy-gateway.dlux135.workers.dev`, y ese despliegue era **anterior a
  Studio**: tenía `/api/machines/*` y `/api/jobs/*` —por eso agente y gateway
  salían en verde— pero ninguna ruta `/api/studio/*`. No había nada escuchando
  en el 8787, así que no era wrangler local.
- Acción de Daniel, autorizada por él: `npx wrangler deploy` del gateway actual.
  Versión `096f2623-c6cc-4dcd-94d3-b41a12608ea4`.
- Verificación hecha desde aquí, sin credenciales: `GET /api/studio/options`
  devuelve **401**, no 404 ni 500. Los tres datos que da esa única respuesta:
  la ruta existe (el despliegue llegó), `envSchema` valida (los secretos están
  puestos en Cloudflare aunque no aparezcan en la lista de bindings), y la
  autenticación rechaza lo no autenticado.
- Por qué el despliegue no necesitó migración: todo lo de `P0.1`–`P0.9` viaja en
  `metadata` por diseño (`D-014`, `D-017`). El enum de Postgres no se tocó.
- Compatibilidad: la otra máquina sigue con el agente del 30 de julio y no se
  rompe, porque los campos nuevos del contrato son todos opcionales.

- Datos reales del catálogo, leídos de
  `%LOCALAPPDATA%\Luxy\catalog\hcnsec.json` el 2026-08-07 06:08 UTC: la
  pasarela sirve **22 modelos**, no los 19 del catálogo escrito a mano.
  - Sirve dos que el catálogo da por **no servidos**: `sensenova-6.7-flash-lite`
    y `sensenova-u1-fast`. Hay una prueba en `registry.test.ts` que afirma lo
    contrario y ahora es falsa.
  - Sirve uno que no existía cuando se escribió: `step-explore`.
  - **Cero precios**: `pricingAvailable: false` y `notice: null`, o sea que la
    ruta contestó algo que parseó pero sin entradas, y no había forma de saber
    qué.
- Archivos modificados: `packages/shared/src/models/catalog-fetch.ts`
  (`PricingProbe`, `describePricingProbes`, familias step/step-media/minimax/
  sensenova/router), `packages/shared/src/models/catalog-fetch.test.ts`
  (4 pruebas más), `apps/desktop/src/main/ipc/handlers.ts` (prueba tres rutas de
  precios y apunta código HTTP, claves y número de entradas de cada una),
  `apps/desktop/src/shared/ipc.ts`.
- Comandos ejecutados: `npm run build`, `npx vitest run packages/shared/src/models/`,
  `npx prettier --write`, `npm run lint`, `npm run typecheck`, `npm test`.
- Pruebas: 4 nuevas, **1.486 pasadas, 9 omitidas, 0 fallos** en 75 archivos.
- Decisiones: el aviso de «sin precios» pasa a decir **qué contestó cada ruta**.
  Un `sin precios declarados` mudo no se puede depurar; `/api/pricing: 200 con 0
entradas (success, data)` sí.
- Riesgos o límites: (1) el catálogo real sigue siendo informativo y no alimenta
  `models/catalog.ts` ni el `maxOutputTokens` efectivo; (2) la prueba de
  `registry.test.ts` sobre modelos «no servidos» está desmentida por los datos y
  hay que corregirla con criterio, no borrarla; (3) nada de `P0.6`–`P0.9` se ha
  visto funcionar todavía contra el gateway nuevo.
- Estado nuevo: gateway desplegado con el código actual; `LA-014` cumplida en su
  primera vuelta.
- Siguiente paso exacto: en Studio de desarrollo, comprobar Conversaciones ya sin
  404, y repetir **Consultar a la pasarela** para leer el diagnóstico de precios.

### 2026-08-09 — Codex — DOC-CHECKPOINT-002

- Estado anterior: la rama real estaba en `59870c6` y sincronizada con origen,
  pero `CURRENT-TASK.md`, `PROJECT-STATE.md`, `MASTER-PLAN.md` y
  `LOCAL-ACTIONS.md` todavía presentaban `P0.6c`, el push y partes de `F4.1`
  como pendientes.
- Objetivo: reconciliar la memoria canónica antes de continuar código.
- Hipótesis o causa demostrada: documentación de relevo no actualizada después
  de los commits `265fd64` y `59870c6`; comprobado con Git y el código actual.
- Archivos leídos: documentos obligatorios de relevo, historial reciente,
  catálogo, registro, instantánea real y pantalla de Modelos.
- Archivos modificados: `CURRENT-TASK.md`, `PROJECT-STATE.md`,
  `MASTER-PLAN.md`, `LOCAL-ACTIONS.md`, `CHANGELOG-WORK.md`.
- Comandos ejecutados: `git status --short --branch`, `git diff --stat`,
  `git log`, `git branch -r` y `git rev-parse` sobre ramas local/remotas.
- Resultado real: HEAD y `origin/feat/luxy-desktop` son `59870c6`; el rescate
  de Remote existe en origen como `e27aa05`; se preservan el cambio ajeno de
  `package-lock.json` y los archivos sin seguimiento.
- Pruebas: no aplica todavía; reconciliación documental y comprobaciones Git de
  solo lectura.
- Decisiones: continuar como `F4.1-T4`; no reabrir `P0.6c` ni repetir pushes.
- Riesgos o límites: precios y topes reales siguen sin evidencia; no se leen
  secretos ni se llama a la pasarela.
- Estado nuevo: `DOC-CHECKPOINT-002` `done`; `F4.1-T4` `in_progress`.
- Siguiente paso exacto: representar en el catálogo operativo los tres modelos
  observados que faltan, con capacidades conservadoras y pruebas sin red.

### 2026-08-09 — Codex — F4.1-T4

- Estado anterior: la lectura real de la pasarela contenía 22 modelos, pero
  `buildDefaultCatalog` conservaba 19 y una prueba afirmaba que dos SenseNova no
  se servían.
- Objetivo: llevar los tres modelos observados al catálogo operativo sin
  inventar capacidades, herramientas, precios ni límites.
- Hipótesis o causa demostrada: la instantánea sólo alimentaba
  `availableModels`; `step-explore`, `sensenova-6.7-flash-lite` y
  `sensenova-u1-fast` no tenían definición y por tanto no llegaban al registro.
- Archivos leídos: catálogo, tipos, registro y pruebas de modelos; pantalla de
  Modelos; persistencia y parseo de la instantánea real.
- Archivos modificados: `packages/shared/src/models/types.ts`, `catalog.ts`,
  `registry.ts`, `registry.test.ts`; `apps/desktop/src/renderer/pages/Config.tsx`;
  documentación canónica.
- Comandos ejecutados: Prettier, Vitest específico, `npm run lint`,
  `npm run typecheck`, `npm test`, `npm run build`, siempre mediante RTK.
- Resultado real: el catálogo operativo contiene los 22 identificadores. Los
  tres nuevos sólo declaran texto, quedan no agentic, sin herramientas, sin
  alias y con contrato no verificado. Un alias de familia exige ahora un modelo
  predeterminado explícito.
- Pruebas: primera ejecución específica: 49 pasadas y 1 fallo, porque la familia
  nueva inventaba `/sensenova`; corregido. Ejecución específica final: 88/88.
  Suite completa: 1.488 pasadas, 9 omitidas, 0 fallos en 75 archivos. Lint,
  tipos y build: exit 0. El primer `git diff --check` detectó los dos espacios
  finales usados como salto Markdown en dos líneas nuevas; se sustituyeron por
  párrafos y la repetición terminó con exit 0.
- Decisiones: representar disponibilidad observada no autoriza a afirmar tool
  calling, rapidez, precio o máximo de salida; se mantienen desconocidos.
- Riesgos o límites: el `maxOutputTokens` por defecto sigue siendo 8.192 y no se
  presenta como verificado; la segunda lectura de precios requiere `LA-014`.
- Estado nuevo: `F4.1-T4` `done`; `F4.1` `implemented`, pendiente de evidencia
  manual para precios y topes.
- Siguiente paso exacto: Daniel reconstruye Studio y repite **Consultar a la
  pasarela** (`LA-014`).

### 2026-08-09 — Codex + Daniel — F4.1-T5

- Estado anterior: Studio pedía `/v1/models` y después probaba tres rutas de
  precios; la pantalla mostraba el diagnóstico y repetía «sin precio» para cada
  modelo.
- Objetivo: dejar de consultar precios que la pasarela no publica.
- Hipótesis o causa demostrada: captura de Daniel con 22 modelos y tres sondeos
  sin entradas útiles: dos respuestas vacías y un 404.
- Archivos leídos: handler IPC del catálogo, pantalla de Modelos, contratos IPC,
  parser y pruebas del catálogo.
- Archivos modificados: `apps/desktop/src/main/ipc/handlers.ts`,
  `apps/desktop/src/renderer/pages/Config.tsx`, prueba de catálogo y documentos
  de continuidad/decisión.
- Comandos ejecutados: Prettier, Vitest específico, búsqueda de rutas de precio,
  `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.
- Verificación de llamadas: la búsqueda de `/api/pricing`, `/v1/pricing` y
  `/api/models` en `apps/desktop/src` devolvió 0 coincidencias y exit 1, que es
  la convención de `rg` cuando no encuentra resultados.
- Resultado real: **Actualizar modelos** realiza una sola petición a
  `/v1/models`. La interfaz muestra una nota neutra única y sólo lista nombres;
  desaparecen el diagnóstico de rutas y las etiquetas por modelo.
- Pruebas: 80/80 específicas; suite completa 1.488 pasadas, 9 omitidas, 0
  fallos en 75 archivos. Lint, tipos y build: exit 0. La primera comprobación
  del diff encontró un salto Markdown con whitespace final en `DECISIONS.md`;
  se sustituyó por un párrafo y la repetición quedó limpia.
- Decisiones: `D-022`; una conexión futura con API de precios documentada
  necesitará integración explícita. No se prueban rutas tentativas.
- Riesgos o límites: los campos antiguos de precio se conservan en el formato
  del snapshot para leer archivos existentes, pero no provocan red ni se pintan.
- Estado nuevo: `F4.1-T5` `done`; `LA-014` cerrada por decisión.
- Siguiente paso exacto: reconstruir/reiniciar Studio para cargar el renderer
  nuevo; el botón queda sólo para actualizar modelos.

### 2026-08-09 — Codex — F4.2-T1

- Estado anterior: Modelos mostraba catálogo y disponibilidad declarada por la
  conexión, pero no utilizaba la evidencia de trabajos ya guardados.
- Objetivo: resumir disponibilidad, velocidad, estabilidad y errores por modelo
  sin ejecutar benchmarks ni llamadas de proveedor.
- Hipótesis o causa demostrada: `StudioJob` ya conserva `model`, estado,
  `responseOutcome`, `durationMs`, fechas y error. No hace falta esquema nuevo.
- Archivos leídos: contratos de trabajos, gateway de Studio, hooks de historial,
  pantalla de Modelos y reglas de finales de respuesta.
- Archivos modificados: nuevos `model-evidence.ts` y
  `model-evidence.test.ts`, `Config.tsx` y documentación canónica.
- Comandos ejecutados: Prettier, Vitest específico, `npm run lint`,
  `npm run typecheck`, `npm test`, `npm run build`.
- Resultado real: al abrir Modelos se leen una vez hasta 100 trabajos. Por
  modelo exacto se muestran completas/observaciones, porcentaje, mediana de las
  completas, truncadas, interrumpidas, timeout, fallidas y canceladas aparte.
- Pruebas: 71/71 específicas; suite completa **1.494 pasadas, 9 omitidas, 0
  fallos** en 76 archivos. Lint, tipos y build: exit 0.
- Decisiones: (a) no inferir modelo desde proveedor; (b) cancelaciones no miden
  inestabilidad del modelo; (c) la velocidad usa sólo respuestas completas;
  (d) una lectura por apertura, nunca polling.
- Riesgos o límites: muestra máxima de 100 trabajos; ejecuciones con `model:
null` no pueden atribuirse; falta confirmación visual.
- Estado nuevo: `F4.2-T1` `done`; `F4.2` `implemented` inicialmente.
- Siguiente paso exacto: `LA-017`, reconstruir Studio y comprobar la vista.

### 2026-08-09 — Codex — F4.2-T2

- Estado anterior: las métricas sólo podían atribuir trabajos cuyo campo
  `model` ya contenía un identificador exacto; al pedir una familia, el modelo
  predeterminado resuelto por el agente podía perderse.
- Objetivo: conservar el `apiModel` realmente ejecutado y usarlo como evidencia
  en completados, fallos y cancelaciones, manteniendo compatibilidad con
  agentes y trabajos anteriores.
- Hipótesis o causa demostrada: el agente resolvía el modelo antes de invocar al
  proveedor, pero los contratos de resultado no transportaban ese dato hasta
  el gateway. Si el proveedor devuelve `usage.model`, ésa es la evidencia más
  precisa y debe prevalecer.
- Archivos modificados: `packages/shared/src/schemas.ts`,
  `apps/agent/src/job-runner.ts`, `apps/agent/src/agent.ts`,
  `apps/gateway/src/handlers/api.ts`,
  `apps/desktop/src/renderer/model-evidence.ts` y sus pruebas relacionadas.
- Comandos ejecutados: build de `@luxy/shared`, Prettier, Vitest específico,
  `npm run lint`, `npm run typecheck`, `npm test` y `npm run build`, mediante
  RTK.
- Resultado real: `executedModel` viaja en todos los finales. Gateway rellena
  `model` sólo si estaba vacío, conserva además `metadata.executedModel` y usa
  el modelo efectivo en la fuente de memoria de conversación. El agregador
  prefiere `job.model` y acepta la metadata sólo si es una cadena válida.
- Pruebas: primera matriz específica, 28 pasadas y 3 fallos porque Gateway
  cargaba el `dist` anterior de `@luxy/shared`; tras reconstruirlo, 30 pasadas y
  1 fallo real: la cancelación de una fixture heredada omitía `model` y no se
  trataba como vacío. Corregido sin sobrescribir valores existentes. Matriz
  final 31/31; suite completa 1.497 pasadas, 9 omitidas, 0 fallos en 76
  archivos. Lint, tipos y build: exit 0. Las 64 pruebas documentales, Prettier
  sobre los archivos del paso y `git diff --check` también pasan. El
  `format:check` global sigue fallando por deuda previa extendida y por el HTML
  inválido de `Web demos/GLM demos/index.html`; no se modificaron esos archivos
  ajenos al paso.
- Decisiones: no inferir modelos históricos; guardar evidencia explícita. Un
  `usage.model` del proveedor prevalece sobre el predeterminado resuelto.
- Riesgos o límites: agentes antiguos no envían el campo; los trabajos ya
  guardados sin modelo continúan sin atribución. Falta validación visual.
- Estado nuevo: `F4.2-T2` `done`; `LA-017` queda como acción activa de Daniel.
- Siguiente paso exacto: reconstruir/reiniciar Studio y el agente, y ejecutar
  la lista ampliada de `LA-017`.

### 2026-08-09 — Codex — F4.2-T3

- Estado anterior: Modelos pedía una sola página de 100 trabajos y el agregador
  descartaba cualquier elemento posterior, aunque el historial durable pudiera
  ser mayor.
- Objetivo: paginar la evidencia sin polling ni carga ilimitada y mostrar la
  cobertura real de la muestra.
- Hipótesis o causa demostrada: el contrato validaba sólo `limit`; repositorio y
  PostgREST no recibían desplazamiento. La limitación estaba en toda la ruta,
  no sólo en el renderer.
- Archivos leídos: contratos compartidos e IPC, cliente de Gateway, handler de
  Studio, repositorio/PostgREST, pantalla y agregador de Modelos y pruebas.
- Archivos modificados: `packages/shared/src/schemas.ts`,
  `apps/desktop/src/shared/ipc.ts`, `apps/agent/src/gateway-client.ts`,
  `apps/gateway/src/supabase.ts`, `repository.ts`, `handlers/studio.ts`,
  `apps/desktop/src/renderer/model-evidence.ts`, `pages/Config.tsx` y cuatro
  archivos de pruebas.
- Comandos ejecutados: build de `@luxy/shared`, Prettier, Vitest específico,
  `npm run lint`, `npm run typecheck`, `npm test` y `npm run build`, siempre con
  RTK.
- Resultado real: `offset` opcional y validado llega hasta PostgREST. Modelos
  lee páginas de 100 una sola vez, deduplica por ID, limita la revisión a 1.000
  y hace una sonda de un registro para distinguir muestra completa de truncada.
  Si un Gateway anterior repite la primera página, se detiene y lo avisa.
- Pruebas: matriz específica final 60/60. Suite completa 1.504 pasadas, 9
  omitidas, 0 fallos en 76 archivos. Lint, tipos y build: exit 0.
- Fallo durante desarrollo: el primer `typecheck` encontró tres consumidores
  antiguos porque el valor por defecto de Zod hacía `offset` obligatorio en el
  tipo IPC. Se dejó opcional en Desktop y el valor `0` se aplica en Gateway;
  repetición verde.
- Decisiones: máximo local de 1.000 trabajos para evitar una lectura sin límite;
  la interfaz declara el tope en vez de ocultarlo. No hay polling.
- Riesgos o límites: el Gateway desplegado no se actualizó. Un Desktop nuevo
  contra esa versión mostrará el aviso de paginación detenida hasta probar en
  local o autorizar deploy.
- Estado nuevo: `F4.2-T3` `done`; `LA-017` vuelve a ser el paso activo.
- Siguiente paso exacto: reconstruir Studio y agente, usar Gateway actualizado
  y ejecutar la lista de `LA-017`.

### 2026-08-09 — Codex — F4.3-T1

- Estado anterior: F4.3 enumeraba áreas de prueba, pero no existía Laboratorio
  ni un contrato reproducible; cualquier comparación futura habría tenido que
  inventar prompts y criterios en la interfaz.
- Objetivo: crear el catálogo versionado y hacerlo revisable sin permitir aún
  ejecuciones ni consumo de tokens.
- Hipótesis o causa demostrada: no había ninguna definición de benchmark en
  shared, Desktop, agente o Gateway. Las puntuaciones existentes pertenecían al
  router y al feedback, no a evaluaciones reproducibles.
- Archivos leídos: navegación de Desktop, primitivas visuales, catálogo y tipos
  de modelos, exports compartidos y estilos existentes.
- Archivos modificados: nuevos `packages/shared/src/models/evaluations.ts`,
  `evaluations.test.ts` y `apps/desktop/src/renderer/pages/Laboratory.tsx`;
  además `models/index.ts`, `App.tsx` y documentación canónica.
- Comandos ejecutados: build de `@luxy/shared`, Prettier, Vitest específico,
  `npm run lint`, `npm run typecheck`, `npm test` y `npm run build`, mediante
  RTK.
- Resultado real: ocho definiciones validadas cubren todas las áreas de F4.3.
  Cada una fija versión, prompt, estrategia de scoring, capacidades, fixture y
  criterios. La nueva navegación Laboratorio las muestra y declara modo
  preparación; `executionEnabled` sólo admite `false`.
- Pruebas: 46/46 específicas; suite completa 1.507 pasadas, 9 omitidas, 0
  fallos en 77 archivos. Lint, tipos y build: exit 0.
- Decisiones: separar definición de ejecución. Tener un prompt catalogado no
  autoriza a llamar al proveedor; el runner exigirá una acción explícita y será
  otro paso.
- Riesgos o límites: las fixtures se nombran pero todavía no existen; no hay
  validadores, selector, persistencia ni puntuaciones. La pantalla es catálogo,
  no benchmark funcional.
- Estado nuevo: `F4.3-T1` `done`; `LA-018` queda pendiente.
- Siguiente paso exacto: validar visualmente el catálogo y después implementar
  `F4.3-T2`, fixtures y validadores locales sin red.

### 2026-08-09 — Codex — F4.3-T2

- Estado anterior: el catálogo nombraba seis fixtures y estrategias de scoring,
  pero las fixtures no existían y ninguna salida podía evaluarse localmente.
- Objetivo: materializar datos reproducibles y separar validación pura de los
  runners que requieren aislamiento o juicio humano.
- Hipótesis o causa demostrada: `fixtureId` era sólo una referencia textual. No
  había contenido, resolución por ID ni función de validación en el repositorio.
- Archivos leídos: catálogo de evaluaciones, tipos de modelos, pantalla
  Laboratorio, exports compartidos y pruebas del área.
- Archivos modificados: nuevo
  `packages/shared/src/models/evaluation-fixtures.ts` y su prueba;
  `evaluations.ts`, `models/index.ts`, `Laboratory.tsx` y documentación.
- Comandos ejecutados: build de `@luxy/shared`, Prettier, Vitest específico,
  `npm run lint`, `npm run typecheck`, `npm test` y `npm run build`, con RTK.
- Resultado real: seis fixtures versionadas y validadas, sin archivos
  temporales ni red. El contexto largo se genera igual en cada lectura con
  1.200 líneas y cuatro anclas; tool calling usa archivos virtuales. Cuatro
  validadores puros devuelven checks explicables. Ninguna salida se ejecuta.
- Pruebas: 53/53 específicas; suite completa 1.514 pasadas, 9 omitidas, 0
  fallos en 78 archivos. Lint, tipos y build: exit 0.
- Decisiones: una prueba de código no se puntúa hasta disponer de sandbox; una
  rúbrica o traza no se presenta como automática. `validationMode` fija esta
  distinción en el contrato.
- Riesgos o límites: los validadores existen como lógica compartida, pero aún no
  hay respuestas reales que pasarles; Laboratorio sigue sin selector ni botón.
- Estado nuevo: `F4.3-T2` `done`; `LA-018` permanece pendiente y ampliada.
- Siguiente paso exacto: `F4.3-T3`, selección compatible y previsualización del
  prompt compuesto sin enviar nada.

### 2026-08-09 — Codex — F4.3-T3

- Estado anterior: catálogo, fixtures y validadores existían, pero no había
  forma de elegir una prueba/modelo ni revisar el prompt que recibiría el
  proveedor.
- Objetivo: preparar una ejecución de forma completamente local y auditable,
  manteniendo deshabilitado el envío.
- Hipótesis o causa demostrada: Laboratorio sólo renderizaba las tarjetas; no
  componía fixtures ni cruzaba requisitos con el catálogo operativo.
- Archivos leídos: Laboratorio, configuración disponible en App, catálogo de
  modelos, evaluaciones, fixtures, primitivas visuales y pruebas.
- Archivos modificados: `evaluations.ts`, `evaluation-fixtures.ts` y sus pruebas;
  `Laboratory.tsx`, `App.tsx` y documentación canónica.
- Comandos ejecutados: build de `@luxy/shared`, Prettier, Vitest específico,
  `npm run lint`, `npm run typecheck`, `npm test` y `npm run build`, mediante
  RTK.
- Resultado real: filtro puro por capacidades declaradas y estado habilitado;
  prompt determinista con cabecera, versión, instrucciones y fixture delimitada
  como datos. Studio muestra selectores, modelo efectivo de la vista previa,
  tamaño, fixture y contenido completo. No existe botón ni llamada IPC.
- Pruebas: 55/55 específicas; suite completa 1.516 pasadas, 9 omitidas, 0
  fallos en 78 archivos. Lint, tipos y build: exit 0.
- Decisiones: la lista compatible es una lectura del catálogo, no evidencia de
  capacidad. El prompt no cambia entre modelos para conservar comparabilidad.
- Riesgos o límites: el catálogo puede declarar capacidades aún no verificadas;
  ninguna selección se persiste y el prompt largo puede ser grande al abrir su
  detalle, aunque sólo se genera en memoria.
- Estado nuevo: `F4.3-T3` `done`; `LA-018` permanece pendiente y ampliada.
- Siguiente paso exacto: diseñar confirmación y persistencia antes de habilitar
  la primera ejecución (`F4.3-T4`/`F4.5`).

### 2026-08-09 — Codex — F4.3-T4

- Estado anterior: Laboratorio componía una vista previa comparable, pero no
  existía contrato de confirmación, persistencia ni aislamiento específico para
  una futura ejecución.
- Objetivo: fijar esas fronteras sin conectar la interfaz a ningún proveedor.
- Hipótesis o causa demostrada: los trabajos existentes ya conservan prompt,
  modelo y metadata; no hace falta migración, pero una tarea normal podría
  recibir worktree y herramientas si se reutilizara sin un modo propio.
- Archivos leídos: contratos shared, handler y pruebas de Studio, job runner,
  Laboratorio y documentación canónica.
- Archivos modificados: esquemas/evaluaciones shared, handler del Gateway, job
  runner, Laboratorio, tres suites de contrato/aislamiento y documentación.
- Comandos ejecutados: build de `@luxy/shared`, Prettier, Vitest específico,
  lint, typecheck, suite completa y build mediante RTK.
- Resultado real: `mode: evaluation` exige modelo exacto, confirmación literal
  y snapshot versionado. Gateway compara definición y prompt con el catálogo y
  persiste metadata sin score. El agente impide edición, herramientas, memoria
  y checks. La UI sólo muestra confirmación futura y botón deshabilitado.
- Pruebas: 37/37 específicas; suite completa 1.523 pasadas, 9 omitidas, 0
  fallos en 80 archivos. Lint, tipos y build: exit 0.
- Decisiones: `D-023`; definir, seleccionar o marcar una casilla no sustituye
  la acción de ejecución. Toda puntuación debe proceder de un validador real.
- Riesgos o límites: el endpoint ya entiende el contrato confirmado, pero el
  renderer no lo invoca. Sandbox, rúbricas, trazas, comparaciones y scores aún
  no están conectados.
- Estado nuevo: `F4.3-T4` `done`; `LA-018` permanece pendiente y ampliada.
- Siguiente paso exacto: `F4.3-T5`, contrato de resultado y validación local de
  salidas persistidas, manteniendo deshabilitada la ejecución desde UI.

### 2026-08-09 — Codex — F4.3-T5

- Estado anterior: el trabajo podía conservar la definición confirmada, pero
  su salida no se vinculaba a un resultado validado y trazable.
- Objetivo: validar en el cierre las pruebas automáticas sin activar ninguna
  ejecución ni confundir una salida parcial con un suspenso.
- Hipótesis o causa demostrada: `handleJobComplete` ya reúne snapshot, salida,
  modelo, final, duración y usage; aplicar ahí lógica pura evita una segunda
  lectura y no requiere migración.
- Archivos modificados: nuevo `evaluation-results.ts` y su suite, export shared,
  handler final del Gateway, pruebas del cierre y documentación canónica.
- Resultado real: contrato persistible con `passed`, `failed` y `not_scored`;
  guarda checks y métricas observadas. Sólo valida `completed` con catálogo
  vigente. Modos manual/sandbox/traza explican por qué siguen sin puntuación.
- Pruebas: 18/18 específicas; suite completa 1.531 pasadas, 9 omitidas, 0
  fallos en 81 archivos. Lint, tipos y build: exit 0.
- Decisiones: `D-024`; no hay nota numérica ni ranking. Un corte de transporte
  no se atribuye como fallo de calidad del modelo.
- Riesgos o límites: no hay UI de resultados ni trabajos reales; el botón sigue
  deshabilitado. `evaluationValidatedAt` se genera al persistir en Gateway.
- Estado nuevo: `F4.3-T5` `done`; `LA-018` permanece pendiente.
- Siguiente paso exacto: diseñar la primera ejecución individual y cómo mostrar
  su resultado, manteniendo fuera comparaciones y runners no implementados.

### 2026-08-09 — Codex — F4.3-T6

- Estado anterior: Gateway podía guardar resultados validados, pero Laboratorio
  no tenía forma de leerlos o distinguirlos de metadata arbitraria.
- Objetivo: mostrar evidencia histórica sin habilitar ejecución ni polling.
- Hipótesis o causa demostrada: la lista existente de trabajos ya contiene toda
  la metadata necesaria; basta una lectura acotada y un parser estricto.
- Archivos modificados: nuevos `evaluation-history.ts` y su prueba,
  `Laboratory.tsx` y documentación canónica.
- Resultado real: lectura única de 100 trabajos al montar, actualización manual
  y hasta 12 resultados visibles. Se muestran estado, checks, modelo, fecha,
  duración, caracteres y tokens; metadata incoherente se descarta.
- Pruebas: 104/104 específicas; suite completa 1.535 pasadas, 9 omitidas, 0
  fallos en 82 archivos. Lint, tipos y build: exit 0.
- Decisiones: `D-025`; consultar historial no autoriza a ejecutar y no necesita
  un temporizador.
- Riesgos o límites: resultados más antiguos que los últimos 100 trabajos no
  aparecen. No hay datos reales hasta que se habilite y ejecute una evaluación.
- Estado nuevo: `F4.3-T6` `done`; `LA-018` queda ampliada.
- Siguiente paso exacto: definir política y estados de la primera ejecución
  individual antes de conectar el botón.

### 2026-08-09 — Codex — F4.3-T7

- Estado anterior: contrato, validación e historial estaban listos, pero el
  renderer nunca creaba una evaluación.
- Objetivo: abrir una primera ejecución individual con el mínimo alcance seguro.
- Archivos modificados: catálogo y pruebas, política nueva del renderer,
  Laboratorio, handler/pruebas de Studio y documentación.
- Resultado real: cuatro pruebas automáticas habilitadas; selección de
  máquina/proyecto/modelo, casilla y diálogo final. Gateway rechaza modos no
  automáticos, revalida prompt/snapshot y comprueba evaluaciones activas. El
  agente conserva el aislamiento de solo lectura implementado en T4.
- Pruebas: 50/50 específicas; suite completa 1.541 pasadas, 9 omitidas, 0
  fallos en 83 archivos. Lint, tipos y build: exit 0.
- Decisiones: `D-026`; precio desconocido sin consulta, una ejecución a la vez
  en la experiencia normal y ninguna puntuación sin validador.
- Riesgos o límites: la comprobación de concurrencia no es transaccional; un
  Gateway anterior rechazará el contrato nuevo. No se hizo ninguna llamada real.
- Estado nuevo: `F4.3-T7` `done`; `LA-018` y `LA-019` pendientes.
- Siguiente paso exacto: validación visual y, sólo si Daniel acepta el consumo,
  una ejecución de rapidez exacta con todas las piezas actualizadas.

### 2026-08-09 — Codex — F4.3-T8

- Estado anterior: se podía crear una evaluación, pero Laboratorio sólo decía
  que se siguiera en Trabajos y una cancelación no generaba resultado evaluable.
- Objetivo: seguimiento activo y cancelación coherente sin reintroducir polling.
- Archivos modificados: parser/pruebas de historial, Laboratorio, handler y
  pruebas de cancelación, y documentación canónica.
- Resultado real: panel activo validado, cancelación confirmada con solicitud no
  repetible en la sesión y cierre `not_scored` aunque no hubiera parcial.
- Pruebas: 38/38 específicas; suite completa 1.543 pasadas, 9 omitidas, 0
  fallos en 83 archivos. Lint, tipos y build: exit 0.
- Decisiones: `D-027`; cancelar no equivale a suspender y el estado sólo se
  vuelve a leer bajo acción explícita.
- Riesgos o límites: si se reinicia Studio antes del cierre, se pierde sólo la
  marca visual local de «solicitada»; Gateway conserva la petición. Hace falta
  pulsar Actualizar para observar el final.
- Estado nuevo: `F4.3-T8` `done`; `LA-018` y `LA-019` pendientes.
- Siguiente paso exacto: validación visual y prueba real opcional con las tres
  piezas actualizadas.

### 2026-08-09 — Codex — COMMIT-F4-MODELOS-LABORATORIO

- Autorización: Daniel pidió explícitamente «Commit y sigue».
- Resultado: commit local con mensaje
  `feat: incorpora modelos y laboratorio reproducible`.
- Alcance: 48 archivos de código, pruebas y documentación de `F4.1-T4/T5`,
  `F4.2-T1/T2/T3` y `F4.3-T1`–`F4.3-T8`.
- Exclusiones preservadas: `package-lock.json`, archivos de claves, demos,
  handoff copiado y `apps/gateway/tail.err`.
- Estado remoto: rama un commit por delante de origen; no se hizo push ni deploy.
- Evidencia previa al commit: 1.543 pasadas, 9 omitidas, 0 fallos; lint, tipos y
  build en verde. `git diff --cached --check` correcto.

### 2026-08-09 — Codex — F4.3-T9

- Estado anterior: completados y cancelados tenían resultado, pero un fallo del
  agente desaparecía del historial validado y un lease interrumpido no tenía
  representación en Laboratorio.
- Objetivo: hacer visibles esos finales sin atribuir calidad inexistente.
- Resultado real: fallos nuevos persistidos `not_scored`; razones específicas
  por cada final no completo; fallback visual estricto para terminales con
  snapshot válido y sin resultado.
- Pruebas: 30/30 específicas; suite completa 1.546 pasadas, 9 omitidas, 0
  fallos en 83 archivos. Lint, tipos y build: exit 0.
- Decisiones: `D-028`; estado operativo y calidad son dimensiones separadas.
- Git: cambio posterior al checkpoint `032f6f4`, todavía sin commit. Sin push ni
  deploy.
- Siguiente paso exacto: validación manual; después, agregación descriptiva con
  umbral de muestra, nunca ranking prematuro.

### 2026-08-09 — Codex — F4.3-T10

- Estado anterior: cada resultado era trazable, pero no existía resumen por
  modelo/prueba y una futura agregación podía exagerar muestras mínimas.
- Objetivo: evidencia descriptiva con umbral explícito, sin ranking.
- Resultado real: grupos por prueba/versión/modelo; tasa sólo desde 3 puntuados;
  medianas sólo sobre resultados puntuados; `not_scored` visible y excluido.
- Pruebas: 19/19 específicas; suite completa 1.548 pasadas, 9 omitidas, 0
  fallos en 83 archivos. Lint, tipos y build finales: exit 0.
- Incidencia: primer build falló por importar el agregador renderer desde
  `@luxy/shared`; ruta corregida y matriz completa repetida en verde.
- Decisiones: `D-029`; tres muestras permiten describir, no recomendar.
- Git: T9/T10 posteriores a `032f6f4`, pendientes de commit. Sin push ni deploy.
- Siguiente paso exacto: validación real y después comparación controlada.

### 2026-08-09 — Codex — F4.4-T1

- Estado anterior: las evaluaciones individuales bloqueaban cualquier segunda
  ejecución activa y no existía identidad compartida para un par comparable.
- Objetivo: definir y proteger en shared/Gateway una comparación de exactamente
  dos modelos, sin habilitar todavía el botón del Desktop.
- Resultado real: snapshot opcional con UUID de grupo e índice 0/1 inseparables;
  el segundo miembro exige un primero activo con mismo grupo, prueba, versión,
  prompt, máquina y proyecto, y un modelo exacto distinto. Las ejecuciones
  individuales conservan la barrera anterior.
- Pruebas: 32/32 específicas; suite completa 1.557 pasadas, 9 omitidas, 0
  fallos en 83 archivos. Prettier, lint, tipos y build: exit 0.
- Incidencia: typecheck detectó un acceso no estrechado a `IpcResult` en la carga
  conjunta del Laboratorio; se separaron las ramas de error y quedó validado.
- Decisión: `D-030`. La comprobación actual no es una transacción de base de
  datos; reduce estados inválidos, pero no promete exclusión frente a dos POST
  verdaderamente simultáneos.
- Git: cambio posterior a `032f6f4`, aún sin commit, push ni deploy.
- Siguiente paso exacto: F4.4-T2, orquestación Desktop del par con una sola
  confirmación y recuperación explícita si sólo se acepta uno de los miembros.

### 2026-08-09 — Codex — F4.4-T2

- Estado anterior: shared/Gateway aceptaban un par válido, pero Desktop no podía
  construirlo ni representar una aceptación parcial.
- Objetivo: orquestar la comparación desde Laboratorio sin ejecución implícita.
- Resultado real: selector individual/comparación, segundo modelo compatible,
  una confirmación que enumera ambos modelos y dos POST ordenados con UUID común.
  Si falla el primero no se envía el segundo; si falla el segundo se conserva y
  muestra el identificador del primero, sin reintento automático.
- Pruebas: 40/40 específicas; suite completa 1.561 pasadas, 9 omitidas, 0
  fallos en 84 archivos. Prettier, lint, tipos y build: exit 0.
- Riesgos o límites: cada miembro consume tokens reales sólo tras confirmar; el
  par todavía se presenta como dos trabajos/resultados separados y conserva el
  límite no transaccional de `D-030`.
- Git: T9/T10 y F4.4-T1/T2 siguen posteriores a `032f6f4`, sin commit, push ni
  deploy.
- Siguiente paso exacto: F4.4-T3, reconstruir y presentar juntos los dos
  miembros por UUID, incluidos parcial, cancelación y fallo sin puntuación falsa.

### 2026-08-09 — Codex — checkpoint y F4.4-T3

- Checkpoint: commit local `3771549 feat: añade evidencia y comparación
controlada`; 23 archivos, T9/T10 y F4.4-T1/T2. `package-lock.json`, claves,
  demos, handoff copiado y `tail.err` quedaron fuera. Sin push ni deploy.
- Objetivo posterior: reconstruir y presentar juntos los miembros de cada par.
- Resultado real: metadata de comparación validada como grupo/índice inseparable;
  agregador exclusivo por UUID e índice; panel conjunto con A/B, modelo, trabajo,
  estado y resultado. Pares parciales, duplicados, identidades mezcladas y
  terminales sin resultado quedan señalados, nunca emparejados por fecha.
- Pruebas: 49/49 específicas; suite completa 1.565 pasadas, 9 omitidas, 0
  fallos en 84 archivos. Lint, tipos y build: exit 0.
- Incidencia: los primeros fixtures nuevos omitían el snapshot completo y fueron
  rechazados por el agregador; se corrigieron los fixtures, no se relajó el
  contrato, y la matriz se repitió en verde.
- Decisión: `D-031`; una vista conjunta describe ambos miembros, no decide un
  ganador ni convierte ausencia operativa en evidencia de calidad.
- Git: F4.4-T3 queda después de `3771549`, sin commit, push ni deploy.
- Siguiente paso exacto: revisar F4.5 contra la evidencia ya persistida, cerrar
  cualquier hueco real y preparar la validación manual de comparación.

### 2026-08-09 — Codex — F4.5/F4.6 y cierre funcional de Modelos/Laboratorio

- Estado anterior: el trabajo ya persistía prompt, respuesta, snapshot, modelo,
  tokens, tiempos y validación, pero Laboratorio no reunía esa trazabilidad ni
  emitía una recomendación prudente.
- Objetivo: cerrar evidencia y recomendador sin inventar puntuaciones ni ejecutar
  modelos automáticamente.
- F4.5: cada resultado validado expone en un detalle colapsado proveedor,
  proyecto, máquina, modo, scoring, prompt completo y respuesta completa; tokens,
  duración, checks y final ya permanecían en `evaluationResult`/trabajo.
- F4.6: recomendación provisional sólo con dos modelos que tengan al menos tres
  resultados puntuados de la misma prueba y versión. Tasa validada primero;
  duración sólo desempata pruebas `timing`; feedback sólo desempata con al menos
  dos valoraciones de conversaciones completadas del mismo proyecto/modelo.
- Seguridad de producto: empates e insuficiencia muestran **Sin recomendación**;
  seleccionar la propuesta no ejecuta nada y vuelve a exigir confirmación.
- Integridad final: historial/recomendador sólo aceptan si metadata, resultado y
  prompt completo coinciden; los pares también detectan mezcla de snapshot,
  prompt, máquina o proyecto bajo un mismo UUID.
- Pruebas focalizadas: 26/26, 3 archivos. Matriz completa: 1.572 pasadas, 9
  omitidas, 0 fallos en 85 archivos; Prettier, lint, tipos y build exit 0.
- Estado: alcance v1 de Modelos/Laboratorio **100% implementado en código**;
  validación manual `LA-018/LA-019` pendiente. Manual, sandbox y tool-trace siguen
  bloqueados y etiquetados como expansión futura, no como runners disponibles.
- Git: posterior a `3771549`, sin commit, push ni deploy. Archivos ajenos fuera.
- Siguiente paso exacto: Daniel ejecuta la lista única de `LOCAL-ACTIONS.md`; si
  no aparecen incidencias, cerrar Fase 4 y pasar al siguiente bloque de Studio.

### 2026-08-09 — Codex — corrección de validación manual del selector

- Evidencia recibida: captura de Laboratorio con
  `frontend-accessible-card-v1`; la casilla y el botón estaban deshabilitados con
  el mensaje de runner/revisión pendiente.
- Causa: el formulario de ejecución mezclaba las ocho definiciones del catálogo
  con las cuatro pruebas realmente automáticas. El bloqueo era correcto, pero la
  opción no debía ofrecerse como ejecutable.
- Corrección: `EXECUTABLE_MODEL_EVALUATIONS` compartido y selector limitado a
  las cuatro automáticas. El encabezado muestra `4 ejecutables · 8 definidas` y
  la nota explica que manual/sandbox/traza siguen documentadas abajo.
- Compatibilidad: una selección antigua conservada por recarga/HMR cae a la
  primera automática; no se habilitan runners inseguros.
- Pruebas focalizadas: 15/15; suite completa 1.572 pasadas, 9 omitidas, 0
  fallos en 85 archivos; tipos, lint y build exit 0.
- Git: posterior a `3771549`, sin commit, push ni deploy.

### 2026-08-09 — Codex — despliegue autorizado del Gateway

- Motivo: el Desktop nuevo enviaba comparación A/B, pero el Worker conectado
  rechazaba el contrato con `422 cuerpo no cumple el contrato esperado`.
- Acción autorizada: `wrangler deploy` sobre el Worker existente `luxy-gateway`.
- Resultado: deploy correcto en
  `https://luxy-gateway.danielux135.workers.dev`, versión
  `b3fb5c99-5cf1-42a1-b011-f6d44b9f0730`; `/health` respondió HTTP 200.
- No se cambiaron secretos, migraciones, push ni otros Workers. El primer intento
  falló por sesión Cloudflare de otra cuenta; se renovó OAuth y el segundo intento
  publicó correctamente.
- Siguiente acción: reiniciar agente/Desktop y repetir una comparación con
  confirmación explícita.

### 2026-08-09 — Codex — UI-RESPONSE-FORMATTING

- Corrección visual: las comparaciones controladas ya no heredan el `display:flex`
  de las listas anidadas; el título, UUID y miembros ocupan ahora el ancho correcto.
- Conversaciones: las respuestas de las IA se renderizan con Markdown seguro
  (encabezados, listas, énfasis, enlaces y bloques de código), preservando el texto
  original y sus acentos sin insertar HTML no confiable.
- Verificación: typecheck correcto y 328 pruebas del Desktop pasadas.

### 2026-08-09 — Codex — INITIAL-COMMIT-ISOLATED

- Cambio solicitado: permitir que Luxy trabaje con un repositorio Git vacío y
  cree su primer commit desde **Aplicar cambios**.
- Implementación: el agente crea una rama huérfana en el worktree aislado cuando
  no existe `HEAD`; la carpeta principal no se modifica. `collectDiff` y el commit
  aprobado funcionan también sobre esa rama sin historia.
- Si el repositorio vacío ya tiene archivos sin seguimiento, se copian al worktree
  aislado (excluyendo `.git`) antes de ejecutar la tarea, para que el primer commit
  represente el estado real del proyecto.
- Seguridad: sigue siendo necesaria la aprobación explícita; no se hace commit
  automático ni push.
- Prueba: caso real de worktree vacío añadido; 71/71 pruebas de Agent pasadas.
- Incidencia posterior: el primer reinicio usó `apps/desktop/out/agent/host-entry.js`
  generado antes del cambio. Se reconstruyó el Desktop completo para propagar la
  rama huérfana al proceso que realmente arranca Luxy.

### 2026-08-09 — Codex — STUDIO-RETRY

- Incidencia observada: DeepSeek terminó trabajos con HTTP 502 después de escribir
  parte del proyecto; Trabajos no ofrecía una forma explícita de repetirlos.
- Cambio: los trabajos `failed`, `interrupted` y `cancelled` muestran **Reintentar
  trabajo**. La acción pide confirmación y crea un trabajo nuevo con la misma
  máquina, proveedor, modelo, proyecto y prompt; no reintenta automáticamente.
- Verificación: typecheck y ESLint correctos; Desktop reconstruido.

## Plantilla para próximas entradas

### 2026-08-09 — Codex — LAB-RESPONSE-TIME

- Observación: el tiempo total ya se persistía en `evaluationResult.durationMs`,
  pero Laboratorio lo mostraba sólo como un valor suelto en milisegundos.
- Cambio: historial, comparaciones A/B y evidencia muestran ahora **Tiempo de
  respuesta** con lectura humana (ms, s o min), conservando el valor exacto en
  ms.
- Límite: una evaluación en curso no tiene tiempo final; aparece como pendiente
  hasta que termine y se pulse **Actualizar**.
- Verificación: `npm run desktop:test` — 328 pruebas pasadas.

```markdown
### AAAA-MM-DD HH:MM — <IA> — <ID>

- Estado anterior:
- Objetivo:
- Hipótesis o causa demostrada:
- Archivos leídos:
- Archivos modificados:
- Comandos ejecutados:
- Resultado real:
- Pruebas:
- Decisiones:
- Riesgos o límites:
- Estado nuevo:
- Siguiente paso exacto:
```
### 2026-08-20 08:27 — Codex — UX-001

- Estado anterior: Studio mostraba pruebas, diff y eventos, pero no las llamadas
  efectivas al modelo ni la ubicación del worktree.
- Objetivo: hacer visibles ambas trazas y abrir el worktree desde Windows sin
  entregar al renderer una capacidad de abrir rutas arbitrarias.
- Hipótesis o causa demostrada: `runAgenticLoop` ya medía vueltas al modelo y
  herramientas, pero `ProviderRunResult`, el cierre del Gateway y la pantalla no
  conservaban ese dato.
- Archivos leídos: Studio, IPC/preload/main, `job-runner`, proveedor HTTP,
  `agentic-loop`, contratos shared, cierre Gateway y pruebas relacionadas.
- Archivos modificados: contrato shared, proveedor HTTP, runner, Gateway, IPC,
  main/preload, Studio y pruebas nuevas de métricas y confinamiento de rutas.
- Comandos ejecutados: Prettier; build de `@luxy/shared`; lint; dos matrices
  focalizadas de Vitest; typecheck completo.
- Resultado real: lint correcto; 105 pruebas focalizadas correctas. La primera
  matriz de 119 tuvo 118 correctas y 1 fallo porque el enlace temporal de
  dependencias cargó el build compartido anterior. Typecheck no cerró por ese
  mismo build, ausencia de `@cloudflare/workers-types` y un error previo de
  `Config.tsx` con `other`.
- Pruebas: se añadieron cobertura de `callMetrics`, parser de Studio, contrato
  IPC y rechazo de una carpeta externa.
- Decisiones: `modelCalls` es el número exacto de peticiones HTTP al modelo;
  `toolCalls` se presenta aparte. Los trabajos históricos quedan sin cifra. Main
  usa `realpath` y confina la carpeta bajo la raíz local antes de usar el
  Explorador.
- Riesgos o límites: requiere reconstruir y desplegar Gateway autorizado para
  ver la métrica en una tarea nueva. El worktree temporal quedó con un enlace de
  dependencias que el entorno no permitió retirar; está ignorado por Git.
- Estado nuevo: bloqueado sólo para la matriz completa e integración, sin commit,
  push, deploy, migración ni llamadas reales.
- Siguiente paso exacto: seguir `LA-020`.

### 2026-08-20 08:36 — Codex — UX-001, cierre de validación

- Estado anterior: la matriz completa estaba bloqueada por un enlace temporal a
  dependencias del checkout principal.
- Acción: se retiró sólo ese junction confirmado y se instalaron dependencias
  del worktree con `npm ci --ignore-scripts`.
- Comandos ejecutados: `npm.cmd run typecheck`, `npm.cmd test` y `npm.cmd run build`.
- Resultado real: typecheck y build correctos; Vitest 1.574 pasadas, 14 omitidas,
  0 fallos, 87 archivos, 59,37 s.
- Estado nuevo: UX-001 verificado y listo para el commit autorizado. No hubo
  llamadas reales, migración, despliegue ni push.
- Siguiente paso exacto: crear el commit y arrancar Desktop desde esta rama.

### 2026-08-20 08:38 — Codex — UX-001, entrega local

- Acción autorizada: commit local creado como `feat: muestra llamadas y worktree en Studio`.
- Reinicio: se cerró el árbol Electron que ejecutaba otra rama y Studio se abrió
  desde `luxy/ux-001-detalle-trabajo`.
- Incidencia de arranque: `ELECTRON_RUN_AS_NODE=1` hacía que Electron iniciara
  como Node; se eliminó sólo de la sesión de lanzamiento. El proceso principal,
  renderer, GPU y utility process de la rama nueva quedaron vivos.
- No se hizo push ni despliegue. La métrica de llamadas requerirá actualizar el
  Gateway antes de poder guardarse en trabajos nuevos de producción.

### 2026-08-10 10:08 — Codex — F4.8-T2-DEPLOY

- Estado anterior: Desktop reconstruido y ejecutándose desde el worktree; el
  Gateway desplegado todavía no aceptaba `resumeJobId`.
- Objetivo: publicar el contrato de reanudación necesario para reutilizar el
  mismo worktree tras un fallo del proveedor.
- Hipótesis o causa demostrada: un Desktop nuevo contra un Gateway antiguo
  perdería `resumeJobId` y crearía otro worktree.
- Archivos leídos: `PROJECT-STATE.md`, `CURRENT-TASK.md`, `LOCAL-ACTIONS.md`,
  `apps/gateway/package.json`, `apps/gateway/src/handlers/studio.ts` y
  `packages/shared/src/schemas.ts`.
- Archivos modificados: sólo documentación de continuidad.
- Comandos ejecutados: build de Gateway, Vitest sobre Gateway/shared, dry-run
  de Wrangler, despliegue autorizado y petición pública a `/health`.
- Resultado real: Worker `luxy-gateway` desplegado en la versión
  `33da28e0-4a72-4c0b-8661-50d1cc838dec`; `/health` respondió HTTP 200 con
  `configured: true`.
- Pruebas: build exit 0; 37 archivos y 641 pruebas pasadas, 0 fallos; dry-run
  final exit 0.
- Decisiones: conservar variables remotas con `--keep-vars`, el flag
  `nodejs_compat` y el cron de un minuto; sin migraciones ni cambios de secretos.
- Riesgos o límites: falta la validación manual de `LA-022`; no existe todavía
  una prueba Gateway específica de `resumeJobId`.
- Estado nuevo: Gateway y Desktop actualizados; validación manual pendiente.
- Siguiente paso exacto: repetir `LUX-L9CC` desde **Reintentar trabajo** y
  comprobar que conserva ruta y rama sin crear otro worktree.

### 2026-08-10 10:25 — Codex — F4.8-T2-TIMEOUT-RESTART

- Estado anterior: Gateway desplegado con `resumeJobId`; Desktop podía seguir
  usando una instancia anterior del agente con timeout fijo de cinco minutos.
- Objetivo: cerrar la instancia anterior, reconstruir el agente/Proveedor y
  Desktop desde `lux-auto-init-git`, actualizar el Gateway y arrancar la copia
  nueva.
- Archivos modificados: ninguno por esta acción; se usó el código existente del
  worktree. Se actualiza sólo esta documentación de continuidad.
- Comandos ejecutados: `npm.cmd run build`; despliegue Wrangler conservando
  variables remotas; smoke check de `/health`; arranque del binario Electron con
  `apps/desktop` del worktree.
- Resultado real: build exit 0; Worker `luxy-gateway` desplegado como versión
  `a5cb5ba8-34d9-4cca-85ba-e02f95e3942f`; `/health` respondió HTTP 200 y
  `configured: true`; Desktop abierto y apuntando a `lux-auto-init-git`.
- Pruebas: `git diff --check` sin errores; no se inició ningún trabajo real.
- Decisiones: no pulsar **Reintentar** hasta este despliegue; sin migraciones,
  commit ni push.
- Riesgos o límites: queda pendiente la validación manual de que MiniMax supera
  cinco minutos y de que el reintento conserva exactamente la misma ruta y rama.
- Estado nuevo: Desktop, agente y Gateway actualizados y ejecutándose.
- Siguiente paso exacto: ejecutar manualmente `LA-022` sobre `LUX-L9CC`.

### 2026-08-11 — Codex — OPS-BAT-LAUNCHERS

- Objetivo: ofrecer reconstrucción y arranque de Luxy por doble clic, siempre
  relativos a la raíz del worktree operativo.
- Archivos modificados: `rebuild-luxy.bat`, `start-luxy.bat`,
  `rebuild-and-start-luxy.bat` y `README.md`.
- Resultado real: los lanzadores usan `%~dp0`, limpian `ELECTRON_RUN_AS_NODE`,
  comprueban la salida de Desktop y localizan Electron en el worktree con
  fallback a la instalación principal.
- Pruebas: `rebuild-luxy.bat no-pause` ejecutado con exit 0; build completo
  correcto. `git diff --check` sin errores.
- Siguiente paso exacto: usar `rebuild-and-start-luxy.bat` tras cambios y
  `start-luxy.bat` para abrir sin reconstruir.

### 2026-08-11 — Codex — UI-LAB-LAYOUT

- Estado anterior: en Laboratorio, la lista horizontal genérica repartía título,
  métricas, checks y evidencia como columnas equivalentes. Los títulos quedaban
  reducidos a pocas letras por línea y se superponían con el resto del contenido.
- Objetivo: ordenar resultados guardados y comparaciones sin perder información
  y mantener una lectura coherente en ventanas estrechas.
- Archivos modificados: `apps/desktop/src/renderer/pages/Laboratory.tsx` y
  `apps/desktop/src/renderer/styles.css`.
- Resultado real: cada resultado tiene cabecera, etiquetas, métricas, motivo y
  evidencia en filas propias; las métricas envuelven sin invadir el título. Los
  miembros A/B usan una cuadrícula de dos columnas que cae a una sola columna
  por debajo de 920 px.
- Pruebas: Prettier aplicado; lint y typecheck exit 0; Desktop 328/328; build
  completo exit 0; `git diff --check` sin errores.
- Estado nuevo: implementado, verificado automáticamente, Desktop reconstruido y
  reiniciado desde `lux-auto-init-git`.
- Siguiente paso exacto: confirmación visual manual en Resultados guardados y
  Comparaciones controladas.

### 2026-08-11 — Codex — UI-LAB-LAYOUT-FOLLOWUP

- Evidencia manual: la primera corrección aún alineaba las etiquetas de cada
  modelo hacia el centro de la columna izquierda, distinta de la composición de
  Evidencia descriptiva indicada como referencia.
- Corrección: estados y validación quedan justo debajo del nombre del modelo y
  alineados al mismo borde izquierdo; las métricas conservan su columna derecha.
- Archivos modificados: `apps/desktop/src/renderer/styles.css`.
- Pruebas: Prettier check, lint y build de Desktop exit 0; `git diff --check`
  sin errores. Desktop reiniciado.
- Siguiente paso exacto: confirmación visual manual con la segunda captura como
  referencia.

### 2026-08-11 10:01 — Codex — F4.3-T11

- Estado anterior: Modelos persistía una lectura real de 23 identificadores,
  pero Laboratorio y Conversaciones seguían usando el catálogo estático de 22.
- Objetivo: hacer canónico el snapshot detectado en todas las pantallas que
  ofrecen modelos y representar correctamente el cierre fallido.
- Causa demostrada: `Laboratory.tsx` y `Conversations.tsx` llamaban directamente
  a `buildDefaultCatalog`; Laboratorio sólo releía al montar o al pulsar
  Actualizar; la vista llamaba «Tiempo de respuesta» a `durationMs` incluso con
  `responseOutcome: failed`. Los logs de `LUX-LR82` y `LUX-TQC3` confirmaron dos
  503 contra los Qwen retirados.
- Archivos modificados: catálogo, familias/proveedores, pruebas de registry,
  router, Telegram y agente; `useCatalog.ts`; páginas Modelos, Laboratorio,
  Conversaciones y Setup; documentación de continuidad y modelos.
- Comandos ejecutados: pruebas focalizadas, Prettier y `npm.cmd run check`.
- Resultado real: el snapshot persistido sustituye la lista operativa; Hy3 se
  agrupa y ejecuta como Hunyuan; el embedding queda visible pero no ejecutable;
  Laboratorio refresca cada 5 s sólo mientras haya activos y etiqueta la
  duración según el final. «Par completo» pasa a «Par terminado».
- Pruebas: lint, typecheck y build correctos; 85 archivos, 1.581 pasadas, 9
  omitidas, 0 fallos.
- Decisiones: un identificador desconocido se conserva visible con capacidades
  vacías; nunca hereda chat o herramientas por heurística.
- Riesgos o límites: falta reiniciar y confirmar visualmente; no se realizó una
  llamada real, deploy, commit ni push.
- Estado nuevo: implementado y verificado automáticamente.
- Siguiente paso exacto: reiniciar Luxy y comprobar selectores y refresco.

### 2026-08-11 10:44 — Codex — OPS-GATEWAY-BAT

- Objetivo: permitir que Daniel despliegue manualmente el contrato actualizado
  del Gateway sin migraciones ni edición de secretos.
- Archivos modificados: `deploy-gateway.bat`, `README.md`, `LOCAL-ACTIONS.md` y
  documentación de continuidad.
- Resultado real: el lanzador compila Shared/Gateway, crea una configuración
  TOML temporal desde la plantilla, ejecuta dry-run, exige escribir `DESPLEGAR`,
  publica con `--keep-vars` y elimina la configuración temporal.
- Pruebas: el primer `check` falló porque Wrangler no interpreta `.toml.example`
  como configuración; se corrigió. Segundo `check`: exit 0, bundle 468,11 KiB,
  gzip 105,68 KiB; no se desplegó nada y el TOML temporal fue eliminado.
- Estado nuevo: lanzador manual verificado sin publicación.
- Siguiente paso exacto: Daniel ejecuta `deploy-gateway.bat` y confirma
  escribiendo `DESPLEGAR`.

### 2026-08-11 10:47 — Codex — OPS-MAIN-LAUNCHERS

- Objetivo: concentrar los accesos manuales en `Desktop\Luxy` sin volver a
  ejecutar por error el checkout distinto del que usa la aplicación.
- Resultado real: los cuatro `.bat` de la carpeta principal delegan en
  `%LOCALAPPDATA%\Luxy\worktrees\lux-auto-init-git` y fallan con un mensaje
  claro si ese worktree no existe.
- Pruebas: `deploy-gateway.bat check` lanzado desde la carpeta principal; exit
  0, compilación y dry-run correctos, sin despliegue.
- Siguiente paso exacto: usar desde ahora únicamente los accesos de la carpeta
  principal.

### 2026-08-11 11:09 — Codex — UI-LAB-CONFIRM

- Evidencia manual: después de aceptar una evaluación, toda la ventana de
  Electron dejaba de responder a desplegables, incluso fuera de Laboratorio.
- Causa probable acotada: Laboratorio usaba `window.confirm()`, diálogo
  bloqueante del renderer; no había ningún `disabled` global ni capa CSS activa.
- Corrección: ejecución y cancelación usan ahora un diálogo React propio que se
  desmonta antes de crear/cancelar el trabajo; se eliminaron los dos
  `window.confirm()` de Laboratorio.
- Archivos modificados: `Laboratory.tsx` y `styles.css`.
- Pruebas: 20 focalizadas pasadas; matriz completa con lint, typecheck y build
  correctos; 1.581 pasadas, 9 omitidas y 0 fallos.
- Riesgo: falta confirmación manual porque las pruebas no reproducen la gestión
  de foco de una ventana Electron real.
- Siguiente paso exacto: reconstruir/reiniciar y ejecutar una prueba; al cerrar
  el diálogo y terminar, comprobar desplegables en Laboratorio y Trabajos.
