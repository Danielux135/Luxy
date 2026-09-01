# Luxy — tarea activa

## BUG-GIT-IDENTITY-001 — identidad de Git de respaldo al confirmar un worktree

Estado: **`done` — Claude, 2026-09-01. Sin commit.**

En un Windows sin `user.name`/`user.email`, Luxy inicializaba un proyecto
editable correctamente pero **no podía confirmar el trabajo del modelo**:
`ensureGitRepository` ya inyectaba una identidad de respaldo para su commit
`estado inicial` y `commitWorktree`, en el mismo archivo, no inyectaba ninguna.

Arreglado en `apps/agent/src/git.ts` con `FALLBACK_IDENTITY_ARGS` y
`hasCommitIdentity()`. El respaldo entra **sólo** cuando el equipo no tiene
identidad: un commit de trabajo conserva la autoría real del usuario cuando
existe. Dos pruebas nuevas cubren los dos lados.

`npm run check` → exit 0; 96 archivos, 1.653 superadas, 14 omitidas.
Evidencia en `CHANGELOG-WORK.md` y `TEST-RESULTS.md` del 2026-09-01.

Queda `LA-030`: la identidad global de este ordenador sigue sin configurar.
Luxy ya no depende de ella; los commits manuales de Daniel sí.

---

## Discrepancias encontradas al abrir la sesión del 2026-09-01

1. Este ordenador (`C:\Users\oscar\Desktop\Daniel\Luxy`) es un clon nuevo **sin
   `node_modules`**. La línea canónica que describe `PROJECT-STATE.md` es
   `C:\Users\daniel\Desktop\Luxy`. Ver `docs/ARRANQUE-ORDENADOR-NUEVO.md`.
2. El «siguiente paso exacto» de `F4.9-DYNAMIC-HTTP-PROVIDERS` decía integrar el
   commit local en `main`. **Ya está integrado**: `main` @ `00a9cc1` *es* ese
   commit. `LA-029` (publicar y validar) sigue abierta; la integración no.

---

## F9-VAULT-001 — conversaciones privadas cifradas y sincronizadas

Estado: **`planned`** — diseño acordado con Daniel el 2026-09-01, sin empezar.

Objetivo: una sección de Luxy que se abre con contraseña y cuyas conversaciones,
memoria e imágenes/vídeos se cifran **en el equipo** antes de salir. La
infraestructura (Gateway, Supabase, almacenamiento de objetos) guarda sólo
ciphertext y nunca recibe la llave. Sincroniza entre los equipos de Daniel.

Jerarquía de claves: `contraseña → Argon2id → KEK → llave maestra aleatoria →
HKDF por dominio`. La llave maestra vive **sólo en memoria del proceso principal
de Electron**; el renderer no la ve nunca. Tres envolturas independientes:
contraseña, recovery key y, opcional, DPAPI para «recordar en este equipo».

Pasos: `F9.1` criptografía (`packages/vault-crypto`, sin dependencias nuevas:
`@noble/hashes@2.2.0` ya trae `argon2` y `hkdf`, y `@noble/curves@2.2.0` trae
`x25519`) · `F9.2` esquemas · `F9.3` `VaultService` y bloqueo · `F9.4` cifrado
en cliente antes de subir · `F9.5` `run_local_turn` en `host-protocol` · `F9.6`
migración de columnas de ciphertext · `F9.7` sincronización entre equipos ·
`F9.8` higiene de logs, cachés y notificaciones · `F9.9` puente explícito por
conversación · `F9.10`–`F9.11` usuarios e invitación · `F9.12` documentación.

Decisiones pendientes antes de `F9.10`: contradice `D-001` («no multi-tenant») y
exige una decisión nueva que lo matice. `F9.1`–`F9.9` no la necesitan.

Límites que la documentación debe recoger sin suavizar: el proveedor de IA ve el
prompt; Telegram no puede leer ciphertext y por eso queda fuera salvo puente
explícito; DPAPI no protege de otro proceso de la misma cuenta de Windows; las
migraciones nunca se han ejecutado contra un Postgres real.

### F9.1 — done (Claude, 2026-09-01, sin commit)

