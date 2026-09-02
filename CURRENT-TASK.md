# Luxy — tarea activa

Actualización 2026-08-31 — corrección SSE: el rechazo de `tool_calls` queda en
`readStream` (solo consulta), no en `consumeStream` compartido. La regresión
ejecuta `write_file` con el bucle agentic y confirma una segunda vuelta final.

## KIMI-K3-RETRY-001 — recuperación de cortes de red

Estado: **`implemented` — Codex, 2026-08-31; validación manual pendiente**

`LUX-SKA7` confirmó un ciclo agentic real: ejecutó `list_files` y `write_file`
en un worktree aislado, y la siguiente vuelta terminó con `fetch failed` tras
quince minutos. La causa demostrada fue que `runAgentic` sólo reintentaba 429.
Ahora reintenta red, 408, 429 y 5xx recuperables sin repetir herramientas ya
terminadas. Siguiente paso: reiniciar Desktop y pulsar **Reintentar trabajo**
en `LUX-SKA7`; sigue experimental hasta que cierre una prueba real.

## OPS-REGISTRATION-001 — alta y arranque de este ordenador

Estado: **`done` — Codex, 2026-08-31**

Objetivo: dejar este perfil de Windows preparado para registrar el agente,
conservar y mostrar la ID que devuelve Gateway, reconstruir y abrir Luxy, y
separar con precisión lo automatizable de lo que exige un secreto de Daniel.

Resultado operativo de cierre:

- la máquina `portatil-oscar` está registrada en Gateway con ID
  `6f34d4b8-5927-43ee-a0d0-360ac54f3c01`;
- `config.json` contiene la configuración no secreta, sin `machineToken`; el
  archivo `secrets.enc` cifrado existe y no se ha leído ni impreso;
- se conservaron una conexión y un proyecto configurados; el secreto temporal
  se retiró del portapapeles tras consumirlo;
- Desktop se reinició retirando `ELECTRON_RUN_AS_NODE` sólo de ese proceso y
  confirmó `agente listo`.

Estado real de partida:

- no existen `%APPDATA%\Luxy\config.json` ni `secrets.enc` para este usuario;
- el Gateway desplegado responde `/health` con `status: ok` y `configured:
  true`;
- no existe `MACHINE_REGISTRATION_SECRET` en el entorno, `.dev.vars` ni otra
  fuente local conocida, por lo que todavía no se puede obtener una UUID ni un
  token válidos;
- el hostname real es `DESKTOP-VM5J5GT`; el nombre sugerido es
  `oscar-desktop-vm5j5gt`;
- Node, npm y Git existen en rutas instaladas pero no están en `PATH`; Claude,
  Codex CLI y `rtk` no aparecen en las ubicaciones habituales;
- el cambio continúa en el worktree aislado
  `luxy/f2-4-conversation-library`, que conserva F2.4-T1 sin commit.

Criterios de aceptación:

1. La ID devuelta por el alta se guarda en `config.json` y se muestra en el
   onboarding sin tratarla como secreto.
2. El token permanece únicamente en `SecretStore` cifrado y el secreto temporal
   de registro se descarta.
3. Luxy se reconstruye y abre en la pantalla correcta para completar el alta.
4. Se documenta exactamente qué debe introducir Daniel y qué comprobar después.
5. Los cambios tienen pruebas y pasan lint, typecheck, suite y build.

Resultado implementado y verificado:

- el onboarding propone `desktop-vm5j5gt` a partir del hostname real;
- la UUID devuelta por Gateway se conserva en `config.json` y aparece tanto en
  el onboarding como en Ajustes;
- el token continúa exclusivamente en `SecretStore` cifrado y el secreto
  temporal se descarta;
- el Gateway público responde correctamente y su URL quedó copiada en el
  portapapeles;
- lint, typecheck, 1.662 pruebas y build completo terminan con exit 0.

Bloqueos externos demostrados:

1. No existe una copia accesible de `MACHINE_REGISTRATION_SECRET`; sin ella el
   Gateway rechaza el alta antes de crear/devolver la UUID.
2. Windows Code Integrity bloquea el `electron.exe` no firmado del worktree con
   eventos 3033/3077 y Policy ID
   `{0283ac0f-fff1-49ae-ada1-8a933130cad6}`. No hay una instalación aprobada de
   Luxy en este equipo.

