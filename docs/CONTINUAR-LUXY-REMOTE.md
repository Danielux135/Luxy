# Continuar Luxy Remote — estado y siguientes pasos

> **Documento histórico.** Desde el traspaso canónico del 1 de agosto de 2026,
> Luxy Remote está pausado y se conserva como módulo experimental. La prioridad
> activa es Luxy Studio para Windows y, después, Luxy Mobile para Android. No
> continúes las fases Remote ni apliques `0004_luxy_remote.sql` por este documento.

Documento de traspaso. Si estás retomando esto en una conversación nueva —da
igual con qué asistente— aquí está todo lo necesario para seguir **sin volver a
investigar nada y sin empezar de cero**.

Léelo entero antes de tocar código. Está ordenado para eso: qué es (0), dónde
está el repositorio (1), qué se decidió y por qué (2), qué existe ya (3), qué se
rompió una vez y no puede volver a romperse (4), qué falta (5), qué necesita
permiso de Daniel (6), cómo se ejecuta y se verifica (7) y con qué prompt
arrancar (8).

---

## 0. Qué es esto

Luxy Remote convierte Luxy en una plataforma de control remoto personal.

**Objetivo principal:** desde un Android, conectarse a un PC Windows emparejado
—aunque esté fuera de casa— para ver la pantalla, controlar ratón y teclado,
cambiar de monitor, y administrar Luxy (lanzar tareas de IA, aprobar commits).

**Objetivo secundario, después:** Windows → Android (ver y controlar el móvil).

### Restricciones que no se negocian

- **iOS está FUERA DEL ALCANCE.** No implementar nada. `DEVICE_KINDS` es
  `['desktop','android']`. Está decidido y documentado.
- **Coste obligatorio 0 €.** Nada de servicios de pago, tarjetas, VPS,
  certificados, Play Store ni App Store. Si un plan gratuito puede empezar a
  cobrar, debe haber un límite duro antes.
- **Uso exclusivamente personal.** No hay multiusuario, ni cuentas públicas, ni
  facturación, ni requisitos comerciales.
- **No hacer push. No desplegar. No ejecutar migraciones.** Sin autorización
  explícita del usuario, cada vez.
- **No declarar terminada una función sin haberla probado.**

### Cómo trabaja el usuario

Daniel es hispanohablante, en Windows 11. Espera:

- Actualizaciones **breves** al terminar cada fase: qué funciona, qué no,
  archivos, pruebas, commit, siguiente paso, qué necesita de él. Los detalles
  técnicos largos van a `docs/`, no al chat.
- **Verificación real.** La costumbre establecida en este proyecto es: tras
  implementar una protección, **revertirla y comprobar cuántas pruebas fallan**.
  Si no falla ninguna, la prueba no vale. Esto se ha hecho en cada fase y hay que
  seguir haciéndolo.
- Que se distinga siempre **lo probado** de **lo sólo escrito**.
- Comentarios en el código que expliquen **por qué**, no qué. En español, sin
  tildes en el código (por consistencia con el resto del repo).

---

## 1. Estado exacto del repositorio

- Rama base `feat/luxy-desktop`; Fase 4d en el worktree aislado
  `luxy/phase-4d-session-host`, **todo en local, sin push**.
- Último commit: `3ec8dea` (+ Fases 4c y 4d sin commitear todavía)
- **1262 tests en verde** (9 omitidos), lint, typecheck y build limpios.

### Commits de Luxy Remote, en orden

```
359975b  fases 0 y 1: investigacion, ADRs, threat model, remote-protocol
fe0084f  fase 1b: criptografia de identidad, emparejamiento persistente, migraciones
70886f8  fase 2 (nucleo): autenticacion por firma y flujo de emparejamiento
31fdfa9  fase 2: endpoints de emparejamiento y dispositivos en el gateway
30c2af2  cliente de gateway del escritorio
c51867c  seguridad: arreglados los siete hallazgos de la revision
b49e486  anclaje local de las claves de los pares
472a925  fase 3a: firma del SDP y maquina de estados de la sesion
745bfb3  fase 3b: transporte de senalizacion y negociacion completa
3bb28de  fase 4a: geometria de monitores
8b2fd6d  fase 4b: despacho de entrada
```

---

## 2. Decisiones ya tomadas (NO reabrir sin motivo nuevo)

Las cinco están documentadas en `docs/adr/`. Resumen de por qué, para no tener
que releerlas:

| Decisión                                                    | Motivo en una línea                                                                                                                                                                                    |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **P-256**, no Ed25519                                       | Única curva con respaldo hardware en Android StrongBox. Ed25519 dejaría la clave en software.                                                                                                          |
| **Supabase Realtime** para señalización, no Durable Objects | La señalización son ~40 mensajes. DO ya es gratis (desde abr-2025) pero es sobreingeniería.                                                                                                            |
| **Cloudflare TURN**                                         | 0,05 $/GB con **1.000 GB gratis** ≈ 660 h/mes. Twilio cuesta 8× y sin free tier.                                                                                                                       |
| **React Native + Expo**, no Flutter                         | Permite compartir `packages/remote-protocol` (Zod) literalmente. Flutter obligaría a duplicar el protocolo en Dart, y ahí es donde se desincroniza en silencio. Y EAS Build compila iOS desde Windows. |
| **Renderer oculto** de Electron para captura/WebRTC         | `utilityProcess` no tiene pila de medios. La captura y el encoder van en el proceso GPU, no bloquean.                                                                                                  |
| **Proceso auxiliar** para la entrada, no addon              | El DPI awareness **no se puede cambiar** una vez creadas las ventanas. Un addon hereda el de Electron y no puede corregirlo.                                                                           |

### Datos técnicos verificados que ahorran investigación

- **Electron 43 = Chromium 150 + Node 24.17**, ABI de módulo nativo **148**.
- Chromium ya elige WGC (Win11 24H2+) o DXGI, ya suprime el borde amarillo y ya
  da 0 Hz. **No implementar captura**: `desktopCapturer.getSources()` +
  `setDisplayMediaRequestHandler`.
- `getDisplayMedia` **no acepta `deviceId`**: el monitor se elige en el main
  correlacionando `display_id` con `screen.getAllDisplays()`.
- Audio del sistema: `audio: 'loopback'`, **sólo Windows**, documentado.
- `SendInput`: `MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK`, 0..65535 sobre
  el escritorio virtual. **Divisor `(ancho-1)`, no `ancho`.** Nunca modo
  relativo (la aceleración lo multiplica hasta ×4).
- Teclado: `KEYEVENTF_SCANCODE` para teclas y atajos, `KEYEVENTF_UNICODE` **sólo**
  para texto (exige `wVk=0` y no combina con modificadores; emoji fuera del BMP
  van como par de surrogates).
- **`SendInput` falla EN SILENCIO contra apps elevadas.** Ni el retorno ni
  `GetLastError` lo indican. Ya está el mensaje al usuario en
  `describeElevatedBlock`.
- Escritorio seguro, UAC y pantalla de bloqueo: **imposibles** sin
  `LOCAL_SYSTEM`. No intentar sortearlo.
- **TURN será la ruta habitual (30-50%)**, no la excepción: móvil en CGNAT hacia
  PC doméstico. Habilitar IPv6 es la mitigación de mayor retorno.
- Librerías: `react-native-webrtc` oficial está anclado a libwebrtc M124
  (jun-2024). Usar **`@stream-io/react-native-webrtc`** (M145, MIT) y aislar
  WebRTC tras interfaz propia.
- **No copiar código de RustDesk (AGPL), Sunshine ni Moonlight (GPL-3).**
  Permisivas: libwebrtc (BSD), flutter_webrtc, Pion, werift, coturn.

---

## 3. Lo que YA está construido

Todo lo de abajo tiene pruebas y está verificado revirtiendo protecciones, **salvo
el apartado marcado explícitamente como "sin prueba automática"**. Esa distinción
es la que hay que mantener al entregar cualquier fase: lo probado y lo sólo
escrito no valen lo mismo.

### `packages/remote-protocol`

- `version.ts` — versión del protocolo, comprobación de compatibilidad que dice
  **quién** está desactualizado.
- `capabilities.ts` — matriz de capacidades por plataforma, con el motivo de
  cada ausencia.
- `envelope.ts` — sobre con `v/sid/seq/ts`, anti-replay por secuencia
  estrictamente creciente, ventana de reloj de 2 min, tamaño medido en **bytes
  UTF-8** (no `length`).
- `control.ts` — ratón, teclado, texto, `input.release_all`, monitor, calidad.
  **Coordenadas normalizadas 0..1**, nunca píxeles.
- `guard.ts` — **la puerta única**. Seis comprobaciones en orden deliberado; nada
  muta estado hasta que todo lo demás pasa.
- `session-state.ts` — máquina de estados del host. Intersección de permisos,
  revocación en caliente, timeouts.
