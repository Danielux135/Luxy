# Luxy — acciones locales de Daniel

Este archivo sólo contiene acciones que una IA no debe ejecutar por su cuenta.
No repetir una acción marcada como completada sin una razón nueva.

## LA-001 — abrir el checkpoint en VS Code

Estado: `pending`

```powershell
Set-Location "$env:USERPROFILE\AppData\Local\Luxy\worktrees\luxy-work-update-001"
code .
```

Resultado esperado: VS Code abre la rama aislada, no la carpeta original de
Luxy.

## LA-002 — capturar estado real antes de continuar

Estado: `done` — 2026-08-05, ejecutado por Claude Code dentro del worktree.

Sólo comandos de lectura. Resultado: rama `luxy/work-update-001-studio`, HEAD
`61fb7ee`, migraciones `0001`–`0006` presentes e intactas y los tres parches
finales aplicados. Detalle en `CHANGELOG-WORK.md` y `TEST-RESULTS.md`. No hace
falta repetirlo salvo que cambie el worktree desde fuera.

Ejecutar en la terminal de VS Code y pegar la salida a la IA:

```powershell
git status --short --branch
git diff --stat
Get-ChildItem .\supabase\migrations\*.sql | Select-Object Name
```

Después comprobar únicamente los parches finales conocidos:

```powershell
$downloads = Join-Path $env:USERPROFILE "Downloads"
$patches = @(
    "luxy-conversations-signal-finalization.patch",
    "luxy-conversations-outcome-token-finalization-fix.patch",
    "luxy-conversations-feedback-single-click-fix.patch"
)

foreach ($name in $patches) {
    $path = Join-Path $downloads $name
    if (Test-Path $path) {
        git apply --reverse --check $path 2>$null
        [pscustomobject]@{
            Patch = $name
            Present = ($LASTEXITCODE -eq 0)
        }
    }
}
```

No ejecutar `git apply`, `git reset`, `git checkout --`, commit, push ni
migraciones durante esta comprobación.

## LA-003 — arrancar Gateway local

Estado: `cuando haga falta probar Desktop`

```powershell
Set-Location "$env:USERPROFILE\AppData\Local\Luxy\worktrees\luxy-work-update-001\apps\gateway"
npx.cmd wrangler dev
```

Dejar esa PowerShell abierta. Resultado esperado:
`Ready on http://localhost:8787`.

## LA-004 — arrancar Luxy Desktop con el perfil aislado

Estado: `cuando haga falta probar Desktop`

```powershell
$realLocal = Join-Path $env:USERPROFILE "AppData\Local"
$profileRoot = Join-Path $realLocal "Luxy\test-profiles\studio-001"
$repository = Join-Path $realLocal "Luxy\worktrees\luxy-work-update-001"

$env:APPDATA = Join-Path $profileRoot "Roaming"
$env:LOCALAPPDATA = Join-Path $profileRoot "Local"

Set-Location $repository
npm.cmd run desktop:dev
```

## LA-005 — prompt inicial para Claude o Codex

Estado: `disponible`

```text
Continúa Luxy desde el estado real del repositorio. Lee primero AGENTS.md,
CLAUDE.md, PROJECT-STATE.md, CURRENT-TASK.md, MASTER-PLAN.md, DECISIONS.md,
CHANGELOG-WORK.md, TEST-RESULTS.md, LOCAL-ACTIONS.md y AI-WORK-PROTOCOL.md.
No repitas la auditoría, no limpies cambios y no hagas commit, push, deploy ni
migraciones. Confirma el ID activo, contrasta git status/diff y continúa el
siguiente paso documentado. Actualiza la documentación después de cada paso.
```

## LA-006 — repetir la prueba de la web larga

Estado: `listo para ejecutar` — actualizado 2026-08-05 tras `P0.3b`.

**Lo que ya no hace falta demostrar:** las dos ejecuciones del 5 de agosto
(`LUX-YJT9` y `LUX-8B8T`) terminaron bien —`done_marker`, `finish_reason: stop`,
sin aborto— y llegaron enteras: 7.716 y 7.691 caracteres. El corte era el tope
de guardado de 4.000, ya corregido. Esta repetición sirve para **confirmar el
arreglo**, no para volver a diagnosticar.

Espera ver la respuesta completa y el panel de memoria de vuelta.

Antes hay que **reconstruir y reiniciar Desktop**: el corte estaba en el agente,
así que un Studio ya abierto sigue usando el código viejo. Ver `LA-004`.

- Proveedor y modelo: la conexión `hcnsec`, modelo `Kimi-K2.6`.
- Timeout efectivo: 3.600.000 ms (el del trabajo; las conversaciones no usan el
  tope corto de 5 min).
- `max_tokens` efectivo: **8.192**. Es el valor por defecto del catálogo, y para
  una página de 1.000–2.000 líneas probablemente se quede corto: ver `LA-007`.
- Coste esperado: del orden del anterior, unos 4,3 ¥ por generación completa.
- Qué debe devolver Daniel, sin secretos: la línea de evento del trabajo que
  empieza por `diagnostico de la respuesta:`. Lleva `final=`, `finishReason=`,
  `aborto=`, `duracion=`, `timeout=`, `maxTokens=`, `tokens=` y `caracteres=`.
  Con eso se decide si el corte se acabó o si queda otra causa.

Lecturas esperadas si todo va bien: `final=done_marker` o `final=body_closed`,
`aborto=ninguno` y la página entera. Si vuelve a salir `final=local_end`, el
cierre local sigue disparándose y hay que mirar otra vez el lado de Luxy. Si
sale `finishReason=length`, entonces sí era el tope de tokens y toca `LA-007`.

