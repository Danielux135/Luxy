# Luxy — resultados de comprobación

### 2026-09-02 — Windows 11 (equipo `oscar`) — VAULT-ROLEPLAY-001

- **`npm run lint`, `npm run typecheck`, `npm test` y `npm run build`: los
  cuatro exit 0.** Suite: **122 archivos, 2.127 superadas, 9 omitidas, 0
  fallos** (antes: 2.116).
- Tres pruebas existentes se reescribieron porque afirmaban sobre el texto
  literal del prompt anterior, que ha cambiado a proposito. No se debilito
  ninguna: dos ganaron aserciones.
- Pruebas nuevas: el canon cubre hechos y no reacciones; el bloque global dice
  «puede» y nunca «debe» (fija que no impone tono); no se ofrece una imagen que
  nadie ha pedido; el prompt del generador se pide en ingles; se prohiben la
  segunda persona y las camaras; el estilo sigue al modelo del personaje; el
  negativo cubre `2girls`, `camera` y `selfie`; el negativo viaja en su campo y
  se acota al tope de la API, tambien en video; el pie de foto es opcional y
  acotado.
- Sin red ni creditos: `xavira.test.ts` sigue mockeando el transporte y su
  prueba «ninguna prueba de este archivo usa fetch de verdad» sigue verde.
- **No verificado en pantalla.** El compositor levantado a `useVault` no tiene
  prueba automatica: el renderer no tiene banco de pruebas de componentes, y el
  fallo era de colocacion del estado, que ninguna prueba unitaria habria
  detectado. Y un cambio de prompt fija lo que se envia, nunca como responde un
  proveedor concreto. Ver `LA-037`.

### 2026-09-02 — Windows 11 (equipo `oscar`) — BUG-VAULT-CHARACTER-001

- **`npm run lint`, `npm run typecheck`, `npm test` y `npm run build`: los
  cuatro exit 0.** Suite: **122 archivos, 2.116 superadas, 9 omitidas, 0
  fallos** (antes: 120 archivos, 2.093 superadas).
- Pruebas nuevas: seis en `vault-image-capability.test.ts` (orden de los
  motivos: un personaje desconocido se dice antes que una clave que falta,
  porque arreglar la clave no arreglaria nada); cinco en `xavira.test.ts`
  (`character_not_found` explicado y sin JSON crudo, `request_id` conservado,
  moderacion mostrada tal cual, codigo desconocido que conserva el texto
  original, cuerpo que no es JSON); una en `ipc.test.ts` (el alta manual exige
  UUID y rechaza justo lo que se pego aquel dia).
- Sin red y sin creditos: `xavira.test.ts` sigue mockeando el transporte y su
  prueba «ninguna prueba de este archivo usa fetch de verdad» sigue en verde.
- **No verificado en pantalla.** El aviso nuevo de Vault.tsx y los tres mensajes
  de `handlers.ts` estan implementados y cubiertos por la regla que usan, pero
  la aplicacion no se ha reconstruido ni abierto: ver `LA-036`.

### 2026-09-02 — Windows 11 (equipo `oscar`) — F9.29

- Primera focalizada: **118 superadas, 1 fallida**. La aserción detectó que el
  nuevo `system` conversacional aún escribía «asistente técnico» dentro de una
  negación. Se quitó la identidad por completo en vez de debilitar la prueba.
- Focalizada final (`vault-prompt`, `vault-image-request`, `conversation-job`,
  `providers`): **120/120**, sin red ni llamadas reales.
- **`npm run check`: exit 0.** Lint, typecheck, suite y build en verde; suite:
  **120 archivos, 2.093 superadas, 9 omitidas, 0 fallos**.
- Pruebas nuevas: contrato adulto y canon de escena; petición de imagen con
  respuesta en personaje y bloque obligatorio; wrapper privado que no convierte
  las directivas en datos; propagación de `interactionMode`; selección separada
  de los `system` conversacional y técnico en HTTP.
- No se invocó Claude, Codex, ninguna conexión HTTP ni Xavira. La conducta real
  queda pendiente de `LA-034`.

### 2026-09-02 — estado consolidado de la sesión

- **`npm run check`: exit 0.** Suite: **120 archivos, 2.088 superadas, 9
  omitidas, 0 fallos**.
- Archivos de prueba nuevos en la sesión: `account-manager.test.ts` (25),
  `media-sync.test.ts` (9), `character-store.test.ts` (11),
  `vault-image-request.test.ts` (20). Más las ampliaciones de
  `conversation-store.test.ts`, `vault-prompt.test.ts` y `xavira.test.ts`.
- **Verificado contra servicios reales:**
  - `0007` aplicada: cinco tablas `vault_*` con `rowsecurity = true`;
  - `0008` aplicada: bucket `vault-media` con `public = false`;
  - gateway desplegado y respondiendo: `/health` → 200 `configured: true`;
  - `POST /api/vault/login/start` con correo inexistente → 200 con señuelo, lo
    que demuestra que el gateway habla con el Supabase donde están las tablas;
  - vincular la bóveda local a una cuenta e iniciar sesión, en la aplicación;
  - crear un personaje y generar su avatar en la API de generación.
- **NO verificado, y es lo único de seguridad que queda:** que un usuario no
  pueda leer los registros de otro (`withVaultAuth`). Necesita una segunda
  cuenta real. Tampoco se ha sincronizado entre dos equipos. Es `LA-033`.
- Las pruebas siguen sin gastar créditos ni llamar a ninguna API: todo con
  dobles. Las llamadas reales las hizo Daniel desde la aplicación.

### 2026-09-02 — segunda llamada real: la API retira las fotos de referencia

- `POST /v1/characters` devolvió **400 `reference_image_unsupported`**:
  *«Reference-image upload has been removed. Create characters by passing
  `traits` (closed-enum trait combo)»*. El campo no existe; no es un problema de
  formato.
- Documentación real encontrada en **`https://xavira.ai/docs`** (200);
  `https://api.xavira.ai/docs` devuelve 404. De ahí sale la tabla de rasgos y el
  resto del contrato de creación de personaje.
- Retirado el camino de la referencia; el personaje se define por el enum
  cerrado. **`npm run check`: exit 0 — 119 archivos, 2.067 superadas, 9
  omitidas.**
- **Sigue sin saberse**: si `images:generate` exige `model_id`, y cómo se
  comporta la generación real. Se sabrá en la siguiente llamada.

### 2026-09-02 — primera llamada real a la API de generación

- **Falló, y era información valiosa.** `POST /v1/characters` devolvió **400
  `invalid_model_id`**: exige un `model_id` que el adaptador no enviaba, y la
  documentación pública de la que salió el contrato no lo mencionaba. Valores
  que la propia API nombró: `realistic-sharp-v1`, `anime-pure-v1`; los modelos
  de vídeo no valen para crear un personaje; `anime-v1` y `anime-sharp-v1` son
  alias antiguos.
- Corregido y cubierto con tres pruebas. **`npm run check`: exit 0 — 120
  archivos, 2.075 superadas, 9 omitidas.**
- **Sigue sin saberse**: si `images:generate` también exige `model_id`, y si el
  `data:` URI de la imagen de referencia se acepta en `reference_image_url`. Se
  sabrá en la siguiente llamada real.

### 2026-09-02 — Windows 11 (equipo `oscar`) — F9.23 y arreglo de la clave de medios

- **`npm run check`: exit 0.** Suite: **120 archivos, 2.072 superadas, 9
  omitidas, 0 fallos**.
- Siete pruebas nuevas del adaptador para la imagen de referencia. La que
  sostiene la decisión: lo que viaja **empieza por `data:image/…;base64,` y no
  contiene `http`** — no hay ninguna dirección desde la que descargarla. También
  se prueba que sin referencia el campo no se manda, que la de en línea manda
  sobre una URL pública, que una imagen de más de 6 MB se rechaza **antes de
  tocar la red**, que lo que no es una imagen se rechaza, y que la conversión no
  desborda la pila con archivos grandes.
- Cinco pruebas de `parseTraits`, ahora en su propio módulo.
- **Verificado a mano por Daniel en la aplicación real**: vincular la bóveda
  local a una cuenta e iniciar sesión funcionan **contra el gateway y Supabase
  de verdad** (log: `boveda local vinculada a una cuenta`, `sesion de boveda
  iniciada { method: 'password' }`). Es la primera ejecución real del bloque de
  cuentas, hasta ahora sólo probado con dobles.
- **Sigue sin verificarse**: cualquier llamada a la API de generación, incluida
  la creación de personaje con imagen de referencia.

### 2026-09-02 — Windows 11 (equipo `oscar`) — F9.22

- **`npm run check`: exit 0.** Suite: **119 archivos, 2.060 superadas, 9
  omitidas, 0 fallos**. Studio reconstruido (`npm run build`, exit 0).
- Archivo nuevo: `vault-image-request.test.ts` (14). Todo puro: se prueba cada
  caso límite **sin gastar una generación**, que es justo lo caro de este paso.
- Casos cubiertos: sin bloque no hay petición; el bloque se separa y **no acaba
  guardado como texto del turno**; `kind` por defecto es imagen; se tolera una
  cerca Markdown; un bloque cortado se distingue de uno que no existía; un
  bloque inválido no se traga la respuesta; un prompt vacío o un `kind`
  inventado se rechazan; y los dos bloques —imagen y memoria— conviven y se
  separan sin dejar rastro técnico.
- También se prueba que la instrucción **no se envía** cuando no se puede
  generar.

### 2026-09-02 — comprobaciones contra servicios reales

- **Gateway desplegado y verificado**: `/health` → 200 con `configured: true`.
  `POST /api/vault/login/start` con un correo inexistente → 200 con la respuesta
  señuelo, lo que prueba tres cosas a la vez: las rutas nuevas están
  desplegadas, el gateway **habla con el Supabase donde están las tablas** (si
  `0007` no estuviera allí, `getVaultUserByEmail` habría lanzado y habría dado
  500), y el código de `F9.19` está vivo (la respuesta trae la puerta de
  recuperación con `t=1, m=8192`). No se creó ninguna cuenta.
- **API de generación, sin gastar créditos**: `GET /v1/generations/<uuid>` sin
  credenciales → **401**, no 404. La URL base existe, la ruta de sondeo existe y
  exige `Authorization`. Su sobre de error es
  `{error:{code,message,request_id}}`, compatible con lo que hace el adaptador,
  que se queda con el texto y decide por el código HTTP.
- **Lo que sigue sin verificarse**: los nombres de campo del cuerpo de
  `POST /v1/images:generate`, la rama 201-con-`output_url` frente a
  202-con-`poll_url`, y la creación de personaje. Eso sólo lo confirma —o lo
  desmiente— una generación real.

### 2026-09-01 — Windows 11 (equipo `oscar`) — F9.20 y F9.16 remoto

- **`npm run check`: exit 0.** Suite: **118 archivos, 2.046 superadas, 9
  omitidas, 0 fallos**.
- Archivo nuevo: `media-sync.test.ts` (9). Siete pruebas más de instrucciones en
  `conversation-store.test.ts`.
- La prueba que sostiene la sincronización de medios: un archivo guardado en un
  equipo se sube, se baja en otro almacén con la misma llave maestra y **se
  descifra con los mismos bytes**. Contar subidas y bajadas no demostraría nada.
- También se prueba: que lo que viaja no lleva el nombre, el prompt ni el
  `mimeType` en claro; que los bytes suben **antes** que el registro; que no se
  vuelve a subir lo ya subido; que un archivo por encima del tope se salta sin
  impedir que suba el resto; que un registro de otra bóveda no entra en el
  índice; que un 401 olvida la sesión; y que si falta el bucket en Supabase el
  error lo dice en vez de hablar de un 404 genérico.
- De instrucciones: valen las del último turno que las llevaba, la última gana,
  una cadena vacía las borra y se distingue de no tocarlas, no salen en claro en
  el `.jsonl`, y con la bóveda cerrada no se pueden leer.
- **Nada ejecutado contra el gateway real ni contra Supabase Storage.** La
  migración `0008` no está aplicada y `/api/vault/*` sigue sin desplegar.
- Nota de entorno: Daniel aplicó `0007` durante esta sesión. La comprobación de
  RLS devolvió las cinco tablas `vault_*` con `rowsecurity = true`.

### 2026-09-01 — Windows 11 (equipo `oscar`) — F9.19 (recuperación desde otro equipo)

- **`npm run check`: exit 0.** Suite: **117 archivos, 2.030 superadas, 9
  omitidas, 0 fallos**.
- Quince pruebas nuevas. La que sostiene la función: registrar en un equipo,
  entrar en otro **con la clave de recuperación y nada más**, y obtener la misma
  subclave (`subkeyFor('conversation', 'c1')`) y el mismo `vaultId`.
- También se prueba, con gateway falso: que la clave se acepta escrita en
  minúsculas y con espacios; que la de otra cuenta no abre; que el equipo
  recuperado **no** guarda envoltura de contraseña, porque no se conoce; que se
  puede elegir contraseña nueva usando la clave como prueba, y que después entra
  por la puerta normal desde un tercer equipo; que **cambiar la contraseña no
  invalida la clave de recuperación**; y que el sobre de recuperación no se
  puede hacer pasar por el de contraseña ni al revés.