- `signaling.ts` — interfaz de transporte + `InMemorySignaling` (que simula
  pérdida y duplicación).
- `negotiation.test.ts` — **la prueba de integración**: de la petición al primer
  clic con toda la pila.

### `packages/remote-crypto`

- `identity.ts` — P-256, firma con **separación de dominios** (el contexto va
  dentro de lo firmado), huella, **palabras de confirmación conmutativas**
  (256 palabras exactas), `canonicalPublicKey`.
- `pairing.ts` / `pairing-flow.ts` — QR con caducidad, código de un solo uso,
  máquina de emparejamiento.
- `request-auth.ts` — autenticación de peticiones por firma (no token portador).
- `sdp-auth.ts` — **firma del SDP**, que es lo que impide que un gateway
  comprometido escuche. Exige huella DTLS. Verifica firma **antes** de mirar el
  contenido.

### `apps/gateway`

- `handlers/remote.ts` — `pair/start`, `pair/claim`, `pair/confirm`,
  `pair/:code/state`, `devices`, `devices/:id/access`, `devices/:id/revoke`.
  `withDeviceAuth` es la puerta única.
- `remote-repository.ts` — tablas de control remoto.
- `handlers/remote-memoria.ts` — base en memoria para pruebas que respeta la
  atomicidad del nonce y el filtro por estado.

### `apps/desktop/src/main`

- `remote-identity.ts` — clave privada bajo DPAPI/safeStorage. **Falla si no hay
  cifrado del sistema**, no guarda en claro.
- `remote-client.ts` — cliente del gateway. Firma peticiones. Las palabras se
  calculan **en local**.
- `remote-pairing.ts` — **ancla la clave del par en disco** + `compareWithLocal`,
  que detecta las cuatro mentiras posibles de un gateway comprometido.
- `remote-host/monitors.ts` — geometría y conversión de coordenadas.
- `remote-host/input-dispatcher.ts` — estado de teclas pulsadas, `releaseAll`.
- `remote-host/keycodes.ts` — scancodes del set 1 y troceo UTF-16 sin partir
  surrogates.
- `remote-host/input-plan.ts` — **todas las banderas de `SendInput`**, en código
  puro y con las pruebas que comprueban los números exactos.
- `remote-host/display-sources.ts` — correlación `display_id` ↔ `getAllDisplays`.
- `remote-host/session-indicator.ts` — texto del aviso visible (la ventana no
  tiene prueba; el texto sí).
- `remote-host/session-host.ts` — orquestador inyectable: sesión, SDP firmado,
  dos ventanas anti-replay, captura/entrada sincronizadas y cierre seguro.
- `main/index.ts` — ciclo de vida de captura, eventos de monitores y cierre de
  la sesión al salir de Luxy.
- `src/shared/codec-preferences.ts` — orden AV1→VP9→H.264, `contentHint`,
  `degradationPreference`, perfiles de calidad.
- `src/shared/capture-ipc.ts` — contrato con el renderer oculto y los **dos
  canales de datos**.

### Escrito y verificado a mano, SIN prueba automática
- `remote-host/input-backend-koffi.ts` — `user32!SendInput` con koffi.
- `remote-host/capture-window.ts` — renderer oculto, sesión propia,
  `setDisplayMediaRequestHandler`.
- `src/renderer/capture/main.ts` + `src/preload/capture.ts` — motor WebRTC.

### `supabase/migrations/0004_luxy_remote.sql`

**PREPARADA, NO EJECUTADA.** Tablas: `remote_devices`, `remote_pairing_codes`,
`remote_sessions`, `remote_auth_nonces` (PK compuesta `(device_id, nonce)`),
`remote_audit`. RLS habilitada en las cinco, sin políticas: sólo el service role.

---

## 4. Fallos ya encontrados y corregidos — NO reintroducir

Esta lista existe porque cada uno costó una prueba roja o una revisión de
seguridad. Son las trampas reales de este dominio.

1. **El emparejamiento se podía completar sin ningún humano.** `pair/start` y
   `pair/confirm` no estaban autenticados y el bando lo elegía el cliente.
   → Ahora cada paso exige firma; la de confirmación incluye **las dos** claves.

2. **Cuatro cadenas base64url distintas son la misma clave P-256.** 65 bytes no
   es múltiplo de 3: el último carácter lleva 2 bits que `atob` ignora. El índice
   único es sobre texto, así que un revocado volvía a emparejarse con una
   variante. → Se **exige** forma canónica.

