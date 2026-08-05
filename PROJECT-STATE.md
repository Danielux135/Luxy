# Luxy — estado canónico del proyecto

Última actualización: **2026-08-05**  
Estado documental: **checkpoint verificado en Windows; `P0.0`–`P0.3` cerrados**

## 1. Cómo interpretar este estado

Orden de precedencia:

1. El contenido real del worktree de Windows.
2. Este archivo.
3. `CURRENT-TASK.md`, `DECISIONS.md` y `MASTER-PLAN.md`.
4. `CHANGELOG-WORK.md`, `TEST-RESULTS.md` y `LOCAL-ACTIONS.md`.
5. README y documentación técnica.
6. Handoffs, capturas y parches antiguos.

Si el worktree contradice este archivo, no se reescribe código para hacerlo
coincidir. Se registra la discrepancia, se averigua qué cambio existe realmente
y se actualiza primero la documentación.

## 2. Producto y restricciones vinculantes

Luxy es un sistema privado y personal para controlar modelos y agentes de IA.
La interfaz principal es **Luxy Studio para Windows**. Telegram queda como canal
secundario. Luxy Mobile para Android es una fase futura y Luxy Remote permanece
pausado, no eliminado.

Restricciones:

- Coste obligatorio de producto: **0 €**.
- No SaaS, facturación, multi-tenant, iOS ni publicación comercial.
- Claude Code y Codex usan las sesiones locales de las suscripciones; no se
  pagan ni se integran sus APIs.
- No automatizar las webs de Claude o ChatGPT.
- No usar `--dangerously-skip-permissions` ni equivalentes.
- No tocar la carpeta original de un proyecto: toda edición ocurre en un
  worktree aislado.
- No commit sin aprobación explícita de Daniel.
- No push sin dos confirmaciones y `allowPush: true`.
- No desplegar ni aplicar migraciones reales sin autorización explícita.
- No usar APIs reales en pruebas automatizadas.
- No exponer secretos, rutas personales ni el entorno completo a procesos hijo.

## 3. Arquitectura actual

```text
Luxy Studio / Telegram
        |
        v
Cloudflare Worker (gateway y única pieza pública)
        |
        v
Supabase/Postgres (trabajos, leases, eventos, aprobaciones y metadata)
        ^
        | polling HTTPS saliente
Agente local de Windows
        |
        +-- Claude Code o Codex CLI con sesión local
        +-- Proveedores HTTP configurados
        +-- Worktrees Git para tareas que pueden editar
```

Monorepo:

| Ruta                  | Responsabilidad                                       |
| --------------------- | ----------------------------------------------------- |
| `packages/shared`     | tipos, esquemas Zod y lógica pura compartida          |
| `apps/gateway`        | API de Studio, cola, autenticación y Telegram         |
| `apps/agent`          | proveedores, procesos, worktrees, checks y resultados |
| `apps/desktop`        | Electron/React, IPC, Studio y secretos cifrados       |
| `supabase/migrations` | SQL acumulativo                                       |
| `packages/remote-*`   | Luxy Remote conservado y pausado                      |

## 4. Checkpoint operativo conocido

- Repositorio: `Danielux135/Luxy`.
- Worktree de prueba en Windows:
  `%LOCALAPPDATA%\Luxy\worktrees\luxy-work-update-001`.
- Rama conocida: `luxy/work-update-001-studio`.
- Perfil de prueba de Desktop:
  `%LOCALAPPDATA%\Luxy\test-profiles\studio-001`.
- Gateway local: Wrangler en `apps/gateway`, normalmente
  `http://localhost:8787`.
- No se ha autorizado commit, push, despliegue ni una migración nueva para este
  checkpoint.

El estado exacto de Git y de las migraciones debe volver a leerse en Windows al
abrir la siguiente sesión. No asumir que un parche está aplicado sólo porque sus
pruebas existen; usar el código real y `git apply --reverse --check` cuando sea
necesario.

## 5. Capacidades implementadas

