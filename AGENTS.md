# AGENTS.md — reglas para agentes en Luxy

Para Codex y cualquier agente compatible con `AGENTS.md`. Comparte los límites
esenciales con `CLAUDE.md`; si algo parece contradecirse, gana la versión más
restrictiva y avisa de la discrepancia.

## Lectura obligatoria y continuidad entre IA

Antes de investigar, planificar o editar, lee en este orden:

1. `PROJECT-STATE.md` — estado real, incidencias abiertas y checkpoint actual.
2. `CURRENT-TASK.md` — único bloque de trabajo activo y su siguiente paso exacto.
3. `MASTER-PLAN.md` — fases, dependencias y criterios de aceptación.
4. `DECISIONS.md` — decisiones que no deben reabrirse sin evidencia nueva.
5. `CHANGELOG-WORK.md`, `TEST-RESULTS.md` y `LOCAL-ACTIONS.md` — trabajo ya hecho,
   pruebas reales y acciones que aún corresponden a Daniel.
6. `AI-WORK-PROTOCOL.md` — contrato completo de relevo entre Claude y Codex.

Si estás en un ordenador recién clonado y nada arranca,
`docs/ARRANQUE-ORDENADOR-NUEVO.md` explica qué falta a propósito en el
repositorio y en qué orden se regenera.

No repitas una auditoría ya documentada. Contrasta únicamente el estado que
pueda haber cambiado (`git status`, diff, archivos implicados y pruebas del
área) y registra cualquier discrepancia antes de continuar.

Sólo una IA puede escribir en un mismo worktree a la vez. Antes de cambiar de
Claude a Codex o viceversa, la IA saliente debe actualizar la documentación de
continuidad. La IA entrante preserva todos los cambios existentes y nunca usa
`reset`, `checkout --` ni otra limpieza para «empezar bien».

Cada paso del plan debe tener un identificador y quedar documentado cuando
cambia de estado. No esperes al final de una sesión para reconstruir lo hecho de
memoria. Como mínimo, registra en `CHANGELOG-WORK.md`: fecha, IA, ID, archivos,
comandos, resultado real, decisiones, riesgos y siguiente paso. Sin esa entrada,
el paso no se considera completado.

Un número nuevo de `LA` o de `D` sigue al último de su archivo. Dos copias del
repositorio (otra rama o un worktree) numeran cada una por su cuenta, así que
al unir una copia lo que choque se renumera: conserva el número la entrada que
lo llevaba primero en git, y la otra pasa al siguiente libre con una línea
«Antes `LA-0NN`». `docs.test.ts` falla si un número se repite. Así nacieron
los cinco duplicados renumerados el 2026-10-14 (tabla en `LOCAL-ACTIONS.md`).

## Estructura del repositorio

```
packages/shared/      logica pura compartida: tipos, Zod, parser de comandos,
                      router, seleccion de maquina, redaccion, rutas.
                      NO importa node:* ni tipos de Cloudflare.
apps/gateway/         Cloudflare Worker. Unica pieza publica.
apps/agent/           ejecutor local en Node para Windows.
apps/desktop/         Luxy Studio en Electron/React; secretos solo en el main.
supabase/migrations/  SQL acumulativo, numerado.
scripts/              PowerShell y .cmd para Windows.
docs/                 documentacion.
```

Dónde tocar según el cambio:

| Cambio                | Archivo                                                                              |
| --------------------- | ------------------------------------------------------------------------------------ |
| Comando de Telegram   | `packages/shared/src/telegram/commands.ts` + `apps/gateway/src/handlers/commands.ts` |
| Formato de mensajes   | `packages/shared/src/telegram/format.ts`                                             |
| Router automático     | `packages/shared/src/router.ts`                                                      |
| Elección de máquina   | `packages/shared/src/machines.ts`                                                    |
| Endpoint privado      | `apps/gateway/src/handlers/api.ts` + `apps/gateway/src/index.ts`                     |
| API de Studio         | `apps/gateway/src/handlers/studio.ts` + contratos de `packages/shared`               |
| Interfaz de trabajos  | `apps/desktop/src/renderer/pages/Studio.tsx`                                         |
| Conversaciones        | `apps/desktop/src/renderer/pages/Conversations.tsx` + `conversation.ts`              |
| Proveedor de IA       | `apps/agent/src/providers/`                                                          |
| Worktrees y git       | `apps/agent/src/git.ts`                                                              |
| Ejecución de procesos | `apps/agent/src/process.ts`                                                          |
| Esquema de BD         | nueva migración en `supabase/migrations/`                                            |

