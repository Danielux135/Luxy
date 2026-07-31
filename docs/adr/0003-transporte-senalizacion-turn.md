# ADR 0003 — Transporte WebRTC, señalización sobre Supabase Realtime, TURN de Cloudflare

- **Estado:** aceptada
- **Fecha:** 2026-07-31
- **Fase:** 0 (investigación) → 2 (señalización)

## Transporte: WebRTC

**Decisión: WebRTC (DTLS-SRTP para media, DataChannel no fiable para entrada).**

No por inercia. Lo que WebRTC trae hecho y habría que reescribir con cualquier
otra opción:

- cifrado obligatorio (no existe modo sin cifrar);
- ICE completo, con host / srflx / relay y reinicio de ICE;
- **control de congestión GCC**, que es lo caro de verdad;
- jitter buffer adaptativo, NACK/RTX, FEC, PLI para keyframes bajo demanda.

### Alternativas rechazadas

**WebTransport sobre QUIC.** Es Baseline en navegadores desde marzo de 2026, pero
**no existe cliente nativo en Flutter**: el issue
[flutter/flutter#154465](https://github.com/flutter/flutter/issues/154465) sigue
abierto sin implementación. Y aunque existiera, WebTransport no da control de
congestión de media, ni jitter buffer, ni FEC: habría que construirlos. Además el
Worker de Cloudflare no expone servidor WebTransport.

**WebSocket con vídeo troceado.** Descartado por *head-of-line blocking* de TCP:
al perderse un paquete, los frames posteriores **ya recibidos** quedan retenidos
hasta la retransmisión. TCP nunca descarta, así que el retraso **se acumula y no
se recupera**. En escritorio remoto es preferible perder un frame que retrasar
todos. Sirve para visualización a 300-800 ms, no para control interactivo.

## Señalización: Supabase Realtime, no Durable Objects

**Decisión: canal de broadcast de Supabase Realtime.**

Corrección a una suposición previa: **los Durable Objects ya funcionan en el plan
gratuito de Workers** desde el
[7 de abril de 2025](https://developers.cloudflare.com/changelog/post/2025-04-07-durable-objects-free-tier/),
con backend SQLite. No hace falta pagar. Aun así no se eligen.

El motivo es el tamaño real del problema. Un handshake completo son **1 oferta,
1 respuesta y 5-20 candidatos ICE por lado**: del orden de 20-50 mensajes de
menos de 2 KB, en unos segundos. Después el canal queda ocioso.

| Opción | Latencia | Coste | Infraestructura nueva |
|---|---|---|---|
| **Supabase Realtime** | ~100-250 ms | $0 | **ninguna** |
| Durable Objects + hibernación | ~50-150 ms | $0 | clase DO, config, despliegue |
| Sondeo sobre el Worker | 500-1500 ms | $0 | ninguna |
| Cloudflare Queues | >1 s | $0 | mal encaje (no hay push) |

Los 100 ms de diferencia con DO son **imperceptibles** frente a los segundos que
tarda la recolección de candidatos ICE. Y Supabase ya está en el proyecto, con
autenticación y RLS. Límites del plan gratuito: 200 conexiones concurrentes,
2 millones de mensajes/mes, 100 mensajes/s. Para 1-3 dispositivos sobra.

Se descarta el sondeo (que era mi propuesta inicial) porque el *trickle ICE*
sufre: los candidatos llegan en ráfaga y un sondeo a 1 Hz los retrasa.

La interfaz de señalización queda aislada para poder cambiar a Durable Objects
si algún día hace falta coordinación con estado fuerte (lista de dispositivos en
línea, cola de comandos, wake-on-LAN).

## TURN: Cloudflare Realtime

**Decisión: Cloudflare Realtime TURN, con credenciales efímeras generadas por el
Worker que ya existe. STUN en `stun.cloudflare.com`.**

Precios verificados el 31-07-2026:

| Proveedor | Precio | Free tier |
|---|---|---|
| **Cloudflare Realtime TURN** | **$0.05/GB** | **1.000 GB** |
| Twilio NTS | $0.40/GB (US) | ninguno |
| Metered | $0.40/GB | 500 MB/mes |
| coturn en VPS | ~€4/mes fijo | — |

STUN de Cloudflare es gratis e ilimitado.

### Cuánto tráfico es esto

Escritorio remoto 1080p, medido en bitrate típico:

| Uso | Bitrate | GB/hora |
|---|---|---|
| Texto y código, poco movimiento | 1 Mbps | 0,45 |
| Escritorio general | 3 Mbps | 1,35 |
| 30 fps fluido | 5 Mbps | 2,25 |

Caso base **~1,5 GB/hora**. El free tier de 1.000 GB cubre **~660 horas al mes**.
Para uso personal es efectivamente gratis e ilimitado.

coturn (BSD) queda como plan B si algún día el volumen lo justifica: ~€4/mes fijo
con tráfico incluido, a cambio de medio día de configuración, certificado TLS
renovable, hardening (un coturn abierto es un relay abusable) y mantenimiento.

### Dato que cambia el diseño

**TURN va a ser la ruta habitual, no la excepción.** Móvil en 4G/5G hacia un PC
doméstico es el peor caso para P2P: las redes móviles usan CGNAT masivamente y
muchos operadores hacen NAT simétrico, que impide el *hole punching*. Estimación
razonable: **30-50% de las sesiones** irán por relay.

Consecuencia práctica: **habilitar IPv6 en ambos extremos es la optimización de
mayor retorno**, porque una conexión IPv6↔IPv6 evita el NAT por completo. Y la
interfaz debe mostrar si la sesión va directa o por relay, porque cambia la
latencia y el consumo.

## Códecs

**Orden de negociación: AV1 → VP9 → H.264.** Con `contentHint = 'text'` y
`degradationPreference = 'maintain-resolution'`.

El porqué de `contentHint`: bajo congestión el codificador tiene que sacrificar
algo. Con `'motion'` baja la resolución y **el texto se vuelve ilegible**, que en
escritorio remoto es un fallo total. Con `'text'` baja el framerate y el texto
sigue nítido. Además activa el *screen content coding* del codificador, que en
AV1 habilita IntraBC y modo Palette: mucho menos bitrate en contenido sintético.

H.264 Constrained Baseline se queda como red de seguridad porque **RFC 7742 lo
exige** en todo endpoint WebRTC y tiene decodificación por hardware en el 100% de
los móviles relevantes, con el menor consumo de batería. AV1 sólo cuando ambos
extremos lo soporten por hardware: en iPhone es exclusivo del 15 Pro en adelante,
y Safari **no tiene respaldo por software**.

Sobre patentes de H.264: los primeros 100.000 codificadores/decodificadores
anuales son $0, y el codificador que se usa es el del sistema operativo, ya
licenciado por el fabricante. Riesgo práctico nulo en uso personal.

## Licencias: qué no se puede copiar

Verificado, y es importante porque son justo los proyectos que uno miraría:

| Proyecto | Licencia | ¿Copiar código? |
|---|---|---|
| **RustDesk** | **AGPL-3.0** | **No** |
| **Sunshine** | **GPL-3.0** | **No** |
| **Moonlight** | **GPL-3.0** | **No** |
| libwebrtc | BSD 3-Clause | Sí |
| flutter_webrtc | MIT | Sí |
| coturn | BSD 3-Clause | Sí |
| Pion | MIT | Sí |
| werift | MIT | Sí |

AGPL es la peor de las tres para este caso: extiende el copyleft **al uso en red**,
así que contaminaría el gateway aunque nunca se distribuyera un binario.

**Se pueden estudiar sus arquitecturas** —las ideas no son copyrightables— pero no
se copia código. Luxy se construye sobre las permisivas.

## Coste total

**$0/mes** para uso personal de decenas de horas, dentro de planes gratuitos y
sin plan Workers de pago.