| Área                   | Estado conocido           | Observaciones                                                                  |
| ---------------------- | ------------------------- | ------------------------------------------------------------------------------ |
| Agente, gateway y cola | Implementado              | polling saliente, leases, heartbeats, eventos y cancelación                    |
| Desktop Electron       | Implementado              | agente en utility process, bandeja, configuración y secretos cifrados          |
| Studio — trabajos      | Implementado en código    | formulario real, historial, eventos, resultado, diff y pruebas                 |
| Worktrees              | Implementado              | la carpeta original no se modifica                                             |
| Aplicar/descartar      | Implementado en código    | aplicar crea commit aislado; descartar borra worktree tras confirmar; sin push |
| Conversaciones         | Implementado parcialmente | uno o dos modelos, streaming, historial, tiempos, tokens y cancelación         |
| Diagnóstico del final  | Implementado y verificado | señal de transporte, aborto, límites efectivos y tokens; sin contenido         |
| Finales explícitos     | Implementado y verificado | seis resultados; la salida parcial se conserva y no se reintenta a ciegas      |
| Memoria                | Implementado y verificado | sin fallback: sólo un bloque válido la sustituye; el código se rechaza         |
| Recomendaciones        | Implementado              | feedback y resultados ajustan una recomendación explícita; nunca cambia solo   |
| Feedback               | Arreglo preparado         | el primer clic usa la respuesta del gateway; falta confirmación manual final   |
| Proveedores/modelos    | Implementado parcialmente | Claude, Codex y familias HTTP; catálogo real y capacidades desiguales          |
| Errores de proveedor   | Implementado y verificado | límite de plan y 429 explicados; se obedece `Retry-After`; intentos reales     |
| Telegram               | Conservado                | canal secundario                                                               |
| Mobile Android         | No iniciado               | prioridad posterior a estabilizar Desktop                                      |
| Remote                 | Pausado                   | conservar código, ADR, threat model y pruebas                                  |

## 6. Flujo de Conversaciones que ya funciona

- Crea cada respuesta como un trabajo persistente de Studio.
- Agrupa conversación, turno y columna A/B en metadata.
- Ejecuta el proveedor en solo lectura, sin herramientas, worktree ni checks.
- Muestra streaming, primer texto, duración total y tokens cuando el proveedor
  los entrega.
- El botón **Detener** cancela y recupera cancelaciones huérfanas.
- Las respuestas normales pasan solas a **Guardado**.
- La memoria estructurada se separa del texto visible y se reutiliza en turnos
  posteriores.
- El feedback `Útil` / `No me sirvió` alimenta la selección de proveedor y
  modelo, pero no entrena sus pesos.
- En A/B, la respuesta útil más reciente es la fuente canónica del siguiente
  turno; sin valoración se usa A.

Arreglos acumulados relevantes:

1. Lectura de `finish_reason`, `[DONE]`, usage final y último evento sin salto.
2. Cancelación real y recuperación de estados huérfanos.
3. Finalización por señales de protocolo, no por una pausa breve arbitraria.
4. Publicación de respuestas cortas.
5. Conservación de `inputTokens` y `outputTokens` como números: el redactor ya
   no los confunde con credenciales.
6. Feedback visual al primer clic.

## 7. Incidencias abiertas prioritarias

### LUXY-P0-001 — respuesta larga incompleta — **causa demostrada el 2026-08-05**

**Era el tope de guardado, no el proveedor ni el transporte.** Con la telemetría
de `P0.1` funcionando, dos ejecuciones reales dieron:

| Trabajo    | tokens salida | caracteres recibidos | guardado | transporte    | finish_reason | aborto  |
| ---------- | ------------- | -------------------- | -------- | ------------- | ------------- | ------- |
| `LUX-YJT9` | 3.180         | 7.716                | 4.000    | `done_marker` | `stop`        | ninguno |
| `LUX-8B8T` | 2.720         | 7.691                | 4.000    | `done_marker` | `stop`        | ninguno |

La llamada terminaba bien y la respuesta llegaba entera. `summary` estaba
limitado a 4.000 caracteres para cualquier trabajo, así que una conversación
perdía la mitad al persistir. Corregido en `P0.3b` (`D-020`).

Lo que **no** era, ya con evidencia: ni el límite de tokens (2.720 y 3.180 de
8.192), ni un aborto de Luxy (`abortedBy: null`), ni un socket caído
(`done_marker`).

Queda abierto y **ya confirmado como límite real**: el trabajo `LUX-3966` con
KAT Coder Pro v2.5 terminó con `finish_reason: length` y exactamente 8.192
tokens de salida — 22.574 caracteres, unas 700 líneas. Para páginas de
1.000–2.000 líneas hace falta el tope real por modelo (`LA-007`, `F2.14`).

