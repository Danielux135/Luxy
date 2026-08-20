# Luxy — plan maestro

Última actualización: **2026-08-09**

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

- UX-001: `implemented y verificado en worktree aislado; integración pendiente`.
  Conserva llamadas reales de proveedores HTTP, muestra la carpeta de trabajo y
  la abre sólo tras confinarla dentro de la raíz local de worktrees.

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
Estado global: `in_progress`

- F4.1: inventario real de conexiones, proveedores, modelos y capacidades.
  **`implemented` (2026-08-09)**: Studio consulta sólo `/v1/models` y guarda el
  catálogo con fecha. La lectura real dio 22 modelos y `F4.1-T4` alineó el
  catálogo operativo. La pasarela no publica precios útiles y, por decisión de
  Daniel (`F4.1-T5`), Luxy no los consulta. Los topes siguen sin inventarse y
  dependen de evidencia de `LA-007`.
- F4.2: disponibilidad, velocidad, estabilidad y errores por modelo.
  **`implemented` inicialmente (2026-08-09)**: `F4.2-T1` resume los últimos 100
  trabajos, sin benchmarks ni sondeo. `F4.2-T2` conserva el modelo realmente
  ejecutado incluso si el trabajo sólo pidió una familia, también en fallos y
  cancelaciones. `F4.2-T3` pagina una sola vez hasta 1.000 trabajos, hace visible
  la cobertura y detecta un Gateway que aún no soporte `offset`. Falta
  validación visual (`LA-017`).
- F4.3: pruebas reproducibles: rapidez, código, frontend, español,
  instrucciones, JSON, contexto largo y tool calling. **`implemented`
  inicialmente (2026-08-09)**: `F4.3-T1` define las ocho pruebas con versión,
  prompt, fixture, capacidades y criterios, y las muestra en Laboratorio. La
  ejecución permanece deshabilitada. `F4.3-T2` añade seis fixtures deterministas
  y validadores puros para rapidez exacta, instrucciones, JSON y contexto largo;
  las otras cuatro declaran sandbox, revisión manual o traza como requisito en
  vez de inventar una nota. `F4.3-T3` añade selección por capacidades declaradas
  y prompt compuesto visible. `F4.3-T4` define confirmación literal, modelo
  exacto y snapshot persistente, valida el prompt contra el catálogo y reserva
  una ejecución de solo lectura. La UI mantiene el botón deshabilitado y no
  llama al Gateway. `F4.3-T5` valida al cerrar únicamente resultados completos
  de modos automáticos y persiste checks y métricas en metadata; parciales y
  runners pendientes quedan `not_scored`. Falta presentar resultados y conectar
  una primera ejecución individual bajo acción explícita. `F4.3-T6` presenta
  hasta 12 resultados recientes mediante una lectura acotada y actualización
  manual, sin polling. `F4.3-T7` conecta una ejecución individual sólo para los
  cuatro validadores automáticos, con doble acción humana, modelo exacto y
  barreras repetidas en Gateway. Comparaciones y runners manual/sandbox/traza
  siguen deshabilitados. `F4.3-T8` muestra la evaluación activa, permite pedir
  su cancelación y persiste el cierre como `not_scored`, todo bajo actualización
  manual y sin polling. `F4.3-T9` hace lo mismo con fallos nuevos y presenta
  finales antiguos/interrumpidos sin contrato como evidencia no validada, nunca
  como suspenso. `F4.3-T10` agrega evidencia homogénea con umbral mínimo de 3
  resultados puntuados; no rankea ni recomienda.
- F4.4: ejecución simultánea controlada para comparar modelos. `F4.4-T1` ya
  define el par de exactamente dos modelos y valida su homogeneidad en Gateway;
  `F4.4-T2` lo orquesta desde Desktop, conserva aceptación parcial y nunca
  reintenta automáticamente. `F4.4-T3` presenta juntos A/B sólo por UUID e
  índice, incluidos parciales y finales sin resultado. Bloque funcional cerrado;
  validación manual pendiente.
- F4.5: `done`. Prompt/respuesta completos viven en el trabajo; snapshot,
  modelo, checks, final, tokens y tiempos en el resultado validado. Laboratorio
  los presenta juntos sin puntuación numérica inventada.
- F4.6: `done`. Recomendación provisional por prueba/versión con dos modelos y
  mínimo tres puntuados por modelo; tasa primero, timing/feedback sólo como
  desempates controlados. Empate o muestra insuficiente no producen ganador.
- F4.7: nunca ejecutar benchmarks de pago sin una acción explícita. Cumplido en
  la primera ejecución: casilla y diálogo final; Luxy no consulta ni afirma
  conocer el precio.

Corrección de validación manual: el formulario de ejecución consume
`EXECUTABLE_MODEL_EVALUATIONS` y ya no mezcla runners pendientes con las cuatro
pruebas automáticas. Las ocho definiciones continúan visibles en el catálogo.

Checkpoint de esta fase: `F4.1-T4/T5`, `F4.2-T1/T2/T3` y `F4.3-T1`–`F4.3-T8`
quedaron commiteados localmente el 2026-08-09 con el mensaje
`feat: incorpora modelos y laboratorio reproducible`. No se hizo push ni deploy.
`F4.3-T9/T10` y `F4.4-T1/T2` se añadieron después en el checkpoint local
`3771549 feat: añade evidencia y comparación controlada`. `F4.4-T3` queda
posterior a ese commit.

Estado funcional: **Fase 4 y Modelos/Laboratorio al 100% implementados en
código**, con `LA-018/LA-019` pendientes de validación manual. Studio v1 de
escritorio queda aproximadamente al 72–76% y el roadmap completo al 44–49%.
Incidencias encontradas durante la validación pueden exigir correcciones; Flujos
y Android siguen ampliando el trabajo a varias decenas de sesiones.

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