`packages/vault-crypto`, puro y sin dependencias nuevas. Sobre AES-256-GCM con
propósito y versión autenticados; Argon2id sólo para la contraseña y HKDF para
las subclaves; llave maestra con tres envolturas independientes (contraseña,
recuperación, equipo); envoltura X25519 con clave efímera para compartir una
conversación sin entregar el resto.

71 pruebas propias. `npm run check` exit 0: 99 archivos, 1.729 superadas, 9
omitidas. Decisiones `D-039`, `D-040`, `D-041`.

Dos correcciones hechas en el código, no en las pruebas: `randomBytes()` sobre
el tope de 65.536 bytes de `crypto.getRandomValues`, y el coste de Argon2 bajado
de 256 MiB (13 s medidos por desbloqueo) a la segunda opción recomendada por
RFC 9106.

### F9.2 — done (Claude, 2026-09-01)

`packages/shared/src/vault.ts`: la forma de lo que viaja cifrado, separada de la
criptografía. Nivel `cloud` | `private` sin estado intermedio, lista cerrada de
propósitos, registro privado **sin ningún campo donde quepa texto en claro**,
medio con clave de objeto opaca, puente de Telegram apagado por defecto,
invitaciones y permisos por conversación.

`findPlaintextLeaks()` / `assertNoPlaintextLeak()` convierten en código
ejecutable la regla de que una conversación privada no envía contenido en claro,
y la ejecutan los dos lados. Exime los valores que ya son un sobre válido.

35 pruebas. `npm run check` exit 0: 100 archivos, 1.764 superadas.

### Xavira — API verificada en su documentación pública

`GET /v1/generations/:id` permite **polling**, y el callback es opcional. Luxy
no necesita exponer ningún endpoint público: el agente pregunta y descarga
directo, y el Gateway no ve el resultado. Sin esto, la premisa de `F9` no se
sostendría para vídeo. Detalle en `CHANGELOG-WORK.md`.

### F9.3 — done (Claude, 2026-09-01)

`VaultService` en el proceso principal. La llave maestra sólo vive en su
memoria; lo único que sale es `subkeyFor(dominio, contexto)`, y sólo dentro del
main. `status()` es lo único que cruza el IPC, y una prueba enumera sus claves
para verificar que no lleva material criptográfico.

El bloqueo automático se comprueba por reloj y no con un temporizador, porque un
temporizador no se entera de que el equipo estuvo suspendido. Cambiar la
contraseña exige la actual aunque la bóveda esté abierta.

Cerrada de paso una brecha: el renderer podía fijar cualquier secreto cuyo
nombre apareciese como `apiKeyEnv`, así que bastaba declarar un proveedor
llamado `VAULT_DEVICE_KEY` para pisar la llave del equipo. Añadido
`RESERVED_SECRET_NAMES`.

38 pruebas. `npm run check` exit 0: 101 archivos, 1.802 superadas.

**Pendiente de F9.3**: los canales IPC existen y están validados, pero **ninguna
pantalla los usa todavía**. La bóveda no es visible ni usable desde Studio.

### F9.4 — done (Claude, 2026-09-01)

`private-store.ts` es la frontera por la que sale todo lo privado: contenido en
claro entra, registros que el gateway puede almacenar salen. `sealTurn` y
`sealMedia` pasan por `assertNoPlaintextLeak()` como último paso, así que el
guardián ya no es una regla escrita sino una que se ejecuta.

Dentro del cifrado: texto, título, proveedor, modelo, tokens, `mimeType`,
nombre, prompt, `characterId`, dimensiones y duración. Fuera, como metadato
asumido: que existe un registro, de qué conversación, su orden, cuándo y cuánto
ocupa.

Sobre binario nuevo (`sealBlob`) para imágenes y vídeo: coste fijo de 29 bytes
en vez del 33% que añadiría base64. Miniaturas cifradas con su propia subclave.
Claves de objeto aleatorias, nunca derivadas del contenido ni del nombre.

31 pruebas nuevas. `npm run check` exit 0: 103 archivos, 1.833 superadas.

**Pendiente**: esto sella y abre, pero **todavía no sube nada**. No hay cliente
de almacén de objetos, ni endpoints en el gateway, ni migración.

### F9.5 — done (Claude, 2026-09-01)

