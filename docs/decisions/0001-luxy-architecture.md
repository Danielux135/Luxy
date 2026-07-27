# 0001 — Arquitectura de Luxy

- **Fecha:** 2026-07-27
- **Estado:** aceptada
- **Ámbito:** arquitectura general de la primera versión

## Contexto

Quiero dar órdenes desde el móvil a mis ordenadores (un sobremesa y un portátil)
para que ejecuten tareas de código con Claude Code, Codex CLI y algunas APIs
más baratas. Debe funcionar desde cualquiera de los dos, sin que importe cuál
esté encendido, y sin exponer nada de mi red a Internet.

---

## Decisión 1: Telegram habla por webhook con un Cloudflare Worker

**Decisión.** Telegram entrega los mensajes por webhook a un Worker público.

**Por qué.** El webhook es push: no hay latencia de polling ni consumo continuo.
Cloudflare Workers da un endpoint HTTPS estable y gratuito, sin servidor que
mantener, y su plan gratuito sobra para un uso personal.

**Alternativas consideradas.**

- *Long polling de Telegram desde el PC.* Habría eliminado el Worker, pero
  entonces cada ordenador necesitaría el token del bot, y con dos máquinas
  encendidas ambas competirían por `getUpdates` — que además solo admite un
  consumidor. Descartada.
- *Un VPS con un bot clásico.* Un servidor más que mantener, actualizar y
  pagar. Descartada por coste de mantenimiento.

**Consecuencias.** Hay que desplegar y mantener el Worker. Los secretos de
Telegram y Supabase viven en Cloudflare, no en casa, lo cual es una ventaja.

---

## Decisión 2: el agente local hace polling, no recibe conexiones

**Decisión.** El agente consulta el gateway cada 2 s. **Solo hace conexiones
salientes HTTPS.**

**Por qué.** Es la decisión que más simplifica la seguridad y la operación:

- No hay que abrir puertos en el router.
- No hace falta IP pública ni DNS dinámico.
- No hay superficie de ataque entrante.
- Funciona igual en casa, en el portátil o desde la red de clase.

**Alternativas consideradas.**

- *WebSocket o SSE desde el Worker al agente.* Menos latencia, pero los Workers
  no mantienen conexiones largas sin Durable Objects, y eso añade complejidad y
  coste para ganar 2 segundos. Descartada por ahora.
- *Túnel (Cloudflare Tunnel, ngrok).* Sigue siendo exponer el equipo, con un
  daemon más que mantener. Descartada.

**Consecuencias.** Hasta 2 s de latencia al empezar una tarea — irrelevante
cuando la tarea dura minutos. Genera peticiones constantes, dentro de sobra del
plan gratuito.

---

## Decisión 3: Supabase como cola y estado compartido

**Decisión.** PostgreSQL en Supabase guarda trabajos, leases, eventos y
auditoría. El Worker es su **único** cliente, con la `service_role`.

**Por qué.** Hacía falta un sitio donde:

- los trabajos sobrevivan a que se apague un ordenador,
- dos máquinas coordinen sin hablar entre ellas,
- quede auditoría de qué se aprobó y cuándo.

Postgres da además `FOR UPDATE SKIP LOCKED`, que resuelve la exclusión mutua sin
que la aplicación tenga que inventarse locks.

**Alternativas consideradas.**

- *Cloudflare KV.* Consistencia eventual: dos máquinas podrían leer el mismo
  trabajo como libre. Inaceptable. Descartada.
- *Durable Objects.* Darían consistencia fuerte, pero atan el proyecto a
  Cloudflare y no dan consultas SQL para el historial. Descartada.
- *Redis gestionado.* Otro servicio de pago sin ventaja clara sobre Postgres.

**Consecuencias.** Dependencia de un servicio externo más. Hay que aplicar
migraciones a mano. La `service_role` es una credencial muy potente, por eso
solo existe como secret de Cloudflare y nunca baja a los ordenadores.

---

## Decisión 4: Claude y Codex se ejecutan localmente por CLI

**Decisión.** Se usan **Claude Code CLI** y **Codex CLI** con la sesión local de
mis suscripciones. Nunca la API de Anthropic ni la de OpenAI.

**Por qué.** Ya pago esas suscripciones. Usar las APIs sería pagar dos veces.
Además los CLI ya traen lo difícil: edición de archivos, ejecución de comandos,
gestión de contexto del repositorio.

**Alternativas consideradas.**

- *API de Anthropic / OpenAI.* Coste adicional y habría que reimplementar el
  bucle de agente. Descartada, y prohibida explícitamente en el proyecto.
- *Automatizar la web de Claude o ChatGPT.* Frágil, contra los términos de uso, y
  requeriría un navegador en cada equipo. Descartada y prohibida.

**Consecuencias.**

- **Hay que autenticarse una vez en cada ordenador**: las sesiones son locales.
  Es la fricción principal de la instalación, y está documentada.
