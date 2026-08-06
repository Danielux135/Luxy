# Luxy — resultados de comprobación

Separar siempre resultados históricos, resultados de la copia actual y pruebas
manuales. No transformar un fallo no ejecutado en «omitido».

## Línea base histórica del checkpoint

### 2026-08-02 — Windows — `luxy-work-update-001`

- `npm test`: 1.260 passed, 14 skipped.
- `npm run build`: passed.
- Procedencia: salida devuelta por Daniel tras aplicar el parche principal.

### 2026-08-04 — finalización por señales

- Pruebas específicas: 91/91 passed.
- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- Suite global informada: sin regresiones nuevas; fallos ambientales Linux ya
  conocidos.

### 2026-08-04 — outcome, tokens y memoria

- Pruebas específicas: 30/30 passed.
- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- Confirmación manual de Daniel: las respuestas normales finalizan, muestran
  tokens y guardan memoria.

### 2026-08-04 — feedback

- Pruebas específicas: 11/11 passed.
- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- Suite global informada: 1.312 ejecutadas, 1.294 passed, 9 skipped, 9 fallos
  ambientales Linux y dos suites Electron bloqueadas por caché/permisos.
- Confirmación manual del primer clic: pendiente.

## Incidencia manual que abre P0

### 2026-08-04 — Kimi — generación larga de web

- Duración observada: aproximadamente 23 min 43 s.
- Tokens de salida mostrados por el proveedor: alrededor de 6.422.
- Resultado: HTML incompleto, terminado a mitad de una etiqueta.
- Memoria: fallback contaminado por HTML/CSS/JS.
- `finish_reason`: no capturado.
- Motivo de aborto/cierre: no capturado.
- Conclusión válida: resultado y memoria no son fiables para este caso.
- Conclusión no válida todavía: «alcanzó el límite de tokens» o «Luxy cortó la
  conexión».

## Comprobación de este paquete documental

### 2026-08-04 — copia Linux de referencia — DOC-HANDOFF-001