- **Nada ejecutado contra Supabase ni contra el gateway real.** Las seis
  columnas nuevas de `0007` sólo se han validado de forma estructural, como el
  resto de la migración.

### 2026-09-01 — Windows 11 (equipo `oscar`) — F9.18 (cuenta y bóveda unidas)

- **`npm run check`: exit 0.** Suite: **117 archivos, 2.015 superadas, 9
  omitidas, 0 fallos**.
- Archivo nuevo: `account-manager.test.ts` (18). Reescritos o ajustados al
  contrato nuevo: `sync.test.ts`, `account-client.test.ts`, `useVault.test.ts`.
- La prueba que sostiene el bloque entero: registrar en un equipo y entrar en
  otro produce **la misma subclave** (`subkeyFor('conversation', 'c1')`) y el
  mismo `vaultId`. Sin esa igualdad, lo escrito en un equipo sería ilegible en
  el otro.
- También se prueba, con gateway falso: que la caché local abre **sin volver a
  llamar al servidor**, que la sesión sobrevive a reiniciar la aplicación y
  caduca sola, que salir revoca en el servidor y cierra la bóveda, que un 401
  olvida la sesión, que vincular una bóveda local **no recifra nada** y exige la
  contraseña que la abre, y que un equipo no puede acabar guardando la bóveda de
  dos cuentas.
- **Nada ejecutado contra Supabase ni contra el gateway real.** Todo con
  `fetch` falso. La migración `0007` sigue sin aplicarse y `/api/vault/*` sigue
  sin desplegar: eso es `LA-031`.
- **No confirmado a mano**: no se ha abierto Studio para registrar una cuenta ni
  para entrar desde un segundo ordenador.

### 2026-09-01 — Windows 11 (equipo `oscar`) — F9.10

- Tres archivos de prueba nuevos: `account.test.ts` (10), la ampliación de
  `handlers/vault.test.ts` (16 en total), `account-client.test.ts` (8).
- **`npm run check`: exit 0.** Suite: **116 archivos, 1.997 superadas, 9
  omitidas, 0 fallos**.
- Todo el gateway se prueba con **cliente y gateway falsos**. Nada se ha
  ejecutado contra un Supabase real; la migración `0007` no está aplicada.

### 2026-09-01 — Windows 11 (equipo `oscar`) — medios en la interfaz

- **`npm run check`: exit 0.** Suite: **111 archivos, 1.941 superadas, 9
  omitidas, 0 fallos**.
- **No confirmado manualmente**: no se ha adjuntado ni visualizado un medio real
  desde la aplicación.

### 2026-09-01 — Windows 11 (equipo `oscar`) — F9.16 (parte local)

- `npx vitest run apps/desktop/src/main/vault/media-store.test.ts`: **17/17**.
- **`npm run check`: exit 0.** Suite: **111 archivos, 1.941 superadas, 9
  omitidas, 0 fallos**.
- Medido en las pruebas: 10.000 bytes de contenido ocupan menos de 11.024 una
  vez cifrados, es decir cabecera y etiqueta, no un porcentaje.

### 2026-09-01 — Windows 11 (equipo `oscar`) — F9.6 y F9.15

- **`npm run check`: exit 0.** Suite: **110 archivos, 1.924 superadas, 9
  omitidas, 0 fallos**.
- `migrations.test.ts` pasa a 35 pruebas: las tres tablas nuevas entran en las
  listas de tablas exigidas y de RLS, más tres invariantes propias de la bóveda
  (sin columnas en claro, RLS forzado, enum de trabajos intacto).
- **La migración 0007 NO se ha ejecutado contra ningún Postgres.** Validación
  estructural únicamente, como el resto (riesgo conocido nº3).

### 2026-09-01 — Windows 11 (equipo `oscar`) — F9.8

- **`npm run check`: exit 0.** Suite: **109 archivos, 1.910 superadas, 9
  omitidas, 0 fallos**.
- Cambios de endurecimiento no cubiertos por pruebas automáticas, porque son
  configuración de Electron: `devTools: isDev` y la ruta de volcados. Se
  verifican abriendo la aplicación empaquetada y comprobando que Ctrl+Shift+I
  no abre nada.

### 2026-09-01 — Windows 11 (equipo `oscar`) — F9.17

- `npx vitest run apps/agent/src/providers/xavira.test.ts`: **22/22**.
  Ninguna petición real: el transporte se inyecta y hay una prueba que espía
  `globalThis.fetch` para confirmar que no se usa.
- **`npm run check`: exit 0.** Suite: **108 archivos, 1.905 superadas, 9
  omitidas, 0 fallos**.
- **No verificado contra la API real.** El contrato procede de la documentación
  pública consultada el 2026-09-01, sin registro ni credenciales.

### 2026-09-01 — Windows 11 (equipo `oscar`) — F9.14 confirmado + relleno

- **Confirmado manualmente por Daniel** sobre el archivo real de una
  conversación de dos intercambios: sin texto, sin título, sin proveedor, sin
  modelo, y los cuatro nonces distintos.
- Fuga medida en ese archivo antes del arreglo: 204 / 223 / 200 / 306 bytes
  cifrados, que corresponden a ~38 / ~57 / ~34 / ~140 caracteres.
- `npx vitest run packages/vault-crypto`: **91/91**.
- **`npm run check`: exit 0.** Suite: **107 archivos, 1.883 superadas, 9
  omitidas, 0 fallos**.

### 2026-09-01 — Windows 11 (equipo `oscar`) — F9.14

- `npx vitest run apps/desktop/src/main/vault/conversation-store.test.ts`:
  **14/14**.
- **`npm run check`: exit 0.** Suite: **106 archivos, 1.874 superadas, 9
  omitidas, 0 fallos**.
- **No confirmado manualmente**: no se ha ejecutado una conversación privada
  real contra ningún proveedor.

### 2026-09-01 — Windows 11 (equipo `oscar`) — F9.13 confirmado + bloqueo configurable

- **Confirmado manualmente por Daniel**: la pantalla Privado se ve y funciona.
  Arrancado con `npm.cmd run desktop:dev` (en PowerShell `npm` a secas falla).
- `npx vitest run apps/desktop/src/main/vault`: **62/62**.
- **`npm run check`: exit 0.** Suite: **105 archivos, 1.860 superadas, 9
  omitidas, 0 fallos**.

### 2026-09-01 — Windows 11 (equipo `oscar`) — F9.13

- `npx vitest run apps/desktop/src/renderer/useVault.test.ts`: **10/10**.
- **`npm run check`: exit 0.** Lint, typecheck y build correctos.
  Suite: **105 archivos, 1.855 superadas, 9 omitidas, 0 fallos**.
- **No confirmado manualmente**: no se ha arrancado Luxy para ver la pantalla.
  Lo verificado es la lógica y el contrato, no el aspecto ni el flujo de clics.

### 2026-09-01 — Windows 11 (equipo `oscar`) — F9.5

- `npx vitest run apps/agent/src/local-turn.test.ts`: **12/12**.
  Incluye la prueba que espía `globalThis.fetch` durante un turno completo y
  verifica cero llamadas de red.
- **`npm run check`: exit 0.** Lint, typecheck y build correctos.
  Suite: **104 archivos, 1.845 superadas, 9 omitidas, 0 fallos**.
- Ninguna API real, ningún token gastado: el proveedor de las pruebas es falso.

### 2026-09-01 — Windows 11 (equipo `oscar`) — F9.4

- `npx vitest run packages/vault-crypto/src/blob.test.ts`: **11/11**.
- `npx vitest run apps/desktop/src/main/vault/private-store.test.ts`: **20/20**.
- **`npm run check`: exit 0.** Lint, typecheck y build correctos.
  Suite: **103 archivos, 1.833 superadas, 9 omitidas, 0 fallos**, 47,80 s.
- Medición del sobre binario: 100.000 bytes → **100.029** cifrados (13 de
  cabecera + 16 de etiqueta), frente a los ~137.000 que costaría en base64.

### 2026-09-01 — Windows 11 (equipo `oscar`) — F9.3

- `npx vitest run apps/desktop/src/main/vault`: **38/38**, 18,07 s.
  Antes de hacer inyectable el coste de Argon2: 37 pruebas en **252,36 s**, con
  un caso en 18.244 ms sobre un límite de 20.000 ms. Habría sido intermitente
  en un equipo más lento.
- **`npm run check`: exit 0.** Lint, typecheck y build correctos.
  Suite: **101 archivos, 1.802 superadas, 9 omitidas, 0 fallos**, 58,42 s.

### 2026-09-01 — Windows 11 (equipo `oscar`) — F9.2

- Rama `luxy/f9-1-vault-crypto`, sobre `524a8da`.
- `npx vitest run packages/shared/src/vault.test.ts`: **35/35**.
- **`npm run check`: exit 0.** Lint, typecheck y build correctos.
  Suite: **100 archivos, 1.764 superadas, 9 omitidas, 0 fallos**.
- Sin llamadas a APIs reales. La documentación de Xavira se consultó como página
  pública, sin registro ni credenciales.

### 2026-09-01 — Windows 11 (equipo `oscar`) — F9.1

- Rama aislada `luxy/f9-1-vault-crypto`, base `main` @ `00a9cc1`.
- `npx vitest run packages/vault-crypto`: **71 pruebas, 71 superadas**, 11,0 s.
  - `envelope.test.ts` 22 · `master-key.test.ts` 36 · `recipient.test.ts` 13.
  - La prueba `los parametros reales funcionan de extremo a extremo` tarda
    ~5,8 s a propósito: es la única que ejercita los parámetros de Argon2 que se
    envían de verdad. El resto usa el mínimo aceptado.
- `npx tsc -b tsconfig.build.json`: exit 0.
- **`npm run check`: exit 0.**
  - Lint: correcto.
  - Typecheck: correcto.
  - Suite: **99 archivos, 1.729 superadas, 9 omitidas, 0 fallos**.
  - Build: los seis paquetes anteriores más `vault-crypto`; `dist/` emitido con
    declaraciones y mapas.
- Medición de Argon2id con `@noble/hashes` en este equipo, usada para fijar
  `ARGON2_PARAMS` (ver `D-040`): 256 MiB/t=3 → 12.827 ms · 128 MiB/t=3 →
  5.643 ms · **64 MiB/t=3 → 2.670 ms** · 32 MiB/t=3 → 1.321 ms.
- Ninguna llamada a API real, ninguna dependencia nueva, ningún commit.

### 2026-09-01 — Windows 11 (equipo `oscar`) — BUG-GIT-IDENTITY-001

- Línea canónica: `main` @ `00a9cc1`, clon nuevo **sin `node_modules`**.
- `npm install`: exit 0. Aviso: 6 paquetes con scripts de instalación sin
  aprobar (`esbuild` ×3, `workerd`, `koffi`, `electron-winstaller`). No impidió
  ni las pruebas ni el build.
- **Línea base antes del arreglo**: `npm run check` con **1 fallo**.
  96 archivos (1 rojo), 1.650 superadas, 14 omitidas.
  `apps/agent/src/agent.test.ts:465` → `expect(commit.ok).toBe(true)` recibía
  `false`, porque el equipo no tiene identidad de Git y `commitWorktree` no
  aportaba una de respaldo.
- `npx vitest run apps/agent/src/agent.test.ts` tras el arreglo: **81/81**.
- **`npm run check` tras el arreglo: exit 0.**
  - Lint: correcto.
  - Typecheck: correcto.
  - Suite: **96 archivos, 0 fallos**. Dos ejecuciones seguidas dieron
    1.653 superadas / 14 omitidas y 1.658 superadas / 9 omitidas. La diferencia
    son pruebas que se omiten segun las herramientas que detecta el equipo en
    ese momento; el total (1.667) y los fallos (0) no varian.
  - Build: `remote-crypto`, `remote-protocol`, `shared`, `agent`, `desktop` y
    `gateway` correctos.
- Diferencia con el registro del 2026-08-27 (1.656 superadas, 9 omitidas): son
  omisiones por herramientas ausentes en este ordenador, más las 2 pruebas
  nuevas. No es una regresión.

### 2026-08-31 — Windows 11 — KIMI-K3-RETRY-001

- `LUX-SKA7` ejecutó realmente `list_files` y `write_file`; su siguiente vuelta
  acabó en `fetch failed` tras quince minutos. Era una red sin estado HTTP y la
  ruta agentic sólo reintentaba 429.
- Nueva regresión: recibe `tool_calls`, escribe una vez, el siguiente `fetch`
  falla, se reintenta y termina. Confirma tres peticiones HTTP, una herramienta
  y texto final: **118 pruebas focalizadas superadas**.
- Puerta completa: lint, typecheck, suite de **97 archivos con 1.667 pruebas
  superadas y 9 omitidas**, build y `git diff --check` correctos.
- No se consumió una API real para la corrección. La validación pendiente es
  reintentar manualmente `LUX-SKA7` ya con Desktop reconstruido.

### 2026-08-31 — Windows 11 — corrección SSE de KIMI-K3-EXPERIMENT-001

- `LUX-BHM8` reveló que el guard de consulta alcanzaba el bucle agentic. La
  regresión simula `write_file`, comprueba su ejecución, una segunda llamada y
  texto final.