## Comandos principales

```powershell
npm install
npm run lint
npm run typecheck # los paquetes y las pruebas (ver abajo)
npm test
npm run build
npm run check     # los cuatro anteriores
npm run demo      # end-to-end con mocks, sin consumir APIs
```

Nunca ejecutes `npx wrangler deploy` ni apliques migraciones sin que el usuario
lo pida explícitamente.

## Límites de seguridad

**Modelos de IA**

- Prohibida la API de Anthropic.
- Prohibida la API de OpenAI.
- Prohibidas `ANTHROPIC_API_KEY` y `OPENAI_API_KEY`.
- Los proveedores HTTP configurables desde Studio deben hablar el contrato
  `chat completions`. Sus claves viven cifradas en `SecretStore`, nunca en
  `config.json`; las URLs remotas exigen HTTPS y HTTP sólo se admite en loopback.
- El catálogo real de una conexión consulta sólo `/v1/models`; no sondea rutas
  tentativas de precios (`D-022`). En los servidores de NanoGPT esa misma ruta
  se pide con `?detailed=true`, y los precios que trae no se leen (`D-111`).
- El razonamiento de una conexión HTTP se elige POR MODELO en su muestreo
  (`reasoningMode`, `D-107`). Vacío no manda nada. Lo traduce la tabla de
  `reasoning-control.ts`, con nombres enteros y la fuente de cada regla; un
  modelo sin regla no recibe nada. En la tabla, a DeepSeek sólo se le ofrece
  apagarlo: encenderlo rompe los trabajos con herramientas. Todo nombre de
  campo nuevo del registro se comprueba con `isSecretKeyName` (`redact.ts`):
  tapa cualquiera que acabe en key, token, secret, password o credential, en
  singular o plural y en camelCase, snake o kebab (`visiblePorToken` salía
  como `[REDACTADO]`). El veredicto `reasoningVerdict` mira primero lo visible
  y después el recuento: `counted` es que el proveedor declaró razonamiento y
  no llegó nada que se vea.
- En una pasarela con **dialecto de catálogo** (`CATALOG_DIALECTS`, hoy sólo
  NanoGPT) la tabla NO se consulta (`D-111`). El selector ofrece los niveles
  que DECLARA su catálogo guardado, de siete posibles (`off`, `minimal`, `low`,
  `medium`, `high`, `xhigh`, `max`), y el campo viaja sólo si ese modelo tiene
  su ajuste propio en el `modelSampling` del proveedor HTTP. El `reasoningMode`
  de nivel de proveedor no viaja nunca allí, y en una llamada cuyo cuerpo lleva
  `tools` sólo viaja `off`. El agente no conoce el catálogo: un nivel escrito a
  mano dentro de esa entrada viaja y decide la pasarela. El tope de salida
  también es por modelo (`modelOutputCaps`: petición, modelo, proveedor). Un
  refresco no pisa un catálogo detallado con uno simple ni con uno vacío
  (`catalog-refresh.ts`). Los textos dicen «declara», con fecha, nunca «admite»
  (`D-093`). `npm run desktop:dev` no reconstruye el agente empaquetado: un
  cambio del agente se prueba con `npm run build`.
