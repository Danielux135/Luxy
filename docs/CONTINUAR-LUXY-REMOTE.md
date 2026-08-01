# Continuar Luxy Remote — estado y siguientes pasos

Documento de traspaso. Si estás retomando esto en una conversación nueva, aquí
está todo lo necesario para seguir **sin volver a investigar nada**.

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

- Rama `master`, **todo en local, sin push**.
- Último commit: `8b2fd6d`
- **1160 tests en verde**, lint, typecheck y build limpios.

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

| Decisión | Motivo en una línea |
|---|---|
| **P-256**, no Ed25519 | Única curva con respaldo hardware en Android StrongBox. Ed25519 dejaría la clave en software. |
| **Supabase Realtime** para señalización, no Durable Objects | La señalización son ~40 mensajes. DO ya es gratis (desde abr-2025) pero es sobreingeniería. |
| **Cloudflare TURN** | 0,05 $/GB con **1.000 GB gratis** ≈ 660 h/mes. Twilio cuesta 8× y sin free tier. |
| **React Native + Expo**, no Flutter | Permite compartir `packages/remote-protocol` (Zod) literalmente. Flutter obligaría a duplicar el protocolo en Dart, y ahí es donde se desincroniza en silencio. Y EAS Build compila iOS desde Windows. |
| **Renderer oculto** de Electron para captura/WebRTC | `utilityProcess` no tiene pila de medios. La captura y el encoder van en el proceso GPU, no bloquean. |
| **Proceso auxiliar** para la entrada, no addon | El DPI awareness **no se puede cambiar** una vez creadas las ventanas. Un addon hereda el de Electron y no puede corregirlo. |

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

## 3. Lo que YA está construido y probado

Todo lo de abajo tiene pruebas y está verificado revirtiendo protecciones.

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

---

## 5. Lo que FALTA, en orden

### FASE 4 (en curso) — Host de Windows
Queda lo que **no se puede probar automáticamente**. Hay que separarlo claramente
de lo probado al entregarlo.

- [ ] Renderer oculto dedicado (`BrowserWindow` con `show:false`) para captura y
      `RTCPeerConnection`. **No usar `utilityProcess`**: no tiene pila de medios.
- [ ] `setDisplayMediaRequestHandler` + `desktopCapturer.getSources({types:['screen']})`.
      `thumbnailSize:{width:0,height:0}` cuando no haga falta miniatura.
- [ ] Correlacionar `display_id` con `screen.getAllDisplays()` para construir
      `DisplayInfo`.
- [ ] `RTCPeerConnection` con `contentHint='text'` y
      `degradationPreference='maintain-resolution'`. Negociar AV1 → VP9 → H.264.
- [ ] DataChannel **no fiable y no ordenado** para los eventos de control.
- [ ] Implementar `InputBackend` con **koffi** (MIT, activo) llamando a
      `user32!SendInput`. Verificar empíricamente que koffi carga en Electron 43.
- [ ] Indicador visible y persistente mientras haya sesión + botón de cortar.
- [ ] IPC entre main y renderer oculto.

### FASE 5 — Luxy Mobile Android mínimo
- [ ] Proyecto React Native + Expo con **development build** (Expo Go no sirve).
- [ ] `@config-plugins/react-native-webrtc` + `@stream-io/react-native-webrtc`.
- [ ] Importar `@luxy/remote-protocol` y `@luxy/remote-crypto` tal cual.
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

## 6. Acciones que requieren autorización de Daniel

Pendientes, con lo que hay que decirle:

**A. Ejecutar la migración `0004_luxy_remote.sql` en su Supabase**
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

**Aviso práctico:** los heredocs de bash se rompen a menudo en este entorno con
contenido que lleva comillas. Para parchear archivos, escribir un script Python
en el scratchpad y ejecutarlo es más fiable. PowerShell `Set-Content -Encoding
utf8` mete BOM y rompe JSON.

---

## 8. Cómo empezar la conversación nueva

Prompt sugerido para pegar:

> Lee `docs/CONTINUAR-LUXY-REMOTE.md` en `C:\Users\daniel\Desktop\Luxy` y
> continúa desde donde se quedó. No repitas la investigación ni las decisiones ya
> tomadas. Empieza por la Fase 4, y dime primero en 10 líneas qué vas a tocar y
> qué no vas a poder probar automáticamente.