Reintento del 2026-08-31:

- Gateway sano y configurado; Desktop recompila main/preload, pero Electron
  vuelve a fallar con `spawn UNKNOWN` y nuevos eventos 3033/3077 a las 08:13;
- Wrangler 4.114.0 ya tiene sesión Cloudflare autenticada por Daniel y acceso
  verificado al Worker `luxy-gateway`;
- no hay certificado de firma de código utilizable en el usuario o la máquina;
- el wizard de terminal antiguo no se usa porque guardaría el token en claro en
  `config.json`, contrario al criterio de aceptación 2.
- `CiTool` confirma Smart App Control `VerifiedAndReputableDesktop` en
  enforcement; la base admite suplementos. App Control Wizard 2.8.0.0 ya está
  instalado, pero su primera regla de tipo `Folder Scan` produjo un XML
  suplementario sin `FileRules` ni hashes, por lo que no se desplegó.

Siguiente paso exacto: desde la pantalla principal comprobar visualmente que la
barra de estado muestra el agente conectado y, si hiciera falta, pulsar
**Iniciar agente**. La comprobación de un trabajo real con una API China queda
separada hasta disponer de una clave válida y consentimiento explícito para
consumirla.

---

## BUG-EMPTY-TOOL-CALL-001 — no completar una tarea sin texto ni cambios

Estado: **`done` — Codex, 2026-08-31**

Evidencia real: el trabajo `LUX-A9K9` solicitó Kimi K3 y recibió HTTP 200,
`finish_reason=tool_calls`, 452/2.263 tokens y cero caracteres visibles. El
modelo devolvió llamadas de herramienta, pero `kimi-k3` todavía no declara un
contrato agentic verificado, así que Luxy no ejecutó ninguna; la ruta de solo
texto descartaba esas llamadas y devolvía incorrectamente `completed`.

Corrección: `HttpApiProvider` rechaza cualquier `tool_calls` en una consulta sin
contexto agentic, tanto en SSE como sin streaming. El fallo no se reintenta,
conserva el diagnóstico de transporte y explica que no se ejecutó ninguna
herramienta ni se hicieron cambios. Kimi K3 no recibe herramientas hasta que su
contrato se compruebe de forma explícita.

Validación: reproducción nueva en `providers.test.ts`; lint, typecheck, suite
completa, build y `git diff --check` correctos. El trabajo histórico no se
reescribe porque su estado remoto ya fue cerrado y no hubo archivos que
conservar.

---

## KIMI-K3-EXPERIMENT-001 — verificar ejecución agentic real

Estado: **`in_progress` — Daniel/Codex, 2026-08-31**

Daniel pidió probar Kimi K3 después de observar su `tool_calls` real. El
catálogo lo habilita temporalmente con herramientas nativas y ejecutor confinado
al worktree, pero conserva `contractVerified: false` y la nota
`EXPERIMENTAL_TOOL_CALLING_2026-08-31` hasta obtener evidencia completa.

Siguiente paso exacto: crear desde Studio un trabajo nuevo con **Kimi K3** y una
tarea pequeña que escriba un archivo dentro de su worktree. Debe terminar con
una o más herramientas registradas y un diff no vacío; si no, Codex conservará
el fallo y retirará la capacidad experimental.

Actualización 2026-08-31:

- los dos XML creados por App Control Wizard se comprobaron vacíos; no se
  desplegó ninguno;
- el fallo reproducible actual era `ELECTRON_RUN_AS_NODE=1` en el entorno, que
  hacía que Electron arrancase como Node y fallase al importar `BrowserWindow`;
- al retirar esa variable sólo del proceso de desarrollo, Desktop arrancó y el
  onboarding quedó disponible;
- el secreto de registro se rotó con autorización ya concedida, se subió al
  Worker y se dejó sólo en el portapapeles de Windows para este onboarding.
- `CATALOG-REFRESH-001` queda `done`: el catálogo inicial se ajustó a los 19
  modelos actuales que Daniel mostró el 2026-08-31, con IDs exactos, alias
  actualizados y capacidades conservadoras hasta comprobar cada contrato.

---

## F2.4-T1 — biblioteca de conversaciones

Estado: **`done` — Codex, 2026-08-28**