- El trabajo de fondo de la bóveda —catalogar escenas, apuntar lo que queda
  pendiente entre los dos— va **sólo** por Claude Code o Codex con la sesión
  local, nunca por una API de pago (`D-087`). Lo resuelve
  `resolveAuxiliaryTarget`, y catálogo y extracción comparten un único carril.
  Su cursor sólo avanza sobre lo que se ha leído entero, una negativa pertenece
  al CLI que la dio y un fallo suyo jamás hace perder un turno del usuario
  (`D-088`). Lo apuntado vive cifrado en `vault/relation.json`, sellado con la
  subclave de identidad como el catálogo.
- Un fallo del CLI nunca es respuesta ni negativa (`D-109`). Un `result` con
  `is_error` —que el CLI manda con `subtype:"success"`— sale como fallo con
  `failureReason` (`auth`, `rate_limit`, `api_error` o `exit_code`) y un mensaje
  que dice qué hacer, y su texto no va a ningún sitio. Un trabajo de
  conversación sin texto visible también es `failed`. En los cuatro trabajos de
  fondo, un fallo del proceso no persiste negativa ni fila `invalid`: arma una
  espera de 10 minutos por lanzamiento (CLI, modelo y esfuerzo) en
  `auxiliary-cooldown.ts`, que sólo `auth` extiende al CLI entero, y la
  conversación a la que se le atribuye el fallo se salta dos horas. El `claude`
  de la consola tiene su sesión aparte de la app de escritorio: si el fondo no
  avanza, lo primero es `claude auth status --json`.
- Las imágenes de la bóveda tienen **dos** proveedores y el proveedor es del
  **personaje**, no de la máquina: el de pago guarda la identidad en su servidor
  y AI Horde no tiene personajes, así que allí la identidad es una receta local
  y cifrada (`D-064`). La clave de AI Horde no se rellena sola con la anónima:
  con ella el servidor fuerza `shared` y dona lo generado (`D-065`). Ver
  `docs/IMAGENES-GRATIS.md`.
- El dueño de una conversación privada se lee **sólo** con
  `PrivateConversationStore.owner()` o `list()`, que usan la misma
  `resolveConversationOwner` (`D-103`). `owner-single-source.test.ts` falla si en
  `apps/desktop/src/main`, fuera de `conversation-store.ts`, alguien lee
  `characterId`, `characterDescription` o `instructions` de un `turn` (con punto,
  `?.`, corchetes o desestructurando), o si vuelven `characterOf` y los `latest*`;
  es una guarda de texto y un alias se le escapa. En una conversación con
  mensajes el dueño solo cambia con el enganche, guardado cifrado en
  `vault/conversation-owners.json` y **sólo en este equipo**: «Sincronizar» no lo
  sube. El envío rechaza un personaje en una conversación ya empezada; la ficha
  la sella main desde la bóveda cuando cambia, nunca el renderer, y va dentro
  del turno: ese sí lo sube «Sincronizar», sellado como cualquier turno. La
  memoria de las dos últimas conversaciones de un personaje —entera, sin
  `plan` ni `openQuestions` y sin sus mensajes— va detrás de su casilla
  `recentMemories`, apagada por defecto (`D-105`, quinta ronda). Los textos de
  una memoria se cortan en palabra con `clipAtWord`, nunca con un `slice` a
  secas.
- Una conversación **enganchada** queda como una nacida con su personaje
  (`D-108`): su memoria sellada la reescribe con la ficha Claude Code o Codex
  (`MemoryRelink`, nunca una API de pago) en `vault/memory-relink.json`, y el
  `.jsonl` no se toca. La reescrita solo vale **atada** al enganche que gana y a
  la última memoria sellada exacta (secuencia y fecha); lo que pierde material
  (`decideRelink`) no se aplica. Todos los lectores de la memoria —el turno, la
  sonda, `D-105` y «Lo que recuerda»— pasan por `effectiveSealed`; no leas
  `latestMemory` para USAR la memoria. Quien USA la reescrita —el turno de su
  hilo y el resumen de `D-105`— la apunta antes `applied` con
  `markRelinkApplied` (compare-and-set) y, si no puede, va con la sellada. A la
  reescritura le llega la memoria con `repairSlicedMemory`. Una enganchada sin
  memoria sellada queda `not-needed` aunque tenga ficha retroactiva o índice:
  pasa a pendiente solo cuando un turno parte de verdad de ellos
  (`noteInheritedMemoryUsed`), y entonces se reescribe la memoria que selle ese
  turno. Tras cada envío en Privado, `MemoryRelink.sweep` reintenta las
  pendientes de cualquier conversación. «Borrar su memoria» en una enganchada
  quita el texto de la reescrita ANTES de borrar la sellada y, si no puede, no
  borra nada. Mientras se borra una conversación o su memoria no arranca ningún
  envío a ESA conversación (`erasingInFlight` va por conversación). La foto de
  perfil se reconoce con `isProfilePhotoOf`,
  nunca por `characterId` a secas. La firma: en una enganchada, todas sus
  respuestas salvo las escritas con OTRO personaje (`lastForeignSequence`); con
  dueño por turno, solo lo de después de ese turno.