Un turno privado ya se ejecuta en la máquina local sin tocar la cola de
Supabase. En vez de escribir un segundo ejecutor, se construye un trabajo
sintético y se pasa por `runJob`, marcado como conversación: esa etiqueta ya
activa el camino de sólo lectura, así que un turno privado hereda la garantía
de no tocar archivos en vez de reimplementarla.

El aislamiento se consigue **no dando** las tres piezas que hablan con el
gateway: los eventos van a quien llama y no a la `EventQueue`, el resultado se
devuelve y no se persiste, y `downloadAttachment` lanza
`LocalTurnIsolationError` en vez de llamar. La prueba que lo sostiene espía
`globalThis.fetch` durante un turno completo y verifica **cero llamadas**.

Lo que se pierde, y está escrito en el propio archivo: no hay lease, no hay
reintento tras un corte y no hay historial en el servidor. Si Luxy se cierra a
media respuesta, esa respuesta se pierde.

12 pruebas. `npm run check` exit 0: 104 archivos, 1.845 superadas.

**Pendiente**: `runLocalTurn` exige el agente en marcha. El proceso principal
todavía **no envía** estas peticiones: el canal existe y el host lo atiende,
pero nadie lo llama aún.

### Corrección del plan — 2026-09-01

Daniel preguntó si el hueco de interfaz que yo repetía al cerrar cada paso
estaba planeado. **No lo estaba**, y no faltaba una fila: faltaban las cuatro
capas que consumen la bóveda. Añadidos `F9.13`–`F9.17` en `MASTER-PLAN.md`
con su causa y el camino crítico. Los IDs cerrados no se renumeran.

El camino hasta la primera imagen privada **no es el orden numérico**:
`F9.13` → `F9.14` → `F9.17` da una imagen privada guardada sólo en local;
`F9.6` → `F9.15` → `F9.16` añade la sincronización entre equipos.

Daniel eligió `F9.13`.

### F9.13 — done, confirmado a mano (2026-09-01)

Sección **Privado** en Studio: crear, abrir, cerrar y ajustar la bóveda. Con la
bóveda cerrada no se muestra nada de su contenido, y el indicador de la barra
es un punto y nunca un recuento, porque un número ya diría cuántas hay.
Daniel lo vio funcionando.

Después, a raíz de sus preguntas: el cierre automático pasa a ser configurable
(1, 5, 15, 30, 60, 240 minutos o nunca) porque los 5 minutos eran una constante
que elegí yo; y la pantalla avisa de que «recordar en este equipo» y «cerrar
sola» se contradicen, cosa que antes callaba.

### F9.14 — done, confirmado a mano (2026-09-01)

Conversaciones privadas de extremo a extremo. Escribes, el agente responde sin
pasar por la cola, y todo queda cifrado en `vault/conversations/<uuid>.jsonl`.

Daniel pegó el archivo real: sin texto, sin título, sin proveedor, sin modelo, y
los cuatro nonces distintos. **Pero al medirlo apareció una fuga**: AES-GCM no
rellena, así que el tamaño del sobre revelaba el del mensaje y con eso se
reconstruía la forma de la conversación. Añadido `padding.ts`: el texto se
rellena a múltiplos de 256 bytes, con marca `LXP1` para que lo guardado antes
se siga abriendo.

Precio asumido y documentado: **no hay streaming** en una conversación privada.

### F9.8 — done (2026-09-01)

Era la condición dura antes de usar la bóveda con contenido real, y ya está
levantada. La fuga grave: `devTools` no estaba configurado y su valor por
defecto es `true`, así que con la bóveda abierta cualquiera podía pulsar
Ctrl+Shift+I en la aplicación instalada y leer las conversaciones descifradas
**sin la contraseña**. Además: volcados de fallo redirigidos y nunca enviados, y
una prueba que fija que un turno privado no dispara notificaciones.

### F9.17 — implemented, sin verificar contra la API real (2026-09-01)

Adaptador de generación de imagen y vídeo. Usa **sondeo y no `callback_url`**,
aunque la API lo ofrezca: un callback exigiría una URL pública y el contenido
pasaría por el gateway. Hay prueba de que la petición nunca lo incluye.

Una prueba encontró que `redact()` no tapaba la clave de API, porque llega por
parámetro sin pasar por el registro de secretos: añadido `stripKey()`.