Ese mismo trabajo confirma en producción los arreglos: se guardaron 22.025
caracteres donde antes cabían 4.000, el final se clasificó `truncated` y la
memoria quedó marcada `truncated_block` sin contaminarse.

Evidencia original observada el 2026-08-04, que abrió la incidencia:

- Kimi generó una respuesta durante aproximadamente **23 min 43 s**.
- El panel del proveedor registró la llamada y alrededor de **6.422 tokens de
  salida**.
- El HTML visible terminó a mitad de una etiqueta.
- La respuesta no permite distinguir todavía si el motivo fue
  `finish_reason: length`, timeout local, timeout o aborto del upstream, cierre
  anómalo del socket, proxy intermedio o pérdida de un evento terminal.

No está demostrado que fuese el límite de tokens. Tampoco está demostrado que
Luxy cortase la conexión. La siguiente tarea debe añadir diagnóstico seguro y
reproducir todos los finales posibles antes de cambiar otro timeout.

Avance del 2026-08-05 (`P0.1`, verificado): el transporte ya deja evidencia. Un
trabajo publica un evento `log` con `metadata.responseTermination`, que conserva
código HTTP, si hubo streaming, bytes, chunks, duración, última señal observada
(`done_marker`, `body_closed`, `local_end`, `read_error`, `no_stream`),
`finish_reason` exacto, si el usage era final, quién abortó, timeout y
`max_tokens` efectivos, tokens y longitud del texto. Nunca el contenido. Con
esto, la próxima repetición del caso sí podrá clasificarse.

Hallazgo del mismo paso, **ya resuelto en `P0.2`**: un corte de lectura con
texto parcial se reintentaba entero, porque los errores sin `status` se
consideraban reintentables. Para una generación de 20 minutos eso era empezar de
cero tres veces. Ahora no se reintenta (`D-016`), lo generado se conserva y el
turno se clasifica como `interrupted`.

Avance del 2026-08-05 (`P0.2`, verificado): existen seis finales explícitos —
`completed`, `truncated`, `interrupted`, `timed_out`, `cancelled` y `failed`—
decididos por lógica pura en `packages/shared/src/response-outcome.ts`. Una
salida parcial se guarda con su motivo real en la metadata del trabajo
(`D-017`), sin tocar el enum de Postgres, y **no escribe memoria**.

Dato de código: una conversación HTTP usa el `jobTimeoutMs` general, una hora
por defecto, y no el antiguo tope fijo de cinco minutos. El esquema permite
hasta seis horas. Aun así, un intermediario o el proveedor puede imponer su
propio límite.

Aviso para cualquier pantalla: desde `D-017`, `status: completed` **ya no
significa** que la respuesta llegara entera. Hay que leer `responseOutcome`.

### Fallo latente corregido el 2026-08-05 (`P0.2b`)

Luxy armaba el cierre local al ver una señal terminal y lo ejecutaba un segundo
después aunque el modelo siguiera escribiendo. Bastaba un `usage` sin `choices`
a mitad de la respuesta. **Reproducido** en `sse.test.ts` y corregido con señales
fuertes y débiles (`D-018`).

Aviso importante para no confundir dos cosas: este fallo era real, pero la
telemetría demostró después que **no** fue la causa de los cortes que veía
Daniel. Ésa está en `LUXY-P0-001`, y era el tope de guardado.

### LUXY-P0-002 — memoria contaminada por código — **resuelto el 2026-08-05**

El fallback compactaba los primeros 1.200 caracteres del texto visible cuando no
llegaba un bloque `LUXY_MEMORY` válido. En una respuesta de HTML/CSS/JS eso
guardaba código como resumen, y además pisaba una memoria anterior correcta.

Corregido en `P0.3` (`D-019`): el fallback ya no existe. Sólo un bloque completo,
válido, sin código dentro y en una respuesta `completed` sustituye la memoria;
cualquier otro caso conserva la última válida y registra por qué
(`absent`, `truncated_block`, `invalid`, `rejected_code`). `looksLikeCode` se
aplica también dentro de un bloque bien formado, porque el modelo puede meter la
respuesta ahí.

