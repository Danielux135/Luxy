# ADR 0002 — Modelo de capacidades: qué puede hacer de verdad cada plataforma

- **Estado:** aceptada
- **Fecha:** 2026-07-31
- **Fase:** 0 (investigación) → 1 (protocolo)

## Contexto

El requisito dice: *"Nunca fingir que una plataforma permite control completo si no
lo permite"* y *"la interfaz debe mostrar las capacidades reales de cada
dispositivo"*.

Eso no se resuelve con buena intención: se resuelve haciendo que **la capacidad
sea un dato del protocolo**, negociado y verificado, no una suposición de la
interfaz. Si la capacidad no está declarada y concedida, el mensaje se rechaza en
el host.

## La matriz real, medida contra documentación oficial

Leyenda: **✓** funciona · **⚠** funciona con condiciones serias · **✗** imposible
con API pública.

| Capacidad | Windows (host) | Android (host) | iOS (host) |
|---|---|---|---|
| Ver pantalla | ✓ | ⚠ | ⚠ |
| Controlar ratón/teclado | ✓ | ⚠ sólo sideload | **✗** |
| Audio del sistema | ⚠ | ⚠ nunca llamadas | ✗ |
| Portapapeles ← host | ✓ | ⚠ sólo en primer plano | ⚠ |
| Portapapeles → host | ✓ | ⚠ sólo en primer plano | ⚠ |
| Archivos | ✓ | ✓ vía SAF | ⚠ |
| Sesión desatendida | ⚠ con PIN | ✗ | ✗ |
| Seguir con pantalla bloqueada | ✗ | ✗ | ✗ |

Como **cliente** (controlar otro equipo), las tres plataformas son ✓ sin
condiciones relevantes. El problema está siempre en el lado controlado.

## Lo que hay detrás de cada ⚠ y cada ✗

### iOS controlado: no hay control, y no lo va a haber

**No existe ninguna API pública para inyectar toques, teclas o gestos en iOS.**
Ni desde otra app, ni desde una extensión, ni desde fuera del dispositivo. No es
una laguna pendiente: es el sandbox. Consta por escrito de un ingeniero de Apple
en el [foro 664959](https://developer.apple.com/forums/thread/664959):

> "if you can inject user events you could easily bypass the sandbox"

La salida que Apple ofrece ahí —distribuir con Developer ID— **sólo existe en
macOS**. En iOS no hay plan B.

TeamViewer, que es la implementación comercial más madura, hace exactamente lo
único que se puede hacer: **ver, y anotar encima**. El usuario sigue tocando con
su dedo.

Lo que sí se puede: ver la pantalla vía Broadcast Upload Extension, **con dos
condiciones duras**: el usuario tiene que pulsar físicamente para iniciar cada
sesión (no hay inicio programático), y la extensión tiene **50 MB de memoria**,
lo que obliga a codificar con VideoToolbox sin copiar frames.

Conclusión de producto: **acceso desatendido a un iPhone no existe**. Lo que Luxy
puede ofrecer es *soporte asistido*.

### Android controlado: funciona, pero no en Google Play

Ver la pantalla es ✓ técnicamente y publicable, con dos limitaciones nuevas que
no estaban hace dos años:

- **Android 14+: el token de MediaProjection es de un solo uso.** Cada
  `createVirtualDisplay()` consume el consentimiento. Es decir: **cada
  reconexión tras un corte de red vuelve a pedir permiso al usuario.** Eso no se
  puede esconder, hay que diseñar la UX contando con ello.
- **Android 15 QPR1+: la proyección se detiene al bloquear la pantalla.**

Controlar la entrada es donde se rompe. Las vías, sin adornos:

| Vía | Fricción | ¿Google Play? |
|---|---|---|
| AccessibilityService | activación manual del usuario | Publicable **con riesgo alto** |
| Shizuku (Apache 2.0) | rearmar tras **cada reinicio** | No |
| ADB directo | PC o depuración inalámbrica | No |
| Device Owner | **factory reset** | No (empresarial) |
| `INJECT_EVENTS` | — | **Imposible**, firma de plataforma |

Sobre AccessibilityService, el dato que decide: **Android 17 revoca
automáticamente** el acceso a la API de accesibilidad a las apps no marcadas
`isAccessibilityTool` cuando el usuario tiene activado el Modo de Protección
Avanzada. Y marcar esa bandera sin ser una herramienta de accesibilidad real es
motivo de suspensión de cuenta. No es un riesgo de política negociable: es la
plataforma.

### Windows controlado: lo que Luxy no va a hacer

- **UAC / Secure Desktop y pantalla de bloqueo:** no se capturan sin elevación, y
  **Luxy no va a intentar eludirlo**. Cuando aparezca un diálogo de UAC, la
  sesión remota verá una pantalla congelada o negra. Se avisará en la interfaz en
  vez de dejar al usuario pensando que se ha colgado.
- **Audio del sistema:** ⚠ porque depende de la captura loopback y no está
  verificado todavía en esta pila.

## Decisión

1. **Las capacidades viajan en el protocolo**, declaradas por el host en el
   `hello` y confirmadas por el gateway contra los permisos concedidos al
   dispositivo. La interfaz **nunca** infiere capacidades del sistema operativo.
2. **Cada mensaje se comprueba contra la capacidad concedida en la sesión**, no
   contra lo que el host podría hacer. Un host con capacidad de control pero en
   una sesión de sólo visualización rechaza los eventos de entrada.
3. **La inyección de entrada en Android vive detrás de una interfaz** con
   implementaciones intercambiables (Shizuku, ADB, Accessibility, no-op), para
   poder producir dos compilaciones del mismo código: una personal por sideload
   con control, y otra publicable sin él.
4. **La interfaz muestra por qué falta una capacidad**, no sólo que falta.
   "Control no disponible: iOS no ofrece API pública para inyectar toques" es
   accionable; un icono gris no lo es.
5. Los grados de degradación son explícitos y ordenados:
   `control` → `view` → `transfer` → `clipboard` → `luxy-only`.

## Consecuencia incómoda que se acepta

El objetivo *"ver y controlar el teléfono desde el ordenador"* **sólo se cumple
en Android y sólo por sideload**. En iPhone se queda en ver, con inicio manual
del usuario. Está aceptado y documentado en vez de prometido y luego incumplido.