**No se ha llamado a la API real ni una vez**, y el adaptador **no está
cableado**: ninguna parte de Luxy lo llama. Por eso no está en `done`.

### Estado real a 2026-09-01

Hecho y confirmado a mano: `F9.0`–`F9.5`, `F9.8`, `F9.13`, `F9.14`.
Hecho sin verificar contra el exterior: `F9.17`.
Pendiente: `F9.6`, `F9.7`, `F9.9`, `F9.12`, `F9.15`, `F9.16`.
Bloqueado por `D-001`: `F9.10`, `F9.11`.

Lo que YA se puede usar: crear la bóveda, abrirla, cerrarla, conversar en
privado y que se guarde cifrado en este equipo.
Lo que NO: sincronizar entre equipos, y generar imágenes o vídeo.

### F9.6 y F9.15 — implemented, sin ejecución real (2026-09-01)

Migración `0007_luxy_vault.sql` y endpoints de sincronización.

El problema de fondo era **de quién es un registro privado**: con sólo el token
de máquina, lo del portátil no se ve desde el sobremesa. Resuelto con
`vault_id`, derivado de la llave maestra con HKDF: dos equipos que abren la
misma bóveda obtienen el mismo valor sin coordinarse, y el servidor lo guarda
sin aprender nada de la llave.

**Límite escrito en la migración**: el `vault_id` agrupa, **no autoriza**. Si
algún día entra `F9.10` (usuarios), hay que revisarlo antes de abrirlo a nadie.

El gateway ejecuta `assertNoPlaintextLeak` sobre cada registro antes de
guardarlo, aunque el escritorio ya lo compruebe: un servidor que confía en que
el cliente hizo los deberes acaba guardando lo que no debe.

**La migración no se ha ejecutado contra ningún Postgres** (riesgo conocido nº3)
y **el escritorio todavía no sincroniza**: los endpoints existen y nadie los
llama.

### F9.16 — implemented en su parte local (2026-09-01)

Daniel pidió cerrar primero el camino de medios. `BlobStore` guarda los bytes
que `sealMedia` ya devolvió cifrados, y `PrivateMediaStore` une el registro con
los archivos.

`blob-store.ts` **no cifra**: si lo hiciera, habría dos sitios decidiendo cómo
se protege un archivo y acabarían discrepando.

Orden de escritura: bytes primero, registro después. Si falla a medias queda un
huérfano recuperable en vez de un registro que apunta a nada.

Todo se guarda como `.bin`, también el vídeo: un `.mp4` junto a un `.png` ya
diría que hay vídeo, y Windows generaría miniaturas de ambos. Nunca se escribe
una copia sin cifrar a disco, ni temporal.

17 pruebas. `npm run check` exit 0: 111 archivos, 1.941 superadas.

**Pendiente en F9.16**: la implementación remota no existe, sólo la local. Y
**nadie llama al almacén todavía**: no hay IPC ni interfaz para adjuntar o ver
un medio.

**Limitación conocida, anotada como trabajo aparte**: devolver los bytes en
memoria vale para una imagen, no para un vídeo de cientos de megas.
Reproducirlo sin escribirlo a disco exigirá un protocolo propio de Electron que
sirva el flujo descifrado.

### Medios conectados a la interfaz — implemented (2026-09-01)

Ya se pueden adjuntar y ver imágenes y vídeos dentro de una conversación
privada. La ruta la elige el usuario en un diálogo nativo del proceso
principal: el renderer no propone ninguna, porque si pudiera tendría una vía
para leer cualquier archivo del equipo a través de Luxy.

Los bytes descifrados **no se guardan en el estado del renderer**: se piden al
abrir y se sueltan al cerrar.

Tope de previsualización de 20 MB. Por encima se devuelve el tipo pero no el
contenido, y la interfaz dice por qué. Un vídeo grande sigue sin poder verse,
pero ahora el límite es **visible** en vez de silencioso.

Borrar una conversación borra primero sus medios.

**Sin confirmación manual**: no se ha adjuntado ni visto un medio real.

Siguiente paso exacto: el cliente de sincronización que use los endpoints de
`F9.15` — subir lo nuevo y bajar lo que falte. O `F9.12`, la documentación de
privacidad, que sigue pendiente y es la que explica todo esto a quien llegue
después.

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