Objetivo: permitir renombrar, archivar y buscar conversaciones desde Studio,
reutilizando la cola y la metadata existentes, sin migración ni sondeo nuevo.

Estado real de partida:

- `main` y `origin/main` coinciden en `00a9cc1`, que ya integra
  `F4.9-DYNAMIC-HTTP-PROVIDERS`; la integración que este archivo aún marcaba
  como siguiente paso ocurrió fuera del relevo documental;
- `LA-029` continúa pendiente únicamente para publicar Gateway, reconstruir y
  validar manualmente; no se ejecutará sin autorización explícita;
- el trabajo nuevo vive en el worktree aislado
  `luxy/f2-4-conversation-library`, basado en `main` @ `00a9cc1`;
- los cambios locales de `.codebase-memory/` en la copia principal son el ruido
  regenerable ya documentado y se preservan.

Criterios de aceptación:

1. Un título explícito de conversación se valida y persiste sin reescribir los
   prompts ni respuestas guardados.
2. Archivar oculta la conversación de la vista activa y existe una forma clara
   de consultar y restaurar las archivadas.
3. La búsqueda filtra por título y contenido visible ya cargado, sin introducir
   polling ni enviar texto privado a un servicio nuevo.
4. Metadata antigua sigue siendo legible y las acciones se acotan al mismo
   usuario y conversación.
5. No hay migración, deploy, API real, commit ni push automáticos.
6. Lint, typecheck, suite y build terminan en verde con pruebas de lo nuevo.

Resultado verificado:

- renombrado y archivo persistentes en metadata de la conversación, autorizados
  contra la máquina creadora y sin modificar prompts ni respuestas;
- vistas Activas/Archivadas, restauración y búsqueda local por título,
  preguntas y respuestas ya cargadas;
- el título elegido se conserva en turnos posteriores y una conversación
  archivada no admite nuevos envíos hasta restaurarla;
- contratos Zod, Gateway, cliente, IPC, preload, hook y renderer conectados sin
  migración ni polling nuevo;
- una prueba histórica de worktrees ya no depende de la identidad Git global;
- `npm run lint`, `npm run typecheck`, `npm test` y `npm run build`: exit 0;
  96 archivos, 1.655 pruebas superadas y 14 omitidas.

No ejecutado: API real, automatización de navegador, migración, deploy, commit
ni push. El trabajo permanece sin commit en
`luxy/f2-4-conversation-library`.

Siguiente paso exacto: revisar el diff y, si Daniel lo aprueba, crear el commit
local de `F2.4-T1`; la publicación/reconstrucción y validación manual quedan en
`LA-030`. Después, el siguiente bloque planificado es `F2.5`.

---

## F4.9-DYNAMIC-HTTP-PROVIDERS — proveedores HTTP configurables desde Studio

Estado: **`done` — Codex, 2026-08-27**

Objetivo cerrado: permitir añadir, editar, activar, desactivar y eliminar desde
Studio un proveedor HTTP compatible con `chat completions`, guardar su clave
cifrada y hacer que el agente lo use tras aplicar la configuración, sin editar
`config.json` a mano.

Resultado verificado:

- formulario completo en Conexiones y disponibilidad dinámica en Trabajos y
  Conversaciones;
- validación Zod de identificador, URL, modelo, límites y duplicados;
- clave ligada a la configuración y guardada en `SecretStore`, con invalidación
  al eliminar el proveedor o cambiar su endpoint;
- recarga inmediata si el agente está libre y diferida si ejecuta un trabajo;
- `npm run check`: lint, tipos y builds correctos; 96 archivos, 1.656 pruebas
  superadas y 9 omitidas;
- commit local autorizado y creado; ninguna API real, push, deploy ni migración
  ejecutados.

Estado real de partida:

- rama aislada `luxy/f4-9-dynamic-http-providers`, basada en `main` @ `2ae1291`;
- `main` y `origin/main` ya coinciden en `2ae1291`; `LA-028` quedó superada por
  el estado real aunque la documentación anterior todavía la presenta pendiente;
- el commit `2ae1291` permite guardar claves de entradas ya existentes en
  `providers.http`, pero no crear ni editar esas entradas desde Studio;