- Pruebas dirigidas: **116 superadas**. Puerta completa: lint, typecheck,
  **97 archivos, 1.665 pruebas superadas y 9 omitidas**, build y diff correctos.
- No se consumió una API real para la corrección; Desktop reiniciado y agente
  listo.

### 2026-08-31 — Windows 11 — KIMI-K3-EXPERIMENT-001

- La traza real de `LUX-A9K9` demostró que Kimi K3 emite `tool_calls`; se
  habilitó de forma experimental con ejecutor ya confinado, sin declararlo
  verificado hasta una tarea completa.
- Pruebas focalizadas de catálogo, bucle agentic y proveedor: **140 pruebas
  superadas**.
- Puerta completa: lint, typecheck, suite de **97 archivos con 1.664 pruebas
  superadas y 9 omitidas**, build y `git diff --check` correctos.
- No se consumió ninguna API real para esta modificación. La siguiente llamada
  es manual desde Studio y queda documentada en `LA-032`.

### 2026-08-31 — Windows 11 — BUG-EMPTY-TOOL-CALL-001

- Reproducción añadida: un SSE con `finish_reason=tool_calls`, 452 tokens de
  entrada, 2.263 de salida y cero texto visible falla si el trabajo no recibió
  un contexto agentic. El diagnóstico sigue registrando el final real.
- `apps/agent/src/providers/providers.test.ts` y
  `apps/agent/src/conversation-job.test.ts`: **82 pruebas superadas**.
- Puerta completa: lint, typecheck, suite de **97 archivos con 1.663 pruebas
  superadas y 9 omitidas**, build y `git diff --check` correctos.
- No se llamó a ninguna API real durante las pruebas. El trabajo de Kimi que
  reveló el caso no se modificó ni se reintentó.

### 2026-08-31 — Windows 11 — cierre de OPS-REGISTRATION-001

- Alta real comprobada sin exponer secretos: `config.json` existe, contiene una
  ID y nombre de máquina, una conexión y un proyecto; no tiene la propiedad
  `machineToken`.
- `secrets.enc` existe y tiene contenido cifrado; no se leyó ni se volcó su
  contenido. El secreto de registro se sustituyó por un espacio en el
  portapapeles tras el alta.
- Se reinició el proceso de desarrollo retirando sólo
  `ELECTRON_RUN_AS_NODE`; `electron-vite` reconstruyó main/preload y el proceso
  principal confirmó `agente listo`.
- La puerta completa anterior permanece válida: lint, typecheck, suite de 97
  archivos con 1.662 pruebas superadas y 9 omitidas, build y `git diff --check`
  correctos. No se consumió ninguna API China en esta comprobación.

### 2026-08-31 — Windows 11 — diagnóstico administrativo de Code Integrity

- Wrangler OAuth: login correcto; cuenta y Worker `luxy-gateway` verificados.
  El listado remoto contiene `MACHINE_REGISTRATION_SECRET`; ningún valor de
  secret es legible mediante Cloudflare.
- `CiTool -lp -json` elevado: `VerifiedAndReputableDesktop` está firmada,
  autorizada y en enforcement; su ID coincide con los eventos 3033/3077.
- `Get-AuthenticodeSignature`: el `electron.exe` local está `NotSigned`.
- La política base permite suplementos. El host no ofrece `ConfigCI`, por lo que
  no se generó ni desplegó una política manual sin una herramienta validada.
- No se apagó Defender/Smart App Control, no se empleó bypass y no se rotó el
  secreto. El registro real sigue pendiente.

### 2026-08-31 — Windows 11 — validación de App Control Wizard

- App Control Wizard 2.8.0.0 generó un XML suplementario con base
  `{0283ac0f-fff1-49ae-ada1-8a933130cad6}` y Policy ID
  `{EDCB2C55-DEDC-4742-A9A1-28AE5E32854F}`.
- Inspección del XML generado tras `Folder Scan` de Electron: `<FileRules />`,
  `<Signers />` y reglas de producto vacías. No contiene hashes ni permisos
  efectivos para Electron.
- El `.cip` que mostró el asistente no se encontró junto al XML. No se ejecutó
  conversión, instalación ni reinicio de la política.
- Diagnóstico del host: el módulo de Code Integrity incluido por el Wizard usa
  .NET 8 y no puede cargarse desde PowerShell 5.1; no se instaló software ni se
  usó un bypass. Siguiente comprobación: `File Hash` explícito sobre
  `electron.exe`.

### 2026-08-31 — Windows 11 — arranque real de Desktop

- Se comprobó `ELECTRON_RUN_AS_NODE=1` en el entorno. Con esa variable,
  `npm run dev --workspace @luxy/desktop` compila pero falla al importar
  `BrowserWindow`, porque Electron se ejecuta como Node.
- Al retirar la variable sólo de ese proceso, `electron-vite dev` compiló main y
  preload, levantó Vite en `http://localhost:5173` y arrancó Electron sin error
  durante más de 35 segundos; el onboarding quedó visible.
- `wrangler secret put MACHINE_REGISTRATION_SECRET --name luxy-gateway` terminó
  correctamente. El valor aleatorio de 32 bytes se escribió directamente al
  proceso y al portapapeles de Windows, sin imprimirse ni guardarse en archivos.
- No se aplicó un XML/CIP, no se desactivó protección alguna y el alta aún no se
  ha confirmado desde la interfaz.

### 2026-08-31 — Windows 11 — CATALOG-REFRESH-001

- Catálogo de API China actualizado a los 19 modelos mostrados por Daniel:
  19 entradas exactas, cuatro retiros de versiones antiguas y cinco versiones
  nuevas; `sensenova-u1.5-lite` queda como imagen sin capacidades inventadas.
- Pruebas focalizadas tras reconstruir `@luxy/shared`: **5 archivos, 182
  pruebas superadas**. La primera ejecución detectó que Agent usaba la
  compilación anterior de Shared; al reconstruir, pasó sin cambiar producción.
- Puerta final: `npm run lint`, `npm run typecheck`, `npm test` y `npm run
  build` terminaron con exit 0; **97 archivos, 1.662 pruebas superadas, 9
  omitidas**. `git diff --check` también pasó.
- No se llamó a `/v1/models`, no se consumieron tokens ni se añadieron claves.

### 2026-08-31 — Windows 11 — OPS-REGISTRATION-001, reintento real

- Gateway real: `GET /health` devuelve `status: ok` y `configured: true`.
- Desktop: `npm run dev --workspace @luxy/desktop` compila main y preload, pero
  termina con `spawn UNKNOWN` al crear Electron.
- Evidencia de sistema del mismo intento: Code Integrity 3033/3077 a las 08:13,
  Policy ID `{0283ac0f-fff1-49ae-ada1-8a933130cad6}`; el binario no satisface el
  nivel de firma empresarial.
- Configuración: `config.json` y `secrets.enc` siguen sin existir. No hay secreto
  de registro en el entorno ni `.dev.vars` local.
- Cloudflare: Wrangler 4.114.0 responde, pero `whoami` confirma que no hay sesión
  autenticada. No se inició login ni se cambió ningún secret.
- Firma local: ningún certificado de código disponible con clave privada en los
  almacenes personal del usuario o de la máquina.
- No se ejecutó el alta y no se generó, imprimió ni guardó UUID/token alguno.

### 2026-08-28 — Windows 11 — OPS-REGISTRATION-001

- Pruebas dirigidas: `Setup.test.ts` + `ipc.test.ts`, **35/35**.
- Puerta final:
  - `npm run lint`: exit 0;
  - `npm run typecheck`: exit 0;
  - `npm test`: **97 archivos, 1.662 pruebas superadas, 9 omitidas, 0 fallos**;
  - `npm run build`: exit 0 en los seis workspaces.
- Build de Desktop generado correctamente; incluye hostname no secreto, ID
  persistente/visible y el onboarding de F2.4-T1.
- Smoke de arranque: **bloqueado antes de ejecutar código de Luxy**. Windows
  Code Integrity registra eventos 3033/3077: `electron.exe` no satisface el
  nivel de firma empresarial (Policy ID
  `{0283ac0f-fff1-49ae-ada1-8a933130cad6}`). No hay proceso o ventana restante.
- Gateway real: `/health` responde `status: ok`, `configured: true`.
- Registro real: no ejecutado; falta `MACHINE_REGISTRATION_SECRET`, por lo que
  no existe todavía UUID ni token para este ordenador.

### 2026-08-28 — Windows 11 — F2.4-T1

- Worktree: `luxy/f2-4-conversation-library`, base `main` @ `00a9cc1`.
- Instalación local: `npm install --ignore-scripts`, 495 paquetes; no se
  ejecutaron scripts de dependencias. NPM volvió a informar las 12
  vulnerabilidades abiertas en `LA-027`; no se aplicó ninguna corrección.
- Pruebas dirigidas: `conversation.test.ts` + `studio.test.ts`, **78/78**.
- Puerta final:
  - `npm run lint`: exit 0;
  - `npm run typecheck`: exit 0;
  - `npm test`: **96 archivos, 1.655 pruebas superadas, 14 omitidas, 0 fallos**;
  - `npm run build`: exit 0 en `remote-crypto`, `remote-protocol`, `shared`,
    `agent`, `desktop` y `gateway`.
- Pruebas nuevas: revisión de título/archivo en metadata, búsqueda sin acentos
  sobre título/pregunta/respuesta, archivo/restauración y autorización de la
  mutación de biblioteca.
- Corrección de infraestructura de prueba: el repositorio huérfano temporal
  configura su propia identidad Git; ya no depende del perfil global de la
  máquina.
- Diagnósticos previos, no ocultados: una ejecución falló porque `git` no estaba
  en `PATH`; otra dejó sólo el commit huérfano fallando por identidad global.
  Tras corregir el entorno de proceso y aislar el fixture, la puerta final pasó.
- `git diff --check`: correcto. Prettier acotado a los archivos modificados.
- No se ejecutó navegador, API real, migración, deploy, commit ni push.

### 2026-08-27 — Windows 11 — F4.9-DYNAMIC-HTTP-PROVIDERS

- Worktree: `luxy/f4-9-dynamic-http-providers`, base `main` @ `2ae1291`.
- `npm.cmd run check`: exit 0.
- Lint: correcto.
- Typecheck: correcto.
- Suite completa: **96 archivos, 1.656 pruebas superadas, 9 omitidas, 0
  fallos**.
- Build: `remote-crypto`, `remote-protocol`, `shared`, `agent`, `desktop` y
  `gateway` correctos.
- Pruebas nuevas o ampliadas: validación de proveedores y URLs; IPC de guardado
  conjunto; invalidación/autorización de secretos; formulario; exposición y
  creación desde Gateway; recarga y parada limpia del host.
- Incidencia encontrada y cerrada: el primer pase rechazó el nombre histórico
  `connection:<id>`; el contrato final lo conserva y limita las altas nuevas de
  Studio a nombres internos seguros.
- `npm.cmd run format:check`: no es una puerta limpia del checkpoint; reportó
  333 archivos preexistentes. No se aplicó formato global.
- Sin API real, tokens, automatización de navegador, migración, deploy, commit
  ni push.

### 2026-08-21 15:00 — Windows 11 — smoke test manual de la copia canónica (LUXY-CONSOLIDATION-001)

- Objetivo: verificar visualmente, con la app real corriendo, que la copia
  canónica (`feat/luxy-desktop` @ `e40268a` en su momento; hoy `90eff24`) abre
  y que el bloque integrado en la consolidación (diálogo de confirmación
  React, ficha de proyecto, campos Proyecto/Rama) funciona de verdad, no sólo
  en pruebas automatizadas.
- Cómo: `npm run desktop:dev` real (Electron + Vite dev server), ventana
  real en pantalla. Automatizado con UI Automation
  (`System.Windows.Automation`, `InvokePattern`) para navegar/pulsar
  botones por su nombre accesible — más fiable que coordenadas de píxel — y
  capturas de pantalla (PowerShell + `System.Drawing`) para verificación
  visual en cada paso. Máquina conectada: `portatil-clase`, gateway real
  (`luxy-gateway.danielux135.workers.dev`), datos reales de Supabase (30
  trabajos, 17 conversaciones guardadas, 3 proyectos).
