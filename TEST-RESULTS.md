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