## LA-007 — confirmar el tope real de salida por modelo

Estado: `pending` — **confirmado que hace falta**, 2026-08-05.

Ya no es una sospecha: el trabajo `LUX-3966` con KAT Coder Pro v2.5 terminó con
`finish_reason: length` y exactamente **8.192 tokens de salida**, es decir
22.574 caracteres, unas 700 líneas de HTML. El tope se alcanza de verdad.

El catálogo usa el valor genérico de 8.192 para todos los modelos y **nunca se ha
verificado** por modelo. En la consola del proveedor o en su documentación,
confirmar el `max_tokens` máximo que aceptan `Kimi-K2.6` y `kat-coder-pro-v2.5`.

No lo subo por mi cuenta: poner un número inventado provocaría errores 400 del
proveedor o respuestas cortadas de otra forma. Con el dato real, el cambio es una
línea en `packages/shared/src/models/catalog.ts`.

## Operaciones no autorizadas

- Commit del checkpoint: no autorizado.
- Push: no autorizado.
- Deploy de Wrangler: no autorizado.
- Aplicar `0005`, `0006` o cualquier migración: no autorizado.
- Producción: no autorizada.

## LA-008 — migración al ordenador nuevo: hecha

Estado: **`completada` el 2026-08-05 22:05**

El ordenador `N-2278` ya no se va a usar nunca más. Todo su trabajo está aquí.

- Repositorio activo: `C:\Users\Daniel\Desktop\proyecto github\Luxy`
- Rama activa: `luxy/work-update-001-studio` sobre `61fb7ee`
- Encima: **60 archivos modificados o nuevos, +7.997 / −128, sin commitear**

Respaldos, **fuera** del repositorio, en `C:\Users\Daniel\Desktop\luxy-recuperado\`:

| Carpeta o archivo                     | Contenido                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------- |
| `luxy-work-update-001\`               | copia íntegra del worktree, 307 archivos                                  |
| `luxy-work-update-001-COMPLETO.patch` | el mismo delta como parche, aplica limpio sobre `61fb7ee`                 |
| `parches\`                            | los 12 `.patch` históricos y los handoffs                                 |
| `docs-de-esta-copia-2026-08-05\`      | los documentos desactualizados que tenía esta copia antes de la migración |

Se ejecutó `git worktree prune`: los metadatos apuntaban a
`C:\Users\daniel\AppData\Local\Luxy\worktrees\...`, rutas de una máquina que
ya no existe, y bloqueaban el `checkout` de la rama. Sin esa poda no se podía
continuar. No borró ningún commit.

### Pendiente

`%APPDATA%\Luxy\config.json` **no se copió**: contiene el token de máquina. Para
volver a ejecutar el agente en este ordenador hace falta:

```powershell
npm run setup:machine
```

### Riesgo abierto

Esas 7.997 líneas siguen sin estar en ningún commit. Sobreviven porque hay dos
copias fuera del repositorio, no porque git las guarde. Es exactamente el
supuesto de `D-016`, que sigue sin aceptarse.

## LA-010 — dejar este ordenador operativo

Estado: **`parcial` el 2026-08-05**. Falta únicamente información que sólo
tiene Daniel.

El commit `9012eda` trajo el trabajo, pero **el código no basta para ejecutar**:
la configuración de máquina y los secretos viven fuera del repositorio a
propósito, y el ordenador `N-2278` ya no responde por red (se comprobó).

### Hecho

| Qué                             | Dónde                    | Estado                                                                                     |
| ------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------ |
| Claves de la API China          | `.env.providers`         | escrito; ignorado por git                                                                  |
| Secreto de registro de máquina  | `apps/gateway/.dev.vars` | generado aquí, 24 bytes aleatorios                                                         |
| `service_role` de Supabase      | `apps/gateway/.dev.vars` | puesto                                                                                     |
| Secreto del webhook de Telegram | `apps/gateway/.dev.vars` | puesto                                                                                     |
| Herramientas                    | sistema                  | `node`, `npm`, `git`, `claude` y `codex` presentes; `wrangler` sólo como dependencia local |

Las tres variables de `.env.providers` apuntan a la **misma** conexión
(`https://api.hcnsec.cn/v1`, `DEFAULT_CONNECTIONS` del catálogo): hay una sola
clave para DeepSeek, GLM, Kimi y el resto.

### Pendiente, y por qué bloquea

`apps/gateway/.dev.vars` tiene cuatro valores `PENDIENTE_`. Sin ellos
`envSchema` no valida y el gateway no arranca, y sin gateway no hay registro de
máquina, luego no hay `config.json`, luego no hay agente ni Studio.

- `SUPABASE_URL`: no aparece en ningún archivo. Las claves nuevas
  (`sb_publishable_`, `sb_secret_`) no la codifican, al contrario que las
  antiguas en formato JWT.
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ADMIN_USER_ID` y `TELEGRAM_ALLOWED_CHAT_IDS`:
  `envSchema` los exige aunque sólo se quiera usar Studio.

Además hay una duda de estado real, no de configuración: según
`PROJECT-STATE.md` las migraciones **nunca se han ejecutado contra un Postgres
real**. Si ese proyecto de Supabase está vacío, aplicar
`supabase/migrations/0001`–`0006` es un paso que necesita autorización explícita
de Daniel.

### Aviso sobre el asistente

`npm run setup:machine` pide una URL de gateway y **rechaza lo que no empiece
por `https://`**. `wrangler dev` sirve en `http://localhost:8787`. Con el
gateway en local hay que escribir `config.json` a mano o usar un túnel.
