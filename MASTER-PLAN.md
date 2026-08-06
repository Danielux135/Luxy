# Luxy — plan maestro

Última actualización: **2026-08-06**

## Estados

- `done`: implementado y verificado con la evidencia indicada.
- `implemented`: código presente, pero falta validación real o consolidación.
- `in_progress`: único bloque que puede estar activo.
- `planned`: definido, todavía no iniciado.
- `paused`: se conserva, pero no consume trabajo ahora.
- `blocked`: necesita una decisión o acción externa concreta.

Los estados se actualizan al completar cada paso, no al final de una fase.

## Fase 0 — estabilizar y consolidar el checkpoint

Prioridad: **P0**  
Estado global: `in_progress`

| ID   | Trabajo                                           | Estado      | Criterio de salida                                                     |
| ---- | ------------------------------------------------- | ----------- | ---------------------------------------------------------------------- |
| F0.1 | Finalización normal de respuestas cortas y medias | done        | pasan solas a Guardado y conservan tokens                              |
| F0.2 | Cancelación y recuperación de trabajos huérfanos  | done        | Detener funciona y no reaparece Respondiendo tras reinicio             |
| F0.3 | Redacción segura de contadores de tokens          | done        | `inputTokens`/`outputTokens` siguen siendo números                     |
| F0.4 | Feedback al primer clic                           | implemented | prueba automática verde; falta confirmación manual del checkpoint      |
| F0.5 | Respuestas largas, truncación y memoria segura    | in_progress | `P0.0`–`P0.6d`, `P0.8` y `P0.9` cerrados; falta `P0.7`                 |
| F0.6 | Consolidar parches acumulados                     | planned     | diff entendible, documentación sincronizada, suite completa registrada |
| F0.7 | Decidir commit local                              | done        | autorizado el 2026-08-06; commit `af095b3`, push aún no completado     |
| F0.8 | Verificar migraciones 0005/0006                   | blocked     | comprobar estado sin modificar ni aplicar nada                         |

Hasta cerrar F0 no se empieza Android, Remote ni una expansión visual grande.

## Fase 1 — vertical slice de Luxy Studio

Prioridad: **P1**  
Estado global: `implemented`

Objetivo: completar de extremo a extremo
máquina → proyecto → proveedor/modelo → tarea → progreso → resultado → diff →
aplicar/descartar → historial.

| ID   | Trabajo                                       | Estado      | Pendiente real                                       |
| ---- | --------------------------------------------- | ----------- | ---------------------------------------------------- |
| F1.1 | Opciones reales de máquina/proyecto/proveedor | implemented | prueba E2E en Windows con gateway real               |
| F1.2 | Crear y seguir trabajo desde formulario       | implemented | validación manual final                              |
| F1.3 | Eventos, resultado, pruebas y diff            | implemented | revisar salidas grandes y paginación                 |
| F1.4 | Worktree aislado                              | done        | mantener invariantes de seguridad                    |
| F1.5 | Aplicar cambios                               | implemented | confirmar commit real en rama aislada sin merge/push |
| F1.6 | Descartar trabajo                             | implemented | confirmar diálogo y limpieza exacta                  |
| F1.7 | Reintentos e idempotencia de decisiones       | implemented | prueba manual de corte/reinicio                      |
| F1.8 | Historial durable                             | implemented | validar más de 100 trabajos/paginación               |

No añadir tarjetas decorativas ni datos simulados. Toda pantalla debe consumir
estado real.

## Fase 2 — Conversaciones completas

Prioridad: **P1** tras F0  
Estado global: `in_progress`

Ya existe:

- conversación persistente sobre trabajos;
- respuesta individual o comparación A/B;
- streaming, cancelación, tiempos y tokens;
- memoria estructurada y contexto de proyecto;
- feedback y recomendación explícita.

Backlog:

| ID    | Trabajo                                          | Estado      |
| ----- | ------------------------------------------------ | ----------- |
| F2.1  | Resolver respuestas largas y memoria contaminada | in_progress |
| F2.2  | Continuar una respuesta truncada/interrumpida    | implemented |
| F2.3  | Guardar código/documentos como artefactos        | implemented |
| F2.4  | Renombrar, archivar y buscar conversaciones      | planned     |
| F2.5  | Regenerar, editar y ramificar turnos             | planned     |
| F2.6  | Adjuntar archivos, imágenes y fragmentos         | planned     |
| F2.7  | Exportar y copiar conversaciones                 | planned     |
| F2.8  | Instrucciones fijadas por conversación/proyecto  | planned     |
| F2.9  | Comparar más de dos modelos con cola controlada  | planned     |
| F2.10 | Fusionar respuestas y elegir ganador             | planned     |
| F2.11 | Explicar la recomendación por tipo de tarea      | planned     |
| F2.12 | Feedback contextual con motivo opcional          | planned     |
| F2.13 | Conservar el texto parcial de una cancelación    | implemented |
| F2.14 | Verificar el tope real de salida por modelo      | blocked     |