- `LuxyAgent.initializeProviders` ya construye `HttpApiProvider` desde la
  configuración y el flujo IPC ya puede reiniciar el agente;
- Codebase Memory está operativo sobre `main` @ `2ae1291`. La cobertura de los
  archivos candidatos no registra huecos, pero marca metadata cambiada; por eso
  se contrasta el grafo con el código fuente del worktree antes de editar.

Criterios de aceptación:

1. Studio administra el proveedor completo: identificador, nombre, URL base,
   modelo, clave, estado, streaming y límites seguros.
2. Toda entrada se valida con Zod; no se aceptan URLs inseguras ni nombres de
   secreto arbitrarios que no correspondan a la configuración guardada.
3. Las claves permanecen fuera de `config.json`, cifradas por `SecretStore`.
4. Guardar reinicia o actualiza el agente para que el proveedor aparezca en los
   selectores sin reiniciar Luxy manualmente.
5. Eliminar o cambiar el identificador de clave borra el secreto huérfano.
6. No se llama a ninguna API real; lint, typecheck, suite y build quedan verdes.

Archivos previstos: esquemas shared; store/IPC/configuración y renderer de
Desktop; pruebas de contratos, almacenamiento, IPC/UI y runtime; documentación
de continuidad. Sin commit, push, deploy ni migraciones.

Siguiente paso exacto: integrar el commit local en `main` y ejecutar `LA-029`
para publicar el Gateway, reconstruir Desktop/agente y validar desde Studio una
API elegida por Daniel.

---

## Checkpoint de continuidad — 2026-08-21 (rama renombrada a `main`)

`LUXY-CONSOLIDATION-001` está cerrada (`done`). Después de cerrarla, Daniel
pidió un saneamiento final del checkpoint (secretos protegidos en
`.gitignore`, scratch temporal eliminado, `.codebase-memory/artifact.json`
documentado como problema de diseño abierto — ver `AI-WORK-PROTOCOL.md` §9)
y, tras eso, renombrar la rama canónica a un nombre claro.

**La rama local dejó de llamarse `feat/luxy-desktop` y ahora es `main`**
(`git branch -m`, cambio puramente local). El remoto ya tenía `origin/main`
como rama por defecto (`origin/HEAD -> origin/main`), en `c6e5094`, que es
**ancestro directo** del HEAD actual: no hay divergencia, así que el push
pendiente es un fast-forward limpio, no una reescritura de historia.
`origin/feat/luxy-desktop` (`65ca161`) queda intacta en el remoto sin
actualizar; qué hacer con ella (dejarla o borrarla) es una decisión
pendiente y separada.

- **Línea canónica actual**: `C:\Users\daniel\Desktop\Luxy`, rama `main`,
  HEAD `02c2080`. Copia operativa real (registrada en
  `%APPDATA%\Luxy\config.json`).
- `git worktree list` contiene únicamente esa copia.
- **Push pendiente, bloqueado por el entorno** (no por falta de
  autorización): `git push origin main` fue denegado dos veces por el
  sistema de permisos de esta sesión sin mostrar ningún prompt. Registrado
  como acción manual de Daniel en `LOCAL-ACTIONS.md`, `LA-028`, con el
  comando exacto.
- Working tree limpio salvo el ruido conocido y ya documentado de
  `.codebase-memory/artifact.json`/`graph.db.zst` (el watcher del MCP los
  reescribe en cuanto detecta cualquier cambio; no es un problema de
  producto, ver `AI-WORK-PROTOCOL.md` §9).
- Sin secretos tracked ni staged. Sin cambios de producto sin commitear.

Siguiente acción exacta: Daniel ejecuta `LA-028` (`git push origin main`)
desde una terminal fuera de esta sesión. Después, decidir si se actualiza o
se borra `origin/feat/luxy-desktop` en el remoto, y si se cambia el branch
por defecto de GitHub (si no lo estuviera ya en `main`). Ninguna de las dos
cosas se ha hecho todavía.

---

## Checkpoint de continuidad — 2026-08-21 13:30 (histórico — branch aún `feat/luxy-desktop` en este momento)

Paso cerrado: **LUXY-CONSOLIDATION-001 — consolidación de los ocho worktrees**

Estado: **done — Claude, 2026-08-21**

### Qué es esta tarea