- Comprobado y correcto:
  1. **Arranque**: agente en marcha, Gateway conectado, Studio abre en
     Inicio sin errores de consola visibles.
  2. **Diálogo de confirmación React**: en Trabajos, seleccionado el trabajo
     fallido real `LUX-8APM` (minimax/MiniMax-M3), pulsado «Reintentar
     trabajo» → aparece el diálogo `CONFIRMAR ACCION` con «¿Reintentar
     LUX-8APM?», proveedor/modelo y el aviso de continuidad de worktree,
     botones VOLVER/REINTENTAR. Cerrado con **VOLVER** — no se creó ningún
     trabajo ni se llamó a ningún proveedor.
  3. **Ficha editable de proyecto**: en Proyectos, pulsado «Editar ficha»
     del proyecto `test` → panel «FICHA · TEST» con alias estable, nombre
     visible, tipo base, stack, carpeta de la máquina y el aviso de que la
     ficha es local y no se versiona. Cerrado con **CERRAR**, sin guardar
     cambios.
  4. **Campos Proyecto/Rama**: visibles en el detalle de `LUX-8APM`
     (`PROYECTO: test`, `RAMA: sin rama`), junto a Estado, Origen,
     Proveedor, Modelo, Pruebas OK/Falladas, Llamadas al modelo y
     Herramientas ejecutadas.
  5. **Navegación básica de Studio**: Inicio, Trabajos, Proyectos —
     historial real de 30 trabajos, formulario «Nueva tarea» con
     máquina/proyecto/proveedor resueltos.
  6. **Conversaciones**: historial de 17 guardadas, una conversación real
     abierta con turnos, tokens, duración y botones de feedback visibles.
  7. **Laboratorio**: catálogo de pruebas (4 ejecutables · 8 definidas),
     formulario «Preparar una prueba» resuelve máquina/proyecto/modelo
     compatible sin errores.
  8. **Ajustes (Configuración)**: nombre de máquina, URL del Gateway, token
     enmascarado (`•••••••••••`, no se mostró el valor real), arranque y
     seguridad visibles.
- No ejecutado a propósito: ninguna API real de proveedor, ningún trabajo
  nuevo, ninguna evaluación del Laboratorio, ninguna migración ni deploy. El
  único job pre-existente tocado (`LUX-8APM`) sólo se **seleccionó** (lectura)
  y su diálogo de reintento se **canceló**.
- Problemas encontrados: **ninguno funcional.** Un problema puramente de
  automatización (no del producto): el clic de ratón simulado por posición
  de píxel fallaba de forma intermitente porque el foco de la ventana volvía
  a esta sesión de Claude Code entre llamadas; se resolvió cambiando a
  UI Automation (`InvokePattern` por nombre accesible), que no depende de
  coordenadas ni de qué ventana tenga el foco del teclado. No requirió
  ningún cambio de código en Luxy.
- Cierre: `taskkill` sobre el proceso principal de Electron (PID capturado
  al lanzar `npm run desktop:dev`) cerró limpiamente todo el árbol de
  procesos (Electron + agente + Vite dev server). `tasklist` posterior:
  cero procesos `electron.exe`/`node.exe` de Luxy restantes.

### Registros rescatados de `git stash@{0}` — 2026-08-21

Los cinco registros siguientes existían en el checkout principal antes de la
fusión con `luxy/consolidate-worktrees` y no habían llegado a esa rama. El
código que documentan (catálogo de 23 modelos, `hy3`, separadores CSS por
familia en `.model-catalog-list`) ya está confirmado presente y probado en
`e40268a` por otra vía; se recuperan aquí sólo para no perder el rastro
histórico de cuándo y cómo se validaron manualmente.

### 2026-08-11 — Windows 11 — F4.1-T6

- Cambio: catálogo alineado con los 23 modelos confirmados manualmente; sustituidos los Qwen antiguos y añadido `hy3`.
- `npm.cmd run lint`: exit 0.
- `npm.cmd run typecheck`: exit 0.
- `npm.cmd test`: **1.573 passed, 0 failed, 9 skipped**, 85/85 archivos; exit 0.
- `npm.cmd run build`: exit 0.
- Prueba focalizada previa: **100 passed, 0 failed**, 4 archivos.
- Sin proveedores reales, precios, migraciones, deploy, push ni consumo de tokens.

### 2026-08-11 — Windows 11 — F4.3-UI

- Cambio: layout específico para historial de evaluaciones, comparaciones y
  evidencia; fallback responsive a una columna.
- `npm.cmd run lint`: exit 0.
- `npm.cmd run typecheck`: exit 0.
- `npm.cmd test`: **1.573 passed, 0 failed, 9 skipped**, 85/85 archivos;
  exit 0.
- `npm.cmd run build`: exit 0.
- No se ejecutaron modelos ni se consultaron precios.

### 2026-08-11 — Windows 11 — F4.1-T7

- Cambio: los selectores consumen el catálogo real persistido tras actualizar
  modelos; añadido fallback seguro para identificadores nuevos.
- `npm.cmd run lint`: exit 0.
- `npm.cmd run typecheck`: exit 0.
- `npm.cmd test`: **1.574 passed, 0 failed, 9 skipped**, 85/85 archivos;
  exit 0.
- `npm.cmd run build`: exit 0.
- Pruebas focalizadas: **54 passed, 0 failed**, 3 archivos.
- Sin proveedores reales, precios, migraciones, deploy, push ni consumo de
  tokens.

### 2026-08-11 — Windows 11 — F4.1-UI

- Cambio: separadores visuales movidos de cada modelo al bloque de familia en
  la pantalla Modelos.
- `npm.cmd run lint`: exit 0.
- `npm.cmd run typecheck`: exit 0.
- `npm.cmd test`: **1.574 passed, 0 failed, 9 skipped**, 85/85 archivos;
  exit 0.
- `npm.cmd run build`: exit 0.

### 2026-08-11 — Windows 11 — F4.1-UI2

- Corrección: las listas del catálogo ya no heredan el borde por elemento de
  `.list`; separación exclusiva por familia.
- `npm.cmd run lint`: exit 0.
- `npm.cmd run typecheck`: exit 0.
- `npm.cmd test`: **1.574 passed, 0 failed, 9 skipped**, 85/85 archivos.
- `npm.cmd run build`: exit 0.

### 2026-08-21 — Windows 11 — LUXY-CONSOLIDATION-001 (bloque 1)

- Worktree: `luxy-consolidate-worktrees` (`luxy/consolidate-worktrees`), tras
  portar el diálogo React embebido a `Studio.tsx` (D-037) y la ficha de
  proyecto de `lux-auto-init-git` (D-034/D-035/D-036, código ya integrado en
  este worktree salvo el panel de UI).
- Comandos ejecutados por separado: `npm run typecheck`, `npx vitest run
  apps/desktop/src/renderer/project-profile.test.ts
  apps/desktop/src/shared/ipc.test.ts`, `npm test`, `npm run lint`, `npm run
  build`.
- Typecheck: correcto, sin errores.
- Pruebas focalizadas (`project-profile.test.ts`, `ipc.test.ts`): 38 pasadas, 0
  fallos.
- Suite completa: **94 archivos, 1.641 pasadas, 9 omitidas, 0 fallos**, 69,44 s.
- Lint: sin incidencias.
- Build: shared, agent, desktop y gateway correctos (electron-vite + tsc -b
  para los cuatro workspaces).
- No se ejecutaron modelos reales, migraciones, deploy, commit ni push.

### 2026-08-17 — Windows 11 — GIT-CHECKPOINT-001

- Base: `luxy/auto-init-git` @ `1b01fc3` más el checkpoint local autorizado.
- Comando exacto: `npm.cmd run check`.
- Exit code: 0.
- Lint: correcto.
- Typecheck: correcto.
- Suite: **1.594 pasadas, 0 fallos, 9 omitidas**, 88/88 archivos; Vitest 73,15 s.
- Build: shared, agent, desktop, gateway y paquetes Remote correctos.
- Comprobaciones adicionales: `git diff --check` sin errores; el escaneo de
  patrones de secretos sólo encontró valores ficticios en pruebas de redacción.
- No se ejecutaron modelos reales, migraciones, deploy ni push.

### 2026-08-11 — Codex — F4.8-T5-GATEWAY-GUARD

- Evidencia local: `LUX-8ZLC`, ejecutado a las 12:04 locales, creó un worktree
  nuevo porque no recibió `resumeWorktreePath`.
- Focalizadas: 107 pasadas, 0 fallos.
- Suite: 88 archivos; 1.594 pasadas, 9 omitidas, 0 fallos.
- Lint, typecheck y build completo: correctos.

### 2026-08-11 — Codex — UI-JOB-FOCUS

- Prueba focalizada de política: 2 pasadas; IPC: 32 pasadas.
- `npm.cmd run lint`: correcto.
- `npm.cmd run typecheck`: correcto.
- `npm.cmd test`: 87 archivos; 1.592 pasadas, 9 omitidas, 0 fallos.
- `npm.cmd run build`: correcto en todos los workspaces.
- Validación visual pendiente: Electron/Windows debe confirmar que desaparece
  el bloqueo real.

### 2026-08-11 — Codex — F4.8-T5

- Focalizadas: 5 archivos, 162 pruebas pasadas, 0 fallos.
- `npm.cmd run lint`: correcto.
- `npm.cmd run typecheck`: correcto.
- `npm.cmd test`: 86 archivos; 1.590 pasadas, 9 omitidas, 0 fallos.
- `npm.cmd run build`: correcto en shared, agent, desktop, gateway y paquetes
  remote.
- Las pruebas crean repositorios y worktrees temporales reales; no llaman a
  modelos ni consumen APIs.

Separar siempre resultados históricos, resultados de la copia actual y pruebas
manuales. No transformar un fallo no ejecutado en «omitido».

## 2026-08-20 — CONSOLIDATE-WORKTREES-001

- `82e728a`: `npm.cmd run check` correcto; **1.602 passed**, 9 skipped.
- `cbac4f2`: `npm.cmd run check` correcto; **1.622 passed**, 9 skipped.
- No hubo llamadas reales, push, despliegues ni migraciones.

## 2026-08-20 — BUG-RATE-LIMIT-UX-001

- `npm.cmd test -- --run apps/agent/src/providers/providers.test.ts`: **73 passed**, exit 0.

## 2026-08-20 — BUG-TIMEOUT-DEEPSEEK-001

- `npm.cmd test -- --run apps/agent/src/providers/providers.test.ts`: **75 passed**, exit 0.

## 2026-08-20 — BUG-HUNYUAN-002

- Prueba enfocada: `npm.cmd test -- --run packages/shared/src/schemas.test.ts packages/shared/src/telegram/commands.test.ts`: **40 passed**, exit 0.
- Validación completa: `npm.cmd run check`: **exit 0**; lint, typecheck, build y **1.582 passed**, 9 skipped en 88 archivos.
- Studio: reiniciado desde el paquete `apps/desktop` de `luxy/ux-001-detalle-trabajo`; la ventana **Luxy** está abierta con proceso `17020`. Pendiente confirmar `LA-021`.

## 2026-08-20 — CATALOG-DETECTED-003

- `npm.cmd test -- --run packages/shared/src/models/catalog-fetch.test.ts packages/shared/src/models/registry.test.ts`: **53 passed**, exit 0.
- `npm.cmd run typecheck`: exit 0.
- No hubo llamadas reales, push, despliegues ni migraciones.

## 2026-08-20 — COMMAND-POLICY-001

- `npm.cmd run build --workspace @luxy/shared`: exit 0.
- `npm.cmd test -- --run apps/agent/src/agent.test.ts`: **76 passed**, exit 0.
- No hubo llamadas reales, push, despliegues ni migraciones.

## 2026-08-20 — PROJECT-PROFILE-CORE-001

- `npm.cmd run typecheck`: exit 0.
- `npm.cmd run build --workspace @luxy/shared`: exit 0.
- `npm.cmd test -- --run apps/agent/src/agent.test.ts apps/gateway/src/handlers/studio.test.ts apps/gateway/src/repository.test.ts`: **114 passed**, exit 0.
- No hubo llamadas reales, push, despliegues ni migraciones.

## 2026-08-20 — PROJECT-SCOPE-CORE-001

- `npm.cmd run typecheck`: exit 0.
- `npm.cmd run build --workspace @luxy/shared`: exit 0.
- `npm.cmd test -- --run apps/desktop/src/renderer/project-context.test.ts apps/desktop/src/shared/ipc.test.ts`: **36 passed**, exit 0.

## 2026-08-20 — PROJECT-SCOPE-UI-001

- `npm.cmd run typecheck`: exit 0.
- `npm.cmd test -- --run apps/desktop/src`: **362 passed**, exit 0.
- `npm.cmd run build --workspace @luxy/desktop`: exit 0.

### 2026-08-10 — Codex — F4.8-T4

- Prueba añadida: `buildProviderPrompt` incluye instrucciones de continuación
  para un trabajo reanudado.
- `npm.cmd run lint`: **pasado**.
- `npm.cmd run typecheck`: **pasado**.
- `npm.cmd test -- --run apps/agent/src/agent.test.ts`: **75/75 pasadas**.
- `npm.cmd run desktop:build`: **pasado**; bundle de agente y renderer
  reconstruidos en este worktree.
- No se hicieron llamadas reales al proveedor ni despliegues.

### 2026-08-10 — Codex — F4.8-T4b

- `npm.cmd run lint`: pasado.
- `npm.cmd run typecheck`: pasado.
- `npm.cmd run desktop:test`: **328/328 pasadas**.
- `npm.cmd run desktop:build`: pasado.

### 2026-08-10 — Codex — F4.8-T4c

- Prueba nueva: el prompt autónomo exige continuar fases y no terminar con una
  pregunta.
- `npm.cmd run lint`: pasado.
- `npm.cmd run typecheck`: pasado.
- `npm.cmd test -- --run apps/agent/src/agent.test.ts`: **76/76 pasadas**.
- `npm.cmd run desktop:build`: pasado.

### 2026-08-10 — Codex — F4.8-T4d

