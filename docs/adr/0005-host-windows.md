# ADR 0005 — Host de Windows: captura con Electron, entrada con proceso auxiliar

- **Estado:** aceptada
- **Fecha:** 2026-07-31
- **Fase:** 0 → 3 (host de Windows)

## Corrección de un supuesto

**Electron 43 es Chromium 150 + Node 24.17**, ABI de módulo nativo **148**. No
Node 20, como asumía la propuesta inicial. Importa porque un `.node` compilado
contra Node 24 oficial **no carga en Electron**: Chromium usa BoringSSL en vez de
OpenSSL y el ABI difiere.

## Captura: no se implementa nada

**Decisión: `desktopCapturer.getSources()` + `setDisplayMediaRequestHandler`.**

Chromium ya hace, y mejor, todo lo que uno se plantearía escribir:

- elige **WGC** en Windows 11 24H2+ y cae a **DXGI Desktop Duplication** en
  Windows 10, sin que haya que decidirlo;
- ya suprime el **borde amarillo** (`kWebRtcWgcRequireBorder` está desactivado);
- ya activa **0 Hz** (no manda frames si nada cambia);
- ya prefiere el cursor embebido.

Para elegir monitor: `getDisplayMedia` **no acepta `deviceId`** por limitación del
estándar; se resuelve en el proceso principal correlacionando el `display_id` de
`DesktopCapturerSource` con `screen.getAllDisplays()`, que además da los
`bounds` y el `scaleFactor` de cada monitor.

**El rendimiento no es un problema**: la captura corre en un hilo dedicado del
proceso browser, y la **codificación por hardware ocurre en el proceso GPU**. No
bloquea el hilo principal. El único riesgo real de tirones es llamar a
`getSources()` con `thumbnailSize` grande; se usará `{width:0,height:0}` cuando no
haga falta miniatura.

**Audio del sistema:** `audio: 'loopback'` funciona y está documentado, **sólo en
Windows**. Se marca como capacidad de plataforma, no universal.

## Entrada: proceso auxiliar, no addon nativo

**Decisión: prototipo con `koffi` (MIT), producción con un auxiliar nativo en Rust
comunicándose por named pipe.**

El motivo no es preferencia, es un impedimento técnico duro:

> **Una vez que un proceso ha creado una ventana, ya no se puede cambiar su
> DPI awareness.** (`SetProcessDpiAwarenessContext`, documentación de Microsoft.)

Electron ya ha creado ventanas cuando cualquier addon se carga. Un addon
in-process **hereda el DPI awareness de Electron y no puede corregirlo**. Y con
monitores a escalas distintas (100% y 150%), un proceso que no sea
`PerMonitorV2` recibe métricas del escritorio virtual **virtualizadas**, así que
el cursor aterriza desplazado en el monitor secundario.

Un proceso auxiliar declara `PerMonitorV2` en su propio manifiesto y obtiene
píxeles físicos reales. Además:

| | Addon in-process | Auxiliar separado |
|---|---|---|
| DPI awareness | **imposible corregir** | correcto |
| Un fallo en `SendInput` | tumba toda la app | muere el auxiliar, se relanza |
| Subir de Electron 43→44 | recompilar | no le afecta |
| Firma para UIAccess | inviable en `electron.exe` | un `.exe` pequeño y firmado |
| Latencia | µs | decenas de µs, irrelevante frente a 30-100 ms de RTT |

Se empieza con **koffi** llamando a `user32!SendInput` para validar el flujo de
punta a punta en días. El protocolo de eventos es el mismo, así que migrar al
auxiliar no tira trabajo.

Descartados: **`ffi-napi`** (última publicación en 2021, muerto), **`nut.js`**
(retirado de npm público, ahora con licencia comercial propia), **`robotjs`**
(Node-API v3 antiguo; habría que verificar prebuilds para ABI 148).

## Coordenadas: normalizadas 0..1 en el protocolo

Confirmado por la documentación: `SendInput` con `MOUSEEVENTF_ABSOLUTE |
MOUSEEVENTF_VIRTUALDESK` espera **0..65535 sobre el escritorio virtual**. El
protocolo manda 0..1 relativo al monitor elegido, y **la única conversión ocurre
en el host**, que es el único que conoce la geometría.

Detalle que importa: el divisor es `(ancho - 1)`, no `ancho`, porque 65535 mapea
al **último píxel**. Usar `ancho` produce un error de ~1 px que se nota en los
bordes.

**Nunca modo relativo**: la documentación advierte que el movimiento relativo
está sujeto a la aceleración del ratón, que puede **multiplicarlo hasta por
cuatro**.

## Teclado: dos caminos separados, y un "suelta todo"

Confirmado que la separación del protocolo entre `key.text` y `key.press` es la
correcta:

- `KEYEVENTF_UNICODE` exige `wVk = 0` y **sólo se puede combinar con `KEYEVENTF_KEYUP`**.
  No sirve para modificadores ni atajos: no se puede hacer Ctrl+C con Unicode.
  Además `wScan` es de 16 bits, así que los emoji fuera del BMP hay que mandarlos
  como **par de surrogates en dos eventos**.
- Los atajos van con `KEYEVENTF_SCANCODE`, porque el scancode **no cambia con la
  distribución de teclado**, y el móvil no puede conocer la del host.

Hallazgo que hay que implementar sí o sí: `SendInput` **no reinicia el estado del
teclado**. Si el canal se cae con Ctrl pulsado, **la tecla se queda pegada en el
ordenador**. Hace falta un *suelta todo* al desconectar. Se añade al protocolo.

## Lo que no va a funcionar, y hay que decirlo

| Situación | Ver | Controlar |
|---|---|---|
| Apps normales | sí | sí |
| **Apps elevadas (administrador)** | sí | **no** |
| Diálogo de UAC / escritorio seguro | **no** | no |
| Pantalla de bloqueo | **no** | no |

Lo más peligroso es el segundo caso, y merece una advertencia aparte:

> `SendInput` **falla en silencio** contra procesos elevados. La documentación lo
> dice: *"neither GetLastError nor the return value will indicate the failure was
> caused by UIPI blocking"*.

Es decir: el usuario hace clic, la llamada devuelve éxito y **no pasa nada**. Sin
un aviso explícito parece que Luxy está roto. La interfaz debe detectar la
situación por otra vía (ventana en primer plano elevada) y decirlo.

**Luxy no va a eludir estas restricciones.** UIAccess se contempla más adelante
sólo para el auxiliar —`.exe` firmado en Program Files—, y aun así **no da acceso
al escritorio seguro**: la documentación es explícita.

## Acceso desatendido: es otro proyecto

Un servicio de Windows **no puede interactuar con el escritorio**: vive en la
sesión 0 y `NoInteractiveServices` vale 1 por defecto desde Vista. La arquitectura
correcta es de tres capas —servicio LocalSystem + agente lanzado con
`CreateProcessAsUser` en la sesión del usuario + IPC por named pipe con ACL—, y
multiplica el alcance: instalador per-machine, gestión de privilegios y una
superficie que cualquier antivirus tratará como troyano de acceso remoto.

**Se aplaza.** Con un proceso de usuario se cubre el caso real —"ver y controlar
mi PC desde el móvil mientras estoy conectado"— sin nada de eso.
