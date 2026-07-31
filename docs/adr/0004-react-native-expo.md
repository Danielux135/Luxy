# ADR 0004 — Luxy Mobile en React Native + Expo, no Flutter

- **Estado:** aceptada
- **Fecha:** 2026-07-31
- **Fase:** 0 → 4 (visor movil)

## Decisión

**React Native 0.86 + Expo SDK 57 con development build**, y `@stream-io/react-native-webrtc`.

## El motivo que decide, y es específico de este proyecto

No es el rendimiento. Con `react-native-gesture-handler` + `reanimated` los gestos
corren en el hilo de UI nativo, y el vídeo va por textura GPU en los dos
frameworks. **Ese criterio está empatado**, y quien diga que Flutter será
perceptiblemente más fluido en esta app está extrapolando de comparativas que no
aplican.

Lo que decide es el **protocolo compartido**.

Luxy define su protocolo en esquemas Zod, y Zod no es un sistema de tipos: es
**validación en tiempo de ejecución que además es la fuente de verdad**. Con
React Native, `packages/remote-protocol` se importa tal cual en el móvil: un
cambio de protocolo rompe la compilación en los dos extremos a la vez.

Con Flutter habría que duplicarlo en Dart. Los tipos son fáciles de duplicar; lo
que se desincroniza en silencio son los *refinements*, los valores por defecto,
las coerciones y las uniones discriminadas — la semántica de validación, que no
se genera automáticamente desde Zod y para la que no hay generador maduro. En un
protocolo de control que va a evolucionar, esa duplicación es una fuente
permanente de fallos que sólo aparecen en ejecución.

El mismo argumento vale para la criptografía: **`@noble/curves` (MIT) funciona
igual en Electron y en React Native**, así que las dos puntas usan literalmente la
misma implementación. Eso elimina la clase de fallos de "dos implementaciones que
difieren en un detalle de codificación", que en firma de claves es exactamente
donde más duele.

**Segundo motivo:** el desarrollo es en Windows. **EAS Build compila para iOS
desde Windows**; Flutter no tiene equivalente oficial y obligaría a montar CI con
runners macOS. Con Expo es un comando.

## El riesgo que hay que anotar, no esconder

**`react-native-webrtc` oficial está anclado a libwebrtc M124 (junio de 2024).**
`flutter_webrtc` va por M144 en su paquete oficial. Son casi dos años de
correcciones de upstream, incluidos parches de seguridad de la pila WebRTC.

Se resuelve usando un fork: `@stream-io/react-native-webrtc` (M145) o
`@livekit/react-native-webrtc` (M144). Ambos MIT, publicados cada pocos días, y
mantenidos por empresas cuyo producto comercial depende de ese código.

**Sigue siendo una dependencia de terceros y se documenta como riesgo del
proyecto.** Mitigación obligatoria: **aislar toda la superficie WebRTC tras una
interfaz propia delgada**, para que cambiar de fork sea cambiar un import y no
una refactorización.

Riesgo descartado tras comprobarlo: la New Architecture era la duda real de React
Native. Está resuelta — el PR de migración se cerró el 21-07-2026 por innecesario,
con Jitsi Meet en producción sobre new arch + bridgeless.

## Consecuencias

- **Hace falta la cuenta de Apple de 99 USD/año.** No por capricho: las
  notificaciones push no están disponibles en la cuenta gratuita, y los perfiles
  gratuitos caducan a los 7 días. Es un gasto que requiere tu autorización.
- Android se compila y distribuye sin coste. Atención a la **verificación de
  desarrollador de Google**: obligatoria en cuatro países desde el 30-09-2026 y
  global en 2027. La cuenta gratuita cubre hasta 20 dispositivos, suficiente aquí.
- El foreground service es el punto más flojo del catálogo de React Native. Se
  presupuesta escribir un módulo propio con Expo Modules API (~100 líneas de
  Kotlin) en vez de depender de un paquete de un solo mantenedor.
- `expo-secure-store` para el almacén seguro, no `react-native-keychain` (última
  publicación marzo 2025, 177 incidencias abiertas).

## Cuándo habría que reconsiderar

Si el protocolo se definiera en un IDL neutral (Protobuf, JSON Schema) generando
TypeScript y Dart, el argumento principal se evapora y Flutter sería al menos
igual de buena opción, con mejor paquete WebRTC de primera mano.