- `npm.cmd run lint`: pasado.
- `npm.cmd run typecheck`: pasado.
- `npm.cmd test -- --run apps/agent/src/providers/providers.test.ts`: **72/72 pasadas**.
- `npm.cmd run desktop:build`: pasado.

### 2026-08-10 — Codex — F4.8-T1

- Prueba focalizada: `vitest run apps/agent/src/agent.test.ts` — **72 passed, 0 failed**.
- Casos nuevos: inicialización de proyecto no-Git, `.gitignore` creado sólo si falta, exclusión de `.env` y `node_modules`, commit local `estado inicial`.
- `npm run lint`: pasado.
- `npm run typecheck`: bloqueado por `TS2688`, falta `@cloudflare/workers-types` en las dependencias disponibles.
- `npm test` y `npm run build`: no ejecutados después del bloqueo de typecheck.
- No se llamó a proveedores reales ni se consumieron tokens.

### 2026-08-10 — Codex — F4.8-T2

- Pruebas focalizadas: agente, Gateway Studio y Desktop — **103 passed, 0 failed**.
- Cobertura nueva: validar y reanudar la misma ruta/rama de worktree; Gateway
  sólo acepta el intento anterior del mismo Studio, máquina, proyecto,
  proveedor, modelo y prompt.
- `npm run lint`: pasado en la ejecución conjunta.
- `npm run typecheck`: bloqueado por `@cloudflare/workers-types` ausente y por
  el enlace temporal de `@luxy/shared` al checkout original, que no contenía
  todavía `resumeJobId`; no se ocultó el fallo.
- `npm test` y `npm run build`: pendientes con dependencias completas.

### 2026-08-10 — Codex — F4.8-T3

- Comprobación local: `C:\Users\daniel\Desktop\test` no existe en este
  portátil.
- Prueba añadida para que una ruta inexistente produzca un error de proyecto
  claro, no `ENOENT`.
- Ejecución de la prueba nueva: pendiente tras restaurar dependencias.

## Línea base histórica del checkpoint

### 2026-08-02 — Windows — `luxy-work-update-001`

- `npm test`: 1.260 passed, 14 skipped.
- `npm run build`: passed.
- Procedencia: salida devuelta por Daniel tras aplicar el parche principal.

### 2026-08-04 — finalización por señales

- Pruebas específicas: 91/91 passed.
- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- Suite global informada: sin regresiones nuevas; fallos ambientales Linux ya
  conocidos.

### 2026-08-04 — outcome, tokens y memoria

- Pruebas específicas: 30/30 passed.
- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- Confirmación manual de Daniel: las respuestas normales finalizan, muestran
  tokens y guardan memoria.

### 2026-08-04 — feedback

- Pruebas específicas: 11/11 passed.
- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- Suite global informada: 1.312 ejecutadas, 1.294 passed, 9 skipped, 9 fallos
  ambientales Linux y dos suites Electron bloqueadas por caché/permisos.
- Confirmación manual del primer clic: pendiente.

## Incidencia manual que abre P0

### 2026-08-04 — Kimi — generación larga de web

- Duración observada: aproximadamente 23 min 43 s.
- Tokens de salida mostrados por el proveedor: alrededor de 6.422.
- Resultado: HTML incompleto, terminado a mitad de una etiqueta.
- Memoria: fallback contaminado por HTML/CSS/JS.
- `finish_reason`: no capturado.
- Motivo de aborto/cierre: no capturado.
- Conclusión válida: resultado y memoria no son fiables para este caso.
- Conclusión no válida todavía: «alcanzó el límite de tokens» o «Luxy cortó la
  conexión».

## Comprobación de este paquete documental

### 2026-08-04 — copia Linux de referencia — DOC-HANDOFF-001