Antes de esta sesión existían ocho worktrees de Luxy sin una línea canónica
declarada: el checkout principal (`feat/luxy-desktop`) con cambios locales
sin commitear, y siete worktrees más creados por el propio agente de Luxy
para tareas anteriores (`luxy/consolidate-worktrees`, `luxy/auto-init-git`,
`lux/bug-hunyuan-backcompat`, `luxy/timeout-deepseek-agentic`,
`luxy/work-update-001-studio`, `luxy/phase-4d-session-host`,
`luxy/ux-001-detalle-trabajo`), cada uno con trabajo real, parte ya
commiteado y parte sin commitear. `LUXY-CONSOLIDATION-001` audita las ocho
líneas, unifica el trabajo válido en una sola y elimina lo redundante.

Detalle completo, cronológico y con evidencia de cada paso: `CHANGELOG-WORK.md`,
entradas del 2026-08-21 bajo `LUXY-CONSOLIDATION-001`. Este archivo sólo
resume el estado final; no repite esa evidencia.

### Estado final

- **Línea canónica**: `C:\Users\daniel\Desktop\Luxy`, rama `feat/luxy-desktop`,
  HEAD `e40268a`. Es tu copia operativa real (registrada en
  `%APPDATA%\Luxy\config.json`).
- **`git worktree list` contiene únicamente esa copia.** Los ocho worktrees
  originales quedaron en uno solo:
  - `luxy/consolidate-worktrees` (HEAD `11dff48`) se identificó como la mejor
    base — descendiente lineal de `feat/luxy-desktop`, sin divergencia — y ya
    integraba como commits `luxy/auto-init-git`, `luxy/ux-001-detalle-trabajo`
    y `luxy/phase-4d-session-host`.
  - Se le añadió un bloque nuevo: diálogo de confirmación React embebido en
    `Studio.tsx` (sustituye `window.confirm()`, mismo patrón que ya usaba
    `Laboratory.tsx`; decisión de Daniel de no adoptar el diálogo IPC nativo
    alternativo de `lux-bug-hunyuan`) y la ficha editable de proyecto de
    `lux-auto-init-git` (`project-profile.ts`, panel «Ficha · alias» en
    `Config.tsx`, CSS asociado, decisiones `D-034`–`D-037`).
  - Ese bloque se commiteó (`e40268a`) y se fusionó en `feat/luxy-desktop`
    por fast-forward.
  - Los cuatro worktrees restantes con cambios sin commitear
    (`lux-bug-hunyuan`, `lux-timeout-deepseek`) o ya limpios
    (`phase-4d-session-host`, `ux-001-detalle-trabajo`, y el propio
    `luxy-consolidate-worktrees`, redundante tras la fusión) se auditaron
    archivo por archivo contra `e40268a` y se confirmó que no aportaban nada
    único: se eliminaron con `git worktree remove --force`. Sus ramas locales
    siguen existiendo (no se borraron ramas, sólo carpetas de trabajo).
- **`git stash@{0}`** (snapshot previo a la fusión) se auditó completo: de
  25 archivos, sólo cinco encabezados históricos de `TEST-RESULTS.md`
  (validaciones manuales del 2026-08-11 sobre el catálogo de modelos) no
  habían llegado a la línea canónica; se rescataron. El resto ya estaba
  integrado o superado. El stash se descartó (`git stash drop`) tras esa
  auditoría.
- **Memoria MCP** (`codebase-memory-mcp`, proyecto `C-Users-daniel-Desktop-Luxy`)
  reindexada explícitamente sobre `e40268a` (4.474 nodos, 14.190 aristas).
  Verificada: `get_architecture` recupera los ocho paquetes reales del
  monorepo; `search_graph` localiza símbolos añadidos en esta misma sesión
  (`buildProjectProfileUpdate`, `resolveHttpRequestTimeout`) en su ubicación
  exacta.
- **Verificación completa en la copia canónica**: `npm run typecheck`,
  `npm run lint` y `npm run build` limpios; `npm test` → **94 archivos, 1.641
  pasadas, 9 omitidas, 0 fallos**. (`npm install` fue necesario una vez, a
  mitad de la fusión: `node_modules` llevaba desde el 1 de agosto sin
  refrescar y producía errores de tipo falsos.)

### Checkpoint final — 2026-08-21 13:50