- Los CLI cambian de flags entre versiones. Por eso hay una **capa de detección
  de capacidades** que lee `--help` en tiempo de ejecución en lugar de asumir la
  sintaxis. Versiones comprobadas durante el desarrollo: Claude Code 2.1.183 y
  Codex 0.141.0.
- En Windows los CLI son shims `.cmd`, y Node no los lanza sin shell. Como usar
  shell está prohibido, hay un resolvedor que desreferencia el shim hasta el
  `.exe` o el `.js` real.

---

## Decisión 5: cada tarea corre en un worktree de git

**Decisión.** Toda tarea que pueda modificar archivos se ejecuta en un worktree
aislado bajo `%LOCALAPPDATA%\Luxy\worktrees`, en una rama `luxy/<id>-<slug>`.

**Por qué.** Es la garantía de que **nunca pierdo trabajo**. Si Luxy hace algo
mal, mi carpeta de trabajo está intacta y basta con borrar el worktree. Además:

- el diff sale limpio, sin mezclarse con lo que yo tuviera a medias,
- puedo tener una tarea corriendo mientras trabajo en la misma carpeta,
- git da el aislamiento gratis, sin copiar archivos.

**Alternativas consideradas.**

- *Trabajar directamente en la carpeta.* Rápido y muy peligroso: se mezclaría
  con mis cambios sin confirmar. Descartada.
- *Copiar la carpeta entera.* Lento en proyectos grandes y pierde el historial,
  que los agentes necesitan. Descartada.
- *Contenedores.* Aislamiento mucho mejor, pero exige Docker en cada equipo y
  los CLI no verían la sesión autenticada del host. Descartada.

**Consecuencias.**

- **El proyecto tiene que ser un repositorio git.** Si no lo es, solo se
  permiten tareas de lectura y Luxy explica cómo inicializarlo.
- Los worktrees ocupan espacio y hay que limpiarlos. No se borran solos si
  tienen cambios: hace falta aprobación explícita.

---

## Decisión 6: los secretos de Supabase no bajan a los ordenadores

**Decisión.** La `SUPABASE_SERVICE_ROLE_KEY` existe **solo** como secret de
Cloudflare. Cada máquina tiene únicamente un token propio, guardado como hash.

**Por qué.** La `service_role` omite RLS: quien la tenga puede leer y escribir
toda la base de datos. Un portátil se pierde o se roba mucho más fácilmente que
un secret de Cloudflare. Con este diseño, comprometer un portátil expone **solo
esa máquina**, y su token se revoca desde el gateway.

**Alternativas consideradas.**

- *Que el agente hable directo con Supabase.* Eliminaría el Worker de la ruta de
  datos, pero cada ordenador tendría la llave maestra. Descartada.
- *Tokens de Supabase por máquina con RLS.* Habría funcionado, pero obligaba a
  escribir políticas RLS complejas y a gestionar JWT propios. El gateway ya hace
  ese papel de forma más simple. Descartada.

**Consecuencias.** El gateway es un punto único de fallo: si Cloudflare cae, no
se pueden lanzar tareas. A cambio, la cola local de eventos hace que nada se
pierda durante un corte.

---

## Consecuencias globales

**Lo que se gana**

- Ningún puerto abierto ni IP pública.
- Los trabajos sobreviven a apagones y cortes de red.
- Dos máquinas nunca ejecutan el mismo trabajo (garantía de Postgres).
- Los cambios locales nunca se pierden por una reasignación automática.
- Un portátil comprometido no expone toda la infraestructura.

**Lo que se paga**

- Tres servicios externos que configurar (Telegram, Supabase, Cloudflare).
- Autenticación de Claude y Codex en cada equipo.
- Hasta 2 s de latencia inicial por el polling.
- Migraciones aplicadas a mano.

## Limitaciones conocidas de la primera versión

1. **Rate limiting aproximado**: vive en memoria del isolate de Cloudflare. Sirve
   contra bucles, no contra un ataque. Un Durable Object lo haría exacto.
2. **Migraciones no ejecutadas contra Postgres real** durante el desarrollo: el
   equipo no tenía psql, Docker ni la CLI de Supabase. La validación es
   estructural (`migrations.test.ts`).
3. **Prompt injection mitigado, no resuelto**: la defensa real es el aislamiento
   del worktree y la lista blanca de comandos, no el prompt.
4. **`cmd.exe` para `.bat` no desreferenciables** (`flutter.bat`): excepción
   controlada con validación estricta de argumentos, documentada en
   `docs/SECURITY.md`.

## Revisión

Reconsiderar la decisión 2 (polling) si la latencia llega a molestar, y la
decisión 3 (Supabase) si el volumen de trabajos creciera mucho. Ambas están
aisladas detrás del cliente del gateway y del repositorio, así que cambiarlas no
tocaría el agente ni la lógica compartida.