3. **El gateway dictaba las palabras de confirmación.** El ancla anti-sustitución
   la proporcionaba la parte no confiable. → Cada lado las calcula en local.

4. **El escritorio no anclaba las claves de sus pares**, así que la única fuente
   sobre "con quién estoy emparejado" era el gateway. → `PairingCoordinator`
   ancla al confirmar.

5. **El nonce se registraba antes de verificar la firma**, permitiendo escribir
   en la tabla sin firma válida. → Ahora después.

6. **Los códigos de error eran un oráculo** (distinguían "no existe" de "firma
   mala" de "revocado"). → Colapsados a `unauthorized`.

7. **La geometría física de los monitores no se puede deducir de los DIP.**
   Multiplicar cada origen por su escala hace que **se solapen**: con un portátil
   4K al 150% y un externo 1080p, el escritorio mide 4480 en vez de 5760 y todo
   clic en el secundario cae >1000 px desviado. En el primario parece funcionar.
   → `DisplayInfo.physical` lo aporta el auxiliar; sin él se avisa de que el
   cursor **caerá** mal.

8. **`dispatch` propagaba excepciones del backend**, así que un clic fallido
   podía tumbar la sesión. → Informa como resultado.

9. **`SendInput` no reinicia el teclado.** Un corte con Ctrl pulsado lo deja
   hundido. → Estado de pulsados + `releaseAll`, que no se corta si algo falla.

10. **`releaseAll` teletransportaba el cursor.** Soltaba los botones pasando
    `{dx:0, dy:0}` porque a ciegas no se sabe dónde está el cursor. Con el
    backend real eso emite `MOUSEEVENTF_MOVE` a la esquina: cortar la sesión con
    un botón pulsado movía el ratón del usuario a la esquina superior izquierda.
    → `InputBackend.mouseButton` acepta `point: AbsolutePoint | null`, y con
    `null` **no se emite ningún movimiento**.

11. **El canal no fiable choca con el anti-replay.** El plan pedía un DataChannel
    no ordenado para el control, pero `acceptEnvelope` exige secuencia
    **estrictamente creciente**: si llegan 5, 7 y 6, el 6 se rechaza como
    `replayed`. Para un movimiento de ratón da igual; para una tecla significa
    que al usuario **le faltan letras**, de forma intermitente y sólo con mala
    red. Bajar la exigencia del anti-replay habría debilitado justo la protección
    contra reinyectar un "clic en Aceptar". → **Dos canales**: `luxy-input`
    (no ordenado, sin retransmisión) sólo para `mouse.move` y `mouse.scroll`, y
    `luxy-control` (fiable y ordenado) para todo lo demás. Cada uno lleva su
    propia `ReplayWindow`, que `guardControlMessage` ya soporta sin cambios.
    **El cliente móvil de la Fase 5 tiene que abrir los dos y numerarlos por
    separado.**

12. **`display.label` viene vacía en Windows.** Comprobado en Electron 43: cadena
    vacía en un portátil. Sin respaldo, el selector de monitor del móvil saldría
    con botones sin texto. → Cascada label → nombre de la fuente → "Pantalla del
    portátil" → "Monitor N".

13. **`setCodecPreferences` reemplaza la lista entera.** Filtrar dejando sólo los
    códecs de vídeo elimina `rtx`, es decir la retransmisión, y cada paquete
    perdido pasa a ser un bloque congelado hasta el siguiente fotograma clave.
    Justo en la ruta por TURN desde 4G, que es la habitual. → Se **ordena**, no
    se filtra: nada se elimina nunca.

---

## 5. Lo que FALTA, en orden

### FASE 4 (orquestador probado; falta el transporte real) — Host de Windows

- [x] Renderer oculto dedicado (`BrowserWindow` con `show:false`) para captura y
      `RTCPeerConnection`. Sesión propia (`partition: luxy-capture`) para no
      relajar los permisos de la interfaz.
- [x] `setDisplayMediaRequestHandler` + `desktopCapturer.getSources({types:['screen']})`
      con `thumbnailSize:{width:0,height:0}`.
- [x] Correlacionar `display_id` con `screen.getAllDisplays()`.
- [x] `RTCPeerConnection` con `contentHint='text'` y
      `degradationPreference='maintain-resolution'`. AV1 → VP9 → H.264 → VP8.
- [x] DataChannel no fiable y no ordenado — **partido en dos canales**, ver el
      fallo 11.
- [x] `InputBackend` con **koffi** llamando a `user32!SendInput`.
- [x] Indicador visible y persistente + botón de cortar.
- [x] IPC entre main y renderer oculto, con el control cruzando **como texto
      opaco** para que un renderer comprometido no se salte `guardControlMessage`.

- [x] **Orquestador implementado y probado sin Electron.** Ver el estado de la
      Fase 4d más abajo.
- [ ] **PENDIENTE: transporte/listener real de Supabase Realtime.** El contrato
      `SignalingTransport` y `InMemorySignaling` existen, pero Desktop todavía
      no tiene un adaptador de producción que reciba `session.request` y adopte
      el `SessionHost` en la ranura conectada en `main/index.ts`.

#### Verificado empíricamente en este equipo (Electron 43, Windows 11)
Sonda ejecutada dentro de Electron, no deducido:
- koffi 3.1.4 carga en Electron 43. **No hace falta recompilar para el ABI 148**:
  koffi usa N-API 8, que es ABI estable.
- `koffi.sizeof(INPUT)` = 40 en x64, que es lo correcto.
- `SendInput` mueve el cursor de verdad: **0 px de error** contra el objetivo.
- `desktopCapturer` devuelve `display_id: "116357464"` y
  `screen.getAllDisplays()[0].id` es `116357464`. La correlación es exacta.
- `display.label` vino **vacía**.
- `new BrowserWindow({show:false})` se crea y no es visible.

#### Lo que sigue SIN probar y sólo puede probar Daniel
- Que el vídeo llegue de verdad y que AV1/VP9 se negocien en su GPU.
- Multi-monitor: este equipo tiene una sola pantalla, así que la correlación con
  varios monitores y la geometría con escalas mixtas están sin ejercitar.
- El bloqueo UIPI contra ventanas elevadas.
- El indicador flotando sobre una aplicación a pantalla completa.
- Que koffi sobreviva al empaquetado (`asarUnpack` está puesto, no comprobado).
- El enganche de ciclo de vida de `main/index.ts` compila y su ranura tiene
  prueba sin Electron, pero no se ha ejecutado una sesión real porque falta el
  adaptador/listener de Supabase Realtime y todavía no existe el cliente móvil.

---

### FASE 4d — El orquestador (IMPLEMENTADO Y PROBADO SIN ELECTRON)

Estado actual: `session-host.ts` une todas las piezas mediante interfaces
inyectables y `main/index.ts` conecta captura, cambios de pantalla y apagado. Las
20 pruebas nuevas cubren sólo visualización, canal equivocado, ventanas de replay
separadas, SDP alterado y renegociado, revocación en caliente, límite UTF-8, las
10 causas de cierre y `releaseAll()` antes de `dispose()`.

El ritual de mutaciones revirtió 10 protecciones: las 10 rompieron pruebas. Nueve
provocaron 1 fallo, compartir una lista distinta de monitores provocó 2 y disponer
captura antes de liberar entrada provocó 14. El script temporal se borró después.

**Límite que no debe ocultarse:** `SignalingTransport` tiene interfaz y transporte
en memoria, no adaptador Supabase Realtime de producción. Por eso el orquestador
está probado de extremo a extremo en memoria, pero un móvil real aún no puede
originar `session.request` en Desktop.

Los componentes existen y están probados, pero **nadie los une**: hoy no hay
ningún camino que vaya de un mensaje del móvil a un clic. Falta un archivo,
`apps/desktop/src/main/remote-host/session-host.ts`, y engancharlo en
`main/index.ts`.

**No hay que diseñar nada nuevo.** Todas las piezas existen y sus firmas son
éstas (comprobadas, no de memoria):

```ts
// packages/remote-protocol/src/session-state.ts
class RemoteSession {
  constructor(sessionId: string, deviceId: string, policy: SessionPolicy)
  request(requested: readonly Capability[], now: number): RequestOutcome
  userDecision(accepted: boolean, granted: readonly Capability[], now: number): boolean
  beginNegotiation(fingerprints: readonly string[], now: number): boolean
  activate(now: number): boolean
  touch(now: number): boolean
  checkExpiry(now: number, deviceStillActive: boolean): SessionEndCause | null
  end(cause: SessionEndCause, now: number): void
  activeCapabilities(): readonly Capability[]
  snapshot(): SessionSnapshot
}

// packages/remote-protocol/src/guard.ts
guardControlMessage(raw: string, context: GuardContext): GuardResult
// GuardContext = { sessionId, granted, window: ReplayWindow, active, now?, maxBytes? }

// packages/remote-protocol/src/envelope.ts
newReplayWindow(): ReplayWindow

// packages/remote-crypto/src/sdp-auth.ts
signSdp(...)                 // firma la oferta ANTES de mandarla
verifySdp(mensaje, options)  // verifica la respuesta ANTES de mirar su contenido
extractFingerprints(sdp: string): string[]
fingerprintsUnchanged(antes, ahora): boolean

// packages/remote-protocol/src/signaling.ts
interface SignalingTransport   // interfaz + InMemory; falta adaptador de producción
acceptSignaling(...): SignalingVerdict
```

**Lo que tiene que hacer `SessionHost`, en orden:**

1. Al llegar `session.request`: crear `RemoteSession`, llamar a `request()`,
   preguntar al usuario, `userDecision()`.
2. **Dos `ReplayWindow`, una por canal.** `newReplayWindow()` dos veces, guardadas
   en un `Record<DataChannelKind, ReplayWindow>`. Ésta es la razón de ser del
   fallo 11: si se comparte una sola, el canal no ordenado envenena la secuencia
   del fiable y se caen las teclas.
3. `CaptureHost.refreshDisplays()` → `InputDispatcher.updateDisplays()` con esos
   mismos `DisplayInfo`. **La misma lista para los dos**, o el ratón y el vídeo
   apuntarán a monitores distintos.
4. `CaptureHost.installDisplayMediaHandler(() => dispatcher.currentMonitorId())`.
   Así el monitor que se captura y el monitor sobre el que cae el cursor salen
   del mismo sitio por construcción.
5. `send({type:'start', ...})` con la fuente resuelta por `resolveSource()`.
6. Al recibir `{type:'offer'}` del renderer: `signSdp` y mandarlo por la
   señalización. Al recibir la respuesta: `verifySdp` **antes** de mirarla, y
   `beginNegotiation(extractFingerprints(sdp))`.
7. Al recibir `{type:'control', channel, raw}`:
   - `channelMatches(tipo, channel)` — rechazar si no cuadra;
   - `guardControlMessage(raw, { ..., window: ventanas[channel] })`;
   - si pasa: `dispatcher.dispatch(message)` y `session.touch(now)`.
   - **Nunca al revés.** El guard es la puerta única.
8. Indicador: `show()` al activar, `update()` cada minuto, `hide()` al terminar.
   `controlling` = si `activeCapabilities()` incluye `control`.
9. Al terminar por cualquier vía (usuario, timeout, revocación, fallo de
   transporte, cierre de Luxy): **`dispatcher.releaseAll()` SIEMPRE**, y después
   `captureHost.dispose()`. Si no, quedan teclas hundidas en el ordenador.
10. `checkExpiry()` en un temporizador; también hay que reaccionar a
    `screen.on('display-added'/'display-removed'/'display-metrics-changed')`
    llamando a `refreshDisplays()` + `updateDisplays()`.

**Se puede probar entero sin Electron** si `CaptureHost`, `InputBackend` y
`SessionIndicator` se inyectan como interfaces: es exactamente lo que ya hace
`negotiation.test.ts` con la pila de señalización. Pruebas que deben existir:
una sesión de sólo visualización que no mueve el ratón; un mensaje por el canal
equivocado; una revocación en caliente a mitad de sesión; y que al cortar por
cada una de las causas se llama a `releaseAll`.

### FASE 5 — Luxy Mobile Android mínimo

- [ ] Proyecto React Native + Expo con **development build** (Expo Go no sirve).
- [ ] `@config-plugins/react-native-webrtc` + `@stream-io/react-native-webrtc`.
- [ ] Importar `@luxy/remote-protocol` y `@luxy/remote-crypto` tal cual.
- [ ] **Abrir los DOS DataChannels** (`luxy-input` y `luxy-control`) con su
      numeración de secuencia independiente. Ver el fallo 11.
- [ ] Clave P-256 en **Android Keystore** (StrongBox si hay). Requiere módulo
      nativo propio con Expo Modules API.
- [ ] Escaneo QR (`expo-camera`), almacén seguro (`expo-secure-store`, **no**
      `react-native-keychain`).
- [ ] Lista de dispositivos, estado, conectar, vídeo, desconectar.
- [ ] **APK firmado por sideload.** Nada de Play Store.

### FASE 6 — Control desde el móvil

- [ ] Modo trackpad y modo táctil directo.
- [ ] Gestos: toque=clic, doble=doble, largo=derecho, dos dedos=scroll, arrastre.
- [ ] Barra de teclado con Ctrl/Alt/Shift/Tab/Esc/Win.
- [ ] Cambio de monitor, `release_all` al perder el foco.

### FASE 7 — Fuera de la LAN

- [ ] Credenciales TURN efímeras generadas por el Worker
      (`POST /v1/turn/keys/$ID/credentials/generate-ice-servers`).
- [ ] **Límite duro de consumo antes de la cuota facturable.** Requisito del
      usuario: cero posibilidad de cargo.
- [ ] Estadísticas: RTT, pérdida, bitrate, códec, y **si va directa o por relay**.
- [ ] Reconexión, cambio Wi-Fi↔datos.

### FASE 8 — Integración con Luxy en el móvil

Reutilizar los contratos existentes. **No duplicar el sistema de trabajos.**

- [ ] Máquinas, proyectos, modelos, formulario de tarea.
- [ ] Progreso, logs, diff, pruebas, cancelar.
- [ ] Aprobar commit, **doble confirmación de push**.

### FASE 9 — Complementarias

Portapapeles, archivos, audio, perfiles de calidad, historial, Wake-on-LAN.

### FASE 10 — Windows controla Android

Sólo después de lo anterior. MediaProjection + Shizuku/ADB. **No publicable en
Play**, y Android 17 revoca AccessibilityService en Modo de Protección Avanzada.

### Interfaz (`/frontend-design`, tres pasadas separadas)

Sólo cuando el recorrido técnico correspondiente funcione:

1. Emparejamiento y dispositivos en Desktop.
2. Luxy Mobile.
3. Pantalla de control remoto.

---

## 6. Registro histórico de autorizaciones — no ejecutar mientras Remote siga pausado

Pendientes, con lo que hay que decirle:

**A. Ejecutar la migración `0004_luxy_remote.sql` en su Supabase — PAUSADA**

- Motivo: sin las tablas, nada del emparejamiento funciona contra el servidor real.
- Comando: pegar el SQL en el editor de Supabase, o `supabase db push`.
- Coste: 0 €.
- Riesgo: bajo, sólo crea tablas nuevas; no toca las existentes.
- Verificar: `select count(*) from public.remote_devices;` debe devolver 0.

**B. Desplegar el Worker**

- Motivo: los endpoints de control remoto sólo viven en el código local.
- Comando: `cd apps/gateway && npx.cmd wrangler deploy`
- Coste: 0 €, dentro del plan gratuito.
- Verificar: `GET /health` responde, y `POST /api/remote/pair/start` sin firma
  devuelve 401.

**C. Activar TURN de Cloudflare** — cuando llegue la Fase 7. Free tier 1.000 GB.
Comprobar antes que no exige activar facturación.

**D. Probar con dispositivos reales.** A partir de la Fase 4 hay cosas que sólo
Daniel puede verificar: que el cursor caiga donde debe, que el vídeo llegue, que
funcione desde 4G.

**E. Conectar un segundo monitor** cuando se quiera cerrar la Fase 4.
- Motivo: el equipo de desarrollo tiene **una sola pantalla**. La correlación con
  varios monitores y toda la geometría con escalas mixtas —que es donde está el
  fallo 7, el más caro de la lista— están escritas y probadas con datos
  sintéticos, pero **nunca ejercitadas contra Windows de verdad**.
- Lo que hay que mirar: que el cursor caiga donde debe en el monitor secundario,
  y que `monitorWarnings()` avise si las escalas no coinciden.

**F. Empaquetar y probar el instalador** (`cd apps/desktop && npm run package`).
- Motivo: `asarUnpack` de koffi está configurado pero **no comprobado**. Si está
  mal, el control de ratón y teclado falla sólo en la versión instalada, no en
  desarrollo, que es la peor forma posible de descubrirlo.
- Verificar: que existe `resources/app.asar.unpacked/node_modules/koffi` y que el
  ratón se mueve desde la aplicación instalada.

---

## 7. Comandos del proyecto

```bash
npm run typecheck      # tsc -b
npm run lint           # eslint
npm test               # vitest run
npm run build          # todos los workspaces
npm run check          # los cuatro

npx vitest run <ruta>                      # un archivo
npx vitest run <ruta> --reporter=basic     # cuenta de fallos legible

cd apps/desktop && npm run package         # instalador Windows
```

### Avisos prácticos del entorno (ya costaron tiempo una vez)

- Los **heredocs de bash** se rompen a menudo con contenido que lleva comillas.
  Para parchear archivos, escribir un script Python y ejecutarlo es más fiable.
  PowerShell `Set-Content -Encoding utf8` mete BOM y rompe JSON.
- **`ELECTRON_RUN_AS_NODE`**: VS Code y otros hosts la exportan. Con esa variable
  puesta, `electron.exe` se comporta como Node puro y aborta con
  `Assertion failed: (isolate_data->snapshot_data()) != nullptr`. Para ejecutar
  Electron de verdad hay que **desactivarla**, no ponerla vacía:
  `env -u ELECTRON_RUN_AS_NODE npx electron <script>`.
- **koffi y los install scripts**: npm los bloquea en este repo
  (`npm warn allow-scripts`). No importa: koffi trae los binarios precompilados
  en la dependencia opcional `@koromix/koffi-win32-x64`, y carga igualmente.
- Al capturar salida de procesos desde Python en Windows hay que forzar
  `encoding='utf-8', errors='replace'`: si no, el color de vitest revienta el
  decodificador cp1252.

### Cómo se verifica algo que "no se puede probar automáticamente"

No se da por bueno: **se sondea**. En la Fase 4 se escribió un script de Electron
de treinta líneas que cargaba koffi, llamaba a `SendInput`, leía
`desktopCapturer` y comparaba `display_id` con `screen.getAllDisplays()`, y se
ejecutó de verdad. Así se pasó de "debería funcionar" a los datos de la sección
anterior. **Los ficheros de sonda se borran después**, o el lint los caza.

### El ritual de verificación: revertir protecciones

La costumbre del proyecto es revertir cada protección y comprobar cuántas
pruebas fallan. En la Fase 4 se automatizó: un script Python con una lista de
`(nombre, archivo, texto_antes, texto_después, archivo_de_prueba)` que aplica
cada mutación, ejecuta `npx vitest run <prueba> --reporter=basic`, cuenta los
fallos con una expresión regular sobre `Tests N failed` y **restaura el archivo
en un `finally`**. Resultado de la Fase 4: 17 protecciones revertidas, las 17
rompen pruebas, entre 1 y 6 cada una. Ninguna quedó sin defender.

Merece la pena rehacer ese script en cada fase. Es la diferencia entre tener
pruebas y tener pruebas que sirven.

---

## 8. Cómo empezar la conversación nueva

Este documento está escrito para que quien lo lea **no empiece de cero**. Vale
igual para Claude Code, para ChatGPT/Codex o para cualquier otro: todo lo que
hace falta está aquí, y lo que ya se decidió o se comprobó **no se vuelve a
investigar**.

### Prompt para pegar

> Lee `docs/CONTINUAR-LUXY-REMOTE.md` **entero** antes de tocar nada: es un
> documento de traspaso y contiene el estado exacto, las decisiones ya tomadas y
> los fallos ya corregidos.
>
> Reglas, de la sección 0 del documento: iOS está fuera del alcance; coste
> obligatorio 0 €; uso personal; **no hagas push, no despliegues y no ejecutes
> migraciones** sin pedírmelo cada vez; y no des por terminada ninguna función
> que no hayas probado.
>
> No repitas la investigación ni reabras las decisiones de las secciones 2 y 3.
> No reintroduzcas ninguno de los 13 fallos de la sección 4.
>
> Continúa por **el transporte/listener real de Supabase Realtime** pendiente tras
> la Fase 4d, sin reabrir la decisión de transporte. Antes de escribir código,
> dime en 10 líneas qué vas a tocar y qué no vas a poder probar automáticamente.
>
> Al terminar: ejecuta `npm run check`, haz el ritual de revertir protecciones de
> la sección 7, y dame un resumen breve separando **lo probado** de **lo sólo
> escrito**.

### Si la fase que toca ya no es la 4d

Cambiar sólo la línea de "Continúa por…" por la fase correspondiente de la
sección 5. El resto del prompt vale igual.

### Qué NO hay que volver a preguntar ni investigar

- Por qué P-256 y no Ed25519, por qué Supabase Realtime, por qué Cloudflare
  TURN, por qué React Native, por qué renderer oculto, por qué proceso auxiliar
  para la entrada → **sección 2**.
- Si koffi funciona en Electron 43, si hay que recompilar para el ABI 148, si
  `display_id` correlaciona con `getAllDisplays`, cuánto mide `INPUT` →
  **sección 5, "Verificado empíricamente"**. Están medidos, no supuestos.
- Cómo se llama cada cosa que ya existe → **sección 3**.
- Qué se rompió una vez y no puede volver a romperse → **sección 4**.