Queda para `P0.5`: que Studio **diga** que la memoria se conservó y de qué turno
viene, en lugar de limitarse a mostrar la última.

Requisitos originales, todos cubiertos salvo el aviso en pantalla:

- Nunca convertir HTML, CSS, JavaScript, JSON extenso ni bloques de código en
  memoria.
- No reemplazar una memoria anterior válida cuando el turno acaba truncado,
  interrumpido, cancelado o sin bloque estructurado válido.
- Registrar por separado si la memoria fue `structured`, `preserved` o
  `unavailable`.
- Conservar una respuesta parcial como salida o artefacto, no como memoria.

### LUXY-P0-003 — salidas largas no son artefactos

Desde `P0.3b` una conversación guarda hasta 120.000 caracteres y avisa si aun
así no cabe, así que ya no se pierde una respuesta normal. Eso **no** cierra la
incidencia: sigue siendo el campo de resultado, no un almacén de documentos, y
el listado de Studio devuelve esas respuestas completas.

Una web completa no debe depender de ese campo ni de la memoria.
Falta una ruta explícita para guardar código largo como archivo/artefacto y para
continuar una generación interrumpida sin duplicar fragmentos.

## 8. Estado de migraciones: no inferir

La copia de referencia contiene `0001` a `0005`. Documentación anterior dice
que `0005_luxy_studio_jobs.sql` estaba preparada y debía probarse antes de
aplicarse. Las sesiones recientes mencionan además una `0006` en el worktree de
Windows y ordenan expresamente no tocarla.

Esto es una discrepancia abierta, no permiso para «arreglarla»:

- No modificar `0005`, `0006` ni ninguna migración existente.
- No crear `0007` durante la estabilización de Conversaciones salvo que el
  diseño demostrado lo exija y Daniel lo autorice.
- Verificar primero archivos locales y estado remoto; registrar el resultado en
  `LOCAL-ACTIONS.md` y `CHANGELOG-WORK.md`.

## 9. Validación conocida

Las últimas validaciones históricas comunicadas para los arreglos de
Conversaciones fueron:

- 91/91 pruebas específicas para finalización por señales.
- 30/30 para persistencia de resultado, tokens y memoria.
- 11/11 para estado de Conversaciones y feedback.
- `lint`, TypeScript y build completos en verde en la copia de desarrollo.
- Suite global más reciente: 1.312 pruebas ejecutadas; 1.294 pasaron, 9 se
  omitieron y quedaron 9 fallos ambientales conocidos en Linux más dos suites
  de Electron bloqueadas por caché/permisos. No se informó de regresiones de
  código nuevas.

Son resultados históricos. `TEST-RESULTS.md` debe registrar por separado lo que
se ejecute en cada nuevo checkout o worktree.

La copia Linux usada para preparar este relevo reprodujo el 2026-08-04 la misma
línea base: formato, manifiesto, referencias, lint, tipos y build pasaron;
`npm test` mantuvo 1.294 verdes, 9 omitidas, 9 fallos ambientales y dos suites
Electron sin cargar. El detalle exacto está en `TEST-RESULTS.md`.

**Línea base real de Windows, 2026-08-05:** la suite completa pasa entera.
Antes de `P0.1`, 68 archivos y 1.316 verdes; tras `P0.1`, 69 y 1.334; tras
`P0.2`, 70 y 1.356; tras `P0.2b` y `P0.3`, 70 y 1.366; tras `P0.3b`, 70 y
1.370; tras `P0.3c`, 70 y 1.379. Siempre 9 omitidas y exit 0. Los 9 fallos «ambientales» eran exclusivos de la copia
Linux y aquí no existen: en esta máquina un fallo es una regresión.

## 10. Próximo objetivo

El único objetivo activo es completar `LUXY-P0-LONG-RESPONSES`, descrito en
`CURRENT-TASK.md`:

1. observar el final real de cada transporte sin registrar contenido ni claves;
2. clasificar el resultado como completo, truncado, interrumpido, timeout,
   cancelado o fallo;
3. proteger la memoria anterior;
4. conservar la salida parcial;
5. ofrecer continuación y artefacto sólo después de tener estados fiables.

No avanzar a nuevas pantallas, Android, Remote o despliegue antes de cerrar este
bloque y consolidar el checkpoint.