- **Leer la bóveda no es actividad** (`D-106`): `subkeyFor()` no llama a
  `touch()`, y no se lo vuelvas a poner, ni a ningún lector. Mantienen abierta la
  bóveda: abrirla; la presencia real en Privado (`vaultPresence`: eventos REALES
  —`isTrusted`— de teclado, clic, movimiento o rueda, contados solo con la
  ventana visible y con el foco; tener Luxy delante sin tocarla no cuenta); una
  espera del usuario (`VaultService.beginUserWait`) mientras dura algo que pidió
  él; los `touch()` de las operaciones de cuenta y del ajuste de minutos, que ya
  existían; y dos que añadió `D-106` y no se tocan sin leerla: el final de una
  espera y volver a Windows con un cierre aplazado (`unlockScreen`). El
  trabajo de fondo nunca. Win+L solo lo aplaza un envío suyo, en sus dos
  tramos: la espera `reply` hasta que su respuesta queda guardada (10 minutos
  como mucho desde Win+L) y, si el turno lleva imagen del proveedor de PAGO, la
  `turn-image` mientras se genera esa imagen ya pagada (15 minutos como mucho
  desde que el coordinador ve ese tramo: desde que el texto está en disco si
  Win+L llegó antes, o desde Win+L si llegó con el texto ya guardado); después
  cierra, sin cancelar la generación. Una imagen de AI Horde en el turno, que no
  cobra, se espera como la del panel (`image`), y esa no lo aplaza. La
  cierran la inactividad, Win+L, suspender, la X de la ventana, el botón, salir y cerrar la
  sesión, y todo cierre pasa por `lock(motivo)`. Un mensaje suyo sin respuesta
  se retira por su `recordId` (`removeLastTurn`), nunca «la última línea», y
  «Sincronizar» no toca los turnos de una conversación con un envío en curso
  (sus medios sí viajan), y no hay dos envíos a la vez a la misma. El
  temporizador y el `powerMonitor` viven en `VaultLockCoordinator`, no en
  `main/index.ts`. Ningún efecto del renderer depende del objeto `vault` entero:
  `renderer-effect-deps.test.ts` falla si alguien lo hace con ese nombre (es una
  guarda de texto: un alias se le escapa).
- Prohibida cualquier automatización de navegador (Selenium, Playwright) y de
  las interfaces web de Claude o ChatGPT.
- Claude Code y Codex CLI se usan con la **sesión local** del ordenador.
- Prohibido `--dangerously-skip-permissions` y
  `--dangerously-bypass-approvals-and-sandbox`.
- Todo lo de solo lectura (la bóveda y Conversaciones) va sin sesión en disco:
  `--no-session-persistence` en Claude y `--ephemeral` en `codex exec`, si la
  versión lo anuncia en su `--help`. Sin eso el CLI deja en claro, en su carpeta
  de sesiones, lo que la bóveda cifra.

**Secretos**

- Ningún secreto real en el repositorio. Los `.example` llevan `PENDIENTE_...`.
- `SUPABASE_SERVICE_ROLE_KEY` solo existe como secret de Cloudflare.
- Toda salida (logs, eventos, Telegram) pasa por `redact()`.
- Nunca se hereda el entorno completo en un proceso hijo.