La memoria no debe ser almacenamiento de código ni historial completo. Debe
conservar decisiones, hechos confirmados, plan, preguntas y lecciones.

## Fase 3 — Proyectos, contexto y artefactos

Prioridad: **P2**  
Estado global: `planned`

- F3.1: ficha real de proyecto, alias, ruta por máquina, stack e instrucciones.
- F3.2: comandos y checks configurables con `allowHostChecks` explícito.
- F3.3: conversaciones, trabajos, ramas y commits por proyecto.
- F3.4: explorador seguro de archivos y referencias, sin exponer secretos.
- F3.5: artefactos generados versionados o exportables.
- F3.6: memoria de proyecto con procedencia y caducidad/corrección.
- F3.7: límites de contexto visibles y selección de qué entra en el prompt.

Criterio de salida: Daniel puede entrar en un proyecto y ver/operar todo su
contexto sin recurrir a comandos de Telegram.

## Fase 4 — Modelos, conexiones y Laboratorio

Prioridad: **P2**  
Estado global: `planned`

- F4.1: inventario real de conexiones, proveedores, modelos y capacidades.
- F4.2: disponibilidad, velocidad, estabilidad y errores por modelo.
- F4.3: pruebas reproducibles: rapidez, código, frontend, español,
  instrucciones, JSON, contexto largo y tool calling.
- F4.4: ejecución simultánea controlada para comparar modelos.
- F4.5: guardar prompt, parámetros, respuesta, tokens, tiempos y puntuación.
- F4.6: recomendador por tarea basado en evidencia local y feedback.
- F4.7: nunca ejecutar benchmarks de pago sin una acción explícita.

No afirmar capacidades por nombre o marketing. Se marcan como verificadas sólo
con evidencia fechada.

## Fase 5 — Playground

Prioridad: **P3**  
Estado global: `planned`

- mensajes y system prompt;
- temperatura, max tokens, streaming y respuesta raw;
- JSON Schema y tools;
- imágenes, audio y archivos sólo cuando el contrato esté verificado;
- presets, historial, duplicar y exportar ejemplos TypeScript/Python;
- convertir una prueba en comparación o flujo.

El Playground no debe saltarse los controles de presupuesto, redacción o
cancelación del agente.

## Fase 6 — Flujos

Prioridad: **P3**  
Estado global: `planned`

Primera versión deliberadamente menor que n8n:

- entrada, prompt, modelo, comparación, condición y transformación;
- archivo/proyecto, validación, prueba, almacenamiento y aprobación;
- notificación y salida;
- plantillas iniciales para Errorlux, FoskIA, desarrollo web, procesamiento
  masivo y revisión cruzada.

Cada flujo debe ser pausable, auditable y reanudable. Ninguna acción sensible se
aprueba implícitamente por formar parte de un flujo.

## Fase 7 — Luxy Mobile para Android

Prioridad: **P4**  
Estado global: `planned`

Aplicación privada, no WebView y sin Google Play obligatorio:

- inicio, conversaciones, nueva tarea, trabajos, aprobaciones, proyectos,
  modelos, actividad, ajustes y notificaciones;
- streaming, cancelar, revisar diff y aprobar;
- APK privado;
- coste 0 €;
- no iOS.

La arquitectura se retoma sólo después de estabilizar los contratos de Studio;
Mobile reutiliza gateway y cola, no duplica la lógica del agente.

## Fase 8 — Luxy Remote

Prioridad: **sin fecha**  
Estado global: `paused`

Se conservan `packages/remote-protocol`, `packages/remote-crypto`, ADR, threat
model, pruebas y código de host. No continuar WebRTC, TURN, captura, input o
servicio Windows salvo mantenimiento imprescindible del build.

## Cierre de cada fase

Una fase sólo pasa a `done` cuando:

1. se cumplen todos sus criterios de aceptación;
2. hay pruebas sin APIs reales;
3. lint, tipos, suite y build están registrados;
4. la prueba manual inevitable está identificada por separado;
5. documentación y decisiones reflejan el estado;
6. no se ocultan fallos ambientales;
7. Daniel decide de forma explícita cualquier commit, push, migración o
   despliegue.