- `git status --short --branch`: sólo documentación de continuidad
  modificada (`AI-WORK-PROTOCOL.md`, `CHANGELOG-WORK.md`, `CURRENT-TASK.md`,
  `LOCAL-ACTIONS.md`, `MASTER-PLAN.md`, `PROJECT-STATE.md`,
  `TEST-RESULTS.md`) y los artefactos regenerados de memoria MCP
  (`.codebase-memory/artifact.json`, `.codebase-memory/graph.db.zst`); el
  resto son archivos sin seguimiento ya conocidos (claves, demos, respaldo
  temporal, `.wrangler-manual.toml`, el propio scratch de la matriz). **Sin
  commitear** — pendiente de que Daniel autorice ese commit.
- `git worktree list`: **una sola línea**,
  `C:/Users/daniel/Desktop/Luxy e40268a [feat/luxy-desktop]`.
- `npm run lint`: sin incidencias.
- `npm run typecheck`: sin errores.
- `npm test`: **94 archivos, 1.641 pasadas, 9 omitidas, 0 fallos**.
- `npm run build`: correcto en los cuatro workspaces.
- `git diff --check`: sin salida (sin conflictos ni espacios en blanco
  problemáticos).
- Comprobación de secretos: los dos archivos de claves siguen sin
  seguimiento, no aparecen en `git status` como candidatos a commit; escaneo
  de patrones (`sk-…`, `api_key`, `service_role`, `Bearer …`, bloques PEM)
  sobre los documentos tocados esta sesión sin coincidencias.
- Ninguna API real, migración, deploy ni push.

`LUXY-CONSOLIDATION-001` queda **cerrada**. El resumen completo pedido por
Daniel (rama, HEAD, worktrees eliminados/restantes, stash, bloques
integrados/descartados, pruebas, memoria MCP, documentación, validación
manual pendiente, riesgos) se entregó en el chat al cerrar esta tarea.

### Riesgos y validación manual pendiente, conocidos ya ahora

- **Ningún push** de ninguna rama. `feat/luxy-desktop` está 21+ commits por
  delante de `origin/feat/luxy-desktop`.
- **Sin migraciones ni deploy.**
- `npm install` durante la fusión informó **12 vulnerabilidades (5 moderate,
  6 high, 1 critical)** en dependencias. Registrado como hallazgo de
  seguridad; **no se ejecutó `npm audit fix` ni `--force`** por instrucción
  explícita de Daniel — se audita aparte, después de cerrar esta
  consolidación, para no introducir cambios incompatibles sin control.
- `.codebase-memory.pre-merge-backup/` (índice MCP local anterior a la
  fusión, regenerable) sigue en disco: el entorno denegó el permiso para
  borrarlo por comando. Acción manual de Daniel si quiere limpiarlo — ver
  `LOCAL-ACTIONS.md`.
- No hay validación manual de UI pendiente conocida: los cambios de este
  bloque (diálogo de confirmación, ficha de proyecto) están cubiertos por
  pruebas automatizadas, pero nadie los ha visto todavía corriendo en Studio.
  No es bloqueante para cerrar la consolidación; sí conviene probarlo la
  próxima vez que abras Studio.

### Siguiente tarea después de `LUXY-CONSOLIDATION-001`

Ninguna todavía. Por instrucción explícita de Daniel, no se empieza el nuevo
`MASTER-PLAN.md` empresarial hasta que esta consolidación quede cerrada y
Daniel, ChatGPT/Codex y Claude lo redefinan juntos.

---

## Historial de trabajo anterior a esta consolidación

Los pasos `F0`–`F4` (respuestas largas, memoria, catálogo de modelos,
Laboratorio) y las tareas de continuidad `CONSOLIDATE-WORKTREES-001`,
`BUG-HUNYUAN-002` y `GIT-CHECKPOINT-001` que llevaron a los ocho worktrees
descritos arriba están **todas cerradas** y su código integrado en la línea
canónica actual. El registro completo, paso a paso, vive en
`CHANGELOG-WORK.md` (append-only, nunca se reescribe) y el estado de
capacidades del producto en `PROJECT-STATE.md`. No se repite aquí para que
este archivo siga señalando un único trabajo activo, tal como exige
`AI-WORK-PROTOCOL.md`.