**Sistema de archivos**

- Rutas de proyecto absolutas, sin `..`.
- Toda escritura dentro del worktree activo.
- Comprobar enlaces simbólicos con `realpath` antes de aceptar una ruta.

## Reglas para modificar código

1. Lee el archivo antes de editarlo.
2. Respeta el estilo existente: comentarios en español, en minúscula, explicando
   el porqué; código e identificadores en inglés.
3. TypeScript estricto. Nada de `any` fuera de los mocks de tests.
4. Imports relativos con extensión `.js` (obligatorio con `NodeNext`).
5. `import type` para lo que solo se use como tipo.
6. Valida **toda** entrada externa con Zod.
7. No elimines funcionalidad existente al refactorizar.
8. Prefiere módulos pequeños y claros a archivos grandes y mixtos.

## Reglas para ejecutar comandos

- **Siempre `spawn` con ejecutable y lista de argumentos separados.**
- **Nunca `exec`, nunca `shell: true`** con contenido no confiable.
- Cada comando lleva directorio de trabajo, timeout y lista de variables permitidas.
- Los comandos de comprobación salen de `config.json` y además deben estar en
  `ALLOWED_TEST_EXECUTABLES`.
- Las comprobaciones en el host exigen `allowHostChecks: true`; por defecto se
  bloquean porque pueden cargar codigo modificado por el modelo.
- Cancelar significa matar el **árbol completo** de procesos
  (`taskkill /T /F` en Windows).
- No instales dependencias automáticamente si el comando puede ejecutar scripts
  no confiables.

## Pruebas obligatorias

Con cada cambio importante, añade o actualiza pruebas. Las pruebas **nunca**
consumen tokens reales: Telegram, Supabase, Claude, Codex y las APIs HTTP están
mockeados.

Antes de dar nada por terminado:

```powershell
npm run lint
npm run typecheck
npm test
npm run build
```

Los cuatro deben pasar.

`typecheck` comprueba **tambien las pruebas**, por un `tsconfig.tests.json` en
cada paquete. El tsconfig normal las excluye porque emite a `dist`, y vitest
transpila sin comprobar tipos: entre las dos cosas, un archivo de prueba no veia
nunca un comprobador de tipos, y eso dejo pasar durante meses un literal anotado
al que le faltaban campos obligatorios y una prueba que afirmaba un valor de
enum inexistente. `apps/desktop` no lleva ese archivo: sus tres tsconfig ya
incluian las pruebas.

## Política de worktrees

- Toda tarea que modifique archivos corre en un worktree aislado bajo
  `%LOCALAPPDATA%\Luxy\worktrees`, en una rama `luxy/<id>-<slug>`.
- **La carpeta de trabajo del usuario nunca se toca.**
- No se borra un worktree con cambios sin aprobación explícita.
- Cancelar **no borra cambios**: se informa de qué quedó modificado y dónde.
- Studio puede preparar un worktree antes de crear un trabajo y reutilizarlo en
  varios trabajos. La selección se liga a máquina y proyecto; no se crea otro
  worktree mientras se envíe esa ruta y no se descarta sin confirmación.
- Si el proyecto permite ediciones y no es un repositorio git, el agente crea
  `.gitignore`, inicializa Git y hace el commit local `estado inicial` antes de
  crear el worktree. Si `allowEdits` es falso, sigue siendo solo lectura.

## Prohibido hacer automáticamente

`git push` · desplegar · publicar · migraciones destructivas · borrar
repositorios · modificar fuera de los proyectos autorizados · tocar
credenciales · descargar y ejecutar scripts de Internet · enviar correos o
mensajes en nombre del usuario.

**Commits:** solo tras aprobación explícita del usuario.
**Push:** dos confirmaciones **y** `allowPush: true` en la máquina (por defecto `false`).

En Studio, **Aplicar cambios** equivale a crear el commit en la rama aislada
tras confirmación. **Descartar trabajo** elimina el worktree tras confirmación.
Ninguna de las dos acciones mezcla la rama principal ni hace `push`.