- Prettier sobre los archivos modificados: passed.
- Validación de `FILE-MANIFEST.json`: passed.
- Existencia y referencias de documentos canónicos: passed.
- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm test`: exit 1; 1.294 passed, 9 skipped, 9 failed y 2 suites no pudieron
  cargarse.
- `npm run build`: passed al ejecutarlo por separado después de la suite.

Fallos de suite conservados:

- 4 en `docs.test.ts` porque la copia de auditoría no contiene `.env.example`
  ni `.env.providers.example`.
- 4 en `agent.test.ts` por expectativas específicas de shims y precedencia
  `.exe`/`.cmd` de Windows ejecutadas en Linux.
- 1 en `confine.test.ts` por normalización de barra invertida de Windows en
  Linux.
- 2 suites Electron no cargaron porque el entorno no permite crear
  `/root/.cache/electron` y el binario no está instalado en esta copia.

Clasificación: línea base ambiental conocida. No apareció un fallo nuevo ligado
a los documentos añadidos. La suite global no se declara verde.

## Línea base real del worktree de Windows

### 2026-08-05 08:36 — Windows — `luxy-work-update-001` — P0.0

- Commit/base o diff: HEAD `61fb7ee` con 29 archivos modificados y 22 sin
  seguimiento (`+1603 / -88`).
- Comando exacto: `npx vitest run --reporter=dot` sobre las ocho suites de
  Conversaciones, y después `npm test`.
- Exit code: 0 en ambos.
- Passed / failed / skipped:
  - suites de Conversaciones: 8 archivos, 57 passed, 0 failed.
  - suite global: 68 archivos, 1.316 passed, 0 failed, 9 skipped.
- Duración: 3,31 s y 57,30 s.
- Fallos completos: ninguno.
- Clasificación: esperado. **Los 9 fallos ambientales del 2026-08-04 eran
  exclusivos de la copia Linux** (`docs.test.ts` sin `.env.example`, shims de
  Windows, `confine.test.ts`) y las dos suites de Electron sí cargan aquí. En
  esta máquina la línea base es verde: un fallo nuevo es una regresión.
- Evidencia manual adicional: `git apply --reverse --check` confirma presentes
  `luxy-conversations-signal-finalization.patch`,
  `luxy-conversations-outcome-token-finalization-fix.patch` y
  `luxy-conversations-feedback-single-click-fix.patch`.

### 2026-08-05 08:51 — Windows — `luxy-work-update-001` — P0.1

- Commit/base o diff: HEAD `61fb7ee` más los cambios de `P0.1` sin confirmar.
- Comando exacto: `npm run lint`, `npm run typecheck`, `npm test`,
  `npm run build`, y vitest por suite durante el desarrollo.
- Exit code: 0 en los cuatro.
- Passed / failed / skipped: 69 archivos, 1.334 passed, 0 failed, 9 skipped
  (línea base previa: 68 archivos, 1.316 passed).
- Duración: 44,63 s la suite completa.
- Fallos completos: ninguno al cerrar. Durante el desarrollo fallaron dos
  pruebas nuevas y las dos eran del mock, no del código:
  1. `textLength: 0` en el corte de socket, porque `retryWithBackoff` repite la
     petición y un `ReadableStream` ya consumido no vuelve a dar bytes. Se
     corrigió el mock para devolver un cuerpo nuevo por intento. **Dejó a la
     vista que un corte con texto parcial se reintenta entero**; anotado para
     `P0.2`.
  2. Timeout de 20 s en la cancelación, porque el mock no hacía fallar el cuerpo
     al abortar y `undici` sí lo hace. Se corrigió el mock.
- Clasificación: esperado.
- Evidencia manual adicional: ninguna. `LA-006` sigue bloqueada hasta `P0.4`.

### 2026-08-05 09:49 — Windows — `luxy-work-update-001` — P0.2

- Commit/base o diff: HEAD `61fb7ee` más los cambios de `P0.1` y `P0.2` sin
  confirmar.
- Comando exacto: `npm run lint`, `npm run typecheck`, `npm test`,
  `npm run build`.
- Exit code: 0 en los cuatro.
- Passed / failed / skipped: 70 archivos, 1.356 passed, 0 failed, 9 skipped
  (antes de `P0.2`: 69 archivos y 1.334 passed).
- Duración: 51,85 s la suite completa.
- Fallos completos: ninguno al cerrar. Durante el desarrollo falló una
  aserción de `P0.1` que comprobaba que la metadata del diagnóstico contenía
  **sólo** `responseTermination`; ahora lleva también `responseOutcome`. Es el
  cambio buscado, y la prueba se actualizó.
- Clasificación: esperado.
- Evidencia del arreglo del reintento: la prueba cuenta los intentos reales.
  Con texto parcial, 1 intento; sin texto, 3. La rama sin texto tarda ~7 s
  porque ejecuta el backoff de verdad.
- Evidencia manual adicional: ninguna. `LA-006` sigue bloqueada hasta `P0.4`.

### 2026-08-05 10:53 — Windows — `luxy-work-update-001` — P0.2b y P0.3

- Commit/base o diff: HEAD `61fb7ee` más `P0.1`–`P0.3` sin confirmar.
- Comando exacto: `npm run lint`, `npm run typecheck`, `npm test`,
  `npm run build`.
- Exit code: 0 en los cuatro.
- Passed / failed / skipped: 70 archivos, 1.366 passed, 0 failed, 9 skipped
  (antes de este paso: 1.356 passed).
- Duración: 53,97 s la suite completa.
- Fallo reproducido a propósito antes del arreglo: `un usage intermedio no
puede cortar una respuesta que continua` devolvía `<html>` en vez de
  `<html><body>mucho mas</body>`. Es el corte que vio Daniel, en pequeño.
- Clasificación: regresión encontrada y corregida.
- Nota de coste: la prueba del proveedor que reproduce el proxy que no cierra el
  cuerpo usa `softTerminalGraceMs: 50`; con el valor real esperaría 15 s. El
  valor por defecto se comprueba aparte contra `SOFT_TERMINAL_GRACE_MS`.
- Evidencia manual pendiente: `LA-006` (repetir la web con el build nuevo) y
  `LA-007` (tope real de salida de Kimi K2.6).

### 2026-08-05 11:15 — Windows — `luxy-work-update-001` — P0.3b

- Commit/base o diff: HEAD `61fb7ee` más `P0.1`–`P0.3b` sin confirmar.
- Comando exacto: `npm run lint`, `npm run typecheck`, `npm test`,
  `npm run build`.
- Exit code: 0 en los cuatro.
- Passed / failed / skipped: 70 archivos, 1.370 passed, 0 failed, 9 skipped
  (antes de este paso: 1.366 passed).
- Duración: 54,16 s la suite completa.
- Fallos completos: ninguno.
- Clasificación: regresión encontrada y corregida.
- Evidencia de producción usada para el diagnóstico (sólo lectura, sin volcar
  contenido): metadata y longitudes de `LUX-YJT9` y `LUX-8B8T`. Ambos con
  `transportEnd: done_marker`, `finishReason: stop`, `abortedBy: null`,
  7.716 y 7.691 caracteres recibidos y **4.000 guardados**.
- Evidencia manual pendiente: `LA-006` y `LA-007`.

### 2026-08-05 16:36 — Windows — `luxy-work-update-001` — P0.3c

- Commit/base o diff: HEAD `61fb7ee` más `P0.1`–`P0.3c` sin confirmar.
- Comando exacto: `npm run lint`, `npm run typecheck`, `npm test`,
  `npm run build`.
- Exit code: 0 en los cuatro.
- Passed / failed / skipped: 70 archivos, 1.379 passed, 0 failed, 9 skipped
  (antes de este paso: 1.370 passed).
- Fallos completos: ninguno al cerrar. Durante el desarrollo falló la prueba del
  límite de plan porque el detector sólo miraba el mensaje del error externo y
  no el del envuelto. Se corrigió el código, no la prueba.
- Clasificación: regresión encontrada y corregida.
- Evidencia de producción (sólo lectura): `LUX-3966` con `finish_reason: length`,
  8.192 tokens de salida, 22.574 caracteres recibidos y **22.025 guardados**.
  Confirma en real el arreglo del tope de guardado y la detección de truncado.
- Evidencia manual pendiente: `LA-007`.

### 2026-08-05 22:03 — Windows 11, ordenador nuevo — MIGRACION-PC

- Commit/base o diff: `luxy/work-update-001-studio` @ `61fb7ee` más el parche
  recuperado (60 archivos, +7.997/−128). Repositorio
  `C:\Users\Daniel\Desktop\proyecto github\Luxy`.
- Comando exacto: `npm run build`, `npm test`, `npm run lint`,
  `npm run typecheck`, `npx prettier --check .`.
- Exit code: 0 los cinco.
- Passed / failed / skipped: **1.379 passed, 0 failed, 9 skipped**, 70/70
  archivos.
- Duración: ≈ 40 s la suite.
- Fallos completos: ninguno al final.
- Clasificación: esperado. Confirma que la migración reproduce el árbol del
  worktree antiguo.
- Evidencia manual adicional: **antes** del build, 9 archivos y 25 pruebas
  fallaban con `TypeError: Cannot read properties of undefined (reading
'safeParse')` en `apps/gateway/src/handlers/api.ts:89`. Causa demostrada:
  `packages/shared/dist` era de un build anterior al parche y no exportaba los
  esquemas nuevos; vitest resuelve `@luxy/shared` por el junction hacia ese
  `dist`. `npm run build` lo resolvió entero. **No era un fallo del parche ni
  del código recuperado.**
- Entorno: los seis junctions de `node_modules/@luxy/*` estaban ya reparados de
  la sesión anterior; sin ellos la suite no arranca.

### 2026-08-05 22:22 — Windows 11 — P0.4

- Commit/base o diff: `luxy/work-update-001-studio` @ `9012eda` más
  `apps/agent/src/response-matrix.test.ts`, sin cambios de producción.
- Comando exacto: `npm run lint`, `npm run typecheck`, `npm test`.
- Exit code: 0 los tres.
- Passed / failed / skipped: **1.398 passed, 0 failed, 9 skipped**, 71/71
  archivos. La matriz aporta 19 pruebas.
- Duración: ≈ 42 s la suite.
- Fallos completos: ninguno al final. Durante el desarrollo, uno solo:
  `expected 'structured' to be 'valid'` — el estado válido de
  `parseConversationMemoryResponse` se llama `structured`. Error de la prueba,
  no del código.
- Clasificación: esperado.
- Evidencia manual adicional: ninguna. El caso 10 usa un proveedor simulado; la
  comprobación de que Studio pinta bien el estado cancelado es `P0.5`.

### 2026-08-05 23:40 — Windows 11 — P0.5

- Commit/base o diff: `luxy/work-update-001-studio` @ `16c6e9a` más cuatro
  archivos: `packages/shared/src/schemas.ts`,
  `apps/desktop/src/renderer/conversation.ts`,
  `apps/desktop/src/renderer/pages/Conversations.tsx` y
  `apps/desktop/src/renderer/conversation.test.ts`.
- Comando exacto: `npx prettier --write` sobre los cuatro, `npm run lint`,
  `npm run typecheck`, `npm test`, `npm run build`.
- Exit code: 0 los cinco.
- Passed / failed / skipped: **1.408 passed, 0 failed, 9 skipped**, 71/71
  archivos. `P0.5` aporta 10 pruebas.
- Duración: ≈ 43 s la suite.
- Fallos completos: ninguno al final. Tres durante el desarrollo, los tres por
  inventar un valor en vez de leer el enum:
  1. `schemas.ts(269,85): error TS2366: Function lacks ending return statement` —
     el `switch` cubría cuatro estados de memoria y `CONVERSATION_MEMORY_STATUSES`
     tiene cinco; faltaba `rejected_code`.
  2. `expected null to deeply equal { input: 900, output: 4096 }` (2 pruebas) —
     la terminación de prueba no pasaba `responseTerminationSchema`: llevaba un
     `lastEvent` que no existe y le faltaba `finalUsageReceived`.
  3. Las mismas 2 pruebas otra vez: `transportEnd: 'stream_end'` no es miembro
     de `STREAM_TRANSPORT_ENDS`. El valor correcto es `local_end`.
- Clasificación: esperado. Los tres fallos son de las pruebas nuevas, ninguno
  toca código de producción ni pruebas anteriores.
- Evidencia manual adicional: **ninguna, y es un límite real**. Studio no arranca
  en este ordenador (falta la configuración de máquina y cuatro secretos, ver
  `LA-010`), así que nadie ha visto la tarjeta en pantalla. Lo verificado es el
  contrato, no el pixel: qué etiqueta sale, qué contadores se muestran, cuándo
  aparece el botón y qué frase de memoria corresponde a cada estado.

### 2026-08-06 08:17 — Windows 11 — LINEA-BASE

- Commit/base o diff: `feat/luxy-desktop` @ `c6e5094`, **árbol limpio** salvo
  cuatro elementos sin seguimiento que no son código (`Claves Luxy Supabase
test.txt`, `Luxy claves API.txt`, un handoff duplicado y `Web demos/`).
- Comando exacto: `npm run build`, `npm test`.
- Exit code: 0 los dos.
- Passed / failed / skipped: **1.408 passed, 0 failed, 9 skipped**, 71/71
  archivos.
- Duración: 51,5 s la suite.
- Fallos completos: ninguno.
- Clasificación: esperado. Reproduce exactamente lo que dejó `P0.5`, ahora ya
  commiteado en esta rama.
- Evidencia manual adicional: la ruta y la rama no son las de `LA-008`. El
  trabajo que allí figuraba «sin commitear» está en la historia de
  `feat/luxy-desktop`.

### 2026-08-06 08:34 — Windows 11 — P0.6a y P0.6b

- Commit/base o diff: `feat/luxy-desktop` @ `c6e5094` más
  `packages/shared/src/continuation.ts`,
  `packages/shared/src/continuation.test.ts`,
  `packages/shared/src/constants.ts`, `packages/shared/src/index.ts`,
  `packages/shared/src/schemas.ts`, `apps/gateway/src/handlers/studio.ts`,
  `apps/gateway/src/handlers/studio.test.ts`,
  `apps/desktop/src/renderer/conversation.ts`,
  `apps/desktop/src/renderer/conversation.test.ts`,
  `apps/desktop/src/renderer/useConversations.ts` y
  `apps/desktop/src/renderer/pages/Conversations.tsx`.
- Comando exacto: `npx prettier --write` sobre los archivos tocados,
  `npm run lint`, `npm run typecheck`, `npm run build`, `npm test`.
- Exit code: 0 los cinco.
- Passed / failed / skipped: **1.436 passed, 0 failed, 9 skipped**, 72/72
  archivos. `P0.6a` aporta 18 pruebas y `P0.6b` otras 10.
- Duración: 53,1 s la suite.
- Fallos completos: ninguno al final. Tres durante `P0.6a`, los tres por elegir
  un umbral a ojo en vez de medirlo contra un caso real:
  1. `expected 'appended' to be 'resynced'` — el ancla de resincronización
     exigía 120 caracteres repetidos; un modelo repite una línea, no un párrafo.
     Ahora se prueba de la más larga a la más corta.
  2. `expected 'appended' to be 'overlap'` — `      <li>Segundo</li>` son 22
     caracteres y el mínimo estaba en 24. Bajado a 16, con el motivo escrito al
     lado de la constante.
  3. `expected 'aaaaaaa\nlinea entera' to be 'linea entera'` — el corte por
     salto de línea de `continuationTail` miraba el primer tercio del trozo; se
     cambió a la primera mitad.
- Clasificación: esperado.
- Evidencia manual adicional: **ninguna, y es un límite real**. Studio no
  arranca en este ordenador (`LA-010`), así que nadie ha visto en pantalla el
  documento unido ni el aviso de costura sin demostrar. Lo verificado es el
  contrato: qué estrategia elige la unión en cada caso, qué llega al prompt, qué
  guarda el gateway y qué reconstruye el renderer.

### 2026-08-06 09:20 — Windows 11 — P0.8

- Commit/base o diff: `feat/luxy-desktop` @ `c6e5094` más lo de `P0.6a`/`P0.6b`
  y, de este paso, `apps/desktop/src/renderer/conversation.ts`,
  `apps/desktop/src/renderer/conversation.test.ts`,
  `apps/desktop/src/renderer/useConversations.ts` y
  `apps/desktop/src/renderer/useStudio.ts`.
- Comando exacto: `npx prettier --write` sobre los cuatro, `npm run lint`,
  `npm run typecheck`, `npm run build`, `npm test`.
- Exit code: 0 los cinco.
- Passed / failed / skipped: **1.443 passed, 0 failed, 9 skipped**, 72/72
  archivos. `P0.8` aporta 7 pruebas.
- Duración: 55,4 s la suite.
- Fallos completos: ninguno.
- Clasificación: regresión encontrada y corregida. El sondeo pedía el detalle de
  respuestas terminadas cada 1,5 s.
- Evidencia manual adicional: la salida de `wrangler` de Daniel, con el patrón
  repitiéndose cada menos de 3 s, y el panel de Supabase con **29.432 peticiones
  al API Gateway en 60 minutos**, 100 % de éxito. La medición **posterior** al
  arreglo está pendiente y es `LA-012`: lo que hay aquí es la aritmética del
  código (≈19.200/h → ≈480/h en reposo), no una medida.

### 2026-08-06 09:40 — Windows 11 — P0.9

- Commit/base o diff: lo anterior más `apps/desktop/src/renderer/conversation.ts`,
  `apps/desktop/src/renderer/conversation.test.ts`,
  `apps/desktop/src/renderer/useConversations.ts` y
  `apps/desktop/src/renderer/pages/Conversations.tsx`.
- Comando exacto: `npx prettier --write` sobre los cuatro, `npm run lint`,
  `npm run typecheck`, `npm run build`, `npm test`.
- Exit code: 0 los cinco.
- Passed / failed / skipped: **1.451 passed, 0 failed, 9 skipped**, 72/72
  archivos. `P0.9` aporta 8 pruebas.
- Duración: 48,8 s la suite.
- Fallos completos: ninguno.
- Comprobación del diff: primer intento con un whitespace final en el salto de
  línea de `DECISIONS.md`; corregido y repetido sin errores.
- Clasificación: esperado.
- Evidencia manual adicional: ninguna todavía. Lo verificado es el contrato del
  reductor de eventos locales, cuándo se considera que un directo es local y qué
  ritmo sale de cada combinación. La medición real sigue siendo `LA-012`.

### 2026-08-06 09:55 — Windows 11 — P0.6d

- Commit/base o diff: lo anterior más `packages/shared/src/schemas.ts`,
  `apps/agent/src/job-runner.ts`, `apps/agent/src/agent.ts`,
  `apps/gateway/src/handlers/api.ts`,
  `apps/agent/src/response-matrix.test.ts` y
  `apps/gateway/src/handlers/cancelled-events.test.ts`.
- Comando exacto: `npx prettier --write` sobre los seis, `npm run lint`,
  `npm run typecheck`, `npm run build`, `npm test`.
- Exit code: 0 los cinco.
- Passed / failed / skipped: **1.453 passed, 0 failed, 9 skipped**, 72/72
  archivos. `P0.6d` aporta 2 pruebas nuevas y amplía el caso 10 de la matriz.
- Duración: 53,5 s la suite.
- Fallos completos: ninguno.
- Clasificación: esperado.
- Evidencia manual adicional: ninguna. La comprobación real es cancelar una
  generación larga en Studio y ver que el texto sigue ahí; entra en `LA-012`.

### 2026-08-06 13:05 — Windows 11 — P0.6c

- Commit/base o diff: lo anterior más los dos módulos de artefactos
  (`packages/shared` y `apps/agent`), sus pruebas, `constants.ts`, `schemas.ts`,
  `index.ts`, `job-runner.ts`, `api.ts` del gateway y cinco archivos de Desktop
  (canal IPC, superficie, preload, handlers, main y renderer).
- Comando exacto: `npx prettier --write`, `npm run lint`, `npm run typecheck`,
  `npm run build`, `npm test`.
- Exit code: 0 los cinco.
- Passed / failed / skipped: **1.470 passed, 0 failed, 9 skipped**, 74/74
  archivos. `P0.6c` aporta 17 pruebas en dos archivos nuevos.
- Duración: 58,9 s la suite.
- Fallos completos: ninguno al final. Uno de lint durante el desarrollo:
  `ARTIFACT_KINDS` sólo se usa como tipo y `consistent-type-imports` exige
  `import type`.
- Clasificación: esperado.
- Evidencia manual adicional: ninguna. Las pruebas del agente escriben archivos
  de verdad en carpetas temporales, incluidas las dos de traversal; lo que falta
  es ver el botón **Abrir carpeta** en pantalla (`LA-012`).

### 2026-08-09 — Windows 11 — F4.1-T4

- Commit/base o diff: `feat/luxy-desktop` @ `59870c6`, más el diff local de
  `F4.1-T4`; `package-lock.json` ya estaba modificado y queda fuera del paso.
- Comando específico: `npx vitest run` sobre registro, catálogo leído y
  comandos de Telegram.
- Primera ejecución: 49 pasadas, 1 fallo. La familia SenseNova resolvía un alias
  implícito aunque ningún modelo lo declaraba. Clasificación: regresión
  encontrada por la prueba y corregida.
- Ejecución específica final: **88 pasadas, 0 fallos**, 3 archivos.
- Comprobación completa: `npm run lint`, `npm run typecheck`, `npm test`,
  `npm run build`.
- Exit code: 0 en las cuatro.
- Passed / failed / skipped: **1.488 passed, 0 failed, 9 skipped**, 75/75
  archivos; duración de Vitest 50,20 s.
- Fallos completos finales: ninguno.
- Comprobación del diff: la primera ejecución señaló whitespace final en dos
  saltos Markdown nuevos; corregido. Repetición con `core.safecrlf=false`: exit
  0, sin errores.
- Clasificación: esperado.
- Evidencia manual adicional: ninguna; no se consultó una API real. Precios y
  máximos efectivos permanecen pendientes de `LA-014`/`LA-007`.

### 2026-08-09 — Windows 11 — F4.1-T5

- Commit/base o diff: `feat/luxy-desktop` @ `59870c6`, más `F4.1-T4/T5`; el
  cambio ajeno de `package-lock.json` queda fuera.
- Comando específico: Vitest sobre catálogo, registro y contrato IPC.
- Resultado específico: **80 pasadas, 0 fallos**, 3 archivos.
- Comprobación completa: `npm run lint`, `npm run typecheck`, `npm test`,
  `npm run build`.
- Exit code: 0 en las cuatro.
- Passed / failed / skipped: **1.488 passed, 0 failed, 9 skipped**, 75/75
  archivos; duración de Vitest 114,55 s.
- Fallos completos: ninguno.
- Clasificación: esperado.
- Evidencia manual adicional: captura de Daniel con 22 modelos y rutas de
  precios sin entradas útiles; origina `D-022`.

### 2026-08-09 — Windows 11 — F4.2-T1

- Commit/base o diff: `feat/luxy-desktop` @ `59870c6`, más el diff local
  acumulado de `F4.1-T4/T5` y `F4.2-T1`; `package-lock.json` queda fuera.
- Comando específico: Vitest sobre evidencia de modelos, registro y contrato
  IPC.
- Resultado específico: **71 pasadas, 0 fallos**, 3 archivos; 6 pruebas nuevas.
- Comprobación completa: `npm run lint`, `npm run typecheck`, `npm test`,
  `npm run build`.
- Exit code: 0 en las cuatro.
- Passed / failed / skipped: **1.494 passed, 0 failed, 9 skipped**, 76/76
  archivos; duración de Vitest 171,25 s.
- Fallos completos: ninguno.
- Clasificación: esperado.
- Evidencia manual adicional: pendiente `LA-017`; no se ejecutaron modelos ni
  APIs reales.

### 2026-08-09 — Windows 11 — F4.2-T2

- Commit/base o diff: `feat/luxy-desktop` @ `59870c6`, más el diff local
  acumulado de `F4.1-T4/T5` y `F4.2-T1/T2`; el cambio ajeno de
  `package-lock.json` queda fuera.
- Comando específico: build de `@luxy/shared` y Vitest sobre evidencia de
  modelos, trabajos de conversación, finales del gateway, cancelaciones y cola
  de resultados.
- Primera ejecución específica: **28 pasadas, 3 fallos**. Los tres contratos
  del gateway descartaban `executedModel` porque los tests importaban el
  `dist` anterior de `@luxy/shared`. Clasificación: artefacto de build obsoleto.
- Segunda ejecución específica: **30 pasadas, 1 fallo**. El handler de
  cancelación sólo consideraba `null`, mientras una fixture heredada omitía
  `model`. Clasificación: borde de compatibilidad encontrado y corregido.
- Resultado específico final: **31 pasadas, 0 fallos**, 5 archivos.
- Comprobación completa: `npm run lint`, `npm run typecheck`, `npm test`,
  `npm run build`.
- Exit code: 0 en las cuatro.
- Passed / failed / skipped: **1.497 passed, 0 failed, 9 skipped**, 76/76
  archivos; duración de Vitest 116,02 s.
- Fallos completos finales: ninguno.
- Comprobaciones adicionales: 64/64 pruebas documentales; Prettier sobre los
  16 archivos del paso y `git diff --check`, exit 0. `npm run format:check`
  global, exit 1 por deuda previa en numerosos archivos y por un HTML inválido
  en `Web demos/GLM demos/index.html`; no pertenece a este cambio.
- Clasificación: esperado tras las dos correcciones descritas.
- Evidencia manual adicional: pendiente `LA-017`; no se invocaron proveedores
  ni APIs reales.

### 2026-08-09 — Windows 11 — F4.2-T3

- Commit/base o diff: `feat/luxy-desktop` @ `59870c6`, más el diff local
  acumulado de Fase 4; `package-lock.json` y archivos ajenos quedan fuera.
- Comando específico: Vitest sobre paginación/agregación de modelos, contrato
  IPC, handler de Studio y repositorio.
- Resultado específico final: **60 pasadas, 0 fallos**, 4 archivos; 7 pruebas
  nuevas respecto a `F4.2-T2`.
- Primera comprobación de tipos: exit 1. `offset` aparecía como obligatorio en
  preload, Conversaciones y Studio por usar un `default` en el esquema IPC.
  Corregido dejándolo opcional en esa frontera; segunda ejecución exit 0.
- Comprobación completa final: `npm run lint`, `npm run typecheck`, `npm test`,
  `npm run build`.
- Exit code final: 0 en las cuatro.
- Passed / failed / skipped: **1.504 passed, 0 failed, 9 skipped**, 76/76
  archivos; duración final de Vitest 99,84 s.
- Fallos completos finales: ninguno.
- Clasificación: incompatibilidad de tipos encontrada durante desarrollo y
  corregida antes de la suite final.
- Evidencia manual adicional: pendiente `LA-017`. No se consultaron APIs reales
  ni se desplegó el Gateway.

### 2026-08-09 — Windows 11 — F4.3-T1

- Commit/base o diff: `feat/luxy-desktop` @ `59870c6`, más el diff local
  acumulado de Fase 4; cambios ajenos y secretos quedan fuera.
- Comando específico: build de `@luxy/shared` y Vitest sobre catálogo de
  evaluaciones, registro de modelos y empaquetado de Desktop.
- Resultado específico: **46 pasadas, 0 fallos**, 3 archivos; 3 pruebas nuevas.
- Comprobación completa: `npm run lint`, `npm run typecheck`, `npm test`,
  `npm run build`.
- Exit code: 0 en las cuatro.
- Passed / failed / skipped: **1.507 passed, 0 failed, 9 skipped**, 77/77
  archivos; duración de Vitest 57,06 s.
- Fallos completos: ninguno.
- Clasificación: esperado.
- Evidencia manual adicional: pendiente `LA-018`; no se ejecutó ningún modelo,
  benchmark o API real.

### 2026-08-09 — Windows 11 — F4.3-T2

- Commit/base o diff: `feat/luxy-desktop` @ `59870c6`, más el diff local
  acumulado de Fase 4; cambios ajenos y secretos quedan fuera.
- Comando específico: build de `@luxy/shared` y Vitest sobre catálogo, fixtures,
  validadores, registro de modelos y empaquetado de Desktop.
- Resultado específico: **53 pasadas, 0 fallos**, 4 archivos; 7 pruebas nuevas.
- Comprobación completa: `npm run lint`, `npm run typecheck`, `npm test`,
  `npm run build`.
- Exit code: 0 en las cuatro.
- Passed / failed / skipped: **1.514 passed, 0 failed, 9 skipped**, 78/78
  archivos; duración de Vitest 82,97 s.
- Fallos completos: ninguno.
- Clasificación: esperado.
- Evidencia manual adicional: pendiente `LA-018`; no se ejecutó código generado,
  navegador, modelo, benchmark ni API real.

### 2026-08-09 — Windows 11 — F4.3-T3

- Commit/base o diff: `feat/luxy-desktop` @ `59870c6`, más el diff local
  acumulado de Fase 4; cambios ajenos y secretos quedan fuera.
- Comando específico: build de `@luxy/shared` y Vitest sobre evaluaciones,
  composición de prompt, fixtures, registro y empaquetado de Desktop.
- Resultado específico: **55 pasadas, 0 fallos**, 4 archivos; 2 pruebas nuevas.
- Comprobación completa: `npm run lint`, `npm run typecheck`, `npm test`,
  `npm run build`.
- Exit code: 0 en las cuatro.
- Passed / failed / skipped: **1.516 passed, 0 failed, 9 skipped**, 78/78
  archivos; duración de Vitest 116,19 s.
- Fallos completos: ninguno.
- Clasificación: esperado.
- Evidencia manual adicional: pendiente `LA-018`; no hubo IPC, Gateway,
  proveedor, persistencia ni API real.

### 2026-08-09 — Windows 11 — F4.3-T4

- Commit/base o diff: `feat/luxy-desktop` @ `59870c6`, más el diff local
  acumulado de Fase 4; `package-lock.json`, secretos y demos ajenos preservados.
- Comando específico: build de `@luxy/shared` y Vitest sobre esquema de
  evaluación, compatibilidad de conversaciones, Gateway, aislamiento del agente
  y catálogo/fixtures.
- Resultado específico: **37 pasadas, 0 fallos**, 6 archivos; 7 pruebas nuevas.
- Comprobación completa: Prettier de archivos tocados, `npm run lint`,
  `npm run typecheck`, `npm test`, `npm run build`.
- Exit code: 0 en las cuatro comprobaciones obligatorias y en formato.
- Passed / failed / skipped: **1.523 passed, 0 failed, 9 skipped**, 80/80
  archivos; duración final de Vitest 73,00 s.
- Fallos durante desarrollo: dos expectativas iniciales. El Gateway leía el
  `dist` shared anterior antes de reconstruirlo; el agente aún ejecutaba checks
  para evaluaciones. Se reconstruyó shared y se generalizó la barrera de solo
  lectura; la repetición específica y la matriz completa quedaron verdes.
- Clasificación final: esperado.
- Evidencia manual adicional: pendiente `LA-018`; no hubo IPC de ejecución,
  proveedor, API real, migración ni deploy.

### 2026-08-09 — Windows 11 — F4.3-T5

- Commit/base o diff: `feat/luxy-desktop` @ `59870c6`, más el diff local
  acumulado; cambios ajenos, claves y demos preservados.
- Comando específico: build shared y Vitest sobre resultados de evaluación y
  cierre final del Gateway.
- Resultado específico: **18 pasadas, 0 fallos**, 2 archivos; 8 pruebas nuevas.
- Comprobación completa: Prettier de archivos tocados, `npm run lint`,
  `npm run typecheck`, `npm test` y `npm run build`.
- Exit code: 0 en todas.
- Passed / failed / skipped: **1.531 passed, 0 failed, 9 skipped**, 81/81
  archivos; duración final de Vitest 125,12 s.
- Fallos completos: ninguno.
- Clasificación: esperado.
- Evidencia manual adicional: ninguna necesaria para este contrato; `LA-018`
  sigue pendiente. No se llamó a modelos, APIs o precios ni se hizo deploy.

### 2026-08-09 — Windows 11 — F4.3-T6

- Commit/base o diff: `feat/luxy-desktop` @ `59870c6`, más el diff local
  acumulado; cambios ajenos y archivos sensibles preservados.
- Comando específico: Vitest sobre parser de historial, resultados, IPC y
  documentación.
- Resultado específico: **104 pasadas, 0 fallos**, 4 archivos; 4 pruebas nuevas.
- Comprobación completa: Prettier, `npm run lint`, `npm run typecheck`,
  `npm test` y `npm run build`.
- Exit code: 0 en todas.
- Passed / failed / skipped: **1.535 passed, 0 failed, 9 skipped**, 82/82
  archivos; duración final de Vitest 91,50 s.
- Fallos completos: ninguno.
- Clasificación: esperado.
- Evidencia manual adicional: `LA-018` ampliada; no hubo creación de trabajos,
  proveedor, precios, API de modelos, migración ni deploy.

### 2026-08-09 — Windows 11 — F4.3-T7

- Commit/base o diff: `feat/luxy-desktop` @ `59870c6`, más el diff acumulado;
  cambios ajenos y sensibles preservados.
- Comando específico: build shared y Vitest sobre catálogo, fixtures,
  resultados, contrato, Gateway, política/historial renderer y agente.
- Resultado específico: **50 pasadas, 0 fallos**, 8 archivos; 6 pruebas nuevas.
- Comprobación completa: Prettier, `npm run lint`, `npm run typecheck`,
  `npm test` y `npm run build`.
- Exit code: 0 en todas.
- Passed / failed / skipped: **1.541 passed, 0 failed, 9 skipped**, 83/83
  archivos; duración final de Vitest 147,94 s.
- Fallos completos: ninguno.
- Clasificación: esperado.
- Evidencia manual adicional: `LA-018` y `LA-019` pendientes. No se ejecutó un
  modelo, consultó precio, desplegó Gateway ni aplicó migración.

### 2026-08-09 — Windows 11 — F4.3-T8

- Commit/base o diff: `feat/luxy-desktop` @ `59870c6`, más el diff acumulado;
  archivos ajenos y sensibles preservados.
- Comando específico: Vitest sobre cancelación Gateway, resultado automático,
  historial/política del renderer y contrato de Studio.
- Resultado específico: **38 pasadas, 0 fallos**, 5 archivos; 2 pruebas nuevas.
- Comprobación completa: Prettier, `npm run lint`, `npm run typecheck`,
  `npm test` y `npm run build`.
- Exit code: 0 en todas.
- Passed / failed / skipped: **1.543 passed, 0 failed, 9 skipped**, 83/83
  archivos; duración final de Vitest 135,59 s.
- Fallos completos: ninguno.
- Clasificación: esperado.
- Evidencia manual adicional: `LA-018`/`LA-019` pendientes; no se ejecutó ni
  canceló un proveedor real, consultó precio o desplegó Gateway.

### 2026-08-09 — Windows 11 — checkpoint Modelos/Laboratorio

- Commit: `feat: incorpora modelos y laboratorio reproducible`.
- Validación usada para cerrar el checkpoint: 1.543 passed, 9 skipped, 0
  failed; lint, typecheck y build con exit 0.
- Comprobación del índice: `git diff --cached --check`, exit 0.
- Exclusiones: el cambio ajeno de `package-lock.json` y archivos sensibles/no
  relacionados no entraron en el commit.
- Push/deploy: no ejecutados.

### 2026-08-09 — Windows 11 — F4.3-T9

- Base: commit local `032f6f4` más cambios de T9 sin commit.
- Comando específico: Vitest de resultados, cierre fallido/cancelado e historial
  del renderer.
- Resultado específico: **30 pasadas, 0 fallos**, 4 archivos; 3 pruebas nuevas.
- Comprobación completa: Prettier, lint, typecheck, suite y build.
- Passed / failed / skipped: **1.546 passed, 0 failed, 9 skipped**, 83/83
  archivos; duración final 61,59 s.
- Exit code: 0 en todas. Fallos completos: ninguno.
- Evidencia manual: pendiente; no se llamó a proveedores, precios ni deploy.

### 2026-08-09 — Windows 11 — F4.3-T10

- Base: `032f6f4` más T9/T10 sin commit.
- Específicas: **19 pasadas, 0 fallos**, 3 archivos; 2 pruebas nuevas.
- Primera matriz: lint, tipos y 1.548 pruebas verdes; build falló por importación
  renderer apuntando al paquete shared.
- Corrección: importar agregador y constante desde `evaluation-history.ts`.
- Repetición completa final: lint exit 0, typecheck exit 0, **1.548 passed, 9
  skipped, 0 failed**, build exit 0; 83/83 archivos, 44,45 s de Vitest.
- Clasificación final: regresión de cableado detectada y corregida antes del
  cierre; no queda fallo abierto.
- Sin proveedor real, precios, deploy ni migración.

### 2026-08-09 — Windows 11 — F4.4-T1

- Base: `032f6f4` más T9/T10 y contrato de comparación sin commit.
- Específicas shared/Gateway: **32 pasadas, 0 fallos**, 2 archivos; 9 pruebas
  nuevas sobre campos inseparables, primer/segundo miembro, modelos distintos y
  divergencias de grupo, prompt, máquina o proyecto.
- Pruebas focalizadas de la evidencia previa: **32 pasadas, 0 fallos**, 4
  archivos.
- Typecheck inicial: 1 fallo por acceso no estrechado a la rama `error` de un
  `IpcResult` en `Laboratory.tsx`; corregido con ramas discriminadas explícitas.
- Repetición final: Prettier, lint, typecheck y build exit 0; **1.557 passed, 9
  skipped, 0 failed**, 83/83 archivos; Vitest 38,80 s.
- No se llamó a modelos, proveedores, precios, migraciones, deploy ni producción.

### 2026-08-09 — Windows 11 — F4.4-T2

- Base: `032f6f4` más T9/T10 y F4.4-T1/T2 sin commit.
- Específicas shared/Gateway/política/orquestador: **40 pasadas, 0 fallos**, 4
  archivos. Se añadieron 4 casos: política del segundo modelo y orden, corte tras
  rechazo inicial y aceptación parcial sin reintento.
- Matriz final: Prettier, lint, typecheck y build exit 0; **1.561 passed, 9
  skipped, 0 failed**, 84/84 archivos; Vitest 43,16 s.
- La prueba automatizada usa dobles IPC; no llamó a modelos, proveedores, precios,
  migraciones, deploy ni producción.

### 2026-08-09 — Windows 11 — F4.4-T3

- Base: commit local `3771549` más presentación conjunta sin commit.
- Primera ejecución específica: 46 pasadas y 3 fallos nuevos porque los fixtures
  históricos no contenían el snapshot completo requerido; el agregador los
  rechazó correctamente.
- Corrección: completar los fixtures. No se relajó el esquema ni el agregador.
- Específicas finales: **49 pasadas, 0 fallos**, 4 archivos; cubren metadata
  inseparable, par completo, parcial y miembro terminal sin resultado.
- Matriz final: lint, typecheck y build exit 0; **1.565 passed, 9 skipped, 0
  failed**, 84/84 archivos; Vitest 44,62 s.
- Sin modelos reales, proveedores, precios, migración, push ni deploy.

### 2026-08-09 — Windows 11 — F4.5/F4.6, cierre funcional

- Base: `3771549` más F4.4-T3/F4.5/F4.6 sin commit.
- F4.5 auditado: persistencia completa ya cubierta por pruebas Gateway, incluida
  respuesta de 20.000 caracteres; historial ampliado para conservar/exponer
  prompt, respuesta, proveedor, proyecto y máquina junto al resultado.
- F4.6: 6 pruebas nuevas para umbral de dos modelos × tres puntuados, exclusión
  de `not_scored`, desempate de rapidez, empate sin ganador, feedback repetido y
  aislamiento por proyecto/estado/modo.
- Endurecimiento final: evidencia rechazada si snapshot, resultado o prompt no
  coinciden; un UUID con contratos distintos se marca inválido.
- Focalizadas finales: **26 pasadas, 0 fallos**, 3 archivos.
- Matriz final: Prettier, lint, typecheck y build exit 0; **1.572 passed, 9
  skipped, 0 failed**, 85/85 archivos; Vitest 41,86 s.
- Alcance Modelos/Laboratorio: 100% implementado; evidencia manual pendiente.
- Sin modelos reales, precios, migración, push, deploy ni producción.

### 2026-08-09 — Windows 11 — selector ejecutable tras validación visual

- Evidencia: captura real con prueba Frontend seleccionada y bloqueo de
  runner/revisión pendiente.
- Clasificación: UX/selección, no fallo de la barrera de seguridad.
- Corrección: selector derivado de las cuatro definiciones automáticas; ocho
  fichas del catálogo conservadas.
- Específicas: **15 pasadas, 0 fallos**, 3 archivos; typecheck y lint exit 0.
- Matriz final: **1.572 passed, 9 skipped, 0 failed**, 85/85 archivos; build exit
  0; Vitest 50,16 s.
- No se ejecutó ningún modelo ni se consultaron precios.

### 2026-08-09 — Windows 11 — despliegue Gateway para validar comparación

- Primer deploy: rechazado por OAuth de una cuenta Cloudflare distinta; no cambió
  el Worker.
- Tras renovar sesión con la cuenta propietaria: `wrangler deploy` correcto para
  `luxy-gateway`, versión `b3fb5c99-5cf1-42a1-b011-f6d44b9f0730`.
- Smoke check: `/health` respondió **HTTP 200** y `status: ok`.
- No se ejecutaron modelos, no se consumieron tokens y no se consultaron precios.
- Pendiente: reiniciar Desktop/agente y repetir la comparación A/B.

## Plantilla

```markdown
### AAAA-MM-DD HH:MM — <entorno> — <ID>

- Commit/base o diff:
- Comando exacto:
- Exit code:
- Passed / failed / skipped:
- Duración:
- Fallos completos:
- Clasificación: regresión | ambiental | bloqueo | esperado.
- Evidencia manual adicional:
```
### 2026-08-20 — Windows 11 — UX-001

- Commit/base o diff: rama aislada `luxy/ux-001-detalle-trabajo`, sin commit.
- Comandos exactos: `npm.cmd run lint`; `npm.cmd test -- apps/agent/src/providers/providers.test.ts apps/desktop/src/shared/ipc.test.ts apps/desktop/src/main/worktree-directory.test.ts apps/desktop/src/renderer/studio-detail.test.ts`.
- Exit code: 0 en ambos.
- Passed / failed / skipped: lint sin errores; Vitest **105 passed, 0 failed**,
  4 archivos, 9,59 s.
- Duración: lint 38,7 s; Vitest 9,59 s.
- Fallos completos: la matriz que añadía `final-outcome.test.ts` hizo **118
  passed, 1 failed** porque el worktree no tenía `node_modules`; al enlazar los
  del checkout original, `@luxy/shared` resolvió su `dist` anterior y eliminó
  `callMetrics` al validar el cuerpo. No es evidencia contra el contrato fuente.
  `npm.cmd run typecheck` también falló por ese `dist` anterior, por faltar
  `@cloudflare/workers-types` y por un error preexistente en `Config.tsx`:
  falta `other` en un `Record<ProviderId, string>`.
- Clasificación: entorno de worktree y fallo preexistente; pendiente de matriz
  completa tras integrar y reconstruir las dependencias del worktree real.
- Evidencia manual adicional: ninguna; no se ejecutaron modelos, proveedores,
  precios, migración, deploy, commit ni push.

### 2026-08-20 — Windows 11 — UX-001, matriz completa

- Commit/base o diff: rama aislada `luxy/ux-001-detalle-trabajo`, sin commit.
- Comando exacto: `npm.cmd run typecheck`; `npm.cmd test`; `npm.cmd run build`.
- Exit code: 0 en los tres.
- Passed / failed / skipped: typecheck correcto; Vitest **1.574 passed, 14
  skipped, 0 failed**, 87 archivos, 59,37 s; build correcto de los cinco
  workspaces.
- Duración: typecheck 17,3 s; Vitest 59,37 s; build 16,4 s.
- Fallos completos: ninguno. El incidente de dependencias de la entrada anterior
  quedó resuelto con `npm ci --ignore-scripts` dentro del worktree.
- Clasificación: validación completa correcta.
- Evidencia manual adicional: ninguna; no se ejecutaron modelos, proveedores,
  precios, migración, deploy ni push.

### 2026-08-10 10:08 — Windows 11 — F4.8-T2-DEPLOY

- Base: rama `luxy/auto-init-git`, cambios de F4.8-T1/T2 sin commit.
- Build Gateway: exit 0.
- Suite Gateway/shared: **641 pasadas, 0 fallos**, 37 archivos; Vitest 8,45 s.
- Primer dry-run sin configuración local: exit 1, clasificado ambiental; el
  worktree no contiene el `wrangler.toml` ignorado por Git.
- Dry-run final con configuración equivalente por argumentos: exit 0; bundle
  467,92 KiB, gzip 105,63 KiB.
- Deploy autorizado: exit 0; Worker `luxy-gateway`, versión
  `33da28e0-4a72-4c0b-8661-50d1cc838dec`, cron `*/1 * * * *`.
- Smoke check: `/health` respondió **HTTP 200**, `status: ok` y
  `configured: true`.
- No se ejecutaron modelos, migraciones, commit ni push.

### 2026-08-10 10:25 — Windows 11 — F4.8-T2-TIMEOUT-RESTART

- Build completo del monorepo: exit 0; shared, agent, desktop y gateway
  compilados.
- Deploy autorizado: exit 0; Worker `luxy-gateway`, versión
  `a5cb5ba8-34d9-4cca-85ba-e02f95e3942f`, cron `*/1 * * * *`.
- Smoke check: `/health` respondió **HTTP 200**, `status: ok` y
  `configured: true`.
- Arranque: proceso principal de Electron apunta a
  `apps/desktop` del worktree `lux-auto-init-git`; ventana `Luxy` responde.
- No se ejecutaron modelos ni se pulsó **Reintentar**.

### 2026-08-11 — Windows 11 — OPS-BAT-LAUNCHERS

- `rebuild-luxy.bat no-pause`: exit 0.
- Build completo de shared, agent, desktop y gateway: correcto.
- `git diff --check`: sin errores.
- No se ejecutaron modelos ni se cambió el Gateway.

### 2026-08-11 — Windows 11 — UI-LAB-LAYOUT

- Prettier sobre `Laboratory.tsx` y `styles.css`: aplicado.
- Lint: exit 0.
- Typecheck: exit 0.
- Desktop: **328 pasadas, 0 fallos**, 22 archivos; Vitest 4,89 s.
- Build completo: exit 0.
- `git diff --check`: sin errores.
- Desktop reconstruido y reiniciado; sin modelos reales, deploy ni migraciones.

### 2026-08-11 — Windows 11 — UI-LAB-LAYOUT-FOLLOWUP

- Prettier check: correcto.
- Lint: exit 0.
- Build de Desktop: exit 0.
- `git diff --check`: sin errores.
- Desktop reiniciado; cambio exclusivamente CSS.

### 2026-08-11 — Windows 11 — F4.3-T11

- Pruebas focalizadas iniciales: 5 fallos por expectativas antiguas de los dos
  Qwen retirados; se actualizaron al catálogo observado, sin ocultarlos.
- `npm.cmd run check`: exit 0.
- Lint: exit 0; typecheck: exit 0.
- Suite: **1.581 pasadas, 9 omitidas, 0 fallos**, 85 archivos; Vitest 45,18 s.
- Build completo: exit 0; renderer generado como `index-HRYQd_Kq.js`.
- No se ejecutaron APIs ni modelos reales.

### 2026-08-11 — Windows 11 — OPS-GATEWAY-BAT

- Primer `deploy-gateway.bat check`: exit 1; Wrangler ignoró la extensión
  `.example` y no encontró el entry point. No hubo despliegue.
- Segundo `deploy-gateway.bat check`: exit 0; Shared y Gateway compilaron;
  dry-run 468,11 KiB / gzip 105,68 KiB; configuración temporal eliminada.
- No hubo deploy, migraciones ni cambios de secretos.

### 2026-08-11 — Windows 11 — UI-LAB-CONFIRM

- Focalizadas de Laboratorio: 20 pasadas, 0 fallos.
- `npm.cmd run check`: exit 0.
- Suite: **1.581 pasadas, 9 omitidas, 0 fallos**, 85 archivos; Vitest 54,50 s.
- Lint, typecheck y build completo: correctos.
- Bundle Desktop: `index-x1qEdl4I.js`, CSS `index-CzFkHRlN.css`.
- Falta validación manual del foco de Electron tras una evaluación real.