- Prettier sobre los archivos modificados: passed.
- Validación de `FILE-MANIFEST.json`: passed.
- Existencia y referencias de documentos canónicos: passed.
- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm test`: exit 1; 1.294 passed, 9 skipped, 9 failed y 2 suites no pudieron
  cargarse.
- `npm run build`: passed al ejecutarlo por separado después de la suite.

Fallos de suite conservados:

- 4 en `docs.test.ts` porque la copia de auditoría no contiene `.env.example`
  ni `.env.providers.example`.
- 4 en `agent.test.ts` por expectativas específicas de shims y precedencia
  `.exe`/`.cmd` de Windows ejecutadas en Linux.
- 1 en `confine.test.ts` por normalización de barra invertida de Windows en
  Linux.
- 2 suites Electron no cargaron porque el entorno no permite crear
  `/root/.cache/electron` y el binario no está instalado en esta copia.

Clasificación: línea base ambiental conocida. No apareció un fallo nuevo ligado
a los documentos añadidos. La suite global no se declara verde.

## Línea base real del worktree de Windows

### 2026-08-05 08:36 — Windows — `luxy-work-update-001` — P0.0

- Commit/base o diff: HEAD `61fb7ee` con 29 archivos modificados y 22 sin
  seguimiento (`+1603 / -88`).
- Comando exacto: `npx vitest run --reporter=dot` sobre las ocho suites de
  Conversaciones, y después `npm test`.
- Exit code: 0 en ambos.
- Passed / failed / skipped:
  - suites de Conversaciones: 8 archivos, 57 passed, 0 failed.
  - suite global: 68 archivos, 1.316 passed, 0 failed, 9 skipped.
- Duración: 3,31 s y 57,30 s.
- Fallos completos: ninguno.
- Clasificación: esperado. **Los 9 fallos ambientales del 2026-08-04 eran
  exclusivos de la copia Linux** (`docs.test.ts` sin `.env.example`, shims de
  Windows, `confine.test.ts`) y las dos suites de Electron sí cargan aquí. En
  esta máquina la línea base es verde: un fallo nuevo es una regresión.
- Evidencia manual adicional: `git apply --reverse --check` confirma presentes
  `luxy-conversations-signal-finalization.patch`,
  `luxy-conversations-outcome-token-finalization-fix.patch` y
  `luxy-conversations-feedback-single-click-fix.patch`.

### 2026-08-05 08:51 — Windows — `luxy-work-update-001` — P0.1

- Commit/base o diff: HEAD `61fb7ee` más los cambios de `P0.1` sin confirmar.
- Comando exacto: `npm run lint`, `npm run typecheck`, `npm test`,
  `npm run build`, y vitest por suite durante el desarrollo.
- Exit code: 0 en los cuatro.
- Passed / failed / skipped: 69 archivos, 1.334 passed, 0 failed, 9 skipped
  (línea base previa: 68 archivos, 1.316 passed).
- Duración: 44,63 s la suite completa.
- Fallos completos: ninguno al cerrar. Durante el desarrollo fallaron dos
  pruebas nuevas y las dos eran del mock, no del código:
  1. `textLength: 0` en el corte de socket, porque `retryWithBackoff` repite la
     petición y un `ReadableStream` ya consumido no vuelve a dar bytes. Se
     corrigió el mock para devolver un cuerpo nuevo por intento. **Dejó a la
     vista que un corte con texto parcial se reintenta entero**; anotado para
     `P0.2`.
  2. Timeout de 20 s en la cancelación, porque el mock no hacía fallar el cuerpo
     al abortar y `undici` sí lo hace. Se corrigió el mock.
- Clasificación: esperado.
- Evidencia manual adicional: ninguna. `LA-006` sigue bloqueada hasta `P0.4`.

### 2026-08-05 09:49 — Windows — `luxy-work-update-001` — P0.2

- Commit/base o diff: HEAD `61fb7ee` más los cambios de `P0.1` y `P0.2` sin
  confirmar.
- Comando exacto: `npm run lint`, `npm run typecheck`, `npm test`,
  `npm run build`.
- Exit code: 0 en los cuatro.
- Passed / failed / skipped: 70 archivos, 1.356 passed, 0 failed, 9 skipped
  (antes de `P0.2`: 69 archivos y 1.334 passed).
- Duración: 51,85 s la suite completa.
- Fallos completos: ninguno al cerrar. Durante el desarrollo falló una
  aserción de `P0.1` que comprobaba que la metadata del diagnóstico contenía
  **sólo** `responseTermination`; ahora lleva también `responseOutcome`. Es el
  cambio buscado, y la prueba se actualizó.
- Clasificación: esperado.
- Evidencia del arreglo del reintento: la prueba cuenta los intentos reales.
  Con texto parcial, 1 intento; sin texto, 3. La rama sin texto tarda ~7 s
  porque ejecuta el backoff de verdad.
- Evidencia manual adicional: ninguna. `LA-006` sigue bloqueada hasta `P0.4`.

### 2026-08-05 10:53 — Windows — `luxy-work-update-001` — P0.2b y P0.3

- Commit/base o diff: HEAD `61fb7ee` más `P0.1`–`P0.3` sin confirmar.
- Comando exacto: `npm run lint`, `npm run typecheck`, `npm test`,
  `npm run build`.
- Exit code: 0 en los cuatro.
- Passed / failed / skipped: 70 archivos, 1.366 passed, 0 failed, 9 skipped
  (antes de este paso: 1.356 passed).
- Duración: 53,97 s la suite completa.
- Fallo reproducido a propósito antes del arreglo: `un usage intermedio no
puede cortar una respuesta que continua` devolvía `<html>` en vez de
  `<html><body>mucho mas</body>`. Es el corte que vio Daniel, en pequeño.
- Clasificación: regresión encontrada y corregida.
- Nota de coste: la prueba del proveedor que reproduce el proxy que no cierra el
  cuerpo usa `softTerminalGraceMs: 50`; con el valor real esperaría 15 s. El
  valor por defecto se comprueba aparte contra `SOFT_TERMINAL_GRACE_MS`.
- Evidencia manual pendiente: `LA-006` (repetir la web con el build nuevo) y
  `LA-007` (tope real de salida de Kimi K2.6).

### 2026-08-05 11:15 — Windows — `luxy-work-update-001` — P0.3b

- Commit/base o diff: HEAD `61fb7ee` más `P0.1`–`P0.3b` sin confirmar.
- Comando exacto: `npm run lint`, `npm run typecheck`, `npm test`,
  `npm run build`.
- Exit code: 0 en los cuatro.
- Passed / failed / skipped: 70 archivos, 1.370 passed, 0 failed, 9 skipped
  (antes de este paso: 1.366 passed).
- Duración: 54,16 s la suite completa.
- Fallos completos: ninguno.
- Clasificación: regresión encontrada y corregida.
- Evidencia de producción usada para el diagnóstico (sólo lectura, sin volcar
  contenido): metadata y longitudes de `LUX-YJT9` y `LUX-8B8T`. Ambos con
  `transportEnd: done_marker`, `finishReason: stop`, `abortedBy: null`,
  7.716 y 7.691 caracteres recibidos y **4.000 guardados**.
- Evidencia manual pendiente: `LA-006` y `LA-007`.

### 2026-08-05 16:36 — Windows — `luxy-work-update-001` — P0.3c

- Commit/base o diff: HEAD `61fb7ee` más `P0.1`–`P0.3c` sin confirmar.
- Comando exacto: `npm run lint`, `npm run typecheck`, `npm test`,
  `npm run build`.
- Exit code: 0 en los cuatro.
- Passed / failed / skipped: 70 archivos, 1.379 passed, 0 failed, 9 skipped
  (antes de este paso: 1.370 passed).
- Fallos completos: ninguno al cerrar. Durante el desarrollo falló la prueba del
  límite de plan porque el detector sólo miraba el mensaje del error externo y
  no el del envuelto. Se corrigió el código, no la prueba.
- Clasificación: regresión encontrada y corregida.
- Evidencia de producción (sólo lectura): `LUX-3966` con `finish_reason: length`,
  8.192 tokens de salida, 22.574 caracteres recibidos y **22.025 guardados**.
  Confirma en real el arreglo del tope de guardado y la detección de truncado.
- Evidencia manual pendiente: `LA-007`.

### 2026-08-05 22:03 — Windows 11, ordenador nuevo — MIGRACION-PC

- Commit/base o diff: `luxy/work-update-001-studio` @ `61fb7ee` más el parche
  recuperado (60 archivos, +7.997/−128). Repositorio
  `C:\Users\Daniel\Desktop\proyecto github\Luxy`.
- Comando exacto: `npm run build`, `npm test`, `npm run lint`,
  `npm run typecheck`, `npx prettier --check .`.
- Exit code: 0 los cinco.
- Passed / failed / skipped: **1.379 passed, 0 failed, 9 skipped**, 70/70
  archivos.
- Duración: ≈ 40 s la suite.
- Fallos completos: ninguno al final.
- Clasificación: esperado. Confirma que la migración reproduce el árbol del
  worktree antiguo.
- Evidencia manual adicional: **antes** del build, 9 archivos y 25 pruebas
  fallaban con `TypeError: Cannot read properties of undefined (reading
'safeParse')` en `apps/gateway/src/handlers/api.ts:89`. Causa demostrada:
  `packages/shared/dist` era de un build anterior al parche y no exportaba los
  esquemas nuevos; vitest resuelve `@luxy/shared` por el junction hacia ese
  `dist`. `npm run build` lo resolvió entero. **No era un fallo del parche ni
  del código recuperado.**
- Entorno: los seis junctions de `node_modules/@luxy/*` estaban ya reparados de
  la sesión anterior; sin ellos la suite no arranca.

### 2026-08-05 22:22 — Windows 11 — P0.4

- Commit/base o diff: `luxy/work-update-001-studio` @ `9012eda` más
  `apps/agent/src/response-matrix.test.ts`, sin cambios de producción.
- Comando exacto: `npm run lint`, `npm run typecheck`, `npm test`.
- Exit code: 0 los tres.
- Passed / failed / skipped: **1.398 passed, 0 failed, 9 skipped**, 71/71
  archivos. La matriz aporta 19 pruebas.
- Duración: ≈ 42 s la suite.
- Fallos completos: ninguno al final. Durante el desarrollo, uno solo:
  `expected 'structured' to be 'valid'` — el estado válido de
  `parseConversationMemoryResponse` se llama `structured`. Error de la prueba,
  no del código.
- Clasificación: esperado.
- Evidencia manual adicional: ninguna. El caso 10 usa un proveedor simulado; la
  comprobación de que Studio pinta bien el estado cancelado es `P0.5`.

### 2026-08-05 23:40 — Windows 11 — P0.5

- Commit/base o diff: `luxy/work-update-001-studio` @ `16c6e9a` más cuatro
  archivos: `packages/shared/src/schemas.ts`,
  `apps/desktop/src/renderer/conversation.ts`,
  `apps/desktop/src/renderer/pages/Conversations.tsx` y
  `apps/desktop/src/renderer/conversation.test.ts`.
- Comando exacto: `npx prettier --write` sobre los cuatro, `npm run lint`,
  `npm run typecheck`, `npm test`, `npm run build`.
- Exit code: 0 los cinco.
- Passed / failed / skipped: **1.408 passed, 0 failed, 9 skipped**, 71/71
  archivos. `P0.5` aporta 10 pruebas.
- Duración: ≈ 43 s la suite.
- Fallos completos: ninguno al final. Tres durante el desarrollo, los tres por
  inventar un valor en vez de leer el enum:
  1. `schemas.ts(269,85): error TS2366: Function lacks ending return statement` —
     el `switch` cubría cuatro estados de memoria y `CONVERSATION_MEMORY_STATUSES`
     tiene cinco; faltaba `rejected_code`.
  2. `expected null to deeply equal { input: 900, output: 4096 }` (2 pruebas) —
     la terminación de prueba no pasaba `responseTerminationSchema`: llevaba un
     `lastEvent` que no existe y le faltaba `finalUsageReceived`.
  3. Las mismas 2 pruebas otra vez: `transportEnd: 'stream_end'` no es miembro
     de `STREAM_TRANSPORT_ENDS`. El valor correcto es `local_end`.
- Clasificación: esperado. Los tres fallos son de las pruebas nuevas, ninguno
  toca código de producción ni pruebas anteriores.
- Evidencia manual adicional: **ninguna, y es un límite real**. Studio no arranca
  en este ordenador (falta la configuración de máquina y cuatro secretos, ver
  `LA-010`), así que nadie ha visto la tarjeta en pantalla. Lo verificado es el
  contrato, no el pixel: qué etiqueta sale, qué contadores se muestran, cuándo
  aparece el botón y qué frase de memoria corresponde a cada estado.

### 2026-08-06 08:17 — Windows 11 — LINEA-BASE

- Commit/base o diff: `feat/luxy-desktop` @ `c6e5094`, **árbol limpio** salvo
  cuatro elementos sin seguimiento que no son código (`Claves Luxy Supabase
test.txt`, `Luxy claves API.txt`, un handoff duplicado y `Web demos/`).
- Comando exacto: `npm run build`, `npm test`.
- Exit code: 0 los dos.
- Passed / failed / skipped: **1.408 passed, 0 failed, 9 skipped**, 71/71
  archivos.
- Duración: 51,5 s la suite.
- Fallos completos: ninguno.
- Clasificación: esperado. Reproduce exactamente lo que dejó `P0.5`, ahora ya
  commiteado en esta rama.
- Evidencia manual adicional: la ruta y la rama no son las de `LA-008`. El
  trabajo que allí figuraba «sin commitear» está en la historia de
  `feat/luxy-desktop`.

### 2026-08-06 08:34 — Windows 11 — P0.6a y P0.6b

- Commit/base o diff: `feat/luxy-desktop` @ `c6e5094` más
  `packages/shared/src/continuation.ts`,
  `packages/shared/src/continuation.test.ts`,
  `packages/shared/src/constants.ts`, `packages/shared/src/index.ts`,
  `packages/shared/src/schemas.ts`, `apps/gateway/src/handlers/studio.ts`,
  `apps/gateway/src/handlers/studio.test.ts`,
  `apps/desktop/src/renderer/conversation.ts`,
  `apps/desktop/src/renderer/conversation.test.ts`,
  `apps/desktop/src/renderer/useConversations.ts` y
  `apps/desktop/src/renderer/pages/Conversations.tsx`.
- Comando exacto: `npx prettier --write` sobre los archivos tocados,
  `npm run lint`, `npm run typecheck`, `npm run build`, `npm test`.
- Exit code: 0 los cinco.
- Passed / failed / skipped: **1.436 passed, 0 failed, 9 skipped**, 72/72
  archivos. `P0.6a` aporta 18 pruebas y `P0.6b` otras 10.
- Duración: 53,1 s la suite.
- Fallos completos: ninguno al final. Tres durante `P0.6a`, los tres por elegir
  un umbral a ojo en vez de medirlo contra un caso real:
  1. `expected 'appended' to be 'resynced'` — el ancla de resincronización
     exigía 120 caracteres repetidos; un modelo repite una línea, no un párrafo.
     Ahora se prueba de la más larga a la más corta.
  2. `expected 'appended' to be 'overlap'` — `      <li>Segundo</li>` son 22
     caracteres y el mínimo estaba en 24. Bajado a 16, con el motivo escrito al
     lado de la constante.
  3. `expected 'aaaaaaa\nlinea entera' to be 'linea entera'` — el corte por
     salto de línea de `continuationTail` miraba el primer tercio del trozo; se
     cambió a la primera mitad.
- Clasificación: esperado.
- Evidencia manual adicional: **ninguna, y es un límite real**. Studio no
  arranca en este ordenador (`LA-010`), así que nadie ha visto en pantalla el
  documento unido ni el aviso de costura sin demostrar. Lo verificado es el
  contrato: qué estrategia elige la unión en cada caso, qué llega al prompt, qué
  guarda el gateway y qué reconstruye el renderer.

### 2026-08-06 09:20 — Windows 11 — P0.8

- Commit/base o diff: `feat/luxy-desktop` @ `c6e5094` más lo de `P0.6a`/`P0.6b`
  y, de este paso, `apps/desktop/src/renderer/conversation.ts`,
  `apps/desktop/src/renderer/conversation.test.ts`,
  `apps/desktop/src/renderer/useConversations.ts` y
  `apps/desktop/src/renderer/useStudio.ts`.
- Comando exacto: `npx prettier --write` sobre los cuatro, `npm run lint`,
  `npm run typecheck`, `npm run build`, `npm test`.
- Exit code: 0 los cinco.
- Passed / failed / skipped: **1.443 passed, 0 failed, 9 skipped**, 72/72
  archivos. `P0.8` aporta 7 pruebas.
- Duración: 55,4 s la suite.
- Fallos completos: ninguno.
- Clasificación: regresión encontrada y corregida. El sondeo pedía el detalle de
  respuestas terminadas cada 1,5 s.
- Evidencia manual adicional: la salida de `wrangler` de Daniel, con el patrón
  repitiéndose cada menos de 3 s, y el panel de Supabase con **29.432 peticiones
  al API Gateway en 60 minutos**, 100 % de éxito. La medición **posterior** al
  arreglo está pendiente y es `LA-012`: lo que hay aquí es la aritmética del
  código (≈19.200/h → ≈480/h en reposo), no una medida.

### 2026-08-06 09:40 — Windows 11 — P0.9

- Commit/base o diff: lo anterior más `apps/desktop/src/renderer/conversation.ts`,
  `apps/desktop/src/renderer/conversation.test.ts`,
  `apps/desktop/src/renderer/useConversations.ts` y
  `apps/desktop/src/renderer/pages/Conversations.tsx`.
- Comando exacto: `npx prettier --write` sobre los cuatro, `npm run lint`,
  `npm run typecheck`, `npm run build`, `npm test`.
- Exit code: 0 los cinco.
- Passed / failed / skipped: **1.451 passed, 0 failed, 9 skipped**, 72/72
  archivos. `P0.9` aporta 8 pruebas.
- Duración: 48,8 s la suite.
- Fallos completos: ninguno.
- Clasificación: esperado.
- Evidencia manual adicional: ninguna todavía. Lo verificado es el contrato del
  reductor de eventos locales, cuándo se considera que un directo es local y qué
  ritmo sale de cada combinación. La medición real sigue siendo `LA-012`.

### 2026-08-06 09:55 — Windows 11 — P0.6d

- Commit/base o diff: lo anterior más `packages/shared/src/schemas.ts`,
  `apps/agent/src/job-runner.ts`, `apps/agent/src/agent.ts`,
  `apps/gateway/src/handlers/api.ts`,
  `apps/agent/src/response-matrix.test.ts` y
  `apps/gateway/src/handlers/cancelled-events.test.ts`.
- Comando exacto: `npx prettier --write` sobre los seis, `npm run lint`,
  `npm run typecheck`, `npm run build`, `npm test`.
- Exit code: 0 los cinco.
- Passed / failed / skipped: **1.453 passed, 0 failed, 9 skipped**, 72/72
  archivos. `P0.6d` aporta 2 pruebas nuevas y amplía el caso 10 de la matriz.
- Duración: 53,5 s la suite.
- Fallos completos: ninguno.
- Clasificación: esperado.
- Evidencia manual adicional: ninguna. La comprobación real es cancelar una
  generación larga en Studio y ver que el texto sigue ahí; entra en `LA-012`.

### 2026-08-06 13:05 — Windows 11 — P0.6c

- Commit/base o diff: lo anterior más los dos módulos de artefactos
  (`packages/shared` y `apps/agent`), sus pruebas, `constants.ts`, `schemas.ts`,
  `index.ts`, `job-runner.ts`, `api.ts` del gateway y cinco archivos de Desktop
  (canal IPC, superficie, preload, handlers, main y renderer).
- Comando exacto: `npx prettier --write`, `npm run lint`, `npm run typecheck`,
  `npm run build`, `npm test`.
- Exit code: 0 los cinco.
- Passed / failed / skipped: **1.470 passed, 0 failed, 9 skipped**, 74/74
  archivos. `P0.6c` aporta 17 pruebas en dos archivos nuevos.
- Duración: 58,9 s la suite.
- Fallos completos: ninguno al final. Uno de lint durante el desarrollo:
  `ARTIFACT_KINDS` sólo se usa como tipo y `consistent-type-imports` exige
  `import type`.
- Clasificación: esperado.
- Evidencia manual adicional: ninguna. Las pruebas del agente escriben archivos
  de verdad en carpetas temporales, incluidas las dos de traversal; lo que falta
  es ver el botón **Abrir carpeta** en pantalla (`LA-012`).

## Plantilla

```markdown
### AAAA-MM-DD HH:MM — <entorno> — <ID>

- Commit/base o diff:
- Comando exacto:
- Exit code:
- Passed / failed / skipped:
- Duración:
- Fallos completos:
- Clasificación: regresión | ambiental | bloqueo | esperado.
- Evidencia manual adicional:
```