Las conversaciones usan la misma cola persistente, identificadas en metadata.
No crean worktree, no ejecutan herramientas ni comprobaciones y siempre invocan
el proveedor en modo de solo lectura. Una comparación son dos trabajos con el
mismo identificador de conversación y turno. El proveedor añade un bloque
`LUXY_MEMORY` validado: el agente lo separa de la respuesta, el gateway lo guarda
en metadata y Studio lo reenvia en turnos posteriores. El feedback del usuario
alimenta recomendaciones explicitas; nunca cambia el proveedor silenciosamente.

Las conversaciones privadas locales llevan `interactionMode: conversation` al
proveedor. Sus directivas de personaje y conducta son órdenes; memoria,
historial y mensaje son datos/canon. No se debe volver a envolver el prompt
privado completo como datos ni imponerle el `system` de asistente técnico
(`D-055`).

**Una respuesta tiene seis finales posibles**, no dos: `completed`, `truncated`,
`interrupted`, `timed_out`, `cancelled` y `failed`. Los decide
`classifyResponseOutcome` (`packages/shared/src/response-outcome.ts`) a partir
del diagnóstico del transporte, y viajan en `responseOutcome` dentro del
resultado y de la metadata del trabajo. El enum de Postgres no cambia: una
salida parcial se guarda como `completed` con su motivo real al lado, así que
**ninguna pantalla puede leer `status: completed` como «respuesta entera»**.

Dos reglas que van con eso:

- un corte que ya había producido texto **no se reintenta**: repetirlo tira lo
  generado y empieza de cero;
- una respuesta cuyo final no sea `completed` **no escribe memoria**; se
  conserva la última válida.

## Archivos que no debes editar ni publicar

```
.env  .env.providers  wrangler.toml  .dev.vars
%APPDATA%\Luxy\config.json
supabase/migrations/*.sql  ya aplicadas  (crea una nueva)
```

No introduzcas rutas absolutas de un ordenador concreto en archivos versionados.

## Cuándo una tarea está terminada

Todo lo siguiente, sin excepciones:

- [ ] El código compila (`npm run build`).
- [ ] `npm run lint` sin errores.
- [ ] `npm run typecheck` sin errores.
- [ ] `npm test` en verde, **sin ocultar fallos**.
- [ ] Hay pruebas de lo nuevo.
- [ ] La documentación afectada está actualizada.
- [ ] No se han introducido secretos ni rutas personales.
- [ ] Lo que dices haber verificado, lo has ejecutado de verdad.
- [ ] `CURRENT-TASK.md`, `PROJECT-STATE.md`, `MASTER-PLAN.md`,
      `CHANGELOG-WORK.md`, `TEST-RESULTS.md` y `LOCAL-ACTIONS.md` reflejan el
      estado que dejas.

**No afirmes que algo funciona si solo lo has implementado.** Si no lo
ejecutaste, dilo. Si una prueba falla, muéstrala.

## Mantener este archivo

Actualiza `AGENTS.md` **y** `CLAUDE.md` cuando cambie la arquitectura, los
comandos principales, la estructura del monorepo, las políticas de seguridad, el
flujo de despliegue, la configuración de proveedores o el sistema de trabajos y
permisos. Los dos archivos no deben contradecirse.

Las reglas detalladas de actualización y relevo viven en
`AI-WORK-PROTOCOL.md`; son obligatorias también cuando el cambio parezca pequeño.

## Consola en Windows: cómo no romper un comando

Reglas sacadas de los fallos reales de una sesión —19 comandos fallidos
analizados uno a uno—, no de suposiciones. **Ninguno falló por sintaxis de
PowerShell.** Ocho fallaron por lo mismo: meter un script dentro de un comando.

**1. Nunca `node -e` ni `python -c` con el script dentro.** Es la causa
principal, con diferencia. Un script en línea pasa por el intérprete de bash
antes de llegar a Node o a Python, y ahí las comillas, las barras invertidas y
los saltos de línea se transforman. Escribe el script a un archivo del
scratchpad con un heredoc de delimitador **entrecomillado** y ejecútalo. Elige
un delimitador que no pueda aparecer dentro; si el texto habla de heredocs, uno
corto como `FIN` se cierra solo a mitad.

**2. Los acentos graves y `$` dentro de comillas dobles se EJECUTAN.** Escribir
una entrada de changelog que mencionaba `npx vitest run` entre acentos graves,
con comillas dobles, lanzó vitest de verdad y dejó el shell colgado seis horas
esperando a que alguien cerrase la sustitución. El delimitador entrecomillado es
lo único que lo impide.

**2 bis. El heredoc SE COME las barras invertidas, aunque el delimitador vaya
entrecomillado.** Es del entorno, no de bash, y contradice lo que uno espera de
un heredoc citado. Pasó dos veces el mismo día: `'\Luxy\config.json'` llegó
como `'\Luxy\config.json'` y Node lo leyó como `LuxyconfigDjson`; y un
`new RegExp('\b(?:...)\s+')` llegó como `'b(?:...)s+'`, que compila sin error
y no casa con nada. Lo segundo es peor: **el archivo se guarda, el typecheck
pasa y sólo lo caza una prueba.**

Reglas prácticas:

- para escribir CÓDIGO con barras invertidas —expresiones regulares, rutas de
  Windows, secuencias de escape— usa las herramientas de edición de archivos, no
  el heredoc;
- si tiene que ser por consola, escribe el código sin barras: `path.join()` en
  vez de rutas literales, y clases de carácter (`[ ]`, `[0-9]`) en vez de `\s` y
  `\d`;
- y comprueba lo escrito con un `grep` del archivo, no del comando: lo que
  importa es lo que quedó en disco.

**3. Rutas absolutas en `cd`.** El directorio de trabajo no persiste entre
llamadas como uno espera, y un `cd` relativo falla sin más.

**4. Los archivos del repositorio son CRLF.** Léelos y escríbelos preservando el
separador, y detéctalo antes de sustituir. Un `sed -i` o un `replace` ingenuo o
no encuentra nada, o deja el archivo con finales mezclados.

**5. Encadenar con `;` devuelve el código del ÚLTIMO comando.** Un `grep` sin
resultados marca como fallido todo el bloque aunque lo anterior fuera bien. Si
importa distinguirlo, sepáralo en dos llamadas.

**6. Lo que se le pasa a Daniel va a PowerShell 5.1.** Un comando por bloque y
**sin `&&`**: en la 5.1 no es un separador, es un error de sintaxis. PowerShell
7.6.5 está instalada en el equipo, pero como `pwsh`, que **no** es el shell por
defecto (`LA-041`); si de verdad hace falta, se escribe
`pwsh -NoProfile -Command "..."` explícitamente. La política de ejecución está
en `Restricted`, así que `npx` falla: se usan los atajos
`node_modules\.bin\*.cmd`.

**7. Un JSON dentro de un comando para Windows necesita `--%`.** PowerShell se
come las comillas escapadas antes de que las vea el programa: un
`curl.exe -d "{\"a\":1}"` llega roto y el servidor contesta «JSON decode error».
El token de parada `--%` hace que todo lo que va detrás se pase **literal**:

```
curl.exe --% -X POST https://ejemplo/api -H "Content-Type: application/json" -d "{\"a\":1}"
```

Con `--%` no se expanden variables de PowerShell, asi que lo que vaya detras
tiene que ir escrito tal cual. Si hace falta una variable —una clave, por
ejemplo—, la alternativa es dejar el cuerpo en un archivo y usar
`--data-binary "@archivo.json"`, que no tiene este problema.

**8. Nunca escribas un secreto dentro de un comando que le pasas a Daniel.**
Queda en su historial de consola y, si lo pega para enseñar el resultado, queda
tambien en la conversacion. Se pide aparte (`$k = Read-Host`) o se deja fuera
del comando.
